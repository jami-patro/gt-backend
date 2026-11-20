import { Router } from 'express';
import { User } from '../models/User.js';
import { Expense } from '../models/Expense.js';
import { Setting } from '../models/Setting.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Everything here is admin-only (financial data).
router.use(requireAuth, requireAdmin);

const PAYMENT_METHODS = ['cash', 'upi', 'bank', 'card', 'other'];

// Label used by the collection grouping when a paid member has no recorded
// payment method. Must match the frontend's "Unspecified" fallback.
const UNSPECIFIED = 'Unspecified';

// Funds / money-holders. Each fund owns one or more collection-method labels;
// the money collected via those methods is considered to sit in that fund.
// Seeded default (editable by the admin via PUT /buckets). The bank account is
// held by "Shibasis Hota", so bank/NRI + unspecified collections default there.
const DEFAULT_BUCKETS = [
  { name: 'Saumendra', methods: ['GooglePay - Saumendra Pattnaik'] },
  { name: 'Shibasis', methods: ['Unspecified', 'Bank transfer (NRI)'] },
  { name: 'Jami', methods: ['PhonePe - J Srikanta Patro'] },
];

// Read the saved fund config, falling back to the seeded default. Normalizes
// shape so the rest of the code can trust { name:string, methods:string[] }[].
async function getBuckets() {
  const saved = await Setting.get('fundBuckets', null);
  const source = Array.isArray(saved) && saved.length > 0 ? saved : DEFAULT_BUCKETS;
  return source
    .map((b) => ({
      name: String(b?.name || '').trim(),
      methods: Array.isArray(b?.methods)
        ? b.methods.map((m) => String(m || '').trim()).filter(Boolean)
        : [],
    }))
    .filter((b) => b.name);
}

// Money collected per payment-method label (paid contributions only).
// Keyed by `paymentMethodUsed`, with null/blank folded into "Unspecified".
async function getCollectedByMethod() {
  const rows = await User.find({ role: 'user', paymentStatus: 'paid' })
    .select('contributionAmount paymentMethodUsed')
    .lean();
  const map = new Map();
  for (const r of rows) {
    const key = (r.paymentMethodUsed || '').trim() || UNSPECIFIED;
    const cur = map.get(key) || { amount: 0, count: 0 };
    cur.amount += Number(r.contributionAmount) || 0;
    cur.count += 1;
    map.set(key, cur);
  }
  return map; // Map<label, { amount, count }>
}

// Keep `amount` (total paid) equal to the sum of the installments. Called on
// any write that touches payments.
function recalcAmount(expense) {
  const list = Array.isArray(expense.payments) ? expense.payments : [];
  expense.amount = list.reduce((sum, p) => sum + (Math.round(Number(p.amount)) || 0), 0);
}

// Shape one installment for the API — never includes the proof blob. Works on
// both a Mongoose subdoc (has `proof`) and an aggregation row (has `hasProof`).
function shapePayment(p) {
  return {
    id: String(p._id || p.id || ''),
    amount: p.amount ?? 0,
    method: p.method || 'cash',
    bucket: p.bucket || null,
    paidAt: p.paidAt || p.createdAt || null,
    note: p.note || null,
    recordedBy: p.recordedBy || null,
    hasProof: p.hasProof !== undefined ? Boolean(p.hasProof) : Boolean(p.proof),
    createdAt: p.createdAt || null,
  };
}

