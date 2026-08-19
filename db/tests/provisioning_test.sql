-- =====================================================================
-- Provisioning tests — mint, isolate, extend, revoke, purge.
-- Run after 001..004 against a scratch database.
-- =====================================================================

set client_min_messages = notice;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL: % — got %, want %', label, got, want;
  end if;
  raise notice 'pass: %', label;
end $$;

-- a staff operator to act as
insert into public.app_users (id, tenant_id, username, password_hash, full_name, role, is_staff)
values ('0f5e0000-0000-0000-0000-0000000000ff'::uuid, null, 'ops', 'x', 'Ops', 'admin', true)
on conflict do nothing;

-- =====================================================================
-- 1. Minting without staff context is refused
-- =====================================================================
do $$
declare ok boolean := false;
begin
  perform set_config('app.is_staff', 'false', false);
  begin
    perform app.provision_demo('Sneaky Ltd', 'sneaky', 'hash');
  exception when insufficient_privilege then
    ok := true;
  end;
  if not ok then raise exception 'FAIL: provisioning allowed without staff context'; end if;
  raise notice 'pass: provisioning refused without staff context';
end $$;

-- =====================================================================
-- 2. Mint two demos as staff
-- =====================================================================
select set_config('app.is_staff', 'true', false);

select set_config('demo.a', (select tenant_id::text from app.provision_demo(
  'Acme Foods', 'acme.eval', 'hash-a', interval '3 days',
  '0f5e0000-0000-0000-0000-0000000000ff'::uuid, 'Trial for Acme')), false);

select set_config('demo.b', (select tenant_id::text from app.provision_demo(
  'Vertex Retail', 'vertex.eval', 'hash-b', interval '14 days',
  '0f5e0000-0000-0000-0000-0000000000ff'::uuid, 'Longer trial')), false);

select pg_temp.check('two demo tenants exist',
  (select count(*)::int from tenants where kind = 'demo'), 2);

-- =====================================================================
-- 3. Each demo is a full, independent copy of the template
-- =====================================================================
select pg_temp.check('demo A cloned all surveys',
  (select count(*)::int from surveys   where tenant_id = current_setting('demo.a')::uuid), 2);
select pg_temp.check('demo A cloned all questions',
  (select count(*)::int from questions where tenant_id = current_setting('demo.a')::uuid), 22);
select pg_temp.check('demo A cloned all responses',
  (select count(*)::int from responses where tenant_id = current_setting('demo.a')::uuid), 360);
select pg_temp.check('demo B cloned all answers too',
  (select count(*)::int from answers   where tenant_id = current_setting('demo.b')::uuid), 3074);

-- ids must be freshly generated, not shared with the template
select pg_temp.check('cloned survey ids are distinct from the template',
  (select count(*)::int from surveys a join surveys b on a.id = b.id
    where a.tenant_id = current_setting('demo.a')::uuid
      and b.tenant_id = (select id from tenants where slug = 'template')), 0);

-- answers must point at their OWN tenant's responses, not the template's
select pg_temp.check('cloned answers reference their own tenant only',
  (select count(*)::int from answers a
     join responses r on r.id = a.response_id
    where a.tenant_id = current_setting('demo.a')::uuid
      and r.tenant_id <> current_setting('demo.a')::uuid), 0);

-- =====================================================================
-- 4. The minted credential is a tenant admin, and is the survey owner
-- =====================================================================
select pg_temp.check('one admin credential minted for demo A',
  (select count(*)::int from app_users
    where tenant_id = current_setting('demo.a')::uuid and role = 'admin'), 1);
select pg_temp.check('cloned surveys are owned by that credential',
  (select count(distinct owner_id)::int from surveys
    where tenant_id = current_setting('demo.a')::uuid), 1);

