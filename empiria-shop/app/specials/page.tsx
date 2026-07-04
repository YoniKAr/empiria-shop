import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const dynamic = "force-dynamic";

export default async function SpecialsIndex() {
  const supabase = getSupabaseAdmin();
  const { data: pages } = await supabase
    .from("category_pages")
    .select("slug, title, hero_media_url, hero_media_type, hero_thumbnail_url, category:categories(name)")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-2xl font-bold mb-6">Specials</h1>
        {(pages ?? []).length === 0 ? (
          <p className="text-gray-700">No special pages yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {(pages ?? []).map((p: any) => {
              const cardImage =
                p.hero_media_type === "image"
                  ? p.hero_media_url
                  : p.hero_thumbnail_url;
              return (
              <Link
                key={p.slug}
                href={`/specials/${p.slug}`}
                className="group block rounded-2xl overflow-hidden border border-gray-200 bg-white hover:shadow-lg transition"
              >
                <div className="aspect-video bg-gray-100 overflow-hidden">
                  {cardImage ? (
                    <img
                      src={cardImage}
                      alt={p.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-700">
                      {p.title}
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h2 className="font-semibold">{p.title}</h2>
                  {p.category?.name && (
                    <p className="text-sm text-gray-700">{p.category.name}</p>
                  )}
                </div>
              </Link>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
