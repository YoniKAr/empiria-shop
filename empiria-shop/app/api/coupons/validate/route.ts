// ──────────────────────────────────────────────────
// app/api/coupons/validate/route.ts
// Validates a coupon code for a given event
// ──────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getSafeSession } from '@/lib/auth0';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, eventId, userId: passedUserId } = body as {
      code: string;
      eventId: string;
      userId?: string;
    };

    if (!code || !eventId) {
      return NextResponse.json(
        { valid: false, error: 'Missing coupon code or event ID' },
        { status: 400 }
      );
    }

    // Get authenticated user (optional — guests can use coupons too)
    const session = await getSafeSession();
    const userId = passedUserId || session?.user?.sub || null;

    const supabase = getSupabaseAdmin();

    // 1. Look up coupon by code (case-insensitive)
    const { data: coupon, error: couponError } = await supabase
      .from('coupons')
      .select('id, code, discount_type, discount_value, max_discount_cap, currency, is_active, starts_at, expires_at, max_uses, current_uses, max_uses_per_user, scope, event_id, category_id, created_by')
      .ilike('code', code.trim())
      .single();

    if (couponError || !coupon) {
      return NextResponse.json(
        { valid: false, error: 'Invalid coupon code' },
        { status: 200 }
      );
    }

    // 2. Check is_active
    if (!coupon.is_active) {
      return NextResponse.json(
        { valid: false, error: 'This coupon is no longer active' },
        { status: 200 }
      );
    }

    // 3. Check validity window (starts_at / expires_at)
    const now = new Date();

    if (coupon.starts_at && new Date(coupon.starts_at) > now) {
      return NextResponse.json(
        { valid: false, error: 'This coupon is not yet active' },
        { status: 200 }
      );
    }

    if (coupon.expires_at && new Date(coupon.expires_at) < now) {
      return NextResponse.json(
        { valid: false, error: 'This coupon has expired' },
        { status: 200 }
      );
    }

    // 4. Check max_uses not exceeded
    if (coupon.max_uses !== null && coupon.current_uses >= coupon.max_uses) {
      return NextResponse.json(
        { valid: false, error: 'This coupon has reached its usage limit' },
        { status: 200 }
      );
    }

    // 5. Check scope matches the event
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, organizer_id, category_id, currency')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json(
        { valid: false, error: 'Event not found' },
        { status: 200 }
      );
    }

    // 5a. Currency must match the event (S15): a flat amount / discount cap in
    // another currency would silently apply at the event-currency face value.
    if (
      coupon.currency &&
      coupon.currency.toLowerCase() !== (event.currency || 'cad').toLowerCase()
    ) {
      return NextResponse.json(
        { valid: false, error: "This coupon is not valid for this event's currency" },
        { status: 200 }
      );
    }

    switch (coupon.scope) {
      case 'event':
        if (coupon.event_id !== eventId) {
          return NextResponse.json(
            { valid: false, error: 'This coupon is not valid for this event' },
            { status: 200 }
          );
        }
        break;

      case 'organizer_all':
        if (coupon.created_by !== event.organizer_id) {
          return NextResponse.json(
            { valid: false, error: 'This coupon is not valid for this event' },
            { status: 200 }
          );
        }
        break;

      case 'platform_all':
        // Always valid for any event
        break;

      case 'category':
        if (coupon.category_id !== event.category_id) {
          return NextResponse.json(
            { valid: false, error: 'This coupon is not valid for this event category' },
            { status: 200 }
          );
        }
        break;

      default:
        return NextResponse.json(
          { valid: false, error: 'Invalid coupon scope' },
          { status: 200 }
        );
    }

    // 6. Check per-user limit (skip for guests)
    if (userId && coupon.max_uses_per_user !== null) {
      const { count, error: usageError } = await supabase
        .from('coupon_usages')
        .select('id', { count: 'exact', head: true })
        .eq('coupon_id', coupon.id)
        .eq('user_id', userId);

      if (!usageError && count !== null && count >= coupon.max_uses_per_user) {
        return NextResponse.json(
          { valid: false, error: 'You have already used this coupon the maximum number of times' },
          { status: 200 }
        );
      }
    }

    // 7. Valid — return coupon details
    return NextResponse.json({
      valid: true,
      couponId: coupon.id,
      discountType: coupon.discount_type,
      discountValue: coupon.discount_value,
      maxDiscountCap: coupon.max_discount_cap,
      currency: coupon.currency,
    });
  } catch (error: unknown) {
    console.error('[Coupon Validate Error]', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { valid: false, error: message },
      { status: 500 }
    );
  }
}
