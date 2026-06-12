// Single source of truth for checkout money math. Pure, deterministic, cent-rounded.
export const STRIPE_PERCENT = 0.029;     // domestic card estimate; webhook reconciles with the real fee
export const STRIPE_FIXED = 0.30;        // CAD, per order
export const HST_RATE = 0.13;            // flat 13% HST, computed by us (not Stripe automatic_tax)
export const DEFAULT_FEE_PERCENT = 3.5;  // platform percentage fee
export const DEFAULT_FIXED_PER_TICKET = 1.60; // platform fixed fee per PAID ticket

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface FeeInput {
  base: number;              // ticket subtotal BEFORE discount
  discount: number;          // coupon discount applied to the ticket base (0 if none)
  paidTickets: number;       // count of tickets with price > 0
  chargeTicketTax: boolean;
  passProcessingFee: boolean;
  feePercent: number;        // event.platform_fee_percent ?? DEFAULT_FEE_PERCENT
  feeFixedPerTicket: number; // event.platform_fee_fixed   ?? DEFAULT_FIXED_PER_TICKET
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
  organizerPayout: number;  // pass-mode target (effBase + hstOnBase); absorb recomputed in webhook with actual fee
  empiriaKeep: number;      // platformFee + hstOnFee
  stripeFeeEstimate: number;
}

export function computeFees(input: FeeInput): FeeBreakdown {
  const { base, discount, paidTickets, chargeTicketTax, passProcessingFee, feePercent, feeFixedPerTicket } = input;

  const effBase = round2(Math.max(0, base - discount));
  const platformFee = round2(effBase * (feePercent / 100) + feeFixedPerTicket * paidTickets);
  const hstOnBase = chargeTicketTax ? round2(effBase * HST_RATE) : 0;
  const hstOnFee = round2(platformFee * HST_RATE);
  const hstTotal = round2(hstOnBase + hstOnFee);

  let customerTotal: number;
  let stripeOffset: number;
  let customerTax: number;

  if (passProcessingFee) {
    const netNeeded = round2(effBase + platformFee + hstTotal);
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

  return {
    effBase,
    platformFee,
    hstOnBase,
    hstOnFee,
    hstTotal,
    customerTax,
    stripeOffset,
    customerTotal,
    organizerPayout: round2(effBase + hstOnBase),
    empiriaKeep: round2(platformFee + hstOnFee),
    stripeFeeEstimate: round2(STRIPE_PERCENT * customerTotal + STRIPE_FIXED),
  };
}
