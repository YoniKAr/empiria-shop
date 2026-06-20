import Image from "next/image";
import Link from "next/link";
import { APEX_URL, ORGANIZER_URL, PROFILE_URL } from "@/lib/urls";

export default function Footer() {
  return (
    <footer className="relative z-40 w-full bg-white text-black px-8 md:px-16 pt-16 pb-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row items-start justify-between gap-12 pb-12 border-b border-black/10">
          {/* Brand */}
          <div className="flex flex-col gap-4 max-w-xs">
            <Image
              src="/logo.png"
              alt="Empiria Events Logo"
              width={120}
              height={40}
              style={{ height: "auto" }}
            />
            <p className="text-[14px] text-gray-700 leading-relaxed">
              A ticketing platform dedicated to promoting and celebrating
              cultures. Embracing cultures, we embrace diversity &amp; inclusion.
            </p>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-10 text-[14px]">
            {/* Company */}
            <div className="flex flex-col gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-700">
                Company
              </span>
              {[
                { label: "About", href: `${APEX_URL}/about` },
                { label: "Cultures", href: `${APEX_URL}/#cultures` },
                { label: "Contact", href: `${APEX_URL}/contact` },
              ].map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-black/60 hover:text-black transition-colors"
                >
                  {item.label}
                </a>
              ))}
            </div>

            {/* Platform */}
            <div className="flex flex-col gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-700">
                Platform
              </span>
              <Link
                href="/"
                className="text-black/60 hover:text-black transition-colors"
              >
                Browse Events
              </Link>
              <a
                href={ORGANIZER_URL}
                className="text-black/60 hover:text-black transition-colors"
              >
                Host an Event
              </a>
              <a
                href={PROFILE_URL}
                className="text-black/60 hover:text-black transition-colors"
              >
                My Tickets
              </a>
            </div>

            {/* Connect */}
            <div className="flex flex-col gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-700">
                Connect
              </span>
              {[
                { label: "Facebook", href: "https://www.facebook.com/empiriaculturalevents/" },
                { label: "Instagram", href: "https://www.instagram.com/empiriaevents/" },
                { label: "Twitter / X", href: "https://x.com/Empiria_world" },
                { label: "Contact", href: `${APEX_URL}/contact` },
              ].map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-black/60 hover:text-black transition-colors"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-8 text-[12px] text-gray-700">
          <span>&copy; {new Date().getFullYear()} Empiria Events. All rights reserved.</span>
          <div className="flex gap-6">
            <a href={`${APEX_URL}/privacy`} className="hover:text-black transition-colors">
              Privacy Policy
            </a>
            <a href={`${APEX_URL}/terms`} className="hover:text-black transition-colors">
              Terms of Service
            </a>
            <a href={`${APEX_URL}/accessibility`} className="hover:text-black transition-colors">
              Accessibility
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
