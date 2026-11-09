import { Router, type Request, type Response, type NextFunction } from 'express';
import { q, one, tx, Where } from '../lib/db.js';
import { need } from '../lib/auth.js';
import { bad, date, forbidden, notFound, num, str, today, addDays } from '../lib/http.js';
import { MODULES, type ModuleDef } from '../lib/access.js';

const r = Router();

const SCOPES = ['ALL', 'REGION', 'SITES'];

// Changing what a role can do is a route to any permission, so it stays with admins even if Users is delegated.
const adminOnly = (req: Request, _res: Response, next: NextFunction) => next(req.user.role === 'ADMIN' ? undefined : forbidden());

r.get('/roles', async (_req, res) => {
  const [roles, access] = await Promise.all([
    q(`SELECT r.*, (SELECT COUNT(*)::int FROM users u WHERE u.role=r.code AND u.active) user_count FROM roles r ORDER BY r.built_in DESC, r.name`),
    q<any>('SELECT role,module,can_view,can_edit FROM role_access'),
  ]);
  const byRole: Record<string, Record<string, { view: boolean; edit: boolean }>> = {};
  for (const a of access) (byRole[a.role] ??= {})[a.module] = { view: a.can_view, edit: a.can_edit };
  res.json({
    modules: (MODULES as readonly ModuleDef[]).map((m) => ({ key: m.key, label: m.label, group: m.group, has_view: !!m.view, has_edit: !!m.edit })),
    roles: roles.map((x: any) => ({ ...x, access: byRole[x.code] ?? {} })),
  });
});

r.post('/roles', adminOnly, async (req, res) => {
  const name = str(req.body.name);
  if (!name) throw bad('Role name is required');
  const scope = String(req.body.scope ?? 'SITES');
  if (!SCOPES.includes(scope)) throw bad('Choose what the role can see');
  const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!code) throw bad('Role name must contain letters or numbers');
  const copyFrom = str(req.body.copy_from);
  await tx(async (c) => {
    await c.query('INSERT INTO roles(code,name,scope) VALUES ($1,$2,$3)', [code, name, scope]);
    if (copyFrom) {
      await c.query(`INSERT INTO role_access(role,module,can_view,can_edit) SELECT $1,module,can_view,can_edit FROM role_access WHERE role=$2`, [code, copyFrom]);
    }
  });
  res.status(201).json({ code });
});

async function customRole(code: string) {
  const role = await one<any>('SELECT * FROM roles WHERE code=$1', [code]);
  if (!role) throw notFound('Role');
  if (role.built_in) throw bad('Built-in roles cannot be renamed or deleted');
  return role;
}

r.put('/roles/:code', adminOnly, async (req, res) => {
  const role = await customRole(String(req.params.code));
  const name = str(req.body.name) ?? role.name;
  const scope = String(req.body.scope ?? role.scope);
  if (!SCOPES.includes(scope)) throw bad('Choose what the role can see');
  await q('UPDATE roles SET name=$2, scope=$3 WHERE code=$1', [role.code, name, scope]);
  res.json({ ok: true });
});

r.delete('/roles/:code', adminOnly, async (req, res) => {
  const role = await customRole(String(req.params.code));
  const used = await one<{ n: number }>('SELECT COUNT(*)::int n FROM users WHERE role=$1', [role.code]);
  if (used!.n) throw bad(`${used!.n} user(s) still have this role. Move them to another role first.`);
  await q('DELETE FROM roles WHERE code=$1', [role.code]);
  res.json({ ok: true });
});

r.put('/roles/:code/access', adminOnly, async (req, res) => {
  const code = String(req.params.code);
  if (code === 'ADMIN') throw bad('Admin always has full access');
  if (!(await one('SELECT 1 FROM roles WHERE code=$1', [code]))) throw notFound('Role');
  const given = req.body.access;
  if (!given || typeof given !== 'object') throw bad('access is required');
  await tx(async (c) => {
    for (const m of MODULES as readonly ModuleDef[]) {
      const a = given[m.key];
      if (!a) continue;
      const edit = !!m.edit && !!a.edit;
      const view = !!m.view && (!!a.view || edit);
      await c.query(
        `INSERT INTO role_access(role,module,can_view,can_edit) VALUES ($1,$2,$3,$4)
         ON CONFLICT (role,module) DO UPDATE SET can_view=EXCLUDED.can_view, can_edit=EXCLUDED.can_edit`,
        [code, m.key, view, edit]);
    }
  });
  res.json({ ok: true });
});

/* ---- audit log ---- */
const AUDIT_LIMIT = 1000;

r.get('/audit/filters', async (_req, res) => {
  const [entities, actions, users] = await Promise.all([
    q<{ entity: string }>('SELECT DISTINCT entity FROM audit_log ORDER BY entity'),
    q<{ action: string }>('SELECT DISTINCT action FROM audit_log ORDER BY action'),
    q('SELECT DISTINCT u.id, u.name FROM audit_log a JOIN users u ON u.id=a.user_id ORDER BY u.name'),
  ]);
  res.json({ entities: entities.map((x) => x.entity), actions: actions.map((x) => x.action), users });
});

r.get('/audit', async (req, res) => {
  const to = date(req.query.to) ?? today();
  const w = new Where();
  w.add('a.at >= ?::date', date(req.query.from) ?? addDays(to, -6));
  w.add('a.at < ?::date', addDays(to, 1));
  if (req.query.user_id) w.add('a.user_id = ?', num(req.query.user_id));
  if (req.query.entity) w.add('a.entity = ?', String(req.query.entity));
  if (req.query.action) w.add('a.action = ?', String(req.query.action));
  if (req.query.entity_id) w.add('a.entity_id = ?', num(req.query.entity_id));
  res.json(await q(
    `SELECT a.*, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ${w.sql} ORDER BY a.id DESC LIMIT ${AUDIT_LIMIT}`, w.params));
});

export default r;
