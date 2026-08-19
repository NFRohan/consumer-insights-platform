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

delete from public.responses where meta->>'seed' = 'demo-responses';

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
        (survey_id, msisdn, language, channel, region, status, duration_ms, meta, started_at, submitted_at)
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
