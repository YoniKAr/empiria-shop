'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { getCurrencySymbol } from '@/lib/utils';
import { EventCard } from './EventCard';

const PAGE_SIZE = 12;

// City slug rule (kept in sync with the /city/[citySlug] pages): lowercase,
// trim, strip diacritics, collapse non-alphanumerics to single hyphens.
function toCitySlug(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

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
    timezone?: string;
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

export default function EventsGrid({ events, query, categories, activeCategory }: EventsGridProps) {
    // Category filtering happens CLIENT-SIDE for an instant, smooth experience —
    // clicking a pill filters the events already on the page (no navigation).
    // Initialized from ?category= so shared/old links still open pre-filtered.
    // The dedicated /category/[slug] pages exist separately for SEO.
    const [selectedSlug, setSelectedSlug] = useState<string | null>(activeCategory);
    const selectedCategoryName = selectedSlug
        ? categories.find((c) => c.slug === selectedSlug)?.name ?? null
        : null;

    const filtered = events.filter((event) => {
        // Category filter (match on the event's category name).
        if (selectedCategoryName && event.categories?.name !== selectedCategoryName) return false;
        // Search filter.
        if (query.trim()) {
            const q = query.toLowerCase();
            return (
                event.title?.toLowerCase().includes(q) ||
                event.venue_name?.toLowerCase().includes(q) ||
                event.city?.toLowerCase().includes(q) ||
                event.categories?.name?.toLowerCase().includes(q)
            );
        }
        return true;
    });

    // Smart search suggestions: when the search text matches a known city
    // and/or category name (case-insensitive substring, min 3 chars), offer
    // direct links to the dedicated crawlable browse pages.
    const suggestionQuery = query.trim().toLowerCase();
    let cityMatch: { name: string; slug: string } | null = null;
    let categoryMatch: { name: string; slug: string } | null = null;
    if (suggestionQuery.length >= 3) {
        // Dedupe cities case-insensitively by slug (first casing wins).
        const citiesBySlug = new Map<string, string>();
        for (const e of events) {
            const city = e.city?.trim();
            if (!city) continue;
            const slug = toCitySlug(city);
            if (slug && !citiesBySlug.has(slug)) citiesBySlug.set(slug, city);
        }
        for (const [slug, name] of citiesBySlug) {
            const lower = name.toLowerCase();
            if (lower.includes(suggestionQuery) || suggestionQuery.includes(lower)) {
                cityMatch = { name, slug };
                break;
            }
        }
        for (const cat of categories) {
            const lower = cat.name.toLowerCase();
            if (lower.includes(suggestionQuery) || suggestionQuery.includes(lower)) {
                categoryMatch = { name: cat.name, slug: cat.slug };
                break;
            }
        }
    }

    // Paginate client-side: show PAGE_SIZE at a time, reveal more on demand.
    // Reset to the first page whenever the search query or category changes.
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    useEffect(() => { setVisibleCount(PAGE_SIZE); }, [query, selectedSlug]);
    const visible = filtered.slice(0, visibleCount);
    const hasMore = filtered.length > visibleCount;

    return (
        <div className="w-full bg-white">
            {/* Events Grid */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 text-left">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8">
                    <h2 className="text-2xl font-bold text-[#F15A29]">
                        {query.trim()
                            ? `Results for "${query}" (${filtered.length})`
                            : selectedCategoryName
                                ? `${selectedCategoryName} Events`
                                : 'Upcoming Events'}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        {[{ name: 'All', slug: null as string | null }, ...categories].map((cat) => {
                            const isActive = cat.slug === null ? !selectedSlug : cat.slug === selectedSlug;
                            return (
                                <button
                                    key={cat.name}
                                    type="button"
                                    onClick={() => setSelectedSlug(cat.slug)}
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

                {/* Internal link to the dedicated (crawlable, SEO) category page. */}
                {selectedSlug && selectedCategoryName && (
                    <div className="-mt-4 mb-8">
                        <Link
                            href={`/category/${selectedSlug}`}
                            className="text-sm font-medium text-[#F15A29] hover:underline"
                        >
                            View the full {selectedCategoryName} events page →
                        </Link>
                    </div>
                )}

                {/* Smart suggestion links to the dedicated city/category browse pages. */}
                {(cityMatch || categoryMatch) && (
                    <div className="mb-8 flex flex-wrap items-center gap-2 rounded-2xl border border-[#F15A29]/25 bg-[#F15A29]/5 px-4 py-3">
                        {cityMatch && (
                            <Link
                                href={`/city/${cityMatch.slug}`}
                                className="px-4 py-1.5 rounded-full border border-[#F15A29] bg-white text-sm font-medium text-[#F15A29] hover:bg-[#F15A29] hover:text-white transition-colors"
                            >
                                See all events in {cityMatch.name} →
                            </Link>
                        )}
                        {categoryMatch && (
                            <Link
                                href={`/category/${categoryMatch.slug}`}
                                className="px-4 py-1.5 rounded-full border border-[#F15A29] bg-white text-sm font-medium text-[#F15A29] hover:bg-[#F15A29] hover:text-white transition-colors"
                            >
                                See all {categoryMatch.name} events →
                            </Link>
                        )}
                        {cityMatch && categoryMatch && (
                            <Link
                                href={`/city/${cityMatch.slug}/${categoryMatch.slug}`}
                                className="px-4 py-1.5 rounded-full border border-[#F15A29] bg-[#F15A29] text-sm font-medium text-white hover:bg-[#d94d20] transition-colors"
                            >
                                {categoryMatch.name} events in {cityMatch.name} →
                            </Link>
                        )}
                    </div>
                )}

                {filtered.length === 0 ? (
                    <div className="text-center py-20 text-gray-600">
                        <Search className="mx-auto mb-4 w-10 h-10 opacity-30" />
                        {query.trim() ? (
                            <>
                                <p className="text-lg font-medium">No events found for &quot;{query}&quot;</p>
                                <p className="text-sm mt-1">Try a different search term.</p>
                            </>
                        ) : selectedCategoryName ? (
                            <>
                                <p className="text-lg font-medium">No events in {selectedCategoryName}</p>
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
                    <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {visible.map((event) => {
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
                                    timezone={event.timezone}
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
                    {hasMore && (
                        <div className="flex justify-center mt-10">
                            <button
                                type="button"
                                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                                className="px-6 py-2.5 rounded-full border border-[#F15A29] text-[#F15A29] font-semibold text-sm hover:bg-[#F15A29] hover:text-white transition-colors"
                            >
                                Load more events
                            </button>
                        </div>
                    )}
                    </>
                )}

            </div>
        </div>
    );
}
