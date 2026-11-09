import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api';
import { useApi, useQueryState, useSite } from '../lib/hooks';
import { addDays, fmtDate, num, qty, today } from '../lib/format';
import { Card, ErrorBox, PageHeader, Spinner, Tabs, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { SliceBar, defaultRange } from '../components/Filters';
import { SearchBox, Seg, SiteSelect, Stepper } from '../components/QuickEntry';
import { useAuth } from '../lib/auth';

type Row = { item_id: number; name: string; category: string; uom: string; available: number; qty_used: number | null; qty_wasted: number | null; remarks: string | null };
type Value = { u: string; w: string; r: string };

const usedText = (l: Row) => l.qty_used?.toString() ?? '';
const wastedText = (l: Row) => (l.qty_wasted ? String(l.qty_wasted) : '');

export default function Consumption() {
  const [f, set] = useQueryState({ tab: 'entry' });
  return (
    <>
      <PageHeader title="Daily consumption" subtitle="Enter what was used today. Stock updates as soon as you save." />
      <Tabs value={f.tab} onChange={(t) => set({ tab: t })} tabs={[{ value: 'entry', label: 'Entry' }, { value: 'history', label: 'History' }]} />
      {f.tab === 'history' ? <History f={f} set={set} /> : <Entry f={f} set={set} />}
    </>
  );
}

function Entry({ f, set }: { f: Record<string, string>; set: (p: Record<string, string | undefined>) => void }) {
  const { allowed } = useAuth();
  const toast = useToast();
  const [siteId, chooseSite] = useSite(f.site_id);
  const date = f.date ?? today();
  const yesterday = addDays(today(), -1);
  const [showAll, setShowAll] = useState(false);
  const [showWaste, setShowWaste] = useState(false);
  const [term, setTerm] = useState('');
  // always fetches every item, so "Show all items" never discards what has been typed
  const { data, loading, error, reload } = useApi<{ lines: Row[] }>(siteId ? `/consumption/sheet${qs({ site_id: siteId, date, all: true })}` : null);
  const [vals, setVals] = useState<Record<number, Value>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!data) return;
    setVals(Object.fromEntries(data.lines.map((l) => [l.item_id, { u: usedText(l), w: wastedText(l), r: l.remarks ?? '' }])));
  }, [data]);

  const lines = data?.lines ?? [];
  const inUse = lines.filter((l) => l.available > 0 || l.qty_used !== null || l.qty_wasted !== null);
  const shown = (showAll ? lines : inUse).filter((l) => !term || l.name.toLowerCase().includes(term.toLowerCase()));
  const entered = inUse.filter((l) => vals[l.item_id]?.u || vals[l.item_id]?.w).length;
  const wasteOn = showWaste || lines.some((l) => l.qty_wasted);
  const dirty = lines.some((l) => {
    const v = vals[l.item_id];
    return v && (v.u !== usedText(l) || v.w !== wastedText(l));
  });

  const update = (id: number, change: Partial<Value>) => setVals((all) => ({ ...all, [id]: { ...(all[id] ?? { u: '', w: '', r: '' }), ...change } }));

  const copyPreviousDay = async () => {
    setErr('');
    try {
      const prev = addDays(date, -1);
      const rows = await api<{ item_id: number; qty_used: number }[]>(`/consumption${qs({ site_id: siteId, from: prev, to: prev })}`);
      const fill = rows.filter((r) => r.qty_used > 0 && !vals[r.item_id]?.u);
      if (!fill.length) return toast(`Nothing to copy from ${fmtDate(prev)}`);
      setVals((all) => {
        const next = { ...all };
        for (const r of fill) next[r.item_id] = { ...(next[r.item_id] ?? { u: '', w: '', r: '' }), u: String(r.qty_used) };
        return next;
      });
      toast(`Filled ${fill.length} item(s) from ${fmtDate(prev)}. Check them, then save.`);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const body = lines.filter((l) => vals[l.item_id] && (vals[l.item_id].u !== '' || vals[l.item_id].w !== '' || l.qty_used !== null))
        .map((l) => ({ item_id: l.item_id, qty_used: Number(vals[l.item_id].u || 0), qty_wasted: Number(vals[l.item_id].w || 0), remarks: vals[l.item_id].r }));
      if (!body.length) throw new Error('Enter at least one quantity');
      const r = await api('/consumption', { body: { site_id: Number(siteId), entry_date: date, lines: body } });
      toast(`Saved ${r.saved} item(s)`);
      reload();
    } catch (e: any) {
      setErr(e.message);
      toast(e.message, 'err'); // Save sits below a long list, so the box at the top may be out of view
    } finally {
      setBusy(false);
    }
  };

  const readOnly = !allowed('consumption', 'edit');
  return (
    <>
      <Card>
        <div className="stack" style={{ gap: '.75rem' }}>
          <div className="entry-head">
            <div className="site"><SiteSelect value={siteId} onChange={(id) => { chooseSite(id); set({ site_id: id }); }} /></div>
            <Seg label="Day" value={date} onChange={(d) => set({ date: d })} options={[{ value: yesterday, label: 'Yesterday' }, { value: today(), label: 'Today' }]} />
            <input type="date" className="input" value={date} max={today()} onChange={(e) => set({ date: e.target.value })} aria-label="Date" />
          </div>
          <div className="sheet-tools">
            <SearchBox value={term} onChange={setTerm} placeholder="Search items…" />
            {!readOnly && <button type="button" className="btn btn-ghost btn-sm" disabled={!data} onClick={copyPreviousDay}>Copy previous day</button>}
            <label className="check"><input type="checkbox" checked={wasteOn} disabled={lines.some((l) => l.qty_wasted)} onChange={(e) => setShowWaste(e.target.checked)} /> Wastage</label>
            <label className="check"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> All items</label>
          </div>
          <ErrorBox>{error || err}</ErrorBox>
          {loading && !data ? <Spinner /> : data && (
            <div className="sheet">
              {!shown.length && <div className="empty">{term ? 'No items match' : 'No stock at this site yet. Tick “All items” to see everything.'}</div>}
              {shown.map((l) => {
                const v = vals[l.item_id] ?? { u: '', w: '', r: '' };
                const left = Math.round((l.available - Number(v.u || 0) - Number(v.w || 0)) * 1000) / 1000;
                return (
                  <div key={l.item_id} className={`sheet-row ${v.u || v.w ? 'picked' : ''} ${left < 0 ? 'over' : ''}`}>
                    <div className="sheet-item">
                      <strong>{l.name}</strong>
                      <div className="sheet-info">Available {qty(l.available, l.uom)}</div>
                    </div>
                    <div className={`sheet-left ${left < 0 ? 'text-red' : 'muted'}`}>{left < 0 ? 'Short ' : 'Left '}{qty(Math.abs(left), l.uom)}</div>
                    <div className="qty-field">
                      <span>Used ({l.uom})</span>
                      <Stepper value={v.u} disabled={readOnly} label={`${l.name} used`} onChange={(u) => update(l.item_id, { u })} />
                    </div>
                    {wasteOn && (
                      <div className="qty-field">
                        <span>Wasted ({l.uom})</span>
                        <Stepper value={v.w} disabled={readOnly} label={`${l.name} wasted`} onChange={(w) => update(l.item_id, { w })} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
      {!readOnly && data && (
        <div className="action-bar">
          <span className="muted small grow">{entered} of {inUse.length} items entered for {fmtDate(date)}{dirty ? ' · Not saved yet' : ''}</span>
          <button className="btn" onClick={save} disabled={busy || loading || !dirty}>{busy ? 'Saving…' : 'Save consumption'}</button>
        </div>
      )}
    </>
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
