// Mi Salud: lee capturas de JCVital con Claude y genera la evaluación del día.
// Todo vive en el navegador; la única llamada externa es a la API de Anthropic.

const REPORTS_KEY = 'health_reports_v1';
const PROFILE_KEY = 'health_profile_v1';
const INSIGHTS_KEY = 'health_insights_v1';
const API_KEY_KEY = 'anthropic_api_key_v1';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.129.0/+esm';
const MODEL = 'claude-opus-5-5';
const MAX_IMAGE_SIDE = 1568;
const HISTORY_DAYS_FOR_DAILY = 14;
const HISTORY_DAYS_FOR_INSIGHTS = 90;
const MIN_DAYS_FOR_INSIGHTS = 5;
const MIN_DAYS_PER_SIDE = 3; // días mínimos con y sin un hábito para mostrar su impacto

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

// Cuestionario diario (al estilo del Journal de WHOOP). Las preguntas son sobre
// el día anterior, que es lo que pesa en el sueño y la recuperación de hoy.
const YES_NO = [['no', 'No'], ['si', 'Sí']];
const SCALE = [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']];
const QUESTIONS = [
  { id: 'alcohol',       text: '¿Tomaste alcohol ayer?',               options: [['no', 'No'], ['poco', '1–2'], ['mucho', '3 o más']] },
  { id: 'entreno',       text: '¿Entrenaste ayer?',                    options: [['no', 'No'], ['suave', 'Suave'], ['moderado', 'Moderado'], ['intenso', 'Intenso']] },
  { id: 'cafeina_tarde', text: '¿Tomaste café o mate después de las 16 h?', options: YES_NO },
  { id: 'cena_tarde',    text: '¿Cenaste tarde o pesado?',             options: YES_NO },
  { id: 'pantallas',     text: '¿Usaste el celular en la cama?',       options: YES_NO },
  { id: 'siesta',        text: '¿Dormiste siesta?',                    options: YES_NO },
  { id: 'comida_sana',   text: '¿Comiste sano?',                       options: YES_NO },
  { id: 'enfermo',       text: '¿Te sentís enfermo o con molestias?',  options: YES_NO },
  { id: 'energia',       text: 'Energía al despertar',                 options: SCALE, hint: '1 = nada · 5 = a full' },
  { id: 'estres',        text: 'Estrés',                               options: SCALE, hint: '1 = tranquilo · 5 = al límite' },
  { id: 'animo',         text: 'Ánimo',                                options: SCALE, hint: '1 = bajón · 5 = excelente' },
];
const QUESTION_BY_ID = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));

// Hábitos que se cruzan con la recuperación en "Impacto de tus hábitos".
const HABITS = [
  { label: 'Alcohol',                 q: 'alcohol',       yes: v => v !== 'no' },
  { label: 'Entrenamiento intenso',   q: 'entreno',       yes: v => v === 'intenso' },
  { label: 'Café o mate a la tarde',  q: 'cafeina_tarde', yes: v => v === 'si' },
  { label: 'Cena tarde o pesada',     q: 'cena_tarde',    yes: v => v === 'si' },
  { label: 'Celular en la cama',      q: 'pantallas',     yes: v => v === 'si' },
  { label: 'Siesta',                  q: 'siesta',        yes: v => v === 'si' },
  { label: 'Comer sano',              q: 'comida_sana',   yes: v => v === 'si' },
  { label: 'Enfermo o con molestias', q: 'enfermo',       yes: v => v === 'si' },
  { label: 'Estrés alto (4–5)',       q: 'estres',        yes: v => Number(v) >= 4 },
];

const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const nullableInteger = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const stringList = { type: 'array', items: { type: 'string' } };

