import { NextRequest, NextResponse } from 'next/server';
import { getSafeSession } from '@/lib/auth0';
import { getSupabaseAdmin } from '@/lib/supabase';
import { generateGoogleWalletLink } from '@/lib/wallet';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = await params;

  // A session is required — for guest tickets we match on the buyer's email.
  const session = await getSafeSession();
  if (!session?.user?.sub) {
    return NextResponse.json(
      {
        error: 'Please sign in to add this ticket to your wallet.',
        login: `/auth/login?returnTo=${encodeURIComponent(`/api/wallet/google/${ticketId}`)}`,
      },
      { status: 401 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: ticket } = await supabase
    .from('tickets')
    .select(`
      id, qr_code_secret, seat_label, user_id, order_id,
      event:events!tickets_event_id_fkey (id, title, venue_name, city),
      occurrence:event_occurrences!tickets_occurrence_id_fkey (starts_at, ends_at),
      tier:ticket_tiers!tickets_tier_id_fkey (id, name)
    `)
    .eq('id', ticketId)
    .single();

  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  // Ownership: the ticket's owner, or — for guest tickets (no user_id) —
  // a signed-in user whose email matches the order's buyer email.
  let authorized = !!ticket.user_id && ticket.user_id === session.user.sub;
  if (!authorized && !ticket.user_id && ticket.order_id && session.user.email) {
    const { data: order } = await supabase
      .from('orders')
      .select('buyer_email')
      .eq('id', ticket.order_id)
      .maybeSingle();
    authorized =
      !!order?.buyer_email &&
      order.buyer_email.toLowerCase() === String(session.user.email).toLowerCase();
  }
  if (!authorized) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  const event = ticket.event as any;
  const tier = ticket.tier as any;

  // Occurrence dates: the ticket's occurrence, falling back to the event's earliest.
  let occurrence = ticket.occurrence as any;
  if (!occurrence?.starts_at && event?.id) {
    const { data: earliest } = await supabase
      .from('event_occurrences')
      .select('starts_at, ends_at')
      .eq('event_id', event.id)
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    occurrence = earliest;
  }
  if (!occurrence?.starts_at) {
    return NextResponse.json({ error: 'Event date not found' }, { status: 404 });
  }

  const walletUrl = await generateGoogleWalletLink(
    { id: ticket.id, qr_code_secret: ticket.qr_code_secret, seat_label: ticket.seat_label },
    { id: event.id, title: event.title, starts_at: occurrence.starts_at, ends_at: occurrence.ends_at, venue_name: event.venue_name, city: event.city },
    { id: tier.id, name: tier.name },
  );

  if (!walletUrl) {
    return NextResponse.json({ error: 'Google Wallet not configured' }, { status: 503 });
  }

  return NextResponse.redirect(walletUrl);
}
