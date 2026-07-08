import type { Metadata } from 'next';
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

        events = realEvents.map((e: any) => ({
            ...e,
            event_occurrences: [...(e.event_occurrences || [])].sort(
                (a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
            ),
            organizer_name: roleMap[e.organizer_id] === 'admin'
                ? 'Empiria Events'
                : (profileMap[e.organizer_id] || 'Empiria Events'),
            organizer_avatar_url: roleMap[e.organizer_id] === 'admin'
                ? platformAvatarUrl
                : (avatarMap[e.organizer_id] || null),
            co_host_count: coHostCountMap[e.id] || 0,
        }));
    }

    // Fetch active categories that are enabled for the landing page filter buttons
    const { data: categories } = await supabase
        .from('categories')
        .select('id, name, slug')
        .eq('is_active', true)
        .eq('show_on_landing', true)
        .order('name');

    const featuredEvents = (rawFeatured || []) as any[];

    return (
        <div className="min-h-screen bg-white font-sans text-slate-900">
            <Navbar overlay />
            <HomeContent
                events={events}
                featuredEvents={featuredEvents}
                categories={(categories || []) as { id: string; name: string; slug: string }[]}
                activeCategory={activeCategory ?? null}
            />
            <Footer />
        </div>
    );
}
