import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { crudRouter } from '../lib/crud.js';
import { need, type AuthUser } from '../lib/auth.js';
import { q, one, tx } from '../lib/db.js';
import { bad, forbidden, notFound, num } from '../lib/http.js';

const r = Router();

r.use('/regions', crudRouter({
  table: 'regions', columns: ['name', 'code', 'active'], required: ['name'], search: ['t.name', 't.code'],
  orderBy: 't.name', module: 'regions',
}));

r.use('/clients', crudRouter({
  table: 'clients',
  columns: ['code', 'name', 'region_id', 'gstin', 'contact_person', 'phone', 'email', 'billing_address', 'payment_terms_days', 'credit_limit', 'active'],
  required: ['code', 'name'],
  select: `SELECT t.*, r.name region_name, (SELECT COUNT(*)::int FROM sites s WHERE s.client_id=t.id AND s.active) site_count
           FROM clients t LEFT JOIN regions r ON r.id=t.region_id`,
  search: ['t.name', 't.code', 't.contact_person'], filters: { region_id: 't.region_id' },
  orderBy: 't.name', module: 'customers',
}));

r.use('/sites', crudRouter({
  table: 'sites',
  columns: ['code', 'name', 'client_id', 'region_id', 'address', 'city', 'contact_phone', 'opening_time', 'active'],
  required: ['code', 'name', 'client_id', 'region_id'],
  select: `SELECT t.*, c.name client_name, r.name region_name FROM sites t
           JOIN clients c ON c.id=t.client_id JOIN regions r ON r.id=t.region_id`,
  search: ['t.name', 't.code', 't.city', 'c.name'], filters: { client_id: 't.client_id', region_id: 't.region_id' },
  orderBy: 'c.name, t.name', module: 'sites', siteColumn: 't.id',
}));

r.use('/warehouses', crudRouter({
  table: 'warehouses', columns: ['code', 'name', 'region_id', 'address', 'active'], required: ['code', 'name'],
  select: 'SELECT t.*, r.name region_name FROM warehouses t LEFT JOIN regions r ON r.id=t.region_id',
  orderBy: 't.name', module: 'warehouses',
}));

r.use('/items', crudRouter({
  table: 'items',
  columns: ['code', 'name', 'category', 'uom', 'hsn_code', 'gst_rate', 'mrp', 'min_order_qty', 'reorder_level', 'wh_reorder_level',
    'std_purchase_rate', 'std_sale_rate', 'shelf_life_days', 'active'],
  required: ['code', 'name', 'category', 'uom'],
  search: ['t.name', 't.code'], filters: { category: 't.category' }, orderBy: 't.category, t.name', module: 'items',
}));

r.use('/vendors', crudRouter({
  table: 'vendors',
  columns: ['code', 'name', 'vendor_type', 'gstin', 'contact_person', 'phone', 'email', 'address', 'payment_terms_days',
    'payment_terms_text', 'lead_time_days', 'bank_details', 'active'],
  required: ['code', 'name'], search: ['t.name', 't.code', 't.contact_person'], filters: { vendor_type: 't.vendor_type' },
  orderBy: 't.name', module: 'vendors',
}));

r.use('/vendor-rates', crudRouter({
  table: 'vendor_item_rates', columns: ['vendor_id', 'item_id', 'rate', 'min_order_qty', 'effective_from'],
  required: ['vendor_id', 'item_id', 'rate'],
  select: `SELECT t.*, v.name vendor_name, i.name item_name, i.uom, i.category FROM vendor_item_rates t
           JOIN vendors v ON v.id=t.vendor_id JOIN items i ON i.id=t.item_id`,
  search: ['v.name', 'i.name'], filters: { vendor_id: 't.vendor_id', item_id: 't.item_id' },
  orderBy: 'v.name, i.name, t.effective_from DESC', module: 'vendor_rates',
}));

r.use('/client-rates', crudRouter({
  table: 'client_item_rates', columns: ['client_id', 'item_id', 'rate', 'effective_from'],
  required: ['client_id', 'item_id', 'rate'],
  select: `SELECT t.*, c.name client_name, i.name item_name, i.uom, i.category, i.std_purchase_rate FROM client_item_rates t
           JOIN clients c ON c.id=t.client_id JOIN items i ON i.id=t.item_id`,
  search: ['c.name', 'i.name'], filters: { client_id: 't.client_id', item_id: 't.item_id' },
  orderBy: 'c.name, i.name, t.effective_from DESC', module: 'customer_rates',
}));

