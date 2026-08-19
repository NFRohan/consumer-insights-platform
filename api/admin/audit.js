// GET /api/admin/audit
//
// The staff trail: who minted, extended, revoked or purged what.
// Deliberately not tenant-scoped, so it survives the sandbox it
// describes being deleted — which is exactly when you want it.

import { queryAsStaff } from '../_lib/db.js';
import { contextFromRequest, requireStaff } from '../_lib/auth.js';
import { handler, json, methodGuard } from '../_lib/http.js';

export default handler(async (req, res) => {
  if (!methodGuard(req, res, ['GET'])) return;
  requireStaff(await contextFromRequest(req));

  const rows = await queryAsStaff(
    `select a.id, a.ts, a.kind, a.tenant_ref, a.detail, a.meta,
            coalesce(a.actor_name, u.full_name, u.username, 'system') as actor
       from public.staff_audit a
       left join public.app_users u on u.id = a.actor_id
      order by a.ts desc
      limit 200`,
  );
  json(res, 200, { entries: rows });
});
