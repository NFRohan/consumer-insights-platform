-- Local-dev table grants.
--
-- On hosted Supabase, tables created through the dashboard/SQL editor pick up
-- DML privileges for anon/authenticated automatically. Replaying these
-- migrations against a local `supabase start` stack does not, so anon ends up
-- with only TRIGGER/TRUNCATE/REFERENCES and every PostgREST request fails with
-- 42501 "permission denied for table ...".
--
-- Row Level Security still governs what each role can actually see; these are
-- the table-level privileges RLS is evaluated on top of.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;
grant execute on all functions in schema public
  to anon, authenticated, service_role;

-- Cover anything created after this migration runs.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
