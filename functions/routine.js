const catalog = {
  marcha: ["Marcha suave en el sitio", "De pie, alterna los pies a un ritmo cómodo y mueve los brazos con suavidad."],
  hombros: ["Círculos de hombros", "Haz círculos pequeños con los hombros y cambia de sentido a mitad de cada serie."],
  brazos: ["Apertura suave de brazos", "Abre los brazos a una altura cómoda y vuelve despacio al centro."],
  munecas: ["Círculos de muñecas", "Con los codos relajados, dibuja círculos suaves. Cambia de sentido a mitad de cada serie."],
  torax: ["Rotación torácica de pie", "Con los brazos cruzados sobre el pecho, gira suavemente a un lado y al otro."],
  lateral: ["Estiramiento lateral de pie", "Inclínate suavemente hacia un lado sin girar el torso. Alterna de lado en cada serie."],
  pelvis: ["Movilidad de pelvis de pie", "Con las rodillas suaves, lleva la pelvis ligeramente hacia delante y atrás."],
  pantorrilla: ["Estiramiento de pantorrilla", "Apoya las manos en la pared y lleva un pie atrás con el talón en el suelo. Alterna de pierna en cada serie.", "pared"],
  tobillos: ["Movilidad de tobillos de pie", "Con los pies en el suelo, eleva y baja los talones despacio."],
  posterior: ["Estiramiento posterior de pierna", "Adelanta un talón, flexiona un poco la pierna de apoyo e inclina el torso desde la cadera. Alterna de pierna en cada serie."],
  escapulas: ["Movilidad de escápulas", "Con los brazos relajados, acerca suavemente los omóplatos y vuelve al centro."],
  pecho: ["Estiramiento de pecho en pared", "Apoya el antebrazo en la pared a una altura cómoda y gira suavemente el torso. Alterna de lado en cada serie.", "pared"],
  cadera: ["Estiramiento de cadera de pie", "Da un paso corto hacia atrás y desplaza un poco el peso hacia delante, manteniendo el torso erguido. Alterna de pierna en cada serie."],
  respiracion: ["Respiración y relajación de pie", "Respira a tu ritmo y deja que los hombros se relajen al exhalar."]
};

const supportedMinutes = [10, 15, 20, 25];

function buildRoutine(ids, minutes) {
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

module.exports = { catalog, supportedMinutes, buildRoutine };
