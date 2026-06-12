// ──────────────────────────────────────────────────
// app/api/webhooks/stripe/route.ts
// Handles Stripe webhook events — creates orders + tickets on successful payment
//
// ⚠️  STRIPE_WEBHOOK_SECRET is REQUIRED for this file.
//     Without it, anyone can POST fake events to this endpoint
//     and create fraudulent orders in your database.
//     Stripe uses this secret to sign every webhook payload.
//     constructEvent() below verifies that signature.
// ──────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase';
import { sendOrderConfirmationEmail } from '@/lib/email';
import { inviteGuestToFinishSignup } from '@/lib/guest-invite';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event;

  try {
    // This is WHY you need STRIPE_WEBHOOK_SECRET —
    // it verifies the request actually came from Stripe, not an attacker
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid signature';
    console.error('[Webhook] Signature verification failed:', message);
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 });
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      await handleCheckoutCompleted(session);
      break;
    }
    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object;
      console.warn('[Webhook] Payment failed:', paymentIntent.id);
      // Release any coupon reservation held by this checkout.
      await releaseCouponReservation(paymentIntent.metadata, paymentIntent.id, `pi_failed:${paymentIntent.id}`);
      break;
    }
    case 'checkout.session.expired': {
      // The checkout was abandoned / timed out — release the coupon reservation
      // that was taken atomically at checkout time so it isn't held forever.
      // NOTE: the Stripe webhook endpoint MUST have `checkout.session.expired`
      // enabled for this to fire.
      const session = event.data.object;
      const expiredPiId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null;
      await releaseCouponReservation(session.metadata, expiredPiId, `session_expired:${session.id}`);
      break;
    }
    case 'charge.refunded': {
      const charge = event.data.object;
      await handleChargeRefunded(charge);
      break;
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object;
      await handleDisputeCreated(dispute);
      break;
    }
    case 'charge.dispute.closed': {
      // NOTE: the Stripe webhook endpoint MUST have `charge.dispute.closed`
      // enabled for this to fire.
      const dispute = event.data.object;
      await handleDisputeClosed(dispute);
      break;
    }
    default:
      // Unhandled event type — that's fine
      break;
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: any) {
  const supabase = getSupabaseAdmin();
  const metadata = session.metadata;

  if (!metadata?.event_id || !metadata?.tier_selections) {
    console.error('[Webhook] Missing metadata on checkout session:', session.id);
    return;
  }

  // Check if order already exists (idempotency)
  const { data: existingOrder } = await supabase
    .from('orders')
    .select('id')
    .eq('stripe_checkout_session_id', session.id)
    .single();

  if (existingOrder) {
    console.log('[Webhook] Order already exists for session:', session.id);
    return;
  }

  // Load staged per-ticket custom field responses (if any) for this session.
  const { data: staged } = await supabase
    .from('checkout_field_responses')
    .select('responses')
    .eq('stripe_checkout_session_id', session.id)
    .maybeSingle();
  const stagedResponses = (staged?.responses ?? []) as Array<{
    tierId: string;
    perTicket: Array<Array<{ field_id: string; label: string; value: string }>>;
  }>;

  const eventId = metadata.event_id;
  const userAuth0Id = metadata.user_auth0_id || null;
  const userEmail = metadata.user_email || session.customer_email || '';
  const userName = metadata.user_name || '';
  const occurrenceId = metadata.occurrence_id || null;
  const tierSelections = JSON.parse(metadata.tier_selections) as Array<{
    tierId: string;
    quantity: number;
    unitPrice: number;
    tierName: string;
  }>;
  const subtotal = parseFloat(metadata.subtotal || '0');
  const effBase = parseFloat(metadata.eff_base || metadata.subtotal || '0');
  const platformFee = parseFloat(metadata.platform_fee || '0');
  const hstOnBase = parseFloat(metadata.hst_on_base || '0');
  const hstOnFee = parseFloat(metadata.hst_on_fee || '0');
  const customerTotal = parseFloat(metadata.customer_total || '0');
  const stripeOffset = parseFloat(metadata.stripe_offset || '0');
  const feePercent = parseFloat(metadata.platform_fee_percent || '0');
  const feeFixed = parseFloat(metadata.platform_fee_fixed || '0');
  const passProcessingFee = metadata.pass_processing_fee === 'true';
  const chargeTicketTax = metadata.charge_ticket_tax === 'true';
  const totalTickets = parseInt(metadata.total_tickets || '0', 10);
  const discountAmount = parseFloat(metadata.discount_amount || '0');
  const couponId = metadata.coupon_id || null;
  const couponCode = metadata.coupon_code || '';

  // Seat selections for seat_map mode
  const seatSelections: Array<{ seatId: string; sectionId: string; label: string }> | null =
    metadata.seat_selections ? JSON.parse(metadata.seat_selections) : null;
  const seatSessionId = metadata.seat_session_id || null;

  // Assigned seats for assigned_seating mode
  const assignedSeats: string[] | null =
    metadata.assigned_seats ? JSON.parse(metadata.assigned_seats) : null;

  // Determine user_id for order/tickets
  const userId = userAuth0Id || null;

  // Parse new metadata fields
  const isPlatformEvent = metadata.is_platform_event === 'true';
  const organizerStripeId = metadata.organizer_stripe_id || '';

  try {
    // Parse multi-split data from metadata
    const hasMultiSplit = !!(metadata.transfer_group && metadata.splits);
    let parsedSplits: Array<{
      recipient_user_id: string;
      recipient_stripe_id: string;
      percentage: number;
      description: string;
    }> | null = null;
    if (hasMultiSplit) {
      try {
        parsedSplits = JSON.parse(metadata.splits);
      } catch (parseError) {
        console.error('[Webhook] Failed to parse splits metadata:', parseError);
      }
    }
    // ── Retrieve charge details early (Stripe fee + receipt URL) ──
    let stripeFee = 0;
    let receiptUrl: string | undefined;

    if (session.payment_intent) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(
          session.payment_intent,
          { expand: ['latest_charge.balance_transaction'] }
        );
        const charge = paymentIntent.latest_charge;
        if (charge && typeof charge === 'object') {
          if (charge.receipt_url) receiptUrl = charge.receipt_url;
          const bt = (charge as any).balance_transaction;
          if (bt && typeof bt === 'object') {
            stripeFee = bt.fee / 100; // cents → dollars
          }
        }
      } catch (err) {
        console.error('[Webhook] Failed to fetch charge details:', err);
      }
    }

    // Fallback: estimate Stripe fee if balance_transaction not yet available
    if (stripeFee === 0 && customerTotal > 0) {
      stripeFee = Math.round((customerTotal * 0.029 + 0.30) * 100) / 100;
      console.log(`[Webhook] Using estimated Stripe fee: $${stripeFee}`);
    }

    // Empiria's margin is fixed at platformFee + hstOnFee (hstOnFee is remitted).
    const empiriaKeep = Math.round((platformFee + hstOnFee) * 100) / 100;

    // Organizer payout.
    let actualOrganizerPayout: number;
    if (passProcessingFee) {
      // Guaranteed: ticket revenue + ticket tax (discount already baked into effBase).
      actualOrganizerPayout = effBase + hstOnBase;
    } else {
      // Absorb: organizer bears platform fee, its HST, and the real Stripe fee.
      actualOrganizerPayout = customerTotal - stripeFee - platformFee - hstOnFee;
    }
    actualOrganizerPayout = Math.max(0, Math.round(actualOrganizerPayout * 100) / 100);

    // Platform take-home (revenue): platformFee, less any actual-vs-estimated Stripe gap in pass mode.
    const stripeGap = passProcessingFee ? Math.max(0, Math.round((stripeFee - stripeOffset) * 100) / 100) : 0;
    const platformTakeHome = Math.max(0, Math.round((platformFee - stripeGap) * 100) / 100);
    const actualTicketTax = Math.round(hstOnBase * 100) / 100; // tax remitted with the ticket sale

    // 1. Create the order (initial payout_breakdown — transfer IDs added after transfers)
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        event_id: eventId,
        stripe_payment_intent_id: session.payment_intent,
        stripe_checkout_session_id: session.id,
        total_amount: customerTotal,
        coupon_id: couponId || null,
        discount_amount: discountAmount,
        platform_fee_amount: platformFee,
        organizer_payout_amount: actualOrganizerPayout,
        processing_fee_amount: 0,
        ticket_tax_amount: actualTicketTax,
        platform_fee_tax_amount: hstOnFee,
        stripe_fee_amount: stripeFee,
        net_platform_revenue: platformTakeHome,
        total_tickets: totalTickets,
        currency: session.currency || 'cad',
        buyer_email: userEmail || null,
        buyer_name: userName || null,
        payout_breakdown: {
          version: 5,
          subtotal,
          eff_base: effBase,
          customer_total: customerTotal,
          pass_processing_fee: passProcessingFee,
          charge_ticket_tax: chargeTicketTax,
          total_tickets: totalTickets,
          platform_fee_fixed_semantics: 'per_ticket',
          platform_fee_percent: feePercent,
          platform_fee_fixed: feeFixed,
          platform_fee: platformFee,
          hst_on_base: hstOnBase,
          hst_on_fee: hstOnFee,
          empiria_keep: empiriaKeep,
          stripe_offset: stripeOffset,
          stripe_fee: stripeFee,
          stripe_gap: stripeGap,
          platform_take_home: platformTakeHome,
          discount_amount: discountAmount,
          coupon_code: couponCode,
          organizer_payout: actualOrganizerPayout,
          transfer_group: metadata.transfer_group || null,
        },
        status: 'completed',
        source_app: metadata.source_app || 'shop',
      })
      .select('id')
      .single();

    if (orderError || !order) {
      console.error('[Webhook] Failed to create order:', orderError);
      throw orderError;
    }

    console.log('[Webhook] Order created:', order.id);

    // ── Create organizer transfer (replaces destination charge behavior) ──
    let organizerTransferId: string | null = null;

    if (!isPlatformEvent && organizerStripeId && actualOrganizerPayout > 0) {
      if (hasMultiSplit && parsedSplits) {
        // Multi-split: transfers handled below (each partner gets their share)
      } else {
        // Single organizer: transfer full net to organizer
        const orgPayoutCents = Math.round(actualOrganizerPayout * 100);
        try {
          const transfer = await stripe.transfers.create({
            amount: orgPayoutCents,
            currency: session.currency || 'cad',
            destination: organizerStripeId,
            transfer_group: metadata.transfer_group,
            metadata: { event_id: eventId, order_id: order.id, type: 'organizer_payout' },
          });
          organizerTransferId = transfer.id;
          console.log(`[Webhook] Organizer transfer created: ${orgPayoutCents} cents to ${organizerStripeId}`);
        } catch (err) {
          console.error('[Webhook] Organizer transfer failed:', err);
        }
      }
    }

    // ── Multi-split transfers ──
    const splitTransferDetails: Array<{
      user_id: string;
      stripe_id: string;
      percentage: number;
      amount: number;
      description: string;
      stripe_transfer_id: string | null;
    }> = [];

    if (hasMultiSplit && parsedSplits) {
      const currency = session.currency || 'cad';
      let totalTransferred = 0;
      const splitBaseCents = Math.round(actualOrganizerPayout * 100);

      for (let i = 0; i < parsedSplits.length; i++) {
        const split = parsedSplits[i];
        let amountCents: number;

        // For the last split, use remainder to avoid rounding drift
        if (i === parsedSplits.length - 1) {
          amountCents = splitBaseCents - totalTransferred;
        } else {
          amountCents = Math.round((splitBaseCents * split.percentage) / 100);
        }

        // Accumulate the INTENDED allocation regardless of transfer success.
        // This keeps the last split's remainder based on intended allocations,
        // so a failed intermediate transfer leaves that recipient unpaid
        // (money stays on the platform) without overpaying the last split.
        totalTransferred += amountCents;

        let transferId: string | null = null;
        if (amountCents > 0) {
          try {
            const transfer = await stripe.transfers.create({
              amount: amountCents,
              currency,
              destination: split.recipient_stripe_id,
              transfer_group: metadata.transfer_group,
              metadata: {
                event_id: eventId,
                order_id: order.id,
                recipient: split.recipient_user_id,
                percentage: String(split.percentage),
              },
            });
            transferId = transfer.id;
            console.log(
              `[Webhook] Transfer created: ${amountCents} cents (${split.percentage}%) to ${split.recipient_stripe_id}`
            );
          } catch (transferError) {
            console.error(
              `[Webhook] Failed to create transfer for ${split.recipient_stripe_id}:`,
              transferError
            );
          }
        }

        splitTransferDetails.push({
          user_id: split.recipient_user_id,
          stripe_id: split.recipient_stripe_id,
          percentage: split.percentage,
          amount: Math.round(actualOrganizerPayout * (split.percentage / 100) * 100) / 100,
          description: split.description,
          stripe_transfer_id: transferId,
        });
      }

      console.log(`[Webhook] Multi-split transfers completed: ${totalTransferred} cents total`);
    }

    // ── Elevsoft revenue share transfer ──
    const elevsoftStripeId = process.env.ELEVSOFT_STRIPE_ACCOUNT_ID;
    const elevsoftPercent = parseFloat(process.env.ELEVSOFT_REVENUE_PERCENT || '0');
    let elevsoftTransferData: { id: string; amount: number } | null = null;

    if (elevsoftStripeId && elevsoftPercent > 0) {
      const elevsoftAmount = Math.max(0, isPlatformEvent ? platformTakeHome : platformTakeHome * (elevsoftPercent / 100));
      const elevsoftCents = Math.round(elevsoftAmount * 100);

      if (elevsoftCents > 0) {
        try {
          const transfer = await stripe.transfers.create({
            amount: elevsoftCents,
            currency: session.currency || 'cad',
            destination: elevsoftStripeId,
            transfer_group: metadata.transfer_group,
            metadata: {
              event_id: eventId,
              order_id: order.id,
              type: isPlatformEvent ? 'platform_event_revenue' : 'elevsoft_revenue_share',
              platform_fee_gross: platformFee.toFixed(2),
              stripe_fee: stripeFee.toFixed(2),
            },
          });
          elevsoftTransferData = { id: transfer.id, amount: elevsoftAmount };
          console.log(`[Webhook] Elevsoft transfer: ${elevsoftCents} cents`);
        } catch (err) {
          console.error('[Webhook] Elevsoft transfer failed:', err);
        }
      }
    }

    // ── Update order with full payout_breakdown including transfer IDs ──
    await supabase
      .from('orders')
      .update({
        elevsoft_amount: elevsoftTransferData?.amount || 0,
        payout_breakdown: {
          version: 5,
          subtotal,
          eff_base: effBase,
          customer_total: customerTotal,
          pass_processing_fee: passProcessingFee,
          charge_ticket_tax: chargeTicketTax,
          total_tickets: totalTickets,
          platform_fee_fixed_semantics: 'per_ticket',
          platform_fee_percent: feePercent,
          platform_fee_fixed: feeFixed,
          platform_fee: platformFee,
          hst_on_base: hstOnBase,
          hst_on_fee: hstOnFee,
          empiria_keep: empiriaKeep,
          stripe_offset: stripeOffset,
          stripe_fee: stripeFee,
          stripe_gap: stripeGap,
          platform_take_home: platformTakeHome,
          discount_amount: discountAmount,
          coupon_code: couponCode,
          organizer_payout: actualOrganizerPayout,
          transfer_group: metadata.transfer_group || null,
          organizer_transfer_id: organizerTransferId,
          splits: splitTransferDetails.length > 0 ? splitTransferDetails : null,
          elevsoft_transfer: elevsoftTransferData ? {
            stripe_transfer_id: elevsoftTransferData.id,
            amount: elevsoftTransferData.amount,
            percent: elevsoftPercent,
          } : null,
        },
      })
      .eq('id', order.id);

    // 2. Fetch event details for confirmation email
    const { data: eventData } = await supabase
      .from('events')
      .select('title, venue_name, city, location_type, meeting_link, cta_label')
      .eq('id', eventId)
      .single();

    // Fetch occurrence dates for email (or first occurrence if no specific one)
    let emailStartDate = '';
    let emailEndDate: string | undefined;
    if (occurrenceId) {
      const { data: occ } = await supabase
        .from('event_occurrences')
        .select('starts_at, ends_at')
        .eq('id', occurrenceId)
        .single();
      if (occ) {
        emailStartDate = occ.starts_at;
        emailEndDate = occ.ends_at;
      }
    } else {
      const { data: firstOcc } = await supabase
        .from('event_occurrences')
        .select('starts_at, ends_at')
        .eq('event_id', eventId)
        .order('starts_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstOcc) {
        emailStartDate = firstOcc.starts_at;
        emailEndDate = firstOcc.ends_at;
      }
    }

    // 3. Create order_items and tickets for each tier selection
    const allTickets: Array<{ id: string; qr_code_secret: string; tierName: string; seatLabel?: string }> = [];

    // Build a queue of seat labels for distributing across tickets
    const seatLabelQueue: string[] = seatSelections
      ? seatSelections.map((s) => s.label)
      : assignedSeats || [];

    for (const selection of tierSelections) {
      // Create order item
      const { error: itemError } = await supabase.from('order_items').insert({
        order_id: order.id,
        tier_id: selection.tierId,
        quantity: selection.quantity,
        unit_price: selection.unitPrice,
        subtotal: selection.unitPrice * selection.quantity,
      });

      if (itemError) {
        console.error('[Webhook] Failed to create order_item:', itemError);
      }

      // Create individual tickets (one per quantity)
      // The DB trigger `handle_new_ticket_purchase` will:
      //   - Validate inventory
      //   - Decrement remaining_quantity on ticket_tiers
      //   - Increment total_tickets_sold on events
      //   - Auto-generate qr_code_secret via default gen_random_uuid()

      // For seat_map / assigned_seating mode, pop seat labels from the queue (ordered to match tiers)
      const labelsForThisTier: string[] = [];
      for (let i = 0; i < selection.quantity && seatLabelQueue.length > 0; i++) {
        labelsForThisTier.push(seatLabelQueue.shift()!);
      }

      // Per-tier staged custom field responses; index resets per tier.
      const stagedForTier = stagedResponses.find((s) => s.tierId === selection.tierId);

      const ticketInserts = Array.from({ length: selection.quantity }, (_, i) => ({
        event_id: eventId,
        tier_id: selection.tierId,
        order_id: order.id,
        user_id: userId,
        attendee_name: userName,
        attendee_email: userEmail,
        status: 'valid' as const,
        occurrence_id: occurrenceId,
        field_responses: stagedForTier?.perTicket?.[i] ?? [],
        ...(labelsForThisTier[i] ? { seat_label: labelsForThisTier[i] } : {}),
      }));

      const { data: tickets, error: ticketError } = await supabase
        .from('tickets')
        .insert(ticketInserts)
        .select('id, qr_code_secret');

      if (ticketError) {
        console.error('[Webhook] Failed to create tickets:', ticketError);
      } else {
        console.log(`[Webhook] Created ${tickets?.length} tickets for tier ${selection.tierName}`);
        if (tickets) {
          for (let ti = 0; ti < tickets.length; ti++) {
            const t = tickets[ti];
            allTickets.push({
              id: t.id,
              qr_code_secret: t.qr_code_secret,
              tierName: selection.tierName,
              seatLabel: labelsForThisTier[ti] || undefined,
            });
          }
        }
      }
    }

    // 3a. Clean up staged custom field responses after tickets are created
    if (staged) {
      await supabase
        .from('checkout_field_responses')
        .delete()
        .eq('stripe_checkout_session_id', session.id);
    }

    // 3b. Clean up seat holds after successful ticket creation
    if (seatSelections && seatSelections.length > 0) {
      const seatIds = seatSelections.map((s) => s.seatId);
      const { error: holdDeleteError } = await supabase
        .from('seat_holds')
        .delete()
        .eq('event_id', eventId)
        .in('seat_id', seatIds);

      if (holdDeleteError) {
        console.error('[Webhook] Failed to clean up seat holds:', holdDeleteError);
      } else {
        console.log(`[Webhook] Cleaned up ${seatIds.length} seat holds`);
      }
    }

    // 3c. Record coupon usage.
    // The usage count (current_uses) was already RESERVED atomically at checkout
    // time via increment_coupon_usage in app/api/checkout/route.ts, so we do NOT
    // increment again here (that would double-count). We only record the per-order
    // usage row for per-user limits / auditing; coupon_id is already on the order.
    if (couponId) {
      try {
        await supabase.from('coupon_usages').insert({
          coupon_id: couponId,
          order_id: order.id,
          user_id: userId,
          discount_amount: discountAmount,
        });
        console.log(`[Webhook] Coupon usage recorded: ${couponCode} (${couponId})`);
      } catch (couponTrackError) {
        console.error('[Webhook] Failed to record coupon usage:', couponTrackError);
      }
    }

    // 4. Send confirmation email (non-blocking — failures must not break the webhook)
    if (userEmail && eventData && allTickets.length > 0) {
      try {
        await sendOrderConfirmationEmail({
          to: userEmail,
          attendeeName: userName,
          orderId: order.id,
          eventTitle: eventData.title,
          eventDate: emailStartDate,
          eventEndDate: emailEndDate,
          venueName: eventData.venue_name || '',
          city: eventData.city || '',
          meetingLink: eventData.meeting_link || '',
          locationType: eventData.location_type || 'physical',
          ctaLabel: eventData.cta_label,
          lineItems: tierSelections.map((s) => ({
            tierName: s.tierName,
            quantity: s.quantity,
            unitPrice: s.unitPrice,
          })),
          total: customerTotal,
          convenienceFee: passProcessingFee ? platformFee : 0,
          convenienceFeeHST: passProcessingFee ? hstOnFee : 0,
          ticketTax: actualTicketTax,
          discountAmount,
          couponCode,
          currency: session.currency || 'cad',
          tickets: allTickets,
          receiptUrl,
        });
        console.log('[Webhook] Confirmation email sent to:', userEmail);
      } catch (emailError) {
        console.error('[Webhook] Failed to send confirmation email:', emailError);
      }
    }

    // 5. Guest purchase → invite them to finish signup (Auth0 set-password email).
    // Guest = no authenticated buyer (metadata.user_auth0_id was empty → userId null).
    // Fire-and-forget: inviteGuestToFinishSignup never throws, so this cannot
    // affect webhook success; it runs after all response-critical work.
    if (!userId && userEmail) {
      await inviteGuestToFinishSignup({ email: userEmail, name: userName });
    }

    console.log('[Webhook] Checkout fully processed for session:', session.id);
  } catch (error) {
    console.error('[Webhook] Critical error processing checkout:', error);
  }
}

