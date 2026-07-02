/* =========================================================
   GymOS - firebase-sync.js  (v2 — Auth + per-user Firestore)
   - Google Sign-In (whitelist de correos)
   - Ruta de datos: users/{uid}/appState/main  (aislado por usuario)
   - Firebase es obligatorio; localStorage queda solo como cache interna de UI
========================================================= */
(function () {
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyDpYmD61DWyFXVtfKho-gL06ASCkLHoS14",
    authDomain: "gymos-b2e86.firebaseapp.com",
    projectId: "gymos-b2e86",
    storageBucket: "gymos-b2e86.firebasestorage.app",
    messagingSenderId: "1025418774866",
    appId: "1:1025418774866:web:a3aaed0ee3e51b296d128b"
  };

  // ✅ Solo estos correos pueden entrar
  const ALLOWED_EMAILS = [
    "alekcaballeromusic@gmail.com",
    "catalina.medina.leal@gmail.com"
  ];

  const STORAGE_ROOT = "gymos/exercise-images";

  const Sync = {
    app: null,
    db: null,
    storage: null,
    auth: null,
    status: "booting",
    lastError: null,
    ready: null,
    currentUser: null,

    isReady() {
      return !!(this.app && this.db && this.storage && this.auth);
    },

    // Ruta dinámica según el uid del usuario autenticado
    statePath() {
      const uid = this.currentUser && this.currentUser.uid;
      if (!uid) throw new Error("No hay usuario autenticado.");
      return `users/${uid}/appState/main`;
    },

    storageRoot: STORAGE_ROOT
  };

  function setStatus(status, error) {
    Sync.status = status;
    Sync.lastError = error || null;
    window.dispatchEvent(new CustomEvent("gymos:firebase-status", {
      detail: { status, error: error ? String(error.message || error) : "" }
    }));
  }

  function emitAuthChanged(user) {
    window.dispatchEvent(new CustomEvent("gymos:auth-changed", {
      detail: { user: user || null }
    }));
  }

  function safeName(value) {
    return String(value || "ejercicio")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "ejercicio";
  }

  function start() {
    Sync.ready = new Promise(async (resolve, reject) => {
      try {
        if (!window.firebase) {
          throw new Error("Firebase SDK no está cargado. Revisa conexión o los scripts CDN.");
        }

        Sync.app = window.firebase.apps && window.firebase.apps.length
          ? window.firebase.app()
          : window.firebase.initializeApp(firebaseConfig);

        Sync.db = window.firebase.firestore();
        Sync.storage = window.firebase.storage();
        Sync.auth = window.firebase.auth();

        // Cache offline propia de Firestore; no habilita un modo local de la app.
        try {
          await Sync.db.enablePersistence({ synchronizeTabs: true });
        } catch (err) {
          console.warn("[Firebase] Persistencia offline no disponible:", err);
        }

        // Escuchar cambios de auth
        Sync.auth.onAuthStateChanged(async (user) => {
          if (user) {
            const email = (user.email || "").toLowerCase();
            if (!ALLOWED_EMAILS.includes(email)) {
              // Correo no autorizado: cerrar sesión inmediatamente
              console.warn("[Auth] Correo no autorizado:", email);
              await Sync.auth.signOut();
              Sync.currentUser = null;
              emitAuthChanged(null);
              window.dispatchEvent(new CustomEvent("gymos:auth-unauthorized", {
                detail: { email }
              }));
              return;
            }
            Sync.currentUser = user;
            emitAuthChanged(user);
          } else {
            Sync.currentUser = null;
            emitAuthChanged(null);
          }
        });

        setStatus("ready");
        resolve(Sync);
      } catch (err) {
        setStatus("error", err);
        reject(err);
      }
    });
  }

  // Sign-In con Google (popup)
  Sync.signInWithGoogle = async function () {
    await Sync.ready;
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return Sync.auth.signInWithPopup(provider);
  };

  // Cerrar sesión
  Sync.signOut = async function () {
    await Sync.ready;
    await Sync.auth.signOut();
  };

  // Cargar estado del usuario actual
  Sync.loadState = async function () {
    await Sync.ready;
    const path = Sync.statePath();
    const snap = await Sync.db.doc(path).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return data.state || null;
  };

  // Guardar estado del usuario actual
  Sync.saveState = async function (state) {
    await Sync.ready;
    const path = Sync.statePath();
    const payload = {
      state: state || {},
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: Date.now(),
      schema: "gymos-state-v3-per-user"
    };
    await Sync.db.doc(path).set(payload, { merge: true });
    setStatus("synced");
    return true;
  };

  Sync.clearState = async function () {
    await Sync.ready;
    const path = Sync.statePath();
    await Sync.db.doc(path).delete();
    setStatus("cleared");
    return true;
  };

  /* -----------------------------------------------------------
     Compartir rutinas/programas entre usuarios (colección shares)
  ----------------------------------------------------------- */
  // Correos con acceso (para sugerencias en la UI de compartir)
  Sync.allowedEmails = ALLOWED_EMAILS.slice();

  Sync.sendShare = async function (share) {
    await Sync.ready;
    const user = Sync.currentUser;
    if (!user) throw new Error("No hay usuario autenticado.");
    const doc = {
      toEmail: String(share.toEmail || "").trim().toLowerCase(),
      fromUid: user.uid,
      fromEmail: (user.email || "").toLowerCase(),
      fromName: user.displayName || user.email || "",
      kind: share.kind === "program" ? "program" : "routine",
      name: String(share.name || ""),
      payload: share.payload || {},
      createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      createdAtMs: Date.now()
    };
    if (!doc.toEmail) throw new Error("Falta el correo del destinatario.");
    const ref = await Sync.db.collection("shares").add(doc);
    return ref.id;
  };

  Sync.fetchIncomingShares = async function () {
    await Sync.ready;
    const user = Sync.currentUser;
    if (!user || !user.email) return [];
    const snap = await Sync.db.collection("shares")
      .where("toEmail", "==", user.email.toLowerCase())
      .get();
    const out = [];
    snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
    out.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    return out;
  };

  Sync.deleteShare = async function (id) {
    await Sync.ready;
    await Sync.db.collection("shares").doc(id).delete();
    return true;
  };

  Sync.uploadExerciseImage = async function (file, exerciseName) {
    await Sync.ready;
    if (!file) throw new Error("No hay archivo para subir.");
    if (!/^image\//i.test(file.type || "")) throw new Error("El archivo debe ser una imagen.");

    const uid = Sync.currentUser && Sync.currentUser.uid;
    const ext = (file.name || "imagen").split(".").pop() || "jpg";
    const filename = `${safeName(exerciseName)}-${Date.now()}.${safeName(ext)}`;
    const storagePath = uid
      ? `${STORAGE_ROOT}/${uid}/${filename}`
      : `${STORAGE_ROOT}/${filename}`;
    const ref = Sync.storage.ref().child(storagePath);
    const task = await ref.put(file, {
      contentType: file.type || "image/jpeg",
      customMetadata: { exerciseName: String(exerciseName || "") }
    });
    return task.ref.getDownloadURL();
  };

  window.FirebaseSync = Sync;
  start();
})();
