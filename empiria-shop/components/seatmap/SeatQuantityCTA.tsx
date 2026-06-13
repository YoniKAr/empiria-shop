"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import OccurrenceSelect, { type OccurrenceChoice } from "./OccurrenceSelect";

interface SeatQuantityCTAProps {
  eventId: string;
  /** Max seats per order — computed server-side via computeSeatQuantityCap. */
  maxQuantity: number;
  /** Future occurrences — a date dropdown renders above the stepper when > 1. */
  occurrences?: OccurrenceChoice[];
}

/**
 * Quantity stepper + "Select your seats" CTA for seat_map events on the
 * event page. Deep-links to /checkout/[eventId]/seats?qty=N (&occ=<id> for
 * multi-date events) so the seat page skips its quantity step and opens the
 * map locked to N seats with the chosen date pre-selected.
 */
export default function SeatQuantityCTA({ eventId, maxQuantity, occurrences = [] }: SeatQuantityCTAProps) {
  const max = Math.max(1, maxQuantity);
  const [qty, setQty] = useState(1);
  const [occId, setOccId] = useState(occurrences[0]?.id ?? "");

  return (
    <div className="mt-5">
      {occurrences.length > 1 && (
        <OccurrenceSelect
          occurrences={occurrences}
          value={occId}
          onChange={setOccId}
          className="mb-3"
        />
      )}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
        <span className="text-sm font-semibold text-gray-900">Seats</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Fewer seats"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-900 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Minus size={14} />
          </button>
          <span className="w-6 text-center font-bold text-gray-900 tabular-nums">{qty}</span>
          <button
            type="button"
            aria-label="More seats"
            onClick={() => setQty((q) => Math.min(max, q + 1))}
            disabled={qty >= max}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-900 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <a
        href={`/checkout/${eventId}/seats?qty=${qty}${
          occurrences.length > 1 && occId ? `&occ=${encodeURIComponent(occId)}` : ""
        }`}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#F15A29] py-4 font-bold text-white transition-colors hover:bg-[#d94d1f]"
      >
        Select your seats →
      </a>
    </div>
  );
}
