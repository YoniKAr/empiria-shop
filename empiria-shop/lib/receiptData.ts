import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Immutable, marketplace-style receipt snapshot stored on `orders.receipt_data`.
 * Written once at fulfillment (webhook / free-order path) and rendered by
 * `/receipt/[orderId]`. Amounts are DOLLARS (numeric), matching the `orders`
 * money columns and the confirmation email's order-summary numbers.
 *
 * Fee reconciliation mirrors the confirmation email EXACTLY: the buyer-facing
 * `service_fee`/`service_fee_tax` are only populated in PASS mode (the buyer
 * paid them); in ABSORB mode the organizer eats them and they are 0 here.
 */
export interface ReceiptData {
  version: 1;
  seller: { name: string; is_platform: boolean; non_profit: boolean };
  event: {
    id: string;
    title: string;
    starts_at: string | null;
    timezone: string | null;
    venue_name: string | null;
    city: string | null;
  };
  items: Array<{ name: string; quantity: number; unit_price: number; amount: number }>;
  fees: {
    service_fee: number;
    service_fee_tax: number;
    ticket_tax: number;
    discount: number;
    coupon_code: string | null;
  };
  total: number;
  currency: string;
  buyer: { name: string | null; email: string | null };
  payment: { stripe_payment_intent_id: string | null };
}

/**
 * Resolve the seller block from the event owner's user row. Platform-owned
 * events (owner role 'admin') display as "Empiria Events"; a real organizer
 * displays their name, flagged non-profit when their account is.
 */
export function resolveSeller(
  owner: { full_name?: string | null; role?: string | null; account_type?: string | null } | null
): ReceiptData['seller'] {
  const isPlatform = owner?.role === 'admin';
  return {
    name: isPlatform ? 'Empiria Events' : owner?.full_name || 'Empiria Events',
    is_platform: isPlatform,
    non_profit: !isPlatform && owner?.account_type === 'non_profit',
  };
}

/**
 * Build the receipt snapshot for an order from DB joins. Used by the free-order
 * path and the backfill script to write `receipt_data`, and by the receipt page
 * as a live fallback for legacy orders whose snapshot is still null.
 *
 * Requires the order's `order_items` (and tickets, for the purchased date) to
 * already exist. Returns null if the order row can't be found.
 */
export async function buildReceiptDataFromOrder(
  supabase: SupabaseClient,
  orderId: string
): Promise<ReceiptData | null> {
  const { data: order } = await supabase
    .from('orders')
    .select(
      'id, event_id, total_amount, platform_fee_amount, platform_fee_tax_amount, ticket_tax_amount, discount_amount, coupon_id, buyer_name, buyer_email, currency, stripe_payment_intent_id, payout_breakdown'
    )
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return null;

  const pb = (order.payout_breakdown ?? {}) as { pass_processing_fee?: boolean; coupon_code?: string };
  const passProcessingFee = pb.pass_processing_fee === true;

  // Line items + tier names (resolved via a second query rather than a PostgREST
  // embed so a missing FK relationship can't fail the whole snapshot).
  const { data: itemRows } = await supabase
    .from('order_items')
    .select('quantity, unit_price, tier_id')
    .eq('order_id', orderId);
  const tierIds = [...new Set((itemRows ?? []).map((i) => i.tier_id).filter(Boolean))];
  const tierNames = new Map<string, string>();
  if (tierIds.length > 0) {
    const { data: tiers } = await supabase.from('ticket_tiers').select('id, name').in('id', tierIds);
    for (const t of tiers ?? []) tierNames.set(t.id, t.name);
  }

  const { data: event } = await supabase
    .from('events')
    .select('id, title, timezone, venue_name, city, organizer_id')
    .eq('id', order.event_id)
    .maybeSingle();

  // Purchased occurrence (from a ticket) → its start; fall back to the event's
  // earliest occurrence for single-date / legacy events.
  let startsAt: string | null = null;
  const { data: tk } = await supabase
    .from('tickets')
    .select('occurrence_id')
    .eq('order_id', orderId)
    .not('occurrence_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (tk?.occurrence_id) {
    const { data: occ } = await supabase
      .from('event_occurrences')
      .select('starts_at')
      .eq('id', tk.occurrence_id)
      .maybeSingle();
    startsAt = occ?.starts_at ?? null;
  }
  if (!startsAt && event?.id) {
    const { data: occ } = await supabase
      .from('event_occurrences')
      .select('starts_at')
      .eq('event_id', event.id)
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    startsAt = occ?.starts_at ?? null;
  }

  let owner: { full_name: string | null; role: string | null; account_type: string | null } | null = null;
  if (event?.organizer_id) {
    const { data } = await supabase
      .from('users')
      .select('full_name, role, account_type')
      .eq('auth0_id', event.organizer_id)
      .maybeSingle();
    owner = data ?? null;
  }

  let couponCode: string | null = pb.coupon_code || null;
  if (!couponCode && order.coupon_id) {
    const { data: coupon } = await supabase
      .from('coupons')
      .select('code')
      .eq('id', order.coupon_id)
      .maybeSingle();
    couponCode = coupon?.code ?? null;
  }

  const items = (itemRows ?? []).map((it) => ({
    name: tierNames.get(it.tier_id) ?? 'Ticket',
    quantity: it.quantity,
    unit_price: Number(it.unit_price),
    amount: Math.round(Number(it.unit_price) * it.quantity * 100) / 100,
  }));

  // Receipt arithmetic must reconcile: subtotal − discount + fees + taxes = total.
  // In PASS mode the buyer's total also carries the Stripe processing gross-up
  // (and any cross-border fee), which `platform_fee_amount` alone does not —
  // so the buyer-facing fee line is the exact residual (clamped ≥ 0).
  const subtotal = Math.round(items.reduce((sum, it) => sum + it.amount, 0) * 100) / 100;
  const total = Number(order.total_amount || 0);
  const ticketTax = Number(order.ticket_tax_amount || 0);
  const discount = Number(order.discount_amount || 0);
  const serviceFeeTax = passProcessingFee ? Number(order.platform_fee_tax_amount || 0) : 0;
  const serviceFee = passProcessingFee
    ? Math.max(0, Math.round((total - (subtotal - discount + ticketTax + serviceFeeTax)) * 100) / 100)
    : 0;

  return {
    version: 1,
    seller: resolveSeller(owner),
    event: {
      id: event?.id ?? order.event_id,
      title: event?.title ?? '',
      starts_at: startsAt,
      timezone: event?.timezone ?? null,
      venue_name: event?.venue_name ?? null,
      city: event?.city ?? null,
    },
    items,
    fees: {
      service_fee: serviceFee,
      service_fee_tax: serviceFeeTax,
      ticket_tax: ticketTax,
      discount,
      coupon_code: couponCode,
    },
    total,
    currency: order.currency || 'cad',
    buyer: { name: order.buyer_name ?? null, email: order.buyer_email ?? null },
    payment: { stripe_payment_intent_id: order.stripe_payment_intent_id ?? null },
  };
}