const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['metricas', 'recuperacion', 'sueno_rendimiento', 'esfuerzo', 'deuda_sueno_min', 'resumen',
    'plan', 'tendencias', 'evaluaciones', 'consejos', 'alertas', 'preguntas_manana', 'no_legible'],
  properties: {
    metricas: {
      type: 'object',
      additionalProperties: false,
      required: METRICS.map(m => m.id),
      properties: Object.fromEntries(METRICS.map(m => [m.id, nullableNumber])),
    },
    recuperacion: { type: 'integer', description: 'Recuperación 0-100 %.' },
    sueno_rendimiento: { ...nullableInteger, description: 'Rendimiento del sueño 0-100 %: horas dormidas vs. necesarias, eficiencia y fases.' },
    esfuerzo: { ...nullableNumber, description: 'Esfuerzo del día en escala 0-21.' },
    deuda_sueno_min: { ...nullableNumber, description: 'Deuda de sueño acumulada en minutos.' },
    resumen: { type: 'string' },
    plan: {
      type: 'object',
      additionalProperties: false,
      required: ['esfuerzo_objetivo', 'horas_sueno', 'hora_acostarse'],
      properties: {
        esfuerzo_objetivo: { type: 'string', description: 'Ej: "Moderado (10–13): fuerza o trote suave".' },
        horas_sueno: { ...nullableNumber, description: 'Horas de sueño que necesita esta noche.' },
        hora_acostarse: { ...nullableString, description: 'HH:MM, o null si no se sabe a qué hora se levanta.' },
      },
    },
    tendencias: stringList,
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
    consejos: stringList,
    alertas: stringList,
    preguntas_manana: stringList,
    no_legible: { type: 'boolean' },
  },
};

const INSIGHTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['resumen', 'hallazgos', 'te_hace_bien', 'te_juega_en_contra', 'plan_semana'],
  properties: {
    resumen: { type: 'string' },
    hallazgos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titulo', 'detalle', 'tipo'],
        properties: {
          titulo: { type: 'string' },
          detalle: { type: 'string' },
          tipo: { type: 'string', enum: ['bien', 'atencion', 'alerta'] },
        },
      },
    },
    te_hace_bien: stringList,
    te_juega_en_contra: stringList,
    plan_semana: stringList,
  },
};

const COACH_STYLE = `Sos un coach de salud, sueño y rendimiento que trabaja con los datos de una pulsera inteligente (app JCVital) y con un cuestionario diario. Hablás en español rioplatense, cercano y directo, sin tecnicismos innecesarios. Usás el mismo marco que WHOOP: Recuperación (0-100 %, verde 67-100, amarillo 34-66, rojo 0-33), Rendimiento del sueño (0-100 %) y Esfuerzo (escala 0-21). Las pulseras tienen error de medición: sugerí confirmar con un profesional, nunca diagnostiques.`;

const DAILY_PROMPT = `${COACH_STYLE}

Recibís capturas de pantalla de la app, el perfil de la persona, sus respuestas al cuestionario del día y el historial de los días anteriores (métricas, puntajes y respuestas).

Tu trabajo:
1. Leé con cuidado cada número que se vea en las capturas y cargalo en "metricas". El sueño va en minutos (7 h 20 min = 440). Si un dato no aparece, va null: nunca inventes valores que no se ven.
2. Recuperación: basala sobre todo en la HRV y la FC en reposo comparadas con el promedio personal del historial (no con promedios poblacionales), más el sueño, la SpO₂ y la temperatura si hay. Sin historial, usá rangos habituales para su edad y aclaralo en el resumen.
3. Rendimiento del sueño: horas dormidas contra las que necesitaba (base de 7,5-8,5 h según la edad, más un extra por el esfuerzo del día anterior y la deuda acumulada), fases y despertares. Deuda de sueño: lo que le faltó en los últimos días, según el historial.
4. Esfuerzo del día (0-21): estimalo con pasos, minutos activos, calorías, FC y el entrenamiento que contó. Si no hay datos de actividad, null.
5. Plan para hoy: un esfuerzo objetivo acorde a la recuperación (verde: puede exigirse; amarillo: moderado; rojo: descanso activo), las horas de sueño que necesita esta noche y, si sabés a qué hora se levanta, a qué hora acostarse (contá unos 15 minutos para dormirse).
6. Tendencias: entre 2 y 4 conclusiones sacadas del historial, con números concretos. Por ejemplo: "Tu FC en reposo viene subiendo hace 4 días (58 → 64)", "Las 3 veces que tomaste alcohol tu recuperación bajó en promedio 15 puntos". Si hay menos de 3 días de historial, decí qué vas a poder ver cuando haya más datos.
7. Evaluá solo las áreas para las que hay datos.
8. Entre 3 y 5 consejos concretos y accionables para hoy, ligados a sus datos y respuestas, no genéricos.
9. Alertas: solo valores que ameriten consultar a un médico (SpO₂ sostenida por debajo de 92 %, presión de 140/90 o más, FC en reposo muy alta o muy baja sin explicación, etc.). Si no hay, lista vacía.
10. preguntas_manana: 0 a 2 preguntas cortas y personalizadas para hacerle mañana, que ayuden a explicar algo raro que viste en los datos (por ejemplo "¿Qué pasó el martes que dormiste 4 h?"). Solo si de verdad sirven; si no, lista vacía.

Si las imágenes no son de una app de salud o no se pueden leer, marcá no_legible en true, métricas en null, recuperación 0 y explicá en el resumen qué pasó.`;

