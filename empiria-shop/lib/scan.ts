// Shared helpers for the /api/scan/* ticket routes.

/**
 * Resolve a ticket's seating zone name from the event's seating_config by
 * matching the ticket's tier to a zone (zones carry tier_id + name). Returns
 * null for GA / unseated events or when no zone matches.
 */
export function resolveZone(
  seatingConfig: unknown,
  tierId: unknown,
): string | null {
  if (!seatingConfig || typeof tierId !== 'string') return null;
  const zones = (seatingConfig as { zones?: unknown }).zones;
  if (!Array.isArray(zones)) return null;
  for (const z of zones) {
    const zone = z as {
      tier_id?: string;
      name?: string;
      tiers?: Array<{ id?: string; tier_id?: string }>;
    };
    if (zone.tier_id === tierId) return zone.name ?? null;
    if (
      Array.isArray(zone.tiers) &&
      zone.tiers.some((t) => t?.id === tierId || t?.tier_id === tierId)
    ) {
      return zone.name ?? null;
    }
  }
  return null;
}
