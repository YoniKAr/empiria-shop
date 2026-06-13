import { emailLayout, escapeHtml } from './_layout';
import { formatCurrency } from '@/lib/utils';

export interface SaleNotificationData {
  organizerName: string;
  eventTitle: string;
  orderId: string;
  total: number;
  currency: string;
  quantity: number;
  buyerName?: string;
  buyerEmail?: string;
  lineItems: { tierName: string; quantity: number; unitPrice: number }[];
  /** What the owner will receive after fees (0 for platform-owned events). */
  organizerPayout?: number;
  isPlatformEvent?: boolean;
}

/**
 * Organizer/owner-facing "you made a sale" email. Fired from the Stripe webhook
 * after a paid checkout when the event's notify_on_sale toggle is on.
 */
export function render(data: SaleNotificationData): string {
  const lineRows = data.lineItems
    .map(
      (li) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151;">${escapeHtml(li.tierName)}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: center;">${li.quantity}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: right;">${formatCurrency(li.unitPrice * li.quantity, data.currency)}</td>
      </tr>`
    )
    .join('');

  const buyer = [data.buyerName, data.buyerEmail].filter(Boolean).map((v) => escapeHtml(String(v))).join(' · ');

  const payoutRow =
    !data.isPlatformEvent && typeof data.organizerPayout === 'number'
      ? `<p style="margin: 6px 0 0; font-size: 14px; color: #374151;">Your payout from this order: <strong style="color:#111827;">${formatCurrency(data.organizerPayout, data.currency)}</strong></p>`
      : '';

  const body = `
          <tr>
            <td style="padding: 32px 32px 8px;">
              <span style="display:inline-block; background:#fff7ed; color:#c2410c; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; padding:4px 10px; border-radius:9999px;">New ticket sale</span>
              <h2 style="margin: 14px 0 6px; font-size: 20px; font-weight: 700; color: #111827;">You made a sale, ${escapeHtml(data.organizerName || 'there')}! 🎟️</h2>
              <p style="margin: 0; font-size: 15px; color: #6b7280; line-height: 1.5;">
                ${data.quantity} ticket${data.quantity === 1 ? '' : 's'} just sold for <strong style="color:#111827;">${escapeHtml(data.eventTitle)}</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 32px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px;">
                <tr><td style="padding: 16px;">
                  <p style="margin:0 0 2px; font-size:12px; text-transform:uppercase; letter-spacing:0.04em; color:#9ca3af; font-weight:600;">Order total</p>
                  <p style="margin:0; font-size:26px; font-weight:800; color:#F15A29;">${formatCurrency(data.total, data.currency)}</p>
                  ${payoutRow}
                  ${buyer ? `<p style="margin:10px 0 0; font-size:13px; color:#6b7280;">Buyer: ${buyer}</p>` : ''}
                  <p style="margin:4px 0 0; font-size:12px; color:#9ca3af;">Order #${escapeHtml(data.orderId.slice(0, 8))}</p>
                </td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 32px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
                <tr style="background:#f9fafb;">
                  <th style="padding:8px 12px; font-size:12px; font-weight:600; color:#6b7280; text-align:left; text-transform:uppercase;">Tier</th>
                  <th style="padding:8px 12px; font-size:12px; font-weight:600; color:#6b7280; text-align:center; text-transform:uppercase;">Qty</th>
                  <th style="padding:8px 12px; font-size:12px; font-weight:600; color:#6b7280; text-align:right; text-transform:uppercase;">Amount</th>
                </tr>
                ${lineRows}
              </table>
              <p style="margin:12px 0 0; font-size:12px; color:#9ca3af;">
                You're receiving this because sale notifications are on for this event. You can turn them off per event in your dashboard.
              </p>
            </td>
          </tr>
`;

  return emailLayout({ title: `New sale — ${escapeHtml(data.eventTitle)}`, bodyHtml: body });
}
