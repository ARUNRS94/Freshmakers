import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/lib/db.js';
import { MODULES, type ModuleDef } from '../src/lib/access.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Adds any module a built-in role has no row for. Existing rows keep whatever an admin chose. */
async function syncAccessDefaults() {
  const roles = (await pool.query(`SELECT code FROM roles WHERE built_in AND code <> 'ADMIN'`)).rows.map((r) => r.code as string);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL app.audit_off = 'on'`);
    for (const role of roles)
      for (const m of MODULES as readonly ModuleDef[])
        await c.query('INSERT INTO role_access(role,module,can_view,can_edit) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [role, m.key, !!m.view?.includes(role) || !!m.edit?.includes(role) && !!m.view, !!m.edit?.includes(role)]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

async function main() {
  const reset = process.argv.includes('--reset');
  const exists = (await pool.query(`SELECT to_regclass('public.users') t`)).rows[0].t;
  if (reset) {
    console.log('Dropping schema public …');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }
  if (!exists || reset) {
    await pool.query(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
    console.log('Schema created.');
  }
  const dir = path.join(here, 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    console.log(`Applied ${file}`);
  }
  await syncAccessDefaults();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
