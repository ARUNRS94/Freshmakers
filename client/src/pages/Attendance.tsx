import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api';
import { useApi, useLookups, useQueryState } from '../lib/hooks';
import { ATT_LABEL, money, num, today } from '../lib/format';
import { Card, ErrorBox, PageHeader, Spinner, Tabs, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { SliceBar } from '../components/Filters';
import { useAuth } from '../lib/auth';

const STATUSES = ['P', 'A', 'HD', 'L', 'WO', 'OT'];

export default function Attendance() {
  const [f, set] = useQueryState({ tab: 'mark' });
  return (
    <>
      <PageHeader title="Attendance" subtitle="Daily attendance of staff deployed at each site" />
      <Tabs value={f.tab} onChange={(t) => set({ tab: t })} tabs={[{ value: 'mark', label: 'Mark attendance' }, { value: 'summary', label: 'Monthly summary' }]} />
      {f.tab === 'summary' ? <Summary f={f} set={set} /> : <Mark f={f} set={set} />}
    </>
  );
}

type P = { f: Record<string, string>; set: (p: Record<string, string | undefined>) => void };

function Mark({ f, set }: P) {
  const lk = useLookups();
  const { can } = useAuth();
  const toast = useToast();
  const siteId = f.site_id ?? (lk?.sites[0] ? String(lk.sites[0].id) : '');
  const date = f.date ?? today();
  const { data, loading, reload } = useApi<any[]>(siteId ? `/attendance/sheet${qs({ site_id: siteId, date })}` : null);
  const [vals, setVals] = useState<Record<number, { s: string; i: string; o: string }>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const editable = can('MANAGER', 'SUPERVISOR', 'OPS_HEAD');

  useEffect(() => {
    if (data) setVals(Object.fromEntries(data.map((e) => [e.employee_id, { s: e.status ?? '', i: e.check_in?.slice(0, 5) ?? '', o: e.check_out?.slice(0, 5) ?? '' }])));
  }, [data]);

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await api('/attendance', { body: { site_id: Number(siteId), date, lines: Object.entries(vals).filter(([, v]) => v.s).map(([id, v]) => ({ employee_id: Number(id), status: v.s, check_in: v.i, check_out: v.o })) } });
      toast('Attendance saved');
      reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={
      <div className="row gap">
        <select className="input" style={{ minWidth: 220 }} value={siteId} onChange={(e) => set({ site_id: e.target.value })} aria-label="Site">
          {lk?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" className="input" style={{ width: 160 }} max={today()} value={date} onChange={(e) => set({ date: e.target.value })} aria-label="Date" />
      </div>}
      actions={editable && data?.length ? <button className="btn btn-ghost btn-sm" onClick={() => setVals(Object.fromEntries(data.map((e) => [e.employee_id, { ...(vals[e.employee_id] ?? { i: '', o: '' }), s: vals[e.employee_id]?.s || 'P' }])))}>Mark all present</button> : undefined}>
      <ErrorBox>{err}</ErrorBox>
      {loading && !data ? <Spinner /> : !data?.length ? <div className="empty">No staff deployed at this site on this date.</div> : (
        <div className="stack">
          <div className="dt-scroll">
            <table className="table">
              <thead><tr><th>Employee</th><th>Status</th><th>In</th><th>Out</th></tr></thead>
              <tbody>
                {data.map((e) => {
                  const v = vals[e.employee_id] ?? { s: '', i: '', o: '' };
                  const up = (p: Partial<typeof v>) => setVals({ ...vals, [e.employee_id]: { ...v, ...p } });
                  return (
                    <tr key={e.employee_id}>
                      <td className="td-primary" data-label="Employee">{e.name} <span className="muted small">· {e.code} · {e.designation} · {e.shift}</span></td>
                      <td data-label="Status" style={{ gridColumn: '1 / -1' }}>
                        <div className="seg" role="radiogroup" aria-label={`Status for ${e.name}`}>
                          {STATUSES.map((s) => <button key={s} type="button" disabled={!editable} title={ATT_LABEL[s]} className={v.s === s ? 'active' : ''} onClick={() => up({ s })}>{s}</button>)}
                        </div>
                      </td>
                      <td data-label="In"><input className="input" type="time" disabled={!editable} value={v.i} onChange={(ev) => up({ i: ev.target.value })} /></td>
                      <td data-label="Out"><input className="input" type="time" disabled={!editable} value={v.o} onChange={(ev) => up({ o: ev.target.value })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row gap" style={{ justifyContent: 'space-between' }}>
            <span className="muted small">{Object.entries(ATT_LABEL).map(([k, l]) => `${k} = ${l}`).join(' · ')}</span>
            {editable && <button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save attendance'}</button>}
          </div>
        </div>
      )}
    </Card>
  );
}

function Summary({ f, set }: P) {
  const month = f.month ?? today().slice(0, 7);
  const { data, loading } = useApi<any[]>(`/attendance/summary${qs({ month, region_id: f.region_id, client_id: f.client_id, site_id: f.site_id })}`);
  const n = (k: string, label: string) => ({ key: k, label, align: 'right' as const, sum: true, render: (r: any) => num(r[k]) });
  return (
    <>
      <SliceBar values={f} set={set} show={['region', 'client', 'site']} extra={<input type="month" className="input" style={{ width: 170 }} value={month} onChange={(e) => set({ month: e.target.value })} aria-label="Month" />} />
      <Card pad={false}>
        <DataTable loading={loading} rows={data} exportName={`attendance-${month}`} rowKey={(r) => `${r.employee_id}-${r.site_name}`} columns={[
          { key: 'name', label: 'Employee', primary: true, render: (r) => <span>{r.name} <span className="muted small">{r.code}</span></span> },
          { key: 'site_name', label: 'Site' },
          n('present', 'Present'), n('half_day', 'Half day'), n('overtime', 'OT'), n('absent', 'Absent'), n('leave', 'Leave'), n('week_off', 'Week off'),
          n('payable_days', 'Payable days'),
          { key: 'wages', label: 'Est. wages', align: 'right', sum: true, value: (r) => (r.daily_wage ? r.payable_days * r.daily_wage : 0), render: (r) => money(r.wages ?? (r.daily_wage ? r.payable_days * r.daily_wage : 0)) },
        ]} />
      </Card>
    </>
  );
}
