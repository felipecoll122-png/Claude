// Mi Salud: lee capturas de JCVital con Claude y genera la evaluación del día.
// Todo vive en el navegador; la única llamada externa es a la API de Anthropic.

const REPORTS_KEY = 'health_reports_v1';
const PROFILE_KEY = 'health_profile_v1';
const API_KEY_KEY = 'anthropic_api_key_v1';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.129.0/+esm';
const MODEL = 'claude-opus-5-5';
const MAX_IMAGE_SIDE = 1568;
const HISTORY_DAYS_FOR_CONTEXT = 7;

// Métricas que se extraen de las capturas. `null` cuando no aparece.
const METRICS = [
  { id: 'pasos',              label: 'Pasos',              unit: '' },
  { id: 'distancia_km',       label: 'Distancia',          unit: 'km' },
  { id: 'calorias_kcal',      label: 'Calorías',           unit: 'kcal' },
  { id: 'minutos_activos',    label: 'Min. activos',       unit: 'min' },
  { id: 'sueno_total_min',    label: 'Sueño total',        unit: 'min', format: 'duration' },
  { id: 'sueno_profundo_min', label: 'Sueño profundo',     unit: 'min', format: 'duration' },
  { id: 'sueno_ligero_min',   label: 'Sueño ligero',       unit: 'min', format: 'duration' },
  { id: 'sueno_rem_min',      label: 'Sueño REM',          unit: 'min', format: 'duration' },
  { id: 'despierto_min',      label: 'Despierto',          unit: 'min', format: 'duration' },
  { id: 'fc_reposo',          label: 'FC en reposo',       unit: 'lpm' },
  { id: 'fc_promedio',        label: 'FC promedio',        unit: 'lpm' },
  { id: 'fc_max',             label: 'FC máxima',          unit: 'lpm' },
  { id: 'fc_min',             label: 'FC mínima',          unit: 'lpm' },
  { id: 'spo2_promedio',      label: 'Oxígeno (SpO₂)',     unit: '%' },
  { id: 'spo2_min',           label: 'SpO₂ mínimo',        unit: '%' },
  { id: 'presion_sistolica',  label: 'Presión sistólica',  unit: 'mmHg' },
  { id: 'presion_diastolica', label: 'Presión diastólica', unit: 'mmHg' },
  { id: 'hrv_ms',             label: 'Variabilidad (HRV)', unit: 'ms' },
  { id: 'estres',             label: 'Estrés',             unit: '' },
  { id: 'temperatura_c',      label: 'Temperatura',        unit: '°C' },
];

const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };

const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['metricas', 'puntaje', 'resumen', 'evaluaciones', 'consejos', 'alertas', 'no_legible'],
  properties: {
    metricas: {
      type: 'object',
      additionalProperties: false,
      required: METRICS.map(m => m.id),
      properties: Object.fromEntries(METRICS.map(m => [m.id, nullableNumber])),
    },
    puntaje: { type: 'integer', description: 'Puntaje general del día, 0 a 100.' },
    resumen: { type: 'string', description: 'Dos o tres frases sobre cómo estuvo el día.' },
    evaluaciones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'estado', 'detalle'],
        properties: {
          area: { type: 'string', enum: ['Sueño', 'Actividad', 'Corazón', 'Oxígeno', 'Presión', 'Estrés', 'Recuperación'] },
          estado: { type: 'string', enum: ['bien', 'atencion', 'alerta'] },
          detalle: { type: 'string' },
        },
      },
    },
    consejos: { type: 'array', items: { type: 'string' } },
    alertas: { type: 'array', items: { type: 'string' } },
    no_legible: { type: 'boolean', description: 'true si las imágenes no son de una app de salud o no se pueden leer.' },
  },
};

