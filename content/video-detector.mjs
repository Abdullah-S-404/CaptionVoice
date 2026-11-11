// content/video-detector.mjs — Detects <video> elements on the page, including dynamically added ones.

export class VideoDetector {
  constructor({ onVideoFound = () => {}, onVideoRemoved = () => {}, options = {} } = {}) {
    this.onVideoFound = onVideoFound;
    this.onVideoRemoved = onVideoRemoved;
    this.options = { root: document, ...options };
    this.observer = null;
    this.found = new WeakSet();
    this.videos = new Map(); // video element -> { element, addedAt }
  }

  async start() {
    this.scan(document);
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          this.consider(node);
          if (node.querySelectorAll) {
            for (const el of node.querySelectorAll('video')) {
              this.consider(el);
            }
          }
        }
        for (const node of mutation.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.tagName === 'VIDEO') {
            this.onVideoRemoved(node);
            this.videos.delete(node);
            this.found.delete(node);
          }
          if (node.querySelectorAll) {
            for (const el of node.querySelectorAll('video')) {
              this.onVideoRemoved(el);
              this.videos.delete(el);
              this.found.delete(el);
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

  consider(el) {
    if (this.found.has(el)) return;
    if (el.tagName === 'VIDEO') {
      this.found.add(el);
      this.videos.set(el, { element: el, addedAt: Date.now() });
      this.onVideoFound(el);
    }
  }

  scan(root) {
    if (!root || !root.querySelectorAll) return;
    for (const video of root.querySelectorAll('video')) {
      this.consider(video);
    }
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.videos.clear();
    this.found = new WeakSet();
  }

  getVideos() {
    return Array.from(this.videos.values()).map(v => v.element);
  }

  getVideoCount() {
    return this.videos.size;
  }
}
