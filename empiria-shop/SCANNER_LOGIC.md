# Scanner Logic

How ticket scanning and volunteer codes actually work, end to end. For one-time
environment setup see [SCANNER_SETUP.md](./SCANNER_SETUP.md).

## Architecture in one picture

```
Flutter scanner app                Next.js backend (this repo)            Supabase
  Auth0 staff login   ──Bearer───>  /api/scan/*   ── service role ──>   tickets
  or volunteer code   ──X-Volunteer-Code──>  (verifies caller,          events
  scan QR → secret                            checks ownership,         event_occurrences
                                              reads/writes tickets)     event_volunteer_codes
```

The app **never** holds the Supabase service-role key. It proves who it is
(Auth0 token or volunteer code), sends the scanned QR **secret**, and the server
does all privileged work with `getSupabaseAdmin()` ([lib/supabase.ts](./lib/supabase.ts)).

---

## 1. Who is allowed to scan (identity)

Every `/api/scan/*` call is gated by `resolveScanIdentity(req)` in
[lib/scanAuth.ts](./lib/scanAuth.ts), which returns one of two identities, or
`null`:

| Identity | How it authenticates | Scope |
|----------|----------------------|-------|
| **staff** | `Authorization: Bearer <Auth0 access token>` — verified against the scanner API audience via JWKS (`verifyScannerToken`) | Any event they **own** (`events.organizer_id === sub`) or **all** events if their `users.role = 'admin'` |
| **volunteer** | `X-Volunteer-Code: <code>` header — looked up by `findActiveVolunteerCode` | Exactly the **one event** the code belongs to |

Authorization for a specific event is then checked by `canScanEvent(identity, event)`:
- volunteer → `identity.eventId === event.id`
- staff → `isAuthorizedForEvent(sub, organizer_id)` (owner OR admin)

So a volunteer code is a scoped, accountless credential; a staff token is a full
Auth0 identity. Both flow through the same gate.

---

## 2. Scan logic — check-in (`POST /api/scan/check-in`)

The real scan. Validates a ticket **and marks it used**. Source:
[app/api/scan/check-in/route.ts](./app/api/scan/check-in/route.ts).

Request body: `{ secret, eventId?, occurrenceId? }` — `secret` is the ticket's
`qr_code_secret` (the UUID inside the QR). `eventId`/`occurrenceId` are the
event/date the scanner is bound to.

Flow:

1. **Resolve identity** (`resolveScanIdentity`). No identity → `401`.
2. **Look up the ticket** by `qr_code_secret`, joining `events`, the occurrence,
   and the tier. Not found → `result: 'not_found'`.
3. **Match the event/date**: if `eventId` is given and differs →
   `result: 'wrong_event'`; if `occurrenceId` differs → `result: 'wrong_occurrence'`.
4. **Authorize** the caller for that event (`canScanEvent`). Fails → `result: 'forbidden'` (403).
5. **Classify status**:
   - already `used` → `result: 'already_used'` (returns the original `checkedInAt`).
   - not `valid` (e.g. `refunded`, `void`) → `result: 'invalid'` with the status.
6. **Race-safe consume**: a conditional update flips `valid → used` only if the
   row is *still* `valid`:
   ```ts
   .update({ status: 'used', checked_in_at: now, checked_in_by })
   .eq('id', ticket.id)
   .eq('status', 'valid')   // ← the guard
   ```
   If zero rows come back, another scanner won the race → `result: 'already_used'`.
   Otherwise → `result: 'ok'`. This is why two simultaneous scans of the same
   ticket can't both succeed.

`checked_in_by` records who scanned: the Auth0 `sub` for staff, or
`volunteer:<codeId>` for a volunteer.

Domain outcomes (`wrong_event`, `invalid`, `already_used`, …) return **HTTP 200**
— they are results, not transport errors. Only auth/transport problems are
non-200. The Flutter `CheckInResult` model parses this `result` union.

## 2b. Read-only verify (`POST /api/scan/verify`)

A **read-only twin** of check-in: same lookup, same auth, same `result` union —
but it **never writes** (never flips `valid → used`). Source:
[app/api/scan/verify/route.ts](./app/api/scan/verify/route.ts). Use it to probe a
ticket without consuming it.

