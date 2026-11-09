import type { ModuleKey } from './access.js';

export interface Ref {
  table: string;
  /** columns a cell may match, in priority order */
  match: string[];
  /** column written on export */
  show: string;
  noun: string;
}

export interface MasterField {
  column: string;
  label: string;
  type?: 'text' | 'int' | 'number' | 'date' | 'bool' | 'enum' | 'email';
  /** needed when creating a record */
  required?: boolean;
  /** part of the natural key used to find an existing record */
  key?: boolean;
  options?: string[];
  ref?: Ref;
  max?: number;
  todayIfBlank?: boolean;
  example: string;
}

export interface MasterDef {
  key: string;
  label: string;
  table: string;
  /** app route where single records are edited */
  manage: string;
  /** access module that controls viewing and importing */
  module: ModuleKey;
  /** masters that must already hold the records this one refers to */
  needs: string[];
  fields: MasterField[];
}

const REGION: Ref = { table: 'regions', match: ['name', 'code'], show: 'name', noun: 'region' };
const CLIENT: Ref = { table: 'clients', match: ['code'], show: 'code', noun: 'customer' };
const ITEM: Ref = { table: 'items', match: ['code'], show: 'code', noun: 'item' };
const VENDOR: Ref = { table: 'vendors', match: ['code'], show: 'code', noun: 'vendor' };

const ACTIVE: MasterField = { column: 'active', label: 'Active', type: 'bool', example: 'Yes' };

