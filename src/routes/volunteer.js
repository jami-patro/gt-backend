import { Router } from 'express';
import { User } from '../models/User.js';
import { Response } from '../models/Response.js';
import { requireAuth, requireAdminOrVolunteer } from '../middleware/auth.js';
import { generatePassToken, hashPassword, generateTempPassword, isValidEmail } from '../utils/auth.js';
import crypto from 'crypto';

const router = Router();

// All routes here require authenticated admin or volunteer.
router.use(requireAuth, requireAdminOrVolunteer);

// Shared helper - builds member list (same as admin buildRecords)
async function buildRecords() {
  const users = await User.find({ role: 'user' })
    .select('-paymentProof -passwordHash')
    .sort({ name: 1 })
    .lean();
  const responses = await Response.find({}).lean();
  const byUser = new Map(responses.map((r) => [String(r.user), r]));

  const withImage = await User.find({ role: 'user', paymentProof: { $ne: null } })
    .select('_id')
    .lean();
  const imageIds = new Set(withImage.map((u) => String(u._id)));

  return users.map((u) => {
    const r = byUser.get(String(u._id));
    return {
      id: u._id,
      passNumber: u.passNumber ?? null,
      name: u.name,
      email: u.email,
      phone: u.phone,
      branch: u.branch,
      rollNumber: u.rollNumber,
      location: u.location || null,
      approved: u.approved,
      isWalkIn: Boolean(u.isWalkIn),
      paymentStatus: u.paymentStatus || 'not_paid',
      contributionAmount: u.contributionAmount ?? 0,
      paymentNote: u.paymentNote || null,
      paymentTransactionId: u.paymentTransactionId || null,
      paymentMethodUsed: u.paymentMethodUsed || null,
      paymentRejectReason: u.paymentRejectReason || null,
      paymentProofUploadedAt: u.paymentProofUploadedAt || null,
      eventPass: {
        checkedIn: Boolean(u.eventPass?.checkedIn),
        tshirt: Boolean(u.eventPass?.tshirt),
        souvenir: Boolean(u.eventPass?.souvenir),
        drinks: Number(u.eventPass?.drinks) || 0,
      },
      hasProof: imageIds.has(String(u._id)),
      hasProofOrTxn: imageIds.has(String(u._id)) || Boolean(u.paymentTransactionId) || Boolean(u.paymentNote),
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

// GET /api/volunteer/responses — list all members for check-in
router.get('/responses', async (_req, res, next) => {
  try {
    return res.json({ records: await buildRecords() });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/volunteer/users/:id/eventpass — update check-in status
router.patch('/users/:id/eventpass', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Admin accounts have no event pass' });
    }

    const { checkedIn, tshirt, souvenir, location } = req.body || {};
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
    if (location !== undefined) {
      user.location = location ? String(location).trim() : null;
    }

    await user.save();
    return res.json({
      ok: true,
      location: user.location,
      eventPass: {
        checkedIn: Boolean(user.eventPass.checkedIn),
        tshirt: Boolean(user.eventPass.tshirt),
        souvenir: Boolean(user.eventPass.souvenir),
      },
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/volunteer/walkin — register walk-in guest
router.post('/walkin', async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });

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
    const paymentProof = b.paymentProof && String(b.paymentProof).trim() ? String(b.paymentProof) : null;
    const paymentNote = b.paymentNote && String(b.paymentNote).trim() ? String(b.paymentNote).slice(0, 300) : null;
    const paymentMethodUsed = b.paymentMethodUsed && String(b.paymentMethodUsed).trim() ? String(b.paymentMethodUsed).slice(0, 100) : null;

    const user = await User.create({
      name,
      email,
      phone: b.phone ? String(b.phone).trim() : null,
      branch: b.branch ? String(b.branch).trim() : null,
      rollNumber: b.rollNumber ? String(b.rollNumber).trim() : null,
      passwordHash: hashPassword(generateTempPassword(12)),
      role: 'user',
      approved: true,
      isWalkIn: true,
      passToken: generatePassToken(),
      paymentStatus: markPaid ? 'paid' : 'not_paid',
      contributionAmount: markPaid ? amount : 0,
      paymentProof: paymentProof,
      paymentProofUploadedAt: paymentProof ? new Date() : null,
      paymentNote: paymentNote,
      paymentMethodUsed: paymentMethodUsed,
      eventPass: {
        checkedIn: checkIn,
        checkedInAt: checkIn ? new Date() : null,
        tshirt: false,
        souvenir: false,
        drinks: 0,
      },
    });

    const resp = await Response.create({
      user: user._id,
      attendance: 'yes',
      foodPreference,
      guests,
      tshirtSize,
      tshirtFit: 'mens',
      accommodationNeeded: false,
    });

    return res.json({ ok: true, userId: user._id, name: user.name });
  } catch (err) {
    return next(err);
  }
});

export default router;
