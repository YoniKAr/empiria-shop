'use client';

import { useState } from 'react';
import FeaturedHero from './FeaturedHero';
import EventsGrid from './EventsGrid';

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

interface HomeContentProps {
  events: Event[];
  featuredEvents: FeaturedEvent[];
}

export default function HomeContent({ events, featuredEvents }: HomeContentProps) {
  const [query, setQuery] = useState('');

  return (
    <>
      <FeaturedHero
        featuredEvents={featuredEvents}
        query={query}
        setQuery={setQuery}
      />
      <div id="events-section">
        <EventsGrid events={events} query={query} setQuery={setQuery} />
      </div>
    </>
  );
}
