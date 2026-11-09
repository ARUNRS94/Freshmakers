import { Router } from 'express';
import { q, one, tx, Where, nextDocNo, setting } from '../lib/db.js';
import { need, assertSite, siteFilters } from '../lib/auth.js';
import { bad, date, num, must, today, addDays, lines } from '../lib/http.js';
import { postLedger, stockQty, avgCost, ensureStock, audit, type Loc } from '../lib/stock.js';

const r = Router();

/* ------------------------------------------------------------------ stock */
r.get('/stock', async (req, res) => {
  const location = req.query.location === 'warehouse' ? 'warehouse' : 'site';
  const lookback = Number(await setting('planner_lookback_days', 7));
  if (location === 'warehouse') {
    const w = new Where();
    if (req.query.warehouse_id) w.add('w.id = ?', num(req.query.warehouse_id));
    if (req.query.category) w.add('i.category = ?', req.query.category);
    if (req.user.siteIds !== null && req.user.role !== 'SCM') w.add('FALSE');
    const rows = await q(
      `SELECT w.id warehouse_id, w.name warehouse_name, i.id item_id, i.code item_code, i.name item_name, i.category, i.uom,
              COALESCE(st.qty,0) qty, COALESCE(st.avg_rate, i.std_purchase_rate) avg_rate,
              COALESCE(st.qty,0) * COALESCE(st.avg_rate, i.std_purchase_rate) value,
              i.wh_reorder_level reorder_level, i.min_order_qty,
              COALESCE(po.on_order,0) on_order,
              CASE WHEN COALESCE(st.qty,0) <= 0 THEN 'OUT' WHEN COALESCE(st.qty,0) <= i.wh_reorder_level THEN 'LOW' ELSE 'OK' END stock_status
       FROM warehouses w CROSS JOIN items i
       LEFT JOIN v_wh_stock st ON st.warehouse_id=w.id AND st.item_id=i.id
       LEFT JOIN (SELECT p.warehouse_id, l.item_id, SUM(l.qty_ordered-l.qty_received) on_order FROM po_lines l
                  JOIN purchase_orders p ON p.id=l.po_id WHERE p.status IN ('OPEN','PARTIAL') AND p.warehouse_id IS NOT NULL
                  GROUP BY 1,2) po ON po.warehouse_id=w.id AND po.item_id=i.id
       ${w.sql} ${w.parts.length ? 'AND' : 'WHERE'} w.active AND i.active AND i.category <> 'STORE'
       ORDER BY w.name, i.category, i.name`, w.params);
    return res.json(rows);
  }
  const w = siteFilters(req, new Where());
  if (req.query.category) w.add('i.category = ?', req.query.category);
  if (req.query.item_id) w.add('i.id = ?', num(req.query.item_id));
  const lb = w.p(lookback);
  const rows = await q(
    `WITH keys AS (
        SELECT site_id, item_id FROM stock_ledger WHERE site_id IS NOT NULL GROUP BY 1,2
        UNION SELECT site_id, item_id FROM site_item_settings)
     SELECT s.id site_id, s.name site_name, c.name client_name, rg.name region_name,
            i.id item_id, i.code item_code, i.name item_name, i.category, i.uom,
            COALESCE(st.qty,0) qty, COALESCE(st.avg_rate, i.std_purchase_rate) avg_rate,
            COALESCE(st.qty,0) * COALESCE(st.avg_rate, i.std_purchase_rate) value,
            COALESCE(sis.reorder_level, i.reorder_level) reorder_level, sis.max_level,
            COALESCE(tr.in_transit,0) in_transit,
            ROUND(COALESCE(cons.used,0) / ${lb}::numeric, 3) avg_daily_use,
            CASE WHEN COALESCE(cons.used,0) > 0 THEN ROUND(COALESCE(st.qty,0) / (cons.used / ${lb}::numeric), 1) END days_cover,
            CASE WHEN COALESCE(st.qty,0) <= 0 THEN 'OUT'
                 WHEN COALESCE(st.qty,0) <= COALESCE(sis.reorder_level, i.reorder_level) THEN 'LOW' ELSE 'OK' END stock_status
     FROM keys k JOIN sites s ON s.id=k.site_id JOIN clients c ON c.id=s.client_id JOIN regions rg ON rg.id=s.region_id
     JOIN items i ON i.id=k.item_id
     LEFT JOIN v_site_stock st ON st.site_id=k.site_id AND st.item_id=k.item_id
     LEFT JOIN site_item_settings sis ON sis.site_id=k.site_id AND sis.item_id=k.item_id
     LEFT JOIN (SELECT d.site_id, dl.item_id, SUM(dl.qty_dispatched) in_transit FROM dispatch_lines dl JOIN dispatches d ON d.id=dl.dispatch_id
                WHERE d.status='IN_TRANSIT' GROUP BY 1,2) tr ON tr.site_id=k.site_id AND tr.item_id=k.item_id
     LEFT JOIN (SELECT site_id, item_id, SUM(qty_used) used FROM consumption WHERE entry_date > CURRENT_DATE - ${lb}::int
                GROUP BY 1,2) cons ON cons.site_id=k.site_id AND cons.item_id=k.item_id
     ${w.sql}
     ORDER BY c.name, s.name, i.category, i.name`, w.params);
  const status = req.query.stock_status;
  res.json(status ? rows.filter((x: any) => x.stock_status === status || (status === 'ALERT' && x.stock_status !== 'OK')) : rows);
});

