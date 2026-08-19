import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Card, Chip, Empty } from '../components/index.js';

const KIND_TONE = {
  'survey.publish': 'positive',
  'survey.unpublish': 'warn',
  'survey.delete': 'danger',
  'data.clean': 'warn',
  'role.update': 'accent',
  'user.status': 'accent',
  'auth.login': undefined,
  'config.css': 'accent',
};

export default function AuditView() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');

  const reload = async () => {
    const { data } = await supabase
      .from('audit_logs')
      .select('*')
      .order('ts', { ascending: false })
      .limit(500);
    setLogs(data || []);
  };

  useEffect(() => {
    reload();
    const ch = supabase
      .channel('audit')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' },
           // Polled, not streamed: the tick carries no row, so re-read.
           () => reload())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const kinds = useMemo(() => Array.from(new Set(logs.map((l) => l.kind))).sort(), [logs]);

  const filtered = useMemo(
    () =>
      logs
        .filter((l) => !filter || l.kind === filter)
        .filter((l) =>
          !search.trim()
            ? true
            : (l.detail || '').toLowerCase().includes(search.toLowerCase()) ||
              (l.actor_name || '').toLowerCase().includes(search.toLowerCase()) ||
              (l.kind || '').toLowerCase().includes(search.toLowerCase()),
        ),
    [logs, filter, search],
  );

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="crumb">Admin › Audit log</div>
          <h1>Audit log</h1>
          <div className="desc">
            Every change is logged — survey actions, distributions, role changes, data cleaning,
            integrations, auth.
          </div>
        </div>
        <div className="row gap-2">
          <input className="input" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200 }} />
          <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 200 }}>
            <option value="">All kinds</option>
            {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      </div>

      <Card pad={false} title={`${filtered.length} entries`}>
        {filtered.length === 0 ? (
          <Empty title="No audit events yet" hint="As soon as actions happen, they appear here in real-time." icon="log" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 170 }}>When</th>
                <th style={{ width: 160 }}>Kind</th>
                <th>Actor</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id}>
                  <td className="mono small mute">{new Date(l.ts).toLocaleString()}</td>
                  <td><Chip tone={KIND_TONE[l.kind]}>{l.kind}</Chip></td>
                  <td>{l.actor_name || 'system'}</td>
                  <td>
                    <div>{l.detail}</div>
                    {l.ref && <div className="small mute mono">ref: {l.ref}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
