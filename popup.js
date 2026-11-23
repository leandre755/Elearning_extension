// popup.js — Safe Exm Popup Controller & Provider Performance Analytics (F-ANA-03)
/* global Number, Boolean, Array */

let state = {
  enabled: false,
  captureImages: true,
  autoMode: false,
  selectedProvider: 'auto',
  thinkingMode: false
};

// Éléments DOM
const elements = {
  extensionToggle: typeof document !== 'undefined' ? document.getElementById('extensionToggle') : null,
  autoModeToggle: typeof document !== 'undefined' ? document.getElementById('autoModeToggle') : null,
  connectionStatus: typeof document !== 'undefined' ? document.getElementById('connectionStatus') : null,
  statusDot: typeof document !== 'undefined' ? document.getElementById('statusDot') : null,
  analyzeBtn: typeof document !== 'undefined' ? document.getElementById('analyzeBtn') : null,
  clearBtn: typeof document !== 'undefined' ? document.getElementById('clearBtn') : null,
  schemaStatus: typeof document !== 'undefined' ? document.getElementById('schemaStatus') : null,
  schemaIcon: typeof document !== 'undefined' ? document.getElementById('schemaIcon') : null,
  schemaText: typeof document !== 'undefined' ? document.getElementById('schemaText') : null,
  schemaRediscoverBtn: typeof document !== 'undefined' ? document.getElementById('schemaRediscoverBtn') : null,

  // Elements de progression
  progressSection: typeof document !== 'undefined' ? document.getElementById('progressSection') : null,
  progressBarFill: typeof document !== 'undefined' ? document.getElementById('progressBarFill') : null,
  progressText: typeof document !== 'undefined' ? document.getElementById('progressText') : null,
  progressPercentage: typeof document !== 'undefined' ? document.getElementById('progressPercentage') : null,

  // Elements Analytics (F-ANA-03)
  providerStatsSection: typeof document !== 'undefined' ? document.getElementById('providerStatsSection') : null,
  providerStatsList: typeof document !== 'undefined' ? document.getElementById('providerStatsList') : null,
  providerStatsEmpty: typeof document !== 'undefined' ? document.getElementById('providerStatsEmpty') : null,
  resetStatsBtn: typeof document !== 'undefined' ? document.getElementById('resetStatsBtn') : null,
  themeToggleBtn: typeof document !== 'undefined' ? document.getElementById('themeToggleBtn') : null,
  popupAnnouncer: typeof document !== 'undefined' ? document.getElementById('popupAnnouncer') : null
};

const PROVIDER_DISPLAY_NAMES = Object.freeze({
  groq: 'Groq',
  gemini: 'Gemini',
  nvidia: 'NVIDIA NIM',
  mistral: 'Mistral',
  claude: 'Claude'
});

const PROVIDER_ESTIMATED_COST_PER_REQ = Object.freeze({
  groq: 0,
  gemini: 0,
  nvidia: 0,
  mistral: 0.0004,
  claude: 0.0015
});

function getThemeManager() {
  return (typeof window !== 'undefined' && window.SafeExmTheme) ? window.SafeExmTheme : null;
}

function syncThemeToggleButton(stateInfo) {
  const tm = getThemeManager();
  if (tm && typeof tm.syncThemeButtonLabel === 'function' && elements.themeToggleBtn) {
    tm.syncThemeButtonLabel(elements.themeToggleBtn, stateInfo);
  }
}

function applyTheme(theme) {
  const tm = getThemeManager();
  if (tm && typeof tm.applyThemeOverride === 'function') {
    const nextState = tm.applyThemeOverride(theme === 'dark' || theme === 'light' ? theme : null);
    syncThemeToggleButton(nextState);
    return;
  }
  if (typeof document === 'undefined' || !document.documentElement) return;
  const resolved = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', resolved);
}

async function initTheme() {
  const tm = getThemeManager();
  if (tm && typeof tm.initThemeFromStorage === 'function') {
    await tm.initThemeFromStorage((nextState) => syncThemeToggleButton(nextState));
    return;
  }
  let theme = 'light';
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const data = await chrome.storage.local.get(['uiTheme']);
      if (data && (data.uiTheme === 'dark' || data.uiTheme === 'light')) {
        theme = data.uiTheme;
      } else if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        theme = 'dark';
      }
    } catch { /* keep default */ }
  }
  applyTheme(theme);
}

