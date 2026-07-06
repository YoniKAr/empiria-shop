import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveScanIdentity, canScanEvent } from '@/lib/scanAuth';
import { resolveZone } from '@/lib/scan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/scan/verify   body: { secret, eventId?, occurrenceId? }
// Read-only twin of /api/scan/check-in: reports whether a ticket is valid for
// the event WITHOUT marking it used. Returns the same `result` union as
// check-in, plus a convenience `valid` boolean (true only when result === 'ok').
// Domain outcomes (wrong_event / invalid / already_used …) are HTTP 200 — they
// are results, not errors.
export async function POST(req: NextRequest) {
  const identity = await resolveScanIdentity(req);
  if (!identity) {
    return NextResponse.json(
      { valid: false, error: 'Unauthorized' },
      { status: 401 },
    );
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
    return NextResponse.json(
      { valid: false, result: 'not_found' },
      { status: 404 },
    );
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
    return NextResponse.json(
      { valid: false, result: 'not_found' },
      { status: 404 },
    );
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
    return NextResponse.json({ valid: false, result: 'wrong_event' });
  }
  if (
    occurrenceId &&
    ticket.occurrence_id &&
    occurrenceId !== ticket.occurrence_id
  ) {
    return NextResponse.json({ valid: false, result: 'wrong_occurrence' });
  }

  if (
    !(await canScanEvent(identity, {
      id: event?.id ?? '',
      organizer_id: event?.organizer_id,
    }))
  ) {
    return NextResponse.json(
      { valid: false, result: 'forbidden' },
      { status: 403 },
    );
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

  // READ ONLY — never writes. Just classify the ticket's current status.
  if (ticket.status === 'used') {
    const { data: row } = await supabase
      .from('tickets')
      .select('checked_in_at')
      .eq('id', ticket.id)
      .maybeSingle();
    return NextResponse.json({
      valid: false,
      result: 'already_used',
      checkedInAt: row?.checked_in_at ?? null,
      ticket: ticketPayload,
    });
  }

  if (ticket.status !== 'valid') {
    // refunded / void / etc.
    return NextResponse.json({
      valid: false,
      result: 'invalid',
      status: ticket.status,
    });
  }

  // Genuine ticket for this event, not yet used.
  return NextResponse.json({
    valid: true,
    result: 'ok',
    ticket: ticketPayload,
  });
}
