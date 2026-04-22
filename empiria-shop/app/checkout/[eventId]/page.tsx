import { getSafeSession } from '@/lib/auth0';
import { getSupabaseAdmin } from '@/lib/supabase';
import { CheckoutForm } from './CheckoutForm';
import { redirect } from 'next/navigation';

export default async function CheckoutPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const session = await getSafeSession();
  const user = session?.user ?? null;

  const supabase = getSupabaseAdmin();

  // Fetch event with tiers and occurrences
  const { data: event, error } = await supabase
    .from('events')
    .select(`
      id, title, slug, currency, status,
      ticket_tiers (id, name, description, price, currency, remaining_quantity),
      event_occurrences (id, starts_at, ends_at, label)
    `)
    .eq('id', eventId)
    .eq('status', 'published')
    .single();

  if (error || !event) {
    redirect('/');
  }

  const tiers = (event.ticket_tiers ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    price: t.price,
    remaining_quantity: t.remaining_quantity,
    currency: t.currency || event.currency || 'cad',
  }));

  const occurrences = (event.event_occurrences ?? []).map((o: any) => ({
    id: o.id,
    starts_at: o.starts_at,
    ends_at: o.ends_at,
    label: o.label,
  }));

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold mb-6">Checkout</h1>
        <CheckoutForm
          eventId={event.id}
          eventTitle={event.title}
          tiers={tiers}
          occurrences={occurrences}
          currency={event.currency || 'cad'}
          user={user}
        />
      </div>
    </div>
  );
}
