// One-time backfill: assign sequential passNumber (1,2,3…) to every member who
// already has a pass token but no number yet, ordered by registration date so
// the numbering is stable. Safe to re-run — it only fills gaps.
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { User } from '../src/models/User.js';

async function main() {
  await mongoose.connect(config.mongoUrl);
  console.log('Connected.');

  // Current highest number already assigned (so a re-run continues, not resets).
  const top = await User.findOne({ passNumber: { $ne: null } })
    .sort({ passNumber: -1 })
    .select('passNumber')
    .lean();
  let seq = top?.passNumber || 0;

  // Pass-holders still missing a number, oldest first for stable ordering.
  const pending = await User.find({
    passToken: { $ne: null },
    $or: [{ passNumber: null }, { passNumber: { $exists: false } }],
  })
    .sort({ createdAt: 1 })
    .select('_id name');

  console.log(`Found ${pending.length} pass-holder(s) needing a number. Starting at ${seq + 1}.`);

  for (const u of pending) {
    seq += 1;
    await User.updateOne({ _id: u._id }, { $set: { passNumber: seq } });
    console.log(`  #${seq} → ${u.name}`);
  }

  console.log('Done.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
