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
- **Chart of Accounts** — accounts grouped into Assets, Liabilities, Equity,
  Income, and Expenses, each with a live balance. Add your own bank accounts,
  credit cards, loans, income sources, and expense categories.
- **Friendly entry** — add an **Expense**, **Income**, or **Transfer** through a
  simple form; the app builds the underlying journal entry for you.
- **Reports**
  - **Profit & Loss** for this month, last month, this/last year, all time, or a
    custom date range.
  - **Balance Sheet** as of any date, with a live "in balance" check
    (Assets = Liabilities + Equity).
- **Dashboard** — net worth, income/expense/net for the month, a spending donut,
  and recent activity.
- **Monthly budgets** — per-category limits with progress bars and over-limit
  warnings.
- **CSV export / import** — back up or bring in records
  (`date, type, description, amount, category, account`).
- **Light / dark theme**, responsive, and **zero dependencies** — plain HTML,
  CSS, and JavaScript.

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
- **Income** — debit the account you deposited into, credit an income category.
- **Transfer** — debit the destination account, credit the source account.
- **Opening balances** — when you create an asset/liability account with a
  starting balance, the offset posts to **Opening Balance Equity**.

Because every entry balances, the Balance Sheet identity always holds:

```
Assets = Liabilities + Equity + Net Income
```

## Project structure

```
index.html   App shell (sidebar + mobile bottom-nav), views, and modals
styles.css   Responsive styling and theming (CSS custom properties)
store.js     Data model + double-entry engine + reports + persistence
app.js       UI layer: router, views, forms, charts, CSV
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

- Per-account registers with running balances and reconciliation
- Cash-flow statement and month-over-month comparisons
- JSON full backup/restore (accounts + journal + budgets)
- Split transactions (more than two lines) in the entry form
- Recurring transactions
