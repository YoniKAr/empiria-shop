import crypto from 'node:crypto';

/**
 * Signing key for receipt share tokens. `RECEIPT_TOKEN_SECRET` is preferred so
 * the receipt link can be rotated independently of the Auth0 session secret;
 * `AUTH0_SECRET` is the fallback (always present in every deployed app).
 */
function receiptSecret(): string {
  const s = process.env.RECEIPT_TOKEN_SECRET || process.env.AUTH0_SECRET;
  if (!s) throw new Error('RECEIPT_TOKEN_SECRET / AUTH0_SECRET is not configured');
  return s;
}

/**
 * Deterministic, unguessable share token for an order's receipt: the HMAC-SHA256
 * of `receipt:${orderId}`. Emailed as `?t=` so a buyer (incl. guests with no
 * session) can open their own receipt without logging in.
 */
export function createReceiptToken(orderId: string): string {
  return crypto.createHmac('sha256', receiptSecret()).update(`receipt:${orderId}`).digest('hex');
}

/** Timing-safe check of a `?t=` token against the expected value for `orderId`. */
export function verifyReceiptToken(orderId: string, token: string | null | undefined): boolean {
  if (!token || typeof token !== 'string') return false;
  let expected: string;
  try {
    expected = createReceiptToken(orderId);
  } catch {
    return false;
  }
  // Hex-decode both sides; a malformed token yields a shorter buffer, and the
  // length guard makes timingSafeEqual (which throws on unequal lengths) safe.
  const provided = Buffer.from(token, 'hex');
  const wanted = Buffer.from(expected, 'hex');
  if (provided.length !== wanted.length || provided.length === 0) return false;
  return crypto.timingSafeEqual(provided, wanted);
}
