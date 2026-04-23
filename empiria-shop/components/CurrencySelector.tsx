"use client"

import { useState, useEffect } from "react"

const CURRENCIES = [
    { code: "cad", label: "CAD", symbol: "CA$" },
    { code: "usd", label: "USD", symbol: "$" },
    { code: "eur", label: "EUR", symbol: "€" },
]

export default function CurrencySelector({ defaultCurrency }: { defaultCurrency?: string }) {
    const [currency, setCurrency] = useState(defaultCurrency || "cad")
    const [open, setOpen] = useState(false)

    useEffect(() => {
        // Read from localStorage on mount
        const stored = localStorage.getItem("preferred_currency")
        if (stored && CURRENCIES.some(c => c.code === stored)) {
            setCurrency(stored)
        } else if (defaultCurrency) {
            setCurrency(defaultCurrency)
        }
    }, [defaultCurrency])

    const handleSelect = (code: string) => {
        setCurrency(code)
        localStorage.setItem("preferred_currency", code)
        setOpen(false)
    }

    const current = CURRENCIES.find(c => c.code === currency) || CURRENCIES[0]

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                aria-label="Select currency"
            >
                <span className="text-xs font-bold text-slate-400">{current.symbol}</span>
                <span>{current.label}</span>
                <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50 min-w-[120px]">
                        {CURRENCIES.map(c => (
                            <button
                                key={c.code}
                                onClick={() => handleSelect(c.code)}
                                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-slate-50 transition-colors ${
                                    c.code === currency ? 'text-orange-600 font-semibold' : 'text-slate-700'
                                }`}
                            >
                                <span className="text-xs w-6 text-slate-400">{c.symbol}</span>
                                <span>{c.label}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}
