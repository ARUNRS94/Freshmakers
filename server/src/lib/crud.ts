import { Router } from 'express';
import { q, one, pool, Where } from './db.js';
import { allow, type Role } from './auth.js';
import { bad, notFound } from './http.js';
import { audit } from './stock.js';

export interface CrudConfig {
  table: string;
  /** writable columns */
  columns: string[];
  required?: string[];
  /** SELECT … FROM … joins (must alias main table as t) */
  select?: string;
  search?: string[];
  /** query-string filters mapped to column expressions */
  filters?: Record<string, string>;
  orderBy?: string;
  writeRoles: Role[];
  /** restrict list to user's sites using this column expression */
  siteColumn?: string;
}

export function crudRouter(cfg: CrudConfig) {
  const r = Router();
  const base = cfg.select ?? `SELECT t.* FROM ${cfg.table} t`;

  r.get('/', async (req, res) => {
    const w = new Where();
    const s = req.query.q ? String(req.query.q) : '';
    if (s && cfg.search?.length) {
      const ph = w.p(`%${s}%`);
      w.parts.push('(' + cfg.search.map((c) => `${c} ILIKE ${ph}`).join(' OR ') + ')');
    }
    for (const [k, col] of Object.entries(cfg.filters ?? {})) {
      const v = req.query[k];
      if (v !== undefined && v !== '') w.add(`${col} = ?`, v);
    }
    if (req.query.active === 'true') w.add('t.active = TRUE');
    if (cfg.siteColumn && req.user.siteIds !== null) w.add(`${cfg.siteColumn} = ANY(?)`, req.user.siteIds);
    res.json(await q(`${base} ${w.sql} ORDER BY ${cfg.orderBy ?? 't.id'}`, w.params));
  });

  r.get('/:id', async (req, res) => {
    const row = await one(`${base} WHERE t.id = $1`, [req.params.id]);
    if (!row) throw notFound();
    res.json(row);
  });

  const pick = (body: any, partial: boolean) => {
    const cols: string[] = [];
    const vals: unknown[] = [];
    for (const c of cfg.columns) {
      if (body[c] === undefined) continue;
      cols.push(c);
      vals.push(body[c] === '' ? null : body[c]);
    }
    if (!partial)
      for (const c of cfg.required ?? [])
        if (body[c] === undefined || body[c] === null || body[c] === '') throw bad(`${c.replace(/_/g, ' ')} is required`);
    if (!cols.length) throw bad('Nothing to save');
    return { cols, vals };
  };

  r.post('/', allow(...cfg.writeRoles), async (req, res) => {
    const { cols, vals } = pick(req.body, false);
    const row = await one(
      `INSERT INTO ${cfg.table}(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
      vals,
    );
    await audit(pool, req.user.id, 'CREATE', cfg.table, row.id);
    res.status(201).json(row);
  });

  r.put('/:id', allow(...cfg.writeRoles), async (req, res) => {
    const { cols, vals } = pick(req.body, true);
    const row = await one(
      `UPDATE ${cfg.table} SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(',')} WHERE id=$${cols.length + 1} RETURNING *`,
      [...vals, req.params.id],
    );
    if (!row) throw notFound();
    res.json(row);
  });

  r.delete('/:id', allow(...cfg.writeRoles), async (req, res) => {
    // soft delete where an active flag exists, otherwise hard delete
    const hasActive = await one(
      `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name='active'`,
      [cfg.table],
    );
    const row = hasActive
      ? await one(`UPDATE ${cfg.table} SET active=FALSE WHERE id=$1 RETURNING id`, [req.params.id])
      : await one(`DELETE FROM ${cfg.table} WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!row) throw notFound();
    res.json({ ok: true });
  });

  return r;
}
