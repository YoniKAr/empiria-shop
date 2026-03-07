export type SeatingMode = "general_admission" | "reserved_seating_list" | "seatmap_pro";
export type ViewMode = "image_overlay" | "schematic";

export interface ZoneDefinition {
  id: string;
  tier_id: string;
  name: string;
  color: string;
  points: [number, number][];
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

export interface SeatingConfig {
  image_url: string | null;
  image_width: number;
  image_height: number;
  view_mode: ViewMode;
  zones?: ZoneDefinition[];
  sections?: SectionDefinition[];
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
