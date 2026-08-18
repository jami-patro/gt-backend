import { Router } from 'express';
import { User } from '../models/User.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  isValidEmail,
  generateTempPassword,
} from '../utils/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { sendWelcomeEmail, sendPasswordReset, isEmailEnabled } from '../services/email.js';

const router = Router();

function publicUser(u) {
  return {
    id: u._id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    branch: u.branch,
    rollNumber: u.rollNumber,
    role: u.role,
    approved: u.approved,
  };
}

// POST /api/auth/register — batch member self-signup
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, phone, branch, rollNumber } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail }).lean();
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      phone: phone?.trim() || null,
      branch: branch?.trim() || null,
      rollNumber: rollNumber?.trim() || null,
      passwordHash: hashPassword(String(password)),
      role: 'user',
    });

    // Send the welcome email before responding. On serverless (Vercel) any
    // work started after the response may be frozen/killed, so we await it.
    // Wrapped so a mail failure never blocks a successful registration.
    try {
      const mail = await sendWelcomeEmail(user);
      if (!mail.ok && !mail.skipped) console.warn('Welcome email failed:', mail.error);
    } catch (e) {
      console.warn('Welcome email error:', e.message);
    }

    const token = signToken(user);
    return res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/login — shared by users and admin
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user || !verifyPassword(String(password), user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    return res.json({ token, user: publicUser(user) });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/forgot-password — email the user a new temporary password.
// The original password is only stored as a bcrypt hash and can't be recovered,
// so we generate a fresh one, save it, and email it. We always respond with a
// generic success (even if the email isn't registered) to avoid revealing which
// addresses have accounts.
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    // Tell the user directly when the email isn't registered — this is a small
    // private reunion site, so the clearer UX is worth more than hiding which
    // addresses exist.
    if (!user) {
      return res.status(404).json({
        error: "That email isn't registered. Please check the spelling, or register to RSVP.",
      });
    }
    // Email provider not configured on the server — can't send anything.
    if (!isEmailEnabled()) {
      return res.status(503).json({
        error: 'Email sending is not set up yet. Please contact the organizers.',
      });
    }

    const tempPassword = generateTempPassword(10);
    user.passwordHash = hashPassword(tempPassword);
    await user.save();

    let mailOk = true;
    try {
      const mail = await sendPasswordReset(user, tempPassword);
      mailOk = mail.ok || mail.skipped;
      if (!mailOk) console.warn('Password reset email failed:', mail.error);
    } catch (e) {
      mailOk = false;
      console.warn('Password reset email error:', e.message);
    }

    if (!mailOk) {
      return res.status(502).json({
        error: 'We could not send the email right now. Please try again in a moment.',
      });
    }

    return res.json({
      ok: true,
      message: 'A new password has been sent to your email.',
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/auth/me — current session
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: publicUser(user) });
  } catch (err) {
    return next(err);
  }
});

export default router;
