"use client";

import { formatEventDateTime, DEFAULT_TZ } from "@/lib/datetime";

export interface OccurrenceChoice {
  id: string;
  starts_at: string;
  label?: string | null;
}

export function formatOccurrence(occ: OccurrenceChoice, timezone?: string): string {
  const tz = timezone || DEFAULT_TZ;
  return `${formatEventDateTime(occ.starts_at, tz)}${occ.label ? ` — ${occ.label}` : ""}`;
}

/**
 * Shared occurrence dropdown for multi-date events — shown ABOVE quantity /
 * ticket selection so buyers pick the date first.
 */
export default function OccurrenceSelect({
  occurrences,
  value,
  onChange,
  className = "",
  timezone,
}: {
  occurrences: OccurrenceChoice[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  timezone?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-700">
        Date &amp; time
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-300 bg-white p-3 text-sm font-medium text-gray-900 outline-none transition focus:border-[#F15A29] focus:ring-2 focus:ring-[#F15A29]/20"
      >
        {occurrences.map((occ) => (
          <option key={occ.id} value={occ.id}>
            {formatOccurrence(occ, timezone)}
          </option>
        ))}
      </select>
    </div>
  );
}
