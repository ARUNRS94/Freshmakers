import { useState } from 'react';
import { Modal } from './Form';
import { Icon } from './ui';

export interface Credentials {
  name: string;
  login: string;
  password: string;
}

/** Shows a one-time password once, so it can be handed to the person */
export function CredentialsModal({ creds, onClose }: { creds: Credentials | null; onClose: () => void }) {
  const [copied, setCopied] = useState('');
  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setCopied('');
    }
  };
  const all = creds ? `Freshmakers sign-in\n${window.location.origin}\nUsername: ${creds.login}\nTemporary password: ${creds.password}` : '';
  return (
    <Modal open={!!creds} onClose={onClose} title={`Sign-in details for ${creds?.name ?? ''}`}
      footer={<>
        <button className="btn btn-ghost" onClick={() => copy('all', all)}><Icon name="clipboard" size={15} /> {copied === 'all' ? 'Copied' : 'Copy all'}</button>
        <button className="btn" onClick={onClose}>Done</button>
      </>}>
      {creds && (
        <div className="stack" style={{ gap: '.75rem' }}>
          <div className="alert-box warn">This password is shown only once. Give it to {creds.name} now. They will choose their own password when they first sign in.</div>
          <div className="stats">
            <div className="stat"><span className="muted">Sign in at</span><strong>{window.location.origin}</strong></div>
            <div className="stat"><span className="muted">Username</span><strong className="mono">{creds.login}</strong></div>
            <div className="stat"><span className="muted">Temporary password</span><strong className="mono">{creds.password}</strong></div>
          </div>
        </div>
      )}
    </Modal>
  );
}
