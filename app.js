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
const APP_VERSION = "0.13.3";

// Cache interna por usuario: no es un modo local de trabajo, solo evita perder
// estado temporal mientras Firestore termina de responder.
function lsKeys(uid) {
  const prefix = uid ? `gymos.u.${uid}` : "gymos";
  return {
    routines: `${prefix}.routines.v1`,
    programs: `${prefix}.programs.v1`,
    activeProgram: `${prefix}.activeProgram.v1`,
    sessions: `${prefix}.sessions.v1`,
    prefs:    `${prefix}.prefs.v1`,
    draft:    `${prefix}.draft.session.v1`,
    focusExercise: `${prefix}.focus.exercise.v1`,
    objectives: `${prefix}.objectives.v1`,
    seededDefaults: `${prefix}.seededDefaults.v1`
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
  dateFmt: "es-CO",   // es-CO | iso
  music: "ask",       // ask | always | never (al entrar al modo entrenamiento)
  musicVolume: 60,    // 0-100
  musicShuffle: true,
  alertVolume: 85,    // 0-100 · volumen de pitidos del temporizador
  vibrate: "on",      // on | off · vibración junto con los pitidos
  countdown: 5        // segundos de "prepárate" antes de cada ejercicio (0 = sin cuenta)
};

/* Pistas incluidas en la app (carpeta ./music). */
const MUSIC_TRACKS = [
  { title: "GymOS Boot",     src: "./music/GymOS Boot.mp3" },
  { title: "Pulse On",       src: "./music/Pulse On.mp3" },
  { title: "Iron Set Pulse", src: "./music/Iron Set Pulse.mp3" },
  { title: "Pulse Circuit",  src: "./music/Pulse Circuit.mp3" },
  { title: "Steel Circuit",  src: "./music/Steel Circuit.mp3" }
];

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
  out.duration = Math.max(0, Number(out.duration || 0));
  out.rest = Math.max(0, Number(out.rest || 0));
  out.restAfter = Math.max(0, Number(out.restAfter || 0));
  return out;
}

/* Elementos (equipo) de una rutina: acepta array o texto separado por comas. */
function parseEquipmentList(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,\n;]/);
  const seen = new Set();
  return raw
    .map(v => String(v || "").trim())
    .filter(v => {
      if (!v) return false;
      const key = v.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function routineEquipment(routine) {
  return parseEquipmentList(routine?.equipment);
}

function sessionCardios(session) {
  if (Array.isArray(session?.cardios)) return session.cardios.filter(Boolean);
  return session?.cardio ? [session.cardio] : [];
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
    programs: State.programs,
    activeProgramId: State.activeProgramId,
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
  const status = type === "warn" ? "Revisar" : title;

  if (pill) {
    pill.textContent = status;
    pill.classList.toggle("pill--ok", type === "ok");
    pill.classList.toggle("pill--warn", type === "warn");
  }
  if (label) label.textContent = text || "";
  if (storage) storage.textContent = status;
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
    if (Array.isArray(payload.programs)) State.programs = payload.programs;
    if (typeof payload.activeProgramId !== "undefined") State.activeProgramId = payload.activeProgramId;
    if (Array.isArray(payload.sessions)) State.sessions = payload.sessions;
    if (Array.isArray(payload.objectives)) State.objectives = payload.objectives;
    else State.objectives = [];
    normalizeLoadedMedia();
    ensurePrograms();

    Store.set(LS_KEYS.prefs, State.prefs);
    Store.set(LS_KEYS.routines, State.routines);
    Store.set(LS_KEYS.programs, State.programs);
    Store.set(LS_KEYS.activeProgram, State.activeProgramId);
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
    updateFirebaseStatus("En línea", "Revisa tu conexión a internet para guardar tus cambios.", "warn");
    if (showToast) toast("Sin conexión", "No se guardaron cambios en la nube.", "warn");
    return false;
  }

  try {
    updateFirebaseStatus("Guardando", "Guardando tus rutinas y sesiones…");
    await sync.ready;
    await sync.saveState(appStatePayload());
    updateFirebaseStatus("En línea", "Tus cambios están guardados en tu cuenta.", "ok");
    if (showToast) toast("Cambios guardados", "Ya puedes verlos en los dispositivos donde uses esta cuenta.", "ok");
    return true;
  } catch (err) {
    console.error("[Firebase] push error", err);
    updateFirebaseStatus("En línea", "No pudimos guardar tus cambios. Revisa tu conexión e intenta de nuevo.", "warn");
    if (showToast) toast("Cambios sin guardar", "Revisa tu conexión a internet e intenta de nuevo.", "warn");
    return false;
  }
}

async function pullFirebaseNow(showToast=true) {
  const sync = window.FirebaseSync;
  if (!sync || !sync.ready) {
    updateFirebaseStatus("En línea", "Revisa tu conexión a internet.", "warn");
    if (showToast) toast("Sin conexión", "No pudimos abrir tus datos guardados.", "warn");
    return false;
  }

  try {
    updateFirebaseStatus("Leyendo", "Abriendo tus rutinas y sesiones guardadas…");
    await sync.ready;
    const cloud = await sync.loadState();
    if (!payloadHasWorkoutData(cloud)) {
      updateFirebaseStatus("En línea", "No hay datos en la nube todavía.", "warn");
      if (showToast) toast("Nube vacía", "Aún no tienes rutinas o sesiones guardadas en tu cuenta.", "warn");
      return false;
    }
    applyRemoteState(cloud);
    updateFirebaseStatus("En línea", "Abrimos los datos guardados en tu cuenta.", "ok");
    if (showToast) toast("Datos cargados", "Ya puedes ver tus rutinas y sesiones guardadas.", "ok");
    scheduleRender();
    return true;
  } catch (err) {
    console.error("[Firebase] pull error", err);
    updateFirebaseStatus("En línea", "No pudimos abrir los datos de tu cuenta.", "warn");
    if (showToast) toast("No se pudieron abrir tus datos", "Revisa tu conexión a internet e intenta de nuevo.", "warn");
    return false;
  }
}

function queueFirebaseSave() {
  if (firebaseIsApplyingRemote) return;
  if (!firebaseBootstrapped) {
    updateFirebaseStatus("En línea", "Esperando conexión a internet para guardar tus cambios.", "warn");
    return;
  }
  const sync = window.FirebaseSync;
  if (!sync || !sync.ready) {
    updateFirebaseStatus("En línea", "Sin conexión. No se guardaron cambios en la nube.", "warn");
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
    if (status === "ready") updateFirebaseStatus("En línea", "Conectado. Revisando nube…", "ok");
    if (status === "synced") updateFirebaseStatus("En línea", "Tus cambios están guardados en tu cuenta.", "ok");
    if (status === "error") updateFirebaseStatus("En línea", "Conéctate a internet para usar GymOS.", "warn");
  });
}

async function initFirebaseSync() {
  bindFirebaseStatusListener();
  const sync = window.FirebaseSync;
  if (!sync || !sync.ready) {
    updateFirebaseStatus("En línea", "Conéctate a internet para guardar tus cambios.", "warn");
    // Sin nube: al menos mostrar las rutinas predeterminadas localmente.
    if (maybeSeedDefaultRoutines()) scheduleRender();
    return;
  }

  try {
    updateFirebaseStatus("En línea", "Abriendo tu cuenta…");
    await sync.ready;
    const cloud = await sync.loadState();
    const localPayload = appStatePayload();

    if (payloadHasWorkoutData(cloud)) {
      applyRemoteState(cloud);
      updateFirebaseStatus("En línea", "Datos cargados desde la nube.", "ok");
      scheduleRender();
    } else if (payloadHasWorkoutData(localPayload)) {
      await sync.saveState(localPayload);
      updateFirebaseStatus("En línea", "Guardamos los datos iniciales en tu cuenta.", "ok");
    } else {
      updateFirebaseStatus("En línea", "Ya puedes crear rutinas o recuperar una copia anterior.", "ok");
    }

    firebaseBootstrapped = true;

    // Primera vez sin datos en ningún lado → cargar rutinas predeterminadas.
    // (No hace nada si ya hay rutinas o si ya se sembró antes.)
    if (maybeSeedDefaultRoutines()) scheduleRender();

    // Buscar rutinas/programas que otros usuarios me hayan compartido
    refreshIncomingShares().then(() => {
      const n = (State.incomingShares || []).length;
      if (n > 0) {
        toast("📥 Compartidos contigo", `Tienes ${n} rutina(s)/programa(s) por aceptar en la sección Rutinas.`, "ok");
      }
    });
  } catch (err) {
    console.error("[Firebase] init error", err);
    firebaseBootstrapped = false;
    updateFirebaseStatus("En línea", "No pudimos abrir tu cuenta. Revisa tu conexión e intenta de nuevo.", "warn");
  }
}

async function uploadExerciseImageForRow(row, file, imageInput, nameInput) {
  const sync = window.FirebaseSync;
  if (!sync || !sync.ready) {
    toast("Sin conexión", "Puedes pegar el enlace de una imagen.", "warn");
    return;
  }

  try {
    imageInput.value = "Subiendo imagen…";
    const url = await sync.uploadExerciseImage(file, nameInput?.value || "ejercicio");
    imageInput.value = url;
    imageInput.dispatchEvent(new Event("input", { bubbles:true }));
    toast("Imagen subida", "Quedó vinculada al ejercicio.", "ok");
  } catch (err) {
    console.error("[Firebase] image upload error", err);
    imageInput.value = "";
    toast("No subió la imagen", "Intenta subirla de nuevo o pega el enlace de la imagen.", "warn");
  }
}


/* ---------------------------
   COMPARTIR RUTINAS / PROGRAMAS
   El remitente escribe el correo del destinatario; el documento viaja por
   la colección "shares" de Firestore y el destinatario lo acepta o rechaza
   desde la tarjeta "Compartidos contigo" en Rutinas.
--------------------------- */
let shareContext = null; // { kind: "routine"|"program", name, payload }

function sanitizeForShare(obj) {
  // Firestore rechaza `undefined`; un round-trip por JSON lo limpia.
  return JSON.parse(JSON.stringify(obj ?? null));
}

function openShareModal(context) {
  const sync = window.FirebaseSync;
  if (!sync || !sync.currentUser) {
    toast("Inicia sesión", "Necesitas estar conectado para compartir.", "warn");
    return;
  }
  shareContext = context;

  const summary = $("#shareSummary");
  if (summary) {
    summary.innerHTML = "";
    const meta = context.kind === "program"
      ? `Programa completo • ${(context.payload.routines || []).length} rutina(s)`
      : `Rutina • ${(context.payload.routine?.exercises || []).length} ejercicio(s)`;
    summary.appendChild(el("div", { class:"share-summary__icon", text: context.kind === "program" ? "🗂️" : "📋" }));
    summary.appendChild(el("div", { class:"share-summary__info" }, [
      el("div", { class:"share-summary__name", text: context.name }),
      el("div", { class:"muted", text: meta })
    ]));
  }

  // Sugerencias: correos con acceso, excluyendo el propio
  const dl = $("#shareEmailSuggestions");
  if (dl) {
    dl.innerHTML = "";
    const mine = (sync.currentUser.email || "").toLowerCase();
    (sync.allowedEmails || [])
      .filter(e => e.toLowerCase() !== mine)
      .forEach(e => dl.appendChild(el("option", { value: e })));
  }

  const input = $("#shareEmail");
  if (input) input.value = "";
  $("#btnSendShare") && ($("#btnSendShare").onclick = () => sendShareFromModal());
  openModal("#modalShare");
  input && input.focus({ preventScroll: true });
}

async function sendShareFromModal() {
  const sync = window.FirebaseSync;
  if (!shareContext || !sync) return;

  const email = ($("#shareEmail")?.value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast("Correo inválido", "Escribe un correo válido, ej. amigo@gmail.com.", "warn");
    return;
  }
  const mine = (sync.currentUser?.email || "").toLowerCase();
  if (email === mine) {
    toast("Ese eres tú 😄", "Escribe el correo de otra persona.", "warn");
    return;
  }
  if (Array.isArray(sync.allowedEmails) && !sync.allowedEmails.some(e => e.toLowerCase() === email)) {
    const ok = await confirmDialog({
      title: "Correo sin acceso a GymOS",
      text: `${email} todavía no está en la lista de usuarios autorizados. Se enviará igual y lo verá cuando tenga acceso. ¿Continuar?`,
      yesText: "Enviar igual",
      noText: "Cancelar"
    });
    if (!ok) return;
  }

  const btn = $("#btnSendShare");
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Enviando…"; }
    await sync.sendShare({
      toEmail: email,
      kind: shareContext.kind,
      name: shareContext.name,
      payload: sanitizeForShare(shareContext.payload)
    });
    closeModal("#modalShare");
    toast("¡Compartido! 📤", `"${shareContext.name}" fue enviado a ${email}.`, "ok");
    shareContext = null;
  } catch (err) {
    console.error("[Share] send error", err);
    toast("No se pudo compartir", "Revisa tu conexión a internet e intenta de nuevo.", "warn");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "📤 Enviar"; }
  }
}

function shareRoutine(r) {
  if (!r) return;
  openShareModal({ kind:"routine", name: r.name, payload: { routine: r } });
}

function shareProgram(p) {
  if (!p) return;
  const routines = State.routines.filter(r => r.programId === p.id);
  if (!routines.length) {
    toast("Programa vacío", "Agrega rutinas al programa antes de compartirlo.", "warn");
    return;
  }
  openShareModal({ kind:"program", name: p.name, payload: { program: { name: p.name }, routines } });
}

async function refreshIncomingShares(showFeedback = false) {
  const sync = window.FirebaseSync;
  if (!sync || !sync.currentUser || typeof sync.fetchIncomingShares !== "function") return;
  try {
    State.incomingShares = await sync.fetchIncomingShares();
    renderSharedInbox();
    if (showFeedback) {
      toast("Actualizado", State.incomingShares.length
        ? `Tienes ${State.incomingShares.length} elemento(s) compartidos pendientes.`
        : "No tienes nada compartido pendiente.", "ok");
    }
  } catch (err) {
    console.error("[Share] fetch error", err);
    if (showFeedback) toast("No se pudo consultar", "Revisa tu conexión a internet e intenta de nuevo.", "warn");
  }
}

function renderSharedInbox() {
  const card = $("#sharedInbox");
  const list = $("#sharedInboxList");
  if (!card || !list) return;

  const shares = State.incomingShares || [];
  card.classList.toggle("is-hidden", !shares.length);
  list.innerHTML = "";

  shares.forEach(s => {
    const meta = s.kind === "program"
      ? `Programa • ${(s.payload?.routines || []).length} rutina(s)`
      : `Rutina • ${(s.payload?.routine?.exercises || []).length} ejercicio(s)`;
    list.appendChild(el("article", { class:"share-item" }, [
      el("div", { class:"share-item__icon", text: s.kind === "program" ? "🗂️" : "📋" }),
      el("div", { class:"share-item__info" }, [
        el("div", { class:"share-item__name", text: s.name || "(sin nombre)" }),
        el("div", { class:"muted share-item__meta", text: `${meta} • de ${s.fromName || s.fromEmail || "alguien"}` })
      ]),
      el("div", { class:"share-item__actions" }, [
        el("button", { class:"btn btn--primary btn--sm", type:"button", onclick:() => acceptShare(s) }, ["✓ Aceptar"]),
        el("button", { class:"btn btn--ghost btn--sm", type:"button", onclick:() => rejectShare(s) }, ["Rechazar"])
      ])
    ]));
  });
}

async function acceptShare(share) {
  const sync = window.FirebaseSync;
  try {
    const now = Date.now();
    if (share.kind === "program") {
      const prog = {
        id: uid("program"),
        name: String(share.payload?.program?.name || share.name || "Programa compartido").trim(),
        createdAt: now,
        updatedAt: now
      };
      State.programs.push(prog);
      (share.payload?.routines || []).forEach(r => {
        State.routines.push({
          ...r,
          id: uid("routine"),
          programId: prog.id,
          exercises: Array.isArray(r.exercises) ? r.exercises.map(withExerciseMedia) : [],
          createdAt: now,
          updatedAt: now
        });
      });
      State.activeProgramId = prog.id;
      State.selectedRoutineId = null;
      saveRoutines();
      savePrograms();
      toast("Programa agregado 🗂️", `"${prog.name}" ya está en tus programas.`, "ok");
    } else {
      const r = share.payload?.routine;
      if (!r) throw new Error("El compartido no tiene rutina.");
      const created = createRoutine(r);
      State.selectedRoutineId = created.id;
      toast("Rutina agregada 📋", `"${created.name}" quedó en tu programa activo.`, "ok");
    }

    if (sync && typeof sync.deleteShare === "function") {
      await sync.deleteShare(share.id);
    }
    State.incomingShares = (State.incomingShares || []).filter(x => x.id !== share.id);
    renderSharedInbox();
    scheduleRender();
  } catch (err) {
    console.error("[Share] accept error", err);
    toast("No se pudo aceptar", "Inténtalo de nuevo en un momento.", "warn");
  }
}

async function rejectShare(share) {
  const ok = await confirmDialog({
    title: "Rechazar compartido",
    text: `¿Rechazar "${share.name}"? Quien lo envió no será notificado.`,
    yesText: "Rechazar",
    noText: "Cancelar"
  });
  if (!ok) return;
  try {
    const sync = window.FirebaseSync;
    if (sync && typeof sync.deleteShare === "function") {
      await sync.deleteShare(share.id);
    }
    State.incomingShares = (State.incomingShares || []).filter(x => x.id !== share.id);
    renderSharedInbox();
    toast("Rechazado", "", "warn");
  } catch (err) {
    console.error("[Share] reject error", err);
    toast("No se pudo rechazar", "Inténtalo de nuevo.", "warn");
  }
}

/* ---------------------------
   APP STATE
--------------------------- */
const State = {
  prefs: { ...DEFAULT_PREFS },
  routines: [],
  programs: [],
  activeProgramId: null,
  sessions: [],
  objectives: [],
  selectedRoutineId: null,
  selectedExerciseName: null,
  cardioDraft: null,
  cardioListDraft: [],
  cardioEditIndex: -1,
  sessionDraft: null,
  incomingShares: [],
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
  State.programs = Store.get(LS_KEYS.programs, []);
  State.activeProgramId = Store.get(LS_KEYS.activeProgram, null);
  State.sessions = Store.get(LS_KEYS.sessions, []);
  State.objectives = Store.get(LS_KEYS.objectives, []);
  normalizeLoadedMedia();
  ensurePrograms();
  State.selectedRoutineId = null;
  State.cardioDraft = null;
  State.sessionDraft = Store.get(LS_KEYS.draft, null);
}

