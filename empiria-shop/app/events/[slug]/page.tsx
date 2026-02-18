// ──────────────────────────────────────────────────
// 📁 app/events/[slug]/page.tsx — REPLACE your existing file
// Updated to include the TicketSelector component
// ──────────────────────────────────────────────────

import { auth0 } from '@/lib/auth0';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getCurrencySymbol } from '@/lib/utils';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Calendar, MapPin, Clock, Users, ArrowLeft, Ticket } from 'lucide-react';
import TicketSelector from '@/components/TicketSelector';

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();

  // Fetch event + ticket tiers
  const { data: event } = await supabase
    .from('events')
    .select('*, ticket_tiers(*)')
    .eq('slug', slug)
    .single();

  if (!event) notFound();

  // Get session for pre-filling user info
  const session = await auth0.getSession();
  const user = session?.user;

  const currency = event.currency || 'cad';
  const currencySymbol = getCurrencySymbol(currency);

  // Sort tiers by price ascending
  const sortedTiers = [...(event.ticket_tiers || [])].sort(
    (a: any, b: any) => a.price - b.price
  );

  // Calculate some display info
  const lowestPrice = sortedTiers.length > 0 ? sortedTiers[0].price : 0;
  const totalRemaining = sortedTiers.reduce(
    (sum: number, t: any) => sum + (t.remaining_quantity || 0),
    0
  );

  const eventDate = new Date(event.start_at);
  const endDate = new Date(event.end_at);
  const isPast = endDate < new Date();

  return (
    <div className="min-h-screen bg-white">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="bg-black text-white p-1.5 rounded-lg">
              <Ticket size={20} />
            </div>
            <span className="font-bold text-xl tracking-tight">Empiria</span>
          </Link>
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium hidden sm:block">
                  Hi, {user.name?.split(' ')[0]}
                </span>
                <a
                  href="https://profile.empiriaindia.com"
                  className="w-8 h-8 rounded-full bg-gray-100 overflow-hidden border border-gray-200"
                >
                  {user.picture && (
                    <img src={user.picture} alt="Profile" className="w-full h-full object-cover" />
                  )}
                </a>
              </div>
            ) : (
              <a
                href="https://auth.empiriaindia.com/auth/login?returnTo=https://shop.empiriaindia.com"
                className="text-sm font-bold bg-black text-white px-5 py-2.5 rounded-full hover:bg-gray-800 transition-colors"
              >
                Sign In
              </a>
            )}
          </div>
        </div>
      </nav>

      {/* Banner */}
      <div className="h-[350px] sm:h-[420px] bg-gray-900 relative">
        {event.cover_image_url && (
          <img
            src={event.cover_image_url}
            alt={event.title}
            className="w-full h-full object-cover opacity-50"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="absolute bottom-0 left-0 w-full p-6 sm:p-10">
          <div className="max-w-5xl mx-auto">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-white/70 hover:text-white text-sm mb-4 transition-colors"
            >
              <ArrowLeft size={14} /> Back to events
            </Link>
            <div className="flex items-center gap-3 mb-3">
              <span className="bg-orange-600 px-3 py-1 rounded text-xs font-bold uppercase tracking-wide text-white">
                {isPast ? 'Past Event' : 'Event'}
              </span>
              {event.city && (
                <span className="bg-white/20 backdrop-blur px-3 py-1 rounded text-xs font-medium text-white">
                  {event.city}
                </span>
              )}
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white mb-4 leading-tight">
              {event.title}
            </h1>
            <div className="flex flex-wrap gap-4 sm:gap-6 text-sm md:text-base font-medium text-white/90">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                {eventDate.toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                {eventDate.toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </div>
              {event.venue_name && (
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4" /> {event.venue_name}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 grid grid-cols-1 md:grid-cols-3 gap-10">
        {/* Left: Event details */}
        <div className="md:col-span-2 space-y-8">
          {/* Quick info bar */}
          <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-xl">
            <div className="flex items-center gap-2 text-sm">
              <Ticket className="w-4 h-4 text-orange-600" />
              <span className="text-gray-600">From</span>
              <span className="font-bold">
                {lowestPrice === 0 ? 'Free' : `${currencySymbol}${lowestPrice.toLocaleString()}`}
              </span>
            </div>
            {totalRemaining > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <Users className="w-4 h-4 text-orange-600" />
                <span className="text-gray-600">{totalRemaining.toLocaleString()} tickets available</span>
              </div>
            )}
          </div>

          {/* About */}
          <div>
            <h2 className="text-2xl font-bold mb-4">About this event</h2>
            <div className="prose max-w-none text-gray-600 leading-relaxed">
              {event.description ? (
                typeof event.description === 'string' ? (
                  <p>{event.description}</p>
                ) : typeof event.description === 'object' && event.description?.text ? (
                  <p>{event.description.text}</p>
                ) : (
                  <p>{JSON.stringify(event.description)}</p>
                )
              ) : (
                <p className="text-gray-400 italic">No description provided.</p>
              )}
            </div>
          </div>

          {/* Venue info */}
          {(event.venue_name || event.address_text) && (
            <div>
              <h2 className="text-2xl font-bold mb-4">Venue</h2>
              <div className="p-5 bg-gray-50 rounded-xl">
                {event.venue_name && (
                  <p className="font-semibold text-lg">{event.venue_name}</p>
                )}
                {event.address_text && (
                  <p className="text-gray-600 mt-1">{event.address_text}</p>
                )}
                {event.city && <p className="text-gray-500 text-sm mt-1">{event.city}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Right: Ticket widget */}
        <div className="relative">
          {isPast ? (
            <div className="border border-gray-200 rounded-xl p-6 bg-gray-50 text-center">
              <p className="text-gray-500 font-medium">This event has ended</p>
            </div>
          ) : (
            <TicketSelector
              tiers={sortedTiers}
              eventId={event.id}
              eventCurrency={currency}
              currencySymbol={currencySymbol}
              userEmail={user?.email}
              userName={user?.name}
            />
          )}
        </div>
      </div>
    </div>
  );
}
