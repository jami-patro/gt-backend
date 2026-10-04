/**
 * Migration script: Mark existing walk-in registrations with isWalkIn: true
 * Run once after deploying the isWalkIn field update.
 *
 * Usage: node scripts/migrate-walkins.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';

async function migrateWalkIns() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URL);
    console.log('✓ Connected to MongoDB');

    // Find all users with @walkin.local emails (existing walk-ins)
    const result = await User.updateMany(
      { email: { $regex: '@walkin\\.local$' } },
      { $set: { isWalkIn: true } }
    );

    console.log(`✓ Updated ${result.modifiedCount} existing walk-in records`);
    console.log(`  (${result.matchedCount} records matched the criteria)`);

    // Show a sample of updated records
    const samples = await User.find({ isWalkIn: true })
      .select('name email isWalkIn')
      .limit(5)
      .lean();

    if (samples.length > 0) {
      console.log('\nSample walk-in records:');
      samples.forEach((s) => console.log(`  - ${s.name} (${s.email})`));
    }

    await mongoose.connection.close();
    console.log('\n✓ Migration complete!');
  } catch (err) {
    console.error('✗ Migration failed:', err);
    process.exit(1);
  }
}

migrateWalkIns();
