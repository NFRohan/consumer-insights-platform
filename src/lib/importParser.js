// =============================================
// importParser.js
// Parse .xlsx and .docx files into question objects
// the builder can bulk-insert.
//
// Each parsed question:
//   { type, text, required, config: { options?, rows?, cols?, items?, scale?, min?, max?, ... } }
//
// Schema is intentionally permissive — unknown rows/lines are skipped with a
// warning, valid rows accumulate. The user reviews the parse before confirming.
// =============================================

import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

const KNOWN_TYPES = new Set([
  'single', 'multi', 'dropdown', 'matrix', 'rating', 'slider',
  'rank', 'text', 'video', 'hotspot', 'image-opt', 'iat', 'fill',
  'audio', 'nps', 'constant-sum',
]);

// type aliases the user might write in their template
const TYPE_ALIASES = {
  'single-select': 'single', 'singleselect': 'single', 'radio': 'single', 'mcq': 'single',
  'multi-select': 'multi', 'multiselect': 'multi', 'multiple': 'multi', 'multiple-choice': 'multi', 'checkbox': 'multi',
  'select': 'dropdown', 'select-list': 'dropdown',
  'grid': 'matrix',
  'rate': 'rating', 'star': 'rating', 'likert': 'rating',
  'range': 'slider',
  'rank': 'rank', 'ranking': 'rank', 'drag': 'rank',
  'open': 'text', 'open-text': 'text', 'open-ended': 'text', 'comment': 'text',
  'image': 'image-opt', 'image-options': 'image-opt', 'images': 'image-opt',
  'reaction': 'iat', 'reaction-time': 'iat',
  'fill-in-the-blanks': 'fill', 'fill-blanks': 'fill', 'cloze': 'fill',
  'voice': 'audio',
  'net-promoter-score': 'nps', 'net-promoter': 'nps',
  'sum': 'constant-sum', 'allocate': 'constant-sum',
};

const splitOptions = (s) =>
  s == null ? []
    : String(s)
        .split(/[\n;|]+/)
        .map((x) => x.trim())
        .filter(Boolean);

// Parse a single skip-clause expression like:
//   Q1=Daily | Q1!=Never | Q5<=3 | Q5>=8 | Q1~good | Q1=
// Returns { questionRef, op, value } or null. questionRef is "Q1" (1-indexed)
// — the import handler resolves it to a UUID after insert.
const SKIP_OPS = [
  { sym: '!=', op: 'neq' },
  { sym: '<=', op: 'lte' },
  { sym: '>=', op: 'gte' },
  { sym: '~',  op: 'contains' },
  { sym: '<',  op: 'lt' },
  { sym: '>',  op: 'gt' },
  { sym: '=',  op: 'eq' },
];

const parseSkipClause = (raw) => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // find longest-matching operator first (so != is detected before =)
  for (const { sym, op } of SKIP_OPS) {
    const idx = s.indexOf(sym);
    if (idx > 0) {
      const left = s.slice(0, idx).trim();
      const right = s.slice(idx + sym.length).trim();
      const m = /^Q(\d+)(?:\.[a-z]+)?$/i.exec(left);
      if (!m) return null;
      // empty value with = means "is empty"
      if (op === 'eq' && right === '') {
        return { questionRef: 'Q' + m[1], op: 'empty', value: '' };
      }
      if (op === 'neq' && right === '') {
        return { questionRef: 'Q' + m[1], op: 'not_empty', value: '' };
      }
      return { questionRef: 'Q' + m[1], op, value: right };
    }
  }
  return null;
};

// Parse a full skip-if cell like "Q1!=Never; Q5<=3"
const parseSkipExpr = (raw, combinator = 'AND') => {
  if (!raw) return null;
  const parts = String(raw).split(/\s*;\s*/).filter(Boolean);
  const clauses = parts.map(parseSkipClause).filter(Boolean);
  if (!clauses.length) return null;
  return { combinator, clauses };
};