export const MASTERS: MasterDef[] = [
  {
    key: 'regions', label: 'Regions', table: 'regions', manage: '/masters/regions',
    module: 'regions', needs: [],
    fields: [
      { column: 'name', label: 'Name', key: true, required: true, example: 'North' },
      { column: 'code', label: 'Code', example: 'N' },
      ACTIVE,
    ],
  },
  {
    key: 'customers', label: 'Customers', table: 'clients', manage: '/masters/customers',
    module: 'customers', needs: ['Regions'],
    fields: [
      { column: 'code', label: 'Code', key: true, required: true, example: 'CL100' },
      { column: 'name', label: 'Customer Name', required: true, example: 'Acme Foods Pvt Ltd' },
      { column: 'region_id', label: 'Region', ref: REGION, example: 'North' },
      { column: 'gstin', label: 'GSTIN', example: '07AAACA1234A1Z5' },
      { column: 'contact_person', label: 'Contact Person', example: 'Priya Sharma' },
      { column: 'phone', label: 'Phone', example: '9810012345' },
      { column: 'email', label: 'Email', type: 'email', example: 'accounts@acme.example' },
      { column: 'billing_address', label: 'Billing Address', example: '12 Ring Road, New Delhi' },
      { column: 'payment_terms_days', label: 'Payment Terms Days', type: 'int', example: '30' },
      { column: 'credit_limit', label: 'Credit Limit', type: 'number', example: '500000' },
      ACTIVE,
    ],
  },
  {
    key: 'sites', label: 'Sites', table: 'sites', manage: '/masters/sites',
    module: 'sites', needs: ['Customers', 'Regions'],
    fields: [
      { column: 'code', label: 'Code', key: true, required: true, example: 'ST900' },
      { column: 'name', label: 'Site Name', required: true, example: 'Acme HQ Cafeteria' },
      { column: 'client_id', label: 'Customer Code', required: true, ref: CLIENT, example: 'CL100' },
      { column: 'region_id', label: 'Region', required: true, ref: REGION, example: 'North' },
      { column: 'city', label: 'City', example: 'New Delhi' },
      { column: 'address', label: 'Address', example: '12 Ring Road' },
      { column: 'contact_phone', label: 'Contact Phone', example: '9810012345' },
      { column: 'opening_time', label: 'Opening Time', example: '08:00' },
      ACTIVE,
    ],
  },
  {
    key: 'warehouses', label: 'Warehouses', table: 'warehouses', manage: '/masters/warehouses',
    module: 'warehouses', needs: ['Regions'],
    fields: [
      { column: 'code', label: 'Code', key: true, required: true, example: 'WH9' },
      { column: 'name', label: 'Name', required: true, example: 'Delhi Central Warehouse' },
      { column: 'region_id', label: 'Region', ref: REGION, example: 'North' },
      { column: 'address', label: 'Address', example: 'Okhla Phase 2, New Delhi' },
      ACTIVE,
    ],
  },
  {
    key: 'items', label: 'Items', table: 'items', manage: '/masters/items',
    module: 'items', needs: [],
    fields: [
      { column: 'code', label: 'Code', key: true, required: true, example: 'COCOA' },
      { column: 'name', label: 'Name', required: true, example: 'Cocoa Powder' },
      { column: 'category', label: 'Goods Type', type: 'enum', required: true, options: ['SUPPLY', 'MRP', 'STORE'], example: 'SUPPLY' },
      { column: 'uom', label: 'Unit', type: 'enum', required: true, options: ['KG', 'LTR', 'PCS', 'BOX', 'PACK', 'BUNCH', 'GM', 'ML'], example: 'KG' },
      { column: 'hsn_code', label: 'HSN Code', example: '1805' },
      { column: 'gst_rate', label: 'GST Percent', type: 'number', max: 100, example: '18' },
      { column: 'mrp', label: 'MRP', type: 'number', example: '' },
      { column: 'min_order_qty', label: 'Min Order Qty', type: 'number', example: '5' },
      { column: 'reorder_level', label: 'Site Reorder Level', type: 'number', example: '2' },
      { column: 'wh_reorder_level', label: 'Warehouse Reorder Level', type: 'number', example: '20' },
      { column: 'std_purchase_rate', label: 'Standard Buy Rate', type: 'number', example: '420' },
      { column: 'std_sale_rate', label: 'Standard Sell Rate', type: 'number', example: '510' },
      { column: 'shelf_life_days', label: 'Shelf Life Days', type: 'int', example: '180' },
      ACTIVE,
    ],
  },
  {
    key: 'vendors', label: 'Vendors', table: 'vendors', manage: '/masters/vendors',
    module: 'vendors', needs: [],
    fields: [
      { column: 'code', label: 'Code', key: true, required: true, example: 'V900' },
      { column: 'name', label: 'Name', required: true, example: 'Sharma Traders' },
      { column: 'vendor_type', label: 'Vendor Type', type: 'enum', options: ['REGULAR', 'LOCAL_MARKET'], example: 'REGULAR' },
      { column: 'gstin', label: 'GSTIN', example: '07AAACS1234A1Z5' },
      { column: 'contact_person', label: 'Contact Person', example: 'Ravi Sharma' },
      { column: 'phone', label: 'Phone', example: '9810054321' },
      { column: 'email', label: 'Email', type: 'email', example: 'sales@sharma.example' },
      { column: 'address', label: 'Address', example: 'Azadpur Mandi, Delhi' },
      { column: 'payment_terms_days', label: 'Payment Terms Days', type: 'int', example: '30' },
      { column: 'payment_terms_text', label: 'Payment Terms Text', example: '50% advance, balance in 30 days' },
      { column: 'lead_time_days', label: 'Lead Time Days', type: 'int', example: '2' },
      { column: 'bank_details', label: 'Bank Details', example: 'HDFC 00112233 IFSC HDFC0000123' },
      ACTIVE,
    ],
  },
  {
    key: 'vendor-rates', label: 'Vendor rates (buy)', table: 'vendor_item_rates', manage: '/masters/vendor-rates',
    module: 'vendor_rates', needs: ['Vendors', 'Items'],
    fields: [
      { column: 'vendor_id', label: 'Vendor Code', key: true, required: true, ref: VENDOR, example: 'V900' },
      { column: 'item_id', label: 'Item Code', key: true, required: true, ref: ITEM, example: 'COCOA' },
      { column: 'effective_from', label: 'Effective From', key: true, type: 'date', todayIfBlank: true, example: '01-04-2026' },
      { column: 'rate', label: 'Rate', type: 'number', required: true, example: '415.50' },
      { column: 'min_order_qty', label: 'Vendor MOQ', type: 'number', example: '10' },
    ],
  },
  {
    key: 'customer-rates', label: 'Customer rates (sell)', table: 'client_item_rates', manage: '/masters/customer-rates',
    module: 'customer_rates', needs: ['Customers', 'Items'],
    fields: [
      { column: 'client_id', label: 'Customer Code', key: true, required: true, ref: CLIENT, example: 'CL100' },
      { column: 'item_id', label: 'Item Code', key: true, required: true, ref: ITEM, example: 'COCOA' },
      { column: 'effective_from', label: 'Effective From', key: true, type: 'date', todayIfBlank: true, example: '01-04-2026' },
      { column: 'rate', label: 'Sell Rate', type: 'number', required: true, example: '505' },
    ],
  },
  {
    key: 'employees', label: 'Employees', table: 'employees', manage: '/masters/employees',
    module: 'employees', needs: [],
    fields: [
      { column: 'code', label: 'Employee Code', key: true, required: true, example: 'EMP9001' },
      { column: 'name', label: 'Name', required: true, example: 'Anil Kumar' },
      { column: 'designation', label: 'Designation', example: 'Barista' },
      { column: 'phone', label: 'Phone', example: '9810067890' },
      { column: 'email', label: 'Email', type: 'email', example: 'anil@freshmakers.example' },
      { column: 'joining_date', label: 'Joining Date', type: 'date', example: '15-06-2026' },
      { column: 'daily_wage', label: 'Daily Wage', type: 'number', example: '750' },
      ACTIVE,
    ],
  },
];

