'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, ChevronLeft, ChevronRight, ChevronDown, MapPin, Calendar } from 'lucide-react';

interface FeaturedEvent {
  id: string;
  title: string;
  slug: string;
  cover_image_url?: string;
  venue_name?: string;
  city?: string;
  currency?: string;
  categories?: { name: string } | null;
  event_occurrences?: { starts_at: string }[];
  organizer_name?: string;
}

interface FeaturedHeroProps {
  featuredEvents: FeaturedEvent[];
  query: string;
  setQuery: (q: string) => void;
}

export default function FeaturedHero({ featuredEvents, query, setQuery }: FeaturedHeroProps) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const hasSlides = featuredEvents.length > 0;
  const total = featuredEvents.length;

  const next = useCallback(() => {
    if (total <= 1) return;
    setCurrent((prev) => (prev + 1) % total);
  }, [total]);

  const prev = useCallback(() => {
    if (total <= 1) return;
    setCurrent((prev) => (prev - 1 + total) % total);
  }, [total]);

  // Auto-rotate every 6 seconds, pause on hover
  useEffect(() => {
    if (paused || total <= 1) return;
    const timer = setInterval(next, 6000);
    return () => clearInterval(timer);
  }, [paused, next, total]);

  const currentEvent = hasSlides ? featuredEvents[current] : null;
  const eventDate = currentEvent?.event_occurrences?.[0]?.starts_at
    ? new Date(currentEvent.event_occurrences[0].starts_at)
    : null;

  return (
    <div
      className="relative h-screen w-full overflow-hidden -mt-16 pt-16"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Slide backgrounds with cross-fade */}
      {hasSlides ? (
        featuredEvents.map((event, i) => (
          <div
            key={event.id}
            className="absolute inset-0 transition-opacity duration-700 ease-in-out"
            style={{ opacity: i === current ? 1 : 0 }}
          >
            {event.cover_image_url ? (
              <img
                src={event.cover_image_url}
                alt={event.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
            )}
          </div>
        ))
      ) : (
        /* Fallback banner image when no featured events */
        <img
          src="/banners/hero-concert.jpg"
          alt="Live event crowd with hands raised"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Dark gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/50" />

      {/* Main overlay content — centered */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full px-4 sm:px-6">
        <div className="text-center max-w-4xl mx-auto -mt-16">
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6 text-white drop-shadow-lg">
            Discover your next{' '}
            <span className="text-[#F15A29]">experience.</span>
          </h1>
          <p className="text-lg md:text-xl text-white/80 mb-10 max-w-2xl mx-auto">
            From underground music gigs to massive tech conferences, find the events that matter to you.
          </p>

          {/* Search Bar */}
          <div className="bg-white/95 backdrop-blur-sm p-2 rounded-full shadow-2xl max-w-3xl mx-auto flex flex-col sm:flex-row gap-2">
            <div className="flex-1 flex items-center px-4 h-12 bg-gray-50 sm:bg-transparent rounded-full sm:rounded-none">
              <Search className="text-gray-400 w-5 h-5 mr-3 flex-shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search events, artists, categories, city..."
                className="bg-transparent w-full outline-none text-sm font-medium placeholder:text-gray-400 text-slate-900"
              />
            </div>
            <button
              onClick={() => {
                if (query.trim()) {
                  document.getElementById('events-section')?.scrollIntoView({ behavior: 'smooth' });
                }
              }}
              className="bg-[#F15A29] text-white h-12 px-8 rounded-full font-bold hover:brightness-110 transition-all cursor-pointer"
            >
              Search
            </button>
          </div>
        </div>

        {/* Bottom section: event info + controls */}
        {hasSlides && (
          <div className="absolute bottom-24 left-0 right-0 px-4 sm:px-8">
            <div className="max-w-7xl mx-auto flex items-end justify-between">
              {/* Current event info */}
              <div className="text-white max-w-lg">
                {currentEvent?.categories?.name && (
                  <span className="inline-block bg-[#F15A29] text-white text-xs font-bold px-3 py-1 rounded-md uppercase tracking-wider mb-3">
                    {currentEvent.categories.name}
                  </span>
                )}
                <h2 className="text-2xl md:text-3xl font-bold mb-2 drop-shadow-lg leading-tight">
                  {currentEvent?.title}
                </h2>
                <div className="flex items-center gap-4 text-white/80 text-sm mb-3">
                  {eventDate && (
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-4 h-4" />
                      {eventDate.toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                      {' at '}
                      {eventDate.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })}
                    </span>
                  )}
                  {currentEvent?.city && (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-4 h-4" />
                      {currentEvent.city}
                      {currentEvent.venue_name ? `, ${currentEvent.venue_name}` : ''}
                    </span>
                  )}
                </div>
                <Link
                  href={`/events/${currentEvent?.slug}`}
                  className="inline-flex items-center gap-2 bg-white text-slate-900 font-bold text-sm px-6 py-2.5 rounded-full hover:bg-orange-50 transition-colors"
                >
                  View Event
                </Link>
              </div>

              {/* Navigation controls */}
              {total > 1 && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={prev}
                    className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm text-white flex items-center justify-center hover:bg-white/30 transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>

                  {/* Dot indicators */}
                  <div className="flex items-center gap-2">
                    {featuredEvents.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setCurrent(i)}
                        className={`rounded-full transition-all duration-300 ${
                          i === current
                            ? 'w-8 h-2.5 bg-[#F15A29]'
                            : 'w-2.5 h-2.5 bg-white/50 hover:bg-white/80'
                        }`}
                      />
                    ))}
                  </div>

                  <button
                    onClick={next}
                    className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm text-white flex items-center justify-center hover:bg-white/30 transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronDown className="w-6 h-6 text-white/60" />
        </div>
      </div>
    </div>
  );
}
