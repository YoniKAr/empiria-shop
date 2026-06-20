import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyScannerToken, isAuthorizedForEvent } from '@/lib/scanAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/scan/check-in   body: { secret, eventId?, occurrenceId? }
// Validates a ticket by its qr_code_secret and marks it used.
// Domain outcomes are returned as { result: ... }; wrong_event/invalid/
// already_used are HTTP 200 (they are results, not errors).
export async function POST(req: NextRequest) {
  const auth = await verifyScannerToken(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { secret?: unknown; eventId?: unknown; occurrenceId?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const secret = typeof body.secret === 'string' ? body.secret.trim() : '';
  const eventId = typeof body.eventId === 'string' ? body.eventId : null;
  const occurrenceId =
    typeof body.occurrenceId === 'string' ? body.occurrenceId : null;

  if (!secret) {
    return NextResponse.json({ result: 'not_found' }, { status: 404 });
  }

  const supabase = getSupabaseAdmin();

  const { data: ticket } = await supabase
    .from('tickets')
    .select(
      `
      id, status, seat_label, attendee_name, order_id, occurrence_id, tier_id,
      event:events!tickets_event_id_fkey (id, title, venue_name, city, organizer_id, seating_config),
      occurrence:event_occurrences!tickets_occurrence_id_fkey (id, starts_at, ends_at),
      tier:ticket_tiers!tickets_tier_id_fkey (id, name)
    `,
    )
    .eq('qr_code_secret', secret)
    .maybeSingle();

  if (!ticket) {
    return NextResponse.json({ result: 'not_found' }, { status: 404 });
  }

  // Embedded to-one relations come back as objects under these aliases.
  const event = ticket.event as unknown as {
    id: string;
    title: string;
    venue_name: string | null;
    city: string | null;
    organizer_id: string | null;
    seating_config: unknown;
  } | null;
  const occurrence = ticket.occurrence as unknown as {
    id: string;
    starts_at: string | null;
  } | null;
  const tier = ticket.tier as unknown as { name: string } | null;

  if (eventId && event?.id && eventId !== event.id) {
    return NextResponse.json({ result: 'wrong_event' });
  }
  if (occurrenceId && ticket.occurrence_id && occurrenceId !== ticket.occurrence_id) {
    return NextResponse.json({ result: 'wrong_occurrence' });
  }

  if (!(await isAuthorizedForEvent(auth.sub, event?.organizer_id))) {
    return NextResponse.json({ result: 'forbidden' }, { status: 403 });
  }

  const ticketPayload = {
    attendeeName: ticket.attendee_name ?? null,
    orderRef: ticket.order_id
      ? String(ticket.order_id).slice(0, 8).toUpperCase()
      : null,
    eventTitle: event?.title ?? null,
    tierName: tier?.name ?? null,
    seatLabel: ticket.seat_label ?? null,
    zone: resolveZone(event?.seating_config, ticket.tier_id),
    occurrenceStartsAt: occurrence?.starts_at ?? null,
    status: ticket.status,
  };

  if (ticket.status === 'used') {
    const { data: row } = await supabase
      .from('tickets')
      .select('checked_in_at')
      .eq('id', ticket.id)
      .maybeSingle();
    return NextResponse.json({
      result: 'already_used',
      checkedInAt: row?.checked_in_at ?? null,
      ticket: ticketPayload,
    });
  }

  if (ticket.status !== 'valid') {
    // refunded / void / etc.
    return NextResponse.json({ result: 'invalid', status: ticket.status });
  }

  // Conditional update: only the scan that flips 'valid' -> 'used' wins, so two
  // simultaneous scans can't both succeed.
  const now = new Date().toISOString();
  const { data: updated } = await supabase
    .from('tickets')
    .update({ status: 'used', checked_in_at: now, checked_in_by: auth.sub })
    .eq('id', ticket.id)
    .eq('status', 'valid')
    .select('id');

  if (!updated || updated.length === 0) {
    // Lost the race — it was just checked in elsewhere.
    const { data: row } = await supabase
      .from('tickets')
      .select('checked_in_at')
      .eq('id', ticket.id)
      .maybeSingle();
    return NextResponse.json({
      result: 'already_used',
      checkedInAt: row?.checked_in_at ?? null,
      ticket: { ...ticketPayload, status: 'used' },
    });
  }

  return NextResponse.json({
    result: 'ok',
    verifiedAt: now,
    ticket: { ...ticketPayload, status: 'used' },
  });
}

// Resolve a ticket's seating zone name from the event's seating_config by
// matching the ticket's tier to a zone (zones carry tier_id + name). Returns
// null for GA / unseated events or when no zone matches.
function resolveZone(seatingConfig: unknown, tierId: unknown): string | null {
  if (!seatingConfig || typeof tierId !== 'string') return null;
  const zones = (seatingConfig as { zones?: unknown }).zones;
  if (!Array.isArray(zones)) return null;
  for (const z of zones) {
    const zone = z as {
      tier_id?: string;
      name?: string;
      tiers?: Array<{ id?: string; tier_id?: string }>;
    };
    if (zone.tier_id === tierId) return zone.name ?? null;
    if (
      Array.isArray(zone.tiers) &&
      zone.tiers.some((t) => t?.id === tierId || t?.tier_id === tierId)
    ) {
      return zone.name ?? null;
    }
  }
  return null;
}
