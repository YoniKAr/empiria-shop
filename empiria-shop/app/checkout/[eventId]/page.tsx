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
  searchParams: Promise<{ occ?: string }>;
}) {
  const { eventId } = await params;
  // Optional ?occ=<id> pre-selects an occurrence (validated below against
  // this event's future occurrences).
  const { occ } = await searchParams;
  const session = await getSafeSession();
  const user = session?.user ?? null;

  const supabase = getSupabaseAdmin();

  // Fetch event with tiers and occurrences
  const { data: event, error } = await supabase
    .from('events')
    .select(`
      id, title, slug, currency, status, pass_processing_fee, charge_ticket_tax,
      entry_type, custom_fields,
      shared_capacity, total_capacity, total_tickets_sold,
      platform_fee_percent, platform_fee_fixed,
      ticket_tiers (id, name, description, price, currency, remaining_quantity, min_per_order, max_per_order),
      event_occurrences (id, starts_at, ends_at, label, is_cancelled)
    `)
    .eq('id', eventId)
    .eq('status', 'published')
    .single();

  if (error || !event) {
    redirect('/');
  }

  // Only attendees (and guests) can purchase. Bounce organizer/non-profit/admin accounts
  // back to the event page (the checkout API also blocks them server-side).
  if (user?.sub) {
    const { data: buyer } = await supabase
      .from('users')
      .select('role')
      .eq('auth0_id', user.sub)
      .single();
    if (buyer?.role && buyer.role !== 'attendee') {
      redirect(`/events/${event.slug}`);
    }
  }

  // External events have no checkout — send the attendee to the event page to link out.
  if (event.entry_type === 'external') {
    redirect(`/events/${event.slug}`);
  }

  const tiers = (event.ticket_tiers ?? []).map((t: any) => ({
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
        />
      </div>
    </div>
  );
}
