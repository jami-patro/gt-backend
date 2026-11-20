/**
 * Backfill: set each payment's `bucket` to its expense's `bucket` where the
 * payment doesn't already have one. Run once after adding per-payment funds.
 * Idempotent.
 *
 * Usage: node scripts/backfill-payment-buckets.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import Expense from '../src/models/Expense.js';

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 15000 });
    console.log('✓ Connected to MongoDB');

    const expenses = await Expense.find({ 'payments.0': { $exists: true } });
    let touched = 0;
    for (const e of expenses) {
      let changed = false;
      for (const p of e.payments) {
        if (!p.bucket && e.bucket) {
          p.bucket = e.bucket;
          changed = true;
        }
      }
      if (changed) {
        await e.save();
        touched += 1;
        console.log(`  ✓ ${e.description} — payments inherited fund "${e.bucket}"`);
      }
    }
    console.log(`\n✓ Backfill complete. ${touched} expense(s) updated.`);
    await mongoose.connection.close();
  } catch (err) {
    console.error('✗ Backfill failed:', err);
    process.exit(1);
  }
}

run();
