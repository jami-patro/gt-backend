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

// Lazily-created, cached SMTP transport (reused across warm invocations).
let _transport = null;
function getTransport() {
  if (!_transport) {
    _transport = nodemailer.createTransport({
      service: 'gmail',
      // Pool connections so a personalized broadcast to many recipients
      // reuses a few SMTP connections instead of opening one per email.
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
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
// A nicely formatted long date, e.g. "Saturday, December 19, 2026".
function prettyEventDate() {
  try {
    return new Date(config.event.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return config.event.date;
  }
}

// Plain-text "Name (phone)" list for the disclaimer.
function contactListText() {
  return (config.event.contacts || [])
    .map((c) => (c.phone ? `${c.name} (${c.phone})` : c.name))
    .join(', ');
}

// HTML "Name — <tel link>" list for the details block.
function contactListHtml() {
  return (config.event.contacts || [])
    .map((c) => {
      const name = escapeHtml(c.name);
      if (!c.phone) return name;
      const tel = c.phone.replace(/[^\d+]/g, '');
      return `${name} — <a href="tel:${tel}" style="color:#2563eb;text-decoration:none;">${escapeHtml(c.phone)}</a>`;
    })
    .join('<br/>');
}

// Event details card shown in every email, under the message body.
function eventDetailsBlock() {
  const { venue, time, locationUrl } = config.event;
  const row = (label, value) =>
    `<tr>
       <td style="padding:6px 0;font-size:13px;color:#64748b;width:90px;vertical-align:top;">${label}</td>
       <td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600;">${value}</td>
     </tr>`;

  const mapLink =
    locationUrl && /^https?:\/\//.test(locationUrl)
      ? ` &nbsp;<a href="${locationUrl}" style="color:#2563eb;font-weight:600;">View on map</a>`
      : '';
  const contacts = contactListHtml();

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="margin:8px 0 4px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;">
      <tr><td style="padding:16px 18px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">
          Event details
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${row('📅 Date', escapeHtml(prettyEventDate()))}
          ${time ? row('🕔 Time', escapeHtml(time)) : ''}
          ${venue ? row('📍 Venue', escapeHtml(venue) + mapLink)
            + `<tr><td></td><td style="font-size:12px;color:#94a3b8;padding-bottom:6px;">Exact venue to be announced</td></tr>` : ''}
          ${contacts ? row('📞 Contact', contacts) : ''}
        </table>
      </td></tr>
    </table>`;
}

export function renderEmail({ heading, bodyHtml, ctaLabel, ctaUrl, showEventDetails = true }) {
  const siteUrl = config.frontendUrls[0] || '';
  const cta =
    ctaLabel && ctaUrl
      ? `<tr><td style="padding:8px 0 24px;">
           <a href="${ctaUrl}" style="display:inline-block;background:#ffd60a;color:#111827;
              text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;
              font-size:15px;">${escapeHtml(ctaLabel)}</a>
         </td></tr>`
      : '';
  const details = showEventDetails
    ? `<tr><td style="padding-top:8px;">${eventDetailsBlock()}</td></tr>`
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
          ${details}
        </table>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px;"/>
        <p style="font-size:12px;color:#94a3b8;margin:0 0 6px;line-height:1.6;">
          Please do not reply to this email — this inbox is not monitored.${
            contactListText() ? ` For any queries, contact ${escapeHtml(contactListText())}.` : ''
          }
        </p>
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

const firstNameOf = (name) => (name || '').trim().split(/\s+/)[0] || 'there';

// Admin broadcast. Sends an INDIVIDUAL, personalized email to each recipient
// ("Hi <FirstName>,") rather than one BCC blast. Runs a few sends in parallel
// (bounded concurrency) so a large batch completes quickly.
// `recipients` is an array of { name, email }.
export async function sendBroadcast({ subject, message, recipients, replyTo, concurrency = 5 }) {
  const results = { sent: 0, total: recipients.length, errors: [] };
  let cursor = 0;

  const sendOne = async (r) => {
    const first = firstNameOf(r.name);
    const greetingHtml = `<p style="margin:0 0 16px;line-height:1.6;">Hi ${escapeHtml(first)},</p>`;
    const bodyHtml = greetingHtml + plainTextToHtml(message);
    const html = renderEmail({ bodyHtml });
    const text = `Hi ${first},\n\n${message}`;
    const res = await sendEmail({ to: r.email, subject, html, text, replyTo });
    if (res.ok) results.sent += 1;
    else results.errors.push(`${r.email}: ${res.error}`);
  };

  const worker = async () => {
    while (cursor < recipients.length) {
      const r = recipients[cursor++];
      await sendOne(r);
    }
  };

  const pool = Array.from({ length: Math.min(concurrency, recipients.length) }, worker);
  await Promise.all(pool);
  return results;
}
