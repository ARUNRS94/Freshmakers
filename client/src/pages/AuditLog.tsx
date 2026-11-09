import { useState } from 'react';
import { qs } from '../lib/api';
import { useApi, useQueryState } from '../lib/hooks';
import { fmtDateTime } from '../lib/format';
import { Badge, Card, ErrorBox, PageHeader } from '../components/ui';
import { Modal } from '../components/Form';
import { DataTable } from '../components/DataTable';
import { SliceBar, defaultRange } from '../components/Filters';

const TONE: Record<string, string> = { CREATE: 'green', UPDATE: 'blue', DELETE: 'red' };

// table and column names as people know them; the database still says "client"
const words = (s: string) => s.replace(/_id$/, '').replace(/_/g, ' ').replace(/\bclient/g, 'customer');
const title = (s: string) => words(s).replace(/^./, (c) => c.toUpperCase());
const show = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : v === true ? 'Yes' : v === false ? 'No' : String(v));

function summary(r: any) {
  if (r.action === 'CREATE' && r.new_data) return 'New record';
  if (r.action === 'DELETE' && r.old_data) return 'Removed';
  if (r.new_data) return Object.keys(r.new_data).map(words).join(', ');
  return r.details ? JSON.stringify(r.details) : '';
}

export default function AuditLog() {
  const [f, set] = useQueryState(defaultRange(7));
  const filters = useApi<{ entities: string[]; actions: string[]; users: { id: number; name: string }[] }>('/audit/filters');
  const { data, loading, error } = useApi<any[]>(`/audit${qs({ from: f.from, to: f.to, user_id: f.user_id, entity: f.entity, action: f.action })}`);
  const [sel, setSel] = useState<any>(null);
  const fields: string[] = sel ? [...new Set([...Object.keys(sel.old_data ?? {}), ...Object.keys(sel.new_data ?? {})])] : [];

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change to the data: who made it, when, and what it was before and after" />
      <SliceBar values={f} set={set} show={['dates']} extra={<>
        <select className="input" value={f.user_id ?? ''} aria-label="User" onChange={(e) => set({ user_id: e.target.value })}><option value="">All users</option>{filters.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <select className="input" value={f.entity ?? ''} aria-label="Record type" onChange={(e) => set({ entity: e.target.value })}><option value="">All records</option>{filters.data?.entities.map((x) => <option key={x} value={x}>{title(x)}</option>)}</select>
        <select className="input" value={f.action ?? ''} aria-label="Action" onChange={(e) => set({ action: e.target.value })}><option value="">All actions</option>{filters.data?.actions.map((x) => <option key={x} value={x}>{title(x.toLowerCase())}</option>)}</select>
      </>} />
      <ErrorBox>{error}</ErrorBox>
      {data?.length === 1000 && <div className="alert-box warn">Showing the latest 1,000 changes. Narrow the dates or filters to see older ones.</div>}
      <Card pad={false}>
        <DataTable loading={loading} rows={data} exportName="audit-log" onRowClick={setSel} empty="No changes in this period" columns={[
          { key: 'at', label: 'When', render: (r) => fmtDateTime(r.at), value: (r) => r.at },
          { key: 'user_name', label: 'User', render: (r) => r.user_name ?? 'System', value: (r) => r.user_name ?? 'System' },
          { key: 'action', label: 'Action', render: (r) => <Badge tone={TONE[r.action] ?? 'gray'}>{title(r.action.toLowerCase())}</Badge> },
          { key: 'entity', label: 'Record', primary: true, value: (r) => `${title(r.entity)} ${r.label ?? r.entity_id ?? ''}`, render: (r) => <span>{title(r.entity)} <span className="muted small">{r.label ?? (r.entity_id ? `#${r.entity_id}` : '')}</span></span> },
          { key: 'changes', label: 'Changed', value: summary, render: (r) => <span className="small">{summary(r)}</span> },
        ]} />
      </Card>
      <Modal open={!!sel} onClose={() => setSel(null)} wide title={sel ? `${title(sel.entity)} ${sel.label ?? (sel.entity_id ? `#${sel.entity_id}` : '')}` : ''}
        footer={<button className="btn btn-ghost" onClick={() => setSel(null)}>Close</button>}>
        {sel && (
          <>
            <p className="muted small">{title(sel.action.toLowerCase())} by {sel.user_name ?? 'System'} on {new Date(sel.at).toLocaleString('en-IN')}</p>
            {fields.length > 0 && (
              <div className="audit-changes">
                <strong>Field</strong><strong>Before</strong><strong>After</strong>
                {fields.map((k) => [
                  <span key={k}>{title(k)}</span>,
                  <span key={`${k}-o`}>{show(sel.old_data?.[k])}</span>,
                  <span key={`${k}-n`}>{show(sel.new_data?.[k])}</span>,
                ])}
              </div>
            )}
            {sel.details && <pre className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(sel.details, null, 2)}</pre>}
          </>
        )}
      </Modal>
    </>
  );
}
