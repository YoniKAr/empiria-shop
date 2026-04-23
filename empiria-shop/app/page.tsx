import { getSupabaseAdmin } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import EventsGrid from '@/app/components/EventsGrid';

export default async function ShopHome() {
    const supabase = getSupabaseAdmin();

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

    return (
        <div className="min-h-screen bg-white font-sans text-slate-900">
            <Navbar />

            {/* --- HERO SECTION --- */}
            <div className="bg-slate-50 border-b border-gray-200 relative overflow-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20 lg:py-28 relative z-10 text-center">
                    <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 text-slate-900">
                        Discover your next <span className="text-orange-600">experience.</span>
                    </h1>
                    <p className="text-lg text-slate-600 mb-10 max-w-2xl mx-auto">
                        From underground music gigs to massive tech conferences, find the events that matter to you.
                    </p>

                    {/* EventsGrid handles both the search bar and the grid */}
                    <EventsGrid events={events as any} />
                </div>

                {/* Decorative Background Elements */}
                <div className="absolute top-0 left-0 w-full h-full opacity-30 pointer-events-none">
                    <div className="absolute -top-24 -left-24 w-96 h-96 bg-orange-200 rounded-full blur-3xl"></div>
                    <div className="absolute top-1/2 right-0 w-64 h-64 bg-blue-200 rounded-full blur-3xl"></div>
                </div>
            </div>
        </div>
    );
}
