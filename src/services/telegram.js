import { config } from '../config.js';

// Telegram alerts — instant push to organizers' phones via the Bot API.
// One-way outbound HTTPS only (no polling / webhooks), so it works fine on
// serverless/Vercel. It's a graceful no-op when unconfigured, so local dev
// and previews never break on missing credentials.

const API_BASE = 'https://api.telegram.org';

export function isTelegramEnabled() {
  return Boolean(config.telegram.botToken && config.telegram.chatIds.length > 0);
}

// Escape text for Telegram's HTML parse mode.
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Low-level send. Posts `text` (HTML) to every configured chat id. Returns
// { ok, sent, total, errors } and never throws, so callers can fire-and-forget.
export async function sendTelegram(text) {
  if (!isTelegramEnabled()) {
    return { ok: false, skipped: true, sent: 0, total: 0, errors: [] };
  }
  const { botToken, chatIds } = config.telegram;
  const url = `${API_BASE}/bot${botToken}/sendMessage`;
  const result = { ok: true, sent: 0, total: chatIds.length, errors: [] };

  await Promise.all(
    chatIds.map(async (chatId) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          result.sent += 1;
        } else {
          result.errors.push(`${chatId}: ${data.description || `HTTP ${res.status}`}`);
        }
      } catch (err) {
        result.errors.push(`${chatId}: ${err.message}`);
      }
    }),
  );

  result.ok = result.errors.length === 0;
  return result;
}

// Templated alert — fired when a member submits payment proof.
export async function sendPaymentSubmittedTelegram(user) {
  if (!isTelegramEnabled()) return { ok: false, skipped: true };

  const amount =
    user.contributionAmount > 0
      ? `₹${Number(user.contributionAmount).toLocaleString('en-IN')}`
      : '—';
  const lines = [
    '💰 <b>New payment proof to review</b>',
    '',
    `<b>Name:</b> ${escapeHtml(user.name)}`,
    `<b>Email:</b> ${escapeHtml(user.email)}`,
    `<b>Branch:</b> ${escapeHtml(user.branch || '—')}`,
    `<b>Amount:</b> ${escapeHtml(amount)}`,
    `<b>Reference:</b> ${escapeHtml(user.paymentNote || '—')}`,
    `<b>Txn / UTR:</b> ${escapeHtml(user.paymentTransactionId || '—')}`,
    `<b>Paid to:</b> ${escapeHtml(user.paymentMethodUsed || '—')}`,
  ];

  const siteUrl = config.frontendUrls[0] || '';
  const adminUrl = siteUrl ? `${siteUrl.replace(/\/$/, '')}/admin` : '';
  if (adminUrl && /^https?:\/\//.test(adminUrl)) {
    lines.push('', `<a href="${adminUrl}">Open admin dashboard</a>`);
  }

  return sendTelegram(lines.join('\n'));
}
