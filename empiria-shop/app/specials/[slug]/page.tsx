import type { Metadata } from 'next';
import { getSupabaseAdmin } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { notFound } from 'next/navigation';
import { absoluteUrl, stripToText, truncate } from '@/lib/seo';
import { SpecialPageContent } from './SpecialPageContent';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();

  const { data: page } = await supabase
    .from('category_pages')
    .select('title, subtitle, description, hero_media_url, hero_media_type, hero_thumbnail_url')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (!page) return { title: 'Not Found' };

  const title = page.title as string;
  const desc = truncate(stripToText(page.subtitle || page.description || ''));
  const description = desc || `Discover ${title} on Empiria Events.`;

  const rawImage =
    page.hero_media_type === 'image'
      ? page.hero_media_url
      : (page.hero_thumbnail_url || undefined);
  const image = rawImage
    ? (/^https?:\/\//i.test(rawImage) ? rawImage : absoluteUrl(rawImage))
    : undefined;

  return {
    title,
    description,
    alternates: { canonical: `/specials/${slug}` },
    openGraph: {
      title,
      description,
      url: absoluteUrl(`/specials/${slug}`),
      type: 'website',
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

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
      id, title, slug, cover_image_url, timezone,
      venue_name, city, currency, organizer_id, source_app, entry_type,
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
      .eq('visibility', 'public')
      .eq('event_type', 'event');
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
      .eq('event_type', 'event')
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
          .select('auth0_id, full_name, role, avatar_url')
          .in('auth0_id', organizerIds)
      : { data: [] };

    const profileMap: Record<string, string> = {};
    const roleMap: Record<string, string> = {};
    const avatarMap: Record<string, string | null> = {};
    (profiles || []).forEach((p: any) => { profileMap[p.auth0_id] = p.full_name; roleMap[p.auth0_id] = p.role; avatarMap[p.auth0_id] = p.avatar_url || null; });

    const { data: spPlatformSetting } = await supabase
      .from('platform_settings').select('value').eq('key', 'platform_avatar_url').maybeSingle();
    const spPlatformAvatar = (spPlatformSetting?.value as { url?: string | null } | null)?.url || null;

    events = rawEvents.map((e: any) => ({
      ...e,
      event_occurrences: [...(e.event_occurrences || [])].sort(
        (a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
      ),
      organizer_name: roleMap[e.organizer_id] === 'admin'
        ? 'Empiria Events'
        : (profileMap[e.organizer_id] || 'Empiria Events'),
      organizer_avatar_url: roleMap[e.organizer_id] === 'admin'
        ? spPlatformAvatar
        : (avatarMap[e.organizer_id] || null),
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
