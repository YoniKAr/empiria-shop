import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Calendar, MapPin, Share2 } from 'lucide-react';

export default async function EventPage({ params }: { params: { slug: string } }) {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  
  // Fetch event + ticket tiers
  const { data: event } = await supabase
    .from('events')
    .select('*, ticket_tiers(*)')
    .eq('slug', params.slug)
    .single();

  if (!event) notFound();

  return (
    <div className="min-h-screen bg-white">
        {/* Banner */}
        <div className="h-[400px] bg-gray-900 relative">
            {event.cover_image_url && <img src={event.cover_image_url} className="w-full h-full object-cover opacity-60" />}
            <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/80 to-transparent p-8">
                <div className="max-w-5xl mx-auto text-white">
                    <span className="bg-orange-600 px-3 py-1 rounded text-xs font-bold uppercase tracking-wide">Event</span>
                    <h1 className="text-4xl md:text-5xl font-extrabold mt-2 mb-4">{event.title}</h1>
                    <div className="flex gap-6 text-sm md:text-base font-medium">
                        <div className="flex items-center gap-2"><Calendar className="w-5 h-5"/> {new Date(event.start_at).toLocaleString()}</div>
                        <div className="flex items-center gap-2"><MapPin className="w-5 h-5"/> {event.venue_name}, {event.city}</div>
                    </div>
                </div>
            </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 py-12 grid grid-cols-1 md:grid-cols-3 gap-12">
            {/* Left: Description */}
            <div className="md:col-span-2">
                <h2 className="text-2xl font-bold mb-4">About</h2>
                <div className="prose max-w-none text-gray-600">
                    {/* Render rich text here properly later */}
                    <p>{JSON.stringify(event.description)}</p> 
                </div>
            </div>

            {/* Right: Ticket Widget */}
            <div className="relative">
                <div className="border border-gray-200 rounded-xl shadow-lg p-6 sticky top-24 bg-white">
                    <h3 className="font-bold text-xl mb-4">Tickets</h3>
                    
                    <div className="space-y-4 mb-6">
                        {event.ticket_tiers.map((tier: any) => (
                            <div key={tier.id} className="flex justify-between items-center p-3 border rounded-lg hover:border-black cursor-pointer transition-colors">
                                <div>
                                    <div className="font-bold">{tier.name}</div>
                                    <div className="text-xs text-gray-500">{tier.description}</div>
                                </div>
                                <div className="font-bold">₹{tier.price}</div>
                            </div>
                        ))}
                    </div>

                    <Link 
                        href={`/checkout/${event.id}`} 
                        className="block w-full bg-orange-600 text-white text-center py-4 rounded-xl font-bold hover:bg-orange-700 transition-colors"
                    >
                        Get Tickets
                    </Link>
                    
                    <p className="text-xs text-center text-gray-400 mt-4">Secure checkout powered by Stripe</p>
                </div>
            </div>
        </div>
    </div>
  );
}
