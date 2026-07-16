// Single source of truth for checkout money math. Pure, deterministic, cent-rounded.
export const STRIPE_PERCENT = 0.029;     // domestic card estimate; webhook reconciles with the real fee
export const STRIPE_FIXED = 0.30;        // CAD, per order
export const HST_RATE = 0.13;            // flat 13% HST, computed by us (not Stripe automatic_tax)
export const DEFAULT_FEE_PERCENT = 0.6;  // platform percentage fee
export const DEFAULT_FIXED_PER_TICKET = 1.35; // platform fixed fee per PAID ticket
// Stripe's cross-border payout fee: 0.25% of every transfer to a connected
// account in a country other than the platform's (Canada). Empiria must never
// eat this — in PASS mode the buyer covers it via the gross-up; in ABSORB mode
// it is deducted from the foreign recipient's transfer.
// https://stripe.com/docs/connect/cross-border-payouts (0.25% cross-border fee)
export const XBORDER_RATE = 0.0025;

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Coupon discount ─────────────────────────────────────────────────────────
// Single source of truth for how a coupon's discount is computed. Used by the
// checkout route (authoritative) AND every client-side preview, so the number a
// buyer sees always matches what the server charges.
export type CouponApplication = 'per_order' | 'per_ticket';

export interface CouponDiscountInput {
  discountType: 'percentage' | 'flat' | string;
  discountValue: number;
  maxDiscountCap: number | null;
  applicationMode: CouponApplication;
  /** Paid ticket line items: unit price × quantity. Free units (price 0) are
   *  harmless (they contribute 0). */
  lineItems: { unitPrice: number; quantity: number }[];
}

/**
 * Compute the coupon discount amount (cent-rounded), clamped so it never
 * exceeds the order subtotal (and, per-ticket, never exceeds each ticket price).
 *
 * - per_order   percentage → subtotal × v%, capped once at maxDiscountCap.
 * - per_order   flat       → v (once), clamped to subtotal.
 * - per_ticket  percentage → Σ over units of min(unitPrice × v%, cap, unitPrice).
 * - per_ticket  flat       → Σ over units of min(v, unitPrice)  (≈ v × #tickets).
 */
export function computeCouponDiscount(input: CouponDiscountInput): number {
  const { discountType, discountValue, maxDiscountCap, applicationMode, lineItems } = input;
  const subtotal = lineItems.reduce((s, li) => s + li.unitPrice * li.quantity, 0);
  if (subtotal <= 0 || !discountValue || discountValue <= 0) return 0;

  let discount = 0;
  if (applicationMode === 'per_ticket') {
    for (const li of lineItems) {
      for (let i = 0; i < li.quantity; i++) {
        let unit =
          discountType === 'percentage'
            ? li.unitPrice * (discountValue / 100)
            : discountValue;
        if (maxDiscountCap != null) unit = Math.min(unit, maxDiscountCap);
        unit = Math.min(unit, li.unitPrice); // never more than the ticket costs
        discount += unit;
      }
    }
  } else {
    if (discountType === 'percentage') {
      discount = subtotal * (discountValue / 100);
      if (maxDiscountCap != null) discount = Math.min(discount, maxDiscountCap);
    } else {
      discount = discountValue;
    }
    discount = Math.min(discount, subtotal);
  }
  return round2(Math.max(0, discount));
}

export interface FeeInput {
  base: number;              // ticket subtotal BEFORE discount
  discount: number;          // coupon discount applied to the ticket base (0 if none)
  paidTickets: number;       // count of tickets with price > 0
  chargeTicketTax: boolean;
  passProcessingFee: boolean;
  feePercent: number;        // event.platform_fee_percent ?? DEFAULT_FEE_PERCENT
  feeFixedPerTicket: number; // event.platform_fee_fixed   ?? DEFAULT_FIXED_PER_TICKET
  /** Fraction (0..1) of the organizer payout pool going to non-Canadian
   *  connected accounts. Drives the Stripe cross-border payout fee. Default 0
   *  (all-Canadian) → crossBorderFee is exactly 0 and every field is identical
   *  to the no-cross-border behavior. */
  crossBorderShare?: number;
}

export interface FeeBreakdown {
  effBase: number;          // base - discount (what the customer pays for tickets)
  platformFee: number;      // Empiria revenue
  hstOnBase: number;        // 13% on effBase (0 if !chargeTicketTax)
  hstOnFee: number;         // 13% on platformFee (always)
  hstTotal: number;         // hstOnBase + hstOnFee
  customerTax: number;      // tax the CUSTOMER pays: pass -> hstTotal, absorb -> hstOnBase
  stripeOffset: number;     // gross-up so net after Stripe covers effBase+platformFee+hstTotal (0 in absorb)
  customerTotal: number;    // exact amount charged
  organizerPayout: number;  // pass: guaranteed effBase + hstOnBase, LESS crossBorderFee in
                            // absorb. absorb: ESTIMATE of customerTotal - stripeFeeEstimate -
                            // platformFee - hstOnFee, then minus crossBorderFee, clamped at 0
                            // (sub-$2 tickets can't cover the fees); the webhook recomputes
                            // absorb with the ACTUAL Stripe fee.
  empiriaKeep: number;      // platformFee + hstOnFee (crossBorderFee is NOT take-home)
  crossBorderFee: number;   // Stripe's 0.25% cross-border payout fee on foreign transfers.
                            // pass: covered by the buyer via the gross-up (pass-through, not
                            // take-home). absorb: deducted from organizerPayout. 0 when all
                            // recipients are Canadian.
  stripeFeeEstimate: number;
}

