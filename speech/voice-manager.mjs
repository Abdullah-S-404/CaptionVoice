// speech/voice-manager.mjs — Manages available SpeechSynthesis voices, with
// preference for Arabic voices. Caches voices asynchronously since the browser
// loads them on demand.

export class VoiceManager {
  constructor({ preferredLang = 'ar' } = {}) {
    this.preferredLang = preferredLang;
    this.voices = [];
    this.loaded = false;
    this.readyPromise = null;
  }

  load() {
    if (this.readyPromise) return this.readyPromise;
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!synth) {
      this.loaded = true;
      this.readyPromise = Promise.resolve(this.voices);
      return this.readyPromise;
    }

    const loadVoices = () => {
      this.voices = synth.getVoices() || [];
      this.loaded = true;
      return this.voices;
    };

    // Chrome/Edge fire 'voiceschanged' when voices are asynchronously loaded.
    if (synth.getVoices().length) {
      loadVoices();
      this.readyPromise = Promise.resolve(this.voices);
    } else {
      this.readyPromise = new Promise((resolve) => {
        const onVoicesChanged = () => {
          loadVoices();
          synth.removeEventListener('voiceschanged', onVoicesChanged);
          resolve(this.voices);
        };
        synth.addEventListener('voiceschanged', onVoicesChanged);
        // Safety timeout: voiceschanged may not fire in all Edge versions.
        setTimeout(() => {
          synth.removeEventListener('voiceschanged', onVoicesChanged);
          loadVoices();
          resolve(this.voices);
        }, 2000);
      });
    }
    return this.readyPromise;
  }

  getVoices() {
    return [...this.voices];
  }

  findVoice(lang) {
    if (!lang) return null;
    const target = lang.toLowerCase();
    // Exact match first (e.g. 'ar-SA'), then prefix match ('ar'), then any Arabic.
    let match =
      this.voices.find((v) => v.lang && v.lang.toLowerCase() === target) ||
      this.voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(target)) ||
      this.voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('ar'));
    return match || null;
  }

  getArabicVoices() {
    return this.voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('ar'));
  }

  isArabicVoice(voice) {
    return voice.lang && voice.lang.toLowerCase().startsWith('ar');
  }

  getVoiceList(arabicOnly = true) {
    const voices = arabicOnly ? this.getArabicVoices() : this.getVoices();
    return voices.map((voice) => ({
      name: voice.name,
      label: voice.name,
      value: voice.voiceURI || voice.name,
      lang: voice.lang,
      local: voice.localService || false,
      default: voice.default || false
    }));
  }

  getSelectedVoice() {
    return this._selectedVoice || null;
  }

  setSelectedVoice(voice) {
    this._selectedVoice = voice;
  }
}
