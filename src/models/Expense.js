import mongoose from 'mongoose';

// A single event expenditure — part of the finance "checks & balances" view.
// Every rupee spent is logged here with who paid it and (ideally) a receipt,
// so Collected (paid contributions) minus Spent (these) = balance remaining.
const expenseSchema = new mongoose.Schema(
  {
    // What the money was spent on. Required — the ledger must be readable.
    description: { type: String, required: true, trim: true, maxlength: 300 },
    // Loose category for the breakdown. Free text so organizers aren't boxed in,
    // but seeded with the common reunion buckets on the frontend.
    category: { type: String, trim: true, default: 'Other', maxlength: 60 },
    // Amount in INR. Stored as a rounded whole number (same as contributions).
    amount: { type: Number, required: true, min: 0 },
    // Which fund / money-holder the expense was drawn from (e.g. "Saumendra",
    // "Shibasis", "Jami"). Collection methods map into these funds, so each
    // fund's balance = money collected into it minus money spent from it.
    bucket: { type: String, trim: true, default: null, maxlength: 120, index: true },
    // Who actually paid / incurred the expense (committee member name).
    paidBy: { type: String, required: true, trim: true, maxlength: 120 },
    // Vendor / payee the money went to (shop, caterer…). Optional.
    paidTo: { type: String, trim: true, default: null, maxlength: 120 },
    // How it was paid: cash / upi / bank / card / other.
    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'bank', 'card', 'other'],
      default: 'cash',
    },
    // When the money was spent (not the record-creation time).
    spentAt: { type: Date, default: Date.now },
    // Receipt / bill proof as a compressed base64 data URL (same approach as
    // member payment proofs — keeps Mongo tiny and needs no extra storage).
    proof: { type: String, default: null },
    proofUploadedAt: { type: Date, default: null },
    // Free-text note (reference number, context, etc.).
    note: { type: String, trim: true, default: null, maxlength: 500 },
    // Audit trail: which admin logged/last-edited this entry.
    recordedBy: { type: String, trim: true, default: null, maxlength: 120 },
  },
  { timestamps: true },
);

export const Expense =
  mongoose.models.Expense || mongoose.model('Expense', expenseSchema);
export default Expense;
