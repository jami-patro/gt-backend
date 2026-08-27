import { verifyToken } from '../utils/auth.js';

// Requires a valid Bearer token. Attaches decoded payload to req.user.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// Attaches req.user when a valid token is present, but never rejects the
// request when it's missing/invalid. Useful for endpoints that are public but
// want to record the user when they happen to be logged in.
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      req.user = verifyToken(token);
    } catch {
      // ignore — treat as anonymous
    }
  }
  return next();
}

// Requires the authenticated user to be an admin. Use after requireAuth.
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}
