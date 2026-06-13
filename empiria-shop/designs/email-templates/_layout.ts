// Shared layout wrapper for all shop transactional emails.
// Logo header + accent bar + footer chrome are identical across every template;
// the body sections are composed per-template from the partials.

const DEFAULT_FOOTER_HTML =
  'Questions about your order? Reply to this email or contact the event organizer.';

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
  /** Inner HTML for the footer's contact line. Defaults to the standard text. */
  footerHtml?: string;
}

export function emailLayout({ title, bodyHtml, footerHtml = DEFAULT_FOOTER_HTML }: EmailLayoutOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light only" />
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F4F5F7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #F4F5F7;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 4px 24px rgba(15,23,42,0.07);">

          <!-- Header / Logo -->
          <tr>
            <td style="padding: 28px 32px 22px; text-align: center; background: #ffffff;">
              <img src="cid:empiria-logo" alt="Empiria" width="150" height="50" style="display: inline-block; border: 0;" />
            </td>
          </tr>
          <tr><td style="height: 4px; background: #F15A29; line-height: 4px; font-size: 0;">&nbsp;</td></tr>
${bodyHtml}
          <!-- Footer -->
          <tr>
            <td style="padding: 28px 32px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top: 1px solid #E8EAED;">
                <tr>
                  <td style="padding: 22px 0 0; text-align: center;">
                    <img src="cid:empiria-logo" alt="Empiria" width="108" height="36" style="display: inline-block; border: 0; opacity: 0.7;" />
                    <p style="margin: 14px 0 0; font-size: 12px; line-height: 1.6; color: #94A3B8;">
                      ${footerHtml}<br />
                      &copy; ${new Date().getFullYear()} Empiria &middot; empiria.events
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
