/* =========================================================
   GymOS - db.js
   Data engine for GymOS:
   - Storage wrapper
   - Schema + migrations
   - Validation + normalization
   - Indexing helpers
   - Metrics (volume, PRs, streaks, weekly stats)
   - Import/Export helpers
   - Keep-text parser (caveman -> structured)
========================================================= */

(function () {
  "use strict";

  /* ---------------------------------------------------------
     1) CONSTANTS / DEFAULTS
  --------------------------------------------------------- */

  const DB = {};
  const KEY = "gymos-db";
  const SCHEMA_VERSION = 2;

  const DEFAULT_STATE = () => ({
    version: "1.0.0",
    schemaVersion: SCHEMA_VERSION,

    theme: "dark",

    routines: [],
    sessions: [],

    settings: {
      unit: "lbs", // lbs | kg
      defaultCardioMin: 10,
      autosave: true,
      locale: "es-CO",
      weekStartsOn: 1, // Monday
      rounding: {
        weight: 1,
        reps: 0
      }
    }
  });

  const UNITS = {
    lbsToKg: (lbs) => lbs * 0.45359237,
    kgToLbs: (kg) => kg / 0.45359237
  };

  /* ---------------------------------------------------------
     2) SMALL UTILS
  --------------------------------------------------------- */

  const U = {
    uid() {
      return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    },

    nowISO() {
      return new Date().toISOString();
    },

    dateISO(d = new Date()) {
      return new Date(d).toISOString().slice(0, 10);
    },

    safeNum(x, fallback = 0) {
      const n = Number(x);
      return Number.isFinite(n) ? n : fallback;
    },

    clamp(n, min, max) {
      n = Number(n);
      if (!Number.isFinite(n)) return min;
      return Math.max(min, Math.min(max, n));
    },

    round(n, dec = 0) {
      const p = Math.pow(10, dec);
      return Math.round((Number(n) + Number.EPSILON) * p) / p;
    },

    sum(arr, fn = (x) => x) {
      return (arr || []).reduce((acc, v) => acc + fn(v), 0);
    },

    groupBy(arr, keyFn) {
      const m = new Map();
      (arr || []).forEach((item) => {
        const k = keyFn(item);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(item);
      });
      return m;
    },

    normalizeSpaces(s) {
      return String(s || "").replace(/\s+/g, " ").trim();
    },

    normalizeName(s) {
      // for comparing exercises (case-insensitive + trimmed)
      return U.normalizeSpaces(String(s || "").toLowerCase());
    },

    // Very forgiving parser for "10/20", "3x20", "3 series 20 repeticiones", etc.
    parseRepsToken(token) {
      const t = String(token || "").trim();

      // "10/20" -> take max as intended target (or avg, but max works better for logging)
      if (/^\d+\s*\/\s*\d+$/.test(t)) {
        const [a, b] = t.split("/").map((x) => U.safeNum(x, 0));
        return Math.max(a, b);
      }

      // "3x20" -> reps 20
      const m = t.match(/(\d+)\s*[xX]\s*(\d+)/);
      if (m) return U.safeNum(m[2], 0);

      // plain number
      if (/^\d+$/.test(t)) return U.safeNum(t, 0);

      return 0;
    },

    parseDateFlexible(s) {
      // supports "15/04/19" "29/01/2019" etc -> yyyy-mm-dd
      const str = String(s || "").trim();

      const m = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
      if (!m) return null;

      let dd = U.safeNum(m[1], 1);
      let mm = U.safeNum(m[2], 1);
      let yy = String(m[3]);

      if (yy.length === 2) {
        // assume 2000s for 00-69 and 1900s for 70-99? Let's be simple: 20yy.
        yy = "20" + yy;
      }
      dd = U.clamp(dd, 1, 31);
      mm = U.clamp(mm, 1, 12);

      const iso = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      // validate date existence
      const dt = new Date(iso + "T00:00:00");
      if (Number.isNaN(dt.getTime())) return null;
      return iso;
    }
  };

  /* ---------------------------------------------------------
     3) STORAGE
  --------------------------------------------------------- */

  DB.load = function () {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return DEFAULT_STATE();
      const parsed = JSON.parse(raw);
      return DB.migrate(DB.normalize(parsed));
    } catch (e) {
      console.error("DB.load error:", e);
      return DEFAULT_STATE();
    }
  };

  DB.save = function (state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error("DB.save error:", e);
      return false;
    }
  };

  DB.clear = function () {
    localStorage.removeItem(KEY);
  };

  DB.exportJSON = function (state) {
    return JSON.stringify(state, null, 2);
  };

  DB.importJSON = function (jsonText) {
    const parsed = JSON.parse(jsonText);
    return DB.migrate(DB.normalize(parsed));
  };

  /* ---------------------------------------------------------
     4) NORMALIZE + VALIDATE
  --------------------------------------------------------- */

  DB.normalize = function (state) {
    const s = state && typeof state === "object" ? state : DEFAULT_STATE();

    // Fill missing top-level keys
    const base = DEFAULT_STATE();
    const out = Object.assign(base, s);

    // Ensure arrays
    out.routines = Array.isArray(out.routines) ? out.routines : [];
    out.sessions = Array.isArray(out.sessions) ? out.sessions : [];

    // Ensure settings
    out.settings = Object.assign(base.settings, out.settings || {});
    out.schemaVersion = U.safeNum(out.schemaVersion, 0);

    // Normalize theme
    if (!["dark", "light"].includes(out.theme)) out.theme = "dark";

    // Normalize units
    if (!["lbs", "kg"].includes(out.settings.unit)) out.settings.unit = "lbs";

    // Normalize routines and sessions
    out.routines = out.routines.map(DB.normalizeRoutine).filter(Boolean);
    out.sessions = out.sessions.map(DB.normalizeSession).filter(Boolean);

    return out;
  };

  DB.normalizeRoutine = function (r) {
    if (!r || typeof r !== "object") return null;

    const out = {
      id: r.id || U.uid(),
      name: U.normalizeSpaces(r.name || "Rutina"),
      duration: U.safeNum(r.duration, 60),
      cardio: r.cardio && typeof r.cardio === "object"
        ? {
            min: U.safeNum(r.cardio.min, 0),
            type: U.normalizeSpaces(r.cardio.type || "")
          }
        : { min: 0, type: "" },
      exercises: Array.isArray(r.exercises) ? r.exercises.map(DB.normalizeRoutineExercise).filter(Boolean) : [],
      createdAt: r.createdAt || U.nowISO(),
      updatedAt: U.nowISO()
    };

    out.duration = U.clamp(out.duration, 5, 240);
    out.cardio.min = U.clamp(out.cardio.min, 0, 120);

    return out;
  };

  DB.normalizeRoutineExercise = function (ex) {
    if (!ex || typeof ex !== "object") return null;

    const name = U.normalizeSpaces(ex.name || "");
    if (!name) return null;

    const out = {
      name,
      sets: U.clamp(U.safeNum(ex.sets, 3), 1, 20),
      reps: U.clamp(U.safeNum(ex.reps, 10), 1, 200),
      weight: U.clamp(U.safeNum(ex.weight, 0), 0, 2000)
    };

    return out;
  };

  DB.normalizeSession = function (s) {
    if (!s || typeof s !== "object") return null;

    const date = s.date ? String(s.date).slice(0, 10) : U.dateISO();
    const out = {
      id: s.id || U.uid(),
      routineId: s.routineId || null,
      name: U.normalizeSpaces(s.name || "Sesión"),
      date,
      notes: U.normalizeSpaces(s.notes || ""),
      cardio: s.cardio && typeof s.cardio === "object"
        ? {
            min: U.safeNum(s.cardio.min, 0),
            type: U.normalizeSpaces(s.cardio.type || "")
          }
        : null,
      exercises: Array.isArray(s.exercises) ? s.exercises.map(DB.normalizeSessionExercise).filter(Boolean) : [],
      totalVolume: U.safeNum(s.totalVolume, 0),
      createdAt: s.createdAt || U.nowISO()
    };

    // Calculate totalVolume if missing / suspicious
    const computed = DB.metrics.sessionVolume(out);
    if (!out.totalVolume || Math.abs(out.totalVolume - computed) > 0.0001) out.totalVolume = computed;

    return out;
  };

  DB.normalizeSessionExercise = function (ex) {
    if (!ex || typeof ex !== "object") return null;

    const name = U.normalizeSpaces(ex.name || "");
    if (!name) return null;

    const sets = Array.isArray(ex.sets) ? ex.sets.map(DB.normalizeSessionSet).filter(Boolean) : [];
    if (!sets.length) return null;

    return { name, sets };
  };

  DB.normalizeSessionSet = function (set) {
    if (!set || typeof set !== "object") return null;
    return {
      reps: U.clamp(U.safeNum(set.reps, 0), 0, 300),
      weight: U.clamp(U.safeNum(set.weight, 0), 0, 5000),
      rir: set.rir == null ? null : U.clamp(U.safeNum(set.rir, 0), 0, 10) // reps in reserve, optional
    };
  };

  /* ---------------------------------------------------------
     5) MIGRATIONS
  --------------------------------------------------------- */

  DB.migrate = function (state) {
    let s = state;

    if (!s.schemaVersion) s.schemaVersion = 0;

    // v0 -> v1: add schemaVersion, createdAt/updatedAt normalization
    if (s.schemaVersion < 1) {
      s.routines = (s.routines || []).map((r) => {
        r.createdAt = r.createdAt || U.nowISO();
        r.updatedAt = r.updatedAt || U.nowISO();
        return r;
      });
      s.sessions = (s.sessions || []).map((ss) => {
        ss.createdAt = ss.createdAt || U.nowISO();
        return ss;
      });
      s.schemaVersion = 1;
    }

    // v1 -> v2: ensure cardio objects exist in routines; sessions may store cardio too
    if (s.schemaVersion < 2) {
      s.routines = (s.routines || []).map((r) => {
        if (!r.cardio) r.cardio = { min: 0, type: "" };
        return r;
      });
      s.schemaVersion = 2;
    }

    // Always normalize after migrations
    s = DB.normalize(s);
    return s;
  };

  /* ---------------------------------------------------------
     6) METRICS
  --------------------------------------------------------- */

  DB.metrics = {
    setVolume(set) {
      const reps = U.safeNum(set.reps, 0);
      const weight = U.safeNum(set.weight, 0);
      return reps * weight;
    },

    exerciseVolume(ex) {
      return U.sum(ex.sets || [], DB.metrics.setVolume);
    },

    sessionVolume(session) {
      return U.sum(session.exercises || [], DB.metrics.exerciseVolume);
    },

    totalVolume(state) {
      return U.sum(state.sessions || [], (s) => U.safeNum(s.totalVolume, 0));
    },

    totalSessions(state) {
      return (state.sessions || []).length;
    },

    sessionsByDate(state) {
      const map = new Map();
      (state.sessions || []).forEach((s) => {
        const k = String(s.date || "").slice(0, 10);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(s);
      });
      return map;
    },

    // Returns streak info: current streak + best streak
    streaks(state) {
      const dates = Array.from(DB.metrics.sessionsByDate(state).keys()).sort();
      if (!dates.length) return { current: 0, best: 0 };

      // convert to day numbers
      const dayNums = dates.map((d) => Math.floor(new Date(d + "T00:00:00").getTime() / 86400000)).sort((a, b) => a - b);

      let best = 1;
      let cur = 1;

      for (let i = 1; i < dayNums.length; i++) {
        if (dayNums[i] === dayNums[i - 1] + 1) {
          cur++;
          best = Math.max(best, cur);
        } else {
          cur = 1;
        }
      }

      // current streak: count backwards from today if session exists today/yesterday chain
      const todayNum = Math.floor(new Date(U.dateISO() + "T00:00:00").getTime() / 86400000);
      const set = new Set(dayNums);
      let current = 0;
      let t = todayNum;
      while (set.has(t)) {
        current++;
        t--;
      }
      return { current, best };
    },

    // PRs by max (weight, reps) and best volume per exercise name
    personalRecords(state) {
      const pr = new Map();

      (state.sessions || []).forEach((session) => {
        (session.exercises || []).forEach((ex) => {
          const key = U.normalizeName(ex.name);

          let maxWeight = 0;
          let maxReps = 0;
          let bestVol = 0;

          (ex.sets || []).forEach((set) => {
            maxWeight = Math.max(maxWeight, U.safeNum(set.weight, 0));
            maxReps = Math.max(maxReps, U.safeNum(set.reps, 0));
          });

          bestVol = DB.metrics.exerciseVolume(ex);

          const prev = pr.get(key);
          if (!prev) {
            pr.set(key, {
              name: ex.name,
              maxWeight,
              maxReps,
              bestVolume: bestVol,
              date: session.date
            });
          } else {
            // update if better
            const improved =
              maxWeight > prev.maxWeight ||
              maxReps > prev.maxReps ||
              bestVol > prev.bestVolume;

            if (improved) {
              pr.set(key, {
                name: ex.name,
                maxWeight: Math.max(prev.maxWeight, maxWeight),
                maxReps: Math.max(prev.maxReps, maxReps),
                bestVolume: Math.max(prev.bestVolume, bestVol),
                date: session.date
              });
            }
          }
        });
      });

      return Array.from(pr.values()).sort((a, b) => b.bestVolume - a.bestVolume);
    },

    // Weekly aggregation: count + volume (ISO-ish week)
    weeklyStats(state) {
      const sessions = (state.sessions || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const map = new Map();

      sessions.forEach((s) => {
        const weekKey = DB.metrics.weekKey(s.date, state.settings.weekStartsOn);
        if (!map.has(weekKey)) map.set(weekKey, { week: weekKey, count: 0, volume: 0 });
        const row = map.get(weekKey);
        row.count += 1;
        row.volume += U.safeNum(s.totalVolume, 0);
      });

      return Array.from(map.values());
    },

    weekKey(dateISO, weekStartsOn = 1) {
      // weekStartsOn: 1 Monday, 0 Sunday
      const d = new Date(String(dateISO).slice(0, 10) + "T00:00:00");
      if (Number.isNaN(d.getTime())) return "unknown";

      const day = d.getDay(); // 0..6 (Sun..Sat)
      const delta = (day - weekStartsOn + 7) % 7;
      d.setDate(d.getDate() - delta);

      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-W${m}${dd}`; // simple "week starting date" key
    }
  };

  /* ---------------------------------------------------------
     7) UNIT CONVERSION HELPERS
  --------------------------------------------------------- */

  DB.units = {
    toKg(value, unit) {
      const v = U.safeNum(value, 0);
      if (unit === "kg") return v;
      return UNITS.lbsToKg(v);
    },
    toLbs(value, unit) {
      const v = U.safeNum(value, 0);
      if (unit === "lbs") return v;
      return UNITS.kgToLbs(v);
    },
    convertWeight(value, from, to) {
      const v = U.safeNum(value, 0);
      if (from === to) return v;
      return to === "kg" ? UNITS.lbsToKg(v) : UNITS.kgToLbs(v);
    },
    convertStateWeights(state, toUnit) {
      const fromUnit = state.settings.unit;
      if (fromUnit === toUnit) return state;

      const out = DB.normalize(state);

      out.routines = out.routines.map((r) => {
        r.exercises = r.exercises.map((ex) => {
          ex.weight = U.round(DB.units.convertWeight(ex.weight, fromUnit, toUnit), 1);
          return ex;
        });
        return r;
      });

      out.sessions = out.sessions.map((s) => {
        s.exercises = s.exercises.map((ex) => {
          ex.sets = ex.sets.map((set) => {
            set.weight = U.round(DB.units.convertWeight(set.weight, fromUnit, toUnit), 1);
            return set;
          });
          return ex;
        });
        s.totalVolume = DB.metrics.sessionVolume(s);
        return s;
      });

      out.settings.unit = toUnit;
      return out;
    }
  };

  /* ---------------------------------------------------------
     8) CRUD HELPERS (PURE FUNCTIONS)
  --------------------------------------------------------- */

  DB.routines = {
    add(state, routineData) {
      const s = DB.normalize(state);
      const routine = DB.normalizeRoutine(Object.assign({}, routineData, { id: U.uid() }));
      s.routines.push(routine);
      return s;
    },

    update(state, id, routineData) {
      const s = DB.normalize(state);
      const idx = s.routines.findIndex((r) => r.id === id);
      if (idx === -1) return s;
      const merged = Object.assign({}, s.routines[idx], routineData, { id });
      s.routines[idx] = DB.normalizeRoutine(merged);
      return s;
    },

    remove(state, id) {
      const s = DB.normalize(state);
      s.routines = s.routines.filter((r) => r.id !== id);
      // sessions remain; you can later mark routineId null if you want
      return s;
    }
  };

  DB.sessions = {
    add(state, sessionData) {
      const s = DB.normalize(state);
      const session = DB.normalizeSession(Object.assign({}, sessionData, { id: U.uid() }));
      session.totalVolume = DB.metrics.sessionVolume(session);
      s.sessions.push(session);
      return s;
    },

    remove(state, id) {
      const s = DB.normalize(state);
      s.sessions = s.sessions.filter((x) => x.id !== id);
      return s;
    }
  };

  /* ---------------------------------------------------------
     9) KEEP-TEXT PARSER (CAVEMAN IMPORT)
     Goal: take a note like the one you pasted and produce:
       - cardio types list
       - routines: "Día 1", "Día 2", etc with exercises
--------------------------------------------------------- */

  DB.keep = {
    parse(text) {
      const raw = String(text || "");
      const lines = raw
        .split(/\r?\n/)
        .map((l) => l.replace(/\u200e|\u200f/g, "")) // remove weird LTR/RTL marks
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const result = {
        cardio: [],
        routines: [],
        unknown: []
      };

      let i = 0;

      // Helper: parse cardio lines like "- Spinning 15/04/19"
      const parseCardioLine = (line) => {
        // remove leading bullets
        const clean = line.replace(/^[-•\u2022]\s*/, "");
        // last token might be date
        const parts = clean.split(" ");
        const maybeDate = parts[parts.length - 1];
        const date = U.parseDateFlexible(maybeDate);
        if (date) parts.pop();

        const type = U.normalizeSpaces(parts.join(" "));
        if (!type) return null;

        return { type, date };
      };

      // Helper: parse day header like "Día 1 13/01/19 90 min"
      const parseDayHeader = (line) => {
        const clean = U.normalizeSpaces(line);
        const m = clean.match(/^D[ií]a\s+(\d+)\s+(.+)$/i);
        if (!m) return null;

        const dayNum = U.safeNum(m[1], 0);
        const rest = m[2];

        // try find date inside rest
        const tokens = rest.split(" ");
        let date = null;
        for (let t of tokens) {
          const d = U.parseDateFlexible(t);
          if (d) { date = d; break; }
        }

        // duration in min
        const durMatch = rest.match(/(\d+)\s*min/i);
        const duration = durMatch ? U.safeNum(durMatch[1], 60) : null;

        return { dayNum, date, duration };
      };

      // Helper: parse exercise line like "- Elevación de talones 3 series 25 repeticiones 155 lbs"
      const parseExerciseLine = (line) => {
        const clean = U.normalizeSpaces(line.replace(/^[-•\u2022]\s*/, ""));

        // ignore headings like "Triserie 30 segundos" / "Biserie"
        if (/^(tri|bi)\s*serie/i.test(clean) || /segundos/i.test(clean)) {
          return { kind: "note", text: clean };
        }

        // Extract weight + unit
        let weight = 0;
        let unit = null;

        const w = clean.match(/(\d+(?:\.\d+)?)\s*(lbs|lb|kg)\b/i);
        if (w) {
          weight = U.safeNum(w[1], 0);
          unit = w[2].toLowerCase().startsWith("k") ? "kg" : "lbs";
        }

        // Extract sets
        let sets = 0;
        const sMatch = clean.match(/(\d+)\s*(series|sets)\b/i);
        if (sMatch) sets = U.safeNum(sMatch[1], 0);

        // Extract reps
        let reps = 0;
        const rMatch = clean.match(/(\d+(?:\s*\/\s*\d+)?)\s*(repeticiones|reps)\b/i);
        if (rMatch) reps = U.parseRepsToken(rMatch[1]);

        // Sometimes order is "... 4 series 20 repeticiones"
        // Sometimes just "... 20 repeticiones 4 series"
        if (!sets) {
          const sAlt = clean.match(/\b(series|sets)\s*(\d+)\b/i);
          if (sAlt) sets = U.safeNum(sAlt[2], 0);
        }
        if (!reps) {
          const rAlt = clean.match(/\b(repeticiones|reps)\s*(\d+(?:\s*\/\s*\d+)?)\b/i);
          if (rAlt) reps = U.parseRepsToken(rAlt[2]);
        }

        // Remove known chunks to isolate exercise name
        let name = clean
          .replace(/(\d+(?:\.\d+)?)\s*(lbs|lb|kg)\b/gi, "")
          .replace(/(\d+)\s*(series|sets)\b/gi, "")
          .replace(/(\d+(?:\s*\/\s*\d+)?)\s*(repeticiones|reps)\b/gi, "")
          .replace(/\s{2,}/g, " ")
          .trim();

        // Some lines start with "Abdomen" or have nested bullet categories: handle outside
        if (!name || name.length < 2) name = clean;

        // Defaults if missing
        if (!sets) sets = 3;
        if (!reps) reps = 10;

        return {
          kind: "exercise",
          name,
          sets,
          reps,
          weight,
          unit
        };
      };

      // Walk lines
      while (i < lines.length) {
        const line = lines[i];

        // Cardio section
        if (/^cardio\b/i.test(line)) {
          i++;
          while (i < lines.length && /^[-•\u2022]/.test(lines[i])) {
            const c = parseCardioLine(lines[i]);
            if (c) result.cardio.push(c);
            i++;
          }
          continue;
        }

        // Day section
        const hdr = parseDayHeader(line);
        if (hdr) {
          const routine = {
            id: U.uid(),
            name: `Día ${hdr.dayNum}`,
            duration: hdr.duration || 60,
            // cardio unknown per day from text; user can set later
            cardio: { min: 0, type: "" },
            exercises: [],
            _source: { date: hdr.date || null }
          };

          i++;

          // parse until next "Día X" or until end
          while (i < lines.length) {
            const l = lines[i];

            // next day begins
            if (parseDayHeader(l)) break;

            // category line like "Abdomen" (no bullet) then bullets afterwards
            if (!/^[-•\u2022]/.test(l) && !/^\s/.test(l)) {
              // treat as a note/category, then advance
              routine.exercises.push({ name: `(${U.normalizeSpaces(l)})`, sets: 0, reps: 0, weight: 0, _isNote: true });
              i++;
              continue;
            }

            if (/^[-•\u2022]/.test(l)) {
              const ex = parseExerciseLine(l);

              if (ex.kind === "note") {
                routine.exercises.push({ name: `(${ex.text})`, sets: 0, reps: 0, weight: 0, _isNote: true });
              } else if (ex.kind === "exercise") {
                // If unit is kg but app default is lbs, keep numeric and let user convert later with units tool
                routine.exercises.push({
                  name: ex.name,
                  sets: ex.sets,
                  reps: ex.reps,
                  weight: ex.weight,
                  unit: ex.unit || null
                });
              } else {
                result.unknown.push(l);
              }
              i++;
              continue;
            }

            // anything else
            result.unknown.push(l);
            i++;
          }

          // Clean notes and fix weird "note exercises"
          routine.exercises = routine.exercises
            .filter((x) => x && x.name)
            .map((x) => {
              if (x._isNote) {
                return { name: x.name, sets: 0, reps: 0, weight: 0 };
              }
              return {
                name: x.name,
                sets: U.clamp(U.safeNum(x.sets, 3), 1, 30),
                reps: U.clamp(U.safeNum(x.reps, 10), 1, 300),
                weight: U.clamp(U.safeNum(x.weight, 0), 0, 5000)
              };
            });

          result.routines.push(routine);
          continue;
        }

        // Anything else
        result.unknown.push(line);
        i++;
      }

      return result;
    },

    // Apply parsed routines into a state (merge strategy: append)
    applyParsed(state, parsed, options = {}) {
      const s = DB.normalize(state);
      const keepUnits = options.keepUnits !== false; // default true

      const routinesToAdd = (parsed.routines || []).map((r) => {
        // If exercise items have "unit", we can optionally convert to app unit
        const fromUnit = keepUnits ? null : (r.exercises[0]?.unit || s.settings.unit);
        const toUnit = s.settings.unit;

        const exercises = (r.exercises || []).map((ex) => {
          const out = { name: ex.name, sets: ex.sets, reps: ex.reps, weight: ex.weight };
          if (!keepUnits && ex.unit && ex.unit !== toUnit) {
            out.weight = U.round(DB.units.convertWeight(out.weight, ex.unit, toUnit), 1);
          }
          return out;
        });

        return DB.normalizeRoutine({
          id: U.uid(),
          name: r.name,
          duration: r.duration,
          cardio: r.cardio,
          exercises
        });
      });

      s.routines.push(...routinesToAdd);
      return s;
    }
  };

  /* ---------------------------------------------------------
     10) INDEXING HELPERS
  --------------------------------------------------------- */

  DB.index = {
    routinesById(state) {
      const m = new Map();
      (state.routines || []).forEach((r) => m.set(r.id, r));
      return m;
    },
    sessionsByRoutine(state) {
      const m = U.groupBy(state.sessions || [], (s) => s.routineId || "none");
      return m;
    },
    sessionsByExercise(state) {
      const m = new Map();
      (state.sessions || []).forEach((session) => {
        (session.exercises || []).forEach((ex) => {
          const key = U.normalizeName(ex.name);
          if (!m.has(key)) m.set(key, []);
          m.get(key).push({ date: session.date, sets: ex.sets, volume: DB.metrics.exerciseVolume(ex) });
        });
      });
      return m;
    }
  };

  /* ---------------------------------------------------------
     11) PUBLIC API
  --------------------------------------------------------- */

  DB.KEY = KEY;
  DB.SCHEMA_VERSION = SCHEMA_VERSION;
  DB.DEFAULT_STATE = DEFAULT_STATE;
  DB.utils = U;

  // Expose DB globally
  window.DB = DB;
})();