function savePrefs() { Store.set(LS_KEYS.prefs, State.prefs); queueFirebaseSave(); }
function saveRoutines() { Store.set(LS_KEYS.routines, State.routines); queueFirebaseSave(); }
function savePrograms() {
  Store.set(LS_KEYS.programs, State.programs);
  Store.set(LS_KEYS.activeProgram, State.activeProgramId);
  queueFirebaseSave();
}
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
  const routeChanged = State.route !== route;
  State.route = route;
  if (routeChanged) $(".content")?.scrollTo({ top: 0, left: 0, behavior: "instant" });

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
    "dashboard": ["Inicio", "Tu actividad y el próximo entrenamiento."],
    "routines": ["Rutinas", "Elige una rutina para entrenar o ajustarla."],
    "new-session": ["Entrenar", "Elige tu rutina y empieza cuando estés listo."],
    "history": ["Historial", "Busca, revisa y compara sesiones."],
    "progress": ["Progreso", "Tus marcas, evolución y frecuencia por ejercicio."],
    "settings": ["Ajustes", "Preferencias, conexión y respaldo de tus datos."],
    "goals": ["Objetivos", "Tus metas y las rutinas que pueden ayudarte."]
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
  const prefMusic = $("#prefMusic"); if (prefMusic) prefMusic.value = State.prefs.music || "ask";
  const prefMusicVolume = $("#prefMusicVolume"); if (prefMusicVolume) prefMusicVolume.value = State.prefs.musicVolume ?? 60;
  const prefAlertVolume = $("#prefAlertVolume"); if (prefAlertVolume) prefAlertVolume.value = State.prefs.alertVolume ?? 85;
  const prefVibrate = $("#prefVibrate"); if (prefVibrate) prefVibrate.value = State.prefs.vibrate || "on";
  const prefCountdown = $("#prefCountdown"); if (prefCountdown) prefCountdown.value = String(State.prefs.countdown ?? 5);
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
    State.prefs.music = $("#prefMusic")?.value || State.prefs.music;
    const vol = $("#prefMusicVolume")?.value;
    if (vol != null && vol !== "") State.prefs.musicVolume = clamp(Number(vol), 0, 100);
    if (MusicPlayer.audio) MusicPlayer.audio.volume = (State.prefs.musicVolume ?? 60) / 100;
    const alertVol = $("#prefAlertVolume")?.value;
    if (alertVol != null && alertVol !== "") State.prefs.alertVolume = clamp(Number(alertVol), 0, 100);
    State.prefs.vibrate = $("#prefVibrate")?.value || State.prefs.vibrate;
    const cd = $("#prefCountdown")?.value;
    if (cd != null && cd !== "") State.prefs.countdown = clamp(Number(cd), 0, 30);
    savePrefs();
    applyTheme();
    toast("Preferencias guardadas", "Listo. El universo no colapsó.", "ok");
  });
}

function bindShellActionsOnce() {
  $("#btnQuickSession")?.addEventListener("click", () => quickStartWorkout());
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
    openModal("#modalHelp");
  });

  // Contraer / expandir el sidebar (PC). Recuerda la preferencia.
  const sidebar = document.querySelector(".sidebar");
  const sidebarToggle = $("#btnSidebarToggle");
  if (sidebar && sidebarToggle && !sidebarToggle.dataset.bound) {
    sidebarToggle.dataset.bound = "1";
    if (localStorage.getItem("gymos.sidebarCollapsed") === "1") {
      sidebar.classList.add("is-collapsed");
    }
    sidebarToggle.addEventListener("click", () => {
      const collapsed = sidebar.classList.toggle("is-collapsed");
      localStorage.setItem("gymos.sidebarCollapsed", collapsed ? "1" : "0");
      sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    });
  }

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
   PROGRAMAS (agrupan días/rutinas)
   Una "Rutina" del usuario = un Programa con varios días.
   Cada día (State.routines) pertenece a un solo programa vía programId.
--------------------------- */

// Garantiza que siempre exista al menos un programa, que toda rutina tenga
// programId, y que activeProgramId apunte a un programa válido.
// Migración suave: la primera vez agrupa todos los días existentes en
// "Entrenamiento Inicial" sin perder nada.
function ensurePrograms() {
  if (!Array.isArray(State.programs)) State.programs = [];
  if (!Array.isArray(State.routines)) State.routines = [];

  if (State.programs.length === 0) {
    const now = Date.now();
    const p = {
      id: uid("program"),
      name: "Entrenamiento Inicial",
      createdAt: now,
      updatedAt: now
    };
    State.programs.push(p);
    State.activeProgramId = p.id;
    // Todos los días actuales entran al programa por defecto.
    State.routines.forEach(r => { if (!r.programId) r.programId = p.id; });
  }

  // activeProgramId válido
  if (!State.programs.some(p => p.id === State.activeProgramId)) {
    State.activeProgramId = State.programs[0]?.id || null;
  }

  // Días huérfanos → al programa activo
  const fallbackId = State.activeProgramId || State.programs[0]?.id || null;
  State.routines.forEach(r => {
    if (!r.programId || !State.programs.some(p => p.id === r.programId)) {
      r.programId = fallbackId;
    }
  });
}

function activeProgram() {
  return State.programs.find(p => p.id === State.activeProgramId) || null;
}

// Días que pertenecen al programa activo.
function routinesInActiveProgram() {
  return State.routines.filter(r => r.programId === State.activeProgramId);
}

function setActiveProgram(id) {
  if (!State.programs.some(p => p.id === id)) return false;
  State.activeProgramId = id;
  State.selectedRoutineId = null;
  savePrograms();
  return true;
}

function createProgram(name, routines = []) {
  const now = Date.now();
  const p = {
    id: uid("program"),
    name: String(name || "Nuevo programa").trim() || "Nuevo programa",
    createdAt: now,
    updatedAt: now
  };
  State.programs.push(p);
  State.activeProgramId = p.id;
  State.selectedRoutineId = null;
  if (routines.length) {
    State.routines.unshift(...routines.map(routine => buildRoutineRecord(routine)));
    Store.set(LS_KEYS.routines, State.routines);
  }
  savePrograms();
  return p;
}

function renameProgram(id, name) {
  const p = State.programs.find(x => x.id === id);
  if (!p) return null;
  p.name = String(name || "").trim() || p.name;
  p.updatedAt = Date.now();
  savePrograms();
  return p;
}

// Duplica un programa con todos sus días (ejercicios incluidos), con ids nuevos.
function duplicateProgram(id) {
  const p = State.programs.find(x => x.id === id);
  if (!p) return null;
  const now = Date.now();
  const copy = { id: uid("program"), name: `${p.name} (copia)`, createdAt: now, updatedAt: now };
  // La copia hereda la configuración de progresión pero arranca en ciclo 1.
  if (p.progression) copy.progression = { ...programProgression(p), cycle: 1, cycleStart: now, history: [] };
  State.programs.push(copy);

  State.routines
    .filter(r => r.programId === id)
    .forEach(r => {
      State.routines.push({
        ...r,
        id: uid("routine"),
        programId: copy.id,
        exercises: (r.exercises || []).map(ex => ({ ...ex })),
        createdAt: now,
        updatedAt: now
      });
    });

  State.activeProgramId = copy.id;
  State.selectedRoutineId = null;
  saveRoutines();
  savePrograms();
  return copy;
}

// Elimina un programa y todos sus días. Las sesiones (historial) se conservan.
function deleteProgram(id) {
  const idx = State.programs.findIndex(p => p.id === id);
  if (idx < 0) return false;
  if (State.programs.length <= 1) return false; // siempre debe quedar uno

  State.routines = State.routines.filter(r => r.programId !== id);
  State.programs.splice(idx, 1);
  if (State.activeProgramId === id) {
    State.activeProgramId = State.programs[0]?.id || null;
  }
  State.selectedRoutineId = null;
  saveRoutines();
  savePrograms();
  return true;
}

/* ---------------------------
   CRUD: ROUTINES
--------------------------- */
function buildRoutineRecord(data) {
  const now = Date.now();
  return {
    ...data,
    id: uid("routine"),
    programId: State.activeProgramId,
    name: String(data.name || "Nueva rutina").trim(),
    tag: String(data.tag || "").trim(),
    targetMin: Number(data.targetMin || 0),
    cardioSuggest: String(data.cardioSuggest || "").trim(),
    equipment: parseEquipmentList(data.equipment),
    exercises: Array.isArray(data.exercises) ? data.exercises.map(x => ({
      ...x,
      name: String(x.name || "").trim(),
      sets: Number(x.sets || 0),
      reps: String(x.reps || "").trim(),
      weight: Number(x.weight || 0),
      unit: x.unit || State.prefs.unit,
      notes: String(x.notes || "").trim(),
      imageUrl: cleanMediaUrl(x.imageUrl || x.image || ""),
      videoUrl: cleanMediaUrl(x.videoUrl || x.video || ""),
      duration: Math.max(0, Number(x.duration || 0)),
      rest: Math.max(0, Number(x.rest || 0)),
      restAfter: Math.max(0, Number(x.restAfter || 0))
    })) : [],
    createdAt: now,
    updatedAt: now
  };
}

function createRoutine(data) {
  const r = buildRoutineRecord(data);
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
    ...session,
    id: uid("sess"),
    date: session.date || todayISO(),
    durationMin: Number(session.durationMin || 0),
    routineId: session.routineId || "",
    routineName: session.routineName || "",
    unit: session.unit || State.prefs.unit,
    rpe: session.rpe != null && session.rpe !== "" ? Number(session.rpe) : null,
    notes: String(session.notes || ""),
    cardio: session.cardio || null,
    cardios: sessionCardios(session).map(c => ({ ...c })),
    exercises: Array.isArray(session.exercises) ? session.exercises.map(ex => ({
      ...ex,
      name: String(ex.name || "").trim(),
      sets: Number(ex.sets || 0),
      reps: String(ex.reps || "").trim(),
      weight: Number(ex.weight || 0),
      unit: ex.unit || session.unit || State.prefs.unit,
      notes: String(ex.notes || "").trim(),
      imageUrl: cleanMediaUrl(ex.imageUrl || ex.image || ""),
      videoUrl: cleanMediaUrl(ex.videoUrl || ex.video || ""),
      duration: Math.max(0, Number(ex.duration || 0)),
      rest: Math.max(0, Number(ex.rest || 0)),
      restAfter: Math.max(0, Number(ex.restAfter || 0))
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

  $("#pillStorage") && ($("#pillStorage").textContent = "En línea");
  $("#pillOffline") && ($("#pillOffline").textContent = "Nube requerida");

  if (State.route === "dashboard") renderDashboard();
  if (State.route === "routines") renderRoutines();
  if (State.route === "new-session") renderNewSession();
  if (State.route === "history") renderHistory();
  if (State.route === "progress") { renderProgress(); renderFlexibilityHistory(); }
  if (State.route === "settings") renderSettings();
  if (State.route === "goals") renderGoals();
}

/* ---------------------------
   STREAKS (rachas por días entrenados)
--------------------------- */
function dateToISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function computeStreaks() {
  const daysSet = new Set(
    State.sessions.map(s => String(s.date || "")).filter(d => parseISODate(d))
  );

  // Mejor racha: recorre los días entrenados en orden cronológico
  const sorted = [...daysSet].sort();
  let best = 0, run = 0, prevDt = null;
  for (const iso of sorted) {
    const dt = parseISODate(iso);
    run = (prevDt && daysBetween(prevDt, dt) === 1) ? run + 1 : 1;
    best = Math.max(best, run);
    prevDt = dt;
  }

  // Racha actual: cuenta hacia atrás desde hoy (si hoy no has entrenado,
  // la racha sigue viva hasta que termine el día — se cuenta desde ayer).
  const trainedToday = daysSet.has(todayISO());
  let current = 0;
  let cursor = new Date();
  if (!trainedToday) cursor = addDays(cursor, -1);
  while (daysSet.has(dateToISO(cursor))) {
    current++;
    cursor = addDays(cursor, -1);
  }

  return { current, best: Math.max(best, current), trainedToday, daysSet };
}

function renderStreakBanner() {
  const currentEl = $("#streakCurrent");
  if (!currentEl) return;

  const { current, best, trainedToday, daysSet } = computeStreaks();

  currentEl.textContent = String(current);
  $("#streakBest") && ($("#streakBest").textContent = String(best));

  const msg = $("#streakMsg");
  if (msg) {
    if (current === 0) msg.textContent = "Entrena hoy para encender tu racha.";
    else if (trainedToday) msg.textContent = current >= 3 ? "¡Imparable! Sesión de hoy completada. 💪" : "¡Sesión de hoy completada!";
    else msg.textContent = "Entrena hoy para no perder tu racha.";
  }

  const flame = $("#streakFlame");
  if (flame) {
    flame.textContent = current === 0 ? "🌱" : "🔥";
    flame.classList.toggle("is-lit", current > 0 && trainedToday);
  }

  // Franja de los últimos 7 días (termina hoy)
  const week = $("#streakWeek");
  if (week) {
    week.innerHTML = "";
    const dayLetters = ["D","L","M","M","J","V","S"];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(new Date(), -i);
      const iso = dateToISO(d);
      const done = daysSet.has(iso);
      const isToday = i === 0;
      week.appendChild(el("div", {
        class: `streak-day${done ? " is-done" : ""}${isToday ? " is-today" : ""}`,
        title: formatDate(iso, State.prefs)
      }, [
        el("span", { class:"streak-day__letter", text: dayLetters[d.getDay()] }),
        el("span", { class:"streak-day__dot", text: done ? "✓" : "" })
      ]));
    }
  }
}

/* ---------------------------
   DASHBOARD
--------------------------- */
function renderDashboard() {
  const s7 = getSessionsInLastDays(7);
  const cardio7 = s7.reduce((sum, s) => sum + sessionCardios(s).reduce((n,c) => n + Number(c.minutes || 0), 0), 0);
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

  renderStreakBanner();
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

  const programRoutines = routinesInActiveProgram();
  if (!programRoutines.length) {
    box.textContent = "Cardio: ninguno";
    return;
  }

  const last3 = State.sessions.slice(0,3).map(s => s.routineId).filter(Boolean);
  const pick = programRoutines.find(r => !last3.includes(r.id)) || programRoutines[0];

  

  $("#nextRoutineName") && ($("#nextRoutineName").textContent = pick.name);
  $("#nextRoutineMeta") && ($("#nextRoutineMeta").textContent = `${pick.tag || "Sin categoría"} • ${pick.exercises.length} ejercicios • ${pick.targetMin || 0} min`);

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
    toast("Progreso", "Selecciona el ejercicio que quieres destacar en el inicio.", "ok");
  });
}

/* ---------------------------
   PROGRESIÓN AUTOMÁTICA (sobrecarga progresiva)
   Cada programa puede subir solo su carga al cerrar un ciclo: un ciclo se
   completa cuando entrenaste al menos una vez cada rutina del programa desde
   que arrancó. Al cerrarlo, GymOS propone el aumento y tú confirmas.
--------------------------- */
const DEFAULT_PROGRESSION = {
  enabled: false,
  weightAmount: 2.5,   // cuánto sube el peso
  weightMode: "abs",   // "abs" = unidades fijas | "pct" = porcentaje
  weightMax: 0,        // tope por ejercicio (0 = sin tope)
  seconds: 5,          // segundos extra en ejercicios por tiempo
  minutes: 0,          // minutos extra al objetivo de la rutina
  reps: 0,             // reps extra en ejercicios sin peso
  cycle: 1,
  cycleStart: 0,
  history: []
};

function programProgression(program) {
  const raw = program?.progression || {};
  return {
    ...DEFAULT_PROGRESSION,
    ...raw,
    enabled: !!raw.enabled,
    weightAmount: Math.max(0, Number(raw.weightAmount ?? DEFAULT_PROGRESSION.weightAmount)),
    weightMode: raw.weightMode === "pct" ? "pct" : "abs",
    weightMax: Math.max(0, Number(raw.weightMax || 0)),
    seconds: Math.max(0, Number(raw.seconds ?? DEFAULT_PROGRESSION.seconds)),
    minutes: Math.max(0, Number(raw.minutes || 0)),
    reps: Math.max(0, Number(raw.reps || 0)),
    cycle: Math.max(1, Number(raw.cycle || 1)),
    cycleStart: Number(raw.cycleStart || 0),
    history: Array.isArray(raw.history) ? raw.history : []
  };
}

function saveProgression(programId, patch) {
  const p = State.programs.find(x => x.id === programId);
  if (!p) return null;
  p.progression = { ...programProgression(p), ...patch };
  p.updatedAt = Date.now();
  savePrograms();
  return p.progression;
}

function routinesInProgram(programId) {
  return State.routines.filter(r => r.programId === programId);
}

/* Estado del ciclo actual: qué rutinas ya entrenaste desde que arrancó. */
function cycleStatus(program) {
  const cfg = programProgression(program);
  const routines = routinesInProgram(program.id);
  const since = cfg.cycleStart || program.createdAt || 0;
  const trained = new Set(
    State.sessions
      .filter(s => Number(s.createdAt || 0) >= since)
      .map(s => s.routineId)
  );
  const pending = routines.filter(r => !trained.has(r.id));
  return {
    total: routines.length,
    done: routines.length - pending.length,
    pending,
    complete: routines.length > 0 && pending.length === 0
  };
}

function roundHalf(n) { return Math.round(n * 2) / 2; }

/* Fecha local (no UTC) de un timestamp, en formato YYYY-MM-DD. */
function localISODate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

