import Link from 'next/link';
import Image from 'next/image';

interface MovieCardProps {
  slug: string;
  title: string;
  posterUrl?: string;
  genre?: string;
  durationMinutes?: number;
  city?: string;
  directorName?: string;
}

export default function MovieCard({
  slug,
  title,
  posterUrl,
  genre,
  durationMinutes,
  city,
  directorName,
}: MovieCardProps) {
  const formatDuration = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <Link href={`/gifft/${slug}`} className="group block h-full">
      <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 h-full flex flex-col">
        {/* Poster Image - 2:3 aspect ratio */}
        <div className="aspect-[2/3] relative overflow-hidden bg-gray-100">
          {posterUrl ? (
            <Image
              src={posterUrl}
              alt={title}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-500"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              unoptimized
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-slate-800 via-slate-700 to-slate-900 flex items-center justify-center">
              <div className="text-center px-4">
                <svg className="w-12 h-12 text-white/30 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
                <span className="text-white/40 text-xs font-medium">{title}</span>
              </div>
            </div>
          )}

          {/* City badge */}
          {city && (
            <div className="absolute top-3 left-3">
              <span className="bg-black/70 backdrop-blur-sm text-white text-[10px] font-semibold px-2.5 py-1 rounded-full">
                {city}
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col flex-1">
          <h3 className="font-bold text-[15px] text-slate-900 leading-tight group-hover:text-[#F15A29] transition-colors line-clamp-2 mb-2">
            {title}
          </h3>

          {/* Genre + Duration badges */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {genre && (
              <span className="bg-orange-50 text-[#F15A29] text-[10px] font-semibold px-2 py-0.5 rounded-md">
                {genre}
              </span>
            )}
            {durationMinutes && (
              <span className="bg-gray-100 text-gray-600 text-[10px] font-semibold px-2 py-0.5 rounded-md">
                {formatDuration(durationMinutes)}
              </span>
            )}
          </div>

          {/* Director */}
          {directorName && (
            <p className="text-xs text-gray-400 mt-auto line-clamp-1">
              Dir. {directorName}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
