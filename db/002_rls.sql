-- =====================================================================
-- Consumer Insights Platform — row level security
--
-- The API is the primary enforcement point: it resolves the caller's
-- tenant from their JWT and never takes tenant_id from the client. RLS
-- is the second, independent layer, so a missing WHERE clause in a
-- handler is a broken query rather than a data leak between prospects.
--
-- Per-request the API issues:
--   select set_config('app.tenant_id', $1, true);   -- true = tx-local
--   select set_config('app.user_id',   $2, true);
--   select set_config('app.role',      $3, true);   -- admin|creator|viewer|anon
--   select set_config('app.is_staff',  $4, true);
--
-- Anything unset resolves to NULL, and `tenant_id = NULL` is never true,
-- so an unscoped connection sees nothing. That is the intended default.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- The API's database role. It must not own the tables, otherwise it
-- would bypass RLS. We also FORCE RLS below so ownership can never
-- silently re-open access.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    create role app_api nologin;
  end if;
end $$;

grant usage on schema public, app to app_api;

-- The API drops to this role per transaction (set local role app_api),
-- so whoever it connects as must be a member of it.
do $$
begin
  execute format('grant app_api to %I', current_user);
exception when others then
  null;  -- already a member, or superuser (implicit)
end $$;

-- Session context helpers (app.current_tenant/user_id/role/is_staff)
-- are defined in 001_schema.sql, since tenant_id defaults depend on them.

-- Can the caller change things inside their tenant?
create or replace function app.can_write() returns boolean
language sql stable as $$
  select app.current_role() in ('admin','creator')
$$;

create or replace function app.is_tenant_admin() returns boolean
language sql stable as $$
  select app.current_role() = 'admin'
$$;

-- Is this survey open to the public respondent flow?
create or replace function app.survey_is_live(p_survey uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.surveys s
     where s.id = p_survey
       and s.tenant_id = app.current_tenant()
       and s.status = 'live'
  )
$$;

grant execute on all functions in schema app to app_api;

-- ---------------------------------------------------------------------
-- enable + force RLS everywhere
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'tenants','app_users','surveys','questions','responses',
    'answers','distributions','cleaning_rules','audit_logs','staff_audit'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema public to app_api;
grant usage, select on all sequences in schema public to app_api;

-- =====================================================================
-- tenants — staff manage all; a tenant member may read only its own row
-- (the app shows the expiry banner from it).
-- =====================================================================
drop policy if exists tenants_staff_all on public.tenants;
create policy tenants_staff_all on public.tenants
  for all to app_api
  using (app.is_staff()) with check (app.is_staff());

-- Signed-in only. An anonymous respondent is inside this tenant's
-- context by design (the API resolves it from the live survey they were
-- sent to), so without the user guard the tenant row -- including the
-- staff-written `notes` -- is readable by anyone holding a survey link.
drop policy if exists tenants_read_own on public.tenants;
create policy tenants_read_own on public.tenants
  for select to app_api
  using (id = app.current_tenant() and app.current_user_id() is not null);

-- =====================================================================
-- app_users — staff may manage any (needed to mint the first account);
-- a tenant admin manages users inside their tenant; everyone else in
-- the tenant may read the directory.
-- =====================================================================
drop policy if exists app_users_staff_all on public.app_users;
create policy app_users_staff_all on public.app_users
  for all to app_api
  using (app.is_staff()) with check (app.is_staff());

-- Signed-in only, for the same reason as tenants above: the respondent
-- flow never needs the directory, and it holds the login usernames.
drop policy if exists app_users_read_tenant on public.app_users;
create policy app_users_read_tenant on public.app_users
  for select to app_api
  using (tenant_id = app.current_tenant() and app.current_user_id() is not null);

drop policy if exists app_users_admin_write on public.app_users;
create policy app_users_admin_write on public.app_users
  for all to app_api
  using (tenant_id = app.current_tenant() and app.is_tenant_admin())
  with check (tenant_id = app.current_tenant() and app.is_tenant_admin()
              and is_staff = false);

-- =====================================================================
-- surveys
-- =====================================================================
drop policy if exists surveys_read on public.surveys;
create policy surveys_read on public.surveys
  for select to app_api
  using (
    tenant_id = app.current_tenant()
    and (app.current_user_id() is not null or status = 'live')
  );

drop policy if exists surveys_write on public.surveys;
create policy surveys_write on public.surveys
  for all to app_api
  using (
    tenant_id = app.current_tenant() and app.can_write()
    and (owner_id = app.current_user_id() or app.is_tenant_admin())
  )
  with check (
    tenant_id = app.current_tenant() and app.can_write()
    and (owner_id = app.current_user_id() or app.is_tenant_admin())
  );

