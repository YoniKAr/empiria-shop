import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get('eventId');

  if (!eventId) {
    return NextResponse.json({ error: 'Missing eventId' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: tickets, error } = await supabase
    .from('tickets')
    .select('seat_label')
    .eq('event_id', eventId)
    .in('status', ['valid', 'used'])
    .not('seat_label', 'is', null);

  if (error) {
    console.error('[sold-seats] Failed to fetch sold seats:', error);
    return NextResponse.json({ error: 'Failed to fetch sold seats' }, { status: 500 });
  }

  const seatLabels = (tickets || []).map((t: any) => t.seat_label);

  return NextResponse.json({ seatLabels });
}
