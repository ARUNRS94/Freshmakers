import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth, type Role } from '../lib/auth';
import { ROLE_LABEL } from '../lib/format';
import { useApi } from '../lib/hooks';
import { Icon, Spinner } from './ui';

interface NavItem { to: string; label: string; icon: string; roles?: Role[] }
const ALL_STAFF: Role[] = ['BARISTA', 'MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO', 'SCM', 'FINANCE'];

export const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [
    { to: '/', label: 'Dashboard', icon: 'home', roles: ALL_STAFF },
    { to: '/alerts', label: 'Alerts', icon: 'bell' },
  ] },
  { group: 'Site operations', items: [
    { to: '/consumption', label: 'Daily consumption', icon: 'cup', roles: ['BARISTA', 'MANAGER', 'SUPERVISOR', 'OPS_HEAD'] },
    { to: '/stock', label: 'Stock', icon: 'box', roles: ['BARISTA', 'MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO', 'SCM'] },
    { to: '/indents', label: 'Indents', icon: 'clipboard', roles: ['BARISTA', 'MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO', 'SCM'] },
    { to: '/planner', label: 'Tomorrow’s requirement', icon: 'target', roles: ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO', 'SCM'] },
    { to: '/local-purchases', label: 'Local purchases', icon: 'store', roles: ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'SCM', 'CBO'] },
    { to: '/stock-counts', label: 'Stock count', icon: 'list', roles: ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'SCM'] },
    { to: '/transfers', label: 'Transfers', icon: 'swap', roles: ['SUPERVISOR', 'OPS_HEAD', 'SCM'] },
  ] },
  { group: 'Supply chain', items: [
    { to: '/dispatches', label: 'Dispatches', icon: 'truck', roles: ['BARISTA', 'MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO', 'SCM'] },
    { to: '/purchase-orders', label: 'Purchase orders', icon: 'cart', roles: ['SCM', 'CBO', 'FINANCE', 'VENDOR', 'OPS_HEAD'] },
  ] },
  { group: 'Finance', items: [
    { to: '/finance/payables', label: 'Vendor payables', icon: 'rupee', roles: ['FINANCE', 'SCM', 'CBO', 'VENDOR'] },
    { to: '/finance/receivables', label: 'Client receivables', icon: 'file', roles: ['FINANCE', 'CBO', 'OPS_HEAD'] },
  ] },
  { group: 'People', items: [
    { to: '/attendance', label: 'Attendance', icon: 'calendar', roles: ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO'] },
    { to: '/employees', label: 'Staff & deployment', icon: 'users', roles: ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO'] },
  ] },
  { group: 'Insights', items: [
    { to: '/reports', label: 'Reports', icon: 'chart', roles: ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO', 'SCM', 'FINANCE'] },
  ] },
  { group: 'Setup', items: [
    { to: '/masters/clients', label: 'Clients & sites', icon: 'map', roles: ['OPS_HEAD', 'CBO', 'FINANCE', 'SCM'] },
    { to: '/masters/items', label: 'Items & rates', icon: 'tag', roles: ['SCM', 'CBO', 'FINANCE'] },
    { to: '/masters/vendors', label: 'Vendors', icon: 'bag', roles: ['SCM', 'FINANCE', 'CBO'] },
    { to: '/masters/users', label: 'Users & access', icon: 'settings', roles: [] },
  ] },
];

const BOTTOM: Record<string, string[]> = {
  BARISTA: ['/', '/consumption', '/indents', '/stock'],
  MANAGER: ['/', '/consumption', '/indents', '/attendance'],
  SUPERVISOR: ['/', '/indents', '/stock', '/attendance'],
  OPS_HEAD: ['/', '/indents', '/planner', '/reports'],
  CBO: ['/', '/indents', '/reports', '/alerts'],
  SCM: ['/', '/indents', '/dispatches', '/purchase-orders'],
  FINANCE: ['/', '/finance/payables', '/finance/receivables', '/reports'],
  VENDOR: ['/purchase-orders', '/finance/payables', '/alerts'],
  ADMIN: ['/', '/indents', '/stock', '/reports'],
};

export function Layout() {
  const { user, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const alerts = useApi<any[]>('/alerts');
  useEffect(() => setOpen(false), [loc.pathname]);
  // refresh alert count every 2 minutes
  useEffect(() => {
    const t = setInterval(alerts.reload, 120000);
    return () => clearInterval(t);
  }, [alerts.reload]);

  if (!user) return null;
  const visible = (i: NavItem) => !i.roles || can(...i.roles);
  const flat = NAV.flatMap((g) => g.items);
  const bottom = (BOTTOM[user.role] ?? []).map((p) => flat.find((i) => i.to === p)!).filter(Boolean).filter(visible);
  const alertCount = alerts.data?.filter((a) => a.severity === 'high').length ?? 0;

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          <div>
            <strong>Freshmakers</strong>
            <span>Inventory & Ops</span>
          </div>
          <button className="icon-btn only-mobile" onClick={() => setOpen(false)} aria-label="Close menu"><Icon name="x" /></button>
        </div>
        <nav>
          {NAV.map((g) => {
            const items = g.items.filter(visible);
            if (!items.length) return null;
            return (
              <div key={g.group} className="nav-group">
                <div className="nav-group-label">{g.group}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} className="nav-link">
                    <Icon name={i.icon} /> <span>{i.label}</span>
                    {i.to === '/alerts' && alertCount > 0 && <span className="pill pill-red">{alertCount}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-user">
          <div className="avatar">{user.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</div>
          <div className="grow">
            <strong>{user.name}</strong>
            <span>{ROLE_LABEL[user.role]}</span>
          </div>
          <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn only-mobile" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <div className="topbar-brand only-mobile"><img src="/favicon.svg" alt="" width={24} height={24} /> Freshmakers</div>
          <div className="grow" />
          <span className="role-chip hide-xs">{ROLE_LABEL[user.role]}</span>
          <NavLink to="/alerts" className="icon-btn bell" aria-label="Alerts">
            <Icon name="bell" />
            {alertCount > 0 && <span className="dot">{alertCount > 99 ? '99+' : alertCount}</span>}
          </NavLink>
        </header>
        <main className="content">
          <Suspense fallback={<Spinner />}><Outlet /></Suspense>
        </main>
        <nav className="bottom-nav only-mobile" aria-label="Quick navigation">
          {bottom.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'}>
              <Icon name={i.icon} size={20} />
              <span>{i.label.replace('Daily ', '').replace('Tomorrow’s requirement', 'Planner').replace('Purchase orders', 'POs').replace('Vendor ', '').replace('Client ', '')}</span>
            </NavLink>
          ))}
          <button onClick={() => setOpen(true)}><Icon name="menu" size={20} /><span>More</span></button>
        </nav>
      </div>
    </div>
  );
}
