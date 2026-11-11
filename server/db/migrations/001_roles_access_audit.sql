-- Roles, per-role access and full change auditing. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS roles (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  -- ALL = every site, REGION = the user's region, SITES = assigned sites, VENDOR = vendor portal
  scope TEXT NOT NULL DEFAULT 'SITES' CHECK (scope IN ('ALL','REGION','SITES','VENDOR')),
  built_in BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO roles(code,name,scope,built_in) VALUES
  ('ADMIN','Admin','ALL',TRUE), ('BARISTA','Barista','SITES',TRUE), ('MANAGER','Site Manager','SITES',TRUE),
  ('SUPERVISOR','Supervisor','SITES',TRUE), ('OPS_HEAD','Ops Head','REGION',TRUE), ('CBO','CBO','ALL',TRUE),
  ('SCM','Supply Chain','ALL',TRUE), ('VENDOR','Vendor','VENDOR',TRUE), ('FINANCE','Finance','ALL',TRUE)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS role_access (
  role TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  module TEXT NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (role, module)
);

-- roles are now data, so the columns holding them stop being a fixed enum
ALTER TABLE users ALTER COLUMN role TYPE TEXT USING role::text;
ALTER TABLE indents ALTER COLUMN current_stage TYPE TEXT USING current_stage::text;
ALTER TABLE indent_approvals ALTER COLUMN stage TYPE TEXT USING stage::text;
DROP TYPE IF EXISTS user_role;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_fkey') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_fkey FOREIGN KEY (role) REFERENCES roles(code);
  END IF;
END $$;

-- one login per employee
CREATE UNIQUE INDEX IF NOT EXISTS users_employee_unique ON users(employee_id) WHERE employee_id IS NOT NULL;

-- ---------- Audit ----------
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS old_data JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS new_data JSONB;
CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log(at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_user ON audit_log(user_id);

CREATE OR REPLACE FUNCTION fm_audit() RETURNS trigger AS $$
DECLARE
  o JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  r JSONB := COALESCE(n, o);
  k TEXT;
BEGIN
  IF current_setting('app.audit_off', TRUE) = 'on' THEN RETURN NULL; END IF;

  -- never store password hashes, but do record that a password changed
  IF r ? 'password_hash' THEN
    IF TG_OP = 'UPDATE' AND o->>'password_hash' IS DISTINCT FROM n->>'password_hash' THEN
      o := o || '{"password_hash":"(previous password)"}';
      n := n || '{"password_hash":"(new password)"}';
    ELSE
      o := o - 'password_hash';
      n := n - 'password_hash';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(n) LOOP
      IF o->k IS NOT DISTINCT FROM n->k OR k = 'updated_at' THEN
        o := o - k;
        n := n - k;
      END IF;
    END LOOP;
    IF n = '{}'::jsonb THEN RETURN NULL; END IF;
  END IF;

  INSERT INTO audit_log(user_id, action, entity, entity_id, label, old_data, new_data)
  VALUES (
    NULLIF(current_setting('app.user_id', TRUE), '')::INT,
    CASE TG_OP WHEN 'INSERT' THEN 'CREATE' WHEN 'UPDATE' THEN 'UPDATE' ELSE 'DELETE' END,
    TG_TABLE_NAME,
    CASE WHEN r->>'id' ~ '^[0-9]+$' THEN (r->>'id')::INT END,
    CASE WHEN TG_TABLE_NAME = 'role_access' THEN (r->>'role') || ' / ' || (r->>'module')
      ELSE COALESCE(r->>'indent_no', r->>'po_no', r->>'grn_no', r->>'dispatch_no', r->>'lp_no', r->>'invoice_no',
                    r->>'bill_no', r->>'code', r->>'name', r->>'email', r->>'key') END,
    o, n);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- the audit trail cannot be edited or removed by the application
CREATE OR REPLACE FUNCTION fm_audit_locked() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The audit log cannot be changed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fm_audit_locked ON audit_log;
CREATE TRIGGER fm_audit_locked BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION fm_audit_locked();

-- every table except the log itself, document counters, login attempt counters, and the stock ledger (derived from the audited documents)
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
           AND tablename NOT IN ('audit_log', 'doc_sequences', 'stock_ledger', 'login_attempts') LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS fm_audit ON %I', t);
    EXECUTE format('CREATE TRIGGER fm_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fm_audit()', t);
  END LOOP;
END $$;
