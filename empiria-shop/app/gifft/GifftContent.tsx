'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useState, useEffect } from 'react';
import Image from 'next/image';
import MovieCard from '@/app/components/MovieCard';

const GIFFT_SLIDES = [
  '/gifft/slide-1.jpg',
  '/gifft/slide-2.jpg',
  '/gifft/slide-3.jpg',
  '/gifft/slide-4.jpg',
];

interface City {
  id: string;
  name: string;
  slug: string;
  banner_url?: string;
  is_active: boolean;
  display_order: number;
}

interface MovieDetail {
  director?: string;
  cast_members?: string[];
  genre?: string;
  duration_minutes?: number;
  synopsis?: string;
  poster_url?: string;
  language?: string;
  subtitles?: string;
  rating?: string;
}

interface Movie {
  id: string;
  title: string;
  slug: string;
  city?: string;
  cover_image_url?: string;
  currency?: string;
  event_occurrences?: { starts_at: string }[];
  gifft_movie_details?: MovieDetail[] | MovieDetail;
}

interface FeaturedMovie {
  id: string;
  city_id: string;
  event_id: string;
  display_order: number;
  events?: Movie;
}

interface Sponsor {
  id: string;
  city_id: string;
  name: string;
  logo_url?: string;
  website_url?: string;
  display_order: number;
}

interface GifftContentProps {
  cities: City[];
  movies: Movie[];
  featured: FeaturedMovie[];
  sponsors: Sponsor[];
}

