import { Router } from 'express';
import { User } from '../models/User.js';
import { Response } from '../models/Response.js';
import { Setting } from '../models/Setting.js';
import { config } from '../config.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { STATIONS, getStationTokens, rotateStationTokens } from '../utils/stations.js';
import {
  isEmailEnabled,
  emailProvider,
  sendBroadcast,
  sendRsvpConfirmationsBulk,
  sendPaymentReceipt,
  sendPassEmail,
} from '../services/email.js';
import { generatePassToken, hashPassword, generateTempPassword, isValidEmail } from '../utils/auth.js';
import crypto from 'crypto';
import QRCode from 'qrcode';

const router = Router();

// All routes here require an authenticated admin.
router.use(requireAuth, requireAdmin);

// Builds a combined list of members + their responses, sorted by name.
async function buildRecords() {
  const users = await User.find({ role: 'user' })
    .select('-paymentProof -passwordHash')
    .sort({ name: 1 })
    .lean();
  const responses = await Response.find({}).lean();
  const byUser = new Map(responses.map((r) => [String(r.user), r]));

  // The screenshot blob is excluded above for payload size, so we can't derive
  // "has a screenshot" from `u.paymentProof`. Fetch just the ids of members
  // who have a stored image instead.
  const withImage = await User.find({ role: 'user', paymentProof: { $ne: null } })
    .select('_id')
    .lean();
  const imageIds = new Set(withImage.map((u) => String(u._id)));

  return users.map((u) => {
    const r = byUser.get(String(u._id));
    return {
      id: u._id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      branch: u.branch,
      rollNumber: u.rollNumber,
      approved: u.approved,
      paymentStatus: u.paymentStatus || 'not_paid',
      contributionAmount: u.contributionAmount ?? 0,
      paymentNote: u.paymentNote || null,
      paymentTransactionId: u.paymentTransactionId || null,
      paymentMethodUsed: u.paymentMethodUsed || null,
      paymentRejectReason: u.paymentRejectReason || null,
      paymentProofUploadedAt: u.paymentProofUploadedAt || null,
      // Event-day redemption tracking (from QR scans at the counters).
      eventPass: {
        checkedIn: Boolean(u.eventPass?.checkedIn),
        tshirt: Boolean(u.eventPass?.tshirt),
        souvenir: Boolean(u.eventPass?.souvenir),
        drinks: Number(u.eventPass?.drinks) || 0,
      },
      hasProof: imageIds.has(String(u._id)),
      hasProofOrTxn: imageIds.has(String(u._id)) || Boolean(u.paymentTransactionId),
      createdAt: u.createdAt,
      attendance: r?.attendance || null,
      foodPreference: r?.foodPreference || null,
      guests: r?.guests ?? null,
      tshirtSize: r?.tshirtSize || null,
      tshirtFit: r?.tshirtFit || 'mens',
      message: r?.message || null,
      accommodationNeeded: Boolean(r?.accommodationNeeded),
      accommodationType: r?.accommodationType || null,
      respondedAt: r?.updatedAt || null,
    };
  });
}

