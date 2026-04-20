// ──────────────────────────────────────────────────
// 📁 app/checkout/success/page.tsx — NEW FILE (create this)
// Post-payment confirmation page with QR code tickets
// ──────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { formatCurrency } from '@/lib/utils';
import { generateQRCodeDataURL } from '@/lib/qrcode';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Calendar, MapPin, ArrowRight } from 'lucide-react';
import Navbar from '@/components/Navbar';

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;

  if (!session_id) {
    redirect('/');
  }

  // 1. Retrieve the Stripe Checkout Session
  let checkoutSession;
  try {
    checkoutSession = await stripe.checkout.sessions.retrieve(session_id);
  } catch {
    redirect('/');
  }

  if (checkoutSession.payment_status !== 'paid') {
    redirect('/');
  }

  const metadata = checkoutSession.metadata;
  const eventId = metadata?.event_id;

  if (!eventId) redirect('/');

  // 2. Fetch order + event + tickets from Supabase
  const supabase = getSupabaseAdmin();

  // Give the webhook a moment to process if we arrive very quickly
  let order = null;
  let attempts = 0;

  while (!order && attempts < 5) {
    const { data } = await supabase
      .from('orders')
      .select('id, total_amount, platform_fee_amount, organizer_payout_amount, currency, status, created_at')
      .eq('stripe_checkout_session_id', session_id)
      .single();

    if (data) {
      order = data;
    } else {
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  // Fetch event info
  const { data: event } = await supabase
    .from('events')
    .select('title, slug, venue_name, city, cover_image_url')
    .eq('id', eventId)
    .single();

  // Fetch first occurrence for display
  const { data: successOcc } = await supabase
    .from('event_occurrences')
    .select('starts_at')
    .eq('event_id', eventId)
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  // Fetch tickets for this order + generate QR codes server-side
  let tickets: any[] = [];
  if (order) {
    const { data: ticketData } = await supabase
      .from('tickets')
      .select('id, qr_code_secret, attendee_name, attendee_email, status, seat_label, tier_id, ticket_tiers(name, price)')
      .eq('order_id', order.id)
      .order('purchase_date', { ascending: true });

    // Generate QR codes server-side for each ticket
    tickets = await Promise.all(
      (ticketData || []).map(async (ticket: any) => ({
        ...ticket,
        qrDataUrl: await generateQRCodeDataURL(ticket.qr_code_secret, { width: 200 }),
      }))
    );
  }

  const eventDate = successOcc ? new Date(successOcc.starts_at) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        {/* Success header */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="w-9 h-9 text-green-600" />
          </div>
          <h1 className="text-3xl font-extrabold mb-2">You&apos;re going!</h1>
          <p className="text-gray-500 text-lg">
            Your tickets have been confirmed. Check your email for a copy.
          </p>
        </div>

        {/* Event card */}
        {event && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-8">
            {event.cover_image_url && (
              <div className="h-40 bg-gray-200 relative">
                <img
                  src={event.cover_image_url}
                  alt={event.title}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              </div>
            )}
            <div className={`p-6 ${event.cover_image_url ? '-mt-12 relative z-10' : ''}`}>
              <h2 className={`text-2xl font-bold mb-3 ${event.cover_image_url ? 'text-white' : ''}`}>
                {event.title}
              </h2>
              <div className={`flex flex-wrap gap-4 text-sm ${event.cover_image_url ? 'text-white/80' : 'text-gray-600'}`}>
                {eventDate && (
                  <div className="flex items-center gap-1.5">
                    <Calendar size={14} />
                    {eventDate.toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                    {' at '}
                    {eventDate.toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </div>
                )}
                {event.venue_name && (
                  <div className="flex items-center gap-1.5">
                    <MapPin size={14} />
                    {event.venue_name}{event.city ? `, ${event.city}` : ''}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Order summary */}
        {order && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">Order Summary</h3>
              <span className="text-xs font-medium bg-green-100 text-green-700 px-2.5 py-1 rounded-full">
                Confirmed
              </span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Order ID</span>
                <span className="font-mono text-xs">{order.id.slice(0, 8)}...</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Tickets</span>
                <span>{tickets.length}</span>
              </div>
              <div className="flex justify-between font-bold text-base pt-3 border-t border-gray-100">
                <span>Total Paid</span>
                <span>{formatCurrency(order.total_amount, order.currency)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Tickets with QR codes */}
        {tickets.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-bold text-lg">
              Your Ticket{tickets.length > 1 ? 's' : ''} ({tickets.length})
            </h3>

            {tickets.map((ticket: any, index: number) => (
              <div
                key={ticket.id}
                className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
              >
                {/* Ticket top */}
                <div className="p-6 flex flex-col sm:flex-row gap-6 items-center">
                  {/* QR Code — generated server-side */}
                  <div className="shrink-0">
                    <img
                      src={ticket.qrDataUrl}
                      alt={`QR Code for ticket ${index + 1}`}
                      width={160}
                      height={160}
                      className="rounded-lg"
                      style={{ imageRendering: 'crisp-edges' }}
                    />
                  </div>

                  {/* Ticket info */}
                  <div className="flex-1 text-center sm:text-left">
                    <div className="text-xs text-gray-400 font-medium mb-1">
                      TICKET {index + 1} OF {tickets.length}
                    </div>
                    <h4 className="font-bold text-xl mb-1">{event?.title}</h4>
                    <p className="text-orange-600 font-semibold text-sm mb-3">
                      {(ticket.ticket_tiers as any)?.name || 'General Admission'}
                    </p>

                    <div className="space-y-1.5 text-sm text-gray-600">
                      {ticket.attendee_name && (
                        <p>
                          <span className="text-gray-400">Name:</span> {ticket.attendee_name}
                        </p>
                      )}
                      {ticket.seat_label && (
                        <p>
                          <span className="text-gray-400">Seat:</span> {ticket.seat_label}
                        </p>
                      )}
                      <p>
                        <span className="text-gray-400">Status:</span>{' '}
                        <span className="text-green-600 font-medium capitalize">{ticket.status}</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Wallet buttons */}
                <div className="px-6 pb-4 flex flex-wrap gap-2 justify-center sm:justify-start">
                  <a
                    href={`/api/wallet/apple/${ticket.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3.5 py-2 text-xs font-semibold text-white hover:bg-gray-800 transition-colors"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                    </svg>
                    Add to Apple Wallet
                  </a>
                  <a
                    href={`/api/wallet/google/${ticket.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#4285f4] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#3367d6] transition-colors"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Add to Google Wallet
                  </a>
                </div>

                {/* Ticket bottom — perforated line effect */}
                <div className="relative">
                  <div className="absolute left-0 right-0 top-0 border-t-2 border-dashed border-gray-200" />
                  <div className="absolute -left-3 -top-3 w-6 h-6 bg-gray-50 rounded-full" />
                  <div className="absolute -right-3 -top-3 w-6 h-6 bg-gray-50 rounded-full" />
                </div>

                <div className="px-6 py-3 bg-gray-50 flex items-center justify-between">
                  <span className="text-xs text-gray-400 font-mono">
                    {ticket.qr_code_secret.slice(0, 8).toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-400">
                    Show this QR code at the entrance
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Fallback while webhook is processing */}
        {!order && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
            <div className="animate-pulse space-y-4">
              <div className="h-4 bg-gray-200 rounded w-3/4 mx-auto" />
              <div className="h-4 bg-gray-200 rounded w-1/2 mx-auto" />
            </div>
            <p className="text-gray-500 mt-6 text-sm">
              Your payment was successful! We&apos;re generating your tickets — this page will update
              shortly. You&apos;ll also receive a confirmation email.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-black text-white rounded-xl font-bold hover:bg-gray-800 transition-colors"
          >
            Explore More Events <ArrowRight size={16} />
          </Link>
          <a
            href="https://profile.empiriaindia.com"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-gray-200 rounded-xl font-bold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            View My Tickets
          </a>
        </div>
      </div>
    </div>
  );
}
