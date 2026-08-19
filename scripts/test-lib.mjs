// =====================================================================
// Pure-function tests — no database needed.
//
//   node scripts/test-lib.mjs
//
// Filtering is where a bug produces confident, wrong numbers rather
// than an error, so the awkward cases are covered deliberately.
// =====================================================================

import assert from 'node:assert/strict';
import { matchValue, matchResponse, filterResponseIds, emptyFilter } from '../src/lib/filterClauses.js';
import { relativeDays, remainingLabel, daysUntil } from '../src/lib/relativeTime.js';

let passed = 0;
const ok = (label) => { console.log('  pass:', label); passed++; };

// =====================================================================
console.log('\nmatchValue — scalars');
// =====================================================================
{
  assert.equal(matchValue('Daily', 'eq', 'Daily'), true);
  assert.equal(matchValue('Daily', 'eq', 'daily'), true);
  ok('equality ignores case');

  assert.equal(matchValue('Daily', 'neq', 'Weekly'), true);
  assert.equal(matchValue('Daily', 'contains', 'ail'), true);
  assert.equal(matchValue('Daily', 'not_contains', 'zzz'), true);
  ok('neq and contains behave');

  assert.equal(matchValue(5, 'gt', 3), true);
  assert.equal(matchValue(5, 'lte', 5), true);
  assert.equal(matchValue('abc', 'gt', 3), false);
  ok('numeric comparisons ignore non-numeric values rather than coercing');

  assert.equal(matchValue(null, 'empty', null), true);
  assert.equal(matchValue([], 'empty', null), true);
  assert.equal(matchValue('x', 'not_empty', null), true);
  ok('empty covers null and the empty array');
}

// =====================================================================
console.log('\nmatchValue — multi-select and matrix');
// =====================================================================
{
  const multi = ['Home delivery', 'Gift cards'];

  assert.equal(matchValue(multi, 'eq', 'Gift cards'), true);
  ok('a multi-select matches when ANY selection satisfies the clause');

  assert.equal(matchValue(multi, 'contains', 'deliv'), true);
  ok('contains reaches inside a multi-select');

  // The one most easily got wrong: a negation must hold for every
  // selection, or someone who picked it slips through.
  assert.equal(matchValue(multi, 'neq', 'Gift cards'), false);
  ok('"is not" excludes a respondent who picked it among others');

  assert.equal(matchValue(multi, 'neq', 'Something else'), true);
  ok('"is not" passes when no selection matches');

  const matrix = { 'Checkout speed': 'Good', 'Product quality': 'Excellent' };
  assert.equal(matchValue(matrix, 'eq', 'Excellent'), true);
  assert.equal(matchValue(matrix, 'neq', 'Excellent'), false);
  ok('matrix answers are evaluated across their cells');
}

// =====================================================================
console.log('\nmatchResponse — combinators');
// =====================================================================
{
  const r = { id: 'r1', status: 'completed', channel: 'sms', region: 'North' };
  const a = new Map([['q1', 'Daily']]);

  assert.equal(matchResponse(r, a, emptyFilter()), true);
  ok('an empty clause list is a no-op, not an empty result');

  const AND = {
    combinator: 'AND',
    clauses: [
      { source: 'response', field: 'channel', op: 'eq', value: 'sms' },
      { source: 'answer', field: 'q1', op: 'eq', value: 'Daily' },
    ],
  };
  assert.equal(matchResponse(r, a, AND), true);
  ok('AND combines a response attribute with an answer value');

  const ANDfail = { ...AND, clauses: [AND.clauses[0], { source: 'answer', field: 'q1', op: 'eq', value: 'Weekly' }] };
  assert.equal(matchResponse(r, a, ANDfail), false);
  ok('AND narrows when one clause fails');

  assert.equal(matchResponse(r, a, { ...ANDfail, combinator: 'OR' }), true);
  ok('OR widens where AND would have excluded');

  // an incomplete row in the builder must not silently filter everything out
  assert.equal(matchResponse(r, a, { combinator: 'AND', clauses: [{ source: 'response', op: 'eq', value: 'x' }] }), true);
  ok('a clause with no field chosen yet is ignored');
}

// =====================================================================
console.log('\nfilterResponseIds');
// =====================================================================
{
  const responses = [
    { id: 'r1', status: 'completed', channel: 'sms' },
    { id: 'r2', status: 'partial', channel: 'link' },
    { id: 'r3', status: 'completed', channel: 'link' },
  ];
  const answers = [
    { response_id: 'r1', question_id: 'q1', value: 'Daily' },
    { response_id: 'r2', question_id: 'q1', value: 'Weekly' },
    { response_id: 'r3', question_id: 'q1', value: ['Daily', 'Weekly'] },
  ];

  const all = filterResponseIds(responses, answers, emptyFilter());
  assert.equal(all.size, 3);
  ok('no filter keeps every response');

  const completed = filterResponseIds(responses, answers, {
    combinator: 'AND',
    clauses: [{ source: 'response', field: 'status', op: 'eq', value: 'completed' }],
  });
  assert.deepEqual([...completed].sort(), ['r1', 'r3']);
  ok('filtering on a response attribute selects the right ids');

  const daily = filterResponseIds(responses, answers, {
    combinator: 'AND',
    clauses: [{ source: 'answer', field: 'q1', op: 'eq', value: 'Daily' }],
  });
  assert.deepEqual([...daily].sort(), ['r1', 'r3']);
  ok('an answer clause matches inside a multi-select too');

  const none = filterResponseIds(responses, answers, {
    combinator: 'AND',
    clauses: [{ source: 'response', field: 'status', op: 'eq', value: 'nonexistent' }],
  });
  assert.equal(none.size, 0);
  ok('a filter matching nothing yields an empty set, not everything');
}

// =====================================================================
console.log('\nrelative time');
// =====================================================================
{
  const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

  assert.equal(daysUntil(null), null);
  assert.equal(relativeDays(null), '');
  ok('a null expiry produces no claim about time');

  assert.equal(relativeDays(inDays(3)), 'in 3 days');
  assert.equal(relativeDays(inDays(1)), 'in 1 day');
  assert.equal(relativeDays(inDays(-2)), '2 days ago');
  ok('relative days reads correctly in both directions');

  assert.equal(remainingLabel(inDays(6)), '6 days left');
  assert.match(remainingLabel(new Date(Date.now() + 3 * 3_600_000).toISOString()), /hours? left/);
  assert.equal(remainingLabel(inDays(-1)), 'expired');
  ok('the chip label switches to hours near the end, then to expired');
}

console.log(`\nALL LIB TESTS PASSED (${passed} checks)\n`);
