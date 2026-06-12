"use client"

import { useState } from "react"
import { ExternalLink, Minus, Plus, Ticket } from "lucide-react"
import Link from "next/link"
import StripeBadge from "@/components/StripeBadge"
import { BlockedBuyerNotice } from "@/components/BlockedBuyerNotice"
import { ctaButtonText, isSafeUrl } from "@/lib/eventFields"
import { getCurrencySymbol } from "@/lib/utils"

interface TicketTier {
    id: string
    name: string
    description: string
    price: number
    available: number
    minPerOrder?: number
    maxPerOrder?: number | null
}

interface TicketWidgetProps {
    tiers: TicketTier[]
    eventId: string
    currency?: string
    ctaLabel?: string
    entryType?: string
    externalUrl?: string | null
    sharedCapacity?: boolean
    blockedBuyer?: boolean
}

export function TicketWidget({ tiers, eventId, currency = "cad", ctaLabel, entryType, externalUrl, sharedCapacity, blockedBuyer = false }: TicketWidgetProps) {
    // External events: link out instead of the ticket UI.
    if (entryType === "external") {
        const hasSafeUrl = !!externalUrl && isSafeUrl(externalUrl)
        return (
            <div className="sticky top-24">
                <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-lg shadow-black/5">
                    <div className="bg-[#F15A29] px-6 py-5">
                        <div className="flex items-center gap-3">
                            <ExternalLink className="w-5 h-5 text-white" />
                            <h3 className="font-bold text-lg text-white font-[family-name:var(--font-space-grotesk)]">
                                {ctaButtonText(ctaLabel)}
                            </h3>
                        </div>
                    </div>
                    <div className="px-5 py-6">
                        {hasSafeUrl ? (
                            <a
                                href={externalUrl!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block w-full bg-[#F15A29] text-white text-center py-4 rounded-xl font-bold text-base hover:bg-[#d6420f] active:scale-[0.98] transition-all duration-200 font-[family-name:var(--font-space-grotesk)]"
                            >
                                {ctaButtonText(ctaLabel)}
                            </a>
                        ) : (
                            <p className="text-sm text-gray-700 text-center py-2">
                                This event is hosted externally.
                            </p>
                        )}
                    </div>
                </div>
            </div>
        )
    }

    return <TicketedWidget tiers={tiers} eventId={eventId} currency={currency} ctaLabel={ctaLabel} sharedCapacity={sharedCapacity} blockedBuyer={blockedBuyer} />
}

function TicketedWidget({ tiers, eventId, currency = "cad", ctaLabel, sharedCapacity, blockedBuyer = false }: { tiers: TicketTier[]; eventId: string; currency?: string; ctaLabel?: string; sharedCapacity?: boolean; blockedBuyer?: boolean }) {
    // Per-tier quantities (mix tiers freely, e.g. 2× Adult + 3× Kid).
    const [quantities, setQuantities] = useState<Record<string, number>>({})
    const [shake, setShake] = useState(false)
    const [showBuyBlock, setShowBuyBlock] = useState(false)

    const qtyOf = (tierId: string) => quantities[tierId] ?? 0
    const totalQty = tiers.reduce((s, t) => s + qtyOf(t.id), 0)
    const subtotal = tiers.reduce((s, t) => s + t.price * qtyOf(t.id), 0)
    const selectedLines = tiers.filter((t) => qtyOf(t.id) > 0)
    const sym = getCurrencySymbol(currency)

    // Max purchasable for a tier right now. In shared mode every tier's
    // `available` IS the shared event pool, so cap the running total across
    // all tiers at that pool; otherwise the tier's own remaining applies.
    // max_per_order (when set) caps both modes.
    const capFor = (tier: TicketTier) => {
        const pool = sharedCapacity
            ? Math.max(0, tier.available - (totalQty - qtyOf(tier.id)))
            : tier.available
        return tier.maxPerOrder ? Math.min(pool, tier.maxPerOrder) : pool
    }

    const increase = (tier: TicketTier) => {
        const qty = qtyOf(tier.id)
        const cap = capFor(tier)
        // Jump straight to the tier minimum when going from 0.
        const target = qty === 0 ? Math.max(1, tier.minPerOrder ?? 1) : qty + 1
        setQuantities((prev) => ({ ...prev, [tier.id]: Math.min(cap, target) }))
    }

    const decrease = (tier: TicketTier) => {
        const qty = qtyOf(tier.id)
        const min = Math.max(1, tier.minPerOrder ?? 1)
        // Dropping below the tier minimum clears the tier entirely.
        const next = qty <= min ? 0 : qty - 1
        setQuantities((prev) => ({ ...prev, [tier.id]: next }))
    }

    // Carry the selection to checkout: ?tiers=<tierId>:<qty>,<tierId>:<qty>
    // (zero quantities skipped; checkout validates + clamps server-side).
    const tiersParam = selectedLines
        .map((t) => `${t.id}:${qtyOf(t.id)}`)
        .join(",")
    const checkoutHref =
        totalQty > 0
            ? `/checkout/${eventId}?tiers=${encodeURIComponent(tiersParam)}`
            : `/checkout/${eventId}`

    return (
        <div className="sticky top-24">
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-lg shadow-black/5">
                {/* Header */}
                <div className="bg-[#F15A29] px-6 py-5">
                    <div className="flex items-center gap-3">
                        <Ticket className="w-5 h-5 text-white" />
                        <h3 className="font-bold text-lg text-white font-[family-name:var(--font-space-grotesk)]">
                            {ctaButtonText(ctaLabel)}
                        </h3>
                    </div>
                </div>

                {/* Tier list — each tier has its own quantity stepper */}
                <div className="p-5 flex flex-col gap-3">
                    {tiers.map((tier) => {
                        const qty = qtyOf(tier.id)
                        const isSoldOut = capFor(tier) === 0 && qty === 0
                        const atCap = qty >= capFor(tier)

                        return (
                            <div
                                key={tier.id}
                                className={`relative w-full text-left p-4 rounded-xl border-2 transition-all duration-200 ${isSoldOut
                                        ? "border-gray-200 opacity-50 bg-white"
                                        : qty > 0
                                            ? "border-[#F15A29] bg-orange-50"
                                            : "border-gray-200 bg-white"
                                    }`}
                            >
                                <div className="flex flex-col gap-1.5">
                                    <span className="font-semibold text-gray-900 text-sm">
                                        {tier.name}
                                    </span>
                                    {tier.description && (
                                        <span className="text-xs text-gray-700 leading-relaxed">
                                            {tier.description}
                                        </span>
                                    )}
                                    <div className="flex items-center justify-between mt-1">
                                        <div className="flex flex-col">
                                            <span className="text-lg font-bold text-[#F15A29]">
                                                {tier.price === 0 ? "FREE" : `${sym}${tier.price.toLocaleString()}`}
                                            </span>
                                            {!isSoldOut && !sharedCapacity && (
                                                <span className="text-xs text-gray-700">
                                                    {tier.available} left
                                                </span>
                                            )}
                                        </div>

                                        {isSoldOut ? (
                                            <span className="text-xs text-red-500 font-medium">
                                                Sold Out
                                            </span>
                                        ) : (
                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={() => decrease(tier)}
                                                    disabled={qty === 0}
                                                    className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-gray-700 hover:bg-orange-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                    aria-label={`Decrease ${tier.name} quantity`}
                                                >
                                                    <Minus className="w-3.5 h-3.5" />
                                                </button>
                                                <span className="text-gray-900 font-bold text-sm w-6 text-center">
                                                    {qty}
                                                </span>
                                                <button
                                                    onClick={() => increase(tier)}
                                                    disabled={atCap}
                                                    className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-gray-700 hover:bg-orange-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                    aria-label={`Increase ${tier.name} quantity`}
                                                >
                                                    <Plus className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>

                {/* Selection summary + CTA */}
                <div className="px-5 pb-6">
                    {totalQty > 0 && (
                        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                                {selectedLines.map((t) => (
                                    <span
                                        key={t.id}
                                        className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-gray-900"
                                    >
                                        {qtyOf(t.id)}× {t.name}
                                    </span>
                                ))}
                            </div>
                            <div className="mt-2.5 flex items-center justify-between border-t border-gray-200 pt-2.5">
                                <span className="text-sm text-gray-700">
                                    Subtotal · {totalQty} ticket{totalQty > 1 ? "s" : ""}
                                </span>
                                <span className="text-2xl font-bold text-[#F15A29] font-[family-name:var(--font-space-grotesk)]">
                                    {subtotal === 0 ? "FREE" : `${sym}${subtotal.toLocaleString()}`}
                                </span>
                            </div>
                        </div>
                    )}

                    {totalQty === 0 ? (
                        <button
                            type="button"
                            disabled
                            className="block w-full bg-[#F15A29] text-white text-center py-4 rounded-xl font-bold text-base opacity-50 cursor-not-allowed font-[family-name:var(--font-space-grotesk)]"
                        >
                            Select at least 1 ticket to continue
                        </button>
                    ) : (
                        <Link
                            href={checkoutHref}
                            onClick={(e) => {
                                if (blockedBuyer) {
                                    e.preventDefault()
                                    setShowBuyBlock(true)
                                    setShake(true)
                                    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(60)
                                    setTimeout(() => setShake(false), 450)
                                    return
                                }
                            }}
                            className={`block w-full bg-[#F15A29] text-white text-center py-4 rounded-xl font-bold text-base hover:bg-[#d6420f] active:scale-[0.98] transition-all duration-200 font-[family-name:var(--font-space-grotesk)] ${shake ? "animate-shake" : ""}`}
                        >
                            {ctaButtonText(ctaLabel)}
                        </Link>
                    )}

                    {showBuyBlock && <BlockedBuyerNotice className="mt-2" />}

                    <StripeBadge className="mt-4" />
                </div>
            </div>
        </div>
    )
}
