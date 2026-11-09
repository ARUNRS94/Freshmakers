import { Router, type Request } from 'express';
import { q, one, Where } from '../lib/db.js';
import { siteFilters } from '../lib/auth.js';
import { bad, date, num, today, addDays } from '../lib/http.js';

const r = Router();

function range(req: Request) {
  const to = date(req.query.to) ?? today();
  const from = date(req.query.from) ?? addDays(to, -29);
  if (from > to) throw bad('From date must be before To date');
  return { from, to };
}

/* ================================================================ DASHBOARD */
r.get('/dashboard', async (req, res) => {
  const { from, to } = range(req);
  const mk = () => siteFilters(req, new Where());
  const siteFiltered = !!(req.query.region_id || req.query.client_id || req.query.site_id || req.user.siteIds !== null);
  const itemId = num(req.query.item_id);

  // ---- trend: supply (received at site from dispatch + local purchase + site GRN) vs consumption
  const wt = mk();
  const pf = wt.p(from), pt = wt.p(to);
  const itemCond = itemId ? `AND l.item_id = ${wt.p(itemId)}` : '';
  const trend = await q(
    `SELECT to_char(g.d,'YYYY-MM-DD') d,
            COALESCE(SUM(CASE WHEN l.txn_type IN ('DISPATCH_IN','LOCAL_PURCHASE','GRN') THEN l.qty END),0) supply_qty,
            COALESCE(SUM(CASE WHEN l.txn_type IN ('DISPATCH_IN','LOCAL_PURCHASE','GRN') THEN l.qty*l.rate END),0) supply_value,
            COALESCE(SUM(CASE WHEN l.txn_type='LOCAL_PURCHASE' THEN l.qty*l.rate END),0) local_value,
            COALESCE(-SUM(CASE WHEN l.txn_type='CONSUMPTION' THEN l.qty END),0) consumption_qty,
            COALESCE(-SUM(CASE WHEN l.txn_type='CONSUMPTION' THEN l.qty*l.rate END),0) consumption_value,
            COALESCE(-SUM(CASE WHEN l.txn_type='WASTAGE' THEN l.qty*l.rate END),0) wastage_value
     FROM generate_series(${pf}::date, ${pt}::date, '1 day') g(d)
     LEFT JOIN (stock_ledger l JOIN sites s ON s.id=l.site_id) ON l.txn_date=g.d::date ${itemCond} ${wt.and}
     GROUP BY g.d ORDER BY g.d`, wt.params);

  // ---- indents
  const wi = mk();
  const ip1 = wi.p(from), ip2 = wi.p(to);
  const indentStatus = await q(
    `SELECT i.status, COUNT(*)::int n FROM indents i JOIN sites s ON s.id=i.site_id
     WHERE (i.indent_date BETWEEN ${ip1} AND ${ip2} OR i.status IN ('PENDING','APPROVED','PARTIAL')) ${wi.and}
     GROUP BY i.status`, wi.params);
  const OPEN = ['DRAFT', 'PENDING', 'APPROVED', 'PARTIAL'];
  const indents = {
    open: indentStatus.filter((x) => OPEN.includes(x.status)).reduce((a, x) => a + x.n, 0),
    closed: indentStatus.filter((x) => !OPEN.includes(x.status)).reduce((a, x) => a + x.n, 0),
    by_status: indentStatus,
  };
  const wo = mk();
  const overdue = await one<any>(
    `SELECT COUNT(*)::int n FROM indents i JOIN sites s ON s.id=i.site_id
     WHERE i.status IN ('PENDING','APPROVED','PARTIAL') AND i.required_date < CURRENT_DATE ${wo.and}`, wo.params);

  // ---- breakdown by region / client / site
  const group = ({ region: 'rg.name', client: 'c.name', site: 's.name' } as Record<string, string>)[String(req.query.group ?? 'region')] ?? 'rg.name';
  const wb = mk();
  const b1 = wb.p(from), b2 = wb.p(to);
  const breakdown = await q(
    `SELECT ${group} name,
            COALESCE(SUM(CASE WHEN l.txn_type IN ('DISPATCH_IN','LOCAL_PURCHASE','GRN') THEN l.qty*l.rate END),0) supply_value,
            COALESCE(-SUM(CASE WHEN l.txn_type='CONSUMPTION' THEN l.qty*l.rate END),0) consumption_value,
            COALESCE(SUM(CASE WHEN l.txn_type='LOCAL_PURCHASE' THEN l.qty*l.rate END),0) local_value
     FROM stock_ledger l JOIN sites s ON s.id=l.site_id JOIN clients c ON c.id=s.client_id JOIN regions rg ON rg.id=s.region_id
     WHERE l.txn_date BETWEEN ${b1} AND ${b2} ${wb.and}
     GROUP BY 1 ORDER BY consumption_value DESC LIMIT 15`, wb.params);

  // ---- top consumed items (value)
  const wc = mk();
  const c1 = wc.p(from), c2 = wc.p(to);
  const topItems = await q(
    `SELECT i.name, i.uom, SUM(c.qty_used) qty, SUM(c.qty_wasted) wasted
     FROM consumption c JOIN sites s ON s.id=c.site_id JOIN items i ON i.id=c.item_id
     WHERE c.entry_date BETWEEN ${c1} AND ${c2} ${wc.and} GROUP BY i.id ORDER BY qty DESC LIMIT 10`, wc.params);

  // ---- stock value & alerts
  const ws = mk();
  const stock = await one<any>(
    `SELECT COALESCE(SUM(st.qty * COALESCE(st.avg_rate,i.std_purchase_rate)),0) site_value,
            COUNT(*) FILTER (WHERE st.qty <= COALESCE(sis.reorder_level,i.reorder_level))::int low_count
     FROM v_site_stock st JOIN sites s ON s.id=st.site_id JOIN items i ON i.id=st.item_id
     LEFT JOIN site_item_settings sis ON sis.site_id=st.site_id AND sis.item_id=st.item_id ${ws.sql}`, ws.params);
  const wh = siteFiltered ? { value: null } : await one<any>(
    `SELECT COALESCE(SUM(st.qty*COALESCE(st.avg_rate,i.std_purchase_rate)),0) value FROM v_wh_stock st JOIN items i ON i.id=st.item_id`);

  // ---- payments: vendor (bill status) & RM wise, client receivables
  const vendorStatus = await q(
    `SELECT v.name, SUM(b.amount+b.tax_amount) billed, SUM(b.paid) paid, SUM(b.balance) balance,
            SUM(CASE WHEN b.status<>'PAID' AND b.due_date<CURRENT_DATE THEN b.balance ELSE 0 END) overdue
     FROM v_vendor_bill_status b JOIN vendors v ON v.id=b.vendor_id
     WHERE b.bill_date <= $2 AND (b.status<>'PAID' OR b.bill_date >= $1)
     GROUP BY v.id ORDER BY balance DESC, billed DESC LIMIT 10`, [from, to]);
  const itemStatus = await q(
    `SELECT i.name, SUM(l.amount) billed,
            SUM(l.amount * COALESCE(b.paid / NULLIF(b.amount + b.tax_amount,0),0)) paid,
            SUM(l.amount * (1 - COALESCE(b.paid / NULLIF(b.amount + b.tax_amount,0),0))) balance
     FROM vendor_bill_lines l JOIN v_vendor_bill_status b ON b.id=l.bill_id JOIN items i ON i.id=l.item_id
     WHERE b.bill_date <= $2 AND (b.status<>'PAID' OR b.bill_date >= $1)
     GROUP BY i.id ORDER BY balance DESC, billed DESC LIMIT 10`, [from, to]);
  const payTotals = await one<any>(
    `SELECT COALESCE(SUM(balance) FILTER (WHERE status<>'PAID'),0) open_amount, COUNT(*) FILTER (WHERE status<>'PAID')::int open_count,
            COUNT(*) FILTER (WHERE status='PAID' AND bill_date BETWEEN $1 AND $2)::int closed_count,
            COALESCE(SUM(balance) FILTER (WHERE status<>'PAID' AND due_date<CURRENT_DATE),0) overdue_amount
     FROM v_vendor_bill_status`, [from, to]);
  const wr = mk();
  const recv = await one<any>(
    `SELECT COALESCE(SUM(i.balance) FILTER (WHERE i.status<>'PAID'),0) open_amount,
            COALESCE(SUM(i.balance) FILTER (WHERE i.status<>'PAID' AND i.due_date<CURRENT_DATE),0) overdue_amount,
            COUNT(*) FILTER (WHERE i.status<>'PAID')::int open_count
     FROM v_client_invoice_status i JOIN sites s ON s.id=i.site_id ${wr.sql}`, wr.params);

  // ---- attendance today
  const wa = mk();
  const att = await one<any>(
    `SELECT COUNT(DISTINCT dp.employee_id)::int deployed,
            COUNT(DISTINCT a.employee_id) FILTER (WHERE a.status IN ('P','OT','HD'))::int present,
            COUNT(DISTINCT a.employee_id)::int marked
     FROM deployments dp JOIN sites s ON s.id=dp.site_id
     LEFT JOIN attendance a ON a.employee_id=dp.employee_id AND a.att_date=CURRENT_DATE
     WHERE dp.from_date<=CURRENT_DATE AND (dp.to_date IS NULL OR dp.to_date>=CURRENT_DATE) ${wa.and}`, wa.params);

  const sum = (k: string) => trend.reduce((a: number, x: any) => a + Number(x[k] || 0), 0);
  res.json({
    from, to,
    kpis: {
      supply_value: sum('supply_value'), consumption_value: sum('consumption_value'), local_value: sum('local_value'),
      wastage_value: sum('wastage_value'),
      site_stock_value: stock.site_value, wh_stock_value: wh?.value, low_stock: stock.low_count,
      indents_open: indents.open, indents_closed: indents.closed, indents_overdue: overdue.n,
      payables_open: payTotals.open_amount, payables_overdue: payTotals.overdue_amount,
      payables_open_count: payTotals.open_count, payables_closed_count: payTotals.closed_count,
      receivables_open: recv.open_amount, receivables_overdue: recv.overdue_amount,
      staff_deployed: att.deployed, staff_present: att.present, staff_marked: att.marked,
    },
    trend, indents, breakdown, top_items: topItems,
    payments: { vendors: vendorStatus, items: itemStatus },
  });
});

