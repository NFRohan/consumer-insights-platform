// /api/admin/tenants
//
//   GET  — list every evaluation sandbox with its live status
//   POST — mint a new one and return the credential ONCE
//
// Staff only. The portal is the one place tenants are created, so the
// password is generated here rather than chosen: we store only the hash
// and can never show it again.

import { queryAsStaff } from '../_lib/db.js';
import { contextFromRequest, requireStaff, hashPassword, generatePassword } from '../_lib/auth.js';
import { handler, json, methodGuard, readJson, HttpError } from '../_lib/http.js';

const MAX_TTL_DAYS = 365;

async function list(res) {
  // last_login_at is the engagement signal. A response count would be
  // more informative, but staff are deliberately given no read over
  // prospect survey data and that is worth more than the metric.
  const rows = await queryAsStaff(
    `select t.id, t.name, t.slug, t.expires_at, t.revoked_at, t.notes, t.created_at,
            app.tenant_status(t.id)                as status,
            u.username, u.last_login_at, u.status  as account_status
       from public.tenants t
       left join public.app_users u
         on u.tenant_id = t.id and u.role = 'admin'
      where t.kind = 'demo'
      order by t.created_at desc`,
  );
  json(res, 200, { tenants: rows });
}

async function mint(req, res, ctx) {
  const { name, username, ttlDays, notes } = await readJson(req);

  if (!name?.trim()) throw new HttpError(400, 'a company or contact name is required');
  if (!username?.trim()) throw new HttpError(400, 'a username is required');

  const days = Number(ttlDays);
  if (!Number.isFinite(days) || days <= 0) throw new HttpError(400, 'ttlDays must be a positive number');
  if (days > MAX_TTL_DAYS) throw new HttpError(400, `ttlDays cannot exceed ${MAX_TTL_DAYS}`);

  if (!/^[a-z0-9][a-z0-9._-]{2,40}$/i.test(username.trim())) {
    throw new HttpError(400, 'username must be 3–41 characters: letters, digits, dot, dash or underscore');
  }

  const password = generatePassword();
  const rows = await queryAsStaff(
    `select * from app.provision_demo($1, $2, $3, make_interval(days => $4), $5, $6)`,
    [name.trim(), username.trim(), await hashPassword(password), days, ctx.userId, notes || null],
  );

  const t = rows[0];
  json(res, 201, {
    tenant: { id: t.tenant_id, slug: t.slug, expires_at: t.expires_at },
    // Shown once. Only the hash is stored, so it cannot be recovered.
    credential: { username: t.username, password },
  });
}

export default handler(async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  const ctx = requireStaff(await contextFromRequest(req));

  if (req.method === 'GET') return list(res);
  return mint(req, res, ctx);
});
