import { Router } from 'express';
import { User } from '../models/User.js';
import { Response } from '../models/Response.js';
import { Setting } from '../models/Setting.js';
import { config } from '../config.js';

const router = Router();

// GET /api/public/event — event metadata for the landing page
router.get('/event', (_req, res) => {
  return res.json({
    name: config.event.name,
    date: config.event.date,
    venue: config.event.venue,
    locationUrl: config.event.locationUrl,
    videoUrl: config.event.videoUrl,
    time: config.event.time,
    contacts: config.event.contacts,
    schedule: config.event.schedule,
    galleryUrl: config.event.galleryUrl,
    // In-site uploads: only the public bits (cloud name + unsigned preset).
    // When both are set the browser can upload directly to Cloudinary.
    cloudinary: {
      cloudName: config.cloudinary.cloudName,
      uploadPreset: config.cloudinary.uploadPreset,
      enabled: Boolean(config.cloudinary.cloudName && config.cloudinary.uploadPreset),
    },
  });
});

// GET /api/public/payment — contribution amount + payment methods (public info)
router.get('/payment', async (_req, res, next) => {
  try {
    const { amount, note, methods, ready: envReady, comingSoonNote } = config.payment;
    // The admin toggle (DB) is the source of truth; fall back to the env
    // default (PAYMENT_READY) only when it has never been set.
    const dbOpen = await Setting.get('paymentOpen', null);
    const ready = dbOpen === null ? envReady : Boolean(dbOpen);

    // Per-method publish state lives in the DB so the admin can enable/disable
    // individual QR codes without a redeploy. A method is published unless it
    // has been explicitly disabled.
    const methodState = (await Setting.get('paymentMethodState', {})) || {};
    const publishedMethods = methods.filter((_m, i) => methodState[i] !== false);

    return res.json({
      // `enabled` = payment is configured AND open AND at least one method is live.
      // `configured` = methods exist but may not be open yet (coming-soon state).
      configured: methods.length > 0,
      enabled: publishedMethods.length > 0 && ready,
      ready,
      comingSoonNote,
      amount,
      note,
      methods: publishedMethods, // [{ label, upiId, payeeName, qr }] — only published ones
      bankAccount: config.payment.bankAccount, // { bankName, accountName, ... } or null
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/public/stats — live vote counts + headcount for the landing page
router.get('/stats', async (_req, res, next) => {
  try {
    const [agg] = await Response.aggregate([
      // Only count responses from approved members.
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'u',
        },
      },
      { $unwind: '$u' },
      { $match: { 'u.approved': true, 'u.role': 'user' } },
      {
        $group: {
          _id: null,
          totalResponses: { $sum: 1 },
          attending: { $sum: { $cond: [{ $eq: ['$attendance', 'yes'] }, 1, 0] } },
          notAttending: { $sum: { $cond: [{ $eq: ['$attendance', 'no'] }, 1, 0] } },
          maybe: { $sum: { $cond: [{ $eq: ['$attendance', 'maybe'] }, 1, 0] } },
          veg: { $sum: { $cond: [{ $eq: ['$foodPreference', 'veg'] }, 1, 0] } },
          nonVeg: { $sum: { $cond: [{ $eq: ['$foodPreference', 'non_veg'] }, 1, 0] } },
          extraGuests: {
            $sum: { $cond: [{ $eq: ['$attendance', 'yes'] }, '$guests', 0] },
          },
        },
      },
    ]);

    const registered = await User.countDocuments({ role: 'user', approved: true });
    const pending = await User.countDocuments({ role: 'user', approved: false });
    // Live event-day check-in count (from QR scans). 0 until the event starts.
    const checkedIn = await User.countDocuments({
      role: 'user',
      approved: true,
      'eventPass.checkedIn': true,
    });

    const attending = agg?.attending || 0;
    const extraGuests = agg?.extraGuests || 0;

    return res.json({
      registered,
      pending,
      totalResponses: agg?.totalResponses || 0,
      attending,
      notAttending: agg?.notAttending || 0,
      maybe: agg?.maybe || 0,
      food: { veg: agg?.veg || 0, nonVeg: agg?.nonVeg || 0 },
      extraGuests,
      headcount: attending + extraGuests,
      checkedIn,
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/public/contributors — public "thank you" wall of members who have
// PAID. Intentionally exposes only paid members' names + branch and a count.
// It never reveals who hasn't paid / is pending / rejected, nor any amounts —
// that stays private in the admin dashboard.
router.get('/contributors', async (_req, res, next) => {
  try {
    const rows = await User.find({
      role: 'user',
      approved: true,
      paymentStatus: 'paid',
    })
      .select('name branch paymentProofUploadedAt updatedAt')
      .lean();

    // Newest contributors first — by when they submitted their payment proof
    // (fall back to last-updated for anyone marked paid without an upload time).
    const when = (u) =>
      new Date(u.paymentProofUploadedAt || u.updatedAt || 0).getTime();
    rows.sort((a, b) => when(b) - when(a));

    return res.json({
      count: rows.length,
      contributors: rows.map((u) => ({ name: u.name, branch: u.branch || null })),
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/public/attendees — public wall of who has voted "yes"/"maybe".
// Returns only non-sensitive fields.
router.get('/attendees', async (_req, res, next) => {
  try {
    const rows = await Response.find({ attendance: { $in: ['yes', 'maybe'] } })
      .sort({ updatedAt: -1 })
      .populate('user', 'name branch approved role paymentStatus')
      .lean();

    return res.json({
      attendees: rows
        .filter((r) => r.user && r.user.approved && r.user.role === 'user')
        .map((r) => ({
          name: r.user.name,
          branch: r.user.branch,
          attendance: r.attendance,
          guests: r.guests,
          votedAt: r.updatedAt,
          // Positive-only flag: true when the member has paid. We never expose
          // the actual status (pending/rejected/not_paid) publicly — non-payers
          // simply have `paid: false`, so no one is outed as "unpaid".
          paid: r.user.paymentStatus === 'paid',
          // Whether they've asked for accommodation help (travelling in).
          needsStay: Boolean(r.accommodationNeeded),
        })),
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
