import { Router } from 'express';
import { q, one, tx, Where } from '../lib/db.js';
import { need, siteFilters } from '../lib/auth.js';
import { bad, date, num, must, today, notFound } from '../lib/http.js';
import { audit } from '../lib/stock.js';

const r = Router();

/* ----------------------------------------------------------- vendor side */
r.get('/vendor-bills', async (req, res) => {
  const w = new Where();
  if (req.user.role === 'VENDOR') w.add('b.vendor_id = ?', req.user.vendor_id ?? -1);
  if (req.query.vendor_id) w.add('b.vendor_id = ?', num(req.query.vendor_id));
  const st = req.query.status as string | undefined;
  if (st === 'UNPAID') w.add(`b.status <> 'PAID'`);
  else if (st === 'OVERDUE') w.add(`b.status <> 'PAID' AND b.due_date < CURRENT_DATE`);
  else if (st) w.add('b.status = ?', st);
  if (req.query.from) w.add('b.bill_date >= ?', date(req.query.from));
  if (req.query.to) w.add('b.bill_date <= ?', date(req.query.to));
  res.json(await q(
    `SELECT b.*, v.name vendor_name, v.vendor_type, g.grn_no, p.po_no, lp.lp_no,
            GREATEST(0, CURRENT_DATE - b.due_date) overdue_days
     FROM v_vendor_bill_status b JOIN vendors v ON v.id=b.vendor_id LEFT JOIN grns g ON g.id=b.grn_id
     LEFT JOIN purchase_orders p ON p.id=g.po_id LEFT JOIN local_purchases lp ON lp.id=b.lp_id
     ${w.sql} ORDER BY (b.status='PAID'), b.due_date, b.id LIMIT 2000`, w.params));
});

r.get('/vendor-bills/:id', async (req, res) => {
  const b = await one<any>(`SELECT b.*, v.name vendor_name FROM v_vendor_bill_status b JOIN vendors v ON v.id=b.vendor_id WHERE b.id=$1`, [req.params.id]);
  if (!b || (req.user.role === 'VENDOR' && b.vendor_id !== req.user.vendor_id)) throw notFound('Bill');
  const [ls, pays] = await Promise.all([
    q('SELECT l.*, i.name item_name, i.uom FROM vendor_bill_lines l JOIN items i ON i.id=l.item_id WHERE bill_id=$1', [b.id]),
    q('SELECT p.*, u.name created_by_name FROM vendor_payments p LEFT JOIN users u ON u.id=p.created_by WHERE bill_id=$1 ORDER BY pay_date', [b.id]),
  ]);
  res.json({ ...b, lines: ls, payments: pays });
});

r.post('/vendor-bills', need('payables'), async (req, res) => {
  const vendorId = must(num(req.body.vendor_id), 'Vendor');
  const amount = must(num(req.body.amount), 'Amount');
  const billDate = date(req.body.bill_date) ?? today();
  const v = await one<any>('SELECT payment_terms_days FROM vendors WHERE id=$1', [vendorId]);
  if (!v) throw bad('Unknown vendor');
  const due = date(req.body.due_date) ?? new Date(new Date(billDate).getTime() + v.payment_terms_days * 864e5).toISOString().slice(0, 10);
  const row = await one(`INSERT INTO vendor_bills(bill_no,vendor_id,bill_date,due_date,amount,tax_amount,notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [must(req.body.bill_no, 'Bill no'), vendorId, billDate, due, amount, num(req.body.tax_amount) ?? 0, req.body.notes ?? null]);
  res.status(201).json(row);
});

r.get('/vendor-payments', async (req, res) => {
  const w = new Where();
  if (req.user.role === 'VENDOR') w.add('p.vendor_id = ?', req.user.vendor_id ?? -1);
  if (req.query.vendor_id) w.add('p.vendor_id = ?', num(req.query.vendor_id));
  if (req.query.from) w.add('p.pay_date >= ?', date(req.query.from));
  if (req.query.to) w.add('p.pay_date <= ?', date(req.query.to));
  res.json(await q(
    `SELECT p.*, v.name vendor_name, b.bill_no, u.name created_by_name FROM vendor_payments p JOIN vendors v ON v.id=p.vendor_id
     LEFT JOIN vendor_bills b ON b.id=p.bill_id LEFT JOIN users u ON u.id=p.created_by ${w.sql}
     ORDER BY p.pay_date DESC, p.id DESC LIMIT 2000`, w.params));
});

r.post('/vendor-payments', need('payables'), async (req, res) => {
  const amount = must(num(req.body.amount), 'Amount');
  if (!(amount > 0)) throw bad('Amount must be greater than 0');
  const id = await tx(async (c) => {
    let vendorId = num(req.body.vendor_id);
    const billId = num(req.body.bill_id);
    if (billId) {
      const b = await one<any>('SELECT vendor_id, balance FROM v_vendor_bill_status WHERE id=$1', [billId], c);
      if (!b) throw bad('Bill not found');
      if (amount > b.balance + 0.01) throw bad(`Amount exceeds bill balance of ${b.balance.toFixed(2)}`);
      vendorId = b.vendor_id;
    }
    must(vendorId, 'Vendor');
    const p = await one<any>(
      `INSERT INTO vendor_payments(vendor_id,bill_id,pay_date,amount,mode,reference,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [vendorId, billId ?? null, date(req.body.pay_date) ?? today(), amount, req.body.mode ?? 'NEFT', req.body.reference ?? null,
        req.body.notes ?? null, req.user.id], c);
    await audit(c, req.user.id, 'PAY', 'vendor_payments', p.id, { amount });
    return p.id;
  });
  res.status(201).json({ id });
});

