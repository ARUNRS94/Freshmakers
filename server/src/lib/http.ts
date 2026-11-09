import type { Request, Response, NextFunction } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
export const bad = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);
export const forbidden = (msg = 'You do not have permission for this action') => new HttpError(403, msg);

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  // Postgres errors
  if (err?.code === '23505') return res.status(409).json({ error: 'Duplicate value: ' + (err.detail ?? '') });
  if (err?.code === '23503') return res.status(409).json({ error: 'Linked record missing or record is in use: ' + (err.detail ?? '') });
  if (['23514', '22P02', '23502', '22007', '22008'].includes(err?.code))
    return res.status(400).json({ error: 'Invalid data: ' + (err.message ?? '') });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

/** Parse helpers for query/body values */
export const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) throw bad(`Invalid number: ${v}`);
  return n;
};
export const str = (v: unknown): string | undefined =>
  v === undefined || v === null || v === '' ? undefined : String(v).trim();
export const date = (v: unknown): string | undefined => {
  const s = str(v);
  if (s === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad(`Invalid date: ${s} (use YYYY-MM-DD)`);
  return s;
};
export function must<T>(v: T | undefined | null, name: string): T {
  if (v === undefined || v === null || (v as any) === '') throw bad(`${name} is required`);
  return v;
}
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export function lines<T = any>(v: unknown, name = 'lines'): T[] {
  if (!Array.isArray(v) || v.length === 0) throw bad(`At least one ${name.replace(/s$/, '')} is required`);
  return v as T[];
}
