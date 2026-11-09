const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export const money = (v: unknown, decimals = false) => (v === null || v === undefined || v === '' ? '—' : (decimals ? inr2 : inr).format(Number(v)));
export const qty = (v: unknown, uom?: string) => (v === null || v === undefined || v === '' ? '—' : `${numf.format(Number(v))}${uom ? ' ' + uom : ''}`);
export const num = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : numf.format(Number(v)));

/** Compact money for KPI tiles: ₹1.2 Cr, ₹4.5 L, ₹12.3 K */
export function moneyShort(v: unknown) {
  const n = Number(v ?? 0);
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`;
  return `₹${n.toFixed(0)}`;
}

export function fmtDate(v: unknown) {
  if (!v) return '—';
  const s = String(v);
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: s.length === 10 ? '2-digit' : undefined });
}
export function fmtDateTime(v: unknown) {
  if (!v) return '—';
  const d = new Date(String(v));
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDate(new Date());
export const addDays = (s: string, n: number) => {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin', BARISTA: 'Barista', MANAGER: 'Site Manager', SUPERVISOR: 'Supervisor', OPS_HEAD: 'Ops Head',
  CBO: 'CBO', SCM: 'Supply Chain', VENDOR: 'Vendor', FINANCE: 'Finance',
};

export const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'teal'> = {
  OK: 'green', LOW: 'amber', OUT: 'red',
  DRAFT: 'gray', PENDING: 'amber', APPROVED: 'blue', PARTIAL: 'teal', FULFILLED: 'green', CLOSED: 'gray', REJECTED: 'red', CANCELLED: 'gray',
  OPEN: 'amber', RECEIVED: 'green', IN_TRANSIT: 'blue', PAID: 'green',
  P: 'green', A: 'red', HD: 'amber', L: 'blue', WO: 'gray', OT: 'teal',
  SUPPLY: 'blue', MRP: 'teal', STORE: 'amber', REGULAR: 'blue', LOCAL_MARKET: 'amber',
  high: 'red', medium: 'amber', low: 'blue',
  URGENT: 'red', HIGH: 'amber', NORMAL: 'gray', LOW_PRIORITY: 'gray',
};

export const ATT_LABEL: Record<string, string> = { P: 'Present', A: 'Absent', HD: 'Half day', L: 'Leave', WO: 'Week off', OT: 'Overtime' };

export function downloadCsv(name: string, columns: { key: string; label: string }[], rows: any[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