/* ----------------------------------------------------------- client side */
r.get('/client-invoices', async (req, res) => {
  const w = new Where();
  siteFilters(req, w, 's');
  const st = req.query.status as string | undefined;
  if (st === 'UNPAID') w.add(`i.status <> 'PAID'`);
  else if (st === 'OVERDUE') w.add(`i.status <> 'PAID' AND i.due_date < CURRENT_DATE`);
  else if (st) w.add('i.status = ?', st);
  if (req.query.from) w.add('i.invoice_date >= ?', date(req.query.from));
  if (req.query.to) w.add('i.invoice_date <= ?', date(req.query.to));
  res.json(await q(
    `SELECT i.*, c.name client_name, s.name site_name, d.dispatch_no, GREATEST(0, CURRENT_DATE - i.due_date) overdue_days
     FROM v_client_invoice_status i JOIN clients c ON c.id=i.client_id LEFT JOIN sites s ON s.id=i.site_id
     LEFT JOIN dispatches d ON d.id=i.dispatch_id ${w.sql} ORDER BY (i.status='PAID'), i.due_date, i.id LIMIT 2000`, w.params));
});

r.get('/client-invoices/:id', async (req, res) => {
  const inv = await one<any>(`SELECT i.*, c.name client_name, c.gstin, c.billing_address, s.name site_name FROM v_client_invoice_status i
     JOIN clients c ON c.id=i.client_id LEFT JOIN sites s ON s.id=i.site_id WHERE i.id=$1`, [req.params.id]);
  if (!inv) throw notFound('Invoice');
  const [ls, rec] = await Promise.all([
    q('SELECT l.*, it.name item_name, it.uom, it.hsn_code FROM client_invoice_lines l JOIN items it ON it.id=l.item_id WHERE invoice_id=$1', [inv.id]),
    q('SELECT * FROM client_receipts WHERE invoice_id=$1 ORDER BY receipt_date', [inv.id]),
  ]);
  res.json({ ...inv, lines: ls, receipts: rec });
});

r.get('/client-receipts', async (req, res) => {
  const w = new Where();
  if (req.query.client_id) w.add('r.client_id = ?', num(req.query.client_id));
  if (req.query.from) w.add('r.receipt_date >= ?', date(req.query.from));
  if (req.query.to) w.add('r.receipt_date <= ?', date(req.query.to));
  res.json(await q(
    `SELECT r.*, c.name client_name, i.invoice_no, u.name created_by_name FROM client_receipts r JOIN clients c ON c.id=r.client_id
     LEFT JOIN client_invoices i ON i.id=r.invoice_id LEFT JOIN users u ON u.id=r.created_by ${w.sql}
     ORDER BY r.receipt_date DESC, r.id DESC LIMIT 2000`, w.params));
});

r.post('/client-receipts', need('receivables'), async (req, res) => {
  const amount = must(num(req.body.amount), 'Amount');
  if (!(amount > 0)) throw bad('Amount must be greater than 0');
  const id = await tx(async (c) => {
    let clientId = num(req.body.client_id);
    const invId = num(req.body.invoice_id);
    if (invId) {
      const inv = await one<any>('SELECT client_id, balance FROM v_client_invoice_status WHERE id=$1', [invId], c);
      if (!inv) throw bad('Invoice not found');
      if (amount > inv.balance + 0.01) throw bad(`Amount exceeds invoice balance of ${inv.balance.toFixed(2)}`);
      clientId = inv.client_id;
    }
    must(clientId, 'Customer');
    const row = await one<any>(
      `INSERT INTO client_receipts(client_id,invoice_id,receipt_date,amount,mode,reference,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [clientId, invId ?? null, date(req.body.receipt_date) ?? today(), amount, req.body.mode ?? 'NEFT', req.body.reference ?? null,
        req.body.notes ?? null, req.user.id], c);
    return row.id;
  });
  res.status(201).json({ id });
});

/* ---------------------------------------------------------------- ageing */
r.get('/ageing', async (req, res) => {
  const type = req.query.type === 'client' ? 'client' : 'vendor';
  const src = type === 'client'
    ? `SELECT c.name party, i.due_date, i.balance FROM v_client_invoice_status i JOIN clients c ON c.id=i.client_id WHERE i.status<>'PAID'`
    : `SELECT v.name party, b.due_date, b.balance FROM v_vendor_bill_status b JOIN vendors v ON v.id=b.vendor_id WHERE b.status<>'PAID'`;
  res.json(await q(
    `SELECT party,
       SUM(CASE WHEN due_date >= CURRENT_DATE THEN balance ELSE 0 END) not_due,
       SUM(CASE WHEN CURRENT_DATE - due_date BETWEEN 1 AND 30 THEN balance ELSE 0 END) d1_30,
       SUM(CASE WHEN CURRENT_DATE - due_date BETWEEN 31 AND 60 THEN balance ELSE 0 END) d31_60,
       SUM(CASE WHEN CURRENT_DATE - due_date BETWEEN 61 AND 90 THEN balance ELSE 0 END) d61_90,
       SUM(CASE WHEN CURRENT_DATE - due_date > 90 THEN balance ELSE 0 END) d90_plus,
       SUM(balance) total
     FROM (${src}) x GROUP BY party ORDER BY total DESC`));
});

export default r;
