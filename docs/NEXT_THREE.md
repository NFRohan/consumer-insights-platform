# Plan — expiry visibility, real distribution stats, cross-tab filters

Three pieces of work, smallest first. They are independent; the order
below is by ratio of value to effort, not by dependency.

Shared context: the backend rebuild is done (Neon-ready schema, tenant
isolation, own auth, staff console). The app runs on `/api` via the
client shim, so none of this needs Supabase.

---

## 1. Make the evaluation expiry visible  ·  ~1 hour

### Why

We built time-limited access and gave the product no way to mention it.
A prospect on a 3-day trial gets no warning and simply stops being able
to sign in, which reads as the product breaking rather than a trial
ending. This is a hole we created, so it should close before anything
new is added.

There is also a cosmetic regression from the cutover: `Shell.jsx` line
119 renders `profile?.email`, but the new `/api/auth/login` does not
return an email, so the topbar shows `Admin · ` with a dangling
separator.

### Design

Everything needed already exists — `tenant.expires_at` rides on the
session, `AuthContext` exposes `tenant`, and `relativeDays()` is already
written in `StaffPortal.jsx`. No schema or API change.

Three states, escalating:

| Remaining | Treatment |
|---|---|
| > 48h | quiet chip in the topbar: `Evaluation · 6 days left` |
| ≤ 48h | `.alert` banner, `data-tone="warn"`, above the view |
| lapsed mid-session | already handled — `/api/auth/me` 403s, the shim clears the session, the login screen states the real reason |

### Changes

- **`src/lib/relativeTime.js`** *(new)* — move `relativeDays()` out of
  `StaffPortal.jsx` so both consumers share one implementation.
- **`src/Shell.jsx`**
  - replace `profile?.email` with `profile?.username` (fixes the
    dangling separator)
  - add the expiry `Chip`, tone `warn` under 48h, hidden entirely when
    `tenant.expires_at` is null
  - render the banner above `renderView()` when under 48h
- **`src/context/AuthContext.jsx`** — re-check `getSession()` on an
  interval (10 min) and on `visibilitychange`, so a revoked sandbox
  drops the session without waiting for the next write. Cheap, and it
  makes revoke feel immediate in a demo.

### Tests

Manual is proportionate here, but two are worth automating in
`scripts/test-api.mjs`:

- `/api/auth/me` returns 403 with `expired` wording once
  `tenants.expires_at` is in the past
- the same for `revoked_at`

Both already have SQL-level coverage via `app.tenant_status`; this
asserts the HTTP surface says the right thing.

### Risk

Near zero. Worst case the banner shows on a tenant with no expiry, which
the null check prevents.

---

## 2. Real distribution stats and click tracking  ·  ~half a day

### Why

`DistributeView.send()` computes, in the browser:

```js
const delivered = Math.round(audience * 0.92);
const clicked   = Math.round(delivered * 0.66);
```

Those are rendered as measurements. It is the one screen mid-journey
that states something untrue, and reach is exactly what a research buyer
is evaluating.

It also gets *better* under self-serve: an unattended prospect will
click their own link, and a counter that moves because they moved it is
far more persuasive than a plausible 66%.

### Design decisions

**Deriving vs. counting.** A `clicked` counter can drift; a `count(*)`
over an events table cannot. But the shim has no joins or aggregates, so
a derived count would need a bespoke endpoint. Compromise: keep
`distributions.clicked` as a materialised counter, and make the only
writer a `SECURITY DEFINER` function that inserts the event and
increments in one statement. One writer, no drift.

**Dedupe.** Refreshing the survey page must not inflate the number. A
`visitor_key` (a uuid minted once into `localStorage`) plus a unique
constraint on `(distribution_id, visitor_key)` makes a click idempotent.
It is not identity — it is a browser, and it should be labelled as
"unique opens" rather than "people".

**Delivered is unknowable.** For link and embed there is no delivery
receipt to have. Do not invent one: write `null` and render `— not
tracked`, with SMS and push clearly marked as needing a provider. This
is the honest half of the change and matters as much as the tracking.

### Changes

**Schema — `db/005_distribution_clicks.sql`** *(new)*

```sql
create table public.distribution_clicks (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default app.current_tenant()
                    references public.tenants(id) on delete cascade,
  distribution_id uuid not null,
  survey_id       uuid not null,
  visitor_key     text not null,
  response_id     uuid,
  clicked_at      timestamptz not null default now(),
  foreign key (distribution_id, tenant_id)
    references public.distributions(id, tenant_id) on delete cascade,
  foreign key (survey_id, tenant_id)
    references public.surveys(id, tenant_id) on delete cascade,
  unique (distribution_id, visitor_key)
);
```

`distributions` needs `unique (id, tenant_id)` added — it currently has
none, since nothing referenced it before.

RLS: members read; nobody writes directly (the function does it).

