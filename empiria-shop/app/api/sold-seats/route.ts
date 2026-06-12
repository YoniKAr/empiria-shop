import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sold-seat keying convention (SHOP-1a): tickets store seat LABELS, so this API
// returns labels and every consumer (SeatSelector → SeatmapViewer/SchematicViewer)
// checks sold status by `seat.label`. Seat HOLDS, by contrast, are keyed by the
// config seat ID — the two sets must never be conflated.
export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get('eventId');
  // Optional occurrence scope (S5): a seat sold for occurrence A stays buyable
  // for occurrence B. Tickets with NO occurrence_id are event-wide and block
  // every occurrence (legacy / no-occurrence events).
  const occurrenceId = request.nextUrl.searchParams.get('occurrenceId');

  if (!eventId) {
    return NextResponse.json({ error: 'Missing eventId' }, { status: 400 });
  }
  if (occurrenceId && !UUID_RE.test(occurrenceId)) {
    return NextResponse.json({ error: 'Invalid occurrenceId' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  let query = supabase
    .from('tickets')
    .select('seat_label')
    .eq('event_id', eventId)
    .in('status', ['valid', 'used'])
    .not('seat_label', 'is', null);

  if (occurrenceId) {
    query = query.or(`occurrence_id.eq.${occurrenceId},occurrence_id.is.null`);
  }

  const { data: tickets, error } = await query;

  if (error) {
    console.error('[sold-seats] Failed to fetch sold seats:', error);
    return NextResponse.json({ error: 'Failed to fetch sold seats' }, { status: 500 });
  }

  const seatLabels = (tickets || []).map((t: any) => t.seat_label);

  return NextResponse.json({ seatLabels });
}
