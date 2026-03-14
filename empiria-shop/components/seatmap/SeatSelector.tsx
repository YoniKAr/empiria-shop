"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Loader2, AlertCircle, Clock } from "lucide-react";
import SeatmapViewer from "./SeatmapViewer";
import SchematicViewer from "./SchematicViewer";
import { useSeatHolds } from "./useSeatHolds";
import type { SeatingConfig, SectionDefinition, ZoneTier } from "@/lib/seatmap-types";

interface TicketTier {
  id: string;
  name: string;
  price: number;
  remaining_quantity: number;
  max_per_order: number;
}

interface OccurrenceOption {
  id: string;
  starts_at: string;
  ends_at: string;
  label: string;
}

interface SeatSelectorProps {
  config: SeatingConfig;
  tiers: TicketTier[];
  eventId: string;
  eventCurrency: string;
  currencySymbol: string;
  userEmail?: string;
  userName?: string;
  occurrences?: OccurrenceOption[];
}

interface SelectedSeat {
  seatId: string;
  sectionId: string;
  label: string;
  tierId: string;
  price: number;
  sectionName: string;
  tierName: string;
}

/** Get the zone-tier label, stripping zone prefix from ticket tier name if present */
function getTierLabel(zoneTier: ZoneTier | undefined, ticketTier: TicketTier | undefined): string {
  if (zoneTier?.name) return zoneTier.name;
  if (!ticketTier) return "General";
  if (ticketTier.name.includes(" — ")) {
    return ticketTier.name.split(" — ").slice(1).join(" — ");
  }
  return ticketTier.name;
}

