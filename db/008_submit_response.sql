-- =====================================================================
-- Let a respondent finish a survey.
--
-- Starting a response and saving answers worked; submitting did not.
-- The page ran a plain UPDATE, which in Postgres must first READ the row
-- it is changing -- so the SELECT policy applies as well as the UPDATE
-- policy, and responses_read requires a signed-in user. The respondent
-- satisfied responses_update and was still filtered out by the read,
-- so the statement matched zero rows, returned success, and the page
-- showed a thank-you screen.
--
-- Every response therefore stayed 'in_progress' forever, which also made
-- completion counts wrong and stopped duplicate-blocking from ever
-- triggering, since that looks for a completed response.
--
-- Same shape as save_answer, record_click and has_completed_response:
-- the anonymous path gets one narrow SECURITY DEFINER function rather
-- than a widened policy.
--
-- Run order: 001 -> ... -> 007 -> 008
-- =====================================================================

begin;

create or replace function app.submit_response(
  p_response uuid,
  p_survey   uuid,
  p_duration bigint default null
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text;
begin
  -- The response must belong to the survey named in the request, and
  -- that survey must still be open. Both are checked here rather than
  -- trusted, because the caller is anonymous.
  select r.status into v_status
    from public.responses r
    join public.surveys s on s.id = r.survey_id and s.tenant_id = r.tenant_id
   where r.id = p_response
     and r.survey_id = p_survey
     and s.status = 'live';

  if v_status is null then
    raise exception 'no open response with that id'
      using errcode = 'insufficient_privilege';
  end if;

  -- Already finished: report success without moving the timestamp, so a
  -- double-tap or a retried request cannot rewrite when they finished.
  if v_status = 'completed' then
    return true;
  end if;

  -- A response removed by a cleaning rule stays removed.
  if v_status <> 'in_progress' then
    return false;
  end if;

  update public.responses
     set status       = 'completed',
         submitted_at = now(),
         -- Clamp: the client measures this, and a wrong number here
         -- would quietly distort the median-duration figure the
         -- dashboard reports. 24 hours is well past any real sitting.
         duration_ms  = case
                          when p_duration is null or p_duration < 0 then null
                          when p_duration > 86400000 then 86400000
                          else p_duration
                        end
   where id = p_response;

  return true;
end $$;

grant execute on all functions in schema app to app_api;

commit;
