import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveScanIdentity } from '@/lib/scanAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/scan/events — events the signed-in staff member may scan, each with
// its occurrences and live { checkedIn, total } counts.
//   checkedIn = tickets with status 'used'
//   total     = tickets with status in ('valid','used')  (i.e. sold/active)
export async function GET(req: NextRequest) {
  const identity = await resolveScanIdentity(req);
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  let eventsQuery = supabase
    .from('events')
    .select('id, title, venue_name, city, organizer_id');
  if (identity.kind === 'volunteer') {
    // Volunteers are scoped to the single event their code belongs to.
    eventsQuery = eventsQuery.eq('id', identity.eventId);
  } else {
    // Admins see all events; everyone else sees only events they organize.
    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('auth0_id', identity.sub)
      .maybeSingle();
    const isAdmin = userRow?.role === 'admin';
    if (!isAdmin) eventsQuery = eventsQuery.eq('organizer_id', identity.sub);
  }

  const { data: events, error } = await eventsQuery;
  if (error) {
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 });
  }
  if (!events || events.length === 0) {
    return NextResponse.json({ events: [] });
  }

  const eventIds = events.map((e) => e.id);

  const [{ data: occurrences }, { data: tickets }] = await Promise.all([
    supabase
      .from('event_occurrences')
      .select('id, event_id, starts_at, ends_at')
      .in('event_id', eventIds)
      .order('starts_at', { ascending: true }),
    supabase
      .from('tickets')
      .select('event_id, occurrence_id, status')
      .in('event_id', eventIds)
      .in('status', ['valid', 'used']),
  ]);

  type Counts = { checkedIn: number; total: number };
  const byOccurrence = new Map<string, Counts>();
  const byEvent = new Map<string, Counts>();
  for (const t of tickets ?? []) {
    const used = t.status === 'used';
    if (t.occurrence_id) {
      const c = byOccurrence.get(t.occurrence_id) ?? { checkedIn: 0, total: 0 };
      c.total += 1;
      if (used) c.checkedIn += 1;
      byOccurrence.set(t.occurrence_id, c);
    }
    const e = byEvent.get(t.event_id) ?? { checkedIn: 0, total: 0 };
    e.total += 1;
    if (used) e.checkedIn += 1;
    byEvent.set(t.event_id, e);
  }

  const occurrencesByEvent = new Map<
    string,
    Array<{
      id: string;
      startsAt: string | null;
      endsAt: string | null;
      checkedIn: number;
      total: number;
    }>
  >();
  for (const o of occurrences ?? []) {
    const list = occurrencesByEvent.get(o.event_id) ?? [];
    const c = byOccurrence.get(o.id) ?? { checkedIn: 0, total: 0 };
    list.push({
      id: o.id,
      startsAt: o.starts_at,
      endsAt: o.ends_at,
      checkedIn: c.checkedIn,
      total: c.total,
    });
    occurrencesByEvent.set(o.event_id, list);
  }

  const result = events.map((e) => {
    let occ = occurrencesByEvent.get(e.id) ?? [];
    if (occ.length === 0) {
      // Event with no occurrence rows: expose a single bucket from event-level
      // counts so it can still be scanned (occurrence filtering is skipped for
      // occurrence-less tickets in the check-in route).
      const c = byEvent.get(e.id) ?? { checkedIn: 0, total: 0 };
      occ = [
        {
          id: e.id,
          startsAt: null,
          endsAt: null,
          checkedIn: c.checkedIn,
          total: c.total,
        },
      ];
    }
    return {
      id: e.id,
      title: e.title,
      venueName: e.venue_name,
      city: e.city,
      occurrences: occ,
    };
  });

  return NextResponse.json({ events: result });
}
