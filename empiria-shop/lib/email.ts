import QRCodeLib from 'qrcode';
import { readFile } from 'fs/promises';
import path from 'path';
import { resend } from '@/lib/resend';
import { formatCurrency } from '@/lib/utils';
import { generateApplePass, generateGoogleWalletLink } from './wallet';
import { CTA_NOUN, CtaLabel } from '@/lib/eventFields';

interface TicketInfo {
  id: string;
  qr_code_secret: string;
  tierName: string;
  seatLabel?: string;
}

interface LineItem {
  tierName: string;
  quantity: number;
  unitPrice: number;
}

interface OrderEmailData {
  to: string;
  attendeeName: string;
  orderId: string;
  eventId?: string;
  eventTitle: string;
  organizerName?: string;
  eventDate: string;
  eventEndDate?: string;
  venueName: string;
  city: string;
  meetingLink?: string;
  locationType?: string;
  lineItems: LineItem[];
  total: number;
  processingFee?: number;
  convenienceFee?: number;
  convenienceFeeHST?: number;
  ticketTax?: number;
  discountAmount?: number;
  couponCode?: string;
  currency: string;
  tickets: TicketInfo[];
  receiptUrl?: string;
  invoiceUrl?: string;
  invoicePdf?: string;
  ctaLabel?: CtaLabel;
}

export async function sendOrderConfirmationEmail(data: OrderEmailData) {
  const noun = CTA_NOUN[(data.ctaLabel as CtaLabel) ?? 'buy_tickets'];
  // Build event data for wallet generation
  const eventData = {
    id: data.eventId ?? data.orderId,
    title: data.eventTitle,
    start_at: data.eventDate,
    end_at: data.eventEndDate || null,
    venue_name: data.venueName,
    city: data.city,
  };

  // Generate QR code PNGs and wallet passes in parallel
  const [qrAttachments, walletResults] = await Promise.all([
    Promise.all(
      data.tickets.map(async (ticket) => {
        const buffer = await QRCodeLib.toBuffer(ticket.qr_code_secret, {
          width: 200,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
          errorCorrectionLevel: 'M',
        });
        return {
          filename: `qr-${ticket.id}.png`,
          content: buffer,
          cid: `qr-${ticket.id}`,
        };
      })
    ),
    Promise.all(
      data.tickets.map(async (ticket) => {
        const tierData = { id: ticket.id, name: ticket.tierName };
        const [applePass, googleLink] = await Promise.all([
          generateApplePass({ id: ticket.id, qr_code_secret: ticket.qr_code_secret, seat_label: ticket.seatLabel }, eventData, tierData),
          generateGoogleWalletLink({ id: ticket.id, qr_code_secret: ticket.qr_code_secret, seat_label: ticket.seatLabel }, eventData, tierData),
        ]);
        return { ticketId: ticket.id, applePass, googleLink };
      })
    ),
  ]);

  const anyApplePass = walletResults.some((w) => w.applePass);
  const anyGoogleLink = walletResults.some((w) => w.googleLink);

  const html = buildEmailHtml(data, walletResults, {
    appleBadge: anyApplePass,
    googleBadge: anyGoogleLink,
  });

  const fromEmail = 'Empiria <tickets@empiriaindia.com>';

  // Inline images embedded via CID — these render even when a client blocks
  // remote images, and use the official Apple/Google wallet badge artwork.
  const publicDir = path.join(process.cwd(), 'public');
  const [logoBuffer, appleBadgeBuffer, googleBadgeBuffer] = await Promise.all([
    readFile(path.join(publicDir, 'logo.png')).catch(() => null),
    anyApplePass
      ? readFile(path.join(publicDir, 'wallet', 'add-to-apple-wallet.png')).catch(() => null)
      : null,
    anyGoogleLink
      ? readFile(path.join(publicDir, 'wallet', 'add-to-google-wallet.png')).catch(() => null)
      : null,
  ]);

  const inlineImage = (buf: Buffer | null, filename: string, cid: string) =>
    buf
      ? [{ filename, content: buf, contentType: 'image/png' as const, contentId: cid }]
      : [];

  // Build wallet .pkpass attachments. contentId lets the in-email Apple
  // Wallet button reference the attached pass (cid:pass-<id>).
  const walletAttachments = walletResults
    .filter((w) => w.applePass)
    .map((w) => ({
      filename: `ticket-${w.ticketId}.pkpass`,
      content: w.applePass!,
      contentType: 'application/vnd.apple.pkpass' as const,
      contentId: `pass-${w.ticketId}`,
    }));

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: data.to,
    subject: `Your ${noun.plural} for ${data.eventTitle} — Order #${data.orderId.slice(0, 8)}`,
    html,
    attachments: [
      ...inlineImage(logoBuffer, 'logo.png', 'empiria-logo'),
      ...inlineImage(appleBadgeBuffer, 'add-to-apple-wallet.png', 'apple-wallet-badge'),
      ...inlineImage(googleBadgeBuffer, 'add-to-google-wallet.png', 'google-wallet-badge'),
      ...qrAttachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: 'image/png' as const,
        contentId: a.cid,
      })),
      ...walletAttachments,
    ],
  });

  if (error) {
    throw new Error(`Resend API error: ${JSON.stringify(error)}`);
  }
}

