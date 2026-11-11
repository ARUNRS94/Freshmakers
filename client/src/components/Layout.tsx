import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth, type Level } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { readTheme, saveTheme, type Theme } from '../lib/theme';
import { Icon, Spinner, useToast } from './ui';
import { Modal } from './Form';
import { ErrorBoundary } from './ErrorBoundary';
import { ChangePasswordForm } from '../pages/ChangePassword';

interface NavItem { to: string; label: string; icon: string; module?: string; level?: Level; any?: string[]; needsEmployee?: boolean }
const MASTER_MODULES = ['regions', 'customers', 'sites', 'warehouses', 'items', 'vendors', 'vendor_rates', 'customer_rates', 'employees'];

/** The daily data-entry tasks, linked from the top bar, the phone tabs and the dashboard */
export const QUICK: NavItem[] = [
  { to: '/consumption', label: 'Daily consumption', icon: 'cup', module: 'consumption', level: 'edit' },
  { to: '/indents/new', label: 'New indent', icon: 'clipboard', module: 'indents', level: 'edit' },
  { to: '/local-purchases/new', label: 'Local purchase', icon: 'store', module: 'local_purchases', level: 'edit' },
];

export const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [
    { to: '/', label: 'Dashboard', icon: 'home', module: 'dashboard' },
    { to: '/alerts', label: 'Alerts', icon: 'bell' },
  ] },
  { group: 'Site operations', items: [
    { to: '/consumption', label: 'Daily consumption', icon: 'cup', module: 'consumption' },
    { to: '/stock', label: 'Stock', icon: 'box', module: 'stock' },
    { to: '/indents', label: 'Indents', icon: 'clipboard', module: 'indents' },
    { to: '/planner', label: 'Tomorrow’s requirement', icon: 'target', module: 'planner' },
    { to: '/local-purchases', label: 'Local purchases', icon: 'store', module: 'local_purchases' },
    { to: '/stock-counts', label: 'Stock count', icon: 'list', module: 'stock_counts' },
    { to: '/transfers', label: 'Transfers', icon: 'swap', module: 'transfers' },
  ] },
  { group: 'Supply chain', items: [
    { to: '/dispatches', label: 'Dispatches', icon: 'truck', module: 'dispatches' },
    { to: '/purchase-orders', label: 'Purchase orders', icon: 'cart', module: 'purchase_orders' },
  ] },
  { group: 'Finance', items: [
    { to: '/finance/payables', label: 'Vendor payables', icon: 'rupee', module: 'payables' },
    { to: '/finance/receivables', label: 'Customer receivables', icon: 'file', module: 'receivables' },
  ] },
  { group: 'People', items: [
    { to: '/my-attendance', label: 'My attendance', icon: 'check', module: 'my_attendance', level: 'edit', needsEmployee: true },
    { to: '/attendance', label: 'Attendance', icon: 'calendar', module: 'attendance' },
    { to: '/employees', label: 'Staff & deployment', icon: 'users', module: 'employees' },
  ] },
  { group: 'Insights', items: [
    { to: '/reports', label: 'Reports', icon: 'chart', module: 'reports' },
  ] },
  { group: 'Setup', items: [
    { to: '/masters', label: 'All masters (import / export)', icon: 'layers', any: MASTER_MODULES },
    { to: '/masters/regions', label: 'Region master', icon: 'map', module: 'regions' },
    { to: '/masters/customers', label: 'Customer master', icon: 'building', module: 'customers' },
    { to: '/masters/sites', label: 'Site master', icon: 'store', module: 'sites' },
    { to: '/masters/warehouses', label: 'Warehouse master', icon: 'warehouse', module: 'warehouses' },
    { to: '/masters/items', label: 'Item master', icon: 'tag', module: 'items' },
    { to: '/masters/vendors', label: 'Vendor master', icon: 'bag', module: 'vendors' },
    { to: '/masters/vendor-rates', label: 'Vendor rate master', icon: 'rupee', module: 'vendor_rates' },
    { to: '/masters/customer-rates', label: 'Customer rate master', icon: 'rupee', module: 'customer_rates' },
    { to: '/masters/site-levels', label: 'Site reorder levels', icon: 'target', module: 'site_levels' },
    { to: '/masters/employees', label: 'Employee master', icon: 'users', module: 'employees' },
    { to: '/masters/users', label: 'Users, roles & access', icon: 'settings', module: 'users' },
    { to: '/audit', label: 'Audit log', icon: 'file', module: 'audit' },
  ] },
];

