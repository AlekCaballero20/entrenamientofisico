const { test } = require("node:test");
const assert = require("node:assert/strict");
const { catalog, supportedMinutes, buildRoutine } = require("./routine");

for (const minutes of supportedMinutes) {
  test(`rutina de ${minutes} minutos suma series y descansos sin descanso final`, () => {
    const ids = Object.keys(catalog).slice(0, minutes / 2.5);
    const routine = buildRoutine(ids, minutes);
    const seconds = routine.exercises.reduce((total, ex) =>
      total + ex.sets * ex.duration + (ex.sets - 1) * ex.rest + ex.restAfter, 0);
    assert.equal(seconds, minutes * 60);
    assert.equal(routine.exercises.at(-1).restAfter, 0);
    assert.ok(routine.exercises.every(ex => ex.sets % 2 === 0 && ex.duration <= 30));
    assert.deepEqual(routine.equipment, ids.some(id => catalog[id][2]) ? ["pared"] : []);
  });
}

test("rechaza IDs desconocidos, repetidos y propiedades heredadas", () => {
  for (const id of ["inventado", "toString", "__proto__", "marcha", null, {}]) {
    assert.throws(() => buildRoutine(["marcha", "hombros", "brazos", id], 10));
  }
});

test("rechaza duración y cantidad de ejercicios incompatibles", () => {
  assert.throws(() => buildRoutine(Object.keys(catalog).slice(0, 4), 20));
  assert.throws(() => buildRoutine(Object.keys(catalog).slice(0, 8), "20"));
  assert.throws(() => buildRoutine(Object.keys(catalog), 30));
  assert.throws(() => buildRoutine(null, 20));
});
