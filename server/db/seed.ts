/**
 * Demo data: 5 regions, 46 clients, 168 sites, 2 warehouses, ~24 items, vendors,
 * ~250 staff, and 30 days of realistic transactions (indents, POs/GRNs, dispatches,
 * local purchases, consumption, bills, payments, invoices, receipts, attendance).
 */
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { pool } from '../src/lib/db.js';

// ---------- deterministic random ----------
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const between = (a: number, b: number) => a + rnd() * (b - a);
const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
const chance = (p: number) => rnd() < p;
const r2 = (n: number) => Math.round(n * 100) / 100;

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NOW = new Date();
const day = (offset: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  return fmt(d);
};
const ts = (offset: number, hour = 10) => `${day(offset)} ${pad(hour)}:${pad(Math.floor(rnd() * 59))}:00`;

// ---------- doc numbering (kept in sync with doc_sequences) ----------
const seqs = new Map<string, number>();
const docNo = (prefix: string, dateStr: string) => {
  const key = `${prefix}-${dateStr.slice(2, 4)}${dateStr.slice(5, 7)}`;
  const n = (seqs.get(key) ?? 0) + 1;
  seqs.set(key, n);
  return `${key}-${String(n).padStart(5, '0')}`;
};

async function ins(c: PoolClient, table: string, cols: string[], rows: unknown[][]) {
  const size = Math.max(1, Math.floor(30000 / cols.length));
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const params: unknown[] = [];
    const values = chunk.map((row) => '(' + row.map((v) => (params.push(v), `$${params.length}`)).join(',') + ')');
    await c.query(`INSERT INTO ${table}(${cols.join(',')}) VALUES ${values.join(',')}`, params);
  }
}

// ---------- master data ----------
const REGIONS = [
  { name: 'North', code: 'N', cities: ['Delhi', 'Gurugram', 'Noida', 'Chandigarh', 'Jaipur'] },
  { name: 'South', code: 'S', cities: ['Bengaluru', 'Chennai', 'Hyderabad', 'Kochi'] },
  { name: 'East', code: 'E', cities: ['Kolkata', 'Bhubaneswar', 'Patna'] },
  { name: 'West', code: 'W', cities: ['Mumbai', 'Pune', 'Ahmedabad'] },
  { name: 'Central', code: 'C', cities: ['Indore', 'Bhopal', 'Nagpur'] },
];

type ItemDef = [string, string, 'SUPPLY' | 'MRP' | 'STORE', string, number, number | null, number, number, number, number, number, number];
// code, name, category, uom, gst, mrp, moq, site reorder, wh reorder, purchase rate, sale rate, avg daily use per site
const ITEMS: ItemDef[] = [
  ['MILK', 'Milk (Toned)', 'SUPPLY', 'LTR', 0, null, 100, 10, 200, 54, 62, 12],
  ['MILKFC', 'Milk (Full Cream)', 'SUPPLY', 'LTR', 0, null, 100, 5, 100, 66, 75, 5],
  ['TEA', 'Tea Leaves (CTC)', 'SUPPLY', 'KG', 5, null, 25, 1, 30, 380, 450, 0.4],
  ['TEAG', 'Green Tea Bags (100)', 'SUPPLY', 'BOX', 5, null, 20, 2, 20, 420, 520, 0.3],
  ['COF', 'Coffee Beans (Arabica)', 'SUPPLY', 'KG', 5, null, 20, 1, 25, 950, 1150, 0.35],
  ['COFI', 'Instant Coffee Powder', 'SUPPLY', 'KG', 18, null, 10, 0.5, 10, 780, 900, 0.15],
  ['SUG', 'Sugar', 'SUPPLY', 'KG', 5, null, 100, 3, 150, 44, 52, 2.5],
  ['SUGS', 'Sugar Sachets', 'SUPPLY', 'PCS', 5, null, 5000, 200, 5000, 0.6, 0.9, 120],
  ['GIN', 'Ginger Paste', 'SUPPLY', 'KG', 0, null, 10, 0.3, 10, 160, 200, 0.2],
  ['ELA', 'Cardamom (Elaichi)', 'SUPPLY', 'KG', 5, null, 2, 0.05, 2, 2400, 2800, 0.02],
  ['MAS', 'Tea Masala', 'SUPPLY', 'KG', 5, null, 5, 0.1, 5, 650, 780, 0.05],
  ['CUP', 'Paper Cups 150ml', 'SUPPLY', 'PCS', 18, null, 10000, 300, 10000, 0.9, 1.3, 250],
  ['STR', 'Wooden Stirrers', 'SUPPLY', 'PCS', 18, null, 10000, 300, 10000, 0.25, 0.4, 200],
  ['HOC', 'Hot Chocolate Powder', 'SUPPLY', 'KG', 18, null, 10, 0.3, 8, 620, 750, 0.1],
  ['BIS', 'Marie Biscuits Pack', 'MRP', 'PCS', 18, 10, 500, 30, 500, 7.2, 10, 25],
  ['COOK', 'Choco Cookies Pack', 'MRP', 'PCS', 18, 30, 300, 15, 300, 22, 30, 10],
  ['WAT', 'Packaged Water 500ml', 'MRP', 'PCS', 18, 10, 600, 40, 600, 5.5, 10, 30],
  ['JUI', 'Fruit Juice 200ml', 'MRP', 'PCS', 12, 25, 300, 20, 300, 16, 25, 12],
  ['CHI', 'Potato Chips 30g', 'MRP', 'PCS', 12, 20, 300, 15, 300, 14, 20, 8],
  ['LEM', 'Lemon', 'STORE', 'PCS', 0, null, 0, 10, 0, 4, 6, 15],
  ['MINT', 'Mint Leaves', 'STORE', 'BUNCH', 0, null, 0, 2, 0, 10, 15, 2],
  ['GINF', 'Fresh Ginger', 'STORE', 'KG', 0, null, 0, 0.1, 0, 120, 160, 0.15],
  ['TIS', 'Tissue Napkins', 'STORE', 'PACK', 18, null, 0, 3, 0, 25, 35, 3],
  ['HON', 'Honey', 'STORE', 'KG', 5, null, 0, 0.1, 0, 400, 520, 0.05],
];
const CORE = ['MILK', 'TEA', 'COF', 'SUG', 'CUP', 'STR', 'GIN', 'ELA'];
const isPcs = (uom: string) => ['PCS', 'BOX', 'BUNCH', 'PACK'].includes(uom);
const roundQty = (q: number, uom: string) => (isPcs(uom) ? Math.max(0, Math.round(q)) : Math.max(0, Math.round(q * 100) / 100));

