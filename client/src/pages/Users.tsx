import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApi, useLookups } from '../lib/hooks';
import { ROLE_LABEL } from '../lib/format';
import { Badge, Card, ErrorBox, Icon, PageHeader, useToast } from '../components/ui';
import { Field, Input, Modal, Select } from '../components/Form';
import { DataTable } from '../components/DataTable';

const SCOPED = ['BARISTA', 'MANAGER', 'SUPERVISOR'];

export default function Users() {
  const lk = useLookups();
  const toast = useToast();
  const { data, loading, reload } = useApi<any[]>('/users');
  const settings = useApi<any>('/settings');
  const [edit, setEdit] = useState<any>(null);
  const [siteFilter, setSiteFilter] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [chain, setChain] = useState<string[]>([]);
  useEffect(() => {
    if (settings.data) setChain(settings.data.indent_approval_chain);
  }, [settings.data]);

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const body = { ...edit, site_ids: SCOPED.includes(edit.role) ? edit.site_ids : [] };
      if (edit.id) await api(`/users/${edit.id}`, { method: 'PUT', body });
      else await api('/users', { body });
      toast('User saved');
      setEdit(null);
      reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveChain = async () => {
    try {
      await api('/settings', { method: 'PUT', body: { indent_approval_chain: chain } });
      toast('Approval chain updated');
    } catch (e: any) {
      toast(e.message, 'err');
    }
  };

  const sites = (lk?.sites ?? []).filter((s) => !siteFilter || s.name.toLowerCase().includes(siteFilter.toLowerCase()) || s.client_name.toLowerCase().includes(siteFilter.toLowerCase()));
  return (
    <>
      <PageHeader title="Users & access" subtitle="Roles decide what people can do; site assignments decide what they can see"
        actions={<button className="btn" onClick={() => { setErr(''); setEdit({ name: '', email: '', role: 'BARISTA', password: '', site_ids: [], active: true }); }}><Icon name="plus" size={16} /> Add user</button>} />
      <Card pad={false}>
        <DataTable loading={loading} rows={data} exportName="users" onRowClick={(u) => { setErr(''); setEdit({ ...u, password: '' }); }} columns={[
          { key: 'name', label: 'Name', primary: true },
          { key: 'email', label: 'Email' },
          { key: 'role', label: 'Role', render: (u) => <Badge tone="teal">{ROLE_LABEL[u.role]}</Badge> },
          { key: 'scope', label: 'Scope', value: (u) => (SCOPED.includes(u.role) ? `${u.site_ids.length} site(s)` : u.region_name ?? u.vendor_name ?? 'All'),
            render: (u) => (SCOPED.includes(u.role) ? `${u.site_ids.length} site(s)` : u.role === 'OPS_HEAD' && u.region_name ? `${u.region_name} region` : u.vendor_name ?? 'All sites') },
          { key: 'active', label: 'Status', render: (u) => <Badge tone={u.active ? 'green' : 'gray'}>{u.active ? 'Active' : 'Disabled'}</Badge> },
        ]} />
      </Card>

      <Card title="Indent approval chain" actions={<button className="btn btn-sm" onClick={saveChain}>Save chain</button>}>
        <p className="muted small" style={{ marginBottom: '.75rem' }}>Indents raised by a role skip stages at or below it. After the last stage, the indent goes to Supply Chain for fulfilment.</p>
        <div className="row gap">
          {['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO'].map((r) => (
            <label key={r} className="check"><input type="checkbox" checked={chain.includes(r)}
              onChange={(e) => setChain(['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO'].filter((x) => (x === r ? e.target.checked : chain.includes(x))))} /> {ROLE_LABEL[r]}</label>
          ))}
        </div>
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit user' : 'Add user'} wide
        footer={<><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn" disabled={busy} onClick={save}>Save</button></>}>
        <ErrorBox>{err}</ErrorBox>
        {edit && (
          <>
            <div className="form-grid">
              <Field label="Name" required><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Email" required><Input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
              <Field label="Role" required>
                <Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} options={Object.entries(ROLE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
              </Field>
              <Field label={edit.id ? 'New password' : 'Password'} required={!edit.id} hint={edit.id ? 'Leave blank to keep current' : 'At least 6 characters'}>
                <Input type="password" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
              </Field>
              {edit.role === 'OPS_HEAD' && (
                <Field label="Region" hint="Blank = all regions">
                  <Select value={edit.region_id ?? ''} placeholder="All regions" onChange={(e) => setEdit({ ...edit, region_id: e.target.value })} options={(lk?.regions ?? []).map((r) => ({ value: r.id, label: r.name }))} />
                </Field>
              )}
              {edit.role === 'VENDOR' && (
                <Field label="Vendor" required>
                  <Select value={edit.vendor_id ?? ''} placeholder="Select…" onChange={(e) => setEdit({ ...edit, vendor_id: e.target.value })} options={(lk?.vendors ?? []).map((v) => ({ value: v.id, label: v.name }))} />
                </Field>
              )}
              <Field label="Active"><label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Can sign in</label></Field>
            </div>
            {SCOPED.includes(edit.role) && (
              <div className="stack" style={{ gap: '.5rem' }}>
                <div className="row gap">
                  <strong className="grow">Assigned sites ({edit.site_ids.length})</strong>
                  <input className="input" style={{ maxWidth: 220 }} placeholder="Filter sites…" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} />
                </div>
                <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: '.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '.3rem' }}>
                  {sites.map((s) => (
                    <label key={s.id} className="check small">
                      <input type="checkbox" checked={edit.site_ids.includes(s.id)}
                        onChange={(e) => setEdit({ ...edit, site_ids: e.target.checked ? [...edit.site_ids, s.id] : edit.site_ids.filter((x: number) => x !== s.id) })} />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
