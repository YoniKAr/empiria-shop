"use client"

import { useState } from "react"
import { Clock, MapPin, Info, Share2, X, Copy, Check } from "lucide-react"

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
    const [showShare, setShowShare] = useState(false)
    const [copied, setCopied] = useState(false)

    const formatDateTime = (date: string) =>
        new Date(date).toLocaleString("en-IN", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })

    const eventUrl = typeof window !== "undefined" ? window.location.href : ""

    const handleCopy = () => {
        navigator.clipboard.writeText(eventUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const shareWhatsApp = () => {
        window.open(`https://wa.me/?text=${encodeURIComponent(eventUrl)}`, "_blank")
    }

    const shareInstagram = () => {
        // Instagram doesn't support direct URL sharing — copy link for user to paste
        navigator.clipboard.writeText(eventUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
        alert("Link copied! Open Instagram and paste it in your story or bio.")
    }

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

                    {/* Share button */}
                    <div className="relative">
                        <button
                            onClick={() => setShowShare((v) => !v)}
                            className="flex items-center gap-2 text-sm text-gray-500 hover:text-[#F98C1F] transition-colors"
                            aria-label="Share event"
                        >
                            <Share2 className="w-4 h-4" />
                            Share
                        </button>

                        {/* Share popup */}
                        {showShare && (
                            <>
                                {/* Backdrop */}
                                <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setShowShare(false)}
                                />
                                <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-2xl shadow-xl z-50 overflow-hidden">
                                    {/* Header */}
                                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                                        <p className="text-sm font-semibold text-gray-900">Share this event</p>
                                        <button
                                            onClick={() => setShowShare(false)}
                                            className="text-gray-400 hover:text-gray-600 transition-colors"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>

                                    <div className="p-3 flex flex-col gap-2">
                                        {/* WhatsApp */}
                                        <button
                                            onClick={shareWhatsApp}
                                            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-green-50 transition-colors text-left"
                                        >
                                            <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                                                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                                                    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.555 4.116 1.528 5.843L0 24l6.335-1.652A11.954 11.954 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.892a9.877 9.877 0 01-5.022-1.371l-.36-.214-3.742.977.997-3.645-.234-.374A9.867 9.867 0 012.108 12C2.108 6.561 6.561 2.108 12 2.108S21.892 6.561 21.892 12 17.439 21.892 12 21.892z" />
                                                </svg>
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-gray-900">WhatsApp</p>
                                                <p className="text-xs text-gray-500">Share via WhatsApp</p>
                                            </div>
                                        </button>

                                        {/* Instagram */}
                                        <button
                                            onClick={shareInstagram}
                                            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-pink-50 transition-colors text-left"
                                        >
                                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center flex-shrink-0">
                                                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                                                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                                                </svg>
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-gray-900">Instagram</p>
                                                <p className="text-xs text-gray-500">Copy link for Instagram</p>
                                            </div>
                                        </button>

                                        {/* Copy link */}
                                        <button
                                            onClick={handleCopy}
                                            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors text-left"
                                        >
                                            <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0">
                                                {copied ? (
                                                    <Check className="w-4 h-4 text-white" />
                                                ) : (
                                                    <Copy className="w-4 h-4 text-white" />
                                                )}
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-gray-900">
                                                    {copied ? "Copied!" : "Copy Link"}
                                                </p>
                                                <p className="text-xs text-gray-500">Copy event URL</p>
                                            </div>
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
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
