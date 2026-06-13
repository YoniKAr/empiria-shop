import { formatCurrency } from '@/lib/utils';
import { SHOP_URL } from '@/lib/urls';
import type { OrderEmailData, WalletResult } from '@/lib/email';

// ---- Palette ----
const ACCENT = '#F15A29'; // Empiria orange
const INK = '#0F172A';    // headings
const BODY = '#64748B';   // body text
const MUTED = '#94A3B8';  // captions
const BORDER = '#E8EAED'; // hairlines

/**
 * Escape a value for safe interpolation into email HTML. User-controlled fields
 * (event title, organizer/attendee names, venue, tier names, seat labels,
 * coupon codes) flow into these templates raw and would otherwise allow HTML
 * injection into the rendered email.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Whitelist a URL for an href attribute: only http(s)/mailto schemes are
 * allowed (blocks javascript:/data: etc.), and the result is attribute-escaped.
 * Anything else collapses to '#'.
 */
function safeUrl(url: unknown): string {
  const s = String(url ?? '').trim();
  return /^(https?:|mailto:)/i.test(s) ? escapeHtml(s) : '#';
}

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
          <!-- Hero / Confirmation -->
          <tr>
            <td style="padding: 36px 32px 8px; text-align: center;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 0 auto 18px;">
                <tr><td style="width: 64px; height: 64px; background: #DCFCE7; border-radius: 50%; text-align: center; vertical-align: middle; font-size: 32px; line-height: 64px; color: #16A34A;">&#10003;</td></tr>
              </table>
              <h1 style="margin: 0 0 8px; font-size: 26px; font-weight: 800; color: ${INK}; letter-spacing: -0.02em;">You're all set, ${escapeHtml(data.attendeeName || 'there')}!</h1>
              <p style="margin: 0 auto; max-width: 420px; font-size: 15px; line-height: 1.55; color: ${BODY};">
                Your order is confirmed. ${confirmation}
              </p>
            </td>
          </tr>
`;
}

export function eventDetailsBlock(data: OrderEmailData): string {
  const eventDateFormatted = formatEventDate(data.eventDate, data.eventEndDate);
  const venue = [data.venueName, data.city].filter(Boolean).join(', ');
  const isOnline = data.locationType === 'virtual' || data.locationType === 'hybrid';

  return `
          <!-- Event Details -->
          <tr>
            <td style="padding: 28px 32px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #FBFBFC; border: 1px solid ${BORDER}; border-left: 4px solid ${ACCENT}; border-radius: 12px;">
                <tr>
                  <td style="padding: 22px 24px;">
                    <h2 style="margin: 0 0 16px; font-size: 19px; font-weight: 700; color: ${INK};">${escapeHtml(data.eventTitle)}</h2>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="padding: 0 0 10px; width: 92px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${MUTED}; vertical-align: top;">When</td>
                        <td style="padding: 0 0 10px; font-size: 14px; color: ${INK}; vertical-align: top;">${eventDateFormatted}</td>
                      </tr>
                      ${venue ? `<tr>
                        <td style="padding: 0 0 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${MUTED}; vertical-align: top;">Where</td>
                        <td style="padding: 0 0 10px; font-size: 14px; color: ${INK}; vertical-align: top;">${escapeHtml(venue)}</td>
                      </tr>` : ''}
                      ${data.organizerName ? `<tr>
                        <td style="padding: 0 0 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${MUTED}; vertical-align: top;">Host</td>
                        <td style="padding: 0 0 10px; font-size: 14px; color: ${INK}; vertical-align: top;">${escapeHtml(data.organizerName)}</td>
                      </tr>` : ''}
                      ${isOnline && data.meetingLink ? `<tr>
                        <td style="font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${MUTED}; vertical-align: top;">Online</td>
                        <td style="font-size: 14px; vertical-align: top;"><a href="${safeUrl(data.meetingLink)}" target="_blank" style="color: ${ACCENT}; font-weight: 600; text-decoration: none;">Join the meeting &rarr;</a></td>
                      </tr>` : ''}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
