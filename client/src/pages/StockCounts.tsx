import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api';
import { useApi, useLookups } from '../lib/hooks';
import { fmtDate, num, qty, today } from '../lib/format';
import { Card, ErrorBox, Icon, PageHeader, Spinner, useToast } from '../components/ui';
import { Field, Input, Modal } from '../components/Form';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../lib/auth';

export default function StockCounts() {
  const [open, setOpen] = useState(false);
  const { data, loading, reload } = useApi<any[]>('/stock-counts');
  return (
    <>
      <PageHeader title="Stock count" subtitle="Physical verification — variances are posted as stock adjustments"
        actions={<button className="btn" onClick={() => setOpen(true)}><Icon name="plus" size={16} /> New count</button>} />
      <Card pad={false}>
        <DataTable loading={loading} rows={data} exportName="stock-counts" empty="No stock counts recorded yet" columns={[
          { key: 'count_date', label: 'Date', primary: true, render: (r) => fmtDate(r.count_date) },
          { key: 'location', label: 'Location', value: (r) => r.site_name ?? r.warehouse_name },
          { key: 'items', label: 'Items counted', align: 'right' },
          { key: 'variances', label: 'Variances', align: 'right', render: (r) => <span className={r.variances ? 'text-warn' : ''}>{r.variances}</span> },
          { key: 'net_variance_qty', label: 'Net qty variance', align: 'right', render: (r) => num(r.net_variance_qty) },
          { key: 'created_by_name', label: 'By' },
          { key: 'notes', label: 'Notes', hideMobile: true },
        ]} />
      </Card>
      {open && <CountForm onClose={() => setOpen(false)} onSaved={reload} />}
    </>
  );
}

function CountForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const lk = useLookups();
  const { allowed } = useAuth();
  const toast = useToast();
  const [loc, setLoc] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [counted, setCounted] = useState<Record<number, { q: string; r: string }>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loc && lk?.sites.length) setLoc(`s${lk.sites[0].id}`);
  }, [lk, loc]);
  useEffect(() => {
    if (!loc) return;
    setRows(null);
    setCounted({});
    const p = loc.startsWith('s') ? { site_id: loc.slice(1) } : { location: 'warehouse', warehouse_id: loc.slice(1) };
    api<any[]>(`/stock${qs(p)}`).then(setRows).catch((e) => setErr(e.message));
  }, [loc]);

  const save = async () => {
    setErr('');
    const lines = Object.entries(counted).filter(([, v]) => v.q !== '').map(([id, v]) => ({ item_id: Number(id), counted_qty: Number(v.q), reason: v.r }));
    if (!lines.length) return setErr('Enter at least one counted quantity');
    setBusy(true);
    try {
      await api('/stock-counts', { body: { ...(loc.startsWith('s') ? { site_id: Number(loc.slice(1)) } : { warehouse_id: Number(loc.slice(1)) }), count_date: date, notes, lines } });
      toast('Stock count posted');
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New stock count" wide
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={save}>{busy ? 'Posting…' : 'Post count'}</button></>}>
      <ErrorBox>{err}</ErrorBox>
      <div className="form-grid">
        <Field label="Location">
          <select className="input" value={loc} onChange={(e) => setLoc(e.target.value)}>
            {allowed('stock_counts', 'edit') && <optgroup label="Warehouses">{lk?.warehouses.map((w) => <option key={w.id} value={`w${w.id}`}>{w.name}</option>)}</optgroup>}
            <optgroup label="Sites">{lk?.sites.map((s) => <option key={s.id} value={`s${s.id}`}>{s.name}</option>)}</optgroup>
          </select>
        </Field>
        <Field label="Count date"><Input type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {!rows ? <Spinner /> : (
        <div className="dt-scroll">
          <table className="table">
            <thead><tr><th>Item</th><th className="ta-right">System qty</th><th>Counted</th><th className="ta-right">Variance</th><th>Reason</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const v = counted[r.item_id] ?? { q: '', r: '' };
                const diff = v.q === '' ? null : Number(v.q) - r.qty;
                return (
                  <tr key={r.item_id}>
                    <td className="td-primary" data-label="Item">{r.item_name}</td>
                    <td className="ta-right" data-label="System">{qty(r.qty, r.uom)}</td>
                    <td data-label="Counted"><input className="input" style={{ maxWidth: 120 }} type="number" min="0" step="any" inputMode="decimal" value={v.q}
                      onChange={(e) => setCounted({ ...counted, [r.item_id]: { ...v, q: e.target.value } })} /></td>
                    <td className={`ta-right ${diff && diff < 0 ? 'text-red' : diff ? 'text-green' : ''}`} data-label="Variance">{diff === null ? '—' : num(Math.round(diff * 1000) / 1000)}</td>
                    <td data-label="Reason"><input className="input" value={v.r} placeholder={diff ? 'e.g. spillage' : ''} onChange={(e) => setCounted({ ...counted, [r.item_id]: { ...v, r: e.target.value } })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
