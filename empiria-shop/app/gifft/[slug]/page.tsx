import { getSupabaseAdmin } from '@/lib/supabase';
import { getSafeSession } from '@/lib/auth0';
import { notFound } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import MovieDetailContent from './MovieDetailContent';
import type { Metadata } from 'next';
import JsonLd from '@/components/JsonLd';
import { absoluteUrl, stripToText, truncate, buildEventJsonLd } from '@/lib/seo';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();
  const { data: event } = await supabase
    .from('events')
    .select('title, description, cover_image_url, gifft_movie_details(poster_url)')
    .eq('slug', slug)
    .eq('event_type', 'gifft_movie')
    .eq('status', 'published')
    .eq('visibility', 'public')
    .single();

  if (!event) return { title: 'Movie Not Found' };

  const details = Array.isArray((event as any).gifft_movie_details)
    ? (event as any).gifft_movie_details[0] || {}
    : (event as any).gifft_movie_details || {};
  const rawImg = details?.poster_url || (event as any).cover_image_url || '';
  const image = rawImg
    ? (rawImg.startsWith('http')
        ? rawImg
        : `${process.env.SUPABASE_URL}/storage/v1/object/public/${rawImg}`)
    : '';

  const title = `${event.title} · GIFFT`;
  const description = truncate(stripToText(event.description)) || undefined;

  return {
    title,
    description,
    alternates: { canonical: `/gifft/${slug}` },
    openGraph: {
      title,
      description,
      url: absoluteUrl(`/gifft/${slug}`),
      type: 'website',
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function MovieDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();

  // Fetch movie event — drafts / archived / non-public movies are NOT
  // publicly viewable by slug.
  const { data: event } = await supabase
    .from('events')
    .select('*, gifft_movie_details(*), ticket_tiers(*), event_occurrences(*), categories(name)')
    .eq('slug', slug)
    .eq('event_type', 'gifft_movie')
    .eq('status', 'published')
    .eq('visibility', 'public')
    .single();

  if (!event) notFound();

  // Hidden tiers (is_hidden) are organizer-internal — strip them before the
  // event object reaches any client widget/picker.
  event.ticket_tiers = (event.ticket_tiers || []).filter((t: any) => !t.is_hidden);

  // ── Owning organizer(s) for the "By …" credit line ──
  // Look up the event owner's profile (events.organizer_id = auth0_id).
  const { data: ownerProfile } = event.organizer_id
    ? await supabase
        .from('users')
        .select('full_name, role, avatar_url')
        .eq('auth0_id', event.organizer_id)
        .single()
    : { data: null };

  // Admin-owned events are platform-owned → shown as "Empiria Events" with the
  // shared platform avatar; an event an admin created on behalf of a real
  // organizer (owner role !== admin) shows that organizer.
  const isPlatformEvent = ownerProfile?.role === 'admin';
  const organizer = isPlatformEvent
    ? 'Empiria Events'
    : (ownerProfile?.full_name || 'Empiria Events');

  let organizerAvatarUrl: string | null = ownerProfile?.avatar_url || null;
  if (isPlatformEvent) {
    const { data: platformSetting } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'platform_avatar_url')
      .maybeSingle();
    organizerAvatarUrl = (platformSetting?.value as { url?: string | null } | null)?.url || null;
  }

  // Visible co-organizers (additional hosts shown publicly).
  const { data: coOrganizerRows } = await supabase
    .from('event_organizers')
    .select('sort_order, users:user_id(full_name, avatar_url)')
    .eq('event_id', event.id)
    .eq('is_visible', true)
    .order('sort_order', { ascending: true });

  const coOrganizers = (coOrganizerRows || [])
    .map((row: any) => ({
      name: row.users?.full_name || null,
      avatarUrl: row.users?.avatar_url || null,
    }))
    .filter((c: { name: string | null }) => !!c.name) as { name: string; avatarUrl?: string | null }[];

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

  // Block non-attendee accounts (organizer/non_profit/admin) from buying — show
  // the switch-accounts notice under Get Tickets instead of a checkout redirect
  // loop. Guests/attendees are unaffected.
  let blockedBuyer = false;
  const session = await getSafeSession();
  if (session?.user?.sub) {
    const { data: buyerRow } = await supabase
      .from('users')
      .select('role')
      .eq('auth0_id', session.user.sub)
      .single();
    blockedBuyer = !!buyerRow?.role && buyerRow.role !== 'attendee';
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

  // ── SEO: schema.org Event JSON-LD for the movie screening ──
  const jsonLdOcc = futureOccurrences[0] || allOccurrences[0];
  const rawPoster = (movie as any)?.poster_url || (event as any).cover_image_url || '';
  const jsonLdImage = rawPoster
    ? (rawPoster.startsWith('http')
        ? rawPoster
        : `${process.env.SUPABASE_URL}/storage/v1/object/public/${rawPoster}`)
    : undefined;
  const jsonLdPrices = ((event as any).ticket_tiers || [])
    .map((t: any) => t.price)
    .filter((p: any) => typeof p === 'number');
  const jsonLdPrice = jsonLdPrices.length ? Math.min(...jsonLdPrices) : null;
  const jsonLdOnline = (event as any).location_type === 'virtual';

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900">
      <JsonLd
        data={buildEventJsonLd({
          name: event.title,
          description: stripToText(event.description),
          image: jsonLdImage,
          startDate: jsonLdOcc?.starts_at || undefined,
          // Fall back to startDate when no end time is set (mirrors the events
          // page) so the recommended endDate field is always present.
          endDate: jsonLdOcc?.ends_at || jsonLdOcc?.starts_at || undefined,
          url: absoluteUrl(`/gifft/${event.slug}`),
          isOnline: jsonLdOnline,
          venueName: event.venue_name,
          addressText: (event as any).address_text,
          city: event.city,
          price: jsonLdPrice,
          priceCurrency: ((event as any).currency || 'cad').toUpperCase(),
          offerValidFrom: new Date().toISOString(),
          organizerName: organizer,
          includePerformer: true,
        })}
      />
      <Navbar />
      <MovieDetailContent
        event={event as any}
        movie={movie as any}
        futureOccurrences={futureOccurrences as any[]}
        similarMovies={similarMovies as any[]}
        blockedBuyer={blockedBuyer}
        organizer={organizer}
        organizerAvatarUrl={organizerAvatarUrl}
        coOrganizers={coOrganizers}
      />
      <Footer />
    </div>
  );
}
