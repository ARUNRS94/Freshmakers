import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtDate, money, qty, today } from '../lib/format';
import { Badge, Card, ErrorBox, PageHeader, Spinner, Stat, useToast } from '../components/ui';
import { Field, Input, Modal } from '../components/Form';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../lib/auth';

export default function PODetail() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const toast = useToast();
  const { data: d, loading, error, reload } = useApi<any>(`/purchase-orders/${id}`);
  const [grnOpen, setGrnOpen] = useState(false);
  const [recv, setRecv] = useState<Record<number, { q: string; r: string; b: string; e: string }>>({});
  const [inv, setInv] = useState('');
  const [grnDate, setGrnDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (loading && !d) return <Spinner />;
  if (!d) return <ErrorBox>{error}</ErrorBox>;
  const open = ['OPEN', 'PARTIAL'].includes(d.status);
  const total = d.lines.reduce((a: number, l: any) => a + l.qty_ordered * l.rate, 0);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
      toast(msg);
      reload();
      return true;
    } catch (e: any) {
      setErr(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openGrn = () => {
    setRecv(Object.fromEntries(d.lines.map((l: any) => [l.id, { q: String(Math.max(0, l.qty_ordered - l.qty_received)), r: '', b: '', e: '' }])));
    setGrnOpen(true);
  };
  const postGrn = async () => {
    const ok = await run(() => api(`/purchase-orders/${id}/grn`, { body: { vendor_invoice_no: inv, grn_date: grnDate,
      lines: Object.entries(recv).map(([pl, v]) => ({ po_line_id: Number(pl), qty_received: Number(v.q || 0), qty_rejected: Number(v.r || 0), batch_no: v.b, expiry_date: v.e || undefined })) } }), 'Goods received, stock and vendor bill updated');
    if (ok) setGrnOpen(false);
  };

  return (
    <>
      <PageHeader back="/purchase-orders" title={<>{d.po_no} <Badge>{d.status}</Badge></>} subtitle={`${d.vendor_name} → ${d.deliver_to}`}
        actions={<>
          {user?.role === 'VENDOR' && !d.vendor_ack && open && <button className="btn" disabled={busy} onClick={() => run(() => api(`/purchase-orders/${id}/ack`, { body: {} }), 'Acknowledged')}>Acknowledge PO</button>}
          {open && can('SCM', 'MANAGER', 'SUPERVISOR') && <button className="btn" onClick={openGrn}>Receive goods (GRN)</button>}
          {d.status === 'OPEN' && can('SCM') && <button className="btn btn-ghost" disabled={busy} onClick={() => confirm('Cancel this PO?') && run(() => api(`/purchase-orders/${id}/cancel`, { body: {} }), 'PO cancelled')}>Cancel</button>}
          {d.status === 'PARTIAL' && can('SCM') && <button className="btn btn-ghost" disabled={busy} onClick={() => confirm('Short-close this PO? Pending quantity will not be received.') && run(() => api(`/purchase-orders/${id}/close`, { body: {} }), 'PO closed')}>Short close</button>}
        </>} />
      <ErrorBox>{!grnOpen && err}</ErrorBox>
      <Card>
        <div className="stats">
          <Stat label="PO date">{fmtDate(d.po_date)}</Stat>
          <Stat label="Expected">{fmtDate(d.expected_date)}</Stat>
          <Stat label="Payment terms">{d.payment_terms_text ?? `${d.payment_terms_days} days`}</Stat>
          <Stat label="Vendor acknowledged">{d.vendor_ack ? 'Yes' : 'Not yet'}</Stat>
          <Stat label="Order value">{money(total, true)}</Stat>
          {d.indent_no && <Stat label="Indent"><Link to={`/indents/${d.indent_id}`}>{d.indent_no}</Link></Stat>}
        </div>
      </Card>
      <Card title="Ordered vs received" pad={false}>
        <DataTable search={false} rows={d.lines} columns={[
          { key: 'item_name', label: 'Item', primary: true },
          { key: 'qty_ordered', label: 'Ordered', align: 'right', render: (l) => qty(l.qty_ordered, l.uom) },
          { key: 'qty_received', label: 'Received', align: 'right', render: (l) => qty(l.qty_received, l.uom) },
          { key: 'pending', label: 'Pending', align: 'right', value: (l) => Math.max(0, l.qty_ordered - l.qty_received), render: (l) => <span className={l.qty_ordered > l.qty_received ? 'text-warn' : 'text-green'}>{qty(Math.max(0, l.qty_ordered - l.qty_received), l.uom)}</span> },
          { key: 'rate', label: 'Rate', align: 'right', render: (l) => money(l.rate, true) },
          { key: 'amount', label: 'Amount', align: 'right', value: (l) => l.qty_ordered * l.rate, sum: true, render: (l) => money(l.amount ?? l.qty_ordered * l.rate, true) },
        ]} />
      </Card>
      <Card title="Goods receipts" pad={false}>
        <DataTable search={false} rows={d.grns} empty="No goods received yet" columns={[
          { key: 'grn_no', label: 'GRN', primary: true },
          { key: 'grn_date', label: 'Date', render: (g) => fmtDate(g.grn_date) },
          { key: 'vendor_invoice_no', label: 'Vendor invoice' },
          { key: 'lines', label: 'Items', render: (g) => (g.lines ?? []).map((l: any) => `${l.item_name}: ${l.qty_received}${l.qty_rejected ? ` (+${l.qty_rejected} rejected)` : ''}`).join(', ') },
          { key: 'created_by_name', label: 'By' },
        ]} />
      </Card>

      <Modal open={grnOpen} onClose={() => setGrnOpen(false)} title="Receive goods" wide
        footer={<><button className="btn btn-ghost" onClick={() => setGrnOpen(false)}>Cancel</button><button className="btn" disabled={busy} onClick={postGrn}>{busy ? 'Posting…' : 'Post GRN'}</button></>}>
        <ErrorBox>{err}</ErrorBox>
        <div className="form-grid">
          <Field label="Vendor invoice no."><Input value={inv} onChange={(e) => setInv(e.target.value)} /></Field>
          <Field label="Received on"><Input type="date" max={today()} value={grnDate} onChange={(e) => setGrnDate(e.target.value)} /></Field>
        </div>
        <div className="dt-scroll">
          <table className="table">
            <thead><tr><th>Item</th><th className="ta-right">Pending</th><th>Accepted</th><th>Rejected</th><th>Batch</th><th>Expiry</th></tr></thead>
            <tbody>
              {d.lines.map((l: any) => {
                const v = recv[l.id] ?? { q: '', r: '', b: '', e: '' };
                const up = (p: Partial<typeof v>) => setRecv({ ...recv, [l.id]: { ...v, ...p } });
                return (
                  <tr key={l.id}>
                    <td className="td-primary" data-label="Item">{l.item_name}</td>
                    <td className="ta-right" data-label="Pending">{qty(Math.max(0, l.qty_ordered - l.qty_received), l.uom)}</td>
                    <td data-label="Accepted"><input className="input" type="number" min="0" step="any" inputMode="decimal" value={v.q} onChange={(e) => up({ q: e.target.value })} /></td>
                    <td data-label="Rejected"><input className="input" type="number" min="0" step="any" inputMode="decimal" value={v.r} onChange={(e) => up({ r: e.target.value })} /></td>
                    <td data-label="Batch"><input className="input" value={v.b} onChange={(e) => up({ b: e.target.value })} /></td>
                    <td data-label="Expiry"><input className="input" type="date" value={v.e} onChange={(e) => up({ e: e.target.value })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">Posting adds accepted stock to {d.deliver_to} and creates a vendor bill due as per payment terms.</p>
      </Modal>
    </>
  );
}
