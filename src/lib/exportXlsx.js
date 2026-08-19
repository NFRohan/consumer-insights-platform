// =====================================================================
// Excel export.
//
// Uses SheetJS, which the importer already depends on, so this adds no
// new package.
//
// Three sheets, because a single flat dump is not what an analyst
// actually opens the file for:
//
//   Responses — one row per respondent, one column per question, which
//               is the shape a pivot table expects.
//   Codebook  — question text, type and options, so the column headers
//               in Responses can be interpreted six months later.
//   Summary   — per-question frequency counts, so the file is useful
//               before anyone builds a pivot at all.
// =====================================================================


const stamp = () => new Date().toISOString().slice(0, 10);

/** Turn one stored answer into something a spreadsheet cell can hold. */
export function formatAnswer(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'object') {
    // matrix { row: col } and constant-sum { item: points }
    return Object.entries(value).map(([k, v]) => `${k}: ${v}`).join('; ');
  }
  return value;
}

const code = (q, i) => `Q${(q.position ?? i) + 1}`;

function safeSheetName(name) {
  // Excel forbids : \ / ? * [ ] and caps names at 31 characters.
  return (name || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
}

function responsesSheet(XLSX, questions, responses, answersByResponse) {
  const header = [
    'response_id', 'status', 'respondent_ref', 'channel', 'region', 'language',
    'started_at', 'submitted_at', 'duration_seconds',
    ...questions.map((q, i) => `${code(q, i)} — ${q.text}`),
  ];

  const rows = responses.map((r) => {
    const byQuestion = answersByResponse.get(r.id) || new Map();
    return [
      r.id,
      r.status,
      r.respondent_ref ?? '',
      r.channel ?? '',
      r.region ?? '',
      r.language ?? '',
      r.started_at ?? '',
      r.submitted_at ?? '',
      r.duration_ms ? Math.round(r.duration_ms / 1000) : '',
      ...questions.map((q) => formatAnswer(byQuestion.get(q.id))),
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({
    s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };
  ws['!cols'] = header.map((h, i) => ({ wch: i < 9 ? Math.max(12, h.length + 2) : 28 }));
  return ws;
}

function codebookSheet(XLSX, questions) {
  const header = ['code', 'position', 'type', 'question', 'required', 'options', 'has_skip_logic'];
  const rows = questions.map((q, i) => {
    const cfg = q.config || {};
    const options = cfg.options || cfg.items || cfg.rows || [];
    return [
      code(q, i),
      (q.position ?? i) + 1,
      q.type,
      q.text,
      q.required ? 'yes' : 'no',
      Array.isArray(options) ? options.join('; ') : '',
      q.logic?.skip?.clauses?.length ? 'yes' : 'no',
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{ wch: 6 }, { wch: 9 }, { wch: 14 }, { wch: 60 }, { wch: 9 }, { wch: 50 }, { wch: 15 }];
  return ws;
}

function summarySheet(XLSX, questions, answersByQuestion) {
  const rows = [['code', 'question', 'answer', 'count', 'percent_of_answered']];

  questions.forEach((q, i) => {
    const values = answersByQuestion.get(q.id) || [];
    if (!values.length) return;

    const counts = new Map();
    values.forEach((v) => {
      // Multi-select and matrix answers count once per selection, which
      // is what a frequency table should show.
      const parts = Array.isArray(v)
        ? v
        : (v && typeof v === 'object' ? Object.values(v) : [v]);
      parts.forEach((p) => {
        const key = p === null || p === undefined ? '(blank)' : String(p);
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });

    const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([answer, n]) => {
        rows.push([code(q, i), q.text, answer, n, Math.round((n / total) * 1000) / 10]);
      });
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 6 }, { wch: 50 }, { wch: 34 }, { wch: 8 }, { wch: 20 }];
  return ws;
}

/**
 * Build and download the workbook.
 *
 * @param survey     {{id,name}}
 * @param questions  ordered question rows
 * @param responses  response rows
 * @param answers    answer rows ({response_id, question_id, value})
 */
export async function exportSurveyXlsx({ survey, questions, responses, answers }) {
  const XLSX = await import('xlsx');

  const ordered = [...(questions || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const answersByResponse = new Map();
  const answersByQuestion = new Map();
  (answers || []).forEach((a) => {
    if (!answersByResponse.has(a.response_id)) answersByResponse.set(a.response_id, new Map());
    answersByResponse.get(a.response_id).set(a.question_id, a.value);

    if (!answersByQuestion.has(a.question_id)) answersByQuestion.set(a.question_id, []);
    answersByQuestion.get(a.question_id).push(a.value);
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, responsesSheet(XLSX, ordered, responses || [], answersByResponse), 'Responses');
  XLSX.utils.book_append_sheet(wb, codebookSheet(XLSX, ordered), 'Codebook');
  XLSX.utils.book_append_sheet(wb, summarySheet(XLSX, ordered, answersByQuestion), 'Summary');

  const name = `${safeSheetName(survey?.name || 'survey')}-${stamp()}.xlsx`
    .replace(/[^\w.\-() ]+/g, '-');
  XLSX.writeFile(wb, name);
  return name;
}

export default exportSurveyXlsx;
