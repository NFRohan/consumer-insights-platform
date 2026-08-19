import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Btn, Chip, Card, Icon, Switch, Empty } from '../components/index.js';
import { QUESTION_TYPES, DEFAULT_LANGUAGES } from '../lib/constants.js';
import { logAudit } from '../lib/audit.js';
import {
  ImportModal,
  LogicModal,
  PipingModal,
  LanguageModal,
  RandomizeModal,
  PublishedModal,
} from './builder/BuilderModals.jsx';

const QTYPE = Object.fromEntries(QUESTION_TYPES.map((q) => [q.id, q]));

function defaultConfigFor(typeId) {
  switch (typeId) {
    case 'single':
    case 'multi':
    case 'dropdown':
      return { options: ['Option A', 'Option B', 'Option C'] };
    case 'matrix':
      return {
        rows: ['Item 1', 'Item 2', 'Item 3'],
        cols: ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'],
      };
    case 'rating':
      return { scale: 5, leftLabel: 'Low', rightLabel: 'High' };
    case 'slider':
      return { min: 0, max: 100, step: 1 };
    case 'rank':
      return { items: ['Faster transfers', 'Lower fees', 'Better security'] };
    case 'text':
      return { placeholder: 'Type your answer…', minChars: 0, maxChars: 500 };
    case 'nps':
      return { scale: 11 };
    case 'fill':
      return { template: 'My favorite color is ___ and I drive a ___.' };
    case 'image-opt':
      return { options: ['🟦', '🟩', '🟧'] };
    case 'video':
      return { url: '' };
    case 'hotspot':
      return { url: '' };
    case 'iat':
      return { stimulus: 'Brand A', options: ['Positive', 'Negative'] };
    case 'audio':
      return { maxSeconds: 60 };
    case 'constant-sum':
      return { items: ['Quality', 'Price', 'Service'], total: 100 };
    default:
      return {};
  }
}