// Initialisation
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', async () => {
    await initTheme();
    await loadSettings();
    setupEventListeners();
    checkApiConnection();
    checkSchemaStatus();
    await loadProviderStats();
  });
}

// Charger les paramètres depuis le stockage
async function loadSettings() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) return;
  const result = await chrome.storage.sync.get(['enabled', 'captureImages', 'selectedProvider', 'thinkingMode', 'autoMode']);

  state.enabled = result.enabled || false;
  state.captureImages = result.captureImages !== false;
  state.selectedProvider = result.selectedProvider || 'auto';
  state.thinkingMode = result.thinkingMode || false;
  state.autoMode = result.autoMode || false;

  // Mettre à jour l'UI
  if (elements.extensionToggle) elements.extensionToggle.checked = state.enabled;
  if (elements.autoModeToggle) elements.autoModeToggle.checked = state.autoMode;
}

// Configurer les écouteurs d'événements
function setupEventListeners() {
  // Toggle extension active
  if (elements.extensionToggle) {
    elements.extensionToggle.addEventListener('change', async (e) => {
      state.enabled = e.target.checked;
      await saveSettings();
      notifyContentScript({ action: 'toggleExtension', enabled: state.enabled });
    });
  }

  // Toggle auto mode
  if (elements.autoModeToggle) {
    elements.autoModeToggle.addEventListener('change', async (e) => {
      state.autoMode = e.target.checked;
      await saveSettings();
    });
  }

  // Bouton Analyser
  if (elements.analyzeBtn) {
    elements.analyzeBtn.addEventListener('click', analyzeQuiz);
  }

  // Bouton Effacer
  if (elements.clearBtn) {
    elements.clearBtn.addEventListener('click', clearHighlights);
  }

  // Bouton Re-découvrir schéma
  if (elements.schemaRediscoverBtn) {
    elements.schemaRediscoverBtn.addEventListener('click', rediscoverSchema);
  }

  // Bouton Reset Stats (F-ANA-03)
  const resetBtn = elements.resetStatsBtn || (typeof document !== 'undefined' ? document.getElementById('resetStatsBtn') : null);
  if (resetBtn) {
    resetBtn.addEventListener('click', async (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      await resetProviderStats();
    });
  }

  // Bascule thème Papier / Ardoise (avec retour au thème système)
  if (elements.themeToggleBtn) {
    elements.themeToggleBtn.addEventListener('click', async () => {
      const tm = getThemeManager();
      if (tm && typeof tm.toggleTheme === 'function') {
        await tm.toggleTheme((nextState) => syncThemeToggleButton(nextState));
        return;
      }
      const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ uiTheme: next });
      }
    });
  }

  // Écouter les messages de progression depuis content.js
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.action === 'analysisProgress') {
        showProgress(message.step, message.percent);
      }
    });
  }
}

async function saveSettings() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) return;
  await chrome.storage.sync.set({
    enabled: state.enabled,
    captureImages: state.captureImages,
    selectedProvider: state.selectedProvider,
    thinkingMode: state.thinkingMode,
    autoMode: state.autoMode
  });
}

let _progressHideTimer = null;

function clearProgressHideTimer() {
  if (_progressHideTimer !== null) {
    clearTimeout(_progressHideTimer);
    _progressHideTimer = null;
  }
}

function setElementVisibility(el, visible, displayWhenVisible = '') {
  if (!el) return;
  el.hidden = !visible;
  if (el.style) {
    el.style.display = visible ? displayWhenVisible : 'none';
  }
}

function announcePopupStatus(message) {
  if (elements.popupAnnouncer) {
    elements.popupAnnouncer.textContent = String(message || '');
  }
}

function isNativeProgressElement(el) {
  return Boolean(el && typeof el.tagName === 'string' && el.tagName.toUpperCase() === 'PROGRESS');
}

