import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { EventCard } from '@/app/components/EventCard';
import { getCurrencySymbol } from '@/lib/utils';
import JsonLd from '@/components/JsonLd';
import { absoluteUrl, truncate, buildBreadcrumbJsonLd, buildEventJsonLd, stripToText } from '@/lib/seo';
import { slugifyCity } from '@/lib/browse';

export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    const { slug } = await params;
    const supabase = getSupabaseAdmin();

    const { data: category } = await supabase
        .from('categories')
        .select('id, name, slug, is_active')
        .eq('slug', slug)
        .maybeSingle();

    if (!category || !category.is_active) {
        return { title: 'Category Not Found' };
    }

    const title = `${category.name} Events in Canada`;
    const description = truncate(
        `Discover and buy tickets to all ${category.name} events across Canada with Empiria Events — upcoming ${category.name} celebrations, festivals, and experiences in every city.`,
        160
    );
    const url = absoluteUrl(`/category/${category.slug}`);

    return {
        title,
        description,
        alternates: { canonical: `/category/${category.slug}` },
        openGraph: {
            title,
            description,
            url,
            type: 'website',
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
        },
    };
}

export default async function CategoryPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const supabase = getSupabaseAdmin();

    const { data: category } = await supabase
        .from('categories')
        .select('id, name, slug, is_active')
        .eq('slug', slug)
        .maybeSingle();

    if (!category || !category.is_active) {
        notFound();
    }

    // Fetch published + public standard events in this category. Extra fields
    // (description, address_text, location_type, meeting_link, occurrence
    // ends_at) let us emit COMPLETE per-event Event JSON-LD on this listing page.
    const { data: rawEvents } = await supabase
        .from('events')
        .select(`
      id, title, slug, cover_image_url, timezone,
      venue_name, city, address_text, location_type, meeting_link,
      currency, organizer_id, source_app, entry_type, description,
      categories (name),
      ticket_tiers (price),
      event_occurrences (starts_at, ends_at)
    `)
        .eq('status', 'published')
        .eq('visibility', 'public')
        .in('event_type', ['event', 'gifft_event'])
        .eq('category_id', category.id);

    // Order client-side by soonest UPCOMING occurrence: sort each event's
    // occurrences ascending, take earliest FUTURE starts_at; events with a
    // future date first (ascending), then everything else.
    const now = Date.now();
    const withSort = (rawEvents || []).map((e: any) => {
        const occs = [...(e.event_occurrences || [])].sort(
            (a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
        );
        const nextFuture = occs.find((o: any) => new Date(o.starts_at).getTime() >= now);
        return {
            ...e,
            event_occurrences: occs,
            _nextFutureTs: nextFuture ? new Date(nextFuture.starts_at).getTime() : null,
        };
    });
    withSort.sort((a: any, b: any) => {
        if (a._nextFutureTs != null && b._nextFutureTs != null) return a._nextFutureTs - b._nextFutureTs;
        if (a._nextFutureTs != null) return -1;
        if (b._nextFutureTs != null) return 1;
        return 0;
    });

    // Batch-fetch organizer names/roles/avatars + platform avatar + co-host counts.
    let events: any[] = [];
    if (withSort.length > 0) {
        const organizerIds = [...new Set(withSort.map((e: any) => e.organizer_id).filter(Boolean))];
        const { data: profiles } = organizerIds.length > 0
            ? await supabase
                .from('users')
                .select('auth0_id, full_name, role, avatar_url')
                .in('auth0_id', organizerIds)
            : { data: [] };

        const profileMap: Record<string, string> = {};
        const roleMap: Record<string, string> = {};
        const avatarMap: Record<string, string | null> = {};
        (profiles || []).forEach((p: any) => {
            profileMap[p.auth0_id] = p.full_name;
            roleMap[p.auth0_id] = p.role;
            avatarMap[p.auth0_id] = p.avatar_url || null;
        });

        // Shared platform avatar (admin-managed) for platform-owned events.
        const { data: platformSetting } = await supabase
            .from('platform_settings')
            .select('value')
            .eq('key', 'platform_avatar_url')
            .maybeSingle();
        const platformAvatarUrl = (platformSetting?.value as { url?: string | null } | null)?.url || null;

        // Batch-fetch visible co-organizer counts per event.
        const eventIds = withSort.map((e: any) => e.id);
        const { data: coOrgRows } = eventIds.length > 0
            ? await supabase
                .from('event_organizers')
                .select('event_id')
                .in('event_id', eventIds)
                .eq('is_visible', true)
            : { data: [] };

        const coHostCountMap: Record<string, number> = {};
        (coOrgRows || []).forEach((r: any) => {
            coHostCountMap[r.event_id] = (coHostCountMap[r.event_id] || 0) + 1;
        });

        events = withSort.map((e: any) => ({
            ...e,
            organizer_name: roleMap[e.organizer_id] === 'admin'
                ? 'Empiria Events'
                : (profileMap[e.organizer_id] || 'Empiria Events'),
            organizer_avatar_url: roleMap[e.organizer_id] === 'admin'
                ? platformAvatarUrl
                : (avatarMap[e.organizer_id] || null),
            co_host_count: coHostCountMap[e.id] || 0,
        }));
    }

    // Cities represented in this category → crawlable "By city" chip links to
    // the programmatic /city/{city}/{category} SEO pages.
    const cityChipMap = new Map<string, { name: string; slug: string; count: number }>();
    for (const e of withSort) {
        const raw = (e.city || '').trim();
        const citySlug = slugifyCity(raw);
        if (!citySlug) continue;
        const cur = cityChipMap.get(citySlug);
        if (cur) cur.count += 1;
        else cityChipMap.set(citySlug, { name: raw, slug: citySlug, count: 1 });
    }
    const cityChips = [...cityChipMap.values()].sort(
        (a, b) => b.count - a.count || a.name.localeCompare(b.name)
    );

    // Summary-page ItemList of the event URLs (list order/semantics).
    const itemListJsonLd = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: `${category.name} Events`,
        itemListElement: events.map((e: any, i: number) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: absoluteUrl('/events/' + e.slug),
        })),
    };

    // COMPLETE Event JSON-LD per event, rendered directly on this listing page so
    // Google detects every event here (not only on the individual detail pages).
    // Uses the same warning-free builder as /events/[slug] — all recommended
    // fields present (image, description, dates+tz, location, offers, organizer,
    // performer) so Search Console reports them as valid, not "missing fields".
    const supabaseBase = process.env.SUPABASE_URL || '';
    const eventJsonLd = events.map((e: any) => {
        const occs = e.event_occurrences || [];
        const nextOcc = occs.find((o: any) => new Date(o.starts_at).getTime() >= now) || occs[0];
        const prices = (e.ticket_tiers || []).map((t: any) => t.price).filter((p: any) => p != null);
        const minPrice = prices.length ? Math.min(...prices) : null;
        const isExternal = e.entry_type === 'external';
        const isOnline = e.location_type === 'online';
        const cover = e.cover_image_url
            ? (/^https?:\/\//i.test(e.cover_image_url)
                ? e.cover_image_url
                : `${supabaseBase}/storage/v1/object/public/${e.cover_image_url}`)
            : undefined;
        return buildEventJsonLd({
            name: e.title,
            description: stripToText(e.description),
            image: cover,
            startDate: nextOcc?.starts_at,
            endDate: nextOcc?.ends_at || nextOcc?.starts_at,
            timeZone: e.timezone || undefined,
            url: absoluteUrl('/events/' + e.slug),
            isOnline,
            onlineUrl: e.meeting_link || undefined,
            venueName: e.venue_name,
            addressText: e.address_text,
            city: e.city,
            price: isExternal ? null : minPrice,
            priceCurrency: (e.currency || 'cad').toUpperCase(),
            offerValidFrom: new Date().toISOString(),
            organizerName: e.organizer_name,
            includePerformer: true,
            omitOffers: isExternal,
        });
    });

    return (
        <div className="min-h-screen bg-white font-sans text-slate-900">
            <Navbar />
            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">{category.name} Events</h1>
                <p className="text-gray-700 mb-8 max-w-2xl">
                    Discover and buy tickets to all {category.name} events across Canada with Empiria Events.
                </p>

                {/* Crawlable "By city" chips → /city/{city}/{category} combo pages. */}
                {cityChips.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-8">
                        {cityChips.map((c) => (
                            <Link
                                key={c.slug}
                                href={`/city/${c.slug}/${category.slug}`}
                                className="inline-flex items-center gap-1.5 border border-gray-200 rounded-full px-4 py-1.5 text-sm font-medium text-slate-900 hover:border-[#F15A29] hover:text-[#F15A29] transition-colors"
                            >
                                {category.name} in {c.name}
                                <span className="text-xs text-gray-500">({c.count})</span>
                            </Link>
                        ))}
                    </div>
                )}

                {events.length === 0 ? (
                    <p className="text-gray-700">
                        No {category.name} events right now — check back soon.
                    </p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {events.map((e: any) => {
                            const prices = e.ticket_tiers?.map((t: any) => t.price) || [];
                            const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
                            const symbol = getCurrencySymbol(e.currency || 'cad');
                            const startAt = e.event_occurrences?.[0]?.starts_at || undefined;

                            return (
                                <EventCard
                                    key={e.id}
                                    id={e.id}
                                    title={e.title}
                                    slug={e.slug}
                                    coverImageUrl={e.cover_image_url}
                                    venueName={e.venue_name}
                                    city={e.city}
                                    category={e.categories?.name}
                                    startAt={startAt}
                                    timezone={e.timezone}
                                    minPrice={minPrice}
                                    currencySymbol={symbol}
                                    organizerName={e.organizer_name}
                                    organizerAvatarUrl={e.organizer_avatar_url}
                                    coHostCount={e.co_host_count}
                                    entryType={e.entry_type}
                                />
                            );
                        })}
                    </div>
                )}
            </main>
            <Footer />

            <JsonLd data={itemListJsonLd} />
            <JsonLd
                data={buildBreadcrumbJsonLd([
                    { name: 'Home', url: absoluteUrl('/') },
                    { name: category.name, url: absoluteUrl('/category/' + category.slug) },
                ])}
            />
            {/* One complete Event block per event → Google detects every event
                on this listing page ("Events: N valid items detected"). */}
            {eventJsonLd.map((data: Record<string, unknown>, i: number) => (
                <JsonLd key={events[i].id} data={data} />
            ))}
        </div>
    );
}