// Normalize the Randomize column / directive
const normalizeRandomize = (raw) => {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  if (s === '' || s === 'no' || s === 'none' || s === 'false' || s === 'n') return null;
  if (s === 'yes' || s === 'y' || s === 'true' || s === '1' || s === 'random' || s === 'shuffle') return 'random';
  if (s === 'pin-last' || s === 'pin last' || s === 'pin' || s === 'last') return 'pin-last';
  return null;
};

const normalizeType = (raw) => {
  if (!raw) return null;
  const t = String(raw).toLowerCase().trim().replace(/_/g, '-');
  if (KNOWN_TYPES.has(t)) return t;
  if (TYPE_ALIASES[t]) return TYPE_ALIASES[t];
  return null;
};

const parseRequired = (val) => {
  if (val == null) return false;
  const s = String(val).toLowerCase().trim();
  return s === 'y' || s === 'yes' || s === 'true' || s === '1' || s === 'required';
};

// =====================================================
// Excel parser
// Header row (case-insensitive, any column order works):
//   Type | Question | Options | Required | Rows | Cols | Min | Max | Scale | Notes
// Each subsequent row = one question.
// For matrix questions: Rows / Cols (semicolon-separated).
// For options: Options column, "; | \n" delimited.
// =====================================================
export function parseExcelArrayBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { questions: [], errors: ['Empty workbook'] };
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (aoa.length === 0) return { questions: [], errors: ['No rows in sheet'] };

  const headerRow = aoa[0].map((h) => String(h || '').toLowerCase().trim());
  const idx = (name) => headerRow.findIndex((h) => h === name);

  const i = {
    type: idx('type'),
    text: idx('question') >= 0 ? idx('question') : idx('text'),
    options: idx('options'),
    required: idx('required'),
    rows: idx('rows'),
    cols: idx('cols') >= 0 ? idx('cols') : idx('columns'),
    min: idx('min'),
    max: idx('max'),
    scale: idx('scale'),
    placeholder: idx('placeholder'),
    notes: idx('notes'),
    skipIf: idx('skip if') >= 0 ? idx('skip if') : idx('skipif'),
    skipCombinator: idx('skip combinator') >= 0 ? idx('skip combinator') : idx('skipcombinator'),
    randomize: idx('randomize'),
    pipingFallback: idx('piping fallback') >= 0 ? idx('piping fallback') : idx('pipingfallback'),
  };

  if (i.type < 0 || i.text < 0) {
    return {
      questions: [],
      errors: [
        'Header row must include "Type" and "Question" columns. Found: ' +
          headerRow.filter(Boolean).join(', '),
      ],
    };
  }

  const questions = [];
  const errors = [];

  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || row.every((c) => c === '' || c == null)) continue; // blank line
    const rawType = row[i.type];
    const text = String(row[i.text] || '').trim();
    if (!text && !rawType) continue;
    const type = normalizeType(rawType);
    if (!type) {
      errors.push(`Row ${r + 1}: unknown type "${rawType}"`);
      continue;
    }
    if (!text) {
      errors.push(`Row ${r + 1}: missing question text`);
      continue;
    }
    const config = {};
    if (i.options >= 0) {
      const opts = splitOptions(row[i.options]);
      if (opts.length) config.options = opts;
    }
    if (i.rows >= 0) {
      const rows = splitOptions(row[i.rows]);
      if (rows.length) config.rows = rows;
    }
    if (i.cols >= 0) {
      const cols = splitOptions(row[i.cols]);
      if (cols.length) config.cols = cols;
    }
    if (i.min >= 0 && row[i.min] !== '' && row[i.min] != null) config.min = Number(row[i.min]);
    if (i.max >= 0 && row[i.max] !== '' && row[i.max] != null) config.max = Number(row[i.max]);
    if (i.scale >= 0 && row[i.scale] !== '' && row[i.scale] != null) config.scale = Number(row[i.scale]);
    if (i.placeholder >= 0 && row[i.placeholder]) config.placeholder = String(row[i.placeholder]);

    // sensible defaults per type
    if (type === 'nps' && !config.scale) config.scale = 11;
    if (type === 'rating' && !config.scale) config.scale = 5;
    if (type === 'slider') {
      if (config.min == null) config.min = 0;
      if (config.max == null) config.max = 100;
    }
    if (type === 'rank' && !config.items && config.options) {
      config.items = config.options;
      delete config.options;
    }
    if (type === 'constant-sum') {
      if (!config.items && config.options) {
        config.items = config.options;
        delete config.options;
      }
      if (!config.total) config.total = 100;
    }

    // Randomize directive
    if (i.randomize >= 0) {
      const rand = normalizeRandomize(row[i.randomize]);
      if (rand) config.randomize = rand;
    }
    // Piping fallback
    if (i.pipingFallback >= 0 && row[i.pipingFallback]) {
      config.pipingFallback = String(row[i.pipingFallback]).trim();
    }

    // Skip-If directive (logic.skip)
    let logic = null;
    if (i.skipIf >= 0 && row[i.skipIf]) {
      const combinator =
        i.skipCombinator >= 0 && row[i.skipCombinator]
          ? String(row[i.skipCombinator]).toUpperCase().trim() === 'OR' ? 'OR' : 'AND'
          : 'AND';
      const skip = parseSkipExpr(row[i.skipIf], combinator);
      if (skip) logic = { skip };
      else errors.push(`Row ${r + 1}: could not parse Skip If "${row[i.skipIf]}"`);
    }

    questions.push({
      type,
      text,
      required: i.required >= 0 ? parseRequired(row[i.required]) : false,
      config,
      logic,
    });
  }

  return { questions, errors };
}

