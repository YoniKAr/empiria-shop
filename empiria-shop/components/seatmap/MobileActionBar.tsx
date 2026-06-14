"use client";

import { Loader2 } from "lucide-react";

interface MobileActionBarProps {
  /** Number of tickets/seats currently selected. */
  count: number;
  /** Formatted total price string (already includes currency / "Free"). */
  totalLabel: string;
  /** Button text (e.g. "Checkout", "Select 2 more seats"). */
  buttonLabel: string;
  disabled: boolean;
  loading: boolean;
  shake?: boolean;
  /** Brand-orange by default; ZoneSelector/AssignedSeatPicker pass the
   *  orange-600 utility classes they already use so colours stay consistent. */
  buttonClassName?: string;
  onAction: () => void;
}

/**
 * Sticky bottom action bar shown ONLY on small screens (`lg:hidden`). It mirrors
 * the existing desktop panel's selected-count + total + primary button so the
 * checkout action is always reachable on a phone without scrolling past a tall
 * seat map. Desktop (lg+) never renders this — its layout is untouched.
 */
export default function MobileActionBar({
  count,
  totalLabel,
  buttonLabel,
  disabled,
  loading,
  shake = false,
  buttonClassName = "bg-[#F15A29] hover:bg-[#d94d1f]",
  onAction,
}: MobileActionBarProps) {
  return (
    <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
      <div className="max-w-5xl mx-auto flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-gray-600">
            {count} selected
          </div>
          <div className="text-lg font-bold text-gray-900 leading-tight truncate">
            {totalLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          className={`shrink-0 min-w-[8.5rem] text-white text-center py-3.5 px-5 rounded-xl font-bold transition-colors disabled:bg-gray-300 disabled:text-gray-700 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${buttonClassName} ${shake ? "animate-shake" : ""}`}
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">Redirecting…</span>
            </>
          ) : (
            <span className="text-sm">{buttonLabel}</span>
          )}
        </button>
      </div>
    </div>
  );
}
