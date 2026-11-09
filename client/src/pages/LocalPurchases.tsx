import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api';
import { useApi, useLookups, useQueryState } from '../lib/hooks';
import { fmtDate, money, today } from '../lib/format';
import { Badge, Card, ErrorBox, Icon, PageHeader, useToast } from '../components/ui';
import { Field, Input, Modal, Select } from '../components/Form';
import { DataTable } from '../components/DataTable';
import { SliceBar, defaultRange } from '../components/Filters';
import { LineItems, emptyLine, validLines, type Line } from '../components/LineItems';
import { useAuth } from '../lib/auth';

export default function LocalPurchases() {
  const { can } = useAuth();
  const [f, set] = useQueryState();
  const r = { from: f.from ?? defaultRange(30).from, to: f.to ?? defaultRange(30).to };
  const { data, loading, reload } = useApi<any[]>(`/local-purchases${qs({ region_id: f.region_id, client_id: f.client_id, site_id: f.site_id, ...r })}`);
  return (
    <>
      <PageHeader title="Local purchases" subtitle="Store purchases and shortage buys from the local market, with the price paid"
        actions={can('MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'SCM') && <button className="btn" onClick={() => set({ new: '1' })}><Icon name="plus" size={16} /> Record purchase</button>} />
      <SliceBar values={{ ...f, ...r }} set={set} show={['region', 'client', 'site', 'dates']} />
      <Card pad={false}>
        <DataTable loading={loading} rows={data} exportName="local-purchases" columns={[
          { key: 'lp_no', label: 'No.', primary: true, render: (x) => <span>{x.lp_no} <Badge tone={x.reason === 'SHORTAGE' ? 'amber' : 'gray'}>{x.reason}</Badge></span> },
          { key: 'purchase_date', label: 'Date', render: (x) => fmtDate(x.purchase_date) },
          { key: 'location_name', label: 'Site' },
          { key: 'vendor_name', label: 'Bought from' },
          { key: 'lines', label: 'Items', value: (x) => (x.lines ?? []).map((l: any) => l.item_name).join(', '),
            render: (x) => <span className="small">{(x.lines ?? []).map((l: any) => `${l.item_name} ${l.qty} ${l.uom} @ ₹${l.rate}`).join(', ')}</span> },
          { key: 'payment_mode', label: 'Paid by', render: (x) => <Badge tone={x.payment_mode === 'CREDIT' ? 'amber' : 'green'}>{x.payment_mode}</Badge> },
          { key: 'indent_no', label: 'Indent', hideMobile: true },
          { key: 'amount', label: 'Amount', align: 'right', sum: true, render: (x) => money(x.amount, true) },
        ]} />
      </Card>
      {f.new && <LPForm initialSite={f.site_id} indentId={f.indent_id} onClose={() => set({ new: undefined, indent_id: undefined })} onSaved={reload} />}
    </>
  );
}

function LPForm({ initialSite, indentId, onClose, onSaved }: { initialSite?: string; indentId?: string; onClose: () => void; onSaved: () => void }) {
  const lk = useLookups();
  const toast = useToast();
  const [siteId, setSiteId] = useState(initialSite ?? '');
  const [vendorId, setVendorId] = useState('');
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState(indentId ? 'SHORTAGE' : 'ROUTINE');
  const [mode, setMode] = useState('CASH');
  const [billNo, setBillNo] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!siteId && lk?.sites.length) setSiteId(String(lk.sites[0].id));
    if (!vendorId && lk) setVendorId(String(lk.vendors.find((v) => v.vendor_type === 'LOCAL_MARKET')?.id ?? ''));
  }, [lk, siteId, vendorId]);

  useEffect(() => {
    if (!indentId) return;
    api(`/indents/${indentId}`).then((d) => {
      setSiteId(String(d.site_id));
      setLines(d.lines.map((l: any) => ({ item_id: String(l.item_id), qty: String(Math.max(0, (l.qty_approved ?? l.qty_requested) - l.qty_fulfilled)), rate: '' }))
        .filter((l: Line) => Number(l.qty) > 0));
    });
  }, [indentId]);

  const save = async () => {
    setErr('');
    const ls = validLines(lines);
    if (!ls.length) return setErr('Add at least one item');
    if (ls.some((l) => l.rate === '' || l.rate === undefined)) return setErr('Enter the rate paid for every item');
    setBusy(true);
    try {
      await api('/local-purchases', { body: { site_id: Number(siteId), vendor_id: Number(vendorId), purchase_date: date, reason, payment_mode: mode, bill_no: billNo,
        indent_id: indentId ? Number(indentId) : undefined, lines: ls.map((l) => ({ item_id: Number(l.item_id), qty: Number(l.qty), rate: Number(l.rate) })) } });
      toast('Purchase recorded and stock updated');
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={indentId ? 'Local purchase against indent' : 'Record local purchase'} wide
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save purchase'}</button></>}>
      <ErrorBox>{err}</ErrorBox>
      <div className="form-grid">
        <Field label="Site" required>
          <Select value={siteId} disabled={!!indentId} onChange={(e) => setSiteId(e.target.value)} options={(lk?.sites ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label="Bought from" required>
          <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} options={(lk?.vendors ?? []).map((v) => ({ value: v.id, label: `${v.name}${v.vendor_type === 'LOCAL_MARKET' ? '' : ' (vendor)'}` }))} />
        </Field>
        <Field label="Date"><Input type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)} options={[{ value: 'ROUTINE', label: 'Routine store purchase' }, { value: 'SHORTAGE', label: 'Shortage / supply delay' }, { value: 'EMERGENCY', label: 'Emergency / event' }]} />
        </Field>
        <Field label="Payment mode">
          <Select value={mode} onChange={(e) => setMode(e.target.value)} options={['CASH', 'UPI', 'CARD', 'CREDIT'].map((m) => ({ value: m, label: m === 'CREDIT' ? 'Credit (pay later)' : m }))} />
        </Field>
        <Field label="Bill no."><Input value={billNo} onChange={(e) => setBillNo(e.target.value)} /></Field>
      </div>
      <LineItems lines={lines} onChange={setLines} withRate />
    </Modal>
  );
}
