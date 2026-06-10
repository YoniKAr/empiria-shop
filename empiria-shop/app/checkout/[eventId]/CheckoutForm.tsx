"use client";

import { useState } from "react";
import { ShieldCheck, Minus, Plus, Loader2 } from "lucide-react";
import type { CustomField } from "@/lib/eventFields";
import { computeFees } from "@/lib/fees";

interface Tier {
  id: string;
  name: string;
  description: string | null;
  price: number;
  remaining_quantity: number;
  min_per_order: number | null;
  max_per_order: number | null;
  currency: string;
}

interface Occurrence {
  id: string;
  starts_at: string;
  ends_at: string | null;
  label: string | null;
}

interface CheckoutFormProps {
  eventId: string;
  eventTitle: string;
  tiers: Tier[];
  occurrences: Occurrence[];
  currency: string;
  passProcessingFee: boolean;
  chargeTicketTax: boolean;
  feePercent: number;
  feeFixedPerTicket: number;
  customFields: CustomField[];
  user: {
    email?: string;
    given_name?: string;
    family_name?: string;
    sub?: string;
    name?: string;
  } | null;
  sharedCapacity?: boolean;
  sharedRemaining?: number;
}

export function CheckoutForm({
  eventId,
  eventTitle,
  tiers,
  occurrences,
  currency,
  passProcessingFee,
  chargeTicketTax,
  feePercent,
  feeFixedPerTicket,
  customFields,
  user,
  sharedCapacity = false,
  sharedRemaining = 0,
}: CheckoutFormProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    // In shared mode the event pool is the constraint; a tier is "available"
    // only when the shared pool has room.
    if (sharedCapacity && sharedRemaining <= 0) return {};
    // Default: 1 of the first available tier
    const first = tiers.find((t) => (sharedCapacity ? sharedRemaining > 0 : t.remaining_quantity > 0));
    return first ? { [first.id]: 1 } : {};
  });
  const [email, setEmail] = useState(user?.email ?? "");
  const [firstName, setFirstName] = useState(user?.given_name ?? "");
  const [lastName, setLastName] = useState(user?.family_name ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState<{
    couponId: string;
    discountType: string;
    discountValue: number;
    maxDiscountCap: number | null;
  } | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);

  // Per-ticket custom field answers, keyed `${tierId}:${index}` → { fieldId: value }.
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>({});
  const setAnswer = (ticketKey: string, fieldId: string, value: string) => {
    setAnswers((prev) => ({
      ...prev,
      [ticketKey]: { ...(prev[ticketKey] ?? {}), [fieldId]: value },
    }));
  };

  const selectedOccurrence = occurrences[0];

  const totalItems = Object.values(quantities).reduce((s, q) => s + q, 0);
  const subtotal = tiers.reduce(
    (s, t) => s + t.price * (quantities[t.id] ?? 0),
    0
  );
  // The fixed per-ticket fee only applies to PAID tickets — free tickets (price 0)
  // incur no fee, even on events that mix free and paid tiers.
  const paidItems = tiers.reduce(
    (s, t) => s + (t.price > 0 ? (quantities[t.id] ?? 0) : 0),
    0
  );

  // Coupon discount calculation
  let discountAmount = 0;
  if (couponApplied && subtotal > 0) {
    if (couponApplied.discountType === 'percentage') {
      discountAmount = Math.min(
        subtotal * (couponApplied.discountValue / 100),
        couponApplied.maxDiscountCap || Infinity
      );
    } else {
      discountAmount = subtotal >= couponApplied.discountValue ? couponApplied.discountValue : 0;
    }
    discountAmount = Math.round(discountAmount * 100) / 100;
  }

  const fees = computeFees({
    base: subtotal,
    discount: discountAmount,
    paidTickets: paidItems,
    chargeTicketTax,
    passProcessingFee,
    feePercent,
    feeFixedPerTicket,
  });
  const customerTotal = fees.customerTotal;

  const formatPrice = (amount: number) => {
    if (amount === 0) return "FREE";
    const sym = currency === "inr" ? "₹" : currency === "cad" ? "CA$" : "$";
    return `${sym}${amount.toLocaleString()}`;
  };

  const setQty = (tierId: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [tierId]: Math.max(0, qty) }));
  };

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    setCouponError(null);
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode.trim(), eventId }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setCouponError(data.error || 'Invalid coupon code');
        return;
      }
      setCouponApplied({
        couponId: data.couponId,
        discountType: data.discountType,
        discountValue: data.discountValue,
        maxDiscountCap: data.maxDiscountCap,
      });
    } catch {
      setCouponError('Failed to validate coupon');
    } finally {
      setCouponLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (totalItems === 0) {
      setError("Please select at least one ticket.");
      return;
    }
    if (!email) {
      setError("Email address is required.");
      return;
    }

    const tierSelections = tiers
      .filter((t) => (quantities[t.id] ?? 0) > 0)
      .map((t) => ({ tierId: t.id, quantity: quantities[t.id] }));

    // Validate per-ticket required custom fields before submitting.
    if (customFields.length > 0) {
      for (const sel of tierSelections) {
        for (let i = 0; i < sel.quantity; i++) {
          const a = answers[`${sel.tierId}:${i}`] ?? {};
          for (const f of customFields) {
            if (f.required && !String(a[f.id] ?? "").trim()) {
              setError(`Please answer all required questions ("${f.label}") for every attendee.`);
              return;
            }
          }
        }
      }
    }

    setLoading(true);
    setError(null);

    try {
      const fieldResponses = tierSelections.map((sel) => ({
        tierId: sel.tierId,
        perTicket: Array.from({ length: sel.quantity }).map((_, i) => {
          const a = answers[`${sel.tierId}:${i}`] ?? {};
          return customFields.map((f) => ({ field_id: f.id, label: f.label, value: a[f.id] ?? "" }));
        }),
      }));

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          tiers: tierSelections,
          contactEmail: email,
          contactName: `${firstName} ${lastName}`.trim() || undefined,
          occurrenceId: selectedOccurrence?.id,
          couponCode: couponApplied ? couponCode.trim() : undefined,
          fieldResponses,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Checkout failed. Please try again.");
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-testid="checkout-form"
      className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start"
    >
      {/* LEFT COLUMN */}
      <div className="space-y-6">
      {/* Tier selection */}
      <div className="bg-white p-6 rounded-xl shadow-sm">
        <h2 className="text-lg font-bold mb-4">Select Tickets</h2>
        <div className="space-y-3" data-testid="checkout-tiers">
          {tiers.map((tier) => {
            const qty = quantities[tier.id] ?? 0;
            const soldOut = sharedCapacity
              ? sharedRemaining <= 0
              : tier.remaining_quantity === 0;

            return (
              <div
                key={tier.id}
                data-testid={`checkout-tier-${tier.id}`}
                className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
                  qty > 0
                    ? "border-[#F15A29] bg-orange-50"
                    : soldOut
                      ? "border-gray-200 opacity-50"
                      : "border-gray-200"
                }`}
              >
                <div className="flex-1 min-w-0 mr-4">
                  <p className="font-semibold text-gray-900 text-sm">
                    {tier.name}
                  </p>
                  {tier.description && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {tier.description}
                    </p>
                  )}
                  <p className="text-sm font-bold text-[#F15A29] mt-1">
                    {formatPrice(tier.price)}
                  </p>
                </div>

                {soldOut ? (
                  <span className="text-xs text-red-500 font-medium">
                    Sold Out
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQty(tier.id, qty <= (tier.min_per_order ?? 1) ? 0 : qty - 1)}
                      disabled={qty === 0}
                      className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-gray-700 hover:bg-orange-100 transition-colors disabled:opacity-30"
                      data-testid={`checkout-tier-decrease-${tier.id}`}
                      aria-label={`Decrease ${tier.name} quantity`}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span
                      className="text-sm font-bold w-6 text-center"
                      data-testid={`checkout-tier-qty-${tier.id}`}
                    >
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        // In shared mode the tier pool isn't the real constraint —
                        // cap the running total across all tiers at sharedRemaining.
                        const tierCap = sharedCapacity
                          ? sharedRemaining - (totalItems - qty)
                          : tier.remaining_quantity;
                        const maxAllowed = tier.max_per_order
                          ? Math.min(tierCap, tier.max_per_order)
                          : tierCap;
                        // Jump straight to the minimum when going from 0.
                        const target = qty === 0 ? (tier.min_per_order ?? 1) : qty + 1;
                        setQty(tier.id, Math.min(maxAllowed, target));
                      }}
                      disabled={
                        qty >=
                        (() => {
                          const tierCap = sharedCapacity
                            ? sharedRemaining - (totalItems - qty)
                            : tier.remaining_quantity;
                          return tier.max_per_order ? Math.min(tierCap, tier.max_per_order) : tierCap;
                        })()
                      }
                      className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-gray-700 hover:bg-orange-100 transition-colors disabled:opacity-30"
                      data-testid={`checkout-tier-increase-${tier.id}`}
                      aria-label={`Increase ${tier.name} quantity`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Coupon Code */}
      <div className="bg-white p-6 rounded-xl shadow-sm">
        <h3 className="font-bold text-sm mb-3">Promo Code</h3>
        {couponApplied ? (
          <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
            <div>
              <span className="text-green-700 font-semibold text-sm">{couponCode.toUpperCase()}</span>
              <span className="text-green-600 text-sm ml-2">
                {couponApplied.discountType === 'percentage'
                  ? `${couponApplied.discountValue}% off`
                  : `${formatPrice(couponApplied.discountValue)} off`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => { setCouponApplied(null); setCouponCode(''); setCouponError(null); }}
              className="text-gray-400 hover:text-gray-600 text-sm font-medium"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={couponCode}
              onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponError(null); }}
              placeholder="Enter promo code"
              className="flex-1 border p-3 rounded-lg text-sm uppercase"
            />
            <button
              type="button"
              onClick={handleApplyCoupon}
              disabled={couponLoading || !couponCode.trim()}
              className="px-5 py-3 bg-black text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {couponLoading ? 'Checking...' : 'Apply'}
            </button>
          </div>
        )}
        {couponError && (
          <p className="text-red-500 text-sm mt-2">{couponError}</p>
        )}
      </div>

      {/* Per-ticket custom fields */}
      {customFields.length > 0 && totalItems > 0 && (
        <div className="bg-white p-6 rounded-xl shadow-sm" data-testid="checkout-custom-fields">
          <h3 className="font-bold border-b pb-2 mb-4">Attendee Details</h3>
          <div className="space-y-6">
            {tiers
              .filter((t) => (quantities[t.id] ?? 0) > 0)
              .flatMap((tier) =>
                Array.from({ length: quantities[tier.id] ?? 0 }).map((_, i) => {
                  const ticketKey = `${tier.id}:${i}`;
                  return (
                    <div
                      key={ticketKey}
                      className="border border-gray-200 rounded-xl p-4"
                      data-testid={`checkout-attendee-${ticketKey}`}
                    >
                      <p className="font-semibold text-sm text-gray-900 mb-3">
                        {tier.name} — Attendee {i + 1}
                      </p>
                      <div className="space-y-3">
                        {customFields.map((field) => {
                          const value = answers[ticketKey]?.[field.id] ?? "";
                          return (
                            <div key={field.id}>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                {field.label}
                                {field.required && <span className="text-red-500"> *</span>}
                              </label>
                              {field.type === "dropdown" ? (
                                <select
                                  className="w-full border p-3 rounded-lg text-sm bg-white"
                                  value={value}
                                  onChange={(e) => setAnswer(ticketKey, field.id, e.target.value)}
                                  data-testid={`checkout-field-${ticketKey}-${field.id}`}
                                >
                                  <option value="">Select…</option>
                                  {(field.options ?? []).map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  className="w-full border p-3 rounded-lg text-sm"
                                  value={value}
                                  onChange={(e) => setAnswer(ticketKey, field.id, e.target.value)}
                                  data-testid={`checkout-field-${ticketKey}-${field.id}`}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
          </div>
        </div>
      )}

      {/* Contact Form */}
      <div className="bg-white p-6 rounded-xl shadow-sm">
        <h3 className="font-bold border-b pb-2 mb-4">Contact Information</h3>

        {!user && (
          <div className="bg-blue-50 text-blue-800 p-4 rounded-lg mb-4 text-sm flex justify-between items-center">
            <span>Already have an account?</span>
            <a href="/auth/login" className="font-bold hover:underline">
              Sign In
            </a>
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                First Name
              </label>
              <input
                type="text"
                className="w-full border p-3 rounded-lg"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First Name"
                data-testid="checkout-first-name"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                Last Name
              </label>
              <input
                type="text"
                className="w-full border p-3 rounded-lg"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last Name"
                data-testid="checkout-last-name"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
              Email Address
            </label>
            <input
              type="email"
              className="w-full border p-3 rounded-lg"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              data-testid="checkout-email"
            />
            <p className="text-xs text-gray-400 mt-1">
              Your tickets will be sent here.
            </p>
          </div>
        </div>

        {error && (
          <div
            className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm"
            data-testid="checkout-error"
          >
            {error}
          </div>
        )}
      </div>
      </div>

      {/* RIGHT COLUMN — Order Summary */}
      <div className="lg:sticky lg:top-6 self-start">
        <div className="bg-white p-6 rounded-xl shadow-sm">
          <h2
            className="text-xl font-bold mb-1"
            data-testid="checkout-event-title"
          >
            {eventTitle}
          </h2>
          {selectedOccurrence && (
            <p className="text-sm text-gray-500">
              {new Date(selectedOccurrence.starts_at).toLocaleDateString(
                "en-US",
                {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }
              )}{" "}
              &middot;{" "}
              {new Date(selectedOccurrence.starts_at).toLocaleTimeString(
                "en-US",
                { hour: "numeric", minute: "2-digit", hour12: true }
              )}
            </p>
          )}

          {/* Totals breakdown */}
          {totalItems > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200 space-y-1.5">
              <div className="flex justify-between text-sm text-gray-600">
                <span>{totalItems} ticket{totalItems > 1 ? "s" : ""}</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Promo ({couponCode})</span>
                  <span>-{formatPrice(discountAmount)}</span>
                </div>
              )}
              {fees.customerTax > 0 && (
                <div className="flex justify-between text-sm text-gray-600" data-testid="checkout-ticket-tax">
                  <span>Tax (HST 13%)</span>
                  <span>{formatPrice(fees.customerTax)}</span>
                </div>
              )}
              {passProcessingFee && fees.platformFee > 0 && (
                <div className="flex justify-between text-sm text-gray-600" data-testid="checkout-convenience-fee">
                  <span className="inline-flex items-center gap-1">Service fee
                    <span title="Covers the Empiria platform service." className="text-gray-400 cursor-help">&#9432;</span>
                  </span>
                  <span>{formatPrice(fees.platformFee)}</span>
                </div>
              )}
              {passProcessingFee && fees.stripeOffset > 0 && (
                <div className="flex justify-between text-sm text-gray-600" data-testid="checkout-processing-fee">
                  <span className="inline-flex items-center gap-1">Processing fee
                    <span title="Secure card processing." className="text-gray-400 cursor-help">&#9432;</span>
                  </span>
                  <span>{formatPrice(fees.stripeOffset)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg pt-2 border-t border-gray-100" data-testid="checkout-total">
                <span>Total</span>
                <span>{formatPrice(customerTotal)}</span>
              </div>
            </div>
          )}

          <div className="pt-4">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || totalItems === 0}
              className="w-full bg-black text-white py-4 rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              data-testid="checkout-submit"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Redirecting to payment…
                </>
              ) : (
                "Continue to Payment"
              )}
            </button>
          </div>

          <div className="flex items-center justify-center gap-2 mt-4">
            <ShieldCheck className="w-3.5 h-3.5 text-gray-400" />
            <p className="text-xs text-gray-400">
              Secure checkout powered by Stripe
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
