import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Btn, Card, Chip, Empty, fmt } from '../components/index.js';
import { logAudit } from '../lib/audit.js';

const ROLES = [
  { id: 'admin', label: 'Administrator', perms: ['User mgmt', 'System config', 'Raw data', 'All surveys', 'Audit logs'] },
  { id: 'creator', label: 'Survey Creator', perms: ['Build', 'Distribute', 'Analyze', 'Export'] },
  { id: 'viewer', label: 'Viewer', perms: ['View dashboards', 'View reports'] },
];

export default function UsersView() {
  const { profile } = useAuth();
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const reload = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    setUsers(data || []);
  };

  useEffect(() => {
    reload();
    const ch = supabase
      .channel('profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => reload())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const updateRole = async (u, role) => {
    await supabase.from('profiles').update({ role }).eq('id', u.id);
    await logAudit({
      kind: 'role.update',
      ref: u.id,
      detail: `Changed ${u.email}: ${u.role} → ${role}`,
    });
  };
  const setStatus = async (u, status) => {
    await supabase.from('profiles').update({ status }).eq('id', u.id);
    await logAudit({
      kind: 'user.status',
      ref: u.id,
      detail: `Status of ${u.email} → ${status}`,
    });
  };

  const filtered = useMemo(() => {
    return users
      .filter((u) => filter === 'all' || u.role === filter || u.status === filter)
      .filter((u) =>
        !search.trim()
          ? true
          : (u.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
            (u.email || '').toLowerCase().includes(search.toLowerCase()),
      );
  }, [users, filter, search]);

  const stats = useMemo(() => ({
    total: users.length,
    admins: users.filter((u) => u.role === 'admin').length,
    creators: users.filter((u) => u.role === 'creator').length,
    viewers: users.filter((u) => u.role === 'viewer').length,
  }), [users]);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="crumb">Admin › Users & roles</div>
          <h1>Users & roles</h1>
          <div className="desc">
            LDAP-authenticated workspace users. Promote, demote, deactivate. All changes go to the
            audit log.
          </div>
        </div>
        <div className="row gap-2">
          <input className="input" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200 }} />
          <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 140 }}>
            <option value="all">All</option>
            {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      <div className="split-4" style={{ marginBottom: 16 }}>
        <Card title="Total users"><div className="stat-value">{fmt.num(stats.total)}</div></Card>
        <Card title="Administrators"><div className="stat-value">{fmt.num(stats.admins)}</div></Card>
        <Card title="Creators"><div className="stat-value">{fmt.num(stats.creators)}</div></Card>
        <Card title="Viewers"><div className="stat-value">{fmt.num(stats.viewers)}</div></Card>
      </div>

      <div className="split-3-2" style={{ alignItems: 'flex-start' }}>
        <Card pad={false} title={`Workspace users · ${filtered.length}`}>
          {filtered.length === 0 ? (
            <Empty title="No users match" hint="Try a different filter." icon="users" />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="row gap-2">
                        <div className="avatar">
                          {(u.full_name || u.email || 'U').split(' ').map((s) => s[0]?.toUpperCase()).slice(0, 2).join('')}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500 }}>{u.full_name || '—'}</div>
                          <div className="small mute">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <select
                        className="select"
                        style={{ width: 150 }}
                        value={u.role}
                        onChange={(e) => updateRole(u, e.target.value)}
                      >
                        {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </select>
                    </td>
                    <td>
                      {u.status === 'active' && <Chip tone="positive">Active</Chip>}
                      {u.status === 'pending' && <Chip tone="warn">Pending</Chip>}
                      {u.status === 'inactive' && <Chip tone="danger">Inactive</Chip>}
                    </td>
                    <td className="small mute">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td>
                      <div className="row gap-2">
                        {u.status !== 'active' && (
                          <Btn size="sm" onClick={() => setStatus(u, 'active')}>Activate</Btn>
                        )}
                        {u.status === 'active' && (
                          <Btn size="sm" variant="ghost" onClick={() => setStatus(u, 'inactive')}>Deactivate</Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Roles & permissions">
          <div className="col gap-3">
            {ROLES.map((r) => (
              <div key={r.id}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{r.label}</strong>
                  <Chip>{users.filter((u) => u.role === r.id).length}</Chip>
                </div>
                <div className="row gap-2" style={{ flexWrap: 'wrap', marginTop: 4 }}>
                  {r.perms.map((p) => <Chip key={p}>{p}</Chip>)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
