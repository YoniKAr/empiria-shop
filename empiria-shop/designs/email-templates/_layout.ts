// Shared layout wrapper for all shop transactional emails.
// Header and outer table chrome are identical across every template; the
// footer text varies, so it is parameterized (with a sensible default).

const DEFAULT_FOOTER_HTML =
  'This email was sent by Empiria. If you have questions about your order, please contact the event organizer.';

/**
 * Escapes user-supplied text for safe interpolation into email HTML.
 * Organizer/attendee-controlled strings (subjects, messages, titles, reasons,
 * names) MUST pass through this before being embedded in a template —
 * otherwise an organizer can inject arbitrary HTML into mail sent from
 * info@empiria.events.
 */
export function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface EmailLayoutOptions {
  title: string;
  bodyHtml: string;
  /** Inner HTML for the footer paragraph. Defaults to the standard footer text. */
  footerHtml?: string;
}

export function emailLayout({ title, bodyHtml, footerHtml = DEFAULT_FOOTER_HTML }: EmailLayoutOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
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
${bodyHtml}
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center; line-height: 1.5;">
                ${footerHtml}
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
