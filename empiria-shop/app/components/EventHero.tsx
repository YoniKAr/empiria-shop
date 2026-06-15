import { Calendar, MapPin, Users, Monitor } from "lucide-react"
import { formatEventDateTime, tzAbbreviation, DEFAULT_TZ } from "@/lib/datetime"

interface CoOrganizer {
    name: string
    avatarUrl?: string | null
}

interface EventHeroProps {
    title: string
    coverImageUrl: string
    startAt: string
    endAt?: string
    /** Future occurrences beyond the one shown — renders a "+N more dates" hint. */
    moreDatesCount?: number
    venueName: string
    city: string
    addressText?: string | null
    /** Online/virtual events show "Online event" instead of a maps link. */
    isOnline?: boolean
    organizer: string
    organizerAvatarUrl?: string | null
    coOrganizers?: CoOrganizer[]
    category: string
    attendeeCount?: number
    /** Event's IANA timezone — all date/time displays render in this zone with its label. */
    timezone: string
}

function AvatarCircle({ name, avatarUrl, size }: { name: string; avatarUrl?: string | null; size: "md" | "sm" }) {
    const cls = size === "md" ? "w-7 h-7 text-xs" : "w-5 h-5 text-[10px]"
    if (avatarUrl) {
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
                src={avatarUrl}
                alt={name}
                className={`${cls} rounded-full object-cover ring-1 ring-white/40 shrink-0`}
            />
        )
    }
    return (
        <span
            className={`${cls} rounded-full bg-[#F15A29] text-white font-semibold flex items-center justify-center shrink-0 ring-1 ring-white/40`}
        >
            {name.charAt(0).toUpperCase()}
        </span>
    )
}

export function EventHero({
    title,
    coverImageUrl,
    startAt,
    endAt,
    moreDatesCount = 0,
    venueName,
    city,
    addressText,
    isOnline = false,
    organizer,
    organizerAvatarUrl,
    coOrganizers = [],
    category,
    attendeeCount,
    timezone,
}: EventHeroProps) {
    const tz = timezone || DEFAULT_TZ
    const start = new Date(startAt)
    const end = endAt ? new Date(endAt) : null

    // Long-form date line in the event's timezone (no time): "Sunday, November 29, 2026".
    const formattedDate = formatEventDateTime(startAt, tz, {
        withWeekday: true,
        withYear: true,
        withTime: false,
        longMonth: true,
    })

    // Bare clock time (no date, no tz) in the event zone, e.g. "7:00 PM".
    const clock = (d: Date) =>
        d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
    const tzLabel = tzAbbreviation(startAt, tz)
    const startTime = clock(start)

    // Same-calendar-day check must use the EVENT's tz, not the server's.
    const eventDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz })
    // Default (no end): "7:00 PM EST".
    let timeRange = `${startTime} ${tzLabel}`
    if (end && end.getTime() > start.getTime()) {
        if (eventDay(start) === eventDay(end)) {
            // Same day: "7:00 PM – 9:00 PM EST".
            timeRange = `${startTime} – ${clock(end)} ${tzLabel}`
        } else {
            // Cross-day: "7:00 PM – Sun, Nov 30, 11:00 PM EST".
            const endDateShort = formatEventDateTime(endAt, tz, {
                withWeekday: true,
                withYear: false,
                withTime: false,
                longMonth: false,
            })
            timeRange = `${startTime} – ${endDateShort}, ${clock(end)} ${tzLabel}`
        }
    }

    const mapsQuery = [venueName, addressText, city].filter(Boolean).join(", ")
    const directionsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`

    return (
        <section className="relative min-h-[380px] md:min-h-[460px] overflow-hidden" aria-label="Event banner">
            {/* Background Image */}
            <img
                src={coverImageUrl}
                alt={`Cover image for ${title}`}
                className="absolute inset-0 w-full h-full object-cover"
            />

            {/* Overlay layers — dark imagery, so all hero text is white/near-white */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#1a1a1a] via-[#1a1a1a]/75 to-[#1a1a1a]/25" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#1a1a1a]/60 to-transparent" />

            {/* Content */}
            <div className="relative z-10 flex flex-col justify-end min-h-[380px] md:min-h-[460px] max-w-6xl mx-auto px-4 sm:px-6 pt-28 pb-10 md:pb-14">
                <div className="flex flex-col gap-4 md:gap-5">
                    {/* Category badge */}
                    <div>
                        <span className="inline-block bg-[#F15A29] text-white px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest">
                            {category}
                        </span>
                    </div>

                    {/* Title */}
                    <h1 className="text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-bold text-white leading-tight tracking-tight text-balance font-[family-name:var(--font-space-grotesk)]">
                        {title}
                    </h1>

                    {/* Detail block — When / Where / Organized by */}
                    <div className="flex flex-col gap-3 max-w-2xl">
                        {/* When */}
                        <div className="flex items-start gap-2.5">
                            <Calendar className="w-4 h-4 mt-0.5 text-[#F15A29] shrink-0" />
                            <p className="text-sm md:text-base text-white font-medium">
                                {formattedDate}
                                <span className="text-white/85"> &middot; {timeRange}</span>
                                {moreDatesCount > 0 && (
                                    <span className="ml-2 text-xs font-semibold text-white/75">
                                        +{moreDatesCount} more date{moreDatesCount !== 1 ? "s" : ""}
                                    </span>
                                )}
                            </p>
                        </div>

                        {/* Where */}
                        {isOnline ? (
                            <div className="flex items-start gap-2.5">
                                <Monitor className="w-4 h-4 mt-0.5 text-[#F15A29] shrink-0" />
                                <p className="text-sm md:text-base text-white font-medium">Online event</p>
                            </div>
                        ) : (
                            <a
                                href={directionsHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group flex items-start gap-2.5 w-fit"
                            >
                                <MapPin className="w-4 h-4 mt-0.5 text-[#F15A29] shrink-0" />
                                <span>
                                    <span className="block text-sm md:text-base text-white font-medium group-hover:underline underline-offset-4 decoration-white/60">
                                        {venueName}
                                        {(addressText || city) && (
                                            <span className="text-white/85"> &middot; {addressText || city}</span>
                                        )}
                                    </span>
                                    <span className="mt-0.5 block text-xs text-white/75 group-hover:text-white transition-colors">
                                        Click for directions &rarr;
                                    </span>
                                </span>
                            </a>
                        )}

                        {/* Organized by — label first, then pfp + name */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                            <span className="text-sm md:text-base text-white/85">Organized by</span>
                            <AvatarCircle name={organizer} avatarUrl={organizerAvatarUrl} size="md" />
                            <span className="text-sm md:text-base font-semibold text-white">{organizer}</span>
                            {coOrganizers.length > 0 && (
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-white/85">
                                    <span>with</span>
                                    {coOrganizers.map((co, i) => (
                                        <span key={`${co.name}-${i}`} className="flex items-center gap-1.5">
                                            <AvatarCircle name={co.name} avatarUrl={co.avatarUrl} size="sm" />
                                            <span className="font-medium text-white">
                                                {co.name}
                                                {i < coOrganizers.length - 1 ? "," : ""}
                                            </span>
                                        </span>
                                    ))}
                                </span>
                            )}
                        </div>

                        {attendeeCount ? (
                            <div className="flex items-center gap-2.5">
                                <Users className="w-4 h-4 text-[#F15A29] shrink-0" />
                                <span className="text-sm text-white/85">
                                    {attendeeCount.toLocaleString()} attending
                                </span>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </section>
    )
}
