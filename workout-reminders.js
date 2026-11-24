"use strict";

const GymReminders = {
  native: window.GymOSAndroid || null,
  timer: null,
  request(command, data = {}) {
    if (!this.native) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const channel = this.native;
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        channel.removeEventListener("message", onMessage);
        reject(new Error("Android no respondió."));
      }, command === "signIn" || command === "schedule" ? 180000 : 15000);
      function onMessage(event) {
        const reply = JSON.parse(event.data);
        if (reply.id !== id) return;
        clearTimeout(timeout);
        channel.removeEventListener("message", onMessage);
        if (reply.error) reject(new Error(reply.error));
        else resolve(reply.value);
      }
      channel.addEventListener("message", onMessage);
      channel.postMessage(JSON.stringify({ id, command, ...data }));
    });
  },
  async schedule(at, exercise, onDue) {
    clearTimeout(this.timer);
    if (this.native) await this.request("schedule", { at, exercise });
    else this.watch(at, onDue);
  },
  requestRestPermission() {
    if (this.native || this.requestedRestPermission || !window.Notification ||
        Notification.permission !== "default" || navigator.userActivation?.isActive === false) return;
    this.requestedRestPermission = true;
    Notification.requestPermission().catch(console.warn);
  },
  scheduleRest(at, nextExercise) {
    if (!this.native) return;
    this.request("scheduleRest", { at, nextExercise }).catch(error => {
      if (/activa/i.test(error.message) && !this.restPermissionShown) {
        this.restPermissionShown = true;
        toast("Avisos de descanso", error.message, "warn");
      }
    });
  },
  cancelRest() {
    this.request("cancelRest").catch(console.warn);
  },
  finishRest(at, nextExercise) {
    if (this.native) {
      this.request("finishRest", { at }).catch(console.warn);
      return;
    }
    if (!window.Notification || Notification.permission !== "granted") return;
    const text = nextExercise ? "Es hora del siguiente ejercicio." : "Es hora de la siguiente serie.";
    const worker = navigator.serviceWorker?.controller;
    if (worker) {
      worker.postMessage({ type: "REST_FINISHED", text });
    } else {
      try { new Notification("Descanso terminado", { body: text, tag: "gymos-rest" }); }
      catch { /* El aviso sonoro sigue disponible. */ }
    }
  },
  watch(at, onDue) {
    clearTimeout(this.timer);
    if (!this.native && at > Date.now()) this.timer = setTimeout(onDue, at - Date.now());
  },
  cancel() {
    clearTimeout(this.timer);
    this.request("cancel").catch(console.warn);
  }
};

window.GymReminders = GymReminders;