// ──────────────────────────────────────────────────
// REFUNDS & DISPUTES
//
// Money is pushed out to organizers / co-organizers / Elevsoft via
// stripe.transfers.create on the platform charge. A refund or dispute on the
// platform charge does NOT automatically claw those transfers back, so we must
// reverse them explicitly with stripe.transfers.createReversal.
//
// IDEMPOTENCY (Stripe retries webhooks): we persist reversal bookkeeping inside
// orders.payout_breakdown — a cumulative `refunded_amount`, a set of processed
// `refund_ids`, and a per-reversal Stripe idempotencyKey on createReversal. We
// only reverse the *newly* refunded delta and skip refunds/disputes already
// recorded, so a transfer is never reversed twice.
// ──────────────────────────────────────────────────

// Collect every outbound transfer id recorded on the order's payout_breakdown.
function collectOutboundTransfers(
  pb: any
): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  if (pb?.organizer_transfer_id) {
    out.push({ id: pb.organizer_transfer_id, label: 'organizer' });
  }
  if (Array.isArray(pb?.splits)) {
    for (const s of pb.splits) {
      if (s?.stripe_transfer_id) {
        out.push({ id: s.stripe_transfer_id, label: `split_${s.user_id || s.stripe_id || ''}` });
      }
    }
  }
  if (pb?.elevsoft_transfer?.stripe_transfer_id) {
    out.push({ id: pb.elevsoft_transfer.stripe_transfer_id, label: 'elevsoft' });
  }
  return out;
}

