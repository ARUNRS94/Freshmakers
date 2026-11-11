import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { actor, one, q, Where } from './db.js';
import { forbidden, HttpError } from './http.js';
import { MODULES, VIEW_GATES, type Level, type ModuleKey } from './access.js';

/** A role code from the roles table. Built-in codes also drive workflow, such as approval stages. */
export type Role = string;

export type Access = Record<string, { view: boolean; edit: boolean }>;

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  role_name: string;
  username: string | null;
  /** a temporary password must be replaced before anything else */
  must_change_password: boolean;
  session_version: number;
  region_id: number | null;
  vendor_id: number | null;
  employee_id: number | null;
  /** null = all sites */
  siteIds: number[] | null;
  access: Access;
}

declare global {
  namespace Express {
    interface Request {
      user: AuthUser;
    }
  }
}

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
/** The token carries the session version it was issued under, so a password change can end it */
export const signToken = (userId: number, version: number) => jwt.sign({ uid: userId, v: version }, SECRET, { expiresIn: '12h' });

export async function loadUser(id: number): Promise<AuthUser | undefined> {
  const u = await one<any>(
    // a linked login goes by the employee's name, so people see who they are, not "Barista – Demo"
    `SELECT u.id, COALESCE(e.name, u.name) name, u.email, u.username, u.role, u.region_id, u.vendor_id, u.employee_id, u.active,
            u.must_change_password, u.session_version, e.active employee_active, r.name role_name, r.scope
     FROM users u JOIN roles r ON r.code=u.role LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=$1`,
    [id],
  );
  // leaving the company (employee made inactive) ends their access too
  if (!u || !u.active || u.employee_active === false) return undefined;
  let siteIds: number[] | null = null;
  if (u.scope === 'SITES') {
    // assigned sites plus wherever their linked employee is deployed today, so a move follows the person
    siteIds = (await q<{ site_id: number }>(
      `SELECT site_id FROM user_sites WHERE user_id=$1
       UNION SELECT d.site_id FROM deployments d WHERE d.employee_id=$2 AND d.from_date<=CURRENT_DATE AND (d.to_date IS NULL OR d.to_date>=CURRENT_DATE)`,
      [id, u.employee_id])).map((r) => r.site_id);
  } else if (u.scope === 'REGION' && u.region_id) {
    siteIds = (await q<{ id: number }>('SELECT id FROM sites WHERE region_id=$1', [u.region_id])).map((r) => r.id);
  } else if (u.scope === 'VENDOR') {
    siteIds = [];
  }
  const access: Access = {};
  if (u.role === 'ADMIN') {
    for (const m of MODULES) access[m.key] = { view: true, edit: true };
  } else {
    for (const r of await q<any>('SELECT module,can_view,can_edit FROM role_access WHERE role=$1', [u.role]))
      access[r.module] = { view: r.can_view || r.can_edit, edit: r.can_edit };
  }
  delete u.active;
  delete u.scope;
  delete u.employee_active;
  return { ...u, siteIds, access };
}

/** All someone with a temporary password can do */
const PASSWORD_PATHS = ['/auth/me', '/auth/change-password'];

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(new HttpError(401, 'Not signed in'));
  let payload: { uid: number; v?: number };
  try {
    payload = jwt.verify(h.slice(7), SECRET) as { uid: number; v?: number };
  } catch {
    return next(new HttpError(401, 'Session expired, please sign in again'));
  }
  const user = await loadUser(payload.uid);
  if (!user) return next(new HttpError(401, 'Account disabled or missing'));
  if ((payload.v ?? 0) !== user.session_version)
    return next(new HttpError(401, 'Your password was changed. Please sign in again.'));
  if (user.must_change_password && !PASSWORD_PATHS.includes(req.path))
    return next(new HttpError(403, 'Choose a new password to continue'));
  req.user = user;
  actor.run({ userId: user.id }, next);
}

export const hasAccess = (user: AuthUser, module: ModuleKey, level: Level = 'view') =>
  user.role === 'ADMIN' || !!user.access[module]?.[level];

export const need =
  (module: ModuleKey, level: Level = 'edit') =>
  (req: Request, _res: Response, next: NextFunction) =>
    next(hasAccess(req.user, module, level) ? undefined : forbidden());

/** Applies the role access table to every read endpoint */
export function viewGate(req: Request, _res: Response, next: NextFunction) {
  if (req.method !== 'GET') return next();
  const gate = VIEW_GATES.find((g) => req.path === g.path || req.path.startsWith(g.path + '/'));
  if (!gate || hasAccess(req.user, gate.module, gate.level) || (gate.orEdit && hasAccess(req.user, gate.orEdit, 'edit'))) return next();
  next(forbidden());
}

export function canAccessSite(user: AuthUser, siteId: number) {
  return user.siteIds === null || user.siteIds.includes(Number(siteId));
}
export function assertSite(user: AuthUser, siteId: number) {
  if (!canAccessSite(user, siteId)) throw forbidden('You are not assigned to this site');
}

/**
 * Applies the standard dashboard/report slicers (region, client, site) and
 * the user's data scope to a query joined to `sites` as alias `s`.
 */
export function siteFilters(req: Request, w: Where, alias = 's') {
  const { region_id, client_id, site_id } = req.query as Record<string, string | undefined>;
  if (region_id) w.add(`${alias}.region_id = ?`, Number(region_id));
  if (client_id) w.add(`${alias}.client_id = ?`, Number(client_id));
  if (site_id) w.add(`${alias}.id = ?`, Number(site_id));
  if (req.user.siteIds !== null) w.add(`${alias}.id = ANY(?)`, req.user.siteIds);
  return w;
}
