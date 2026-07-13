import type { MetadataRoute } from "next";
import { getSupabaseAdmin } from "@/lib/supabase";
import { SHOP_URL } from "@/lib/urls";
import { slugifyCity } from "@/lib/browse";

// Regenerate at most hourly — new events/movies/specials appear without a
// rebuild, but we don't hit the DB on every crawl.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const supabase = getSupabaseAdmin();

  const entries: MetadataRoute.Sitemap = [
    { url: `${SHOP_URL}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SHOP_URL}/gifft`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SHOP_URL}/specials`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
  ];

  // Query the dynamic content in parallel. Any failure degrades to the static
  // entries above rather than 500-ing the sitemap.
  const [stdEvents, gifftMovies, specials, categories, cityRows] = await Promise.all([
    supabase
      .from("events")
      .select("slug, updated_at")
      .in("event_type", ["event", "gifft_event"])
      .eq("status", "published")
      .eq("visibility", "public"),
    supabase
      .from("events")
      .select("slug, updated_at")
      .eq("event_type", "gifft_movie")
      .eq("status", "published")
      .eq("visibility", "public"),
    supabase
      .from("category_pages")
      .select("slug, updated_at")
      .eq("is_active", true),
    supabase
      .from("categories")
      .select("slug, created_at")
      .eq("is_active", true),
    // City + city×category browse pages, computed from ONE query (no N+1).
    supabase
      .from("events")
      .select("city, categories (slug)")
      .in("event_type", ["event", "gifft_event"])
      .eq("status", "published")
      .eq("visibility", "public")
      .not("city", "is", null)
      .neq("city", ""),
  ]);

  for (const e of stdEvents.data ?? []) {
    if (!e.slug) continue;
    entries.push({
      url: `${SHOP_URL}/events/${e.slug}`,
      lastModified: e.updated_at ? new Date(e.updated_at) : now,
      changeFrequency: "weekly",
      priority: 0.8,
    });
  }

  for (const m of gifftMovies.data ?? []) {
    if (!m.slug) continue;
    entries.push({
      url: `${SHOP_URL}/gifft/${m.slug}`,
      lastModified: m.updated_at ? new Date(m.updated_at) : now,
      changeFrequency: "weekly",
      priority: 0.8,
    });
  }

  for (const s of specials.data ?? []) {
    if (!s.slug) continue;
    entries.push({
      url: `${SHOP_URL}/specials/${s.slug}`,
      lastModified: (s as { updated_at?: string }).updated_at
        ? new Date((s as { updated_at?: string }).updated_at as string)
        : now,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  for (const c of categories.data ?? []) {
    if (!c.slug) continue;
    entries.push({
      url: `${SHOP_URL}/category/${c.slug}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  // Non-empty /city/{slug} pages + non-empty /city/{slug}/{category} combos.
  const citySlugs = new Set<string>();
  const cityCategoryCombos = new Set<string>();
  for (const row of cityRows.data ?? []) {
    const r = row as {
      city: string | null;
      categories: { slug: string | null } | { slug: string | null }[] | null;
    };
    const citySlug = slugifyCity(r.city || "");
    if (!citySlug) continue;
    citySlugs.add(citySlug);
    const cats = Array.isArray(r.categories) ? r.categories : r.categories ? [r.categories] : [];
    for (const c of cats) {
      if (c?.slug) cityCategoryCombos.add(`${citySlug}/${c.slug}`);
    }
  }

  for (const slug of citySlugs) {
    entries.push({
      url: `${SHOP_URL}/city/${slug}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    });
  }

  for (const combo of cityCategoryCombos) {
    entries.push({
      url: `${SHOP_URL}/city/${combo}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.6,
    });
  }

  return entries;
}
