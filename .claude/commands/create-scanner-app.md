---
description: Scaffold the Empiria ticket-scanner Flutter app (QR check-in) + its Auth0-protected Next.js backend endpoints.
argument-hint: "[target-dir]  (default: ./empiria-scanner at the git root)"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

You are scaffolding a **Flutter ticket-scanner app** for Empiria event staff, plus the
**Auth0-protected backend endpoints** it calls. Build it end-to-end. Target dir for the
Flutter project: `$1` if given, otherwise `<git-root>/empiria-scanner`.

## Architecture (decided — do NOT change)
Flutter logs in with **Auth0** (native Universal Login) → sends the scanned QR secret +
Auth0 **Bearer access token** to a new **Next.js `/api/scan/*` endpoint** → the server
verifies the token, checks the user owns the event, and uses the **Supabase service-role**
client to validate + mark the ticket used. The Supabase service key NEVER ships in the app.

## Ground truth (verified in this repo — confirm by reading, don't trust blindly)
- Repo is double-nested: git root, Next.js app at `empiria-shop/empiria-shop/`. Backend
  files go under `empiria-shop/empiria-shop/app/api/scan/`.
- `tickets` columns: `id`, `qr_code_secret` (UUID bearer token = the QR payload),
  `seat_label`, `event_id`, `occurrence_id`, `tier_id`, `status` (`'valid'` | `'used'` | …).
  **No check-in timestamp exists yet** — you will add one (see Phase 1).
- Joins: `events(title, venue_name, city, organizer_id)`,
  `event_occurrences(starts_at, ends_at[, capacity])`, `ticket_tiers(name)`.
- **Auth mapping:** `events.organizer_id` IS the Auth0 `sub`; it equals `users.auth0_id`.
  Admins are `users.role === 'admin'`. Authorize check-in iff the token's `sub` ===
  ticket's `event.organizer_id` OR that `sub`'s `users.role` === `'admin'`.
- Supabase admin client: `import { getSupabaseAdmin } from '@/lib/supabase'`. `jose` is
  already a dependency. Existing web routes use the Auth0 **cookie** (`getSafeSession`) —
  the scanner endpoints must instead verify a **Bearer** token.

## Phase 0 — Verify before you build
1. Read `app/api/wallet/apple/share/[token]/route.ts` and `app/api/checkout/route.ts`
   (ticket insert) to re-confirm the exact `tickets` columns + status values.
2. Determine the capacity source for "X / Y checked in": check `event_occurrences`,
   `ticket_tiers`, and `events` for a capacity/quantity column. If none exists, use
   `count(status IN ('valid','used'))` for that event/occurrence as the denominator and
   label it "sold" instead of "capacity".
