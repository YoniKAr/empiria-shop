import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import nodemailer from 'nodemailer';

const sesClient = new SESv2Client({
  region: process.env.AWS_SES_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY || '',
  },
});

const transporter = nodemailer.createTransport({ SES: { sesClient, SendEmailCommand } });

export const EMAIL_FROM = process.env.EMAIL_FROM || 'Empiria Events <info@empiria.events>';

/** Drop-in replacement for resend.emails.send — same fields, normalized attachments. */
export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: string | Buffer; contentType?: string; cid?: string }>;
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
      cid: a.cid,
    })),
  });
}
