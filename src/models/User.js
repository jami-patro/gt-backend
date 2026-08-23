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
    // ---- Event-day pass / redemption tracking --------------------------
    // A stable random token embedded in the member's QR code. Generated
    // lazily once they're marked paid. Sparse+unique so many nulls are OK.
    passToken: { type: String, default: null, unique: true, sparse: true, index: true },
    // What they've collected at the venue. Volunteers scan the QR and toggle
    // these. `drinks` is a running count capped at 2.
    eventPass: {
      checkedIn: { type: Boolean, default: false },
      checkedInAt: { type: Date, default: null },
      tshirt: { type: Boolean, default: false },
      tshirtAt: { type: Date, default: null },
      souvenir: { type: Boolean, default: false },
      souvenirAt: { type: Date, default: null },
      drinks: { type: Number, min: 0, max: 2, default: 0 },
      drinksAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;
