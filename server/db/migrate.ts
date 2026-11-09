import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const reset = process.argv.includes('--reset');
  const exists = (await pool.query(`SELECT to_regclass('public.users') t`)).rows[0].t;
  if (exists && !reset) {
    console.log('Schema already exists. Use "npm run db:reset" to drop and recreate it (deletes all data).');
    return;
  }
  if (reset) {
    console.log('Dropping schema public …');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }
  await pool.query(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  console.log('Schema created.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
