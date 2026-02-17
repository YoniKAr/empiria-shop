import { auth0 } from '@/lib/auth0';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { Search, MapPin, Calendar, Ticket } from 'lucide-react';
import Image from 'next/image'

// --- MOCK DATA (Fallback if DB is empty) ---
const MOCK_EVENTS = [
    {
        id: 'mock-1',
        title: 'Sunburn Arena ft. Martin Garrix',
        slug: 'sunburn-arena',
        cover_image_url: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?q=80&w=2070&auto=format&fit=crop',
        start_at: new Date(Date.now() + 86400000 * 5).toISOString(), // 5 days from now
        venue_name: 'Mahalaxmi Race Course',
        city: 'Mumbai',
        ticket_tiers: [{ price: 1500 }, { price: 3000 }]
    },
    {
        id: 'mock-2',
        title: 'TechSparks 2026',
        slug: 'techsparks-2026',
        cover_image_url: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=2070&auto=format&fit=crop',
        start_at: new Date(Date.now() + 86400000 * 12).toISOString(),
        venue_name: 'Taj Yeshwantpur',
        city: 'Bengaluru',
        ticket_tiers: [{ price: 4999 }]
    },
    {
        id: 'mock-3',
        title: 'ZomatoLand Food Carnival',
        slug: 'zomato-land',
        cover_image_url: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?q=80&w=1974&auto=format&fit=crop',
        start_at: new Date(Date.now() + 86400000 * 20).toISOString(),
        venue_name: 'Jawaharlal Nehru Stadium',
        city: 'Delhi',
        ticket_tiers: [{ price: 999 }, { price: 1999 }]
    }
];

