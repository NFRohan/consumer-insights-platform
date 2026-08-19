import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Btn, Card, Chip, Empty, Switch, fmt, Icon } from '../components/index.js';
import { logAudit } from '../lib/audit.js';

const FIELDS = [
  { id: 'duration_ms', label: 'Duration (ms)' },
  { id: 'respondent_ref', label: 'Respondent ID' },
  { id: 'channel', label: 'Channel' },
  { id: 'status', label: 'Status' },
];

const OPS = [
  { id: 'lt', label: 'less than' },
  { id: 'gt', label: 'greater than' },
  { id: 'eq', label: 'equals' },
  { id: 'neq', label: 'not equal' },
  { id: 'contains', label: 'contains' },
  { id: 'startswith', label: 'starts with' },
];

function evalClause(resp, c) {
  const v = resp[c.field];
  switch (c.op) {
    case 'lt': return Number(v) < Number(c.value);
    case 'gt': return Number(v) > Number(c.value);
    case 'eq': return String(v ?? '') === String(c.value ?? '');
    case 'neq': return String(v ?? '') !== String(c.value ?? '');
    case 'contains': return String(v ?? '').toLowerCase().includes(String(c.value ?? '').toLowerCase());
    case 'startswith': return String(v ?? '').toLowerCase().startsWith(String(c.value ?? '').toLowerCase());
    default: return false;
  }
}

