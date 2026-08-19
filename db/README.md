# Database — Consumer Insights Platform

Plain Postgres. No Supabase, no extensions required (`gen_random_uuid()` is
built into Postgres 13+, and Neon runs 14–17).

## Run order

```
001_schema.sql        tables, session-context helpers, composite FKs
002_rls.sql           app_api role, policies, FORCE row level security
003_provisioning.sql  mint / extend / revoke / purge  (SECURITY DEFINER)
004_seed_template.sql the template tenant every demo is cloned from
005_distribution_clicks.sql  tracked-link opens; makes `delivered` unknown
006_forgery_guards.sql       audit actor stamped from the session; click ceiling
007_session_validity.sql     expiry/revocation/reset end a session; password reset
008_submit_response.sql      lets a respondent actually finish a survey
```

All files are re-runnable — applying them twice is a no-op, not an error.
`002` in particular is edited in place when a policy changes, so re-apply
it rather than looking for a follow-on file.

Apply as an owner/superuser role (on Neon, the default `neon_superuser`).
The provisioning functions become `SECURITY DEFINER` owned by that role,
which is how they read one tenant and write another in a single call.

## Before the first deploy: grant app_api to the runtime role

Every request runs `set local role app_api`, so **the role the app
connects as must be a member of `app_api`**. `002` grants it to whoever
applies the migration, which is usually not the same role Vercel uses:

```sql
grant app_api to "<the role in DATABASE_URL>";
```

Skip this and Postgres raises `permission denied to set role` on the
first statement of every request. The API turns that into a startup-shaped
error rather than a permission one, precisely because the alternative —
a bare 403 on every endpoint with nothing in the log — is unreadable.

## Testing

Against a throwaway Postgres:

```bash
docker run -d --name cip-test -e POSTGRES_PASSWORD=test -p 55433:5432 postgres:17

for f in 001_schema 002_rls 003_provisioning 004_seed_template \
         005_distribution_clicks 006_forgery_guards 007_session_validity 008_submit_response; do
  docker cp $f.sql cip-test:/tmp/
  docker exec cip-test psql -U postgres -q -v ON_ERROR_STOP=1 -f /tmp/$f.sql
done

docker cp tests/. cip-test:/tmp/
docker exec cip-test psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/isolation_test.sql
docker exec cip-test psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/provisioning_test.sql

# and the JS suites
DATABASE_URL=postgres://postgres:test@localhost:55433/postgres JWT_SECRET=0123456789abcdef0123456789abcdef0123456789   node ../scripts/test-api.mjs
node ../scripts/test-lib.mjs        # pure functions, no database

docker rm -f cip-test
```

Both suites raise an exception on the first failure, so reaching the
final `ALL … PASSED` line is the pass condition. `isolation_test.sql`
expects a clean database (it creates its own fixtures); run it *instead
of* `004`, not after it. `provisioning_test.sql` provisions fixed
usernames, so it too wants a database it has not already run against.

## The two ideas worth knowing

**Composite foreign keys.** Every child references its parent on
`(parent_id, tenant_id)`, not just `parent_id`. A question therefore
cannot point at a survey in another tenant even if a handler forgets a
filter — the database rejects it. RLS is the second layer, not the only
one.

**Fail-closed context.** The API sets `app.tenant_id` per request.
Unset resolves to `NULL`, and `tenant_id = NULL` is never true, so a
connection with no context reads nothing rather than everything.

**No session is not the same as no context.** An anonymous respondent is
placed *inside* the tenant that owns the live survey they were sent to —
that is what lets them submit at all. So `tenant_id = app.current_tenant()`
alone does not mean "a member of this tenant", and every read policy that
is not part of the respondent flow also requires
`app.current_user_id() is not null`. Two policies once omitted it, which
made the user directory and the tenant's internal notes readable by anyone
holding a survey link, without crossing a tenant boundary and so without
failing the isolation suite.

## Session variables the API must set

```sql
select set_config('app.tenant_id', $1, true);  -- true = transaction-local
select set_config('app.user_id',   $2, true);
select set_config('app.role',      $3, true);  -- admin | creator | viewer | anon
select set_config('app.is_staff',  $4, true);
```

Never take `tenant_id` from the client; resolve it from the verified JWT.

## Regenerating the template

`004_seed_template.sql` is generated from `seeds/*.sql` in this
directory. Edit the source seeds and regenerate rather than hand-editing
it.

The seeds are the last thing left from the previous Supabase build --
they were written for it, and they are kept because the template tenant
is still built from them. Everything else that came with it (its
migrations, which contradicted the files above, and its project config)
has been removed.