/* Calcula (sin aplicar) todos los cambios del próximo aumento. */
function planProgression(program) {
  const cfg = programProgression(program);
  const changes = [];

  routinesInProgram(program.id).forEach(r => {
    if (r.progressionMode === "comfort") return;
    if (cfg.minutes > 0 && Number(r.targetMin || 0) > 0) {
      changes.push({
        routineId: r.id, routineName: r.name, exIndex: -1, exName: "",
        field: "targetMin", from: Number(r.targetMin), to: Number(r.targetMin) + cfg.minutes
      });
    }

    (r.exercises || []).forEach((ex, i) => {
      if (ex.progressionMode === "comfort") return;
      const weight = Number(ex.weight || 0);
      const duration = Number(ex.duration || 0);

      if (weight > 0 && cfg.weightAmount > 0) {
        let next = cfg.weightMode === "pct"
          ? roundHalf(weight * (1 + cfg.weightAmount / 100))
          : roundHalf(weight + cfg.weightAmount);
        if (cfg.weightMax > 0) next = Math.min(next, cfg.weightMax);
        if (next > weight) {
          changes.push({ routineId:r.id, routineName:r.name, exIndex:i, exName:ex.name, field:"weight", from:weight, to:next });
        }
      }

      if (duration > 0 && cfg.seconds > 0) {
        changes.push({ routineId:r.id, routineName:r.name, exIndex:i, exName:ex.name, field:"duration", from:duration, to:duration + cfg.seconds });
      }

      // Sin peso ni tiempo → progresa por repeticiones.
      if (weight === 0 && duration === 0 && cfg.reps > 0 && /\d/.test(String(ex.reps || ""))) {
        const from = String(ex.reps);
        const to = from.replace(/\d+/g, n => String(Number(n) + cfg.reps));
        if (to !== from) {
          changes.push({ routineId:r.id, routineName:r.name, exIndex:i, exName:ex.name, field:"reps", from, to });
        }
      }
    });
  });

  return changes;
}

function progressionSummary(changes) {
  const by = { weight:0, duration:0, reps:0, targetMin:0 };
  changes.forEach(c => { by[c.field] = (by[c.field] || 0) + 1; });
  const parts = [];
  if (by.weight) parts.push(`${by.weight} ejercicio(s) suben de peso`);
  if (by.duration) parts.push(`${by.duration} suben segundos`);
  if (by.reps) parts.push(`${by.reps} suben repeticiones`);
  if (by.targetMin) parts.push(`${by.targetMin} rutina(s) suben minutos objetivo`);
  return parts.join(" · ") || "Sin cambios que aplicar";
}

function applyProgression(program, changes) {
  if (!changes.length) return 0;

  changes.forEach(c => {
    const r = State.routines.find(x => x.id === c.routineId);
    if (!r) return;
    if (c.field === "targetMin") { r.targetMin = c.to; r.updatedAt = Date.now(); return; }
    const ex = (r.exercises || [])[c.exIndex];
    if (!ex || ex.name !== c.exName) return; // la rutina cambió: no tocar
    ex[c.field] = c.to;
    r.updatedAt = Date.now();
  });

  const cfg = programProgression(program);
  saveProgression(program.id, {
    cycle: cfg.cycle + 1,
    cycleStart: Date.now(),
    history: [{ at: Date.now(), cycle: cfg.cycle, changes }, ...cfg.history].slice(0, 20)
  });
  saveRoutines();
  return changes.length;
}

function undoLastProgression(program) {
  const cfg = programProgression(program);
  const last = cfg.history[0];
  if (!last) return false;

  last.changes.forEach(c => {
    const r = State.routines.find(x => x.id === c.routineId);
    if (!r) return;
    if (c.field === "targetMin") { r.targetMin = c.from; r.updatedAt = Date.now(); return; }
    const ex = (r.exercises || [])[c.exIndex];
    if (!ex || ex.name !== c.exName) return;
    ex[c.field] = c.from;
    r.updatedAt = Date.now();
  });

  saveProgression(program.id, {
    cycle: Math.max(1, cfg.cycle - 1),
    cycleStart: last.at,
    history: cfg.history.slice(1)
  });
  saveRoutines();
  return true;
}

/* Se llama al guardar una sesión: si el ciclo se cerró, propone el aumento. */
async function maybeOfferProgression(session) {
  const routine = State.routines.find(r => r.id === session?.routineId);
  const program = State.programs.find(p => p.id === routine?.programId);
  if (!program) return;

  const cfg = programProgression(program);
  if (!cfg.enabled) return;
  if (!cfg.cycleStart) { saveProgression(program.id, { cycleStart: Date.now() }); return; }

  const status = cycleStatus(program);
  if (!status.complete) return;

  const changes = planProgression(program);
  if (!changes.length) {
    saveProgression(program.id, { cycle: cfg.cycle + 1, cycleStart: Date.now() });
    return;
  }

  const ok = await confirmDialog({
    title: `🎉 ¡Ciclo ${cfg.cycle} completo!`,
    text: `Entrenaste las ${status.total} rutina(s) de "${program.name}". ¿Subimos la carga? ${progressionSummary(changes)}.`,
    yesText: "Aplicar aumento",
    noText: "Ahora no"
  });

  if (!ok) {
    // Se pospone: arranca un ciclo nuevo sin subir nada.
    saveProgression(program.id, { cycleStart: Date.now() });
    toast("Progresión pospuesta", "Seguimos con la misma carga este ciclo.", "ok");
    return;
  }

  const n = applyProgression(program, changes);
  toast(`¡Nivel ${cfg.cycle + 1}! 📈`, `${n} ajuste(s) aplicados en ${program.name}.`, "ok");
}

/* --------------------------- MODAL DE PROGRESIÓN --------------------------- */
function openProgressionModal(program) {
  const m = $("#modalProgression");
  if (!m) return;

  const cfg = programProgression(program);
  $("#modalProgressionTitle").textContent = `📈 Progresión · ${program.name}`;
  $("#progEnabled").checked = cfg.enabled;
  $("#progWeightAmount").value = cfg.weightAmount;
  $("#progWeightMode").value = cfg.weightMode;
  $("#progWeightMax").value = cfg.weightMax || "";
  $("#progSeconds").value = cfg.seconds;
  $("#progReps").value = cfg.reps;
  $("#progMinutes").value = cfg.minutes;

  const readForm = () => ({
    enabled: $("#progEnabled").checked,
    weightAmount: Math.max(0, Number($("#progWeightAmount").value || 0)),
    weightMode: $("#progWeightMode").value === "pct" ? "pct" : "abs",
    weightMax: Math.max(0, Number($("#progWeightMax").value || 0)),
    seconds: Math.max(0, Number($("#progSeconds").value || 0)),
    reps: Math.max(0, Number($("#progReps").value || 0)),
    minutes: Math.max(0, Number($("#progMinutes").value || 0))
  });

  const paint = () => {
    const current = State.programs.find(p => p.id === program.id) || program;
    const live = programProgression(current);
    const status = cycleStatus(current);

    const cycleBox = $("#progressionCycle");
    cycleBox.innerHTML = "";
    cycleBox.appendChild(el("div", { class:"progression-cycle__level" }, [
      el("strong", { text:`Ciclo ${live.cycle}` }),
      el("span", { class:"muted", text: status.total
        ? `${status.done} de ${status.total} rutina(s) entrenadas en este ciclo`
        : "Este programa aún no tiene rutinas." })
    ]));
    if (status.pending.length) {
      cycleBox.appendChild(el("div", { class:"muted", text:`Faltan: ${status.pending.map(r => r.name).join(", ")}` }));
    } else if (status.total) {
      cycleBox.appendChild(el("div", { class:"muted", text:"¡Ciclo listo! Se propondrá el aumento al guardar la próxima sesión." }));
    }

    // Vista previa con los valores del formulario, sin guardar todavía.
    const preview = $("#progressionPreview");
    preview.innerHTML = "";
    const simulated = { ...current, progression: { ...live, ...readForm() } };
    const changes = planProgression(simulated);
    if (!changes.length) {
      preview.appendChild(el("div", { class:"muted", text:"Con esta configuración no cambiaría nada todavía." }));
    } else {
      preview.appendChild(el("div", { class:"muted", text: progressionSummary(changes) }));
      changes.slice(0, 12).forEach(c => {
        const label = c.field === "targetMin"
          ? `${c.routineName} · minutos objetivo`
          : `${c.exName} (${c.routineName})`;
        const unit = c.field === "weight" ? ` ${State.prefs.unit}` : c.field === "duration" ? "s" : c.field === "targetMin" ? " min" : "";
        preview.appendChild(el("div", { class:"progression-change" }, [
          el("span", { text: label }),
          el("strong", { text: `${c.from}${unit} → ${c.to}${unit}` })
        ]));
      });
      if (changes.length > 12) {
        preview.appendChild(el("div", { class:"muted", text:`…y ${changes.length - 12} cambio(s) más.` }));
      }
    }

    const hist = $("#progressionHistory");
    hist.innerHTML = "";
    if (!live.history.length) {
      hist.appendChild(el("div", { class:"muted", text:"Todavía no hay aumentos aplicados." }));
    } else {
      live.history.slice(0, 8).forEach(h => {
        hist.appendChild(el("div", { class:"progression-change" }, [
          el("span", { text:`Ciclo ${h.cycle} · ${formatDate(localISODate(h.at), State.prefs)}` }),
          el("strong", { text:`${h.changes.length} ajuste(s)` })
        ]));
      });
    }
    $("#btnProgressionUndo").disabled = !live.history.length;
  };

  ["#progEnabled","#progWeightAmount","#progWeightMode","#progWeightMax","#progSeconds","#progReps","#progMinutes"]
    .forEach(id => { const node = $(id); if (node) node.oninput = paint; });
  $("#progWeightMode").onchange = paint;

  $("#btnProgressionUndo").onclick = async () => {
    const current = State.programs.find(p => p.id === program.id);
    if (!current) return;
    const ok = await confirmDialog({
      title: "Deshacer aumento",
      text: "Se restaurarán los pesos, tiempos y reps que tenías antes del último aumento.",
      yesText: "Deshacer",
      noText: "Cancelar"
    });
    if (!ok) return;
    if (undoLastProgression(current)) {
      toast("Aumento deshecho", "Volviste a la carga anterior.", "ok");
      paint();
      scheduleRender();
    }
  };

  $("#btnSaveProgression").onclick = () => {
    const form = readForm();
    const current = State.programs.find(p => p.id === program.id) || program;
    const live = programProgression(current);
    // Al activarla por primera vez, el ciclo arranca hoy.
    const patch = { ...form };
    if (form.enabled && !live.cycleStart) patch.cycleStart = Date.now();
    saveProgression(program.id, patch);
    toast("Progresión guardada", form.enabled ? "Activa en este programa." : "Desactivada.", "ok");
    closeModal("#modalProgression");
    scheduleRender();
  };

  paint();
  openModal("#modalProgression");
}

/* ---------------------------
   ROUTINES
--------------------------- */
const rerenderRoutinesDebounced = debounce(() => scheduleRender(), 120);

function renderProgramBar() {
  const sel = $("#programSelect");
  if (sel) {
    sel.innerHTML = "";
    State.programs.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      const count = State.routines.filter(r => r.programId === p.id).length;
      opt.textContent = `${p.name} (${count})`;
      sel.appendChild(opt);
    });
    sel.value = State.activeProgramId || "";

    if (!sel.dataset.bound) {
      sel.dataset.bound = "1";
      sel.addEventListener("change", () => {
        setActiveProgram(sel.value);
        scheduleRender();
      });
    }
  }

  // Indicador de progresión del programa activo
  const pill = $("#programProgressionPill");
  if (pill) {
    const p = activeProgram();
    const cfg = p ? programProgression(p) : null;
    if (!p || !cfg.enabled) {
      pill.classList.add("is-hidden");
    } else {
      const status = cycleStatus(p);
      pill.classList.remove("is-hidden");
      pill.classList.toggle("pill--ok", status.complete);
      pill.textContent = status.complete
        ? `📈 Ciclo ${cfg.cycle} listo · sube al guardar`
        : `📈 Ciclo ${cfg.cycle} · ${status.done}/${status.total}`;
      pill.title = status.pending.length ? `Faltan: ${status.pending.map(r => r.name).join(", ")}` : "Ciclo completo";
    }
  }

  const bind = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };

  bind("#btnNewProgram", () => {
    const name = (window.prompt("Nombre del nuevo programa:", "") || "").trim();
    if (!name) return;
    const p = createProgram(name);
    toast("Programa creado", p.name, "ok");
    scheduleRender();
  });
  bind("#btnGenerateProgram", () => openRoutineAiModal(true));

  bind("#btnRenameProgram", () => {
    const p = activeProgram();
    if (!p) return;
    const name = (window.prompt("Nuevo nombre del programa:", p.name) || "").trim();
    if (!name || name === p.name) return;
    renameProgram(p.id, name);
    toast("Programa renombrado", name, "ok");
    scheduleRender();
  });

  bind("#btnDuplicateProgram", () => {
    const p = activeProgram();
    if (!p) return;
    const copy = duplicateProgram(p.id);
    if (!copy) return;
    toast("Programa duplicado", copy.name, "ok");
    scheduleRender();
  });

  bind("#btnProgression", () => {
    const p = activeProgram();
    if (!p) return;
    openProgressionModal(p);
  });

  bind("#btnShareProgram", () => {
    const p = activeProgram();
    if (!p) return;
    shareProgram(p);
  });

  bind("#btnDeleteProgram", async () => {
    const p = activeProgram();
    if (!p) return;
    if (State.programs.length <= 1) {
      toast("No se puede", "Debe existir al menos un programa.", "warn");
      return;
    }
    const count = State.routines.filter(r => r.programId === p.id).length;
    const ok = await confirmDialog({
      title: "Eliminar programa",
      text: `Eliminar "${p.name}" y sus ${count} día(s)? El historial de sesiones se conserva.`,
      yesText: "Eliminar",
      noText: "Cancelar"
    });
    if (!ok) return;
    deleteProgram(p.id);
    toast("Programa eliminado", p.name, "warn");
    scheduleRender();
  });
}

function renderRoutines() {
  const grid = $("#routinesGrid");
  const empty = $("#routinesEmpty");
  const search = $("#routineSearch");
  if (!grid || !empty) return;

  renderProgramBar();
  renderSharedInbox();
  $("#btnRefreshShares") && ($("#btnRefreshShares").onclick = () => refreshIncomingShares(true));

  const inProgram = routinesInActiveProgram();
  $("#routinesCount") && ($("#routinesCount").textContent = `${inProgram.length}`);

  const q = (search?.value || "").toLowerCase().trim();
  const filtered = inProgram.filter(r => {
    if (!q) return true;
    const hay = `${r.name} ${r.tag} ${(r.exercises||[]).map(e=>e.name).join(" ")}`.toLowerCase();
    return hay.includes(q);
  });
  grid.replaceChildren();

  if (!filtered.length) {
    empty.classList.remove("is-hidden");
    grid.classList.add("is-hidden");
  } else {
    empty.classList.add("is-hidden");
    grid.classList.remove("is-hidden");
    const tpl = $("#tplRoutineCard");
    filtered.forEach(r => {
      const node = tpl?.content?.firstElementChild?.cloneNode(true);
      if (!node) return;

      $(".tile__title", node).textContent = r.name;
      $(".tile__meta", node).textContent = `${r.targetMin || 0} min • ${r.exercises.length} ejercicios`;
      const pill = $(".pill", node);
      pill.textContent = r.tag || "Sin categoría";

      node.setAttribute("aria-pressed", String(State.selectedRoutineId === r.id));
      node.addEventListener("click", () => {
        State.selectedRoutineId = r.id;
        renderRoutines();
        $("#routineDetailTitle").focus({ preventScroll:true });
        scrollToRoutineSection($("#routineDetailPanel"));
      });
      node.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          node.click();
        }
      });

      grid.appendChild(node);
    });
  }

  // Detail
  renderRoutineDetail();
  $("#btnBackToRoutines").onclick = () => {
    const target = $('.tile[aria-pressed="true"]', grid) || search;
    target.focus({ preventScroll:true });
    scrollToRoutineSection(target, "nearest");
  };

  // Bind buttons each render is fine (idempotent by overwrite)
  $("#btnNewRoutine") && ($("#btnNewRoutine").onclick = () => openRoutineModal({ mode:"new" }));
  $("#btnGenerateRoutine").onclick = () => openRoutineAiModal();

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

const sharedExerciseImages = new Map();
const imageGenerations = new Map();
let unsubscribeExerciseImages = null;

function exerciseImageUrl(ex) {
  const shared = sharedExerciseImages.get(ExerciseIdentity.normalizeExerciseName(ex?.name))?.imageUrl;
  return shared || cleanMediaUrl(ex?.imageUrl);
}

function refreshExerciseImages() {
  $$("[data-exercise-media]").forEach(node => {
    const ex = JSON.parse(node.dataset.exerciseMedia);
    node.replaceWith(buildExerciseMedia(ex, { compact: node.classList.contains("exercise-media--compact") }));
  });
}

function subscribeExerciseImages(user) {
  unsubscribeExerciseImages?.();
  unsubscribeExerciseImages = null;
  sharedExerciseImages.clear();
  refreshExerciseImages();
  const sync = window.FirebaseSync;
  if (!user || !sync?.db) return;
  unsubscribeExerciseImages = sync.db.collection("exerciseIllustrations").where("status", "==", "ready").onSnapshot(snapshot => {
    if (sync.currentUser?.uid !== user.uid) return;
    sharedExerciseImages.clear();
    snapshot.forEach(doc => {
      const image = doc.data();
      sharedExerciseImages.set(image.normalizedName, image);
    });
    refreshExerciseImages();
  }, () => toast("Biblioteca de imágenes", "No pudimos actualizar las imágenes compartidas. Revisa tu conexión.", "warn"));
}

async function generateExerciseImage(ex) {
  const sync = window.FirebaseSync;
  if (!sync?.currentUser || !sync.app?.functions) throw new Error("Inicia sesión para crear imágenes.");
  const key = ExerciseIdentity.normalizeExerciseName(ex.name);
  if (sharedExerciseImages.has(key)) return { ...sharedExerciseImages.get(key), reused: true };
  if (imageGenerations.has(key)) return imageGenerations.get(key);
  const uid = sync.currentUser.uid;
  const pending = (async () => {
    const call = sync.app.functions("us-central1").httpsCallable("generateExerciseImage", { timeout: 100000 });
    const { data } = await call({ name: String(ex.name || "").trim(), notes: String(ex.notes || "").slice(0, 800) });
    if (sync.currentUser?.uid === uid) {
      sharedExerciseImages.set(data.normalizedName, data);
      refreshExerciseImages();
    }
    return data;
  })();
  imageGenerations.set(key, pending);
  try { return await pending; }
  finally { imageGenerations.delete(key); }
}

