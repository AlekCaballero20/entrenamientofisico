const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const sharp = require("sharp");
const { normalizeExerciseName } = require("./exercise-identity");

function setup() {
  const docs = new Map();
  const files = new Map();
  let queue = Promise.resolve();
  let calls = 0;
  const state = { failProvider: false, failStorage: false };
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const db = {
    collection: collection => ({ doc: id => collection + "/" + id }),
    runTransaction(callback) {
      const next = queue.then(async () => {
        const writes = [];
        const result = await callback({
          get: async key => ({ data: () => docs.get(key) }),
          set: (key, value, options) => writes.push([key, options?.merge ? { ...docs.get(key), ...value } : value])
        });
        writes.forEach(([key, value]) => docs.set(key, value));
        if (state.failCommitAfterWrite && writes.some(([, value]) => value.status === "ready")) {
          state.failCommitAfterWrite = false;
          throw new Error("Commit response lost");
        }
        return result;
      });
      queue = next.catch(() => {});
      return next;
    }
  };
  const bucket = { name: "test-bucket", file: name => ({
    name,
    save: async bytes => {
      if (state.failStorage) throw new Error("Storage failed");
      files.set(name, bytes);
    },
    delete: async () => files.delete(name)
  }) };
  const dependencies = {
    "node:crypto": require("node:crypto"),
    "firebase-admin/firestore": { getFirestore: () => db },
    "firebase-admin/storage": { getStorage: () => ({ bucket: () => bucket }) },
    "firebase-functions/v2/https": { HttpsError },
    "firebase-functions/logger": { warn() {} },
    "./exercise-identity": require("./exercise-identity"),
    sharp
  };
  const sandbox = {
    module: { exports: {} }, require: name => dependencies[name], Buffer, Date, Intl, AbortSignal,
    fetch: async () => {
      calls++;
      if (state.failProvider) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ candidates: [{
        finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: "image/png", data: state.sprite || "aW1hZ2U=" } }] }
      }] }) };
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("./images"), "utf8"), sandbox);
  return { generate: sandbox.module.exports.generateImage, docs, files, calls: () => calls, state };
}

function request(name = "Círculos de hombros") {
  return { auth: { uid: "qa", token: { email: "alekcaballeromusic@gmail.com", email_verified: true } }, data: { name } };
}

test("la identidad ignora tildes, mayúsculas y espacios y conserva las variantes", () => {
  assert.equal(normalizeExerciseName("  CÍRCULOS  de hombros! "), normalizeExerciseName("circulos de hombros"));
  assert.notEqual(normalizeExerciseName("Sentadilla con barra"), normalizeExerciseName("Sentadilla con mancuernas"));
});

test("la segunda rutina y otro usuario reutilizan el archivo y evitan otra llamada", async () => {
  const env = setup();
  const first = await env.generate(request(), "key");
  const secondRequest = request("circulos de hombros");
  secondRequest.auth.uid = "other";
  secondRequest.auth.token.email = "catalina.medina.leal@gmail.com";
  const second = await env.generate(secondRequest, "key");
  assert.equal(second.reused, true);
  assert.equal(first.imageUrl, second.imageUrl);
  assert.equal(env.calls(), 1);
  assert.equal(env.files.size, 1);
});

test("dos solicitudes concurrentes solo generan una imagen", async () => {
  const env = setup();
  const results = await Promise.allSettled([env.generate(request(), "key"), env.generate(request(), "key")]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "aborted");
  assert.equal(env.calls(), 1);
});

test("el GIF conserva la imagen fija y reproduce las cuatro posturas de ida y vuelta", async () => {
  const env = setup();
  const size = 128;
  const colors = [10, 70, 130, 220];
  const quadrants = colors.map((value, i) => ({
    input: { create: { width: size, height: size, channels: 3, background: { r: value, g: 0, b: 0 } } },
    left: (i % 2) * size,
    top: Math.floor(i / 2) * size
  }));
  const sprite = await sharp({ create: { width: size * 2, height: size * 2, channels: 3, background: "#fff" } })
    .composite(quadrants).png().toBuffer();
  env.state.sprite = sprite.toString("base64");
  const still = await env.generate(request(), "key");
  const animated = request();
  animated.data.format = "gif";
  const gif = await env.generate(animated, "key");
  assert.notEqual(gif.imageUrl, still.imageUrl);
  assert.equal(gif.format, "gif");
  assert.equal((await env.generate(animated, "key")).reused, true);
  assert.equal((await env.generate(request(), "key")).imageUrl, still.imageUrl);
  assert.equal(env.calls(), 2);

  const decoded = sharp(env.files.get(gif.storagePath), { animated: true });
  const { format, pages, loop, delay } = await decoded.metadata();
  assert.equal(format, "gif");
  assert.equal(pages, 6);
  assert.equal(loop, 0);
  assert.deepEqual(delay, [550, 190, 190, 550, 190, 190]);
  const { data, info } = await decoded.raw().toBuffer({ resolveWithObject: true });
  const frameStride = info.width * (info.height / pages) * info.channels;
  assert.deepEqual(Array.from({ length: pages }, (_, i) => data[i * frameStride]), [10, 70, 130, 220, 130, 70]);
});

test("un fallo permite reintentar y consume intentos sin publicar imágenes incompletas", async () => {
  const env = setup();
  env.state.failProvider = true;
  await assert.rejects(env.generate(request(), "key"), { code: "unavailable" });
  assert.equal(env.files.size, 0);
  env.state.failProvider = false;
  await env.generate(request(), "key");
  assert.equal(env.calls(), 2);
  assert.equal(env.docs.get("exerciseImageQuotas/qa").count, 2);
});

test("un fallo de Storage no publica la imagen y permite reintentar", async () => {
  const env = setup();
  env.state.failStorage = true;
  await assert.rejects(env.generate(request(), "key"), { code: "unavailable" });
  assert.ok([...env.docs.values()].every(doc => doc.status !== "ready"));
  env.state.failStorage = false;
  await env.generate(request(), "key");
  assert.equal(env.files.size, 1);
});

test("si se pierde la respuesta del guardado, conserva el archivo ya publicado", async () => {
  const env = setup();
  env.state.failCommitAfterWrite = true;
  await assert.rejects(env.generate(request(), "key"), { code: "unavailable" });
  assert.equal(env.files.size, 1);
  const retry = await env.generate(request(), "key");
  assert.equal(retry.reused, true);
  assert.equal(env.calls(), 1);
});

test("el límite diario permite reutilizar pero bloquea imágenes nuevas", async () => {
  const env = setup();
  await env.generate(request(), "key");
  env.docs.get("exerciseImageQuotas/qa").count = 20;
  await env.generate(request(), "key");
  await assert.rejects(env.generate(request("Sentadilla con barra"), "key"), { code: "resource-exhausted" });
  assert.equal(env.calls(), 1);
});

test("requiere una cuenta autorizada y un nombre válido antes de consumir cuota", async () => {
  const env = setup();
  const outsider = request();
  outsider.auth.token.email = "other@example.com";
  await assert.rejects(env.generate(outsider, "key"), { code: "permission-denied" });
  await assert.rejects(env.generate(request(""), "key"), { code: "invalid-argument" });
  assert.equal(env.docs.size, 0);
  assert.equal(env.calls(), 0);
});
