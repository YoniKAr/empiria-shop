'use client';

import Link from 'next/link';

interface CalMovie {
  id: string;
  title: string;
  slug: string;
  posterUrl?: string;
  event_occurrences?: { starts_at: string }[];
}

interface DayGroup {
  date: Date;
  items: Map<string, { movie: CalMovie; times: Date[] }>;
}

export default function GifftCalendar({ movies }: { movies: CalMovie[] }) {
  // Flatten every (movie, showtime) pair
  const shows = movies
    .flatMap((m) =>
      (m.event_occurrences ?? []).map((o) => ({ movie: m, start: new Date(o.starts_at) }))
    )
    .filter((s) => !isNaN(s.start.getTime()));

  if (shows.length === 0) {
    return <p className="text-center text-gray-700 py-12">No scheduled showtimes yet.</p>;
  }

  // Group shows by day, then by movie (collecting that movie's showtimes for the day)
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const dayMap = new Map<string, DayGroup>();
  for (const s of shows) {
    const key = dayKey(s.start);
    let day = dayMap.get(key);
    if (!day) {
      day = {
        date: new Date(s.start.getFullYear(), s.start.getMonth(), s.start.getDate()),
        items: new Map(),
      };
      dayMap.set(key, day);
    }
    let item = day.items.get(s.movie.id);
    if (!item) {
      item = { movie: s.movie, times: [] };
      day.items.set(s.movie.id, item);
    }
    item.times.push(s.start);
  }

  const days = Array.from(dayMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="divide-y divide-gray-100 border border-gray-100 rounded-2xl overflow-hidden">
      {days.map((day) => {
        const isToday = day.date.getTime() === today.getTime();
        const items = Array.from(day.items.values()).map((it) => ({
          movie: it.movie,
          times: it.times.sort((a, b) => a.getTime() - b.getTime()),
        }));
        return (
          <div key={day.date.toISOString()} className="flex flex-col sm:flex-row gap-4 p-4 sm:p-5">
            {/* Date column */}
            <div className="sm:w-44 flex-shrink-0 flex sm:flex-col items-baseline sm:items-start gap-2 sm:gap-0.5">
              <div
                className={`text-xs font-semibold uppercase tracking-wide ${
                  isToday ? 'text-[#F15A29]' : 'text-gray-700'
                }`}
              >
                {day.date.toLocaleDateString('en-CA', { weekday: 'long' })}
              </div>
              <div className={`text-2xl font-bold ${isToday ? 'text-[#F15A29]' : 'text-slate-800'}`}>
                {day.date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
              </div>
              {isToday && (
                <span className="text-[10px] font-bold text-[#F15A29] bg-[#F15A29]/10 px-2 py-0.5 rounded-full">
                  Today
                </span>
              )}
            </div>

            {/* Movies playing that day */}
            <div className="flex-1 space-y-3">
              {items.map(({ movie, times }) => (
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
                          {fmtTime(t)}
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
