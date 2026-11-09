import pg from 'pg';
import 'dotenv/config';

// Return NUMERIC/BIGINT as JS numbers and DATE as plain 'YYYY-MM-DD' strings
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/freshmakers',
  max: 20,
});

export type Db = pg.Pool | pg.PoolClient;

export async function q<T = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const r = await db.query(sql, params as any[]);
  return r.rows as T[];
}

export async function one<T = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | undefined> {
  const rows = await q<T>(sql, params, db);
  return rows[0];
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const res = await fn(c);
    await c.query('COMMIT');
    return res;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

/** Tiny WHERE builder: w.add('s.region_id = ?', 5) — '?' placeholders become $n */
export class Where {
  params: unknown[] = [];
  parts: string[] = [];
  add(cond: string, ...vals: unknown[]) {
    let i = 0;
    const sql = cond.replace(/\?/g, () => {
      this.params.push(vals[i++]);
      return `$${this.params.length}`;
    });
    this.parts.push(sql);
    return this;
  }
  /** add a param and return its placeholder */
  p(val: unknown) {
    this.params.push(val);
    return `$${this.params.length}`;
  }
  get sql() {
    return this.parts.length ? 'WHERE ' + this.parts.join(' AND ') : '';
  }
  get and() {
    return this.parts.length ? ' AND ' + this.parts.join(' AND ') : '';
  }
}

/** Generate document numbers like IND-2611-00042 */
export async function nextDocNo(prefix: string, db: Db): Promise<string> {
  const d = new Date();
  const ym = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const key = `${prefix}-${ym}`;
  const r = await one<{ last_no: number }>(
    `INSERT INTO doc_sequences(prefix,last_no) VALUES ($1,1)
     ON CONFLICT (prefix) DO UPDATE SET last_no = doc_sequences.last_no + 1 RETURNING last_no`,
    [key],
    db,
  );
  return `${key}-${String(r!.last_no).padStart(5, '0')}`;
}

export async function setting<T = any>(key: string, fallback: T): Promise<T> {
  const r = await one<{ value: T }>('SELECT value FROM app_settings WHERE key=$1', [key]);
  return r ? r.value : fallback;
}
