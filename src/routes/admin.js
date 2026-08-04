import { Router } from 'express';
import { User } from '../models/User.js';
import { Response } from '../models/Response.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { isEmailEnabled, emailProvider, sendBroadcast } from '../services/email.js';

const router = Router();

// All routes here require an authenticated admin.
router.use(requireAuth, requireAdmin);

// Builds a combined list of members + their responses, sorted by name.
async function buildRecords() {
  const users = await User.find({ role: 'user' }).sort({ name: 1 }).lean();
  const responses = await Response.find({}).lean();
  const byUser = new Map(responses.map((r) => [String(r.user), r]));

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
      createdAt: u.createdAt,
      attendance: r?.attendance || null,
      foodPreference: r?.foodPreference || null,
      guests: r?.guests ?? null,
      tshirtSize: r?.tshirtSize || null,
      message: r?.message || null,
      respondedAt: r?.updatedAt || null,
    };
  });
}

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
      'Attendance', 'Food', 'Guests', 'T-Shirt', 'Payment', 'Contribution (INR)',
      'Message', 'Responded At', 'Registered At',
    ];

    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        r.name, r.email, r.phone, r.branch, r.rollNumber, r.approved ? 'Yes' : 'No',
        r.attendance, r.foodPreference, r.guests, r.tshirtSize,
        r.paymentStatus === 'paid' ? 'Paid' : 'Not paid', r.contributionAmount,
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
// Body: { paymentStatus?: 'paid'|'not_paid', contributionAmount?: number }
router.patch('/users/:id/payment', async (req, res, next) => {
  try {
    const { paymentStatus, contributionAmount } = req.body || {};
    const update = {};

    if (paymentStatus !== undefined) {
      if (!['paid', 'not_paid'].includes(paymentStatus)) {
        return res.status(400).json({ error: 'paymentStatus must be paid or not_paid' });
      }
      update.paymentStatus = paymentStatus;
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

    Object.assign(target, update);
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
      if (!['paid', 'not_paid'].includes(b.paymentStatus)) {
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
        message: response?.message || null,
        respondedAt: response?.updatedAt || null,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// Resolve the recipient list for a broadcast audience.
// audience: 'all' | 'approved' | 'pending' | 'attending'
async function resolveRecipients(audience) {
  if (audience === 'attending') {
    const responses = await Response.find({ attendance: 'yes' })
      .populate('user', 'email role approved')
      .lean();
    return responses
      .filter((r) => r.user && r.user.role === 'user' && r.user.approved && r.user.email)
      .map((r) => r.user.email);
  }

  const query = { role: 'user' };
  if (audience === 'approved') query.approved = true;
  if (audience === 'pending') query.approved = false;
  // 'all' → every non-admin member

  const users = await User.find(query, 'email').lean();
  return users.map((u) => u.email).filter(Boolean);
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

    const { subject, message, audience = 'approved' } = req.body || {};
    if (!subject || !String(subject).trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (!['all', 'approved', 'pending', 'attending'].includes(audience)) {
      return res.status(400).json({ error: 'Invalid audience' });
    }

    const recipients = await resolveRecipients(audience);
    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No recipients match that audience' });
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
