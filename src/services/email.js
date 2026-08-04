import nodemailer from 'nodemailer';
import { config } from '../config.js';

// Email sending with two interchangeable backends:
//   1. Gmail (SMTP via nodemailer) — used when GMAIL_USER + GMAIL_APP_PASSWORD
//      are set. No domain needed; sends as your own Gmail address.
//   2. Resend (HTTP API) — used when RESEND_API_KEY + EMAIL_FROM are set.
// Sending is a graceful no-op when neither is configured, so local dev and
// previews never break on missing credentials.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function gmailConfigured() {
  return Boolean(config.email.gmailUser && config.email.gmailAppPassword);
}

function resendConfigured() {
  return Boolean(config.email.apiKey && config.email.from);
}

export function isEmailEnabled() {
  return gmailConfigured() || resendConfigured();
}

// Which provider is active (for status display).
export function emailProvider() {
  if (gmailConfigured()) return 'gmail';
  if (resendConfigured()) return 'resend';
  return null;
}

// The effective "from" header for the active provider.
function resolveFrom() {
  if (gmailConfigured()) {
    return config.email.from || `${config.email.fromName} <${config.email.gmailUser}>`;
  }
  return config.email.from;
}

// A bare address safe to use as a visible "To" on broadcasts (recipients
// go in BCC). Falls back to the Gmail account address.
function senderAddress() {
  if (gmailConfigured()) return config.email.gmailUser;
  // Strip a possible "Name <addr>" wrapper from the Resend from value.
  const m = /<([^>]+)>/.exec(config.email.from);
  return m ? m[1] : config.email.from;
}

// Lazily-created, cached SMTP transport (reused across warm invocations).
let _transport = null;
function getTransport() {
  if (!_transport) {
    _transport = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.email.gmailUser,
        pass: config.email.gmailAppPassword,
      },
    });
  }
  return _transport;
}

// Escape user-supplied text before dropping it into HTML.
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Turn a plain-text body (what the admin types) into safe HTML paragraphs,
// preserving line breaks.
export function plainTextToHtml(text = '') {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 16px;line-height:1.6;">${para.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

// Branded HTML shell shared by every email we send. `bodyHtml` is inserted
// as-is, so callers must pass already-safe HTML.
export function renderEmail({ heading, bodyHtml, ctaLabel, ctaUrl }) {
  const siteUrl = config.frontendUrls[0] || '';
  const cta =
    ctaLabel && ctaUrl
      ? `<tr><td style="padding:8px 0 24px;">
           <a href="${ctaUrl}" style="display:inline-block;background:#ffd60a;color:#111827;
              text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;
              font-size:15px;">${escapeHtml(ctaLabel)}</a>
         </td></tr>`
      : '';

  return `<!doctype html>
<html>
<body style="margin:0;background:#f1f5f9;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">
    <tr>
      <td style="background:#0b1220;border-radius:20px 20px 0 0;padding:28px 32px;">
        <div style="color:#ffd60a;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">
          Silver Jubilee · 25 Years
        </div>
        <div style="color:#ffffff;font-size:20px;font-weight:800;margin-top:6px;">
          ${escapeHtml(config.event.name)}
        </div>
      </td>
    </tr>
    <tr>
      <td style="background:#ffffff;padding:32px;border-radius:0 0 20px 20px;">
        ${heading ? `<h1 style="font-size:22px;margin:0 0 16px;">${escapeHtml(heading)}</h1>` : ''}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="font-size:15px;color:#334155;">${bodyHtml}</td></tr>
          ${cta}
        </table>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px;"/>
        <p style="font-size:12px;color:#94a3b8;margin:0;line-height:1.6;">
          ${escapeHtml(config.event.name)}${
            siteUrl && /^https:\/\//.test(siteUrl)
              ? ` · <a href="${siteUrl}" style="color:#64748b;">Visit the site</a>`
              : ''
          }
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Low-level send. `to` and/or `bcc` may be a string or array. Returns
// { ok, id?, error? } and never throws, so callers can fire-and-forget.
export async function sendEmail({ to, bcc, subject, html, text, replyTo }) {
  if (!isEmailEnabled()) {
    return { ok: false, skipped: true, error: 'Email not configured' };
  }
  const reply = replyTo || config.email.replyTo || undefined;

  if (gmailConfigured()) {
    return sendViaGmail({ to, bcc, subject, html, text, replyTo: reply });
  }
  return sendViaResend({ to, bcc, subject, html, text, replyTo: reply });
}

async function sendViaGmail({ to, bcc, subject, html, text, replyTo }) {
  try {
    const info = await getTransport().sendMail({
      from: resolveFrom(),
      to: to || undefined,
      bcc: bcc || undefined,
      replyTo,
      subject,
      html,
      text,
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function sendViaResend({ to, bcc, subject, html, text, replyTo }) {
  try {
    const payload = { from: resolveFrom(), subject, html };
    if (to) payload.to = Array.isArray(to) ? to : [to];
    if (bcc) payload.bcc = Array.isArray(bcc) ? bcc : [bcc];
    if (text) payload.text = text;
    if (replyTo) payload.reply_to = replyTo;

    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.email.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.message || `Resend error ${res.status}` };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---- Templated emails --------------------------------------------------

export async function sendWelcomeEmail(user) {
  const siteUrl = config.frontendUrls[0] || '';
  const bodyHtml = `
    <p style="margin:0 0 16px;line-height:1.6;">Hi ${escapeHtml(user.name.split(' ')[0])},</p>
    <p style="margin:0 0 16px;line-height:1.6;">
      Thanks for registering for the <strong>${escapeHtml(config.event.name)}</strong>!
      Your spot is noted. An organizer will approve your registration shortly, after
      which your RSVP will be counted.
    </p>
    <p style="margin:0 0 16px;line-height:1.6;">
      You can log in any time to update your attendance, food preference, T-shirt size
      and leave a message for the batch.
    </p>`;

  const html = renderEmail({
    heading: 'You’re on the list 🎉',
    bodyHtml,
    ctaLabel: siteUrl ? 'Open the reunion site' : undefined,
    ctaUrl: siteUrl || undefined,
  });

  return sendEmail({
    to: user.email,
    subject: `Welcome to the ${config.event.name}`,
    html,
  });
}

// Admin broadcast. Sends the same message to many recipients via BCC,
// chunked so a single request stays fast and within provider limits.
export async function sendBroadcast({ subject, message, recipients, replyTo }) {
  const bodyHtml = plainTextToHtml(message);
  const html = renderEmail({ bodyHtml });
  const siteUrl = config.frontendUrls[0] || '';

  const CHUNK = 45; // keep well under provider per-message recipient limits
  const chunks = [];
  for (let i = 0; i < recipients.length; i += CHUNK) {
    chunks.push(recipients.slice(i, i + CHUNK));
  }

  let sent = 0;
  const errors = [];
  for (const group of chunks) {
    const result = await sendEmail({
      // "to" the sender/admin, everyone else BCC'd for privacy.
      to: senderAddress(),
      bcc: group,
      subject,
      html,
      text: `${message}\n\n${siteUrl}`,
      replyTo,
    });
    if (result.ok) sent += group.length;
    else errors.push(result.error);
  }

  return { sent, total: recipients.length, errors };
}
