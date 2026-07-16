// Cross-border payout share — shared by the checkout API (the authoritative money
// path) and the checkout page (buyer-facing fee preview) so the customer total
// shown always matches what the server charges.
//
// Stripe bills the platform 0.25% (XBORDER_RATE, see lib/fees.ts) on every
// transfer to a connected account outside Canada. crossBorderShare is the
// fraction of the organizer PAYOUT POOL going to non-Canadian recipients; it
// feeds computeFees. NULL / unknown country is treated as 'CA' (no fee — the
// fail-safe: never over-charge a buyer / over-deduct an organizer on a guess).
// Elevsoft's rev-share account is Canadian and is NOT a payout recipient here,
// so it never enters this math.

import type { getSupabaseAdmin } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

/** A payout recipient (primary organizer or a co-organizer) whose transfer may
 *  incur the cross-border fee. `percentage` is its share of the payout pool
 *  (0..100); recipients with no percentage or no Stripe account are ignored. */
export interface PayoutRecipient {
  stripeAccountId: string | null | undefined;
  /** Cached users.stripe_account_country (nullable → resolved lazily). */
  country: string | null | undefined;
  percentage: number;
}

/**
 * Resolve a connected account's country, self-healing the cache. A cached
 * country is returned as-is. Otherwise the country is fetched from Stripe once
 * and persisted to users.stripe_account_country. Any failure returns null
 * (→ treated as 'CA' by the caller — fail-safe). `cache` dedupes repeat ids
 * within one call.
 */
async function resolveCountry(
  supabase: SupabaseAdmin,
  stripeAccountId: string | null | undefined,
  cachedCountry: string | null | undefined,
  cache: Map<string, string | null>
): Promise<string | null> {
  if (!stripeAccountId) return null;
  if (cachedCountry) return cachedCountry;
  if (cache.has(stripeAccountId)) return cache.get(stripeAccountId)!;
  let country: string | null = null;
  try {
    const account = await stripe.accounts.retrieve(stripeAccountId);
    country = account.country ?? null;
    if (country) {
      await supabase
        .from('users')
        .update({ stripe_account_country: country })
        .eq('stripe_account_id', stripeAccountId);
    }
  } catch (err) {
    console.error('[crossBorder] Failed to resolve Stripe account country (treating as CA):', err);
    country = null; // fail-safe: unknown → CA → no fee
  }
  cache.set(stripeAccountId, country);
  return country;
}

/**
 * crossBorderShare = Σ (percentage of every payable recipient whose resolved
 * country is set and not 'CA') / 100, clamped to [0,1]. Recipients with no
 * Stripe account or a non-positive percentage are skipped. Self-heals the
 * country cache as a side effect. 0 (all-Canadian / unknown) → computeFees is
 * byte-identical to the no-cross-border behavior.
 */
export async function computeCrossBorderShare(
  supabase: SupabaseAdmin,
  recipients: PayoutRecipient[]
): Promise<number> {
  const cache = new Map<string, string | null>();
  let foreignPct = 0;
  for (const r of recipients) {
    if (!r.stripeAccountId || r.percentage <= 0) continue;
    const country = await resolveCountry(supabase, r.stripeAccountId, r.country, cache);
    if (country && country !== 'CA') foreignPct += r.percentage;
  }
  return Math.min(1, Math.max(0, foreignPct / 100));
}
