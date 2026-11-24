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
  const imageRequests = [];
  const state = { failProvider: false, failStorage: false, reviews: [], reviewCalls: 0 };
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
    "./hinge-animation": require("./hinge-animation"),
    sharp
  };
  const sandbox = {
    module: { exports: {} }, require: name => dependencies[name], Buffer, Date, Intl, AbortSignal,
    fetch: async (url, options) => {
      if (url.includes("/gemini-3.5-flash-lite:")) {
        state.reviewCalls++;
        const review = state.reviews.shift() || { usable: true, correction: "" };
        return { ok: true, json: async () => ({ candidates: [{
          finishReason: "STOP", content: { parts: [{ text: JSON.stringify(review) }] }
        }] }) };
      }
      imageRequests.push(JSON.parse(options.body));
      calls++;
      if (state.failProvider) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ candidates: [{
        finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: "image/png", data: state.sprite || "aW1hZ2U=" } }] }
      }] }) };
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("./images"), "utf8"), sandbox);
  return { generate: sandbox.module.exports.generateImage, docs, files, calls: () => calls, state, imageRequests };
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

test("rehacer un GIF vigente lo reemplaza después de pasar revisión", async () => {
  const env = setup();
  const sprite = await sharp({ create: { width: 256, height: 256, channels: 3, background: "#fff" } })
    .png().toBuffer();
  env.state.sprite = sprite.toString("base64");
  const animated = request("Remo con banda");
  animated.data.format = "gif";
  const original = await env.generate(animated, "key");
  const updated = await env.generate({ ...animated, data: { ...animated.data, regenerate: true } }, "key");
  assert.notEqual(updated.imageUrl, original.imageUrl);
  assert.equal(updated.reused, false);
  assert.equal((await env.generate(animated, "key")).imageUrl, updated.imageUrl);
  assert.equal(env.calls(), 2);
  assert.equal(env.state.reviewCalls, 2);
});

test("un GIF de cualquier ejercicio se vuelve a dibujar si la revisión detecta un giro", async () => {
  const env = setup();
  const sprite = await sharp({ create: { width: 256, height: 256, channels: 3, background: "#fff" } })
    .png().toBuffer();
  env.state.sprite = sprite.toString("base64");
  env.state.reviews.push({ usable: false, correction: "Keep the feet planted and remove the torso twist." });
  const animated = request("Movimiento nuevo con mancuernas");
  animated.data.format = "gif";
  const result = await env.generate(animated, "key");
  assert.equal(result.gifVersion, 3);
  assert.equal(env.state.reviewCalls, 2);
  assert.equal(env.calls(), 2);
  assert.match(env.imageRequests[1].contents[0].parts[0].text, /remove the torso twist/);
  assert.equal(env.files.size, 1);
});

test("si las tres revisiones fallan, conserva el GIF compartido anterior", async () => {
  const env = setup();
  const sprite = await sharp({ create: { width: 256, height: 256, channels: 3, background: "#fff" } })
    .png().toBuffer();
  env.state.sprite = sprite.toString("base64");
  const animated = request("Remo nuevo con banda");
  animated.data.format = "gif";
  const original = await env.generate(animated, "key");
  const doc = [...env.docs.keys()].find(key => key.endsWith("-gif"));
  env.docs.set(doc, { ...env.docs.get(doc), gifVersion: 2 });
  env.state.reviews.push(
    { usable: false, correction: "Show the endpoint." },
    { usable: false, correction: "Use a single camera angle." },
    { usable: false, correction: "Keep both feet planted." }
  );
  await assert.rejects(env.generate(animated, "key"), { code: "failed-precondition" });
  assert.equal(env.docs.get(doc).imageUrl, original.imageUrl);
  assert.equal(env.docs.get(doc).status, "ready");
  assert.equal(env.files.size, 1);
  const finalPrompt = env.imageRequests.at(-1).contents[0].parts[0].text;
  assert.match(finalPrompt, /Show the endpoint/);
  assert.match(finalPrompt, /Use a single camera angle/);
  assert.match(finalPrompt, /Redraw from scratch/);
});

test("el curl de bíceps crea una animación de técnica fija sin depender del proveedor", async () => {
  const env = setup();
  const animated = request("Curl de bíceps con mancuernas");
  animated.data.format = "gif";
  env.state.failProvider = true;
  const result = await env.generate(animated, "key");
  assert.equal(result.model, "gymos-motion");
  assert.equal(env.calls(), 0);
  const { pages } = await sharp(env.files.get(result.storagePath), { animated: true }).metadata();
  assert.equal(pages, 20);
});

test("el peso muerto rumano actualiza el GIF antiguo con una bisagra reproducible", async () => {
  const env = setup();
  const animated = request("Peso muerto rumano con mancuernas");
  animated.data.format = "gif";
  const first = await env.generate(animated, "key");
  const document = [...env.docs.keys()].find(key => key.endsWith("-gif"));
  const old = { ...env.docs.get(document), gifVersion: 1 };
  env.docs.set(document, old);

  env.state.failStorage = true;
  await assert.rejects(env.generate(animated, "key"), { code: "unavailable" });
  assert.equal(env.docs.get(document).status, "ready");
  assert.equal(env.docs.get(document).imageUrl, old.imageUrl);

  env.state.failStorage = false;
  const updated = await env.generate(animated, "key");
  assert.equal(updated.gifVersion, 3);
  assert.notEqual(updated.imageUrl, old.imageUrl);
  assert.equal((await env.generate(animated, "key")).reused, true);
  assert.equal(env.calls(), 0);

  const decoded = sharp(env.files.get(updated.storagePath), { animated: true });
  const { pages, delay } = await decoded.metadata();
  assert.equal(pages, 20);
  assert.equal(delay[0], 600);
  assert.equal(delay[10], 600);
  const { data, info } = await decoded.raw().toBuffer({ resolveWithObject: true });
  const stride = info.width * (info.height / pages) * info.channels;
  const frame = index => data.subarray(index * stride, (index + 1) * stride);
  assert.notDeepEqual(frame(0), frame(10));
  for (let i = 1; i < 10; i++) assert.deepEqual(frame(i), frame(pages - i));
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
