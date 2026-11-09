import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api';
import { useApi, useQueryState, useSite } from '../lib/hooks';
import { addDays, ATT_LABEL, fmtDate, money, num, today } from '../lib/format';
import { Card, ErrorBox, PageHeader, Spinner, Tabs, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { SliceBar } from '../components/Filters';
import { SearchBox, Seg, SiteSelect } from '../components/QuickEntry';
import { useAuth } from '../lib/auth';

const STATUSES = ['P', 'A', 'HD', 'L', 'WO', 'OT'];

export default function Attendance() {
  const [f, set] = useQueryState({ tab: 'mark' });
  return (
    <>
      <PageHeader title="Attendance" subtitle="Enter daily attendance for the staff deployed at each site" />
      <Tabs value={f.tab} onChange={(t) => set({ tab: t })} tabs={[{ value: 'mark', label: 'Enter attendance' }, { value: 'summary', label: 'Monthly summary' }]} />
      {f.tab === 'summary' ? <Summary f={f} set={set} /> : <Mark f={f} set={set} />}
    </>
  );
}

type P = { f: Record<string, string>; set: (p: Record<string, string | undefined>) => void };
type Value = { s: string; i: string; o: string };

const fromRow = (e: any): Value => ({ s: e.status ?? '', i: e.check_in?.slice(0, 5) ?? '', o: e.check_out?.slice(0, 5) ?? '' });

function Mark({ f, set }: P) {
  const { allowed } = useAuth();
  const toast = useToast();
  const [siteId, chooseSite] = useSite(f.site_id);
  const date = f.date ?? today();
  const yesterday = addDays(today(), -1);
  const { data, loading, error, reload } = useApi<any[]>(siteId ? `/attendance/sheet${qs({ site_id: siteId, date })}` : null);
  const [vals, setVals] = useState<Record<number, Value>>({});
  const [term, setTerm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const editable = allowed('attendance', 'edit');

  useEffect(() => {
    if (data) setVals(Object.fromEntries(data.map((e) => [e.employee_id, fromRow(e)])));
  }, [data]);

  const staff = data ?? [];
  const shown = staff.filter((e) => !term || `${e.name} ${e.code}`.toLowerCase().includes(term.toLowerCase()));
  const marked = staff.filter((e) => vals[e.employee_id]?.s).length;
  const dirty = staff.some((e) => JSON.stringify(vals[e.employee_id]) !== JSON.stringify(fromRow(e)));
  const update = (id: number, change: Partial<Value>) => setVals((all) => ({ ...all, [id]: { ...(all[id] ?? { s: '', i: '', o: '' }), ...change } }));

  const markAllPresent = () => setVals((all) => Object.fromEntries(staff.map((e) => {
    const v = all[e.employee_id] ?? { s: '', i: '', o: '' };
    return [e.employee_id, { ...v, s: v.s || 'P' }];
  })));

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await api('/attendance', { body: { site_id: Number(siteId), date, lines: Object.entries(vals).filter(([, v]) => v.s).map(([id, v]) => ({ employee_id: Number(id), status: v.s, check_in: v.i, check_out: v.o })) } });
      toast('Attendance saved');
      reload();
    } catch (e: any) {
      setErr(e.message);
      toast(e.message, 'err'); // Save sits below a long list, so the box at the top may be out of view
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <div className="stack" style={{ gap: '.75rem' }}>
          <div className="entry-head">
            <div className="site"><SiteSelect value={siteId} onChange={(id) => { chooseSite(id); set({ site_id: id }); }} /></div>
            <Seg label="Day" value={date} onChange={(d) => set({ date: d })} options={[{ value: yesterday, label: 'Yesterday' }, { value: today(), label: 'Today' }]} />
            <input type="date" className="input" max={today()} value={date} onChange={(e) => set({ date: e.target.value })} aria-label="Date" />
          </div>
          <div className="sheet-tools">
            <SearchBox value={term} onChange={setTerm} placeholder="Search staff…" />
            {editable && staff.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={markAllPresent}>Mark the rest present</button>}
          </div>
          <ErrorBox>{error || err}</ErrorBox>
          {loading && !data ? <Spinner /> : !staff.length ? <div className="empty">No staff deployed at this site on this date.</div> : (
            <div className="sheet">
              {!shown.length && <div className="empty">No staff match</div>}
              {shown.map((e) => {
                const v = vals[e.employee_id] ?? { s: '', i: '', o: '' };
                return (
                  <div key={e.employee_id} className={`sheet-row ${v.s ? 'picked' : ''}`}>
                    <div className="sheet-item">
                      <strong>{e.name}</strong>
                      <div className="sheet-info">{e.code} · {e.designation} · {e.shift}</div>
                    </div>
                    <div className="seg seg-lg" role="radiogroup" aria-label={`Status for ${e.name}`}>
                      {STATUSES.map((s) => <button key={s} type="button" role="radio" aria-checked={v.s === s} disabled={!editable} title={ATT_LABEL[s]} className={v.s === s ? 'active' : ''} onClick={() => update(e.employee_id, { s: v.s === s ? '' : s })}>{s}</button>)}
                    </div>
                    <div className="att-times">
                      <input className="input" type="time" disabled={!editable} value={v.i} aria-label={`${e.name} check in`} onChange={(ev) => update(e.employee_id, { i: ev.target.value })} />
                      <input className="input" type="time" disabled={!editable} value={v.o} aria-label={`${e.name} check out`} onChange={(ev) => update(e.employee_id, { o: ev.target.value })} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="muted small">{Object.entries(ATT_LABEL).map(([k, l]) => `${k} = ${l}`).join(' · ')}</p>
        </div>
      </Card>
      {editable && staff.length > 0 && (
        <div className="action-bar">
          <span className="muted small grow">{marked} of {staff.length} marked for {fmtDate(date)}{dirty ? ' · Not saved yet' : ''}</span>
          <button className="btn" disabled={busy || loading || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save attendance'}</button>
        </div>
      )}
    </>
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
