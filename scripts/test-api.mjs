// =====================================================================
// API-tier tests. Runs against the scratch Postgres from db/README.md.
//
//   DATABASE_URL=postgres://postgres:test@localhost:55433/postgres \
//   JWT_SECRET=0123456789abcdef0123456789abcdef \
//   node scripts/test-api.mjs
// =====================================================================

import assert from 'node:assert/strict';
import { readFileSync, unlinkSync } from 'node:fs';
import { build } from '../api/_lib/query.js';
import { HttpError } from '../api/_lib/tables.js';
import { hashPassword, verifyPassword, signToken, verifyToken, generatePassword } from '../api/_lib/auth.js';
import { withContext, queryAsStaff, getPool } from '../api/_lib/db.js';
import { exportSurveyXlsx } from '../src/lib/exportXlsx.js';
import * as XLSX from 'xlsx';

let passed = 0;
const ok = (label) => { console.log('  pass:', label); passed++; };

async function rejects(label, fn, match) {
  try {
    await fn();
  } catch (err) {
    if (match && !String(err.message).match(match)) {
      throw new Error(`${label}: wrong error — ${err.message}`);
    }
    ok(label);
    return;
  }
  throw new Error(`FAIL: ${label} — expected a rejection`);
}

// =====================================================================
console.log('\npasswords');
// =====================================================================
{
  const pw = generatePassword();
  assert.match(pw, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  ok('generated credential is readable and unambiguous');

  const hash = await hashPassword(pw);
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(await verifyPassword(pw, hash), true);
  ok('correct password verifies');
  assert.equal(await verifyPassword(pw + 'x', hash), false);
  ok('wrong password is rejected');
  assert.equal(await verifyPassword(pw, 'garbage'), false);
  ok('malformed hash fails closed');
}

// =====================================================================
console.log('\ntokens');
// =====================================================================
{
  const t = await signToken({ userId: 'u1', tenantId: 't1', role: 'admin', isStaff: false });
  const p = await verifyToken(t);
  assert.equal(p.sub, 'u1');
  assert.equal(p.tid, 't1');
  ok('token round-trips identity');

  // the cap: a tenant expiring in 60s must shorten the session
  const soon = new Date(Date.now() + 60_000);
  const capped = await verifyToken(await signToken({
    userId: 'u1', tenantId: 't1', role: 'admin', tenantExpiresAt: soon,
  }));
  assert.ok(capped.exp <= Math.floor(soon.getTime() / 1000));
  ok('session expiry is capped at the tenant expiry');

  await rejects('an already-expired tenant cannot be issued a token',
    () => signToken({ userId: 'u1', tenantId: 't1', role: 'admin',
                      tenantExpiresAt: new Date(Date.now() - 1000) }),
    /expired/);

  await rejects('a tampered token is rejected',
    () => verifyToken(t.slice(0, -3) + 'aaa'));
}

// =====================================================================
console.log('\nquery builder — shape');
// =====================================================================
{
  const q = build({ table: 'surveys', op: 'select', columns: 'id,name',
                    filters: [{ col: 'status', op: 'eq', val: 'live' }],
                    order: { col: 'created_at', asc: false }, limit: 10 });
  assert.match(q.text, /^select "id", "name" from "surveys" where "status" = \$1 order by "created_at" desc limit 10$/);
  assert.deepEqual(q.params, ['live']);
  ok('select builds parameterised SQL');

  const aliased = build({ table: 'profiles', op: 'select', columns: '*' });
  assert.match(aliased.text, /from "app_users"/);
  ok('legacy table name `profiles` maps to app_users');

  const ins = build({ table: 'answers', op: 'insert',
                      rows: [{ response_id: 'r', question_id: 'q', survey_id: 's', value: { a: 1 } }] });
  assert.match(ins.text, /^insert into "answers"/);
  assert.equal(ins.params[3], JSON.stringify({ a: 1 }));
  ok('json values are serialised for jsonb columns');

  const noPwd = build({ table: 'profiles', op: 'select', columns: '*' });
  assert.ok(!noPwd.text.includes('password_hash'));
  ok('password_hash is never projectable');
}

// =====================================================================
console.log('\nquery builder — refusals');
// =====================================================================
{
  const bad = (body, match) => rejects(`rejects ${JSON.stringify(body).slice(0, 60)}`,
    async () => build(body), match);

  await bad({ table: 'pg_user', op: 'select' }, /unknown table/);
  await bad({ table: 'surveys', op: 'select', columns: 'id; drop table surveys' }, /unknown column/);
  await bad({ table: 'surveys', op: 'select', filters: [{ col: 'name', op: 'union', val: 1 }] }, /unknown operator/);
  await bad({ table: 'surveys', op: 'insert', rows: [{ tenant_id: 'someone-elses' }] }, /not writable/);
  await bad({ table: 'surveys', op: 'update', patch: { name: 'x' } }, /requires at least one filter/);
  await bad({ table: 'surveys', op: 'delete' }, /requires at least one filter/);
  await bad({ table: 'surveys', op: 'truncate' }, /unknown op/);
}

// =====================================================================
console.log('\nlive database');
// =====================================================================
{
  // Re-runnable: clear anything a previous run left behind.
  await queryAsStaff(`delete from public.tenants where name like 'API Test%'`);

  const [{ tenant_id: tenantA }] = await queryAsStaff(
    `select * from app.provision_demo('API Test A', 'api.test.a', $1, interval '3 days')`,
    [await hashPassword('pw-a')],
  );
  const [{ tenant_id: tenantB }] = await queryAsStaff(
    `select * from app.provision_demo('API Test B', 'api.test.b', $1, interval '3 days')`,
    [await hashPassword('pw-b')],
  );
  ok('two sandboxes provisioned through the API layer');

  const [userA] = await queryAsStaff(
    `select id, role from public.app_users where tenant_id = $1`, [tenantA]);

  const ctxA = { tenantId: tenantA, userId: userA.id, role: userA.role, isStaff: false };

  const q = build({ table: 'surveys', op: 'select', columns: 'id,name,status' });
  const rowsA = await withContext(ctxA, async (c) => (await c.query(q.text, q.params)).rows);
  assert.equal(rowsA.length, 2);
  ok('tenant context returns only that tenant’s surveys');

  // the same query under B's context must not see A's rows
  const [userB] = await queryAsStaff(
    `select id, role from public.app_users where tenant_id = $1`, [tenantB]);
  const rowsB = await withContext(
    { tenantId: tenantB, userId: userB.id, role: userB.role },
    async (c) => (await c.query(q.text, q.params)).rows);
  assert.equal(rowsB.length, 2);
  assert.equal(rowsA.filter((r) => rowsB.some((b) => b.id === r.id)).length, 0);
  ok('the two sandboxes share no rows');

  // context must not survive into the next checkout of a pooled client
  const leaked = await withContext({}, async (c) =>
    (await c.query('select count(*)::int n from public.surveys')).rows[0].n);
  assert.equal(leaked, 0);
  ok('session context does not leak between requests');

  // a viewer cannot write
  await rejects('a viewer is refused a write by RLS', async () => {
    const ins = build({ table: 'surveys', op: 'insert', rows: [{ name: 'nope', status: 'draft' }] });
    await withContext({ tenantId: tenantA, userId: userA.id, role: 'viewer' },
      async (c) => c.query(ins.text, ins.params));
  }, /row-level security|permission/i);

  // ---- xlsx, from real seeded data --------------------------------
  const survey = rowsA.find((s) => /Full Form/.test(s.name)) || rowsA[0];
  const [questions, responses, answers] = await Promise.all([
    withContext(ctxA, async (c) => (await c.query(
      'select id, position, type, text, required, config, logic from public.questions where survey_id = $1 order by position',
      [survey.id])).rows),
    withContext(ctxA, async (c) => (await c.query(
      'select id, status, respondent_ref, channel, region, language, started_at, submitted_at, duration_ms from public.responses where survey_id = $1',
      [survey.id])).rows),
    withContext(ctxA, async (c) => (await c.query(
      'select response_id, question_id, value from public.answers where survey_id = $1', [survey.id])).rows),
  ]);

  const file = await exportSurveyXlsx({ survey, questions, responses, answers });
  const wb = XLSX.read(readFileSync(file));
  assert.deepEqual(wb.SheetNames, ['Responses', 'Codebook', 'Summary']);
  ok('workbook has Responses, Codebook and Summary sheets');

  const resp = XLSX.utils.sheet_to_json(wb.Sheets.Responses, { header: 1 });
  assert.equal(resp.length, responses.length + 1);
  ok(`Responses sheet has one row per respondent (${responses.length})`);
  assert.equal(resp[0].length, 9 + questions.length);
  ok(`Responses sheet has one column per question (${questions.length})`);

  const codebook = XLSX.utils.sheet_to_json(wb.Sheets.Codebook, { header: 1 });
  assert.equal(codebook.length, questions.length + 1);
  ok('Codebook documents every question');

  const summary = XLSX.utils.sheet_to_json(wb.Sheets.Summary, { header: 1 });
  assert.ok(summary.length > questions.length);
  ok(`Summary contains frequency rows (${summary.length - 1})`);

  // a multi-select answer must be counted per selection, not per cell
  assert.ok(summary.slice(1).every((r) => typeof r[3] === 'number' && r[3] > 0));
  ok('every frequency row carries a positive count');

  unlinkSync(file);

  await queryAsStaff(`delete from public.tenants where id = any($1)`, [[tenantA, tenantB]]);
}

// =====================================================================
console.log('\nclick tracking');
// =====================================================================
{
  await queryAsStaff(`delete from public.tenants where name like 'Click Test%'`);
  const [{ tenant_id: tid }] = await queryAsStaff(
    `select * from app.provision_demo('Click Test Co', 'click.eval', $1, interval '3 days')`,
    [await hashPassword('pw')],
  );

  // Staff cannot read prospect surveys (by design), so anything
  // touching tenant data runs under the tenant's own context.
  const [tuser] = await queryAsStaff(
    `select id, role from public.app_users where tenant_id = $1`, [tid]);
  const tctx = { tenantId: tid, userId: tuser.id, role: tuser.role };

  const [live] = await withContext(tctx, async (c) => (await c.query(
    `select id from public.surveys where status = 'live' limit 1`)).rows);
  // A draft survey, to prove the boundary.
  const [draft] = await withContext(tctx, async (c) => (await c.query(
    `update public.surveys set status = 'draft' where id <> $1 returning id`, [live.id])).rows);

  const mkDist = async (surveyId) => (await withContext(tctx, async (c) => (await c.query(
    `insert into public.distributions (survey_id, channel, message, audience_size, sent, clicked)
     values ($1, 'link', 'hi', 10, 10, 0) returning id`, [surveyId])).rows))[0].id;

  const liveDist = await mkDist(live.id);
  const draftDist = await mkDist(draft.id);

  const clicked = async (dist, visitor) =>
    (await queryAsStaff(`select app.record_click($1, $2) as f`, [dist, visitor]))[0].f;
  // distributions are tenant data too, so read them as the tenant.
  const counter = async (dist) => (await withContext(tctx, async (c) => (await c.query(
    `select clicked from public.distributions where id = $1`, [dist])).rows))[0].clicked;

  assert.equal(await clicked(liveDist, 'visitor-a'), true);
  assert.equal(await counter(liveDist), 1);
  ok('first open counts');

  assert.equal(await clicked(liveDist, 'visitor-a'), false);
  assert.equal(await counter(liveDist), 1);
  ok('the same browser opening again does not inflate the count');

  assert.equal(await clicked(liveDist, 'visitor-b'), true);
  assert.equal(await counter(liveDist), 2);
  ok('a different browser counts separately');

  assert.equal(await clicked(liveDist, ''), false);
  ok('an empty visitor key is ignored rather than counted');

  await rejects('a distribution on a DRAFT survey refuses clicks',
    () => queryAsStaff(`select app.record_click($1, $2)`, [draftDist, 'visitor-c']),
    /no open distribution/);

  await rejects('an unknown distribution id refuses clicks',
    () => queryAsStaff(`select app.record_click($1, $2)`,
                       ['00000000-0000-0000-0000-0000000000ff', 'visitor-d']),
    /no open distribution/);

  // clicks are tenant-scoped like everything else
  const rows = await withContext(tctx,
    async (c) => (await c.query('select * from public.distribution_clicks')).rows);
  assert.equal(rows.length, 2);
  ok('a tenant sees its own click events');

  const foreign = await withContext(
    { tenantId: '00000000-0000-0000-0000-0000000000ff', userId: tuser.id, role: 'admin' },
    async (c) => (await c.query('select * from public.distribution_clicks')).rows);
  assert.equal(foreign.length, 0);
  ok('another tenant sees none of them');

  await queryAsStaff(`delete from public.tenants where id = $1`, [tid]);
}

// =====================================================================
console.log('\nthe anonymous surface');
//
// A respondent has no session, but the API puts them INSIDE the tenant
// that owns the live survey they were sent to -- that is what lets them
// submit. So "no session" is not the same as "no context", and every
// read policy has to say so itself. Two did not, and nothing failed:
// the isolation suite stayed green because no tenant boundary was ever
// crossed. These cases ask the question that suite was not asking.
// =====================================================================
{
  await queryAsStaff(`delete from public.tenants where name like 'Anon Test%'`);
  const [{ tenant_id: tid }] = await queryAsStaff(
    `select * from app.provision_demo('Anon Test Co', 'anon.eval', $1, interval '3 days',
                                      null, 'internal note about this prospect')`,
    [await hashPassword('pw')],
  );
  const [tuser] = await queryAsStaff(
    `select id, role from public.app_users where tenant_id = $1`, [tid]);

  const member = { tenantId: tid, userId: tuser.id, role: tuser.role };
  // Exactly what api/data.js builds after resolvePublicTenant: the
  // tenant is known, the user is not.
  const anon = { tenantId: tid, userId: null, role: 'anon', isStaff: false };

  const countAs = async (ctx, table) => Number((await withContext(ctx,
    async (c) => (await c.query(`select count(*) as n from public.${table}`)).rows))[0].n);

  for (const table of ['app_users', 'tenants', 'responses', 'answers',
                       'distributions', 'cleaning_rules', 'audit_logs']) {
    assert.equal(await countAs(anon, table), 0, `anon could read ${table}`);
  }
  ok('a respondent with no session reads nothing from any tenant table');

  // ...while the same tenant, signed in, still sees its own rows. A
  // policy that denied everybody would pass the loop above too.
  assert.ok(await countAs(member, 'app_users') > 0);
  assert.ok(await countAs(member, 'tenants') > 0);
  ok('a signed-in member still reads the directory and its own tenant row');

  // The respondent flow itself must keep working: the questions of a
  // live survey stay readable with no session at all.
  const [live] = await withContext(member, async (c) => (await c.query(
    `select id from public.surveys where status = 'live' limit 1`)).rows);
  const visible = await withContext(anon, async (c) => (await c.query(
    `select count(*) as n from public.questions where survey_id = $1`, [live.id])).rows);
  assert.ok(Number(visible[0].n) > 0);
  ok('a live survey question is still readable without a session');

  await rejects('a respondent cannot write an audit entry',
    () => withContext(anon, async (c) => c.query(
      `insert into public.audit_logs (kind, detail) values ('forged', 'by nobody')`)),
    /row-level security|violates/i);

  // ---------------------------------------------------------------
  // the actor on an audit entry belongs to the session, not the body
  // ---------------------------------------------------------------
  await withContext(member, async (c) => c.query(
    `insert into public.audit_logs (actor_id, actor_name, kind, detail)
     values ($1, 'Someone Else Entirely', 'survey.deleted', 'attributed by the client')`,
    ['00000000-0000-0000-0000-0000000000ff']));

  const [entry] = await withContext(member, async (c) => (await c.query(
    `select actor_id, actor_name from public.audit_logs where kind = 'survey.deleted'`)).rows);
  assert.equal(entry.actor_id, tuser.id);
  assert.notEqual(entry.actor_name, 'Someone Else Entirely');
  ok('the trigger replaces a client-supplied actor with the session-s');

  // ---------------------------------------------------------------
  // the whitelist no longer accepts columns the server owns
  // ---------------------------------------------------------------
  assert.throws(() => build({ table: 'distributions', op: 'insert',
                              rows: [{ survey_id: live.id, clicked: 9999 }] }),
                /not writable/);
  ok('a client cannot set distributions.clicked');

  assert.throws(() => build({ table: 'distributions', op: 'update',
                              filters: [{ col: 'id', op: 'eq', val: live.id }],
                              patch: { delivered: 500 } }),
                /not writable/);
  ok('a client cannot set distributions.delivered');

  assert.throws(() => build({ table: 'audit_logs', op: 'insert',
                              rows: [{ kind: 'x', actor_name: 'Someone Else' }] }),
                /not writable/);
  ok('a client cannot choose an audit entry actor');

  // The removed column alias: `msisdn` was rewritten on the way in, so
  // the UI asked for a column it could not then find in the result.
  assert.throws(() => build({ table: 'responses', op: 'select', columns: 'id,msisdn' }),
                /unknown column msisdn/);
  ok('the column alias is gone rather than half-working');

  await queryAsStaff(`delete from public.tenants where id = $1`, [tid]);
}

// =====================================================================
console.log('\nrow ceiling');
// =====================================================================
{
  const capped = build({ table: 'answers', op: 'select', columns: 'id' });
  assert.match(capped.text, /limit 5000$/);
  assert.equal(capped.limit, 5000);
  ok('a select with no limit still gets one');

  const asked = build({ table: 'answers', op: 'select', columns: 'id', limit: 10 });
  assert.match(asked.text, /limit 10$/);
  ok('a smaller limit is respected');

  const greedy = build({ table: 'answers', op: 'select', columns: 'id', limit: 99999 });
  assert.match(greedy.text, /limit 5000$/);
  ok('a larger one is capped');

  // The flag api/data.js derives is rows.length >= limit, i.e. "may be
  // incomplete" -- an exactly-full page cannot be told from a cut one.
  assert.equal(build({ table: 'answers', op: 'insert', rows: [{ value: 1 }] }).limit, undefined);
  ok('writes report no limit, so they are never flagged as truncated');
}

await getPool().end();
console.log(`\nALL API TESTS PASSED (${passed} checks)\n`);
