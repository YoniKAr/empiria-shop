import { SES, SendRawEmailCommand } from '@aws-sdk/client-ses';
import nodemailer from 'nodemailer';

const ses = new SES({
  region: process.env.AWS_SES_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY || '',
  },
});

const transporter = nodemailer.createTransport({ SES: { ses, aws: { SendRawEmailCommand } } });

export const EMAIL_FROM = process.env.EMAIL_FROM || 'Empiria <info@empiria.events>';

/** Drop-in replacement for resend.emails.send — same fields, normalized attachments. */
export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: string | Buffer; contentType?: string }>;
}) {
  return transporter.sendMail({
    from: opts.from || EMAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    replyTo: opts.replyTo,
    attachments: (opts.attachments || []).map((a) => ({
      filename: a.filename,
      content: typeof a.content === 'string' ? Buffer.from(a.content, 'base64') : a.content,
      contentType: a.contentType,
    })),
  });
}
