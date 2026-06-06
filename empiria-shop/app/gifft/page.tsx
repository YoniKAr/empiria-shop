import { getSupabaseAdmin } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import GifftContent from './GifftContent';

export const metadata = {
  title: 'GIFFT - Greek International Film Festival Tour of Canada | Empiria',
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

  // Fetch published GIFFT movies
  const { data: movies } = await supabase
    .from('events')
    .select(`
      id, title, slug, city, cover_image_url, currency,
      event_occurrences(starts_at),
      gifft_movie_details(*)
    `)
    .eq('event_type', 'gifft_movie')
    .eq('status', 'published')
    .order('created_at', { ascending: false });

  // Fetch featured movies
  const { data: featured } = await supabase
    .from('gifft_featured_movies')
    .select('*, events:event_id(id, title, slug, city, cover_image_url, gifft_movie_details(*))')
    .order('display_order');

  // Fetch city sponsors
  const { data: sponsors } = await supabase
    .from('gifft_city_sponsors')
    .select('*')
    .order('display_order');

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900">
      <Navbar />
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
