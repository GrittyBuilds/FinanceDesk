/* Finance Desk — UI layer. Depends on store.js (window.FD). */
(function () {
  "use strict";

  var FD = window.FD;
  var THEME_KEY = FD.KEYS.theme;

  var CHART_COLORS = [
    "#0E7A6E", "#F4B740", "#e5484d", "#1fae7a", "#9b59b6",
    "#00bcd4", "#ff6f91", "#8bc34a", "#795548", "#5c6bc0",
  ];

  var report = { type: "pl", period: "this-month", from: null, to: null, asOf: null, compare: false, compareAsOf: null };
  var txFilter = { type: "all", accountId: "all", tag: "all", q: "" };
  var acctView = { id: null };     // when set, Accounts shows that account's register
  var txSplitMode = false;
  var pendingAttachment; // undefined = unchanged, null = remove, object = new attachment

  // ---------- helpers ----------
  function $(s, c) { return (c || document).querySelector(s); }
  function $all(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function money(v) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v || 0); }
  function signedMoney(v) { var s = money(Math.abs(v)); return v < 0 ? "(" + s + ")" : s; }
  function fmtDate(iso) { return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  function fmtDateShort(iso) { return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function currentMonthKey() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function monthLabel() { return new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }); }
  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function monthRange(y, m) {
    var last = new Date(y, m + 1, 0).getDate();
    return { from: y + "-" + pad(m + 1) + "-01", to: y + "-" + pad(m + 1) + "-" + pad(last) };
  }

  // Options for a select, ordering parents then indented children.
  function hierOptions(list, selectedId) {
    var ids = {}; list.forEach(function (a) { ids[a.id] = true; });
    var byParent = {}, tops = [];
    list.forEach(function (a) {
      if (a.parentId && ids[a.parentId]) { (byParent[a.parentId] = byParent[a.parentId] || []).push(a); }
      else tops.push(a);
    });
    var out = [];
    function opt(a, depth) {
      var prefix = depth ? "  ↳ " : "";
      out.push('<option value="' + a.id + '"' + (a.id === selectedId ? " selected" : "") + ">" + escapeHTML(prefix + a.icon + " " + a.name) + "</option>");
    }
    tops.forEach(function (p) { opt(p, 0); (byParent[p.id] || []).forEach(function (c) { opt(c, 1); }); });
    return out.join("");
  }
  function nonArchived() { return FD.state.accounts.filter(function (a) { return !a.archived; }); }
  function byType(t) { return nonArchived().filter(function (a) { return a.type === t; }); }
  function paymentAccts() { return nonArchived().filter(function (a) { return a.type === "asset" || a.type === "liability"; }); }

  // ---------- Router ----------
  var VIEWS = ["dashboard", "transactions", "reports", "accounts", "budgets", "settings"];
  var TITLES = { dashboard: "Dashboard", transactions: "Transactions", reports: "Reports", accounts: "Accounts", budgets: "Budgets", settings: "Settings" };

  function navigate() {
    var view = (location.hash || "#dashboard").slice(1);
    if (VIEWS.indexOf(view) === -1) view = "dashboard";
    if (view === "accounts") acctView.id = null; // nav to Accounts always shows the chart
    VIEWS.forEach(function (v) { var s = $("#view-" + v); if (s) s.hidden = v !== view; });
    $all(".nav-link, .tab").forEach(function (a) { if (a.dataset.view) a.classList.toggle("active", a.dataset.view === view); });
    $("#page-title").textContent = TITLES[view];
    renderView(view);
    window.scrollTo(0, 0);
  }
  function renderView(view) {
    ({ dashboard: renderDashboard, transactions: renderTransactions, reports: renderReports,
       accounts: renderAccounts, budgets: renderBudgets, settings: renderSettings }[view] || function () {})();
  }
  function refresh() {
    var view = (location.hash || "#dashboard").slice(1);
    if (VIEWS.indexOf(view) === -1) view = "dashboard";
    renderView(view);
  }

  // ---------- Dashboard ----------
  function renderDashboard() {
    var el = $("#view-dashboard"), j = FD.state.journal, accts = FD.state.accounts, today = todayISO();
    var totalAssets = byType("asset").reduce(function (s, a) { return s + FD.balance(j, a, { to: today }); }, 0);
    var totalLiab = byType("liability").reduce(function (s, a) { return s + FD.balance(j, a, { to: today }); }, 0);
    var netWorth = FD.round2(totalAssets - totalLiab);
    var mr = monthRange(new Date().getFullYear(), new Date().getMonth());
    var pl = FD.profitAndLoss(j, accts, mr.from, mr.to);

    el.innerHTML =
      '<div class="tiles">' +
        tile("Net Worth", money(netWorth), "Assets − Liabilities", netWorth >= 0 ? "pos" : "neg") +
        tile("Income this month", money(pl.totalIncome), monthLabel(), "pos") +
        tile("Expenses this month", money(pl.totalExpense), monthLabel(), "neg") +
        tile("Net this month", signedMoney(pl.netIncome), pl.netIncome >= 0 ? "Surplus" : "Deficit", pl.netIncome >= 0 ? "pos" : "neg") +
      "</div>" +
      '<div class="card"><h2>Net worth <span class="muted" style="font-weight:400;font-size:0.85rem">· last 12 months</span></h2><div id="nw-chart" class="trend-wrap"></div></div>' +
      '<div class="card"><h2>Income vs expenses <span class="muted" style="font-weight:400;font-size:0.85rem">· last 12 months</span></h2><div id="ie-chart" class="trend-wrap"></div></div>' +
      '<div class="dash-grid">' +
        '<div class="card"><h2>Spending this month</h2><div id="dash-chart-wrap"></div></div>' +
        '<div class="card"><div class="card-head"><h2>Recent activity</h2><a href="#transactions" class="btn btn-ghost btn-sm">View all</a></div><ul class="tx-list" id="dash-recent"></ul><div id="dash-recent-empty" class="empty-state" hidden>No transactions yet.</div></div>' +
      "</div>";
    renderDonut($("#dash-chart-wrap"), mr.from, mr.to);
    renderNetWorthTrend($("#nw-chart"));
    renderIncomeExpenseTrend($("#ie-chart"));
    var entries = FD.state.journal.slice().sort(sortEntries).slice(0, 6);
    var list = $("#dash-recent"); $("#dash-recent-empty").hidden = entries.length > 0;
    entries.forEach(function (e) { list.appendChild(txRow(e)); });
  }

  // ----- Trend charts (canvas, last 12 months) -----
  function last12Months() {
    var arr = [], now = new Date();
    for (var i = 11; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1), y = d.getFullYear(), m = d.getMonth(), r = monthRange(y, m);
      arr.push({ label: d.toLocaleDateString("en-US", { month: "short" }), from: r.from, to: r.to });
    }
    return arr;
  }
  function shortMoney(v) {
    var a = Math.abs(v);
    if (a >= 1000) return (v < 0 ? "−$" : "$") + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + "k";
    return (v < 0 ? "−$" : "$") + a.toFixed(0);
  }
  function makeCanvas(wrap, h) {
    var w = Math.max(260, Math.min(wrap.clientWidth || 600, 900)), dpr = window.devicePixelRatio || 1;
    wrap.innerHTML = "";
    var c = document.createElement("canvas");
    c.width = w * dpr; c.height = h * dpr; c.style.width = w + "px"; c.style.height = h + "px";
    wrap.appendChild(c);
    var ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
    return { ctx: ctx, w: w, h: h };
  }
  function renderNetWorthTrend(wrap) {
    var j = FD.state.journal, accts = FD.state.accounts, months = last12Months();
    function nwAt(to) {
      var a = FD.accountsByType(accts, "asset").reduce(function (s, x) { return s + FD.balance(j, x, { to: to }); }, 0);
      var l = FD.accountsByType(accts, "liability").reduce(function (s, x) { return s + FD.balance(j, x, { to: to }); }, 0);
      return FD.round2(a - l);
    }
    var vals = months.map(function (m) { return nwAt(m.to); });
    if (vals.every(function (v) { return Math.abs(v) < 0.005; })) { wrap.innerHTML = '<div class="empty-state">No balances yet.</div>'; return; }
    var g = makeCanvas(wrap, 200), ctx = g.ctx, padL = 52, padR = 12, padT = 14, padB = 22;
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max.apply(null, vals); if (hi === lo) hi = lo + 1;
    var plotW = g.w - padL - padR, plotH = g.h - padT - padB;
    function X(i) { return padL + (months.length === 1 ? plotW / 2 : (i / (months.length - 1)) * plotW); }
    function Y(v) { return padT + plotH - ((v - lo) / (hi - lo)) * plotH; }
    var grid = cssVar("--border", "#ddd"), muted = cssVar("--text-muted", "#888"), primary = cssVar("--primary", "#0E7A6E");
    ctx.strokeStyle = grid; ctx.fillStyle = muted; ctx.font = "10px -apple-system, sans-serif"; ctx.textBaseline = "middle";
    [hi, (hi + lo) / 2, lo].forEach(function (v) { var y = Y(v); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(g.w - padR, y); ctx.stroke(); ctx.globalAlpha = 1; ctx.textAlign = "right"; ctx.fillText(shortMoney(v), padL - 6, y); });
    // area + line
    ctx.beginPath(); months.forEach(function (m, i) { var x = X(i), y = Y(vals[i]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.lineTo(X(months.length - 1), Y(lo)); ctx.lineTo(X(0), Y(lo)); ctx.closePath();
    ctx.fillStyle = primary; ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); months.forEach(function (m, i) { var x = X(i), y = Y(vals[i]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.strokeStyle = primary; ctx.lineWidth = 2; ctx.stroke();
    months.forEach(function (m, i) { ctx.beginPath(); ctx.arc(X(i), Y(vals[i]), 2.5, 0, Math.PI * 2); ctx.fillStyle = primary; ctx.fill(); });
    ctx.fillStyle = muted; ctx.textAlign = "center"; ctx.textBaseline = "top";
    months.forEach(function (m, i) { if (i % 2 === 0 || months.length <= 6) ctx.fillText(m.label, X(i), g.h - padB + 6); });
  }
  function renderIncomeExpenseTrend(wrap) {
    var j = FD.state.journal, accts = FD.state.accounts, months = last12Months();
    var data = months.map(function (m) { var pl = FD.profitAndLoss(j, accts, m.from, m.to); return { inc: pl.totalIncome, exp: pl.totalExpense }; });
    var hi = Math.max(1, Math.max.apply(null, data.map(function (d) { return Math.max(d.inc, d.exp); })));
    if (data.every(function (d) { return d.inc < 0.005 && d.exp < 0.005; })) { wrap.innerHTML = '<div class="empty-state">No income or expenses yet.</div>'; return; }
    var g = makeCanvas(wrap, 200), ctx = g.ctx, padL = 52, padR = 12, padT = 14, padB = 22;
    var plotW = g.w - padL - padR, plotH = g.h - padT - padB;
    function Y(v) { return padT + plotH - (v / hi) * plotH; }
    var grid = cssVar("--border", "#ddd"), muted = cssVar("--text-muted", "#888"), inc = cssVar("--income", "#1fae7a"), exp = cssVar("--expense", "#e5484d");
    ctx.strokeStyle = grid; ctx.fillStyle = muted; ctx.font = "10px -apple-system, sans-serif"; ctx.textBaseline = "middle"; ctx.textAlign = "right";
    [hi, hi / 2, 0].forEach(function (v) { var y = Y(v); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(g.w - padR, y); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillText(shortMoney(v), padL - 6, y); });
    var slot = plotW / months.length, bw = Math.min(10, slot / 3);
    months.forEach(function (m, i) {
      var cx = padL + slot * i + slot / 2;
      ctx.fillStyle = inc; ctx.fillRect(cx - bw - 1, Y(data[i].inc), bw, padT + plotH - Y(data[i].inc));
      ctx.fillStyle = exp; ctx.fillRect(cx + 1, Y(data[i].exp), bw, padT + plotH - Y(data[i].exp));
    });
    ctx.fillStyle = muted; ctx.textAlign = "center"; ctx.textBaseline = "top";
    months.forEach(function (m, i) { if (i % 2 === 0 || months.length <= 6) ctx.fillText(m.label, padL + slot * i + slot / 2, g.h - padB + 6); });
    // legend
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = inc; ctx.fillRect(padL, 4, 9, 9); ctx.fillStyle = muted; ctx.fillText("Income", padL + 13, 9);
    ctx.fillStyle = exp; ctx.fillRect(padL + 70, 4, 9, 9); ctx.fillStyle = muted; ctx.fillText("Expenses", padL + 83, 9);
  }
  function tile(label, value, sub, cls) {
    return '<div class="tile"><span class="tile-label">' + escapeHTML(label) + '</span><span class="tile-value ' + (cls || "") + '">' + escapeHTML(value) + '</span><span class="tile-sub">' + escapeHTML(sub) + "</span></div>";
  }

  // Donut of this-month expenses, rolled up to top-level categories.
  function renderDonut(wrap, from, to) {
    var totals = [];
    FD.topLevel(FD.state.accounts, "expense").forEach(function (p) {
      var amt = FD.rolledBalance(FD.state.journal, FD.state.accounts, p, { from: from, to: to });
      if (amt > 0.005) totals.push({ name: p.name, amount: amt });
    });
    totals.sort(function (a, b) { return b.amount - a.amount; });
    var grand = totals.reduce(function (s, e) { return s + e.amount; }, 0);
    if (!totals.length) { wrap.innerHTML = '<div class="empty-state">No expenses recorded this month.</div>'; return; }

    wrap.innerHTML = '<div class="chart-wrap"><canvas id="chart" width="220" height="220"></canvas><ul class="legend" id="chart-legend"></ul></div>';
    var canvas = $("#chart", wrap), legend = $("#chart-legend", wrap), ctx = canvas.getContext("2d");
    var size = canvas.width, cx = size / 2, cy = size / 2, radius = size / 2 - 6, inner = radius * 0.6, start = -Math.PI / 2;
    totals.forEach(function (e, i) {
      var slice = (e.amount / grand) * Math.PI * 2, color = CHART_COLORS[i % CHART_COLORS.length];
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius, start, start + slice); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); start += slice;
      var pct = ((e.amount / grand) * 100).toFixed(0);
      var li = document.createElement("li");
      li.innerHTML = '<span class="dot" style="background:' + color + '"></span><span class="legend-name"></span><span class="legend-amount">' + money(e.amount) + " (" + pct + "%)</span>";
      $(".legend-name", li).textContent = e.name; legend.appendChild(li);
    });
    var surface = cssVar("--surface", "#fff");
    ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2); ctx.fillStyle = surface; ctx.fill();
    ctx.fillStyle = cssVar("--text", "#000"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "600 17px -apple-system, sans-serif"; ctx.fillText(money(grand), cx, cy - 5);
    ctx.fillStyle = cssVar("--text-muted", "#888"); ctx.font = "500 11px -apple-system, sans-serif"; ctx.fillText("Total spent", cx, cy + 13);
  }
  function cssVar(name, fb) { var v = getComputedStyle(document.body).getPropertyValue(name).trim(); return v || fb; }

  // ---------- Transactions ----------
  function sortEntries(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (a.createdAt || "") < (b.createdAt || "") ? 1 : -1;
  }
  var txTab = "ledger";
  function renderTransactions() {
    var el = $("#view-transactions");
    el.innerHTML =
      '<div class="seg tx-tabs" role="tablist">' +
        '<button class="tx-tab' + (txTab === "ledger" ? " active" : "") + '" data-tab="ledger">Ledger</button>' +
        '<button class="tx-tab' + (txTab === "recurring" ? " active" : "") + '" data-tab="recurring">Recurring</button>' +
      '</div><div id="tx-tab-body"></div>';
    $all(".tx-tab", el).forEach(function (b) { b.addEventListener("click", function () { txTab = b.dataset.tab; renderTransactions(); }); });
    if (txTab === "recurring") renderRecurringTab();
    else renderLedgerTab();
  }
  function renderLedgerTab() {
    var tagOpts = FD.allTags().map(function (t) { return '<option value="' + escapeHTML(t) + '">' + escapeHTML(t) + "</option>"; }).join("");
    $("#tx-tab-body").innerHTML =
      '<div class="card"><div class="card-head"><h2>Transaction Ledger</h2><div class="toolbar">' +
        '<input type="search" id="f-search" class="f-search" placeholder="Search description, vendor, tag…" />' +
        '<select id="f-type"><option value="all">All types</option><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></select>' +
        '<select id="f-account"><option value="all">All accounts</option>' + hierOptions(nonArchived(), null) + "</select>" +
        '<select id="f-tag"><option value="all">All tags</option>' + tagOpts + "</select>" +
        '<button class="btn btn-ghost btn-sm" id="export-btn">Export CSV</button>' +
        '<button class="btn btn-ghost btn-sm" id="import-btn">Import CSV</button>' +
        '<input type="file" id="import-input" accept=".csv,text/csv" hidden /></div></div>' +
        '<div id="tx-list-wrap"></div></div>';
    $("#f-type").value = txFilter.type; $("#f-account").value = txFilter.accountId;
    $("#f-tag").value = FD.allTags().some(function (t) { return t === txFilter.tag; }) ? txFilter.tag : "all";
    $("#f-search").value = txFilter.q;
    $("#f-type").addEventListener("change", function () { txFilter.type = this.value; renderTxList(); });
    $("#f-account").addEventListener("change", function () { txFilter.accountId = this.value; renderTxList(); });
    $("#f-tag").addEventListener("change", function () { txFilter.tag = this.value; renderTxList(); });
    $("#f-search").addEventListener("input", function () { txFilter.q = this.value; renderTxList(); });
    $("#export-btn").addEventListener("click", exportCSV);
    $("#import-btn").addEventListener("click", function () { $("#import-input").click(); });
    $("#import-input").addEventListener("change", handleImportFile);
    renderTxList();
  }
  var FREQ_LABEL = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", yearly: "Yearly" };
  function renderRecurringTab() {
    var body = $("#tx-tab-body");
    var rules = FD.state.recurring.slice().sort(function (a, b) { return (a.description || "").localeCompare(b.description || ""); });
    var rowsHtml = rules.map(function (r) {
      var acc = r.kind === "expense" ? FD.getAccount(r.paymentId) : r.kind === "income" ? FD.getAccount(r.depositId) : FD.getAccount(r.fromId);
      var amt = r.split ? (r.splits || []).reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0) : r.amount;
      var next = FD.nextDueDate(r);
      var sub = FREQ_LABEL[r.freq] + " · " + (r.active ? (next ? "next " + fmtDate(next) : "ended") : "paused") + (acc ? " · " + acc.name : "");
      var cls = r.kind === "income" ? "income" : r.kind === "expense" ? "expense" : "transfer";
      return '<li class="tx-item" data-rid="' + r.id + '">' +
        '<div class="tx-icon">' + (r.kind === "income" ? "🔁" : r.kind === "transfer" ? "🔁" : "🔁") + '</div>' +
        '<div class="tx-body"><div class="tx-desc"></div><div class="tx-meta"></div></div>' +
        '<div class="tx-right"><div class="tx-amount ' + cls + '">' + money(amt) + '</div>' +
        '<div class="tx-tag">' + (r.active ? escapeHTML(r.kind) : "paused") + "</div></div>" +
        '<div class="tx-actions"><button class="tx-btn rec-toggle" title="' + (r.active ? "Pause" : "Resume") + '">' + (r.active ? "⏸" : "▶") + '</button>' +
        '<button class="tx-btn rec-del" title="Delete rule">✕</button></div></li>';
    }).join("");
    body.innerHTML = '<div class="card"><div class="card-head"><h2>Recurring</h2><button class="btn btn-primary btn-sm" id="rec-add">+ Add recurring</button></div>' +
      '<p class="section-hint">Rules auto-post their transactions on schedule. Deleting a rule keeps already-posted entries.</p>' +
      (rules.length ? '<ul class="tx-list">' + rowsHtml + "</ul>" : '<div class="empty-state">No recurring transactions yet. Add one, or tick “Repeat” when creating a transaction.</div>') + "</div>";
    rules.forEach(function (r) {
      var li = body.querySelector('.tx-item[data-rid="' + r.id + '"]'); if (!li) return;
      li.querySelector(".tx-desc").textContent = r.description || (FREQ_LABEL[r.freq] + " " + r.kind);
      var acc = r.kind === "expense" ? FD.getAccount(r.paymentId) : r.kind === "income" ? FD.getAccount(r.depositId) : FD.getAccount(r.fromId);
      var amt = r.split ? (r.splits || []).reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0) : r.amount;
      var next = FD.nextDueDate(r);
      li.querySelector(".tx-meta").textContent = FREQ_LABEL[r.freq] + " · " + (r.active ? (next ? "next " + fmtDate(next) : "ended") : "paused") + (acc ? " · " + acc.name : "");
      li.querySelector(".rec-toggle").addEventListener("click", function () { FD.setRecurringActive(r.id, !r.active); if (!r.active) FD.postDueRecurring(todayISO()); renderRecurringTab(); });
      li.querySelector(".rec-del").addEventListener("click", function () { if (confirm("Delete this recurring rule? Already-posted transactions are kept.")) { FD.deleteRecurring(r.id); renderRecurringTab(); } });
    });
    $("#rec-add").addEventListener("click", function () { openTxDialog(null); setTimeout(function () { $("#tx-repeat").value = "monthly"; $("#tx-repeat-until-field").style.display = ""; }, 40); });
  }
  function passesFilter(e) {
    if (txFilter.type !== "all" && e.kind !== txFilter.type) return false;
    if (txFilter.accountId !== "all" && !e.lines.some(function (l) { return l.accountId === txFilter.accountId; })) return false;
    if (txFilter.tag !== "all") {
      var want = txFilter.tag.toLowerCase();
      if (!(e.tags || []).some(function (t) { return t.toLowerCase() === want; })) return false;
    }
    var q = (txFilter.q || "").trim().toLowerCase();
    if (q && searchHaystack(e).indexOf(q) === -1) return false;
    return true;
  }
  // Everything a ledger search should match on: description, vendor, tags, and
  // the names of the accounts/categories the entry touches.
  function searchHaystack(e) {
    var parts = [e.description || "", e.vendor || ""].concat(e.tags || []);
    (e.lines || []).forEach(function (l) { var a = FD.getAccount(l.accountId); if (a) parts.push(a.name); });
    return parts.join(" ").toLowerCase();
  }
  function renderTxList() {
    var wrap = $("#tx-list-wrap"), entries = FD.state.journal.filter(passesFilter).sort(sortEntries);
    if (!entries.length) { wrap.innerHTML = '<div class="empty-state">No transactions match. Tap “+ New” to add one.</div>'; return; }
    var groups = [], byDate = {};
    entries.forEach(function (e) { if (!byDate[e.date]) { byDate[e.date] = []; groups.push(e.date); } byDate[e.date].push(e); });
    var frag = document.createElement("div");
    groups.forEach(function (date) {
      var g = document.createElement("div"); g.className = "date-group";
      var label = document.createElement("div"); label.className = "date-group-label"; label.textContent = fmtDateShort(date); g.appendChild(label);
      var ul = document.createElement("ul"); ul.className = "tx-list";
      byDate[date].forEach(function (e) { ul.appendChild(txRow(e)); }); g.appendChild(ul); frag.appendChild(g);
    });
    wrap.innerHTML = ""; wrap.appendChild(frag);
  }
  function txRow(entry) {
    var d = FD.describeEntry(entry), li = document.createElement("li");
    li.className = "tx-item"; li.tabIndex = 0;
    var icon = "📦", title = entry.description || "", sub = "", amountCls = "transfer", sign = "";
    if (d.kind === "expense") {
      var pay = FD.getAccount(d.paymentId);
      amountCls = "expense"; sign = "−";
      if (d.split) { icon = "🧾"; title = entry.description || "Split expense"; sub = d.splits.length + " categories · " + (pay ? pay.name : ""); }
      else { var cat = FD.getAccount(d.categoryId); icon = cat ? cat.icon : "📦"; title = entry.description || (cat ? cat.name : "Expense"); sub = (cat ? cat.name : "") + " · " + (pay ? pay.name : ""); }
    } else if (d.kind === "income") {
      var dep = FD.getAccount(d.depositId);
      amountCls = "income"; sign = "+";
      if (d.split) { icon = "🧾"; title = entry.description || "Split income"; sub = d.splits.length + " categories · " + (dep ? dep.name : ""); }
      else { var inc = FD.getAccount(d.categoryId); icon = inc ? inc.icon : "➕"; title = entry.description || (inc ? inc.name : "Income"); sub = (inc ? inc.name : "") + " · " + (dep ? dep.name : ""); }
    } else if (d.kind === "transfer") {
      var from = FD.getAccount(d.fromId), to = FD.getAccount(d.toId);
      icon = "⇄"; title = entry.description || "Transfer"; sub = (from ? from.name : "") + " → " + (to ? to.name : "");
    } else { icon = "📘"; title = entry.description || "Journal entry"; sub = entry.kind || "journal"; }

    var clip = FD.getAttachment(entry.id) ? ' <span class="tx-clip" title="Has receipt">📎</span>' : "";
    var chips = "";
    if (entry.vendor) chips += '<span class="chip chip-vendor">🏪 ' + escapeHTML(entry.vendor) + "</span>";
    (entry.tags || []).forEach(function (t) { chips += '<span class="chip">' + escapeHTML(t) + "</span>"; });
    var chipsHtml = chips ? '<div class="tx-chips">' + chips + "</div>" : "";
    li.innerHTML = '<div class="tx-icon">' + escapeHTML(icon) + '</div><div class="tx-body"><div class="tx-desc"></div><div class="tx-meta"></div>' + chipsHtml + "</div>" +
      '<div class="tx-right"><div class="tx-amount ' + amountCls + '">' + sign + money(d.amount) + '</div><div class="tx-tag">' + escapeHTML(d.kind) + clip + "</div></div>";
    $(".tx-desc", li).textContent = title; $(".tx-meta", li).textContent = sub;
    if (d.kind === "expense" || d.kind === "income" || d.kind === "transfer") {
      li.addEventListener("click", function () { openTxDialog(entry.id); });
      li.addEventListener("keydown", function (ev) { if (ev.key === "Enter") openTxDialog(entry.id); });
    }
    return li;
  }

  // ---------- Accounts (chart + register) ----------
  function renderAccounts() {
    if (acctView.id && FD.getAccount(acctView.id)) return renderRegister(acctView.id);
    var el = $("#view-accounts"), j = FD.state.journal, today = todayISO();
    var order = ["asset", "liability", "equity", "income", "expense"];
    var html = '<div class="card-head" style="margin-bottom:4px"><h2>Chart of Accounts</h2><button class="btn btn-primary btn-sm" id="add-account">+ Add account</button></div>';
    order.forEach(function (type) {
      var tops = FD.topLevel(FD.state.accounts, type);
      var all = FD.state.accounts.filter(function (a) { return a.type === type; });
      if (!all.length) return;
      var total = tops.reduce(function (s, a) { return s + FD.rolledBalance(j, FD.state.accounts, a, { to: today }); }, 0);
      html += '<div class="card acct-group"><div class="acct-group-head"><h3>' + FD.TYPES[type].plural + '</h3><span class="acct-group-total">' + money(total) + "</span></div>";
      FD.orderedByHierarchy(FD.state.accounts, type).forEach(function (node) {
        var a = node.account, child = node.depth > 0;
        var bal = child ? FD.balance(j, a, { to: today }) : FD.rolledBalance(j, FD.state.accounts, a, { to: today });
        html += '<div class="acct-row' + (child ? " child" : "") + '" data-id="' + a.id + '">' +
          '<div class="acct-ico">' + escapeHTML(a.icon) + '</div><div class="acct-name">' + (child ? '<span class="acct-child-marker">↳</span> ' : "") + escapeHTML(a.name) + (a.archived ? '<span class="archived-note">archived</span>' : "") + '</div>' +
          '<div class="acct-bal">' + money(bal) + "</div></div>";
      });
      html += "</div>";
    });
    el.innerHTML = html;
    $("#add-account").addEventListener("click", function () { openAccountDialog(null); });
    $all(".acct-row", el).forEach(function (row) { row.addEventListener("click", function () { acctView.id = row.dataset.id; renderAccounts(); }); });
  }

  var reconcileMode = false;
  var stmtBalances = {}; // per-account statement target, kept for the session
  function renderRegister(id) {
    var el = $("#view-accounts"), a = FD.getAccount(id);
    var rows = FD.register(FD.state.journal, a);
    var current = rows.length ? rows[rows.length - 1].balance : 0;
    var clearedBal = FD.clearedBalance(FD.state.journal, a);
    var stmt = stmtBalances[id];
    var diff = (typeof stmt === "number") ? FD.round2(stmt - clearedBal) : null;

    var canAddSub = !a.parentId && ["expense", "income", "asset", "liability"].indexOf(a.type) !== -1;
    var html = '<div class="card"><div class="register-head">' +
      '<button class="btn btn-ghost btn-sm" id="reg-back">← Accounts</button>' +
      '<div class="reg-title"><span class="acct-ico">' + escapeHTML(a.icon) + '</span><h2>' + escapeHTML(a.name) + '</h2></div>' +
      '<span class="reg-balance">' + money(current) + '</span>' +
      (canAddSub ? '<button class="btn btn-ghost btn-sm" id="reg-add-sub">+ Subcategory</button>' : "") +
      '<button class="btn btn-ghost btn-sm" id="reg-reconcile">' + (reconcileMode ? "Done" : "Reconcile") + '</button>' +
      '<button class="btn btn-ghost btn-sm" id="reg-edit">Edit account</button></div>';

    if (reconcileMode) {
      html += '<div class="reconcile-bar">' +
        '<label class="field" style="flex-direction:row;align-items:center;gap:8px">Statement ending balance <input type="number" step="0.01" id="reg-stmt" style="width:140px" value="' + (typeof stmt === "number" ? stmt : "") + '" /></label>' +
        '<div class="reconcile-nums"><span>Cleared <strong>' + money(clearedBal) + '</strong></span>' +
        (diff === null ? '<span class="muted">enter statement balance</span>' :
          '<span>Difference <strong class="' + (Math.abs(diff) < 0.005 ? "pos" : "neg") + '">' + money(diff) + '</strong></span>' +
          (Math.abs(diff) < 0.005 ? '<span class="pos">✓ Reconciled</span>' : "")) +
        '</div></div>';
    }

    if (!rows.length) {
      html += '<div class="empty-state">No activity in this account yet.</div>';
    } else {
      html += '<ul class="reg-list' + (reconcileMode ? " reconciling" : "") + '">';
      rows.slice().reverse().forEach(function (r) {
        var d = FD.describeEntry(r.entry);
        var deltaCls = r.delta >= 0 ? "pos" : "neg", sign = r.delta >= 0 ? "+" : "−";
        var cleared = FD.isCleared(id, r.entry.id);
        html += '<li class="reg-item" data-eid="' + r.entry.id + '" tabindex="0">' +
          '<button class="reg-clear' + (cleared ? " on" : "") + '" title="Mark cleared" aria-label="Toggle cleared">' + (cleared ? "●" : "○") + '</button>' +
          '<div class="reg-main"><div class="reg-desc"></div><div class="reg-date">' + fmtDate(r.entry.date) + ' · ' + escapeHTML(d.kind) + '</div></div>' +
          '<div class="reg-delta ' + deltaCls + '">' + sign + money(Math.abs(r.delta)) + '</div>' +
          '<div class="reg-run">' + money(r.balance) + '</div></li>';
      });
      html += "</ul>";
    }
    html += "</div>";
    el.innerHTML = html;
    $("#reg-back").addEventListener("click", function () { acctView.id = null; reconcileMode = false; renderAccounts(); });
    $("#reg-edit").addEventListener("click", function () { openAccountDialog(id); });
    if (canAddSub) $("#reg-add-sub").addEventListener("click", function () { openAccountDialog(null, { type: a.type, parentId: id }); });
    $("#reg-reconcile").addEventListener("click", function () { reconcileMode = !reconcileMode; renderRegister(id); });
    if (reconcileMode) {
      $("#reg-stmt").addEventListener("change", function () {
        var v = parseFloat(this.value); stmtBalances[id] = isNaN(v) ? undefined : v;
        // Defer so the input's blur finishes before we replace the DOM.
        setTimeout(function () { renderRegister(id); }, 0);
      });
    }
    $all(".reg-item", el).forEach(function (row) {
      var eid = row.dataset.eid, entry = FD.state.journal.find(function (e) { return e.id === eid; });
      var clearBtn = row.querySelector(".reg-clear");
      clearBtn.addEventListener("click", function (ev) { ev.stopPropagation(); FD.toggleCleared(id, eid); renderRegister(id); });
      if (entry && ["expense", "income", "transfer"].indexOf(entry.kind) !== -1) {
        row.querySelector(".reg-desc").textContent = entry.description || FD.describeEntry(entry).kind;
        row.addEventListener("click", function () { openTxDialog(eid); });
        row.addEventListener("keydown", function (ev) { if (ev.key === "Enter") openTxDialog(eid); });
      } else if (entry) {
        row.querySelector(".reg-desc").textContent = entry.description || "Opening balance";
      }
    });
  }

  // ---------- Budgets ----------
  function renderBudgets() {
    var el = $("#view-budgets"), mr = monthRange(new Date().getFullYear(), new Date().getMonth());
    var rows = FD.orderedByHierarchy(FD.state.accounts, "expense").map(function (node) {
      var a = node.account, child = node.depth > 0;
      var limit = Number(FD.state.budgets[a.id]) || 0;
      var used = (!child && FD.hasChildren(FD.state.accounts, a.id))
        ? FD.rolledBalance(FD.state.journal, FD.state.accounts, a, { from: mr.from, to: mr.to })
        : FD.balance(FD.state.journal, a, { from: mr.from, to: mr.to });
      var pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
      var fill = ""; if (limit > 0) { if (used > limit) fill = "over"; else if (used / limit >= 0.8) fill = "warn"; }
      var spentText = limit > 0 ? money(used) + " of " + money(limit) + (used > limit ? " · over by " + money(used - limit) : "") : money(used) + " spent";
      return '<li class="budget-row"' + (child ? ' style="padding-left:22px"' : "") + '>' +
        '<div class="budget-top"><span class="budget-name"><span>' + (child ? "↳ " : "") + escapeHTML(a.icon) + '</span><span>' + escapeHTML(a.name) + '</span></span>' +
        '<span class="budget-spent' + (limit > 0 && used > limit ? " over" : "") + '">' + spentText + '</span>' +
        '<input class="budget-input" type="number" min="0" step="1" placeholder="No limit" data-id="' + a.id + '"' + (limit > 0 ? ' value="' + limit + '"' : "") + " /></div>" +
        '<div class="budget-bar"><div class="budget-fill ' + fill + '" style="width:' + pct + '%"></div></div></li>';
    }).join("");
    el.innerHTML = '<div class="card"><div class="card-head"><h2>Monthly Budgets</h2><span class="muted">' + monthLabel() + '</span></div>' +
      '<p class="section-hint">Set a monthly limit per category or subcategory. Parent rows roll up their subcategories.</p>' +
      '<ul class="budget-list">' + rows + "</ul></div>";
    $all(".budget-input", el).forEach(function (input) {
      input.addEventListener("change", function () { FD.setBudget(input.dataset.id, input.value); renderBudgets(); });
    });
  }

  // ---------- Reports ----------
  function renderReports() {
    var el = $("#view-reports");
    el.innerHTML = '<div class="card"><div class="report-controls">' +
      '<select id="r-type"><option value="pl">Profit &amp; Loss</option><option value="cf">Cash Flow</option><option value="bs">Balance Sheet</option><option value="tag">By Tag</option></select>' +
      '<span id="r-period-wrap"></span></div><div id="report-body" style="margin-top:16px"></div></div>';
    $("#r-type").value = report.type;
    $("#r-type").addEventListener("change", function () { report.type = this.value; renderReportControls(); renderReportBody(); });
    renderReportControls(); renderReportBody();
  }
  function renderReportControls() {
    var wrap = $("#r-period-wrap");
    if (report.type === "bs") {
      wrap.innerHTML = '<label class="muted" style="display:inline-flex;align-items:center;gap:8px">As of <input type="date" id="r-asof" /></label>' +
        '<label class="switch-lite"><input type="checkbox" id="r-compare" /> Compare</label>' +
        (report.compare ? '<label class="muted" style="display:inline-flex;align-items:center;gap:8px">vs <input type="date" id="r-compare-asof" /></label>' : "");
      $("#r-asof").value = report.asOf || todayISO();
      $("#r-asof").addEventListener("change", function () { report.asOf = this.value; renderReportBody(); });
      $("#r-compare").checked = !!report.compare;
      $("#r-compare").addEventListener("change", function () { report.compare = this.checked; renderReportControls(); renderReportBody(); });
      if (report.compare) {
        $("#r-compare-asof").value = report.compareAsOf || defaultPriorAsOf(report.asOf || todayISO());
        $("#r-compare-asof").addEventListener("change", function () { report.compareAsOf = this.value; renderReportBody(); });
      }
      return;
    }
    wrap.innerHTML = '<select id="r-period">' +
      '<option value="this-month">This month</option><option value="last-month">Last month</option>' +
      '<option value="this-year">This year</option><option value="last-year">Last year</option>' +
      '<option value="all">All time</option><option value="custom">Custom…</option></select>' +
      '<span id="r-custom" style="display:none;gap:8px"><input type="date" id="r-from" /><input type="date" id="r-to" /></span>' +
      (report.type === "tag" ? "" : '<label class="switch-lite"><input type="checkbox" id="r-compare" /> Compare to prior</label>');
    $("#r-period").value = report.period;
    var custom = $("#r-custom"); custom.style.display = report.period === "custom" ? "inline-flex" : "none";
    if (report.from) $("#r-from").value = report.from; if (report.to) $("#r-to").value = report.to;
    $("#r-period").addEventListener("change", function () { report.period = this.value; custom.style.display = this.value === "custom" ? "inline-flex" : "none"; renderReportBody(); });
    $("#r-from").addEventListener("change", function () { report.from = this.value; renderReportBody(); });
    $("#r-to").addEventListener("change", function () { report.to = this.value; renderReportBody(); });
    var cmp = $("#r-compare");
    if (cmp) { cmp.checked = !!report.compare; cmp.addEventListener("change", function () { report.compare = this.checked; renderReportBody(); }); }
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
    $("#report-body").innerHTML = report.type === "pl" ? renderPL() : report.type === "cf" ? renderCF() : report.type === "tag" ? renderTagReport() : renderBS();
  }
  function periodLabel(p) { return (p.from ? fmtDate(p.from) : "the beginning") + " – " + fmtDate(p.to); }

  // Render a report section with parent/child grouping. When opt.prev (a map of
  // accountId -> prior amount) is given, adds Prior and Change columns; opt.favorable
  // is +1 if a rise is good (income) or -1 if a fall is good (expenses).
  function hierLines(rows, opt) {
    var compare = !!(opt && opt.prev), prev = (opt && opt.prev) || {}, fav = (opt && opt.favorable) || 1;
    function prevOf(id) { return prev[id] || 0; }
    var ids = {}; rows.forEach(function (r) { ids[r.account.id] = true; });
    var byParent = {}, tops = [];
    rows.forEach(function (r) { var p = r.account.parentId; if (p && ids[p]) { (byParent[p] = byParent[p] || []).push(r); } else tops.push(r); });
    function cells(amt, pv) {
      var h = '<span class="r-amt tabular">' + money(amt) + "</span>";
      if (compare) { var d = FD.round2(amt - pv); h += '<span class="r-amt tabular muted">' + money(pv) + '</span><span class="r-amt tabular ' + (Math.abs(d) < 0.005 ? "" : (d * fav >= 0 ? "pos" : "neg")) + '">' + signedMoney(d) + "</span>"; }
      return h;
    }
    function line(acc, amt, pv, cls) { return '<div class="report-line ' + cls + '"><span class="r-name">' + escapeHTML(acc.icon + " " + acc.name) + "</span>" + cells(amt, pv) + "</div>"; }
    function show(amt, pv) { return Math.abs(amt) > 0.005 || (compare && Math.abs(pv) > 0.005); }
    var html = "";
    tops.forEach(function (r) {
      var kids = byParent[r.account.id] || [];
      var visibleKids = kids.filter(function (k) { return show(k.amount, prevOf(k.account.id)); });
      var rolled = r.amount + kids.reduce(function (s, k) { return s + k.amount; }, 0);
      var rolledPrev = prevOf(r.account.id) + kids.reduce(function (s, k) { return s + prevOf(k.account.id); }, 0);
      if (kids.length) {
        if (!show(rolled, rolledPrev) && !visibleKids.length) return;
        html += line(r.account, rolled, rolledPrev, "parent");
        visibleKids.forEach(function (k) { html += line(k.account, k.amount, prevOf(k.account.id), "child"); });
      } else if (show(r.amount, prevOf(r.account.id))) { html += line(r.account, r.amount, prevOf(r.account.id), ""); }
    });
    return html || '<div class="report-line"><span class="r-name muted">None</span><span class="r-amt tabular">—</span></div>';
  }

  function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
  function previousPeriod() {
    var now = new Date(), y = now.getFullYear(), m = now.getMonth();
    switch (report.period) {
      case "this-month": return m === 0 ? monthRange(y - 1, 11) : monthRange(y, m - 1);
      case "last-month": { var pm = m - 2, yy = y; if (pm < 0) { pm += 12; yy--; } return monthRange(yy, pm); }
      case "this-year": return { from: (y - 1) + "-01-01", to: (y - 1) + "-12-31" };
      case "last-year": return { from: (y - 2) + "-01-01", to: (y - 2) + "-12-31" };
      case "custom": { if (!report.from || !report.to) return null; var days = daysBetween(report.from, report.to) + 1; return { from: FD.addDays(report.from, -days), to: FD.addDays(report.from, -1) }; }
      default: return null;
    }
  }
  function renderPL() {
    var p = resolvePeriod(), r = FD.profitAndLoss(FD.state.journal, FD.state.accounts, p.from, p.to);
    var pp = (report.compare && report.period !== "all") ? previousPeriod() : null;
    var compare = !!pp, pr = null, prevMap = {};
    if (compare) {
      pr = FD.profitAndLoss(FD.state.journal, FD.state.accounts, pp.from, pp.to);
      pr.income.concat(pr.expense).forEach(function (x) { prevMap[x.account.id] = x.amount; });
    }
    function subtotal(label, cur, prv, fav) {
      var h = '<div class="report-subtotal"><span>' + label + '</span><span class="tabular">' + money(cur) + "</span>";
      if (compare) { var d = FD.round2(cur - prv); h += '<span class="tabular muted">' + money(prv) + '</span><span class="tabular ' + (Math.abs(d) < 0.005 ? "" : (d * fav >= 0 ? "pos" : "neg")) + '">' + signedMoney(d) + "</span>"; }
      return h + "</div>";
    }
    var netD = compare ? FD.round2(r.netIncome - pr.netIncome) : 0;
    var colhead = compare ? '<div class="report-colhead"><span></span><span>This period</span><span>Prior</span><span>Change</span></div>' : "";
    return '<div class="report' + (compare ? " compare" : "") + '"><div class="report-title"><h3>Profit &amp; Loss</h3><div class="muted">' + periodLabel(p) + (compare ? " &nbsp;vs&nbsp; " + periodLabel(pp) : "") + "</div></div>" +
      colhead +
      '<div class="report-section-head">Income</div>' + hierLines(r.income, compare ? { prev: prevMap, favorable: 1 } : null) +
      subtotal("Total Income", r.totalIncome, compare ? pr.totalIncome : 0, 1) +
      '<div class="report-section-head">Expenses</div>' + hierLines(r.expense, compare ? { prev: prevMap, favorable: -1 } : null) +
      subtotal("Total Expenses", r.totalExpense, compare ? pr.totalExpense : 0, -1) +
      '<div class="report-total ' + (r.netIncome >= 0 ? "pos" : "neg") + '"><span>Net ' + (r.netIncome >= 0 ? "Income" : "Loss") + '</span><span class="tabular">' + signedMoney(r.netIncome) + "</span>" +
      (compare ? '<span class="tabular muted">' + signedMoney(pr.netIncome) + '</span><span class="tabular ' + (netD >= 0 ? "pos" : "neg") + '">' + signedMoney(netD) + "</span>" : "") +
      "</div></div>";
  }
  function renderTagReport() {
    var p = resolvePeriod(), rows = FD.tagTotals(FD.state.journal, p.from, p.to);
    var head = '<div class="report"><div class="report-title"><h3>Spending &amp; Income by Tag</h3><div class="muted">' + periodLabel(p) + "</div></div>";
    if (!rows.length) return head + '<div class="report-line"><span class="r-name muted">No tagged transactions in this period.</span></div></div>';
    // True totals count each tagged transaction once (per-tag rows below can
    // double-count a multi-tag transaction, so they aren't summed here).
    var totExp = 0, totInc = 0;
    FD.state.journal.forEach(function (e) {
      if (!(e.tags && e.tags.length)) return;
      if (e.kind !== "expense" && e.kind !== "income") return;
      if (p.from && e.date < p.from) return;
      if (p.to && e.date > p.to) return;
      var amt = FD.describeEntry(e).amount || 0;
      if (e.kind === "expense") totExp += amt; else totInc += amt;
    });
    var body = '<div class="report-colhead tag-cols"><span>Tag</span><span>Income</span><span>Expenses</span><span>Net</span></div>';
    rows.forEach(function (r) {
      var name = r.tag === "(untagged)" ? '<span class="muted">(untagged)</span>' : escapeHTML(r.tag);
      body += '<div class="report-line tag-cols"><span class="r-name">' + name + ' <span class="muted">· ' + r.count + '</span></span>' +
        '<span class="r-amt tabular">' + (r.income ? money(r.income) : "—") + "</span>" +
        '<span class="r-amt tabular">' + (r.expense ? money(r.expense) : "—") + "</span>" +
        '<span class="r-amt tabular ' + (r.net >= 0 ? "pos" : "neg") + '">' + signedMoney(r.net) + "</span></div>";
    });
    body += '<div class="report-total tag-cols"><span>Tagged total</span>' +
      '<span class="tabular">' + money(FD.round2(totInc)) + '</span>' +
      '<span class="tabular">' + money(FD.round2(totExp)) + '</span>' +
      '<span class="tabular ' + (totInc - totExp >= 0 ? "pos" : "neg") + '">' + signedMoney(FD.round2(totInc - totExp)) + "</span></div>";
    body += '<p class="section-hint" style="margin-top:10px">A transaction with several tags is counted in full under each, so tag rows can total more than the tagged total. The count after each tag is how many transactions carry it.</p>';
    return head + body + "</div>";
  }
  function defaultPriorAsOf(asOf) { return (parseInt(asOf.slice(0, 4), 10) - 1) + asOf.slice(4); } // one year earlier
  // Shared compare cells: cur value, prior value, favorable direction, and a formatter.
  function cmpCells(cur, prv, fav, compare, fmt) {
    fmt = fmt || money;
    var h = '<span class="r-amt tabular">' + fmt(cur) + "</span>";
    if (compare) { var d = FD.round2(cur - prv); h += '<span class="r-amt tabular muted">' + fmt(prv) + '</span><span class="r-amt tabular ' + (Math.abs(d) < 0.005 ? "" : (d * fav >= 0 ? "pos" : "neg")) + '">' + signedMoney(d) + "</span>"; }
    return h;
  }
  function cmpTotal(kindCls, label, cur, prv, fav, compare, fmt) {
    fmt = fmt || money;
    var h = '<div class="' + kindCls + '"><span>' + label + '</span><span class="tabular">' + fmt(cur) + "</span>";
    if (compare) { var d = FD.round2(cur - prv); h += '<span class="tabular muted">' + fmt(prv) + '</span><span class="tabular ' + (Math.abs(d) < 0.005 ? "" : (d * fav >= 0 ? "pos" : "neg")) + '">' + signedMoney(d) + "</span>"; }
    return h + "</div>";
  }
  function colhead(a, b) { return '<div class="report-colhead"><span></span><span>' + a + '</span><span>' + b + '</span><span>Change</span></div>'; }

  function renderBS() {
    var asOf = report.asOf || todayISO(), r = FD.balanceSheet(FD.state.journal, FD.state.accounts, asOf);
    var compare = !!report.compare, priorAsOf = compare ? (report.compareAsOf || defaultPriorAsOf(asOf)) : null;
    var pr = compare ? FD.balanceSheet(FD.state.journal, FD.state.accounts, priorAsOf) : null;
    var prevMap = {};
    if (compare) pr.assets.concat(pr.liabilities, pr.equityAccounts).forEach(function (x) { prevMap[x.account.id] = x.amount; });
    var equity = hierLines(r.equityAccounts, compare ? { prev: prevMap, favorable: 1 } : null) +
      '<div class="report-line"><span class="r-name">📊 Retained Earnings (Net Income)</span>' + cmpCells(r.netIncome, compare ? pr.netIncome : 0, 1, compare) + "</div>";
    return '<div class="report' + (compare ? " compare" : "") + '"><div class="report-title"><h3>Balance Sheet</h3><div class="muted">As of ' + fmtDate(asOf) + (compare ? " &nbsp;vs&nbsp; " + fmtDate(priorAsOf) : "") + "</div></div>" +
      (compare ? colhead(fmtDateShort(asOf), fmtDateShort(priorAsOf)) : "") +
      '<div class="report-section-head">Assets</div>' + hierLines(r.assets, compare ? { prev: prevMap, favorable: 1 } : null) +
      cmpTotal("report-subtotal", "Total Assets", r.totalAssets, compare ? pr.totalAssets : 0, 1, compare) +
      '<div class="report-section-head">Liabilities</div>' + hierLines(r.liabilities, compare ? { prev: prevMap, favorable: -1 } : null) +
      cmpTotal("report-subtotal", "Total Liabilities", r.totalLiabilities, compare ? pr.totalLiabilities : 0, -1, compare) +
      '<div class="report-section-head">Equity</div>' + equity +
      cmpTotal("report-subtotal", "Total Equity", r.totalEquity, compare ? pr.totalEquity : 0, 1, compare) +
      cmpTotal("report-total", "Liabilities + Equity", r.totalLiabilitiesAndEquity, compare ? pr.totalLiabilitiesAndEquity : 0, 1, compare) +
      '<div class="report-check ' + (r.balanced ? "ok" : "bad") + '">' + (r.balanced ? "✓ In balance — Assets = Liabilities + Equity" : "⚠ Out of balance by " + money(r.totalAssets - r.totalLiabilitiesAndEquity)) + "</div></div>";
  }
  function renderCF() {
    var p = resolvePeriod(), r = FD.cashFlow(FD.state.journal, FD.state.accounts, p.from, p.to);
    var pp = (report.compare && report.period !== "all") ? previousPeriod() : null;
    var compare = !!pp, pr = pp ? FD.cashFlow(FD.state.journal, FD.state.accounts, pp.from, pp.to) : null;
    var netOp = FD.round2(r.groups.income + r.groups.expense), netOpPrev = compare ? FD.round2(pr.groups.income + pr.groups.expense) : 0;
    var g = function (k) { return compare ? pr.groups[k] : 0; };
    function row(name, amt, pv) { return '<div class="report-line"><span class="r-name">' + name + "</span>" + cmpCells(amt, pv, 1, compare, signedMoney) + "</div>"; }
    return '<div class="report' + (compare ? " compare" : "") + '"><div class="report-title"><h3>Cash Flow</h3><div class="muted">' + periodLabel(p) + (compare ? " &nbsp;vs&nbsp; " + periodLabel(pp) : "") + "</div></div>" +
      (compare ? colhead("This period", "Prior") : "") +
      '<div class="report-line"><span class="r-name">Beginning cash &amp; bank</span>' + cmpCells(r.beginning, compare ? pr.beginning : 0, 1, compare) + "</div>" +
      '<div class="report-section-head">Operating</div>' +
      row("Cash from income", r.groups.income, g("income")) + row("Cash for expenses", r.groups.expense, g("expense")) +
      cmpTotal("report-subtotal", "Net operating cash", netOp, netOpPrev, 1, compare, signedMoney) +
      '<div class="report-section-head">Financing &amp; Other</div>' +
      row("Loans / credit cards", r.groups.financing, g("financing")) + row("Owner equity", r.groups.equity, g("equity")) +
      cmpTotal("report-total " + (r.netChange >= 0 ? "pos" : "neg"), "Net change in cash", r.netChange, compare ? pr.netChange : 0, 1, compare, signedMoney) +
      '<div class="report-line"><span class="r-name">Ending cash &amp; bank</span>' + cmpCells(r.ending, compare ? pr.ending : 0, 1, compare) + "</div>" +
      '<div class="report-check ' + (r.reconciles ? "ok" : "bad") + '">' + (r.reconciles ? "✓ Reconciles to account balances" : "⚠ Does not reconcile") + "</div></div>";
  }

  // ---------- Settings ----------
  function renderSettings() {
    var el = $("#view-settings");
    el.innerHTML =
      '<div class="card"><h2>Data &amp; Backup</h2>' +
        '<div class="settings-row"><div><div class="s-label">Export backup (JSON)</div><div class="s-desc">Full backup — accounts, transactions, and budgets.</div></div>' +
          '<div class="settings-actions"><button class="btn btn-ghost btn-sm" id="json-export">Export JSON</button></div></div>' +
        '<div class="settings-row"><div><div class="s-label">Restore backup (JSON)</div><div class="s-desc">Replaces all current data with the contents of a backup file.</div></div>' +
          '<div class="settings-actions"><button class="btn btn-ghost btn-sm" id="json-import">Import JSON</button><input type="file" id="json-input" accept="application/json,.json" hidden /></div></div>' +
        '<div class="settings-row"><div><div class="s-label">Reset to sample chart of accounts</div><div class="s-desc">Deletes all data and restarts with the default accounts.</div></div>' +
          '<div class="settings-actions"><button class="btn btn-danger btn-sm" id="data-reset">Reset</button></div></div>' +
      "</div>" +
      '<div class="card"><h2>Security</h2><div id="security-body"></div></div>' +
      '<div class="card"><h2>Sync</h2><p class="section-hint">Sync across your devices and share a family ledger via your own server. See <code>server/README.md</code> to run it.</p><div id="sync-body"></div></div>';
    $("#json-export").addEventListener("click", exportJSON);
    $("#json-import").addEventListener("click", function () { $("#json-input").click(); });
    $("#json-input").addEventListener("change", handleJSONImport);
    $("#data-reset").addEventListener("click", resetData);
    renderSecurity();
    renderSync();
  }

  // ----- Security (PIN + encryption) -----
  function renderSecurity() {
    var body = $("#security-body");
    if (!window.FDVault || !FDVault.supported()) { body.innerHTML = '<p class="s-desc">Encryption isn\'t available in this browser.</p>'; return; }
    if (!FD.isEncrypted()) {
      body.innerHTML = '<div class="settings-row"><div><div class="s-label">PIN lock &amp; encryption</div><div class="s-desc">Lock the app and encrypt your data at rest on this device (AES-GCM).</div></div>' +
        '<div class="settings-actions"><button class="btn btn-primary btn-sm" id="pin-setup">Set up PIN</button></div></div>';
      $("#pin-setup").addEventListener("click", function () { openPinDialog("setup"); });
    } else {
      body.innerHTML = '<div class="settings-row"><div><div class="s-label">PIN lock is on</div><div class="s-desc">Your data is encrypted on this device.</div></div>' +
        '<div class="settings-actions"><button class="btn btn-ghost btn-sm" id="pin-change">Change PIN</button><button class="btn btn-ghost btn-sm" id="pin-lock">Lock now</button><button class="btn btn-danger btn-sm" id="pin-remove">Remove</button></div></div>';
      $("#pin-change").addEventListener("click", function () { openPinDialog("change"); });
      $("#pin-lock").addEventListener("click", function () { FDVault.lock(); location.reload(); });
      $("#pin-remove").addEventListener("click", removePin);
    }
  }
  var pinMode = "setup";
  function openPinDialog(mode) {
    pinMode = mode;
    $("#pin-dialog-title").textContent = mode === "change" ? "Change PIN" : "Set a PIN";
    $("#pin-new").value = ""; $("#pin-confirm").value = ""; $("#pin-error").hidden = true;
    $("#pin-dialog").showModal();
    setTimeout(function () { $("#pin-new").focus(); }, 30);
  }
  function submitPin(ev) {
    ev.preventDefault();
    var a = $("#pin-new").value, b = $("#pin-confirm").value, err = $("#pin-error");
    if (a.length < 4) { err.textContent = "PIN must be at least 4 characters."; err.hidden = false; return; }
    if (a !== b) { err.textContent = "PINs don't match."; err.hidden = false; return; }
    var op = pinMode === "change" ? FDVault.changePin(a, FD.snapshot()) : FDVault.enable(a, FD.snapshot());
    op.then(function () { $("#pin-dialog").close(); renderSecurity(); })
      .catch(function (e) { err.textContent = e.message || "Could not set PIN."; err.hidden = false; });
  }
  function removePin() {
    if (!confirm("Remove the PIN and stop encrypting data on this device?")) return;
    FDVault.disable().then(function () { FD.persist(); renderSecurity(); });
  }

  // ----- Auto-sync orchestration -----
  var syncing = false, pendingSync = false, applyingRemote = false, autoTimer = null, syncDebounce = null;
  function currentViewName() { var v = (location.hash || "#dashboard").slice(1); return VIEWS.indexOf(v) === -1 ? "dashboard" : v; }
  function setAutoStatus(msg, bad) {
    var n = $("#auto-status"); if (n) { n.textContent = msg || ""; n.className = "sync-note" + (bad ? " bad" : msg ? " ok" : ""); }
  }
  // Two-way sync: pull, merge into local, and push back if we added anything.
  function fullSync(opts) {
    opts = opts || {};
    if (!FDSync.isLoggedIn() || !FDSync.activeWorkspace()) return Promise.resolve();
    if (syncing) { pendingSync = true; return Promise.resolve(); }
    syncing = true; setAutoStatus("Syncing…");
    var ws = FDSync.activeWorkspace();
    return FDSync.pull(ws).then(function (r) {
      var local = FD.exportData();
      var merged = FD.merge(local, r.data || {});
      applyingRemote = true;
      FD.importData(merged);
      FD.postDueRecurring(todayISO()); // post occurrences from any merged-in rules
      applyingRemote = false;
      var after = FD.exportData();
      if (currentViewName() !== "settings") refresh();
      // Push if the dataset changed, or when forced. A force push re-uploads even
      // when the decrypted data is identical — needed when an E2E toggle changes
      // how the server copy must be stored (encrypt on enable, decrypt on disable).
      if (opts.force || !sameDataset(r.data, after)) {
        return FDSync.push(ws, after).then(function (r2) { finish("Synced • v" + r2.version); });
      }
      finish("Up to date • v" + r.version);
    }).catch(function (err) {
      syncing = false;
      if (err && err.status === 409 && !opts._retried) return fullSync({ _retried: true, force: opts.force });
      setAutoStatus(err && err.message ? err.message : "Sync failed", true);
    });
    function finish(msg) { syncing = false; setAutoStatus(msg); if (pendingSync) { pendingSync = false; setTimeout(function () { fullSync(); }, 60); } }
  }
  // Compare two datasets ignoring order (accounts/journal by id, budgets as-is).
  function sameDataset(a, b) {
    function canon(d) {
      d = d || {};
      var acc = (d.accounts || []).slice().sort(byId).map(function (x) { return [x.id, x.updatedAt || 0]; });
      var jrn = (d.journal || []).slice().sort(byId).map(function (x) { return [x.id, x.updatedAt || 0]; });
      return JSON.stringify({ a: acc, j: jrn, b: d.budgets || {} });
    }
    function byId(x, y) { return x.id < y.id ? -1 : x.id > y.id ? 1 : 0; }
    return canon(a) === canon(b);
  }
  function scheduleAutoSync() {
    if (!FDSync.isAutoSync() || !FDSync.isLoggedIn() || !FDSync.activeWorkspace()) return;
    clearTimeout(syncDebounce);
    syncDebounce = setTimeout(function () { fullSync(); }, 2500);
  }
  function startAutoTimer() {
    stopAutoTimer();
    if (!FDSync.isAutoSync()) return;
    autoTimer = setInterval(function () { fullSync(); }, 45000);
    fullSync(); // sync once immediately
  }
  function stopAutoTimer() { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } }

  // ----- Sync -----
  function syncNote(msg, cls) { var n = $("#sync-note"); if (n) { n.textContent = msg || ""; n.className = "sync-note" + (cls ? " " + cls : ""); } }
  function renderSync() {
    var body = $("#sync-body"); if (!body) return;
    var cfg = FDSync.config(), backend = FDSync.backend();
    var html = '<div class="settings-row"><div><div class="s-label">Cloud backend</div><div class="s-desc">Where your synced data lives.</div></div>' +
      '<div class="settings-actions"><select id="sync-backend"><option value="server"' + (backend === "server" ? " selected" : "") + '>Self-hosted server</option><option value="supabase"' + (backend === "supabase" ? " selected" : "") + '>Supabase</option></select></div></div>';
    if (backend === "supabase") {
      html += '<div class="settings-row"><div><div class="s-label">Supabase project</div><div class="s-desc">Project URL and anon (public) key. See <code>supabase/setup.sql</code>.</div></div>' +
        '<div class="settings-actions sync-inline"><input id="sb-url" class="sync-url" placeholder="https://xxxx.supabase.co" value="' + escapeHTML(cfg.sbUrl || "") + '" /><input id="sb-key" class="sync-url" placeholder="anon public key" value="' + escapeHTML(cfg.anonKey || "") + '" /><button class="btn btn-ghost btn-sm" id="sync-connect">Connect</button></div></div>';
    } else {
      html += '<div class="settings-row"><div><div class="s-label">Server URL</div><div class="s-desc">Your self-hosted sync server.</div></div>' +
        '<div class="settings-actions sync-inline"><input id="sync-url" class="sync-url" placeholder="http://localhost:4000" value="' + escapeHTML(cfg.url || "") + '" /><button class="btn btn-ghost btn-sm" id="sync-connect">Connect</button></div></div>';
    }
    html += '<div id="sync-note" class="sync-note"></div>';
    if (!FDSync.isLoggedIn()) {
      html += '<div class="settings-row"><div><div class="s-label">Account</div><div class="s-desc">Register once, then log in on each device.</div></div>' +
        '<div class="settings-actions sync-inline"><input id="sync-email" placeholder="email" style="width:170px" /><input id="sync-pass" type="password" placeholder="password" style="width:140px" />' +
        '<button class="btn btn-ghost btn-sm" id="sync-login">Log in</button><button class="btn btn-primary btn-sm" id="sync-register">Register</button></div></div>';
    } else {
      html += '<div class="settings-row"><div><div class="s-label">Signed in</div><div class="s-desc">' + escapeHTML(cfg.email || "") + '</div></div>' +
        '<div class="settings-actions"><button class="btn btn-ghost btn-sm" id="sync-logout">Sign out</button></div></div>' +
        '<div id="sync-e2ee"></div><div id="sync-ws"></div>';
    }
    body.innerHTML = html;
    // Persist the current backend's connection config from the visible fields.
    function saveBackendConfig() {
      if (FDSync.backend() === "supabase") FDSync.setSupabase($("#sb-url").value.trim(), $("#sb-key").value.trim());
      else FDSync.setServer($("#sync-url").value.trim());
    }
    $("#sync-backend").addEventListener("change", function () { FDSync.setBackend(this.value); renderSync(); });
    $("#sync-connect").addEventListener("click", function () {
      saveBackendConfig(); syncNote("Connecting…");
      FDSync.health().then(function (h) { syncNote(h.message || "Connected.", "ok"); })
        .catch(function (e) { syncNote(e.message || "Could not connect.", "bad"); });
    });
    if (!FDSync.isLoggedIn()) {
      var creds = function () { return { email: $("#sync-email").value.trim(), pass: $("#sync-pass").value }; };
      $("#sync-register").addEventListener("click", function () { var c = creds(); saveBackendConfig(); FDSync.register(c.email, c.pass).then(renderSync).catch(function (e) { syncNote(e.message, e.info ? "ok" : "bad"); }); });
      $("#sync-login").addEventListener("click", function () { var c = creds(); saveBackendConfig(); FDSync.login(c.email, c.pass).then(renderSync).catch(function (e) { syncNote(e.message, "bad"); }); });
    } else {
      $("#sync-logout").addEventListener("click", function () { FDSync.logout(); renderSync(); });
      renderE2EE();
      loadWorkspaces();
    }
  }
  function renderE2EE() {
    var wrap = $("#sync-e2ee"); if (!wrap) return;
    if (!window.FDVault || !FDVault.supported()) { wrap.innerHTML = ""; return; }
    if (FDSync.isE2EE()) {
      wrap.innerHTML = '<div class="settings-row"><div><div class="s-label">End-to-end encryption <span class="ws-badge" style="color:var(--income);border-color:var(--income)">on</span></div>' +
        '<div class="s-desc">Data is encrypted with your passphrase before syncing. The server can\'t read it.</div></div>' +
        '<div class="settings-actions"><button class="btn btn-ghost btn-sm" id="e2ee-change">Change passphrase</button><button class="btn btn-danger btn-sm" id="e2ee-off">Turn off</button></div></div>';
      $("#e2ee-change").addEventListener("click", function () { openE2EEDialog("change"); });
      $("#e2ee-off").addEventListener("click", function () {
        if (!confirm("Turn off end-to-end encryption? Future pushes will store data unencrypted on the server.")) return;
        FDSync.disableE2EE(); renderE2EE();
        reencryptServerCopy("Encryption off. Uploading an unencrypted copy…");
      });
    } else {
      wrap.innerHTML = '<div class="settings-row"><div><div class="s-label">End-to-end encryption</div>' +
        '<div class="s-desc">Encrypt your data with a passphrase before it syncs, so even your server can\'t read it.</div></div>' +
        '<div class="settings-actions"><button class="btn btn-primary btn-sm" id="e2ee-on">Enable</button></div></div>';
      $("#e2ee-on").addEventListener("click", function () { openE2EEDialog("enable"); });
    }
  }
  function openE2EEDialog(mode) {
    $("#e2ee-title").textContent = mode === "change" ? "Change sync passphrase" : "Enable end-to-end encryption";
    $("#e2ee-pass").value = ""; $("#e2ee-confirm").value = ""; $("#e2ee-error").hidden = true;
    $("#e2ee-dialog").showModal();
    setTimeout(function () { $("#e2ee-pass").focus(); }, 30);
  }
  function submitE2EE(ev) {
    ev.preventDefault();
    var a = $("#e2ee-pass").value, b = $("#e2ee-confirm").value, err = $("#e2ee-error");
    if (a.length < 6) { err.textContent = "Passphrase must be at least 6 characters."; err.hidden = false; return; }
    if (a !== b) { err.textContent = "Passphrases don't match."; err.hidden = false; return; }
    FDSync.setE2EE(a);
    $("#e2ee-dialog").close();
    renderE2EE();
    reencryptServerCopy("Encryption on. Uploading an encrypted copy; other devices need this passphrase to pull.");
  }
  // After an E2E toggle, force a sync so the server copy is re-stored in the new
  // form (encrypted or plaintext) even though the decrypted data is unchanged.
  function reencryptServerCopy(msg) {
    var note = $("#ws-note"); if (note) { note.textContent = msg; note.className = "sync-note ok"; }
    if (FDSync.isLoggedIn() && FDSync.activeWorkspace()) {
      fullSync({ force: true }).then(function () {
        var n = $("#ws-note"); if (n) { n.textContent = "Done — server copy updated."; n.className = "sync-note ok"; }
      });
    }
  }
  function loadWorkspaces() {
    var wrap = $("#sync-ws"); if (!wrap) return;
    wrap.innerHTML = '<p class="s-desc">Loading workspaces…</p>';
    FDSync.listWorkspaces().then(function (list) {
      var active = FDSync.activeWorkspace() || (list[0] && list[0].id);
      var opts = list.map(function (w) { return '<option value="' + w.id + '" data-kind="' + w.kind + '"' + (w.id === active ? " selected" : "") + ">" + escapeHTML(w.name) + " (" + w.kind + ")</option>"; }).join("");
      wrap.innerHTML =
        '<div class="settings-row"><div><div class="s-label">Active workspace</div><div class="s-desc">Push sends this device\'s data; Pull replaces it with the server copy.</div></div>' +
          '<div class="settings-actions sync-inline"><select id="ws-select">' + opts + '</select>' +
          '<button class="btn btn-primary btn-sm" id="ws-push">Push</button><button class="btn btn-ghost btn-sm" id="ws-pull">Pull</button>' +
          '<button class="btn btn-ghost btn-sm" id="ws-invite">Invite</button></div></div>' +
        '<div class="settings-row"><div><div class="s-label">Auto-sync</div><div class="s-desc">Sync automatically after changes and every 45s. Two-way: merges instead of overwriting.</div></div>' +
          '<div class="settings-actions sync-inline"><label class="switch-lite"><input type="checkbox" id="auto-toggle" /> On</label>' +
          '<button class="btn btn-primary btn-sm" id="sync-now">Sync now</button></div></div>' +
        '<div id="auto-status" class="sync-note"></div>' +
        '<div id="ws-note" class="sync-note"></div>' +
        '<div class="settings-row"><div><div class="s-label">Create shared workspace</div><div class="s-desc">A family ledger everyone can access.</div></div>' +
          '<div class="settings-actions sync-inline"><input id="ws-new-name" placeholder="Household" style="width:150px" /><button class="btn btn-ghost btn-sm" id="ws-create">Create</button></div></div>' +
        '<div class="settings-row"><div><div class="s-label">Join with invite code</div><div class="s-desc">Enter a code shared with you.</div></div>' +
          '<div class="settings-actions sync-inline"><input id="ws-code" placeholder="CODE" style="width:130px" /><button class="btn btn-ghost btn-sm" id="ws-join">Join</button></div></div>';
      function selected() { var s = $("#ws-select"); return { id: s.value, kind: s.selectedOptions[0].dataset.kind }; }
      function wsNote(m, cls) { var n = $("#ws-note"); n.textContent = m || ""; n.className = "sync-note" + (cls ? " " + cls : ""); }
      $("#ws-select").addEventListener("change", function () { FDSync.selectWorkspace(this.value); });
      FDSync.selectWorkspace(active);
      $("#auto-toggle").checked = FDSync.isAutoSync();
      $("#auto-toggle").addEventListener("change", function () {
        FDSync.setAutoSync(this.checked);
        if (this.checked) startAutoTimer(); else { stopAutoTimer(); setAutoStatus(""); }
      });
      $("#sync-now").addEventListener("click", function () { fullSync({ manual: true }); });
      if (FDSync.isAutoSync()) setAutoStatus("Auto-sync on");
      $("#ws-push").addEventListener("click", function () {
        var w = selected(); if (!confirm("Push this device's data to \"" + $("#ws-select").selectedOptions[0].textContent + "\"?")) return;
        FDSync.push(w.id, FD.exportData()).then(function (r) { wsNote("Pushed. Server is now at version " + r.version + ".", "ok"); })
          .catch(function (e) { wsNote(e.status === 409 ? "Server has newer data — Pull first, then Push." : e.message, "bad"); });
      });
      $("#ws-pull").addEventListener("click", function () {
        var w = selected(); if (!confirm("Replace this device's data with the server copy? Local changes will be lost.")) return;
        FDSync.pull(w.id).then(function (r) {
          FD.importData(r.data); acctView.id = null;
          // Other views re-render on navigation; don't refresh Settings (it would wipe this note).
          wsNote("Pulled version " + r.version + ". Data updated on this device.", "ok");
        }).catch(function (e) { wsNote(e.message, "bad"); });
      });
      $("#ws-invite").addEventListener("click", function () {
        var w = selected(); if (w.kind !== "shared") { wsNote("Only shared workspaces can be invited to. Create one first.", "bad"); return; }
        FDSync.invite(w.id).then(function (r) { wsNote("Invite code: ", "ok"); $("#ws-note").innerHTML = 'Invite code: <span class="code-pill">' + escapeHTML(r.code) + "</span> — share it with family."; })
          .catch(function (e) { wsNote(e.message, "bad"); });
      });
      $("#ws-create").addEventListener("click", function () {
        var name = $("#ws-new-name").value.trim() || "Household";
        FDSync.createWorkspace(name).then(function (w) { FDSync.selectWorkspace(w.id); loadWorkspaces(); }).catch(function (e) { wsNote(e.message, "bad"); });
      });
      $("#ws-join").addEventListener("click", function () {
        var code = $("#ws-code").value.trim(); if (!code) return;
        FDSync.join(code).then(function (w) { FDSync.selectWorkspace(w.id); loadWorkspaces(); }).catch(function (e) { wsNote(e.message, "bad"); });
      });
    }).catch(function (e) { wrap.innerHTML = '<p class="sync-note bad">Could not load workspaces: ' + escapeHTML(e.message) + "</p>"; });
  }
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }
  function exportJSON() { download("finance-desk-backup-" + currentMonthKey() + ".json", JSON.stringify(FD.exportData(), null, 2), "application/json"); }
  function handleJSONImport(ev) {
    var file = ev.target.files && ev.target.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var obj; try { obj = JSON.parse(String(reader.result)); } catch (e) { alert("That file isn't valid JSON."); return; }
      if (!confirm("This will REPLACE all current data with the backup. Continue?")) return;
      var res = FD.importData(obj);
      if (!res.ok) { alert(res.error); return; }
      acctView.id = null; refresh(); alert("Restored " + res.accounts + " accounts and " + res.journal + " transactions.");
    };
    reader.onerror = function () { alert("Could not read the file."); };
    reader.readAsText(file); ev.target.value = "";
  }
  function resetData() {
    if (!confirm("Delete ALL data and reset to the default chart of accounts? This cannot be undone.")) return;
    FD.importData({ accounts: FD.seedAccounts(), journal: [], budgets: {} });
    acctView.id = null; location.hash = "#dashboard"; refresh();
  }

  // ---------- Transaction dialog ----------
  var txDialog, accountDialog;
  function currentKind() { var c = $('input[name="tx-kind"]:checked'); return c ? c.value : "expense"; }

  function catListFor(kind) { return kind === "income" ? byType("income") : byType("expense"); }
  function secondaryListFor(kind) { return kind === "income" ? byType("asset") : paymentAccts(); }

  function populateTxSelects(kind, primaryId, secondaryId) {
    if (kind === "expense") { $("#tx-primary-label").textContent = "Category"; $("#tx-secondary-label").textContent = "Paid from"; $("#tx-primary").innerHTML = hierOptions(byType("expense"), primaryId); $("#tx-secondary").innerHTML = hierOptions(paymentAccts(), secondaryId); }
    else if (kind === "income") { $("#tx-primary-label").textContent = "Category"; $("#tx-secondary-label").textContent = "Deposit to"; $("#tx-primary").innerHTML = hierOptions(byType("income"), primaryId); $("#tx-secondary").innerHTML = hierOptions(byType("asset"), secondaryId); }
    else { $("#tx-primary-label").textContent = "From"; $("#tx-secondary-label").textContent = "To"; $("#tx-primary").innerHTML = hierOptions(paymentAccts(), primaryId); $("#tx-secondary").innerHTML = hierOptions(paymentAccts(), secondaryId); }
  }
  function updateSplitAvailability(kind) {
    var canSplit = kind === "expense" || kind === "income";
    $("#tx-split-toggle").hidden = !canSplit;
    if (!canSplit && txSplitMode) setSplitMode(false);
  }

  function splitRowHTML(kind, accountId, amount) {
    return '<div class="split-row"><select class="split-cat">' + hierOptions(catListFor(kind), accountId) + '</select>' +
      '<input class="split-amt" type="number" step="0.01" min="0" placeholder="0.00"' + (amount != null ? ' value="' + amount + '"' : "") + ' />' +
      '<button type="button" class="split-remove" aria-label="Remove">✕</button></div>';
  }
  function addSplitRow(accountId, amount) {
    var wrap = $("#tx-splits"); wrap.insertAdjacentHTML("beforeend", splitRowHTML(currentKind(), accountId, amount));
    var row = wrap.lastElementChild;
    row.querySelector(".split-remove").addEventListener("click", function () { row.remove(); refreshSplitTotal(); });
    row.querySelector(".split-amt").addEventListener("input", refreshSplitTotal);
    refreshSplitTotal();
  }
  function refreshSplitTotal() {
    var total = 0;
    $all("#tx-splits .split-amt").forEach(function (i) { total += parseFloat(i.value) || 0; });
    total = FD.round2(total);
    $("#tx-split-total").textContent = "Total: " + money(total);
    $("#tx-amount").value = total ? total : "";
  }
  function setSplitMode(on) {
    txSplitMode = on;
    $("#tx-primary-field").hidden = on;
    $("#tx-split-field").hidden = !on;
    $("#tx-amount").readOnly = on;
    $("#tx-split-toggle").textContent = on ? "Use a single category" : "Split into multiple categories";
    if (on && !$all("#tx-splits .split-row").length) { addSplitRow(); addSplitRow(); }
    if (!on) { $("#tx-splits").innerHTML = ""; $("#tx-amount").readOnly = false; }
  }
  function toggleSplitMode() { setSplitMode(!txSplitMode); }

  function openTxDialog(editId) {
    $("#tx-edit-id").value = editId || ""; $("#tx-delete").hidden = !editId;
    $("#tx-dialog-title").textContent = editId ? "Edit Transaction" : "New Transaction";
    $("#tx-splits").innerHTML = ""; setSplitMode(false);
    // Repeat is only offered for brand-new transactions.
    $("#tx-repeat-row").style.display = editId ? "none" : "";
    $("#tx-repeat").value = "none"; $("#tx-repeat-until-field").style.display = "none"; $("#tx-repeat-until").value = "";
    pendingAttachment = undefined; $("#tx-attach-field").style.display = "";
    renderTxAttach();
    populateVendorList();

    if (editId) {
      var entry = FD.state.journal.find(function (e) { return e.id === editId; }), d = FD.describeEntry(entry);
      var kind = d.generic ? "transfer" : d.kind;
      $('input[name="tx-kind"][value="' + kind + '"]').checked = true;
      $("#tx-desc").value = entry.description || ""; $("#tx-date").value = entry.date;
      $("#tx-vendor").value = entry.vendor || ""; $("#tx-tags").value = (entry.tags || []).join(", ");
      updateSplitAvailability(kind);
      if (d.split) {
        populateTxSelects(kind, null, kind === "income" ? d.depositId : d.paymentId);
        setSplitMode(true); $("#tx-splits").innerHTML = "";
        d.splits.forEach(function (s) { addSplitRow(s.accountId, s.amount); });
      } else {
        var secId = kind === "expense" ? d.paymentId : kind === "income" ? d.depositId : d.toId;
        var priId = kind === "transfer" ? d.fromId : d.categoryId;
        populateTxSelects(kind, priId, secId);
        $("#tx-amount").value = d.amount;
      }
    } else {
      $("#tx-form").reset(); $('input[name="tx-kind"][value="expense"]').checked = true;
      $("#tx-date").value = todayISO(); populateTxSelects("expense"); updateSplitAvailability("expense");
      $("#tx-vendor").value = ""; $("#tx-tags").value = "";
    }
    renderTagSuggest();
    txDialog.showModal();
    setTimeout(function () { (txSplitMode ? $(".split-amt") : $("#tx-amount")).focus(); }, 30);
  }
  // Fill the vendor autocomplete datalist with vendors seen before.
  function populateVendorList() {
    var dl = $("#tx-vendor-list"); if (!dl) return;
    dl.innerHTML = FD.allVendors().map(function (v) { return '<option value="' + escapeHTML(v) + '"></option>'; }).join("");
  }
  // Render existing tags as clickable chips that toggle in/out of the Tags input.
  function renderTagSuggest() {
    var wrap = $("#tx-tag-suggest"); if (!wrap) return;
    var tags = FD.allTags();
    if (!tags.length) { wrap.innerHTML = ""; return; }
    var current = FD.normalizeTags($("#tx-tags").value).map(function (t) { return t.toLowerCase(); });
    wrap.innerHTML = tags.map(function (t) {
      var on = current.indexOf(t.toLowerCase()) !== -1;
      return '<button type="button" class="chip' + (on ? " on" : "") + '" data-tag="' + escapeHTML(t) + '">' + escapeHTML(t) + "</button>";
    }).join("");
    $all("#tx-tag-suggest .chip").forEach(function (btn) {
      btn.addEventListener("click", function () { toggleTag(btn.getAttribute("data-tag")); });
    });
  }
  function toggleTag(tag) {
    var list = FD.normalizeTags($("#tx-tags").value);
    var i = list.map(function (t) { return t.toLowerCase(); }).indexOf(tag.toLowerCase());
    if (i === -1) list.push(tag); else list.splice(i, 1);
    $("#tx-tags").value = list.join(", ");
    renderTagSuggest();
  }

  function submitTx(ev) {
    ev.preventDefault();
    var kind = currentKind(), date = $("#tx-date").value || todayISO(), desc = $("#tx-desc").value.trim();
    var vendor = $("#tx-vendor").value.trim(), tags = FD.normalizeTags($("#tx-tags").value);
    var secondary = $("#tx-secondary").value, lines;

    if (txSplitMode && (kind === "expense" || kind === "income")) {
      var splits = $all("#tx-splits .split-row").map(function (row) {
        return { accountId: row.querySelector(".split-cat").value, amount: parseFloat(row.querySelector(".split-amt").value) || 0 };
      }).filter(function (s) { return s.amount > 0; });
      if (!splits.length) { alert("Add at least one split amount."); return; }
      lines = kind === "expense" ? FD.buildExpenseSplit({ paymentId: secondary, splits: splits })
                                 : FD.buildIncomeSplit({ depositId: secondary, splits: splits });
    } else {
      var amount = parseFloat($("#tx-amount").value); if (!(amount > 0)) return;
      var primary = $("#tx-primary").value;
      if (kind === "expense") lines = FD.buildExpense({ amount: amount, categoryId: primary, paymentId: secondary });
      else if (kind === "income") lines = FD.buildIncome({ amount: amount, categoryId: primary, depositId: secondary });
      else { if (primary === secondary) { alert("Choose two different accounts for a transfer."); return; } lines = FD.buildTransfer({ amount: amount, fromId: primary, toId: secondary }); }
    }
    var editId = $("#tx-edit-id").value;
    var repeat = editId ? "none" : $("#tx-repeat").value;
    if (repeat !== "none") {
      // Create a recurring rule; it posts the first occurrence (and any backfill).
      var rule = { kind: kind, description: desc, vendor: vendor, tags: tags, freq: repeat, startDate: date, endDate: $("#tx-repeat-until").value || null, today: todayISO() };
      if (txSplitMode && (kind === "expense" || kind === "income")) {
        rule.split = true;
        rule.splits = $all("#tx-splits .split-row").map(function (row) { return { accountId: row.querySelector(".split-cat").value, amount: parseFloat(row.querySelector(".split-amt").value) || 0 }; }).filter(function (s) { return s.amount > 0; });
        if (kind === "expense") rule.paymentId = secondary; else rule.depositId = secondary;
      } else {
        rule.amount = parseFloat($("#tx-amount").value) || 0;
        var pri = $("#tx-primary").value;
        if (kind === "expense") { rule.categoryId = pri; rule.paymentId = secondary; }
        else if (kind === "income") { rule.categoryId = pri; rule.depositId = secondary; }
        else { rule.fromId = pri; rule.toId = secondary; }
      }
      FD.addRecurring(rule);
    } else {
      var savedId = editId;
      if (editId) FD.updateEntry(editId, { date: date, description: desc, vendor: vendor, tags: tags, kind: kind, lines: lines });
      else savedId = FD.addEntry({ date: date, description: desc, vendor: vendor, tags: tags, kind: kind, lines: lines }).id;
      // Apply a receipt change (pendingAttachment: undefined=keep, null=remove, object=set).
      if (typeof pendingAttachment !== "undefined" && savedId) {
        if (pendingAttachment === null) FD.removeAttachment(savedId);
        else FD.setAttachment(savedId, pendingAttachment);
      }
    }
    txDialog.close(); refresh();
  }

  // ----- Receipt attachments -----
  function currentAttachment() {
    if (typeof pendingAttachment !== "undefined") return pendingAttachment; // object or null
    var eid = $("#tx-edit-id").value; return eid ? FD.getAttachment(eid) : null;
  }
  function renderTxAttach() {
    var att = currentAttachment(), wrap = $("#tx-attach");
    if (att && att.dataUrl) {
      wrap.innerHTML = '<div class="attach-preview"><img id="tx-attach-thumb" alt="receipt" /><div class="attach-actions">' +
        '<button type="button" class="btn btn-ghost btn-sm" id="tx-attach-view">View</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="tx-attach-replace">Replace</button>' +
        '<button type="button" class="btn btn-danger btn-sm" id="tx-attach-remove">Remove</button></div></div>';
      $("#tx-attach-thumb").src = att.dataUrl;
      $("#tx-attach-view").addEventListener("click", function () { openLightbox(att.dataUrl); });
      $("#tx-attach-thumb").addEventListener("click", function () { openLightbox(att.dataUrl); });
      $("#tx-attach-replace").addEventListener("click", function () { $("#tx-attach-input").click(); });
      $("#tx-attach-remove").addEventListener("click", function () { pendingAttachment = null; renderTxAttach(); });
    } else {
      wrap.innerHTML = '<button type="button" class="btn btn-ghost btn-sm" id="tx-attach-add">📎 Attach receipt</button>';
      $("#tx-attach-add").addEventListener("click", function () { $("#tx-attach-input").click(); });
    }
  }
  function downscaleImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1200, scale = Math.min(1, max / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        cb(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = function () { alert("That image couldn't be read."); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  function handleAttachFile(ev) {
    var file = ev.target.files && ev.target.files[0]; ev.target.value = "";
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert("Please choose an image file."); return; }
    downscaleImage(file, function (dataUrl) { pendingAttachment = { name: file.name, type: "image/jpeg", dataUrl: dataUrl }; renderTxAttach(); });
  }
  function openLightbox(url) { $("#img-lightbox-img").src = url; $("#img-lightbox").showModal(); }
  function closeLightbox() { var d = $("#img-lightbox"); if (d.open) d.close(); $("#img-lightbox-img").src = ""; }
  function deleteTx() {
    var editId = $("#tx-edit-id").value; if (!editId) return;
    if (!confirm("Delete this transaction?")) return;
    FD.deleteEntry(editId); txDialog.close(); refresh();
  }

  // ---------- Account dialog ----------
  function populateParentOptions(type, selectedId, excludeId) {
    var candidates = FD.topLevel(FD.state.accounts, type).filter(function (a) { return a.id !== excludeId; });
    $("#acct-parent").innerHTML = '<option value="">— Top level —</option>' + candidates.map(function (a) {
      return '<option value="' + a.id + '"' + (a.id === selectedId ? " selected" : "") + ">" + escapeHTML(a.icon + " " + a.name) + "</option>";
    }).join("");
  }
  function updateAccountDialogForType() {
    var type = $("#acct-type").value, showOpening = type === "asset" || type === "liability";
    $("#acct-opening-wrap").style.display = showOpening ? "" : "none";
    var canNest = type === "expense" || type === "income" || type === "asset" || type === "liability";
    $("#acct-parent-field").style.display = canNest ? "" : "none";
    var editId = $("#acct-edit-id").value;
    if (canNest) populateParentOptions(type, $("#acct-parent").value, editId || null);
    var hints = { asset: "Things you own — bank accounts, cash, investments, property.", liability: "Things you owe — credit cards, loans, mortgage.", income: "A source of income to categorize deposits.", expense: "A spending category for your expenses.", equity: "Owner's equity / net worth accounts." };
    $("#acct-type-hint").textContent = hints[type] || "";
  }
  // Emoji choices for the icon picker (finance + everyday life).
  var ICONS = ("🏦 💰 💵 💳 🪙 💸 🧾 📈 📉 🏛️ 🤑 🏠 🏡 🔑 💡 ⚡ 🔥 🚰 💧 🌐 📶 📱 ☎️ 🗑️ 🛒 🍽️ 🍎 🥦 🍞 ☕ 🍕 🍔 🍺 🍷 🧻 🧼 🚗 ⛽ 🚌 🚕 🚆 ✈️ 🚲 🅿️ 🏥 💊 🩺 🦷 💪 🧘 🏋️ 🎬 🎮 🎵 🎨 🎟️ 🎉 📺 🎧 🏖️ 🛍️ 👕 👟 💻 🎁 📚 🐶 🐱 👶 🎓 💇 📦 🔁 🛡️ 💼 🧑‍💻 🏆 ⭐ ❤️ ✅ 🔔 ⚖️ 🌟").split(" ");
  function renderIconGrid() {
    var grid = $("#acct-icon-grid"), current = ($("#acct-icon").value || "").trim();
    grid.innerHTML = ICONS.map(function (e) {
      return '<button type="button" class="icon-opt' + (e === current ? " sel" : "") + '" data-emoji="' + e + '">' + e + "</button>";
    }).join("");
    $all(".icon-opt", grid).forEach(function (btn) {
      btn.addEventListener("click", function () { $("#acct-icon").value = btn.dataset.emoji; refreshIconSelection(); });
    });
  }
  function refreshIconSelection() {
    var current = ($("#acct-icon").value || "").trim();
    $all("#acct-icon-grid .icon-opt").forEach(function (b) { b.classList.toggle("sel", b.dataset.emoji === current); });
  }
  function openAccountDialog(editId, preset) {
    $("#acct-edit-id").value = editId || ""; $("#account-form").reset();
    var typeSel = $("#acct-type"), del = $("#acct-delete");
    if (editId) {
      var a = FD.getAccount(editId);
      $("#account-dialog-title").textContent = "Edit Account";
      $("#acct-name").value = a.name; $("#acct-icon").value = a.icon;
      typeSel.value = a.type; typeSel.disabled = true;
      updateAccountDialogForType();
      populateParentOptions(a.type, a.parentId || "", editId);
      if (a.type === "asset" || a.type === "liability") {
        var ob = FD.getOpeningBalance(editId);
        $("#acct-opening").value = ob ? ob.amount : "";
        $("#acct-opening-date").value = ob ? ob.date : todayISO();
      }
      // A parent (has children) cannot itself become a child.
      $("#acct-parent-field").style.display = (FD.hasChildren(FD.state.accounts, editId)) ? "none" : $("#acct-parent-field").style.display;
      var used = FD.accountHasEntries(editId) || FD.hasChildren(FD.state.accounts, editId);
      del.hidden = false; del.disabled = used; del.textContent = used ? "In use — can't delete" : "Delete";
    } else {
      $("#account-dialog-title").textContent = preset && preset.parentId ? "New Subcategory" : "New Account";
      typeSel.disabled = false; typeSel.value = (preset && preset.type) || "asset";
      $("#acct-opening-date").value = todayISO(); del.hidden = true;
      updateAccountDialogForType();
      if (preset && preset.parentId) { $("#acct-parent").value = preset.parentId; }
    }
    renderIconGrid();
    accountDialog.showModal();
    setTimeout(function () { $("#acct-name").focus(); }, 30);
  }
  function submitAccount(ev) {
    ev.preventDefault();
    var name = $("#acct-name").value.trim(); if (!name) return;
    var editId = $("#acct-edit-id").value, parentId = $("#acct-parent-field").style.display === "none" ? "" : $("#acct-parent").value;
    if (editId) {
      FD.updateAccount(editId, { name: name, icon: $("#acct-icon").value.trim(), parentId: parentId });
      var a = FD.getAccount(editId);
      if (a && (a.type === "asset" || a.type === "liability")) {
        FD.setOpeningBalance(editId, parseFloat($("#acct-opening").value) || 0, $("#acct-opening-date").value || todayISO());
      }
    } else {
      FD.addAccount({ name: name, type: $("#acct-type").value, icon: $("#acct-icon").value.trim(), parentId: parentId || undefined, opening: parseFloat($("#acct-opening").value) || 0, openingDate: $("#acct-opening-date").value || todayISO() });
    }
    accountDialog.close(); refresh();
  }
  function deleteAccountAction() {
    var editId = $("#acct-edit-id").value; if (!editId) return;
    if (FD.accountHasEntries(editId) || FD.hasChildren(FD.state.accounts, editId)) return;
    if (!confirm("Delete this account?")) return;
    FD.deleteAccount(editId); accountDialog.close(); acctView.id = null; refresh();
  }

  // ---------- CSV ----------
  function csvEscape(f) { var s = String(f == null ? "" : f); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function nameOf(id) { var a = FD.getAccount(id); return a ? a.name : ""; }
  function exportCSV() {
    var j = FD.state.journal.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var out = [];
    j.forEach(function (e) {
      var d = FD.describeEntry(e), ven = e.vendor || "", tg = (e.tags || []).join("; ");
      if (d.kind === "expense" && d.split) { d.splits.forEach(function (s) { out.push([e.date, "expense", e.description, s.amount, nameOf(s.accountId), nameOf(d.paymentId), ven, tg]); }); }
      else if (d.kind === "income" && d.split) { d.splits.forEach(function (s) { out.push([e.date, "income", e.description, s.amount, nameOf(s.accountId), nameOf(d.depositId), ven, tg]); }); }
      else if (d.kind === "expense") { out.push([e.date, "expense", e.description, d.amount, nameOf(d.categoryId), nameOf(d.paymentId), ven, tg]); }
      else if (d.kind === "income") { out.push([e.date, "income", e.description, d.amount, nameOf(d.categoryId), nameOf(d.depositId), ven, tg]); }
      else if (d.kind === "transfer") { out.push([e.date, "transfer", e.description, d.amount, nameOf(d.fromId), nameOf(d.toId), ven, tg]); }
    });
    if (!out.length) { alert("No transactions to export."); return; }
    var header = ["date", "type", "description", "amount", "category", "account", "vendor", "tags"];
    var csv = [header.join(",")].concat(out.map(function (r) { return r.map(csvEscape).join(","); })).join("\n");
    download("finance-desk-" + currentMonthKey() + ".csv", csv, "text/csv;charset=utf-8;");
  }
  function parseCSV(text) {
    var rows = [], row = [], field = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); field = ""; rows.push(row); row = []; }
      else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length && r.some(function (v) { return v.trim() !== ""; }); });
  }
  function findAccountByName(name, types) {
    var lower = String(name || "").trim().toLowerCase();
    return FD.state.accounts.find(function (a) { return types.indexOf(a.type) !== -1 && a.name.toLowerCase() === lower; });
  }
  function importCSV(text) {
    var rows = parseCSV(text); if (!rows.length) { alert("The CSV file is empty."); return; }
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var idx = { date: head.indexOf("date"), type: head.indexOf("type"), description: head.indexOf("description"), amount: head.indexOf("amount"), category: head.indexOf("category"), account: head.indexOf("account"), vendor: head.indexOf("vendor"), tags: head.indexOf("tags") };
    var start = idx.date !== -1 && idx.amount !== -1 ? 1 : 0;
    if (start === 0) idx = { date: 0, type: 1, description: 2, amount: 3, category: 4, account: 5, vendor: 6, tags: 7 };
    var added = 0, skipped = 0;
    for (var i = start; i < rows.length; i++) {
      var r = rows[i], date = (r[idx.date] || "").trim(), amount = parseFloat(r[idx.amount]), type = (r[idx.type] || "expense").trim().toLowerCase();
      if (!(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
      var desc = (r[idx.description] || "").trim(), catName = (r[idx.category] || "").trim(), acctName = (r[idx.account] || "").trim();
      var vendor = idx.vendor !== -1 ? (r[idx.vendor] || "").trim() : "";
      var tags = idx.tags !== -1 ? FD.normalizeTags((r[idx.tags] || "").replace(/;/g, ",")) : [];
      if (type === "income") {
        var inc = findAccountByName(catName, ["income"]) || FD.getAccount("inc-other"), dep = findAccountByName(acctName, ["asset"]) || FD.getAccount("checking");
        FD.addEntry({ date: date, description: desc, vendor: vendor, tags: tags, kind: "income", lines: FD.buildIncome({ amount: amount, categoryId: inc.id, depositId: dep.id }) }); added++;
      } else if (type === "transfer") {
        var from = findAccountByName(catName, ["asset", "liability"]), to = findAccountByName(acctName, ["asset", "liability"]);
        if (!from || !to || from.id === to.id) { skipped++; continue; }
        FD.addEntry({ date: date, description: desc, vendor: vendor, tags: tags, kind: "transfer", lines: FD.buildTransfer({ amount: amount, fromId: from.id, toId: to.id }) }); added++;
      } else {
        var cat = findAccountByName(catName, ["expense"]) || FD.getAccount("exp-other"), pay = findAccountByName(acctName, ["asset", "liability"]) || FD.getAccount("checking");
        FD.addEntry({ date: date, description: desc, vendor: vendor, tags: tags, kind: "expense", lines: FD.buildExpense({ amount: amount, categoryId: cat.id, paymentId: pay.id }) }); added++;
      }
    }
    refresh();
    alert("Imported " + added + " row" + (added === 1 ? "" : "s") + "." + (skipped ? " Skipped " + skipped + " invalid row" + (skipped === 1 ? "" : "s") + "." : ""));
  }
  function handleImportFile(ev) {
    var file = ev.target.files && ev.target.files[0]; if (!file) return;
    var reader = new FileReader(); reader.onload = function () { importCSV(String(reader.result)); }; reader.onerror = function () { alert("Could not read the file."); };
    reader.readAsText(file); ev.target.value = "";
  }

  // ---------- Theme ----------
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var label = theme === "dark" ? "☀️" : "🌙";
    $("#theme-toggle").textContent = label; var mt = $("#menu-theme"); if (mt) mt.textContent = label;
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }
  function toggleTheme() { var cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; applyTheme(cur === "dark" ? "light" : "dark"); refresh(); }
  function initTheme() {
    var saved = null; try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(saved || (prefersDark ? "dark" : "light"));
  }

  // ---------- Wire up ----------
  function bindDialogs() {
    txDialog = $("#tx-dialog"); accountDialog = $("#account-dialog");
    $("#tx-form").addEventListener("submit", submitTx);
    $("#tx-tags").addEventListener("input", renderTagSuggest);
    $("#tx-delete").addEventListener("click", deleteTx);
    $("#tx-split-toggle").addEventListener("click", toggleSplitMode);
    $("#tx-add-split").addEventListener("click", function () { addSplitRow(); });
    $("#tx-repeat").addEventListener("change", function () {
      var repeating = this.value !== "none";
      $("#tx-repeat-until-field").style.display = repeating ? "" : "none";
      $("#tx-attach-field").style.display = repeating ? "none" : ""; // recurring rules don't carry receipts
    });
    $("#tx-attach-input").addEventListener("change", handleAttachFile);
    $("#img-lightbox").addEventListener("click", closeLightbox);
    $all('input[name="tx-kind"]').forEach(function (r) {
      r.addEventListener("change", function () {
        var k = currentKind(); populateTxSelects(k); updateSplitAvailability(k);
        if (txSplitMode) { // rebuild split category options for the new kind
          var amounts = $all("#tx-splits .split-amt").map(function (i) { return i.value; });
          $("#tx-splits").innerHTML = ""; amounts.forEach(function (amt) { addSplitRow(null, amt || null); });
        }
      });
    });
    $("#account-form").addEventListener("submit", submitAccount);
    $("#acct-delete").addEventListener("click", deleteAccountAction);
    $("#acct-type").addEventListener("change", updateAccountDialogForType);
    $("#acct-icon").addEventListener("input", refreshIconSelection);
    $("#pin-form").addEventListener("submit", submitPin);
    $("#e2ee-form").addEventListener("submit", submitE2EE);
    $all("[data-close]").forEach(function (btn) { btn.addEventListener("click", function () { btn.closest("dialog").close(); }); });
  }

  // ----- Lock screen -----
  function showLock() { $("#lock-screen").hidden = false; setTimeout(function () { $("#lock-pin").focus(); }, 30); }
  function hideLock() { $("#lock-screen").hidden = true; $("#lock-pin").value = ""; }
  function doUnlock() {
    var pin = $("#lock-pin").value, err = $("#lock-error"); err.hidden = true;
    FDVault.unlock(pin).then(function (data) { FD.hydrate(data); hideLock(); boot(); })
      .catch(function (e) { err.textContent = e.message || "Incorrect PIN."; err.hidden = false; $("#lock-pin").select(); });
  }

  var booted = false;
  function boot() {
    if (booted) return; booted = true;
    FD.postDueRecurring(todayISO()); // catch up any recurring transactions due
    bindDialogs();
    $("#new-tx-btn").addEventListener("click", function () { openTxDialog(null); });
    $("#new-tx-tab").addEventListener("click", function () { openTxDialog(null); });
    $("#theme-toggle").addEventListener("click", toggleTheme);
    var mt = $("#menu-theme"); if (mt) mt.addEventListener("click", toggleTheme);
    // Local changes trigger a debounced auto-sync (unless we're applying a remote merge).
    FD.onChange(function () { if (!applyingRemote) scheduleAutoSync(); });
    window.addEventListener("hashchange", navigate);
    if (!location.hash) location.hash = "#dashboard";
    navigate();
    if (FDSync.isAutoSync() && FDSync.isLoggedIn()) startAutoTimer();
  }
  function init() {
    initTheme();
    $("#lock-form").addEventListener("submit", function (e) { e.preventDefault(); doUnlock(); });
    if (window.FDVault && FD.isEncrypted()) { showLock(); }  // wait for PIN before loading data
    else { FD.init(); boot(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
