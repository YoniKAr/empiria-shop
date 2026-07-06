import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import OnboardingRedirect from "@/components/OnboardingRedirect";
import JsonLd from "@/components/JsonLd";
import { SHOP_URL } from "@/lib/urls";
import { absoluteUrl } from "@/lib/seo";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_DESCRIPTION =
  "Empiria Events is a multicultural events marketplace — discover and buy tickets to Greek, Italian, Indian, Chinese, Middle Eastern, Latin American, and multicultural celebrations across Canada, plus the GIFFT film-festival experience.";

export const metadata: Metadata = {
  metadataBase: new URL(SHOP_URL),
  title: {
    default: "Empiria Events",
    template: "%s · Empiria Events",
  },
  description: SITE_DESCRIPTION,
  applicationName: "Empiria Events",
  icons: {
    icon: "/icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "Empiria Events",
    title: "Empiria Events",
    description: SITE_DESCRIPTION,
    url: SHOP_URL,
    images: [{ url: "/icon.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Empiria Events",
    description: SITE_DESCRIPTION,
    images: ["/icon.png"],
  },
};

// Analytics IDs are env-gated: no-op until set in Vercel. GTM takes precedence
// over GA4 (they're mutually exclusive in practice).
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

// WebSite + Organization structured data for the shop domain.
const siteJsonLd: Record<string, unknown> = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Empiria Events",
  url: SHOP_URL,
  potentialAction: {
    "@type": "SearchAction",
    target: `${SHOP_URL}/?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

const organizationJsonLd: Record<string, unknown> = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Empiria Events",
  url: SHOP_URL,
  logo: absoluteUrl("/icon.png"),
  sameAs: [],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {GTM_ID ? (
        <Script id="gtm-base" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`}
        </Script>
      ) : GA_ID ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-base" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
          </Script>
        </>
      ) : null}
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {GTM_ID ? (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
              height="0"
              width="0"
              style={{ display: "none", visibility: "hidden" }}
            />
          </noscript>
        ) : null}
        <JsonLd data={[siteJsonLd, organizationJsonLd]} />
        <OnboardingRedirect />
        {children}
      </body>
    </html>
  );
}