const INSIGHTS_PROMPT = `${COACH_STYLE}

Recibís el historial completo de la persona: por día, las métricas de la pulsera, los puntajes y sus respuestas al cuestionario. También el impacto de cada hábito ya calculado (promedio de recuperación con y sin el hábito).

Buscá patrones reales en los datos y explicalos con números: qué hábitos se asocian con mejor o peor recuperación y sueño, cómo evolucionan la FC en reposo, la HRV, las horas de sueño y la actividad, qué días de la semana le cuestan más, cómo responde después de entrenar fuerte, etc. Diferenciá lo que es un patrón claro de lo que es una sospecha con pocos días. No inventes relaciones que los datos no muestran.

Devolvé: un resumen de 2-3 frases, entre 3 y 6 hallazgos, lo que le hace bien, lo que le juega en contra y un plan de 3 a 5 acciones concretas para esta semana.`;

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
let insights = readJSON(INSIGHTS_KEY, null);
let apiKey = localStorage.getItem(API_KEY_KEY) || '';
let viewedDay = null;
let pendingImages = []; // [{ mediaType, data, url }]
let journal = {};       // respuestas del cuestionario en curso

function saveReports() { writeJSON(REPORTS_KEY, reports); }
function saveProfile() { writeJSON(PROFILE_KEY, profile); }

// ---------- Helpers ----------

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function listItems(items) {
  return items.map(t => el('li', '', t));
}

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
function formatHours(hours) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
function formatNumber(value) {
  return Number.isInteger(value) ? value.toLocaleString('es') : value.toLocaleString('es', { maximumFractionDigits: 1 });
}
function formatMetric(metric, value) {
  if (metric.format === 'duration') return formatDuration(value);
  return metric.unit ? `${formatNumber(value)} ${metric.unit}` : formatNumber(value);
}

