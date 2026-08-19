// POST /api/auth/login  { username, password }
//
// Resolving a username to its tenant necessarily happens before any
// tenant is known, so the lookup runs with elevated context. Everything
// after the lookup is scoped normally.

import { queryAsStaff } from '../_lib/db.js';
import { verifyPassword, signToken } from '../_lib/auth.js';
import { handler, json, methodGuard, readJson, HttpError } from '../_lib/http.js';

// One message for every failure mode below, so the endpoint cannot be
// used to discover which usernames exist.
const REJECT = 'incorrect username or password';

export default handler(async (req, res) => {
  if (!methodGuard(req, res, ['POST'])) return;

  const { username, password } = await readJson(req);
  if (!username || !password) throw new HttpError(400, 'username and password are required');

  const rows = await queryAsStaff(
    `select u.id, u.tenant_id, u.username, u.full_name, u.role, u.status,
            u.is_staff, u.password_hash, u.must_change_pw,
            t.name  as tenant_name,
            t.slug  as tenant_slug,
            t.expires_at,
            case when u.is_staff then 'active' else app.tenant_status(u.tenant_id) end as tenant_state
       from public.app_users u
       left join public.tenants t on t.id = u.tenant_id
      where lower(u.username) = lower($1)`,
    [username],
  );

  const user = rows[0];

  // Verify against a dummy hash when the user is unknown so that a
  // missing account and a wrong password take comparable time.
  const ok = await verifyPassword(
    password,
    user?.password_hash || 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  );
  if (!user || !ok) throw new HttpError(401, REJECT);

  // Tenant state is checked BEFORE account status. Revoking a sandbox
  // also deactivates its accounts, and telling that prospect their
  // password is wrong would send them to support over an expiry we
  // caused deliberately.
  if (user.tenant_state === 'expired') {
    throw new HttpError(403, 'this evaluation access has expired');
  }
  if (user.tenant_state === 'revoked') {
    throw new HttpError(403, 'this evaluation access has been withdrawn');
  }
  if (user.tenant_state === 'missing') throw new HttpError(401, REJECT);

  // An individually disabled account still gets the generic message.
  if (user.status !== 'active') throw new HttpError(401, REJECT);

  const token = await signToken({
    userId: user.id,
    tenantId: user.tenant_id,
    role: user.role,
    isStaff: user.is_staff,
    tenantExpiresAt: user.expires_at,
  });

  await queryAsStaff(
    `update public.app_users set last_login_at = now() where id = $1`, [user.id],
  );

  json(res, 200, {
    token,
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      is_staff: user.is_staff,
      must_change_pw: user.must_change_pw,
    },
    tenant: user.is_staff ? null : {
      id: user.tenant_id,
      name: user.tenant_name,
      slug: user.tenant_slug,
      expires_at: user.expires_at,
    },
  });
});
