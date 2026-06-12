"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { X, Loader2, AlertCircle, Clock, Minus, Plus } from "lucide-react";
import SeatmapViewer from "./SeatmapViewer";
import SchematicViewer from "./SchematicViewer";
import { useSeatHolds } from "./useSeatHolds";
import { computeSeatQuantityCap } from "@/lib/seat-quantity";
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
  blockedBuyer?: boolean;
  /** Deep-linked seat count (e.g. ?qty=2). If valid (1..max), the quantity
   *  step is skipped and the map opens locked to that count. */
  initialQuantity?: number;
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
  blockedBuyer = false,
  initialQuantity,
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
  // Serializes seat clicks — canvas events can double-fire (see SeatmapViewer).
  const clickBusyRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [showBuyBlock, setShowBuyBlock] = useState(false);
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

  // ── Quantity-gated selection ────────────────────────────────────────────
  // Customer first picks HOW MANY seats, then the map enforces exactly N.
  const maxQuantity = useMemo(() => computeSeatQuantityCap(tiers), [tiers]);
  const hasValidInitialQuantity =
    initialQuantity !== undefined &&
    Number.isInteger(initialQuantity) &&
    initialQuantity >= 1 &&
    initialQuantity <= maxQuantity;
  const [requiredQuantity, setRequiredQuantity] = useState<number>(
    hasValidInitialQuantity ? (initialQuantity as number) : 1
  );
  const [phase, setPhase] = useState<"quantity" | "map">(
    hasValidInitialQuantity ? "map" : "quantity"
  );

  /** Seats counted toward the cap: confirmed selections + the tier-pending one. */
  const selectedCount = selectedSeats.length + (pendingSeat ? 1 : 0);

  /** Change N. If reduced below current selections, release the excess
   *  (most recent first — the pending seat is the most recent of all). */
  async function applyQuantityChange(nextQty: number) {
    const clamped = Math.max(1, Math.min(maxQuantity, nextQty));
    let excess = selectedCount - clamped;
    if (excess > 0) {
      if (pendingSeat) {
        await releaseSeat(pendingSeat.seatId);
        setPendingSeat(null);
        excess--;
      }
      if (excess > 0) {
        const toRelease = selectedSeats.slice(selectedSeats.length - excess);
        for (const seat of [...toRelease].reverse()) {
          await releaseSeat(seat.seatId);
        }
        const releasedIds = new Set(toRelease.map((s) => s.seatId));
        setSelectedSeats((prev) => prev.filter((s) => !releasedIds.has(s.seatId)));
      }
    }
    setRequiredQuantity(clamped);
    setError(null);
  }

  const tierMap = new Map(tiers.map((t) => [t.id, t]));
  // Configs saved before tier-id remapping shipped can carry designer-generated
  // ids that don't match ticket_tiers rows — fall back to the tier NAME the
  // wizard derives from the zone ("Zone" or "Zone — Tier").
  const tierByName = new Map(tiers.map((t) => [t.name.trim().toLowerCase(), t]));
  const resolveTier = (tid: string | undefined, ...names: (string | undefined)[]): TicketTier | undefined => {
    const byId = tid ? tierMap.get(tid) : undefined;
    if (byId) return byId;
    for (const n of names) {
      const t = n ? tierByName.get(n.trim().toLowerCase()) : undefined;
      if (t) return t;
    }
    return undefined;
  };
  const sections = config.sections || [];

  // Build lookup: sectionId (= zoneId) → zone tiers
  const sectionZoneTiers = useMemo(() => {
    const map = new Map<string, { zoneTier: ZoneTier; ticketTier: TicketTier }[]>();
    if (config.zones) {
      for (const zone of config.zones) {
        const tierEntries: { zoneTier: ZoneTier; ticketTier: TicketTier }[] = [];
        if (zone.tiers && zone.tiers.length > 0) {
          const multi = zone.tiers.length > 1;
          for (const zt of zone.tiers) {
            const tt = resolveTier(zt.id, multi ? `${zone.name} — ${zt.name}` : zone.name);
            if (tt) tierEntries.push({ zoneTier: zt, ticketTier: tt });
          }
        } else {
          // Legacy: single tier via tier_id
          const tt = resolveTier(zone.tier_id, zone.name);
          if (tt) {
            tierEntries.push({
              zoneTier: { id: tt.id, name: zone.name, price: tt.price, initial_quantity: tt.remaining_quantity, max_per_order: tt.max_per_order || 10, description: "", currency: "" },
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
        const tt = resolveTier(section.tier_id, section.name);
        if (tt) {
          map.set(section.id, [{
            zoneTier: { id: tt.id, name: section.name, price: tt.price, initial_quantity: tt.remaining_quantity, max_per_order: tt.max_per_order || 10, description: "", currency: "" },
            ticketTier: tt,
          }]);
        }
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.zones, sections, tiers]);

  // Compute sold seats — fetched from DB on mount
  const [soldSeats, setSoldSeats] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function fetchSoldSeats() {
      try {
        const res = await fetch(`/api/sold-seats?eventId=${encodeURIComponent(eventId)}`);
        const data = await res.json();
        if (data.seatLabels && Array.isArray(data.seatLabels)) {
          setSoldSeats(new Set(data.seatLabels));
        }
      } catch (err) {
        console.error("Failed to fetch sold seats:", err);
      }
    }
    fetchSoldSeats();
  }, [eventId]);

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
        setPendingSeat(null);
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
    // Re-entrancy guard: canvas events can double-fire; while one click is
    // mid-flight (awaiting hold/release), ignore further clicks entirely.
    if (clickBusyRef.current) return;
    clickBusyRef.current = true;
    try {
      setError(null);

      // If already held by me, release it (deselect)
      if (myHeldSeats.has(seatId)) {
        await releaseSeat(seatId);
        setSelectedSeats((prev) => prev.filter((s) => s.seatId !== seatId));
        if (pendingSeat?.seatId === seatId) setPendingSeat(null);
        return;
      }

      // A tier-pending seat is the most recent pick; clicking any other seat
      // replaces it — release its hold so it never lingers.
      if (pendingSeat) {
        await releaseSeat(pendingSeat.seatId);
        setPendingSeat(null);
      } else if (selectedSeats.length >= requiredQuantity) {
        // Already at N: release the most recently selected seat's hold and
        // drop it from the selection, making room for the new seat.
        const lastSeat = selectedSeats[selectedSeats.length - 1];
        await releaseSeat(lastSeat.seatId);
        setSelectedSeats((prev) => prev.filter((s) => s.seatId !== lastSeat.seatId));
      }

      const zoneTiers = sectionZoneTiers.get(sectionId) || [];
      if (zoneTiers.length === 0) {
        // No purchasable tier maps to this section — never hold a seat the
        // customer can't see/buy (it would block them invisibly for 10 min).
        setError("This seat can't be purchased right now — its ticket tier is unavailable.");
        return;
      }

      // Hold the seat
      const result = await holdSeat(seatId);
      if (!result.success) {
        setError(result.error || "Failed to hold seat");
        return;
      }

      if (zoneTiers.length > 1) {
        // Multi-tier zone: show tier picker
        setPendingSeat({ seatId, sectionId, label });
      } else {
        // Single tier: add directly (dedupe — never two entries for one seat)
        const { zoneTier, ticketTier } = zoneTiers[0];
        const section = sections.find((s) => s.id === sectionId);
        setSelectedSeats((prev) =>
          prev.some((s) => s.seatId === seatId)
            ? prev
            : [
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
              ]
        );
      }
    } finally {
      clickBusyRef.current = false;
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
    if (blockedBuyer) {
      setShowBuyBlock(true);
      setShake(true);
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(60);
      setTimeout(() => setShake(false), 450);
      return;
    }

    if (selectedSeats.length !== requiredQuantity) {
      setError(
        `Please select exactly ${requiredQuantity} seat${requiredQuantity !== 1 ? "s" : ""}`
      );
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
  const remainingToPick = requiredQuantity - selectedSeats.length;

  // ── Phase 1: pick how many seats ──────────────────────────────────────
  if (phase === "quantity") {
    return (
      <div className="max-w-md mx-auto border border-gray-200 rounded-xl shadow-lg bg-white p-6">
        <h3 className="font-bold text-xl text-gray-900">How many seats?</h3>
        <p className="text-sm text-gray-700 mt-1">
          You&apos;ll pick exactly this many seats on the map.
        </p>

        <div className="flex items-center justify-center gap-6 my-8">
          <button
            type="button"
            aria-label="Fewer seats"
            onClick={() => applyQuantityChange(requiredQuantity - 1)}
            disabled={requiredQuantity <= 1}
            className="w-12 h-12 rounded-full border border-gray-300 flex items-center justify-center text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Minus size={18} />
          </button>
          <span className="w-20 text-center text-5xl font-bold text-gray-900 tabular-nums">
            {requiredQuantity}
          </span>
          <button
            type="button"
            aria-label="More seats"
            onClick={() => applyQuantityChange(requiredQuantity + 1)}
            disabled={requiredQuantity >= maxQuantity}
            className="w-12 h-12 rounded-full border border-gray-300 flex items-center justify-center text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={18} />
          </button>
        </div>

        <p className="text-xs text-gray-700 text-center">
          Up to {maxQuantity} seat{maxQuantity !== 1 ? "s" : ""} per order
        </p>

        <button
          type="button"
          onClick={() => setPhase("map")}
          className="mt-6 w-full bg-[#F15A29] text-white py-4 rounded-xl font-bold hover:bg-[#d94d1f] transition-colors"
        >
          Continue — pick {requiredQuantity} seat
          {requiredQuantity !== 1 ? "s" : ""} →
        </button>
      </div>
    );
  }

  // ── Phase 2: the seat map, locked to exactly N seats ─────────────────
  return (
    <div className="space-y-4">
      {/* Quantity summary */}
      <div className="flex items-center justify-between border border-gray-200 rounded-xl shadow-lg bg-white px-4 py-3">
        <div className="text-sm">
          <span className="font-bold text-gray-900">
            {requiredQuantity} seat{requiredQuantity !== 1 ? "s" : ""}
          </span>
          <span className="ml-2 text-gray-700">
            {selectedSeats.length} of {requiredQuantity} selected
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPhase("quantity")}
          className="text-sm font-semibold text-[#F15A29] hover:underline"
        >
          Change
        </button>
      </div>

      <div className="border border-gray-200 rounded-xl shadow-lg bg-white overflow-hidden">
        <div className="p-4 border-b bg-gray-50">
          <h3 className="font-bold text-lg text-gray-900">Select Your Seats</h3>
          <p className="text-sm text-gray-700">
            Pick {requiredQuantity} seat{requiredQuantity !== 1 ? "s" : ""} on
            the map — clicking a new seat once you have {requiredQuantity} swaps
            out your last pick
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
            <div className="flex items-center justify-center py-12 text-gray-600">
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
            <div className="flex flex-wrap gap-4 text-xs font-medium text-gray-800">
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
        <h3 className="font-bold text-xl mb-1 text-gray-900">Your Seats</h3>

        {/* Occurrence picker */}
        {occurrences.length > 1 && (
          <div className="mb-5">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
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
                      <div className="text-xs text-gray-700 mt-0.5">
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
            <p className="text-xs text-gray-700 mb-3">
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
              className="mt-2 w-full text-xs text-gray-700 hover:text-red-500 py-1"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Selected seats list */}
        <div className="space-y-2 mb-5">
          {selectedSeats.length === 0 && !pendingSeat ? (
            <p className="text-sm text-gray-700 py-4 text-center">
              Select {requiredQuantity} seat
              {requiredQuantity !== 1 ? "s" : ""} on the map
            </p>
          ) : (
            selectedSeats.map((seat) => (
              <div
                key={seat.seatId}
                className="flex items-center justify-between p-3 border border-blue-200 bg-blue-50 rounded-lg"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{seat.label}</div>
                  <div className="text-xs text-gray-700">
                    {seat.sectionName}
                    {seat.tierName && (
                      <span className="ml-1 text-gray-600">
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
                    className="text-gray-600 hover:text-red-500 transition-colors"
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
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
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
            <p className="text-xs text-gray-600">
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
          disabled={
            selectedSeats.length !== requiredQuantity ||
            !!pendingSeat ||
            loading
          }
          className={`w-full bg-[#F15A29] text-white text-center py-4 rounded-xl font-bold hover:bg-[#d94d1f] transition-colors disabled:bg-gray-300 disabled:text-gray-700 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${shake ? "animate-shake" : ""}`}
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Redirecting to payment...
            </>
          ) : remainingToPick > 0 ? (
            `Select ${remainingToPick} more seat${remainingToPick !== 1 ? "s" : ""}`
          ) : (
            "Checkout"
          )}
        </button>

        {showBuyBlock && (
          <p className="mt-2 text-center text-xs font-medium text-red-600">
            Must be an attendee to buy
          </p>
        )}

        <p className="text-xs text-center text-gray-600 mt-4">
          Secure checkout powered by Stripe
        </p>
      </div>
    </div>
  );
}