r.use('/employees', crudRouter({
  table: 'employees', columns: ['code', 'name', 'designation', 'phone', 'email', 'joining_date', 'daily_wage', 'active'],
  required: ['code', 'name'],
  select: `SELECT t.*, d.site_id current_site_id, s.name current_site_name, d.shift current_shift FROM employees t
           LEFT JOIN LATERAL (SELECT * FROM deployments d WHERE d.employee_id=t.id AND d.from_date<=CURRENT_DATE
             AND (d.to_date IS NULL OR d.to_date>=CURRENT_DATE) ORDER BY d.from_date DESC LIMIT 1) d ON TRUE
           LEFT JOIN sites s ON s.id=d.site_id`,
  search: ['t.name', 't.code', 't.phone', 's.name'], filters: { designation: 't.designation' },
  orderBy: 't.name', module: 'employees',
}));

r.use('/deployments', crudRouter({
  table: 'deployments', columns: ['employee_id', 'site_id', 'from_date', 'to_date', 'shift', 'notes'],
  required: ['employee_id', 'site_id', 'from_date'],
  select: `SELECT t.*, e.name employee_name, e.code employee_code, e.designation, s.name site_name, c.name client_name
           FROM deployments t JOIN employees e ON e.id=t.employee_id JOIN sites s ON s.id=t.site_id JOIN clients c ON c.id=s.client_id`,
  search: ['e.name', 's.name', 'c.name'], filters: { employee_id: 't.employee_id', site_id: 't.site_id' },
  orderBy: 't.from_date DESC', module: 'deployments', siteColumn: 't.site_id',
}));

/* ---- site item settings (par / reorder overrides) ---- */
r.get('/site-item-settings', async (req, res) => {
  const siteId = num(req.query.site_id);
  if (!siteId) throw bad('site_id is required');
  res.json(await q(
    `SELECT i.id item_id, i.code, i.name, i.uom, i.category, i.reorder_level default_reorder_level,
            sis.reorder_level, sis.max_level
     FROM items i LEFT JOIN site_item_settings sis ON sis.item_id=i.id AND sis.site_id=$1
     WHERE i.active ORDER BY i.category, i.name`, [siteId]));
});
r.put('/site-item-settings', need('site_levels'), async (req, res) => {
  const siteId = num(req.body.site_id);
  if (!siteId || !Array.isArray(req.body.lines)) throw bad('site_id and lines are required');
  await tx(async (c) => {
    for (const l of req.body.lines) {
      if (l.reorder_level == null && l.max_level == null) {
        await c.query('DELETE FROM site_item_settings WHERE site_id=$1 AND item_id=$2', [siteId, l.item_id]);
      } else {
        await c.query(
          `INSERT INTO site_item_settings(site_id,item_id,reorder_level,max_level) VALUES ($1,$2,$3,$4)
           ON CONFLICT (site_id,item_id) DO UPDATE SET reorder_level=EXCLUDED.reorder_level, max_level=EXCLUDED.max_level`,
          [siteId, l.item_id, l.reorder_level ?? null, l.max_level ?? null]);
      }
    }
  });
  res.json({ ok: true });
});

/* ---- users ---- */
r.get('/users', async (_req, res) => {
  res.json(await q(
    `SELECT u.id,u.name,u.email,u.role,u.region_id,u.vendor_id,u.employee_id,u.active,u.created_at,
            r.name region_name, v.name vendor_name, ro.name role_name, ro.scope role_scope, e.name employee_name, e.code employee_code,
            COALESCE(array_agg(us.site_id) FILTER (WHERE us.site_id IS NOT NULL), '{}') site_ids
     FROM users u LEFT JOIN regions r ON r.id=u.region_id LEFT JOIN vendors v ON v.id=u.vendor_id
     JOIN roles ro ON ro.code=u.role LEFT JOIN employees e ON e.id=u.employee_id
     LEFT JOIN user_sites us ON us.user_id=u.id GROUP BY u.id, r.name, v.name, ro.name, ro.scope, e.name, e.code ORDER BY ro.name, u.name`));
});

