import { getSupabaseAdmin } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
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
        .eq('is_featured', true)
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
        .order('created_at', { ascending: false })
        .limit(12);

    // Batch-fetch organizer names for all events
    let events: any[] = [];
    if (realEvents && realEvents.length > 0) {
        const organizerIds = [...new Set(realEvents.map((e: any) => e.organizer_id).filter(Boolean))];
        const { data: profiles } = organizerIds.length > 0
            ? await supabase
                .from('users')
                .select('auth0_id, full_name')
                .in('auth0_id', organizerIds)
            : { data: [] };

        const profileMap: Record<string, string> = {};
        (profiles || []).forEach((p: any) => { profileMap[p.auth0_id] = p.full_name; });

        events = realEvents.map((e: any) => ({
            ...e,
            organizer_name: e.source_app === 'admin'
                ? 'Empiria Events'
                : (profileMap[e.organizer_id] || 'Empiria Events'),
        }));
    }

    const featuredEvents = (rawFeatured || []) as any[];

    return (
        <div className="min-h-screen bg-white font-sans text-slate-900">
            <Navbar />
            <HomeContent events={events} featuredEvents={featuredEvents} />
        </div>
    );
}
