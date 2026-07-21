import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getSafeSession } from '@/lib/auth0';
import { verifyReceiptToken } from '@/lib/receiptToken';
import { buildReceiptDataFromOrder, type ReceiptData } from '@/lib/receiptData';
import { formatCurrency } from '@/lib/utils';
import { formatEventDateTime, DEFAULT_TZ } from '@/lib/datetime';
import PrintButton from './PrintButton';

// Receipts are per-order and access-controlled — never cache or index them.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Receipt · Empiria Events',
  robots: { index: false, follow: false },
};

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { orderId } = await params;
  const { t } = await searchParams;

  const supabase = getSupabaseAdmin();
  const { data: order } = await supabase
    .from('orders')
    .select('id, user_id, event_id, receipt_data, receipt_number, stripe_receipt_url, created_at')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) notFound();

  // ── Access control ──
  // (d) A valid share token is sufficient (buyers/guests open their own receipt
  // from the email). Otherwise require a session user who is (a) the buyer,
  // (b) a platform admin, or (c) the event owner / a co-organizer.
  let allowed = verifyReceiptToken(orderId, t);
  if (!allowed) {
    const session = await getSafeSession();
    const sub = session?.user?.sub ?? null;
    // No token and no shop session: send through login (silent SSO for anyone
    // already signed in on another Empiria app) and come straight back here.
    // Only an AUTHENTICATED-but-unauthorized viewer falls through to 404.
    if (!sub) {
      redirect(`/auth/login?returnTo=${encodeURIComponent(`/receipt/${orderId}`)}`);
    }
    if (sub) {
      if (order.user_id && order.user_id === sub) {
        allowed = true;
      } else {
        const { data: viewer } = await supabase
          .from('users')
          .select('id, role')
          .eq('auth0_id', sub)
          .maybeSingle();
        if (viewer?.role === 'admin') {
          allowed = true;
        } else {
          // Event owner is stored as an auth0 sub; co-organizers key on users.id.
          const { data: ev } = await supabase
            .from('events')
            .select('organizer_id')
            .eq('id', order.event_id)
            .maybeSingle();
          if (ev?.organizer_id === sub) {
            allowed = true;
          } else if (viewer?.id) {
            const { data: co } = await supabase
              .from('event_organizers')
              .select('id')
              .eq('event_id', order.event_id)
              .eq('user_id', viewer.id)
              .maybeSingle();
            if (co) allowed = true;
          }
        }
      }
    }
  }

  if (!allowed) notFound();

  // Use the immutable snapshot; build it live for legacy orders not yet backfilled.
  const receipt: ReceiptData | null =
    (order.receipt_data as ReceiptData | null) ?? (await buildReceiptDataFromOrder(supabase, orderId));

  if (!receipt) notFound();

  const receiptNumber = order.receipt_number || `EMP-${orderId.slice(0, 8).toUpperCase()}`;
  const orderDate = formatEventDateTime(order.created_at, DEFAULT_TZ, {
    withWeekday: false,
    withYear: true,
    withTime: false,
    longMonth: true,
  });
  const eventWhen = receipt.event.starts_at
    ? formatEventDateTime(receipt.event.starts_at, receipt.event.timezone || DEFAULT_TZ, {
        withWeekday: true,
        withYear: true,
        longMonth: true,
      })
    : null;
  const eventWhere = [receipt.event.venue_name, receipt.event.city].filter(Boolean).join(', ');

  const currency = receipt.currency;
  const subtotal = receipt.items.reduce((sum, it) => sum + it.amount, 0);
  const { service_fee, service_fee_tax, ticket_tax, discount, coupon_code } = receipt.fees;
  const isNonProfit = receipt.seller.non_profit && !receipt.seller.is_platform;
  const totalLabel = isNonProfit ? 'Total contribution' : 'Total paid';
  const piId = receipt.payment.stripe_payment_intent_id;

  return (
    <main className="min-h-screen bg-slate-100 py-10 px-4 print:bg-white print:py-0 print:px-0">
      {/* Print rules: white background, no shadow, hide the action bar. */}
      <style>{`
        @media print {
          .receipt-actions { display: none !important; }
          .receipt-sheet { box-shadow: none !important; border: none !important; margin: 0 !important; max-width: 100% !important; }
          body { background: #ffffff !important; }
        }
      `}</style>

      <div className="mx-auto max-w-2xl">
        <div className="receipt-actions mb-6 flex items-center justify-between print:hidden">
          <p className="text-sm text-slate-500">Receipt {receiptNumber}</p>
          <PrintButton />
        </div>

        <article className="receipt-sheet overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* Header */}
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-8 py-7">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Empiria Events" width={40} height={40} className="h-10 w-10 rounded-md object-contain" />
              <span className="text-lg font-bold tracking-tight text-slate-900">Empiria Events</span>
            </div>
            <div className="text-right">
              <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Receipt</h1>
              <p className="mt-1 font-mono text-xs text-slate-500">{receiptNumber}</p>
              {orderDate && <p className="text-xs text-slate-500">{orderDate}</p>}
            </div>
          </header>

          <div className="space-y-7 px-8 py-7">
            {/* Seller */}
            <section>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Sold by</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{receipt.seller.name}</p>
              <p className="mt-1 text-sm text-slate-500">
                Sold via Empiria Events · a marketplace operated by Empiria Solutions Inc.
              </p>
              {isNonProfit && (
                <p className="mt-1 text-sm text-slate-600">{receipt.seller.name} is a non-profit organization.</p>
              )}
            </section>

            {/* Buyer + Event */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {(receipt.buyer.name || receipt.buyer.email) && (
                <section>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Billed to</p>
                  {receipt.buyer.name && <p className="mt-1 text-sm font-medium text-slate-900">{receipt.buyer.name}</p>}
                  {receipt.buyer.email && <p className="text-sm text-slate-600">{receipt.buyer.email}</p>}
                </section>
              )}
              <section>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Event</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{receipt.event.title}</p>
                {eventWhen && <p className="text-sm text-slate-600">{eventWhen}</p>}
                {eventWhere && <p className="text-sm text-slate-600">{eventWhere}</p>}
              </section>
            </div>

            {/* Items */}
            <section>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="pb-2 font-bold">Item</th>
                    <th className="pb-2 text-center font-bold">Qty</th>
                    <th className="pb-2 text-right font-bold">Unit</th>
                    <th className="pb-2 text-right font-bold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map((it, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-2.5 pr-2 text-slate-900">{it.name}</td>
                      <td className="py-2.5 text-center text-slate-600">{it.quantity}</td>
                      <td className="py-2.5 text-right text-slate-600">{formatCurrency(it.unit_price, currency)}</td>
                      <td className="py-2.5 text-right text-slate-900">{formatCurrency(it.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* Money summary */}
            <section className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
              <Row label="Subtotal" value={formatCurrency(subtotal, currency)} />
              {discount > 0 && (
                <Row
                  label={`Discount${coupon_code ? ` (${coupon_code})` : ''}`}
                  value={`-${formatCurrency(discount, currency)}`}
                  valueClass="text-emerald-600"
                />
              )}
              {service_fee > 0 && (
                <Row label="Service fees" value={formatCurrency(service_fee, currency)} muted />
              )}
              {service_fee_tax > 0 && (
                <Row label="HST on service fee" value={formatCurrency(service_fee_tax, currency)} muted />
              )}
              {ticket_tax > 0 && <Row label="Sales tax (HST 13%)" value={formatCurrency(ticket_tax, currency)} muted />}
              <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2.5 text-base font-extrabold text-slate-900">
                <span>{totalLabel}</span>
                <span>{formatCurrency(receipt.total, currency)}</span>
              </div>
            </section>

            {/* Payment */}
            <section className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
              {receipt.total > 0 ? (
                <>
                  <p className="font-medium text-slate-700">Paid via Stripe</p>
                  {piId && <p className="mt-0.5 font-mono text-xs text-slate-500">{piId}</p>}
                  {order.stripe_receipt_url && (
                    <a
                      href={order.stripe_receipt_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-xs text-slate-500 underline print:hidden"
                    >
                      Stripe payment receipt
                    </a>
                  )}
                </>
              ) : (
                <p className="font-medium text-slate-700">No payment required</p>
              )}
            </section>
          </div>

          {/* Footer */}
          <footer className="border-t border-slate-200 px-8 py-5 text-xs text-slate-500">
            <p>Questions about this order? Contact the event organizer or info@empiria.events.</p>
            <p className="mt-1">© {new Date().getFullYear()} Empiria Solutions Inc.</p>
          </footer>
        </article>
      </div>
    </main>
  );
}

function Row({
  label,
  value,
  muted,
  valueClass,
}: {
  label: string;
  value: string;
  muted?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? 'text-slate-500' : 'text-slate-600'}>{label}</span>
      <span className={valueClass ?? (muted ? 'text-slate-500' : 'text-slate-900')}>{value}</span>
    </div>
  );
}
