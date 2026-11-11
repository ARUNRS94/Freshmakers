/**
 * Clears ALL business data and leaves a small starter set plus one admin login.
 * Keeps configuration: roles, role access and app settings (such as the indent approval chain).
 *
 *   npm run db:fresh -- --yes
 *
 * The admin password comes from FRESH_ADMIN_PASSWORD, or a random one is generated and printed once.
 * Either way it must be changed at first sign-in.
 */
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../src/lib/db.js';

const KEEP = ['roles', 'role_access', 'app_settings'];

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += chars[randomInt(chars.length)];
  return s;
}

async function id(c: PoolClient, sql: string, params: unknown[]) {
  return (await c.query(sql + ' RETURNING id', params)).rows[0].id as number;
}

async function main() {
  if (!process.argv.includes('--yes')) {
    console.log('This deletes ALL data (transactions, masters, users, audit log) and leaves a small starter set.');
    console.log('Run again with --yes to confirm:  npm run db:fresh -- --yes');
    return;
  }
  const password = process.env.FRESH_ADMIN_PASSWORD || generatePassword();
  // a generated password is always temporary; a chosen one can be kept with FRESH_ADMIN_TEMPORARY=false
  const temporary = !process.env.FRESH_ADMIN_PASSWORD || process.env.FRESH_ADMIN_TEMPORARY !== 'false';
  if (password.length < 8) throw new Error('FRESH_ADMIN_PASSWORD must be at least 8 characters');
  const today = new Date().toISOString().slice(0, 10);

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL app.audit_off = 'on'`); // a reset is not a change anyone made

    const tables = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND NOT (tablename = ANY($1))`, [KEEP])).rows
      .map((r) => `"${r.tablename}"`);
    await c.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);

    const region = await id(c, `INSERT INTO regions(name, code) VALUES ('North', 'N')`, []);
    const customer = await id(c, `INSERT INTO clients(code, name, region_id, payment_terms_days, credit_limit) VALUES ('CUST001', 'Sample Customer Pvt Ltd', $1, 30, 0)`, [region]);
    const site1 = await id(c, `INSERT INTO sites(code, name, client_id, region_id, city) VALUES ('SITE001', 'Sample Customer – Main Office', $1, $2, 'New Delhi')`, [customer, region]);
    const site2 = await id(c, `INSERT INTO sites(code, name, client_id, region_id, city) VALUES ('SITE002', 'Sample Customer – Branch Office', $1, $2, 'Gurugram')`, [customer, region]);
    await c.query(`INSERT INTO warehouses(code, name, region_id) VALUES ('WH01', 'Central Warehouse', $1)`, [region]);

    const milk = await id(c, `INSERT INTO items(code, name, category, uom, min_order_qty, reorder_level, wh_reorder_level, std_purchase_rate, std_sale_rate, gst_rate)
      VALUES ('MILK', 'Milk (Toned)', 'SUPPLY', 'LTR', 10, 5, 50, 56, 68, 0)`, []);
    const coffee = await id(c, `INSERT INTO items(code, name, category, uom, min_order_qty, reorder_level, wh_reorder_level, std_purchase_rate, std_sale_rate, gst_rate)
      VALUES ('COFFEE', 'Coffee Beans (Arabica)', 'SUPPLY', 'KG', 2, 1, 10, 900, 1150, 5)`, []);

    const dairy = await id(c, `INSERT INTO vendors(code, name, vendor_type, payment_terms_days, lead_time_days) VALUES ('V001', 'Sample Supplier', 'REGULAR', 30, 2)`, []);
    await c.query(`INSERT INTO vendors(code, name, vendor_type, payment_terms_days, lead_time_days) VALUES ('V002', 'Local Market', 'LOCAL_MARKET', 0, 0)`);
    await c.query(`INSERT INTO vendor_item_rates(vendor_id, item_id, rate, effective_from) VALUES ($1, $2, 56, $4), ($1, $3, 900, $4)`, [dairy, milk, coffee, today]);

    const barista = await id(c, `INSERT INTO employees(code, name, designation, joining_date, daily_wage) VALUES ('EMP0001', 'Sample Barista', 'Barista', $1, 700)`, [today]);
    const manager = await id(c, `INSERT INTO employees(code, name, designation, joining_date, daily_wage) VALUES ('EMP0002', 'Sample Manager', 'Site Manager', $1, 1000)`, [today]);
    await c.query(`INSERT INTO deployments(employee_id, site_id, from_date, shift) VALUES ($1, $2, $4, 'MORNING'), ($3, $2, $4, 'GENERAL')`, [barista, site1, manager, today]);
    void site2;

    await c.query(
      `INSERT INTO users(name, email, username, password_hash, role, must_change_password) VALUES ('Administrator', 'admin@freshmakers.in', 'admin', $1, 'ADMIN', $2)`,
      [await bcrypt.hash(password, 10), temporary]);

    await c.query('COMMIT');
    console.log('Done. Starter data: 1 region, 1 customer, 2 sites, 1 warehouse, 2 items, 2 vendors, 2 employees.');
    console.log(`Admin sign-in   username: admin   (or admin@freshmakers.in)   password: ${password}`);
    console.log(temporary ? 'The password must be changed at first sign-in.' : 'The password is kept as given.');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