/* =================================================================== ALERTS */
r.get('/alerts', async (req, res) => {
  const u = req.user;
  const alerts: { type: string; severity: 'high' | 'medium' | 'low'; title: string; detail: string; link?: string }[] = [];
  const mk = () => siteFilters(req, new Where());

  if (u.role !== 'VENDOR' && u.role !== 'FINANCE') {
    const w = mk();
    const low = await q(
      `SELECT s.id site_id, s.name site, i.name item, i.uom, st.qty, COALESCE(sis.reorder_level,i.reorder_level) rl
       FROM v_site_stock st JOIN sites s ON s.id=st.site_id JOIN items i ON i.id=st.item_id
       LEFT JOIN site_item_settings sis ON sis.site_id=st.site_id AND sis.item_id=st.item_id
       WHERE st.qty <= COALESCE(sis.reorder_level,i.reorder_level) ${w.and} ORDER BY st.qty, s.name LIMIT 200`, w.params);
    for (const x of low)
      alerts.push({ type: 'REORDER', severity: x.qty <= 0 ? 'high' : 'medium', title: `${x.item} ${x.qty <= 0 ? 'out of stock' : 'below reorder level'}`,
        detail: `${x.site}: ${x.qty} ${x.uom} (reorder at ${x.rl})`, link: `/stock?site_id=${x.site_id}` });

    const wo = mk();
    const od = await q(`SELECT i.id, i.indent_no, s.name site, i.required_date FROM indents i JOIN sites s ON s.id=i.site_id
       WHERE i.status IN ('PENDING','APPROVED','PARTIAL') AND i.required_date < CURRENT_DATE ${wo.and} ORDER BY i.required_date LIMIT 100`, wo.params);
    for (const x of od)
      alerts.push({ type: 'INDENT_OVERDUE', severity: 'high', title: `Indent ${x.indent_no} overdue`, detail: `${x.site}, required ${x.required_date}`, link: `/indents/${x.id}` });

    const wt = mk();
    const transit = await q(`SELECT d.id, d.dispatch_no, s.name site, d.dispatch_date FROM dispatches d JOIN sites s ON s.id=d.site_id
       WHERE d.status='IN_TRANSIT' AND d.dispatch_date < CURRENT_DATE - 1 ${wt.and} LIMIT 100`, wt.params);
    for (const x of transit)
      alerts.push({ type: 'DISPATCH_PENDING', severity: 'medium', title: `Dispatch ${x.dispatch_no} not acknowledged`, detail: `${x.site}, sent ${x.dispatch_date}`, link: `/dispatches/${x.id}` });

    if (['BARISTA', 'MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'ADMIN'].includes(u.role)) {
      const wm = mk();
      const missing = await q(`SELECT s.id, s.name FROM sites s WHERE s.active
         AND EXISTS (SELECT 1 FROM stock_ledger l WHERE l.site_id=s.id)
         AND NOT EXISTS (SELECT 1 FROM consumption c WHERE c.site_id=s.id AND c.entry_date=CURRENT_DATE-1) ${wm.and} ORDER BY s.name LIMIT 50`, wm.params);
      for (const x of missing)
        alerts.push({ type: 'CONSUMPTION_MISSING', severity: 'low', title: 'Yesterday’s consumption not entered', detail: x.name, link: `/consumption?site_id=${x.id}` });
    }
  }

  if (['SCM', 'ADMIN', 'CBO'].includes(u.role)) {
    const wl = await q(
      `SELECT w.name wh, i.name item, i.uom, COALESCE(st.qty,0) qty, i.wh_reorder_level rl, i.min_order_qty moq
       FROM warehouses w CROSS JOIN items i LEFT JOIN v_wh_stock st ON st.warehouse_id=w.id AND st.item_id=i.id
       WHERE w.active AND i.active AND i.category<>'STORE' AND COALESCE(st.qty,0) <= i.wh_reorder_level AND i.wh_reorder_level > 0
       ORDER BY qty LIMIT 100`);
    for (const x of wl)
      alerts.push({ type: 'WH_REORDER', severity: x.qty <= 0 ? 'high' : 'medium', title: `Warehouse: reorder ${x.item}`,
        detail: `${x.wh}: ${x.qty} ${x.uom} (reorder at ${x.rl}, MOQ ${x.moq})`, link: '/purchase-orders/new' });
    const late = await q(`SELECT p.id, p.po_no, v.name vendor, p.expected_date FROM purchase_orders p JOIN vendors v ON v.id=p.vendor_id
       WHERE p.status IN ('OPEN','PARTIAL') AND p.expected_date < CURRENT_DATE ORDER BY p.expected_date LIMIT 50`);
    for (const x of late)
      alerts.push({ type: 'PO_LATE', severity: 'medium', title: `PO ${x.po_no} delivery late`, detail: `${x.vendor}, expected ${x.expected_date}`, link: `/purchase-orders/${x.id}` });
    const exp = await q(`SELECT i.name item, gl.batch_no, gl.expiry_date FROM grn_lines gl JOIN items i ON i.id=gl.item_id
       WHERE gl.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7 ORDER BY gl.expiry_date LIMIT 50`);
    for (const x of exp)
      alerts.push({ type: 'EXPIRY', severity: 'medium', title: `${x.item} expiring soon`, detail: `Batch ${x.batch_no ?? '-'} expires ${x.expiry_date}` });
  }

  if (['FINANCE', 'ADMIN', 'CBO'].includes(u.role)) {
    const due = await q(`SELECT b.id, b.bill_no, v.name vendor, b.due_date, b.balance FROM v_vendor_bill_status b JOIN vendors v ON v.id=b.vendor_id
       WHERE b.status<>'PAID' AND b.due_date <= CURRENT_DATE + 3 ORDER BY b.due_date LIMIT 100`);
    for (const x of due)
      alerts.push({ type: 'VENDOR_DUE', severity: x.due_date < today() ? 'high' : 'medium',
        title: `${x.due_date < today() ? 'Overdue' : 'Due soon'}: pay ${x.vendor}`, detail: `Bill ${x.bill_no}, ₹${x.balance.toFixed(2)} due ${x.due_date}`, link: '/finance/payables' });
    const rec = await q(`SELECT i.invoice_no, c.name client, i.due_date, i.balance FROM v_client_invoice_status i JOIN clients c ON c.id=i.client_id
       WHERE i.status<>'PAID' AND i.due_date < CURRENT_DATE ORDER BY i.due_date LIMIT 100`);
    for (const x of rec)
      alerts.push({ type: 'CLIENT_OVERDUE', severity: 'medium', title: `Collect from ${x.client}`, detail: `Invoice ${x.invoice_no}, ₹${x.balance.toFixed(2)} overdue since ${x.due_date}`, link: '/finance/receivables' });
  }

  if (u.role === 'VENDOR') {
    const open = await q(`SELECT id, po_no, expected_date, vendor_ack FROM purchase_orders WHERE vendor_id=$1 AND status IN ('OPEN','PARTIAL')`, [u.vendor_id ?? -1]);
    for (const x of open)
      alerts.push({ type: 'PO_OPEN', severity: x.vendor_ack ? 'low' : 'medium', title: `PO ${x.po_no} ${x.vendor_ack ? 'open' : 'awaiting your acknowledgement'}`,
        detail: `Deliver by ${x.expected_date}`, link: `/purchase-orders/${x.id}` });
  }

  // approvals waiting on me
  if (['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO', 'SCM', 'ADMIN'].includes(u.role)) {
    const w = mk();
    if (u.role === 'SCM') w.add(`i.status IN ('APPROVED','PARTIAL')`);
    else if (u.role === 'ADMIN') w.add(`i.status='PENDING'`);
    else w.add(`i.status='PENDING' AND i.current_stage = ?`, u.role);
    const n = await one<any>(`SELECT COUNT(*)::int n FROM indents i JOIN sites s ON s.id=i.site_id ${w.sql}`, w.params);
    if (n.n) alerts.unshift({ type: 'ACTION', severity: 'high', title: `${n.n} indent${n.n > 1 ? 's' : ''} need your action`,
      detail: u.role === 'SCM' ? 'Approved indents waiting for fulfilment' : 'Waiting for your approval', link: '/indents?awaiting_me=true' });
  }

  const order = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => (a.type === 'ACTION' ? -1 : b.type === 'ACTION' ? 1 : order[a.severity] - order[b.severity]));
  res.json(alerts);
});

