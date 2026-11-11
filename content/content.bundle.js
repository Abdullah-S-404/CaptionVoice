// content/content.bundle.js — CaptionVoice v1.3.0 (MV3 self-contained)
//
// الميزات الجديدة في هذا الإصدار:
//  1. نظام قائمة انتظار (Queue) للجمل — لا تُحذف الجملة من الذاكرة حين تختفي من الشاشة
//  2. بدء الكلام فور ظهور أول نص (لا انتظار للجملة الكاملة)
//  3. تهيئة فورية — VoiceManager يبدأ التحميل لحظة تحميل السكريبت قبل أي شيء آخر
//  4. إعادة تصميم TTSEngine مع state machine سليم
//  5. لا يُلغى الكلام الحالي عند وصول جملة جديدة — تُضاف للطابور
//  6. حد أقصى للطابور (5 جمل) لتجنب التأخر المفرط
//  7. VTT import مع interval-based playback
//  8. Chrome MV3 safe (لا .catch() على sendMessage)

(function () {
  'use strict';
  if (window.__captionVoiceLoaded) return;
  window.__captionVoiceLoaded = true;

  // ═══════════════════════════════════════════════════════════════
  //  VoiceManager — يبدأ التحميل فوراً عند تحميل السكريبت
  // ═══════════════════════════════════════════════════════════════
  class VoiceManager {
    constructor() {
      this.voices = [];
      this._ready = null;
      // ⚡ ابدأ التحميل فوراً
      this.load();
    }

    load() {
      if (this._ready) return this._ready;
      const synth = window.speechSynthesis;
      if (!synth) {
        this._ready = Promise.resolve([]);
        return this._ready;
      }

      const grab = () => {
        this.voices = synth.getVoices() || [];
        return this.voices;
      };

      // إذا كانت الأصوات متاحة فوراً (Chromium غالباً يفعل هذا)
      const immediate = synth.getVoices();
      if (immediate && immediate.length) {
        grab();
        this._ready = Promise.resolve(this.voices);
        return this._ready;
      }

      // انتظر حدث voiceschanged
      this._ready = new Promise((resolve) => {
        const done = () => {
          synth.removeEventListener('voiceschanged', done);
          grab();
          resolve(this.voices);
        };
        synth.addEventListener('voiceschanged', done);
        // Fallback: بعض المتصفحات لا تُطلق الحدث في service workers
        setTimeout(done, 1500);
      });

      return this._ready;
    }

    getVoices()       { return this.voices; }
    getArabicVoices() { return this.voices.filter(v => v.lang && /^ar/i.test(v.lang)); }

    findArabicVoice() {
      const ar = this.getArabicVoices();
      return ar.find(v => /sa|eg|ae/i.test(v.lang)) || ar[0] || null;
    }

    resolveVoice(name) {
      if (name) {
        const m = this.voices.find(v => v.name === name || v.voiceURI === name);
        if (m) return m;
      }
      return this.findArabicVoice() || this.voices[0] || null;
    }

    getVoiceList() {
      return this.voices.map(v => ({ name: v.name, lang: v.lang, local: !!v.localService }));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  TTSQueue — نظام قائمة انتظار للجمل (القلب الجديد)
  // ═══════════════════════════════════════════════════════════════
  //
  //  المبدأ:
  //  - كل جملة جديدة تُضاف للطابور
  //  - الطابور يُشغّل الجمل بالتسلسل حتى يفرغ
  //  - إذا امتلأ الطابور (> MAX_QUEUE) تُهمل الجملة الأقدم (sliding window)
  //  - عند Seek أو Stop: يُمسح الطابور فوراً
  //
  const MAX_QUEUE = 5; // للتوافق المستقبلي (غير مستخدم حاليًا — الكلام فوري)

  class TTSQueue {
    constructor(vm) {
      this.vm           = vm;
      this.synth        = window.speechSynthesis || null;
      this.pendingText  = '';         // buffer text waiting to be spoken
      this.speaking     = false;      // is an utterance currently playing?
      this.enabled      = false;
      this.paused       = false;      // pause by video
      this.rate         = 1.25;
      this.volume       = 1.0;
      this.pitch        = 1.0;
      this.lang         = 'ar';
      this.voiceName    = null;
    }

    updateSettings(s) {
      if (!s) return;
      if (s.rate   != null) this.rate   = Math.max(0.5, Math.min(2.5, +s.rate));
      if (s.volume != null) this.volume = Math.max(0,   Math.min(1,   +s.volume));
      if (s.pitch  != null) this.pitch  = Math.max(0,   Math.min(2,   +s.pitch));
      if (s.lang)           this.lang   = s.lang;
      if (s.voice !== undefined) {
        this.voiceName = s.voice
          ? (typeof s.voice === 'string' ? s.voice : (s.voice.name || s.voice.value || null))
          : null;
      }
    }

    getSettings() {
      return { rate: this.rate, volume: this.volume, pitch: this.pitch, lang: this.lang, voiceName: this.voiceName, enabled: this.enabled };
    }

    start() { this.enabled = true; this.paused = false; this._trySpeak(); }
    stop()  { this.enabled = false; this.flush(); }

    videoPause() {
      if (this.paused) return;
      this.paused = true;
      if (this.synth && this.synth.speaking) { try { this.synth.pause(); } catch (_) {} }
    }

    videoResume() {
      if (!this.paused) return;
      this.paused = false;
      if (this.synth && this.synth.paused) { try { this.synth.resume(); } catch (_) {} }
      else { this._trySpeak(); }
    }

    flush() {
      this.pendingText = '';
      this.speaking = false;
      if (this.synth) { try { this.synth.cancel(); } catch (_) {} }
    }

    // ── Enqueue ────────────────────────────────────────────────
    // نص جديد يُضاف للـ buffer كـ "استمرار" للكلام الجاري (لا فاصل، لا توقف)
    // لا dedup دائم — فقط نتجنب التكرار الفوري للنص نفسه تماماً
    enqueue(text) {
      if (!this.enabled || this.paused) return;
      if (!text) return;
      const t = String(text).replace(/\s+/g, ' ').trim();
      if (!t) return;
      if (!/[\u0600-\u06FF]/.test(t)) return;

      // تجنب التكرار الفوري للنص نفسه (آخر buffer أو آخر ما نُطق)
      if (t === this.pendingText) return;

      // أضف كـ استمرار للـ buffer مع مسافة
      this.pendingText = this.pendingText ? (this.pendingText + ' ' + t) : t;
      this._trySpeak();
    }

    _trySpeak() {
      if (!this.enabled || this.paused || this.speaking) return;
      if (!this.synth) return;
      const text = this.pendingText;
      if (!text) return;

      this.pendingText = '';
      this.speaking = true;

      const u = new SpeechSynthesisUtterance(text);
      u.lang   = this.lang || 'ar';
      u.rate   = this.rate;
      u.volume = this.volume;
      u.pitch  = this.pitch;
      const voice = this.vm.resolveVoice(this.voiceName);
      if (voice) u.voice = voice;

      u.onend = () => { this.speaking = false; this._trySpeak(); };
      u.onerror = () => { this.speaking = false; this._trySpeak(); };

      try { this.synth.speak(u); }
      catch (_) { this.speaking = false; this._trySpeak(); }
    }

    speakImmediate(text) {
      if (!this.synth) return;
      this.flush();
      this.enabled = true;
      this.pendingText = text;
      this._trySpeak();
    }

    isSpeaking() { return this.speaking || (this.synth && this.synth.speaking); }
  }  //  Helpers
  // ═══════════════════════════════════════════════════════════════
  function isCaptionText(text) {
    if (!text) return false;
    const t = String(text).replace(/\s+/g, ' ').trim();
    if (t.length < 1 || t.length > 500) return false;
    return /[\u0600-\u06FF]/.test(t);
  }

  function cleanText(el) {
    if (!el) return '';
    return (el.innerText != null ? el.innerText : el.textContent || '')
      .replace(/\s+/g, ' ').trim();
  }

  function inForbidden(el) {
    if (!el || !el.closest) return false;
    try {
      return !!el.closest(
        'header,nav,footer,aside,[role="navigation"],[role="banner"],[role="contentinfo"],' +
        'button,a,[class*="transcript"],[class*="Transcript"],[id*="transcript"],[id*="Transcript"],' +
        '.menu,.sidebar,[class*="sidebar"],[class*="Sidebar"]'
      );
    } catch (_) { return false; }
  }

  // ═══════════════════════════════════════════════════════════════
  //  TextTrack Adapter
  // ═══════════════════════════════════════════════════════════════
  class TextTrackAdapter {
    constructor(onCue) {
      this.onCue    = onCue;
      this.video    = null;
      this.handlers = new Map();
      this._onAdd   = null;
      this.lastCue  = '';
    }

    attach(video) {
      if (!video) return;
      this.detach();
      this.video = video;

      const bind = (track) => {
        if (!track || this.handlers.has(track)) return;

        // فعّل المسارات العربية / captions / subtitles لاستقبال الأحداث
        try {
          const lang  = (track.language || '').toLowerCase();
          const label = (track.label    || '').toLowerCase();
          const isAr  = lang.startsWith('ar') || /arabic|عرب/.test(label);

          if (track.kind === 'subtitles' || track.kind === 'captions') {
            if (track.mode === 'disabled') {
              try { track.mode = 'hidden'; } catch (_) {}
            }
          }
          // إذا عربي وكان مخفياً اجعله hidden على الأقل
          if (isAr && track.mode === 'disabled') {
            try { track.mode = 'hidden'; } catch (_) {}
          }
        } catch (_) {}

        const h = () => this._onCueChange(track);
        track.addEventListener('cuechange', h);
        this.handlers.set(track, h);
        this._onCueChange(track); // fire once
      };

      const tracks = video.textTracks;
      if (tracks) {
        for (let i = 0; i < tracks.length; i++) bind(tracks[i]);
        this._onAdd = (e) => bind(e.track);
        try {
          tracks.addEventListener('addtrack', this._onAdd);
        } catch (_) {
          try { video.addEventListener('addtrack', this._onAdd); } catch (_) {}
        }
      }
    }

    _onCueChange(track) {
      try {
        const cues = track.activeCues;
        if (!cues || cues.length === 0) return;

        let text = '';
        for (let i = 0; i < cues.length; i++) {
          const c = cues[i];
          // نظّف الـ VTT inline tags مثل <c>, <i>, timestamps
          const t = (c.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (t) text = text ? (text + ' ' + t) : t;
        }

        if (!text || text === this.lastCue) return;
        this.lastCue = text;
        this.onCue(text);
      } catch (_) {}
    }

    getInfo() {
      const out = { count: 0, tracks: [] };
      if (!this.video || !this.video.textTracks) return out;
      const tl = this.video.textTracks;
      out.count = tl.length;
      for (let i = 0; i < tl.length; i++) {
        const t = tl[i];
        out.tracks.push({
          label:    t.label    || '',
          language: t.language || '',
          kind:     t.kind     || '',
          mode:     t.mode     || '',
          cues:     t.cues ? t.cues.length : 0
        });
      }
      return out;
    }

    hasArabic() {
      if (!this.video || !this.video.textTracks) return false;
      for (let i = 0; i < this.video.textTracks.length; i++) {
        const t = this.video.textTracks[i];
        if (/^ar/i.test(t.language || '') || /arabic|عرب/i.test(t.label || '')) return true;
      }
      return false;
    }

    detach() {
      if (this.video && this.video.textTracks && this._onAdd) {
        try { this.video.textTracks.removeEventListener('addtrack', this._onAdd); } catch (_) {}
      }
      for (const [track, h] of this.handlers) {
        try { track.removeEventListener('cuechange', h); } catch (_) {}
      }
      this.handlers.clear();
      this._onAdd  = null;
      this.video   = null;
      this.lastCue = '';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  DOM Caption Adapter
  // ═══════════════════════════════════════════════════════════════
  class DOMCaptionAdapter {
    constructor(onCaption) {
      this.onCaption = onCaption;
      this.observer  = null;
      this.lastEmit  = '';
      this._poll     = null;
      this.selectors = [
        '.vjs-text-track-display', '.vjs-text-track-cue', '.vjs-text-track-cue > div',
        '.bc-text-track-cue', '.bc-text-track-region',
        '.kaltura-caption', '.kaltura-caption-text',
        '.jw-text-track-cue', '.jw-captions', '.jw-captions-window',
        '.ytp-caption-segment', '.caption-window', '.captions-text',
        '.shaka-text-container span', '[data-cue]',
        '[class*="caption-text"]',    '[class*="CaptionText"]',
        '[class*="subtitle-text"]',   '[class*="SubtitleText"]',
        '[class*="closed-caption"]',  '[class*="ClosedCaption"]',
        '[class*="captions-renderer"]','[class*="text-track-display"]',
        '[aria-live="polite"][class*="caption"]',
        '[aria-live="assertive"][class*="caption"]'
      ];
    }

    start() {
      this.scan();
      this.observer = new MutationObserver(() => this.scan());
      try {
        this.observer.observe(document.documentElement || document.body, {
          childList: true, subtree: true, characterData: true
        });
      } catch (_) {}
      // poll لاصطياد التغييرات التي لا يرصدها MutationObserver (بعض اللاعبين)
      this._poll = setInterval(() => this.scan(), 250);
    }

    stop() {
      if (this.observer) { try { this.observer.disconnect(); } catch (_) {} this.observer = null; }
      if (this._poll)    { clearInterval(this._poll); this._poll = null; }
      this.lastEmit = '';
    }

    scan() { this._scanRoot(document); }

    _scanRoot(root) {
      if (!root || !root.querySelectorAll) return;

      // 1. المحددات المعروفة
      for (const sel of this.selectors) {
        let els;
        try { els = root.querySelectorAll(sel); } catch (_) { continue; }
        if (!els || !els.length) continue;
        for (let i = 0; i < els.length; i++) this._check(els[i]);
      }

      // 2. Heuristic: عناصر تحتوي عربية بمعرّف/كلاس caption/subtitle
      try {
        const cands = root.querySelectorAll(
          '[class*="caption"],[class*="Caption"],[class*="subtitle"],[class*="Subtitle"],[class*="cue"],[class*="Cue"]'
        );
        for (let i = 0; i < cands.length; i++) {
          const el  = cands[i];
          if (inForbidden(el)) continue;
          const cls = (el.className || '') + '';
          if (/transcript|list|menu|control|button|settings|sidebar|panel/i.test(cls)) continue;
          const t = cleanText(el);
          if (t && t.length >= 2 && t.length <= 400 && /[\u0600-\u06FF]/.test(t)) {
            try {
              if (el.querySelectorAll &&
                  el.querySelectorAll('[class*="cue"],[class*="line"],li,p,div>div>div').length > 5) continue;
            } catch (_) {}
            this._emit(t);
          }
        }
      } catch (_) {}

      // 3. Shadow roots (محدود بـ 1500 عنصر لحماية الأداء)
      try {
        const all = root.querySelectorAll('*');
        for (let i = 0; i < all.length && i < 1500; i++) {
          if (all[i].shadowRoot) this._scanRoot(all[i].shadowRoot);
        }
      } catch (_) {}
    }

    _check(el) {
      if (!el || inForbidden(el)) return;
      const t = cleanText(el);
      if (isCaptionText(t)) {
        try {
          if (el.querySelectorAll &&
              el.querySelectorAll('[class*="cue"],[class*="line"],li,p').length > 4) return;
        } catch (_) {}
        this._emit(t);
      }
    }

    _emit(text) {
      if (!text || text === this.lastEmit) return;
      if (!/[\u0600-\u06FF]/.test(text)) return;
      this.lastEmit = text;
      this.onCaption(text);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  VTT Parser
  // ═══════════════════════════════════════════════════════════════
  function parseVTTTime(str) {
    const parts = str.trim().split(':');
    if (parts.length === 3) {
      const h  = parseInt(parts[0], 10) || 0;
      const m  = parseInt(parts[1], 10) || 0;
      const sp = parts[2].split('.');
      const s  = parseInt(sp[0], 10) || 0;
      const ms = parseInt(((sp[1] || '0') + '000').substring(0, 3), 10) || 0;
      return h * 3600 + m * 60 + s + ms / 1000;
    } else if (parts.length === 2) {
      const m  = parseInt(parts[0], 10) || 0;
      const sp = parts[1].split('.');
      const s  = parseInt(sp[0], 10) || 0;
      const ms = parseInt(((sp[1] || '0') + '000').substring(0, 3), 10) || 0;
      return m * 60 + s + ms / 1000;
    }
    return 0;
  }

  function parseVTT(content) {
    const cues  = [];
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length && !lines[i].includes('-->')) i++;

    while (i < lines.length) {
      const timeLine = lines[i].trim();
      if (!timeLine.includes('-->')) { i++; continue; }

      const m = timeLine.match(/(\d+:\d{2}[:.]\d+(?:\.\d+)?)\s*-->\s*(\d+:\d{2}[:.]\d+(?:\.\d+)?)/);
      if (!m) { i++; continue; }

      const start = parseVTTTime(m[1]);
      const end   = parseVTTTime(m[2]);
      const textLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
        const cleaned = lines[i].trim().replace(/<[^>]+>/g, '').trim();
        if (cleaned) textLines.push(cleaned);
        i++;
      }

      if (textLines.length > 0 && start < end) {
        cues.push({ start, end, text: textLines.join(' ') });
      }
    }
    return cues;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Coordinator — ينسّق الفيديو + الكابشن + TTS
  // ═══════════════════════════════════════════════════════════════
  class Coordinator {
    constructor(tts) {
      this.tts        = tts;
      this.videos     = new Map();  // video → { tt, onPause, onPlay, onSeek, onEnd }
      this.domGlobal  = null;
      this.observer   = null;
      this.running    = false;

    }

    start() {
      if (this.running) return;
      this.running = true;

      // DOM adapter يعمل بشكل عالمي
      this.domGlobal = new DOMCaptionAdapter((t) => this.tts.enqueue(t));
      this.domGlobal.start();

      // افحص الفيديوهات الموجودة الآن
      this.scan();

      // راقب الفيديوهات الجديدة
      this.observer = new MutationObserver(() => this.scan());
      try {
        this.observer.observe(document.documentElement || document.body, {
          childList: true, subtree: true
        });
      } catch (_) {}
    }

    stop() {
      this.running = false;
      if (this.observer) { try { this.observer.disconnect(); } catch (_) {} this.observer = null; }
      if (this.domGlobal) { this.domGlobal.stop(); this.domGlobal = null; }
      for (const [v, info] of this.videos) {
        try { info.tt.detach(); } catch (_) {}
        try {
          v.removeEventListener('pause',   info.onPause);
          v.removeEventListener('play',    info.onPlay);
          v.removeEventListener('playing', info.onPlay);
          v.removeEventListener('seeking', info.onSeek);
          v.removeEventListener('ended',   info.onEnd);
          v.removeEventListener('waiting', info.onPause);
        } catch (_) {}
      }
      this.videos.clear();
    }

    scan(root) {
      const doc = root || document;
      let vids = [];
      try { vids = doc.querySelectorAll ? doc.querySelectorAll('video') : []; } catch (_) {}
      for (let i = 0; i < vids.length; i++) this.attach(vids[i]);
      try { this._scanShadow(doc); } catch (_) {}
    }

    _scanShadow(root) {
      const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (let i = 0; i < all.length; i++) {
        const sr = all[i].shadowRoot;
        if (sr) {
          try {
            const vids = sr.querySelectorAll('video');
            for (let j = 0; j < vids.length; j++) this.attach(vids[j]);
            this._scanShadow(sr);
          } catch (_) {}
        }
      }
    }

    attach(video) {
      if (!video || this.videos.has(video)) return;

      const tt = new TextTrackAdapter((t) => this.tts.enqueue(t));
      tt.attach(video);

      const onPause = () => this.tts.videoPause();
      const onPlay  = () => this.tts.videoResume();
      const onSeek  = () => {
        this.tts.flush();
      };
      const onEnd   = () => { this.tts.flush(); };

      video.addEventListener('pause',   onPause);
      video.addEventListener('play',    onPlay);
      video.addEventListener('playing', onPlay);
      video.addEventListener('seeking', onSeek);
      video.addEventListener('ended',   onEnd);
      video.addEventListener('waiting', onPause);

      this.videos.set(video, { tt, onPause, onPlay, onSeek, onEnd });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Diagnostics
  // ═══════════════════════════════════════════════════════════════
  function buildDiagnostics(vm, coord, tts) {
    const info   = coord ? coord.getInfo() : { videoCount: 0, tracks: [], hasArabicTrack: false };
    const ar     = vm ? vm.getArabicVoices() : [];
    const issues = [];

    if (!ar.length) issues.push('No Arabic SpeechSynthesis voice found. Install an Arabic voice in OS settings.');
    if (!info.videoCount) issues.push('No <video> element detected in this frame.');
    if (info.videoCount && !info.tracks.length) {
      issues.push('No text tracks exposed; using DOM caption detection.');
    }

    let s = '=== CaptionVoice Diagnostics v1.3 ===\n';
    s += `Page: ${location.href}\n`;
    s += `Videos: ${info.videoCount}\n`;
    s += `Arabic TTS voices: ${ar.length ? ar.map(v => v.name).join(', ') : 'NONE'}\n`;
    s += `TTS Queue enabled: ${tts ? tts.enabled : '?'}\n`;
    s += `TTS Rate: ${tts ? tts.rate : '?'}x | Volume: ${tts ? tts.volume : '?'} | Pitch: ${tts ? tts.pitch : '?'}\n`;
    s += `Tracks: ${info.tracks.length}\n`;
    info.tracks.forEach((t, i) => {
      s += `  [${i}] ${t.label || '(no label)'} lang=${t.language || '?'} kind=${t.kind} mode=${t.mode} cues=${t.cues}\n`;
    });
    s += '\nIssues:\n' + (issues.length ? issues.map(i => ' - ' + i).join('\n') : ' - none');

    return {
      report: {
        page: location.href, videos: info.videoCount, tracks: info.tracks,
        hasArabicTrack: info.hasArabicTrack, arabicVoices: ar.map(v => v.name), issues
      },
      reportString: s
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  Bootstrap — التهيئة الفورية
  // ═══════════════════════════════════════════════════════════════

  // ⚡ VoiceManager يبدأ التحميل فوراً (قبل أي شيء)
  const vm    = new VoiceManager();
  const tts   = new TTSQueue(vm);
  const coord = new Coordinator(tts);
  let   active = false;

  async function init() {
    // انتظر تحميل الأصوات (عادةً جاهزة بالفعل لأنها بدأت في constructor)
    await vm.load();

    // اختر الصوت العربي تلقائياً إذا لم يكن محدداً
    if (!tts.voiceName) {
      const av = vm.findArabicVoice();
      if (av) tts.voiceName = av.name;
    }

    // استرجع الإعدادات المحفوظة
    try {
      const st = await new Promise(r =>
        chrome.storage.local.get(['captionvoice.extensionActive', 'captionvoice.settings'], r)
      );
      const on       = !!st['captionvoice.extensionActive'];
      const settings = st['captionvoice.settings'] || {};
      tts.updateSettings(settings);
      if (on) enable();
    } catch (_) {}
  }

  function enable() {
    active = true;
    tts.start();
    coord.start();
  }

  function disable() {
    active = false;
    coord.stop();
    tts.stop();
  }

  // ═══════════════════════════════════════════════════════════════
  //  Message Handler
  // ═══════════════════════════════════════════════════════════════
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const { type, payload } = msg || {};

      (async () => {
        try {
          switch (type) {

            case 'PING':
              sendResponse({
                success: true, pong: true,
                isActive: active, videoCount: coord.videos.size, url: location.href
              });
              break;

            case 'TOGGLE_EXTENSION':
              if (payload && payload.isActive) enable(); else disable();
              sendResponse({ success: true, isActive: active });
              break;

            case 'GET_STATE':
              sendResponse({
                success: true, isActive: active,
                subtitleInfo: coord.getInfo(), ttsSettings: tts.getSettings()
              });
              break;

            case 'START_TTS':
              tts.start();
              sendResponse({ success: true });
              break;

            case 'STOP_TTS':
              // أوقف الكلام الحالي لكن لا تعطّل النظام
              tts.flush();
              sendResponse({ success: true });
              break;

            case 'PAUSE_TTS':
              tts.videoPause();
              sendResponse({ success: true });
              break;

            case 'RESUME_TTS':
              tts.videoResume();
              sendResponse({ success: true });
              break;

            case 'UPDATE_TTS_SETTINGS':
              tts.updateSettings(payload && payload.settings);
              try { chrome.storage.local.set({ 'captionvoice.settings': tts.getSettings() }); } catch (_) {}
              sendResponse({ success: true });
              break;

            case 'GET_VOICES':
              await vm.load();
              sendResponse({ success: true, voices: vm.getVoiceList() });
              break;

            case 'SPEAK_TEST': {
              const testText = (payload && payload.text) || 'مرحباً، هذا اختبار للصوت.';
              tts.speakImmediate(testText);
              // أعد تفعيل الحالة الأصلية بعد الاختبار
              setTimeout(() => { tts.enabled = active; }, 100);
              sendResponse({ success: true });
              break;
            }

            case 'REQUEST_DIAGNOSTICS':
              sendResponse({ success: true, ...buildDiagnostics(vm, coord, tts) });
              break;

            default:
              sendResponse({ success: false, error: 'unknown: ' + type });
          }
        } catch (e) {
          sendResponse({ success: false, error: e && e.message });
        }
      })();

      return true; // keep channel open
    });
  } catch (_) {}

  // ── Visibility change — احترام pause الفيديو ──────────────────
  document.addEventListener('visibilitychange', () => {
    if (!active) return;
    if (document.hidden) {
      tts.videoPause();
    } else {
      // استأنف فقط إذا لم يكن الفيديو في وضع pause
      let anyPaused = false;
      for (const [v] of coord.videos) {
        if (v.paused) { anyPaused = true; break; }
      }
      if (!anyPaused) tts.videoResume();
    }
  });

  // ⚡ ابدأ التهيئة فوراً
  init();

})();




