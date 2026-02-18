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

export async function POST(request: NextRequest) {
  try {
    // 1. Parse request body
    const body = await request.json();
    const { eventId, tiers, contactEmail, contactName } = body as {
      eventId: string;
      tiers: TierSelection[];
      contactEmail?: string;
      contactName?: string;
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
      .select('id, title, slug, organizer_id, platform_fee_percent, platform_fee_fixed, currency, status, end_at, total_capacity, total_tickets_sold')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (event.status !== 'published') {
      return NextResponse.json({ error: 'Event is not available for purchase' }, { status: 400 });
    }

    if (new Date(event.end_at) < new Date()) {
      return NextResponse.json({ error: 'Event has already ended' }, { status: 400 });
    }

    // 4. Fetch organizer's Stripe Connect account
    const { data: organizer, error: orgError } = await supabase
      .from('users')
      .select('stripe_account_id, stripe_onboarding_completed, full_name')
      .eq('auth0_id', event.organizer_id)
      .single();

    if (orgError || !organizer?.stripe_account_id || !organizer.stripe_onboarding_completed) {
      return NextResponse.json(
        { error: 'This event\'s organizer has not completed payment setup. Please contact the organizer.' },
        { status: 400 }
      );
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

    // 7. Calculate platform fee
    const feePercent = Number(event.platform_fee_percent) || 5;
    const feeFixed = Number(event.platform_fee_fixed) || 0;
    const platformFee = subtotal * (feePercent / 100) + feeFixed;
    const platformFeeStripe = toStripeAmount(platformFee, event.currency || 'cad');
    const organizerPayout = subtotal - platformFee;

    // 8. Determine user identity
    const customerEmail = contactEmail || user?.email;
    const userId = user?.sub || `guest_${Date.now()}`;

    // 9. Build metadata for webhook processing
    const metadata = {
      event_id: eventId,
      user_auth0_id: user?.sub || '',
      user_email: customerEmail || '',
      user_name: contactName || user?.name || '',
      tier_selections: JSON.stringify(validatedSelections),
      platform_fee: platformFee.toFixed(2),
      organizer_payout: organizerPayout.toFixed(2),
      subtotal: subtotal.toFixed(2),
      source_app: 'shop',
    };

    // 10. Create Stripe Checkout Session
    const appBaseUrl = process.env.APP_BASE_URL || 'https://shop.empiriaindia.com';

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      ...(customerEmail && { customer_email: customerEmail }),
      invoice_creation: { enabled: true },
      payment_intent_data: {
        // Route funds to organizer's connected account
        application_fee_amount: platformFeeStripe,
        transfer_data: {
          destination: organizer.stripe_account_id,
        },
        metadata, // Also attach to PaymentIntent for reference
      },
      metadata, // Attach to session for webhook access
      success_url: `${appBaseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appBaseUrl}/events/${event.slug}`,
      expires_at: Math.floor(Date.now() / 1000) + 1800, // 30 minutes from now
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error: unknown) {
    console.error('[Checkout API Error]', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
