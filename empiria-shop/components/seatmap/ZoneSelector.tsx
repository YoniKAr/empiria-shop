"use client";

import { useState } from "react";
import { Minus, Plus, Loader2, AlertCircle } from "lucide-react";
import SeatmapViewer from "./SeatmapViewer";
import type { SeatingConfig, ZoneDefinition } from "@/lib/seatmap-types";

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

interface ZoneSelectorProps {
  config: SeatingConfig;
  tiers: TicketTier[];
  eventId: string;
  eventCurrency: string;
  currencySymbol: string;
  userEmail?: string;
  userName?: string;
  occurrences?: OccurrenceOption[];
}

interface ZoneSelection {
  zoneId: string;
  tierId: string;
  zoneName: string;
  quantity: number;
  unitPrice: number;
}

export default function ZoneSelector({
  config,
  tiers,
  eventId,
  eventCurrency,
  currencySymbol,
  userEmail,
  userName,
  occurrences = [],
}: ZoneSelectorProps) {
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selections, setSelections] = useState<ZoneSelection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string>(
    occurrences.length === 1 ? occurrences[0].id : ""
  );
  const [guestEmail, setGuestEmail] = useState("");
  const [guestName, setGuestName] = useState("");

  const tierMap = new Map(tiers.map((t) => [t.id, t]));
  const zones = config.zones || [];

  // Build availability map: tier_id -> remaining_quantity
  const availability: Record<string, number> = {};
  for (const tier of tiers) {
    availability[tier.id] = tier.remaining_quantity;
  }

  function handleZoneClick(zoneId: string, tierId: string) {
    setSelectedZoneId(zoneId);
    setError(null);

    // If zone doesn't already have a selection, add one with quantity 0
    const existing = selections.find((s) => s.zoneId === zoneId);
    if (!existing) {
      const zone = zones.find((z) => z.id === zoneId);
      const tier = tierMap.get(tierId);
      if (zone && tier) {
        setSelections((prev) => [
          ...prev,
          {
            zoneId,
            tierId,
            zoneName: zone.name,
            quantity: 0,
            unitPrice: tier.price,
          },
        ]);
      }
    }
  }

  function updateQuantity(zoneId: string, delta: number) {
    setSelections((prev) =>
      prev.map((s) => {
        if (s.zoneId !== zoneId) return s;
        const tier = tierMap.get(s.tierId);
        if (!tier) return s;
        const next = Math.max(0, Math.min(tier.max_per_order, Math.min(tier.remaining_quantity, s.quantity + delta)));
        return { ...s, quantity: next };
      })
    );
    setError(null);
  }

  function removeSelection(zoneId: string) {
    setSelections((prev) => prev.filter((s) => s.zoneId !== zoneId));
    if (selectedZoneId === zoneId) setSelectedZoneId(null);
  }

  const totalItems = selections.reduce((sum, s) => sum + s.quantity, 0);
  const totalPrice = selections.reduce(
    (sum, s) => sum + s.unitPrice * s.quantity,
    0
  );

  async function handleCheckout() {
    const activeSelections = selections.filter((s) => s.quantity > 0);

    if (activeSelections.length === 0) {
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
      // Group by tier for the checkout API
      const tierSelections = activeSelections.map((s) => ({
        tierId: s.tierId,
        quantity: s.quantity,
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

  const selectedZone = zones.find((z) => z.id === selectedZoneId);
  const selectedTier = selectedZone ? tierMap.get(selectedZone.tier_id) : null;

  return (
    <div className="space-y-4">
      <div className="border border-gray-200 rounded-xl shadow-lg bg-white overflow-hidden">
        <div className="p-4 border-b bg-gray-50">
          <h3 className="font-bold text-lg">Select Your Zone</h3>
          <p className="text-sm text-gray-500">
            Click on a zone to see pricing and availability
          </p>
        </div>

        {/* Seatmap canvas */}
        <div className="p-4">
          <SeatmapViewer
            config={config}
            mode="zone"
            availability={availability}
            onZoneClick={handleZoneClick}
            selectedZoneId={selectedZoneId}
          />
        </div>

        {/* Zone legend */}
        <div className="px-4 pb-3">
          <div className="flex flex-wrap gap-3 text-xs">
            {zones.map((zone) => {
              const tier = tierMap.get(zone.tier_id);
              const isSoldOut = tier ? tier.remaining_quantity === 0 : false;
              return (
                <button
                  key={zone.id}
                  type="button"
                  onClick={() => handleZoneClick(zone.id, zone.tier_id)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
                    selectedZoneId === zone.id
                      ? "bg-gray-100 ring-1 ring-gray-300"
                      : "hover:bg-gray-50"
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{
                      backgroundColor: isSoldOut ? "#9ca3af" : zone.color,
                    }}
                  />
                  <span className={isSoldOut ? "text-gray-400 line-through" : "text-gray-700"}>
                    {zone.name}
                  </span>
                  {tier && (
                    <span className="text-gray-400">
                      {isSoldOut
                        ? "Sold out"
                        : `${currencySymbol}${tier.price}`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Side panel: selected zone details + quantity + checkout */}
      <div className="border border-gray-200 rounded-xl shadow-lg p-6 sticky top-24 bg-white">
        <h3 className="font-bold text-xl mb-1">Get Tickets</h3>

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

        {/* Selected zone info */}
        {selectedZone && selectedTier && (
          <div className="mb-4 p-3 border border-orange-200 bg-orange-50 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: selectedZone.color }}
              />
              <span className="font-semibold text-sm">
                {selectedZone.name}
              </span>
            </div>
            <div className="text-sm text-gray-600">
              {currencySymbol}
              {selectedTier.price} per ticket &middot;{" "}
              {selectedTier.remaining_quantity} available
            </div>
          </div>
        )}

        {/* Zone quantity selections */}
        <div className="space-y-3 mb-5">
          {selections.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              Click on a zone in the map to add tickets
            </p>
          ) : (
            selections.map((sel) => {
              const tier = tierMap.get(sel.tierId);
              const zone = zones.find((z) => z.id === sel.zoneId);
              if (!tier || !zone) return null;

              return (
                <div
                  key={sel.zoneId}
                  className={`p-3 border rounded-lg ${
                    sel.quantity > 0
                      ? "border-orange-300 bg-orange-50"
                      : "border-gray-200"
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: zone.color }}
                      />
                      <span className="font-semibold text-sm truncate">
                        {sel.zoneName}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">
                        {tier.price === 0
                          ? "Free"
                          : `${currencySymbol}${tier.price}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeSelection(sel.zoneId)}
                        className="text-gray-400 hover:text-red-500 text-xs"
                        title="Remove"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => updateQuantity(sel.zoneId, -1)}
                      disabled={sel.quantity === 0}
                      className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="w-6 text-center font-medium text-sm tabular-nums">
                      {sel.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(sel.zoneId, 1)}
                      disabled={
                        sel.quantity >= tier.max_per_order ||
                        sel.quantity >= tier.remaining_quantity
                      }
                      className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

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
