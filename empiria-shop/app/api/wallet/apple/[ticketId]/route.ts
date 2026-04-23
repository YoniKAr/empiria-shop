import { NextRequest, NextResponse } from 'next/server';
import { getSafeSession } from '@/lib/auth0';
import { getSupabaseAdmin } from '@/lib/supabase';
import { generateApplePass } from '@/lib/wallet';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = await params;

  // Auth check — user must own this ticket
  const session = await getSafeSession();
  if (!session?.user?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data: ticket } = await supabase
    .from('tickets')
    .select(`
      id, qr_code_secret, seat_label,
      event:events!tickets_event_id_fkey (id, title, start_at, end_at, venue_name, city),
      tier:ticket_tiers!tickets_tier_id_fkey (id, name)
    `)
    .eq('id', ticketId)
    .eq('user_id', session.user.sub)
    .single();

  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  const event = ticket.event as any;
  const tier = ticket.tier as any;

  const passBuffer = await generateApplePass(
    { id: ticket.id, qr_code_secret: ticket.qr_code_secret, seat_label: ticket.seat_label },
    { id: event.id, title: event.title, start_at: event.start_at, end_at: event.end_at, venue_name: event.venue_name, city: event.city },
    { id: tier.id, name: tier.name },
  );

  if (!passBuffer) {
    return NextResponse.json({ error: 'Apple Wallet not configured' }, { status: 503 });
  }

  return new NextResponse(new Uint8Array(passBuffer), {
    headers: {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="ticket-${ticketId}.pkpass"`,
    },
  });
}
