(() => {
  'use strict';

  const ROUTINES_KEY = 'routines_v1';
  const SESSIONS_KEY = 'sessions_v1';
  const SETTINGS_KEY = 'gym_settings_v1';

  // ---------- State ----------

  let routines = loadRoutines();
  let sessions = loadSessions();
  let settings = loadSettings();
  let progressExercise = null; // lower-case key of the exercise currently shown in the progress chart

  let sessionDraft = null;     // in-progress workout being logged
  let editingRoutineId = null; // set when the routine sheet is editing an existing routine
  let historyDetailId = null;  // session currently shown in the history detail sheet

  function loadRoutines() {
    try {
      const raw = localStorage.getItem(ROUTINES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  function saveRoutines() {
    localStorage.setItem(ROUTINES_KEY, JSON.stringify(routines));
  }
  function loadSessions() {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  function saveSessions() {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return { unit: parsed.unit === 'lb' ? 'lb' : 'kg' };
    } catch { return { unit: 'kg' }; }
  }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  // ---------- Helpers ----------

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function toISODate(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function monthKeyOf(iso) { return iso.slice(0, 7); }
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  function capitalizeFirst(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
  function formatTarget(sets, reps) { return `${sets}x${reps}`; }
  function formatDayHeading(iso) {
    const today = toISODate(new Date());
    const yesterday = toISODate(new Date(Date.now() - 86400000));
    if (iso === today) return 'Hoy';
    if (iso === yesterday) return 'Ayer';
    const d = new Date(iso + 'T00:00:00');
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(d);
  }
  function formatShortDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(d);
  }
  function trimNum(n) {
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  }
  function formatWeight(w) { return `${trimNum(w)} ${settings.unit}`; }

  // ---------- WhatsApp routine text parser ----------

  const HEADER_KEYWORDS = /^(d[ií]a|day|semana|week|rutina|bloque|fase|descanso|rest\s*day|nota|notas|entrada\s+en\s+calor|calentamiento|warm\s*up)\b/i;

  function parseRoutineText(text) {
    const lines = text.split(/\r?\n/);
    const results = [];
    for (const rawLine of lines) {
      let line = rawLine.trim();
      if (!line) continue;

      // Strip leading bullets / numbering ("1.", "2)", "-", "•", …)
      line = line.replace(/^[\s\-\*•▪●○]*\d{1,2}[\.\)]\s*/, '').replace(/^[\-\*•▪●○]\s*/, '').trim();
      if (!line) continue;

      const letters = line.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, '');
      const isAllCaps = letters.length > 2 && letters === letters.toUpperCase();

      // Extract an optional weight (e.g. "40kg", "18 lbs")
      let weight = null;
      const weightMatch = line.match(/(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|lbs?|libras?)\b/i);
      if (weightMatch) {
        weight = parseFloat(weightMatch[1].replace(',', '.'));
        line = line.replace(weightMatch[0], ' ');
      }

      // Extract sets x reps in a few common shapes
      let sets = null, reps = null;
      let m = line.match(/(\d{1,2})\s*[xX×]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?/);
      if (m) {
        sets = parseInt(m[1], 10);
        reps = m[3] ? `${m[2]}-${m[3]}` : m[2];
        line = line.replace(m[0], ' ');
      } else if ((m = line.match(/(\d{1,2})\s*[xX×]\s*fallo/i))) {
        sets = parseInt(m[1], 10);
        reps = 'fallo';
        line = line.replace(m[0], ' ');
      } else if ((m = line.match(/(\d{1,2})\s*series?\s*(?:de|x)?\s*(\d{1,3})\s*rep/i))) {
        sets = parseInt(m[1], 10);
        reps = m[2];
        line = line.replace(m[0], ' ');
      }

      if (sets === null && (isAllCaps || HEADER_KEYWORDS.test(line))) continue; // section header / day title / rest day

      let name = line.replace(/[:\-–]+\s*$/, '').replace(/^[:\-–]+\s*/, '').replace(/\s{2,}/g, ' ').trim();
      if (!name) continue;
      if (name.length > 60) name = name.slice(0, 60);

      results.push({
        name: capitalizeFirst(name),
        sets: sets || 3,
        reps: reps || '10',
        weight,
      });
    }
    return results;
  }

  // ---------- DOM refs ----------

  const heroCount = document.getElementById('heroCount');
  const heroDelta = document.getElementById('heroDelta');
  const routinesList = document.getElementById('routinesList');
  const routinesEmpty = document.getElementById('routinesEmpty');
  const progressSelect = document.getElementById('progressExerciseSelect');
  const progressChart = document.getElementById('progressChart');
  const progressEmpty = document.getElementById('progressEmpty');
  const historyList = document.getElementById('historyList');
  const historyEmpty = document.getElementById('historyEmpty');
  const toast = document.getElementById('toast');

  const startOverlay = document.getElementById('startOverlay');
  const startSheet = document.getElementById('startSheet');
  const startRoutineList = document.getElementById('startRoutineList');

  const sessionOverlay = document.getElementById('sessionOverlay');
  const sessionSheet = document.getElementById('sessionSheet');
  const sessionTitle = document.getElementById('sessionTitle');
  const sessionExerciseList = document.getElementById('sessionExerciseList');
  const newExerciseInput = document.getElementById('newExerciseInput');

  const routineOverlay = document.getElementById('routineOverlay');
  const routineSheet = document.getElementById('routineSheet');
  const routineSheetTitle = document.getElementById('routineSheetTitle');
  const routineForm = document.getElementById('routineForm');
  const routineNameInput = document.getElementById('routineNameInput');
  const routineExerciseList = document.getElementById('routineExerciseList');

  const importOverlay = document.getElementById('importOverlay');
  const importSheet = document.getElementById('importSheet');
  const importTextarea = document.getElementById('importTextarea');

  const historyDetailOverlay = document.getElementById('historyDetailOverlay');
  const historyDetailSheet = document.getElementById('historyDetailSheet');
  const historyDetailTitle = document.getElementById('historyDetailTitle');
  const historyDetailContent = document.getElementById('historyDetailContent');

  const settingsOverlay = document.getElementById('settingsOverlay');
  const settingsSheet = document.getElementById('settingsSheet');
  const unitSelect = document.getElementById('unitSelect');

  // ---------- Rendering: dashboard ----------

  function render() {
    renderHero();
    renderRoutines();
    renderProgress();
    renderHistory();
  }

  function renderHero() {
    const thisMonth = monthKeyOf(toISODate(new Date()));
    const prevMonthDate = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    const prevMonth = monthKeyOf(toISODate(prevMonthDate));

    const countThis = sessions.filter(s => monthKeyOf(s.date) === thisMonth).length;
    const countPrev = sessions.filter(s => monthKeyOf(s.date) === prevMonth).length;

    heroCount.textContent = String(countThis);
    heroDelta.classList.remove('good', 'bad');
    if (countPrev === 0) {
      heroDelta.textContent = countThis > 0 ? 'Primer mes con entrenamientos registrados' : '';
    } else if (countThis === countPrev) {
      heroDelta.textContent = 'Igual que el mes pasado';
    } else {
      const diff = countThis - countPrev;
      heroDelta.classList.add(diff > 0 ? 'good' : 'bad');
      heroDelta.textContent = diff > 0
        ? `↑ ${diff} más que el mes pasado`
        : `↓ ${Math.abs(diff)} menos que el mes pasado`;
    }
  }

  function renderRoutines() {
    routinesList.innerHTML = '';
    routinesEmpty.hidden = routines.length > 0;
    for (const r of routines) {
      const row = document.createElement('div');
      row.className = 'routine-row';
      row.innerHTML = `
        <span class="routine-main" data-action="start" data-id="${r.id}">
          <div class="routine-name">${escapeHtml(r.name)}</div>
          <div class="routine-meta">${r.exercises.length} ejercicio${r.exercises.length === 1 ? '' : 's'}</div>
        </span>
        <span class="routine-actions">
          <button type="button" class="routine-start-btn" data-action="start" data-id="${r.id}" aria-label="Empezar rutina">
            <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M7 5v14l12-7L7 5Z" fill="currentColor"/></svg>
          </button>
          <button type="button" data-action="edit" data-id="${r.id}" aria-label="Editar rutina">
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.83l-1.17-1.17a2 2 0 0 0-2.83 0L4 16v4Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="routine-delete-btn" data-action="delete" data-id="${r.id}" aria-label="Eliminar rutina">
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </span>
      `;
      routinesList.appendChild(row);
    }
  }

  routinesList.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const routine = routines.find(r => r.id === btn.dataset.id);
    if (!routine) return;
    if (btn.dataset.action === 'start') startSession(routine);
    else if (btn.dataset.action === 'edit') openRoutineSheet('edit', routine);
    else if (btn.dataset.action === 'delete') {
      if (!confirm(`¿Eliminar la rutina "${routine.name}"? El historial ya guardado no se borra.`)) return;
      routines = routines.filter(r => r.id !== routine.id);
      saveRoutines();
      render();
      showToast('Rutina eliminada');
    }
  });

  // ---------- Rendering: progress chart ----------

  function collectExerciseNames() {
    const map = new Map(); // lower-case key -> display name
    for (const s of sessions) {
      for (const ex of s.exercises) {
        const key = ex.name.toLowerCase();
        if (!map.has(key)) map.set(key, ex.name);
      }
    }
    return map;
  }

  function renderProgress() {
    const names = collectExerciseNames();
    if (names.size === 0) {
      progressSelect.hidden = true;
      progressChart.innerHTML = '';
      progressEmpty.hidden = false;
      progressEmpty.textContent = 'Registrá entrenamientos para ver tu progreso por ejercicio.';
      return;
    }

    const sorted = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
    if (!progressExercise || !names.has(progressExercise)) progressExercise = sorted[0][0];

    progressSelect.hidden = false;
    progressSelect.innerHTML = sorted.map(([key, label]) =>
      `<option value="${escapeHtml(key)}" ${key === progressExercise ? 'selected' : ''}>${escapeHtml(label)}</option>`
    ).join('');

    renderProgressChart();
  }

  function renderProgressChart() {
    const key = progressExercise;
    const displayName = collectExerciseNames().get(key) || '';

    // Does this exercise ever have a logged weight? If not, chart reps instead (bodyweight moves).
    const points = [];
    for (const s of sessions) {
      const ex = s.exercises.find(e => e.name.toLowerCase() === key);
      if (!ex) continue;
      const weights = ex.sets.map(st => st.weight).filter(w => typeof w === 'number' && w > 0);
      const repsNums = ex.sets
        .map(st => parseInt(String(st.reps).match(/\d+/)?.[0] || '', 10))
        .filter(n => !isNaN(n));
      points.push({
        date: s.date,
        sortKey: s.date + '_' + (s.createdAt || 0),
        weight: weights.length ? Math.max(...weights) : null,
        reps: repsNums.length ? Math.max(...repsNums) : null,
      });
    }
    points.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const useWeight = points.some(p => p.weight !== null);
    const recent = points.slice(-8);

    progressChart.innerHTML = '';
    if (recent.length === 0) {
      progressEmpty.hidden = false;
      progressEmpty.textContent = `Todavía no hay series registradas para ${displayName}.`;
      return;
    }
    progressEmpty.hidden = true;

    const values = recent.map(p => (useWeight ? p.weight : p.reps) || 0);
    const max = Math.max(...values, 1);
    for (let i = 0; i < recent.length; i++) {
      const p = recent[i];
      const value = useWeight ? p.weight : p.reps;
      const pct = value ? (value / max) * 100 : 0;
      const label = value === null ? '—' : (useWeight ? formatWeight(value) : `${value} reps`);
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `
        <span class="bar-row-label">${formatShortDate(p.date)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
        <span class="bar-row-value">${label}</span>
      `;
      progressChart.appendChild(row);
    }
  }

  progressSelect.addEventListener('change', () => {
    progressExercise = progressSelect.value;
    renderProgressChart();
  });

  // ---------- Rendering: history ----------

  function renderHistory() {
    historyList.innerHTML = '';
    historyEmpty.hidden = sessions.length > 0;
    const sorted = [...sessions].sort((a, b) =>
      (b.date + '_' + (b.createdAt || 0)).localeCompare(a.date + '_' + (a.createdAt || 0))
    );
    let lastDay = null;
    for (const s of sorted) {
      if (s.date !== lastDay) {
        lastDay = s.date;
        const heading = document.createElement('div');
        heading.className = 'tx-day-heading';
        heading.textContent = formatDayHeading(s.date);
        historyList.appendChild(heading);
      }
      const setCount = s.exercises.reduce((n, ex) => n + ex.sets.length, 0);
      const row = document.createElement('div');
      row.className = 'tx-row';
      row.dataset.id = s.id;
      row.innerHTML = `
        <span class="tx-icon">🏋️</span>
        <span class="tx-main">
          <div class="tx-category">${escapeHtml(s.routineName || 'Entrenamiento libre')}</div>
          <div class="tx-note">${s.exercises.length} ejercicio${s.exercises.length === 1 ? '' : 's'} · ${setCount} serie${setCount === 1 ? '' : 's'}</div>
        </span>
        <span class="tx-chevron">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      `;
      historyList.appendChild(row);
    }
  }

  historyList.addEventListener('click', (ev) => {
    const row = ev.target.closest('.tx-row');
    if (!row) return;
    openHistoryDetail(row.dataset.id);
  });

  function openHistoryDetail(id) {
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    historyDetailId = id;
    historyDetailTitle.textContent = s.routineName || 'Entrenamiento libre';
    const blocks = s.exercises.map(ex => `
      <div class="history-ex-block">
        <div class="history-ex-name">${escapeHtml(ex.name)}</div>
        <div class="history-set-list">
          ${ex.sets.map(st => `<span class="history-set-chip">${st.weight != null ? `${formatWeight(st.weight)} × ${escapeHtml(String(st.reps))}` : `${escapeHtml(String(st.reps))} reps`}</span>`).join('')}
        </div>
      </div>
    `).join('');
    historyDetailContent.innerHTML = `<div class="history-detail-meta">${formatDayHeading(s.date)}</div>${blocks}`;
    historyDetailOverlay.hidden = false;
    historyDetailSheet.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeHistoryDetail() {
    historyDetailOverlay.hidden = true;
    historyDetailSheet.hidden = true;
    document.body.style.overflow = '';
    historyDetailId = null;
  }
  document.getElementById('historyDetailCloseBtn').addEventListener('click', closeHistoryDetail);
  historyDetailOverlay.addEventListener('click', closeHistoryDetail);
  document.getElementById('historyDetailDeleteBtn').addEventListener('click', () => {
    if (!historyDetailId) return;
    if (!confirm('¿Eliminar este entrenamiento del historial?')) return;
    sessions = sessions.filter(s => s.id !== historyDetailId);
    saveSessions();
    closeHistoryDetail();
    render();
    showToast('Entrenamiento eliminado');
  });

  // ---------- Start workout sheet ----------

  function openStartSheet() {
    startRoutineList.innerHTML = routines.map(r => `
      <button type="button" class="start-routine-btn" data-id="${r.id}">
        <span>
          <span class="routine-name">${escapeHtml(r.name)}</span>
          <span class="routine-meta">${r.exercises.length} ejercicio${r.exercises.length === 1 ? '' : 's'}</span>
        </span>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    `).join('');
    startOverlay.hidden = false;
    startSheet.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeStartSheet() {
    startOverlay.hidden = true;
    startSheet.hidden = true;
    document.body.style.overflow = '';
  }
  document.getElementById('fab').addEventListener('click', openStartSheet);
  document.getElementById('startCancelBtn').addEventListener('click', closeStartSheet);
  startOverlay.addEventListener('click', closeStartSheet);
  document.getElementById('startBlankBtn').addEventListener('click', () => startSession(null));
  startRoutineList.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.start-routine-btn');
    if (!btn) return;
    const routine = routines.find(r => r.id === btn.dataset.id);
    if (routine) startSession(routine);
  });

  // ---------- Active session sheet ----------

  function startSession(routine) {
    sessionDraft = {
      date: toISODate(new Date()),
      routineId: routine ? routine.id : null,
      routineName: routine ? routine.name : 'Entrenamiento libre',
      exercises: routine
        ? routine.exercises.map(e => ({
            name: e.name,
            target: formatTarget(e.sets, e.reps),
            sets: Array.from({ length: Math.max(1, e.sets || 3) }, () => ({ weight: '', reps: String(e.reps || '') })),
          }))
        : [],
    };
    closeStartSheet();
    openSessionSheet();
  }

  function openSessionSheet() {
    sessionTitle.textContent = sessionDraft.routineName;
    newExerciseInput.value = '';
    renderSessionExercises();
    sessionOverlay.hidden = false;
    sessionSheet.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSessionSheet() {
    sessionOverlay.hidden = true;
    sessionSheet.hidden = true;
    document.body.style.overflow = '';
  }

  function hasSessionData() {
    return sessionDraft.exercises.some(ex =>
      ex.sets.some(s => (s.weight !== '' && s.weight != null) || (s.reps && String(s.reps).trim() !== ''))
    );
  }

  function renderSessionExercises() {
    sessionExerciseList.innerHTML = sessionDraft.exercises.map((ex, i) => `
      <div class="session-ex-block">
        <div class="session-ex-header">
          <div>
            <div class="session-ex-name">${escapeHtml(ex.name)}</div>
            ${ex.target ? `<span class="session-ex-target">Objetivo: ${escapeHtml(ex.target)}</span>` : ''}
          </div>
          <button type="button" class="session-ex-remove" data-action="remove-ex" data-ex="${i}" aria-label="Quitar ejercicio">✕</button>
        </div>
        <div class="set-rows">
          ${ex.sets.map((s, j) => `
            <div class="set-row">
              <span class="set-index">Serie ${j + 1}</span>
              <input type="number" inputmode="decimal" step="0.5" min="0" class="set-weight" placeholder="${settings.unit}" value="${s.weight}" data-ex="${i}" data-set="${j}" />
              <span class="set-x">×</span>
              <input type="text" inputmode="numeric" class="set-reps" placeholder="reps" value="${escapeHtml(String(s.reps))}" data-ex="${i}" data-set="${j}" />
              <button type="button" class="set-remove" data-action="remove-set" data-ex="${i}" data-set="${j}" aria-label="Eliminar serie">✕</button>
            </div>
          `).join('')}
        </div>
        <button type="button" class="add-set-btn" data-action="add-set" data-ex="${i}">+ Serie</button>
      </div>
    `).join('');
  }

  sessionExerciseList.addEventListener('input', (ev) => {
    const el = ev.target;
    const i = el.dataset.ex, j = el.dataset.set;
    if (i === undefined || j === undefined) return;
    const set = sessionDraft.exercises[i]?.sets[j];
    if (!set) return;
    if (el.classList.contains('set-weight')) set.weight = el.value;
    else if (el.classList.contains('set-reps')) set.reps = el.value;
  });

  sessionExerciseList.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const i = parseInt(btn.dataset.ex, 10);
    const ex = sessionDraft.exercises[i];
    if (!ex) return;
    if (btn.dataset.action === 'remove-ex') {
      sessionDraft.exercises.splice(i, 1);
    } else if (btn.dataset.action === 'add-set') {
      const last = ex.sets[ex.sets.length - 1];
      ex.sets.push({ weight: last ? last.weight : '', reps: last ? last.reps : '' });
    } else if (btn.dataset.action === 'remove-set') {
      const j = parseInt(btn.dataset.set, 10);
      ex.sets.splice(j, 1);
      if (ex.sets.length === 0) ex.sets.push({ weight: '', reps: '' });
    }
    renderSessionExercises();
  });

  document.getElementById('addExerciseBtn').addEventListener('click', () => {
    const name = newExerciseInput.value.trim();
    if (!name) return;
    sessionDraft.exercises.push({ name, target: '', sets: [{ weight: '', reps: '' }] });
    newExerciseInput.value = '';
    renderSessionExercises();
  });
  newExerciseInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); document.getElementById('addExerciseBtn').click(); }
  });

  document.getElementById('sessionCancelBtn').addEventListener('click', () => {
    if (hasSessionData() && !confirm('¿Descartar este entrenamiento? Los datos cargados se van a perder.')) return;
    closeSessionSheet();
  });
  sessionOverlay.addEventListener('click', () => {
    if (hasSessionData() && !confirm('¿Descartar este entrenamiento? Los datos cargados se van a perder.')) return;
    closeSessionSheet();
  });

  document.getElementById('sessionSaveBtn').addEventListener('click', () => {
    const finalExercises = [];
    for (const ex of sessionDraft.exercises) {
      const validSets = ex.sets
        .filter(s => (s.weight !== '' && s.weight != null) || (s.reps && String(s.reps).trim() !== ''))
        .map(s => ({
          weight: s.weight === '' || s.weight == null ? null : parseFloat(String(s.weight).replace(',', '.')),
          reps: String(s.reps).trim() || '—',
        }));
      if (validSets.length > 0) finalExercises.push({ name: ex.name, sets: validSets });
    }
    if (finalExercises.length === 0) {
      showToast('Cargá al menos una serie antes de guardar');
      return;
    }
    sessions.push({
      id: uid(),
      date: sessionDraft.date,
      createdAt: Date.now(),
      routineId: sessionDraft.routineId,
      routineName: sessionDraft.routineName,
      exercises: finalExercises,
    });
    saveSessions();
    closeSessionSheet();
    render();
    showToast('Entrenamiento guardado 💪');
  });

  // ---------- Routine editor sheet ----------

  function routineExerciseRowHtml(ex) {
    return `
      <div class="routine-ex-row">
        <input type="text" class="rx-name" placeholder="Ejercicio" value="${escapeHtml(ex.name || '')}" maxlength="60" />
        <input type="number" class="rx-sets" min="1" max="20" value="${ex.sets || 3}" />
        <span class="rx-x">×</span>
        <input type="text" class="rx-reps" placeholder="reps" value="${escapeHtml(String(ex.reps || '10'))}" />
        <button type="button" class="routine-ex-remove" aria-label="Quitar ejercicio">✕</button>
      </div>
    `;
  }

  function renderRoutineExerciseRows(exercises) {
    routineExerciseList.innerHTML = exercises.map(routineExerciseRowHtml).join('');
  }

  routineExerciseList.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.routine-ex-remove');
    if (!btn) return;
    const rows = [...routineExerciseList.children];
    if (rows.length <= 1) { btn.closest('.routine-ex-row').querySelector('.rx-name').value = ''; return; }
    btn.closest('.routine-ex-row').remove();
  });

  document.getElementById('addRoutineExerciseBtn').addEventListener('click', () => {
    routineExerciseList.insertAdjacentHTML('beforeend', routineExerciseRowHtml({ name: '', sets: 3, reps: '10' }));
  });

  function openRoutineSheet(mode, data) {
    editingRoutineId = mode === 'edit' ? data.id : null;
    routineSheetTitle.textContent = mode === 'edit' ? 'Editar rutina' : mode === 'import' ? 'Revisar rutina importada' : 'Nueva rutina';
    routineNameInput.value = data ? data.name : '';
    renderRoutineExerciseRows(data && data.exercises.length ? data.exercises : [{ name: '', sets: 3, reps: '10' }]);
    routineOverlay.hidden = false;
    routineSheet.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => routineNameInput.focus(), 50);
  }
  function closeRoutineSheet() {
    routineOverlay.hidden = true;
    routineSheet.hidden = true;
    document.body.style.overflow = '';
    editingRoutineId = null;
  }
  document.getElementById('newRoutineBtn').addEventListener('click', () => openRoutineSheet('new', null));
  document.getElementById('routineCancelBtn').addEventListener('click', closeRoutineSheet);
  routineOverlay.addEventListener('click', closeRoutineSheet);

  routineForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = routineNameInput.value.trim();
    if (!name) return;

    const exercises = [...routineExerciseList.children].map(row => {
      const existingName = row.querySelector('.rx-name').value.trim();
      if (!existingName) return null;
      const sets = Math.max(1, parseInt(row.querySelector('.rx-sets').value, 10) || 3);
      const reps = row.querySelector('.rx-reps').value.trim() || '10';
      return { id: uid(), name: existingName, sets, reps };
    }).filter(Boolean);

    if (exercises.length === 0) {
      showToast('Agregá al menos un ejercicio');
      return;
    }

    if (editingRoutineId) {
      const r = routines.find(x => x.id === editingRoutineId);
      r.name = name;
      r.exercises = exercises;
    } else {
      routines.push({ id: uid(), name, createdAt: Date.now(), exercises });
    }
    saveRoutines();
    closeRoutineSheet();
    render();
    showToast(editingRoutineId ? 'Rutina actualizada' : 'Rutina guardada');
  });

  // ---------- WhatsApp import sheet ----------

  function openImportSheet() {
    importTextarea.value = '';
    importOverlay.hidden = false;
    importSheet.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => importTextarea.focus(), 50);
  }
  function closeImportSheet() {
    importOverlay.hidden = true;
    importSheet.hidden = true;
    document.body.style.overflow = '';
  }
  document.getElementById('importWhatsappBtn').addEventListener('click', openImportSheet);
  document.getElementById('importCancelBtn').addEventListener('click', closeImportSheet);
  importOverlay.addEventListener('click', closeImportSheet);

  document.getElementById('importParseBtn').addEventListener('click', () => {
    const text = importTextarea.value;
    const parsed = parseRoutineText(text);
    if (parsed.length === 0) {
      showToast('No pude detectar ejercicios en ese texto. Revisá el formato o cargalos a mano.');
      return;
    }
    closeImportSheet();
    openRoutineSheet('import', {
      name: `Rutina ${formatShortDate(toISODate(new Date()))}`,
      exercises: parsed,
    });
    showToast(`Se detectaron ${parsed.length} ejercicio${parsed.length === 1 ? '' : 's'} · revisalos y guardá`);
  });

  // ---------- Settings sheet ----------

  function openSettings() {
    unitSelect.value = settings.unit;
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

  unitSelect.addEventListener('change', () => {
    settings.unit = unitSelect.value;
    saveSettings();
    render();
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const data = { routines, sessions, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mi-rutina-${toISODate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    if (!confirm('¿Borrar todas las rutinas y el historial de entrenamientos? Esta acción no se puede deshacer.')) return;
    routines = [];
    sessions = [];
    saveRoutines();
    saveSessions();
    render();
    closeSettings();
    showToast('Se borraron todos los datos');
  });

  // ---------- Toast ----------

  let toastTimer = null;
  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
  }

  // ---------- Init ----------

  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
