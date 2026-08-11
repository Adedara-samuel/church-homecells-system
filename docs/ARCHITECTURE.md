# Architecture and design decisions

Companion to the README. This records *why* the system is shaped the way it is,
particularly where the SRS left room for interpretation.

---

## 1. Layering

```
route → controller → service → model
              ↑          ↑
        HTTP only    business rules
```

- **Routes** declare the path, the permission and the validation schema. No logic.
- **Controllers** translate HTTP to a service call and back. They never query the
  database.
- **Services** hold every business rule and own data access. They receive an
  `AuthenticatedUser` and plain input, never `req`/`res`, so they are callable from
  scheduled jobs and tests as well as HTTP.
- **Models** hold the schema, indexes and the invariants worth enforcing at the storage
  layer (ledger immutability, attendance uniqueness, audit append-only).

The consequence worth stating: every rule has exactly one home. There is no path where
an offering can be posted without the Sunday check, because the check lives in the
service that every caller must go through.

---

## 2. Authorisation

Two independent checks, both server-side, both required.

**Permission** (`config/permissions.ts`) answers "does this role have the verb?".
Roles hold a base set; individual users may be granted extras or have specific
permissions revoked without a role change.

**Scope** (`middleware/scope.ts`) answers "is this record inside the caller's part of
the organisation?". Two shapes:

- `resolveScopedFilter()` narrows a list query. The caller's own scope is *always*
  retained, so a requested filter can only intersect with it, never widen it.
- `assertInScope()` / `assertHomecellInScope()` guard a single-record read after
  loading it.

Scope works because every scoped document carries denormalised `zone`, `area` and
`homecell` references. This is a deliberate trade: writes maintain three references
instead of one, and in exchange every scope filter is a single indexed predicate rather
than a multi-stage `$lookup`. Given how many queries in this system are scoped — nearly
all of them — that trade pays for itself immediately.

The frontend filters its navigation by the same permission list, but purely for
presentation. `tests/authorization.test.ts` attacks the boundary directly: each role
tries to reach a sibling unit by id and by query parameter, and must receive 403.

---

## 3. The financial subsystem

This is the part of the system where a bug is least acceptable, so it is the part with
the strongest invariants.

### The purse is a fold, not a field

There is no `homecell.balance`. The balance is:

```
Σ (CREDIT entries) − Σ (DEBIT entries)   over posted and reversed entries
```

computed by one aggregation over the `{homecell, status, valueDate}` index. Nothing can
"drift" because there is nothing to drift from, and no code path can write a balance
because no balance exists to write.

### Amounts are integers

All money is stored in minor units (kobo). `0.1 + 0.2 !== 0.3` is not an acceptable
property for a church's accounts. Conversion happens only at the API boundary
(`utils/money.ts`), and the schema rejects a non-integer amount.

### Posted entries are immutable

A pre-save hook rejects modification of any field outside the small set involved in the
reversal handshake and status transitions. Corrections are made by posting an equal and
opposite `REVERSAL` entry and marking the original `REVERSED`.

**Reversed entries remain in the balance calculation.** This is easy to get wrong: if
the original is both marked reversed *and* excluded from the fold while a reversal entry
is also posted, the amount is subtracted twice. `REVERSED` is a marker on the history,
not an exclusion from the arithmetic. A test asserts the balance after a reversal
exactly.

### Idempotency is a unique index

Every business event derives a stable key — `offering:<id>`, `payment:<reference>`,
`expense:<id>`, `reversal:<id>` — and `idempotencyKey` is uniquely indexed. A duplicate
insert fails at the database and `postTransaction` returns the original entry with
`duplicate: true`.

A read-then-write check would lose the race between two concurrent webhook deliveries.
The index does not.

### Unit of work

`db/transaction.ts` runs multi-write operations inside a MongoDB transaction. On a
standalone `mongod`, which cannot begin one, it degrades to sequential writes plus
explicit compensating actions registered via `onRollback`, so a partial financial state
is never left behind in development either. The capability is probed once at startup and
logged.

### Approval gates

- An expense reaches the ledger only when approved (BR-015). An approval that would
  overdraw the purse is rolled back, leaving the expense pending rather than approved
  but unposted.
- A remittance debits the purse when its channel's condition is met: manual → an
  authorised user verifies the proof; provider transfer → the webhook confirms success.

---

## 4. Payments

### Provider abstraction

`PaymentProvider` declares initialise, verify, transfer, signature verification,
webhook parsing and transaction listing. Paystack, Flutterwave and a mock implement it.
Everything downstream depends only on the interface, so adding a provider is one file.

The two real providers differ in ways worth noting, and each difference is confined to
its own class:

| | Paystack | Flutterwave |
| --- | --- | --- |
| Amount units | minor | major |
| Webhook auth | HMAC-SHA512 of the body | shared "secret hash" header |
| Payout flow | create recipient, then transfer | single call |

### The browser is never authoritative

The post-checkout redirect proves nothing — it can be forged by navigating to the URL.
The callback page polls `/payments/status/:reference`, which reports only what the
backend has confirmed via webhook or a server-side verification call.

Even the webhook is not fully trusted: on a `success` event the backend re-verifies with
the provider's API before crediting, and an amount mismatch is flagged for reconciliation
rather than posted.

