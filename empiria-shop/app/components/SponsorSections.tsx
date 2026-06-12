"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SponsorSection, SPONSOR_TIER_HEIGHT, isSafeUrl } from "@/lib/eventFields";

export default function SponsorSections({ sections }: { sections: SponsorSection[] }) {
  if (!sections?.length) return null;
  const withSponsors = sections.filter((s) => s.sponsors?.length);
  if (!withSponsors.length) return null;
  return (
    <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-10">
      {withSponsors.map((s) => <SponsorRow key={s.id} section={s} />)}
    </section>
  );
}

function SponsorRow({ section }: { section: SponsorSection }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const h = SPONSOR_TIER_HEIGHT[section.tier];
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * 320, behavior: "smooth" });

  // Only show the scroll arrows when the row actually overflows.
  const checkOverflow = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setOverflowing(el.scrollWidth > el.clientWidth + 4);
  }, []);

  useEffect(() => {
    checkOverflow();
    window.addEventListener("resize", checkOverflow);
    return () => window.removeEventListener("resize", checkOverflow);
  }, [checkOverflow, section.sponsors]);

  return (
    <div>
      {section.title && (
        <h3 className="text-lg font-semibold text-[#F15A29] mb-4 font-[family-name:var(--font-space-grotesk)]">{section.title}</h3>
      )}
      <div className="relative">
        {overflowing && (
          <button type="button" onClick={() => scroll(-1)} aria-label="Scroll left"
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white border border-gray-200 rounded-full w-9 h-9 shadow flex items-center justify-center">‹</button>
        )}
        <div ref={ref} className={`flex gap-6 overflow-x-auto items-center ${overflowing ? "px-12" : ""}`} style={{ scrollbarWidth: "none" }}>
          {section.sponsors.map((sp) => {
            const card = (
              <div className="flex-shrink-0 bg-white border border-gray-100 rounded-xl shadow-sm flex flex-col items-center justify-center p-4"
                style={{ height: h + 24, width: Math.round(h * 1.8) }}>
                <img src={sp.logo_url} alt={sp.name ?? "Sponsor"} className="max-h-full max-w-full object-contain" style={{ maxHeight: h }} />
                {sp.name && <span className="text-xs text-gray-700 mt-1 truncate max-w-full">{sp.name}</span>}
              </div>
            );
            const safe = sp.link_url && isSafeUrl(sp.link_url) ? sp.link_url : null;
            return safe
              ? <a key={sp.id} href={safe} target="_blank" rel="noopener noreferrer">{card}</a>
              : <div key={sp.id}>{card}</div>;
          })}
        </div>
        {overflowing && (
          <button type="button" onClick={() => scroll(1)} aria-label="Scroll right"
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white border border-gray-200 rounded-full w-9 h-9 shadow flex items-center justify-center">›</button>
        )}
      </div>
    </div>
  );
}
