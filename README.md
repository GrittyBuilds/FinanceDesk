# FinTrack — Personal Finance Tracker

A lightweight, dependency-free web app for tracking personal income and expenses.
Everything runs in the browser and your data stays on your device (saved to
`localStorage`).

## Features

- **Add income & expenses** with description, amount, category, and date
- **Live summary** — running balance, total income, total expenses
- **Category breakdown** — donut chart of spending by category
- **Filter** transactions by type and category
- **Persistent** — data is saved to your browser's `localStorage`
- **Light / dark theme** — remembers your choice, follows your system by default
- **Responsive** — works on desktop and mobile
- **Zero dependencies** — plain HTML, CSS, and JavaScript

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

## Roadmap ideas

- Edit existing transactions
- Monthly / date-range views
- Budgets per category with alerts
- Export / import (CSV, JSON)
- Recurring transactions
