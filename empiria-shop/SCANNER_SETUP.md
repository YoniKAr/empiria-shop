# Empiria Scanner — setup

The Empiria Scanner Flutter app (`empiria_scan_app/empiria_scan`) signs staff in
with **Auth0**, then calls these backend endpoints with the Auth0 **Bearer
access token**. The server verifies the token and uses the Supabase
service-role client to validate / mark tickets — the Supabase key never ships in
the app.

## Endpoints (added)
- `GET  /api/scan/me` — `{ authorized, role, name }`. The app calls this right
  after Auth0 login and **blocks sign-in** unless `role` is `admin` or
  `organizer` (anyone else — `attendee` or no `users` row — is rejected).
- `GET  /api/scan/events` — events the staff member may scan, with per-occurrence
  `{ checkedIn, total }` (`checkedIn` = tickets `used`; `total` = `valid`+`used`).
- `GET  /api/scan/attendees?eventId=…` — ticket holders for an event the staff
  member may scan: `{ name, email, tierName, seatLabel, checkedIn, avatarUrl }`.
- `POST /api/scan/check-in` — body `{ secret, eventId?, occurrenceId? }`. Returns
  `{ result: 'ok' | 'already_used' | 'wrong_event' | 'wrong_occurrence' |
  'invalid' | 'not_found' | 'forbidden', ticket?, verifiedAt?, checkedInAt? }`.

Auth: `events.organizer_id` is the Auth0 `sub`. A staff member may check in iff
`sub === event.organizer_id` **or** their `users` row (`auth0_id = sub`) has
`role = 'admin'`. (`lib/scanAuth.ts`.)

## Manual steps

### 1. Run the DB migration
In the Supabase SQL editor, run **`supabase-scan-checkin.sql`** (adds
`checked_in_at`, `checked_in_by`, and an index to `tickets`). The check-in
endpoint requires these columns.

### 2. Auth0 (already created for this tenant)
- **API** → Identifier `https://api.empiria.events/scanner` (RS256). This is the
  `AUTH0_AUDIENCE` (app) / `AUTH0_SCANNER_AUDIENCE` (backend).
- **Native app** → Client ID `vjxbEyvBCVBDTPp0E2VJharEJsi3IsHd`,
  domain `dev-xfrllixdeckfw1y6.us.auth0.com`.
  - Allowed Callback **and** Logout URLs:
    ```
    com.example.empiriaScan://dev-xfrllixdeckfw1y6.us.auth0.com/ios/com.example.empiriaScan/callback,
    empiriascan://dev-xfrllixdeckfw1y6.us.auth0.com/android/com.example.empiria_scan/callback
    ```
  - Enable the **Google** social connection and turn it on for this app
    (Authentication → Social → Google → Applications). For the passkey button,
    enable **Passkeys** on the `Username-Password-Authentication` connection.
    (The email/password form is hidden in the app; only enable the **Password**
    grant + tenant **Default Directory** if you bring that form back.)

### 3. Backend env
`AUTH0_SCANNER_AUDIENCE=https://api.empiria.events/scanner` is set in
`.env.local`. **Also add it in Vercel → Project → Settings → Environment
Variables and redeploy**, so the deployed endpoints can verify tokens. (Token
issuer/JWKS reuse the existing `AUTH0_DOMAIN`.)

### 4. Run the Flutter app
Point `API_BASE_URL` at the deployed shop (or your machine's LAN IP for local,
e.g. `http://192.168.x.x:3000`). Values are in
`empiria_scan/config/dev.env`; run:
```bash
cd empiria_scan
flutter run --dart-define-from-file=config/dev.env
```
Equivalent explicit form:
```bash
flutter run \
  --dart-define=API_BASE_URL=https://shop.empiria.events \
  --dart-define=AUTH0_DOMAIN=dev-xfrllixdeckfw1y6.us.auth0.com \
  --dart-define=AUTH0_CLIENT_ID=vjxbEyvBCVBDTPp0E2VJharEJsi3IsHd \
  --dart-define=AUTH0_AUDIENCE=https://api.empiria.events/scanner \
  --dart-define=AUTH0_SCHEME=empiriascan
```
UI-only preview (no Auth0/backend): `--dart-define-from-file=config/demo.env`.
