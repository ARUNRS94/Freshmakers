import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useApi } from '../lib/hooks';
import { Card, Empty, Icon, PageHeader, Spinner, Tabs } from '../components/ui';

const TYPE_LABEL: Record<string, string> = {
  ACTION: 'Action needed', REORDER: 'Site reorder', WH_REORDER: 'Warehouse reorder', INDENT_OVERDUE: 'Overdue indents', DISPATCH_PENDING: 'Unacknowledged dispatch',
  CONSUMPTION_MISSING: 'Missing consumption', PO_LATE: 'Late PO', EXPIRY: 'Expiry', VENDOR_DUE: 'Vendor payments', CLIENT_OVERDUE: 'Client collections', PO_OPEN: 'Open POs',
};

export default function Alerts() {
  const { data, loading, reload } = useApi<any[]>('/alerts');
  const [type, setType] = useState('ALL');
  const types = [...new Set((data ?? []).map((a) => a.type))];
  const list = (data ?? []).filter((a) => type === 'ALL' || a.type === type);
  return (
    <>
      <PageHeader title="Alerts" subtitle="Reorder levels, overdue indents, payments due and other exceptions" actions={<button className="btn btn-ghost" onClick={reload}>Refresh</button>} />
      {types.length > 1 && (
        <Tabs value={type} onChange={setType} tabs={[{ value: 'ALL', label: `All (${data?.length ?? 0})` },
          ...types.map((t) => ({ value: t, label: `${TYPE_LABEL[t] ?? t} (${data!.filter((a) => a.type === t).length})` }))]} />
      )}
      <Card pad={false}>
        {loading && !data ? <Spinner /> : !list.length ? <Empty>All clear — no alerts right now.</Empty> : (
          <div className="alert-list">
            {list.map((a, i) => {
              const body = (
                <>
                  <span className={`kpi-icon tone-${a.severity === 'high' ? 'red' : a.severity === 'medium' ? 'amber' : 'blue'}`}>
                    <Icon name={a.type === 'ACTION' ? 'clipboard' : a.type.includes('REORDER') ? 'box' : a.type.includes('DUE') || a.type.includes('OVERDUE') ? 'rupee' : 'alert'} size={15} />
                  </span>
                  <div className="grow">
                    <strong>{a.title}</strong>
                    <span>{a.detail}</span>
                  </div>
                  <span className="muted small hide-xs">{a.severity === 'high' ? 'High' : a.severity === 'medium' ? 'Medium' : 'Low'}</span>
                  {a.link && <Icon name="chevron" size={16} />}
                </>
              );
              return a.link ? <Link key={i} to={a.link} className="alert-item">{body}</Link> : <div key={i} className="alert-item">{body}</div>;
            })}
          </div>
        )}
      </Card>
    </>
  );
}
