/* FinTrack — Personal Finance Tracker
 * Vanilla JS, persisted to localStorage. No dependencies. */

(function () {
  "use strict";

  const STORAGE_KEY = "fintrack.transactions";
  const BUDGET_KEY = "fintrack.budgets";
  const THEME_KEY = "fintrack.theme";

  const CATEGORIES = {
    expense: [
      { name: "Groceries", icon: "🛒" },
      { name: "Rent", icon: "🏠" },
      { name: "Utilities", icon: "💡" },
      { name: "Transport", icon: "🚗" },
      { name: "Dining", icon: "🍽️" },
      { name: "Entertainment", icon: "🎬" },
      { name: "Health", icon: "🏥" },
      { name: "Shopping", icon: "🛍️" },
      { name: "Other", icon: "📦" },
    ],
    income: [
      { name: "Salary", icon: "💼" },
      { name: "Freelance", icon: "🧑‍💻" },
      { name: "Investment", icon: "📈" },
      { name: "Gift", icon: "🎁" },
      { name: "Other", icon: "💰" },
    ],
  };

  // Colors used for the category chart (cycled).
  const CHART_COLORS = [
    "#4f7cff", "#e5484d", "#1fae7a", "#f5a623", "#9b59b6",
    "#00bcd4", "#ff6f91", "#8bc34a", "#795548",
  ];

  // --- State ---
  let transactions = load(STORAGE_KEY, []);
  let budgets = load(BUDGET_KEY, {}); // { categoryName: monthlyLimit }
  let editingId = null;

  // --- Elements ---
  const el = {
    form: document.getElementById("transaction-form"),
    formTitle: document.getElementById("form-title"),
    editId: document.getElementById("edit-id"),
    description: document.getElementById("description"),
    amount: document.getElementById("amount"),
    date: document.getElementById("date"),
    category: document.getElementById("category"),
    submitBtn: document.getElementById("submit-btn"),
    cancelEdit: document.getElementById("cancel-edit"),
    list: document.getElementById("transaction-list"),
    listEmpty: document.getElementById("list-empty"),
    balance: document.getElementById("balance"),
    totalIncome: document.getElementById("total-income"),
    totalExpense: document.getElementById("total-expense"),
    filterType: document.getElementById("filter-type"),
    filterCategory: document.getElementById("filter-category"),
    chart: document.getElementById("chart"),
    chartEmpty: document.getElementById("chart-empty"),
    chartLegend: document.getElementById("chart-legend"),
    themeToggle: document.getElementById("theme-toggle"),
    budgetList: document.getElementById("budget-list"),
    budgetMonth: document.getElementById("budget-month"),
    exportBtn: document.getElementById("export-btn"),
    importBtn: document.getElementById("import-btn"),
    importInput: document.getElementById("import-input"),
  };

  // --- Persistence ---
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error("Failed to load", key, e);
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error("Failed to save", key, e);
    }
  }

  // --- Helpers ---
  function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  }

  function formatDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function iconFor(type, category) {
    const list = CATEGORIES[type] || [];
    const found = list.find((c) => c.name === category);
    return found ? found.icon : "📦";
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function currentMonthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function monthKeyOf(iso) {
    return (iso || "").slice(0, 7); // "YYYY-MM"
  }

  // --- Category dropdowns ---
  function currentType() {
    const checked = el.form.querySelector('input[name="type"]:checked');
    return checked ? checked.value : "expense";
  }

  function populateCategorySelect() {
    const type = currentType();
    const previous = el.category.value;
    el.category.innerHTML = "";
    CATEGORIES[type].forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = `${c.icon}  ${c.name}`;
      el.category.appendChild(opt);
    });
    // Preserve selection when possible (used when entering edit mode).
    if (CATEGORIES[type].some((c) => c.name === previous)) el.category.value = previous;
  }

  function populateFilterCategories() {
    const all = [...CATEGORIES.expense, ...CATEGORIES.income].map((c) => c.name);
    const unique = [...new Set(all)];
    const current = el.filterCategory.value;
    el.filterCategory.innerHTML = '<option value="all">All categories</option>';
    unique.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      el.filterCategory.appendChild(opt);
    });
    el.filterCategory.value = current || "all";
  }

  // --- Rendering ---
  function getFiltered() {
    const type = el.filterType.value;
    const category = el.filterCategory.value;
    return transactions.filter((t) => {
      if (type !== "all" && t.type !== type) return false;
      if (category !== "all" && t.category !== category) return false;
      return true;
    });
  }

  function renderSummary() {
    let income = 0;
    let expense = 0;
    transactions.forEach((t) => {
      if (t.type === "income") income += t.amount;
      else expense += t.amount;
    });
    el.totalIncome.textContent = formatCurrency(income);
    el.totalExpense.textContent = formatCurrency(expense);
    el.balance.textContent = formatCurrency(income - expense);
  }

  function renderList() {
    const filtered = getFiltered().slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });

    el.list.innerHTML = "";
    el.listEmpty.style.display = filtered.length ? "none" : "block";

    filtered.forEach((t) => {
      const li = document.createElement("li");
      li.className = "transaction-item" + (t.id === editingId ? " editing" : "");

      const sign = t.type === "income" ? "+" : "−";
      li.innerHTML = `
        <div class="tx-icon">${iconFor(t.type, t.category)}</div>
        <div class="tx-body">
          <div class="tx-desc"></div>
          <div class="tx-meta"></div>
        </div>
        <div class="tx-amount ${t.type}">${sign}${formatCurrency(t.amount)}</div>
        <div class="tx-actions">
          <button class="tx-btn tx-edit" title="Edit" aria-label="Edit transaction">✎</button>
          <button class="tx-btn tx-delete" title="Delete" aria-label="Delete transaction">✕</button>
        </div>
      `;
      li.querySelector(".tx-desc").textContent = t.description;
      li.querySelector(".tx-meta").textContent = `${t.category} · ${formatDate(t.date)}`;
      li.querySelector(".tx-edit").addEventListener("click", () => startEdit(t.id));
      li.querySelector(".tx-delete").addEventListener("click", () => deleteTransaction(t.id));

      el.list.appendChild(li);
    });
  }

  function renderChart() {
    const ctx = el.chart.getContext("2d");
    const size = el.chart.width;
    ctx.clearRect(0, 0, size, size);

    // Aggregate expenses by category.
    const totals = {};
    transactions.forEach((t) => {
      if (t.type !== "expense") return;
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    });

    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const grandTotal = entries.reduce((sum, [, v]) => sum + v, 0);

    el.chartLegend.innerHTML = "";

    if (!entries.length) {
      el.chart.style.display = "none";
      el.chartEmpty.style.display = "block";
      return;
    }
    el.chart.style.display = "block";
    el.chartEmpty.style.display = "none";

    // Draw donut.
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 10;
    const inner = radius * 0.58;
    let start = -Math.PI / 2;

    entries.forEach(([category, value], i) => {
      const slice = (value / grandTotal) * Math.PI * 2;
      const color = CHART_COLORS[i % CHART_COLORS.length];

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, start + slice);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      start += slice;

      // Legend row.
      const percent = ((value / grandTotal) * 100).toFixed(0);
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="dot" style="background:${color}"></span>
        <span class="legend-name"></span>
        <span class="legend-amount">${formatCurrency(value)} (${percent}%)</span>
      `;
      li.querySelector(".legend-name").textContent = category;
      el.chartLegend.appendChild(li);
    });

    // Punch out the middle to make a donut.
    const surface = getComputedStyle(document.body).getPropertyValue("--surface").trim() || "#fff";
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fillStyle = surface;
    ctx.fill();

    // Total in the center.
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text").trim() || "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 20px -apple-system, sans-serif";
    ctx.fillText(formatCurrency(grandTotal), cx, cy - 6);
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text-muted").trim() || "#888";
    ctx.font = "500 12px -apple-system, sans-serif";
    ctx.fillText("Total spent", cx, cy + 14);
  }

  function renderBudgets() {
    const monthKey = currentMonthKey();
    el.budgetMonth.textContent = new Date().toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    // Spending this month, per category.
    const spent = {};
    transactions.forEach((t) => {
      if (t.type !== "expense") return;
      if (monthKeyOf(t.date) !== monthKey) return;
      spent[t.category] = (spent[t.category] || 0) + t.amount;
    });

    el.budgetList.innerHTML = "";
    CATEGORIES.expense.forEach((cat) => {
      const limit = Number(budgets[cat.name]) || 0;
      const used = spent[cat.name] || 0;
      const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;

      let fillClass = "";
      if (limit > 0) {
        if (used > limit) fillClass = "over";
        else if (used / limit >= 0.8) fillClass = "warn";
      }

      const li = document.createElement("li");
      li.className = "budget-row";
      li.innerHTML = `
        <div class="budget-top">
          <span class="budget-name"><span>${cat.icon}</span><span class="budget-cat"></span></span>
          <span class="budget-spent"></span>
          <input class="budget-input" type="number" min="0" step="1" placeholder="No limit" />
        </div>
        <div class="budget-bar"><div class="budget-fill ${fillClass}" style="width:${pct}%"></div></div>
      `;
      li.querySelector(".budget-cat").textContent = cat.name;

      const spentEl = li.querySelector(".budget-spent");
      if (limit > 0) {
        spentEl.textContent = `${formatCurrency(used)} of ${formatCurrency(limit)}`;
        if (used > limit) {
          spentEl.classList.add("budget-over-note");
          spentEl.textContent = `${formatCurrency(used)} of ${formatCurrency(limit)} · over by ${formatCurrency(used - limit)}`;
        }
      } else {
        spentEl.textContent = `${formatCurrency(used)} spent`;
      }

      const input = li.querySelector(".budget-input");
      if (limit > 0) input.value = limit;
      input.addEventListener("change", () => setBudget(cat.name, input.value));

      el.budgetList.appendChild(li);
    });
  }

  function renderAll() {
    renderSummary();
    renderList();
    renderChart();
    renderBudgets();
  }

  // --- Actions: transactions ---
  function submitForm(e) {
    e.preventDefault();
    const amount = parseFloat(el.amount.value);
    if (!(amount > 0)) return;

    const data = {
      type: currentType(),
      description: el.description.value.trim(),
      amount: amount,
      category: el.category.value,
      date: el.date.value,
    };

    if (editingId) {
      const idx = transactions.findIndex((t) => t.id === editingId);
      if (idx !== -1) transactions[idx] = Object.assign({}, transactions[idx], data);
      exitEditMode();
    } else {
      transactions.push(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, data));
    }

    save(STORAGE_KEY, transactions);
    renderAll();
    el.form.reset();
    setToday();
    populateCategorySelect();
    el.description.focus();
  }

  function startEdit(id) {
    const t = transactions.find((x) => x.id === id);
    if (!t) return;
    editingId = id;

    el.form.querySelector(`input[name="type"][value="${t.type}"]`).checked = true;
    populateCategorySelect();
    el.description.value = t.description;
    el.amount.value = t.amount;
    el.date.value = t.date;
    el.category.value = t.category;

    el.formTitle.textContent = "Edit Transaction";
    el.submitBtn.textContent = "Update Transaction";
    el.cancelEdit.hidden = false;
    renderList();
    el.form.scrollIntoView({ behavior: "smooth", block: "start" });
    el.description.focus();
  }

  function exitEditMode() {
    editingId = null;
    el.formTitle.textContent = "Add Transaction";
    el.submitBtn.textContent = "Add Transaction";
    el.cancelEdit.hidden = true;
  }

  function cancelEdit() {
    exitEditMode();
    el.form.reset();
    setToday();
    populateCategorySelect();
    renderList();
  }

  function deleteTransaction(id) {
    if (id === editingId) cancelEdit();
    transactions = transactions.filter((t) => t.id !== id);
    save(STORAGE_KEY, transactions);
    renderAll();
  }

  // --- Actions: budgets ---
  function setBudget(category, rawValue) {
    const value = Number(rawValue);
    if (value > 0) budgets[category] = value;
    else delete budgets[category];
    save(BUDGET_KEY, budgets);
    renderBudgets();
  }

  // --- CSV export / import ---
  function csvEscape(field) {
    const s = String(field == null ? "" : field);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCSV() {
    if (!transactions.length) {
      alert("No transactions to export.");
      return;
    }
    const header = ["type", "description", "amount", "category", "date"];
    const rows = transactions
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((t) => [t.type, t.description, t.amount, t.category, t.date].map(csvEscape).join(","));
    const csv = [header.join(","), ...rows].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fintrack-${currentMonthKey()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Minimal RFC-4180-ish CSV parser (handles quotes, commas, escaped quotes).
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        rows.push(row); row = [];
      } else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length && r.some((v) => v.trim() !== ""));
  }

  function importCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) { alert("The CSV file is empty."); return; }

    // Detect and skip a header row.
    const first = rows[0].map((h) => h.trim().toLowerCase());
    let startIdx = 0;
    let cols = { type: 0, description: 1, amount: 2, category: 3, date: 4 };
    if (first.includes("amount") && first.includes("date")) {
      cols = {
        type: first.indexOf("type"),
        description: first.indexOf("description"),
        amount: first.indexOf("amount"),
        category: first.indexOf("category"),
        date: first.indexOf("date"),
      };
      startIdx = 1;
    }

    let added = 0;
    let skipped = 0;
    for (let i = startIdx; i < rows.length; i++) {
      const r = rows[i];
      const type = (r[cols.type] || "").trim().toLowerCase() === "income" ? "income" : "expense";
      const amount = parseFloat(r[cols.amount]);
      const date = (r[cols.date] || "").trim();
      if (!(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }

      const rawCat = (r[cols.category] || "").trim();
      const validCat = CATEGORIES[type].some((c) => c.name === rawCat);
      transactions.push({
        id: uid(),
        type: type,
        description: (r[cols.description] || "").trim() || "Imported",
        amount: amount,
        category: validCat ? rawCat : "Other",
        date: date,
        createdAt: new Date().toISOString(),
      });
      added++;
    }

    save(STORAGE_KEY, transactions);
    renderAll();
    alert(`Imported ${added} transaction${added === 1 ? "" : "s"}.` + (skipped ? ` Skipped ${skipped} invalid row${skipped === 1 ? "" : "s"}.` : ""));
  }

  function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importCSV(String(reader.result));
    reader.onerror = () => alert("Could not read the file.");
    reader.readAsText(file);
    e.target.value = ""; // allow re-importing the same file
  }

  // --- Theme ---
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    el.themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
    localStorage.setItem(THEME_KEY, theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    applyTheme(current === "dark" ? "light" : "dark");
    renderChart(); // redraw with new surface/text colors
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(saved || (prefersDark ? "dark" : "light"));
  }

  function setToday() {
    el.date.value = new Date().toISOString().slice(0, 10);
  }

  // --- Init ---
  function init() {
    initTheme();
    setToday();
    populateCategorySelect();
    populateFilterCategories();
    renderAll();

    el.form.addEventListener("submit", submitForm);
    el.form.querySelectorAll('input[name="type"]').forEach((r) =>
      r.addEventListener("change", populateCategorySelect)
    );
    el.cancelEdit.addEventListener("click", cancelEdit);
    el.filterType.addEventListener("change", renderList);
    el.filterCategory.addEventListener("change", renderList);
    el.themeToggle.addEventListener("click", toggleTheme);
    el.exportBtn.addEventListener("click", exportCSV);
    el.importBtn.addEventListener("click", () => el.importInput.click());
    el.importInput.addEventListener("change", handleImportFile);
  }

  init();
})();
