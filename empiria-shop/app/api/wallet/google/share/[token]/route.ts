import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { generateGoogleWalletLink } from '@/lib/wallet';

// Public, token-secured Google Wallet save link. The token is the ticket's
// qr_code_secret (a gen_random_uuid bearer credential), so no session is
// required — this lets a buyer share a ticket with a guest who adds it to
// their own Google Wallet.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const supabase = getSupabaseAdmin();
  const { data: ticket } = await supabase
    .from('tickets')
    .select(`
      id, qr_code_secret, seat_label,
      event:events!tickets_event_id_fkey (id, title, start_at, end_at, venue_name, city),
      tier:ticket_tiers!tickets_tier_id_fkey (id, name)
    `)
    .eq('qr_code_secret', token)
    .single();

  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  const event = ticket.event as any;
  const tier = ticket.tier as any;

  const walletUrl = await generateGoogleWalletLink(
    { id: ticket.id, qr_code_secret: ticket.qr_code_secret, seat_label: ticket.seat_label },
    { id: event.id, title: event.title, start_at: event.start_at, end_at: event.end_at, venue_name: event.venue_name, city: event.city },
    { id: tier.id, name: tier.name },
  );

  if (!walletUrl) {
    return NextResponse.json({ error: 'Google Wallet not configured' }, { status: 503 });
  }

  return NextResponse.redirect(walletUrl);
}
