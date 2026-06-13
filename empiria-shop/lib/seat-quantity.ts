/**
 * Max seats a customer may pick in one order for a seat_map event.
 *
 * = min(total remaining capacity across tiers, per-order cap), where the
 * per-order cap is the tiers' max_per_order when it is uniform across all
 * tiers, otherwise a sane default of 10. Never below 1.
 *
 * Plain module (no "use client") so both server components (event page CTA)
 * and client components (SeatSelector) can share it.
 */
export interface QuantityCapTier {
  remaining_quantity: number;
  max_per_order: number;
}

export function computeSeatQuantityCap(tiers: QuantityCapTier[]): number {
  const totalRemaining = tiers.reduce(
    (sum, t) => sum + Math.max(0, t.remaining_quantity ?? 0),
    0
  );
  const caps = tiers
    .map((t) => t.max_per_order)
    .filter((c): c is number => typeof c === "number" && c > 0);
  const uniform = caps.length > 0 && caps.every((c) => c === caps[0]);
  const orderCap = uniform ? caps[0] : 10;
  return Math.max(1, Math.min(totalRemaining || 1, orderCap));
}
