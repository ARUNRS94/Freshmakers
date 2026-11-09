import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { qs } from '../lib/api';
import { useApi, useQueryState } from '../lib/hooks';
import { money, moneyShort, num } from '../lib/format';
import { Card, ErrorBox, PageHeader } from '../components/ui';
import { SliceBar, defaultRange, type Slicer } from '../components/Filters';
import { DataTable, type Column } from '../components/DataTable';

const DIM_LABEL: Record<string, string> = { d: 'Date', month: 'Month', region: 'Region', client: 'Customer', site: 'Site', item: 'Item', category: 'Goods type', vendor: 'Vendor', status: 'Status', employee: 'Employee' };
const MONEY = /value|amount|billed|paid|balance|overdue|received|margin$|rate/;
const label = (k: string) => k.replace(/_/g, ' ').replace(/pct$/, '%').replace(/^./, (c) => c.toUpperCase());
const dimKey = (g: string) => (g === 'd' ? 'date' : g);

export default function Reports() {
  const [f, set] = useQueryState({ key: 'consumption', ...defaultRange(30) });
  const { data: defs } = useApi<any[]>('/reports');
  const def = defs?.find((d) => d.key === f.key);
  const groupBy = f.group_by ?? def?.dims.find((d: string) => d !== 'd' && d !== 'month') ?? 'region';
  const { data, loading, error } = useApi<any>(def ? `/reports/${f.key}${qs({ ...f, key: undefined, group_by: groupBy })}` : null);

  const dims: string[] = data?.group_by ?? [];
  const measures: string[] = data?.measures ?? [];
  const firstMoney = measures.find((m) => MONEY.test(m) && !m.endsWith('pct') && m !== 'avg_rate' && m !== 'min_rate' && m !== 'max_rate') ?? measures[0];
  const [chartMeasure] = [f.measure && measures.includes(f.measure) ? f.measure : firstMoney];

  const cols: Column[] = [
    ...dims.map((g, i) => ({ key: dimKey(g), label: DIM_LABEL[g] ?? g, primary: i === 0 })),
    ...(dims.includes('item') ? [{ key: 'uom', label: 'UOM' }] : []),
    ...measures.map((m) => ({
      key: m, label: label(m), align: 'right' as const,
      sum: !/pct|avg|min|max/.test(m),
      render: (r: any) => (r[m] === null || r[m] === undefined ? '—' : MONEY.test(m) ? money(r[m], m.includes('rate')) : /pct/.test(m) ? `${num(r[m])}%` : num(r[m])),
    })),
  ];

  const slicers: Slicer[] = ['region', 'client', 'site', 'category', 'item', 'vendor', ...(def?.dated !== false ? ['dates' as Slicer] : [])];
  const chartRows = (data?.rows ?? []).slice(0, 25).map((r: any) => ({ ...r, _label: dims.map((g) => r[dimKey(g)]).join(' · ') }));
  const isMoney = MONEY.test(chartMeasure ?? '');
  const timeSeries = dims.length === 1 && (dims[0] === 'd' || dims[0] === 'month');

  return (
    <>
      <PageHeader title="Reports" subtitle="Slice any dataset by region, company, site, item, vendor and time" />
      <Card>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">Report</span>
            <select className="input" value={f.key} onChange={(e) => set({ key: e.target.value, group_by: undefined, measure: undefined })}>
              {defs?.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </label>
          <div className="field span-2">
            <span className="field-label">Group by (pick one or more)</span>
            <div className="row gap">
              {def?.dims.map((g: string) => {
                const on = groupBy.split(',').includes(g);
                return (
                  <button key={g} type="button" className={`btn btn-sm ${on ? '' : 'btn-ghost'}`}
                    onClick={() => {
                      const cur = groupBy.split(',').filter(Boolean);
                      const next = on ? cur.filter((x) => x !== g) : [...cur, g];
                      set({ group_by: (next.length ? next : [g]).join(',') });
                    }}>{DIM_LABEL[g] ?? g}</button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>
      <SliceBar values={f} set={set} show={slicers} />
      <ErrorBox>{error}</ErrorBox>
      {chartRows.length > 1 && chartMeasure && (
        <Card title={`${label(chartMeasure)} by ${dims.map((g) => DIM_LABEL[g]).join(' · ')}${(data?.rows.length ?? 0) > 25 ? ' (top 25 rows)' : ''}`}
          actions={<select className="input" style={{ width: 'auto' }} value={chartMeasure} onChange={(e) => set({ measure: e.target.value })} aria-label="Chart measure">
            {measures.map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </select>}>
          <div className="chart-box" style={{ height: timeSeries ? 280 : Math.max(220, chartRows.length * 28) }}>
            <ResponsiveContainer>
              {timeSeries ? (
                <BarChart data={chartRows} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="_label" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => (isMoney ? moneyShort(v) : num(v))} />
                  <Tooltip formatter={(v: any) => (isMoney ? money(v) : num(v))} cursor={{ fill: 'var(--surface-2)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                  <Bar dataKey={chartMeasure} name={label(chartMeasure)} fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : (
                <BarChart data={chartRows} layout="vertical" margin={{ left: 0, right: 12 }}>
                  <CartesianGrid stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => (isMoney ? moneyShort(v) : num(v))} />
                  <YAxis type="category" dataKey="_label" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} width={140} tickFormatter={(v: string) => (v.length > 22 ? v.slice(0, 21) + '…' : v)} />
                  <Tooltip formatter={(v: any) => (isMoney ? money(v) : num(v))} cursor={{ fill: 'var(--surface-2)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                  <Bar dataKey={chartMeasure} name={label(chartMeasure)} fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      <Card pad={false} title={data?.label}>
        <DataTable loading={loading} rows={data?.rows} columns={cols} exportName={`report-${f.key}`} rowKey={(_, i) => i} pageSize={100} />
      </Card>
    </>
  );
}
