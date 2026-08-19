-- =============================================
-- 20260509_02_fix_rls.sql
-- Fix infinite recursion in profiles RLS by routing
-- admin checks through a SECURITY DEFINER function.
-- =============================================

-- Helper: returns true if the current authenticated user is an admin.
-- SECURITY DEFINER bypasses RLS when reading profiles, so calling this
-- from inside another policy never recurses.
create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- Re-create profile_admin_full using the safe function
drop policy if exists "profile_admin_full" on public.profiles;
create policy "profile_admin_full" on public.profiles
  for all using (public.is_admin())
  with check (public.is_admin());

-- Re-create surveys write policy
drop policy if exists "surveys_write_owner" on public.surveys;
create policy "surveys_write_owner" on public.surveys
  for all using (
    auth.uid() is not null and (owner_id = auth.uid() or public.is_admin())
  ) with check (
    auth.uid() is not null and (owner_id = auth.uid() or public.is_admin())
  );

-- Re-create questions write policy
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
