'use server';

import { getSupabaseAdmin } from '@/lib/supabase';

const supabase = getSupabaseAdmin();

export type SearchResult = {
    id: string;
    title: string;
    slug: string;
    city: string;
    event_occurrences: { starts_at: string }[];
};

/**
 * Sanitize user input before interpolating into a PostgREST `.or()` filter.
 * Commas, parentheses and quotes are filter syntax (they can break out of the
 * `title.ilike.%…%` value and inject extra conditions); `%`/`_` are ILIKE
 * wildcards and `\` is the escape character. Strip them all, collapse
 * whitespace, and cap the length.
 */
function sanitizeSearchQuery(raw: string): string {
    return raw
        .replace(/[,()"'\\%_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
}

export async function searchEvents(query: string): Promise<SearchResult[]> {
    const q = sanitizeSearchQuery(query || '');
    if (q.length < 2) {
        return [];
    }

    // Search in title OR city (case insensitive ILIKE)
    const { data, error } = await supabase
        .from('events')
        .select('id, title, slug, city, event_occurrences(starts_at)')
        .or(`title.ilike.%${q}%,city.ilike.%${q}%`)
        .eq('status', 'published') // Ensure we only show published events
        .eq('visibility', 'public') // Hide private events from public search
        .limit(10);        // Limit results for performance

    if (error) {
        console.error('Supabase search error:', error);
        return [];
    }

    // Sort each event's occurrences chronologically so consumers can rely on
    // `event_occurrences[0]` being the earliest date.
    return (data || []).map((event) => ({
        ...event,
        event_occurrences: [...(event.event_occurrences || [])].sort(
            (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
        ),
    }));
}
