// CaptionVoice popup.js — Unified popup controller (MV3 compatible)
// Handles: bilingual UI (AR/EN), light/dark theme, TTS controls,
// diagnostics, live caption preview.
(function () {
  'use strict';

  // ── i18n ────────────────────────────────────────────────────────────────
  const I18N = {
    ar: {
      subtitle: 'قارئ الترجمة العربية الذكي',
      lblVoice: 'الصوت المستخدم',
      lblRate: 'السرعة',
      lblPitch: 'طبقة الصوت',
      lblVolume: 'مستوى الصوت',
      autoSync: 'مزامنة الإيقاف والاستئناف مع الفيديو',
      testBtn: 'تجربة الصوت',
      stopBtn: 'إيقاف',
      diagTitle: 'التشخيص',
      runDiag: 'فحص الصفحة',
      copyDiag: 'نسخ التقرير',
      copied: 'تم النسخ ✓',
      ready: 'جاهز',
      active: 'مفعّل — يستمع للترجمة',
      stopped: 'متوقف',
      testing: 'جارٍ اختبار الصوت...',
      connected: 'متصل',
      noVideo: 'لم يُكتشف فيديو في هذه الصفحة',
      activating: 'جارٍ التفعيل...',
      arVoices: 'أصوات عربية (موصى بها)',
      otherVoices: 'أصوات أخرى',
      defaultVoice: 'الصوت الافتراضي للنظام',
      diagRunning: 'جارٍ فحص الصفحة والمشغل...',
      diagFailed: 'فشل الفحص: ',
      langBtn: 'EN',
      testText: 'مرحباً بك في كابشن فويس، قارئ الترجمة العربية الذكي.'
    },
    en: {
      subtitle: 'Smart Arabic CC Reader',
      lblVoice: 'Voice Selection',
      lblRate: 'Speed',
      lblPitch: 'Pitch',
      lblVolume: 'Volume',
      autoSync: 'Sync Pause/Resume with video',
      testBtn: 'Test Voice',
      stopBtn: 'Stop',
      diagTitle: 'Diagnostics',
      runDiag: 'Inspect Page',
      copyDiag: 'Copy Report',
      copied: 'Copied ✓',
      ready: 'Ready',
      active: 'Active & Listening',
      stopped: 'Stopped',
      testing: 'Testing speech synthesis...',
      connected: 'Connected',
      noVideo: 'No video element detected on page',
      activating: 'Activating...',
      arVoices: 'Arabic Voices (Recommended)',
      otherVoices: 'Other System Voices',
      defaultVoice: 'Default System Voice',
      diagRunning: 'Inspecting video player and subtitles...',
      diagFailed: 'Inspection failed: ',
      langBtn: 'عربي',
      testText: 'Welcome to CaptionVoice, real-time Arabic text-to-speech for educational videos.'
    }
  };

  // ── State ────────────────────────────────────────────────────────────────
  let currentLang = 'ar';
  let currentTheme = 'light';
  let voices = [];
  let lastReport = '';
  let pollInterval = null;

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const els = {
    btnLangToggle:  $('btnLangToggle'),
    btnThemeToggle: $('btnThemeToggle'),
    toggleEnabled:  $('toggleEnabled'),
    statusDot:      $('statusDot'),
    statusText:     $('statusText'),
    liveCaptionText:$('liveCaptionText'),
    txtSubtitle:    $('txtSubtitle'),
    selectVoice:    $('selectVoice'),
    lblVoice:       $('lblVoice'),
    rangeRate:      $('rangeRate'),
    rateValue:      $('rateValue'),
    lblRate:        $('lblRate'),
    rangePitch:     $('rangePitch'),
    pitchValue:     $('pitchValue'),
    lblPitch:       $('lblPitch'),
    rangeVolume:    $('rangeVolume'),
    volumeValue:    $('volumeValue'),
    lblVolume:      $('lblVolume'),
    toggleAutoSync: $('toggleAutoSync'),
    txtAutoSync:    $('txtAutoSync'),
    btnTest:        $('btnTest'),
    btnStop:        $('btnStop'),
    btnToggleDiag:  $('btnToggleDiag'),
    diagContent:    $('diagContent'),
    txtDiagTitle:   $('txtDiagTitle'),
    btnRunDiag:     $('btnRunDiag'),
    btnCopyDiag:    $('btnCopyDiag'),
    diagOutput:     $('diagOutput')
  };

  // ── Messaging ────────────────────────────────────────────────────────────
  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => {
        resolve(res || { success: false });
      });
    });
  }

  function t(key) {
    return I18N[currentLang][key] || key;
  }

  function applyLang() {
    if (els.txtSubtitle)     els.txtSubtitle.textContent     = t('subtitle');
    if (els.lblVoice)        els.lblVoice.textContent        = t('lblVoice');
    if (els.lblRate)         els.lblRate.textContent         = t('lblRate');
    if (els.lblPitch)        els.lblPitch.textContent        = t('lblPitch');
    if (els.lblVolume)       els.lblVolume.textContent       = t('lblVolume');
    if (els.txtAutoSync)     els.txtAutoSync.textContent     = t('autoSync');
    if (els.btnTest)         els.btnTest.textContent         = t('testBtn');
    if (els.btnStop)         els.btnStop.textContent         = t('stopBtn');
    if (els.txtDiagTitle)    els.txtDiagTitle.textContent    = t('diagTitle');
    if (els.btnRunDiag)      els.btnRunDiag.textContent      = t('runDiag');
    if (els.btnCopyDiag)     els.btnCopyDiag.textContent     = t('copyDiag');
    if (els.btnLangToggle)   els.btnLangToggle.textContent   = t('langBtn');
    if (els.statusText)      els.statusText.textContent      = t('ready');
    if (els.diagOutput)      els.diagOutput.textContent      = '';
  }

  // ── Voice list ───────────────────────────────────────────────────────────
  async function loadVoices() {
    const res = await send({ type: 'GET_VOICES' });
    if (!res.success || !res.voices) return;
    voices = res.voices;
    const arVoices = voices.filter(v => /^ar/i.test(v.lang || ''));
    const otherVoices = voices.filter(v => !/^ar/i.test(v.lang || ''));

    const frag = document.createDocumentFragment();

    const addGroup = (title, list) => {
      if (!list.length) return;
      const opt = document.createElement('option');
      opt.disabled = true;
      opt.textContent = title;
      frag.appendChild(opt);
      for (const v of list) {
        const o = document.createElement('option');
        o.value = v.name;
        o.textContent = v.name + ' (' + v.lang + ')';
        frag.appendChild(o);
      }
    };

    addGroup(t('arVoices'), arVoices);
    addGroup(t('otherVoices'), otherVoices);
    const def = document.createElement('option');
    def.value = '';
    def.textContent = t('defaultVoice');
    frag.appendChild(def);

    els.selectVoice.innerHTML = '';
    els.selectVoice.appendChild(frag);
    els.selectVoice.value = '';
  }

  // ── UI state ─────────────────────────────────────────────────────────────
  function setEnabledUI(on) {
    if (els.statusDot) {
      els.statusDot.className = on ? 'dot on' : 'dot off';
    }
    if (els.statusText) {
      els.statusText.textContent = on ? t('active') : t('stopped');
    }
  }

  function setLiveCaption(text) {
    if (els.liveCaptionText) {
      els.liveCaptionText.textContent = text || t('noVideo');
    }
  }

  // ── Polling ──────────────────────────────────────────────────────────────
  async function pollState() {
    const res = await send({ type: 'GET_STATE' });
    if (!res.success) return;

    const s = res.state || {};
    setEnabledUI(!!s.extensionActive);
    setLiveCaption(s.lastActiveCaption || '');
  }

  // ── Events ───────────────────────────────────────────────────────────────
  function initEvents() {
    // Lang toggle
    if (els.btnLangToggle) {
      els.btnLangToggle.addEventListener('click', () => {
        currentLang = currentLang === 'ar' ? 'en' : 'ar';
        applyLang();
        loadVoices();
      });
    }

    // Theme toggle
    if (els.btnThemeToggle) {
      els.btnThemeToggle.addEventListener('click', () => {
        currentTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', currentTheme);
        els.btnThemeToggle.textContent = currentTheme === 'light' ? '🌙' : '☀️';
      });
    }

    // Master switch
    if (els.toggleEnabled) {
      els.toggleEnabled.addEventListener('change', async () => {
        const on = els.toggleEnabled.checked;
        await send({ type: 'TOGGLE_EXTENSION', payload: { isActive: on } });
        setEnabledUI(on);
        if (on) await pollState();
      });
    }

    // Voice select
    if (els.selectVoice) {
      els.selectVoice.addEventListener('change', async () => {
        const name = els.selectVoice.value;
        const voice = voices.find(v => v.name === name) || null;
        await send({
          type: 'UPDATE_TTS_SETTINGS',
          payload: { settings: { voice: voice || null } }
        });
      });
    }

    // Rate slider
    if (els.rangeRate) {
      els.rangeRate.addEventListener('input', async () => {
        const v = parseFloat(els.rangeRate.value);
        els.rateValue.textContent = v.toFixed(2) + '×';
        await send({
          type: 'UPDATE_TTS_SETTINGS',
          payload: { settings: { rate: v } }
        });
      });
    }

    // Pitch slider
    if (els.rangePitch) {
      els.rangePitch.addEventListener('input', async () => {
        const v = parseFloat(els.rangePitch.value);
        els.pitchValue.textContent = v.toFixed(1);
        await send({
          type: 'UPDATE_TTS_SETTINGS',
          payload: { settings: { pitch: v } }
        });
      });
    }

    // Volume slider
    if (els.rangeVolume) {
      els.rangeVolume.addEventListener('input', async () => {
        const v = parseFloat(els.rangeVolume.value);
        els.volumeValue.textContent = Math.round(v * 100) + '%';
        await send({
          type: 'UPDATE_TTS_SETTINGS',
          payload: { settings: { volume: v } }
        });
      });
    }

    // Test
    if (els.btnTest) {
      els.btnTest.addEventListener('click', async () => {
        els.btnTest.textContent = t('testing');
        await send({ type: 'SPEAK_TEST', payload: { text: t('testText'), lang: 'ar' } });
        setTimeout(() => { els.btnTest.textContent = t('testBtn'); }, 1500);
      });
    }

    // Stop
    if (els.btnStop) {
      els.btnStop.addEventListener('click', async () => {
        await send({ type: 'STOP_TTS' });
      });
    }

    // Diagnostics toggle
    if (els.btnToggleDiag && els.diagContent) {
      els.btnToggleDiag.addEventListener('click', () => {
        const hidden = els.diagContent.style.display === 'none';
        els.diagContent.style.display = hidden ? 'block' : 'none';
        els.btnToggleDiag.textContent = hidden ? 'إخفاء التشخيص' : 'فحص الصفحة';
      });
    }

    // Run diagnostics
    if (els.btnRunDiag) {
      els.btnRunDiag.addEventListener('click', async () => {
        els.btnRunDiag.textContent = t('diagRunning');
        const res = await send({ type: 'REQUEST_DIAGNOSTICS' });
        if (res.success && res.reportString) {
          els.diagOutput.textContent = res.reportString;
          if (els.btnCopyDiag) els.btnCopyDiag.disabled = false;
          lastReport = res.reportString;
        } else {
          els.diagOutput.textContent = t('diagFailed') + (res.error || 'unknown');
        }
        els.btnRunDiag.textContent = t('runDiag');
      });
    }

    // Copy diagnostics
    if (els.btnCopyDiag) {
      els.btnCopyDiag.addEventListener('click', () => {
        if (!lastReport) return;
        navigator.clipboard.writeText(lastReport).then(() => {
          els.btnCopyDiag.textContent = t('copied');
          setTimeout(() => { els.btnCopyDiag.textContent = t('copyDiag'); }, 1200);
        });
      });
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    applyLang();
    loadVoices();
    initEvents();

    // Start polling
    pollState();
    pollInterval = setInterval(pollState, 1500);

    window.addEventListener('unload', () => {
      if (pollInterval) clearInterval(pollInterval);
    });
  }

  init();
})();
