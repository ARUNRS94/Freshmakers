import { useApi, useLookups, useQueryState } from '../lib/hooks';
import { qs } from '../lib/api';
import { money, num, qty, fmtDate } from '../lib/format';
import { Badge, Card, PageHeader, Tabs } from '../components/ui';
import { SliceBar, defaultRange } from '../components/Filters';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../lib/auth';

export default function Stock() {
  const { isRole } = useAuth();
  const [f, set] = useQueryState({ tab: 'site' });
  const tab = f.tab as 'site' | 'warehouse' | 'ledger';
  const canWh = isRole('SCM', 'CBO');
  return (
    <>
      <PageHeader title="Stock" subtitle="Real-time inventory from the stock ledger" />
      <Tabs value={tab} onChange={(t) => set({ tab: t })} tabs={[
        { value: 'site', label: 'Site stock' }, ...(canWh ? [{ value: 'warehouse' as const, label: 'Warehouse stock' }] : []), { value: 'ledger', label: 'Stock ledger' }]} />
      {tab === 'site' && <SiteStock f={f} set={set} />}
      {tab === 'warehouse' && canWh && <WhStock f={f} set={set} />}
      {tab === 'ledger' && <Ledger f={f} set={set} />}
    </>
  );
}

type P = { f: Record<string, string>; set: (p: Record<string, string | undefined>) => void };

function SiteStock({ f, set }: P) {
  const { data, loading } = useApi<any[]>(`/stock${qs({ region_id: f.region_id, client_id: f.client_id, site_id: f.site_id, category: f.category, stock_status: f.stock_status })}`);
  const alerts = data?.filter((r) => r.stock_status !== 'OK').length ?? 0;
  return (
    <>
      <SliceBar values={f} set={set} show={['region', 'client', 'site', 'category']} extra={
        <div className="seg">
          {[['', 'All'], ['ALERT', 'Reorder alerts'], ['OUT', 'Out of stock']].map(([v, l]) => (
            <button key={v} className={(f.stock_status ?? '') === v ? 'active' : ''} onClick={() => set({ stock_status: v })}>{l}</button>
          ))}
        </div>} />
      <Card pad={false} title={`${data?.length ?? 0} stock lines · ${alerts} need reorder`}>
        <DataTable loading={loading} rows={data} exportName="site-stock" rowKey={(r) => `${r.site_id}-${r.item_id}`}
          rowClass={(r) => (r.stock_status === 'OUT' ? 'row-danger' : r.stock_status === 'LOW' ? 'row-warn' : '')}
          onRowClick={(r) => set({ tab: 'ledger', site_id: String(r.site_id), item_id: String(r.item_id), warehouse_id: undefined })}
          columns={[
            { key: 'item_name', label: 'Item', primary: true, render: (r) => <span>{r.item_name} <span className="muted small">· {r.category}</span></span> },
            { key: 'site_name', label: 'Site', render: (r) => <span>{r.site_name}<br /><span className="muted small">{r.client_name}</span></span> },
            { key: 'qty', label: 'In stock', align: 'right', render: (r) => <strong>{qty(r.qty, r.uom)}</strong> },
            { key: 'in_transit', label: 'In transit', align: 'right', render: (r) => (r.in_transit ? qty(r.in_transit, r.uom) : '—') },
            { key: 'reorder_level', label: 'Reorder at', align: 'right', render: (r) => qty(r.reorder_level, r.uom) },
            { key: 'avg_daily_use', label: 'Avg/day', align: 'right', render: (r) => num(r.avg_daily_use) },
            { key: 'days_cover', label: 'Days cover', align: 'right', render: (r) => (r.days_cover === null ? '—' : <span className={r.days_cover < 1 ? 'text-red' : ''}>{num(r.days_cover)}</span>) },
            { key: 'value', label: 'Value', align: 'right', sum: true, render: (r) => money(r.value) },
            { key: 'stock_status', label: 'Status', render: (r) => <Badge>{r.stock_status}</Badge> },
          ]} />
      </Card>
    </>
  );
}

