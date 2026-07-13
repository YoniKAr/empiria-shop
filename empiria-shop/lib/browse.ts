/**
 * Shared browse/discovery helpers for the programmatic SEO city pages
 * (/city/[city] and /city/[city]/[category]).
 *
 * Centralizes the "publicly browsable event" filter constants, the city-slug
 * logic, the upcoming-events-in-city query, and the card-enrichment step
 * (organizer names/avatars + co-host counts) so the city pages and the sitemap
 * all agree on which events/cities exist.
 */
import { getSupabaseAdmin } from '@/lib/supabase';

// Standard public-event filters — every browse surface (city pages, sitemap)
// must apply all three. Mirrors app/category/[slug]/page.tsx.
export const PUBLIC_EVENT_STATUS = 'published';
export const PUBLIC_EVENT_VISIBILITY = 'public';
export const PUBLIC_EVENT_TYPES = ['event', 'gifft_event'];

/**
 * Slugify a raw `events.city` value for use in /city/[city] URLs.
 * Lowercases, trims, strips diacritics ("Montréal" → "montreal"), collapses
 * runs of non-alphanumerics to single hyphens ("Toronto, ON" → "toronto-on"),
 * and trims leading/trailing hyphens.
 */
export function slugifyCity(city: string): string {
    return city
        .toLowerCase()
        .trim()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '') // strip diacritics
        .replace(/[^a-z0-9]+/g, '-') // collapse non-alphanumerics to hyphens
        .replace(/^-+|-+$/g, ''); // trim hyphens
}

/**
 * Every raw (trimmed, non-empty) city value across public events — one entry
 * per event, so callers can count events per city.
 */
async function fetchPublicCityValues(): Promise<string[]> {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
        .from('events')
        .select('city')
        .eq('status', PUBLIC_EVENT_STATUS)
        .eq('visibility', PUBLIC_EVENT_VISIBILITY)
        .in('event_type', PUBLIC_EVENT_TYPES)
        .not('city', 'is', null)
        .neq('city', '');

    return (data || [])
        .map((r: { city: string | null }) => (r.city || '').trim())
        .filter(Boolean);
}

/**
 * Distinct cities across public events, deduped case-insensitively by slug
 * (the most common original casing wins as the display name), sorted by event
 * count desc then name asc.
 */
export async function getPublicCities(): Promise<{ city: string; slug: string; count: number }[]> {
    const values = await fetchPublicCityValues();

    // slug → total count + per-casing counts (to pick the dominant display name).
    const bySlug = new Map<string, { count: number; casings: Map<string, number> }>();
    for (const raw of values) {
        const slug = slugifyCity(raw);
        if (!slug) continue;
        const entry = bySlug.get(slug) || { count: 0, casings: new Map<string, number>() };
        entry.count += 1;
        entry.casings.set(raw, (entry.casings.get(raw) || 0) + 1);
        bySlug.set(slug, entry);
    }

    const cities = [...bySlug.entries()].map(([slug, { count, casings }]) => {
        const city = [...casings.entries()].sort((a, b) => b[1] - a[1])[0][0];
        return { city, slug, count };
    });
    cities.sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
    return cities;
}

/**
 * Resolve a /city/[city] URL slug back to the raw `events.city` strings whose
 * slugified form equals it (`matches` — needed for `.in('city', …)` queries)
 * plus the dominant casing as the display name. Returns null when no public
 * event has a matching city.
 */
export async function findCityBySlug(slug: string): Promise<{ display: string; matches: string[] } | null> {
    if (!slug) return null;
    const values = await fetchPublicCityValues();

    const casings = new Map<string, number>();
    for (const raw of values) {
        if (slugifyCity(raw) !== slug) continue;
        casings.set(raw, (casings.get(raw) || 0) + 1);
    }
    if (casings.size === 0) return null;

    const sorted = [...casings.entries()].sort((a, b) => b[1] - a[1]);
    return { display: sorted[0][0], matches: sorted.map(([raw]) => raw) };
}

