export type SeatingMode = "general_admission" | "assigned_seating" | "zone_admission" | "zone_map" | "seat_map";
export type ViewMode = "image_overlay" | "schematic";

// Multi-polygon support for zones
export interface ZonePolygon {
  id: string;
  points: [number, number][];
  seats?: SeatDefinition[]; // only for seat_map mode
}

export interface ZoneDefinition {
  id: string;
  tier_id: string;
  name: string;
  color: string;
  polygons: ZonePolygon[]; // multi-polygon support
  tiers?: ZoneTier[]; // multiple pricing tiers per zone
  // Legacy single-tier fields (used when tiers array is empty/absent)
  price?: number;
  initial_quantity?: number;
  max_per_order?: number;
  description?: string;
  currency?: string;
}

// Tiers within a zone (e.g. Adult, Child, VIP for the same physical area)
export interface ZoneTier {
  id: string;
  name: string;
  price: number;
  initial_quantity: number;
  max_per_order: number;
  description: string;
  currency: string;
}

export interface SeatDefinition {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface SectionDefinition {
  id: string;
  tier_id: string;
  name: string;
  color: string;
  points: [number, number][];
  seats: SeatDefinition[];
}

// Seat range for assigned seating (no map)
export interface SeatRange {
  id: string;
  prefix: string;       // "A", "B", "K", "Row 1", etc
  start: number;         // 1
  end: number;           // 19
  tier_id: string;       // which ticket tier this range belongs to
}

export interface SeatingConfig {
  image_url: string | null;
  image_width: number;
  image_height: number;
  view_mode: ViewMode;
  zones?: ZoneDefinition[];
  sections?: SectionDefinition[];
  // For assigned seating (no map):
  seat_ranges?: SeatRange[];
  allow_seat_choice?: boolean;
}

export interface VenueTemplate {
  id: string;
  name: string;
  owner_id: string;
  seating_config: SeatingConfig;
  created_at: string;
  updated_at: string;
}

export interface SeatHold {
  id: string;
  event_id: string;
  seat_id: string;
  session_id: string;
  held_at: string;
  expires_at: string;
}
