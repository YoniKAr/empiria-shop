import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReceiptData } from '@/lib/receiptData';

/**
 * Immutable snapshot for a Canadian CRA-style official donation receipt, stored
 * on `orders.donation_receipt_data` and rendered by `/receipt/[orderId]/donation`.
 * Written once at fulfillment (webhook / free-order path) for non-profit-owned
 * events that have donation receipts enabled. Amounts are DOLLARS, matching the
 * `orders` money columns.
 *
 * The `eligible_amount` is the tax-deductible gift: the ticket price (optionally
 * plus sales tax, per the event's basis), NEVER the platform/processing fees the
 * donor also paid — those are not a gift to the charity.
 */
export interface DonationReceiptData {
  version: 1;
  charity: {
    legal_name: string;
    address: string | null;
    registration_number: string;
    avatar_url: string | null;
  };
  donor: { name: string | null; email: string | null };
  event: { id: string; title: string; starts_at: string | null };
  /** The Empiria order receipt number (EMP-…) this donation receipt corresponds to. */
  order_ref: string;
  basis: 'ticket_only' | 'ticket_plus_tax';
  amount_paid: number;
  eligible_amount: number;
  gift_date: string;
  issued_at: string;
  place_of_issue: string | null;
}

/**
 * Best-effort place of issue: the last-but-one line/segment of the charity's
 * postal address (typically the city line, e.g. "Toronto, ON  M5V 2T6" → the
 * line before the country), falling back to the event's city, else null.
 */
function derivePlaceOfIssue(orgAddress: string | null, eventCity: string | null): string | null {
  const raw = (orgAddress ?? '').trim();
  if (raw) {
    const parts = raw
      .split(/[\n,]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2];
    if (parts.length === 1) return parts[0];
  }
  return eventCity && eventCity.trim() ? eventCity.trim() : null;
}

/**
 * Generate (idempotently) the donation-receipt snapshot for a fulfilled order.
 *
 * No-op (returns null) unless the event has donation receipts enabled AND its
 * owner is a non-profit organizer (not the platform admin) with a charitable
 * registration number. Skips if the order already carries a receipt number, so
 * the webhook can safely retry. All failures are swallowed (logged) — this must
 * never break order fulfillment.
 */
export async function generateDonationReceiptForOrder(
  supabase: SupabaseClient,
  orderId: string
): Promise<DonationReceiptData | null> {
  try {
    const { data: order } = await supabase
      .from('orders')
      .select(
        'id, event_id, total_amount, discount_amount, ticket_tax_amount, currency, buyer_name, buyer_email, created_at, receipt_number, receipt_data, donation_receipt_number'
      )
      .eq('id', orderId)
      .maybeSingle();
    if (!order) return null;

    // Idempotent: a receipt number is only ever assigned once.
    if (order.donation_receipt_number) return null;

    const { data: event } = await supabase
      .from('events')
      .select(
        'id, title, city, organizer_id, donation_receipts_enabled, donation_receipt_basis'
      )
      .eq('id', order.event_id)
      .maybeSingle();
    if (!event || event.donation_receipts_enabled !== true) return null;

    // Owner must be a non-profit organizer (never the platform admin).
    if (!event.organizer_id) return null;
    const { data: owner } = await supabase
      .from('users')
      .select('full_name, role, account_type, org_legal_name, org_address, charitable_registration_number, avatar_url')
      .eq('auth0_id', event.organizer_id)
      .maybeSingle();
    if (!owner) return null;
    if (owner.account_type !== 'non_profit' || owner.role === 'admin') return null;
    const registrationNumber = (owner.charitable_registration_number ?? '').trim();
    if (!registrationNumber) return null;

    // Eligible amount from the order's money columns — ticket price only, or
    // ticket price + sales tax, NEVER platform/processing fees.
    const { data: itemRows } = await supabase
      .from('order_items')
      .select('quantity, unit_price')
      .eq('order_id', orderId);
    const subtotal =
      Math.round(
        (itemRows ?? []).reduce((sum, it) => sum + Number(it.unit_price) * Number(it.quantity), 0) * 100
      ) / 100;
    const discount = Number(order.discount_amount || 0);
    const ticketTax = Number(order.ticket_tax_amount || 0);
    const basis: DonationReceiptData['basis'] =
      event.donation_receipt_basis === 'ticket_plus_tax' ? 'ticket_plus_tax' : 'ticket_only';
    const ticketOnly = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
    const eligibleAmount =
      basis === 'ticket_plus_tax' ? Math.round((ticketOnly + ticketTax) * 100) / 100 : ticketOnly;

    // Prefer the already-persisted receipt snapshot for event title / start.
    const snapshot = (order.receipt_data as ReceiptData | null) ?? null;
    let startsAt: string | null = snapshot?.event.starts_at ?? null;
    if (!startsAt) {
      const { data: occ } = await supabase
        .from('event_occurrences')
        .select('starts_at')
        .eq('event_id', event.id)
        .order('starts_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      startsAt = occ?.starts_at ?? null;
    }

    const legalName =
      (owner.org_legal_name ?? '').trim() || (owner.full_name ?? '').trim() || 'Empiria Events';
    const orderRef = order.receipt_number || `EMP-${orderId.slice(0, 8).toUpperCase()}`;

    const receiptData: DonationReceiptData = {
      version: 1,
      charity: {
        legal_name: legalName,
        address: (owner.org_address ?? '').trim() || null,
        registration_number: registrationNumber,
        avatar_url: owner.avatar_url ?? null,
      },
      donor: { name: order.buyer_name ?? null, email: order.buyer_email ?? null },
      event: {
        id: event.id,
        title: snapshot?.event.title || event.title || '',
        starts_at: startsAt,
      },
      order_ref: orderRef,
      basis,
      amount_paid: Number(order.total_amount || 0),
      eligible_amount: eligibleAmount,
      gift_date: order.created_at,
      issued_at: new Date().toISOString(),
      place_of_issue: derivePlaceOfIssue(owner.org_address ?? null, event.city ?? null),
    };

    // Reserve the serial only now that we know a receipt is warranted.
    const { data: serial, error: serialErr } = await supabase.rpc('next_donation_receipt_number');
    if (serialErr || !serial) {
      console.error('[DonationReceipt] serial RPC failed:', serialErr);
      return null;
    }

    const { error: updateErr } = await supabase
      .from('orders')
      .update({ donation_receipt_number: serial as string, donation_receipt_data: receiptData })
      .eq('id', orderId);
    if (updateErr) {
      console.error('[DonationReceipt] order update failed:', updateErr);
      return null;
    }

    return receiptData;
  } catch (err) {
    console.error('[DonationReceipt] generation failed:', err);
    return null;
  }
}