// Afficher la progression dans la barre
function showProgress(stepMessage, percent) {
  clearProgressHideTimer();
  if (!elements.progressSection) return;
  const clampedPercent = Math.max(0, Math.min(100, Number(percent) || 0));

  // Réinitialiser les couleurs d'erreur s'il y en avait
  if (elements.progressText) {
    if (elements.progressText.style) elements.progressText.style.color = '';
    if (elements.progressText.classList && typeof elements.progressText.classList.remove === 'function') {
      elements.progressText.classList.remove('is-error');
    }
    elements.progressText.textContent = stepMessage;
  }

  if (elements.progressBarFill) {
    if (elements.progressBarFill.classList && typeof elements.progressBarFill.classList.remove === 'function') {
      elements.progressBarFill.classList.remove('is-error');
    }
    if (isNativeProgressElement(elements.progressBarFill)) {
      elements.progressBarFill.value = clampedPercent;
    } else if (elements.progressBarFill.style) {
      elements.progressBarFill.style.background = '';
      elements.progressBarFill.style.width = `${clampedPercent}%`;
    }
  }

  setElementVisibility(elements.progressSection, true, 'flex');
  if (elements.progressPercentage) {
    elements.progressPercentage.textContent = `${clampedPercent}%`;
  }
}

// Vérifier la connexion API (combien de fournisseurs configurés)
async function checkApiConnection() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  const qp = (typeof window !== 'undefined' && window.QuizProviders)
    ? window.QuizProviders
    : (typeof QuizProviders !== 'undefined' ? QuizProviders : null);
  const storageKeys = (qp && typeof qp.getAllStorageKeys === 'function')
    ? qp.getAllStorageKeys()
    : ['groqApiKey', 'geminiApiKey', 'nvidiaApiKey', 'mistralApiKey', 'claudeApiKey', 'providerConfigs'];
  const stored = await chrome.storage.local.get(storageKeys);

  let configuredProviders = 0;
  if (qp && qp.PROVIDERS && typeof qp.isProviderConfigured === 'function') {
    for (const pKey of Object.keys(qp.PROVIDERS)) {
      if (qp.isProviderConfigured(pKey, stored)) {
        configuredProviders++;
      }
    }
  } else {
    for (const key in stored) {
      if (key === 'providerConfigs') continue;
      if (typeof stored[key] === 'string' && stored[key].trim().length > 0) {
        configuredProviders++;
      }
    }
  }

  if (configuredProviders > 0) {
    if (elements.statusDot) elements.statusDot.classList.add('connected');
    if (elements.connectionStatus) {
      elements.connectionStatus.textContent = `${configuredProviders} clé${configuredProviders > 1 ? 's' : ''}`;
    }
  } else {
    if (elements.statusDot) elements.statusDot.classList.remove('connected');
    if (elements.connectionStatus) {
      elements.connectionStatus.textContent = 'Aucune clé';
    }
  }
}

// ──────────────────────────────────────────────
// F-ANA-03 : PROVIDER PERFORMANCE ANALYTICS
// ──────────────────────────────────────────────

function normalizeProviderMetrics(providerKey, rawBucket) {
  const b = rawBucket && typeof rawBucket === 'object' ? rawBucket : {};
  const requests = (typeof b.requests === 'number' && Number.isFinite(b.requests) && b.requests >= 0)
    ? Math.round(b.requests)
    : 0;

  let successRate = 0;
  if (typeof b.successRate === 'number' && Number.isFinite(b.successRate)) {
    if (b.successRate > 0 && b.successRate <= 1 && !Number.isInteger(b.successRate) && b.successes === undefined) {
      successRate = Math.round(b.successRate * 100);
    } else {
      successRate = Math.max(0, Math.min(100, Math.round(b.successRate)));
    }
  } else if (requests > 0 && typeof b.successes === 'number' && Number.isFinite(b.successes)) {
    successRate = Math.max(0, Math.min(100, Math.round((b.successes / requests) * 100)));
  } else if (requests > 0 && typeof b.failures === 'number' && Number.isFinite(b.failures)) {
    successRate = Math.max(0, Math.min(100, Math.round(((requests - b.failures) / requests) * 100)));
  }

  let avgLatencyMs = 0;
  if (typeof b.avgLatencyMs === 'number' && Number.isFinite(b.avgLatencyMs) && b.avgLatencyMs >= 0) {
    avgLatencyMs = Math.round(b.avgLatencyMs);
  } else if (requests > 0 && typeof b.totalLatencyMs === 'number' && Number.isFinite(b.totalLatencyMs) && b.totalLatencyMs >= 0) {
    avgLatencyMs = Math.round(b.totalLatencyMs / requests);
  }

  let estimatedCostUsd = 0;
  if (typeof b.estimatedCostUsd === 'number' && Number.isFinite(b.estimatedCostUsd) && b.estimatedCostUsd >= 0) {
    estimatedCostUsd = b.estimatedCostUsd;
  } else {
    const keyLower = String(providerKey || '').trim().toLowerCase();
    const unitCost = Object.prototype.hasOwnProperty.call(PROVIDER_ESTIMATED_COST_PER_REQ, keyLower)
      ? PROVIDER_ESTIMATED_COST_PER_REQ[keyLower]
      : 0;
    estimatedCostUsd = Number((requests * unitCost).toFixed(4));
  }

  const normalizedKey = String(providerKey || '').toLowerCase();
  const qp = (typeof window !== 'undefined' && window.QuizProviders)
    ? window.QuizProviders
    : (typeof QuizProviders !== 'undefined' ? QuizProviders : null);
  const registryName = (qp && qp.PROVIDERS && Object.prototype.hasOwnProperty.call(qp.PROVIDERS, normalizedKey))
    ? qp.PROVIDERS[normalizedKey]?.name
    : null;

  return {
    provider: providerKey,
    displayName: PROVIDER_DISPLAY_NAMES[normalizedKey] || registryName || String(providerKey || 'unknown'),
    requests,
    successRate,
    avgLatencyMs,
    estimatedCostUsd
  };
}

