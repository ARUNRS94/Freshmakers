import { useNavigate } from 'react-router-dom';
import { useApi, useQueryState } from '../lib/hooks';
import { qs } from '../lib/api';
import { fmtDate, money, num } from '../lib/format';
import { Badge, Card, Icon, PageHeader, Tabs } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { SliceBar } from '../components/Filters';
import { useAuth } from '../lib/auth';

export default function PurchaseOrders() {
  const nav = useNavigate();
  const { can, user } = useAuth();
  const [f, set] = useQueryState({ status: 'OPEN' });
  const { data, loading } = useApi<any[]>(`/purchase-orders${qs({ status: f.status === 'ALL' ? undefined : f.status, vendor_id: f.vendor_id, from: f.from, to: f.to })}`);
  return (
    <>
      <PageHeader title={user?.role === 'VENDOR' ? 'My purchase orders' : 'Purchase orders'} subtitle="Ordered vs received from vendors"
        actions={can('SCM') && <button className="btn" onClick={() => nav('/purchase-orders/new')}><Icon name="plus" size={16} /> New PO</button>} />
      <Tabs value={f.status} onChange={(s) => set({ status: s })} tabs={[{ value: 'OPEN', label: 'Open' }, { value: 'PARTIAL', label: 'Partially received' },
        { value: 'RECEIVED', label: 'Received' }, { value: 'CLOSED', label: 'Closed' }, { value: 'CANCELLED', label: 'Cancelled' }, { value: 'ALL', label: 'All' }]} />
      {user?.role !== 'VENDOR' && <SliceBar values={f} set={set} show={['vendor', 'dates']} />}
      <Card pad={false}>
        <DataTable loading={loading} rows={data} exportName="purchase-orders" onRowClick={(r) => nav(`/purchase-orders/${r.id}`)}
          rowClass={(r) => (['OPEN', 'PARTIAL'].includes(r.status) && r.expected_date < new Date().toISOString().slice(0, 10) ? 'row-warn' : '')}
          columns={[
            { key: 'po_no', label: 'PO', primary: true, render: (r) => <span>{r.po_no} {r.vendor_ack && <Badge tone="green">Ack</Badge>}</span> },
            { key: 'vendor_name', label: 'Vendor' },
            { key: 'deliver_to', label: 'Deliver to' },
            { key: 'po_date', label: 'Date', render: (r) => fmtDate(r.po_date) },
            { key: 'expected_date', label: 'Expected', render: (r) => fmtDate(r.expected_date) },
            { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
            { key: 'received', label: 'Received', align: 'right', value: (r) => r.qty_received / (r.qty_ordered || 1), render: (r) => `${num((100 * r.qty_received) / (r.qty_ordered || 1))}%` },
            { key: 'order_value', label: 'Value', align: 'right', sum: true, render: (r) => money(r.order_value) },
          ]} />
      </Card>
    </>
  );
}