async function handleChargeRefunded(charge: any) {
  const supabase = getSupabaseAdmin();
  const paymentIntentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;

  if (!paymentIntentId) {
    console.warn('[Webhook] charge.refunded with no payment_intent — acking');
    return;
  }

  // Look up the order by payment intent.
  const { data: order } = await supabase
    .from('orders')
    .select('id, status, payout_breakdown, total_amount')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  if (!order) {
    console.log('[Webhook] charge.refunded: no order for PI', paymentIntentId, '— acking');
    return;
  }

  const pb: any = order.payout_breakdown || {};

  // Stripe amounts are in cents. amount_refunded is CUMULATIVE on the charge.
  const chargeAmountCents: number = charge.amount || 0;
  const cumulativeRefundedCents: number = charge.amount_refunded || 0;
  const alreadyReversedCents: number = Math.round((pb.refunded_amount || 0) * 100);

  // Newly refunded delta we have not yet processed.
  const newlyRefundedCents = Math.max(0, cumulativeRefundedCents - alreadyReversedCents);

  if (newlyRefundedCents <= 0 || chargeAmountCents <= 0) {
    console.log('[Webhook] charge.refunded: nothing new to reverse for order', order.id);
    return;
  }

  // Proportion of the ORIGINAL charge represented by this new refund delta.
  const proportion = newlyRefundedCents / chargeAmountCents;

  // Identify a stable id for idempotency keys (latest refund id if available).
  const refundList = charge.refunds?.data;
  const latestRefundId: string =
    (Array.isArray(refundList) && refundList.length > 0 && refundList[0]?.id) ||
    charge.id;

  const processedRefundIds: string[] = Array.isArray(pb.refund_ids) ? pb.refund_ids : [];

  // Reverse each outbound transfer proportionally to the new refund delta.
  // Per-transfer original amount comes from payout_breakdown: organizer_payout
  // for the organizer transfer, split.amount for each split, elevsoft amount for
  // Elevsoft. We reverse that share × proportion; createReversal caps at the
  // transfer's remaining reversible balance.
  const transfers = collectOutboundTransfers(pb);
  for (const t of transfers) {
    let originalCents = 0;
    if (t.label === 'organizer') {
      originalCents = Math.round((pb.organizer_payout || 0) * 100);
    } else if (t.label === 'elevsoft') {
      originalCents = Math.round((pb.elevsoft_transfer?.amount || 0) * 100);
    } else if (Array.isArray(pb.splits)) {
      const match = pb.splits.find(
        (s: any) => s.stripe_transfer_id === t.id
      );
      originalCents = Math.round(((match?.amount) || 0) * 100);
    }
    const amountToReverse = Math.round(originalCents * proportion);
    if (amountToReverse <= 0) continue;
    try {
      await stripe.transfers.createReversal(
        t.id,
        { amount: amountToReverse },
        { idempotencyKey: `rev_${latestRefundId}_${t.id}` }
      );
      console.log(`[Webhook] Reversed ${amountToReverse} cents on transfer ${t.id} (${t.label})`);
    } catch (err) {
      console.error(`[Webhook] Failed to reverse transfer ${t.id} (${t.label}):`, err);
    }
  }

  const fullyRefunded = cumulativeRefundedCents >= chargeAmountCents;

  // Persist reversal bookkeeping (cumulative refunded + processed refund ids).
  const updatedPb = {
    ...pb,
    refunded_amount: Math.round(cumulativeRefundedCents) / 100,
    refund_ids: Array.isArray(refundList)
      ? Array.from(new Set([...processedRefundIds, ...refundList.map((r: any) => r.id)]))
      : Array.from(new Set([...processedRefundIds, latestRefundId])),
  };

  if (fullyRefunded) {
    // Mark order refunded, refund its tickets, and restore inventory.
    await supabase
      .from('orders')
      .update({ status: 'refunded', payout_breakdown: updatedPb })
      .eq('id', order.id);

    // Refund only currently-valid tickets, mirroring the admin void path's
    // pattern of restoring inventory for the rows we actually transition.
    const { data: tix } = await supabase
      .from('tickets')
      .select('id, tier_id, event_id, status')
      .eq('order_id', order.id);
    const refundable = (tix ?? []).filter((t: any) => t.status === 'valid');
    const ids = refundable.map((t: any) => t.id);
    if (ids.length > 0) {
      await supabase.from('tickets').update({ status: 'refunded' }).in('id', ids);
    }

    // Restore inventory via atomic RPCs (inventory trigger is INSERT-only).
    const byTier = new Map<string, number>();
    const byEvent = new Map<string, number>();
    for (const t of refundable) {
      byTier.set(t.tier_id, (byTier.get(t.tier_id) ?? 0) + 1);
      byEvent.set(t.event_id, (byEvent.get(t.event_id) ?? 0) + 1);
    }
    for (const [tierId, n] of byTier) {
      await supabase.rpc('admin_restore_tier_inventory', { p_tier_id: tierId, p_n: n });
    }
    for (const [eventId, n] of byEvent) {
      await supabase.rpc('admin_decrement_event_sold', { p_event_id: eventId, p_n: n });
    }
    console.log(`[Webhook] Order ${order.id} fully refunded; ${ids.length} tickets refunded, inventory restored`);
  } else {
    // Partial refund: reverse transfers proportionally but leave tickets/inventory.
    await supabase
      .from('orders')
      .update({ payout_breakdown: updatedPb })
      .eq('id', order.id);
    console.log(`[Webhook] Order ${order.id} partially refunded (${newlyRefundedCents} cents new); transfers reversed proportionally`);
  }
}

