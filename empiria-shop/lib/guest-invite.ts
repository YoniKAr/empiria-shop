// ──────────────────────────────────────────────────
// lib/guest-invite.ts — Guest → account invite flow
//
// After a successful GUEST purchase we silently create an Auth0 account for
// the buyer's contact email (public /dbconnections/signup with a strong random
// throwaway password), then trigger Auth0's own change-password email
// (public /dbconnections/change_password). That email is the guest's
// "finish your signup" link: they set a password, log in, and the existing
// post-login Action routes them through onboarding as normal.
//
// No Management API and no new credentials — both endpoints are public and
// only need AUTH0_DOMAIN + AUTH0_CLIENT_ID (already in env). Works on the
// custom domain (authid.empiriaindia.com).
//
// Fire-and-forget safe: inviteGuestToFinishSignup never throws. Idempotent
// across Stripe webhook retries: a retry hits Guard A (users row) or Guard B
// (Auth0 user-already-exists) and skips without re-emailing.
// ──────────────────────────────────────────────────

import { randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';

const LOG_PREFIX = '[guest-invite]';

/**
 * Cryptographically random throwaway password that satisfies any Auth0
 * password policy: 32 random bytes base64-encoded, plus a fixed suffix
 * guaranteeing lower/upper/digit/special character classes. The guest never
 * sees or uses it — they set their own via the change-password email.
 */
function generateThrowawayPassword(): string {
  return `${randomBytes(32).toString('base64')}aZ9!`;
}

/**
 * After a successful guest purchase, create an Auth0 account for the contact
 * email and have Auth0 email them a set-your-password ("finish signup") link.
 *
 * Never throws — all failures are logged with the [guest-invite] prefix.
 */
export async function inviteGuestToFinishSignup({
  email,
  name,
}: {
  email: string;
  name?: string | null;
}): Promise<void> {
  try {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail) {
      console.log(`${LOG_PREFIX} skipped (no contact email)`);
      return;
    }

    const auth0Domain = process.env.AUTH0_DOMAIN; // custom domain, no scheme
    const clientId = process.env.AUTH0_CLIENT_ID;
    if (!auth0Domain || !clientId) {
      console.error(`${LOG_PREFIX} skipped — AUTH0_DOMAIN / AUTH0_CLIENT_ID not configured`);
      return;
    }
    const connection = process.env.AUTH0_DB_CONNECTION || 'Username-Password-Authentication';

    // ── Guard A: existing app account? (users.email, case-insensitive) ──
    // ilike with no wildcards = case-insensitive equality.
    const supabase = getSupabaseAdmin();
    const { data: existingUser, error: lookupError } = await supabase
      .from('users')
      .select('auth0_id')
      .ilike('email', normalizedEmail)
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      // Can't safely tell whether they have an account — don't risk creating
      // a duplicate or spamming a password email; bail out quietly.
      console.error(`${LOG_PREFIX} users lookup failed for ${normalizedEmail}:`, lookupError);
      return;
    }
    if (existingUser) {
      console.log(`${LOG_PREFIX} skipped (existing account) for ${normalizedEmail}`);
      return;
    }

    // ── Step 1: silently create the Auth0 account (public signup endpoint) ──
    const signupRes = await fetch(`https://${auth0Domain}/dbconnections/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        connection,
        email: normalizedEmail,
        password: generateThrowawayPassword(),
        ...(name?.trim() ? { name: name.trim() } : {}),
      }),
    });

    if (!signupRes.ok) {
      // Guard B: user already exists in Auth0 (e.g. webhook retry, or they
      // signed up but never logged in so no users row exists yet). Auth0
      // returns 400 with either of these shapes:
      //   { "code": "invalid_signup", "description": "Invalid sign up" }
      //   { "code": "user_exists", "name": "BadRequestError",
      //     "description": "The user already exists." }
      // Skip WITHOUT sending change_password — don't spam password resets.
      let errBody: { code?: string; name?: string; description?: string } = {};
      try {
        errBody = await signupRes.json();
      } catch {
        // non-JSON error body — fall through to the generic failure log
      }
      const errCode = errBody.code || errBody.name || '';
      if (
        signupRes.status === 400 &&
        (errCode === 'invalid_signup' || errCode === 'user_exists')
      ) {
        console.log(
          `${LOG_PREFIX} skipped (auth0 account already exists: ${errCode}) for ${normalizedEmail}`
        );
        return;
      }
      console.error(
        `${LOG_PREFIX} auth0 signup failed for ${normalizedEmail}: HTTP ${signupRes.status}`,
        errBody
      );
      return;
    }

    // ── Step 2: signup succeeded → trigger Auth0's set-password email ──
    const changeRes = await fetch(`https://${auth0Domain}/dbconnections/change_password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        connection,
        email: normalizedEmail,
      }),
    });

    if (!changeRes.ok) {
      const text = await changeRes.text().catch(() => '');
      console.error(
        `${LOG_PREFIX} created auth0 account but change_password email failed for ${normalizedEmail}: HTTP ${changeRes.status} ${text}`
      );
      return;
    }

    console.log(
      `${LOG_PREFIX} created auth0 account + sent finish-signup email for ${normalizedEmail}`
    );
  } catch (err) {
    // Fire-and-forget: never let invite failures affect purchase fulfillment.
    console.error(`${LOG_PREFIX} unexpected failure:`, err);
  }
}
