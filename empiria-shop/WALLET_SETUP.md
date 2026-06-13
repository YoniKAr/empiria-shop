# Wallet Setup — Apple & Google Wallet Tickets

How the "Add to Apple/Google Wallet" feature is wired, and what's required to run it
in production. Tickets are generated in [`lib/wallet.ts`](lib/wallet.ts) and surfaced
in the confirmation email, the checkout success page, and the public share page (`/t/<token>`).

> ⚠️ **Secrets never live in this repo.** The certificate/key files and `.env.local`
> are git-ignored. Set the real values in your host's environment (Vercel → Project →
> Settings → Environment Variables). This file documents the variable **names** only.

## Environment variables

All 8 wallet variables below must be set in production, plus `APP_BASE_URL` (already a
required app var). Without them the wallet functions return `null` and the buttons
degrade gracefully (the QR code still works).

| Variable | Secret? | What it is / where it comes from |
|---|---|---|
| `APP_BASE_URL` | no | Public site URL (e.g. `https://empiriaindia.com`). Used for the Google pass logo URL and `origins`. Already required by the app. |
| **Google** | | |
| `GOOGLE_WALLET_ISSUER_ID` | no | Issuer ID from the Google Pay & Wallet Console (Google Wallet API section). |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL` | no | `client_email` from the service-account JSON. |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_BASE64` | **yes** | base64 of the whole service-account JSON key. |
| **Apple** | | |
| `APPLE_TEAM_ID` | no | 10-char Apple Developer Team ID. |
| `APPLE_PASS_TYPE_ID` | no | Pass Type ID, e.g. `pass.com.empiriaindia.tickets`. |
| `APPLE_PASS_CERT_BASE64` | **yes** | base64 of the signing `.p12` (cert + private key). |
| `APPLE_PASS_CERT_PASSWORD` | **yes** | Password for the `.p12`. |
| `APPLE_WWDR_CERT_BASE64` | **yes** | base64 of Apple's WWDR intermediate cert (G4). |

## Local credential files (git-ignored — keep backed up)

These are how the base64 env values are produced. **Back them up somewhere safe**
(a password manager / secure storage) — they are not in git.

```
google-wallet-key.json        # Google service-account key
apple-cert/pass.key           # Apple private key (pairs with the cert)
apple-cert/pass.cer           # Apple-issued Pass Type ID certificate
apple-cert/pass.p12           # cert + key bundle (signs every pass)
apple-cert/wwdr.pem           # Apple WWDR G4 intermediate
```

### Regenerate the base64 values (to paste into Vercel)

```bash
# Google
base64 -i google-wallet-key.json | tr -d '\n'        # GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_BASE64

# Apple
base64 -i apple-cert/pass.p12 | tr -d '\n'           # APPLE_PASS_CERT_BASE64
base64 -i apple-cert/wwdr.pem | tr -d '\n'           # APPLE_WWDR_CERT_BASE64
```

The non-secret identifier values (issuer ID, team ID, etc.) and the `.p12` password are
in your local `.env.local`.

## Deploying

1. In Vercel, add all 8 wallet variables (+ confirm `APP_BASE_URL` is your real domain).
2. `public/logo-white.png` ships in the repo and is served at `<APP_BASE_URL>/logo-white.png`
   — Google fetches it for the pass logo, so it must be publicly reachable after deploy.

## Going fully live

- **Google:** new issuers start in **demo mode** (passes show `[TEST ONLY]`, and only
  test accounts can save). Request **publishing access** in the Wallet Console to let the
  public add tickets. The service account must be added under **Users** in the console.
- **Apple:** works as soon as the certs are set. The Pass Type ID certificate expires
  (~1 year) — regenerate it before expiry. Strip/logo artwork lives in `public/wallet/`.

## How passes are modeled

- **Google:** one **class per event** (`<issuer>.event-<eventId>`) holding the event
  name/venue/date/logo; one **object per ticket** (`<issuer>.ticket-<ticketId>`) holding
  the seat, ticket type, and QR barcode. The save JWT inlines both, so Google creates
  them on first save.
- **Apple:** a signed `.pkpass` (eventTicket) built with `passkit-generator`; the `.p12`
  is parsed with `node-forge` to extract the cert + key for signing.

## Sharing

`/t/<qr_code_secret>` is a public page (no login) that lets a buyer forward a ticket to a
guest, who can add it to their own wallet. The token is the ticket's `qr_code_secret`
(an unguessable UUID) — treat the link as the ticket itself.