const SYSTEM_PROMPT = `Sos un coach de salud y bienestar que analiza los datos diarios de una pulsera inteligente (app JCVital). Hablás en español rioplatense, cercano y directo, sin tecnicismos innecesarios.

Recibís una o más capturas de pantalla de la app y, a veces, el historial de los últimos días y el perfil de la persona.

Tu trabajo:
1. Leer con cuidado cada número que se vea en las capturas y cargarlo en "metricas". Convertí el sueño a minutos (7 h 20 min = 440). Si un dato no aparece, va null: nunca inventes ni estimes valores que no se ven.
2. Dar un puntaje del día de 0 a 100 que pondere sueño, actividad, recuperación (FC en reposo, HRV) y signos vitales. Considerá la edad y los objetivos si están.
3. Evaluar solo las áreas para las que hay datos. Compará con rangos de referencia habituales para un adulto y con su propio historial (tendencias: mejora, empeora, se mantiene).
4. Dar entre 3 y 5 consejos concretos y accionables para hoy, ligados a lo que ves en los datos (no consejos genéricos). Si la persona dejó una nota sobre cómo se sintió, tenela en cuenta.
5. En "alertas" poné solo valores que ameriten consultar a un médico (por ejemplo SpO₂ sostenida por debajo de 92 %, presión de 140/90 o más, FC en reposo muy alta o muy baja sin explicación). Si no hay nada, dejá la lista vacía. Recordá que las pulseras tienen error de medición: sugerí confirmar, no diagnostiques.

Si las imágenes no son de una app de salud o no se pueden leer, marcá no_legible en true, todas las métricas en null, puntaje 0 y explicá en el resumen qué pasó.`;

// ---------- Storage ----------

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

let reports = readJSON(REPORTS_KEY, {}); // { 'YYYY-MM-DD': report }
let profile = readJSON(PROFILE_KEY, {});
let apiKey = localStorage.getItem(API_KEY_KEY) || '';
let viewedDay = null;
let pendingImages = []; // [{ mediaType, data, url }]

function saveReports() { writeJSON(REPORTS_KEY, reports); }
function saveProfile() { writeJSON(PROFILE_KEY, profile); }

// ---------- Helpers ----------

const $ = (id) => document.getElementById(id);

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function formatDay(iso, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return parseISODate(iso).toLocaleDateString('es', opts);
}
function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
function formatMetric(metric, value) {
  if (metric.format === 'duration') return formatDuration(value);
  const num = Number.isInteger(value) ? value.toLocaleString('es') : value.toLocaleString('es', { maximumFractionDigits: 1 });
  return metric.unit ? `${num} ${metric.unit}` : num;
}
function scoreTone(score) {
  if (score >= 75) return 'good';
  if (score >= 50) return 'warning';
  return 'critical';
}
function scoreWord(score) {
  if (score >= 85) return 'Excelente';
  if (score >= 75) return 'Muy bien';
  if (score >= 60) return 'Bien';
  if (score >= 45) return 'Regular';
  return 'Flojo';
}

let toastTimer = null;
function showToast(message) {
  const toast = $('toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
}

// Achica la imagen para no gastar tokens de más y la pasa a base64.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      resolve({ mediaType: 'image/jpeg', data: dataUrl.split(',')[1], url });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

// ---------- Claude ----------

let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    clientPromise = import(SDK_URL).then(({ default: Anthropic }) =>
      new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
    );
  }
  return clientPromise;
}

function buildContext(day) {
  const lines = [`Día de los datos: ${formatDay(day)} (${day}).`];

  const p = [];
  if (profile.age) p.push(`${profile.age} años`);
  if (profile.sex) p.push(profile.sex);
  if (profile.height) p.push(`${profile.height} cm`);
  if (profile.weight) p.push(`${profile.weight} kg`);
  if (p.length) lines.push(`Perfil: ${p.join(', ')}.`);
  if (profile.goal) lines.push(`Objetivos: ${profile.goal}.`);

  const previous = Object.keys(reports)
    .filter(d => d < day)
    .sort()
    .slice(-HISTORY_DAYS_FOR_CONTEXT)
    .map(d => ({ dia: d, puntaje: reports[d].puntaje, metricas: compactMetrics(reports[d].metricas) }));
  if (previous.length) {
    lines.push(`Historial de los días anteriores (JSON):\n${JSON.stringify(previous)}`);
  } else {
    lines.push('No hay historial previo todavía.');
  }

  const note = $('noteInput').value.trim();
  if (note) lines.push(`Nota de la persona sobre el día: "${note}"`);

  lines.push('Analizá las capturas adjuntas.');
  return lines.join('\n\n');
}

function compactMetrics(metricas) {
  return Object.fromEntries(Object.entries(metricas || {}).filter(([, v]) => v !== null));
}

async function analyze(day, images) {
  const client = await getClient();
  const content = [
    ...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
    { type: 'text', text: buildContext(day) },
  ];

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: REPORT_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude no pudo analizar estas imágenes. Probá con otras capturas.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('La respuesta quedó cortada. Probá de nuevo.');
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text);
}