const BOTTOM: Record<string, string[]> = {
  BARISTA: ['/', '/consumption', '/indents/new', '/local-purchases/new'],
  MANAGER: ['/', '/consumption', '/indents/new', '/local-purchases/new'],
  SUPERVISOR: ['/', '/consumption', '/indents/new', '/local-purchases/new'],
  OPS_HEAD: ['/', '/indents', '/planner', '/reports'],
  CBO: ['/', '/indents', '/reports', '/alerts'],
  SCM: ['/', '/indents', '/dispatches', '/purchase-orders'],
  FINANCE: ['/', '/finance/payables', '/finance/receivables', '/reports'],
  VENDOR: ['/purchase-orders', '/finance/payables', '/alerts'],
  ADMIN: ['/', '/indents', '/stock', '/reports'],
};

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const next: Theme = theme === 'light' ? 'dark' : 'light';
  return (
    <button className="icon-btn" aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`} onClick={() => { saveTheme(next); setTheme(next); }}>
      <Icon name={theme === 'light' ? 'moon' : 'sun'} />
    </button>
  );
}

export function Layout() {
  const { user, logout, allowed } = useAuth();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const toast = useToast();
  const loc = useLocation();
  const alerts = useApi<any[]>('/alerts');
  useEffect(() => setOpen(false), [loc.pathname]);
  // refresh alert count every 2 minutes
  useEffect(() => {
    const t = setInterval(alerts.reload, 120000);
    return () => clearInterval(t);
  }, [alerts.reload]);

  if (!user) return null;
  const visible = (i: NavItem) => (i.any ? i.any.some((m) => allowed(m)) : !i.module || allowed(i.module, i.level)) && (!i.needsEmployee || !!user.employee_id);
  const flat = [...QUICK, ...NAV.flatMap((g) => g.items)];
  const bottom = (BOTTOM[user.role] ?? ['/', ...QUICK.map((q) => q.to)]).map((p) => flat.find((i) => i.to === p)!).filter(Boolean).filter(visible);
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
                  <NavLink key={i.to} to={i.to} end={i.to === '/' || i.to === '/masters'} className="nav-link">
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
            <span>{user.role_name}</span>
          </div>
          <button className="icon-btn" onClick={() => setPwOpen(true)} aria-label="Change password" title="Change password"><Icon name="key" /></button>
          <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
        </div>
      </aside>
      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title="Change password">
        <ChangePasswordForm onDone={() => { setPwOpen(false); toast('Password changed. You are signed out on other devices.'); }} />
      </Modal>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn only-mobile" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <div className="topbar-brand only-mobile"><img src="/favicon.svg" alt="" width={24} height={24} /> Freshmakers</div>
          <div className="grow" />
          <div className="quick-actions">
            {QUICK.filter(visible).map((i) => <Link key={i.to} to={i.to} className="btn btn-sm"><Icon name={i.icon} size={15} /> {i.label}</Link>)}
          </div>
          <span className="role-chip hide-xs">{user.role_name}</span>
          <ThemeToggle />
          <NavLink to="/alerts" className="icon-btn bell" aria-label="Alerts">
            <Icon name="bell" />
            {alertCount > 0 && <span className="dot">{alertCount > 99 ? '99+' : alertCount}</span>}
          </NavLink>
        </header>
        <main className="content">
          <ErrorBoundary key={loc.pathname}><Suspense fallback={<Spinner />}><Outlet /></Suspense></ErrorBoundary>
        </main>
        <nav className="bottom-nav only-mobile" aria-label="Quick navigation">
          {bottom.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'}>
              <Icon name={i.icon} size={20} />
              <span>{i.label.replace('Daily consumption', 'Consumption').replace('Local purchase', 'Purchase').replace('Tomorrow’s requirement', 'Planner').replace('Purchase orders', 'POs').replace('Vendor ', '').replace('Customer ', '')}</span>
            </NavLink>
          ))}
          <button onClick={() => setOpen(true)}><Icon name="menu" size={20} /><span>More</span></button>
        </nav>
      </div>
    </div>
  );
}
