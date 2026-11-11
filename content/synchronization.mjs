// content/synchronization.js — Synchronizes caption text with TTS playback position.
// Keeps a short history of spoken captions so the UI can highlight the current line.
export class Synchronization {
  constructor({ options = {} } = {}) {
    this.options = { maxHistory: 50, ...options };
    this.history = [];
    this.currentIndex = -1;
    this.callbacks = new Set();
  }

  track(text) {
    const entry = { text: String(text), timestamp: Date.now() };
    this.history.push(entry);
    if (this.history.length > this.options.maxHistory) {
      this.history.shift();
    }
    this.currentIndex = this.history.length - 1;
    for (const cb of this.callbacks) {
      try {
        cb(entry);
      } catch (_) {
        // Ignore callback errors
      }
    }
    return entry;
  }

  onChange(callback) {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  getCurrent() {
    return this.currentIndex >= 0
      ? this.history[this.currentIndex]
      : null;
  }

  getHistory() {
    return [...this.history];
  }

  clear() {
    this.history = [];
    this.currentIndex = -1;
  }
}
