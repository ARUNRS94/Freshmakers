import { useState } from 'react';
import { api, qs } from '../lib/api';
import { useApi, useQueryState } from '../lib/hooks';
import { fmtDate, money, today } from '../lib/format';
import { Badge, Card, ErrorBox, Kpi, PageHeader, Tabs, useToast } from '../components/ui';
import { Field, Input, Modal, Select } from '../components/Form';
import { DataTable } from '../components/DataTable';
import { SliceBar } from '../components/Filters';
import { useAuth } from '../lib/auth';

export function AgeingTable({ type }: { type: 'vendor' | 'client' }) {
  const { data, loading } = useApi<any[]>(`/finance/ageing?type=${type}`);
  const m = (k: string) => ({ key: k, align: 'right' as const, sum: true, render: (r: any) => money(r[k]) });
  return (
    <DataTable loading={loading} rows={data} exportName={`${type}-ageing`} rowKey={(r) => r.party} columns={[
      { key: 'party', label: type === 'vendor' ? 'Vendor' : 'Client', primary: true },
      { ...m('not_due'), label: 'Not due' }, { ...m('d1_30'), label: '1–30 days' }, { ...m('d31_60'), label: '31–60 days' },
      { ...m('d61_90'), label: '61–90 days' }, { ...m('d90_plus'), label: '90+ days' }, { ...m('total'), label: 'Total' },
    ]} />
  );
}

