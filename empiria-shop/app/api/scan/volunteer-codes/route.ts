import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  verifyScannerToken,
  isAuthorizedForEvent,
  generateVolunteerCode,
} from '@/lib/scanAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type AuthedEvent = { id: string; title: string; organizer_id: string | null };

// Shared gate for every volunteer-code action: caller must present a valid
// scanner token AND be the organizer/admin of the event. Returns the event row
// or a ready-to-send error Response.
async function authorizeEvent(
  req: NextRequest,
  eventId: string,
): Promise<
  | { ok: true; sub: string; event: AuthedEvent }
  | { ok: false; res: NextResponse }
> {
  const auth = await verifyScannerToken(req);
  if (!auth) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  if (!eventId) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'eventId is required' }, { status: 400 }),
    };
  }
  const supabase = getSupabaseAdmin();
  const { data: event } = await supabase
    .from('events')
    .select('id, title, organizer_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Event not found' }, { status: 404 }),
    };
  }
  if (!(await isAuthorizedForEvent(auth.sub, event.organizer_id))) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }
  return { ok: true, sub: auth.sub, event };
}

// GET /api/scan/volunteer-codes?eventId=…
// Organizer/admin only. Returns the event's current code and whether it's
// active, WITHOUT creating one. `{ exists: false }` when none has been made yet.
export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('eventId') ?? '';
  const gate = await authorizeEvent(req, eventId);
  if (!gate.ok) return gate.res;

  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from('event_volunteer_codes')
    .select('code, is_active')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({
      exists: false,
      eventId: gate.event.id,
      eventTitle: gate.event.title,
    });
  }
  return NextResponse.json({
    exists: true,
    code: existing.code,
    active: existing.is_active,
    eventId: gate.event.id,
    eventTitle: gate.event.title,
  });
}

// POST /api/scan/volunteer-codes   body: { eventId, label?, regenerate? }
//
// Organizer/admin only. Returns the active volunteer code for an event so it
// can be shared. There is exactly one active code per event ("every volunteer
// gets the same code"): an existing active code is returned as-is unless
// `regenerate` is true, which deactivates it and issues a fresh one.
export async function POST(req: NextRequest) {
  let body: { eventId?: unknown; label?: unknown; regenerate?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const eventId = typeof body.eventId === 'string' ? body.eventId : '';
  const label = typeof body.label === 'string' ? body.label.trim() : null;
  const regenerate = body.regenerate === true;

  const gate = await authorizeEvent(req, eventId);
  if (!gate.ok) return gate.res;
  const { event, sub } = gate;

  const supabase = getSupabaseAdmin();

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
      (!existing.expires_at ||
        new Date(existing.expires_at).getTime() > Date.now());
    if (existing && notExpired) {
      return NextResponse.json({
        code: existing.code,
        active: true,
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
      .insert({ event_id: eventId, code, label, created_by: sub })
      .select('code')
      .maybeSingle();
    if (!error && inserted) {
      return NextResponse.json({
        code: inserted.code,
        active: true,
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

// PATCH /api/scan/volunteer-codes   body: { eventId, active: boolean }
//
// Organizer/admin only. Pauses (active=false) or resumes (active=true) the
// event's current volunteer code WITHOUT changing the code string. Deactivated
// codes are rejected at scan time by findActiveVolunteerCode, so this is how an
// organizer temporarily cuts off volunteer access and later restores it.
export async function PATCH(req: NextRequest) {
  let body: { eventId?: unknown; active?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const eventId = typeof body.eventId === 'string' ? body.eventId : '';
  if (typeof body.active !== 'boolean') {
    return NextResponse.json(
      { error: 'active (boolean) is required' },
      { status: 400 },
    );
  }
  const active = body.active;

  const gate = await authorizeEvent(req, eventId);
  if (!gate.ok) return gate.res;

  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from('event_volunteer_codes')
    .select('id, code')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json(
      { error: 'No volunteer code to update' },
      { status: 404 },
    );
  }

  const { error } = await supabase
    .from('event_volunteer_codes')
    .update({ is_active: active })
    .eq('id', existing.id);
  if (error) {
    return NextResponse.json(
      { error: 'Could not update the code' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    code: existing.code,
    active,
    eventId: gate.event.id,
    eventTitle: gate.event.title,
  });
}
