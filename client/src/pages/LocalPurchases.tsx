import { Link } from 'react-router-dom';
import { qs } from '../lib/api';
import { useApi, useQueryState } from '../lib/hooks';
import { fmtDate, money } from '../lib/format';
import { Badge, Card, Icon, PageHeader } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { SliceBar, defaultRange } from '../components/Filters';
import { useAuth } from '../lib/auth';

export default function LocalPurchases() {
  const { allowed } = useAuth();
  const [f, set] = useQueryState();
  const r = { from: f.from ?? defaultRange(30).from, to: f.to ?? defaultRange(30).to };
  const { data, loading } = useApi<any[]>(`/local-purchases${qs({ region_id: f.region_id, client_id: f.client_id, site_id: f.site_id, ...r })}`);
  return (
    <>
      <PageHeader title="Local purchases" subtitle="Store purchases and shortage buys from the local market, with the price paid"
        actions={allowed('local_purchases', 'edit') && <Link className="btn" to="/local-purchases/new"><Icon name="plus" size={16} /> Record purchase</Link>} />
      <SliceBar values={{ ...f, ...r }} set={set} show={['region', 'client', 'site', 'dates']} />
      <Card pad={false}>
        <DataTable loading={loading} rows={data} exportName="local-purchases" columns={[
          { key: 'lp_no', label: 'No.', primary: true, render: (x) => <span>{x.lp_no} <Badge tone={x.reason === 'SHORTAGE' ? 'amber' : 'gray'}>{x.reason}</Badge></span> },
          { key: 'purchase_date', label: 'Date', render: (x) => fmtDate(x.purchase_date) },
          { key: 'location_name', label: 'Site' },
          { key: 'vendor_name', label: 'Bought from' },
          { key: 'lines', label: 'Items', value: (x) => (x.lines ?? []).map((l: any) => l.item_name).join(', '),
            render: (x) => <span className="small">{(x.lines ?? []).map((l: any) => `${l.item_name} ${l.qty} ${l.uom} @ ₹${l.rate}`).join(', ')}</span> },
          { key: 'payment_mode', label: 'Paid by', render: (x) => <Badge tone={x.payment_mode === 'CREDIT' ? 'amber' : 'green'}>{x.payment_mode}</Badge> },
          { key: 'indent_no', label: 'Indent', hideMobile: true },
          { key: 'amount', label: 'Amount', align: 'right', sum: true, render: (x) => money(x.amount, true) },
        ]} />
      </Card>
    </>
  );
}
