# Freshmakers Ops: inventory, indents, supply and finance

A web app that works on phones, tablets and desktops for a beverage-ingredients supplier (46 clients, 168 sites). It tracks vendor purchases, local-market buys, warehouse-to-site dispatches, daily consumption, real-time stock, next-day requirements, indent approvals, vendor/client payments, attendance and staff deployment.

**Stack:** React 19 + TypeScript + Vite (client) · Node.js + Express 5 + TypeScript (API) · PostgreSQL 14+

```
freshmakers/
├── client/              React + Vite app (src/pages, src/components, src/lib)
└── server/
    ├── db/schema.sql    Full schema, views and indexes
    ├── db/seed.ts       Realistic demo data (30 days of history)
    └── src/
        ├── lib/         db, auth/role scoping, stock ledger, CRUD factory
        └── routes/      masters, inventory, operations, finance, people, analytics
```

## Quick start

Prerequisites: Node 20+ and PostgreSQL.

```bash
createdb freshmakers
cp server/.env.example server/.env        # set DATABASE_URL and JWT_SECRET
npm run install:all
npm run db:reset                          # creates the schema and loads demo data (deletes existing data)
npm run dev:server                        # API on http://localhost:4000
npm run dev:client                        # app on http://localhost:5173 (proxies /api)
```

Production: `npm run build && npm start`. One Node process serves the API and the built app on `PORT`.

**Demo logins** (password `Fresh@123`): `barista`, `manager`, `supervisor`, `opshead`, `cbo`, `scm`, `finance`, `vendor`, `admin` — all `@freshmakers.in`. The login screen has one-tap buttons for each.

## How the brief maps to the app

| Brief | Where it lives |
|---|---|
| User flow Barista → Manager → Supervisor → Ops Head → CBO → SCM → Vendors → Finance | Indent approval chain (configurable in *Users & access*), SCM fulfilment, vendor portal, finance |
| Site linkage Ingredients → Sites → Customer company → Region | `items` → `sites` → `clients` → `regions`; every dashboard and report can be sliced by region, company or site |
| Goods: Supply / MRP / Store purchase, with rates | `items.category`, vendor buy rates, client sell rates (both keep a dated history), MRP pricing for MRP goods |
| Inventory → consumption → indent (future date) → fulfilment (warehouse + outside purchase with rates) → real-time stock | Daily consumption, Indents, Dispatches, Local purchases, Purchase orders/GRN. Everything posts to one **stock ledger**, so stock is always current |
| Dashboard: RM supply & consumption trend, indents open/closed, payment status (vendor & RM-wise) | Dashboard (region / company / site / goods type / item / date range) |
| Reports with slicers | Reports: 11 datasets, grouping by any mix of dimensions, chart, CSV export |

### Covered requirements
- **Buy from vendors vs dispatch to sites**: POs, GRNs, dispatch reports
- **Ordered vs received**: PO lines track ordered, received, rejected and pending quantities. Sites confirm the quantity actually received from each dispatch, and shortages are flagged
- **Local market purchases for shortages**, with the price paid and the payment mode (cash/UPI paid immediately, credit becomes a payable)
- **Daily site usage and wastage**, entered as a quick grid per site per day
- **Stock available and tomorrow's requirement**: a planner uses average use × days of cover + reorder level − stock − in transit − already indented, and can raise the indents in one click
- **Purchase and selling prices**: vendor rates, client rates, a margin report, and a vendor vs local-market price comparison
- **Vendor payment terms, payments to vendors, payments from clients**: bills are created automatically from GRNs and local purchases, with due dates from the terms. Invoices are created automatically when a site acknowledges a dispatch. Part payments and ageing are supported
- **Attendance and deployment**: per-site daily sheet (P/A/HD/L/WO/OT), monthly summary with payable days and estimated wages, deployment history, coverage gaps
- **MOQ and reorder alerts**: a PO below MOQ, or at a rate different from the agreed one, needs explicit confirmation. Site and warehouse reorder levels can be overridden per site

