import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtDate, fmtDateTime, qty, ROLE_LABEL } from '../lib/format';
import { Badge, Card, ErrorBox, PageHeader, Spinner, Stat, useToast } from '../components/ui';
import { Modal } from '../components/Form';
import { useAuth } from '../lib/auth';

export default function IndentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user, can } = useAuth();
  const { data: d, loading, error, reload } = useApi<any>(`/indents/${id}`);
  const [approved, setApproved] = useState<Record<number, string>>({});
  const [dialog, setDialog] = useState<null | 'reject' | 'send-back' | 'cancel' | 'close'>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (loading && !d) return <Spinner />;
  if (!d) return <ErrorBox>{error}</ErrorBox>;

  const act = async (action: string, body: any = {}) => {
    setBusy(true);
    setErr('');
    try {
      await api(`/indents/${id}/${action}`, { body });
      toast(`Indent ${action.replace('-', ' ')}${action.endsWith('e') ? 'd' : 'ed'}`);
      setDialog(null);
      setComment('');
      reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const stages: string[] = d.chain;
  const doneStages = new Set(d.approvals.filter((a: any) => a.action === 'APPROVE').map((a: any) => a.stage));
  const isOpen = ['APPROVED', 'PARTIAL'].includes(d.status);
  const canCancel = ['DRAFT', 'PENDING', 'APPROVED'].includes(d.status) && (d.created_by === user?.id || can('SUPERVISOR', 'OPS_HEAD', 'CBO', 'SCM'));

  return (
    <>
      <PageHeader back="/indents" title={<>{d.indent_no} <Badge>{d.status}</Badge></>} subtitle={`${d.site_name} · ${d.client_name}`}
        actions={<>
          {d.status === 'DRAFT' && <Link className="btn btn-ghost" to={`/indents/${id}/edit`}>Edit</Link>}
          {d.status === 'DRAFT' && <button className="btn" disabled={busy} onClick={() => act('submit')}>Submit</button>}
          {d.permissions.canFulfil && <>
            <button className="btn" onClick={() => nav(`/dispatches/new?indent_id=${id}`)}>Dispatch from warehouse</button>
            <button className="btn btn-ghost" onClick={() => nav(`/local-purchases?new=1&indent_id=${id}&site_id=${d.site_id}`)}>Local purchase</button>
            <button className="btn btn-ghost" onClick={() => nav(`/purchase-orders/new?indent_id=${id}&site_id=${d.site_id}`)}>Direct PO to site</button>
          </>}
          {!d.permissions.canFulfil && isOpen && can('MANAGER', 'SUPERVISOR') && (
            <button className="btn btn-ghost" onClick={() => nav(`/local-purchases?new=1&indent_id=${id}&site_id=${d.site_id}`)}>Buy locally</button>
          )}
        </>} />
      <ErrorBox>{err}</ErrorBox>

      <Card>
        <div className="stats">
          <Stat label="Required by">{fmtDate(d.required_date)}</Stat>
          <Stat label="Raised">{fmtDate(d.indent_date)} · {d.created_by_name}</Stat>
          <Stat label="Priority"><Badge>{d.priority}</Badge></Stat>
          <Stat label="Awaiting">{d.current_stage ? ROLE_LABEL[d.current_stage] : isOpen ? 'Supply Chain (fulfilment)' : '—'}</Stat>
        </div>
        <div className="chain" style={{ marginTop: '1rem' }}>
          {stages.map((s, i) => (
            <span key={s} className="row" style={{ gap: '.25rem' }}>
              {i > 0 && <span className="arrow">›</span>}
              <span className={`step ${doneStages.has(s) ? 'done' : d.current_stage === s ? 'current' : ''}`}>{ROLE_LABEL[s]}</span>
            </span>
          ))}
          <span className="arrow">›</span>
          <span className={`step ${['FULFILLED', 'CLOSED'].includes(d.status) ? 'done' : isOpen ? 'current' : ''}`}>SCM fulfilment</span>
        </div>
        {d.notes && <p className="muted" style={{ marginTop: '.75rem' }}>{d.notes}</p>}
      </Card>

      <Card title="Items" pad={false}>
        <div className="dt-scroll">
          <table className="table">
            <thead>
              <tr><th>Item</th><th className="ta-right">Requested</th><th className="ta-right">Approved</th><th className="ta-right">Fulfilled</th>
                <th className="ta-right">Site stock</th><th className="ta-right">Warehouse stock</th></tr>
            </thead>
            <tbody>
              {d.lines.map((l: any) => {
                const need = l.qty_approved ?? l.qty_requested;
                return (
                  <tr key={l.id}>
                    <td className="td-primary" data-label="Item">{l.item_name} <Badge>{l.category}</Badge></td>
                    <td className="ta-right" data-label="Requested">{qty(l.qty_requested, l.uom)}</td>
                    <td className="ta-right" data-label="Approved">
                      {d.permissions.canApprove ? (
                        <input className="input" style={{ maxWidth: 110 }} type="number" min="0" step="any" inputMode="decimal" aria-label={`Approve ${l.item_name}`}
                          value={approved[l.id] ?? String(need)} onChange={(e) => setApproved({ ...approved, [l.id]: e.target.value })} />
                      ) : qty(l.qty_approved ?? (['DRAFT', 'PENDING', 'REJECTED', 'CANCELLED'].includes(d.status) ? null : l.qty_requested), l.uom)}
                    </td>
                    <td className="ta-right" data-label="Fulfilled"><span className={l.qty_fulfilled >= need ? 'text-green' : ''}>{qty(l.qty_fulfilled, l.uom)}</span></td>
                    <td className="ta-right" data-label="Site stock">{qty(l.site_stock, l.uom)}</td>
                    <td className={`ta-right ${l.wh_stock < need ? 'text-red' : ''}`} data-label="Warehouse stock">{l.category === 'STORE' ? 'Local buy' : qty(l.wh_stock, l.uom)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {d.permissions.canApprove && (
          <div className="card-body row gap" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--border)' }}>
            <span className="muted small grow">You can reduce approved quantities before approving.</span>
            <button className="btn btn-ghost" onClick={() => setDialog('send-back')}>Send back</button>
            <button className="btn btn-danger" onClick={() => setDialog('reject')}>Reject</button>
            <button className="btn" disabled={busy} onClick={() => act('approve', { lines: Object.entries(approved).map(([lid, v]) => ({ id: Number(lid), qty_approved: v })) })}>
              Approve as {ROLE_LABEL[d.current_stage]}
            </button>
          </div>
        )}
      </Card>

      <div className="grid grid-2">
        <Card title="Approval history">
          <ul className="timeline">
            {d.approvals.map((a: any) => (
              <li key={a.id}>
                <span className={`tl-dot ${a.action === 'REJECT' || a.action === 'CANCEL' ? 'red' : ''}`} />
                <div>
                  <strong>{a.action.replace('_', ' ').toLowerCase().replace(/^./, (c: string) => c.toUpperCase())}</strong> by {a.user_name} <span className="muted">({ROLE_LABEL[a.stage] ?? a.stage})</span>
                  <div className="muted small">{fmtDateTime(a.acted_at)}{a.comment && ` · “${a.comment}”`}</div>
                </div>
              </li>
            ))}
            {!d.approvals.length && <li className="muted">Not submitted yet</li>}
          </ul>
        </Card>
        <Card title="Fulfilment documents">
          <ul className="timeline">
            {d.dispatches.map((x: any) => <li key={`d${x.id}`}><span className="tl-dot" /><div><Link to={`/dispatches/${x.id}`}>{x.dispatch_no}</Link> dispatch · {fmtDate(x.dispatch_date)} <Badge>{x.status}</Badge></div></li>)}
            {d.local_purchases.map((x: any) => <li key={`l${x.id}`}><span className="tl-dot" /><div>{x.lp_no} local purchase · {fmtDate(x.purchase_date)}</div></li>)}
            {d.purchase_orders.map((x: any) => <li key={`p${x.id}`}><span className="tl-dot" /><div><Link to={`/purchase-orders/${x.id}`}>{x.po_no}</Link> PO · {fmtDate(x.po_date)} <Badge>{x.status}</Badge></div></li>)}
            {!d.dispatches.length && !d.local_purchases.length && !d.purchase_orders.length && <li className="muted">Nothing fulfilled yet</li>}
          </ul>
          <div className="row gap" style={{ marginTop: '1rem' }}>
            {canCancel && <button className="btn btn-ghost btn-sm" onClick={() => setDialog('cancel')}>Cancel indent</button>}
            {['APPROVED', 'PARTIAL', 'FULFILLED'].includes(d.status) && can('SCM', 'OPS_HEAD') && <button className="btn btn-ghost btn-sm" onClick={() => setDialog('close')}>Close indent</button>}
          </div>
        </Card>
      </div>

      <Modal open={!!dialog} onClose={() => setDialog(null)} title={{ reject: 'Reject indent', 'send-back': 'Send back for changes', cancel: 'Cancel indent', close: 'Close indent' }[dialog ?? 'reject']}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setDialog(null)}>Back</button>
          <button className={`btn ${dialog === 'reject' || dialog === 'cancel' ? 'btn-danger' : ''}`} disabled={busy || (dialog === 'reject' && !comment)} onClick={() => act(dialog!, { comment })}>Confirm</button>
        </>}>
        <ErrorBox>{err}</ErrorBox>
        <label className="field">
          <span className="field-label">{dialog === 'reject' ? 'Reason (required)' : 'Comment'}</span>
          <textarea className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        {dialog === 'close' && <p className="muted small">Closing marks any unfulfilled quantity as not required.</p>}
      </Modal>
    </>
  );
}
