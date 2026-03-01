import { Clock, MapPin, Info, Share2 } from "lucide-react"

interface EventDetailsProps {
    description: string
    startAt: string
    endAt: string
    venueName: string
    city: string
    organizer: string
}

export function EventDetails({
    description,
    startAt,
    endAt,
    venueName,
    city,
    organizer,
}: EventDetailsProps) {
    const formatDateTime = (date: string) =>
        new Date(date).toLocaleString("en-IN", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })

    return (
        <div className="flex flex-col gap-10">
            {/* Quick info cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center">
                        <Clock className="w-5 h-5 text-[#F98C1F]" />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-1">When</p>
                        <p className="text-sm text-gray-900 font-medium">{formatDateTime(startAt)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">to {formatDateTime(endAt)}</p>
                    </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center">
                        <MapPin className="w-5 h-5 text-[#F98C1F]" />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-1">Where</p>
                        <p className="text-sm text-gray-900 font-medium">{venueName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{city}</p>
                    </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center">
                        <Info className="w-5 h-5 text-[#F98C1F]" />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-1">Organized by</p>
                        <p className="text-sm text-gray-900 font-medium">{organizer}</p>
                    </div>
                </div>
            </div>

            {/* About section */}
            <div>
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-[#F98C1F] font-[family-name:var(--font-space-grotesk)]">
                        About This Event
                    </h2>
                    <button
                        className="flex items-center gap-2 text-sm text-gray-500 hover:text-[#F98C1F] transition-colors"
                        aria-label="Share event"
                    >
                        <Share2 className="w-4 h-4" />
                        Share
                    </button>
                </div>
                <div className="prose max-w-none">
                    <p className="text-gray-600 leading-relaxed text-base">{description}</p>
                </div>
            </div>

            {/* Highlights */}
            <div>
                <h3 className="text-lg font-semibold text-[#F98C1F] mb-4 font-[family-name:var(--font-space-grotesk)]">
                    What to Expect
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                        "Live performances from world-class artists",
                        "Immersive audio-visual experience",
                        "Food & beverage options available",
                        "Safe and secure venue with easy access",
                    ].map((highlight) => (
                        <div
                            key={highlight}
                            className="flex items-center gap-3 text-sm text-gray-600"
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-[#F98C1F] flex-shrink-0" />
                            {highlight}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
