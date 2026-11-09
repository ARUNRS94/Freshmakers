import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api';
import { useApi, useLookups, useQueryState } from '../lib/hooks';
import { addDays, fmtDate, num, qty, today } from '../lib/format';
import { Badge, Card, ErrorBox, PageHeader, Spinner, Tabs, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { SliceBar, defaultRange } from '../components/Filters';
import { useAuth } from '../lib/auth';

type Row = { item_id: number; name: string; category: string; uom: string; available: number; qty_used: number | null; qty_wasted: number | null; remarks: string | null };

export default function Consumption() {
  const [f, set] = useQueryState({ tab: 'entry' });
  return (
    <>
      <PageHeader title="Daily consumption" subtitle="Record raw material used and wasted at a site — stock updates instantly" />
      <Tabs value={f.tab} onChange={(t) => set({ tab: t })} tabs={[{ value: 'entry', label: 'Entry' }, { value: 'history', label: 'History' }]} />
      {f.tab === 'history' ? <History f={f} set={set} /> : <Entry f={f} set={set} />}
    </>
  );
}

function Entry({ f, set }: { f: Record<string, string>; set: (p: Record<string, string | undefined>) => void }) {
  const lk = useLookups();
  const { can } = useAuth();
  const toast = useToast();
  const siteId = f.site_id ?? (lk?.sites.length ? String(lk.sites[0].id) : '');
  const date = f.date ?? today();
  const [all, setAll] = useState(false);
  const { data, loading, error, reload } = useApi<{ lines: Row[] }>(siteId ? `/consumption/sheet${qs({ site_id: siteId, date, all })}` : null);
  const [vals, setVals] = useState<Record<number, { u: string; w: string; r: string }>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!data) return;
    setVals(Object.fromEntries(data.lines.map((l) => [l.item_id, { u: l.qty_used?.toString() ?? '', w: l.qty_wasted ? String(l.qty_wasted) : '', r: l.remarks ?? '' }])));
  }, [data]);

  const dirty = data?.lines.some((l) => {
    const v = vals[l.item_id];
    return v && (v.u !== (l.qty_used?.toString() ?? '') || v.w !== (l.qty_wasted ? String(l.qty_wasted) : ''));
  });

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const lines = data!.lines.filter((l) => vals[l.item_id] && (vals[l.item_id].u !== '' || vals[l.item_id].w !== '' || l.qty_used !== null))
        .map((l) => ({ item_id: l.item_id, qty_used: Number(vals[l.item_id].u || 0), qty_wasted: Number(vals[l.item_id].w || 0), remarks: vals[l.item_id].r }));
      if (!lines.length) throw new Error('Enter at least one quantity');
      const r = await api('/consumption', { body: { site_id: Number(siteId), entry_date: date, lines } });
      toast(`Saved ${r.saved} item(s)`);
      reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const readOnly = !can('BARISTA', 'MANAGER', 'SUPERVISOR', 'OPS_HEAD');
  return (
    <Card title={
      <div className="row gap">
        <select className="input" style={{ minWidth: 220 }} value={siteId} onChange={(e) => set({ site_id: e.target.value })} aria-label="Site">
          {lk?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" className="input" style={{ width: 160 }} value={date} max={today()} onChange={(e) => set({ date: e.target.value })} aria-label="Date" />
        <div className="seg">
          <button className={date === addDays(today(), -1) ? 'active' : ''} onClick={() => set({ date: addDays(today(), -1) })}>Yesterday</button>
          <button className={date === today() ? 'active' : ''} onClick={() => set({ date: today() })}>Today</button>
        </div>
      </div>}
      actions={<label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show all items</label>}>
      <ErrorBox>{error || err}</ErrorBox>
      {loading && !data ? <Spinner /> : data && (
        <div className="stack">
          <div className="dt-scroll">
            <table className="table">
              <thead>
                <tr><th>Item</th><th className="ta-right">Available</th><th style={{ width: 140 }}>Used</th><th style={{ width: 120 }}>Wasted</th><th className="ta-right">Balance after</th></tr>
              </thead>
              <tbody>
                {data.lines.map((l) => {
                  const v = vals[l.item_id] ?? { u: '', w: '', r: '' };
                  const after = l.available - Number(v.u || 0) - Number(v.w || 0);
                  return (
                    <tr key={l.item_id} className={after < 0 ? 'row-danger' : ''}>
                      <td className="td-primary" data-label="Item">{l.name} <Badge>{l.category}</Badge></td>
                      <td className="ta-right" data-label="Available">{qty(l.available, l.uom)}</td>
                      <td data-label={`Used (${l.uom})`}>
                        <input className="input" type="number" inputMode="decimal" min="0" step="any" value={v.u} disabled={readOnly} aria-label={`${l.name} used`}
                          onChange={(e) => setVals({ ...vals, [l.item_id]: { ...v, u: e.target.value } })} />
                      </td>
                      <td data-label={`Wasted (${l.uom})`}>
                        <input className="input" type="number" inputMode="decimal" min="0" step="any" value={v.w} disabled={readOnly} aria-label={`${l.name} wasted`}
                          onChange={(e) => setVals({ ...vals, [l.item_id]: { ...v, w: e.target.value } })} />
                      </td>
                      <td className={`ta-right ${after < 0 ? 'text-red' : ''}`} data-label="Balance after"><strong>{qty(Math.round(after * 1000) / 1000, l.uom)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!data.lines.length && <div className="empty">No items stocked at this site yet. Tick “Show all items”.</div>}
          {!readOnly && (
            <div className="row gap" style={{ justifyContent: 'flex-end' }}>
              <span className="muted small grow">{dirty ? 'Unsaved changes' : `Entries for ${fmtDate(date)}`}</span>
              <button className="btn" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save consumption'}</button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function History({ f, set }: { f: Record<string, string>; set: (p: Record<string, string | undefined>) => void }) {
  const r = { from: f.from ?? defaultRange(7).from, to: f.to ?? defaultRange(7).to };
  const { data, loading } = useApi<any[]>(`/consumption${qs({ region_id: f.region_id, client_id: f.client_id, site_id: f.site_id, item_id: f.item_id, ...r })}`);
  return (
    <>
      <SliceBar values={{ ...f, ...r }} set={set} show={['region', 'client', 'site', 'item', 'dates']} />
      <Card pad={false}>
        <DataTable loading={loading} rows={data} exportName="consumption" columns={[
          { key: 'entry_date', label: 'Date', render: (x) => fmtDate(x.entry_date) },
          { key: 'item_name', label: 'Item', primary: true },
          { key: 'site_name', label: 'Site' },
          { key: 'qty_used', label: 'Used', align: 'right', render: (x) => qty(x.qty_used, x.uom) },
          { key: 'qty_wasted', label: 'Wasted', align: 'right', render: (x) => (x.qty_wasted ? qty(x.qty_wasted, x.uom) : '—') },
          { key: 'cups_served', label: 'Cups', align: 'right', hideMobile: true, render: (x) => num(x.cups_served) },
          { key: 'entered_by_name', label: 'By', hideMobile: true },
        ]} />
      </Card>
    </>
  );
}