async function handleDisputeCreated(dispute: any) {
  const supabase = getSupabaseAdmin();
  const paymentIntentId =
    typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id;

  if (!paymentIntentId) {
    console.warn('[Webhook] charge.dispute.created with no payment_intent — acking');
    return;
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id, status, payout_breakdown')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  if (!order) {
    console.log('[Webhook] charge.dispute.created: no order for PI', paymentIntentId, '— acking');
    return;
  }

  const pb: any = order.payout_breakdown || {};

  // Idempotency: skip if this dispute was already handled.
  if (pb.dispute_id === dispute.id) {
    console.log('[Webhook] Dispute', dispute.id, 'already handled for order', order.id);
    return;
  }

  // Reverse ALL outbound transfers in full — the platform is now debited the
  // disputed amount and connected accounts must not keep those funds.
  const transfers = collectOutboundTransfers(pb);
  for (const t of transfers) {
    try {
      // No amount → reverses the full remaining transfer balance.
      await stripe.transfers.createReversal(
        t.id,
        {},
        { idempotencyKey: `disp_${dispute.id}_${t.id}` }
      );
      console.log(`[Webhook] Dispute ${dispute.id}: fully reversed transfer ${t.id} (${t.label})`);
    } catch (err) {
      console.error(`[Webhook] Dispute reversal failed for transfer ${t.id} (${t.label}):`, err);
    }
  }

  // Record the dispute on the order. Do NOT change order status — there is no
  // 'disputed' enum value; we only annotate payout_breakdown.
  // NOTE: charge.dispute.closed (if won, re-transfer funds to recipients) is a
  // follow-up not handled here.
  const updatedPb = {
    ...pb,
    dispute_id: dispute.id,
    dispute: {
      id: dispute.id,
      status: dispute.status,
      amount: (dispute.amount || 0) / 100,
    },
  };
  await supabase
    .from('orders')
    .update({ payout_breakdown: updatedPb })
    .eq('id', order.id);
  console.log(`[Webhook] Dispute ${dispute.id} recorded for order ${order.id}; all transfers reversed`);
}

