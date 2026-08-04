/* FinTrack — Personal Finance Tracker
 * Vanilla JS, persisted to localStorage. No dependencies. */

(function () {
  "use strict";

  const STORAGE_KEY = "fintrack.transactions";
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
  let transactions = load();

  // --- Elements ---
  const el = {
    form: document.getElementById("transaction-form"),
    description: document.getElementById("description"),
    amount: document.getElementById("amount"),
    date: document.getElementById("date"),
    category: document.getElementById("category"),
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
  };

  // --- Persistence ---
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("Failed to load transactions:", e);
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    } catch (e) {
      console.error("Failed to save transactions:", e);
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

  // --- Category dropdowns ---
  function currentType() {
    const checked = el.form.querySelector('input[name="type"]:checked');
    return checked ? checked.value : "expense";
  }

  function populateCategorySelect() {
    const type = currentType();
    el.category.innerHTML = "";
    CATEGORIES[type].forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = `${c.icon}  ${c.name}`;
      el.category.appendChild(opt);
    });
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
      li.className = "transaction-item";

      const sign = t.type === "income" ? "+" : "−";
      li.innerHTML = `
        <div class="tx-icon">${iconFor(t.type, t.category)}</div>
        <div class="tx-body">
          <div class="tx-desc"></div>
          <div class="tx-meta"></div>
        </div>
        <div class="tx-amount ${t.type}">${sign}${formatCurrency(t.amount)}</div>
        <button class="tx-delete" title="Delete" aria-label="Delete transaction">✕</button>
      `;
      li.querySelector(".tx-desc").textContent = t.description;
      li.querySelector(".tx-meta").textContent = `${t.category} · ${formatDate(t.date)}`;
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

  function renderAll() {
    renderSummary();
    renderList();
    renderChart();
  }

  // --- Actions ---
  function addTransaction(e) {
    e.preventDefault();
    const amount = parseFloat(el.amount.value);
    if (!(amount > 0)) return;

    transactions.push({
      id: uid(),
      type: currentType(),
      description: el.description.value.trim(),
      amount: amount,
      category: el.category.value,
      date: el.date.value,
      createdAt: new Date().toISOString(),
    });

    save();
    renderAll();
    el.form.reset();
    setToday();
    populateCategorySelect();
    el.description.focus();
  }

  function deleteTransaction(id) {
    transactions = transactions.filter((t) => t.id !== id);
    save();
    renderAll();
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

    el.form.addEventListener("submit", addTransaction);
    el.form.querySelectorAll('input[name="type"]').forEach((r) =>
      r.addEventListener("change", populateCategorySelect)
    );
    el.filterType.addEventListener("change", renderList);
    el.filterCategory.addEventListener("change", renderList);
    el.themeToggle.addEventListener("click", toggleTheme);
  }

  init();
})();
