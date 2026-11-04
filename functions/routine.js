const { records, legacy } = require("./exercise-catalog");
const planner = require("./routine-planner");
const catalog = Object.fromEntries(Object.values(records).map(record =>
  [record.id, legacy[record.id] || [record.name, record.instructions.join(" "), ...record.equipment]]));

const supportedMinutes = [10, 15, 20, 25];

function buildLegacyRoutine(ids, minutes) {
  if (!supportedMinutes.includes(minutes) || !Array.isArray(ids) ||
      ids.length !== minutes / 2.5 || new Set(ids).size !== ids.length ||
      ids.some(id => typeof id !== "string" || !Object.hasOwn(catalog, id))) {
    throw new Error("Selección de ejercicios inválida");
  }

  const equipment = new Set();
  const exercises = ids.map((id, index) => {
    const [name, notes, support] = catalog[id];
    if (support) equipment.add(support);
    const isLast = index === ids.length - 1;
    // Cada ejercicio ocupa 150 segundos, con tres descansos entre cuatro series.
    return { name, notes, sets: 4, duration: isLast ? 30 : 28, rest: 10, restAfter: isLast ? 0 : 8 };
  });
  return {
    name: `Estiramiento y movilidad · ${minutes} min`,
    tag: "Movilidad suave",
    targetMin: minutes,
    equipment: [...equipment],
    exercises
  };
}

function buildRoutine(ids, minutes, intent) {
  if (!intent) return buildLegacyRoutine(ids, minutes);
  return planner.buildPlannedRoutine(ids, minutes, intent);
}

module.exports = { catalog, records, supportedMinutes, buildRoutine, ...planner };
