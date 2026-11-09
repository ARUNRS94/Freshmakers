import { useState } from 'react';
import { api } from '../lib/api';
import { useApi, useLookups } from '../lib/hooks';
import { fmtDate, today } from '../lib/format';
import { Card, ErrorBox, Icon, PageHeader, useToast } from '../components/ui';
import { Field, Input, Modal } from '../components/Form';
import { DataTable } from '../components/DataTable';
import { LineItems, emptyLine, validLines, type Line } from '../components/LineItems';
import { useAuth } from '../lib/auth';

export default function Transfers() {
  const [open, setOpen] = useState(false);
  const { data, loading, reload } = useApi<any[]>('/transfers');
  return (
    <>
      <PageHeader title="Stock transfers" subtitle="Move stock between sites or warehouses to cover shortages"
        actions={<button className="btn" onClick={() => setOpen(true)}><Icon name="plus" size={16} /> New transfer</button>} />
      <Card pad={false}>
        <DataTable loading={loading} rows={data} exportName="transfers" empty="No transfers yet" columns={[
          { key: 'transfer_no', label: 'No.', primary: true },
          { key: 'transfer_date', label: 'Date', render: (r) => fmtDate(r.transfer_date) },
          { key: 'from_name', label: 'From' },
          { key: 'to_name', label: 'To' },
          { key: 'lines', label: 'Items', value: (r) => (r.lines ?? []).map((l: any) => `${l.item_name} ${l.qty} ${l.uom}`).join(', ') },
          { key: 'created_by_name', label: 'By' },
        ]} />
      </Card>
      {open && <TransferForm onClose={() => setOpen(false)} onSaved={reload} />}
    </>
  );
}

function TransferForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const lk = useLookups();
  const { allowed } = useAuth();
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState(today());
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const loc = (v: string, p: 'from' | 'to') => (v.startsWith('s') ? { [`${p}_site_id`]: Number(v.slice(1)) } : { [`${p}_warehouse_id`]: Number(v.slice(1)) });

  const save = async () => {
    setErr('');
    if (!from || !to) return setErr('Choose source and destination');
    const ls = validLines(lines);
    if (!ls.length) return setErr('Add at least one item');
    setBusy(true);
    try {
      await api('/transfers', { body: { ...loc(from, 'from'), ...loc(to, 'to'), transfer_date: date, lines: ls.map((l) => ({ item_id: Number(l.item_id), qty: Number(l.qty) })) } });
      toast('Transfer posted');
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const opts = (
    <>
      <option value="">Select…</option>
      {allowed('transfers', 'edit') && <optgroup label="Warehouses">{lk?.warehouses.map((w) => <option key={w.id} value={`w${w.id}`}>{w.name}</option>)}</optgroup>}
      <optgroup label="Sites">{lk?.sites.map((s) => <option key={s.id} value={`s${s.id}`}>{s.name}</option>)}</optgroup>
    </>
  );
  return (
    <Modal open onClose={onClose} title="New stock transfer" wide
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={save}>{busy ? 'Posting…' : 'Post transfer'}</button></>}>
      <ErrorBox>{err}</ErrorBox>
      <div className="form-grid">
        <Field label="From" required><select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>{opts}</select></Field>
        <Field label="To" required><select className="input" value={to} onChange={(e) => setTo(e.target.value)}>{opts}</select></Field>
        <Field label="Date"><Input type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <LineItems lines={lines} onChange={setLines} />
    </Modal>
  );
}
