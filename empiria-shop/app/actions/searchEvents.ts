'use server';

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!
);

export type SearchResult = {
    id: string;
    title: string;
    slug: string;
    city: string;
    start_at: string;
};

export async function searchEvents(query: string): Promise<SearchResult[]> {
    if (!query || query.trim().length < 2) {
        return [];
    }

    // Search in title OR city (case insensitive ILIKE)
    const { data, error } = await supabase
        .from('events')
        .select('id, title, slug, city, start_at')
        .or(`title.ilike.%${query}%,city.ilike.%${query}%`)
        .eq('status', 'published') // Ensure we only show published events
        .limit(10);        // Limit results for performance

    if (error) {
        console.error('Supabase search error:', error);
        return [];
    }

    return data || [];
}
