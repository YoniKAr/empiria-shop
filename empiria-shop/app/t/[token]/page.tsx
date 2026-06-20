// ──────────────────────────────────────────────────
// Public "share a ticket" landing page.
// Reached via /t/<qr_code_secret> — the token is the ticket's secret bearer
// credential, so anyone the buyer forwards the link to can add the ticket to
// their own Apple or Google Wallet. No login required.
// ──────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase';
import { generateQRCodeDataURL } from '@/lib/qrcode';
import Link from 'next/link';
import { Calendar, MapPin, Ticket as TicketIcon } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { formatEventDateTime, DEFAULT_TZ } from '@/lib/datetime';

export default async function ShareTicketPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = getSupabaseAdmin();
  const { data: ticket } = await supabase
    .from('tickets')
    .select(`
      id, qr_code_secret, seat_label, status,
      event:events!tickets_event_id_fkey (title, venue_name, city, timezone),
      occurrence:event_occurrences!tickets_occurrence_id_fkey (starts_at),
      tier:ticket_tiers!tickets_tier_id_fkey (name)
    `)
    .eq('qr_code_secret', token)
    .single();

  if (!ticket) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="max-w-md mx-auto px-4 py-24 text-center">
          <TicketIcon className="w-10 h-10 text-gray-300 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Ticket not found</h1>
          <p className="text-gray-500 text-sm">
            This ticket link is invalid or has expired.
          </p>
          <Link href="/" className="inline-block mt-6 text-sm font-semibold text-orange-600 hover:underline">
            Browse events →
          </Link>
        </div>
        <Footer />
      </div>
    );
  }

  const event = ticket.event as any;
  const tier = ticket.tier as any;
  const occurrence = ticket.occurrence as any;
  const eventDate = occurrence?.starts_at
    ? formatEventDateTime(occurrence.starts_at, event?.timezone || DEFAULT_TZ, {
        withWeekday: true,
        withYear: true,
        longMonth: true,
      })
    : null;
  const qrDataUrl = await generateQRCodeDataURL(ticket.qr_code_secret, { width: 220 });
  const venue = [event?.venue_name, event?.city].filter(Boolean).join(', ');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="max-w-md mx-auto px-4 sm:px-6 py-12">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold mb-1">You've been sent a ticket</h1>
          <p className="text-gray-500 text-sm">
            Add it to your phone’s wallet or show the QR code at the entrance.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Event + ticket info */}
          <div className="p-6 text-center border-b border-gray-100">
            <h2 className="font-bold text-xl mb-2">{event?.title}</h2>
            <div className="flex flex-col items-center gap-1.5 text-sm text-gray-600">
              {eventDate && (
                <div className="flex items-center gap-1.5">
                  <Calendar size={14} />
                  {eventDate}
                </div>
              )}
              {venue && (
                <div className="flex items-center gap-1.5">
                  <MapPin size={14} />
                  {venue}
                </div>
              )}
            </div>
          </div>

          {/* QR */}
          <div className="p-6 flex flex-col items-center">
            <img
              src={qrDataUrl}
              alt="Ticket QR code"
              width={180}
              height={180}
              className="rounded-lg"
              style={{ imageRendering: 'crisp-edges' }}
            />
            <p className="text-orange-600 font-semibold text-sm mt-4">
              {tier?.name || 'General Admission'}
            </p>
            {ticket.seat_label && (
              <p className="text-sm text-gray-600 mt-1">
                Seat <span className="font-semibold text-gray-900">{ticket.seat_label}</span>
              </p>
            )}
          </div>

          {/* Wallet buttons */}
          <div className="px-6 pb-6 flex flex-col items-center gap-3">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Add to your wallet</p>
            <div className="flex flex-wrap gap-3 justify-center">
              <a href={`/api/wallet/apple/share/${ticket.qr_code_secret}`}>
                <img src="/wallet/add-to-apple-wallet.svg" alt="Add to Apple Wallet" className="h-11" />
              </a>
              <a href={`/api/wallet/google/share/${ticket.qr_code_secret}`}>
                <img src="/wallet/add-to-google-wallet.svg" alt="Add to Google Wallet" className="h-11" />
              </a>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Each ticket admits one. Powered by Empiria Events.
        </p>
      </div>

      <Footer />
    </div>
  );
}
