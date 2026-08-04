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
    name: process.env.EVENT_NAME || 'OEC Silver Jubilee 1997-2001 Batch Reunion',
    date: process.env.EVENT_DATE || '2026-12-19',
    venue: process.env.EVENT_VENUE || 'Bhubaneswar',
    // Optional Google Maps (or any) link to the venue.
    locationUrl: process.env.EVENT_LOCATION_URL || '',
    time: process.env.EVENT_TIME || '5:00 PM – 10:00 PM (TBD)',
    // One or more contacts, comma-separated. Each may be "Name" or
    // "Name - phone" (e.g. "Mrunal Jena - 9876543210, Srikanta Patro - 9123456789").
    contacts: (process.env.EVENT_CONTACT || 'Mrunal Jena')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        const m = entry.match(/^(.*?)\s*[-–:]\s*(.+)$/);
        return m ? { name: m[1].trim(), phone: m[2].trim() } : { name: entry, phone: '' };
      }),
    // Optional WhatsApp group invite link (https://chat.whatsapp.com/...).
    whatsappUrl: process.env.WHATSAPP_URL || '',
  },
  admin: {
    name: process.env.ADMIN_NAME || 'Reunion Admin',
    email: process.env.ADMIN_EMAIL || 'admin@reunion.com',
    password: process.env.ADMIN_PASSWORD || 'changeme123',
  },
  email: {
    // Provider is auto-detected: Gmail (SMTP) is used when GMAIL_USER +
    // GMAIL_APP_PASSWORD are set; otherwise Resend (HTTP) is used.
    gmailUser: (process.env.GMAIL_USER || '').trim(),
    // App passwords are displayed with spaces; Google expects them removed.
    gmailAppPassword: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
    // Resend (needs a verified domain to reach arbitrary recipients)
    apiKey: process.env.RESEND_API_KEY || '',
    // Display "from". For Gmail this defaults to the Gmail address.
    // e.g. "OEC Reunion <noreply@yourdomain.com>"
    from: process.env.EMAIL_FROM || '',
    fromName: process.env.EMAIL_FROM_NAME || 'OEC Silver Jubilee Reunion',
    replyTo: process.env.EMAIL_REPLY_TO || '',
  },
};
