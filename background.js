// Service Worker - Background Script
/* global ConfigCache, QuizProviders, ProviderCatalog, ProviderAnalytics, handleFetchSerpApi, BackgroundAgent, chrome, Number, Array, Boolean, RegExp, encodeURIComponent, parseInt, globalThis */

// Charger les modules partagés dans le contexte du service worker
if (typeof importScripts === 'function') {
  importScripts('provider-catalog.js', 'course-media.js', 'providers.js', 'background-agent.js');
} else if (typeof require === 'function' && typeof module !== 'undefined' && module.exports) {
  if (typeof globalThis.ProviderCatalog === 'undefined') {
    try {
      require('./provider-catalog.js');
    } catch (_) { /* ignore if unavailable in isolated test */ }
  }
  if (typeof globalThis.CourseMedia === 'undefined') {
    try {
      require('./course-media.js');
    } catch (_) { /* ignore if unavailable in isolated test */ }
  }
  if (typeof globalThis.QuizProviders === 'undefined' || typeof globalThis.ConfigCache === 'undefined') {
    try {
      require('./providers.js');
    } catch (_) { /* ignore if unavailable in isolated test */ }
  }
  if (typeof globalThis.BackgroundAgent === 'undefined') {
    try {
      require('./background-agent.js');
    } catch (_) { /* ignore if unavailable in isolated test */ }
  }
}

// CRIT-05 : Mutex global d'injections en cours par tabId pour éviter la double injection
const _injectionsInProgress = new Map();
const _bridgeInjectionsInProgress = new Map();

// ──────────────────────────────────────────────
// SEC-05 : Chargeur de system prompt (contexte extension, non-accessible au web)
// ──────────────────────────────────────────────

let _cachedSwSystemPrompt = null;

/**
 * Charge system.md depuis le contexte SW (pas de web_accessible_resources requis).
 * Cache mémoire pour éviter les re-fetches. Invariant : success ou throws.
 * @returns {Promise<{success: boolean, content?: string, error?: string}>}
 */
async function handleLoadSystemPrompt() {
  if (_cachedSwSystemPrompt) {
    return { success: true, content: _cachedSwSystemPrompt };
  }

  const url = chrome.runtime.getURL('system.md');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Impossible de charger system.md: HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text || text.trim().length === 0) {
    throw new Error('system.md est vide.');
  }

  _cachedSwSystemPrompt = text.trim();
  return { success: true, content: _cachedSwSystemPrompt };
}

// ──────────────────────────────────────────────
// Keyboard Shortcuts
// ──────────────────────────────────────────────

async function broadcastToActiveTabs(actionObject) {
  // Règle 8.5 : assertions de préconditions
  if (!actionObject || typeof actionObject !== 'object') {
    throw new Error('Argument actionObject doit être un objet valide.');
  }
  if (typeof actionObject.action !== 'string') {
    throw new Error('Le champ actionObject.action doit être spécifié.');
  }

  const activeTabs = await chrome.tabs.query({ active: true });
  if (activeTabs.length === 0) {
    showNotification("Impossible de trouver un onglet actif.");
    return false;
  }

  let success = false;
  for (const t of activeTabs) {
    if (t.url && t.url.startsWith('http')) {
      try {
        await new Promise((resolve) => {
          chrome.tabs.sendMessage(t.id, actionObject, (response) => {
            if (chrome.runtime.lastError) {
              console.warn(`[broadcastToActiveTabs] Erreur d'envoi à l'onglet ${t.id}:`, chrome.runtime.lastError.message);
              resolve(false);
            } else {
              success = true;
              resolve(true);
            }
          });
        });
      } catch (e) {
        console.error(`[broadcastToActiveTabs] Exception lors de l'envoi à l'onglet ${t.id}:`, e);
      }
    }
  }
  return success;
}

const MISSING_RECEIVER_RE = /receiving end does not exist|could not establish connection/i;
const ANALYZE_RETRY_DELAYS_MS = [50, 100];
let _panicClearEpoch = 0;

async function sendMessageWithMissingReceiverRetry(tabId, payload, expectedPanicEpoch = _panicClearEpoch) {
  const totalAttempts = ANALYZE_RETRY_DELAYS_MS.length + 1;
  let lastErrorMessage = '';

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    if (expectedPanicEpoch !== _panicClearEpoch) {
      return { ok: false, cancelled: true, error: 'Analyse annulée' };
    }
    const result = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || 'Erreur de communication avec l\'onglet'
          });
        } else {
          resolve({ ok: true, response });
        }
      });
    });

    if (expectedPanicEpoch !== _panicClearEpoch) {
      return { ok: false, cancelled: true, error: 'Analyse annulée' };
    }
    if (result.ok) {
      return result;
    }
    lastErrorMessage = result.error;
    if (!MISSING_RECEIVER_RE.test(lastErrorMessage) || attempt >= totalAttempts - 1) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, ANALYZE_RETRY_DELAYS_MS[attempt]));
    if (expectedPanicEpoch !== _panicClearEpoch) {
      return { ok: false, cancelled: true, error: 'Analyse annulée' };
    }
  }

  return { ok: false, error: lastErrorMessage };
}

async function sendAnalyzeQuizToTab(tabId, settings, expectedPanicEpoch = _panicClearEpoch) {
  if (expectedPanicEpoch !== _panicClearEpoch) {
    return { ok: false, cancelled: true, error: 'Analyse annulée' };
  }
  await injectCoreScripts(tabId);
  if (expectedPanicEpoch !== _panicClearEpoch) {
    return { ok: false, cancelled: true, error: 'Analyse annulée' };
  }
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync &&
        typeof chrome.storage.sync.get === 'function') {
      const freshSync = await chrome.storage.sync.get(['enabled']);
      if (expectedPanicEpoch !== _panicClearEpoch || (freshSync && freshSync.enabled === false)) {
        return { ok: false, cancelled: true, error: 'Analyse annulée' };
      }
    }
  } catch (_) { /* ignore sync re-check failure */ }
  return sendMessageWithMissingReceiverRetry(tabId, {
    action: 'analyzeQuiz',
    settings,
    forceFallback: true
  }, expectedPanicEpoch);
}

async function handleAnalyzeQuizCommand() {
  const startPanicEpoch = _panicClearEpoch;
  const settings = await chrome.storage.sync.get(['enabled', 'model', 'thinkingMode', 'thinkingDepth']);
  if (startPanicEpoch !== _panicClearEpoch || !settings.enabled) {
    if (startPanicEpoch === _panicClearEpoch) {
      showNotification('Activez d\'abord l\'extension (Ctrl+Shift+1)');
    }
    return false;
  }

  let activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (startPanicEpoch !== _panicClearEpoch) return false;
  let httpTabs = Array.isArray(activeTabs)
    ? activeTabs.filter((t) => t && typeof t.id === 'number' && typeof t.url === 'string' && /^https?:\/\//i.test(t.url))
    : [];

  if (httpTabs.length === 0) {
    activeTabs = await chrome.tabs.query({ active: true });
    if (startPanicEpoch !== _panicClearEpoch) return false;
    httpTabs = Array.isArray(activeTabs)
      ? activeTabs.filter((t) => t && typeof t.id === 'number' && typeof t.url === 'string' && /^https?:\/\//i.test(t.url))
      : [];
  }

  if (httpTabs.length === 0) {
    showNotification("Impossible de trouver l'onglet actif pour analyser. Rechargez la page.");
    return false;
  }

  let success = false;
  let cancelled = false;
  for (const t of httpTabs) {
    if (startPanicEpoch !== _panicClearEpoch) {
      cancelled = true;
      break;
    }
    try {
      const result = await sendAnalyzeQuizToTab(t.id, settings, startPanicEpoch);
      if (result.cancelled) {
        cancelled = true;
      } else if (result.ok) {
        success = true;
      } else {
        console.warn(`[handleAnalyzeQuizCommand] Erreur d'envoi à l'onglet ${t.id}:`, result.error);
      }
    } catch (e) {
      console.error(`[handleAnalyzeQuizCommand] Exception lors de l'envoi à l'onglet ${t.id}:`, e);
    }
  }

  if (!success && !cancelled && startPanicEpoch === _panicClearEpoch) {
    showNotification("Impossible de trouver l'onglet actif pour analyser. Rechargez la page.");
  }
  return success;
}

if (typeof chrome !== 'undefined' && chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    console.log(`Command received: ${command}`);

    switch (command) {
      case 'toggle-extension':
        await toggleExtension();
        break;

      case 'analyze-quiz':
        await handleAnalyzeQuizCommand();
        break;

      case 'toggle-auto-mode':
        await toggleAutoMode();
        break;

      case 'clear-highlights': {
        const [, clearSuccess] = await Promise.all([
          handleClearSidePanelState('panic'),
          notifyHttpTabs({ action: 'clearHighlights', skipSidePanelClear: true })
        ]);
        if (clearSuccess) {
          showNotification('Surlignages effacés');
        } else {
          showNotification('Panneau latéral effacé');
        }
        break;
      }
    }
  });
}

// ──────────────────────────────────────────────
// Toggle Extension
// ──────────────────────────────────────────────

