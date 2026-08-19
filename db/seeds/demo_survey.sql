-- =============================================
-- Demo survey: Brand Pulse 2026
-- Demonstrates Skip Logic, Piping, Randomization
-- Run AFTER signing up at least one user.
-- =============================================

do $$
declare
  v_owner uuid;
  v_survey_id uuid;
  v_q1 uuid;
  v_q2 uuid;
  v_q3 uuid;
  v_q4 uuid;
  v_q5 uuid;
  v_q6 uuid;
begin
  -- pick the admin (or any) user to own the demo
  select id into v_owner from public.profiles
   where role = 'admin' order by created_at limit 1;
  if v_owner is null then
    select id into v_owner from public.profiles order by created_at limit 1;
  end if;
  if v_owner is null then
    raise exception 'No profiles found — sign up at least once first.';
  end if;

  -- create the survey, LIVE so we can preview/respond immediately
  insert into public.surveys (name, description, status, owner_id, languages, default_language,
                              block_resubmission, branding, audience, audience_count)
  values (
    'Q2 Brand Pulse — Demo',
    'Demo of skip logic, piping, and randomization',
    'live',
    v_owner,
    array['en', 'bn'],
    'en',
    true,
    jsonb_build_object(
      'accent', '#151515',
      'tagline', 'Tell us how we''re doing — 2 minutes',
      'randomization', jsonb_build_object(
        'block', false,
        'option', true,
        'perQuestion', jsonb_build_object()
      )
    ),
    'Loyalty members — Metro region',
    30000
  )
  returning id into v_survey_id;

  -- Q1 — Single select (no logic; feeds piping into Q2 + skip into Q3)
  insert into public.questions (id, survey_id, position, type, text, required, config)
  values (
    gen_random_uuid(), v_survey_id, 0, 'single',
    'How often did you shop with Northwind Retail in the past 30 days?',
    true,
    jsonb_build_object('options', array['Daily','2-3 times per week','Weekly','Monthly','Rarely / Never'])
  ) returning id into v_q1;

  -- Q2 — NPS, with piping reference to Q1
  insert into public.questions (id, survey_id, position, type, text, required, config)
  values (
    gen_random_uuid(), v_survey_id, 1, 'nps',
    'You said you shop with us {{Q1}} — how likely are you to recommend Northwind Retail to a friend or colleague?',
    true,
    jsonb_build_object('scale', 11)
  ) returning id into v_q2;

  -- Q3 — Open text follow-up: ONLY shown when Q2 < 9 (detractors + passives)
  insert into public.questions (id, survey_id, position, type, text, required, config, logic)
  values (
    gen_random_uuid(), v_survey_id, 2, 'text',
    'What''s the main reason for giving us that score?',
    false,
    jsonb_build_object('placeholder', 'Tell us a bit more…', 'maxChars', 500),
    jsonb_build_object(
      'skip', jsonb_build_object(
        'combinator', 'AND',
        'clauses', jsonb_build_array(
          jsonb_build_object('questionId', v_q2::text, 'op', 'lt', 'value', '9')
        )
      )
    )
  ) returning id into v_q3;

  -- Q4 — Drag/drop rank with randomized items (perQuestion config)
  insert into public.questions (id, survey_id, position, type, text, required, config)
  values (
    gen_random_uuid(), v_survey_id, 3, 'rank',
    'Rank these features by how important they are to you.',
    false,
    jsonb_build_object(
      'items', array['Faster checkout','Lower prices','Better loyalty rewards','Wider product range','More store locations'],
      'randomize', true
    )
  ) returning id into v_q4;

  -- Q5 — Single select with randomized options ("Other" pinned last)
  insert into public.questions (id, survey_id, position, type, text, required, config)
  values (
    gen_random_uuid(), v_survey_id, 4, 'single',
    'Which feature would you most like us to improve next?',
    false,
    jsonb_build_object(
      'options', array['Checkout speed','Loyalty rewards','Customer service','Product pricing','Store locations','Other'],
      'randomize', 'pin-last'
    )
  ) returning id into v_q5;

  -- Q6 — Matrix grid (always shown, demonstrates rich layout)
  insert into public.questions (id, survey_id, position, type, text, required, config)
  values (
    gen_random_uuid(), v_survey_id, 5, 'matrix',
    'How would you rate each of the following?',
    false,
    jsonb_build_object(
      'rows', array['Checkout speed','Loyalty rewards','Customer service','Product availability'],
      'cols', array['Poor','Fair','Good','Very good','Excellent']
    )
  ) returning id into v_q6;

  -- attach randomization config + skip logic to survey-level branding
  update public.surveys
     set branding = branding || jsonb_build_object(
       'randomization', jsonb_build_object(
         'block', false,
         'option', true,
         'perQuestion', jsonb_build_object(
           v_q4::text, 'random',
           v_q5::text, 'pin-last'
         )
       ),
       'logicRules', jsonb_build_array(
         jsonb_build_object(
           'id', 'r1',
           'target', v_q3::text,
           'conditions', jsonb_build_array(
             jsonb_build_object('q', v_q2::text, 'op', 'lt', 'v', '9')
           ),
           'join', 'AND',
           'then', 'show'
         )
       )
     )
   where id = v_survey_id;

  raise notice 'Demo survey created. ID = %', v_survey_id;
end $$;
