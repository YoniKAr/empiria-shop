import { getSafeSession } from '@/lib/auth0';
import { getSupabaseAdmin } from '@/lib/supabase';
import { CheckoutForm } from './CheckoutForm';
import { redirect } from 'next/navigation';
import { DEFAULT_FEE_PERCENT, DEFAULT_FIXED_PER_TICKET } from '@/lib/fees';

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ occ?: string; tiers?: string }>;
}) {
  const { eventId } = await params;
  // Optional ?occ=<id> pre-selects an occurrence (validated below against
  // this event's future occurrences). Optional ?tiers=<tierId>:<qty>,…
  // carries the event-page selection forward (validated + clamped below).
  const { occ, tiers: tiersParam } = await searchParams;
  const session = await getSafeSession();
  const user = session?.user ?? null;

  const supabase = getSupabaseAdmin();

  // Fetch event with tiers and occurrences
  const { data: event, error } = await supabase
    .from('events')
    .select(`
      id, title, slug, event_type, currency, status, pass_processing_fee, charge_ticket_tax,
      entry_type, custom_fields, seating_type, seating_config,
      shared_capacity, total_capacity, total_tickets_sold,
      platform_fee_percent, platform_fee_fixed,
      ticket_tiers (id, name, description, price, currency, remaining_quantity, min_per_order, max_per_order, is_hidden),
      event_occurrences (id, starts_at, ends_at, label, is_cancelled)
    `)
    .eq('id', eventId)
    .eq('status', 'published')
    .single();

  if (error || !event) {
    redirect('/');
  }

  // The event's public detail page — GIFFT movies live at /gifft/[slug], regular
  // events at /events/[slug]. Bounces must go to the correct one (a movie has no
  // /events/ page anymore).
  const detailPath =
    (event as any).event_type === 'gifft_movie'
      ? `/gifft/${event.slug}`
      : `/events/${event.slug}`;

  // Only attendees (and guests) can purchase. Bounce organizer/non-profit/admin accounts
  // back to the detail page (the checkout API also blocks them server-side).
  if (user?.sub) {
    const { data: buyer } = await supabase
      .from('users')
      .select('role')
      .eq('auth0_id', user.sub)
      .single();
    if (buyer?.role && buyer.role !== 'attendee') {
      redirect(detailPath);
    }
  }

  // External events have no checkout — send the attendee to the detail page to link out.
  if (event.entry_type === 'external') {
    redirect(detailPath);
  }

  // S3: seated events pick their seats/zones on the dedicated seats page —
  // landing here directly (e.g. GIFFT "Get Tickets" links) would sell seat_map
  // tickets with NO seats. Carry ?occ= so the chosen showtime isn't dropped.
  const SEATED = ['seat_map', 'assigned_seating', 'zone_map', 'zone_admission'];
  const rawSeatingConfig = (event as any).seating_config;
  const hasSeatingConfig =
    rawSeatingConfig &&
    typeof rawSeatingConfig === 'object' &&
    (rawSeatingConfig.image_url !== undefined ||
      rawSeatingConfig.seat_ranges !== undefined ||
      rawSeatingConfig.zones !== undefined);
  if (SEATED.includes((event as any).seating_type) && hasSeatingConfig) {
    redirect(`/checkout/${event.id}/seats${occ ? `?occ=${encodeURIComponent(occ)}` : ''}`);
  }

  const tiers = (event.ticket_tiers ?? [])
    .filter((t: any) => !t.is_hidden) // S7: hidden tiers are not publicly purchasable
    .map((t: any) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    price: t.price,
    remaining_quantity: t.remaining_quantity,
    min_per_order: t.min_per_order ?? 1,
    max_per_order: t.max_per_order ?? null,
    currency: t.currency || event.currency || 'cad',
  }));

  // Sorted, non-cancelled occurrences; the picker only offers FUTURE dates
  // (falls back to all when none are upcoming, preserving old behavior).
  const allOccurrences = (event.event_occurrences ?? [])
    .filter((o: any) => !o.is_cancelled)
    .sort(
      (a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );
  const futureOccurrences = allOccurrences.filter(
    (o: any) => new Date(o.starts_at) > new Date()
  );
  const occurrences = (futureOccurrences.length > 0 ? futureOccurrences : allOccurrences).map(
    (o: any) => ({
      id: o.id,
      starts_at: o.starts_at,
      ends_at: o.ends_at,
      label: o.label,
    })
  );

  // ?occ=<id> must match one of the event's FUTURE occurrences to pre-select.
  const initialOccurrenceId =
    occ && futureOccurrences.some((o: any) => String(o.id) === occ) ? occ : undefined;

  // Shared-capacity pool: the EVENT pool is the constraint in shared mode.
  const sharedCapacity = !!(event as any).shared_capacity;
  const sharedRemaining = Math.max(
    0,
    ((event as any).total_capacity ?? 0) - ((event as any).total_tickets_sold ?? 0)
  );

  // ?tiers=<tierId>:<qty>,… — pre-fill checkout with the event-page selection.
  // Each tierId must belong to THIS event; each qty is clamped to what's
  // actually purchasable (tier remaining / shared pool / max_per_order).
  // Anything invalid is dropped; an empty result falls back to the default
  // (1 of the first available tier) inside CheckoutForm.
  let initialQuantities: Record<string, number> | undefined;
  if (tiersParam) {
    const parsed: Record<string, number> = {};
    // Running shared-pool budget so multi-tier selections can't exceed it.
    let sharedLeft = sharedRemaining;
    for (const part of tiersParam.split(',')) {
      const [tierId, qtyRaw] = part.split(':');
      const tier = tiers.find((t) => t.id === tierId);
      const qty = Number.parseInt(qtyRaw ?? '', 10);
      if (!tier || !Number.isFinite(qty) || qty <= 0) continue;
      if (parsed[tier.id] != null) continue; // ignore duplicate tier entries
      const pool = sharedCapacity ? sharedLeft : tier.remaining_quantity;
      const cap = Math.min(pool, tier.max_per_order ?? Infinity);
      if (cap < 1) continue; // nothing purchasable for this tier right now
      // Floor at the tier's min_per_order (capped so an unreachable minimum
      // can't exceed availability). The old `Math.min(1, min_per_order)` was a
      // constant 1 — deep links could undercut the order minimum (S13).
      const clamped = Math.max(Math.min(tier.min_per_order, cap), Math.min(qty, cap));
      parsed[tier.id] = clamped;
      if (sharedCapacity) sharedLeft -= clamped;
    }
    if (Object.keys(parsed).length > 0) initialQuantities = parsed;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Checkout</h1>
        <CheckoutForm
          eventId={event.id}
          eventTitle={event.title}
          tiers={tiers}
          occurrences={occurrences}
          currency={event.currency || 'cad'}
          passProcessingFee={Boolean(event.pass_processing_fee)}
          chargeTicketTax={Boolean(event.charge_ticket_tax)}
          feePercent={event.platform_fee_percent != null ? Number(event.platform_fee_percent) : DEFAULT_FEE_PERCENT}
          feeFixedPerTicket={event.platform_fee_fixed != null ? Number(event.platform_fee_fixed) : DEFAULT_FIXED_PER_TICKET}
          customFields={event.custom_fields ?? []}
          user={user}
          sharedCapacity={sharedCapacity}
          sharedRemaining={sharedRemaining}
          initialOccurrenceId={initialOccurrenceId}
          initialQuantities={initialQuantities}
        />
      </div>
    </div>
  );
}
