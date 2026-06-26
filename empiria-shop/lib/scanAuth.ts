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

// --- Volunteer code identities ---------------------------------------------
//
// Besides Auth0 staff (organizers/admins), the scanner accepts *volunteers* who
// were given a per-event code by an organizer. They present it in the
// `X-Volunteer-Code` header (they have no Auth0 account). A volunteer identity
// is scoped to exactly the one event the code belongs to.

export const VOLUNTEER_CODE_HEADER = 'x-volunteer-code';

export type ScanIdentity =
  | { kind: 'staff'; sub: string }
  | { kind: 'volunteer'; eventId: string; codeId: string; code: string };

function isExpired(expiresAt: string | null | undefined): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() < Date.now();
}

/** Looks up an active, non-expired volunteer code row by its code value. */
export async function findActiveVolunteerCode(code: string): Promise<{
  id: string;
  event_id: string;
  use_count: number;
} | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('event_volunteer_codes')
    .select('id, event_id, is_active, expires_at, use_count')
    .eq('code', trimmed)
    .maybeSingle();
  if (!data || !data.is_active || isExpired(data.expires_at)) return null;
  return { id: data.id, event_id: data.event_id, use_count: data.use_count ?? 0 };
}

/**
 * Resolves who is making a scan request: an Auth0 staff member (Bearer token)
 * or a volunteer (valid `X-Volunteer-Code` header). Returns null if neither.
 */
export async function resolveScanIdentity(
  req: NextRequest,
): Promise<ScanIdentity | null> {
  const staff = await verifyScannerToken(req);
  if (staff) return { kind: 'staff', sub: staff.sub };

  const code = (req.headers.get(VOLUNTEER_CODE_HEADER) ?? '').trim();
  if (code) {
    const row = await findActiveVolunteerCode(code);
    if (row) {
      return { kind: 'volunteer', eventId: row.event_id, codeId: row.id, code };
    }
  }
  return null;
}

/**
 * True if the resolved identity may scan the given event. Volunteers are scoped
 * to their single event; staff fall back to {@link isAuthorizedForEvent}.
 */
export async function canScanEvent(
  identity: ScanIdentity,
  event: { id: string; organizer_id: string | null | undefined },
): Promise<boolean> {
  if (identity.kind === 'volunteer') return identity.eventId === event.id;
  return isAuthorizedForEvent(identity.sub, event.organizer_id);
}

/** A short, unambiguous shareable code, e.g. `7K2P-9QWE` (no 0/O/1/I). */
export function generateVolunteerCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () =>
    Array.from(
      { length: 4 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join('');
  return `${block()}-${block()}`;
}
