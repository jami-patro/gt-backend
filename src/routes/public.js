import { Router } from 'express';
import { User } from '../models/User.js';
import { Response } from '../models/Response.js';
import { config } from '../config.js';

const router = Router();

// GET /api/public/event — event metadata for the landing page
router.get('/event', (_req, res) => {
  return res.json({ name: config.event.name, date: config.event.date });
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
      .populate('user', 'name branch approved role')
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
        })),
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
