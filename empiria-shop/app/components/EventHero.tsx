import { Calendar, MapPin, Users } from "lucide-react"

interface EventHeroProps {
    title: string
    coverImageUrl: string
    startAt: string
    venueName: string
    city: string
    category: string
    attendeeCount?: number
}

export function EventHero({
    title,
    coverImageUrl,
    startAt,
    venueName,
    city,
    category,
    attendeeCount,
}: EventHeroProps) {
    const formattedDate = new Date(startAt).toLocaleDateString("en-IN", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    })

    const formattedTime = new Date(startAt).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
    })

    return (
        <section className="relative h-[520px] md:h-[600px] overflow-hidden" aria-label="Event banner">
            {/* Background Image */}
            <img
                src={coverImageUrl}
                alt={`Cover image for ${title}`}
                className="absolute inset-0 w-full h-full object-cover"
            />

            {/* Overlay layers */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#1a1a1a] via-[#1a1a1a]/70 to-[#1a1a1a]/20" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#1a1a1a]/60 to-transparent" />

            {/* Content */}
            <div className="relative z-10 flex flex-col justify-end h-full max-w-6xl mx-auto px-6 pb-12 md:pb-16">
                <div className="flex flex-col gap-5">
                    {/* Category badge */}
                    <div>
                        <span className="inline-block bg-[#F98C1F] text-white px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest">
                            {category}
                        </span>
                    </div>

                    {/* Title */}
                    <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white leading-tight tracking-tight text-balance font-[family-name:var(--font-space-grotesk)]">
                        {title}
                    </h1>

                    {/* Meta info */}
                    <div className="flex flex-wrap gap-6 text-sm md:text-base text-white/80">
                        <div className="flex items-center gap-2.5">
                            <Calendar className="w-4 h-4 text-[#F98C1F]" />
                            <span>
                                {formattedDate} &middot; {formattedTime}
                            </span>
                        </div>
                        <div className="flex items-center gap-2.5">
                            <MapPin className="w-4 h-4 text-[#F98C1F]" />
                            <span>
                                {venueName}, {city}
                            </span>
                        </div>
                        {attendeeCount && (
                            <div className="flex items-center gap-2.5">
                                <Users className="w-4 h-4 text-[#F98C1F]" />
                                <span>{attendeeCount.toLocaleString()} attending</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    )
}