export function computeFees(input: FeeInput): FeeBreakdown {
  const { base, discount, paidTickets, chargeTicketTax, passProcessingFee, feePercent, feeFixedPerTicket } = input;
  // Fraction of the payout going to non-Canadian accounts. Clamped to [0,1];
  // 0 (the default) makes every cross-border term below vanish, so output is
  // byte-identical to the pre-cross-border engine for all-Canadian events.
  const crossBorderShare = Math.min(1, Math.max(0, input.crossBorderShare ?? 0));

  const effBase = round2(Math.max(0, base - discount));
  // A fully-discounted order (e.g. a 100%-off coupon) has no ticket revenue, so the
  // platform takes no cut — the fixed per-ticket fee must NOT survive, otherwise a
  // buyer who owes $0 still gets charged the per-ticket fee + its HST + Stripe gross-up.
  // Any remaining ticket revenue keeps the normal percentage + per-ticket fee.
  const platformFee =
    effBase <= 0 ? 0 : round2(effBase * (feePercent / 100) + feeFixedPerTicket * paidTickets);
  const hstOnBase = chargeTicketTax ? round2(effBase * HST_RATE) : 0;
  const hstOnFee = round2(platformFee * HST_RATE);
  const hstTotal = round2(hstOnBase + hstOnFee);

  let customerTotal: number;
  let stripeOffset: number;
  let customerTax: number;
  // Cross-border payout fee (Stripe bills the platform 0.25% on foreign
  // transfers). In PASS mode the payout pool is the guaranteed effBase+hstOnBase;
  // in ABSORB it is the estimated organizerPayout (computed after customerTotal).
  // Set to 0 when crossBorderShare is 0 → no effect on any downstream field.
  let crossBorderFee = 0;

  if (passProcessingFee) {
    crossBorderFee = round2(XBORDER_RATE * (effBase + hstOnBase) * crossBorderShare);
    // Fold the cross-border fee into the amount being grossed up so the buyer
    // covers it net of Stripe's percentage and the platform actually nets it as
    // a pass-through (it is NOT platform take-home). When crossBorderFee is 0
    // this reduces to the original netNeeded exactly.
    const netNeeded = round2(effBase + platformFee + hstTotal + crossBorderFee);
    if (netNeeded <= 0) {
      // Nothing is owed (fully free order) — it never touches Stripe, so there is
      // no processing fee to pass on. Total stays $0, not the grossed-up $0.30.
      customerTotal = 0;
      stripeOffset = 0;
    } else {
      customerTotal = round2((netNeeded + STRIPE_FIXED) / (1 - STRIPE_PERCENT));
      stripeOffset = round2(customerTotal - netNeeded);
    }
    customerTax = hstTotal;
  } else {
    customerTax = hstOnBase;
    customerTotal = round2(effBase + hstOnBase);
    stripeOffset = 0;
  }

  const stripeFeeEstimate = round2(STRIPE_PERCENT * customerTotal + STRIPE_FIXED);

  // Organizer payout. PASS is a guarantee: ticket revenue + ticket tax. ABSORB is an
  // estimate: the organizer eats the platform fee, its HST, and the Stripe fee — for
  // sub-$2 tickets those can exceed the customer total, so clamp at 0 so no caller
  // ever sees a negative payout. (The webhook recomputes absorb with the actual
  // Stripe fee and applies the same clamp; Empiria absorbs any shortfall.)
  let organizerPayout = passProcessingFee
    ? round2(effBase + hstOnBase)
    : Math.max(0, round2(customerTotal - stripeFeeEstimate - platformFee - hstOnFee));

  if (!passProcessingFee) {
    // ABSORB: the cross-border fee is computed on the (pre-fee) organizer payout
    // and deducted from it — customerTotal is unchanged, the organizer eats it.
    // When crossBorderShare is 0 this is 0 and organizerPayout is untouched.
    crossBorderFee = round2(XBORDER_RATE * organizerPayout * crossBorderShare);
    organizerPayout = Math.max(0, round2(organizerPayout - crossBorderFee));
  }

  return {
    effBase,
    platformFee,
    hstOnBase,
    hstOnFee,
    hstTotal,
    customerTax,
    stripeOffset,
    customerTotal,
    organizerPayout,
    empiriaKeep: round2(platformFee + hstOnFee),
    crossBorderFee,
    stripeFeeEstimate,
  };
}
