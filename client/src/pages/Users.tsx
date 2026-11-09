import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { invalidateLookups, useApi, useLookups, useQueryState } from '../lib/hooks';
import { Badge, Card, ErrorBox, Icon, PageHeader, Spinner, Tabs, useToast } from '../components/ui';
import { Field, Input, Modal, Select } from '../components/Form';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../lib/auth';

type AccessMap = Record<string, { view: boolean; edit: boolean }>;
interface Role { code: string; name: string; scope: string; built_in: boolean; user_count: number; access: AccessMap }
interface Module { key: string; label: string; group: string; has_view: boolean; has_edit: boolean }
interface RolesData { roles: Role[]; modules: Module[] }

const SCOPES = [{ value: 'SITES', label: 'Assigned sites only' }, { value: 'REGION', label: 'One region' }, { value: 'ALL', label: 'All sites' }];
const SCOPE_LABEL: Record<string, string> = { SITES: 'Assigned sites', REGION: 'Region', ALL: 'All sites', VENDOR: 'Own vendor account' };
const STAGES = [{ code: 'MANAGER', label: 'Site Manager' }, { code: 'SUPERVISOR', label: 'Supervisor' }, { code: 'OPS_HEAD', label: 'Ops Head' }, { code: 'CBO', label: 'CBO' }];

export default function Users() {
  const [f, set] = useQueryState({ tab: 'users' });
  const roles = useApi<RolesData>('/roles');
  return (
    <>
      <PageHeader title="Users, roles & access" subtitle="Roles decide what people can do; site assignments decide what they can see" />
      <Tabs value={f.tab} onChange={(t) => set({ tab: t })} tabs={[{ value: 'users', label: 'Users' }, { value: 'roles', label: 'Roles & access' }]} />
      {f.tab === 'roles' ? <RolesAccess data={roles.data} loading={roles.loading} reload={roles.reload} /> : <UserList roles={roles.data?.roles ?? []} onChanged={roles.reload} />}
    </>
  );
}

