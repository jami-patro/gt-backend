/**
 * Migration script: convert single-payment expenses to the new payments[]
 * model. For every expense that has a paid `amount` but no `payments` yet, we
 * create one installment from the legacy fields (amount, method, date, receipt)
 * so the ledger shows it as the first payment. The legacy top-level fields are
 * left in place (harmless) for safety.
 *
 * Idempotent — running it again skips expenses that already have payments.
 *
 * Usage: node scripts/migrate-expense-payments.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import Expense from '../src/models/Expense.js';

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log('✓ Connected to MongoDB');

    const expenses = await Expense.find({
      $or: [{ payments: { $exists: false } }, { payments: { $size: 0 } }],
    });
    console.log(`Found ${expenses.length} expense(s) without payments[]`);

    let migrated = 0;
    for (const e of expenses) {
      // Nothing paid and no receipt → leave payments empty (quotation-only).
      if (!(Number(e.amount) > 0) && !e.proof) continue;

      e.payments = [
        {
          amount: Math.round(Number(e.amount) || 0),
          method: e.paymentMethod || 'cash',
          paidAt: e.spentAt || e.createdAt || new Date(),
          proof: e.proof || null,
          note: e.note || null,
          recordedBy: e.recordedBy || null,
        },
      ];
      // Keep `amount` equal to the sum of payments (it already is here).
      e.amount = e.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      await e.save();
      migrated += 1;
      console.log(`  ✓ ${e.description} — ₹${e.amount} → 1 payment`);
    }

    console.log(`\n✓ Migration complete. ${migrated} expense(s) updated.`);
    await mongoose.connection.close();
  } catch (err) {
    console.error('✗ Migration failed:', err);
    process.exit(1);
  }
}

migrate();
