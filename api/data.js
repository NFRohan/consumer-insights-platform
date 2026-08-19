// POST /api/data
//
// The single data endpoint the client shim talks to. It accepts a
// whitelisted table, columns, filters and ordering (see _lib/tables.js)
// and runs the result under the caller's tenant context.
//
// Two things are never taken from the client: the tenant, and the SQL.
// The tenant comes from the verified token, or — for the public
// respondent flow, which has no token — from a server-side lookup of a
// LIVE survey id. The SQL is assembled from the whitelist.

import { withContext, queryAsStaff } from './_lib/db.js';
import { contextFromRequest } from './_lib/auth.js';
import { build } from './_lib/query.js';
import { handler, json, methodGuard, readJson, HttpError } from './_lib/http.js';

/**
 * Anonymous respondents arrive with no session. They may act only
 * inside the tenant that owns the live survey they were sent to, so we
 * resolve it here rather than believing a tenant id in the body.
 */
async function resolvePublicTenant(surveyId) {
  if (!surveyId) throw new HttpError(401, 'sign in required');
  // Staff have no read over prospect data by design, so this goes
  // through a narrow SECURITY DEFINER lookup rather than a plain select.
  const rows = await queryAsStaff(
    `select app.public_survey_tenant($1) as tenant_id`, [surveyId],
  );
  const tenantId = rows[0]?.tenant_id;
  if (!tenantId) throw new HttpError(404, 'survey not found or not open');
  return tenantId;
}

export default handler(async (req, res) => {
  if (!methodGuard(req, res, ['POST'])) return;

  const body = await readJson(req);
  const ctx = await contextFromRequest(req);

  // Checked before the public-tenant fallback: staff have no tenant, so
  // otherwise they fall through to it and get a misleading 401.
  if (ctx.isStaff) {
    // Staff operate the admin portal, not prospect sandboxes. Their
    // tools live under /api/admin/*; this endpoint is not for them.
    throw new HttpError(403, 'staff sessions cannot query tenant data');
  }

  if (!ctx.tenantId) {
    // No session: only the public respondent path is permitted, and
    // only against the survey named in the request.
    ctx.tenantId = await resolvePublicTenant(body.publicSurveyId);
    ctx.role = 'anon';
    ctx.userId = null;
    ctx.isStaff = false;
  }

  const { text, params, limit } = build(body);
  const rows = await withContext(ctx, async (client) => (await client.query(text, params)).rows);

  if (body.single) {
    if (rows.length > 1) throw new HttpError(409, 'expected a single row');
    json(res, 200, { data: rows[0] ?? null });
    return;
  }
  // Hitting the row ceiling exactly is indistinguishable from a result
  // that happens to be that size, so this is a "may be incomplete"
  // signal rather than a claim. Views that aggregate should say so;
  // views that list can ignore it.
  json(res, 200, { data: rows, truncated: limit !== undefined && rows.length >= limit });
});
