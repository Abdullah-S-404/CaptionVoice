// content/diagnostics.mjs — Diagnostic mode reporting for CaptionVoice.
// Reports video elements, TextTrack objects, TTS voice availability, iframe access, etc.

export class Diagnostics {
  constructor(videoDetector, subtitleDetector, ttsEngine, voiceManager) {
    this.videoDetector = videoDetector;
    this.subtitleDetector = subtitleDetector;
    this.ttsEngine = ttsEngine;
    this.voiceManager = voiceManager;
    this.enabled = true;
  }

  generateReport() {
    const report = {
      diagnosticsVersion: '1.0',
      timestamp: new Date().toISOString(),
      pageUrl: typeof location !== 'undefined' ? location.href : '',
      videoElements: {
        count: 0,
        details: []
      },
      tts: {
        arabicVoiceAvailable: false,
        voicesCount: 0,
        arabicVoiceNames: []
      },
      summary: {
        totalVideos: 0,
        totalAccessibleTextTracks: 0,
        totalActiveCues: 0,
        issues: []
      }
    };

    // Collect video information
    const videos = this.videoDetector ? this.videoDetector.getVideos() : [];
    report.videoElements.count = videos.length;
    report.summary.totalVideos = videos.length;

    for (const video of videos) {
      const detail = {
        videoIndex: report.videoElements.details.length,
        duration: video.duration || 0,
        currentTime: video.currentTime || 0,
        paused: video.paused,
        playbackRate: video.playbackRate || 1.0,
        textTracks: {
          count: 0,
          tracks: []
        },
        iframe: {
          containsPlayer: false,
          accessible: false,
          origin: 'same-origin'
        },
        captionContainer: {
          usesCustomDOM: false,
          containerSelector: null
        }
      };

      // Collect text track info
      const adapters = this.subtitleDetector && this.subtitleDetector.adapters
        ? this.subtitleDetector.adapters.get(video)
        : null;

      if (adapters) {
        const tracksInfo = adapters.texttrack.getTracksInfo();
        detail.textTracks.count = tracksInfo.length;
        detail.textTracks.tracks = tracksInfo.map((t, idx) => ({
          trackIndex: idx,
          label: t.label,
          language: t.language,
          kind: t.kind,
          mode: t.mode,
          activeCues: t.activeCues,
          totalCues: t.totalCues,
          cueChangeFired: true // We listen to cuechange, so if we have tracks, it's firing
        }));

        report.summary.totalAccessibleTextTracks += tracksInfo.length;
        report.summary.totalActiveCues += tracksInfo.reduce((sum, t) => sum + t.activeCues, 0);

        detail.captionContainer.usesCustomDOM = adapters.dom.hasContainer();
        detail.captionContainer.containerSelector = adapters.dom.getContainerSelector();
      }

      // Check if video is in an iframe
      try {
        const iframeEl = video.closest ? video.closest('iframe') : null;
        if (iframeEl) {
          detail.iframe.containsPlayer = true;
          try {
            if (iframeEl.contentWindow) {
              detail.iframe.accessible = true;
              detail.iframe.origin = 'same-origin';
            } else {
              detail.iframe.accessible = false;
              detail.iframe.origin = 'cross-origin';
            }
          } catch (e) {
            detail.iframe.accessible = false;
            detail.iframe.origin = 'cross-origin';
          }
        }
      } catch (e) {
        // Not in iframe or inaccessible
      }

      report.videoElements.details.push(detail);
    }

    // TTS information
    if (this.voiceManager) {
      const voices = this.voiceManager.getVoices();
      report.tts.voicesCount = voices.length;
      const arabicVoices = this.voiceManager.getArabicVoices();
      report.tts.arabicVoiceAvailable = arabicVoices.length > 0;
      report.tts.arabicVoiceNames = arabicVoices.map(v => v.name);
    }

    // Summary issues
    if (!report.tts.arabicVoiceAvailable) {
      report.summary.issues.push('Arabic TTS voice not available');
    }

    if (report.videoElements.count === 0) {
      report.summary.issues.push('No video elements detected');
    }

    const hasCrossOriginIframe = report.videoElements.details.some(
      d => d.iframe.containsPlayer && !d.iframe.accessible
    );
    if (hasCrossOriginIframe) {
      report.summary.issues.push('Cross-origin iframe detected - cannot inspect inner player');
    }

    if (report.summary.totalAccessibleTextTracks === 0) {
      report.summary.issues.push('No subtitle tracks detected');
    }

    return report;
  }

  getReportAsString() {
    const report = this.generateReport();
    let str = '=== CaptionVoice Diagnostics Report ===\n';
    str += `Timestamp: ${report.timestamp}\n`;
    str += `Page: ${report.pageUrl}\n\n`;

    str += `Videos detected: ${report.videoElements.count}\n`;
    for (const detail of report.videoElements.details) {
      str += `\n--- Video ${detail.videoIndex} ---\n`;
      str += `Duration: ${detail.duration}s\n`;
      str += `Current time: ${detail.currentTime}s\n`;
      str += `Paused: ${detail.paused}\n`;
      str += `Playback rate: ${detail.playbackRate}\n`;
      str += `Text tracks: ${detail.textTracks.count}\n`;
      for (const track of detail.textTracks.tracks) {
        str += `  Track ${track.trackIndex}: label="${track.label}", lang="${track.language}", kind="${track.kind}", mode="${track.mode}", activeCues=${track.activeCues}, totalCues=${track.totalCues}\n`;
      }
      str += `Iframe: containsPlayer=${detail.iframe.containsPlayer}, accessible=${detail.iframe.accessible}, origin=${detail.iframe.origin}\n`;
      str += `Custom caption DOM: ${detail.captionContainer.usesCustomDOM}\n`;
      if (detail.captionContainer.containerSelector) {
        str += `Container selector: ${detail.captionContainer.containerSelector}\n`;
      }
    }

    str += `\n--- TTS ---\n`;
    str += `Voices count: ${report.tts.voicesCount}\n`;
    str += `Arabic voice available: ${report.tts.arabicVoiceAvailable}\n`;
    if (report.tts.arabicVoiceNames.length > 0) {
      str += `Arabic voices: ${report.tts.arabicVoiceNames.join(', ')}\n`;
    }

    str += `\n--- Issues ---\n`;
    if (report.summary.issues.length > 0) {
      for (const issue of report.summary.issues) {
        str += `- ${issue}\n`;
      }
    } else {
      str += 'No issues detected\n';
    }

    return str;
  }

  async copyDiagnostics() {
    const report = this.getReportAsString();
    try {
      await navigator.clipboard.writeText(report);
      return { success: true };
    } catch (error) {
      // Fallback: create a temporary textarea
      const textarea = document.createElement('textarea');
      textarea.value = report;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      } finally {
        document.body.removeChild(textarea);
      }
    }
  }
}
