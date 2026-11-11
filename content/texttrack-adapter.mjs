// content/texttrack-adapter.mjs — HTML5 TextTrack API adapter for closed captions.
// Attaches to a single video element and calls onCue when a new active cue appears.

export class TextTrackAdapter {
  constructor({ onCue = () => {}, options = {} } = {}) {
    this.onCue = onCue;
    this.options = options;
    this.video = null;
    this.trackHandlers = new Map(); // track -> handler function
    this.boundOnAddTrack = this.onAddTrack.bind(this);
    this.lastCueText = '';
    this.lastCueIndex = -1;
  }

  attach(video) {
    if (!video || this.video === video) return;
    this.detach();
    this.video = video;
    this.bindTracks(video);
    if (this.video.textTracks) {
      this.video.textTracks.addEventListener('addtrack', this.boundOnAddTrack);
    }
  }

  onAddTrack(event) {
    const track = event.track;
    if (
      track &&
      (track.kind === 'captions' || track.kind === 'subtitles')
    ) {
      this.bindTrack(track);
    }
  }

  bindTracks(video) {
    const tracks = video.textTracks || [];
    for (const track of tracks) {
      this.bindTrack(track);
    }
  }

  bindTrack(track) {
    if (!track || this.trackHandlers.has(track)) return;
    const handler = () => {
      const cues = track.activeCues || [];
      if (cues.length > 0) {
        const cue = cues[0];
        const cueIndex = this.getCueIndex(track, cue);
        // Only emit if cue text or index changed (deduplication)
        if (cue.text !== this.lastCueText || cueIndex !== this.lastCueIndex) {
          this.lastCueText = cue.text;
          this.lastCueIndex = cueIndex;
          this.onCue({
            text: cue.text,
            startTime: cue.startTime,
            endTime: cue.endTime,
            id: cue.id || '',
            index: cueIndex,
            trackKind: track.kind,
            trackLanguage: track.language,
            trackLabel: track.label
          });
        }
      } else {
        // No active cues — reset tracking
        this.lastCueText = '';
        this.lastCueIndex = -1;
      }
    };
    track.addEventListener('cuechange', handler);
    this.trackHandlers.set(track, handler);
    // Prefer captions mode
    if (track.kind === 'captions') {
      track.mode = 'showing';
    }
  }

  getCueIndex(track, cue) {
    const cues = track.cues || [];
    for (let i = 0; i < cues.length; i++) {
      if (cues[i] === cue) return i;
    }
    return -1;
  }

  getActiveTrackInfo() {
    if (!this.video || !this.video.textTracks) return null;
    for (let i = 0; i < this.video.textTracks.length; i++) {
      const track = this.video.textTracks[i];
      if (track.mode === 'showing') {
        return {
          index: i,
          label: track.label || '',
          language: track.language || '',
          kind: track.kind || '',
          mode: track.mode || ''
        };
      }
    }
    return null;
  }

  getTracksInfo() {
    if (!this.video || !this.video.textTracks) return [];
    const info = [];
    for (let i = 0; i < this.video.textTracks.length; i++) {
      const track = this.video.textTracks[i];
      info.push({
        index: i,
        label: track.label || '',
        language: track.language || '',
        kind: track.kind || '',
        mode: track.mode || '',
        activeCues: track.activeCues ? track.activeCues.length : 0,
        totalCues: track.cues ? track.cues.length : 0
      });
    }
    return info;
  }

  hasArabicTrack() {
    if (!this.video || !this.video.textTracks) return false;
    for (let i = 0; i < this.video.textTracks.length; i++) {
      const track = this.video.textTracks[i];
      if (this.isArabicLanguage(track.language, track.label)) {
        return true;
      }
    }
    return false;
  }

  isArabicLanguage(language, label) {
    const lang = (language || '').toLowerCase();
    const lbl = (label || '').toLowerCase();
    if (lang === 'ar' || lang.startsWith('ar-')) return true;
    const arabicKeywords = ['arabic', 'العربية', 'عربي', 'ar-sa', 'ar-eg'];
    return arabicKeywords.some(kw => lbl.includes(kw));
  }

  isArabicActive() {
    const active = this.getActiveTrackInfo();
    return active ? this.isArabicLanguage(active.language, active.label) : false;
  }

  detach() {
    if (this.video) {
      if (this.video.textTracks) {
        this.video.textTracks.removeEventListener('addtrack', this.boundOnAddTrack);
      }
      this.video = null;
    }
    for (const [track, handler] of this.trackHandlers) {
      track.removeEventListener('cuechange', handler);
    }
    this.trackHandlers.clear();
    this.lastCueText = '';
    this.lastCueIndex = -1;
  }

  destroy() {
    this.detach();
  }
}