export default function CleaningView({ ctx }) {
  const { profile } = useAuth();
  const [surveys, setSurveys] = useState([]);
  const [surveyId, setSurveyId] = useState(ctx.activeSurveyId || null);
  const [rules, setRules] = useState([]);
  const [responses, setResponses] = useState([]);
  const [draft, setDraft] = useState({
    name: '', combinator: 'AND', clauses: [{ field: 'duration_ms', op: 'lt', value: '60000' }], action: 'flag',
  });

  useEffect(() => {
    supabase
      .from('surveys')
      .select('id,name,status')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setSurveys(data || []);
        if (!surveyId && data?.length) setSurveyId(data[0].id);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = async () => {
    if (!surveyId) return;
    const { data: rs } = await supabase
      .from('cleaning_rules')
      .select('*')
      .eq('survey_id', surveyId)
      .order('created_at');
    setRules(rs || []);
    const { data: resp } = await supabase
      .from('responses')
      .select('id,duration_ms,respondent_ref,channel,status')
      .eq('survey_id', surveyId)
      .limit(1000);
    setResponses(resp || []);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [surveyId]);

  const matchCount = (rule) => {
    const cls = rule.condition?.clauses || [];
    if (!cls.length) return 0;
    return responses.filter((r) => {
      const checks = cls.map((c) => evalClause(r, c));
      return rule.condition.combinator === 'OR' ? checks.some(Boolean) : checks.every(Boolean);
    }).length;
  };

  const draftMatch = useMemo(() => {
    return responses.filter((r) => {
      const checks = draft.clauses.map((c) => evalClause(r, c));
      return draft.combinator === 'OR' ? checks.some(Boolean) : checks.every(Boolean);
    }).length;
  }, [draft, responses]);

  const addClause = () => setDraft((d) => ({ ...d, clauses: [...d.clauses, { field: 'respondent_ref', op: 'startswith', value: '' }] }));
  const updateClause = (i, patch) => setDraft((d) => {
    const cls = d.clauses.slice();
    cls[i] = { ...cls[i], ...patch };
    return { ...d, clauses: cls };
  });
  const removeClause = (i) => setDraft((d) => {
    const cls = d.clauses.slice();
    cls.splice(i, 1);
    return { ...d, clauses: cls };
  });

  const saveRule = async () => {
    if (!surveyId || !draft.name.trim()) return;
    const { error } = await supabase.from('cleaning_rules').insert({
      survey_id: surveyId,
      name: draft.name.trim(),
      action: draft.action,
      condition: { combinator: draft.combinator, clauses: draft.clauses },
      created_by: profile?.id,
    });
    if (!error) {
      setDraft({ name: '', combinator: 'AND', clauses: [{ field: 'duration_ms', op: 'lt', value: '60000' }], action: 'flag' });
      reload();
    }
  };

  const runRule = async (rule) => {
    const matched = responses.filter((r) => {
      const checks = (rule.condition?.clauses || []).map((c) => evalClause(r, c));
      return rule.condition.combinator === 'OR' ? checks.some(Boolean) : checks.every(Boolean);
    });
    let updated = 0, deleted = 0;
    if (rule.action === 'delete') {
      const ids = matched.map((m) => m.id);
      if (ids.length) {
        const { count } = await supabase.from('responses').update({ status: 'deleted' }).in('id', ids).select('id', { count: 'exact', head: true });
        deleted = count ?? ids.length;
      }
    } else {
      const ids = matched.map((m) => m.id);
      if (ids.length) {
        const { count } = await supabase.from('responses').update({ status: 'flagged' }).in('id', ids).select('id', { count: 'exact', head: true });
        updated = count ?? ids.length;
      }
    }
    await supabase.from('cleaning_rules').update({
      last_run_at: new Date().toISOString(),
      flagged_count: updated,
      deleted_count: deleted,
    }).eq('id', rule.id);
    await logAudit({
      kind: 'data.clean',
      ref: rule.id,
      detail: `Rule "${rule.name}" → matched ${matched.length}, ${rule.action === 'delete' ? 'deleted' : 'flagged'}`,
    });
    reload();
  };

  const toggleRule = async (rule) => {
    await supabase.from('cleaning_rules').update({ active: !rule.active }).eq('id', rule.id);
    reload();
  };

  const removeRule = async (rule) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    await supabase.from('cleaning_rules').delete().eq('id', rule.id);
    reload();
  };

  if (!surveys.length)
    return (
      <div className="view">
        <div className="view-head">
          <div>
            <div className="crumb">Analyze › Data cleaning</div>
            <h1>Data cleaning rules</h1>
            <div className="desc">Define rules to flag/delete unwanted responses.</div>
          </div>
        </div>
        <Empty title="No surveys yet" hint="Create one first." icon="broom" />
      </div>
    );

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="crumb">Analyze › Data cleaning</div>
          <h1>Data cleaning rules</h1>
          <div className="desc">
            Speeders, straight-liners, test accounts, etc. Run a rule to flag or delete matching
            responses. All cleaning actions are written to the audit log.
          </div>
        </div>
        <select
          className="select"
          value={surveyId || ''}
          onChange={(e) => setSurveyId(e.target.value)}
          style={{ width: 280 }}
        >
          {surveys.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="split-2-3" style={{ alignItems: 'flex-start' }}>
        <Card title="New rule">
          <div className="col gap-3">
            <div>
              <label className="label">Name</label>
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Speeders — finished under 60s" />
            </div>
            <div className="row gap-2">
              <label className="label">Combinator</label>
              <select className="select" style={{ width: 100 }} value={draft.combinator} onChange={(e) => setDraft({ ...draft, combinator: e.target.value })}>
                <option>AND</option>
                <option>OR</option>
              </select>
              <label className="label">Action</label>
              <select className="select" style={{ width: 100 }} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
                <option value="flag">Flag</option>
                <option value="delete">Soft delete</option>
              </select>
            </div>
            <div className="col gap-2">
              {draft.clauses.map((c, i) => (
                <div className="row gap-2" key={i}>
                  <select className="select" style={{ flex: 1 }} value={c.field} onChange={(e) => updateClause(i, { field: e.target.value })}>
                    {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                  <select className="select" style={{ flex: 1 }} value={c.op} onChange={(e) => updateClause(i, { op: e.target.value })}>
                    {OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  <input className="input" style={{ flex: 1 }} value={c.value} onChange={(e) => updateClause(i, { value: e.target.value })} placeholder="value" />
                  <button className="btn" data-variant="ghost" data-size="sm" onClick={() => removeClause(i)}>
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
              <Btn size="sm" icon="plus" onClick={addClause}>Add clause</Btn>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small mute">Would match <strong className="mono">{draftMatch}</strong> responses now.</span>
              <Btn variant="primary" icon="check" onClick={saveRule} disabled={!draft.name.trim()}>Save rule</Btn>
            </div>
          </div>
        </Card>

        <Card title="Active rules" sub={`${rules.length} configured`}>
          {rules.length === 0 ? (
            <Empty title="No rules yet" hint="Define your first cleaning rule." icon="broom" />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Action</th>
                  <th>Matches now</th>
                  <th>Last run</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="row gap-2">
                        <Switch on={!!r.active} onChange={() => toggleRule(r)} />
                        <div>
                          <div style={{ fontWeight: 500 }}>{r.name}</div>
                          <div className="small mute">
                            {(r.condition?.clauses || []).map((c) => `${c.field} ${c.op} ${c.value}`).join(` ${r.condition?.combinator} `)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Chip tone={r.action === 'delete' ? 'danger' : 'warn'}>{r.action}</Chip>
                    </td>
                    <td className="mono">{matchCount(r)}</td>
                    <td className="small mute">{r.last_run_at ? new Date(r.last_run_at).toLocaleString() : '—'}</td>
                    <td>
                      <div className="row gap-2">
                        <Btn size="sm" icon="play" onClick={() => runRule(r)}>Run</Btn>
                        <Btn size="sm" variant="ghost" icon="trash" onClick={() => removeRule(r)}>{''}</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div style={{ height: 16 }} />
      <Card title="Response sample" sub={`${responses.length} responses analyzed (max 1000)`}>
        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          <Chip>completed: {fmt.num(responses.filter((r) => r.status === 'completed').length)}</Chip>
          <Chip tone="warn">in_progress: {fmt.num(responses.filter((r) => r.status === 'in_progress').length)}</Chip>
          <Chip tone="warn">flagged: {fmt.num(responses.filter((r) => r.status === 'flagged').length)}</Chip>
          <Chip tone="danger">deleted: {fmt.num(responses.filter((r) => r.status === 'deleted').length)}</Chip>
        </div>
      </Card>
    </div>
  );
}
