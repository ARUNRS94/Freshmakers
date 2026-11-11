import { useState } from 'react';
import { useLookups, useQueryState, useApi } from '../lib/hooks';
import { CredentialsModal, type Credentials } from '../components/Credentials';
import { api } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { Badge, Card, PageHeader, Tabs, useToast } from '../components/ui';
import { MasterPage } from '../components/MasterPage';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../lib/auth';
import { qs } from '../lib/api';

export default function Employees() {
  const [f, set] = useQueryState({ tab: 'staff' });
  const lk = useLookups();
  const { allowed } = useAuth();
  // the customer name too, so a site can be found by either
  const sites = (lk?.sites ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.client_name})` }));
  const emps = (lk?.employees ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.code})` }));
  return (
    <>
      <PageHeader title="Staff & deployment" subtitle="Who is deployed at which site, and on which shift" />
      <Tabs value={f.tab} onChange={(t) => set({ tab: t })} tabs={[{ value: 'staff', label: 'Employees' }, { value: 'deployments', label: 'Deployments' }, { value: 'gaps', label: 'Coverage gaps' }]} />
      {f.tab === 'staff' && <EmployeeMaster />}
      {f.tab === 'deployments' && <MasterPage endpoint="/deployments" title="Deployments" canEdit={allowed('deployments', 'edit')} newLabel="Deploy employee" query={qs({ site_id: f.site_id })}
        toolbar={<select className="input" style={{ width: 'auto', maxWidth: 240 }} value={f.site_id ?? ''} onChange={(e) => set({ site_id: e.target.value })} aria-label="Site"><option value="">All sites</option>{sites.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
        columns={[
          { key: 'employee_name', label: 'Employee', primary: true, render: (r) => <span>{r.employee_name} <span className="muted small">{r.employee_code} · {r.designation}</span></span> },
          { key: 'site_name', label: 'Site', render: (r) => <span>{r.site_name}<br /><span className="muted small">{r.client_name}</span></span> },
          { key: 'shift', label: 'Shift' },
          { key: 'from_date', label: 'From', render: (r) => fmtDate(r.from_date) },
          { key: 'to_date', label: 'To', render: (r) => (r.to_date ? fmtDate(r.to_date) : <span className="text-green">Current</span>) },
        ]}
        fields={[
          { key: 'employee_id', label: 'Employee', type: 'select', options: emps, required: true }, { key: 'site_id', label: 'Site', type: 'select', options: sites, required: true },
          { key: 'from_date', label: 'From', type: 'date', required: true }, { key: 'to_date', label: 'To', type: 'date', hint: 'Leave blank for ongoing' },
          { key: 'shift', label: 'Shift', type: 'select', defaultValue: 'MORNING', options: ['MORNING', 'EVENING', 'NIGHT', 'GENERAL'].map((s) => ({ value: s, label: s })) },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ]} />}
      {f.tab === 'gaps' && <Gaps />}
    </>
  );
}

export function EmployeeMaster() {
  const { allowed } = useAuth();
  const toast = useToast();
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [version, setVersion] = useState(0);
  const canCreateLogin = allowed('users', 'edit');

  const createLogin = async (r: any) => {
    try {
      const res = await api<{ login: string; password: string }>(`/employees/${r.id}/login`, { body: {} });
      setCreds({ name: r.name, login: res.login, password: res.password });
      setVersion((v) => v + 1);
    } catch (e: any) {
      toast(e.message, 'err');
    }
  };

  return (
    <>
    <MasterPage endpoint="/employees" title="Employees" canEdit={allowed('employees', 'edit')} newLabel="Add employee" version={version}
      columns={[
        { key: 'name', label: 'Employee', primary: true, render: (r) => <span>{r.name} <span className="muted small">{r.code}</span></span> },
        { key: 'designation', label: 'Designation' }, { key: 'phone', label: 'Phone' },
        { key: 'current_site_name', label: 'Deployed at', render: (r) => r.current_site_name ? <span>{r.current_site_name} <span className="muted small">{r.current_shift}</span></span> : <span className="text-warn">Not deployed</span> },
        { key: 'daily_wage', label: 'Daily wage', align: 'right', hideMobile: true, render: (r) => (r.daily_wage ? money(r.daily_wage) : '—') },
        { key: 'login_name', label: 'Login', value: (r) => r.login_name ?? '', render: (r) => r.login_name
          ? <span>{r.login_name} {r.login_active === false ? <Badge tone="gray">Disabled</Badge> : r.login_pending ? <span className="muted small">· first sign-in pending</span> : null}</span>
          : canCreateLogin && r.active ? <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); createLogin(r); }}>Create login</button> : <span className="muted">—</span> },
      ]}
      fields={[
        { key: 'code', label: 'Employee code', required: true }, { key: 'name', label: 'Name', required: true },
        { key: 'designation', label: 'Designation', type: 'select', defaultValue: 'Barista', options: ['Barista', 'Senior Barista', 'Barista (Reliever)', 'Site Manager', 'Supervisor', 'Ops Head', 'Helper'].map((d) => ({ value: d, label: d })) },
        { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'joining_date', label: 'Joining date', type: 'date' },
        { key: 'daily_wage', label: 'Daily wage (₹)', type: 'number' }, { key: 'active', label: 'Active', type: 'checkbox', hint: 'Making an employee inactive also blocks their login' },
      ]} />
    <CredentialsModal creds={creds} onClose={() => setCreds(null)} />
    </>
  );
}

function Gaps() {
  const { data, loading } = useApi<any>('/deployment-gaps');
  return (
    <div className="grid grid-2">
      <Card title={`Sites without staff (${data?.unstaffed_sites.length ?? 0})`} pad={false}>
        <DataTable loading={loading} rows={data?.unstaffed_sites} search={false} empty="Every site has staff deployed" columns={[{ key: 'name', label: 'Site', primary: true }, { key: 'client_name', label: 'Customer' }]} />
      </Card>
      <Card title={`Staff not deployed (${data?.unassigned_employees.length ?? 0})`} pad={false}>
        <DataTable loading={loading} rows={data?.unassigned_employees} search={false} empty="Everyone is deployed" columns={[{ key: 'name', label: 'Employee', primary: true }, { key: 'code', label: 'Code' }, { key: 'designation', label: 'Designation' }]} />
      </Card>
    </div>
  );
}