// Shape an expense for the API. Proof blobs are omitted (lazy-loaded). Accepts
// either a Mongoose doc (blobs present) or an aggregation row (boolean flags).
function shapeExpense(e) {
  const payments = (Array.isArray(e.payments) ? e.payments : []).map(shapePayment);
  // Total paid is the sum of installments; fall back to the stored amount for
  // any (not-yet-migrated) record without payments.
  const amount = payments.length
    ? payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
    : e.amount ?? 0;
  const quotationAmount = e.quotationAmount ?? 0;
  // Still owed to the vendor. Only meaningful once a quotation is set; never
  // negative (overpayments show as 0 outstanding).
  const outstanding = quotationAmount > 0 ? Math.max(0, quotationAmount - amount) : 0;
  const hasQuotationProof =
    e.hasQuotationProof !== undefined ? Boolean(e.hasQuotationProof) : Boolean(e.quotationProof);
  return {
    id: e._id,
    description: e.description,
    category: e.category || 'Other',
    amount, // total paid
    quotationAmount,
    advancePaid: e.advancePaid ?? 0,
    outstanding,
    bucket: e.bucket || null,
    paidBy: e.paidBy,
    paidTo: e.paidTo || null,
    spentAt: e.spentAt || e.createdAt || null,
    note: e.note || null,
    recordedBy: e.recordedBy || null,
    payments,
    paymentCount: payments.length,
    // Convenience flag: any installment has a receipt.
    hasProof: payments.some((p) => p.hasProof),
    hasQuotationProof,
    quotationProofUploadedAt: e.quotationProofUploadedAt || null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

// GET /api/admin/finance — the full checks-&-balances view: collected, spent,
// balance remaining, a per-fund breakdown, a per-category breakdown, and the
// expense ledger.
router.get('/', async (_req, res, next) => {
  try {
    const [collectedByMethod, buckets, financePublic, expenses] = await Promise.all([
      getCollectedByMethod(),
      getBuckets(),
      Setting.get('financePublic', false),
      // Aggregation converts the heavy proof blobs into booleans (per-payment
      // and for the quotation) and drops them, so the list stays small while
      // still reporting which receipts exist.
      Expense.aggregate([
        { $sort: { spentAt: -1, createdAt: -1 } },
        {
          $addFields: {
            hasQuotationProof: { $gt: [{ $strLenCP: { $ifNull: ['$quotationProof', ''] } }, 0] },
            payments: {
              $map: {
                input: { $ifNull: ['$payments', []] },
                as: 'p',
                in: {
                  _id: '$$p._id',
                  amount: '$$p.amount',
                  method: '$$p.method',
                  bucket: '$$p.bucket',
                  paidAt: '$$p.paidAt',
                  note: '$$p.note',
                  recordedBy: '$$p.recordedBy',
                  createdAt: '$$p.createdAt',
                  hasProof: { $gt: [{ $strLenCP: { $ifNull: ['$$p.proof', ''] } }, 0] },
                },
              },
            },
          },
        },
        { $project: { proof: 0, quotationProof: 0 } },
      ]),
    ]);

    const spent = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    // Total still owed to vendors across all expenses (quotation − paid, ≥0).
    const outstanding = expenses.reduce((sum, e) => {
      const q = Number(e.quotationAmount) || 0;
      const paid = Number(e.amount) || 0;
      return sum + (q > 0 ? Math.max(0, q - paid) : 0);
    }, 0);
    let collected = 0;
    let collectedCount = 0;
    for (const v of collectedByMethod.values()) {
      collected += v.amount;
      collectedCount += v.count;
    }

    // Spend grouped by fund (money drawn out of each holder's pot). Each
    // installment can be drawn from a different fund, so we group by the
    // payment's own bucket (falling back to the expense's bucket). Expenses
    // with no payments contribute nothing.
    const spentByBucket = new Map();
    for (const e of expenses) {
      const list = Array.isArray(e.payments) ? e.payments : [];
      if (list.length > 0) {
        for (const p of list) {
          const key = (p.bucket || e.bucket || '').trim();
          if (!key) continue;
          spentByBucket.set(key, (spentByBucket.get(key) || 0) + (Number(p.amount) || 0));
        }
      } else {
        // Legacy/no-payments fallback: attribute the stored amount to the
        // expense bucket (keeps old records correct until they get payments).
        const key = (e.bucket || '').trim();
        if (key) spentByBucket.set(key, (spentByBucket.get(key) || 0) + (Number(e.amount) || 0));
      }
    }

    // Build the per-fund view: collected into it (from its mapped methods),
    // spent from it, and the remaining balance.
    const assignedMethods = new Set();
    const fundRows = buckets.map((b) => {
      let inAmount = 0;
      let inCount = 0;
      const methods = b.methods.map((label) => {
        assignedMethods.add(label);
        const m = collectedByMethod.get(label) || { amount: 0, count: 0 };
        inAmount += m.amount;
        inCount += m.count;
        return { label, amount: m.amount, count: m.count };
      });
      const out = spentByBucket.get(b.name) || 0;
      return {
        name: b.name,
        methods,
        collected: inAmount,
        collectedCount: inCount,
        spent: out,
        balance: inAmount - out,
      };
    });

    // Any collection method not mapped to a fund — surfaced so nothing is
    // silently dropped from the totals. Admin can assign it via Manage funds.
    const unassigned = [...collectedByMethod.entries()]
      .filter(([label]) => !assignedMethods.has(label))
      .map(([label, v]) => ({ label, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount);

    // Spend logged against a fund name that no longer exists in the config.
    const knownBucketNames = new Set(buckets.map((b) => b.name));
    const orphanSpend = [...spentByBucket.entries()]
      .filter(([name]) => !knownBucketNames.has(name))
      .map(([name, amount]) => ({ name, amount }));

    // Group spend by category for the breakdown cards.
    const byCategoryMap = new Map();
    for (const e of expenses) {
      const key = e.category || 'Other';
      const cur = byCategoryMap.get(key) || { amount: 0, count: 0 };
      cur.amount += Number(e.amount) || 0;
      cur.count += 1;
      byCategoryMap.set(key, cur);
    }
    const byCategory = [...byCategoryMap.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.amount - a.amount);

    return res.json({
      summary: {
        collected,
        collectedCount,
        spent,
        balance: collected - spent,
        // Unpaid vendor dues, and the balance that would remain after clearing
        // them (collected − paid − still-owed).
        outstanding,
        balanceAfterDues: collected - spent - outstanding,
        expenseCount: expenses.length,
      },
      funds: fundRows,
      unassigned,
      orphanSpend,
      financePublic: Boolean(financePublic),
      bucketNames: buckets.map((b) => b.name),
      byCategory,
      expenses: expenses.map((e) => shapeExpense(e)),
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/admin/finance/buckets — the fund config plus every collection-method
// label currently seen in the data (so the editor can offer them as options).
router.get('/buckets', async (_req, res, next) => {
  try {
    const [buckets, collectedByMethod] = await Promise.all([
      getBuckets(),
      getCollectedByMethod(),
    ]);
    return res.json({
      buckets,
      methodLabels: [...collectedByMethod.keys()].sort(),
    });
  } catch (err) {
    return next(err);
  }
});

// PUT /api/admin/finance/buckets — replace the fund config.
// Body: { buckets: [{ name, methods: [label, ...] }, ...] }
router.put('/buckets', async (req, res, next) => {
  try {
    const incoming = req.body?.buckets;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ error: 'buckets must be an array' });
    }
    const cleaned = incoming
      .map((b) => ({
        name: String(b?.name || '').trim().slice(0, 120),
        methods: Array.isArray(b?.methods)
          ? [...new Set(b.methods.map((m) => String(m || '').trim()).filter(Boolean))]
          : [],
      }))
      .filter((b) => b.name);

    const names = cleaned.map((b) => b.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      return res.status(400).json({ error: 'Fund names must be unique' });
    }

    await Setting.set('fundBuckets', cleaned);
    return res.json({ ok: true, buckets: cleaned });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/admin/finance/publish — show/hide the public accounts panel on the
// landing page. Body: { published: true|false }.
router.patch('/publish', async (req, res, next) => {
  try {
    const { published } = req.body || {};
    if (typeof published !== 'boolean') {
      return res.status(400).json({ error: 'published (boolean) is required' });
    }
    await Setting.set('financePublic', published);
    return res.json({ ok: true, financePublic: published });
  } catch (err) {
    return next(err);
  }
});

// Validate + normalize the expense METADATA (everything except the money paid,
// which lives in payments). Returns { data } or { error }.
function parseExpenseMeta(body, { partial = false } = {}) {
  const b = body || {};
  const data = {};

  if (b.description !== undefined || !partial) {
    const description = String(b.description || '').trim();
    if (!description) return { error: 'Description is required' };
    data.description = description.slice(0, 300);
  }

  if (b.quotationAmount !== undefined) {
    const q = Number(b.quotationAmount);
    if (Number.isNaN(q) || q < 0) {
      return { error: 'Quotation amount must be a non-negative number' };
    }
    data.quotationAmount = Math.round(q);
  }
  if (b.advancePaid !== undefined) {
    const a = Number(b.advancePaid);
    if (Number.isNaN(a) || a < 0) {
      return { error: 'Advance paid must be a non-negative number' };
    }
    data.advancePaid = Math.round(a);
  }

  if (b.paidBy !== undefined || !partial) {
    const paidBy = String(b.paidBy || '').trim();
    if (!paidBy) return { error: 'paidBy (who paid) is required' };
    data.paidBy = paidBy.slice(0, 120);
  }

  if (b.category !== undefined) {
    data.category = b.category ? String(b.category).trim().slice(0, 60) : 'Other';
  }
  if (b.bucket !== undefined) {
    data.bucket = b.bucket ? String(b.bucket).trim().slice(0, 120) : null;
  }
  if (b.paidTo !== undefined) {
    data.paidTo = b.paidTo ? String(b.paidTo).trim().slice(0, 120) : null;
  }
  if (b.spentAt !== undefined && b.spentAt) {
    const d = new Date(b.spentAt);
    if (Number.isNaN(d.getTime())) return { error: 'spentAt is not a valid date' };
    data.spentAt = d;
  }
  if (b.note !== undefined) {
    data.note = b.note ? String(b.note).trim().slice(0, 500) : null;
  }
  // Quotation document: a compressed image data URL, or null/'' to clear it.
  if (b.quotationProof !== undefined) {
    if (b.quotationProof && !String(b.quotationProof).startsWith('data:image/')) {
      return { error: 'quotationProof must be an image data URL' };
    }
    data.quotationProof = b.quotationProof || null;
    data.quotationProofUploadedAt = b.quotationProof ? new Date() : null;
  }

  return { data };
}

// Validate + normalize a single installment. Returns { payment } or { error }.
function parsePayment(body, recordedBy) {
  const b = body || {};
  const amount = Number(b.amount);
  if (Number.isNaN(amount) || amount < 0) {
    return { error: 'Payment amount must be a non-negative number' };
  }
  const method = String(b.method || b.paymentMethod || 'cash').trim().toLowerCase();
  if (method && !PAYMENT_METHODS.includes(method)) {
    return { error: `method must be one of ${PAYMENT_METHODS.join(', ')}` };
  }
  const proof = b.proof || null;
  if (proof && !String(proof).startsWith('data:image/')) {
    return { error: 'proof must be an image data URL' };
  }
  // UPI installments must come with a receipt.
  if (method === 'upi' && !proof) {
    return { error: 'A payment proof is required for UPI payments' };
  }
  let paidAt;
  if (b.paidAt || b.spentAt) {
    const d = new Date(b.paidAt || b.spentAt);
    if (Number.isNaN(d.getTime())) return { error: 'paidAt is not a valid date' };
    paidAt = d;
  }
  return {
    payment: {
      amount: Math.round(amount),
      method: method || 'cash',
      bucket: b.bucket ? String(b.bucket).trim().slice(0, 120) : null,
      paidAt: paidAt || new Date(),
      proof,
      note: b.note ? String(b.note).trim().slice(0, 300) : null,
      recordedBy: recordedBy || 'Admin',
    },
  };
}

// POST /api/admin/finance/expenses — log a new expenditure. Optionally records
// an initial payment when `amount` > 0 (its method/proof/date come from the
// same body); otherwise the expense starts quotation-only (nothing paid yet).
router.post('/expenses', async (req, res, next) => {
  try {
    const { data, error } = parseExpenseMeta(req.body, { partial: false });
    if (error) return res.status(400).json({ error });

    const recordedBy = req.user?.name || 'Admin';
    data.recordedBy = recordedBy;
    data.payments = [];

    // Optional initial installment. Its fund defaults to the expense's fund.
    if (req.body?.amount !== undefined && Number(req.body.amount) > 0) {
      const { payment, error: payErr } = parsePayment(
        {
          amount: req.body.amount,
          method: req.body.paymentMethod || req.body.method,
          bucket: req.body.paymentBucket || data.bucket || null,
          proof: req.body.proof,
          paidAt: req.body.paidAt || req.body.spentAt,
          note: req.body.paymentNote,
        },
        recordedBy,
      );
      if (payErr) return res.status(400).json({ error: payErr });
      data.payments.push(payment);
    }

    data.amount = data.payments.reduce((s, p) => s + p.amount, 0);
    const created = await Expense.create(data);
    return res.status(201).json({ ok: true, expense: shapeExpense(created) });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/admin/finance/expenses/:id — edit metadata only. Payments are
// managed through the dedicated payment endpoints below.
router.patch('/expenses/:id', async (req, res, next) => {
  try {
    const { data, error } = parseExpenseMeta(req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    Object.assign(expense, data);
    expense.recordedBy = req.user?.name || expense.recordedBy || 'Admin';
    await expense.save();
    return res.json({ ok: true, expense: shapeExpense(expense) });
  } catch (err) {
    return next(err);
  }
});

// POST /api/admin/finance/expenses/:id/payments — add an installment.
// Body: { amount, method?, paidAt?, proof?, note? }
router.post('/expenses/:id/payments', async (req, res, next) => {
  try {
    const { payment, error } = parsePayment(req.body, req.user?.name || 'Admin');
    if (error) return res.status(400).json({ error });
    if (!(payment.amount > 0)) {
      return res.status(400).json({ error: 'Payment amount must be greater than 0' });
    }

    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    // Default this installment's fund to the expense's fund when unspecified.
    if (!payment.bucket) payment.bucket = expense.bucket || null;
    expense.payments.push(payment);
    recalcAmount(expense);
    await expense.save();
    return res.status(201).json({ ok: true, expense: shapeExpense(expense) });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/admin/finance/expenses/:id/payments/:paymentId — edit one
// installment in place. Body may include any of: amount, method, bucket,
// paidAt, note, proof (image data URL to replace, or '' / null to clear).
router.patch('/expenses/:id/payments/:paymentId', async (req, res, next) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    const payment = expense.payments.id(req.params.paymentId);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const b = req.body || {};

    if (b.amount !== undefined) {
      const amount = Number(b.amount);
      if (Number.isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Payment amount must be greater than 0' });
      }
      payment.amount = Math.round(amount);
    }
    if (b.method !== undefined) {
      const m = String(b.method || '').trim().toLowerCase();
      if (m && !PAYMENT_METHODS.includes(m)) {
        return res.status(400).json({ error: `method must be one of ${PAYMENT_METHODS.join(', ')}` });
      }
      payment.method = m || 'cash';
    }
    if (b.bucket !== undefined) {
      payment.bucket = b.bucket ? String(b.bucket).trim().slice(0, 120) : null;
    }
    if (b.paidAt !== undefined && b.paidAt) {
      const d = new Date(b.paidAt);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'paidAt is not a valid date' });
      payment.paidAt = d;
    }
    if (b.note !== undefined) {
      payment.note = b.note ? String(b.note).trim().slice(0, 300) : null;
    }
    // Replace the receipt when a new image is supplied; clear it on '' or null.
    if (b.proof !== undefined) {
      if (b.proof && !String(b.proof).startsWith('data:image/')) {
        return res.status(400).json({ error: 'proof must be an image data URL' });
      }
      payment.proof = b.proof || null;
    }

    // UPI installments must keep a receipt.
    if ((payment.method || 'cash') === 'upi' && !payment.proof) {
      return res.status(400).json({ error: 'A payment proof is required for UPI payments' });
    }

    payment.recordedBy = req.user?.name || payment.recordedBy || 'Admin';
    recalcAmount(expense);
    await expense.save();
    return res.json({ ok: true, expense: shapeExpense(expense) });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/admin/finance/expenses/:id/payments/:paymentId — remove one
// installment and recompute the total paid.
router.delete('/expenses/:id/payments/:paymentId', async (req, res, next) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    const payment = expense.payments.id(req.params.paymentId);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    payment.deleteOne();
    recalcAmount(expense);
    await expense.save();
    return res.json({ ok: true, expense: shapeExpense(expense) });
  } catch (err) {
    return next(err);
  }
});

// GET /api/admin/finance/expenses/:id/payments/:paymentId/proof — the receipt
// image for one installment.
router.get('/expenses/:id/payments/:paymentId/proof', async (req, res, next) => {
  try {
    const e = await Expense.findById(req.params.id).select('description paidBy payments').lean();
    if (!e) return res.status(404).json({ error: 'Expense not found' });
    const p = (e.payments || []).find((x) => String(x._id) === req.params.paymentId);
    if (!p) return res.status(404).json({ error: 'Payment not found' });
    if (!p.proof) return res.status(404).json({ error: 'No proof attached' });
    return res.json({
      description: e.description,
      paidBy: e.paidBy,
      image: p.proof,
      uploadedAt: p.paidAt || p.createdAt || null,
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/admin/finance/expenses/:id/proof — lazy-load the payment receipt.
router.get('/expenses/:id/proof', async (req, res, next) => {
  try {
    const e = await Expense.findById(req.params.id)
      .select('description paidBy proof proofUploadedAt')
      .lean();
    if (!e) return res.status(404).json({ error: 'Expense not found' });
    if (!e.proof) return res.status(404).json({ error: 'No proof attached' });
    return res.json({
      description: e.description,
      paidBy: e.paidBy,
      image: e.proof,
      uploadedAt: e.proofUploadedAt || null,
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/admin/finance/expenses/:id/quotation-proof — lazy-load the quote doc.
router.get('/expenses/:id/quotation-proof', async (req, res, next) => {
  try {
    const e = await Expense.findById(req.params.id)
      .select('description paidBy quotationProof quotationProofUploadedAt')
      .lean();
    if (!e) return res.status(404).json({ error: 'Expense not found' });
    if (!e.quotationProof) return res.status(404).json({ error: 'No quotation attached' });
    return res.json({
      description: e.description,
      paidBy: e.paidBy,
      image: e.quotationProof,
      uploadedAt: e.quotationProofUploadedAt || null,
    });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/admin/finance/expenses/:id — remove an expenditure entry.
router.delete('/expenses/:id', async (req, res, next) => {
  try {
    const deleted = await Expense.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Expense not found' });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
