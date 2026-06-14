'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
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
    organizer_avatar_url?: string | null;
    co_host_count?: number;
    entry_type?: string;
}

interface EventsGridProps {
    events: Event[];
    query: string;
    setQuery: (q: string) => void;
    categories: { id: string; name: string; slug: string }[];
    activeCategory: string | null;
}

export default function EventsGrid({ events, query, setQuery, categories, activeCategory }: EventsGridProps) {
    const router = useRouter();

    // Category selection drives a server-side query via the ?category=<slug> param.
    // "All" clears the param. Selecting a category also clears any active search.
    const selectCategory = (slug: string | null) => {
        setQuery('');
        const href = slug ? `/?category=${encodeURIComponent(slug)}#events-section` : '/#events-section';
        router.push(href);
    };

    const activeCategoryName = activeCategory
        ? categories.find((c) => c.slug === activeCategory)?.name ?? null
        : null;

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
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8">
                    <h2 className="text-2xl font-bold text-[#F15A29]">
                        {query.trim()
                            ? `Results for "${query}" (${filtered.length})`
                            : activeCategoryName
                                ? activeCategoryName
                                : 'Upcoming Events'}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        {[{ name: 'All', slug: null as string | null }, ...categories].map((cat) => {
                            const isActive = cat.slug === null
                                ? !activeCategory
                                : cat.slug === activeCategory;
                            return (
                                <button
                                    key={cat.name}
                                    onClick={() => selectCategory(cat.slug)}
                                    className={`px-4 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                                        isActive
                                            ? 'border-[#F15A29] bg-[#F15A29] text-white'
                                            : 'border-gray-200 text-slate-700 hover:border-[#F15A29] hover:text-[#F15A29] bg-white'
                                    }`}
                                >
                                    {cat.name}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {filtered.length === 0 ? (
                    <div className="text-center py-20 text-gray-600">
                        <Search className="mx-auto mb-4 w-10 h-10 opacity-30" />
                        {query.trim() ? (
                            <>
                                <p className="text-lg font-medium">No events found for &quot;{query}&quot;</p>
                                <p className="text-sm mt-1">Try a different search term.</p>
                            </>
                        ) : activeCategoryName ? (
                            <>
                                <p className="text-lg font-medium">No events in {activeCategoryName}</p>
                                <p className="text-sm mt-1">Try a different category.</p>
                            </>
                        ) : (
                            <>
                                <p className="text-lg font-medium">No upcoming events</p>
                                <p className="text-sm mt-1">Check back soon.</p>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {filtered.map((event) => {
                            const prices = event.ticket_tiers?.map((t) => t.price) || [];
                            const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
                            const currency = event.currency || 'cad';
                            const symbol = getCurrencySymbol(currency);

                            const occs = [...((event as any).event_occurrences || [])].sort(
                                (a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
                            );
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
                                    organizerAvatarUrl={event.organizer_avatar_url}
                                    coHostCount={event.co_host_count}
                                    entryType={event.entry_type}
                                />
                            );
                        })}
                    </div>
                )}

            </div>
        </div>
    );
}
