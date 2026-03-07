import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

interface SeatRange {
  id: string;
  prefix: string;
  start: number;
  end: number;
  tier_id: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { eventId, tierId, quantity, checkOnly } = body as {
      eventId: string;
      tierId: string;
      quantity: number;
      checkOnly?: boolean;
    };

    if (!eventId) {
      return NextResponse.json({ error: 'Missing eventId' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // 1. Fetch event's seating_config to get seat_ranges
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('seating_config')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const seatingConfig = event.seating_config as { seat_ranges?: SeatRange[] } | null;
    const seatRanges: SeatRange[] = seatingConfig?.seat_ranges || [];

    if (seatRanges.length === 0) {
      return NextResponse.json(
        { error: 'No seat ranges configured for this event' },
        { status: 400 }
      );
    }

    // 2. Find all ranges for the given tierId (or all ranges if checkOnly)
    const relevantRanges = checkOnly
      ? seatRanges
      : seatRanges.filter((r) => r.tier_id === tierId);

    if (!checkOnly && relevantRanges.length === 0) {
      return NextResponse.json(
        { error: 'No seat ranges found for this tier' },
        { status: 400 }
      );
    }

    // 3. Generate all possible seat labels from those ranges
    const allLabels: string[] = [];
    for (const range of relevantRanges) {
      for (let i = range.start; i <= range.end; i++) {
        allLabels.push(`${range.prefix}${i}`);
      }
    }

    // 4. Query tickets table for already-sold seat labels
    const { data: soldTickets, error: soldError } = await supabase
      .from('tickets')
      .select('seat_label')
      .eq('event_id', eventId)
      .not('seat_label', 'is', null)
      .in('status', ['valid', 'checked_in']);

    if (soldError) {
      return NextResponse.json(
        { error: 'Failed to check sold seats' },
        { status: 500 }
      );
    }

    const soldLabels = new Set(
      (soldTickets || []).map((t) => t.seat_label).filter(Boolean)
    );

    // 5. Query seat_holds table for active holds
    const { data: activeHolds, error: holdsError } = await supabase
      .from('seat_holds')
      .select('seat_id')
      .eq('event_id', eventId)
      .gt('expires_at', new Date().toISOString());

    if (holdsError) {
      return NextResponse.json(
        { error: 'Failed to check seat holds' },
        { status: 500 }
      );
    }

    const heldLabels = new Set(
      (activeHolds || []).map((h) => h.seat_id)
    );

    // If checkOnly, return the sold seats list
    if (checkOnly) {
      const allSold = [...soldLabels, ...heldLabels];
      return NextResponse.json({ soldSeats: allSold });
    }

    if (!quantity || quantity < 1) {
      return NextResponse.json({ error: 'Invalid quantity' }, { status: 400 });
    }

    // 6. Filter out sold and held seats
    const availableLabels = allLabels.filter(
      (label) => !soldLabels.has(label) && !heldLabels.has(label)
    );

    if (availableLabels.length < quantity) {
      return NextResponse.json(
        {
          error: `Only ${availableLabels.length} seats available, but ${quantity} requested`,
        },
        { status: 409 }
      );
    }

    // 7. Return the first N available seat labels
    const assignedSeats = availableLabels.slice(0, quantity);

    return NextResponse.json({ seats: assignedSeats });
  } catch (error: unknown) {
    console.error('[Assign Seats API Error]', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
