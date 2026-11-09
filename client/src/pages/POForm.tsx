import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, qs } from '../lib/api';
import { useLookups } from '../lib/hooks';
import { addDays, money, today } from '../lib/format';
import { Card, ErrorBox, PageHeader, useToast } from '../components/ui';
import { Field, Input, Select, Warnings } from '../components/Form';
import { LineItems, emptyLine, validLines, type Line } from '../components/LineItems';

export default function POForm() {
  const [sp] = useSearchParams();
  const lk = useLookups();
  const nav = useNavigate();
  const toast = useToast();
  const indentId = sp.get('indent_id');
  const [vendorId, setVendorId] = useState('');
  const [dest, setDest] = useState(sp.get('site_id') ? `s${sp.get('site_id')}` : 'w1');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [rates, setRates] = useState<Record<number, any>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // pre-fill from indent
  useEffect(() => {
    if (!indentId) return;
    api(`/indents/${indentId}`).then((d) => setLines(d.lines.map((l: any) => ({ item_id: String(l.item_id), qty: String(Math.max(0, (l.qty_approved ?? l.qty_requested) - l.qty_fulfilled)) }))));
  }, [indentId]);

  // agreed vendor rates
  useEffect(() => {
    if (!vendorId) return;
    api<any[]>(`/purchase-orders-helper/rates${qs({ vendor_id: vendorId })}`).then((r) => {
      const m = Object.fromEntries(r.map((x) => [x.item_id, x]));
      setRates(m);
      setLines((ls) => ls.map((l) => (l.item_id && m[Number(l.item_id)]?.rate ? { ...l, rate: String(m[Number(l.item_id)].rate) } : l)));
      const v = lk?.vendors.find((x) => String(x.id) === vendorId);
      if (v && !expected) setExpected(addDays(today(), v.lead_time_days));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  const save = async (override = false) => {
    setErr('');
    const ls = validLines(lines);
    if (!vendorId) return setErr('Choose a vendor');
    if (!ls.length) return setErr('Add at least one item');
    setBusy(true);
    try {
      const r = await api('/purchase-orders', { body: {
        vendor_id: Number(vendorId), expected_date: expected || undefined, notes, override_warnings: override, indent_id: indentId ? Number(indentId) : undefined,
        ...(dest.startsWith('s') ? { site_id: Number(dest.slice(1)) } : { warehouse_id: Number(dest.slice(1)) }),
        lines: ls.map((l) => ({ item_id: Number(l.item_id), qty_ordered: Number(l.qty), rate: l.rate })) } });
      toast('Purchase order created');
      nav(`/purchase-orders/${r.id}`);
    } catch (e: any) {
      if (e instanceof ApiError && e.details?.needs_override) setWarnings(e.details.warnings ?? []);
      else setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const vendors = lk?.vendors.filter((v) => v.vendor_type === 'REGULAR') ?? [];
  const v = vendors.find((x) => String(x.id) === vendorId);
  return (
    <>
      <PageHeader title="New purchase order" subtitle={indentId ? `Against indent #${indentId}` : 'Order stock from a vendor'} back="/purchase-orders" />
      <Card>
        <div className="stack">
          <ErrorBox>{err}</ErrorBox>
          <div className="form-grid">
            <Field label="Vendor" required hint={v ? `Payment terms: ${v.payment_terms_days} days · lead time ${v.lead_time_days} days` : undefined}>
              <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} placeholder="Select vendor…" options={vendors.map((x) => ({ value: x.id, label: x.name }))} />
            </Field>
            <Field label="Deliver to" required>
              <select className="input" value={dest} onChange={(e) => setDest(e.target.value)}>
                <optgroup label="Warehouses">{lk?.warehouses.map((w) => <option key={w.id} value={`w${w.id}`}>{w.name}</option>)}</optgroup>
                <optgroup label="Direct to site">{lk?.sites.map((s) => <option key={s.id} value={`s${s.id}`}>{s.name}</option>)}</optgroup>
              </select>
            </Field>
            <Field label="Expected delivery">
              <Input type="date" min={today()} value={expected} onChange={(e) => setExpected(e.target.value)} />
            </Field>
          </div>
          <h3>Items</h3>
          <LineItems lines={lines} onChange={(ls) => { setWarnings([]); setLines(ls.map((l) => (l.item_id && !l.rate && rates[Number(l.item_id)]?.rate ? { ...l, rate: String(rates[Number(l.item_id)].rate) } : l))); }}
            withRate categories={['SUPPLY', 'MRP']}
            rateHint={(id) => {
              const r = rates[id];
              if (!r) return undefined;
              return r.rate ? `Agreed rate ${money(r.rate, true)}${r.vendor_moq ? ` · vendor MOQ ${r.vendor_moq}` : ''}` : 'No agreed rate with this vendor';
            }} />
          <Field label="Notes"><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <Warnings list={warnings} busy={busy} onConfirm={() => save(true)} onCancel={() => setWarnings([])} />
          {!warnings.length && (
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Create PO'}</button>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
