import { formatCurrency } from '@/lib/utils';
import { SHOP_URL } from '@/lib/urls';
import type { OrderEmailData, WalletResult } from '@/lib/email';

export function formatEventDate(startDate: string, endDate?: string): string {
  const start = new Date(startDate);
  const dateStr = start.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (endDate) {
    const end = new Date(endDate);
    const endTimeStr = end.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${dateStr} &middot; ${timeStr} – ${endTimeStr}`;
  }

  return `${dateStr} &middot; ${timeStr}`;
}

export function confirmationMessage(data: OrderEmailData, confirmation: string): string {
  return `
          <!-- Confirmation Message -->
          <tr>
            <td style="padding: 32px 32px 16px;">
              <h2 style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #111827;">You're all set, ${data.attendeeName || 'there'}!</h2>
              <p style="margin: 0; font-size: 15px; color: #6b7280; line-height: 1.5;">
                Your order has been confirmed. ${confirmation}
              </p>
            </td>
          </tr>
`;
}

export function eventDetailsBlock(data: OrderEmailData): string {
  const eventDateFormatted = formatEventDate(data.eventDate, data.eventEndDate);
  const venue = [data.venueName, data.city].filter(Boolean).join(', ');

  return `
          <!-- Event Details -->
          <tr>
            <td style="padding: 16px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">
                <tr>
                  <td style="padding: 20px;">
                    <h3 style="margin: 0 0 8px; font-size: 17px; font-weight: 700; color: #0c4a6e;">${data.eventTitle}</h3>
                    <p style="margin: 0 0 4px; font-size: 14px; color: #0369a1;">${eventDateFormatted}</p>
                    ${venue ? `<p style="margin: 0 0 4px; font-size: 14px; color: #0369a1;">${venue}</p>` : ''}
                    ${data.organizerName ? `<p style="margin: 0 0 4px; font-size: 14px; color: #0369a1;">Hosted by ${data.organizerName}</p>` : ''}
                    ${(data.locationType === 'virtual' || data.locationType === 'hybrid') && data.meetingLink ? `<p style="margin: 0; font-size: 14px;"><a href="${data.meetingLink}" style="color: #0369a1; text-decoration: underline; font-weight: 600;" target="_blank">Join Online Meeting</a></p>` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
`;
}

export function orderSummaryTable(data: OrderEmailData): string {
  const lineItemRows = data.lineItems
    .map(
      (item) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151;">
          ${item.tierName}
        </td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: center;">
          ${item.quantity}
        </td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: right;">
          ${formatCurrency(item.unitPrice, data.currency)}
        </td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: right;">
          ${formatCurrency(item.unitPrice * item.quantity, data.currency)}
        </td>
      </tr>`
    )
    .join('');

  return `
          <!-- Order Summary -->
          <tr>
            <td style="padding: 16px 32px;">
              <h3 style="margin: 0 0 12px; font-size: 15px; font-weight: 600; color: #111827;">Order Summary</h3>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <tr style="background: #f9fafb;">
                  <th style="padding: 8px 12px; font-size: 12px; font-weight: 600; color: #6b7280; text-align: left; text-transform: uppercase;">Tier</th>
                  <th style="padding: 8px 12px; font-size: 12px; font-weight: 600; color: #6b7280; text-align: center; text-transform: uppercase;">Qty</th>
                  <th style="padding: 8px 12px; font-size: 12px; font-weight: 600; color: #6b7280; text-align: right; text-transform: uppercase;">Price</th>
                  <th style="padding: 8px 12px; font-size: 12px; font-weight: 600; color: #6b7280; text-align: right; text-transform: uppercase;">Total</th>
                </tr>
                ${lineItemRows}
                ${data.convenienceFee && data.convenienceFee > 0 ? `
                <tr>
                  <td colspan="3" style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #6b7280; text-align: right;">
                    Service Fee
                  </td>
                  <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #6b7280; text-align: right;">
                    ${formatCurrency(data.convenienceFee, data.currency)}
                  </td>
                </tr>` : ''}
                ${data.convenienceFeeHST && data.convenienceFeeHST > 0 ? `
                <tr>
                  <td colspan="3" style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #6b7280; text-align: right;">
                    HST on Service Fee
                  </td>
                  <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #6b7280; text-align: right;">
                    ${formatCurrency(data.convenienceFeeHST, data.currency)}
                  </td>
                </tr>` : ''}
                ${data.ticketTax && data.ticketTax > 0 ? `
                <tr>
                  <td colspan="3" style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #6b7280; text-align: right;">
                    Sales Tax (HST 13%)
                  </td>
                  <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #6b7280; text-align: right;">
                    ${formatCurrency(data.ticketTax, data.currency)}
                  </td>
                </tr>` : ''}
                ${data.discountAmount && data.discountAmount > 0 ? `
                <tr>
                  <td colspan="3" style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #059669; text-align: right;">
                    Discount${data.couponCode ? ` (${data.couponCode})` : ''}
                  </td>
                  <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #059669; text-align: right;">
                    -${formatCurrency(data.discountAmount, data.currency)}
                  </td>
                </tr>` : ''}
                <tr style="background: #f9fafb;">
                  <td colspan="3" style="padding: 10px 12px; font-size: 14px; font-weight: 700; color: #111827; text-align: right;">
                    Total
                  </td>
                  <td style="padding: 10px 12px; font-size: 14px; font-weight: 700; color: #111827; text-align: right;">
                    ${formatCurrency(data.total, data.currency)}
                  </td>
                </tr>
              </table>
              <p style="margin: 8px 0 0; font-size: 12px; color: #9ca3af;">
                Order #${data.orderId.slice(0, 8)}
              </p>
            </td>
          </tr>
`;
}

export function receiptLinks(data: OrderEmailData): string {
  if (!(data.receiptUrl || data.invoiceUrl || data.invoicePdf)) {
    return '';
  }
  return `
          <!-- Payment Receipt & Invoice -->
          <tr>
            <td style="padding: 4px 32px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding: 12px 0;">
                    ${data.receiptUrl ? `<a href="${data.receiptUrl}" target="_blank" style="display: inline-block; padding: 10px 20px; background: #111827; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px;">View Payment Receipt</a>` : ''}
                    ${data.invoiceUrl ? `<a href="${data.invoiceUrl}" target="_blank" style="display: inline-block; padding: 10px 20px; background: #ffffff; color: #111827; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px; border: 1px solid #d1d5db; margin-left: 8px;">View Invoice</a>` : ''}
                    ${data.invoicePdf ? `<a href="${data.invoicePdf}" target="_blank" style="display: inline-block; padding: 10px 20px; background: #ffffff; color: #111827; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px; border: 1px solid #d1d5db; margin-left: 8px;">Download Invoice PDF</a>` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          `;
}

export function ticketsList(data: OrderEmailData, walletResults: WalletResult[], sectionHeading: string): string {
  const ticketCards = data.tickets
    .map(
      (ticket) => {
        const wallet = walletResults.find((w) => w.ticketId === ticket.id);
        const hasWallet = wallet && (wallet.applePass || wallet.googleLink);
        return `
      <tr>
        <td style="padding: 8px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
            <tr>
              <td style="padding: 16px; text-align: center;">
                <img src="cid:qr-${ticket.id}" alt="QR Code" width="160" height="160" style="display: block; margin: 0 auto;" />
              </td>
              <td style="padding: 16px; vertical-align: middle;">
                <p style="margin: 0 0 4px; font-size: 14px; font-weight: 600; color: #111827;">${ticket.tierName}</p>
                ${ticket.seatLabel ? `<p style="margin: 0 0 4px; font-size: 13px; color: #374151;">Seat: ${ticket.seatLabel}</p>` : ''}
                <p style="margin: 0; font-size: 12px; color: #6b7280;">Ticket #${ticket.id.slice(0, 8)}</p>
              </td>
            </tr>${hasWallet ? `
            <tr>
              <td colspan="2" style="padding: 4px 16px 12px; text-align: center;">
                ${wallet.applePass ? `<a href="cid:pass-${ticket.id}" style="display:inline-block; margin:4px; text-decoration:none;">
                  <span style="display:inline-block; background:#000; color:#fff; padding:8px 16px; border-radius:8px; font-size:13px; font-weight:600;">&#63743; Add to Apple Wallet</span>
                </a>` : ''}
                ${wallet.googleLink ? `<a href="${wallet.googleLink}" style="display:inline-block; margin:4px; text-decoration:none;" target="_blank">
                  <span style="display:inline-block; background:#1a73e8; color:#fff; padding:8px 16px; border-radius:8px; font-size:13px; font-weight:600;">Add to Google Wallet</span>
                </a>` : ''}
              </td>
            </tr>` : ''}
            <tr>
              <td colspan="2" style="padding: 0 16px 14px; text-align: center;">
                <a href="${SHOP_URL}/t/${ticket.qr_code_secret}" target="_blank" style="font-size: 13px; color: #ea580c; font-weight: 600; text-decoration: none;">&#8599; Share this ticket</a>
                <span style="display: block; font-size: 11px; color: #9ca3af; margin-top: 3px;">Coming with someone? Send them their ticket to add to their own wallet.</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
      }
    )
    .join('');

  return `
          <!-- Tickets -->
          <tr>
            <td style="padding: 16px 32px 24px;">
              <h3 style="margin: 0 0 12px; font-size: 15px; font-weight: 600; color: #111827;">${sectionHeading}</h3>
              <p style="margin: 0 0 12px; font-size: 13px; color: #6b7280;">
                Show the QR code at the venue entrance for check-in.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${ticketCards}
              </table>
            </td>
          </tr>
`;
}
