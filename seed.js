/* =========================================================
   GymOS - seed.js
   Purpose:
   - Provide initial routines (based on user's old Keep notes)
   - Provide optional seeding helpers (only seed if empty)
   - Provide Keep-text import helpers (DB.keep.parse/applyParsed)
========================================================= */

(function() {
  "use strict";
  
  // If DB isn't loaded, do nothing
  if (!window.DB) {
    console.warn("seed.js: DB not found. Load db.js first.");
    return;
  }
  
  const Seed = {};
  
  /* ---------------------------------------------------------
     1) RAW DATA (your routines)
     Notes:
     - Dates from your text are stored in _sourceDate (optional)
     - We keep weights in lbs as you wrote them
     - Some "biserie/triserie" are stored as notes in exercises array
  --------------------------------------------------------- */
  
  const ROUTINES_2019 = [
    {
      name: "Día 1 - Pierna / Glúteo",
      duration: 90,
      _sourceDate: "2019-01-13",
      cardio: { min: 5, type: "" },
      exercises: [
        { name: "Elevación de talones", sets: 3, reps: 25, weight: 155 },
        { name: "Tijera Smith", sets: 3, reps: 20, weight: 30 },
        { name: "Peso Muerto Mancuerna", sets: 3, reps: 20, weight: 20 },
        { name: "Leg Curl 1 Pierna", sets: 3, reps: 20, weight: 20 },
        { name: "Aductor (outer thigh)", sets: 3, reps: 30, weight: 50 }
      ]
    },
    
    {
      name: "Día 2 - Core",
      duration: 60,
      _sourceDate: "2019-01-29",
      cardio: { min: 5, type: "" },
      exercises: [
        { name: "(Abdomen)", sets: 0, reps: 0, weight: 0 },
        { name: "Crunch", sets: 4, reps: 20, weight: 0 },
        { name: "Oblicuos", sets: 4, reps: 20, weight: 0 },
        { name: "Lumbares", sets: 4, reps: 20, weight: 0 },
        { name: "Patada de rana", sets: 4, reps: 20, weight: 0 },
        { name: "Crunch elevación", sets: 4, reps: 20, weight: 0 },
        { name: "Elevación de piernas", sets: 4, reps: 20, weight: 0 }
      ]
    },
    
    {
      name: "Día 3 - Brazos (Triseries)",
      duration: 60,
      _sourceDate: "2019-02-05",
      cardio: { min: 5, type: "Escaladora" },
      exercises: [
        { name: "(Triserie · 30 segundos)", sets: 0, reps: 0, weight: 0 },
        { name: "Curl Scott Romana", sets: 3, reps: 20, weight: 0 },
        { name: "Curl Barra Prono", sets: 3, reps: 20, weight: 10 },
        { name: "Curl polea 1 mano", sets: 3, reps: 20, weight: 10 },
        { name: "(Triserie · 30 segundos)", sets: 0, reps: 0, weight: 0 },
        { name: "Copa Romana", sets: 3, reps: 20, weight: 0 },
        { name: "Push down 1 mano", sets: 3, reps: 20, weight: 10 },
        { name: "Patada tríceps Polea", sets: 3, reps: 20, weight: 10 }
      ]
    },
    
    {
      name: "Día 4 - Espalda/Pecho (Biseries)",
      duration: 60,
      _sourceDate: "2019-04-15",
      cardio: { min: 10, type: "Spinning" },
      exercises: [
        { name: "(Biserie)", sets: 0, reps: 0, weight: 0 },
        { name: "Halones adelante", sets: 3, reps: 20, weight: 75 },
        { name: "Peck deck fly", sets: 3, reps: 20, weight: 30 },
        { name: "(Biserie)", sets: 0, reps: 0, weight: 0 },
        { name: "Press declinado", sets: 3, reps: 20, weight: 10 },
        { name: "Remo con barra", sets: 3, reps: 20, weight: 25 },
        { name: "(Biserie)", sets: 0, reps: 0, weight: 0 },
        { name: "Remo al piso", sets: 3, reps: 20, weight: 90 },
        { name: "Pull over", sets: 3, reps: 10, weight: 25 }
      ]
    },
    
    {
      name: "Día 5 - Pierna",
      duration: 60,
      _sourceDate: "2019-01-08",
      cardio: { min: 5, type: "" },
      exercises: [
        { name: "Sentadilla", sets: 4, reps: 15, weight: 25 },
        { name: "Hack al fondo", sets: 4, reps: 15, weight: 0 },
        { name: "Leg extensión 1 Pierna", sets: 3, reps: 20, weight: 30 }, // 10/20 -> usamos 20
        { name: "Soleo", sets: 3, reps: 30, weight: 30 },
        { name: "Abductor (inner thigh)", sets: 3, reps: 40, weight: 50 }
      ]
    },
    
    {
      name: "Día 6 - Hombro (Biseries)",
      duration: 60,
      _sourceDate: "2019-01-11",
      cardio: { min: 5, type: "" },
      exercises: [
        { name: "(Biserie)", sets: 0, reps: 0, weight: 0 },
        { name: "Press Mancuerna", sets: 3, reps: 20, weight: 15 },
        { name: "Elevación lateral", sets: 3, reps: 20, weight: 10 },
        { name: "(Biserie)", sets: 0, reps: 0, weight: 0 },
        { name: "Elevación Frontal", sets: 3, reps: 20, weight: 10 },
        { name: "Press Máquina frontal", sets: 3, reps: 20, weight: 30 },
        { name: "(Biserie)", sets: 0, reps: 0, weight: 0 },
        { name: "Vuelos posteriores mancuerna", sets: 3, reps: 20, weight: 10 },
        { name: "Vuelos posteriores Máquina", sets: 3, reps: 20, weight: 20 }
      ]
    }
  ];
  
  const CARDIO_TYPES_2019 = [
    { type: "Spinning", date: "2019-04-15" },
    { type: "Escaladora", date: "2019-02-05" },
    { type: "Caminadora", date: "2019-01-29" },
    { type: "Elíptica", date: "2019-02-08" }
  ];
  
  /* ---------------------------------------------------------
     2) SEEDING LOGIC
  --------------------------------------------------------- */
  
  Seed.seedIfEmpty = function() {
    const state = DB.load();
    
    const hasData = (state.routines && state.routines.length) || (state.sessions && state.sessions.length);
    if (hasData) return state;
    
    // Add routines
    let next = state;
    ROUTINES_2019.forEach((r) => {
      next = DB.routines.add(next, {
        name: r.name,
        duration: r.duration,
        cardio: r.cardio,
        exercises: r.exercises
      });
    });
    
    // Optionally: add cardio catalog into settings for suggestion UI
    next.settings.cardioCatalog = Seed.buildCardioCatalog(CARDIO_TYPES_2019);
    
    DB.save(next);
    return next;
  };
  
  Seed.forceSeed = function() {
    let state = DB.load();
    state.routines = [];
    state.sessions = [];
    state.settings.cardioCatalog = Seed.buildCardioCatalog(CARDIO_TYPES_2019);
    
    ROUTINES_2019.forEach((r) => {
      state = DB.routines.add(state, {
        name: r.name,
        duration: r.duration,
        cardio: r.cardio,
        exercises: r.exercises
      });
    });
    
    DB.save(state);
    return state;
  };
  
  Seed.buildCardioCatalog = function(arr) {
    const map = new Map();
    (arr || []).forEach((c) => {
      const name = String(c.type || "").trim();
      if (!name) return;
      if (!map.has(name)) map.set(name, { name, count: 0, last: null });
      const row = map.get(name);
      row.count += 1;
      if (c.date) row.last = c.date;
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  };
  
  /* ---------------------------------------------------------
     3) IMPORTER: paste Keep text -> routines appended
  --------------------------------------------------------- */
  
  Seed.importKeepText = function(keepText, options = {}) {
    const state = DB.load();
    const parsed = DB.keep.parse(keepText);
    const next = DB.keep.applyParsed(state, parsed, options);
    DB.save(next);
    return { state: next, parsed };
  };
  
  /* ---------------------------------------------------------
     4) OPTIONAL: create sessions from routine source dates
     (Because those old notes had dates, we can convert to
      actual "session history" automatically if you want.)
  --------------------------------------------------------- */
  
  Seed.createSessionsFromSourceDates = function() {
    let state = DB.load();
    
    // We don't have _sourceDate stored inside routines once normalized,
    // so this helper is designed for future expansions if you add it to your routine model.
    // For now, we'll just create example sessions for the first routine.
    
    if (!state.routines.length) return state;
    
    const r = state.routines[0];
    const session = {
      routineId: r.id,
      name: r.name,
      date: DB.utils.dateISO(),
      cardio: r.cardio && r.cardio.min ? r.cardio : null,
      exercises: r.exercises.map((ex) => ({
        name: ex.name,
        sets: Array.from({ length: ex.sets }, () => ({ reps: ex.reps, weight: ex.weight }))
      }))
    };
    
    state = DB.sessions.add(state, session);
    DB.save(state);
    return state;
  };
  
  /* ---------------------------------------------------------
     5) EXPOSE
  --------------------------------------------------------- */
  
  window.Seed = Seed;
  
  // Auto-seed on first run (safe)
  // You can disable this by removing the next line.
  Seed.seedIfEmpty();
})();