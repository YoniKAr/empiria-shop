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
import { sendOrderConfirmationEmail, sendSaleNotificationEmail } from '@/lib/email';
import { sendEmail } from '@/lib/mailer';

// Vercel: webhook fulfillment (order + tickets + transfers + email) can exceed
// the default function duration — give it headroom so a slow Stripe/DB call
// can't kill the function mid-transfer. Node runtime is required (stripe SDK,
// nodemailer/SES).
export const runtime = 'nodejs';
export const maxDuration = 60;

const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL || 'info@empiria.events';

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

  // Handle the event.
  // A throw from any handler falls through to the catch below → HTTP 500 →
  // Stripe RETRIES the event. Handlers are idempotent (existing-order guard,
  // refund bookkeeping, dispute flags), so retries are safe. Returning 200 on
  // a processing failure would mean the customer was charged but nothing was
  // created — and Stripe would never retry.
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutCompleted(session);
        break;
      }
      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        console.warn('[Webhook] Payment failed:', paymentIntent.id);
        // Do NOT release the coupon reservation here: a declined card is
        // retryable within the same Checkout Session, and releasing on the
        // first failed ATTEMPT lets another buyer take the slot while this
        // customer retries (over-redemption). The reservation is released by
        // `checkout.session.expired` below when the session is truly abandoned.
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
        // Drop staged rows for the abandoned session (checkout payload + custom
        // field responses) — they are only consumed by successful fulfillment.
        {
          const supabaseExpired = getSupabaseAdmin();
          await supabaseExpired
            .from('checkout_payloads')
            .delete()
            .eq('stripe_checkout_session_id', session.id);
          await supabaseExpired
            .from('checkout_field_responses')
            .delete()
            .eq('stripe_checkout_session_id', session.id);
        }
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object;
        await handleChargeRefunded(charge, event.id);
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
      case 'charge.updated': {
        // True-up the Stripe fee bookkeeping when the balance_transaction
        // becomes available (we may have ESTIMATED the fee at fulfillment time).
        const charge = event.data.object;
        await handleChargeUpdated(charge);
        break;
      }
      case 'refund.created': {
        // Record the REAL refund id on the order (charge.refunded's embedded
        // refund list is not always populated).
        const refund = event.data.object;
        await handleRefundCreated(refund);
        break;
      }
      case 'refund.failed': {
        // The customer was NOT refunded even though we already reversed
        // transfers — flag the order and alert admins for manual action.
        const refund = event.data.object;
        await handleRefundFailed(refund);
        break;
      }
      default:
        // Unhandled event type — that's fine
        break;
    }
  } catch (error) {
    console.error(`[Webhook] Handler failed for ${event.type} (${event.id}):`, error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: any) {
  const supabase = getSupabaseAdmin();
  const metadata = session.metadata;

  // ── Async payment safety net ──
  // With async payment methods, checkout.session.completed can fire while
  // payment_status is still 'unpaid' (funds arrive later, signalled by
  // checkout.session.async_payment_succeeded). We don't enable async methods
  // today, but if one ever slips through we must NOT fulfill an unpaid session.
  if (session.payment_status === 'unpaid') {
    console.warn(
      `[Webhook] checkout.session.completed with payment_status='unpaid' for session ${session.id} — NOT fulfilling (awaiting async payment)`
    );
    return;
  }

  // Sessions created after the metadata-size fix set payload_staged='true' and
  // stage the large arrays (tier/seat/split data) in the checkout_payloads
  // table (Stripe metadata caps values at 500 chars and REJECTS larger ones);
  // older in-flight sessions still carry tier_selections inline in metadata.
  const payloadStaged = metadata?.payload_staged === 'true';
  if (!metadata?.event_id || (!payloadStaged && !metadata?.tier_selections)) {
    console.error('[Webhook] Missing metadata on checkout session:', session.id);
    return;
  }

  // Check if order already exists (idempotency).
  // If the order exists AND has tickets, this is a pure retry — ack and stop.
  // If the order exists with ZERO tickets, a previous attempt crashed between
  // creating the order and creating the tickets (ticket/order_item insert
  // failures now THROW → 500 → Stripe retries) — RESUME fulfillment for the
  // existing order instead of stranding a charged customer with no tickets.
  let resumeOrderId: string | null = null;
  const { data: existingOrder } = await supabase
    .from('orders')
    .select('id')
    .eq('stripe_checkout_session_id', session.id)
    .maybeSingle();

  if (existingOrder) {
    const { count: existingTicketCount } = await supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', existingOrder.id);

    if ((existingTicketCount ?? 0) > 0) {
      console.log('[Webhook] Order already exists for session:', session.id);
      return;
    }

    console.warn(
      `[Webhook] Order ${existingOrder.id} exists with ZERO tickets for session ${session.id} — resuming fulfillment`
    );
    resumeOrderId = existingOrder.id;
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

  // Load the staged checkout payload when the session flags it. The row is
  // LOAD-BEARING for these sessions — if it can't be loaded we THROW so the
  // POST returns 500 and Stripe retries the event (transient DB failure) —
  // and it is deleted once fulfillment creates the tickets (or on
  // checkout.session.expired).
  let stagedPayload: {
    tier_selections?: Array<{ tierId: string; quantity: number; unitPrice: number; tierName: string }>;
    seat_selections?: Array<{ seatId: string; sectionId: string; label: string }> | null;
    assigned_seats?: string[] | null;
    splits?: Array<{
      recipient_user_id: string;
      recipient_stripe_id: string;
      percentage: number;
      description: string;
    }> | null;
  } | null = null;
  if (payloadStaged) {
    const { data: payloadRow, error: payloadError } = await supabase
      .from('checkout_payloads')
      .select('payload')
      .eq('stripe_checkout_session_id', session.id)
      .maybeSingle();
    if (payloadError || !payloadRow?.payload || !Array.isArray(payloadRow.payload.tier_selections)) {
      throw new Error(
        `[Webhook] Staged checkout payload missing/invalid for session ${session.id}: ${payloadError?.message ?? 'no row'}`
      );
    }
    stagedPayload = payloadRow.payload;
  }

  const eventId = metadata.event_id;
  const userAuth0Id = metadata.user_auth0_id || null;
  const userEmail = metadata.user_email || session.customer_email || '';
  const userName = metadata.user_name || '';
  const occurrenceId = metadata.occurrence_id || null;
  const tierSelections = (
    stagedPayload ? stagedPayload.tier_selections! : JSON.parse(metadata.tier_selections)
  ) as Array<{
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

  // Seat selections for seat_map mode (staged payload, or legacy metadata)
  const seatSelections: Array<{ seatId: string; sectionId: string; label: string }> | null =
    stagedPayload
      ? stagedPayload.seat_selections ?? null
      : metadata.seat_selections
        ? JSON.parse(metadata.seat_selections)
        : null;
  const seatSessionId = metadata.seat_session_id || null;

  // Assigned seats for assigned_seating mode (staged payload, or legacy metadata)
  const assignedSeats: string[] | null =
    stagedPayload
      ? stagedPayload.assigned_seats ?? null
      : metadata.assigned_seats
        ? JSON.parse(metadata.assigned_seats)
        : null;

  // Determine user_id for order/tickets
  const userId = userAuth0Id || null;

  // Parse new metadata fields
  const isPlatformEvent = metadata.is_platform_event === 'true';
  const organizerStripeId = metadata.organizer_stripe_id || '';

  try {
    // Multi-split data: from the staged payload, or legacy inline metadata.
    let parsedSplits: Array<{
      recipient_user_id: string;
      recipient_stripe_id: string;
      percentage: number;
      description: string;
    }> | null = null;
    if (stagedPayload) {
      parsedSplits = stagedPayload.splits ?? null;
    } else if (metadata.splits) {
      try {
        parsedSplits = JSON.parse(metadata.splits);
      } catch (parseError) {
        console.error('[Webhook] Failed to parse splits metadata:', parseError);
      }
    }
    const hasMultiSplit = !!(metadata.transfer_group && parsedSplits && parsedSplits.length > 0);
    // ── Retrieve charge details early (Stripe fee + receipt URL + charge id) ──
    // The charge id is reused as `source_transaction` on every outbound
    // transfer below, tying transfers to this charge's settlement (required
    // for live mode where the platform balance may not cover instant payouts).
    let stripeFee = 0;
    let receiptUrl: string | undefined;
    let chargeId: string | null = null;

    if (session.payment_intent) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(
          session.payment_intent,
          { expand: ['latest_charge.balance_transaction'] }
        );
        const charge = paymentIntent.latest_charge;
        if (charge && typeof charge === 'object') {
          chargeId = charge.id;
          if (charge.receipt_url) receiptUrl = charge.receipt_url;
          const bt = (charge as any).balance_transaction;
          if (bt && typeof bt === 'object') {
            stripeFee = bt.fee / 100; // cents → dollars
          }
        } else if (typeof charge === 'string') {
          chargeId = charge;
        }
      } catch (err) {
        console.error('[Webhook] Failed to fetch charge details:', err);
      }
    }

    // Fallback: estimate Stripe fee if balance_transaction not yet available.
    // When we estimate, flag it in payout_breakdown so the `charge.updated`
    // handler can true-up the books once the real balance_transaction lands.
    let stripeFeeEstimated = false;
    if (stripeFee === 0 && customerTotal > 0) {
      stripeFee = Math.round((customerTotal * 0.029 + 0.30) * 100) / 100;
      stripeFeeEstimated = true;
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
    let platformTakeHome = Math.max(0, Math.round((platformFee - stripeGap) * 100) / 100);
    if (!passProcessingFee) {
      // ABSORB-mode conservation clamp: when the organizer payout floors at 0
      // (sub-fee tickets), the full platformFee can exceed what the charge
      // actually nets. Cap take-home at what truly remains after the Stripe
      // fee, the (floored) organizer payout, and the HST we must remit — so
      // downstream outflows (Elevsoft % of take-home) can never exceed the
      // charge net. When the payout did NOT floor, the residual equals
      // platformFee exactly and this is a no-op. (Pass mode is unchanged —
      // its stripeGap logic already conserves.)
      const absorbResidual =
        Math.round((customerTotal - stripeFee - actualOrganizerPayout - hstOnFee) * 100) / 100;
      platformTakeHome = Math.max(0, Math.min(platformTakeHome, absorbResidual));
    }
    const actualTicketTax = Math.round(hstOnBase * 100) / 100; // tax remitted with the ticket sale

    // Platform-owned events pay no real organizer payout — record 0 on the
    // order so admin KPIs don't overstate payouts (Fix: the notional value is
    // kept in payout_breakdown.platform_event_notional_payout for traceability).
    const orderOrganizerPayout = isPlatformEvent ? 0 : actualOrganizerPayout;

    // Shared payout_breakdown core — used for the initial insert, the
    // pre-transfer intent persist, and the final post-transfer update so the
    // three writes can never drift apart.
    const basePayoutBreakdown = {
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
      ...(stripeFeeEstimated ? { stripe_fee_estimated: true } : {}),
      discount_amount: discountAmount,
      coupon_code: couponCode,
      organizer_payout: orderOrganizerPayout,
      ...(isPlatformEvent ? { platform_event_notional_payout: actualOrganizerPayout } : {}),
      transfer_group: metadata.transfer_group || null,
    };

    // 1. Create the order (initial payout_breakdown — transfer IDs added after
    //    transfers). When RESUMING a ticketless order from a failed prior
    //    attempt, the order row already exists — reuse it.
    let order: { id: string };
    if (resumeOrderId) {
      order = { id: resumeOrderId };
      console.log('[Webhook] Reusing existing order:', order.id);
    } else {
    const { data: newOrder, error: orderError } = await supabase
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
        organizer_payout_amount: orderOrganizerPayout,
        processing_fee_amount: stripeOffset,
        ticket_tax_amount: actualTicketTax,
        platform_fee_tax_amount: hstOnFee,
        stripe_fee_amount: stripeFee,
        net_platform_revenue: platformTakeHome,
        total_tickets: totalTickets,
        currency: session.currency || 'cad',
        buyer_email: userEmail || null,
        buyer_name: userName || null,
        payout_breakdown: basePayoutBreakdown,
        status: 'completed',
        source_app: metadata.source_app || 'shop',
      })
      .select('id')
      .single();

    if (orderError || !newOrder) {
      console.error('[Webhook] Failed to create order:', orderError);
      throw orderError ?? new Error('Order insert returned no row');
    }
    order = newOrder;

    console.log('[Webhook] Order created:', order.id);
    }

    // ⚠️ FULFILLMENT ORDER (crash-safety): order → TICKETS (+order_items) →
    // transfers LAST → final order update. A crash after tickets loses only
    // transfers, which are reconcilable via the null transfer ids persisted in
    // payout_breakdown; the customer always gets their tickets first. (Stripe
    // transfers below also carry idempotencyKeys keyed on order.id so a retry
    // can never double-pay.)

    // 2. Fetch event details for confirmation email
    const { data: eventData } = await supabase
      .from('events')
      .select('title, venue_name, city, location_type, meeting_link, cta_label, organizer_id, source_app, notify_on_sale')
      .eq('id', eventId)
      .single();

    // Resolve the organizer's display name + avatar (same convention as the
    // event page): platform-owned (owner role 'admin') → "Empiria Events" + the
    // shared platform avatar; an event owned by a real organizer (incl. ones an
    // admin created on their behalf) → that organizer's name + profile photo.
    let organizerName = 'Empiria Events';
    let organizerAvatarUrl: string | null = null;
    if (eventData?.organizer_id) {
      const { data: ownerProfile } = await supabase
        .from('users')
        .select('full_name, role, avatar_url')
        .eq('auth0_id', eventData.organizer_id)
        .single();
      if (ownerProfile?.role === 'admin') {
        const { data: platformSetting } = await supabase
          .from('platform_settings')
          .select('value')
          .eq('key', 'platform_avatar_url')
          .maybeSingle();
        organizerAvatarUrl = (platformSetting?.value as { url?: string | null } | null)?.url || null;
      } else {
        organizerName = ownerProfile?.full_name || 'Empiria Events';
        organizerAvatarUrl = ownerProfile?.avatar_url || null;
      }
    }

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

    // 3. Create order_items and tickets for ALL tier selections.
    // Both inserts are SINGLE batched statements: a failure leaves ZERO rows
    // (statement-level atomicity), and any insert error THROWS → the POST
    // returns 500 → Stripe retries → the zero-ticket resume path above
    // re-runs fulfillment. (Previously errors were console.error'd and the
    // webhook returned 200: customer charged, no tickets, no retry.)
    const allTickets: Array<{ id: string; qr_code_secret: string; tierName: string; seatLabel?: string }> = [];

    // Build a queue of seat labels for distributing across tickets
    const seatLabelQueue: string[] = seatSelections
      ? seatSelections.map((s) => s.label)
      : assignedSeats || [];

    // When resuming, clear order_items from the failed prior attempt so the
    // batched re-insert below cannot duplicate line items.
    if (resumeOrderId) {
      const { error: staleItemsError } = await supabase
        .from('order_items')
        .delete()
        .eq('order_id', order.id);
      if (staleItemsError) {
        console.error('[Webhook] Failed to clear stale order_items on resume:', staleItemsError);
        throw staleItemsError;
      }
    }

    const orderItemInserts = tierSelections.map((selection) => ({
      order_id: order.id,
      tier_id: selection.tierId,
      quantity: selection.quantity,
      unit_price: selection.unitPrice,
      subtotal: selection.unitPrice * selection.quantity,
    }));

    const { error: itemError } = await supabase.from('order_items').insert(orderItemInserts);
    if (itemError) {
      console.error('[Webhook] Failed to create order_items:', itemError);
      throw itemError;
    }

    // Create individual tickets (one per quantity, all tiers in one statement)
    // The DB trigger `handle_new_ticket_purchase` will:
    //   - Validate inventory
    //   - Decrement remaining_quantity on ticket_tiers
    //   - Increment total_tickets_sold on events
    //   - Auto-generate qr_code_secret via default gen_random_uuid()
    const ticketInserts: Array<Record<string, unknown>> = [];
    const ticketMeta: Array<{ tierName: string; seatLabel?: string }> = [];

    for (const selection of tierSelections) {
      // For seat_map / assigned_seating mode, pop seat labels from the queue (ordered to match tiers)
      const labelsForThisTier: string[] = [];
      for (let i = 0; i < selection.quantity && seatLabelQueue.length > 0; i++) {
        labelsForThisTier.push(seatLabelQueue.shift()!);
      }

      // Per-tier staged custom field responses; index resets per tier.
      const stagedForTier = stagedResponses.find((s) => s.tierId === selection.tierId);

      for (let i = 0; i < selection.quantity; i++) {
        ticketInserts.push({
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
        });
        ticketMeta.push({
          tierName: selection.tierName,
          seatLabel: labelsForThisTier[i] || undefined,
        });
      }
    }

    const { data: tickets, error: ticketError } = await supabase
      .from('tickets')
      .insert(ticketInserts)
      .select('id, qr_code_secret');

    if (ticketError || !tickets) {
      console.error('[Webhook] Failed to create tickets:', ticketError);
      throw ticketError ?? new Error('Ticket insert returned no rows');
    }

    console.log(`[Webhook] Created ${tickets.length} tickets for order ${order.id}`);
    for (let ti = 0; ti < tickets.length; ti++) {
      const t = tickets[ti];
      allTickets.push({
        id: t.id,
        qr_code_secret: t.qr_code_secret,
        tierName: ticketMeta[ti]?.tierName ?? '',
        seatLabel: ticketMeta[ti]?.seatLabel,
      });
    }

    // 3a. Clean up staged custom field responses after tickets are created
    if (staged) {
      await supabase
        .from('checkout_field_responses')
        .delete()
        .eq('stripe_checkout_session_id', session.id);
    }

    // 3a-bis. Clean up the staged checkout payload — once tickets exist, any
    // retry of this event short-circuits on the existing-order guard and never
    // re-reads the payload. (Best-effort: a failed delete only leaves an
    // orphaned row.)
    if (stagedPayload) {
      await supabase
        .from('checkout_payloads')
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
        // On RESUME the usage row may already exist from the prior attempt —
        // don't double-record it.
        const { data: existingUsage } = resumeOrderId
          ? await supabase
              .from('coupon_usages')
              .select('id')
              .eq('coupon_id', couponId)
              .eq('order_id', order.id)
              .maybeSingle()
          : { data: null };
        if (!existingUsage) {
          await supabase.from('coupon_usages').insert({
            coupon_id: couponId,
            order_id: order.id,
            user_id: userId,
            discount_amount: discountAmount,
          });
          console.log(`[Webhook] Coupon usage recorded: ${couponCode} (${couponId})`);
        }
      } catch (couponTrackError) {
        console.error('[Webhook] Failed to record coupon usage:', couponTrackError);
      }
    }

    // ── 4. TRANSFERS (deliberately AFTER ticket fulfillment — see note above) ──
    const transferCurrency = session.currency || 'cad';

    // `source_transaction` ties each transfer to THIS charge so the transfer
    // draws from the charge's settlement instead of the platform's available
    // balance (required in live mode, where the platform balance won't cover
    // payouts before the charge settles). If we somehow have no charge id,
    // fall back to plain transfers — but make NOISE, because that re-opens the
    // live-mode insufficient-balance failure mode.
    if (!chargeId) {
      console.error(
        `[Webhook] ⚠️ NO CHARGE ID for session ${session.id} (order ${order.id}) — creating transfers WITHOUT source_transaction. ` +
          'Live-mode transfers may fail on insufficient platform balance. Investigate immediately.'
      );
    }
    const sourceTransaction = chargeId ? { source_transaction: chargeId } : {};

    // ── Transfer INTENT ledger (persisted BEFORE any money moves) ──
    // If the function dies (timeout/crash) after a transfer is created but
    // before its id is recorded, this ledger + the idempotency keys let a
    // retry — or an admin / the refund & dispute paths — reconcile exactly
    // what was meant to go out, to whom, and for how much.
    type IntendedTransfer = {
      purpose: string; // 'organizer' | `split:<acct>` | 'elevsoft'
      destination: string;
      amountCents: number;
      idempotencyKey: string;
      transfer_id?: string | null;
      error?: string;
    };
    const intendedTransfers: IntendedTransfer[] = [];

    const isSingleOrganizerTransfer =
      !isPlatformEvent &&
      !!organizerStripeId &&
      actualOrganizerPayout > 0 &&
      !(hasMultiSplit && parsedSplits);

    if (isSingleOrganizerTransfer) {
      intendedTransfers.push({
        purpose: 'organizer',
        destination: organizerStripeId,
        amountCents: Math.round(actualOrganizerPayout * 100),
        idempotencyKey: `tx_${order.id}_org`,
      });
    }

    // Pre-compute every split allocation (same remainder logic as before) so
    // the intent ledger is complete BEFORE any transfer is attempted.
    const splitPlans: Array<{
      split: NonNullable<typeof parsedSplits>[number];
      amountCents: number;
    }> = [];
    if (hasMultiSplit && parsedSplits) {
      const splitBaseCents = Math.round(actualOrganizerPayout * 100);
      let totalAllocated = 0;
      for (let i = 0; i < parsedSplits.length; i++) {
        const split = parsedSplits[i];
        let amountCents: number;

        // For the last split, use remainder to avoid rounding drift — ONLY for
        // non-platform events, where checkout appends the PRIMARY organizer as
        // the final split (so the remainder correctly lands on the primary).
        // For platform events the splits are CO-ORGANIZERS only: each gets
        // exactly round(pct% × base) and the remainder stays with Empiria (no
        // transfer). Without this gate the last co-org received the ENTIRE
        // payout base.
        if (i === parsedSplits.length - 1 && !isPlatformEvent) {
          amountCents = splitBaseCents - totalAllocated;
        } else {
          amountCents = Math.round((splitBaseCents * split.percentage) / 100);
        }

        // Accumulate the INTENDED allocation regardless of transfer success.
        // This keeps the last split's remainder based on intended allocations,
        // so a failed intermediate transfer leaves that recipient unpaid
        // (money stays on the platform) without overpaying the last split.
        totalAllocated += amountCents;
        splitPlans.push({ split, amountCents });

        if (amountCents > 0) {
          intendedTransfers.push({
            purpose: `split:${split.recipient_stripe_id}`,
            destination: split.recipient_stripe_id,
            amountCents,
            idempotencyKey: `tx_${order.id}_split_${split.recipient_stripe_id}`,
          });
        }
      }
    }

    // Elevsoft's rev-share is a uniform % of the NET service fee for ALL
    // events — platform-owned included. (Previously platform events sent
    // Elevsoft 100% of the take-home, which was wrong: ticket revenue AND
    // the remaining fee share belong to Empiria on its own events.)
    // Rounded to cents BEFORE storing so the persisted amount matches the
    // transferred cents exactly.
    const elevsoftStripeId = process.env.ELEVSOFT_STRIPE_ACCOUNT_ID;
    const elevsoftPercent = parseFloat(process.env.ELEVSOFT_REVENUE_PERCENT || '0');
    const elevsoftAmount =
      elevsoftStripeId && elevsoftPercent > 0
        ? Math.max(0, Math.round(platformTakeHome * (elevsoftPercent / 100) * 100) / 100)
        : 0;
    const elevsoftCents = Math.round(elevsoftAmount * 100);

    if (elevsoftStripeId && elevsoftCents > 0) {
      intendedTransfers.push({
        purpose: 'elevsoft',
        destination: elevsoftStripeId,
        amountCents: elevsoftCents,
        idempotencyKey: `tx_${order.id}_elevsoft`,
      });
    }

    const persistIntendedTransfers = async () => {
      const { error: intentError } = await supabase
        .from('orders')
        .update({
          payout_breakdown: { ...basePayoutBreakdown, intended_transfers: intendedTransfers },
        })
        .eq('id', order.id);
      if (intentError) {
        console.error('[Webhook] Failed to persist intended_transfers:', intentError);
      }
      return intentError;
    };
    const intentFor = (purpose: string) => intendedTransfers.find((t) => t.purpose === purpose);

    if (intendedTransfers.length > 0) {
      // If the intent ledger can't be persisted, ABORT before sending money:
      // throw → 500 → Stripe retries (transfer idempotency keys + the
      // zero-ticket resume path keep the retry safe).
      const intentError = await persistIntendedTransfers();
      if (intentError) throw intentError;
    }

    // ── Create organizer transfer (replaces destination charge behavior) ──
    let organizerTransferId: string | null = null;

    if (isSingleOrganizerTransfer) {
      const intent = intentFor('organizer')!;
      try {
        const transfer = await stripe.transfers.create(
          {
            amount: intent.amountCents,
            currency: transferCurrency,
            destination: organizerStripeId,
            transfer_group: metadata.transfer_group,
            ...sourceTransaction,
            metadata: { event_id: eventId, order_id: order.id, type: 'organizer_payout' },
          },
          { idempotencyKey: intent.idempotencyKey }
        );
        organizerTransferId = transfer.id;
        intent.transfer_id = transfer.id;
        console.log(`[Webhook] Organizer transfer created: ${intent.amountCents} cents to ${organizerStripeId}`);
      } catch (err) {
        intent.error = err instanceof Error ? err.message : String(err);
        console.error('[Webhook] Organizer transfer failed:', err);
      }
      await persistIntendedTransfers();
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

    if (splitPlans.length > 0) {
      let totalTransferred = 0;

      for (const { split, amountCents } of splitPlans) {
        totalTransferred += amountCents;

        let transferId: string | null = null;
        const intent = intentFor(`split:${split.recipient_stripe_id}`);
        if (amountCents > 0 && intent) {
          try {
            const transfer = await stripe.transfers.create(
              {
                amount: amountCents,
                currency: transferCurrency,
                destination: split.recipient_stripe_id,
                transfer_group: metadata.transfer_group,
                ...sourceTransaction,
                metadata: {
                  event_id: eventId,
                  order_id: order.id,
                  recipient: split.recipient_user_id,
                  percentage: String(split.percentage),
                },
              },
              { idempotencyKey: intent.idempotencyKey }
            );
            transferId = transfer.id;
            intent.transfer_id = transfer.id;
            console.log(
              `[Webhook] Transfer created: ${amountCents} cents (${split.percentage}%) to ${split.recipient_stripe_id}`
            );
          } catch (transferError) {
            intent.error =
              transferError instanceof Error ? transferError.message : String(transferError);
            console.error(
              `[Webhook] Failed to create transfer for ${split.recipient_stripe_id}:`,
              transferError
            );
          }
          await persistIntendedTransfers();
        }

        splitTransferDetails.push({
          user_id: split.recipient_user_id,
          stripe_id: split.recipient_stripe_id,
          percentage: split.percentage,
          amount: Math.round(amountCents) / 100,
          description: split.description,
          stripe_transfer_id: transferId,
        });
      }

      console.log(`[Webhook] Multi-split transfers completed: ${totalTransferred} cents total`);
    }

    // ── Elevsoft revenue share transfer ──
    let elevsoftTransferData: { id: string; amount: number } | null = null;

    if (elevsoftStripeId && elevsoftCents > 0) {
      const intent = intentFor('elevsoft')!;
      try {
        const transfer = await stripe.transfers.create(
          {
            amount: elevsoftCents,
            currency: transferCurrency,
            destination: elevsoftStripeId,
            transfer_group: metadata.transfer_group,
            ...sourceTransaction,
            metadata: {
              event_id: eventId,
              order_id: order.id,
              type: isPlatformEvent ? 'platform_event_revenue' : 'elevsoft_revenue_share',
              platform_fee_gross: platformFee.toFixed(2),
              stripe_fee: stripeFee.toFixed(2),
            },
          },
          { idempotencyKey: intent.idempotencyKey }
        );
        elevsoftTransferData = { id: transfer.id, amount: elevsoftAmount };
        intent.transfer_id = transfer.id;
        console.log(`[Webhook] Elevsoft transfer: ${elevsoftCents} cents`);
      } catch (err) {
        intent.error = err instanceof Error ? err.message : String(err);
        console.error('[Webhook] Elevsoft transfer failed:', err);
      }
      await persistIntendedTransfers();
    }

    // ── 5. Update order with full payout_breakdown including transfer IDs ──
    await supabase
      .from('orders')
      .update({
        elevsoft_amount: elevsoftTransferData?.amount || 0,
        payout_breakdown: {
          ...basePayoutBreakdown,
          intended_transfers: intendedTransfers.length > 0 ? intendedTransfers : null,
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

    // 6. Send confirmation email (non-blocking — failures must not break the webhook)
    if (userEmail && eventData && allTickets.length > 0) {
      try {
        await sendOrderConfirmationEmail({
          to: userEmail,
          attendeeName: userName,
          orderId: order.id,
          eventTitle: eventData.title,
          organizerName,
          organizerAvatarUrl,
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

    // 6b. Notify the event owner of the sale (per-event notify_on_sale toggle;
    // non-blocking). Owner = events.organizer_id (the real organizer, or the
    // admin for platform-owned events). Skipped silently if toggled off.
    if (eventData?.notify_on_sale && eventData.organizer_id) {
      try {
        const { data: ownerRow } = await supabase
          .from('users')
          .select('email, full_name')
          .eq('auth0_id', eventData.organizer_id)
          .single();
        if (ownerRow?.email) {
          await sendSaleNotificationEmail({
            to: ownerRow.email,
            organizerName: ownerRow.full_name || organizerName,
            eventTitle: eventData.title,
            orderId: order.id,
            total: customerTotal,
            currency: session.currency || 'cad',
            quantity: totalTickets,
            buyerName: userName,
            buyerEmail: userEmail,
            lineItems: tierSelections.map((s) => ({
              tierName: s.tierName,
              quantity: s.quantity,
              unitPrice: s.unitPrice,
            })),
            organizerPayout: orderOrganizerPayout,
            isPlatformEvent,
          });
          console.log('[Webhook] Sale notification sent to owner:', ownerRow.email);
        }
      } catch (notifyError) {
        console.error('[Webhook] Failed to send sale notification:', notifyError);
      }
    }

    console.log('[Webhook] Checkout fully processed for session:', session.id);
  } catch (error) {
    console.error('[Webhook] Critical error processing checkout:', error);
    // RETHROW so the POST handler returns HTTP 500 and Stripe retries this
    // event. Swallowing the error here returned 200 — customer charged,
    // nothing created, no retry. The existing-order guard above + transfer
    // idempotencyKeys make the retry safe.
    throw error;
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

async function handleChargeRefunded(charge: any, stripeEventId: string) {
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
    // OUT-OF-ORDER DELIVERY: the refund event can arrive before
    // checkout.session.completed has created the order. THROW → 500 → Stripe
    // retries (with backoff, up to ~3 days), by which point the order exists
    // and the reversal bookkeeping below runs against it. Acking with 200 here
    // permanently skipped the transfer reversals for this refund.
    throw new Error(
      `[Webhook] charge.refunded: no order for PI ${paymentIntentId} — failing so Stripe retries (out-of-order delivery)`
    );
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

  // Track processed refund ids for bookkeeping. NOTE: charge.refunds.data is
  // not always populated on charge.refunded events; the `refund.created`
  // handler upserts the authoritative refund id. We deliberately do NOT fall
  // back to charge.id here (the old fallback polluted refund_ids with a
  // ch_... id).
  const refundList = charge.refunds?.data;

  // Idempotency keys are keyed on the Stripe EVENT id: each partial refund
  // fires its own charge.refunded event (unique id), so successive partial
  // refunds get distinct keys, while a RETRY of the same event reuses the key
  // and is deduped by Stripe. (Keying on charge.id collapsed all partial
  // refunds to one key — the second reversal was silently rejected.)
  const reversalKeyBase = `rev_${stripeEventId}`;

  const processedRefundIds: string[] = Array.isArray(pb.refund_ids) ? pb.refund_ids : [];

  // Reverse each outbound transfer proportionally to the new refund delta.
  // Per-transfer original amount comes from payout_breakdown: organizer_payout
  // for the organizer transfer, split.amount for each split, elevsoft amount for
  // Elevsoft. We reverse that share × proportion, CLAMPED to the transfer's
  // remaining reversible balance (retrieved live) so rounding drift across
  // successive partial refunds can never overshoot into an API error.
  // Reversal FAILURES are recorded in payout_breakdown.failed_reversals —
  // the "money owed back to the platform" ledger (e.g. the organizer's
  // connected balance was already paid out and can't cover the reversal).
  const failedReversals: Array<{ transferId: string; amountCents: number; error: string; at: string }> =
    Array.isArray(pb.failed_reversals) ? [...pb.failed_reversals] : [];

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
    let amountToReverse = Math.round(originalCents * proportion);
    if (amountToReverse <= 0) continue;

    // Clamp to what is actually still reversible on the transfer.
    try {
      const liveTransfer = await stripe.transfers.retrieve(t.id);
      const remaining = (liveTransfer.amount ?? 0) - (liveTransfer.amount_reversed ?? 0);
      amountToReverse = Math.min(amountToReverse, Math.max(0, remaining));
    } catch (err) {
      console.error(`[Webhook] Could not retrieve transfer ${t.id} to clamp reversal — using computed amount:`, err);
    }
    if (amountToReverse <= 0) {
      console.log(`[Webhook] Transfer ${t.id} (${t.label}) already fully reversed — skipping`);
      continue;
    }

    try {
      await stripe.transfers.createReversal(
        t.id,
        { amount: amountToReverse },
        { idempotencyKey: `${reversalKeyBase}_${t.id}` }
      );
      console.log(`[Webhook] Reversed ${amountToReverse} cents on transfer ${t.id} (${t.label})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failedReversals.push({
        transferId: t.id,
        amountCents: amountToReverse,
        error: message,
        at: new Date().toISOString(),
      });
      console.error(`[Webhook] Failed to reverse transfer ${t.id} (${t.label}):`, err);
    }
  }

  const fullyRefunded = cumulativeRefundedCents >= chargeAmountCents;

  // Persist reversal bookkeeping (cumulative refunded + processed refund ids +
  // failed-reversal ledger). Real refund ids also arrive via refund.created.
  const updatedPb = {
    ...pb,
    refunded_amount: Math.round(cumulativeRefundedCents) / 100,
    refund_ids:
      Array.isArray(refundList) && refundList.length > 0
        ? Array.from(new Set([...processedRefundIds, ...refundList.map((r: any) => r.id)]))
        : processedRefundIds,
    ...(failedReversals.length > 0 ? { failed_reversals: failedReversals } : {}),
  };

  if (fullyRefunded) {
    // Mark order refunded, refund its tickets, and restore inventory.
    await supabase
      .from('orders')
      .update({ status: 'refunded', payout_breakdown: updatedPb })
      .eq('id', order.id);

    // Refund only currently-valid tickets ATOMICALLY: the UPDATE itself is
    // filtered on status = 'valid' and we restore inventory from the rows the
    // update actually returned. A select-then-update would race with an admin
    // action that already flipped (and restored) the same tickets, causing a
    // double inventory restore.
    const { data: flipped } = await supabase
      .from('tickets')
      .update({ status: 'refunded' })
      .eq('order_id', order.id)
      .eq('status', 'valid')
      .select('id, tier_id, event_id');
    const refundable = flipped ?? [];
    const ids = refundable.map((t: any) => t.id);

    // Restore inventory via atomic RPCs (inventory trigger is INSERT-only),
    // counting ONLY the tickets this handler transitioned.
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
    // OUT-OF-ORDER DELIVERY: the dispute can arrive before the order exists.
    // THROW → 500 → Stripe retries (up to ~3 days) until the order is there.
    // Acking with 200 permanently skipped the transfer reversals.
    throw new Error(
      `[Webhook] charge.dispute.created: no order for PI ${paymentIntentId} — failing so Stripe retries (out-of-order delivery)`
    );
  }

  const pb: any = order.payout_breakdown || {};

  // Idempotency: skip if this dispute was already handled.
  if (pb.dispute_id === dispute.id) {
    console.log('[Webhook] Dispute', dispute.id, 'already handled for order', order.id);
    return;
  }

  // Reverse ALL outbound transfers in full — the platform is now debited the
  // disputed amount and connected accounts must not keep those funds.
  // Clamp each reversal to the transfer's remaining reversible balance
  // (partial refunds may have already reversed part of it); record FAILURES
  // in payout_breakdown.failed_reversals — the money-owed-back ledger.
  const failedReversals: Array<{ transferId: string; amountCents: number; error: string; at: string }> =
    Array.isArray(pb.failed_reversals) ? [...pb.failed_reversals] : [];

  const transfers = collectOutboundTransfers(pb);
  for (const t of transfers) {
    let reverseAmountCents: number | null = null;
    try {
      const liveTransfer = await stripe.transfers.retrieve(t.id);
      const remaining = (liveTransfer.amount ?? 0) - (liveTransfer.amount_reversed ?? 0);
      if (remaining <= 0) {
        console.log(`[Webhook] Dispute ${dispute.id}: transfer ${t.id} (${t.label}) already fully reversed — skipping`);
        continue;
      }
      reverseAmountCents = remaining;
    } catch (err) {
      // Can't read the transfer — fall back to a full (amount-less) reversal,
      // which Stripe caps at the remaining balance itself.
      console.error(`[Webhook] Dispute ${dispute.id}: could not retrieve transfer ${t.id} to clamp — using full reversal:`, err);
    }
    try {
      await stripe.transfers.createReversal(
        t.id,
        reverseAmountCents != null ? { amount: reverseAmountCents } : {},
        { idempotencyKey: `disp_${dispute.id}_${t.id}` }
      );
      console.log(`[Webhook] Dispute ${dispute.id}: reversed transfer ${t.id} (${t.label})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failedReversals.push({
        transferId: t.id,
        amountCents: reverseAmountCents ?? 0,
        error: message,
        at: new Date().toISOString(),
      });
      console.error(`[Webhook] Dispute reversal failed for transfer ${t.id} (${t.label}):`, err);
    }
  }

  // Dispute fee (e.g. $15) comes through dispute.balance_transactions.
  const disputeFeeCents = Array.isArray(dispute.balance_transactions)
    ? dispute.balance_transactions.reduce(
        (sum: number, bt: any) => sum + Math.abs(bt?.fee || 0),
        0
      )
    : 0;

  // Record the dispute on the order. Do NOT change order status — there is no
  // 'disputed' enum value; we only annotate payout_breakdown.
  // charge.dispute.closed handles the outcome (won → re-transfer).
  const updatedPb = {
    ...pb,
    dispute_id: dispute.id,
    dispute: {
      id: dispute.id,
      status: dispute.status,
      amount: (dispute.amount || 0) / 100,
      dispute_fee: disputeFeeCents / 100,
    },
    ...(disputeFeeCents > 0 ? { dispute_fee: disputeFeeCents / 100 } : {}),
    ...(failedReversals.length > 0 ? { failed_reversals: failedReversals } : {}),
  };
  await supabase
    .from('orders')
    .update({ payout_breakdown: updatedPb })
    .eq('id', order.id);
  console.log(`[Webhook] Dispute ${dispute.id} recorded for order ${order.id}; all transfers reversed`);

  // Alert admins — disputes have a hard evidence deadline.
  try {
    const dueBy = dispute.evidence_details?.due_by
      ? new Date(dispute.evidence_details.due_by * 1000).toUTCString()
      : null;
    await sendEmail({
      to: ADMIN_ALERT_EMAIL,
      subject: `⚠️ Stripe dispute opened — order ${order.id} ($${((dispute.amount || 0) / 100).toFixed(2)} ${String(dispute.currency || 'cad').toUpperCase()})`,
      html: `
        <h2>A payment dispute (chargeback) was opened</h2>
        <p><strong>Order:</strong> ${order.id}<br/>
        <strong>Dispute:</strong> ${dispute.id} (${dispute.reason || 'unknown reason'})<br/>
        <strong>Amount:</strong> $${((dispute.amount || 0) / 100).toFixed(2)} ${String(dispute.currency || 'cad').toUpperCase()}<br/>
        <strong>Dispute fee:</strong> $${(disputeFeeCents / 100).toFixed(2)}</p>
        <p>All outbound transfers for this order have been reversed${failedReversals.length > 0 ? ` (<strong>${failedReversals.length} reversal(s) FAILED — see payout_breakdown.failed_reversals</strong>)` : ''}.</p>
        <p><strong>Evidence must be submitted in the Stripe dashboard — typically within 7–21 days of the dispute date${dueBy ? ` (deadline: ${dueBy})` : ''}.</strong></p>
        <p><a href="https://dashboard.stripe.com/disputes/${dispute.id}">Open the dispute in the Stripe dashboard</a></p>
      `,
    });
  } catch (emailError) {
    console.error('[Webhook] Failed to send dispute alert email:', emailError);
  }
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
    // Same out-of-order rationale as charge.refunded / dispute.created:
    // THROW so Stripe retries until the order exists.
    throw new Error(
      `[Webhook] charge.dispute.closed: no order for PI ${paymentIntentId} — failing so Stripe retries (out-of-order delivery)`
    );
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
  // each previously-reversed share back to its connected account. The re-pay is
  // NETTED against money the recipient never returned:
  //   re-pay = original share
  //          − the share already clawed back by PRIOR REFUNDS (proportional —
  //            same math the refund handler used; those funds went to the
  //            customer, not the dispute, so they don't come back on a win)
  //          − any reversal that FAILED (recorded in failed_reversals — the
  //            recipient still HAS that money, so re-paying it would double-pay).
  // Any non-won closed status (lost/warning_*) means the reversal stands — we
  // just record the outcome.
  if (dispute.status === 'won') {
    const customerTotal = Number(pb.customer_total || 0);
    const refundedProportion =
      customerTotal > 0 ? Math.min(1, Number(pb.refunded_amount || 0) / customerTotal) : 0;
    const failedReversalList: Array<{ transferId?: string; amountCents?: number }> =
      Array.isArray(pb.failed_reversals) ? pb.failed_reversals : [];
    const intendedList: Array<{ purpose?: string; amountCents?: number }> =
      Array.isArray(pb.intended_transfers) ? pb.intended_transfers : [];

    // Net re-pay (in dollars) for a recipient given its original share and the
    // id of its original transfer.
    const netRepay = (originalAmount: number, transferId: string | null | undefined): number => {
      let cents = Math.round(originalAmount * 100);
      // Subtract the proportional share already consumed by prior refunds.
      cents -= Math.round(cents * refundedProportion);
      // Subtract reversals that FAILED for this transfer — that money never
      // left the recipient's balance.
      for (const f of failedReversalList) {
        if (f?.transferId && f.transferId === transferId) {
          cents -= f.amountCents || 0;
        }
      }
      return Math.max(0, cents) / 100;
    };

    const reTransfers: {
      organizer_transfer_id?: string | null;
      splits?: Array<{ user_id?: string; stripe_id?: string; amount: number; stripe_transfer_id: string | null }>;
      elevsoft_transfer_id?: string | null;
    } = {};

    // Single-organizer payout (only present when there were no splits).
    // Prefer the intent ledger for original amount/destination where present.
    if (pb.organizer_transfer_id && pb.organizer_payout > 0) {
      const organizerIntent = intendedList.find((t) => t.purpose === 'organizer');
      const originalAmount = organizerIntent?.amountCents != null
        ? organizerIntent.amountCents / 100
        : Number(pb.organizer_payout || 0);
      const destination = await resolveOrganizerStripeId(supabase, order.id, pb);
      reTransfers.organizer_transfer_id = await redoTransfer({
        amount: netRepay(originalAmount, pb.organizer_transfer_id),
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
        // Only redo splits whose ORIGINAL transfer actually happened —
        // mirroring the organizer branch above. A split with a null
        // stripe_transfer_id was never paid (its transfer failed), so there
        // was nothing reversed and a won dispute returns nothing for it.
        if (!s?.stripe_transfer_id) {
          reTransfers.splits.push({
            user_id: s?.user_id,
            stripe_id: s?.stripe_id,
            amount,
            stripe_transfer_id: null,
          });
          continue;
        }
        const repayAmount = netRepay(amount, s.stripe_transfer_id);
        const newId = await redoTransfer({
          amount: repayAmount,
          currency,
          destination,
          disputeId: dispute.id,
          orderId: order.id,
          type: 'split_redo',
        });
        reTransfers.splits.push({
          user_id: s?.user_id,
          stripe_id: s?.stripe_id,
          amount: repayAmount,
          stripe_transfer_id: newId ?? s?.stripe_transfer_id ?? null,
        });
      }
    }

    // Elevsoft share.
    if (pb.elevsoft_transfer?.stripe_transfer_id) {
      reTransfers.elevsoft_transfer_id = await redoTransfer({
        amount: netRepay(
          Number(pb.elevsoft_transfer?.amount || 0),
          pb.elevsoft_transfer.stripe_transfer_id
        ),
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
// Prefer the persisted intent ledger (no API call); fall back to reading the
// original transfer's destination back from Stripe.
async function resolveOrganizerStripeId(
  _supabase: ReturnType<typeof getSupabaseAdmin>,
  _orderId: string,
  pb: any
): Promise<string | null> {
  if (Array.isArray(pb.intended_transfers)) {
    const organizerIntent = pb.intended_transfers.find((t: any) => t?.purpose === 'organizer');
    if (organizerIntent?.destination) return organizerIntent.destination;
  }
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
// charge.updated — Stripe-fee TRUE-UP
//
// When fulfillment ran before the charge's balance_transaction existed we
// ESTIMATED the Stripe fee (payout_breakdown.stripe_fee_estimated = true).
// charge.updated fires once the balance_transaction is attached: correct the
// BOOKS only (stripe_fee_amount, net_platform_revenue, payout_breakdown fee
// fields) — transfers were already sized and are NOT touched.
// ──────────────────────────────────────────────────
async function handleChargeUpdated(charge: any) {
  const btRef = charge.balance_transaction;
  if (!btRef) return; // nothing to true-up yet

  const paymentIntentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) return;

  const supabase = getSupabaseAdmin();
  const { data: order } = await supabase
    .from('orders')
    .select('id, payout_breakdown')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  // charge.updated fires for ALL charges (receipt sends, metadata edits, …)
  // and often before our order exists — ack quietly; the checkout handler
  // fetches the balance_transaction itself, so nothing is lost.
  if (!order) return;

  const pb: any = order.payout_breakdown || {};
  if (!pb.stripe_fee_estimated) return; // books already real — nothing to do

  // Resolve the actual fee.
  let actualFee: number;
  try {
    const bt =
      typeof btRef === 'object'
        ? btRef
        : await stripe.balanceTransactions.retrieve(btRef);
    actualFee = (bt.fee || 0) / 100;
  } catch (err) {
    console.error('[Webhook] charge.updated: failed to retrieve balance_transaction — will retry:', err);
    throw err; // 500 → Stripe retries; flag stays set so the retry true-ups
  }

  // Recompute the platform bookkeeping with the REAL fee (same math as
  // fulfillment; money does NOT move — transfers were already sized).
  const passProcessingFee = !!pb.pass_processing_fee;
  const platformFee = Number(pb.platform_fee || 0);
  const stripeOffset = Number(pb.stripe_offset || 0);
  const hstOnFee = Number(pb.hst_on_fee || 0);
  const customerTotal = Number(pb.customer_total || 0);
  // Residual math uses the NOTIONAL payout on platform events (mirrors fulfillment).
  const payoutForResidual = Number(
    pb.platform_event_notional_payout ?? pb.organizer_payout ?? 0
  );

  const stripeGap = passProcessingFee
    ? Math.max(0, Math.round((actualFee - stripeOffset) * 100) / 100)
    : 0;
  let platformTakeHome = Math.max(0, Math.round((platformFee - stripeGap) * 100) / 100);
  if (!passProcessingFee) {
    const absorbResidual =
      Math.round((customerTotal - actualFee - payoutForResidual - hstOnFee) * 100) / 100;
    platformTakeHome = Math.max(0, Math.min(platformTakeHome, absorbResidual));
  }

  await supabase
    .from('orders')
    .update({
      stripe_fee_amount: actualFee,
      net_platform_revenue: platformTakeHome,
      payout_breakdown: {
        ...pb,
        stripe_fee: actualFee,
        stripe_gap: stripeGap,
        platform_take_home: platformTakeHome,
        stripe_fee_estimated: false,
        stripe_fee_trued_up_at: new Date().toISOString(),
      },
    })
    .eq('id', order.id);

  console.log(
    `[Webhook] charge.updated: trued-up Stripe fee for order ${order.id} → $${actualFee} (take-home $${platformTakeHome})`
  );
}

// ──────────────────────────────────────────────────
// refund.created — record the REAL refund id
//
// charge.refunded's embedded refunds list is not always populated, and the old
// fallback stored the CHARGE id in refund_ids. This handler upserts the
// authoritative re_... id.
// ──────────────────────────────────────────────────
async function handleRefundCreated(refund: any) {
  const paymentIntentId =
    typeof refund.payment_intent === 'string'
      ? refund.payment_intent
      : refund.payment_intent?.id;
  if (!paymentIntentId || !refund.id) {
    console.warn('[Webhook] refund.created with no payment_intent/id — acking');
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data: order } = await supabase
    .from('orders')
    .select('id, payout_breakdown')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  if (!order) {
    // Out-of-order: retry until the order exists so the refund id is recorded.
    throw new Error(
      `[Webhook] refund.created: no order for PI ${paymentIntentId} — failing so Stripe retries (out-of-order delivery)`
    );
  }

  const pb: any = order.payout_breakdown || {};
  const refundIds: string[] = Array.isArray(pb.refund_ids) ? pb.refund_ids : [];
  if (refundIds.includes(refund.id)) return; // already recorded (retry)

  await supabase
    .from('orders')
    .update({ payout_breakdown: { ...pb, refund_ids: [...refundIds, refund.id] } })
    .eq('id', order.id);
  console.log(`[Webhook] refund.created: recorded refund ${refund.id} on order ${order.id}`);
}

// ──────────────────────────────────────────────────
// refund.failed — the customer was NOT refunded
//
// By the time this fires we have usually already reversed the outbound
// transfers (charge.refunded), so the platform is HOLDING the money while the
// customer never received it. Flag the order and alert admins for manual
// action (re-issue the refund to another payment method / contact customer).
// ──────────────────────────────────────────────────
async function handleRefundFailed(refund: any) {
  const paymentIntentId =
    typeof refund.payment_intent === 'string'
      ? refund.payment_intent
      : refund.payment_intent?.id;
  if (!paymentIntentId) {
    console.warn('[Webhook] refund.failed with no payment_intent — acking');
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data: order } = await supabase
    .from('orders')
    .select('id, status, payout_breakdown, buyer_email, total_amount, currency')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  if (!order) {
    throw new Error(
      `[Webhook] refund.failed: no order for PI ${paymentIntentId} — failing so Stripe retries (out-of-order delivery)`
    );
  }

  const pb: any = order.payout_breakdown || {};

  // Idempotency: a retried event for the same refund changes nothing.
  if (pb.refund_failed?.refundId === refund.id) {
    console.log(`[Webhook] refund.failed: ${refund.id} already recorded for order ${order.id}`);
    return;
  }

  // Keep status 'refunded' (the enum has no better state) but flag the failure
  // VISIBLY in payout_breakdown so admin views can surface it.
  const updatedPb = {
    ...pb,
    refund_failed: {
      refundId: refund.id,
      at: new Date().toISOString(),
      reason: refund.failure_reason || 'unknown',
    },
  };
  await supabase
    .from('orders')
    .update({ payout_breakdown: updatedPb })
    .eq('id', order.id);
  console.error(
    `[Webhook] ⚠️ Refund ${refund.id} FAILED for order ${order.id} (${refund.failure_reason || 'unknown'}) — customer NOT refunded`
  );

  // Admin alert — manual action required.
  try {
    await sendEmail({
      to: ADMIN_ALERT_EMAIL,
      subject: `🚨 Refund FAILED for order ${order.id} — manual action needed`,
      html: `
        <h2>Refund FAILED — the customer was NOT refunded</h2>
        <p><strong>Order:</strong> ${order.id}<br/>
        <strong>Refund:</strong> ${refund.id}<br/>
        <strong>Failure reason:</strong> ${refund.failure_reason || 'unknown'}<br/>
        <strong>Customer:</strong> ${order.buyer_email || 'unknown'}<br/>
        <strong>Order total:</strong> $${Number(order.total_amount || 0).toFixed(2)} ${String(order.currency || 'cad').toUpperCase()}</p>
        <p>The order is marked <strong>refunded</strong> and the outbound transfers were already reversed,
        but Stripe could not return the money to the customer (e.g. expired/closed card).
        <strong>Manual action needed:</strong> re-issue the refund from the Stripe dashboard or arrange an
        alternative refund method with the customer.</p>
        <p><a href="https://dashboard.stripe.com/payments/${paymentIntentId}">Open the payment in the Stripe dashboard</a></p>
      `,
    });
  } catch (emailError) {
    console.error('[Webhook] Failed to send refund-failed alert email:', emailError);
  }
}

// ──────────────────────────────────────────────────
// COUPON RESERVATION RELEASE
//
// Coupon usage is RESERVED atomically at checkout time (increment_coupon_usage in
// app/api/checkout/route.ts). If the checkout is abandoned (`checkout.session.expired`)
// we release that reservation via decrement_coupon_usage so the slot is freed for
// someone else. We deliberately do NOT release on payment_intent.payment_failed —
// declines are retryable within the same session (see the case above).
//
// IDEMPOTENCY: Stripe may retry these events. `checkout.session.expired` fires once
// per session, but to avoid a double-decrement on a retried event we guard on the order:
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
