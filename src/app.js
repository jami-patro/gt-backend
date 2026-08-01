import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { config } from './config.js';
import { connectDB } from './db.js';

import authRoutes from './routes/auth.js';
import rsvpRoutes from './routes/rsvp.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';

const app = express();

app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(
  cors({
    origin(origin, cb) {
      // Allow non-browser tools (no origin) and any configured frontend URL.
      if (!origin || config.frontendUrls.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
  }),
);

// Health check does NOT touch the DB, so uptime pings can keep the function
// warm without depending on Mongo.
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Ensure a live Mongo connection before handling any data request. Cached
// between invocations, so this is a no-op once warm.
app.use(async (_req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('DB connection error:', err.message);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/rsvp', rsvpRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
