-- =====================================================================
-- Make expiry, revocation and password resets actually end a session.
--
-- Until now a JWT was believed for its full 12-hour life. /api/auth/me
-- re-checked the tenant, but /api/data did not: revoking a sandbox left
-- an open tab reading and exporting everything until the token lapsed.
-- Measured, not assumed -- after a revoke, /api/data still returned all
-- 360 responses.
--
-- The check belongs on the request path, not in each handler, or the
-- next endpoint someone adds will forget it. It cannot go inside
-- app.current_tenant() either: the policy on `tenants` calls that
-- function, so reading `tenants` from within it would recurse.
--
-- So it lives in app.begin_request(), which the API calls once per
-- transaction as part of the preamble it was already sending. No extra
-- round trip, one place to be wrong.
--
-- Run order: 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007
-- =====================================================================

begin;

-- When this account's password last changed. A token issued before that
-- moment is stale, which is what makes a reset end existing sessions
-- rather than merely change what the next sign-in needs.
alter table public.app_users
  add column if not exists password_changed_at timestamptz not null default now();

-- =====================================================================
-- begin_request — validate the caller, then set the session context.
--
-- Raises rather than returning a flag: a caller that ignored a flag
-- would proceed with a context it was told not to trust.
-- =====================================================================
create or replace function app.begin_request(
  p_tenant    uuid,
  p_user      uuid,
  p_role      text,
  p_staff     boolean,
  p_issued_at bigint default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status  text;
  v_changed timestamptz;
begin
  -- Staff sit outside every tenant and are governed by their account
  -- status alone, which login and /me already check.
  if not coalesce(p_staff, false) and p_tenant is not null then
    v_status := app.tenant_status(p_tenant);
    if v_status <> 'active' then
      -- Distinct SQLSTATE so the API can answer 403 with the reason
      -- instead of a generic failure.
      raise exception 'evaluation access is %', v_status
        using errcode = 'P0001', hint = v_status;
    end if;
  end if;

  -- A token minted before the password changed is no longer evidence of
  -- knowing the password. One second of slack absorbs clock skew between
  -- the API host and the database; the window it opens is a single
  -- second at the moment of the reset itself.
  if p_user is not null and p_issued_at is not null then
    select password_changed_at into v_changed
      from public.app_users where id = p_user;
    if v_changed is not null and to_timestamp(p_issued_at) < v_changed - interval '1 second' then
      raise exception 'credentials changed since this session began'
        using errcode = 'P0001', hint = 'password_changed';
    end if;
  end if;

  perform set_config('app.tenant_id', coalesce(p_tenant::text, ''), true),
          set_config('app.user_id',   coalesce(p_user::text, ''),   true),
          set_config('app.role',      coalesce(p_role, 'anon'),     true),
          set_config('app.is_staff',  case when p_staff then 'true' else 'false' end, true);
end $$;

-- =====================================================================
-- reset_demo_password — the prospect lost their credential.
--
-- There is nothing to recover: the password is a scrypt hash and that is
-- the point. Staff issue a new one, which is the same operation as
-- minting, minus creating the sandbox.
--
-- The account is deliberately NOT reactivated. Revoking a sandbox
-- deactivates its accounts, and a password reset is not a decision to
-- restore access -- extend_demo is. The tenant's status is returned so
-- the console can say so rather than handing over a credential that
-- will not work.
-- =====================================================================
create or replace function app.reset_demo_password(
  p_tenant uuid,
  p_hash   text,
  p_actor  uuid default null
) returns table (username text, tenant_status text)
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_user uuid;
  v_name text;
  v_slug text;
begin
  perform app.require_staff();

  select t.slug into v_slug from public.tenants t
   where t.id = p_tenant and t.kind = 'demo';
  if v_slug is null then
    raise exception 'no demo tenant with id %', p_tenant;
  end if;

  -- The credential staff issued is the tenant's first admin. A prospect
  -- may have promoted colleagues since; those are theirs to manage.
  select u.id, u.username into v_user, v_name
    from public.app_users u
   where u.tenant_id = p_tenant and u.role = 'admin'
   order by u.created_at
   limit 1;

  if v_user is null then
    raise exception 'tenant % has no admin account to reset', v_slug;
  end if;

  update public.app_users
     set password_hash = p_hash,
         password_changed_at = now(),
         must_change_pw = false
   where id = v_user;

  insert into public.staff_audit (actor_id, kind, tenant_ref, detail, meta)
  values (p_actor, 'tenant.password_reset', v_slug,
          format('New password issued for %s', v_name),
          jsonb_build_object('tenant_id', p_tenant, 'username', v_name));

  return query select v_name, app.tenant_status(p_tenant);
end $$;

grant execute on all functions in schema app to app_api;

commit;
