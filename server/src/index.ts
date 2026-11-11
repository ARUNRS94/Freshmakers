import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { one, pool, q } from './lib/db.js';
import { authenticate, loadUser, signToken, viewGate } from './lib/auth.js';
import { bad, errorHandler, HttpError } from './lib/http.js';
import masters from './routes/masters.js';
import inventory from './routes/inventory.js';
import operations from './routes/operations.js';
import finance from './routes/finance.js';
import people from './routes/people.js';
import analytics from './routes/analytics.js';
import masterData from './routes/masterData.js';
import admin from './routes/admin.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});

const MAX_FAILURES = 8;

// counted in the database so the limit holds when several server instances run (as on Vercel)
app.post('/api/auth/login', async (req, res) => {
  const login = String(req.body?.login ?? req.body?.email ?? '').toLowerCase().trim();
  const password = String(req.body?.password ?? '');
  if (!login || !password) throw bad('Username and password are required');
  const att = await one<{ failures: number; recent: boolean }>(
    `SELECT failures, first_at > now() - INTERVAL '10 minutes' recent FROM login_attempts WHERE key=$1`, [login]);
  if (att?.recent && att.failures >= MAX_FAILURES) throw new HttpError(429, 'Too many attempts, try again in 10 minutes');
  const u = await one<any>('SELECT id, password_hash FROM users WHERE lower(email)=$1 OR lower(username)=$1 LIMIT 1', [login]);
  const user = u && (await bcrypt.compare(password, u.password_hash)) ? await loadUser(u.id) : undefined;
  if (!user) {
    await q(`INSERT INTO login_attempts(key, failures, first_at) VALUES ($1, 1, now())
             ON CONFLICT (key) DO UPDATE SET
               failures = CASE WHEN login_attempts.first_at > now() - INTERVAL '10 minutes' THEN login_attempts.failures + 1 ELSE 1 END,
               first_at = CASE WHEN login_attempts.first_at > now() - INTERVAL '10 minutes' THEN login_attempts.first_at ELSE now() END`, [login]);
    throw new HttpError(401, 'Invalid username or password');
  }
  await q('DELETE FROM login_attempts WHERE key=$1', [login]);
  res.json({ token: signToken(user.id, user.session_version), user });
});

app.use('/api', authenticate);
app.get('/api/auth/me', (req, res) => res.json(req.user));
app.post('/api/auth/change-password', async (req, res) => {
  const { current, next } = req.body ?? {};
  const u = await one<any>('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(current ?? ''), u.password_hash))) throw bad('Current password is incorrect');
  if (String(next ?? '').length < 8) throw bad('New password must be at least 8 characters');
  if (String(next) === String(current)) throw bad('Choose a password different from the current one');
  // a new session version ends every other session; this one gets a fresh token under it
  const row = await one<{ session_version: number }>(
    'UPDATE users SET password_hash=$2, must_change_password=FALSE, session_version=session_version+1 WHERE id=$1 RETURNING session_version',
    [req.user.id, await bcrypt.hash(String(next), 10)]);
  res.json({ token: signToken(req.user.id, row!.session_version), user: await loadUser(req.user.id) });
});

app.use('/api', viewGate);
app.use('/api/master-data', masterData);
app.use('/api', admin);
app.use('/api', masters);
app.use('/api', inventory);
app.use('/api', operations);
app.use('/api/finance', finance);
app.use('/api', people);
app.use('/api', analytics);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API route not found')));

// Serve the built client in production
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = [path.resolve(here, '../../client/dist'), path.resolve(here, '../../../client/dist')].find((p) => fs.existsSync(p));
if (clientDist) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use(errorHandler);

// Vercel runs the exported app itself; everywhere else this process listens
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT ?? 4000);
  app.listen(port, () => console.log(`Freshmakers API listening on http://localhost:${port}`));
}

export default app;
