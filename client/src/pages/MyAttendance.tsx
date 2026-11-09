import { useState } from 'react';
import { api, qs } from '../lib/api';
import { useApi, useQueryState } from '../lib/hooks';
import { ATT_LABEL, fmtDate, today } from '../lib/format';
import { Badge, Card, ErrorBox, Icon, PageHeader, Spinner, Stat, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';

const time = (v?: string | null) => v?.slice(0, 5) ?? '—';

export default function MyAttendance() {
  const toast = useToast();
  const [f, set] = useQueryState();
  const month = f.month ?? today().slice(0, 7);
  const { data, loading, error, reload } = useApi<any>(`/attendance/me${qs({ month })}`);
  const [busy, setBusy] = useState(false);

  const mark = async (action: 'in' | 'out') => {
    setBusy(true);
    try {
      await api('/attendance/me', { body: { action } });
      toast(action === 'in' ? 'Checked in' : 'Checked out');
      reload();
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const header = <PageHeader title="My attendance" subtitle="Check in when you start and check out when you finish" />;
  if (loading && !data) return <>{header}<Spinner /></>;
  if (data && !data.linked) return <>{header}<Card><div className="empty">Your login is not linked to an employee record. Ask an admin to link it under Users, roles &amp; access.</div></Card></>;

  const t = data?.today;
  const canIn = !!data?.deployment && !t;
  const canOut = !!t?.check_in && !t?.check_out;
  const rows: any[] = data?.rows ?? [];
  const count = (...s: string[]) => rows.filter((r) => s.includes(r.status)).length;

  return (
    <>
      {header}
      <ErrorBox>{error}</ErrorBox>
      {data && (
        <Card>
          <div className="check-card">
            <div>
              <strong>{data.employee.name}</strong> <span className="muted small">{data.employee.code} · {data.employee.designation}</span>
              <div className="muted small">{data.deployment ? `${data.deployment.site_name} · ${data.deployment.shift} shift` : 'Not deployed at a site today'}</div>
              <div className="small" style={{ marginTop: '.3rem' }}>
                {t ? <><Badge>{t.status}</Badge> In {time(t.check_in)} · Out {time(t.check_out)}</> : <span className="muted">Not marked yet today</span>}
              </div>
            </div>
            {canOut
              ? <button className="btn" disabled={busy} onClick={() => mark('out')}><Icon name="logout" /> Check out</button>
              : <button className="btn" disabled={busy || !canIn} onClick={() => mark('in')}><Icon name="check" /> {t ? 'Done for today' : 'Check in'}</button>}
          </div>
        </Card>
      )}
      <Card title={<input type="month" className="input" style={{ width: 170 }} value={month} max={today().slice(0, 7)} onChange={(e) => set({ month: e.target.value })} aria-label="Month" />} pad={false}>
        <div className="card-body">
          <div className="stats">
            <Stat label="Present">{count('P', 'OT')}</Stat>
            <Stat label="Half day">{count('HD')}</Stat>
            <Stat label="Absent">{count('A')}</Stat>
            <Stat label="Leave">{count('L')}</Stat>
            <Stat label="Week off">{count('WO')}</Stat>
          </div>
        </div>
        <DataTable rows={rows} search={false} rowKey={(r) => r.att_date} empty="No attendance this month" columns={[
          { key: 'att_date', label: 'Date', primary: true, render: (r) => fmtDate(r.att_date) },
          { key: 'status', label: 'Status', render: (r) => <span title={ATT_LABEL[r.status]}><Badge>{r.status}</Badge> {ATT_LABEL[r.status]}</span> },
          { key: 'check_in', label: 'In', render: (r) => time(r.check_in) },
          { key: 'check_out', label: 'Out', render: (r) => time(r.check_out) },
          { key: 'site_name', label: 'Site' },
        ]} />
      </Card>
    </>
  );
}
