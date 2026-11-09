/** Every area a role can be granted, with the access the built-in roles start with. */
export type Level = 'view' | 'edit';

export interface ModuleDef {
  key: string;
  label: string;
  group: string;
  /** roles that start with view access; omit when the module has no view level */
  view?: string[];
  /** roles that start with edit access; omit when the module is read-only */
  edit?: string[];
}

const STAFF = ['BARISTA', 'MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO', 'SCM', 'FINANCE'];
const CUSTOMER_SIDE = ['OPS_HEAD', 'CBO', 'FINANCE', 'SCM'];
const GOODS_SIDE = ['SCM', 'CBO', 'FINANCE'];
const SITE_ENTRY = ['BARISTA', 'MANAGER', 'SUPERVISOR', 'OPS_HEAD'];
const RAISERS = [...SITE_ENTRY, 'SCM'];

export const MODULES = [
  { key: 'dashboard', label: 'Dashboard', group: 'Overview', view: STAFF },
  { key: 'consumption', label: 'Daily consumption', group: 'Site operations', view: SITE_ENTRY, edit: SITE_ENTRY },
  { key: 'stock', label: 'Stock', group: 'Site operations', view: [...SITE_ENTRY, 'CBO', 'SCM'] },
  { key: 'indents', label: 'Indents (view and raise)', group: 'Site operations', view: [...SITE_ENTRY, 'CBO', 'SCM'], edit: RAISERS },
  { key: 'planner', label: 'Tomorrow’s requirement', group: 'Site operations', view: ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO', 'SCM'] },
  { key: 'local_purchases', label: 'Local purchases', group: 'Site operations', view: [...RAISERS, 'CBO'], edit: RAISERS },
  { key: 'stock_counts', label: 'Stock count', group: 'Site operations', view: ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'SCM'], edit: ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'SCM'] },
  { key: 'transfers', label: 'Transfers', group: 'Site operations', view: ['SUPERVISOR', 'OPS_HEAD', 'SCM'], edit: ['SUPERVISOR', 'OPS_HEAD', 'SCM'] },
  { key: 'dispatches', label: 'Dispatches', group: 'Supply chain', view: [...SITE_ENTRY, 'CBO', 'SCM'], edit: ['SCM'] },
  { key: 'dispatch_receive', label: 'Confirm dispatch received', group: 'Supply chain', edit: ['BARISTA', 'MANAGER', 'SUPERVISOR', 'SCM'] },
  { key: 'purchase_orders', label: 'Purchase orders', group: 'Supply chain', view: ['SCM', 'CBO', 'FINANCE', 'VENDOR', 'OPS_HEAD'], edit: ['SCM'] },
  { key: 'po_ack', label: 'Acknowledge purchase orders', group: 'Supply chain', edit: ['VENDOR', 'SCM'] },
  { key: 'grn', label: 'Receive goods (GRN)', group: 'Supply chain', edit: ['SCM', 'MANAGER', 'SUPERVISOR'] },
  { key: 'payables', label: 'Vendor payables', group: 'Finance', view: ['FINANCE', 'SCM', 'CBO', 'VENDOR'], edit: ['FINANCE'] },
  { key: 'receivables', label: 'Customer receivables', group: 'Finance', view: ['FINANCE', 'CBO', 'OPS_HEAD'], edit: ['FINANCE'] },
  { key: 'receipts', label: 'Receipts and ageing', group: 'Finance', view: ['FINANCE', 'CBO'] },
  { key: 'attendance', label: 'Attendance (site sheets)', group: 'People', view: ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO'], edit: ['MANAGER', 'SUPERVISOR', 'OPS_HEAD'] },
  { key: 'my_attendance', label: 'My attendance (check in / out)', group: 'People', edit: SITE_ENTRY },
  { key: 'employees', label: 'Employees', group: 'People', view: ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO'], edit: ['OPS_HEAD', 'SUPERVISOR'] },
  { key: 'deployments', label: 'Deployments', group: 'People', view: ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO'], edit: ['OPS_HEAD', 'SUPERVISOR', 'MANAGER'] },
  { key: 'reports', label: 'Reports', group: 'Insights', view: ['MANAGER', 'SUPERVISOR', 'OPS_HEAD', 'CBO', 'SCM', 'FINANCE'] },
  { key: 'regions', label: 'Region master', group: 'Masters', view: CUSTOMER_SIDE, edit: [] },
  { key: 'customers', label: 'Customer master', group: 'Masters', view: CUSTOMER_SIDE, edit: ['FINANCE'] },
  { key: 'sites', label: 'Site master', group: 'Masters', view: CUSTOMER_SIDE, edit: ['OPS_HEAD'] },
  { key: 'warehouses', label: 'Warehouse master', group: 'Masters', view: CUSTOMER_SIDE, edit: ['SCM'] },
  { key: 'items', label: 'Item master', group: 'Masters', view: GOODS_SIDE, edit: ['SCM'] },
  { key: 'vendors', label: 'Vendor master', group: 'Masters', view: GOODS_SIDE, edit: ['SCM', 'FINANCE'] },
  { key: 'vendor_rates', label: 'Vendor rates', group: 'Masters', view: GOODS_SIDE, edit: ['SCM'] },
  { key: 'customer_rates', label: 'Customer rates', group: 'Masters', view: GOODS_SIDE, edit: ['FINANCE', 'CBO'] },
  { key: 'site_levels', label: 'Site reorder levels', group: 'Masters', view: [...GOODS_SIDE, 'OPS_HEAD', 'SUPERVISOR'], edit: ['OPS_HEAD', 'SUPERVISOR', 'SCM'] },
  { key: 'users', label: 'Users', group: 'Administration', view: [], edit: [] },
  { key: 'settings', label: 'Indent approval chain', group: 'Administration', edit: [] },
  { key: 'audit', label: 'Audit log', group: 'Administration', view: [] },
] as const satisfies readonly ModuleDef[];

export type ModuleKey = (typeof MODULES)[number]['key'];

interface Gate {
  path: string;
  module: ModuleKey;
  level?: Level;
  /** edit access to this module also opens the path */
  orEdit?: ModuleKey;
}

/** What each GET path needs; checked in order, so more specific paths come first. */
export const VIEW_GATES: Gate[] = [
  { path: '/dashboard', module: 'dashboard' },
  { path: '/consumption', module: 'consumption' },
  { path: '/stock', module: 'stock' },
  { path: '/indents', module: 'indents' },
  // the indent form shows stock and suggested quantities from the planner
  { path: '/planner', module: 'planner', orEdit: 'indents' },
  { path: '/local-purchases', module: 'local_purchases' },
  { path: '/stock-counts', module: 'stock_counts' },
  { path: '/transfers', module: 'transfers' },
  { path: '/dispatches', module: 'dispatches' },
  { path: '/purchase-orders', module: 'purchase_orders' },
  { path: '/purchase-orders-helper', module: 'purchase_orders', level: 'edit' },
  { path: '/finance/vendor-bills', module: 'payables' },
  { path: '/finance/vendor-payments', module: 'payables' },
  { path: '/finance/client-invoices', module: 'receivables' },
  { path: '/finance/client-receipts', module: 'receipts' },
  { path: '/finance/ageing', module: 'receipts' },
  { path: '/attendance/me', module: 'my_attendance', level: 'edit' },
  { path: '/attendance', module: 'attendance' },
  { path: '/employees', module: 'employees' },
  { path: '/deployment-gaps', module: 'employees' },
  { path: '/deployments', module: 'deployments' },
  { path: '/reports', module: 'reports' },
  { path: '/regions', module: 'regions' },
  { path: '/clients', module: 'customers' },
  { path: '/sites', module: 'sites' },
  { path: '/warehouses', module: 'warehouses' },
  { path: '/items', module: 'items' },
  { path: '/vendors', module: 'vendors' },
  { path: '/vendor-rates', module: 'vendor_rates' },
  { path: '/client-rates', module: 'customer_rates' },
  { path: '/site-item-settings', module: 'site_levels' },
  { path: '/users', module: 'users' },
  { path: '/roles', module: 'users' },
  { path: '/audit', module: 'audit' },
];
