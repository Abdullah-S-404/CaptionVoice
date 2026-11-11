// utils/logger.mjs — Minimal structured logger for CaptionVoice.
export class Logger {
  constructor(options = {}) {
    const opts = typeof options === 'string' ? { namespace: options } : options;
    this.namespace = opts.namespace || 'CaptionVoice';
    this.enabled = opts.enabled !== undefined ? opts.enabled : true;
  }

  log(...args) {
    if (!this.enabled) return;
    console.log(`[${this.namespace}]`, ...args);
  }

  info(...args) {
    if (!this.enabled) return;
    console.info(`[${this.namespace}]`, ...args);
  }

  warn(...args) {
    if (!this.enabled) return;
    console.warn(`[${this.namespace}]`, ...args);
  }

  error(...args) {
    if (!this.enabled) return;
    console.error(`[${this.namespace}]`, ...args);
  }

  debug(...args) {
    if (!this.enabled) return;
    console.debug(`[${this.namespace}]`, ...args);
  }
}
