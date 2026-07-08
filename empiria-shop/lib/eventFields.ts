// lib/eventFields.ts
export type CustomFieldType = "text" | "dropdown";

export interface CustomField {
  id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  options?: string[]; // present/non-empty only when type === "dropdown"
}

export interface FieldResponse {
  field_id: string;
  label: string;
  value: string;
}

export type EventVisibility = "public" | "private";
export type EntryType = "ticketed" | "external";
export type CtaLabel = "buy_tickets" | "register" | "rsvp" | "learn_more";

export const CTA_LABELS: Record<CtaLabel, string> = {
  buy_tickets: "Buy Tickets",
  register: "Register",
  rsvp: "RSVP",
  learn_more: "Learn More",
};

// Email/UX noun for the chosen CTA.
export const CTA_NOUN: Record<CtaLabel, { plural: string; confirmation: string; section: string }> = {
  buy_tickets: { plural: "tickets", confirmation: "Here are your tickets and order details.", section: "Your Tickets" },
  register:    { plural: "registration", confirmation: "Here's your registration confirmation.", section: "Your Registration" },
  rsvp:        { plural: "RSVP", confirmation: "Here's your RSVP confirmation.", section: "Your RSVP" },
  learn_more:  { plural: "tickets", confirmation: "Here are your tickets and order details.", section: "Your Tickets" },
};

export function ctaButtonText(label: string | null | undefined): string {
  return CTA_LABELS[(label as CtaLabel) ?? "buy_tickets"] ?? CTA_LABELS.buy_tickets;
}

// URL-safe crypto slug for private events (21 chars, ~125 bits).
export function generatePrivateSlug(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";
  const bytes = new Uint8Array(21);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b & 63];
  return out;
}

// http/https validation reused for external_url (mirrors meeting_link XSS guard).
export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Validate a custom_fields array (used in wizard + server actions).
export function validateCustomFields(fields: CustomField[]): string | null {
  for (const f of fields) {
    if (!f.label?.trim()) return "Every custom field needs a label.";
    if (f.type === "dropdown") {
      const opts = (f.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (opts.length < 1) return `Dropdown field "${f.label}" needs at least one option.`;
    }
  }
  return null;
}

// --- Sponsor sections ---
export type SponsorTier = "primary" | "secondary" | "tertiary";

export interface Sponsor {
  id: string;
  logo_url: string;
  name?: string;
  link_url?: string;
}

export interface SponsorSection {
  id: string;
  title?: string;
  tier: SponsorTier;
  sponsors: Sponsor[];
}

// Logo box height per tier (px) — the section "thickness".
export const SPONSOR_TIER_HEIGHT: Record<SponsorTier, number> = {
  primary: 320,
  secondary: 192,
  tertiary: 128,
};

export function validateSponsorSections(sections: SponsorSection[]): string | null {
  for (const s of sections) {
    for (const sp of s.sponsors) {
      if (!sp.logo_url) return "Every sponsor needs a logo.";
      if (sp.link_url && !isSafeUrl(sp.link_url)) return `Sponsor link "${sp.link_url}" must be a valid http(s) URL.`;
    }
  }
  return null;
}
