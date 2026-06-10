"use client";

import Link from "next/link";
import { Download } from "lucide-react";
import { EventCard } from "@/app/components/EventCard";
import { getCurrencySymbol } from "@/lib/utils";
import SponsorSections from "@/app/components/SponsorSections";
import { isSafeUrl, type SponsorSection } from "@/lib/eventFields";

interface SpecialPageContentProps {
  page: {
    title: string;
    subtitle: string | null;
    description: string | null;
    hero_media_url: string | null;
    hero_media_type: "image" | "video";
    pamphlet_url: string | null;
    events_bg_url: string | null;
    events_section_title: string | null;
    sponsor_sections: SponsorSection[] | null;
    category: { name: string } | null;
  };
  events: Array<{
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
    organizer_name?: string;
  }>;
}

function getEmbedUrl(url: string): string | null {
  const ytMatch = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
  );
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  return null;
}

export function SpecialPageContent({ page, events }: SpecialPageContentProps) {
  return (
    <>
      {/* ── HERO SECTION ── */}
      {page.hero_media_type === "image" && page.hero_media_url ? (
        <section className="relative w-full aspect-video overflow-hidden flex items-end">
          <img
            src={page.hero_media_url}
            alt={page.title}
            className="w-full h-full object-cover absolute inset-0"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-black/20" />
          <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 pb-16 pt-32">
            {page.category && (
              <span className="inline-block bg-[#F15A29] text-white text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wider mb-4">
                {page.category.name}
              </span>
            )}
            <h1 className="text-4xl md:text-6xl font-extrabold text-white leading-tight">
              {page.title}
            </h1>
            {page.subtitle && (
              <p className="text-lg text-white/80 mt-3 max-w-2xl">
                {page.subtitle}
              </p>
            )}
          </div>
        </section>
      ) : page.hero_media_type === "video" && page.hero_media_url ? (
        <section className="bg-[#1a1a1a] py-16">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            {(() => {
              const embedUrl = getEmbedUrl(page.hero_media_url!);
              return embedUrl ? (
                <div className="aspect-video rounded-2xl overflow-hidden">
                  <iframe
                    src={embedUrl}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title={page.title}
                  />
                </div>
              ) : null;
            })()}
            <div className="text-center mt-10">
              {page.category && (
                <span className="inline-block bg-[#F15A29] text-white text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wider mb-4">
                  {page.category.name}
                </span>
              )}
              <h1 className="text-4xl md:text-6xl font-extrabold text-white leading-tight">
                {page.title}
              </h1>
              {page.subtitle && (
                <p className="text-lg text-white/80 mt-3 max-w-2xl mx-auto">
                  {page.subtitle}
                </p>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="bg-gradient-to-b from-[#1a1a1a] to-[#2d1f0f] py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center">
            {page.category && (
              <span className="inline-block bg-[#F15A29] text-white text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wider mb-4">
                {page.category.name}
              </span>
            )}
            <h1 className="text-4xl md:text-6xl font-extrabold text-white leading-tight">
              {page.title}
            </h1>
            {page.subtitle && (
              <p className="text-lg text-white/80 mt-3 max-w-2xl mx-auto">
                {page.subtitle}
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── DESCRIPTION SECTION ── */}
      {page.description && (
        <section className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
          <p className="text-lg text-slate-600 leading-relaxed whitespace-pre-line">
            {page.description}
          </p>
        </section>
      )}

      {/* ── PDF / PAMPHLET SECTION ── */}
      {page.pamphlet_url && isSafeUrl(page.pamphlet_url) && (
        <section className="max-w-4xl mx-auto px-4 sm:px-6 pb-16">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Event Pamphlet
          </h2>
          <iframe
            src={page.pamphlet_url}
            className="w-full aspect-[3/4] rounded-xl border border-slate-200"
            title="Event Pamphlet"
          />
          <a
            href={page.pamphlet_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-[#F15A29] text-white rounded-full font-medium text-sm hover:brightness-110 transition"
          >
            <Download className="w-4 h-4" />
            Download Pamphlet
          </a>
        </section>
      )}

      {/* ── EVENTS SECTION ── */}
      <section className="relative py-20">
        {page.events_bg_url && isSafeUrl(page.events_bg_url) ? (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url("${page.events_bg_url}")` }}
            />
            <div className="absolute inset-0 bg-black/60" />
          </>
        ) : (
          <div className="absolute inset-0 bg-[#1a1a1a]" />
        )}

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6">
          <h2 className="text-3xl font-bold text-white text-center mb-12">
            {page.events_section_title ||
              `${page.category?.name || ""} Events`}
          </h2>

          {events.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {events.map((event) => {
                const prices =
                  event.ticket_tiers?.map((t) => t.price) || [];
                const minPrice =
                  prices.length > 0 ? Math.min(...prices) : 0;
                const currency = event.currency || "cad";
                const symbol = getCurrencySymbol(currency);

                const occs = [...(event.event_occurrences || [])].sort(
                  (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
                );
                const startAt = occs[0]?.starts_at || undefined;

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
                    minPrice={minPrice}
                    currencySymbol={symbol}
                    organizerName={event.organizer_name}
                  />
                );
              })}
            </div>
          ) : (
            <p className="text-white/60 text-center text-lg">
              No events in this category yet.
            </p>
          )}
        </div>
      </section>

      {/* ── SPONSORS SECTION ── */}
      <SponsorSections sections={page.sponsor_sections ?? []} />

      {/* ── BACK LINK ── */}
      <div className="text-center py-12">
        <Link
          href="/"
          className="text-[#F15A29] font-medium hover:underline"
        >
          &larr; Back to All Events
        </Link>
      </div>
    </>
  );
}
