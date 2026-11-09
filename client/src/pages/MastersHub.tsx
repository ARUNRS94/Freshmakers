import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { invalidateLookups, useApi } from '../lib/hooks';
import { downloadCsv } from '../lib/format';
import { Card, ErrorBox, Icon, PageHeader, Spinner, Stat, useToast } from '../components/ui';
import { Modal } from '../components/Form';
import { DataTable } from '../components/DataTable';

interface Master {
  key: string;
  label: string;
  manage: string;
  needs: string[];
  count: number;
  can_import: boolean;
  match_on: string[];
}

interface ImportResult {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  warnings: string[];
  error_count: number;
  errors: { row: number; column: string; message: string }[];
  applied: boolean;
}

/** The API accepts 2 MB of JSON, and escaping makes the CSV larger once it is wrapped */
const MAX_FILE_BYTES = 1.5 * 1024 * 1024;

export default function MastersHub() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Master[]>('/master-data');
  const [importing, setImporting] = useState<Master | null>(null);
  const [downloading, setDownloading] = useState('');

  const download = async (m: Master, kind: 'template' | 'export') => {
    setDownloading(`${m.key}:${kind}`);
    try {
      const file = await api<{ columns: { key: string; label: string }[]; rows: any[] }>(`/master-data/${m.key}/${kind}`);
      downloadCsv(`${m.key}-${kind}`, file.columns, file.rows);
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setDownloading('');
    }
  };

  return (
    <>
      <PageHeader title="Masters" subtitle="All master data in one place, with bulk import and export" />
      <div className="alert-box info" style={{ marginBottom: '1rem' }}>
        Download a <strong>template</strong> (or an <strong>export</strong> of current data), fill it in Excel, save as CSV and <strong>import</strong> it.
        Existing records are matched and updated; blank cells keep the current value. You see a preview first, and nothing is saved if any row has a problem.
      </div>
      <ErrorBox>{error}</ErrorBox>
      <Card pad={false}>
        <DataTable loading={loading} rows={data} search={false} rowKey={(m) => m.key} pageSize={20}
          columns={[
            { key: 'label', label: 'Master', primary: true, render: (m: Master) => (
              <span>{m.label}{m.needs.length > 0 && <><br /><span className="muted small">Needs {m.needs.join(', ')} first</span></>}</span>
            ) },
            { key: 'count', label: 'Records', align: 'right', render: (m: Master) => m.count.toLocaleString('en-IN') },
            { key: 'actions', label: 'Actions', value: () => '', render: (m: Master) => (
              <div className="row gap">
                <button className="btn btn-ghost btn-sm" disabled={!!downloading} onClick={() => download(m, 'template')}><Icon name="file" size={15} /> {downloading === `${m.key}:template` ? 'Preparing…' : 'Template'}</button>
                <button className="btn btn-ghost btn-sm" disabled={!!downloading} onClick={() => download(m, 'export')}><Icon name="download" size={15} /> {downloading === `${m.key}:export` ? 'Preparing…' : 'Export'}</button>
                {m.can_import && <button className="btn btn-sm" onClick={() => setImporting(m)}><Icon name="plus" size={15} /> Import</button>}
                <Link className="btn btn-ghost btn-sm" to={m.manage}>Manage</Link>
              </div>
            ) },
          ]} />
      </Card>
      {importing && <ImportDialog key={importing.key} master={importing} onClose={() => setImporting(null)} onImported={reload} />}
    </>
  );
}

function ImportDialog({ master, onClose, onImported }: { master: Master; onClose: () => void; onImported: () => void }) {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const send = (text: string, dryRun: boolean) => api<ImportResult>(`/master-data/${master.key}/import`, { body: { csv: text, dry_run: dryRun } });

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same file be chosen again after it is corrected
    if (!file) return;
    setErr('');
    setPreview(null);
    setCsv('');
    setFileName(file.name);
    if (!file.name.toLowerCase().endsWith('.csv')) return setErr('Please choose a CSV file. In Excel use Save As → "CSV UTF-8 (Comma delimited)".');
    if (file.size > MAX_FILE_BYTES) return setErr('This file is too large (limit 1.5 MB). Split it into smaller files.');
    setBusy(true);
    try {
      const text = await file.text();
      setPreview(await send(text, true));
      setCsv(text);
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setErr('');
    try {
      const result = await send(csv, false);
      if (!result.applied) return setPreview(result);
      invalidateLookups();
      onImported();
      toast(`${master.label}: ${result.created} added, ${result.updated} updated`);
      onClose();
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  const changes = preview ? preview.created + preview.updated : 0;
  const ready = !!preview && preview.error_count === 0 && changes > 0;

  return (
    <Modal open wide onClose={onClose} title={`Import ${master.label}`}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !ready} onClick={apply}>{busy && preview ? 'Importing…' : ready ? `Import ${changes} ${changes === 1 ? 'change' : 'changes'}` : 'Import'}</button>
      </>}>
      <div className="stack">
        <div>
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={choose} aria-label="CSV file to import" />
          <p className="muted small" style={{ marginTop: '.4rem' }}>
            {fileName && <><strong>{fileName}</strong> · </>}Records are matched on {master.match_on.join(' + ')}. Rows starting with # are ignored.
          </p>
        </div>
        <ErrorBox>{err}</ErrorBox>
        {busy && !preview && <Spinner label={`Checking ${fileName}…`} />}
        {preview && (
          <>
            <div className="stats">
              <Stat label="Rows in file">{preview.total}</Stat>
              <Stat label="New">{preview.created}</Stat>
              <Stat label="Updates">{preview.updated}</Stat>
              <Stat label="Unchanged">{preview.unchanged}</Stat>
              <Stat label="Problems"><span className={preview.error_count ? 'text-red' : ''}>{preview.error_count}</span></Stat>
            </div>
            {preview.warnings.length > 0 && <div className="alert-box warn"><ul>{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
            {preview.error_count > 0 ? (
              <>
                <ErrorBox>Nothing has been saved. Correct these rows in your file and choose it again.{preview.error_count > preview.errors.length && ` Showing the first ${preview.errors.length} of ${preview.error_count}.`}</ErrorBox>
                <DataTable rows={preview.errors} search={false} pageSize={8} rowKey={(_, i) => i}
                  columns={[
                    { key: 'row', label: 'Row', primary: true },
                    { key: 'column', label: 'Column', render: (x) => x.column || '—' },
                    { key: 'message', label: 'Problem' },
                  ]} />
              </>
            ) : changes === 0 ? (
              <div className="alert-box info">Every row already matches the current data, so there is nothing to import.</div>
            ) : (
              <div className="alert-box info">No problems found. Nothing is saved until you press Import.</div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
