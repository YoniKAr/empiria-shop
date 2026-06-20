import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyScannerToken } from '@/lib/scanAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/scan/me — who is this token, and may they use the scanner?
// Only staff (users.role 'admin' or 'organizer') are allowed to sign in; the
// app blocks login for anyone else (e.g. 'attendee' or no users row).
export async function GET(req: NextRequest) {
  const auth = await verifyScannerToken(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('users')
    .select('role, full_name')
    .eq('auth0_id', auth.sub)
    .maybeSingle();

  const role = data?.role ?? null;
  const authorized = role === 'admin' || role === 'organizer';

  return NextResponse.json({
    sub: auth.sub,
    role,
    name: data?.full_name ?? null,
    authorized,
  });
}
