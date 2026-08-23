import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

// Generate a readable temporary password for the "forgot password" flow.
// Avoids ambiguous characters (0/O, 1/l/I) so it's easy to type from an email.
export function generateTempPassword(length = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

// Random URL-safe token embedded in a member's event-pass QR code. Long
// enough to be unguessable; hex keeps it URL-safe with no encoding needed.
export function generatePassToken() {
  return crypto.randomBytes(16).toString('hex');
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

// Basic email + password sanity checks. Kept intentionally light for a
// small private reunion app.
export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
