(() => {
  'use strict';

  const STORAGE_KEY = 'expenses_v1';
  const SETTINGS_KEY = 'settings_v1';
  const RECURRING_KEY = 'recurring_v1';
  const BUDGETS_KEY = 'budgets_v1';

  const CATEGORIES = [
    { id: 'comida',        label: 'Comida',        emoji: '🍔', color: '--cat-comida' },
    { id: 'transporte',    label: 'Transporte',    emoji: '🚗', color: '--cat-transporte' },
    { id: 'vivienda',      label: 'Vivienda',      emoji: '🏠', color: '--cat-vivienda' },
    { id: 'boliche',       label: 'Boliche',       emoji: '🪩', color: '--cat-boliche' },
    { id: 'juntas',        label: 'Juntas',        emoji: '🍻', color: '--cat-juntas' },
    { id: 'salud',         label: 'Entrenamiento', emoji: '💪', color: '--cat-entrenamiento' },
    { id: 'compras',       label: 'Compras',       emoji: '🛍️', color: '--cat-compras' },
    { id: 'ahorro',        label: 'Ahorro',        emoji: '🐷', color: '--cat-ahorro' },
    { id: 'inversiones',   label: 'Inversiones',   emoji: '📈', color: '--cat-inversiones' },
    { id: 'otros',         label: 'Otros',         emoji: '📦', color: '--cat-otros' },
  ];
  const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
  const BUDGET_EXCLUDED_CATEGORIES = ['ahorro', 'inversiones'];

  const CURRENCIES = ['USD', 'EUR', 'ARS', 'MXN', 'CLP', 'COP', 'PEN', 'UYU', 'BOB', 'GTQ', 'BRL', 'CRC'];

  // ---------- State ----------

  let expenses = loadExpenses();
  let settings = loadSettings();
  let recurring = loadRecurring();
  let budgets = loadBudgets();
  let viewedMonth = startOfMonth(new Date());
  let selectedCategory = null;
  let pendingDelete = null; // { expense, timeoutId } for undo

  function loadExpenses() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  function saveExpenses() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return { currency: parsed.currency || guessCurrency() };
    } catch { return { currency: guessCurrency() }; }
  }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  function loadRecurring() {
    try {
      const raw = localStorage.getItem(RECURRING_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  function saveRecurring() {
    localStorage.setItem(RECURRING_KEY, JSON.stringify(recurring));
  }
  function loadBudgets() {
    try {
      const raw = localStorage.getItem(BUDGETS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { default: parsed.default ?? null, overrides: parsed.overrides || {} };
      }
    } catch { /* fall through to migration */ }
    // Migrate a legacy single global budget from an older version of the app.
    try {
      const rawSettings = localStorage.getItem(SETTINGS_KEY);
      const parsedSettings = rawSettings ? JSON.parse(rawSettings) : {};
      if (parsedSettings.budget > 0) return { default: parsedSettings.budget, overrides: {} };
    } catch { /* ignore */ }
    return { default: null, overrides: {} };
  }
  function saveBudgets() {
    localStorage.setItem(BUDGETS_KEY, JSON.stringify(budgets));
  }
  function getBudgetForMonth(monthDate) {
    const key = monthKey(monthDate);
    if (budgets.overrides[key] > 0) return budgets.overrides[key];
    return budgets.default > 0 ? budgets.default : null;
  }
  function guessCurrency() {
    const region = (navigator.language || 'en-US').split('-')[1];
    const map = { AR: 'ARS', MX: 'MXN', CL: 'CLP', CO: 'COP', PE: 'PEN', UY: 'UYU', BO: 'BOB', GT: 'GTQ', BR: 'BRL', CR: 'CRC', ES: 'EUR', US: 'USD' };
    return map[region] || 'USD';
  }

  // ---------- Helpers ----------

  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function toISODate(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
  function isInMonth(isoDate, monthDate) {
    return isoDate.slice(0, 7) === monthKey(monthDate);
  }
  function formatCurrency(amount) {
    try {
      return new Intl.NumberFormat(navigator.language, {
        style: 'currency', currency: settings.currency, maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
      }).format(amount);
    } catch {
      return `$${amount.toFixed(2)}`;
    }
  }
  function currencySymbol() {
    try {
      const parts = new Intl.NumberFormat(navigator.language, { style: 'currency', currency: settings.currency })
        .formatToParts(0);
      const sym = parts.find(p => p.type === 'currency');
      return sym ? sym.value : '$';
    } catch { return '$'; }
  }
  function formatMonthLabel(d) {
    return new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(d);
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // ---------- Recurring expenses ----------

  function generateDueRecurringExpenses() {
    const today = new Date();
    const monthStr = monthKey(today);
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    let changed = false;

    for (const r of recurring) {
      const day = Math.min(Math.max(1, r.dayOfMonth), daysInMonth);
      const dueDate = new Date(today.getFullYear(), today.getMonth(), day);
      if (dueDate > today) continue;
      const alreadyExists = expenses.some(e => e.recurringId === r.id && e.date.slice(0, 7) === monthStr);
      if (alreadyExists) continue;
      expenses.push({
        id: uid(),
        amount: r.amount,
        category: r.category,
        note: r.note,
        date: toISODate(dueDate),
        recurringId: r.id,
      });
      changed = true;
    }
    if (changed) saveExpenses();
  }

  // ---------- DOM refs ----------

  const monthLabel = document.getElementById('monthLabel');
  const heroTotal = document.getElementById('heroTotal');
  const heroDelta = document.getElementById('heroDelta');
  const categoryChart = document.getElementById('categoryChart');
  const emptyCategories = document.getElementById('emptyCategories');
  const txList = document.getElementById('txList');
  const emptyTx = document.getElementById('emptyTx');
  const toast = document.getElementById('toast');

  const budgetContent = document.getElementById('budgetContent');
  const budgetEmpty = document.getElementById('budgetEmpty');
  const budgetSpentEl = document.getElementById('budgetSpent');
  const budgetTotalEl = document.getElementById('budgetTotal');
  const budgetFill = document.getElementById('budgetFill');
  const budgetStatus = document.getElementById('budgetStatus');
  const editBudgetBtn = document.getElementById('editBudgetBtn');

  const overlay = document.getElementById('overlay');
  const sheet = document.getElementById('sheet');
  const expenseForm = document.getElementById('expenseForm');
  const amountInput = document.getElementById('amountInput');
  const noteInput = document.getElementById('noteInput');
  const dateInput = document.getElementById('dateInput');
  const categoryChips = document.getElementById('categoryChips');
  const currencyPrefix = document.getElementById('currencyPrefix');
  const repeatToggle = document.getElementById('repeatToggle');
  const repeatHint = document.getElementById('repeatHint');
  const repeatDay = document.getElementById('repeatDay');

  const settingsOverlay = document.getElementById('settingsOverlay');
  const settingsSheet = document.getElementById('settingsSheet');
  const currencySelect = document.getElementById('currencySelect');

  const recurringOverlay = document.getElementById('recurringOverlay');
  const recurringSheetEl = document.getElementById('recurringSheet');
  const recurringList = document.getElementById('recurringList');
  const recurringEmpty = document.getElementById('recurringEmpty');

  const budgetOverlay = document.getElementById('budgetOverlay');
  const budgetSheet = document.getElementById('budgetSheet');
  const budgetForm = document.getElementById('budgetForm');
  const budgetSheetMonth = document.getElementById('budgetSheetMonth');
  const budgetFormMonthInline = document.getElementById('budgetFormMonthInline');
  const budgetFormInput = document.getElementById('budgetFormInput');
  const budgetFormCurrencyPrefix = document.getElementById('budgetFormCurrencyPrefix');
  const budgetApplyAllToggle = document.getElementById('budgetApplyAllToggle');
  const budgetRemoveOverrideBtn = document.getElementById('budgetRemoveOverrideBtn');

  // ---------- Rendering ----------

  function render() {
    monthLabel.textContent = formatMonthLabel(viewedMonth);

    const monthExpenses = expenses.filter(e => isInMonth(e.date, viewedMonth));
    const total = monthExpenses.reduce((s, e) => s + e.amount, 0);
    heroTotal.textContent = formatCurrency(total);

    // delta vs previous month
    const prevMonth = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth() - 1, 1);
    const prevTotal = expenses.filter(e => isInMonth(e.date, prevMonth)).reduce((s, e) => s + e.amount, 0);
    renderDelta(total, prevTotal);

    renderBudget(monthExpenses);
    renderCategoryChart(monthExpenses, total);
    renderTxList(monthExpenses);
  }

  function renderDelta(total, prevTotal) {
    heroDelta.classList.remove('good', 'bad');
    if (prevTotal <= 0) {
      heroDelta.textContent = total > 0 ? 'Primer mes con gastos registrados' : '';
      return;
    }
    const diff = total - prevTotal;
    const pct = Math.round((diff / prevTotal) * 100);
    if (diff === 0) {
      heroDelta.textContent = 'Igual que el mes pasado';
      return;
    }
    const arrow = diff > 0 ? '↑' : '↓';
    heroDelta.classList.add(diff > 0 ? 'bad' : 'good');
    heroDelta.textContent = `${arrow} ${Math.abs(pct)}% vs. mes anterior`;
  }

  function renderBudget(monthExpenses) {
    const budget = getBudgetForMonth(viewedMonth);
    if (!budget) {
      budgetContent.hidden = true;
      budgetEmpty.hidden = false;
      return;
    }
    budgetContent.hidden = false;
    budgetEmpty.hidden = true;

    const spent = monthExpenses
      .filter(e => !BUDGET_EXCLUDED_CATEGORIES.includes(e.category))
      .reduce((s, e) => s + e.amount, 0);
    const pct = Math.min(100, (spent / budget) * 100);

    budgetSpentEl.textContent = formatCurrency(spent);
    budgetTotalEl.textContent = `de ${formatCurrency(budget)}`;
    budgetFill.style.width = `${Math.max(pct, spent > 0 ? 2 : 0)}%`;

    budgetFill.classList.remove('warning', 'critical');
    budgetStatus.classList.remove('warning', 'critical');
    const realPct = Math.round((spent / budget) * 100);
    if (spent > budget) {
      budgetFill.classList.add('critical');
      budgetStatus.classList.add('critical');
      budgetStatus.textContent = `🚨 Te pasaste por ${formatCurrency(spent - budget)} (${realPct}%)`;
    } else if (spent >= budget * 0.8) {
      budgetFill.classList.add('warning');
      budgetStatus.classList.add('warning');
      budgetStatus.textContent = `⚠️ ${realPct}% usado · quedan ${formatCurrency(budget - spent)}`;
    } else {
      budgetStatus.textContent = `✅ ${realPct}% usado · quedan ${formatCurrency(budget - spent)}`;
    }
  }

  function renderCategoryChart(monthExpenses, total) {
    const sums = {};
    for (const e of monthExpenses) sums[e.category] = (sums[e.category] || 0) + e.amount;
    const rows = CATEGORIES
      .map(c => ({ cat: c, amount: sums[c.id] || 0 }))
      .filter(r => r.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    categoryChart.innerHTML = '';
    emptyCategories.hidden = rows.length > 0;

    const max = rows.length ? rows[0].amount : 0;
    for (const r of rows) {
      const pctOfMax = max > 0 ? (r.amount / max) * 100 : 0;
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `
        <span class="bar-row-label"><span class="bar-dot" style="background:var(${r.cat.color})"></span>${r.cat.label}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${pctOfMax}%;background:var(${r.cat.color})"></span></span>
        <span class="bar-row-value">${formatCurrency(r.amount)}</span>
      `;
      categoryChart.appendChild(row);
    }
  }

  function renderTxList(monthExpenses) {
    txList.innerHTML = '';
    emptyTx.hidden = monthExpenses.length > 0;

    const sorted = [...monthExpenses].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    let lastDay = null;
    const today = toISODate(new Date());
    const yesterday = toISODate(new Date(Date.now() - 86400000));

    for (const e of sorted) {
      if (e.date !== lastDay) {
        lastDay = e.date;
        const heading = document.createElement('div');
        heading.className = 'tx-day-heading';
        heading.textContent = e.date === today ? 'Hoy' : e.date === yesterday ? 'Ayer' : formatDayHeading(e.date);
        txList.appendChild(heading);
      }
      const cat = CATEGORY_BY_ID[e.category] || CATEGORY_BY_ID.otros;
      const row = document.createElement('div');
      row.className = 'tx-row';
      row.innerHTML = `
        <span class="tx-icon" style="background:color-mix(in srgb, var(${cat.color}) 18%, transparent)">${cat.emoji}</span>
        <span class="tx-main">
          <div class="tx-category">${cat.label}${e.recurringId ? '<span class="tx-auto-tag">Auto</span>' : ''}</div>
          ${e.note ? `<div class="tx-note">${escapeHtml(e.note)}</div>` : ''}
        </span>
        <span class="tx-amount">${formatCurrency(e.amount)}</span>
        <button class="tx-delete" aria-label="Eliminar gasto" data-id="${e.id}">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      `;
      txList.appendChild(row);
    }
  }

  function formatDayHeading(iso) {
    const d = new Date(iso + 'T00:00:00');
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(d);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- Month navigation ----------

  document.getElementById('prevMonth').addEventListener('click', () => {
    viewedMonth = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth() - 1, 1);
    render();
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    viewedMonth = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth() + 1, 1);
    render();
  });

  // ---------- Category chips ----------

  function buildCategoryChipsInto(container, onSelect) {
    container.innerHTML = '';
    for (const c of CATEGORIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.setAttribute('aria-pressed', 'false');
      btn.style.setProperty('--chip-color', `var(${c.color})`);
      btn.dataset.id = c.id;
      btn.innerHTML = `<span class="chip-icon" style="background:color-mix(in srgb, var(${c.color}) 22%, transparent)">${c.emoji}</span>${c.label}`;
      btn.addEventListener('click', () => onSelect(c.id));
      container.appendChild(btn);
    }
  }
  function selectChipIn(container, id) {
    [...container.children].forEach(chip => {
      chip.setAttribute('aria-pressed', String(chip.dataset.id === id));
    });
  }

  // ---------- Add-expense sheet (also handles creating a recurring template) ----------

  function selectCategory(id) {
    selectedCategory = id;
    selectChipIn(categoryChips, id);
  }

  function updateRepeatHint() {
    if (!repeatToggle.checked) { repeatHint.hidden = true; return; }
    const d = new Date((dateInput.value || toISODate(new Date())) + 'T00:00:00');
    repeatDay.textContent = d.getDate();
    repeatHint.hidden = false;
  }
  repeatToggle.addEventListener('change', updateRepeatHint);
  dateInput.addEventListener('change', updateRepeatHint);

  function openSheet(opts = {}) {
    currencyPrefix.textContent = currencySymbol();
    amountInput.value = '';
    noteInput.value = '';
    dateInput.value = toISODate(new Date());
    dateInput.max = toISODate(new Date());
    selectCategory(CATEGORIES[0].id);
    repeatToggle.checked = !!opts.presetRepeat;
    updateRepeatHint();
    overlay.hidden = false;
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => amountInput.focus(), 50);
  }
  function closeSheet() {
    overlay.hidden = true;
    sheet.hidden = true;
    document.body.style.overflow = '';
  }

  document.getElementById('fab').addEventListener('click', () => openSheet());
  document.getElementById('cancelBtn').addEventListener('click', closeSheet);
  overlay.addEventListener('click', closeSheet);

  expenseForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) { amountInput.focus(); return; }
    if (!selectedCategory) return;

    const savedDate = dateInput.value || toISODate(new Date());
    const note = noteInput.value.trim().slice(0, 60);

    let recurringId = null;
    if (repeatToggle.checked) {
      recurringId = uid();
      recurring.push({
        id: recurringId,
        amount,
        category: selectedCategory,
        note,
        dayOfMonth: new Date(savedDate + 'T00:00:00').getDate(),
      });
      saveRecurring();
    }

    expenses.push({
      id: uid(),
      amount,
      category: selectedCategory,
      note,
      date: savedDate,
      recurringId,
    });
    saveExpenses();

    if (!isInMonth(savedDate, viewedMonth)) viewedMonth = startOfMonth(new Date(savedDate + 'T00:00:00'));

    closeSheet();
    render();
    showToast(recurringId ? 'Gasto guardado · se repite cada mes' : 'Gasto guardado');
  });

  // ---------- Delete with undo ----------

  txList.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.tx-delete');
    if (!btn) return;
    const id = btn.dataset.id;
    const idx = expenses.findIndex(e => e.id === id);
    if (idx === -1) return;
    const [removed] = expenses.splice(idx, 1);
    saveExpenses();
    render();
    if (pendingDelete) clearTimeout(pendingDelete.timeoutId);
    pendingDelete = { expense: removed };
    showToast('Gasto eliminado', {
      actionLabel: 'Deshacer',
      onAction: () => {
        expenses.push(removed);
        saveExpenses();
        render();
      },
    });
  });

  // ---------- Toast ----------

  let toastTimer = null;
  function showToast(message, opts = {}) {
    clearTimeout(toastTimer);
    toast.innerHTML = '';
    toast.append(document.createTextNode(message));
    if (opts.actionLabel) {
      const btn = document.createElement('button');
      btn.textContent = opts.actionLabel;
      btn.style.cssText = 'background:none;border:none;color:inherit;font-weight:800;margin-left:10px;text-decoration:underline;cursor:pointer;';
      btn.addEventListener('click', () => { opts.onAction?.(); toast.hidden = true; });
      toast.appendChild(btn);
    }
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
  }

  // ---------- Settings sheet ----------

  function buildCurrencyOptions() {
    currencySelect.innerHTML = '';
    for (const code of CURRENCIES) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = code;
      currencySelect.appendChild(opt);
    }
    currencySelect.value = settings.currency;
  }
  currencySelect.addEventListener('change', () => {
    settings.currency = currencySelect.value;
    saveSettings();
    render();
  });

  function openSettings() {
    buildCurrencyOptions();
    settingsOverlay.hidden = false;
    settingsSheet.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSettings() {
    settingsOverlay.hidden = true;
    settingsSheet.hidden = true;
    document.body.style.overflow = '';
  }
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', closeSettings);

  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(expenses, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gastos-${toISODate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    if (!confirm('¿Borrar todos los gastos guardados? Esta acción no se puede deshacer.')) return;
    expenses = [];
    saveExpenses();
    render();
    closeSettings();
    showToast('Se borraron todos los gastos');
  });

  // ---------- Recurring expenses list (management only — created via the expense form) ----------

  function renderRecurringList() {
    recurringList.innerHTML = '';
    recurringEmpty.hidden = recurring.length > 0;
    const sorted = [...recurring].sort((a, b) => a.dayOfMonth - b.dayOfMonth);
    for (const r of sorted) {
      const cat = CATEGORY_BY_ID[r.category] || CATEGORY_BY_ID.otros;
      const row = document.createElement('div');
      row.className = 'recurring-row';
      row.innerHTML = `
        <span class="tx-icon" style="background:color-mix(in srgb, var(${cat.color}) 18%, transparent)">${cat.emoji}</span>
        <span class="recurring-main">
          <div class="recurring-name">${escapeHtml(r.note)}</div>
          <div class="recurring-meta">${cat.label} · día ${r.dayOfMonth}</div>
        </span>
        <span class="recurring-amount">${formatCurrency(r.amount)}</span>
        <button class="recurring-delete" aria-label="Eliminar recurrente" data-id="${r.id}">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      `;
      recurringList.appendChild(row);
    }
  }

  recurringList.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.recurring-delete');
    if (!btn) return;
    if (!confirm('¿Eliminar este gasto recurrente? Los gastos ya generados no se borran.')) return;
    recurring = recurring.filter(r => r.id !== btn.dataset.id);
    saveRecurring();
    renderRecurringList();
  });

  function openRecurringSheet() {
    closeSettings();
    renderRecurringList();
    recurringOverlay.hidden = false;
    recurringSheetEl.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeRecurringSheet() {
    recurringOverlay.hidden = true;
    recurringSheetEl.hidden = true;
    document.body.style.overflow = '';
  }
  document.getElementById('openRecurringBtn').addEventListener('click', openRecurringSheet);
  document.getElementById('closeRecurringBtn').addEventListener('click', closeRecurringSheet);
  recurringOverlay.addEventListener('click', closeRecurringSheet);

  document.getElementById('addRecurringBtn').addEventListener('click', () => {
    closeRecurringSheet();
    openSheet({ presetRepeat: true });
  });

  // ---------- Budget edit sheet ----------

  function openBudgetSheet() {
    const mKey = monthKey(viewedMonth);
    const hasOverride = budgets.overrides[mKey] > 0;
    const label = formatMonthLabel(viewedMonth);

    budgetSheetMonth.textContent = label;
    budgetFormMonthInline.textContent = label;
    budgetFormCurrencyPrefix.textContent = currencySymbol();
    budgetFormInput.value = getBudgetForMonth(viewedMonth) || '';
    budgetApplyAllToggle.checked = !hasOverride;
    budgetRemoveOverrideBtn.hidden = !hasOverride;

    budgetOverlay.hidden = false;
    budgetSheet.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => budgetFormInput.focus(), 50);
  }
  function closeBudgetSheet() {
    budgetOverlay.hidden = true;
    budgetSheet.hidden = true;
    document.body.style.overflow = '';
  }
  editBudgetBtn.addEventListener('click', openBudgetSheet);
  budgetEmpty.addEventListener('click', openBudgetSheet);
  document.getElementById('budgetCancelBtn').addEventListener('click', closeBudgetSheet);
  budgetOverlay.addEventListener('click', closeBudgetSheet);

  budgetForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const val = parseFloat(budgetFormInput.value);
    const mKey = monthKey(viewedMonth);

    if (budgetApplyAllToggle.checked) {
      budgets.default = val > 0 ? val : null;
      delete budgets.overrides[mKey];
    } else {
      if (val > 0) budgets.overrides[mKey] = val;
      else delete budgets.overrides[mKey];
    }
    saveBudgets();
    closeBudgetSheet();
    render();
    showToast('Presupuesto guardado');
  });

  budgetRemoveOverrideBtn.addEventListener('click', () => {
    delete budgets.overrides[monthKey(viewedMonth)];
    saveBudgets();
    closeBudgetSheet();
    render();
    showToast('Vuelve a usar el presupuesto habitual');
  });

  // ---------- Init ----------

  generateDueRecurringExpenses();
  buildCategoryChipsInto(categoryChips, selectCategory);
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