function GifftContentInner({ cities, movies, featured, sponsors }: GifftContentProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedCitySlug = searchParams.get('city') || '';

  const selectedCity = cities.find((c) => c.slug === selectedCitySlug) || null;

  // Hero slideshow
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setSlide((s) => (s + 1) % GIFFT_SLIDES.length),
      5000
    );
    return () => clearInterval(timer);
  }, []);

  // Filter movies by selected city
  const filteredMovies = selectedCity
    ? movies.filter((m) => m.city?.toLowerCase() === selectedCity.name.toLowerCase())
    : movies;

  // Filter featured by city
  const filteredFeatured = selectedCity
    ? featured.filter((f) => f.city_id === selectedCity.id)
    : featured;

  // Filter sponsors by city
  const filteredSponsors = selectedCity
    ? sponsors.filter((s) => s.city_id === selectedCity.id)
    : [];

  const handleCityChange = (slug: string) => {
    if (slug === '') {
      router.push('/gifft', { scroll: false });
    } else {
      router.push(`/gifft?city=${slug}`, { scroll: false });
    }
  };

  const getMovieDetail = (movie: Movie): MovieDetail => {
    if (Array.isArray(movie.gifft_movie_details)) {
      return movie.gifft_movie_details[0] || {};
    }
    return movie.gifft_movie_details || {};
  };

  return (
    <>
      {/* Hero Section — slideshow */}
      <section className="relative overflow-hidden min-h-[85vh] flex items-center bg-slate-900">
        {/* Slideshow background */}
        <div className="absolute inset-0">
          {GIFFT_SLIDES.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt=""
              aria-hidden="true"
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ease-in-out ${
                i === slide ? 'opacity-100' : 'opacity-0'
              }`}
            />
          ))}
          {/* Dark overlay for legibility */}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/95 via-slate-900/70 to-slate-900/55" />
        </div>

        <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 py-20 md:py-28 text-center">
          {/* GIFFT logo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/gifft/gifft-logo-white.png"
            alt="GIFFT"
            className="mx-auto h-16 md:h-24 w-auto mb-6 drop-shadow-lg"
          />
          <p className="text-xl md:text-2xl text-white/80 mb-3 font-medium">
            Greek International Film Festival Tour of Canada
          </p>
          <p className="text-base text-white/60 max-w-lg mx-auto">
            Discover movies playing in cities across Canada
          </p>
          {/* Slide indicators */}
          <div className="flex items-center justify-center gap-2 mt-8">
            {GIFFT_SLIDES.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => setSlide(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === slide ? 'w-6 bg-[#F15A29]' : 'w-1.5 bg-white/40 hover:bg-white/60'
                }`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* City Tabs */}
      <div className="sticky top-16 z-40 bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div
            className="flex gap-1 overflow-x-auto py-3 scrollbar-hide"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            <button
              onClick={() => handleCityChange('')}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                !selectedCitySlug
                  ? 'bg-[#F15A29] text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All Cities
            </button>
            {cities.map((city) => (
              <button
                key={city.id}
                onClick={() => handleCityChange(city.slug)}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  selectedCitySlug === city.slug
                    ? 'bg-[#F15A29] text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {city.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        {/* City Banner */}
        {selectedCity?.banner_url && (
          <div className="relative w-full h-48 md:h-64 rounded-2xl overflow-hidden mb-10">
            <Image
              src={selectedCity.banner_url}
              alt={`${selectedCity.name} banner`}
              fill
              className="object-cover"
              unoptimized
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-6 left-6">
              <h2 className="text-3xl md:text-4xl font-bold text-white font-[family-name:var(--font-space-grotesk)]">
                {selectedCity.name}
              </h2>
            </div>
          </div>
        )}

        {/* City Sponsors */}
        {filteredSponsors.length > 0 && (
          <div className="mb-10">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">
              City Sponsors
            </h3>
            <div
              className="flex gap-6 overflow-x-auto pb-2 items-center"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {filteredSponsors.map((sponsor) => (
                <a
                  key={sponsor.id}
                  href={sponsor.website_url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 h-16 px-6 flex items-center justify-center bg-white border border-gray-100 rounded-xl shadow-sm hover:shadow-md transition-shadow"
                >
                  {sponsor.logo_url ? (
                    <Image
                      src={sponsor.logo_url}
                      alt={sponsor.name}
                      width={120}
                      height={48}
                      className="object-contain max-h-10"
                      unoptimized
                    />
                  ) : (
                    <span className="text-sm font-medium text-gray-600">{sponsor.name}</span>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Featured Movies */}
        {filteredFeatured.length > 0 && (
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-slate-900 mb-6 font-[family-name:var(--font-space-grotesk)]">
              <span className="text-[#F15A29]">Featured</span> Movies
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
              {filteredFeatured.map((f) => {
                const movie = f.events;
                if (!movie) return null;
                const detail = getMovieDetail(movie);
                return (
                  <MovieCard
                    key={f.id}
                    slug={movie.slug}
                    title={movie.title}
                    posterUrl={detail.poster_url || movie.cover_image_url}
                    genre={detail.genre}
                    durationMinutes={detail.duration_minutes}
                    city={movie.city}
                    directorName={detail.director}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* All Movies */}
        <div>
          <h2 className="text-2xl font-bold text-slate-900 mb-6 font-[family-name:var(--font-space-grotesk)]">
            {selectedCity ? `Movies in ${selectedCity.name}` : 'All Movies'}
          </h2>

          {filteredMovies.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
              {filteredMovies.map((movie) => {
                const detail = getMovieDetail(movie);
                return (
                  <MovieCard
                    key={movie.id}
                    slug={movie.slug}
                    title={movie.title}
                    posterUrl={detail.poster_url || movie.cover_image_url}
                    genre={detail.genre}
                    durationMinutes={detail.duration_minutes}
                    city={movie.city}
                    directorName={detail.director}
                  />
                );
              })}
            </div>
          ) : (
            <div className="text-center py-20">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              </div>
              <p className="text-gray-500 text-lg font-medium">No movies available yet.</p>
              <p className="text-gray-400 text-sm mt-1">Check back soon!</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function GifftContent(props: GifftContentProps) {
  return (
    <Suspense fallback={
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20 text-center">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-48 mx-auto mb-4" />
          <div className="h-4 bg-gray-200 rounded w-64 mx-auto" />
        </div>
      </div>
    }>
      <GifftContentInner {...props} />
    </Suspense>
  );
}
