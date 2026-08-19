import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Btn, Chip, Card, Stat, Empty, Icon, fmt } from '../components/index.js';
import { logAudit } from '../lib/audit.js';

export default function SurveysListView({ ctx }) {
  const { profile, session } = useAuth();
  const [surveys, setSurveys] = useState([]);
  const [responseCounts, setResponseCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: srv, error: srvErr } = await supabase
        .from('surveys')
        .select('*')
        .order('created_at', { ascending: false });
      if (srvErr) throw srvErr;
      setSurveys(srv || []);
      if (srv?.length) {
        const ids = srv.map((s) => s.id);
        const { data: resp, error: respErr } = await supabase
          .from('responses')
          .select('survey_id,status')
          .in('survey_id', ids);
        if (respErr) throw respErr;
        const counts = {};
        (resp || []).forEach((r) => {
          counts[r.survey_id] ??= { total: 0, completed: 0 };
          counts[r.survey_id].total += 1;
          if (r.status === 'completed') counts[r.survey_id].completed += 1;
        });
        setResponseCounts(counts);
      } else {
        setResponseCounts({});
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('surveys load failed', err);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel('surveys-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'surveys' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'responses' }, () => load())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const createSurvey = async () => {
    const ownerId = profile?.id || session?.user?.id;
    if (!ownerId) {
      setError('Not signed in. Refresh the page and try again.');
      return;
    }
    const name = (newName || 'Untitled survey').trim();
    // eslint-disable-next-line no-console
    console.log('[createSurvey] starting', { name, ownerId });
    setCreating(true);
    setError(null);
    // safety: never let the button stay stuck — bail after 8s no matter what
    const safety = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn('[createSurvey] timed out — flipping creating=false');
      setCreating(false);
      setError('The Supabase request did not return within 8s. Check the browser Network tab for the POST to /rest/v1/surveys.');
    }, 8000);
    try {
      const { data, error: insErr } = await supabase
        .from('surveys')
        .insert({
          name,
          description: '',
          owner_id: ownerId,
          status: 'draft',
          languages: ['en'],
          default_language: 'en',
        })
        .select()
        .single();
      // eslint-disable-next-line no-console
      console.log('[createSurvey] insert returned', { data, insErr });
      if (insErr) throw insErr;
      // seed a starter NPS question
      await supabase.from('questions').insert({
        survey_id: data.id,
        position: 0,
        type: 'nps',
        text: 'How likely are you to recommend us to a friend or colleague?',
        required: true,
        config: { scale: 11 },
      });
      await logAudit({
        kind: 'survey.create',
        ref: data.id,
        detail: `Created "${name}"`,
      });
      setNewName('');
      ctx.goBuilder(data.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('createSurvey failed', err);
      setError(err?.message || String(err));
    } finally {
      clearTimeout(safety);
      setCreating(false);
    }
  };

  const togglePublish = async (s) => {
    const next = s.status === 'live' ? 'draft' : 'live';
    await supabase
      .from('surveys')
      .update({
        status: next,
        published_at: next === 'live' ? new Date().toISOString() : null,
      })
      .eq('id', s.id);
    await logAudit({
      kind: next === 'live' ? 'survey.publish' : 'survey.unpublish',
      ref: s.id,
      detail: `Survey "${s.name}" → ${next}`,
    });
  };

  const removeSurvey = async (s) => {
    if (!confirm(`Delete survey "${s.name}"? This is permanent.`)) return;
    await supabase.from('surveys').delete().eq('id', s.id);
    await logAudit({
      kind: 'survey.delete',
      ref: s.id,
      detail: `Deleted "${s.name}"`,
    });
  };

  const filtered = surveys.filter((s) => filter === 'all' || s.status === filter);

  const totalLive = surveys.filter((s) => s.status === 'live').length;
  const totalResponses = Object.values(responseCounts).reduce((a, c) => a + c.total, 0);
  const totalCompleted = Object.values(responseCounts).reduce((a, c) => a + c.completed, 0);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="crumb">Build › Surveys</div>
          <h1>Surveys</h1>
          <div className="desc">
            Live and draft surveys, owners, response progress. Create a new one or open an existing
            survey to keep building.
          </div>
        </div>
        <div className="row gap-2">
          <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 130 }}>
            <option value="all">All</option>
            <option value="draft">Drafts</option>
            <option value="live">Live</option>
            <option value="closed">Closed</option>
          </select>
          <input
            className="input"
            placeholder="New survey name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createSurvey()}
            style={{ width: 220 }}
          />
          <Btn variant="primary" icon="plus" onClick={createSurvey} disabled={creating}>
            {creating ? 'Creating…' : 'New survey'}
          </Btn>
        </div>
      </div>

      {error && (
        <div className="alert" data-tone="danger" style={{ marginBottom: 16 }}>
          <strong>Error:</strong> {error}
          <div className="small" style={{ marginTop: 4 }}>
            (See browser devtools → Console for the full stack.)
          </div>
        </div>
      )}

      <div className="split-3" style={{ marginBottom: 16 }}>
        <Stat label="Total surveys" value={surveys.length} delta={`${totalLive} live`} deltaTone="positive" />
        <Stat label="Responses (all)" value={fmt.num(totalResponses)} delta={`${fmt.num(totalCompleted)} completed`} />
        <Stat
          label="Completion rate"
          value={
            totalResponses > 0 ? `${Math.round((totalCompleted / totalResponses) * 100)}%` : '—'
          }
          delta="Across all surveys"
        />
      </div>

      <Card pad={false}>
        {loading ? (
          <div className="empty">Loading surveys…</div>
        ) : filtered.length === 0 ? (
          <Empty
            title="No surveys yet"
            hint="Create your first survey to start collecting responses."
            icon="list"
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Survey</th>
                <th>Status</th>
                <th>Responses</th>
                <th>Created</th>
                <th style={{ width: 220 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const c = responseCounts[s.id] || { total: 0, completed: 0 };
                return (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{s.name}</div>
                      <div className="mono small mute">{s.id.slice(0, 8)}</div>
                    </td>
                    <td>
                      {s.status === 'live' ? (
                        <Chip tone="positive" pulse>
                          Live
                        </Chip>
                      ) : s.status === 'draft' ? (
                        <Chip>Draft</Chip>
                      ) : (
                        <Chip tone="warn">{s.status}</Chip>
                      )}
                    </td>
                    <td className="mono">
                      {fmt.num(c.total)} <span className="mute">· {fmt.num(c.completed)} ✓</span>
                    </td>
                    <td className="small mute">
                      {new Date(s.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td>
                      <div className="row gap-2">
                        <Btn size="sm" icon="edit" onClick={() => ctx.goBuilder(s.id)}>
                          Edit
                        </Btn>
                        <Btn
                          size="sm"
                          icon={s.status === 'live' ? 'x' : 'play'}
                          onClick={() => togglePublish(s)}
                        >
                          {s.status === 'live' ? 'Unpublish' : 'Publish'}
                        </Btn>
                        <Btn size="sm" icon="chart" onClick={() => ctx.goLive(s.id)}>
                          Live
                        </Btn>
                        <Btn size="sm" variant="ghost" icon="trash" onClick={() => removeSurvey(s)}>
                          {''}
                        </Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