function clearElementChildren(container) {
  if (!container) return;
  if (typeof container.replaceChildren === 'function') {
    container.replaceChildren();
    return;
  }
  while (container.firstChild) {
    if (typeof container.removeChild === 'function') {
      container.removeChild(container.firstChild);
    } else {
      break;
    }
  }
  if (Array.isArray(container.children)) {
    container.children.length = 0;
  }
  if (Array.isArray(container.childNodes)) {
    container.childNodes.length = 0;
  }
}

/**
 * Affiche les statistiques de performance par provider dans le popup (F-ANA-03)
 * en utilisant exclusivement document.createElement + textContent (zéro innerHTML).
 */
function renderProviderStats(rawStats, targetContainer = null) {
  const container = targetContainer ||
    elements.providerStatsList ||
    (typeof document !== 'undefined' && typeof document.getElementById === 'function'
      ? document.getElementById('providerStatsList')
      : null);

  if (!container || typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return [];
  }

  clearElementChildren(container);

  const providersObj = (rawStats && typeof rawStats === 'object')
    ? (rawStats.providers && typeof rawStats.providers === 'object' ? rawStats.providers : rawStats)
    : {};

  const ignoredTopKeys = new Set(['totals', 'lastUpdatedAt', 'success', 'error']);
  const rows = [];

  for (const key of Object.keys(providersObj)) {
    if (ignoredTopKeys.has(key) || !Object.prototype.hasOwnProperty.call(providersObj, key)) {
      continue;
    }
    const bucket = providersObj[key];
    if (!bucket || typeof bucket !== 'object') continue;
    const normalized = normalizeProviderMetrics(key, bucket);
    if (normalized.requests <= 0 && bucket.requests === undefined && bucket.successRate === undefined && bucket.avgLatencyMs === undefined) {
      continue;
    }
    rows.push(normalized);
  }

  if (rows.length === 0) {
    const emptyEl = document.createElement('p');
    emptyEl.className = 'stats-empty';
    emptyEl.id = 'providerStatsEmpty';
    emptyEl.textContent = 'Aucune requête pour l\'instant';
    container.appendChild(emptyEl);
    return [];
  }

  rows.forEach((metric) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'stats-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'stats-provider-name';
    nameEl.textContent = metric.displayName;

    const metricsGroupEl = document.createElement('span');
    metricsGroupEl.className = 'stats-metrics';

    const reqEl = document.createElement('span');
    reqEl.className = 'stats-req';
    reqEl.textContent = `${metric.requests} req`;

    const rateEl = document.createElement('span');
    rateEl.className = 'stats-rate';
    rateEl.textContent = `${metric.successRate}%`;

    const latencyEl = document.createElement('span');
    latencyEl.className = 'stats-latency';
    latencyEl.textContent = `${metric.avgLatencyMs}ms`;

    const costEl = document.createElement('span');
    costEl.className = 'stats-cost';
    const costStr = metric.estimatedCostUsd === 0
      ? '$0.00'
      : `$${metric.estimatedCostUsd.toFixed(4)}`;
    costEl.textContent = costStr;

    metricsGroupEl.appendChild(reqEl);
    metricsGroupEl.appendChild(rateEl);
    metricsGroupEl.appendChild(latencyEl);
    metricsGroupEl.appendChild(costEl);

    rowEl.appendChild(nameEl);
    rowEl.appendChild(metricsGroupEl);
    container.appendChild(rowEl);
  });

  return rows;
}

