// ──────────────────────────────────────────────────
// 📁 app/api/webhooks/stripe/route.ts — NEW FILE (create this)
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
  const tierSelections = JSON.parse(metadata.tier_selections) as Array<{
    tierId: string;
    quantity: number;
    unitPrice: number;
    tierName: string;
  }>;
  const subtotal = parseFloat(metadata.subtotal);
  const platformFee = parseFloat(metadata.platform_fee);
  const organizerPayout = parseFloat(metadata.organizer_payout);

  // Determine user_id for order/tickets
  // If user is logged in, use auth0_id. Otherwise, use email as identifier.
  const userId = userAuth0Id || `guest:${userEmail}`;

  try {
    // 1. Create the order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        event_id: eventId,
        stripe_payment_intent_id: session.payment_intent,
        stripe_checkout_session_id: session.id,
        total_amount: subtotal,
        platform_fee_amount: platformFee,
        organizer_payout_amount: organizerPayout,
        currency: session.currency || 'cad',
        payout_breakdown: {
          platform_fee_percent: metadata.platform_fee_percent,
          platform_fee_fixed: metadata.platform_fee_fixed,
          subtotal,
          platform_fee: platformFee,
          organizer_payout: organizerPayout,
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

    // 2. Fetch event details for confirmation email
    const { data: eventData } = await supabase
      .from('events')
      .select('title, start_at, end_at, venue_name, city')
      .eq('id', eventId)
      .single();

    // 3. Create order_items and tickets for each tier selection
    const allTickets: Array<{ id: string; qr_code_secret: string; tierName: string }> = [];

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
      const ticketInserts = Array.from({ length: selection.quantity }, () => ({
        event_id: eventId,
        tier_id: selection.tierId,
        order_id: order.id,
        user_id: userId,
        attendee_name: userName,
        attendee_email: userEmail,
        status: 'valid' as const,
      }));

      const { data: tickets, error: ticketError } = await supabase
        .from('tickets')
        .insert(ticketInserts)
        .select('id, qr_code_secret');

      if (ticketError) {
        console.error('[Webhook] Failed to create tickets:', ticketError);
      } else {
        console.log(`[Webhook] Created ${tickets?.length} tickets for tier ${selection.tierName}`);
        // Accumulate tickets with tier name for email
        if (tickets) {
          for (const t of tickets) {
            allTickets.push({ id: t.id, qr_code_secret: t.qr_code_secret, tierName: selection.tierName });
          }
        }
      }
    }

    // 4. Fetch Stripe receipt URL + invoice URLs
    let receiptUrl: string | undefined;
    let invoiceUrl: string | undefined;
    let invoicePdf: string | undefined;
    if (session.payment_intent) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent, {
          expand: ['latest_charge'],
        });
        const charge = paymentIntent.latest_charge;
        if (charge && typeof charge === 'object' && charge.receipt_url) {
          receiptUrl = charge.receipt_url;
        }
      } catch (err) {
        console.error('[Webhook] Failed to fetch receipt URL:', err);
      }
    }
    if (session.invoice) {
      try {
        const invoice = await stripe.invoices.retrieve(session.invoice);
        if (invoice.hosted_invoice_url) invoiceUrl = invoice.hosted_invoice_url;
        if (invoice.invoice_pdf) invoicePdf = invoice.invoice_pdf;
      } catch (err) {
        console.error('[Webhook] Failed to fetch invoice URLs:', err);
      }
    }

    // 5. Send confirmation email (non-blocking — failures must not break the webhook)
    if (userEmail && eventData && allTickets.length > 0) {
      try {
        await sendOrderConfirmationEmail({
          to: userEmail,
          attendeeName: userName,
          orderId: order.id,
          eventTitle: eventData.title,
          eventDate: eventData.start_at,
          eventEndDate: eventData.end_at || undefined,
          venueName: eventData.venue_name || '',
          city: eventData.city || '',
          lineItems: tierSelections.map((s) => ({
            tierName: s.tierName,
            quantity: s.quantity,
            unitPrice: s.unitPrice,
          })),
          total: subtotal,
          currency: session.currency || 'cad',
          tickets: allTickets,
          receiptUrl,
          invoiceUrl,
          invoicePdf,
        });
        console.log('[Webhook] Confirmation email sent to:', userEmail);
      } catch (emailError) {
        console.error('[Webhook] Failed to send confirmation email:', emailError);
      }
    }

    console.log('[Webhook] ✅ Checkout fully processed for session:', session.id);
  } catch (error) {
    console.error('[Webhook] Critical error processing checkout:', error);
  }
}
