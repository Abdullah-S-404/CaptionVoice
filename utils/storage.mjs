// utils/storage.mjs — Thin wrapper around chrome.storage.local for CaptionVoice.
export class Storage {
  constructor({ options = {} } = {}) {
    this.options = { prefix: 'captionvoice.', ...options };
    this.ready = this.ensureReady();
  }

  ensureReady() {
    return new Promise((resolve) => {
      resolve();
    });
  }

  async get(key, defaultValue = null) {
    await this.ready;
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        return defaultValue;
      }
      const fullKey = this.options.prefix + key;
      const result = await chrome.storage.local.get([fullKey, key]);
      if (result[fullKey] !== undefined) return result[fullKey];
      if (result[key] !== undefined) return result[key];
      return defaultValue;
    } catch (err) {
      console.error('[CaptionVoice] Storage get error:', err);
      return defaultValue;
    }
  }

  async set(key, value) {
    await this.ready;
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        return;
      }
      const fullKey = this.options.prefix + key;
      await chrome.storage.local.set({ [fullKey]: value, [key]: value });
    } catch (err) {
      console.error('[CaptionVoice] Storage set error:', err);
      throw err;
    }
  }

  async getSettings() {
    return this.get('settings', {});
  }

  async saveSettings(settings) {
    return this.set('settings', settings);
  }

  async getStats() {
    return this.get('stats', { captionsRead: 0, sessions: 0 });
  }

  async saveStats(stats) {
    return this.set('stats', stats);
  }
}
