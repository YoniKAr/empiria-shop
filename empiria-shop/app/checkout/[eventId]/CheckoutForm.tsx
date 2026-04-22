"use client";

import { useState } from "react";
import { ShieldCheck, Minus, Plus, Loader2 } from "lucide-react";

interface Tier {
  id: string;
  name: string;
  description: string | null;
  price: number;
  remaining_quantity: number;
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
  user: {
    email?: string;
    given_name?: string;
    family_name?: string;
    sub?: string;
    name?: string;
  } | null;
}

export function CheckoutForm({
  eventId,
  eventTitle,
  tiers,
  occurrences,
  currency,
  user,
}: CheckoutFormProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    // Default: 1 of the first available tier
    const first = tiers.find((t) => t.remaining_quantity > 0);
    return first ? { [first.id]: 1 } : {};
  });
  const [email, setEmail] = useState(user?.email ?? "");
  const [firstName, setFirstName] = useState(user?.given_name ?? "");
  const [lastName, setLastName] = useState(user?.family_name ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedOccurrence = occurrences[0];

  const totalItems = Object.values(quantities).reduce((s, q) => s + q, 0);
  const subtotal = tiers.reduce(
    (s, t) => s + t.price * (quantities[t.id] ?? 0),
    0
  );

  const formatPrice = (amount: number) => {
    if (amount === 0) return "FREE";
    const sym = currency === "inr" ? "₹" : currency === "cad" ? "CA$" : "$";
    return `${sym}${amount.toLocaleString()}`;
  };

  const setQty = (tierId: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [tierId]: Math.max(0, qty) }));
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

    setLoading(true);
    setError(null);

    try {
      const tierSelections = tiers
        .filter((t) => (quantities[t.id] ?? 0) > 0)
        .map((t) => ({ tierId: t.id, quantity: quantities[t.id] }));

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          tiers: tierSelections,
          contactEmail: email,
          contactName: `${firstName} ${lastName}`.trim() || undefined,
          occurrenceId: selectedOccurrence?.id,
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
    <div data-testid="checkout-form">
      {/* Order Summary */}
      <div className="bg-white p-6 rounded-xl shadow-sm mb-6">
        <h2
          className="text-xl font-bold mb-1"
          data-testid="checkout-event-title"
        >
          {eventTitle}
        </h2>
        {selectedOccurrence && (
          <p className="text-sm text-gray-500 mb-4">
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

        {/* Tier selection */}
        <div className="space-y-3" data-testid="checkout-tiers">
          {tiers.map((tier) => {
            const qty = quantities[tier.id] ?? 0;
            const soldOut = tier.remaining_quantity === 0;

            return (
              <div
                key={tier.id}
                data-testid={`checkout-tier-${tier.id}`}
                className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
                  qty > 0
                    ? "border-[#F98C1F] bg-orange-50"
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
                  <p className="text-sm font-bold text-[#F98C1F] mt-1">
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
                      onClick={() => setQty(tier.id, qty - 1)}
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
                      onClick={() =>
                        setQty(
                          tier.id,
                          Math.min(tier.remaining_quantity, qty + 1)
                        )
                      }
                      disabled={qty >= tier.remaining_quantity}
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

        {/* Totals */}
        {totalItems > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>
                {totalItems} ticket{totalItems > 1 ? "s" : ""}
              </span>
              <span>{formatPrice(subtotal)}</span>
            </div>
            <div
              className="flex justify-between font-bold text-lg"
              data-testid="checkout-total"
            >
              <span>Total</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
          </div>
        )}
      </div>

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
  );
}
