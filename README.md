# Finance Desk

A personal & family bookkeeping web app with a QuickBooks-style backbone. It
runs entirely in the browser, stores your data locally, and produces real
financial statements — a **Profit & Loss** and a **Balance Sheet** that actually
balances — on top of a proper **double-entry** accounting engine.

One responsive codebase serves both **desktop** (sidebar navigation, multi-column
views) and **mobile** (bottom tab bar with a quick-add button, stacked layouts).

## Features

- **Double-entry engine** — every transaction posts balanced debits and credits,
  so reports tie out the way real bookkeeping does.
- **Chart of Accounts with subcategories** — accounts grouped into Assets,
  Liabilities, Equity, Income, and Expenses, each with a live balance. Nest
  **subcategories** under a parent (e.g. Groceries → Food, Household); parents
  roll up their children in balances and reports.
- **Friendly entry** — add an **Expense**, **Income**, or **Transfer** through a
  simple form; the app builds the underlying journal entry for you.
- **Split transactions** — divide one transaction across several
  categories/subcategories (e.g. a store run that's part Food, part Household).
- **Account registers** — drill into any account to see its transactions with a
  running balance.
- **Reconciliation** — in a register, mark entries **cleared** and enter your
  statement's ending balance; the app shows the cleared balance and the
  difference, and flags when the account is reconciled.
- **Recurring transactions** — set an expense, income, or transfer to repeat
  weekly, biweekly, monthly, or yearly; occurrences post automatically (with
  backfill), and dedupe safely across synced devices.
- **Reports**
  - **Profit & Loss** for this month, last month, this/last year, all time, or a
    custom date range — grouped by category with subcategory breakdowns, with an
    optional **Compare to prior** column (prior month/year, or the same-length
    window before a custom range) showing the change.
  - **Cash Flow** — change in cash & bank over a period (operating, financing,
    equity), reconciled to your account balances.
  - **Balance Sheet** as of any date, with a live "in balance" check
    (Assets = Liabilities + Equity).
- **Dashboard** — net worth, income/expense/net for the month, a spending donut,
  and recent activity.
- **Monthly budgets** — per-category and per-subcategory limits with progress
  bars and over-limit warnings.
- **Backup & restore** — **CSV** export/import for transactions, and full **JSON**
  backup/restore (accounts + transactions + budgets) in **Settings**.
- **PIN lock & encryption** — optionally lock the app behind a PIN and encrypt
  your data **at rest** on the device with AES-GCM (key derived from your PIN via
  PBKDF2). See "Security" below.
- **Sync across devices & shared family books** — an optional, **self-hosted**
  Node server lets you sync your Personal books between devices and share a
  **Household** ledger with family. See [`server/README.md`](server/README.md).
- **Light / dark theme**, responsive, and **zero dependencies** on the client —
  plain HTML, CSS, and JavaScript.

## Getting started

Open `index.html` in a browser — no build step or server required.

To serve it locally (optional):

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## How the accounting works

Finance Desk keeps a single **journal** of balanced entries. Each account has a
"normal" side:

| Type       | Normal balance | Increases with |
|------------|----------------|----------------|
| Asset      | Debit          | Debit          |
| Liability  | Credit         | Credit         |
| Equity     | Credit         | Credit         |
| Income     | Credit         | Credit         |
| Expense    | Debit          | Debit          |

The friendly forms map to journal entries like this:

- **Expense** — debit an expense category, credit the account you paid from
  (an asset like Checking, or a liability like a Credit Card).
- **Split expense** — debit several expense categories, credit one payment
  account for the total.
- **Income** — debit the account you deposited into, credit an income category.
- **Transfer** — debit the destination account, credit the source account.
- **Opening balances** — when you create an asset/liability account with a
  starting balance, the offset posts to **Opening Balance Equity**.

**Subcategories** are accounts with a `parentId` pointing at a same-type parent
(one level deep). You post to whichever level you like; parents roll up their
children in the Accounts view, budgets, and reports.

Because every entry balances, the Balance Sheet identity always holds:

```
Assets = Liabilities + Equity + Net Income
```

## Security (PIN & encryption)

In **Settings → Security** you can set a PIN. When enabled:

- Your data is encrypted in the browser with **AES-GCM**; the key is derived from
  your PIN with **PBKDF2** (SHA-256, 210k iterations) and a random salt. Only the
  salt, IV, and ciphertext are stored — never the PIN or the key.
- On launch, the app shows a **lock screen** and only decrypts after the correct
  PIN is entered. The plaintext copies are removed from storage.

Honest scope: this protects data **at rest on the device**. It is not a
server-enforced login and can't defend against malware in your browser. **If you
forget the PIN, only a JSON backup can recover your data** — so keep one.

## Sync (self-hosted, personal + shared)

Sync is optional and runs on a small server you host yourself — see
[`server/README.md`](server/README.md). In short:

1. Run `node server/server.js` (zero dependencies). It serves the app **and** the
   sync API on one origin.
2. In **Settings → Sync**, enter the server URL, **Register**, then **Log in** on
   each device.
3. Each account gets a **Personal** workspace. Create a **Shared** workspace for
   the family and **Invite** others with a code.
4. Turn on **Auto-sync** for two-way sync that runs after each change and every
   45 seconds. It **merges** rather than overwrites, so two people editing the
   same workspace both keep their changes. (**Push** and **Pull** remain as manual
   one-way overrides.)

### How merge works

Auto-sync pulls the server copy, merges it with your local data, and pushes the
result. Merge is per-record: accounts and transactions are keyed by id and the
most recently edited version wins; **deletions are tracked with tombstones** so a
record you delete on one device isn't resurrected by another device's older copy.
**Accounts merge field-by-field** (per-field timestamps), so renaming an account
on one device and archiving it on another keeps *both* changes. Budgets and
cleared flags are last-write-wins per key. A version check still guards each push
(the client retries the merge if the server moved underneath it).

### End-to-end encryption (optional, recommended)

In **Settings → Sync → End-to-end encryption**, set a **sync passphrase**. When
on, your data is encrypted (AES-GCM, key derived from the passphrase via PBKDF2)
**before it leaves the device**, and the server only ever stores ciphertext — it
can't read your books. Every device and family member sharing a workspace must
enter the **same passphrase**; a device without it is told the data is encrypted
and can't pull. If the passphrase is lost, encrypted sync data can't be
recovered, so keep a JSON backup.

Without E2E on, synced data is stored **unencrypted on your server** (which you
control). Either way, the PIN feature separately protects the local device copy.

## Project structure

```
index.html   App shell (sidebar + mobile bottom-nav), views, and modals
styles.css   Responsive styling and theming (CSS custom properties)
store.js     Data model + double-entry engine + reports + persistence
crypto.js    PIN vault — AES-GCM encryption of data at rest (Web Crypto)
sync.js      Client sync layer (talks to the self-hosted server)
app.js       UI layer: router, views, forms, charts, CSV
server/      Self-hosted sync server (Node, zero dependencies)
```

`store.js` is DOM-free and can be loaded in Node for testing the engine.

## Data & privacy

Everything is stored locally in your browser via `localStorage`:

- `financedesk.accounts` — your chart of accounts
- `financedesk.journal` — all journal entries
- `financedesk.budgets` — per-category monthly limits
- `financedesk.theme` — light/dark preference

Nothing is sent anywhere. Clearing your browser data removes it, so use
**Export CSV** to keep a backup. Data from the earlier single-entry prototype
(`fintrack.*`) is migrated automatically on first load.

## Roadmap ideas

- Comparison columns for Cash Flow and Balance Sheet (P&L already compares)
- Field-level merge for transactions (accounts already merge per-field)
