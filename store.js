/* Finance Desk — data store & double-entry accounting engine.
 *
 * Pure of DOM: safe to load in Node for testing. Attaches to globalThis.FD.
 *
 * Model
 * -----
 * Account { id, name, type, icon, parentId?, archived }
 *   type ∈ asset | liability | equity | income | expense
 *   parentId groups an account under a parent of the SAME type (one level deep)
 *   — this is how categories get subcategories.
 *   Normal balance: asset & expense are debit-normal; liability, equity,
 *   income are credit-normal.
 *
 * Journal entry { id, date:"YYYY-MM-DD", description, kind, lines[], createdAt }
 *   kind ∈ expense | income | transfer | opening | journal
 *   lines: [{ accountId, debit, credit }] — every entry MUST balance
 *          (sum debits === sum credits). Entries may have >2 lines (splits).
 *
 * Because every entry balances, the Balance Sheet identity
 *   Assets = Liabilities + Equity + Net Income
 * always holds.
 */
(function (root) {
  "use strict";

  var DATA_VERSION = 2;

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

  // ---- Seed chart of accounts (fixed ids; a few subcategories to demonstrate) ----
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

      // Groceries with subcategories (the classic "food vs household" split).
      { id: "exp-groceries", name: "Groceries", type: "expense", icon: "🛒" },
      { id: "exp-grocery-food", name: "Food", type: "expense", icon: "🥦", parentId: "exp-groceries" },
      { id: "exp-grocery-household", name: "Household", type: "expense", icon: "🧻", parentId: "exp-groceries" },

      { id: "exp-housing", name: "Rent / Mortgage", type: "expense", icon: "🏠" },

      { id: "exp-utilities", name: "Utilities", type: "expense", icon: "💡" },
      { id: "exp-util-electric", name: "Electricity", type: "expense", icon: "⚡", parentId: "exp-utilities" },
      { id: "exp-util-water", name: "Water", type: "expense", icon: "🚰", parentId: "exp-utilities" },
      { id: "exp-util-internet", name: "Internet", type: "expense", icon: "🌐", parentId: "exp-utilities" },

      { id: "exp-transport", name: "Transport", type: "expense", icon: "🚗" },
      { id: "exp-transport-fuel", name: "Fuel", type: "expense", icon: "⛽", parentId: "exp-transport" },
      { id: "exp-transport-transit", name: "Public Transit", type: "expense", icon: "🚌", parentId: "exp-transport" },

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
  // tombstones record deletions (id -> ms) so a delete on one device isn't
  // resurrected when another device's copy is merged in. meta.budgetsUpdatedAt
  // is a last-write-wins clock for the budgets map.
  var state = { accounts: [], journal: [], budgets: {}, tombstones: { journal: {}, accounts: {} }, meta: { budgetsUpdatedAt: 0 } };
  var changeListeners = [];

  // ---- Persistence (guarded so Node without localStorage is fine) ----
  function hasStorage() {
    try { return typeof root.localStorage !== "undefined" && root.localStorage !== null; }
    catch (e) { return false; }
  }
  function loadKey(key, fallback) {
    if (!hasStorage()) return fallback;
    try { var raw = root.localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function saveKey(key, value) {
    if (!hasStorage()) return;
    try { root.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function normTombstones(t) { t = t || {}; return { journal: t.journal || {}, accounts: t.accounts || {} }; }
  function snapshot() {
    return { accounts: state.accounts, journal: state.journal, budgets: state.budgets,
      tombstones: state.tombstones, meta: state.meta };
  }
  // Load state from a decrypted object without writing plaintext to disk.
  function hydrate(data) {
    state.accounts = (data && data.accounts) || [];
    state.journal = (data && data.journal) || [];
    state.budgets = (data && data.budgets) || {};
    state.tombstones = normTombstones(data && data.tombstones);
    state.meta = (data && data.meta) || { budgetsUpdatedAt: 0 };
    return state;
  }
  function vaultActive() {
    return !!(root.FDVault && root.FDVault.isActive && root.FDVault.isActive());
  }
  function isEncrypted() {
    return !!(root.FDVault && root.FDVault.isEnabled && root.FDVault.isEnabled());
  }
  function persist() {
    // When a PIN vault is unlocked, save the encrypted blob instead of plaintext.
    if (vaultActive()) { root.FDVault.save(snapshot()); }
    else {
      saveKey(KEYS.accounts, state.accounts);
      saveKey(KEYS.journal, state.journal);
      saveKey(KEYS.budgets, state.budgets);
      saveKey(KEYS.meta, { tombstones: state.tombstones, meta: state.meta });
    }
    for (var i = 0; i < changeListeners.length; i++) { try { changeListeners[i](); } catch (e) {} }
  }
  function onChange(fn) { changeListeners.push(fn); }

  // ---- ids ----
  var counter = 0;
  function genId(prefix) {
    counter += 1;
    var t = hasStorage() ? Date.now().toString(36) : "t";
    return (prefix || "e") + "-" + t + "-" + counter.toString(36);
  }

  // ---- Engine ----
  function isDebitNormal(type) { return type === "asset" || type === "expense"; }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function lineDelta(accountType, line) {
    var dr = Number(line.debit) || 0, cr = Number(line.credit) || 0;
    return isDebitNormal(accountType) ? dr - cr : cr - dr;
  }
  function entryBalances(entry) {
    var dr = 0, cr = 0;
    entry.lines.forEach(function (l) { dr += Number(l.debit) || 0; cr += Number(l.credit) || 0; });
    return Math.abs(dr - cr) < 0.005;
  }

  // Own natural balance of an account over an optional window {from,to} inclusive.
  function balance(journal, account, opts) {
    opts = opts || {};
    var from = opts.from, to = opts.to, bal = 0;
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

  // ---- Hierarchy helpers ----
  function accountsByType(accounts, type) {
    return accounts.filter(function (a) { return a.type === type && !a.archived; });
  }
  function childrenOf(accounts, parentId) {
    return accounts.filter(function (a) { return a.parentId === parentId && !a.archived; });
  }
  function hasChildren(accounts, id) {
    return accounts.some(function (a) { return a.parentId === id && !a.archived; });
  }
  function topLevel(accounts, type) {
    return accounts.filter(function (a) { return a.type === type && !a.parentId && !a.archived; });
  }
  // Balance including children (roll-up) over a window.
  function rolledBalance(journal, accounts, account, opts) {
    var total = balance(journal, account, opts);
    childrenOf(accounts, account.id).forEach(function (c) {
      total += balance(journal, c, opts);
    });
    return round2(total);
  }
  // Accounts of a type ordered parent→children for display.
  function orderedByHierarchy(accounts, type) {
    var out = [];
    topLevel(accounts, type).forEach(function (p) {
      out.push({ account: p, depth: 0 });
      childrenOf(accounts, p.id).forEach(function (c) { out.push({ account: c, depth: 1 }); });
    });
    return out;
  }

  // ---- Reports ----
  function profitAndLoss(journal, accounts, from, to) {
    function rows(type) {
      return accountsByType(accounts, type).map(function (a) {
        return { account: a, amount: balance(journal, a, { from: from, to: to }) };
      });
    }
    var income = rows("income"), expense = rows("expense");
    var totalIncome = income.reduce(function (s, r) { return s + r.amount; }, 0);
    var totalExpense = expense.reduce(function (s, r) { return s + r.amount; }, 0);
    return {
      from: from, to: to, income: income, expense: expense,
      totalIncome: round2(totalIncome), totalExpense: round2(totalExpense),
      netIncome: round2(totalIncome - totalExpense),
    };
  }

  function balanceSheet(journal, accounts, asOf) {
    function section(type) {
      return accountsByType(accounts, type).map(function (a) {
        return { account: a, amount: balance(journal, a, { to: asOf }) };
      });
    }
    var assets = section("asset"), liabilities = section("liability"), equityAccounts = section("equity");
    var totalAssets = assets.reduce(function (s, r) { return s + r.amount; }, 0);
    var totalLiabilities = liabilities.reduce(function (s, r) { return s + r.amount; }, 0);
    var totalEquityAccounts = equityAccounts.reduce(function (s, r) { return s + r.amount; }, 0);

    var incomeToDate = accountsByType(accounts, "income").reduce(function (s, a) { return s + balance(journal, a, { to: asOf }); }, 0);
    var expenseToDate = accountsByType(accounts, "expense").reduce(function (s, a) { return s + balance(journal, a, { to: asOf }); }, 0);
    var netIncome = round2(incomeToDate - expenseToDate);

    var totalEquity = round2(totalEquityAccounts + netIncome);
    var totalLiabEquity = round2(totalLiabilities + totalEquity);
    return {
      asOf: asOf, assets: assets, liabilities: liabilities, equityAccounts: equityAccounts,
      netIncome: netIncome, totalAssets: round2(totalAssets), totalLiabilities: round2(totalLiabilities),
      totalEquity: totalEquity, totalLiabilitiesAndEquity: totalLiabEquity,
      balanced: Math.abs(round2(totalAssets) - totalLiabEquity) < 0.005,
    };
  }

  function addDays(iso, n) {
    var d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // Cash-flow: change in cash & bank (asset) accounts over a period, attributed
  // to the non-asset side of each entry. Reconciles to ending − beginning.
  function cashFlow(journal, accounts, from, to) {
    var assetAccts = accountsByType(accounts, "asset");
    var assetIds = {};
    assetAccts.forEach(function (a) { assetIds[a.id] = a; });

    function sumAssets(cutTo) {
      return assetAccts.reduce(function (s, a) { return s + balance(journal, a, { to: cutTo }); }, 0);
    }
    var beginning = from ? round2(sumAssets(addDays(from, -1))) : 0;
    var ending = round2(sumAssets(to));

    var groups = { income: 0, expense: 0, financing: 0, equity: 0 };
    journal.forEach(function (e) {
      if (from && e.date < from) return;
      if (to && e.date > to) return;
      var assetDelta = 0, hasIncome = false, hasExpense = false, hasLiab = false, hasEquity = false;
      e.lines.forEach(function (l) {
        var acc = getAccountIn(accounts, l.accountId);
        if (!acc) return;
        if (acc.type === "asset") assetDelta += lineDelta("asset", l);
        else if (acc.type === "income") hasIncome = true;
        else if (acc.type === "expense") hasExpense = true;
        else if (acc.type === "liability") hasLiab = true;
        else if (acc.type === "equity") hasEquity = true;
      });
      if (Math.abs(assetDelta) < 0.005) return; // no cash moved (e.g. CC expense, asset↔asset transfer)
      if (hasIncome) groups.income += assetDelta;
      else if (hasExpense) groups.expense += assetDelta;
      else if (hasLiab) groups.financing += assetDelta;
      else if (hasEquity) groups.equity += assetDelta;
      else groups.financing += assetDelta;
    });
    Object.keys(groups).forEach(function (k) { groups[k] = round2(groups[k]); });
    var netChange = round2(groups.income + groups.expense + groups.financing + groups.equity);
    return {
      from: from, to: to, beginning: beginning, ending: ending,
      groups: groups, netChange: netChange,
      reconciles: Math.abs(round2(beginning + netChange) - ending) < 0.02,
    };
  }

  // ---- Entry builders ----
  function buildExpense(f) {
    return [
      { accountId: f.categoryId, debit: f.amount, credit: 0 },
      { accountId: f.paymentId, debit: 0, credit: f.amount },
    ];
  }
  function buildIncome(f) {
    return [
      { accountId: f.depositId, debit: f.amount, credit: 0 },
      { accountId: f.categoryId, debit: 0, credit: f.amount },
    ];
  }
  function buildTransfer(f) {
    return [
      { accountId: f.toId, debit: f.amount, credit: 0 },
      { accountId: f.fromId, debit: 0, credit: f.amount },
    ];
  }
  // Split expense: many category debits, one payment credit for the total.
  function buildExpenseSplit(f) {
    var total = 0;
    var lines = f.splits.map(function (s) { total += Number(s.amount) || 0; return { accountId: s.accountId, debit: round2(Number(s.amount) || 0), credit: 0 }; });
    lines.push({ accountId: f.paymentId, debit: 0, credit: round2(total) });
    return lines;
  }
  // Split income: many category credits, one deposit debit for the total.
  function buildIncomeSplit(f) {
    var total = 0;
    var lines = f.splits.map(function (s) { total += Number(s.amount) || 0; return { accountId: s.accountId, debit: 0, credit: round2(Number(s.amount) || 0) }; });
    lines.unshift({ accountId: f.depositId, debit: round2(total), credit: 0 });
    return lines;
  }

  // ---- Mutations ----
  function nowISO() { return hasStorage() ? new Date().toISOString() : "1970-01-01T00:00:00.000Z"; }
  function todayISO() { return hasStorage() ? new Date().toISOString().slice(0, 10) : "1970-01-01"; }
  // Monotonic-ish wall clock in ms, used to order records/tombstones during merge.
  var lastMs = 0;
  function nowMs() { var t = Date.now(); if (t <= lastMs) t = lastMs + 1; lastMs = t; return t; }

  function addEntry(fields) {
    var entry = {
      id: genId("j"), date: fields.date, description: fields.description || "",
      kind: fields.kind || "journal", lines: fields.lines, createdAt: nowISO(), updatedAt: nowMs(),
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
      id: e.id, createdAt: e.createdAt, date: fields.date, description: fields.description || "",
      kind: fields.kind || e.kind, lines: fields.lines, updatedAt: nowMs(),
    };
    persist();
    return state.journal[idx];
  }
  function deleteEntry(id) {
    state.journal = state.journal.filter(function (e) { return e.id !== id; });
    state.tombstones.journal[id] = nowMs();
    persist();
  }

  function addAccount(fields) {
    var acct = {
      id: genId("a"), name: fields.name, type: fields.type,
      icon: fields.icon || defaultIcon(fields.type), archived: false, updatedAt: nowMs(),
    };
    if (fields.parentId) acct.parentId = fields.parentId;
    state.accounts.push(acct);
    var opening = Number(fields.opening) || 0;
    if (opening !== 0 && (fields.type === "asset" || fields.type === "liability")) {
      var date = fields.openingDate || todayISO();
      var lines = fields.type === "asset"
        ? [{ accountId: acct.id, debit: opening, credit: 0 }, { accountId: OPENING_EQUITY_ID, debit: 0, credit: opening }]
        : [{ accountId: OPENING_EQUITY_ID, debit: opening, credit: 0 }, { accountId: acct.id, debit: 0, credit: opening }];
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
    // Reparent (same type, not itself, not creating depth > 1).
    if (typeof fields.parentId !== "undefined") {
      if (!fields.parentId) delete a.parentId;
      else if (fields.parentId !== id && !hasChildren(state.accounts, id)) a.parentId = fields.parentId;
    }
    a.updatedAt = nowMs();
    persist();
    return a;
  }
  function setArchived(id, archived) { var a = getAccount(id); if (a) { a.archived = !!archived; a.updatedAt = nowMs(); persist(); } }
  function accountHasEntries(id) {
    return state.journal.some(function (e) { return e.lines.some(function (l) { return l.accountId === id; }); });
  }
  function deleteAccount(id) {
    if (accountHasEntries(id)) return false;
    if (hasChildren(state.accounts, id)) return false;
    state.accounts = state.accounts.filter(function (a) { return a.id !== id; });
    if (state.budgets[id]) delete state.budgets[id];
    state.tombstones.accounts[id] = nowMs();
    state.meta.budgetsUpdatedAt = nowMs();
    persist();
    return true;
  }
  function setBudget(accountId, amount) {
    var v = Number(amount) || 0;
    if (v > 0) state.budgets[accountId] = v; else delete state.budgets[accountId];
    state.meta.budgetsUpdatedAt = nowMs();
    persist();
  }

  // ---- Opening balances (editable after creation) ----
  function findOpeningEntry(accountId) {
    return state.journal.find(function (e) {
      return e.kind === "opening" &&
        e.lines.some(function (l) { return l.accountId === accountId; }) &&
        e.lines.some(function (l) { return l.accountId === OPENING_EQUITY_ID; });
    });
  }
  function getOpeningBalance(accountId) {
    var e = findOpeningEntry(accountId); if (!e) return null;
    var acc = getAccount(accountId); if (!acc) return null;
    var line = e.lines.find(function (l) { return l.accountId === accountId; });
    if (!line) return null;
    var amt = acc.type === "asset" ? (Number(line.debit) || 0) : (Number(line.credit) || 0);
    return { amount: round2(amt), date: e.date };
  }
  // Create, update, or clear an account's opening balance entry.
  function setOpeningBalance(accountId, amount, date) {
    var acc = getAccount(accountId);
    if (!acc || (acc.type !== "asset" && acc.type !== "liability")) return;
    amount = round2(Number(amount) || 0);
    date = date || todayISO();
    var existing = findOpeningEntry(accountId);
    if (amount === 0) { if (existing) deleteEntry(existing.id); return; }
    var lines = acc.type === "asset"
      ? [{ accountId: accountId, debit: amount, credit: 0 }, { accountId: OPENING_EQUITY_ID, debit: 0, credit: amount }]
      : [{ accountId: OPENING_EQUITY_ID, debit: amount, credit: 0 }, { accountId: accountId, debit: 0, credit: amount }];
    if (existing) updateEntry(existing.id, { date: date, description: "Opening balance", kind: "opening", lines: lines });
    else addEntry({ date: date, description: "Opening balance", kind: "opening", lines: lines });
  }

  // ---- lookups ----
  function getAccountIn(accounts, id) {
    for (var i = 0; i < accounts.length; i++) if (accounts[i].id === id) return accounts[i];
    return null;
  }
  function getAccount(id) { return getAccountIn(state.accounts, id); }
  function getType(id) { var a = getAccount(id); return a ? a.type : null; }
  function defaultIcon(type) {
    return { asset: "🏦", liability: "💳", equity: "⚖️", income: "➕", expense: "📦" }[type] || "📁";
  }

  // Reconstruct friendly fields from a stored entry (handles splits + legacy 2-line).
  function describeEntry(entry) {
    var lines = entry.lines || [];
    if (entry.kind === "expense") {
      var payLine = lines.find(function (l) { return (Number(l.credit) || 0) > 0; });
      var catLines = lines.filter(function (l) { return (Number(l.debit) || 0) > 0; });
      var amount = catLines.reduce(function (s, l) { return s + (Number(l.debit) || 0); }, 0);
      if (catLines.length > 1) {
        return { kind: "expense", split: true, amount: round2(amount), paymentId: payLine ? payLine.accountId : null,
          splits: catLines.map(function (l) { return { accountId: l.accountId, amount: Number(l.debit) || 0 }; }) };
      }
      return { kind: "expense", split: false, amount: round2(amount), categoryId: catLines[0] ? catLines[0].accountId : null, paymentId: payLine ? payLine.accountId : null };
    }
    if (entry.kind === "income") {
      var depLine = lines.find(function (l) { return (Number(l.debit) || 0) > 0; });
      var incLines = lines.filter(function (l) { return (Number(l.credit) || 0) > 0; });
      var amt = incLines.reduce(function (s, l) { return s + (Number(l.credit) || 0); }, 0);
      if (incLines.length > 1) {
        return { kind: "income", split: true, amount: round2(amt), depositId: depLine ? depLine.accountId : null,
          splits: incLines.map(function (l) { return { accountId: l.accountId, amount: Number(l.credit) || 0 }; }) };
      }
      return { kind: "income", split: false, amount: round2(amt), categoryId: incLines[0] ? incLines[0].accountId : null, depositId: depLine ? depLine.accountId : null };
    }
    if (entry.kind === "transfer" && lines.length === 2) {
      var toL = lines.find(function (l) { return (Number(l.debit) || 0) > 0; });
      var fromL = lines.find(function (l) { return (Number(l.credit) || 0) > 0; });
      return { kind: "transfer", split: false, amount: round2(toL ? toL.debit : 0), toId: toL ? toL.accountId : null, fromId: fromL ? fromL.accountId : null };
    }
    var a = lines.reduce(function (s, l) { return s + (Number(l.debit) || 0); }, 0);
    return { kind: entry.kind || "journal", amount: round2(a), generic: true };
  }

  // Per-account register with running balance (chronological).
  function register(journal, account) {
    var rows = [];
    journal.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
    }).forEach(function (e) {
      var delta = 0, touched = false;
      e.lines.forEach(function (l) { if (l.accountId === account.id) { delta += lineDelta(account.type, l); touched = true; } });
      if (touched) rows.push({ entry: e, delta: round2(delta) });
    });
    var running = 0;
    rows.forEach(function (r) { running = round2(running + r.delta); r.balance = running; });
    return rows;
  }

  // ---- JSON backup / restore ----
  function exportData() {
    return { app: "finance-desk", version: DATA_VERSION, accounts: state.accounts, journal: state.journal,
      budgets: state.budgets, tombstones: state.tombstones, meta: state.meta };
  }
  function importData(obj) {
    if (!obj || !Array.isArray(obj.accounts) || !Array.isArray(obj.journal)) {
      return { ok: false, error: "Not a valid Finance Desk backup." };
    }
    state.accounts = obj.accounts;
    state.journal = obj.journal;
    state.budgets = obj.budgets && typeof obj.budgets === "object" ? obj.budgets : {};
    state.tombstones = normTombstones(obj.tombstones);
    state.meta = obj.meta && typeof obj.meta === "object" ? obj.meta : { budgetsUpdatedAt: 0 };
    persist();
    return { ok: true, accounts: state.accounts.length, journal: state.journal.length };
  }

  // ---- Merge two datasets (for multi-device / shared sync) ----
  // Records are keyed by id; the higher updatedAt wins. A tombstone newer than a
  // record's updatedAt removes it (so deletes don't resurrect). Budgets are
  // last-write-wins as a unit via meta.budgetsUpdatedAt.
  function mergeCollection(localArr, remoteArr, localTomb, remoteTomb) {
    localTomb = localTomb || {}; remoteTomb = remoteTomb || {};
    var byId = {};
    function consider(rec) { if (!rec || !rec.id) return; var ex = byId[rec.id]; if (!ex || (rec.updatedAt || 0) >= (ex.updatedAt || 0)) byId[rec.id] = rec; }
    (localArr || []).forEach(consider); (remoteArr || []).forEach(consider);
    var tomb = {};
    [localTomb, remoteTomb].forEach(function (t) { Object.keys(t).forEach(function (id) { tomb[id] = Math.max(tomb[id] || 0, t[id]); }); });
    var out = [];
    Object.keys(byId).forEach(function (id) { var r = byId[id]; if ((tomb[id] || 0) > (r.updatedAt || 0)) return; out.push(r); });
    return { records: out, tombstones: tomb };
  }
  function merge(local, remote) {
    local = local || {}; remote = remote || {};
    var lt = normTombstones(local.tombstones), rt = normTombstones(remote.tombstones);
    var j = mergeCollection(local.journal, remote.journal, lt.journal, rt.journal);
    var a = mergeCollection(local.accounts, remote.accounts, lt.accounts, rt.accounts);
    var lb = (local.meta && local.meta.budgetsUpdatedAt) || 0, rb = (remote.meta && remote.meta.budgetsUpdatedAt) || 0;
    return {
      accounts: a.records, journal: j.records,
      budgets: (rb > lb ? remote.budgets : local.budgets) || {},
      tombstones: { journal: j.tombstones, accounts: a.tombstones },
      meta: { budgetsUpdatedAt: Math.max(lb, rb) },
    };
  }

  // ---- migration from old single-entry FinTrack ----
  function migrateFromFintrack() {
    var oldTx = loadKey("fintrack.transactions", null);
    if (!oldTx || !oldTx.length) return false;
    var map = {
      Groceries: "exp-groceries", Rent: "exp-housing", Utilities: "exp-utilities",
      Transport: "exp-transport", Dining: "exp-dining", Entertainment: "exp-entertainment",
      Health: "exp-health", Shopping: "exp-shopping", Other: "exp-other",
      Salary: "inc-salary", Freelance: "inc-freelance", Investment: "inc-investment", Gift: "inc-gift",
    };
    oldTx.forEach(function (t) {
      var amount = Number(t.amount) || 0;
      if (!(amount > 0)) return;
      if (t.type === "income") {
        addEntry({ date: t.date, description: t.description || "", kind: "income",
          lines: buildIncome({ amount: amount, depositId: "checking", categoryId: map[t.category] || "inc-other" }) });
      } else {
        addEntry({ date: t.date, description: t.description || "", kind: "expense",
          lines: buildExpense({ amount: amount, categoryId: map[t.category] || "exp-other", paymentId: "checking" }) });
      }
    });
    var oldBudgets = loadKey("fintrack.budgets", null);
    if (oldBudgets) Object.keys(oldBudgets).forEach(function (name) { if (map[name]) state.budgets[map[name]] = Number(oldBudgets[name]) || 0; });
    return true;
  }

  function init() {
    var storedAccounts = loadKey(KEYS.accounts, null);
    if (storedAccounts && storedAccounts.length) {
      state.accounts = storedAccounts;
      state.journal = loadKey(KEYS.journal, []) || [];
      state.budgets = loadKey(KEYS.budgets, {}) || {};
      var m = loadKey(KEYS.meta, null) || {};
      state.tombstones = normTombstones(m.tombstones);
      state.meta = m.meta || { budgetsUpdatedAt: 0 };
    } else {
      state.accounts = seedAccounts();
      state.journal = [];
      state.budgets = {};
      state.tombstones = { journal: {}, accounts: {} };
      state.meta = { budgetsUpdatedAt: 0 };
      migrateFromFintrack();
      persist();
    }
    return state;
  }

  root.FD = {
    DATA_VERSION: DATA_VERSION, KEYS: KEYS, TYPES: TYPES, OPENING_EQUITY_ID: OPENING_EQUITY_ID,
    state: state, init: init, seedAccounts: seedAccounts,
    // engine
    isDebitNormal: isDebitNormal, lineDelta: lineDelta, entryBalances: entryBalances, balance: balance, round2: round2,
    // hierarchy
    accountsByType: accountsByType, childrenOf: childrenOf, hasChildren: hasChildren,
    topLevel: topLevel, rolledBalance: rolledBalance, orderedByHierarchy: orderedByHierarchy,
    // reports
    profitAndLoss: profitAndLoss, balanceSheet: balanceSheet, cashFlow: cashFlow, register: register,
    // builders
    buildExpense: buildExpense, buildIncome: buildIncome, buildTransfer: buildTransfer,
    buildExpenseSplit: buildExpenseSplit, buildIncomeSplit: buildIncomeSplit,
    // mutations
    addEntry: addEntry, updateEntry: updateEntry, deleteEntry: deleteEntry,
    addAccount: addAccount, updateAccount: updateAccount, deleteAccount: deleteAccount,
    setArchived: setArchived, accountHasEntries: accountHasEntries, setBudget: setBudget,
    getOpeningBalance: getOpeningBalance, setOpeningBalance: setOpeningBalance,
    // vault / persistence / sync
    snapshot: snapshot, hydrate: hydrate, isEncrypted: isEncrypted, onChange: onChange, merge: merge,
    // backup
    exportData: exportData, importData: importData,
    // lookups
    getAccount: getAccount, getType: getType, describeEntry: describeEntry, defaultIcon: defaultIcon,
    todayISO: todayISO, persist: persist, genId: genId, addDays: addDays,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = root.FD;
})(typeof window !== "undefined" ? window : globalThis);
