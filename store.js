/* Finance Desk — data store & double-entry accounting engine.
 *
 * Pure of DOM: safe to load in Node for testing. Attaches to globalThis.FD.
 *
 * Model
 * -----
 * Account { id, name, type, icon, archived }
 *   type ∈ asset | liability | equity | income | expense
 *   Normal balance: asset & expense are debit-normal; liability, equity,
 *   income are credit-normal.
 *
 * Journal entry { id, date:"YYYY-MM-DD", description, kind, lines[], createdAt }
 *   kind ∈ expense | income | transfer | opening | journal
 *   lines: [{ accountId, debit, credit }] — every entry MUST balance
 *          (sum debits === sum credits).
 *
 * The friendly Expense/Income/Transfer forms are just shorthands that build a
 * balanced two-line entry. Because every entry balances, the Balance Sheet
 * identity (Assets = Liabilities + Equity + Net Income) always holds.
 */
(function (root) {
  "use strict";

  var KEYS = {
    accounts: "financedesk.accounts",
    journal: "financedesk.journal",
    budgets: "financedesk.budgets",
    theme: "financedesk.theme",
    meta: "financedesk.meta",
  };

  var TYPES = {
    asset: { label: "Assets", plural: "Assets", normal: "debit", order: 1 },
    liability: { label: "Liabilities", plural: "Liabilities", normal: "credit", order: 2 },
    equity: { label: "Equity", plural: "Equity", normal: "credit", order: 3 },
    income: { label: "Income", plural: "Income", normal: "credit", order: 4 },
    expense: { label: "Expenses", plural: "Expenses", normal: "debit", order: 5 },
  };

  var OPENING_EQUITY_ID = "opening-equity";

  // ---- Seed chart of accounts (fixed ids so migration can map to them) ----
  function seedAccounts() {
    return [
      { id: "checking", name: "Checking", type: "asset", icon: "🏦" },
      { id: "savings", name: "Savings", type: "asset", icon: "💰" },
      { id: "cash", name: "Cash", type: "asset", icon: "💵" },
      { id: "credit-card", name: "Credit Card", type: "liability", icon: "💳" },
      { id: OPENING_EQUITY_ID, name: "Opening Balance Equity", type: "equity", icon: "⚖️" },

      { id: "inc-salary", name: "Salary", type: "income", icon: "💼" },
      { id: "inc-freelance", name: "Freelance", type: "income", icon: "🧑‍💻" },
      { id: "inc-investment", name: "Investment", type: "income", icon: "📈" },
      { id: "inc-interest", name: "Interest", type: "income", icon: "🏛️" },
      { id: "inc-gift", name: "Gifts Received", type: "income", icon: "🎁" },
      { id: "inc-other", name: "Other Income", type: "income", icon: "➕" },

      { id: "exp-groceries", name: "Groceries", type: "expense", icon: "🛒" },
      { id: "exp-housing", name: "Rent / Mortgage", type: "expense", icon: "🏠" },
      { id: "exp-utilities", name: "Utilities", type: "expense", icon: "💡" },
      { id: "exp-transport", name: "Transport", type: "expense", icon: "🚗" },
      { id: "exp-dining", name: "Dining Out", type: "expense", icon: "🍽️" },
      { id: "exp-entertainment", name: "Entertainment", type: "expense", icon: "🎬" },
      { id: "exp-health", name: "Health", type: "expense", icon: "🏥" },
      { id: "exp-insurance", name: "Insurance", type: "expense", icon: "🛡️" },
      { id: "exp-shopping", name: "Shopping", type: "expense", icon: "🛍️" },
      { id: "exp-education", name: "Education", type: "expense", icon: "🎓" },
      { id: "exp-subscriptions", name: "Subscriptions", type: "expense", icon: "🔁" },
      { id: "exp-other", name: "Other Expense", type: "expense", icon: "📦" },
    ];
  }

  // ---- State ----
  var state = {
    accounts: [],
    journal: [],
    budgets: {}, // { expenseAccountId: monthlyLimit }
  };

  // ---- Persistence (guarded so Node without localStorage is fine) ----
  function hasStorage() {
    try {
      return typeof root.localStorage !== "undefined" && root.localStorage !== null;
    } catch (e) {
      return false;
    }
  }
  function loadKey(key, fallback) {
    if (!hasStorage()) return fallback;
    try {
      var raw = root.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function saveKey(key, value) {
    if (!hasStorage()) return;
    try {
      root.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* ignore quota errors */
    }
  }
  function persist() {
    saveKey(KEYS.accounts, state.accounts);
    saveKey(KEYS.journal, state.journal);
    saveKey(KEYS.budgets, state.budgets);
  }

  // ---- ids ----
  var counter = 0;
  function genId(prefix) {
    counter += 1;
    var t = hasStorage() ? Date.now().toString(36) : "t";
    return (prefix || "e") + "-" + t + "-" + counter.toString(36);
  }

  // ---- Engine (pure helpers operate on passed-in data) ----
  function isDebitNormal(type) {
    return type === "asset" || type === "expense";
  }
  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }
  function lineDelta(accountType, line) {
    var dr = Number(line.debit) || 0;
    var cr = Number(line.credit) || 0;
    return isDebitNormal(accountType) ? dr - cr : cr - dr;
  }
  function entryBalances(entry) {
    var dr = 0, cr = 0;
    entry.lines.forEach(function (l) {
      dr += Number(l.debit) || 0;
      cr += Number(l.credit) || 0;
    });
    return Math.abs(dr - cr) < 0.005;
  }

  // Natural balance of an account over an optional date window {from,to} inclusive.
  function balance(journal, account, opts) {
    opts = opts || {};
    var from = opts.from, to = opts.to;
    var bal = 0;
    for (var i = 0; i < journal.length; i++) {
      var e = journal[i];
      if (from && e.date < from) continue;
      if (to && e.date > to) continue;
      for (var j = 0; j < e.lines.length; j++) {
        if (e.lines[j].accountId === account.id) bal += lineDelta(account.type, e.lines[j]);
      }
    }
    return round2(bal);
  }

  function accountsByType(accounts, type) {
    return accounts.filter(function (a) {
      return a.type === type && !a.archived;
    });
  }

  // ---- Reports ----
  function profitAndLoss(journal, accounts, from, to) {
    var income = accountsByType(accounts, "income").map(function (a) {
      return { account: a, amount: balance(journal, a, { from: from, to: to }) };
    });
    var expense = accountsByType(accounts, "expense").map(function (a) {
      return { account: a, amount: balance(journal, a, { from: from, to: to }) };
    });
    var totalIncome = income.reduce(function (s, r) { return s + r.amount; }, 0);
    var totalExpense = expense.reduce(function (s, r) { return s + r.amount; }, 0);
    return {
      from: from,
      to: to,
      income: income,
      expense: expense,
      totalIncome: round2(totalIncome),
      totalExpense: round2(totalExpense),
      netIncome: round2(totalIncome - totalExpense),
    };
  }

  function balanceSheet(journal, accounts, asOf) {
    function section(type) {
      return accountsByType(accounts, type).map(function (a) {
        return { account: a, amount: balance(journal, a, { to: asOf }) };
      });
    }
    var assets = section("asset");
    var liabilities = section("liability");
    var equityAccounts = section("equity");

    var totalAssets = assets.reduce(function (s, r) { return s + r.amount; }, 0);
    var totalLiabilities = liabilities.reduce(function (s, r) { return s + r.amount; }, 0);
    var totalEquityAccounts = equityAccounts.reduce(function (s, r) { return s + r.amount; }, 0);

    // Retained earnings = cumulative net income to date (income − expense).
    var incomeToDate = accountsByType(accounts, "income").reduce(function (s, a) {
      return s + balance(journal, a, { to: asOf });
    }, 0);
    var expenseToDate = accountsByType(accounts, "expense").reduce(function (s, a) {
      return s + balance(journal, a, { to: asOf });
    }, 0);
    var netIncome = round2(incomeToDate - expenseToDate);

    var totalEquity = round2(totalEquityAccounts + netIncome);
    var totalLiabEquity = round2(totalLiabilities + totalEquity);

    return {
      asOf: asOf,
      assets: assets,
      liabilities: liabilities,
      equityAccounts: equityAccounts,
      netIncome: netIncome,
      totalAssets: round2(totalAssets),
      totalLiabilities: round2(totalLiabilities),
      totalEquity: totalEquity,
      totalLiabilitiesAndEquity: totalLiabEquity,
      balanced: Math.abs(round2(totalAssets) - totalLiabEquity) < 0.005,
    };
  }

  // ---- Entry builders (friendly shorthands → balanced journal entries) ----
  // Expense: money leaves a payment account (asset↓ or liability↑) into an expense category.
  function buildExpense(f) {
    return [
      { accountId: f.categoryId, debit: f.amount, credit: 0 },
      { accountId: f.paymentId, debit: 0, credit: f.amount },
    ];
  }
  // Income: money enters a deposit account (asset↑) from an income category.
  function buildIncome(f) {
    return [
      { accountId: f.depositId, debit: f.amount, credit: 0 },
      { accountId: f.categoryId, debit: 0, credit: f.amount },
    ];
  }
  // Transfer: move between accounts. Debit destination, credit source.
  function buildTransfer(f) {
    return [
      { accountId: f.toId, debit: f.amount, credit: 0 },
      { accountId: f.fromId, debit: 0, credit: f.amount },
    ];
  }

  // ---- Public state mutations ----
  function addEntry(fields) {
    // fields: { date, description, kind, lines }  (lines already built)
    var entry = {
      id: genId("j"),
      date: fields.date,
      description: fields.description || "",
      kind: fields.kind || "journal",
      lines: fields.lines,
      createdAt: nowISO(),
    };
    state.journal.push(entry);
    persist();
    return entry;
  }
  function updateEntry(id, fields) {
    var idx = state.journal.findIndex(function (e) { return e.id === id; });
    if (idx === -1) return null;
    var e = state.journal[idx];
    state.journal[idx] = {
      id: e.id,
      createdAt: e.createdAt,
      date: fields.date,
      description: fields.description || "",
      kind: fields.kind || e.kind,
      lines: fields.lines,
    };
    persist();
    return state.journal[idx];
  }
  function deleteEntry(id) {
    state.journal = state.journal.filter(function (e) { return e.id !== id; });
    persist();
  }

  function addAccount(fields) {
    var acct = {
      id: genId("a"),
      name: fields.name,
      type: fields.type,
      icon: fields.icon || defaultIcon(fields.type),
      archived: false,
    };
    state.accounts.push(acct);
    // Opening balance for asset/liability → offset against Opening Balance Equity.
    var opening = Number(fields.opening) || 0;
    if (opening !== 0 && (fields.type === "asset" || fields.type === "liability")) {
      var date = fields.openingDate || todayISO();
      var lines =
        fields.type === "asset"
          ? [
              { accountId: acct.id, debit: opening, credit: 0 },
              { accountId: OPENING_EQUITY_ID, debit: 0, credit: opening },
            ]
          : [
              { accountId: OPENING_EQUITY_ID, debit: opening, credit: 0 },
              { accountId: acct.id, debit: 0, credit: opening },
            ];
      addEntry({ date: date, description: "Opening balance", kind: "opening", lines: lines });
    } else {
      persist();
    }
    return acct;
  }
  function updateAccount(id, fields) {
    var a = getAccount(id);
    if (!a) return null;
    a.name = fields.name;
    if (fields.icon) a.icon = fields.icon;
    // Type is intentionally not changed after creation (would corrupt history).
    persist();
    return a;
  }
  function setArchived(id, archived) {
    var a = getAccount(id);
    if (a) { a.archived = !!archived; persist(); }
  }
  function accountHasEntries(id) {
    return state.journal.some(function (e) {
      return e.lines.some(function (l) { return l.accountId === id; });
    });
  }
  function deleteAccount(id) {
    // Only allow deleting accounts with no journal activity.
    if (accountHasEntries(id)) return false;
    state.accounts = state.accounts.filter(function (a) { return a.id !== id; });
    if (state.budgets[id]) { delete state.budgets[id]; }
    persist();
    return true;
  }

  function setBudget(accountId, amount) {
    var v = Number(amount) || 0;
    if (v > 0) state.budgets[accountId] = v;
    else delete state.budgets[accountId];
    persist();
  }

  // ---- lookups & helpers ----
  function getAccount(id) {
    return state.accounts.find(function (a) { return a.id === id; }) || null;
  }
  function defaultIcon(type) {
    return { asset: "🏦", liability: "💳", equity: "⚖️", income: "➕", expense: "📦" }[type] || "📁";
  }
  function nowISO() {
    return hasStorage() ? new Date().toISOString() : "1970-01-01T00:00:00.000Z";
  }
  function todayISO() {
    return hasStorage() ? new Date().toISOString().slice(0, 10) : "1970-01-01";
  }

  // Reconstruct the friendly form fields from a stored entry (for editing/display).
  function describeEntry(entry) {
    var lines = entry.lines || [];
    if (entry.kind === "expense" && lines.length === 2) {
      var cat = lines.find(function (l) { return getType(l.accountId) === "expense"; });
      var pay = lines.find(function (l) { return l !== cat; });
      if (cat && pay) return { kind: "expense", amount: cat.debit, categoryId: cat.accountId, paymentId: pay.accountId };
    }
    if (entry.kind === "income" && lines.length === 2) {
      var inc = lines.find(function (l) { return getType(l.accountId) === "income"; });
      var dep = lines.find(function (l) { return l !== inc; });
      if (inc && dep) return { kind: "income", amount: inc.credit, categoryId: inc.accountId, depositId: dep.accountId };
    }
    if (entry.kind === "transfer" && lines.length === 2) {
      var toL = lines.find(function (l) { return (Number(l.debit) || 0) > 0; });
      var fromL = lines.find(function (l) { return (Number(l.credit) || 0) > 0; });
      if (toL && fromL) return { kind: "transfer", amount: toL.debit, toId: toL.accountId, fromId: fromL.accountId };
    }
    // Fallback for opening / generic journal entries.
    var amt = lines.reduce(function (s, l) { return s + (Number(l.debit) || 0); }, 0);
    return { kind: entry.kind || "journal", amount: amt, generic: true };
  }
  function getType(id) {
    var a = getAccount(id);
    return a ? a.type : null;
  }

  // ---- One-time migration from the old FinTrack single-entry format ----
  function migrateFromFintrack() {
    var oldTx = loadKey("fintrack.transactions", null);
    if (!oldTx || !oldTx.length) return false;

    var map = {
      Groceries: "exp-groceries", Rent: "exp-housing", Utilities: "exp-utilities",
      Transport: "exp-transport", Dining: "exp-dining", Entertainment: "exp-entertainment",
      Health: "exp-health", Shopping: "exp-shopping", Other: "exp-other",
      Salary: "inc-salary", Freelance: "inc-freelance", Investment: "inc-investment",
      Gift: "inc-gift",
    };
    oldTx.forEach(function (t) {
      var amount = Number(t.amount) || 0;
      if (!(amount > 0)) return;
      if (t.type === "income") {
        var incId = map[t.category] || "inc-other";
        addEntry({
          date: t.date, description: t.description || "", kind: "income",
          lines: buildIncome({ amount: amount, depositId: "checking", categoryId: incId }),
        });
      } else {
        var expId = map[t.category] || "exp-other";
        addEntry({
          date: t.date, description: t.description || "", kind: "expense",
          lines: buildExpense({ amount: amount, categoryId: expId, paymentId: "checking" }),
        });
      }
    });
    // Migrate budgets keyed by old category name → expense account id.
    var oldBudgets = loadKey("fintrack.budgets", null);
    if (oldBudgets) {
      Object.keys(oldBudgets).forEach(function (name) {
        var id = map[name];
        if (id) state.budgets[id] = Number(oldBudgets[name]) || 0;
      });
    }
    return true;
  }

  // ---- init ----
  function init() {
    var storedAccounts = loadKey(KEYS.accounts, null);
    var storedJournal = loadKey(KEYS.journal, null);

    if (storedAccounts && storedAccounts.length) {
      state.accounts = storedAccounts;
      state.journal = storedJournal || [];
      state.budgets = loadKey(KEYS.budgets, {}) || {};
    } else {
      // Fresh install: seed the chart of accounts, then try to migrate old data.
      state.accounts = seedAccounts();
      state.journal = [];
      state.budgets = {};
      migrateFromFintrack();
      persist();
    }
    return state;
  }

  root.FD = {
    KEYS: KEYS,
    TYPES: TYPES,
    OPENING_EQUITY_ID: OPENING_EQUITY_ID,
    state: state,
    init: init,
    seedAccounts: seedAccounts,
    // engine
    isDebitNormal: isDebitNormal,
    lineDelta: lineDelta,
    entryBalances: entryBalances,
    balance: balance,
    accountsByType: accountsByType,
    round2: round2,
    // reports
    profitAndLoss: profitAndLoss,
    balanceSheet: balanceSheet,
    // builders
    buildExpense: buildExpense,
    buildIncome: buildIncome,
    buildTransfer: buildTransfer,
    // mutations
    addEntry: addEntry,
    updateEntry: updateEntry,
    deleteEntry: deleteEntry,
    addAccount: addAccount,
    updateAccount: updateAccount,
    deleteAccount: deleteAccount,
    setArchived: setArchived,
    accountHasEntries: accountHasEntries,
    setBudget: setBudget,
    // lookups
    getAccount: getAccount,
    getType: getType,
    describeEntry: describeEntry,
    defaultIcon: defaultIcon,
    todayISO: todayISO,
    persist: persist,
    genId: genId,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = root.FD;
})(typeof window !== "undefined" ? window : globalThis);
