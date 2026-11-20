import mongoose from 'mongoose';

// One installment paid against an expense. An expense can be paid in several
// parts (advance, balance, extras), each with its own receipt.
const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    method: {
      type: String,
      enum: ['cash', 'upi', 'bank', 'card', 'other'],
      default: 'cash',
    },
    // Which fund / money-holder THIS installment was drawn from. Lets one
    // expense be paid partly from different funds. Defaults to the expense's
    // fund when not set.
    bucket: { type: String, trim: true, default: null, maxlength: 120 },
    // When this installment was paid.
    paidAt: { type: Date, default: Date.now },
    // Receipt for THIS installment (compressed base64 image data URL).
    proof: { type: String, default: null },
    note: { type: String, trim: true, default: null, maxlength: 300 },
    // Which admin recorded this installment.
    recordedBy: { type: String, trim: true, default: null, maxlength: 120 },
  },
  { timestamps: true },
);

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
    // Total money ACTUALLY PAID so far = sum of `payments[].amount`, maintained
    // server-side. It's what reduces the fund balance. Kept named `amount` for
    // backward compatibility with earlier (single-payment) records.
    amount: { type: Number, required: true, min: 0 },
    // Installments paid against this expense, each with its own receipt.
    payments: { type: [paymentSchema], default: [] },
    // Final agreed quotation / contract price for this vendor (optional). Used
    // only to track what's still owed — it does NOT affect fund balances.
    quotationAmount: { type: Number, min: 0, default: 0 },
    // Advance / first installment paid (informational; part of `amount`).
    advancePaid: { type: Number, min: 0, default: 0 },
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
    // When the first money was spent (not the record-creation time). Kept for
    // sorting/display; individual installment dates live on `payments[].paidAt`.
    spentAt: { type: Date, default: Date.now },
    // Legacy single receipt (pre-installments records). New records store
    // receipts per payment; these are migrated into payments[0].
    proof: { type: String, default: null },
    proofUploadedAt: { type: Date, default: null },
    // Quotation / estimate document as a compressed base64 image data URL —
    // separate from the payment receipt above.
    quotationProof: { type: String, default: null },
    quotationProofUploadedAt: { type: Date, default: null },
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
