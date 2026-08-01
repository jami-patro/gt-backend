import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 5050,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrls: (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || 'dev_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017/gettogether',
  event: {
    name: process.env.EVENT_NAME || 'Silver Jubilee Batch Reunion',
    date: process.env.EVENT_DATE || '2026-12-19',
  },
  admin: {
    name: process.env.ADMIN_NAME || 'Reunion Admin',
    email: process.env.ADMIN_EMAIL || 'admin@reunion.com',
    password: process.env.ADMIN_PASSWORD || 'changeme123',
  },
};
