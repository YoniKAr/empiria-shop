// ──────────────────────────────────────────────────
// 📁 lib/supabase.ts — NEW FILE (create this)
// ──────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

// Server-side only — uses Service Role Key for full access
export function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!
  );
}