function describeError(err) {
  const status = err?.status;
  if (status === 401) return 'La clave de la API no es válida. Revisala en Configuración.';
  if (status === 429) return 'Demasiados pedidos seguidos. Esperá un minuto y probá de nuevo.';
  if (status === 400 && /credit/i.test(err.message || '')) return 'Tu cuenta de Anthropic no tiene saldo.';
  if (status >= 500) return 'La API de Claude está con problemas. Probá en un rato.';
  if (err?.name === 'APIConnectionError' || err instanceof TypeError) return 'No hay conexión. Revisá internet y probá de nuevo.';
  return err?.message || 'Algo salió mal.';
}

// ---------- Rendering ----------

function render() {
  $('keyBanner').hidden = !!apiKey;
  const today = toISODate(new Date());
  $('todayBanner').hidden = !apiKey || !!reports[today];

  const days = Object.keys(reports).sort();
  if (!viewedDay || !reports[viewedDay]) viewedDay = days[days.length - 1] || null;

  renderReport(viewedDay ? reports[viewedDay] : null, viewedDay);
  renderHistory(days);
  updateAnalyzeBtn();
}

function renderReport(report, day) {
  $('report').hidden = !report;
  if (!report) return;

  $('reportDate').textContent = formatDay(day);
  const ring = $('scoreRing');
  ring.className = `score-ring ${scoreTone(report.puntaje)}`;
  ring.style.setProperty('--pct', report.puntaje);
  $('scoreValue').textContent = report.no_legible ? '–' : report.puntaje;
  $('scoreLabel').textContent = report.no_legible ? 'No se pudo leer' : scoreWord(report.puntaje);
  $('reportSummary').textContent = report.resumen;

  $('alertsCard').hidden = !report.alertas.length;
  $('alertsList').replaceChildren(...report.alertas.map(a => {
    const li = document.createElement('li');
    li.textContent = a;
    return li;
  }));

  const prevDay = Object.keys(reports).filter(d => d < day).sort().pop();
  const prev = prevDay ? reports[prevDay].metricas : {};
  const cells = METRICS.filter(m => report.metricas[m.id] !== null && report.metricas[m.id] !== undefined).map(m => {
    const value = report.metricas[m.id];
    const cell = document.createElement('div');
    cell.className = 'metric';
    const label = document.createElement('div');
    label.className = 'metric-label';
    label.textContent = m.label;
    const val = document.createElement('div');
    val.className = 'metric-value';
    val.textContent = formatMetric(m, value);
    cell.append(label, val);
    const before = prev?.[m.id];
    if (typeof before === 'number' && before !== value) {
      const delta = document.createElement('div');
      delta.className = 'metric-delta';
      delta.textContent = `${value > before ? '▲' : '▼'} vs. ${formatMetric(m, before)}`;
      cell.appendChild(delta);
    }
    return cell;
  });
  $('metricsGrid').replaceChildren(...cells);
  if (!cells.length) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No se encontraron números en las capturas.';
    $('metricsGrid').appendChild(p);
  }

  $('evalList').replaceChildren(...report.evaluaciones.map(e => {
    const row = document.createElement('div');
    row.className = 'eval-row';
    const dot = document.createElement('span');
    dot.className = `eval-dot ${e.estado}`;
    const body = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'eval-area';
    title.textContent = e.area;
    const detail = document.createElement('div');
    detail.className = 'eval-detail';
    detail.textContent = e.detalle;
    body.append(title, detail);
    row.append(dot, body);
    return row;
  }));

  $('tipsList').replaceChildren(...report.consejos.map(c => {
    const li = document.createElement('li');
    li.textContent = c;
    return li;
  }));
}

function renderHistory(days) {
  $('historyEmpty').hidden = days.length > 0;
  const recent = days.slice(-14);

  const chart = $('historyChart');
  chart.hidden = recent.length < 2;
  chart.replaceChildren(...recent.map(d => {
    const r = reports[d];
    const col = document.createElement('button');
    col.type = 'button';
    col.className = 'score-col' + (d === viewedDay ? ' active' : '');
    col.title = `${formatDay(d, { day: 'numeric', month: 'short' })}: ${r.puntaje}`;
    col.addEventListener('click', () => { viewedDay = d; render(); });
    const bar = document.createElement('span');
    bar.className = `score-bar ${scoreTone(r.puntaje)}`;
    bar.style.height = `${Math.max(4, r.puntaje)}%`;
    const lbl = document.createElement('span');
    lbl.className = 'score-col-label';
    lbl.textContent = parseISODate(d).getDate();
    col.append(bar, lbl);
    return col;
  }));

  $('historyList').replaceChildren(...days.slice().reverse().slice(0, 30).map(d => {
    const r = reports[d];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'history-row' + (d === viewedDay ? ' active' : '');
    row.addEventListener('click', () => {
      viewedDay = d;
      render();
      window.scrollTo({ top: $('report').offsetTop - 12, behavior: 'smooth' });
    });
    const name = document.createElement('span');
    name.className = 'history-day';
    name.textContent = formatDay(d, { weekday: 'short', day: 'numeric', month: 'short' });
    const score = document.createElement('span');
    score.className = `history-score ${scoreTone(r.puntaje)}`;
    score.textContent = r.no_legible ? '–' : r.puntaje;
    row.append(name, score);
    return row;
  }));
}

