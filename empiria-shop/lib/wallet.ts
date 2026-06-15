import { PKPass } from 'passkit-generator';
import { readFile } from 'fs/promises';
import { SignJWT, importPKCS8 } from 'jose';
import forge from 'node-forge';
import path from 'path';
import { APEX_URL, SHOP_URL } from '@/lib/urls';

// Dedicated Empiria wallet-pass logo (square, light background). Used as the
// logo on every Google Wallet pass for consistent branding.
const WALLET_LOGO_URL =
  'https://ccotwfkcqghuykpzshjn.supabase.co/storage/v1/object/public/avatars/Screenshot%202026-06-13%20at%204.27.58%20PM.png';

// ---------- Shared types ----------

interface TicketData {
  id: string;
  qr_code_secret: string;
  seat_label?: string | null;
}

interface EventData {
  id: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  /** IANA timezone of the event (e.g. America/New_York). Occurrence times are
   *  stored as UTC instants and must be displayed in the event's own zone. */
  timezone?: string | null;
  venue_name?: string | null;
  city?: string | null;
  /** Logo for the wallet pass: organizer's logo, or the platform logo for
   *  platform-owned events. Falls back to the Empiria logo. */
  logoUrl?: string | null;
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
    // Extract PEM cert and key from the p12 bundle using node-forge
    const p12Der = Buffer.from(certBase64, 'base64').toString('binary');
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, certPassword);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag]?.[0];
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];

    if (!certBag?.cert || !keyBag?.key) {
      console.error('Failed to extract cert/key from Apple p12');
      return null;
    }

    const signerCert = forge.pki.certificateToPem(certBag.cert);
    const signerKey = forge.pki.privateKeyToPem(keyBag.key as forge.pki.rsa.PrivateKey);
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

    const eventTz = event.timezone || 'America/Toronto';
    const eventDate = new Date(event.starts_at);
    const dateStr = eventDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: eventTz,
    });
    const timeStr = eventDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: eventTz,
      timeZoneName: 'short',
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
        signerKey,
        signerKeyPassphrase: certPassword,
      },
      {
        serialNumber: ticket.id,
        passTypeIdentifier: passTypeId,
        teamIdentifier: teamId,
        organizationName: 'Empiria',
        description: `Ticket for ${event.title}`,
        foregroundColor: 'rgb(255, 255, 255)',
        backgroundColor: 'rgb(241, 90, 41)', // Empiria brand orange #F15A29
        labelColor: 'rgb(255, 226, 214)',
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
        value: `Empiria — ${new URL(APEX_URL).hostname.replace(/^www\./, '')}`,
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

// Mint a short-lived access token for the Wallet REST API from the service
// account (JWT-bearer grant).
async function getGoogleWalletAccessToken(serviceAccountEmail: string, privateKeyPem: string): Promise<string | null> {
  try {
    const key = await importPKCS8(privateKeyPem, 'RS256');
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/wallet_object.issuer' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(serviceAccountEmail)
      .setSubject(serviceAccountEmail)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

// Create-or-update the per-event Wallet class via REST so it always reflects the
// CURRENT event details/logo. Google ignores class changes embedded in the save
// JWT once a class exists, so this is required for edits/logo to take effect.
// Best-effort: any failure falls back to the JWT-embedded class.
async function upsertEventTicketClass(accessToken: string, classId: string, classBody: Record<string, unknown>): Promise<void> {
  const base = 'https://walletobjects.googleapis.com/walletobjects/v1/eventTicketClass';
  const url = `${base}/${encodeURIComponent(classId)}`;
  const authHeaders = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const getRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (getRes.status === 404) {
    await fetch(base, { method: 'POST', headers: authHeaders, body: JSON.stringify(classBody) });
  } else if (getRes.ok) {
    await fetch(url, { method: 'PUT', headers: authHeaders, body: JSON.stringify(classBody) });
  }
}

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

    const eventDate = new Date(event.starts_at);
    const venue = [event.venue_name, event.city].filter(Boolean).join(', ');
    // One class per EVENT (Google shows event name/venue/date/logo from the
    // class), one object per TICKET (seat/barcode/type live on the object).
    const classId = `${issuerId}.event-${event.id}`;
    const objectId = `${issuerId}.ticket-${ticket.id}`;

    const eventTicketClass = {
      id: classId,
      issuerName: 'Empiria Events',
      reviewStatus: 'underReview',
      hexBackgroundColor: '#F15A29', // Empiria brand orange
      logo: {
        sourceUri: {
          uri: WALLET_LOGO_URL,
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
        address: {
          defaultValue: { language: 'en-US', value: venue || 'TBA' },
        },
      },
      dateTime: {
        start: eventDate.toISOString(),
        ...(event.ends_at ? { end: new Date(event.ends_at).toISOString() } : {}),
      },
    };

    // Keep the class current (logo / name / venue / date) via REST — Google
    // won't update an existing class from the save JWT. Best-effort; on failure
    // the JWT-embedded class below still creates it on first save.
    try {
      const accessToken = await getGoogleWalletAccessToken(serviceAccountEmail, keyJson.private_key);
      if (accessToken) await upsertEventTicketClass(accessToken, classId, eventTicketClass);
    } catch (e) {
      console.error('[wallet] event class upsert failed (non-fatal):', e);
    }

    const eventTicketObject = {
      id: objectId,
      classId,
      state: 'ACTIVE',
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
      origins: [APEX_URL, SHOP_URL],
      payload: {
        // Include class definition so Google creates it if it doesn't exist yet
        eventTicketClasses: [eventTicketClass],
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
