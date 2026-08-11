# API reference

Base URL: `{BACKEND_URL}/api/v1`

All endpoints except the ones marked **public** require
`Authorization: Bearer <accessToken>`.

## Conventions

- Monetary values cross the API in **major units** (naira) and are stored internally in
  minor units (kobo). Fields ending in `Minor` are the raw stored integers.
- Dates are `YYYY-MM-DD`; timestamps are ISO 8601 UTC.
- List endpoints accept `page`, `limit` (max 100), `sort`, `order`, `search`, plus the
  filters listed per endpoint. Results are always scoped to the caller's Zone / Area /
  Homecell — passing a unit outside that scope returns `403 OUT_OF_SCOPE`.

### Envelopes

```jsonc
// success
{ "success": true, "data": …, "meta": { "pagination": { … } } }

// failure
{ "success": false, "error": { "code": "…", "message": "…", "details": [], "requestId": "…" } }
```

### Error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | Payload failed schema validation; `details` lists fields |
| `UNAUTHENTICATED` | 401 | Missing or invalid token |
| `INVALID_CREDENTIALS` | 401 | Wrong identifier or password |
| `TOKEN_EXPIRED` | 401 | Access or refresh token has expired |
| `ACCOUNT_DISABLED` | 403 | Inactive, suspended or temporarily locked |
| `FORBIDDEN` | 403 | Role lacks the required permission |
| `OUT_OF_SCOPE` | 403 | Record is outside the caller's organisational scope |
| `NOT_FOUND` | 404 | No such record |
| `CONFLICT` | 409 | Conflicts with current state |
| `DUPLICATE` | 409 | Unique constraint violated |
| `ALREADY_PROCESSED` | 409 | Idempotent operation already applied |
| `BUSINESS_RULE_VIOLATION` | 422 | SRS rule broken; `details.rule` names it |
| `INSUFFICIENT_BALANCE` | 422 | Debit exceeds the available purse balance |
| `PAYMENT_VERIFICATION_FAILED` | 422 | Provider disagrees about the payment |
| `PROVIDER_ERROR` | 502 | Upstream provider failed |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected failure |

---

## Auth

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login` | **public** · `{ identifier, password }` — identifier is an email or phone number |
| POST | `/auth/refresh` | **public** · rotates the refresh token |
| POST | `/auth/logout` | revokes the presented refresh token |
| GET | `/auth/session` | current user with effective permissions |
| POST | `/auth/change-password` | revokes all sessions |
| POST | `/auth/forgot-password` | **public** · always 200, never reveals whether an account exists |
| POST | `/auth/reset-password` | **public** · `{ token, newPassword, confirmPassword }` |

## Users

`GET /users` · `GET /users/:id` · `GET /users/assignable?role=` ·
`POST /users` · `PATCH /users/:id` · `PATCH /users/:id/status` ·
`PATCH /users/:id/permissions` · `POST /users/:id/reset-password`

Creating a user without a password returns a generated one once, in
`meta.temporaryPassword`.

## Church structure

`GET|POST /zones` · `GET /zones/options` · `GET|PATCH /zones/:id` · `PATCH /zones/:id/status`

`GET|POST /areas` · `GET /areas/options?zoneId=` · `GET|PATCH /areas/:id` · `PATCH /areas/:id/status`

`GET|POST /homecells` · `GET /homecells/options?zoneId=&areaId=` · `GET|PATCH /homecells/:id` · `PATCH /homecells/:id/status`

Deactivating a unit requires its children to be inactive first.

## Members

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/members` | filters: `zoneId`, `areaId`, `homecellId`, `sex`, `membershipStatus`, `membershipCategory`, `minAge`, `maxAge`, `state`, `lga`, `city`, `joinedFrom`, `joinedTo` |
| GET | `/members/:id` | sensitive fields removed without `members.view_sensitive` |
| GET | `/members/roster/:homecellId` | active members, for the attendance screen |
| GET | `/members/celebrations?days=30` | upcoming birthdays and anniversaries |
| POST | `/members` | supply `homecellId` only — Area and Zone are derived |
| PATCH | `/members/:id` | the Homecell cannot be changed here; use a transfer |
| PATCH | `/members/:id/status` | |

