/* =========================================================
   GymOS - app.js (PRO)
   Firebase-backed training tracker (routines + sessions + progress)

   Features:
   - Hash router (#dashboard, #routines, #new-session, #history, #progress, #settings)
   - Firebase Auth + Firestore state sync
   - Seed routines from user's old notes
   - CRUD: routines, sessions
   - Metrics: weekly KPIs, volume, PR detection, heatmap, exercise progress table
   - UI: modals, drawer, toasts, confirm dialog
   - Import/Export JSON + Export CSV (sessions)

   Improvements:
   - Default theme = LIGHT (mejor para tus reglas)
   - Safer uid() (crypto)
   - Render scheduling (evita renders repetidos)
   - Fix: toast close handler + exercise focus double-onclick bug
   - Less repeated event binding; better delegation
========================================================= */

'use strict';

/* ---------------------------
   CONSTANTS / KEYS
--------------------------- */
const APP_VERSION = "0.3.0-firebase";

// Cache interna por usuario: no es un modo local de trabajo, solo evita perder
// estado temporal mientras Firestore termina de responder.
function lsKeys(uid) {
  const prefix = uid ? `gymos.u.${uid}` : "gymos";
  return {
    routines: `${prefix}.routines.v1`,
    sessions: `${prefix}.sessions.v1`,
    prefs:    `${prefix}.prefs.v1`,
    draft:    `${prefix}.draft.session.v1`,
    focusExercise: `${prefix}.focus.exercise.v1`,
    objectives: `${prefix}.objectives.v1`
  };
}

// LS_KEYS se actualiza cuando el usuario se autentica (ver Auth.applyUser)
let LS_KEYS = lsKeys(null);

const ROUTES = ["dashboard","routines","new-session","history","progress","settings","goals"];

// Musicala-ish: light by default 👀
const DEFAULT_PREFS = {
  theme: "light",     // light | system (evitamos dark por defecto)
  unit: "lbs",        // lbs | kg
  autosave: "on",     // on | off
  dateFmt: "es-CO"    // es-CO | iso
};

/* ---------------------------
   AUTH STATE
--------------------------- */
const Auth = {
  user: null,      // firebase User object
  ready: false,    // true cuando onAuthStateChanged disparó por primera vez

  // Aplica un usuario autenticado: actualiza LS_KEYS y carga sus datos
  applyUser(user) {
    Auth.user = user;
    LS_KEYS = lsKeys(user ? user.uid : null);
  },

  // Muestra u oculta la pantalla de login vs app shell
  showLogin() {
    const screen = document.getElementById("login-screen");
    const app = document.getElementById("app");
    if (screen) screen.classList.remove("is-hidden");
    if (app) app.style.display = "none";
    const mobileNav = document.querySelector(".mobile-nav");
    if (mobileNav) mobileNav.style.display = "none";
  },

  showApp() {
    const screen = document.getElementById("login-screen");
    const app = document.getElementById("app");
    if (screen) screen.classList.add("is-hidden");
    if (app) app.style.display = "";
    const mobileNav = document.querySelector(".mobile-nav");
    if (mobileNav) mobileNav.style.display = "";
  },

  // Actualiza el avatar en el topbar
  updateAvatar(user) {
    const wrap = document.getElementById("userAvatar");
    const img  = document.getElementById("userAvatarImg");
    if (!wrap) return;
    if (user) {
      wrap.hidden = false;
      if (img) {
        img.src = user.photoURL || "";
        img.alt = user.displayName || user.email || "Usuario";
        img.title = user.displayName || user.email || "";
      }
    } else {
      wrap.hidden = true;
      if (img) { img.src = ""; img.alt = ""; }
    }
  }
};

/* ---------------------------
   DOM HELPERS
--------------------------- */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs={}, children=[]) {
  const node = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, String(v));
  }
  for (const c of children) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }

function uid(prefix="id") {
  // crypto uid (menos “random” de mentiras)
  try {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return `${prefix}_${buf[0].toString(16)}${buf[1].toString(16)}_${Date.now().toString(16)}`;
  } catch {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function parseISODate(s) {
  const [y,m,d] = String(s||"").split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m-1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function formatDate(s, prefs) {
  const dt = parseISODate(s);
  if (!dt) return s || "-";
  if (prefs?.dateFmt === "iso") return s;
  try {
    return dt.toLocaleDateString(prefs?.dateFmt || "es-CO", { year:"numeric", month:"short", day:"2-digit" });
  } catch {
    return s;
  }
}

function daysBetween(a, b) {
  const ms = 24*60*60*1000;
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.floor((ub - ua) / ms);
}

function addDays(dt, n) {
  const d = new Date(dt);
  d.setDate(d.getDate() + n);
  return d;
}

function startDateFromRange(value) {
  if (!value || value === "all") return null;
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) return null;
  return addDays(new Date(), -(days - 1));
}

function debounce(fn, wait=150) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* ---------------------------
   STORAGE
--------------------------- */
const Store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // localStorage full, privacy mode, etc.
      console.warn("[GymOS] No se pudo guardar en localStorage:", e);
    }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch {}
  }
};

/* ---------------------------
   FIREBASE SYNC HELPERS
--------------------------- */
let firebaseBootstrapped = false;
let firebaseSaveTimer = null;
let firebaseIsApplyingRemote = false;

function cleanMediaUrl(value) {
  return String(value || "").trim();
}

function withExerciseMedia(ex) {
  const out = { ...(ex || {}) };
  out.imageUrl = cleanMediaUrl(out.imageUrl || out.image || out.img || "");
  out.videoUrl = cleanMediaUrl(out.videoUrl || out.video || out.videoLink || "");
  return out;
}

function normalizeLoadedMedia() {
  State.routines = (State.routines || []).map(r => ({
    ...(r || {}),
    exercises: Array.isArray(r?.exercises) ? r.exercises.map(withExerciseMedia) : []
  }));
  State.sessions = (State.sessions || []).map(s => ({
    ...(s || {}),
    exercises: Array.isArray(s?.exercises) ? s.exercises.map(withExerciseMedia) : []
  }));
}

function appStatePayload() {
  return {
    version: APP_VERSION,
    savedAt: new Date().toISOString(),
    prefs: State.prefs,
    routines: State.routines,
    sessions: State.sessions,
    objectives: State.objectives
  };
}

function payloadHasWorkoutData(payload) {
  return !!payload && (
    (Array.isArray(payload.routines) && payload.routines.length > 0) ||
    (Array.isArray(payload.sessions) && payload.sessions.length > 0) ||
    (Array.isArray(payload.objectives) && payload.objectives.length > 0)
  );
}

function updateFirebaseStatus(title, text, type="") {
  const pill = $("#firebaseStatusPill");
  const label = $("#firebaseStatusText");
  const storage = $("#pillStorage");
  const hint = $("#storageHint");

  if (pill) {
    pill.textContent = title || "Firebase";
    pill.classList.toggle("pill--ok", type === "ok");
    pill.classList.toggle("pill--warn", type === "warn");
  }
  if (label) label.textContent = text || "";
  if (storage && title) storage.textContent = title;
  if (hint && text) hint.textContent = text;
}

function applyRemoteState(payload) {
  if (!payload || typeof payload !== "object") return false;
  firebaseIsApplyingRemote = true;
  try {
    if (payload.prefs) State.prefs = { ...DEFAULT_PREFS, ...payload.prefs };
    if (!["light","system","dark"].includes(State.prefs.theme)) State.prefs.theme = DEFAULT_PREFS.theme;
    if (!State.prefs.unit || !["lbs","kg"].includes(State.prefs.unit)) State.prefs.unit = DEFAULT_PREFS.unit;

    if (Array.isArray(payload.routines)) State.routines = payload.routines;
    if (Array.isArray(payload.sessions)) State.sessions = payload.sessions;
    if (Array.isArray(payload.objectives)) State.objectives = payload.objectives;
    else State.objectives = [];
    normalizeLoadedMedia();

    Store.set(LS_KEYS.prefs, State.prefs);
    Store.set(LS_KEYS.routines, State.routines);
    Store.set(LS_KEYS.sessions, State.sessions);
    Store.set(LS_KEYS.objectives, State.objectives);
    applyTheme();
    return true;
  } finally {
    firebaseIsApplyingRemote = false;
  }
}

async function pushFirebaseNow(showToast=true) {
  const sync = window.FirebaseSync;
  if (!sync || !sync.ready) {
    updateFirebaseStatus("Firebase", "Firebase no está cargado. Revisa internet o los scripts CDN.", "warn");
    if (showToast) toast("Firebase no disponible", "No se guardaron cambios en la nube.", "warn");
    return false;
  }

  try {
    updateFirebaseStatus("Guardando", "Guardando rutinas y sesiones en Firestore…");
    await sync.ready;
    await sync.saveState(appStatePayload());
    updateFirebaseStatus("Firebase", "Sincronizado con Firestore.", "ok");
    if (showToast) toast("Guardado en Firebase", "Tus datos quedaron sincronizados en la nube.", "ok");
    return true;
  } catch (err) {
    console.error("[Firebase] push error", err);
    updateFirebaseStatus("Firebase", "No se pudo guardar en Firebase. Revisa reglas de Firestore/Storage.", "warn");
    if (showToast) toast("No se guardó en Firebase", "Revisa reglas o conexión antes de continuar.", "warn");
    return false;
  }
}

async function pullFirebaseNow(showToast=true) {
  const sync = window.FirebaseSync;
  if (!sync || !sync.ready) {
    updateFirebaseStatus("Firebase", "Firebase no está cargado.", "warn");
    if (showToast) toast("Firebase no disponible", "No pude leer la nube.", "warn");
    return false;
  }

  try {
    updateFirebaseStatus("Leyendo", "Cargando estado desde Firestore…");
    await sync.ready;
    const cloud = await sync.loadState();
    if (!payloadHasWorkoutData(cloud)) {
      updateFirebaseStatus("Firebase", "No hay datos en la nube todavía.", "warn");
      if (showToast) toast("Nube vacía", "Crea datos o guarda el estado actual en Firebase.", "warn");
      return false;
    }
    applyRemoteState(cloud);
    updateFirebaseStatus("Firebase", "Datos cargados desde Firestore.", "ok");
    if (showToast) toast("Datos cargados", "Se bajó la versión guardada en Firebase.", "ok");
    scheduleRender();
    return true;
  } catch (err) {
    console.error("[Firebase] pull error", err);
    updateFirebaseStatus("Firebase", "No se pudo leer Firebase. No se cargaron datos de la nube.", "warn");
    if (showToast) toast("No se leyó Firebase", "Revisa conexión o reglas.", "warn");
    return false;
  }
}

function queueFirebaseSave() {
  if (firebaseIsApplyingRemote) return;
  if (!firebaseBootstrapped) {
    updateFirebaseStatus("Firebase", "Esperando conexión con Firebase para guardar.", "warn");
    return;
  }
  const sync = window.FirebaseSync;
  if (!sync || !sync.ready) {
    updateFirebaseStatus("Firebase", "Firebase no disponible. No se guardaron cambios en la nube.", "warn");
    return;
  }

  clearTimeout(firebaseSaveTimer);
  firebaseSaveTimer = setTimeout(() => {
    pushFirebaseNow(false);
  }, 700);
}

function bindFirebaseStatusListener() {
  if (window.__gymosFirebaseStatusBound) return;
  window.__gymosFirebaseStatusBound = true;
  window.addEventListener("gymos:firebase-status", (event) => {
    const status = event.detail?.status || "";
    if (status === "ready") updateFirebaseStatus("Firebase", "Conectado. Revisando nube…", "ok");
    if (status === "synced") updateFirebaseStatus("Firebase", "Sincronizado con Firestore.", "ok");
    if (status === "error") updateFirebaseStatus("Firebase", "Firebase no cargó. No hay modo local disponible.", "warn");
  });
}

async function initFirebaseSync() {
  bindFirebaseStatusListener();
  const sync = window.FirebaseSync;
  if (!sync || !sync.ready) {
    updateFirebaseStatus("Firebase", "Firebase no está disponible. No se guardarán cambios hasta conectar.", "warn");
    return;
  }

  try {
    updateFirebaseStatus("Firebase", "Conectando con Firestore…");
    await sync.ready;
    const cloud = await sync.loadState();
    const localPayload = appStatePayload();

    if (payloadHasWorkoutData(cloud)) {
      applyRemoteState(cloud);
      updateFirebaseStatus("Firebase", "Datos cargados desde la nube.", "ok");
      scheduleRender();
    } else if (payloadHasWorkoutData(localPayload)) {
      await sync.saveState(localPayload);
      updateFirebaseStatus("Firebase", "Estado inicial guardado en Firestore.", "ok");
    } else {
      updateFirebaseStatus("Firebase", "Conectado. Crea o importa rutinas para sincronizar.", "ok");
    }

    firebaseBootstrapped = true;
  } catch (err) {
    console.error("[Firebase] init error", err);
    firebaseBootstrapped = false;
    updateFirebaseStatus("Firebase", "No se pudo conectar a Firebase. Revisa reglas, Auth o conexión.", "warn");
  }
}

async function uploadExerciseImageForRow(row, file, imageInput, nameInput) {
  const sync = window.FirebaseSync;
  if (!sync || !sync.ready) {
    toast("Firebase no disponible", "Pega una URL de imagen por ahora.", "warn");
    return;
  }

  try {
    imageInput.value = "Subiendo imagen…";
    const url = await sync.uploadExerciseImage(file, nameInput?.value || "ejercicio");
    imageInput.value = url;
    toast("Imagen subida", "Quedó vinculada al ejercicio.", "ok");
  } catch (err) {
    console.error("[Firebase] image upload error", err);
    imageInput.value = "";
    toast("No subió la imagen", "Revisa Storage Rules o usa una URL externa.", "warn");
  }
}