3. Confirm `flutter --version` works. If Flutter isn't installed, STOP and tell the user
   to install it (https://docs.flutter.dev/get-started/install), then resume.

## Phase 1 — Backend (Next.js, in `empiria-shop/empiria-shop/`)
1. **DB migration** — write `supabase-scan-checkin.sql` with:
   ```sql
   alter table tickets add column if not exists checked_in_at timestamptz;
   alter table tickets add column if not exists checked_in_by text;
   create index if not exists tickets_checked_in_at_idx on tickets (checked_in_at);
   ```
   Tell the user to run it in the Supabase SQL editor (there is no migrations folder).
2. **`lib/scanAuth.ts`** — `verifyScannerToken(req): Promise<{ sub: string } | null>`.
   Read the `Authorization: Bearer <jwt>` header; verify with `jose`
   `jwtVerify` using `createRemoteJWKSet(new URL(\`https://\${AUTH0_DOMAIN}/.well-known/jwks.json\`))`,
   `issuer: \`https://\${AUTH0_DOMAIN}/\``, `audience: process.env.AUTH0_SCANNER_AUDIENCE`.
   Return `{ sub: payload.sub }` or null. Add a helper `isAuthorizedForEvent(sub, organizerId)`
   that returns true if `sub === organizerId` or the `users` row for `auth0_id = sub` has
   `role === 'admin'`.
3. **`app/api/scan/events/route.ts`** (`GET`) — auth via `verifyScannerToken`; 401 if null.
   Return the events owned by `sub` (`events.organizer_id = sub`; admins get all), each with
   its occurrences and, per occurrence, `{ checkedIn, total }` counts from `tickets`.
4. **`app/api/scan/check-in/route.ts`** (`POST`, body `{ secret, eventId?, occurrenceId? }`):
   - `verifyScannerToken` → 401 if null.
   - Look up ticket by `qr_code_secret = secret` joined to event/occurrence/tier. 404
     `{ result: 'not_found' }` if missing.
   - If `eventId` given and ticket's event ≠ eventId → `{ result: 'wrong_event' }` (HTTP 200,
     it's a domain result not an error). Same for `occurrenceId` if provided.
   - `isAuthorizedForEvent(sub, ticket.event.organizer_id)` false → 403 `{ result: 'forbidden' }`.
   - If `status === 'used'` → `{ result: 'already_used', checkedInAt, ticket }`.
   - If `status === 'valid'` → update to `'used'`, set `checked_in_at = now()`,
     `checked_in_by = sub`; return `{ result: 'ok', ticket }` with event title, tier name,
     seat_label, occurrence start, and the live `{ checkedIn, total }` for that occurrence.
   - Any other status (`refunded`/`void`/…) → `{ result: 'invalid', status }`.
   - Use a conditional update (`.eq('status','valid')`) so two simultaneous scans can't both
     succeed; if the update affects 0 rows, re-read and return `already_used`.
5. Add `AUTH0_SCANNER_AUDIENCE` to the env docs (`WALLET_SETUP.md` or a new `SCANNER_SETUP.md`)
   and to `.env.local` as a placeholder. Do not invent a value — the user creates the Auth0 API.

## Phase 2 — Flutter app (in the target dir)
1. `flutter create --org events.empiria --project-name empiria_scanner <target-dir>`
   (iOS + Android). Then `flutter pub add auth0_flutter mobile_scanner http provider`.
2. **Config via `--dart-define`**, read in `lib/config.dart`:
   `API_BASE_URL`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`, `AUTH0_SCHEME`
   (custom URL scheme for the native callback). No secrets hardcoded.
3. **Auth service** (`auth0_flutter`): `login()` runs Universal Login requesting
   `audience: AUTH0_AUDIENCE` + scopes `openid profile email`; persist credentials via the
   SDK's `CredentialsManager`; expose `accessToken()` (auto-refresh) and `logout()`.
4. **API client** (`http`): attaches `Authorization: Bearer <accessToken>`; methods
   `fetchEvents()` and `checkIn(secret, {eventId, occurrenceId})` mapping to the result union
   (`ok` | `already_used` | `wrong_event` | `invalid` | `not_found` | `forbidden`).
5. **Screens** (use `provider` for state, keep it lean):
   - **Login** — single "Sign in" button → `AuthService.login()`.
   - **Events/Home** — `fetchEvents()` list; each row shows title + per-occurrence
     `checkedIn / total`; pull-to-refresh; tap an occurrence → Scanner scoped to it.
   - **Scanner** — `mobile_scanner` camera. On detect: debounce (ignore repeat scans of the
     same code within ~2.5s and while a request is in flight), call `checkIn`, then show a
     full-screen result overlay: **green** `ok` (event/tier/seat + "Checked in"), **amber**
     `already_used` (show `checked_in_at` time), **red** `wrong_event`/`invalid`/`not_found`/
     `forbidden` with a clear message. Trigger `HapticFeedback` (success vs error). Keep a
     running checked-in count for the active occurrence, updating from each `ok` response.
   - Handle camera-permission denial gracefully.
6. **Native config:** add camera usage strings — iOS `NSCameraUsageDescription` in
   `Info.plist`; Android `<uses-permission android:name="android.permission.CAMERA"/>`.
   Configure the Auth0 callback/redirect for `AUTH0_SCHEME` (iOS `CFBundleURLTypes`,
   Android `appAuthRedirectScheme` manifest placeholder per the auth0_flutter README).

## Phase 3 — Write `SCANNER_SETUP.md` (manual steps you can't automate)
Document, concisely, what the user must do by hand:
- **Auth0 → APIs:** create an API (e.g. identifier `https://api.empiria.events/scanner`);
  that identifier is `AUTH0_AUDIENCE` (Flutter) and `AUTH0_SCANNER_AUDIENCE` (Next backend).
- **Auth0 → Applications:** create a **Native** app; add the mobile callback/logout URLs for
  `AUTH0_SCHEME` (give the exact iOS/Android strings from the auth0_flutter README). Its
  Client ID is `AUTH0_CLIENT_ID`.
- Run `supabase-scan-checkin.sql` in Supabase.
- Set `AUTH0_SCANNER_AUDIENCE` in Vercel + redeploy so the endpoints can verify tokens.
- The exact `flutter run --dart-define=...` command with every key (point `API_BASE_URL` at
  the deployed shop URL, e.g. `https://shop.empiria.events`).

## Done when
- `cd empiria-shop/empiria-shop && bun --bun next build` succeeds with the new endpoints.
- `cd <target-dir> && flutter analyze` is clean.
- `SCANNER_SETUP.md` lists every manual step and the full `flutter run` command.
Then print a short summary: what was created, and the user's remaining manual steps.