async function sendTabMessageWithAck(tabId, payload) {
  if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.sendMessage !== 'function') {
    return { delivered: false, response: null };
  }
  return new Promise((resolve) => {
    let settled = false;
    let timerId = null;
    const finish = (delivered, response) => {
      if (settled) return;
      settled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      resolve({ delivered, response: response ?? null });
    };
    timerId = setTimeout(() => finish(false, null), 1000);
    if (timerId && typeof timerId.unref === 'function') {
      timerId.unref();
    }
    try {
      const maybePromise = chrome.tabs.sendMessage(tabId, payload, (resp) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn(`Impossible de notifier l'onglet ${tabId} :`, chrome.runtime.lastError.message);
          finish(false, null);
        } else {
          finish(true, resp ?? null);
        }
      });
      if (maybePromise && typeof maybePromise === 'object' && typeof maybePromise.finally === 'function') {
        void (async () => {
          try {
            const val = await maybePromise;
            finish(true, val ?? null);
          } catch (err) {
            console.warn(`Impossible de notifier l'onglet ${tabId} :`, err?.message || err);
            finish(false, null);
          }
        })();
      }
    } catch (err) {
      console.warn(`Impossible de notifier l'onglet ${tabId} :`, err?.message || err);
      finish(false, null);
    }
  });
}

async function notifyHttpTabs(payload, fallbackTabId = null) {
  if (!payload || typeof payload !== 'object' || typeof chrome === 'undefined' || !chrome.tabs) {
    return false;
  }
  let targetTabs = [];
  if (typeof chrome.tabs.query === 'function') {
    const tabs = await chrome.tabs.query({});
    targetTabs = Array.isArray(tabs)
      ? tabs.filter((tab) => tab && typeof tab.id === 'number' && typeof tab.url === 'string' && /^https?:\/\//i.test(tab.url))
      : [];
  } else if (typeof fallbackTabId === 'number') {
    targetTabs = [{ id: fallbackTabId }];
  }
  const targetIds = new Set(targetTabs.map((t) => t.id));
  if (targetIds.size === 0) return false;
  const results = await Promise.allSettled(
    Array.from(targetIds).map((id) => sendTabMessageWithAck(id, payload))
  );
  return results.some((r) => r.status === 'fulfilled' && r.value && r.value.delivered);
}

let _handledSyncDisable = false;

async function toggleExtension() {
  // Règle 8.5 : assertions de préconditions
  if (typeof chrome === 'undefined' || !chrome.storage) {
    throw new Error('API chrome non disponible.');
  }
  if (!chrome.storage.sync) {
    throw new Error('Stockage chrome.storage.sync non disponible.');
  }

  const result = await chrome.storage.sync.get(['enabled']);
  const newState = !result.enabled;
  _handledSyncDisable = !newState;

  await chrome.storage.sync.set({ enabled: newState });

  if (!newState) {
    await Promise.all([
      handleClearSidePanelState('disabled'),
      notifyHttpTabs({
        action: 'toggleExtension',
        enabled: false,
        skipSidePanelClear: true
      })
    ]);
  } else {
    await notifyHttpTabs({
      action: 'toggleExtension',
      enabled: true
    });
  }

  showNotification(newState ? 'Extension activée' : 'Extension désactivée');
}

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged &&
    typeof chrome.storage.onChanged.addListener === 'function') {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes &&
        Object.prototype.hasOwnProperty.call(changes, 'enabled') && changes.enabled) {
      if (changes.enabled.newValue === true) {
        _handledSyncDisable = false;
      } else if (changes.enabled.newValue === false && !_handledSyncDisable) {
        _handledSyncDisable = true;
        void Promise.all([
          handleClearSidePanelState('disabled'),
          notifyHttpTabs({ action: 'toggleExtension', enabled: false, skipSidePanelClear: true })
        ]);
      }
    }
  });
}

async function toggleAutoMode() {
  // Règle 8.5 : assertions de préconditions
  if (typeof chrome === 'undefined' || !chrome.storage) {
    throw new Error('API chrome non disponible.');
  }
  if (!chrome.storage.sync) {
    throw new Error('Stockage chrome.storage.sync non disponible.');
  }

  const result = await chrome.storage.sync.get(['autoMode']);
  const newState = !result.autoMode;
  await chrome.storage.sync.set({ autoMode: newState });

  // Notifier tous les onglets HTTP du changement de mode automatique
  await notifyHttpTabs({
    action: 'toggleAutoMode',
    autoMode: newState
  });

  showNotification(newState ? 'Mode Auto activé' : 'Mode Auto désactivé');
}

async function injectCoreScripts(tabId) {
  // Règle 8.5 : assertions de préconditions
  if (typeof tabId !== 'number') {
    throw new Error('injectCoreScripts: tabId doit être un nombre.');
  }

  if (_injectionsInProgress.has(tabId)) {
    console.log(`⏳ [Mutex] Injection déjà en cours pour l'onglet ${tabId}, attente du verrou...`);
    return _injectionsInProgress.get(tabId);
  }

  const injectionPromise = (async () => {
    try {
      const checkResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => !!window.__quizHelperLoaded
      });
      if (checkResult && checkResult[0] && checkResult[0].result) {
        return;
      }
      
      const scripts = [
        'provider-catalog.js',
        'providers.js',
        'schema-cache.js',
        'schema-detector.js',
        'dom-extractor.js',
        'highlight-manager.js',
        'content.js'
      ];
      
      for (const file of scripts) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [file]
        });
      }
    } catch (e) {
      console.error(`[injectCoreScripts] Erreur injection tab ${tabId}:`, e.message);
      throw e;
    }
  })();

  _injectionsInProgress.set(tabId, injectionPromise);

  try {
    await injectionPromise;
  } finally {
    _injectionsInProgress.delete(tabId);
  }
}

async function analyzeCurrentQuiz(tab) {
  // Règle 8.5 : assertions de préconditions
  if (!tab || typeof tab !== 'object') {
    throw new Error('L\'argument tab doit être un objet.');
  }
  if (typeof tab.id !== 'number') {
    throw new Error('L\'identifiant de l\'onglet (tab.id) doit être un nombre.');
  }

  const startPanicEpoch = _panicClearEpoch;
  const settings = await chrome.storage.sync.get(['enabled', 'model', 'thinkingMode', 'thinkingDepth']);
  if (startPanicEpoch !== _panicClearEpoch) return;
  if (!settings.enabled) {
    showNotification('Activez d\'abord l\'extension (Ctrl+Shift+1)');
    return;
  }

  try {
    const result = await sendAnalyzeQuizToTab(tab.id, settings, startPanicEpoch);
    if (result.cancelled || startPanicEpoch !== _panicClearEpoch) {
      return;
    }
    if (!result.ok) {
      throw new Error(result.error || 'Erreur de communication avec l\'onglet');
    }
  } catch (error) {
    if (startPanicEpoch !== _panicClearEpoch) return;
    console.error(`[analyzeCurrentQuiz] Échec d'envoi du message d'analyse à l'onglet ${tab.id}:`, error);
    showNotification("Impossible d'analyser le quiz. Assurez-vous que la page est entièrement chargée.");
  }
}

// ──────────────────────────────────────────────
// Pre-Warm, Analytics & On-Demand MAIN-World Page Bridge Handlers
// ──────────────────────────────────────────────

const SYNC_CONFIG_KEYS = [
  'captureImages', 'imageMinSize', 'imageQuality',
  'contextText', 'customQuestionSelector', 'customAnswerSelector',
  'highlightColor', 'highlightIntensity', 'highlightDiscretion', 'showConfidenceBadge',
  'providerOrder', 'customModels', 'agenticSearch', 'autoMode', 'enabled'
];

function getLocalConfigKeys() {
  const fallback = [
    'groqApiKey', 'geminiApiKey', 'nvidiaApiKey',
    'mistralApiKey', 'claudeApiKey',
    'providerConfigs', 'serpApiKey', 'contextFiles'
  ];
  const qp = typeof QuizProviders !== 'undefined'
    ? QuizProviders
    : (typeof globalThis !== 'undefined' ? globalThis.QuizProviders : null);
  if (qp && typeof qp.getAllStorageKeys === 'function') {
    return [...new Set([...qp.getAllStorageKeys(), 'contextFiles'])];
  }
  if (qp && typeof qp.getAllApiKeyFields === 'function') {
    return [...new Set([...qp.getAllApiKeyFields(), 'providerConfigs', 'serpApiKey', 'contextFiles'])];
  }
  return fallback;
}

const PREWARM_SIGNATURE_SESSION_KEY = '_lastPreWarmConfigSignature';
let _lastPreWarmConfigSignatureFallback = null;

async function getLastPreWarmSignature() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session &&
      typeof chrome.storage.session.get === 'function') {
    try {
      const data = await chrome.storage.session.get([PREWARM_SIGNATURE_SESSION_KEY]);
      if (data && typeof data[PREWARM_SIGNATURE_SESSION_KEY] === 'string') {
        return data[PREWARM_SIGNATURE_SESSION_KEY];
      }
      return null;
    } catch {
      /* fallback to in-memory copy when session storage is unavailable */
    }
  }
  return _lastPreWarmConfigSignatureFallback;
}

