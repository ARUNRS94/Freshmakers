import { useMemo, useState, type ReactNode } from 'react';
import { downloadCsv } from '../lib/format';
import { Empty, Icon, Spinner } from './ui';

export interface Column<T = any> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  /** value used for sorting / CSV when render is custom */
  value?: (row: T) => unknown;
  align?: 'right' | 'center';
  /** show a column total in the footer */
  sum?: boolean | ((rows: T[]) => ReactNode);
  /** primary columns are emphasised in the mobile card view */
  primary?: boolean;
  hideMobile?: boolean;
  width?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  rowKey?: (row: T, i: number) => string | number;
  search?: boolean;
  exportName?: string;
  empty?: ReactNode;
  pageSize?: number;
  toolbar?: ReactNode;
  rowClass?: (row: T) => string;
}

export function DataTable<T extends Record<string, any>>({
  columns, rows, loading, onRowClick, rowKey, search = true, exportName, empty, pageSize = 50, toolbar, rowClass,
}: Props<T>) {
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const val = (c: Column<T>, r: T) => (c.value ? c.value(r) : r[c.key]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (term) {
      const t = term.toLowerCase();
      list = list.filter((r) => columns.some((c) => String(val(c, r) ?? '').toLowerCase().includes(t)));
    }
    if (sort) {
      const c = columns.find((x) => x.key === sort.key)!;
      list = [...list].sort((a, b) => {
        const va = val(c, a), vb = val(c, b);
        if (va === vb) return 0;
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })) * sort.dir;
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, term, sort, columns]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const shown = filtered.slice(cur * pageSize, (cur + 1) * pageSize);
  const hasSum = columns.some((c) => c.sum);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

  return (
    <div className="dt">
      {(search || exportName || toolbar) && (
        <div className="dt-toolbar">
          {search && (
            <label className="dt-search">
              <Icon name="search" size={16} />
              <input value={term} onChange={(e) => { setTerm(e.target.value); setPage(0); }} placeholder="Search…" aria-label="Search table" />
            </label>
          )}
          {toolbar}
          <span className="dt-count muted">{filtered.length} rows</span>
          {exportName && (
            <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv(exportName, columns.map((c) => ({ key: c.key, label: c.label })),
              filtered.map((r) => Object.fromEntries(columns.map((c) => [c.key, val(c, r)]))))}>
              <Icon name="download" size={15} /> <span className="hide-xs">CSV</span>
            </button>
          )}
        </div>
      )}
      {loading && !rows ? (
        <Spinner />
      ) : !filtered.length ? (
        <Empty>{empty ?? 'No records found'}</Empty>
      ) : (
        <div className="dt-scroll">
          <table className="table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.align ? `ta-${c.align}` : ''} style={c.width ? { width: c.width } : undefined}
                    onClick={() => toggleSort(c.key)} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                    {c.label}
                    {sort?.key === c.key && <span className="sort">{sort.dir === 1 ? '▲' : '▼'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={rowKey ? rowKey(r, i) : (r.id ?? i)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={`${onRowClick ? 'clickable' : ''} ${rowClass ? rowClass(r) : ''}`}>
                  {columns.map((c) => (
                    <td key={c.key} data-label={c.label} className={`${c.align ? `ta-${c.align}` : ''} ${c.primary ? 'td-primary' : ''} ${c.hideMobile ? 'hide-mobile' : ''}`}>
                      {c.render ? c.render(r) : String(val(c, r) ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {hasSum && (
              <tfoot>
                <tr>
                  {columns.map((c, i) => (
                    <td key={c.key} data-label={c.label} className={`${c.align ? `ta-${c.align}` : ''} ${!c.sum && i > 0 ? 'hide-mobile' : ''}`}>
                      {i === 0 && !c.sum ? 'Total' : typeof c.sum === 'function' ? c.sum(filtered) : c.sum
                        ? (c.render ? c.render({ [c.key]: filtered.reduce((a, r) => a + Number(val(c, r) || 0), 0) } as T)
                          : filtered.reduce((a, r) => a + Number(val(c, r) || 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }))
                        : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="dt-pager">
          <button className="btn btn-ghost btn-sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Prev</button>
          <span className="muted">Page {cur + 1} of {pages}</span>
          <button className="btn btn-ghost btn-sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
