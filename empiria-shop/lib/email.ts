import QRCodeLib from 'qrcode';
import { resend } from '@/lib/resend';
import { formatCurrency } from '@/lib/utils';

interface TicketInfo {
  id: string;
  qr_code_secret: string;
  tierName: string;
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
  eventTitle: string;
  eventDate: string;
  eventEndDate?: string;
  venueName: string;
  city: string;
  lineItems: LineItem[];
  total: number;
  currency: string;
  tickets: TicketInfo[];
}

export async function sendOrderConfirmationEmail(data: OrderEmailData) {
  // Generate QR code PNGs as Buffers for CID attachment
  const qrAttachments = await Promise.all(
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
  );

  const html = buildEmailHtml(data);

  const fromEmail = 'Empiria <tickets@empiriaindia.com>';

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: data.to,
    subject: `Your tickets for ${data.eventTitle} — Order #${data.orderId.slice(0, 8)}`,
    html,
    attachments: qrAttachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: 'image/png',
      contentId: a.cid,
    })),
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

function buildEmailHtml(data: OrderEmailData): string {
  const eventDateFormatted = formatEventDate(
    data.eventDate,
    data.eventEndDate
  );
  const venue = [data.venueName, data.city].filter(Boolean).join(', ');

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

  const ticketCards = data.tickets
    .map(
      (ticket) => `
      <tr>
        <td style="padding: 8px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
            <tr>
              <td style="padding: 16px; text-align: center;">
                <img src="cid:qr-${ticket.id}" alt="QR Code" width="160" height="160" style="display: block; margin: 0 auto;" />
              </td>
              <td style="padding: 16px; vertical-align: middle;">
                <p style="margin: 0 0 4px; font-size: 14px; font-weight: 600; color: #111827;">${ticket.tierName}</p>
                <p style="margin: 0; font-size: 12px; color: #6b7280;">Ticket #${ticket.id.slice(0, 8)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Order Confirmation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background: #111827; padding: 24px 32px; text-align: center;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.025em;">Empiria</h1>
            </td>
          </tr>

          <!-- Confirmation Message -->
          <tr>
            <td style="padding: 32px 32px 16px;">
              <h2 style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #111827;">You're all set, ${data.attendeeName || 'there'}!</h2>
              <p style="margin: 0; font-size: 15px; color: #6b7280; line-height: 1.5;">
                Your order has been confirmed. Here are your tickets and order details.
              </p>
            </td>
          </tr>

          <!-- Event Details -->
          <tr>
            <td style="padding: 16px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">
                <tr>
                  <td style="padding: 20px;">
                    <h3 style="margin: 0 0 8px; font-size: 17px; font-weight: 700; color: #0c4a6e;">${data.eventTitle}</h3>
                    <p style="margin: 0 0 4px; font-size: 14px; color: #0369a1;">${eventDateFormatted}</p>
                    ${venue ? `<p style="margin: 0; font-size: 14px; color: #0369a1;">${venue}</p>` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

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

          <!-- Tickets -->
          <tr>
            <td style="padding: 16px 32px 24px;">
              <h3 style="margin: 0 0 12px; font-size: 15px; font-weight: 600; color: #111827;">Your Tickets</h3>
              <p style="margin: 0 0 12px; font-size: 13px; color: #6b7280;">
                Show the QR code at the venue entrance for check-in.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${ticketCards}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center; line-height: 1.5;">
                This email was sent by Empiria. If you have questions about your order, please contact the event organizer.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
