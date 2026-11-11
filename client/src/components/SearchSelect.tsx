import { useId, useState, type KeyboardEvent } from 'react';

export interface Option {
  value: string | number;
  label: string;
}

const SHOWN = 100;

/**
 * A dropdown you can type into. Every typed word must appear in the option, in any order,
 * so "jaipur apex" finds "Apex – Jaipur Tech Park".
 */
export function SearchSelect({ value, options, onChange, required, label }: {
  value: string | number | null | undefined;
  options: Option[];
  onChange: (value: string) => void;
  required?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const id = useId();

  const selected = options.find((o) => String(o.value) === String(value ?? ''));
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  const all = words.length ? options.filter((o) => words.every((w) => o.label.toLowerCase().includes(w))) : options;
  const shown = all.slice(0, SHOWN);
  // "None" sits first when the field may be left empty and nothing has been typed
  const items: (Option | null)[] = !required && !words.length ? [null, ...shown] : shown;

  const close = () => {
    setOpen(false);
    setTerm('');
  };
  const pick = (o: Option | null) => {
    onChange(o ? String(o.value) : '');
    close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (items[active] !== undefined) pick(items[active]);
    } else if (e.key === 'Escape' && open) {
      // close the list, not the dialog around it
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className="combo">
      <input className="input" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-label={label}
        aria-activedescendant={open && items[active] !== undefined ? `${id}-${active}` : undefined}
        autoComplete="off" spellCheck={false}
        value={open ? term : selected?.label ?? ''}
        placeholder={open ? selected?.label ?? 'Type to search…' : 'Type to search…'}
        onFocus={() => { setOpen(true); setTerm(''); setActive(0); }}
        // after a pick the box keeps focus, so a second click must reopen the list itself
        onClick={() => { if (!open) { setOpen(true); setTerm(''); setActive(0); } }}
        onBlur={close}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={onKeyDown} />
      {open && (
        <ul className="combo-list" role="listbox" id={`${id}-list`}>
          {items.map((o, i) => (
            <li key={o ? o.value : '__none'} id={`${id}-${i}`} role="option" aria-selected={o ? String(o.value) === String(value ?? '') : !selected}
              className={`${i === active ? 'active' : ''} ${o ? '' : 'muted'}`}
              // mousedown, not click, so the input keeps focus and does not close the list first
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}>
              {o ? o.label : '— None'}
            </li>
          ))}
          {!items.length && <li className="muted" aria-disabled="true">No matches</li>}
          {all.length > SHOWN && <li className="muted small" aria-disabled="true">{all.length - SHOWN} more. Keep typing to narrow down.</li>}
        </ul>
      )}
    </div>
  );
}
