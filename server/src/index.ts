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

// naive in-memory login throttle
const attempts = new Map<string, { n: number; at: number }>();
app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email ?? '').toLowerCase().trim();
  const password = String(req.body?.password ?? '');
  if (!email || !password) throw bad('Email and password are required');
  const a = attempts.get(email);
  if (a && a.n >= 8 && Date.now() - a.at < 10 * 60e3) throw new HttpError(429, 'Too many attempts, try again in 10 minutes');
  const u = await one<any>('SELECT id, password_hash, active FROM users WHERE email=$1', [email]);
  if (!u || !u.active || !(await bcrypt.compare(password, u.password_hash))) {
    attempts.set(email, { n: (a && Date.now() - a.at < 10 * 60e3 ? a.n : 0) + 1, at: Date.now() });
    throw new HttpError(401, 'Invalid email or password');
  }
  attempts.delete(email);
  res.json({ token: signToken(u.id), user: await loadUser(u.id) });
});

app.use('/api', authenticate);
app.get('/api/auth/me', (req, res) => res.json(req.user));
app.post('/api/auth/change-password', async (req, res) => {
  const { current, next } = req.body ?? {};
  const u = await one<any>('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(current ?? ''), u.password_hash))) throw bad('Current password is incorrect');
  if (String(next ?? '').length < 6) throw bad('New password must be at least 6 characters');
  await q('UPDATE users SET password_hash=$2 WHERE id=$1', [req.user.id, await bcrypt.hash(String(next), 10)]);
  res.json({ ok: true });
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
