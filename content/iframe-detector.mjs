// content/iframe-detector.js — Detects iframes that may host video players.
// Same-origin iframes are probed for nested video elements; cross-origin iframes
// are reported for diagnostics only (caption reading across origins is not possible
// from a content script without the parent frame's cooperation).
export class IframeDetector {
  constructor({ onIframe = () => {}, options = {} } = {}) {
    this.onIframe = onIframe;
    this.options = options;
    this.observer = null;
    this.seen = new WeakSet();
  }

  start() {
    this.scan(document);
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.tagName === 'IFRAME') this.consider(node);
          if (node.querySelectorAll) {
            for (const iframe of node.querySelectorAll('iframe')) {
              this.consider(iframe);
            }
          }
        }
      }
    });
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  consider(iframe) {
    if (!iframe || this.seen.has(iframe)) return;
    this.seen.add(iframe);
    this.onIframe(iframe);

    try {
      iframe.addEventListener(
        'load',
        () => {
          try {
            const doc =
              iframe.contentDocument || iframe.contentWindow.document;
            if (doc && doc.querySelectorAll) {
              const videos = doc.querySelectorAll('video');
              if (videos.length) {
                console.info(
                  '[CaptionVoice] Same-origin iframe contains',
                  videos.length,
                  'video element(s)'
                );
              }
            }
          } catch (_) {
            // Cross-origin iframe: expected, caption access not possible here
          }
        },
        { once: true }
      );
    } catch (_) {
      // iframe may not be inspectable
    }
  }

  scan(root) {
    if (!root || !root.querySelectorAll) return;
    for (const iframe of root.querySelectorAll('iframe')) {
      this.consider(iframe);
    }
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}
