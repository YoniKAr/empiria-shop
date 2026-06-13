// ──────────────────────────────────────────────────
// 📁 app/checkout/success/page.tsx — NEW FILE (create this)
// Post-payment confirmation page with QR code tickets
// ──────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase';
import { getSafeSession } from '@/lib/auth0';
import { stripe } from '@/lib/stripe';
import { formatCurrency } from '@/lib/utils';
import { generateQRCodeDataURL } from '@/lib/qrcode';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Calendar, MapPin, ArrowRight, Video, Lock } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import AutoRefresh from './AutoRefresh';
import { PROFILE_URL } from '@/lib/urls';

// Only allow http(s) meeting links as clickable anchors — blocks
// javascript:/data:/vbscript: and other XSS-prone schemes.
function safeMeetingHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; order_id?: string }>;
}) {
  const { session_id, order_id } = await searchParams;

  if (!session_id && !order_id) {
    redirect('/');
  }

  const supabase = getSupabaseAdmin();
  const orderSelect =
    'id, event_id, user_id, total_amount, platform_fee_amount, organizer_payout_amount, currency, status, created_at';
  let order: { id: string; event_id: string; user_id: string | null; total_amount: number; platform_fee_amount: number; organizer_payout_amount: number; currency: string; status: string; created_at: string } | null = null;
  let eventId: string | undefined;

  if (order_id) {
    // Free order — no Stripe session. Resolve directly by order id.
    const { data } = await supabase
      .from('orders')
      .select(orderSelect)
      .eq('id', order_id)
      .single();
    if (!data) redirect('/');

    // ── Access gate: a bare UUID in the URL must not expose ticket QRs. ──
    // Logged-in orders: the session user must OWN the order. Guest free
    // orders (user_id null): only show within 30 minutes of purchase (the
    // immediate post-checkout window); after that, point at email/login.
    const session = await getSafeSession();
    const viewerSub = session?.user?.sub ?? null;
    const isOwner = !!data.user_id && data.user_id === viewerSub;
    const isFreshGuestOrder =
      !data.user_id &&
      Date.now() - new Date(data.created_at).getTime() < 30 * 60 * 1000;

    if (!isOwner && !isFreshGuestOrder) {
      return (
        <div className="min-h-screen bg-gray-50">
          <Navbar />
          <div className="max-w-xl mx-auto px-4 sm:px-6 py-20 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <Lock className="w-8 h-8 text-gray-500" />
            </div>
            <h1 className="text-2xl font-extrabold mb-3">This order is protected</h1>
            <p className="text-gray-700 mb-8">
              To keep your tickets safe, this page is only available right after
              checkout. Log in to view your tickets, or find them in your
              confirmation email.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="/auth/login"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-black text-white rounded-xl font-bold hover:bg-gray-800 transition-colors"
              >
                Log in to view tickets
              </a>
              <Link
                href="/"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-gray-200 rounded-xl font-bold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Explore Events <ArrowRight size={16} />
              </Link>
            </div>
          </div>
          <Footer />
        </div>
      );
    }

    order = data;
    eventId = data.event_id;
  } else {
    // Paid order — verify the Stripe session, then resolve the order by session id.
    let checkoutSession;
    try {
      checkoutSession = await stripe.checkout.sessions.retrieve(session_id!);
    } catch {
      redirect('/');
    }

    if (checkoutSession.payment_status !== 'paid') {
      redirect('/');
    }

    eventId = checkoutSession.metadata?.event_id;
    if (!eventId) redirect('/');

    // Give the webhook a moment to process if we arrive very quickly
    let attempts = 0;
    while (!order && attempts < 5) {
      const { data } = await supabase
        .from('orders')
        .select(orderSelect)
        .eq('stripe_checkout_session_id', session_id)
        .single();

      if (data) {
        order = data;
      } else {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }

  if (!eventId) redirect('/');

  // Fetch event info
  const { data: event } = await supabase
    .from('events')
    .select('title, slug, venue_name, city, cover_image_url, location_type, meeting_link')
    .eq('id', eventId)
    .single();

  // Fetch tickets for this order + generate QR codes server-side
  let tickets: any[] = [];
  if (order) {
    const { data: ticketData } = await supabase
      .from('tickets')
      .select('id, qr_code_secret, attendee_name, attendee_email, status, seat_label, tier_id, occurrence_id, ticket_tiers(name, price)')
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

  // Show the PURCHASED occurrence: tickets carry the occurrence_id the buyer
  // selected. Fall back to the earliest occurrence only when the tickets have
  // no occurrence (single-date legacy events / order not yet fulfilled).
  const purchasedOccurrenceId: string | null =
    tickets.find((t: any) => t.occurrence_id)?.occurrence_id ?? null;

  let successOcc: { starts_at: string } | null = null;
  if (purchasedOccurrenceId) {
    const { data } = await supabase
      .from('event_occurrences')
      .select('starts_at')
      .eq('id', purchasedOccurrenceId)
      .maybeSingle();
    successOcc = data;
  }
  if (!successOcc) {
    const { data } = await supabase
      .from('event_occurrences')
      .select('starts_at')
      .eq('event_id', eventId)
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    successOcc = data;
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
          <p className="text-gray-700 text-lg">
            Your tickets have been confirmed. Check your email for a copy.
          </p>
        </div>

        {/* Event card */}
        {event && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-8">
            {event.cover_image_url && (
              <div className="aspect-video bg-gray-200">
                <img
                  src={event.cover_image_url}
                  alt={event.title}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            {/* Text sits BELOW the image in dark — never overlaps the white
                card background (the old -mt-12 overlay went white-on-white). */}
            <div className="p-6">
              <h2 className="text-2xl font-bold mb-3 text-gray-900">
                {event.title}
              </h2>
              <div className="flex flex-wrap gap-4 text-sm text-gray-600">
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
                {safeMeetingHref(event.meeting_link) && (event.location_type === 'virtual' || event.location_type === 'hybrid') && (
                  <a
                    href={safeMeetingHref(event.meeting_link)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 hover:underline text-indigo-600"
                  >
                    <Video size={14} />
                    Join Online Meeting
                  </a>
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
                    <div className="text-xs text-gray-700 font-medium mb-1">
                      TICKET {index + 1} OF {tickets.length}
                    </div>
                    <h4 className="font-bold text-xl mb-1">{event?.title}</h4>
                    <p className="text-orange-600 font-semibold text-sm mb-3">
                      {(ticket.ticket_tiers as any)?.name || 'General Admission'}
                    </p>

                    <div className="space-y-1.5 text-sm text-gray-600">
                      {ticket.attendee_name && (
                        <p>
                          <span className="text-gray-700">Name:</span> {ticket.attendee_name}
                        </p>
                      )}
                      {ticket.seat_label && (
                        <p>
                          <span className="text-gray-700">Seat:</span> {ticket.seat_label}
                        </p>
                      )}
                      <p>
                        <span className="text-gray-700">Status:</span>{' '}
                        <span className="text-green-600 font-medium capitalize">{ticket.status}</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Wallet buttons */}
                <div className="px-6 pb-4 flex flex-wrap gap-3 justify-center sm:justify-start">
                  <a href={`/api/wallet/apple/${ticket.id}?session_id=${session_id}`}>
                    <img
                      src="/wallet/add-to-apple-wallet.svg"
                      alt="Add to Apple Wallet"
                      className="h-10"
                    />
                  </a>
                  <a href={`/api/wallet/google/${ticket.id}?session_id=${session_id}`}>
                    <img
                      src="/wallet/add-to-google-wallet.svg"
                      alt="Add to Google Wallet"
                      className="h-10"
                    />
                  </a>
                </div>

                {/* Ticket bottom — perforated line effect */}
                <div className="relative">
                  <div className="absolute left-0 right-0 top-0 border-t-2 border-dashed border-gray-200" />
                  <div className="absolute -left-3 -top-3 w-6 h-6 bg-gray-50 rounded-full" />
                  <div className="absolute -right-3 -top-3 w-6 h-6 bg-gray-50 rounded-full" />
                </div>

                <div className="px-6 py-3 bg-gray-50 flex items-center justify-between">
                  <span className="text-xs text-gray-700 font-mono">
                    {ticket.qr_code_secret.slice(0, 8).toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-700">
                    Show this QR code at the entrance
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Fallback while webhook is processing — auto-refreshes a few times
            so "updates shortly" actually happens. */}
        {!order && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
            <AutoRefresh />
            <div className="animate-pulse space-y-4">
              <div className="h-4 bg-gray-200 rounded w-3/4 mx-auto" />
              <div className="h-4 bg-gray-200 rounded w-1/2 mx-auto" />
            </div>
            <p className="text-gray-700 mt-6 text-sm">
              Your payment was successful! We&apos;re generating your tickets — this page will
              refresh automatically for a moment. You&apos;ll also receive a confirmation email
              with your tickets either way.
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
            href={PROFILE_URL}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-gray-200 rounded-xl font-bold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            View My Tickets
          </a>
        </div>
      </div>

      <Footer />
    </div>
  );
}
