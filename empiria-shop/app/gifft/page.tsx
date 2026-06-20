import { getSupabaseAdmin } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import GifftContent from './GifftContent';

export const metadata = {
  title: 'GIFFT - Greek International Film Festival Tour of Canada | Empiria Events',
  description: 'Discover movies playing in cities across Canada through the Greek International Film Festival Tour of Canada.',
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

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900">
      <Navbar overlay />
      <GifftContent
        cities={(cities || []) as any[]}
        movies={(movies || []) as any[]}
        featured={(featured || []) as any[]}
        sponsors={(sponsors || []) as any[]}
      />
      <Footer />
    </div>
  );
}
