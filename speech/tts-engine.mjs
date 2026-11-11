// speech/tts-engine.mjs — Text-to-Speech engine wrapper around the native
// window.speechSynthesis API. Produces Arabic speech for detected captions.
// State machine: IDLE, DETECTING, READY, PLAYING, PAUSED, SEEKING, ERROR

export const TTS_STATE = {
  IDLE: 'IDLE',
  DETECTING: 'DETECTING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  SEEKING: 'SEEKING',
  ERROR: 'ERROR'
};

export class TTSEngine {
  constructor(voiceManager, options = {}) {
    this.voiceManager = voiceManager;
    this.options = {
      preferredLang: options.preferredLang || 'ar',
      minRate: options.minRate !== undefined ? options.minRate : 0.7,
      maxRate: options.maxRate !== undefined ? options.maxRate : 1.5,
      defaultRate: options.defaultRate !== undefined ? options.defaultRate : 1.0,
      defaultVolume: options.defaultVolume !== undefined ? options.defaultVolume : 1.0,
      defaultPitch: options.defaultPitch !== undefined ? options.defaultPitch : 1.0,
      delayedCaptionPolicy: options.delayedCaptionPolicy || 'cancel',
      maxCueAgeMs: options.maxCueAgeMs !== undefined ? options.maxCueAgeMs : 5000,
      ...options
    };

    if (typeof window === 'undefined' || !window.speechSynthesis) {
      throw new Error(
        'SpeechSynthesis API is not available in this environment. ' +
        'This browser does not support the Web Speech API.'
      );
    }

    this.synth = window.speechSynthesis;
    this.utterance = null;
    this.queue = [];
    this.processing = false;

    // State machine
    this.state = TTS_STATE.IDLE;
    this.error = null;

    // Current utterance tracking
    this.currentCueId = null;
    this.currentCueText = null;
    this.lastSpokenCueId = null;
    this.lastSpokenCueText = null;
    this.activeCueStartTime = null;

    // Speech settings
    this.rate = this.options.defaultRate;
    this.volume = this.options.defaultVolume;
    this.pitch = this.options.defaultPitch;
    this.voice = null;
    this.lang = this.options.preferredLang;

    // Event listeners
    this.listeners = new Map();

    // Bind handlers
    this._onUtteranceStart = this._onUtteranceStart.bind(this);
    this._onUtteranceEnd = this._onUtteranceEnd.bind(this);
    this._onUtteranceError = this._onUtteranceError.bind(this);
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(data);
        } catch (err) {
          console.error(`[CaptionVoice] TTS event listener error (${event}):`, err);
        }
      }
    }
  }

  _setState(newState) {
    const oldState = this.state;
    this.state = newState;
    this.emit('statechange', { oldState, newState });
  }

  _onUtteranceStart() {
    this._speaking = true;
    this._paused = false;
    this.emit('utterancestart', { text: this.currentCueText });
  }

  _onUtteranceEnd() {
    this._speaking = false;
    this._paused = false;
    this.utterance = null;
    this.emit('utteranceend', { text: this.currentCueText });
    this._processNext();
  }

  _onUtteranceError(event) {
    console.error('[CaptionVoice] TTS error:', event.error);
    this._speaking = false;
    this._paused = false;
    this.utterance = null;
    this.error = event.error;
    this._setState(TTS_STATE.ERROR);
    this.emit('utteranceerror', { error: event.error });
    this._processNext();
  }

  isSpeaking() {
    return this.synth ? (this.synth.speaking || !!this._speaking) : !!this._speaking;
  }

  isPaused() {
    return !!this._paused;
  }

  isReady() {
    return this.state === TTS_STATE.READY || this.state === TTS_STATE.PLAYING;
  }

  getSettings() {
    return {
      rate: this.rate,
      volume: this.volume,
      pitch: this.pitch,
      lang: this.lang,
      voice: this.voice,
      state: this.state
    };
  }

  updateSettings(settings) {
    if (settings.rate !== undefined) {
      this.rate = Math.max(this.options.minRate, Math.min(this.options.maxRate, settings.rate));
    }
    if (settings.volume !== undefined) {
      this.volume = Math.max(0, Math.min(1, settings.volume));
    }
    if (settings.pitch !== undefined) {
      this.pitch = Math.max(0, Math.min(2, settings.pitch));
    }
    if (settings.lang) {
      this.lang = settings.lang;
    }
    if (settings.voice !== undefined) {
      this.voice = settings.voice;
    }
    if (settings.autoSync !== undefined) {
      this.autoSync = settings.autoSync;
    }
    if (settings.delayedCaptionPolicy !== undefined) {
      this.options.delayedCaptionPolicy = settings.delayedCaptionPolicy;
    }
  }

  setVoice(voice) {
    this.voice = voice;
  }

  start() {
    this._setState(TTS_STATE.READY);
    this.emit('started');
  }

  stop() {
    this.cancel();
    this._setState(TTS_STATE.IDLE);
    this.emit('stopped');
  }

  cancel() {
    if (this.synth) {
      this.synth.cancel();
    }
    this.queue = [];
    this.processing = false;
    this.currentCueId = null;
    this.currentCueText = null;
    this.emit('cancelled');
  }

  pause() {
    if (this.synth && this.isSpeaking() && !this._paused) {
      this.synth.pause();
      this._paused = true;
      this._setState(TTS_STATE.PAUSED);
      this.emit('paused');
    }
  }

  resume() {
    if (this.synth && this._paused) {
      this.synth.resume();
      this._paused = false;
      this._setState(TTS_STATE.PLAYING);
      this.emit('resumed');
    }
  }

  speak(text, lang, options = {}) {
    if (!this.synth) {
      console.error('[CaptionVoice] speechSynthesis not available');
      return;
    }
    if (!text || !text.trim()) return;

    // Prevent duplicate playback
    const cueId = `${text}-${options.startTime || 0}-${options.endTime || 0}`;
    if (cueId === this.lastSpokenCueId) return;

    // Check delayed caption policy
    if (this.options.delayedCaptionPolicy === 'drop' && options.startTime !== undefined) {
      const now = Date.now() / 1000;
      const cueAge = now - options.startTime;
      if (cueAge > this.options.maxCueAgeMs / 1000) {
        // Skip stale cue
        return;
      }
    }

    this.lastSpokenCueId = cueId;
    this.currentCueId = cueId;
    this.currentCueText = text;

    this.queue.push({
      text: String(text),
      lang: lang || this.lang,
      startTime: options.startTime,
      endTime: options.endTime
    });

    this._setState(TTS_STATE.PLAYING);
    this.process();
  }

  async process() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length) {
      const item = this.queue.shift();
      await this.say(item.text, item.lang);
    }
    this.processing = false;
    if (this.queue.length === 0) {
      this._setState(TTS_STATE.READY);
    }
  }

  say(text, lang) {
    return new Promise((resolve) => {
      if (!this.synth) {
        resolve();
        return;
      }
      this.synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang || this.lang;
      utterance.rate = this.rate;
      utterance.volume = this.volume;
      utterance.pitch = this.pitch;

      if (this.voice) {
        utterance.voice = this.voice;
      }

      this.utterance = utterance;
      this._speaking = true;
      this._paused = false;

      utterance.onstart = this._onUtteranceStart;
      utterance.onend = () => {
        this._onUtteranceEnd();
        resolve();
      };
      utterance.onerror = (event) => {
        this._onUtteranceError(event);
        resolve();
      };

      this.synth.speak(utterance);
    });
  }

  _processNext() {
    // Process next item in queue if any
    if (this.queue.length > 0 && !this.processing) {
      this.process();
    }
  }

  onSubtitleChange(cue) {
    if (this.state === TTS_STATE.PAUSED) {
      // Don't speak while paused
      return;
    }
    if (this.state === TTS_STATE.SEEKING) {
      // Don't speak stale cues from seeking
      return;
    }
    this.speak(cue.text, 'ar', {
      startTime: cue.startTime,
      endTime: cue.endTime
    });
  }

  onVideoPause() {
    this.pause();
  }

  onVideoResume() {
    this.resume();
  }

  onSeek() {
    this.cancel();
    this._setState(TTS_STATE.SEEKING);
    this.currentCueId = null;
    this.currentCueText = null;
  }

  onVideoEnd() {
    this.cancel();
    this._setState(TTS_STATE.IDLE);
    this.currentCueId = null;
    this.currentCueText = null;
    this.lastSpokenCueId = null;
    this.lastSpokenCueText = null;
  }

  destroy() {
    this.cancel();
    this.listeners.clear();
    this._setState(TTS_STATE.IDLE);
  }
}
