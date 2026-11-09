import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useLookups, useQueryState } from '../lib/hooks';
import { money, num, fmtDate } from '../lib/format';
import { Badge, Card, ErrorBox, PageHeader, Spinner, Tabs, useToast } from '../components/ui';
import { MasterPage } from '../components/MasterPage';
import { useAuth } from '../lib/auth';

const CATS = [{ value: 'SUPPLY', label: 'Supply goods' }, { value: 'MRP', label: 'MRP goods' }, { value: 'STORE', label: 'Store purchase' }];

export default function Masters() {
  const { kind } = useParams();
  const [f, set] = useQueryState();
  const lk = useLookups();
  const { can } = useAuth();
  const regions = (lk?.regions ?? []).map((r) => ({ value: r.id, label: r.name }));
  const clients = (lk?.clients ?? []).map((c) => ({ value: c.id, label: c.name }));
  const items = (lk?.items ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.uom})` }));
  const vendors = (lk?.vendors ?? []).map((v) => ({ value: v.id, label: v.name }));

  if (kind === 'clients') {
    const tab = f.tab ?? 'clients';
    return (
      <>
        <PageHeader title="Clients & sites" subtitle="Site → Customer company → Region linkage" />
        <Tabs value={tab} onChange={(t) => set({ tab: t })} tabs={[{ value: 'clients', label: 'Clients' }, { value: 'sites', label: 'Sites' }, { value: 'regions', label: 'Regions' }, { value: 'warehouses', label: 'Warehouses' }]} />
        {tab === 'clients' && <MasterPage endpoint="/clients" title="Clients" canEdit={can('FINANCE')} newLabel="Add client"
          columns={[
            { key: 'name', label: 'Client', primary: true, render: (r) => <span>{r.name} <span className="muted small">{r.code}</span></span> },
            { key: 'region_name', label: 'Region' }, { key: 'site_count', label: 'Sites', align: 'right' },
            { key: 'contact_person', label: 'Contact', render: (r) => <span>{r.contact_person}<br /><span className="muted small">{r.phone}</span></span> },
            { key: 'payment_terms_days', label: 'Terms', align: 'right', render: (r) => `${r.payment_terms_days} d` },
            { key: 'credit_limit', label: 'Credit limit', align: 'right', render: (r) => money(r.credit_limit) },
          ]}
          fields={[
            { key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Company name', required: true },
            { key: 'region_id', label: 'Region', type: 'select', options: regions }, { key: 'gstin', label: 'GSTIN' },
            { key: 'contact_person', label: 'Contact person' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email', type: 'email' },
            { key: 'payment_terms_days', label: 'Payment terms (days)', type: 'number', defaultValue: 30 },
            { key: 'credit_limit', label: 'Credit limit (₹)', type: 'number', defaultValue: 0 },
            { key: 'billing_address', label: 'Billing address', type: 'textarea' }, { key: 'active', label: 'Active', type: 'checkbox' },
          ]} />}
        {tab === 'sites' && <MasterPage endpoint="/sites" title="Sites" canEdit={can('OPS_HEAD')} newLabel="Add site" query={qs({ client_id: f.client_id, region_id: f.region_id })}
          toolbar={<>
            <select className="input" style={{ width: 'auto' }} value={f.region_id ?? ''} onChange={(e) => set({ region_id: e.target.value })} aria-label="Region"><option value="">All regions</option>{regions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            <select className="input" style={{ width: 'auto', maxWidth: 220 }} value={f.client_id ?? ''} onChange={(e) => set({ client_id: e.target.value })} aria-label="Client"><option value="">All clients</option>{clients.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          </>}
          columns={[
            { key: 'name', label: 'Site', primary: true, render: (r) => <span>{r.name} <span className="muted small">{r.code}</span></span> },
            { key: 'client_name', label: 'Client' }, { key: 'region_name', label: 'Region' }, { key: 'city', label: 'City' },
            { key: 'contact_phone', label: 'Phone', hideMobile: true },
          ]}
          fields={[
            { key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Site name', required: true },
            { key: 'client_id', label: 'Client', type: 'select', options: clients, required: true }, { key: 'region_id', label: 'Region', type: 'select', options: regions, required: true },
            { key: 'city', label: 'City' }, { key: 'contact_phone', label: 'Phone' }, { key: 'opening_time', label: 'Opens at', hint: 'e.g. 08:00' },
            { key: 'address', label: 'Address', type: 'textarea' }, { key: 'active', label: 'Active', type: 'checkbox' },
          ]} />}
        {tab === 'regions' && <MasterPage endpoint="/regions" title="Regions" canEdit={can()} columns={[{ key: 'name', label: 'Region', primary: true }, { key: 'code', label: 'Code' }]}
          fields={[{ key: 'name', label: 'Name', required: true }, { key: 'code', label: 'Code' }, { key: 'active', label: 'Active', type: 'checkbox' }]} />}
        {tab === 'warehouses' && <MasterPage endpoint="/warehouses" title="Warehouses" canEdit={can('SCM')}
          columns={[{ key: 'name', label: 'Warehouse', primary: true }, { key: 'code', label: 'Code' }, { key: 'region_name', label: 'Region' }, { key: 'address', label: 'Address' }]}
          fields={[{ key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true }, { key: 'region_id', label: 'Region', type: 'select', options: regions },
            { key: 'address', label: 'Address', type: 'textarea' }, { key: 'active', label: 'Active', type: 'checkbox' }]} />}
      </>
    );
  }

  if (kind === 'items') {
    const tab = f.tab ?? 'items';
    return (
      <>
        <PageHeader title="Items & rates" subtitle="Goods master with MOQ and reorder levels, vendor buying rates and client selling rates" />
        <Tabs value={tab} onChange={(t) => set({ tab: t })} tabs={[{ value: 'items', label: 'Items' }, { value: 'vendor-rates', label: 'Vendor rates (buy)' },
          { value: 'client-rates', label: 'Client rates (sell)' }, { value: 'site-levels', label: 'Site reorder levels' }]} />
        {tab === 'items' && <MasterPage endpoint="/items" title="Items" canEdit={can('SCM')} newLabel="Add item" query={qs({ category: f.category })}
          toolbar={<select className="input" style={{ width: 'auto' }} value={f.category ?? ''} onChange={(e) => set({ category: e.target.value })} aria-label="Goods type"><option value="">All goods</option>{CATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>}
          columns={[
            { key: 'name', label: 'Item', primary: true, render: (r) => <span>{r.name} <span className="muted small">{r.code}</span></span> },
            { key: 'category', label: 'Type', render: (r) => <Badge>{r.category}</Badge> }, { key: 'uom', label: 'UOM' },
            { key: 'min_order_qty', label: 'MOQ', align: 'right', render: (r) => num(r.min_order_qty) },
            { key: 'reorder_level', label: 'Site reorder', align: 'right', render: (r) => num(r.reorder_level) },
            { key: 'wh_reorder_level', label: 'WH reorder', align: 'right', render: (r) => num(r.wh_reorder_level) },
            { key: 'std_purchase_rate', label: 'Std buy', align: 'right', render: (r) => money(r.std_purchase_rate, true) },
            { key: 'std_sale_rate', label: 'Std sell', align: 'right', render: (r) => money(r.std_sale_rate, true) },
            { key: 'mrp', label: 'MRP', align: 'right', render: (r) => (r.mrp ? money(r.mrp, true) : '—') },
            { key: 'gst_rate', label: 'GST', align: 'right', hideMobile: true, render: (r) => `${r.gst_rate}%` },
          ]}
          fields={[
            { key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true },
            { key: 'category', label: 'Goods type', type: 'select', options: CATS, required: true },
            { key: 'uom', label: 'Unit', type: 'select', required: true, defaultValue: 'KG', options: ['KG', 'LTR', 'PCS', 'BOX', 'PACK', 'BUNCH', 'GM', 'ML'].map((u) => ({ value: u, label: u })) },
            { key: 'min_order_qty', label: 'Min order qty (MOQ)', type: 'number', defaultValue: 0 },
            { key: 'reorder_level', label: 'Site reorder level', type: 'number', defaultValue: 0 },
            { key: 'wh_reorder_level', label: 'Warehouse reorder level', type: 'number', defaultValue: 0 },
            { key: 'std_purchase_rate', label: 'Standard buy rate (₹)', type: 'number', defaultValue: 0 },
            { key: 'std_sale_rate', label: 'Standard sell rate (₹)', type: 'number', defaultValue: 0 },
            { key: 'mrp', label: 'MRP (₹)', type: 'number', hint: 'For MRP goods' },
            { key: 'gst_rate', label: 'GST %', type: 'number', defaultValue: 0 }, { key: 'hsn_code', label: 'HSN code' },
            { key: 'shelf_life_days', label: 'Shelf life (days)', type: 'number' }, { key: 'active', label: 'Active', type: 'checkbox' },
          ]} />}
        {tab === 'vendor-rates' && <MasterPage endpoint="/vendor-rates" title="Vendor rates" canEdit={can('SCM')} newLabel="Add rate" deletable query={qs({ vendor_id: f.vendor_id })}
          toolbar={<select className="input" style={{ width: 'auto', maxWidth: 240 }} value={f.vendor_id ?? ''} onChange={(e) => set({ vendor_id: e.target.value })} aria-label="Vendor"><option value="">All vendors</option>{vendors.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
          columns={[
            { key: 'item_name', label: 'Item', primary: true }, { key: 'vendor_name', label: 'Vendor' },
            { key: 'rate', label: 'Rate', align: 'right', render: (r) => `${money(r.rate, true)}/${r.uom}` },
            { key: 'min_order_qty', label: 'Vendor MOQ', align: 'right', render: (r) => num(r.min_order_qty) },
            { key: 'effective_from', label: 'Effective', render: (r) => fmtDate(r.effective_from) },
          ]}
          fields={[{ key: 'vendor_id', label: 'Vendor', type: 'select', options: vendors, required: true }, { key: 'item_id', label: 'Item', type: 'select', options: items, required: true },
            { key: 'rate', label: 'Rate (₹)', type: 'number', required: true }, { key: 'min_order_qty', label: 'Vendor MOQ', type: 'number', defaultValue: 0 },
            { key: 'effective_from', label: 'Effective from', type: 'date', hint: 'Add a new row to revise a rate; history is kept' }]} />}
        {tab === 'client-rates' && <MasterPage endpoint="/client-rates" title="Client rates" canEdit={can('FINANCE', 'CBO')} newLabel="Add rate" query={qs({ client_id: f.client_id })}
          toolbar={<select className="input" style={{ width: 'auto', maxWidth: 240 }} value={f.client_id ?? ''} onChange={(e) => set({ client_id: e.target.value })} aria-label="Client"><option value="">All clients</option>{clients.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
          columns={[
            { key: 'item_name', label: 'Item', primary: true }, { key: 'client_name', label: 'Client' },
            { key: 'rate', label: 'Sell rate', align: 'right', render: (r) => `${money(r.rate, true)}/${r.uom}` },
            { key: 'margin', label: 'Margin vs std buy', align: 'right', value: (r) => (r.rate - r.std_purchase_rate) / r.rate, render: (r) => `${((100 * (r.rate - r.std_purchase_rate)) / r.rate).toFixed(1)}%` },
            { key: 'effective_from', label: 'Effective', render: (r) => fmtDate(r.effective_from) },
          ]}
          fields={[{ key: 'client_id', label: 'Client', type: 'select', options: clients, required: true }, { key: 'item_id', label: 'Item', type: 'select', options: items, required: true },
            { key: 'rate', label: 'Sell rate (₹)', type: 'number', required: true }, { key: 'effective_from', label: 'Effective from', type: 'date' }]} />}
        {tab === 'site-levels' && <SiteLevels />}
      </>
    );
  }

  if (kind === 'vendors') {
    return (
      <>
        <PageHeader title="Vendors" subtitle="Regular suppliers and local-market sources, with payment terms" />
        <MasterPage endpoint="/vendors" title="Vendors" canEdit={can('SCM', 'FINANCE')} newLabel="Add vendor"
          columns={[
            { key: 'name', label: 'Vendor', primary: true, render: (r) => <span>{r.name} <span className="muted small">{r.code}</span></span> },
            { key: 'vendor_type', label: 'Type', render: (r) => <Badge>{r.vendor_type}</Badge> },
            { key: 'contact_person', label: 'Contact', render: (r) => <span>{r.contact_person ?? '—'}<br /><span className="muted small">{r.phone}</span></span> },
            { key: 'payment_terms_text', label: 'Payment terms', render: (r) => r.payment_terms_text ?? `${r.payment_terms_days} days` },
            { key: 'lead_time_days', label: 'Lead time', align: 'right', render: (r) => `${r.lead_time_days} d` },
          ]}
          fields={[
            { key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true },
            { key: 'vendor_type', label: 'Type', type: 'select', defaultValue: 'REGULAR', options: [{ value: 'REGULAR', label: 'Regular vendor' }, { value: 'LOCAL_MARKET', label: 'Local market' }] },
            { key: 'gstin', label: 'GSTIN' }, { key: 'contact_person', label: 'Contact person' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email', type: 'email' },
            { key: 'payment_terms_days', label: 'Payment terms (days)', type: 'number', defaultValue: 30 },
            { key: 'payment_terms_text', label: 'Payment terms (text)', hint: 'e.g. 50% advance, balance in 30 days' },
            { key: 'lead_time_days', label: 'Lead time (days)', type: 'number', defaultValue: 2 },
            { key: 'address', label: 'Address', type: 'textarea' }, { key: 'bank_details', label: 'Bank details', type: 'textarea' },
            { key: 'active', label: 'Active', type: 'checkbox' },
          ]} />
      </>
    );
  }
  return <PageHeader title="Not found" />;
}

function SiteLevels() {
  const lk = useLookups();
  const { can } = useAuth();
  const toast = useToast();
  const [siteId, setSiteId] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!siteId && lk?.sites.length) setSiteId(String(lk.sites[0].id));
  }, [lk, siteId]);
  useEffect(() => {
    if (!siteId) return;
    setRows(null);
    api<any[]>(`/site-item-settings?site_id=${siteId}`).then(setRows).catch((e) => setErr(e.message));
  }, [siteId]);
  const save = async () => {
    try {
      await api('/site-item-settings', { method: 'PUT', body: { site_id: Number(siteId), lines: rows!.map((r) => ({ item_id: r.item_id,
        reorder_level: r.reorder_level === '' || r.reorder_level === null ? null : Number(r.reorder_level), max_level: r.max_level === '' || r.max_level === null ? null : Number(r.max_level) })) } });
      toast('Site levels saved');
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const editable = can('OPS_HEAD', 'SUPERVISOR', 'SCM');
  return (
    <Card title={<select className="input" style={{ minWidth: 240 }} value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site">{lk?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
      actions={editable && <button className="btn btn-sm" onClick={save}>Save levels</button>}>
      <ErrorBox>{err}</ErrorBox>
      <p className="muted small" style={{ marginBottom: '.75rem' }}>Override the default reorder level for this site. Leave blank to use the item default.</p>
      {!rows ? <Spinner /> : (
        <div className="dt-scroll">
          <table className="table">
            <thead><tr><th>Item</th><th className="ta-right">Default reorder</th><th>Site reorder level</th><th>Max / par level</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.item_id}>
                  <td className="td-primary" data-label="Item">{r.name} <span className="muted small">{r.uom}</span></td>
                  <td className="ta-right" data-label="Default">{num(r.default_reorder_level)}</td>
                  <td data-label="Site reorder"><input className="input" type="number" min="0" step="any" disabled={!editable} value={r.reorder_level ?? ''}
                    onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, reorder_level: e.target.value } : x)))} /></td>
                  <td data-label="Max level"><input className="input" type="number" min="0" step="any" disabled={!editable} value={r.max_level ?? ''}
                    onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, max_level: e.target.value } : x)))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
