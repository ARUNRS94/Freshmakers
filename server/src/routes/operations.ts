import { Router } from 'express';
import type { PoolClient } from 'pg';
import { q, one, tx, Where, nextDocNo, setting } from '../lib/db.js';
import { need, assertSite, canAccessSite, siteFilters, type Role, type AuthUser } from '../lib/auth.js';
import { bad, forbidden, notFound, date, num, must, today, addDays, lines } from '../lib/http.js';
import { postLedger, stockQty, avgCost, ensureStock, vendorRate, clientRate, refreshIndent, audit } from '../lib/stock.js';

const r = Router();

/* ================================================================ INDENTS */
const RANK: Record<string, number> = { BARISTA: 1, MANAGER: 2, SUPERVISOR: 3, OPS_HEAD: 4, CBO: 5, SCM: 6, ADMIN: 7 };

async function chain(): Promise<Role[]> {
  return setting<Role[]>('indent_approval_chain', ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO']);
}
/** next approval stage strictly above the given rank */
function nextStage(ch: Role[], aboveRank: number): Role | null {
  return ch.find((s) => (RANK[s] ?? 0) > aboveRank) ?? null;
}

async function loadIndent(id: number, user: AuthUser, c?: PoolClient) {
  const ind = await one<any>('SELECT * FROM indents WHERE id=$1' + (c ? ' FOR UPDATE' : ''), [id], c);
  if (!ind) throw notFound('Indent');
  if (!canAccessSite(user, ind.site_id)) throw forbidden('You are not assigned to this site');
  return ind;
}

r.get('/indents', async (req, res) => {
  const w = siteFilters(req, new Where());
  const st = req.query.status as string | undefined;
  if (st === 'OPEN') w.add(`i.status IN ('DRAFT','PENDING','APPROVED','PARTIAL')`);
  else if (st === 'CLOSED') w.add(`i.status IN ('FULFILLED','CLOSED','REJECTED','CANCELLED')`);
  else if (st) w.add('i.status = ?', st);
  if (req.query.from) w.add('i.indent_date >= ?', date(req.query.from));
  if (req.query.to) w.add('i.indent_date <= ?', date(req.query.to));
  if (req.query.required_date) w.add('i.required_date = ?', date(req.query.required_date));
  if (req.query.awaiting_me === 'true') {
    if (req.user.role === 'SCM') w.add(`i.status IN ('APPROVED','PARTIAL')`);
    else if (req.user.role !== 'ADMIN') w.add(`i.status='PENDING' AND i.current_stage = ?`, req.user.role);
    else w.add(`i.status IN ('PENDING','APPROVED','PARTIAL')`);
  }
  res.json(await q(
    `SELECT i.*, s.name site_name, c.name client_name, rg.name region_name, u.name created_by_name,
            COUNT(l.id)::int line_count,
            SUM(COALESCE(l.qty_approved,l.qty_requested)) total_qty,
            SUM(LEAST(l.qty_fulfilled, COALESCE(l.qty_approved,l.qty_requested))) fulfilled_qty,
            (i.required_date < CURRENT_DATE AND i.status IN ('PENDING','APPROVED','PARTIAL')) overdue
     FROM indents i JOIN sites s ON s.id=i.site_id JOIN clients c ON c.id=s.client_id JOIN regions rg ON rg.id=s.region_id
     LEFT JOIN users u ON u.id=i.created_by LEFT JOIN indent_lines l ON l.indent_id=i.id
     ${w.sql} GROUP BY i.id, s.name, c.name, rg.name, u.name
     ORDER BY CASE i.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END, i.required_date, i.id DESC LIMIT 1000`, w.params));
});

r.get('/indents/:id', async (req, res) => {
  const ind = await loadIndent(Number(req.params.id), req.user);
  const [head] = await q(
    `SELECT i.*, s.name site_name, s.client_id, c.name client_name, u.name created_by_name FROM indents i
     JOIN sites s ON s.id=i.site_id JOIN clients c ON c.id=s.client_id LEFT JOIN users u ON u.id=i.created_by WHERE i.id=$1`, [ind.id]);
  const [ls, approvals, dispatches, lps, pos] = await Promise.all([
    q(`SELECT l.*, it.code item_code, it.name item_name, it.uom, it.category, it.min_order_qty,
              COALESCE((SELECT SUM(qty) FROM stock_ledger x WHERE x.site_id=$2 AND x.item_id=l.item_id),0) site_stock,
              COALESCE((SELECT SUM(qty) FROM stock_ledger x WHERE x.warehouse_id IS NOT NULL AND x.item_id=l.item_id),0) wh_stock
       FROM indent_lines l JOIN items it ON it.id=l.item_id WHERE l.indent_id=$1 ORDER BY it.category, it.name`, [ind.id, ind.site_id]),
    q(`SELECT a.*, u.name user_name FROM indent_approvals a LEFT JOIN users u ON u.id=a.user_id WHERE indent_id=$1 ORDER BY acted_at`, [ind.id]),
    q(`SELECT id, dispatch_no, dispatch_date, status FROM dispatches WHERE indent_id=$1 ORDER BY id`, [ind.id]),
    q(`SELECT id, lp_no, purchase_date FROM local_purchases WHERE indent_id=$1 ORDER BY id`, [ind.id]),
    q(`SELECT id, po_no, po_date, status FROM purchase_orders WHERE indent_id=$1 ORDER BY id`, [ind.id]),
  ]);
  const ch = await chain();
  const canApprove = ind.status === 'PENDING' && (req.user.role === 'ADMIN' || req.user.role === ind.current_stage);
  const canFulfil = ['APPROVED', 'PARTIAL'].includes(ind.status) && ['SCM', 'ADMIN'].includes(req.user.role);
  res.json({ ...head, lines: ls, approvals, dispatches, local_purchases: lps, purchase_orders: pos, chain: ch,
    permissions: { canApprove, canFulfil } });
});

async function validateIndentLines(c: PoolClient, ls: any[]) {
  const seen = new Set<number>();
  for (const l of ls) {
    if (!l.item_id || !(Number(l.qty_requested) > 0)) throw bad('Each line needs an item and a quantity greater than 0');
    if (seen.has(Number(l.item_id))) throw bad('An item appears twice in the indent');
    seen.add(Number(l.item_id));
  }
}

async function submitIndent(c: PoolClient, ind: any, user: AuthUser) {
  const ch = await chain();
  const stage = nextStage(ch, RANK[user.role] ?? 0);
  await c.query(`UPDATE indents SET status=$2, current_stage=$3 WHERE id=$1`, [ind.id, stage ? 'PENDING' : 'APPROVED', stage]);
  await c.query(`INSERT INTO indent_approvals(indent_id,stage,action,user_id) VALUES ($1,$2,'SUBMIT',$3)`, [ind.id, user.role, user.id]);
}

r.post('/indents', need('indents'), async (req, res) => {
  const siteId = must(num(req.body.site_id), 'Site');
  assertSite(req.user, siteId);
  const reqDate = must(date(req.body.required_date), 'Required date');
  if (reqDate < today()) throw bad('Required date cannot be in the past');
  const ls = lines<any>(req.body.lines);
  const id = await tx(async (c) => {
    await validateIndentLines(c, ls);
    const no = await nextDocNo('IND', c);
    const ind = await one<any>(
      `INSERT INTO indents(indent_no,site_id,required_date,priority,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [no, siteId, reqDate, req.body.priority ?? 'NORMAL', req.body.notes ?? null, req.user.id], c);
    for (const l of ls) {
      const stock = await stockQty(c, { site_id: siteId }, l.item_id);
      await c.query(`INSERT INTO indent_lines(indent_id,item_id,qty_requested,stock_at_request,remarks) VALUES ($1,$2,$3,$4,$5)`,
        [ind.id, l.item_id, l.qty_requested, stock, l.remarks ?? null]);
    }
    if (req.body.submit !== false) await submitIndent(c, ind, req.user);
    return ind.id;
  });
  res.status(201).json({ id });
});

r.put('/indents/:id', async (req, res) => {
  await tx(async (c) => {
    const ind = await loadIndent(Number(req.params.id), req.user, c);
    if (ind.status !== 'DRAFT') throw bad('Only draft indents can be edited');
    const reqDate = must(date(req.body.required_date), 'Required date');
    if (reqDate < today()) throw bad('Required date cannot be in the past');
    const ls = lines<any>(req.body.lines);
    await validateIndentLines(c, ls);
    await c.query('UPDATE indents SET required_date=$2, priority=$3, notes=$4 WHERE id=$1',
      [ind.id, reqDate, req.body.priority ?? 'NORMAL', req.body.notes ?? null]);
    await c.query('DELETE FROM indent_lines WHERE indent_id=$1', [ind.id]);
    for (const l of ls) {
      const stock = await stockQty(c, { site_id: ind.site_id }, l.item_id);
      await c.query(`INSERT INTO indent_lines(indent_id,item_id,qty_requested,stock_at_request,remarks) VALUES ($1,$2,$3,$4,$5)`,
        [ind.id, l.item_id, l.qty_requested, stock, l.remarks ?? null]);
    }
    if (req.body.submit) await submitIndent(c, ind, req.user);
  });
  res.json({ ok: true });
});

r.post('/indents/:id/:action', async (req, res) => {
  const action = req.params.action;
  const comment = req.body?.comment ?? null;
  await tx(async (c) => {
    const ind = await loadIndent(Number(req.params.id), req.user, c);
    const u = req.user;
    const log = (act: string, stage: string) =>
      c.query('INSERT INTO indent_approvals(indent_id,stage,action,comment,user_id) VALUES ($1,$2,$3,$4,$5)', [ind.id, stage, act, comment, u.id]);

    switch (action) {
      case 'submit':
        if (ind.status !== 'DRAFT') throw bad('Indent already submitted');
        await submitIndent(c, ind, u);
        break;
      case 'approve':
      case 'reject':
      case 'send-back': {
        if (ind.status !== 'PENDING') throw bad('Indent is not awaiting approval');
        if (u.role !== 'ADMIN' && u.role !== ind.current_stage) throw forbidden(`Awaiting ${ind.current_stage} approval`);
        if (action === 'reject') {
          if (!comment) throw bad('Please give a reason for rejection');
          await c.query(`UPDATE indents SET status='REJECTED', current_stage=NULL, closed_at=now() WHERE id=$1`, [ind.id]);
          await log('REJECT', ind.current_stage);
          break;
        }
        if (action === 'send-back') {
          await c.query(`UPDATE indents SET status='DRAFT', current_stage=NULL WHERE id=$1`, [ind.id]);
          await log('SEND_BACK', ind.current_stage);
          break;
        }
        for (const l of req.body?.lines ?? []) {
          if (l.qty_approved == null || l.qty_approved === '') continue;
          if (Number(l.qty_approved) < 0) throw bad('Approved quantity cannot be negative');
          await c.query('UPDATE indent_lines SET qty_approved=$3 WHERE id=$1 AND indent_id=$2', [l.id, ind.id, l.qty_approved]);
        }
        const ch = await chain();
        const stage = nextStage(ch, RANK[ind.current_stage] ?? 0);
        await c.query(`UPDATE indents SET status=$2, current_stage=$3 WHERE id=$1`, [ind.id, stage ? 'PENDING' : 'APPROVED', stage]);
        await log('APPROVE', ind.current_stage);
        break;
      }
      case 'cancel':
        if (!['DRAFT', 'PENDING', 'APPROVED'].includes(ind.status)) throw bad('Only unfulfilled indents can be cancelled');
        if (u.role !== 'ADMIN' && ind.created_by !== u.id && (RANK[u.role] ?? 0) < 3) throw forbidden();
        await c.query(`UPDATE indents SET status='CANCELLED', current_stage=NULL, closed_at=now() WHERE id=$1`, [ind.id]);
        await log('CANCEL', u.role);
        break;
      case 'close':
        if (!['APPROVED', 'PARTIAL', 'FULFILLED'].includes(ind.status)) throw bad('Indent cannot be closed in its current status');
        if (!['ADMIN', 'SCM', 'OPS_HEAD'].includes(u.role)) throw forbidden();
        await c.query(`UPDATE indents SET status='CLOSED', closed_at=now() WHERE id=$1`, [ind.id]);
        await log('CLOSE', u.role);
        break;
      default:
        throw notFound('Action');
    }
    await audit(c, u.id, action.toUpperCase(), 'indents', ind.id, { comment });
  });
  res.json({ ok: true });
});

/* ======================================================== PURCHASE ORDERS */
function vendorScope(req: any, w: Where, col = 'p.vendor_id') {
  if (req.user.role === 'VENDOR') w.add(`${col} = ?`, req.user.vendor_id ?? -1);
}

r.get('/purchase-orders', async (req, res) => {
  const w = new Where();
  vendorScope(req, w);
  const st = req.query.status as string | undefined;
  if (st === 'OPEN') w.add(`p.status IN ('OPEN','PARTIAL')`);
  else if (st) w.add('p.status = ?', st);
  if (req.query.vendor_id) w.add('p.vendor_id = ?', num(req.query.vendor_id));
  if (req.query.from) w.add('p.po_date >= ?', date(req.query.from));
  if (req.query.to) w.add('p.po_date <= ?', date(req.query.to));
  res.json(await q(
    `SELECT p.*, v.name vendor_name, COALESCE(wh.name, s.name) deliver_to, i.indent_no,
            SUM(l.qty_ordered*l.rate) order_value, SUM(l.qty_received*l.rate) received_value,
            SUM(l.qty_ordered) qty_ordered, SUM(l.qty_received) qty_received
     FROM purchase_orders p JOIN vendors v ON v.id=p.vendor_id LEFT JOIN warehouses wh ON wh.id=p.warehouse_id
     LEFT JOIN sites s ON s.id=p.site_id LEFT JOIN indents i ON i.id=p.indent_id LEFT JOIN po_lines l ON l.po_id=p.id
     ${w.sql} GROUP BY p.id, v.name, wh.name, s.name, i.indent_no ORDER BY p.po_date DESC, p.id DESC LIMIT 1000`, w.params));
});

r.get('/purchase-orders/:id', async (req, res) => {
  const w = new Where();
  w.add('p.id = ?', Number(req.params.id));
  vendorScope(req, w);
  const head = await one(
    `SELECT p.*, v.name vendor_name, v.payment_terms_days, v.payment_terms_text, COALESCE(wh.name, s.name) deliver_to, i.indent_no
     FROM purchase_orders p JOIN vendors v ON v.id=p.vendor_id LEFT JOIN warehouses wh ON wh.id=p.warehouse_id
     LEFT JOIN sites s ON s.id=p.site_id LEFT JOIN indents i ON i.id=p.indent_id ${w.sql}`, w.params);
  if (!head) throw notFound('Purchase order');
  const [ls, grns] = await Promise.all([
    q(`SELECT l.*, i.code item_code, i.name item_name, i.uom FROM po_lines l JOIN items i ON i.id=l.item_id WHERE po_id=$1 ORDER BY l.id`, [req.params.id]),
    q(`SELECT g.*, u.name created_by_name,
          (SELECT json_agg(json_build_object('item_name', i.name, 'qty_received', gl.qty_received, 'qty_rejected', gl.qty_rejected, 'rate', gl.rate))
           FROM grn_lines gl JOIN items i ON i.id=gl.item_id WHERE gl.grn_id=g.id) lines
       FROM grns g LEFT JOIN users u ON u.id=g.created_by WHERE po_id=$1 ORDER BY g.id`, [req.params.id]),
  ]);
  res.json({ ...head, lines: ls, grns });
});

/** Price + MOQ hints for building a PO */
r.get('/purchase-orders-helper/rates', async (req, res) => {
  const vendorId = must(num(req.query.vendor_id), 'vendor_id');
  res.json(await q(
    `SELECT i.id item_id, i.name, i.uom, i.min_order_qty item_moq, i.gst_rate, r.rate, r.min_order_qty vendor_moq, i.std_purchase_rate
     FROM items i LEFT JOIN LATERAL (SELECT rate, min_order_qty FROM vendor_item_rates v WHERE v.vendor_id=$1 AND v.item_id=i.id
       AND v.effective_from<=CURRENT_DATE ORDER BY effective_from DESC LIMIT 1) r ON TRUE WHERE i.active ORDER BY i.name`, [vendorId]));
});

r.post('/purchase-orders', need('purchase_orders'), async (req, res) => {
  const vendorId = must(num(req.body.vendor_id), 'Vendor');
  const whId = num(req.body.warehouse_id) ?? null;
  const siteId = num(req.body.site_id) ?? null;
  if (!whId === !siteId) throw bad('Choose a warehouse or a site to deliver to');
  const ls = lines<any>(req.body.lines);
  const poDate = date(req.body.po_date) ?? today();
  const result = await tx(async (c) => {
    const warnings: string[] = [];
    const prepared = [];
    for (const l of ls) {
      const qty = Number(l.qty_ordered);
      if (!l.item_id || !(qty > 0)) throw bad('Each line needs an item and a quantity greater than 0');
      const item = await one<any>('SELECT name, uom, min_order_qty, gst_rate, std_purchase_rate FROM items WHERE id=$1', [l.item_id], c);
      if (!item) throw bad('Unknown item');
      const vr = await vendorRate(c, vendorId, l.item_id, poDate);
      const rate = l.rate !== undefined && l.rate !== '' ? Number(l.rate) : vr?.rate ?? item.std_purchase_rate;
      if (!(rate >= 0)) throw bad('Invalid rate');
      const moq = Math.max(item.min_order_qty ?? 0, vr?.min_order_qty ?? 0);
      if (moq && qty < moq) warnings.push(`${item.name}: ordered ${qty} ${item.uom} is below the minimum order quantity of ${moq}`);
      if (vr && Math.abs(rate - vr.rate) > 0.001) warnings.push(`${item.name}: rate ${rate} differs from the agreed rate ${vr.rate}`);
      prepared.push({ item_id: l.item_id, qty, rate, gst: item.gst_rate });
    }
    if (warnings.length && !req.body.override_warnings) throw bad('Please review the warnings below', { warnings, needs_override: true });
    const no = await nextDocNo('PO', c);
    const v = await one<any>('SELECT lead_time_days FROM vendors WHERE id=$1', [vendorId], c);
    if (!v) throw bad('Unknown vendor');
    const po = await one<any>(
      `INSERT INTO purchase_orders(po_no,vendor_id,po_date,expected_date,warehouse_id,site_id,indent_id,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [no, vendorId, poDate, date(req.body.expected_date) ?? addDays(poDate, v.lead_time_days ?? 2), whId, siteId,
        num(req.body.indent_id) ?? null, req.body.notes ?? null, req.user.id], c);
    for (const p of prepared)
      await c.query('INSERT INTO po_lines(po_id,item_id,qty_ordered,rate,gst_rate) VALUES ($1,$2,$3,$4,$5)', [po.id, p.item_id, p.qty, p.rate, p.gst]);
    if (warnings.length) await audit(c, req.user.id, 'PO_OVERRIDE', 'purchase_orders', po.id, { warnings });
    return { id: po.id, warnings };
  });
  res.status(201).json(result);
});

r.post('/purchase-orders/:id/ack', need('po_ack'), async (req, res) => {
  const w = new Where();
  w.add('id = ?', Number(req.params.id));
  if (req.user.role === 'VENDOR') w.add('vendor_id = ?', req.user.vendor_id ?? -1);
  const row = await one(`UPDATE purchase_orders SET vendor_ack=TRUE ${w.sql} RETURNING id`, w.params);
  if (!row) throw notFound('Purchase order');
  res.json({ ok: true });
});

for (const action of ['cancel', 'close'] as const) {
  r.post(`/purchase-orders/:id/${action}`, need('purchase_orders'), async (req, res) => {
    const po = await one<any>('SELECT * FROM purchase_orders WHERE id=$1', [req.params.id]);
    if (!po) throw notFound('Purchase order');
    if (action === 'cancel') {
      if (po.status !== 'OPEN') throw bad('Only POs with no receipts can be cancelled');
      await q(`UPDATE purchase_orders SET status='CANCELLED' WHERE id=$1`, [po.id]);
    } else {
      if (!['OPEN', 'PARTIAL'].includes(po.status)) throw bad('PO is already closed');
      await q(`UPDATE purchase_orders SET status='CLOSED' WHERE id=$1`, [po.id]);
    }
    res.json({ ok: true });
  });
}

/** Goods receipt against a PO: stock in, PO progress, vendor bill */
r.post('/purchase-orders/:id/grn', need('grn'), async (req, res) => {
  const ls = lines<any>(req.body.lines);
  const grnDate = date(req.body.grn_date) ?? today();
  const out = await tx(async (c) => {
    const po = await one<any>('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id], c);
    if (!po) throw notFound('Purchase order');
    if (!['OPEN', 'PARTIAL'].includes(po.status)) throw bad('This PO is not open for receiving');
    if (po.site_id) assertSite(req.user, po.site_id);
    else if (!['SCM', 'ADMIN'].includes(req.user.role)) throw forbidden('Only SCM can receive into the warehouse');
    const no = await nextDocNo('GRN', c);
    const g = await one<any>('INSERT INTO grns(grn_no,po_id,grn_date,vendor_invoice_no,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [no, po.id, grnDate, req.body.vendor_invoice_no ?? null, req.body.notes ?? null, req.user.id], c);
    const billLines: any[] = [];
    let tax = 0;
    for (const l of ls) {
      const accepted = Number(l.qty_received ?? 0);
      const rejected = Number(l.qty_rejected ?? 0);
      if (accepted < 0 || rejected < 0) throw bad('Quantities cannot be negative');
      if (!accepted && !rejected) continue;
      const pl = await one<any>('SELECT * FROM po_lines WHERE id=$1 AND po_id=$2', [l.po_line_id, po.id], c);
      if (!pl) throw bad('PO line not found');
      const pending = pl.qty_ordered - pl.qty_received;
      if (accepted > pending * 1.1 + 1e-9) throw bad(`Received quantity exceeds pending quantity (${pending}) by more than 10%`);
      await c.query(`INSERT INTO grn_lines(grn_id,po_line_id,item_id,qty_received,qty_rejected,rate,batch_no,expiry_date)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [g.id, pl.id, pl.item_id, accepted, rejected, pl.rate, l.batch_no || null, l.expiry_date || null]);
      await c.query('UPDATE po_lines SET qty_received = qty_received + $2 WHERE id=$1', [pl.id, accepted]);
      await postLedger(c, [{ warehouse_id: po.warehouse_id, site_id: po.site_id, txn_date: grnDate, item_id: pl.item_id, qty: accepted,
        rate: pl.rate, txn_type: 'GRN', ref_type: 'GRN', ref_id: g.id, created_by: req.user.id }]);
      if (accepted > 0) {
        const amt = Math.round(accepted * pl.rate * 100) / 100;
        billLines.push({ item_id: pl.item_id, qty: accepted, rate: pl.rate, amount: amt });
        tax += (amt * (pl.gst_rate ?? 0)) / 100;
      }
    }
    if (!billLines.length) throw bad('Enter at least one received quantity');
    const agg = await one<any>('SELECT SUM(qty_ordered) o, SUM(qty_received) r FROM po_lines WHERE po_id=$1', [po.id], c);
    await c.query('UPDATE purchase_orders SET status=$2 WHERE id=$1', [po.id, agg.r >= agg.o - 1e-9 ? 'RECEIVED' : 'PARTIAL']);
    const v = await one<any>('SELECT payment_terms_days FROM vendors WHERE id=$1', [po.vendor_id], c);
    const amount = billLines.reduce((s, x) => s + x.amount, 0);
    const bill = await one<any>(
      `INSERT INTO vendor_bills(bill_no,vendor_id,bill_date,due_date,grn_id,amount,tax_amount) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.body.vendor_invoice_no || no, po.vendor_id, grnDate, addDays(grnDate, v?.payment_terms_days ?? 30), g.id, amount, Math.round(tax * 100) / 100], c);
    for (const b of billLines)
      await c.query('INSERT INTO vendor_bill_lines(bill_id,item_id,qty,rate,amount) VALUES ($1,$2,$3,$4,$5)', [bill.id, b.item_id, b.qty, b.rate, b.amount]);
    if (po.indent_id) await refreshIndent(c, po.indent_id);
    return { id: g.id, grn_no: no, bill_id: bill.id };
  });
  res.status(201).json(out);
});

/* ========================================================= LOCAL PURCHASE */
r.get('/local-purchases', async (req, res) => {
  const w = new Where();
  if (req.user.siteIds !== null) w.add('lp.site_id = ANY(?)', req.user.siteIds);
  if (req.query.site_id) w.add('lp.site_id = ?', num(req.query.site_id));
  if (req.query.region_id) w.add('s.region_id = ?', num(req.query.region_id));
  if (req.query.client_id) w.add('s.client_id = ?', num(req.query.client_id));
  if (req.query.from) w.add('lp.purchase_date >= ?', date(req.query.from));
  if (req.query.to) w.add('lp.purchase_date <= ?', date(req.query.to));
  res.json(await q(
    `SELECT lp.*, v.name vendor_name, COALESCE(s.name, wh.name) location_name, c.name client_name, i.indent_no, u.name created_by_name,
            (SELECT SUM(qty*rate) FROM local_purchase_lines WHERE lp_id=lp.id) amount,
            (SELECT json_agg(json_build_object('item_name', it.name, 'qty', l.qty, 'rate', l.rate, 'uom', it.uom))
               FROM local_purchase_lines l JOIN items it ON it.id=l.item_id WHERE l.lp_id=lp.id) lines
     FROM local_purchases lp JOIN vendors v ON v.id=lp.vendor_id LEFT JOIN sites s ON s.id=lp.site_id
     LEFT JOIN clients c ON c.id=s.client_id LEFT JOIN warehouses wh ON wh.id=lp.warehouse_id
     LEFT JOIN indents i ON i.id=lp.indent_id LEFT JOIN users u ON u.id=lp.created_by
     ${w.sql} ORDER BY lp.purchase_date DESC, lp.id DESC LIMIT 1000`, w.params));
});

r.post('/local-purchases', need('local_purchases'), async (req, res) => {
  const vendorId = must(num(req.body.vendor_id), 'Vendor / shop');
  const siteId = num(req.body.site_id) ?? null;
  const whId = num(req.body.warehouse_id) ?? null;
  if (!siteId === !whId) throw bad('Choose a site or warehouse');
  if (siteId) assertSite(req.user, siteId);
  const d = date(req.body.purchase_date) ?? today();
  if (d > today()) throw bad('Purchase date cannot be in the future');
  const ls = lines<any>(req.body.lines);
  const mode = req.body.payment_mode ?? 'CASH';
  const id = await tx(async (c) => {
    const no = await nextDocNo('LP', c);
    const indentId = num(req.body.indent_id) ?? null;
    const lp = await one<any>(
      `INSERT INTO local_purchases(lp_no,purchase_date,vendor_id,site_id,warehouse_id,indent_id,reason,bill_no,payment_mode,purchased_by,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [no, d, vendorId, siteId, whId, indentId, req.body.reason ?? 'SHORTAGE', req.body.bill_no ?? null, mode,
        req.body.purchased_by ?? req.user.name, req.body.notes ?? null, req.user.id], c);
    let amount = 0;
    const billLines = [];
    for (const l of ls) {
      const qty = Number(l.qty);
      const rate = Number(l.rate);
      if (!l.item_id || !(qty > 0) || !(rate >= 0)) throw bad('Each line needs an item, quantity and rate');
      await c.query('INSERT INTO local_purchase_lines(lp_id,item_id,qty,rate) VALUES ($1,$2,$3,$4)', [lp.id, l.item_id, qty, rate]);
      await postLedger(c, [{ site_id: siteId, warehouse_id: whId, txn_date: d, item_id: l.item_id, qty, rate, txn_type: 'LOCAL_PURCHASE',
        ref_type: 'LOCAL_PURCHASE', ref_id: lp.id, created_by: req.user.id }]);
      const amt = Math.round(qty * rate * 100) / 100;
      amount += amt;
      billLines.push({ item_id: l.item_id, qty, rate, amt });
    }
    const v = await one<any>('SELECT payment_terms_days FROM vendors WHERE id=$1', [vendorId], c);
    const bill = await one<any>(
      `INSERT INTO vendor_bills(bill_no,vendor_id,bill_date,due_date,lp_id,amount) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.body.bill_no || no, vendorId, d, mode === 'CREDIT' ? addDays(d, v?.payment_terms_days ?? 0) : d, lp.id, amount], c);
    for (const b of billLines)
      await c.query('INSERT INTO vendor_bill_lines(bill_id,item_id,qty,rate,amount) VALUES ($1,$2,$3,$4,$5)', [bill.id, b.item_id, b.qty, b.rate, b.amt]);
    if (mode !== 'CREDIT' && amount > 0)
      await c.query(`INSERT INTO vendor_payments(vendor_id,bill_id,pay_date,amount,mode,reference,notes,created_by)
                     VALUES ($1,$2,$3,$4,$5,$6,'Paid at purchase',$7)`, [vendorId, bill.id, d, amount, mode, no, req.user.id]);
    if (indentId) await refreshIndent(c, indentId);
    return lp.id;
  });
  res.status(201).json({ id });
});

/* =============================================================== DISPATCH */
r.get('/dispatches', async (req, res) => {
  const w = siteFilters(req, new Where());
  if (req.query.status) w.add('d.status = ?', req.query.status);
  if (req.query.from) w.add('d.dispatch_date >= ?', date(req.query.from));
  if (req.query.to) w.add('d.dispatch_date <= ?', date(req.query.to));
  res.json(await q(
    `SELECT d.*, s.name site_name, c.name client_name, wh.name warehouse_name, i.indent_no,
            SUM(l.qty_dispatched) qty_dispatched, SUM(l.qty_received) qty_received,
            SUM(l.qty_dispatched*l.sale_rate) sale_value, SUM(l.qty_dispatched*l.cost_rate) cost_value
     FROM dispatches d JOIN sites s ON s.id=d.site_id JOIN clients c ON c.id=s.client_id JOIN warehouses wh ON wh.id=d.warehouse_id
     LEFT JOIN indents i ON i.id=d.indent_id LEFT JOIN dispatch_lines l ON l.dispatch_id=d.id
     ${w.sql} GROUP BY d.id, s.name, c.name, wh.name, i.indent_no ORDER BY d.dispatch_date DESC, d.id DESC LIMIT 1000`, w.params));
});

r.get('/dispatches/:id', async (req, res) => {
  const d = await one<any>(
    `SELECT d.*, s.name site_name, c.name client_name, wh.name warehouse_name, i.indent_no, u.name received_by_name
     FROM dispatches d JOIN sites s ON s.id=d.site_id JOIN clients c ON c.id=s.client_id JOIN warehouses wh ON wh.id=d.warehouse_id
     LEFT JOIN indents i ON i.id=d.indent_id LEFT JOIN users u ON u.id=d.received_by WHERE d.id=$1`, [req.params.id]);
  if (!d) throw notFound('Dispatch');
  assertSite(req.user, d.site_id);
  const ls = await q(`SELECT l.*, i.code item_code, i.name item_name, i.uom FROM dispatch_lines l JOIN items i ON i.id=l.item_id
                      WHERE dispatch_id=$1 ORDER BY l.id`, [d.id]);
  res.json({ ...d, lines: ls });
});

r.post('/dispatches', need('dispatches'), async (req, res) => {
  const whId = must(num(req.body.warehouse_id), 'Warehouse');
  const siteId = must(num(req.body.site_id), 'Site');
  const d = date(req.body.dispatch_date) ?? today();
  const ls = lines<any>(req.body.lines);
  const id = await tx(async (c) => {
    const site = await one<any>('SELECT client_id FROM sites WHERE id=$1', [siteId], c);
    if (!site) throw bad('Unknown site');
    const indentId = num(req.body.indent_id) ?? null;
    if (indentId) {
      const ind = await one<any>('SELECT site_id, status FROM indents WHERE id=$1 FOR UPDATE', [indentId], c);
      if (!ind || ind.site_id !== siteId) throw bad('Indent does not belong to this site');
      if (!['APPROVED', 'PARTIAL'].includes(ind.status)) throw bad('Indent is not approved for fulfilment');
    }
    const no = await nextDocNo('DSP', c);
    const disp = await one<any>(
      `INSERT INTO dispatches(dispatch_no,dispatch_date,warehouse_id,site_id,indent_id,vehicle_no,driver_name,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [no, d, whId, siteId, indentId, req.body.vehicle_no ?? null, req.body.driver_name ?? null, req.body.notes ?? null, req.user.id], c);
    let count = 0;
    for (const l of ls) {
      const qty = Number(l.qty_dispatched);
      if (!qty) continue;
      if (!(qty > 0)) throw bad('Dispatch quantity must be greater than 0');
      await ensureStock(c, { warehouse_id: whId }, l.item_id, qty, 'warehouse');
      const cost = await avgCost(c, { warehouse_id: whId }, l.item_id);
      const sale = l.sale_rate !== undefined && l.sale_rate !== '' ? Number(l.sale_rate) : await clientRate(c, site.client_id, l.item_id, d);
      await c.query(`INSERT INTO dispatch_lines(dispatch_id,item_id,indent_line_id,qty_dispatched,cost_rate,sale_rate) VALUES ($1,$2,$3,$4,$5,$6)`,
        [disp.id, l.item_id, l.indent_line_id ?? null, qty, cost, sale]);
      await postLedger(c, [{ warehouse_id: whId, txn_date: d, item_id: l.item_id, qty: -qty, rate: cost, txn_type: 'DISPATCH_OUT',
        ref_type: 'DISPATCH', ref_id: disp.id, created_by: req.user.id }]);
      count++;
    }
    if (!count) throw bad('Enter at least one dispatch quantity');
    if (indentId) await refreshIndent(c, indentId);
    return disp.id;
  });
  res.status(201).json({ id });
});

r.post('/dispatches/:id/receive', need('dispatch_receive'), async (req, res) => {
  const out = await tx(async (c) => {
    const d = await one<any>('SELECT d.*, s.client_id FROM dispatches d JOIN sites s ON s.id=d.site_id WHERE d.id=$1 FOR UPDATE OF d', [req.params.id], c);
    if (!d) throw notFound('Dispatch');
    assertSite(req.user, d.site_id);
    if (d.status !== 'IN_TRANSIT') throw bad('Dispatch already received or cancelled');
    const recvDate = date(req.body.received_date) ?? today();
    const given = new Map<number, number>((req.body.lines ?? []).map((l: any) => [Number(l.id), Number(l.qty_received)]));
    const ls = await q<any>('SELECT * FROM dispatch_lines WHERE dispatch_id=$1', [d.id], c);
    const invLines: any[] = [];
    let tax = 0;
    for (const l of ls) {
      const recv = given.has(l.id) ? given.get(l.id)! : l.qty_dispatched;
      if (!(recv >= 0) || recv > l.qty_dispatched + 1e-9) throw bad('Received quantity must be between 0 and the dispatched quantity');
      await c.query('UPDATE dispatch_lines SET qty_received=$2 WHERE id=$1', [l.id, recv]);
      await postLedger(c, [{ site_id: d.site_id, txn_date: recvDate, item_id: l.item_id, qty: recv, rate: l.cost_rate, txn_type: 'DISPATCH_IN',
        ref_type: 'DISPATCH', ref_id: d.id, created_by: req.user.id }]);
      if (recv > 0) {
        const amt = Math.round(recv * l.sale_rate * 100) / 100;
        const gst = await one<any>('SELECT gst_rate FROM items WHERE id=$1', [l.item_id], c);
        tax += (amt * (gst?.gst_rate ?? 0)) / 100;
        invLines.push({ item_id: l.item_id, qty: recv, rate: l.sale_rate, amount: amt });
      }
    }
    await c.query(`UPDATE dispatches SET status='RECEIVED', received_date=$2, received_by=$3 WHERE id=$1`, [d.id, recvDate, req.user.id]);
    let invoiceId: number | null = null;
    const amount = invLines.reduce((s, x) => s + x.amount, 0);
    if (amount > 0) {
      const cl = await one<any>('SELECT payment_terms_days FROM clients WHERE id=$1', [d.client_id], c);
      const no = await nextDocNo('INV', c);
      const inv = await one<any>(
        `INSERT INTO client_invoices(invoice_no,client_id,site_id,dispatch_id,invoice_date,due_date,amount,tax_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [no, d.client_id, d.site_id, d.id, recvDate, addDays(recvDate, cl?.payment_terms_days ?? 30), amount, Math.round(tax * 100) / 100], c);
      for (const x of invLines)
        await c.query('INSERT INTO client_invoice_lines(invoice_id,item_id,qty,rate,amount) VALUES ($1,$2,$3,$4,$5)', [inv.id, x.item_id, x.qty, x.rate, x.amount]);
      invoiceId = inv.id;
    }
    return { invoice_id: invoiceId };
  });
  res.json({ ok: true, ...out });
});

r.post('/dispatches/:id/cancel', need('dispatches'), async (req, res) => {
  await tx(async (c) => {
    const d = await one<any>('SELECT * FROM dispatches WHERE id=$1 FOR UPDATE', [req.params.id], c);
    if (!d) throw notFound('Dispatch');
    if (d.status !== 'IN_TRANSIT') throw bad('Only in-transit dispatches can be cancelled');
    await c.query(`DELETE FROM stock_ledger WHERE ref_type='DISPATCH' AND ref_id=$1`, [d.id]);
    await c.query(`UPDATE dispatches SET status='CANCELLED' WHERE id=$1`, [d.id]);
    if (d.indent_id) await refreshIndent(c, d.indent_id);
    await audit(c, req.user.id, 'CANCEL', 'dispatches', d.id);
  });
  res.json({ ok: true });
});

export default r;
