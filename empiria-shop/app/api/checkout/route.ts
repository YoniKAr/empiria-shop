// ──────────────────────────────────────────────────
// 📁 app/api/checkout/route.ts — NEW FILE (create this)
// Creates a Stripe Checkout Session with Connect payment routing
// ──────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getSafeSession } from '@/lib/auth0';
import { stripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase';
import { toStripeAmount } from '@/lib/utils';

interface TierSelection {
  tierId: string;
  quantity: number;
}

interface SeatSelection {
  seatId: string;
  sectionId: string;
  label: string;
}

interface AssignedSeatSelection {
  label: string;
  tierId: string;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Parse request body
    const body = await request.json();
    const { eventId, tiers, contactEmail, contactName, occurrenceId, seatSelections, sessionId, assignedSeats } = body as {
      eventId: string;
      tiers: TierSelection[];
      contactEmail?: string;
      contactName?: string;
      occurrenceId?: string;
      seatSelections?: SeatSelection[];
      sessionId?: string;
      assignedSeats?: AssignedSeatSelection[];
    };

    if (!eventId || !tiers || tiers.length === 0) {
      return NextResponse.json(
        { error: 'Missing eventId or tier selections' },
        { status: 400 }
      );
    }

    // 2. Get session (optional — guests can checkout too)
    const session = await getSafeSession();
    const user = session?.user;

    // 3. Fetch event + organizer info from Supabase
    const supabase = getSupabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title, slug, organizer_id, platform_fee_percent, platform_fee_fixed, pass_processing_fee, currency, status, total_capacity, total_tickets_sold, seating_type, seating_config, source_app')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }


    if (event.status !== 'published') {
      return NextResponse.json({ error: 'Event is not available for purchase' }, { status: 400 });
    }

    // Validate occurrence if provided
    if (occurrenceId) {
      const { data: occurrence } = await supabase
        .from('event_occurrences')
        .select('id, event_id, starts_at, is_cancelled')
        .eq('id', occurrenceId)
        .single();

      if (!occurrence || occurrence.event_id !== eventId) {
        return NextResponse.json({ error: 'Invalid event date selected' }, { status: 400 });
      }
      if (occurrence.is_cancelled) {
        return NextResponse.json({ error: 'This event date has been cancelled' }, { status: 400 });
      }
      if (new Date(occurrence.starts_at) < new Date()) {
        return NextResponse.json({ error: 'This event date has already started' }, { status: 400 });
      }
    }

    // 4. Fetch organizer's Stripe Connect account (skip for platform-owned events)
    const isPlatformEvent = event.source_app === 'admin';
    let organizer: { stripe_account_id: string | null; stripe_onboarding_completed: boolean | null; full_name: string | null } | null = null;

    if (!isPlatformEvent) {
      const { data: orgData, error: orgError } = await supabase
        .from('users')
        .select('stripe_account_id, stripe_onboarding_completed, full_name')
        .eq('auth0_id', event.organizer_id)
        .single();

      if (orgError || !orgData?.stripe_account_id || !orgData.stripe_onboarding_completed) {
        return NextResponse.json(
          { error: 'This event\'s organizer has not completed payment setup. Please contact the organizer.' },
          { status: 400 }
        );
      }
      organizer = orgData;
    }

    // 5. Fetch selected ticket tiers
    const tierIds = tiers.map((t) => t.tierId);
    const { data: ticketTiers, error: tierError } = await supabase
      .from('ticket_tiers')
      .select('id, name, description, price, currency, remaining_quantity, max_per_order, sales_start_at, sales_end_at, is_hidden, event_id')
      .in('id', tierIds)
      .eq('event_id', eventId);

    if (tierError || !ticketTiers || ticketTiers.length === 0) {
      return NextResponse.json({ error: 'Invalid ticket tiers' }, { status: 400 });
    }

    // 6. Validate each tier selection
    const now = new Date();
    let subtotal = 0;
    const lineItems: Array<{
      price_data: {
        currency: string;
        product_data: { name: string; description?: string };
        unit_amount: number;
      };
      quantity: number;
    }> = [];

    const tierMap = new Map(ticketTiers.map((t) => [t.id, t]));
    const validatedSelections: Array<{ tierId: string; quantity: number; unitPrice: number; tierName: string }> = [];

    for (const selection of tiers) {
      const tier = tierMap.get(selection.tierId);
      if (!tier) {
        return NextResponse.json({ error: `Tier ${selection.tierId} not found` }, { status: 400 });
      }

      if (tier.event_id !== eventId) {
        return NextResponse.json({ error: 'Tier does not belong to this event' }, { status: 400 });
      }

      if (selection.quantity < 1 || selection.quantity > tier.max_per_order) {
        return NextResponse.json(
          { error: `Quantity for "${tier.name}" must be between 1 and ${tier.max_per_order}` },
          { status: 400 }
        );
      }

      if (tier.remaining_quantity < selection.quantity) {
        return NextResponse.json(
          { error: `Only ${tier.remaining_quantity} "${tier.name}" tickets remaining` },
          { status: 400 }
        );
      }

      if (tier.sales_start_at && new Date(tier.sales_start_at) > now) {
        return NextResponse.json({ error: `Sales for "${tier.name}" have not started yet` }, { status: 400 });
      }

      if (tier.sales_end_at && new Date(tier.sales_end_at) < now) {
        return NextResponse.json({ error: `Sales for "${tier.name}" have ended` }, { status: 400 });
      }

      const tierSubtotal = tier.price * selection.quantity;
      subtotal += tierSubtotal;

      validatedSelections.push({
        tierId: tier.id,
        quantity: selection.quantity,
        unitPrice: tier.price,
        tierName: tier.name,
      });

      lineItems.push({
        price_data: {
          currency: event.currency || 'cad',
          product_data: {
            name: `${tier.name} — ${event.title}`,
            ...(tier.description && { description: tier.description }),
          },
          unit_amount: toStripeAmount(tier.price, event.currency || 'cad'),
        },
        quantity: selection.quantity,
      });
    }

    // 6b. If seat_map mode, verify each seat has a valid hold for this session
    if (seatSelections && seatSelections.length > 0 && sessionId) {
      const { data: activeHolds, error: holdsError } = await supabase
        .from('seat_holds')
        .select('seat_id, session_id')
        .eq('event_id', eventId)
        .in('seat_id', seatSelections.map((s) => s.seatId))
        .gt('expires_at', new Date().toISOString());

      if (holdsError) {
        return NextResponse.json({ error: 'Failed to verify seat holds' }, { status: 500 });
      }

      const holdMap = new Map((activeHolds || []).map((h) => [h.seat_id, h.session_id]));

      for (const seat of seatSelections) {
        const holdSession = holdMap.get(seat.seatId);
        if (!holdSession) {
          return NextResponse.json(
            { error: `Your hold on seat ${seat.label} has expired. Please select it again.` },
            { status: 409 }
          );
        }
        if (holdSession !== sessionId) {
          return NextResponse.json(
            { error: `Seat ${seat.label} is held by another customer.` },
            { status: 409 }
          );
        }
      }
    }

    // 6c. Handle assigned seating (assigned_seating with seat_ranges)
    let resolvedAssignedSeats: AssignedSeatSelection[] | null = null;

    if (event.seating_type === 'assigned_seating') {
      const seatingConfig = event.seating_config as { seat_ranges?: Array<{ id: string; prefix: string; start: number; end: number; tier_id: string }>; allow_seat_choice?: boolean } | null;
      const seatRanges = seatingConfig?.seat_ranges || [];

      if (seatRanges.length > 0) {
        if (assignedSeats && assignedSeats.length > 0) {
          // User chose specific seats — validate they aren't sold or held
          const seatLabelsToCheck = assignedSeats.map((s) => s.label);

          const { data: soldTickets } = await supabase
            .from('tickets')
            .select('seat_label')
            .eq('event_id', eventId)
            .not('seat_label', 'is', null)
            .in('status', ['valid', 'checked_in']);

          const soldLabels = new Set(
            (soldTickets || []).map((t: any) => t.seat_label).filter(Boolean)
          );

          const { data: activeHolds } = await supabase
            .from('seat_holds')
            .select('seat_id')
            .eq('event_id', eventId)
            .gt('expires_at', new Date().toISOString());

          const heldLabels = new Set(
            (activeHolds || []).map((h: any) => h.seat_id)
          );

          for (const seat of seatLabelsToCheck) {
            if (soldLabels.has(seat)) {
              return NextResponse.json(
                { error: `Seat ${seat} is already sold.` },
                { status: 409 }
              );
            }
            if (heldLabels.has(seat)) {
              return NextResponse.json(
                { error: `Seat ${seat} is currently held by another customer.` },
                { status: 409 }
              );
            }
          }

          resolvedAssignedSeats = assignedSeats;
        } else {
          // Auto-assign: pick next available seats from ranges for each tier
          const autoAssigned: AssignedSeatSelection[] = [];

          // Get all sold/held labels
          const { data: soldTickets } = await supabase
            .from('tickets')
            .select('seat_label')
            .eq('event_id', eventId)
            .not('seat_label', 'is', null)
            .in('status', ['valid', 'checked_in']);

          const soldLabels = new Set(
            (soldTickets || []).map((t: any) => t.seat_label).filter(Boolean)
          );

          const { data: activeHolds } = await supabase
            .from('seat_holds')
            .select('seat_id')
            .eq('event_id', eventId)
            .gt('expires_at', new Date().toISOString());

          const heldLabels = new Set(
            (activeHolds || []).map((h: any) => h.seat_id)
          );

          for (const selection of validatedSelections) {
            const tierRanges = seatRanges.filter((r) => r.tier_id === selection.tierId);
            const availableLabels: string[] = [];

            for (const range of tierRanges) {
              for (let i = range.start; i <= range.end; i++) {
                const label = `${range.prefix}${i}`;
                if (!soldLabels.has(label) && !heldLabels.has(label)) {
                  availableLabels.push(label);
                }
              }
            }

            if (availableLabels.length < selection.quantity) {
              return NextResponse.json(
                { error: `Not enough seats available for ${selection.tierName}. Only ${availableLabels.length} remaining.` },
                { status: 409 }
              );
            }

            for (let i = 0; i < selection.quantity; i++) {
              autoAssigned.push({ label: availableLabels[i], tierId: selection.tierId });
              // Mark as taken so next tier iteration won't pick same seat
              soldLabels.add(availableLabels[i]);
            }
          }

          resolvedAssignedSeats = autoAssigned;
        }
      }
    }

    // 7. Calculate fees
    const currency = event.currency || 'cad';
    const feePercent = Number(event.platform_fee_percent) || 3.5;
    const feeFixedPerTicket = event.platform_fee_fixed != null ? Number(event.platform_fee_fixed) : 1.50;
    const passProcessingFee = event.pass_processing_fee === true;

    // Total ticket count for per-ticket fixed fee
    const totalTickets = validatedSelections.reduce((sum: number, s: { quantity: number }) => sum + s.quantity, 0);

    // Platform fee: always on base subtotal, fixed fee is per-ticket
    const platformFee = subtotal * (feePercent / 100) + (feeFixedPerTicket * totalTickets);

    // Stripe processing fee estimate (Stripe Canada: 2.9% + $0.30)
    const STRIPE_PERCENT = 0.029;
    const STRIPE_FIXED = 0.30;

    let customerTotal: number;
    let processingFeeAmount: number;
    let organizerPayout: number;

    if (passProcessingFee) {
      // Pass processing fees to attendee: inflate total using reverse formula
      customerTotal = Math.round(((subtotal + STRIPE_FIXED) / (1 - STRIPE_PERCENT)) * 100) / 100;
      processingFeeAmount = Math.round((customerTotal - subtotal) * 100) / 100;
      organizerPayout = subtotal - platformFee;
    } else {
      // Organizer absorbs: customer pays just the subtotal
      customerTotal = subtotal;
      processingFeeAmount = 0;
      organizerPayout = subtotal - platformFee;
    }

    // Add processing fee as a separate line item when passed to attendee
    if (passProcessingFee && processingFeeAmount > 0) {
      lineItems.push({
        price_data: {
          currency,
          product_data: {
            name: 'Processing Fee',
            description: 'Payment processing fee',
          },
          unit_amount: toStripeAmount(processingFeeAmount, currency),
        },
        quantity: 1,
      });
    }

    // 7b. Check for multi-organizer revenue splits
    const { data: splits } = await supabase
      .from('revenue_splits')
      .select('recipient_user_id, recipient_stripe_id, percentage, description')
      .eq('event_id', eventId)
      .eq('source_type', 'net_revenue');

    const hasMultiSplit = splits && splits.length > 0;
    const transferGroup = `evt_${eventId.slice(0, 8)}_${Date.now()}`;

    // 8. Determine user identity
    const customerEmail = contactEmail || user?.email;
    const userId = user?.sub || `guest_${Date.now()}`;

    // 9. Build metadata for webhook processing
    const metadata: Record<string, string> = {
      event_id: eventId,
      user_auth0_id: user?.sub || '',
      user_email: customerEmail || '',
      user_name: contactName || user?.name || '',
      tier_selections: JSON.stringify(validatedSelections),
      platform_fee: platformFee.toFixed(2),
      platform_fee_percent: feePercent.toString(),
      platform_fee_fixed: feeFixedPerTicket.toString(),
      organizer_payout: organizerPayout.toFixed(2),
      subtotal: subtotal.toFixed(2),
      customer_total: customerTotal.toFixed(2),
      processing_fee_amount: processingFeeAmount.toFixed(2),
      pass_processing_fee: passProcessingFee.toString(),
      total_tickets: totalTickets.toString(),
      source_app: 'shop',
      occurrence_id: occurrenceId || '',
    };

    // Include transfer_group and organizer metadata for webhook processing
    metadata.transfer_group = transferGroup;
    metadata.is_platform_event = isPlatformEvent ? 'true' : 'false';
    metadata.organizer_stripe_id = organizer?.stripe_account_id || '';
    if (hasMultiSplit) {
      metadata.splits = JSON.stringify(splits);
    }

    // Include seat selections for seat_map mode
    if (seatSelections && seatSelections.length > 0) {
      metadata.seat_selections = JSON.stringify(seatSelections);
      metadata.seat_session_id = sessionId || '';
    }

    // Include assigned seats for assigned_seating mode
    if (resolvedAssignedSeats && resolvedAssignedSeats.length > 0) {
      metadata.assigned_seats = JSON.stringify(resolvedAssignedSeats.map((s) => s.label));
    }

    // 10. Create Stripe Checkout Session
    const appBaseUrl = process.env.APP_BASE_URL || 'https://shop.empiriaindia.com';

    let checkoutSession;

    // Unified checkout: all charges land on platform account.
    // Transfers to organizer/partners happen in the webhook.
    // Tax stays on platform for remittance.
    checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      automatic_tax: { enabled: true },
      ...(customerEmail && { customer_email: customerEmail }),
      payment_intent_data: {
        transfer_group: transferGroup,
        metadata,
      },
      metadata,
      success_url: `${appBaseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appBaseUrl}/events/${event.slug}`,
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error: unknown) {
    console.error('[Checkout API Error]', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
