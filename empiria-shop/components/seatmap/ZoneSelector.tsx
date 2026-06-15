"use client";

import { useState } from "react";
import { Minus, Plus, Loader2, AlertCircle } from "lucide-react";
import SeatmapViewer from "./SeatmapViewer";
import StripeBadge from "@/components/StripeBadge";
import { CheckoutTerms } from "@/components/CheckoutTerms";
import { BlockedBuyerNotice } from "@/components/BlockedBuyerNotice";
import MobileActionBar from "./MobileActionBar";
import type { SeatingConfig, ZoneDefinition, ZoneTier } from "@/lib/seatmap-types";
import { migrateSeatingConfig } from "@/lib/migrate-seating-config";
import { computeCouponDiscount, type CouponApplication } from "@/lib/fees";
import { formatEventDateTime, DEFAULT_TZ } from "@/lib/datetime";

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
  blockedBuyer?: boolean;
  /** Event's IANA timezone — occurrence dates display in this zone with label. */
  timezone?: string;
  /** Deep-linked occurrence (?occ=<id>) — pre-selects the date picked on the
   *  event page; the dropdown stays usable so users can still change it. */
  initialOccurrenceId?: string;
}

interface TierSelection {
  tierId: string;
  tierName: string;
  zoneId: string;
  zoneName: string;
  zoneColor: string;
  quantity: number;
  unitPrice: number;
}

/** Get the ticket tier IDs that belong to a zone */
function getZoneTierIds(zone: ZoneDefinition): string[] {
  if (zone.tiers && zone.tiers.length > 0) {
    return zone.tiers.map((t) => t.id);
  }
  // Legacy single-tier zone
  return [zone.tier_id];
}

