import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase, setPublicSurvey } from '../lib/supabase.js';
import { Btn, Chip, Icon } from '../components/index.js';

export default function RespondentPage() {
  const { surveyId } = useParams();
  const [params] = useSearchParams();
  // `?ref=` is the current name. msisdn/phone are still accepted so
  // links distributed before the rename keep identifying respondents.
  const initialRef = params.get('ref') || params.get('msisdn') || params.get('phone') || '';
  const channel = params.get('ch') || 'link';
  const distributionId = params.get('d') || null;
  const lang = params.get('lang') || 'en';
  const previewMode = params.get('preview') === '1';

  const [survey, setSurvey] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [responseId, setResponseId] = useState(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  const [respondentRef, setRespondentRef] = useState(initialRef);
  const [needsRef, setNeedsRef] = useState(!initialRef);
  const startedAtRef = useRef(Date.now());
  const stepStartRef = useRef(Date.now());

  // Respondents are anonymous, so requests carry no tenant. Naming the
  // survey lets the API resolve the tenant server-side — and it only
  // does so for a survey that is actually live.
  setPublicSurvey(surveyId);

  // A tracked link carries ?d=<distributionId>. The browser reports only
  // WHICH link was opened; who opened it is derived server-side from the
  // request. This page used to mint and store its own visitor id, which
  // meant the count was ultimately whatever the caller said it was.
  useEffect(() => {
    if (!distributionId) return;
    fetch('/api/public/click', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ distributionId }),
    }).catch(() => { /* tracking must never block a respondent */ });
  }, [distributionId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data: s } = await supabase
        .from('surveys')
        .select('*')
        .eq('id', surveyId)
        .maybeSingle();
      if (!mounted) return;
      setSurvey(s);
      if (!s) {
        setError('Survey not found.');
        setLoading(false);
        return;
      }
      if (s.status !== 'live' && !previewMode) {
        setError('This survey is currently not accepting responses.');
        setLoading(false);
        return;
      }
      const { data: qs } = await supabase
        .from('questions')
        .select('*')
        .eq('survey_id', surveyId)
        .order('position', { ascending: true });
      setQuestions(qs || []);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [surveyId]);

  const beginResponse = async () => {
    if (previewMode) {
      // Preview: don't write anything, just walk through
      setResponseId('preview-' + Date.now());
      setNeedsRef(false);
      startedAtRef.current = Date.now();
      stepStartRef.current = Date.now();
      return;
    }
    if (survey?.block_resubmission && respondentRef) {
      // Respondents cannot read collected responses, so the check runs
      // server-side and returns only a yes/no.
      const blocked = await fetch('/api/public/check-resubmission', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ surveyId, ref: respondentRef }),
      })
        .then((r) => r.json())
        .then((j) => !!j.blocked)
        .catch(() => false);
      if (blocked) {
        setError('Your response has already been recorded for this survey. Thank you!');
        return;
      }
    }
    // Re-verify survey status RIGHT before inserting. If it was unpublished
    // between page load and this click, we'd otherwise get a confusing RLS error.
    const { data: liveCheck, error: checkErr } = await supabase
      .from('surveys')
      .select('status')
      .eq('id', surveyId)
      .maybeSingle();
    if (checkErr || !liveCheck) {
      setError(
        "We couldn't reach this survey right now. Please refresh and try again. " +
          (checkErr?.message || ''),
      );
      return;
    }
    if (liveCheck.status !== 'live') {
      setError('This survey was just closed by the author. No responses are being collected.');
      return;
    }

    // Generate UUID client-side to avoid INSERT+RETURNING.
    // PostgREST's RETURNING * re-checks SELECT policies — anonymous respondents
    // have no SELECT policy on responses (responses_read_auth requires auth.uid()),
    // so .select().single() after insert always fails for anon with error 42501.
    // Providing our own id skips the RETURNING clause entirely.
    const newId = crypto.randomUUID();
    const { error } = await supabase
      .from('responses')
      .insert({
        id: newId,
        survey_id: surveyId,
        respondent_ref: respondentRef || null,
        language: lang,
        channel,
        status: 'in_progress',
      });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('beginResponse insert failed', error);
      const friendly =
        error.code === '42501'
          ? 'This survey is no longer accepting responses. The author may have unpublished it.'
          : `Could not start the survey: ${error.message}`;
      setError(friendly);
      return;
    }
    setResponseId(newId);
    setNeedsRef(false);
    startedAtRef.current = Date.now();
    stepStartRef.current = Date.now();
  };

  // visibility logic from skip rules
  const visibleQuestions = useMemo(() => {
    return questions.filter((q) => {
      const skip = q.logic?.skip;
      if (!skip || !skip.clauses?.length) return true;
      const evaluate = (c) => {
        const v = answers[c.questionId];
        const ans = Array.isArray(v) ? v.join(',') : v;
        switch (c.op) {
          case 'eq':
            return String(ans ?? '') === String(c.value ?? '');
          case 'neq':
            return String(ans ?? '') !== String(c.value ?? '');
          case 'contains':
            return String(ans ?? '').includes(String(c.value ?? ''));
          case 'gt':
            return Number(ans) > Number(c.value);
          case 'lt':
            return Number(ans) < Number(c.value);
          case 'gte':
            return Number(ans) >= Number(c.value);
          case 'lte':
            return Number(ans) <= Number(c.value);
          case 'empty':
            return ans === undefined || ans === null || ans === '';
          case 'not_empty':
            return ans !== undefined && ans !== null && ans !== '';
          default:
            return true;
        }
      };
      const ok = skip.combinator === 'OR' ? skip.clauses.some(evaluate) : skip.clauses.every(evaluate);
      return ok;
    });
  }, [questions, answers]);

  // ------- randomization -------
  // Apply config.randomize and survey.branding.randomization.perQuestion
  // values: true | 'random' | 'pin-last'. Shuffle ONCE per session per question.
  const shuffledFor = useMemo(() => {
    const map = {};
    const surveyRand = survey?.branding?.randomization || {};
    const globalOption = !!surveyRand.option;
    questions.forEach((q) => {
      const cfg = q.config || {};
      const perQ = surveyRand.perQuestion?.[q.id] || cfg.randomize;
      const optionTypes = ['single', 'multi', 'dropdown', 'image-opt'];
      const items =
        q.type === 'rank' ? cfg.items
          : q.type === 'matrix' ? cfg.rows
            : optionTypes.includes(q.type) ? cfg.options
              : null;
      if (!items || items.length < 2) return;
      const shouldRandom =
        perQ === true ||
        perQ === 'random' ||
        (globalOption && optionTypes.includes(q.type));
      const shouldPinLast = perQ === 'pin-last';
      if (!shouldRandom && !shouldPinLast) return;
      const arr = items.slice();
      let pinned = null;
      if (shouldPinLast) pinned = arr.pop();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      if (pinned !== null) arr.push(pinned);
      map[q.id] = arr;
    });
    return map;
  }, [questions, survey]);

  // a question with its options/rows/items rewritten if shuffled
  const displayQuestion = (q) => {
    if (!q) return q;
    const shuffled = shuffledFor[q.id];
    if (!shuffled) return q;
    const cfg = { ...(q.config || {}) };
    if (q.type === 'rank') cfg.items = shuffled;
    else if (q.type === 'matrix') cfg.rows = shuffled;
    else cfg.options = shuffled;
    return { ...q, config: cfg };
  };

  const current = displayQuestion(visibleQuestions[step]);

  // Substitute piping tokens. Supports:
  //   {{Q1}}, {{Q1.answer}}, {{Q1.score}}, {{Q1.value}} → respondent's answer to Qn
  //   {{respondent.firstName}}, {{respondent.ref}}  → respondent metadata
  //   {{survey.name}}                                  → survey name
  // If the source answer is empty, falls back to the question's
  // config.pipingFallback (set in the Piping modal) or empty string.
  const pipe = (text) => {
    if (!text) return text;
    return text
      .replace(/{{\s*Q(\d+)(?:\.(?:answer|score|value))?\s*}}/gi, (_, num) => {
        const idx = Number(num) - 1;
        const q = questions[idx];
        if (!q) return '';
        const v = answers[q.id];
        const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
        if (empty) {
          // prefer the current question's fallback if set, else the source's
          const fb = current?.config?.pipingFallback || q.config?.pipingFallback || '';
          return fb;
        }
        if (Array.isArray(v)) return v.join(', ');
        if (typeof v === 'object') return Object.values(v).join(', ');
        return String(v);
      })
      .replace(/{{\s*respondent\.firstName\s*}}/gi, () => {
        // no name is collected, so there is nothing to substitute
        return '';
      })
      .replace(/{{\s*respondent\.(?:ref|msisdn)\s*}}/gi, () => respondentRef || '')
      .replace(/{{\s*survey\.name\s*}}/gi, () => survey?.name || '');
  };

  const setAnswer = (qid, value) => {
    setAnswers((a) => ({ ...a, [qid]: value }));
  };

  const persistAnswer = async (q, value) => {
    if (!responseId || previewMode) return;
    const reaction_ms = Date.now() - stepStartRef.current;
    // Saved through the public endpoint: the upsert's conflict path
    // needs read access that anonymous respondents must not have.
    await fetch('/api/public/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        responseId,
        questionId: q.id,
        surveyId,
        value: value === undefined ? null : value,
        reactionMs: reaction_ms,
      }),
    }).catch(() => { /* a dropped answer must not break the flow */ });
  };

  const goNext = async () => {
    if (current) {
      await persistAnswer(current, answers[current.id]);
    }
    if (step >= visibleQuestions.length - 1) {
      if (!previewMode) {
        await supabase
          .from('responses')
          .update({
            status: 'completed',
            submitted_at: new Date().toISOString(),
            duration_ms: Date.now() - startedAtRef.current,
          })
          .eq('id', responseId);
      }
      setSubmitted(true);
    } else {
      stepStartRef.current = Date.now();
      setStep((s) => s + 1);
    }
  };

  const goPrev = () => {
    if (step > 0) {
      stepStartRef.current = Date.now();
      setStep((s) => s - 1);
    }
  };

  if (loading) {
    return (
      <div className="respondent-shell">
        <div className="respondent-card">
          <div className="empty">Loading survey…</div>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="respondent-shell">
        <div className="respondent-card">
          <h2>Hi there 👋</h2>
          <div className="alert" data-tone="warn" style={{ marginTop: 12 }}>
            {error}
          </div>
        </div>
      </div>
    );
  }

  // brand
  const branding = survey?.branding || {};
  // `accentOverride` is null unless the survey explicitly set a color.
  // We use it to (a) inject a CSS-variable override on the shell only when
  // there's something real to set, avoiding `--accent: var(--accent)` recursion,
  // and (b) fall back to `var(--accent)` (resolved at the :root) for inline
  // styles when no override exists.
  const accentOverride = typeof branding.accent === 'string' && branding.accent.trim()
    ? branding.accent.trim()
    : null;
  const accent = accentOverride || 'var(--accent)';
  const shellStyle = accentOverride ? { '--accent': accentOverride } : undefined;
  const customCss = branding.css || '';

  if (submitted) {
    return (
      <div className="respondent-shell" style={shellStyle}>
        {previewMode && <PreviewBanner />}
        <div className="respondent-card" style={{ textAlign: 'center' }}>
          {branding.logoUrl && <img src={branding.logoUrl} alt="" style={{ height: 32, marginBottom: 14 }} />}
          <div style={{ fontSize: 38, marginBottom: 6 }}>✅</div>
          <h2>{previewMode ? 'Preview complete' : 'Thank you!'}</h2>
          <p className="mute" style={{ fontSize: 14 }}>
            {previewMode
              ? 'No response was saved (this is a preview run).'
              : 'Your response has been recorded. We appreciate your time.'}
          </p>
        </div>
        <style>{customCss}</style>
      </div>
    );
  }

  if (needsRef || !responseId) {
    return (
      <div className="respondent-shell" style={shellStyle}>
        {previewMode && <PreviewBanner />}
        <div className="respondent-card">
          {branding.logoUrl && <img src={branding.logoUrl} alt="" style={{ height: 32, marginBottom: 12 }} />}
          <div className="question-num">Welcome</div>
          <h2>{survey?.name || 'Survey'}</h2>
          {branding.tagline && <p className="mute">{branding.tagline}</p>}
          {survey?.description && <p className="small mute">{survey.description}</p>}
          <div style={{ marginTop: 18 }}>
            <label className="label">Respondent ID (optional)</label>
            <input
              className="input"
              value={respondentRef}
              onChange={(e) => setRespondentRef(e.target.value)}
              placeholder="e.g. your reference or email"
            />
            <div className="small mute" style={{ marginTop: 6 }}>
              Used to confirm completion and prevent duplicate submissions. Skip if anonymous.
            </div>
          </div>
          <div className="row" style={{ marginTop: 18, gap: 8 }}>
            <Chip>{questions.length} questions</Chip>
            <Chip tone="accent">~{Math.max(1, Math.round(questions.length * 0.5))} min</Chip>
          </div>
          <div style={{ marginTop: 18 }}>
            <Btn variant="primary" size="lg" iconRight="arrow-r" onClick={beginResponse} style={{ background: accent, borderColor: accent, width: '100%' }}>
              Start survey
            </Btn>
          </div>
        </div>
        <style>{customCss}</style>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="respondent-shell">
        <div className="respondent-card">
          <h2>No questions to show.</h2>
        </div>
      </div>
    );
  }

  const total = visibleQuestions.length;
  const answer = answers[current.id];
  const canProceed = !current.required || hasAnswer(current, answer);

  return (
    <div className="respondent-shell" style={shellStyle}>
      {previewMode && <PreviewBanner />}
      <div style={{ width: '100%', maxWidth: 620, padding: '0 4px' }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <div className="row gap-2">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="" style={{ height: 22 }} />
            ) : (
              <div className="brand-mark" />
            )}
            <span className="small mute">{survey?.name}</span>
          </div>
          <div className="small mute mono">
            {step + 1} / {total}
          </div>
        </div>
        <div className="progress">
          <div className="progress-fill" style={{ width: `${((step + 1) / total) * 100}%`, background: accent }} />
        </div>
      </div>

      <div className="respondent-card">
        <div className="question-num">
          Question {step + 1}
          {current.required && <span style={{ color: 'var(--danger)' }}> · required</span>}
        </div>
        <div className="qtext">{pipe(current.text)}</div>

        <QuestionInput question={current} value={answer} onChange={(v) => setAnswer(current.id, v)} />

        <div className="row" style={{ marginTop: 22, justifyContent: 'space-between' }}>
          <Btn icon="arrow-l" disabled={step === 0} onClick={goPrev}>
            Previous
          </Btn>
          <Btn
            variant="primary"
            iconRight="arrow-r"
            onClick={goNext}
            disabled={!canProceed}
            style={{ background: accent, borderColor: accent }}
          >
            {step === total - 1 ? 'Submit' : 'Next'}
          </Btn>
        </div>
      </div>
      <style>{customCss}</style>
    </div>
  );
}

