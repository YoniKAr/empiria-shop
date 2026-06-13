import { getSupabaseAdmin } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import HomeContent from '@/app/components/HomeContent';

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
      id, title, slug, cover_image_url,
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

    // Resolve the active category slug → id (so we can filter server-side).
    let activeCategoryId: string | null = null;
    if (activeCategory) {
        const { data: cat } = await supabase
            .from('categories')
            .select('id')
            .eq('slug', activeCategory)
            .maybeSingle();
        activeCategoryId = cat?.id ?? null;
    }

    // Fetch events for the grid.
    // When a category is selected, filter server-side (no 12 cap) so categories
    // with events outside the default page still show their events.
    let eventsQuery = supabase
        .from('events')
        .select(`
      id, title, slug, cover_image_url,
      venue_name, city, currency, organizer_id, source_app, entry_type,
      categories (name),
      ticket_tiers (price),
      event_occurrences (starts_at)
    `)
        .eq('status', 'published')
        .eq('visibility', 'public')
        .eq('event_type', 'event')
        .order('created_at', { ascending: false });

    if (activeCategoryId) {
        eventsQuery = eventsQuery.eq('category_id', activeCategoryId).limit(60);
    } else {
        eventsQuery = eventsQuery.limit(12);
    }

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