-- =====================================================================
-- 5. Duplicate usernames are refused
-- =====================================================================
do $$
declare ok boolean := false;
begin
  begin
    perform app.provision_demo('Acme Again', 'acme.eval', 'hash-c');
  exception when unique_violation then
    ok := true;
  end;
  if not ok then raise exception 'FAIL: duplicate username accepted'; end if;
  raise notice 'pass: duplicate username refused';
end $$;

-- =====================================================================
-- 6. Two prospects cannot see each other, through RLS, using real ids
-- =====================================================================
-- Resolve the credential's id BEFORE dropping privileges. Reading
-- app_users requires a signed-in context, and this is the moment we are
-- establishing one -- looking it up from inside the transaction left
-- app.user_id null, and every policy that keys off it then returned
-- nothing. The API has no such problem: the id comes from the token.
select set_config('demo.a_user',
  (select id::text from public.app_users
    where tenant_id = current_setting('demo.a')::uuid limit 1), false);

begin;
  set local role app_api;
  select set_config('app.is_staff', 'false', true);
  select set_config('app.tenant_id', current_setting('demo.a'), true);
  select set_config('app.user_id',  current_setting('demo.a_user'), true);
  select set_config('app.role', 'admin', true);

  select pg_temp.check('prospect A sees exactly its own 2 surveys',
                       (select count(*)::int from public.surveys), 2);
  select pg_temp.check('prospect A sees its own 360 responses',
                       (select count(*)::int from public.responses), 360);
commit;

select set_config('app.is_staff', 'true', false);

-- =====================================================================
-- 7. tenant_status drives the login gate
-- =====================================================================
select pg_temp.check('a fresh demo is active',
  app.tenant_status(current_setting('demo.a')::uuid), 'active');

select app.revoke_demo(current_setting('demo.a')::uuid,
                       '0f5e0000-0000-0000-0000-0000000000ff'::uuid);
select pg_temp.check('revoked demo reports revoked',
  app.tenant_status(current_setting('demo.a')::uuid), 'revoked');
select pg_temp.check('revoking disables its accounts',
  (select count(*)::int from app_users
    where tenant_id = current_setting('demo.a')::uuid and status = 'active'), 0);

-- an already-expired tenant reports expired
update tenants set expires_at = now() - interval '1 day', revoked_at = null
 where id = current_setting('demo.b')::uuid;
select pg_temp.check('lapsed demo reports expired',
  app.tenant_status(current_setting('demo.b')::uuid), 'expired');

-- =====================================================================
-- 8. extend_demo revives a lapsed sandbox
-- =====================================================================
select app.extend_demo(current_setting('demo.b')::uuid, interval '7 days',
                       '0f5e0000-0000-0000-0000-0000000000ff'::uuid);
select pg_temp.check('extended demo is active again',
  app.tenant_status(current_setting('demo.b')::uuid), 'active');

-- =====================================================================
-- 9. purge_expired respects the grace period, then deletes
-- =====================================================================
select pg_temp.check('nothing purged inside the grace period',
  app.purge_expired(interval '7 days', '0f5e0000-0000-0000-0000-0000000000ff'::uuid), 0);

update tenants set revoked_at = now() - interval '30 days'
 where id = current_setting('demo.a')::uuid;

select pg_temp.check('lapsed sandbox is purged after grace',
  app.purge_expired(interval '7 days', '0f5e0000-0000-0000-0000-0000000000ff'::uuid), 1);
select pg_temp.check('purge cascaded its survey data away',
  (select count(*)::int from surveys where tenant_id = current_setting('demo.a')::uuid), 0);

-- =====================================================================
-- 10. The staff record outlives the tenant it describes
-- =====================================================================
select pg_temp.check('staff audit retains the purge trail',
  (select count(*)::int from staff_audit where kind = 'tenant.purge'), 1);
select pg_temp.check('template is untouched by all of this',
  (select count(*)::int from surveys
    where tenant_id = (select id from tenants where slug = 'template')), 2);

\echo ''
\echo 'ALL PROVISIONING TESTS PASSED'