const VENDORS: { name: string; type: 'REGULAR' | 'LOCAL_MARKET'; terms: number; lead: number; items: string[] }[] = [
  { name: 'Dairy Fresh Co-operative', type: 'REGULAR', terms: 7, lead: 1, items: ['MILK', 'MILKFC'] },
  { name: 'Sunrise Dairy Farms', type: 'REGULAR', terms: 15, lead: 1, items: ['MILK', 'MILKFC'] },
  { name: 'Hill Valley Tea Estates', type: 'REGULAR', terms: 30, lead: 4, items: ['TEA', 'TEAG'] },
  { name: 'Bean Origin Coffee Traders', type: 'REGULAR', terms: 30, lead: 5, items: ['COF', 'COFI', 'HOC'] },
  { name: 'Sweetline Sugars', type: 'REGULAR', terms: 15, lead: 2, items: ['SUG', 'SUGS'] },
  { name: 'Spice Route Traders', type: 'REGULAR', terms: 21, lead: 3, items: ['GIN', 'ELA', 'MAS'] },
  { name: 'PackRight Disposables', type: 'REGULAR', terms: 45, lead: 5, items: ['CUP', 'STR'] },
  { name: 'Snack Hub Distributors', type: 'REGULAR', terms: 30, lead: 3, items: ['BIS', 'COOK', 'CHI'] },
  { name: 'AquaPure Beverages', type: 'REGULAR', terms: 30, lead: 3, items: ['WAT', 'JUI'] },
  { name: 'Local Market (Cash)', type: 'LOCAL_MARKET', terms: 0, lead: 0, items: [] },
  { name: 'Neighbourhood Kirana Stores', type: 'LOCAL_MARKET', terms: 0, lead: 0, items: [] },
  { name: 'City Mandi Vendors', type: 'LOCAL_MARKET', terms: 7, lead: 0, items: [] },
];

const CO_A = ['Apex', 'Bluewave', 'Crestline', 'Deltaforge', 'Evergreen', 'Fusionworks', 'Granite', 'Horizon', 'Ironleaf', 'Juniper', 'Keystone', 'Lumen',
  'Meridian', 'Northstar', 'Orbitz', 'Pinnacle', 'Quantix', 'Redwood', 'Summitra', 'Trident', 'Unison', 'Vertexa', 'Westbrook'];
const CO_B = ['Technologies', 'Financial Services', 'Healthcare', 'Logistics', 'Pharma', 'Infra', 'Consulting', 'Retail', 'Motors', 'Systems'];
const SITE_SUFFIX = ['Tower A', 'Tower B', 'Tech Park', 'Campus', 'HQ', 'Block C', 'Plant', 'Office', 'Hub', 'Annexe'];
const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Ishaan', 'Rohan', 'Kabir', 'Arjun', 'Sai', 'Rahul', 'Vikram', 'Priya', 'Ananya', 'Diya', 'Kavya',
  'Meera', 'Pooja', 'Sneha', 'Neha', 'Ravi', 'Suresh', 'Manoj', 'Imran', 'Faizal', 'Joseph', 'Thomas', 'Deepak', 'Karthik', 'Lakshmi', 'Ritu', 'Sanjay'];
const LAST = ['Sharma', 'Verma', 'Iyer', 'Nair', 'Reddy', 'Das', 'Patel', 'Singh', 'Khan', 'Gupta', 'Menon', 'Rao', 'Pillai', 'Joshi', 'Bose', 'Kulkarni'];

