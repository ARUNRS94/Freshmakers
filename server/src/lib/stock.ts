import type { Db } from './db.js';
import { one, q } from './db.js';
import { bad } from './http.js';

export interface Loc {
  site_id?: number | null;
  warehouse_id?: number | null;
}

export interface LedgerRow extends Loc {
  txn_date: string;
  item_id: number;
  qty: number;
  rate?: number;
  txn_type: string;
  ref_type?: string;
  ref_id?: number;
  notes?: string;
  created_by?: number;
}

export async function postLedger(db: Db, rows: LedgerRow[]) {
  for (const r of rows) {
    if (!r.qty) continue;
    await db.query(
      `INSERT INTO stock_ledger(txn_date,warehouse_id,site_id,item_id,qty,rate,txn_type,ref_type,ref_id,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [r.txn_date, r.warehouse_id ?? null, r.site_id ?? null, r.item_id, r.qty, r.rate ?? 0, r.txn_type,
        r.ref_type ?? null, r.ref_id ?? null, r.notes ?? null, r.created_by ?? null],
    );
  }
}

export async function stockQty(db: Db, loc: Loc, itemId: number): Promise<number> {
  const col = loc.site_id ? 'site_id' : 'warehouse_id';
  const r = await one<{ qty: number }>(
    `SELECT COALESCE(SUM(qty),0) qty FROM stock_ledger WHERE ${col}=$1 AND item_id=$2`,
    [loc.site_id ?? loc.warehouse_id, itemId],
    db,
  );
  return r!.qty;
}

/** Weighted average cost of inbound stock at a location (falls back to item std rate) */
export async function avgCost(db: Db, loc: Loc, itemId: number): Promise<number> {
  const col = loc.site_id ? 'site_id' : 'warehouse_id';
  const r = await one<{ rate: number | null }>(
    `SELECT SUM(qty*rate)/NULLIF(SUM(qty),0) rate FROM stock_ledger
     WHERE ${col}=$1 AND item_id=$2 AND qty>0 AND rate>0`,
    [loc.site_id ?? loc.warehouse_id, itemId],
    db,
  );
  if (r?.rate) return Math.round(r.rate * 100) / 100;
  const it = await one<{ std_purchase_rate: number }>('SELECT std_purchase_rate FROM items WHERE id=$1', [itemId], db);
  return it?.std_purchase_rate ?? 0;
}

/** Throws when an outward movement would make stock negative */
export async function ensureStock(db: Db, loc: Loc, itemId: number, qtyOut: number, label = 'location') {
  const have = await stockQty(db, loc, itemId);
  if (have + 1e-9 < qtyOut) {
    const it = await one<{ name: string; uom: string }>('SELECT name,uom FROM items WHERE id=$1', [itemId], db);
    throw bad(`Insufficient stock of ${it?.name ?? 'item'} at ${label}: available ${have} ${it?.uom ?? ''}, required ${qtyOut}`);
  }
}

export async function vendorRate(db: Db, vendorId: number, itemId: number, onDate: string) {
  const r = await one<{ rate: number; min_order_qty: number }>(
    `SELECT rate, min_order_qty FROM vendor_item_rates WHERE vendor_id=$1 AND item_id=$2 AND effective_from<=$3
     ORDER BY effective_from DESC LIMIT 1`,
    [vendorId, itemId, onDate],
    db,
  );
  return r;
}

export async function clientRate(db: Db, clientId: number, itemId: number, onDate: string): Promise<number> {
  const r = await one<{ rate: number }>(
    `SELECT rate FROM client_item_rates WHERE client_id=$1 AND item_id=$2 AND effective_from<=$3
     ORDER BY effective_from DESC LIMIT 1`,
    [clientId, itemId, onDate],
    db,
  );
  if (r) return r.rate;
  const it = await one<{ std_sale_rate: number; mrp: number | null; category: string }>(
    'SELECT std_sale_rate, mrp, category FROM items WHERE id=$1',
    [itemId],
    db,
  );
  if (!it) return 0;
  return it.category === 'MRP' && it.mrp ? it.mrp : it.std_sale_rate;
}

/** Recompute qty_fulfilled on indent lines and the indent status after a fulfilment movement */
export async function refreshIndent(db: Db, indentId: number) {
  await db.query(
    `UPDATE indent_lines il SET qty_fulfilled = COALESCE((
        SELECT SUM(x.qty) FROM (
          SELECT dl.qty_dispatched qty FROM dispatch_lines dl JOIN dispatches d ON d.id=dl.dispatch_id
            WHERE d.indent_id=il.indent_id AND dl.item_id=il.item_id AND d.status<>'CANCELLED'
          UNION ALL
          SELECT lpl.qty FROM local_purchase_lines lpl JOIN local_purchases lp ON lp.id=lpl.lp_id
            WHERE lp.indent_id=il.indent_id AND lpl.item_id=il.item_id
          UNION ALL
          SELECT gl.qty_received FROM grn_lines gl JOIN grns g ON g.id=gl.grn_id JOIN purchase_orders po ON po.id=g.po_id
            WHERE po.indent_id=il.indent_id AND po.site_id IS NOT NULL AND gl.item_id=il.item_id
        ) x),0)
     WHERE il.indent_id=$1`,
    [indentId],
  );  const s = await one<{ need: number; done: number; status: string }>(
    `SELECT SUM(COALESCE(qty_approved,qty_requested)) need,
            SUM(LEAST(qty_fulfilled, COALESCE(qty_approved,qty_requested))) done,
            (SELECT status FROM indents WHERE id=$1) status
     FROM indent_lines WHERE indent_id=$1`,
    [indentId],
    db,
  );
  if (!s || ['CLOSED', 'CANCELLED', 'REJECTED'].includes(s.status)) return;
  let status = s.status;
  if (s.done >= s.need - 1e-9 && s.need > 0) status = 'FULFILLED';
  else if (s.done > 0) status = 'PARTIAL';
  else if (['PARTIAL', 'FULFILLED'].includes(status)) status = 'APPROVED';
  if (status !== s.status) await db.query('UPDATE indents SET status=$2 WHERE id=$1', [indentId, status]);
}

export async function audit(db: Db, userId: number | undefined, action: string, entity: string, entityId?: number, details?: unknown) {
  await db.query('INSERT INTO audit_log(user_id,action,entity,entity_id,details) VALUES ($1,$2,$3,$4,$5)', [
    userId ?? null, action, entity, entityId ?? null, details ? JSON.stringify(details) : null,
  ]);
}

export { q };
