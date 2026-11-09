import { Router, type Request } from 'express';
import type { PoolClient } from 'pg';
import { one, pool, q, tx, type Db } from '../lib/db.js';
import { bad, forbidden, notFound, today } from '../lib/http.js';
import { parseCsv } from '../lib/csv.js';
import { audit } from '../lib/stock.js';
import { hasAccess } from '../lib/auth.js';
import { describeField, guardFormula, MASTERS, parseCell, type MasterDef, type Ref } from '../lib/masterData.js';

const r = Router();

const canView = (req: Request, d: MasterDef) => hasAccess(req.user, d.module, 'view');
const canEdit = (req: Request, d: MasterDef) => hasAccess(req.user, d.module, 'edit');

function master(req: Request) {
  const def = MASTERS.find((m) => m.key === req.params.key);
  if (!def) throw notFound('Master');
  if (!canView(req, def)) throw forbidden();
  return def;
}

/** Ops heads and other scoped users only reach their own sites */
const siteScope = (req: Request, def: MasterDef) => (def.key === 'sites' ? req.user.siteIds : null);

const columnsOf = (def: MasterDef) => def.fields.map((f) => ({ key: f.column, label: f.label }));

r.get('/', async (req, res) => {
  const visible = MASTERS.filter((d) => canView(req, d));
  const counts = await Promise.all(visible.map((d) => {
    const scope = siteScope(req, d);
    return scope === null
      ? one<{ n: number }>(`SELECT COUNT(*)::int n FROM ${d.table}`)
      : one<{ n: number }>(`SELECT COUNT(*)::int n FROM ${d.table} WHERE id = ANY($1)`, [scope]);
  }));
  res.json(visible.map((d, i) => ({
    key: d.key, label: d.label, manage: d.manage, needs: d.needs, count: counts[i]!.n, can_import: canEdit(req, d),
    match_on: d.fields.filter((f) => f.key).map((f) => f.label),
  })));
});

r.get('/:key/template', (req, res) => {
  const def = master(req);
  const row = (cell: (f: MasterDef['fields'][number]) => string, prefix: string) =>
    Object.fromEntries(def.fields.map((f, i) => [f.column, (i === 0 ? prefix : '') + cell(f)]));
  res.json({ columns: columnsOf(def), rows: [row(describeField, '# '), row((f) => f.example, '#')] });
});

async function loadRefs(def: MasterDef, db: Db = pool) {
  const refs = new Map<Ref, { byValue: Map<string, number>; byId: Map<number, string> }>();
  for (const { ref } of def.fields) {
    if (!ref || refs.has(ref)) continue;
    const rows = await q<any>(`SELECT * FROM ${ref.table}`, [], db);
    const byValue = new Map<string, number>();
    // reversed so the first listed column wins a clash
    for (const col of [...ref.match].reverse())
      for (const row of rows) if (row[col] != null) byValue.set(String(row[col]).toLowerCase(), row.id);
    refs.set(ref, { byValue, byId: new Map(rows.map((row) => [row.id, row[ref.show]])) });
  }
  return refs;
}

r.get('/:key/export', async (req, res) => {
  const def = master(req);
  const scope = siteScope(req, def);
  const [refs, rows] = await Promise.all([
    loadRefs(def),
    scope === null ? q<any>(`SELECT * FROM ${def.table} ORDER BY id`) : q<any>(`SELECT * FROM ${def.table} WHERE id = ANY($1) ORDER BY id`, [scope]),
  ]);
  res.json({
    columns: columnsOf(def),
    rows: rows.map((row) => Object.fromEntries(def.fields.map((f) => {
      const v = row[f.column];
      if (v === null || v === undefined) return [f.column, ''];
      if (f.ref) return [f.column, refs.get(f.ref)!.byId.get(v) ?? ''];
      if (f.type === 'bool') return [f.column, v ? 'Yes' : 'No'];
      return [f.column, typeof v === 'string' ? guardFormula(v) : v];
    }))),
  });
});

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const ROLLBACK = new Error('rollback');
const MAX_ERRORS_RETURNED = 200;

interface RowError { row: number; column: string; message: string }