## Transfers

`GET /transfers` · `GET /transfers/:id` · `GET /transfers/member/:memberId` ·
`POST /transfers` · `POST /transfers/:id/approve` · `POST /transfers/:id/reject` ·
`POST /transfers/:id/cancel`

Scope (`SAME_AREA`, `CROSS_AREA`, `CROSS_ZONE`) is derived from origin and destination
and selects the configured approval chain. The member moves only on final approval.

## Attendance

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/attendance` | filters: org, `type`, `status`, `memberId`, `from`, `to` |
| GET | `/attendance/register?homecellId=&type=&date=` | full roster with any existing marks; reports `isValidDate` |
| GET | `/attendance/summary` · `/attendance/trend` | |
| GET | `/attendance/member/:memberId` | |
| POST | `/attendance` | `{ homecellId, type, date, entries: [{ memberId, status }] }` |
| PATCH | `/attendance/:id` | correct a single record |

`422 BUSINESS_RULE_VIOLATION` with `details.rule` = `BR-005` / `BR-006` / `BR-007` when
the date does not match the service day. Resubmitting a register updates it rather than
duplicating (BR-009).

## Finance

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/finance/purses` · `/finance/purses/:homecellId` | derived balances and threshold state |
| GET | `/finance/ledger` · `/finance/ledger/:id` | filters: org, `type`, `status`, `from`, `to` |
| POST | `/finance/ledger/adjustments` | signed manual correction |
| POST | `/finance/ledger/:id/reverse` | `{ reason }` |
| GET/POST | `/finance/offerings` | Sunday only (BR-008) |
| POST | `/finance/offerings/:id/reverse` | |
| GET/POST | `/finance/expense-categories` | |
| GET/POST | `/finance/expenses` | |
| POST | `/finance/expenses/:id/approve` · `/reject` · `/reverse` | only approval debits the purse |

## Remittances

`GET|POST /remittances` · `GET /remittances/:id` ·
`POST /remittances/:id/approve` · `/verify` · `/disburse` · `/reject` · `/reverse` · `/receipt`

`verify` posts the debit for a manual remittance; `disburse` sends a provider payout
and the debit follows the webhook.

## Payments

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/payments/webhooks/paystack` \| `/flutterwave` \| `/mock` | **public**, signature-verified |
| GET | `/payments/status/:reference` | **public** — used by the callback page |
| GET | `/payments` · `/payments/:id` · `/payments/providers` | |
| POST | `/payments/initiate` | returns `authorizationUrl` |
| POST | `/payments/:reference/verify` | asks the provider directly |
| POST | `/payments/:id/settle` | manual settlement, requires `finance.reconcile` |
| GET | `/payments/webhook-events` | delivery log |
| GET | `/payments/reconciliation/summary` · `/runs` · `/runs/:id` | |
| POST | `/payments/reconciliation/run` | |
| POST | `/payments/reconciliation/runs/:id/exceptions/:exceptionId/resolve` | |

## Reports

`GET /reports` lists the available reports.
`GET /reports/:key` runs one. `GET /reports/:key/export?format=csv|xlsx|pdf` downloads it.

Keys: `members`, `attendance`, `financial`, `transactions`, `remittances`, `transfers`,
`demographics-age`, `demographics-sex`, `demographics-location`.

## Platform

`GET /dashboard` · `GET /dashboard/celebrations`

`GET /notifications` · `GET /notifications/unread-count` ·
`PATCH /notifications/:id/read` · `PATCH /notifications/read-all`

`GET /sms` · `/sms/statistics` · `/sms/providers` · `POST /sms/test` ·
`POST /sms/dispatch-celebrations`

`GET /audit-logs` · `/audit-logs/entity/:model/:id` · `/audit-logs/statistics`

`GET /settings` · `/settings/integrations` · `PATCH /settings`

`POST /uploads` (multipart `file`, `folder`) · `DELETE /uploads` ·
`GET /uploads/config` · `GET /uploads/files/:folder/:name` (**public**, local storage only)
