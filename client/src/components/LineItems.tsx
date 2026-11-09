import { useLookups } from '../lib/hooks';
import { money } from '../lib/format';
import { Icon } from './ui';

export interface Line {
  item_id: string;
  qty: string;
  rate?: string;
  remarks?: string;
  hint?: string;
}

interface Props {
  lines: Line[];
  onChange: (l: Line[]) => void;
  withRate?: boolean;
  categories?: string[];
  qtyLabel?: string;
  rateHint?: (itemId: number) => string | undefined;
}

export const emptyLine = (): Line => ({ item_id: '', qty: '', rate: '' });

export function LineItems({ lines, onChange, withRate, categories, qtyLabel = 'Qty', rateHint }: Props) {
  const lk = useLookups();
  const items = (lk?.items ?? []).filter((i) => !categories || categories.includes(i.category));
  const upd = (i: number, patch: Partial<Line>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + Number(l.qty || 0) * Number(l.rate || 0), 0);
  const used = new Set(lines.map((l) => l.item_id));

  return (
    <div className="lines">
      <div className={`line line-head ${withRate ? 'with-rate' : ''}`}>
        <span>Item</span><span>{qtyLabel}</span>{withRate && <span>Rate (₹)</span>}{withRate && <span className="ta-right">Amount</span>}<span />
      </div>
      {lines.map((l, i) => {
        const it = lk?.items.find((x) => String(x.id) === l.item_id);
        const below = it && it.min_order_qty > 0 && l.qty && Number(l.qty) < it.min_order_qty;
        return (
          <div key={i} className={`line ${withRate ? 'with-rate' : ''}`}>
            <select className="input" value={l.item_id} aria-label="Item"
              onChange={(e) => {
                const ni = lk?.items.find((x) => String(x.id) === e.target.value);
                upd(i, { item_id: e.target.value, rate: withRate && !l.rate && ni ? String(ni.std_purchase_rate) : l.rate });
              }}>
              <option value="">Select item…</option>
              {items.map((x) => (
                <option key={x.id} value={x.id} disabled={used.has(String(x.id)) && String(x.id) !== l.item_id}>{x.name} ({x.uom})</option>
              ))}
            </select>
            <div className="line-qty">
              <input className="input" type="number" inputMode="decimal" min="0" step="any" placeholder="0" value={l.qty} aria-label={qtyLabel}
                onChange={(e) => upd(i, { qty: e.target.value })} />
              {it && <span className="uom">{it.uom}</span>}
            </div>
            {withRate && (
              <input className="input" type="number" inputMode="decimal" min="0" step="any" placeholder="0.00" value={l.rate ?? ''} aria-label="Rate"
                onChange={(e) => upd(i, { rate: e.target.value })} />
            )}
            {withRate && <span className="ta-right line-amt">{money(Number(l.qty || 0) * Number(l.rate || 0), true)}</span>}
            <button type="button" className="icon-btn danger" aria-label="Remove line" onClick={() => onChange(lines.length > 1 ? lines.filter((_, k) => k !== i) : [emptyLine()])}>
              <Icon name="x" size={16} />
            </button>
            {(below || l.hint || (it && rateHint?.(it.id))) && (
              <div className="line-hint">
                {below && <span className="text-warn">Below MOQ of {it!.min_order_qty} {it!.uom}. </span>}
                {it && rateHint?.(it.id)} {l.hint}
              </div>
            )}
          </div>
        );
      })}
      <div className="lines-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...lines, emptyLine()])}><Icon name="plus" size={15} /> Add item</button>
        {withRate && <strong>Total {money(total, true)}</strong>}
      </div>
    </div>
  );
}

export const validLines = (lines: Line[]) => lines.filter((l) => l.item_id && Number(l.qty) > 0);