export default async function ShopHome() {
    // 1. Get Session (for Navbar user state)
    const session = await auth0.getSession();
    const user = session?.user;

    // 2. Connect to Supabase
    const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_KEY!
    );

    // 3. Fetch Real Events
    // We join with ticket_tiers to get the lowest price
    const { data: realEvents } = await supabase
        .from('events')
        .select(`
      id, 
      title, 
      slug, 
      cover_image_url, 
      start_at, 
      venue_name, 
      city, 
      ticket_tiers (price)
    `)
        .eq('status', 'published')
        .order('start_at', { ascending: true })
        .limit(12);

    // 4. Use Mock Data if DB is empty (Visual Confirmation)
    const displayEvents = (realEvents && realEvents.length > 0) ? realEvents : MOCK_EVENTS;
    // 
    return (
        <div className="min-h-screen bg-white font-sans text-slate-900">

            {/* --- NAVBAR --- */}
            <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">

                    {/* Logo */}
                    <Link href="/" className="flex items-center gap-2">
                        <Image
                            src="/logo.png"
                            alt="Empiria Logo" // here
                            width={130}
                            height={40}
                            className="object-contain"
                            priority
                        />
                    </Link>

                    {/* User Actions */}
                    <div className="flex items-center gap-4">
                        {user ? (
                            <div className="flex items-center gap-3">
                                <span className="text-sm font-medium hidden sm:block">Hi, {user.name?.split(' ')[0]}</span>
                                <a href="https://profile.empiriaindia.com" className="w-8 h-8 rounded-full bg-gray-100 overflow-hidden border border-gray-200">
                                    {user.picture && <img src={user.picture} alt="Profile" className="w-full h-full object-cover" />}
                                </a>
                            </div>
                        ) : (
                            <a
                                href="https://auth.empiriaindia.com/auth/login?returnTo=https://shop.empiriaindia.com"
                                className="text-sm font-bold bg-black text-white px-5 py-2.5 rounded-full hover:bg-gray-800 transition-colors"
                            >
                                Sign In
                            </a>
                        )}
                    </div>
                </div>
            </nav>

            {/* --- HERO SECTION --- */}
            <div className="bg-slate-50 border-b border-gray-200 relative overflow-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20 lg:py-28 relative z-10 text-center">
                    <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 text-slate-900">
                        Discover your next <span className="text-orange-600">experience.</span>
                    </h1>
                    <p className="text-lg text-slate-600 mb-10 max-w-2xl mx-auto">
                        From underground music gigs to massive tech conferences, find the events that matter to you.
                    </p>

                    {/* Search Bar */}
                    <div className="bg-white p-2 rounded-full shadow-xl border border-gray-200 max-w-3xl mx-auto flex flex-col sm:flex-row gap-2">
                        <div className="flex-1 flex items-center px-4 h-12 bg-gray-50 sm:bg-transparent rounded-full sm:rounded-none">
                            <Search className="text-gray-400 w-5 h-5 mr-3" />
                            <input
                                type="text"
                                placeholder="Search events, artists, categories..."
                                className="bg-transparent w-full outline-none text-sm font-medium placeholder:text-gray-400"
                            />
                        </div>
                        <div className="hidden sm:block w-px bg-gray-200 h-8 self-center"></div>
                        <div className="flex-1 flex items-center px-4 h-12 bg-gray-50 sm:bg-transparent rounded-full sm:rounded-none">
                            <MapPin className="text-gray-400 w-5 h-5 mr-3" />
                            <input
                                type="text"
                                placeholder="City or Location"
                                className="bg-transparent w-full outline-none text-sm font-medium placeholder:text-gray-400"
                            />
                        </div>
                        <button className="bg-orange-600 text-white h-12 px-8 rounded-full font-bold hover:bg-orange-700 transition-colors">
                            Search
                        </button>
                    </div>
                </div>

                {/* Decorative Background Elements */}
                <div className="absolute top-0 left-0 w-full h-full opacity-30 pointer-events-none">
                    <div className="absolute -top-24 -left-24 w-96 h-96 bg-orange-200 rounded-full blur-3xl"></div>
                    <div className="absolute top-1/2 right-0 w-64 h-64 bg-blue-200 rounded-full blur-3xl"></div>
                </div>
            </div>

            {/* --- EVENTS GRID --- */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
                <div className="flex items-end justify-between mb-8">
                    <h2 className="text-2xl font-bold">Upcoming Events</h2>
                    <div className="flex gap-2">
                        {/* Placeholder Filters */}
                        {['All', 'Music', 'Tech', 'Food'].map(filter => (
                            <button key={filter} className="px-4 py-1.5 rounded-full border border-gray-200 text-sm font-medium hover:border-black transition-colors bg-white">
                                {filter}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {displayEvents.map((event: any) => {
                        // Determine lowest price
                        const prices = event.ticket_tiers?.map((t: any) => t.price) || [];
                        const minPrice = prices.length > 0 ? Math.min(...prices) : 0;

                        return (
                            <Link key={event.id} href={`/events/${event.slug}`} className="group block">
                                <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 h-full flex flex-col">
                                    {/* Image */}
                                    <div className="aspect-[4/3] bg-gray-200 relative overflow-hidden">
                                        {event.cover_image_url ? (
                                            <img
                                                src={event.cover_image_url}
                                                alt={event.title}
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-gray-400 bg-gray-100">
                                                <Calendar size={48} opacity={0.2} />
                                            </div>
                                        )}
                                        <div className="absolute top-3 right-3 bg-white/90 backdrop-blur text-xs font-bold px-2 py-1 rounded-md shadow-sm">
                                            {event.city}
                                        </div>
                                    </div>

                                    {/* Content */}
                                    <div className="p-5 flex flex-col flex-1">
                                        <div className="text-orange-600 font-bold text-xs uppercase tracking-wider mb-2">
                                            {new Date(event.start_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })}
                                        </div>
                                        <h3 className="font-bold text-lg leading-tight mb-2 group-hover:text-orange-600 transition-colors line-clamp-2">
                                            {event.title}
                                        </h3>
                                        <p className="text-gray-500 text-sm mb-4 line-clamp-1">
                                            {event.venue_name}
                                        </p>

                                        <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between">
                                            <span className="font-bold text-slate-900">
                                                {minPrice === 0 ? "Free" : `₹${minPrice}`}
                                            </span>
                                            <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                                Get Tickets
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        )
                    })}
                </div>

                {(!realEvents || realEvents.length === 0) && (
                    <div className="mt-8 p-4 bg-yellow-50 border border-yellow-100 rounded-lg text-yellow-800 text-center text-sm">
                        <strong>Development Mode:</strong> Showing mock events because no published events were found in Supabase.
                    </div>
                )}
            </div>

        </div>
    );
}
