import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { Field, Input } from '../components/Form';
import { ErrorBox } from '../components/ui';

const MIN = 8;

export function ChangePasswordForm({ onDone, submitLabel = 'Change password' }: { onDone?: () => void; submitLabel?: string }) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (next.length < MIN) return setErr(`Use at least ${MIN} characters`);
    if (next !== confirm) return setErr('The new passwords do not match');
    if (next === current) return setErr('Choose a password different from the current one');
    setBusy(true);
    try {
      await changePassword(current, next);
      onDone?.();
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" style={{ gap: '.85rem' }} onSubmit={submit}>
      <ErrorBox>{err}</ErrorBox>
      <Field label="Current password"><Input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
      <Field label="New password" hint={`At least ${MIN} characters`}><Input type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field label="Confirm new password"><Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      <button className="btn" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}

/** Shown instead of the app until someone replaces a temporary password */
export default function ChangePasswordPage() {
  const { user, logout } = useAuth();
  return (
    <div className="login-panel" style={{ minHeight: '100dvh' }}>
      <div className="login-card card card-body">
        <div>
          <h1>Choose your password</h1>
          <p className="muted">Hi {user?.name}. You signed in with a temporary password. Choose your own to continue.</p>
        </div>
        <ChangePasswordForm submitLabel="Save and continue" />
        <button type="button" className="btn btn-ghost" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}