r.get('/stock/ledger', async (req, res) => {
  const siteId = num(req.query.site_id);
  const whId = num(req.query.warehouse_id);
  if (!siteId && !whId) throw bad('site_id or warehouse_id is required');
  if (siteId) assertSite(req.user, siteId);
  const w = new Where();
  w.add(siteId ? 'l.site_id = ?' : 'l.warehouse_id = ?', siteId ?? whId);
  if (req.query.item_id) w.add('l.item_id = ?', num(req.query.item_id));
  const from = date(req.query.from);
  const to = date(req.query.to);
  if (from) w.add('l.txn_date >= ?', from);
  if (to) w.add('l.txn_date <= ?', to);
  const rows = await q(
    `SELECT l.id, l.txn_date, l.txn_type, l.ref_type, l.ref_id, l.qty, l.rate, l.notes, i.name item_name, i.uom, u.name created_by_name,
            SUM(l.qty) OVER (PARTITION BY l.item_id ORDER BY l.txn_date, l.id) +
              COALESCE((SELECT SUM(x.qty) FROM stock_ledger x WHERE x.item_id=l.item_id
                AND ${siteId ? 'x.site_id' : 'x.warehouse_id'} = ${siteId ?? whId}
                AND ${from ? `x.txn_date < '${from}'` : 'FALSE'}),0) balance
     FROM stock_ledger l JOIN items i ON i.id=l.item_id LEFT JOIN users u ON u.id=l.created_by
     ${w.sql} ORDER BY l.txn_date DESC, l.id DESC LIMIT 1000`, w.params);
  res.json(rows);
});

/* ------------------------------------------------------------ consumption */
/** Current site stock, ignoring the ledger rows of the consumption entry being edited */
async function availableOn(siteId: number, itemId: number, excludeConsumptionId?: number) {
  const r2 = await one<{ qty: number }>(
    `SELECT COALESCE(SUM(qty),0) qty FROM stock_ledger WHERE site_id=$1 AND item_id=$2
      AND NOT (COALESCE(ref_type,'')='CONSUMPTION' AND ref_id IS NOT DISTINCT FROM $3::int)`,
    [siteId, itemId, excludeConsumptionId ?? -1]);
  return r2!.qty;
}

r.get('/consumption/sheet', async (req, res) => {
  const siteId = must(num(req.query.site_id), 'site_id');
  const d = date(req.query.date) ?? today();
  assertSite(req.user, siteId);
  const all = req.query.all === 'true';
  const rows = await q(
    `SELECT i.id item_id, i.code, i.name, i.category, i.uom,
            COALESCE((SELECT SUM(qty) FROM stock_ledger l WHERE l.site_id=$1 AND l.item_id=i.id
               AND NOT (COALESCE(l.ref_type,'')='CONSUMPTION' AND l.ref_id IS NOT DISTINCT FROM c.id)),0) available,
            c.qty_used, c.qty_wasted, c.cups_served, c.remarks, c.id consumption_id
     FROM items i
     LEFT JOIN consumption c ON c.item_id=i.id AND c.site_id=$1 AND c.entry_date=$2
     WHERE i.active AND (${all ? 'TRUE' : 'FALSE'}
       OR c.id IS NOT NULL
       OR EXISTS (SELECT 1 FROM stock_ledger l WHERE l.site_id=$1 AND l.item_id=i.id)
       OR EXISTS (SELECT 1 FROM site_item_settings s WHERE s.site_id=$1 AND s.item_id=i.id))
     ORDER BY i.category, i.name`, [siteId, d]);
  res.json({ site_id: siteId, date: d, lines: rows });
});

