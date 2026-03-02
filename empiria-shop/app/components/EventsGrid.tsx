'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, Calendar } from 'lucide-react';
import { getCurrencySymbol } from '@/lib/utils';

interface Event {
    id: string;
    title: string;
    slug: string;
    cover_image_url?: string;
    venue_name?: string;
    city?: string;
    currency?: string;
    categories?: { name: string } | null;
    ticket_tiers?: { price: number }[];
    event_occurrences?: { starts_at: string }[];
    start_at?: string;
}

interface EventsGridProps {
    events: Event[];
    isMock?: boolean;
}

export default function EventsGrid({ events, isMock }: EventsGridProps) {
    const [query, setQuery] = useState('');

    const filtered = events.filter((event) => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (
            event.title?.toLowerCase().includes(q) ||
            event.venue_name?.toLowerCase().includes(q) ||
            event.city?.toLowerCase().includes(q) ||
            (event as any).categories?.name?.toLowerCase().includes(q)
        );
    });

    return (
        <>
            {/* Search Bar */}
            <div className="bg-white p-2 rounded-full shadow-xl border border-gray-200 max-w-3xl mx-auto flex flex-col sm:flex-row gap-2">
                <div className="flex-1 flex items-center px-4 h-12 bg-gray-50 sm:bg-transparent rounded-full sm:rounded-none">
                    <Search className="text-gray-400 w-5 h-5 mr-3 flex-shrink-0" />
                    <input
                        id="event-search"
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search events, artists, categories, city..."
                        className="bg-transparent w-full outline-none text-sm font-medium placeholder:text-gray-400"
                    />
                </div>
                <button
                    onClick={() => setQuery(query)}
                    className="bg-orange-600 text-white h-12 px-8 rounded-full font-bold hover:bg-orange-700 transition-colors"
                >
                    Search
                </button>
            </div>

            {/* Events Grid */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
                <div className="flex items-end justify-between mb-8">
                    <h2 className="text-2xl font-bold">
                        {query.trim()
                            ? `Results for "${query}" (${filtered.length})`
                            : 'Upcoming Events'}
                    </h2>
                    <div className="flex gap-2">
                        {['All', 'Music', 'Tech', 'Food'].map((filter) => (
                            <button
                                key={filter}
                                onClick={() => setQuery(filter === 'All' ? '' : filter)}
                                className="px-4 py-1.5 rounded-full border border-gray-200 text-sm font-medium hover:border-black transition-colors bg-white"
                            >
                                {filter}
                            </button>
                        ))}
                    </div>
                </div>

                {filtered.length === 0 ? (
                    <div className="text-center py-20 text-gray-500">
                        <Search className="mx-auto mb-4 w-10 h-10 opacity-30" />
                        <p className="text-lg font-medium">No events found for &quot;{query}&quot;</p>
                        <p className="text-sm mt-1">Try a different search term.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {filtered.map((event) => {
                            const prices = event.ticket_tiers?.map((t) => t.price) || [];
                            const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
                            const currency = event.currency || 'cad';
                            const symbol = getCurrencySymbol(currency);

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
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="text-orange-600 font-bold text-xs uppercase tracking-wider">
                                                    {(() => {
                                                        const occs = (event as any).event_occurrences;
                                                        const dateStr = occs?.[0]?.starts_at || event.start_at;
                                                        return dateStr
                                                            ? new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })
                                                            : 'TBD';
                                                    })()}
                                                </span>
                                                {event.categories?.name && (
                                                    <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                                        {event.categories.name}
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="font-bold text-lg leading-tight mb-2 group-hover:text-orange-600 transition-colors line-clamp-2">
                                                {event.title}
                                            </h3>
                                            <p className="text-gray-500 text-sm mb-4 line-clamp-1">
                                                {event.venue_name}
                                            </p>

                                            <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between">
                                                <span className="font-bold text-slate-900">
                                                    {minPrice === 0 ? 'Free' : `${symbol}${minPrice.toLocaleString()}`}
                                                </span>
                                                <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                                    Get Tickets
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}

                {isMock && (
                    <div className="mt-8 p-4 bg-yellow-50 border border-yellow-100 rounded-lg text-yellow-800 text-center text-sm">
                        <strong>Development Mode:</strong> Showing mock events because no published events were found in Supabase.
                    </div>
                )}
            </div>
        </>
    );
}