/* ---------------------------
   APP STATE
--------------------------- */
const State = {
  prefs: { ...DEFAULT_PREFS },
  routines: [],
  sessions: [],
  objectives: [],
  selectedRoutineId: null,
  selectedExerciseName: null,
  cardioDraft: null,
  sessionDraft: null,
  route: "dashboard"
};

/* ---------------------------
   SEED DATA
--------------------------- */
function buildSeedRoutines(unit="lbs") {
  const cardio = {
    id: uid("routine"),
    name: "Cardio base (5–10 min) + máquinas",
    tag: "Cardio",
    targetMin: 10,
    cardioSuggest: "5–10 min (elige máquina)",
    exercises: [
      { name:"Spinning", sets:1, reps:"5-10 min", weight:0, unit, notes:"" },
      { name:"Escaladora", sets:1, reps:"5-10 min", weight:0, unit, notes:"" },
      { name:"Caminadora", sets:1, reps:"5-10 min", weight:0, unit, notes:"" },
      { name:"Elíptica", sets:1, reps:"5-10 min", weight:0, unit, notes:"" }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const day1 = {
    id: uid("routine"),
    name: "Día 1 • Pierna (90 min)",
    tag: "Pierna",
    targetMin: 90,
    cardioSuggest: "Cardio 5–10 min",
    exercises: [
      { name:"Elevación de talones", sets:3, reps:"25", weight:155, unit, notes:"" },
      { name:"Tijera Smith", sets:3, reps:"20", weight:30, unit, notes:"" },
      { name:"Peso Muerto Mancuerna", sets:3, reps:"20", weight:20, unit, notes:"" },
      { name:"Leg Curl 1 Pierna", sets:3, reps:"20", weight:20, unit, notes:"" },
      { name:"Aductor (outer thigh)", sets:3, reps:"30", weight:50, unit, notes:"" }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const day2 = {
    id: uid("routine"),
    name: "Día 2 • Core (30–60 min)",
    tag: "Core",
    targetMin: 45,
    cardioSuggest: "Cardio 5–10 min",
    exercises: [
      { name:"Crunch", sets:4, reps:"20", weight:0, unit, notes:"Abdomen" },
      { name:"Oblicuos", sets:4, reps:"20", weight:0, unit, notes:"Abdomen" },
      { name:"Lumbares", sets:4, reps:"20", weight:0, unit, notes:"" },
      { name:"Patada de rana", sets:4, reps:"20", weight:0, unit, notes:"" },
      { name:"Crunch elevación", sets:4, reps:"20", weight:0, unit, notes:"" },
      { name:"Elevación de piernas", sets:4, reps:"20", weight:0, unit, notes:"" }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const day3 = {
    id: uid("routine"),
    name: "Día 3 • Brazos (60 min) • Triseries",
    tag: "Brazos",
    targetMin: 60,
    cardioSuggest: "Cardio 5–10 min",
    exercises: [
      { name:"Curl Scott Romana", sets:3, reps:"20", weight:0, unit, notes:"Triserie (30s)" },
      { name:"Curl Barra Prono", sets:3, reps:"20", weight:10, unit, notes:"Triserie (30s)" },
      { name:"Curl polea 1 mano", sets:3, reps:"20", weight:10, unit, notes:"Triserie (30s)" },
      { name:"Copa Romana", sets:3, reps:"20", weight:0, unit, notes:"Triserie (30s)" },
      { name:"Push down 1 mano", sets:3, reps:"20", weight:10, unit, notes:"Triserie (30s)" },
      { name:"Patada tríceps Polea", sets:3, reps:"20", weight:10, unit, notes:"Triserie (30s)" }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const day4 = {
    id: uid("routine"),
    name: "Día 4 • Espalda/Pecho (60 min) • Biseries",
    tag: "Torso",
    targetMin: 60,
    cardioSuggest: "Cardio 5–10 min",
    exercises: [
      { name:"Halones adelante", sets:3, reps:"20", weight:75, unit, notes:"Biserie" },
      { name:"Peck deck fly", sets:3, reps:"20", weight:30, unit, notes:"Biserie" },
      { name:"Press declinado", sets:3, reps:"20", weight:10, unit, notes:"Biserie" },
      { name:"Remo con barra", sets:3, reps:"20", weight:25, unit, notes:"Biserie" },
      { name:"Remo al piso", sets:3, reps:"20", weight:90, unit, notes:"Biserie" },
      { name:"Pull over", sets:3, reps:"10", weight:25, unit, notes:"Biserie" }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const day5 = {
    id: uid("routine"),
    name: "Día 5 • Pierna (60 min)",
    tag: "Pierna",
    targetMin: 60,
    cardioSuggest: "Cardio 5–10 min",
    exercises: [
      { name:"Sentadilla", sets:4, reps:"15", weight:25, unit, notes:"" },
      { name:"Hack al fondo", sets:4, reps:"15", weight:0, unit, notes:"" },
      { name:"Leg extensión 1 Pierna", sets:3, reps:"10/20", weight:30, unit, notes:"" },
      { name:"Soleo", sets:3, reps:"30", weight:30, unit, notes:"" },
      { name:"Abductor (inner thigh)", sets:3, reps:"40", weight:50, unit, notes:"" }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const day6 = {
    id: uid("routine"),
    name: "Día 6 • Hombro (60 min) • Biseries",
    tag: "Hombro",
    targetMin: 60,
    cardioSuggest: "Cardio 5–10 min",
    exercises: [
      { name:"Press Mancuerna", sets:3, reps:"20", weight:15, unit, notes:"Biserie" },
      { name:"Elevación lateral", sets:3, reps:"20", weight:10, unit, notes:"Biserie" },
      { name:"Elevación Frontal", sets:3, reps:"20", weight:10, unit, notes:"Biserie" },
      { name:"Press Máquina frontal", sets:3, reps:"20", weight:30, unit, notes:"Biserie" },
      { name:"Vuelos posteriores mancuerna", sets:3, reps:"20", weight:10, unit, notes:"Biserie" },
      { name:"Vuelos posteriores Máquina", sets:3, reps:"20", weight:20, unit, notes:"Biserie" }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  return [day1, day2, day3, day4, day5, day6, cardio];
}

const RECOMMENDED_ROUTINES = [
  {
    name: "Push (Empuje) • Fuerza y Volumen",
    tag: "Hipertrofia",
    targetMin: 60,
    cardioSuggest: "10 min Caminadora suave",
    description: "Enfocado en pecho, hombros y tríceps. El motor de tus empujes.",
    exercises: [
      { name: "Press de banca plano", sets: 4, reps: "8-12", weight: 45, notes: "Controlar bajada" },
      { name: "Press militar con mancuernas", sets: 3, reps: "10", weight: 20, notes: "Espalda apoyada" },
      { name: "Aperturas inclinado mancuerna", sets: 3, reps: "12", weight: 15, notes: "Estiramiento máximo" },
      { name: "Fondos de tríceps", sets: 3, reps: "10", weight: 0, notes: "Inclinarse adelante" },
      { name: "Extensión de tríceps en polea", sets: 3, reps: "12", weight: 15, notes: "Codos pegados al cuerpo" }
    ]
  },
  {
    name: "Pull (Tracción) • Espalda y Bíceps",
    tag: "Hipertrofia",
    targetMin: 60,
    cardioSuggest: "10 min Escaladora",
    description: "Desarrolla una espalda fuerte e imponente junto con tus bíceps.",
    exercises: [
      { name: "Dominadas o Jalón al pecho", sets: 4, reps: "8-10", weight: 60, notes: "Retraer escápulas" },
      { name: "Remo con barra", sets: 3, reps: "10", weight: 40, notes: "Mantener core firme" },
      { name: "Vuelos posteriores mancuerna", sets: 3, reps: "12", weight: 10, notes: "Enfoque deltoides post" },
      { name: "Curl de bíceps con barra", sets: 3, reps: "10", weight: 25, notes: "Sin balanceo" },
      { name: "Curl martillo mancuerna", sets: 3, reps: "12", weight: 12, notes: "Agarre neutro" }
    ]
  },
  {
    name: "Pérdida de Grasa • HIIT Funcional",
    tag: "Cardio",
    targetMin: 40,
    cardioSuggest: "20 min Spinning intervalos",
    description: "Rutina explosiva de cuerpo completo para quemar calorías y ganar resistencia.",
    exercises: [
      { name: "Burpees", sets: 3, reps: "15", weight: 0, notes: "Ritmo constante" },
      { name: "Sentadilla libre explosiva", sets: 3, reps: "20", weight: 0, notes: "Velocidad media" },
      { name: "Flexiones de pecho", sets: 3, reps: "15", weight: 0, notes: "Modificar de rodillas si es necesario" },
      { name: "Plank (Plancha abdominal)", sets: 3, reps: "45s", weight: 0, notes: "Core muy apretado" },
      { name: "Escaladores (Mountain climbers)", sets: 3, reps: "30s", weight: 0, notes: "Cardio a tope" }
    ]
  },
  {
    name: "Core de Acero y Estabilidad",
    tag: "Core",
    targetMin: 30,
    cardioSuggest: "5 min Caminadora calentamiento",
    description: "Fortalece tu sección media, mejora postura y previene dolores lumbares.",
    exercises: [
      { name: "Crunch abdominal con peso", sets: 4, reps: "15", weight: 10, notes: "Contracción lenta" },
      { name: "Elevación de piernas colgado", sets: 3, reps: "12", weight: 0, notes: "No balancear piernas" },
      { name: "Plancha lateral (ambos lados)", sets: 3, reps: "30s", weight: 0, notes: "Cadera arriba" },
      { name: "Giros rusos (Russian twists)", sets: 3, reps: "20", weight: 5, notes: "Girar tronco completo" },
      { name: "Superman lumbar", sets: 3, reps: "15", weight: 0, notes: "Sostener 2s arriba" }
    ]
  }
];

/* ---------------------------
   DATA LOAD / SAVE
--------------------------- */
function loadAll() {
  // LS_KEYS ya fue actualizado por Auth.applyUser() antes de llamar esto
  State.prefs = { ...DEFAULT_PREFS, ...(Store.get(LS_KEYS.prefs, null) || {}) };
  // En caso de prefs raras:
  if (!["light","system","dark"].includes(State.prefs.theme)) State.prefs.theme = DEFAULT_PREFS.theme;

  State.routines = Store.get(LS_KEYS.routines, []);
  State.sessions = Store.get(LS_KEYS.sessions, []);
  State.objectives = Store.get(LS_KEYS.objectives, []);
  normalizeLoadedMedia();
  State.selectedRoutineId = null;
  State.cardioDraft = null;
  State.sessionDraft = Store.get(LS_KEYS.draft, null);
}

function savePrefs() { Store.set(LS_KEYS.prefs, State.prefs); queueFirebaseSave(); }
function saveRoutines() { Store.set(LS_KEYS.routines, State.routines); queueFirebaseSave(); }
function saveSessions() { Store.set(LS_KEYS.sessions, State.sessions); queueFirebaseSave(); }
function saveObjectives() { Store.set(LS_KEYS.objectives, State.objectives); queueFirebaseSave(); }

function setDraftSession(draft) {
  State.sessionDraft = draft;
  Store.set(LS_KEYS.draft, draft);
}
function clearDraftSession() {
  State.sessionDraft = null;
  Store.del(LS_KEYS.draft);
}

/* ---------------------------
   UI: RENDER SCHEDULER
--------------------------- */
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderAll();
  });
}

/* ---------------------------
   UI: TOAST / CONFIRM
--------------------------- */
function toast(title, text="", type="") {
  const wrap = $("#toasts");
  if (!wrap) return;

  const node = el("div", { class: `toast ${type ? `toast--${type}` : ""}`.trim(), role:"status", "aria-live":"polite" }, [
    el("div", {}, [
      el("div", { class: "toast__title", text: title }),
      el("div", { class: "toast__text", text: text || "" })
    ]),
    el("button", { class: "icon-btn", type:"button", "aria-label":"Cerrar" }, [
      el("span", { class:"icon", text:"✕", "aria-hidden":"true" })
    ])
  ]);

  const btn = node.querySelector("button.icon-btn");
  btn.addEventListener("click", () => node.remove());

  wrap.appendChild(node);
  setTimeout(() => { node.remove(); }, 4200);
}

function confirmDialog({ title="Confirmar", text="¿Seguro?", yesText="Sí", noText="No" } = {}) {
  return new Promise((resolve) => {
    const box = $("#confirm");
    if (!box) return resolve(false);

    $("#confirmTitle").textContent = title;
    $("#confirmText").textContent = text;
    $("#confirmYes").textContent = yesText;
    $("#confirmNo").textContent = noText;

    const cleanup = () => {
      $("#confirmYes").onclick = null;
      $("#confirmNo").onclick = null;
      box.hidden = true;
    };

    $("#confirmYes").onclick = () => { cleanup(); resolve(true); };
    $("#confirmNo").onclick = () => { cleanup(); resolve(false); };

    box.hidden = false;
    $("#confirmYes")?.focus?.();
  });
}

/* ---------------------------
   UI: MODALS / DRAWER
--------------------------- */
function openModal(id) { const m = $(id); if (m) m.hidden = false; }
function closeModal(id) { const m = $(id); if (m) m.hidden = true; }
function openDrawer(id) { const d = $(id); if (d) d.hidden = false; }
function closeDrawer(id) { const d = $(id); if (d) d.hidden = true; }

function bindModalCloseHandlers() {
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (!t.matches("[data-close]")) return;

    const modal = t.closest(".modal");
    const drawer = t.closest(".drawer");
    if (modal) modal.hidden = true;
    if (drawer) drawer.hidden = true;
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    $$(".modal").forEach(m => { if (!m.hidden) m.hidden = true; });
    $$(".drawer").forEach(d => { if (!d.hidden) d.hidden = true; });
    const c = $("#confirm"); if (c && !c.hidden) c.hidden = true;
  });
}

/* ---------------------------
   ROUTER
--------------------------- */
function getRouteFromHash() {
  const h = (location.hash || "#dashboard").replace("#", "").trim();
  return ROUTES.includes(h) ? h : "dashboard";
}

function setRoute(route) {
  State.route = route;

  // View visibility
  $$(".view").forEach(v => v.classList.remove("is-active"));
  $(`#view-${route}`)?.classList.add("is-active");

  // Nav active
  $$(".nav__item").forEach(a => {
    const active = a.getAttribute("data-route") === route;
    a.classList.toggle("is-active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  // Title/subtitle
  const titleMap = {
    "dashboard": ["Dashboard", "Resumen rápido de tu progreso y constancia."],
    "routines": ["Rutinas", "Crea y ajusta tus plantillas."],
    "new-session": ["Nueva sesión", "Registra lo que hiciste hoy."],
    "history": ["Historial", "Busca, revisa y compara sesiones."],
    "progress": ["Progreso", "PRs, tendencias y frecuencia por ejercicio."],
    "settings": ["Ajustes", "Tema, unidad, import/export y reinicio."],
    "goals": ["Objetivos & Sugerencias", "Establece tus metas y adopta rutinas recomendadas."]
  };
  const [t, s] = titleMap[route] || ["GymOS", ""];
  $("#pageTitle").textContent = t;
  $("#pageSubtitle").textContent = s;

  scheduleRender();
}

function initRouter() {
  window.addEventListener("hashchange", () => setRoute(getRouteFromHash()));
  setRoute(getRouteFromHash());
}

/* ---------------------------
   PREFS / THEME
--------------------------- */
function applyTheme() {
  const app = $("#app");
  if (!app) return;

  const theme = State.prefs.theme;

  if (theme === "system") {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    // Si tu CSS soporta dark, ok. Si no, igual lo dejaremos en light.
    app.dataset.theme = prefersDark ? "dark" : "light";
  } else {
    app.dataset.theme = theme;
  }

  // Reflect in selects if present
  const prefTheme = $("#prefTheme"); if (prefTheme) prefTheme.value = State.prefs.theme;
  const prefUnit = $("#prefUnit"); if (prefUnit) prefUnit.value = State.prefs.unit;
  const prefAutosave = $("#prefAutosave"); if (prefAutosave) prefAutosave.value = State.prefs.autosave;
  const prefDateFmt = $("#prefDateFmt"); if (prefDateFmt) prefDateFmt.value = State.prefs.dateFmt;
}

function bindPrefsUIOnce() {
  // Toggle theme quick button
  $("#btnTheme")?.addEventListener("click", () => {
    const order = ["light","system","dark"]; // por si tu CSS sí soporta dark
    const idx = order.indexOf(State.prefs.theme);
    State.prefs.theme = order[(idx+1) % order.length];
    savePrefs();
    applyTheme();
    toast("Tema", `Ahora: ${State.prefs.theme}`, "ok");
  });

  $("#btnSavePrefs")?.addEventListener("click", () => {
    State.prefs.theme = $("#prefTheme")?.value || State.prefs.theme;
    State.prefs.unit = $("#prefUnit")?.value || State.prefs.unit;
    State.prefs.autosave = $("#prefAutosave")?.value || State.prefs.autosave;
    State.prefs.dateFmt = $("#prefDateFmt")?.value || State.prefs.dateFmt;
    savePrefs();
    applyTheme();
    toast("Preferencias guardadas", "Listo. El universo no colapsó.", "ok");
  });
}

function bindShellActionsOnce() {
  $("#btnQuickSession")?.addEventListener("click", () => {
    location.hash = "#new-session";
  });
  $("#btnGoNewSession")?.addEventListener("click", () => {
    location.hash = "#new-session";
  });
  $("#btnGoProgress")?.addEventListener("click", () => {
    location.hash = "#progress";
  });
  $("#btnGoHistory")?.addEventListener("click", () => {
    location.hash = "#history";
  });
  $("#btnHelp")?.addEventListener("click", () => {
    toast("Ayuda rápida", "Crea una rutina, carga ejercicios y guarda tu sesión.", "ok");
  });

  const importInput = $("#fileImport");
  if (importInput && !importInput.dataset.bound) {
    importInput.dataset.bound = "1";
    importInput.addEventListener("change", () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      importJSONFromFile(file);
      importInput.value = "";
    });
  }

  ["btnImport", "btnImport2"].forEach(id => {
    const node = $(`#${id}`);
    if (!node || node.dataset.bound) return;
    node.dataset.bound = "1";
    node.addEventListener("click", () => importInput?.click());
  });

  ["btnExport", "btnExport2"].forEach(id => {
    const node = $(`#${id}`);
    if (!node || node.dataset.bound) return;
    node.dataset.bound = "1";
    node.addEventListener("click", () => exportJSON());
  });

  $("#btnHistoryExportCSV")?.addEventListener("click", () => exportCSV());
  $("#btnPushFirebase")?.addEventListener("click", () => pushFirebaseNow(true));
  $("#btnPullFirebase")?.addEventListener("click", () => pullFirebaseNow(true));
}

/* ---------------------------
   CRUD: ROUTINES
--------------------------- */
function createRoutine(data) {
  const now = Date.now();
  const r = {
    id: uid("routine"),
    name: String(data.name || "Nueva rutina").trim(),
    tag: String(data.tag || "").trim(),
    targetMin: Number(data.targetMin || 0),
    cardioSuggest: String(data.cardioSuggest || "").trim(),
    exercises: Array.isArray(data.exercises) ? data.exercises.map(x => ({
      name: String(x.name || "").trim(),
      sets: Number(x.sets || 0),
      reps: String(x.reps || "").trim(),
      weight: Number(x.weight || 0),
      unit: x.unit || State.prefs.unit,
      notes: String(x.notes || "").trim(),
      imageUrl: cleanMediaUrl(x.imageUrl || x.image || ""),
      videoUrl: cleanMediaUrl(x.videoUrl || x.video || "")
    })) : [],
    createdAt: now,
    updatedAt: now
  };
  State.routines.unshift(r);
  saveRoutines();
  return r;
}

function updateRoutine(id, patch) {
  const idx = State.routines.findIndex(r => r.id === id);
  if (idx < 0) return null;
  const prev = State.routines[idx];
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  State.routines[idx] = next;
  saveRoutines();
  return next;
}

function deleteRoutine(id) {
  const idx = State.routines.findIndex(r => r.id === id);
  if (idx < 0) return false;
  State.routines.splice(idx, 1);
  if (State.selectedRoutineId === id) State.selectedRoutineId = null;
  saveRoutines();
  return true;
}

function duplicateRoutine(id) {
  const r = State.routines.find(x => x.id === id);
  if (!r) return null;
  const copy = {
    ...r,
    id: uid("routine"),
    name: `${r.name} (copia)`,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  State.routines.unshift(copy);
  saveRoutines();
  return copy;
}

/* ---------------------------
   CRUD: SESSIONS
--------------------------- */
function createSession(session) {
  const s = {
    id: uid("sess"),
    date: session.date || todayISO(),
    durationMin: Number(session.durationMin || 0),
    routineId: session.routineId || "",
    routineName: session.routineName || "",
    unit: session.unit || State.prefs.unit,
    rpe: session.rpe != null && session.rpe !== "" ? Number(session.rpe) : null,
    notes: String(session.notes || ""),
    cardio: session.cardio || null,
    exercises: Array.isArray(session.exercises) ? session.exercises.map(ex => ({
      name: String(ex.name || "").trim(),
      sets: Number(ex.sets || 0),
      reps: String(ex.reps || "").trim(),
      weight: Number(ex.weight || 0),
      unit: ex.unit || session.unit || State.prefs.unit,
      notes: String(ex.notes || "").trim(),
      imageUrl: cleanMediaUrl(ex.imageUrl || ex.image || ""),
      videoUrl: cleanMediaUrl(ex.videoUrl || ex.video || "")
    })) : [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  State.sessions.unshift(s);
  saveSessions();
  return s;
}

function updateSession(id, patch) {
  const idx = State.sessions.findIndex(s => s.id === id);
  if (idx < 0) return null;
  const prev = State.sessions[idx];
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  State.sessions[idx] = next;
  saveSessions();
  return next;
}

function deleteSession(id) {
  const idx = State.sessions.findIndex(s => s.id === id);
  if (idx < 0) return false;
  State.sessions.splice(idx, 1);
  saveSessions();
  return true;
}

/* ---------------------------
   METRICS
--------------------------- */
function parseRepsToNumber(repsStr) {
  const s = String(repsStr || "").toLowerCase().trim();
  if (!s) return 0;
  if (s.includes("min")) return 0;

  if (s.includes("/")) {
    const nums = s.split("/").map(x => parseFloat(x)).filter(n => Number.isFinite(n));
    if (!nums.length) return 0;
    return nums.reduce((a,b)=>a+b,0)/nums.length;
  }

  if (s.includes("-")) {
    const nums = s.split("-").map(x => parseFloat(x)).filter(n => Number.isFinite(n));
    if (nums.length === 2) return (nums[0]+nums[1])/2;
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function calcVolumeForExercise(ex) {
  const sets = Number(ex.sets || 0);
  const reps = parseRepsToNumber(ex.reps);
  const w = Number(ex.weight || 0);
  return Math.max(0, sets) * Math.max(0, reps) * Math.max(0, w);
}

function calcVolumeForSession(session) {
  return (session.exercises || []).reduce((sum, ex) => sum + calcVolumeForExercise(ex), 0);
}

function getSessionsInLastDays(days) {
  const now = new Date();
  return State.sessions.filter(s => {
    const dt = parseISODate(s.date);
    if (!dt) return false;
    return daysBetween(dt, now) <= days;
  });
}

function computePRs() {
  const map = new Map();
  for (const s of State.sessions) {
    for (const ex of (s.exercises || [])) {
      const name = String(ex.name || "").trim();
      if (!name) continue;
      const w = Number(ex.weight || 0);
      const prev = map.get(name);
      if (prev == null || w > prev) map.set(name, w);
    }
  }
  return map;
}

function detectSessionPRs(session, prMapBefore) {
  let count = 0;
  const prs = [];
  for (const ex of (session.exercises || [])) {
    const name = String(ex.name || "").trim();
    if (!name) continue;
    const w = Number(ex.weight || 0);
    const prev = prMapBefore.get(name);
    if (prev == null) {
      if (w > 0) { count++; prs.push({ name, weight: w, prev: null }); }
    } else if (w > prev) {
      count++; prs.push({ name, weight: w, prev });
    }
  }
  return { count, prs };
}

function buildHeatmapData(weeks=8) {
  const totalDays = weeks * 7;
  const end = new Date();
  const start = addDays(end, -totalDays + 1);

  const counts = new Map();
  for (const s of State.sessions) {
    const d = s.date;
    counts.set(d, (counts.get(d) || 0) + 1);
  }

  const cells = [];
  for (let i=0;i<totalDays;i++) {
    const dt = addDays(start, i);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    const c = counts.get(iso) || 0;
    cells.push({ iso, count: c });
  }
  return cells;
}

function trendLabel(values) {
  if (!values.length) return "-";
  const n = values.length;
  if (n < 4) return "—";
  const third = Math.max(1, Math.floor(n/3));
  const a = values.slice(0, third).reduce((x,y)=>x+y,0)/third;
  const b = values.slice(n-third).reduce((x,y)=>x+y,0)/third;
  const delta = b - a;
  if (Math.abs(delta) < 0.5) return "→ estable";
  return delta > 0 ? "↗ subiendo" : "↘ bajando";
}

/* ---------------------------
   RENDER: GLOBAL ENTRY
--------------------------- */
function renderAll() {
  $("#todayLabel") && ($("#todayLabel").textContent = formatDate(todayISO(), State.prefs));

  $("#pillStorage") && ($("#pillStorage").textContent = "Firebase");
  $("#pillOffline") && ($("#pillOffline").textContent = "Nube requerida");

  if (State.route === "dashboard") renderDashboard();
  if (State.route === "routines") renderRoutines();
  if (State.route === "new-session") renderNewSession();
  if (State.route === "history") renderHistory();
  if (State.route === "progress") renderProgress();
  if (State.route === "settings") renderSettings();
  if (State.route === "goals") renderGoals();
}

/* ---------------------------
   DASHBOARD
--------------------------- */
function renderDashboard() {
  const s7 = getSessionsInLastDays(7);
  const cardio7 = s7.reduce((sum, s) => sum + (s.cardio?.minutes ? Number(s.cardio.minutes) : 0), 0);
  const volume7 = s7.reduce((sum, s) => sum + calcVolumeForSession(s), 0);

  $("#kpiSessions7") && ($("#kpiSessions7").textContent = String(s7.length));
  $("#kpiCardio7") && ($("#kpiCardio7").textContent = String(Math.round(cardio7)));
  $("#kpiVolume7") && ($("#kpiVolume7").textContent = String(Math.round(volume7)));

  // PRs in last 30 days (walk history)
  let prCountIn30 = 0;
  const prTrack = new Map();
  const sessionsChrono = [...State.sessions].sort((a,b) => (a.date > b.date ? 1 : -1));
  for (const s of sessionsChrono) {
    const before = new Map(prTrack);
    const prDetected = detectSessionPRs(s, before);
    for (const ex of (s.exercises || [])) {
      const name = String(ex.name||"").trim();
      if (!name) continue;
      const w = Number(ex.weight||0);
      const prev = prTrack.get(name);
      if (prev == null || w > prev) prTrack.set(name, w);
    }
    const dt = parseISODate(s.date);
    if (dt && daysBetween(dt, new Date()) <= 30) prCountIn30 += prDetected.count;
  }
  $("#kpiPRs") && ($("#kpiPRs").textContent = String(prCountIn30));

  renderHeatmap();
  renderNextRoutineSuggestion();
  renderRecentSessions();
  renderFocusExerciseBox();
}

function renderHeatmap() {
  const heat = $("#heatmap");
  if (!heat) return;
  heat.innerHTML = "";

  const cells = buildHeatmapData(8);
  if (!cells.length) {
    heat.appendChild(el("div", { class:"heatmap__skeleton muted", text:"Sin datos aún." }));
    return;
  }

  for (const c of cells) {
    const level = c.count <= 0 ? "" : c.count === 1 ? "l1" : c.count === 2 ? "l2" : c.count === 3 ? "l3" : "l4";
    heat.appendChild(el("div", {
      class: `heatmap__cell ${level}`.trim(),
      title: `${formatDate(c.iso, State.prefs)} • ${c.count} sesión(es)`
    }));
  }
}

function renderNextRoutineSuggestion() {
  const empty = $("#nextRoutineEmpty");
  const box = $("#nextRoutinePreview");
  const list = $("#nextRoutineList");
  if (!empty || !box || !list) return;

  if (!State.routines.length) {
    box.textContent = "Cardio: ninguno";
    return;
  }

  const last3 = State.sessions.slice(0,3).map(s => s.routineId).filter(Boolean);
  const pick = State.routines.find(r => !last3.includes(r.id)) || State.routines[0];

  

  $("#nextRoutineName") && ($("#nextRoutineName").textContent = pick.name);
  $("#nextRoutineMeta") && ($("#nextRoutineMeta").textContent = `${pick.tag || "Sin tag"} • ${pick.exercises.length} ejercicios • ${pick.targetMin || 0} min`);

  list.innerHTML = "";
  pick.exercises.slice(0,6).forEach(ex => {
    list.appendChild(el("li", {}, [
      el("div", { text: `${ex.name}` }),
      el("div", { class:"muted", text: `${ex.sets}×${ex.reps} @ ${ex.weight} ${ex.unit || State.prefs.unit}` })
    ]));
  });

  $("#btnStartNextRoutine") && ($("#btnStartNextRoutine").onclick = () => {
    location.hash = "#new-session";
    prefillNewSessionFromRoutine(pick.id);
    toast("Rutina cargada", pick.name, "ok");
  });
}

function renderRecentSessions() {
  const empty = $("#recentSessionsEmpty");
  const list = $("#recentSessionsList");
  if (!empty || !list) return;

  if (!State.sessions.length) {
    empty.classList.remove("is-hidden");
    list.classList.add("is-hidden");
    return;
  }

  empty.classList.add("is-hidden");
  list.classList.remove("is-hidden");
  list.innerHTML = "";

  State.sessions.slice(0,5).forEach(s => {
    list.appendChild(el("article", { class:"item" }, [
      el("div", { class:"item__left" }, [
        el("div", { class:"item__title", text: s.routineName || "Sesión" }),
        el("div", { class:"muted item__meta", text: `${formatDate(s.date, State.prefs)} • ${s.durationMin || 0} min` })
      ]),
      el("div", { class:"item__right" }, [
        el("span", { class:"pill", text: s.cardio?.machine ? `${s.cardio.machine} ${s.cardio.minutes||0}m` : "Sin cardio" }),
        el("button", { class:"icon-btn", type:"button", "aria-label":"Ver detalle", onclick: () => openSessionDrawer(s.id) }, [
          el("span", { class:"icon", text:"›", "aria-hidden":"true" })
        ])
      ])
    ]));
  });
}

function getExerciseHistory(name) {
  const out = [];
  for (const s of State.sessions) {
    for (const ex of (s.exercises || [])) {
      if (String(ex.name||"").trim() === name) {
        out.push({
          date: s.date,
          weight: Number(ex.weight||0),
          sets: Number(ex.sets||0),
          reps: String(ex.reps||""),
          routineName: s.routineName || ""
        });
      }
    }
  }
  out.sort((a,b) => (a.date < b.date ? 1 : -1));
  return out;
}

function renderFocusExerciseBox() {
  const empty = $("#focusExerciseEmpty");
  const box = $("#focusExerciseBox");
  if (!empty || !box) return;

  const focus = Store.get(LS_KEYS.focusExercise, null);
  if (!focus?.name) {
    box.textContent = "Cardio: ninguno";
  } else {
    empty.classList.add("is-hidden");
    box.classList.remove("is-hidden");
    const name = focus.name;

    $("#focusExerciseName") && ($("#focusExerciseName").textContent = name);

    const history = getExerciseHistory(name);
    $("#focusExerciseMeta") && ($("#focusExerciseMeta").textContent = `${history.length} registros`);
    $("#focusBest") && ($("#focusBest").textContent = history.length ? `${Math.max(...history.map(x=>x.weight))} ${State.prefs.unit}` : "-");
    $("#focusLast") && ($("#focusLast").textContent = history.length ? `${history[0].weight} ${State.prefs.unit}` : "-");
    $("#focusTrend") && ($("#focusTrend").textContent = trendLabel(history.map(x=>x.weight).reverse()));
  }

  $("#btnSetFocusExercise") && ($("#btnSetFocusExercise").onclick = () => {
    location.hash = "#progress";
    toast("Progreso", "Selecciona un ejercicio y fíjalo como foco.", "ok");
  });
}

/* ---------------------------
   ROUTINES
--------------------------- */
const rerenderRoutinesDebounced = debounce(() => scheduleRender(), 120);

function renderRoutines() {
  const grid = $("#routinesGrid");
  const empty = $("#routinesEmpty");
  const search = $("#routineSearch");
  if (!grid || !empty) return;

  $("#routinesCount") && ($("#routinesCount").textContent = `${State.routines.length}`);

  const q = (search?.value || "").toLowerCase().trim();
  const filtered = State.routines.filter(r => {
    if (!q) return true;
    const hay = `${r.name} ${r.tag} ${(r.exercises||[]).map(e=>e.name).join(" ")}`.toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length) {
    empty.classList.remove("is-hidden");
    grid.classList.add("is-hidden");
  } else {
    empty.classList.add("is-hidden");
    grid.classList.remove("is-hidden");
    grid.innerHTML = "";

    const tpl = $("#tplRoutineCard");
    filtered.forEach(r => {
      const node = tpl?.content?.firstElementChild?.cloneNode(true);
      if (!node) return;

      $(".tile__title", node).textContent = r.name;
      $(".tile__meta", node).textContent = `${r.targetMin || 0} min • ${r.exercises.length} ejercicios`;
      const pill = $(".pill", node);
      pill.textContent = r.tag || "Sin tag";

      node.addEventListener("click", () => { State.selectedRoutineId = r.id; scheduleRender(); });
      node.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          State.selectedRoutineId = r.id; scheduleRender();
        }
      });

      grid.appendChild(node);
    });
  }

  // Detail
  renderRoutineDetail();

  // Bind buttons each render is fine (idempotent by overwrite)
  $("#btnNewRoutine") && ($("#btnNewRoutine").onclick = () => openRoutineModal({ mode:"new" }));
  $("#btnSeedRoutines") && ($("#btnSeedRoutines").onclick = () => seedRoutines());

  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.addEventListener("input", rerenderRoutinesDebounced);
  }
}


function isHttpUrl(url) {
  const s = cleanMediaUrl(url);
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function buildExerciseMedia(ex, options={}) {
  const imageUrl = cleanMediaUrl(ex?.imageUrl);
  const videoUrl = cleanMediaUrl(ex?.videoUrl);
  const compact = !!options.compact;
  const wrap = el("div", { class: compact ? "exercise-media exercise-media--compact" : "exercise-media" });
  let hasMedia = false;

  if (imageUrl && isHttpUrl(imageUrl)) {
    const link = el("a", { class:"exercise-media__image", href:imageUrl, target:"_blank", rel:"noopener noreferrer", title:"Abrir imagen" }, [
      el("img", { src:imageUrl, alt:`Imagen guía de ${ex?.name || "ejercicio"}`, loading:"lazy" })
    ]);
    wrap.appendChild(link);
    hasMedia = true;
  }

  if (videoUrl && isHttpUrl(videoUrl)) {
    wrap.appendChild(el("a", {
      class:"media-chip",
      href:videoUrl,
      target:"_blank",
      rel:"noopener noreferrer",
      text: compact ? "Video" : "▶ Ver video"
    }));
    hasMedia = true;
  }

  if (!hasMedia) return null;
  return wrap;
}

function attachExerciseMediaToCard(card, ex) {
  const old = $(".exercise-media", card);
  if (old) old.remove();
  const media = buildExerciseMedia(ex, { compact:false });
  if (!media) return;
  const head = $(".exercise-card__head", card);
  if (head) head.after(media);
}

function renderRoutineDetail() {
  const empty = $("#routineDetailEmpty");
  const detail = $("#routineDetail");
  const tbody = $("#routineExercisesTbody");
  if (!empty || !detail || !tbody) return;

  const id = State.selectedRoutineId;
  const r = State.routines.find(x => x.id === id);

  if (!r) {
    empty.classList.remove("is-hidden");
    detail.classList.add("is-hidden");
    return;
  }

  empty.classList.add("is-hidden");
  detail.classList.remove("is-hidden");

  $("#routineDetailName") && ($("#routineDetailName").textContent = r.name);
  $("#routineDetailMeta") && ($("#routineDetailMeta").textContent = `${r.tag || "Sin tag"} • ${r.exercises.length} ejercicios • ${r.targetMin || 0} min`);
  $("#routineCardio") && ($("#routineCardio").textContent = r.cardioSuggest || "-");

  tbody.innerHTML = "";
  r.exercises.forEach(ex => {
    const guide = buildExerciseMedia(ex, { compact:true }) || el("span", { class:"muted", text:"—" });
    tbody.appendChild(el("tr", {}, [
      el("td", { text: ex.name }),
      el("td", { text: String(ex.sets||0) }),
      el("td", { text: String(ex.reps||"") }),
      el("td", { text: `${ex.weight||0} ${ex.unit || State.prefs.unit}` }),
      el("td", { text: ex.notes || "" }),
      el("td", {}, [guide])
    ]));
  });

  $("#btnEditRoutine") && ($("#btnEditRoutine").onclick = () => openRoutineModal({ mode:"edit", routine: r }));
  $("#btnDuplicateRoutine") && ($("#btnDuplicateRoutine").onclick = () => {
    const copy = duplicateRoutine(r.id);
    if (!copy) return;
    toast("Duplicada", copy.name, "ok");
    State.selectedRoutineId = copy.id;
    scheduleRender();
  });

  $("#btnDeleteRoutine") && ($("#btnDeleteRoutine").onclick = async () => {
    const ok = await confirmDialog({ title:"Eliminar rutina", text:`Eliminar "${r.name}"?`, yesText:"Eliminar", noText:"Cancelar" });
    if (!ok) return;
    deleteRoutine(r.id);
    toast("Eliminada", r.name, "warn");
    scheduleRender();
  });

  $("#btnStartRoutineFromRoutines") && ($("#btnStartRoutineFromRoutines").onclick = () => {
    location.hash = "#new-session";
    prefillNewSessionFromRoutine(r.id);
    toast("Rutina cargada", r.name, "ok");
  });
}

/* ---------------------------
   ROUTINE MODAL
--------------------------- */
function openRoutineModal({ mode="new", routine=null } = {}) {
  const m = $("#modalRoutine");
  if (!m) return;

  const isEdit = mode === "edit" && routine;
  $("#modalRoutineTitle").textContent = isEdit ? "Editar rutina" : "Nueva rutina";

  $("#routineName").value = isEdit ? routine.name : "";
  $("#routineTargetMin").value = isEdit ? (routine.targetMin || "") : "";
  $("#routineTag").value = isEdit ? (routine.tag || "") : "";
  $("#routineCardioSuggest").value = isEdit ? (routine.cardioSuggest || "") : "";

  const editor = $("#routineExercisesEditor");
  editor.innerHTML = "";

  const exercises = isEdit ? (routine.exercises || []) : [];
  if (!exercises.length) {
    editor.appendChild(el("div", { class:"editor__empty muted", text:"Aquí aparecerán los ejercicios." }));
  } else {
    exercises.forEach(ex => editor.appendChild(renderEditorRow(ex)));
  }

  $("#btnAddExerciseRow").onclick = () => {
    $(".editor__empty", editor)?.remove();
    editor.appendChild(renderEditorRow({ name:"", sets:3, reps:"10", weight:0, unit: State.prefs.unit, notes:"", imageUrl:"", videoUrl:"" }));
  };

  $("#btnSaveRoutine").onclick = () => {
    const data = collectRoutineModalData();
    if (!String(data.name || "").trim()) {
      toast("Falta nombre", "Ponle nombre a la rutina.", "warn");
      return;
    }

    if (isEdit) {
      updateRoutine(routine.id, data);
      toast("Rutina actualizada", data.name, "ok");
      State.selectedRoutineId = routine.id;
    } else {
      const created = createRoutine(data);
      toast("Rutina creada", created.name, "ok");
      State.selectedRoutineId = created.id;
    }

    closeModal("#modalRoutine");
    scheduleRender();
  };

  openModal("#modalRoutine");
}

function renderEditorRow(ex) {
  const row = el("div", { class:"editor-row" });

  const name = el("input", { class:"input input--sm", type:"text", value: ex.name || "", placeholder:"Ejercicio", "data-field":"name" });
  const sets = el("input", { class:"input input--sm", type:"number", min:"0", step:"1", value: ex.sets ?? 0, placeholder:"Sets", "data-field":"sets" });
  const reps = el("input", { class:"input input--sm", type:"text", value: ex.reps || "", placeholder:"Reps", "data-field":"reps" });
  const weight = el("input", { class:"input input--sm", type:"number", min:"0", step:"0.5", value: ex.weight ?? 0, placeholder:"Peso", "data-field":"weight" });
  const notes = el("input", { class:"input input--sm", type:"text", value: ex.notes || "", placeholder:"Notas", "data-field":"notes" });
  const imageUrl = el("input", { class:"input input--sm", type:"url", value: cleanMediaUrl(ex.imageUrl || ""), placeholder:"URL imagen", "data-field":"imageUrl" });
  const videoUrl = el("input", { class:"input input--sm", type:"url", value: cleanMediaUrl(ex.videoUrl || ""), placeholder:"Link video", "data-field":"videoUrl" });
  const fileInput = el("input", { type:"file", accept:"image/*", hidden:true, "data-field":"imageFile" });

  const uploadBtn = el("button", { class:"btn btn--ghost btn--sm", type:"button", title:"Subir imagen a Firebase Storage" }, [
    el("span", { class:"icon", text:"🖼️", "aria-hidden":"true" }),
    el("span", { text:"Subir" })
  ]);

  uploadBtn.onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    uploadExerciseImageForRow(row, file, imageUrl, name);
    fileInput.value = "";
  };

  const delBtn = el("button", { class:"icon-btn", type:"button", "aria-label":"Eliminar fila" }, [
    el("span", { class:"icon", text:"🗑️", "aria-hidden":"true" })
  ]);

  delBtn.onclick = async () => {
    const ok = await confirmDialog({ title:"Eliminar ejercicio", text:"¿Eliminar esta fila?", yesText:"Eliminar", noText:"Cancelar" });
    if (!ok) return;
    row.remove();
    const editor = $("#routineExercisesEditor");
    if (editor && editor.querySelectorAll(".editor-row").length === 0) {
      editor.innerHTML = "";
      editor.appendChild(el("div", { class:"editor__empty muted", text:"Aquí aparecerán los ejercicios." }));
    }
  };

  row.appendChild(name);
  row.appendChild(sets);
  row.appendChild(reps);
  row.appendChild(weight);
  row.appendChild(notes);
  row.appendChild(imageUrl);
  row.appendChild(videoUrl);
  row.appendChild(uploadBtn);
  row.appendChild(delBtn);
  row.appendChild(fileInput);

  return row;
}

function collectRoutineModalData() {
  const editor = $("#routineExercisesEditor");
  const rows = $$(".editor-row", editor);

  const getField = (row, field) => row.querySelector(`[data-field="${field}"]`)?.value || "";

  const exercises = rows.map(row => {
    const name = getField(row, "name");
    const sets = getField(row, "sets");
    const reps = getField(row, "reps");
    const weight = getField(row, "weight");
    const notes = getField(row, "notes");
    const imageUrl = getField(row, "imageUrl");
    const videoUrl = getField(row, "videoUrl");

    return {
      name: String(name).trim(),
      sets: Number(sets || 0),
      reps: String(reps).trim(),
      weight: Number(weight || 0),
      unit: State.prefs.unit,
      notes: String(notes).trim(),
      imageUrl: cleanMediaUrl(imageUrl),
      videoUrl: cleanMediaUrl(videoUrl)
    };
  }).filter(x => x.name);

  return {
    name: $("#routineName").value,
    targetMin: Number($("#routineTargetMin").value || 0),
    tag: $("#routineTag").value,
    cardioSuggest: $("#routineCardioSuggest").value,
    exercises
  };
}


/* ---------------------------
   SEED ROUTINES
--------------------------- */
function seedRoutines() {
  if (State.routines.length) {
    toast("Ya tienes rutinas", "Si quieres la base histórica, reinicia o importa.", "warn");
    return;
  }
  State.routines = buildSeedRoutines(State.prefs.unit);
  saveRoutines();
  toast("Base cargada", "Rutinas Día 1–6 + Cardio.", "ok");
  scheduleRender();
}

/* ---------------------------
   NEW SESSION
--------------------------- */
function renderNewSession() {
  const sel = $("#sessionRoutineSelect");
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = `<option value="">Selecciona una rutina…</option>`;
    State.routines.forEach(r => {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = r.name;
      sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
  }

  $("#sessionDate") && ($("#sessionDate").value = $("#sessionDate").value || todayISO());
  $("#weightUnit") && ($("#weightUnit").value = State.prefs.unit);

  if (State.sessionDraft && State.prefs.autosave === "on") {
    applyDraftToSessionUI(State.sessionDraft);
  }

  $("#btnLoadRoutineIntoSession") && ($("#btnLoadRoutineIntoSession").onclick = () => loadExercisesFromSelectedRoutine());
  $("#btnClearSession") && ($("#btnClearSession").onclick = async () => {
    const ok = await confirmDialog({ title:"Limpiar sesión", text:"Borrar borrador actual?", yesText:"Limpiar", noText:"Cancelar" });
    if (!ok) return;
    resetSessionUI();
    clearDraftSession();
    toast("Limpio", "Sesión vacía.", "ok");
  });

  $("#btnAddCardio") && ($("#btnAddCardio").onclick = () => openCardioModal());
  $("#btnSaveSession") && ($("#btnSaveSession").onclick = () => saveSessionFromUI());
  $("#btnPreviewSession") && ($("#btnPreviewSession").onclick = () => previewSession());

  bindSessionAutosaveOnce();
  renderCardioSummary();
}

function prefillNewSessionFromRoutine(routineId) {
  $("#sessionRoutineSelect") && ($("#sessionRoutineSelect").value = routineId);
  $("#sessionDate") && ($("#sessionDate").value = todayISO());
  $("#sessionDuration") && ($("#sessionDuration").value = "");
  $("#sessionRPE") && ($("#sessionRPE").value = "");
  $("#sessionNotes") && ($("#sessionNotes").value = "");
  State.cardioDraft = null;
  renderCardioSummary();
  loadExercisesFromSelectedRoutine();
}

function loadExercisesFromSelectedRoutine() {
  const routineId = $("#sessionRoutineSelect")?.value;
  if (!routineId) {
    toast("Selecciona rutina", "Primero elige una plantilla.", "warn");
    return;
  }
  const r = State.routines.find(x => x.id === routineId);
  if (!r) {
    toast("Rutina no encontrada", "Rutina fantasma detectada.", "bad");
    return;
  }

  if (!$("#sessionDuration")?.value && r.targetMin) $("#sessionDuration").value = r.targetMin;

  const wrap = $("#sessionExercises");
  const empty = $("#sessionExercisesEmpty");
  if (!wrap || !empty) return;

  wrap.innerHTML = "";

  r.exercises.forEach(ex => {
    const tpl = $("#tplExerciseCard");
    const node = tpl?.content?.firstElementChild?.cloneNode(true);
    if (!node) return;

    $(".exercise-card__name", node).textContent = ex.name;
    $(".exercise-card__hint", node).textContent = `Sugerido: ${ex.sets}×${ex.reps} @ ${ex.weight} ${ex.unit || State.prefs.unit}`;

    const inputs = $$("input", node); // sets, reps, weight, notes
    inputs[0] && (inputs[0].value = ex.sets ?? 0);
    inputs[1] && (inputs[1].value = ex.reps ?? "");
    inputs[2] && (inputs[2].value = ex.weight ?? 0);
    inputs[3] && (inputs[3].value = ex.notes ?? "");

    node.dataset.exerciseName = ex.name;
    node.dataset.imageUrl = cleanMediaUrl(ex.imageUrl || "");
    node.dataset.videoUrl = cleanMediaUrl(ex.videoUrl || "");
    attachExerciseMediaToCard(node, ex);
    wrap.appendChild(node);
  });

  empty.classList.add("is-hidden");
  wrap.classList.remove("is-hidden");

  setDraftSession(collectSessionDraftFromUI());
  toast("Ejercicios cargados", r.name, "ok");
}

function collectSessionDraftFromUI() {
  const routineId = $("#sessionRoutineSelect")?.value || "";
  const r = State.routines.find(x => x.id === routineId);

  const date = $("#sessionDate")?.value || todayISO();
  const durationMin = Number($("#sessionDuration")?.value || 0);
  const unit = $("#weightUnit")?.value || State.prefs.unit;
  const rpeVal = $("#sessionRPE")?.value ?? "";
  const notes = $("#sessionNotes")?.value || "";

  const wrap = $("#sessionExercises");
  const cards = wrap ? $$(".exercise-card", wrap) : [];
  const exercises = cards.map(card => {
    const name = card.dataset.exerciseName || $(".exercise-card__name", card)?.textContent || "";
    const inputs = $$("input", card);
    return {
      name: String(name).trim(),
      sets: Number(inputs[0]?.value || 0),
      reps: String(inputs[1]?.value || "").trim(),
      weight: Number(inputs[2]?.value || 0),
      unit,
      notes: String(inputs[3]?.value || "").trim(),
      imageUrl: cleanMediaUrl(card.dataset.imageUrl || ""),
      videoUrl: cleanMediaUrl(card.dataset.videoUrl || "")
    };
  }).filter(x => x.name);

  return {
    routineId,
    routineName: r?.name || "",
    date,
    durationMin,
    unit,
    rpe: rpeVal === "" ? null : Number(rpeVal),
    notes,
    cardio: State.cardioDraft,
    exercises
  };
}

function applyDraftToSessionUI(draft) {
  $("#sessionRoutineSelect") && ($("#sessionRoutineSelect").value = draft.routineId || "");
  $("#sessionDate") && ($("#sessionDate").value = draft.date || todayISO());
  $("#sessionDuration") && ($("#sessionDuration").value = draft.durationMin || "");
  $("#weightUnit") && ($("#weightUnit").value = draft.unit || State.prefs.unit);
  $("#sessionRPE") && ($("#sessionRPE").value = (draft.rpe ?? ""));
  $("#sessionNotes") && ($("#sessionNotes").value = draft.notes || "");

  State.cardioDraft = draft.cardio || null;
  renderCardioSummary();

  const wrap = $("#sessionExercises");
  const empty = $("#sessionExercisesEmpty");
  if (!wrap || !empty) return;

  wrap.innerHTML = "";

  if (draft.exercises && draft.exercises.length) {
    draft.exercises.forEach(ex => {
      const tpl = $("#tplExerciseCard");
      const node = tpl?.content?.firstElementChild?.cloneNode(true);
      if (!node) return;

      $(".exercise-card__name", node).textContent = ex.name;
      $(".exercise-card__hint", node).textContent = `Borrador: ${ex.sets}×${ex.reps} @ ${ex.weight} ${ex.unit || State.prefs.unit}`;

      const inputs = $$("input", node);
      inputs[0] && (inputs[0].value = ex.sets ?? 0);
      inputs[1] && (inputs[1].value = ex.reps ?? "");
      inputs[2] && (inputs[2].value = ex.weight ?? 0);
      inputs[3] && (inputs[3].value = ex.notes ?? "");

      node.dataset.exerciseName = ex.name;
      node.dataset.imageUrl = cleanMediaUrl(ex.imageUrl || "");
      node.dataset.videoUrl = cleanMediaUrl(ex.videoUrl || "");
      attachExerciseMediaToCard(node, ex);
      wrap.appendChild(node);
    });

    empty.classList.add("is-hidden");
    wrap.classList.remove("is-hidden");
  } else {
    empty.classList.remove("is-hidden");
    wrap.classList.add("is-hidden");
  }
}

function resetSessionUI() {
  $("#sessionRoutineSelect") && ($("#sessionRoutineSelect").value = "");
  $("#sessionDate") && ($("#sessionDate").value = todayISO());
  $("#sessionDuration") && ($("#sessionDuration").value = "");
  $("#weightUnit") && ($("#weightUnit").value = State.prefs.unit);
  $("#sessionRPE") && ($("#sessionRPE").value = "");
  $("#sessionNotes") && ($("#sessionNotes").value = "");

  State.cardioDraft = null;
  renderCardioSummary();

  const wrap = $("#sessionExercises");
  wrap && (wrap.innerHTML = "", wrap.classList.add("is-hidden"));
  $("#sessionExercisesEmpty") && ($("#sessionExercisesEmpty").classList.remove("is-hidden"));
}

let sessionAutosaveBound = false;
function bindSessionAutosaveOnce() {
  if (sessionAutosaveBound) return;
  sessionAutosaveBound = true;

  const onChange = debounce(() => {
    if (State.prefs.autosave !== "on") return;
    setDraftSession(collectSessionDraftFromUI());
  }, 180);

  ["sessionRoutineSelect","sessionDate","sessionDuration","weightUnit","sessionRPE","sessionNotes"].forEach(id => {
    const node = $(`#${id}`);
    if (!node) return;
    node.addEventListener("input", onChange);
    node.addEventListener("change", onChange);
  });

  // Delegación para inputs dentro de cards (evita bind repetido)
  const wrap = $("#sessionExercises");
  if (wrap && !wrap.dataset.bound) {
    wrap.dataset.bound = "1";
    wrap.addEventListener("input", onChange);
    wrap.addEventListener("change", onChange);

    // Fix bug “doble click/focus raro”: si alguien clica en la tarjeta, enfoca el primer input una sola vez
    wrap.addEventListener("click", (e) => {
      const card = e.target instanceof HTMLElement ? e.target.closest(".exercise-card") : null;
      if (!card) return;
      // Si clicó directamente un input, no molestamos
      if (e.target instanceof HTMLElement && e.target.matches("input, textarea, button, a, select")) return;
      const first = card.querySelector("input");
      first && first.focus({ preventScroll: true });
    });
  }
}

/* --------------------------- CARDIO MODAL --------------------------- */
function openCardioModal() {
  $("#cardioMachine").value = State.cardioDraft?.machine || "Elíptica";
  $("#cardioMinutes").value = State.cardioDraft?.minutes ?? "";
  $("#cardioIntensity").value = State.cardioDraft?.intensity || "Suave";
  $("#cardioNotes").value = State.cardioDraft?.notes || "";
  $("#btnSaveCardio").onclick = () => {
    const machine = $("#cardioMachine").value || "";
    const minutes = Number($("#cardioMinutes").value || 0);
    const intensity = $("#cardioIntensity").value || "";
    const notes = $("#cardioNotes").value || "";
    if (!machine || minutes <= 0) {
      toast("Cardio incompleto", "Elige máquina y minutos (>0).", "warn");
      return;
    }
    State.cardioDraft = { machine, minutes, intensity, notes };
    renderCardioSummary();
    setDraftSession(collectSessionDraftFromUI());
    closeModal("#modalCardio");
    toast("Cardio agregado", `${machine} • ${minutes} min`, "ok");
  };
  $("#btnDeleteCardio") && ($("#btnDeleteCardio").onclick = async () => {
    const ok = await confirmDialog({ title:"Quitar cardio", text:"¿Eliminar el cardio de esta sesión?", yesText:"Quitar", noText:"Cancelar" });
    if (!ok) return;
    State.cardioDraft = null;
    renderCardioSummary();
    setDraftSession(collectSessionDraftFromUI());
    closeModal("#modalCardio");
    toast("Cardio quitado", "Listo.", "ok");
  });
  openModal("#modalCardio");
}

function renderCardioSummary() {
  const box = $("#cardioSummary");
  if (!box) return;
  const c = State.cardioDraft;
  if (!c) {
    empty.classList.remove("is-hidden");
    box.textContent = "Cardio: ninguno";
    return;
  }
  
  $("#cardioSummaryText") && ($("#cardioSummaryText").textContent = `${c.machine} • ${c.minutes} min • ${c.intensity || "—"}`);
  box.textContent = `Cardio: ${c.machine} | ${c.minutes} min | ${c.intensity || "-"}`;
}

/* --------------------------- SAVE SESSION --------------------------- */
async function saveSessionFromUI() {
  const draft = collectSessionDraftFromUI();
  if (!draft.routineId) {
    toast("Falta rutina", "Selecciona una rutina para guardar.", "warn");
    return;
  }
  if (!draft.exercises.length && !draft.cardio) {
    const ok = await confirmDialog({
      title: "Sesión sin ejercicios",
      text: "No tienes ejercicios ni cardio. ¿Guardar igual?",
      yesText: "Guardar",
      noText: "Cancelar"
    });
    if (!ok) return;
  }

  // PR detection: antes de guardar, calculamos PRs actuales
  const prBefore = computePRs();
  const r = State.routines.find(x => x.id === draft.routineId);
  draft.routineName = r?.name || draft.routineName || "Sesión";

  const s = createSession(draft);
  const prDetected = detectSessionPRs(s, prBefore);

  clearDraftSession();
  resetSessionUI();

  if (prDetected.count > 0) {
    toast("Sesión guardada + PRs 🎯", `${prDetected.count} PR(s) detectado(s).`, "ok");
  } else {
    toast("Sesión guardada", `${draft.routineName} • ${formatDate(s.date, State.prefs)}`, "ok");
  }

  // ir al historial para ver el resultado
  location.hash = "#history";
}

/* --------------------------- PREVIEW SESSION --------------------------- */
function previewSession() {
  const draft = collectSessionDraftFromUI();
  const wrap = $("#sessionPreviewBody");
  if (!wrap) return;
  wrap.innerHTML = "";

  const head = el("div", { class:"preview__head" }, [
    el("div", { class:"preview__title", text: draft.routineName || "Sesión" }),
    el("div", { class:"muted", text: `${formatDate(draft.date, State.prefs)} • ${draft.durationMin || 0} min • ${draft.unit}` })
  ]);
  wrap.appendChild(head);

  if (draft.cardio) {
    wrap.appendChild(el("div", { class:"preview__card" }, [
      el("div", { class:"preview__label", text:"Cardio" }),
      el("div", { text: `${draft.cardio.machine} • ${draft.cardio.minutes} min • ${draft.cardio.intensity || "—"}` }),
      draft.cardio.notes ? el("div", { class:"muted", text: draft.cardio.notes }) : el("div", { class:"muted", text:"" })
    ]));
  }

  if (draft.exercises.length) {
    const list = el("div", { class:"preview__list" });
    draft.exercises.forEach(ex => {
      const row = el("div", { class:"preview__row" }, [
        el("div", { class:"preview__row-title", text: ex.name }),
        el("div", { class:"muted", text: `${ex.sets}×${ex.reps} @ ${ex.weight} ${ex.unit}` }),
        ex.notes ? el("div", { class:"muted", text: ex.notes }) : el("div", { class:"muted", text:"" })
      ]);
      const media = buildExerciseMedia(ex, { compact:true });
      if (media) row.appendChild(media);
      list.appendChild(row);
    });
    wrap.appendChild(list);
  } else {
    wrap.appendChild(el("div", { class:"muted", text:"Sin ejercicios." }));
  }

  if (draft.notes) {
    wrap.appendChild(el("div", { class:"preview__notes" }, [
      el("div", { class:"preview__label", text:"Notas" }),
      el("div", { text: draft.notes })
    ]));
  }

  openModal("#modalSessionPreview");
}

/* --------------------------- HISTORY --------------------------- */
const rerenderHistoryDebounced = debounce(() => scheduleRender(), 140);

function renderHistory() {
  const list = $("#historyList");
  const empty = $("#historyEmpty");
  const search = $("#historySearch");
  const from = $("#historyFrom");
  const to = $("#historyTo");
  if (!list || !empty) return;

  const q = (search?.value || "").toLowerCase().trim();
  const fromD = from?.value ? parseISODate(from.value) : null;
  const toD = to?.value ? parseISODate(to.value) : null;

  let filtered = State.sessions.slice();
  filtered = filtered.filter(s => {
    if (q) {
      const hay = `${s.routineName} ${(s.exercises||[]).map(e=>e.name).join(" ")} ${s.notes||""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    const dt = parseISODate(s.date);
    if (fromD && dt && dt < fromD) return false;
    if (toD && dt && dt > toD) return false;
    return true;
  });

  $("#historyCount") && ($("#historyCount").textContent = String(filtered.length));

  if (!filtered.length) {
    empty.classList.remove("is-hidden");
    list.classList.add("is-hidden");
  } else {
    empty.classList.add("is-hidden");
    list.classList.remove("is-hidden");
    list.innerHTML = "";

    filtered.slice(0, 200).forEach(s => {
      const vol = Math.round(calcVolumeForSession(s));
      const cardioTxt = s.cardio?.machine ? `${s.cardio.machine} ${s.cardio.minutes||0}m` : "—";
      list.appendChild(el("article", { class:"item item--history" }, [
        el("div", { class:"item__left" }, [
          el("div", { class:"item__title", text: s.routineName || "Sesión" }),
          el("div", { class:"muted item__meta", text: `${formatDate(s.date, State.prefs)} • ${s.durationMin || 0} min • Vol ${vol}` })
        ]),
        el("div", { class:"item__right" }, [
          el("span", { class:"pill", text: cardioTxt }),
          el("button", { class:"icon-btn", type:"button", "aria-label":"Ver detalle", onclick: () => openSessionDrawer(s.id) }, [
            el("span", { class:"icon", text:"›", "aria-hidden":"true" })
          ])
        ])
      ]));
    });
  }

  // bind once
  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.addEventListener("input", rerenderHistoryDebounced);
  }
  if (from && !from.dataset.bound) {
    from.dataset.bound = "1";
    from.addEventListener("change", rerenderHistoryDebounced);
  }
  if (to && !to.dataset.bound) {
    to.dataset.bound = "1";
    to.addEventListener("change", rerenderHistoryDebounced);
  }

  $("#btnClearHistoryFilters") && ($("#btnClearHistoryFilters").onclick = () => {
    if (search) search.value = "";
    if (from) from.value = "";
    if (to) to.value = "";
    scheduleRender();
  });
}

/* --------------------------- SESSION DRAWER (DETAIL) --------------------------- */
function openSessionDrawer(id) {
  const s = State.sessions.find(x => x.id === id);
  if (!s) return;

  $("#drawerSessionTitle").textContent = s.routineName || "Sesión";
  $("#drawerSessionMeta").textContent = `${formatDate(s.date, State.prefs)} • ${s.durationMin || 0} min • ${s.unit}`;

  const body = $("#drawerSessionBody");
  body.innerHTML = "";

  if (s.cardio) {
    body.appendChild(el("div", { class:"drawer__card" }, [
      el("div", { class:"drawer__label", text:"Cardio" }),
      el("div", { text: `${s.cardio.machine} • ${s.cardio.minutes} min • ${s.cardio.intensity || "—"}` }),
      s.cardio.notes ? el("div", { class:"muted", text: s.cardio.notes }) : el("div", { class:"muted", text:"" })
    ]));
  }

  if (s.exercises?.length) {
    const table = el("table", { class:"table table--compact" }, [
      el("thead", {}, [ el("tr", {}, [
        el("th", { text:"Ejercicio" }),
        el("th", { text:"Sets" }),
        el("th", { text:"Reps" }),
        el("th", { text:"Peso" }),
        el("th", { text:"Notas" })
      ]) ]),
      el("tbody", {}, [])
    ]);
    const tb = table.querySelector("tbody");
    s.exercises.forEach(ex => {
      tb.appendChild(el("tr", {}, [
        el("td", { text: ex.name }),
        el("td", { text: String(ex.sets||0) }),
        el("td", { text: String(ex.reps||"") }),
        el("td", { text: `${ex.weight||0} ${ex.unit||s.unit}` }),
        el("td", { text: ex.notes || "" })
      ]));
    });
    body.appendChild(table);
  } else {
    body.appendChild(el("div", { class:"muted", text:"Sin ejercicios." }));
  }

  if (s.notes) {
    body.appendChild(el("div", { class:"drawer__notes" }, [
      el("div", { class:"drawer__label", text:"Notas" }),
      el("div", { text: s.notes })
    ]));
  }

  $("#btnDeleteSession") && ($("#btnDeleteSession").onclick = async () => {
    const ok = await confirmDialog({ title:"Eliminar sesión", text:`Eliminar "${s.routineName || "Sesión"}" del ${formatDate(s.date, State.prefs)}?`, yesText:"Eliminar", noText:"Cancelar" });
    if (!ok) return;
    deleteSession(s.id);
    closeDrawer("#drawerSession");
    toast("Sesión eliminada", "Adiós, registro.", "warn");
    scheduleRender();
  });

  $("#btnCloneToDraft") && ($("#btnCloneToDraft").onclick = () => {
    // clonar al borrador y mandar a nueva sesión
    State.cardioDraft = s.cardio || null;
    setDraftSession({
      routineId: s.routineId,
      routineName: s.routineName,
      date: todayISO(),
      durationMin: s.durationMin,
      unit: s.unit,
      rpe: s.rpe,
      notes: s.notes,
      cardio: s.cardio || null,
      exercises: (s.exercises || []).map(ex => ({ ...ex }))
    });
    closeDrawer("#drawerSession");
    location.hash = "#new-session";
    toast("Clonada a borrador", "Quedó lista para editar y guardar hoy.", "ok");
  });

  openDrawer("#drawerSession");
}

/* --------------------------- PROGRESS --------------------------- */
function renderProgress() {
  const prList = $("#prsList");
  const exTable = $("#exerciseProgressTbody");
  const search = $("#exerciseSearch");
  if (!prList || !exTable) return;

  const q = (search?.value || "").toLowerCase().trim();
  const prs = computePRs();

  // PRs (top)
  prList.innerHTML = "";
  const top = Array.from(prs.entries())
    .sort((a,b) => b[1]-a[1])
    .slice(0, 12);

  if (!top.length) {
    prList.appendChild(el("div", { class:"muted", text:"Sin PRs aún. Entrena, humano." }));
  } else {
    top.forEach(([name, w]) => {
      prList.appendChild(el("div", { class:"pr" }, [
        el("div", { class:"pr__name", text: name }),
        el("div", { class:"pr__val", text: `${w} ${State.prefs.unit}` }),
        el("button", {
          class:"btn btn--sm",
          type:"button",
          onclick: () => {
            Store.set(LS_KEYS.focusExercise, { name });
            toast("Foco fijado", name, "ok");
            scheduleRender();
          }
        }, [ "Fijar foco" ])
      ]));
    });
  }

  // Exercise progress table
  const names = new Set();
  for (const s of State.sessions) for (const ex of (s.exercises || [])) names.add(String(ex.name||"").trim());
  let all = Array.from(names).filter(Boolean).sort((a,b)=>a.localeCompare(b));

  if (q) all = all.filter(n => n.toLowerCase().includes(q));

  exTable.innerHTML = "";
  all.slice(0, 250).forEach(name => {
    const hist = getExerciseHistory(name);
    const best = hist.length ? Math.max(...hist.map(x=>x.weight)) : 0;
    const last = hist.length ? hist[0].weight : 0;
    const trend = trendLabel(hist.map(x=>x.weight).reverse());
    exTable.appendChild(el("tr", {}, [
      el("td", { text: name }),
      el("td", { text: `${best} ${State.prefs.unit}` }),
      el("td", { text: `${last} ${State.prefs.unit}` }),
      el("td", { text: trend }),
      el("td", {}, [
        el("button", {
          class:"btn btn--sm",
          type:"button",
          onclick: () => {
            Store.set(LS_KEYS.focusExercise, { name });
            toast("Foco fijado", name, "ok");
            scheduleRender();
          }
        }, [ "Fijar" ])
      ])
    ]));
  });

  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.addEventListener("input", debounce(() => scheduleRender(), 150));
  }
}

/* --------------------------- SETTINGS (IMPORT/EXPORT/RESET) --------------------------- */
function exportJSON() {
  const payload = {
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    prefs: State.prefs,
    routines: State.routines,
    sessions: State.sessions,
    objectives: State.objectives
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gymos_export_${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCSV() {
  const rows = [];
  rows.push(["date","routineName","durationMin","unit","rpe","cardioMachine","cardioMinutes","exerciseName","sets","reps","weight","notes","imageUrl","videoUrl"].join(","));
  for (const s of State.sessions) {
    const cardioMachine = s.cardio?.machine || "";
    const cardioMinutes = s.cardio?.minutes || "";
    if (s.exercises?.length) {
      for (const ex of s.exercises) {
        rows.push([
          s.date,
          csvSafe(s.routineName||""),
          s.durationMin||0,
          s.unit||"",
          s.rpe ?? "",
          csvSafe(cardioMachine),
          cardioMinutes,
          csvSafe(ex.name||""),
          ex.sets||0,
          csvSafe(ex.reps||""),
          ex.weight||0,
          csvSafe(ex.notes||""),
          csvSafe(ex.imageUrl||""),
          csvSafe(ex.videoUrl||"")
        ].join(","));
      }
    } else {
      rows.push([
        s.date,
        csvSafe(s.routineName||""),
        s.durationMin||0,
        s.unit||"",
        s.rpe ?? "",
        csvSafe(cardioMachine),
        cardioMinutes,
        "",0,"",0,csvSafe(s.notes||""),"",""
      ].join(","));
    }
  }
  const blob = new Blob([rows.join("\n")], { type:"text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gymos_sessions_${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function csvSafe(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}

function importJSONFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || "{}"));
      if (!data) throw new Error("JSON vacío");
      if (data.prefs) State.prefs = { ...DEFAULT_PREFS, ...data.prefs };
      if (Array.isArray(data.routines)) State.routines = data.routines;
      if (Array.isArray(data.sessions)) State.sessions = data.sessions;
      if (Array.isArray(data.objectives)) State.objectives = data.objectives;
      normalizeLoadedMedia();
      savePrefs(); saveRoutines(); saveSessions(); saveObjectives();
      applyTheme();
      toast("Importado", "Datos cargados.", "ok");
      scheduleRender();
    } catch (e) {
      toast("Import falló", "Ese archivo no es un export válido.", "bad");
      console.error(e);
    }
  };
  reader.readAsText(file);
}

async function resetAllData() {
  const ok = await confirmDialog({
    title: "Reiniciar TODO",
    text: "Esto borra rutinas, sesiones, objetivos y preferencias en Firebase. No hay botón de arrepentimiento.",
    yesText: "Borrar todo",
    noText: "Cancelar"
  });
  if (!ok) return;
  if (!firebaseBootstrapped) {
    updateFirebaseStatus("Firebase", "Conecta Firebase antes de reiniciar datos.", "warn");
    toast("Firebase requerido", "No se reinició porque la nube no está conectada.", "warn");
    return;
  }
  Store.del(LS_KEYS.prefs);
  Store.del(LS_KEYS.routines);
  Store.del(LS_KEYS.sessions);
  Store.del(LS_KEYS.objectives);
  Store.del(LS_KEYS.draft);
  Store.del(LS_KEYS.focusExercise);
  loadAll();
  applyTheme();
  const saved = await pushFirebaseNow(false);
  if (!saved) {
    toast("No se reinició en Firebase", "Revisa conexión o reglas antes de continuar.", "warn");
    return;
  }
  toast("Reiniciado", "Firebase quedó limpio para este usuario.", "ok");
  scheduleRender();
}

/* ---------------------------
   GOALS & OBJECTIVES
--------------------------- */
function getLatestBodyWeight() {
  for (const s of State.sessions) {
    const m = String(s.notes || "").match(/peso:\s*(\d+(?:\.\d+)?)/i);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

function renderGoals() {
  const count = $("#goalsCount");
  const empty = $("#goalsEmpty");
  const list = $("#goalsList");
  const suggestedList = $("#suggestedRoutinesList");
  const form = $("#formAddGoal");
  const typeSelect = $("#goalType");
  const fieldExercise = $("#fieldGoalExercise");
  
  if (!count || !empty || !list || !suggestedList) return;

  // Render static suggested routines
  suggestedList.innerHTML = "";
  RECOMMENDED_ROUTINES.forEach(rec => {
    const card = el("div", { class: "goal-item" }, [
      el("div", { class: "goal-item__header" }, [
        el("div", { class: "goal-title", text: rec.name }),
        el("span", { class: "goal-badge", text: rec.tag })
      ]),
      el("p", { class: "muted", style: "font-size: 13px; margin: 4px 0;", text: rec.description }),
      el("div", { class: "muted", style: "font-size: 12px; margin-bottom: 8px;", text: `Cardio: ${rec.cardioSuggest} | Duración: ${rec.targetMin} min` }),
      el("div", { class: "row", style: "margin-top: 8px;" }, [
        el("button", { 
          class: "btn btn--sm", 
          type: "button", 
          onclick: () => {
            const exercisesStr = rec.exercises.map(e => `${e.sets}x${e.reps} ${e.name}`).join("\n");
            confirmDialog({
              title: rec.name,
              text: `Esta rutina contiene:\n${exercisesStr}\n\n¿Quieres agregarla a tus plantillas?`,
              yesText: "Agregar",
              noText: "Cerrar"
            }).then(ok => {
              if (ok) {
                // Add to user routines
                const r = createRoutine({
                  name: rec.name,
                  tag: rec.tag,
                  targetMin: rec.targetMin,
                  cardioSuggest: rec.cardioSuggest,
                  exercises: rec.exercises
                });
                toast("Agregada", `"${r.name}" ya está en tus plantillas.`, "ok");
              }
            });
          }
        }, ["Ver Ejercicios"]),
        el("button", {
          class: "btn btn--primary btn--sm",
          type: "button",
          onclick: () => {
            // Copy to user routines first, then prefill session
            const r = createRoutine({
              name: rec.name,
              tag: rec.tag,
              targetMin: rec.targetMin,
              cardioSuggest: rec.cardioSuggest,
              exercises: rec.exercises
            });
            location.hash = "#new-session";
            prefillNewSessionFromRoutine(r.id);
            toast("Iniciando rutina", r.name, "ok");
          }
        }, ["Iniciar entrenamiento"])
      ])
    ]);
    suggestedList.appendChild(card);
  });

  // Render Objectives
  const objList = State.objectives || [];
  count.textContent = `${objList.length} objetivo${objList.length === 1 ? "" : "s"}`;
  
  if (!objList.length) {
    empty.classList.remove("is-hidden");
    list.classList.add("is-hidden");
  } else {
    empty.classList.add("is-hidden");
    list.classList.remove("is-hidden");
    list.innerHTML = "";

    const prs = computePRs();
    const sessions7 = getSessionsInLastDays(7);
    const cardio7 = sessions7.reduce((acc, s) => acc + (s.cardio?.minutes ? Number(s.cardio.minutes) : 0), 0);
    const bodyWeight = getLatestBodyWeight();

    objList.forEach(g => {
      let currentVal = 0;
      let targetVal = parseFloat(g.target) || 0;
      let progressPct = 0;
      let statusText = "";
      let typeLabel = "";

      if (g.type === "sessions_weekly") {
        currentVal = sessions7.length;
        progressPct = targetVal > 0 ? (currentVal / targetVal) * 100 : 0;
        statusText = `${currentVal} de ${targetVal} sesiones esta semana`;
        typeLabel = "Constancia";
      } else if (g.type === "cardio_weekly") {
        currentVal = cardio7;
        progressPct = targetVal > 0 ? (currentVal / targetVal) * 100 : 0;
        statusText = `${Math.round(currentVal)} de ${targetVal} min esta semana`;
        typeLabel = "Cardio";
      } else if (g.type === "pr_weight") {
        currentVal = prs.get(g.exerciseName) || 0;
        progressPct = targetVal > 0 ? (currentVal / targetVal) * 100 : 0;
        statusText = `${currentVal} de ${targetVal} ${State.prefs.unit} en ${g.exerciseName}`;
        typeLabel = "Fuerza";
      } else if (g.type === "body_weight") {
        currentVal = bodyWeight || 0;
        // Proximidad al peso objetivo (hacia arriba o abajo)
        if (currentVal > 0) {
          if (currentVal <= targetVal) {
            progressPct = (currentVal / targetVal) * 100;
          } else {
            progressPct = (targetVal / currentVal) * 100;
          }
        } else {
          progressPct = 0;
        }
        statusText = currentVal > 0 
          ? `Actual: ${currentVal} ${State.prefs.unit} (Meta: ${targetVal} ${State.prefs.unit})`
          : `Escribe 'peso: ${targetVal}' en las notas de tu sesión para registrarlo.`;
        typeLabel = "Peso Corporal";
      } else {
        // custom
        currentVal = g.completed ? 1 : 0;
        progressPct = g.completed ? 100 : 0;
        statusText = g.target;
        typeLabel = "Personalizado";
      }

      progressPct = Math.min(100, Math.max(0, progressPct));

      const goalCard = el("div", { class: "goal-item" }, [
        el("div", { class: "goal-item__header" }, [
          el("div", { class: "goal-title", text: g.type === "pr_weight" ? `Superar PR en ${g.exerciseName}` : g.type === "sessions_weekly" ? "Entrenamientos semanales" : g.type === "cardio_weekly" ? "Minutos de cardio semanales" : g.type === "body_weight" ? "Peso corporal ideal" : "Meta personalizada" }),
          el("div", { class: "row" }, [
            el("span", { class: "goal-badge", text: typeLabel }),
            el("button", { 
              class: "goal-delete-btn", 
              type: "button",
              onclick: async () => {
                const ok = await confirmDialog({
                  title: "Eliminar objetivo",
                  text: "¿Seguro que deseas eliminar este objetivo?",
                  yesText: "Eliminar",
                  noText: "Cancelar"
                });
                if (ok) {
                  State.objectives = State.objectives.filter(x => x.id !== g.id);
                  saveObjectives();
                  toast("Objetivo eliminado", "", "warn");
                  scheduleRender();
                }
              } 
            }, ["✕"])
          ])
        ]),
        el("div", { class: "goal-val-info" }, [
          el("span", { text: statusText }),
          el("span", { text: `${Math.round(progressPct)}%` })
        ]),
        el("div", { class: "goal-progress" }, [
          el("div", { class: "goal-progress__fill", style: `width: ${progressPct}%` })
        ])
      ]);

      // If custom, allow toggle complete
      if (g.type === "custom") {
        const toggleBtn = el("button", {
          class: `btn btn--sm ${g.completed ? "btn--ghost" : "btn--primary"}`,
          style: "margin-top: 8px; align-self: flex-start;",
          type: "button",
          onclick: () => {
            g.completed = !g.completed;
            saveObjectives();
            toast(g.completed ? "¡Objetivo completado! 🎉" : "Objetivo reactivado", "", "ok");
            scheduleRender();
          }
        }, [g.completed ? "Marcar como pendiente" : "Completar meta"]);
        goalCard.appendChild(toggleBtn);
      }

      list.appendChild(goalCard);
    });
  }

  // Setup form logic
  if (form && !form.dataset.bound) {
    form.dataset.bound = "1";
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const type = $("#goalType")?.value;
      const target = $("#goalTarget")?.value || "";
      const exerciseName = $("#goalExerciseName")?.value || "";

      if (!target) return;

      const newGoal = {
        id: uid("goal"),
        type,
        target,
        exerciseName: type === "pr_weight" ? exerciseName : "",
        completed: false,
        createdAt: Date.now()
      };

      State.objectives.push(newGoal);
      saveObjectives();
      
      // Reset form
      if ($("#goalTarget")) $("#goalTarget").value = "";
      if ($("#goalExerciseName")) $("#goalExerciseName").value = "";
      
      toast("Objetivo añadido", "¡A entrenar duro!", "ok");
      scheduleRender();
    });
  }

  if (typeSelect && !typeSelect.dataset.bound) {
    typeSelect.dataset.bound = "1";
    typeSelect.addEventListener("change", (e) => {
      const type = e.target.value;
      if (type === "pr_weight") {
        fieldExercise.style.display = "";
        $("#goalTarget").placeholder = "Ej. 150";
        $("#goalTarget").type = "number";
      } else if (type === "sessions_weekly") {
        fieldExercise.style.display = "none";
        $("#goalTarget").placeholder = "Ej. 3";
        $("#goalTarget").type = "number";
      } else if (type === "cardio_weekly") {
        fieldExercise.style.display = "none";
        $("#goalTarget").placeholder = "Ej. 60";
        $("#goalTarget").type = "number";
      } else if (type === "body_weight") {
        fieldExercise.style.display = "none";
        $("#goalTarget").placeholder = "Ej. 160";
        $("#goalTarget").type = "number";
      } else {
        fieldExercise.style.display = "none";
        $("#goalTarget").placeholder = "Ej. Hacer el pino 10s";
        $("#goalTarget").type = "text";
      }
    });
  }
}

function renderCardioSummary() {
  const box = $("#cardioSummary");
  if (!box) return;
  const c = State.cardioDraft;
  box.textContent = c
    ? `Cardio: ${c.machine} | ${c.minutes} min | ${c.intensity || "-"}`
    : "Cardio: ninguno";
}

function renderHistory() {
  const list = $("#historyList");
  const empty = $("#historyEmpty");
  const search = $("#historySearch");
  const range = $("#historyRange");
  if (!list || !empty) return;

  const q = (search?.value || "").toLowerCase().trim();
  const rangeStart = startDateFromRange(range?.value || "30");

  const filtered = State.sessions
    .slice()
    .filter(s => {
      if (q) {
        const hay = `${s.routineName || ""} ${(s.exercises || []).map(e => e.name).join(" ")} ${s.notes || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (rangeStart) {
        const dt = parseISODate(s.date);
        if (dt && dt < rangeStart) return false;
      }
      return true;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  $("#historyCount") && ($("#historyCount").textContent = String(filtered.length));

  if (!filtered.length) {
    empty.classList.remove("is-hidden");
    list.classList.add("is-hidden");
  } else {
    empty.classList.add("is-hidden");
    list.classList.remove("is-hidden");
    list.innerHTML = "";

    filtered.slice(0, 200).forEach(s => {
      const vol = Math.round(calcVolumeForSession(s));
      const cardioTxt = s.cardio?.machine ? `${s.cardio.machine} ${s.cardio.minutes || 0}m` : "—";
      list.appendChild(el("article", { class:"item item--history" }, [
        el("div", { class:"item__left" }, [
          el("div", { class:"item__title", text: s.routineName || "Sesión" }),
          el("div", { class:"muted item__meta", text: `${formatDate(s.date, State.prefs)} • ${s.durationMin || 0} min • Vol ${vol}` })
        ]),
        el("div", { class:"item__right" }, [
          el("span", { class:"pill", text: cardioTxt }),
          el("button", { class:"icon-btn", type:"button", "aria-label":"Ver detalle", onclick: () => openSessionDrawer(s.id) }, [
            el("span", { class:"icon", text:"›", "aria-hidden":"true" })
          ])
        ])
      ]));
    });
  }

  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.addEventListener("input", rerenderHistoryDebounced);
  }
  if (range && !range.dataset.bound) {
    range.dataset.bound = "1";
    range.addEventListener("change", rerenderHistoryDebounced);
  }
}

function openSessionDrawer(id) {
  const s = State.sessions.find(x => x.id === id);
  if (!s) return;

  $("#drawerSessionTitle") && ($("#drawerSessionTitle").textContent = s.routineName || "Sesión");
  $("#drawerSessionMeta") && ($("#drawerSessionMeta").textContent = `${formatDate(s.date, State.prefs)} • ${s.durationMin || 0} min • ${s.unit}`);

  const pills = $("#drawerSummaryPills");
  const cardio = $("#drawerCardio");
  const exercises = $("#drawerExercises");
  const notes = $("#drawerNotes");
  if (!pills || !cardio || !exercises || !notes) return;

  pills.innerHTML = "";
  exercises.innerHTML = "";
  notes.textContent = s.notes || "Sin notas.";

  pills.appendChild(el("span", { class:"pill", text: `${(s.exercises || []).length} ejercicios` }));
  pills.appendChild(el("span", { class:"pill", text: `${s.durationMin || 0} min` }));
  if (s.rpe != null && s.rpe !== "") pills.appendChild(el("span", { class:"pill", text: `RPE ${s.rpe}` }));

  cardio.textContent = s.cardio?.machine
    ? `${s.cardio.machine} • ${s.cardio.minutes || 0} min • ${s.cardio.intensity || "—"}`
    : "Sin cardio.";

  if (s.exercises?.length) {
    s.exercises.forEach(ex => {
      const node = el("div", { class:"drawer-exercise" }, [
        el("div", { class:"drawer-exercise__name", text: ex.name || "Ejercicio" }),
        el("div", { class:"drawer-exercise__meta", text: `${ex.sets || 0} × ${ex.reps || "-"} @ ${ex.weight || 0} ${ex.unit || s.unit}` }),
        ex.notes ? el("div", { class:"muted", text: ex.notes }) : el("div", { class:"muted", text:"" })
      ]);
      const media = buildExerciseMedia(ex, { compact:true });
      if (media) node.appendChild(media);
      exercises.appendChild(node);
    });
  } else {
    exercises.appendChild(el("div", { class:"muted", text:"Sin ejercicios." }));
  }

  $("#btnEditSession") && ($("#btnEditSession").onclick = () => {
    State.cardioDraft = s.cardio || null;
    setDraftSession({
      routineId: s.routineId,
      routineName: s.routineName,
      date: todayISO(),
      durationMin: s.durationMin,
      unit: s.unit,
      rpe: s.rpe,
      notes: s.notes,
      cardio: s.cardio || null,
      exercises: (s.exercises || []).map(ex => ({ ...ex }))
    });
    closeDrawer("#drawerSession");
    location.hash = "#new-session";
    toast("Sesión cargada", "Se pasó al borrador para editarla.", "ok");
  });

  $("#btnDeleteSession") && ($("#btnDeleteSession").onclick = async () => {
    const ok = await confirmDialog({
      title: "Eliminar sesión",
      text: `Eliminar "${s.routineName || "Sesión"}" del ${formatDate(s.date, State.prefs)}?`,
      yesText: "Eliminar",
      noText: "Cancelar"
    });
    if (!ok) return;
    deleteSession(s.id);
    closeDrawer("#drawerSession");
    toast("Sesión eliminada", "Registro removido.", "warn");
    scheduleRender();
  });

  openDrawer("#drawerSession");
}

function renderProgress() {
  const tbody = $("#progressTbody");
  const empty = $("#progressEmpty");
  const wrap = $("#progressTableWrap");
  const search = $("#progressSearch");
  const metric = $("#progressMetric");
  const range = $("#progressRange");
  if (!tbody || !empty || !wrap) return;

  const q = (search?.value || "").toLowerCase().trim();
  const rangeStart = startDateFromRange(range?.value || "30");
  const metricValue = metric?.value || "pr";
  const byExercise = new Map();

  for (const s of State.sessions) {
    const dt = parseISODate(s.date);
    if (rangeStart && dt && dt < rangeStart) continue;
    for (const ex of (s.exercises || [])) {
      const name = String(ex.name || "").trim();
      if (!name) continue;
      if (q && !name.toLowerCase().includes(q)) continue;
      if (!byExercise.has(name)) byExercise.set(name, []);
      byExercise.get(name).push({
        date: s.date,
        weight: Number(ex.weight || 0),
        sets: Number(ex.sets || 0),
        reps: String(ex.reps || "")
      });
    }
  }

  const rows = Array.from(byExercise.entries()).map(([name, hist]) => {
    hist.sort((a, b) => (a.date < b.date ? 1 : -1));
    const weights = hist.map(x => x.weight);
    const best = weights.length ? Math.max(...weights) : 0;
    const last = hist.length ? hist[0].weight : 0;
    const frequency = hist.length;
    const volume = hist.reduce((sum, item) => sum + (item.sets * Number(String(item.reps).split("/")[0] || 0) * item.weight), 0);
    return {
      name,
      hist,
      best,
      last,
      frequency,
      volume,
      trend: trendLabel([...weights].reverse()),
      sortValue: metricValue === "last" ? last : metricValue === "volume" ? volume : metricValue === "freq" ? frequency : best
    };
  }).sort((a, b) => b.sortValue - a.sortValue || a.name.localeCompare(b.name));

  if (!rows.length) {
    empty.classList.remove("is-hidden");
    wrap.classList.add("is-hidden");
  } else {
    empty.classList.add("is-hidden");
    wrap.classList.remove("is-hidden");
  }

  if (!State.selectedExerciseName || !rows.some(row => row.name === State.selectedExerciseName)) {
    State.selectedExerciseName = rows[0]?.name || null;
  }

  tbody.innerHTML = "";
  rows.forEach(row => {
    const tr = el("tr", {
      onclick: () => {
        State.selectedExerciseName = row.name;
        renderProgress();
      }
    }, [
      el("td", { text: row.name }),
      el("td", { text: `${row.best} ${State.prefs.unit}` }),
      el("td", { text: `${row.last} ${State.prefs.unit}` }),
      el("td", { text: row.trend }),
      el("td", { text: String(row.frequency) })
    ]);
    if (row.name === State.selectedExerciseName) tr.classList.add("is-selected");
    tbody.appendChild(tr);
  });

  const selected = rows.find(row => row.name === State.selectedExerciseName);
  const detail = $("#exerciseDetail");
  const detailEmpty = $("#exerciseDetailEmpty");
  const exerciseName = $("#exerciseName");
  const exerciseMeta = $("#exerciseMeta");
  const exerciseChart = $("#exerciseChart");
  const historyList = $("#exerciseHistoryList");

  if (selected && detail && detailEmpty && exerciseName && exerciseMeta && exerciseChart && historyList) {
    detail.classList.remove("is-hidden");
    detailEmpty.classList.add("is-hidden");
    exerciseName.textContent = selected.name;
    exerciseMeta.textContent = `${selected.frequency} registros • PR ${selected.best} ${State.prefs.unit}`;
    exerciseChart.innerHTML = "";
    exerciseChart.appendChild(el("div", { class:"muted", text: `Último: ${selected.last} ${State.prefs.unit} • Tendencia: ${selected.trend}` }));
    historyList.innerHTML = "";
    selected.hist.forEach(item => {
      historyList.appendChild(el("div", { class:"item" }, [
        el("div", { class:"item__left" }, [
          el("div", { class:"item__title", text: formatDate(item.date, State.prefs) }),
          el("div", { class:"muted item__meta", text: `${item.sets} × ${item.reps} @ ${item.weight} ${State.prefs.unit}` })
        ]),
        el("div", { class:"item__right" }, [
          el("span", { class:"pill", text: `${item.weight} ${State.prefs.unit}` })
        ])
      ]));
    });
  }

  $("#btnSetAsFocus") && ($("#btnSetAsFocus").onclick = () => {
    if (!selected) return;
    Store.set(LS_KEYS.focusExercise, { name: selected.name });
    toast("Foco fijado", selected.name, "ok");
    scheduleRender();
  });

  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.addEventListener("input", debounce(() => scheduleRender(), 150));
  }
  if (metric && !metric.dataset.bound) {
    metric.dataset.bound = "1";
    metric.addEventListener("change", () => scheduleRender());
  }
  if (range && !range.dataset.bound) {
    range.dataset.bound = "1";
    range.addEventListener("change", () => scheduleRender());
  }
}

function renderSettings() {
  applyTheme();
  $("#btnResetAll") && ($("#btnResetAll").onclick = () => resetAllData());
}


/* ---------------------------

   AUTH HANDLERS
--------------------------- */

function bindAuthUI() {
  // Botón "Entrar con Google" en pantalla de login
  const btnGoogle = document.getElementById("btnGoogleSignIn");
  if (btnGoogle && !btnGoogle.dataset.bound) {
    btnGoogle.dataset.bound = "1";
    btnGoogle.addEventListener("click", async () => {
      const sync = window.FirebaseSync;
      if (!sync || !sync.ready) {
        showLoginError("Firebase no disponible. Revisa tu conexión a internet.");
        return;
      }
      btnGoogle.disabled = true;
      btnGoogle.textContent = "Conectando…";
      hideLoginError();
      try {
        await sync.signInWithGoogle();
        // onAuthStateChanged en firebase-sync.js manejará el resultado
      } catch (err) {
        console.error("[Auth] Error login Google:", err);
        btnGoogle.disabled = false;
        btnGoogle.innerHTML = `<svg class="btn-google__icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Entrar con Google`;
        showLoginError(err.code === "auth/popup-closed-by-user" ? "Cerraste el popup. Inténtalo de nuevo." : "No se pudo iniciar sesión. Intenta de nuevo.");
      }
    });
  }

  // Botón "Cerrar sesión" en topbar
  const btnSignOut = document.getElementById("btnSignOut");
  if (btnSignOut && !btnSignOut.dataset.bound) {
    btnSignOut.dataset.bound = "1";
    btnSignOut.addEventListener("click", async () => {
      const sync = window.FirebaseSync;
      if (sync && sync.ready) {
        try { await sync.signOut(); } catch (e) { console.warn("[Auth] signOut error", e); }
      }
      // onAuthStateChanged en firebase-sync.js disparará gymos:auth-changed con user=null
    });
  }
}

function showLoginError(msg) {
  const el = document.getElementById("loginError");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function hideLoginError() {
  const el = document.getElementById("loginError");
  if (el) el.hidden = true;
}

function resetGoogleBtn() {
  const btn = document.getElementById("btnGoogleSignIn");
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = `<svg class="btn-google__icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Entrar con Google`;
}

function bindAuthEvents() {
  // Evento: usuario autenticado (correo en whitelist)
  window.addEventListener("gymos:auth-changed", (e) => {
    const user = e.detail && e.detail.user;

    if (user) {
      // Usuario válido → inicializar app con sus datos
      Auth.applyUser(user);
      Auth.updateAvatar(user);
      loadAll();
      applyTheme();
      firebaseBootstrapped = false; // Forzar re-sync con datos del nuevo usuario
      initFirebaseSync();
      // Arrancar el router (solo la primera vez; el guard dataset.bound lo protege)
      initRouter();
      scheduleRender();
      Auth.showApp();
      hideLoginError();
      resetGoogleBtn();
      toast("Bienvenido 👋", user.displayName || user.email || "", "ok");
    } else {
      // Sin usuario → mostrar login
      Auth.applyUser(null);
      Auth.updateAvatar(null);
      firebaseBootstrapped = false;
      Auth.showLogin();
    }
  });

  // Evento: correo no autorizado
  window.addEventListener("gymos:auth-unauthorized", (e) => {
    const email = e.detail && e.detail.email;
    showLoginError(`El correo ${email || ""} no está autorizado para usar esta app.`);
    resetGoogleBtn();
    Auth.showLogin();
  });
}

/* --------------------------- GLOBAL NAV / INIT --------------------------- */
function bindNavOnce() {
  const nav = $("#nav");
  if (!nav || nav.dataset.bound) return;
  nav.dataset.bound = "1";

  nav.addEventListener("click", (e) => {
    const a = e.target instanceof HTMLElement ? e.target.closest(".nav__item") : null;
    if (!a) return;
    const route = a.getAttribute("data-route");
    if (!route) return;
    location.hash = `#${route}`;
  });
}

function init() {
  // La app empieza mostrando solo la pantalla de login
  Auth.showLogin();

  // Inicializar UI base (modals, prefs, shell) — sin datos de usuario aún
  bindModalCloseHandlers();
  bindPrefsUIOnce();
  bindShellActionsOnce();
  bindNavOnce();
  bindAuthUI();
  bindAuthEvents();

  // Esperar a Firebase SDK + Auth para manejar el estado
  // El evento gymos:auth-changed mostrará la app cuando haya un usuario válido
  const waitForSync = () => {
    const sync = window.FirebaseSync;
    if (sync && sync.ready) {
      // Firebase listo: onAuthStateChanged ya está corriendo en firebase-sync.js
      // Si el usuario ya tenía sesión, el evento llegará automáticamente
      return;
    }
    // Firebase no cargó aún — intentar más tarde
    setTimeout(waitForSync, 200);
  };
  waitForSync();
}

document.addEventListener("DOMContentLoaded", init);
