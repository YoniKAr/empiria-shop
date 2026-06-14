"use client";

import type { SectionDefinition } from "@/lib/seatmap-types";

interface SchematicViewerProps {
  sections: SectionDefinition[];
  /** Sold seat LABELS — tickets store labels, so sold status is keyed by
   *  `seat.label`. The two hold sets stay keyed by config seat ID. */
  soldSeats: Set<string>;
  myHeldSeats: Set<string>;
  otherHeldSeats: Set<string>;
  onSeatClick: (seatId: string, sectionId: string, label: string) => void;
}

export default function SchematicViewer({
  sections,
  soldSeats,
  myHeldSeats,
  otherHeldSeats,
  onSeatClick,
}: SchematicViewerProps) {
  function getSeatStatus(seat: { id: string; label: string }, sectionHidden = false) {
    // Hidden (issue-only) sections read as unavailable ("other") for buyers.
    if (sectionHidden) return "other";
    if (soldSeats.has(seat.label)) return "sold";
    if (myHeldSeats.has(seat.id)) return "mine";
    if (otherHeldSeats.has(seat.id)) return "other";
    return "available";
  }

  const seatStatusStyles: Record<string, string> = {
    available:
      "bg-blue-500 border-blue-600 hover:opacity-80 cursor-pointer",
    mine: "bg-green-500 border-green-600 hover:opacity-80 cursor-pointer",
    other: "bg-gray-400 border-gray-500 cursor-not-allowed",
    sold: "bg-red-500 border-red-600 cursor-not-allowed opacity-50",
  };

  return (
    <div className="space-y-6">
      {sections.map((section) => {
        // Group seats into rows by extracting the letter prefix from labels
        const rowMap = new Map<string, typeof section.seats>();
        for (const seat of section.seats) {
          const rowKey = seat.label.replace(/\d+$/, "") || "?";
          const row = rowMap.get(rowKey) || [];
          row.push(seat);
          rowMap.set(rowKey, row);
        }

        // Sort seats within each row by their numeric suffix
        for (const [key, seats] of rowMap) {
          rowMap.set(
            key,
            seats.sort((a, b) => {
              const numA = parseInt(a.label.replace(/\D/g, "")) || 0;
              const numB = parseInt(b.label.replace(/\D/g, "")) || 0;
              return numA - numB;
            })
          );
        }

        const sortedRows = Array.from(rowMap.entries()).sort((a, b) =>
          a[0].localeCompare(b[0])
        );

        return (
          <div key={section.id} className="border rounded-lg overflow-hidden">
            <div
              className="px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: section.color }}
            >
              {section.name}
            </div>
            <div className="p-4 space-y-2 overflow-x-auto">
              {sortedRows.map(([rowLabel, seats]) => (
                <div key={rowLabel} className="flex items-center gap-1.5">
                  <span className="w-6 text-xs font-bold text-gray-700 text-center shrink-0">
                    {rowLabel}
                  </span>
                  <div className="flex gap-1.5">
                    {seats.map((seat) => {
                      const status = getSeatStatus(seat, section.is_hidden === true);
                      const isClickable =
                        status === "available" || status === "mine";

                      return (
                        <button
                          key={seat.id}
                          type="button"
                          disabled={!isClickable}
                          onClick={() => {
                            if (isClickable) {
                              onSeatClick(seat.id, section.id, seat.label);
                            }
                          }}
                          aria-label={`${seat.label} - ${status === "sold" ? "Sold" : status === "other" ? "Unavailable" : status === "mine" ? "Your selection" : "Available"}`}
                          className={`w-9 h-9 sm:w-7 sm:h-7 rounded-full border-2 flex items-center justify-center transition-all ${seatStatusStyles[status]}`}
                          title={`${seat.label} - ${status === "sold" ? "Sold" : status === "other" ? "Unavailable" : status === "mine" ? "Your selection" : "Available"}`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs px-1">
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-blue-500 border-2 border-blue-600" />
          Available
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-green-500 border-2 border-green-600" />
          Your selection
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-gray-400 border-2 border-gray-500" />
          Unavailable
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-red-500 border-2 border-red-600 opacity-50" />
          Sold
        </div>
      </div>
    </div>
  );
}