async function handleDisputeClosed(dispute: any) {
  const supabase = getSupabaseAdmin();
  const paymentIntentId =
    typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id;

  if (!paymentIntentId) {
    console.warn('[Webhook] charge.dispute.closed with no payment_intent — acking');
    return;
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id, status, payout_breakdown, currency')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  if (!order) {
    console.log('[Webhook] charge.dispute.closed: no order for PI', paymentIntentId, '— acking');
    return;
  }

  const pb: any = order.payout_breakdown || {};

  // Idempotency: skip if this dispute's CLOSED outcome was already processed.
  // (dispute.created records dispute_id; we key the closed-handling on a separate
  // flag so the closed event still runs once even though created already ran.)
  if (pb.dispute_closed_status && pb.dispute_id === dispute.id) {
    console.log('[Webhook] Dispute', dispute.id, 'closed-outcome already processed for order', order.id);
    return;
  }

  const currency = order.currency || 'cad';

  // Only a WON dispute returns the funds to the platform; in that case we re-push
  // each previously-reversed share back to its connected account using the ORIGINAL
  // amounts recorded in payout_breakdown. Any non-won closed status (lost/warning_*)
  // means the reversal stands — we just record the outcome.
  if (dispute.status === 'won') {
    // Re-transfer organizer payout.
    const reTransfers: {
      organizer_transfer_id?: string | null;
      splits?: Array<{ user_id?: string; stripe_id?: string; amount: number; stripe_transfer_id: string | null }>;
      elevsoft_transfer_id?: string | null;
    } = {};

    // Single-organizer payout (only present when there were no splits).
    if (pb.organizer_transfer_id && pb.organizer_payout > 0) {
      const destination = await resolveOrganizerStripeId(supabase, order.id, pb);
      reTransfers.organizer_transfer_id = await redoTransfer({
        amount: pb.organizer_payout,
        currency,
        destination,
        disputeId: dispute.id,
        orderId: order.id,
        type: 'organizer_payout_redo',
      });
    }

    // Multi-split shares.
    if (Array.isArray(pb.splits) && pb.splits.length > 0) {
      reTransfers.splits = [];
      for (const s of pb.splits) {
        const destination = s?.stripe_id || null;
        const amount = Number(s?.amount || 0);
        const newId = await redoTransfer({
          amount,
          currency,
          destination,
          disputeId: dispute.id,
          orderId: order.id,
          type: 'split_redo',
        });
        reTransfers.splits.push({
          user_id: s?.user_id,
          stripe_id: s?.stripe_id,
          amount,
          stripe_transfer_id: newId ?? s?.stripe_transfer_id ?? null,
        });
      }
    }

    // Elevsoft share.
    if (pb.elevsoft_transfer?.stripe_transfer_id) {
      reTransfers.elevsoft_transfer_id = await redoTransfer({
        amount: Number(pb.elevsoft_transfer?.amount || 0),
        currency,
        destination: process.env.ELEVSOFT_STRIPE_ACCOUNT_ID || null,
        disputeId: dispute.id,
        orderId: order.id,
        type: 'elevsoft_redo',
      });
    }

    const updatedPb = {
      ...pb,
      dispute_closed_status: 'won',
      dispute: {
        ...(pb.dispute || {}),
        id: dispute.id,
        status: dispute.status,
      },
      dispute_redo_transfers: reTransfers,
    };
    await supabase
      .from('orders')
      .update({ payout_breakdown: updatedPb })
      .eq('id', order.id);
    console.log(`[Webhook] Dispute ${dispute.id} WON for order ${order.id}; reversed transfers re-pushed`);
  } else {
    // Lost (or any other closed status) — the reversal stands; just record it.
    const updatedPb = {
      ...pb,
      dispute_closed_status: dispute.status,
      dispute: {
        ...(pb.dispute || {}),
        id: dispute.id,
        status: dispute.status,
      },
    };
    await supabase
      .from('orders')
      .update({ payout_breakdown: updatedPb })
      .eq('id', order.id);
    console.log(`[Webhook] Dispute ${dispute.id} closed (${dispute.status}) for order ${order.id}; reversal stands`);
  }
}

