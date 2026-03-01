import { getSafeSession } from '@/lib/auth0';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getCurrencySymbol } from '@/lib/utils';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Calendar, MapPin, Clock, Users, ArrowLeft, Ticket } from 'lucide-react';
import TicketSelector from '@/components/TicketSelector';
import Navbar from '@/components/Navbar';
import { EventHero } from '@/app/components/EventHero';
import { EventDetails } from '@/app/components/EventDetails';

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const supabase = getSupabaseAdmin();

    // Fetch event + ticket tiers + occurrences
    const { data: event } = await supabase
        .from('events')
        .select('*, categories(name), ticket_tiers(*), event_occurrences(*)')
        .eq('slug', slug)
        .single();

    if (!event) notFound();

    // Get session for pre-filling user info
    const session = await getSafeSession();
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

    // Compute occurrence-based dates
    const allOccurrences = (event.event_occurrences || [])
        .filter((o: any) => !o.is_cancelled)
        .sort((a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

    const futureOccurrences = allOccurrences.filter(
        (o: any) => new Date(o.starts_at) > new Date()
    );

    const firstOcc = allOccurrences[0];
    const eventDate = firstOcc ? new Date(firstOcc.starts_at) : null;
    const isPast = allOccurrences.length > 0 && futureOccurrences.length === 0;

    // Derive start/end for EventHero & EventDetails
    const heroStartAt = firstOcc?.starts_at || event.start_at || new Date().toISOString();
    const heroEndAt = firstOcc?.ends_at || event.end_at || heroStartAt;
    const categoryName = (event as any).categories?.name || 'Event';
    const organizer = event.organizer || event.organizer_name || 'Organizer';

    return (
        <div className="min-h-screen bg-white">
            <Navbar />

            {/* EventHero banner */}
            <EventHero
                title={event.title}
                coverImageUrl={event.cover_image_url ?? ''}
                startAt={heroStartAt}
                venueName={event.venue_name}
                city={event.city}
                category={isPast ? 'Past Event' : categoryName}
            />

            {/* Content */}
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 grid grid-cols-1 md:grid-cols-3 gap-10">
                {/* Left: Event details */}
                <div className="md:col-span-2 space-y-8">
                    {/* Quick info bar */}
                    <div className="flex flex-wrap gap-4 p-4 bg-secondary/50 rounded-xl">
                        <div className="flex items-center gap-2 text-sm">
                            <Ticket className="w-4 h-4 text-[#F98C1F]" />
                            <span className="text-muted-foreground">From</span>
                            <span className="font-bold">
                                {lowestPrice === 0 ? 'Free' : `${currencySymbol}${lowestPrice.toLocaleString()}`}
                            </span>
                        </div>
                        {totalRemaining > 0 && (
                            <div className="flex items-center gap-2 text-sm">
                                <Users className="w-4 h-4 text-[#F98C1F]" />
                                <span className="text-muted-foreground">{totalRemaining.toLocaleString()} tickets available</span>
                            </div>
                        )}
                    </div>

                    {/* EventDetails component */}
                    <EventDetails
                        description={
                            event.description
                                ? typeof event.description === 'string'
                                    ? event.description
                                    : typeof event.description === 'object' && (event.description as any)?.text
                                        ? (event.description as any).text
                                        : JSON.stringify(event.description)
                                : 'No description provided.'
                        }
                        startAt={heroStartAt}
                        endAt={heroEndAt}
                        venueName={event.venue_name}
                        city={event.city}
                        organizer={organizer}
                    />
                </div>

                {/* Right: Ticket widget */}
                <div className="relative">
                    {isPast ? (
                        <div className="border border-border rounded-xl p-6 bg-secondary/50 text-center">
                            <p className="text-muted-foreground font-medium">This event has ended</p>
                        </div>
                    ) : (
                        <TicketSelector
                            tiers={sortedTiers}
                            eventId={event.id}
                            eventCurrency={currency}
                            currencySymbol={currencySymbol}
                            userEmail={user?.email}
                            userName={user?.name}
                            occurrences={futureOccurrences.map((o: any) => ({
                                id: o.id,
                                starts_at: o.starts_at,
                                ends_at: o.ends_at,
                                label: o.label || '',
                            }))}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
