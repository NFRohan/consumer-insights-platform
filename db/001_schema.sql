-- =====================================================================
-- Consumer Insights Platform — baseline schema (Neon / plain Postgres)
--
-- Replaces the Supabase-era schema. Three things changed structurally:
--
--   1. No dependency on GoTrue. `profiles` (which had a foreign key into
--      auth.users and a trigger on it) is replaced by `app_users`, which
--      we own outright.
--   2. Every tenant-owned table carries tenant_id, and child rows use a
--      COMPOSITE foreign key on (parent_id, tenant_id). A question can
--      therefore not reference a survey in another tenant even if the
--      application layer has a bug.
--   3. msisdn -> respondent_ref. The column was never really a wallet
--      number; it is whatever identifier the study uses.
--
-- Run order: 001_schema.sql -> 002_rls.sql -> 003_seed_template.sql
-- =====================================================================

begin;

create schema if not exists app;

-- ---------------------------------------------------------------------
-- shared trigger
-- ---------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- session context
--
-- The API sets these per request (transaction-local). Everything unset
-- resolves to NULL, and `tenant_id = NULL` is never true, so a
-- connection with no context sees nothing. Fail-closed by default.
-- ---------------------------------------------------------------------
create or replace function app.current_tenant() returns uuid
language sql stable as $fn$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$fn$;

create or replace function app.current_user_id() returns uuid
language sql stable as $fn$
  select nullif(current_setting('app.user_id', true), '')::uuid
$fn$;

create or replace function app.current_role() returns text
language sql stable as $fn$
  select coalesce(nullif(current_setting('app.role', true), ''), 'anon')
$fn$;

create or replace function app.is_staff() returns boolean
language sql stable as $fn$
  select coalesce(nullif(current_setting('app.is_staff', true), ''), 'false')::boolean
$fn$;

-- =====================================================================
-- tenants — one sandbox. Demo tenants are cloned from the template and
-- expire; the template and internal tenants never do.
-- =====================================================================
create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null,
  kind        text not null default 'demo'
                check (kind in ('template','demo','internal')),
  expires_at  timestamptz,                 -- null = never expires
  revoked_at  timestamptz,                 -- set to kill access early
  notes       text,                        -- who it was issued to, why
  created_by  uuid,                        -- staff user; FK added below
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists tenants_slug_key on public.tenants(slug);
create index if not exists tenants_expiry_idx on public.tenants(expires_at)
  where expires_at is not null;

-- A demo tenant must have an expiry; template/internal must not.
alter table public.tenants drop constraint if exists tenants_expiry_rule;
alter table public.tenants add constraint tenants_expiry_rule check (
  (kind = 'demo' and expires_at is not null)
  or (kind in ('template','internal') and expires_at is null)
);

drop trigger if exists tenants_updated on public.tenants;
create trigger tenants_updated before update on public.tenants
for each row execute function app.set_updated_at();