// Recreate an outbound transfer to a connected account after a won dispute
// returned the funds to the platform. Guards on missing destination / amount.
// Idempotency key `redo_<disputeId>_<recipientStripeId>` makes Stripe dedupe
// retried events so a recipient is never paid twice for the same won dispute.
async function redoTransfer(opts: {
  amount: number;
  currency: string;
  destination: string | null;
  disputeId: string;
  orderId: string;
  type: string;
}): Promise<string | null> {
  const { amount, currency, destination, disputeId, orderId, type } = opts;
  if (!destination || !(amount > 0)) {
    console.log(`[Webhook] Dispute ${disputeId}: skip re-transfer (${type}) — missing destination or amount`);
    return null;
  }
  const amountCents = Math.round(amount * 100);
  if (amountCents <= 0) return null;
  try {
    const transfer = await stripe.transfers.create(
      {
        amount: amountCents,
        currency,
        destination,
        metadata: { order_id: orderId, dispute_id: disputeId, type },
      },
      { idempotencyKey: `redo_${disputeId}_${destination}` }
    );
    console.log(`[Webhook] Dispute ${disputeId}: re-transferred ${amountCents} cents to ${destination} (${type})`);
    return transfer.id;
  } catch (err) {
    console.error(`[Webhook] Dispute ${disputeId}: re-transfer failed for ${destination} (${type}):`, err);
    return null;
  }
}

