// popup/popup.mjs — CaptionVoice Popup Controller
// Fully functional controller with live caption preview, Arabic/English RTL toggle,
// Diagnostics, WebVTT import, and speech rate/pitch/volume controls.

(function () {
  'use strict';

  const I18N = {
    ar: {
      subtitle: 'قارئ الترجمة العربية الذكي',
      masterTitle: 'تفعيل قراءة الترجمة',
      masterDesc: 'قراءة الترجمة العربية النشطة فقط وبشكل متزامن',
      liveTitle: 'الترجمة النشطة الحالية',
      livePlaceholder: 'في انتظار ظهور ترجمة عربية في المشغل...',
      settingsTitle: 'إعدادات الصوت والنطق',
      voice: 'الصوت المستخدم',
      rate: 'سرعة القراءة',
      pitch: 'طبقة الصوت (Pitch)',
      volume: 'مستوى الصوت',
      autoSync: 'مزامنة الإيقاف والاستئناف مع الفيديو',
      testBtn: 'تجربة الصوت',
      stopBtn: 'إيقاف',
      diagTitle: 'فحص المشغل والتشخيص',
      toggleDiag: 'إظهار / إخفاء',
      runDiag: 'فحص الصفحة والمشغل',
      copyDiag: 'نسخ التقرير',
      vttTitle: 'استيراد ملف ترجمة (.vtt) يدوي',
      vttDesc: 'إذا كان المشغل محمي داخل iframe خارجي، يمكنك استيراد ملف الترجمة مباشرة:',
      vttNoFile: 'لم يتم تحميل ملف',
      vttLoaded: 'تم استيراد ملف الترجمة بنجاح ✓',
      statsTitle: 'إحصائيات الاستخدام',
      statCaptions: 'الترجمات المقروءة',
      statSessions: 'جلسات الاستماع',
      ready: 'جاهز للمشاهدة',
      active: 'قيد الاستماع للترجمة',
      stopped: 'تم الإيقاف',
      testing: 'جاري اختبار الصوت...',
      connected: 'متصل بالمشغل ✓',
      noVideos: 'لم يتم اكتشاف فيديو في الصفحة',
      langBtn: 'EN',
      testText: 'مرحباً بك في كابشن فويس، قارئ الترجمة العربية الذكي لـ IBM SkillsBuild.'
    },
    en: {
      subtitle: 'Smart Arabic CC Reader',
      masterTitle: 'Enable Caption Reading',
      masterDesc: 'Read only active Arabic subtitles synchronously',
      liveTitle: 'Active Subtitle Preview',
      livePlaceholder: 'Waiting for active Arabic captions in video player...',
      settingsTitle: 'Voice & Speech Settings',
      voice: 'Voice Selection',
      rate: 'Reading Rate',
      pitch: 'Voice Pitch',
      volume: 'Volume',
      autoSync: 'Sync Pause/Resume with video',
      testBtn: 'Test Voice',
      stopBtn: 'Stop',
      diagTitle: 'Player Diagnostics & Inspection',
      toggleDiag: 'Show / Hide',
      runDiag: 'Inspect Page & Player',
      copyDiag: 'Copy Report',
      vttTitle: 'Manual WebVTT Import',
      vttDesc: 'If the video player is in an isolated cross-origin iframe, load a .vtt subtitle file:',
      vttNoFile: 'No file chosen',
      vttLoaded: 'WebVTT file imported successfully ✓',
      statsTitle: 'Usage Statistics',
      statCaptions: 'Captions Spoken',
      statSessions: 'Listening Sessions',
      ready: 'Ready',
      active: 'Active & Listening',
      stopped: 'Stopped',
      testing: 'Testing speech synthesis...',
      connected: 'Connected to Player ✓',
      noVideos: 'No video element detected on page',
      langBtn: 'عربي',
      testText: 'Welcome to CaptionVoice, real-time Arabic text-to-speech for online educational videos.'
    }
  };

  let currentLang = 'ar';
  let currentTheme = 'light';
  let voices = [];
  let lastReportString = '';
  let pollInterval = null;

  const els = {
    btnLangToggle: document.getElementById('btnLangToggle'),
    btnThemeToggle: document.getElementById('btnThemeToggle'),
    toggleEnabled: document.getElementById('toggleEnabled'),
    liveCaptionText: document.getElementById('liveCaptionText'),
    selectVoice: document.getElementById('selectVoice'),
    rangeRate: document.getElementById('rangeRate'),
    rateValue: document.getElementById('rateValue'),
    rangePitch: document.getElementById('rangePitch'),
    pitchValue: document.getElementById('pitchValue'),
    rangeVolume: document.getElementById('rangeVolume'),
    volumeValue: document.getElementById('volumeValue'),
    toggleAutoSync: document.getElementById('toggleAutoSync'),
    btnTest: document.getElementById('btnTest'),
    btnStop: document.getElementById('btnStop'),
    btnToggleDiag: document.getElementById('btnToggleDiag'),
    diagContent: document.getElementById('diagContent'),
    btnRunDiag: document.getElementById('btnRunDiag'),
    btnCopyDiag: document.getElementById('btnCopyDiag'),
    diagOutput: document.getElementById('diagOutput'),
    fileVtt: document.getElementById('fileVtt'),
    vttStatus: document.getElementById('vttStatus'),
    statCaptions: document.getElementById('statCaptions'),
    statSessions: document.getElementById('statSessions'),
    statusText: document.getElementById('statusText'),
    statusBadge: document.getElementById('statusBadge'),
    // Localized text elements
    txtSubtitle: document.getElementById('txtSubtitle'),
    txtMasterTitle: document.getElementById('txtMasterTitle'),
    txtMasterDesc: document.getElementById('txtMasterDesc'),
    txtLiveTitle: document.getElementById('txtLiveTitle'),
    txtSettingsTitle: document.getElementById('txtSettingsTitle'),
    lblVoice: document.getElementById('lblVoice'),
    lblRate: document.getElementById('lblRate'),
    lblPitch: document.getElementById('lblPitch'),
    lblVolume: document.getElementById('lblVolume'),
    txtAutoSync: document.getElementById('txtAutoSync'),
    txtDiagTitle: document.getElementById('txtDiagTitle'),
    txtVttTitle: document.getElementById('txtVttTitle'),
    txtVttDesc: document.getElementById('txtVttDesc'),
    txtStatsTitle: document.getElementById('txtStatsTitle'),
    lblStatCaptions: document.getElementById('lblStatCaptions'),
    lblStatSessions: document.getElementById('lblStatSessions')
  };

  async function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false });
        }
      });
    });
  }

  function setStatus(text, isError = false) {
    if (els.statusText) els.statusText.textContent = text;
    if (els.statusBadge) {
      els.statusBadge.style.backgroundColor = isError ? 'var(--danger)' : 'var(--success)';
    }
  }

  function applyLanguage(lang) {
    currentLang = lang;
    const t = I18N[lang];
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

    if (els.btnLangToggle) els.btnLangToggle.textContent = t.langBtn;
    if (els.txtSubtitle) els.txtSubtitle.textContent = t.subtitle;
    if (els.txtMasterTitle) els.txtMasterTitle.textContent = t.masterTitle;
    if (els.txtMasterDesc) els.txtMasterDesc.textContent = t.masterDesc;
    if (els.txtLiveTitle) els.txtLiveTitle.textContent = t.liveTitle;
    if (els.txtSettingsTitle) els.txtSettingsTitle.textContent = t.settingsTitle;
    if (els.lblVoice) els.lblVoice.textContent = t.voice;
    if (els.lblRate) els.lblRate.textContent = t.rate;
    if (els.lblPitch) els.lblPitch.textContent = t.pitch;
    if (els.lblVolume) els.lblVolume.textContent = t.volume;
    if (els.txtAutoSync) els.txtAutoSync.textContent = t.autoSync;
    if (els.btnTest) els.btnTest.textContent = t.testBtn;
    if (els.btnStop) els.btnStop.textContent = t.stopBtn;
    if (els.txtDiagTitle) els.txtDiagTitle.textContent = t.diagTitle;
    if (els.btnRunDiag) els.btnRunDiag.textContent = t.runDiag;
    if (els.btnCopyDiag) els.btnCopyDiag.textContent = t.copyDiag;
    if (els.txtVttTitle) els.txtVttTitle.textContent = t.vttTitle;
    if (els.txtVttDesc) els.txtVttDesc.textContent = t.vttDesc;
    if (els.txtStatsTitle) els.txtStatsTitle.textContent = t.statsTitle;
    if (els.lblStatCaptions) els.lblStatCaptions.textContent = t.statCaptions;
    if (els.lblStatSessions) els.lblStatSessions.textContent = t.statSessions;
  }

  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    if (els.btnThemeToggle) {
      els.btnThemeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
  }

  function renderVoices(voiceList, selectedVoice) {
    if (!els.selectVoice) return;
    els.selectVoice.innerHTML = '';

    const arabicVoices = voiceList.filter((v) => v.lang && v.lang.toLowerCase().startsWith('ar'));
    const otherVoices = voiceList.filter((v) => !v.lang || !v.lang.toLowerCase().startsWith('ar'));

    if (arabicVoices.length > 0) {
      const arGroup = document.createElement('optgroup');
      arGroup.label = currentLang === 'ar' ? 'الأصوات العربية (موصى بها)' : 'Arabic Voices (Recommended)';
      for (const v of arabicVoices) {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = `${v.name} (${v.lang})`;
        if (selectedVoice && selectedVoice.name === v.name) opt.selected = true;
        arGroup.appendChild(opt);
      }
      els.selectVoice.appendChild(arGroup);
    }

    if (otherVoices.length > 0) {
      const otherGroup = document.createElement('optgroup');
      otherGroup.label = currentLang === 'ar' ? 'أصوات النظام الأخرى' : 'Other System Voices';
      for (const v of otherVoices) {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = `${v.name} (${v.lang})`;
        if (selectedVoice && selectedVoice.name === v.name) opt.selected = true;
        otherGroup.appendChild(opt);
      }
      els.selectVoice.appendChild(otherGroup);
    }

    if (voiceList.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = currentLang === 'ar' ? 'صوت النظام الافتراضي' : 'Default System Voice';
      els.selectVoice.appendChild(opt);
    }
  }

  async function loadState() {
    const res = await sendMessage({ type: 'GET_STATE' });
    if (res.success && res.state) {
      const s = res.state;
      if (els.toggleEnabled) els.toggleEnabled.checked = !!s.extensionActive;
      if (els.rangeRate && s.rate !== undefined) {
        els.rangeRate.value = s.rate;
        if (els.rateValue) els.rateValue.textContent = `${s.rate}×`;
      }
      if (els.rangePitch && s.pitch !== undefined) {
        els.rangePitch.value = s.pitch;
        if (els.pitchValue) els.pitchValue.textContent = s.pitch;
      }
      if (els.rangeVolume && s.volume !== undefined) {
        els.rangeVolume.value = s.volume;
        if (els.volumeValue) els.volumeValue.textContent = `${Math.round(s.volume * 100)}%`;
      }
      if (els.toggleAutoSync && s.autoSync !== undefined) {
        els.toggleAutoSync.checked = s.autoSync;
      }
      if (s.lastActiveCaption && els.liveCaptionText) {
        els.liveCaptionText.textContent = s.lastActiveCaption;
      }
      if (s.stats) {
        if (els.statCaptions) els.statCaptions.textContent = s.stats.captionsRead || 0;
        if (els.statSessions) els.statSessions.textContent = s.stats.sessions || 0;
      }

      setStatus(s.extensionActive ? I18N[currentLang].active : I18N[currentLang].ready);
    }
  }

  async function loadVoices() {
    const res = await sendMessage({ type: 'GET_VOICES' });
    if (res.success && Array.isArray(res.voices)) {
      voices = res.voices;
      renderVoices(voices, null);
    }
  }

  async function pingPlayer() {
    const res = await sendMessage({ type: 'PING' });
    if (res.success && res.pong) {
      if (res.videoCount > 0) {
        setStatus(`${I18N[currentLang].connected} (${res.videoCount})`);
      } else {
        setStatus(I18N[currentLang].noVideos, true);
      }
    }
  }

  function setupEventListeners() {
    // Language toggle
    els.btnLangToggle.addEventListener('click', () => {
      applyLanguage(currentLang === 'ar' ? 'en' : 'ar');
      renderVoices(voices, null);
    });

    // Theme toggle
    els.btnThemeToggle.addEventListener('click', () => {
      applyTheme(currentTheme === 'light' ? 'dark' : 'light');
    });

    // Master toggle
    els.toggleEnabled.addEventListener('change', async () => {
      const active = els.toggleEnabled.checked;
      setStatus(active ? I18N[currentLang].active : I18N[currentLang].stopped);
      await sendMessage({ type: 'TOGGLE_EXTENSION', payload: { isActive: active } });
    });

    // Voice change
    els.selectVoice.addEventListener('change', async () => {
      const voiceName = els.selectVoice.value;
      const voiceObj = voices.find((v) => v.name === voiceName);
      await sendMessage({
        type: 'UPDATE_TTS_SETTINGS',
        payload: { settings: { voice: voiceObj } }
      });
      await sendMessage({
        type: 'UPDATE_STATE',
        payload: { voice: voiceObj }
      });
    });

    // Rate slider
    els.rangeRate.addEventListener('input', () => {
      els.rateValue.textContent = `${els.rangeRate.value}×`;
    });
    els.rangeRate.addEventListener('change', async () => {
      const rate = parseFloat(els.rangeRate.value);
      await sendMessage({
        type: 'UPDATE_TTS_SETTINGS',
        payload: { settings: { rate } }
      });
      await sendMessage({
        type: 'UPDATE_STATE',
        payload: { rate }
      });
    });

    // Pitch slider
    els.rangePitch.addEventListener('input', () => {
      els.pitchValue.textContent = els.rangePitch.value;
    });
    els.rangePitch.addEventListener('change', async () => {
      const pitch = parseFloat(els.rangePitch.value);
      await sendMessage({
        type: 'UPDATE_TTS_SETTINGS',
        payload: { settings: { pitch } }
      });
      await sendMessage({
        type: 'UPDATE_STATE',
        payload: { pitch }
      });
    });

    // Volume slider
    els.rangeVolume.addEventListener('input', () => {
      els.volumeValue.textContent = `${Math.round(els.rangeVolume.value * 100)}%`;
    });
    els.rangeVolume.addEventListener('change', async () => {
      const volume = parseFloat(els.rangeVolume.value);
      await sendMessage({
        type: 'UPDATE_TTS_SETTINGS',
        payload: { settings: { volume } }
      });
      await sendMessage({
        type: 'UPDATE_STATE',
        payload: { volume }
      });
    });

    // Auto-sync toggle
    els.toggleAutoSync.addEventListener('change', async () => {
      await sendMessage({
        type: 'UPDATE_STATE',
        payload: { autoSync: els.toggleAutoSync.checked }
      });
    });

    // Test Voice button
    els.btnTest.addEventListener('click', async () => {
      setStatus(I18N[currentLang].testing);
      await sendMessage({
        type: 'SPEAK_TEST',
        payload: { text: I18N[currentLang].testText, lang: 'ar' }
      });
    });

    // Stop button
    els.btnStop.addEventListener('click', async () => {
      await sendMessage({ type: 'STOP_TTS' });
      setStatus(I18N[currentLang].stopped);
    });

    // Diagnostics toggle
    els.btnToggleDiag.addEventListener('click', () => {
      els.diagContent.classList.toggle('open');
    });

    // Run Diagnostics
    els.btnRunDiag.addEventListener('click', async () => {
      els.diagOutput.textContent = 'جاري فحص مشغل الفيديو والترجمة...';
      const res = await sendMessage({ type: 'REQUEST_DIAGNOSTICS' });
      if (res.success && res.reportString) {
        lastReportString = res.reportString;
        els.diagOutput.textContent = res.reportString;
        els.btnCopyDiag.disabled = false;
      } else {
        els.diagOutput.textContent = `فشل الفحص: ${res.error || 'غير متصل بالصفحة'}`;
      }
    });

    // Copy Diagnostics
    els.btnCopyDiag.addEventListener('click', async () => {
      if (lastReportString) {
        await navigator.clipboard.writeText(lastReportString);
        const originalText = els.btnCopyDiag.textContent;
        els.btnCopyDiag.textContent = currentLang === 'ar' ? 'تم النسخ ✓' : 'Copied ✓';
        setTimeout(() => {
          els.btnCopyDiag.textContent = originalText;
        }, 1500);
      }
    });

    // Manual WebVTT upload
    els.fileVtt.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
        const text = evt.target.result;
        const res = await sendMessage({
          type: 'IMPORT_VTT',
          payload: { vttContent: text }
        });
        if (res.success) {
          els.vttStatus.textContent = I18N[currentLang].vttLoaded;
          els.vttStatus.style.color = 'var(--success)';
        } else {
          els.vttStatus.textContent = `خطأ: ${res.error}`;
          els.vttStatus.style.color = 'var(--danger)';
        }
      };
      reader.readAsText(file);
    });

    // Listen for live active subtitle events
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'SUBTITLE_ACTIVE' && message.payload && message.payload.text) {
        if (els.liveCaptionText) {
          els.liveCaptionText.textContent = message.payload.text;
        }
        if (els.statCaptions) {
          const cur = parseInt(els.statCaptions.textContent || '0', 10);
          els.statCaptions.textContent = cur + 1;
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    applyLanguage('ar');
    applyTheme('light');
    setupEventListeners();
    await loadState();
    await loadVoices();
    await pingPlayer();

    // Periodic quick state poll for stats & active caption
    pollInterval = setInterval(async () => {
      const res = await sendMessage({ type: 'GET_STATE' });
      if (res.success && res.state) {
        if (res.state.lastActiveCaption && els.liveCaptionText) {
          els.liveCaptionText.textContent = res.state.lastActiveCaption;
        }
        if (res.state.stats && els.statCaptions) {
          els.statCaptions.textContent = res.state.stats.captionsRead || 0;
        }
      }
    }, 2000);
  });

  window.addEventListener('unload', () => {
    if (pollInterval) clearInterval(pollInterval);
  });
})();
