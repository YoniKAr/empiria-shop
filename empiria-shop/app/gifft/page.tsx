import { getSupabaseAdmin } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import GifftContent from './GifftContent';
import JsonLd from '@/components/JsonLd';
import { absoluteUrl, buildEventJsonLd } from '@/lib/seo';

export const metadata = {
  title: 'GIFFT - Greek International Film Festival Tour of Canada | Empiria Events',
  description: 'Discover movies playing in cities across Canada through the Greek International Film Festival Tour of Canada.',
  alternates: { canonical: '/gifft' },
};

export default async function GifftPage() {
  const supabase = getSupabaseAdmin();

  // Fetch active cities
  const { data: cities } = await supabase
    .from('gifft_cities')
    .select('*')
    .eq('is_active', true)
    .order('display_order');

  // Fetch published, public GIFFT movies. Occurrence filters apply to the
  // embedded rows only (the movie itself stays listed): hide cancelled and
  // past showtimes so the calendar/cards never surface them.
  const nowIso = new Date().toISOString();
  const { data: movies } = await supabase
    .from('events')
    .select(`
      id, title, slug, city, cover_image_url, currency, timezone,
      event_occurrences(starts_at, is_cancelled),
      gifft_movie_details(*)
    `)
    .eq('event_type', 'gifft_movie')
    .eq('status', 'published')
    .eq('visibility', 'public')
    .eq('event_occurrences.is_cancelled', false)
    .gte('event_occurrences.starts_at', nowIso)
    .order('created_at', { ascending: false });

  // Fetch published, public GIFFT *events* (standard events discoverable only on
  // this page in a per-city "Events" section). Same occurrence filters as movies;
  // NO gifft_movie_details — these are ordinary events rendered with EventCard.
  const { data: events } = await supabase
    .from('events')
    .select(`
      id, title, slug, city, cover_image_url, currency, timezone, entry_type,
      ticket_tiers(price),
      event_occurrences(starts_at, is_cancelled)
    `)
    .eq('event_type', 'gifft_event')
    .eq('status', 'published')
    .eq('visibility', 'public')
    .eq('event_occurrences.is_cancelled', false)
    .gte('event_occurrences.starts_at', nowIso)
    .order('created_at', { ascending: false });

  // Fetch featured movies — inner join so drafts/private movies drop out.
  const { data: featured } = await supabase
    .from('gifft_featured_movies')
    .select('*, events:event_id!inner(id, title, slug, city, cover_image_url, status, visibility, gifft_movie_details(*))')
    .eq('events.status', 'published')
    .eq('events.visibility', 'public')
    .order('display_order');

  // Fetch city sponsors
  const { data: sponsors } = await supabase
    .from('gifft_city_sponsors')
    .select('*')
    .order('display_order');

  // ── SEO: ScreeningEvent JSON-LD per movie (next upcoming showtime — the
  // embedded occurrence filter above already dropped cancelled/past ones) plus
  // an ItemList of movie pages, so Google sees every screening from the
  // calendar page itself, mirroring the category pages' per-event markup.
  const screeningJsonLd = (movies || [])
    .map((m: any) => {
      const details = Array.isArray(m.gifft_movie_details)
        ? m.gifft_movie_details[0] || {}
        : m.gifft_movie_details || {};
      const next = [...(m.event_occurrences || [])].sort(
        (a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
      )[0];
      if (!next) return null;
      const rawImg = details?.poster_url || m.cover_image_url || '';
      const image = rawImg
        ? (rawImg.startsWith('http')
            ? rawImg
            : `${process.env.SUPABASE_URL}/storage/v1/object/public/${rawImg}`)
        : undefined;
      return buildEventJsonLd({
        eventType: 'ScreeningEvent',
        name: m.title,
        image,
        startDate: next.starts_at,
        endDate: next.starts_at,
        timeZone: m.timezone || undefined,
        url: absoluteUrl(`/gifft/${m.slug}`),
        city: m.city,
        workPresented: {
          name: m.title,
          director: details?.director || null,
          durationMinutes: details?.duration_minutes || null,
          inLanguage: details?.language || null,
          genre: details?.genre || null,
          image,
        },
      });
    })
    .filter(Boolean) as Record<string, unknown>[];

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: (movies || []).map((m: any, i: number) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: absoluteUrl(`/gifft/${m.slug}`),
    })),
  };

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900">
      <JsonLd data={itemListJsonLd} />
      {screeningJsonLd.map((data, i) => (
        <JsonLd key={i} data={data} />
      ))}
      <Navbar overlay />
      <GifftContent
        cities={(cities || []) as any[]}
        movies={(movies || []) as any[]}
        events={(events || []) as any[]}
        featured={(featured || []) as any[]}
        sponsors={(sponsors || []) as any[]}
      />
      <Footer />
    </div>
  );
}
