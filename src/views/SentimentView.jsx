import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Card, Chip, Empty, Donut, Stat, fmt } from '../components/index.js';

const POSITIVE_WORDS = ['good','great','love','excellent','amazing','fast','helpful','easy','best','smooth','awesome','happy','perfect','quick','reliable','satisfied'];
const NEGATIVE_WORDS = ['bad','poor','slow','hate','terrible','worst','difficult','confusing','expensive','broken','annoying','unhelpful','disappointed','issue','problem','fail'];

function classify(text) {
  const t = text.toLowerCase();
  let pos = 0, neg = 0;
  POSITIVE_WORDS.forEach((w) => { if (t.includes(w)) pos += 1; });
  NEGATIVE_WORDS.forEach((w) => { if (t.includes(w)) neg += 1; });
  if (pos === neg) return 'neu';
  return pos > neg ? 'pos' : 'neg';
}

function topThemes(texts, n = 6) {
  const counts = {};
  const stop = new Set(['the','a','an','and','or','to','for','of','it','i','is','was','are','this','that','my','in','on','with','at','as','be','have','has','if','but','from','do','not','so','very','really','too','also']);
  texts.forEach((t) => {
    (t.toLowerCase().match(/[a-z']{4,}/g) || []).forEach((w) => {
      if (stop.has(w)) return;
      counts[w] = (counts[w] || 0) + 1;
    });
  });
  return Object.entries(counts).sort(([,a],[,b]) => b - a).slice(0, n);
}

export default function SentimentView({ ctx }) {
  const [surveys, setSurveys] = useState([]);
  const [surveyId, setSurveyId] = useState(ctx.activeSurveyId || null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState([]);

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
        .eq('type', 'text')
        .order('position');
      setQuestions(qs || []);
      if ((qs || []).length) {
        const { data: ans } = await supabase
          .from('answers')
          .select('id,question_id,value,created_at')
          .in('question_id', qs.map((q) => q.id));
        setAnswers(ans || []);
      } else {
        setAnswers([]);
      }
    })();
  }, [surveyId]);

  const items = useMemo(
    () => answers.filter((a) => a.value && typeof a.value === 'string').map((a) => ({
      id: a.id,
      qid: a.question_id,
      text: a.value,
      sentiment: classify(a.value),
      ts: a.created_at,
    })),
    [answers],
  );

  const summary = useMemo(() => {
    const total = items.length || 1;
    const pos = items.filter((i) => i.sentiment === 'pos').length;
    const neg = items.filter((i) => i.sentiment === 'neg').length;
    const neu = total - pos - neg;
    return { total, pos: pos / total, neg: neg / total, neu: neu / total, posN: pos, negN: neg, neuN: neu };
  }, [items]);

  const themes = useMemo(() => topThemes(items.map((i) => i.text), 8), [items]);

  if (!surveys.length)
    return (
      <div className="view">
        <div className="view-head">
          <div>
            <div className="crumb">Analyze › Sentiment</div>
            <h1>Sentiment on open text</h1>
            <div className="desc">Auto-classified themes with positive/negative split.</div>
          </div>
        </div>
        <Empty title="No data" hint="Create a survey & gather text responses." icon="sparkle" />
      </div>
    );

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="crumb">Analyze › Sentiment</div>
          <h1>Sentiment on open text</h1>
          <div className="desc">
            Lightweight keyword-based sentiment classifier on open-text responses (production:
            integrate with a Bangla-aware NLP service).
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

      {questions.length === 0 ? (
        <Empty title="No open-text questions" hint="Add a question of type Open Text to see sentiment." icon="sparkle" />
      ) : items.length === 0 ? (
        <Empty title="No text responses yet" hint="Once respondents submit text answers, sentiment shows here." icon="sparkle" />
      ) : (
        <>
          <div className="split-3" style={{ marginBottom: 16 }}>
            <Stat label="Open-text responses" value={fmt.num(summary.total)} />
            <Stat label="Net positive" value={`${Math.round(summary.pos * 100)}%`} delta={`${summary.posN} responses`} deltaTone="positive" />
            <Stat label="Net negative" value={`${Math.round(summary.neg * 100)}%`} delta={`${summary.negN} responses`} />
          </div>

          <div className="split-2-3" style={{ marginBottom: 16 }}>
            <Card title="Sentiment split">
              <div className="row gap-4" style={{ alignItems: 'center' }}>
                <Donut pos={summary.pos} neu={summary.neu} neg={summary.neg} size={120} />
                <div className="col gap-2">
                  <div className="row gap-2">
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: 'oklch(0.62 0.14 152)' }} />
                    <span className="small">Positive</span>
                    <span className="mono small">{summary.posN}</span>
                  </div>
                  <div className="row gap-2">
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: 'oklch(0.78 0.04 248)' }} />
                    <span className="small">Neutral</span>
                    <span className="mono small">{summary.neuN}</span>
                  </div>
                  <div className="row gap-2">
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: 'oklch(0.58 0.18 25)' }} />
                    <span className="small">Negative</span>
                    <span className="mono small">{summary.negN}</span>
                  </div>
                </div>
              </div>
            </Card>
            <Card title="Top themes" sub="Word frequency">
              <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
                {themes.map(([w, n]) => (
                  <Chip key={w} tone="accent">
                    {w} · {n}
                  </Chip>
                ))}
              </div>
            </Card>
          </div>

          <Card title="Verbatims" sub={`${items.length} responses`}>
            <div className="col gap-2">
              {items.slice(0, 24).map((i) => (
                <div className="row gap-2" key={i.id} style={{ alignItems: 'flex-start' }}>
                  {i.sentiment === 'pos' && <Chip tone="positive">+</Chip>}
                  {i.sentiment === 'neg' && <Chip tone="danger">−</Chip>}
                  {i.sentiment === 'neu' && <Chip>·</Chip>}
                  <div className="grow small">{i.text}</div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
