import mongoose from 'mongoose';

// One response per user (enforced by the unique user reference).
const responseSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    attendance: {
      type: String,
      enum: ['yes', 'no', 'maybe'],
      default: 'yes',
    },
    foodPreference: {
      type: String,
      enum: ['veg', 'non_veg'],
      default: 'veg',
    },
    guests: { type: Number, min: 0, max: 20, default: 0 },
    tshirtSize: {
      type: String,
      enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL', null],
      default: null,
    },
    message: { type: String, maxlength: 500, default: null },
  },
  { timestamps: true },
);

export const Response =
  mongoose.models.Response || mongoose.model('Response', responseSchema);
export default Response;
