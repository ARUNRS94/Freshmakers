import { useState } from 'react';
import { api, qs } from '../lib/api';
import { useApi, useQueryState } from '../lib/hooks';
import { fmtDate, money, today } from '../lib/format';
import { Badge, Card, ErrorBox, Kpi, PageHeader, Tabs, useToast } from '../components/ui';
import { Field, Input, Modal, Select } from '../components/Form';
import { DataTable } from '../components/DataTable';
import { SliceBar } from '../components/Filters';
import { useAuth } from '../lib/auth';
import { AgeingTable } from './Payables';

export default function Receivables() {
  const { can } = useAuth();
  const toast = useToast();
  const [f, set] = useQueryState({ tab: 'invoices', status: 'UNPAID' });
  const inv = useApi<any[]>(f.tab === 'invoices' ? `/finance/client-invoices${qs({ status: f.status === 'ALL' ? undefined : f.status, region_id: f.region_id, client_id: f.client_id, site_id: f.site_id, from: f.from, to: f.to })}` : null);
  const rec = useApi<any[]>(f.tab === 'receipts' ? `/finance/client-receipts${qs({ client_id: f.client_id, from: f.from, to: f.to })}` : null);
  const [sel, setSel] = useState<any>(null);
  const [form, setForm] = useState({ amount: '', mode: 'NEFT', reference: '', receipt_date: today() });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const open = inv.data?.filter((b) => b.status !== 'PAID') ?? [];

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await api('/finance/client-receipts', { body: { invoice_id: sel.id, ...form, amount: Number(form.amount) } });
      toast('Receipt recorded');
      setSel(null);
      inv.reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Client receivables" subtitle="Invoices raised automatically when sites acknowledge dispatches, at the client’s agreed rates" />
      <Tabs value={f.tab} onChange={(t) => set({ tab: t })} tabs={[{ value: 'invoices', label: 'Invoices' }, { value: 'receipts', label: 'Receipts' }, { value: 'ageing', label: 'Ageing' }]} />
      {f.tab !== 'ageing' && (
        <SliceBar values={f} set={set} show={['region', 'client', 'site', 'dates']} extra={f.tab === 'invoices' && (
          <div className="seg">
            {[['UNPAID', 'Unpaid'], ['OVERDUE', 'Overdue'], ['PAID', 'Paid'], ['ALL', 'All']].map(([v, l]) => <button key={v} className={f.status === v ? 'active' : ''} onClick={() => set({ status: v })}>{l}</button>)}
          </div>)} />
      )}
      {f.tab === 'invoices' && (
        <>
          {f.status !== 'PAID' && inv.data && (
            <div className="kpis">
              <Kpi label="Outstanding" value={money(open.reduce((a, b) => a + b.balance, 0))} sub={`${open.length} invoices`} />
              <Kpi label="Overdue" value={money(open.filter((b) => b.overdue_days > 0).reduce((a, b) => a + b.balance, 0))} sub={`${open.filter((b) => b.overdue_days > 0).length} invoices`} />
            </div>
          )}
          <Card pad={false}>
            <DataTable loading={inv.loading} rows={inv.data} exportName="client-invoices" rowClass={(b) => (b.status !== 'PAID' && b.overdue_days > 0 ? 'row-danger' : '')} columns={[
              { key: 'invoice_no', label: 'Invoice', primary: true },
              { key: 'client_name', label: 'Client', render: (b) => <span>{b.client_name}<br /><span className="muted small">{b.site_name}</span></span> },
              { key: 'invoice_date', label: 'Date', render: (b) => fmtDate(b.invoice_date) },
              { key: 'due_date', label: 'Due', render: (b) => <span className={b.status !== 'PAID' && b.overdue_days > 0 ? 'text-red' : ''}>{fmtDate(b.due_date)}</span> },
              { key: 'total', label: 'Amount', align: 'right', value: (b) => b.amount + b.tax_amount, sum: true, render: (b) => money(b.total ?? b.amount + b.tax_amount, true) },
              { key: 'received', label: 'Received', align: 'right', sum: true, render: (b) => money(b.received, true) },
              { key: 'balance', label: 'Balance', align: 'right', sum: true, render: (b) => <strong>{money(b.balance, true)}</strong> },
              { key: 'status', label: 'Status', render: (b) => <Badge>{b.status}</Badge> },
              ...(can('FINANCE') ? [{ key: 'act', label: '', render: (b: any) => b.status !== 'PAID' && (
                <button className="btn btn-sm" onClick={() => { setErr(''); setForm({ amount: String(b.balance), mode: 'NEFT', reference: '', receipt_date: today() }); setSel(b); }}>Receive</button>) }] : []),
            ]} />
          </Card>
        </>
      )}
      {f.tab === 'receipts' && (
        <Card pad={false}>
          <DataTable loading={rec.loading} rows={rec.data} exportName="client-receipts" columns={[
            { key: 'receipt_date', label: 'Date', render: (p) => fmtDate(p.receipt_date) },
            { key: 'client_name', label: 'Client', primary: true },
            { key: 'invoice_no', label: 'Invoice' },
            { key: 'mode', label: 'Mode', render: (p) => <Badge tone="gray">{p.mode}</Badge> },
            { key: 'reference', label: 'Reference' },
            { key: 'amount', label: 'Amount', align: 'right', sum: true, render: (p) => money(p.amount, true) },
          ]} />
        </Card>
      )}
      {f.tab === 'ageing' && <Card pad={false} title="Receivables ageing (by days past due)"><AgeingTable type="client" /></Card>}

      <Modal open={!!sel} onClose={() => setSel(null)} title={`Receipt from ${sel?.client_name ?? ''}`}
        footer={<><button className="btn btn-ghost" onClick={() => setSel(null)}>Cancel</button><button className="btn" disabled={busy} onClick={submit}>Record receipt</button></>}>
        <ErrorBox>{err}</ErrorBox>
        {sel && <p className="muted">Invoice {sel.invoice_no} · balance {money(sel.balance, true)}</p>}
        <div className="form-grid">
          <Field label="Amount" required><Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" max={today()} value={form.receipt_date} onChange={(e) => setForm({ ...form, receipt_date: e.target.value })} /></Field>
          <Field label="Mode"><Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} options={['NEFT', 'RTGS', 'UPI', 'CHEQUE', 'CASH'].map((m) => ({ value: m, label: m }))} /></Field>
          <Field label="Reference"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}