`;
}

export function orderSummaryTable(data: OrderEmailData): string {
  const summaryRow = (label: string, value: string, color = BODY) => `
                    <tr>
                      <td style="padding: 9px 0; font-size: 14px; color: ${color};">${label}</td>
                      <td style="padding: 9px 0; font-size: 14px; color: ${color}; text-align: right;">${value}</td>
                    </tr>`;

  const lineItemRows = data.lineItems
    .map(
      (item) => `
                    <tr>
                      <td style="padding: 9px 0; font-size: 14px; color: ${INK};">
                        ${escapeHtml(item.tierName)}
                        <span style="color: ${MUTED}; font-weight: 400;">&times; ${item.quantity}</span>
                      </td>
                      <td style="padding: 9px 0; font-size: 14px; color: ${INK}; text-align: right;">
                        ${formatCurrency(item.unitPrice * item.quantity, data.currency)}
                      </td>
                    </tr>`
    )
    .join('');

  return `
          <!-- Order Summary -->
          <tr>
            <td style="padding: 20px 32px 8px;">
              <h3 style="margin: 0 0 12px; font-size: 16px; font-weight: 700; color: ${INK};">Order summary</h3>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #FBFBFC; border: 1px solid ${BORDER}; border-radius: 12px;">
                <tr><td style="padding: 6px 20px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    ${lineItemRows}
                    ${data.convenienceFee && data.convenienceFee > 0 ? summaryRow('Service fee', formatCurrency(data.convenienceFee, data.currency), MUTED) : ''}
                    ${data.convenienceFeeHST && data.convenienceFeeHST > 0 ? summaryRow('HST on service fee', formatCurrency(data.convenienceFeeHST, data.currency), MUTED) : ''}
                    ${data.ticketTax && data.ticketTax > 0 ? summaryRow('Sales tax (HST 13%)', formatCurrency(data.ticketTax, data.currency), MUTED) : ''}
                    ${data.discountAmount && data.discountAmount > 0 ? summaryRow(`Discount${data.couponCode ? ` (${escapeHtml(data.couponCode)})` : ''}`, `-${formatCurrency(data.discountAmount, data.currency)}`, '#16A34A') : ''}
                    <tr><td colspan="2" style="border-top: 1px solid ${BORDER}; font-size: 0; line-height: 0;">&nbsp;</td></tr>
                    <tr>
                      <td style="padding: 12px 0 6px; font-size: 16px; font-weight: 800; color: ${INK};">Total paid</td>
                      <td style="padding: 12px 0 6px; font-size: 16px; font-weight: 800; color: ${INK}; text-align: right;">${formatCurrency(data.total, data.currency)}</td>
                    </tr>
                  </table>
                </td></tr>
              </table>
              <p style="margin: 10px 0 0; font-size: 12px; color: ${MUTED};">Order #${escapeHtml(data.orderId.slice(0, 8).toUpperCase())}</p>
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
            <td style="padding: 20px 32px 8px; text-align: center;">
              ${data.receiptUrl ? `<a href="${safeUrl(data.receiptUrl)}" target="_blank" style="display: inline-block; margin: 4px; padding: 11px 22px; background: ${INK}; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 9px;">View receipt</a>` : ''}
              ${data.invoiceUrl ? `<a href="${safeUrl(data.invoiceUrl)}" target="_blank" style="display: inline-block; margin: 4px; padding: 11px 22px; background: #ffffff; color: ${INK}; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 9px; border: 1px solid #D1D5DB;">View invoice</a>` : ''}
              ${data.invoicePdf ? `<a href="${safeUrl(data.invoicePdf)}" target="_blank" style="display: inline-block; margin: 4px; padding: 11px 22px; background: #ffffff; color: ${INK}; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 9px; border: 1px solid #D1D5DB;">Invoice PDF</a>` : ''}
            </td>
          </tr>`;
}

export function ticketsList(data: OrderEmailData, walletResults: WalletResult[], sectionHeading: string): string {
  const ticketCards = data.tickets
    .map(
      (ticket) => {
        const wallet = walletResults.find((w) => w.ticketId === ticket.id);
        const hasWallet = wallet && (wallet.applePass || wallet.googleLink);
        return `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border: 1px solid ${BORDER}; border-radius: 14px; overflow: hidden; margin-bottom: 14px; background: #ffffff;">
                <tr>
                  <td style="padding: 18px 20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td width="128" valign="top" style="padding-right: 18px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid ${BORDER}; border-radius: 10px;">
                            <tr><td style="padding: 7px;">
                              <img src="cid:qr-${ticket.id}" alt="Entry QR code" width="110" height="110" style="display: block; border-radius: 4px;" />
                            </td></tr>
                          </table>
                        </td>
                        <td valign="middle">
                          <p style="margin: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${ACCENT};">Admit One</p>
                          <p style="margin: 0 0 4px; font-size: 17px; font-weight: 700; color: ${INK};">${escapeHtml(ticket.tierName)}</p>
                          ${ticket.seatLabel ? `<p style="margin: 0 0 4px; font-size: 14px; color: ${BODY};">Seat <strong style="color: ${INK};">${escapeHtml(ticket.seatLabel)}</strong></p>` : ''}
                          <p style="margin: 6px 0 0; font-size: 12px; color: ${MUTED}; font-family: ui-monospace, 'SF Mono', Menlo, monospace;">#${escapeHtml(ticket.id.slice(0, 8).toUpperCase())}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 20px 18px;">
                    <div style="border-top: 1px dashed ${BORDER}; padding-top: 14px;">
                      ${wallet?.applePass ? `<a href="${SHOP_URL}/api/wallet/apple/share/${ticket.qr_code_secret}" target="_blank" style="display: inline-block; margin: 0 8px 4px 0; text-decoration: none;"><img src="cid:apple-wallet-badge" alt="Add to Apple Wallet" height="40" style="display: inline-block; height: 40px; width: auto; border: 0;" /></a>` : ''}
                      ${wallet?.googleLink ? `<a href="${safeUrl(wallet.googleLink)}" target="_blank" style="display: inline-block; margin: 0 0 4px; text-decoration: none;"><img src="cid:google-wallet-badge" alt="Add to Google Wallet" height="40" style="display: inline-block; height: 40px; width: auto; border: 0;" /></a>` : ''}
                      ${hasWallet ? `<p style="margin: 10px 0 2px; font-size: 11px; color: ${MUTED};">Your wallet passes are also attached to this email.</p>` : ''}
                      <p style="margin: 10px 0 0; font-size: 13px;">
                        <a href="${SHOP_URL}/t/${ticket.qr_code_secret}" target="_blank" style="color: ${ACCENT}; font-weight: 600; text-decoration: none;">&#8599; Share this ticket</a>
                        <span style="color: ${MUTED}; font-size: 12px;">&nbsp; &mdash; coming with someone? send them their ticket to add to their own wallet.</span>
                      </p>
                    </div>
                  </td>
                </tr>
              </table>`;
      }
    )
    .join('');

  return `
          <!-- Tickets -->
          <tr>
            <td style="padding: 28px 32px 8px;">
              <h3 style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: ${INK};">${escapeHtml(sectionHeading)}</h3>
              <p style="margin: 0 0 16px; font-size: 13px; color: ${BODY};">
                Show the QR code at the entrance, or add your tickets to your phone's wallet.
              </p>
              ${ticketCards}
            </td>
          </tr>
`;
}
