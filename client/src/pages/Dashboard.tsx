import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useApi, useQueryState } from '../lib/hooks';
import { qs } from '../lib/api';
import { money, moneyShort, num, fmtDate } from '../lib/format';
import { Badge, Card, ErrorBox, Kpi, PageHeader, Spinner, Tabs } from '../components/ui';
import { SliceBar, defaultRange } from '../components/Filters';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../lib/auth';

const C1 = 'var(--chart-1)', C2 = 'var(--chart-2)';
const axis = { stroke: 'var(--muted)', fontSize: 11, tickLine: false, axisLine: false } as const;

function Legend({ items }: { items: [string, string][] }) {
  return <div className="legend">{items.map(([c, l]) => <span key={l}><i style={{ background: c }} />{l}</span>)}</div>;
}

function ChartTip({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card" style={{ padding: '.5rem .7rem', fontSize: '.8rem' }}>
      <strong>{String(label).length === 10 ? fmtDate(label) : label}</strong>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="row gap"><i style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: 'inline-block' }} />{p.name}: {fmt(p.value)}</div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const nav = useNavigate();
  const [f, set] = useQueryState({ ...defaultRange(30), group: 'region' });
  const { data: d, error, loading } = useApi<any>(`/dashboard${qs({ ...f })}`);
  const byItem = !!f.item_id;
  const showFinance = can('FINANCE', 'CBO', 'SCM');

  const kp = d?.kpis;
  return (
    <>
      <PageHeader title={`Hello, ${user?.name.split(' ')[0]}`} subtitle={d ? `${fmtDate(d.from)} – ${fmtDate(d.to)} · ${user?.siteIds ? `${user.siteIds.length} assigned site(s)` : 'All sites'}` : 'Operations overview'} />
      <SliceBar values={f} set={set} show={['region', 'client', 'site', 'category', 'item', 'dates']} />
      <ErrorBox>{error}</ErrorBox>
      {loading && !d ? <Spinner /> : d && (
        <>
          <div className="kpis">
            <Kpi label="Supplied to sites" value={moneyShort(kp.supply_value)} sub={`incl. ${moneyShort(kp.local_value)} local purchase`} icon="truck" tone="blue" to="/reports?key=supply" />
            <Kpi label="Consumed" value={moneyShort(kp.consumption_value)} sub={`Wastage ${moneyShort(kp.wastage_value)}`} icon="cup" tone="teal" to="/reports?key=consumption" />
            <Kpi label="Site stock value" value={moneyShort(kp.site_stock_value)} sub={kp.wh_stock_value !== null ? `Warehouse ${moneyShort(kp.wh_stock_value)}` : undefined} icon="box" tone="green" to="/stock" />
            <Kpi label="Reorder alerts" value={num(kp.low_stock)} sub="items at / below reorder level" icon="alert" tone={kp.low_stock ? 'amber' : 'green'} to="/stock?stock_status=ALERT" />
            <Kpi label="Open indents" value={num(kp.indents_open)} sub={<>{kp.indents_overdue > 0 && <span className="text-red">{kp.indents_overdue} overdue · </span>}{kp.indents_closed} closed</>} icon="clipboard" tone="amber" to="/indents?status=OPEN" />
            {showFinance && <Kpi label="Vendor payables" value={moneyShort(kp.payables_open)} sub={<span className={kp.payables_overdue > 0 ? 'text-red' : ''}>{moneyShort(kp.payables_overdue)} overdue</span>} icon="rupee" tone="red" to="/finance/payables" />}
            {can('FINANCE', 'CBO', 'OPS_HEAD') && <Kpi label="Client receivables" value={moneyShort(kp.receivables_open)} sub={`${moneyShort(kp.receivables_overdue)} overdue`} icon="file" tone="blue" to="/finance/receivables" />}
            <Kpi label="Staff present today" value={`${kp.staff_present}/${kp.staff_deployed}`} sub={`${kp.staff_deployed - kp.staff_marked} not marked yet`} icon="users" tone="teal" to="/attendance" />
          </div>

          <Card title={`RM supply vs consumption ${byItem ? '(quantity)' : '(₹ value)'}`} actions={<Legend items={[[C1, 'Supplied'], [C2, 'Consumed']]} />}>
            <div className="chart-box">
              <ResponsiveContainer>
                <AreaChart data={d.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="d" {...axis} tickFormatter={(v) => fmtDate(v).slice(0, 6)} minTickGap={24} />
                  <YAxis {...axis} width={56} tickFormatter={(v) => (byItem ? num(v) : moneyShort(v))} />
                  <Tooltip content={<ChartTip fmt={(v: number) => (byItem ? num(v) : money(v))} />} cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }} />
                  <Area type="monotone" name="Supplied" dataKey={byItem ? 'supply_qty' : 'supply_value'} stroke={C1} fill={C1} fillOpacity={0.12} strokeWidth={2} />
                  <Area type="monotone" name="Consumed" dataKey={byItem ? 'consumption_qty' : 'consumption_value'} stroke={C2} fill={C2} fillOpacity={0.1} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-2">
            <Card title="Indents" actions={<button className="btn btn-ghost btn-sm" onClick={() => nav('/indents?status=OPEN')}>View open</button>}>
              <div className="stats" style={{ marginBottom: '1rem' }}>
                <div className="stat"><span className="muted">Open</span><strong style={{ fontSize: '1.4rem' }}>{d.indents.open}</strong></div>
                <div className="stat"><span className="muted">Closed (period)</span><strong style={{ fontSize: '1.4rem' }}>{d.indents.closed}</strong></div>
                <div className="stat"><span className="muted">Overdue</span><strong style={{ fontSize: '1.4rem' }} className={kp.indents_overdue ? 'text-red' : ''}>{kp.indents_overdue}</strong></div>
              </div>
              <div className="stack" style={{ gap: '.5rem' }}>
                {[...d.indents.by_status].sort((a: any, b: any) => b.n - a.n).map((s: any) => {
                  const max = Math.max(...d.indents.by_status.map((x: any) => x.n));
                  return (
                    <a key={s.status} className="row gap" style={{ color: 'var(--text)' }} href={`/indents?status=${s.status}`} onClick={(e) => { e.preventDefault(); nav(`/indents?status=${s.status}`); }}>
                      <span style={{ width: 92 }}><Badge>{s.status}</Badge></span>
                      <span className="grow progress" style={{ height: 10 }}><span style={{ width: `${(s.n / max) * 100}%`, background: C1 }} /></span>
                      <strong style={{ width: 48, textAlign: 'right' }}>{s.n}</strong>
                    </a>
                  );
                })}
              </div>
            </Card>

            <Card title="Supply & consumption by" actions={
              <Tabs value={f.group} onChange={(g) => set({ group: g })} tabs={[{ value: 'region', label: 'Region' }, { value: 'client', label: 'Company' }, { value: 'site', label: 'Site' }]} />}>
              <div className="chart-box" style={{ height: Math.max(220, d.breakdown.length * 34) }}>
                <ResponsiveContainer>
                  <BarChart data={d.breakdown} layout="vertical" margin={{ left: 0, right: 12 }} barGap={2} barCategoryGap="22%">
                    <CartesianGrid stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" {...axis} tickFormatter={moneyShort} />
                    <YAxis type="category" dataKey="name" {...axis} width={120} tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + '…' : v)} />
                    <Tooltip content={<ChartTip fmt={money} />} cursor={{ fill: 'var(--surface-2)' }} />
                    <Bar name="Supplied" dataKey="supply_value" fill={C1} radius={[0, 4, 4, 0]} />
                    <Bar name="Consumed" dataKey="consumption_value" fill={C2} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <Legend items={[[C1, 'Supplied'], [C2, 'Consumed']]} />
            </Card>
          </div>

          {showFinance && (
            <div className="grid grid-2">
              <Card title="Payment status · vendor-wise" actions={<Legend items={[[C1, 'Paid'], [C2, 'Outstanding']]} />}>
                <PayChart rows={d.payments.vendors} />
              </Card>
              <Card title="Payment status · RM-wise" actions={<Legend items={[[C1, 'Paid'], [C2, 'Outstanding']]} />}>
                <PayChart rows={d.payments.items} />
              </Card>
            </div>
          )}

          <Card title="Top consumed items" pad={false}>
            <DataTable search={false} rows={d.top_items} rowKey={(r) => r.name} columns={[
              { key: 'name', label: 'Item', primary: true },
              { key: 'qty', label: 'Used', align: 'right', render: (r) => `${num(r.qty)} ${r.uom}` },
              { key: 'wasted', label: 'Wasted', align: 'right', render: (r) => `${num(r.wasted)} ${r.uom}` },
              { key: 'pct', label: 'Wastage %', align: 'right', value: (r) => (r.qty ? (100 * r.wasted) / (r.qty + r.wasted) : 0), render: (r) => `${r.qty ? ((100 * r.wasted) / (r.qty + r.wasted)).toFixed(1) : 0}%` },
            ]} />
          </Card>
        </>
      )}
    </>
  );
}

function PayChart({ rows }: { rows: any[] }) {
  return (
    <div className="chart-box" style={{ height: Math.max(220, rows.length * 32) }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 12 }}>
          <CartesianGrid stroke="var(--border)" horizontal={false} />
          <XAxis type="number" {...axis} tickFormatter={moneyShort} />
          <YAxis type="category" dataKey="name" {...axis} width={120} tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + '…' : v)} />
          <Tooltip content={<ChartTip fmt={money} />} cursor={{ fill: 'var(--surface-2)' }} />
          <Bar name="Paid" dataKey="paid" stackId="a" fill={C1} stroke="var(--surface)" strokeWidth={2} />
          <Bar name="Outstanding" dataKey="balance" stackId="a" fill={C2} stroke="var(--surface)" strokeWidth={2} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