// Resolve the connected account that received the single-organizer payout.
// The original transfer recorded its destination, so read it back from Stripe.
async function resolveOrganizerStripeId(
  _supabase: ReturnType<typeof getSupabaseAdmin>,
  _orderId: string,
  pb: any
): Promise<string | null> {
  try {
    if (pb.organizer_transfer_id) {
      const t = await stripe.transfers.retrieve(pb.organizer_transfer_id);
      const dest = (t as any).destination;
      return typeof dest === 'string' ? dest : dest?.id ?? null;
    }
  } catch (err) {
    console.error('[Webhook] Could not resolve organizer stripe id from original transfer:', err);
  }
  return null;
}

// ──────────────────────────────────────────────────
// COUPON RESERVATION RELEASE
//
// Coupon usage is RESERVED atomically at checkout time (increment_coupon_usage in
// app/api/checkout/route.ts). If the checkout is abandoned (session expires) or the
// payment fails, we must release that reservation via decrement_coupon_usage so the
// slot is freed for someone else.
//
// IDEMPOTENCY: Stripe may retry these events. `checkout.session.expired` fires once
// per session, and a given PaymentIntent only emits payment_failed for genuine
// failures, but to avoid a double-decrement on a retried event we guard on the order:
// if an order already exists for this PI (i.e. checkout actually completed), the
// reservation was consumed by a real sale and must NOT be released.
// ──────────────────────────────────────────────────
async function releaseCouponReservation(
  metadata: Record<string, string> | null | undefined,
  piId: string | null,
  context: string
) {
  const couponId = metadata?.coupon_id;
  if (!couponId) return;

  const supabase = getSupabaseAdmin();

  // Guard: if a completed order exists for this payment, the reservation was
  // consumed by a real sale — do NOT release it.
  if (piId) {
    const { data: existingOrder } = await supabase
      .from('orders')
      .select('id')
      .eq('stripe_payment_intent_id', piId)
      .maybeSingle();
    if (existingOrder) {
      console.log(`[Webhook] ${context}: order exists for PI ${piId} — keeping coupon reservation`);
      return;
    }
  }

  const { error } = await supabase.rpc('decrement_coupon_usage', { p_coupon_id: couponId });
  if (error) {
    console.error(`[Webhook] ${context}: decrement_coupon_usage failed:`, error);
  } else {
    console.log(`[Webhook] ${context}: released coupon reservation ${couponId}`);
  }
}
