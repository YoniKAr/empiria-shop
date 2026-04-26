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
  const subtotal = parseFloat(metadata.subtotal);
  const platformFee = parseFloat(metadata.platform_fee);
  const feePercent = parseFloat(metadata.platform_fee_percent) || 0;
  const feeFixed = parseFloat(metadata.platform_fee_fixed) || 0;
  const organizerPayout = parseFloat(metadata.organizer_payout);
  const customerTotal = parseFloat(metadata.customer_total || metadata.subtotal);
  const processingFeeAmount = parseFloat(metadata.processing_fee_amount || '0');
  const passProcessingFee = metadata.pass_processing_fee === 'true';
  const totalTickets = parseInt(metadata.total_tickets || '0', 10);

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

    // ── Get tax amount from session ──
    const taxAmount = (session.total_details?.amount_tax || 0) / 100; // cents → dollars

    // Calculate actual organizer payout based on fee absorption model
    let actualOrganizerPayout: number;
    if (passProcessingFee) {
      // Attendee paid the processing fee — organizer gets full (subtotal - platformFee)
      actualOrganizerPayout = subtotal - platformFee;
    } else {
      // Organizer absorbs Stripe fee
      actualOrganizerPayout = subtotal - platformFee - stripeFee;
    }
    actualOrganizerPayout = Math.max(0, actualOrganizerPayout);

    // 1. Create the order (initial payout_breakdown — transfer IDs added after transfers)
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        event_id: eventId,
        stripe_payment_intent_id: session.payment_intent,
        stripe_checkout_session_id: session.id,
        total_amount: customerTotal,
        platform_fee_amount: platformFee,
        organizer_payout_amount: actualOrganizerPayout,
        processing_fee_amount: processingFeeAmount,
        total_tickets: totalTickets,
        currency: session.currency || 'cad',
        buyer_email: userEmail || null,
        buyer_name: userName || null,
        payout_breakdown: {
          version: 3,
          subtotal,
          customer_total: customerTotal,
          processing_fee: processingFeeAmount,
          pass_processing_fee: passProcessingFee,
          total_tickets: totalTickets,
          platform_fee_fixed_semantics: 'per_ticket',
          tax_amount: taxAmount,
          stripe_fee: stripeFee,
          platform_fee_percent: feePercent,
          platform_fee_fixed: feeFixed,
          platform_fee: platformFee,
          organizer_payout: actualOrganizerPayout,
          transfer_group: metadata.transfer_group || null,
          splits: parsedSplits
            ? parsedSplits.map((s) => ({
                user_id: s.recipient_user_id,
                stripe_id: s.recipient_stripe_id,
                percentage: s.percentage,
                amount: Math.round(actualOrganizerPayout * (s.percentage / 100) * 100) / 100,
                description: s.description,
              }))
            : null,
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
            totalTransferred += amountCents;
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
      let elevsoftAmount: number;

      if (isPlatformEvent) {
        // Platform events: Elevsoft gets 100% of (revenue - Stripe fees)
        elevsoftAmount = passProcessingFee ? subtotal : Math.max(0, subtotal - stripeFee);
      } else {
        // Organizer events: Elevsoft gets elevsoftPercent% of GROSS platform fee
        elevsoftAmount = platformFee * (elevsoftPercent / 100);
      }

      elevsoftAmount = Math.max(0, elevsoftAmount);
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
        payout_breakdown: {
          version: 3,
          subtotal,
          customer_total: customerTotal,
          processing_fee: processingFeeAmount,
          pass_processing_fee: passProcessingFee,
          total_tickets: totalTickets,
          platform_fee_fixed_semantics: 'per_ticket',
          tax_amount: taxAmount,
          stripe_fee: stripeFee,
          platform_fee_percent: feePercent,
          platform_fee_fixed: feeFixed,
          platform_fee: platformFee,
          organizer_payout: actualOrganizerPayout,
          organizer_transfer_id: organizerTransferId,
          transfer_group: metadata.transfer_group || null,
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
      .select('title, venue_name, city')
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

      const ticketInserts = Array.from({ length: selection.quantity }, (_, i) => ({
        event_id: eventId,
        tier_id: selection.tierId,
        order_id: order.id,
        user_id: userId,
        attendee_name: userName,
        attendee_email: userEmail,
        status: 'valid' as const,
        occurrence_id: occurrenceId,
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
          lineItems: tierSelections.map((s) => ({
            tierName: s.tierName,
            quantity: s.quantity,
            unitPrice: s.unitPrice,
          })),
          total: customerTotal,
          processingFee: processingFeeAmount,
          currency: session.currency || 'cad',
          tickets: allTickets,
          receiptUrl,
        });
        console.log('[Webhook] Confirmation email sent to:', userEmail);
      } catch (emailError) {
        console.error('[Webhook] Failed to send confirmation email:', emailError);
      }
    }

    console.log('[Webhook] Checkout fully processed for session:', session.id);
  } catch (error) {
    console.error('[Webhook] Critical error processing checkout:', error);
  }
}
