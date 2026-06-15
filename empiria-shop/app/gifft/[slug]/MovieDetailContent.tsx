'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Calendar, MapPin, Clock, Globe, Star, Users } from 'lucide-react';
import MovieCard from '@/app/components/MovieCard';
import SponsorSections from '@/app/components/SponsorSections';
import type { SponsorSection } from '@/lib/eventFields';
import { sanitizeRichText } from '@/lib/sanitize-html';
import { BlockedBuyerNotice } from '@/components/BlockedBuyerNotice';
import { formatEventDateTime, tzAbbreviation, DEFAULT_TZ } from '@/lib/datetime';

interface MovieDetail {
  director?: string;
  cast_members?: string[] | string;
  genre?: string;
  duration_minutes?: number;
  synopsis?: string;
  poster_url?: string;
  language?: string;
  subtitles?: string;
  rating?: string;
  pamphlet_url?: string;
}

interface Occurrence {
  id: string;
  starts_at: string;
  ends_at?: string;
  venue_name?: string;
  label?: string;
}

interface SimilarMovie {
  id: string;
  title: string;
  slug: string;
  city?: string;
  cover_image_url?: string;
  gifft_movie_details?: MovieDetail[] | MovieDetail;
}

interface Organizer {
  name: string;
  avatarUrl?: string | null;
}

interface MovieDetailContentProps {
  event: any;
  movie: MovieDetail;
  futureOccurrences: Occurrence[];
  similarMovies: SimilarMovie[];
  /** Logged-in non-attendee (organizer/non_profit/admin) — can't buy. */
  blockedBuyer?: boolean;
  /** Primary owning organizer (or "Empiria Events" for platform-owned). */
  organizer?: string;
  organizerAvatarUrl?: string | null;
  /** Visible co-organizers (additional hosts). */
  coOrganizers?: Organizer[];
}

