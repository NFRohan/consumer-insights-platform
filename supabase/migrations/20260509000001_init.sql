-- =============================================
--  Survey Platform — initial schema
--  Real-time, multi-role survey platform
-- =============================================

-- helper: updated_at trigger function
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- =============================================
-- profiles  (mirrors auth.users, holds role)
-- =============================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'creator' check (role in ('admin','creator','viewer')),
  department text,
  status text not null default 'active' check (status in ('active','pending','inactive')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create trigger profiles_updated before update on public.profiles
for each row execute function public.set_updated_at();

-- list of emails to auto-promote to admin role at signup
-- (also used to elevate any existing profile during migration)
create or replace function public.is_seed_admin(email_arg text)
returns boolean language sql immutable as $$
  select email_arg in ('admin@im.demo');
$$;

-- auto-create profile when user signs up; auto-elevate seed admins
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  assigned_role text;
begin
  if public.is_seed_admin(new.email) then
    assigned_role := 'admin';
  else
    assigned_role := coalesce(new.raw_user_meta_data->>'role','creator');
  end if;
  insert into public.profiles (id, email, full_name, role)
  values (new.id,
          new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          assigned_role)
  on conflict (id) do nothing;
  return new;
end $$;

-- idempotent: if admin already signed up before, promote now
update public.profiles set role = 'admin' where email = 'admin@im.demo';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================
-- surveys
-- =============================================
create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','live','closed','archived')),
  scenario text,
  audience text,
  audience_count int default 0,
  branding jsonb default '{}'::jsonb,
  languages text[] default array['en'],
  default_language text default 'en',
  block_resubmission boolean default true,
  owner_id uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create trigger surveys_updated before update on public.surveys
for each row execute function public.set_updated_at();

create index if not exists surveys_owner_idx on public.surveys(owner_id);
create index if not exists surveys_status_idx on public.surveys(status);

-- =============================================
-- questions
-- =============================================
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  position int not null default 0,
  type text not null,            -- single, multi, dropdown, matrix, rating, slider, rank, text, nps, ...
  text text not null,
  description text,
  required boolean default false,
  config jsonb default '{}'::jsonb, -- options, scale, rows, cols, items, min/max, etc.
  logic jsonb default '{}'::jsonb,  -- skip / branching / piping rules
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create trigger questions_updated before update on public.questions
for each row execute function public.set_updated_at();

create index if not exists questions_survey_idx on public.questions(survey_id, position);

-- =============================================
-- responses (one per respondent submission, possibly anonymous)
-- =============================================
create table if not exists public.responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  msisdn text,                              -- respondent contact reference (FR6)
  language text default 'en',
  channel text,                             -- 'sms','push','embed','app-in-app','link'
  region text,
  status text not null default 'in_progress' check (status in ('in_progress','completed','partial','abandoned','flagged','deleted')),
  duration_ms int,
  meta jsonb default '{}'::jsonb,
  started_at timestamptz default now(),
  submitted_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists responses_survey_idx on public.responses(survey_id, created_at desc);
create index if not exists responses_status_idx on public.responses(survey_id, status);
create index if not exists responses_msisdn_idx on public.responses(msisdn);

-- =============================================
-- answers (one per question per response)
-- =============================================
create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.responses(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  survey_id uuid not null references public.surveys(id) on delete cascade,
  value jsonb,                              -- string / number / array / matrix
  reaction_ms int,
  created_at timestamptz default now()
);
create unique index if not exists answers_unique on public.answers(response_id, question_id);
create index if not exists answers_question_idx on public.answers(question_id);
create index if not exists answers_survey_idx on public.answers(survey_id);

-- =============================================
-- distributions
-- =============================================
create table if not exists public.distributions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  channel text not null check (channel in ('sms','push','email','link','embed','app-in-app')),
  message text,
  audience_size int default 0,
  sent int default 0,
  delivered int default 0,
  clicked int default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists distributions_survey_idx on public.distributions(survey_id);

-- =============================================
-- cleaning_rules
-- =============================================
create table if not exists public.cleaning_rules (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  name text not null,
  active boolean default true,
  condition jsonb default '{}'::jsonb,    -- {logic:'AND'|'OR', clauses:[{field,op,value}]}
  action text not null default 'flag' check (action in ('flag','delete')),
  last_run_at timestamptz,
  flagged_count int default 0,
  deleted_count int default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create trigger cleaning_rules_updated before update on public.cleaning_rules
for each row execute function public.set_updated_at();

-- =============================================
-- audit_logs
-- =============================================
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz default now(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  kind text not null,                       -- 'survey.publish','distribution.sms','role.update','data.clean','auth.login','config.css', etc.
  ref text,
  detail text,
  meta jsonb default '{}'::jsonb
);
create index if not exists audit_ts_idx on public.audit_logs(ts desc);
create index if not exists audit_kind_idx on public.audit_logs(kind);

-- =============================================
-- RLS — Row Level Security
-- =============================================
alter table public.profiles      enable row level security;
alter table public.surveys       enable row level security;
alter table public.questions     enable row level security;
alter table public.responses     enable row level security;
alter table public.answers       enable row level security;
alter table public.distributions enable row level security;
alter table public.cleaning_rules enable row level security;
alter table public.audit_logs    enable row level security;

-- Helper: SECURITY DEFINER admin check (avoids recursive RLS)
create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- profiles: each user sees own profile, all authenticated can see basic info
drop policy if exists "profile_self_read" on public.profiles;
create policy "profile_self_read" on public.profiles
  for select using (auth.uid() is not null);
drop policy if exists "profile_self_update" on public.profiles;
create policy "profile_self_update" on public.profiles
  for update using (auth.uid() = id);
drop policy if exists "profile_admin_full" on public.profiles;
create policy "profile_admin_full" on public.profiles
  for all using (public.is_admin())
  with check (public.is_admin());

-- surveys: authenticated users may read all; only owner or admin may modify
drop policy if exists "surveys_read_auth" on public.surveys;
create policy "surveys_read_auth" on public.surveys
  for select using (auth.uid() is not null);

-- public read of LIVE surveys (so anonymous respondents can fetch)
drop policy if exists "surveys_read_public_live" on public.surveys;
create policy "surveys_read_public_live" on public.surveys
  for select to anon using (status = 'live');

drop policy if exists "surveys_write_owner" on public.surveys;
create policy "surveys_write_owner" on public.surveys
  for all using (
    auth.uid() is not null and (owner_id = auth.uid() or public.is_admin())
  ) with check (
    auth.uid() is not null and (owner_id = auth.uid() or public.is_admin())
  );

-- questions: read for all authenticated AND for anonymous if parent survey is live
drop policy if exists "questions_read_auth" on public.questions;
create policy "questions_read_auth" on public.questions
  for select using (auth.uid() is not null);
drop policy if exists "questions_read_public_live" on public.questions;
create policy "questions_read_public_live" on public.questions
  for select to anon using (
    exists (select 1 from public.surveys s where s.id = survey_id and s.status = 'live')
  );
drop policy if exists "questions_write_owner" on public.questions;
create policy "questions_write_owner" on public.questions
  for all using (
    exists (
      select 1 from public.surveys s
      where s.id = survey_id and (s.owner_id = auth.uid() or public.is_admin())
    )
  ) with check (
    exists (
      select 1 from public.surveys s
      where s.id = survey_id and (s.owner_id = auth.uid() or public.is_admin())
    )
  );

-- responses: anyone (anon) may insert into a LIVE survey; authenticated users may read
drop policy if exists "responses_insert_anyone" on public.responses;
create policy "responses_insert_anyone" on public.responses
  for insert to anon, authenticated with check (
    exists (select 1 from public.surveys s where s.id = survey_id and s.status = 'live')
  );
drop policy if exists "responses_update_anyone" on public.responses;
create policy "responses_update_anyone" on public.responses
  for update to anon, authenticated using (
    exists (select 1 from public.surveys s where s.id = survey_id and s.status = 'live')
  );
drop policy if exists "responses_read_auth" on public.responses;
create policy "responses_read_auth" on public.responses
  for select using (auth.uid() is not null);

-- answers: same pattern
drop policy if exists "answers_insert_anyone" on public.answers;
create policy "answers_insert_anyone" on public.answers
  for insert to anon, authenticated with check (
    exists (select 1 from public.surveys s where s.id = survey_id and s.status = 'live')
  );
drop policy if exists "answers_update_anyone" on public.answers;
create policy "answers_update_anyone" on public.answers
  for update to anon, authenticated using (
    exists (select 1 from public.surveys s where s.id = survey_id and s.status = 'live')
  );
drop policy if exists "answers_read_auth" on public.answers;
create policy "answers_read_auth" on public.answers
  for select using (auth.uid() is not null);

-- distributions, cleaning_rules: authenticated read/write
drop policy if exists "dist_read_auth" on public.distributions;
create policy "dist_read_auth" on public.distributions for select using (auth.uid() is not null);
drop policy if exists "dist_write_auth" on public.distributions;
create policy "dist_write_auth" on public.distributions for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "clean_read_auth" on public.cleaning_rules;
create policy "clean_read_auth" on public.cleaning_rules for select using (auth.uid() is not null);
drop policy if exists "clean_write_auth" on public.cleaning_rules;
create policy "clean_write_auth" on public.cleaning_rules for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- audit_logs: any authenticated may insert, all can read (admin-only could be tightened later)
drop policy if exists "audit_insert" on public.audit_logs;
create policy "audit_insert" on public.audit_logs for insert to authenticated, anon with check (true);
drop policy if exists "audit_read_auth" on public.audit_logs;
create policy "audit_read_auth" on public.audit_logs for select using (auth.uid() is not null);

-- =============================================
-- Realtime publication
-- =============================================
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.responses;
alter publication supabase_realtime add table public.answers;
alter publication supabase_realtime add table public.audit_logs;
alter publication supabase_realtime add table public.surveys;
