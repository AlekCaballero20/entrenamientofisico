(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.GymCatalog = value;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const categories = {
    flexibilidad: "Flexibilidad general",
    danza: "Flexibilidad para danza y ballet",
    matutina: "Movilidad matutina",
    nocturna: "Estiramientos nocturnos",
    postura: "Movilidad y postura",
    recuperacion: "Relajación y recuperación",
    activa: "Flexibilidad activa",
    articular: "Movilidad articular",
    retorno: "Retorno progresivo al ejercicio"
  };
  const exerciseCategories = {
    piernas_caderas: "Piernas y caderas", danza: "Ballet y danza",
    espalda_postura: "Espalda y postura", recuperacion: "Relajación y recuperación"
  };
  const positions = ["sentado", "acostado", "cuatro_apoyos", "de_pie"];
  const surfaces = ["colchoneta", "piso", "cama_firme"];
  const riskTags = ["knee-load", "wrist-load", "hip-deep", "spine-flexion", "spine-extension",
    "spine-rotation", "neck-movement", "ankle-end-range", "balance"];
  const records = {};
  function add(spec) {
    if (records[spec.id]) throw new Error("ID de ejercicio duplicado");
    const position = spec.position || "acostado";
    const record = {
      id: spec.id,
      familyId: spec.familyId || spec.id,
      name: spec.name,
      description: spec.description || spec.instructions[0],
      category: spec.category,
      subcategory: spec.subcategory || spec.name,
      muscles: spec.muscles,
      joints: spec.joints,
      difficulty: spec.difficulty || 1,
      position,
      surfaces: spec.surfaces || (position === "cuatro_apoyos" ? ["colchoneta"] : ["colchoneta", "piso"]),
      equipment: spec.equipment || [],
      recommendation: { holdSeconds: [10, 30], repetitions: [4, 8], ...spec.recommendation },
      modality: spec.modality || "movilidad",
      goals: spec.goals || [...new Set([
        "retorno", "articular", "matutina",
        ...(spec.category === "danza" || spec.category === "piernas_caderas" ? ["danza", "flexibilidad"] : []),
        ...(spec.category === "espalda_postura" ? ["postura", "flexibilidad"] : []),
        ...(spec.category === "recuperacion" || spec.modality === "estatico" ? ["recuperacion", "nocturna"] : []),
        ...(spec.modality === "flexibilidad_activa" ? ["activa"] : [])
      ])],
      instructions: spec.instructions,
      commonMistakes: spec.commonMistakes || ["Forzar la amplitud o contener la respiración."],
      precautions: spec.precautions || ["Trabaja en una amplitud cómoda, con respiración natural. Detente si aparece dolor, mareo u hormigueo."],
      contraindications: spec.contraindications || ["Lesión aguda o cirugía reciente en la zona sin autorización profesional."],
      alternatives: spec.alternatives || ["respiracion_diafragmatica"],
      bodyRegions: spec.bodyRegions,
      phase: spec.phase || "principal",
      riskTags: spec.riskTags || [],
      unilateral: !!spec.unilateral,
      progression: {
        nextId: spec.nextId || "",
        minimumWeek: spec.minimumWeek || 1,
        condition: "Avanza solo si el nivel actual resulta cómodo, sin dolor ni compensaciones. La amplitud es individual."
      }
    };
    records[spec.id] = record;
  }

  // Estos IDs, nombres e indicaciones mantienen el catálogo publicado anteriormente.
  const legacy = {
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
  const lowerLegacy = ["marcha", "pelvis", "pantorrilla", "tobillos", "posterior", "cadera"];
  Object.entries(legacy).forEach(([id, [name, instruction, equipment]]) => add({
    id, name, instructions: [instruction], position: "de_pie", surfaces: ["piso"],
    category: lowerLegacy.includes(id) ? "piernas_caderas" : "espalda_postura",
    muscles: lowerLegacy.includes(id) ? ["piernas", "cadera"] : ["tronco", "cintura escapular"],
    joints: lowerLegacy.includes(id) ? ["cadera", "rodilla", "tobillo"] : ["hombro", "columna torácica"],
    bodyRegions: lowerLegacy.includes(id) ? ["inferior"] : ["superior", "tronco"],
    equipment: equipment ? [equipment] : [],
    unilateral: ["lateral", "pantorrilla", "posterior", "pecho", "cadera"].includes(id),
    phase: id === "respiracion" ? "cierre" : ["marcha", "hombros", "munecas", "tobillos"].includes(id) ? "inicio" : "principal",
    riskTags: id === "torax" ? ["spine-rotation"] : [],
    modality: ["pantorrilla", "posterior", "lateral", "pecho", "cadera"].includes(id) ? "estatico" : "movilidad"
  }));

  add({
    id: "mariposa_sentada", name: "Mariposa sentada", category: "piernas_caderas", subcategory: "Aductores",
    position: "sentado", muscles: ["aductores"], joints: ["cadera"], bodyRegions: ["inferior"], modality: "estatico",
    instructions: ["Junta las plantas de los pies y deja las rodillas abiertas.", "Sujeta los tobillos y alarga suavemente la espalda, sin empujar las rodillas."],
    commonMistakes: ["Presionar las rodillas hacia el suelo o redondear la espalda."],
    riskTags: ["hip-deep"], alternatives: ["aductores_supino", "media_mariposa"]
  });
  add({
    id: "media_mariposa", name: "Media mariposa", category: "piernas_caderas", subcategory: "Cadena posterior",
    position: "sentado", muscles: ["isquiotibiales", "aductores"], joints: ["cadera", "rodilla"], bodyRegions: ["inferior"], modality: "estatico", unilateral: true,
    instructions: ["Estira una pierna con la rodilla ligeramente flexible y acerca la planta del otro pie al muslo.", "Inclínate unos centímetros desde la cadera, con la espalda larga. Alterna de lado en cada serie."],
    riskTags: ["spine-flexion"], alternatives: ["isquiotibiales_supino"]
  });
  add({
    id: "v_sentada", name: "Apertura de piernas en V", category: "piernas_caderas", subcategory: "Aductores",
    position: "sentado", muscles: ["aductores", "isquiotibiales"], joints: ["cadera"], bodyRegions: ["inferior"], modality: "estatico",
    instructions: ["Siéntate con las piernas abiertas solo hasta un ángulo cómodo.", "Apoya las manos detrás y mantén el tronco erguido; puedes doblar un poco las rodillas."],
    riskTags: ["hip-deep"], alternatives: ["mariposa_sentada"], nextId: "preparacion_lateral"
  });
  add({
    id: "laterales_v", name: "Inclinaciones laterales en V", category: "piernas_caderas", subcategory: "Tronco y aductores",
    position: "sentado", muscles: ["oblicuos", "dorsales", "aductores"], joints: ["columna torácica", "cadera"], bodyRegions: ["inferior", "tronco"], modality: "estatico", unilateral: true,
    instructions: ["Abre las piernas en una V pequeña y apoya una mano a un lado.", "Inclina suavemente el tronco hacia esa mano sin girarlo. Alterna de lado en cada serie."],
    riskTags: ["hip-deep"], alternatives: ["lateral_sentado"]
  });
  add({
    id: "isquiotibiales_sentado", name: "Estiramiento de isquiotibiales sentado", category: "piernas_caderas",
    position: "sentado", muscles: ["isquiotibiales"], joints: ["cadera", "rodilla"], bodyRegions: ["inferior"], modality: "estatico", unilateral: true,
    instructions: ["Estira una pierna y dobla la otra para encontrar un apoyo cómodo.", "Inclina ligeramente la pelvis hacia delante sin tirar de los dedos del pie. Alterna de pierna en cada serie."],
    riskTags: ["spine-flexion"], alternatives: ["isquiotibiales_supino"]
  });
  add({
    id: "isquiotibiales_supino", name: "Estiramiento de isquiotibiales acostado", category: "piernas_caderas",
    muscles: ["isquiotibiales"], joints: ["cadera", "rodilla"], bodyRegions: ["inferior"], modality: "estatico", unilateral: true,
    instructions: ["Acostado boca arriba, sujeta un muslo por detrás con las manos.", "Extiende despacio esa rodilla hasta una tensión cómoda, manteniendo la otra pierna apoyada. Alterna de lado en cada serie."],
    commonMistakes: ["Tirar de la rodilla o levantar la cabeza para alcanzar la pierna."],
    alternatives: ["deslizamientos_talon"]
  });
  add({
    id: "aductores_supino", name: "Estiramiento de aductores acostado", category: "piernas_caderas",
    muscles: ["aductores"], joints: ["cadera"], bodyRegions: ["inferior"], modality: "estatico",
    instructions: ["Boca arriba, junta las plantas de los pies con las rodillas dobladas.", "Deja que las rodillas se abran un poco por su propio peso y vuelve al centro para descansar."],
    commonMistakes: ["Forzar la apertura con las manos."], alternatives: ["figura_cuatro"]
  });
  add({
    id: "caderas_90_90", name: "Movilidad de caderas 90/90", category: "piernas_caderas", subcategory: "Rotación de cadera",
    position: "sentado", muscles: ["rotadores de cadera", "glúteos"], joints: ["cadera", "rodilla"], bodyRegions: ["inferior"], difficulty: 2,
    instructions: ["Apoya las manos detrás y coloca ambas rodillas dobladas a un lado, sin exigir un ángulo exacto.", "Cambia lentamente de lado dentro de tu amplitud cómoda, sin levantar los pies a la fuerza."],
    riskTags: ["hip-deep"], alternatives: ["limpiaparabrisas_supino"], minimumWeek: 3
  });
  add({
    id: "figura_cuatro", name: "Figura cuatro acostada", category: "piernas_caderas",
    muscles: ["glúteos", "rotadores de cadera"], joints: ["cadera"], bodyRegions: ["inferior"], modality: "estatico", unilateral: true,
    instructions: ["Boca arriba con los pies apoyados, coloca un tobillo sobre el muslo contrario.", "Mantén la pelvis apoyada; acerca el muslo solo si resulta cómodo. Alterna de lado en cada serie."],
    commonMistakes: ["Empujar la rodilla o flexionar el cuello."], alternatives: ["deslizamientos_talon"]
  });
  add({
    id: "cuadriceps_lateral", name: "Estiramiento de cuádriceps de lado", category: "piernas_caderas",
    muscles: ["cuádriceps"], joints: ["rodilla", "cadera"], bodyRegions: ["inferior"], modality: "estatico", unilateral: true,
    instructions: ["Acostado de lado, apoya la cabeza y dobla la pierna de abajo para estabilizarte.", "Dobla la rodilla de arriba y acerca el talón sin arquear la espalda. Sujeta el tobillo solo si lo alcanzas con facilidad. Alterna de lado en cada serie."],
    alternatives: ["flexion_rodilla_lateral"]
  });
  add({
    id: "flexion_rodilla_lateral", name: "Flexión suave de rodilla de lado", category: "piernas_caderas",
    muscles: ["cuádriceps", "isquiotibiales"], joints: ["rodilla"], bodyRegions: ["inferior"], unilateral: true,
    instructions: ["Acostado de lado con la cabeza apoyada, dobla y estira lentamente la rodilla de arriba.", "Mantén ambos muslos alineados y cambia de lado en cada serie."],
    alternatives: ["deslizamientos_talon"]
  });
  add({
    id: "flexor_cadera_rodilla", name: "Estiramiento de flexores de cadera con apoyo de rodilla", category: "piernas_caderas",
    position: "cuatro_apoyos", muscles: ["flexores de cadera"], joints: ["cadera"], bodyRegions: ["inferior"], modality: "estatico", unilateral: true,
    instructions: ["Desde cuatro apoyos sobre una superficie acolchada, lleva un pie delante y apoya las manos en el suelo a sus lados.", "Desplaza la pelvis mínimamente hacia delante manteniendo el abdomen cómodo y la espalda larga. Alterna de lado en cada serie."],
    riskTags: ["knee-load", "wrist-load", "spine-extension"], alternatives: ["flexor_cadera_lateral"]
  });
  add({
    id: "flexor_cadera_lateral", name: "Movilidad de flexores de cadera de lado", category: "piernas_caderas",
    muscles: ["flexores de cadera", "glúteos"], joints: ["cadera"], bodyRegions: ["inferior"], unilateral: true,
    instructions: ["Acostado de lado, estabiliza la pelvis y dobla un poco la rodilla de arriba.", "Lleva ese muslo unos centímetros hacia atrás sin arquear la cintura y regresa. Alterna de lado en cada serie."],
    riskTags: ["spine-extension"], alternatives: ["basculacion_supina"]
  });
  add({
    id: "pantorrilla_sentada", name: "Estiramiento de pantorrilla sentado", category: "piernas_caderas",
    position: "sentado", muscles: ["gemelos", "sóleo"], joints: ["tobillo"], bodyRegions: ["inferior"], modality: "estatico", unilateral: true,
    instructions: ["Siéntate con una pierna estirada y la rodilla relajada.", "Acerca suavemente la punta del pie hacia ti, sin tirar con las manos. Alterna de pierna en cada serie."],
    alternatives: ["punta_flex"]
  });
  add({
    id: "punta_flex", name: "Punta y flex de pies", category: "piernas_caderas", subcategory: "Pies y tobillos",
    position: "sentado", surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["tibial anterior", "pantorrillas"], joints: ["tobillo"], bodyRegions: ["inferior"], phase: "inicio",
    instructions: ["Con las piernas apoyadas, alterna llevar los dedos hacia delante y hacia ti.", "Mantén los dedos relajados y mueve desde los tobillos sin buscar una punta máxima."],
    alternatives: ["tobillos_supino"]
  });
  add({
    id: "tobillos_supino", name: "Movilidad de tobillos acostado", category: "piernas_caderas", subcategory: "Pies y tobillos",
    surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["musculatura del tobillo"], joints: ["tobillo"], bodyRegions: ["inferior"], phase: "inicio",
    instructions: ["Acostado con las piernas apoyadas, haz círculos pequeños con los tobillos.", "Cambia de sentido a mitad de cada serie y mantén las rodillas relajadas."],
    alternatives: ["punta_flex"]
  });
  add({
    id: "apertura_supina", name: "Apertura lateral de piernas acostada", category: "piernas_caderas",
    muscles: ["aductores", "abductores"], joints: ["cadera"], bodyRegions: ["inferior"], modality: "flexibilidad_activa",
    instructions: ["Boca arriba con los talones apoyados, desliza una pierna hacia un lado unos centímetros.", "Vuelve al centro sin girar la pelvis. Alterna de pierna en cada serie; no busques una apertura máxima."],
    unilateral: true, alternatives: ["aductores_supino"], nextId: "preparacion_lateral"
  });

  add({
    id: "port_bras_sentado", name: "Port de bras sentado", category: "danza", subcategory: "Brazos y coordinación",
    position: "sentado", surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["deltoides", "estabilizadores escapulares"], joints: ["hombro", "codo"], bodyRegions: ["superior", "tronco"], phase: "inicio",
    instructions: ["Siéntate con un apoyo estable y mueve los brazos en un arco suave al frente y a los lados.", "Mantén los hombros bajos y los codos blandos, sin levantar los brazos por encima de una altura cómoda."],
    alternatives: ["hombros_sentado"]
  });
  add({
    id: "developpe_basico", name: "Développé acostado para principiantes", category: "danza", subcategory: "Control de piernas",
    muscles: ["flexores de cadera", "cuádriceps"], joints: ["cadera", "rodilla"], bodyRegions: ["inferior"], modality: "flexibilidad_activa", unilateral: true,
    instructions: ["Boca arriba, desliza un talón hacia ti y levanta un poco ese muslo.", "Extiende parcialmente la rodilla y vuelve a apoyar el pie. Alterna de pierna en cada serie; no fuerces el giro externo."],
    alternatives: ["deslizamientos_talon"], nextId: "developpe_controlado"
  });
  add({
    id: "elevaciones_pierna", name: "Elevaciones controladas de piernas", category: "danza", subcategory: "Flexibilidad activa",
    muscles: ["flexores de cadera", "estabilizadores abdominales"], joints: ["cadera"], bodyRegions: ["inferior", "tronco"], modality: "flexibilidad_activa", unilateral: true,
    instructions: ["Boca arriba con una rodilla doblada y el pie apoyado, eleva la otra pierna solo unos centímetros.", "Mantén la pelvis quieta y baja lentamente. Puedes doblar la rodilla que sube. Alterna de lado en cada serie."],
    alternatives: ["developpe_basico"], nextId: "flexibilidad_activa_pierna"
  });
  add({
    id: "circulos_cadera_supino", name: "Apertura de caderas en el suelo", category: "danza",
    muscles: ["rotadores de cadera"], joints: ["cadera"], bodyRegions: ["inferior"],
    instructions: ["Boca arriba con las rodillas dobladas y los pies apoyados, deja abrir una rodilla un poco hacia fuera.", "Vuelve despacio sin mover la pelvis y alterna de lado."],
    alternatives: ["deslizamientos_talon"]
  });
  add({
    id: "sirena_sentada", name: "Estiramiento sirena", category: "danza", subcategory: "Flexibilidad del tronco",
    position: "sentado", muscles: ["oblicuos", "dorsales"], joints: ["columna torácica", "cadera"], bodyRegions: ["tronco", "superior"], modality: "estatico", difficulty: 2, unilateral: true,
    instructions: ["Siéntate con las piernas dobladas a un lado, o cruzadas si resulta más cómodo.", "Apoya una mano y alarga el brazo contrario en un arco lateral pequeño. Cambia de lado en cada serie."],
    riskTags: ["hip-deep"], alternatives: ["lateral_sentado"], minimumWeek: 3
  });
  add({
    id: "empeines_sentado", name: "Movilidad de empeines", category: "danza", subcategory: "Pies y tobillos",
    position: "sentado", muscles: ["musculatura del pie", "tibial anterior"], joints: ["tobillo", "articulaciones del pie"], bodyRegions: ["inferior"], phase: "inicio",
    instructions: ["Con los pies libres de peso, alarga suavemente el empeine y vuelve a una posición neutra.", "Mantén los dedos largos sin encogerlos; no presiones el pie contra el suelo ni trabajes en puntas."],
    commonMistakes: ["Sentarse sobre los empeines o forzar los dedos."],
    riskTags: ["ankle-end-range"], alternatives: ["punta_flex"]
  });
  add({
    id: "flexibilidad_activa_pierna", name: "Flexibilidad activa de piernas", category: "danza",
    muscles: ["cuádriceps", "isquiotibiales", "flexores de cadera"], joints: ["cadera", "rodilla"], bodyRegions: ["inferior"], modality: "flexibilidad_activa", difficulty: 2, unilateral: true,
    instructions: ["Boca arriba, eleva un muslo con la rodilla doblada manteniendo la otra pierna apoyada.", "Extiende esa rodilla dentro de la amplitud que puedas controlar sin tirar con las manos y vuelve a doblarla. Alterna de lado en cada serie."],
    alternatives: ["developpe_basico"], minimumWeek: 3, nextId: "developpe_amplitud_controlada"
  });
  add({
    id: "pelvis_sentada", name: "Movilidad pélvica sentada", category: "danza",
    position: "sentado", surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["estabilizadores pélvicos", "abdominales"], joints: ["cadera", "columna lumbar"], bodyRegions: ["tronco"], phase: "inicio",
    instructions: ["Siéntate sobre ambos isquiones con las manos apoyadas a los lados.", "Rueda la pelvis muy poco hacia delante y atrás, sin llevar el movimiento al cuello."],
    alternatives: ["basculacion_supina"]
  });
  add({
    id: "preparacion_frontal", name: "Preparación de apertura frontal con rodilla apoyada", category: "danza", subcategory: "Preparación progresiva",
    position: "cuatro_apoyos", muscles: ["isquiotibiales", "flexores de cadera"], joints: ["cadera", "rodilla"], bodyRegions: ["inferior"], difficulty: 2, modality: "estatico", unilateral: true,
    instructions: ["Desde un apoyo de rodilla y manos acolchados, lleva un pie delante y desplaza la pelvis un poco atrás.", "Alarga parcialmente la rodilla de delante sin buscar llegar al suelo ni a un split. Alterna de lado en cada serie."],
    riskTags: ["knee-load", "wrist-load", "spine-flexion"], alternatives: ["isquiotibiales_supino"], minimumWeek: 3
  });
  add({
    id: "preparacion_lateral", name: "Preparación de apertura lateral sentada", category: "danza", subcategory: "Preparación progresiva",
    position: "sentado", muscles: ["aductores", "estabilizadores de cadera"], joints: ["cadera"], bodyRegions: ["inferior"], difficulty: 2, modality: "flexibilidad_activa",
    instructions: ["Siéntate en una V moderada con las manos detrás para estabilizarte.", "Abre y cierra unos centímetros deslizando los talones; cada repetición debe ser controlada y cómoda."],
    riskTags: ["hip-deep"], alternatives: ["apertura_supina"], minimumWeek: 3, nextId: "preparacion_lateral_activa"
  });
  add({
    id: "developpe_controlado", familyId: "developpe_basico", name: "Développé acostado con extensión controlada", category: "danza",
    muscles: ["flexores de cadera", "cuádriceps"], joints: ["cadera", "rodilla"], bodyRegions: ["inferior"], difficulty: 2, modality: "flexibilidad_activa", unilateral: true,
    instructions: ["Boca arriba, lleva una rodilla hacia ti sin despegar la pelvis.", "Extiende lentamente la pierna en la amplitud que controles y baja sin impulso. Alterna de lado en cada serie."],
    alternatives: ["developpe_basico"], minimumWeek: 3, nextId: "developpe_amplitud_controlada"
  });
  add({
    id: "developpe_amplitud_controlada", familyId: "developpe_basico", name: "Développé acostado de amplitud individual", category: "danza",
    muscles: ["cuádriceps", "flexores de cadera", "estabilizadores abdominales"], joints: ["cadera", "rodilla"], bodyRegions: ["inferior", "tronco"], difficulty: 3, modality: "flexibilidad_activa", unilateral: true,
    instructions: ["Repite el développé controlado usando solo una amplitud que ya domines.", "Mantén la extensión un instante y baja lentamente, sin buscar una altura fija ni rotar la pelvis. Alterna de lado en cada serie."],
    alternatives: ["developpe_controlado"], minimumWeek: 5
  });
  add({
    id: "preparacion_lateral_activa", familyId: "preparacion_lateral", name: "Preparación lateral con control activo", category: "danza",
    position: "sentado", muscles: ["aductores", "flexores de cadera"], joints: ["cadera"], bodyRegions: ["inferior"], difficulty: 3, modality: "flexibilidad_activa", unilateral: true,
    instructions: ["Siéntate en una V pequeña, con las manos apoyadas y la espalda larga.", "Intenta aligerar un talón o elevarlo apenas del suelo sin balancearte. Alterna de lado en cada serie; reduce la V si pierdes control."],
    riskTags: ["hip-deep"], alternatives: ["preparacion_lateral"], minimumWeek: 5
  });

  add({
    id: "gato_vaca", name: "Gato-vaca", category: "espalda_postura", subcategory: "Movilidad de columna",
    position: "cuatro_apoyos", muscles: ["paravertebrales", "abdominales"], joints: ["columna", "hombro", "cadera"], bodyRegions: ["tronco"], phase: "inicio",
    instructions: ["Apoya manos bajo hombros y rodillas bajo caderas.", "Alterna redondear y alargar la espalda suavemente, sin colgar la cabeza ni buscar extremos."],
    riskTags: ["knee-load", "wrist-load", "spine-flexion", "spine-extension"], alternatives: ["basculacion_supina"]
  });
  add({
    id: "rotacion_toracica_lateral", name: "Rotaciones torácicas de lado", category: "espalda_postura",
    muscles: ["rotadores del tronco", "pectorales"], joints: ["columna torácica", "hombro"], bodyRegions: ["tronco", "superior"], unilateral: true,
    instructions: ["Acuéstate de lado con las rodillas dobladas y las manos juntas al frente.", "Abre lentamente el brazo de arriba sin despegar las rodillas y vuelve. Cambia de lado en cada serie."],
    riskTags: ["spine-rotation"], alternatives: ["apertura_pecho_supina"]
  });
  add({
    id: "apertura_pecho_supina", name: "Apertura de pecho acostada", category: "espalda_postura",
    surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["pectorales", "deltoides"], joints: ["hombro"], bodyRegions: ["superior"], modality: "estatico",
    instructions: ["Boca arriba, apoya los brazos abiertos a una altura cómoda con las palmas hacia arriba.", "Deja descansar los hombros sin arquear la zona lumbar ni forzar que las manos toquen el suelo."],
    alternatives: ["hombros_supino"]
  });
  add({
    id: "retraccion_cervical", name: "Retracción cervical suave acostada", category: "espalda_postura",
    surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["flexores profundos cervicales"], joints: ["columna cervical"], bodyRegions: ["superior"],
    instructions: ["Boca arriba con la cabeza bien apoyada, lleva la barbilla mínimamente hacia atrás.", "Mantén la mirada al techo y relaja. El movimiento es pequeño y no presiona la cabeza contra la superficie."],
    recommendation: { holdSeconds: [5, 15], repetitions: [3, 5] },
    commonMistakes: ["Levantar la cabeza o empujar con fuerza."],
    riskTags: ["neck-movement"], alternatives: ["respiracion_diafragmatica"]
  });
  add({
    id: "hombros_sentado", name: "Movilidad de hombros sentada", category: "espalda_postura",
    position: "sentado", surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["deltoides", "trapecio"], joints: ["hombro"], bodyRegions: ["superior"], phase: "inicio",
    instructions: ["Siéntate de forma estable, con los brazos relajados.", "Dibuja círculos pequeños con los hombros, cambiando de sentido a mitad de la serie."],
    alternatives: ["hombros_supino"]
  });
  add({
    id: "hombros_supino", name: "Movilidad de hombros acostada", category: "espalda_postura",
    surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["deltoides", "estabilizadores escapulares"], joints: ["hombro"], bodyRegions: ["superior"], phase: "inicio",
    instructions: ["Boca arriba con las rodillas dobladas, desliza los brazos por la superficie hacia una altura cómoda.", "Regresa sin levantar las costillas ni forzar los hombros."],
    alternatives: ["escapular_supino"]
  });
  add({
    id: "escapular_sentado", name: "Movilidad escapular sentada", category: "espalda_postura",
    position: "sentado", surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["romboides", "trapecio medio"], joints: ["cintura escapular"], bodyRegions: ["superior"], phase: "inicio",
    instructions: ["Con los brazos relajados, desliza los omóplatos suavemente hacia el centro y vuelve a soltarlos.", "Evita sacar el pecho en exceso o subir los hombros."],
    alternatives: ["escapular_supino"]
  });
  add({
    id: "basculacion_supina", name: "Inclinaciones pélvicas acostada", category: "espalda_postura",
    surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["abdominales", "estabilizadores pélvicos"], joints: ["columna lumbar", "cadera"], bodyRegions: ["tronco"], phase: "inicio",
    instructions: ["Boca arriba con las rodillas dobladas y los pies apoyados, mece suavemente la pelvis.", "Acerca y aleja un poco la cintura de la superficie sin apretar ni buscar el máximo recorrido."],
    alternatives: ["respiracion_diafragmatica"]
  });
  add({
    id: "postura_nino", name: "Postura del niño", category: "espalda_postura",
    position: "cuatro_apoyos", muscles: ["dorsales", "paravertebrales"], joints: ["cadera", "rodilla", "hombro"], bodyRegions: ["tronco", "superior"], modality: "estatico", phase: "cierre",
    instructions: ["Desde cuatro apoyos, lleva la pelvis un poco hacia los talones y apoya los antebrazos.", "Quédate donde puedas respirar con comodidad; no es necesario llegar a los talones."],
    riskTags: ["knee-load", "spine-flexion", "hip-deep"], alternatives: ["descanso_supino"]
  });
  add({
    id: "lateral_sentado", name: "Estiramiento lateral del tronco sentado", category: "espalda_postura",
    position: "sentado", muscles: ["oblicuos", "dorsales"], joints: ["columna torácica"], bodyRegions: ["tronco", "superior"], modality: "estatico", unilateral: true,
    instructions: ["Siéntate estable, con una mano apoyada a un lado.", "Alarga el otro brazo en diagonal y haz una inclinación lateral pequeña sin despegar ambas caderas. Alterna de lado en cada serie."],
    alternatives: ["apertura_pecho_supina"]
  });
  add({
    id: "limpiaparabrisas_supino", name: "Movilidad de columna acostada", category: "espalda_postura",
    muscles: ["rotadores del tronco", "glúteos"], joints: ["columna lumbar", "cadera"], bodyRegions: ["tronco", "inferior"],
    instructions: ["Boca arriba con las rodillas dobladas y juntas, deja que se inclinen un poco a un lado.", "Vuelve al centro y alterna sin levantar los hombros ni buscar el suelo con las rodillas."],
    riskTags: ["spine-rotation"], alternatives: ["basculacion_supina"]
  });
  add({
    id: "escapular_supino", name: "Activación suave de estabilizadores escapulares", category: "espalda_postura",
    surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["serrato anterior", "estabilizadores escapulares"], joints: ["cintura escapular", "hombro"], bodyRegions: ["superior"], modality: "flexibilidad_activa",
    instructions: ["Boca arriba, lleva los brazos hacia el techo con los codos suaves.", "Acerca las manos unos centímetros al techo separando ligeramente los omóplatos y vuelve a apoyarlos, sin levantar la cabeza."],
    alternatives: ["hombros_supino"]
  });
  add({
    id: "munecas_sentado", name: "Movilidad de muñecas sentada", category: "espalda_postura",
    position: "sentado", surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["flexores y extensores de muñeca"], joints: ["muñeca"], bodyRegions: ["superior"], phase: "inicio",
    instructions: ["Apoya los antebrazos sobre los muslos y haz círculos pequeños con las muñecas.", "Alterna el sentido y abre y cierra los dedos sin apretar."],
    alternatives: ["hombros_sentado"]
  });

  add({
    id: "respiracion_diafragmatica", name: "Respiración diafragmática", category: "recuperacion",
    surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["diafragma"], joints: ["caja torácica"], bodyRegions: ["tronco"], phase: "cierre",
    recommendation: { holdSeconds: [20, 40], repetitions: [3, 6] },
    instructions: ["Boca arriba con las rodillas cómodas, apoya una mano sobre el abdomen.", "Respira con naturalidad y nota cómo se mueve la mano, sin retener el aire ni forzar respiraciones profundas."],
    alternatives: ["respiracion_sentada"]
  });
  add({
    id: "respiracion_sentada", name: "Respiración relajada sentada", category: "recuperacion",
    position: "sentado", surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["diafragma"], joints: ["caja torácica"], bodyRegions: ["tronco"], phase: "cierre",
    instructions: ["Siéntate con el tronco apoyado de manera cómoda y relaja los hombros.", "Respira a tu ritmo sin retener el aire."],
    alternatives: ["respiracion_diafragmatica"]
  });
  add({
    id: "deslizamientos_talon", name: "Deslizamientos de talones acostado", category: "recuperacion", subcategory: "Movilidad matutina",
    surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["flexores de cadera", "isquiotibiales"], joints: ["cadera", "rodilla"], bodyRegions: ["inferior"], phase: "inicio",
    instructions: ["Boca arriba con las piernas apoyadas, desliza un talón hacia ti y vuelve a alejarlo.", "Alterna de pierna sin levantar la pelvis y sin bloquear la rodilla."],
    alternatives: ["tobillos_supino"]
  });
  add({
    id: "relajacion_muscular", name: "Relajación muscular suave", category: "recuperacion",
    surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["manos", "hombros", "piernas"], joints: ["hombro", "mano", "tobillo"], bodyRegions: ["superior", "tronco", "inferior"], phase: "cierre",
    instructions: ["Boca arriba, recorre mentalmente manos, hombros y piernas.", "Afloja cada zona al exhalar, sin hacer contracciones fuertes ni contener la respiración."],
    alternatives: ["descanso_supino"]
  });
  add({
    id: "descanso_supino", name: "Descanso consciente acostado", category: "recuperacion",
    surfaces: ["colchoneta", "piso", "cama_firme"], muscles: ["musculatura postural"], joints: ["caja torácica"], bodyRegions: ["tronco"], phase: "cierre",
    recommendation: { holdSeconds: [20, 40], repetitions: [3, 6] },
    instructions: ["Acuéstate con las rodillas dobladas o las piernas apoyadas de forma cómoda.", "Suelta el peso del cuerpo y respira con normalidad; cambia de postura si aparece molestia."],
    alternatives: ["respiracion_sentada"]
  });
  add({
    id: "secuencia_articular_sentada", name: "Movilidad articular suave sentada", category: "recuperacion",
    position: "sentado", muscles: ["hombros", "antebrazos", "pantorrillas"], joints: ["hombro", "muñeca", "tobillo"], bodyRegions: ["superior", "inferior"], phase: "inicio",
    instructions: ["Sentado estable, alterna pequeños círculos de hombros, muñecas y tobillos.", "Dedica unas respiraciones a cada zona y mantén todos los movimientos lentos."],
    alternatives: ["hombros_sentado", "tobillos_supino"]
  });

  function normalizeName(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function findExercise(ex) {
    if (ex?.catalogId && records[ex.catalogId]) return records[ex.catalogId];
    const name = normalizeName(ex?.name);
    return Object.values(records).find(record => normalizeName(record.name) === name) || null;
  }
  function toExercise(record) {
    return {
      catalogId: record.id,
      // La ficha completa vive en el catálogo compartido; cada sesión conserva una referencia y un resumen.
      exerciseMeta: {
        version: 1, category: record.category, subcategory: record.subcategory,
        difficulty: record.difficulty, position: record.position, surfaces: record.surfaces.slice(),
        equipment: record.equipment.slice(),
        bodyRegions: record.bodyRegions.slice(), riskTags: record.riskTags.slice(),
        modality: record.modality, phase: record.phase
      },
      progressionMode: "comfort",
      name: record.name, notes: record.instructions.join(" ") +
        (record.unilateral ? " Alterna de lado en cada serie." : "") +
        " Evita: " + record.commonMistakes.join(" ") +
        " Precaución: " + record.precautions.join(" "),
      sets: 4, reps: "", weight: 0, duration: Math.min(20, record.recommendation.holdSeconds[1]),
      rest: 10, restAfter: 10, imageUrl: "", videoUrl: ""
    };
  }
  return { records, legacy, categories, exerciseCategories, positions, surfaces, riskTags, findExercise, normalizeName, toExercise };
});
