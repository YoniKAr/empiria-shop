import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { findActiveVolunteerCode } from '@/lib/scanAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/scan/volunteer-codes/redeem   body: { code }
//
// Public (the code IS the credential): a volunteer submits the code an
// organizer shared. On success returns the event it grants scanning for; the
// app then sends the code in `X-Volunteer-Code` on subsequent scan requests.
export async function POST(req: NextRequest) {
  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return NextResponse.json({ valid: false }, { status: 400 });
  }

  const row = await findActiveVolunteerCode(code);
  if (!row) {
    return NextResponse.json({ valid: false }, { status: 404 });
  }

  const supabase = getSupabaseAdmin();
  const { data: event } = await supabase
    .from('events')
    .select('id, title, venue_name, city')
    .eq('id', row.event_id)
    .maybeSingle();
  if (!event) {
    return NextResponse.json({ valid: false }, { status: 404 });
  }

  // Best-effort usage metrics (non-blocking semantics; ignore failures).
  await supabase
    .from('event_volunteer_codes')
    .update({ use_count: row.use_count + 1, last_used_at: new Date().toISOString() })
    .eq('id', row.id);

  return NextResponse.json({
    valid: true,
    eventId: event.id,
    eventTitle: event.title,
    venueName: event.venue_name ?? null,
    city: event.city ?? null,
  });
}
