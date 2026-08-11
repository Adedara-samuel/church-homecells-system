# Church Homecell Management System

A production-ready web application for managing church homecells, members, attendance,
finances, transfers, celebrations and reporting across the organisational hierarchy:

```
Church → Zone → Area → Homecell → Members
```

Built against the Software Requirements Specification (v1.0, 7 August 2026). Every
business rule from the SRS (BR-001 to BR-018) is enforced on the server.

---

## Contents

1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [Tech stack](#tech-stack)
4. [Getting started](#getting-started)
5. [Demo credentials](#demo-credentials)
6. [Environment variables](#environment-variables)
7. [Commands](#commands)
8. [API](#api)
9. [Authentication](#authentication)
10. [Authorisation: roles and scope](#authorisation-roles-and-scope)
11. [The financial ledger](#the-financial-ledger)
12. [Payments](#payments)
13. [Webhooks](#webhooks)
14. [Reconciliation](#reconciliation)
15. [File uploads](#file-uploads)
16. [SMS](#sms)
17. [Scheduled jobs](#scheduled-jobs)
18. [Reports](#reports)
19. [Testing](#testing)
20. [Deployment](#deployment)
21. [Troubleshooting](#troubleshooting)
22. [Architectural decisions](#architectural-decisions)

---

## What it does

| Module | Capability |
| --- | --- |
| **Structure** | Zones, Areas and Homecells with coordinators, codes, status and hierarchy enforcement |
| **Members** | Registration, profiles, search, filtering, photographs, categorisation, status |
| **Transfers** | Same-area, cross-area and cross-zone moves with configurable multi-stage approval and permanent history |
| **Attendance** | Sunday Homecell, Tuesday Miracle Service, Thursday Hour of Emphasis — with day-of-week validation and duplicate prevention |
| **Finance** | Immutable transaction ledger, offerings, expenses with approval, remittances, purse thresholds, reversals and adjustments |
| **Payments** | Paystack, Flutterwave and a development mock behind one interface; verified webhooks, idempotency, reconciliation |
| **Notifications** | In-app notifications for thresholds, approvals, transfers and payment outcomes |
| **SMS** | Automated birthday and anniversary messages with a full delivery log |
| **Reports** | Members, attendance, finance, demographics, transfers, remittances — exportable as CSV, Excel and PDF |
| **Dashboards** | Role-specific overviews, every figure calculated live from the database |
| **Audit** | Append-only log of every significant action with field-level before/after values |

---

## Architecture

```
                        ┌──────────────────────────┐
   Desktop / mobile ───▶│  Next.js 14 (App Router) │
                        │  TanStack Query · RHF    │
                        └────────────┬─────────────┘
                                     │ REST /api/v1 (JWT)
                        ┌────────────▼─────────────┐
                        │  Express + TypeScript    │
                        │  routes → controllers    │
                        │  → services → models     │
                        │  authn · authz · scope   │
                        └───┬──────────────────┬───┘
                            │                  │
                  ┌─────────▼──────┐   ┌───────▼────────────┐
                  │ MongoDB        │   │ Cloudinary         │
                  │ (replica set)  │   │ (or local disk)    │
                  └────────────────┘   └────────────────────┘
                            │
                  ┌─────────▼───────────────────────────────┐
                  │ Paystack / Flutterwave · Termii / Twilio │
                  │ each behind a provider interface         │
                  └──────────────────────────────────────────┘
```

### Project layout

```
church-homecell-system/
├── backend/
│   └── src/
│       ├── config/         env, logger, permission catalogue
│       ├── db/             connection, transactions, sequence counters
│       ├── middleware/     authenticate, scope, validate, error, security
│       ├── modules/        one folder per domain: model, service, controller, schemas
│       │   ├── auth/ users/ zones/ areas/ homecells/ members/ transfers/
│       │   ├── attendance/ finance/ payments/ remittances/
│       │   └── notifications/ sms/ reports/ audit/ settings/ uploads/ dashboard/
│       ├── jobs/           scheduled jobs
│       ├── seed/           demo data
│       ├── types/          shared enums (single source of truth)
│       └── utils/          money, dates, errors, query, ids
├── frontend/
│   └── src/
│       ├── app/            routes — (app) is the authenticated shell
│       ├── components/     ui/ (design system) · common/ · layout/
│       ├── hooks/          query and mutation wrappers
│       ├── lib/            api client, auth context, utilities
│       ├── services/       one typed function per API endpoint
│       └── types/          domain types mirroring the API contract
└── docs/
```

**Layering rule:** routes never contain business logic and services never touch
`req`/`res`. Data access lives in the service layer behind the model; controllers only
translate HTTP to service calls.

---

## Tech stack

**Frontend** — Next.js 14 · TypeScript · Tailwind CSS · shadcn/ui (Radix) ·
TanStack Query v5 · React Hook Form · Zod · Recharts · Lucide

**Backend** — Node.js 20+ · Express · TypeScript · Mongoose 8 · Zod · Argon2id ·
Helmet · pino · node-cron · ExcelJS · PDFKit

**Database** — MongoDB (replica set in production)

---

## Getting started

### Prerequisites

- Node.js 20 or newer
- MongoDB 6+ — a **replica set** is required for the financial transaction guarantees

**MongoDB Atlas (recommended).** Any Atlas cluster is already a replica set, so
transactions work with no extra setup. Put the connection string in `backend/.env`,
including a database name:

```
MONGODB_URI="mongodb+srv://<user>:<password>@<cluster>.mongodb.net/church_homecell?retryWrites=true&w=majority"
```

Quote the value if the password contains `#`, `&` or `$` — dotenv treats an unquoted
`#` as the start of a comment. Add your server's IP to the Atlas **Network Access**
allow-list.

**Local replica set:**

```bash
docker run -d --name chms-mongo -p 27017:27017 mongo:7 --replSet rs0
docker exec chms-mongo mongosh --eval "rs.initiate()"
```

A standalone `mongod` also works: the finance layer detects the missing transaction
support and degrades to sequential writes with compensating rollback, logging a warning
at startup.

> `backend/.env` is git-ignored and holds live credentials. Rotate any database
> password that has been pasted into a chat, an issue or a screenshot, and use a
> least-privilege database user rather than an Atlas admin account in production.

### Install and run

```bash
git clone <repository-url>
cd church-homecell-system

npm install                 # installs both workspaces

cp .env.example backend/.env
printf 'NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1\n' > frontend/.env.local

npm run seed:fresh          # demo data + accounts
npm run dev                 # API on :4000, web on :3000
```

Open <http://localhost:3000> and sign in with any account below.

---

## Demo credentials

`npm run seed:fresh` creates a complete church: 3 zones, 5 areas, 11 homecells, ~220
members, 10 weeks of attendance, offerings, expenses, remittances, payments,
transfers, notifications, SMS logs and audit history.

| Role | Email | Sees |
| --- | --- | --- |
| System Administrator | `sysadmin@graceassembly.org` | Everything, including settings and audit |
| Church Administrator | `churchadmin@graceassembly.org` | Church-wide, no system configuration |
| Zonal Coordinator | `zonal1@graceassembly.org` | Ikeja Zone only |
| Area Coordinator | `area1@graceassembly.org` | Oregun Area only |
| Homecell Coordinator | `homecell1@graceassembly.org` | Grace Homecell only |
| *(inactive account)* | `inactive.coordinator@graceassembly.org` | Cannot sign in — demonstrates FR-AUTH-004 |

**Password for all accounts:** the value of `SEED_DEFAULT_PASSWORD`
(default `ChangeMe#2026`).

> These are demonstration credentials. Change `SEED_DEFAULT_PASSWORD` and re-seed, or
> reset each password, before exposing the application to any network.

Sign in as different roles to see scope enforcement first-hand: the Homecell
Coordinator's member list contains only their own members, and editing the URL to
another Homecell's id returns a 403 from the API rather than data.

---

## Environment variables

Every variable is documented inline in [`.env.example`](.env.example). The essentials:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Connection string; a replica set URI in production |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Token signing. Must differ; the server refuses to boot in production with the defaults |
| `CORS_ORIGINS` | Comma-separated list of permitted browser origins |
| `PAYMENT_PROVIDER` | `PAYSTACK` \| `FLUTTERWAVE` \| `MOCK` |
| `PAYSTACK_SECRET_KEY` / `FLUTTERWAVE_SECRET_KEY` | Provider credentials; absent means fall back to the mock |
| `FLUTTERWAVE_WEBHOOK_SECRET` | Flutterwave's "secret hash" — required for webhook verification |
| `CLOUDINARY_*` | File storage; absent means store on local disk |
| `SMS_PROVIDER`, `TERMII_API_KEY`, `TWILIO_*` | SMS delivery; absent means the mock provider |
| `ENABLE_CRON_JOBS` | Set `false` on replicas so only one instance runs scheduled jobs |
| `SEED_DEFAULT_PASSWORD` | Password given to seeded demo accounts |

Secrets are read only on the server. Nothing sensitive is exposed through
`NEXT_PUBLIC_*`.

---

## Commands

Run from the repository root:

```bash
npm run dev          # backend + frontend together
npm run dev:api      # backend only
npm run dev:web      # frontend only

npm run build        # compile backend, build frontend
npm start            # run both production builds

npm run seed         # seed only if the database is empty
npm run seed:fresh   # wipe and re-seed

npm test             # backend test suite
npm run lint
npm run typecheck
```

---

## API

Base URL: `/api/v1`

| Route | Purpose |
| --- | --- |
| `/auth` | login, refresh, logout, session, change/forgot/reset password |
| `/users` | accounts, roles, assignments, permission overrides |
| `/zones`, `/areas`, `/homecells` | church structure |
| `/members` | registration, profiles, search, roster, celebrations |
| `/transfers` | initiate, approve, reject, cancel, history |
| `/attendance` | register, record, summary, trend, member history |
| `/finance` | purses, ledger, offerings, expenses, categories, adjustments, reversals |
| `/payments` | initiate, verify, webhooks, reconciliation |
| `/remittances` | record, approve, verify, disburse, receipts |
| `/notifications`, `/sms`, `/reports`, `/audit-logs`, `/settings`, `/uploads`, `/dashboard` | |

### Response format

Success:

```json
{ "success": true, "data": { }, "meta": { "pagination": { "page": 1, "limit": 20, "total": 143, "totalPages": 8, "hasNextPage": true, "hasPreviousPage": false } } }
```

Failure:

```json
{ "success": false, "error": { "code": "OUT_OF_SCOPE", "message": "That Homecell is outside your assigned scope.", "details": [], "requestId": "0f1c…" } }
```

`requestId` appears in the response, the `x-request-id` header and every log line for
that request — quote it when reporting a problem.

**Status codes:** 200 OK · 201 Created · 204 No Content · 400 malformed · 401
unauthenticated · 403 forbidden or out of scope · 404 not found · 409 conflict or
duplicate · 422 validation or business-rule violation · 429 rate limited · 500
unexpected · 502 provider failure.

**Health:** `GET /health` (liveness) and `GET /ready` (includes database state).

---

## Authentication

- **Passwords** hashed with Argon2id (19 MiB, 2 iterations) and never returned by any
  endpoint, even if a query forgets `select: false`.
- **Access tokens** are short-lived JWTs (15 minutes) sent as `Authorization: Bearer`.
- **Refresh tokens** are opaque random strings stored **hashed**, one row per session.
  They rotate on every use; presenting an already-rotated token is treated as theft and
  revokes every session for that user.
- The refresh token is set as an httpOnly cookie and also returned in the body, so
  non-browser clients work identically.
- Changing a password invalidates every access token issued before the change and
  revokes all sessions.
- Repeated failures lock an account for 15 minutes. Login responses are identical for
  a wrong password and an unknown account, so accounts cannot be enumerated.
- Inactive and suspended accounts cannot sign in (FR-AUTH-004).

---

## Authorisation: roles and scope

Authorisation is **two independent checks**, both server-side:

1. **Permission** — does this role hold the verb? (`config/permissions.ts`)
2. **Organisational scope** — is the target record inside the user's Zone, Area or
   Homecell? (`middleware/scope.ts`)

Both must pass. Hiding navigation in the frontend is presentation only: a Homecell
Coordinator who edits a URL or an API parameter receives `403 OUT_OF_SCOPE`, which the
test suite asserts directly.

| | System Admin | Church Admin | Zonal | Area | Homecell |
| --- | :-: | :-: | :-: | :-: | :-: |
| System configuration | ✓ | | | | |
| User management | ✓ | limited | | | |
| Zones / Areas / Homecells | ✓ | view | own zone | own area | own |
| Members | ✓ | ✓ | own zone | own area | own |
| Attendance | ✓ | view | own zone | own area | record |
| Offerings / expenses | ✓ | approve | approve | approve | record |
| Remittances | ✓ | verify | approve | approve | record |
| Transfers | ✓ | approve | approve | approve | initiate |
| Reports | all | all | own zone | own area | own |
| Audit logs | ✓ | limited | | | |

Individual users can be granted extra permissions or have specific ones revoked without
changing their role.

**Sensitive member data** (phone, email, address, date of birth, emergency contact,
notes) is stripped from API responses for roles without `members.view_sensitive`, and
the UI shows a "Restricted" badge rather than an empty field.

---

## The financial ledger

The Homecell purse is **not a stored number**. It is the fold of an immutable
transaction collection:

```
Opening balance + Offerings + Other income + Payments in
                − Approved expenses − Remittances − Payments out
                ± Adjustments and reversals
                = Current balance
```

Design rules, all enforced in code and covered by tests:

- **Amounts are integers in minor units** (kobo). Floating-point naira never reaches
  the database.
- **Posted entries are immutable.** A Mongoose pre-save hook rejects any modification
  outside the small set of fields involved in the reversal handshake.
- **Corrections are reversals, not edits.** Reversing posts an equal and opposite
  entry and marks the original `REVERSED`; both remain in the history and in the
  arithmetic, so the amount is neither lost nor subtracted twice.
- **Idempotency is a unique index**, not a read-then-write check, so it holds under
  concurrency. Each business event derives a stable key
  (`offering:<id>`, `payment:<reference>`, `reversal:<id>`).
- **Multi-write operations run in a MongoDB transaction.** On a standalone server the
  unit-of-work helper degrades to sequential writes with registered compensating
  actions, so a partial financial state is never left behind.
- **Only approved expenses affect the balance** (BR-015), and an approval that would
  overdraw the purse is rolled back rather than left in an inconsistent state.
- **Remittances debit only when the business condition is met**: a manual remittance
  when an authorised user verifies its proof of payment; a provider transfer when the
  webhook confirms it.

### Purse threshold

Administrators set a church-wide maximum, overridable per Homecell. When a balance
reaches it the system notifies the Homecell Coordinator, Area Coordinator and Zonal
Coordinator, flags the purse on every dashboard, and suggests the amount to remit. The
notification carries a dedupe key, so a purse that stays over threshold produces one
unread prompt rather than one per offering.

---

## Payments

Providers sit behind a single interface (`modules/payments/providers/types.ts`), so
adding one means adding one file:

```
PaymentProvider
├── PaystackProvider       amounts in minor units, HMAC-SHA512 webhooks
├── FlutterwaveProvider    amounts in major units, shared-secret webhooks
└── MockPaymentProvider    development — same interface, signed webhooks, no network
```

The active provider is chosen in **Settings → Integrations**. A provider without
credentials falls back to the mock, so the application is always operable.

### Payment-in

```
initiate → provider checkout → user pays → provider webhook
        → signature verified → duplicate check → re-verified with the provider API
        → transaction: payment marked successful, ledger credited, offering created,
          notification raised, audit written → commit
```

The browser's redirect is **never** treated as proof of payment. The callback page
polls the API, which reports only what the backend has independently confirmed.

### Payment-out (remittance disbursement)

```
Draft → Pending approval → Approved → Processing → Successful | Failed
```

Clicking "Disburse" never marks a payout successful. The remittance is atomically
claimed (so the same payout cannot be submitted twice), sent to the provider, and moved
to `PROCESSING`. The ledger is debited only when the webhook confirms success.

### Trying it without credentials

With `PAYMENT_PROVIDER=MOCK`, initiating a payment opens a mock checkout page that
sends a **signed webhook** to the real webhook endpoint. Signature verification,
idempotency, ledger posting and reconciliation all execute exactly as in production.

---

## Webhooks

```
POST /api/v1/payments/webhooks/paystack
POST /api/v1/payments/webhooks/flutterwave
POST /api/v1/payments/webhooks/mock
```

Processing order is deliberate:

1. Verify the signature against the **raw** request bytes (captured by the JSON parser
   for these routes only). A bad signature returns 401/422 and is logged.
2. Record the delivery under a unique `(provider, eventKey)` index. A replay stops here
   and increments a counter.
3. Look up the payment by *our* reference.
4. Ignore events for payments already in a terminal state.
5. Re-verify with the provider's API before crediting; an amount mismatch is flagged
   for manual reconciliation instead of being posted.
6. Settle or fail inside a transaction.

The endpoint answers **200** for anything it understood — including duplicates and
unrelated events — because a non-2xx makes providers retry indefinitely.

**Configuring the provider dashboards**

| Provider | Webhook URL | Notes |
| --- | --- | --- |
| Paystack | `https://api.your-domain.org/api/v1/payments/webhooks/paystack` | Signed with your secret key; no extra configuration |
| Flutterwave | `https://api.your-domain.org/api/v1/payments/webhooks/flutterwave` | Set a "secret hash" and copy it to `FLUTTERWAVE_WEBHOOK_SECRET` |

Test locally with `ngrok http 4000` and point the dashboard at the tunnel URL.

---

## Reconciliation

A nightly job (and an on-demand button) compares our payment records against the
provider's transaction list and classifies every difference:

| Outcome | Meaning |
| --- | --- |
| `MATCHED` | Same status and amount on both sides |
| `MISMATCHED` | The provider disagrees about the amount or the outcome |
| `ORPHANED` | The provider has a transaction we have no record of |
| `MANUALLY_RESOLVED` | An administrator recorded a decision |

Nothing is corrected automatically. Silently rewriting a financial record to agree with
an external system is precisely the behaviour a ledger exists to prevent, so exceptions
are surfaced in **Finance → Reconciliation** for a human decision, which is itself
audited.

---

## File uploads

Cloudinary stores profile photographs, expense receipts and remittance proofs.

- File type is determined by **magic-number inspection**, not the declared MIME type or
  the extension; a mismatch is rejected as hostile.
- Size is checked against the configurable limit.
- Stored filenames are 128-bit random values — a client-supplied name is never used as
  a storage key.
- Without Cloudinary credentials, files are written to `backend/storage/uploads` and
  served by the API, so every upload-dependent feature works locally.

---

## SMS

```
SmsProvider
├── TermiiProvider
├── TwilioProvider
└── MockSmsProvider   logs the message and records it as delivered
```

Birthday and anniversary messages are found using a denormalised `MM-DD` key kept in
step by a pre-validate hook, so celebrant lookup is one indexed query rather than a
collection scan. Every send is logged with its provider reference, delivery status and
segment count. A unique dedupe key (`BIRTHDAY:<memberId>:<date>`) guarantees a member
is greeted once per occasion even if the job runs twice.

Message templates are configurable in **Settings → SMS**, with `{{name}}` and
`{{church}}` substituted at send time.

---

## Scheduled jobs

| Job | Default schedule | Does |
| --- | --- | --- |
| Celebrations | `0 7 * * *` | Birthday and anniversary SMS |
| Purse threshold | `0 * * * *` | Sweeps every active Homecell against its threshold |
| Attendance reminders | `0 20 * * 0,2,4` | Flags Homecells with no register that evening |
| Reconciliation | `30 1 * * *` | Compares payments against the provider |
| Remittance reminders | `0 9 * * *` | Nudges coordinators about outstanding remittances |

All are configurable by cron expression and timezone. **Set `ENABLE_CRON_JOBS=false` on
every instance but one** when running more than one replica.

---

## Reports

Members · Attendance · Financial · Transactions · Remittances · Transfers ·
Age demographics · Sex demographics · Location

Each supports date, Zone, Area, Homecell, status and category filters within the
caller's scope, and exports to **CSV**, **Excel** and **PDF**. CSV output escapes
leading `=`, `+`, `-` and `@` so a member's name can never execute as a spreadsheet
formula.

Reports are registered in one table in `report.controller.ts`; adding an entry makes a
new report runnable and exportable in every format.

---

## Testing

```bash
npm test
```

72 tests run against an in-memory MongoDB **replica set** — deliberately not a
standalone server, so the production transaction path is what gets exercised.

| Suite | Covers |
| --- | --- |
| `auth` | Valid login, wrong password, unknown account, disabled account, missing/invalid token, refresh rotation and reuse detection |
| `authorization` | Each role attempting to read a sibling unit's data; parameter tampering; privilege escalation |
| `attendance` | Day-of-week rules (BR-005–007), duplicate prevention at API and index level, cross-Homecell rejection |
| `finance` | Sunday-only offerings, balance after each operation, approval gating, insufficient balance, immutability, idempotency, threshold |
| `payments` | Valid and invalid webhook signatures, settlement, triple-delivery idempotency, failed payments, late webhooks, reconciliation |
| `members-transfers` | Registration and hierarchy derivation, validation, search, pagination, one/two/three-stage approvals, rejection, history |

---

## Deployment

### Build

```bash
npm run build     # backend → backend/dist, frontend → frontend/.next
npm start
```

### Backend (Render, Railway, Fly.io, a VM…)

- Build `npm --workspace backend run build`, start `node backend/dist/server.js`
- Node 20+, health check `GET /health`, readiness `GET /ready`
- Set every variable from `.env.example`; generate fresh JWT secrets
- Point `MONGODB_URI` at a replica set (MongoDB Atlas M10+ or self-hosted)
- Run `npm run seed` once against a fresh database (never `seed:fresh` in production)

### Backend (Vercel serverless)

The repository is a monorepo, so the backend needs **its own Vercel project** with
**Root Directory set to `backend`**. `backend/vercel.json` then routes every path to
`backend/api/index.ts`, which default-exports the Express app — Vercel rejects a
module whose default export is not a handler ("Invalid export found in module").
`src/server.ts` is for long-running hosts only and is never used on Vercel.

- Root Directory: `backend` · Framework Preset: *Other*
- Environment variables: everything from `.env.example`, plus `NODE_ENV=production`
- `MONGODB_URI` must point at Atlas (or another host reachable from Vercel), and the
  Atlas network access list must allow `0.0.0.0/0` — Vercel egress IPs are not fixed
- `CORS_ORIGINS` must contain the frontend origin with **no trailing slash**
- Verify with `curl https://<backend>.vercel.app/health` and `…/api/v1`
- Set `ENABLE_CRON_JOBS=false`: serverless containers are frozen between requests, so
  `node-cron` never fires. Use Vercel Cron (or a small always-on worker) to hit the
  job endpoints on a schedule instead.

### Frontend (Vercel, Netlify, Node host)

- Separate Vercel project with **Root Directory set to `frontend`**
- Build `npm --workspace frontend run build`, start `next start`
- Set `NEXT_PUBLIC_API_URL` to the public API URL **including `/api/v1` and without a
  trailing slash** — e.g. `https://<backend>.vercel.app/api/v1`. A trailing slash
  produces `//auth/login`, which Vercel answers with a 308 redirect; a redirect on a
  CORS preflight is rejected by the browser ("Redirect is not allowed for a preflight
  request"). Redeploy after changing it — `NEXT_PUBLIC_*` is baked in at build time.
- Add the frontend origin to the backend's `CORS_ORIGINS`

### Production checklist

- [ ] `NODE_ENV=production`
- [ ] Fresh, distinct `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` — the server refuses to start otherwise
- [ ] `COOKIE_SECURE=true` and HTTPS everywhere
- [ ] `CORS_ORIGINS` limited to your real frontend origin
- [ ] MongoDB replica set with authentication and automated daily backups
- [ ] Live payment and SMS credentials; webhook URLs registered in each dashboard
- [ ] Cloudinary configured (local disk storage does not survive a container restart)
- [ ] `ENABLE_CRON_JOBS=true` on exactly one instance
- [ ] Every seeded demo password changed
- [ ] Backup restore tested at least once

---

## Troubleshooting

**"MongoDB deployment does not support multi-document transactions"**
You are on a standalone `mongod`. Fine for development; use a replica set in production
so financial writes are genuinely atomic.

**Login succeeds but every request then returns 401**
Check `NEXT_PUBLIC_API_URL` and that the frontend origin is in `CORS_ORIGINS`. Cross-origin
cookies also require `COOKIE_SECURE=true` and HTTPS.

**Webhook returns 401/422**
The signature did not verify. Confirm `FLUTTERWAVE_WEBHOOK_SECRET` matches the dashboard
"secret hash", and that no proxy is rewriting the request body — the signature is computed
over the exact bytes received.

**Payment stays "Processing"**
The webhook has not arrived. Check the provider dashboard's delivery log, then use
**Verify** on the payments screen to ask the provider directly.

**"Attendance can only be recorded on a Sunday"**
Working as designed (BR-005). The record screen offers the most recent valid date.

**"Insufficient available balance"**
The expense or remittance exceeds the purse. Check **Finance → Homecell purses** — only
approved expenses and completed remittances are deducted.

**Uploads fail or disappear after a restart**
Cloudinary is not configured, so files are on local disk. Set `CLOUDINARY_*` in production.

**Seed says the database already contains data**
Use `npm run seed:fresh` to wipe and re-seed. Never in production.

---

## Architectural decisions

Decisions where the SRS left room for interpretation, and why each was resolved this way.

**Money is stored in integer minor units.** Naira as a float accumulates rounding error
that eventually shows up as a purse that does not balance. All conversion happens at the
API boundary.

**The purse is derived, never stored.** SRS §28 asks for a transaction-based ledger
rather than an editable balance. There is therefore no `homecell.balance` field to drift
or be edited — the balance is an aggregation, indexed for the query it needs.

**Reversed entries stay in the balance calculation.** A reversal posts an offsetting
entry; excluding the original as well would subtract the amount twice. `REVERSED` marks
the history, it does not remove the arithmetic.

**Organisational assignment is denormalised onto every scoped document.** Members,
attendance and ledger entries each carry `zone`, `area` and `homecell`. Scope filters
become a single indexed predicate instead of a multi-stage `$lookup`, and roll-up
reporting stays fast as the church grows.

**Idempotency is enforced by unique indexes.** A read-then-write check loses the race
between two concurrent webhook deliveries; a unique index does not.

**Webhooks answer 200 for duplicates and unknown events.** Providers retry on non-2xx.
Returning an error for an event we correctly decided to ignore causes an infinite retry
storm.

**Reconciliation never auto-corrects.** Differences are recorded and escalated for a
human decision. Automatically rewriting a ledger to match an external system defeats the
purpose of keeping one.

**`sanitizeFilter` is deliberately disabled in Mongoose.** It wraps every nested `$` key
in `$eq`, silently breaking the legitimate `$gte` / `$in` / `$or` operators the service
layer builds. Injection is prevented at the boundary instead: Zod strips unknown keys
from every request, and `sanitizeInput` removes `$`-prefixed and dotted keys before any
value reaches a query.

**Transfers own the Homecell assignment.** A member's Homecell cannot be changed through
a profile edit, only through a transfer, so BR-017 history can never be bypassed.

**Attendance uses a bulk upsert on the BR-009 unique key.** Resubmitting a register
updates it rather than failing, and two coordinators saving concurrently cannot create
duplicates.

**The audit log is append-only at the model level.** Update and delete hooks throw. The
seed reset uses the native driver precisely because the application layer cannot delete
audit records.

**Every list endpoint paginates server-side.** No screen can be made to load an unbounded
result set.

---

## Licence

Proprietary. Built for church use under the attached Software Requirements
Specification.
