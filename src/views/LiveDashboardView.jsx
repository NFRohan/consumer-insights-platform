import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Btn, Card, Chip, Stat, Empty, Sparkline, Funnel, fmt } from '../components/index.js';
import { exportSurveyXlsx } from '../lib/exportXlsx.js';

export default function LiveDashboardView({ ctx }) {
  const [surveys, setSurveys] = useState([]);
  const [surveyId, setSurveyId] = useState(ctx.activeSurveyId || null);
  const [survey, setSurvey] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [responses, setResponses] = useState([]);
  const [recent, setRecent] = useState([]);
  const [perMinute, setPerMinute] = useState([]);
  const [questionStats, setQuestionStats] = useState({});

  useEffect(() => {
    supabase
      .from('surveys')
      .select('id,name,status,audience_count')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setSurveys(data || []);
        if (!surveyId && data?.length) setSurveyId(data[0].id);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = async () => {
    if (!surveyId) return;
    const { data: s } = await supabase.from('surveys').select('*').eq('id', surveyId).maybeSingle();
    setSurvey(s);
    const { data: qs } = await supabase
      .from('questions')
      .select('*')
      .eq('survey_id', surveyId)
      .order('position');
    setQuestions(qs || []);
    const { data: rs } = await supabase
      .from('responses')
      .select('*')
      .eq('survey_id', surveyId)
      .order('created_at', { ascending: false })
      .limit(500);
    setResponses(rs || []);
    setRecent((rs || []).slice(0, 12));
    // bucket per minute (last 30)
    const buckets = new Array(30).fill(0);
    const now = Date.now();
    (rs || []).forEach((r) => {
      const t = new Date(r.created_at).getTime();
      const diff = Math.floor((now - t) / 60000);
      if (diff >= 0 && diff < 30) buckets[29 - diff] += 1;
    });
    setPerMinute(buckets);

    // question-level stats
    const { data: ans } = await supabase.from('answers').select('question_id,value').eq('survey_id', surveyId);
    const stats = {};
    (ans || []).forEach((a) => {
      stats[a.question_id] ??= { total: 0, dist: {} };
      stats[a.question_id].total += 1;
      const v = Array.isArray(a.value) ? a.value.join(', ') : String(a.value ?? '');
      stats[a.question_id].dist[v] = (stats[a.question_id].dist[v] || 0) + 1;
    });
    setQuestionStats(stats);
  };

  useEffect(() => {
    reload(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyId]);

  // realtime subscriptions
  useEffect(() => {
    if (!surveyId) return;
    const ch = supabase
      .channel(`live-${surveyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'responses', filter: `survey_id=eq.${surveyId}` },
        // Polled, not streamed: the tick carries no row, so re-read the
        // window rather than trying to patch state from a delta.
        () => reload(),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'answers', filter: `survey_id=eq.${surveyId}` },
        () => reload(),
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [surveyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const total = responses.length;
    const completed = responses.filter((r) => r.status === 'completed').length;
    const inProgress = responses.filter((r) => r.status === 'in_progress').length;
    const abandoned = total - completed - inProgress;
    const avgDuration =
      completed > 0
        ? Math.round(
            responses.filter((r) => r.duration_ms).reduce((a, r) => a + r.duration_ms, 0) /
              Math.max(1, responses.filter((r) => r.duration_ms).length) /
              1000,
          )
        : 0;
    return { total, completed, inProgress, abandoned, avgDuration };
  }, [responses]);

  const funnel = useMemo(() => {
    const total = responses.length;
    const buckets = [
      { label: 'Survey link clicked', n: total },
    ];
    questions.forEach((q, idx) => {
      buckets.push({
        label: `Q${idx + 1} answered`,
        n: questionStats[q.id]?.total || 0,
      });
    });
    buckets.push({ label: 'Submitted', n: stats.completed });
    return buckets;
  }, [questions, questionStats, stats.completed, responses]);

  if (!surveys.length)
    return (
      <div className="view">
        <div className="view-head">
          <div>
            <div className="crumb">Analyze › Live dashboard</div>
            <h1>Real-time dashboard</h1>
            <div className="desc">Responses tick in live as participants complete the survey.</div>
          </div>
        </div>
        <Empty title="No surveys yet" hint="Create and publish one." icon="chart" />
      </div>
    );

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="crumb">Analyze › Live dashboard</div>
          <h1>Real-time dashboard</h1>
          <div className="desc">
            Live response stream. Refreshes on its own — no need to reload.
          </div>
        </div>
        <div className="row gap-2">
          <Chip tone="positive" pulse>
            Realtime
          </Chip>
          <select
            className="select"
            value={surveyId || ''}
            onChange={(e) => setSurveyId(e.target.value)}
            style={{ width: 280 }}
          >
            {surveys.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.status === 'live' ? '· LIVE' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="split-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Responses (all)"
          value={fmt.num(stats.total)}
          delta={`${stats.inProgress} in progress`}
        />
        <Stat
          label="Completed"
          value={fmt.num(stats.completed)}
          delta={
            stats.total ? `${Math.round((stats.completed / stats.total) * 100)}% completion` : '—'
          }
          deltaTone="positive"
        />
        <Stat label="Abandoned" value={fmt.num(stats.abandoned)} />
        <Stat label="Avg duration" value={`${stats.avgDuration}s`} delta="To completion" />
      </div>

      <div className="split-2-3" style={{ marginBottom: 16 }}>
        <Card title="Per-minute (last 30 min)" sub="Live trend">
          <Sparkline data={perMinute} w={420} h={70} />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <span className="small mute">−30m</span>
            <span className="small mute">now</span>
          </div>
        </Card>
        <Card title="Drop-off funnel" sub={`${questions.length} questions`}>
          <Funnel data={funnel} />
        </Card>
      </div>

      <div className="split-2" style={{ marginBottom: 16 }}>
        <Card title="Live ticker" sub="Most recent">
          {recent.length === 0 ? (
            <Empty title="No responses yet" hint="Open the public link in another tab to test." icon="chart" />
          ) : (
            <div>
              <div
                className="ticker-row"
                style={{ background: 'var(--surface-2)', fontFamily: 'var(--font-mono)', fontSize: 11 }}
              >
                <div>RESPONDENT ID</div>
                <div>CHANNEL</div>
                <div>REGION</div>
                <div>WHEN</div>
                <div>STATUS</div>
              </div>
              {recent.map((r) => (
                <div className="ticker-row" key={r.id}>
                  <div className="mono">{r.respondent_ref || 'anon-' + r.id.slice(0, 6)}</div>
                  <div className="small">{r.channel || '—'}</div>
                  <div className="small">{r.region || '—'}</div>
                  <div className="small mute">
                    {new Date(r.created_at).toLocaleTimeString()}
                  </div>
                  <div>
                    {r.status === 'completed' ? (
                      <Chip tone="positive">✓ Done</Chip>
                    ) : r.status === 'in_progress' ? (
                      <Chip tone="warn">…</Chip>
                    ) : (
                      <Chip>{r.status}</Chip>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Question-level distribution">
          {questions.length === 0 ? (
            <Empty title="No questions" hint="Open the builder to add some." icon="edit" />
          ) : (
            <div className="col gap-3">
              {questions.slice(0, 6).map((q, idx) => {
                const dist = questionStats[q.id]?.dist || {};
                const total = questionStats[q.id]?.total || 0;
                const entries = Object.entries(dist).sort(([, a], [, b]) => b - a).slice(0, 6);
                return (
                  <div key={q.id}>
                    <div className="small" style={{ fontWeight: 500, marginBottom: 4 }}>
                      Q{idx + 1}: {q.text.slice(0, 60)}
                    </div>
                    {entries.length === 0 && (
                      <div className="small mute">No answers yet.</div>
                    )}
                    {entries.map(([k, v]) => {
                      const pct = total ? (v / total) * 100 : 0;
                      return (
                        <div key={k} style={{ marginBottom: 4 }}>
                          <div
                            className="row"
                            style={{ justifyContent: 'space-between', fontSize: 11.5 }}
                          >
                            <span className="mute" title={k}>
                              {k.slice(0, 40) || '(empty)'}
                            </span>
                            <span className="mono">
                              {v} · {pct.toFixed(0)}%
                            </span>
                          </div>
                          <div
                            style={{
                              height: 4,
                              background: 'var(--surface-2)',
                              borderRadius: 2,
                            }}
                          >
                            <div
                              style={{
                                width: `${pct}%`,
                                height: '100%',
                                background: 'var(--accent)',
                                borderRadius: 2,
                                transition: 'width 200ms',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <Btn icon="download" onClick={() => exportCsv(responses, questions, questionStats)}>
          Export CSV
        </Btn>
        <Btn icon="download" variant="accent" onClick={() => exportExcel(survey, questions, responses)}>
          Export Excel
        </Btn>
      </div>
    </div>
  );
}

// The dashboard only holds (question_id, value) for its charts; the
// workbook needs response_id as well to lay out one row per respondent,
// so the full set is fetched on demand rather than kept in memory.
async function exportExcel(survey, questions, responses) {
  if (!survey) return;
  const { data: answers } = await supabase
    .from('answers')
    .select('response_id,question_id,value')
    .eq('survey_id', survey.id);
  exportSurveyXlsx({ survey, questions, responses, answers: answers || [] });
}

function exportCsv(responses, questions, stats) {
  const headers = ['response_id', 'status', 'respondent_id', 'channel', 'created_at'];
  const rows = responses.map((r) => [
    r.id,
    r.status,
    r.respondent_ref || '',
    r.channel || '',
    r.created_at,
  ]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'responses.csv';
  a.click();
  URL.revokeObjectURL(url);
}
