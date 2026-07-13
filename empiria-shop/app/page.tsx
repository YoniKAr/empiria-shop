import type { Metadata } from 'next';
import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import HomeContent from '@/app/components/HomeContent';
import { absoluteUrl } from '@/lib/seo';

export const metadata: Metadata = {
    title: 'Empiria Events — Discover Cultural Events & Buy Tickets',
    description:
        'Discover and buy tickets to multicultural events across Canada — Greek, Italian, Indian, Chinese, Middle Eastern, Latin American, and more, plus the GIFFT film festival.',
    alternates: { canonical: '/' },
    openGraph: {
        title: 'Empiria Events — Discover Cultural Events & Buy Tickets',
        description:
            'Discover and buy tickets to multicultural events across Canada, plus the GIFFT film festival.',
        url: absoluteUrl('/'),
        type: 'website',
    },
};

// City slug rule (kept in sync with the /city/[citySlug] pages): lowercase,
// trim, strip diacritics, collapse non-alphanumerics to single hyphens.
function toCitySlug(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export default async function ShopHome({
    searchParams,
}: {
    searchParams: Promise<{ category?: string }>;
}) {
    const supabase = getSupabaseAdmin();
    const { category: activeCategory } = await searchParams;

    // Fetch featured events (up to 5) for the hero slideshow
    const { data: rawFeatured } = await supabase
        .from('events')
        .select(`
      id, title, slug, cover_image_url, timezone,
      venue_name, city, currency,
      categories (name),
      event_occurrences (starts_at)
    `)
        .eq('status', 'published')
        .eq('visibility', 'public')
        .eq('is_featured', true)
        .eq('event_type', 'event')
        .order('created_at', { ascending: false })
        .limit(5);

    // Fetch ALL published events for the grid (safety cap only). The category
    // pills filter these CLIENT-SIDE for a smooth, instant experience (no page
    // navigation), and client search must see every event — so we never filter
    // by category server-side here. The dedicated /category/[slug] pages exist
    // separately for SEO. `activeCategory` (from ?category=) only sets the pill
    // that's pre-selected on load.
    const eventsQuery = supabase
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
        .eq('event_type', 'event')
        .order('created_at', { ascending: false })
        .limit(500);

    const { data: realEvents } = await eventsQuery;

    // Batch-fetch organizer names for all events
    let events: any[] = [];
    if (realEvents && realEvents.length > 0) {
        const organizerIds = [...new Set(realEvents.map((e: any) => e.organizer_id).filter(Boolean))];
        const { data: profiles } = organizerIds.length > 0
            ? await supabase
                .from('users')
                .select('auth0_id, full_name, role, avatar_url')
                .in('auth0_id', organizerIds)
            : { data: [] };

        const profileMap: Record<string, string> = {};
        const roleMap: Record<string, string> = {};
        const avatarMap: Record<string, string | null> = {};
        (profiles || []).forEach((p: any) => { profileMap[p.auth0_id] = p.full_name; roleMap[p.auth0_id] = p.role; avatarMap[p.auth0_id] = p.avatar_url || null; });

        // Shared platform avatar (admin-managed) for platform-owned events.
        const { data: platformSetting } = await supabase
            .from('platform_settings')
            .select('value')
            .eq('key', 'platform_avatar_url')
            .maybeSingle();
        const platformAvatarUrl = (platformSetting?.value as { url?: string | null } | null)?.url || null;

        // Batch-fetch visible co-organizer counts per event.
        const eventIds = realEvents.map((e: any) => e.id);
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

        const now = Date.now();
        events = realEvents.map((e: any) => {
            const occs = [...(e.event_occurrences || [])].sort(
                (a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
            );
            const nextFuture = occs.find((o: any) => new Date(o.starts_at).getTime() >= now);
            return {
                ...e,
                event_occurrences: occs,
                _nextFutureTs: nextFuture ? new Date(nextFuture.starts_at).getTime() : null,
                organizer_name: roleMap[e.organizer_id] === 'admin'
                    ? 'Empiria Events'
                    : (profileMap[e.organizer_id] || 'Empiria Events'),
                organizer_avatar_url: roleMap[e.organizer_id] === 'admin'
                    ? platformAvatarUrl
                    : (avatarMap[e.organizer_id] || null),
                co_host_count: coHostCountMap[e.id] || 0,
            };
        });

        // Order by event DATE, not created_at: soonest UPCOMING event first,
        // past events last (matches the category pages).
        events.sort((a: any, b: any) => {
            if (a._nextFutureTs != null && b._nextFutureTs != null) return a._nextFutureTs - b._nextFutureTs;
            if (a._nextFutureTs != null) return -1;
            if (b._nextFutureTs != null) return 1;
            // Both past → most recent past date first.
            const aLast = a.event_occurrences?.[a.event_occurrences.length - 1]?.starts_at;
            const bLast = b.event_occurrences?.[b.event_occurrences.length - 1]?.starts_at;
            return new Date(bLast || 0).getTime() - new Date(aLast || 0).getTime();
        });
    }

    // Fetch active categories that are enabled for the landing page filter buttons
    const { data: categories } = await supabase
        .from('categories')
        .select('id, name, slug')
        .eq('is_active', true)
        .eq('show_on_landing', true)
        .order('name');

    const featuredEvents = (rawFeatured || []) as any[];

    // Distinct cities for the crawlable "Browse events by city" section —
    // derived from the events already fetched above (no extra query). Deduped
    // case-insensitively by slug (most common casing wins), sorted by count.
    const cityStats = new Map<string, { count: number; casings: Map<string, number> }>();
    for (const e of events) {
        const city = typeof e.city === 'string' ? e.city.trim() : '';
        if (!city) continue;
        const slug = toCitySlug(city);
        if (!slug) continue;
        const entry = cityStats.get(slug) || { count: 0, casings: new Map<string, number>() };
        entry.count += 1;
        entry.casings.set(city, (entry.casings.get(city) || 0) + 1);
        cityStats.set(slug, entry);
    }
    const browseCities = [...cityStats.entries()]
        .map(([slug, { count, casings }]) => ({
            slug,
            count,
            name: [...casings.entries()].sort((a, b) => b[1] - a[1])[0][0],
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 16);

    return (
        <div className="min-h-screen bg-white font-sans text-slate-900">
            <Navbar overlay />
            <HomeContent
                events={events}
                featuredEvents={featuredEvents}
                categories={(categories || []) as { id: string; name: string; slug: string }[]}
                activeCategory={activeCategory ?? null}
            />
            {/* Server-rendered (crawlable) internal links to the city browse pages. */}
            {browseCities.length > 0 && (
                <section className="w-full bg-white">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 text-left">
                        <h2 className="text-2xl font-bold text-[#F15A29] mb-6">Browse events by city</h2>
                        <div className="flex flex-wrap gap-2">
                            {browseCities.map((c) => (
                                <Link
                                    key={c.slug}
                                    href={`/city/${c.slug}`}
                                    className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-gray-200 bg-white text-sm font-medium text-slate-700 hover:border-[#F15A29] hover:text-[#F15A29] transition-colors"
                                >
                                    {c.name}
                                    <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-[#F15A29]/10 text-xs font-semibold text-[#F15A29]">
                                        {c.count}
                                    </span>
                                </Link>
                            ))}
                        </div>
                    </div>
                </section>
            )}
            <Footer />
        </div>
    );
}