// =====================================================
// Word parser
// Each question is a paragraph in this format:
//   [TYPE] Question text
//   - option 1
//   - option 2
//   ...
// Type tags supported: [SINGLE] [MULTI] [DROPDOWN] [TEXT] [NPS] [RATING]
//                      [SLIDER] [RANK] [MATRIX] [IMAGE] [FILL] [AUDIO]
//                      [VIDEO] [IAT] [HOTSPOT] [CONSTANT-SUM]
// For matrix:  [MATRIX] question text
//              ROWS: row1 ; row2 ; row3
//              COLS: col1 ; col2 ; col3
// =====================================================
export async function parseDocxArrayBuffer(buffer) {
  let text;
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    text = result.value;
  } catch (err) {
    return { questions: [], errors: ['Could not read .docx: ' + err.message] };
  }

  const lines = text.split(/\r?\n/);
  const questions = [];
  const errors = [];
  let current = null;

  const finalize = () => {
    if (!current) return;
    if (current.type === 'rank' && !current.config.items && current.config.options) {
      current.config.items = current.config.options;
      delete current.config.options;
    }
    if (current.type === 'constant-sum') {
      if (!current.config.items && current.config.options) {
        current.config.items = current.config.options;
        delete current.config.options;
      }
      if (!current.config.total) current.config.total = 100;
    }
    if (current.type === 'nps' && !current.config.scale) current.config.scale = 11;
    if (current.type === 'rating' && !current.config.scale) current.config.scale = 5;
    if (current.type === 'slider') {
      if (current.config.min == null) current.config.min = 0;
      if (current.config.max == null) current.config.max = 100;
    }
    questions.push(current);
    current = null;
  };

  const headRe = /^\s*\[([A-Z][A-Z0-9-]*)\]\s*(.*)$/i;
  const optRe = /^\s*[-*•]\s+(.+)$/;
  const rowsRe = /^\s*ROWS?\s*:\s*(.+)$/i;
  const colsRe = /^\s*COLS?\s*:\s*(.+)$/i;
  const reqRe = /^\s*REQUIRED\s*:\s*(.+)$/i;
  const placeRe = /^\s*PLACEHOLDER\s*:\s*(.+)$/i;
  const scaleRe = /^\s*SCALE\s*:\s*(.+)$/i;
  const minRe = /^\s*MIN\s*:\s*(.+)$/i;
  const maxRe = /^\s*MAX\s*:\s*(.+)$/i;
  const totalRe = /^\s*TOTAL\s*:\s*(.+)$/i;
  const urlRe = /^\s*URL\s*:\s*(.+)$/i;
  const skipIfRe = /^\s*SKIP[ _-]?IF\s*:\s*(.+)$/i;
  const skipCombRe = /^\s*SKIP[ _-]?COMBINATOR\s*:\s*(.+)$/i;
  const randRe = /^\s*RANDOMIZE\s*:\s*(.+)$/i;
  const pipeFbRe = /^\s*PIPING[ _-]?FALLBACK\s*:\s*(.+)$/i;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const head = headRe.exec(line);
    if (head) {
      finalize();
      const t = normalizeType(head[1]);
      if (!t) {
        errors.push(`Unknown type tag [${head[1]}] — skipping question.`);
        current = null;
        continue;
      }
      current = { type: t, text: head[2].trim(), required: false, config: {} };
      continue;
    }
    if (!current) {
      // Free-floating text before any [TYPE] marker — ignore but warn once
      continue;
    }
    const opt = optRe.exec(line);
    if (opt) {
      (current.config.options ||= []).push(opt[1].trim());
      continue;
    }
    const rows = rowsRe.exec(line);
    if (rows) {
      current.config.rows = splitOptions(rows[1]);
      continue;
    }
    const cols = colsRe.exec(line);
    if (cols) {
      current.config.cols = splitOptions(cols[1]);
      continue;
    }
    const req = reqRe.exec(line);
    if (req) {
      current.required = parseRequired(req[1]);
      continue;
    }
    const place = placeRe.exec(line);
    if (place) {
      current.config.placeholder = place[1].trim();
      continue;
    }
    const sc = scaleRe.exec(line);
    if (sc) { current.config.scale = Number(sc[1]); continue; }
    const mn = minRe.exec(line);
    if (mn) { current.config.min = Number(mn[1]); continue; }
    const mx = maxRe.exec(line);
    if (mx) { current.config.max = Number(mx[1]); continue; }
    const tot = totalRe.exec(line);
    if (tot) { current.config.total = Number(tot[1]); continue; }
    const url = urlRe.exec(line);
    if (url) { current.config.url = url[1].trim(); continue; }
    const rnd = randRe.exec(line);
    if (rnd) {
      const v = normalizeRandomize(rnd[1]);
      if (v) current.config.randomize = v;
      continue;
    }
    const pfb = pipeFbRe.exec(line);
    if (pfb) {
      current.config.pipingFallback = pfb[1].trim();
      continue;
    }
    const sCb = skipCombRe.exec(line);
    if (sCb) {
      current._skipCombinator = String(sCb[1]).toUpperCase().trim() === 'OR' ? 'OR' : 'AND';
      continue;
    }
    const sIf = skipIfRe.exec(line);
    if (sIf) {
      const combinator = current._skipCombinator || 'AND';
      const skip = parseSkipExpr(sIf[1], combinator);
      if (skip) current.logic = { skip };
      else errors.push(`Could not parse SKIP IF "${sIf[1]}"`);
      continue;
    }
    // Continuation: append to question text if it doesn't look like an option
    current.text += (current.text ? ' ' : '') + line;
  }
  finalize();

  return { questions, errors };
}

