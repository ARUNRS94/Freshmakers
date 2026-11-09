import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { one, q, Where } from './db.js';
import { forbidden, HttpError } from './http.js';

export type Role = 'ADMIN' | 'BARISTA' | 'MANAGER' | 'SUPERVISOR' | 'OPS_HEAD' | 'CBO' | 'SCM' | 'VENDOR' | 'FINANCE';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  region_id: number | null;
  vendor_id: number | null;
  employee_id: number | null;
  /** null = all sites */
  siteIds: number[] | null;
}

declare global {
  namespace Express {
    interface Request {
      user: AuthUser;
    }
  }
}

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
export const signToken = (userId: number) => jwt.sign({ uid: userId }, SECRET, { expiresIn: '12h' });

/** Roles whose visibility is restricted to assigned sites */
const SITE_SCOPED: Role[] = ['BARISTA', 'MANAGER', 'SUPERVISOR'];

export async function loadUser(id: number): Promise<AuthUser | undefined> {
  const u = await one<any>(
    'SELECT id,name,email,role,region_id,vendor_id,employee_id,active FROM users WHERE id=$1',
    [id],
  );
  if (!u || !u.active) return undefined;
  let siteIds: number[] | null = null;
  if (SITE_SCOPED.includes(u.role)) {
    siteIds = (await q<{ site_id: number }>('SELECT site_id FROM user_sites WHERE user_id=$1', [id])).map((r) => r.site_id);
  } else if (u.role === 'OPS_HEAD' && u.region_id) {
    siteIds = (await q<{ id: number }>('SELECT id FROM sites WHERE region_id=$1', [u.region_id])).map((r) => r.id);
  } else if (u.role === 'VENDOR') {
    siteIds = [];
  }
  delete u.active;
  return { ...u, siteIds };
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(new HttpError(401, 'Not signed in'));
  try {
    const payload = jwt.verify(h.slice(7), SECRET) as { uid: number };
    const user = await loadUser(payload.uid);
    if (!user) return next(new HttpError(401, 'Account disabled or missing'));
    req.user = user;
    next();
  } catch {
    next(new HttpError(401, 'Session expired, please sign in again'));
  }
}

export const allow =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (req.user.role === 'ADMIN' || roles.includes(req.user.role)) return next();
    next(forbidden());
  };

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
