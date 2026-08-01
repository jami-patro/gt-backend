// Creates (or updates) the admin account from .env values.
// Run with: npm run seed:admin
import mongoose from 'mongoose';
import { connectDB } from '../db.js';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { hashPassword } from '../utils/auth.js';

async function run() {
  await connectDB();

  const email = config.admin.email.toLowerCase().trim();
  const passwordHash = hashPassword(config.admin.password);

  const existing = await User.findOne({ email });
  if (existing) {
    existing.name = config.admin.name;
    existing.passwordHash = passwordHash;
    existing.role = 'admin';
    existing.approved = true;
    await existing.save();
    console.log(`Updated existing admin: ${email}`);
  } else {
    await User.create({ name: config.admin.name, email, passwordHash, role: 'admin', approved: true });
    console.log(`Created admin: ${email}`);
  }

  console.log('Password is set from ADMIN_PASSWORD in your .env file.');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