function exerciseImageControls(getExercise) {
  const status = el("span", { class:"muted exercise-image-status", role:"status" });
  const button = el("button", { class:"btn btn--ghost btn--sm", type:"button", text:"Crear imagen IA" });
  button.onclick = async () => {
    const ex = getExercise();
    if (!String(ex.name || "").trim()) {
      status.textContent = "Escribe el nombre del ejercicio.";
      return;
    }
    button.disabled = true;
    button.textContent = "Creando imagen…";
    status.textContent = "Preparando la ilustración. Puede tardar alrededor de un minuto.";
    try {
      const image = await generateExerciseImage(ex);
      status.textContent = image.reused ? "Imagen reutilizada de la biblioteca." : "Imagen creada y vinculada a los ejercicios con este nombre.";
    } catch (error) {
      status.textContent = error.message || "No pudimos crear la imagen. Intenta de nuevo.";
    } finally {
      button.disabled = false;
      button.textContent = "Crear imagen IA";
    }
  };
  return el("div", { class:"exercise-image-controls" }, [button, status]);
}

async function generateRoutineImages(routine, button, status) {
  const exercises = routine.exercises || [];
  if (!exercises.length) {
    status.textContent = "Agrega al menos un ejercicio con nombre para crear sus imágenes.";
    return;
  }
  button.disabled = true;
  let completed = 0;
  let created = 0;
  status.textContent = "Buscando imágenes en la biblioteca…";
  try {
    for (const ex of exercises) {
      button.textContent = `Imagen ${completed + 1} de ${exercises.length}…`;
      status.textContent = `Preparando ${ex.name}. Las imágenes aparecen a medida que se completan.`;
      const image = await generateExerciseImage(ex);
      if (!image.reused) created++;
      completed++;
    }
    status.textContent = `${completed} imágenes disponibles. ${created} nuevas y ${completed - created} reutilizadas.`;
    toast("Imágenes disponibles", "Se reutilizarán automáticamente en los ejercicios con el mismo nombre.", "ok");
  } catch (error) {
    status.textContent = `${completed} de ${exercises.length} listas. ${error.message || "Intenta de nuevo para continuar."}`;
    toast("Imágenes pendientes", error.message || "Intenta de nuevo para completar las imágenes que faltan.", "warn");
  } finally {
    button.disabled = false;
    button.textContent = "Crear imágenes IA";
  }
}

function buildExerciseMedia(ex, options={}) {
  const imageUrl = exerciseImageUrl(ex);
  const videoUrl = cleanMediaUrl(ex?.videoUrl);
  const compact = !!options.compact;
  const wrap = el("div", { class: compact ? "exercise-media exercise-media--compact" : "exercise-media" });
  wrap.dataset.exerciseMedia = JSON.stringify({ name: ex?.name || "", imageUrl: ex?.imageUrl || "", videoUrl: ex?.videoUrl || "" });
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

  wrap.hidden = !hasMedia;
  return wrap;
}

function exerciseCatalogDetails(ex) {
  const record = GymCatalog.findExercise(ex);
  if (!record) return null;
  const position = record.position.replaceAll("_", " ");
  const level = ["", "Principiante", "Intermedio", "Avanzado con control"][record.difficulty];
  const fields = [
    ["Categoría", GymCatalog.exerciseCategories[record.category] + " · " + record.subcategory],
    ["Nivel y posición", level + " · " + position],
    ["Superficies", record.surfaces.map(value => value.replaceAll("_", " ")).join(", ")],
    ["Equipo", record.equipment.join(", ") || "Sin equipo"],
    ["Músculos y articulaciones", record.muscles.join(", ") + " · " + record.joints.join(", ")],
    ["Modalidad y objetivos", record.modality.replaceAll("_", " ") + " · " + record.goals.map(goal => GymCatalog.categories[goal]).join(", ")],
    ["Dosis orientativa", record.recommendation.holdSeconds.join("–") + " segundos o " + record.recommendation.repetitions.join("–") + " repeticiones cómodas"],
    ["Ejecución", record.instructions.join(" ")],
    ["Errores comunes", record.commonMistakes.join(" ")],
    ["Precauciones", record.precautions.join(" ")],
    ["Cuándo evitarlo o consultar", record.contraindications.join(" ")],
    ["Alternativas", record.alternatives.map(id => GymCatalog.records[id]?.name).filter(Boolean).join(", ")],
    ["Progresión", record.progression.condition]
  ];
  return el("details", { class:"catalog-details" }, [
    el("summary", { text:"Ficha del ejercicio · " + position }),
    el("dl", {}, fields.flatMap(([label, value]) => [el("dt", { text:label }), el("dd", { text:value })]))
  ]);
}

function appendFlexibilityTracker(card, ex) {
  const record = GymCatalog.findExercise(ex);
  if (!record && !ex.flexibilityProgress) return;
  const previous = State.sessions.slice().sort((a, b) => b.date.localeCompare(a.date))
    .flatMap(session => (session.exercises || []).map(item => ({ ...item, date:session.date })))
    .find(item => item.flexibilityProgress &&
      (ex.catalogId ? item.catalogId === ex.catalogId : GymCatalog.normalizeName(item.name) === GymCatalog.normalizeName(ex.name)));
  const value = ex.flexibilityProgress || {};
  const range = el("input", { class:"input", maxlength:"160", "data-flex-field":"comfortableRange", value:value.comfortableRange || "", placeholder:previous?.flexibilityProgress.comfortableRange || "Ej. manos hasta media espinilla, sin tirar" });
  const hold = el("input", { class:"input", type:"number", min:"0", max:"300", step:"1", "data-flex-field":"holdSeconds", value:value.holdSeconds ?? "", placeholder:"Segundos que mantuviste de forma cómoda" });
  const difficulty = el("select", { class:"input", "data-flex-field":"perceivedDifficulty" }, [
    el("option", { value:"", text:"Sin registrar" }),
    ...["Muy fácil", "Fácil", "Moderado", "Exigente", "Muy exigente"].map((text, index) => el("option", { value:String(index + 1), text }))
  ]);
  difficulty.value = value.perceivedDifficulty == null ? "" : String(value.perceivedDifficulty);
  const comfort = el("select", { class:"input", "data-flex-field":"comfort" }, [
    el("option", { value:"", text:"Sin registrar" }), el("option", { value:"comfortable", text:"Cómodo, con control" }),
    el("option", { value:"reduce", text:"Necesito reducir o adaptar" }), el("option", { value:"pain", text:"Apareció dolor: detuve el ejercicio" })
  ]);
  comfort.value = value.comfort || "";
  const field = (text, control) => el("label", { class:"field" }, [el("span", { class:"field__label", text }), control]);
  const last = previous?.flexibilityProgress;
  const details = el("details", { class:"flexibility-tracker" }, [
    el("summary", { text:"Registrar amplitud y comodidad" }),
    el("div", { class:"form" }, [
      el("p", { class:"muted", text:last ? "Anterior (" + previous.date + "): " + (last.comfortableRange || "amplitud sin registrar") + " · " + (last.holdSeconds ?? "—") + " s." : "El registro es personal. La amplitud cómoda y el control importan más que llegar a una postura concreta." }),
      field("Amplitud cómoda observada", range), field("Tiempo real de mantenimiento (segundos)", hold),
      field("Dificultad percibida", difficulty), field("Cómo se sintió", comfort),
      el("p", { class:"muted", text:"Si aparece dolor, detén ese movimiento. Mantén o reduce la dificultad antes de considerar otra progresión." })
    ])
  ]);
  $(".exercise-card__body", card)?.appendChild(details);
}

function readFlexibilityProgress(card) {
  const read = field => card.querySelector('[data-flex-field="' + field + '"]')?.value || "";
  if (!["comfortableRange", "holdSeconds", "perceivedDifficulty", "comfort"].some(field => read(field))) return null;
  const hold = read("holdSeconds");
  return {
    comfortableRange: read("comfortableRange").trim().slice(0, 160),
    holdSeconds: hold === "" ? null : clamp(Number(hold) || 0, 0, 300),
    perceivedDifficulty: read("perceivedDifficulty") ? Number(read("perceivedDifficulty")) : null,
    comfort: read("comfort"),
    catalogLevel: GymCatalog.findExercise(card.exerciseData)?.difficulty || null
  };
}

function renderFlexibilityHistory() {
  const box = $("#flexibilityHistory");
  if (!box) return;
  box.replaceChildren();
  const query = GymCatalog.normalizeName($("#progressSearch")?.value || "");
  const start = startDateFromRange($("#progressRange")?.value || "30");
  const entries = State.sessions.slice().sort((a, b) => b.date.localeCompare(a.date))
    .filter(session => !start || parseISODate(session.date) >= start)
    .flatMap(session => (session.exercises || []).filter(ex => ex.flexibilityProgress)
      .map(ex => ({ ...ex, date:session.date })))
    .filter(ex => !query || GymCatalog.normalizeName(ex.name).includes(query));
  if (!entries.length) {
    box.appendChild(el("p", { class:"muted", text:"Durante una sesión, abre «Registrar amplitud y comodidad» en cada ejercicio. Aquí podrás comparar tus registros con el tiempo." }));
    return;
  }
  entries.slice(0, 40).forEach((ex, index) => {
    const value = ex.flexibilityProgress;
    const previous = entries.slice(index + 1).find(item =>
      ex.catalogId ? item.catalogId === ex.catalogId : GymCatalog.normalizeName(item.name) === GymCatalog.normalizeName(ex.name));
    const comfort = { comfortable:"Cómodo", reduce:"Reducir o adaptar", pain:"Se detuvo por dolor" }[value.comfort] || "Comodidad sin registrar";
    const evolution = previous?.flexibilityProgress;
    const comparison = evolution && value.holdSeconds != null && evolution.holdSeconds != null
      ? "Cambio de mantenimiento respecto al registro anterior: " + (value.holdSeconds - evolution.holdSeconds) + " s."
      : "El tiempo y la amplitud se comparan con tus propios registros.";
    box.appendChild(el("article", { class:"flex-history-entry" }, [
      el("strong", { text:ex.name + " · " + formatDate(ex.date, State.prefs) }),
      el("p", { text:"Amplitud: " + (value.comfortableRange || "sin registrar") + " · Mantenimiento: " + (value.holdSeconds ?? "—") + " s" }),
      el("p", { text:"Semana " + (ex.progressionWeek || "sin registrar") + " · Nivel del catálogo: " + (value.catalogLevel ?? "—") +
        " · Dificultad percibida: " + (value.perceivedDifficulty ?? "—") + "/5 · " + comfort }),
      el("span", { class:"muted", text:comparison })
    ]));
  });
}

function attachExerciseMediaToCard(card, ex) {
  card.exerciseData = { ...ex };
  const old = $(".exercise-media", card);
  if (old) old.remove();
  const media = buildExerciseMedia(ex, { compact:false });
  if (!media) return;
  const head = $(".exercise-card__head", card);
  if (head) head.after(media);
  if (!$(".catalog-details", card)) {
    const details = exerciseCatalogDetails(ex);
    if (details) $(".exercise-card__body", card)?.appendChild(details);
  }
  if (!$(".flexibility-tracker", card)) appendFlexibilityTracker(card, ex);
}

function scrollToRoutineSection(target, block = "start") {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block, behavior: reducedMotion ? "instant" : "smooth" });
}

