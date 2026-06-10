import QRCodeLib from 'qrcode';
import { sendEmail } from '@/lib/mailer';
import { generateApplePass, generateGoogleWalletLink } from './wallet';
import { CtaLabel } from '@/lib/eventFields';
import { render as ticketsTpl } from '@/designs/email-templates/order-confirmation-tickets';
import { render as registrationTpl } from '@/designs/email-templates/order-confirmation-registration';
import { render as rsvpTpl } from '@/designs/email-templates/order-confirmation-rsvp';

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

export interface WalletResult {
  ticketId: string;
  applePass: Buffer | null;
  googleLink: string | null;
}

export interface OrderEmailData {
  to: string;
  attendeeName: string;
  orderId: string;
  eventTitle: string;
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
  // Build event data for wallet generation
  const eventData = {
    id: data.orderId, // Use orderId as fallback since we don't have event id
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

  const pick = ({ buy_tickets: ticketsTpl, register: registrationTpl, rsvp: rsvpTpl } as const)[(data.ctaLabel as CtaLabel) ?? 'buy_tickets'] ?? ticketsTpl;
  const { subject, html } = pick(data, walletResults);

  // Build wallet .pkpass attachments
  const walletAttachments = walletResults
    .filter((w) => w.applePass)
    .map((w) => ({
      filename: `ticket-${w.ticketId}.pkpass`,
      content: w.applePass!,
      contentType: 'application/vnd.apple.pkpass' as const,
    }));

  await sendEmail({
    to: data.to,
    subject,
    html,
    attachments: [
      ...qrAttachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: 'image/png' as const,
        cid: a.cid,
      })),
      ...walletAttachments,
    ],
  });
}