/** The format note shown under each column heading in a template */
export function describeField(f: MasterField) {
  const need = f.key && !f.todayIfBlank ? 'Required, identifies the record' : f.required ? 'Required for new records' : f.todayIfBlank ? 'Blank = today' : 'Optional';
  const format =
    f.ref ? `existing ${f.ref.noun} ${f.ref.match.join(' or ')}`
    : f.type === 'enum' ? f.options!.join(' / ')
    : f.type === 'bool' ? 'Yes / No'
    : f.type === 'date' ? 'DD-MM-YYYY'
    : f.type === 'int' ? 'whole number'
    : f.type === 'number' ? 'number'
    : '';
  return format ? `${need}: ${format}` : need;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseDate(s: string): string | undefined {
  let y: number, m: number, d: number;
  let p: RegExpMatchArray | null;
  if ((p = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, d] = [+p[1], +p[2], +p[3]];
  else if ((p = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/))) [d, m, y] = [+p[1], +p[2], +p[3]];
  else if ((p = s.match(/^(\d{1,2})[-/ ]([a-z]{3,9})[-/ ](\d{4}|\d{2})$/i))) [d, m, y] = [+p[1], MONTHS.indexOf(p[2].slice(0, 3).toLowerCase()) + 1, +p[3]];
  else return undefined;
  if (y < 100) y += 2000;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return undefined;
  return t.toISOString().slice(0, 10);
}

type Parsed = { value: unknown } | { error: string };

/** Converts a non-blank cell for every field type except references */
export function parseCell(f: MasterField, raw: string): Parsed {
  switch (f.type) {
    case 'int':
    case 'number': {
      const n = Number(raw.replace(/[₹,\s]/g, ''));
      if (!Number.isFinite(n)) return { error: `"${raw}" is not a number` };
      if (f.type === 'int' && !Number.isInteger(n)) return { error: `"${raw}" must be a whole number` };
      if (n < 0) return { error: 'cannot be negative' };
      if (f.max !== undefined && n > f.max) return { error: `cannot be more than ${f.max}` };
      return { value: n };
    }
    case 'date': {
      const value = parseDate(raw);
      return value ? { value } : { error: `"${raw}" is not a valid date (use DD-MM-YYYY)` };
    }
    case 'bool': {
      const v = raw.toLowerCase();
      if (['yes', 'y', 'true', '1', 'active'].includes(v)) return { value: true };
      if (['no', 'n', 'false', '0', 'inactive'].includes(v)) return { value: false };
      return { error: `"${raw}" must be Yes or No` };
    }
    case 'enum': {
      const v = raw.toUpperCase().replace(/\s+/g, '_');
      return f.options!.includes(v) ? { value: v } : { error: `"${raw}" must be one of ${f.options!.join(', ')}` };
    }
    case 'email':
      return /^[^@\s]+@[^@\s]+$/.test(raw) ? { value: raw } : { error: `"${raw}" is not a valid email` };
    default: {
      if (/^\d(\.\d+)?E\+\d+$/i.test(raw)) return { error: `"${raw}" was changed to scientific notation by Excel. Format the column as Text and re-enter it` };
      return { value: raw.replace(/^'(?=[=@+\-])/, '') };
    }
  }
}

/** Stops spreadsheet apps running exported text as a formula; parseCell removes the guard on re-import */
export const guardFormula = (s: string) => (/^[=@]|^[+-](?![\d\s-]*$)/.test(s) ? `'${s}` : s);