function renderThumbs() {
  $('thumbs').replaceChildren(...pendingImages.map((img, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb';
    const el = document.createElement('img');
    el.src = img.url;
    el.alt = `Captura ${i + 1}`;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'thumb-remove';
    rm.setAttribute('aria-label', 'Quitar captura');
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      URL.revokeObjectURL(img.url);
      pendingImages.splice(i, 1);
      renderThumbs();
      updateAnalyzeBtn();
    });
    wrap.append(el, rm);
    return wrap;
  }));
}

function updateAnalyzeBtn() {
  $('analyzeBtn').disabled = !apiKey || !pendingImages.length || !$('dayInput').value;
}

function setStatus(text, isError = false) {
  const el = $('analyzeStatus');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('error', isError);
}

// ---------- Events ----------

$('dayInput').value = toISODate(new Date());
$('dayInput').max = toISODate(new Date());
$('dayInput').addEventListener('change', updateAnalyzeBtn);

$('shotsInput').addEventListener('change', async (ev) => {
  const files = [...ev.target.files];
  ev.target.value = '';
  setStatus('');
  for (const file of files) {
    try {
      pendingImages.push(await loadImage(file));
    } catch (err) {
      setStatus(err.message, true);
    }
  }
  renderThumbs();
  updateAnalyzeBtn();
});

$('analyzeBtn').addEventListener('click', async () => {
  const day = $('dayInput').value;
  if (reports[day] && !confirm(`Ya hay un análisis para ${formatDay(day)}. ¿Reemplazarlo?`)) return;

  $('analyzeBtn').disabled = true;
  setStatus('Leyendo tus capturas… puede tardar unos segundos.');
  try {
    const result = await analyze(day, pendingImages);
    reports[day] = { ...result, nota: $('noteInput').value.trim(), creado: new Date().toISOString() };
    saveReports();
    pendingImages.forEach(img => URL.revokeObjectURL(img.url));
    pendingImages = [];
    $('noteInput').value = '';
    renderThumbs();
    setStatus('');
    viewedDay = day;
    render();
    window.scrollTo({ top: $('report').offsetTop - 12, behavior: 'smooth' });
  } catch (err) {
    setStatus(describeError(err), true);
  } finally {
    updateAnalyzeBtn();
  }
});

// Settings
function openSettings() {
  $('apiKeyInput').value = apiKey;
  $('ageInput').value = profile.age || '';
  $('sexSelect').value = profile.sex || '';
  $('heightInput').value = profile.height || '';
  $('weightInput').value = profile.weight || '';
  $('goalInput').value = profile.goal || '';
  $('settingsOverlay').hidden = false;
  $('settingsSheet').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSettings() {
  const newKey = $('apiKeyInput').value.trim();
  if (newKey !== apiKey) {
    apiKey = newKey;
    clientPromise = null;
    if (apiKey) localStorage.setItem(API_KEY_KEY, apiKey);
    else localStorage.removeItem(API_KEY_KEY);
  }
  profile = {
    age: Number($('ageInput').value) || null,
    sex: $('sexSelect').value || null,
    height: Number($('heightInput').value) || null,
    weight: Number($('weightInput').value) || null,
    goal: $('goalInput').value.trim() || null,
  };
  saveProfile();
  $('settingsOverlay').hidden = true;
  $('settingsSheet').hidden = true;
  document.body.style.overflow = '';
  render();
}

$('settingsBtn').addEventListener('click', openSettings);
$('keyBannerBtn').addEventListener('click', openSettings);
$('closeSettingsBtn').addEventListener('click', closeSettings);
$('settingsOverlay').addEventListener('click', closeSettings);

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ perfil: profile, dias: reports }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `salud-${toISODate(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('clearBtn').addEventListener('click', () => {
  if (!confirm('¿Borrar todo el historial de salud? No se puede deshacer.')) return;
  reports = {};
  saveReports();
  viewedDay = null;
  render();
  showToast('Historial borrado');
});

render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
