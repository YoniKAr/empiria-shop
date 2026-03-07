"use client";

import { useState, useMemo } from "react";
import { Minus, Plus, Loader2, AlertCircle, Check } from "lucide-react";
import type { SeatRange } from "@/lib/seatmap-types";

interface TicketTier {
  id: string;
  name: string;
  description: string | null;
  price: number;
  remaining_quantity: number;
  max_per_order: number;
  sales_start_at: string | null;
  sales_end_at: string | null;
}

interface OccurrenceOption {
  id: string;
  starts_at: string;
  ends_at: string;
  label: string;
}

interface AssignedSeatPickerProps {
  seatRanges: SeatRange[];
  tiers: TicketTier[];
  eventId: string;
  eventCurrency: string;
  currencySymbol: string;
  userEmail?: string;
  userName?: string;
  occurrences?: OccurrenceOption[];
  allowSeatChoice: boolean;
}

interface TierQuantitySelection {
  tierId: string;
  quantity: number;
}

interface SeatInfo {
  label: string;
  tierId: string;
  tierName: string;
  price: number;
  prefix: string;
}

export default function AssignedSeatPicker({
  seatRanges,
  tiers,
  eventId,
  eventCurrency,
  currencySymbol,
  userEmail,
  userName,
  occurrences = [],
  allowSeatChoice,
}: AssignedSeatPickerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string>(
    occurrences.length === 1 ? occurrences[0].id : ""
  );
  const [guestEmail, setGuestEmail] = useState("");
  const [guestName, setGuestName] = useState("");

  // For auto-assign mode (allow_seat_choice = false)
  const [tierQuantities, setTierQuantities] = useState<TierQuantitySelection[]>(
    []
  );

  // For manual seat choice mode (allow_seat_choice = true)
  const [selectedSeats, setSelectedSeats] = useState<SeatInfo[]>([]);
  const [soldSeatLabels, setSoldSeatLabels] = useState<Set<string>>(new Set());
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [availabilityLoaded, setAvailabilityLoaded] = useState(false);

  const tierMap = new Map(tiers.map((t) => [t.id, t]));

  // Generate all possible seat labels grouped by prefix
  const seatsByPrefix = useMemo(() => {
    const grouped: Map<
      string,
      { seats: SeatInfo[]; tierId: string; tierName: string; price: number }
    > = new Map();

    for (const range of seatRanges) {
      const tier = tierMap.get(range.tier_id);
      if (!tier) continue;

      const existing = grouped.get(range.prefix);
      const seats: SeatInfo[] = existing?.seats || [];

      for (let i = range.start; i <= range.end; i++) {
        seats.push({
          label: `${range.prefix}${i}`,
          tierId: range.tier_id,
          tierName: tier.name,
          price: tier.price,
          prefix: range.prefix,
        });
      }

      if (!existing) {
        grouped.set(range.prefix, {
          seats,
          tierId: range.tier_id,
          tierName: tier.name,
          price: tier.price,
        });
      }
    }

    return grouped;
  }, [seatRanges, tierMap]);

  // Get unique tiers from seat_ranges
  const tiersFromRanges = useMemo(() => {
    const tierIds = new Set(seatRanges.map((r) => r.tier_id));
    return tiers.filter((t) => tierIds.has(t.id));
  }, [seatRanges, tiers]);

  // Load sold seats when in seat choice mode
  async function loadAvailability() {
    if (availabilityLoaded) return;
    setLoadingAvailability(true);
    try {
      const response = await fetch("/api/assign-seats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          tierId: tiersFromRanges[0]?.id || "",
          quantity: 0,
          checkOnly: true,
        }),
      });
      const data = await response.json();
      if (data.soldSeats) {
        setSoldSeatLabels(new Set(data.soldSeats));
      }
      setAvailabilityLoaded(true);
    } catch {
      // Silently fail, seats will show as available
    } finally {
      setLoadingAvailability(false);
    }
  }

  // Load availability on mount for seat choice mode
  if (allowSeatChoice && !availabilityLoaded && !loadingAvailability) {
    loadAvailability();
  }

  // Auto-assign mode: quantity controls
  function updateTierQuantity(tierId: string, delta: number) {
    setTierQuantities((prev) => {
      const existing = prev.find((t) => t.tierId === tierId);
      const tier = tierMap.get(tierId);
      if (!tier) return prev;

      const currentQty = existing?.quantity || 0;
      const nextQty = Math.max(
        0,
        Math.min(tier.max_per_order, Math.min(tier.remaining_quantity, currentQty + delta))
      );

      if (existing) {
        return prev.map((t) =>
          t.tierId === tierId ? { ...t, quantity: nextQty } : t
        );
      }
      return [...prev, { tierId, quantity: nextQty }];
    });
    setError(null);
  }

  // Seat choice mode: toggle seat
  function toggleSeat(seat: SeatInfo) {
    if (soldSeatLabels.has(seat.label)) return;

    const isSelected = selectedSeats.some((s) => s.label === seat.label);
    if (isSelected) {
      setSelectedSeats((prev) => prev.filter((s) => s.label !== seat.label));
    } else {
      // Check max_per_order
      const tier = tierMap.get(seat.tierId);
      if (!tier) return;

      const currentCount = selectedSeats.filter(
        (s) => s.tierId === seat.tierId
      ).length;
      if (currentCount >= tier.max_per_order) {
        setError(`Maximum ${tier.max_per_order} seats per order for ${tier.name}`);
        return;
      }
      if (currentCount >= tier.remaining_quantity) {
        setError(`Only ${tier.remaining_quantity} seats available for ${tier.name}`);
        return;
      }

      setSelectedSeats((prev) => [...prev, seat]);
    }
    setError(null);
  }

  // Compute totals
  const totalItems = allowSeatChoice
    ? selectedSeats.length
    : tierQuantities.reduce((sum, t) => sum + t.quantity, 0);

  const totalPrice = allowSeatChoice
    ? selectedSeats.reduce((sum, s) => sum + s.price, 0)
    : tierQuantities.reduce((sum, t) => {
        const tier = tierMap.get(t.tierId);
        return sum + (tier?.price || 0) * t.quantity;
      }, 0);

  async function handleCheckout() {
    if (totalItems === 0) {
      setError("Please select at least one ticket");
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
      let assignedSeats: { label: string; tierId: string }[] | undefined;
      let tierSelections: { tierId: string; quantity: number }[];

      if (allowSeatChoice) {
        // User-selected seats
        assignedSeats = selectedSeats.map((s) => ({
          label: s.label,
          tierId: s.tierId,
        }));

        // Group by tier for line items
        const tierQuantityMap = new Map<string, number>();
        for (const seat of selectedSeats) {
          tierQuantityMap.set(
            seat.tierId,
            (tierQuantityMap.get(seat.tierId) || 0) + 1
          );
        }
        tierSelections = Array.from(tierQuantityMap.entries()).map(
          ([tierId, quantity]) => ({ tierId, quantity })
        );
      } else {
        // Auto-assign: call assign-seats API for each tier
        const activeSelections = tierQuantities.filter((t) => t.quantity > 0);
        tierSelections = activeSelections.map((t) => ({
          tierId: t.tierId,
          quantity: t.quantity,
        }));

        // Get auto-assigned seats
        const allAssigned: { label: string; tierId: string }[] = [];
        for (const sel of activeSelections) {
          const response = await fetch("/api/assign-seats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventId,
              tierId: sel.tierId,
              quantity: sel.quantity,
            }),
          });

          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error || "Failed to assign seats");
          }

          for (const label of data.seats) {
            allAssigned.push({ label, tierId: sel.tierId });
          }
        }
        assignedSeats = allAssigned;
      }

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
          assignedSeats,
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

  return (
    <div className="space-y-4">
      <div className="border border-gray-200 rounded-xl shadow-lg bg-white overflow-hidden">
        <div className="p-4 border-b bg-gray-50">
          <h3 className="font-bold text-lg">
            {allowSeatChoice ? "Choose Your Seats" : "Get Tickets"}
          </h3>
          <p className="text-sm text-gray-500">
            {allowSeatChoice
              ? "Select your preferred seats from the available options"
              : "Select the number of tickets you want"}
          </p>
        </div>

        <div className="p-4">
          {allowSeatChoice ? (
            /* ───── SEAT CHOICE MODE ───── */
            loadingAvailability ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <Loader2 size={24} className="animate-spin mr-2" />
                Loading seat availability...
              </div>
            ) : (
              <div className="space-y-5">
                {Array.from(seatsByPrefix.entries()).map(
                  ([prefix, { seats, tierName, price }]) => (
                    <div key={prefix}>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-sm text-gray-700">
                          Row {prefix}
                        </h4>
                        <span className="text-xs text-gray-500">
                          {tierName} &middot;{" "}
                          {price === 0
                            ? "Free"
                            : `${currencySymbol}${price}`}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {seats.map((seat) => {
                          const isSold = soldSeatLabels.has(seat.label);
                          const isSelected = selectedSeats.some(
                            (s) => s.label === seat.label
                          );

                          return (
                            <button
                              key={seat.label}
                              type="button"
                              disabled={isSold}
                              onClick={() => toggleSeat(seat)}
                              className={`w-9 h-9 rounded text-xs font-medium transition-colors flex items-center justify-center ${
                                isSold
                                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                                  : isSelected
                                  ? "bg-orange-500 text-white ring-2 ring-orange-300"
                                  : "bg-green-100 text-green-800 hover:bg-green-200 border border-green-300"
                              }`}
                              title={
                                isSold
                                  ? `${seat.label} - Sold`
                                  : isSelected
                                  ? `${seat.label} - Selected`
                                  : `${seat.label} - Available`
                              }
                            >
                              {isSold ? (
                                <span className="text-[10px]">&times;</span>
                              ) : isSelected ? (
                                <Check size={14} />
                              ) : (
                                seat.label.replace(prefix, "")
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )
                )}

                {/* Legend */}
                <div className="flex flex-wrap gap-4 text-xs pt-2 border-t border-gray-100">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-green-100 border border-green-300" />
                    Available
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-orange-500" />
                    Selected
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-gray-200" />
                    Sold
                  </div>
                </div>
              </div>
            )
          ) : (
            /* ───── AUTO-ASSIGN MODE (quantity picker per tier) ───── */
            <div className="space-y-3">
              {tiersFromRanges.map((tier) => {
                const sel = tierQuantities.find((t) => t.tierId === tier.id);
                const quantity = sel?.quantity || 0;

                return (
                  <div
                    key={tier.id}
                    className={`p-4 border rounded-lg transition-colors ${
                      quantity > 0
                        ? "border-orange-300 bg-orange-50"
                        : "border-gray-200"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <div className="min-w-0">
                        <span className="font-semibold text-sm">
                          {tier.name}
                        </span>
                        {tier.description && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {tier.description}
                          </p>
                        )}
                      </div>
                      <span className="font-bold text-sm shrink-0 ml-2">
                        {tier.price === 0
                          ? "Free"
                          : `${currencySymbol}${tier.price}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs text-gray-400">
                        {tier.remaining_quantity} available
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateTierQuantity(tier.id, -1)}
                          disabled={quantity === 0}
                          className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-6 text-center font-medium text-sm tabular-nums">
                          {quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateTierQuantity(tier.id, 1)}
                          disabled={
                            quantity >= tier.max_per_order ||
                            quantity >= tier.remaining_quantity
                          }
                          className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Checkout panel */}
      <div className="border border-gray-200 rounded-xl shadow-lg p-6 sticky top-24 bg-white">
        <h3 className="font-bold text-xl mb-1">
          {allowSeatChoice ? "Your Seats" : "Get Tickets"}
        </h3>

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

        {/* Selected seats summary (seat choice mode) */}
        {allowSeatChoice && selectedSeats.length > 0 && (
          <div className="space-y-2 mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Selected Seats
            </p>
            <div className="flex flex-wrap gap-1.5">
              {selectedSeats.map((seat) => (
                <button
                  key={seat.label}
                  type="button"
                  onClick={() => toggleSeat(seat)}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-medium hover:bg-orange-200 transition-colors"
                >
                  {seat.label}
                  <span className="text-orange-400">&times;</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Guest contact fields */}
        {!userEmail && totalItems > 0 && (
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
        {totalItems > 0 && (
          <div className="flex items-center justify-between mb-4 text-sm">
            <span className="text-gray-600">
              {totalItems} ticket{totalItems !== 1 ? "s" : ""}
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
          disabled={totalItems === 0 || loading}
          className="w-full bg-orange-600 text-white text-center py-4 rounded-xl font-bold hover:bg-orange-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Redirecting to payment...
            </>
          ) : totalItems === 0 ? (
            "Select Tickets"
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