// GET /api/admin/settings — runtime-toggleable settings (currently just the
// payment open/closed switch). Reflects the DB value, or the env default when
// it has never been toggled.
router.get('/settings', async (_req, res, next) => {
  try {
    const dbOpen = await Setting.get('paymentOpen', null);
    const paymentOpen = dbOpen === null ? config.payment.ready : Boolean(dbOpen);
    const methodState = (await Setting.get('paymentMethodState', {})) || {};
    // Full catalog with each method's published state (default = published).
    const methods = config.payment.methods.map((m, i) => ({
      id: i,
      label: m.label,
      upiId: m.upiId,
      payeeName: m.payeeName,
      phone: m.phone,
      qr: m.qr,
      enabled: methodState[i] !== false,
    }));
    return res.json({
      paymentOpen,
      paymentConfigured: config.payment.methods.length > 0,
      methods,
    });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/admin/settings/payment-open — open or close contributions.
// Body: { open: true|false }. Takes effect immediately, no redeploy.
router.patch('/settings/payment-open', async (req, res, next) => {
  try {
    const { open } = req.body || {};
    if (typeof open !== 'boolean') {
      return res.status(400).json({ error: 'open (boolean) is required' });
    }
    await Setting.set('paymentOpen', open);
    return res.json({ paymentOpen: open });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/admin/settings/payment-method — publish/hide a single QR/method.
// Body: { index: number, enabled: true|false }. Immediate, no redeploy.
router.patch('/settings/payment-method', async (req, res, next) => {
  try {
    const { index, enabled } = req.body || {};
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= config.payment.methods.length) {
      return res.status(400).json({ error: 'valid method index is required' });
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' });
    }
    const state = (await Setting.get('paymentMethodState', {})) || {};
    state[i] = enabled;
    await Setting.set('paymentMethodState', state);
    return res.json({ index: i, enabled });
  } catch (err) {
    return next(err);
  }
});

// GET /api/admin/responses — full list of members and their responses
router.get('/responses', async (_req, res, next) => {
  try {
    return res.json({ records: await buildRecords() });
  } catch (err) {
    return next(err);
  }
});

// GET /api/admin/export.csv — download everything as CSV
router.get('/export.csv', async (_req, res, next) => {
  try {
    const rows = await buildRecords();

    const headers = [
      'Name', 'Email', 'Phone', 'Branch', 'Roll Number', 'Approved',
      'Attendance', 'Food', 'Guests', 'T-Shirt', 'T-Shirt Fit',
      'Payment Status', 'Contribution (INR)', 'Payment Reference Note',
      'Transaction / UTR', 'Payment Method', 'Payment Uploaded At', 'Reject Reason',
      'Checked In', 'T-Shirt Collected', 'Souvenir Collected', 'Drinks Used',
      'Accommodation', 'Room Type',
      'Message', 'Responded At', 'Registered At',
    ];

    // Human-friendly payment status labels for the sheet.
    const PAY_LABEL = {
      paid: 'Paid',
      pending: 'Under review',
      rejected: 'Rejected',
      not_paid: 'Not paid',
    };

    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        r.name, r.email, r.phone, r.branch, r.rollNumber, r.approved ? 'Yes' : 'No',
        r.attendance, r.foodPreference, r.guests, r.tshirtSize,
        r.tshirtFit === 'womens' ? "Women's" : "Men's",
        PAY_LABEL[r.paymentStatus] || 'Not paid', r.contributionAmount, r.paymentNote,
        r.paymentTransactionId, r.paymentMethodUsed, r.paymentProofUploadedAt, r.paymentRejectReason,
        r.eventPass?.checkedIn ? 'Yes' : 'No',
        r.eventPass?.tshirt ? 'Yes' : 'No',
        r.eventPass?.souvenir ? 'Yes' : 'No',
        r.eventPass?.drinks ?? 0,
        r.accommodationNeeded ? 'Yes' : 'No',
        r.accommodationType === 'family' ? 'Family room' : r.accommodationType === 'single' ? 'Single person' : '',
        r.message, r.respondedAt, r.createdAt,
      ].map(esc).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reunion-responses.csv"');
    return res.send(lines.join('\n'));
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/admin/users/:id/approval — approve or un-approve a member.
// Body: { approved: true|false }
router.patch('/users/:id/approval', async (req, res, next) => {
  try {
    const { approved } = req.body || {};
    if (typeof approved !== 'boolean') {
      return res.status(400).json({ error: 'approved (boolean) is required' });
    }

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin') {
      return res.status(403).json({ error: 'Admin accounts are always approved' });
    }

    target.approved = approved;
    await target.save();
    return res.json({ ok: true, approved: target.approved });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/admin/users/:id/payment — update contribution status/amount.
// Body: { paymentStatus?, contributionAmount?, rejectReason? }
const PAYMENT_STATES = ['not_paid', 'pending', 'paid', 'rejected'];
router.patch('/users/:id/payment', async (req, res, next) => {
  try {
    const { paymentStatus, contributionAmount, rejectReason } = req.body || {};
    const update = {};

    if (paymentStatus !== undefined) {
      if (!PAYMENT_STATES.includes(paymentStatus)) {
        return res.status(400).json({ error: `paymentStatus must be one of ${PAYMENT_STATES.join(', ')}` });
      }
      update.paymentStatus = paymentStatus;
      // Reject reason only meaningful for the rejected state.
      update.paymentRejectReason =
        paymentStatus === 'rejected' ? String(rejectReason || '').slice(0, 300) || 'Please re-upload' : null;
      // Resetting to "not paid" also clears the recorded amount.
      if (paymentStatus === 'not_paid') update.contributionAmount = 0;
    }
    if (contributionAmount !== undefined) {
      const amt = Number(contributionAmount);
      if (Number.isNaN(amt) || amt < 0) {
        return res.status(400).json({ error: 'contributionAmount must be a non-negative number' });
      }
      update.contributionAmount = Math.round(amt);
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin') {
      return res.status(403).json({ error: 'Cannot set payment on an admin account' });
    }

    // Can't mark paid without a contribution amount. Consider the amount from
    // this request if present, otherwise the existing one.
    if (update.paymentStatus === 'paid') {
      const effectiveAmount =
        update.contributionAmount !== undefined ? update.contributionAmount : target.contributionAmount;
      if (!(Number(effectiveAmount) > 0)) {
        return res.status(400).json({ error: 'Enter a contribution amount before marking as paid' });
      }
    }

    const wasPaid = target.paymentStatus === 'paid';
    Object.assign(target, update);
    await target.save();

    // When transitioning INTO paid, email the member their reunion pass (QR).
    // This doubles as the payment-confirmation receipt. Mint a pass token if
    // they don't have one yet. Serverless-safe (awaited, never blocks save).
    if (update.paymentStatus === 'paid' && !wasPaid && target.email) {
      try {
        if (!target.passToken) {
          target.passToken = generatePassToken();
          await target.save();
        }
        const siteUrl = config.frontendUrls[0] || '';
        const passUrl = siteUrl ? `${siteUrl.replace(/\/$/, '')}/pass/${target.passToken}` : '';
        const mail = passUrl
          ? await sendPassEmail(target, passUrl)
          : await sendPaymentReceipt(target); // fallback if no site URL configured
        if (!mail.ok && !mail.skipped) console.warn('Pass/receipt email failed:', mail.error);
      } catch (e) {
        console.warn('Pass/receipt email error:', e.message);
      }
    }

    return res.json({
      ok: true,
      paymentStatus: target.paymentStatus,
      contributionAmount: target.contributionAmount,
      paymentRejectReason: target.paymentRejectReason || null,
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/admin/users/:id/proof — the payment screenshot / txn id + note (lazy-loaded)
router.get('/users/:id/proof', async (req, res, next) => {
  try {
    const u = await User.findById(req.params.id)
      .select('name paymentProof paymentNote paymentTransactionId paymentMethodUsed paymentProofUploadedAt')
      .lean();
    if (!u) return res.status(404).json({ error: 'User not found' });
    // Allow viewing when there's an image OR a transaction id OR a note.
    if (!u.paymentProof && !u.paymentTransactionId && !u.paymentNote) {
      return res.status(404).json({ error: 'No proof provided' });
    }
    return res.json({
      name: u.name,
      image: u.paymentProof || null,
      note: u.paymentNote || null,
      transactionId: u.paymentTransactionId || null,
      methodUsed: u.paymentMethodUsed || null,
      uploadedAt: u.paymentProofUploadedAt || null,
    });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/admin/users/:id/proof — clear a member's submitted payment
// proof (screenshot + txn id + note + method) and reset them to "not paid".
router.delete('/users/:id/proof', async (req, res, next) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin') {
      return res.status(403).json({ error: 'Not applicable to admin accounts' });
    }
    target.paymentProof = null;
    target.paymentTransactionId = null;
    target.paymentNote = null;
    target.paymentMethodUsed = null;
    target.paymentProofUploadedAt = null;
    target.paymentRejectReason = null;
    target.paymentStatus = 'not_paid';
    target.contributionAmount = 0;
    await target.save();
    return res.json({
      ok: true,
      paymentStatus: target.paymentStatus,
      contributionAmount: target.contributionAmount,
    });
  } catch (err) {
    return next(err);
  }
});

// ---- Volunteer counters (station QR links) ---------------------------

// GET /api/admin/stations — the 4 counter links to hand out to volunteers.
router.get('/stations', async (_req, res, next) => {
  try {
    const tokens = await getStationTokens();
    return res.json({
      stations: STATIONS.map((s) => ({ ...s, token: tokens[s.key] })),
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/admin/stations/rotate — regenerate all counter links (old links
// stop working). Use if a link leaks.
router.post('/stations/rotate', async (_req, res, next) => {
  try {
    const tokens = await rotateStationTokens();
    return res.json({
      stations: STATIONS.map((s) => ({ ...s, token: tokens[s.key] })),
    });
  } catch (err) {
    return next(err);
  }
});

// ---- Event-day pass / redemption -------------------------------------

function shapePass(u) {
  const p = u.eventPass || {};
  return {
    checkedIn: Boolean(p.checkedIn),
    checkedInAt: p.checkedInAt || null,
    tshirt: Boolean(p.tshirt),
    tshirtAt: p.tshirtAt || null,
    souvenir: Boolean(p.souvenir),
    souvenirAt: p.souvenirAt || null,
    drinks: Number(p.drinks) || 0,
    drinksAt: p.drinksAt || null,
  };
}

// GET /api/admin/pass/:token — resolve a scanned QR token to the member and
// their current redemption status. Used by the volunteer check-in screen.
router.get('/pass/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing token' });
    const u = await User.findOne({ passToken: token })
      .select('name branch rollNumber paymentStatus contributionAmount eventPass')
      .lean();
    if (!u) return res.status(404).json({ error: 'Invalid or unknown pass' });
    return res.json({
      id: u._id,
      name: u.name,
      branch: u.branch || null,
      rollNumber: u.rollNumber || null,
      paymentStatus: u.paymentStatus || 'not_paid',
      contributionAmount: u.contributionAmount ?? 0,
      status: shapePass(u),
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/admin/users/:id/pass.png — download a guest's pass QR as a PNG.
// Handy when a member's phone/email pass isn't working: the organizer can save
// it and let them photograph it. Mints a pass token if they don't have one.
router.get('/users/:id/pass.png', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ error: 'Not applicable to admin accounts' });

    if (!user.passToken) {
      user.passToken = generatePassToken();
      await user.save();
    }
    const siteUrl = config.frontendUrls[0] || '';
    const passUrl = siteUrl ? `${siteUrl.replace(/\/$/, '')}/pass/${user.passToken}` : user.passToken;

    const png = await QRCode.toBuffer(passUrl, { width: 600, margin: 2, errorCorrectionLevel: 'M' });
    const safeName = (user.name || 'guest').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'guest';
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-pass.png"`);
    return res.send(png);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/admin/pass/:token — mark redemptions for a scanned member.
// Body: any of { checkedIn:bool, tshirt:bool, souvenir:bool, drinks:0..2 }.
router.patch('/pass/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    const user = await User.findOne({ passToken: token });
    if (!user) return res.status(404).json({ error: 'Invalid or unknown pass' });

    const { checkedIn, tshirt, souvenir, drinks } = req.body || {};
    const now = new Date();
    if (!user.eventPass) user.eventPass = {};

    if (checkedIn !== undefined) {
      user.eventPass.checkedIn = Boolean(checkedIn);
      user.eventPass.checkedInAt = checkedIn ? now : null;
    }
    if (tshirt !== undefined) {
      user.eventPass.tshirt = Boolean(tshirt);
      user.eventPass.tshirtAt = tshirt ? now : null;
    }
    if (souvenir !== undefined) {
      user.eventPass.souvenir = Boolean(souvenir);
      user.eventPass.souvenirAt = souvenir ? now : null;
    }
    if (drinks !== undefined) {
      const n = Number(drinks);
      if (!Number.isInteger(n) || n < 0 || n > 2) {
        return res.status(400).json({ error: 'drinks must be 0, 1 or 2' });
      }
      user.eventPass.drinks = n;
      user.eventPass.drinksAt = n > 0 ? now : null;
    }

    await user.save();
    return res.json({ ok: true, name: user.name, status: shapePass(user) });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/admin/records/:id — admin override of ANY field for a member,
// covering both the user profile and their RSVP response.
router.patch('/records/:id', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Admin accounts cannot be edited here' });
    }

    const b = req.body || {};

    // --- User profile fields ---
    if (b.name !== undefined) user.name = String(b.name).trim();
    if (b.phone !== undefined) user.phone = b.phone ? String(b.phone).trim() : null;
    if (b.branch !== undefined) user.branch = b.branch ? String(b.branch).trim() : null;
    if (b.rollNumber !== undefined) user.rollNumber = b.rollNumber ? String(b.rollNumber).trim() : null;
    if (b.approved !== undefined) user.approved = Boolean(b.approved);
    if (b.paymentStatus !== undefined) {
      if (!['not_paid', 'pending', 'paid', 'rejected'].includes(b.paymentStatus)) {
        return res.status(400).json({ error: 'Invalid paymentStatus' });
      }
      user.paymentStatus = b.paymentStatus;
    }
    if (b.contributionAmount !== undefined) {
      const amt = Number(b.contributionAmount);
      if (Number.isNaN(amt) || amt < 0) return res.status(400).json({ error: 'Invalid amount' });
      user.contributionAmount = Math.round(amt);
    }
    if (b.email !== undefined) {
      const email = String(b.email).toLowerCase().trim();
      const clash = await User.findOne({ email, _id: { $ne: user._id } }).lean();
      if (clash) return res.status(409).json({ error: 'Another member already uses that email' });
      user.email = email;
    }
    await user.save();

    // --- RSVP response fields (upsert) ---
    const respPatch = {};
    if (b.attendance !== undefined) {
      if (!['yes', 'no', 'maybe'].includes(b.attendance)) {
        return res.status(400).json({ error: 'Invalid attendance' });
      }
      respPatch.attendance = b.attendance;
    }
    if (b.foodPreference !== undefined) {
      if (!['veg', 'non_veg'].includes(b.foodPreference)) {
        return res.status(400).json({ error: 'Invalid foodPreference' });
      }
      respPatch.foodPreference = b.foodPreference;
    }
    if (b.tshirtSize !== undefined) respPatch.tshirtSize = b.tshirtSize || null;
    if (b.tshirtFit !== undefined) {
      respPatch.tshirtFit = b.tshirtFit === 'womens' ? 'womens' : 'mens';
    }
    if (b.message !== undefined) respPatch.message = b.message ? String(b.message).slice(0, 500) : null;
    if (b.guests !== undefined) respPatch.guests = Math.max(0, Number(b.guests) || 0);

    let response = await Response.findOne({ user: user._id });
    if (Object.keys(respPatch).length > 0) {
      response = await Response.findOneAndUpdate(
        { user: user._id },
        { user: user._id, ...respPatch },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
    }

    return res.json({
      record: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        branch: user.branch,
        rollNumber: user.rollNumber,
        approved: user.approved,
        paymentStatus: user.paymentStatus,
        contributionAmount: user.contributionAmount,
        createdAt: user.createdAt,
        attendance: response?.attendance || null,
        foodPreference: response?.foodPreference || null,
        guests: response?.guests ?? null,
        tshirtSize: response?.tshirtSize || null,
        tshirtFit: response?.tshirtFit || 'mens',
        message: response?.message || null,
        respondedAt: response?.updatedAt || null,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// Resolve the recipient list for a broadcast audience. Returns { name, email }
// objects so broadcasts can be personalized.
// audience: 'all' | 'approved' | 'pending' | 'attending'
async function resolveRecipients(audience) {
  if (audience === 'attending') {
    const responses = await Response.find({ attendance: 'yes' })
      .populate('user', 'name email role approved')
      .lean();
    return responses
      .filter((r) => r.user && r.user.role === 'user' && r.user.approved && r.user.email)
      .map((r) => ({ name: r.user.name, email: r.user.email }));
  }

  const query = { role: 'user' };
  if (audience === 'approved') query.approved = true;
  if (audience === 'pending') query.approved = false;
  // 'all' → every non-admin member

  const users = await User.find(query, 'name email').lean();
  return users.filter((u) => u.email).map((u) => ({ name: u.name, email: u.email }));
}

// GET /api/admin/email/status — is email configured, and audience counts
router.get('/email/status', async (_req, res, next) => {
  try {
    const [all, approved, pending, attending] = await Promise.all([
      resolveRecipients('all'),
      resolveRecipients('approved'),
      resolveRecipients('pending'),
      resolveRecipients('attending'),
    ]);
    return res.json({
      enabled: isEmailEnabled(),
      provider: emailProvider(),
      audiences: {
        all: all.length,
        approved: approved.length,
        pending: pending.length,
        attending: attending.length,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/admin/broadcast — send a custom email to a chosen audience.
// Body: { subject, message, audience }
router.post('/broadcast', async (req, res, next) => {
  try {
    if (!isEmailEnabled()) {
      return res.status(400).json({
        error: 'Email is not configured. Set RESEND_API_KEY and EMAIL_FROM.',
      });
    }

    const { subject, message, audience, recipients: explicit } = req.body || {};
    if (!subject || !String(subject).trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let recipients;
    if (Array.isArray(explicit) && explicit.length > 0) {
      // Explicit selection from the admin picker. Restrict to real members
      // so the endpoint can't be used to email arbitrary addresses.
      const wanted = explicit.map((e) => String(e).toLowerCase().trim());
      const members = await User.find(
        { role: 'user', email: { $in: wanted } },
        'name email',
      ).lean();
      recipients = members.map((u) => ({ name: u.name, email: u.email }));
    } else {
      const aud = audience || 'approved';
      if (!['all', 'approved', 'pending', 'attending'].includes(aud)) {
        return res.status(400).json({ error: 'Invalid audience' });
      }
      recipients = await resolveRecipients(aud);
    }

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No valid recipients selected' });
    }

    const result = await sendBroadcast({
      subject: String(subject).trim(),
      message: String(message),
      recipients,
    });

    return res.json({
      ok: result.errors.length === 0,
      sent: result.sent,
      total: result.total,
      errors: result.errors,
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/admin/resend-rsvp-confirmations — email every member who has
// already submitted an RSVP their personalized status. Useful for the
// existing batchmates who responded before confirmation emails existed.
router.post('/resend-rsvp-confirmations', async (_req, res, next) => {
  try {
    if (!isEmailEnabled()) {
      return res.status(400).json({
        error: 'Email is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD.',
      });
    }

    const responses = await Response.find({})
      .populate('user', 'name email role')
      .lean();

    const items = responses
      .filter((r) => r.user && r.user.role === 'user' && r.user.email)
      .map((r) => ({ user: r.user, response: r }));

    if (items.length === 0) {
      return res.status(400).json({ error: 'No RSVPs to send' });
    }

    const result = await sendRsvpConfirmationsBulk(items);
    return res.json({
      ok: result.errors.length === 0,
      sent: result.sent,
      total: result.total,
      errors: result.errors,
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/admin/walkin — register a walk-in guest at the venue. Creates an
// approved member + their RSVP in one shot, optionally marking them paid and
// checked-in, and mints an event pass. Email is optional (a placeholder is
// generated when missing, since the account still needs a unique email).
// Body: { name, email?, phone?, branch?, rollNumber?, foodPreference?,
//         tshirtSize?, guests?, contributionAmount?, markPaid?, checkIn? }
router.post('/walkin', async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });

    // Resolve email: use the given one (validated + unique) or synthesize one.
    let email;
    if (b.email && String(b.email).trim()) {
      if (!isValidEmail(b.email)) {
        return res.status(400).json({ error: 'Please provide a valid email address' });
      }
      email = String(b.email).toLowerCase().trim();
      const clash = await User.findOne({ email }).lean();
      if (clash) return res.status(409).json({ error: 'An account with this email already exists' });
    } else {
      email = `walkin-${crypto.randomBytes(5).toString('hex')}@walkin.local`;
    }

    const foodPreference = ['veg', 'non_veg'].includes(b.foodPreference) ? b.foodPreference : 'veg';
    const tshirtSize = ['XS', 'S', 'M', 'L', 'XL', 'XXL'].includes(b.tshirtSize) ? b.tshirtSize : null;
    const guests = Math.max(0, Math.min(20, Number(b.guests) || 0));
    const amount = Math.max(0, Math.round(Number(b.contributionAmount) || 0));
    const markPaid = Boolean(b.markPaid) && amount > 0;
    const checkIn = b.checkIn === undefined ? true : Boolean(b.checkIn);

    const user = await User.create({
      name,
      email,
      phone: b.phone ? String(b.phone).trim() : null,
      branch: b.branch ? String(b.branch).trim() : null,
      rollNumber: b.rollNumber ? String(b.rollNumber).trim() : null,
      // Random password — walk-ins don't log in, but the schema needs a hash.
      passwordHash: hashPassword(generateTempPassword(12)),
      role: 'user',
      approved: true,
      passToken: generatePassToken(),
      paymentStatus: markPaid ? 'paid' : 'not_paid',
      contributionAmount: markPaid ? amount : 0,
      eventPass: {
        checkedIn: checkIn,
        checkedInAt: checkIn ? new Date() : null,
        tshirt: false,
        souvenir: false,
        drinks: 0,
      },
    });

    await Response.findOneAndUpdate(
      { user: user._id },
      { user: user._id, attendance: 'yes', foodPreference, tshirtSize, guests },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    const siteUrl = config.frontendUrls[0] || '';
    const passUrl = siteUrl ? `${siteUrl.replace(/\/$/, '')}/pass/${user.passToken}` : '';

    return res.status(201).json({
      ok: true,
      id: user._id,
      name: user.name,
      email: user.email,
      passToken: user.passToken,
      passUrl,
      checkedIn: checkIn,
      paymentStatus: user.paymentStatus,
    });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/admin/users/:id — remove a member (and their response)
router.delete('/users/:id', async (req, res, next) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin') {
      return res.status(403).json({ error: 'Admin accounts cannot be deleted here' });
    }

    await Response.deleteOne({ user: target._id });
    await User.deleteOne({ _id: target._id });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
