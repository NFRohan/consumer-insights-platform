-- =====================================================================
-- Consumer Insights Platform — template tenant
--
-- GENERATED from supabase/seeds/*.sql by the transform in the rebuild.
-- Do not hand-edit; change the source seeds and regenerate.
--
-- Everything here lands in the single `template` tenant. Minting a demo
-- copies it wholesale (app.provision_demo), so a prospect opens a
-- populated instance rather than an empty one — the analytics screens
-- are the reason the demo lands, and they need data to render.
--
-- Run order: 001 -> 002 -> 003 -> 004
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- the template tenant and its owning account (never handed out)
--
-- Everything below this point inserts unconditionally, so a second apply
-- would give the template a duplicate copy of every survey -- and since
-- provision_demo clones the template wholesale, every prospect minted
-- afterwards would open a doubled instance. Removing the tenant first
-- makes the file rebuild the template rather than add to it; the cascade
-- clears its surveys, questions, responses and answers. Demo tenants are
-- independent clones and are not touched.
-- ---------------------------------------------------------------------
delete from public.tenants where slug = 'template';

insert into public.tenants (name, slug, kind, notes)
values ('Template', 'template', 'template',
        'Source data cloned into every new demo sandbox')
on conflict (slug) do nothing;

insert into public.app_users (tenant_id, username, password_hash, full_name, role, status)
select t.id, 'template.owner', 'x-not-loginable', 'Template Owner', 'admin', 'inactive'
  from public.tenants t where t.slug = 'template'
on conflict do nothing;

-- Point the session at the template so tenant_id defaults resolve to it.
select set_config('app.tenant_id',
                  (select id::text from public.tenants where slug = 'template'), false);

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
  select id into v_owner from public.app_users
   where role = 'admin' and tenant_id = app.current_tenant()
   order by created_at limit 1;
  if v_owner is null then
    select id into v_owner from public.app_users
     where tenant_id = app.current_tenant() order by created_at limit 1;
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


-- =============================================
-- Demo survey: "Northwind Retail Customer Insights — Full Form"
-- Exercises ALL 16 question types AND demonstrates
-- piping, skip logic, and randomization.
--
-- Run AFTER signing up at least one user.
-- Re-running drops the previous version.
-- =============================================

-- clean up any previous run
delete from public.surveys
 where name = 'Northwind Retail Customer Insights — Full Form'
   and tenant_id = app.current_tenant();

do $$
declare
  v_owner uuid;
  v_survey_id uuid;
  v_q1  uuid; v_q2  uuid; v_q3  uuid; v_q4  uuid;
  v_q5  uuid; v_q6  uuid; v_q7  uuid; v_q8  uuid;
  v_q9  uuid; v_q10 uuid; v_q11 uuid; v_q12 uuid;
  v_q13 uuid; v_q14 uuid; v_q15 uuid; v_q16 uuid;
begin
  -- pick the admin (or any) user to own this demo
  select id into v_owner from public.app_users
   where role = 'admin' and tenant_id = app.current_tenant()
   order by created_at limit 1;
  if v_owner is null then
    select id into v_owner from public.app_users
     where tenant_id = app.current_tenant() order by created_at limit 1;
  end if;
  if v_owner is null then
    raise exception 'No profiles found — sign up at least once first.';
  end if;

  -- create the survey shell
  insert into public.surveys (
    name, description, status, owner_id,
    languages, default_language, block_resubmission,
    branding, audience, audience_count
  )
  values (
    'Northwind Retail Customer Insights — Full Form',
    'All 16 question types with piping, skip logic and randomization wired in.',
    'live',
    v_owner,
    array['en'],
    'en',
    false,
    jsonb_build_object(
      'accent', '#E2136B',
      'tagline', 'Help us understand your experience'
    ),
    'Customer panel — opt-in respondents',
    5000
  )
  returning id into v_survey_id;

  -- ---------- 1. Single Select (drives skip + piping) ----------
  insert into public.questions (survey_id, position, type, text, required, config)
  values (
    v_survey_id, 0, 'single',
    'How would you describe your relationship with Northwind Retail today?',
    true,
    jsonb_build_object('options', array[
      'I''m a daily shopper',
      'I shop weekly',
      'I shop monthly',
      'I shop rarely',
      'I''ve never shopped there'
    ])
  ) returning id into v_q1;

  -- ---------- 2. Multi Select (RANDOMIZED options, skip if Q1 = never used) ----------
  insert into public.questions (survey_id, position, type, text, required, config, logic)
  values (
    v_survey_id, 1, 'multi',
    'Which Northwind services do you use? (Select all that apply)',
    false,
    jsonb_build_object(
      'options', array[
        'In-store shopping','Online orders','Click & collect','Home delivery','Gift cards',
        'Loyalty programme','Returns & exchanges','Personal shopper','Subscription box'
      ],
      'randomize', true
    ),
    jsonb_build_object(
      'skip', jsonb_build_object(
        'combinator', 'AND',
        'clauses', jsonb_build_array(
          jsonb_build_object('questionId', v_q1::text, 'op', 'neq', 'value', 'I''ve never shopped there')
        )
      )
    )
  ) returning id into v_q2;

  -- ---------- 3. Dropdown ----------
  insert into public.questions (survey_id, position, type, text, required, config)
  values (
    v_survey_id, 2, 'dropdown',
    'Which region do you live in?',
    true,
    jsonb_build_object('options', array[
      'North','South','East','West','Central','Metro','Coastal','Highlands'
    ])
  ) returning id into v_q3;

  -- ---------- 4. Matrix Grid (RANDOMIZED rows, skip if never-user) ----------
  insert into public.questions (survey_id, position, type, text, required, config, logic)
  values (
    v_survey_id, 3, 'matrix',
    'How would you rate each of the following aspects of Northwind Retail?',
    false,
    jsonb_build_object(
      'rows', array['Checkout speed','Product quality','Customer service','Loyalty rewards','Store locations','Ease of returns'],
      'cols', array['Poor','Fair','Good','Very good','Excellent'],
      'randomize', true
    ),
    jsonb_build_object(
      'skip', jsonb_build_object(
        'combinator', 'AND',
        'clauses', jsonb_build_array(
          jsonb_build_object('questionId', v_q1::text, 'op', 'neq', 'value', 'I''ve never shopped there')
        )
      )
    )
  ) returning id into v_q4;

  -- ---------- 5. Rating Scale (used for piping + downstream skip) ----------
  insert into public.questions (survey_id, position, type, text, required, config, logic)
  values (
    v_survey_id, 4, 'rating',
    'Overall, how satisfied are you with Northwind Retail?',
    true,
    jsonb_build_object(
      'scale', 5,
      'leftLabel', 'Very dissatisfied',
      'rightLabel', 'Very satisfied'
    ),
    jsonb_build_object(
      'skip', jsonb_build_object(
        'combinator', 'AND',
        'clauses', jsonb_build_array(
          jsonb_build_object('questionId', v_q1::text, 'op', 'neq', 'value', 'I''ve never shopped there')
        )
      )
    )
  ) returning id into v_q5;

  -- ---------- 6. Slider (skip if never-user) ----------
  insert into public.questions (survey_id, position, type, text, required, config, logic)
  values (
    v_survey_id, 5, 'slider',
    'Roughly how much do you spend with Northwind Retail per month?',
    false,
    jsonb_build_object('min', 0, 'max', 50000, 'step', 500),
    jsonb_build_object(
      'skip', jsonb_build_object(
        'combinator', 'AND',
        'clauses', jsonb_build_array(
          jsonb_build_object('questionId', v_q1::text, 'op', 'neq', 'value', 'I''ve never shopped there')
        )
      )
    )
  ) returning id into v_q6;

  -- ---------- 7. Drag & Drop Rank (RANDOMIZED items) ----------
  insert into public.questions (survey_id, position, type, text, required, config)
  values (
    v_survey_id, 6, 'rank',
    'Rank these features by how important they are to you. (drag to reorder)',
    false,
    jsonb_build_object(
      'items', array[
        'Faster checkout','Lower prices','Better product quality','More loyalty rewards','More store locations'
      ],
      'randomize', true
    )
  ) returning id into v_q7;

  -- ---------- 8. Open Text (PIPING + skip — only ask "what to improve" if they rated us low) ----------
  insert into public.questions (survey_id, position, type, text, required, config, logic)
  values (
    v_survey_id, 7, 'text',
    'You rated us {{Q5}}/5. What''s the one thing we could improve?',
    false,
    jsonb_build_object(
      'placeholder', 'Tell us in your own words…',
      'minChars', 0,
      'maxChars', 500,
      'pipingFallback', 'thanks for your honest feedback'
    ),
    jsonb_build_object(
      'skip', jsonb_build_object(
        'combinator', 'AND',
        'clauses', jsonb_build_array(
          jsonb_build_object('questionId', v_q5::text, 'op', 'lte', 'value', '3')
        )
      )
    )
  ) returning id into v_q8;

  -- ---------- 9. Video Stimulus ----------
  insert into public.questions (survey_id, position, type, text, required, config)
  values (
    v_survey_id, 8, 'video',
    'Watch this short clip and share your reaction.',
    false,
    jsonb_build_object(
      'url', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
    )
  ) returning id into v_q9;

  -- ---------- 10. Hotspot / Click Map ----------
  insert into public.questions (survey_id, position, type, text, required, config)
  values (
    v_survey_id, 9, 'hotspot',
    'Click on the part of the store layout you visit most.',
    false,
    jsonb_build_object(
      'url', 'https://placehold.co/600x400/png?text=Northwind+store+layout'
    )
  ) returning id into v_q10;

  -- ---------- 11. Image Options (RANDOMIZED, with "Other" pinned) ----------
  insert into public.questions (survey_id, position, type, text, required, config)
  values (
    v_survey_id, 10, 'image-opt',
    'Which colour palette feels most like Northwind to you?',
    false,
    jsonb_build_object(
      'options', array['🟪','🟦','🟩','🟧','⬛'],
      'randomize', 'pin-last'
    )
  ) returning id into v_q11;

  -- ---------- 12. Reaction Time / IAT ----------
  insert into public.questions (survey_id, position, type, text, required, config)
  values (
    v_survey_id, 11, 'iat',
    'Quick! React as fast as you can.',
    false,
    jsonb_build_object(
      'reactionTime', true,
      'stimulus', 'Northwind',
      'options', array['Positive','Negative']
    )
  ) returning id into v_q12;

  -- ---------- 13. Fill in the Blanks ----------
  insert into public.questions (survey_id, position, type, text, required, config)
  values (
    v_survey_id, 12, 'fill',
    'Complete the sentence:',
    false,
    jsonb_build_object(
      'template', 'Shopping with Northwind makes my week ___ and the one thing I miss is ___.'
    )
  ) returning id into v_q13;

  -- ---------- 14. Audio Response (only if rating ≤ 3 OR detractor on NPS) ----------
  insert into public.questions (survey_id, position, type, text, required, config)
  values (
    v_survey_id, 13, 'audio',
    'Record a short voice message for our product team. (30 seconds max)',
    false,
    jsonb_build_object('maxSeconds', 30)
  ) returning id into v_q14;

  -- ---------- 15. NPS (with PIPING — references Q1) ----------
  insert into public.questions (survey_id, position, type, text, required, config)
  values (
    v_survey_id, 14, 'nps',
    'You said you''re {{Q1}} — how likely are you to recommend Northwind Retail to a friend or colleague?',
    true,
    jsonb_build_object('scale', 11, 'pipingFallback', 'a customer')
  ) returning id into v_q15;

  -- ---------- 16. Constant Sum ----------
  insert into public.questions (survey_id, position, type, text, required, config)
  values (
    v_survey_id, 15, 'constant-sum',
    'You have 100 points to allocate across these priorities — give more to what matters most.',
    false,
    jsonb_build_object(
      'total', 100,
      'items', array['Checkout speed','Loyalty rewards','Product quality','Customer service','Store locations']
    )
  ) returning id into v_q16;

  -- Now that we know v_q15, retrofit Q14's skip rule:
  -- show audio question only when NPS (Q15) <= 6 (detractors)
  update public.questions
     set logic = jsonb_build_object(
       'skip', jsonb_build_object(
         'combinator', 'OR',
         'clauses', jsonb_build_array(
           jsonb_build_object('questionId', v_q5::text, 'op', 'lte', 'value', '3'),
           jsonb_build_object('questionId', v_q15::text, 'op', 'lte', 'value', '6')
         )
       )
     )
   where id = v_q14;

  -- Retrofit Q8's skip rule to also include detractors (NPS ≤ 6) via OR
  update public.questions
     set logic = jsonb_build_object(
       'skip', jsonb_build_object(
         'combinator', 'OR',
         'clauses', jsonb_build_array(
           jsonb_build_object('questionId', v_q5::text,  'op', 'lte', 'value', '3'),
           jsonb_build_object('questionId', v_q15::text, 'op', 'lte', 'value', '6')
         )
       )
     )
   where id = v_q8;

  -- Update survey-level branding with summary metadata for the Logic / Randomize modals
  update public.surveys
     set branding = branding || jsonb_build_object(
       'randomization', jsonb_build_object(
         'block', false,
         'option', false,
         'perQuestion', jsonb_build_object(
           v_q2::text,  'random',
           v_q4::text,  'random',
           v_q7::text,  'random',
           v_q11::text, 'pin-last'
         )
       ),
       'logicRules', jsonb_build_array(
         jsonb_build_object('id','r1','target', v_q2::text,
           'conditions', jsonb_build_array(jsonb_build_object('q', v_q1::text, 'op', 'neq', 'v', 'I''ve never shopped there')),
           'join','AND','then','show'),
         jsonb_build_object('id','r2','target', v_q4::text,
           'conditions', jsonb_build_array(jsonb_build_object('q', v_q1::text, 'op', 'neq', 'v', 'I''ve never shopped there')),
           'join','AND','then','show'),
         jsonb_build_object('id','r3','target', v_q5::text,
           'conditions', jsonb_build_array(jsonb_build_object('q', v_q1::text, 'op', 'neq', 'v', 'I''ve never shopped there')),
           'join','AND','then','show'),
         jsonb_build_object('id','r4','target', v_q6::text,
           'conditions', jsonb_build_array(jsonb_build_object('q', v_q1::text, 'op', 'neq', 'v', 'I''ve never shopped there')),
           'join','AND','then','show'),
         jsonb_build_object('id','r5','target', v_q8::text,
           'conditions', jsonb_build_array(
             jsonb_build_object('q', v_q5::text,  'op', 'lte', 'v', '3'),
             jsonb_build_object('q', v_q15::text, 'op', 'lte', 'v', '6')),
           'join','OR','then','show'),
         jsonb_build_object('id','r6','target', v_q14::text,
           'conditions', jsonb_build_array(
             jsonb_build_object('q', v_q5::text,  'op', 'lte', 'v', '3'),
             jsonb_build_object('q', v_q15::text, 'op', 'lte', 'v', '6')),
           'join','OR','then','show')
       )
     )
   where id = v_survey_id;

  raise notice 'Full-form demo created. Survey ID = %', v_survey_id;
end $$;


-- =============================================
-- Demo responses for the seeded surveys.
--
-- The repo's own seeds create live surveys but no responses, which leaves the
-- Live dashboard, Cross-tab, Sentiment, Funnel and Data-cleaning views empty.
-- This generates realistic answers for every question type so those screens
-- have something to render.
--
-- Safe to re-run: it deletes only rows it created (meta->>'seed').
-- Run AFTER demo_survey.sql and full_question_types.sql.
-- =============================================

delete from public.responses
 where meta->>'seed' = 'demo-responses' and tenant_id = app.current_tenant();

do $$
declare
  v_survey       record;
  v_q            record;
  v_resp_id      uuid;
  v_n            int;
  v_total        int;
  v_status       text;
  v_started      timestamptz;
  v_duration     int;
  v_rnd          numeric;
  v_val          jsonb;
  v_reaction     int;
  v_answered     boolean;
  v_max_pos      int;

  c_regions   text[] := array['North','South','East','West','Central','Metro','Coastal','Highlands'];
  c_channels  text[] := array['sms','push','embed','app-in-app','link'];

  -- Open-text answers deliberately contain the keywords the sentiment
  -- classifier scores on, so the Sentiment view has a realistic split.
  c_pos_text  text[] := array[
    'The store is well laid out and checkout is smooth, very satisfied overall.',
    'Checkout is quick and reliable, best shop in the area.',
    'Excellent service, returns are easy and the staff are helpful.',
    'Love the loyalty rewards, the app is smooth and easy to use.',
    'Great experience, the shelves are always stocked and I am happy with it.',
    'Perfect for the weekly shop, quick and reliable every time.',
    'Customer service was helpful and the issue was resolved fast.',
    'Amazing range, and easy for my parents to find what they need.'
  ];
  c_neg_text  text[] := array[
    'The queues are slow at peak hours and delivery charges are expensive.',
    'Delivery charge is too expensive, that is my main problem.',
    'Very confusing layout after the refit, I could not find anything.',
    'Customer service was unhelpful and my problem is still not fixed.',
    'Half the shelves were empty, terrible experience this month.',
    'The return policy is bad, and the website is slow to load.',
    'Disappointed with the new layout, it is difficult to navigate.',
    'My order failed twice and the refund was slow to arrive.'
  ];
  c_neu_text  text[] := array[
    'It works as expected for my weekly shop.',
    'No strong opinion, I mainly go there for household items.',
    'Mostly fine, though I only visit once or twice a month.',
    'I use it for weekly groceries and nothing else really.',
    'Average experience, similar to other shops I have tried.'
  ];
  c_fill_text text[] := array[
    'easier and the one thing I miss is lower prices.',
    'simpler and the one thing I miss is a wider product range.',
    'faster and the one thing I miss is better loyalty rewards.',
    'cheaper and the one thing I miss is a quicker returns desk.'
  ];
begin
  -- Deterministic output across runs.
  perform setseed(0.42);

  for v_survey in
    select id, name,
           case when name like 'Q2 Brand Pulse%' then 220 else 140 end as target
    from public.surveys
    where name like 'Q2 Brand Pulse%'
       or name like 'Northwind Retail Customer Insights%'
  loop
    select max(position) into v_max_pos from public.questions where survey_id = v_survey.id;
    v_total := v_survey.target;

    for v_n in 1..v_total loop
      v_rnd := random();
      -- Mix of outcomes so the funnel and cleaning views have material.
      v_status := case
                    when v_rnd < 0.76 then 'completed'
                    when v_rnd < 0.85 then 'partial'
                    when v_rnd < 0.94 then 'abandoned'
                    else 'flagged'
                  end;

      v_started  := now() - (random() * interval '14 days');
      v_duration := 45000 + floor(random() * 420000)::int;

      insert into public.responses
        (survey_id, respondent_ref, language, channel, region, status, duration_ms, meta, started_at, submitted_at)
      values (
        v_survey.id,
        '555' || lpad(floor(random() * 10000000)::bigint::text, 7, '0'),
        case when random() < 0.35 then 'bn' else 'en' end,
        c_channels[1 + floor(random() * array_length(c_channels, 1))::int],
        c_regions[1 + floor(random() * array_length(c_regions, 1))::int],
        v_status,
        v_duration,
        jsonb_build_object('seed', 'demo-responses'),
        v_started,
        case when v_status in ('completed', 'flagged')
             then v_started + (v_duration || ' milliseconds')::interval
             else null end
      )
      returning id into v_resp_id;

      -- Abandoned respondents never answered anything.
      if v_status = 'abandoned' then
        continue;
      end if;

      for v_q in
        select id, type, config, position
        from public.questions
        where survey_id = v_survey.id
        order by position
      loop
        -- Partial respondents drop off partway through.
        v_answered := case
                        when v_status = 'partial'
                          then v_q.position <= greatest(1, floor(v_max_pos * 0.4)::int)
                        else true
                      end;
        if not v_answered then
          continue;
        end if;

        v_reaction := null;
        v_rnd := random();

        v_val := case v_q.type

          when 'single' then
            to_jsonb(v_q.config->'options'->>
              (floor(random() * jsonb_array_length(v_q.config->'options'))::int))

          when 'dropdown' then
            -- Weight toward the first region so the cross-tab has a dominant cell.
            to_jsonb(v_q.config->'options'->>
              (case when random() < 0.38 then 0
                    else floor(random() * jsonb_array_length(v_q.config->'options'))::int end))

          when 'image-opt' then
            to_jsonb(v_q.config->'options'->>
              (floor(random() * jsonb_array_length(v_q.config->'options'))::int))

          when 'multi' then
            (select coalesce(jsonb_agg(o), '[]'::jsonb)
               from (select o from jsonb_array_elements_text(v_q.config->'options') o
                     order by random()
                     limit 1 + floor(random() * 4)::int) t)

          when 'rank' then
            (select coalesce(jsonb_agg(i order by random()), '[]'::jsonb)
               from jsonb_array_elements_text(v_q.config->'items') i)

          when 'matrix' then
            -- Spread across the whole scale, skewed positive, so the heat-map
            -- in the cross-tab view actually has contrast.
            (select jsonb_object_agg(
                      r,
                      v_q.config->'cols'->>
                        (case
                           when random() < 0.05 then 0
                           when random() < 0.16 then 1
                           when random() < 0.44 then 2
                           when random() < 0.78 then 3
                           else 4
                         end)
                    )
               from jsonb_array_elements_text(v_q.config->'rows') r)

          when 'rating' then
            -- Skew positive: mostly 4s and 5s.
            to_jsonb(case when v_rnd < 0.44 then 5
                          when v_rnd < 0.74 then 4
                          when v_rnd < 0.89 then 3
                          when v_rnd < 0.96 then 2
                          else 1 end)

          when 'nps' then
            -- ~45% promoters, ~30% passives, ~25% detractors.
            to_jsonb(case when v_rnd < 0.45 then 9 + floor(random() * 2)::int
                          when v_rnd < 0.75 then 7 + floor(random() * 2)::int
                          else floor(random() * 7)::int end)

          when 'slider' then
            to_jsonb(
              (coalesce((v_q.config->>'step')::int, 500) *
               floor(
                 (coalesce((v_q.config->>'min')::int, 0) +
                  random() * (coalesce((v_q.config->>'max')::int, 50000) -
                              coalesce((v_q.config->>'min')::int, 0)))
                 / coalesce((v_q.config->>'step')::int, 500)
               )::int)
            )

          when 'text' then
            to_jsonb(case when v_rnd < 0.52 then c_pos_text[1 + floor(random() * array_length(c_pos_text, 1))::int]
                          when v_rnd < 0.83 then c_neg_text[1 + floor(random() * array_length(c_neg_text, 1))::int]
                          else c_neu_text[1 + floor(random() * array_length(c_neu_text, 1))::int] end)

          when 'fill' then
            to_jsonb(c_fill_text[1 + floor(random() * array_length(c_fill_text, 1))::int])

          when 'iat' then
            to_jsonb(v_q.config->'options'->>
              (case when random() < 0.68 then 0 else 1 end))

          when 'constant-sum' then
            -- Random split that still totals exactly 100.
            (select jsonb_object_agg(item, share)
               from (
                 select item,
                        case when rn = cnt
                             then 100 - sum(base) over (order by rn rows between unbounded preceding and 1 preceding)
                             else base end as share
                   from (
                     select item,
                            row_number() over (order by item) as rn,
                            count(*) over () as cnt,
                            greatest(5, floor(random() * 30)::int) as base
                       from jsonb_array_elements_text(v_q.config->'items') item
                   ) w
               ) z)

          when 'audio' then
            to_jsonb('[voice note ' || (6 + floor(random() * 22))::int || 's]')

          when 'video' then
            to_jsonb(case when random() < 0.6 then 'Watched in full' else 'Skipped after a few seconds' end)

          when 'hotspot' then
            to_jsonb(jsonb_build_object('x', round((random() * 600)::numeric, 1),
                                        'y', round((random() * 400)::numeric, 1)))

          else to_jsonb('n/a'::text)
        end;

        if v_q.type = 'iat' then
          v_reaction := 380 + floor(random() * 900)::int;
        end if;

        insert into public.answers (response_id, question_id, survey_id, value, reaction_ms)
        values (v_resp_id, v_q.id, v_survey.id, v_val, v_reaction)
        on conflict (response_id, question_id) do nothing;
      end loop;
    end loop;

    raise notice 'Seeded % responses for %', v_total, v_survey.name;
  end loop;
end $$;


select set_config('app.tenant_id', '', false);

commit;
