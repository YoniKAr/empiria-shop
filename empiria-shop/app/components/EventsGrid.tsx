'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { getCurrencySymbol } from '@/lib/utils';
import { EventCard } from './EventCard';

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
        <div className="w-full">
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
                    className="bg-[#F98C1F] text-white h-12 px-8 rounded-full font-bold hover:brightness-110 transition-all"
                >
                    Search
                </button>
            </div>

            {/* Events Grid */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 text-left">
                <div className="flex items-end justify-between mb-8">
                    <h2 className="text-2xl font-bold text-[#F98C1F]">
                        {query.trim()
                            ? `Results for "${query}" (${filtered.length})`
                            : 'Upcoming Events'}
                    </h2>
                    <div className="flex gap-2">
                        {['All', 'Music', 'Tech', 'Food'].map((filter) => (
                            <button
                                key={filter}
                                onClick={() => setQuery(filter === 'All' ? '' : filter)}
                                className="px-4 py-1.5 rounded-full border border-gray-200 text-sm font-medium hover:border-[#F98C1F] hover:text-[#F98C1F] transition-colors bg-white"
                            >
                                {filter}
                            </button>
                        ))}
                    </div>
                </div>

                {filtered.length === 0 ? (
                    <div className="text-center py-20 text-muted-foreground">
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

                            const occs = (event as any).event_occurrences || [];
                            const startAt = occs[0]?.starts_at || event.start_at || undefined;

                            return (
                                <EventCard
                                    key={event.id}
                                    id={event.id}
                                    title={event.title}
                                    slug={event.slug}
                                    coverImageUrl={event.cover_image_url}
                                    venueName={event.venue_name}
                                    city={event.city}
                                    category={event.categories?.name}
                                    startAt={startAt}
                                    minPrice={minPrice}
                                    currencySymbol={symbol}
                                />
                            );
                        })}
                    </div>
                )}

                {isMock && (
                    <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-center text-sm">
                        <strong>Development Mode:</strong> Showing mock events because no published events were found in Supabase.
                    </div>
                )}
            </div>
        </div>
    );
}
