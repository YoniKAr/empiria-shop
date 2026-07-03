/**
 * Ticket-sales-start gating.
 *
 * A tier's `ticket_tiers.sales_start_at` (UTC ISO / timestamptz | null) can be in
 * the FUTURE — buyers must NOT be able to reach checkout until sales open. The
 * checkout API is the final backstop, but every buy entry point should gate the
 * CTA up front and tell the buyer WHEN tickets go on sale (in the event's own
 * timezone).
 *
 * `computeSaleState` takes the event's VISIBLE (non-hidden) tiers and returns:
 *   - onSale:      true if AT LEAST ONE tier is purchasable now (sales_start_at
 *                  null OR <= now). If any tier is open, the event is buyable.
 *   - salesStartAt: when NOT onSale, the EARLIEST future sales_start_at among the
 *                  visible tiers (so we can say "Tickets go on sale <date>").
 *                  null when onSale (or when there are no tiers at all).
 */

export interface SaleStateInput {
  /** UTC ISO / timestamptz | null. Only field we need off each visible tier. */
  sales_start_at?: string | null;
}

export interface SaleState {
  onSale: boolean;
  salesStartAt: string | null;
}

export function computeSaleState(
  tiers: SaleStateInput[] | null | undefined,
  now: Date = new Date()
): SaleState {
  const list = tiers ?? [];
  // No tiers → nothing to gate on; treat as on sale (other guards handle empty).
  if (list.length === 0) return { onSale: true, salesStartAt: null };

  let earliestFuture: number | null = null;
  const nowMs = now.getTime();

  for (const tier of list) {
    const raw = tier?.sales_start_at;
    if (!raw) return { onSale: true, salesStartAt: null }; // open now
    const startMs = new Date(raw).getTime();
    if (Number.isNaN(startMs)) return { onSale: true, salesStartAt: null }; // unparseable → don't block
    if (startMs <= nowMs) return { onSale: true, salesStartAt: null }; // already open
    if (earliestFuture === null || startMs < earliestFuture) earliestFuture = startMs;
  }

  return {
    onSale: false,
    salesStartAt: earliestFuture === null ? null : new Date(earliestFuture).toISOString(),
  };
}
