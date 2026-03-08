import { getSupabaseAdmin } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import EventsGrid from '@/app/components/EventsGrid';

// --- MOCK DATA (Fallback if DB is empty) ---
const MOCK_EVENTS = [
    {
        id: 'mock-1',
        title: 'Sunburn Arena ft. Martin Garrix',
        slug: 'sunburn-arena',
        cover_image_url: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?q=80&w=2070&auto=format&fit=crop',
        start_at: new Date(Date.now() + 86400000 * 5).toISOString(),
        venue_name: 'Mahalaxmi Race Course',
        city: 'Mumbai',
        currency: 'inr',
        ticket_tiers: [{ price: 1500 }, { price: 3000 }],
        organizer_name: 'Empiria Events',
    },
    {
        id: 'mock-2',
        title: 'TechSparks 2026',
        slug: 'techsparks-2026',
        cover_image_url: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=2070&auto=format&fit=crop',
        start_at: new Date(Date.now() + 86400000 * 12).toISOString(),
        venue_name: 'Taj Yeshwantpur',
        city: 'Bengaluru',
        currency: 'inr',
        ticket_tiers: [{ price: 4999 }],
        organizer_name: 'TechSparks',
    },
    {
        id: 'mock-3',
        title: 'ZomatoLand Food Carnival',
        slug: 'zomato-land',
        cover_image_url: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?q=80&w=1974&auto=format&fit=crop',
        start_at: new Date(Date.now() + 86400000 * 20).toISOString(),
        venue_name: 'Jawaharlal Nehru Stadium',
        city: 'Delhi',
        currency: 'inr',
        ticket_tiers: [{ price: 999 }, { price: 1999 }],
        organizer_name: 'Zomato Events',
    }
];

export default async function ShopHome() {
    const supabase = getSupabaseAdmin();

    const { data: realEvents } = await supabase
        .from('events')
        .select(`
      id, title, slug, cover_image_url,
      venue_name, city, currency, organizer_id,
      categories (name),
      ticket_tiers (price),
      event_occurrences (starts_at)
    `)
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(12);

    // Batch-fetch organizer names for all events
    let eventsWithOrganizers: any[] = [];
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

        eventsWithOrganizers = realEvents.map((e: any) => ({
            ...e,
            organizer_name: profileMap[e.organizer_id] || 'Empiria Events',
        }));
    }

    const displayEvents = eventsWithOrganizers.length > 0 ? eventsWithOrganizers : MOCK_EVENTS;
    const isMock = !realEvents || realEvents.length === 0;

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
                    <EventsGrid events={displayEvents as any} isMock={isMock} />
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
