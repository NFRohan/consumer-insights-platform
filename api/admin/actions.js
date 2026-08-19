// POST /api/admin/actions   { action, tenantId, days? }
//
// revoke — cuts access now, keeps the data so it can be inspected or
//          reinstated. This is the reversible one.
// extend — pushes the expiry out and clears any revocation.
// purge  — hard-deletes sandboxes that lapsed beyond the grace period.
//          Irreversible, so it is never implicit: staff ask for it.

import { queryAsStaff } from '../_lib/db.js';
import { contextFromRequest, requireStaff } from '../_lib/auth.js';
import { handler, json, methodGuard, readJson, HttpError } from '../_lib/http.js';

export default handler(async (req, res) => {
  if (!methodGuard(req, res, ['POST'])) return;
  const ctx = requireStaff(await contextFromRequest(req));

  const { action, tenantId, days } = await readJson(req);

  switch (action) {
    case 'revoke': {
      if (!tenantId) throw new HttpError(400, 'tenantId is required');
      await queryAsStaff(`select app.revoke_demo($1, $2)`, [tenantId, ctx.userId]);
      json(res, 200, { ok: true, status: 'revoked' });
      return;
    }

    case 'extend': {
      if (!tenantId) throw new HttpError(400, 'tenantId is required');
      const n = Number(days);
      if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, 'days must be a positive number');
      const rows = await queryAsStaff(
        `select app.extend_demo($1, make_interval(days => $2), $3) as expires_at`,
        [tenantId, n, ctx.userId],
      );
      json(res, 200, { ok: true, expires_at: rows[0].expires_at });
      return;
    }

    case 'purge': {
      const grace = Number(days ?? 7);
      const rows = await queryAsStaff(
        `select app.purge_expired(make_interval(days => $1), $2) as purged`,
        [grace, ctx.userId],
      );
      json(res, 200, { ok: true, purged: rows[0].purged });
      return;
    }

    default:
      throw new HttpError(400, `unknown action: ${action}`);
  }
});