-- =====================================================================
-- questions — readable to signed-in members, and to anonymous
-- respondents when the parent survey is live.
-- =====================================================================
drop policy if exists questions_read on public.questions;
create policy questions_read on public.questions
  for select to app_api
  using (
    tenant_id = app.current_tenant()
    and (app.current_user_id() is not null or app.survey_is_live(survey_id))
  );

drop policy if exists questions_write on public.questions;
create policy questions_write on public.questions
  for all to app_api
  using (
    tenant_id = app.current_tenant() and app.can_write()
    and exists (select 1 from public.surveys s
                 where s.id = survey_id and s.tenant_id = questions.tenant_id
                   and (s.owner_id = app.current_user_id() or app.is_tenant_admin()))
  )
  with check (
    tenant_id = app.current_tenant() and app.can_write()
    and exists (select 1 from public.surveys s
                 where s.id = survey_id and s.tenant_id = questions.tenant_id
                   and (s.owner_id = app.current_user_id() or app.is_tenant_admin()))
  );

-- =====================================================================
-- responses — the public submission path. Anonymous respondents may
-- create and update their own response against a live survey; signed-in
-- members may read and clean everything in the tenant.
-- =====================================================================
drop policy if exists responses_read on public.responses;
create policy responses_read on public.responses
  for select to app_api
  using (tenant_id = app.current_tenant() and app.current_user_id() is not null);

drop policy if exists responses_insert on public.responses;
create policy responses_insert on public.responses
  for insert to app_api
  with check (tenant_id = app.current_tenant() and app.survey_is_live(survey_id));

drop policy if exists responses_update on public.responses;
create policy responses_update on public.responses
  for update to app_api
  using (
    tenant_id = app.current_tenant()
    and (app.survey_is_live(survey_id) or app.can_write())
  )
  with check (tenant_id = app.current_tenant());

drop policy if exists responses_delete on public.responses;
create policy responses_delete on public.responses
  for delete to app_api
  using (tenant_id = app.current_tenant() and app.can_write());

-- =====================================================================
-- answers — same shape as responses
-- =====================================================================
drop policy if exists answers_read on public.answers;
create policy answers_read on public.answers
  for select to app_api
  using (tenant_id = app.current_tenant() and app.current_user_id() is not null);

drop policy if exists answers_write_public on public.answers;
create policy answers_write_public on public.answers
  for insert to app_api
  with check (tenant_id = app.current_tenant() and app.survey_is_live(survey_id));

drop policy if exists answers_update_public on public.answers;
create policy answers_update_public on public.answers
  for update to app_api
  using (
    tenant_id = app.current_tenant()
    and (app.survey_is_live(survey_id) or app.can_write())
  )
  with check (tenant_id = app.current_tenant());

drop policy if exists answers_delete on public.answers;
create policy answers_delete on public.answers
  for delete to app_api
  using (tenant_id = app.current_tenant() and app.can_write());

-- =====================================================================
-- distributions / cleaning_rules — members read, writers write
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['distributions','cleaning_rules'] loop
    execute format($f$
      drop policy if exists %1$s_read on public.%1$I;
      create policy %1$s_read on public.%1$I
        for select to app_api
        using (tenant_id = app.current_tenant() and app.current_user_id() is not null);

      drop policy if exists %1$s_write on public.%1$I;
      create policy %1$s_write on public.%1$I
        for all to app_api
        using (tenant_id = app.current_tenant() and app.can_write())
        with check (tenant_id = app.current_tenant() and app.can_write());
    $f$, t);
  end loop;
end $$;

-- =====================================================================
-- audit_logs — append-only from the app's point of view: members read
-- and insert, nobody updates or deletes.
-- =====================================================================
drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs
  for select to app_api
  using (tenant_id = app.current_tenant() and app.current_user_id() is not null);

-- Signed-in only. An audit trail the audited party can write anonymous
-- entries into is decorative; 006 additionally stamps the actor from the
-- session so a member cannot attribute an action to a colleague.
drop policy if exists audit_insert on public.audit_logs;
create policy audit_insert on public.audit_logs
  for insert to app_api
  with check (tenant_id = app.current_tenant() and app.current_user_id() is not null);

-- =====================================================================
-- staff_audit — staff only, append-only
-- =====================================================================
drop policy if exists staff_audit_read on public.staff_audit;
create policy staff_audit_read on public.staff_audit
  for select to app_api using (app.is_staff());

drop policy if exists staff_audit_insert on public.staff_audit;
create policy staff_audit_insert on public.staff_audit
  for insert to app_api with check (app.is_staff());

commit;