/**
 * Upcoming public events in a city (optionally narrowed to one category),
 * sorted by soonest upcoming occurrence. Same select shape as the category
 * listing page — the extra fields (description, address_text, location_type,
 * meeting_link, occurrence ends_at) let callers emit COMPLETE per-event Event
 * JSON-LD. Each event's occurrences come back sorted ascending; events with
 * no future occurrence are dropped (city pages list upcoming only).
 */
export async function getCityEvents(matches: string[], categoryId?: string): Promise<any[]> {
    if (matches.length === 0) return [];
    const supabase = getSupabaseAdmin();

    let query = supabase
        .from('events')
        .select(`
      id, title, slug, cover_image_url, timezone,
      venue_name, city, address_text, location_type, meeting_link,
      currency, organizer_id, source_app, entry_type, description,
      categories (name, slug),
      ticket_tiers (price),
      event_occurrences (starts_at, ends_at)
    `)
        .eq('status', PUBLIC_EVENT_STATUS)
        .eq('visibility', PUBLIC_EVENT_VISIBILITY)
        .in('event_type', PUBLIC_EVENT_TYPES)
        .in('city', matches);
    if (categoryId) query = query.eq('category_id', categoryId);

    const { data: rawEvents } = await query;

    // Keep only events with a FUTURE occurrence, ordered by that occurrence.
    const now = Date.now();
    const withSort = (rawEvents || []).map((e: any) => {
        const occs = [...(e.event_occurrences || [])].sort(
            (a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
        );
        const nextFuture = occs.find((o: any) => new Date(o.starts_at).getTime() >= now);
        return {
            ...e,
            event_occurrences: occs,
            _nextFutureTs: nextFuture ? new Date(nextFuture.starts_at).getTime() : null,
        };
    });
    return withSort
        .filter((e: any) => e._nextFutureTs != null)
        .sort((a: any, b: any) => a._nextFutureTs - b._nextFutureTs);
}

/**
 * Attach the EventCard display fields (organizer_name / organizer_avatar_url /
 * co_host_count) to a list of events. Same batched lookups as the category
 * page: organizer profiles, the admin-managed platform avatar for
 * platform-owned events, and visible co-organizer counts.
 */
export async function enrichEventsForCards(events: any[]): Promise<any[]> {
    if (events.length === 0) return [];
    const supabase = getSupabaseAdmin();

    const organizerIds = [...new Set(events.map((e: any) => e.organizer_id).filter(Boolean))];
    const { data: profiles } = organizerIds.length > 0
        ? await supabase
            .from('users')
            .select('auth0_id, full_name, role, avatar_url')
            .in('auth0_id', organizerIds)
        : { data: [] };

    const profileMap: Record<string, string> = {};
    const roleMap: Record<string, string> = {};
    const avatarMap: Record<string, string | null> = {};
    (profiles || []).forEach((p: any) => {
        profileMap[p.auth0_id] = p.full_name;
        roleMap[p.auth0_id] = p.role;
        avatarMap[p.auth0_id] = p.avatar_url || null;
    });

    // Shared platform avatar (admin-managed) for platform-owned events.
    const { data: platformSetting } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'platform_avatar_url')
        .maybeSingle();
    const platformAvatarUrl = (platformSetting?.value as { url?: string | null } | null)?.url || null;

    // Batch-fetch visible co-organizer counts per event.
    const eventIds = events.map((e: any) => e.id);
    const { data: coOrgRows } = eventIds.length > 0
        ? await supabase
            .from('event_organizers')
            .select('event_id')
            .in('event_id', eventIds)
            .eq('is_visible', true)
        : { data: [] };

    const coHostCountMap: Record<string, number> = {};
    (coOrgRows || []).forEach((r: any) => {
        coHostCountMap[r.event_id] = (coHostCountMap[r.event_id] || 0) + 1;
    });

    return events.map((e: any) => ({
        ...e,
        organizer_name: roleMap[e.organizer_id] === 'admin'
            ? 'Empiria Events'
            : (profileMap[e.organizer_id] || 'Empiria Events'),
        organizer_avatar_url: roleMap[e.organizer_id] === 'admin'
            ? platformAvatarUrl
            : (avatarMap[e.organizer_id] || null),
        co_host_count: coHostCountMap[e.id] || 0,
    }));
}
