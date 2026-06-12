"use client";

import { useState } from "react";
import {
  Minus,
  Plus,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Calendar,
  Mail,
  Ticket,
  Lock,
  CheckCircle2,
  CreditCard,
  Wallet,
  QrCode,
  Tag,
  Users,
} from "lucide-react";
import type { CustomField } from "@/lib/eventFields";
import { computeFees } from "@/lib/fees";
import { getCurrencySymbol } from "@/lib/utils";
import StripeBadge from "@/components/StripeBadge";

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
  /** Pre-selected occurrence (?occ=<id>, validated server-side). */
  initialOccurrenceId?: string;
  /** Pre-selected quantities carried from the event page (?tiers=…, validated + clamped server-side). */
  initialQuantities?: Record<string, number>;
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
  initialOccurrenceId,
  initialQuantities,
}: CheckoutFormProps) {
  const [step, setStep] = useState<"select" | "review">("select");
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    // Selection carried over from the event page (already validated + clamped
    // server-side) wins — this is what makes the event-page picks stick.
    if (initialQuantities && Object.keys(initialQuantities).length > 0) {
      return initialQuantities;
    }
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

  // Multi-occurrence events: the buyer picks WHICH date they're buying for
  // (selector renders above ticket selection). Single-occurrence events keep
  // the old behavior — the lone occurrence is used automatically.
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string>(
    () => initialOccurrenceId ?? occurrences[0]?.id ?? ""
  );
  const selectedOccurrence =
    occurrences.find((o) => o.id === selectedOccurrenceId) ?? occurrences[0];

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

  const currencySymbol = getCurrencySymbol(currency);
  const formatPrice = (amount: number) => {
    if (amount === 0) return "FREE";
    return `${currencySymbol}${amount.toLocaleString(undefined, {
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const setQty = (tierId: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [tierId]: Math.max(0, qty) }));
  };

  // Tickets selected, expanded per attendee — drives the review breakdown.
  const selectedTiers = tiers.filter((t) => (quantities[t.id] ?? 0) > 0);
  const fullName = `${firstName} ${lastName}`.trim();

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

  // Shared validation gate used before advancing to review AND before submitting.
  const validate = (): boolean => {
    if (totalItems === 0) {
      setError("Please select at least one ticket.");
      return false;
    }
    if (!email) {
      setError("Email address is required.");
      return false;
    }
    if (customFields.length > 0) {
      const tierSelections = selectedTiers.map((t) => ({ tierId: t.id, quantity: quantities[t.id]! }));
      for (const sel of tierSelections) {
        for (let i = 0; i < sel.quantity; i++) {
          const a = answers[`${sel.tierId}:${i}`] ?? {};
          for (const f of customFields) {
            if (f.required && !String(a[f.id] ?? "").trim()) {
              setError(`Please answer all required questions ("${f.label}") for every attendee.`);
              return false;
            }
          }
        }
      }
    }
    setError(null);
    return true;
  };

  const goToReview = () => {
    if (!validate()) {
      // Surface the error on the selection screen.
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setStep("review");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    const tierSelections = selectedTiers.map((t) => ({ tierId: t.id, quantity: quantities[t.id]! }));

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
          contactName: fullName || undefined,
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

  const occurrenceDate = selectedOccurrence
    ? new Date(selectedOccurrence.starts_at)
    : null;

  // Shared receipt line items — identical math in the sidebar and the review page.
  const ReceiptLines = ({ dense = false }: { dense?: boolean }) => (
    <div className={dense ? "space-y-1.5" : "space-y-2.5"}>
      <div className="flex justify-between text-sm text-gray-600 tabular-nums">
        <span>
          {totalItems} ticket{totalItems > 1 ? "s" : ""}
        </span>
        <span>{formatPrice(subtotal)}</span>
      </div>
      {discountAmount > 0 && (
        <div className="flex justify-between text-sm text-green-600 tabular-nums">
          <span>Promo ({couponCode})</span>
          <span>-{formatPrice(discountAmount)}</span>
        </div>
      )}
      {fees.customerTax > 0 && (
        <div
          className="flex justify-between text-sm text-gray-600 tabular-nums"
          data-testid="checkout-ticket-tax"
        >
          <span>Tax (HST 13%)</span>
          <span>{formatPrice(fees.customerTax)}</span>
        </div>
      )}
      {passProcessingFee && fees.platformFee > 0 && (
        <div
          className="flex justify-between text-sm text-gray-600 tabular-nums"
          data-testid="checkout-convenience-fee"
        >
          <span className="inline-flex items-center gap-1">
            Service fee
            <span title="Covers the Empiria platform service." className="text-gray-600 cursor-help">
              &#9432;
            </span>
          </span>
          <span>{formatPrice(fees.platformFee)}</span>
        </div>
      )}
      {passProcessingFee && fees.stripeOffset > 0 && (
        <div
          className="flex justify-between text-sm text-gray-600 tabular-nums"
          data-testid="checkout-processing-fee"
        >
          <span className="inline-flex items-center gap-1">
            Processing fee
            <span title="Secure card processing." className="text-gray-600 cursor-help">
              &#9432;
            </span>
          </span>
          <span>{formatPrice(fees.stripeOffset)}</span>
        </div>
      )}
    </div>
  );

  /* ============================ STEP RAIL ============================ */
  const StepRail = () => {
    const steps = [
      { n: 1, label: "Select" },
      { n: 2, label: "Review" },
      { n: 3, label: "Pay" },
    ];
    const current = step === "select" ? 1 : 2;
    return (
      <div className="flex items-center gap-1.5 mb-6" data-testid="checkout-steps">
        {steps.map((s, i) => {
          const done = s.n < current;
          const active = s.n === current;
          return (
            <div key={s.n} className="flex items-center gap-1.5">
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                    done
                      ? "bg-[#F15A29] text-white"
                      : active
                        ? "bg-gray-900 text-white"
                        : "bg-gray-200 text-gray-700"
                  }`}
                >
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : s.n}
                </span>
                <span
                  className={`text-xs font-semibold tracking-wide uppercase ${
                    active ? "text-gray-900" : done ? "text-[#F15A29]" : "text-gray-600"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <span className={`mx-1.5 h-px w-6 sm:w-10 ${done ? "bg-[#F15A29]" : "bg-gray-200"}`} />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  /* ============================ REVIEW STEP ============================ */
  if (step === "review") {
    const payLabel =
      customerTotal === 0 ? "Complete order" : `Pay ${formatPrice(customerTotal)}`;

    return (
      <div data-testid="checkout-review">
        <StepRail />

        <button
          type="button"
          onClick={() => {
            setError(null);
            setStep("select");
            if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="group mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 transition-colors hover:text-gray-900"
          data-testid="checkout-back"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Edit order
        </button>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
          {/* LEFT — the ticket */}
          <div className="space-y-5">
            {/* Ticket stub */}
            <div className="relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
              {/* Orange header band */}
              <div className="relative bg-gradient-to-br from-[#F15A29] to-[#d6420f] px-7 pt-7 pb-6 text-white">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/80">
                  <Ticket className="h-3.5 w-3.5" />
                  Empiria · Order preview
                </div>
                <h2
                  className="mt-2 text-2xl font-extrabold leading-tight tracking-tight"
                  data-testid="checkout-event-title"
                >
                  {eventTitle}
                </h2>
                {occurrenceDate && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur-sm">
                    <Calendar className="h-3.5 w-3.5" />
                    {occurrenceDate.toLocaleDateString("en-US", {
                      timeZone: "America/Toronto",
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    {" · "}
                    {occurrenceDate.toLocaleTimeString("en-US", {
                      timeZone: "America/Toronto",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    })}
                  </div>
                )}
              </div>

              {/* Perforation line with punched notches */}
              <div className="relative">
                <span className="absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-gray-50" />
                <span className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-gray-50" />
                <div className="mx-6 border-t-2 border-dashed border-gray-200" />
              </div>

              {/* Ticket lines */}
              <div className="px-7 py-6">
                <div className="space-y-5" data-testid="checkout-review-tickets">
                  {selectedTiers.map((tier) => {
                    const qty = quantities[tier.id] ?? 0;
                    return (
                      <div key={tier.id}>
                        <div className="flex items-baseline justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate font-bold text-gray-900">{tier.name}</p>
                            {tier.description && (
                              <p className="mt-0.5 truncate text-xs text-gray-600">
                                {tier.description}
                              </p>
                            )}
                          </div>
                          <div className="shrink-0 text-right tabular-nums">
                            <p className="text-sm font-semibold text-gray-900">
                              {qty} × {formatPrice(tier.price)}
                            </p>
                            <p className="text-xs text-gray-600">
                              {formatPrice(tier.price * qty)}
                            </p>
                          </div>
                        </div>

                        {/* Per-attendee custom field answers */}
                        {customFields.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {Array.from({ length: qty }).map((_, i) => {
                              const a = answers[`${tier.id}:${i}`] ?? {};
                              return (
                                <div
                                  key={i}
                                  className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2"
                                >
                                  <p className="text-[11px] font-bold uppercase tracking-wide text-gray-600">
                                    Attendee {i + 1}
                                  </p>
                                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                                    {customFields.map((f) => (
                                      <span key={f.id} className="text-xs text-gray-600">
                                        <span className="text-gray-600">{f.label}:</span>{" "}
                                        <span className="font-medium text-gray-800">
                                          {String(a[f.id] ?? "").trim() || "—"}
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Contact / delivery */}
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-600">
                Delivery
              </h3>
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-50 text-[#F15A29]">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  {fullName && <p className="font-semibold text-gray-900">{fullName}</p>}
                  <p className="truncate text-sm text-gray-600" data-testid="checkout-review-email">
                    {email}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-600">
                    Your tickets &amp; wallet passes will be sent here.
                  </p>
                </div>
              </div>
            </div>

            {/* What happens next */}
            <div className="rounded-2xl border border-dashed border-gray-200 p-6">
              <h3 className="mb-4 text-xs font-bold uppercase tracking-wide text-gray-600">
                What happens next
              </h3>
              <ul className="space-y-3.5">
                {[
                  {
                    icon: Lock,
                    text: "You'll be taken to Stripe's secure page to enter your card — Empiria never sees your card details.",
                  },
                  {
                    icon: QrCode,
                    text: "Right after payment, your QR tickets appear instantly and a copy lands in your inbox.",
                  },
                  {
                    icon: Wallet,
                    text: "Add them to Apple Wallet or Google Wallet for one-tap entry at the door.",
                  },
                ].map(({ icon: Icon, text }, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#F15A29]" />
                    <span className="text-sm leading-relaxed text-gray-600">{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* RIGHT — receipt + pay */}
          <div className="lg:sticky lg:top-6">
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
              <div className="px-6 pt-6">
                <h3 className="text-xs font-bold uppercase tracking-wide text-gray-600">
                  Order summary
                </h3>
                <div className="mt-4">
                  <ReceiptLines />
                </div>
              </div>

              {/* Perforated total divider */}
              <div className="relative mt-5">
                <span className="absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-gray-50" />
                <span className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-gray-50" />
                <div className="mx-6 border-t-2 border-dashed border-gray-200" />
              </div>

              <div className="px-6 pb-6 pt-4">
                <div
                  className="flex items-end justify-between"
                  data-testid="checkout-total"
                >
                  <span className="text-sm font-semibold text-gray-700">Total due</span>
                  <span className="text-3xl font-extrabold tracking-tight text-gray-900 tabular-nums">
                    {customerTotal === 0 ? "FREE" : formatPrice(customerTotal)}
                  </span>
                </div>

                {error && (
                  <div
                    className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
                    data-testid="checkout-error"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading || totalItems === 0}
                  className="group mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#F15A29] py-4 font-bold text-white shadow-sm transition-all hover:bg-[#d6420f] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="checkout-submit"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Redirecting to Stripe…
                    </>
                  ) : (
                    <>
                      <CreditCard className="h-4 w-4" />
                      {payLabel}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>

                <StripeBadge className="mt-3" />
              </div>
            </div>

            <p className="mt-3 px-2 text-center text-[11px] leading-relaxed text-gray-600">
              By paying you agree to Empiria&apos;s Terms &amp; Refund Policy. Prices in{" "}
              {currency.toUpperCase()}.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ============================ SELECT STEP ============================ */
  return (
    <div data-testid="checkout-select">
      <StepRail />
      <div
        data-testid="checkout-form"
        className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start"
      >
        {/* LEFT COLUMN */}
        <div className="space-y-6">
          {/* Occurrence picker — buyers choose WHICH date first */}
          {occurrences.length > 1 && (
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5" data-testid="checkout-occurrences">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900">
                <Calendar className="h-4 w-4 text-[#F15A29]" />
                Choose a Date
              </h2>
              <div className="space-y-3">
                {occurrences.map((occ) => {
                  const d = new Date(occ.starts_at);
                  const isSelected = selectedOccurrenceId === occ.id;
                  return (
                    <button
                      key={occ.id}
                      type="button"
                      onClick={() => setSelectedOccurrenceId(occ.id)}
                      data-testid={`checkout-occurrence-${occ.id}`}
                      className={`flex w-full items-center justify-between rounded-xl border-2 p-4 text-left transition-all ${
                        isSelected
                          ? "border-[#F15A29] bg-orange-50"
                          : "border-gray-200 hover:border-orange-300"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">
                          {d.toLocaleDateString("en-US", {
                            timeZone: "America/Toronto",
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                          {" · "}
                          {d.toLocaleTimeString("en-US", {
                            timeZone: "America/Toronto",
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })}
                        </p>
                        {occ.label && (
                          <p className="mt-0.5 truncate text-xs text-gray-700">{occ.label}</p>
                        )}
                      </div>
                      {isSelected && (
                        <span className="ml-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F15A29]">
                          <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Contact Form */}
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            <h3 className="mb-4 flex items-center gap-2 border-b border-gray-100 pb-2 font-bold text-gray-900">
              <Mail className="h-4 w-4 text-[#F15A29]" />
              Contact Information
            </h3>

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
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-700 mb-1.5">
                    First Name
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-gray-300 p-3 text-gray-900 outline-none transition focus:border-[#F15A29] focus:ring-2 focus:ring-[#F15A29]/20"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First Name"
                    data-testid="checkout-first-name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-700 mb-1.5">
                    Last Name
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-gray-300 p-3 text-gray-900 outline-none transition focus:border-[#F15A29] focus:ring-2 focus:ring-[#F15A29]/20"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Last Name"
                    data-testid="checkout-last-name"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-700 mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  className="w-full rounded-lg border border-gray-300 p-3 text-gray-900 outline-none transition focus:border-[#F15A29] focus:ring-2 focus:ring-[#F15A29]/20"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  data-testid="checkout-email"
                />
                <p className="mt-1 text-xs text-gray-600">
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

          {/* Per-ticket custom fields */}
          {customFields.length > 0 && totalItems > 0 && (
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5" data-testid="checkout-custom-fields">
              <h3 className="mb-4 flex items-center gap-2 border-b border-gray-100 pb-2 font-bold text-gray-900">
                <Users className="h-4 w-4 text-[#F15A29]" />
                Attendee Details
              </h3>
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
                                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-700 mb-1.5">
                                    {field.label}
                                    {field.required && <span className="text-red-500"> *</span>}
                                  </label>
                                  {field.type === "dropdown" ? (
                                    <select
                                      className="w-full rounded-lg border border-gray-300 p-3 text-gray-900 outline-none transition focus:border-[#F15A29] focus:ring-2 focus:ring-[#F15A29]/20 text-sm bg-white"
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
                                      className="w-full rounded-lg border border-gray-300 p-3 text-gray-900 outline-none transition focus:border-[#F15A29] focus:ring-2 focus:ring-[#F15A29]/20 text-sm"
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

          {/* Tier selection */}
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900">
            <Ticket className="h-4 w-4 text-[#F15A29]" />
            Select Tickets
          </h2>
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
                        <p className="text-xs text-gray-700 mt-0.5 truncate">
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
        </div>

        {/* RIGHT COLUMN — Promo Code + Order Summary */}
        <div className="lg:sticky lg:top-6 self-start space-y-6">
          {/* Promo Code */}
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-900">
              <Tag className="h-3.5 w-3.5 text-[#F15A29]" />
              Promo Code
            </h3>
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
                  className="text-gray-600 hover:text-gray-600 text-sm font-medium"
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
                  className="flex-1 rounded-lg border border-gray-300 p-3 text-sm uppercase text-gray-900 outline-none transition focus:border-[#F15A29] focus:ring-2 focus:ring-[#F15A29]/20"
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

          {/* Order Summary */}
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            <h2
              className="text-xl font-bold mb-1"
              data-testid="checkout-event-title"
            >
              {eventTitle}
            </h2>
            {selectedOccurrence && (
              <p className="text-sm text-gray-700">
                {new Date(selectedOccurrence.starts_at).toLocaleDateString(
                  "en-US",
                  {
                    timeZone: "America/Toronto",
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  }
                )}{" "}
                &middot;{" "}
                {new Date(selectedOccurrence.starts_at).toLocaleTimeString(
                  "en-US",
                  {
                    timeZone: "America/Toronto",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  }
                )}
              </p>
            )}

            {/* Totals breakdown */}
            {totalItems > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-200 space-y-1.5">
                <ReceiptLines dense />
                <div className="flex justify-between font-bold text-lg pt-2 border-t border-gray-100 tabular-nums">
                  <span>Total</span>
                  <span>{formatPrice(customerTotal)}</span>
                </div>
              </div>
            )}

            <div className="pt-4">
              <button
                type="button"
                onClick={goToReview}
                disabled={totalItems === 0}
                className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#F15A29] py-4 font-bold text-white shadow-sm transition-all hover:bg-[#d6420f] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="checkout-review-button"
              >
                Review order
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>

            <StripeBadge className="mt-4" />
          </div>
        </div>
      </div>
    </div>
  );
}
