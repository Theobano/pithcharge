import nodemailer, { type Transporter } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type EmailProvider = 'smtp' | 'webhook' | 'none';

const env = (name: string) => process.env[name]?.trim() || undefined;

/** SMTP wins when a host is set; otherwise the legacy HTTP relay is used if configured. */
export function emailProvider(): EmailProvider {
  const explicit = env('EMAIL_PROVIDER')?.toLowerCase();
  if (explicit === 'none') return 'none';
  if (explicit === 'webhook') return env('NOTIFICATION_EMAIL_WEBHOOK_URL') ? 'webhook' : 'none';
  if (explicit === 'smtp' || env('SMTP_HOST')) return env('SMTP_HOST') ? 'smtp' : 'none';
  return env('NOTIFICATION_EMAIL_WEBHOOK_URL') && env('NOTIFICATION_EMAIL_WEBHOOK_SECRET') ? 'webhook' : 'none';
}

export const isEmailConfigured = () => emailProvider() !== 'none';

export function emailFrom() {
  const address = env('EMAIL_FROM') ?? 'no-reply@localhost';
  const name = env('EMAIL_FROM_NAME') ?? env('APP_NAME') ?? 'Pithcharge';
  return address.includes('<') ? address : `${name} <${address}>`;
}

/** Non-secret view of the email configuration, for the admin settings page and startup logs. */
export function emailSettings() {
  const provider = emailProvider();
  return {
    provider,
    configured: provider !== 'none',
    from: emailFrom(),
    replyTo: env('EMAIL_REPLY_TO') ?? null,
    smtp:
      provider === 'smtp'
        ? {
            host: env('SMTP_HOST'),
            port: Number(env('SMTP_PORT') ?? (smtpSecure() ? 465 : 587)),
            secure: smtpSecure(),
            authenticated: Boolean(env('SMTP_USER')),
          }
        : null,
    verificationRequired: env('EMAIL_REQUIRE_VERIFICATION') === 'true',
  };
}

function smtpSecure() {
  const value = env('SMTP_SECURE');
  return value ? value === 'true' : Number(env('SMTP_PORT')) === 465;
}

let transport: { key: string; instance: Transporter } | null = null;

function smtpTransport() {
  const key = [env('SMTP_HOST'), env('SMTP_PORT'), env('SMTP_USER'), env('SMTP_PASSWORD'), env('SMTP_SECURE')].join('|');
  if (transport?.key === key) return transport.instance;
  const user = env('SMTP_USER');
  const instance = nodemailer.createTransport({
    host: env('SMTP_HOST'),
    port: Number(env('SMTP_PORT') ?? (smtpSecure() ? 465 : 587)),
    secure: smtpSecure(),
    auth: user ? { user, pass: env('SMTP_PASSWORD') ?? '' } : undefined,
    pool: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  transport = { key, instance };
  return instance;
}

/** Sends one email through the configured provider; throws when delivery fails or nothing is configured. */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const provider = emailProvider();
  if (provider === 'smtp') {
    await smtpTransport().sendMail({
      from: emailFrom(),
      replyTo: env('EMAIL_REPLY_TO'),
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return;
  }
  if (provider === 'webhook') {
    const response = await fetch(env('NOTIFICATION_EMAIL_WEBHOOK_URL')!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env('NOTIFICATION_EMAIL_WEBHOOK_SECRET') ?? ''}`,
      },
      body: JSON.stringify({
        channel: 'EMAIL',
        from: emailFrom(),
        recipient: message.to,
        title: message.subject,
        body: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Email relay returned HTTP ${response.status}.`);
    return;
  }
  throw new Error('Email delivery is not configured.');
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** Minimal branded HTML wrapper so every email looks consistent. */
export function renderEmail(input: { heading: string; body: string; action?: { label: string; url: string } }) {
  const app = escapeHtml(env('APP_NAME') ?? 'Pithcharge');
  const paragraphs = input.body
    .split('\n')
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 12px;color:#374151;font-size:15px;line-height:1.5">${escapeHtml(line)}</p>`)
    .join('');
  const button = input.action
    ? `<p style="margin:20px 0"><a href="${escapeHtml(input.action.url)}" style="background:#059669;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">${escapeHtml(input.action.label)}</a></p><p style="margin:0;color:#6b7280;font-size:12px;word-break:break-all">${escapeHtml(input.action.url)}</p>`
    : '';
  const html = `<div style="background:#f3f4f6;padding:24px;font-family:-apple-system,Segoe UI,Roboto,sans-serif"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px"><p style="margin:0 0 16px;font-weight:700;color:#059669;font-size:14px">${app}</p><h1 style="margin:0 0 16px;font-size:20px;color:#111827">${escapeHtml(input.heading)}</h1>${paragraphs}${button}</div></div>`;
  const text = `${input.heading}\n\n${input.body}${input.action ? `\n\n${input.action.label}: ${input.action.url}` : ''}`;
  return { html, text };
}
