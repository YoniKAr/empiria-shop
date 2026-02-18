// ──────────────────────────────────────────────────
// 📁 components/TicketSelector.tsx — NEW FILE (create this)
// ──────────────────────────────────────────────────

'use client';

import { useState } from 'react';
import { Minus, Plus, Loader2, AlertCircle } from 'lucide-react';

interface TicketTier {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  remaining_quantity: number;
  max_per_order: number;
  sales_start_at: string | null;
  sales_end_at: string | null;
  is_hidden: boolean;
}

interface TicketSelectorProps {
  tiers: TicketTier[];
  eventId: string;
  eventCurrency: string;
  currencySymbol: string;
  userEmail?: string;
  userName?: string;
}

export default function TicketSelector({
  tiers,
  eventId,
  eventCurrency,
  currencySymbol,
  userEmail,
  userName,
}: TicketSelectorProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Contact info for guest checkout
  const [guestEmail, setGuestEmail] = useState('');
  const [guestName, setGuestName] = useState('');

  const visibleTiers = tiers.filter((t) => !t.is_hidden);

  const updateQuantity = (tierId: string, delta: number) => {
    setQuantities((prev) => {
      const tier = tiers.find((t) => t.id === tierId)!;
      const current = prev[tierId] || 0;
      const next = Math.max(0, Math.min(tier.max_per_order, current + delta));
      return { ...prev, [tierId]: next };
    });
    setError(null);
  };

  const totalItems = Object.values(quantities).reduce((sum, q) => sum + q, 0);
  const totalPrice = visibleTiers.reduce((sum, tier) => {
    return sum + tier.price * (quantities[tier.id] || 0);
  }, 0);

  const isTierAvailable = (tier: TicketTier) => {
    const now = new Date();
    if (tier.remaining_quantity <= 0) return false;
    if (tier.sales_start_at && new Date(tier.sales_start_at) > now) return false;
    if (tier.sales_end_at && new Date(tier.sales_end_at) < now) return false;
    return true;
  };

  const getTierStatus = (tier: TicketTier) => {
    const now = new Date();
    if (tier.remaining_quantity <= 0) return 'Sold Out';
    if (tier.sales_start_at && new Date(tier.sales_start_at) > now) return 'Coming Soon';
    if (tier.sales_end_at && new Date(tier.sales_end_at) < now) return 'Sales Ended';
    if (tier.remaining_quantity <= 10) return `${tier.remaining_quantity} left`;
    return null;
  };

  const handleCheckout = async () => {
    const selections = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([tierId, quantity]) => ({ tierId, quantity }));

    if (selections.length === 0) {
      setError('Please select at least one ticket');
      return;
    }

    const email = userEmail || guestEmail;
    const name = userName || guestName;

    if (!email) {
      setError('Please enter your email address');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          tiers: selections,
          contactEmail: email,
          contactName: name,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      setLoading(false);
    }
  };

  return (
    <div className="border border-gray-200 rounded-xl shadow-lg p-6 sticky top-24 bg-white">
      <h3 className="font-bold text-xl mb-1">Get Tickets</h3>
      <p className="text-sm text-gray-500 mb-5">Select your tickets below</p>

      {/* Tier list */}
      <div className="space-y-3 mb-5">
        {visibleTiers.map((tier) => {
          const available = isTierAvailable(tier);
          const status = getTierStatus(tier);
          const qty = quantities[tier.id] || 0;

          return (
            <div
              key={tier.id}
              className={`p-4 border rounded-lg transition-colors ${
                available
                  ? qty > 0
                    ? 'border-orange-300 bg-orange-50'
                    : 'border-gray-200 hover:border-gray-300'
                  : 'border-gray-100 bg-gray-50 opacity-60'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{tier.name}</div>
                  {tier.description && (
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{tier.description}</div>
                  )}
                </div>
                <div className="font-bold text-sm ml-3 shrink-0">
                  {tier.price === 0 ? 'Free' : `${currencySymbol}${tier.price.toLocaleString()}`}
                </div>
              </div>

              <div className="flex items-center justify-between mt-3">
                {status && (
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      status === 'Sold Out'
                        ? 'bg-red-100 text-red-700'
                        : status === 'Coming Soon'
                        ? 'bg-blue-100 text-blue-700'
                        : status === 'Sales Ended'
                        ? 'bg-gray-100 text-gray-600'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {status}
                  </span>
                )}
                {!status && <span />}

                {available && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateQuantity(tier.id, -1)}
                      disabled={qty === 0}
                      className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="w-6 text-center font-medium text-sm tabular-nums">{qty}</span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(tier.id, 1)}
                      disabled={qty >= tier.max_per_order || qty >= tier.remaining_quantity}
                      className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Guest contact fields */}
      {!userEmail && totalItems > 0 && (
        <div className="space-y-3 mb-5 pt-4 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact Info</p>
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
          <p className="text-xs text-gray-400">Your tickets will be sent to this email.</p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 text-red-600 text-sm mb-4 p-3 bg-red-50 rounded-lg">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Order summary + CTA */}
      {totalItems > 0 && (
        <div className="flex items-center justify-between mb-4 text-sm">
          <span className="text-gray-600">
            {totalItems} ticket{totalItems !== 1 ? 's' : ''}
          </span>
          <span className="font-bold text-lg">
            {totalPrice === 0 ? 'Free' : `${currencySymbol}${totalPrice.toLocaleString()}`}
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
          'Select Tickets'
        ) : (
          'Checkout'
        )}
      </button>

      <p className="text-xs text-center text-gray-400 mt-4">Secure checkout powered by Stripe</p>
    </div>
  );
}