-- =====================================================================
-- app_users — credentials. Replaces profiles + auth.users.
--
-- Staff (Intelligent Machines operators) have tenant_id null and
-- is_staff true; they never appear inside a prospect's sandbox.
-- =====================================================================
create table if not exists public.app_users (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references public.tenants(id) on delete cascade,
  username       text not null,
  password_hash  text not null,            -- argon2id, produced in the API
  full_name      text,
  email          text,
  role           text not null default 'creator'
                   check (role in ('admin','creator','viewer')),
  department     text,
  is_staff       boolean not null default false,
  status         text not null default 'active'
                   check (status in ('active','pending','inactive')),
  must_change_pw boolean not null default false,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Usernames are compared case-insensitively without needing citext.
create unique index if not exists app_users_username_key
  on public.app_users(lower(username));
create index if not exists app_users_tenant_idx on public.app_users(tenant_id);

-- Staff sit outside tenants; tenant members must belong to one.
alter table public.app_users drop constraint if exists app_users_tenancy_rule;
alter table public.app_users add constraint app_users_tenancy_rule check (
  (is_staff = true and tenant_id is null)
  or (is_staff = false and tenant_id is not null)
);

-- Referenced by the composite FKs further down. Added only when absent:
-- once those FKs exist, dropping it fails on the dependency, which would
-- make this file fail on a second apply.
do $ck$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'app_users_id_tenant_key'
       and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users add constraint app_users_id_tenant_key
      unique (id, tenant_id);
  end if;
end $ck$;

drop trigger if exists app_users_updated on public.app_users;
create trigger app_users_updated before update on public.app_users
for each row execute function app.set_updated_at();

alter table public.tenants drop constraint if exists tenants_created_by_fkey;
alter table public.tenants add constraint tenants_created_by_fkey
  foreign key (created_by) references public.app_users(id) on delete set null;

-- =====================================================================
-- surveys
-- =====================================================================
create table if not exists public.surveys (
  id                 uuid not null default gen_random_uuid(),
  tenant_id          uuid not null default app.current_tenant() references public.tenants(id) on delete cascade,
  name               text not null,
  description        text,
  status             text not null default 'draft'
                       check (status in ('draft','live','closed','archived')),
  scenario           text,
  audience           text,
  audience_count     int default 0,
  branding           jsonb not null default '{}'::jsonb,
  languages          text[] not null default array['en'],
  default_language   text not null default 'en',
  block_resubmission boolean not null default true,
  owner_id           uuid,
  published_at       timestamptz,
  closed_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (id),
  unique (id, tenant_id),
  foreign key (owner_id, tenant_id)
    references public.app_users(id, tenant_id) on delete set null
);
create index if not exists surveys_tenant_idx on public.surveys(tenant_id);
create index if not exists surveys_status_idx on public.surveys(tenant_id, status);

drop trigger if exists surveys_updated on public.surveys;
create trigger surveys_updated before update on public.surveys
for each row execute function app.set_updated_at();

-- =====================================================================
-- questions
-- =====================================================================
create table if not exists public.questions (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null default app.current_tenant() references public.tenants(id) on delete cascade,
  survey_id   uuid not null,
  position    int not null default 0,
  type        text not null,
  text        text not null,
  description text,
  required    boolean not null default false,
  config      jsonb not null default '{}'::jsonb,
  logic       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (id),
  unique (id, tenant_id),
  foreign key (survey_id, tenant_id)
    references public.surveys(id, tenant_id) on delete cascade
);
create index if not exists questions_survey_idx
  on public.questions(tenant_id, survey_id, position);

drop trigger if exists questions_updated on public.questions;
create trigger questions_updated before update on public.questions
for each row execute function app.set_updated_at();

-- =====================================================================
-- responses
-- =====================================================================
create table if not exists public.responses (
  id             uuid not null default gen_random_uuid(),
  tenant_id      uuid not null default app.current_tenant() references public.tenants(id) on delete cascade,
  survey_id      uuid not null,
  respondent_ref text,                     -- phone, customer id, panel id…
  language       text default 'en',
  channel        text,
  region         text,
  status         text not null default 'in_progress'
                   check (status in ('in_progress','completed','partial',
                                     'abandoned','flagged','deleted')),
  duration_ms    int,
  meta           jsonb not null default '{}'::jsonb,
  started_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  created_at     timestamptz not null default now(),
  primary key (id),
  unique (id, tenant_id),
  foreign key (survey_id, tenant_id)
    references public.surveys(id, tenant_id) on delete cascade
);
create index if not exists responses_survey_idx
  on public.responses(tenant_id, survey_id, created_at desc);
create index if not exists responses_status_idx
  on public.responses(tenant_id, survey_id, status);
create index if not exists responses_ref_idx
  on public.responses(tenant_id, respondent_ref);

-- =====================================================================
-- answers
-- =====================================================================
create table if not exists public.answers (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null default app.current_tenant() references public.tenants(id) on delete cascade,
  response_id uuid not null,
  question_id uuid not null,
  survey_id   uuid not null,
  value       jsonb,
  reaction_ms int,
  created_at  timestamptz not null default now(),
  primary key (id),
  foreign key (response_id, tenant_id)
    references public.responses(id, tenant_id) on delete cascade,
  foreign key (question_id, tenant_id)
    references public.questions(id, tenant_id) on delete cascade,
  foreign key (survey_id, tenant_id)
    references public.surveys(id, tenant_id) on delete cascade
);
create unique index if not exists answers_unique
  on public.answers(response_id, question_id);
create index if not exists answers_question_idx on public.answers(tenant_id, question_id);
create index if not exists answers_survey_idx  on public.answers(tenant_id, survey_id);

-- =====================================================================
-- distributions
-- =====================================================================
create table if not exists public.distributions (
  id            uuid not null default gen_random_uuid(),
  tenant_id     uuid not null default app.current_tenant() references public.tenants(id) on delete cascade,
  survey_id     uuid not null,
  channel       text not null
                  check (channel in ('sms','push','email','link','embed','app-in-app')),
  message       text,
  audience_size int default 0,
  sent          int default 0,
  -- No default: there is no delivery receipt for a link or an embed and
  -- no gateway is connected, so "delivered" is unknown rather than zero.
  -- A stored 0 would be a claim we cannot support.
  delivered     int,
  clicked       int not null default 0,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  primary key (id),
  foreign key (survey_id, tenant_id)
    references public.surveys(id, tenant_id) on delete cascade,
  foreign key (created_by, tenant_id)
    references public.app_users(id, tenant_id) on delete set null
);
create index if not exists distributions_survey_idx
  on public.distributions(tenant_id, survey_id);

-- =====================================================================
-- cleaning_rules
-- =====================================================================
create table if not exists public.cleaning_rules (
  id            uuid not null default gen_random_uuid(),
  tenant_id     uuid not null default app.current_tenant() references public.tenants(id) on delete cascade,
  survey_id     uuid not null,
  name          text not null,
  active        boolean not null default true,
  condition     jsonb not null default '{}'::jsonb,
  action        text not null default 'flag' check (action in ('flag','delete')),
  last_run_at   timestamptz,
  flagged_count int default 0,
  deleted_count int default 0,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (id),
  foreign key (survey_id, tenant_id)
    references public.surveys(id, tenant_id) on delete cascade,
  foreign key (created_by, tenant_id)
    references public.app_users(id, tenant_id) on delete set null
);
create index if not exists cleaning_rules_survey_idx
  on public.cleaning_rules(tenant_id, survey_id);

drop trigger if exists cleaning_rules_updated on public.cleaning_rules;
create trigger cleaning_rules_updated before update on public.cleaning_rules
for each row execute function app.set_updated_at();

-- =====================================================================
-- audit_logs
--
-- FR33 asked for the affected response ids on cleaning runs, which the
-- Supabase build never stored. meta carries them now.
-- =====================================================================
create table if not exists public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default app.current_tenant() references public.tenants(id) on delete cascade,
  ts         timestamptz not null default now(),
  actor_id   uuid,
  actor_name text,
  kind       text not null,
  ref        text,
  detail     text,
  meta       jsonb not null default '{}'::jsonb,
  foreign key (actor_id, tenant_id)
    references public.app_users(id, tenant_id) on delete set null
);
create index if not exists audit_ts_idx   on public.audit_logs(tenant_id, ts desc);
create index if not exists audit_kind_idx on public.audit_logs(tenant_id, kind);

-- =====================================================================
-- staff_audit — actions taken in the internal admin portal. Deliberately
-- outside tenant scope: minting and revoking credentials is our record,
-- not a prospect's, and it must survive the tenant being deleted.
-- =====================================================================
create table if not exists public.staff_audit (
  id         uuid primary key default gen_random_uuid(),
  ts         timestamptz not null default now(),
  actor_id   uuid references public.app_users(id) on delete set null,
  actor_name text,
  kind       text not null,       -- 'tenant.mint','tenant.revoke','tenant.extend','tenant.purge'
  tenant_ref text,                -- slug, kept as text so it outlives the row
  detail     text,
  meta       jsonb not null default '{}'::jsonb
);
create index if not exists staff_audit_ts_idx on public.staff_audit(ts desc);

commit;
