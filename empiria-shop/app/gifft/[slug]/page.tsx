import { getSupabaseAdmin } from '@/lib/supabase';
import { notFound } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import MovieDetailContent from './MovieDetailContent';
import type { Metadata } from 'next';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();
  const { data: event } = await supabase
    .from('events')
    .select('title, description')
    .eq('slug', slug)
    .eq('event_type', 'gifft_movie')
    .single();

  return {
    title: event ? `${event.title} - GIFFT | Empiria` : 'Movie Not Found',
    description: event?.description
      ? (typeof event.description === 'string' ? event.description.slice(0, 160) : 'Watch this film at GIFFT')
      : undefined,
  };
}

export default async function MovieDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();

  // Fetch movie event
  const { data: event } = await supabase
    .from('events')
    .select('*, gifft_movie_details(*), ticket_tiers(*), event_occurrences(*), categories(name)')
    .eq('slug', slug)
    .eq('event_type', 'gifft_movie')
    .single();

  if (!event) notFound();

  const movie = Array.isArray(event.gifft_movie_details)
    ? event.gifft_movie_details[0] || {}
    : event.gifft_movie_details || {};

  // Sort occurrences
  const allOccurrences = (event.event_occurrences || [])
    .filter((o: any) => !o.is_cancelled)
    .sort((a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

  const futureOccurrences = allOccurrences.filter(
    (o: any) => new Date(o.starts_at) > new Date()
  );

  // Fetch similar movies in same city
  let similarMovies: any[] = [];
  if (event.city) {
    const { data: cityMovies } = await supabase
      .from('events')
      .select(`
        id, title, slug, city, cover_image_url,
        gifft_movie_details(*)
      `)
      .eq('event_type', 'gifft_movie')
      .eq('status', 'published')
      .ilike('city', event.city)
      .neq('id', event.id)
      .order('created_at', { ascending: false })
      .limit(5);
    similarMovies = cityMovies || [];
  }

  // If not enough similar from same city, fetch others
  if (similarMovies.length < 4) {
    const existingIds = [event.id, ...similarMovies.map((m: any) => m.id)];
    const { data: otherMovies } = await supabase
      .from('events')
      .select(`
        id, title, slug, city, cover_image_url,
        gifft_movie_details(*)
      `)
      .eq('event_type', 'gifft_movie')
      .eq('status', 'published')
      .not('id', 'in', `(${existingIds.join(',')})`)
      .order('created_at', { ascending: false })
      .limit(5 - similarMovies.length);
    similarMovies = [...similarMovies, ...(otherMovies || [])];
  }

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900">
      <Navbar />
      <MovieDetailContent
        event={event as any}
        movie={movie as any}
        futureOccurrences={futureOccurrences as any[]}
        similarMovies={similarMovies as any[]}
      />
      <Footer />
    </div>
  );
}
