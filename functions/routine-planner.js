const { records, categories, positions, surfaces, riskTags, normalizeName, toExercise } = require("./exercise-catalog");

function intersect(current, incoming) {
  if (!incoming.length) return current;
  if (!current.length) return incoming;
  return current.filter(item => incoming.includes(item));
}

const trainingCategories = ["fuerza", "cardio", "equilibrio"];
const equipmentAliases = {
  mancuernas: /\b(?:mancuernas?|dumbbells?|kit de pesas|pesas ajustables)\b/,
  "banda elástica": /\b(?:bandas?(?: elasticas?| de resistencia)?|ligas? elasticas?)\b/,
  kettlebell: /\b(?:kettlebells?|pesas? rusas?)\b/,
  banco: /\bbanco\b/, silla: /\bsilla\b/, pared: /\bpared\b/
};

function normalizeEquipment(value) {
  const text = normalizeName(value);
  return Object.keys(equipmentAliases).find(item => equipmentAliases[item].test(text)) || text;
}

function inferCategory(text) {
  if (/ballet|bailarina|danza/.test(text)) return "danza";
  if (/noche|nocturn|dormir/.test(text)) return "nocturna";
  if (/despertar|manana|matutin/.test(text)) return "matutina";
  if (/relaja|recupera/.test(text)) return "recuperacion";
  if (/flexibilidad activa/.test(text)) return "activa";
  if (/postura/.test(text)) return "postura";
  if (/articular/.test(text)) return "articular";
  if (/cardio|aerobic|resistencia cardiovascular/.test(text)) return "cardio";
  if (/equilibrio|coordinacion/.test(text)) return "equilibrio";
  if (/fuerza|musculacion|hipertrofia|fortalecer|pesas|mancuerna|kettlebell|banda elastica|peso corporal/.test(text)) return "fuerza";
  if (/retom|retorno|meses sin/.test(text)) return "retorno";
  return "flexibilidad";
}

function validOptions(options = {}) {
  return !!options && typeof options === "object" && !Array.isArray(options) &&
    (options.category === undefined || options.category === "" || Object.hasOwn(categories, options.category)) &&
    (options.position === undefined || ["", "suelo", "sentado_acostado", ...positions].includes(options.position)) &&
    (options.surface === undefined || ["", ...surfaces].includes(options.surface)) &&
    (options.maxLevel === undefined || [1, 2, 3].includes(options.maxLevel)) &&
    (options.week === undefined || (Number.isInteger(options.week) && options.week >= 1 && options.week <= 12)) &&
    (options.progressComfortable === undefined || typeof options.progressComfortable === "boolean") &&
    (options.noEquipment === undefined || typeof options.noEquipment === "boolean");
}

