import { getSupabaseAdmin } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { notFound } from 'next/navigation';
import { SpecialPageContent } from './SpecialPageContent';

export const dynamic = 'force-dynamic';

export default async function SpecialPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();

  // Fetch the category page by slug (RLS allows reading active pages)
  const { data: page } = await supabase
    .from('category_pages')
    .select('*, category:categories(id, name, slug)')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (!page) notFound();

  // Fetch events: hand-picked (admin-curated) if event_ids is set, else by category
  const EVENT_COLUMNS = `
      id, title, slug, cover_image_url,
      venue_name, city, currency, organizer_id, source_app,
      categories (name),
      ticket_tiers (price),
      event_occurrences (starts_at)
    `;

  let rawEvents: any[] | null;
  if (Array.isArray(page.event_ids) && page.event_ids.length > 0) {
    const { data } = await supabase
      .from('events')
      .select(EVENT_COLUMNS)
      .in('id', page.event_ids)
      .eq('status', 'published')
      .eq('visibility', 'public');
    // Preserve the admin-specified order
    const order = new Map<string, number>(
      page.event_ids.map((id: string, i: number) => [id, i] as [string, number])
    );
    rawEvents = (data ?? []).sort(
      (a: any, b: any) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
    );
  } else {
    const { data } = await supabase
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('status', 'published')
      .eq('visibility', 'public')
      .eq('category_id', page.category_id)
      .order('created_at', { ascending: false });
    rawEvents = data;
  }

  // Batch-fetch organizer names (same pattern as homepage)
  let events: any[] = [];
  if (rawEvents && rawEvents.length > 0) {
    const organizerIds = [...new Set(rawEvents.map((e: any) => e.organizer_id).filter(Boolean))];
    const { data: profiles } = organizerIds.length > 0
      ? await supabase
          .from('users')
          .select('auth0_id, full_name')
          .in('auth0_id', organizerIds)
      : { data: [] };

    const profileMap: Record<string, string> = {};
    (profiles || []).forEach((p: any) => { profileMap[p.auth0_id] = p.full_name; });

    events = rawEvents.map((e: any) => ({
      ...e,
      organizer_name: e.source_app === 'admin'
        ? 'Empiria Events'
        : (profileMap[e.organizer_id] || 'Empiria Events'),
    }));
  }

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900">
      <Navbar />
      <SpecialPageContent page={page} events={events} />
      <Footer />
    </div>
  );
}
