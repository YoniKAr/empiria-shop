import type { SeatingConfig } from "./seatmap-types";

/**
 * Converts old flat ZoneDefinition (with `points`) to new multi-polygon format (with `polygons`).
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
  }
  return config as SeatingConfig;
}
