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
 where name = 'Northwind Retail Customer Insights — Full Form';

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
  select id into v_owner from public.profiles
   where role = 'admin' order by created_at limit 1;
  if v_owner is null then
    select id into v_owner from public.profiles order by created_at limit 1;
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