function resolveIntent(prompt, options = {}, interpretation = {}) {
  const text = normalizeName(prompt);
  const preferences = [];
  const hard = [];
  let requiredPositions = [];
  let requiredSurfaces = [];
  const floorPositions = ["sentado", "acostado", "cuatro_apoyos"];
  const softPosition = /prefiero|preferiria|idealmente|si es posible|me gustaria/.test(text);
  const hasMandatoryLanguage = /solo|solamente|completamente|exclusivamente|obligatori|no puedo|no debo|debo permanecer|necesito estar|tengo que|sin apoyar/.test(text);
  const floorRequired = /(?:completamente|solo|solamente|todo|toda|exclusivamente).*?(?:suelo|piso)|(?:suelo|piso).*?(?:completamente|exclusivamente)|sin (?:estar de pie|levantarme|ponerme de pie)|no puedo (?:estar|ponerme) de pie/.test(text);
  if (floorRequired) {
    hard.push(floorPositions);
    requiredSurfaces = ["colchoneta", "piso"];
  }
  if (/sentad[oa]s? (?:o|y) acostad[oa]s?/.test(text) && !softPosition) hard.push(["sentado", "acostado"]);
  if (/solo acostad|solo tumbad|exclusivamente acostad|todo acostad|toda acostad/.test(text)) hard.push(["acostado"]);
  if (/solo sentad|exclusivamente sentad|todo sentad|toda sentad/.test(text)) hard.push(["sentado"]);
  if (/solo de pie|exclusivamente de pie/.test(text)) hard.push(["de_pie"]);
  if (softPosition) preferences.push(text);
  if (options.position === "suelo") {
    hard.push(floorPositions);
    requiredSurfaces = intersect(requiredSurfaces, ["colchoneta", "piso"]);
  } else if (options.position === "sentado_acostado") hard.push(["sentado", "acostado"]);
  else if (options.position) hard.push([options.position]);
  if ((!softPosition || hasMandatoryLanguage) && Array.isArray(interpretation.requiredPositions) && interpretation.requiredPositions.length) {
    hard.push(interpretation.requiredPositions.filter(value => positions.includes(value)));
  }
  let incompatible = false;
  hard.forEach(group => {
    const next = intersect(requiredPositions, group);
    if (requiredPositions.length && !next.length) incompatible = true;
    requiredPositions = next;
  });
  if (/cama firme|en la cama|sobre la cama/.test(text) && !softPosition) {
    const next = intersect(requiredSurfaces, ["cama_firme"]);
    if (requiredSurfaces.length && !next.length) incompatible = true;
    requiredSurfaces = next;
  }
  const surfaceGroups = [
    options.surface ? [options.surface] : [],
    Array.isArray(interpretation.requiredSurfaces) ? interpretation.requiredSurfaces.filter(value => surfaces.includes(value)) : []
  ];
  surfaceGroups.forEach(group => {
    if (!group.length) return;
    const next = intersect(requiredSurfaces, group);
    if (requiredSurfaces.length && !next.length) incompatible = true;
    requiredSurfaces = next;
  });
  const excludedRiskTags = new Set((interpretation.excludedRiskTags || []).filter(value => riskTags.includes(value)));
  if (/sin apoyar.*rodillas|evitar.*apoyo.*rodillas/.test(text)) excludedRiskTags.add("knee-load");
  if (/sin apoyar.*munecas|sin cargar.*munecas|evitar.*apoyo.*munecas/.test(text)) excludedRiskTags.add("wrist-load");
  const week = options.week || 1;
  const phaseLevel = week <= 2 ? 1 : week <= 4 ? 2 : 3;
  const maxLevel = options.progressComfortable ? Math.min(options.maxLevel || 1, phaseLevel) : 1;
  const requiredEquipment = (interpretation.requiredEquipment || [])
    .filter(value => typeof value === "string").map(normalizeEquipment);
  const excludedEquipment = (interpretation.excludedEquipment || [])
    .filter(value => typeof value === "string").map(normalizeEquipment);
  const availableEquipment = Object.keys(equipmentAliases).filter(item => equipmentAliases[item].test(text));
  return {
    category: options.category || inferCategory(text),
    availableEquipment: [...new Set([...availableEquipment, ...requiredEquipment])],
    requiredPositions, requiredSurfaces, excludedRiskTags: [...excludedRiskTags],
    noEquipment: !!options.noEquipment || /sin equipo|sin material|sin elementos/.test(text),
    excludedEquipment, requiredEquipment,
    fullBody: /cuerpo completo|todo el cuerpo|general/.test(text) || !!interpretation.fullBody ||
      !/(?:solo|unicamente|para|de) (?:las |los )?(?:piernas|caderas|brazos|hombros|espalda|tobillos|munecas)(?: |$)/.test(text),
    preferences: [...preferences, ...(interpretation.preferences || []).filter(value => typeof value === "string").slice(0, 5)],
    maxLevel, week, progressComfortable: !!options.progressComfortable, incompatible
  };
}

function compatibleExercises(intent) {
  if (intent.incompatible) return [];
  return Object.values(records).filter(ex =>
    (!trainingCategories.includes(ex.category) || ex.category === intent.category) &&
    (!trainingCategories.includes(intent.category) || ex.equipment.every(item =>
      ["pared", "silla"].includes(item) || intent.availableEquipment.includes(item))) &&
    ex.difficulty <= intent.maxLevel &&
    ex.progression.minimumWeek <= intent.week &&
    (!intent.requiredPositions.length || intent.requiredPositions.includes(ex.position)) &&
    (!intent.requiredSurfaces.length || intent.requiredSurfaces.some(surface => ex.surfaces.includes(surface))) &&
    (!intent.noEquipment || !ex.equipment.length) &&
    intent.requiredEquipment.every(item => ex.equipment.includes(item)) &&
    !ex.equipment.some(item => intent.excludedEquipment.includes(item)) &&
    !ex.riskTags.some(tag => intent.excludedRiskTags.includes(tag)));
}

