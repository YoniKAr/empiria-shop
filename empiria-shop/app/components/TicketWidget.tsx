"use client"

import { useState } from "react"
import { Check, Minus, Plus, ShieldCheck, Ticket } from "lucide-react"
import Link from "next/link"

interface TicketTier {
    id: string
    name: string
    description: string
    price: number
    available: number
}

interface TicketWidgetProps {
    tiers: TicketTier[]
    eventId: string
    currency?: string
}

export function TicketWidget({ tiers, eventId, currency = "cad" }: TicketWidgetProps) {
    const [selectedTier, setSelectedTier] = useState<string | null>(
        tiers[0]?.id ?? null
    )
    const [quantity, setQuantity] = useState(1)

    const selected = tiers.find((t) => t.id === selectedTier)
    const total = selected ? selected.price * quantity : 0
    const sym = currency === "inr" ? "₹" : currency === "usd" ? "$" : "CA$"

    return (
        <div className="sticky top-24">
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-lg shadow-black/5">
                {/* Header */}
                <div className="bg-[#F98C1F] px-6 py-5">
                    <div className="flex items-center gap-3">
                        <Ticket className="w-5 h-5 text-white" />
                        <h3 className="font-bold text-lg text-white font-[family-name:var(--font-space-grotesk)]">
                            Select Tickets
                        </h3>
                    </div>
                </div>

                {/* Tier list */}
                <div className="p-5 flex flex-col gap-3">
                    {tiers.map((tier) => {
                        const isSelected = selectedTier === tier.id
                        const isSoldOut = tier.available === 0

                        return (
                            <button
                                key={tier.id}
                                onClick={() => {
                                    if (!isSoldOut) {
                                        setSelectedTier(tier.id)
                                        setQuantity(1)
                                    }
                                }}
                                disabled={isSoldOut}
                                className={`relative w-full text-left p-4 rounded-xl border-2 transition-all duration-200 ${isSoldOut
                                        ? "border-gray-200 opacity-50 cursor-not-allowed bg-white"
                                        : isSelected
                                            ? "border-[#F98C1F] bg-orange-50"
                                            : "border-gray-200 hover:border-orange-300 bg-white"
                                    }`}
                            >
                                {/* Selected indicator */}
                                {isSelected && !isSoldOut && (
                                    <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[#F98C1F] flex items-center justify-center">
                                        <Check className="w-3 h-3 text-white" />
                                    </div>
                                )}

                                <div className="flex flex-col gap-1.5">
                                    <span className="font-semibold text-gray-900 text-sm">
                                        {tier.name}
                                    </span>
                                    <span className="text-xs text-gray-500 leading-relaxed">
                                        {tier.description}
                                    </span>
                                    <div className="flex items-center justify-between mt-1">
                                        <span className="text-lg font-bold text-[#F98C1F]">
                                            {tier.price === 0 ? "FREE" : `${sym}${tier.price.toLocaleString()}`}
                                        </span>
                                        {isSoldOut ? (
                                            <span className="text-xs text-red-500 font-medium">
                                                Sold Out
                                            </span>
                                        ) : (
                                            <span className="text-xs text-gray-500">
                                                {tier.available} left
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </button>
                        )
                    })}
                </div>

                {/* Quantity selector */}
                {selected && selected.available > 0 && (
                    <div className="px-5 pb-4">
                        <div className="flex items-center justify-between bg-gray-100 rounded-xl px-4 py-3">
                            <span className="text-sm text-gray-600">Quantity</span>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                    className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-gray-700 hover:bg-orange-100 transition-colors"
                                    aria-label="Decrease quantity"
                                >
                                    <Minus className="w-3.5 h-3.5" />
                                </button>
                                <span className="text-gray-900 font-bold text-sm w-6 text-center">
                                    {quantity}
                                </span>
                                <button
                                    onClick={() =>
                                        setQuantity(Math.min(selected.available, quantity + 1))
                                    }
                                    className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-gray-700 hover:bg-orange-100 transition-colors"
                                    aria-label="Increase quantity"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Total & CTA */}
                <div className="px-5 pb-6">
                    {selected && (
                        <div className="flex items-center justify-between mb-4 px-1">
                            <span className="text-sm text-gray-600">Total</span>
                            <span className="text-2xl font-bold text-[#F98C1F] font-[family-name:var(--font-space-grotesk)]">
                                {total === 0 ? "FREE" : `${sym}${total.toLocaleString()}`}
                            </span>
                        </div>
                    )}

                    <Link
                        href={`/checkout/${eventId}`}
                        className="block w-full bg-[#F98C1F] text-white text-center py-4 rounded-xl font-bold text-base hover:brightness-110 active:scale-[0.98] transition-all duration-200 font-[family-name:var(--font-space-grotesk)]"
                    >
                        Get Tickets
                    </Link>

                    <div className="flex items-center justify-center gap-2 mt-4">
                        <ShieldCheck className="w-3.5 h-3.5 text-gray-400" />
                        <p className="text-xs text-gray-400">
                            Secure checkout powered by Stripe
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
