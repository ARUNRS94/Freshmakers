import { useState } from 'react';
import { useLookups } from '../lib/hooks';
import { addDays, isoDate, today } from '../lib/format';
import { Icon } from './ui';

export type Slicer = 'region' | 'client' | 'site' | 'dates' | 'category' | 'item' | 'vendor' | 'warehouse';

interface Props {
  values: Record<string, string>;
  set: (p: Record<string, string | undefined>) => void;
  show: Slicer[];
  extra?: React.ReactNode;
}

const PRESETS = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

export function defaultRange(days = 30) {
  const to = today();
  return { from: addDays(to, -(days - 1)), to };
}

export function SliceBar({ values: v, set, show, extra }: Props) {
  const lk = useLookups();
  const [open, setOpen] = useState(false);
  const has = (s: Slicer) => show.includes(s);
  const clients = (lk?.clients ?? []).filter((c) => !v.region_id || lk?.sites.some((s) => s.client_id === c.id && String(s.region_id) === v.region_id));
  const sites = (lk?.sites ?? []).filter((s) => (!v.region_id || String(s.region_id) === v.region_id) && (!v.client_id || String(s.client_id) === v.client_id));
  const active = ['region_id', 'client_id', 'site_id', 'category', 'item_id', 'vendor_id', 'warehouse_id'].filter((k) => v[k]).length;
  const monthStart = isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  return (
    <div className={`slicebar ${open ? 'open' : ''}`}>
      <button className="btn btn-ghost btn-sm slicebar-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="filter" size={15} /> Filters {active > 0 && <span className="pill">{active}</span>}
      </button>
      <div className="slicebar-fields">
        {has('region') && (
          <select className="input" value={v.region_id ?? ''} aria-label="Region" onChange={(e) => set({ region_id: e.target.value, client_id: undefined, site_id: undefined })}>
            <option value="">All regions</option>
            {lk?.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        {has('client') && (
          <select className="input" value={v.client_id ?? ''} aria-label="Client" onChange={(e) => set({ client_id: e.target.value, site_id: undefined })}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {has('site') && (
          <select className="input" value={v.site_id ?? ''} aria-label="Site" onChange={(e) => set({ site_id: e.target.value })}>
            <option value="">All sites ({sites.length})</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {has('warehouse') && (
          <select className="input" value={v.warehouse_id ?? ''} aria-label="Warehouse" onChange={(e) => set({ warehouse_id: e.target.value })}>
            <option value="">All warehouses</option>
            {lk?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
        {has('category') && (
          <select className="input" value={v.category ?? ''} aria-label="Goods type" onChange={(e) => set({ category: e.target.value, item_id: undefined })}>
            <option value="">All goods</option>
            <option value="SUPPLY">Supply goods</option>
            <option value="MRP">MRP goods</option>
            <option value="STORE">Store purchase</option>
          </select>
        )}
        {has('item') && (
          <select className="input" value={v.item_id ?? ''} aria-label="Item" onChange={(e) => set({ item_id: e.target.value })}>
            <option value="">All items</option>
            {lk?.items.filter((i) => !v.category || i.category === v.category).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        )}
        {has('vendor') && (
          <select className="input" value={v.vendor_id ?? ''} aria-label="Vendor" onChange={(e) => set({ vendor_id: e.target.value })}>
            <option value="">All vendors</option>
            {lk?.vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
        {has('dates') && (
          <div className="date-range">
            <input type="date" className="input" value={v.from ?? ''} max={v.to} aria-label="From date" onChange={(e) => set({ from: e.target.value })} />
            <span className="muted">to</span>
            <input type="date" className="input" value={v.to ?? ''} min={v.from} aria-label="To date" onChange={(e) => set({ to: e.target.value })} />
            <div className="seg">
              {PRESETS.map((p) => (
                <button key={p.label} type="button" onClick={() => set(defaultRange(p.days))}
                  className={v.from === defaultRange(p.days).from && v.to === today() ? 'active' : ''}>{p.label}</button>
              ))}
              <button type="button" onClick={() => set({ from: monthStart, to: today() })} className={v.from === monthStart && v.to === today() ? 'active' : ''}>MTD</button>
            </div>
          </div>
        )}
        {extra}
        {active > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => set({ region_id: undefined, client_id: undefined, site_id: undefined, category: undefined, item_id: undefined, vendor_id: undefined, warehouse_id: undefined })}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