// Auto-route based on file extension / mime
export async function parseFile(file) {
  if (!file) return { questions: [], errors: ['No file provided'] };
  const name = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm') || name.endsWith('.xls') || name.endsWith('.csv')) {
    return parseExcelArrayBuffer(buffer);
  }
  if (name.endsWith('.docx')) {
    return parseDocxArrayBuffer(buffer);
  }
  return { questions: [], errors: [`Unsupported file type: ${file.name}`] };
}

// =====================================================
// Template generators
// =====================================================
export function downloadXlsxTemplate() {
  const aoa = [
    ['Type', 'Question', 'Options', 'Required', 'Rows', 'Cols', 'Min', 'Max', 'Scale', 'Placeholder'],
    ['single', 'How often did you buy from us in the past 30 days?', 'Daily; 2-3 times per week; Weekly; Monthly; Rarely / Never', 'Y', '', '', '', '', '', ''],
    ['nps', 'How likely are you to recommend us to a friend?', '', 'Y', '', '', '', '', '11', ''],
    ['matrix', 'Rate each of the following', '', '', 'Delivery speed; Product quality; Customer support', 'Poor; Fair; Good; Very good; Excellent', '', '', '', ''],
    ['rank', 'Rank these features by importance', 'Price; Product range; Delivery speed; Ease of returns; Customer support', '', '', '', '', '', '', ''],
    ['text', 'What would you most improve?', '', '', '', '', '', '', '', 'Tell us in your own words…'],
    ['rating', 'Overall, how satisfied are you?', '', 'Y', '', '', '', '', '5', ''],
    ['slider', 'Roughly how much do you spend per month?', '', '', '', '', '0', '50000', '', ''],
    ['multi', 'Which of these have you used? (select all that apply)', 'In store; Website; Mobile app; Phone order', '', '', '', '', '', '', ''],
    ['dropdown', 'Which region do you live in?', 'North; South; East; West; Central', 'Y', '', '', '', '', '', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // approximate column widths
  ws['!cols'] = [
    { wch: 10 }, { wch: 50 }, { wch: 40 },
    { wch: 8 }, { wch: 30 }, { wch: 30 },
    { wch: 6 }, { wch: 8 }, { wch: 6 }, { wch: 25 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Questions');
  XLSX.writeFile(wb, 'survey-template.xlsx');
}

export function downloadDocxTemplate() {
  // simplest path: download a plain text reference file with the format spec.
  // The user pastes this into Word and saves as .docx, or uses it as-is.
  const txt = [
    'SURVEY IMPORT TEMPLATE — paste this into Word and save as .docx',
    '====================================================================',
    '',
    'Each question starts with a [TYPE] tag, followed by its text on the same line.',
    'Options go on lines starting with "- ".',
    'For matrix questions, use ROWS: and COLS: with "; " as the separator.',
    'Add REQUIRED: yes to make a question required.',
    '',
    '',
    '[SINGLE] How often did you buy from us in the past 30 days?',
    'REQUIRED: yes',
    '- Daily',
    '- 2-3 times per week',
    '- Weekly',
    '- Monthly',
    '- Rarely / Never',
    '',
    '[NPS] How likely are you to recommend us to a friend or colleague?',
    'REQUIRED: yes',
    '',
    '[MATRIX] Rate each of the following',
    'ROWS: Delivery speed; Product quality; Customer support; Ease of ordering',
    'COLS: Poor; Fair; Good; Very good; Excellent',
    '',
    '[RANK] Rank these features by importance',
    '- Lower prices',
    '- Wider product range',
    '- Faster delivery',
    '- Easier returns',
    '- Better customer support',
    '',
    '[TEXT] What would you most improve?',
    'PLACEHOLDER: Tell us in your own words…',
    '',
    '[RATING] Overall, how satisfied are you?',
    'REQUIRED: yes',
    '',
    '[MULTI] Which of these have you used? (select all that apply)',
    '- In store',
    '- Website',
    '- Mobile app',
    '- Phone order',
    '',
  ].join('\n');
  const blob = new Blob([txt], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'survey-template.txt';
  a.click();
  URL.revokeObjectURL(url);
}
