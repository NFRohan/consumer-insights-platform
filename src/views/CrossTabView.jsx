import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Btn, Card, Chip, Empty, fmt } from '../components/index.js';
import {
  OPERATORS, RESPONSE_FIELDS, filterResponseIds, emptyFilter, newClause,
} from '../lib/filterClauses.js';

export default function CrossTabView({ ctx }) {
  const [surveys, setSurveys] = useState([]);
  const [surveyId, setSurveyId] = useState(ctx.activeSurveyId || null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [responses, setResponses] = useState([]);
  const [filter, setFilter] = useState(emptyFilter());
  const [partial, setPartial] = useState(false);
  const [rowQ, setRowQ] = useState(null);
  const [colQ, setColQ] = useState(null);

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

  useEffect(() => {
    if (!surveyId) return;
    (async () => {
      const { data: qs } = await supabase
        .from('questions')
        .select('*')
        .eq('survey_id', surveyId)
        .order('position');
      setQuestions(qs || []);
      if ((qs || []).length >= 2) {
        setRowQ(qs[0].id);
        setColQ(qs[1].id);
      } else if ((qs || []).length === 1) {
        setRowQ(qs[0].id);
      }
      const { data: ans, truncated: ansCut } = await supabase
        .from('answers')
        .select('response_id,question_id,value')
        .eq('survey_id', surveyId);
      setAnswers(ans || []);

      // Response attributes (channel, region, status…) are the most
      // useful things to filter by and were not previously loaded.
      const { data: resp, truncated: respCut } = await supabase
        .from('responses')
        .select('id,status,channel,region,language,duration_ms')
        .eq('survey_id', surveyId);
      setResponses(resp || []);

      // The API caps how many rows one call returns. Every count on this
      // screen is derived from these two reads, so a cap that went
      // unmentioned would show a confident total for part of the data.
      setPartial(Boolean(ansCut || respCut));
      setFilter(emptyFilter());
    })();
  }, [surveyId]);

  const valueText = (v) => (Array.isArray(v) ? v.join(', ') : String(v ?? '(empty)'));

  const keptIds = useMemo(
    () => filterResponseIds(responses, answers, filter),
    [responses, answers, filter],
  );

  const matrix = useMemo(() => {
    if (!rowQ || !colQ) return null;
    const byResponse = new Map();
    answers.forEach((a) => {
      if (!keptIds.has(a.response_id)) return;
      let m = byResponse.get(a.response_id);
      if (!m) {
        m = {};
        byResponse.set(a.response_id, m);
      }
      m[a.question_id] = a.value;
    });
    const cells = {};
    const rowSet = new Set();
    const colSet = new Set();
    byResponse.forEach((m) => {
      const rv = valueText(m[rowQ]);
      const cv = valueText(m[colQ]);
      if (m[rowQ] === undefined && m[colQ] === undefined) return;
      rowSet.add(rv);
      colSet.add(cv);
      const key = `${rv}|||${cv}`;
      cells[key] = (cells[key] || 0) + 1;
    });
    const rows = [...rowSet];
    const cols = [...colSet];
    const total = Object.values(cells).reduce((a, b) => a + b, 0);
    const max = Math.max(...Object.values(cells), 1);
    return { rows, cols, cells, total, max };
  }, [answers, rowQ, colQ, keptIds]);

  if (!surveys.length)
    return (
      <div className="view">
        <div className="view-head">
          <div>
            <div className="crumb">Analyze › Cross-tab</div>
            <h1>Cross-tab analysis</h1>
            <div className="desc">Select two questions to cross-tabulate.</div>
          </div>
        </div>
        <Empty title="No data yet" hint="Create a survey & gather some responses." icon="pie" />
      </div>
    );

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="crumb">Analyze › Cross-tab</div>
          <h1>Cross-tab analysis</h1>
          <div className="desc">
            Compare any two questions, filtered to the respondents you care about.
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

      {partial && (
        <div className="alert" data-tone="warn" style={{ marginBottom: 12 }}>
          <strong>Showing part of this survey.</strong> It has more rows than one
          request returns, so the counts below describe the {fmt.num(responses.length)}{' '}
          responses loaded, not the whole survey. Export the full set to analyse it end to end.
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <Card
          title="Filters"
          sub={
            filter.clauses.length
              ? `${fmt.num(keptIds.size)} of ${fmt.num(responses.length)} responses`
              : `all ${fmt.num(responses.length)} responses`
          }
          action={
            <div className="row gap-2">
              {filter.clauses.length > 1 && (
                <select
                  className="select"
                  style={{ width: 88 }}
                  value={filter.combinator}
                  onChange={(e) => setFilter((f) => ({ ...f, combinator: e.target.value }))}
                >
                  <option value="AND">AND</option>
                  <option value="OR">OR</option>
                </select>
              )}
              {filter.clauses.length > 0 && (
                <Btn size="sm" variant="ghost" onClick={() => setFilter(emptyFilter())}>Clear</Btn>
              )}
              <Btn size="sm" icon="plus"
                   onClick={() => setFilter((f) => ({ ...f, clauses: [...f.clauses, newClause()] }))}>
                Add filter
              </Btn>
            </div>
          }
        >
          {filter.clauses.length === 0 ? (
            <div className="small mute">
              No filters — the table below covers every response. Add one to compare a
              subgroup, for example channel is sms, or a particular answer.
            </div>
          ) : (
            <div className="col gap-2">
              {filter.clauses.map((c, i) => (
                <div key={i} className="row gap-2" style={{ alignItems: 'center' }}>
                  <select
                    className="select"
                    style={{ flex: 2 }}
                    value={`${c.source}:${c.field}`}
                    onChange={(e) => {
                      const [source, ...rest] = e.target.value.split(':');
                      const field = rest.join(':');
                      setFilter((f) => ({
                        ...f,
                        clauses: f.clauses.map((x, j) => (j === i ? { ...x, source, field } : x)),
                      }));
                    }}
                  >
                    <optgroup label="Respondent">
                      {RESPONSE_FIELDS.map((rf) => (
                        <option key={rf.id} value={`response:${rf.id}`}>{rf.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Answers">
                      {questions.map((q, qi) => (
                        <option key={q.id} value={`answer:${q.id}`}>
                          Q{qi + 1}: {q.text.slice(0, 44)}
                        </option>
                      ))}
                    </optgroup>
                  </select>

                  <select
                    className="select"
                    style={{ width: 150 }}
                    value={c.op}
                    onChange={(e) => setFilter((f) => ({
                      ...f,
                      clauses: f.clauses.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)),
                    }))}
                  >
                    {OPERATORS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>

                  {!['empty', 'not_empty'].includes(c.op) && (
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      placeholder="value"
                      value={c.value}
                      onChange={(e) => setFilter((f) => ({
                        ...f,
                        clauses: f.clauses.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                      }))}
                    />
                  )}

                  <Btn size="sm" variant="ghost" icon="trash"
                       onClick={() => setFilter((f) => ({
                         ...f, clauses: f.clauses.filter((_, j) => j !== i),
                       }))} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="split-3" style={{ marginBottom: 16 }}>
        <Card title="Rows variable">
          <select className="select" value={rowQ || ''} onChange={(e) => setRowQ(e.target.value)}>
            <option value="">— pick —</option>
            {questions.map((q, i) => (
              <option key={q.id} value={q.id}>
                Q{i + 1}: {q.text.slice(0, 40)}
              </option>
            ))}
          </select>
        </Card>
        <Card title="Columns variable">
          <select className="select" value={colQ || ''} onChange={(e) => setColQ(e.target.value)}>
            <option value="">— pick —</option>
            {questions.map((q, i) => (
              <option key={q.id} value={q.id}>
                Q{i + 1}: {q.text.slice(0, 40)}
              </option>
            ))}
          </select>
        </Card>
        <Card title="Sample">
          <div className="stat-value">{matrix?.total ?? 0}</div>
          <div className="stat-delta">Responses included</div>
        </Card>
      </div>

      {matrix && matrix.rows.length > 0 && matrix.cols.length > 0 ? (
        <Card
          title="Matrix · counts (heatmap)"
          sub={`${matrix.rows.length} × ${matrix.cols.length} · base ${fmt.num(keptIds.size)}`
               + (filter.clauses.length ? ` of ${fmt.num(responses.length)} responses` : ' responses')}
        >
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th />
                  {matrix.cols.map((c) => (
                    <th key={c}>{c.slice(0, 28)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((r) => (
                  <tr key={r}>
                    <td style={{ fontWeight: 500 }}>{r.slice(0, 28)}</td>
                    {matrix.cols.map((c) => {
                      const n = matrix.cells[`${r}|||${c}`] || 0;
                      const ratio = n / matrix.max;
                      return (
                        <td key={c}>
                          <div
                            className="heat"
                            style={{
                              background: `color-mix(in oklch, var(--accent) ${Math.round(
                                ratio * 70,
                              )}%, transparent)`,
                              color: ratio > 0.45 ? 'white' : 'var(--ink)',
                            }}
                          >
                            {fmt.num(n)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : rowQ && colQ && filter.clauses.length && keptIds.size === 0 ? (
        <Empty
          icon="filter"
          title="No responses match these filters"
          hint={`All ${fmt.num(responses.length)} responses were excluded. Loosen a filter or switch AND to OR.`}
        />
      ) : (
        <Empty title="Pick two questions" hint="Select row & column variables to build a cross-tab." icon="pie" />
      )}

      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <Chip tone="positive">Excel</Chip>
        <Chip tone="positive">CSV</Chip>
        <Chip tone="accent">SPSS</Chip>
        <Chip>PDF</Chip>
        <Chip>PowerPoint</Chip>
        <span className="small mute">Export formats supported by export pipeline.</span>
      </div>
    </div>
  );
}
