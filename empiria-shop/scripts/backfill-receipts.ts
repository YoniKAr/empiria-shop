/**
 * Backfill marketplace receipts onto existing orders.
 *
 *   bun run scripts/backfill-receipts.ts
 *
 * Bun auto-loads `.env` from the app root, so SUPABASE_URL / SUPABASE_KEY /
 * STRIPE_SECRET are read from process.env exactly like the app does.
 *
 * Pass 1: recover `stripe_receipt_url` from Stripe for paid orders missing it.
 * Pass 2: write the immutable `receipt_data` snapshot for orders missing it.
 * Both passes are idempotent — re-running only touches still-null rows.
 */
import { getSupabaseAdmin } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { buildReceiptDataFromOrder } from '@/lib/receiptData';

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_KEY not set (check .env)');
  }
  const supabase = getSupabaseAdmin();

  // ── Pass 1: recover Stripe charge receipt URLs ──
  const { data: needUrl, error: urlErr } = await supabase
    .from('orders')
    .select('id, stripe_payment_intent_id')
    .not('stripe_payment_intent_id', 'is', null)
    .is('stripe_receipt_url', null);
  if (urlErr) throw urlErr;

  let urlRecovered = 0;
  let urlFailed = 0;
  console.log(`\n[Pass 1] ${needUrl?.length ?? 0} paid orders missing stripe_receipt_url`);
  for (const order of needUrl ?? []) {
    const pi = order.stripe_payment_intent_id as string;
    try {
      const intent = await stripe.paymentIntents.retrieve(pi, { expand: ['latest_charge'] });
      const charge = intent.latest_charge;
      const receiptUrl =
        charge && typeof charge === 'object' ? (charge as { receipt_url?: string | null }).receipt_url : null;
      if (receiptUrl) {
        const { error } = await supabase
          .from('orders')
          .update({ stripe_receipt_url: receiptUrl })
          .eq('id', order.id);
        if (error) throw error;
        urlRecovered++;
      } else {
        urlFailed++;
        console.warn(`  [url] ${order.id}: PI ${pi} has no receipt_url`);
      }
    } catch (err) {
      urlFailed++;
      console.warn(`  [url] ${order.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Gentle rate-limiting for the sequential Stripe reads.
    await new Promise((r) => setTimeout(r, 60));
  }

  // ── Pass 2: write receipt_data snapshots ──
  const { data: needSnapshot, error: snapErr } = await supabase
    .from('orders')
    .select('id')
    .is('receipt_data', null);
  if (snapErr) throw snapErr;

  let snapshotsWritten = 0;
  let snapshotFailed = 0;
  console.log(`\n[Pass 2] ${needSnapshot?.length ?? 0} orders missing receipt_data`);
  for (const order of needSnapshot ?? []) {
    try {
      const receiptData = await buildReceiptDataFromOrder(supabase, order.id);
      if (!receiptData) {
        snapshotFailed++;
        console.warn(`  [snap] ${order.id}: builder returned null`);
        continue;
      }
      const { error } = await supabase
        .from('orders')
        .update({ receipt_data: receiptData })
        .eq('id', order.id);
      if (error) throw error;
      snapshotsWritten++;
    } catch (err) {
      snapshotFailed++;
      console.warn(`  [snap] ${order.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n──────── Backfill complete ────────');
  console.log(`Stripe receipt URLs recovered: ${urlRecovered}`);
  console.log(`Stripe receipt URLs failed:    ${urlFailed}`);
  console.log(`receipt_data snapshots written: ${snapshotsWritten}`);
  console.log(`receipt_data snapshots failed:  ${snapshotFailed}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Backfill] Fatal error:', err);
    process.exit(1);
  });
