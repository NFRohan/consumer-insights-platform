# Consumer Insights Platform

A survey and consumer-research platform by Intelligent Machines. Design a
survey, publish it to a public link, collect responses from people with no
account, and analyse the results.

**Live:** <https://consumer-insights-platform.vercel.app>

- **React + Vite** front end
- **Serverless functions** under `api/`, deployed on Vercel
- **Postgres** on Neon — no extensions required

Prospects are given a username and password that expires on its own. Each one
gets a private, fully populated copy of the demo, walled off from every other.

## What it does

**Building** — 16 question types (single and multi select, dropdown, matrix,
rating, slider, drag-and-drop rank, open text, NPS, constant sum, image
options, reaction time, fill in the blanks, audio, video, hotspot). Skip logic
with AND/OR branching, piping answers into later questions, question and option
randomisation, and per-question translations. Questions can also be imported
from Word or Excel.

**Collecting** — publishing a survey hands over its public link there and then,
and the builder keeps a copy button for as long as the survey is live. Anyone
can open that link without an account. There is also an embed snippet, and
optional respondent IDs so a returning respondent can be turned away when
duplicate blocking is on.

**Analysing** — a live dashboard, cross-tabs with filtering by respondent
attributes or by how someone answered, keyword sentiment on open text,
drop-off, and export to Excel (responses, codebook and summary) or CSV.

**Running it** — data cleaning rules that flag or soft-delete, user and role
management (admin, creator, viewer), and an audit log.

**Issuing access** — a staff console at `/staff` for creating, extending,
revoking and resetting time-limited evaluation logins.

### What it does not do

Said plainly, because the screens say so too:

- **Nothing is actually sent.** Distribution records a batch and issues a
  tracked link whose opens are counted for real, but delivering SMS, push or
  email needs a provider connected. Delivery figures read as unknown rather
  than as zero.
- **Live updates poll**, every few seconds, rather than streaming. Views
  refresh in place, and polling stops while the tab is hidden.
- **Sentiment is keyword-based** and meant to demonstrate the screen, not to be
  relied on.
- **No offline capture.** Responses need a connection.

## Running it locally

```bash
npm install
cp .env.example .env      # then fill in DATABASE_URL and JWT_SECRET
npm run dev
```

Open <http://localhost:5173>. The dev server also serves `api/` the way Vercel
does, so there is no second process to run.

## The database

Eight files in `db/`, applied in order. Plain Postgres — they are re-runnable,
so applying the set twice is a no-op rather than an error.

Prospects are kept apart by two independent mechanisms, so one mistake in
future code cannot expose anything. Every child row carries its tenant and
references its parent on both id and tenant together, so a question cannot
point at another tenant's survey even if a query forgets to filter. On top of
that, row-level security keys off a session context the API sets per request
and the client never supplies. Anything unset reads as nothing rather than as
everything.

`db/README.md` covers the run order, that model in full, and the one grant to
make before deploying.

## Staff console

Evaluation logins are issued at `/staff`. There is no self-service sign-up.

Create the first operator account:

```bash
node --env-file=.env scripts/create-staff.mjs ops.yourname "Your Name"
```

Change an existing account's username or password. The password is read from
standard input so it stays out of shell history and the process list, and the
row is updated rather than replaced — the staff audit trail references it, so
deleting an account to re-make it would unattribute everything it had done:

```bash
printf %s 'the-new-password' \
  | node --env-file=.env scripts/staff-credentials.mjs ops.yourname --username new.name
```

Passwords are shown once and stored only as a hash.

An operator can issue access with a chosen expiry, see every sandbox with its
status and whether the prospect has ever signed in, extend, revoke, reset a
forgotten password, and purge lapsed sandboxes. Revoking keeps the data so a
trial can be reinstated by extending it; purging is the irreversible one and is
never implicit.

Expiry, revocation and password resets all end an existing session immediately,
including a browser tab that was already open.

Staff sit outside every tenant and **cannot read prospect survey data**. The
console shows the shape of an evaluation, never its contents, and that is
enforced by the database rather than by the interface.

## Tests

```bash
npm test              # shared logic, and every view renders
npm run test:api      # the database-backed suite
```

`npm test` needs no database: 26 checks over the pure logic, and a render pass
across all 13 views. The render pass earns its place because a build compiles
code that throws the moment it renders — it is what catches a blank screen.

`npm run test:api` adds 77 checks against a real database, including the whole
journey: build a survey, publish it, answer it as a stranger, submit, and read
the result back.

Two SQL suites in `db/tests/` cover tenant isolation (15) and the provisioning
lifecycle (23). Run everything against a scratch database — `db/README.md`
explains how. Worth knowing that the isolation guarantees mean little when run
as a superuser, who bypasses the policies being tested; run them as the
application's own role.

## Deploying

Vercel builds from `main` and redeploys on every push; branches get their own
preview URL. Two environment variables are required — the **pooled** Neon
connection string and a signing secret at least 32 characters long. Session
length, pool size and the refresh interval all have defaults.

The functions are pinned to the same region as the database. Left on the
default they would sit on another continent, and a request costs three
round trips, which is most of a second spent waiting on every action.

`docs/DEPLOY.md` has the settings, the environment table and what to check
after a deploy.

## Project layout

```
api/                    serverless functions
├── _lib/               shared: db access, auth, the query whitelist
├── data.js             the one data endpoint the client talks to
├── auth/               login, session check
├── admin/              staff only: tenants, actions, audit
└── public/             anonymous respondents: answer, submit, click, resubmission

db/                     schema, policies, provisioning, seed  (run in order)
├── seeds/              source data the template tenant is built from
└── tests/              isolation and provisioning suites

scripts/                test suites and staff account tools

src/
├── App.jsx             router
├── Shell.jsx           topbar, sidebar, view switcher
├── components/         design system
├── context/            session
├── lib/                api client, filtering, export, import parsing
└── views/              one per screen, plus the public respondent page

docs/DEPLOY.md          deploying to Vercel and Neon
```
