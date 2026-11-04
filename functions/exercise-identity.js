(function (root) {
  function normalizeExerciseName(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  if (typeof module === "object" && module.exports) module.exports = { normalizeExerciseName };
  else root.ExerciseIdentity = { normalizeExerciseName };
})(typeof window === "object" ? window : globalThis);
