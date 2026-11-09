import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtDate, money, qty } from '../lib/format';
import { Badge, Card, ErrorBox, PageHeader, Spinner, Stat, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';

export default function DispatchDetail() {
  const { id } = useParams();
  const { allowed } = useAuth();
  const toast = useToast();
  const { data: d, loading, error, reload } = useApi<any>(`/dispatches/${id}`);
  const [recv, setRecv] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (d) setRecv(Object.fromEntries(d.lines.map((l: any) => [l.id, String(l.qty_received ?? l.qty_dispatched)])));
  }, [d]);

  if (loading && !d) return <Spinner />;
  if (!d) return <ErrorBox>{error}</ErrorBox>;
  const canReceive = d.status === 'IN_TRANSIT' && allowed('dispatch_receive', 'edit');

  const run = async (path: string, body: any, msg: string) => {
    setBusy(true);
    setErr('');
    try {
      await api(path, { body });
      toast(msg);
      reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader back="/dispatches" title={<>{d.dispatch_no} <Badge>{d.status}</Badge></>} subtitle={`${d.warehouse_name} → ${d.site_name}`}
        actions={d.status === 'IN_TRANSIT' && allowed('dispatches', 'edit') && <button className="btn btn-ghost" disabled={busy} onClick={() => confirm('Cancel dispatch and return stock to warehouse?') && run(`/dispatches/${id}/cancel`, {}, 'Dispatch cancelled')}>Cancel dispatch</button>} />
      <ErrorBox>{err}</ErrorBox>
      <Card>
        <div className="stats">
          <Stat label="Dispatched">{fmtDate(d.dispatch_date)}</Stat>
          <Stat label="Customer">{d.client_name}</Stat>
          <Stat label="Vehicle / driver">{d.vehicle_no ?? '—'} · {d.driver_name ?? '—'}</Stat>
          {d.indent_no && <Stat label="Indent"><Link to={`/indents/${d.indent_id}`}>{d.indent_no}</Link></Stat>}
          {d.received_date && <Stat label="Received">{fmtDate(d.received_date)} · {d.received_by_name}</Stat>}
        </div>
      </Card>
      <Card title={canReceive ? 'Confirm quantities received' : 'Items'} pad={false}>
        <div className="dt-scroll">
          <table className="table">
            <thead><tr><th>Item</th><th className="ta-right">Dispatched</th><th>Received</th><th className="ta-right">Short</th><th className="ta-right">Sale rate</th></tr></thead>
            <tbody>
              {d.lines.map((l: any) => {
                const got = Number(recv[l.id] ?? l.qty_received ?? 0);
                const short = (canReceive ? l.qty_dispatched - got : l.qty_received === null ? 0 : l.qty_dispatched - l.qty_received);
                return (
                  <tr key={l.id}>
                    <td className="td-primary" data-label="Item">{l.item_name}</td>
                    <td className="ta-right" data-label="Dispatched">{qty(l.qty_dispatched, l.uom)}</td>
                    <td data-label="Received">
                      {canReceive ? <input className="input" style={{ maxWidth: 120 }} type="number" min="0" max={l.qty_dispatched} step="any" inputMode="decimal"
                        value={recv[l.id] ?? ''} onChange={(e) => setRecv({ ...recv, [l.id]: e.target.value })} aria-label={`${l.item_name} received`} /> : qty(l.qty_received, l.uom)}
                    </td>
                    <td className={`ta-right ${short > 0.0001 ? 'text-red' : ''}`} data-label="Short">{short > 0.0001 ? qty(short, l.uom) : '—'}</td>
                    <td className="ta-right" data-label="Sale rate">{money(l.sale_rate, true)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canReceive && (
          <div className="card-body row gap" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--border)' }}>
            <span className="muted small grow">Stock will be added to the site and the customer invoice raised for received quantities.</span>
            <button className="btn" disabled={busy} onClick={() => run(`/dispatches/${id}/receive`, { lines: Object.entries(recv).map(([lid, q]) => ({ id: Number(lid), qty_received: Number(q || 0) })) }, 'Receipt confirmed')}>
              Confirm receipt
            </button>
          </div>
        )}
      </Card>
    </>
  );
}
