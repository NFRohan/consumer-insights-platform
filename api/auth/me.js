// GET /api/auth/me
//
// Re-checks the tenant's state on every call rather than trusting the
// token alone, so revoking a demo takes effect immediately instead of
// waiting for the session to lapse.

import { queryAsStaff } from '../_lib/db.js';
import { contextFromRequest } from '../_lib/auth.js';
import { handler, json, methodGuard, HttpError } from '../_lib/http.js';

export default handler(async (req, res) => {
  if (!methodGuard(req, res, ['GET'])) return;

  const ctx = await contextFromRequest(req);
  if (!ctx.userId) throw new HttpError(401, 'sign in required');

  const rows = await queryAsStaff(
    `select u.id, u.username, u.full_name, u.role, u.status, u.is_staff,
            u.tenant_id, u.password_changed_at,
            t.name as tenant_name, t.slug as tenant_slug, t.expires_at,
            case when u.is_staff then 'active' else app.tenant_status(u.tenant_id) end as tenant_state
       from public.app_users u
       left join public.tenants t on t.id = u.tenant_id
      where u.id = $1`,
    [ctx.userId],
  );

  const user = rows[0];
  if (!user) throw new HttpError(401, 'sign in required');

  // Tenant state is checked BEFORE account status, for the same reason
  // login.js checks it in that order: revoking a sandbox also
  // deactivates its accounts, so testing the account first would answer
  // "sign in required" to a prospect whose access we withdrew on
  // purpose -- an unexplained logout mid-session rather than a reason.
  if (user.tenant_state === 'expired') {
    throw new HttpError(403, 'this evaluation access has expired');
  }
  if (user.tenant_state === 'revoked') {
    throw new HttpError(403, 'this evaluation access has been withdrawn');
  }
  if (user.tenant_state === 'missing' || user.status !== 'active') {
    throw new HttpError(401, 'sign in required');
  }

  // This endpoint reaches the database through the staff context, so
  // app.begin_request never judges the caller's own token and the check
  // has to be repeated here. Without it /me answers "fine" while every
  // data request answers "sign in again" -- and since the client trusts
  // /me to decide whether a session is alive, it would keep a dead one
  // and show errors instead of returning the user to the sign-in screen.
  //
  // One second of slack, matching begin_request, for clock skew between
  // this host and the database.
  if (ctx.issuedAt && user.password_changed_at) {
    const changed = new Date(user.password_changed_at).getTime();
    if (ctx.issuedAt * 1000 < changed - 1000) {
      throw new HttpError(401, 'your password was changed — please sign in again');
    }
  }

  json(res, 200, {
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      is_staff: user.is_staff,
    },
    tenant: user.is_staff ? null : {
      id: user.tenant_id,
      name: user.tenant_name,
      slug: user.tenant_slug,
      expires_at: user.expires_at,
    },
  });
});
