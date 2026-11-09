import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLookups, useSite } from '../lib/hooks';
import { addDays, money, today } from '../lib/format';
import { Card, ErrorBox, PageHeader, useToast } from '../components/ui';
import { Field, Input, Select } from '../components/Form';
import { validLines, type Line } from '../components/LineItems';
import { ItemSheet, Seg, SiteSelect } from '../components/QuickEntry';

const MODES = [{ value: 'CASH', label: 'Cash' }, { value: 'UPI', label: 'UPI' }, { value: 'CARD', label: 'Card' }, { value: 'CREDIT', label: 'Pay later' }];

export default function LocalPurchaseForm() {
  const [sp] = useSearchParams();
  const indentId = sp.get('indent_id') ?? undefined;
  const lk = useLookups();
  const nav = useNavigate();
  const toast = useToast();
  const [siteOverride, setSiteOverride] = useState(sp.get('site_id') ?? '');
  const [siteId, chooseSite] = useSite(siteOverride);
  const [pickedVendor, setPickedVendor] = useState('');
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState(indentId ? 'SHORTAGE' : 'ROUTINE');
  const [mode, setMode] = useState('CASH');
  const [billNo, setBillNo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const vendors = [...(lk?.vendors ?? [])].sort((a, b) => Number(b.vendor_type === 'LOCAL_MARKET') - Number(a.vendor_type === 'LOCAL_MARKET'));
  const vendorId = pickedVendor || String(vendors[0]?.id ?? '');

  useEffect(() => {
    if (!indentId) return;
    api(`/indents/${indentId}`).then((d) => {
      setSiteOverride(String(d.site_id));
      setLines(d.lines.map((l: any) => ({ item_id: String(l.item_id), qty: String(Math.max(0, (l.qty_approved ?? l.qty_requested) - l.qty_fulfilled)), rate: '' }))
        .filter((l: Line) => Number(l.qty) > 0));
    }).catch((e) => setErr(e.message));
  }, [indentId]);

  // Save sits below a long list, so the box at the top may be out of view
  const fail = (message: string) => {
    setErr(message);
    toast(message, 'err');
  };

  const save = async (another: boolean) => {
    setErr('');
    const ls = validLines(lines);
    if (!siteId) return fail('Choose a site');
    if (!vendorId) return fail('Choose where it was bought from');
    if (!ls.length) return fail('Enter a quantity for at least one item');
    if (ls.some((l) => l.rate === '' || l.rate === undefined)) return fail('Enter the rate paid for every item');
    setBusy(true);
    try {
      await api('/local-purchases', { body: { site_id: Number(siteId), vendor_id: Number(vendorId), purchase_date: date, reason, payment_mode: mode, bill_no: billNo,
        indent_id: indentId ? Number(indentId) : undefined, lines: ls.map((l) => ({ item_id: Number(l.item_id), qty: Number(l.qty), rate: Number(l.rate) })) } });
      toast('Purchase recorded and stock updated');
      if (another) {
        setLines([]);
        setBillNo('');
      } else nav('/local-purchases');
    } catch (e: any) {
      fail(e.message);
    } finally {
      setBusy(false);
    }
  };

  const picked = validLines(lines);
  const total = picked.reduce((a, l) => a + Number(l.qty) * Number(l.rate || 0), 0);
  const yesterday = addDays(today(), -1);

  return (
    <>
      <PageHeader title={indentId ? 'Local purchase against indent' : 'Record local purchase'} subtitle="Enter what you bought and the rate paid. Stock updates as soon as you save." back="/local-purchases" />
      <Card>
        <div className="stack" style={{ gap: '.75rem' }}>
          <ErrorBox>{err}</ErrorBox>
          <div className="entry-head">
            <div className="site"><SiteSelect value={siteId} disabled={!!indentId} onChange={(v) => { setSiteOverride(v); chooseSite(v); }} /></div>
            <Seg label="Day" value={date} onChange={setDate} options={[{ value: yesterday, label: 'Yesterday' }, { value: today(), label: 'Today' }]} />
            <Input type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          </div>
          <div className="entry-head">
            <div className="site">
              <Select value={vendorId} aria-label="Bought from" onChange={(e) => setPickedVendor(e.target.value)}
                options={vendors.map((v) => ({ value: v.id, label: `${v.name}${v.vendor_type === 'LOCAL_MARKET' ? '' : ' (vendor)'}` }))} />
            </div>
            <Seg label="Payment" value={mode} onChange={setMode} options={MODES} />
          </div>
          <ItemSheet lines={lines} onChange={setLines} withRate leadCategory="STORE" />
          <details className="more-details">
            <summary>Reason and bill number</summary>
            <div className="form-grid">
              <Field label="Reason">
                <Select value={reason} onChange={(e) => setReason(e.target.value)} options={[{ value: 'ROUTINE', label: 'Routine store purchase' }, { value: 'SHORTAGE', label: 'Shortage / supply delay' }, { value: 'EMERGENCY', label: 'Emergency / event' }]} />
              </Field>
              <Field label="Bill no."><Input value={billNo} onChange={(e) => setBillNo(e.target.value)} /></Field>
            </div>
          </details>
        </div>
      </Card>
      <div className="action-bar">
        <span className="small grow"><strong>Total {money(total, true)}</strong> <span className="muted">· {picked.length} {picked.length === 1 ? 'item' : 'items'}</span></span>
        {!indentId && <button className="btn btn-ghost" disabled={busy} onClick={() => save(true)}>Save &amp; add another</button>}
        <button className="btn" disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save purchase'}</button>
      </div>
    </>
  );
}
