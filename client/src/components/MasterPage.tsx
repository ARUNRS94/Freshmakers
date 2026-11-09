import { useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { invalidateLookups, useApi } from '../lib/hooks';
import { Badge, Card, ErrorBox, Icon, useToast } from './ui';
import { Field, Input, Modal } from './Form';
import { DataTable, type Column } from './DataTable';

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'date' | 'checkbox' | 'textarea' | 'email';
  options?: { value: string | number; label: string }[];
  required?: boolean;
  hint?: string;
  span?: boolean;
  defaultValue?: unknown;
}

interface Props {
  endpoint: string;
  title: string;
  columns: Column[];
  fields: FieldDef[];
  canEdit: boolean;
  query?: string;
  toolbar?: ReactNode;
  newLabel?: string;
  /** when false, rows can't be deactivated */
  deletable?: boolean;
}

export function MasterPage({ endpoint, title, columns, fields, canEdit, query = '', toolbar, newLabel = 'Add', deletable = true }: Props) {
  const toast = useToast();
  const { data, loading, reload } = useApi<any[]>(`${endpoint}${query}`);
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const blank = () => Object.fromEntries(fields.map((f) => [f.key, f.defaultValue ?? (f.type === 'checkbox' ? true : '')]));

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const body: Record<string, unknown> = {};
      for (const f of fields) {
        let v = edit![f.key];
        if (f.type === 'number' && v !== '' && v !== null && v !== undefined) v = Number(v);
        body[f.key] = v === undefined ? null : v;
      }
      if (edit!.id) await api(`${endpoint}/${edit!.id}`, { method: 'PUT', body });
      else await api(endpoint, { body });
      invalidateLookups();
      toast('Saved');
      setEdit(null);
      reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Deactivate / remove this record?')) return;
    try {
      await api(`${endpoint}/${edit!.id}`, { method: 'DELETE' });
      invalidateLookups();
      toast('Removed');
      setEdit(null);
      reload();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const cols: Column[] = [...columns];
  if (data?.some((r) => 'active' in r)) cols.push({ key: 'active', label: 'Status', render: (r) => (r.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>) });

  return (
    <Card pad={false} title={title} actions={canEdit && <button className="btn btn-sm" onClick={() => { setErr(''); setEdit(blank()); }}><Icon name="plus" size={15} /> {newLabel}</button>}>
      <DataTable loading={loading} rows={data} columns={cols} exportName={title.toLowerCase().replace(/\s+/g, '-')} toolbar={toolbar}
        onRowClick={canEdit ? (r) => { setErr(''); setEdit({ ...blank(), ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? ''])) }); } : undefined} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${title.replace(/s$/, '').toLowerCase()}` : `${newLabel}`}
        footer={<>
          {edit?.id && deletable && <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--red)' }} onClick={remove}>Remove</button>}
          <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
          <button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </>}>
        <ErrorBox>{err}</ErrorBox>
        {edit && (
          <div className="form-grid">
            {fields.map((f) => (
              <Field key={f.key} label={f.label} required={f.required} hint={f.hint} className={f.span || f.type === 'textarea' ? 'span-all' : ''}>
                {f.type === 'select' ? (
                  <select className="input" value={edit[f.key] ?? ''} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })}>
                    <option value="">—</option>
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === 'checkbox' ? (
                  <label className="check"><input type="checkbox" checked={!!edit[f.key]} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.checked })} /> Yes</label>
                ) : f.type === 'textarea' ? (
                  <textarea className="input" value={edit[f.key] ?? ''} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })} />
                ) : (
                  <Input type={f.type ?? 'text'} step={f.type === 'number' ? 'any' : undefined} value={edit[f.key] ?? ''} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })} />
                )}
              </Field>
            ))}
          </div>
        )}
      </Modal>
    </Card>
  );
}
