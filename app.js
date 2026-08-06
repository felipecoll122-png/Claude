(() => {
  'use strict';

  const STORAGE_KEY = 'expenses_v1';
  const SETTINGS_KEY = 'settings_v1';

  const CATEGORIES = [
    { id: 'comida',          label: 'Comida',          emoji: '🍔', color: '--cat-comida' },
    { id: 'transporte',      label: 'Transporte',      emoji: '🚗', color: '--cat-transporte' },
    { id: 'vivienda',        label: 'Vivienda',        emoji: '🏠', color: '--cat-vivienda' },
    { id: 'entretenimiento', label: 'Entretenimiento', emoji: '🎬', color: '--cat-entretenimiento' },
    { id: 'salud',           label: 'Salud',           emoji: '💊', color: '--cat-salud' },
    { id: 'compras',         label: 'Compras',         emoji: '🛍️', color: '--cat-compras' },
    { id: 'servicios',       label: 'Servicios',       emoji: '🧾', color: '--cat-servicios' },
    { id: 'otros',           label: 'Otros',           emoji: '📦', color: '--cat-otros' },
  ];
  const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

  const CURRENCIES = ['USD', 'EUR', 'ARS', 'MXN', 'CLP', 'COP', 'PEN', 'UYU', 'BOB', 'GTQ', 'BRL', 'CRC'];

  // ---------- State ----------

  let expenses = loadExpenses();
  let settings = loadSettings();
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
      return raw ? JSON.parse(raw) : { currency: guessCurrency() };
    } catch { return { currency: guessCurrency() }; }
  }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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

  // ---------- DOM refs ----------

  const monthLabel = document.getElementById('monthLabel');
  const heroTotal = document.getElementById('heroTotal');
  const heroDelta = document.getElementById('heroDelta');
  const categoryChart = document.getElementById('categoryChart');
  const emptyCategories = document.getElementById('emptyCategories');
  const txList = document.getElementById('txList');
  const emptyTx = document.getElementById('emptyTx');
  const toast = document.getElementById('toast');

  const overlay = document.getElementById('overlay');
  const sheet = document.getElementById('sheet');
  const expenseForm = document.getElementById('expenseForm');
  const amountInput = document.getElementById('amountInput');
  const noteInput = document.getElementById('noteInput');
  const dateInput = document.getElementById('dateInput');
  const categoryChips = document.getElementById('categoryChips');
  const currencyPrefix = document.getElementById('currencyPrefix');

  const settingsOverlay = document.getElementById('settingsOverlay');
  const settingsSheet = document.getElementById('settingsSheet');
  const currencySelect = document.getElementById('currencySelect');

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
          <div class="tx-category">${cat.label}</div>
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

  // ---------- Add-expense sheet ----------

  function buildCategoryChips() {
    categoryChips.innerHTML = '';
    for (const c of CATEGORIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.setAttribute('aria-pressed', 'false');
      btn.style.setProperty('--chip-color', `var(${c.color})`);
      btn.dataset.id = c.id;
      btn.innerHTML = `<span class="chip-icon" style="background:color-mix(in srgb, var(${c.color}) 22%, transparent)">${c.emoji}</span>${c.label}`;
      btn.addEventListener('click', () => selectCategory(c.id));
      categoryChips.appendChild(btn);
    }
  }
  function selectCategory(id) {
    selectedCategory = id;
    [...categoryChips.children].forEach(chip => {
      chip.setAttribute('aria-pressed', String(chip.dataset.id === id));
    });
  }

  function openSheet() {
    currencyPrefix.textContent = currencySymbol();
    amountInput.value = '';
    noteInput.value = '';
    dateInput.value = toISODate(new Date());
    dateInput.max = toISODate(new Date());
    selectCategory(CATEGORIES[0].id);
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

  document.getElementById('fab').addEventListener('click', openSheet);
  document.getElementById('cancelBtn').addEventListener('click', closeSheet);
  overlay.addEventListener('click', closeSheet);

  expenseForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) { amountInput.focus(); return; }
    if (!selectedCategory) return;

    expenses.push({
      id: uid(),
      amount,
      category: selectedCategory,
      note: noteInput.value.trim().slice(0, 60),
      date: dateInput.value || toISODate(new Date()),
    });
    saveExpenses();

    const savedDate = dateInput.value;
    if (!isInMonth(savedDate, viewedMonth)) viewedMonth = startOfMonth(new Date(savedDate + 'T00:00:00'));

    closeSheet();
    render();
    showToast('Gasto guardado');
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

  // ---------- Init ----------

  buildCategoryChips();
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