async function saveUser(id: number | null, b: any, by: AuthUser) {
  if (by.role !== 'ADMIN') {
    // otherwise someone trusted with Users could make themselves an admin
    const target = id ? await one<{ role: string }>('SELECT role FROM users WHERE id=$1', [id]) : undefined;
    if (b.role === 'ADMIN' || target?.role === 'ADMIN') throw forbidden('Only an admin can manage admin accounts');
  }
  if (id === by.id && (b.active === false || (b.role !== undefined && b.role !== by.role))) throw bad('You cannot disable your own account or change your own role');
  return tx(async (c) => {
    let userId = id;
    const fields: Record<string, unknown> = {
      name: b.name, email: b.email?.toLowerCase(), role: b.role, region_id: b.region_id || null,
      vendor_id: b.vendor_id || null, employee_id: b.employee_id || null, active: b.active ?? true,
    };
    if (b.password) {
      if (String(b.password).length < 6) throw bad('Password must be at least 6 characters');
      fields.password_hash = await bcrypt.hash(String(b.password), 10);
    }
    if (!id) {
      if (!b.name || !b.email || !b.role || !b.password) throw bad('name, email, role and password are required');
      const keys = Object.keys(fields);
      const row = await one<{ id: number }>(
        `INSERT INTO users(${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
        Object.values(fields), c);
      userId = row!.id;
    } else {
      const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
      const row = await one(`UPDATE users SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')} WHERE id=$${keys.length + 1} RETURNING id`,
        [...keys.map((k) => fields[k]), id], c);
      if (!row) throw notFound('User');
    }
    if (Array.isArray(b.site_ids)) {
      await c.query('DELETE FROM user_sites WHERE user_id=$1', [userId]);
      for (const s of b.site_ids) await c.query('INSERT INTO user_sites(user_id,site_id) VALUES ($1,$2)', [userId, s]);
    }
    return userId;
  });
}
r.post('/users', need('users'), async (req, res) => res.status(201).json({ id: await saveUser(null, req.body, req.user) }));
r.put('/users/:id', need('users'), async (req, res) => res.json({ id: await saveUser(Number(req.params.id), req.body, req.user) }));

/* ---- lookups for dropdowns (scoped) ---- */
r.get('/lookups', async (req, res) => {
  const scope = req.user.siteIds;
  const [regions, clients, sites, items, vendors, warehouses, employees] = await Promise.all([
    q('SELECT id,name FROM regions WHERE active ORDER BY name'),
    q('SELECT id,name,code,region_id FROM clients WHERE active ORDER BY name'),
    q(`SELECT s.id,s.name,s.code,s.client_id,s.region_id,c.name client_name FROM sites s JOIN clients c ON c.id=s.client_id
       WHERE s.active ${scope === null ? '' : 'AND s.id = ANY($1)'} ORDER BY c.name, s.name`, scope === null ? [] : [scope]),
    q(`SELECT id,code,name,category,uom,min_order_qty,reorder_level,std_purchase_rate,std_sale_rate,mrp,gst_rate
       FROM items WHERE active ORDER BY category,name`),
    q('SELECT id,code,name,vendor_type,payment_terms_days,lead_time_days FROM vendors WHERE active ORDER BY name'),
    q('SELECT id,code,name FROM warehouses WHERE active ORDER BY name'),
    q('SELECT id,code,name,designation FROM employees WHERE active ORDER BY name'),
  ]);
  res.json({ regions, clients, sites, items, vendors, warehouses, employees });
});

/* ---- settings ---- */
r.get('/settings', async (_req, res) => {
  const rows = await q<{ key: string; value: unknown }>('SELECT key,value FROM app_settings');
  res.json(Object.fromEntries(rows.map((x) => [x.key, x.value])));
});
r.put('/settings', need('settings'), async (req, res) => {
  for (const [k, v] of Object.entries(req.body ?? {}))
    await q('INSERT INTO app_settings(key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, JSON.stringify(v)]);
  res.json({ ok: true });
});

export default r;
