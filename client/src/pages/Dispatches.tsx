import { useNavigate } from 'react-router-dom';
import { useApi, useQueryState } from '../lib/hooks';
import { qs } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { Badge, Card, Icon, PageHeader, Tabs } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { SliceBar, defaultRange } from '../components/Filters';
import { useAuth } from '../lib/auth';

export default function Dispatches() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [f, set] = useQueryState({ status: 'IN_TRANSIT' });
  const r: Record<string, string> = f.status === 'IN_TRANSIT' ? {} : { from: f.from ?? defaultRange(14).from, to: f.to ?? defaultRange(14).to };
  const { data, loading } = useApi<any[]>(`/dispatches${qs({ status: f.status === 'ALL' ? undefined : f.status, region_id: f.region_id, client_id: f.client_id, site_id: f.site_id, ...r })}`);
  return (
    <>
      <PageHeader title="Dispatches" subtitle="Warehouse → site supply. Sites acknowledge what they actually received."
        actions={can('SCM') && <button className="btn" onClick={() => nav('/dispatches/new')}><Icon name="plus" size={16} /> New dispatch</button>} />
      <Tabs value={f.status} onChange={(s) => set({ status: s })} tabs={[{ value: 'IN_TRANSIT', label: 'In transit' }, { value: 'RECEIVED', label: 'Received' },
        { value: 'CANCELLED', label: 'Cancelled' }, { value: 'ALL', label: 'All' }]} />
      <SliceBar values={{ ...f, ...r }} set={set} show={f.status === 'IN_TRANSIT' ? ['region', 'client', 'site'] : ['region', 'client', 'site', 'dates']} />
      <Card pad={false}>
        <DataTable loading={loading} rows={data} exportName="dispatches" onRowClick={(x) => nav(`/dispatches/${x.id}`)} columns={[
          { key: 'dispatch_no', label: 'Dispatch', primary: true },
          { key: 'site_name', label: 'Site', render: (x) => <span>{x.site_name}<br /><span className="muted small">{x.client_name}</span></span> },
          { key: 'warehouse_name', label: 'From', hideMobile: true },
          { key: 'dispatch_date', label: 'Date', render: (x) => fmtDate(x.dispatch_date) },
          { key: 'indent_no', label: 'Indent' },
          { key: 'status', label: 'Status', render: (x) => <Badge>{x.status}</Badge> },
          { key: 'short', label: 'Short', align: 'right', value: (x) => (x.status === 'RECEIVED' ? x.qty_dispatched - x.qty_received : 0),
            render: (x) => (x.status === 'RECEIVED' && x.qty_dispatched - x.qty_received > 0.001 ? <span className="text-red">Yes</span> : '—') },
          { key: 'sale_value', label: 'Sale value', align: 'right', sum: true, render: (x) => money(x.sale_value) },
        ]} />
      </Card>
    </>
  );
}
