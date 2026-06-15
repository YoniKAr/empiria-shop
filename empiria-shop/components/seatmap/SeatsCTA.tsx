"use client";

import { useState } from "react";
import OccurrenceSelect, { type OccurrenceChoice } from "./OccurrenceSelect";

interface SeatsCTAProps {
  eventId: string;
  label: string;
  /** Future occurrences — a date dropdown renders above the CTA when > 1. */
  occurrences?: OccurrenceChoice[];
  /** Event's IANA timezone — occurrence labels render in it (with tz label). */
  timezone?: string;
}

/**
 * Event-page CTA for assigned_seating / zone events: optional occurrence
 * picker + link to the seat-selection page. The chosen occurrence travels
 * as ?occ=<id> and pre-selects the date on the next step.
 */
export default function SeatsCTA({ eventId, label, occurrences = [], timezone }: SeatsCTAProps) {
  const [occId, setOccId] = useState(occurrences[0]?.id ?? "");
  const href = `/checkout/${eventId}/seats${
    occurrences.length > 1 && occId ? `?occ=${encodeURIComponent(occId)}` : ""
  }`;

  return (
    <div className="mt-5">
      {occurrences.length > 1 && (
        <OccurrenceSelect
          occurrences={occurrences}
          value={occId}
          onChange={setOccId}
          timezone={timezone}
          className="mb-3"
        />
      )}
      <a
        href={href}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#F15A29] py-4 font-bold text-white transition-colors hover:bg-[#d94d1f]"
      >
        {label} →
      </a>
    </div>
  );
}
