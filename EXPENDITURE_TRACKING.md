# Expenditure Tracking — Checks & Balances

A finance ledger for the reunion so organizers can see, at any time, **how much
was collected, how much was spent (by whom, with proof), and what balance is
left**. It lives in the admin dashboard, under the "Collected by account" card.

## The money model

| Side | Where it comes from |
|------|---------------------|
| **Collected** | Sum of `User.contributionAmount` for members with `paymentStatus = 'paid'` (unchanged — the existing contributions flow). |
| **Spent** | Sum of all `Expense.amount` entries (new). |
| **Balance** | `Collected − Spent`. Turns red and shows an "over budget" warning when negative. |

Collection is computed server-side so the balance can't drift from the member
list the admin sees.

## Data model — `Expense` (`src/models/Expense.js`)

| Field | Notes |
|-------|-------|
| `description` | What the money was spent on (required) |
| `category` | Free text, seeded with common buckets (Venue, Food, Printing…) |
| `amount` | INR, rounded whole number (required) |
| `paidBy` | **Who paid / incurred the expense** (required) |
| `paidTo` | Vendor / payee (optional) |
| `paymentMethod` | `cash` \| `upi` \| `bank` \| `card` \| `other` |
| `spentAt` | When the money was spent |
| `proof` | Receipt/bill as a compressed base64 image data URL (same approach as member payment proofs — no extra storage needed) |
| `note` | Reference number / context |
| `recordedBy` | Admin who logged / last edited the entry (audit trail) |

## API (admin-only) — mounted at `/api/admin/finance`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/finance` | Summary (collected, spent, balance, counts) + per-category breakdown + expense ledger (proof blob excluded) |
| POST | `/api/admin/finance/expenses` | Log a new expense |
| PATCH | `/api/admin/finance/expenses/:id` | Edit an expense (send `proof` only to replace it) |
| GET | `/api/admin/finance/expenses/:id/proof` | Lazy-load the receipt image |
| DELETE | `/api/admin/finance/expenses/:id` | Remove an expense |

All routes require an authenticated admin (`requireAuth` + `requireAdmin`).

## Frontend

- `src/components/FinancePanel.jsx` — Collected / Spent / Balance cards, a
  spend-by-category breakdown, an add/edit form with receipt upload, and the
  expense ledger with per-row proof view / edit / delete.
- Wired into `src/pages/AdminPage.jsx` right after the "Collected by account"
  card.

Receipts are compressed client-side (`src/lib/image.js`, longest edge ≤ 1200px)
before upload, keeping payloads under the backend's 2 MB JSON limit.

## Files

- Backend: `src/models/Expense.js`, `src/routes/finance.js`, `src/app.js`
- Frontend: `src/components/FinancePanel.jsx`, `src/pages/AdminPage.jsx`

## Funds (money-holders) — per-holder balances

Collected money physically sits with a few people. Each **fund** is a holder
that owns one or more collection-method labels; the money collected via those
methods belongs to that fund, and expenses are logged **against** a fund, so:

```
fund balance = money collected into the fund − money spent from the fund
```

When adding an expense you pick **"Paid from (fund)"**, and the form shows that
fund's currently available balance.

### Default mapping (editable in the UI)

| Fund | Collection methods |
|------|--------------------|
| **Saumendra** | GooglePay - Saumendra Pattnaik |
| **Shibasis** | Unspecified, Bank transfer (NRI) *(bank account holder is Shibasis Hota)* |
| **Jami** | PhonePe - J Srikanta Patro |

The mapping is stored in the `fundBuckets` Setting (not hardcoded). Admins edit
it via **⚙ Manage funds** in the dashboard, ticking which methods belong to each
fund. `Expense.bucket` records the fund an expense was drawn from.

- A collection method not assigned to any fund shows as an **"Unassigned
  collections"** banner (nothing is dropped from the grand total).
- Spend logged against a fund that was later removed shows as an **orphan
  spend** warning.

### Fund API (admin-only)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/finance/buckets` | Current fund config + all seen method labels |
| PUT | `/api/admin/finance/buckets` | Replace the fund config (`{ buckets: [{ name, methods }] }`) |

`GET /api/admin/finance` now also returns `funds` (each with `collected`,
`spent`, `balance`, and its methods), `unassigned`, `orphanSpend`, and
`bucketNames`.
