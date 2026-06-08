'use client';

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
    organizer_name?: string;
}

interface EventsGridProps {
    events: Event[];
    query: string;
    setQuery: (q: string) => void;
    categories: { id: string; name: string }[];
}

export default function EventsGrid({ events, query, setQuery, categories }: EventsGridProps) {
    const filtered = query.trim()
        ? events.filter((event) => {
              const q = query.toLowerCase();
              return (
                  event.title?.toLowerCase().includes(q) ||
                  event.venue_name?.toLowerCase().includes(q) ||
                  event.city?.toLowerCase().includes(q) ||
                  (event as any).categories?.name?.toLowerCase().includes(q)
              );
          })
        : events;

    return (
        <div className="w-full bg-white">
            {/* Events Grid */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 text-left">
                <div className="flex items-end justify-between mb-8">
                    <h2 className="text-2xl font-bold text-[#F15A29]">
                        {query.trim()
                            ? `Results for "${query}" (${filtered.length})`
                            : 'Upcoming Events'}
                    </h2>
                    <div className="flex gap-2">
                        {['All', ...categories.map(c => c.name)].map((filter) => (
                            <button
                                key={filter}
                                onClick={() => setQuery(filter === 'All' ? '' : filter)}
                                className="px-4 py-1.5 rounded-full border border-gray-200 text-sm font-medium hover:border-[#F15A29] hover:text-[#F15A29] transition-colors bg-white"
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
                                    organizerName={event.organizer_name}
                                />
                            );
                        })}
                    </div>
                )}

            </div>
        </div>
    );
}
