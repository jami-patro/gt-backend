import { Router } from 'express';
import { Response } from '../models/Response.js';
import { requireAuth } from '../middleware/auth.js';

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

    return res.json({ response: shapeResponse(r) });
  } catch (err) {
    return next(err);
  }
});

export default router;
