const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { catalog } = require("./routine");

function loadHandler(responseIds = Object.keys(catalog).slice(0, 8), status = "ok") {
  const quota = new Map();
  let providerCalls = 0;
  let transactionQueue = Promise.resolve();
  class HttpsError extends Error {
    constructor(code, message, details) { super(message); this.code = code; this.details = details; }
  }
  const db = {
    collection: () => ({ doc: uid => uid }),
    runTransaction(callback) {
      const result = transactionQueue.then(() => callback({
        get: async ref => ({ data: () => quota.get(ref) }),
        set: (ref, value) => quota.set(ref, value)
      }));
      transactionQueue = result.catch(() => {});
      return result;
    }
  };
  const dependencies = {
    "firebase-admin/app": { initializeApp() {} },
    "firebase-admin/firestore": { getFirestore: () => db },
    "firebase-functions/params": { defineSecret: () => ({ value: () => "test-key" }) },
    "firebase-functions/v2/https": { onCall: (options, handler) => handler, HttpsError },
    "firebase-functions/logger": { warn() {} },
    "./routine": require("./routine"),
    "./images": { createImageGenerator: () => null }
  };
  const sandbox = {
    exports: {}, Intl, Date, Set, AbortSignal,
    require: name => dependencies[name],
    fetch: async () => {
      providerCalls++;
      return {
        ok: true,
        json: async () => ({ candidates: [{
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify({ status, exerciseIds: responseIds }) }] }
        }] })
      };
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("./index"), "utf8"), sandbox);
  return { handler: sandbox.exports.generateRoutine, providerCalls: () => providerCalls };
}

function request(uid = "test-user") {
  return {
    auth: { uid, token: { email: "alekcaballeromusic@gmail.com", email_verified: true } },
    data: { minutes: 20, prompt: "Movilidad suave de cuerpo completo" }
  };
}

test("bloquea cuentas ajenas y correos sin verificar antes de llamar al modelo", async () => {
  const { handler, providerCalls } = loadHandler();
  const unsigned = request();
  unsigned.auth.token.email_verified = false;
  const stranger = request();
  stranger.auth.token.email = "otra@example.com";
  for (const req of [{ data: {} }, unsigned, stranger]) {
    await assert.rejects(handler(req), { code: "permission-denied" });
  }
  assert.equal(providerCalls(), 0);
});

test("valida las entradas antes de consumir cuota", async () => {
  const { handler, providerCalls } = loadHandler();
  for (const data of [{ minutes: 30, prompt: "Hola" }, { minutes: 20, prompt: " " },
    { minutes: 20, prompt: "a".repeat(1501) }, { minutes: "20", prompt: "Hola" }]) {
    await assert.rejects(handler({ ...request(), data }), { code: "invalid-argument" });
  }
  assert.equal(providerCalls(), 0);
});

test("10 solicitudes concurrentes consumen la cuota y la siguiente queda bloqueada", async () => {
  const { handler, providerCalls } = loadHandler();
  const results = await Promise.allSettled(Array.from({ length: 11 }, () => handler(request())));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 10);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "resource-exhausted");
  assert.equal(providerCalls(), 10);
  await handler(request("another-user"));
  assert.equal(providerCalls(), 11);
});

test("rechaza selección vacía y ejercicios inventados del proveedor", async () => {
  await assert.rejects(loadHandler([]).handler(request()), { code: "unavailable" });
  await assert.rejects(loadHandler(["inventado"]).handler(request()), { code: "unavailable" });
});

test("admite una descripción de contexto mayor de 300 caracteres", async () => {
  const req = request();
  req.data.prompt = "Movilidad suave para principiantes. ".repeat(12);
  const result = await loadHandler().handler(req);
  assert.equal(result.exercises.length, 8);
});

test("diferencia valoración de salud y restricciones fuera del catálogo", async () => {
  await assert.rejects(loadHandler([], "health_review").handler(request()), error =>
    error.code === "failed-precondition" && error.details?.reason === "health-review" &&
    error.message.includes("valoración individual"));
  await assert.rejects(loadHandler([], "unsupported").handler(request()), error =>
    error.code === "failed-precondition" && error.details?.reason === "unsupported");
});
