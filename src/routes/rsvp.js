import { Router } from 'express';
import { Response } from '../models/Response.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import {
  sendRsvpConfirmation,
  sendPaymentUnderReview,
  sendPaymentSubmittedAlert,
} from '../services/email.js';
import { sendPaymentSubmittedTelegram } from '../services/telegram.js';
import { Setting } from '../models/Setting.js';
import { config } from '../config.js';

const router = Router();

const ATTENDANCE = ['yes', 'no', 'maybe'];
const FOOD = ['veg', 'non_veg'];
const TSHIRT = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

function shapeResponse(r) {
  if (!r) return null;
  return {
    attendance: r.attendance,
    foodPreference: r.foodPreference,
    guests: r.guests,
    tshirtSize: r.tshirtSize,
    message: r.message,
    updatedAt: r.updatedAt,
  };
}

// GET /api/rsvp — the current user's own response (may be null)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const r = await Response.findOne({ user: req.user.id });
    return res.json({ response: shapeResponse(r) });
  } catch (err) {
    return next(err);
  }
});

// PUT /api/rsvp — create or update the current user's response (editable RSVP)
router.put('/', requireAuth, async (req, res, next) => {
  try {
    const {
      attendance = 'yes',
      foodPreference = 'veg',
      guests = 0,
      tshirtSize = null,
      message = null,
    } = req.body || {};

    if (!ATTENDANCE.includes(attendance)) {
      return res.status(400).json({ error: `attendance must be one of ${ATTENDANCE.join(', ')}` });
    }
    if (!FOOD.includes(foodPreference)) {
      return res.status(400).json({ error: `foodPreference must be one of ${FOOD.join(', ')}` });
    }
    const guestCount = Number.parseInt(guests, 10);
    if (Number.isNaN(guestCount) || guestCount < 0 || guestCount > 20) {
      return res.status(400).json({ error: 'guests must be a number between 0 and 20' });
    }
    if (tshirtSize && !TSHIRT.includes(tshirtSize)) {
      return res.status(400).json({ error: `tshirtSize must be one of ${TSHIRT.join(', ')}` });
    }
    const note = message ? String(message).slice(0, 500) : null;

    const r = await Response.findOneAndUpdate(
      { user: req.user.id },
      {
        user: req.user.id,
        attendance,
        foodPreference,
        guests: guestCount,
        tshirtSize: tshirtSize || null,
        message: note,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    // Send an RSVP confirmation. Awaited (serverless-safe) but never blocks
    // a successful save if email fails.
    try {
      const user = await User.findById(req.user.id).lean();
      if (user?.email) {
        const mail = await sendRsvpConfirmation(user, r);
        if (!mail.ok && !mail.skipped) console.warn('RSVP email failed:', mail.error);
      }
    } catch (e) {
      console.warn('RSVP email error:', e.message);
    }

    return res.json({ response: shapeResponse(r) });
  } catch (err) {
    return next(err);
  }
});

// GET /api/rsvp/payment — the current user's payment status (no image blob)
router.get('/payment', requireAuth, async (req, res, next) => {
  try {
    const u = await User.findById(req.user.id).lean();
    if (!u) return res.status(404).json({ error: 'User not found' });
    return res.json({
      paymentStatus: u.paymentStatus || 'not_paid',
      contributionAmount: u.contributionAmount ?? 0,
      paymentNote: u.paymentNote || null,
      paymentMethodUsed: u.paymentMethodUsed || null,
      paymentRejectReason: u.paymentRejectReason || null,
      uploadedAt: u.paymentProofUploadedAt || null,
      hasProof: Boolean(u.paymentProof),
    });
  } catch (err) {
    return next(err);
  }
});

// PUT /api/rsvp/payment-proof — member uploads a payment screenshot + note.
// Body: { image (base64 data URL), note, methodUsed? }
router.put('/payment-proof', requireAuth, async (req, res, next) => {
  try {
    // Reject submissions while collection is closed (coming-soon state).
    // Admin DB toggle wins; env PAYMENT_READY is only the default.
    const dbOpen = await Setting.get('paymentOpen', null);
    const open = dbOpen === null ? config.payment.ready : Boolean(dbOpen);
    if (!(config.payment.methods.length > 0 && open)) {
      return res.status(403).json({ error: 'Contributions are not open yet.' });
    }

    // Which method(s) are currently published — captured implicitly so the
    // admin knows which account the money should have gone to. Usually just one.
    const methodState = (await Setting.get('paymentMethodState', {})) || {};
    const activeMethodLabel =
      config.payment.methods
        .filter((_m, i) => methodState[i] !== false)
        .map((m) => m.label)
        .filter(Boolean)
        .join(', ') || null;

    const { image, note, transactionId } = req.body || {};

    // Proof of payment: EITHER a screenshot OR a transaction/UTR id is required.
    const hasImage = typeof image === 'string' && image.startsWith('data:image/');
    const txnId = transactionId ? String(transactionId).trim() : '';
    if (image && !hasImage) {
      return res.status(400).json({ error: 'Uploaded file must be an image' });
    }
    if (hasImage && image.length > 1_700_000) {
      return res.status(413).json({ error: 'Image too large — please retry (it should auto-compress)' });
    }
    if (!hasImage && !txnId) {
      return res
        .status(400)
        .json({ error: 'Attach a payment screenshot or enter the transaction / UTR id' });
    }
    if (!note || !String(note).trim()) {
      return res
        .status(400)
        .json({ error: 'Please add a reference note (who paid / UPI name)' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Screenshot is optional when a transaction id is provided.
    user.paymentProof = hasImage ? image : null;
    user.paymentTransactionId = txnId ? txnId.slice(0, 100) : null;
    user.paymentProofUploadedAt = new Date();
    user.paymentNote = String(note).slice(0, 300);
    // Implicitly recorded from whichever QR/method was live at submission time.
    user.paymentMethodUsed = activeMethodLabel ? activeMethodLabel.slice(0, 150) : null;
    user.paymentRejectReason = null;
    // Don't override an admin-confirmed payment.
    const wasPaid = user.paymentStatus === 'paid';
    if (!wasPaid) user.paymentStatus = 'pending';
    await user.save();

    // Acknowledge the submission by email (skip if already confirmed paid).
    // Awaited (serverless-safe) but never blocks a successful save.
    if (!wasPaid && user.email) {
      try {
        const mail = await sendPaymentUnderReview(user);
        if (!mail.ok && !mail.skipped) console.warn('Under-review email failed:', mail.error);
      } catch (e) {
        console.warn('Under-review email error:', e.message);
      }
    }

    // Alert the organizers so they know there's a new proof to review.
    if (!wasPaid) {
      try {
        const alert = await sendPaymentSubmittedAlert(user);
        if (!alert.ok && !alert.skipped) console.warn('Admin alert email failed:', alert.error);
      } catch (e) {
        console.warn('Admin alert email error:', e.message);
      }

      // Instant Telegram push to organizers' phones (no-op if unconfigured).
      try {
        const tg = await sendPaymentSubmittedTelegram(user);
        if (!tg.ok && !tg.skipped) console.warn('Admin alert Telegram failed:', tg.errors?.join('; '));
      } catch (e) {
        console.warn('Admin alert Telegram error:', e.message);
      }
    }

    return res.json({
      paymentStatus: user.paymentStatus,
      paymentNote: user.paymentNote,
      transactionId: user.paymentTransactionId,
      uploadedAt: user.paymentProofUploadedAt,
      hasProof: Boolean(user.paymentProof),
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
