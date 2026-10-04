/**
 * Seed script: Create default volunteer account
 * Usage: node scripts/seed-volunteer.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import { hashPassword } from '../src/utils/auth.js';

async function seedVolunteer() {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log('✓ Connected to MongoDB');

    const email = process.env.VOLUNTEER_EMAIL || 'volunteer@reunion.com';
    const existing = await User.findOne({ email }).lean();

    if (existing) {
      console.log(`✓ Volunteer account already exists: ${email}`);
      await mongoose.connection.close();
      return;
    }

    await User.create({
      name: process.env.VOLUNTEER_NAME || 'Check-in Volunteer',
      email: email,
      passwordHash: hashPassword(process.env.VOLUNTEER_PASSWORD || 'checkin123'),
      role: 'volunteer',
      approved: true,
    });

    console.log(`✓ Created volunteer account:`);
    console.log(`  Email: ${email}`);
    console.log(`  Password: ${process.env.VOLUNTEER_PASSWORD || 'checkin123'}`);
    console.log(`  Role: volunteer`);

    await mongoose.connection.close();
  } catch (err) {
    console.error('✗ Seed failed:', err);
    process.exit(1);
  }
}

seedVolunteer();
