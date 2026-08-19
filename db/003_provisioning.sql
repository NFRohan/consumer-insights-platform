-- =====================================================================
-- Consumer Insights Platform — demo tenant provisioning
--
-- These run SECURITY DEFINER (as the migration role, which bypasses RLS)
-- because minting reads the template tenant and writes into a new one —
-- two tenants in a single operation, which no single RLS context allows.
--
-- Every one of them refuses to run without staff context, so although
-- app_api may EXECUTE them, a prospect's session cannot.
--
-- Run order: 001_schema.sql -> 002_rls.sql -> 003_provisioning.sql
--            -> 004_seed_template.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- slug helper — readable, url-safe, collision-resistant
-- ---------------------------------------------------------------------
create or replace function app.slugify(p_text text)
returns text language sql immutable as $$
  select trim(both '-' from
           regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'))
$$;

-- ---------------------------------------------------------------------
-- guard used by every entry point below
-- ---------------------------------------------------------------------
create or replace function app.require_staff() returns void
language plpgsql stable as $$
begin
  if not app.is_staff() then
    raise exception 'this operation requires staff context'
      using errcode = 'insufficient_privilege';
  end if;
end $$;

-- =====================================================================
-- provision_demo — create a sandbox, clone the template into it, and
-- mint the single admin credential handed to the prospect.
--
-- The prospect creates any further users themselves from inside the
-- app, which also happens to exercise its user-management screen.
-- =====================================================================
create or replace function app.provision_demo(
  p_name          text,
  p_username      text,
  p_password_hash text,
  p_ttl           interval default interval '3 days',
  p_created_by    uuid     default null,
  p_notes         text     default null
)
returns table (tenant_id uuid, slug text, username text, expires_at timestamptz)
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_tenant    uuid := gen_random_uuid();
  v_admin     uuid := gen_random_uuid();
  v_slug      text;
  v_tpl       uuid;
  v_tpl_owner uuid;
  v_exp       timestamptz := now() + p_ttl;
begin
  perform app.require_staff();

  if p_ttl <= interval '0' then
    raise exception 'ttl must be positive, got %', p_ttl;
  end if;

  select id into v_tpl from public.tenants where kind = 'template' limit 1;
  if v_tpl is null then
    raise exception 'no template tenant — run 004_seed_template.sql first';
  end if;

  if exists (select 1 from public.app_users u where lower(u.username) = lower(p_username)) then
    raise exception 'username % is already taken', p_username
      using errcode = 'unique_violation';
  end if;

  v_slug := left(app.slugify(p_name), 40) || '-' ||
            substr(replace(v_tenant::text, '-', ''), 1, 6);

  insert into public.tenants (id, name, slug, kind, expires_at, notes, created_by)
  values (v_tenant, p_name, v_slug, 'demo', v_exp, p_notes, p_created_by);

  insert into public.app_users (id, tenant_id, username, password_hash,
                                full_name, role, is_staff, status)
  values (v_admin, v_tenant, p_username, p_password_hash,
          p_name || ' (evaluator)', 'admin', false, 'active');

  select owner_id into v_tpl_owner
    from public.surveys where surveys.tenant_id = v_tpl and owner_id is not null limit 1;

  -- --- clone the template, remapping every id ------------------------
  create temp table _m_survey  (old uuid primary key, new uuid) on commit drop;
  create temp table _m_question(old uuid primary key, new uuid) on commit drop;
  create temp table _m_response(old uuid primary key, new uuid) on commit drop;

  insert into _m_survey   select s.id, gen_random_uuid() from public.surveys   s where s.tenant_id = v_tpl;
  insert into _m_question select q.id, gen_random_uuid() from public.questions q where q.tenant_id = v_tpl;
  insert into _m_response select r.id, gen_random_uuid() from public.responses r where r.tenant_id = v_tpl;

  insert into public.surveys (id, tenant_id, name, description, status, scenario,
                              audience, audience_count, branding, languages,
                              default_language, block_resubmission, owner_id,
                              published_at, closed_at)
  select m.new, v_tenant, s.name, s.description, s.status, s.scenario,
         s.audience, s.audience_count, s.branding, s.languages,
         s.default_language, s.block_resubmission, v_admin,
         s.published_at, s.closed_at
    from public.surveys s join _m_survey m on m.old = s.id
   where s.tenant_id = v_tpl;

  insert into public.questions (id, tenant_id, survey_id, position, type, text,
                                description, required, config, logic)
  select mq.new, v_tenant, ms.new, q.position, q.type, q.text,
         q.description, q.required, q.config, q.logic
    from public.questions q
    join _m_question mq on mq.old = q.id
    join _m_survey   ms on ms.old = q.survey_id
   where q.tenant_id = v_tpl;

  insert into public.responses (id, tenant_id, survey_id, respondent_ref, language,
                                channel, region, status, duration_ms, meta,
                                started_at, submitted_at)
  select mr.new, v_tenant, ms.new, r.respondent_ref, r.language,
         r.channel, r.region, r.status, r.duration_ms, r.meta,
         r.started_at, r.submitted_at
    from public.responses r
    join _m_response mr on mr.old = r.id
    join _m_survey   ms on ms.old = r.survey_id
   where r.tenant_id = v_tpl;

  insert into public.answers (tenant_id, response_id, question_id, survey_id,
                              value, reaction_ms)
  select v_tenant, mr.new, mq.new, ms.new, a.value, a.reaction_ms
    from public.answers a
    join _m_response mr on mr.old = a.response_id
    join _m_question mq on mq.old = a.question_id
    join _m_survey   ms on ms.old = a.survey_id
   where a.tenant_id = v_tpl;

  insert into public.cleaning_rules (tenant_id, survey_id, name, active, condition,
                                     action, last_run_at, flagged_count,
                                     deleted_count, created_by)
  select v_tenant, ms.new, c.name, c.active, c.condition, c.action,
         c.last_run_at, c.flagged_count, c.deleted_count, v_admin
    from public.cleaning_rules c join _m_survey ms on ms.old = c.survey_id
   where c.tenant_id = v_tpl;

  insert into public.distributions (tenant_id, survey_id, channel, message,
                                    audience_size, sent, delivered, clicked, created_by)
  select v_tenant, ms.new, d.channel, d.message, d.audience_size,
         d.sent, d.delivered, d.clicked, v_admin
    from public.distributions d join _m_survey ms on ms.old = d.survey_id
   where d.tenant_id = v_tpl;

  insert into public.staff_audit (actor_id, kind, tenant_ref, detail, meta)
  values (p_created_by, 'tenant.mint', v_slug,
          format('Minted %s for %s, expires %s', p_username, p_name, v_exp),
          jsonb_build_object('tenant_id', v_tenant, 'ttl', p_ttl::text));

  return query select v_tenant, v_slug, p_username, v_exp;
end $$;

-- =====================================================================
-- extend_demo — push the expiry out; sales asks for this constantly
-- =====================================================================
create or replace function app.extend_demo(p_tenant uuid, p_extra interval, p_actor uuid default null)
returns timestamptz
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_new timestamptz; v_slug text;
begin
  perform app.require_staff();

  update public.tenants
     set expires_at = greatest(expires_at, now()) + p_extra,
         revoked_at = null
   where id = p_tenant and kind = 'demo'
  returning expires_at, slug into v_new, v_slug;

  if v_new is null then
    raise exception 'no demo tenant with id %', p_tenant;
  end if;

  insert into public.staff_audit (actor_id, kind, tenant_ref, detail, meta)
  values (p_actor, 'tenant.extend', v_slug,
          format('Extended by %s, now expires %s', p_extra, v_new),
          jsonb_build_object('tenant_id', p_tenant));
  return v_new;
end $$;

-- =====================================================================
-- revoke_demo — cut access immediately without destroying the data, so
-- the sandbox can still be inspected or reinstated.
-- =====================================================================
create or replace function app.revoke_demo(p_tenant uuid, p_actor uuid default null)
returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_slug text;
begin
  perform app.require_staff();

  update public.tenants set revoked_at = now()
   where id = p_tenant and kind = 'demo'
  returning slug into v_slug;

  if v_slug is null then
    raise exception 'no demo tenant with id %', p_tenant;
  end if;

  update public.app_users set status = 'inactive' where tenant_id = p_tenant;

  insert into public.staff_audit (actor_id, kind, tenant_ref, detail, meta)
  values (p_actor, 'tenant.revoke', v_slug, 'Access revoked',
          jsonb_build_object('tenant_id', p_tenant));
end $$;

-- =====================================================================
-- purge_expired — hard delete sandboxes that lapsed more than the grace
-- period ago. Cascades clear the tenant's data; staff_audit survives
-- because it is not tenant-scoped.
-- =====================================================================
create or replace function app.purge_expired(p_grace interval default interval '7 days',
                                             p_actor uuid default null)
returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r record; n int := 0;
begin
  perform app.require_staff();

  for r in
    select id, slug from public.tenants
     where kind = 'demo'
       and (   (expires_at is not null and expires_at < now() - p_grace)
            or (revoked_at is not null and revoked_at < now() - p_grace))
  loop
    delete from public.tenants where id = r.id;
    insert into public.staff_audit (actor_id, kind, tenant_ref, detail)
    values (p_actor, 'tenant.purge', r.slug, 'Purged after grace period');
    n := n + 1;
  end loop;
  return n;
end $$;

-- =====================================================================
-- tenant_status — what the login path checks. Kept as one function so
-- the API cannot forget a condition.
-- =====================================================================
create or replace function app.tenant_status(p_tenant uuid)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
           when t.id is null                                  then 'missing'
           when t.revoked_at is not null                      then 'revoked'
           when t.expires_at is not null and t.expires_at < now() then 'expired'
           else 'active'
         end
    from (select 1) dummy
    left join public.tenants t on t.id = p_tenant
$$;

-- =====================================================================
-- public_survey_tenant — the one thing the anonymous respondent path
-- needs before any tenant is known: which tenant owns this survey.
--
-- Deliberately narrow. It takes a survey id and returns a tenant id and
-- nothing else, and only for a survey that is actually live. Staff are
-- given no blanket read over prospect data precisely so that this stays
-- the only way in.
-- =====================================================================
create or replace function app.public_survey_tenant(p_survey uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select tenant_id from public.surveys
   where id = p_survey and status = 'live'
$$;

-- =====================================================================
-- has_completed_response — backs the "block re-submission" toggle.
--
-- The respondent is anonymous and must not be able to read collected
-- responses, so this answers the single yes/no question the respondent
-- page needs and returns nothing else.
-- =====================================================================
create or replace function app.has_completed_response(p_survey uuid, p_ref text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.responses r
      join public.surveys s on s.id = r.survey_id
     where r.survey_id = p_survey
       and s.status = 'live'
       and r.respondent_ref = p_ref
       and r.status = 'completed'
  )
$$;

-- =====================================================================
-- save_answer — the respondent page's per-question save.
--
-- It is an upsert, and ON CONFLICT DO UPDATE requires SELECT permission
-- on the conflicting row. Anonymous respondents deliberately cannot
-- read collected answers, so the upsert happens here instead, behind a
-- function that re-checks the survey is live and that the response
-- really belongs to it.
-- =====================================================================
create or replace function app.save_answer(
  p_response uuid, p_question uuid, p_survey uuid,
  p_value jsonb, p_reaction int default null
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tenant uuid;
begin
  select r.tenant_id into v_tenant
    from public.responses r
    join public.surveys s on s.id = r.survey_id
   where r.id = p_response
     and r.survey_id = p_survey
     and s.id = p_survey
     and s.status = 'live';

  if v_tenant is null then
    raise exception 'no open response for that survey'
      using errcode = 'insufficient_privilege';
  end if;

  -- The question must belong to the same survey and tenant.
  if not exists (
    select 1 from public.questions q
     where q.id = p_question and q.survey_id = p_survey and q.tenant_id = v_tenant
  ) then
    raise exception 'question does not belong to that survey'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.answers (tenant_id, response_id, question_id, survey_id, value, reaction_ms)
  values (v_tenant, p_response, p_question, p_survey, p_value, p_reaction)
  on conflict (response_id, question_id)
  do update set value = excluded.value, reaction_ms = excluded.reaction_ms;
end $$;

grant execute on all functions in schema app to app_api;

commit;
