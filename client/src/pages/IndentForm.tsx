import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useLookups } from '../lib/hooks';
import { addDays, today } from '../lib/format';
import { Card, ErrorBox, PageHeader, useToast } from '../components/ui';
import { Field, Input, Select } from '../components/Form';
import { LineItems, emptyLine, validLines, type Line } from '../components/LineItems';

export default function IndentForm() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const lk = useLookups();
  const nav = useNavigate();
  const toast = useToast();
  const [siteId, setSiteId] = useState(sp.get('site_id') ?? '');
  const [reqDate, setReqDate] = useState(addDays(today(), 1));
  const [priority, setPriority] = useState('NORMAL');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [stock, setStock] = useState<Record<number, any>>({});

  useEffect(() => {
    if (!siteId && lk?.sites.length) setSiteId(String(lk.sites[0].id));
  }, [lk, siteId]);

  // edit an existing draft
  useEffect(() => {
    if (!id) return;
    api(`/indents/${id}`).then((d) => {
      setSiteId(String(d.site_id));
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

  const fillSuggested = () => {
    const s = Object.values(stock).filter((r: any) => r.suggested_qty > 0);
    if (!s.length) return toast('No shortfall predicted for this site', 'ok');
    setLines(s.map((r: any) => ({ item_id: String(r.item_id), qty: String(r.suggested_qty) })));
  };

  const submit = async (send: boolean) => {
    setErr('');
    const ls = validLines(lines);
    if (!siteId) return setErr('Choose a site');
    if (!ls.length) return setErr('Add at least one item with a quantity');
    setBusy(true);
    try {
      const body = { site_id: Number(siteId), required_date: reqDate, priority, notes, submit: send,
        lines: ls.map((l) => ({ item_id: Number(l.item_id), qty_requested: Number(l.qty), remarks: l.remarks })) };
      const r = id ? (await api(`/indents/${id}`, { method: 'PUT', body }), { id }) : await api('/indents', { body });
      toast(send ? 'Indent submitted for approval' : 'Draft saved');
      nav(`/indents/${r.id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={id ? 'Edit indent' : 'New indent'} subtitle="Request material for a future date" back="/indents" />
      <Card>
        <div className="stack">
          <ErrorBox>{err}</ErrorBox>
          <div className="form-grid">
            <Field label="Site" required className="span-2">
              <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} disabled={!!id}
                options={(lk?.sites ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.client_name})` }))} />
            </Field>
            <Field label="Required date" required hint="Must be today or later">
              <Input type="date" min={today()} value={reqDate} onChange={(e) => setReqDate(e.target.value)} />
            </Field>
            <Field label="Priority">
              <Select value={priority} onChange={(e) => setPriority(e.target.value)} options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => ({ value: p, label: p }))} />
            </Field>
          </div>
          <div className="row gap" style={{ justifyContent: 'space-between' }}>
            <h3>Items</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={fillSuggested}>Fill suggested quantities</button>
          </div>
          <LineItems lines={lines} onChange={setLines} categories={['SUPPLY', 'MRP', 'STORE']} qtyLabel="Qty required"
            rateHint={(itemId) => {
              const s = stock[itemId];
              return s ? `In stock ${s.stock} ${s.uom} · avg use ${s.avg_daily_use}/day · suggested ${s.suggested_qty}` : undefined;
            }} />
          <Field label="Notes">
            <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Event, special request…" />
          </Field>
          <div className="row gap" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" disabled={busy} onClick={() => submit(false)}>Save draft</button>
            <button className="btn" disabled={busy} onClick={() => submit(true)}>{busy ? 'Saving…' : 'Submit for approval'}</button>
          </div>
        </div>
      </Card>
    </>
  );
}
