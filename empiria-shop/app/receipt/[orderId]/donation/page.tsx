import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase';
import { assertReceiptAccess } from '@/lib/receiptAccess';
import type { DonationReceiptData } from '@/lib/donationReceipt';
import { formatCurrency } from '@/lib/utils';
import { formatEventDateTime, DEFAULT_TZ } from '@/lib/datetime';
import PrintButton from '../PrintButton';

// Donation receipts are per-order and access-controlled — never cache or index.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Donation receipt · Empiria Events',
  robots: { index: false, follow: false },
};

export default async function DonationReceiptPage({
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
    .select('id, user_id, event_id, status, donation_receipt_number, donation_receipt_data')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) notFound();

  await assertReceiptAccess(supabase, {
    orderId,
    userId: order.user_id,
    eventId: order.event_id,
    token: t,
    loginReturnTo: `/receipt/${orderId}/donation`,
  });

  const receipt = order.donation_receipt_data as DonationReceiptData | null;
  if (!receipt) notFound();

  // The slip's serial is the DONATION receipt number (DON-…), not the order's
  // EMP receipt number — that stays as the order reference in the body.
  const serial = order.donation_receipt_number || receipt.order_ref;

  const isVoid = order.status === 'refunded' || order.status === 'cancelled';

  const issuedDate = formatEventDateTime(receipt.issued_at, DEFAULT_TZ, {
    withWeekday: false,
    withYear: true,
    withTime: false,
    longMonth: true,
  });
  const giftDate = formatEventDateTime(receipt.gift_date, DEFAULT_TZ, {
    withWeekday: false,
    withYear: true,
    withTime: false,
    longMonth: true,
  });
  const eventWhen = receipt.event.starts_at
    ? formatEventDateTime(receipt.event.starts_at, DEFAULT_TZ, {
        withWeekday: false,
        withYear: true,
        withTime: false,
        longMonth: true,
      })
    : null;

  const basisCaption =
    receipt.basis === 'ticket_plus_tax'
      ? 'Ticket price + sales tax'
      : 'Ticket price only';
  const initial = (receipt.charity.legal_name || 'E').trim().charAt(0).toUpperCase();

  return (
    <main className="min-h-screen bg-slate-100 py-10 px-4 print:bg-white print:py-0 print:px-0">
      <style>{`
        @media print {
          .slip-actions { display: none !important; }
          .slip-sheet { box-shadow: none !important; border: 1px solid #cbd5e1 !important; margin: 0 !important; max-width: 100% !important; }
          body { background: #ffffff !important; }
          @page { size: landscape; margin: 12mm; }
        }
      `}</style>

      <div className="mx-auto max-w-4xl">
        <div className="slip-actions mb-6 flex items-center justify-between print:hidden">
          <p className="text-sm text-slate-500">Official donation receipt {serial}</p>
          <PrintButton />
        </div>

        <article className="slip-sheet relative overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
          {isVoid && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <span className="rotate-[-24deg] select-none text-[7rem] font-black tracking-widest text-rose-500/20">
                VOID
              </span>
            </div>
          )}

          <div className="relative z-10 px-10 py-9">
            {/* Top row: charity block (left) + serial block (right) */}
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-sm">
                <p className="text-lg font-bold text-slate-900">{receipt.charity.legal_name}</p>
                {receipt.charity.address && (
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{receipt.charity.address}</p>
                )}
                <p className="mt-2 text-sm text-slate-700">
                  Charitable Registration No.:{' '}
                  <span className="font-semibold">{receipt.charity.registration_number}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Receipt no.</p>
                <p className="font-mono text-lg font-bold tracking-tight text-slate-900">{serial}</p>
                {issuedDate && <p className="mt-2 text-sm text-slate-600">Issued: {issuedDate}</p>}
                {receipt.place_of_issue && (
                  <p className="text-sm text-slate-600">Place of issue: {receipt.place_of_issue}</p>
                )}
              </div>
            </div>

            {/* Center: charity avatar + name */}
            <div className="mt-8 flex flex-col items-center text-center">
              {receipt.charity.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={receipt.charity.avatar_url}
                  alt={receipt.charity.legal_name}
                  width={96}
                  height={96}
                  className="h-24 w-24 rounded-full border border-slate-200 object-cover"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-3xl font-bold text-slate-500">
                  {initial}
                </div>
              )}
              <p className="mt-3 text-base font-semibold text-slate-900">{receipt.charity.legal_name}</p>
              <p className="mt-4 text-lg font-extrabold uppercase tracking-wide text-slate-900">
                Official donation receipt for income tax purposes
              </p>
            </div>

            {/* Body */}
            <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-4 sm:grid-cols-2">
              <BodyRow label="Donor" value={[receipt.donor.name, receipt.donor.email].filter(Boolean).join(' · ') || '—'} />
              <BodyRow label="Date of gift" value={giftDate || '—'} />
              <BodyRow
                label="Event"
                value={`${receipt.event.title}${eventWhen ? ` (${eventWhen})` : ''} — ${receipt.order_ref}`}
              />
              <BodyRow label="Amount paid" value={formatCurrency(receipt.amount_paid, 'cad')} />
            </div>

            {/* Eligible amount — the headline figure */}
            <div className="mt-8 flex flex-col items-center">
              <div className="w-full max-w-md rounded-xl border-2 border-slate-900 px-6 py-5 text-center">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Eligible amount of gift for tax purposes
                </p>
                <p className="mt-1 text-4xl font-black tracking-tight text-slate-900">
                  {formatCurrency(receipt.eligible_amount, 'cad')}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {basisCaption} — excludes service and processing fees
                </p>
              </div>
            </div>

            {isVoid && (
              <p className="mt-6 text-center text-sm font-semibold text-rose-600">
                This order was refunded — this receipt is void.
              </p>
            )}

            {/* Footer: authority + signature */}
            <div className="mt-10 flex flex-wrap items-end justify-between gap-6 border-t border-slate-200 pt-6">
              <p className="text-xs text-slate-500">
                Canada Revenue Agency · canada.ca/charities-giving
              </p>
              <div className="text-center">
                <div className="h-8 w-56 border-b border-slate-400" />
                <p className="mt-1 text-xs text-slate-500">Authorized signature</p>
              </div>
            </div>
          </div>
        </article>
      </div>
    </main>
  );
}

function BodyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}
