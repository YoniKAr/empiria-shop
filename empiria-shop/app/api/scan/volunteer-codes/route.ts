import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  verifyScannerToken,
  isAuthorizedForEvent,
  generateVolunteerCode,
} from '@/lib/scanAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/scan/volunteer-codes   body: { eventId, label?, regenerate? }
//
// Organizer/admin only. Returns the active volunteer code for an event so it
// can be shared. There is exactly one active code per event ("every volunteer
// gets the same code"): an existing active code is returned as-is unless
// `regenerate` is true, which deactivates it and issues a fresh one.
export async function POST(req: NextRequest) {
  const auth = await verifyScannerToken(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { eventId?: unknown; label?: unknown; regenerate?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const eventId = typeof body.eventId === 'string' ? body.eventId : '';
  const label = typeof body.label === 'string' ? body.label.trim() : null;
  const regenerate = body.regenerate === true;
  if (!eventId) {
    return NextResponse.json({ error: 'eventId is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: event } = await supabase
    .from('events')
    .select('id, title, organizer_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }
  if (!(await isAuthorizedForEvent(auth.sub, event.organizer_id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Reuse the existing active code unless the caller asked to rotate it.
  if (!regenerate) {
    const { data: existing } = await supabase
      .from('event_volunteer_codes')
      .select('code, expires_at')
      .eq('event_id', eventId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const notExpired =
      existing &&
      (!existing.expires_at || new Date(existing.expires_at).getTime() > Date.now());
    if (existing && notExpired) {
      return NextResponse.json({
        code: existing.code,
        eventId: event.id,
        eventTitle: event.title,
        created: false,
      });
    }
  } else {
    await supabase
      .from('event_volunteer_codes')
      .update({ is_active: false })
      .eq('event_id', eventId)
      .eq('is_active', true);
  }

  // Insert a fresh code, retrying on the (rare) unique-collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateVolunteerCode();
    const { data: inserted, error } = await supabase
      .from('event_volunteer_codes')
      .insert({ event_id: eventId, code, label, created_by: auth.sub })
      .select('code')
      .maybeSingle();
    if (!error && inserted) {
      return NextResponse.json({
        code: inserted.code,
        eventId: event.id,
        eventTitle: event.title,
        created: true,
      });
    }
    // 23505 = unique_violation on the code; try a different code.
    if (error && error.code !== '23505') {
      return NextResponse.json(
        { error: 'Could not create a code' },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    { error: 'Could not create a unique code, try again' },
    { status: 500 },
  );
}
