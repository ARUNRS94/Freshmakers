import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { Field, Input } from '../components/Form';
import { ErrorBox } from '../components/ui';

const DEMO = ['barista', 'manager', 'supervisor', 'opshead', 'cbo', 'scm', 'finance', 'vendor', 'admin'];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent, em = email, pw = password) => {
    e?.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await login(em, pw);
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <div className="row gap"><img src="/favicon.svg" width={40} height={40} alt="" /><strong style={{ fontSize: '1.2rem' }}>Freshmakers</strong></div>
        <div className="stack">
          <h2>Every litre, cup and rupee — tracked from vendor to site.</h2>
          <ul>
            <li>Site-wise stock, daily consumption and next-day requirement</li>
            <li>Indent approvals: Barista → Manager → Supervisor → Ops Head → CBO → SCM</li>
            <li>Purchase orders, GRNs, local purchases and dispatches with rates</li>
            <li>Vendor payables, client receivables, attendance and deployment</li>
          </ul>
        </div>
        <span style={{ opacity: 0.7, fontSize: '.85rem' }}>46 clients · 168 sites · 5 regions</span>
      </div>
      <div className="login-panel">
        <form className="login-card card card-body" onSubmit={submit}>
          <div>
            <h1>Sign in</h1>
            <p className="muted">Use your Freshmakers account</p>
          </div>
          <ErrorBox>{err}</ErrorBox>
          <Field label="Email">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@freshmakers.in" />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="stack" style={{ gap: '.4rem' }}>
            <span className="muted small">Demo accounts (password Fresh@123) — tap to sign in:</span>
            <div className="demo-users">
              {DEMO.map((d) => (
                <button key={d} type="button" onClick={() => { setEmail(`${d}@freshmakers.in`); setPassword('Fresh@123'); submit(undefined, `${d}@freshmakers.in`, 'Fresh@123'); }}>
                  {d}
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
