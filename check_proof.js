import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from './src/models/User.js';

await mongoose.connect(process.env.MONGO_URL);
const u = await User.findOne({ email: /jami/i })
  .select('name email paymentStatus contributionAmount paymentTransactionId paymentProofUploadedAt')
  .lean();
console.log({
  name: u.name,
  email: u.email,
  paymentStatus: u.paymentStatus,
  amount: u.contributionAmount,
  hasImage: undefined,
  uploadedAt: u.paymentProofUploadedAt,
});
await mongoose.disconnect();
process.exit(0);
