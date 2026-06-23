import { getSupabaseAdmin } from './supabase';

// Best-effort client IP from the proxy headers Vercel sets. Falls back to a
// shared bucket ('unknown') when absent — still throttles, just coarsely.
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

// Fixed-window rate limiter backed by Postgres (rate_limit_hit RPC). Returns
// true when the request is ALLOWED, false when the limit is exceeded.
//
// Fails OPEN (returns true) on any error: a limiter hiccup must never block a
// real buyer from checking out. This layer is abuse mitigation, not a hard gate.
export async function rateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('rate_limit_hit', {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}
