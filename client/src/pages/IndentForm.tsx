import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useSite } from '../lib/hooks';
import { addDays, today } from '../lib/format';
import { Card, ErrorBox, PageHeader, useToast } from '../components/ui';
import { Field, Input } from '../components/Form';
import { validLines, type Line } from '../components/LineItems';
import { ItemSheet, Seg, SiteSelect } from '../components/QuickEntry';

export default function IndentForm() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [siteOverride, setSiteOverride] = useState(sp.get('site_id') ?? '');
  const [siteId, chooseSite] = useSite(siteOverride);
  const tomorrow = addDays(today(), 1);
  const [reqDate, setReqDate] = useState(tomorrow);
  const [priority, setPriority] = useState('NORMAL');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [stock, setStock] = useState<Record<number, any>>({});

  // edit an existing draft
  useEffect(() => {
    if (!id) return;
    api(`/indents/${id}`).then((d) => {
      setSiteOverride(String(d.site_id));
      setReqDate(d.required_date < today() ? addDays(today(), 1) : d.required_date);
      setPriority(d.priority);
      setNotes(d.notes ?? '');
      setLines(d.lines.map((l: any) => ({ item_id: String(l.item_id), qty: String(l.qty_requested), remarks: l.remarks ?? '' })));
    }).catch((e) => setErr(e.message));
  }, [id]);

  // current stock + planner suggestion for hints
  useEffect(() => {
    if (!siteId) return;
    api<any>(`/planner${qs({ site_id: siteId, for_date: reqDate, only_short: false })}`)
      .then((d) => setStock(Object.fromEntries(d.rows.map((r: any) => [r.item_id, r]))))
      .catch(() => setStock({}));
  }, [siteId, reqDate]);

  const shortfalls = Object.values(stock).filter((r: any) => r.suggested_qty > 0);
  const addAllSuggested = () => {
    const blank = shortfalls.filter((r: any) => !lines.some((l) => l.item_id === String(r.item_id) && Number(l.qty) > 0));
    const kept = lines.filter((l) => !blank.some((r: any) => String(r.item_id) === l.item_id));
    setLines([...kept, ...blank.map((r: any) => ({ item_id: String(r.item_id), qty: String(r.suggested_qty) }))]);
  };

  // Save sits below a long list, so the box at the top may be out of view
  const fail = (message: string) => {
    setErr(message);
    toast(message, 'err');
  };

  const submit = async (send: boolean) => {
    setErr('');
    const ls = validLines(lines);
    if (!siteId) return fail('Choose a site');
    if (!ls.length) return fail('Enter a quantity for at least one item');
    setBusy(true);
    try {
      const body = { site_id: Number(siteId), required_date: reqDate, priority, notes, submit: send,
        lines: ls.map((l) => ({ item_id: Number(l.item_id), qty_requested: Number(l.qty), remarks: l.remarks })) };
      const r = id ? (await api(`/indents/${id}`, { method: 'PUT', body }), { id }) : await api('/indents', { body });
      toast(send ? 'Indent submitted for approval' : 'Draft saved');
      nav(`/indents/${r.id}`);
    } catch (e: any) {
      fail(e.message);
    } finally {
      setBusy(false);
    }
  };

  const count = validLines(lines).length;
  return (
    <>
      <PageHeader title={id ? 'Edit indent' : 'New indent'} subtitle="Enter what the site needs. Tap Add to accept a suggested quantity." back="/indents" />
      <Card>
        <div className="stack" style={{ gap: '.75rem' }}>
          <ErrorBox>{err}</ErrorBox>
          <div className="entry-head">
            <div className="site"><SiteSelect value={siteId} disabled={!!id} onChange={(v) => { setSiteOverride(v); chooseSite(v); }} /></div>
            <Seg label="Required on" value={reqDate} onChange={setReqDate} options={[{ value: tomorrow, label: 'Tomorrow' }, { value: addDays(today(), 2), label: 'Day after' }]} />
            <Input type="date" min={today()} value={reqDate} onChange={(e) => setReqDate(e.target.value)} aria-label="Required date" />
            <Seg label="Priority" value={priority} onChange={setPriority} options={[{ value: 'LOW', label: 'Low' }, { value: 'NORMAL', label: 'Normal' }, { value: 'HIGH', label: 'High' }, { value: 'URGENT', label: 'Urgent' }]} />
          </div>
          {shortfalls.length > 0 && (
            <div className="row gap">
              <button type="button" className="btn btn-ghost btn-sm" onClick={addAllSuggested}>Add all suggested ({shortfalls.length})</button>
              <span className="muted small">Based on recent use and current stock</span>
            </div>
          )}
          <ItemSheet lines={lines} onChange={setLines}
            suggested={Object.fromEntries(Object.values(stock).map((s: any) => [s.item_id, s.suggested_qty]))}
            info={(itemId) => {
              const s = stock[itemId];
              return s ? `In stock ${s.stock} ${s.uom} · uses ${s.avg_daily_use}/day` : undefined;
            }} />
          <Field label="Note (optional)">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Event, special request…" />
          </Field>
        </div>
      </Card>
      <div className="action-bar">
        <span className="muted small grow">{count} {count === 1 ? 'item' : 'items'} added</span>
        <button className="btn btn-ghost" disabled={busy} onClick={() => submit(false)}>Save draft</button>
        <button className="btn" disabled={busy} onClick={() => submit(true)}>{busy ? 'Saving…' : 'Submit for approval'}</button>
      </div>
    </>
  );
}
