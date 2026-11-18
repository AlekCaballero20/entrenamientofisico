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
