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
  async getRestSettings() {
    if (this.native) return this.request("restSettings");
    return { available: !!window.Notification, enabled: window.Notification?.permission === "granted",
      blocked: window.Notification?.permission === "denied" };
  },
  enableRestNotifications() {
    if (this.native) return this.request("enableRestNotifications");
    if (window.Notification?.permission === "default") return Notification.requestPermission();
  },
  async testRestNotification() {
    if (this.native) return this.request("testRestNotification");
    return this.showRestNotification("Prueba de descanso", "Así te avisará GymOS al terminar el descanso.");
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
    this.showRestNotification("Descanso terminado", text).catch(console.warn);
  },
  async showRestNotification(title, body) {
    if (!window.Notification || Notification.permission !== "granted") {
      throw new Error("Activa las notificaciones de GymOS primero.");
    }
    const registration = await navigator.serviceWorker?.getRegistration();
    const options = { body, tag: title === "Descanso terminado" ? "gymos-rest" : "gymos-rest-test", icon: "./icons/icon-192.png" };
    if (registration?.active) await registration.showNotification(title, options);
    else new Notification(title, options);
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