function scoreExercise(ex, intent) {
  let score = ex.goals.includes(intent.category) ? 2 : 0;
  if (trainingCategories.includes(intent.category) && ex.category === intent.category) {
    score += 10;
    if (ex.equipment.some(item => intent.availableEquipment.includes(item))) score += 5;
  }
  if (intent.category === "danza" && ex.category === "danza") score += 8;
  if (intent.category === "postura" && ex.category === "espalda_postura") score += 8;
  if (["nocturna", "recuperacion"].includes(intent.category) && ex.modality === "estatico") score += 4;
  if (["nocturna", "recuperacion"].includes(intent.category) && ex.position === "acostado") score += 4;
  if (intent.category === "recuperacion" && ex.category === "recuperacion") score += 5;
  if (intent.category === "activa" && ex.modality === "flexibilidad_activa") score += 8;
  if (intent.category === "matutina" && ex.modality === "movilidad") score += 5;
  if (ex.difficulty === intent.maxLevel) score += 1;
  const preference = normalizeName(intent.preferences.join(" "));
  if (/acostad|tumbad/.test(preference) && ex.position === "acostado") score += 2;
  if (/sentad/.test(preference) && ex.position === "sentado") score += 2;
  return score;
}

function selectExercises(candidates, intent, proposedIds, minutes, usedIds = new Set()) {
  if (intent.incompatible) throw new Error("Las restricciones de posición o superficie se contradicen. Revisa el texto y los filtros obligatorios para elegir una combinación compatible.");
  const proposals = new Set(Array.isArray(proposedIds) ? proposedIds : []);
  const training = trainingCategories.includes(intent.category);
  const rank = ex => scoreExercise(ex, intent) + (training ? Number(proposals.has(ex.id)) - 2 * Number(usedIds.has(ex.id)) : 0);
  const ranked = candidates.slice().sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
  if (training && !ranked.some(ex => ex.category === intent.category)) {
    throw new Error("El catálogo no tiene ejercicios de " + categories[intent.category].toLowerCase() + " compatibles con estos filtros.");
  }
  const daily = minutes === null;
  const count = Math.min(daily ? 4 : minutes / 2.5, candidates.length);
  if (count < (daily ? 1 : Math.ceil(minutes * 60 / 240))) {
    const labels = [];
    if (intent.requiredPositions.length) labels.push("posición " + intent.requiredPositions.map(value => value.replaceAll("_", " ")).join(" / "));
    if (intent.requiredSurfaces.length) labels.push("superficie " + intent.requiredSurfaces.map(value => value.replaceAll("_", " ")).join(" / "));
    if (intent.excludedRiskTags.length) labels.push("apoyos o movimientos excluidos");
    if (intent.noEquipment) labels.push("sin equipo");
    if (intent.requiredEquipment.length) labels.push("uso obligatorio de " + intent.requiredEquipment.join(", "));
    throw new Error("Solo hay " + count + " ejercicios compatibles con " +
      (labels.join(", ") || "las condiciones elegidas") +
      (daily ? ". Ajusta una condición." : ". Ajusta una condición o elige una duración menor."));
  }
  const selected = [];
  const append = ex => {
    if (ex && !selected.some(item => item.id === ex.id)) selected.push(ex);
  };
  const opener = training && daily ? null : ranked.find(ex => ex.phase === "inicio");
  const closer = training && ranked.filter(ex => ex.category === intent.category).length >= count - 1
    ? null : ranked.find(ex => ex.phase === "cierre");
  append(opener);
  if (intent.fullBody) {
    for (const region of ["inferior", "tronco", "superior"]) {
      if (selected.length >= count - (closer ? 1 : 0)) break;
      if (!selected.some(ex => ex.bodyRegions.includes(region))) {
        append(ranked.find(ex => ex.phase !== "cierre" && ex.bodyRegions.includes(region)));
      }
    }
  }
  for (const id of training ? [] : proposals) {
    if (selected.length >= count - (closer ? 1 : 0)) break;
    append(ranked.find(ex => ex.id === id && ex.id !== closer?.id));
  }
  for (const ex of ranked) {
    if (selected.length >= count - (closer ? 1 : 0)) break;
    if (ex.id !== closer?.id) append(ex);
  }
  append(closer);
  const phaseOrder = { inicio: 0, principal: 1, cierre: 2 };
  return selected.slice(0, count).sort((a, b) => phaseOrder[a.phase] - phaseOrder[b.phase]);
}