It adds a convenience top-level boolean: `valid: true` only when `result === 'ok'`
(a genuine ticket for this event that hasn't been used). `used`/`refunded`/wrong
event all return `valid: false` with the real status, so the UI can message them
differently.

`resolveZone` (the tier→seating-zone helper shared by both routes) lives in
[lib/scan.ts](./lib/scan.ts).

## 2c. Supporting reads

- `GET /api/scan/events` — events the caller may scan, each occurrence with
  `{ checkedIn, total }` (total = sold = `valid` + `used`).
- `GET /api/scan/attendees?eventId=…` — ticket holders for an event, each with a
  `checkedIn` flag (drives the dashboard's live counter and "people scanned" list).
- `GET /api/scan/me` — the caller's role; the app uses it to gate entry to
  `admin`/`organizer` only.

---

## 3. Volunteer code generation & lifecycle

A volunteer code lets someone scan **one event** without an Auth0 account. There
is **one active code per event** — "every volunteer uses the same code."

### How a code is generated

`generateVolunteerCode()` in [lib/scanAuth.ts](./lib/scanAuth.ts):

```
format:   XXXX-XXXX   e.g. 7K2P-9QWE
alphabet: ABCDEFGHJKLMNPQRSTUVWXYZ23456789   (32 symbols; no 0 O 1 I)
space:    32^8 ≈ 1.1 trillion combinations
```

The code is random, not derived from the event — the **database row** links a
code to its event. (It uses `Math.random()`; fine for a low-stakes shareable
code, but not cryptographically unguessable.)

### Why a code can't collide across events

Two layers, in [supabase-volunteer-codes.sql](./supabase-volunteer-codes.sql) and
the route:

1. **Global unique constraint** — `unique (code)` on the whole
   `event_volunteer_codes` table (not per-event). The DB makes it impossible for
   two rows — any event, active or not — to share a code string.
2. **Insert-with-retry** — minting generates a code and inserts; on a unique
   violation (`23505`) it retries with a new code (up to 5 times).

This is what makes `findActiveVolunteerCode(code)` safe: it looks a code up **by
value alone** and returns exactly one event. If codes could collide, that lookup
would be ambiguous and a volunteer could scan the wrong event.

### The endpoints ([app/api/scan/volunteer-codes/route.ts](./app/api/scan/volunteer-codes/route.ts))

All organizer/admin only, gated by the shared `authorizeEvent` helper (valid
scanner token **and** ownership of the event).

| Method | Body / query | Does |
|--------|--------------|------|
| `GET`  | `?eventId=…` | Returns the event's current code + `active`, **without creating one**. `{ exists: false }` if none yet. |
| `POST` | `{ eventId, label?, regenerate? }` | Get-or-create the active code. `regenerate: true` deactivates the current code and mints a fresh one. Returns `{ code, active, created }`. |
| `PATCH`| `{ eventId, active }` | **Pause / resume** the current code without changing the string. |

### Generate vs. regenerate vs. pause/resume

- **Generate** (first `POST`) → mints the event's first code (`created: true`).
- **Reuse** (later `POST`) → returns the existing active code unchanged (`created: false`).
- **Regenerate** (`POST regenerate:true`) → sets old active code(s) `is_active = false`
  and mints a brand-new code string. Old code stops working forever.
- **Deactivate / Resume** (`PATCH active:false|true`) → flips `is_active` on the
  **same** code. The code string is preserved, so resuming restores the exact
  code volunteers already have. Retired codes keep their unique value, so a paused
  code can never be re-minted for another event.

A deactivated code is rejected immediately at scan time: `findActiveVolunteerCode`
returns `null` for `is_active = false` (or expired) rows, so both new redeems and
in-progress volunteers' scans start failing until it's resumed.

### Redeeming a code (volunteer login)

`POST /api/scan/volunteer-codes/redeem` `{ code }` — public (the code *is* the
credential). On success it returns the event the code grants. The app then sends
`X-Volunteer-Code: <code>` on every subsequent scan, where `resolveScanIdentity`
re-validates it. See [redeem/route.ts](./app/api/scan/volunteer-codes/redeem/route.ts).

---

## 4. Outcome reference

`result` values returned by check-in / verify (Flutter `CheckInOutcome`):

| `result` | Meaning |
|----------|---------|
| `ok` | Valid ticket; checked in (check-in) / would be valid (verify) |
| `already_used` | Genuine ticket, already scanned (includes original `checkedInAt`) |
| `wrong_event` | Ticket is for a different event |
| `wrong_occurrence` | Ticket is for a different date of this event |
| `invalid` | Ticket exists but status isn't scannable (`refunded`, `void`, …) |
| `not_found` | No ticket with that QR secret |
| `forbidden` | Caller isn't authorized for this event |

---

## 5. File map

| Concern | File |
|---------|------|
| Identity, authz, code lookup, code generation | [lib/scanAuth.ts](./lib/scanAuth.ts) |
| Shared ticket helpers (`resolveZone`) | [lib/scan.ts](./lib/scan.ts) |
| Service-role Supabase client | [lib/supabase.ts](./lib/supabase.ts) |
| Check-in (write) | [app/api/scan/check-in/route.ts](./app/api/scan/check-in/route.ts) |
| Verify (read-only) | [app/api/scan/verify/route.ts](./app/api/scan/verify/route.ts) |
| Volunteer codes (GET/POST/PATCH) | [app/api/scan/volunteer-codes/route.ts](./app/api/scan/volunteer-codes/route.ts) |
| Volunteer redeem | [app/api/scan/volunteer-codes/redeem/route.ts](./app/api/scan/volunteer-codes/redeem/route.ts) |
| Events / attendees / me | [app/api/scan/events/route.ts](./app/api/scan/events/route.ts), [attendees](./app/api/scan/attendees/route.ts), [me](./app/api/scan/me/route.ts) |
| DB: check-in columns | [supabase-scan-checkin.sql](./supabase-scan-checkin.sql) |
| DB: volunteer codes table | [supabase-volunteer-codes.sql](./supabase-volunteer-codes.sql) |
