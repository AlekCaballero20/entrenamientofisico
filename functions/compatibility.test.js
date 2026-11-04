const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const GymCatalog = require("./exercise-catalog");
const planner = require("./routine");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));

function clientFunctions(names, globals) {
  const context = vm.createContext(globals);
  for (const name of names) {
    const start = source.indexOf("function " + name + "(");
    assert.ok(start >= 0, "Función de la app existente: " + name);
    const end = source.indexOf("\n}", start) + 2;
    vm.runInContext(source.slice(start, end), context);
  }
  return context;
}

function legacyExercise() {
  return {
    id: "exercise-before-ai", name: "Ejercicio personal anterior",
    sets: 3, reps: "10/12", weight: 5, unit: "kg", notes: "Observación anterior",
    duration: 0, rest: 60, restAfter: 30,
    imageUrl: "https://example.com/existing.png", videoUrl: "",
    doneSets: [true, false, true], customObservation: { value: "mantener" }
  };
}

function state() {
  return {
    prefs: { unit: "kg" }, activeProgramId: "old-program", cardioDraft: null,
    routines: [{ id: "old-routine", programId: "old-program", name: "Rutina guardada", exercises: [legacyExercise()], createdAt: 100 }],
    sessions: [{ id: "old-session", routineId: "old-routine", date: "2026-10-01", exercises: [legacyExercise()], durationMin: 45 }],
    sessionDraft: null
  };
}

test("normalizar el estado anterior conserva IDs, datos personales de ejercicios y avances", () => {
  const State = state();
  const before = plain(State);
  const client = clientFunctions(["cleanMediaUrl", "withExerciseMedia", "normalizeLoadedMedia"], {
    State, parseEquipmentList: value => Array.isArray(value) ? value : [], normalizeCardioItem: value => value
  });
  client.normalizeLoadedMedia();
  assert.deepEqual(plain(State.routines), before.routines);
  assert.deepEqual(plain(State.sessions), before.sessions);
});

test("editor y creación conservan metadatos nuevos y campos anteriores durante el guardado", () => {
  const State = state();
  const intent = planner.resolveIntent("Flexibilidad tipo bailarina completamente en el suelo");
  const selected = planner.selectExercises(planner.compatibleExercises(intent), intent, [], 15);
  const draft = planner.buildRoutine(selected.map(ex => ex.id), 15, intent);
  const row = {
    exerciseData: { ...draft.exercises[0], customObservation: { value: "persistir" } },
    querySelector(selector) {
      const field = selector.match(/data-field="([^"]+)"/)?.[1];
      return { value: String(this.exerciseData[field] ?? ""), dataset: { unit: "seg" } };
    }
  };
  const nodes = {
    "#routineExercisesEditor": {},
    "#modalRoutine": { routineData: { ...draft, id: "existing-routine-id" } },
    "#routineName": { value: draft.name }, "#routineTargetMin": { value: "15" },
    "#routineTag": { value: draft.tag }, "#routineCardioSuggest": { value: "" }, "#routineEquipment": { value: "" }
  };
  const client = clientFunctions(["cleanMediaUrl", "timeFieldSeconds", "collectRoutineModalData", "createRoutine", "updateRoutine"], {
    State, $: selector => nodes[selector], $$: () => [row],
    parseEquipmentList: value => Array.isArray(value) ? value : [],
    uid: () => "new-routine-id", saveRoutines() {}
  });
  const data = client.collectRoutineModalData();
  assert.equal(data.id, "existing-routine-id");
  assert.equal(data.exercises[0].catalogId, draft.exercises[0].catalogId);
  assert.deepEqual(plain(data.exercises[0].exerciseMeta), draft.exercises[0].exerciseMeta);
  const created = client.createRoutine(data);
  assert.equal(created.id, "new-routine-id");
  assert.equal(created.progressionMode, "comfort");
  assert.equal(created.exercises[0].customObservation.value, "persistir");
  const updated = client.updateRoutine("old-routine", { name: "Nombre actualizado" });
  assert.equal(updated.id, "old-routine");
  assert.equal(updated.exercises[0].id, "exercise-before-ai");
  assert.equal(updated.exercises[0].customObservation.value, "mantener");
});

test("guardar una sesión conserva la amplitud, el mantenimiento, el nivel y los campos de ejercicios anteriores", () => {
  const State = state();
  const ex = { ...legacyExercise(), catalogId: "mariposa_sentada", exerciseMeta: GymCatalog.records.mariposa_sentada,
    progressionMode: "comfort", progressionWeek: 3,
    flexibilityProgress: { comfortableRange: "Rodillas apoyadas cómodamente", holdSeconds: 22, perceivedDifficulty: 2, comfort: "comfortable", catalogLevel: 1 }
  };
  const nodes = {
    "#sessionRoutineSelect": { value: "old-routine" }, "#sessionDate": { value: "2026-11-04" },
    "#sessionDuration": { value: "15" }, "#weightUnit": { value: "kg" },
    "#sessionRPE": { value: "" }, "#sessionNotes": { value: "Registro nuevo" }, "#sessionExercises": {}
  };
  const card = {
    exerciseData: ex, dataset: { exerciseName: ex.name, imageUrl: ex.imageUrl, videoUrl: "" },
    inputs: [ex.sets, ex.reps, ex.weight, ex.notes].map(value => ({ value: String(value) }))
  };
  const client = clientFunctions(["cleanMediaUrl", "collectSessionDraftFromUI", "createSession"], {
    State,
    $: (selector, parent) => parent ? selector === ".flexibility-tracker" ? {} : null : nodes[selector],
    $$: (selector, parent) => selector === "input" ? parent.inputs : [card],
    readFlexibilityProgress: () => ex.flexibilityProgress, todayISO: () => "2026-11-04",
    sessionCardios: () => [], uid: () => "new-session-id", saveSessions() {}
  });
  const draft = client.collectSessionDraftFromUI();
  const saved = client.createSession(draft);
  assert.equal(saved.exercises[0].catalogId, ex.catalogId);
  assert.deepEqual(plain(saved.exercises[0].flexibilityProgress), ex.flexibilityProgress);
  assert.deepEqual(plain(saved.exercises[0].customObservation), ex.customObservation);
  assert.deepEqual(plain(saved.exercises[0].doneSets), ex.doneSets);
  assert.equal(State.sessions[1].id, "old-session");
  assert.equal(State.routines[0].id, "old-routine");
});

test("la progresión de fuerza anterior sigue operativa y no aumenta automáticamente flexibilidad", () => {
  const State = state();
  const legacy = { id: "strength", name: "Fuerza", targetMin: 30, exercises: [{ name: "Peso", weight: 10, duration: 0, reps: "10" }] };
  const gentle = { id: "flex", name: "Flexibilidad", targetMin: 15, progressionMode: "comfort", exercises: [GymCatalog.toExercise(GymCatalog.records.mariposa_sentada)] };
  const client = clientFunctions(["roundHalf", "planProgression"], {
    State, routinesInProgram: () => [legacy, gentle],
    programProgression: () => ({ minutes: 5, weightAmount: 2, weightMode: "add", seconds: 5, reps: 1 })
  });
  const changes = client.planProgression({ id: "old-program" });
  assert.ok(changes.some(change => change.routineId === "strength" && change.field === "weight" && change.to === 12));
  assert.ok(changes.every(change => change.routineId !== "flex"));
});
