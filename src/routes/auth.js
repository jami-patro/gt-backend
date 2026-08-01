import { Router } from 'express';
import { User } from '../models/User.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  isValidEmail,
} from '../utils/auth.js';
import { requireAuth } from '../middleware/auth.js';

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
