import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { EventCard } from '@/app/components/EventCard';
import { getCurrencySymbol } from '@/lib/utils';
import JsonLd from '@/components/JsonLd';
import { absoluteUrl, truncate, buildBreadcrumbJsonLd } from '@/lib/seo';

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
        `Discover and buy tickets to ${category.name} events across Canada with Empiria Events. Browse upcoming ${category.name} celebrations, festivals, and experiences.`,
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

    // Fetch published + public standard events in this category (same columns as home).
    const { data: rawEvents } = await supabase
        .from('events')
        .select(`
      id, title, slug, cover_image_url, timezone,
      venue_name, city, currency, organizer_id, source_app, entry_type,
      categories (name),
      ticket_tiers (price),
      event_occurrences (starts_at)
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

    const itemListJsonLd = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: `${category.name} Events`,
        itemListElement: events.map((e: any, i: number) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: absoluteUrl('/events/' + e.slug),
            name: e.title,
        })),
    };

    return (
        <div className="min-h-screen bg-white font-sans text-slate-900">
            <Navbar />
            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">{category.name} Events</h1>
                <p className="text-gray-700 mb-8 max-w-2xl">
                    Discover and buy tickets to {category.name} events across Canada with Empiria Events.
                </p>

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
        </div>
    );
}
