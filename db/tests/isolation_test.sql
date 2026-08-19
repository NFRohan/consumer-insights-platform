-- =====================================================================
-- Tenant isolation tests.
--
-- Applying the policies without error proves nothing; these prove they
-- actually separate two prospects and gate the public respondent path.
-- Run against a scratch database after 001 + 002.
--
--   psql -v ON_ERROR_STOP=1 -f 001_schema.sql -f 002_rls.sql -f tests/isolation_test.sql
--
-- Every check raises an exception on failure, so a clean run is a pass.
-- =====================================================================

\set QUIET on
set client_min_messages = notice;

-- ---------------------------------------------------------------------
-- fixtures, created as superuser (bypasses RLS)
-- ---------------------------------------------------------------------
insert into public.tenants (id, name, slug, kind, expires_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Prospect A', 'prospect-a', 'demo', now() + interval '3 days'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Prospect B', 'prospect-b', 'demo', now() + interval '3 days');

insert into public.app_users (id, tenant_id, username, password_hash, role) values
  ('a11ce000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'alice', 'x', 'admin'),
  ('b0b00000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'bob',   'x', 'admin');

insert into public.app_users (id, tenant_id, username, password_hash, role, is_staff) values
  ('5aff0000-0000-0000-0000-000000000003', null, 'operator', 'x', 'admin', true);

insert into public.surveys (id, tenant_id, name, status, owner_id) values
  ('50a00000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'A live survey',  'live',  'a11ce000-0000-0000-0000-000000000001'),
  ('50a00000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'A draft survey', 'draft', 'a11ce000-0000-0000-0000-000000000001'),
  ('50b00000-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002', 'B secret survey','live',  'b0b00000-0000-0000-0000-000000000002');

insert into public.questions (id, tenant_id, survey_id, position, type, text) values
  ('91a00000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '50a00000-0000-0000-0000-000000000001', 0, 'single', 'A Q1'),
  ('91b00000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', '50b00000-0000-0000-0000-000000000003', 0, 'single', 'B Q1');

\set QUIET off

-- ---------------------------------------------------------------------
-- helper
-- ---------------------------------------------------------------------
create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL: % — got %, want %', label, got, want;
  end if;
  raise notice 'pass: %', label;
end $$;

-- =====================================================================
-- 1. A signed-in member sees only their own tenant
-- =====================================================================
begin;
  set local role app_api;
  select set_config('app.tenant_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  select set_config('app.user_id',   'a11ce000-0000-0000-0000-000000000001', true);
  select set_config('app.role',      'admin', true);

  select pg_temp.check('tenant A sees its 2 surveys',
                       (select count(*)::int from public.surveys), 2);
  select pg_temp.check('tenant A cannot see B''s survey',
                       (select count(*)::int from public.surveys
                         where id = '50b00000-0000-0000-0000-000000000003'), 0);
  select pg_temp.check('tenant A sees only its own question',
                       (select count(*)::int from public.questions), 1);
commit;

-- =====================================================================
-- 2. The other tenant is symmetric — no leakage in either direction
-- =====================================================================
begin;
  set local role app_api;
  select set_config('app.tenant_id', 'bbbbbbbb-0000-0000-0000-000000000002', true);
  select set_config('app.user_id',   'b0b00000-0000-0000-0000-000000000002', true);
  select set_config('app.role',      'admin', true);

  select pg_temp.check('tenant B sees only its 1 survey',
                       (select count(*)::int from public.surveys), 1);
commit;

-- =====================================================================
-- 3. An unscoped connection sees nothing (the safe default)
-- =====================================================================
begin;
  set local role app_api;
  select pg_temp.check('no tenant context => no surveys',
                       (select count(*)::int from public.surveys), 0);
  select pg_temp.check('no tenant context => no users',
                       (select count(*)::int from public.app_users), 0);
commit;

-- =====================================================================
-- 4. Writing into another tenant is rejected even with valid ids
-- =====================================================================
do $$
declare ok boolean := false;
begin
  begin
    set local role app_api;
    perform set_config('app.tenant_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
    perform set_config('app.user_id',   'a11ce000-0000-0000-0000-000000000001', true);
    perform set_config('app.role',      'admin', true);

    insert into public.surveys (tenant_id, name, status)
    values ('bbbbbbbb-0000-0000-0000-000000000002', 'smuggled into B', 'draft');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL: cross-tenant insert was allowed';
  end if;
  raise notice 'pass: cross-tenant insert is rejected';
end $$;

-- =====================================================================
-- 5. Anonymous respondent: may submit to a LIVE survey…
-- =====================================================================
begin;
  set local role app_api;
  select set_config('app.tenant_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  select set_config('app.user_id',   '', true);      -- not signed in
  select set_config('app.role',      'anon', true);

  insert into public.responses (tenant_id, survey_id, status)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '50a00000-0000-0000-0000-000000000001', 'in_progress');

  select pg_temp.check('anon may see the live survey',
                       (select count(*)::int from public.surveys), 1);
  select pg_temp.check('anon may read live survey questions',
                       (select count(*)::int from public.questions), 1);
  select pg_temp.check('anon may NOT read collected responses',
                       (select count(*)::int from public.responses), 0);
commit;

-- =====================================================================
-- 6. …but not to a DRAFT survey
-- =====================================================================
do $$
declare ok boolean := false;
begin
  begin
    set local role app_api;
    perform set_config('app.tenant_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
    perform set_config('app.user_id',   '', true);
    perform set_config('app.role',      'anon', true);

    insert into public.responses (tenant_id, survey_id, status)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '50a00000-0000-0000-0000-000000000002', 'in_progress');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL: anon submitted to a draft survey';
  end if;
  raise notice 'pass: anon cannot submit to a draft survey';
end $$;

-- =====================================================================
-- 7. A viewer cannot write
-- =====================================================================
do $$
declare ok boolean := false;
begin
  begin
    set local role app_api;
    perform set_config('app.tenant_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
    perform set_config('app.user_id',   'a11ce000-0000-0000-0000-000000000001', true);
    perform set_config('app.role',      'viewer', true);

    insert into public.surveys (tenant_id, name, status)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'viewer should not create this', 'draft');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL: a viewer created a survey';
  end if;
  raise notice 'pass: viewer cannot create surveys';
end $$;

-- =====================================================================
-- 8. Staff see tenants but NOT prospect survey data
-- =====================================================================
begin;
  set local role app_api;
  select set_config('app.tenant_id', '', true);
  select set_config('app.user_id',   '5aff0000-0000-0000-0000-000000000003', true);
  select set_config('app.role',      'admin', true);
  select set_config('app.is_staff',  'true', true);

  select pg_temp.check('staff see all tenants',
                       (select count(*)::int from public.tenants), 2);
  select pg_temp.check('staff do NOT see prospect surveys',
                       (select count(*)::int from public.surveys), 0);
commit;

-- =====================================================================
-- 9. The composite FK blocks a cross-tenant parent reference outright,
--    independently of RLS (checked as superuser).
-- =====================================================================
do $$
declare ok boolean := false;
begin
  begin
    insert into public.questions (tenant_id, survey_id, position, type, text)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '50b00000-0000-0000-0000-000000000003', 1, 'single', 'stolen parent');
  exception when foreign_key_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL: composite FK allowed a cross-tenant parent';
  end if;
  raise notice 'pass: composite FK blocks cross-tenant parents';
end $$;

\echo ''
\echo 'ALL ISOLATION TESTS PASSED'
