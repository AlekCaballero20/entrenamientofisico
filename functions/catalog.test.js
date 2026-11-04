const { test } = require("node:test");
const assert = require("node:assert/strict");
const library = require("./exercise-catalog");
const planner = require("./routine");

const legacyNames = {
  marcha: "Marcha suave en el sitio", hombros: "Círculos de hombros",
  brazos: "Apertura suave de brazos", munecas: "Círculos de muñecas",
  torax: "Rotación torácica de pie", lateral: "Estiramiento lateral de pie",
  pelvis: "Movilidad de pelvis de pie", pantorrilla: "Estiramiento de pantorrilla",
  tobillos: "Movilidad de tobillos de pie", posterior: "Estiramiento posterior de pierna",
  escapulas: "Movilidad de escápulas", pecho: "Estiramiento de pecho en pared",
  cadera: "Estiramiento de cadera de pie", respiracion: "Respiración y relajación de pie"
};
const seconds = routine => routine.exercises.reduce((sum, ex) =>
  sum + ex.sets * ex.duration + (ex.sets - 1) * ex.rest + ex.restAfter, 0);

function plan(prompt, minutes, options = {}, interpretation = {}, proposed = []) {
  const intent = planner.resolveIntent(prompt, options, interpretation);
  const candidates = planner.compatibleExercises(intent);
  const selected = planner.selectExercises(candidates, intent, proposed, minutes);
  return planner.buildRoutine(selected.map(ex => ex.id), minutes, intent);
}

test("conserva los 14 identificadores y nombres originales", () => {
  for (const [id, name] of Object.entries(legacyNames)) {
    assert.equal(planner.catalog[id][0], name);
    assert.equal(library.records[id].name, name);
  }
  assert.ok(Object.keys(library.records).length >= 60);
});

test("cada ficha tiene metadatos completos y alternativas existentes sin nombres duplicados", () => {
  const names = new Set();
  for (const [id, ex] of Object.entries(library.records)) {
    assert.equal(ex.id, id);
    assert.ok(!names.has(library.normalizeName(ex.name)));
    names.add(library.normalizeName(ex.name));
    for (const key of ["name", "description", "category", "subcategory", "modality"]) assert.ok(ex[key]);
    for (const key of ["muscles", "joints", "surfaces", "goals", "instructions", "commonMistakes", "precautions", "contraindications", "alternatives", "bodyRegions"]) {
      assert.ok(Array.isArray(ex[key]) && ex[key].length, id + " " + key);
    }
    assert.ok(library.positions.includes(ex.position));
    assert.ok(ex.surfaces.every(surface => library.surfaces.includes(surface)));
    assert.ok([1, 2, 3].includes(ex.difficulty));
    assert.ok(ex.alternatives.every(alternative => Object.hasOwn(library.records, alternative)));
    assert.ok(ex.recommendation.holdSeconds[0] <= ex.recommendation.holdSeconds[1]);
    if (ex.progression.nextId) assert.ok(Object.hasOwn(library.records, ex.progression.nextId));
  }
});

test("15 minutos tipo bailarina completamente en el suelo cubren cuerpo completo y danza", () => {
  const routine = plan("15 minutos de flexibilidad tipo bailarina completamente en el suelo", 15);
  assert.equal(seconds(routine), 900);
  assert.equal(routine.routineCategory, "danza");
  assert.ok(routine.exercises.some(ex => ex.exerciseMeta.category === "danza"));
  assert.ok(routine.exercises.every(ex => ex.exerciseMeta.position !== "de_pie"));
  for (const region of ["inferior", "superior", "tronco"]) {
    assert.ok(routine.exercises.some(ex => ex.exerciseMeta.phase !== "cierre" && ex.exerciseMeta.bodyRegions.includes(region)));
  }
});

test("20 minutos de cuerpo completo sentado o acostado excluyen cuatro apoyos y de pie", () => {
  const routine = plan("Flexibilidad de cuerpo completo para realizar sentada o acostada", 20);
  assert.equal(seconds(routine), 1200);
  assert.ok(routine.exercises.every(ex => ["sentado", "acostado"].includes(ex.exerciseMeta.position)));
});