**`app.record_click(p_distribution uuid, p_visitor text)`** —
`SECURITY DEFINER`, following the pattern already established by
`public_survey_tenant` / `save_answer`:

1. resolve the distribution, and confirm its survey is `live`
2. `insert … on conflict (distribution_id, visitor_key) do nothing`
3. if a row was inserted, `update distributions set clicked = clicked + 1`

Returns void. Anonymous respondents can call it; it exposes nothing.

**`api/public/click.js`** *(new)* — `POST { distributionId, visitorKey }`.

**`src/views/RespondentPage.jsx`** — read `?d=` from the query string; on
mount, if present, mint-or-read `visitorKey` from `localStorage` and post
the click. Fire-and-forget, `.catch(() => {})` — a tracking failure must
never block a respondent.

**`src/views/DistributeView.jsx`**
- stop computing `delivered` / `clicked`; insert `sent` only, leave the
  others null
- per-row **tracked link** in the history table with a copy button:
  `${origin}/r/${surveyId}?d=${distribution.id}`
- `Delivered` stat renders `—` with the sub-label `not tracked` for link
  and embed; for SMS and push, `needs a provider`
- rename the `Clicked` stat to **Unique opens**, which is what it counts

### Tests

Add to `scripts/test-api.mjs`:

- a click inserts one row and increments `clicked` to 1
- the *same* `visitor_key` clicking again leaves it at 1 (idempotent)
- a *different* `visitor_key` takes it to 2
- a click against a **draft** survey's distribution is refused
- a click against another tenant's distribution id is refused

The last two are the ones worth having; the counter is easy, the
boundary is where bugs live.

### Risk

Low. The failure mode is an under-count (tracking blocked, private
browsing), which is the safe direction — better to under-report than to
invent. Worth stating in the UI copy that it counts unique browsers.

---

## 3. Cross-tab filters  ·  ~half a day

### Why

FR11 asks for filtering across demographic and behavioural variables.
The build has two dropdowns and nothing else, so it demonstrates a
cross-tab rather than providing one. The BRD's own stated pain is
*"Excel requires manual charting, pivoting and cross-tabulation"* — this
is the feature that answers it.

### Design decisions

**No backend work.** `CrossTabView` already pulls every answer for the
survey client-side (`response_id, question_id, value`) and aggregates in
a `useMemo`. Filtering is a reduction over data already in memory, so
this is entirely a front-end change. That is worth knowing before
anyone reaches for a new endpoint.

It does need one extra fetch: response attributes (`channel`, `region`,
`language`, `status`) are not currently loaded, and they are the most
useful things to filter by.

**Reuse the clause vocabulary.** `CleaningView` already has a
`{ combinator, clauses[] }` builder with add/remove rows and the
`eq / neq / contains / gt / lt` operator set. Copy that interaction
rather than inventing a second filter idiom — consistency here is worth
more than a cleverer control.

### Changes

- **`src/views/CrossTabView.jsx`**
  - fetch responses alongside answers
  - filter bar above the matrix: variable (any question, or one of
    channel / region / language / status), operator, value; AND/OR
    combinator; add and remove rows
  - compute the filtered `response_id` set first, then build the matrix
    from answers whose `response_id` is in it
  - show **`n of N responses`** beside the title — without the base, a
    filtered cross-tab is easy to misread
  - empty state when a filter matches nothing, distinct from "no data"
- **`src/lib/filterClauses.js`** *(new)* — extract the clause evaluation
  so `CleaningView` and `CrossTabView` share one implementation rather
  than drifting.

### Tests

Pure functions, so unit tests are cheap and worth it. In
`scripts/test-api.mjs` (or a new `scripts/test-lib.mjs`):

- AND across two clauses narrows; OR widens
- a clause on a response attribute and one on an answer value combine
- multi-select answers match when *any* selected option satisfies the
  clause — the case most likely to be got wrong
- an empty clause list is a no-op, not an empty result

### Risk

Moderate, and it is a correctness risk rather than a breakage one: a
filter that silently drops respondents produces confident, wrong
numbers. Hence the `n of N` display and the multi-select test above.

---

## Sequencing

1. **Expiry** — an hour, closes a hole we opened, unblocks nothing but
   makes every subsequent demo safer.
2. **Distribution** — removes the one false claim on screen.
3. **Cross-tab filters** — deepens the analyst story once nothing on
   screen is lying.

1 and 2 together are roughly a day and change what a prospect is *told*.
3 is another half-day and changes what they can *do*.

## Deliberately not in this plan

- **Email/SMS delivery** — needs a provider, domain verification and
  deliverability work, and a sandboxed prospect cannot evaluate it.
- **Bangla-aware sentiment** — on-brand, but needs a paid NLP service;
  the keyword classifier at least works on English today.
- **PDF export** — Excel was the one that mattered.
- **`ConfigView`** — still the most dishonest screen (LDAP shows
  "Active", nothing is wired). Cheapest correct fix is to label it
  illustrative, not to implement it.
