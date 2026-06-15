'use client';

import Link from 'next/link';
import { DEFAULT_TZ, tzAbbreviation } from '@/lib/datetime';

interface CalMovie {
  id: string;
  title: string;
  slug: string;
  posterUrl?: string;
  timezone?: string;
  event_occurrences?: { starts_at: string; is_cancelled?: boolean }[];
}

interface DayGroup {
  /** Calendar day, 'YYYY-MM-DD' (in the day-group's timezone). */
  key: string;
  /** Representative instant within the day (first show seen) — for sorting/format. */
  date: Date;
  /** Timezone of the first show seen for the day — used for the day header. */
  tz: string;
  items: Map<string, { movie: CalMovie; tz: string; times: Date[] }>;
}

export default function GifftCalendar({ movies }: { movies: CalMovie[] }) {
  // Flatten every (movie, showtime) pair, carrying that movie's own timezone.
  // Defensively hide cancelled and already-started showtimes.
  const now = Date.now();
  const shows = movies
    .flatMap((m) =>
      (m.event_occurrences ?? [])
        .filter((o) => !o.is_cancelled)
        .map((o) => ({
          movie: m,
          start: new Date(o.starts_at),
          tz: m.timezone || DEFAULT_TZ,
        }))
    )
    .filter((s) => !isNaN(s.start.getTime()) && s.start.getTime() >= now);

  if (shows.length === 0) {
    return <p className="text-center text-gray-700 py-12">No scheduled showtimes yet.</p>;
  }

  // Group shows by calendar day IN EACH SHOW'S OWN TIMEZONE — a 7pm
  // America/New_York show and a 7pm America/Toronto show land on the correct
  // local day for each. en-CA yields 'YYYY-MM-DD'.
  const dayKey = (d: Date, tz: string) => d.toLocaleDateString('en-CA', { timeZone: tz });
  const dayMap = new Map<string, DayGroup>();
  for (const s of shows) {
    const key = dayKey(s.start, s.tz);
    let day = dayMap.get(key);
    if (!day) {
      // Header uses the first show's tz for this day.
      day = { key, date: s.start, tz: s.tz, items: new Map() };
      dayMap.set(key, day);
    }
    let item = day.items.get(s.movie.id);
    if (!item) {
      item = { movie: s.movie, tz: s.tz, times: [] };
      day.items.set(s.movie.id, item);
    }
    item.times.push(s.start);
  }

  const days = Array.from(dayMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  // Showtime chip: time-only + the show's tz label (e.g. "7:00 PM EST").
  const fmtTime = (d: Date, tz: string) => {
    const time = d.toLocaleTimeString('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${time} ${tzAbbreviation(d.toISOString(), tz)}`;
  };

  return (
    <div className="divide-y divide-gray-100 border border-gray-100 rounded-2xl overflow-hidden">
      {days.map((day) => {
        const isToday = day.key === dayKey(new Date(), day.tz);
        const items = Array.from(day.items.values()).map((it) => ({
          movie: it.movie,
          tz: it.tz,
          times: it.times.sort((a, b) => a.getTime() - b.getTime()),
        }));
        return (
          <div key={day.key} className="flex flex-col sm:flex-row gap-4 p-4 sm:p-5">
            {/* Date column */}
            <div className="sm:w-44 flex-shrink-0 flex sm:flex-col items-baseline sm:items-start gap-2 sm:gap-0.5">
              <div
                className={`text-xs font-semibold uppercase tracking-wide ${
                  isToday ? 'text-[#F15A29]' : 'text-gray-700'
                }`}
              >
                {day.date.toLocaleDateString('en-CA', { timeZone: day.tz, weekday: 'long' })}
              </div>
              <div className={`text-2xl font-bold ${isToday ? 'text-[#F15A29]' : 'text-slate-800'}`}>
                {day.date.toLocaleDateString('en-CA', { timeZone: day.tz, month: 'short', day: 'numeric' })}
              </div>
              {isToday && (
                <span className="text-[10px] font-bold text-[#F15A29] bg-[#F15A29]/10 px-2 py-0.5 rounded-full">
                  Today
                </span>
              )}
            </div>

            {/* Movies playing that day */}
            <div className="flex-1 space-y-3">
              {items.map(({ movie, tz, times }) => (
                <Link
                  key={movie.id}
                  href={`/gifft/${movie.slug}`}
                  className="flex items-center gap-3 rounded-xl border border-gray-100 hover:border-[#F15A29]/40 hover:bg-gray-50 p-2.5 transition-colors"
                >
                  <div className="w-12 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
                    {movie.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={movie.posterUrl}
                        alt={movie.title}
                        className="w-full h-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900 text-sm truncate">{movie.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {times.map((t, j) => (
                        <span
                          key={j}
                          className="text-[11px] font-medium bg-[#F15A29]/10 text-[#F15A29] px-2 py-0.5 rounded"
                        >
                          {fmtTime(t, tz)}
                        </span>
                      ))}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