### Outbound payments

A payout is never marked successful on submission. The remittance is atomically claimed
with a conditional update (so a double click cannot submit twice), sent to the provider,
and moved to `PROCESSING`. The debit happens in the webhook handler.

---

## 5. Webhooks

Ordering is the design:

1. **Signature over raw bytes.** The JSON body parser retains the raw buffer for webhook
   routes only. Verifying a re-serialised body would fail on whitespace differences and
   invite the temptation to skip verification.
2. **Record the delivery** under a unique `(provider, eventKey)`. A replay stops here.
3. **Look up by our reference**, not the provider's.
4. **Ignore terminal payments.** A late event for a settled payment does nothing.
5. **Settle inside a transaction.**

The endpoint returns 200 for duplicates, unknown references and unrelated event types.
Providers retry on non-2xx, so returning an error for an event we correctly ignored
produces an endless retry loop.

---

## 6. Reconciliation

Compares our records against the provider's list and classifies differences as
`MATCHED`, `MISMATCHED` or `ORPHANED`. **Nothing is auto-corrected.** Automatically
rewriting a ledger entry so it agrees with an external system defeats the purpose of
keeping a ledger. Exceptions are surfaced for a human decision, and the decision is
audited.

---

## 7. Attendance

The day-of-week rule (BR-005–007) lives in one function, `assertAttendanceDateValid`,
and the error names both the day supplied and the day required so the UI can be
specific rather than saying "invalid date".

Registers are saved with a `bulkWrite` of upserts keyed on the BR-009 unique index
`(member, homecell, type, date)`. Resubmitting updates instead of failing, and two
coordinators saving concurrently cannot produce duplicates — the index is the guard, not
a prior read.

Dates are normalised to UTC midnight, because attendance is a calendar-day concept: a
register saved at 23:00 in Lagos and one saved at 01:00 the same civil day must compare
equal.

---

## 8. Transfers

A member's Homecell cannot be changed through a profile edit. The only path is a
transfer, which guarantees BR-017 history can never be bypassed.

The scope (same-area / cross-area / cross-zone) is derived from origin and destination
and selects the approval chain configured in settings. Each stage records who decided,
when, and any comment. A partial-index on `(member)` where `status = PENDING` means the
database itself refuses a second in-flight transfer for the same member.

---

## 9. Audit

Append-only at the model level: update and delete hooks throw. Field-level diffs store
only what changed, with secrets redacted by key name, so the trail stays readable and
small.

The seed reset uses the native driver to clear audit records precisely because the
application layer cannot delete them.

---

## 10. Frontend

- **Server state lives in TanStack Query**, never duplicated into component state. One
  `useApiMutation` wrapper handles the success toast, the error toast built from the
  API's own message, and cache invalidation.
- **Forms are React Hook Form + Zod**, with the same shape as the backend schema. Server
  validation errors carry field paths, so they can be mapped back onto the form.
- **Loading, error and empty states are one component** (`AsyncBoundary`), so every
  screen behaves identically. Error states render the API's actual message and
  distinguish permission failures from network failures, because the user's next action
  differs.
- **Tables render twice from one column definition**: a real table from `md` upward and a
  stacked card list on phones — the Homecell Coordinator's primary device. Horizontal
  scroll is contained to the table; the page body never scrolls sideways.
- **Charts read theme tokens**, so they follow light and dark mode instead of carrying
  their own colours.
- **No fabricated numbers.** Every figure on every dashboard comes from
  `GET /dashboard`, which computes it from the database under the caller's scope.

---

## 11. Security posture

| Concern | Measure |
| --- | --- |
| Password storage | Argon2id, 19 MiB / 2 iterations |
| Session theft | Hashed rotating refresh tokens; reuse revokes the whole family |
| Privilege escalation | Permission + scope checked server-side on every request |
| Injection | Zod strips unknown keys; `sanitizeInput` removes `$`/dotted keys before any query |
| Account enumeration | Identical responses for wrong password and unknown account |
| Brute force | Rate limits keyed on IP *and* identifier; account lock after repeated failures |
| Webhook forgery | Signature verified over raw bytes; replay blocked by unique index |
| Double spend | Unique idempotency keys; conditional claim on payouts |
| Malicious uploads | Magic-number type detection; random storage names; size limits |
| CSV injection | Leading `=`, `+`, `-`, `@` escaped in exports |
| Data exposure | Sensitive member fields stripped by role; secrets never serialised |
| Traceability | Append-only audit log with request correlation ids |

`sanitizeFilter` is deliberately **not** enabled in Mongoose: it wraps every nested `$`
key in `$eq`, silently breaking the legitimate `$gte` / `$in` / `$or` operators the
service layer builds. Injection is prevented at the boundary instead.

---

## 12. Deliberate scope boundaries

Out of scope per SRS §3.2 and not implemented: full church accounting or general ledger,
payroll, online tithe collection as a member-facing portal, sermon management,
livestreaming, membership classes, full event management, and a native mobile
application. The web application is fully responsive and is the mobile experience.

The architecture leaves room for the SRS §24 future modules — department management,
member self-service, QR-code attendance, WhatsApp and email notifications — because the
provider abstractions, the permission catalogue and the ledger are all extension points
rather than fixed lists.
