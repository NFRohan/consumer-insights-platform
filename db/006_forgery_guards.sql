-- =====================================================================
-- Stop the client asserting things only the server can know.
--
-- Two findings from the review of the 005 pass, same shape both times:
-- a value the UI sends is written through to a record people later read
-- as evidence.
--
--   audit_logs.actor_id / actor_name  came from the browser, so any
--     member could attribute an action to a colleague. Now stamped from
--     the session, which comes from the verified token.
--
--   distribution_clicks.visitor_key   is chosen by the caller, so a loop
--     could push "unique opens" past the audience size. The key is now
--     derived server-side (see api/public/click.js); this file adds the
--     ceiling that holds even if that derivation is defeated.
--
-- Run order: 001 -> 002 -> 003 -> 004 -> 005 -> 006
-- =====================================================================

begin;

-- =====================================================================
-- audit_logs — the actor is not the client's to choose
--
-- SECURITY DEFINER so the name lookup does not depend on the caller's
-- own read policy: the trigger must produce the same answer whoever
-- fires it, and the id it looks up comes from the verified token rather
-- than from the row being written.
-- =====================================================================
create or replace function app.stamp_audit_actor() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.actor_id := app.current_user_id();
  select coalesce(u.full_name, u.username)
    into new.actor_name
    from public.app_users u
   where u.id = new.actor_id;
  -- Nothing signed in writes here any more (see the audit_insert policy
  -- in 002), but a future SECURITY DEFINER caller might.
  new.actor_name := coalesce(new.actor_name, 'system');
  return new;
end $$;

drop trigger if exists audit_logs_stamp_actor on public.audit_logs;
create trigger audit_logs_stamp_actor
  before insert on public.audit_logs
  for each row execute function app.stamp_audit_actor();

-- =====================================================================
-- record_click — unchanged signature, one new refusal
--
-- p_visitor is now an opaque server-derived signature rather than a
-- browser-minted id, so it identifies a NETWORK CLIENT, not a browser
-- and not a person. Two people sharing an office connection and a
-- browser version count once. That undercounts, which is the safer
-- direction for a figure whose whole purpose is to be trustworthy.
-- =====================================================================
create or replace function app.record_click(p_distribution uuid, p_visitor text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- Ceiling on rows one distribution can accumulate. A caller rotating
  -- network addresses can still defeat the dedupe; it cannot defeat this.
  max_rows constant int := 10000;
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

  if (select count(*) from public.distribution_clicks
       where distribution_id = p_distribution) >= max_rows then
    return false;
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
