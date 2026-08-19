# Consumer Insights Platform

Consumer Insights Platform — a real-time survey platform by Intelligent Machines. Stack:

- **React + Vite** (front-end)
- **Supabase** (Postgres, Auth, Realtime, RLS)
- Design system ported from the supplied mockups (Geist font, OKLCH tokens)

## What's covered (MVP)

| BRD area | Status |
|---|---|
| §6 Survey creation & customization | ✅ Builder with 16 question types |
| §7.1 Skip logic / branching (AND/OR) | ✅ |
| §7.1 Multilingual content (EN / Bangla / Banglish) | ✅ Per-question translations |
| §7.2 16 question types (Single, Multi, Dropdown, Matrix, Rating, Slider, Rank, Open Text, NPS, Constant Sum, Image Options, IAT, Fill-blanks, Audio, Video, Hotspot) | ✅ |
| §7.3 Branding (custom CSS, custom domain, brand colors) | ✅ |
| §7.4 Real-time dashboard | ✅ Supabase Realtime subscription |
| §7.4 Cross-tab analysis | ✅ Heat-mapped matrix |
| §7.4 Sentiment on open text | ✅ Lightweight classifier |
| §7.4 Funnel / drop-off | ✅ |
| §7.4 Export (CSV) | ✅ |
| §7.5 Embed snippet, public link, App-in-App view | ✅ |
| §7.6 Data cleaning rules | ✅ Flag / soft-delete |
| §7.7 Distribution (SMS / push / email — stubbed via webhook) | ✅ |
| §7.8 User & role management | ✅ Admin / Creator / Viewer |
| §7.9 Audit log | ✅ Real-time stream |
| §8.2 Block re-submission, RLS, JWT auth | ✅ |

---

## 1. Apply the database schema

Open the [Supabase SQL editor](https://supabase.com/dashboard/project/fsltddopaoknbywxnsod/sql/new) and run:

```
supabase/migrations/20260509_init.sql
```

This creates: `profiles`, `surveys`, `questions`, `responses`, `answers`, `distributions`, `cleaning_rules`, `audit_logs`. It also wires up RLS policies and adds the relevant tables to the realtime publication.

> **Tip:** in `Authentication → Settings`, disable "Confirm email" while developing so freshly-signed-up users can immediately log in.

## 2. Run locally

```bash
cd app
npm install
npm run dev
```

Open http://localhost:5173

## 3. Try it out

1. **Sign up** as the first user (e.g. `admin@im.demo`) — they become a `creator` by default. To make yourself an admin, go to the SQL editor and run:
   ```sql
   update profiles set role = 'admin' where email = 'admin@im.demo';
   ```
2. **Create a survey** from the Surveys list.
3. **Add questions** in the Builder — pick from the left palette.
4. **Publish** the survey.
5. **Open the public link** (Distribute → Public link → Open). Submit a few responses.
6. Watch the **Live dashboard** update in real time as responses come in.

## Staff console

Evaluation credentials are issued from `/staff`, not self-registered.

Create the first operator account (there is no self-service path):

```bash
DATABASE_URL=... node scripts/create-staff.mjs ops.yourname "Your Name"
```

The password is generated and printed once; only its hash is stored.

At `/staff` an operator can:

- **Issue access** — name, username and a TTL from 1 day to 90. The
  password is generated server-side and shown once, on the reveal card.
- **See every sandbox** with its live status, expiry and whether the
  prospect has ever signed in.
- **Extend** by 7 days, or **revoke** immediately (behind a confirm).

Revoking cuts access but keeps the data, so a trial can be reinstated by
extending it. `app.purge_expired()` is the irreversible one and is never
implicit.

Staff accounts sit outside every tenant and **cannot read prospect
survey data** — the console shows the shape of an evaluation, never its
contents. That is enforced by RLS, not by the UI.


## 4. Project layout

```
app/
├── index.html
├── src/
│   ├── main.jsx               # entry
│   ├── App.jsx                # router
│   ├── Shell.jsx              # topbar + sidebar + view switcher
│   ├── components/            # design system (Icon, Card, Btn, Chip, …)
│   ├── context/AuthContext    # session + profile
│   ├── lib/
│   │   ├── supabase.js
│   │   ├── audit.js
│   │   └── constants.js
│   └── views/
│       ├── AuthView.jsx
│       ├── SurveysListView.jsx
│       ├── BuilderView.jsx
│       ├── BrandingView.jsx
│       ├── DistributeView.jsx
│       ├── RespondentPage.jsx   # public /r/:surveyId
│       ├── LiveDashboardView.jsx
│       ├── CrossTabView.jsx
│       ├── SentimentView.jsx
│       ├── CleaningView.jsx
│       ├── UsersView.jsx
│       ├── AuditView.jsx
│       └── ConfigView.jsx
├── styles/index.css
├── supabase/migrations/20260509_init.sql
├── .env
└── package.json
```

## 5. Notes

- **Respondent ID tracking**: pass `?ref=R-10428` on the public link, the App-in-App handoff, or fill in the start screen. Stored on the response, used for re-submission blocking. (`?msisdn=` and `?phone=` are still accepted, so links issued before the rename keep working.)
- **Block re-submission**: per-survey toggle in builder settings; checks completed responses with the same respondent ID before starting.
- **Real-time**: powered by Supabase's Postgres CDC publication. The Live dashboard, audit log, and surveys list all subscribe.
- **Offline / sync**: not implemented in this MVP slice (BRD §8.1 — would queue responses in IndexedDB and sync when back online).
- **SMS / push**: stubbed — the Distribute view records a `distributions` row with simulated delivery/click rates. Wire up to your SMS/push provider by adding a Supabase Edge Function and posting to `/distributions` from there.
- **Sentiment**: keyword-based; production should call a Bangla-aware NLP service.
- **Export**: CSV implemented; XLSX/SPSS would slot in as additional exporters.
