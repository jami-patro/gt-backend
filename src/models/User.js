import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, trim: true, default: null },
    branch: { type: String, trim: true, default: null },
    rollNumber: { type: String, trim: true, default: null },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    // Members start unapproved; an admin approves them before their vote counts.
    approved: { type: Boolean, default: false },
    // Contribution tracking. Amounts in INR.
    // not_paid -> pending (proof uploaded) -> paid | rejected
    paymentStatus: {
      type: String,
      enum: ['not_paid', 'pending', 'paid', 'rejected'],
      default: 'not_paid',
    },
    contributionAmount: { type: Number, min: 0, default: 0 },
    // Payment proof (screenshot) stored as a compressed base64 data URL.
    paymentProof: { type: String, default: null },
    paymentProofUploadedAt: { type: Date, default: null },
    // Reference note from the payer (who paid / from whose account / free text).
    paymentNote: { type: String, trim: true, default: null },
    // UPI transaction / reference (UTR) id — an alternative to a screenshot.
    paymentTransactionId: { type: String, trim: true, default: null },
    // Which listed method they used (optional label).
    paymentMethodUsed: { type: String, trim: true, default: null },
    // Admin's reason when a proof is rejected.
    paymentRejectReason: { type: String, trim: true, default: null },
  },
  { timestamps: true },
);

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;