async function main() {
  const t0 = Date.now();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL app.audit_off = 'on'`); // demo data is not a change anyone made
    const already = (await c.query('SELECT COUNT(*)::int n FROM users')).rows[0].n;
    if (already > 0) throw new Error('Database already has data. Run "npm run db:reset" to start fresh.');

    // regions
    await ins(c, 'regions', ['id', 'name', 'code'], REGIONS.map((r, i) => [i + 1, r.name, r.code]));

    // clients
    const clients: { id: number; name: string; short: string; region: number; terms: number }[] = [];
    for (let i = 0; i < 46; i++) {
      const a = CO_A[i % CO_A.length];
      const b = CO_B[(i * 3 + Math.floor(i / CO_A.length)) % CO_B.length];
      const name = `${a} ${b}${i >= CO_A.length ? ' India' : ''} Pvt Ltd`;
      clients.push({ id: i + 1, name, short: a, region: 1 + Math.floor(rnd() * REGIONS.length), terms: pick([15, 30, 30, 45, 60]) });
    }
    await ins(c, 'clients', ['id', 'code', 'name', 'region_id', 'gstin', 'contact_person', 'phone', 'email', 'payment_terms_days', 'credit_limit'],
      clients.map((cl) => [cl.id, `CL${String(cl.id).padStart(3, '0')}`, cl.name, cl.region, `29ABCDE${String(1000 + cl.id)}F1Z${cl.id % 10}`,
        `${pick(FIRST)} ${pick(LAST)}`, `98${String(10000000 + cl.id * 7919).slice(0, 8)}`, `admin@${cl.short.toLowerCase()}${cl.id}.example.com`,
        cl.terms, pick([200000, 500000, 1000000])]));

    // sites – 168 distributed across 46 clients
    const counts = clients.map(() => 1);
    for (let i = 0; i < 168 - 46; i++) counts[Math.floor(Math.pow(rnd(), 1.6) * 46)]++;
    const sites: { id: number; client: number; region: number; scale: number; items: string[] }[] = [];
    const siteRows: unknown[][] = [];
    clients.forEach((cl, ci) => {
      for (let k = 0; k < counts[ci]; k++) {
        const id = sites.length + 1;
        const region = chance(0.8) ? cl.region : 1 + Math.floor(rnd() * REGIONS.length);
        const city = pick(REGIONS[region - 1].cities);
        const items = [...CORE, ...ITEMS.filter((it) => !CORE.includes(it[0]) && chance(it[2] === 'STORE' ? 0.45 : 0.55)).map((it) => it[0])];
        sites.push({ id, client: cl.id, region, scale: between(0.5, 2), items });
        siteRows.push([id, `ST${String(id).padStart(3, '0')}`, `${cl.short} – ${city} ${SITE_SUFFIX[k % SITE_SUFFIX.length]}`, cl.id, region,
          `${Math.floor(between(1, 99))}, ${pick(['MG Road', 'Ring Road', 'Sector 5', 'IT Corridor', 'Industrial Area', 'Business Bay'])}`, city,
          `080${String(4000000 + id * 37).slice(0, 7)}`, '08:00']);
      }
    });
    await ins(c, 'sites', ['id', 'code', 'name', 'client_id', 'region_id', 'address', 'city', 'contact_phone', 'opening_time'], siteRows);

    // warehouses
    await ins(c, 'warehouses', ['id', 'code', 'name', 'region_id', 'address'], [
      [1, 'WH-N', 'Delhi Central Warehouse', 1, 'Okhla Industrial Area, Delhi'],
      [2, 'WH-S', 'Bengaluru Warehouse', 2, 'Peenya Industrial Area, Bengaluru'],
    ]);
    const whFor = (region: number) => ([1, 3, 5].includes(region) ? 1 : 2);

    // items
    const item = new Map<string, { id: number; d: ItemDef }>();
    ITEMS.forEach((d, i) => item.set(d[0], { id: i + 1, d }));
    await ins(c, 'items', ['id', 'code', 'name', 'category', 'uom', 'hsn_code', 'gst_rate', 'mrp', 'min_order_qty', 'reorder_level', 'wh_reorder_level',
      'std_purchase_rate', 'std_sale_rate', 'shelf_life_days'],
      ITEMS.map((d, i) => [i + 1, d[0], d[1], d[2], d[3], String(400000 + i * 13), d[4], d[5], d[6], d[7], d[8], d[9], d[10],
        d[0].startsWith('MILK') ? 3 : d[2] === 'STORE' ? 5 : 180]));

    // vendors & rates
    await ins(c, 'vendors', ['id', 'code', 'name', 'vendor_type', 'gstin', 'contact_person', 'phone', 'email', 'payment_terms_days', 'payment_terms_text', 'lead_time_days'],
      VENDORS.map((v, i) => [i + 1, `V${String(i + 1).padStart(3, '0')}`, v.name, v.type, v.type === 'REGULAR' ? `07AAACV${1000 + i}K1Z${i}` : null,
        `${pick(FIRST)} ${pick(LAST)}`, `99${String(20000000 + i * 104729).slice(0, 8)}`, v.type === 'REGULAR' ? `sales@vendor${i + 1}.example.com` : null,
        v.terms, v.terms === 0 ? 'Cash / UPI on purchase' : `Net ${v.terms} days from bill date`, v.lead]));
    const vendorOf = new Map<string, number>(); // primary vendor per item
    const vrate = new Map<string, number>();
    const rateRows: unknown[][] = [];
    VENDORS.forEach((v, vi) => v.items.forEach((code) => {
      const it = item.get(code)!;
      const rate = r2(it.d[9] * between(0.97, 1.03));
      vrate.set(`${vi + 1}:${code}`, rate);
      if (!vendorOf.has(code)) vendorOf.set(code, vi + 1);
      rateRows.push([vi + 1, it.id, rate, it.d[6], day(-90)]);
    }));
    await ins(c, 'vendor_item_rates', ['vendor_id', 'item_id', 'rate', 'min_order_qty', 'effective_from'], rateRows);

    // client specific selling rates
    const crate = new Map<string, number>();
    const crRows: unknown[][] = [];
    for (const cl of clients) {
      if (!chance(0.6)) continue;
      for (const code of ['MILK', 'TEA', 'COF', 'SUG', 'CUP', 'GIN']) {
        const it = item.get(code)!;
        const rate = r2(it.d[10] * between(0.95, 1.08));
        crate.set(`${cl.id}:${code}`, rate);
        crRows.push([cl.id, it.id, rate, day(-90)]);
      }
    }
    await ins(c, 'client_item_rates', ['client_id', 'item_id', 'rate', 'effective_from'], crRows);
    const saleRate = (clientId: number, code: string) => {
      const it = item.get(code)!.d;
      return crate.get(`${clientId}:${code}`) ?? (it[2] === 'MRP' && it[5] ? it[5] : it[10]);
    };

    // site item settings for a few large sites
    const sisRows: unknown[][] = [];
    for (const s of sites.filter((x) => x.scale > 1.6))
      for (const code of ['MILK', 'CUP'])
        sisRows.push([s.id, item.get(code)!.id, roundQty(item.get(code)!.d[7] * s.scale, item.get(code)!.d[3]), roundQty(item.get(code)!.d[11] * s.scale * 5, item.get(code)!.d[3])]);
    await ins(c, 'site_item_settings', ['site_id', 'item_id', 'reorder_level', 'max_level'], sisRows);

    // employees & deployments
    const empRows: unknown[][] = [];
    const depRows: unknown[][] = [];
    const empSite: { id: number; site: number }[] = [];
    let eid = 0;
    for (const s of sites) {
      const n = s.scale > 1.5 ? 3 : s.scale > 0.9 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        eid++;
        empRows.push([eid, `EMP${String(eid).padStart(4, '0')}`, `${pick(FIRST)} ${pick(LAST)}`, k === 0 && n === 3 ? 'Senior Barista' : 'Barista',
          `9${String(700000000 + eid * 9973).slice(0, 9)}`, day(-400 + Math.floor(rnd() * 300)), pick([650, 700, 750, 800])]);
        depRows.push([eid, s.id, day(-60), null, k === 1 && n === 3 ? 'EVENING' : 'MORNING']);
        empSite.push({ id: eid, site: s.id });
      }
    }
    const staffStart = eid;
    for (const [title, n] of [['Site Manager', 12], ['Supervisor', 6], ['Ops Head', 5]] as const)
      for (let k = 0; k < n; k++) {
        eid++;
        empRows.push([eid, `EMP${String(eid).padStart(4, '0')}`, `${pick(FIRST)} ${pick(LAST)}`, title, `9${String(800000000 + eid * 7).slice(0, 9)}`, day(-700), null]);
      }
    // a couple of relievers on the bench
    for (let k = 0; k < 4; k++) {
      eid++;
      empRows.push([eid, `EMP${String(eid).padStart(4, '0')}`, `${pick(FIRST)} ${pick(LAST)}`, 'Barista (Reliever)', `9${String(810000000 + eid).slice(0, 9)}`, day(-100), 700]);
    }
    await ins(c, 'employees', ['id', 'code', 'name', 'designation', 'phone', 'joining_date', 'daily_wage'], empRows);
    await ins(c, 'deployments', ['employee_id', 'site_id', 'from_date', 'to_date', 'shift'], depRows);

    // users
    const hash = await bcrypt.hash('Fresh@123', 10);
    const northSites = sites.filter((s) => s.region === 1).map((s) => s.id);
    const users: [number, string, string, string, number | null, number | null, number[]][] = [
      [1, 'System Admin', 'admin@freshmakers.in', 'ADMIN', null, null, []],
      [2, 'Barista – Demo', 'barista@freshmakers.in', 'BARISTA', null, null, northSites.slice(0, 1)],
      [3, 'Site Manager – Demo', 'manager@freshmakers.in', 'MANAGER', null, null, northSites.slice(0, 3)],
      [4, 'Supervisor – Demo', 'supervisor@freshmakers.in', 'SUPERVISOR', null, null, northSites.slice(0, 12)],
      [5, 'Ops Head – North', 'opshead@freshmakers.in', 'OPS_HEAD', 1, null, []],
      [6, 'Chief Business Officer', 'cbo@freshmakers.in', 'CBO', null, null, []],
      [7, 'Supply Chain Manager', 'scm@freshmakers.in', 'SCM', null, null, []],
      [8, 'Finance Team', 'finance@freshmakers.in', 'FINANCE', null, null, []],
      [9, 'Dairy Fresh (Vendor)', 'vendor@freshmakers.in', 'VENDOR', null, 1, []],
    ];
    const linked = new Set<number>();
    await ins(c, 'users', ['id', 'name', 'email', 'username', 'password_hash', 'role', 'region_id', 'vendor_id', 'employee_id'],
      users.map((u) => {
        // site staff get a linked employee so "My attendance" works out of the box
        const emp = empSite.find((e) => u[6].includes(e.site) && !linked.has(e.id));
        if (emp) linked.add(emp.id);
        return [u[0], u[1], u[2], u[2].split('@')[0], hash, u[3], u[4], u[5], emp?.id ?? null];
      }));
    await ins(c, 'user_sites', ['user_id', 'site_id'], users.flatMap((u) => u[6].map((s) => [u[0], s])));
    const BARISTA = 2, MANAGER = 3, SUPERVISOR = 4, OPS = 5, CBO = 6, SCM = 7, FIN = 8;

    // ---------------------------------------------------------------- simulation
    const DAYS = 30;
    const ledger: unknown[][] = [];
    const L = (d: string, wh: number | null, site: number | null, itemId: number, qty: number, rate: number, type: string, refType: string | null, refId: number | null, by: number | null) =>
      ledger.push([d, wh, site, itemId, qty, rate, type, refType, refId, null, by]);

    const consumption: unknown[][] = [];
    const indents: unknown[][] = [], indentLines: unknown[][] = [], approvals: unknown[][] = [];
    const dispatches: unknown[][] = [], dLines: unknown[][] = [];
    const lps: unknown[][] = [], lpLines: unknown[][] = [];
    const invoices: unknown[][] = [], invLines: unknown[][] = [];
    const bills: unknown[][] = [], billLines: unknown[][] = [];
    let indentId = 0, ilId = 0, dispId = 0, lpId = 0, invId = 0, billId = 0, consId = 0;
    const whDemand = new Map<string, number>(); // `${wh}:${code}` -> qty dispatched
    const whOut: { d: string; wh: number; code: string; qty: number }[] = [];
    const chain = ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO'];
    const chainUsers = [MANAGER, SUPERVISOR, OPS, CBO];

    for (const s of sites) {
      const cl = clients[s.client - 1];
      const wh = whFor(s.region);
      const stock = new Map<string, number>();
      const use = (code: string) => item.get(code)!.d[11] * s.scale;
      // opening stock at site
      for (const code of s.items) {
        const it = item.get(code)!;
        const q = roundQty(use(code) * 3 + it.d[7], it.d[3]);
        stock.set(code, q);
        L(day(-DAYS - 1), null, s.id, it.id, q, it.d[9], 'OPENING', null, null, 1);
      }
      const supplied = s.items.filter((code) => item.get(code)!.d[2] !== 'STORE');
      const store = s.items.filter((code) => item.get(code)!.d[2] === 'STORE');
      const skipYesterday = chance(0.05);

      for (let off = -DAYS; off <= 0; off++) {
        const d = day(off);
        // ---- supply via indent + dispatch every 3 days
        if ((off + s.id) % 3 === 0) {
          indentId++;
          const indNo = docNo('IND', day(off - 1));
          const inTransit = off >= -1 && chance(0.25);
          indents.push([indentId, indNo, s.id, day(off - 1), d, 'NORMAL', 'FULFILLED', null, null, MANAGER, ts(off - 1, 9), ts(off, 15)]);
          approvals.push([indentId, 'MANAGER', 'SUBMIT', null, MANAGER, ts(off - 1, 9)]);
          [SUPERVISOR, OPS, CBO].forEach((u, k) => approvals.push([indentId, chain[k + 1], 'APPROVE', null, u, ts(off - 1, 10 + k)]));
          dispId++;
          const dNo = docNo('DSP', d);
          dispatches.push([dispId, dNo, d, wh, s.id, indentId, `KA0${Math.floor(between(1, 9))}AB${Math.floor(between(1000, 9999))}`, pick(FIRST),
            inTransit ? 'IN_TRANSIT' : 'RECEIVED', inTransit ? null : d, inTransit ? null : BARISTA, SCM, ts(off, 7)]);
          let invAmt = 0, invTax = 0;
          const myInvLines: unknown[][] = [];
          for (const code of supplied) {
            const it = item.get(code)!;
            const need = roundQty(use(code) * 3.2 + Math.max(0, it.d[7] - (stock.get(code) ?? 0)), it.d[3]);
            if (need <= 0) continue;
            ilId++;
            indentLines.push([ilId, indentId, it.id, need, need, need, stock.get(code) ?? 0]);
            const cost = vrate.get(`${vendorOf.get(code)}:${code}`) ?? it.d[9];
            const sale = saleRate(cl.id, code);
            const recv = inTransit ? null : chance(0.03) ? roundQty(need * 0.9, it.d[3]) : need;
            dLines.push([dispId, it.id, ilId, need, recv, cost, sale]);
            L(d, wh, null, it.id, -need, cost, 'DISPATCH_OUT', 'DISPATCH', dispId, SCM);
            whDemand.set(`${wh}:${code}`, (whDemand.get(`${wh}:${code}`) ?? 0) + need);
            whOut.push({ d, wh, code, qty: need });
            if (recv !== null) {
              L(d, null, s.id, it.id, recv, cost, 'DISPATCH_IN', 'DISPATCH', dispId, BARISTA);
              stock.set(code, (stock.get(code) ?? 0) + recv);
              const amt = r2(recv * sale);
              invAmt += amt;
              invTax += (amt * it.d[4]) / 100;
              myInvLines.push([it.id, recv, sale, amt]);
            }
          }
          if (invAmt > 0) {
            invId++;
            invoices.push([invId, docNo('INV', d), cl.id, s.id, dispId, d, day(off + cl.terms), r2(invAmt), r2(invTax)]);
            for (const l of myInvLines) invLines.push([invId, ...l]);
          }
        }
        // ---- local market purchases for store items (every 2 days) + occasional shortage buys
        if (store.length && (off + s.id) % 2 === 0) {
          lpId++;
          const lv = pick([10, 11, 12]);
          const mode = lv === 12 ? 'CREDIT' : pick(['CASH', 'UPI']);
          lps.push([lpId, docNo('LP', d), d, lv, s.id, null, 'ROUTINE', `B${Math.floor(between(100, 999))}`, mode, 'Site Manager', MANAGER, ts(off, 11)]);
          let amt = 0;
          const bl: unknown[][] = [];
          for (const code of store) {
            const it = item.get(code)!;
            const q = roundQty(use(code) * 2.2, it.d[3]) || (isPcs(it.d[3]) ? 1 : 0.1);
            const rate = r2(it.d[9] * between(0.9, 1.25));
            lpLines.push([lpId, it.id, q, rate]);
            L(d, null, s.id, it.id, q, rate, 'LOCAL_PURCHASE', 'LOCAL_PURCHASE', lpId, MANAGER);
            stock.set(code, (stock.get(code) ?? 0) + q);
            amt += r2(q * rate);
            bl.push([it.id, q, rate, r2(q * rate)]);
          }
          billId++;
          bills.push([billId, `LP-${lpId}`, lv, d, mode === 'CREDIT' ? day(off + 7) : d, null, lpId, r2(amt), 0, mode]);
          for (const l of bl) billLines.push([billId, ...l]);
        }
        if (chance(0.04) && off < 0) {
          // shortage – milk bought locally at a premium
          const it = item.get('MILK')!;
          lpId++;
          const q = roundQty(use('MILK') * 1.5, 'LTR');
          const rate = r2(it.d[9] * between(1.08, 1.2));
          lps.push([lpId, docNo('LP', d), d, 10, s.id, null, 'SHORTAGE', `B${Math.floor(between(100, 999))}`, 'CASH', 'Barista', BARISTA, ts(off, 8)]);
          lpLines.push([lpId, it.id, q, rate]);
          L(d, null, s.id, it.id, q, rate, 'LOCAL_PURCHASE', 'LOCAL_PURCHASE', lpId, BARISTA);
          stock.set('MILK', (stock.get('MILK') ?? 0) + q);
          billId++;
          bills.push([billId, `LP-${lpId}`, 10, d, d, null, lpId, r2(q * rate), 0, 'CASH']);
          billLines.push([billId, it.id, q, rate, r2(q * rate)]);
        }
        // ---- daily consumption (not for today; skip yesterday for a few sites)
        if (off < 0 && !(off === -1 && skipYesterday)) {
          for (const code of s.items) {
            const it = item.get(code)!;
            const have = stock.get(code) ?? 0;
            let used = roundQty(use(code) * between(0.75, 1.2), it.d[3]);
            let wasted = ['MILK', 'MILKFC', 'LEM', 'MINT'].includes(code) && chance(0.4) ? roundQty(use(code) * between(0.01, 0.05), it.d[3]) : 0;
            if (used + wasted > have) { used = roundQty(have * 0.9, it.d[3]); wasted = 0; }
            if (used <= 0 && wasted <= 0) continue;
            consId++;
            consumption.push([consId, s.id, d, it.id, used, wasted, code === 'CUP' ? Math.round(used) : null, s.id % 2 ? BARISTA : MANAGER, ts(off, 20)]);
            L(d, null, s.id, it.id, -used, it.d[9], 'CONSUMPTION', 'CONSUMPTION', consId, BARISTA);
            if (wasted) L(d, null, s.id, it.id, -wasted, it.d[9], 'WASTAGE', 'CONSUMPTION', consId, BARISTA);
            stock.set(code, have - used - wasted);
          }
        }
      }
      s.items.forEach((code) => ((s as any)[code] = stock.get(code)));
    }

    // ---- warehouse inbound: opening + weekly POs/GRNs per vendor
    const pos: unknown[][] = [], poLines: unknown[][] = [], grns: unknown[][] = [], grnLines: unknown[][] = [];
    let poId = 0, plId = 0, grnId = 0;
    for (const wh of [1, 2]) {
      for (const [code, it] of item) {
        if (it.d[2] === 'STORE') continue;
        const total = whDemand.get(`${wh}:${code}`) ?? 0;
        const open = roundQty(total * 0.4 + it.d[8] * 1.5, it.d[3]);
        L(day(-DAYS - 1), wh, null, it.id, open, it.d[9], 'OPENING', null, null, 1);
      }
      for (const off of [-28, -21, -14, -7, -2]) {
        for (const [vi, v] of VENDORS.entries()) {
          if (v.type !== 'REGULAR' || !v.items.length) continue;
          if (vi === 1 && off !== -14) continue; // second dairy only occasionally
          const vid = vi + 1;
          const d = day(off);
          poId++;
          const last = off === -2;
          const status = last ? (chance(0.5) ? 'PARTIAL' : 'OPEN') : 'RECEIVED';
          pos.push([poId, docNo('PO', d), vid, d, day(off + v.lead), wh, null, null, status, !last || chance(0.5), SCM, ts(off, 11)]);
          const glines: unknown[][] = [];
          let amt = 0, tax = 0;
          const bl: unknown[][] = [];
          for (const code of v.items) {
            if (vi === 0 && off === -14 && code === 'MILKFC') continue;
            const it = item.get(code)!;
            const total = whDemand.get(`${wh}:${code}`) ?? 0;
            let q = roundQty(Math.max(it.d[6], (total / 4) * 1.05), it.d[3]);
            if (vi === 1) q = roundQty(it.d[6], it.d[3]);
            const rate = vrate.get(`${vid}:${code}`) ?? it.d[9];
            plId++;
            const recvQ = status === 'RECEIVED' ? q : status === 'PARTIAL' ? roundQty(q * 0.5, it.d[3]) : 0;
            poLines.push([plId, poId, it.id, q, recvQ, rate, it.d[4]]);
            if (recvQ > 0) {
              glines.push([plId, it.id, recvQ, 0, rate, `B${off}${it.id}`, it.d[0].startsWith('MILK') ? day(off + 3) : day(off + 180)]);
              amt += r2(recvQ * rate);
              tax += (recvQ * rate * it.d[4]) / 100;
              bl.push([it.id, recvQ, rate, r2(recvQ * rate)]);
            }
          }
          if (glines.length) {
            const gd = status === 'PARTIAL' ? day(-1) : day(off + v.lead);
            grnId++;
            const gno = docNo('GRN', gd);
            grns.push([grnId, gno, poId, gd, `VINV-${poId}`, SCM, ts(off + v.lead, 14)]);
            for (const g of glines) {
              grnLines.push([grnId, ...g]);
              L(gd, wh, null, g[1] as number, g[2] as number, g[4] as number, 'GRN', 'GRN', grnId, SCM);
            }
            billId++;
            bills.push([billId, `VINV-${poId}`, vid, gd, day(off + v.lead + v.terms), grnId, null, r2(amt), r2(tax), 'CREDIT']);
            for (const l of bl) billLines.push([billId, ...l]);
          }
        }
      }
    }

    // ---- open indents for tomorrow at different approval stages
    const tomorrow = day(1);
    const openSites = [...sites].sort(() => rnd() - 0.5).slice(0, 45);
    openSites.forEach((s, k) => {
      indentId++;
      const stageIdx = k % 6; // 0..3 pending at stage, 4 approved (awaiting SCM), 5 draft
      const status = stageIdx < 4 ? 'PENDING' : stageIdx === 4 ? 'APPROVED' : 'DRAFT';
      const overdue = k < 3;
      const reqDate = overdue ? day(-1) : tomorrow;
      const creator = northSites.includes(s.id) ? MANAGER : MANAGER;
      indents.push([indentId, docNo('IND', day(overdue ? -2 : 0)), s.id, day(overdue ? -2 : 0), reqDate, k % 7 === 0 ? 'URGENT' : k % 3 === 0 ? 'HIGH' : 'NORMAL',
        overdue ? 'APPROVED' : status, overdue ? null : stageIdx < 4 ? chain[stageIdx] : null, 'Requirement for next day', creator, ts(overdue ? -2 : 0, 9), null]);
      if (status !== 'DRAFT' || overdue) {
        approvals.push([indentId, 'MANAGER', 'SUBMIT', null, creator, ts(0, 9)]);
        const upto = overdue ? 4 : stageIdx;
        for (let a = 1; a < upto; a++) approvals.push([indentId, chain[a], 'APPROVE', null, chainUsers[a], ts(0, 9 + a)]);
      }
      for (const code of s.items.filter((x) => item.get(x)!.d[2] !== 'STORE').slice(0, 6 + (k % 4))) {
        const it = item.get(code)!;
        ilId++;
        const qty = roundQty(it.d[11] * s.scale * 3, it.d[3]) || 1;
        indentLines.push([ilId, indentId, it.id, qty, null, 0, (s as any)[code] ?? 0]);
      }
    });
    // pending approvals for stage MANAGER were submitted by baristas
    for (const a of approvals) if (a[2] === 'SUBMIT' && a[0] as number > indentId - 45) a[4] = BARISTA;
    // put a few open indents on demo-user sites so every role has something in their queue
    for (let k = 0; k < 4; k++) {
      indentId++;
      const sid = northSites[k % 3];
      const s = sites[sid - 1];
      indents.push([indentId, docNo('IND', day(0)), sid, day(0), tomorrow, 'NORMAL', 'PENDING', chain[k], 'Weekend top-up', BARISTA, ts(0, 8), null]);
      approvals.push([indentId, 'BARISTA', 'SUBMIT', null, BARISTA, ts(0, 8)]);
      for (let a = 0; a < k; a++) approvals.push([indentId, chain[a], 'APPROVE', null, chainUsers[a], ts(0, 9 + a)]);
      for (const code of s.items.filter((x) => item.get(x)!.d[2] !== 'STORE').slice(0, 5)) {
        const it = item.get(code)!;
        ilId++;
        indentLines.push([ilId, indentId, it.id, roundQty(it.d[11] * s.scale * 2, it.d[3]) || 1, null, 0, (s as any)[code] ?? 0]);
      }
    }

    // ---- payments to vendors (pay most bills that are past due)
    const vpay: unknown[][] = [];
    for (const b of bills) {
      const [id, billNo, vid, bdate, due, , , amount, tax, mode] = b as [number, string, number, string, string, unknown, unknown, number, number, string];
      const total = r2(amount + tax);
      if (mode === 'CASH' || mode === 'UPI') vpay.push([vid, id, bdate, total, mode, billNo, 'Paid at purchase', FIN]);
      else if (due < day(0) && chance(0.8)) vpay.push([vid, id, due, total, 'NEFT', `UTR${id}${Math.floor(between(1000, 9999))}`, null, FIN]);
      else if (due < day(5) && chance(0.3)) vpay.push([vid, id, day(-1), r2(total * 0.5), 'NEFT', `UTR${id}P`, 'Part payment', FIN]);
    }
    // ---- receipts from clients
    const rcpts: unknown[][] = [];
    for (const inv of invoices) {
      const [id, , cid, , , idate, due, amount, tax] = inv as [number, string, number, number, number, string, string, number, number];
      const total = r2(amount + tax);
      if (due < day(0) && chance(0.75)) rcpts.push([cid, id, due, total, 'NEFT', `CR${id}`, FIN]);
      else if (idate < day(-10) && chance(0.15)) rcpts.push([cid, id, day(-2), r2(total * 0.6), 'CHEQUE', `CHQ${id}`, FIN]);
    }

    // ---- attendance
    const att: unknown[][] = [];
    for (const e of empSite) {
      const weekOff = e.id % 7;
      for (let off = -DAYS; off <= 0; off++) {
        if (off === 0 && chance(0.35)) continue; // not yet marked today
        const dow = (new Date(day(off) + 'T00:00:00').getDay());
        let st = dow === weekOff ? 'WO' : 'P';
        if (st === 'P') { const x = rnd(); st = x < 0.04 ? 'A' : x < 0.07 ? 'L' : x < 0.09 ? 'HD' : x < 0.11 ? 'OT' : 'P'; }
        const present = ['P', 'OT', 'HD'].includes(st);
        att.push([e.id, day(off), e.site, st, present ? `0${7 + Math.floor(rnd() * 2)}:${pad(Math.floor(rnd() * 59))}` : null,
          present && off < 0 ? (st === 'HD' ? '12:30' : st === 'OT' ? '20:00' : '16:30') : null, MANAGER]);
      }
    }

    // ---------------------------------------------------------------- write
    await ins(c, 'indents', ['id', 'indent_no', 'site_id', 'indent_date', 'required_date', 'priority', 'status', 'current_stage', 'notes', 'created_by', 'created_at', 'closed_at'], indents);
    await ins(c, 'indent_lines', ['id', 'indent_id', 'item_id', 'qty_requested', 'qty_approved', 'qty_fulfilled', 'stock_at_request'], indentLines);
    await ins(c, 'indent_approvals', ['indent_id', 'stage', 'action', 'comment', 'user_id', 'acted_at'], approvals);
    await ins(c, 'purchase_orders', ['id', 'po_no', 'vendor_id', 'po_date', 'expected_date', 'warehouse_id', 'site_id', 'indent_id', 'status', 'vendor_ack', 'created_by', 'created_at'], pos);
    await ins(c, 'po_lines', ['id', 'po_id', 'item_id', 'qty_ordered', 'qty_received', 'rate', 'gst_rate'], poLines);
    await ins(c, 'grns', ['id', 'grn_no', 'po_id', 'grn_date', 'vendor_invoice_no', 'created_by', 'created_at'], grns);
    await ins(c, 'grn_lines', ['grn_id', 'po_line_id', 'item_id', 'qty_received', 'qty_rejected', 'rate', 'batch_no', 'expiry_date'], grnLines);
    await ins(c, 'dispatches', ['id', 'dispatch_no', 'dispatch_date', 'warehouse_id', 'site_id', 'indent_id', 'vehicle_no', 'driver_name', 'status', 'received_date', 'received_by', 'created_by', 'created_at'], dispatches);
    await ins(c, 'dispatch_lines', ['dispatch_id', 'item_id', 'indent_line_id', 'qty_dispatched', 'qty_received', 'cost_rate', 'sale_rate'], dLines);
    await ins(c, 'local_purchases', ['id', 'lp_no', 'purchase_date', 'vendor_id', 'site_id', 'warehouse_id', 'reason', 'bill_no', 'payment_mode', 'purchased_by', 'created_by', 'created_at'], lps);
    await ins(c, 'local_purchase_lines', ['lp_id', 'item_id', 'qty', 'rate'], lpLines);
    await ins(c, 'consumption', ['id', 'site_id', 'entry_date', 'item_id', 'qty_used', 'qty_wasted', 'cups_served', 'entered_by', 'updated_at'], consumption);
    await ins(c, 'stock_ledger', ['txn_date', 'warehouse_id', 'site_id', 'item_id', 'qty', 'rate', 'txn_type', 'ref_type', 'ref_id', 'notes', 'created_by'], ledger);
    await ins(c, 'vendor_bills', ['id', 'bill_no', 'vendor_id', 'bill_date', 'due_date', 'grn_id', 'lp_id', 'amount', 'tax_amount'], bills.map((b) => b.slice(0, 9)));
    await ins(c, 'vendor_bill_lines', ['bill_id', 'item_id', 'qty', 'rate', 'amount'], billLines);
    await ins(c, 'vendor_payments', ['vendor_id', 'bill_id', 'pay_date', 'amount', 'mode', 'reference', 'notes', 'created_by'], vpay);
    await ins(c, 'client_invoices', ['id', 'invoice_no', 'client_id', 'site_id', 'dispatch_id', 'invoice_date', 'due_date', 'amount', 'tax_amount'], invoices);
    await ins(c, 'client_invoice_lines', ['invoice_id', 'item_id', 'qty', 'rate', 'amount'], invLines);
    await ins(c, 'client_receipts', ['client_id', 'invoice_id', 'receipt_date', 'amount', 'mode', 'reference', 'created_by'], rcpts);
    await ins(c, 'attendance', ['employee_id', 'att_date', 'site_id', 'status', 'check_in', 'check_out', 'marked_by'], att);
    await ins(c, 'doc_sequences', ['prefix', 'last_no'], [...seqs.entries()].map(([k, v]) => [k, v]));

    // sync serial sequences with explicit ids
    const seqTables = (await c.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='id'
      AND column_default LIKE 'nextval%'`)).rows.map((r) => r.table_name);
    for (const t of seqTables)
      await c.query(`SELECT setval(pg_get_serial_sequence('${t}','id'), (SELECT COALESCE(MAX(id),0)+1 FROM ${t}), false)`);

    // sanity: no negative stock
    const neg = (await c.query(`SELECT COUNT(*)::int n FROM (SELECT site_id, warehouse_id, item_id, SUM(qty) q FROM stock_ledger GROUP BY 1,2,3) x WHERE q < -0.001`)).rows[0].n;
    if (neg) throw new Error(`Seed produced ${neg} negative stock balances`);
    await c.query('COMMIT');
    console.log(`Seeded: ${clients.length} clients, ${sites.length} sites, ${staffStart} site staff, ${indents.length} indents, ${dispatches.length} dispatches,`);
    console.log(`        ${consumption.length} consumption rows, ${ledger.length} ledger rows, ${bills.length} vendor bills, ${invoices.length} invoices in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log('Demo logins (password Fresh@123): admin, barista, manager, supervisor, opshead, cbo, scm, finance, vendor  @freshmakers.in');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
