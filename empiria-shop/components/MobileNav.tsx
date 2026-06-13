'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

const LINKS = [
  { href: '/', label: 'Events' },
  { href: '/gifft', label: 'GIFFT' },
  { href: '/specials', label: 'Specials' },
];

/**
 * Mobile-only nav dropdown (hamburger) for the floating pill navbar.
 * Rendered below the `sm` breakpoint; desktop keeps the inline links.
 */
export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close when tapping/clicking outside the menu.
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-full text-slate-700 hover:bg-gray-100 transition-colors"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-2 rounded-2xl bg-white/95 backdrop-blur-md shadow-lg border border-gray-100 overflow-hidden">
          <div className="flex flex-col py-2">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="px-5 py-3 text-sm font-medium text-slate-700 hover:bg-gray-50 hover:text-slate-900 transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