// Los informes viejos tenían un solo "puntaje"; los nuevos, recuperación.
function recoveryOf(report) {
  return report.recuperacion ?? report.puntaje ?? null;
}
function recoveryTone(score) {
  if (score >= 67) return 'good';
  if (score >= 34) return 'warning';
  return 'critical';
}
function average(nums) {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
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

// ---------- History analysis (local) ----------

function habitImpacts() {
  const days = Object.keys(reports).filter(d => reports[d].diario && !reports[d].no_legible && recoveryOf(reports[d]) !== null);
  return HABITS.map(h => {
    const withIt = [], without = [];
    for (const d of days) {
      const answer = reports[d].diario[h.q];
      if (answer === undefined) continue;
      (h.yes(answer) ? withIt : without).push(recoveryOf(reports[d]));
    }
    if (withIt.length < MIN_DAYS_PER_SIDE || without.length < MIN_DAYS_PER_SIDE) return null;
    return {
      habito: h.label,
      con: Math.round(average(withIt)),
      sin: Math.round(average(without)),
      diferencia: Math.round(average(withIt) - average(without)),
      dias_con: withIt.length,
      dias_sin: without.length,
    };
  }).filter(Boolean).sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
}

function historyRows(beforeDay, limit) {
  return Object.keys(reports)
    .filter(d => !beforeDay || d < beforeDay)
    .sort()
    .slice(-limit)
    .map(d => {
      const r = reports[d];
      const row = { dia: d, dia_semana: formatDay(d, { weekday: 'long' }), recuperacion: recoveryOf(r) };
      if (r.sueno_rendimiento != null) row.sueno = r.sueno_rendimiento;
      if (r.esfuerzo != null) row.esfuerzo = r.esfuerzo;
      row.metricas = Object.fromEntries(Object.entries(r.metricas || {}).filter(([, v]) => v !== null));
      if (r.diario && Object.keys(r.diario).length) row.cuestionario = r.diario;
      if (r.nota) row.nota = r.nota;
      return row;
    });
}

function profileText() {
  const p = [];
  if (profile.age) p.push(`${profile.age} años`);
  if (profile.sex) p.push(profile.sex);
  if (profile.height) p.push(`${profile.height} cm`);
  if (profile.weight) p.push(`${profile.weight} kg`);
  const lines = [];
  if (p.length) lines.push(`Perfil: ${p.join(', ')}.`);
  if (profile.wake) lines.push(`Se levanta normalmente a las ${profile.wake}.`);
  if (profile.goal) lines.push(`Objetivos: ${profile.goal}.`);
  return lines;
}

function journalForPrompt(answers, followups) {
  const lines = [];
  for (const [id, value] of Object.entries(answers)) {
    const q = QUESTION_BY_ID[id];
    if (!q) continue;
    const label = q.options.find(([v]) => v === value)?.[1] ?? value;
    lines.push(`- ${q.text} ${label}${q.hint ? ` (${q.hint})` : ''}`);
  }
  for (const f of followups) lines.push(`- ${f.pregunta} ${f.respuesta}`);
  return lines.length ? `Cuestionario de hoy:\n${lines.join('\n')}` : 'No respondió el cuestionario hoy.';
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

async function askClaude({ system, content, schema }) {
  const client = await getClient();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('Claude no pudo hacer este análisis. Probá de nuevo con otros datos.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('La respuesta quedó cortada. Probá de nuevo.');
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text);
}

function analyzeDay(day, images, answers, followups, note) {
  const parts = [`Día de los datos: ${formatDay(day)} (${day}).`, ...profileText()];
  parts.push(journalForPrompt(answers, followups));
  if (note) parts.push(`Nota de la persona: "${note}"`);
  const history = historyRows(day, HISTORY_DAYS_FOR_DAILY);
  parts.push(history.length
    ? `Historial de los días anteriores (JSON):\n${JSON.stringify(history)}`
    : 'No hay historial previo todavía.');
  parts.push('Analizá las capturas adjuntas.');

  return askClaude({
    system: DAILY_PROMPT,
    schema: REPORT_SCHEMA,
    content: [
      ...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
      { type: 'text', text: parts.join('\n\n') },
    ],
  });
}

function analyzeHistory() {
  const parts = [...profileText()];
  parts.push(`Historial (JSON, del más viejo al más nuevo):\n${JSON.stringify(historyRows(null, HISTORY_DAYS_FOR_INSIGHTS))}`);
  const impacts = habitImpacts();
  if (impacts.length) parts.push(`Impacto de los hábitos en la recuperación (JSON):\n${JSON.stringify(impacts)}`);
  parts.push(`Hoy es ${formatDay(toISODate(new Date()))}. Sacá conclusiones de todo el historial.`);
  return askClaude({ system: INSIGHTS_PROMPT, schema: INSIGHTS_SCHEMA, content: parts.join('\n\n') });
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
  renderImpacts();
  renderInsights(days);
  renderHistory(days);
  updateAnalyzeBtn();
}

function renderReport(report, day) {
  $('report').hidden = !report;
  if (!report) return;

  const recovery = recoveryOf(report);
  $('reportDate').textContent = formatDay(day);
  const ring = $('scoreRing');
  ring.className = `score-ring ${recoveryTone(recovery)}`;
  ring.style.setProperty('--pct', recovery);
  $('scoreValue').textContent = report.no_legible ? '–' : `${recovery}%`;
  $('scoreLabel').textContent = report.no_legible ? 'No se pudo leer' : 'Recuperación';
  $('sleepScore').textContent = report.sueno_rendimiento != null ? `${report.sueno_rendimiento}%` : '–';
  $('strainScore').textContent = report.esfuerzo != null ? formatNumber(report.esfuerzo) : '–';
  $('sleepDebt').textContent = report.deuda_sueno_min != null ? formatDuration(report.deuda_sueno_min) : '–';
  $('reportSummary').textContent = report.resumen;

  const plan = report.plan || {};
  $('planStrain').textContent = plan.esfuerzo_objetivo || '–';
  $('planSleep').textContent = plan.horas_sueno != null ? formatHours(plan.horas_sueno) : '–';
  $('planBedtime').textContent = plan.hora_acostarse || (profile.wake ? '–' : 'Cargá a qué hora te levantás');

  $('alertsCard').hidden = !report.alertas.length;
  $('alertsList').replaceChildren(...listItems(report.alertas));

  const trends = report.tendencias || [];
  $('trendsCard').hidden = !trends.length;
  $('trendsList').replaceChildren(...listItems(trends));

  $('tipsList').replaceChildren(...listItems(report.consejos));

  $('evalList').replaceChildren(...report.evaluaciones.map(e => evalRow(e.area, e.detalle, e.estado)));

  const prevDay = Object.keys(reports).filter(d => d < day).sort().pop();
  const prev = prevDay ? reports[prevDay].metricas : {};
  const cells = METRICS.filter(m => report.metricas[m.id] != null).map(m => {
    const value = report.metricas[m.id];
    const cell = el('div', 'metric');
    cell.append(el('div', 'metric-label', m.label), el('div', 'metric-value', formatMetric(m, value)));
    const before = prev?.[m.id];
    if (typeof before === 'number' && before !== value) {
      cell.appendChild(el('div', 'metric-delta', `${value > before ? '▲' : '▼'} vs. ${formatMetric(m, before)}`));
    }
    return cell;
  });
  $('metricsGrid').replaceChildren(...cells);
  if (!cells.length) $('metricsGrid').appendChild(el('p', 'empty-state', 'No se encontraron números en las capturas.'));
}

function evalRow(title, detail, state) {
  const row = el('div', 'eval-row');
  const body = el('div');
  body.append(el('div', 'eval-area', title), el('div', 'eval-detail', detail));
  row.append(el('span', `eval-dot ${state}`), body);
  return row;
}

function renderImpacts() {
  const impacts = habitImpacts();
  $('impactList').replaceChildren(...impacts.map(i => {
    const row = el('div', 'impact-row');
    const tone = i.diferencia >= 3 ? 'good' : i.diferencia <= -3 ? 'critical' : 'neutral';
    const sign = i.diferencia > 0 ? '+' : '';
    const head = el('div', 'impact-head');
    head.append(el('span', 'impact-name', i.habito), el('span', `impact-delta ${tone}`, `${sign}${i.diferencia} pts`));
    const bar = el('div', 'impact-track');
    const fill = el('span', `impact-fill ${tone}`);
    fill.style.width = `${Math.min(50, Math.abs(i.diferencia) * 1.5)}%`;
    fill.style[i.diferencia >= 0 ? 'left' : 'right'] = '50%';
    bar.appendChild(fill);
    row.append(head, bar, el('div', 'impact-detail', `${i.con}% con (${i.dias_con} días) · ${i.sin}% sin (${i.dias_sin} días)`));
    return row;
  }));
  const answered = Object.values(reports).filter(r => r.diario).length;
  $('impactEmpty').hidden = impacts.length > 0;
  $('impactEmpty').textContent = answered
    ? `Llevás ${answered} ${answered === 1 ? 'día' : 'días'} con cuestionario. Cada hábito aparece cuando haya al menos ${MIN_DAYS_PER_SIDE} días con y ${MIN_DAYS_PER_SIDE} sin.`
    : 'Respondé el cuestionario cada día y acá vas a ver qué te sube y qué te baja la recuperación.';
}

function renderInsights(days) {
  const enough = days.length >= MIN_DAYS_FOR_INSIGHTS;
  const btn = $('insightsBtn');
  btn.disabled = !apiKey || !enough;
  btn.textContent = !enough
    ? `Disponible con ${MIN_DAYS_FOR_INSIGHTS} días cargados (llevás ${days.length})`
    : insights ? 'Actualizar conclusiones' : 'Sacar conclusiones';

  $('insights').hidden = !insights;
  $('insightsIntro').hidden = !!insights;
  if (!insights) return;
  const newDays = days.filter(d => d > insights.ultimo_dia).length;
  $('insightsDate').textContent = `Con ${insights.dias} días, hasta el ${formatDay(insights.ultimo_dia, { day: 'numeric', month: 'long' })}`
    + (newDays ? ` · hay ${newDays} ${newDays === 1 ? 'día nuevo' : 'días nuevos'} desde entonces` : '');
  $('insightsSummary').textContent = insights.resumen;
  $('insightsFindings').replaceChildren(...insights.hallazgos.map(h => evalRow(h.titulo, h.detalle, h.tipo)));
  $('insightsGood').replaceChildren(...listItems(insights.te_hace_bien));
  $('insightsBad').replaceChildren(...listItems(insights.te_juega_en_contra));
  $('insightsPlan').replaceChildren(...listItems(insights.plan_semana));
}

function renderHistory(days) {
  $('historyEmpty').hidden = days.length > 0;
  const recent = days.slice(-14);

  const chart = $('historyChart');
  chart.hidden = recent.length < 2;
  chart.replaceChildren(...recent.map(d => {
    const score = recoveryOf(reports[d]) ?? 0;
    const col = el('button', 'score-col' + (d === viewedDay ? ' active' : ''));
    col.type = 'button';
    col.title = `${formatDay(d, { day: 'numeric', month: 'short' })}: ${score}%`;
    col.addEventListener('click', () => { viewedDay = d; render(); });
    const bar = el('span', `score-bar ${recoveryTone(score)}`);
    bar.style.height = `${Math.max(4, score)}%`;
    col.append(bar, el('span', 'score-col-label', parseISODate(d).getDate()));
    return col;
  }));

  $('historyList').replaceChildren(...days.slice().reverse().slice(0, 30).map(d => {
    const r = reports[d];
    const score = recoveryOf(r);
    const row = el('button', 'history-row' + (d === viewedDay ? ' active' : ''));
    row.type = 'button';
    row.addEventListener('click', () => {
      viewedDay = d;
      render();
      window.scrollTo({ top: $('report').offsetTop - 12, behavior: 'smooth' });
    });
    row.append(
      el('span', 'history-day', formatDay(d, { weekday: 'short', day: 'numeric', month: 'short' })),
      el('span', `history-score ${recoveryTone(score)}`, r.no_legible ? '–' : `${score}%`),
    );
    return row;
  }));
}

// Preguntas que Claude dejó para hoy en el último análisis anterior a este día.
function pendingFollowups(day) {
  const prevDay = Object.keys(reports).filter(d => d < day).sort().pop();
  return prevDay ? (reports[prevDay].preguntas_manana || []) : [];
}

function renderJournal() {
  const day = $('dayInput').value;
  const existing = reports[day];
  journal = { ...(existing?.diario || {}) };

  $('journal').replaceChildren(...QUESTIONS.map(q => {
    const block = el('div', 'q-block');
    const label = el('div', 'q-text', q.text);
    if (q.hint) label.appendChild(el('span', 'q-hint', ` · ${q.hint}`));
    const opts = el('div', 'q-options');
    for (const [value, text] of q.options) {
      const b = el('button', 'q-opt', text);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(journal[q.id] === value));
      b.addEventListener('click', () => {
        if (journal[q.id] === value) delete journal[q.id];
        else journal[q.id] = value;
        [...opts.children].forEach((c, i) => c.setAttribute('aria-pressed', String(journal[q.id] === q.options[i][0])));
      });
      opts.appendChild(b);
    }
    block.append(label, opts);
    return block;
  }));

  const questions = existing?.seguimiento?.map(f => f.pregunta) || pendingFollowups(day);
  const answers = Object.fromEntries((existing?.seguimiento || []).map(f => [f.pregunta, f.respuesta]));
  $('followups').replaceChildren(...questions.map((text, i) => {
    const group = el('div', 'field-group followup');
    const label = el('label', 'field-label', `Pregunta de Claude`);
    label.htmlFor = `followup${i}`;
    const qText = el('p', 'q-text', text);
    const input = el('input');
    input.type = 'text';
    input.id = `followup${i}`;
    input.dataset.question = text;
    input.maxLength = 200;
    input.autocomplete = 'off';
    input.value = answers[text] || '';
    group.append(label, qText, input);
    return group;
  }));

  $('noteInput').value = existing?.nota || '';
}

function readFollowups() {
  return [...$('followups').querySelectorAll('input')]
    .map(i => ({ pregunta: i.dataset.question, respuesta: i.value.trim() }))
    .filter(f => f.respuesta);
}

function renderThumbs() {
  $('thumbs').replaceChildren(...pendingImages.map((img, i) => {
    const wrap = el('div', 'thumb');
    const image = el('img');
    image.src = img.url;
    image.alt = `Captura ${i + 1}`;
    const rm = el('button', 'thumb-remove', '×');
    rm.type = 'button';
    rm.setAttribute('aria-label', 'Quitar captura');
    rm.addEventListener('click', () => {
      URL.revokeObjectURL(img.url);
      pendingImages.splice(i, 1);
      renderThumbs();
      updateAnalyzeBtn();
    });
    wrap.append(image, rm);
    return wrap;
  }));
}

function updateAnalyzeBtn() {
  $('analyzeBtn').disabled = !apiKey || !pendingImages.length || !$('dayInput').value;
}

function setStatus(id, text, isError = false) {
  const node = $(id);
  node.hidden = !text;
  node.textContent = text || '';
  node.classList.toggle('error', isError);
}

// ---------- Events ----------

$('dayInput').value = toISODate(new Date());
$('dayInput').max = toISODate(new Date());
$('dayInput').addEventListener('change', () => { renderJournal(); updateAnalyzeBtn(); });

$('shotsInput').addEventListener('change', async (ev) => {
  const files = [...ev.target.files];
  ev.target.value = '';
  setStatus('analyzeStatus', '');
  for (const file of files) {
    try {
      pendingImages.push(await loadImage(file));
    } catch (err) {
      setStatus('analyzeStatus', err.message, true);
    }
  }
  renderThumbs();
  updateAnalyzeBtn();
});

$('analyzeBtn').addEventListener('click', async () => {
  const day = $('dayInput').value;
  if (reports[day] && !confirm(`Ya hay un análisis para ${formatDay(day)}. ¿Reemplazarlo?`)) return;

  const answers = { ...journal };
  const followups = readFollowups();
  const note = $('noteInput').value.trim();

  $('analyzeBtn').disabled = true;
  setStatus('analyzeStatus', 'Leyendo tus capturas y tu historial… puede tardar unos segundos.');
  try {
    const result = await analyzeDay(day, pendingImages, answers, followups, note);
    reports[day] = { ...result, diario: answers, seguimiento: followups, nota: note, creado: new Date().toISOString() };
    saveReports();
    pendingImages.forEach(img => URL.revokeObjectURL(img.url));
    pendingImages = [];
    renderThumbs();
    setStatus('analyzeStatus', '');
    viewedDay = day;
    renderJournal();
    render();
    window.scrollTo({ top: $('report').offsetTop - 12, behavior: 'smooth' });
  } catch (err) {
    setStatus('analyzeStatus', describeError(err), true);
  } finally {
    updateAnalyzeBtn();
  }
});

$('insightsBtn').addEventListener('click', async () => {
  const days = Object.keys(reports).sort();
  $('insightsBtn').disabled = true;
  setStatus('insightsStatus', 'Analizando todo tu historial…');
  try {
    const result = await analyzeHistory();
    insights = { ...result, dias: Math.min(days.length, HISTORY_DAYS_FOR_INSIGHTS), ultimo_dia: days[days.length - 1], creado: new Date().toISOString() };
    writeJSON(INSIGHTS_KEY, insights);
    setStatus('insightsStatus', '');
    render();
  } catch (err) {
    setStatus('insightsStatus', describeError(err), true);
    renderInsights(days);
  }
});

// Settings
function openSettings() {
  $('apiKeyInput').value = apiKey;
  $('ageInput').value = profile.age || '';
  $('sexSelect').value = profile.sex || '';
  $('heightInput').value = profile.height || '';
  $('weightInput').value = profile.weight || '';
  $('wakeInput').value = profile.wake || '';
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
    wake: $('wakeInput').value || null,
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
  const data = { perfil: profile, dias: reports, conclusiones: insights };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `salud-${toISODate(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('clearBtn').addEventListener('click', () => {
  if (!confirm('¿Borrar todo el historial de salud? No se puede deshacer.')) return;
  reports = {};
  insights = null;
  saveReports();
  localStorage.removeItem(INSIGHTS_KEY);
  viewedDay = null;
  renderJournal();
  render();
  showToast('Historial borrado');
});

renderJournal();
render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
