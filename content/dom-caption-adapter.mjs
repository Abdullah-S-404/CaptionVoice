// content/dom-caption-adapter.mjs — Adapts DOM-rendered captions (e.g. IBM SkillsBuild,
// Video.js, and custom player overlays that do not use the HTML5 TextTrack API).
// STRICT CONSTRAINT: Do not read transcripts, page titles, menus, or arbitrary text.
// Only reads active subtitle overlays.

export class DOMCaptionAdapter {
  constructor({ onCaption = () => {}, options = {} } = {}) {
    this.onCaption = onCaption;
    this.options = {
      selectors: [
        '.vjs-text-track-display',
        '.vjs-text-track-cue',
        '.ytp-caption-segment',
        '.caption-window',
        '.captions-text',
        '.video-caption',
        '.cc-caption',
        '[role="region"][aria-label*="caption" i]',
        '[class*="vjs-text-track"]',
        '[class*="caption-window"]',
        '.shaka-text-container',
        '.jw-text-track-cue'
      ],
      arabicOnly: options.arabicOnly !== undefined ? options.arabicOnly : true,
      ...options
    };
    this.observer = null;
    this.lastText = '';
    this.container = null;
    this.containerSelector = null;
  }

  observe(root = document) {
    this.scan(root);
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          const target = mutation.target.parentElement;
          if (target) this.consider(target);
          continue;
        }
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.consider(node);
          } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
            this.consider(node.parentElement);
          }
        }
        for (const node of mutation.removedNodes) {
          if (node === this.container) {
            this.container = null;
            this.containerSelector = null;
          }
        }
      }
    });

    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  consider(el) {
    if (!el) return;

    // Reject navigation, headers, transcripts, buttons, menus, and sidebars
    if (el.closest && el.closest('header, nav, footer, button, [role="button"], [role="navigation"], .transcript, [class*="transcript"]')) {
      return;
    }

    // Check if this element matches a caption selector
    if (el.matches) {
      for (const selector of this.options.selectors) {
        try {
          if (el.matches(selector)) {
            this.emit(el, selector);
            return;
          }
        } catch (_) {}
      }
    }

    // Check matching descendants
    if (el.querySelectorAll) {
      for (const selector of this.options.selectors) {
        try {
          const matches = el.querySelectorAll(selector);
          for (const match of matches) {
            this.emit(match, selector);
          }
        } catch (_) {}
      }
    }
  }

  emit(el, selector) {
    if (!el) return;
    const text = el.textContent || '';
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!trimmed) return;

    // Must be different from the last emitted text
    if (trimmed === this.lastText) return;

    // Arabic constraint: if arabicOnly is true, must contain Arabic characters
    if (this.options.arabicOnly && !/[\u0600-\u06FF]/.test(trimmed)) {
      return;
    }

    this.lastText = trimmed;
    this.container = el;
    this.containerSelector = selector || this.getSelector(el);

    this.onCaption({
      text: trimmed,
      element: el,
      selector: this.containerSelector
    });
  }

  getSelector(el) {
    if (!el) return 'unknown';
    if (el.id) return `#${el.id}`;
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.split(/\s+/).filter(Boolean).join('.');
      return `${el.tagName.toLowerCase()}.${classes}`;
    }
    return el.tagName.toLowerCase();
  }

  scan(root) {
    if (!root || !root.querySelectorAll) return;
    for (const selector of this.options.selectors) {
      try {
        const elements = root.querySelectorAll(selector);
        for (const el of elements) {
          this.consider(el);
        }
      } catch (_) {}
    }
  }

  disconnect() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.lastText = '';
    this.container = null;
    this.containerSelector = null;
  }

  destroy() {
    this.disconnect();
  }

  hasContainer() {
    return this.container !== null;
  }

  getContainerSelector() {
    return this.containerSelector;
  }

  getCurrentCaption() {
    return this.lastText || null;
  }
}