async function setLastPreWarmSignature(signature) {
  _lastPreWarmConfigSignatureFallback = signature;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session &&
      typeof chrome.storage.session.set === 'function') {
    try {
      await chrome.storage.session.set({ [PREWARM_SIGNATURE_SESSION_KEY]: signature });
    } catch {
      /* ignore session storage errors */
    }
  }
}

function handleTabRemoved(tabId) {
  _injectionsInProgress.delete(tabId);
  _bridgeInjectionsInProgress.delete(tabId);
}

if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onRemoved && typeof chrome.tabs.onRemoved.addListener === 'function') {
  chrome.tabs.onRemoved.addListener(handleTabRemoved);
}

/**
 * Redacts URLs (via sanitizeUrlForLog), API keys, Bearer tokens, and configured secrets
 * from error messages before logging or returning to callers.
 */
function sanitizeErrorMessage(rawError, config) {
  let raw = '';
  if (typeof rawError === 'string') {
    raw = rawError;
  } else if (rawError && typeof rawError.message === 'string') {
    raw = rawError.message;
  } else if (rawError !== undefined && rawError !== null) {
    raw = String(rawError);
  }
  if (!raw) return 'Erreur inconnue';

  let cleaned = raw
    .replace(/https?:\/\/[^\s"'<>\\]+/gi, (match) => sanitizeUrlForLog(match))
    .replace(/\b(Bearer|Basic|Token)\s+[^\s,;}"'\\\]]+/gi, '$1 ***')
    .replace(/\b(?:AIza[0-9A-Za-z\-_]{10,}|sk-[A-Za-z0-9\-_]{10,}|gsk_[A-Za-z0-9\-_]{10,}|nvapi-[A-Za-z0-9\-_]{10,}|xai-[A-Za-z0-9\-_]{10,}|hf_[A-Za-z0-9\-_]{10,}|ghp_[A-Za-z0-9\-_]{10,})\b/g, '***')
    .replace(/(\\"?\b(?:api[\s_-]?key|x-api-key|x-goog-api-key|authorization|access[\s_-]?token|token|secret|auth|password|credential|key)\b\\"?\s*[:=]\s*\\")[^"]*\\"/gi, '$1***\\"')
    .replace(/(\\'?\b(?:api[\s_-]?key|x-api-key|x-goog-api-key|authorization|access[\s_-]?token|token|secret|auth|password|credential|key)\b\\'?\s*[:=]\s*\\')[^']*\\'/gi, "$1***\\'")
    .replace(/(["']?\b(?:api[\s_-]?key|x-api-key|x-goog-api-key|authorization|access[\s_-]?token|token|secret|auth|password|credential|key)\b["']?\s*[:=]\s*)(["'])(?:(?!\2)[^\\]|\\.)*\2/gi, '$1$2***$2')
    .replace(/(["']?\b(?:api[\s_-]?key|x-api-key|x-goog-api-key|authorization|access[\s_-]?token|token|secret|auth|password|credential)\b["']?\s*[:=]\s*)(?:(?:Bearer|Basic|Token)\s+)?[^\s&,;}"'\\\]]+/gi, '$1***')
    .replace(/(\bkey\s*=\s*)[^\s&,;}"'\\\]]+/gi, '$1***');

  const NON_SECRET_LOCAL_PLACEHOLDERS = new Set([
    'ollama', 'lm-studio', 'llamacpp', 'freecc', 'local'
  ]);
  const isRedactableValue = (val) => {
    if (typeof val !== 'string') return false;
    const trimmed = val.trim();
    return trimmed.length >= 4 && !NON_SECRET_LOCAL_PLACEHOLDERS.has(trimmed.toLowerCase());
  };

  if (config && typeof config === 'object') {
    const cfgSecrets = [];
    for (const field of getLocalConfigKeys()) {
      if (field === 'contextFiles' || field === 'providerConfigs') continue;
      const val = config[field];
      if (isRedactableValue(val)) {
        cfgSecrets.push(val.trim());
      }
    }
    if (config.apiKeys && typeof config.apiKeys === 'object') {
      for (const [k, val] of Object.entries(config.apiKeys)) {
        if (/(?:apikey|secret|token|password|credential|serpapi)/i.test(k) && isRedactableValue(val)) {
          cfgSecrets.push(val.trim());
        } else if (k === 'providerConfigs' && val && typeof val === 'object') {
          for (const pCfg of Object.values(val)) {
            if (pCfg && typeof pCfg === 'object' && isRedactableValue(pCfg.apiKey)) {
              cfgSecrets.push(pCfg.apiKey.trim());
            }
          }
        }
      }
    }
    if (config.providerConfigs && typeof config.providerConfigs === 'object') {
      for (const pCfg of Object.values(config.providerConfigs)) {
        if (pCfg && typeof pCfg === 'object' && isRedactableValue(pCfg.apiKey)) {
          cfgSecrets.push(pCfg.apiKey.trim());
        }
      }
    }
    if (Array.isArray(config._extraRedactions)) {
      for (const item of config._extraRedactions) {
        if (isRedactableValue(item)) {
          cfgSecrets.push(item.trim());
        }
      }
    }
    const orderedSecrets = Array.from(new Set(cfgSecrets)).sort((a, b) => b.length - a.length);
    for (const s of orderedSecrets) {
      if (cleaned.includes(s)) {
        cleaned = cleaned.split(s).join('***');
      }
    }
  }
  return cleaned;
}

function extractHeaderRedactions(headers) {
  const out = [];
  if (!headers || typeof headers !== 'object') return out;
  const pairs = typeof headers.entries === 'function'
    ? Array.from(headers.entries())
    : Object.entries(headers);
  for (const [hName, hVal] of pairs) {
    if (typeof hVal === 'string' && /^(?:x-goog-api-key|x-api-key|authorization|proxy-authorization|api-key)$/i.test(String(hName))) {
      const trimmed = hVal.trim();
      const bare = trimmed.replace(/^(?:Bearer|Basic|Token)\s+/i, '').trim();
      if (bare.length >= 4) {
        out.push(bare);
        if (trimmed !== bare && trimmed.length >= 4) {
          out.push(trimmed);
        }
      }
    }
  }
  return out;
}

async function resolveConfigForPreWarm(message) {
  let cachedConfig = {};
  const hasConfigCache = typeof ConfigCache !== 'undefined' && ConfigCache !== null;
  const isCacheInit = hasConfigCache &&
    (typeof ConfigCache.isInitialized !== 'function' || ConfigCache.isInitialized());

  if (isCacheInit && typeof ConfigCache.getAll === 'function') {
    try {
      cachedConfig = ConfigCache.getAll() || {};
    } catch (_) {
      cachedConfig = {};
    }
  }

  let storageConfig = {};
  if (typeof chrome !== 'undefined' && chrome && chrome.storage) {
    try {
      const localKeys = getLocalConfigKeys();
      const [syncData, localData] = await Promise.all([
        chrome.storage.sync && typeof chrome.storage.sync.get === 'function'
          ? Promise.resolve(chrome.storage.sync.get(SYNC_CONFIG_KEYS))
          : Promise.resolve({}),
        chrome.storage.local && typeof chrome.storage.local.get === 'function'
          ? Promise.resolve(chrome.storage.local.get(localKeys))
          : Promise.resolve({})
      ]);
      storageConfig = {
        ...(syncData && typeof syncData === 'object' ? syncData : {}),
        ...(localData && typeof localData === 'object' ? localData : {})
      };
    } catch (_) {
      storageConfig = {};
    }
  }

  const baseConfig = Object.keys(storageConfig).length > 0
    ? storageConfig
    : cachedConfig;

  if (message && message.config && typeof message.config === 'object') {
    return { ...baseConfig, ...message.config };
  }
  return baseConfig;
}

function computePreWarmSignature(config) {
  if (!config || typeof config !== 'object') return '';
  const activeProviders = getLocalConfigKeys()
    .filter((k) => k !== 'contextFiles' && k !== 'providerConfigs' && typeof config[k] === 'string' && config[k].trim().length > 0)
    .sort()
    .join(',');
  const pConfigs = config.providerConfigs && typeof config.providerConfigs === 'object'
    ? Object.keys(config.providerConfigs)
        .filter((k) => {
          const c = config.providerConfigs[k];
          return c && typeof c === 'object' && (c.enabled === true || (typeof c.baseUrl === 'string' && c.baseUrl.trim()) || (typeof c.accountId === 'string' && c.accountId.trim()));
        })
        .sort()
        .map((k) => `${k}:${config.providerConfigs[k].enabled ? '1' : '0'}:${config.providerConfigs[k].baseUrl || ''}:${config.providerConfigs[k].accountId || ''}`)
        .join(';')
    : '';
  const order = Array.isArray(config.providerOrder) ? config.providerOrder.join(',') : '';
  return `${activeProviders}|${pConfigs}|${order}`;
}

/**
 * F-AUTO-02 : Pre-warms provider metadata and context caches.
 * @param {Object} [message]
 * @returns {Promise<Object>}
 */
async function handlePreWarmProviders(message = {}) {
  let config = {};
  try {
    config = await resolveConfigForPreWarm(message);
    if (typeof QuizProviders === 'undefined' || !QuizProviders || typeof QuizProviders.preWarmProviders !== 'function') {
      throw new Error('QuizProviders.preWarmProviders non disponible');
    }

    const rawOptions = (message && message.options && typeof message.options === 'object')
      ? { ...message.options }
      : {};
    if (message && typeof message === 'object') {
      if (message.force !== undefined && rawOptions.force === undefined) rawOptions.force = message.force;
      if (message.ttlMs !== undefined && rawOptions.ttlMs === undefined) rawOptions.ttlMs = message.ttlMs;
      if (message.syncModels !== undefined && rawOptions.syncModels === undefined) rawOptions.syncModels = message.syncModels;
      if (message.now !== undefined && rawOptions.now === undefined) rawOptions.now = message.now;
    }

    const currentSignature = computePreWarmSignature(config);
    const prevSignature = await getLastPreWarmSignature();
    const configChanged = prevSignature !== null && prevSignature !== currentSignature;
    await setLastPreWarmSignature(currentSignature);

    const preWarmConfigArg = { ...config, ...rawOptions };
    Object.defineProperty(preWarmConfigArg, 'config', {
      value: config,
      enumerable: false,
      configurable: true,
      writable: true
    });
    if (configChanged && rawOptions.force === undefined) {
      Object.defineProperty(preWarmConfigArg, 'force', {
        value: true,
        enumerable: false,
        configurable: true,
        writable: true
      });
    }

    const result = await QuizProviders.preWarmProviders(preWarmConfigArg, rawOptions);
    return {
      success: true,
      ...(result && typeof result === 'object' ? result : {})
    };
  } catch (err) {
    const safeError = sanitizeErrorMessage(err, config);
    console.error('[handlePreWarmProviders] Erreur:', safeError);
    return { success: false, error: safeError };
  }
}

/**
 * F-ANA-03 : Returns persisted/in-memory provider telemetry stats.
 * @returns {Promise<{success: boolean, stats?: Object, error?: string}>}
 */
async function handleGetProviderStats() {
  try {
    const analytics = (typeof QuizProviders !== 'undefined' && QuizProviders && QuizProviders.ProviderAnalytics)
      ? QuizProviders.ProviderAnalytics
      : (typeof ProviderAnalytics !== 'undefined' ? ProviderAnalytics : null);

    if (!analytics) {
      throw new Error('ProviderAnalytics non disponible');
    }

    let stats = null;
    if (typeof analytics.loadStats === 'function') {
      stats = await analytics.loadStats();
    }
    if ((!stats || typeof stats !== 'object') && typeof analytics.getStats === 'function') {
      stats = await analytics.getStats();
    }
    return { success: true, stats };
  } catch (err) {
    const safeError = sanitizeErrorMessage(err);
    console.error('[handleGetProviderStats] Erreur:', safeError);
    return { success: false, error: safeError };
  }
}

/**
 * F-ANA-03 : Resets persisted and in-memory provider telemetry stats.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function handleResetProviderStats() {
  try {
    const analytics = (typeof QuizProviders !== 'undefined' && QuizProviders && QuizProviders.ProviderAnalytics)
      ? QuizProviders.ProviderAnalytics
      : (typeof ProviderAnalytics !== 'undefined' ? ProviderAnalytics : null);

    if (!analytics || typeof analytics.resetStats !== 'function') {
      throw new Error('ProviderAnalytics.resetStats non disponible');
    }

    await analytics.resetStats();
    return { success: true };
  } catch (err) {
    const safeError = sanitizeErrorMessage(err);
    console.error('[handleResetProviderStats] Erreur:', safeError);
    return { success: false, error: safeError };
  }
}

function isAllowedPageBridgeUrl(candidateUrl) {
  if (typeof candidateUrl !== 'string' || !/^https?:\/\//i.test(candidateUrl.trim())) {
    return false;
  }
  try {
    const parsed = new URL(candidateUrl.trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch (_) {
    return false;
  }
}

/**
 * F-DET-03 / F-DET-04 : On-demand injection of page-bridge.js into the tab's MAIN world.
 * Strictly gated to http(s) URLs and deduplicated per tabId via _bridgeInjectionsInProgress.
 * @param {Object} [message]
 * @param {Object} [sender]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function handleInjectPageBridge(message = {}, sender = {}) {
  const tabId = sender?.tab?.id ?? message?.tabId;
  if (typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId <= 0) {
    return { success: false, error: 'tabId invalide ou introuvable' };
  }

  const senderTabUrl = (sender && sender.tab && typeof sender.tab.url === 'string')
    ? sender.tab.url.trim()
    : '';

  if (senderTabUrl && !isAllowedPageBridgeUrl(senderTabUrl)) {
    return { success: false, error: 'URL non autorisée pour page-bridge' };
  }

  if (_bridgeInjectionsInProgress.has(tabId)) {
    return _bridgeInjectionsInProgress.get(tabId);
  }

  const bridgePromise = (async () => {
    try {
      let tabUrl = senderTabUrl;
      if (!tabUrl && typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.get === 'function') {
        try {
          const tabInfo = await chrome.tabs.get(tabId);
          if (tabInfo && typeof tabInfo.url === 'string') {
            tabUrl = tabInfo.url.trim();
          }
        } catch (_) {
          tabUrl = '';
        }
      }

      if (!isAllowedPageBridgeUrl(tabUrl)) {
        return { success: false, error: 'URL non autorisée pour page-bridge' };
      }

      if (typeof chrome === 'undefined' || !chrome.scripting || typeof chrome.scripting.executeScript !== 'function') {
        throw new Error('chrome.scripting.executeScript non disponible');
      }

      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['page-bridge.js'],
        world: 'MAIN'
      });

      return { success: true };
    } catch (err) {
      const safeError = sanitizeErrorMessage(err);
      console.error(`[handleInjectPageBridge] Erreur injection tab ${tabId}:`, safeError);
      return { success: false, error: safeError };
    }
  })();

  _bridgeInjectionsInProgress.set(tabId, bridgePromise);

  try {
    return await bridgePromise;
  } finally {
    if (_bridgeInjectionsInProgress.get(tabId) === bridgePromise) {
      _bridgeInjectionsInProgress.delete(tabId);
    }
  }
}

// ──────────────────────────────────────────────
// F-UX-01 : Side Panel State & Panic Purge
// ──────────────────────────────────────────────

const SIDE_PANEL_SESSION_KEY = 'sidePanelQuizState';
let _sidePanelStateFallback = null;
let _sidePanelStateEpoch = 0;
let _saveOpQueue = Promise.resolve();
let _clearOpQueue = Promise.resolve();
let _clearPendingCount = 0;
let _activeClearDone = Promise.resolve();
let _hasAuthoritativeMemoryState = false;
let _lastGlobalClearAt = 0;
const _activeSolveAbortControllers = new Set();

function abortActiveSolveRequests() {
  for (const ctrl of Array.from(_activeSolveAbortControllers)) {
    try {
      ctrl.abort();
    } catch (_) { /* ignore abort errors */ }
  }
  _activeSolveAbortControllers.clear();
}

function runSerializedSaveOp(taskFn) {
  const prev = _saveOpQueue;
  let releaseNext = null;
  _saveOpQueue = new Promise((resolve) => {
    releaseNext = resolve;
  });
  return (async () => {
    try {
      await prev;
    } catch (_) {
      /* previous save failure does not block subsequent saves */
    }
    try {
      return await taskFn();
    } finally {
      if (releaseNext) releaseNext();
    }
  })();
}

function enqueueClearSessionStorage() {
  const prev = _clearOpQueue;
  let release = null;
  const next = new Promise((resolve) => {
    release = resolve;
  });
  _clearOpQueue = next;
  _activeClearDone = next;
  _clearPendingCount++;
  return (async () => {
    try {
      await prev;
    } catch (_) {
      /* previous clear failure does not block next clear */
    }
    try {
      await clearSidePanelSessionStorageKey();
    } finally {
      _clearPendingCount = Math.max(0, _clearPendingCount - 1);
      if (release) release();
    }
  })();
}

async function awaitPendingClears() {
  while (_clearPendingCount > 0) {
    const p = _activeClearDone;
    try {
      await p;
    } catch (_) {
      /* ignore clear errors */
    }
    if (_activeClearDone === p && _clearPendingCount === 0) {
      break;
    }
  }
}

function sanitizeSidePanelPlainText(value, maxLen = 1200) {
  if (typeof value !== 'string') return '';
  const bounded = value.slice(0, Math.max(maxLen * 4, 4096));
  const stripped = bounded
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/<!--[\s\S]*?-->|<\/[a-zA-Z][a-zA-Z0-9:-]{0,30}\s*>|<[a-zA-Z][a-zA-Z0-9:-]{0,30}(?:\s+(?:[a-zA-Z_:][a-zA-Z0-9_.:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`]+)|disabled|checked|selected|readonly|required|multiple|hidden|open|async|defer|autofocus|controls|autoplay|loop|muted|novalidate|formnovalidate|nomodule|inert|default|reversed|ismap|data-[a-zA-Z0-9_-]+))*\s*\/?>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return '';
  const safe = stripped.replace(/https?:\/\/[^\s"'<>\\]+/gi, (m) => sanitizeUrlForLog(m));
  if (safe.length > maxLen && maxLen > 3) {
    return `${safe.slice(0, maxLen - 3).trimEnd()}...`;
  }
  return safe.slice(0, maxLen);
}

function sanitizeSidePanelState(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const rawItems = Array.isArray(raw.items) ? raw.items.slice(0, 50) : [];
  const items = [];
  for (let i = 0; i < rawItems.length; i++) {
    const entry = rawItems[i];
    if (!entry || typeof entry !== 'object') continue;
    const rawConf = typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
      ? Math.round(Math.max(0, Math.min(100, entry.confidence)))
      : 75;
    const tier = rawConf >= 80 ? 'high' : (rawConf >= 50 ? 'medium' : 'low');
    const rawStatus = typeof entry.crossValidationStatus === 'string'
      ? entry.crossValidationStatus.trim().toLowerCase()
      : '';
    const crossValidationStatus = ['confirmed', 'disputed', 'disagreed', 'unverified'].includes(rawStatus)
      ? rawStatus
      : (entry.crossValidated ? 'confirmed' : 'unverified');

    const options = Array.isArray(entry.options)
      ? entry.options
          .slice(0, 20)
          .map((opt) => sanitizeSidePanelPlainText(typeof opt === 'string' ? opt : (opt && opt.text) || '', 300))
      : [];

    const optionIndices = Array.isArray(entry.optionIndices)
      ? [...new Set(entry.optionIndices.slice(0, 20).filter((n) => Number.isInteger(n) && n >= 0))]
      : [];

    const textAnswer = typeof entry.textAnswer === 'string'
      ? sanitizeSidePanelPlainText(entry.textAnswer, 1000)
      : null;

    items.push({
      index: Number.isInteger(entry.index) && entry.index >= 0 ? entry.index : i,
      text: sanitizeSidePanelPlainText(entry.text || '', 1500),
      questionType: sanitizeSidePanelPlainText(String(entry.questionType || 'unknown'), 40) || 'unknown',
      options,
      optionIndices,
      textAnswer,
      answerSummary: sanitizeSidePanelPlainText(entry.answerSummary || '', 1000),
      confidence: rawConf,
      confidenceTier: tier,
      explanation: sanitizeSidePanelPlainText(entry.explanation || '', 500),
      crossValidated: Boolean(entry.crossValidated),
      crossValidationStatus,
      crossValidationNote: sanitizeSidePanelPlainText(entry.crossValidationNote || '', 300)
    });
  }

  const rawMeta = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
  const toCount = (n, fallback = 0) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback);

  return {
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0
      ? raw.updatedAt
      : Date.now(),
    tabId: Number.isInteger(raw.tabId) && raw.tabId > 0 ? raw.tabId : null,
    hostname: sanitizeSidePanelPlainText(String(raw.hostname || ''), 255),
    pageTitle: sanitizeSidePanelPlainText(String(raw.pageTitle || ''), 200),
    zeroTraceMode: Boolean(raw.zeroTraceMode),
    metadata: {
      provider: sanitizeSidePanelPlainText(String(rawMeta.provider || ''), 60),
      model: sanitizeSidePanelPlainText(String(rawMeta.model || ''), 120),
      questionsTotal: toCount(rawMeta.questionsTotal, items.length),
      answersFound: toCount(rawMeta.answersFound, items.length),
      totalDurationMs: toCount(rawMeta.totalDurationMs, 0)
    },
    items
  };
}

function broadcastExtensionRuntimeMessage(payload) {
  if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
    return;
  }
  try {
    chrome.runtime.sendMessage(payload, () => {
      void chrome.runtime?.lastError;
    });
  } catch (_) {
    /* ignore when no extension view is listening */
  }
}

async function clearSidePanelSessionStorageKey() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.session) {
    return;
  }
  try {
    if (typeof chrome.storage.session.remove === 'function') {
      await chrome.storage.session.remove([SIDE_PANEL_SESSION_KEY]);
    } else if (typeof chrome.storage.session.set === 'function') {
      await chrome.storage.session.set({ [SIDE_PANEL_SESSION_KEY]: null });
    }
  } catch (_) {
    /* ignore session storage errors */
  }
}

async function handleSaveSidePanelState(message = {}, sender = {}) {
  const raw = (message && message.state && typeof message.state === 'object') ? message.state : message;
  const candidate = (raw && typeof raw === 'object')
    ? { ...raw, tabId: raw.tabId ?? sender?.tab?.id ?? null }
    : null;
  const startedAt = candidate && typeof candidate.analysisStartedAt === 'number' && Number.isFinite(candidate.analysisStartedAt)
    ? candidate.analysisStartedAt
    : null;
  if (startedAt !== null && _lastGlobalClearAt > 0 && startedAt < _lastGlobalClearAt) {
    return { success: false, cancelled: true };
  }

  const state = sanitizeSidePanelState(candidate);
  if (!state) {
    return { success: false, error: 'État Side Panel invalide' };
  }

  const saveEpoch = ++_sidePanelStateEpoch;
  _sidePanelStateFallback = state;
  _hasAuthoritativeMemoryState = true;

  return runSerializedSaveOp(async () => {
    await awaitPendingClears();
    if (startedAt !== null && _lastGlobalClearAt > 0 && startedAt < _lastGlobalClearAt) {
      return { success: false, cancelled: true };
    }
    if (saveEpoch !== _sidePanelStateEpoch) {
      return { success: false, cancelled: true };
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session &&
        typeof chrome.storage.session.set === 'function') {
      try {
        await chrome.storage.session.set({ [SIDE_PANEL_SESSION_KEY]: state });
      } catch (_) {
        /* keep in-memory fallback */
      }
    }
    await awaitPendingClears();
    if (saveEpoch !== _sidePanelStateEpoch) {
      if (_sidePanelStateFallback === null) {
        await enqueueClearSessionStorage();
      }
      return { success: false, cancelled: true };
    }
    broadcastExtensionRuntimeMessage({ action: 'sidePanelStateUpdated', state });
    return { success: true, state };
  });
}

async function handleGetSidePanelState() {
  if (_hasAuthoritativeMemoryState) {
    return { success: true, state: _sidePanelStateFallback };
  }
  await awaitPendingClears();
  if (_hasAuthoritativeMemoryState) {
    return { success: true, state: _sidePanelStateFallback };
  }
  const readEpoch = _sidePanelStateEpoch;
  let state = _sidePanelStateFallback;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session &&
      typeof chrome.storage.session.get === 'function') {
    try {
      const data = await chrome.storage.session.get([SIDE_PANEL_SESSION_KEY]);
      if (_hasAuthoritativeMemoryState || readEpoch !== _sidePanelStateEpoch) {
        return { success: true, state: _sidePanelStateFallback };
      }
      if (data && Object.prototype.hasOwnProperty.call(data, SIDE_PANEL_SESSION_KEY)) {
        state = data[SIDE_PANEL_SESSION_KEY] ? sanitizeSidePanelState(data[SIDE_PANEL_SESSION_KEY]) : null;
        _sidePanelStateFallback = state;
      }
      _hasAuthoritativeMemoryState = true;
    } catch (_) {
      /* keep in-memory fallback */
    }
  } else {
    _hasAuthoritativeMemoryState = true;
  }
  return { success: true, state: _hasAuthoritativeMemoryState ? _sidePanelStateFallback : state };
}

async function handleClearSidePanelState(reason = 'clear', options = {}) {
  _panicClearEpoch += 1;
  _sidePanelStateEpoch += 1;
  _sidePanelStateFallback = null;
  _hasAuthoritativeMemoryState = true;
  _lastGlobalClearAt = Date.now();
  const safeReason = typeof reason === 'string' && reason.trim() ? reason.trim() : 'clear';
  const clearId = (options && typeof options === 'object' && typeof options.clearId === 'string' && options.clearId.trim())
    ? options.clearId.trim().slice(0, 80)
    : null;
  abortActiveSolveRequests();

  broadcastExtensionRuntimeMessage({
    action: 'sidePanelPanicClear',
    reason: safeReason,
    clearedAt: _lastGlobalClearAt,
    ...(clearId ? { clearId } : {})
  });

  await enqueueClearSessionStorage();
  return { success: true, cleared: true };
}

// ──────────────────────────────────────────────
// CORS Image Proxy & Runtime Messaging
// ──────────────────────────────────────────────

function sendAsyncRuntimeResponse(sendResponse, handler, formatError) {
  (async () => {
    try {
      const result = await handler();
      sendResponse(result);
    } catch (error) {
      sendResponse(formatError ? formatError(error) : { success: false, error: sanitizeErrorMessage(error) });
    }
  })();
  return true;
}

function handleRuntimeMessage(message, sender, sendResponse) {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.action === 'injectCoreScripts') {
    const tabId = sender?.tab?.id;
    if (tabId) {
      return sendAsyncRuntimeResponse(sendResponse, async () => {
        await injectCoreScripts(tabId);
        return { success: true };
      });
    }
    sendResponse({ success: false, error: 'tabId introuvable' });
    return true;
  }

  if (message.action === 'injectPageBridge') {
    return sendAsyncRuntimeResponse(
      sendResponse,
      () => handleInjectPageBridge(message, sender),
      error => ({ success: false, error: sanitizeErrorMessage(error) })
    );
  }

  if (message.action === 'preWarmProviders') {
    return sendAsyncRuntimeResponse(
      sendResponse,
      () => handlePreWarmProviders(message),
      error => ({ success: false, error: sanitizeErrorMessage(error) })
    );
  }

  if (message.action === 'getProviderStats') {
    return sendAsyncRuntimeResponse(
      sendResponse,
      () => handleGetProviderStats(),
      error => ({ success: false, error: sanitizeErrorMessage(error) })
    );
  }

  if (message.action === 'resetProviderStats') {
    return sendAsyncRuntimeResponse(
      sendResponse,
      () => handleResetProviderStats(),
      error => ({ success: false, error: sanitizeErrorMessage(error) })
    );
  }

  if (message.action === 'saveSidePanelState') {
    return sendAsyncRuntimeResponse(
      sendResponse,
      () => handleSaveSidePanelState(message, sender),
      error => ({ success: false, error: sanitizeErrorMessage(error) })
    );
  }

  if (message.action === 'getSidePanelState') {
    return sendAsyncRuntimeResponse(
      sendResponse,
      () => handleGetSidePanelState(),
      error => ({ success: false, error: sanitizeErrorMessage(error) })
    );
  }

  if (message.action === 'clearSidePanelState') {
    return sendAsyncRuntimeResponse(
      sendResponse,
      () => handleClearSidePanelState(message.reason || 'clear', { clearId: message.clearId }),
      error => ({ success: false, error: sanitizeErrorMessage(error) })
    );
  }

  if (message.action === 'fetchImage') {
    return sendAsyncRuntimeResponse(
      sendResponse,
      () => handleFetchImage(message.url),
      error => ({ success: false, error: sanitizeErrorMessage(error) })
    );
  }

  if (message.action === 'fetchLLM') {
    return sendAsyncRuntimeResponse(
      sendResponse,
      () => handleFetchLLM(message.url, message.options),
      error => ({
        success: false,
        networkError: true,
        error: sanitizeErrorMessage(error, { _extraRedactions: extractHeaderRedactions(message.options && message.options.headers) })
      })
    );
  }

  if (message.action === 'fetchSerpApi') {
    return sendAsyncRuntimeResponse(
      sendResponse,
      () => handleFetchSerpApi(message.query, message.apiKey),
      error => ({
        success: false,
        networkError: true,
        error: sanitizeErrorMessage(error, message.apiKey ? { serpApiKey: message.apiKey } : null)
      })
    );
  }

  // SEC-05 : Charger system.md depuis le SW (hors web_accessible_resources)
  if (message.action === 'loadSystemPrompt') {
    return sendAsyncRuntimeResponse(sendResponse, () => handleLoadSystemPrompt());
  }

  // Keep-alive pour empêcher le Service Worker d'être tué pendant de longs appels LLM
  if (message.action === 'keepAlive') {
    sendResponse({ success: true });
    return true;
  }

  // solveQuiz et analyzeDelta sont gérés via chrome.runtime.onConnect (port persistant)
  // pour éviter le "message port closed" sur les opérations longues.

  // Boucle de Feedback Post-Soumission (Agent 3.0)
  if (message.action === 'submitQuizFeedback') {
    return sendAsyncRuntimeResponse(sendResponse, async () => {
      const trustedConfig = await hydrateTrustedConfig(message.config);
      return BackgroundAgent.learnFromFeedback(message.feedbackData, trustedConfig);
    });
  }

  return false;
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
}

// ──────────────────────────────────────────────
// PORT-BASED MESSAGING pour les opérations longues (solveQuiz / analyzeDelta)
// Chrome maintient le Service Worker en vie tant qu'un port est ouvert.
// ──────────────────────────────────────────────
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'solveQuiz') return;

    const portControllers = new Set();
    let portDisconnected = false;
    if (port.onDisconnect && typeof port.onDisconnect.addListener === 'function') {
      port.onDisconnect.addListener(() => {
        portDisconnected = true;
        for (const ctrl of Array.from(portControllers)) {
          try {
            ctrl.abort();
          } catch (_) { /* ignore */ }
          _activeSolveAbortControllers.delete(ctrl);
        }
        portControllers.clear();
      });
    }

    port.onMessage.addListener(async (message) => {
      if (message && (message.action === 'solveQuiz' || message.action === 'analyzeDelta')) {
        const taskAbort = new AbortController();
        portControllers.add(taskAbort);
        _activeSolveAbortControllers.add(taskAbort);
        if (portDisconnected) {
          taskAbort.abort();
        }
        let safeConfig = (message.task && typeof message.task === 'object' && message.task.config && typeof message.task.config === 'object')
          ? message.task.config
          : null;
        try {
          const safeTask = (message.task && typeof message.task === 'object')
            ? { ...message.task, config: await hydrateTrustedConfig(message.task.config) }
            : message.task;
          if (safeTask && safeTask.config && typeof safeTask.config === 'object') {
            safeConfig = safeTask.config;
          }
          if (taskAbort.signal.aborted || portDisconnected) {
            return;
          }
          const result = await BackgroundAgent.solve(safeTask, { signal: taskAbort.signal });
          if (taskAbort.signal.aborted || portDisconnected) {
            return;
          }
          const outboundResult = (result && typeof result === 'object')
            ? {
                ...result,
                ...(typeof result.error === 'string' ? { error: sanitizeErrorMessage(result.error, safeConfig) } : {}),
                ...(Array.isArray(result.journal)
                  ? {
                      journal: result.journal.map((entry) => (
                        entry && typeof entry === 'object' && typeof entry.message === 'string'
                          ? { ...entry, message: sanitizeErrorMessage(entry.message, safeConfig) }
                          : entry
                      ))
                    }
                  : {})
              }
            : result;
          try { port.postMessage(outboundResult); } catch (_) { /* port fermé côté content */ }
        } catch (error) {
          if (taskAbort.signal.aborted || portDisconnected) {
            return;
          }
          try {
            port.postMessage({
              success: false,
              answers: [],
              metadata: { questionsTotal: 0, answersFound: 0, totalDurationMs: 0 },
              journal: [],
              error: sanitizeErrorMessage(error, safeConfig)
            });
          } catch (_) { /* port fermé côté content */ }
        } finally {
          portControllers.delete(taskAbort);
          _activeSolveAbortControllers.delete(taskAbort);
        }
      }
    });
  });
}

/**
 * Allowed LLM API hosts — prevents the proxy from being used as an open relay.
 */
const LLM_ALLOWED_HOSTS = (() => {
  const cat = typeof ProviderCatalog !== 'undefined'
    ? ProviderCatalog
    : (typeof globalThis !== 'undefined' ? globalThis.ProviderCatalog : null);
  if (cat && Array.isArray(cat.LLM_STATIC_ALLOWED_HOSTS)) {
    return [...cat.LLM_STATIC_ALLOWED_HOSTS];
  }
  return [
    'api.groq.com',
    'generativelanguage.googleapis.com',
    'integrate.api.nvidia.com',
    'api.mistral.ai',
    'codestral.mistral.ai',
    'api.anthropic.com'
  ];
})();

/**
 * SEC-01 : Masquer les credentials dans les URLs de log.
 * Remplace la valeur du paramètre 'key' par '***' pour éviter la fuite en logs.
 * Invariant : retourne toujours une string, jamais undefined.
 * @param {string} url
 * @returns {string}
 */
function sanitizeUrlForLog(url) {
  try {
    const u = new URL(url);
    if (u.username) u.username = '***';
    if (u.password) u.password = '***';
    if (u.hash) u.hash = '#***';
    // Masque toute valeur de paramètre ressemblant à un secret (key, token, signature, auth…).
    for (const name of [...u.searchParams.keys()]) {
      if (/key|token|sig|secret|auth|credential|passw/i.test(name)) {
        u.searchParams.set(name, '***');
      }
    }
    return u.toString();
  } catch {
    return '[invalid url]';
  }
}

/**
 * R-TECH-02 : Détecte si un hostname (issu de URL.hostname) pointe vers un hôte local/privé.
 * Gère IPv4 complets, IPv6 avec ou sans crochets, IPv6 IPv4-mapped (::ffff:...), et suffixes locaux.
 */
function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||                               // 0.0.0.0/8
    a === 10 ||                              // 10.0.0.0/8
    a === 127 ||                             // 127.0.0.0/8 (loopback)
    (a === 100 && b >= 64 && b <= 127) ||    // 100.64.0.0/10 (CGNAT)
    (a === 169 && b === 254) ||              // 169.254.0.0/16 (link-local / metadata)
    (a === 172 && b >= 16 && b <= 31) ||     // 172.16.0.0/12
    (a === 192 && b === 168) ||              // 192.168.0.0/16
    a >= 224                                 // multicast & réservé
  );
}

function isBlockedImageHost(rawHostname) {
  if (typeof rawHostname !== 'string' || !rawHostname) return true;
  const h = rawHostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!h) return true;

  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }

  // IPv6
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true;
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // fe80::/10 link-local
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;  // fc00::/7 ULA
    if (/^ff[0-9a-f]{2}:/.test(h)) return true;     // ff00::/8 multicast
    // ::ffff:7f00:1 (forme normalisée WHATWG URL) ou ::ffff:127.0.0.1
    const mappedHex = h.match(/^(?:0+:){0,5}::?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) || h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      const ipv4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
      return isPrivateIpv4(ipv4);
    }
    const mappedDotted = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedDotted) return isPrivateIpv4(mappedDotted[1]);
    // Forme longue tout-zéro (0:0:0:0:0:0:0:0 ou ...:1)
    if (/^(0+:){7}0*[01]$/.test(h)) return true;
    return false;
  }

  // IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    return isPrivateIpv4(h);
  }

  // Hôte sans point (ex: "metadata", "redis") : intranet uniquement
  if (!h.includes('.')) return true;

  return false;
}

function sniffRasterImageMime(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Proxy LLM API requests to bypass CORS restrictions on host pages
 */
async function handleFetchLLM(url, options) {
  try {
    // S5 — Validate URL against static allowlist + storage-backed providerConfigs (Anti-SSRF)
    const parsedUrl = new URL(url);
    const providerConfigs = await getStoredProviderConfigs();
    if (!isAllowedLLMUrl(parsedUrl, providerConfigs)) {
      console.warn(`⛔ URL bloquée par le proxy LLM: ${parsedUrl.hostname} (${sanitizeUrlForLog(url)})`);
      return { success: false, networkError: true, error: 'URL non autorisée pour le proxy LLM' };
    }

    // Timeout de 120s pour éviter les requêtes infinies (ex: NVIDIA Kimi Thinking)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
      const fetchInit = {
        method: (options && typeof options.method === 'string') ? options.method : 'GET',
        signal: controller.signal,
        redirect: 'error'
      };
      if (options && options.headers && typeof options.headers === 'object') {
        fetchInit.headers = options.headers;
      }
      if (options && options.body !== undefined) {
        fetchInit.body = options.body;
      }

      const response = await fetch(url, fetchInit);
      clearTimeout(timeoutId);
      const text = await response.text();
      
      let data;
      try {
        data = JSON.parse(text);
      } catch(e) {
        data = { text }; 
      }
      
      return {
        success: true,
        ok: response.ok,
        status: response.status,
        data: data
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        console.error("⏱️ fetchLLM timeout (120s dépassées)");
        return { success: false, networkError: true, error: 'Timeout: le serveur n\'a pas répondu en 120 secondes' };
      }
      throw fetchError;
    }
  } catch (error) {
    const safeError = sanitizeErrorMessage(error, {
      _extraRedactions: extractHeaderRedactions(options && options.headers)
    });
    console.error("❌ fetchLLM network error:", safeError);
    return { success: false, networkError: true, error: safeError };
  }
}

function isLoopbackHostname(rawHostname) {
  if (typeof rawHostname !== 'string' || !rawHostname) return false;
  const h = rawHostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

async function getStoredProviderConfigs() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local || typeof chrome.storage.local.get !== 'function') {
    return {};
  }
  try {
    const stored = await Promise.resolve(chrome.storage.local.get(['providerConfigs']));
    return (stored && stored.providerConfigs && typeof stored.providerConfigs === 'object')
      ? stored.providerConfigs
      : {};
  } catch (_) {
    return {};
  }
}

async function hydrateTrustedConfig(rawConfig) {
  const trustedProviderConfigs = await getStoredProviderConfigs();
  const base = (rawConfig && typeof rawConfig === 'object') ? { ...rawConfig } : {};
  const hasSyncObj = Boolean(base.syncConfig && typeof base.syncConfig === 'object');
  const hasApiKeysObj = Boolean(base.apiKeys && typeof base.apiKeys === 'object');
  delete base.providerConfigs;
  if (hasSyncObj || hasApiKeysObj) {
    base.syncConfig = { ...(hasSyncObj ? base.syncConfig : {}), providerConfigs: trustedProviderConfigs };
    base.apiKeys = { ...(hasApiKeysObj ? base.apiKeys : {}), providerConfigs: trustedProviderConfigs };
  } else {
    base.providerConfigs = trustedProviderConfigs;
  }
  return base;
}

function isAllowedLLMUrl(parsedUrl, providerConfigs = {}) {
  if (!parsedUrl || typeof parsedUrl !== 'object') return false;
  if (parsedUrl.username || parsedUrl.password) return false;
  const protocol = typeof parsedUrl.protocol === 'string' ? parsedUrl.protocol.toLowerCase() : '';
  if (protocol !== 'https:' && protocol !== 'http:') return false;

  const rawHost = typeof parsedUrl.hostname === 'string' ? parsedUrl.hostname : '';
  const hostname = rawHost.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!hostname) return false;

  const port = typeof parsedUrl.port === 'string' ? parsedUrl.port : '';
  const BEDROCK_MANTLE_RE = /^bedrock-mantle\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.api\.aws$/;
  const AZURE_OPENAI_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.openai\.azure\.com$/;

  if (protocol === 'https:' && (!port || port === '443') && (
    LLM_ALLOWED_HOSTS.includes(hostname) ||
    BEDROCK_MANTLE_RE.test(hostname) ||
    AZURE_OPENAI_RE.test(hostname)
  )) {
    return true;
  }

  if (!providerConfigs || typeof providerConfigs !== 'object') {
    return false;
  }

  const qp = typeof QuizProviders !== 'undefined'
    ? QuizProviders
    : (typeof globalThis !== 'undefined' ? globalThis.QuizProviders : null);
  const cat = typeof ProviderCatalog !== 'undefined'
    ? ProviderCatalog
    : (typeof globalThis !== 'undefined' ? globalThis.ProviderCatalog : null);
  const providersMap = (qp && qp.PROVIDERS) || (cat && cat.EXTRA_PROVIDERS) || {};

  for (const pKey of Object.keys(providerConfigs)) {
    if (!Object.prototype.hasOwnProperty.call(providerConfigs, pKey)) continue;
    const normKey = String(pKey || '').trim().toLowerCase();
    if (!normKey || !Object.prototype.hasOwnProperty.call(providersMap, normKey)) continue;

    const provider = providersMap[normKey];
    const cfg = providerConfigs[pKey];
    if (!provider || !cfg || typeof cfg !== 'object') continue;

    if (provider.local === true) {
      if (cfg.enabled !== true) continue;
      const candidateRaw = (typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim())
        ? cfg.baseUrl.trim()
        : (provider.baseUrl || '');
      if (!candidateRaw) continue;
      let cfgUrl;
      try {
        cfgUrl = new URL(candidateRaw);
      } catch (_) {
        continue;
      }
      if (cfgUrl.username || cfgUrl.password) continue;
      const cfgProto = cfgUrl.protocol.toLowerCase();
      if ((cfgProto === 'http:' || cfgProto === 'https:') &&
          isLoopbackHostname(cfgUrl.hostname) &&
          cfgUrl.origin === parsedUrl.origin) {
        return true;
      }
      continue;
    }

    const customRaw = typeof cfg.baseUrl === 'string' ? cfg.baseUrl.trim() : '';
    if (!customRaw) continue;
    if (!provider.supportsCustomBaseUrl && !provider.requiresBaseUrl) continue;

    let cfgUrl;
    try {
      cfgUrl = new URL(customRaw);
    } catch (_) {
      continue;
    }
    if (cfgUrl.username || cfgUrl.password) continue;
    const cfgProto = cfgUrl.protocol.toLowerCase();
    if (provider.allowsLoopbackBaseUrl === true && isLoopbackHostname(cfgUrl.hostname)) {
      if ((cfgProto === 'http:' || cfgProto === 'https:') && cfgUrl.origin === parsedUrl.origin) {
        return true;
      }
      continue;
    }

    if (cfgProto === 'https:' &&
        protocol === 'https:' &&
        !isBlockedImageHost(cfgUrl.hostname) &&
        !isBlockedImageHost(parsedUrl.hostname) &&
        cfgUrl.origin === parsedUrl.origin) {
      return true;
    }
  }

  return false;
}

async function handleFetchSerpApi(query, apiKey) {
  // Règle 8.5 : assertions de préconditions
  if (typeof query !== 'string' || typeof apiKey !== 'string') {
    throw new Error('handleFetchSerpApi: arguments invalides.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${apiKey}&engine=google_ai_mode`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return {
      success: true,
      data: data
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const safeError = sanitizeErrorMessage(error, { serpApiKey: apiKey });
    console.error("❌ fetchSerpApi network error:", safeError);
    if (error.name === 'AbortError') {
      return { success: false, networkError: true, error: 'Timeout: SerpAPI n\'a pas répondu en 30 secondes' };
    }
    return { success: false, networkError: true, error: safeError };
  }
}

/**
 * Fetch an image URL from the background script (no CORS restrictions)
 * and return it as a base64 data URL.
 * Includes Anti-SSRF validation to block private IPs and non-http(s) protocols.
 */
async function handleFetchImage(url) {
  if (typeof url !== 'string' || !url.trim()) {
    return { success: false, error: 'URL d\'image invalide' };
  }

  try {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol.toLowerCase();

    // R-TECH-02 : Validation Anti-SSRF du protocole
    if (protocol !== 'http:' && protocol !== 'https:') {
      console.warn(`🛡️ Anti-SSRF: Protocole non autorisé ${protocol}`);
      return { success: false, error: 'Protocole réseau non autorisé pour les images' };
    }

    // R-TECH-02 : Validation de l'hôte (IPv4/IPv6 privées, loopback, link-local, metadata, suffixes locaux)
    const isPrivateHost = isBlockedImageHost(parsedUrl.hostname);

    if (isPrivateHost) {
      console.warn(`🛡️ Anti-SSRF: Tentative d'accès à un hôte privé bloquée (${parsedUrl.hostname.toLowerCase()})`);
      return { success: false, error: 'Accès aux ressources réseau locales/privées interdit' };
    }

    console.log(`🖼️ Proxy fetch sécurisé: ${sanitizeUrlForLog(url).substring(0, 80)}...`);

    // Interdit les redirections 3xx (un redirect externe vers 169.254.169.254 / localhost contournerait le filtre).
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();

    const uint8Array = new Uint8Array(arrayBuffer);
    let mimeType = (blob.type || '').split(';')[0].trim().toLowerCase();

    // R-TECH-02 : Vérifier que la ressource téléchargée est bien une image (magic bytes requis si MIME absent/générique)
    if (!mimeType || mimeType === 'application/octet-stream') {
      const sniffed = sniffRasterImageMime(uint8Array);
      if (!sniffed) {
        console.warn(`🛡️ Anti-SSRF: Type MIME absent ou générique sans signature d'image (${mimeType || 'empty'})`);
        return { success: false, error: 'Le type de fichier récupéré n\'est pas une image' };
      }
      mimeType = sniffed;
    } else if (!mimeType.startsWith('image/')) {
      console.warn(`🛡️ Anti-SSRF: Type MIME non image rejeté (${mimeType})`);
      return { success: false, error: 'Le type de fichier récupéré n\'est pas une image' };
    }

    // Convert blob to base64
    let binary = '';
    const CHUNK_SIZE = 8192;
    for (let i = 0; i < uint8Array.length; i += CHUNK_SIZE) {
      const chunk = uint8Array.subarray(i, Math.min(i + CHUNK_SIZE, uint8Array.length));
      binary += String.fromCharCode.apply(null, chunk);
    }
    const base64 = btoa(binary);
    const dataUrl = `data:${mimeType};base64,${base64}`;

    // Try to get image dimensions
    let width = 0, height = 0;
    try {
      const imageBitmap = await createImageBitmap(blob);
      width = imageBitmap.width;
      height = imageBitmap.height;
      imageBitmap.close();
    } catch (e) {
      // Can't get dimensions in service worker, that's OK
    }

    console.log(`✅ Image proxy: ${mimeType}, ${(base64.length / 1024).toFixed(1)}KB`);

    return {
      success: true,
      dataUrl,
      mimeType,
      width,
      height
    };
  } catch (error) {
    const safeErrMsg = sanitizeErrorMessage(error);
    console.error('❌ Image proxy failed:', safeErrMsg);
    return { success: false, error: safeErrMsg };
  }
}

// ──────────────────────────────────────────────
// Notifications
// ──────────────────────────────────────────────

function showNotification(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'Safe Exm',
    message: message
  });
}

// ──────────────────────────────────────────────
// Installation
// ──────────────────────────────────────────────

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(async (details) => {
    // S1 — Migrate API keys from sync to local storage (security)
    const API_KEY_FIELDS = getLocalConfigKeys().filter(
      (k) => k !== 'contextFiles' && k !== 'providerConfigs' && k !== 'serpApiKey'
    );

    try {
      const syncData = await chrome.storage.sync.get(API_KEY_FIELDS);
      const keysToMigrate = {};
      let hasKeys = false;

      for (const field of API_KEY_FIELDS) {
        if (syncData[field] && syncData[field].trim().length > 0) {
          keysToMigrate[field] = syncData[field];
          hasKeys = true;
        }
      }

      if (hasKeys) {
        await chrome.storage.local.set(keysToMigrate);
        await chrome.storage.sync.remove(API_KEY_FIELDS);
        console.log('🔄 Clés API migrées de sync vers local storage');
      }
    } catch (e) {
      console.error('Erreur migration clés API:', e);
    }

    // Initialisation de la mémoire de l'Agent 3.0
    try {
      const memData = await chrome.storage.local.get(['agentMemory']);
      if (!memData.agentMemory) {
        await chrome.storage.local.set({ agentMemory: [] });
      }
    } catch (e) {
      console.error('Erreur init agentMemory:', e);
    }

    if (details.reason === 'install') {
      chrome.tabs.create({ url: 'settings.html' });
    }

    // ──────────────────────────────────────────────
    // Context Menus
    // ──────────────────────────────────────────────
    try {
      if (chrome.contextMenus && typeof chrome.contextMenus.removeAll === 'function') {
        await new Promise((resolve) => {
          chrome.contextMenus.removeAll(() => {
            void chrome.runtime?.lastError;
            resolve();
          });
        });
      }

      // Parent root menu
      chrome.contextMenus.create({
        id: "safe-exm-root",
        title: "Safe Exm",
        contexts: ["all"]
      });

      // Child menus
      chrome.contextMenus.create({
        id: "cm-analyze-quiz",
        parentId: "safe-exm-root",
        title: "Analyser le quiz",
        contexts: ["all"]
      });

      chrome.contextMenus.create({
        id: "cm-toggle-extension",
        parentId: "safe-exm-root",
        title: "Activer / couper l'extension",
        contexts: ["all"]
      });

      chrome.contextMenus.create({
        id: "cm-toggle-auto-mode",
        parentId: "safe-exm-root",
        title: "Activer / couper le mode auto",
        contexts: ["all"]
      });

      chrome.contextMenus.create({
        id: "cm-clear-highlights",
        parentId: "safe-exm-root",
        title: "Effacer les marques",
        contexts: ["all"]
      });

      chrome.contextMenus.create({
        id: "cm-paste-answer",
        parentId: "safe-exm-root",
        title: "Coller la réponse",
        contexts: ["all"]
      });

      chrome.contextMenus.create({
        id: "cm-open-side-panel",
        parentId: "safe-exm-root",
        title: "Ouvrir le panneau latéral",
        contexts: ["all"]
      });
    } catch (e) {
      console.error("Context Menu Creation Error:", e);
    }
  });
}

// ──────────────────────────────────────────────
// Context Menus Handler
// ──────────────────────────────────────────────
if (typeof chrome !== 'undefined' && chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab) return;

    switch (info.menuItemId) {
      case 'cm-toggle-extension':
        await toggleExtension();
        break;

      case 'cm-analyze-quiz':
        await analyzeCurrentQuiz(tab);
        break;

      case 'cm-toggle-auto-mode':
        await toggleAutoMode();
        break;

      case 'cm-clear-highlights': {
        const [, clearOk] = await Promise.all([
          handleClearSidePanelState('panic'),
          notifyHttpTabs({ action: 'clearHighlights', skipSidePanelClear: true }, typeof tab.id === 'number' ? tab.id : null)
        ]);
        showNotification(clearOk ? 'Marques effacées' : 'Marques et panneau effacés.');
        break;
      }

      case 'cm-paste-answer':
        try {
          const resp = await chrome.tabs.sendMessage(tab.id, { action: 'pasteAnswer' });
          if (resp && resp.success === false) {
            showNotification(resp.error || 'Aucune réponse texte disponible à coller.');
          } else {
            showNotification('Réponse collée');
          }
        } catch (e) {
          showNotification('Impossible de coller la réponse sur cette page.');
        }
        break;

      case 'cm-open-side-panel': {
        if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
          const openTarget = typeof tab.windowId === 'number'
            ? { windowId: tab.windowId }
            : (typeof tab.id === 'number' ? { tabId: tab.id } : null);
          if (openTarget) {
            try {
              // Appel synchrone avant tout await pour préserver le geste utilisateur MV3
              const openPromise = chrome.sidePanel.open(openTarget);
              await openPromise;
              showNotification('Panneau latéral ouvert');
            } catch (e) {
              showNotification('Impossible d\'ouvrir le panneau latéral.');
            }
          }
        } else {
          showNotification('Panneau latéral indisponible sur ce navigateur.');
        }
        break;
      }
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    handleLoadSystemPrompt,
    handleAnalyzeQuizCommand,
    handlePreWarmProviders,
    handleGetProviderStats,
    handleResetProviderStats,
    handleSaveSidePanelState,
    handleGetSidePanelState,
    handleClearSidePanelState,
    sanitizeSidePanelState,
    handleInjectPageBridge,
    handleRuntimeMessage,
    handleFetchLLM,
    handleFetchSerpApi,
    handleFetchImage,
    injectCoreScripts,
    sanitizeUrlForLog,
    sanitizeErrorMessage,
    isPrivateIpv4,
    isBlockedImageHost,
    isLoopbackHostname,
    isAllowedLLMUrl,
    LLM_ALLOWED_HOSTS,
    sniffRasterImageMime,
    handleTabRemoved,
    _injectionsInProgress,
    _bridgeInjectionsInProgress
  };
}