function formatEventDate(startDate: string, endDate?: string): string {
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

function buildEmailHtml(
  data: OrderEmailData,
  walletResults: Array<{ticketId: string; applePass: Buffer | null; googleLink: string | null}>,
  badges: { appleBadge: boolean; googleBadge: boolean },
): string {
  const noun = CTA_NOUN[(data.ctaLabel as CtaLabel) ?? 'buy_tickets'];
  const eventDateFormatted = formatEventDate(
    data.eventDate,
    data.eventEndDate
  );
  const venue = [data.venueName, data.city].filter(Boolean).join(', ');
  const isOnline = data.locationType === 'virtual' || data.locationType === 'hybrid';
  const baseUrl = (process.env.APP_BASE_URL || 'https://empiriaindia.com').replace(/\/$/, '');

  // ---- Palette ----
  const ACCENT = '#F15A29';      // Empiria orange
  const INK = '#0F172A';         // headings
  const BODY = '#64748B';        // body text
  const MUTED = '#94A3B8';       // captions
  const BORDER = '#E8EAED';      // hairlines
  const PAGE_BG = '#F4F5F7';     // page background

  const summaryRow = (label: string, value: string, color = BODY, strong = false) => `
                <tr>
                  <td style="padding: 9px 0; font-size: 14px; color: ${color}; ${strong ? 'font-weight: 600;' : ''}">${label}</td>
                  <td style="padding: 9px 0; font-size: 14px; color: ${color}; text-align: right; ${strong ? 'font-weight: 600;' : ''}">${value}</td>
                </tr>`;

  const lineItemRows = data.lineItems
    .map(
      (item) => `
                <tr>
                  <td style="padding: 9px 0; font-size: 14px; color: ${INK};">
                    ${item.tierName}
                    <span style="color: ${MUTED}; font-weight: 400;">&times; ${item.quantity}</span>
                  </td>
                  <td style="padding: 9px 0; font-size: 14px; color: ${INK}; text-align: right;">
                    ${formatCurrency(item.unitPrice * item.quantity, data.currency)}
                  </td>
                </tr>`
    )
    .join('');

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
                          <p style="margin: 0 0 4px; font-size: 17px; font-weight: 700; color: ${INK};">${ticket.tierName}</p>
                          ${ticket.seatLabel ? `<p style="margin: 0 0 4px; font-size: 14px; color: ${BODY};">Seat <strong style="color: ${INK};">${ticket.seatLabel}</strong></p>` : ''}
                          <p style="margin: 6px 0 0; font-size: 12px; color: ${MUTED}; font-family: ui-monospace, 'SF Mono', Menlo, monospace;">#${ticket.id.slice(0, 8).toUpperCase()}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 20px 18px;">
                    <div style="border-top: 1px dashed ${BORDER}; padding-top: 14px;">
                      ${wallet?.applePass && badges.appleBadge ? `<a href="cid:pass-${ticket.id}" style="display: inline-block; margin: 0 8px 4px 0; text-decoration: none;"><img src="cid:apple-wallet-badge" alt="Add to Apple Wallet" height="40" style="display: inline-block; height: 40px; width: auto; border: 0;" /></a>` : ''}
                      ${wallet?.googleLink && badges.googleBadge ? `<a href="${wallet.googleLink}" target="_blank" style="display: inline-block; margin: 0 0 4px; text-decoration: none;"><img src="cid:google-wallet-badge" alt="Add to Google Wallet" height="40" style="display: inline-block; height: 40px; width: auto; border: 0;" /></a>` : ''}
                      ${hasWallet ? `<p style="margin: 10px 0 2px; font-size: 11px; color: ${MUTED};">Your wallet passes are also attached to this email.</p>` : ''}
                      <p style="margin: 10px 0 0; font-size: 13px;">
                        <a href="${baseUrl}/t/${ticket.qr_code_secret}" target="_blank" style="color: ${ACCENT}; font-weight: 600; text-decoration: none;">&#8599; Share this ticket</a>
                        <span style="color: ${MUTED}; font-size: 12px;">&nbsp; &mdash; coming with someone? send them their ticket to add to their own wallet.</span>
                      </p>
                    </div>
                  </td>
                </tr>
              </table>`;
      }
    )
    .join('');

  const hasReceiptRow = data.receiptUrl || data.invoiceUrl || data.invoicePdf;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light only" />
  <title>Order Confirmation</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${PAGE_BG}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">You're going to ${data.eventTitle}! Your ${noun.plural} and QR codes are inside.</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: ${PAGE_BG};">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 4px 24px rgba(15,23,42,0.07);">

          <!-- Header / Logo -->
          <tr>
            <td style="padding: 28px 32px 22px; text-align: center; background: #ffffff;">
              <img src="cid:empiria-logo" alt="Empiria" width="150" height="50" style="display: inline-block; border: 0;" />
            </td>
          </tr>
          <tr><td style="height: 4px; background: ${ACCENT}; line-height: 4px; font-size: 0;">&nbsp;</td></tr>

          <!-- Hero / Confirmation -->
          <tr>
            <td style="padding: 36px 32px 8px; text-align: center;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 0 auto 18px;">
                <tr><td style="width: 64px; height: 64px; background: #DCFCE7; border-radius: 50%; text-align: center; vertical-align: middle; font-size: 32px; line-height: 64px; color: #16A34A;">&#10003;</td></tr>
              </table>
              <h1 style="margin: 0 0 8px; font-size: 26px; font-weight: 800; color: ${INK}; letter-spacing: -0.02em;">You're all set, ${data.attendeeName || 'there'}!</h1>
              <p style="margin: 0 auto; max-width: 420px; font-size: 15px; line-height: 1.55; color: ${BODY};">
                Your order is confirmed. ${noun.confirmation}
              </p>
            </td>
          </tr>

          <!-- Event Details -->
          <tr>
            <td style="padding: 28px 32px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #FBFBFC; border: 1px solid ${BORDER}; border-left: 4px solid ${ACCENT}; border-radius: 12px;">
                <tr>
                  <td style="padding: 22px 24px;">
                    <h2 style="margin: 0 0 16px; font-size: 19px; font-weight: 700; color: ${INK};">${data.eventTitle}</h2>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="padding: 0 0 10px; width: 92px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${MUTED}; vertical-align: top;">When</td>
                        <td style="padding: 0 0 10px; font-size: 14px; color: ${INK}; vertical-align: top;">${eventDateFormatted}</td>
                      </tr>
                      ${venue ? `<tr>
                        <td style="padding: 0 0 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${MUTED}; vertical-align: top;">Where</td>
                        <td style="padding: 0 0 10px; font-size: 14px; color: ${INK}; vertical-align: top;">${venue}</td>
                      </tr>` : ''}
                      ${data.organizerName ? `<tr>
                        <td style="padding: 0 0 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${MUTED}; vertical-align: top;">Host</td>
                        <td style="padding: 0 0 10px; font-size: 14px; color: ${INK}; vertical-align: top;">${data.organizerName}</td>
                      </tr>` : ''}
                      ${isOnline && data.meetingLink ? `<tr>
                        <td style="font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${MUTED}; vertical-align: top;">Online</td>
                        <td style="font-size: 14px; vertical-align: top;"><a href="${data.meetingLink}" target="_blank" style="color: ${ACCENT}; font-weight: 600; text-decoration: none;">Join the meeting &rarr;</a></td>
                      </tr>` : ''}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Tickets -->
          <tr>
            <td style="padding: 28px 32px 8px;">
              <h3 style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: ${INK};">${noun.section}</h3>
              <p style="margin: 0 0 16px; font-size: 13px; color: ${BODY};">
                Show the QR code at the entrance, or add your ${noun.plural} to your phone's wallet.
              </p>
              ${ticketCards}
            </td>
          </tr>

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
                    ${data.discountAmount && data.discountAmount > 0 ? summaryRow(`Discount${data.couponCode ? ` (${data.couponCode})` : ''}`, `-${formatCurrency(data.discountAmount, data.currency)}`, '#16A34A') : ''}
                    <tr><td colspan="2" style="border-top: 1px solid ${BORDER}; font-size: 0; line-height: 0;">&nbsp;</td></tr>
                    <tr>
                      <td style="padding: 12px 0 6px; font-size: 16px; font-weight: 800; color: ${INK};">Total paid</td>
                      <td style="padding: 12px 0 6px; font-size: 16px; font-weight: 800; color: ${INK}; text-align: right;">${formatCurrency(data.total, data.currency)}</td>
                    </tr>
                  </table>
                </td></tr>
              </table>
              <p style="margin: 10px 0 0; font-size: 12px; color: ${MUTED};">Order #${data.orderId.slice(0, 8).toUpperCase()}</p>
            </td>
          </tr>

          <!-- Payment Receipt & Invoice -->
          ${hasReceiptRow ? `
          <tr>
            <td style="padding: 20px 32px 8px; text-align: center;">
              ${data.receiptUrl ? `<a href="${data.receiptUrl}" target="_blank" style="display: inline-block; margin: 4px; padding: 11px 22px; background: ${INK}; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 9px;">View receipt</a>` : ''}
              ${data.invoiceUrl ? `<a href="${data.invoiceUrl}" target="_blank" style="display: inline-block; margin: 4px; padding: 11px 22px; background: #ffffff; color: ${INK}; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 9px; border: 1px solid #D1D5DB;">View invoice</a>` : ''}
              ${data.invoicePdf ? `<a href="${data.invoicePdf}" target="_blank" style="display: inline-block; margin: 4px; padding: 11px 22px; background: #ffffff; color: ${INK}; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 9px; border: 1px solid #D1D5DB;">Invoice PDF</a>` : ''}
            </td>
          </tr>` : ''}

          <!-- Footer -->
          <tr>
            <td style="padding: 28px 32px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top: 1px solid ${BORDER};">
                <tr>
                  <td style="padding: 22px 0 0; text-align: center;">
                    <img src="cid:empiria-logo" alt="Empiria" width="108" height="36" style="display: inline-block; border: 0; opacity: 0.7;" />
                    <p style="margin: 14px 0 0; font-size: 12px; line-height: 1.6; color: ${MUTED};">
                      Questions about your order? Reply to this email or contact ${data.organizerName ? `<strong style="color: ${BODY};">${data.organizerName}</strong>` : 'the event organizer'}.<br />
                      &copy; ${new Date().getFullYear()} Empiria &middot; empiriaindia.com
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
