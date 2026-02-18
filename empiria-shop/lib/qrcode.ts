// ──────────────────────────────────────────────────
// 📁 lib/qrcode.ts — NEW FILE (create this)
// Requires: bun add qrcode && bun add -d @types/qrcode
// ──────────────────────────────────────────────────

import QRCodeLib from 'qrcode';

/**
 * Generate a QR code as a base64 data URL (PNG) on the server.
 * Use this in Server Components — no client-side dependency needed.
 */
export async function generateQRCodeDataURL(
  value: string,
  options?: { width?: number; margin?: number }
): Promise<string> {
  const dataUrl = await QRCodeLib.toDataURL(value, {
    width: options?.width || 200,
    margin: options?.margin || 2,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
    errorCorrectionLevel: 'M',
  });
  return dataUrl;
}
