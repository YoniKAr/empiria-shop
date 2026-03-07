"use client";

import type { SectionDefinition } from "@/lib/seatmap-types";

interface SchematicViewerProps {
  sections: SectionDefinition[];
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
  function getSeatStatus(seatId: string) {
    if (soldSeats.has(seatId)) return "sold";
    if (myHeldSeats.has(seatId)) return "mine";
    if (otherHeldSeats.has(seatId)) return "other";
    return "available";
  }

  const seatStatusStyles: Record<string, string> = {
    available:
      "bg-green-100 border-green-500 hover:bg-green-200 cursor-pointer",
    mine: "bg-blue-200 border-blue-500 hover:bg-blue-300 cursor-pointer",
    other: "bg-yellow-100 border-yellow-400 cursor-not-allowed",
    sold: "bg-gray-200 border-gray-400 cursor-not-allowed opacity-50",
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
                  <span className="w-6 text-xs font-bold text-gray-500 text-center shrink-0">
                    {rowLabel}
                  </span>
                  <div className="flex gap-1.5">
                    {seats.map((seat) => {
                      const status = getSeatStatus(seat.id);
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
                          className={`w-7 h-7 rounded-full border-2 text-[10px] font-medium flex items-center justify-center transition-all ${seatStatusStyles[status]}`}
                          title={`${seat.label} - ${status === "sold" ? "Sold" : status === "other" ? "Reserved" : status === "mine" ? "Your selection" : "Available"}`}
                        >
                          {seat.label.replace(/^[A-Z]+/, "")}
                        </button>
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
          <span className="w-4 h-4 rounded-full bg-green-100 border-2 border-green-500" />
          Available
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-blue-200 border-2 border-blue-500" />
          Your selection
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-yellow-100 border-2 border-yellow-400" />
          Reserved
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-gray-200 border-2 border-gray-400 opacity-50" />
          Sold
        </div>
      </div>
    </div>
  );
}
