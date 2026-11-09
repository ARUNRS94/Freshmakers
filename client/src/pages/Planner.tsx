import { useMemo, useState } from 'react';
import { api, qs } from '../lib/api';
import { useApi, useQueryState } from '../lib/hooks';
import { addDays, fmtDate, num, qty, today } from '../lib/format';
import { Badge, Card, ErrorBox, PageHeader, useToast } from '../components/ui';
import { SliceBar } from '../components/Filters';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../lib/auth';

export default function Planner() {
  const { allowed } = useAuth();
  const toast = useToast();
  const [f, set] = useQueryState({ for_date: addDays(today(), 1), cover_days: '1', only_short: 'true' });
  const { data, loading, reload } = useApi<any>(`/planner${qs(f)}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const bySite = useMemo(() => {
    const m = new Map<number, any[]>();
    for (const r of data?.rows ?? []) if (r.suggested_qty > 0) m.set(r.site_id, [...(m.get(r.site_id) ?? []), r]);
    return m;
  }, [data]);

  const raiseIndents = async () => {
    if (!confirm(`Raise ${bySite.size} indent(s) for ${fmtDate(data.for_date)} with the suggested quantities?`)) return;
    setBusy(true);
    setErr('');
    let ok = 0;
    try {
      for (const [siteId, rows] of bySite) {
        await api('/indents', { body: { site_id: siteId, required_date: data.for_date, notes: 'Auto-generated from requirement planner',
          lines: rows.map((r) => ({ item_id: r.item_id, qty_requested: r.suggested_qty })) } });
        ok++;
      }
      toast(`${ok} indent(s) raised`);
    } catch (e: any) {
      setErr(`${ok} raised, then failed: ${e.message}`);
    } finally {
      setBusy(false);
      reload();
    }
  };

  return (
    <>
      <PageHeader title="Tomorrow’s requirement" subtitle={data ? `Based on the last ${data.lookback_days} days of consumption, current stock, in-transit goods and open indents` : ''}
        actions={allowed('indents', 'edit') && bySite.size > 0 &&
          <button className="btn" disabled={busy} onClick={raiseIndents}>{busy ? 'Raising…' : `Raise ${bySite.size} indent(s)`}</button>} />
      <SliceBar values={f} set={set} show={['region', 'client', 'site', 'category']} extra={<>
        <label className="row gap small">For <input type="date" className="input" style={{ width: 150 }} min={today()} value={f.for_date} onChange={(e) => set({ for_date: e.target.value })} /></label>
        <label className="row gap small">Cover
          <select className="input" style={{ width: 90 }} value={f.cover_days} onChange={(e) => set({ cover_days: e.target.value })}>
            {[1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={f.only_short === 'true'} onChange={(e) => set({ only_short: e.target.checked ? 'true' : 'false' })} /> Shortfalls only</label>
      </>} />
      <ErrorBox>{err}</ErrorBox>
      <div className="alert-box info small">Suggested = average daily use × cover days + reorder level − stock − in transit − already indented. Category filter applies after generation.</div>
      <Card pad={false}>
        <DataTable loading={loading} exportName="requirement-plan" rowKey={(r) => `${r.site_id}-${r.item_id}`}
          rows={(data?.rows ?? []).filter((r: any) => !f.category || r.category === f.category)}
          columns={[
            { key: 'item_name', label: 'Item', primary: true, render: (r) => <span>{r.item_name} <Badge>{r.category}</Badge></span> },
            { key: 'site_name', label: 'Site', render: (r) => <span>{r.site_name}<br /><span className="muted small">{r.client_name}</span></span> },
            { key: 'stock', label: 'Stock', align: 'right', render: (r) => qty(r.stock, r.uom) },
            { key: 'avg_daily_use', label: 'Avg/day', align: 'right', render: (r) => num(r.avg_daily_use) },
            { key: 'required_qty', label: 'Required', align: 'right', render: (r) => num(r.required_qty) },
            { key: 'in_transit', label: 'In transit', align: 'right', hideMobile: true, render: (r) => num(r.in_transit) },
            { key: 'pending_indent', label: 'Indented', align: 'right', hideMobile: true, render: (r) => num(r.pending_indent) },
            { key: 'reorder_level', label: 'Reorder lvl', align: 'right', hideMobile: true, render: (r) => num(r.reorder_level) },
            { key: 'suggested_qty', label: 'Suggested', align: 'right', render: (r) => <strong className={r.suggested_qty > 0 ? 'text-warn' : ''}>{qty(r.suggested_qty, r.uom)}</strong> },
          ]} />
      </Card>
    </>
  );
}