/** Validates by really writing inside a transaction, so database rules are checked too; a dry run then rolls back. */
async function runImport(def: MasterDef, csv: string, dryRun: boolean, req: Request) {
  const [header, ...rows] = parseCsv(csv);
  if (!header) throw bad('The file is empty');
  if (!rows.length) throw bad('The file has no data rows. Rows starting with # are ignored.');

  const labels = header.cells.map(normalise);
  const repeated = def.fields.find((f) => labels.filter((l) => l === normalise(f.label)).length > 1);
  if (repeated) throw bad(`The column "${repeated.label}" appears more than once`);
  const mapped = def.fields.map((f) => ({ f, idx: labels.indexOf(normalise(f.label)) }));
  const missing = mapped.filter(({ f, idx }) => idx < 0 && f.key && !f.todayIfBlank).map(({ f }) => f.label);
  if (missing.length) throw bad(`Missing column: ${missing.join(', ')}. Download the template to see the expected headings.`);
  const known = new Set(def.fields.map((f) => normalise(f.label)));
  const warnings = header.cells.filter((c, i) => c.trim() && !known.has(labels[i])).map((c) => `Ignored unknown column "${c.trim()}"`);

  const keyFields = def.fields.filter((f) => f.key);
  const keyOf = (v: Record<string, unknown>) => keyFields.map((f) => String(v[f.column]).toLowerCase()).join('\u0000');
  const scope = siteScope(req, def);

  const errors: RowError[] = [];
  let created = 0, updated = 0, unchanged = 0;

  const importRows = async (c: PoolClient) => {
    const refs = await loadRefs(def, c);
    const existing = new Map((await q<any>(`SELECT * FROM ${def.table}`, [], c)).map((row) => [keyOf(row), row]));
    const seen = new Map<string, number>();

    for (const { line, cells } of rows) {
      const values: Record<string, unknown> = {};
      const rowErrors: RowError[] = [];
      const fail = (column: string, message: string) => rowErrors.push({ row: line, column, message });
      const invalid = new Set<string>();

      for (const { f, idx } of mapped) {
        const raw = idx < 0 ? '' : (cells[idx] ?? '').trim();
        if (!raw) {
          if (f.todayIfBlank) values[f.column] = today();
          continue;
        }
        if (f.ref) {
          const id = refs.get(f.ref)!.byValue.get(raw.toLowerCase());
          if (id === undefined) { invalid.add(f.column); fail(f.label, `No ${f.ref.noun} matches "${raw}"`); } else values[f.column] = id;
          continue;
        }
        const parsed = parseCell(f, raw);
        if ('error' in parsed) { invalid.add(f.column); fail(f.label, parsed.error); } else values[f.column] = parsed.value;
      }

      const keyComplete = keyFields.every((f) => values[f.column] !== undefined);
      for (const f of keyFields) if (values[f.column] === undefined && !invalid.has(f.column)) fail(f.label, 'is required');

      const key = keyComplete ? keyOf(values) : null;
      const found = key === null ? undefined : existing.get(key);
      if (key !== null) {
        const first = seen.get(key);
        if (first) fail(keyFields.map((f) => f.label).join(' + '), `Same record as row ${first}`);
        else seen.set(key, line);
      }
      if (keyComplete && !found)
        for (const f of def.fields) if (f.required && values[f.column] === undefined && !invalid.has(f.column)) fail(f.label, 'is required for a new record');
      if (scope !== null) {
        if (found && !scope.includes(found.id)) fail(keyFields[0].label, 'This site is outside your region');
        if (values.region_id !== undefined && values.region_id !== req.user.region_id) fail('Region', 'You can only use your own region');
      }
      if (rowErrors.length) { errors.push(...rowErrors); continue; }

      const columns = Object.keys(values).filter((col) => !found
        || (!keyFields.some((f) => f.column === col) && String(found[col] ?? '') !== String(values[col])));
      if (found && !columns.length) { unchanged++; continue; }

      const params = columns.map((col) => values[col]);
      await c.query('SAVEPOINT import_row');
      try {
        if (found) await c.query(`UPDATE ${def.table} SET ${columns.map((col, i) => `${col}=$${i + 1}`).join(',')} WHERE id=$${columns.length + 1}`, [...params, found.id]);
        else await c.query(`INSERT INTO ${def.table}(${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, params);
        await c.query('RELEASE SAVEPOINT import_row');
        if (found) updated++; else created++;
      } catch (e: any) {
        if (!/^(22|23)/.test(e?.code ?? '')) throw e;
        await c.query('ROLLBACK TO SAVEPOINT import_row');
        errors.push({ row: line, column: '', message: e.code === '23505' ? `Duplicate value: ${e.detail ?? ''}` : e.message });
      }
    }
    if (dryRun || errors.length) throw ROLLBACK;
    await audit(c, req.user.id, 'IMPORT', def.table, undefined, { created, updated, unchanged });
  };

  try {
    await tx(importRows);
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return {
    total: rows.length, created, updated, unchanged, warnings,
    error_count: errors.length, errors: errors.slice(0, MAX_ERRORS_RETURNED),
    applied: !dryRun && errors.length === 0,
  };
}

r.post('/:key/import', async (req, res) => {
  const def = master(req);
  if (!canEdit(req, def)) throw forbidden();
  if (typeof req.body?.csv !== 'string') throw bad('csv is required');
  res.json(await runImport(def, req.body.csv, req.body.dry_run !== false, req));
});

export default r;
