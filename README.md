# CaptionVoice (كابشن فويس) 🎙️

**CaptionVoice** is a production-quality Microsoft Edge extension (Manifest V3) that provides real-time Arabic text-to-speech (TTS) for closed captions (CC) in online educational video players (with a primary focus on platforms such as **IBM SkillsBuild**).

---

## 📌 Key Architectural Principles & Constraints

1. **Zero External Dependencies / Zero Paid APIs / Zero Cloud Models**:
   - Built with 100% vanilla JavaScript, HTML5, and CSS3.
   - **No React**, **no Node.js runtime**, **no Python/backend**, **no Whisper**, **no OCR**, **no external network requests** for audio or TTS.
   - Powered purely by the browser's native `window.speechSynthesis` API and locally installed system voices.
2. **Strict Reading Boundary**:
   - **Do not read arbitrary screen text**: The extension will **never** read webpage headers, video titles, menus, control buttons, or transcript sidebars.
   - It listens strictly to **active subtitle cues** and speaks only verified Arabic closed captions.
3. **Robust Chromium Manifest V3 Execution**:
   - Content scripts in Chromium MV3 do not support static ES module imports (`import ... from ...`) in the content script realm. To eliminate `SyntaxError: Cannot use import statement outside a module` failures, CaptionVoice packages all content modules into a rock-solid, self-contained `content/content.bundle.js` while maintaining the clean `.mjs` source modules for review.

---

## 📂 Project Structure

```
CaptionVoice/
├── manifest.json                  # Manifest V3 configuration (MV3 compliant)
├── background.mjs                 # Service worker: active-tab resolver, message broker, auto-injector
├── content/
│   ├── content.bundle.js          # Self-contained bundled content script (zero-syntax-error execution)
│   ├── content.mjs                # Modular content script entry point
│   ├── video-detector.mjs         # MutationObserver scanning for <video> elements
│   ├── texttrack-adapter.mjs      # HTML5 TextTrack API adapter (addtrack, cuechange)
│   ├── dom-caption-adapter.mjs    # Scoped DOM caption observer (Video.js, player overlays)
│   ├── subtitle-detector.mjs      # Master coordinator for caption extraction & VTT import
│   ├── diagnostics.mjs            # Comprehensive page, video, track, & TTS inspector
│   ├── iframe-detector.mjs        # Probes same-origin frames & flags cross-origin boundaries
│   └── synchronization.mjs        # Bounded subtitle playback history & tracking
├── speech/
│   ├── tts-engine.mjs             # State machine (IDLE/READY/PLAYING/PAUSED/SEEKING) for SpeechSynthesis
│   └── voice-manager.mjs          # Asynchronous voice loader with Arabic voice priority
├── popup/
│   ├── popup.html                 # Accessible bilingual popup UI (Arabic RTL & English LTR)
│   ├── popup.css                  # Modern light & dark theme styling with glowing live-caption preview
│   └── popup.mjs                  # UI controller with real-time preview, sliders, & diagnostics
├── utils/
│   ├── storage.mjs                # Async chrome.storage.local wrapper
│   └── logger.mjs                 # Structured namespaced console logger
└── README.md                      # Complete documentation & diagnostic report
```

---

## 🛠️ How Caption Detection Works

CaptionVoice employs a three-tier hierarchical detection pipeline:

### Tier 1: HTML5 `TextTrack` API (Primary)
- Monitors `video.textTracks` for `addtrack` and `removetrack` events.
- Attaches to tracks with `kind === 'captions'` or `kind === 'subtitles'`.
- Detects Arabic language via `track.language` (`ar`, `ar-SA`, `ar-EG`) or label inspection (`العربية`, `Arabic`).
- Triggers on `cuechange` with strict deduplication (`lastCueText` and cue index).

### Tier 2: Scoped DOM Caption Adapter (Secondary)
- Specifically designed for video players (such as Video.js or custom player wrappers) that render captions as styled DOM `<div>` or `<span>` overlays instead of native text tracks.
- Targeted selectors include:
  - `.vjs-text-track-display`, `.vjs-text-track-cue` (Video.js)
  - `.ytp-caption-segment`, `.caption-window`, `.captions-text`
  - `.video-caption`, `.cc-caption`, `.shaka-text-container`, `.jw-text-track-cue`
- **Transcript Exclusion**: Automatically rejects elements inside `.transcript`, `<header>`, `<nav>`, `<button>`, or navigation containers.
- **Arabic Character Regex Guard**: In Arabic mode, guarantees text contains characters in the range `[\u0600-\u06FF]`.

### Tier 3: Manual WebVTT Import (Fallback)
- If a course hosts video inside a restricted cross-origin iframe where browser security blocks DOM access, the user can upload a `.vtt` file directly in the popup. CaptionVoice parses timestamp blocks (`00:00:10.500 --> 00:00:15.200`) and plays captions in sync with video time.

---

## 🔄 Synchronization & State Machine

