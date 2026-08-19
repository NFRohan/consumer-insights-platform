import React, { useMemo, useRef, useState } from 'react';
import Modal from '../../components/Modal.jsx';
import { Btn, Chip, Icon, ProgressBar } from '../../components/index.js';
import { QUESTION_TYPES } from '../../lib/constants.js';

// The import preview names types the same way the builder does, so a
// file's contents read against the same vocabulary the user just saw.
const QTYPE = Object.fromEntries(QUESTION_TYPES.map((q) => [q.id, q]));

// Heavy libs (xlsx + mammoth) live behind a dynamic import so they don't
// bloat the main app bundle. Loaded lazily the first time the modal needs them.
const loadParser = () => import('../../lib/importParser.js');

// =================== Import Modal ===================
export function ImportModal({ onClose, onConfirm }) {
  const [step, setStep] = useState(1); // 1: input, 2: review
  const [pasted, setPasted] = useState('');
  const [fileMeta, setFileMeta] = useState(null); // { name, size }
  const [parsed, setParsed] = useState([]); // question[]
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  // Paste-text quick parser. Looks for one question per line; if a line
  // contains delimiter-separated text it becomes a single-select question's
  // options under a generated stub text.
  const parsedFromPaste = useMemo(() => {
    if (!pasted.trim()) return [];
    const out = [];
    const lines = pasted.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);
    let pendingQ = null;
    for (const line of lines) {
      // option-like (starts with - / * / •)
      const optMatch = /^\s*[-*•]\s+(.+)$/.exec(line);
      if (optMatch && pendingQ) {
        (pendingQ.config.options ||= []).push(optMatch[1].trim());
        continue;
      }
      // Comma/semicolon delimited list -> question with options
      const tokens = line.split(/[;|]+/).map((s) => s.trim()).filter(Boolean);
      if (tokens.length > 1 && (line.endsWith(';') || /;|\|/.test(line))) {
        if (pendingQ) {
          out.push(pendingQ);
        }
        pendingQ = {
          type: 'single',
          text: 'Untitled question ' + (out.length + 1),
          required: false,
          config: { options: tokens },
        };
        continue;
      }
      if (pendingQ) out.push(pendingQ);
      pendingQ = {
        type: 'text',
        text: line,
        required: false,
        config: {},
      };
    }
    if (pendingQ) out.push(pendingQ);
    return out;
  }, [pasted]);

  const acceptParsed = ({ questions, errors }) => {
    setParsed(questions);
    setErrors(errors);
    setStep(2);
  };

  const handleFile = async (file) => {
    if (!file) return;
    setFileMeta({ name: file.name, size: file.size });
    setBusy(true);
    try {
      const { parseFile } = await loadParser();
      const result = await parseFile(file);
      acceptParsed(result);
    } catch (err) {
      acceptParsed({ questions: [], errors: ['Parse failed: ' + (err?.message || err)] });
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  };

  const handlePasteParse = () => {
    if (!parsedFromPaste.length) {
      setErrors(['Nothing to parse in the textarea.']);
      setParsed([]);
      setStep(2);
      return;
    }
    acceptParsed({ questions: parsedFromPaste, errors: [] });
  };

  return (
    <Modal title="Import questions from Word / Excel" onClose={onClose} width={760}>
      <div className="small mute" style={{ marginBottom: 12 }}>
        Upload a structured .xlsx or .docx and the questions, options and types
        are read out of it — or paste delimited text (line breaks, commas,
        semicolons, pipes). Download the template to see the expected structure.
      </div>
      {step === 1 && (
        <div>
          <div className="row gap-2" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
            <Btn
              icon="download"
              variant="ghost"
              size="sm"
              onClick={async () => {
                const { downloadXlsxTemplate } = await loadParser();
                downloadXlsxTemplate();
              }}
            >
              Mini template (.xlsx)
            </Btn>
            <Btn
              icon="download"
              variant="ghost"
              size="sm"
              onClick={async () => {
                const { downloadDocxTemplate } = await loadParser();
                downloadDocxTemplate();
              }}
            >
              Mini template (.txt)
            </Btn>
            <a
              className="btn"
              data-variant="ghost"
              data-size="sm"
              href="/samples/sample-survey.xlsx"
              download
            >
              <Icon name="download" size={14} />
              Comprehensive sample (.xlsx)
            </a>
            <a
              className="btn"
              data-variant="ghost"
              data-size="sm"
              href="/samples/sample-survey.docx"
              download
            >
              <Icon name="download" size={14} />
              Comprehensive sample (.docx)
            </a>
          </div>
          <div className="tiny mute" style={{ marginBottom: 8 }}>
            The comprehensive samples include all 16 question types and every supported directive — open them, edit, then upload.
          </div>
          <div
            className="card"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            style={{
              padding: 24,
              textAlign: 'center',
              background: 'var(--surface-2)',
              border: '1px dashed var(--line-strong)',
              cursor: 'pointer',
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="download" size={24} />
            <div style={{ marginTop: 8, fontSize: 13, fontWeight: 500 }}>
              {fileMeta ? `Selected: ${fileMeta.name}` : 'Click here or drop a .xlsx / .docx / .csv file'}
            </div>
            <div className="tiny mute" style={{ marginTop: 4 }}>
              Excel (.xlsx, .xls, .csv) — tabular template · Word (.docx) — tagged paragraphs
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xlsm,.xls,.csv,.docx"
              style={{ display: 'none' }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>
          <div style={{ marginTop: 16 }}>
            <label className="label">Or paste here</label>
            <textarea
              className="textarea"
              rows={5}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={'How often do you shop with us?\n- Daily\n- Weekly\n- Monthly\n\nDaily; Weekly; Monthly; Rarely;'}
            />
            <div className="tiny mute" style={{ marginTop: 4 }}>
              Lines starting with <span className="mono">-</span> become options of the previous question. A line ending with <span className="mono">;</span> becomes a single-select question's options.
            </div>
          </div>
          <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8 }}>
            <Btn variant="ghost" onClick={onClose}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handlePasteParse} disabled={busy || !pasted.trim()}>
              {busy ? 'Parsing…' : 'Parse pasted text →'}
            </Btn>
          </div>
        </div>
      )}
      {step === 2 && (
        <div>
          <div className="row gap-2" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
            {parsed.length > 0 ? (
              <Chip tone="positive">{parsed.length} question{parsed.length !== 1 ? 's' : ''} parsed</Chip>
            ) : (
              <Chip tone="danger">0 questions</Chip>
            )}
            {errors.length > 0 && <Chip tone="warn">{errors.length} warning{errors.length !== 1 ? 's' : ''}</Chip>}
            {fileMeta && <Chip>{fileMeta.name}</Chip>}
          </div>
          {errors.length > 0 && (
            <div className="alert" data-tone="warn" style={{ marginBottom: 10 }}>
              <strong>Warnings</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                {errors.slice(0, 6).map((e, i) => (
                  <li key={i} className="small">{e}</li>
                ))}
                {errors.length > 6 && <li className="small mute">…and {errors.length - 6} more</li>}
              </ul>
            </div>
          )}
          <div className="card" style={{ padding: 12, maxHeight: 320, overflow: 'auto' }}>
            {parsed.map((q, i) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="row gap-2" style={{ marginBottom: 3 }}>
                  <Chip tone="ink">Q{i + 1}</Chip>
                  <Chip data-kind="qtype">{QTYPE[q.type]?.label || q.type}</Chip>
                  {q.required && <Chip tone="warn">Required</Chip>}
                </div>
                <div style={{ fontSize: 13 }}>{q.text}</div>
                {q.config?.options && (
                  <div className="tiny mute mono" style={{ marginTop: 3 }}>
                    options: {q.config.options.join(' · ')}
                  </div>
                )}
                {q.config?.items && (
                  <div className="tiny mute mono" style={{ marginTop: 3 }}>
                    items: {q.config.items.join(' · ')}
                  </div>
                )}
                {q.config?.rows && (
                  <div className="tiny mute mono" style={{ marginTop: 3 }}>
                    rows: {q.config.rows.join(' · ')}
                  </div>
                )}
                {q.config?.cols && (
                  <div className="tiny mute mono" style={{ marginTop: 3 }}>
                    cols: {q.config.cols.join(' · ')}
                  </div>
                )}
                {(q.config?.scale || q.config?.min != null || q.config?.max != null || q.config?.total != null) && (
                  <div className="tiny mute mono" style={{ marginTop: 3 }}>
                    {q.config.scale ? `scale: ${q.config.scale}` : ''}
                    {q.config.min != null ? `  min: ${q.config.min}` : ''}
                    {q.config.max != null ? `  max: ${q.config.max}` : ''}
                    {q.config.total != null ? `  total: ${q.config.total}` : ''}
                  </div>
                )}
                {q.config?.url && (
                  <div className="tiny mute mono" style={{ marginTop: 3 }}>
                    url: {q.config.url}
                  </div>
                )}
                {q.config?.randomize && (
                  <div className="tiny" style={{ marginTop: 3 }}>
                    <Chip tone="accent">randomize: {String(q.config.randomize)}</Chip>
                  </div>
                )}
                {q.config?.pipingFallback && (
                  <div className="tiny" style={{ marginTop: 3 }}>
                    <Chip tone="accent">piping fallback: "{q.config.pipingFallback}"</Chip>
                  </div>
                )}
                {q.logic?.skip && (
                  <div className="tiny" style={{ marginTop: 3 }}>
                    <Chip tone="accent">
                      show if{' '}
                      {q.logic.skip.clauses
                        .map((c) => `${c.questionRef} ${c.op} ${c.value || '(empty)'}`)
                        .join(` ${q.logic.skip.combinator || 'AND'} `)}
                    </Chip>
                  </div>
                )}
              </div>
            ))}
            {parsed.length === 0 && (
              <div className="empty">Nothing to import. Go back and try a different file.</div>
            )}
          </div>
          <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
            <Btn variant="ghost" onClick={() => { setStep(1); setErrors([]); setParsed([]); }}>
              ← Back
            </Btn>
            <div className="row gap-2">
              <Btn variant="ghost" onClick={onClose}>
                Cancel
              </Btn>
              <Btn
                variant="primary"
                onClick={() => onConfirm(parsed)}
                disabled={parsed.length === 0}
              >
                Confirm import ({parsed.length})
              </Btn>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// =================== Skip Logic Modal ===================
const OPS = [
  { id: 'eq', label: 'Equals' },
  { id: 'neq', label: 'Does not equal' },
  { id: 'contains', label: 'Contains' },
  { id: 'lte', label: 'Less than or equal to' },
  { id: 'gte', label: 'Greater than or equal to' },
  { id: 'empty', label: 'Is empty' },
];
const ACTIONS = [
  { id: 'skip', label: 'Skip to question…' },
  { id: 'show', label: 'Show question' },
  { id: 'hide', label: 'Hide question' },
  { id: 'end', label: 'End survey' },
];

export function LogicModal({ onClose, questions, initialRules = [], onSave }) {
  const [rules, setRules] = useState(
    initialRules.length
      ? initialRules
      : [
          {
            id: 'r1',
            target: questions[0]?.id || '',
            conditions: [{ q: questions[0]?.id || '', op: 'eq', v: '' }],
            join: 'AND',
            then: 'skip',
          },
        ],
  );

  const updateRule = (id, patch) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addCondition = (id) =>
    updateRule(id, {
      conditions: [
        ...(rules.find((r) => r.id === id)?.conditions || []),
        { q: questions[0]?.id || '', op: 'eq', v: '' },
      ],
    });
  const removeCondition = (id, i) => {
    const r = rules.find((rr) => rr.id === id);
    if (!r) return;
    const next = r.conditions.slice();
    next.splice(i, 1);
    updateRule(id, { conditions: next });
  };
  const updateCondition = (id, i, patch) => {
    const r = rules.find((rr) => rr.id === id);
    if (!r) return;
    const next = r.conditions.slice();
    next[i] = { ...next[i], ...patch };
    updateRule(id, { conditions: next });
  };
  const addRule = () =>
    setRules((rs) => [
      ...rs,
      {
        id: 'r' + (rs.length + 1),
        target: questions[0]?.id || '',
        conditions: [{ q: questions[0]?.id || '', op: 'eq', v: '' }],
        join: 'AND',
        then: 'skip',
      },
    ]);
  const deleteRule = (id) => setRules((rs) => rs.filter((r) => r.id !== id));

  return (
    <Modal title="Skip logic & branching" onClose={onClose} width={780}>
      <div className="small mute" style={{ marginBottom: 12 }}>
        Rules execute top to bottom. Combine conditions with AND / OR. Targets reference question
        IDs.
      </div>
      {rules.map((r, idx) => (
        <div key={r.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 14, marginBottom: 10 }}>
          <div className="row gap-2" style={{ marginBottom: 10, justifyContent: 'space-between' }}>
            <div className="row gap-2">
              <Chip tone="ink">Rule {idx + 1}</Chip>
              <span className="small">If</span>
              <select
                className="select"
                style={{ width: 90 }}
                value={r.join}
                onChange={(e) => updateRule(r.id, { join: e.target.value })}
              >
                <option>AND</option>
                <option>OR</option>
              </select>
            </div>
            <Btn size="sm" variant="ghost" icon="trash" onClick={() => deleteRule(r.id)} />
          </div>
          {r.conditions.map((c, i) => (
            <div key={i} className="row gap-2" style={{ marginBottom: 8 }}>
              {i > 0 && <Chip tone="accent">{r.join}</Chip>}
              <select
                className="select"
                style={{ width: 130 }}
                value={c.q}
                onChange={(e) => updateCondition(r.id, i, { q: e.target.value })}
              >
                {questions.map((q, idx2) => (
                  <option key={q.id} value={q.id}>
                    Q{idx2 + 1}
                  </option>
                ))}
              </select>
              <select
                className="select"
                style={{ width: 200 }}
                value={c.op}
                onChange={(e) => updateCondition(r.id, i, { op: e.target.value })}
              >
                {OPS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                className="input grow"
                value={c.v}
                onChange={(e) => updateCondition(r.id, i, { v: e.target.value })}
                placeholder="value"
              />
              <Btn size="sm" variant="ghost" icon="x" onClick={() => removeCondition(r.id, i)} />
            </div>
          ))}
          <div className="row gap-2" style={{ marginTop: 6, flexWrap: 'wrap' }}>
            <Btn size="sm" icon="plus" onClick={() => addCondition(r.id)}>
              Add condition
            </Btn>
            <span className="small mute">then</span>
            <select
              className="select"
              style={{ width: 220 }}
              value={r.then}
              onChange={(e) => updateRule(r.id, { then: e.target.value })}
            >
              {ACTIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            {(r.then === 'skip' || r.then === 'show' || r.then === 'hide') && (
              <select
                className="select"
                style={{ width: 130 }}
                value={r.target}
                onChange={(e) => updateRule(r.id, { target: e.target.value })}
              >
                {questions.map((q, idx2) => (
                  <option key={q.id} value={q.id}>
                    Q{idx2 + 1}
                  </option>
                ))}
                <option value="end">End survey</option>
              </select>
            )}
          </div>
        </div>
      ))}
      <Btn icon="plus" onClick={addRule}>
        Add rule
      </Btn>
      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>
          Cancel
        </Btn>
        <Btn variant="primary" onClick={() => onSave(rules)}>
          Save logic
        </Btn>
      </div>
    </Modal>
  );
}

// =================== Piping Modal ===================
export function PipingModal({ onClose, questions, initialText = '', onSave }) {
  const [text, setText] = useState(initialText);
  const [fallback, setFallback] = useState('your selected answer');

  const tokens = useMemo(() => {
    const list = questions.map((q, i) => ({ id: `{{Q${i + 1}.answer}}`, label: `Q${i + 1}` }));
    return [
      ...list,
      { id: '{{respondent.firstName}}', label: 'Respondent first name' },
      { id: '{{survey.name}}', label: 'Survey name' },
    ];
  }, [questions]);

  const preview = (() => {
    let out = text || '';
    // Match either {{Q1}} or {{Q1.answer}}/{{Q1.score}}/{{Q1.value}}
    out = out.replace(/{{\s*Q(\d+)(?:\.(?:answer|score|value))?\s*}}/gi, (_, num) => {
      return `[answer to Q${num}]`;
    });
    out = out.replace(/{{\s*respondent\.firstName\s*}}/gi, 'Alex');
    out = out.replace(/{{\s*respondent\.(?:ref|msisdn)\s*}}/gi, 'R-10428');
    out = out.replace(/{{\s*survey\.name\s*}}/gi, 'Q2 Brand Pulse');
    return out;
  })();

  return (
    <Modal title="Piping — insert answers into question text" onClose={onClose} width={620}>
      <div className="small mute" style={{ marginBottom: 12 }}>
        Reference any prior answer using <span className="mono">{'{{Qn.answer}}'}</span>. Provide a
        fallback in case the source was skipped.
      </div>
      <label className="label">Question text</label>
      <textarea
        className="textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Thanks for telling us you use the app {{Q1.answer}}. How likely are you to recommend us?"
      />
      <div className="row gap-2" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        <span className="small mute">Insert:</span>
        {tokens.map((t) => (
          <button
            key={t.id}
            className="chip"
            style={{ cursor: 'pointer' }}
            onClick={() => setText((cur) => cur + ' ' + t.id)}
          >
            {t.id}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        <label className="label">Fallback if source is empty</label>
        <input
          className="input"
          value={fallback}
          onChange={(e) => setFallback(e.target.value)}
        />
      </div>
      <div className="card" style={{ marginTop: 16, padding: 12, background: 'var(--surface-2)' }}>
        <div className="tiny mute" style={{ marginBottom: 4 }}>
          Live preview
        </div>
        <div style={{ fontSize: 13.5 }}>{preview}</div>
      </div>
      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>
          Cancel
        </Btn>
        <Btn variant="primary" onClick={() => onSave({ text, fallback })}>
          Apply piping
        </Btn>
      </div>
    </Modal>
  );
}

// =================== Languages Modal ===================
const SAMPLE_TRANSLATIONS = {
  en: 'How often did you shop with us in the past 30 days?',
  bn: 'গত ৩০ দিনে আপনি কতবার বিল পেমেন্টের জন্য ওয়ালেট ব্যবহার করেছেন?',
  banglish: 'Past 30 days e apni koto bar amader shathe shopping korechen?',
};

export function LanguageModal({ onClose, questions, initialLanguages = ['en', 'bn'], onSave }) {
  const [active, setActive] = useState('bn');
  const [activeLanguages, setActiveLanguages] = useState(initialLanguages);
  const [translations, setTranslations] = useState(() => {
    const init = {};
    questions.forEach((q) => {
      init[q.id] = { en: q.text, ...(q.config?.translations || {}) };
    });
    return init;
  });
  const [questionIdx, setQuestionIdx] = useState(0);

  const langs = [
    { code: 'en', name: 'English', status: 'source' },
    { code: 'bn', name: 'Bangla', status: 'auto-translated', progress: 100 },
    { code: 'banglish', name: 'Banglish', status: 'manual review', progress: 70 },
  ];

  const sample = questions[questionIdx];
  if (!sample)
    return (
      <Modal title="Languages" onClose={onClose} width={760}>
        <div className="empty">No questions yet — add some first.</div>
      </Modal>
    );

  const setT = (qid, code, val) =>
    setTranslations((tx) => ({ ...tx, [qid]: { ...(tx[qid] || {}), [code]: val } }));

  return (
    <Modal title="Languages" onClose={onClose} width={760}>
      <div className="row gap-3" style={{ marginBottom: 16 }}>
        {langs.map((l) => {
          const isActive = active === l.code;
          const enabled = activeLanguages.includes(l.code);
          return (
            <button
              key={l.code}
              onClick={() => setActive(l.code)}
              className="card"
              style={{
                padding: 12,
                textAlign: 'left',
                cursor: 'pointer',
                borderColor: isActive ? 'var(--accent)' : 'var(--line)',
                background: isActive ? 'var(--accent-soft)' : 'var(--surface)',
                flex: 1,
              }}
            >
              <div className="row gap-2" style={{ marginBottom: 4 }}>
                <Chip tone="ink">{l.code.toUpperCase()}</Chip>
                <strong style={{ fontSize: 13 }}>{l.name}</strong>
                <span style={{ marginLeft: 'auto' }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => {
                      e.stopPropagation();
                      setActiveLanguages((cur) =>
                        e.target.checked ? Array.from(new Set([...cur, l.code])) : cur.filter((c) => c !== l.code),
                      );
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </span>
              </div>
              <div
                className="tiny mute"
                style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}
              >
                {l.status}
              </div>
              {l.progress != null && (
                <div style={{ marginTop: 8 }}>
                  <ProgressBar value={l.progress} />
                  <div className="tiny mono mute" style={{ marginTop: 3 }}>
                    {l.progress}% translated
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="card" style={{ padding: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="row gap-2">
            <Chip tone="ink">{`Q${questionIdx + 1}`}</Chip>
            <select
              className="select"
              style={{ width: 240 }}
              value={questionIdx}
              onChange={(e) => setQuestionIdx(Number(e.target.value))}
            >
              {questions.map((q, idx) => (
                <option key={q.id} value={idx}>
                  Q{idx + 1}: {q.text.slice(0, 40)}
                </option>
              ))}
            </select>
          </div>
          <div className="row gap-2">
            <Btn
              size="sm"
              icon="sparkle"
              variant="ghost"
              onClick={() =>
                setT(
                  sample.id,
                  active,
                  active === 'bn'
                    ? SAMPLE_TRANSLATIONS.bn
                    : active === 'banglish'
                    ? SAMPLE_TRANSLATIONS.banglish
                    : sample.text,
                )
              }
            >
              Auto-translate
            </Btn>
          </div>
        </div>
        <label className="label">English (source)</label>
        <div className="card" style={{ padding: 10, background: 'var(--surface-2)', marginBottom: 12 }}>
          <span style={{ fontSize: 13 }}>{sample.text}</span>
        </div>
        <label className="label">{langs.find((l) => l.code === active)?.name}</label>
        <textarea
          className="textarea"
          value={translations[sample.id]?.[active] || ''}
          onChange={(e) => setT(sample.id, active, e.target.value)}
          rows={3}
          placeholder={`Translate to ${active}…`}
        />
      </div>
      <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
        <span className="small mute">
          Respondent's selected language is recorded with each response for analysis.
        </span>
        <div className="row gap-2">
          <Btn variant="ghost" onClick={onClose}>
            Close
          </Btn>
          <Btn
            variant="primary"
            onClick={() => onSave({ activeLanguages, translations })}
          >
            Save translations
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// =================== Randomize Modal ===================
export function RandomizeModal({ onClose, questions, initial = {}, onSave }) {
  const [blockRandomize, setBlockRandomize] = useState(initial.block ?? false);
  const [blockMode, setBlockMode] = useState(initial.blockMode || 'absolute');
  const [optionRandomize, setOptionRandomize] = useState(initial.option ?? false);
  const [perQuestion, setPerQuestion] = useState(initial.perQuestion || {});

  return (
    <Modal title="Randomization & rotation" onClose={onClose} width={620}>
      <div className="small mute" style={{ marginBottom: 14 }}>
        Apply absolute (true random) or dictated (balanced, pacing) rotation at
        block, question or option level.
      </div>
      <div className="col gap-3">
        <div className="card" style={{ padding: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>Block-level: question order</strong>
            <input
              type="checkbox"
              checked={blockRandomize}
              onChange={(e) => setBlockRandomize(e.target.checked)}
            />
          </div>
          <select
            className="select"
            value={blockMode}
            onChange={(e) => setBlockMode(e.target.value)}
            disabled={!blockRandomize}
          >
            <option value="absolute">Absolute rotation (true random)</option>
            <option value="balanced">Dictated — balanced blocks</option>
            <option value="pin">Dictated — pin first &amp; last</option>
          </select>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>Per-question: option order</strong>
            <input
              type="checkbox"
              checked={optionRandomize}
              onChange={(e) => setOptionRandomize(e.target.checked)}
            />
          </div>
          <div className="col gap-2">
            {questions.slice(0, 8).map((q, idx) => (
              <div
                key={q.id}
                className="row gap-2"
                style={{ padding: 6, borderRadius: 4, background: 'var(--surface-2)' }}
              >
                <Chip tone="ink">Q{idx + 1}</Chip>
                <span className="small grow">{q.text.slice(0, 60)}</span>
                <select
                  className="select"
                  style={{ width: 180 }}
                  value={perQuestion[q.id] || 'none'}
                  onChange={(e) =>
                    setPerQuestion((p) => ({ ...p, [q.id]: e.target.value }))
                  }
                >
                  <option value="none">None</option>
                  <option value="random">Random</option>
                  <option value="pin-last">Pin last (e.g. "Other")</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>
          Cancel
        </Btn>
        <Btn
          variant="primary"
          onClick={() =>
            onSave({
              block: blockRandomize,
              blockMode,
              option: optionRandomize,
              perQuestion,
            })
          }
        >
          Save
        </Btn>
      </div>
    </Modal>
  );
}

// =====================================================================
// PublishedModal — what happens the moment a survey goes live.
//
// Publishing used to change the button from "Publish" to "Unpublish" and
// nothing else, which left the one thing you actually need next — the
// link — nowhere on the screen.
// =====================================================================
export function PublishedModal({ link, questionCount, onClose, onDistribute }) {
  const [copied, setCopied] = useState(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('done');
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard access needs a secure context and permission; if it is
      // refused, say so rather than silently appearing to have copied.
      setCopied('unavailable');
    }
  };

  return (
    <Modal title="Your survey is live" onClose={onClose} width={560}>
      <div className="col gap-3">
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <Chip tone="positive" pulse>Live</Chip>
          <span className="small mute">
            Anyone with this link can respond — no account needed.
          </span>
        </div>

        {questionCount === 0 && (
          <div className="alert" data-tone="warn">
            <strong>There are no questions yet.</strong> The link works, but
            anyone opening it will find an empty survey.
          </div>
        )}

        <div>
          <label className="label">Public link</label>
          <div className="row gap-2">
            <input className="input mono" readOnly value={link}
                   onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
            <Btn variant="primary" icon={copied === 'done' ? 'check' : 'copy'} onClick={copy}>
              {copied === 'done' ? 'Copied' : 'Copy'}
            </Btn>
          </div>
          {copied === 'unavailable' && (
            <div className="small mute" style={{ marginTop: 6 }}>
              Your browser blocked the clipboard — select the link above and copy it.
            </div>
          )}
        </div>

        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          <Btn icon="eye" onClick={() => window.open(link, '_blank', 'noopener')}>
            Open it
          </Btn>
          <Btn icon="send" onClick={onDistribute}>
            Send it to people
          </Btn>
          <div className="grow" />
          <Btn variant="ghost" onClick={onClose}>Done</Btn>
        </div>

        <div className="small mute">
          You can copy this link again any time from the Copy link button in
          the builder, or from the Distribute screen.
        </div>
      </div>
    </Modal>
  );
}
