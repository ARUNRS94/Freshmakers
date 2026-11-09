import { useNavigate } from 'react-router-dom';
import { useApi, useQueryState } from '../lib/hooks';
import { qs } from '../lib/api';
import { fmtDate, ROLE_LABEL } from '../lib/format';
import { Badge, Card, Icon, PageHeader, Tabs } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { SliceBar } from '../components/Filters';
import { useAuth } from '../lib/auth';

export default function Indents() {
  const nav = useNavigate();
  const { allowed, isRole } = useAuth();
  const [f, set] = useQueryState({ status: 'OPEN' });
  const tab = f.awaiting_me === 'true' ? 'MINE' : f.status;
  const { data, loading } = useApi<any[]>(`/indents${qs({ region_id: f.region_id, client_id: f.client_id, site_id: f.site_id, status: tab === 'MINE' ? undefined : f.status === 'ALL' ? undefined : f.status, awaiting_me: f.awaiting_me, from: f.from, to: f.to })}`);
  return (
    <>
      <PageHeader title="Indents" subtitle="Site requisitions with future required dates, routed through the approval chain"
        actions={allowed('indents', 'edit') && <button className="btn" onClick={() => nav('/indents/new')}><Icon name="plus" size={16} /> New indent</button>} />
      <Tabs value={tab} onChange={(t) => set(t === 'MINE' ? { awaiting_me: 'true', status: undefined } : { status: t, awaiting_me: undefined })} tabs={[
        ...(isRole('MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO', 'SCM') ? [{ value: 'MINE', label: 'Needs my action' }] : []),
        { value: 'OPEN', label: 'Open' }, { value: 'PENDING', label: 'Pending approval' }, { value: 'APPROVED', label: 'Approved' },
        { value: 'PARTIAL', label: 'Partial' }, { value: 'CLOSED', label: 'Closed' }, { value: 'ALL', label: 'All' }]} />
      <SliceBar values={f} set={set} show={['region', 'client', 'site', 'dates']} />
      <Card pad={false}>
        <DataTable loading={loading} rows={data} exportName="indents" onRowClick={(r) => nav(`/indents/${r.id}`)}
          rowClass={(r) => (r.overdue ? 'row-danger' : '')}
          columns={[
            { key: 'indent_no', label: 'Indent', primary: true, render: (r) => <span>{r.indent_no} {r.priority !== 'NORMAL' && <Badge>{r.priority}</Badge>}</span> },
            { key: 'site_name', label: 'Site', render: (r) => <span>{r.site_name}<br /><span className="muted small">{r.client_name}</span></span> },
            { key: 'required_date', label: 'Required', render: (r) => <span className={r.overdue ? 'text-red' : ''}>{fmtDate(r.required_date)}{r.overdue && ' · overdue'}</span> },
            { key: 'status', label: 'Status', render: (r) => <span><Badge>{r.status}</Badge>{r.current_stage && <span className="muted small"> {ROLE_LABEL[r.current_stage]}</span>}</span> },
            { key: 'line_count', label: 'Items', align: 'right' },
            { key: 'fulfilled', label: 'Fulfilled', value: (r) => (r.total_qty ? r.fulfilled_qty / r.total_qty : 0), render: (r) => (
              <div className="row gap nowrap"><div className="progress" style={{ width: 60 }}><span style={{ width: `${Math.min(100, (100 * (r.fulfilled_qty || 0)) / (r.total_qty || 1))}%` }} /></div>
                <span className="small">{Math.round((100 * (r.fulfilled_qty || 0)) / (r.total_qty || 1))}%</span></div>) },
            { key: 'created_by_name', label: 'Raised by', hideMobile: true, render: (r) => <span>{r.created_by_name}<br /><span className="muted small">{fmtDate(r.indent_date)}</span></span> },
          ]} />
      </Card>
    </>
  );
}