r.post('/consumption', need('consumption'), async (req, res) => {
  const siteId = must(num(req.body.site_id), 'site_id');
  const d = must(date(req.body.entry_date), 'entry_date');
  assertSite(req.user, siteId);
  if (d > today()) throw bad('Consumption cannot be entered for a future date');
  const ls = lines<any>(req.body.lines);
  const saved = await tx(async (c) => {
    let n = 0;
    for (const l of ls) {
      const used = Number(l.qty_used ?? 0);
      const wasted = Number(l.qty_wasted ?? 0);
      if (used < 0 || wasted < 0) throw bad('Quantities cannot be negative');
      const existing = await one<{ id: number }>('SELECT id FROM consumption WHERE site_id=$1 AND entry_date=$2 AND item_id=$3',
        [siteId, d, l.item_id], c);
      if (!used && !wasted && !existing) continue;
      const avail = await availableOn(siteId, l.item_id, existing?.id);
      if (used + wasted > avail + 1e-9) {
        const it = await one<{ name: string; uom: string }>('SELECT name, uom FROM items WHERE id=$1', [l.item_id], c);
        throw bad(`${it?.name}: used + wasted (${used + wasted}) exceeds available stock (${avail} ${it?.uom})`);
      }
      const row = await one<{ id: number }>(
        `INSERT INTO consumption(site_id,entry_date,item_id,qty_used,qty_wasted,cups_served,remarks,entered_by,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
         ON CONFLICT (site_id,entry_date,item_id) DO UPDATE SET qty_used=EXCLUDED.qty_used, qty_wasted=EXCLUDED.qty_wasted,
           cups_served=EXCLUDED.cups_served, remarks=EXCLUDED.remarks, entered_by=EXCLUDED.entered_by, updated_at=now()
         RETURNING id`, [siteId, d, l.item_id, used, wasted, l.cups_served || null, l.remarks || null, req.user.id], c);
      await c.query(`DELETE FROM stock_ledger WHERE ref_type='CONSUMPTION' AND ref_id=$1`, [row!.id]);
      const rate = await avgCost(c, { site_id: siteId }, l.item_id);
      await postLedger(c, [
        { txn_date: d, site_id: siteId, item_id: l.item_id, qty: -used, rate, txn_type: 'CONSUMPTION', ref_type: 'CONSUMPTION', ref_id: row!.id, created_by: req.user.id },
        { txn_date: d, site_id: siteId, item_id: l.item_id, qty: -wasted, rate, txn_type: 'WASTAGE', ref_type: 'CONSUMPTION', ref_id: row!.id, created_by: req.user.id },
      ]);
      n++;
    }
    return n;
  });
  res.json({ ok: true, saved });
});

r.get('/consumption', async (req, res) => {
  const w = siteFilters(req, new Where());
  const from = date(req.query.from) ?? addDays(today(), -30);
  const to = date(req.query.to) ?? today();
  w.add('c.entry_date BETWEEN ? AND ?', from, to);
  if (req.query.item_id) w.add('c.item_id = ?', num(req.query.item_id));
  res.json(await q(
    `SELECT c.*, s.name site_name, cl.name client_name, i.name item_name, i.uom, i.category, u.name entered_by_name
     FROM consumption c JOIN sites s ON s.id=c.site_id JOIN clients cl ON cl.id=s.client_id JOIN items i ON i.id=c.item_id
     LEFT JOIN users u ON u.id=c.entered_by ${w.sql} ORDER BY c.entry_date DESC, s.name, i.name LIMIT 2000`, w.params));
});

