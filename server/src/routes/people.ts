import { Router } from 'express';
import { q, tx, Where } from '../lib/db.js';
import { allow, assertSite, siteFilters } from '../lib/auth.js';
import { bad, date, num, must, today, lines } from '../lib/http.js';

const r = Router();
const STATUSES = ['P', 'A', 'HD', 'L', 'WO', 'OT'];

/** Employees deployed at a site on a date, with their attendance for that date */
r.get('/attendance/sheet', async (req, res) => {
  const siteId = must(num(req.query.site_id), 'site_id');
  const d = date(req.query.date) ?? today();
  assertSite(req.user, siteId);
  res.json(await q(
    `SELECT e.id employee_id, e.code, e.name, e.designation, dp.shift,
            a.status, a.check_in, a.check_out, a.remarks, a.site_id att_site_id
     FROM deployments dp JOIN employees e ON e.id=dp.employee_id AND e.active
     LEFT JOIN attendance a ON a.employee_id=e.id AND a.att_date=$2
     WHERE dp.site_id=$1 AND dp.from_date<=$2 AND (dp.to_date IS NULL OR dp.to_date>=$2)
     ORDER BY e.name`, [siteId, d]));
});

r.post('/attendance', allow('MANAGER', 'SUPERVISOR', 'OPS_HEAD'), async (req, res) => {
  const siteId = must(num(req.body.site_id), 'site_id');
  const d = must(date(req.body.date), 'date');
  assertSite(req.user, siteId);
  if (d > today()) throw bad('Attendance cannot be marked for a future date');
  const ls = lines<any>(req.body.lines);
  await tx(async (c) => {
    for (const l of ls) {
      if (!l.status) continue;
      if (!STATUSES.includes(l.status)) throw bad(`Invalid status ${l.status}`);
      await c.query(
        `INSERT INTO attendance(employee_id,att_date,site_id,status,check_in,check_out,remarks,marked_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (employee_id,att_date) DO UPDATE SET site_id=EXCLUDED.site_id, status=EXCLUDED.status, check_in=EXCLUDED.check_in,
           check_out=EXCLUDED.check_out, remarks=EXCLUDED.remarks, marked_by=EXCLUDED.marked_by`,
        [l.employee_id, d, siteId, l.status, l.check_in || null, l.check_out || null, l.remarks || null, req.user.id]);
    }
  });
  res.json({ ok: true });
});

/** Monthly summary per employee */
r.get('/attendance/summary', async (req, res) => {
  const month = String(req.query.month ?? today().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('month must be YYYY-MM');
  const w = siteFilters(req, new Where());
  const m = w.p(month + '-01');
  res.json(await q(
    `SELECT e.id employee_id, e.code, e.name, e.designation, s.name site_name, c.name client_name,
            COUNT(*) FILTER (WHERE a.status='P') present, COUNT(*) FILTER (WHERE a.status='OT') overtime,
            COUNT(*) FILTER (WHERE a.status='HD') half_day, COUNT(*) FILTER (WHERE a.status='A') absent,
            COUNT(*) FILTER (WHERE a.status='L') leave, COUNT(*) FILTER (WHERE a.status='WO') week_off,
            COUNT(a.id) marked_days,
            COUNT(*) FILTER (WHERE a.status IN ('P','OT')) + 0.5 * COUNT(*) FILTER (WHERE a.status='HD') payable_days,
            e.daily_wage
     FROM attendance a JOIN employees e ON e.id=a.employee_id JOIN sites s ON s.id=a.site_id JOIN clients c ON c.id=s.client_id
     WHERE a.att_date >= ${m}::date AND a.att_date < (${m}::date + INTERVAL '1 month') ${w.and}
     GROUP BY e.id, s.name, c.name ORDER BY s.name, e.name`, w.params));
});

r.get('/attendance', async (req, res) => {
  const w = siteFilters(req, new Where());
  w.add('a.att_date BETWEEN ? AND ?', date(req.query.from) ?? today(), date(req.query.to) ?? today());
  if (req.query.employee_id) w.add('a.employee_id = ?', num(req.query.employee_id));
  if (req.query.status) w.add('a.status = ?', req.query.status);
  res.json(await q(
    `SELECT a.*, e.name employee_name, e.code employee_code, s.name site_name, u.name marked_by_name FROM attendance a
     JOIN employees e ON e.id=a.employee_id JOIN sites s ON s.id=a.site_id LEFT JOIN users u ON u.id=a.marked_by
     ${w.sql} ORDER BY a.att_date DESC, s.name, e.name LIMIT 3000`, w.params));
});

/** Sites without any staff deployed today and staff with no current deployment */
r.get('/deployment-gaps', async (req, res) => {
  const w = siteFilters(req, new Where());
  const [sites, bench] = await Promise.all([
    q(`SELECT s.id, s.name, c.name client_name FROM sites s JOIN clients c ON c.id=s.client_id
       WHERE s.active AND NOT EXISTS (SELECT 1 FROM deployments d WHERE d.site_id=s.id AND d.from_date<=CURRENT_DATE
         AND (d.to_date IS NULL OR d.to_date>=CURRENT_DATE)) ${w.and} ORDER BY c.name, s.name`, w.params),
    q(`SELECT e.id, e.code, e.name, e.designation FROM employees e WHERE e.active AND NOT EXISTS (SELECT 1 FROM deployments d
       WHERE d.employee_id=e.id AND d.from_date<=CURRENT_DATE AND (d.to_date IS NULL OR d.to_date>=CURRENT_DATE)) ORDER BY e.name`),
  ]);
  res.json({ unstaffed_sites: sites, unassigned_employees: bench });
});

export default r;
