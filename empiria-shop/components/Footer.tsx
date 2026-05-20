import Link from "next/link";

export default function Footer() {
  return (
    <footer className="relative z-40 w-full bg-white text-black px-8 md:px-16 pt-16 pb-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row items-start justify-between gap-12 pb-12 border-b border-black/10">
          {/* Brand */}
          <div className="flex flex-col gap-4 max-w-xs">
            <span className="text-2xl font-bold tracking-tight">Empiria</span>
            <p className="text-[14px] text-black/50 leading-relaxed">
              Discover and book unforgettable events. Seamless ticketing for
              concerts, festivals, and community gatherings.
            </p>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-10 text-[14px]">
            {/* Company */}
            <div className="flex flex-col gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-black/30">
                Company
              </span>
              <a
                href="https://empiriaindia.com/#about"
                className="text-black/60 hover:text-black transition-colors"
              >
                About
              </a>
              <a
                href="https://organizer.empiriaindia.com"
                className="text-black/60 hover:text-black transition-colors"
              >
                Host an Event
              </a>
            </div>

            {/* Explore */}
            <div className="flex flex-col gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-black/30">
                Explore
              </span>
              <Link
                href="/"
                className="text-black/60 hover:text-black transition-colors"
              >
                Browse Events
              </Link>
              <a
                href="https://profile.empiriaindia.com"
                className="text-black/60 hover:text-black transition-colors"
              >
                My Tickets
              </a>
            </div>

            {/* Connect */}
            <div className="flex flex-col gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-black/30">
                Connect
              </span>
              {[
                {
                  label: "Facebook",
                  href: "https://www.facebook.com/empiriaculturalevents/",
                },
                {
                  label: "Instagram",
                  href: "https://www.instagram.com/empiriaevents/",
                },
                {
                  label: "Twitter / X",
                  href: "https://x.com/Empiria_world",
                },
                {
                  label: "Contact",
                  href: "https://empiriaindia.com/contact",
                },
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
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-8 text-[12px] text-black/30">
          <span>&copy; {new Date().getFullYear()} Empiria. All rights reserved.</span>
          <div className="flex gap-6">
            <a
              href="https://empiriaindia.com/privacy"
              className="hover:text-black transition-colors"
            >
              Privacy Policy
            </a>
            <a
              href="https://empiriaindia.com/terms"
              className="hover:text-black transition-colors"
            >
              Terms of Service
            </a>
            <a
              href="https://empiriaindia.com/accessibility"
              className="hover:text-black transition-colors"
            >
              Accessibility
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