async function loadProviderStats(targetContainer = null) {
  if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
    renderProviderStats(null, targetContainer);
    return null;
  }

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getProviderStats' }, (resp) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(resp || null);
        }
      });
    });

    const stats = response && response.stats
      ? response.stats
      : (response && response.providers ? response : null);
    renderProviderStats(stats, targetContainer);
    return stats;
  } catch (e) {
    renderProviderStats(null, targetContainer);
    return null;
  }
}

async function resetProviderStats(targetContainer = null) {
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'resetProviderStats' }, (resp) => {
        void chrome.runtime?.lastError;
        resolve(resp || null);
      });
    });
  }
  renderProviderStats(null, targetContainer);
  return true;
}

function setAnalyzeButtonLabel(label) {
  if (!elements.analyzeBtn) return;
  const textEl = typeof elements.analyzeBtn.querySelector === 'function'
    ? elements.analyzeBtn.querySelector('.btn-text')
    : null;
  if (textEl) {
    textEl.textContent = label;
  } else {
    elements.analyzeBtn.textContent = label;
  }
}

// Analyser le quiz
async function analyzeQuiz() {
  clearProgressHideTimer();
  state.hasError = false;
  setElementVisibility(elements.progressSection, true, 'flex');
  if (elements.analyzeBtn) {
    elements.analyzeBtn.disabled = true;
    setAnalyzeButtonLabel('Analyse en cours…');
  }
  showProgress('Préparation…', 5);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('Aucun onglet actif trouvé');
    }

    try {
      await sendMessageToTab(tab.id, {
        action: 'analyzeQuiz',
        settings: state,
        forceFallback: true
      });
    } catch (err) {
      if (!err || !err.isMissingReceiver) {
        throw err;
      }
      console.log('Script non détecté, injection en cours...');
      showProgress('Chargement…', 15);

      for (const file of ['provider-catalog.js', 'providers.js', 'schema-cache.js', 'schema-detector.js', 'dom-extractor.js', 'highlight-manager.js', 'content.js']) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [file]
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      showProgress('Lecture du quiz…', 25);

      await sendMessageToTab(tab.id, {
        action: 'analyzeQuiz',
        settings: state,
        forceFallback: true
      });
    }
  } catch (error) {
    showError(error.message);
    state.hasError = true;
  } finally {
    if (elements.analyzeBtn) {
      elements.analyzeBtn.disabled = false;
      setAnalyzeButtonLabel('Analyser la page');
    }

    await loadProviderStats();

    if (!state.hasError) {
      clearProgressHideTimer();
      _progressHideTimer = setTimeout(() => {
        _progressHideTimer = null;
        setElementVisibility(elements.progressSection, false, 'flex');
      }, 2500);
    }
  }
}

// Wrapper de message vers l'onglet
function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || 'Erreur de communication avec l\'onglet';
        const err = new Error(msg);
        err.isMissingReceiver = /receiving end does not exist|could not establish connection/i.test(msg);
        reject(err);
        return;
      }

      if (response && response.success) {
        showResults(response.data);
        resolve(response);
      } else {
        const err = new Error(response?.error || 'Erreur inconnue');
        err.isMissingReceiver = false;
        reject(err);
      }
    });
  });
}

// Afficher les résultats synthétisés
function showResults(data) {
  const qCount = data.questionsFound;
  const aCount = data.answersHighlighted;
  const summary = `${aCount}/${qCount} réponse${qCount > 1 ? 's' : ''} trouvée${qCount > 1 ? 's' : ''}`;
  showProgress(summary, 100);
  announcePopupStatus(summary);
}

