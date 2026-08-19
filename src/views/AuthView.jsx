import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { Btn, Chip } from '../components/UI.jsx';
import { sessionEndedBecause } from '../lib/apiClient.js';

// =====================================================================
// Sign in.
//
// Self-registration is gone: evaluation credentials are issued by
// Intelligent Machines with an expiry attached, so there is nothing for
// a visitor to create. The screen is now a single form.
// =====================================================================

export default function AuthView() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // If the session ended because the evaluation lapsed rather than
  // because nobody was signed in, say so instead of showing a bare form.
  const [error, setError] = useState(sessionEndedBecause);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await signIn(username.trim(), password);
      if (err) throw err;
    } catch (err) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="row" style={{ marginBottom: 18, gap: 10, alignItems: 'center' }}>
          <div className="brand-mark" />
          <div className="brand-name">consumer<em>insights</em></div>
        </div>
        <h2>Sign in</h2>
        <div className="auth-sub">
          Use the evaluation credentials issued to you. Access is time-limited
          and expires on the date in your invitation.
        </div>

        {error && (
          <div className="alert" data-tone="danger" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        <form onSubmit={submit} className="col gap-3">
          <div>
            <label className="label">Username</label>
            <input
              className="input"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="acme.eval"
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <Btn type="submit" variant="primary" disabled={busy} size="lg">
            {busy ? 'Signing in…' : 'Sign in'}
          </Btn>
        </form>

        <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <span className="small mute">
            Need access? Ask your Intelligent Machines contact.
          </span>
        </div>

        <div className="divider" />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Chip tone="accent">Isolated workspace</Chip>
          <Chip tone="positive">RLS enforced</Chip>
          <Chip>Time-limited access</Chip>
        </div>
      </div>
    </div>
  );
}