The TTS engine synchronizes with video playback events:
- **Video Pause (`pause`)**: Calls `speechSynthesis.pause()`.
- **Video Resume (`play`)**: Calls `speechSynthesis.resume()`.
- **Video Seek (`seeking`)**: Immediately calls `speechSynthesis.cancel()`, clears stale caption queues, and resets tracking.
- **Video End (`ended`)**: Cancels all queued speech and resets state to `IDLE`.

---

## 🚀 Installation in Microsoft Edge

1. Open Microsoft Edge.
2. In the address bar, navigate to:
   ```text
   edge://extensions/
   ```
3. In the left sidebar (or bottom-left corner), switch on **Developer mode** (وضع المطور).
4. Click the button **Load unpacked** (تحميل ملحق غير مضغوط).
5. Browse to the project folder:
   ```text
   C:\Users\abdullah\Documents\my-project\cc-reader\CaptionVoice
   ```
   Select this folder and click **Select Folder**.
6. **CaptionVoice** will now appear in your installed extensions list.
7. Click the "Extensions" puzzle icon in the Edge toolbar and pin **CaptionVoice** for easy access.

---

## 🧪 Testing Instructions

### 1. Test Voice & Popup Connection
1. Click the **CaptionVoice** icon in the toolbar.
2. Click **تجربة الصوت (Test Voice)**:
   - You should immediately hear: *"مرحباً بك في كابشن فويس، قارئ الترجمة العربية الذكي..."*
3. Adjust the **سرعة القراءة (Reading Rate)** slider (0.7× – 1.5×) and **طبقة الصوت (Pitch)**.
4. Toggle the theme (🌙/☀️) or language (EN/عربي).

### 2. Test On Video Pages
1. Open an online video course (e.g. IBM SkillsBuild, Coursera, or YouTube).
2. Start the video and turn on **Arabic Subtitles / CC** in the player's caption menu.
3. Open the **CaptionVoice** popup and switch on **تفعيل قراءة الترجمة (Enable Caption Reading)**.
4. Watch the **الترجمة النشطة الحالية (Active Subtitle Preview)** box:
   - When an Arabic caption appears on screen, it will show inside the box with a glowing green dot and be spoken in sync.
5. Pause the video — notice that speech pauses. Resume — notice speech resumes.

---

## 🔍 Technical Diagnostic Report: IBM SkillsBuild Player

### Player Architecture Analysis
IBM SkillsBuild delivers courses through modern web LMS frameworks (such as EdCast, Cornerstone, or embeddable SCORM packages). Depending on the specific course provider (e.g. IBM internal modules, Coursera, or edX embeds):
1. **Direct HTML5 `<video>` Elements**:
   - Many modules use a custom HTML5 player or Video.js player hosted on the main course page.
   - In these lessons, CaptionVoice detects the `<video>` element immediately, binds to `video.textTracks`, and extracts cues as the player streams WebVTT tracks.
2. **Video.js / Custom DOM Overlays**:
   - When WebVTT tracks are rendered into custom DOM overlays, elements matching `.vjs-text-track-display` and `.vjs-text-track-cue` are observed by `DOMCaptionAdapter` with character-data mutation tracking.
3. **Cross-Origin Iframe Embeds**:
   - Some specialized vendor modules embed videos inside third-party iframes (`*.kaltura.com`, `*.brightcove.net`, or vendor domains).
   - In accordance with the browser Same-Origin Policy, if an iframe does not share the parent origin, direct script inspection into the iframe DOM is restricted by the browser engine.
   - **CaptionVoice Solution**:
     - `content.bundle.js` is registered with `all_frames: true` and `match_about_blank: true` so it automatically executes inside all subframes where permissible.
     - For sandboxed cross-origin iframes, the built-in **Manual WebVTT Import** feature allows users to load the subtitle track directly.

> ⚠️ **Verification Status**:
> While CaptionVoice implements standard HTML5 `TextTrack` compliance and Video.js DOM overlay adapters, **exact compatibility with any specific IBM SkillsBuild course depends on whether that course is hosted directly on-page or inside a third-party cross-origin iframe**.
> Use the popup's **فحص المشغل والتشخيص (Inspect Page & Player)** button while on the lesson page to generate an instant diagnostic report.

---

## ❓ Troubleshooting

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| **"No local Arabic SpeechSynthesis voice found"** | Windows does not have the Arabic Speech Pack installed. | Go to Windows **Settings** → **Time & Language** → **Speech** → Under "Manage voices", click **Add voices** → Install **Arabic (Saudi Arabia / Egypt)**. Restart Edge. |
| **Popup shows "Connected (0 videos)"** | Video player hasn't loaded yet or is inside an iframe. | Start playing the video first so the `<video>` tag is mounted into the DOM, then click the extension. |
| **Video paused but speech keeps going** | TTS utterance was queued before pause. | Ensure **مزامنة الإيقاف والاستئناف (Sync with video)** is checked. |
| **Video is in an external iframe and subtitles aren't detected** | Cross-origin browser boundary. | Use the **استيراد ملف ترجمة (.vtt) يدوي** section in the popup to load the subtitle file. |

---

## 📄 License
MIT License — CaptionVoice Project.