// Small circular avatar for the "By …" credit line. Dark-on-white friendly:
// initials fall back to the brand orange.
function OrganizerAvatar({ name, avatarUrl, size = 'md' }: { name: string; avatarUrl?: string | null; size?: 'md' | 'sm' }) {
  const cls = size === 'md' ? 'w-6 h-6 text-[11px]' : 'w-5 h-5 text-[10px]';
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatarUrl} alt={name} className={`${cls} rounded-full object-cover ring-1 ring-black/10 shrink-0`} />;
  }
  return (
    <span className={`${cls} rounded-full bg-[#F15A29] text-white font-semibold flex items-center justify-center shrink-0 ring-1 ring-black/10`}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function MovieDetailContent({
  event,
  movie,
  futureOccurrences,
  similarMovies,
  blockedBuyer = false,
  organizer,
  organizerAvatarUrl,
  coOrganizers = [],
}: MovieDetailContentProps) {
  const posterUrl = movie.poster_url || event.cover_image_url;

  // When a blocked (non-attendee) user clicks any "Get Tickets", show the same
  // red switch-accounts notice the event page uses instead of bouncing them
  // into the checkout redirect loop.
  const [showBuyBlock, setShowBuyBlock] = useState(false);

  // Get Tickets control: a real link for attendees/guests; for blocked buyers a
  // button that reveals the BlockedBuyerNotice (no navigation → no loop).
  const GetTicketsButton = ({ href, className }: { href: string; className: string }) =>
    blockedBuyer ? (
      <button type="button" onClick={() => setShowBuyBlock(true)} className={className}>
        Get Tickets
      </button>
    ) : (
      <Link href={href} className={className}>
        Get Tickets
      </Link>
    );

  const formatDuration = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m} min`;
  };

  // Showtimes render in the EVENT's own timezone, with the zone label.
  const tz = event.timezone || DEFAULT_TZ;

  const formatDate = (dateStr: string) =>
    formatEventDateTime(dateStr, tz, {
      withWeekday: true,
      withYear: true,
      withTime: false,
      longMonth: true,
    });

  // Time-only line, with the event's tz label (e.g. "7:00 PM EST").
  const formatTime = (dateStr: string) => {
    const time = new Date(dateStr).toLocaleTimeString('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${time} ${tzAbbreviation(dateStr, tz)}`;
  };

  // Parse cast members
  const castMembers: string[] = Array.isArray(movie.cast_members)
    ? movie.cast_members
    : typeof movie.cast_members === 'string'
      ? movie.cast_members.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

  // Tiered sponsor sections (same as event/special pages)
  const sponsorSections: SponsorSection[] = Array.isArray(event.sponsor_sections)
    ? event.sponsor_sections
    : [];

  // Trailer embed logic (from EventDetails.tsx)
  const getEmbedUrl = (url?: string) => {
    if (!url) return '';
    const trimmed = url.trim();
    const ytMatch = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
    const vimeoMatch = trimmed.match(/(?:vimeo\.com\/)(\d+)/);
    if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
    return '';
  };

  const trailerEmbedUrl = getEmbedUrl(event.trailer_url);

  const getMovieDetail = (m: SimilarMovie): MovieDetail => {
    if (Array.isArray(m.gifft_movie_details)) {
      return m.gifft_movie_details[0] || {};
    }
    return m.gifft_movie_details || {};
  };

  // Parse description
  const description = (() => {
    if (!event.description) return '';
    if (typeof event.description === 'object') {
      return (event.description as any)?.text || JSON.stringify(event.description);
    }
    try {
      const parsed = JSON.parse(event.description as string);
      return parsed?.text || event.description;
    } catch {
      return event.description as string;
    }
  })();

  return (
    <>
      {/* Hero Section - Two Column */}
      <section className="relative bg-white">
        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-12 md:py-16">
          <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] lg:grid-cols-[350px_1fr] gap-8 md:gap-12 items-start">
            {/* Left: Poster */}
            <div className="mx-auto md:mx-0 w-[250px] md:w-full">
              <div className="aspect-[2/3] relative rounded-2xl overflow-hidden shadow-[6px_8px_12px_-2px_rgba(0,0,0,0.6)] ring-1 ring-black/10">
                {posterUrl ? (
                  <Image
                    src={posterUrl}
                    alt={event.title}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 250px, 350px"
                    priority
                    unoptimized
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#F15A29] to-[#d6420f] flex items-center justify-center">
                    <svg className="w-16 h-16 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                    </svg>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Movie Info */}
            <div className="text-center md:text-left">
              {/* Genre badge */}
              {movie.genre && (
                <span className="inline-block bg-neutral-700 text-white text-xs font-bold uppercase tracking-[0.15em] px-3 py-1 rounded-full mb-4">
                  {movie.genre}
                </span>
              )}

              {/* Title */}
              <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-3 tracking-tight leading-tight font-[family-name:var(--font-space-grotesk)]">
                {event.title}
              </h1>

              {/* By — owning organizer(s) with profile photos */}
              {organizer && (
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-2 gap-y-1.5 mb-5">
                  <span className="text-sm text-gray-500">By</span>
                  <OrganizerAvatar name={organizer} avatarUrl={organizerAvatarUrl} size="md" />
                  <span className="text-sm font-semibold text-gray-900">{organizer}</span>
                  {coOrganizers.length > 0 && (
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-gray-500">
                      <span>with</span>
                      {coOrganizers.map((co, i) => (
                        <span key={`${co.name}-${i}`} className="flex items-center gap-1.5">
                          <OrganizerAvatar name={co.name} avatarUrl={co.avatarUrl} size="sm" />
                          <span className="font-medium text-gray-900">
                            {co.name}
                            {i < coOrganizers.length - 1 ? ',' : ''}
                          </span>
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              )}

              {/* Meta pills */}
              <div className="flex flex-wrap justify-center md:justify-start gap-3 mb-6">
                {movie.duration_minutes && (
                  <span className="inline-flex items-center gap-1.5 bg-neutral-700 text-white text-sm px-3 py-1.5 rounded-full">
                    <Clock className="w-3.5 h-3.5" />
                    {formatDuration(movie.duration_minutes)}
                  </span>
                )}
                {movie.language && (
                  <span className="inline-flex items-center gap-1.5 bg-neutral-700 text-white text-sm px-3 py-1.5 rounded-full">
                    <Globe className="w-3.5 h-3.5" />
                    {movie.language}
                  </span>
                )}
                {movie.subtitles && (
                  <span className="inline-flex items-center gap-1.5 bg-neutral-700 text-white text-sm px-3 py-1.5 rounded-full">
                    Subtitles: {movie.subtitles}
                  </span>
                )}
              </div>

              {/* Director */}
              {movie.director && (
                <div className="mb-4">
                  <p className="text-xs text-gray-500 uppercase tracking-widest font-medium mb-1">Director</p>
                  <p className="text-lg text-gray-900 font-medium">{movie.director}</p>
                </div>
              )}

              {/* Cast */}
              {castMembers.length > 0 && (
                <div className="mb-6">
                  <p className="text-xs text-gray-500 uppercase tracking-widest font-medium mb-2">Cast</p>
                  <div className="flex flex-wrap justify-center md:justify-start gap-2">
                    {castMembers.map((member, i) => (
                      <span
                        key={i}
                        className="bg-neutral-700 text-white text-sm px-3 py-1 rounded-full"
                      >
                        {member}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Synopsis */}
              {(movie.synopsis || description) && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-widest font-medium mb-2">Synopsis</p>
                  {movie.synopsis ? (
                    <p className="text-gray-700 leading-relaxed text-sm md:text-base max-w-2xl">
                      {movie.synopsis}
                    </p>
                  ) : (
                    <div
                      className="text-gray-700 leading-relaxed text-sm md:text-base max-w-2xl whitespace-pre-line [&_a]:text-gray-900 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                      dangerouslySetInnerHTML={{ __html: sanitizeRichText(description) }}
                    />
                  )}
                </div>
              )}

              {/* Rating */}
              {movie.rating && (
                <div className="mt-4">
                  <p className="text-xs text-gray-500 uppercase tracking-widest font-medium mb-1">Rating</p>
                  <span className="inline-flex items-center gap-1.5 bg-neutral-700 text-white text-sm px-3 py-1.5 rounded-full">
                    <Star className="w-3.5 h-3.5" /> {movie.rating}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Trailer Section */}
      {trailerEmbedUrl && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          <h2 className="text-2xl font-bold text-[#F15A29] mb-6 font-[family-name:var(--font-space-grotesk)]">
            Trailer
          </h2>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
              <iframe
                src={trailerEmbedUrl}
                className="absolute inset-0 h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title="Movie trailer"
              />
            </div>
          </div>
        </div>
      )}

      {/* Pamphlet Section */}
      {movie.pamphlet_url && /^https?:\/\//i.test(movie.pamphlet_url) && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <a
            href={movie.pamphlet_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-[#F15A29] hover:bg-[#e07d15] text-white font-bold text-sm px-6 py-3 rounded-full transition-colors shadow-sm"
          >
            <Globe className="w-4 h-4" /> Download Pamphlet
          </a>
        </div>
      )}

      {/* Showings Section */}
      {futureOccurrences.length > 0 && (
        <div className="border-t border-gray-100">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
            <h2 className="text-2xl font-bold text-slate-900 mb-6 font-[family-name:var(--font-space-grotesk)]">
              <span className="text-[#F15A29]">Upcoming</span> Screenings
            </h2>
            <div className="flex flex-col gap-4">
              {futureOccurrences.map((occ: any) => (
                <div
                  key={occ.id}
                  className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-[#F15A29]/30 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start gap-4">
                    {/* Date box */}
                    <div className="flex-shrink-0 border border-gray-200 rounded-lg px-3 py-2 text-center min-w-[60px] shadow-sm">
                      <span className="block text-[#F15A29] text-[10px] font-bold uppercase tracking-widest">
                        {new Date(occ.starts_at).toLocaleDateString('en-US', { timeZone: tz, month: 'short' }).toUpperCase()}
                      </span>
                      <span className="block text-slate-900 text-xl font-extrabold leading-tight mt-0.5">
                        {new Date(occ.starts_at).toLocaleDateString('en-US', { timeZone: tz, day: 'numeric' })}
                      </span>
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-slate-900">{formatDate(occ.starts_at)}</p>
                      <p className="text-sm text-[#F15A29] font-medium mt-0.5">{formatTime(occ.starts_at)}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-700">
                        {(occ.venue_name || event.venue_name) && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {occ.venue_name || event.venue_name}
                          </span>
                        )}
                        {event.city && (
                          <span className="flex items-center gap-1">
                            <Globe className="w-3 h-3" />
                            {event.city}
                          </span>
                        )}
                      </div>
                      {occ.label && (
                        <p className="text-xs text-gray-700 mt-1">{occ.label}</p>
                      )}
                    </div>
                  </div>

                  {/* ?occ= carries THIS screening into checkout; the checkout
                      page redirects seated movies to /checkout/[id]/seats with
                      the occ preserved (S3). */}
                  <GetTicketsButton
                    href={`/checkout/${event.id}?occ=${encodeURIComponent(occ.id)}`}
                    className="flex-shrink-0 bg-[#F15A29] hover:bg-[#d6420f] text-white font-bold text-sm px-6 py-2.5 rounded-full transition-colors text-center shadow-sm"
                  />
                </div>
              ))}
            </div>
            {blockedBuyer && showBuyBlock && <BlockedBuyerNotice className="mt-4" />}
          </div>
        </div>
      )}

      {/* No showings - still allow ticket purchase */}
      {futureOccurrences.length === 0 && (
        <div className="border-t border-gray-100">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 text-center">
            <p className="text-gray-700 mb-4">No upcoming screenings scheduled yet.</p>
            <GetTicketsButton
              href={`/checkout/${event.id}`}
              className="inline-block bg-[#F15A29] hover:bg-[#d6420f] text-white font-bold text-sm px-8 py-3 rounded-full transition-colors shadow-sm"
            />
            {blockedBuyer && showBuyBlock && <BlockedBuyerNotice className="mt-4" />}
          </div>
        </div>
      )}

      {/* Sponsors (tiered sections) */}
      {sponsorSections.length > 0 && (
        <div className="border-t border-gray-100">
          <SponsorSections sections={sponsorSections} />
        </div>
      )}

      {/* Similar Movies */}
      {similarMovies.length > 0 && (
        <div className="border-t border-gray-100 bg-gray-50/50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
            <h2 className="text-2xl font-bold text-slate-900 mb-6 font-[family-name:var(--font-space-grotesk)]">
              You Might Also Like
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5">
              {similarMovies.map((m: SimilarMovie) => {
                const detail = getMovieDetail(m);
                return (
                  <MovieCard
                    key={m.id}
                    slug={m.slug}
                    title={m.title}
                    posterUrl={detail.poster_url || m.cover_image_url}
                    genre={detail.genre}
                    durationMinutes={detail.duration_minutes}
                    city={m.city}
                    directorName={detail.director}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
