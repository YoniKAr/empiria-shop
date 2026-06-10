import { getSupabaseAdmin } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import HomeContent from '@/app/components/HomeContent';

export default async function ShopHome() {
    const supabase = getSupabaseAdmin();

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

    // Fetch upcoming events for the grid
    const { data: realEvents } = await supabase
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
        .eq('event_type', 'event')
        .order('created_at', { ascending: false })
        .limit(12);

    // Batch-fetch organizer names for all events
    let events: any[] = [];
    if (realEvents && realEvents.length > 0) {
        const organizerIds = [...new Set(realEvents.map((e: any) => e.organizer_id).filter(Boolean))];
        const { data: profiles } = organizerIds.length > 0
            ? await supabase
                .from('users')
                .select('auth0_id, full_name, role')
                .in('auth0_id', organizerIds)
            : { data: [] };

        const profileMap: Record<string, string> = {};
        const roleMap: Record<string, string> = {};
        (profiles || []).forEach((p: any) => { profileMap[p.auth0_id] = p.full_name; roleMap[p.auth0_id] = p.role; });

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
            co_host_count: coHostCountMap[e.id] || 0,
        }));
    }

    // Fetch active categories that are enabled for the landing page filter buttons
    const { data: categories } = await supabase
        .from('categories')
        .select('id, name')
        .eq('is_active', true)
        .eq('show_on_landing', true)
        .order('name');

    const featuredEvents = (rawFeatured || []) as any[];

    return (
        <div className="min-h-screen bg-white font-sans text-slate-900">
            <Navbar overlay />
            <HomeContent events={events} featuredEvents={featuredEvents} categories={(categories || []) as { id: string; name: string }[]} />
            <Footer />
        </div>
    );
}
