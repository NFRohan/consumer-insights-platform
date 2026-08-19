# Consumer Insights Platform

A survey and consumer-research platform by Intelligent Machines. Design a
survey, publish it to a public link, collect responses from people with no
account, and analyse the results.

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

**Collecting** — a public link anyone can open without an account, an embed
snippet, and optional respondent IDs so a returning respondent can be turned
away when duplicate blocking is on.

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

Everything is in `db/`, applied in order. It is plain Postgres — the files are
re-runnable, so applying the set twice is a no-op rather than an error.
`db/README.md` covers the run order, the isolation model and the one grant you
need before deploying.

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

`npm test` needs no database. It covers the pure logic and puts every view
through a render pass — a build compiles code that throws on render, so the
render pass is what catches a blank screen.

The database suites live alongside them, plus two SQL suites in `db/tests/`
covering tenant isolation and the provisioning lifecycle. Run them against a
scratch database; `db/README.md` explains how.

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
