import { PKPass } from 'passkit-generator';
import { readFile } from 'fs/promises';
import { SignJWT, importPKCS8 } from 'jose';
import path from 'path';

// ---------- Shared types ----------

interface TicketData {
  id: string;
  qr_code_secret: string;
  seat_label?: string | null;
}

interface EventData {
  id: string;
  title: string;
  start_at: string;
  end_at?: string | null;
  venue_name?: string | null;
  city?: string | null;
}

interface TierData {
  id: string;
  name: string;
}

// ---------- Apple Wallet ----------

export async function generateApplePass(
  ticket: TicketData,
  event: EventData,
  tier: TierData,
): Promise<Buffer | null> {
  const passTypeId = process.env.APPLE_PASS_TYPE_ID;
  const teamId = process.env.APPLE_TEAM_ID;
  const certBase64 = process.env.APPLE_PASS_CERT_BASE64;
  const certPassword = process.env.APPLE_PASS_CERT_PASSWORD;
  const wwdrBase64 = process.env.APPLE_WWDR_CERT_BASE64;

  if (!passTypeId || !teamId || !certBase64 || !certPassword || !wwdrBase64) {
    return null;
  }

  try {
    const signerCert = Buffer.from(certBase64, 'base64');
    const wwdr = Buffer.from(wwdrBase64, 'base64');

    // Load pass images
    const walletDir = path.join(process.cwd(), 'public', 'wallet');
    const [icon, icon2x, logo, logo2x, strip, strip2x] = await Promise.all([
      readFile(path.join(walletDir, 'icon.png')),
      readFile(path.join(walletDir, 'icon@2x.png')),
      readFile(path.join(walletDir, 'logo.png')),
      readFile(path.join(walletDir, 'logo@2x.png')),
      readFile(path.join(walletDir, 'strip.png')),
      readFile(path.join(walletDir, 'strip@2x.png')),
    ]);

    const eventDate = new Date(event.start_at);
    const dateStr = eventDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const timeStr = eventDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const pass = new PKPass(
      {
        'icon.png': icon,
        'icon@2x.png': icon2x,
        'logo.png': logo,
        'logo@2x.png': logo2x,
        'strip.png': strip,
        'strip@2x.png': strip2x,
      },
      {
        wwdr,
        signerCert,
        signerKey: signerCert, // .p12 contains both cert and key
        signerKeyPassphrase: certPassword,
      },
      {
        serialNumber: ticket.id,
        passTypeIdentifier: passTypeId,
        teamIdentifier: teamId,
        organizationName: 'Empiria',
        description: `Ticket for ${event.title}`,
        foregroundColor: 'rgb(255, 255, 255)',
        backgroundColor: 'rgb(17, 24, 39)',
        labelColor: 'rgb(156, 163, 175)',
      },
    );

    pass.type = 'eventTicket';

    pass.primaryFields.push({
      key: 'event',
      label: 'EVENT',
      value: event.title,
    });

    pass.secondaryFields.push(
      {
        key: 'date',
        label: 'DATE',
        value: `${dateStr} · ${timeStr}`,
      },
      {
        key: 'venue',
        label: 'VENUE',
        value: [event.venue_name, event.city].filter(Boolean).join(', ') || 'TBA',
      },
    );

    pass.auxiliaryFields.push({
      key: 'tier',
      label: 'TIER',
      value: tier.name,
    });

    if (ticket.seat_label) {
      pass.auxiliaryFields.push({
        key: 'seat',
        label: 'SEAT',
        value: ticket.seat_label,
      });
    }

    pass.backFields.push(
      {
        key: 'ticketId',
        label: 'Ticket ID',
        value: ticket.id,
      },
      {
        key: 'eventName',
        label: 'Event',
        value: event.title,
      },
      {
        key: 'organizer',
        label: 'Powered by',
        value: 'Empiria — empiriaindia.com',
      },
    );

    pass.setBarcodes({
      format: 'PKBarcodeFormatQR',
      message: ticket.qr_code_secret,
      messageEncoding: 'iso-8859-1',
    });

    pass.setRelevantDate(eventDate);

    return pass.getAsBuffer();
  } catch (err) {
    console.error('Failed to generate Apple Wallet pass:', err);
    return null;
  }
}

// ---------- Google Wallet ----------

export async function generateGoogleWalletLink(
  ticket: TicketData,
  event: EventData,
  tier: TierData,
): Promise<string | null> {
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
  const serviceAccountEmail = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL;
  const keyBase64 = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_BASE64;

  if (!issuerId || !serviceAccountEmail || !keyBase64) {
    return null;
  }

  try {
    const keyJson = JSON.parse(
      Buffer.from(keyBase64, 'base64').toString('utf8'),
    );

    const eventDate = new Date(event.start_at);
    const venue = [event.venue_name, event.city].filter(Boolean).join(', ');
    const objectSuffix = `${issuerId}.ticket-${ticket.id}`;

    const eventTicketObject = {
      id: objectSuffix,
      classId: `${issuerId}.empiria-event-ticket`,
      state: 'ACTIVE',
      hexBackgroundColor: '#111827',
      logo: {
        sourceUri: {
          uri: 'https://empiriaindia.com/logo-white.png',
        },
        contentDescription: {
          defaultValue: { language: 'en-US', value: 'Empiria' },
        },
      },
      eventName: {
        defaultValue: { language: 'en-US', value: event.title },
      },
      venue: {
        name: {
          defaultValue: { language: 'en-US', value: venue || 'TBA' },
        },
      },
      dateTime: {
        start: eventDate.toISOString(),
        ...(event.end_at ? { end: new Date(event.end_at).toISOString() } : {}),
      },
      ticketType: {
        defaultValue: { language: 'en-US', value: tier.name },
      },
      ...(ticket.seat_label
        ? {
            seatInfo: {
              seat: {
                defaultValue: { language: 'en-US', value: ticket.seat_label },
              },
            },
          }
        : {}),
      ticketNumber: ticket.id.slice(0, 8).toUpperCase(),
      barcode: {
        type: 'QR_CODE',
        value: ticket.qr_code_secret,
      },
    };

    const claims = {
      iss: serviceAccountEmail,
      aud: 'google',
      typ: 'savetowallet',
      origins: ['https://empiriaindia.com'],
      payload: {
        eventTicketObjects: [eventTicketObject],
      },
    };

    const privateKey = await importPKCS8(keyJson.private_key, 'RS256');

    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuedAt()
      .sign(privateKey);

    return `https://pay.google.com/gp/v/save/${token}`;
  } catch (err) {
    console.error('Failed to generate Google Wallet link:', err);
    return null;
  }
}
