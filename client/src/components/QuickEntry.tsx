import { useState, type KeyboardEvent } from 'react';
import { useLookups, type Lookups } from '../lib/hooks';
import { money } from '../lib/format';
import { Icon } from './ui';
import { Select } from './Form';
import { validLines, type Line } from './LineItems';

/** Enter jumps to the next quantity box, so a whole sheet can be keyed without touching the mouse */
export function focusNext(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input[data-entry]:not(:disabled)')];
  const next = inputs[inputs.indexOf(e.currentTarget) + 1];
  if (next) {
    next.focus();
    next.select();
  } else e.currentTarget.blur();
}

export function Stepper({ value, onChange, label, disabled }: { value: string; onChange: (v: string) => void; label: string; disabled?: boolean }) {
  const bump = (by: number) => {
    const next = Math.max(0, Math.round((Number(value || 0) + by) * 1000) / 1000);
    onChange(next ? String(next) : '');
  };
  return (
    <div className="stepper">
      <button type="button" tabIndex={-1} disabled={disabled || !Number(value)} aria-label={`Less ${label}`} onClick={() => bump(-1)}>−</button>
      <input data-entry type="number" inputMode="decimal" enterKeyHint="next" min="0" step="any" placeholder="0" value={value} disabled={disabled} aria-label={label}
        onChange={(e) => onChange(e.target.value)} onKeyDown={focusNext} onWheel={(e) => e.currentTarget.blur()} />
      <button type="button" tabIndex={-1} disabled={disabled} aria-label={`More ${label}`} onClick={() => bump(1)}>+</button>
    </div>
  );
}

/** Staff with one site just see its name; everyone else gets a dropdown */
export function SiteSelect({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const lk = useLookups();
  const sites = lk?.sites ?? [];
  if (sites.length === 1) return <div className="input input-static">{sites[0].name}</div>;
  return <Select value={value} disabled={disabled} aria-label="Site" onChange={(e) => onChange(e.target.value)}
    options={sites.map((s) => ({ value: s.id, label: `${s.name} (${s.client_name})` }))} />;
}

export function Seg({ value, options, onChange, label }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; label: string }) {
  return (
    <div className="seg seg-lg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="dt-search">
      <Icon name="search" size={16} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

const FILTERS = [{ value: 'ALL', label: 'All' }, { value: 'SUPPLY', label: 'Supply' }, { value: 'MRP', label: 'MRP' }, { value: 'STORE', label: 'Store' }];

interface SheetProps {
  lines: Line[];
  onChange: (l: Line[]) => void;
  withRate?: boolean;
  /** short note under an item's name */
  info?: (itemId: number) => string | undefined;
  /** suggested quantity per item; these are listed first and get a one-tap button */
  suggested?: Record<number, number>;
  /** this goods type is listed first */
  leadCategory?: string;
}

/** Every item in one list: type a quantity or tap + and it is on the order, with no adding rows */
export function ItemSheet({ lines, onChange, withRate, info, suggested = {}, leadCategory }: SheetProps) {
  const lk = useLookups();
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState('ALL');
  const lineOf = (id: number) => lines.find((l) => l.item_id === String(id));
  const picked = validLines(lines).length;

  type Item = Lookups['items'][number];
  const patch = (item: Item, change: Partial<Line>) => {
    const id = String(item.id);
    if (lineOf(item.id)) onChange(lines.map((l) => (l.item_id === id ? { ...l, ...change } : l)));
    else onChange([...lines, { item_id: id, qty: '', rate: withRate ? String(item.std_purchase_rate) : '', ...change }]);
  };

  const rank = (i: Item) => (suggested[i.id] > 0 || i.category === leadCategory ? 0 : 1);
  const items = [...(lk?.items ?? [])]
    .sort((a, b) => rank(a) - rank(b))
    .filter((i) => !term || i.name.toLowerCase().includes(term.toLowerCase()) || i.code.toLowerCase().includes(term.toLowerCase()))
    .filter((i) => filter === 'ALL' || (filter === 'PICKED' ? Number(lineOf(i.id)?.qty) > 0 : i.category === filter));

  return (
    <div className="stack" style={{ gap: '.6rem' }}>
      <div className="sheet-tools">
        <SearchBox value={term} onChange={setTerm} placeholder="Search items…" />
        <div className="chips">
          {[...FILTERS, { value: 'PICKED', label: `Added (${picked})` }].map((c) => (
            <button key={c.value} type="button" className={`chip ${filter === c.value ? 'active' : ''}`} onClick={() => setFilter(c.value)}>{c.label}</button>
          ))}
        </div>
      </div>
      <div className="sheet">
        {!items.length && <div className="empty">No items match</div>}
        {items.map((it) => {
          const line = lineOf(it.id);
          const on = Number(line?.qty) > 0;
          const suggestion = suggested[it.id];
          const below = on && it.min_order_qty > 0 && Number(line!.qty) < it.min_order_qty;
          const note = info?.(it.id);
          return (
            <div key={it.id} className={`sheet-row ${on ? 'picked' : ''}`}>
              <div className="sheet-item">
                <strong>{it.name}</strong> <span className="muted small">{it.uom}</span>
                {(note || below) && <div className="sheet-info">{note}{below && <span className="text-warn"> Below MOQ of {it.min_order_qty} {it.uom}.</span>}</div>}
              </div>
              {suggestion > 0 && !on && <button type="button" className="chip chip-add" onClick={() => patch(it, { qty: String(suggestion) })}>Add {suggestion}</button>}
              <div className="sheet-qty"><Stepper value={line?.qty ?? ''} label={`${it.name} quantity`} onChange={(qty) => patch(it, { qty })} /></div>
              {withRate && on && (
                <div className="sheet-rate">
                  <input data-entry className="input" type="number" inputMode="decimal" enterKeyHint="next" min="0" step="any" placeholder="Rate ₹" value={line!.rate ?? ''} aria-label={`${it.name} rate`}
                    onChange={(e) => patch(it, { rate: e.target.value })} onKeyDown={focusNext} onWheel={(e) => e.currentTarget.blur()} />
                  <strong>{money(Number(line!.qty) * Number(line!.rate || 0), true)}</strong>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