function PreviewBanner() {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 620,
        marginBottom: 8,
        padding: '8px 14px',
        background: 'oklch(0.95 0.04 70)',
        border: '1px solid oklch(0.78 0.14 70)',
        borderRadius: 8,
        color: 'oklch(0.40 0.13 70)',
        fontSize: 12.5,
        textAlign: 'center',
      }}
    >
      <strong>Preview mode</strong> — no responses are saved. Close this tab when done.
    </div>
  );
}

function hasAnswer(q, v) {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return String(v).length > 0;
}

function QuestionInput({ question, value, onChange }) {
  const cfg = question.config || {};
  switch (question.type) {
    case 'single':
      return (
        <div className="col gap-2">
          {(cfg.options || []).map((o, i) => (
            <button
              key={i}
              className="option"
              type="button"
              data-selected={value === o ? 'true' : 'false'}
              onClick={() => onChange(o)}
            >
              <span className="radio" />
              <span>{o}</span>
            </button>
          ))}
        </div>
      );
    case 'multi': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <div className="col gap-2">
          {(cfg.options || []).map((o, i) => {
            const selected = arr.includes(o);
            return (
              <button
                key={i}
                type="button"
                className="option"
                data-selected={selected ? 'true' : 'false'}
                onClick={() => onChange(selected ? arr.filter((x) => x !== o) : [...arr, o])}
              >
                <span className="checkbox">
                  {selected && <Icon name="check" size={11} />}
                </span>
                <span>{o}</span>
              </button>
            );
          })}
        </div>
      );
    }
    case 'dropdown':
      return (
        <select className="select" value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— choose —</option>
          {(cfg.options || []).map((o, i) => (
            <option key={i} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'rating': {
      const n = cfg.scale || 5;
      return (
        <div>
          <div className="row gap-2" style={{ marginBottom: 6 }}>
            {Array.from({ length: n }).map((_, i) => (
              <button
                key={i}
                type="button"
                className="scale-btn"
                style={{ flex: 1 }}
                data-selected={value === i + 1 ? 'true' : 'false'}
                onClick={() => onChange(i + 1)}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small mute">{cfg.leftLabel}</span>
            <span className="small mute">{cfg.rightLabel}</span>
          </div>
        </div>
      );
    }
    case 'nps':
      return (
        <div>
          <div className="scale-row">
            {Array.from({ length: 11 }).map((_, i) => (
              <button
                key={i}
                type="button"
                className="scale-btn"
                data-selected={value === i ? 'true' : 'false'}
                onClick={() => onChange(i)}
              >
                {i}
              </button>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <span className="small mute">Not at all likely</span>
            <span className="small mute">Extremely likely</span>
          </div>
        </div>
      );
    case 'slider': {
      const min = cfg.min ?? 0;
      const max = cfg.max ?? 100;
      const step = cfg.step ?? 1;
      const v = value ?? Math.round((min + max) / 2);
      return (
        <div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={v}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small mute">{min}</span>
            <strong>{v}</strong>
            <span className="small mute">{max}</span>
          </div>
        </div>
      );
    }
    case 'matrix': {
      const rows = cfg.rows || [];
      const cols = cfg.cols || [];
      const v = (value && typeof value === 'object') ? value : {};
      return (
        <div style={{ overflowX: 'auto' }}>
          <table className="matrix-tbl">
            <thead>
              <tr>
                <th />
                {cols.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  <td>{r}</td>
                  {cols.map((c, ci) => (
                    <td key={ci}>
                      <input
                        type="radio"
                        name={`m-${question.id}-${ri}`}
                        checked={v[r] === c}
                        onChange={() => onChange({ ...v, [r]: c })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'rank': {
      const items = Array.isArray(value) && value.length === (cfg.items || []).length ? value : cfg.items || [];
      const move = (from, to) => {
        const next = items.slice();
        const [m] = next.splice(from, 1);
        next.splice(to, 0, m);
        onChange(next);
      };
      return (
        <div className="col gap-2">
          {items.map((it, i) => (
            <div
              key={it}
              className="rank-item"
              draggable
              onDragStart={(e) => e.dataTransfer.setData('idx', i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => move(Number(e.dataTransfer.getData('idx')), i)}
            >
              <span className="rank-num">{i + 1}.</span>
              <Icon name="drag" size={14} />
              <span className="grow">{it}</span>
              <div className="row gap-2">
                <button
                  className="btn"
                  data-size="sm"
                  data-variant="ghost"
                  type="button"
                  onClick={() => i > 0 && move(i, i - 1)}
                >
                  ↑
                </button>
                <button
                  className="btn"
                  data-size="sm"
                  data-variant="ghost"
                  type="button"
                  onClick={() => i < items.length - 1 && move(i, i + 1)}
                >
                  ↓
                </button>
              </div>
            </div>
          ))}
        </div>
      );
    }
    case 'text':
      return (
        <textarea
          className="textarea"
          rows={4}
          maxLength={cfg.maxChars || 1000}
          minLength={cfg.minChars || 0}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={cfg.placeholder || ''}
        />
      );
    case 'video':
      return (
        <div>
          {cfg.url ? (
            <video src={cfg.url} controls style={{ width: '100%', borderRadius: 8 }} />
          ) : (
            <div className="alert" data-tone="warn">
              No video attached.
            </div>
          )}
          <textarea
            className="textarea"
            rows={3}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Your reaction…"
            style={{ marginTop: 10 }}
          />
        </div>
      );
    case 'image-opt':
      return (
        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          {(cfg.options || []).map((o, i) => (
            <button
              key={i}
              type="button"
              className="option"
              data-selected={value === o ? 'true' : 'false'}
              onClick={() => onChange(o)}
              style={{ minWidth: 100, justifyContent: 'center', fontSize: 28 }}
            >
              {o}
            </button>
          ))}
        </div>
      );
    case 'fill':
      return (
        <div>
          <div className="qtext" style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink-soft)' }}>
            {cfg.template}
          </div>
          <input
            className="input"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Type your answer (comma-separated for multiple blanks)"
          />
        </div>
      );
    case 'iat':
      return (
        <div>
          <div className="alert">
            React quickly: which best describes <strong>{cfg.stimulus}</strong>?
          </div>
          <div className="row gap-2" style={{ marginTop: 10 }}>
            {(cfg.options || []).map((o, i) => (
              <button
                key={i}
                type="button"
                className="option"
                data-selected={value === o ? 'true' : 'false'}
                onClick={() => onChange(o)}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      );
    case 'audio':
      return (
        <div>
          <div className="alert">Audio recording requires microphone access. (Stub for demo.)</div>
          <textarea
            className="textarea"
            rows={3}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="(Transcript fallback) Type your answer…"
            style={{ marginTop: 8 }}
          />
        </div>
      );
    case 'constant-sum': {
      const items = cfg.items || [];
      const total = cfg.total ?? 100;
      const v = value && typeof value === 'object' ? value : {};
      const sum = Object.values(v).reduce((a, b) => a + Number(b || 0), 0);
      return (
        <div className="col gap-2">
          {items.map((it, i) => (
            <div className="row gap-2" key={i}>
              <span className="small grow">{it}</span>
              <input
                type="number"
                className="input"
                style={{ width: 100 }}
                min={0}
                max={total}
                value={v[it] || 0}
                onChange={(e) => onChange({ ...v, [it]: Number(e.target.value) || 0 })}
              />
            </div>
          ))}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small mute">Total {total}</span>
            <strong style={{ color: sum === total ? 'var(--positive)' : sum > total ? 'var(--danger)' : 'var(--ink)' }}>{sum}</strong>
          </div>
        </div>
      );
    }
    case 'hotspot':
      return cfg.url ? (
        <img src={cfg.url} alt="" onClick={(e) => {
          const r = e.target.getBoundingClientRect();
          onChange({ x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) });
        }} style={{ maxWidth: '100%', cursor: 'crosshair', borderRadius: 8, border: '1px solid var(--line)' }} />
      ) : (
        <div className="alert" data-tone="warn">No image attached.</div>
      );
    default:
      return <div className="alert" data-tone="warn">Unsupported question type: {question.type}</div>;
  }
}
