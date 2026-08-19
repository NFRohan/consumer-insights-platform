import React, { useState } from 'react';
import { Card, Switch, Chip } from '../components/index.js';

export default function ConfigView() {
  const [ipWhitelist, setIpWhitelist] = useState(true);
  const [ldap, setLdap] = useState(true);
  const [autoLogout, setAutoLogout] = useState('5');
  const [blockResub, setBlockResub] = useState(true);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="crumb">Admin › System config</div>
          <h1>System configuration</h1>
          <div className="desc">
            IP whitelisting, LDAP/SSO settings, retention & archiving policies.
          </div>
        </div>
      </div>

      <div className="split-2" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
        <Card title="Security">
          <div className="col gap-3">
            <Setting label="IP whitelist" hint="Restrict admin/editor access to trusted IPs">
              <Switch on={ipWhitelist} onChange={setIpWhitelist} />
            </Setting>
            <Setting label="LDAP / SSO" hint="Internal directory authentication">
              <Chip tone={ldap ? 'positive' : undefined}>{ldap ? 'Active' : 'Off'}</Chip>
            </Setting>
            <Setting label="Auto-logout" hint="After inactivity">
              <select className="select" value={autoLogout} onChange={(e) => setAutoLogout(e.target.value)} style={{ width: 140 }}>
                <option value="5">5 minutes</option>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
              </select>
            </Setting>
            <Setting label="Block re-submission" hint="From same respondent ID / browser">
              <Switch on={blockResub} onChange={setBlockResub} />
            </Setting>
          </div>
        </Card>

        <Card title="Data lifecycle">
          <div className="col gap-3">
            <div>
              <label className="label">Retention</label>
              <select className="select"><option>5 years (active)</option></select>
            </div>
            <div>
              <label className="label">Archive after</label>
              <select className="select"><option>12 months</option></select>
            </div>
            <div>
              <label className="label">Purge after</label>
              <select className="select"><option>10 years</option></select>
            </div>
            <div className="card" style={{ padding: 10, background: 'var(--surface-2)' }}>
              <div className="tiny mono mute" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>SLA</div>
              <div className="row gap-3 small">
                <div><strong className="mono">99.9%</strong> uptime</div>
                <div>RTO <strong className="mono">&lt; 1h</strong></div>
                <div>RPO <strong className="mono">&lt; 15m</strong></div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="split-2" style={{ alignItems: 'flex-start' }}>
        <Card title="Performance targets" sub="At full production scale">
          <div className="col gap-2 small">
            <Row k="Concurrent active respondents / minute" v="100,000" />
            <Row k="Active concurrent admins / minute" v="4–5" />
            <Row k="Responses ingested / 24h" v="500,000" />
            <Row k="Surveys / month" v="18–20" />
            <Row k="Participants / month / survey" v="30,000" />
            <Row k="Participants / month total" v="300,000" />
            <Row k="Page load time" v="≤ 5 s" />
            <Row k="Action response time" v="≤ 2 s" />
          </div>
        </Card>
        <Card title="Tech stack" sub="What this environment runs on">
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            <Chip tone="accent">React (Vite)</Chip>
            <Chip tone="accent">Serverless API</Chip>
            <Chip>Postgres</Chip>
            <Chip>Row-level security</Chip>
            <Chip>JWT sessions</Chip>
            <Chip>Live updates by polling</Chip>
          </div>
          <div className="small mute" style={{ marginTop: 12 }}>
            This is the evaluation environment. A production rollout is sized and
            hosted to suit the organisation it serves.
          </div>
        </Card>
      </div>
    </div>
  );
}

function Setting({ label, hint, children }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontWeight: 500 }}>{label}</div>
        <div className="small mute">{hint}</div>
      </div>
      {children}
    </div>
  );
}
function Row({ k, v }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="mute">{k}</span>
      <strong className="mono">{v}</strong>
    </div>
  );
}
