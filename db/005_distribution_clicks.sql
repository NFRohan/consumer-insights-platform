-- =====================================================================
-- Distribution click tracking.
--
-- Replaces the fabricated delivery/click figures the Supabase build
-- computed in the browser (delivered = audience × 0.92, clicked =
-- delivered × 0.66, every time).
--
-- What is now real: a tracked link records one row per distinct browser
-- that opens it. What is still unknowable: delivery. There is no receipt
-- for a link or an embed, so `delivered` is left null and the UI says so
-- rather than inventing a number.
--
-- Run order: 001 -> 002 -> 003 -> 004 -> 005
-- =====================================================================

begin;

-- distributions was never referenced by a child table, so it has no
-- (id, tenant_id) key yet. The composite FK below needs one.
-- Added only when absent: once distribution_clicks references it, a
-- drop-and-recreate fails on the dependency, which would make this file
-- non-re-runnable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'distributions_id_tenant_key'
       and conrelid = 'public.distributions'::regclass
  ) then
    alter table public.distributions
      add constraint distributions_id_tenant_key unique (id, tenant_id);
  end if;
end $$;

-- `delivered` previously defaulted to 0, which reads as "none were
-- delivered" rather than "we cannot know". Make it unknown instead.
alter table public.distributions alter column delivered drop default;
update public.distributions set delivered = null where delivered = 0;

-- =====================================================================
-- distribution_clicks
--
-- visitor_key is an opaque id the respondent's browser mints once and
-- keeps. It identifies a BROWSER, not a person — which is why the UI
-- reports "unique opens" rather than "clicks" or "people".
-- =====================================================================
create table if not exists public.distribution_clicks (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default app.current_tenant()
                    references public.tenants(id) on delete cascade,
  distribution_id uuid not null,
  survey_id       uuid not null,
  visitor_key     text not null,
  response_id     uuid,
  clicked_at      timestamptz not null default now(),
  foreign key (distribution_id, tenant_id)
    references public.distributions(id, tenant_id) on delete cascade,
  foreign key (survey_id, tenant_id)
    references public.surveys(id, tenant_id) on delete cascade,
  -- makes a click idempotent: a refresh cannot inflate the count
  unique (distribution_id, visitor_key)
);
create index if not exists distribution_clicks_dist_idx
  on public.distribution_clicks(tenant_id, distribution_id, clicked_at desc);

alter table public.distribution_clicks enable row level security;
alter table public.distribution_clicks force  row level security;
grant select, insert, update, delete on public.distribution_clicks to app_api;

-- Members may read their own tenant's clicks. Nobody writes directly:
-- app.record_click() is the only writer, so the counter cannot drift.
drop policy if exists distribution_clicks_read on public.distribution_clicks;
create policy distribution_clicks_read on public.distribution_clicks
  for select to app_api
  using (tenant_id = app.current_tenant() and app.current_user_id() is not null);

-- =====================================================================
-- record_click — called by the anonymous respondent page.
--
-- SECURITY DEFINER for the same reason as save_answer: the respondent
-- has no session, must not be able to read collected data, and the
-- insert-then-increment has to be one atomic step.
-- =====================================================================
create or replace function app.record_click(p_distribution uuid, p_visitor text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant  uuid;
  v_survey  uuid;
  v_ins     int;
begin
  if p_visitor is null or length(trim(p_visitor)) = 0 then
    return false;
  end if;

  -- Only for a distribution whose survey is actually open.
  select d.tenant_id, d.survey_id into v_tenant, v_survey
    from public.distributions d
    join public.surveys s on s.id = d.survey_id and s.tenant_id = d.tenant_id
   where d.id = p_distribution
     and s.status = 'live';

  if v_tenant is null then
    raise exception 'no open distribution with that id'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.distribution_clicks
    (tenant_id, distribution_id, survey_id, visitor_key)
  values (v_tenant, p_distribution, v_survey, left(trim(p_visitor), 100))
  on conflict (distribution_id, visitor_key) do nothing;

  get diagnostics v_ins = row_count;

  -- Only a first-time open moves the counter.
  if v_ins > 0 then
    update public.distributions
       set clicked = coalesce(clicked, 0) + 1
     where id = p_distribution;
    return true;
  end if;

  return false;
end $$;

grant execute on all functions in schema app to app_api;

commit;