export default function Payables() {
  const { can, user } = useAuth();
  const toast = useToast();
  const [f, set] = useQueryState({ tab: 'bills', status: 'UNPAID' });
  const bills = useApi<any[]>(f.tab === 'bills' ? `/finance/vendor-bills${qs({ status: f.status === 'ALL' ? undefined : f.status, vendor_id: f.vendor_id, from: f.from, to: f.to })}` : null);
  const pays = useApi<any[]>(f.tab === 'payments' ? `/finance/vendor-payments${qs({ vendor_id: f.vendor_id, from: f.from, to: f.to })}` : null);
  const [pay, setPay] = useState<any>(null);
  const [form, setForm] = useState({ amount: '', mode: 'NEFT', reference: '', pay_date: today() });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const open = bills.data?.filter((b) => b.status !== 'PAID') ?? [];
  const submitPay = async () => {
    setBusy(true);
    setErr('');
    try {
      await api('/finance/vendor-payments', { body: { bill_id: pay.id, ...form, amount: Number(form.amount) } });
      toast('Payment recorded');
      setPay(null);
      bills.reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={user?.role === 'VENDOR' ? 'My bills & payments' : 'Vendor payables'} subtitle="Bills are created automatically from GRNs and local purchases, with due dates from payment terms" />
      <Tabs value={f.tab} onChange={(t) => set({ tab: t })} tabs={[{ value: 'bills', label: 'Bills' }, { value: 'payments', label: 'Payments made' },
        ...(user?.role !== 'VENDOR' ? [{ value: 'ageing', label: 'Ageing' }] : [])]} />
      {f.tab !== 'ageing' && (
        <SliceBar values={f} set={set} show={user?.role === 'VENDOR' ? ['dates'] : ['vendor', 'dates']} extra={f.tab === 'bills' && (
          <div className="seg">
            {[['UNPAID', 'Unpaid'], ['OVERDUE', 'Overdue'], ['PAID', 'Paid'], ['ALL', 'All']].map(([v, l]) => <button key={v} className={f.status === v ? 'active' : ''} onClick={() => set({ status: v })}>{l}</button>)}
          </div>)} />
      )}
      {f.tab === 'bills' && (
        <>
          {f.status !== 'PAID' && bills.data && (
            <div className="kpis">
              <Kpi label="Outstanding" value={money(open.reduce((a, b) => a + b.balance, 0))} sub={`${open.length} bills`} />
              <Kpi label="Overdue" value={money(open.filter((b) => b.overdue_days > 0).reduce((a, b) => a + b.balance, 0))} sub={`${open.filter((b) => b.overdue_days > 0).length} bills`} tone="red" />
              <Kpi label="Due in 7 days" value={money(open.filter((b) => b.overdue_days === 0 && b.due_date <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).reduce((a, b) => a + b.balance, 0))} />
            </div>
          )}
          <Card pad={false}>
            <DataTable loading={bills.loading} rows={bills.data} exportName="vendor-bills"
              rowClass={(b) => (b.status !== 'PAID' && b.overdue_days > 0 ? 'row-danger' : '')}
              columns={[
                { key: 'bill_no', label: 'Bill', primary: true, render: (b) => <span>{b.bill_no} <span className="muted small">{b.grn_no ?? b.lp_no}</span></span> },
                { key: 'vendor_name', label: 'Vendor' },
                { key: 'bill_date', label: 'Bill date', render: (b) => fmtDate(b.bill_date) },
                { key: 'due_date', label: 'Due', render: (b) => <span className={b.status !== 'PAID' && b.overdue_days > 0 ? 'text-red' : ''}>{fmtDate(b.due_date)}{b.status !== 'PAID' && b.overdue_days > 0 && ` (${b.overdue_days}d)`}</span> },
                { key: 'total', label: 'Amount', align: 'right', value: (b) => b.amount + b.tax_amount, sum: true, render: (b) => money(b.total ?? b.amount + b.tax_amount, true) },
                { key: 'paid', label: 'Paid', align: 'right', sum: true, render: (b) => money(b.paid, true) },
                { key: 'balance', label: 'Balance', align: 'right', sum: true, render: (b) => <strong>{money(b.balance, true)}</strong> },
                { key: 'status', label: 'Status', render: (b) => <Badge>{b.status}</Badge> },
                ...(can('FINANCE') ? [{ key: 'act', label: '', render: (b: any) => b.status !== 'PAID' && (
                  <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setErr(''); setForm({ amount: String(b.balance), mode: 'NEFT', reference: '', pay_date: today() }); setPay(b); }}>Pay</button>) }] : []),
              ]} />
          </Card>
        </>
      )}
      {f.tab === 'payments' && (
        <Card pad={false}>
          <DataTable loading={pays.loading} rows={pays.data} exportName="vendor-payments" columns={[
            { key: 'pay_date', label: 'Date', render: (p) => fmtDate(p.pay_date) },
            { key: 'vendor_name', label: 'Vendor', primary: true },
            { key: 'bill_no', label: 'Bill' },
            { key: 'mode', label: 'Mode', render: (p) => <Badge tone="gray">{p.mode}</Badge> },
            { key: 'reference', label: 'Reference' },
            { key: 'amount', label: 'Amount', align: 'right', sum: true, render: (p) => money(p.amount, true) },
          ]} />
        </Card>
      )}
      {f.tab === 'ageing' && <Card pad={false} title="Payables ageing (by days past due)"><AgeingTable type="vendor" /></Card>}

      <Modal open={!!pay} onClose={() => setPay(null)} title={`Pay ${pay?.vendor_name ?? ''}`}
        footer={<><button className="btn btn-ghost" onClick={() => setPay(null)}>Cancel</button><button className="btn" disabled={busy} onClick={submitPay}>Record payment</button></>}>
        <ErrorBox>{err}</ErrorBox>
        {pay && <p className="muted">Bill {pay.bill_no} · balance {money(pay.balance, true)} · due {fmtDate(pay.due_date)}</p>}
        <div className="form-grid">
          <Field label="Amount" required><Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" max={today()} value={form.pay_date} onChange={(e) => setForm({ ...form, pay_date: e.target.value })} /></Field>
          <Field label="Mode"><Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} options={['NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH'].map((m) => ({ value: m, label: m }))} /></Field>
          <Field label="Reference / UTR"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}