function renderRoutineDetail() {
  const empty = $("#routineDetailEmpty");
  const detail = $("#routineDetail");
  const tbody = $("#routineExercisesTbody");
  if (!empty || !detail || !tbody) return;

  const id = State.selectedRoutineId;
  const r = State.routines.find(x => x.id === id);
  $("#btnBackToRoutines").classList.toggle("is-hidden", !r);

  if (!r) {
    empty.classList.remove("is-hidden");
    detail.classList.add("is-hidden");
    return;
  }

  empty.classList.add("is-hidden");
  detail.classList.remove("is-hidden");

  $("#routineDetailName") && ($("#routineDetailName").textContent = r.name);
  const imageStatus = $("#routineImageStatus");
  if (imageStatus.dataset.routineId !== r.id) {
    imageStatus.textContent = "";
    imageStatus.dataset.routineId = r.id;
  }
  $("#routineDetailMeta") && ($("#routineDetailMeta").textContent = `${r.tag || "Sin categoría"} • ${r.exercises.length} ejercicios • ${r.targetMin || 0} min` + (r.progressionWeek ? " • Semana " + r.progressionWeek : ""));
  $("#routineCardio") && ($("#routineCardio").textContent = r.cardioSuggest || "-");
  renderEquipmentChecklist($("#routineEquipmentList"), routineEquipment(r), `routine:${r.id}`);

  tbody.innerHTML = "";
  r.exercises.forEach(ex => {
    const guide = buildExerciseMedia(ex, { compact:true }) || el("span", { class:"muted", text:"—" });
    tbody.appendChild(el("tr", {}, [
      el("td", {}, [
        el("div", { text: ex.name }),
        exerciseImageControls(() => ex),
        exerciseCatalogDetails(ex)
      ].filter(Boolean)),
      el("td", { "data-label":"Series", text: String(ex.sets||0) }),
      el("td", { "data-label":ex.duration > 0 ? "Tiempo por serie" : "Repeticiones", text: ex.duration > 0 ? fmtDurationLabel(ex.duration) : String(ex.reps||"—") }),
      el("td", { "data-label":"Peso", text: `${ex.weight||0} ${ex.unit || State.prefs.unit}` }),
      el("td", { "data-label":"Descansos", text: `${fmtDurationLabel(ex.rest || 0)} entre series · ${fmtDurationLabel(ex.restAfter || 0)} al terminar` }),
      el("td", { "data-label":"Indicaciones", text: ex.notes || "Sin indicaciones adicionales." }),
      el("td", { "data-label":"Guía visual" }, [guide])
    ]));
  });

  $("#btnEditRoutine") && ($("#btnEditRoutine").onclick = () => openRoutineModal({ mode:"edit", routine: r }));
  $("#btnRoutineImages").onclick = event => generateRoutineImages(r, event.currentTarget, $("#routineImageStatus"));
  $("#btnShareRoutine") && ($("#btnShareRoutine").onclick = () => shareRoutine(r));
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

/* Checklist rápida de elementos. El marcado vive solo en memoria (por scope),
   así se puede repasar antes de entrenar sin ensuciar los datos guardados. */
const EquipmentChecks = new Map(); // scope -> Set(item)

function renderEquipmentChecklist(container, items, scope, onChange=null) {
  if (!container) return;
  container.innerHTML = "";
  if (!items.length) {
    container.appendChild(el("div", { class:"muted", text:"Sin elementos definidos. Edita la rutina para agregarlos." }));
    onChange && onChange(0, 0);
    return;
  }

  if (!EquipmentChecks.has(scope)) EquipmentChecks.set(scope, new Set());
  const checked = EquipmentChecks.get(scope);
  const report = () => onChange && onChange(items.filter(i => checked.has(i)).length, items.length);

  items.forEach(item => {
    const btn = el("button", {
      class:`equipment-item${checked.has(item) ? " is-checked" : ""}`,
      type:"button",
      "aria-pressed": checked.has(item) ? "true" : "false"
    }, [
      el("span", { class:"equipment-item__box", text: checked.has(item) ? "✓" : "", "aria-hidden":"true" }),
      el("span", { text:item })
    ]);
    btn.onclick = () => {
      if (checked.has(item)) checked.delete(item); else checked.add(item);
      const on = checked.has(item);
      btn.classList.toggle("is-checked", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.querySelector(".equipment-item__box").textContent = on ? "✓" : "";
      report();
    };
    container.appendChild(btn);
  });
  report();
}

function renderSessionEquipment() {
  const panel = $("#sessionEquipment");
  const list = $("#sessionEquipmentList");
  if (!panel || !list) return;
  const routine = State.routines.find(r => r.id === $("#sessionRoutineSelect")?.value);
  const items = routineEquipment(routine);
  if (!items.length) { panel.classList.add("is-hidden"); list.innerHTML = ""; return; }
  panel.classList.remove("is-hidden");
  renderEquipmentChecklist(list, items, `session:${routine.id}`, (done, total) => {
    const status = $("#sessionEquipmentStatus");
    if (!status) return;
    status.textContent = done === total
      ? `¡Listo! Tienes los ${total} elementos.`
      : `${done} de ${total} listos. Marca cada elemento cuando lo tengas a la mano.`;
  });
}

/* ---------------------------
   ROUTINE MODAL
--------------------------- */
function openRoutineAiModal(isProgram = false) {
  const sync = window.FirebaseSync;
  const user = sync?.currentUser;
  if (!user || !sync.app?.functions) {
    toast("Generador no disponible", "Inicia sesión y verifica tu conexión para usar la IA.", "warn");
    return;
  }

  const modal = $("#modalRoutineAi");
  const form = $("#routineAiForm");
  const prompt = $("#routineAiPrompt");
  const submit = $("#btnSubmitRoutineAi");
  const status = $("#routineAiStatus");
  const daysField = $("#routineAiDaysField");
  const daysInput = $("#routineAiDays");
  const preview = $("#programAiPreview");
  const save = $("#btnSaveAiProgram");
  $("#modalRoutineAiTitle").textContent = isProgram ? "Crear programa con IA" : "Crear rutina con IA";
  daysField.classList.toggle("is-hidden", !isProgram);
  daysInput.disabled = !isProgram;
  preview.classList.add("is-hidden");
  preview.replaceChildren();
  save.classList.add("is-hidden");
  save.onclick = null;
  $("#routineAiCategory").replaceChildren(
    el("option", { value:"", text:"Según la descripción" }),
    ...Object.entries(GymCatalog.categories).map(([value, text]) => el("option", { value, text }))
  );
  form.reset();
  submit.disabled = false;
  status.textContent = "";

  const generate = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const description = prompt.value.trim();
    if (!description) {
      status.textContent = "Describe brevemente qué quieres trabajar.";
      prompt.focus();
      return;
    }

    submit.disabled = true;
    preview.classList.add("is-hidden");
    save.classList.add("is-hidden");
    save.onclick = null;
    const days = daysInput.value ? Number(daysInput.value) : null;
    status.textContent = isProgram ? "Preparando tu programa semanal…" : "Preparando tu rutina…";
    const isCurrent = () => !modal.hidden && form.onsubmit === generate &&
      sync.currentUser?.uid === user.uid;
    try {
      const call = sync.app.functions("us-central1").httpsCallable("generateRoutine", { timeout: 35000 });
      const { data } = await call({
        minutes: Number($("#routineAiMinutes").value), prompt: description,
        ...(isProgram ? { days } : {}),
        options: {
          category: $("#routineAiCategory").value, position: $("#routineAiPosition").value,
          surface: $("#routineAiSurface").value, maxLevel: Number($("#routineAiLevel").value),
          week: Number($("#routineAiWeek").value), progressComfortable: $("#routineAiComfort").checked,
          noEquipment: $("#routineAiNoEquipment").checked
        }
      });
      if (!isCurrent()) return;
      if (isProgram) {
        if (!Array.isArray(data?.routines) || !data.routines.length ||
            (days !== null && data.routines.length !== days) ||
            data.routines.some(routine => !routine?.exercises?.length)) {
          status.textContent = "El generador no devolvió el programa completo. Intenta de nuevo.";
          return;
        }
        const name = el("input", { class:"input", type:"text", maxlength:"100", value:data.name });
        preview.replaceChildren(
          el("label", { class:"field" }, [
            el("span", { class:"field__label", text:"Nombre del programa" }), name
          ]),
          ...data.routines.map(routine => el("details", { class:"ai-options" }, [
            el("summary", { text:`${routine.name} · ${routine.targetMin} min` }),
            el("ul", {}, routine.exercises.map(exercise => el("li", { text:exercise.name }))),
            el("p", { class:"muted", text:(routine.generationNotes || []).join(" ") })
          ]))
        );
        preview.classList.remove("is-hidden");
        save.classList.remove("is-hidden");
        status.textContent = `Borrador listo · ${data.routines.length} día(s) por semana.`;
        save.onclick = () => {
          if (!isCurrent() || save.classList.contains("is-hidden")) return;
          if (!name.value.trim()) {
            status.textContent = "Ponle un nombre al programa.";
            name.focus();
            return;
          }
          const program = createProgram(name.value, data.routines);
          closeModal("#modalRoutineAi");
          toast("Programa creado", program.name, "ok");
          scheduleRender();
        };
        name.focus();
        return;
      }
      closeModal("#modalRoutineAi");
      openRoutineModal({ mode:"draft", routine: data });
      $("#routineName").focus();
    } catch (error) {
      if (!isCurrent()) return;
      if (error.details?.reason === "health-review") {
        status.textContent = error.message;
        return;
      }
      const knownCodes = ["invalid-argument", "permission-denied", "resource-exhausted", "failed-precondition", "unavailable"];
      const code = error.code?.replace(/^functions\//, "");
      status.textContent = knownCodes.includes(code) && error.message !== code
        ? error.message
        : "No pudimos conectar con el generador. Intenta más tarde.";
    } finally {
      if (isCurrent()) submit.disabled = false;
    }
  };
  form.onsubmit = generate;
  openModal("#modalRoutineAi");
  prompt.focus();
}

function openRoutineModal({ mode="new", routine=null } = {}) {
  const m = $("#modalRoutine");
  if (!m) return;
  m.routineData = routine ? { ...routine } : {};
  $("#routineGenerationNotes").textContent = (routine?.generationNotes || []).join(" ");

  const isEdit = mode === "edit" && routine;
  $("#modalRoutineTitle").textContent = isEdit ? "Editar rutina" : mode === "draft" ? "Revisar borrador de IA" : "Nueva rutina";

  $("#routineName").value = routine?.name || "";
  $("#routineTargetMin").value = routine?.targetMin || "";
  $("#routineTag").value = routine?.tag || "";
  $("#routineCardioSuggest").value = routine?.cardioSuggest || "";
  $("#routineEquipment") && ($("#routineEquipment").value = routineEquipment(routine).join(", "));

  const editor = $("#routineExercisesEditor");
  editor.innerHTML = "";

  const exercises = routine?.exercises || [];
  if (!exercises.length) {
    editor.appendChild(el("div", { class:"editor__empty muted", text:"Aquí aparecerán los ejercicios." }));
  } else {
    exercises.forEach(ex => editor.appendChild(renderEditorRow(ex)));
  }

  $("#btnAddExerciseRow").onclick = () => {
    $(".editor__empty", editor)?.remove();
    editor.appendChild(renderEditorRow({ name:"", sets:3, reps:"10", weight:0, unit: State.prefs.unit, notes:"", imageUrl:"", videoUrl:"" }));
  };

  $("#btnReuseExercise") && ($("#btnReuseExercise").onclick = () => {
    openExercisePicker(picked => {
      $(".editor__empty", editor)?.remove();
      picked.forEach(ex => editor.appendChild(renderEditorRow(ex)));
      toast("Ejercicios agregados", `${picked.length} ejercicio(s) reutilizado(s).`, "ok");
    }, isEdit ? routine.id : null);
  });

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
  $("#draftImageStatus").textContent = "";
  $("#btnDraftImages").onclick = event => generateRoutineImages(collectRoutineModalData(), event.currentTarget, $("#draftImageStatus"));

  openModal("#modalRoutine");
}

/* Campo de tiempo con selector de unidad (segundos / minutos).
   El dato SIEMPRE se guarda en segundos; la unidad es solo para escribirlo
   más cómodo (5 min en vez de 300 seg). */
function timeField(field, seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const useMin = total >= 60 && total % 60 === 0;

  const input = el("input", {
    class:"input input--sm",
    type:"number", min:"0",
    step: useMin ? "0.5" : "1",
    value: useMin ? total / 60 : total,
    "data-field": field,
    "data-unit": useMin ? "min" : "seg"
  });

  const select = el("select", { class:"input input--sm time-field__unit", "aria-label":"Unidad de tiempo" }, [
    el("option", { value:"seg", text:"segundos" }),
    el("option", { value:"min", text:"minutos" })
  ]);
  select.value = useMin ? "min" : "seg";

  const hint = el("span", { class:"time-field__hint" });
  const syncHint = () => {
    const secs = timeFieldSeconds(input);
    hint.textContent = secs > 0 ? `= ${fmtDurationLabel(secs)}` : "0 = por repeticiones";
  };

  select.onchange = () => {
    const secs = timeFieldSeconds(input);
    input.dataset.unit = select.value;
    input.step = select.value === "min" ? "0.5" : "1";
    input.value = select.value === "min" ? Math.round((secs / 60) * 100) / 100 : Math.round(secs);
    syncHint();
  };
  input.addEventListener("input", syncHint);
  syncHint();

  return el("div", { class:"time-field" }, [
    el("div", { class:"time-field__row" }, [input, select]),
    hint
  ]);
}

/* Lee un input de tiempo y devuelve siempre segundos. */
function timeFieldSeconds(input) {
  if (!input) return 0;
  const value = Math.max(0, Number(input.value || 0));
  return Math.round(input.dataset.unit === "min" ? value * 60 : value);
}

function fmtDurationLabel(secs) {
  const s = Math.max(0, Math.round(Number(secs) || 0));
  if (s < 60) return `${s} seg`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} seg` : `${m} min`;
}

function renderEditorRow(ex) {
  const row = el("div", { class:"editor-row" });
  row.exerciseData = { ...ex };

  const name = el("input", { class:"input input--sm", type:"text", value: ex.name || "", placeholder:"Ejercicio", "data-field":"name" });
  const sets = el("input", { class:"input input--sm", type:"number", min:"0", step:"1", value: ex.sets ?? 0, placeholder:"Sets", "data-field":"sets" });
  const reps = el("input", { class:"input input--sm", type:"text", value: ex.reps || "", placeholder:"Reps", "data-field":"reps" });
  const weight = el("input", { class:"input input--sm", type:"number", min:"0", step:"0.5", value: ex.weight ?? 0, placeholder:"Peso", "data-field":"weight" });
  const duration = timeField("duration", ex.duration);
  const rest = timeField("rest", ex.rest);
  const restAfter = timeField("restAfter", ex.restAfter);
  const notes = el("input", { class:"input input--sm", type:"text", value: ex.notes || "", placeholder:"Notas", "data-field":"notes" });
  const imageUrl = el("input", { class:"input input--sm", type:"url", value: cleanMediaUrl(ex.imageUrl || ""), placeholder:"Enlace de la imagen", "data-field":"imageUrl" });
  const aiImageControls = exerciseImageControls(() => ({ name: name.value, notes: notes.value }));
  const imagePreview = el("div", { class:"editor-image-preview" });
  const updatePreview = () => {
    imagePreview.replaceChildren(buildExerciseMedia({ name: name.value, imageUrl: imageUrl.value }, { compact:true }));
  };
  name.addEventListener("input", updatePreview);
  imageUrl.addEventListener("input", updatePreview);
  updatePreview();
  const videoUrl = el("input", { class:"input input--sm", type:"url", value: cleanMediaUrl(ex.videoUrl || ""), placeholder:"Link video", "data-field":"videoUrl" });
  const fileInput = el("input", { type:"file", accept:"image/*", hidden:true, "data-field":"imageFile" });

  const uploadBtn = el("button", { class:"btn btn--ghost btn--sm", type:"button", title:"Subir una imagen" }, [
    el("span", { class:"icon", text:"🖼️", "aria-hidden":"true" }),
    el("span", { text:"Subir" })
  ]);

  const galleryBtn = el("button", { class:"btn btn--ghost btn--sm", type:"button", title:"Reutilizar una imagen ya usada en otro ejercicio" }, [
    el("span", { class:"icon", text:"🗂️", "aria-hidden":"true" }),
    el("span", { text:"Reutilizar imagen" })
  ]);
  galleryBtn.onclick = () => openImagePicker(url => {
    imageUrl.value = url;
    updatePreview();
  });

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

  const cell = (labelText, inputEl) =>
    el("label", { class:"editor-cell" }, [
      el("span", { class:"editor-cell__label", text: labelText }),
      inputEl
    ]);

  const title = el("div", { class:"editor-row__title" }, [
    el("span", { class:"editor-row__number", text:"Ejercicio" }),
    el("span", { class:"editor-row__summary", text: ex.name || "Nuevo ejercicio" })
  ]);
  name.addEventListener("input", () => {
    title.querySelector(".editor-row__summary").textContent = name.value || "Nuevo ejercicio";
  });
  const basics = el("div", { class:"editor-group editor-group--basics" }, [
    cell("Nombre del ejercicio", name),
    cell("Series", sets),
    cell("Repeticiones", reps),
    cell(`Peso (${ex.unit || State.prefs.unit})`, weight),
    cell("Indicaciones o técnica", notes)
  ]);
  const timing = el("div", { class:"editor-group editor-group--timing" }, [
    el("div", { class:"editor-group__intro" }, [
      el("span", { class:"editor-group__icon", text:"⏱", "aria-hidden":"true" }),
      el("div", {}, [
        el("strong", { text:"Temporizador" }),
        el("span", { text:"Para ejercicios medidos en segundos. Déjalo en 0 si se hace por repeticiones." })
      ])
    ]),
    cell("Duración del ejercicio", duration),
    cell("Descanso entre series", rest),
    cell("Descanso antes del siguiente ejercicio", restAfter)
  ]);
  const media = el("details", { class:"editor-group editor-group--media" }, [
    el("summary", { text:"Imagen, GIF o video (opcional)" }),
    el("div", { class:"editor-media-fields" }, [
      cell("Enlace de imagen", imageUrl),
      cell("Enlace de video", videoUrl),
      el("div", { class:"editor-media-actions" }, [uploadBtn, galleryBtn])
    ])
  ]);
  row.appendChild(el("div", { class:"editor-row__head" }, [title, delBtn]));
  row.appendChild(aiImageControls);
  row.appendChild(basics);
  row.appendChild(timing);
  row.appendChild(imagePreview);
  const catalogDetails = exerciseCatalogDetails(ex);
  if (catalogDetails) row.appendChild(catalogDetails);
  row.appendChild(media);
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
    const duration = timeFieldSeconds(row.querySelector('[data-field="duration"]'));
    const rest = timeFieldSeconds(row.querySelector('[data-field="rest"]'));
    const restAfter = timeFieldSeconds(row.querySelector('[data-field="restAfter"]'));
    const notes = getField(row, "notes");
    const imageUrl = getField(row, "imageUrl");
    const videoUrl = getField(row, "videoUrl");

    return {
      ...row.exerciseData,
      name: String(name).trim(),
      sets: Number(sets || 0),
      reps: String(reps).trim(),
      weight: Number(weight || 0),
      duration: Math.max(0, Number(duration || 0)),
      rest: Math.max(0, Number(rest || 0)),
      restAfter: Math.max(0, Number(restAfter || 0)),
      unit: State.prefs.unit,
      notes: String(notes).trim(),
      imageUrl: cleanMediaUrl(imageUrl),
      videoUrl: cleanMediaUrl(videoUrl)
    };
  }).filter(x => x.name);

  return {
    ...$("#modalRoutine").routineData,
    name: $("#routineName").value,
    targetMin: Number($("#routineTargetMin").value || 0),
    tag: $("#routineTag").value,
    cardioSuggest: $("#routineCardioSuggest").value,
    equipment: parseEquipmentList($("#routineEquipment")?.value),
    exercises
  };
}


/* ---------------------------
   BIBLIOTECA: REUTILIZAR EJERCICIOS E IMÁGENES
   Los ejercicios ya creados en cualquier rutina (de cualquier programa) se
   pueden copiar a la rutina que estás editando, con todos sus campos.
--------------------------- */
function exerciseLibrary(excludeRoutineId=null) {
  const seen = new Set();
  const out = [];
  State.routines.forEach(r => {
    if (excludeRoutineId && r.id === excludeRoutineId) return;
    (r.exercises || []).forEach(ex => {
      const name = String(ex.name || "").trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ ...withExerciseMedia(ex), name, routineName: r.name || "Rutina" });
    });
  });
  Object.values(GymCatalog.records).forEach(record => {
    if (out.some(ex => GymCatalog.normalizeName(ex.name) === GymCatalog.normalizeName(record.name))) return;
    out.push({ ...GymCatalog.toExercise(record), routineName: "Catálogo · " + GymCatalog.exerciseCategories[record.category] });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function imageLibrary() {
  const seen = new Map();
  const push = (ex) => {
    const url = exerciseImageUrl(ex);
    if (!url || !isHttpUrl(url) || seen.has(url)) return;
    seen.set(url, String(ex.name || "Ejercicio").trim());
  };
  State.routines.forEach(r => (r.exercises || []).forEach(push));
  State.sessions.forEach(s => (s.exercises || []).forEach(push));
  sharedExerciseImages.forEach(push);
  return [...seen.entries()].map(([url, name]) => ({ url, name }));
}

function closePicker() {
  const m = $("#modalPicker");
  if (!m) return;
  m.hidden = true;
  $("#pickerList").innerHTML = "";
  $("#pickerSearch").value = "";
  $("#pickerFoot").innerHTML = "";
}

function openPicker({ title, subtitle, searchPlaceholder, renderList, footer=null, filters=null }) {
  const m = $("#modalPicker");
  if (!m) return;
  $("#modalPickerTitle").textContent = title;
  $("#pickerSubtitle").textContent = subtitle || "";
  const search = $("#pickerSearch");
  search.placeholder = searchPlaceholder || "Buscar…";
  search.value = "";
  const list = $("#pickerList");
  $("#pickerFilters").replaceChildren(...(filters ? [filters] : []));
  $("#pickerFilters").hidden = !filters;
  const paint = () => renderList(list, search.value.toLowerCase().trim());
  if (filters) $$("select", filters).forEach(select => select.onchange = paint);
  search.oninput = paint;
  paint();
  const foot = $("#pickerFoot");
  foot.innerHTML = "";
  foot.appendChild(el("button", { class:"btn btn--ghost", type:"button", text:"Cancelar", onclick: closePicker }));
  if (footer) foot.appendChild(footer);
  m.hidden = false;
  setTimeout(() => search.focus(), 50);
}

function openExercisePicker(onPick, excludeRoutineId=null) {
  const library = exerciseLibrary(excludeRoutineId);
  const categoryFilter = el("select", { class:"input", "aria-label":"Categoría de ejercicio" }, [
    el("option", { value:"", text:"Todas las categorías" }),
    ...Object.entries(GymCatalog.exerciseCategories).map(([value, text]) => el("option", { value, text }))
  ]);
  const positionFilter = el("select", { class:"input", "aria-label":"Posición del ejercicio" }, [
    el("option", { value:"", text:"Todas las posiciones" }),
    ...GymCatalog.positions.map(value => el("option", { value, text:value.replaceAll("_", " ") }))
  ]);
  if (!library.length) {
    toast("Sin ejercicios", "Aún no hay ejercicios en otras rutinas.", "warn");
    return;
  }

  const selected = new Set();
  const confirmBtn = el("button", { class:"btn btn--primary", type:"button", text:"Agregar (0)" });
  const refreshBtn = () => { confirmBtn.textContent = `Agregar (${selected.size})`; };

  confirmBtn.onclick = () => {
    if (!selected.size) { toast("Nada seleccionado", "Elige al menos un ejercicio.", "warn"); return; }
    const picked = library
      .filter(ex => selected.has(ex.name.toLowerCase()))
      .map(({ routineName, ...ex }) => ({ ...ex }));
    closePicker();
    onPick(picked);
  };

  openPicker({
    title: "Biblioteca y catálogo de ejercicios",
    subtitle: "Elige ejercicios guardados o del catálogo. Puedes filtrar por categoría y posición.",
    searchPlaceholder: "Buscar por nombre, grupo muscular o categoría…",
    filters: el("div", { class:"row row--2" }, [categoryFilter, positionFilter]),
    footer: confirmBtn,
    renderList(list, q) {
      list.innerHTML = "";
      const rows = library.filter(ex => {
        const record = GymCatalog.findExercise(ex);
        if (categoryFilter.value && record?.category !== categoryFilter.value) return false;
        if (positionFilter.value && record?.position !== positionFilter.value) return false;
        return !q || GymCatalog.normalizeName([ex.name, ex.routineName, record?.subcategory, ...(record?.muscles || [])].join(" ")).includes(GymCatalog.normalizeName(q));
      });
      if (!rows.length) {
        list.appendChild(el("div", { class:"muted", text:"Sin resultados." }));
        return;
      }
      rows.forEach(ex => {
        const key = ex.name.toLowerCase();
        const item = el("button", {
          class: `picker-item${selected.has(key) ? " is-selected" : ""}`,
          type:"button"
        });
        item.onclick = () => {
          if (selected.has(key)) selected.delete(key); else selected.add(key);
          item.classList.toggle("is-selected", selected.has(key));
          refreshBtn();
        };
        const imageUrl = exerciseImageUrl(ex);
        if (imageUrl && isHttpUrl(imageUrl)) {
          item.appendChild(el("img", { class:"picker-item__thumb", src:imageUrl, alt:"", loading:"lazy" }));
        }
        const detail = [
          ex.sets ? `${ex.sets} series` : "",
          ex.reps ? `${ex.reps} reps` : "",
          ex.duration ? `${ex.duration}s` : "",
          ex.rest ? `${ex.rest}s descanso` : ""
        ].filter(Boolean).join(" · ");
        item.appendChild(el("span", { class:"picker-item__copy" }, [
          el("strong", { text: ex.name }),
          el("span", { class:"muted", text: `${ex.routineName}${detail ? " · " + detail : ""}` })
        ]));
        item.appendChild(el("span", { class:"picker-item__check", text:"✓" }));
        list.appendChild(item);
      });
    }
  });
}

function openImagePicker(onPick) {
  const images = imageLibrary();
  if (!images.length) {
    toast("Sin imágenes", "Todavía no hay imágenes guardadas en otros ejercicios.", "warn");
    return;
  }

  openPicker({
    title: "🖼️ Reutilizar imagen",
    subtitle: "Elige una imagen que ya usaste en otro ejercicio.",
    searchPlaceholder: "Buscar por ejercicio…",
    renderList(list, q) {
      list.innerHTML = "";
      const rows = images.filter(img => !q || img.name.toLowerCase().includes(q));
      if (!rows.length) {
        list.appendChild(el("div", { class:"muted", text:"Sin resultados." }));
        return;
      }
      const grid = el("div", { class:"picker-grid" });
      rows.forEach(img => {
        const card = el("button", { class:"picker-image", type:"button", title:img.name }, [
          el("img", { src:img.url, alt:`Imagen de ${img.name}`, loading:"lazy" }),
          el("span", { text:img.name })
        ]);
        card.onclick = () => { closePicker(); onPick(img.url); toast("Imagen elegida", img.name, "ok"); };
        grid.appendChild(card);
      });
      list.appendChild(grid);
    }
  });
}

/* ---------------------------
   SEED ROUTINES
--------------------------- */
// Siembra rutinas predeterminadas UNA sola vez por cuenta.
// - Nunca sobreescribe rutinas existentes (locales o de la nube).
// - No vuelve a aparecer si el usuario las borra (se marca con un flag).
// - Lo que el usuario cree/edite/borre se respeta siempre.
function maybeSeedDefaultRoutines() {
  // Ya se sembró antes para esta cuenta → no tocar nada.
  if (Store.get(LS_KEYS.seededDefaults, false)) return false;

  // Ya hay rutinas (del usuario o sincronizadas) → marcar y respetar.
  if (State.routines.length > 0) {
    Store.set(LS_KEYS.seededDefaults, true);
    return false;
  }

  // Cuenta nueva y vacía → cargar las rutinas predeterminadas.
  State.routines = buildSeedRoutines(State.prefs.unit);
  ensurePrograms(); // asigna los días sembrados al programa por defecto
  State.routines.forEach(r => { if (!r.programId) r.programId = State.activeProgramId; });
  Store.set(LS_KEYS.seededDefaults, true);
  saveRoutines(); // persiste local + sincroniza a la nube
  savePrograms();
  return true;
}

/* ---------------------------
   NEW SESSION
--------------------------- */
function renderNewSession() {
  const sel = $("#sessionRoutineSelect");
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = `<option value="">Selecciona una rutina…</option>`;
    routinesInActiveProgram().forEach(r => {
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
  $("#btnWorkoutMode") && ($("#btnWorkoutMode").onclick = () => WorkoutMode.enter());

  sel && (sel.onchange = () => { renderSessionEquipment(); syncStartRoutineSelect(); });

  // Bloque de arranque directo (arriba de todo).
  syncStartRoutineSelect();
  const startSel = $("#startRoutineSelect");
  if (startSel) startSel.onchange = () => {
    if (!sel) return;
    sel.value = startSel.value;
    sel.dispatchEvent(new Event("change", { bubbles:true }));
  };
  $("#btnStartWorkout") && ($("#btnStartWorkout").onclick = () => quickStartWorkout());

  renderSessionEquipment();

  bindSessionAutosaveOnce();
  renderCardioSummary();
}

/* ---------------------------
   ARRANQUE DIRECTO DEL ENTRENAMIENTO
   Antes había que bajar hasta el final del formulario para encontrar el botón
   que de verdad empieza. Ahora un solo botón elige rutina, carga y arranca.
--------------------------- */

/* Rutina propuesta: la del borrador, si no la siguiente del programa tras la
   última sesión registrada, si no la primera. */
function defaultRoutineIdForToday() {
  const list = routinesInActiveProgram();
  if (!list.length) return "";

  const draftId = State.sessionDraft?.routineId;
  if (draftId && list.some(r => r.id === draftId)) return draftId;

  const last = State.sessions.slice().sort((a,b) => (a.date < b.date ? 1 : -1))[0];
  const idx = last ? list.findIndex(r => r.id === last.routineId) : -1;
  return idx >= 0 ? list[(idx + 1) % list.length].id : list[0].id;
}

/* Mantiene el selector grande de arriba y el del formulario en el mismo valor. */
function syncStartRoutineSelect() {
  const start = $("#startRoutineSelect");
  const form = $("#sessionRoutineSelect");
  if (!start || !form) return;

  start.innerHTML = "";
  $$("option", form).forEach(opt => start.appendChild(opt.cloneNode(true)));
  start.value = form.value || "";
}

function quickStartWorkout() {
  if (location.hash !== "#new-session") location.hash = "#new-session";

  // Esperamos a que la vista se pinte antes de tocar sus controles.
  setTimeout(() => {
    const sel = $("#sessionRoutineSelect");
    if (!sel) return;

    if (!sel.value) sel.value = defaultRoutineIdForToday();
    if (!sel.value) {
      toast("Elige una rutina", "Selecciona la plantilla que vas a entrenar.", "warn");
      $("#startRoutineSelect")?.focus();
      return;
    }
    syncStartRoutineSelect();

    const cards = $$(".exercise-card", $("#sessionExercises"));
    if (!cards.length) loadExercisesFromSelectedRoutine({ autoStart:true });
    else WorkoutMode.enter(clamp(Number(State.sessionDraft?.workoutIndex || 0), 0, cards.length - 1));
  }, 160);
}

function prefillNewSessionFromRoutine(routineId) {
  renderNewSession();
  $("#sessionRoutineSelect") && ($("#sessionRoutineSelect").value = routineId);
  $("#sessionDate") && ($("#sessionDate").value = todayISO());
  $("#sessionDuration") && ($("#sessionDuration").value = "");
  $("#sessionRPE") && ($("#sessionRPE").value = "");
  $("#sessionNotes") && ($("#sessionNotes").value = "");
  State.cardioDraft = null;
  renderCardioSummary();
  loadExercisesFromSelectedRoutine();
}

function exercisePrescription(ex) {
  const amount = ex.duration > 0
    ? `${fmtDurationLabel(ex.duration)} por serie`
    : (ex.reps ? `${ex.reps} repeticiones` : "");
  const weight = Number(ex.weight) > 0 ? `${ex.weight} ${ex.unit || State.prefs.unit}` : "";
  return [`${ex.sets || 1} series`, amount, weight].filter(Boolean).join(" · ");
}

function loadExercisesFromSelectedRoutine(options={}) {
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
    $(".exercise-card__hint", node).textContent = exercisePrescription(ex);

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
  decorateExerciseCards();

  setDraftSession(collectSessionDraftFromUI());
  toast("Ejercicios cargados", r.name, "ok");

  // Entramos directo al modo entrenamiento: en móvil siempre (se ve solo lo
  // necesario) y en escritorio cuando se pidió arrancar de una.
  if (options.autoStart || window.matchMedia("(max-width: 980px)").matches) {
    setTimeout(() => WorkoutMode.enter(0), 200);
  }
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
      ...card.exerciseData,
      ...($(".flexibility-tracker", card) ? { flexibilityProgress: readFlexibilityProgress(card) } : {}),
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
      $(".exercise-card__hint", node).textContent = exercisePrescription(ex);

      const inputs = $$("input", node);
      inputs[0] && (inputs[0].value = ex.sets ?? 0);
      inputs[1] && (inputs[1].value = ex.reps ?? "");
      inputs[2] && (inputs[2].value = ex.weight ?? 0);
      inputs[3] && (inputs[3].value = ex.notes ?? "");

      node.dataset.exerciseName = ex.name;
      node.dataset.duration = ex.duration ?? 0;
      node.dataset.rest = ex.rest ?? 0;
      node.dataset.restAfter = ex.restAfter ?? 0;
      node.dataset.imageUrl = cleanMediaUrl(ex.imageUrl || "");
      node.dataset.videoUrl = cleanMediaUrl(ex.videoUrl || "");
      attachExerciseMediaToCard(node, ex);
      wrap.appendChild(node);
    });

    empty.classList.add("is-hidden");
    wrap.classList.remove("is-hidden");
    decorateExerciseCards();
  } else {
    empty.classList.remove("is-hidden");
    wrap.classList.add("is-hidden");
  }
}

function resetSessionUI() {
  if (typeof WorkoutMode !== "undefined" && WorkoutMode.active) WorkoutMode.exit();
  $("#sessionRoutineSelect") && ($("#sessionRoutineSelect").value = "");
  $("#sessionDate") && ($("#sessionDate").value = todayISO());
  $("#sessionDuration") && ($("#sessionDuration").value = "");
  $("#weightUnit") && ($("#weightUnit").value = State.prefs.unit);
  $("#sessionRPE") && ($("#sessionRPE").value = "");
  $("#sessionNotes") && ($("#sessionNotes").value = "");

  State.cardioDraft = null;
  State.cardioListDraft = [];
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
    // Nota: no auto-enfocamos inputs al tocar la tarjeta. En móvil eso abría el
    // teclado al marcar una serie como completada (los spans dentro del botón
    // se escapaban del filtro). Los campos se tocan directamente cuando se necesitan.
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
    toast("Sesión guardada 🎯", `${prDetected.count} nueva(s) marca(s) personal(es).`, "ok");
  } else {
    toast("Sesión guardada", `${draft.routineName} • ${formatDate(s.date, State.prefs)}`, "ok");
  }

  // ¿Se cerró el ciclo del programa? Proponer sobrecarga progresiva.
  await maybeOfferProgression(s);

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
    prList.appendChild(el("div", { class:"muted", text:"Tus mejores marcas aparecerán al registrar sesiones." }));
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
            toast("Ejercicio destacado", name, "ok");
            scheduleRender();
          }
        }, [ "Destacar ejercicio" ])
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
      toast("Copia recuperada", "Ya puedes ver las rutinas y sesiones de esa copia.", "ok");
      scheduleRender();
    } catch (e) {
      toast("No pudimos abrir la copia", "Elige un archivo que hayas descargado desde GymOS.", "bad");
      console.error(e);
    }
  };
  reader.readAsText(file);
}

async function resetAllData() {
  const ok = await confirmDialog({
    title: "Reiniciar TODO",
    text: "Se borrarán de tu cuenta las rutinas, sesiones, objetivos y preferencias de forma permanente.",
    yesText: "Borrar todo",
    noText: "Cancelar"
  });
  if (!ok) return;
  if (!firebaseBootstrapped) {
    updateFirebaseStatus("En línea", "Conéctate a internet para borrar los datos de tu cuenta.", "warn");
    toast("Necesitas conexión a internet", "No se reinició porque la nube no está conectada.", "warn");
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
    toast("No se borraron tus datos", "Revisa conexión o reglas antes de continuar.", "warn");
    return;
  }
  toast("Reiniciado", "Se borraron las rutinas, sesiones, objetivos y preferencias de tu cuenta.", "ok");
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
    const cardio7 = sessions7.reduce((acc, s) => acc + sessionCardios(s).reduce((n,c) => n + Number(c.minutes || 0), 0), 0);
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
  renderCardioList();
}

/* --------------------------- CARDIO VISUAL + TIMER --------------------------- */
function buildCardioCard(c, index = -1) {
  const image = c.imageUrl
    ? el("img", { class:"cardio-card__img", src:c.imageUrl, alt:`Cardio ${c.machine}`, loading:"lazy" })
    : el("span", { class:"cardio-card__fallback-icon", text:"❤️" });
  const card = el("article", { class:"cardio-card" }, [
    el("div", { class:"cardio-card__image-container" }, [image]),
    el("div", { class:"cardio-card__info" }, [
      el("div", { class:"cardio-card__machine" }, [
        el("span", { text:c.machine || "Cardio" }),
        el("span", { class:`badge-intensity badge-intensity--${String(c.intensity || "suave").toLowerCase()}`, text:c.intensity || "Suave" })
      ]),
      el("div", { class:"cardio-card__meta", text:`${Number(c.minutes || 0)} minutos` }),
      c.notes ? el("div", { class:"cardio-card__notes", text:c.notes }) : el("span")
    ])
  ]);
  if (index >= 0) card.appendChild(el("button", { class:"icon-btn", type:"button", title:"Editar cardio", "aria-label":"Editar cardio", text:"✏️", onclick:() => openCardioModal(index) }));
  return card;
}

function renderCardioList() {
  const wrap = $("#sessionCardioList");
  if (!wrap) return;
  wrap.innerHTML = "";
  const list = State.cardioListDraft?.length ? State.cardioListDraft : (State.cardioDraft ? [State.cardioDraft] : []);
  State.cardioListDraft = list;
  State.cardioDraft = list[0] || null;
  if (!list.length) {
    wrap.appendChild(el("div", { id:"cardioSummary", class:"muted", text:"Aún no has agregado cardio." }));
    return;
  }
  list.forEach((c, i) => wrap.appendChild(buildCardioCard(c, i)));
}

/* --------------------------- ACTIVIDADES DE CARDIO ---------------------------
   Lista editable: opciones por defecto + actividades personalizadas del usuario.
   Las personalizadas se guardan en prefs (localStorage + Firebase) para que
   aparezcan siempre y en todos sus dispositivos. */
const CARDIO_DEFAULT_ACTIVITIES = [
  "Caminadora", "Elíptica", "Spinning", "Escaladora", "Bicicleta",
  "Trotar / Correr", "Saltar cuerda", "Natación", "Remo", "Baile / Zumba"
];

function customCardioActivities() {
  return Array.isArray(State.prefs.cardioActivities) ? State.prefs.cardioActivities : [];
}

function allCardioActivities() {
  const seen = new Set();
  const out = [];
  [...CARDIO_DEFAULT_ACTIVITIES, ...customCardioActivities()].forEach(name => {
    const key = String(name).trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(String(name).trim());
  });
  return out;
}

function addCustomCardioActivity(name) {
  const clean = String(name || "").trim();
  if (!clean) return false;
  if (allCardioActivities().some(n => n.toLowerCase() === clean.toLowerCase())) return true;
  State.prefs.cardioActivities = [...customCardioActivities(), clean];
  savePrefs();
  toast("Actividad agregada", `"${clean}" quedó guardada en tu lista de cardios.`, "ok");
  return true;
}

function removeCustomCardioActivity(name) {
  State.prefs.cardioActivities = customCardioActivities().filter(n => n !== name);
  savePrefs();
}

function populateCardioActivitySelect(selected = "") {
  const sel = $("#cardioMachine");
  if (!sel) return;
  sel.innerHTML = "";
  sel.appendChild(el("option", { value:"", text:"Selecciona…" }));
  const activities = allCardioActivities();
  // Datos antiguos (p. ej. "Otra") siguen siendo seleccionables
  if (selected && !activities.some(n => n.toLowerCase() === String(selected).toLowerCase())) {
    activities.push(String(selected));
  }
  activities.forEach(n => sel.appendChild(el("option", { value:n, text:n })));
  sel.appendChild(el("option", { value:"__add__", text:"➕ Agregar otra actividad…" }));
  sel.value = selected || "";
  sel.dataset.prev = sel.value;
}

function renderCardioCustomChips() {
  const box = $("#cardioCustomList");
  if (!box) return;
  const customs = customCardioActivities();
  box.innerHTML = "";
  if (!customs.length) { box.classList.add("is-hidden"); return; }
  box.classList.remove("is-hidden");
  box.appendChild(el("span", { class:"muted cardio-custom-list__label", text:"Tus actividades:" }));
  customs.forEach(n => {
    box.appendChild(el("span", { class:"cardio-chip" }, [
      n,
      el("button", {
        class:"cardio-chip__del", type:"button",
        title:`Quitar "${n}" de la lista`, "aria-label":`Quitar ${n} de la lista`,
        onclick: () => {
          removeCustomCardioActivity(n);
          const sel = $("#cardioMachine");
          populateCardioActivitySelect(sel && sel.value === n ? "" : (sel?.value || ""));
          renderCardioCustomChips();
        }
      }, ["✕"])
    ]));
  });
}

function bindCardioActivitySelect() {
  const sel = $("#cardioMachine");
  if (!sel) return;
  sel.onchange = () => {
    if (sel.value !== "__add__") { sel.dataset.prev = sel.value; return; }
    const name = (window.prompt("Nombre de la actividad de cardio (ej. Fútbol, Senderismo, Boxeo…):", "") || "").trim();
    if (!name) { sel.value = sel.dataset.prev || ""; return; }
    addCustomCardioActivity(name);
    populateCardioActivitySelect(name);
    renderCardioCustomChips();
  };
}

function setupCardioModal(index = -1) {
  State.cardioEditIndex = index;
  const current = index >= 0 ? State.cardioListDraft[index] : null;
  populateCardioActivitySelect(current?.machine || "");
  renderCardioCustomChips();
  bindCardioActivitySelect();
  $("#cardioMinutes").value = current?.minutes ?? "";
  $("#cardioIntensity").value = current?.intensity || "Suave";
  $("#cardioNotes").value = current?.notes || "";
  $("#cardioImageUrl").value = current?.imageUrl || "";
  $("#btnDeleteCardio").hidden = index < 0;
  $("#btnUploadCardioImage").onclick = () => $("#cardioImageFile").click();
  $("#cardioImageFile").onchange = async () => {
    const file = $("#cardioImageFile").files?.[0];
    if (!file) return;
    await uploadExerciseImageForRow(null, file, $("#cardioImageUrl"), $("#cardioMachine"));
    $("#cardioImageFile").value = "";
  };
  $("#btnSaveCardio").onclick = () => {
    const machineVal = $("#cardioMachine").value;
    const cardio = {
      machine: machineVal === "__add__" ? "" : (machineVal || ""),
      minutes: Number($("#cardioMinutes").value || 0),
      intensity: $("#cardioIntensity").value || "",
      notes: $("#cardioNotes").value || "",
      imageUrl: cleanMediaUrl($("#cardioImageUrl").value)
    };
    if (!cardio.machine || cardio.minutes <= 0) return toast("Cardio incompleto", "Elige la actividad y los minutos (>0).", "warn");
    if (index >= 0) State.cardioListDraft[index] = cardio; else State.cardioListDraft.push(cardio);
    State.cardioDraft = State.cardioListDraft[0] || null;
    renderCardioList();
    setDraftSession(collectSessionDraftFromUI());
    closeModal("#modalCardio");
    toast("Cardio guardado", `${cardio.machine} • ${cardio.minutes} min`, "ok");
  };
  $("#btnDeleteCardio").onclick = async () => {
    if (index < 0) return;
    if (!await confirmDialog({ title:"Quitar cardio", text:"¿Eliminar este cardio de la sesión?", yesText:"Quitar", noText:"Cancelar" })) return;
    State.cardioListDraft.splice(index, 1);
    State.cardioDraft = State.cardioListDraft[0] || null;
    renderCardioList();
    setDraftSession(collectSessionDraftFromUI());
    closeModal("#modalCardio");
  };
  openModal("#modalCardio");
}

openCardioModal = setupCardioModal;

/* Avisos del temporizador. Entrenando con música o con el celular en el bolsillo
   un pitido suave no se oye, así que las alertas son fuertes (onda cuadrada,
   varios tonos encadenados) y además vibran. El volumen sale de Ajustes. */
const TimerSounds = {
  context:null,

  ctx() {
    this.context ||= new (window.AudioContext || window.webkitAudioContext)();
    // Android suspende el audio al volver de segundo plano: sin esto el pitido se pierde.
    if (this.context.state === "suspended") this.context.resume().catch(()=>{});
    return this.context;
  },

  get level() { return clamp(Number(State.prefs.alertVolume ?? 85), 0, 100) / 100; },

  tone(frequency=660, duration=.18, { type="square", delay=0, gain=1 }={}) {
    try {
      const ctx = this.ctx();
      const peak = Math.max(.0001, this.level * .6 * gain);
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      amp.gain.setValueAtTime(.0001, t0);
      amp.gain.exponentialRampToValueAtTime(peak, t0 + .012);
      amp.gain.exponentialRampToValueAtTime(.0001, t0 + duration);
      osc.connect(amp).connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + duration + .02);
    } catch {}
  },

  buzz(pattern) {
    if (State.prefs.vibrate === "off") return;
    try { navigator.vibrate?.(pattern); } catch {}
  },

  /* Tic de cuenta regresiva (últimos segundos). */
  tick() { this.tone(880, .14); this.buzz(45); },

  /* Último tic antes de arrancar: más agudo, para distinguirlo. */
  go() { this.tone(1320, .35, { gain:1.25 }); this.buzz(220); },

  /* Cambio de ejercicio / fin de descanso: lo que hay que oír sí o sí. */
  alert() {
    [0, .26, .52].forEach(d => this.tone(988, .3, { delay:d, gain:1.25 }));
    this.buzz([200,90,200,90,380]);
  },

  success() {
    [523,659,784,1047].forEach((f,i) => this.tone(f, .3, { delay:i*.14, gain:1.1 }));
    this.buzz([120,70,120,70,260]);
  }
};

/* Los navegadores solo dejan sonar audio tras un gesto del usuario: en el primer
   toque despertamos el AudioContext para que el primer pitido no salga mudo. */
["pointerdown","keydown"].forEach(evt =>
  document.addEventListener(evt, () => { try { TimerSounds.ctx(); } catch {} }, { once:true })
);

/* Mensajes de coach: acompañan cada fase del temporizador */
const CoachMessages = {
  exercise: [
    "¡Tú puedes! 💪",
    "Controla el movimiento, respira.",
    "¡Dale con todo, campeón!",
    "Técnica primero, el resto llega solo.",
    "Cada segundo cuenta. ¡Aguanta!",
    "Enfócate: solo tú y el ejercicio.",
    "¡Fuerte! Tu yo del futuro te lo agradece."
  ],
  restAfter: [
    "Ejercicio listo. Recupera antes del siguiente.",
    "Respira, hidrátate y prepárate para lo que viene.",
    "Descanso ganado. El siguiente ejercicio te espera.",
    "Afloja los músculos, ya casi seguimos."
  ],
  rest: [
    "Respira profundo… recupera.",
    "Hidrátate, ya casi viene la siguiente.",
    "Sacude los músculos, afloja.",
    "Buen trabajo. Ahora descansa de verdad.",
    "Prepárate mentalmente para la siguiente serie."
  ],
  prepare: [
    "Colócate y respira. ¡Ya arrancamos!",
    "Toma posición… empezamos en nada.",
    "Prepárate: postura lista, mirada al frente.",
    "Acomódate, que esto ya empieza."
  ],
  done: [
    "¡Ejercicio completado! 🔥",
    "¡Eso es disciplina pura! 💪",
    "¡Brutal! Siguiente ejercicio te espera.",
    "Hecho. Tu constancia está ganando.",
    "¡Completado! Así se construye el progreso."
  ],
  pick(type) {
    const list = this[type] || this.exercise;
    return list[Math.floor(Math.random() * list.length)];
  }
};

const GymTimer = {
  interval:null, remaining:0, total:0, paused:false, mode:"exercise", rest:0, restAfter:0, title:"",
  sets:1, currentSet:1, exerciseSeconds:0, coachMsg:"", _endTimer:null, _pending:null,

  /* Ciclo con series: ejercicio (serie 1) → descanso → ejercicio (serie 2) → … →
     descanso entre ejercicios (restAfter) → siguiente ejercicio.
     `sets` = número de series; `set` = serie actual (interno, para encadenar fases). */
  start(seconds, opts={}) {
    const { mode="exercise", title="Ejercicio", rest=0, restAfter=0, sets=1, set=1 } = opts;

    // Antes de cada ejercicio va una cuenta regresiva para alistarse y empezar a
    // tiempo. Se salta si el usuario la desactivó en Ajustes.
    const pre = Math.max(0, Number(State.prefs.countdown ?? 0));
    if (mode==="exercise" && pre>0 && !opts._prepared) {
      this._pending = { seconds, opts:{ ...opts, _prepared:true } };
      return this.start(pre, { ...opts, mode:"prepare", _prepared:true, title });
    }

    this.stop(false); clearTimeout(this._endTimer);
    this.remaining=this.total=Math.max(1,Number(seconds)); this.mode=mode; this.rest=Number(rest||0); this.title=title; this.paused=false;
    this.restAfter=Math.max(0,Number(restAfter||0));
    this.sets=Math.max(1,Number(sets||1)); this.currentSet=clamp(Number(set||1),1,this.sets);
    if (mode==="exercise") this.exerciseSeconds=this.total;
    this.coachMsg=CoachMessages.pick(
      mode==="prepare" ? "prepare" : mode==="exercise" ? "exercise" : mode==="restAfter" ? "restAfter" : "rest"
    );
    $("#floating-timer")?.classList.remove("is-hidden"); this.bind(); this.paint();
    if (mode==="prepare") TimerSounds.tick();
    this.interval=setInterval(() => {
      if (this.paused) return;
      this.remaining--;
      // En la cuenta regresiva suena cada segundo; en el resto, solo los últimos 3.
      if (this.remaining>0 && (this.mode==="prepare" || this.remaining<=3)) TimerSounds.tick();
      this.paint();
      if (this.remaining<=0) this.finish();
    },1000);
  },

  finish() {
    clearInterval(this.interval);
    const opts = { title:this.title, rest:this.rest, restAfter:this.restAfter, sets:this.sets };

    // Fin de la cuenta regresiva: arranca el ejercicio que estaba en espera.
    if (this.mode==="prepare") {
      const pending = this._pending; this._pending = null;
      TimerSounds.go();
      if (pending) this._endTimer = setTimeout(() => this.start(pending.seconds, pending.opts), 250);
      else this.stop();
      return;
    }

    if (this.mode==="restAfter") { this.endRestAfter(); return; }
    if (this.mode==="exercise") {
      if (this.currentSet < this.sets) {
        TimerSounds.success();
        if (this.rest>0) this._endTimer = setTimeout(() => this.start(this.rest,{ ...opts, mode:"rest", set:this.currentSet }),350);
        else this._endTimer = setTimeout(() => this.start(this.exerciseSeconds,{ ...opts, mode:"exercise", set:this.currentSet+1 }),350);
      } else {
        this.complete();
      }
    } else {
      // Terminó un descanso
      if (this.currentSet < this.sets) {
        TimerSounds.alert();
        this._endTimer = setTimeout(() => this.start(this.exerciseSeconds||this.total,{ ...opts, mode:"exercise", set:this.currentSet+1 }),350);
      } else {
        this.endRest();
      }
    }
  },

  /* Todas las series completadas */
  complete() {
    TimerSounds.success();
    this.coachMsg = CoachMessages.pick("done");
    $("#timer-status") && ($("#timer-status").textContent="¡COMPLETADO!");
    $("#timer-display") && ($("#timer-display").textContent="🎉");
    $("#timer-progress-fill") && ($("#timer-progress-fill").style.width="100%");
    $("#timer-coach") && ($("#timer-coach").textContent=this.coachMsg);
    clearTimeout(this._endTimer);

    // Descanso entre ejercicios antes de pasar al siguiente.
    if (this.restAfter > 0) {
      const seconds = this.restAfter, title = this.title;
      this._endTimer = setTimeout(() => this.start(seconds, { mode:"restAfter", title:`${title} · descanso`, rest:0, restAfter:0, sets:1 }), 1400);
      return;
    }

    this._endTimer = setTimeout(() => {
      if (WorkoutMode.active) WorkoutMode.next();
      else this.stop();
    }, 2200);
  },

  /* Terminó el descanso entre ejercicios → avanza al siguiente */
  endRestAfter() {
    TimerSounds.alert();
    $("#timer-status") && ($("#timer-status").textContent="¡A POR EL SIGUIENTE!");
    $("#timer-display") && ($("#timer-display").textContent="💪");
    $("#timer-progress-fill") && ($("#timer-progress-fill").style.width="100%");
    $("#timer-coach") && ($("#timer-coach").textContent="Descanso terminado. Siguiente ejercicio.");
    clearTimeout(this._endTimer);
    this._endTimer = setTimeout(() => {
      if (WorkoutMode.active) WorkoutMode.next();
      else this.stop();
    }, 1400);
  },

  /* Descanso suelto (p. ej. tras marcar una serie manual) */
  endRest() {
    TimerSounds.alert();
    $("#timer-status") && ($("#timer-status").textContent="¡DESCANSO TERMINADO!");
    $("#timer-display") && ($("#timer-display").textContent="💪");
    $("#timer-coach") && ($("#timer-coach").textContent="¡Vamos con la siguiente serie!");
    clearTimeout(this._endTimer);
    this._endTimer = setTimeout(() => this.stop(), 1800);
  },

  stop(hide=true) {
    clearInterval(this.interval); this.interval=null;
    if (hide) {
      clearTimeout(this._endTimer);
      this._pending = null;   // cerrar el temporizador cancela el ejercicio en espera
      $("#floating-timer")?.classList.remove("is-prepare");
      $("#floating-timer")?.classList.add("is-hidden");
    }
  },

  paint() {
    const multi = this.sets>1;
    const prep = this.mode==="prepare";
    $("#timer-title").textContent = multi ? `${this.title} · Serie ${this.currentSet} de ${this.sets}` : this.title;
    $("#timer-status").textContent = prep
      ? "PREPÁRATE…"
      : this.mode==="restAfter"
        ? "DESCANSO · VIENE EL SIGUIENTE EJERCICIO"
        : this.mode==="rest"
          ? (multi ? `DESCANSO · VIENE SERIE ${this.currentSet+1}` : "DESCANSO")
          : (multi ? `SERIE ${this.currentSet} · EJERCICIO` : "EJERCICIO");
    $("#floating-timer")?.classList.toggle("is-prepare", prep);
    $("#timer-display").textContent = prep
      ? String(this.remaining)
      : `${String(Math.floor(this.remaining/60)).padStart(2,"0")}:${String(this.remaining%60).padStart(2,"0")}`;
    $("#timer-progress-fill").style.width=`${Math.max(0,(this.remaining/this.total)*100)}%`;
    $("#btn-timer-play").textContent=this.paused?"▶️ Continuar":"⏸️ Pausa";
    $("#timer-coach") && ($("#timer-coach").textContent=this.coachMsg||"");
  },

  bind() {
    $("#btn-timer-play").onclick=()=>{this.paused=!this.paused;this.paint();};
    $("#btn-timer-skip").onclick=()=>this.finish();
    $("#btn-timer-reset").onclick=()=>{this.remaining=this.total;this.paused=false;this.paint();};
    $("#btn-close-timer").onclick=()=>this.stop();
  }
};

/* --------------------------- MÚSICA ---------------------------
   Reproductor propio con las pistas de ./music. Se ofrece al entrar al modo
   entrenamiento (según preferencia) y se puede controlar en cualquier momento
   desde la barra flotante. La reproducción siempre arranca por un gesto del
   usuario, así los navegadores no la bloquean. */
const MusicPlayer = {
  audio: null,
  order: [],        // índices de MUSIC_TRACKS en el orden de reproducción
  pos: 0,           // posición dentro de `order`
  asked: false,     // ya se preguntó en esta sesión de entrenamiento
  _bound: false,

  get track() { return MUSIC_TRACKS[this.order[this.pos]] || null; },

  init() {
    if (this.audio) return;
    this.audio = new Audio();
    this.audio.preload = "none";
    this.audio.volume = clamp(Number(State.prefs.musicVolume ?? 60), 0, 100) / 100;
    this.buildOrder();
    this.audio.addEventListener("ended", () => this.next(true));
    this.audio.addEventListener("timeupdate", () => this.paintProgress());
    this.audio.addEventListener("loadedmetadata", () => this.paintProgress());
    this.audio.addEventListener("play", () => this.paint());
    this.audio.addEventListener("pause", () => this.paint());
    this.audio.addEventListener("error", () => {
      toast("No se pudo reproducir", this.track?.title || "Pista no encontrada", "warn");
    });
    this.bindUI();
  },

  buildOrder() {
    const idx = MUSIC_TRACKS.map((_, i) => i);
    if (State.prefs.musicShuffle) {
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
    }
    this.order = idx;
    this.pos = 0;
  },

  show() { $("#music-player")?.classList.remove("is-hidden"); this.paint(); },
  hide() { $("#music-player")?.classList.add("is-hidden"); },

  load(pos, autoplay=true) {
    this.init();
    if (!MUSIC_TRACKS.length) return;
    this.pos = ((pos % this.order.length) + this.order.length) % this.order.length;
    this.audio.src = encodeURI(this.track.src);
    this.show();
    if (autoplay) this.play();
    else this.paint();
  },

  play() {
    this.init();
    if (!this.audio.src) { this.load(this.pos, true); return; }
    this.audio.play().catch(() => {
      toast("Música en pausa", "Toca ▶️ para iniciar la reproducción.", "warn");
    });
    this.show();
  },

  pause() { this.audio?.pause(); },

  toggle() {
    this.init();
    if (!this.audio.src) { this.load(this.pos, true); return; }
    if (this.audio.paused) this.play(); else this.pause();
  },

  next(auto=false) { this.init(); this.load(this.pos + 1, auto || !this.audio.paused); },
  prev() {
    this.init();
    // Si ya avanzó más de 3s, reinicia la pista actual (como cualquier reproductor).
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    this.load(this.pos - 1, !this.audio.paused);
  },

  stop() {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
  },

  setVolume(v) {
    this.init();
    const vol = clamp(Number(v || 0), 0, 100);
    this.audio.volume = vol / 100;
    State.prefs.musicVolume = vol;
    savePrefs();
    const slider = $("#musicVolume"); if (slider && Number(slider.value) !== vol) slider.value = vol;
    const pref = $("#prefMusicVolume"); if (pref && Number(pref.value) !== vol) pref.value = vol;
  },

  toggleShuffle() {
    State.prefs.musicShuffle = !State.prefs.musicShuffle;
    savePrefs();
    const playing = this.track;
    this.buildOrder();
    // Mantener sonando la pista actual tras reordenar.
    if (playing) {
      const at = this.order.indexOf(MUSIC_TRACKS.indexOf(playing));
      if (at >= 0) this.pos = at;
    }
    this.paint();
    toast("Orden de pistas", State.prefs.musicShuffle ? "Aleatorio activado." : "Orden fijo.", "ok");
  },

  paint() {
    const bar = $("#music-player");
    if (!bar) return;
    const playing = this.audio && !this.audio.paused && this.audio.src;
    $("#btnMusicToggle") && ($("#btnMusicToggle").textContent = playing ? "⏸️" : "▶️");
    $("#btnMusicTrack") && ($("#btnMusicTrack").textContent = `🎵 ${this.track?.title || "Sin música"}`);
    $("#btnMusicShuffle")?.classList.toggle("is-active", !!State.prefs.musicShuffle);
    const slider = $("#musicVolume");
    if (slider) slider.value = Math.round((this.audio?.volume ?? 0.6) * 100);
    bar.classList.toggle("is-playing", !!playing);
  },

  paintProgress() {
    const a = this.audio;
    if (!a) return;
    const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
    const dur = isFinite(a.duration) ? a.duration : 0;
    $("#musicTime") && ($("#musicTime").textContent = `${fmt(a.currentTime||0)} / ${dur ? fmt(dur) : "--:--"}`);
    const fill = $("#musicProgressFill");
    if (fill) fill.style.width = dur ? `${(a.currentTime / dur) * 100}%` : "0%";
  },

  bindUI() {
    if (this._bound) return;
    this._bound = true;
    $("#btnMusicToggle")?.addEventListener("click", () => this.toggle());
    $("#btnMusicNext")?.addEventListener("click", () => this.next());
    $("#btnMusicPrev")?.addEventListener("click", () => this.prev());
    $("#btnMusicShuffle")?.addEventListener("click", () => this.toggleShuffle());
    $("#btnMusicClose")?.addEventListener("click", () => { this.stop(); this.hide(); });
    $("#musicVolume")?.addEventListener("input", e => this.setVolume(e.target.value));
    $("#btnMusicTrack")?.addEventListener("click", () => this.openTrackPicker());
    $("#music-player .music-player__progress")?.addEventListener("click", e => {
      const a = this.audio;
      if (!a || !isFinite(a.duration)) return;
      const box = e.currentTarget.getBoundingClientRect();
      a.currentTime = ((e.clientX - box.left) / box.width) * a.duration;
    });
  },

  openTrackPicker() {
    this.init();
    openPicker({
      title: "🎵 Elegir pista",
      subtitle: "Música incluida en GymOS.",
      searchPlaceholder: "Buscar pista…",
      renderList: (list, q) => {
        list.innerHTML = "";
        MUSIC_TRACKS.forEach((t, i) => {
          if (q && !t.title.toLowerCase().includes(q)) return;
          const isCurrent = this.track && this.track.src === t.src;
          const item = el("button", { class:`picker-item${isCurrent ? " is-selected" : ""}`, type:"button" }, [
            el("span", { class:"picker-item__copy" }, [
              el("strong", { text: t.title }),
              el("span", { class:"muted", text: isCurrent ? "Sonando ahora" : "Toca para reproducir" })
            ]),
            el("span", { class:"picker-item__check", text:"▶" })
          ]);
          item.onclick = () => {
            closePicker();
            const at = this.order.indexOf(i);
            this.load(at >= 0 ? at : 0, true);
          };
          list.appendChild(item);
        });
      }
    });
  },

  /* Se llama al entrar al modo entrenamiento. */
  async offerOnWorkoutStart() {
    const mode = State.prefs.music || "ask";
    if (mode === "never" || !MUSIC_TRACKS.length) return;
    this.init();

    if (mode === "always") { this.load(this.pos, true); return; }
    if (this.asked) return;
    this.asked = true;

    const ok = await confirmDialog({
      title: "🎵 ¿Ponemos música?",
      text: `Tenemos ${MUSIC_TRACKS.length} pistas para entrenar. Puedes pausarla o cambiarla cuando quieras desde la barra del reproductor.`,
      yesText: "Sí, dale música",
      noText: "Entrenar en silencio"
    });
    if (ok) this.load(this.pos, true);
  }
};

/* --------------------------- MODO ENTRENAMIENTO ---------------------------
   Overlay a pantalla completa que muestra un ejercicio a la vez.
   Mueve el contenedor #sessionExercises completo dentro del overlay para
   conservar valores de inputs, series marcadas y listeners; al salir lo
   devuelve a su lugar original. */
const WorkoutMode = {
  active: false,
  index: 0,
  homeParent: null,
  homeNext: null,
  _bound: false,

  cards() { return $$(".exercise-card", $("#sessionExercises")); },

  enter(startIndex = 0) {
    const wrap = $("#sessionExercises");
    const overlay = $("#workout-mode");
    const body = $("#workoutBody");
    if (!wrap || !overlay || !body) return;
    if (!this.cards().length) {
      toast("Sin ejercicios", "Carga una rutina para entrar al modo entrenamiento.", "warn");
      return;
    }

    if (!this.active) {
      this.homeParent = wrap.parentElement;
      this.homeNext = wrap.nextSibling;
      body.appendChild(wrap);
      wrap.classList.add("is-workout");
      overlay.classList.remove("is-hidden");
      document.body.classList.add("workout-open");
      this.active = true;
    }
    this.bindOnce();

    const routine = State.routines.find(r => r.id === $("#sessionRoutineSelect")?.value);
    $("#workoutRoutineName") && ($("#workoutRoutineName").textContent = routine?.name || "Entrenamiento");
    this.go(startIndex);

    // Música: se ofrece (o arranca sola) al iniciar el entrenamiento.
    MusicPlayer.offerOnWorkoutStart();
  },

  exit() {
    if (!this.active) return;
    GymTimer.stop();
    const wrap = $("#sessionExercises");
    if (wrap) {
      wrap.classList.remove("is-workout");
      $$(".exercise-card", wrap).forEach(c => c.classList.remove("is-current"));
      if (this.homeParent) this.homeParent.insertBefore(wrap, this.homeNext);
    }
    $("#workout-mode")?.classList.add("is-hidden");
    document.body.classList.remove("workout-open");
    this.active = false;
    this.askedMusicReset();
  },

  // Al salir se para la música y se vuelve a preguntar en el próximo entrenamiento.
  askedMusicReset() {
    MusicPlayer.asked = false;
    if (MusicPlayer.audio && !MusicPlayer.audio.paused) {
      MusicPlayer.stop();
      MusicPlayer.hide();
    }
  },

  go(i) {
    GymTimer.stop();
    const cards = this.cards();
    if (!cards.length) { this.exit(); return; }
    this.index = clamp(i, 0, cards.length - 1);
    cards.forEach((c, k) => c.classList.toggle("is-current", k === this.index));

    $("#workoutCounter") && ($("#workoutCounter").textContent = `Ejercicio ${this.index + 1} de ${cards.length}`);
    const fill = $("#workoutProgressFill");
    if (fill) fill.style.width = `${((this.index + 1) / cards.length) * 100}%`;

    const prev = $("#btnWorkoutPrev");
    if (prev) prev.disabled = this.index === 0;
    const next = $("#btnWorkoutNext");
    if (next) {
      const isLast = this.index === cards.length - 1;
      next.textContent = isLast ? "✓ Finalizar" : "Siguiente ›";
      next.classList.toggle("btn--finish", isLast);
    }

    const body = $("#workoutBody");
    if (body) body.scrollTop = 0;

    // Recordamos en qué ejercicio va por si se cierra la app.
    saveWorkoutProgress();
    // Cada tarjeta por tiempo inicia sus series y descansos al mostrarse.
    $(".exercise-action--timer button", cards[this.index])?.click();
  },

  next() {
    if (!this.active) return;
    if (this.index >= this.cards().length - 1) this.finish();
    else this.go(this.index + 1);
  },

  async finish() {
    GymTimer.stop();
    const ok = await confirmDialog({
      title: "Terminar entrenamiento",
      text: "¿Guardar la sesión ahora? Podrás revisar cardio y notas antes si eliges seguir editando.",
      yesText: "Guardar sesión",
      noText: "Seguir editando"
    });
    this.exit();
    if (ok) saveSessionFromUI();
  },

  bindOnce() {
    if (this._bound) return;
    this._bound = true;
    $("#btnExitWorkout")?.addEventListener("click", () => this.exit());
    $("#btnWorkoutPrev")?.addEventListener("click", () => this.go(this.index - 1));
    $("#btnWorkoutNext")?.addEventListener("click", () => this.next());
    $("#btnWorkoutCardio")?.addEventListener("click", () => openCardioModal());
    $("#btnWorkoutMusic")?.addEventListener("click", () => {
      MusicPlayer.init();
      // Si nunca sonó, arranca; si ya hay pista, muestra el reproductor y alterna.
      if (!MusicPlayer.audio.src) MusicPlayer.load(MusicPlayer.pos, true);
      else { MusicPlayer.show(); MusicPlayer.toggle(); }
    });
  }
};

function decorateExerciseCards() {
  renderSessionEquipment();
  const routine = State.routines.find(r => r.id === $("#sessionRoutineSelect")?.value);
  $$(".exercise-card", $("#sessionExercises")).forEach(card => {
    if (card.dataset.timerReady) return;
    const ex = card.exerciseData || routine?.exercises?.find(x => x.name === card.dataset.exerciseName) || {};
    const duration = Number(card.dataset.duration ?? ex.duration ?? 0);
    const rest = Number(card.dataset.rest ?? ex.rest ?? 0);
    const restAfter = Number(card.dataset.restAfter ?? ex.restAfter ?? 0);
    card.dataset.duration=duration; card.dataset.rest=rest; card.dataset.restAfter=restAfter; card.dataset.timerReady="1";
    const box=$(".exercise-card__timer-box",card); if(!box) return;
    if(duration>0) {
      const setsCount = Math.max(1, Number(ex.sets || $$("input",card)[0]?.value || 1));
      const copyMain = setsCount>1
        ? `Ejercicio por tiempo · ${setsCount} series de ${duration} segundos`
        : `Ejercicio por tiempo · ${duration} segundos`;
      const copyHint = setsCount>1
        ? (rest>0 ? `Descanso de ${rest} segundos entre series. El temporizador encadena todo solo.` : `El temporizador pasará solo a la siguiente serie.`)
        : (rest>0 ? `Al terminar comenzará un descanso de ${rest} segundos.` : "Pulsa iniciar cuando estés listo.");
      const copyAfter = restAfter>0
        ? `Al completar todas las series habrá ${restAfter} segundos de descanso antes del siguiente ejercicio.`
        : "";
      box.appendChild(el("div",{class:"exercise-action exercise-action--timer"},[
        el("div",{class:"exercise-action__copy"},[
          el("strong",{text:copyMain}),
          el("span",{text:copyHint}),
          ...(copyAfter ? [el("span",{text:copyAfter})] : [])
        ]),
        el("button",{class:"btn btn--primary",type:"button",text:`▶ Iniciar ejercicio`,onclick:()=>GymTimer.start(duration,{title:ex.name||card.dataset.exerciseName,rest,restAfter,sets:setsCount})})
      ]));
    }
    else {
      const sets=Math.max(0,Number(ex.sets||$$("input",card)[0]?.value||0)); if(!sets) return;
      const badges=el("div",{class:"set-tracker__badges"});
      const status=el("div",{class:"set-tracker__status",text:`0 de ${sets} series completadas`});
      for(let i=1;i<=sets;i++) badges.appendChild(el("button",{class:"btn-set-badge",type:"button","aria-label":`Marcar serie ${i} como completada`,onclick:(e)=>{
        e.currentTarget.classList.toggle("is-completed");
        e.currentTarget.querySelector(".btn-set-badge__state").textContent =
          e.currentTarget.classList.contains("is-completed") ? "✓ Completada" : "Toca para completar";
        const done=$$(".btn-set-badge.is-completed",box).length;
        status.textContent=`${done} de ${sets} series completadas`;
        // Marcar una serie es un click, no un `input`: el autoguardado normal no
        // se entera, así que guardamos aquí para no perder el avance.
        saveWorkoutProgress();
        if(done===sets) {
          TimerSounds.success(); status.textContent=`¡Ejercicio completado! ${sets} de ${sets} series`;
          if (restAfter>0) {
            // Descanso entre ejercicios: al terminar avanza solo al siguiente.
            GymTimer.start(restAfter,{mode:"restAfter",title:`${ex.name||card.dataset.exerciseName} · descanso`});
          } else if (WorkoutMode.active) {
            setTimeout(() => { if (WorkoutMode.active) WorkoutMode.next(); }, 1100);
          }
        }
        else if(e.currentTarget.classList.contains("is-completed") && rest>0) GymTimer.start(rest,{mode:"rest",title:`${ex.name||card.dataset.exerciseName} · descanso`});
      }},[
        el("span",{class:"btn-set-badge__number",text:String(i)}),
        el("span",{class:"btn-set-badge__copy"},[
          el("strong",{text:`Serie ${i}`}),
          el("span",{class:"btn-set-badge__state",text:"Toca para completar"})
        ])
      ]));
      box.appendChild(el("div",{class:"set-tracker"},[
        el("div",{class:"set-tracker__head"},[
          el("div",{},[
            el("strong",{text:"Cuando termines una serie, pulsa su botón"}),
            el("span",{text:rest>0?`Al pulsarlo comenzará el descanso de ${rest} segundos.`:"El botón se pondrá verde. Puedes volver a pulsarlo para desmarcarlo."}),
            ...(restAfter>0?[el("span",{text:`Al completar la última serie habrá ${restAfter} segundos de descanso antes del siguiente ejercicio.`})]:[])
          ]),
          status
        ]),
        badges
      ]));
    }
  });
}

/* ---------------------------
   AVANCE DEL ENTRENAMIENTO
   El borrador guarda además qué series llevas marcadas y en qué ejercicio ibas,
   para que cerrar la app por error no te obligue a volver a marcar todo.
--------------------------- */

/* Series marcadas de una tarjeta, como lista de booleanos. */
function cardDoneSets(card) {
  return $$(".btn-set-badge", card).map(b => b.classList.contains("is-completed"));
}

/* Repinta las series marcadas sin disparar temporizadores ni sonidos. */
function applyDoneSetsToCard(card, done) {
  if (!Array.isArray(done) || !done.length) return;
  const badges = $$(".btn-set-badge", card);
  if (!badges.length) return;
  badges.forEach((badge, i) => {
    const on = !!done[i];
    badge.classList.toggle("is-completed", on);
    const state = badge.querySelector(".btn-set-badge__state");
    if (state) state.textContent = on ? "✓ Completada" : "Toca para completar";
  });
  const status = $(".set-tracker__status", card);
  const marked = badges.filter(b => b.classList.contains("is-completed")).length;
  if (status) {
    status.textContent = marked === badges.length
      ? `¡Ejercicio completado! ${badges.length} de ${badges.length} series`
      : `${marked} de ${badges.length} series completadas`;
  }
}

/* Guarda el avance al momento (series marcadas, ejercicio actual). */
function saveWorkoutProgress() {
  if (State.prefs.autosave !== "on") return;
  setDraftSession(collectSessionDraftFromUI());
}

/* ¿Hay un entrenamiento a medias que valga la pena retomar? */
function draftHasProgress(draft) {
  if (!draft || !Array.isArray(draft.exercises) || !draft.exercises.length) return false;
  return draft.exercises.some(ex => (ex.doneSets || []).some(Boolean)) || Number(draft.workoutIndex || 0) > 0;
}

function draftDoneCount(draft) {
  return (draft?.exercises || []).filter(ex => {
    const done = ex.doneSets || [];
    return done.length > 0 && done.every(Boolean);
  }).length;
}

/* Total de series marcadas en el borrador. */
function draftMarkedSets(draft) {
  return (draft?.exercises || []).reduce((n, ex) => n + (ex.doneSets || []).filter(Boolean).length, 0);
}

const originalCollectSessionDraftFromUI = collectSessionDraftFromUI;
collectSessionDraftFromUI = function() {
  const draft=originalCollectSessionDraftFromUI();
  draft.cardios=(State.cardioListDraft||[]).map(c=>({...c}));
  draft.cardio=draft.cardios[0]||null;
  const cards = $$(".exercise-card", $("#sessionExercises"));
  draft.exercises.forEach((ex, index)=>{const card=cards[index];ex.duration=Number(card?.dataset.duration||0);ex.rest=Number(card?.dataset.rest||0);ex.restAfter=Number(card?.dataset.restAfter||0);ex.doneSets=card?cardDoneSets(card):[];
    // Si los botones de serie aún no se han pintado, conservamos el avance ya
    // guardado en vez de sobrescribirlo con una lista vacía.
    if (!ex.doneSets.length) {
      const prev = State.sessionDraft?.exercises?.[index];
      if (prev?.doneSets?.length) ex.doneSets = prev.doneSets.slice();
    }
  });
  draft.workoutIndex = WorkoutMode.active ? WorkoutMode.index : (State.sessionDraft?.workoutIndex || 0);
  draft.updatedAt = Date.now();
  return draft;
};

const originalApplyDraftToSessionUI = applyDraftToSessionUI;
applyDraftToSessionUI = function(draft) {
  State.cardioListDraft=sessionCardios(draft).map(c=>({...c})); State.cardioDraft=State.cardioListDraft[0]||null;
  // En modo entrenamiento no reconstruimos las tarjetas: se perderían las
  // series marcadas y la posición actual del usuario.
  if (WorkoutMode.active) { renderCardioList(); return; }
  originalApplyDraftToSessionUI(draft); renderCardioList();
  setTimeout(() => {
    decorateExerciseCards();
    // Las series marcadas se repintan después de crear los botones.
    const cards = $$(".exercise-card", $("#sessionExercises"));
    (draft.exercises || []).forEach((ex, index) => {
      const card = cards[index];
      if (card) applyDoneSetsToCard(card, ex.doneSets);
    });
  });
};

document.addEventListener("click", e => {
  if (e.target instanceof HTMLElement && (e.target.id==="btnLoadRoutineIntoSession" || e.target.id==="btnAddCardio")) setTimeout(decorateExerciseCards);
});

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
        showLoginError("Sin conexión. Revisa tu conexión a internet.");
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
        showLoginError(err.code === "auth/popup-closed-by-user" ? "Se cerró la ventana para iniciar sesión. Intenta de nuevo." : "No se pudo iniciar sesión. Intenta de nuevo.");
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
    subscribeExerciseImages(user);

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
      maybeOfferResumeSession();
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

/* Si la app se cerró con un entrenamiento a medias, preguntamos si continuar en
   vez de recuperar el borrador en silencio (antes había que adivinar que seguía ahí). */
let resumeOffered = false;
async function maybeOfferResumeSession() {
  if (resumeOffered) return;
  const draft = State.sessionDraft;
  if (State.prefs.autosave !== "on" || !draftHasProgress(draft)) return;
  resumeOffered = true;

  const total = draft.exercises.length;
  const at = clamp(Number(draft.workoutIndex || 0), 0, Math.max(0, total - 1)) + 1;
  const done = draftDoneCount(draft);
  const marked = draftMarkedSets(draft);
  const name = draft.routineName || "Entrenamiento";

  const partes = [`ibas en el ejercicio ${at} de ${total}`];
  if (done) partes.push(`${done} ejercicio${done===1?"":"s"} completo${done===1?"":"s"}`);
  else if (marked) partes.push(`${marked} serie${marked===1?"":"s"} marcada${marked===1?"":"s"}`);
  if (draft.updatedAt) partes.push(timeAgoLabel(draft.updatedAt));

  const ok = await confirmDialog({
    title: "Tenías un entrenamiento sin terminar",
    text: `${name}: ${partes.join(" · ")}. ¿Quieres continuarlo?`,
    yesText: "Continuar",
    noText: "Descartar"
  });

  if (!ok) {
    clearDraftSession();
    resetSessionUI();
    toast("Entrenamiento descartado", "Empiezas de cero.", "ok");
    return;
  }

  const index = Number(draft.workoutIndex || 0);
  location.hash = "#new-session";
  // Damos tiempo a que la vista se pinte y el borrador se aplique a las tarjetas.
  setTimeout(() => WorkoutMode.enter(index), 400);
}

/* "hace 5 min" / "hace 2 h" / "ayer" */
function timeAgoLabel(ts) {
  const diff = Math.max(0, Date.now() - Number(ts || 0));
  const min = Math.round(diff / 60000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
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
