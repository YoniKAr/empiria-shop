import type { OrderEmailData, WalletResult } from '@/lib/email';
import { emailLayout } from './_layout';
import {
  confirmationMessage,
  eventDetailsBlock,
  orderSummaryTable,
  receiptLinks,
  ticketsList,
} from './_partials';

export function render(
  data: OrderEmailData,
  walletResults: WalletResult[]
): { subject: string; html: string } {
  const subject = `Your RSVP for ${data.eventTitle} — Order #${data.orderId.slice(0, 8)}`;
  const bodyHtml = [
    confirmationMessage(data, "Here's your RSVP confirmation."),
    eventDetailsBlock(data),
    orderSummaryTable(data),
    receiptLinks(data),
    ticketsList(data, walletResults, 'Your RSVP'),
  ].join('');
  const html = emailLayout({ title: 'Order Confirmation', bodyHtml });
  return { subject, html };
}
