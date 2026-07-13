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
import {
    findCityBySlug,
    getCityEvents,
    enrichEventsForCards,
    PUBLIC_EVENT_STATUS,
    PUBLIC_EVENT_VISIBILITY,
    PUBLIC_EVENT_TYPES,
} from '@/lib/browse';

// Regenerate at most hourly — new events/cities appear without a rebuild.
export const revalidate = 3600;

/** Resolve an active category by slug (inactive/missing → null). */
async function getActiveCategory(slug: string) {
    const supabase = getSupabaseAdmin();
    const { data: category } = await supabase
        .from('categories')
        .select('id, name, slug, is_active')
        .eq('slug', slug)
        .maybeSingle();
    if (!category || !category.is_active) return null;
    return category;
}

export async function generateMetadata({
    params,
}: {
    params: Promise<{ city: string; category: string }>;
}): Promise<Metadata> {
    const { city: citySlug, category: categorySlug } = await params;
    const [resolved, category] = await Promise.all([
        findCityBySlug(citySlug),
        getActiveCategory(categorySlug),
    ]);
    if (!resolved || !category) {
        return { title: 'Page Not Found' };
    }

    const events = await getCityEvents(resolved.matches, category.id);

    const title = `${category.name} Events in ${resolved.display}`;
    const description = truncate(
        events.length > 0
            ? `Discover ${events.length} upcoming ${category.name} event${events.length === 1 ? '' : 's'} in ${resolved.display} — buy tickets to ${category.name} celebrations, festivals, and experiences with Empiria Events.`
            : `Discover upcoming ${category.name} events in ${resolved.display} with Empiria Events — new ${category.name} celebrations and festivals are added regularly.`,
        160
    );
    const url = absoluteUrl(`/city/${citySlug}/${category.slug}`);

    // First available cover image (may be a storage path) → absolute OG image.
    const supabaseBase = process.env.SUPABASE_URL || '';
    const firstCover = events.find((e: any) => e.cover_image_url)?.cover_image_url;
    const ogImage = firstCover
        ? (/^https?:\/\//i.test(firstCover)
            ? firstCover
            : `${supabaseBase}/storage/v1/object/public/${firstCover}`)
        : undefined;

    return {
        title,
        description,
        alternates: { canonical: `/city/${citySlug}/${category.slug}` },
        // A resolvable combo with 0 upcoming events still renders, but shouldn't
        // be indexed until it has events again.
        ...(events.length === 0 ? { robots: { index: false, follow: true } } : {}),
        openGraph: {
            title,
            description,
            url,
            type: 'website',
            ...(ogImage ? { images: [{ url: ogImage }] } : {}),
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
        },
    };
}

export default async function CityCategoryPage({
    params,
}: {
    params: Promise<{ city: string; category: string }>;
}) {
    const { city: citySlug, category: categorySlug } = await params;
    const [resolved, category] = await Promise.all([
        findCityBySlug(citySlug),
        getActiveCategory(categorySlug),
    ]);
    if (!resolved || !category) {
        notFound();
    }

    const upcoming = await getCityEvents(resolved.matches, category.id);
    const events = await enrichEventsForCards(upcoming);

    // Sibling categories with ≥1 UPCOMING event in this city (light query — just
    // category + occurrence dates), for the crawlable chips row below.
    const supabase = getSupabaseAdmin();
    const { data: cityCatRows } = await supabase
        .from('events')
        .select('categories (name, slug), event_occurrences (starts_at)')
        .eq('status', PUBLIC_EVENT_STATUS)
        .eq('visibility', PUBLIC_EVENT_VISIBILITY)
        .in('event_type', PUBLIC_EVENT_TYPES)
        .in('city', resolved.matches);

    const now = Date.now();
    const siblingMap = new Map<string, { name: string; slug: string; count: number }>();
    for (const row of cityCatRows || []) {
        const cat = (row as any).categories;
        if (!cat?.slug || cat.slug === category.slug) continue;
        const occs = (row as any).event_occurrences || [];
        const hasFuture = occs.some((o: any) => new Date(o.starts_at).getTime() >= now);
        if (!hasFuture) continue;
        const cur = siblingMap.get(cat.slug);
        if (cur) cur.count += 1;
        else siblingMap.set(cat.slug, { name: cat.name, slug: cat.slug, count: 1 });
    }
    const siblingChips = [...siblingMap.values()].sort(
        (a, b) => b.count - a.count || a.name.localeCompare(b.name)
    );

    // Summary-page ItemList of the event URLs (list order/semantics).
    const itemListJsonLd = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: `${category.name} Events in ${resolved.display}`,
        itemListElement: events.map((e: any, i: number) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: absoluteUrl('/events/' + e.slug),
        })),
    };

    // COMPLETE Event JSON-LD per event, rendered directly on this listing page so
    // Google detects every event here (not only on the individual detail pages).
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
                <h1 className="text-3xl font-bold text-slate-900 mb-2">
                    {category.name} Events in {resolved.display}
                </h1>
                <p className="text-gray-700 mb-6 max-w-2xl">
                    Discover and buy tickets to upcoming {category.name} events in {resolved.display}{' '}
                    with Empiria Events — celebrations, festivals, and experiences.
                </p>

                {/* Crawlable chips: back to the city page, this culture nationwide,
                    and sibling cultures in the same city. */}
                <div className="flex flex-wrap gap-2 mb-8">
                    <Link
                        href={`/city/${citySlug}`}
                        className="inline-flex items-center gap-1.5 border border-gray-200 rounded-full px-4 py-1.5 text-sm font-medium text-slate-900 hover:border-[#F15A29] hover:text-[#F15A29] transition-colors"
                    >
                        All events in {resolved.display}
                    </Link>
                    <Link
                        href={`/category/${category.slug}`}
                        className="inline-flex items-center gap-1.5 border border-gray-200 rounded-full px-4 py-1.5 text-sm font-medium text-slate-900 hover:border-[#F15A29] hover:text-[#F15A29] transition-colors"
                    >
                        {category.name} events in all cities
                    </Link>
                    {siblingChips.map((c) => (
                        <Link
                            key={c.slug}
                            href={`/city/${citySlug}/${c.slug}`}
                            className="inline-flex items-center gap-1.5 border border-gray-200 rounded-full px-4 py-1.5 text-sm font-medium text-slate-900 hover:border-[#F15A29] hover:text-[#F15A29] transition-colors"
                        >
                            {c.name}
                            <span className="text-xs text-gray-500">({c.count})</span>
                        </Link>
                    ))}
                </div>

                {events.length === 0 ? (
                    <p className="text-gray-700">
                        No upcoming {category.name} events in {resolved.display} right now — check back soon.
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
                    { name: `Events in ${resolved.display}`, url: absoluteUrl('/city/' + citySlug) },
                    {
                        name: `${category.name} Events in ${resolved.display}`,
                        url: absoluteUrl(`/city/${citySlug}/${category.slug}`),
                    },
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