function UserList({ roles, onChanged }: { roles: Role[]; onChanged: () => void }) {
  const lk = useLookups();
  const toast = useToast();
  const { user, allowed, isRole } = useAuth();
  const { data, loading, reload } = useApi<any[]>('/users');
  const settings = useApi<any>('/settings');
  const [edit, setEdit] = useState<any>(null);
  const [siteFilter, setSiteFilter] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [chain, setChain] = useState<string[]>([]);
  const canEdit = allowed('users', 'edit');
  useEffect(() => {
    if (settings.data) setChain(settings.data.indent_approval_chain);
  }, [settings.data]);

  const scopeOf = (code: string) => roles.find((r) => r.code === code)?.scope;

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const body = { ...edit, site_ids: scopeOf(edit.role) === 'SITES' ? edit.site_ids : [] };
      if (edit.id) await api(`/users/${edit.id}`, { method: 'PUT', body });
      else await api('/users', { body });
      invalidateLookups();
      toast('User saved');
      setEdit(null);
      reload();
      onChanged();
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

  const scopeText = (u: any) => (u.role_scope === 'SITES' ? `${u.site_ids.length} site(s)` : u.role_scope === 'REGION' ? (u.region_name ? `${u.region_name} region` : 'All regions') : u.vendor_name ?? 'All sites');
  const sites = (lk?.sites ?? []).filter((s) => !siteFilter || s.name.toLowerCase().includes(siteFilter.toLowerCase()) || s.client_name.toLowerCase().includes(siteFilter.toLowerCase()));
  const editing = edit ? scopeOf(edit.role) : undefined;
  const self = edit?.id === user?.id;
  const assignable = roles.filter((r) => r.code !== 'ADMIN' || isRole());

  return (
    <>
      <Card pad={false} title="Users" actions={canEdit && <button className="btn btn-sm" onClick={() => { setErr(''); setEdit({ name: '', email: '', role: 'BARISTA', password: '', site_ids: [], active: true, employee_id: '' }); }}><Icon name="plus" size={15} /> Add user</button>}>
        <DataTable loading={loading} rows={data} exportName="users" onRowClick={canEdit ? (u) => { setErr(''); setEdit({ ...u, password: '', employee_id: u.employee_id ?? '' }); } : undefined} columns={[
          { key: 'name', label: 'Name', primary: true },
          { key: 'email', label: 'Email' },
          { key: 'role_name', label: 'Role', render: (u) => <Badge tone="teal">{u.role_name}</Badge> },
          { key: 'scope', label: 'Can see', value: scopeText, render: scopeText },
          { key: 'employee_name', label: 'Employee', render: (u) => (u.employee_name ? <span>{u.employee_name} <span className="muted small">{u.employee_code}</span></span> : '—') },
          { key: 'active', label: 'Status', render: (u) => <Badge tone={u.active ? 'green' : 'gray'}>{u.active ? 'Active' : 'Disabled'}</Badge> },
        ]} />
      </Card>

      {allowed('settings', 'edit') && (
        <Card title="Indent approval chain" actions={<button className="btn btn-sm" onClick={saveChain}>Save chain</button>}>
          <p className="muted small" style={{ marginBottom: '.75rem' }}>Indents raised by a role skip stages at or below it. After the last stage, the indent goes to Supply Chain for fulfilment.</p>
          <div className="row gap">
            {STAGES.map((r) => (
              <label key={r.code} className="check"><input type="checkbox" checked={chain.includes(r.code)}
                onChange={(e) => setChain(STAGES.map((s) => s.code).filter((x) => (x === r.code ? e.target.checked : chain.includes(x))))} /> {r.label}</label>
            ))}
          </div>
        </Card>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit user' : 'Add user'} wide
        footer={<><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn" disabled={busy} onClick={save}>Save</button></>}>
        <ErrorBox>{err}</ErrorBox>
        {edit && (
          <>
            <div className="form-grid">
              <Field label="Name" required><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Email" required><Input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
              <Field label="Role" required hint={self ? 'You cannot change your own role' : undefined}>
                <Select value={edit.role} disabled={self} onChange={(e) => setEdit({ ...edit, role: e.target.value })} options={assignable.map((r) => ({ value: r.code, label: r.name }))} />
              </Field>
              <Field label={edit.id ? 'New password' : 'Password'} required={!edit.id} hint={edit.id ? 'Leave blank to keep current' : 'At least 6 characters'}>
                <Input type="password" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
              </Field>
              <Field label="Linked employee" hint="Lets this person use My attendance">
                <Select value={edit.employee_id} placeholder="None" onChange={(e) => setEdit({ ...edit, employee_id: e.target.value })} options={(lk?.employees ?? []).map((x) => ({ value: x.id, label: `${x.name} (${x.code})` }))} />
              </Field>
              {editing === 'REGION' && (
                <Field label="Region" hint="Blank = all regions">
                  <Select value={edit.region_id ?? ''} placeholder="All regions" onChange={(e) => setEdit({ ...edit, region_id: e.target.value })} options={(lk?.regions ?? []).map((r) => ({ value: r.id, label: r.name }))} />
                </Field>
              )}
              {editing === 'VENDOR' && (
                <Field label="Vendor" required>
                  <Select value={edit.vendor_id ?? ''} placeholder="Select…" onChange={(e) => setEdit({ ...edit, vendor_id: e.target.value })} options={(lk?.vendors ?? []).map((v) => ({ value: v.id, label: v.name }))} />
                </Field>
              )}
              <Field label="Active"><label className="check"><input type="checkbox" checked={edit.active} disabled={self} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Can sign in</label></Field>
            </div>
            {editing === 'SITES' && (
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

function RolesAccess({ data, loading, reload }: { data?: RolesData; loading: boolean; reload: () => void }) {
  const toast = useToast();
  const { isRole } = useAuth();
  const [code, setCode] = useState('BARISTA');
  const [draft, setDraft] = useState<AccessMap>({});
  const [adding, setAdding] = useState<{ name: string; scope: string; copy_from: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const role = data?.roles.find((r) => r.code === code);
  useEffect(() => {
    if (role) setDraft(role.access);
  }, [role]);

  if (loading && !data) return <Spinner />;
  if (!data || !role) return null;

  const isAdminRole = role.code === 'ADMIN';
  const editable = isRole() && !isAdminRole;
  const get = (m: Module) => (isAdminRole ? { view: m.has_view, edit: m.has_edit } : draft[m.key] ?? { view: false, edit: false });
  const toggle = (m: Module, level: 'view' | 'edit', on: boolean) => {
    const cur = get(m);
    // edit needs view, and removing view removes edit
    const next = level === 'edit' ? { view: on ? m.has_view : cur.view, edit: on } : { view: on, edit: on ? cur.edit : false };
    setDraft({ ...draft, [m.key]: next });
  };
  const dirty = data.modules.some((m) => {
    const a = draft[m.key] ?? { view: false, edit: false }, b = role.access[m.key] ?? { view: false, edit: false };
    return a.view !== b.view || a.edit !== b.edit;
  });

  const save = async () => {
    setBusy(true);
    try {
      await api(`/roles/${role.code}/access`, { method: 'PUT', body: { access: draft } });
      toast(`Access saved for ${role.name}. It applies on their next action.`);
      reload();
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ code: string }>('/roles', { body: adding });
      toast('Role created');
      setAdding(null);
      setCode(r.code);
      reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete the role "${role.name}"?`)) return;
    try {
      await api(`/roles/${role.code}`, { method: 'DELETE' });
      toast('Role deleted');
      setCode('BARISTA');
      reload();
    } catch (e: any) {
      toast(e.message, 'err');
    }
  };

  const groups = [...new Set(data.modules.map((m) => m.group))];
  return (
    <>
      <Card>
        <div className="stack" style={{ gap: '.75rem' }}>
          <div className="entry-head">
            <div className="site"><Select value={code} aria-label="Role" onChange={(e) => setCode(e.target.value)} options={data.roles.map((r) => ({ value: r.code, label: `${r.name}${r.built_in ? '' : ' (custom)'}` }))} /></div>
            {isRole() && <button className="btn btn-ghost btn-sm" onClick={() => { setErr(''); setAdding({ name: '', scope: 'SITES', copy_from: role.code }); }}><Icon name="plus" size={15} /> New role</button>}
            {isRole() && !role.built_in && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={remove}>Delete role</button>}
          </div>
          <p className="muted small">
            {role.user_count} active user(s) · Can see: {SCOPE_LABEL[role.scope]}
            {isAdminRole ? ' · Admin always has full access.' : ''}
            {!role.built_in ? ' · Custom roles cannot be approval stages in the indent chain.' : ''}
          </p>
          <div className="sheet">
            {groups.map((g) => (
              <div key={g}>
                <div className="access-group">{g}</div>
                {data.modules.filter((m) => m.group === g).map((m) => {
                  const a = get(m);
                  return (
                    <div key={m.key} className="sheet-row access-row">
                      <div className="sheet-item">{m.label}</div>
                      <div className="access-check">{m.has_view && <label className="check"><input type="checkbox" checked={a.view} disabled={!editable} aria-label={`${m.label} view`} onChange={(e) => toggle(m, 'view', e.target.checked)} /> View</label>}</div>
                      <div className="access-check">{m.has_edit && <label className="check"><input type="checkbox" checked={a.edit} disabled={!editable} aria-label={`${m.label} edit`} onChange={(e) => toggle(m, 'edit', e.target.checked)} /> Edit</label>}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Card>
      {editable && (
        <div className="action-bar">
          <span className="muted small grow">{dirty ? `Changes to ${role.name} not saved yet` : `Access for ${role.name}`}</span>
          <button className="btn" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save access'}</button>
        </div>
      )}
      <Modal open={!!adding} onClose={() => setAdding(null)} title="New role"
        footer={<><button className="btn btn-ghost" onClick={() => setAdding(null)}>Cancel</button><button className="btn" disabled={busy} onClick={create}>Create role</button></>}>
        <ErrorBox>{err}</ErrorBox>
        {adding && (
          <div className="form-grid">
            <Field label="Role name" required><Input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="e.g. Store Keeper" /></Field>
            <Field label="Can see"><Select value={adding.scope} onChange={(e) => setAdding({ ...adding, scope: e.target.value })} options={SCOPES} /></Field>
            <Field label="Start with access from"><Select value={adding.copy_from} placeholder="No access" onChange={(e) => setAdding({ ...adding, copy_from: e.target.value })} options={data.roles.filter((r) => r.code !== 'ADMIN').map((r) => ({ value: r.code, label: r.name }))} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}