/* ================================================================== REPORTS */
interface ReportDef {
  label: string;
  /** SQL with {where} placeholder; must expose d (date) and dimension columns */
  sql: string;
  dateCol?: string;
  siteAlias?: string;
  dims: string[];
  measures: Record<string, string>;
  itemCol?: string;
  vendorCol?: string;
  categoryCol?: string;
}

const SITE_DIMS = `rg.name region, c.name client, s.name site`;
const SITE_JOIN = `JOIN sites s ON s.id = X.site_id JOIN clients c ON c.id=s.client_id JOIN regions rg ON rg.id=s.region_id`;

const REPORTS: Record<string, ReportDef> = {
  consumption: {
    label: 'Consumption & wastage',
    sql: `SELECT x.entry_date d, ${SITE_DIMS}, i.name item, i.uom, i.category::text category, x.qty_used, x.qty_wasted,
                 x.qty_used * COALESCE(lr.rate, i.std_purchase_rate) used_value, x.qty_wasted * COALESCE(lr.rate, i.std_purchase_rate) wasted_value
          FROM consumption x ${SITE_JOIN.replace(/X\./g, 'x.')} JOIN items i ON i.id=x.item_id
          LEFT JOIN LATERAL (SELECT rate FROM stock_ledger l WHERE l.ref_type='CONSUMPTION' AND l.ref_id=x.id LIMIT 1) lr ON TRUE {where}`,
    dateCol: 'x.entry_date', siteAlias: 's', itemCol: 'i.id', categoryCol: 'i.category',
    dims: ['d', 'month', 'region', 'client', 'site', 'item', 'category'],
    measures: { qty_used: 'SUM(qty_used)', qty_wasted: 'SUM(qty_wasted)', used_value: 'SUM(used_value)', wasted_value: 'SUM(wasted_value)',
      wastage_pct: 'ROUND(100*SUM(qty_wasted)/NULLIF(SUM(qty_used)+SUM(qty_wasted),0),2)' },
  },
  supply: {
    label: 'Supply to sites (dispatch)',
    sql: `SELECT x.dispatch_date d, ${SITE_DIMS}, i.name item, i.uom, i.category::text category, x.status::text status,
                 l.qty_dispatched, COALESCE(l.qty_received,0) qty_received,
                 CASE WHEN x.status='RECEIVED' THEN l.qty_dispatched-COALESCE(l.qty_received,0) ELSE 0 END qty_short,
                 l.qty_dispatched*l.cost_rate cost_value, COALESCE(l.qty_received,0)*l.sale_rate sale_value
          FROM dispatches x JOIN dispatch_lines l ON l.dispatch_id=x.id ${SITE_JOIN.replace(/X\./g, 'x.')} JOIN items i ON i.id=l.item_id
          {where} AND x.status<>'CANCELLED'`,
    dateCol: 'x.dispatch_date', siteAlias: 's', itemCol: 'i.id', categoryCol: 'i.category',
    dims: ['d', 'month', 'region', 'client', 'site', 'item', 'category', 'status'],
    measures: { qty_dispatched: 'SUM(qty_dispatched)', qty_received: 'SUM(qty_received)', qty_short: 'SUM(qty_short)',
      cost_value: 'SUM(cost_value)', sale_value: 'SUM(sale_value)', margin: 'SUM(sale_value)-SUM(cost_value)' },
  },
  purchase: {
    label: 'Purchase orders: ordered vs received',
    sql: `SELECT x.po_date d, v.name vendor, i.name item, i.uom, i.category::text category, x.status::text status,
                 l.qty_ordered, l.qty_received, GREATEST(l.qty_ordered-l.qty_received,0) qty_pending,
                 l.qty_ordered*l.rate ordered_value, l.qty_received*l.rate received_value, l.rate
          FROM purchase_orders x JOIN po_lines l ON l.po_id=x.id JOIN vendors v ON v.id=x.vendor_id JOIN items i ON i.id=l.item_id
          {where} AND x.status<>'CANCELLED'`,
    dateCol: 'x.po_date', itemCol: 'i.id', vendorCol: 'v.id', categoryCol: 'i.category',
    dims: ['d', 'month', 'vendor', 'item', 'category', 'status'],
    measures: { qty_ordered: 'SUM(qty_ordered)', qty_received: 'SUM(qty_received)', qty_pending: 'SUM(qty_pending)',
      ordered_value: 'SUM(ordered_value)', received_value: 'SUM(received_value)',
      fill_rate_pct: 'ROUND(100*SUM(qty_received)/NULLIF(SUM(qty_ordered),0),1)', avg_rate: 'ROUND(SUM(ordered_value)/NULLIF(SUM(qty_ordered),0),2)' },
  },
  local_purchase: {
    label: 'Local market purchases',
    sql: `SELECT x.purchase_date d, ${SITE_DIMS}, v.name vendor, i.name item, i.uom, i.category::text category, x.reason status,
                 l.qty, l.qty*l.rate amount, l.rate
          FROM local_purchases x JOIN local_purchase_lines l ON l.lp_id=x.id ${SITE_JOIN.replace(/X\./g, 'x.')}
          JOIN vendors v ON v.id=x.vendor_id JOIN items i ON i.id=l.item_id {where}`,
    dateCol: 'x.purchase_date', siteAlias: 's', itemCol: 'i.id', vendorCol: 'v.id', categoryCol: 'i.category',
    dims: ['d', 'month', 'region', 'client', 'site', 'vendor', 'item', 'category', 'status'],
    measures: { qty: 'SUM(qty)', amount: 'SUM(amount)', avg_rate: 'ROUND(SUM(amount)/NULLIF(SUM(qty),0),2)', entries: 'COUNT(*)' },
  },
  indents: {
    label: 'Indents (open / closed, fulfilment)',
    sql: `SELECT x.indent_date d, ${SITE_DIMS}, i.name item, i.uom, i.category::text category, x.status::text status,
                 l.qty_requested, COALESCE(l.qty_approved,l.qty_requested) qty_approved, l.qty_fulfilled, x.id indent_id,
                 CASE WHEN x.status IN ('DRAFT','PENDING','APPROVED','PARTIAL') THEN 1 ELSE 0 END is_open,
                 CASE WHEN x.closed_at IS NOT NULL THEN EXTRACT(EPOCH FROM (x.closed_at - x.created_at))/3600 END tat_hours
          FROM indents x JOIN indent_lines l ON l.indent_id=x.id ${SITE_JOIN.replace(/X\./g, 'x.')} JOIN items i ON i.id=l.item_id {where}`,
    dateCol: 'x.indent_date', siteAlias: 's', itemCol: 'i.id', categoryCol: 'i.category',
    dims: ['d', 'month', 'region', 'client', 'site', 'item', 'category', 'status'],
    measures: { indents: 'COUNT(DISTINCT indent_id)', open_indents: 'COUNT(DISTINCT CASE WHEN is_open=1 THEN indent_id END)',
      qty_requested: 'SUM(qty_requested)', qty_approved: 'SUM(qty_approved)', qty_fulfilled: 'SUM(qty_fulfilled)',
      fulfilment_pct: 'ROUND(100*SUM(LEAST(qty_fulfilled,qty_approved))/NULLIF(SUM(qty_approved),0),1)' },
  },
  stock: {
    label: 'Current site stock',
    sql: `SELECT CURRENT_DATE d, ${SITE_DIMS}, i.name item, i.uom, i.category::text category,
                 x.qty, x.qty*COALESCE(x.avg_rate,i.std_purchase_rate) value,
                 CASE WHEN x.qty <= COALESCE(sis.reorder_level,i.reorder_level) THEN 1 ELSE 0 END below_reorder
          FROM v_site_stock x ${SITE_JOIN.replace(/X\./g, 'x.')} JOIN items i ON i.id=x.item_id
          LEFT JOIN site_item_settings sis ON sis.site_id=x.site_id AND sis.item_id=x.item_id {where}`,
    siteAlias: 's', itemCol: 'i.id', categoryCol: 'i.category',
    dims: ['region', 'client', 'site', 'item', 'category'],
    measures: { qty: 'SUM(qty)', value: 'SUM(value)', items_below_reorder: 'SUM(below_reorder)' },
  },
  vendor_payments: {
    label: 'Vendor payables (vendor & RM wise)',
    sql: `SELECT b.bill_date d, v.name vendor, i.name item, i.uom, i.category::text category, b.status::text status,
                 l.amount billed, l.amount*COALESCE(b.paid/NULLIF(b.amount+b.tax_amount,0),0) paid,
                 l.amount*(1-COALESCE(b.paid/NULLIF(b.amount+b.tax_amount,0),0)) balance,
                 CASE WHEN b.status<>'PAID' AND b.due_date<CURRENT_DATE THEN l.amount*(1-COALESCE(b.paid/NULLIF(b.amount+b.tax_amount,0),0)) ELSE 0 END overdue,
                 l.qty
          FROM v_vendor_bill_status b JOIN vendor_bill_lines l ON l.bill_id=b.id JOIN vendors v ON v.id=b.vendor_id JOIN items i ON i.id=l.item_id {where}`,
    dateCol: 'b.bill_date', itemCol: 'i.id', vendorCol: 'v.id', categoryCol: 'i.category',
    dims: ['d', 'month', 'vendor', 'item', 'category', 'status'],
    measures: { qty: 'SUM(qty)', billed: 'SUM(billed)', paid: 'SUM(paid)', balance: 'SUM(balance)', overdue: 'SUM(overdue)' },
  },
  client_receivables: {
    label: 'Client billing & receivables',
    sql: `SELECT x.invoice_date d, ${SITE_DIMS}, x.status::text status, x.amount+x.tax_amount billed, x.received, x.balance,
                 CASE WHEN x.status<>'PAID' AND x.due_date<CURRENT_DATE THEN x.balance ELSE 0 END overdue, x.id invoice_id
          FROM v_client_invoice_status x ${SITE_JOIN.replace(/X\./g, 'x.')} {where}`,
    dateCol: 'x.invoice_date', siteAlias: 's',
    dims: ['d', 'month', 'region', 'client', 'site', 'status'],
    measures: { invoices: 'COUNT(DISTINCT invoice_id)', billed: 'SUM(billed)', received: 'SUM(received)', balance: 'SUM(balance)', overdue: 'SUM(overdue)' },
  },
  price_comparison: {
    label: 'Purchase price: vendor vs local market',
    sql: `SELECT x.d, x.vendor, i.name item, i.uom, i.category::text category, x.status, x.qty, x.qty*x.rate amount, i.std_sale_rate
          FROM (
            SELECT g.grn_date d, v.name vendor, gl.item_id, 'VENDOR' status, gl.qty_received qty, gl.rate
              FROM grn_lines gl JOIN grns g ON g.id=gl.grn_id JOIN purchase_orders p ON p.id=g.po_id JOIN vendors v ON v.id=p.vendor_id
            UNION ALL
            SELECT lp.purchase_date, v.name, l.item_id, 'LOCAL_MARKET', l.qty, l.rate
              FROM local_purchase_lines l JOIN local_purchases lp ON lp.id=l.lp_id JOIN vendors v ON v.id=lp.vendor_id
          ) x JOIN items i ON i.id=x.item_id {where}`,
    dateCol: 'x.d', itemCol: 'i.id', categoryCol: 'i.category',
    dims: ['month', 'vendor', 'item', 'category', 'status'],
    measures: { qty: 'SUM(qty)', amount: 'SUM(amount)', avg_rate: 'ROUND(SUM(amount)/NULLIF(SUM(qty),0),2)',
      min_rate: 'ROUND(MIN(amount/NULLIF(qty,0)),2)', max_rate: 'ROUND(MAX(amount/NULLIF(qty,0)),2)' },
  },
  margin: {
    label: 'Margin: sale vs cost',
    sql: `SELECT x.dispatch_date d, ${SITE_DIMS}, i.name item, i.uom, i.category::text category,
                 COALESCE(l.qty_received,l.qty_dispatched) qty, COALESCE(l.qty_received,l.qty_dispatched)*l.cost_rate cost_value,
                 COALESCE(l.qty_received,l.qty_dispatched)*l.sale_rate sale_value
          FROM dispatches x JOIN dispatch_lines l ON l.dispatch_id=x.id ${SITE_JOIN.replace(/X\./g, 'x.')} JOIN items i ON i.id=l.item_id
          {where} AND x.status<>'CANCELLED'`,
    dateCol: 'x.dispatch_date', siteAlias: 's', itemCol: 'i.id', categoryCol: 'i.category',
    dims: ['month', 'region', 'client', 'site', 'item', 'category'],
    measures: { qty: 'SUM(qty)', cost_value: 'SUM(cost_value)', sale_value: 'SUM(sale_value)', margin: 'SUM(sale_value)-SUM(cost_value)',
      margin_pct: 'ROUND(100*(SUM(sale_value)-SUM(cost_value))/NULLIF(SUM(sale_value),0),1)' },
  },
  attendance: {
    label: 'Attendance',
    sql: `SELECT x.att_date d, ${SITE_DIMS}, e.name employee, e.designation category, x.status,
                 CASE WHEN x.status IN ('P','OT') THEN 1 WHEN x.status='HD' THEN 0.5 ELSE 0 END present_days,
                 CASE WHEN x.status='A' THEN 1 ELSE 0 END absent_days, CASE WHEN x.status='L' THEN 1 ELSE 0 END leave_days
          FROM attendance x ${SITE_JOIN.replace(/X\./g, 'x.')} JOIN employees e ON e.id=x.employee_id {where}`,
    dateCol: 'x.att_date', siteAlias: 's',
    dims: ['d', 'month', 'region', 'client', 'site', 'employee', 'category', 'status'],
    measures: { marked: 'COUNT(*)', present_days: 'SUM(present_days)', absent_days: 'SUM(absent_days)', leave_days: 'SUM(leave_days)',
      attendance_pct: 'ROUND(100*SUM(present_days)/NULLIF(COUNT(*),0),1)' },
  },
};

