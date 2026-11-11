import { Router, type Request } from 'express';
import { q, one, Where } from './db.js';
import { need } from './auth.js';
import type { ModuleKey } from './access.js';
import { bad, notFound } from './http.js';

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
  /** access module that controls changes */
  module: ModuleKey;
  /** restrict list to user's sites using this column expression */
  siteColumn?: string;
  /** extra checks before a create, update or delete; throw to refuse */
  guard?: (req: Request, body: any, id?: string) => Promise<void>;
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

  r.post('/', need(cfg.module), async (req, res) => {
    await cfg.guard?.(req, req.body);
    const { cols, vals } = pick(req.body, false);
    const row = await one(
      `INSERT INTO ${cfg.table}(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
      vals,
    );
    res.status(201).json(row);
  });

  r.put('/:id', need(cfg.module), async (req, res) => {
    await cfg.guard?.(req, req.body, String(req.params.id));
    const { cols, vals } = pick(req.body, true);
    const row = await one(
      `UPDATE ${cfg.table} SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(',')} WHERE id=$${cols.length + 1} RETURNING *`,
      [...vals, req.params.id],
    );
    if (!row) throw notFound();
    res.json(row);
  });

  r.delete('/:id', need(cfg.module), async (req, res) => {
    await cfg.guard?.(req, {}, String(req.params.id));
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
