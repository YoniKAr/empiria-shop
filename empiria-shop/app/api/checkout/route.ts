// ──────────────────────────────────────────────────
// 📁 app/api/checkout/route.ts — NEW FILE (create this)
// Creates a Stripe Checkout Session with Connect payment routing
// ──────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getSafeSession } from '@/lib/auth0';
import { stripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase';
import { toStripeAmount } from '@/lib/utils';
import { computeFees, DEFAULT_FEE_PERCENT, DEFAULT_FIXED_PER_TICKET } from '@/lib/fees';
import { sendOrderConfirmationEmail } from '@/lib/email';

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
  // Holds the coupon id whose reservation must be released if this request throws
  // after reserving but before the Stripe session takes ownership. Cleared once the
  // session is created (then the webhook owns release on expiry/failure).
  let reservedCouponId: string | null = null;
  // Bound to getSupabaseAdmin() once available so the catch can issue the release.
  let supabaseForRelease: ReturnType<typeof getSupabaseAdmin> | null = null;
  try {
    // 1. Parse request body
    const body = await request.json();
    const { eventId, tiers, contactEmail, contactName, occurrenceId, seatSelections, sessionId, assignedSeats, couponCode, fieldResponses } = body as {
      eventId: string;
      tiers: TierSelection[];
      contactEmail?: string;
      contactName?: string;
      occurrenceId?: string;
      seatSelections?: SeatSelection[];
      sessionId?: string;
      assignedSeats?: AssignedSeatSelection[];
      couponCode?: string;
      fieldResponses?: Array<{
        tierId: string;
        perTicket: Array<Array<{ field_id: string; label: string; value: string }>>;
      }>;
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
    supabaseForRelease = supabase;

    // Only attendees (and not-logged-in guests) may purchase. Organizer / non-profit /
    // admin accounts manage events and must not buy tickets on those accounts.
    if (user?.sub) {
      const { data: buyer } = await supabase
        .from('users')
        .select('role')
        .eq('auth0_id', user.sub)
        .single();
      if (buyer?.role && buyer.role !== 'attendee') {
        return NextResponse.json(
          { error: 'You must be logged in with an attendee account to buy tickets. Log out and sign back in with an attendee account to continue.' },
          { status: 403 }
        );
      }
    }

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title, slug, organizer_id, platform_fee_percent, platform_fee_fixed, pass_processing_fee, currency, status, shared_capacity, total_capacity, total_tickets_sold, seating_type, seating_config, source_app, charge_ticket_tax, custom_fields, entry_type')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }


    if (event.status !== 'published') {
      return NextResponse.json({ error: 'Event is not available for purchase' }, { status: 400 });
    }

    if (event.entry_type === 'external') {
      return NextResponse.json({ error: 'External events do not support checkout.' }, { status: 400 });
    }

    // Custom fields for per-ticket answer validation (validated below, after the
    // purchased tiers are themselves validated for quantity/availability).
    const customFields = (event.custom_fields ?? []) as Array<{ id: string; label: string; type: string; required: boolean }>;
    const requiredIds = customFields.filter((f) => f.required).map((f) => f.id);

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

    // 4. Resolve the event owner. An event is "platform-owned" only when its owner is
    // an admin/platform account — NOT merely because it was created via the admin app.
    // Admins can create events on behalf of real organizers, who must still be paid.
    const { data: ownerData } = await supabase
      .from('users')
      .select('role, stripe_account_id, stripe_onboarding_completed, full_name')
      .eq('auth0_id', event.organizer_id)
      .single();

    const isPlatformEvent = ownerData?.role === 'admin';
    let organizer: { stripe_account_id: string | null; stripe_onboarding_completed: boolean | null; full_name: string | null } | null = null;

    if (!isPlatformEvent) {
      if (!ownerData?.stripe_account_id || !ownerData.stripe_onboarding_completed) {
        return NextResponse.json(
          { error: 'This event\'s organizer has not completed payment setup. Please contact the organizer.' },
          { status: 400 }
        );
      }
      organizer = {
        stripe_account_id: ownerData.stripe_account_id,
        stripe_onboarding_completed: ownerData.stripe_onboarding_completed,
        full_name: ownerData.full_name,
      };
    }

    // 5. Fetch selected ticket tiers
    const tierIds = tiers.map((t) => t.tierId);
    const { data: ticketTiers, error: tierError } = await supabase
      .from('ticket_tiers')
      .select('id, name, description, price, currency, remaining_quantity, min_per_order, max_per_order, sales_start_at, sales_end_at, is_hidden, event_id')
      .in('id', tierIds)
      .eq('event_id', eventId);

    if (tierError || !ticketTiers || ticketTiers.length === 0) {
      return NextResponse.json({ error: 'Invalid ticket tiers' }, { status: 400 });
    }

    // 6. Validate each tier selection
    const now = new Date();
    let subtotal = 0;
    const chargeTicketTax = event.charge_ticket_tax === true;

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

      const minQty = (tier as { min_per_order?: number }).min_per_order ?? 1;
      if (selection.quantity < minQty || selection.quantity > tier.max_per_order) {
        return NextResponse.json(
          { error: `Quantity for "${tier.name}" must be between ${minQty} and ${tier.max_per_order}` },
          { status: 400 }
        );
      }

      // In shared-capacity mode the per-tier remaining_quantity is seeded to equal
      // the event pool and is NOT the real constraint — the event pool is checked
      // after this loop. Skip the per-tier check in shared mode.
      if (!event.shared_capacity && tier.remaining_quantity < selection.quantity) {
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
    }

    // Shared-capacity pool check: the EVENT pool is the constraint in shared mode.
    // (The DB trigger remains the final atomic guard.)
    if (event.shared_capacity) {
      const sharedRemaining = Math.max(0, (event.total_capacity ?? 0) - (event.total_tickets_sold ?? 0));
      const totalRequested = validatedSelections.reduce((s, sel) => s + sel.quantity, 0);
      if (totalRequested > sharedRemaining) {
        return NextResponse.json(
          { error: `Only ${sharedRemaining} tickets remaining for this event.` },
          { status: 400 }
        );
      }
    }

    // 6-fields. Validate per-ticket required custom field answers server-side.
    // Iterate the SERVER-validated purchased tiers (not the client's fieldResponses)
    // so an omitted/short fieldResponses payload can't bypass required answers.
    if (requiredIds.length) {
      for (const selection of validatedSelections) {
        const tierResponses = (fieldResponses ?? []).find((r) => r.tierId === selection.tierId);
        for (let i = 0; i < selection.quantity; i++) {
          const perTicket = tierResponses?.perTicket?.[i] ?? [];
          for (const id of requiredIds) {
            const ans = perTicket.find((r) => r.field_id === id);
            if (!ans || !String(ans.value).trim()) {
              return NextResponse.json({ error: 'Missing required checkout answers.' }, { status: 400 });
            }
          }
        }
      }
    }

    // 6a. Coupon validation (inline for atomicity with checkout)
    let discountAmount = 0;
    let couponId: string | null = null;
    let couponCode_validated: string | null = null;

    if (couponCode) {
      const trimmedCode = couponCode.trim();

      // Look up coupon by code (case-insensitive)
      const { data: coupon, error: couponError } = await supabase
        .from('coupons')
        .select('id, code, discount_type, discount_value, max_discount_cap, currency, is_active, starts_at, expires_at, max_uses, current_uses, max_uses_per_user, scope, event_id, category_id, created_by')
        .ilike('code', trimmedCode)
        .single();

      if (couponError || !coupon) {
        return NextResponse.json({ error: 'Invalid coupon code' }, { status: 400 });
      }

      if (!coupon.is_active) {
        return NextResponse.json({ error: 'This coupon is no longer active' }, { status: 400 });
      }

      if (coupon.starts_at && new Date(coupon.starts_at) > now) {
        return NextResponse.json({ error: 'This coupon is not yet active' }, { status: 400 });
      }

      if (coupon.expires_at && new Date(coupon.expires_at) < now) {
        return NextResponse.json({ error: 'This coupon has expired' }, { status: 400 });
      }

      if (coupon.max_uses !== null && coupon.current_uses >= coupon.max_uses) {
        return NextResponse.json({ error: 'This coupon has reached its usage limit' }, { status: 400 });
      }

      // Scope validation
      switch (coupon.scope) {
        case 'event':
          if (coupon.event_id !== eventId) {
            return NextResponse.json({ error: 'This coupon is not valid for this event' }, { status: 400 });
          }
          break;
        case 'organizer_all':
          if (coupon.created_by !== event.organizer_id) {
            return NextResponse.json({ error: 'This coupon is not valid for this event' }, { status: 400 });
          }
          break;
        case 'platform_all':
          // Always valid
          break;
        case 'category': {
          const { data: eventCat } = await supabase
            .from('events')
            .select('category_id')
            .eq('id', eventId)
            .single();
          if (coupon.category_id !== eventCat?.category_id) {
            return NextResponse.json({ error: 'This coupon is not valid for this event category' }, { status: 400 });
          }
          break;
        }
        default:
          return NextResponse.json({ error: 'Invalid coupon scope' }, { status: 400 });
      }

      // Per-user limit check (skip for guests)
      const userId_check = user?.sub || null;
      if (userId_check && coupon.max_uses_per_user !== null) {
        const { count } = await supabase
          .from('coupon_usages')
          .select('id', { count: 'exact', head: true })
          .eq('coupon_id', coupon.id)
          .eq('user_id', userId_check);

        if (count !== null && count >= coupon.max_uses_per_user) {
          return NextResponse.json({ error: 'You have already used this coupon the maximum number of times' }, { status: 400 });
        }
      }

      // Calculate discount amount
      if (coupon.discount_type === 'percentage') {
        discountAmount = subtotal * (coupon.discount_value / 100);
        if (coupon.max_discount_cap) {
          discountAmount = Math.min(discountAmount, coupon.max_discount_cap);
        }
      } else {
        // Flat discount
        if (subtotal < coupon.discount_value) {
          return NextResponse.json({ error: 'Order subtotal is less than the coupon discount amount' }, { status: 400 });
        }
        discountAmount = coupon.discount_value;
      }

      discountAmount = Math.round(discountAmount * 100) / 100;
      couponId = coupon.id;
      couponCode_validated = coupon.code;

      // Atomically RESERVE one use now (capped at max_uses) to prevent two
      // concurrent checkouts both passing the max_uses gate above. The webhook
      // no longer increments after payment; instead it releases this reservation
      // on checkout.session.expired / payment_intent.payment_failed. Returns
      // false when capacity was already reached → reject before creating Stripe.
      const { data: reserved, error: reserveErr } = await supabase.rpc(
        'increment_coupon_usage',
        { p_coupon_id: couponId }
      );
      if (reserveErr) {
        console.error('[Checkout] increment_coupon_usage failed:', reserveErr);
        return NextResponse.json({ error: 'Could not apply coupon. Please try again.' }, { status: 500 });
      }
      if (reserved === false) {
        return NextResponse.json({ error: 'This coupon has reached its usage limit.' }, { status: 400 });
      }
      // Reservation now held — mark it for release if checkout fails before the
      // Stripe session takes ownership.
      reservedCouponId = couponId;
    }

    // Release the coupon reservation if checkout fails AFTER reserving but BEFORE
    // a Stripe session exists (no webhook would ever fire to release it otherwise).
    // After the Stripe session is created we clear reservedCouponId so the reservation
    // persists into the webhook lifecycle (which releases it on expiry/failure).
    const releaseCouponOnFailure = async () => {
      if (reservedCouponId) {
        const { error: relErr } = await supabase.rpc('decrement_coupon_usage', { p_coupon_id: reservedCouponId });
        if (relErr) console.error('[Checkout] decrement_coupon_usage (release on failure) failed:', relErr);
        reservedCouponId = null;
      }
    };

    // 6b. If seat_map mode, verify each seat has a valid hold for this session
    if (seatSelections && seatSelections.length > 0 && sessionId) {
      const { data: activeHolds, error: holdsError } = await supabase
        .from('seat_holds')
        .select('seat_id, session_id')
        .eq('event_id', eventId)
        .in('seat_id', seatSelections.map((s) => s.seatId))
        .gt('expires_at', new Date().toISOString());

      if (holdsError) {
        await releaseCouponOnFailure();
        return NextResponse.json({ error: 'Failed to verify seat holds' }, { status: 500 });
      }

      const holdMap = new Map((activeHolds || []).map((h) => [h.seat_id, h.session_id]));

      for (const seat of seatSelections) {
        const holdSession = holdMap.get(seat.seatId);
        if (!holdSession) {
          await releaseCouponOnFailure();
          return NextResponse.json(
            { error: `Your hold on seat ${seat.label} has expired. Please select it again.` },
            { status: 409 }
          );
        }
        if (holdSession !== sessionId) {
          await releaseCouponOnFailure();
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
            .in('status', ['valid', 'used']);

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
              await releaseCouponOnFailure();
              return NextResponse.json(
                { error: `Seat ${seat} is already sold.` },
                { status: 409 }
              );
            }
            if (heldLabels.has(seat)) {
              await releaseCouponOnFailure();
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
            .in('status', ['valid', 'used']);

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
              await releaseCouponOnFailure();
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

    // 7. Calculate fees (single source of truth: lib/fees.ts)
    const currency = event.currency || 'cad';
    const feePercent = event.platform_fee_percent != null ? Number(event.platform_fee_percent) : DEFAULT_FEE_PERCENT;
    const feeFixedPerTicket = event.platform_fee_fixed != null ? Number(event.platform_fee_fixed) : DEFAULT_FIXED_PER_TICKET;
    const passProcessingFee = event.pass_processing_fee === true;

    const totalTickets = validatedSelections.reduce((sum, s) => sum + s.quantity, 0);
    const paidTickets = validatedSelections.reduce((sum, s) => sum + (s.unitPrice > 0 ? s.quantity : 0), 0);

    const fees = computeFees({
      base: subtotal,
      discount: discountAmount,
      paidTickets,
      chargeTicketTax,
      passProcessingFee,
      feePercent,
      feeFixedPerTicket,
    });

    // ── FREE ORDER ($0 total): skip Stripe entirely, issue tickets directly ──
    // A genuinely free (or fully-discounted-to-$0) order cannot and should not go
    // through Stripe — Stripe rejects $0 charges, and there's no fee to collect.
    // Create the order + tickets inline (mirrors the webhook's fulfillment), then
    // send the buyer to the success page by order id.
    if (fees.customerTotal <= 0) {
      const appBaseUrl = process.env.APP_BASE_URL || 'https://shop.empiriaindia.com';
      const freeEmail = contactEmail || user?.email || '';
      const freeUserId = user?.sub || null;
      const freeName = contactName || user?.name || '';
      const freeFieldResponses = (fieldResponses ?? []) as Array<{
        tierId: string;
        perTicket: Array<Array<{ field_id: string; label: string; value: string }>>;
      }>;

      // 1. Order row (no Stripe ids; all payout/fee fields are zero)
      const { data: freeOrder, error: freeOrderError } = await supabase
        .from('orders')
        .insert({
          user_id: freeUserId,
          event_id: event.id,
          stripe_payment_intent_id: null,
          stripe_checkout_session_id: null,
          total_amount: 0,
          coupon_id: couponId || null,
          discount_amount: discountAmount,
          platform_fee_amount: 0,
          organizer_payout_amount: 0,
          processing_fee_amount: 0,
          ticket_tax_amount: 0,
          platform_fee_tax_amount: 0,
          stripe_fee_amount: 0,
          net_platform_revenue: 0,
          total_tickets: totalTickets,
          currency,
          buyer_email: freeEmail || null,
          buyer_name: freeName || null,
          payout_breakdown: {
            version: 5,
            free_order: true,
            subtotal,
            eff_base: fees.effBase,
            customer_total: 0,
            total_tickets: totalTickets,
            discount_amount: discountAmount,
            coupon_code: couponCode_validated || '',
          },
          status: 'completed',
          source_app: 'shop',
        })
        .select('id')
        .single();

      if (freeOrderError || !freeOrder) {
        console.error('[Checkout] Failed to create free order:', freeOrderError);
        await releaseCouponOnFailure();
        return NextResponse.json(
          { error: 'Could not complete your free order. Please try again.' },
          { status: 500 }
        );
      }

      // The reserved coupon is now consumed by this order — don't release it on catch.
      reservedCouponId = null;

      // 2. order_items + tickets (DB trigger handles inventory + QR generation)
      const seatLabelQueue: string[] = seatSelections && seatSelections.length > 0
        ? seatSelections.map((s: SeatSelection) => s.label)
        : (resolvedAssignedSeats || []).map((s) => s.label);

      const freeTickets: Array<{ id: string; qr_code_secret: string; tierName: string; seatLabel?: string }> = [];

      for (const sel of validatedSelections) {
        await supabase.from('order_items').insert({
          order_id: freeOrder.id,
          tier_id: sel.tierId,
          quantity: sel.quantity,
          unit_price: sel.unitPrice,
          subtotal: sel.unitPrice * sel.quantity,
        });

        const labelsForTier: string[] = [];
        for (let i = 0; i < sel.quantity && seatLabelQueue.length > 0; i++) {
          labelsForTier.push(seatLabelQueue.shift()!);
        }
        const stagedForTier = freeFieldResponses.find((r) => r.tierId === sel.tierId);

        const ticketInserts = Array.from({ length: sel.quantity }, (_, i) => ({
          event_id: event.id,
          tier_id: sel.tierId,
          order_id: freeOrder.id,
          user_id: freeUserId,
          attendee_name: freeName,
          attendee_email: freeEmail,
          status: 'valid' as const,
          occurrence_id: occurrenceId || null,
          field_responses: stagedForTier?.perTicket?.[i] ?? [],
          ...(labelsForTier[i] ? { seat_label: labelsForTier[i] } : {}),
        }));

        const { data: createdTickets, error: ticketError } = await supabase
          .from('tickets')
          .insert(ticketInserts)
          .select('id, qr_code_secret');

        if (ticketError) {
          console.error('[Checkout] Failed to create free tickets:', ticketError);
        } else if (createdTickets) {
          createdTickets.forEach((t, ti) =>
            freeTickets.push({
              id: t.id,
              qr_code_secret: t.qr_code_secret,
              tierName: sel.tierName,
              seatLabel: labelsForTier[ti] || undefined,
            })
          );
        }
      }

      // 3. Release seat holds (seat_map)
      if (seatSelections && seatSelections.length > 0) {
        await supabase
          .from('seat_holds')
          .delete()
          .eq('event_id', event.id)
          .in('seat_id', seatSelections.map((s: SeatSelection) => s.seatId));
      }

      // 4. Record coupon usage (already reserved at checkout — record only)
      if (couponId) {
        await supabase.from('coupon_usages').insert({
          coupon_id: couponId,
          order_id: freeOrder.id,
          user_id: freeUserId,
          discount_amount: discountAmount,
        });
      }

      // 5. Confirmation email (non-blocking)
      if (freeEmail && freeTickets.length > 0) {
        try {
          const { data: emailEvent } = await supabase
            .from('events')
            .select('title, venue_name, city, location_type, meeting_link, cta_label')
            .eq('id', event.id)
            .single();
          let startDate = '';
          let endDate: string | undefined;
          const occRes = occurrenceId
            ? await supabase.from('event_occurrences').select('starts_at, ends_at').eq('id', occurrenceId).single()
            : await supabase.from('event_occurrences').select('starts_at, ends_at').eq('event_id', event.id).order('starts_at', { ascending: true }).limit(1).maybeSingle();
          if (occRes.data) {
            startDate = occRes.data.starts_at;
            endDate = occRes.data.ends_at ?? undefined;
          }
          if (emailEvent) {
            await sendOrderConfirmationEmail({
              to: freeEmail,
              attendeeName: freeName,
              orderId: freeOrder.id,
              eventTitle: emailEvent.title,
              eventDate: startDate,
              eventEndDate: endDate,
              venueName: emailEvent.venue_name || '',
              city: emailEvent.city || '',
              meetingLink: emailEvent.meeting_link || '',
              locationType: emailEvent.location_type || 'physical',
              ctaLabel: emailEvent.cta_label,
              lineItems: validatedSelections.map((s) => ({ tierName: s.tierName, quantity: s.quantity, unitPrice: s.unitPrice })),
              total: 0,
              convenienceFee: 0,
              convenienceFeeHST: 0,
              ticketTax: 0,
              discountAmount,
              couponCode: couponCode_validated || '',
              currency,
              tickets: freeTickets,
            });
          }
        } catch (emailErr) {
          console.error('[Checkout] Free order email failed:', emailErr);
        }
      }

      return NextResponse.json({ url: `${appBaseUrl}/checkout/success?order_id=${freeOrder.id}` });
    }

    // Build Stripe line items summing exactly to fees.customerTotal.
    const lineItems: Array<{
      price_data: { currency: string; product_data: { name: string; description?: string }; unit_amount: number };
      quantity: number;
    }> = [];

    if (discountAmount <= 0) {
      for (const sel of validatedSelections) {
        lineItems.push({
          price_data: {
            currency,
            product_data: { name: `${sel.tierName} — ${event.title}` },
            unit_amount: toStripeAmount(sel.unitPrice, currency),
          },
          quantity: sel.quantity,
        });
      }
    } else {
      // Bake the discount into per-unit ticket lines (last unit absorbs the cent remainder)
      // so sum(ticket lines) === fees.effBase exactly. No Stripe coupon.
      const baseCents = Math.round(subtotal * 100);
      const discountCents = Math.round(discountAmount * 100);
      const units: Array<{ name: string; cents: number }> = [];
      for (const sel of validatedSelections) {
        for (let i = 0; i < sel.quantity; i++) {
          units.push({ name: `${sel.tierName} — ${event.title}`, cents: Math.round(sel.unitPrice * 100) });
        }
      }
      let allocated = 0;
      for (let i = 0; i < units.length; i++) {
        const d = i === units.length - 1 ? discountCents - allocated : Math.round(discountCents * (units[i].cents / baseCents));
        if (i < units.length - 1) allocated += d;
        const net = Math.max(0, units[i].cents - d);
        lineItems.push({
          price_data: { currency, product_data: { name: units[i].name }, unit_amount: net },
          quantity: 1,
        });
      }
    }

    if (fees.customerTax > 0) {
      lineItems.push({
        price_data: { currency, product_data: { name: 'Tax (HST 13%)' }, unit_amount: toStripeAmount(fees.customerTax, currency) },
        quantity: 1,
      });
    }
    if (passProcessingFee && fees.platformFee > 0) {
      lineItems.push({
        price_data: { currency, product_data: { name: 'Service fee', description: 'Platform service fee' }, unit_amount: toStripeAmount(fees.platformFee, currency) },
        quantity: 1,
      });
    }
    if (passProcessingFee && fees.stripeOffset > 0) {
      lineItems.push({
        price_data: { currency, product_data: { name: 'Processing fee', description: 'Secure card processing' }, unit_amount: toStripeAmount(fees.stripeOffset, currency) },
        quantity: 1,
      });
    }

    // 7b. Check for multi-organizer revenue splits (co-organizers with a revenue share)
    const { data: coOrganizerRows } = await supabase
      .from('event_organizers')
      .select('user_id, revenue_percentage, description, users:user_id(stripe_account_id)')
      .eq('event_id', eventId)
      .gt('revenue_percentage', 0);

    // Map co-organizers to the shape the payout pipeline expects (only those with a
    // connected Stripe account can actually receive a transfer).
    const splits = (coOrganizerRows || [])
      .map((row: any) => ({
        recipient_user_id: row.user_id,
        recipient_stripe_id: row.users?.stripe_account_id ?? null,
        percentage: Number(row.revenue_percentage),
        description: row.description,
      }))
      .filter((s) => !!s.recipient_stripe_id);

    // When there are co-organizer splits, the primary organizer must also receive their
    // share. Append them LAST so the webhook's remainder logic gives them their cut plus
    // any rounding drift and any share that couldn't be paid to a co-organizer (no Stripe).
    if (!isPlatformEvent && organizer?.stripe_account_id && splits.length > 0) {
      const coOrgPctTotal = (coOrganizerRows || []).reduce(
        (sum: number, r: any) => sum + Number(r.revenue_percentage || 0),
        0
      );
      splits.push({
        recipient_user_id: event.organizer_id,
        recipient_stripe_id: organizer.stripe_account_id,
        percentage: Math.max(0, 100 - coOrgPctTotal),
        description: 'Primary organizer',
      });
    }

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
      subtotal: subtotal.toFixed(2),
      eff_base: fees.effBase.toFixed(2),
      paid_tickets: paidTickets.toString(),
      total_tickets: totalTickets.toString(),
      platform_fee_percent: feePercent.toString(),
      platform_fee_fixed: feeFixedPerTicket.toString(),
      platform_fee: fees.platformFee.toFixed(2),
      hst_on_base: fees.hstOnBase.toFixed(2),
      hst_on_fee: fees.hstOnFee.toFixed(2),
      hst_total: fees.hstTotal.toFixed(2),
      customer_tax: fees.customerTax.toFixed(2),
      stripe_offset: fees.stripeOffset.toFixed(2),
      stripe_fee_estimate: fees.stripeFeeEstimate.toFixed(2),
      customer_total: fees.customerTotal.toFixed(2),
      organizer_payout: fees.organizerPayout.toFixed(2),
      empiria_keep: fees.empiriaKeep.toFixed(2),
      pass_processing_fee: passProcessingFee.toString(),
      charge_ticket_tax: chargeTicketTax.toString(),
      discount_amount: discountAmount.toFixed(2),
      coupon_id: couponId || '',
      coupon_code: couponCode_validated || '',
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

    // From here on, the coupon reservation is owned by the Stripe session lifecycle:
    // it is released by the webhook on checkout.session.expired / payment_intent.payment_failed,
    // or consumed by the completed order. So stop releasing it on this request's failures.
    reservedCouponId = null;

    // Stage per-ticket custom field responses for the webhook to attach to tickets.
    // Must NOT abort the redirect — the Stripe session already exists at this point.
    if (customFields.length && fieldResponses?.length) {
      const { error: stageError } = await supabase
        .from('checkout_field_responses')
        .insert({ stripe_checkout_session_id: checkoutSession.id, responses: fieldResponses });
      if (stageError) console.error('[Checkout] Failed to stage field responses:', stageError);
    }

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error: unknown) {
    console.error('[Checkout API Error]', error);
    // If we reserved a coupon use but failed before the Stripe session took
    // ownership, release it so the slot isn't leaked.
    if (reservedCouponId && supabaseForRelease) {
      const { error: relErr } = await supabaseForRelease.rpc('decrement_coupon_usage', { p_coupon_id: reservedCouponId });
      if (relErr) console.error('[Checkout] decrement_coupon_usage (catch release) failed:', relErr);
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
