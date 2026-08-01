import { Router } from 'express';
import { User } from '../models/User.js';
import { Response } from '../models/Response.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

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
      'Attendance', 'Food', 'Guests', 'T-Shirt', 'Message', 'Responded At', 'Registered At',
    ];

    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        r.name, r.email, r.phone, r.branch, r.rollNumber, r.approved ? 'Yes' : 'No',
        r.attendance, r.foodPreference, r.guests, r.tshirtSize, r.message,
        r.respondedAt, r.createdAt,
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
