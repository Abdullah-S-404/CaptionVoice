// content/subtitle-detector.mjs — Coordinates subtitle detection across all video elements.
// Primary method: TextTrack API. Secondary method: DOM Caption Adapter. Fallback: Manual VTT import.

// (Self-contained in content.bundle.js; standalone definitions here for reference)

export class SubtitleDetector {
  constructor(videoDetector, ttsEngine) {
    this.videoDetector = videoDetector;
    this.ttsEngine = ttsEngine;
    this.adapters = new Map(); // video element -> { texttrack, dom }
    this.isRunning = false;
    this.importedVTT = null; // { cues: [{start, end, text}], currentIndex: -1 }
    this.onSubtitleChange = null;
    this.lastSpokenCueId = '';
  }

  start() {
    this.isRunning = true;

    // Set up video detector callbacks
    this.videoDetector.onVideoFound = (video) => {
      this.createAdaptersForVideo(video);
    };

    this.videoDetector.onVideoRemoved = (video) => {
      this.removeAdaptersForVideo(video);
    };

    // Scan existing videos
    this.videoDetector.start();
  }

  stop() {
    this.isRunning = false;
    this.videoDetector.stop();

    // Destroy all adapters
    for (const [video, adapters] of this.adapters) {
      adapters.texttrack.destroy();
      adapters.dom.destroy();
    }
    this.adapters.clear();
  }

  createAdaptersForVideo(video) {
    if (this.adapters.has(video)) return;

    const texttrack = new TextTrackAdapter({
      onCue: (cue) => this.handleNewCue(cue, video)
    });
    const dom = new DOMCaptionAdapter({
      onCaption: (caption) => this.handleNewCue(caption, video)
    });

    texttrack.attach(video);
    dom.observe(document);

    // Sync TTS state with video playback
    const onPause = () => { if (this.ttsEngine) this.ttsEngine.onVideoPause(); };
    const onPlay = () => { if (this.ttsEngine) this.ttsEngine.onVideoResume(); };
    const onSeeking = () => {
      this.lastSpokenCueId = '';
      if (this.ttsEngine) this.ttsEngine.onSeek();
    };
    const onEnded = () => {
      this.lastSpokenCueId = '';
      if (this.ttsEngine) this.ttsEngine.onVideoEnd();
    };

    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('ended', onEnded);

    this.adapters.set(video, {
      texttrack,
      dom,
      listeners: { onPause, onPlay, onSeeking, onEnded }
    });
  }

  removeAdaptersForVideo(video) {
    const adapters = this.adapters.get(video);
    if (adapters) {
      if (adapters.listeners) {
        video.removeEventListener('pause', adapters.listeners.onPause);
        video.removeEventListener('play', adapters.listeners.onPlay);
        video.removeEventListener('seeking', adapters.listeners.onSeeking);
        video.removeEventListener('ended', adapters.listeners.onEnded);
      }
      adapters.texttrack.destroy();
      adapters.dom.destroy();
      this.adapters.delete(video);
    }
  }

  handleNewCue(cue, video) {
    if (!this.isRunning) return;

    // Prevent duplicate playback
    const cueId = `${cue.text}-${cue.startTime || 0}-${cue.endTime || 0}`;
    if (cueId === this.lastSpokenCueId) return;

    // If importing VTT, use that instead
    if (this.importedVTT) {
      this.handleVTTCue(video);
      return;
    }

    this.lastSpokenCueId = cueId;

    // Notify background & popup
    try {
      chrome.runtime.sendMessage({
        type: 'SUBTITLE_ACTIVE',
        payload: { text: cue.text }
      }).catch(() => {});
    } catch (_) {}

    // Notify callback
    if (this.onSubtitleChange) {
      this.onSubtitleChange(cue, video);
    }

    // Speak the cue via TTS engine
    if (this.ttsEngine && typeof this.ttsEngine.speak === 'function') {
      this.ttsEngine.speak(cue.text, 'ar', {
        startTime: cue.startTime || 0,
        endTime: cue.endTime || 0
      });
    }
  }

  handleVTTCue(video) {
    if (!this.importedVTT) return;

    const currentTime = video.currentTime || 0;
    const cues = this.importedVTT.cues;

    // Find the current active cue
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      if (currentTime >= cue.start && currentTime < cue.end) {
        if (i !== this.importedVTT.currentIndex) {
          this.importedVTT.currentIndex = i;

          const cueId = `vtt-${i}-${cue.text}`;
          if (cueId === this.lastSpokenCueId) return;
          this.lastSpokenCueId = cueId;

          if (this.ttsEngine && typeof this.ttsEngine.speak === 'function') {
            this.ttsEngine.speak(cue.text, 'ar', {
              startTime: cue.start,
              endTime: cue.end
            });
          }
        }
        break;
      }
    }
  }

  importVTT(vttContent) {
    try {
      const cues = this.parseVTT(vttContent);
      this.importedVTT = {
        cues: cues,
        currentIndex: -1
      };
      this.lastSpokenCueId = '';
      return { success: true, cueCount: cues.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  parseVTT(vttContent) {
    const cues = [];
    const lines = vttContent.split('\n');
    let i = 0;

    // Skip WEBVTT header
    while (i < lines.length && !lines[i].includes('-->')) {
      i++;
    }

    while (i < lines.length) {
      const timeLine = lines[i].trim();
      if (!timeLine.includes('-->')) {
        i++;
        continue;
      }

      const timeMatch = timeLine.match(/(\d+:\d{2}:\d{2}\.\d+)\s*-->\s*(\d+:\d{2}:\d{2}\.\d+)/);
      if (!timeMatch) {
        i++;
        continue;
      }

      const start = this.parseVTTTime(timeMatch[1]);
      const end = this.parseVTTTime(timeMatch[2]);

      const textLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
        textLines.push(lines[i].trim());
        i++;
      }

      if (textLines.length > 0) {
        cues.push({
          start: start,
          end: end,
          text: textLines.join(' ')
        });
      }
    }

    return cues;
  }

  parseVTTTime(timeStr) {
    const parts = timeStr.split(':');
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    const secondsParts = parts[2].split('.');
    const seconds = parseInt(secondsParts[0], 10) || 0;
    const milliseconds = parseInt(secondsParts[1], 10) || 0;
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  }

  clearVTT() {
    this.importedVTT = null;
    this.lastSpokenCueId = '';
  }

  getSubtitleInfo() {
    const videos = this.videoDetector.getVideos();
    if (videos.length === 0) return null;

    const primaryVideo = videos[0];
    const adapters = this.adapters.get(primaryVideo);
    if (!adapters) return null;

    const texttrackInfo = adapters.texttrack.getActiveTrackInfo();
    const tracksInfo = adapters.texttrack.getTracksInfo();
    const hasContainer = adapters.dom.hasContainer();
    const containerSelector = adapters.dom.getContainerSelector();

    return {
      videoCount: this.videoDetector.getVideoCount(),
      tracks: tracksInfo,
      activeTrack: texttrackInfo,
      hasArabicTrack: adapters.texttrack.hasArabicTrack(),
      isArabicActive: adapters.texttrack.isArabicActive(),
      usesDOMSource: hasContainer,
      captionContainerSelector: containerSelector,
      importedVTT: this.importedVTT ? { cueCount: this.importedVTT.cues.length } : null
    };
  }

  onSubtitleChanged(callback) {
    this.onSubtitleChange = callback;
  }
}
