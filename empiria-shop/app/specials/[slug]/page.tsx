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

  // Fetch published events for this category
  const { data: rawEvents } = await supabase
    .from('events')
    .select(`
      id, title, slug, cover_image_url,
      venue_name, city, currency, organizer_id, source_app,
      categories (name),
      ticket_tiers (price),
      event_occurrences (starts_at)
    `)
    .eq('status', 'published')
    .eq('category_id', page.category_id)
    .order('created_at', { ascending: false });

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