/** Get zone-tier display name (strip zone prefix if present) */
function getZoneTierLabel(zoneTier: ZoneTier | undefined, ticketTier: TicketTier, zoneName: string): string {
  if (zoneTier?.name) return zoneTier.name;
  // Ticket tier name might be "Zone — Adult", strip the zone prefix
  if (ticketTier.name.includes(" — ")) {
    return ticketTier.name.split(" — ").slice(1).join(" — ");
  }
  return ticketTier.name;
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
  blockedBuyer = false,
  timezone,
  initialOccurrenceId,
}: ZoneSelectorProps) {
  const tz = timezone || DEFAULT_TZ;
  const migratedConfig = migrateSeatingConfig(config);

  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selections, setSelections] = useState<TierSelection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [showBuyBlock, setShowBuyBlock] = useState(false);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string>(() => {
    if (initialOccurrenceId && occurrences.some((o) => String(o.id) === initialOccurrenceId)) {
      return initialOccurrenceId;
    }
    return occurrences.length === 1 ? occurrences[0].id : "";
  });
  const [guestEmail, setGuestEmail] = useState("");
  const [guestFirstName, setGuestFirstName] = useState("");
  const [guestLastName, setGuestLastName] = useState("");
  // Coupon (mirrors the GA CheckoutForm: validate via /api/coupons/validate,
  // then pass couponCode to /api/checkout which re-validates server-side).
  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState<{
    couponId: string;
    discountType: string;
    discountValue: number;
    maxDiscountCap: number | null;
    applicationMode: CouponApplication;
  } | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);

  const tierMap = new Map(tiers.map((t) => [t.id, t]));
  const zones = migratedConfig.zones || [];

  // Configs saved before tier-id remapping shipped can carry designer-generated
  // ids that don't match ticket_tiers rows — fall back to the tier NAME the
  // wizard derives from the zone ("Zone" or "Zone — Tier"), returning REAL ids.
  const tierByName = new Map(tiers.map((t) => [t.name.trim().toLowerCase(), t]));
  function resolveZoneTierIds(zone: ZoneDefinition): string[] {
    const candidates = getZoneTierIds(zone);
    const multi = (zone.tiers?.length || 0) > 1;
    const resolved: string[] = [];
    for (const tid of candidates) {
      if (tierMap.has(tid)) {
        resolved.push(tid);
        continue;
      }
      const zt = zone.tiers?.find((z) => z.id === tid);
      const derivedName = zt && multi ? `${zone.name} — ${zt.name}` : zone.name;
      const byName = tierByName.get(derivedName.trim().toLowerCase());
      if (byName) resolved.push(byName.id);
    }
    return resolved;
  }

  // Build zone-level availability: zone.id → total remaining across all zone tiers
  const zoneAvailability: Record<string, number> = {};
  for (const zone of zones) {
    const tierIds = resolveZoneTierIds(zone);
    let total = 0;
    for (const tid of tierIds) {
      const t = tierMap.get(tid);
      if (t) total += t.remaining_quantity;
    }
    zoneAvailability[zone.id] = total;
  }

  function handleZoneClick(zoneId: string) {
    // Hidden (issue-only) zones aren't selectable by buyers.
    if (zones.find((z) => z.id === zoneId)?.is_hidden) return;
    setSelectedZoneId(zoneId);
    setError(null);
  }

  function addTierSelection(tierId: string, zone: ZoneDefinition) {
    const existing = selections.find((s) => s.tierId === tierId);
    if (existing) return; // already added

    const tier = tierMap.get(tierId);
    if (!tier) return;

    const zoneTier = zone.tiers?.find((zt) => zt.id === tierId);
    const tierLabel = getZoneTierLabel(zoneTier, tier, zone.name);

    setSelections((prev) => [
      ...prev,
      {
        tierId,
        tierName: tierLabel,
        zoneId: zone.id,
        zoneName: zone.name,
        zoneColor: zone.color,
        quantity: 1,
        unitPrice: tier.price,
      },
    ]);
  }

  function updateQuantity(tierId: string, delta: number) {
    setSelections((prev) =>
      prev.map((s) => {
        if (s.tierId !== tierId) return s;
        const tier = tierMap.get(s.tierId);
        if (!tier) return s;
        const next = Math.max(
          0,
          Math.min(tier.max_per_order, Math.min(tier.remaining_quantity, s.quantity + delta))
        );
        return { ...s, quantity: next };
      })
    );
    setError(null);
  }

  function removeSelection(tierId: string) {
    setSelections((prev) => prev.filter((s) => s.tierId !== tierId));
  }

  const totalItems = selections.reduce((sum, s) => sum + s.quantity, 0);
  const totalPrice = selections.reduce(
    (sum, s) => sum + s.unitPrice * s.quantity,
    0
  );

  // Coupon discount (per_order vs per_ticket) — shared engine, matches server.
  // Display only; the server re-computes it authoritatively at checkout.
  const discountAmount = couponApplied
    ? computeCouponDiscount({
        discountType: couponApplied.discountType,
        discountValue: couponApplied.discountValue,
        maxDiscountCap: couponApplied.maxDiscountCap,
        applicationMode: couponApplied.applicationMode,
        lineItems: selections.map((s) => ({ unitPrice: s.unitPrice, quantity: s.quantity })),
      })
    : 0;
  const discountedTotal = Math.max(0, totalPrice - discountAmount);

  async function handleApplyCoupon() {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    setCouponError(null);
    try {
      const res = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponCode.trim(), eventId }),
      });
      const data = await res.json();
      if (!data.valid) {
        setCouponError(data.error || "Invalid coupon code");
        setCouponApplied(null);
        return;
      }
      setCouponApplied({
        couponId: data.couponId,
        discountType: data.discountType,
        discountValue: data.discountValue,
        maxDiscountCap: data.maxDiscountCap,
        applicationMode: data.applicationMode === 'per_ticket' ? 'per_ticket' : 'per_order',
      });
      setCouponError(null);
    } catch {
      setCouponError("Failed to validate coupon");
    } finally {
      setCouponLoading(false);
    }
  }

  async function handleCheckout() {
    if (blockedBuyer) {
      setShowBuyBlock(true);
      setShake(true);
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(60);
      setTimeout(() => setShake(false), 450);
      return;
    }

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
      const tierSelections = activeSelections.map((s) => ({
        tierId: s.tierId,
        quantity: s.quantity,
      }));

      // Per-attempt idempotency key: a fresh uuid per submit CLICK. The server
      // passes it to Stripe (sessions.create idempotencyKey) so a duplicated /
      // retried request can never create two Checkout Sessions.
      const attemptId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          tiers: tierSelections,
          contactEmail: email,
          contactName: userName || `${guestFirstName} ${guestLastName}`.trim(),
          occurrenceId:
            selectedOccurrenceId ||
            (occurrences.length === 1 ? occurrences[0].id : undefined),
          couponCode: couponApplied ? couponCode.trim() : undefined,
          attemptId,
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

  // Get tiers available for the selected zone
  const selectedZoneTiers: { zoneTier: ZoneTier | undefined; ticketTier: TicketTier }[] = [];
  if (selectedZone) {
    const tierIds = resolveZoneTierIds(selectedZone);
    for (const tid of tierIds) {
      const tt = tierMap.get(tid);
      if (tt) {
        const zt = selectedZone.tiers?.find((z) => z.id === tid);
        selectedZoneTiers.push({ zoneTier: zt, ticketTier: tt });
      }
    }
  }

  // Price range for zone legend
  function getZonePriceLabel(zone: ZoneDefinition): string {
    const tierIds = resolveZoneTierIds(zone);
    const prices = tierIds
      .map((tid) => tierMap.get(tid)?.price)
      .filter((p): p is number => p !== undefined);
    if (prices.length === 0) return "";
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === max) {
      return min === 0 ? "Free" : `${currencySymbol}${min}`;
    }
    return `${currencySymbol}${min}–${currencySymbol}${max}`;
  }

  return (
    <div className="space-y-4 pb-28 lg:pb-0">
      <div className="border border-gray-200 rounded-xl shadow-lg bg-white overflow-hidden">
        <div className="p-4 border-b bg-gray-50">
          <h3 className="font-bold text-lg">Select Your Zone</h3>
          <p className="text-sm text-gray-700">
            Click on a zone to see pricing and availability
          </p>
        </div>

        {/* Seatmap canvas */}
        <div className="p-4">
          <SeatmapViewer
            config={migratedConfig}
            mode="zone"
            availability={zoneAvailability}
            onZoneClick={handleZoneClick}
            selectedZoneId={selectedZoneId}
          />
        </div>

        {/* Zone legend */}
        <div className="px-4 pb-3">
          <div className="flex flex-wrap gap-3 text-xs">
            {zones.map((zone) => {
              const isHidden = zone.is_hidden === true;
              const isSoldOut = zoneAvailability[zone.id] === 0;
              const unavailable = isHidden || isSoldOut;
              return (
                <button
                  key={zone.id}
                  type="button"
                  disabled={unavailable}
                  onClick={() => handleZoneClick(zone.id)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
                    unavailable
                      ? "cursor-not-allowed"
                      : selectedZoneId === zone.id
                      ? "bg-gray-100 ring-1 ring-gray-300"
                      : "hover:bg-gray-50"
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{
                      backgroundColor: unavailable ? "#9ca3af" : zone.color,
                    }}
                  />
                  <span className={unavailable ? "text-gray-700 line-through" : "text-gray-900"}>
                    {zone.name}
                  </span>
                  <span className="text-gray-700">
                    {isHidden ? "Unavailable" : isSoldOut ? "Sold out" : getZonePriceLabel(zone)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Side panel: selected zone tiers + quantity + checkout */}
      <div className="border border-gray-200 rounded-xl shadow-lg p-6 sticky top-24 bg-white">
        <h3 className="font-bold text-xl mb-1">Get Tickets</h3>

        {/* Occurrence picker */}
        {occurrences.length > 1 && (
          <div className="mb-5">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Select a Date
            </p>
            <div className="space-y-2">
              {occurrences.map((occ) => {
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
                      {formatEventDateTime(occ.starts_at, tz, { withYear: false, withTime: false })}
                      {" at "}
                      {formatEventDateTime(occ.starts_at, tz, { withWeekday: false, withYear: false })}
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

        {/* Selected zone: tier picker */}
        {selectedZone && selectedZoneTiers.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: selectedZone.color }}
              />
              <span className="font-semibold text-sm">{selectedZone.name}</span>
            </div>
            <div className="space-y-2">
              {selectedZoneTiers.map(({ zoneTier, ticketTier }) => {
                const isSoldOut = ticketTier.remaining_quantity === 0;
                const isAdded = selections.some((s) => s.tierId === ticketTier.id);
                const tierLabel = getZoneTierLabel(zoneTier, ticketTier, selectedZone.name);

                return (
                  <div
                    key={ticketTier.id}
                    className={`p-3 border rounded-lg transition-colors ${
                      isAdded
                        ? "border-orange-300 bg-orange-50"
                        : isSoldOut
                          ? "border-gray-100 bg-gray-50"
                          : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className={`text-sm font-medium ${isSoldOut ? "text-gray-700" : "text-gray-900"}`}>
                          {tierLabel}
                        </span>
                        {ticketTier.description && (
                          <p className="text-xs text-gray-700 mt-0.5">{ticketTier.description}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <span className={`text-sm font-bold ${isSoldOut ? "text-gray-700" : "text-gray-900"}`}>
                          {ticketTier.price === 0 ? "Free" : `${currencySymbol}${ticketTier.price}`}
                        </span>
                        <p className="text-[10px] text-gray-700">
                          {isSoldOut ? "Sold out" : `${ticketTier.remaining_quantity} left`}
                        </p>
                      </div>
                    </div>
                    {!isSoldOut && !isAdded && (
                      <button
                        type="button"
                        onClick={() => addTierSelection(ticketTier.id, selectedZone)}
                        className="mt-2 w-full text-xs font-medium py-1.5 rounded-md border border-orange-300 text-orange-600 hover:bg-orange-50 transition-colors"
                      >
                        + Add to cart
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Cart: tier quantity selections */}
        <div className="space-y-3 mb-5">
          {selections.length === 0 ? (
            <p className="text-sm text-gray-700 py-4 text-center">
              Click on a zone in the map to add tickets
            </p>
          ) : (
            <>
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                Your Tickets
              </p>
              {selections.map((sel) => {
                const tier = tierMap.get(sel.tierId);
                if (!tier) return null;

                return (
                  <div
                    key={sel.tierId}
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
                          style={{ backgroundColor: sel.zoneColor }}
                        />
                        <div className="min-w-0">
                          <span className="font-semibold text-sm truncate block">
                            {sel.tierName}
                          </span>
                          <span className="text-[10px] text-gray-700">
                            {sel.zoneName}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm">
                          {tier.price === 0
                            ? "Free"
                            : `${currencySymbol}${tier.price}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeSelection(sel.tierId)}
                          className="text-gray-700 hover:text-red-500 text-xs"
                          title="Remove"
                        >
                          &times;
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => updateQuantity(sel.tierId, -1)}
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
                        onClick={() => updateQuantity(sel.tierId, 1)}
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
              })}
            </>
          )}
        </div>

        {/* Guest contact fields */}
        {!userEmail && totalItems > 0 && (
          <div className="space-y-3 mb-5 pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
              Contact Info
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="First Name"
                value={guestFirstName}
                onChange={(e) => setGuestFirstName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
              <input
                type="text"
                placeholder="Last Name"
                value={guestLastName}
                onChange={(e) => setGuestLastName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>
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
            <p className="text-xs text-gray-700">
              Your tickets will be sent to this email.
            </p>
          </div>
        )}

        {/* Coupon */}
        {totalItems > 0 && (
          <div className="mb-4 pt-4 border-t border-gray-100">
            {couponApplied ? (
              <div className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2.5 text-sm">
                <span className="font-medium text-green-700">
                  Coupon &ldquo;{couponCode.trim().toUpperCase()}&rdquo; applied
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCouponApplied(null);
                    setCouponCode("");
                    setCouponError(null);
                  }}
                  className="text-xs font-semibold text-green-700 hover:underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Coupon code"
                  value={couponCode}
                  onChange={(e) => {
                    setCouponCode(e.target.value);
                    setCouponError(null);
                  }}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={handleApplyCoupon}
                  disabled={!couponCode.trim() || couponLoading}
                  className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-600"
                >
                  {couponLoading ? "..." : "Apply"}
                </button>
              </div>
            )}
            {couponError && <p className="mt-1.5 text-xs text-red-600">{couponError}</p>}
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
          <div className="mb-4 space-y-1.5 text-sm">
            <div className="flex items-center justify-between text-gray-600">
              <span>
                {totalItems} ticket{totalItems !== 1 ? "s" : ""}
              </span>
              <span>
                {totalPrice === 0 ? "Free" : `${currencySymbol}${totalPrice.toLocaleString()}`}
              </span>
            </div>
            {discountAmount > 0 && (
              <div className="flex items-center justify-between text-green-700">
                <span>Discount</span>
                <span>
                  &minus;{currencySymbol}
                  {discountAmount.toLocaleString()}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between pt-1 font-bold text-lg text-gray-900">
              <span>Total</span>
              <span>
                {discountedTotal === 0 ? "Free" : `${currencySymbol}${discountedTotal.toLocaleString()}`}
              </span>
            </div>
            <p className="text-[11px] text-gray-500">Taxes &amp; fees calculated at checkout.</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleCheckout}
          disabled={totalItems === 0 || loading}
          className={`w-full bg-orange-600 text-white text-center py-4 rounded-xl font-bold hover:bg-orange-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${shake ? "animate-shake" : ""}`}
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

        {showBuyBlock && <BlockedBuyerNotice className="mt-2" />}

        <CheckoutTerms className="mt-3" />
        <StripeBadge className="mt-4" />
      </div>

      {/* Mobile-only sticky checkout bar — mirrors the panel button above. */}
      <MobileActionBar
        count={totalItems}
        totalLabel={
          totalItems === 0
            ? "Select tickets"
            : totalPrice === 0
              ? "Free"
              : `${currencySymbol}${totalPrice.toLocaleString()}`
        }
        buttonLabel={totalItems === 0 ? "Select" : "Checkout"}
        disabled={totalItems === 0 || loading}
        loading={loading}
        shake={shake}
        buttonClassName="bg-orange-600 hover:bg-orange-700"
        onAction={handleCheckout}
      />
    </div>
  );
}
