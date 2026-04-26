import type { SeatingConfig, SectionDefinition } from "./seatmap-types";

/**
 * Converts old flat ZoneDefinition (with `points`) to new multi-polygon format (with `polygons`).
 * Also builds `sections` from zone polygon seats for individual_seating mode.
 * Applied on read so old data keeps working.
 */
export function migrateSeatingConfig(config: any): SeatingConfig {
  if (config?.zones) {
    config.zones = config.zones.map((z: any) => {
      if (z.points && !z.polygons) {
        return {
          ...z,
          polygons: [{ id: crypto.randomUUID(), points: z.points }],
          points: undefined,
        };
      }
      return z;
    });

    // Build sections from zone polygon seats when sections are missing
    if (!config.sections || config.sections.length === 0) {
      const sections: SectionDefinition[] = [];
      for (const zone of config.zones) {
        for (const poly of zone.polygons) {
          if (poly.seats && poly.seats.length > 0) {
            sections.push({
              id: zone.id,
              tier_id: zone.tier_id || zone.id,
              name: zone.name,
              color: zone.color,
              points: poly.points,
              seats: poly.seats,
            });
          }
        }
      }
      if (sections.length > 0) {
        config.sections = sections;
      }
    }
  }
  return config as SeatingConfig;
}
