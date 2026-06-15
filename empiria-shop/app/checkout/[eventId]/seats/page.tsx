import { getSafeSession } from '@/lib/auth0';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getCurrencySymbol } from '@/lib/utils';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ZoneSelector from '@/components/seatmap/ZoneSelector';
import SeatSelector from '@/components/seatmap/SeatSelector';
import AssignedSeatPicker from '@/components/seatmap/AssignedSeatPicker';
import type { SeatingConfig } from '@/lib/seatmap-types';

const SEATED = ['seat_map', 'assigned_seating', 'zone_map', 'zone_admission'];

export default async function SeatSelectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ qty?: string; occ?: string }>;
}) {
  const { eventId } = await params;
  // Deep-linked seat count (?qty=2). SeatSelector validates against its own
  // max and falls back to the quantity step when out of range.
  // ?occ=<id> pre-selects the occurrence chosen on the event page.
  const { qty, occ } = await searchParams;
  const parsedQty = qty ? Number.parseInt(qty, 10) : NaN;
  const initialQuantity = Number.isInteger(parsedQty) && parsedQty > 0 ? parsedQty : undefined;
  const supabase = getSupabaseAdmin();

  const { data: event } = await supabase
    .from('events')
    .select('*, ticket_tiers(*), event_occurrences(*)')
    .eq('id', eventId)
    .eq('status', 'published')
    .single();

  if (!event) redirect('/');

  const seatingType = (event as any).seating_type || 'general_admission';
  const rawSeatingConfig = (event as any).seating_config;
  const seatingConfig: SeatingConfig | null =
    rawSeatingConfig &&
    typeof rawSeatingConfig === 'object' &&
    (rawSeatingConfig.image_url !== undefined || rawSeatingConfig.seat_ranges !== undefined || rawSeatingConfig.zones !== undefined)
      ? (rawSeatingConfig as SeatingConfig)
      : null;

  // Only seated events have a seat-selection step; GA / missing config → event page.
  if (!SEATED.includes(seatingType) || !seatingConfig) redirect(`/events/${event.slug}`);

  // S7: hidden tiers are not publicly purchasable — never offer them here.
  const sortedTiers = [...(event.ticket_tiers || [])]
    .filter((t: any) => !t.is_hidden)
    .sort((a: any, b: any) => a.price - b.price);
  const currency = event.currency || 'cad';
  const currencySymbol = getCurrencySymbol(currency);

  const futureOccurrences = (event.event_occurrences || [])
    .filter((o: any) => !o.is_cancelled && new Date(o.starts_at) > new Date())
    .sort((a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const occurrences = futureOccurrences.map((o: any) => ({
    id: o.id,
    starts_at: o.starts_at,
    ends_at: o.ends_at,
    label: o.label || '',
  }));

  // Validate the deep-linked occurrence against this event's future occurrences.
  const initialOccurrenceId =
    occ && occurrences.some((o: any) => String(o.id) === occ) ? occ : undefined;

  const session = await getSafeSession();
  const user = session?.user;
  let blockedBuyer = false;
  if (user?.sub) {
    const { data: buyerRow } = await supabase.from('users').select('role').eq('auth0_id', user.sub).single();
    blockedBuyer = !!buyerRow?.role && buyerRow.role !== 'attendee';
  }

  const isSeatPick = seatingType === 'seat_map' || seatingType === 'assigned_seating';

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <Link
          href={`/events/${event.slug}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to event
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{event.title}</h1>
        <p className="text-sm text-gray-700 mt-1 mb-6">
          {isSeatPick ? 'Pick your seats, then continue to checkout.' : 'Choose your tickets, then continue to checkout.'}
        </p>

        {seatingType === 'assigned_seating' ? (
          <AssignedSeatPicker
            seatRanges={seatingConfig.seat_ranges || []}
            tiers={sortedTiers}
            eventId={event.id}
            timezone={(event as any).timezone || undefined}
            eventCurrency={currency}
            currencySymbol={currencySymbol}
            userEmail={user?.email}
            userName={user?.name}
            blockedBuyer={blockedBuyer}
            allowSeatChoice={seatingConfig.allow_seat_choice ?? false}
            occurrences={occurrences}
            initialOccurrenceId={initialOccurrenceId}
          />
        ) : seatingType === 'seat_map' ? (
          <SeatSelector
            config={seatingConfig}
            tiers={sortedTiers}
            eventId={event.id}
            timezone={(event as any).timezone || undefined}
            eventCurrency={currency}
            currencySymbol={currencySymbol}
            userEmail={user?.email}
            userName={user?.name}
            blockedBuyer={blockedBuyer}
            occurrences={occurrences}
            initialQuantity={initialQuantity}
            initialOccurrenceId={initialOccurrenceId}
          />
        ) : (
          <ZoneSelector
            config={seatingConfig}
            tiers={sortedTiers}
            eventId={event.id}
            timezone={(event as any).timezone || undefined}
            eventCurrency={currency}
            currencySymbol={currencySymbol}
            userEmail={user?.email}
            userName={user?.name}
            blockedBuyer={blockedBuyer}
            occurrences={occurrences}
            initialOccurrenceId={initialOccurrenceId}
          />
        )}
      </div>
      <Footer />
    </div>
  );
}