/* ---------------------------------------------------------- stock counts */
r.post('/stock-counts', need('stock_counts'), async (req, res) => {
  const loc: Loc = { site_id: num(req.body.site_id) ?? null, warehouse_id: num(req.body.warehouse_id) ?? null };
  if (!loc.site_id === !loc.warehouse_id) throw bad('Choose either a site or a warehouse');
  if (loc.site_id) assertSite(req.user, loc.site_id);
  const d = date(req.body.count_date) ?? today();
  const ls = lines<any>(req.body.lines);
  const id = await tx(async (c) => {
    const sc = await one<{ id: number }>(
      'INSERT INTO stock_counts(count_date,site_id,warehouse_id,notes,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [d, loc.site_id, loc.warehouse_id, req.body.notes ?? null, req.user.id], c);
    for (const l of ls) {
      if (l.counted_qty === '' || l.counted_qty == null) continue;
      const counted = Number(l.counted_qty);
      if (counted < 0) throw bad('Counted quantity cannot be negative');
      const sys = await stockQty(c, loc, l.item_id);
      await c.query('INSERT INTO stock_count_lines(count_id,item_id,system_qty,counted_qty,reason) VALUES ($1,$2,$3,$4,$5)',
        [sc!.id, l.item_id, sys, counted, l.reason ?? null]);
      const diff = Math.round((counted - sys) * 1000) / 1000;
      if (diff !== 0)
        await postLedger(c, [{ ...loc, txn_date: d, item_id: l.item_id, qty: diff, rate: await avgCost(c, loc, l.item_id),
          txn_type: 'ADJUSTMENT', ref_type: 'STOCK_COUNT', ref_id: sc!.id, notes: l.reason, created_by: req.user.id }]);
    }
    await audit(c, req.user.id, 'STOCK_COUNT', 'stock_counts', sc!.id);
    return sc!.id;
  });
  res.status(201).json({ id });
});

r.get('/stock-counts', async (req, res) => {
  const w = new Where();
  if (req.user.siteIds !== null) w.add('sc.site_id = ANY(?)', req.user.siteIds);
  res.json(await q(
    `SELECT sc.*, s.name site_name, wh.name warehouse_name, u.name created_by_name,
            COUNT(l.id)::int items, SUM(CASE WHEN l.counted_qty<>l.system_qty THEN 1 ELSE 0 END)::int variances,
            SUM((l.counted_qty-l.system_qty)) net_variance_qty
     FROM stock_counts sc LEFT JOIN sites s ON s.id=sc.site_id LEFT JOIN warehouses wh ON wh.id=sc.warehouse_id
     LEFT JOIN users u ON u.id=sc.created_by LEFT JOIN stock_count_lines l ON l.count_id=sc.id
     ${w.sql} GROUP BY sc.id, s.name, wh.name, u.name ORDER BY sc.count_date DESC, sc.id DESC LIMIT 500`, w.params));
});

r.get('/stock-counts/:id', async (req, res) => {
  const head = await one(`SELECT sc.*, s.name site_name, wh.name warehouse_name FROM stock_counts sc
     LEFT JOIN sites s ON s.id=sc.site_id LEFT JOIN warehouses wh ON wh.id=sc.warehouse_id WHERE sc.id=$1`, [req.params.id]);
  if (!head) throw bad('Not found');
  const ls = await q(`SELECT l.*, i.name item_name, i.uom FROM stock_count_lines l JOIN items i ON i.id=l.item_id WHERE count_id=$1`, [req.params.id]);
  res.json({ ...head, lines: ls });
});

/* -------------------------------------------------------------- transfers */
r.post('/transfers', need('transfers'), async (req, res) => {
  const from: Loc = { site_id: num(req.body.from_site_id) ?? null, warehouse_id: num(req.body.from_warehouse_id) ?? null };
  const to: Loc = { site_id: num(req.body.to_site_id) ?? null, warehouse_id: num(req.body.to_warehouse_id) ?? null };
  if (!from.site_id === !from.warehouse_id || !to.site_id === !to.warehouse_id) throw bad('Choose one source and one destination');
  if (from.site_id && from.site_id === to.site_id) throw bad('Source and destination must differ');
  if (from.warehouse_id && from.warehouse_id === to.warehouse_id) throw bad('Source and destination must differ');
  if (from.site_id) assertSite(req.user, from.site_id);
  if (to.site_id) assertSite(req.user, to.site_id);
  const d = date(req.body.transfer_date) ?? today();
  const ls = lines<any>(req.body.lines);
  const id = await tx(async (c) => {
    const no = await nextDocNo('TRF', c);
    const t = await one<{ id: number }>(
      `INSERT INTO stock_transfers(transfer_no,transfer_date,from_site_id,from_warehouse_id,to_site_id,to_warehouse_id,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [no, d, from.site_id, from.warehouse_id, to.site_id, to.warehouse_id, req.body.notes ?? null, req.user.id], c);
    for (const l of ls) {
      const qty = Number(l.qty);
      if (!(qty > 0)) throw bad('Quantity must be greater than 0');
      await ensureStock(c, from, l.item_id, qty, 'source');
      const rate = await avgCost(c, from, l.item_id);
      await c.query('INSERT INTO stock_transfer_lines(transfer_id,item_id,qty) VALUES ($1,$2,$3)', [t!.id, l.item_id, qty]);
      await postLedger(c, [
        { ...from, txn_date: d, item_id: l.item_id, qty: -qty, rate, txn_type: 'TRANSFER_OUT', ref_type: 'TRANSFER', ref_id: t!.id, created_by: req.user.id },
        { ...to, txn_date: d, item_id: l.item_id, qty, rate, txn_type: 'TRANSFER_IN', ref_type: 'TRANSFER', ref_id: t!.id, created_by: req.user.id },
      ]);
    }
    return t!.id;
  });
  res.status(201).json({ id });
});

r.get('/transfers', async (req, res) => {
  const w = new Where();
  if (req.user.siteIds !== null) w.add('(t.from_site_id = ANY(?) OR t.to_site_id = ANY(?))', req.user.siteIds, req.user.siteIds);
  res.json(await q(
    `SELECT t.*, COALESCE(fs.name, fw.name) from_name, COALESCE(ts.name, tw.name) to_name, u.name created_by_name,
            (SELECT json_agg(json_build_object('item_name', i.name, 'qty', l.qty, 'uom', i.uom))
               FROM stock_transfer_lines l JOIN items i ON i.id=l.item_id WHERE l.transfer_id=t.id) lines
     FROM stock_transfers t LEFT JOIN sites fs ON fs.id=t.from_site_id LEFT JOIN warehouses fw ON fw.id=t.from_warehouse_id
     LEFT JOIN sites ts ON ts.id=t.to_site_id LEFT JOIN warehouses tw ON tw.id=t.to_warehouse_id LEFT JOIN users u ON u.id=t.created_by
     ${w.sql} ORDER BY t.transfer_date DESC, t.id DESC LIMIT 500`, w.params));
});

/* --------------------------------------------- requirement planner (tomorrow) */
r.get('/planner', async (req, res) => {
  const lookback = Number(await setting('planner_lookback_days', 7));
  const forDate = date(req.query.for_date) ?? addDays(today(), 1);
  const cover = Math.max(1, Number(req.query.cover_days ?? (await setting('planner_days_cover', 1))));
  const w = siteFilters(req, new Where());
  const lb = w.p(lookback);
  const cv = w.p(cover);
  const fd = w.p(forDate);
  const rows = await q(
    `WITH keys AS (
        SELECT site_id, item_id FROM stock_ledger WHERE site_id IS NOT NULL GROUP BY 1,2
        UNION SELECT site_id, item_id FROM site_item_settings),
     base AS (
     SELECT s.id site_id, s.name site_name, c.name client_name, rg.name region_name, i.id item_id, i.name item_name, i.category, i.uom,
            i.min_order_qty,
            COALESCE(st.qty,0) stock, COALESCE(tr.in_transit,0) in_transit, COALESCE(pi.pending,0) pending_indent,
            COALESCE(sis.reorder_level, i.reorder_level) reorder_level, sis.max_level,
            ROUND(COALESCE(cons.used,0) / ${lb}::numeric, 3) avg_daily_use
     FROM keys k JOIN sites s ON s.id=k.site_id JOIN clients c ON c.id=s.client_id JOIN regions rg ON rg.id=s.region_id
     JOIN items i ON i.id=k.item_id AND i.active
     LEFT JOIN v_site_stock st ON st.site_id=k.site_id AND st.item_id=k.item_id
     LEFT JOIN site_item_settings sis ON sis.site_id=k.site_id AND sis.item_id=k.item_id
     LEFT JOIN (SELECT d.site_id, dl.item_id, SUM(dl.qty_dispatched) in_transit FROM dispatch_lines dl JOIN dispatches d ON d.id=dl.dispatch_id
                WHERE d.status='IN_TRANSIT' GROUP BY 1,2) tr ON tr.site_id=k.site_id AND tr.item_id=k.item_id
     LEFT JOIN (SELECT ind.site_id, il.item_id, SUM(GREATEST(COALESCE(il.qty_approved,il.qty_requested)-il.qty_fulfilled,0)) pending
                FROM indent_lines il JOIN indents ind ON ind.id=il.indent_id
                WHERE ind.status IN ('PENDING','APPROVED','PARTIAL') AND ind.required_date <= ${fd}::date GROUP BY 1,2) pi
                ON pi.site_id=k.site_id AND pi.item_id=k.item_id
     LEFT JOIN (SELECT site_id, item_id, SUM(qty_used) used FROM consumption WHERE entry_date > CURRENT_DATE - ${lb}::int
                GROUP BY 1,2) cons ON cons.site_id=k.site_id AND cons.item_id=k.item_id
     ${w.sql})
     SELECT *, ROUND(avg_daily_use * ${cv}::numeric, 3) required_qty,
            GREATEST(0, ROUND(avg_daily_use * ${cv}::numeric + reorder_level - stock - in_transit - pending_indent, 3)) suggested_qty
     FROM base ORDER BY client_name, site_name, category, item_name`, w.params);
  const onlyShort = req.query.only_short !== 'false';
  res.json({ for_date: forDate, cover_days: cover, lookback_days: lookback,
    rows: onlyShort ? rows.filter((x: any) => x.suggested_qty > 0) : rows });
});

export default r;
