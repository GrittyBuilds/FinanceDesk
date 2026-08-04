/* Finance Desk — UI layer. Depends on store.js (window.FD). */
(function () {
  "use strict";

  var FD = window.FD;
  var THEME_KEY = FD.KEYS.theme;

  var CHART_COLORS = [
    "#2f6df6", "#e5484d", "#1fae7a", "#f5a623", "#9b59b6",
    "#00bcd4", "#ff6f91", "#8bc34a", "#795548", "#5c6bc0",
  ];

  // Report view state.
  var report = { type: "pl", period: "this-month", from: null, to: null, asOf: null };

  // ---------- Small helpers ----------
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function pad(n) { return String(n).padStart(2, "0"); }

  function money(v) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v || 0);
  }
  function signedMoney(v) {
    var s = money(Math.abs(v));
    return v < 0 ? "(" + s + ")" : s;
  }
  function fmtDate(iso) {
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function fmtDateShort(iso) {
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function monthKey(iso) { return (iso || "").slice(0, 7); }
  function currentMonthKey() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Inclusive month range for a given year + month index (0-based).
  function monthRange(y, m) {
    var last = new Date(y, m + 1, 0).getDate();
    return { from: y + "-" + pad(m + 1) + "-01", to: y + "-" + pad(m + 1) + "-" + pad(last) };
  }

  // ---------- Router ----------
  var VIEWS = ["dashboard", "transactions", "reports", "accounts", "budgets"];
  var TITLES = { dashboard: "Dashboard", transactions: "Transactions", reports: "Reports", accounts: "Accounts", budgets: "Budgets" };

  function navigate() {
    var view = (location.hash || "#dashboard").slice(1);
    if (VIEWS.indexOf(view) === -1) view = "dashboard";

    VIEWS.forEach(function (v) {
      var section = $("#view-" + v);
      if (section) section.hidden = v !== view;
    });
    $all(".nav-link, .tab").forEach(function (a) {
      if (a.dataset.view) a.classList.toggle("active", a.dataset.view === view);
    });
    $("#page-title").textContent = TITLES[view];
    renderView(view);
    window.scrollTo(0, 0);
  }

  function renderView(view) {
    if (view === "dashboard") renderDashboard();
    else if (view === "transactions") renderTransactions();
    else if (view === "reports") renderReports();
    else if (view === "accounts") renderAccounts();
    else if (view === "budgets") renderBudgets();
  }

  function refresh() {
    var view = (location.hash || "#dashboard").slice(1);
    if (VIEWS.indexOf(view) === -1) view = "dashboard";
    renderView(view);
  }

  // ---------- Dashboard ----------
  function renderDashboard() {
    var el = $("#view-dashboard");
    var j = FD.state.journal, accts = FD.state.accounts;
    var today = todayISO();

    var totalAssets = FD.accountsByType(accts, "asset").reduce(function (s, a) { return s + FD.balance(j, a, { to: today }); }, 0);
    var totalLiab = FD.accountsByType(accts, "liability").reduce(function (s, a) { return s + FD.balance(j, a, { to: today }); }, 0);
    var netWorth = FD.round2(totalAssets - totalLiab);

    var mr = monthRange(new Date().getFullYear(), new Date().getMonth());
    var pl = FD.profitAndLoss(j, accts, mr.from, mr.to);

    el.innerHTML =
      '<div class="tiles">' +
        tile("Net Worth", money(netWorth), "Assets − Liabilities", netWorth >= 0 ? "pos" : "neg") +
        tile("Income this month", money(pl.totalIncome), monthLabel(), "pos") +
        tile("Expenses this month", money(pl.totalExpense), monthLabel(), "neg") +
        tile("Net this month", signedMoney(pl.netIncome), (pl.netIncome >= 0 ? "Surplus" : "Deficit"), pl.netIncome >= 0 ? "pos" : "neg") +
      '</div>' +
      '<div class="dash-grid">' +
        '<div class="card"><h2>Spending this month</h2><div id="dash-chart-wrap"></div></div>' +
        '<div class="card"><div class="card-head"><h2>Recent activity</h2><a href="#transactions" class="btn btn-ghost btn-sm">View all</a></div><ul class="tx-list" id="dash-recent"></ul><div id="dash-recent-empty" class="empty-state" hidden>No transactions yet.</div></div>' +
      '</div>';

    renderDonut($("#dash-chart-wrap"), mr.from, mr.to);
    renderRecent($("#dash-recent"), $("#dash-recent-empty"), 6);
  }

  function tile(label, value, sub, cls) {
    return '<div class="tile"><span class="tile-label">' + escapeHTML(label) + '</span>' +
      '<span class="tile-value ' + (cls || "") + '">' + escapeHTML(value) + '</span>' +
      '<span class="tile-sub">' + escapeHTML(sub) + '</span></div>';
  }
  function monthLabel() { return new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }); }

  function renderRecent(listEl, emptyEl, limit) {
    var entries = FD.state.journal.slice().sort(sortEntries).slice(0, limit);
    listEl.innerHTML = "";
    emptyEl.hidden = entries.length > 0;
    entries.forEach(function (e) { listEl.appendChild(txRow(e)); });
  }

  // ---------- Donut chart (this-month expenses by category) ----------
  function renderDonut(wrap, from, to) {
    var totals = {};
    FD.accountsByType(FD.state.accounts, "expense").forEach(function (a) {
      var amt = FD.balance(FD.state.journal, a, { from: from, to: to });
      if (amt > 0.005) totals[a.id] = { name: a.name, amount: amt };
    });
    var entries = Object.keys(totals).map(function (id) { return totals[id]; }).sort(function (a, b) { return b.amount - a.amount; });
    var grand = entries.reduce(function (s, e) { return s + e.amount; }, 0);

    if (!entries.length) {
      wrap.innerHTML = '<div class="empty-state">No expenses recorded this month.</div>';
      return;
    }
    wrap.innerHTML = '<div class="chart-wrap"><canvas id="chart" width="220" height="220"></canvas><ul class="legend" id="chart-legend"></ul></div>';
    var canvas = $("#chart", wrap);
    var legend = $("#chart-legend", wrap);
    var ctx = canvas.getContext("2d");
    var size = canvas.width, cx = size / 2, cy = size / 2, radius = size / 2 - 6, inner = radius * 0.6;
    var start = -Math.PI / 2;

    entries.forEach(function (e, i) {
      var slice = (e.amount / grand) * Math.PI * 2;
      var color = CHART_COLORS[i % CHART_COLORS.length];
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius, start, start + slice); ctx.closePath();
      ctx.fillStyle = color; ctx.fill(); start += slice;
      var pct = ((e.amount / grand) * 100).toFixed(0);
      var li = document.createElement("li");
      li.innerHTML = '<span class="dot" style="background:' + color + '"></span><span class="legend-name"></span><span class="legend-amount">' + money(e.amount) + " (" + pct + "%)</span>";
      $(".legend-name", li).textContent = e.name;
      legend.appendChild(li);
    });

    var surface = cssVar("--surface", "#fff");
    ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2); ctx.fillStyle = surface; ctx.fill();
    ctx.fillStyle = cssVar("--text", "#000"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "600 17px -apple-system, sans-serif"; ctx.fillText(money(grand), cx, cy - 5);
    ctx.fillStyle = cssVar("--text-muted", "#888"); ctx.font = "500 11px -apple-system, sans-serif";
    ctx.fillText("Total spent", cx, cy + 13);
  }
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v || fallback;
  }

  // ---------- Transactions ----------
  function sortEntries(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (a.createdAt || "") < (b.createdAt || "") ? 1 : -1;
  }

  var txFilter = { type: "all", accountId: "all" };

  function renderTransactions() {
    var el = $("#view-transactions");
    var paymentAccts = FD.state.accounts.filter(function (a) { return !a.archived; });

    el.innerHTML =
      '<div class="card">' +
        '<div class="card-head">' +
          '<h2>Transaction Ledger</h2>' +
          '<div class="toolbar">' +
            '<select id="f-type"><option value="all">All types</option><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></select>' +
            '<select id="f-account"><option value="all">All accounts</option>' +
              paymentAccts.map(function (a) { return '<option value="' + a.id + '">' + escapeHTML(a.icon + " " + a.name) + "</option>"; }).join("") +
            '</select>' +
            '<button class="btn btn-ghost btn-sm" id="export-btn">Export CSV</button>' +
            '<button class="btn btn-ghost btn-sm" id="import-btn">Import CSV</button>' +
            '<input type="file" id="import-input" accept=".csv,text/csv" hidden />' +
          '</div>' +
        '</div>' +
        '<div id="tx-list-wrap"></div>' +
      '</div>';

    $("#f-type").value = txFilter.type;
    $("#f-account").value = txFilter.accountId;
    $("#f-type").addEventListener("change", function () { txFilter.type = this.value; renderTxList(); });
    $("#f-account").addEventListener("change", function () { txFilter.accountId = this.value; renderTxList(); });
    $("#export-btn").addEventListener("click", exportCSV);
    $("#import-btn").addEventListener("click", function () { $("#import-input").click(); });
    $("#import-input").addEventListener("change", handleImportFile);

    renderTxList();
  }

  function passesFilter(e) {
    if (txFilter.type !== "all" && e.kind !== txFilter.type) return false;
    if (txFilter.accountId !== "all" && !e.lines.some(function (l) { return l.accountId === txFilter.accountId; })) return false;
    return true;
  }

  function renderTxList() {
    var wrap = $("#tx-list-wrap");
    var entries = FD.state.journal.filter(passesFilter).sort(sortEntries);
    if (!entries.length) {
      wrap.innerHTML = '<div class="empty-state">No transactions match. Tap “+ New” to add one.</div>';
      return;
    }
    // Group by date.
    var groups = [];
    var byDate = {};
    entries.forEach(function (e) {
      if (!byDate[e.date]) { byDate[e.date] = []; groups.push(e.date); }
      byDate[e.date].push(e);
    });
    var frag = document.createElement("div");
    groups.forEach(function (date) {
      var g = document.createElement("div");
      g.className = "date-group";
      var label = document.createElement("div");
      label.className = "date-group-label";
      label.textContent = fmtDateShort(date);
      g.appendChild(label);
      var ul = document.createElement("ul");
      ul.className = "tx-list";
      byDate[date].forEach(function (e) { ul.appendChild(txRow(e)); });
      g.appendChild(ul);
      frag.appendChild(g);
    });
    wrap.innerHTML = "";
    wrap.appendChild(frag);
  }

  function txRow(entry) {
    var d = FD.describeEntry(entry);
    var li = document.createElement("li");
    li.className = "tx-item";
    li.tabIndex = 0;

    var icon = "📦", title = entry.description || "", sub = "", amountCls = "transfer", sign = "";
    if (d.kind === "expense") {
      var cat = FD.getAccount(d.categoryId), pay = FD.getAccount(d.paymentId);
      icon = cat ? cat.icon : "📦";
      title = entry.description || (cat ? cat.name : "Expense");
      sub = (cat ? cat.name : "") + " · " + (pay ? pay.name : "");
      amountCls = "expense"; sign = "−";
    } else if (d.kind === "income") {
      var inc = FD.getAccount(d.categoryId), dep = FD.getAccount(d.depositId);
      icon = inc ? inc.icon : "➕";
      title = entry.description || (inc ? inc.name : "Income");
      sub = (inc ? inc.name : "") + " · " + (dep ? dep.name : "");
      amountCls = "income"; sign = "+";
    } else if (d.kind === "transfer") {
      var from = FD.getAccount(d.fromId), to = FD.getAccount(d.toId);
      icon = "⇄";
      title = entry.description || "Transfer";
      sub = (from ? from.name : "") + " → " + (to ? to.name : "");
      amountCls = "transfer"; sign = "";
    } else {
      icon = "📘"; title = entry.description || "Journal entry"; sub = (entry.kind || "journal");
      amountCls = "transfer";
    }

    li.innerHTML =
      '<div class="tx-icon">' + icon + "</div>" +
      '<div class="tx-body"><div class="tx-desc"></div><div class="tx-meta"></div></div>' +
      '<div class="tx-right"><div class="tx-amount ' + amountCls + '">' + sign + money(d.amount) + "</div>" +
      '<div class="tx-tag">' + escapeHTML(d.kind) + "</div></div>";
    $(".tx-desc", li).textContent = title;
    $(".tx-meta", li).textContent = sub;

    if (d.kind === "expense" || d.kind === "income" || d.kind === "transfer") {
      li.addEventListener("click", function () { openTxDialog(entry.id); });
      li.addEventListener("keydown", function (ev) { if (ev.key === "Enter") openTxDialog(entry.id); });
    }
    return li;
  }

  // ---------- Accounts ----------
  function renderAccounts() {
    var el = $("#view-accounts");
    var j = FD.state.journal;
    var today = todayISO();
    var order = ["asset", "liability", "equity", "income", "expense"];

    var html = '<div class="card-head" style="margin-bottom:4px"><h2>Chart of Accounts</h2><button class="btn btn-primary btn-sm" id="add-account">+ Add account</button></div>';

    order.forEach(function (type) {
      var list = FD.state.accounts.filter(function (a) { return a.type === type; });
      if (!list.length) return;
      var total = list.reduce(function (s, a) { return s + FD.balance(j, a, { to: today }); }, 0);
      html += '<div class="card acct-group">';
      html += '<div class="acct-group-head"><h3>' + FD.TYPES[type].plural + '</h3><span class="acct-group-total">' + money(total) + "</span></div>";
      list.forEach(function (a) {
        var bal = FD.balance(j, a, { to: today });
        html += '<div class="acct-row" data-id="' + a.id + '">' +
          '<div class="acct-ico">' + a.icon + "</div>" +
          '<div class="acct-name">' + escapeHTML(a.name) + (a.archived ? '<span class="archived-note">archived</span>' : "") + "</div>" +
          '<div class="acct-bal">' + money(bal) + "</div></div>";
      });
      html += "</div>";
    });

    el.innerHTML = html;
    $("#add-account").addEventListener("click", function () { openAccountDialog(null); });
    $all(".acct-row", el).forEach(function (row) {
      row.addEventListener("click", function () { openAccountDialog(row.dataset.id); });
    });
  }

  // ---------- Budgets ----------
  function renderBudgets() {
    var el = $("#view-budgets");
    var mr = monthRange(new Date().getFullYear(), new Date().getMonth());
    var expenses = FD.accountsByType(FD.state.accounts, "expense");

    var rows = expenses.map(function (a) {
      var limit = Number(FD.state.budgets[a.id]) || 0;
      var used = FD.balance(FD.state.journal, a, { from: mr.from, to: mr.to });
      var pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
      var fill = "";
      if (limit > 0) { if (used > limit) fill = "over"; else if (used / limit >= 0.8) fill = "warn"; }
      var spentText = limit > 0
        ? money(used) + " of " + money(limit) + (used > limit ? " · over by " + money(used - limit) : "")
        : money(used) + " spent";
      return '<li class="budget-row">' +
        '<div class="budget-top">' +
          '<span class="budget-name"><span>' + a.icon + '</span><span>' + escapeHTML(a.name) + "</span></span>" +
          '<span class="budget-spent' + (limit > 0 && used > limit ? " over" : "") + '">' + spentText + "</span>" +
          '<input class="budget-input" type="number" min="0" step="1" placeholder="No limit" data-id="' + a.id + '"' + (limit > 0 ? ' value="' + limit + '"' : "") + " /></div>" +
        '<div class="budget-bar"><div class="budget-fill ' + fill + '" style="width:' + pct + '%"></div></div>' +
        "</li>";
    }).join("");

    el.innerHTML = '<div class="card"><div class="card-head"><h2>Monthly Budgets</h2><span class="muted">' + monthLabel() + "</span></div>" +
      '<p class="section-hint">Set a monthly limit per expense category. Progress reflects this month\'s spending.</p>' +
      '<ul class="budget-list">' + rows + "</ul></div>";

    $all(".budget-input", el).forEach(function (input) {
      input.addEventListener("change", function () {
        FD.setBudget(input.dataset.id, input.value);
        renderBudgets();
      });
    });
  }

  // ---------- Reports ----------
  function renderReports() {
    var el = $("#view-reports");
    el.innerHTML =
      '<div class="card">' +
        '<div class="report-controls">' +
          '<select id="r-type"><option value="pl">Profit &amp; Loss</option><option value="bs">Balance Sheet</option></select>' +
          '<span id="r-period-wrap"></span>' +
        '</div>' +
        '<div id="report-body" style="margin-top:16px"></div>' +
      '</div>';
    $("#r-type").value = report.type;
    $("#r-type").addEventListener("change", function () { report.type = this.value; renderReportControls(); renderReportBody(); });
    renderReportControls();
    renderReportBody();
  }

  function renderReportControls() {
    var wrap = $("#r-period-wrap");
    if (report.type === "pl") {
      wrap.innerHTML =
        '<select id="r-period">' +
          '<option value="this-month">This month</option>' +
          '<option value="last-month">Last month</option>' +
          '<option value="this-year">This year</option>' +
          '<option value="last-year">Last year</option>' +
          '<option value="all">All time</option>' +
          '<option value="custom">Custom…</option>' +
        '</select>' +
        '<span id="r-custom" style="display:none;gap:8px"><input type="date" id="r-from" /><input type="date" id="r-to" /></span>';
      $("#r-period").value = report.period;
      var custom = $("#r-custom");
      custom.style.display = report.period === "custom" ? "inline-flex" : "none";
      if (report.from) $("#r-from").value = report.from;
      if (report.to) $("#r-to").value = report.to;
      $("#r-period").addEventListener("change", function () {
        report.period = this.value;
        custom.style.display = report.period === "custom" ? "inline-flex" : "none";
        renderReportBody();
      });
      $("#r-from").addEventListener("change", function () { report.from = this.value; renderReportBody(); });
      $("#r-to").addEventListener("change", function () { report.to = this.value; renderReportBody(); });
    } else {
      wrap.innerHTML = '<label class="muted" style="display:inline-flex;align-items:center;gap:8px">As of <input type="date" id="r-asof" /></label>';
      $("#r-asof").value = report.asOf || todayISO();
      $("#r-asof").addEventListener("change", function () { report.asOf = this.value; renderReportBody(); });
    }
  }

  function resolvePeriod() {
    var now = new Date(), y = now.getFullYear(), m = now.getMonth();
    switch (report.period) {
      case "this-month": return monthRange(y, m);
      case "last-month": return m === 0 ? monthRange(y - 1, 11) : monthRange(y, m - 1);
      case "this-year": return { from: y + "-01-01", to: y + "-12-31" };
      case "last-year": return { from: (y - 1) + "-01-01", to: (y - 1) + "-12-31" };
      case "all": return { from: null, to: todayISO() };
      case "custom": return { from: report.from || null, to: report.to || todayISO() };
      default: return monthRange(y, m);
    }
  }

  function renderReportBody() {
    var body = $("#report-body");
    if (report.type === "pl") body.innerHTML = renderPL();
    else body.innerHTML = renderBS();
  }

  function periodLabel(p) {
    var fromTxt = p.from ? fmtDate(p.from) : "the beginning";
    return fromTxt + " – " + fmtDate(p.to);
  }

  function renderPL() {
    var p = resolvePeriod();
    var r = FD.profitAndLoss(FD.state.journal, FD.state.accounts, p.from, p.to);
    var incomeRows = r.income.filter(function (x) { return Math.abs(x.amount) > 0.005; });
    var expenseRows = r.expense.filter(function (x) { return Math.abs(x.amount) > 0.005; });

    function lines(rows) {
      if (!rows.length) return '<div class="report-line"><span class="r-name muted">None</span><span class="r-amt tabular">—</span></div>';
      return rows.map(function (x) {
        return '<div class="report-line"><span class="r-name">' + escapeHTML(x.account.icon + " " + x.account.name) + '</span><span class="r-amt tabular">' + money(x.amount) + "</span></div>";
      }).join("");
    }

    return '<div class="report">' +
      '<div class="report-title"><h3>Profit &amp; Loss</h3><div class="muted">' + periodLabel(p) + "</div></div>" +
      '<div class="report-section-head">Income</div>' + lines(incomeRows) +
      '<div class="report-subtotal"><span>Total Income</span><span class="tabular">' + money(r.totalIncome) + "</span></div>" +
      '<div class="report-section-head">Expenses</div>' + lines(expenseRows) +
      '<div class="report-subtotal"><span>Total Expenses</span><span class="tabular">' + money(r.totalExpense) + "</span></div>" +
      '<div class="report-total ' + (r.netIncome >= 0 ? "pos" : "neg") + '"><span>Net ' + (r.netIncome >= 0 ? "Income" : "Loss") + '</span><span class="tabular">' + signedMoney(r.netIncome) + "</span></div>" +
      "</div>";
  }

  function renderBS() {
    var asOf = report.asOf || todayISO();
    var r = FD.balanceSheet(FD.state.journal, FD.state.accounts, asOf);

    function lines(rows) {
      var visible = rows.filter(function (x) { return Math.abs(x.amount) > 0.005; });
      if (!visible.length) return '<div class="report-line"><span class="r-name muted">None</span><span class="r-amt tabular">—</span></div>';
      return visible.map(function (x) {
        return '<div class="report-line"><span class="r-name">' + escapeHTML(x.account.icon + " " + x.account.name) + '</span><span class="r-amt tabular">' + money(x.amount) + "</span></div>";
      }).join("");
    }

    var equityLines = lines(r.equityAccounts) +
      '<div class="report-line"><span class="r-name">📊 Retained Earnings (Net Income)</span><span class="r-amt tabular">' + money(r.netIncome) + "</span></div>";

    return '<div class="report">' +
      '<div class="report-title"><h3>Balance Sheet</h3><div class="muted">As of ' + fmtDate(asOf) + "</div></div>" +
      '<div class="report-section-head">Assets</div>' + lines(r.assets) +
      '<div class="report-subtotal"><span>Total Assets</span><span class="tabular">' + money(r.totalAssets) + "</span></div>" +
      '<div class="report-section-head">Liabilities</div>' + lines(r.liabilities) +
      '<div class="report-subtotal"><span>Total Liabilities</span><span class="tabular">' + money(r.totalLiabilities) + "</span></div>" +
      '<div class="report-section-head">Equity</div>' + equityLines +
      '<div class="report-subtotal"><span>Total Equity</span><span class="tabular">' + money(r.totalEquity) + "</span></div>" +
      '<div class="report-total"><span>Liabilities + Equity</span><span class="tabular">' + money(r.totalLiabilitiesAndEquity) + "</span></div>" +
      '<div class="report-check ' + (r.balanced ? "ok" : "bad") + '">' + (r.balanced ? "✓ In balance — Assets = Liabilities + Equity" : "⚠ Out of balance by " + money(r.totalAssets - r.totalLiabilitiesAndEquity)) + "</div>" +
      "</div>";
  }

  // ---------- Transaction dialog ----------
  var txDialog, accountDialog;

  function optionList(accounts, selectedId) {
    return accounts.map(function (a) {
      return '<option value="' + a.id + '"' + (a.id === selectedId ? " selected" : "") + ">" + escapeHTML(a.icon + " " + a.name) + "</option>";
    }).join("");
  }

  function currentKind() {
    var checked = $('input[name="tx-kind"]:checked');
    return checked ? checked.value : "expense";
  }

  function populateTxSelects(kind, primaryId, secondaryId) {
    var accts = FD.state.accounts.filter(function (a) { return !a.archived; });
    var assets = accts.filter(function (a) { return a.type === "asset"; });
    var payment = accts.filter(function (a) { return a.type === "asset" || a.type === "liability"; });
    var income = accts.filter(function (a) { return a.type === "income"; });
    var expense = accts.filter(function (a) { return a.type === "expense"; });

    var primary = $("#tx-primary"), secondary = $("#tx-secondary");
    if (kind === "expense") {
      $("#tx-primary-label").textContent = "Category";
      $("#tx-secondary-label").textContent = "Paid from";
      primary.innerHTML = optionList(expense, primaryId);
      secondary.innerHTML = optionList(payment, secondaryId);
    } else if (kind === "income") {
      $("#tx-primary-label").textContent = "Category";
      $("#tx-secondary-label").textContent = "Deposit to";
      primary.innerHTML = optionList(income, primaryId);
      secondary.innerHTML = optionList(assets, secondaryId);
    } else {
      $("#tx-primary-label").textContent = "From";
      $("#tx-secondary-label").textContent = "To";
      primary.innerHTML = optionList(payment, primaryId);
      secondary.innerHTML = optionList(payment, secondaryId);
    }
  }

  function openTxDialog(editId) {
    $("#tx-edit-id").value = editId || "";
    $("#tx-delete").hidden = !editId;
    $("#tx-dialog-title").textContent = editId ? "Edit Transaction" : "New Transaction";

    if (editId) {
      var entry = FD.state.journal.find(function (e) { return e.id === editId; });
      var d = FD.describeEntry(entry);
      var kind = d.kind === "opening" || d.generic ? "transfer" : d.kind;
      $('input[name="tx-kind"][value="' + kind + '"]').checked = true;
      $("#tx-desc").value = entry.description || "";
      $("#tx-amount").value = d.amount;
      $("#tx-date").value = entry.date;
      if (kind === "expense") populateTxSelects(kind, d.categoryId, d.paymentId);
      else if (kind === "income") populateTxSelects(kind, d.categoryId, d.depositId);
      else populateTxSelects(kind, d.fromId, d.toId);
    } else {
      $("#tx-form").reset();
      $('input[name="tx-kind"][value="expense"]').checked = true;
      $("#tx-date").value = todayISO();
      populateTxSelects("expense");
    }
    txDialog.showModal();
    setTimeout(function () { $("#tx-amount").focus(); }, 30);
  }

  function submitTx(ev) {
    ev.preventDefault();
    var kind = currentKind();
    var amount = parseFloat($("#tx-amount").value);
    if (!(amount > 0)) return;
    var date = $("#tx-date").value || todayISO();
    var desc = $("#tx-desc").value.trim();
    var primary = $("#tx-primary").value, secondary = $("#tx-secondary").value;

    var lines;
    if (kind === "expense") lines = FD.buildExpense({ amount: amount, categoryId: primary, paymentId: secondary });
    else if (kind === "income") lines = FD.buildIncome({ amount: amount, categoryId: primary, depositId: secondary });
    else {
      if (primary === secondary) { alert("Choose two different accounts for a transfer."); return; }
      lines = FD.buildTransfer({ amount: amount, fromId: primary, toId: secondary });
    }

    var editId = $("#tx-edit-id").value;
    if (editId) FD.updateEntry(editId, { date: date, description: desc, kind: kind, lines: lines });
    else FD.addEntry({ date: date, description: desc, kind: kind, lines: lines });

    txDialog.close();
    refresh();
  }

  function deleteTx() {
    var editId = $("#tx-edit-id").value;
    if (!editId) return;
    if (!confirm("Delete this transaction?")) return;
    FD.deleteEntry(editId);
    txDialog.close();
    refresh();
  }

  // ---------- Account dialog ----------
  function updateAccountDialogForType() {
    var type = $("#acct-type").value;
    var showOpening = type === "asset" || type === "liability";
    $("#acct-opening-wrap").style.display = showOpening ? "" : "none";
    var hints = {
      asset: "Things you own — bank accounts, cash, investments, property.",
      liability: "Things you owe — credit cards, loans, mortgage.",
      income: "A source of income to categorize deposits.",
      expense: "A spending category for your expenses.",
      equity: "Owner's equity / net worth accounts.",
    };
    $("#acct-type-hint").textContent = hints[type] || "";
  }

  function openAccountDialog(editId) {
    $("#acct-edit-id").value = editId || "";
    $("#account-form").reset();
    var typeSel = $("#acct-type");
    var del = $("#acct-delete");

    if (editId) {
      var a = FD.getAccount(editId);
      $("#account-dialog-title").textContent = "Edit Account";
      $("#acct-name").value = a.name;
      $("#acct-icon").value = a.icon;
      typeSel.value = a.type;
      typeSel.disabled = true; // type is fixed after creation
      var hasEntries = FD.accountHasEntries(editId);
      del.hidden = false;
      del.disabled = hasEntries;
      del.textContent = hasEntries ? "In use — can't delete" : "Delete";
    } else {
      $("#account-dialog-title").textContent = "New Account";
      typeSel.disabled = false;
      typeSel.value = "asset";
      $("#acct-opening-date").value = todayISO();
      del.hidden = true;
    }
    updateAccountDialogForType();
    accountDialog.showModal();
    setTimeout(function () { $("#acct-name").focus(); }, 30);
  }

  function submitAccount(ev) {
    ev.preventDefault();
    var name = $("#acct-name").value.trim();
    if (!name) return;
    var editId = $("#acct-edit-id").value;
    if (editId) {
      FD.updateAccount(editId, { name: name, icon: $("#acct-icon").value.trim() });
    } else {
      FD.addAccount({
        name: name,
        type: $("#acct-type").value,
        icon: $("#acct-icon").value.trim(),
        opening: parseFloat($("#acct-opening").value) || 0,
        openingDate: $("#acct-opening-date").value || todayISO(),
      });
    }
    accountDialog.close();
    refresh();
  }

  function deleteAccount() {
    var editId = $("#acct-edit-id").value;
    if (!editId) return;
    if (FD.accountHasEntries(editId)) return;
    if (!confirm("Delete this account?")) return;
    FD.deleteAccount(editId);
    accountDialog.close();
    refresh();
  }

  // ---------- CSV ----------
  function csvEscape(f) {
    var s = String(f == null ? "" : f);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV() {
    var j = FD.state.journal.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var friendly = j.filter(function (e) { return e.kind === "expense" || e.kind === "income" || e.kind === "transfer"; });
    if (!friendly.length) { alert("No transactions to export."); return; }
    var header = ["date", "type", "description", "amount", "category", "account"];
    var rows = friendly.map(function (e) {
      var d = FD.describeEntry(e);
      var category = "", account = "";
      if (d.kind === "expense") { category = nameOf(d.categoryId); account = nameOf(d.paymentId); }
      else if (d.kind === "income") { category = nameOf(d.categoryId); account = nameOf(d.depositId); }
      else { category = nameOf(d.fromId); account = nameOf(d.toId); }
      return [e.date, d.kind, e.description, d.amount, category, account].map(csvEscape).join(",");
    });
    var csv = [header.join(","), rows.join("\n")].join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "finance-desk-" + currentMonthKey() + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function nameOf(id) { var a = FD.getAccount(id); return a ? a.name : ""; }

  function parseCSV(text) {
    var rows = [], row = [], field = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); field = ""; rows.push(row); row = []; }
      else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length && r.some(function (v) { return v.trim() !== ""; }); });
  }

  function findAccountByName(name, types) {
    var lower = String(name || "").trim().toLowerCase();
    return FD.state.accounts.find(function (a) {
      return types.indexOf(a.type) !== -1 && a.name.toLowerCase() === lower;
    });
  }

  function importCSV(text) {
    var rows = parseCSV(text);
    if (!rows.length) { alert("The CSV file is empty."); return; }
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var idx = {
      date: head.indexOf("date"), type: head.indexOf("type"), description: head.indexOf("description"),
      amount: head.indexOf("amount"), category: head.indexOf("category"), account: head.indexOf("account"),
    };
    var start = idx.date !== -1 && idx.amount !== -1 ? 1 : 0;
    if (start === 0) { idx = { date: 0, type: 1, description: 2, amount: 3, category: 4, account: 5 }; }

    var added = 0, skipped = 0;
    for (var i = start; i < rows.length; i++) {
      var r = rows[i];
      var date = (r[idx.date] || "").trim();
      var amount = parseFloat(r[idx.amount]);
      var type = (r[idx.type] || "expense").trim().toLowerCase();
      if (!(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
      var desc = (r[idx.description] || "").trim();
      var catName = (r[idx.category] || "").trim();
      var acctName = (r[idx.account] || "").trim();

      if (type === "income") {
        var inc = findAccountByName(catName, ["income"]) || FD.getAccount("inc-other");
        var dep = findAccountByName(acctName, ["asset"]) || FD.getAccount("checking");
        FD.addEntry({ date: date, description: desc, kind: "income", lines: FD.buildIncome({ amount: amount, categoryId: inc.id, depositId: dep.id }) });
        added++;
      } else if (type === "transfer") {
        var from = findAccountByName(catName, ["asset", "liability"]);
        var to = findAccountByName(acctName, ["asset", "liability"]);
        if (!from || !to || from.id === to.id) { skipped++; continue; }
        FD.addEntry({ date: date, description: desc, kind: "transfer", lines: FD.buildTransfer({ amount: amount, fromId: from.id, toId: to.id }) });
        added++;
      } else {
        var cat = findAccountByName(catName, ["expense"]) || FD.getAccount("exp-other");
        var pay = findAccountByName(acctName, ["asset", "liability"]) || FD.getAccount("checking");
        FD.addEntry({ date: date, description: desc, kind: "expense", lines: FD.buildExpense({ amount: amount, categoryId: cat.id, paymentId: pay.id }) });
        added++;
      }
    }
    refresh();
    alert("Imported " + added + " transaction" + (added === 1 ? "" : "s") + "." + (skipped ? " Skipped " + skipped + " invalid row" + (skipped === 1 ? "" : "s") + "." : ""));
  }

  function handleImportFile(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { importCSV(String(reader.result)); };
    reader.onerror = function () { alert("Could not read the file."); };
    reader.readAsText(file);
    ev.target.value = "";
  }

  // ---------- Theme ----------
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var label = theme === "dark" ? "☀️" : "🌙";
    $("#theme-toggle").textContent = label;
    var mt = $("#menu-theme"); if (mt) mt.textContent = label;
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    applyTheme(cur === "dark" ? "light" : "dark");
    refresh(); // redraw charts with new colors
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(saved || (prefersDark ? "dark" : "light"));
  }

  // ---------- Wire up ----------
  function bindDialogs() {
    txDialog = $("#tx-dialog");
    accountDialog = $("#account-dialog");

    $("#tx-form").addEventListener("submit", submitTx);
    $("#tx-delete").addEventListener("click", deleteTx);
    $all('input[name="tx-kind"]').forEach(function (r) {
      r.addEventListener("change", function () { populateTxSelects(currentKind()); });
    });

    $("#account-form").addEventListener("submit", submitAccount);
    $("#acct-delete").addEventListener("click", deleteAccount);
    $("#acct-type").addEventListener("change", updateAccountDialogForType);

    $all("[data-close]").forEach(function (btn) {
      btn.addEventListener("click", function () { btn.closest("dialog").close(); });
    });
  }

  function init() {
    FD.init();
    initTheme();
    bindDialogs();

    $("#new-tx-btn").addEventListener("click", function () { openTxDialog(null); });
    $("#new-tx-tab").addEventListener("click", function () { openTxDialog(null); });
    $("#theme-toggle").addEventListener("click", toggleTheme);
    var mt = $("#menu-theme"); if (mt) mt.addEventListener("click", toggleTheme);

    window.addEventListener("hashchange", navigate);
    if (!location.hash) location.hash = "#dashboard";
    navigate();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
