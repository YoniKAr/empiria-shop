// ──────────────────────────────────────────────────
// 📁 app/api/checkout/route.ts — NEW FILE (create this)
// Creates a Stripe Checkout Session with Connect payment routing
// ──────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getSafeSession } from '@/lib/auth0';
import { stripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase';
import { buildReceiptDataFromOrder } from '@/lib/receiptData';
import { toStripeAmount } from '@/lib/utils';
import { computeFees, computeCouponDiscount, DEFAULT_FEE_PERCENT, DEFAULT_FIXED_PER_TICKET, type CouponApplication } from '@/lib/fees';
import { computeCrossBorderShare, type PayoutRecipient } from '@/lib/crossBorder';
import { sendOrderConfirmationEmail } from '@/lib/email';
import { SHOP_URL } from '@/lib/urls';
import { migrateSeatingConfig } from '@/lib/migrate-seating-config';
import { clientIp, rateLimit } from '@/lib/ratelimit';

interface TierSelection {
  tierId: string;
  quantity: number;
}

interface SeatSelection {
  seatId: string;
  sectionId: string;
  label: string;
  /** Ticket tier purchased for this seat — validated against the zone the
   *  seat belongs to (S4). */
  tierId: string;
}

interface AssignedSeatSelection {
  label: string;
  tierId: string;
}

/** Holds are stored with seat_id composed as `${occurrenceId}:${seatId}` once a
 *  date is picked (mirrors useSeatHolds) — un-prefixed holds are event-wide. */
function composeHoldSeatId(seatId: string, occurrenceId?: string | null): string {
  return occurrenceId ? `${occurrenceId}:${seatId}` : seatId;
}

/** Active hold seat keys relevant to an occurrence scope (raw, prefix stripped).
 *  Holds for OTHER occurrences don't block this one. */
function heldKeysForScope(
  holds: Array<{ seat_id: string }>,
  occurrenceId?: string | null
): Set<string> {
  const out = new Set<string>();
  for (const h of holds) {
    const idx = h.seat_id.indexOf(':');
    if (idx === -1) {
      out.add(h.seat_id);
    } else if (!occurrenceId || h.seat_id.slice(0, idx) === occurrenceId) {
      out.add(h.seat_id.slice(idx + 1));
    }
  }
  return out;
}

/** True when `label` is `${range.prefix}<n>` with start <= n <= end. */
function labelInRange(
  range: { prefix: string; start: number; end: number },
  label: string
): boolean {
  if (!label.startsWith(range.prefix)) return false;
  const numPart = label.slice(range.prefix.length);
  if (!/^\d+$/.test(numPart)) return false;
  const n = Number.parseInt(numPart, 10);
  return n >= range.start && n <= range.end;
}

export async function POST(request: NextRequest) {
  // Holds the coupon id whose reservation must be released if this request throws
  // after reserving but before the Stripe session takes ownership. Cleared once the
  // session is created (then the webhook owns release on expiry/failure).
  let reservedCouponId: string | null = null;
  // Bound to getSupabaseAdmin() once available so the catch can issue the release.
  let supabaseForRelease: ReturnType<typeof getSupabaseAdmin> | null = null;
  try {
    // Throttle checkout creation per IP (30 / minute) — caps Stripe-session
    // spam and coupon/seat-validation hammering without affecting real buyers.
    if (!(await rateLimit(`checkout:${clientIp(request)}`, 30, 60))) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again in a moment.' },
        { status: 429 }
      );
    }

    // 1. Parse request body
    const body = await request.json();
    const { eventId, tiers, contactEmail, contactName, occurrenceId, seatSelections, sessionId, assignedSeats, couponCode, fieldResponses, attemptId } = body as {
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
      /** Per-submit-click uuid from the client — becomes the Stripe idempotency
       *  key on sessions.create so a duplicated/retried request can't mint two
       *  Checkout Sessions. */
      attemptId?: string;
    };

    if (!eventId || !tiers || tiers.length === 0) {
      return NextResponse.json(
        { error: 'Missing eventId or tier selections' },
        { status: 400 }
      );
    }

    // Contact fields flow into Stripe metadata (500-char/value hard cap — Stripe
    // REJECTS oversized values, it never truncates). Cap them well below.
    if (typeof contactEmail === 'string' && contactEmail.length > 200) {
      return NextResponse.json({ error: 'Email address is too long (200 characters max).' }, { status: 400 });
    }
    if (typeof contactName === 'string' && contactName.length > 200) {
      return NextResponse.json({ error: 'Name is too long (200 characters max).' }, { status: 400 });
    }

    // Sanitized per-attempt idempotency key. Missing/invalid (e.g. in-flight
    // requests from clients deployed before attemptId existed) → no key, which
    // preserves the old behavior.
    const attemptKey =
      typeof attemptId === 'string' && /^[A-Za-z0-9._-]{10,100}$/.test(attemptId)
        ? attemptId
        : null;

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

    // S5: multi-date events MUST say which date is being purchased — seat
    // availability, ticket validity and check-in are all per occurrence.
    const { count: futureOccCount } = await supabase
      .from('event_occurrences')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('is_cancelled', false)
      .gt('starts_at', new Date().toISOString());

    if ((futureOccCount ?? 0) > 1 && !occurrenceId) {
      return NextResponse.json(
        { error: 'Please select an event date for this multi-date event.' },
        { status: 400 }
      );
    }

    // S3: a seat_map order without seat selections would mint seatless tickets
    // for a seated event. Seat selections are only meaningful for seat_map.
    const isSeatMapOrder = event.seating_type === 'seat_map';
    if (isSeatMapOrder) {
      if (!seatSelections || seatSelections.length === 0) {
        return NextResponse.json(
          { error: 'Please pick your seats before checking out.' },
          { status: 400 }
        );
      }
      if (!sessionId) {
        return NextResponse.json(
          { error: 'Missing seat session. Please refresh and re-select your seats.' },
          { status: 400 }
        );
      }
    }
    // Ignore stray seat selections on non-seat_map events (they would otherwise
    // flow into ticket creation as arbitrary seat labels).
    const seatSel: SeatSelection[] | null =
      isSeatMapOrder && seatSelections ? seatSelections : null;

    // 4. Resolve the event owner. An event is "platform-owned" only when its owner is
    // an admin/platform account — NOT merely because it was created via the admin app.
    // Admins can create events on behalf of real organizers, who must still be paid.
    const { data: ownerData } = await supabase
      .from('users')
      .select('role, stripe_account_id, stripe_onboarding_completed, full_name, stripe_account_country')
      .eq('auth0_id', event.organizer_id)
      .single();

    const isPlatformEvent = ownerData?.role === 'admin';
    let organizer: { stripe_account_id: string | null; stripe_onboarding_completed: boolean | null; full_name: string | null; stripe_account_country: string | null } | null = null;

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
        stripe_account_country: ownerData.stripe_account_country ?? null,
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

    // Reject non-integer / non-positive quantities up front. A fractional quantity
    // (e.g. 2.5) passes min/max checks but desyncs money from tickets: the per-unit
    // discount loop emits ceil(q) units while ticket creation emits floor(q).
    for (const selection of tiers) {
      if (
        typeof selection.quantity !== 'number' ||
        !Number.isInteger(selection.quantity) ||
        selection.quantity <= 0
      ) {
        return NextResponse.json(
          { error: 'Ticket quantities must be whole numbers of at least 1' },
          { status: 400 }
        );
      }
    }

    // Aggregate duplicate tierId entries into ONE selection BEFORE validation
    // (mirrors the shared-capacity aggregate check below). Otherwise
    // [{tier,5},{tier,5}] each passes max_per_order/remaining_quantity alone
    // while the combined 10 bypasses both caps.
    const aggregatedQuantities = new Map<string, number>();
    for (const selection of tiers) {
      aggregatedQuantities.set(
        selection.tierId,
        (aggregatedQuantities.get(selection.tierId) ?? 0) + selection.quantity
      );
    }

    // Tier ids that belong to a HIDDEN (issue-only) zone — not publicly
    // purchasable, same treatment as a hidden tier (S7). Buyers see these zones
    // as grey/"Unavailable"; admins/organizers issue tickets to them instead.
    const hiddenZoneTierIds = new Set<string>();
    {
      const cfg = event.seating_config as { zones?: Array<{ is_hidden?: boolean; tier_id?: string; tiers?: Array<{ id?: string }> }> } | null;
      for (const z of cfg?.zones || []) {
        if (!z?.is_hidden) continue;
        if (z.tier_id) hiddenZoneTierIds.add(z.tier_id);
        for (const t of z.tiers || []) if (t?.id) hiddenZoneTierIds.add(t.id);
      }
    }

    for (const [selTierId, selQuantity] of aggregatedQuantities) {
      const tier = tierMap.get(selTierId);
      if (!tier) {
        return NextResponse.json({ error: `Tier ${selTierId} not found` }, { status: 400 });
      }

      if (tier.event_id !== eventId) {
        return NextResponse.json({ error: 'Tier does not belong to this event' }, { status: 400 });
      }

      // S7: hidden tiers — and tiers inside a hidden zone — are not publicly
      // purchasable.
      if (tier.is_hidden === true || hiddenZoneTierIds.has(selTierId)) {
        return NextResponse.json(
          { error: `"${tier.name}" is not available for purchase` },
          { status: 400 }
        );
      }

      const minQty = (tier as { min_per_order?: number }).min_per_order ?? 1;
      if (selQuantity < minQty || selQuantity > tier.max_per_order) {
        return NextResponse.json(
          { error: `Quantity for "${tier.name}" must be between ${minQty} and ${tier.max_per_order}` },
          { status: 400 }
        );
      }

      // In shared-capacity mode the per-tier remaining_quantity is seeded to equal
      // the event pool and is NOT the real constraint — the event pool is checked
      // after this loop. Skip the per-tier check in shared mode.
      if (!event.shared_capacity && tier.remaining_quantity < selQuantity) {
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

      const tierSubtotal = tier.price * selQuantity;
      subtotal += tierSubtotal;

      validatedSelections.push({
        tierId: tier.id,
        quantity: selQuantity,
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
        .select('id, code, discount_type, discount_value, max_discount_cap, application_mode, currency, is_active, starts_at, expires_at, max_uses, current_uses, max_uses_per_user, scope, event_id, category_id, created_by')
        .ilike('code', trimmedCode)
        .single();

      if (couponError || !coupon) {
        return NextResponse.json({ error: 'Invalid coupon code' }, { status: 400 });
      }

      if (!coupon.is_active) {
        return NextResponse.json({ error: 'This coupon is no longer active' }, { status: 400 });
      }

      // S15: a coupon denominated in another currency must not apply — its
      // flat amount / discount cap would be interpreted in the event currency.
      if (
        coupon.currency &&
        coupon.currency.toLowerCase() !== (event.currency || 'cad').toLowerCase()
      ) {
        return NextResponse.json(
          { error: 'This coupon is not valid for this event\'s currency' },
          { status: 400 }
        );
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

      // Calculate discount amount — per_order vs per_ticket. Single source of
      // truth in lib/fees.ts so the client preview matches the server charge.
      const applicationMode: CouponApplication =
        coupon.application_mode === 'per_ticket' ? 'per_ticket' : 'per_order';
      const couponLineItems = Array.from(aggregatedQuantities.entries()).map(
        ([tid, qty]) => ({ unitPrice: tierMap.get(tid)?.price ?? 0, quantity: qty })
      );
      // A per_order FLAT coupon still requires the order to cover it (existing
      // behavior). per_ticket clamps each unit to its price, so no order gate.
      if (
        coupon.discount_type !== 'percentage' &&
        applicationMode === 'per_order' &&
        subtotal < coupon.discount_value
      ) {
        return NextResponse.json({ error: 'Order subtotal is less than the coupon discount amount' }, { status: 400 });
      }
      discountAmount = computeCouponDiscount({
        discountType: coupon.discount_type,
        discountValue: coupon.discount_value,
        maxDiscountCap: coupon.max_discount_cap,
        applicationMode,
        lineItems: couponLineItems,
      });
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

    // 6b. seat_map: validate the submitted seats end-to-end before any money
    // moves (SHOP-1b / S4 / S5) — every seat must (a) exist in the event's
    // seating config under the claimed section with the claimed label, (b) be
    // purchased with a tier that belongs to that seat's zone, (c) not already
    // be sold for this occurrence, and (d) be actively held by THIS session.
    if (isSeatMapOrder && seatSel) {
      // Shape: every entry needs all four keys (tierId added for S4).
      for (const seat of seatSel) {
        if (!seat.seatId || !seat.sectionId || !seat.label || !seat.tierId) {
          await releaseCouponOnFailure();
          return NextResponse.json(
            { error: 'Invalid seat selection. Please refresh and re-select your seats.' },
            { status: 400 }
          );
        }
      }

      // No duplicate seats.
      if (
        new Set(seatSel.map((s) => s.seatId)).size !== seatSel.length ||
        new Set(seatSel.map((s) => s.label)).size !== seatSel.length
      ) {
        await releaseCouponOnFailure();
        return NextResponse.json({ error: 'Duplicate seats in selection' }, { status: 400 });
      }

      // Per-seat tiers must add up to exactly the purchased tier quantities.
      const seatTierCounts = new Map<string, number>();
      for (const seat of seatSel) {
        seatTierCounts.set(seat.tierId, (seatTierCounts.get(seat.tierId) ?? 0) + 1);
      }
      const tiersMatch =
        seatTierCounts.size === aggregatedQuantities.size &&
        [...aggregatedQuantities].every(([tid, qty]) => seatTierCounts.get(tid) === qty);
      if (!tiersMatch) {
        await releaseCouponOnFailure();
        return NextResponse.json(
          { error: 'Seat selections do not match the ticket quantities' },
          { status: 400 }
        );
      }

      // (a)+(b): resolve seats against the seating config. Legacy configs keep
      // seats inside zone polygons — migrateSeatingConfig synthesizes sections
      // the same way the shop viewers do. Tier membership resolves defensively
      // by id, then by the wizard-derived tier NAME ("Zone" / "Zone — Tier"),
      // mirroring SeatSelector.
      const migrated = migrateSeatingConfig(event.seating_config);
      const sections = migrated?.sections || [];
      if (sections.length === 0) {
        await releaseCouponOnFailure();
        return NextResponse.json(
          { error: 'This event has no seat map configured. Please contact the organizer.' },
          { status: 400 }
        );
      }

      const { data: allEventTiers } = await supabase
        .from('ticket_tiers')
        .select('id, name')
        .eq('event_id', eventId);
      const tierById = new Map((allEventTiers || []).map((t) => [t.id, t]));
      const tierByName = new Map(
        (allEventTiers || []).map((t) => [t.name.trim().toLowerCase(), t])
      );
      const resolveTierId = (
        tid: string | undefined,
        ...names: (string | undefined)[]
      ): string | undefined => {
        if (tid && tierById.has(tid)) return tid;
        for (const n of names) {
          const t = n ? tierByName.get(n.trim().toLowerCase()) : undefined;
          if (t) return t.id;
        }
        return undefined;
      };

      // Allowed (purchasable) ticket-tier ids per section. Zones share their id
      // with the synthesized section.
      const allowedTiersBySection = new Map<string, Set<string>>();
      for (const zone of migrated?.zones || []) {
        const allowed = new Set<string>();
        if (zone.tiers && zone.tiers.length > 0) {
          const multi = zone.tiers.length > 1;
          for (const zt of zone.tiers) {
            const rid = resolveTierId(zt.id, multi ? `${zone.name} — ${zt.name}` : zone.name);
            if (rid) allowed.add(rid);
          }
        } else {
          const rid = resolveTierId(zone.tier_id, zone.name);
          if (rid) allowed.add(rid);
        }
        allowedTiersBySection.set(zone.id, allowed);
      }
      for (const section of sections) {
        if (!allowedTiersBySection.has(section.id)) {
          const rid = resolveTierId(section.tier_id, section.name);
          allowedTiersBySection.set(section.id, new Set(rid ? [rid] : []));
        }
      }

      for (const seat of seatSel) {
        const section = sections.find((s) => s.id === seat.sectionId);
        const cfgSeat = section?.seats?.find((cs) => cs.id === seat.seatId);
        if (!section || !cfgSeat || cfgSeat.label !== seat.label) {
          await releaseCouponOnFailure();
          return NextResponse.json(
            { error: `Seat ${seat.label} does not exist for this event.` },
            { status: 400 }
          );
        }
        // Hidden (issue-only) sections are not purchasable by buyers.
        if (section.is_hidden === true) {
          await releaseCouponOnFailure();
          return NextResponse.json(
            { error: `Seat ${seat.label} is not available for purchase.` },
            { status: 400 }
          );
        }
        const allowed = allowedTiersBySection.get(section.id);
        if (!allowed || !allowed.has(seat.tierId)) {
          await releaseCouponOnFailure();
          return NextResponse.json(
            { error: `Seat ${seat.label} cannot be purchased with the selected ticket type.` },
            { status: 400 }
          );
        }
      }

      // (c) SHOP-1b: reject seats with a LIVE ticket (valid/used), scoped per
      // occurrence — a seat sold for occurrence A stays buyable for B; tickets
      // with no occurrence_id are event-wide. (The partial unique index
      // tickets_live_seat_unique is the race-condition backstop at insert.)
      let soldQuery = supabase
        .from('tickets')
        .select('seat_label')
        .eq('event_id', eventId)
        .in('status', ['valid', 'used'])
        .in('seat_label', seatSel.map((s) => s.label));
      if (occurrenceId) {
        soldQuery = soldQuery.or(`occurrence_id.eq.${occurrenceId},occurrence_id.is.null`);
      }
      const { data: soldRows, error: soldCheckError } = await soldQuery;
      if (soldCheckError) {
        await releaseCouponOnFailure();
        return NextResponse.json({ error: 'Failed to verify seat availability' }, { status: 500 });
      }
      if (soldRows && soldRows.length > 0) {
        await releaseCouponOnFailure();
        const taken = [...new Set(soldRows.map((r: any) => r.seat_label))].join(', ');
        return NextResponse.json(
          { error: `Seat${soldRows.length > 1 ? 's' : ''} ${taken} ${soldRows.length > 1 ? 'have' : 'has'} already been sold. Please pick different seats.` },
          { status: 409 }
        );
      }

      // (d) Verify each seat has a valid hold owned by this session. Holds are
      // stored occurrence-composed (`${occurrenceId}:${seatId}`) by the client.
      const { data: activeHolds, error: holdsError } = await supabase
        .from('seat_holds')
        .select('seat_id, session_id')
        .eq('event_id', eventId)
        .in('seat_id', seatSel.map((s) => composeHoldSeatId(s.seatId, occurrenceId)))
        .gt('expires_at', new Date().toISOString());

      if (holdsError) {
        await releaseCouponOnFailure();
        return NextResponse.json({ error: 'Failed to verify seat holds' }, { status: 500 });
      }

      const holdMap = new Map((activeHolds || []).map((h) => [h.seat_id, h.session_id]));

      for (const seat of seatSel) {
        const holdSession = holdMap.get(composeHoldSeatId(seat.seatId, occurrenceId));
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
          // User chose specific seats — validate shape, tier membership (S4),
          // quantity parity, and that they aren't sold (per occurrence) or held.
          for (const seat of assignedSeats) {
            if (!seat.label || !seat.tierId) {
              await releaseCouponOnFailure();
              return NextResponse.json(
                { error: 'Invalid seat selection. Please refresh and re-select your seats.' },
                { status: 400 }
              );
            }
            // S4: the label must fall inside one of the PURCHASED tier's
            // seat_ranges — rejects label poaching and cross-tier seats.
            const inTierRange = seatRanges.some(
              (r) => r.tier_id === seat.tierId && labelInRange(r, seat.label)
            );
            if (!inTierRange) {
              await releaseCouponOnFailure();
              return NextResponse.json(
                { error: `Seat ${seat.label} is not valid for the selected ticket type.` },
                { status: 400 }
              );
            }
          }

          const seatLabelsToCheck = assignedSeats.map((s) => s.label);
          if (new Set(seatLabelsToCheck).size !== seatLabelsToCheck.length) {
            await releaseCouponOnFailure();
            return NextResponse.json({ error: 'Duplicate seats in selection' }, { status: 400 });
          }

          // Per-seat tiers must add up to exactly the purchased tier quantities.
          const seatTierCounts = new Map<string, number>();
          for (const seat of assignedSeats) {
            seatTierCounts.set(seat.tierId, (seatTierCounts.get(seat.tierId) ?? 0) + 1);
          }
          const tiersMatch =
            seatTierCounts.size === aggregatedQuantities.size &&
            [...aggregatedQuantities].every(([tid, qty]) => seatTierCounts.get(tid) === qty);
          if (!tiersMatch) {
            await releaseCouponOnFailure();
            return NextResponse.json(
              { error: 'Seat selections do not match the ticket quantities' },
              { status: 400 }
            );
          }

          // Sold check is occurrence-scoped (S5); occurrence-less tickets are
          // event-wide and block every occurrence.
          let soldQuery = supabase
            .from('tickets')
            .select('seat_label')
            .eq('event_id', eventId)
            .not('seat_label', 'is', null)
            .in('status', ['valid', 'used']);
          if (occurrenceId) {
            soldQuery = soldQuery.or(`occurrence_id.eq.${occurrenceId},occurrence_id.is.null`);
          }
          const { data: soldTickets } = await soldQuery;

          const soldLabels = new Set(
            (soldTickets || []).map((t: any) => t.seat_label).filter(Boolean)
          );

          const { data: activeHolds } = await supabase
            .from('seat_holds')
            .select('seat_id')
            .eq('event_id', eventId)
            .gt('expires_at', new Date().toISOString());

          const heldLabels = heldKeysForScope(activeHolds || [], occurrenceId);

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

          // Get all sold/held labels — sold is occurrence-scoped (S5).
          let soldQuery = supabase
            .from('tickets')
            .select('seat_label')
            .eq('event_id', eventId)
            .not('seat_label', 'is', null)
            .in('status', ['valid', 'used']);
          if (occurrenceId) {
            soldQuery = soldQuery.or(`occurrence_id.eq.${occurrenceId},occurrence_id.is.null`);
          }
          const { data: soldTickets } = await soldQuery;

          const soldLabels = new Set(
            (soldTickets || []).map((t: any) => t.seat_label).filter(Boolean)
          );

          const { data: activeHolds } = await supabase
            .from('seat_holds')
            .select('seat_id')
            .eq('event_id', eventId)
            .gt('expires_at', new Date().toISOString());

          const heldLabels = heldKeysForScope(activeHolds || [], occurrenceId);

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

    // ── Cross-border payout fee (Stripe bills the platform 0.25% on transfers to
    // connected accounts outside Canada). Resolve every payout recipient and its
    // country here — BEFORE computeFees — so the fee is folded into the buyer
    // gross-up (PASS) or deducted from the foreign recipient (ABSORB). NULL /
    // unknown country is treated as 'CA' (no fee — fail-safe).
    //
    // Fetch the co-organizer splits ONCE here and reuse the rows where the splits
    // array is built later (section 7b) — do not query event_organizers twice.
    const { data: coOrganizerRows } = await supabase
      .from('event_organizers')
      .select('user_id, revenue_percentage, description, users:user_id(stripe_account_id, stripe_account_country)')
      .eq('event_id', eventId)
      .gt('revenue_percentage', 0);

    // Build the effective payout percentage allocation (mirrors the payout
    // pipeline): co-organizers get their revenue_percentage; the primary
    // organizer gets the remainder (single-organizer event = 100% primary).
    // Only recipients with a connected Stripe account can be paid — mirror the
    // splits filter so the percentages line up with real transfers. Elevsoft is
    // Canadian and is NOT a payout recipient here, so it never enters this math.
    const payableCoOrgs = (coOrganizerRows || []).filter(
      (r: any) => !!r.users?.stripe_account_id
    );
    const coOrgPctTotal = payableCoOrgs.reduce(
      (sum: number, r: any) => sum + Number(r.revenue_percentage || 0),
      0
    );
    const crossBorderRecipients: PayoutRecipient[] = payableCoOrgs.map((r: any) => ({
      stripeAccountId: r.users?.stripe_account_id,
      country: r.users?.stripe_account_country,
      percentage: Number(r.revenue_percentage || 0),
    }));
    // The primary organizer receives the remainder of the pool. On a platform
    // event there is no primary payout (Empiria keeps it), so only the
    // co-organizer splits count. On a normal event the primary gets
    // max(0, 100 - coOrgPctTotal) — including 100% for a single-organizer event.
    if (!isPlatformEvent && organizer?.stripe_account_id) {
      const primaryPct = Math.max(0, 100 - coOrgPctTotal);
      if (primaryPct > 0) {
        crossBorderRecipients.push({
          stripeAccountId: organizer.stripe_account_id,
          country: organizer.stripe_account_country,
          percentage: primaryPct,
        });
      }
    }
    const crossBorderShare = await computeCrossBorderShare(supabase, crossBorderRecipients);

    const fees = computeFees({
      base: subtotal,
      discount: discountAmount,
      paidTickets,
      chargeTicketTax,
      passProcessingFee,
      feePercent,
      feeFixedPerTicket,
      crossBorderShare,
    });

    // Stripe's minimum card charge is $0.50 (CAD/USD). A discounted-but-not-free
    // total below it cannot be charged — reject explicitly instead of silently
    // treating the order as free.
    if (fees.customerTotal > 0 && fees.customerTotal < 0.5) {
      await releaseCouponOnFailure();
      return NextResponse.json(
        {
          error: `The discounted total ($${fees.customerTotal.toFixed(2)} ${currency.toUpperCase()}) is below the $0.50 card-payment minimum. Please adjust your ticket quantity or use a different coupon.`,
        },
        { status: 400 }
      );
    }

    // ── FREE ORDER ($0 total): skip Stripe entirely, issue tickets directly ──
    // A genuinely free (or fully-discounted-to-$0) order cannot and should not go
    // through Stripe — Stripe rejects $0 charges, and there's no fee to collect.
    // Create the order + tickets inline (mirrors the webhook's fulfillment), then
    // send the buyer to the success page by order id.
    if (fees.customerTotal <= 0) {
      const appBaseUrl = process.env.APP_BASE_URL || SHOP_URL;
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
          // stripeOffset is the customer-paid processing offset; a free order never
          // touches Stripe so the engine returns 0 here — written explicitly.
          processing_fee_amount: fees.stripeOffset,
          ticket_tax_amount: 0,
          platform_fee_tax_amount: 0,
          stripe_fee_amount: 0,
          net_platform_revenue: 0,
          total_tickets: totalTickets,
          currency,
          buyer_email: freeEmail || null,
          buyer_name: freeName || null,
          // Full version-5 breakdown shape (parity with the webhook's keys) so
          // analytics reading breakdown fields uniformly never get undefined.
          // All money fields are 0 — nothing was charged or transferred.
          payout_breakdown: {
            version: 5,
            free_order: true,
            subtotal,
            eff_base: fees.effBase,
            customer_total: 0,
            pass_processing_fee: passProcessingFee,
            charge_ticket_tax: chargeTicketTax,
            total_tickets: totalTickets,
            platform_fee_fixed_semantics: 'per_ticket',
            platform_fee_percent: feePercent,
            platform_fee_fixed: feeFixedPerTicket,
            platform_fee: 0,
            hst_on_base: 0,
            hst_on_fee: 0,
            empiria_keep: 0,
            stripe_offset: 0,
            stripe_fee: 0,
            stripe_gap: 0,
            platform_take_home: 0,
            discount_amount: discountAmount,
            coupon_code: couponCode_validated || '',
            organizer_payout: 0,
            transfer_group: null,
            organizer_transfer_id: null,
            splits: null,
            elevsoft_transfer: null,
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
      const seatLabelQueue: string[] = seatSel && seatSel.length > 0
        ? seatSel.map((s: SeatSelection) => s.label)
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

      // 3. Release seat holds (seat_map) — holds are stored occurrence-composed
      if (seatSel && seatSel.length > 0) {
        await supabase
          .from('seat_holds')
          .delete()
          .eq('event_id', event.id)
          .in('seat_id', seatSel.map((s: SeatSelection) => composeHoldSeatId(s.seatId, occurrenceId)));
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

      // 4b. Persist the immutable receipt snapshot (no Stripe artifacts — a free
      // order never touches Stripe). Built from the now-created order + items;
      // failure is non-fatal (the backfill recovers it).
      try {
        const freeReceiptData = await buildReceiptDataFromOrder(supabase, freeOrder.id);
        if (freeReceiptData) {
          await supabase.from('orders').update({ receipt_data: freeReceiptData }).eq('id', freeOrder.id);
        }
      } catch (receiptErr) {
        console.error('[Checkout] Free order receipt snapshot failed:', receiptErr);
      }

      // 5. Confirmation email (non-blocking)
      if (freeEmail && freeTickets.length > 0) {
        try {
          const { data: emailEvent } = await supabase
            .from('events')
            .select('title, venue_name, city, location_type, meeting_link, cta_label, timezone, refund_policy')
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
            // Host name + avatar (role-based: platform-owned → Empiria Events +
            // platform avatar; otherwise the real organizer's name + photo).
            let freeOrganizerName = 'Empiria Events';
            let freeOrganizerAvatarUrl: string | null = null;
            if (event.organizer_id) {
              const { data: op } = await supabase
                .from('users')
                .select('full_name, role, avatar_url')
                .eq('auth0_id', event.organizer_id)
                .single();
              if (op?.role === 'admin') {
                const { data: ps } = await supabase
                  .from('platform_settings')
                  .select('value')
                  .eq('key', 'platform_avatar_url')
                  .maybeSingle();
                freeOrganizerAvatarUrl = (ps?.value as { url?: string | null } | null)?.url || null;
              } else {
                freeOrganizerName = op?.full_name || 'Empiria Events';
                freeOrganizerAvatarUrl = op?.avatar_url || null;
              }
            }
            await sendOrderConfirmationEmail({
              to: freeEmail,
              attendeeName: freeName,
              orderId: freeOrder.id,
              eventTitle: emailEvent.title,
              organizerName: freeOrganizerName,
              organizerAvatarUrl: freeOrganizerAvatarUrl,
              eventDate: startDate,
              eventEndDate: endDate,
              eventTimezone: emailEvent.timezone,
              venueName: emailEvent.venue_name || '',
              city: emailEvent.city || '',
              meetingLink: emailEvent.meeting_link || '',
              locationType: emailEvent.location_type || 'physical',
              refundPolicy: emailEvent.refund_policy,
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

    // Stripe caps Checkout Sessions at 100 line items. Without a discount each
    // TIER is one line; with a discount every TICKET becomes its own line (the
    // per-unit discount allocation below) — plus up to 3 fee lines. Guard with
    // headroom at 95 rather than letting Stripe reject the session opaquely.
    const projectedLineCount =
      (discountAmount > 0 ? totalTickets : validatedSelections.length) + 3;
    if (projectedLineCount > 95) {
      await releaseCouponOnFailure();
      return NextResponse.json(
        {
          error: discountAmount > 0
            ? 'Too many tickets for a single discounted order. Please reduce the quantity or split your purchase into multiple orders.'
            : 'Too many ticket types in a single order. Please split your purchase into multiple orders.',
        },
        { status: 400 }
      );
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
      // Bake the discount into per-unit ticket lines so sum(ticket lines) === fees.effBase
      // exactly. No Stripe coupon. The discount (and its cent remainder) is allocated
      // across PAID units only — free ($0) units always emit at 0¢. (Dumping the remainder
      // on the last unit overall could land it on a free unit, where the 0-clamp swallows
      // it and the line-item sum exceeds fees.customerTotal by 1-2¢.)
      const baseCents = Math.round(subtotal * 100);
      const discountCents = Math.round(discountAmount * 100);
      const units: Array<{ name: string; cents: number; discount: number }> = [];
      for (const sel of validatedSelections) {
        for (let i = 0; i < sel.quantity; i++) {
          units.push({ name: `${sel.tierName} — ${event.title}`, cents: Math.round(sel.unitPrice * 100), discount: 0 });
        }
      }
      const paidUnits = units.filter((u) => u.cents > 0);
      // Pass 1: proportional floor allocation per paid unit, capped at the unit's price.
      // (Floors never over-allocate; total paid capacity is baseCents, so the cap on
      // the discount keeps the leftover always placeable in pass 2.)
      let remainingDiscount = Math.min(discountCents, baseCents);
      for (const u of paidUnits) {
        const d = Math.min(u.cents, Math.floor((discountCents * u.cents) / baseCents));
        u.discount = d;
        remainingDiscount -= d;
      }
      // Pass 2: distribute the leftover cents across paid units that still have capacity.
      for (const u of paidUnits) {
        if (remainingDiscount <= 0) break;
        const add = Math.min(remainingDiscount, u.cents - u.discount);
        u.discount += add;
        remainingDiscount -= add;
      }
      for (const u of units) {
        lineItems.push({
          price_data: { currency, product_data: { name: u.name }, unit_amount: u.cents - u.discount },
          quantity: 1,
        });
      }
    }

    // Ticket tax only (HST on the ticket price). The HST on the platform fee is
    // folded into the single combined "Fees" line below — matching the on-site
    // checkout summary so Stripe shows the same line breakdown.
    if (fees.hstOnBase > 0) {
      lineItems.push({
        price_data: { currency, product_data: { name: 'Tax (HST 13%)' }, unit_amount: toStripeAmount(fees.hstOnBase, currency) },
        quantity: 1,
      });
    }
    // One combined fee line = platform (service) fee + its HST + card processing.
    if (passProcessingFee) {
      const feesLineTotal = Math.round((fees.platformFee + fees.hstOnFee + fees.stripeOffset) * 100) / 100;
      if (feesLineTotal > 0) {
        lineItems.push({
          price_data: {
            currency,
            product_data: { name: 'Fees', description: 'Platform fee and payment processing fee' },
            unit_amount: toStripeAmount(feesLineTotal, currency),
          },
          quantity: 1,
        });
      }
    }

    // 7b. Multi-organizer revenue splits (co-organizers with a revenue share).
    // NOTE: coOrganizerRows was already fetched above (for the cross-border share)
    // — reuse it here rather than querying event_organizers a second time.
    //
    // Map co-organizers to the shape the payout pipeline expects (only those with a
    // connected Stripe account can actually receive a transfer). recipient_country
    // rides along so the webhook can deduct each foreign recipient's proportional
    // cross-border fee from THEIR transfer (ABSORB mode).
    const splits = (coOrganizerRows || [])
      .map((row: any) => ({
        recipient_user_id: row.user_id,
        recipient_stripe_id: row.users?.stripe_account_id ?? null,
        recipient_country: (row.users?.stripe_account_country ?? null) as string | null,
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
        recipient_country: organizer.stripe_account_country ?? null,
        percentage: Math.max(0, 100 - coOrgPctTotal),
        description: 'Primary organizer',
      });
    }

    const hasMultiSplit = splits && splits.length > 0;
    // Derive the transfer group from the attempt key when present so an
    // idempotent retry of the SAME attempt sends Stripe byte-identical params
    // (same idempotency key + different params = Stripe idempotency_error).
    const transferGroup = attemptKey
      ? `evt_${eventId.slice(0, 8)}_${attemptKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 16)}`
      : `evt_${eventId.slice(0, 8)}_${Date.now()}`;

    // 8. Determine user identity
    const customerEmail = contactEmail || user?.email;
    const userId = user?.sub || `guest_${Date.now()}`;

    // 9. Build metadata for webhook processing.
    // ⚠️ Stripe metadata is hard-capped at 500 chars PER VALUE and Stripe
    // REJECTS oversized values (it never truncates) — serialized arrays
    // (tier_selections, seat_selections, splits) blow past 500 at realistic
    // sizes (3+ seats, ~4-5 tiers, ~4 split recipients). So the large arrays
    // are ALWAYS staged in the checkout_payloads table (keyed by session id,
    // inserted right after sessions.create below) and metadata carries only
    // small scalars + the payload_staged flag. The webhook keeps metadata
    // parsing as a fallback for in-flight sessions created before this deploy.
    const metadata: Record<string, string> = {
      event_id: eventId,
      user_auth0_id: user?.sub || '',
      user_email: customerEmail || '',
      user_name: (contactName || user?.name || '').slice(0, 200),
      payload_staged: 'true',
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
      cross_border_fee: fees.crossBorderFee.toFixed(2),
      cross_border_share: String(crossBorderShare),
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
    // Organizer's connected-account country — lets the webhook deduct the whole
    // cross-border fee off the single-organizer transfer (ABSORB) when foreign.
    metadata.organizer_stripe_country = organizer?.stripe_account_country || '';
    if (seatSel && seatSel.length > 0) {
      metadata.seat_session_id = sessionId || '';
    }

    // The staged payload (inserted into checkout_payloads keyed by the session
    // id, right after sessions.create). The webhook reads these arrays from the
    // staging row — NOT from metadata — when payload_staged === 'true'.
    // Seat selections: seatId is the occurrence-composed HOLD key so the
    // webhook's post-payment hold cleanup (.in('seat_id', …seatId)) deletes the
    // actual rows; tickets use `label`.
    const stagedCheckoutPayload = {
      tier_selections: validatedSelections,
      seat_selections:
        seatSel && seatSel.length > 0
          ? seatSel.map((s) => ({ ...s, seatId: composeHoldSeatId(s.seatId, occurrenceId) }))
          : null,
      assigned_seats:
        resolvedAssignedSeats && resolvedAssignedSeats.length > 0
          ? resolvedAssignedSeats.map((s) => s.label)
          : null,
      splits: hasMultiSplit ? splits : null,
    };

    // 10. Create Stripe Checkout Session
    const appBaseUrl = process.env.APP_BASE_URL || SHOP_URL;

    let checkoutSession;

    // Card-statement identity (marketplace transparency): the PaymentIntent
    // `description` names the event + seller, and `statement_descriptor_suffix`
    // puts the seller (or the event, for platform-owned events) on the buyer's
    // card line. Sanitize the suffix to Stripe's allowed charset (letters/digits/
    // spaces, ≥1 letter, ≤12 chars, uppercased) and omit it if nothing survives.
    const organizerDisplayName = isPlatformEvent
      ? 'Empiria Events'
      : ownerData?.full_name || 'Empiria Events';
    const piDescription = `${event.title} — ${organizerDisplayName}`.slice(0, 500);
    const descriptorSuffix = (isPlatformEvent ? event.title : organizerDisplayName)
      .replace(/[^A-Za-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12)
      .toUpperCase();
    const hasDescriptorLetter = /[A-Za-z]/.test(descriptorSuffix);

    // Unified checkout: all charges land on platform account.
    // Transfers to organizer/partners happen in the webhook.
    // Tax stays on platform for remittance.
    checkoutSession = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: lineItems,
        ...(customerEmail && { customer_email: customerEmail }),
        payment_intent_data: {
          transfer_group: transferGroup,
          metadata,
          description: piDescription,
          ...(hasDescriptorLetter && descriptorSuffix ? { statement_descriptor_suffix: descriptorSuffix } : {}),
        },
        metadata,
        success_url: `${appBaseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appBaseUrl}/events/${event.slug}`,
        // 35 min — Stripe's documented minimum is 30 and sitting at the exact
        // floor risks rejection from clock skew. The base is rounded UP to a
        // 5-minute boundary so an idempotent retry of the same attempt sends
        // identical params (see idempotencyKey below).
        expires_at: Math.ceil(Date.now() / 1000 / 300) * 300 + 35 * 60,
      },
      // One key per submit click → a network-level duplicate of this request
      // returns the SAME session instead of creating a second one.
      attemptKey ? { idempotencyKey: `checkout_${attemptKey}` } : undefined
    );

    // From here on, the coupon reservation is owned by the Stripe session lifecycle:
    // it is released by the webhook on checkout.session.expired / payment_intent.payment_failed,
    // or consumed by the completed order. So stop releasing it on this request's failures.
    reservedCouponId = null;

    // Stage the large checkout payload keyed by the session id. This row is
    // LOAD-BEARING (metadata no longer carries the arrays): if it can't be
    // written the webhook could never fulfill the session, so expire the
    // session (fires checkout.session.expired → coupon reservation released)
    // and fail the request instead of redirecting the customer to a checkout
    // that can't be completed. Upsert: an idempotent Stripe retry of the same
    // attempt returns the SAME session id, which must not violate the unique
    // constraint on stripe_checkout_session_id.
    const { error: payloadStageError } = await supabase
      .from('checkout_payloads')
      .upsert(
        { stripe_checkout_session_id: checkoutSession.id, payload: stagedCheckoutPayload },
        { onConflict: 'stripe_checkout_session_id' }
      );
    if (payloadStageError) {
      console.error('[Checkout] Failed to stage checkout payload:', payloadStageError);
      try {
        await stripe.checkout.sessions.expire(checkoutSession.id);
      } catch (expireErr) {
        console.error('[Checkout] Failed to expire unstageable session:', expireErr);
      }
      return NextResponse.json(
        { error: 'Could not start checkout. Please try again.' },
        { status: 500 }
      );
    }

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
