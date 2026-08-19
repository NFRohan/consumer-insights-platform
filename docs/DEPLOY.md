# Deploying to Vercel + Neon

**Live: https://consumer-insights-platform.vercel.app**
Repo: https://github.com/NFRohan/consumer-insights-platform (public)

Deployed and verified. Pushing to `main` redeploys; branches get preview
URLs. The rest of this file is why it is set up the way it is, and what
to check when something changes.

## What is already true

Neon project `neondb`, region `ap-southeast-1` (Singapore), Postgres 18.6.
All six files in `db/` are applied. Seeded with the template tenant
(2 surveys, 22 questions, 360 responses, 3074 answers) and one staff
account, `IM.Admin`.

Verified against that database, not just locally:

| suite | result |
|---|---|
| `db/tests/isolation_test.sql` | 15/15 |
| `db/tests/provisioning_test.sql` | 23/23 |
| `scripts/test-api.mjs` (pooled endpoint) | 51/51 |
| end-to-end: mint → sign in → respond → revoke → purge | passed |

The isolation run on Neon matters more than the local one. Locally the
suites run as `postgres`, a superuser, who **bypasses RLS entirely** —
so the only thing standing between tenants was `set local role app_api`.
On Neon the role is `neondb_owner`, which is not a superuser, so
`FORCE ROW LEVEL SECURITY` is genuinely engaged and the policies are
doing the work they claim to. That is the configuration the guarantees
were written for, and it is the one that has now been tested.

## Vercel project settings

Framework preset **Vite**, build `npm run build`, output `dist`. Both are
detected; nothing to override.

Environment variables — the three from `.env`, set for Production,
Preview and Development:

| name | value |
|---|---|
| `DATABASE_URL` | the Neon **pooled** string (host contains `-pooler`) |
| `JWT_SECRET` | the 64-character value in `.env` |
| `SESSION_TTL_SECONDS` | `43200` (optional; 12h, still capped by the tenant's expiry) |
| `PGPOOL_MAX` | `3` (optional) |

`VITE_POLL_MS` is bundled into the browser JS and is not a secret.

Do not point `DATABASE_URL` at the direct endpoint. Every serverless
invocation opens its own connection; the pooler is what keeps that from
exhausting the database.

## The region is not optional

`vercel.json` pins `"regions": ["sin1"]`. Vercel otherwise defaults to
`iad1` (Washington), and this Neon lives in Singapore.

A request costs three database round trips (session preamble, the query
itself, commit). At the ~2 ms of a same-region hop that is invisible. At
the ~220 ms of a Washington↔Singapore hop it is roughly **two thirds of
a second of pure waiting per API call**, on a demo whose whole job is to
feel finished. Measured from Dhaka against this database: 152 ms for a
full transaction, against 247 ms before the preamble was batched.

If the plan will not accept `sin1`, move the Neon project to match the
function region instead. Do not leave them on separate continents.

Confirmed live: `X-Vercel-Id: bom1::sin1::…` — the request enters at the
Mumbai edge and the function runs in Singapore. Measured against the
deployment, a login (one Neon transaction plus a scrypt verify) costs
**~60 ms more than an endpoint that never opens a connection**, so the
database is no longer the thing you wait for.

## Nine functions

Vercel makes one function per `.js` under `api/`, except paths beginning
with `_` — which is why the shared code lives in `api/_lib/` and does not
become a route.

```
/api/data                      /api/auth/login    /api/public/answer
/api/admin/tenants             /api/auth/me       /api/public/check-resubmission
/api/admin/actions                                /api/public/click
/api/admin/audit
```

Nine, against the Hobby ceiling of twelve. Worth knowing before adding
endpoints: past twelve the deployment is rejected, and the fix is to
merge routes rather than to discover it at deploy time.

## Migrations, after the first deploy

Apply `db/*.sql` over the **direct** endpoint (the same host without
`-pooler`) — they are schema changes, not concurrent traffic. Every file
is idempotent; re-applying the set is a no-op. Run order and the reasons
are in `db/README.md`.

## If every endpoint returns 403 "not permitted"

The connecting role is not a member of `app_api`. It is here, because
migrations and the app both use `neondb_owner` and `002_rls.sql` grants
membership to whoever applies it. It stops being true the moment you
give the app its own role:

```sql
grant app_api to "<the role in DATABASE_URL>";
```

`api/_lib/db.js` catches this specific failure and raises a named error
rather than letting it surface as a bare 403, but the grant is still the
fix.

## Environment variables are set for Production and Preview only

Not Development. Vercel stores Development values *decryptable* so
`vercel env pull` can write them into `.env.local` — which would put the
live database password in a readable field to serve a workflow this
project does not use. `vite.config.js` reimplements Vercel's `api/`
routing for `npm run dev`, so `vercel dev` is never needed and local work
reads `.env` directly.

## After the first deploy, check

1. `/` loads and shows the sign-in screen.
2. `/staff` — sign in as `IM.Admin`, mint a 3-day evaluation.
3. Sign in as the minted credential in a private window: two surveys,
   360 responses, and an expiry chip in the top bar.
4. Open a survey's public link with no session — it should render.
5. Revoke from `/staff`; the prospect's next request should say the
   access was withdrawn rather than silently signing them out.

## What is deliberately not here

The previous backend's files are gone: its migrations contradicted `db/`,
and its project config carried the old project's id in a public
repository. Its seed data survives as `db/seeds/`, because the template
tenant every demo is cloned from is still generated from it.

`netlify.toml` is gone too -- it declared the same single-page-app
fallback that the rewrite in `vercel.json` already provides, so it was a
second answer to a settled question.
