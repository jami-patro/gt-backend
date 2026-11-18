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

// Shape an expense doc for the API. The `proof` blob is intentionally omitted
// (lazy-loaded via the /:id/proof route) to keep responses small. Because list
// queries exclude the `proof` field for payload size, `hasProof` can't be
// derived from `e.proof` there — pass it explicitly in that case.
function shapeExpense(e, hasProof) {
  return {
    id: e._id,
    description: e.description,
    category: e.category || 'Other',
    amount: e.amount ?? 0,
    bucket: e.bucket || null,
    paidBy: e.paidBy,
    paidTo: e.paidTo || null,
    paymentMethod: e.paymentMethod || 'cash',
    spentAt: e.spentAt || e.createdAt || null,
    note: e.note || null,
    recordedBy: e.recordedBy || null,
    hasProof: hasProof !== undefined ? Boolean(hasProof) : Boolean(e.proof),
    proofUploadedAt: e.proofUploadedAt || null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

// GET /api/admin/finance — the full checks-&-balances view: collected, spent,
// balance remaining, a per-fund breakdown, a per-category breakdown, and the
// expense ledger.
router.get('/', async (_req, res, next) => {
  try {
    const [collectedByMethod, buckets, expenses, withProof] = await Promise.all([
      getCollectedByMethod(),
      getBuckets(),
      // Exclude the heavy proof blob from the list; fetch which ids have one
      // separately so we can still report `hasProof` without the payload cost.
      Expense.find({}).select('-proof').sort({ spentAt: -1, createdAt: -1 }).lean(),
      Expense.find({ proof: { $ne: null } }).select('_id').lean(),
    ]);
    const proofIds = new Set(withProof.map((e) => String(e._id)));

    const spent = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    let collected = 0;
    let collectedCount = 0;
    for (const v of collectedByMethod.values()) {
      collected += v.amount;
      collectedCount += v.count;
    }

    // Spend grouped by fund (money drawn out of each holder's pot).
    const spentByBucket = new Map();
    for (const e of expenses) {
      const key = (e.bucket || '').trim();
      if (!key) continue;
      spentByBucket.set(key, (spentByBucket.get(key) || 0) + (Number(e.amount) || 0));
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
        expenseCount: expenses.length,
      },
      funds: fundRows,
      unassigned,
      orphanSpend,
      bucketNames: buckets.map((b) => b.name),
      byCategory,
      expenses: expenses.map((e) => shapeExpense(e, proofIds.has(String(e._id)))),
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

// Validate + normalize an incoming expense body. Returns { data } or { error }.
function parseExpenseBody(body, { partial = false } = {}) {
  const b = body || {};
  const data = {};

  if (b.description !== undefined || !partial) {
    const description = String(b.description || '').trim();
    if (!description) return { error: 'Description is required' };
    data.description = description.slice(0, 300);
  }

  if (b.amount !== undefined || !partial) {
    const amount = Number(b.amount);
    if (Number.isNaN(amount) || amount < 0) {
      return { error: 'Amount must be a non-negative number' };
    }
    data.amount = Math.round(amount);
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
  if (b.paymentMethod !== undefined) {
    const pm = String(b.paymentMethod || '').trim().toLowerCase();
    if (pm && !PAYMENT_METHODS.includes(pm)) {
      return { error: `paymentMethod must be one of ${PAYMENT_METHODS.join(', ')}` };
    }
    data.paymentMethod = pm || 'cash';
  }
  if (b.spentAt !== undefined) {
    if (b.spentAt) {
      const d = new Date(b.spentAt);
      if (Number.isNaN(d.getTime())) return { error: 'spentAt is not a valid date' };
      data.spentAt = d;
    }
  }
  if (b.note !== undefined) {
    data.note = b.note ? String(b.note).trim().slice(0, 500) : null;
  }
  // Proof: a compressed image data URL, or null/'' to clear it.
  if (b.proof !== undefined) {
    if (b.proof && !String(b.proof).startsWith('data:image/')) {
      return { error: 'proof must be an image data URL' };
    }
    data.proof = b.proof || null;
    data.proofUploadedAt = b.proof ? new Date() : null;
  }

  return { data };
}

// POST /api/admin/finance/expenses — log a new expenditure.
router.post('/expenses', async (req, res, next) => {
  try {
    const { data, error } = parseExpenseBody(req.body, { partial: false });
    if (error) return res.status(400).json({ error });

    // UPI spends must come with a receipt image.
    if ((data.paymentMethod || 'cash') === 'upi' && !data.proof) {
      return res.status(400).json({ error: 'A payment proof is required for UPI payments' });
    }

    data.recordedBy = req.user?.name || 'Admin';
    const created = await Expense.create(data);
    return res.status(201).json({ ok: true, expense: shapeExpense(created) });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/admin/finance/expenses/:id — edit an existing expenditure.
router.patch('/expenses/:id', async (req, res, next) => {
  try {
    const { data, error } = parseExpenseBody(req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    Object.assign(expense, data);
    // UPI spends must have a receipt — either already stored or supplied here.
    if ((expense.paymentMethod || 'cash') === 'upi' && !expense.proof) {
      return res.status(400).json({ error: 'A payment proof is required for UPI payments' });
    }
    expense.recordedBy = req.user?.name || expense.recordedBy || 'Admin';
    await expense.save();
    return res.json({ ok: true, expense: shapeExpense(expense) });
  } catch (err) {
    return next(err);
  }
});

// GET /api/admin/finance/expenses/:id/proof — lazy-load the receipt image.
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
