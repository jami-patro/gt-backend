import dotenv from 'dotenv';

dotenv.config();

// Parse payment methods from env (JSON array preferred, single-method fallback).
function parsePaymentMethods() {
  const raw = process.env.PAYMENT_METHODS;
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr
          .map((m) => ({
            label: (m.label || '').trim(),
            upiId: (m.upiId || '').trim(),
            payeeName: (m.payeeName || '').trim(),
            phone: (m.phone || '').trim(),
            qr: (m.qr || m.qrUrl || '').trim(),
          }))
          .filter((m) => m.upiId || m.qr || m.phone);
      }
    } catch {
      // fall through to single-method
    }
  }
  const upiId = (process.env.PAYMENT_UPI_ID || '').trim();
  const qr = (process.env.PAYMENT_QR_URL || '').trim();
  const phoneOnly = (process.env.PAYMENT_PHONE || '').trim();
  if (!upiId && !qr && !phoneOnly) return [];
  return [
    {
      label: (process.env.PAYMENT_LABEL || 'UPI').trim(),
      upiId,
      payeeName: (process.env.PAYMENT_PAYEE_NAME || '').trim(),
      phone: (process.env.PAYMENT_PHONE || '').trim(),
      qr,
    },
  ];
}

// Parse the day's programme/schedule from env. Prefer a JSON array in
// EVENT_SCHEDULE, e.g.
//   '[{"time":"12:30 PM","title":"Meet & Greet with Lunch"},
//     {"time":"4:30 PM","title":"Evening Snacks"},
//     {"time":"7:00 PM","title":"DJ Night & Dinner"}]'
// Falls back to a default running order if unset.
function parseSchedule() {
  const raw = process.env.EVENT_SCHEDULE;
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr
          .map((s) => ({
            time: (s.time || '').trim(),
            title: (s.title || '').trim(),
            description: (s.description || '').trim(),
          }))
          .filter((s) => s.title);
      }
    } catch {
      // fall through to defaults
    }
  }
  return [
    { time: '1:00 – 2:00 PM', title: '🍽️ Welcome Drinks, Lunch, Registration & T-Shirt Distribution', description: '' },
    { time: '2:00 – 2:45 PM', title: '🎤 Welcome & Ice Breaker', description: '' },
    { time: '2:45 – 3:30 PM', title: '📸 Guess Who? — Old Photo Slider', description: '' },
    { time: '3:30 – 4:15 PM', title: '😂 Fun Games', description: '' },
    { time: '4:15 – 5:00 PM', title: '❤️ Old Memories Session', description: '' },
    { time: '5:00 – 5:30 PM', title: '☕ Tea & Snacks', description: '' },
    { time: '5:30 – 6:15 PM', title: '🎭 Cultural & Fun Performances', description: '' },
    { time: '7:00 – 7:45 PM', title: '🏅 Awards, Souvenirs & Reunion Moments', description: '' },
    { time: '7:45 – 8:30 PM', title: '🎤 Open Mic & Friendship Time', description: '' },
    { time: '8:30 PM onwards', title: '💃 Music, Dance & Grand Closing', description: '' },
  ];
}

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
    // Optional venue tour video (e.g. a YouTube link).
    videoUrl: process.env.EVENT_VIDEO_URL || '',
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
    // The day's running order (programme). Edit via EVENT_SCHEDULE (JSON).
    schedule: parseSchedule(),
  },
  admin: {
    name: process.env.ADMIN_NAME || 'Reunion Admin',
    email: process.env.ADMIN_EMAIL || 'admin@reunion.com',
    password: process.env.ADMIN_PASSWORD || 'changeme123',
  },
  payment: {
    // Suggested contribution amount in INR (0/blank = "amount TBD").
    amount: Number(process.env.PAYMENT_AMOUNT) || 0,
    // Master switch: when false, the contribution section shows a greyed-out
    // "opens soon" preview and uploads are blocked. Flip to true (and redeploy)
    // when you're ready to collect. Defaults to false so it's never live by
    // accident.
    ready: process.env.PAYMENT_READY === 'true',
    // Optional message shown while payments aren't open yet.
    comingSoonNote:
      process.env.PAYMENT_COMING_SOON_NOTE ||
      'Contributions open soon — the payment options will be enabled here shortly.',
    // Short note shown above the payment options.
    note: process.env.PAYMENT_NOTE || '',
    // One or more payment methods. Provide as JSON in PAYMENT_METHODS, e.g.
    // '[{"label":"GPay - Mrunal","upiId":"mrunal@oksbi","payeeName":"Mrunal Jena","qr":"https://.../gpay.png"}]'
    // Falls back to single method from PAYMENT_UPI_ID / PAYMENT_PAYEE_NAME / PAYMENT_QR_URL.
    methods: parsePaymentMethods(),
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
