import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useLookups } from '../lib/hooks';
import { money, qty, today } from '../lib/format';
import { Card, ErrorBox, PageHeader, useToast } from '../components/ui';
import { Field, Input, Select } from '../components/Form';
import { LineItems, emptyLine, validLines, type Line } from '../components/LineItems';

export default function DispatchForm() {
  const [sp] = useSearchParams();
  const lk = useLookups();
  const nav = useNavigate();
  const toast = useToast();
  const indentId = sp.get('indent_id');
  const [indent, setIndent] = useState<any>(null);
  const [whId, setWhId] = useState('1');
  const [siteId, setSiteId] = useState('');
  const [date, setDate] = useState(today());
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [wh, setWh] = useState<Record<number, any>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!indentId) return;
    api(`/indents/${indentId}`).then((d) => {
      setIndent(d);
      setSiteId(String(d.site_id));
      setLines(d.lines.filter((l: any) => l.category !== 'STORE').map((l: any) => ({ item_id: String(l.item_id), qty: String(Math.max(0, (l.qty_approved ?? l.qty_requested) - l.qty_fulfilled)) }))
        .filter((l: Line) => Number(l.qty) > 0));
    }).catch((e) => setErr(e.message));
  }, [indentId]);

  useEffect(() => {
    api<any[]>(`/stock${qs({ location: 'warehouse', warehouse_id: whId })}`).then((r) => setWh(Object.fromEntries(r.map((x) => [x.item_id, x])))).catch(() => {});
  }, [whId]);

  const save = async () => {
    setErr('');
    const ls = validLines(lines);
    if (!siteId) return setErr('Choose a site');
    if (!ls.length) return setErr('Add at least one item');
    setBusy(true);
    try {
      const r = await api('/dispatches', { body: { warehouse_id: Number(whId), site_id: Number(siteId), indent_id: indentId ? Number(indentId) : undefined,
        dispatch_date: date, vehicle_no: vehicle, driver_name: driver,
        lines: ls.map((l) => ({ item_id: Number(l.item_id), qty_dispatched: Number(l.qty), indent_line_id: indent?.lines.find((x: any) => String(x.item_id) === l.item_id)?.id })) } });
      toast('Dispatched — awaiting site acknowledgement');
      nav(`/dispatches/${r.id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const value = validLines(lines).reduce((a, l) => a + Number(l.qty) * (wh[Number(l.item_id)]?.avg_rate ?? 0), 0);
  return (
    <>
      <PageHeader title="New dispatch" subtitle={indent ? `Fulfilling ${indent.indent_no} for ${indent.site_name}` : 'Send stock from a warehouse to a site'} back={indentId ? `/indents/${indentId}` : '/dispatches'} />
      <Card>
        <div className="stack">
          <ErrorBox>{err}</ErrorBox>
          <div className="form-grid">
            <Field label="From warehouse" required>
              <Select value={whId} onChange={(e) => setWhId(e.target.value)} options={(lk?.warehouses ?? []).map((w) => ({ value: w.id, label: w.name }))} />
            </Field>
            <Field label="To site" required>
              <Select value={siteId} disabled={!!indentId} onChange={(e) => setSiteId(e.target.value)} placeholder="Select site…" options={(lk?.sites ?? []).map((s) => ({ value: s.id, label: s.name }))} />
            </Field>
            <Field label="Dispatch date"><Input type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Vehicle no."><Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></Field>
            <Field label="Driver"><Input value={driver} onChange={(e) => setDriver(e.target.value)} /></Field>
          </div>
          <h3>Items</h3>
          <LineItems lines={lines} onChange={setLines} categories={['SUPPLY', 'MRP']} qtyLabel="Dispatch qty"
            rateHint={(id) => { const w = wh[id]; return w ? `Warehouse stock ${qty(w.qty, w.uom)}` : undefined; }} />
          <div className="row gap" style={{ justifyContent: 'flex-end' }}>
            <span className="muted small grow">Approx. cost value {money(value)} · billed to client at agreed rates on receipt</span>
            <button className="btn" disabled={busy} onClick={save}>{busy ? 'Dispatching…' : 'Dispatch'}</button>
          </div>
        </div>
      </Card>
    </>
  );
}