### Enhancements beyond the brief
- **Role-based data scope**: baristas, managers and supervisors see only their assigned sites, an ops head sees their region, a vendor sees only their own POs and bills
- **Vendor portal**: vendors acknowledge POs and track their bills and payments
- **Alerts centre**: reorder (site and warehouse), overdue indents, unacknowledged dispatches, missing consumption entries, late POs, expiring batches, vendor dues, client collections, approvals waiting on you
- **Inventory tools**: stock ledger with running balance, physical stock count with automatic adjustments, site-to-site and warehouse transfers, batch/expiry capture at GRN, days-of-cover, weighted-average costing
- **Safeguards**: no negative stock, no future-dated consumption, indents cannot have past required dates, overpayment checks, audit log, login throttling
- **Phone-first design**: bottom tab bar per role, tables turn into cards on phones, filters collapse, dialogs become bottom sheets, dark mode

## Masters import and export
*Setup → Masters* lists every master with **Template**, **Export**, **Import** and **Manage** actions. Files are CSV (opens in Excel; save as "CSV UTF-8").
- Import upserts on the natural key (code, or vendor/customer + item + effective date for rates). Blank cells keep the current value on existing records.
- Every import is previewed first and is all-or-nothing: one bad row means nothing is saved.
- Import in dependency order: Regions → Customers → Sites; Items and Vendors → rates. Rows starting with `#` are ignored, so template hint and example rows are safe to leave in.
- Import and export follow the role access table. Users and deployments are not included.

## Roles, access and audit
- *Setup → Users, roles & access* manages logins, custom roles and a View / Edit table per role. The server enforces the table on every request. Admin always has full access, and only an admin can change role access.
- Built-in role codes still drive workflow (indent approval stages, SCM fulfilment). Custom roles get permissions and a data scope (all sites, region or assigned sites) but are not approval stages.
- *Setup → Audit log* shows every create, update and delete with who, when, and before/after values. Database triggers record it, covering every table except the stock ledger (derived from audited documents) and document counters; the log itself cannot be edited.
- Upgrade an existing database with `npm --prefix server run db:migrate`. It only adds to the schema and keeps your data.


## Key business rules
- **Approval chain** (default Manager → Supervisor → Ops Head → CBO): stages at or below the raiser's role are skipped. Approvers can reduce quantities, reject (a reason is required) or send back to draft. After the last stage the indent goes to SCM, who fulfils it by warehouse dispatch, local purchase or a PO delivered directly to the site. Status moves to Partial or Fulfilled automatically.
- **Stock** is the sum of `stock_ledger` movements: OPENING, GRN, LOCAL_PURCHASE, DISPATCH_OUT/IN, CONSUMPTION, WASTAGE, ADJUSTMENT, TRANSFER_OUT/IN.
- **Client billing** uses the client-specific rate on the dispatch date. If there is none, MRP is used for MRP goods and the standard sell rate otherwise.

## API overview (all under `/api`, JWT bearer auth)
`auth/login`, `auth/me` · `lookups` · CRUD: `regions`, `clients`, `sites`, `warehouses`, `items`, `vendors`, `vendor-rates`, `client-rates`, `employees`, `deployments`, `users`, `site-item-settings`, `settings` · `stock`, `stock/ledger`, `consumption(/sheet)`, `stock-counts`, `transfers`, `planner` · `indents` (+ `/:id/submit|approve|reject|send-back|cancel|close`) · `purchase-orders` (+ `/:id/grn|ack|cancel|close`) · `local-purchases` · `dispatches` (+ `/:id/receive|cancel`) · `finance/vendor-bills|vendor-payments|client-invoices|client-receipts|ageing` · `attendance(/sheet|/summary)`, `deployment-gaps` · `dashboard`, `alerts`, `reports/:key` · `master-data` (+ `/:key/template|export|import`)
