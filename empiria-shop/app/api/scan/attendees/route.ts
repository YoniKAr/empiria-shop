import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveScanIdentity, canScanEvent } from '@/lib/scanAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/scan/attendees?eventId=...
// Lists ticket holders for an event the staff member may scan: name, email,
// ticket tier, seat, checked-in status, and (best-effort) avatar.
export async function GET(req: NextRequest) {
  const identity = await resolveScanIdentity(req);
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const eventId = req.nextUrl.searchParams.get('eventId');
  if (!eventId) {
    return NextResponse.json({ error: 'eventId is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: event } = await supabase
    .from('events')
    .select('id, organizer_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }
  if (!(await canScanEvent(identity, { id: event.id, organizer_id: event.organizer_id }))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: tickets, error } = await supabase
    .from('tickets')
    .select(
      `
      id, attendee_name, attendee_email, seat_label, status, user_id,
      tier:ticket_tiers!tickets_tier_id_fkey (name)
    `,
    )
    .eq('event_id', eventId)
    .in('status', ['valid', 'used'])
    .order('attendee_name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Failed to load attendees' }, { status: 500 });
  }

  // Resolve avatars in one query (the ticket's purchaser). tickets.user_id holds
  // the buyer's Auth0 sub, which maps to users.auth0_id (not users.id).
  const userIds = [
    ...new Set((tickets ?? []).map((t) => t.user_id).filter(Boolean)),
  ] as string[];
  const avatarById = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('auth0_id, avatar_url')
      .in('auth0_id', userIds);
    for (const u of users ?? []) {
      avatarById.set(
        u.auth0_id as string,
        (u.avatar_url as string | null) ?? null,
      );
    }
  }

  const attendees = (tickets ?? []).map((t) => {
    const tier = t.tier as unknown as { name: string } | null;
    return {
      id: t.id,
      name: t.attendee_name ?? null,
      email: t.attendee_email ?? null,
      tierName: tier?.name ?? null,
      seatLabel: t.seat_label ?? null,
      checkedIn: t.status === 'used',
      avatarUrl: t.user_id ? avatarById.get(t.user_id) ?? null : null,
    };
  });

  return NextResponse.json({ attendees });
}
