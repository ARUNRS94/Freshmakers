-- Freshmakers Inventory & Operations schema (PostgreSQL 14+)

CREATE TYPE user_role AS ENUM ('ADMIN','BARISTA','MANAGER','SUPERVISOR','OPS_HEAD','CBO','SCM','VENDOR','FINANCE');
CREATE TYPE item_category AS ENUM ('SUPPLY','MRP','STORE');
CREATE TYPE vendor_type AS ENUM ('REGULAR','LOCAL_MARKET');

-- ---------- Masters ----------
CREATE TABLE regions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE clients (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  region_id INT REFERENCES regions(id),
  gstin TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  billing_address TEXT,
  payment_terms_days INT NOT NULL DEFAULT 30,
  credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE sites (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  client_id INT NOT NULL REFERENCES clients(id),
  region_id INT NOT NULL REFERENCES regions(id),
  address TEXT,
  city TEXT,
  contact_phone TEXT,
  opening_time TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX ON sites(client_id);
CREATE INDEX ON sites(region_id);

CREATE TABLE warehouses (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  region_id INT REFERENCES regions(id),
  address TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE items (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category item_category NOT NULL,
  uom TEXT NOT NULL DEFAULT 'KG',
  hsn_code TEXT,
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  mrp NUMERIC(12,2),
  min_order_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(12,3) NOT NULL DEFAULT 0,     -- default site reorder level
  wh_reorder_level NUMERIC(12,3) NOT NULL DEFAULT 0,  -- warehouse reorder level
  std_purchase_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  std_sale_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  shelf_life_days INT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Site specific overrides (par / reorder level per site)
CREATE TABLE site_item_settings (
  site_id INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  reorder_level NUMERIC(12,3),
  max_level NUMERIC(12,3),
  PRIMARY KEY (site_id, item_id)
);

CREATE TABLE vendors (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  vendor_type vendor_type NOT NULL DEFAULT 'REGULAR',
  gstin TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  payment_terms_days INT NOT NULL DEFAULT 30,
  payment_terms_text TEXT,
  lead_time_days INT NOT NULL DEFAULT 2,
  bank_details TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE vendor_item_rates (
  id SERIAL PRIMARY KEY,
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  rate NUMERIC(12,2) NOT NULL,
  min_order_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (vendor_id, item_id, effective_from)
);

CREATE TABLE client_item_rates (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  rate NUMERIC(12,2) NOT NULL,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (client_id, item_id, effective_from)
);

-- ---------- People ----------
CREATE TABLE employees (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  designation TEXT NOT NULL DEFAULT 'Barista',
  phone TEXT,
  email TEXT,
  joining_date DATE,
  daily_wage NUMERIC(10,2),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  region_id INT REFERENCES regions(id),   -- scope for OPS_HEAD
  vendor_id INT REFERENCES vendors(id),   -- for VENDOR portal users
  employee_id INT REFERENCES employees(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- site scope for baristas / managers / supervisors
CREATE TABLE user_sites (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, site_id)
);

CREATE TABLE deployments (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  site_id INT NOT NULL REFERENCES sites(id),
  from_date DATE NOT NULL,
  to_date DATE,
  shift TEXT NOT NULL DEFAULT 'GENERAL',
  notes TEXT
);
CREATE INDEX ON deployments(site_id);

CREATE TABLE attendance (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  att_date DATE NOT NULL,
  site_id INT REFERENCES sites(id),
  status TEXT NOT NULL CHECK (status IN ('P','A','HD','L','WO','OT')),
  check_in TIME,
  check_out TIME,
  remarks TEXT,
  marked_by INT REFERENCES users(id),
  UNIQUE (employee_id, att_date)
);

-- ---------- Stock ledger (single source of truth) ----------
-- Exactly one of warehouse_id / site_id is set.
CREATE TABLE stock_ledger (
  id BIGSERIAL PRIMARY KEY,
  txn_date DATE NOT NULL,
  warehouse_id INT REFERENCES warehouses(id),
  site_id INT REFERENCES sites(id),
  item_id INT NOT NULL REFERENCES items(id),
  qty NUMERIC(14,3) NOT NULL,          -- +in / -out
  rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  txn_type TEXT NOT NULL,              -- OPENING, GRN, LOCAL_PURCHASE, DISPATCH_OUT, DISPATCH_IN, CONSUMPTION, WASTAGE, ADJUSTMENT, TRANSFER_OUT, TRANSFER_IN, RETURN
  ref_type TEXT,
  ref_id INT,
  notes TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((warehouse_id IS NULL) <> (site_id IS NULL))
);
CREATE INDEX ON stock_ledger(site_id, item_id);
CREATE INDEX ON stock_ledger(warehouse_id, item_id);
CREATE INDEX ON stock_ledger(txn_date);
CREATE INDEX ON stock_ledger(ref_type, ref_id);

-- ---------- Indents ----------
CREATE TABLE indents (
  id SERIAL PRIMARY KEY,
  indent_no TEXT NOT NULL UNIQUE,
  site_id INT NOT NULL REFERENCES sites(id),
  indent_date DATE NOT NULL DEFAULT CURRENT_DATE,
  required_date DATE NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  -- DRAFT, PENDING (awaiting current_stage), APPROVED (awaiting SCM), PARTIAL, FULFILLED, CLOSED, REJECTED, CANCELLED
  current_stage user_role,
  notes TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX ON indents(site_id);
CREATE INDEX ON indents(status);

CREATE TABLE indent_lines (
  id SERIAL PRIMARY KEY,
  indent_id INT NOT NULL REFERENCES indents(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  qty_requested NUMERIC(12,3) NOT NULL CHECK (qty_requested > 0),
  qty_approved NUMERIC(12,3),
  qty_fulfilled NUMERIC(12,3) NOT NULL DEFAULT 0,
  stock_at_request NUMERIC(12,3),
  remarks TEXT
);

CREATE TABLE indent_approvals (
  id SERIAL PRIMARY KEY,
  indent_id INT NOT NULL REFERENCES indents(id) ON DELETE CASCADE,
  stage user_role NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('SUBMIT','APPROVE','REJECT','SEND_BACK','FULFIL','CLOSE','CANCEL')),
  comment TEXT,
  user_id INT REFERENCES users(id),
  acted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Purchasing ----------
CREATE TABLE purchase_orders (
  id SERIAL PRIMARY KEY,
  po_no TEXT NOT NULL UNIQUE,
  vendor_id INT NOT NULL REFERENCES vendors(id),
  po_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  warehouse_id INT REFERENCES warehouses(id),
  site_id INT REFERENCES sites(id),        -- direct-to-site delivery
  indent_id INT REFERENCES indents(id),
  status TEXT NOT NULL DEFAULT 'OPEN',     -- OPEN, PARTIAL, RECEIVED, CLOSED, CANCELLED
  vendor_ack BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((warehouse_id IS NULL) <> (site_id IS NULL))
);

CREATE TABLE po_lines (
  id SERIAL PRIMARY KEY,
  po_id INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  qty_ordered NUMERIC(12,3) NOT NULL CHECK (qty_ordered > 0),
  qty_received NUMERIC(12,3) NOT NULL DEFAULT 0,
  rate NUMERIC(12,2) NOT NULL,
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0
);

CREATE TABLE grns (
  id SERIAL PRIMARY KEY,
  grn_no TEXT NOT NULL UNIQUE,
  po_id INT NOT NULL REFERENCES purchase_orders(id),
  grn_date DATE NOT NULL DEFAULT CURRENT_DATE,
  vendor_invoice_no TEXT,
  notes TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE grn_lines (
  id SERIAL PRIMARY KEY,
  grn_id INT NOT NULL REFERENCES grns(id) ON DELETE CASCADE,
  po_line_id INT NOT NULL REFERENCES po_lines(id),
  item_id INT NOT NULL REFERENCES items(id),
  qty_received NUMERIC(12,3) NOT NULL,
  qty_rejected NUMERIC(12,3) NOT NULL DEFAULT 0,
  rate NUMERIC(12,2) NOT NULL,
  batch_no TEXT,
  expiry_date DATE
);

-- Local market purchases (shortage) – delivered straight to a site or warehouse
CREATE TABLE local_purchases (
  id SERIAL PRIMARY KEY,
  lp_no TEXT NOT NULL UNIQUE,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  vendor_id INT NOT NULL REFERENCES vendors(id),
  site_id INT REFERENCES sites(id),
  warehouse_id INT REFERENCES warehouses(id),
  indent_id INT REFERENCES indents(id),
  reason TEXT NOT NULL DEFAULT 'SHORTAGE',
  bill_no TEXT,
  payment_mode TEXT NOT NULL DEFAULT 'CASH',   -- CASH, UPI, CARD, CREDIT
  purchased_by TEXT,
  notes TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((warehouse_id IS NULL) <> (site_id IS NULL))
);

CREATE TABLE local_purchase_lines (
  id SERIAL PRIMARY KEY,
  lp_id INT NOT NULL REFERENCES local_purchases(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  qty NUMERIC(12,3) NOT NULL CHECK (qty > 0),
  rate NUMERIC(12,2) NOT NULL
);

-- ---------- Dispatch to sites ----------
CREATE TABLE dispatches (
  id SERIAL PRIMARY KEY,
  dispatch_no TEXT NOT NULL UNIQUE,
  dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  warehouse_id INT NOT NULL REFERENCES warehouses(id),
  site_id INT NOT NULL REFERENCES sites(id),
  indent_id INT REFERENCES indents(id),
  vehicle_no TEXT,
  driver_name TEXT,
  status TEXT NOT NULL DEFAULT 'IN_TRANSIT',   -- IN_TRANSIT, RECEIVED, CANCELLED
  received_date DATE,
  received_by INT REFERENCES users(id),
  notes TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dispatch_lines (
  id SERIAL PRIMARY KEY,
  dispatch_id INT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  indent_line_id INT REFERENCES indent_lines(id),
  qty_dispatched NUMERIC(12,3) NOT NULL CHECK (qty_dispatched > 0),
  qty_received NUMERIC(12,3),
  cost_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_rate NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- ---------- Site operations ----------
CREATE TABLE consumption (
  id SERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES sites(id),
  entry_date DATE NOT NULL,
  item_id INT NOT NULL REFERENCES items(id),
  qty_used NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (qty_used >= 0),
  qty_wasted NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (qty_wasted >= 0),
  cups_served INT,
  remarks TEXT,
  entered_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, entry_date, item_id)
);

CREATE TABLE stock_counts (
  id SERIAL PRIMARY KEY,
  count_date DATE NOT NULL DEFAULT CURRENT_DATE,
  site_id INT REFERENCES sites(id),
  warehouse_id INT REFERENCES warehouses(id),
  notes TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((warehouse_id IS NULL) <> (site_id IS NULL))
);

CREATE TABLE stock_count_lines (
  id SERIAL PRIMARY KEY,
  count_id INT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  system_qty NUMERIC(12,3) NOT NULL,
  counted_qty NUMERIC(12,3) NOT NULL,
  reason TEXT
);

CREATE TABLE stock_transfers (
  id SERIAL PRIMARY KEY,
  transfer_no TEXT NOT NULL UNIQUE,
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  from_site_id INT REFERENCES sites(id),
  from_warehouse_id INT REFERENCES warehouses(id),
  to_site_id INT REFERENCES sites(id),
  to_warehouse_id INT REFERENCES warehouses(id),
  notes TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stock_transfer_lines (
  id SERIAL PRIMARY KEY,
  transfer_id INT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  qty NUMERIC(12,3) NOT NULL CHECK (qty > 0)
);

-- ---------- Finance ----------
CREATE TABLE vendor_bills (
  id SERIAL PRIMARY KEY,
  bill_no TEXT NOT NULL,
  vendor_id INT NOT NULL REFERENCES vendors(id),
  bill_date DATE NOT NULL,
  due_date DATE NOT NULL,
  grn_id INT REFERENCES grns(id),
  lp_id INT REFERENCES local_purchases(id),
  amount NUMERIC(14,2) NOT NULL,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vendor_bill_lines (
  id SERIAL PRIMARY KEY,
  bill_id INT NOT NULL REFERENCES vendor_bills(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  qty NUMERIC(12,3) NOT NULL,
  rate NUMERIC(12,2) NOT NULL,
  amount NUMERIC(14,2) NOT NULL
);

CREATE TABLE vendor_payments (
  id SERIAL PRIMARY KEY,
  vendor_id INT NOT NULL REFERENCES vendors(id),
  bill_id INT REFERENCES vendor_bills(id),
  pay_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  mode TEXT NOT NULL DEFAULT 'NEFT',
  reference TEXT,
  notes TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE client_invoices (
  id SERIAL PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  client_id INT NOT NULL REFERENCES clients(id),
  site_id INT REFERENCES sites(id),
  dispatch_id INT REFERENCES dispatches(id),
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE client_invoice_lines (
  id SERIAL PRIMARY KEY,
  invoice_id INT NOT NULL REFERENCES client_invoices(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  qty NUMERIC(12,3) NOT NULL,
  rate NUMERIC(12,2) NOT NULL,
  amount NUMERIC(14,2) NOT NULL
);

CREATE TABLE client_receipts (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id),
  invoice_id INT REFERENCES client_invoices(id),
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  mode TEXT NOT NULL DEFAULT 'NEFT',
  reference TEXT,
  notes TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Misc ----------
CREATE TABLE doc_sequences (
  prefix TEXT PRIMARY KEY,
  last_no INT NOT NULL DEFAULT 0
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INT,
  details JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Views ----------
CREATE VIEW v_site_stock AS
  SELECT site_id, item_id, SUM(qty) AS qty,
         SUM(CASE WHEN qty > 0 THEN qty * rate ELSE 0 END) / NULLIF(SUM(CASE WHEN qty > 0 THEN qty ELSE 0 END),0) AS avg_rate
  FROM stock_ledger WHERE site_id IS NOT NULL GROUP BY site_id, item_id;

CREATE VIEW v_wh_stock AS
  SELECT warehouse_id, item_id, SUM(qty) AS qty,
         SUM(CASE WHEN qty > 0 THEN qty * rate ELSE 0 END) / NULLIF(SUM(CASE WHEN qty > 0 THEN qty ELSE 0 END),0) AS avg_rate
  FROM stock_ledger WHERE warehouse_id IS NOT NULL GROUP BY warehouse_id, item_id;

CREATE VIEW v_vendor_bill_status AS
  SELECT b.*, COALESCE(p.paid,0) AS paid,
         (b.amount + b.tax_amount - COALESCE(p.paid,0)) AS balance,
         CASE WHEN (b.amount + b.tax_amount - COALESCE(p.paid,0)) <= 0.009 THEN 'PAID'
              WHEN COALESCE(p.paid,0) > 0 THEN 'PARTIAL' ELSE 'OPEN' END AS status
  FROM vendor_bills b
  LEFT JOIN (SELECT bill_id, SUM(amount) paid FROM vendor_payments WHERE bill_id IS NOT NULL GROUP BY bill_id) p ON p.bill_id = b.id;

CREATE VIEW v_client_invoice_status AS
  SELECT i.*, COALESCE(r.received,0) AS received,
         (i.amount + i.tax_amount - COALESCE(r.received,0)) AS balance,
         CASE WHEN (i.amount + i.tax_amount - COALESCE(r.received,0)) <= 0.009 THEN 'PAID'
              WHEN COALESCE(r.received,0) > 0 THEN 'PARTIAL' ELSE 'OPEN' END AS status
  FROM client_invoices i
  LEFT JOIN (SELECT invoice_id, SUM(amount) received FROM client_receipts WHERE invoice_id IS NOT NULL GROUP BY invoice_id) r ON r.invoice_id = i.id;

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
INSERT INTO app_settings(key, value) VALUES
  ('indent_approval_chain', '["MANAGER","SUPERVISOR","OPS_HEAD","CBO"]'),
  ('planner_days_cover', '1'),
  ('planner_lookback_days', '7'),
  ('company', '{"name":"Freshmakers","gstin":"","address":""}');

-- ---------- FK / lookup indexes ----------
CREATE INDEX ON indent_lines(indent_id);
CREATE INDEX ON indent_approvals(indent_id);
CREATE INDEX ON po_lines(po_id);
CREATE INDEX ON grn_lines(grn_id);
CREATE INDEX ON dispatch_lines(dispatch_id);
CREATE INDEX ON dispatches(site_id, status);
CREATE INDEX ON local_purchase_lines(lp_id);
CREATE INDEX ON local_purchases(site_id);
CREATE INDEX ON vendor_bill_lines(bill_id);
CREATE INDEX ON vendor_payments(bill_id);
CREATE INDEX ON client_invoice_lines(invoice_id);
CREATE INDEX ON client_receipts(invoice_id);
CREATE INDEX ON client_invoices(site_id);
CREATE INDEX ON consumption(entry_date);
CREATE INDEX ON attendance(att_date, site_id);
