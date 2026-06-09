'use client';

import { useState } from 'react';
import Link from 'next/link';

interface CalMovie {
  id: string;
  title: string;
  slug: string;
  cover_image_url?: string;
  city?: string;
  event_occurrences?: { starts_at: string }[];
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // back to Sunday
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function GifftCalendar({ movies }: { movies: CalMovie[] }) {
  // Flatten every (movie, showtime) pair
  const shows = movies
    .flatMap((m) =>
      (m.event_occurrences ?? []).map((o) => ({ movie: m, start: new Date(o.starts_at) }))
    )
    .filter((s) => !isNaN(s.start.getTime()));

  // Default to the week of the earliest upcoming show (else earliest overall, else today)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const allStarts = shows.map((s) => s.start).sort((a, b) => a.getTime() - b.getTime());
  const upcoming = allStarts.find((d) => d >= today);
  const anchor = upcoming ?? allStarts[0] ?? today;

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(anchor));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  function showsForDay(day: Date) {
    const onDay = shows.filter((s) => sameDay(s.start, day));
    const byMovie = new Map<string, { movie: CalMovie; times: Date[] }>();
    for (const s of onDay) {
      const entry = byMovie.get(s.movie.id) ?? { movie: s.movie, times: [] };
      entry.times.push(s.start);
      byMovie.set(s.movie.id, entry);
    }
    return Array.from(byMovie.values()).map((e) => ({
      movie: e.movie,
      times: e.times.sort((a, b) => a.getTime() - b.getTime()),
    }));
  }

  const fmtTime = (d: Date) =>
    d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  const rangeLabel = `${weekStart.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  })} – ${addDays(weekStart, 6).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  if (shows.length === 0) {
    return (
      <p className="text-center text-gray-500 py-12">No scheduled showtimes yet.</p>
    );
  }

  return (
    <div>
      {/* Week navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => setWeekStart((w) => addDays(w, -7))}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50"
        >
          ‹ Prev
        </button>
        <span className="text-sm font-semibold text-slate-700">{rangeLabel}</span>
        <button
          type="button"
          onClick={() => setWeekStart((w) => addDays(w, 7))}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50"
        >
          Next ›
        </button>
      </div>

      {/* Week grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
        {days.map((day, i) => {
          const items = showsForDay(day);
          const isToday = sameDay(day, new Date());
          return (
            <div
              key={i}
              className={`rounded-xl border p-3 min-h-[130px] ${
                isToday ? 'border-[#F15A29] bg-[#F15A29]/5' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="text-center mb-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {DAY_LABELS[day.getDay()]}
                </div>
                <div
                  className={`text-lg font-bold ${
                    isToday ? 'text-[#F15A29]' : 'text-slate-800'
                  }`}
                >
                  {day.getDate()}
                </div>
              </div>
              {items.length === 0 ? (
                <p className="text-xs text-gray-300 text-center mt-3">—</p>
              ) : (
                <div className="space-y-2">
                  {items.map(({ movie, times }) => (
                    <Link
                      key={movie.id}
                      href={`/gifft/${movie.slug}`}
                      className="block rounded-lg bg-gray-50 hover:bg-gray-100 p-2 transition-colors"
                    >
                      <div className="text-xs font-semibold text-slate-800 line-clamp-2">
                        {movie.title}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {times.map((t, j) => (
                          <span
                            key={j}
                            className="text-[10px] font-medium bg-[#F15A29]/10 text-[#F15A29] px-1.5 py-0.5 rounded"
                          >
                            {fmtTime(t)}
                          </span>
                        ))}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
