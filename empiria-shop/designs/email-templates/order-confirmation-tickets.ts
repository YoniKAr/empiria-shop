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
  const subject = `Your tickets for ${data.eventTitle} — Order #${data.orderId.slice(0, 8)}`;
  const bodyHtml = [
    confirmationMessage(data, 'Here are your tickets and order details.'),
    eventDetailsBlock(data, true),
    orderSummaryTable(data),
    receiptLinks(data),
    ticketsList(data, walletResults, 'Your Tickets'),
  ].join('');
  const html = emailLayout({ title: 'Order Confirmation', bodyHtml });
  return { subject, html };
}