function buildPlannedRoutine(ids, minutes, intent) {
  const daily = minutes === null;
  const compatibleIds = new Set(compatibleExercises(intent).map(ex => ex.id));
  const minCount = daily ? 1 : Math.max(2, Math.ceil(minutes * 60 / 240));
  const maxCount = daily ? 4 : minutes / 2.5;
  if ((!daily && ![10, 15, 20, 25].includes(minutes)) || !Array.isArray(ids) ||
      ids.length < minCount || ids.length > maxCount ||
      new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !compatibleIds.has(id))) {
    throw new Error("Selección de ejercicios inválida");
  }
  const equipment = new Set();
  const slot = Math.floor(minutes * 60 / ids.length);
  const remainder = minutes * 60 % ids.length;
  const exercises = ids.map((id, index) => {
    const record = records[id];
    record.equipment.forEach(item => equipment.add(item));
    const isLast = index === ids.length - 1;
    const blockSeconds = slot + (index < remainder ? 1 : 0);
    const holdCap = !intent.progressComfortable || intent.week <= 2 ? 20 : intent.week <= 4 ? 25 : 30;
    const duration = Math.min(holdCap, record.recommendation.holdSeconds[1]);
    const exercise = { ...toExercise(record), duration, progressionWeek: intent.week };
    if (record.modality === "fuerza") {
      return {
        ...exercise, duration: 0, reps: String(record.recommendation.repetitions[0]),
        sets: 2, rest: 45, restAfter: 0
      };
    }
    if (daily) return { ...exercise, sets: 2, rest: 10, restAfter: 0 };
    const sets = Math.min(8, Math.max(4, Math.floor((blockSeconds + 10) / (duration + 10) / 2) * 2));
    const rest = isLast ? Math.floor((blockSeconds - sets * duration) / (sets - 1)) : 10;
    return {
      ...exercise, sets, rest,
      restAfter: isLast ? 0 : blockSeconds - sets * duration - (sets - 1) * rest
    };
  });
  const usesRepetitions = exercises.some(ex => ex.reps);
  if (!daily && !usesRepetitions) {
    const scheduled = exercises.reduce((total, ex) => total + ex.sets * ex.duration + (ex.sets - 1) * ex.rest + ex.restAfter, 0);
    exercises[exercises.length - 2].restAfter += minutes * 60 - scheduled;
  }
  return {
    name: categories[intent.category] + (daily ? " · Durante el día" : " · " + minutes + " min"),
    tag: categories[intent.category], routineCategory: intent.category,
    progressionMode: "comfort", progressionWeek: intent.week,
    ...(daily ? { workoutStyle: "daily" } : {}),
    targetMin: minutes ?? 0, equipment: [...equipment], exercises,
    generationNotes: [
      "Semana " + intent.week + " · nivel máximo autorizado: " + intent.maxLevel + ". La progresión requiere confirmar comodidad.",
      daily ? "Haz un ejercicio completo y retoma el siguiente cuando tengas otro momento libre."
        : usesRepetitions ? "La duración es aproximada. Marca cada serie al terminar las repeticiones."
          : "Los tiempos incluyen series y descansos programados. Preparación, avisos y pausas añaden tiempo.",
      usesRepetitions ? "Usa una carga ligera que puedas controlar y regístrala al entrenar."
        : "La amplitud es individual. Mantén o reduce el nivel si pierde comodidad; no se presupone alcanzar un split."
    ]
  };
}

module.exports = { validOptions, resolveIntent, compatibleExercises, selectExercises, buildPlannedRoutine };