function WhStock({ f, set }: P) {
  const { data, loading } = useApi<any[]>(`/stock${qs({ location: 'warehouse', warehouse_id: f.warehouse_id, category: f.category })}`);
  return (
    <>
      <SliceBar values={f} set={set} show={['warehouse', 'category']} />
      <Card pad={false}>
        <DataTable loading={loading} rows={data} exportName="warehouse-stock" rowKey={(r) => `${r.warehouse_id}-${r.item_id}`}
          rowClass={(r) => (r.stock_status === 'OUT' ? 'row-danger' : r.stock_status === 'LOW' ? 'row-warn' : '')}
          onRowClick={(r) => set({ tab: 'ledger', warehouse_id: String(r.warehouse_id), item_id: String(r.item_id), site_id: undefined })}
          columns={[
            { key: 'item_name', label: 'Item', primary: true },
            { key: 'warehouse_name', label: 'Warehouse' },
            { key: 'qty', label: 'In stock', align: 'right', render: (r) => <strong>{qty(r.qty, r.uom)}</strong> },
            { key: 'on_order', label: 'On order', align: 'right', render: (r) => (r.on_order ? qty(r.on_order, r.uom) : '—') },
            { key: 'reorder_level', label: 'Reorder at', align: 'right', render: (r) => qty(r.reorder_level, r.uom) },
            { key: 'min_order_qty', label: 'MOQ', align: 'right', render: (r) => qty(r.min_order_qty, r.uom) },
            { key: 'avg_rate', label: 'Avg cost', align: 'right', render: (r) => money(r.avg_rate, true) },
            { key: 'value', label: 'Value', align: 'right', sum: true, render: (r) => money(r.value) },
            { key: 'stock_status', label: 'Status', render: (r) => <Badge>{r.stock_status}</Badge> },
          ]} />
      </Card>
    </>
  );
}

function Ledger({ f, set }: P) {
  const lk = useLookups();
  const range = { from: f.from ?? defaultRange(30).from, to: f.to ?? defaultRange(30).to };
  const ready = !!(f.site_id || f.warehouse_id);
  const { data, loading } = useApi<any[]>(ready ? `/stock/ledger${qs({ site_id: f.site_id, warehouse_id: f.warehouse_id, item_id: f.item_id, ...range })}` : null);
  return (
    <>
      <div className="slicebar-fields" style={{ display: 'flex' }}>
        <select className="input" value={f.site_id ? `s${f.site_id}` : f.warehouse_id ? `w${f.warehouse_id}` : ''} aria-label="Location"
          onChange={(e) => { const v = e.target.value; set(v.startsWith('s') ? { site_id: v.slice(1), warehouse_id: undefined } : { warehouse_id: v.slice(1) || undefined, site_id: undefined }); }}>
          <option value="">Choose a site / warehouse…</option>
          {lk?.warehouses.length && <optgroup label="Warehouses">{lk.warehouses.map((w) => <option key={w.id} value={`w${w.id}`}>{w.name}</option>)}</optgroup>}
          <optgroup label="Sites">{lk?.sites.map((s) => <option key={s.id} value={`s${s.id}`}>{s.name}</option>)}</optgroup>
        </select>
        <select className="input" value={f.item_id ?? ''} onChange={(e) => set({ item_id: e.target.value })} aria-label="Item">
          <option value="">All items</option>
          {lk?.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <input type="date" className="input" style={{ maxWidth: 170 }} value={range.from} onChange={(e) => set({ from: e.target.value })} aria-label="From" />
        <input type="date" className="input" style={{ maxWidth: 170 }} value={range.to} onChange={(e) => set({ to: e.target.value })} aria-label="To" />
      </div>
      <Card pad={false}>
        {!ready ? <div className="empty">Select a site or warehouse to view its stock movements.</div> : (
          <DataTable loading={loading} rows={data} exportName="stock-ledger" columns={[
            { key: 'txn_date', label: 'Date', render: (r) => fmtDate(r.txn_date) },
            { key: 'item_name', label: 'Item', primary: true },
            { key: 'txn_type', label: 'Movement', render: (r) => <Badge tone={r.qty > 0 ? 'green' : 'amber'}>{r.txn_type}</Badge> },
            { key: 'qty', label: 'Qty', align: 'right', render: (r) => <span className={r.qty < 0 ? 'text-red' : 'text-green'}>{r.qty > 0 ? '+' : ''}{qty(r.qty, r.uom)}</span> },
            { key: 'rate', label: 'Rate', align: 'right', render: (r) => money(r.rate, true) },
            { key: 'balance', label: f.item_id ? 'Balance' : 'Item balance', align: 'right', render: (r) => qty(r.balance, r.uom) },
            { key: 'created_by_name', label: 'By', hideMobile: true },
          ]} />
        )}
      </Card>
    </>
  );
}
