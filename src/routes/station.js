import { Router } from 'express';
import { User } from '../models/User.js';
import { resolveStationToken } from '../utils/stations.js';

// Public volunteer-counter endpoints. Authorization is by the secret station
// token in the URL (handed out by the organizer), NOT by user login — so
// volunteers don't need an account. The token identifies which counter.

const router = Router();

function shapePass(u) {
  const p = u.eventPass || {};
  return {
    checkedIn: Boolean(p.checkedIn),
    tshirt: Boolean(p.tshirt),
    souvenir: Boolean(p.souvenir),
    drinks: Number(p.drinks) || 0,
  };
}

// Pull the member's pass token out of a scanned value. The QR encodes a full
// URL (…/pass/<token>), but accept a bare token too.
function extractPassToken(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  const m = v.match(/\/pass\/([A-Za-z0-9]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9]+$/.test(v) ? v : '';
}

// Apply a single redemption action to a member. Returns { already, message }.
function applyAction(user, action) {
  if (!user.eventPass) user.eventPass = {};
  const p = user.eventPass;
  const now = new Date();

  switch (action) {
    case 'checkin': {
      const already = Boolean(p.checkedIn);
      p.checkedIn = true;
      if (!already) p.checkedInAt = now;
      return { already, message: already ? 'Already checked in' : 'Checked in' };
    }
    case 'tshirt': {
      const already = Boolean(p.tshirt);
      p.tshirt = true;
      if (!already) p.tshirtAt = now;
      return { already, message: already ? 'T-shirt already collected' : 'T-shirt handed over' };
    }
    case 'souvenir': {
      const already = Boolean(p.souvenir);
      p.souvenir = true;
      if (!already) p.souvenirAt = now;
      return { already, message: already ? 'Souvenir already collected' : 'Souvenir handed over' };
    }
    case 'drink': {
      const count = Number(p.drinks) || 0;
      if (count >= 2) return { already: true, message: 'Drinks limit reached (2/2)' };
      p.drinks = count + 1;
      p.drinksAt = now;
      return { already: false, message: `Drink served (${count + 1}/2)` };
    }
    default:
      return null;
  }
}

// Map a single-action counter to its action verb.
const STATION_ACTION = { checkin: 'checkin', tshirt: 'tshirt', souvenir: 'souvenir', drinks: 'drink' };

// GET /api/station/:token — validate a counter link and say which counter it
// is, so the volunteer screen can label itself.
router.get('/:token', async (req, res, next) => {
  try {
    const station = await resolveStationToken(String(req.params.token || '').trim());
    if (!station) return res.status(404).json({ error: 'Invalid or expired counter link' });
    return res.json({
      station: station.key,
      label: station.label,
      emoji: station.emoji,
      multi: Boolean(station.multi),
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/station/:token/scan — a volunteer scanned a member's pass.
// Single-action counters apply their action immediately. The all-in-one
// ("multi") counter just returns the member + status so the volunteer can
// choose which actions to mark.
router.post('/:token/scan', async (req, res, next) => {
  try {
    const station = await resolveStationToken(String(req.params.token || '').trim());
    if (!station) return res.status(404).json({ error: 'Invalid or expired counter link' });

    const passToken = extractPassToken(req.body?.pass);
    if (!passToken) return res.status(400).json({ error: "That QR isn't a valid pass" });

    const user = await User.findOne({ passToken });
    if (!user) return res.status(404).json({ error: 'Pass not recognized' });

    const base = {
      ok: true,
      name: user.name,
      branch: user.branch || null,
      paid: user.paymentStatus === 'paid',
      station: station.key,
      multi: Boolean(station.multi),
    };

    // All-in-one counter: no auto-mark, just surface the current status.
    if (station.multi) {
      return res.json({ ...base, status: shapePass(user) });
    }

    // Single-action counter: apply and save.
    const result = applyAction(user, STATION_ACTION[station.key]);
    if (!result) return res.status(400).json({ error: 'Unknown counter' });
    await user.save();
    return res.json({ ...base, already: result.already, message: result.message, status: shapePass(user) });
  } catch (err) {
    return next(err);
  }
});

// POST /api/station/:token/mark — apply one action to a member. Used by the
// all-in-one counter's action buttons. Body: { pass, action }.
router.post('/:token/mark', async (req, res, next) => {
  try {
    const station = await resolveStationToken(String(req.params.token || '').trim());
    if (!station) return res.status(404).json({ error: 'Invalid or expired counter link' });

    const passToken = extractPassToken(req.body?.pass);
    if (!passToken) return res.status(400).json({ error: "That QR isn't a valid pass" });

    const action = String(req.body?.action || '').trim();
    if (!['checkin', 'tshirt', 'souvenir', 'drink'].includes(action)) {
      return res.status(400).json({ error: 'Unknown action' });
    }

    const user = await User.findOne({ passToken });
    if (!user) return res.status(404).json({ error: 'Pass not recognized' });

    const result = applyAction(user, action);
    await user.save();
    return res.json({
      ok: true,
      already: result.already,
      message: result.message,
      name: user.name,
      status: shapePass(user),
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
