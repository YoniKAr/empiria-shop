import { NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getSupabaseAdmin } from '@/lib/supabase';

// Verifies Auth0 *Bearer access tokens* sent by the Empiria Scanner mobile app.
// (The web app uses Auth0 cookie sessions via getSafeSession; the scanner is a
// native app and instead presents an access token in the Authorization header.)

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_SCANNER_AUDIENCE = process.env.AUTH0_SCANNER_AUDIENCE;

// Lazily build the JWKS so a missing env var doesn't crash module load at build.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`),
    );
  }
  return jwks;
}

/**
 * Returns the token's `sub` if the Authorization header carries a valid Auth0
 * access token for the scanner API, otherwise null.
 */
export async function verifyScannerToken(
  req: NextRequest,
): Promise<{ sub: string } | null> {
  if (!AUTH0_DOMAIN || !AUTH0_SCANNER_AUDIENCE) return null;

  const header =
    req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://${AUTH0_DOMAIN}/`,
      audience: AUTH0_SCANNER_AUDIENCE,
    });
    return payload.sub ? { sub: payload.sub } : null;
  } catch {
    return null;
  }
}

/**
 * True if `sub` may check in tickets for an event owned by `organizerId`:
 * either they ARE the organizer (events.organizer_id === Auth0 sub), or their
 * users row (auth0_id = sub) has role 'admin'.
 */
export async function isAuthorizedForEvent(
  sub: string,
  organizerId: string | null | undefined,
): Promise<boolean> {
  if (organizerId && sub === organizerId) return true;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('auth0_id', sub)
    .maybeSingle();
  return data?.role === 'admin';
}