test("rutina nocturna y matutina conservan tiempos, inicio móvil y cierre tranquilo", () => {
  for (const prompt of ["Estiramientos antes de dormir", "Movilidad suave al despertar"]) {
    const routine = plan(prompt, 20);
    assert.equal(seconds(routine), 1200);
    assert.equal(routine.exercises[0].exerciseMeta.phase, "inicio");
    assert.equal(routine.exercises.at(-1).exerciseMeta.phase, "cierre");
  }
});

test("las restricciones obligatorias prevalecen sobre propuestas incompatibles de Gemini", () => {
  const routine = plan("Ballet completamente en el suelo sin apoyar las rodillas ni cargar las muñecas", 15,
    { position: "sentado_acostado", noEquipment: true }, {},
    ["marcha", "pantorrilla", "gato_vaca", "inventado"]);
  assert.ok(routine.exercises.every(ex =>
    ["sentado", "acostado"].includes(ex.exerciseMeta.position) &&
    !ex.exerciseMeta.riskTags.includes("knee-load") &&
    !ex.exerciseMeta.riskTags.includes("wrist-load") && !ex.exerciseMeta.equipment.length));
});

test("cama firme solo selecciona fichas que admiten esa superficie", () => {
  const routine = plan("Movilidad al despertar en la cama firme", 15, { surface: "cama_firme" });
  assert.ok(routine.exercises.every(ex => ex.exerciseMeta.surfaces.includes("cama_firme")));
  assert.equal(seconds(routine), 900);
});

test("una preferencia de posición no se convierte en una restricción obligatoria", () => {
  const intent = planner.resolveIntent("Prefiero hacer flexibilidad acostada, si es posible", {}, { requiredPositions: ["acostado"] });
  assert.deepEqual(intent.requiredPositions, []);
  assert.ok(intent.preferences.length);
});

test("una preferencia de estilo no elimina una restricción física obligatoria", () => {
  const routine = plan("Prefiero estilo ballet, pero debo permanecer acostada", 15, {},
    { requiredPositions: ["acostado"], preferences: ["ballet"] }, ["marcha", "gato_vaca"]);
  assert.ok(routine.exercises.every(ex => ex.exerciseMeta.position === "acostado"));
});

test("explica combinaciones imposibles sin relajar las restricciones", () => {
  assert.throws(() => plan("Completamente en el suelo", 15, { position: "de_pie" }), /contradicen/);
  assert.throws(() => plan("Solo de pie en la cama firme", 20), /posición.*superficie/);
});

test("las semanas no aumentan dificultad sin confirmación de comodidad", () => {
  const first = plan("Modo bailarina en el suelo", 15, { week: 1, maxLevel: 3, progressComfortable: true });
  const unconfirmed = plan("Modo bailarina en el suelo", 15, { week: 8, maxLevel: 3 });
  const later = plan("Modo bailarina en el suelo", 15, { week: 5, maxLevel: 3, progressComfortable: true });
  assert.ok(first.exercises.every(ex => ex.exerciseMeta.difficulty === 1));
  assert.ok(unconfirmed.exercises.every(ex => ex.exerciseMeta.difficulty === 1 && ex.duration <= 20));
  assert.ok(later.exercises.some(ex => ex.exerciseMeta.difficulty > 1));
  assert.ok(later.exercises.every(ex => ex.duration <= 30));
});

test("todas las categorías y duraciones mantienen tiempos no negativos y alternancia simétrica", () => {
  for (const category of Object.keys(library.categories)) {
    for (const minutes of planner.supportedMinutes) {
      for (const week of [1, 3, 5]) {
        const routine = plan("Cuerpo completo en el suelo", minutes,
          { category, position: "sentado_acostado", week, maxLevel: 3, progressComfortable: true });
        assert.equal(seconds(routine), minutes * 60);
        assert.equal(routine.exercises.at(-1).restAfter, 0);
        assert.ok(routine.exercises.every(ex => ex.duration > 0 && ex.rest >= 0 && ex.restAfter >= 0 && ex.sets % 2 === 0));
      }
    }
  }
});

test("valida filtros de entrada y no acepta niveles, semanas o superficies desconocidas", () => {
  for (const options of [null, [], { week: 0 }, { week: 13 }, { maxLevel: 4 }, { surface: "piscina" }, { position: "aire" }, { progressComfortable: "sí" }]) {
    assert.equal(planner.validOptions(options), false);
  }
});
