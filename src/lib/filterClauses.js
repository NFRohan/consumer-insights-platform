// =====================================================================
// Clause evaluation, shared by data cleaning and cross-tab filtering.
//
// Both screens let a user build `{ combinator, clauses[] }` and both
// need it to mean the same thing, so the evaluation lives here rather
// than being written twice and drifting.
//
// A clause reads either a response attribute (channel, region, status…)
// or an answer to a question. The distinction is the `source` field:
//
//   { source: 'response', field: 'channel',   op: 'eq', value: 'sms' }
//   { source: 'answer',   field: <questionId>, op: 'eq', value: 'Daily' }
// =====================================================================

export const OPERATORS = [
  { id: 'eq', label: 'is' },
  { id: 'neq', label: 'is not' },
  { id: 'contains', label: 'contains' },
  { id: 'not_contains', label: 'does not contain' },
  { id: 'gt', label: '>' },
  { id: 'gte', label: '≥' },
  { id: 'lt', label: '<' },
  { id: 'lte', label: '≤' },
  { id: 'empty', label: 'is empty' },
  { id: 'not_empty', label: 'is not empty' },
];

/** Response fields worth filtering on, in the order a user thinks of them. */
export const RESPONSE_FIELDS = [
  { id: 'status', label: 'Status' },
  { id: 'channel', label: 'Channel' },
  { id: 'region', label: 'Region' },
  { id: 'language', label: 'Language' },
  { id: 'duration_ms', label: 'Duration (ms)' },
];

const isBlank = (v) =>
  v === null || v === undefined || v === ''
  || (Array.isArray(v) && v.length === 0);

/** Every scalar an answer can contribute, flattened. */
function parts(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;             // multi-select, rank
  if (typeof value === 'object') return Object.values(value); // matrix, sums
  return [value];
}

const asText = (v) => String(v ?? '').toLowerCase();
const asNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Does one value satisfy one clause?
 *
 * A multi-select answer matches when ANY selected option satisfies the
 * clause — the behaviour a researcher expects from "contains Delivery",
 * and the case most easily got wrong.
 */
export function matchValue(value, op, target) {
  if (op === 'empty') return isBlank(value);
  if (op === 'not_empty') return !isBlank(value);

  const candidates = parts(value);
  if (!candidates.length) return op === 'neq' || op === 'not_contains';

  const t = asText(target);
  const tn = asNum(target);

  const hit = (v) => {
    switch (op) {
      case 'eq': return asText(v) === t;
      case 'neq': return asText(v) !== t;
      case 'contains': return asText(v).includes(t);
      case 'not_contains': return !asText(v).includes(t);
      case 'gt': return tn !== null && asNum(v) !== null && asNum(v) > tn;
      case 'gte': return tn !== null && asNum(v) !== null && asNum(v) >= tn;
      case 'lt': return tn !== null && asNum(v) !== null && asNum(v) < tn;
      case 'lte': return tn !== null && asNum(v) !== null && asNum(v) <= tn;
      default: return false;
    }
  };

  // Negations must hold for EVERY selection, not just one: "is not
  // Gift cards" should exclude a respondent who picked Gift cards
  // among three, rather than pass because the other two differ.
  if (op === 'neq' || op === 'not_contains') return candidates.every(hit);
  return candidates.some(hit);
}

/**
 * Evaluate a whole clause set against one response.
 *
 * @param response  the response row
 * @param answers   Map<questionId, value> for that response
 * @param filter    { combinator: 'AND'|'OR', clauses: [] }
 */
export function matchResponse(response, answers, filter) {
  const clauses = filter?.clauses?.filter((c) => c && c.field) || [];
  if (!clauses.length) return true;          // no filter is a no-op

  const results = clauses.map((c) => {
    const value = c.source === 'answer'
      ? answers?.get(c.field)
      : response?.[c.field];
    return matchValue(value, c.op, c.value);
  });

  return filter.combinator === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

/**
 * Reduce a response set to the ids that satisfy the filter.
 *
 * @param responses  response rows
 * @param answers    answer rows ({response_id, question_id, value})
 * @returns Set<responseId>
 */
export function filterResponseIds(responses, answers, filter) {
  const byResponse = new Map();
  (answers || []).forEach((a) => {
    if (!byResponse.has(a.response_id)) byResponse.set(a.response_id, new Map());
    byResponse.get(a.response_id).set(a.question_id, a.value);
  });

  const keep = new Set();
  (responses || []).forEach((r) => {
    if (matchResponse(r, byResponse.get(r.id) || new Map(), filter)) keep.add(r.id);
  });
  return keep;
}

export const emptyFilter = () => ({ combinator: 'AND', clauses: [] });

export const newClause = () => ({
  source: 'response', field: 'status', op: 'eq', value: '',
});
