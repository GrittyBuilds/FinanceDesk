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
  Liabilities, Equity, Income, and Expenses, each with a live balance. Comes with
  sample **subcategories** (e.g. Groceries → Food/Household, Dining → Restaurants/
  Coffee/Takeout) that you can freely add to (an **"+ Subcategory"** button on any
  category) or delete; parents roll up their children in balances and reports.
  Pick any account's **icon from an emoji picker** (or type your own).
- **Friendly entry** — add an **Expense**, **Income**, or **Transfer** through a
  simple form; the app builds the underlying journal entry for you.
- **Split transactions** — divide one transaction across several
  categories/subcategories (e.g. a store run that's part Food, part Household).
- **Vendor & tags** — record a **vendor/payee** (with autocomplete from vendors
  you've used) and attach any number of **tags** to a transaction (type them
  comma-separated, or click an existing tag to add it). Both show as chips in the
  ledger, are carried by recurring transactions, and travel in CSV export/import.
- **Account registers** — drill into any account to see its transactions with a
  running balance.
- **Reconciliation** — in a register, mark entries **cleared** and enter your
  statement's ending balance; the app shows the cleared balance and the
  difference, and flags when the account is reconciled.
- **Recurring transactions** — set an expense, income, or transfer to repeat
  weekly, biweekly, monthly, or yearly; occurrences post automatically (with
  backfill), and dedupe safely across synced devices.
- **Receipt attachments** — attach a photo to any transaction; it's downscaled,
  shown as a thumbnail (tap to view full size), flagged with a 📎 in the ledger,
  and synced with your data.
- **Reports**
  - **Profit & Loss** for this month, last month, this/last year, all time, or a
    custom date range — grouped by category with subcategory breakdowns, with an
    optional **Compare to prior** column (prior month/year, or the same-length
    window before a custom range) showing the change.
  - **Cash Flow** — change in cash & bank over a period (operating, financing,
    equity), reconciled to your account balances; compares to the prior period.
  - **Balance Sheet** as of any date, with a live "in balance" check
    (Assets = Liabilities + Equity); compares to any prior date.
  - **By Tag** — income and expenses grouped by tag over the selected period
    (with an untagged bucket). A multi-tag transaction counts in full under each
    of its tags, while the "tagged total" counts each transaction once.
- **Dashboard** — net worth, income/expense/net for the month, a **net-worth
  trend** line and **12-month income-vs-expense** bars, a spending donut, and
  recent activity.
- **Monthly budgets** — per-category and per-subcategory limits with progress
  bars and over-limit warnings.
- **Backup & restore** — **CSV** export/import for transactions, and full **JSON**
  backup/restore (accounts + transactions + budgets) in **Settings**.
- **PIN lock & encryption** — optionally lock the app behind a PIN and encrypt
  your data **at rest** on the device with AES-GCM (key derived from your PIN via
  PBKDF2). See "Security" below.
- **Sync across devices & shared family books** — optional cloud sync backed by
  either a **self-hosted** Node server or your own **Supabase** project. Sync your
  Personal books between devices and share a **Household** ledger with family,
  with end-to-end encryption available on both.
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

**Shared-workspace safety:** text and icons that arrive from other family members
via sync (or from an imported backup) are HTML-escaped when rendered, so a
malicious account name or category icon can't run scripts on your device.
Receipt images are stored in the browser (and synced), so a large collection can
approach the browser's storage limit; export a JSON backup periodically.

## Sync (personal + shared)

Sync is optional, and you choose where your data lives in **Settings → Sync →
Cloud backend**:

- **Self-hosted server** — a small Node server you run yourself (below).
- **Supabase** — your own free/managed Supabase project (below).

Both backends expose the same accounts, workspaces, invites, versioned
push/pull, merge, and end-to-end encryption; only the plumbing differs. Whichever
you pick:

1. **Register** once, then **Log in** on each device.
2. Each account gets a **Personal** workspace. Create a **Shared** workspace for
   the family and **Invite** others with a code.
3. Turn on **Auto-sync** for two-way sync that runs after each change and every
   45 seconds. It **merges** rather than overwrites, so two people editing the
   same workspace both keep their changes. (**Push** and **Pull** remain as manual
   one-way overrides.)

### Option A — self-hosted server

See [`server/README.md`](server/README.md). In short:

1. Run `node server/server.js` (zero dependencies). It serves the app **and** the
   sync API on one origin.
2. In **Settings → Sync**, leave the backend on **Self-hosted server**, enter the
   server URL, then **Register** / **Log in**.

### Option B — Supabase

Use a [Supabase](https://supabase.com) project as the cloud store — no server to
run, and the same end-to-end encryption applies.

1. Create a project at supabase.com (the free tier is plenty).
2. In the dashboard, open **SQL Editor → New query**, paste the contents of
   [`supabase/setup.sql`](supabase/setup.sql), and **Run**. This creates the
   tables, locks them with Row-Level Security, and installs the small set of
   `SECURITY DEFINER` functions the app calls — so every user only ever touches
   workspaces they belong to.
3. Decide how sign-up should work under **Authentication → Providers → Email**:
   - Turn **Confirm email** *off* for the simplest flow (Register logs you
     straight in), or
   - Leave it on — after **Register** you'll get an email to confirm, then
     **Log in**.
4. Grab your project's **URL** and **anon public** key from **Project Settings →
   API**.
5. In **Settings → Sync**, set **Cloud backend** to **Supabase**, paste the URL
   and anon key, **Connect**, then **Register** / **Log in**.

The anon key is safe to ship in the client: Row-Level Security means it grants no
direct table access — all reads and writes go through the vetted functions, gated
on your authenticated user id. With **end-to-end encryption** on, Supabase only
ever stores ciphertext.

### How merge works

Auto-sync pulls the server copy, merges it with your local data, and pushes the
result. Merge is per-record: accounts and transactions are keyed by id and the
most recently edited version wins; **deletions are tracked with tombstones** so a
record you delete on one device isn't resurrected by another device's older copy.
**Accounts and transactions merge field-by-field** (per-field timestamps), so
editing a transaction's note on one device and its amount on another — or
renaming an account on one device and archiving it on another — keeps *both*
changes (a transaction's balanced lines are still treated atomically). Budgets
and cleared flags are last-write-wins per key. A version check still guards each
push (the client retries the merge if the server moved underneath it).

### End-to-end encryption (optional, recommended)

In **Settings → Sync → End-to-end encryption**, set a **sync passphrase**. When
on, your data is encrypted (AES-GCM, key derived from the passphrase via PBKDF2)
**before it leaves the device**, and the backend (self-hosted server or Supabase)
only ever stores ciphertext — it can't read your books. Every device and family
member sharing a workspace must
enter the **same passphrase**; a device without it is told the data is encrypted
and can't pull. If the passphrase is lost, encrypted sync data can't be
recovered, so keep a JSON backup.

Without E2E on, synced data is stored **unencrypted** on whichever backend you
chose (your own server, or your own Supabase project). Either way, the PIN feature
separately protects the local device copy.

## Project structure

```
index.html   App shell (sidebar + mobile bottom-nav), views, and modals
styles.css   Responsive styling and theming (CSS custom properties)
store.js     Data model + double-entry engine + reports + persistence
crypto.js    PIN vault — AES-GCM encryption of data at rest (Web Crypto)
sync.js      Client sync layer (pluggable backends: self-hosted server / Supabase)
app.js       UI layer: router, views, forms, charts, CSV
server/      Self-hosted sync server (Node, zero dependencies)
supabase/    setup.sql — tables, RLS, and functions for the Supabase backend
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