// Afficher une erreur dans la barre
function showError(message) {
  clearProgressHideTimer();
  const errorText = `Erreur : ${message}`;
  setElementVisibility(elements.progressSection, true, 'flex');
  if (elements.progressText) {
    elements.progressText.textContent = errorText;
    if (elements.progressText.style) elements.progressText.style.color = 'var(--error-color)';
    if (elements.progressText.classList && typeof elements.progressText.classList.add === 'function') {
      elements.progressText.classList.add('is-error');
    }
  }
  if (elements.progressBarFill) {
    if (elements.progressBarFill.classList && typeof elements.progressBarFill.classList.add === 'function') {
      elements.progressBarFill.classList.add('is-error');
    }
    if (isNativeProgressElement(elements.progressBarFill)) {
      elements.progressBarFill.value = 100;
    } else if (elements.progressBarFill.style) {
      elements.progressBarFill.style.background = 'var(--error-color)';
      elements.progressBarFill.style.width = '100%';
    }
  }
  announcePopupStatus(errorText);
}

// Effacer les surlignages
async function clearHighlights() {
  clearProgressHideTimer();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'clearHighlights' });
    } catch { /* ignore if receiver missing */ }
  }
  setElementVisibility(elements.progressSection, false, 'flex');
  announcePopupStatus('Surlignages effacés');
}

// Notifier le content script
async function notifyContentScript(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    try {
      await chrome.tabs.sendMessage(tab.id, message);
    } catch { /* ignore if receiver missing */ }
  }
}

// Vérifier le schéma du site actif
async function checkSchemaStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action: 'getSchemaStatus' }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(resp);
        }
      });
    });

    if (!response || !response.success) {
      setElementVisibility(elements.schemaStatus, false, 'flex');
      return;
    }

    const data = response.data || response;
    if (!elements.schemaStatus) return;

    setElementVisibility(elements.schemaStatus, true, 'flex');
    if (elements.schemaRediscoverBtn) {
      setElementVisibility(elements.schemaRediscoverBtn, true, 'inline-flex');
    }

    if (data.hasSchema) {
      elements.schemaStatus.className = 'schema-status known';
      if (elements.schemaIcon) elements.schemaIcon.textContent = '';
      const platformText = data.platform ? ` · ${data.platform}` : '';
      elements.schemaText.textContent = `Site reconnu${platformText}`;
    } else if (data.hasInteractive) {
      elements.schemaStatus.className = 'schema-status unknown';
      if (elements.schemaIcon) elements.schemaIcon.textContent = '';
      elements.schemaText.textContent = 'Nouveau site · détecté au lancement';
    } else {
      elements.schemaStatus.className = 'schema-status';
      if (elements.schemaIcon) elements.schemaIcon.textContent = '';
      elements.schemaText.textContent = 'Aucun quiz détecté';
      if (elements.schemaRediscoverBtn) {
        setElementVisibility(elements.schemaRediscoverBtn, false, 'inline-flex');
      }
    }
  } catch (e) {
    setElementVisibility(elements.schemaStatus, false, 'flex');
  }
}

// Lancer une re-découverte manuelle de schéma
async function rediscoverSchema() {
  if (!elements.schemaRediscoverBtn) return;

  elements.schemaRediscoverBtn.disabled = true;
  elements.schemaRediscoverBtn.textContent = '…';
  elements.schemaText.textContent = 'Détection en cours…';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('Aucun onglet actif');

    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: 'discoverSchema' }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    });

    if (response && response.success) {
      elements.schemaStatus.className = 'schema-status known';
      if (elements.schemaIcon) elements.schemaIcon.textContent = '';
      const d = response.data || response.schema || {};
      elements.schemaText.textContent = `Site mémorisé · ${d.platform || 'inconnu'}`;
    } else {
      elements.schemaStatus.className = 'schema-status unknown';
      if (elements.schemaIcon) elements.schemaIcon.textContent = '';
      elements.schemaText.textContent = response?.error || 'Échec de la détection';
    }
  } catch (e) {
    if (elements.schemaIcon) elements.schemaIcon.textContent = '';
    elements.schemaText.textContent = 'Erreur : ' + e.message;
  } finally {
    elements.schemaRediscoverBtn.disabled = false;
    elements.schemaRediscoverBtn.textContent = '↺';
  }
}

const PopupAPI = {
  analyzeQuiz,
  sendMessageToTab,
  loadProviderStats,
  renderProviderStats,
  resetProviderStats,
  normalizeProviderMetrics,
  checkApiConnection,
  loadSettings,
  checkSchemaStatus,
  rediscoverSchema
};

if (typeof window !== 'undefined') {
  window.SafeExmPopup = PopupAPI;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PopupAPI;
}
