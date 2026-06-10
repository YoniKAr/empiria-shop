import { getSafeSession } from '@/lib/auth0';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getCurrencySymbol } from '@/lib/utils';
import { notFound } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { EventHero } from '@/app/components/EventHero';
import { EventDetails } from '@/app/components/EventDetails';
import SponsorSections from '@/app/components/SponsorSections';
import { EventCard } from '@/app/components/EventCard';
import { TicketWidget } from '@/app/components/TicketWidget';
import ZoneSelector from '@/components/seatmap/ZoneSelector';
import SeatSelector from '@/components/seatmap/SeatSelector';
import AssignedSeatPicker from '@/components/seatmap/AssignedSeatPicker';
import Footer from '@/components/Footer';
import type { SeatingConfig } from '@/lib/seatmap-types';

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const supabase = getSupabaseAdmin();

    // Fetch event + ticket tiers + occurrences
    const { data: event } = await supabase
        .from('events')
        .select('*, categories(name), ticket_tiers(*), event_occurrences(*)')
        .eq('slug', slug)
        .eq('status', 'published')
        .single();

    if (!event) notFound();

    // Compute occurrence-based dates
    const allOccurrences = (event.event_occurrences || [])
        .filter((o: any) => !o.is_cancelled)
        .sort((a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

    const futureOccurrences = allOccurrences.filter(
        (o: any) => new Date(o.starts_at) > new Date()
    );

    const firstOcc = allOccurrences[0];
    const isPast = allOccurrences.length > 0 && futureOccurrences.length === 0;

    const heroStartAt = firstOcc?.starts_at || event.start_at || new Date().toISOString();
    const heroEndAt = firstOcc?.ends_at || event.end_at || heroStartAt;
    const categoryName = (event as any).categories?.name || 'Event';

    // Look up the event owner's name from the users table
    const { data: ownerProfile } = event.organizer_id
        ? await supabase
            .from('users')
            .select('full_name')
            .eq('auth0_id', event.organizer_id)
            .single()
        : { data: null };

    const organizer = event.source_app === 'admin'
        ? 'Empiria Events'
        : (ownerProfile?.full_name || 'Empiria Events');

    // Gallery images: prefer the stored gallery_images column; otherwise fall
    // back to listing the storage bucket (for older events created before the
    // column was populated).
    let galleryUrls: string[] = Array.isArray((event as any).gallery_images)
        ? ((event as any).gallery_images as string[]).filter(Boolean)
        : [];

    if (galleryUrls.length === 0) {
        const safeOrganizerId = event.organizer_id?.replace(/\|/g, '_');

        const possiblePaths = [
            `${String(event.id)}`,
            `${event.slug}`,
            safeOrganizerId ? `${safeOrganizerId}/${String(event.id)}` : '',
            safeOrganizerId ? `${safeOrganizerId}/${event.slug}` : '',
            safeOrganizerId || '',
            ''
        ].filter(Boolean);

        for (const folder of possiblePaths) {
            if (!folder) continue;
            const { data: files } = await supabase.storage
                .from('events_gallery')
                .list(folder, { limit: 50 });

            const urls = (files ?? [])
                .filter((f: any) => f.name && !f.name.startsWith('.') && f.id)
                .map((f: any) => {
                    const path = folder ? `${folder}/${f.name}` : f.name;
                    const { data } = supabase.storage
                        .from('events_gallery')
                        .getPublicUrl(path);
                    return data.publicUrl;
                });

            if (urls.length > 0) {
                galleryUrls = urls;
                break;
            }
        }
    }

    // What to expect from DB
    const whatToExpect: string[] = Array.isArray(event.what_to_expect)
        ? event.what_to_expect
        : [];

    // Shared-capacity pool: in shared mode the EVENT pool is the constraint, not
    // per-tier remaining_quantity (which is seeded to equal the pool).
    const sharedRemaining = Math.max(0, ((event as any).total_capacity ?? 0) - ((event as any).total_tickets_sold ?? 0));

    // Map ticket_tiers to TicketWidget shape
    const tiers = [...(event.ticket_tiers || [])]
        .sort((a: any, b: any) => a.price - b.price)
        .map((tier: any) => ({
            id: String(tier.id),
            name: tier.name,
            description: tier.description ?? '',
            price: tier.price ?? 0,
            available: (event as any).shared_capacity ? sharedRemaining : (tier.remaining_quantity ?? 0),
        }));

    // Resolve cover image to a full URL
    const rawCoverUrl = event.cover_image_url ?? '';
    const coverImageUrl = rawCoverUrl.startsWith('http')
        ? rawCoverUrl
        : rawCoverUrl
            ? `${process.env.SUPABASE_URL}/storage/v1/object/public/${rawCoverUrl}`
            : '';

    // Seating type and config
    const seatingType = (event as any).seating_type || 'general_admission';
    const rawSeatingConfig = (event as any).seating_config;
    const seatingConfig: SeatingConfig | null =
        rawSeatingConfig &&
        typeof rawSeatingConfig === 'object' &&
        (rawSeatingConfig.image_url !== undefined || rawSeatingConfig.seat_ranges !== undefined || rawSeatingConfig.zones !== undefined)
            ? rawSeatingConfig as SeatingConfig
            : null;

    // Sorted tiers for seatmap selectors (same data, different shape)
    const sortedTiers = [...(event.ticket_tiers || [])]
        .sort((a: any, b: any) => a.price - b.price);

    const currency = event.currency || 'cad';
    const currencySymbol = getCurrencySymbol(currency);

    // Get user session
    const session = await getSafeSession();
    const user = session?.user;

    // Fetch similar events (same category or overlapping tags)
    let similarEvents: any[] = [];
    if (event.category_id) {
        const { data: catEvents } = await supabase
            .from('events')
            .select(`
                id, title, slug, cover_image_url,
                venue_name, city, currency, organizer_id, source_app,
                categories (name),
                ticket_tiers (price),
                event_occurrences (starts_at)
            `)
            .eq('status', 'published')
            .eq('visibility', 'public')
            .eq('category_id', event.category_id)
            .neq('id', event.id)
            .order('created_at', { ascending: false })
            .limit(4);
        similarEvents = catEvents || [];
    }

    // If not enough from category, try tag overlap
    if (similarEvents.length < 4 && event.tags && event.tags.length > 0) {
        const existingIds = [event.id, ...similarEvents.map((e: any) => e.id)];
        const { data: tagEvents } = await supabase
            .from('events')
            .select(`
                id, title, slug, cover_image_url,
                venue_name, city, currency, organizer_id, source_app,
                categories (name),
                ticket_tiers (price),
                event_occurrences (starts_at)
            `)
            .eq('status', 'published')
            .eq('visibility', 'public')
            .overlaps('tags', event.tags)
            .not('id', 'in', `(${existingIds.join(',')})`)
            .order('created_at', { ascending: false })
            .limit(4 - similarEvents.length);
        similarEvents = [...similarEvents, ...(tagEvents || [])];
    }

    // Batch-fetch organizer names for similar events
    if (similarEvents.length > 0) {
        const orgIds = [...new Set(similarEvents.map((e: any) => e.organizer_id).filter(Boolean))];
        const { data: profiles } = orgIds.length > 0
            ? await supabase.from('users').select('auth0_id, full_name').in('auth0_id', orgIds)
            : { data: [] };
        const pMap: Record<string, string> = {};
        (profiles || []).forEach((p: any) => { pMap[p.auth0_id] = p.full_name; });
        similarEvents = similarEvents.map((e: any) => ({
            ...e,
            organizer_name: e.source_app === 'admin' ? 'Empiria Events' : (pMap[e.organizer_id] || 'Empiria Events'),
        }));
    }

    return (
        <div className="min-h-screen bg-white">
            <Navbar overlay />

            {/* EventHero banner */}
            <EventHero
                title={event.title}
                coverImageUrl={coverImageUrl}
                startAt={heroStartAt}
                venueName={event.venue_name}
                city={event.city}
                category={isPast ? 'Past Event' : categoryName}
            />

            {/* Content */}
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 lg:grid-cols-3 gap-12">
                {/* Left: Event details */}
                <div className="lg:col-span-2">
                    <EventDetails
                        description={(() => {
                            if (!event.description) return 'No description provided.';
                            if (typeof event.description === 'object') {
                                return (event.description as any)?.text || JSON.stringify(event.description);
                            }
                            try {
                                const parsed = JSON.parse(event.description as string);
                                return parsed?.text || event.description;
                            } catch {
                                return event.description as string;
                            }
                        })()}
                        startAt={heroStartAt}
                        endAt={heroEndAt}
                        venueName={event.venue_name}
                        city={event.city}
                        addressText={event.address_text}
                        organizer={organizer}
                        galleryUrls={galleryUrls}
                        whatToExpect={whatToExpect}
                        trailerUrl={(event as any).trailer_url || ''}
                    />
                </div>

                {/* Right: Ticket / Seat selection widget */}
                <div>
                    {isPast ? (
                        <div className="border border-gray-200 rounded-xl p-6 bg-gray-50 text-center">
                            <p className="text-gray-500 font-medium">This event has ended</p>
                        </div>
                    ) : seatingType === 'assigned_seating' && seatingConfig ? (
                        <AssignedSeatPicker
                            seatRanges={seatingConfig.seat_ranges || []}
                            tiers={sortedTiers}
                            eventId={event.id}
                            eventCurrency={currency}
                            currencySymbol={currencySymbol}
                            userEmail={user?.email}
                            userName={user?.name}
                            allowSeatChoice={seatingConfig.allow_seat_choice ?? false}
                            occurrences={futureOccurrences.map((o: any) => ({
                                id: o.id,
                                starts_at: o.starts_at,
                                ends_at: o.ends_at,
                                label: o.label || '',
                            }))}
                        />
                    ) : seatingType === 'zone_admission' && seatingConfig ? (
                        <ZoneSelector
                            config={seatingConfig}
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
                    ) : seatingType === 'zone_map' && seatingConfig ? (
                        <ZoneSelector
                            config={seatingConfig}
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
                    ) : seatingType === 'seat_map' && seatingConfig ? (
                        <SeatSelector
                            config={seatingConfig}
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
                    ) : (
                        <TicketWidget
                            tiers={tiers}
                            eventId={String(event.id)}
                            currency={currency}
                            ctaLabel={event.cta_label}
                            entryType={event.entry_type}
                            externalUrl={event.external_url}
                            sharedCapacity={!!(event as any).shared_capacity}
                        />
                    )}
                </div>
            </div>

            {/* Sponsors */}
            <SponsorSections sections={(event as any).sponsor_sections ?? []} />

            {/* Similar Events */}
            {similarEvents.length > 0 && (
                <div className="border-t border-gray-100 bg-gray-50/50">
                    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
                        <h2 className="text-2xl font-bold text-slate-900 mb-8">You Might Also Like</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                            {similarEvents.map((se: any) => {
                                const prices = se.ticket_tiers?.map((t: any) => t.price) || [];
                                const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
                                const sym = getCurrencySymbol(se.currency || 'cad');
                                const occs = se.event_occurrences || [];
                                const startAt = occs[0]?.starts_at || undefined;

                                return (
                                    <EventCard
                                        key={se.id}
                                        id={se.id}
                                        title={se.title}
                                        slug={se.slug}
                                        coverImageUrl={se.cover_image_url}
                                        venueName={se.venue_name}
                                        city={se.city}
                                        category={se.categories?.name}
                                        startAt={startAt}
                                        minPrice={minPrice}
                                        currencySymbol={sym}
                                        organizerName={se.organizer_name}
                                    />
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            <Footer />
        </div>
    );
}