export default function BuilderView({ ctx }) {
  const [survey, setSurvey] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState('content'); // content | logic | language
  const [loading, setLoading] = useState(true);
  const dragIndexRef = useRef(null);

  // Modals
  const [modal, setModal] = useState(null); // 'import' | 'logic' | 'pipe' | 'lang' | 'rand' | 'published'
  const [linkCopied, setLinkCopied] = useState(false);

  const surveyId = ctx.activeSurveyId;

  // The address a respondent opens. Same shape the Distribute screen
  // uses, and the same one the ?d= tracked links are built from.
  // Declared after surveyId, not before: `const` is not hoisted, and
  // reading it early throws on every render rather than reading undefined.
  const publicLink = surveyId ? `${window.location.origin}/r/${surveyId}` : '';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      // Refused clipboard: fall back to the modal, where the link is
      // selectable text rather than a promise that it was copied.
      setModal('published');
    }
  };

  const load = async () => {
    if (!surveyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: s } = await supabase.from('surveys').select('*').eq('id', surveyId).maybeSingle();
    setSurvey(s);
    const { data: qs } = await supabase
      .from('questions')
      .select('*')
      .eq('survey_id', surveyId)
      .order('position', { ascending: true });
    setQuestions(qs || []);
    if ((qs || []).length && !selectedId) setSelectedId(qs[0].id);
    setLoading(false);
  };

  useEffect(() => {
    load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyId]);

  const addQuestion = async (typeId) => {
    if (!surveyId) return;
    const { data, error } = await supabase
      .from('questions')
      .insert({
        survey_id: surveyId,
        position: questions.length,
        type: typeId,
        text: `New ${QTYPE[typeId]?.label.toLowerCase() || typeId} question`,
        config: defaultConfigFor(typeId),
        required: false,
      })
      .select()
      .single();
    if (!error && data) {
      setQuestions((qs) => [...qs, data]);
      setSelectedId(data.id);
    }
  };

  const updateQuestion = async (id, patch, opts = {}) => {
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
    if (!opts.local) {
      await supabase.from('questions').update(patch).eq('id', id);
    }
  };

  const deleteQuestion = async (id) => {
    setQuestions((qs) => qs.filter((q) => q.id !== id));
    await supabase.from('questions').delete().eq('id', id);
  };

  const reorder = async (from, to) => {
    if (from === to) return;
    const next = questions.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setQuestions(next);
    // persist new positions
    const updates = next.map((q, idx) =>
      supabase.from('questions').update({ position: idx }).eq('id', q.id),
    );
    await Promise.all(updates);
  };

  const updateSurvey = async (patch) => {
    setSurvey((s) => ({ ...s, ...patch }));
    await supabase.from('surveys').update(patch).eq('id', surveyId);
  };

  const togglePublish = async () => {
    if (!survey) return;
    const next = survey.status === 'live' ? 'draft' : 'live';
    await updateSurvey({
      status: next,
      published_at: next === 'live' ? new Date().toISOString() : null,
    });
    await logAudit({
      kind: next === 'live' ? 'survey.publish' : 'survey.unpublish',
      ref: surveyId,
      detail: `"${survey.name}" → ${next}`,
    });
    // Publishing is the moment the link starts mattering, so hand it over
    // instead of only swapping the button's label. Unpublishing needs no
    // such screen -- there is nothing to do next.
    if (next === 'live') setModal('published');
  };

  if (!surveyId) {
    return (
      <div className="view">
        <div className="view-head">
          <div>
            <div className="crumb">Build › Builder</div>
            <h1>Survey builder</h1>
            <div className="desc">Open a survey from the Surveys list to start building.</div>
          </div>
        </div>
        <Empty
          title="No survey selected"
          hint="Create or pick a survey first."
          icon="edit"
        />
      </div>
    );
  }

  if (loading) return <div className="view">Loading…</div>;
  if (!survey) return <div className="view">Survey not found.</div>;

  const selected = questions.find((q) => q.id === selectedId);
  const groups = QUESTION_TYPES.reduce((acc, t) => {
    (acc[t.group] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="view" style={{ padding: '14px 18px 30px' }}>
      <div className="view-head">
        <div>
          <div className="crumb">Build › Builder · {survey.name}</div>
          <input
            className="input"
            value={survey.name}
            onChange={(e) => setSurvey({ ...survey, name: e.target.value })}
            onBlur={(e) => updateSurvey({ name: e.target.value })}
            style={{ height: 34, fontSize: 18, fontWeight: 600, border: 'none', padding: 0, background: 'transparent', maxWidth: 520 }}
          />
          <div className="row gap-2 small mute" style={{ marginTop: 4 }}>
            <span className="mono">{survey.id.slice(0, 8)}</span>
            <span>·</span>
            <span>{questions.length} question{questions.length !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>Languages: {(survey.languages || ['en']).join(', ')}</span>
          </div>
        </div>
        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          <Btn icon="download" onClick={() => setModal('import')}>
            Import Word/Excel
          </Btn>
          <Btn icon="logic" onClick={() => setModal('logic')}>
            Skip logic
          </Btn>
          <Btn icon="sparkle" onClick={() => setModal('pipe')}>
            Piping
          </Btn>
          <Btn icon="drag" onClick={() => setModal('rand')}>
            Randomize
          </Btn>
          <Btn icon="translate" onClick={() => setModal('lang')}>
            Languages
          </Btn>
          <Btn icon="eye" onClick={() => window.open(`/r/${surveyId}?preview=1`, '_blank')}>
            Preview
          </Btn>
          {survey.status === 'live' && (
            <Btn icon={linkCopied ? 'check' : 'copy'} onClick={copyLink}
                 title={publicLink}>
              {linkCopied ? 'Copied' : 'Copy link'}
            </Btn>
          )}
          <Btn variant="primary" icon={survey.status === 'live' ? 'x' : 'send'} onClick={togglePublish}>
            {survey.status === 'live' ? 'Unpublish' : 'Publish'}
          </Btn>
        </div>
      </div>

      <div className="builder-grid">
        {/* LEFT — palette */}
        <div className="builder-col">
          <Card title="Add question" sub={`${QUESTION_TYPES.length} types`}>
            <div className="col" style={{ gap: 10 }}>
              {Object.entries(groups).map(([g, items]) => (
                <div key={g}>
                  <div className="tiny mute" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    {g}
                  </div>
                  {items.map((t) => (
                    <button
                      key={t.id}
                      className="q-palette-item"
                      onClick={() => addQuestion(t.id)}
                      title={`Add ${t.label}`}
                    >
                      <div className="q-palette-glyph">{t.glyph}</div>
                      <div className="grow">{t.label}</div>
                      <Icon name="plus" size={12} />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* MIDDLE — canvas */}
        <div className="builder-col">
          {questions.length === 0 ? (
            <Card>
              <Empty title="Your survey is empty" hint="Pick a question type from the left to start." icon="edit" />
            </Card>
          ) : (
            questions.map((q, idx) => (
              <div
                key={q.id}
                className="q-card"
                data-selected={selectedId === q.id ? 'true' : 'false'}
                onClick={() => setSelectedId(q.id)}
                draggable
                onDragStart={() => (dragIndexRef.current = idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => reorder(dragIndexRef.current, idx)}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="q-meta">
                    <Chip tone="ink">{`Q${idx + 1}`}</Chip>
                    <Chip data-kind="qtype">{QTYPE[q.type]?.label || q.type}</Chip>
                    {q.required && <Chip tone="warn">Required</Chip>}
                    {q.logic?.skip && <Chip tone="accent">Skip logic</Chip>}
                  </div>
                  <div className="row gap-2">
                    <button
                      className="btn"
                      data-size="sm"
                      data-variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (idx > 0) reorder(idx, idx - 1);
                      }}
                    >
                      <Icon name="arrow-l" size={12} style={{ transform: 'rotate(90deg)' }} />
                    </button>
                    <button
                      className="btn"
                      data-size="sm"
                      data-variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (idx < questions.length - 1) reorder(idx, idx + 1);
                      }}
                    >
                      <Icon name="arrow-r" size={12} style={{ transform: 'rotate(90deg)' }} />
                    </button>
                    <button
                      className="btn"
                      data-size="sm"
                      data-variant="ghost"
                      title="Duplicate"
                      onClick={async (e) => {
                        e.stopPropagation();
                        const { data: dup } = await supabase
                          .from('questions')
                          .insert({
                            survey_id: surveyId,
                            position: questions.length,
                            type: q.type,
                            text: q.text + ' (copy)',
                            required: q.required,
                            config: q.config || {},
                            logic: q.logic || {},
                          })
                          .select()
                          .single();
                        if (dup) setQuestions((qs) => [...qs, dup]);
                      }}
                    >
                      <Icon name="copy" size={12} />
                    </button>
                    <button
                      className="btn"
                      data-size="sm"
                      data-variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteQuestion(q.id);
                      }}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </div>
                <input
                  className="input"
                  value={q.text}
                  onChange={(e) => updateQuestion(q.id, { text: e.target.value }, { local: true })}
                  onBlur={(e) => updateQuestion(q.id, { text: e.target.value })}
                  style={{ fontSize: 14, fontWeight: 500, height: 34, marginTop: 6 }}
                />
                <QuestionPreview q={q} />
              </div>
            ))
          )}
        </div>

        {/* RIGHT — inspector */}
        <div className="builder-col">
          {selected ? (
            <QuestionInspector
              q={selected}
              questions={questions}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onChange={(patch) => updateQuestion(selected.id, patch)}
              onPatchLocal={(patch) => updateQuestion(selected.id, patch, { local: true })}
            />
          ) : (
            <Card>
              <Empty title="Pick a question" hint="Click a question on the canvas to edit it." icon="edit" />
            </Card>
          )}
          <div style={{ height: 12 }} />
          <Card title="Survey settings">
            <div className="col gap-3">
              <div>
                <label className="label">Description</label>
                <textarea
                  className="textarea"
                  rows={3}
                  value={survey.description || ''}
                  onChange={(e) => setSurvey({ ...survey, description: e.target.value })}
                  onBlur={(e) => updateSurvey({ description: e.target.value })}
                  placeholder="Internal description (not shown to respondents)…"
                />
              </div>
              <div>
                <label className="label">Languages</label>
                <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
                  {DEFAULT_LANGUAGES.map((l) => {
                    const active = (survey.languages || ['en']).includes(l.code);
                    return (
                      <button
                        key={l.code}
                        className="chip"
                        data-tone={active ? 'accent' : undefined}
                        onClick={() => {
                          const cur = new Set(survey.languages || ['en']);
                          if (cur.has(l.code)) cur.delete(l.code);
                          else cur.add(l.code);
                          if (cur.size === 0) cur.add('en');
                          updateSurvey({ languages: Array.from(cur) });
                        }}
                      >
                        {active ? '✓ ' : ''}
                        {l.label}
                      </button>
                    );
                  })}
                </div>
                <div className="small mute" style={{ marginTop: 6 }}>
                  Auto-translate stub — record language per response.
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 500 }}>Block re-submissions</div>
                  <div className="small mute">Same respondent ID or browser cannot submit twice</div>
                </div>
                <Switch on={!!survey.block_resubmission} onChange={(v) => updateSurvey({ block_resubmission: v })} />
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* ===== Modals ===== */}
      {modal === 'published' && (
        <PublishedModal
          link={publicLink}
          questionCount={questions.length}
          onClose={() => setModal(null)}
          onDistribute={() => { setModal(null); ctx.goDistribute?.(surveyId); }}
        />
      )}
      {modal === 'import' && (
        <ImportModal
          onClose={() => setModal(null)}
          onConfirm={async (parsedQs) => {
            // 1) Bulk insert imported questions at end of survey, without skip rules
            //    (we don't yet know the UUIDs that Q1/Q2/... refer to).
            const baseOffset = questions.length;
            const inserts = parsedQs.map((p, i) => {
              const defaults = defaultConfigFor(p.type) || {};
              return {
                survey_id: surveyId,
                position: baseOffset + i,
                type: p.type,
                text: p.text || `Imported question ${i + 1}`,
                required: !!p.required,
                config: { ...defaults, ...(p.config || {}) },
              };
            });
            if (inserts.length === 0) {
              setModal(null);
              return;
            }
            const { data: inserted, error } = await supabase
              .from('questions')
              .insert(inserts)
              .select()
              .order('position', { ascending: true });
            if (error) {
              // eslint-disable-next-line no-console
              console.error('import insert failed', error);
              alert('Import failed: ' + error.message);
              return;
            }

            // 2) Resolve Q1/Q2/... references in skip rules to actual UUIDs.
            //    Q-refs are 1-indexed within the IMPORTED batch, so Q1 = first imported question.
            const refToId = {};
            inserted.forEach((q, i) => {
              refToId[`Q${i + 1}`] = q.id;
            });
            // Also allow refs to existing questions by their global Q-index
            questions.forEach((q, i) => {
              if (!refToId[`Q${i + 1}`]) refToId[`Q${i + 1}_global`] = q.id;
            });

            const updates = [];
            parsedQs.forEach((p, i) => {
              if (!p.logic?.skip) return;
              const target = inserted[i];
              if (!target) return;
              const clauses = p.logic.skip.clauses
                .map((c) => {
                  const id = refToId[c.questionRef];
                  if (!id) return null;
                  return { questionId: id, op: c.op, value: c.value };
                })
                .filter(Boolean);
              if (!clauses.length) return;
              updates.push(
                supabase
                  .from('questions')
                  .update({
                    logic: {
                      skip: { combinator: p.logic.skip.combinator || 'AND', clauses },
                    },
                  })
                  .eq('id', target.id),
              );
            });
            if (updates.length) await Promise.all(updates);

            // 3) Reload to pick up the resolved logic + display new questions
            await load();

            await logAudit({
              kind: 'survey.import',
              ref: surveyId,
              detail: `Imported ${parsedQs.length} questions${updates.length ? ` (${updates.length} with skip rules)` : ''}`,
            });
            setModal(null);
          }}
        />
      )}
      {modal === 'logic' && (
        <LogicModal
          onClose={() => setModal(null)}
          questions={questions}
          initialRules={survey.branding?.logicRules || []}
          onSave={async (rules) => {
            await updateSurvey({ branding: { ...(survey.branding || {}), logicRules: rules } });
            await logAudit({
              kind: 'survey.logic',
              ref: surveyId,
              detail: `Saved ${rules.length} skip logic rule(s)`,
            });
            setModal(null);
          }}
        />
      )}
      {modal === 'pipe' && selected && (
        <PipingModal
          onClose={() => setModal(null)}
          questions={questions}
          initialText={selected.text}
          onSave={async ({ text, fallback }) => {
            await updateQuestion(selected.id, {
              text,
              config: { ...(selected.config || {}), pipingFallback: fallback },
            });
            setModal(null);
          }}
        />
      )}
      {modal === 'lang' && (
        <LanguageModal
          onClose={() => setModal(null)}
          questions={questions}
          initialLanguages={survey.languages || ['en']}
          onSave={async ({ activeLanguages, translations }) => {
            // persist languages on survey + per-question translations
            await updateSurvey({ languages: activeLanguages });
            for (const q of questions) {
              const tx = translations[q.id];
              if (!tx) continue;
              await supabase
                .from('questions')
                .update({ config: { ...(q.config || {}), translations: tx } })
                .eq('id', q.id);
            }
            await logAudit({
              kind: 'survey.translate',
              ref: surveyId,
              detail: `Updated translations for ${activeLanguages.join(', ')}`,
            });
            load();
            setModal(null);
          }}
        />
      )}
      {modal === 'rand' && (
        <RandomizeModal
          onClose={() => setModal(null)}
          questions={questions}
          initial={survey.branding?.randomization || {}}
          onSave={async (rand) => {
            await updateSurvey({
              branding: { ...(survey.branding || {}), randomization: rand },
            });
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

function QuestionInspector({ q, questions, activeTab, setActiveTab, onChange, onPatchLocal }) {
  const cfg = q.config || {};
  const setCfg = (patch) => onPatchLocal({ config: { ...cfg, ...patch } });
  const commitCfg = (patch) => onChange({ config: { ...cfg, ...patch } });

  const updateOption = (i, val) => {
    const arr = [...(cfg.options || [])];
    arr[i] = val;
    setCfg({ options: arr });
  };
  const removeOption = (i) => {
    const arr = [...(cfg.options || [])];
    arr.splice(i, 1);
    commitCfg({ options: arr });
  };
  const addOption = () => commitCfg({ options: [...(cfg.options || []), 'New option'] });

  const pasteFromText = (txt) => {
    const parsed = txt.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (parsed.length > 1) commitCfg({ options: parsed });
  };

  return (
    <Card title="Inspector" sub={q.type}>
      <div className="row gap-2" style={{ marginBottom: 12 }}>
        {['content', 'logic', 'language'].map((t) => (
          <button
            key={t}
            className="chip"
            data-tone={activeTab === t ? 'ink' : undefined}
            onClick={() => setActiveTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {activeTab === 'content' && (
        <div className="col gap-3">
          <div>
            <label className="label">Question text</label>
            <textarea
              className="textarea"
              rows={2}
              value={q.text}
              onChange={(e) => onPatchLocal({ text: e.target.value })}
              onBlur={(e) => onChange({ text: e.target.value })}
            />
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 500 }}>Required</div>
            <Switch on={!!q.required} onChange={(v) => onChange({ required: v })} />
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 500 }}>Reaction time (FR7.7)</div>
              <div className="small mute">Capture millisecond response latency</div>
            </div>
            <Switch
              on={!!cfg.reactionTime}
              onChange={(v) => commitCfg({ reactionTime: v })}
            />
          </div>
          <div>
            <label className="label">Validation (FR7.5)</label>
            <select
              className="select"
              value={cfg.validation || 'none'}
              onChange={(e) => commitCfg({ validation: e.target.value })}
            >
              <option value="none">None</option>
              <option value="int">Numeric only (integer)</option>
              <option value="dec">Numeric only (decimal)</option>
              <option value="date">Date format (DD/MM/YYYY)</option>
              <option value="email">Email</option>
              <option value="char-limit">Character limit (min/max)</option>
            </select>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 500 }}>Anonymity</div>
              <div className="small mute">Strip respondent ID from this question's exports</div>
            </div>
            <Switch on={!!cfg.anonymous} onChange={(v) => commitCfg({ anonymous: v })} />
          </div>

          {(q.type === 'single' || q.type === 'multi' || q.type === 'dropdown' || q.type === 'image-opt') && (
            <div>
              <label className="label">Options</label>
              <div className="col gap-2">
                {(cfg.options || []).map((opt, i) => (
                  <div className="row gap-2" key={i}>
                    <input
                      className="input"
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                      onBlur={() => commitCfg({ options: cfg.options })}
                      onPaste={(e) => {
                        const txt = e.clipboardData.getData('text');
                        if (/[\n,;]/.test(txt)) {
                          e.preventDefault();
                          pasteFromText(txt);
                        }
                      }}
                    />
                    <button className="btn" data-variant="ghost" data-size="sm" onClick={() => removeOption(i)}>
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                ))}
                <Btn size="sm" icon="plus" onClick={addOption}>
                  Add option
                </Btn>
                <div className="small mute">Tip: paste a list (newlines / commas / ; ) to bulk-add.</div>
              </div>
            </div>
          )}

          {q.type === 'rating' && (
            <div className="row gap-2">
              <div className="grow">
                <label className="label">Scale</label>
                <select
                  className="select"
                  value={cfg.scale || 5}
                  onChange={(e) => commitCfg({ scale: Number(e.target.value) })}
                >
                  <option value="3">3-point</option>
                  <option value="5">5-point</option>
                  <option value="7">7-point</option>
                  <option value="10">10-point</option>
                </select>
              </div>
              <div className="grow">
                <label className="label">Left label</label>
                <input
                  className="input"
                  value={cfg.leftLabel || ''}
                  onChange={(e) => setCfg({ leftLabel: e.target.value })}
                  onBlur={() => commitCfg({ leftLabel: cfg.leftLabel })}
                />
              </div>
              <div className="grow">
                <label className="label">Right label</label>
                <input
                  className="input"
                  value={cfg.rightLabel || ''}
                  onChange={(e) => setCfg({ rightLabel: e.target.value })}
                  onBlur={() => commitCfg({ rightLabel: cfg.rightLabel })}
                />
              </div>
            </div>
          )}

          {q.type === 'slider' && (
            <div className="row gap-2">
              <div className="grow">
                <label className="label">Min</label>
                <input
                  className="input"
                  type="number"
                  value={cfg.min ?? 0}
                  onChange={(e) => commitCfg({ min: Number(e.target.value) })}
                />
              </div>
              <div className="grow">
                <label className="label">Max</label>
                <input
                  className="input"
                  type="number"
                  value={cfg.max ?? 100}
                  onChange={(e) => commitCfg({ max: Number(e.target.value) })}
                />
              </div>
              <div className="grow">
                <label className="label">Step</label>
                <input
                  className="input"
                  type="number"
                  value={cfg.step ?? 1}
                  onChange={(e) => commitCfg({ step: Number(e.target.value) })}
                />
              </div>
            </div>
          )}

          {q.type === 'matrix' && (
            <div className="col gap-2">
              <label className="label">Rows (one per line)</label>
              <textarea
                className="textarea"
                value={(cfg.rows || []).join('\n')}
                onChange={(e) => setCfg({ rows: e.target.value.split('\n') })}
                onBlur={() => commitCfg({ rows: (cfg.rows || []).filter(Boolean) })}
                rows={3}
              />
              <label className="label">Columns (one per line)</label>
              <textarea
                className="textarea"
                value={(cfg.cols || []).join('\n')}
                onChange={(e) => setCfg({ cols: e.target.value.split('\n') })}
                onBlur={() => commitCfg({ cols: (cfg.cols || []).filter(Boolean) })}
                rows={3}
              />
            </div>
          )}

          {q.type === 'rank' && (
            <div>
              <label className="label">Items to rank (one per line)</label>
              <textarea
                className="textarea"
                value={(cfg.items || []).join('\n')}
                onChange={(e) => setCfg({ items: e.target.value.split('\n') })}
                onBlur={() => commitCfg({ items: (cfg.items || []).filter(Boolean) })}
                rows={4}
              />
            </div>
          )}

          {q.type === 'text' && (
            <div className="row gap-2">
              <div className="grow">
                <label className="label">Min chars</label>
                <input
                  className="input"
                  type="number"
                  value={cfg.minChars ?? 0}
                  onChange={(e) => commitCfg({ minChars: Number(e.target.value) })}
                />
              </div>
              <div className="grow">
                <label className="label">Max chars</label>
                <input
                  className="input"
                  type="number"
                  value={cfg.maxChars ?? 500}
                  onChange={(e) => commitCfg({ maxChars: Number(e.target.value) })}
                />
              </div>
            </div>
          )}

          {q.type === 'video' && (
            <div>
              <label className="label">Video URL (mp4 / webm)</label>
              <input
                className="input"
                value={cfg.url || ''}
                onChange={(e) => setCfg({ url: e.target.value })}
                onBlur={() => commitCfg({ url: cfg.url })}
                placeholder="https://…"
              />
            </div>
          )}

          {q.type === 'fill' && (
            <div>
              <label className="label">Template (use ___ as blank)</label>
              <textarea
                className="textarea"
                rows={2}
                value={cfg.template || ''}
                onChange={(e) => setCfg({ template: e.target.value })}
                onBlur={() => commitCfg({ template: cfg.template })}
              />
            </div>
          )}

          {q.type === 'constant-sum' && (
            <div className="col gap-2">
              <div>
                <label className="label">Total</label>
                <input
                  className="input"
                  type="number"
                  value={cfg.total ?? 100}
                  onChange={(e) => commitCfg({ total: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="label">Items (one per line)</label>
                <textarea
                  className="textarea"
                  value={(cfg.items || []).join('\n')}
                  onChange={(e) => setCfg({ items: e.target.value.split('\n') })}
                  onBlur={() => commitCfg({ items: (cfg.items || []).filter(Boolean) })}
                  rows={3}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'logic' && (
        <SkipLogicEditor
          q={q}
          questions={questions}
          onChange={(logic) => onChange({ logic })}
        />
      )}

      {activeTab === 'language' && <LanguageEditor q={q} onChange={onChange} />}
    </Card>
  );
}

function SkipLogicEditor({ q, questions, onChange }) {
  const logic = q.logic || {};
  const skip = logic.skip || { combinator: 'AND', clauses: [] };
  const setSkip = (next) => onChange({ ...logic, skip: next });

  const ops = [
    { id: 'eq', label: 'Equals' },
    { id: 'neq', label: 'Does not equal' },
    { id: 'contains', label: 'Contains' },
    { id: 'gt', label: 'Greater than' },
    { id: 'lt', label: 'Less than' },
    { id: 'empty', label: 'Is empty' },
  ];

  const addClause = () => {
    setSkip({
      ...skip,
      clauses: [...skip.clauses, { questionId: questions[0]?.id, op: 'eq', value: '' }],
    });
  };
  const updateClause = (i, patch) => {
    const cls = skip.clauses.slice();
    cls[i] = { ...cls[i], ...patch };
    setSkip({ ...skip, clauses: cls });
  };
  const removeClause = (i) => {
    const cls = skip.clauses.slice();
    cls.splice(i, 1);
    setSkip({ ...skip, clauses: cls });
  };

  return (
    <div className="col gap-3">
      <div className="alert">Show this question only when these conditions match.</div>
      <div className="row gap-2">
        <span className="small mute">Combine with</span>
        <select
          className="select"
          style={{ width: 90 }}
          value={skip.combinator || 'AND'}
          onChange={(e) => setSkip({ ...skip, combinator: e.target.value })}
        >
          <option>AND</option>
          <option>OR</option>
        </select>
      </div>
      <div className="col gap-2">
        {(skip.clauses || []).map((c, i) => (
          <div className="row gap-2" key={i}>
            <select
              className="select"
              style={{ flex: 2 }}
              value={c.questionId || ''}
              onChange={(e) => updateClause(i, { questionId: e.target.value })}
            >
              {questions
                .filter((qq) => qq.id !== q.id)
                .map((qq, idx) => (
                  <option key={qq.id} value={qq.id}>
                    Q{idx + 1}: {qq.text.slice(0, 30)}
                  </option>
                ))}
            </select>
            <select
              className="select"
              style={{ flex: 1 }}
              value={c.op}
              onChange={(e) => updateClause(i, { op: e.target.value })}
            >
              {ops.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className="input"
              style={{ flex: 1 }}
              value={c.value || ''}
              onChange={(e) => updateClause(i, { value: e.target.value })}
              placeholder="value"
            />
            <button className="btn" data-variant="ghost" data-size="sm" onClick={() => removeClause(i)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
      <Btn size="sm" icon="plus" onClick={addClause}>
        Add condition
      </Btn>
      <div className="small mute">
        Piping reference: <span className="mono">{`{{Q1}}`}</span> in any text inserts a previous answer.
      </div>
    </div>
  );
}

function LanguageEditor({ q, onChange }) {
  const tx = q.config?.translations || {};
  const setTx = (lang, val) =>
    onChange({ config: { ...q.config, translations: { ...tx, [lang]: val } } });

  return (
    <div className="col gap-3">
      <div className="alert">Manual translations override auto-translations.</div>
      {DEFAULT_LANGUAGES.map((l) => (
        <div key={l.code}>
          <label className="label">
            {l.label} ({l.code})
          </label>
          <textarea
            className="textarea"
            rows={2}
            placeholder={l.code === 'en' ? q.text : `Translate "${q.text.slice(0, 40)}…"`}
            defaultValue={tx[l.code] || (l.code === 'en' ? q.text : '')}
            onBlur={(e) => setTx(l.code, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

function QuestionPreview({ q }) {
  const cfg = q.config || {};
  switch (q.type) {
    case 'single':
    case 'multi':
    case 'dropdown':
      return (
        <div className="col gap-2" style={{ marginTop: 8 }}>
          {q.type === 'dropdown' ? (
            <select className="select" disabled>
              <option>{(cfg.options || [])[0]}</option>
            </select>
          ) : (
            (cfg.options || []).map((o, i) => (
              <div key={i} className="row gap-2 small">
                <span style={{ width: 14, height: 14, border: '1.5px solid var(--line-strong)', borderRadius: q.type === 'single' ? '50%' : 4 }} />
                {o}
              </div>
            ))
          )}
        </div>
      );
    case 'rating': {
      const n = cfg.scale || 5;
      return (
        <div className="row gap-2" style={{ marginTop: 8 }}>
          {Array.from({ length: n }).map((_, i) => (
            <div key={i} className="scale-btn" style={{ flex: 1, padding: '6px 0', fontSize: 11 }}>
              {i + 1}
            </div>
          ))}
        </div>
      );
    }
    case 'nps':
      return (
        <div className="scale-row" style={{ marginTop: 8 }}>
          {Array.from({ length: 11 }).map((_, i) => (
            <div key={i} className="scale-btn" style={{ padding: '6px 0', fontSize: 11 }}>
              {i}
            </div>
          ))}
        </div>
      );
    case 'matrix':
      return (
        <div style={{ marginTop: 8, overflowX: 'auto' }}>
          <table className="matrix-tbl">
            <thead>
              <tr>
                <th />
                {(cfg.cols || []).map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(cfg.rows || []).slice(0, 3).map((r, i) => (
                <tr key={i}>
                  <td>{r}</td>
                  {(cfg.cols || []).map((_, j) => (
                    <td key={j}>○</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rank':
      return (
        <div className="col gap-2" style={{ marginTop: 8 }}>
          {(cfg.items || []).map((it, i) => (
            <div key={i} className="rank-item small">
              <span className="rank-num">{i + 1}</span>
              <Icon name="drag" size={14} /> {it}
            </div>
          ))}
        </div>
      );
    case 'text':
      return <textarea className="textarea" rows={2} placeholder={cfg.placeholder} disabled style={{ marginTop: 8 }} />;
    case 'slider':
      return <input type="range" min={cfg.min ?? 0} max={cfg.max ?? 100} disabled style={{ width: '100%', marginTop: 12 }} />;
    case 'video':
      return cfg.url ? (
        <video src={cfg.url} style={{ width: '100%', marginTop: 8, borderRadius: 6 }} controls />
      ) : (
        <div className="empty" style={{ padding: 20, marginTop: 6 }}>
          Add a video URL in the inspector.
        </div>
      );
    default:
      return <div className="small mute" style={{ marginTop: 8 }}>Preview not available — appears as configured at runtime.</div>;
  }
}
