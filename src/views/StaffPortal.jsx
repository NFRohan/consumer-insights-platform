import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { authFetch } from '../lib/apiClient.js';
import { Btn, Card, Chip, Stat, Empty, Icon } from '../components/index.js';
import { fmtDate, fmtWhen, relativeDays, daysUntil } from '../lib/relativeTime.js';

// =====================================================================
// Staff portal — issue, watch and withdraw evaluation access.
//
// Deliberately separate from the product itself: staff accounts sit
// outside every tenant and cannot read prospect survey data, so this
// screen shows the shape of an evaluation (who, until when, have they
// signed in) and never its contents.
// =====================================================================

const STATUS_TONE = { active: 'positive', expired: 'warn', revoked: 'danger' };

// ---------------------------------------------------------------------
// sign-in, for staff only
// ---------------------------------------------------------------------
function StaffSignIn() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await signIn(username.trim(), password);
      if (err) throw err;
    } catch (err) {
      setError(err?.message ?? 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="row" style={{ marginBottom: 18, gap: 10, alignItems: 'center' }}>
          <div className="brand-mark" />
          <div className="brand-name">staff<em>console</em></div>
        </div>
        <h2>Staff sign in</h2>
        <div className="auth-sub">Issue and manage evaluation access.</div>

        {error && (
          <div className="alert" data-tone="danger" style={{ marginBottom: 12 }}>{error}</div>
        )}

        <form onSubmit={submit} className="col gap-3">
          <div>
            <label className="label">Username</label>
            <input className="input" required autoComplete="username"
                   value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" required autoComplete="current-password"
                   value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Btn type="submit" variant="primary" size="lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Btn>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// the one-time credential reveal
// ---------------------------------------------------------------------
function CredentialCard({ credential, tenant, onDone }) {
  const [copied, setCopied] = useState(null);

  const copy = async (label, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied('unavailable');
    }
  };

  const both = `Username: ${credential.username}\nPassword: ${credential.password}`;

  return (
    <Card
      title="Credentials issued"
      sub="Copy these now — the password is stored only as a hash and cannot be shown again."
      action={<Btn size="sm" variant="ghost" onClick={onDone}>Done</Btn>}
    >
      <div className="col gap-3">
        <div className="row gap-3" style={{ flexWrap: 'wrap' }}>
          {[['Username', credential.username], ['Password', credential.password]].map(([label, value]) => (
            <div key={label} style={{ minWidth: 220, flex: 1 }}>
              <div className="label">{label}</div>
              <div className="row gap-2" style={{ alignItems: 'center' }}>
                <code className="mono" style={{
                  flex: 1, padding: '8px 10px', border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)',
                  fontSize: 14, letterSpacing: '0.02em',
                }}>{value}</code>
                <Btn size="sm" variant="ghost" icon="copy" onClick={() => copy(label, value)}>
                  {copied === label ? 'Copied' : 'Copy'}
                </Btn>
              </div>
            </div>
          ))}
        </div>

        <div className="alert" data-tone="warn">
          Expires {fmtDate(tenant.expires_at)} ({relativeDays(tenant.expires_at)}). After that the
          sign-in is refused; the sandbox survives until it is purged.
        </div>

        <div className="row gap-2">
          <Btn size="sm" icon="copy" onClick={() => copy('both', both)}>
            {copied === 'both' ? 'Copied both' : 'Copy both'}
          </Btn>
          {copied === 'unavailable' && (
            <span className="small mute">Clipboard unavailable — select and copy manually.</span>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
// mint form
// ---------------------------------------------------------------------
function MintForm({ onMinted }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [ttlDays, setTtlDays] = useState(3);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // A sensible default the operator can override rather than retype.
  const suggest = (value) => {
    setName(value);
    const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18);
    if (slug) setUsername(`${slug}.eval`);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await authFetch('/api/admin/tenants', {
        method: 'POST',
        body: { name, username, ttlDays: Number(ttlDays), notes },
      });
      onMinted(res);
      setName(''); setUsername(''); setNotes(''); setTtlDays(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Issue access" sub="Creates an isolated sandbox seeded with the demo data.">
      {error && <div className="alert" data-tone="danger" style={{ marginBottom: 12 }}>{error}</div>}
      <form onSubmit={submit} className="col gap-3">
        <div className="split-2" style={{ gap: 12 }}>
          <div>
            <label className="label">Company or contact</label>
            <input className="input" required value={name}
                   onChange={(e) => suggest(e.target.value)} placeholder="Acme Foods" />
          </div>
          <div>
            <label className="label">Username</label>
            <input className="input" required value={username}
                   onChange={(e) => setUsername(e.target.value)} placeholder="acme.eval" />
          </div>
        </div>

        <div className="split-2" style={{ gap: 12 }}>
          <div>
            <label className="label">Access for</label>
            <select className="select" value={ttlDays} onChange={(e) => setTtlDays(e.target.value)}>
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
          <div>
            <label className="label">Note <span className="mute small">(optional)</span></label>
            <input className="input" value={notes}
                   onChange={(e) => setNotes(e.target.value)} placeholder="Trial after 12 Aug call" />
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Btn type="submit" variant="accent" icon="plus" disabled={busy}>
            {busy ? 'Creating…' : 'Issue credentials'}
          </Btn>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------
// portal
// ---------------------------------------------------------------------
function Portal() {
  const { profile, signOut } = useAuth();
  const [tenants, setTenants] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [issued, setIssued] = useState(null);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null);

  const load = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([
        authFetch('/api/admin/tenants'),
        authFetch('/api/admin/audit'),
      ]);
      setTenants(t.tenants || []);
      setEntries(a.entries || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (body) => {
    try {
      await authFetch('/api/admin/actions', { method: 'POST', body });
      setConfirming(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const counts = useMemo(() => ({
    active: tenants.filter((t) => t.status === 'active').length,
    soon: tenants.filter((t) => t.status === 'active' && daysUntil(t.expires_at) !== null
      && daysUntil(t.expires_at) <= 2).length,
    inactive: tenants.filter((t) => t.status !== 'active').length,
  }), [tenants]);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="crumb">Intelligent Machines › Staff</div>
          <h1>Evaluation access</h1>
          <div className="desc">
            Issue time-limited credentials, and withdraw them when a trial ends.
          </div>
        </div>
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <span className="small mute">{profile?.full_name || profile?.username}</span>
          <Btn size="sm" variant="ghost" icon="logout" onClick={signOut}>Sign out</Btn>
        </div>
      </div>

      {error && <div className="alert" data-tone="danger" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="split-3" style={{ gap: 12, marginBottom: 16 }}>
        <Stat label="Active evaluations" value={counts.active} />
        <Stat label="Expiring within 48h" value={counts.soon}
              delta={counts.soon ? 'follow up' : 'none due'} deltaTone={counts.soon ? 'warn' : undefined} />
        <Stat label="Expired or revoked" value={counts.inactive} />
      </div>

      {issued ? (
        <div style={{ marginBottom: 16 }}>
          <CredentialCard
            credential={issued.credential}
            tenant={issued.tenant}
            onDone={() => { setIssued(null); load(); }}
          />
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <MintForm onMinted={(res) => { setIssued(res); load(); }} />
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <Card
          title="Issued credentials"
          sub={`${tenants.length} sandbox${tenants.length === 1 ? '' : 'es'}`}
          action={<Btn size="sm" variant="ghost" onClick={load}>Refresh</Btn>}
          pad={false}
        >
          {loading ? (
            <div className="empty">Loading…</div>
          ) : !tenants.length ? (
            <Empty icon="users" title="No evaluations yet"
                   hint="Issue credentials above to create the first sandbox." />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Username</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th>Last sign-in</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{t.name}</div>
                      {t.notes && <div className="small mute">{t.notes}</div>}
                    </td>
                    <td className="mono small">{t.username || '—'}</td>
                    <td><Chip tone={STATUS_TONE[t.status]}>{t.status}</Chip></td>
                    <td>
                      <div>{fmtDate(t.expires_at)}</div>
                      <div className="small mute">{relativeDays(t.expires_at)}</div>
                    </td>
                    <td className="small">
                      {t.last_login_at
                        ? fmtWhen(t.last_login_at)
                        : <span className="mute">never signed in</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                        <Btn size="sm" variant="ghost"
                             onClick={() => act({ action: 'extend', tenantId: t.id, days: 7 })}>
                          +7 days
                        </Btn>
                        {t.status !== 'revoked' && (
                          confirming === t.id ? (
                            <>
                              <Btn size="sm" variant="danger"
                                   onClick={() => act({ action: 'revoke', tenantId: t.id })}>
                                Confirm
                              </Btn>
                              <Btn size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                                Cancel
                              </Btn>
                            </>
                          ) : (
                            <Btn size="sm" variant="ghost" onClick={() => setConfirming(t.id)}>
                              Revoke
                            </Btn>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card
        title="Activity"
        sub="Every issue, extension, revocation and purge — kept even after a sandbox is deleted."
        pad={false}
      >
        {!entries.length ? (
          <Empty icon="log" title="Nothing yet" hint="Actions taken here will be recorded." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Sandbox</th>
                <th>Detail</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="small mono">{fmtWhen(e.ts)}</td>
                  <td>
                    <Chip tone={
                      e.kind === 'tenant.mint' ? 'positive'
                        : e.kind === 'tenant.revoke' ? 'danger'
                          : e.kind === 'tenant.purge' ? 'warn' : undefined
                    }>
                      {e.kind.replace('tenant.', '')}
                    </Chip>
                  </td>
                  <td className="mono small">{e.tenant_ref || '—'}</td>
                  <td className="small">{e.detail}</td>
                  <td className="small mute">{e.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------
export default function StaffPortal() {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return <div className="auth-shell"><div className="auth-card">Loading…</div></div>;
  }
  if (!session) return <StaffSignIn />;

  // A prospect who finds this URL sees a refusal, not a login loop.
  if (!session.user?.is_staff) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="row gap-2" style={{ alignItems: 'center', marginBottom: 10 }}>
            <Icon name="shield" />
            <h2 style={{ margin: 0 }}>Staff only</h2>
          </div>
          <div className="auth-sub">
            You are signed in as {profile?.username}, which is an evaluation account.
            This console is for Intelligent Machines staff.
          </div>
          <div style={{ marginTop: 14 }}>
            <Btn onClick={() => { window.location.href = '/'; }}>Back to the platform</Btn>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="staff-shell">
      <Portal />
    </div>
  );
}
