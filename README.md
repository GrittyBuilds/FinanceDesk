# FinTrack — Personal Finance Tracker

A lightweight, dependency-free web app for tracking personal income and expenses.
Everything runs in the browser and your data stays on your device (saved to
`localStorage`).

## Features

- **Add income & expenses** with description, amount, category, and date
- **Edit & delete** any transaction
- **Live summary** — running balance, total income, total expenses
- **Category breakdown** — donut chart of spending by category
- **Monthly budgets** — set a per-category limit and track this month's progress
- **CSV export / import** — back up your data or bring in existing records
- **Filter** transactions by type and category
- **Persistent** — data is saved to your browser's `localStorage`
- **Light / dark theme** — remembers your choice, follows your system by default
- **Responsive** — works on desktop and mobile
- **Zero dependencies** — plain HTML, CSS, and JavaScript

## CSV format

Export produces a file with the header:

```
type,description,amount,category,date
```

Import accepts the same shape. `type` is `income` or `expense`, `amount` is a
positive number, and `date` is `YYYY-MM-DD`. A header row is auto-detected;
unknown categories fall back to **Other**, and invalid rows are skipped and
reported. Imported rows are added to your existing data (not replaced).

## Getting started

Just open `index.html` in a browser. No build step, no server required.

To serve it locally (optional):

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Project structure

```
index.html   Markup and layout
styles.css   Styling and theming (CSS custom properties)
app.js       App logic: state, persistence, rendering, chart
```

## Data & privacy

All transactions are stored locally in your browser via `localStorage` under the
key `fintrack.transactions`. Nothing is sent anywhere. Clearing your browser data
will remove your transactions.

## Data & privacy — what's stored

All data lives in your browser's `localStorage`:

- `fintrack.transactions` — your transactions
- `fintrack.budgets` — per-category monthly limits
- `fintrack.theme` — light/dark preference

## Roadmap ideas

- Monthly / date-range views for the summary and chart
- Budget alerts / notifications
- Recurring transactions
- JSON export/import (full backup incl. budgets)
