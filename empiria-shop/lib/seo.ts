/**
 * SEO helpers for the Empiria shop app.
 *
 * Centralizes URL resolution, description text extraction, truncation, and
 * schema.org JSON-LD construction. Kept dependency-free (no external libs) so
 * it can run in Server Components + generateMetadata everywhere.
 */
import { SHOP_URL } from '@/lib/urls';

/** Resolve a path against the shop base URL (e.g. "/events/foo"). */
export function absoluteUrl(path: string): string {
  if (!path) return SHOP_URL;
  if (/^https?:\/\//i.test(path)) return path;
  return `${SHOP_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * Extract plain, human-readable text from an event.description value.
 *
 * `events.description` may be:
 *   - a JSON string like {"text":"<p>..</p>"}
 *   - an already-parsed object { text: "..." }
 *   - plain HTML
 *   - plain text
 *
 * Mirrors the extraction in app/events/[slug]/page.tsx (~lines 332-343): pull
 * the `.text` field when a {text} shape is present, then strip HTML tags and
 * collapse whitespace so it's safe for meta descriptions / JSON-LD.
 */
export function stripToText(input: unknown): string {
  if (input == null) return '';

  let raw = '';
  if (typeof input === 'object') {
    raw = (input as { text?: string }).text || '';
  } else if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      raw = parsed?.text ?? input;
    } catch {
      raw = input;
    }
  } else {
    raw = String(input);
  }

  return raw
    .replace(/<[^>]*>/g, ' ') // strip HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
}

/** Truncate text to `n` chars on a word boundary, adding an ellipsis. */
export function truncate(text: string, n = 160): string {
  if (!text) return '';
  if (text.length <= n) return text;
  const slice = text.slice(0, n - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > n * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trim()}…`;
}

export interface EventJsonLdInput {
  name: string;
  description?: string;
  /** Absolute image URL(s). */
  image?: string | string[];
  /** ISO 8601 start (include tz offset where possible). */
  startDate?: string;
  /** ISO 8601 end. */
  endDate?: string;
  /** Canonical event URL (absolute). */
  url: string;
  /** true when the event is online/virtual. */
  isOnline?: boolean;
  /** Online meeting/join URL (for VirtualLocation). */
  onlineUrl?: string;
  venueName?: string | null;
  addressText?: string | null;
  city?: string | null;
  /** Minimum visible ticket price. */
  price?: number | null;
  /** ISO currency, e.g. "CAD". */
  priceCurrency?: string;
  /** ISO 8601 offer availability start. */
  offerValidFrom?: string;
  organizerName?: string;
  organizerUrl?: string;
  /** true → no bookable price (external / off-platform). */
  omitOffers?: boolean;
  /** Include the organizer as a performer. */
  includePerformer?: boolean;
}

/**
 * Build a schema.org Event object (returned as a plain object; callers pass it
 * through <JsonLd/> which JSON.stringifies it).
 */
export function buildEventJsonLd(input: EventJsonLdInput): Record<string, unknown> {
  const {
    name,
    description,
    image,
    startDate,
    endDate,
    url,
    isOnline = false,
    onlineUrl,
    venueName,
    addressText,
    city,
    price,
    priceCurrency = 'CAD',
    offerValidFrom,
    organizerName,
    organizerUrl = SHOP_URL,
    omitOffers = false,
    includePerformer = false,
  } = input;

  const images = image
    ? (Array.isArray(image) ? image.filter(Boolean) : [image]).filter(Boolean)
    : undefined;

  const location = isOnline
    ? {
        '@type': 'VirtualLocation',
        url: onlineUrl || url,
      }
    : {
        '@type': 'Place',
        name: venueName || city || 'Venue TBA',
        // Structured PostalAddress (Google's preferred form). streetAddress holds
        // the full formatted address; addressLocality is the city. Avoids the old
        // "…Canada, Toronto" duplication from concatenating the two.
        address: {
          '@type': 'PostalAddress',
          ...(addressText ? { streetAddress: addressText } : {}),
          addressLocality: city || 'Toronto',
          addressCountry: 'CA',
        },
      };

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name,
    url,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: isOnline
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : 'https://schema.org/OfflineEventAttendanceMode',
    location,
  };

  if (description) jsonLd.description = description;
  if (images && images.length > 0) jsonLd.image = images;
  if (startDate) jsonLd.startDate = startDate;
  if (endDate) jsonLd.endDate = endDate;

  if (organizerName) {
    const org = {
      '@type': 'Organization',
      name: organizerName,
      url: organizerUrl,
    };
    jsonLd.organizer = org;
    if (includePerformer) jsonLd.performer = org;
  }

  if (!omitOffers && price != null) {
    jsonLd.offers = {
      '@type': 'Offer',
      price: Number(price).toFixed(2),
      priceCurrency: (priceCurrency || 'CAD').toUpperCase(),
      availability: 'https://schema.org/InStock',
      url,
      ...(offerValidFrom ? { validFrom: offerValidFrom } : {}),
    };
  }

  return jsonLd;
}

/** Build a schema.org BreadcrumbList from ordered {name,url} crumbs. */
export function buildBreadcrumbJsonLd(
  crumbs: { name: string; url: string }[]
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}