r.get('/reports', (_req, res) => {
  res.json(Object.entries(REPORTS).map(([key, d]) => ({ key, label: d.label, dims: d.dims, measures: Object.keys(d.measures), dated: !!d.dateCol })));
});

r.get('/reports/:key', async (req, res) => {
  const def = REPORTS[req.params.key];
  if (!def) throw bad('Unknown report');
  const w = new Where();
  if (def.siteAlias) siteFilters(req, w, def.siteAlias);
  else if (req.user.siteIds !== null) throw bad('This report is not available for your role');
  if (def.dateCol) {
    const { from, to } = range(req);
    w.add(`${def.dateCol} BETWEEN ? AND ?`, from, to);
  }
  if (req.query.item_id && def.itemCol) w.add(`${def.itemCol} = ?`, num(req.query.item_id));
  if (req.query.vendor_id && def.vendorCol) w.add(`${def.vendorCol} = ?`, num(req.query.vendor_id));
  if (req.query.category && def.categoryCol) w.add(`${def.categoryCol}::text = ?`, String(req.query.category));
  const base = def.sql.replace('{where}', w.parts.length ? w.sql : 'WHERE TRUE');

  const groupBy = String(req.query.group_by ?? def.dims[0]).split(',').filter((g) => def.dims.includes(g));
  if (!groupBy.length) groupBy.push(def.dims[0]);
  const dimSql = groupBy.map((g) => (g === 'month' ? `to_char(d,'YYYY-MM') AS month` : g === 'd' ? `to_char(d,'YYYY-MM-DD') AS date` : g));
  if (groupBy.includes('item')) dimSql.push('MAX(uom) AS uom');
  const meas = Object.entries(def.measures).map(([k, v]) => `${v} AS ${k}`);
  const rows = await q(
    `SELECT ${[...dimSql, ...meas].join(', ')} FROM (${base}) z GROUP BY ${groupBy.map((_, i) => i + 1).join(',')}
     ORDER BY ${groupBy.map((_, i) => i + 1).join(',')} LIMIT 5000`, w.params);
  res.json({ key: req.params.key, label: def.label, group_by: groupBy, measures: Object.keys(def.measures), rows });
});

export default r;
