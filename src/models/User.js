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
    // Contribution tracking (admin-managed). Amounts in INR.
    paymentStatus: { type: String, enum: ['not_paid', 'paid'], default: 'not_paid' },
    contributionAmount: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;