export default function SeatSelector({
  config,
  tiers,
  eventId,
  eventCurrency,
  currencySymbol,
  userEmail,
  userName,
  occurrences = [],
}: SeatSelectorProps) {
  const [sessionId] = useState(() => {
    if (typeof window === "undefined") return "";
    const stored = sessionStorage.getItem(`seat-session-${eventId}`);
    if (stored) return stored;
    const id = crypto.randomUUID();
    sessionStorage.setItem(`seat-session-${eventId}`, id);
    return id;
  });

  const {
    myHeldSeats,
    otherHeldSeats,
    holdSeat,
    releaseSeat,
    holds,
    loading: holdsLoading,
  } = useSeatHolds({ eventId, sessionId });

  const [selectedSeats, setSelectedSeats] = useState<SelectedSeat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string>(
    occurrences.length === 1 ? occurrences[0].id : ""
  );
  const [guestEmail, setGuestEmail] = useState("");
  const [guestName, setGuestName] = useState("");
  // Pending seat waiting for tier selection (multi-tier zones)
  const [pendingSeat, setPendingSeat] = useState<{
    seatId: string;
    sectionId: string;
    label: string;
  } | null>(null);

  const tierMap = new Map(tiers.map((t) => [t.id, t]));
  const sections = config.sections || [];

  // Build lookup: sectionId (= zoneId) → zone tiers
  const sectionZoneTiers = useMemo(() => {
    const map = new Map<string, { zoneTier: ZoneTier; ticketTier: TicketTier }[]>();
    if (config.zones) {
      for (const zone of config.zones) {
        const tierEntries: { zoneTier: ZoneTier; ticketTier: TicketTier }[] = [];
        if (zone.tiers && zone.tiers.length > 0) {
          for (const zt of zone.tiers) {
            const tt = tierMap.get(zt.id);
            if (tt) tierEntries.push({ zoneTier: zt, ticketTier: tt });
          }
        } else {
          // Legacy: single tier via tier_id
          const tt = tierMap.get(zone.tier_id);
          if (tt) {
            tierEntries.push({
              zoneTier: { id: zone.tier_id, name: zone.name, price: tt.price, initial_quantity: tt.remaining_quantity, max_per_order: tt.max_per_order || 10, description: "", currency: "" },
              ticketTier: tt,
            });
          }
        }
        map.set(zone.id, tierEntries);
      }
    }
    // Fallback: use sections' tier_id for non-zone configs
    for (const section of sections) {
      if (!map.has(section.id)) {
        const tt = tierMap.get(section.tier_id);
        if (tt) {
          map.set(section.id, [{
            zoneTier: { id: section.tier_id, name: section.name, price: tt.price, initial_quantity: tt.remaining_quantity, max_per_order: tt.max_per_order || 10, description: "", currency: "" },
            ticketTier: tt,
          }]);
        }
      }
    }
    return map;
  }, [config.zones, sections, tierMap]);

  // Compute sold seats
  const soldSeats = useMemo(() => new Set<string>(), []);

  // Hold expiry timer
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (myHeldSeats.size === 0) {
      setTimeLeft(null);
      return;
    }

    const myHolds = holds.filter((h) => h.session_id === sessionId);
    if (myHolds.length === 0) {
      setTimeLeft(null);
      return;
    }

    const earliestExpiry = Math.min(
      ...myHolds.map((h) => new Date(h.expires_at).getTime())
    );

    const tick = () => {
      const remaining = Math.max(
        0,
        Math.floor((earliestExpiry - Date.now()) / 1000)
      );
      setTimeLeft(remaining);

      if (remaining <= 0) {
        setSelectedSeats([]);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [myHeldSeats, holds, sessionId]);

  async function handleSeatClick(
    seatId: string,
    sectionId: string,
    label: string
  ) {
    setError(null);

    // If already held by me, release it
    if (myHeldSeats.has(seatId)) {
      await releaseSeat(seatId);
      setSelectedSeats((prev) => prev.filter((s) => s.seatId !== seatId));
      setPendingSeat(null);
      return;
    }

    // Hold the seat
    const result = await holdSeat(seatId);
    if (!result.success) {
      setError(result.error || "Failed to hold seat");
      return;
    }

    const zoneTiers = sectionZoneTiers.get(sectionId) || [];

    if (zoneTiers.length > 1) {
      // Multi-tier zone: show tier picker
      setPendingSeat({ seatId, sectionId, label });
    } else if (zoneTiers.length === 1) {
      // Single tier: add directly
      const { zoneTier, ticketTier } = zoneTiers[0];
      const section = sections.find((s) => s.id === sectionId);
      setSelectedSeats((prev) => [
        ...prev,
        {
          seatId,
          sectionId,
          label,
          tierId: ticketTier.id,
          price: ticketTier.price,
          sectionName: section?.name || "",
          tierName: getTierLabel(zoneTier, ticketTier),
        },
      ]);
    }
  }

  function handlePickTier(tierId: string) {
    if (!pendingSeat) return;
    const { seatId, sectionId, label } = pendingSeat;
    const zoneTiers = sectionZoneTiers.get(sectionId) || [];
    const match = zoneTiers.find((zt) => zt.ticketTier.id === tierId);
    if (!match) return;

    const section = sections.find((s) => s.id === sectionId);
    setSelectedSeats((prev) => [
      ...prev,
      {
        seatId,
        sectionId,
        label,
        tierId: match.ticketTier.id,
        price: match.ticketTier.price,
        sectionName: section?.name || "",
        tierName: getTierLabel(match.zoneTier, match.ticketTier),
      },
    ]);
    setPendingSeat(null);
  }

  async function handleCancelPending() {
    if (pendingSeat) {
      await releaseSeat(pendingSeat.seatId);
      setPendingSeat(null);
    }
  }

  async function handleRemoveSeat(seatId: string) {
    await releaseSeat(seatId);
    setSelectedSeats((prev) => prev.filter((s) => s.seatId !== seatId));
  }

  const totalPrice = selectedSeats.reduce((sum, s) => sum + s.price, 0);

  async function handleCheckout() {
    if (selectedSeats.length === 0) {
      setError("Please select at least one seat");
      return;
    }

    if (occurrences.length > 1 && !selectedOccurrenceId) {
      setError("Please select an event date");
      return;
    }

    const email = userEmail || guestEmail;
    if (!email) {
      setError("Please enter your email address");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Group seats by tier for line items
      const tierQuantities = new Map<string, number>();
      for (const seat of selectedSeats) {
        tierQuantities.set(
          seat.tierId,
          (tierQuantities.get(seat.tierId) || 0) + 1
        );
      }

      const tierSelections = Array.from(tierQuantities.entries()).map(
        ([tierId, quantity]) => ({ tierId, quantity })
      );

      const seatSelections = selectedSeats.map((s) => ({
        seatId: s.seatId,
        sectionId: s.sectionId,
        label: s.label,
      }));

      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          tiers: tierSelections,
          contactEmail: email,
          contactName: userName || guestName,
          occurrenceId:
            selectedOccurrenceId ||
            (occurrences.length === 1 ? occurrences[0].id : undefined),
          seatSelections,
          sessionId,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to create checkout session");
      }

      window.location.href = data.url;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      setLoading(false);
    }
  }

  const isSchematicMode = config.view_mode === "schematic";

  return (
    <div className="space-y-4">
      <div className="border border-gray-200 rounded-xl shadow-lg bg-white overflow-hidden">
        <div className="p-4 border-b bg-gray-50">
          <h3 className="font-bold text-lg">Select Your Seats</h3>
          <p className="text-sm text-gray-500">
            Click on available seats to reserve them
          </p>
          {timeLeft !== null && timeLeft > 0 && (
            <div className="flex items-center gap-1.5 mt-2 text-sm text-orange-600 font-medium">
              <Clock size={14} />
              Seats held for {Math.floor(timeLeft / 60)}:
              {String(timeLeft % 60).padStart(2, "0")}
            </div>
          )}
        </div>

        <div className="p-4">
          {holdsLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 size={24} className="animate-spin mr-2" />
              Loading seat availability...
            </div>
          ) : isSchematicMode ? (
            <SchematicViewer
              sections={sections}
              soldSeats={soldSeats}
              myHeldSeats={myHeldSeats}
              otherHeldSeats={otherHeldSeats}
              onSeatClick={handleSeatClick}
            />
          ) : (
            <SeatmapViewer
              config={config}
              mode="seat"
              soldSeats={soldSeats}
              myHeldSeats={myHeldSeats}
              otherHeldSeats={otherHeldSeats}
              onSeatClick={handleSeatClick}
            />
          )}
        </div>

        {/* Legend for image overlay mode */}
        {!isSchematicMode && (
          <div className="px-4 pb-3">
            <div className="flex flex-wrap gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-green-400 border border-green-600" />
                Available
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-blue-400 border border-blue-600" />
                Your selection
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-yellow-300 border border-yellow-500" />
                Reserved
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-gray-300 border border-gray-400" />
                Sold
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Ticket panel */}
      <div className="border border-gray-200 rounded-xl shadow-lg p-6 sticky top-24 bg-white">
        <h3 className="font-bold text-xl mb-1">Your Seats</h3>

        {/* Occurrence picker */}
        {occurrences.length > 1 && (
          <div className="mb-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Select a Date
            </p>
            <div className="space-y-2">
              {occurrences.map((occ) => {
                const occDate = new Date(occ.starts_at);
                const isSelected = selectedOccurrenceId === occ.id;
                return (
                  <button
                    key={occ.id}
                    type="button"
                    onClick={() => {
                      setSelectedOccurrenceId(occ.id);
                      setError(null);
                    }}
                    className={`w-full text-left p-3 border rounded-lg transition-colors ${
                      isSelected
                        ? "border-orange-300 bg-orange-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="font-medium text-sm">
                      {occDate.toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                      {" at "}
                      {occDate.toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </div>
                    {occ.label && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        {occ.label}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Tier picker for pending seat (multi-tier zone) */}
        {pendingSeat && (
          <div className="mb-4 p-4 border-2 border-orange-300 bg-orange-50 rounded-xl">
            <p className="text-sm font-semibold text-gray-900 mb-1">
              Seat {pendingSeat.label}
            </p>
            <p className="text-xs text-gray-500 mb-3">
              Choose a ticket type for this seat:
            </p>
            <div className="space-y-2">
              {(sectionZoneTiers.get(pendingSeat.sectionId) || []).map(
                ({ zoneTier, ticketTier }) => {
                  const isSoldOut = ticketTier.remaining_quantity === 0;
                  const tierLabel = getTierLabel(zoneTier, ticketTier);
                  return (
                    <button
                      key={ticketTier.id}
                      type="button"
                      disabled={isSoldOut}
                      onClick={() => handlePickTier(ticketTier.id)}
                      className={`w-full flex items-center justify-between p-3 border rounded-lg text-left transition-colors ${
                        isSoldOut
                          ? "border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed"
                          : "border-gray-200 hover:border-orange-300 hover:bg-orange-50"
                      }`}
                    >
                      <span className="text-sm font-medium">
                        {tierLabel}
                      </span>
                      <span className="text-sm font-bold">
                        {isSoldOut
                          ? "Sold out"
                          : ticketTier.price === 0
                            ? "Free"
                            : `${currencySymbol}${ticketTier.price}`}
                      </span>
                    </button>
                  );
                }
              )}
            </div>
            <button
              type="button"
              onClick={handleCancelPending}
              className="mt-2 w-full text-xs text-gray-500 hover:text-red-500 py-1"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Selected seats list */}
        <div className="space-y-2 mb-5">
          {selectedSeats.length === 0 && !pendingSeat ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              Click on seats in the map to select them
            </p>
          ) : (
            selectedSeats.map((seat) => (
              <div
                key={seat.seatId}
                className="flex items-center justify-between p-3 border border-blue-200 bg-blue-50 rounded-lg"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{seat.label}</div>
                  <div className="text-xs text-gray-500">
                    {seat.sectionName}
                    {seat.tierName && (
                      <span className="ml-1 text-gray-400">
                        &middot; {seat.tierName}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-sm">
                    {seat.price === 0
                      ? "Free"
                      : `${currencySymbol}${seat.price}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveSeat(seat.seatId)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                    title="Remove seat"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Guest contact fields */}
        {!userEmail && selectedSeats.length > 0 && (
          <div className="space-y-3 mb-5 pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Contact Info
            </p>
            <input
              type="text"
              placeholder="Full Name"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
            <input
              type="email"
              placeholder="Email Address"
              value={guestEmail}
              onChange={(e) => {
                setGuestEmail(e.target.value);
                setError(null);
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-400">
              Your tickets will be sent to this email.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 text-red-600 text-sm mb-4 p-3 bg-red-50 rounded-lg">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Order summary */}
        {selectedSeats.length > 0 && (
          <div className="flex items-center justify-between mb-4 text-sm">
            <span className="text-gray-600">
              {selectedSeats.length} seat
              {selectedSeats.length !== 1 ? "s" : ""}
            </span>
            <span className="font-bold text-lg">
              {totalPrice === 0
                ? "Free"
                : `${currencySymbol}${totalPrice.toLocaleString()}`}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={handleCheckout}
          disabled={selectedSeats.length === 0 || loading}
          className="w-full bg-orange-600 text-white text-center py-4 rounded-xl font-bold hover:bg-orange-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Redirecting to payment...
            </>
          ) : selectedSeats.length === 0 ? (
            "Select Seats"
          ) : (
            "Checkout"
          )}
        </button>

        <p className="text-xs text-center text-gray-400 mt-4">
          Secure checkout powered by Stripe
        </p>
      </div>
    </div>
  );
}
