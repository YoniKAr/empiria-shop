import QRCodeLib from 'qrcode';
import { readFile } from 'fs/promises';
import path from 'path';
import { sendEmail } from '@/lib/mailer';
import { generateApplePass, generateGoogleWalletLink } from './wallet';
import { CtaLabel } from '@/lib/eventFields';
import { render as ticketsTpl } from '@/designs/email-templates/order-confirmation-tickets';
import { render as registrationTpl } from '@/designs/email-templates/order-confirmation-registration';
import { render as rsvpTpl } from '@/designs/email-templates/order-confirmation-rsvp';
import { render as saleNotificationTpl } from '@/designs/email-templates/sale-notification';

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
  organizerName?: string;
  organizerAvatarUrl?: string | null;
  eventDate: string;
  eventEndDate?: string;
  eventTimezone?: string;
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

export interface SaleNotificationEmailData {
  to: string;
  organizerName: string;
  eventTitle: string;
  orderId: string;
  total: number;
  currency: string;
  quantity: number;
  buyerName?: string;
  buyerEmail?: string;
  lineItems: LineItem[];
  organizerPayout?: number;
  isPlatformEvent?: boolean;
}

/** Notify the event owner that a ticket sold (per-event notify_on_sale toggle). */
export async function sendSaleNotificationEmail(data: SaleNotificationEmailData) {
  const html = saleNotificationTpl({
    organizerName: data.organizerName,
    eventTitle: data.eventTitle,
    orderId: data.orderId,
    total: data.total,
    currency: data.currency,
    quantity: data.quantity,
    buyerName: data.buyerName,
    buyerEmail: data.buyerEmail,
    lineItems: data.lineItems,
    organizerPayout: data.organizerPayout,
    isPlatformEvent: data.isPlatformEvent,
  });
  await sendEmail({
    to: data.to,
    subject: `New sale: ${data.eventTitle}`,
    html,
  });
}

export async function sendOrderConfirmationEmail(data: OrderEmailData) {
  // Build event data for wallet generation
  const eventData = {
    id: data.orderId, // Use orderId as fallback since we don't have event id
    title: data.eventTitle,
    starts_at: data.eventDate,
    ends_at: data.eventEndDate || null,
    timezone: data.eventTimezone || null,
    venue_name: data.venueName,
    city: data.city,
    // Organizer's logo (or platform logo for platform-owned events) for the
    // wallet pass; falls back to the Empiria logo inside wallet.ts.
    logoUrl: data.organizerAvatarUrl || null,
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

  // Inline images the templates reference via cid: — the Empiria logo and the
  // official Apple/Google wallet badges. Attached so they render even when a
  // mail client blocks remote images.
  const anyApplePass = walletResults.some((w) => w.applePass);
  const anyGoogleLink = walletResults.some((w) => w.googleLink);
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
    buf ? [{ filename, content: buf, contentType: 'image/png' as const, cid }] : [];

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
      ...inlineImage(logoBuffer, 'logo.png', 'empiria-logo'),
      ...inlineImage(appleBadgeBuffer, 'add-to-apple-wallet.png', 'apple-wallet-badge'),
      ...inlineImage(googleBadgeBuffer, 'add-to-google-wallet.png', 'google-wallet-badge'),
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
