// background.mjs — CaptionVoice Manifest V3 Service Worker (Microsoft Edge compatible)
// Coordinates content scripts, popup messages, and persisted settings.
// Uses only standard Chrome/Edge extension APIs: chrome.runtime, chrome.tabs,
// chrome.scripting, chrome.storage.

(function () {
  'use strict';

  const STORAGE_KEYS = {
    SETTINGS: 'captionvoice.settings',
    EXTENSION_ACTIVE: 'captionvoice.extensionActive'
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    language: 'ar',
    voice: null,
    rate: 1.0,
    volume: 1.0,
    pitch: 1.0,
    autoDetect: true,
    highlightEnabled: true,
    speakOnDetect: true,
    autoSync: true
  };

  let state = {
    enabled: true,
    language: 'ar',
    voice: null,
    rate: 1.0,
    volume: 1.0,
    pitch: 1.0,
    currentTabId: null,
    activeSpeaking: false,
    extensionActive: false,
    lastActiveCaption: ''
  };

  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.SETTINGS,
        STORAGE_KEYS.EXTENSION_ACTIVE
      ]);
      if (result[STORAGE_KEYS.SETTINGS]) {
        Object.assign(state, result[STORAGE_KEYS.SETTINGS]);
      } else {
        Object.assign(state, DEFAULT_SETTINGS);
      }
      state.extensionActive = result[STORAGE_KEYS.EXTENSION_ACTIVE] !== undefined
        ? result[STORAGE_KEYS.EXTENSION_ACTIVE]
        : false;
    } catch (err) {
      console.error('[CaptionVoice] Failed to load settings:', err);
      Object.assign(state, DEFAULT_SETTINGS);
      state.extensionActive = false;
    }
  }

  async function saveSettings(partial) {
    Object.assign(state, partial || {});
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: state });
    } catch (err) {
      console.error('[CaptionVoice] Failed to save settings:', err);
    }
  }

  async function saveExtensionActive(active) {
    state.extensionActive = active;
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.EXTENSION_ACTIVE]: active });
    } catch (err) {
      console.error('[CaptionVoice] Failed to save extension active state:', err);
    }
  }

  // Resolve currently active valid tab ID reliably
  async function getActiveTabId() {
    if (state.currentTabId) {
      try {
        const tab = await chrome.tabs.get(state.currentTabId);
        if (tab && !tab.url?.startsWith('chrome://') && !tab.url?.startsWith('edge://')) {
          return state.currentTabId;
        }
      } catch (_) {
        state.currentTabId = null;
      }
    }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id && !tab.url?.startsWith('chrome://') && !tab.url?.startsWith('edge://')) {
        state.currentTabId = tab.id;
        return tab.id;
      }
    } catch (err) {
      console.error('[CaptionVoice] Error querying active tab:', err);
    }
    return null;
  }

  // Forward a message to the content script of the active tab
  async function forwardToContent(tabId, message) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response;
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Inject content bundle if not already present
  async function ensureContentInjected(tabId) {
    try {
      const pingRes = await forwardToContent(tabId, { type: 'PING' });
      if (pingRes && pingRes.pong) {
        return true;
      }
    } catch (_) {}

    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content/content.bundle.js']
      });
      await new Promise(r => setTimeout(r, 200));
      return true;
    } catch (err) {
      console.error('[CaptionVoice] Failed to inject content script into tab', tabId, err);
      return false;
    }
  }

  // Lifecycle
  chrome.runtime.onInstalled.addListener(async (details) => {
    await loadSettings();
    if (details.reason === 'install') {
      await incrementSession();
      console.log('[CaptionVoice] Installed v', chrome.runtime.getManifest().version);
    }
  });

  chrome.runtime.onStartup.addListener(loadSettings);

  // Message broker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type, payload } = message || {};
    const respond = (resp) => {
      try {
        sendResponse(resp);
      } catch (_) {}
    };

    (async () => {
      try {
        switch (type) {
          case 'GET_STATE': {
            respond({ success: true, state });
            break;
          }

          case 'UPDATE_STATE': {
            if (payload) {
              await saveSettings(payload);
            }
            respond({ success: true, state });
            break;
          }

          case 'SUBTITLE_ACTIVE': {
            if (payload && payload.text) {
              state.lastActiveCaption = payload.text;
            }
            respond({ success: true });
            break;
          }

          case 'TOGGLE_EXTENSION': {
            const active = payload && payload.isActive !== undefined ? payload.isActive : !state.extensionActive;
            await saveExtensionActive(active);

            const tabId = await getActiveTabId();
            if (tabId) {
              await ensureContentInjected(tabId);
              await forwardToContent(tabId, { type: 'TOGGLE_EXTENSION', payload: { isActive: active } });
            }
            respond({ success: true, state });
            break;
          }

          case 'START_TTS':
          case 'STOP_TTS':
          case 'PAUSE_TTS':
          case 'RESUME_TTS':
          case 'UPDATE_TTS_SETTINGS':
          case 'REQUEST_DIAGNOSTICS':
          case 'GET_VOICES':
          case 'SPEAK_TEST':
          case 'PING': {
            const tabId = await getActiveTabId();
            if (!tabId) {
              respond({ success: false, error: 'No active web tab detected. Please open a video course page.' });
              return;
            }

            let response = await forwardToContent(tabId, message);
            if (!response || !response.success) {
              // Inject content bundle and retry
              const injected = await ensureContentInjected(tabId);
              if (injected) {
                response = await forwardToContent(tabId, message);
              }
            }
            respond(response || { success: false, error: 'Content script failed to respond' });
            break;
          }

          default:
            respond({ success: false, error: `Unknown message type: ${type}` });
        }
      } catch (err) {
        respond({ success: false, error: err.message || String(err) });
      }
    })();

    return true; // Keep channel open for async response
  });

  // Track active tab
  chrome.tabs.onActivated.addListener((activeInfo) => {
    state.currentTabId = activeInfo.tabId;
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (
      changeInfo.status === 'complete' &&
      tab.url &&
      !tab.url.startsWith('chrome://') &&
      !tab.url.startsWith('edge://') &&
      !tab.url.startsWith('moz-extension://') &&
      !tab.url.startsWith('chrome-extension://')
    ) {
      state.currentTabId = tabId;
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (state.currentTabId === tabId) {
      state.currentTabId = null;
    }
  });

  loadSettings();
  console.log('[CaptionVoice] Service worker initialized');
})();
