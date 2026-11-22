// Settings Page Script

// Éléments DOM
const elements = {
  providersAccordion: document.getElementById('providersAccordion'),
  providerSearchInput: document.getElementById('providerSearchInput'),
  providerFilterCount: document.getElementById('providerFilterCount'),
  providersEmptyState: document.getElementById('providersEmptyState'),
  showAllPriorityProviders: document.getElementById('showAllPriorityProviders'),
  showAllModelOverrides: document.getElementById('showAllModelOverrides'),
  serpApiKey: document.getElementById('serpApiKey'),

  agenticSearch: document.getElementById('agenticSearch'),
  autoMode: document.getElementById('autoMode'),

  captureImages: document.getElementById('captureImages'),
  imageMinSize: document.getElementById('imageMinSize'),
  imageMinSizeDisplay: document.getElementById('imageMinSizeDisplay'),
  imageQuality: document.getElementById('imageQuality'),
  imageQualityDisplay: document.getElementById('imageQualityDisplay'),

  priorityList: document.getElementById('priorityList'),
  modelOverrides: document.getElementById('modelOverrides'),

  contextText: document.getElementById('contextText'),
  fileInput: document.getElementById('fileInput'),
  fileUploadArea: document.getElementById('fileUploadArea'),
  fileList: document.getElementById('fileList'),

  customQuestionSelector: document.getElementById('customQuestionSelector'),
  customAnswerSelector: document.getElementById('customAnswerSelector'),

  highlightColor: document.getElementById('highlightColor'),
  highlightIntensity: document.getElementById('highlightIntensity'),

  schemaList: document.getElementById('schemaList'),
  refreshSchemasBtn: document.getElementById('refreshSchemasBtn'),
  clearAllSchemasBtn: document.getElementById('clearAllSchemasBtn'),

  saveBtn: document.getElementById('saveBtn'),
  resetBtn: document.getElementById('resetBtn'),
  saveStatus: document.getElementById('saveStatus'),

  // Nouveaux éléments
  discretionSlider: document.getElementById('discretionSlider'),
  highlightPreviewElement: document.getElementById('highlightPreviewElement'),
  discretionDescription: document.getElementById('discretionDescription'),
  colorCustomizerRow: document.getElementById('colorCustomizerRow'),
  showConfidenceBadge: document.getElementById('showConfidenceBadge'),

  // Wave 1 / Wave 2 settings (local storage)
  domainPreset: document.getElementById('domainPreset'),
  customDomainRules: document.getElementById('customDomainRules'),
  crossValidationEnabled: document.getElementById('crossValidationEnabled'),
  crossValidationThreshold: document.getElementById('crossValidationThreshold'),
  crossValidationThresholdDisplay: document.getElementById('crossValidationThresholdDisplay'),
  crossValidationOptionsRow: document.getElementById('crossValidationOptionsRow'),
  autoSubmitEnabled: document.getElementById('autoSubmitEnabled'),
  autoSubmitMinConfidence: document.getElementById('autoSubmitMinConfidence'),
  autoSubmitMinConfidenceDisplay: document.getElementById('autoSubmitMinConfidenceDisplay'),
  autoSubmitDelayMs: document.getElementById('autoSubmitDelayMs'),
  autoSubmitDelayMsDisplay: document.getElementById('autoSubmitDelayMsDisplay'),
  autoSubmitOptionsGroup: document.getElementById('autoSubmitOptionsGroup'),
  passiveNetworkIntercept: document.getElementById('passiveNetworkIntercept'),
  themeToggleBtn: document.getElementById('themeToggleBtn')
};

const ALLOWED_DOMAIN_PRESETS = new Set(['auto', 'general', 'law', 'medicine', 'cs', 'math']);
const DEFAULT_BEHAVIOR_SETTINGS = Object.freeze({
  domainPreset: 'auto',
  customDomainRules: '',
  crossValidationEnabled: false,
  crossValidationThreshold: 70,
  autoSubmitEnabled: false,
  autoSubmitMinConfidence: 85,
  autoSubmitDelayMs: 1500,
  passiveNetworkIntercept: false
});

function clampInt(value, min, max, fallback) {
  const num = parseInt(value, 10);
  if (Number.isNaN(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function normalizeDomainPreset(value) {
  return ALLOWED_DOMAIN_PRESETS.has(value) ? value : DEFAULT_BEHAVIOR_SETTINGS.domainPreset;
}

// État local
let uploadedFiles = [];
let providerOrder = ['groq', 'gemini', 'nvidia', 'mistral', 'claude'];
let customModels = {};
let providerConfigs = {};
let providerSearchQuery = '';
let providerFilter = 'all';
const syncedModelsByProvider = {};

// Descriptions des modes de discrétion
const discretionDescriptions = {
  1: {
    title: 'Ultra-discret',
    desc: 'Pas de bordure, juste un très léger voile de fond (+4 %).',
    style: (previewEl, color) => {
      previewEl.style.outline = 'none';
      previewEl.style.borderLeft = 'none';
      previewEl.style.boxShadow = 'none';
      previewEl.style.backgroundColor = 'rgba(59, 130, 246, 0.05)';
      previewEl.style.animation = 'none';
    }
  },
  2: {
    title: 'Discret (recommandé)',
    desc: 'Fine barre latérale de 3 px, sans animation.',
    style: (previewEl, color) => {
      previewEl.style.outline = 'none';
      previewEl.style.borderLeft = `3px solid ${color}`;
      previewEl.style.boxShadow = 'none';
      previewEl.style.backgroundColor = 'rgba(59, 130, 246, 0.03)';
      previewEl.style.animation = 'none';
    }
  },
  3: {
    title: 'Visible',
    desc: 'Contour fin de 1,5 px autour de la réponse, fixe.',
    style: (previewEl, color) => {
      previewEl.style.outline = `1.5px solid ${color}`;
      previewEl.style.borderLeft = 'none';
      previewEl.style.boxShadow = 'none';
      previewEl.style.backgroundColor = 'rgba(59, 130, 246, 0.03)';
      previewEl.style.animation = 'none';
    }
  },
  4: {
    title: 'Lumineux',
    desc: 'Contour épais avec halo lumineux. À réserver hors surveillance.',
    style: (previewEl, color) => {
      previewEl.style.outline = `3px solid ${color}`;
      previewEl.style.borderLeft = 'none';
      previewEl.style.boxShadow = '0 0 14px rgba(59, 130, 246, 0.5), 0 0 28px rgba(56, 189, 248, 0.25)';
      previewEl.style.backgroundColor = 'rgba(59, 130, 246, 0.10)';
      previewEl.style.animation = 'none';
    }
  }
};

// Traduction discretion int <-> discretion string
const discretionIntToString = {
  1: 'ultra-furtif',
  2: 'furtif',
  3: 'visible',
  4: 'glow'
};

const discretionStringToInt = {
  'ultra-furtif': 1,
  'furtif': 2,
  'visible': 3,
  'glow': 4
};

function applyTheme(theme) {
  if (!document.documentElement) return;
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
}

async function initTheme() {
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
document.addEventListener('DOMContentLoaded', async () => {
  await initTheme();
  renderProviderCards();
  setupEventListeners();
  await loadSettings();
  loadSchemas();
});

function getProvidersMap() {
  return (window.QuizProviders && window.QuizProviders.PROVIDERS) ? window.QuizProviders.PROVIDERS : {};
}

function getDefaultPriority() {
  const qp = window.QuizProviders;
  return (qp && Array.isArray(qp.DEFAULT_PRIORITY) && qp.DEFAULT_PRIORITY.length > 0)
    ? [...qp.DEFAULT_PRIORITY]
    : ['groq', 'gemini', 'nvidia', 'mistral', 'claude'];
}

function getProviderKeyInput(providerKey, provider) {
  const field = (provider && provider.apiKeyField) ? provider.apiKeyField : `${providerKey}ApiKey`;
  return document.getElementById(field) || document.getElementById(`${providerKey}ApiKey`);
}

function readProviderCardConfig(providerKey, provider) {
  const existing = (providerConfigs && Object.prototype.hasOwnProperty.call(providerConfigs, providerKey) &&
    providerConfigs[providerKey] && typeof providerConfigs[providerKey] === 'object')
    ? providerConfigs[providerKey]
    : {};
  const baseInput = document.getElementById(`${providerKey}BaseUrl`);
  const accountInput = document.getElementById(`${providerKey}AccountId`);
  const enabledInput = document.getElementById(`${providerKey}Enabled`);

  const baseUrl = baseInput ? baseInput.value.trim() : (typeof existing.baseUrl === 'string' ? existing.baseUrl.trim() : '');
  const accountId = accountInput ? accountInput.value.trim() : (typeof existing.accountId === 'string' ? existing.accountId.trim() : '');
  const enabled = enabledInput ? enabledInput.checked === true : (existing.enabled === true);

  const out = {};
  if (baseUrl) out.baseUrl = baseUrl;
  if (accountId) out.accountId = accountId;
  if (provider && provider.local === true) out.enabled = enabled;
  return out;
}

function isProviderConfiguredInUI(providerKey, provider, snapshot) {
  if (!provider || typeof provider !== 'object') return false;
  if (window.QuizProviders && typeof window.QuizProviders.isProviderConfigured === 'function') {
    return window.QuizProviders.isProviderConfigured(providerKey, snapshot);
  }
  const pCfg = snapshot?.providerConfigs?.[providerKey] || null;
  if (provider.local === true) {
    return Boolean(pCfg && pCfg.enabled === true);
  }
  const val = provider.apiKeyField ? snapshot?.[provider.apiKeyField] : '';
  if (typeof val !== 'string' || val.trim().length === 0) return false;
  if (provider.requiresAccountId && !(pCfg && typeof pCfg.accountId === 'string' && pCfg.accountId.trim())) return false;
  if (provider.requiresBaseUrl && !(pCfg && typeof pCfg.baseUrl === 'string' && pCfg.baseUrl.trim())) return false;
  return true;
}

function collectAllProviderFormState() {
  const providersMap = getProvidersMap();
  const apiKeyValues = {};
  const nextProviderConfigs = {};
  for (const [id, provider] of Object.entries(providersMap)) {
    const keyInput = getProviderKeyInput(id, provider);
    if (provider && provider.apiKeyField) {
      apiKeyValues[provider.apiKeyField] = keyInput ? keyInput.value.trim() : '';
    }
    const cfg = readProviderCardConfig(id, provider);
    if (cfg.baseUrl || cfg.accountId || (provider.local === true && cfg.enabled === true)) {
      nextProviderConfigs[id] = cfg;
    }
  }
  return {
    apiKeyValues,
    nextProviderConfigs,
    snapshot: { ...apiKeyValues, providerConfigs: nextProviderConfigs }
  };
}

function isLoopbackUiHost(rawHostname) {
  if (typeof rawHostname !== 'string' || !rawHostname) return false;
  const h = rawHostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function validateProviderBaseUrl(provider, rawUrl) {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmed) return { ok: true, normalized: '' };

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_) {
    return { ok: false, reason: `URL de base invalide pour ${provider?.name || 'ce fournisseur'}.` };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'Identifiants interdits dans l\'URL de base.' };
  }

  const proto = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  const isLoopback = isLoopbackUiHost(host);

  if (provider && provider.local === true) {
    if ((proto !== 'http:' && proto !== 'https:') || !isLoopback) {
      return { ok: false, reason: `${provider.name || 'Fournisseur local'} n'autorise que localhost / 127.0.0.1 / [::1].` };
    }
    return { ok: true, normalized: trimmed };
  }

  if (provider && provider.allowsLoopbackBaseUrl === true && isLoopback) {
    if (proto !== 'http:' && proto !== 'https:') {
      return { ok: false, reason: 'Protocole HTTP ou HTTPS requis pour une URL locale.' };
    }
    return { ok: true, normalized: trimmed };
  }

  if (proto !== 'https:') {
    return { ok: false, reason: `HTTPS requis pour l'URL personnalisée de ${provider?.name || 'ce fournisseur'}.` };
  }

  const ipv4Parts = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  const isBlockedHost = isLoopback ||
    /^(?:\d+|0x[0-9a-f]+)$/i.test(host) ||
    !host.includes('.') ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.includes(':') ||
    Boolean(ipv4Parts && (
      Number(ipv4Parts[1]) === 0 ||
      Number(ipv4Parts[1]) === 10 ||
      Number(ipv4Parts[1]) === 127 ||
      Number(ipv4Parts[1]) >= 224 ||
      (Number(ipv4Parts[1]) === 169 && Number(ipv4Parts[2]) === 254) ||
      (Number(ipv4Parts[1]) === 172 && Number(ipv4Parts[2]) >= 16 && Number(ipv4Parts[2]) <= 31) ||
      (Number(ipv4Parts[1]) === 192 && Number(ipv4Parts[2]) === 168) ||
      (Number(ipv4Parts[1]) === 100 && Number(ipv4Parts[2]) >= 64 && Number(ipv4Parts[2]) <= 127)
    ));

  if (isBlockedHost) {
    return { ok: false, reason: `Hôte privé ou réservé interdit dans l'URL de ${provider?.name || 'ce fournisseur'}.` };
  }

  return { ok: true, normalized: trimmed };
}

async function persistSingleProviderConfig(providerKey) {
  const providersMap = getProvidersMap();
  const provider = providersMap[providerKey];
  if (!provider) return {};
  const cfg = readProviderCardConfig(providerKey, provider);
  if (cfg.baseUrl) {
    const check = validateProviderBaseUrl(provider, cfg.baseUrl);
    if (!check.ok) {
      throw new Error(check.reason);
    }
  }
  if (cfg.baseUrl || cfg.accountId || (provider.local === true && cfg.enabled === true)) {
    providerConfigs[providerKey] = cfg;
  } else {
    delete providerConfigs[providerKey];
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local &&
      typeof chrome.storage.local.get === 'function' && typeof chrome.storage.local.set === 'function') {
    try {
      const existing = await chrome.storage.local.get(['providerConfigs']);
      const storedMap = (existing && existing.providerConfigs && typeof existing.providerConfigs === 'object')
        ? { ...existing.providerConfigs }
        : {};
      if (providerConfigs[providerKey]) {
        storedMap[providerKey] = providerConfigs[providerKey];
      } else {
        delete storedMap[providerKey];
      }
      await chrome.storage.local.set({ providerConfigs: storedMap });
    } catch (_) { /* ignore storage errors in tests */ }
  }
  return cfg;
}

function renderProviderCards() {
  if (!elements.providersAccordion) return;
  elements.providersAccordion.textContent = '';

  const providersMap = getProvidersMap();
  for (const [id, provider] of Object.entries(providersMap)) {
    const card = document.createElement('details');
    card.className = 'key-card';
    card.setAttribute('name', 'api-keys');
    card.id = `card-${id}`;
    card.dataset.providerId = id;
    card.dataset.category = provider.local === true ? 'local' : 'cloud';
    card.dataset.configured = 'false';
    card.dataset.search = `${id} ${provider.name || ''} ${provider.baseUrl || ''} ${provider.local ? 'local' : 'cloud'}`.toLowerCase();

    const summary = document.createElement('summary');
    summary.className = 'key-card-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'provider-title';
    titleSpan.appendChild(document.createTextNode(`${provider.name || id} `));

    const tierText = provider.local === true ? 'Local' : (provider.tierLabel || '');
    if (tierText) {
      const tierSpan = document.createElement('span');
      tierSpan.className = provider.local === true ? 'provider-tier provider-tier-local' : 'provider-tier';
      tierSpan.textContent = tierText;
      titleSpan.appendChild(tierSpan);
    }

    const statusBadge = document.createElement('span');
    statusBadge.className = 'key-status-badge badge-empty';
    statusBadge.id = `${id}StatusBadge`;
    statusBadge.textContent = provider.local === true ? 'Désactivé' : 'Non configurée';

    summary.appendChild(titleSpan);
    summary.appendChild(statusBadge);
    card.appendChild(summary);

    const content = document.createElement('div');
    content.className = 'key-card-content';

    if (provider.local === true) {
      const toggleItem = document.createElement('div');
      toggleItem.className = 'setting-item';

      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'checkbox-label';

      const toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.id = `${id}Enabled`;
      toggleInput.className = 'provider-enabled-toggle';
      toggleInput.dataset.provider = id;
      toggleInput.addEventListener('change', () => {
        updateApiKeyBadges();
        renderPriorityList();
        renderModelOverrides();
      });

      const toggleText = document.createElement('span');
      toggleText.textContent = 'Activer ce fournisseur local';

      toggleLabel.appendChild(toggleInput);
      toggleLabel.appendChild(toggleText);
      toggleItem.appendChild(toggleLabel);
      content.appendChild(toggleItem);
    }

    const keyItem = document.createElement('div');
    keyItem.className = 'setting-item';

    const keyField = provider.apiKeyField || `${id}ApiKey`;
    const keyLabel = document.createElement('label');
    keyLabel.setAttribute('for', keyField);
    keyLabel.textContent = provider.local === true
      ? `Clé API ${provider.name} (optionnelle)`
      : `Clé API ${provider.name}`;
    keyItem.appendChild(keyLabel);

    const inputGroup = document.createElement('div');
    inputGroup.className = 'input-group';

    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.id = keyField;
    keyInput.placeholder = provider.keyPlaceholder || '...';
    keyInput.className = 'provider-apikey-input';
    keyInput.dataset.provider = id;
    keyInput.setAttribute('autocomplete', 'off');
    keyInput.addEventListener('input', () => {
      updateApiKeyBadges();
      renderPriorityList();
      renderModelOverrides();
    });

    const toggleVisBtn = document.createElement('button');
    toggleVisBtn.type = 'button';
    toggleVisBtn.className = 'toggle-visibility';
    toggleVisBtn.dataset.target = keyField;
    toggleVisBtn.textContent = 'Voir';
    toggleVisBtn.addEventListener('click', () => {
      keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
      toggleVisBtn.textContent = keyInput.type === 'password' ? 'Voir' : 'Cacher';
    });

    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'test-btn';
    testBtn.dataset.provider = id;
    testBtn.textContent = 'Tester';
    testBtn.addEventListener('click', () => testProvider(id, testBtn));

    const syncBtn = document.createElement('button');
    syncBtn.type = 'button';
    syncBtn.className = 'sync-models-btn';
    syncBtn.dataset.provider = id;
    syncBtn.title = 'Synchroniser la liste des modèles';
    syncBtn.textContent = 'Modèles';
    syncBtn.addEventListener('click', () => syncProviderModelsUI(id, syncBtn));

    inputGroup.appendChild(keyInput);
    inputGroup.appendChild(toggleVisBtn);
    inputGroup.appendChild(testBtn);
    inputGroup.appendChild(syncBtn);
    keyItem.appendChild(inputGroup);
    content.appendChild(keyItem);

    if (provider.supportsCustomBaseUrl || provider.requiresBaseUrl || provider.local) {
      const baseItem = document.createElement('div');
      baseItem.className = 'setting-item provider-secondary-field';

      const baseLabel = document.createElement('label');
      baseLabel.setAttribute('for', `${id}BaseUrl`);
      const suffix = provider.requiresBaseUrl ? ' (requise)' : (provider.local ? ' (locale)' : ' (optionnelle)');
      baseLabel.textContent = `URL de base${suffix}`;

      const baseInput = document.createElement('input');
      baseInput.type = 'text';
      baseInput.id = `${id}BaseUrl`;
      baseInput.className = 'provider-baseurl-input';
      baseInput.dataset.provider = id;
      baseInput.placeholder = provider.baseUrl ||
        (id === 'azure_openai' ? 'https://<ressource>.openai.azure.com/openai/v1' : 'https://...');
      baseInput.addEventListener('input', () => {
        updateApiKeyBadges();
        renderPriorityList();
        renderModelOverrides();
      });

      baseItem.appendChild(baseLabel);
      baseItem.appendChild(baseInput);
      content.appendChild(baseItem);
    }

    if (provider.requiresAccountId) {
      const acctItem = document.createElement('div');
      acctItem.className = 'setting-item provider-secondary-field';

      const acctLabel = document.createElement('label');
      acctLabel.setAttribute('for', `${id}AccountId`);
      acctLabel.textContent = 'Account ID Cloudflare (requis)';

      const acctInput = document.createElement('input');
      acctInput.type = 'text';
      acctInput.id = `${id}AccountId`;
      acctInput.className = 'provider-accountid-input';
      acctInput.dataset.provider = id;
      acctInput.placeholder = 'ex. 0123456789abcdef0123456789abcdef';
      acctInput.addEventListener('input', () => {
        updateApiKeyBadges();
        renderPriorityList();
        renderModelOverrides();
      });

      acctItem.appendChild(acctLabel);
      acctItem.appendChild(acctInput);
      content.appendChild(acctItem);
    }

    const metaDiv = document.createElement('div');
    metaDiv.className = 'provider-card-meta';

    const modelsInfo = document.createElement('span');
    modelsInfo.className = 'help-text provider-models-count';
    modelsInfo.id = `${id}ModelsInfo`;
    modelsInfo.textContent = `Modèle par défaut : ${provider.defaultTextModel || 'auto'}`;
    metaDiv.appendChild(modelsInfo);

    if (typeof provider.credentialUrl === 'string' && provider.credentialUrl.startsWith('https://')) {
      const credP = document.createElement('p');
      credP.className = 'help-text';
      credP.appendChild(document.createTextNode('Créer une clé sur '));
      const link = document.createElement('a');
      link.href = provider.credentialUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      try {
        link.textContent = new URL(provider.credentialUrl).hostname;
      } catch (_) {
        link.textContent = provider.credentialUrl;
      }
      credP.appendChild(link);
      metaDiv.appendChild(credP);
    }

    content.appendChild(metaDiv);
    card.appendChild(content);
    elements.providersAccordion.appendChild(card);
  }
}

function applyProviderFilters() {
  if (!elements.providersAccordion) return;
  const cards = [...elements.providersAccordion.querySelectorAll('.key-card')];
  const query = providerSearchQuery.trim().toLowerCase();
  let visibleCount = 0;

  for (const card of cards) {
    const category = card.dataset.category || 'cloud';
    const isConfigured = card.dataset.configured === 'true';
    const searchHaystack = card.dataset.search || '';

    let matchesFilter = true;
    if (providerFilter === 'configured') matchesFilter = isConfigured;
    else if (providerFilter === 'cloud') matchesFilter = category === 'cloud';
    else if (providerFilter === 'local') matchesFilter = category === 'local';

    const matchesSearch = !query || searchHaystack.includes(query);
    const visible = matchesFilter && matchesSearch;

    card.hidden = !visible;
    card.style.display = visible ? '' : 'none';
    if (visible) visibleCount += 1;
  }

  if (elements.providerFilterCount) {
    elements.providerFilterCount.textContent = `${visibleCount} / ${cards.length}`;
  }
  if (elements.providersEmptyState) {
    elements.providersEmptyState.hidden = visibleCount > 0;
  }
}

function syncProviderOrder(snapshot) {
  const providersMap = getProvidersMap();
  const validKeys = new Set(Object.keys(providersMap));
  const normalizedOrder = [];
  const seen = new Set();

  for (const rawKey of (Array.isArray(providerOrder) ? providerOrder : [])) {
    const key = typeof rawKey === 'string' ? rawKey.trim().toLowerCase() : '';
    if (key && validKeys.has(key) && !seen.has(key)) {
      seen.add(key);
      normalizedOrder.push(key);
    }
  }

  for (const [id, provider] of Object.entries(providersMap)) {
    if (!seen.has(id) && isProviderConfiguredInUI(id, provider, snapshot)) {
      seen.add(id);
      normalizedOrder.push(id);
    }
  }

  if (normalizedOrder.length === 0) {
    providerOrder = getDefaultPriority().filter(k => validKeys.has(k));
  } else {
    providerOrder = normalizedOrder;
  }
}

// Charger les paramètres
async function loadSettings() {
  const syncSettings = await chrome.storage.sync.get([
    'captureImages', 'imageMinSize', 'imageQuality',
    'contextText',
    'customQuestionSelector', 'customAnswerSelector',
    'highlightColor', 'highlightIntensity',
    'providerOrder', 'customModels', 'agenticSearch', 'autoMode',
    'highlightDiscretion', 'showConfidenceBadge'
  ]);

  const qp = window.QuizProviders;
  const providerStorageKeys = (qp && typeof qp.getAllStorageKeys === 'function')
    ? qp.getAllStorageKeys()
    : [
        'groqApiKey', 'geminiApiKey', 'nvidiaApiKey',
        'mistralApiKey', 'claudeApiKey',
        'providerConfigs', 'serpApiKey'
      ];

  const localKeys = [...new Set([
    ...providerStorageKeys,
    'contextFiles',
    'domainPreset', 'customDomainRules',
    'crossValidationEnabled', 'crossValidationThreshold',
    'autoSubmitEnabled', 'autoSubmitMinConfidence', 'autoSubmitDelayMs',
    'passiveNetworkIntercept'
  ])];

  // S1 — API keys + providerConfigs + behavior options are stored in local storage
  const localSettings = await chrome.storage.local.get(localKeys);

  providerConfigs = (localSettings.providerConfigs && typeof localSettings.providerConfigs === 'object')
    ? JSON.parse(JSON.stringify(localSettings.providerConfigs))
    : {};

  // Appliquer les valeurs (Clés API + configs par fournisseur)
  const providersMap = getProvidersMap();
  for (const [id, provider] of Object.entries(providersMap)) {
    const keyInput = getProviderKeyInput(id, provider);
    if (keyInput && provider.apiKeyField) {
      keyInput.value = typeof localSettings[provider.apiKeyField] === 'string'
        ? localSettings[provider.apiKeyField]
        : '';
    }
    const pCfg = (providerConfigs && Object.prototype.hasOwnProperty.call(providerConfigs, id) &&
      providerConfigs[id] && typeof providerConfigs[id] === 'object')
      ? providerConfigs[id]
      : {};
    const baseInput = document.getElementById(`${id}BaseUrl`);
    if (baseInput) baseInput.value = typeof pCfg.baseUrl === 'string' ? pCfg.baseUrl : '';
    const acctInput = document.getElementById(`${id}AccountId`);
    if (acctInput) acctInput.value = typeof pCfg.accountId === 'string' ? pCfg.accountId : '';
    const enabledInput = document.getElementById(`${id}Enabled`);
    if (enabledInput) enabledInput.checked = pCfg.enabled === true;
  }

  if (elements.serpApiKey) elements.serpApiKey.value = localSettings.serpApiKey || '';

  // Options
  if (elements.agenticSearch) elements.agenticSearch.checked = syncSettings.agenticSearch === true;
  if (elements.autoMode) elements.autoMode.checked = syncSettings.autoMode === true;

  // Image Capture Settings
  elements.captureImages.checked = syncSettings.captureImages !== false;
  elements.imageMinSize.value = syncSettings.imageMinSize || 50;
  elements.imageMinSizeDisplay.textContent = `${elements.imageMinSize.value} px`;

  elements.imageQuality.value = syncSettings.imageQuality || 0.8;
  elements.imageQualityDisplay.textContent = elements.imageQuality.value;

  // Order & Models
  if (Array.isArray(syncSettings.providerOrder) && syncSettings.providerOrder.length > 0) {
    providerOrder = syncSettings.providerOrder;
  }
  if (syncSettings.customModels && typeof syncSettings.customModels === 'object') {
    customModels = JSON.parse(JSON.stringify(syncSettings.customModels));
  }

  // Mettre à jour les badges, ordre et modèles personnalisés
  updateApiKeyBadges();
  const { snapshot } = collectAllProviderFormState();
  syncProviderOrder(snapshot);
  renderPriorityList();
  renderModelOverrides();

  // Pré-charger les listes de modèles déjà en cache
  if (window.ModelRegistry && typeof window.ModelRegistry.getCachedModels === 'function') {
    Promise.allSettled(
      Object.keys(providersMap).map(async (id) => {
        const cached = await window.ModelRegistry.getCachedModels(id);
        if (Array.isArray(cached) && cached.length > 0) {
          syncedModelsByProvider[id] = cached;
          const infoEl = document.getElementById(`${id}ModelsInfo`);
          if (infoEl) {
            infoEl.textContent = `${cached.length} modèle(s) en cache (défaut : ${providersMap[id].defaultTextModel || 'auto'})`;
          }
        }
      })
    ).then(() => {
      renderModelOverrides();
    }).catch(() => {});
  }

  // Context & UI Settings
  elements.contextText.value = syncSettings.contextText || '';
  elements.customQuestionSelector.value = syncSettings.customQuestionSelector || '';
  elements.customAnswerSelector.value = syncSettings.customAnswerSelector || '';
  elements.highlightColor.value = syncSettings.highlightColor || '#4DA8DA';
  elements.highlightIntensity.value = syncSettings.highlightIntensity || 0.4;

  // Appliquer le slider de discrétion
  const discretionStr = syncSettings.highlightDiscretion || 'furtif';
  const discretionInt = discretionStringToInt[discretionStr] || 2;
  elements.discretionSlider.value = discretionInt;
  updateDiscretionUI();

  if (elements.showConfidenceBadge) {
    elements.showConfidenceBadge.checked = syncSettings.showConfidenceBadge !== false;
  }

  if (localSettings.contextFiles) {
    uploadedFiles = localSettings.contextFiles;
    renderFileList();
  }

  // Wave 1 / Wave 2 settings (local storage, safe defaults)
  if (elements.domainPreset) {
    elements.domainPreset.value = normalizeDomainPreset(localSettings.domainPreset);
  }
  if (elements.customDomainRules) {
    elements.customDomainRules.value = typeof localSettings.customDomainRules === 'string'
      ? localSettings.customDomainRules
      : DEFAULT_BEHAVIOR_SETTINGS.customDomainRules;
  }
  if (elements.crossValidationEnabled) {
    elements.crossValidationEnabled.checked = localSettings.crossValidationEnabled === true;
  }
  const cvThreshold = clampInt(
    localSettings.crossValidationThreshold,
    50,
    90,
    DEFAULT_BEHAVIOR_SETTINGS.crossValidationThreshold
  );
  if (elements.crossValidationThreshold) {
    elements.crossValidationThreshold.value = cvThreshold;
  }
  if (elements.crossValidationThresholdDisplay) {
    elements.crossValidationThresholdDisplay.textContent = `${cvThreshold} %`;
  }

  if (elements.autoSubmitEnabled) {
    elements.autoSubmitEnabled.checked = localSettings.autoSubmitEnabled === true;
  }
  const autoMinConf = clampInt(
    localSettings.autoSubmitMinConfidence,
    70,
    99,
    DEFAULT_BEHAVIOR_SETTINGS.autoSubmitMinConfidence
  );
  if (elements.autoSubmitMinConfidence) {
    elements.autoSubmitMinConfidence.value = autoMinConf;
  }
  if (elements.autoSubmitMinConfidenceDisplay) {
    elements.autoSubmitMinConfidenceDisplay.textContent = `${autoMinConf} %`;
  }
  const autoDelayMs = clampInt(
    localSettings.autoSubmitDelayMs,
    800,
    5000,
    DEFAULT_BEHAVIOR_SETTINGS.autoSubmitDelayMs
  );
  if (elements.autoSubmitDelayMs) {
    elements.autoSubmitDelayMs.value = autoDelayMs;
  }
  if (elements.autoSubmitDelayMsDisplay) {
    elements.autoSubmitDelayMsDisplay.textContent = `${autoDelayMs} ms`;
  }

  if (elements.passiveNetworkIntercept) {
    elements.passiveNetworkIntercept.checked = localSettings.passiveNetworkIntercept === true;
  }

  updateBehaviorDependenciesUI();
}

function updateBehaviorDependenciesUI() {
  if (elements.crossValidationOptionsRow && elements.crossValidationEnabled) {
    elements.crossValidationOptionsRow.classList.toggle(
      'sub-settings-muted',
      !elements.crossValidationEnabled.checked
    );
  }
  if (elements.autoSubmitOptionsGroup && elements.autoSubmitEnabled) {
    elements.autoSubmitOptionsGroup.classList.toggle(
      'sub-settings-muted',
      !elements.autoSubmitEnabled.checked
    );
  }
}

// Rendre la liste de priorité (sans innerHTML interpolé)
function renderPriorityList() {
  if (!elements.priorityList) return;
  elements.priorityList.textContent = '';

  const providersMap = getProvidersMap();
  const { snapshot } = collectAllProviderFormState();
  syncProviderOrder(snapshot);

  const showAll = Boolean(elements.showAllPriorityProviders && elements.showAllPriorityProviders.checked);
  const fullOrder = [...new Set([...providerOrder, ...Object.keys(providersMap)])]
    .filter(id => Object.prototype.hasOwnProperty.call(providersMap, id));

  let keysToDisplay = fullOrder;
  if (!showAll) {
    const configuredKeys = fullOrder.filter(id => isProviderConfiguredInUI(id, providersMap[id], snapshot));
    keysToDisplay = configuredKeys.length > 0
      ? configuredKeys
      : getDefaultPriority().filter(id => Object.prototype.hasOwnProperty.call(providersMap, id));
  }

  keysToDisplay.forEach((id) => {
    const provider = providersMap[id];
    if (!provider) return;

    const item = document.createElement('div');
    item.className = 'priority-item';
    item.draggable = true;
    item.dataset.id = id;

    const handle = document.createElement('span');
    handle.className = 'handle';
    handle.textContent = '☰';

    const info = document.createElement('div');
    info.className = 'provider-info';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = provider.name || id;
    info.appendChild(nameSpan);

    item.appendChild(handle);
    item.appendChild(info);

    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('drop', handleDrop);
    item.addEventListener('dragend', handleDragEnd);

    elements.priorityList.appendChild(item);
  });
}

function syncVisibleModelInputsIntoState() {
  if (!elements.modelOverrides) return;
  elements.modelOverrides.querySelectorAll('.model-input').forEach(input => {
    const p = input.dataset.provider;
    const t = input.dataset.type;
    if (!p || !t) return;
    if (!customModels[p] || typeof customModels[p] !== 'object') {
      customModels[p] = {};
    }
    customModels[p][t] = input.value.trim();
  });
}

function getModelSuggestionsForProvider(id, provider) {
  const seen = new Set();
  const list = [];
  const pushId = (val) => {
    if (typeof val === 'string' && val.trim() && !seen.has(val.trim())) {
      seen.add(val.trim());
      list.push(val.trim());
    }
  };
  (provider.textModels || []).forEach(m => pushId(m?.id));
  (provider.visionModels || []).forEach(m => pushId(m?.id));
  (syncedModelsByProvider[id] || []).forEach(m => pushId(m?.id));
  return list;
}

// Rendre les overrides de modèles (DOM natif sans innerHTML)
function renderModelOverrides() {
  if (!elements.modelOverrides) return;
  syncVisibleModelInputsIntoState();
  elements.modelOverrides.textContent = '';

  const providersMap = getProvidersMap();
  const { snapshot } = collectAllProviderFormState();
  const showAll = Boolean(elements.showAllModelOverrides && elements.showAllModelOverrides.checked);
  const allKeys = [...new Set([...providerOrder, ...Object.keys(providersMap)])]
    .filter(id => Object.prototype.hasOwnProperty.call(providersMap, id));

  let keysToDisplay = allKeys;
  if (!showAll) {
    const activeKeys = allKeys.filter(id =>
      isProviderConfiguredInUI(id, providersMap[id], snapshot) ||
      Boolean(customModels[id]?.text) ||
      Boolean(customModels[id]?.vision)
    );
    keysToDisplay = activeKeys.length > 0
      ? activeKeys
      : getDefaultPriority().filter(id => Object.prototype.hasOwnProperty.call(providersMap, id));
  }

  keysToDisplay.forEach(id => {
    const p = providersMap[id];
    if (!p) return;

    const div = document.createElement('div');
    div.className = 'model-override-card';
    if (p.color) {
      div.style.borderLeftColor = p.color;
    }

    const heading = document.createElement('h3');
    heading.textContent = p.name || id;
    div.appendChild(heading);

    const datalistId = `models-list-${id}`;
    const datalist = document.createElement('datalist');
    datalist.id = datalistId;
    for (const modelId of getModelSuggestionsForProvider(id, p)) {
      const opt = document.createElement('option');
      opt.value = modelId;
      datalist.appendChild(opt);
    }
    div.appendChild(datalist);

    const row = document.createElement('div');
    row.className = 'model-inputs-row';

    const makeField = (labelText, typeKey, defaultModelVal, savedVal) => {
      const group = document.createElement('div');
      group.className = 'input-group';

      const lbl = document.createElement('label');
      lbl.textContent = labelText;

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = `Par défaut : ${defaultModelVal || 'auto'}`;
      inp.value = savedVal || '';
      inp.dataset.provider = id;
      inp.dataset.type = typeKey;
      inp.className = 'model-input';
      inp.setAttribute('list', datalistId);

      group.appendChild(lbl);
      group.appendChild(inp);
      return group;
    };

    row.appendChild(makeField('Modèle texte', 'text', p.defaultTextModel, customModels[id]?.text));
    row.appendChild(makeField('Modèle vision', 'vision', p.defaultVisionModel, customModels[id]?.vision));

    div.appendChild(row);
    elements.modelOverrides.appendChild(div);
  });
}

// Drag & Drop Handlers
let dragSrcEl = null;

function handleDragStart(e) {
  this.classList.add('dragging');
  dragSrcEl = this;
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
  e.preventDefault();
  return false;
}

function handleDrop(e) {
  e.stopPropagation();
  if (dragSrcEl && dragSrcEl !== this && elements.priorityList) {
    const fromId = dragSrcEl.dataset ? dragSrcEl.dataset.id : null;
    const toId = this.dataset ? this.dataset.id : null;
    if (fromId && toId && fromId !== toId) {
      const visibleItems = [...elements.priorityList.querySelectorAll('.priority-item')];
      const visFrom = visibleItems.indexOf(dragSrcEl);
      const visTo = visibleItems.indexOf(this);
      const providersMap = getProvidersMap();
      const nextOrder = [...new Set([...providerOrder, ...Object.keys(providersMap)])]
        .filter(id => Object.prototype.hasOwnProperty.call(providersMap, id));
      const fromIdx = nextOrder.indexOf(fromId);
      if (fromIdx !== -1) {
        nextOrder.splice(fromIdx, 1);
        let toIdx = nextOrder.indexOf(toId);
        if (toIdx === -1) {
          toIdx = nextOrder.length;
        } else if (visFrom !== -1 && visTo !== -1 && visFrom < visTo) {
          toIdx += 1;
        }
        nextOrder.splice(toIdx, 0, fromId);
        providerOrder = nextOrder;
        renderPriorityList();
      }
    }
  }
  return false;
}

function handleDragEnd() {
  this.classList.remove('dragging');
}

// Mettre à jour le statut des accordéons
function updateApiKeyBadges() {
  const providersMap = getProvidersMap();
  const { snapshot } = collectAllProviderFormState();

  for (const [id, provider] of Object.entries(providersMap)) {
    const keyInput = getProviderKeyInput(id, provider);
    const badge = document.getElementById(`${id}StatusBadge`);
    const card = document.getElementById(`card-${id}`);
    const configured = isProviderConfiguredInUI(id, provider, snapshot);
    const hasKeyOnly = Boolean(keyInput && keyInput.value.trim().length > 0);

    if (card) {
      card.dataset.configured = configured ? 'true' : 'false';
    }
    if (badge) {
      if (configured) {
        badge.textContent = provider.local === true ? 'Activé' : 'Configurée';
        badge.className = 'key-status-badge badge-connected';
      } else if (hasKeyOnly && (provider.requiresAccountId || provider.requiresBaseUrl)) {
        badge.textContent = 'Incomplet';
        badge.className = 'key-status-badge badge-warning';
      } else {
        badge.textContent = provider.local === true ? 'Désactivé' : 'Non configurée';
        badge.className = 'key-status-badge badge-empty';
      }
    }
  }
  applyProviderFilters();
}

// Gérer la mise à jour visuelle du curseur de discrétion
function updateDiscretionUI() {
  const value = parseInt(elements.discretionSlider.value);
  const color = elements.highlightColor.value;
  const previewEl = elements.highlightPreviewElement;
  const descEl = elements.discretionDescription;
  const colorRow = elements.colorCustomizerRow;

  // Mettre à jour l'état actif des étiquettes textuelles
  document.querySelectorAll('.step-label').forEach(label => {
    const val = parseInt(label.dataset.value);
    if (val === value) {
      label.classList.add('active');
    } else {
      label.classList.remove('active');
    }
  });

  const level = discretionDescriptions[value];
  if (level && previewEl && descEl) {
    descEl.textContent = '';
    const strongEl = document.createElement('strong');
    strongEl.textContent = level.title;
    descEl.appendChild(strongEl);
    descEl.appendChild(document.createTextNode(` — ${level.desc}`));
    level.style(previewEl, color);
  }

  // Cacher/Afficher le personnalisateur de couleur
  if (colorRow) {
    if (value === 3 || value === 4) {
      colorRow.style.opacity = '1';
      colorRow.style.pointerEvents = 'auto';
    } else {
      colorRow.style.opacity = '0.4';
      colorRow.style.pointerEvents = 'none';
    }
  }
}

// Configurer les écouteurs
function setupEventListeners() {
  // Navigation par Onglets
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const targetId = btn.getAttribute('aria-controls');
      const contentEl = document.getElementById(targetId);
      if (contentEl) {
        contentEl.classList.add('active');
      }
    });
  });

  // Bascule thème Papier / Ardoise
  if (elements.themeToggleBtn) {
    elements.themeToggleBtn.addEventListener('click', async () => {
      const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ uiTheme: next });
      }
    });
  }

  // Toggles de visibilité de clé API (hors cartes générées dynamiquement)
  document.querySelectorAll('.toggle-visibility').forEach(btn => {
    if (elements.providersAccordion && elements.providersAccordion.contains(btn)) return;
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? 'Voir' : 'Cacher';
    });
  });

  // Recherche et filtres des fournisseurs (onglet Clés API)
  if (elements.providerSearchInput) {
    elements.providerSearchInput.addEventListener('input', (e) => {
      providerSearchQuery = e.target.value || '';
      applyProviderFilters();
    });
  }

  document.querySelectorAll('.provider-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.provider-filter-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      providerFilter = btn.dataset.filter || 'all';
      applyProviderFilters();
    });
  });

  if (elements.showAllPriorityProviders) {
    elements.showAllPriorityProviders.addEventListener('change', renderPriorityList);
  }
  if (elements.showAllModelOverrides) {
    elements.showAllModelOverrides.addEventListener('change', renderModelOverrides);
  }

  // Boutons Test API hors accordéon dynamique (compatibilité tests/legacy)
  document.querySelectorAll('.test-btn').forEach(btn => {
    if (elements.providersAccordion && elements.providersAccordion.contains(btn)) return;
    btn.addEventListener('click', () => testProvider(btn.dataset.provider, btn));
  });

  // Discretion Slider
  elements.discretionSlider.addEventListener('input', updateDiscretionUI);

  // Étiquettes de discrétion cliquables
  document.querySelectorAll('.step-label').forEach(label => {
    label.addEventListener('click', () => {
      elements.discretionSlider.value = label.dataset.value;
      updateDiscretionUI();
    });
  });

  // Couleur et Intensité de surlignage
  elements.highlightColor.addEventListener('input', updateDiscretionUI);
  elements.highlightIntensity.addEventListener('input', updateDiscretionUI);

  // Sliders de taille et qualité image
  elements.imageMinSize.addEventListener('input', (e) => {
    elements.imageMinSizeDisplay.textContent = `${e.target.value} px`;
  });
  elements.imageQuality.addEventListener('input', (e) => {
    elements.imageQualityDisplay.textContent = e.target.value;
  });

  // Sliders et toggles Wave 1 / Wave 2
  if (elements.crossValidationEnabled) {
    elements.crossValidationEnabled.addEventListener('change', updateBehaviorDependenciesUI);
  }
  if (elements.crossValidationThreshold && elements.crossValidationThresholdDisplay) {
    elements.crossValidationThreshold.addEventListener('input', (e) => {
      elements.crossValidationThresholdDisplay.textContent = `${e.target.value} %`;
    });
  }
  if (elements.autoSubmitEnabled) {
    elements.autoSubmitEnabled.addEventListener('change', updateBehaviorDependenciesUI);
  }
  if (elements.autoSubmitMinConfidence && elements.autoSubmitMinConfidenceDisplay) {
    elements.autoSubmitMinConfidence.addEventListener('input', (e) => {
      elements.autoSubmitMinConfidenceDisplay.textContent = `${e.target.value} %`;
    });
  }
  if (elements.autoSubmitDelayMs && elements.autoSubmitDelayMsDisplay) {
    elements.autoSubmitDelayMs.addEventListener('input', (e) => {
      elements.autoSubmitDelayMsDisplay.textContent = `${e.target.value} ms`;
    });
  }

  elements.fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
  elements.saveBtn.addEventListener('click', saveSettings);
  elements.resetBtn.addEventListener('click', resetSettings);

  // Gestion du cache des schémas
  if (elements.refreshSchemasBtn) {
    elements.refreshSchemasBtn.addEventListener('click', loadSchemas);
  }
  if (elements.clearAllSchemasBtn) {
    elements.clearAllSchemasBtn.addEventListener('click', handleClearAllSchemas);
  }
}

// Synchroniser manuellement les modèles d'un fournisseur
async function syncProviderModelsUI(id, btn) {
  const originalText = btn ? btn.textContent : 'Modèles';
  if (btn) {
    btn.textContent = 'Sync…';
    btn.disabled = true;
  }

  try {
    const providerKey = String(id || '').toLowerCase();
    const providersMap = getProvidersMap();
    const provider = Object.prototype.hasOwnProperty.call(providersMap, providerKey)
      ? providersMap[providerKey]
      : null;
    if (!provider) {
      showStatus(`Fournisseur inconnu : ${id}.`, 'error');
      return;
    }

    const apiKeyInput = getProviderKeyInput(providerKey, provider);
    const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
    const cfg = readProviderCardConfig(providerKey, provider);

    if (provider.local !== true && !apiKey) {
      showStatus(`Entrez d'abord une clé pour ${provider.name || id}.`, 'error');
      return;
    }
    if (provider.local === true && !cfg.enabled) {
      showStatus(`Cochez d'abord « Activer ce fournisseur local » pour ${provider.name || id}.`, 'error');
      return;
    }
    if (provider.requiresAccountId && !cfg.accountId) {
      showStatus(`Entrez d'abord l'Account ID pour ${provider.name || id}.`, 'error');
      return;
    }
    if (provider.requiresBaseUrl && !cfg.baseUrl) {
      showStatus(`Entrez d'abord l'URL de base pour ${provider.name || id}.`, 'error');
      return;
    }
    if (cfg.baseUrl) {
      const urlCheck = validateProviderBaseUrl(provider, cfg.baseUrl);
      if (!urlCheck.ok) {
        showStatus(urlCheck.reason, 'error');
        if (btn) btn.style.borderColor = 'var(--error-color)';
        return;
      }
    }

    await persistSingleProviderConfig(providerKey);

    if (!window.ModelRegistry || typeof window.ModelRegistry.syncProviderModels !== 'function') {
      showStatus('Registre de modèles indisponible.', 'error');
      return;
    }

    const models = await window.ModelRegistry.syncProviderModels(providerKey, apiKey, cfg, { force: true });
    if (Array.isArray(models) && models.length > 0) {
      syncedModelsByProvider[providerKey] = models;
      const infoEl = document.getElementById(`${providerKey}ModelsInfo`);
      if (infoEl) {
        infoEl.textContent = `${models.length} modèle${models.length > 1 ? 's' : ''} synchronisé${models.length > 1 ? 's' : ''} · défaut : ${provider.defaultTextModel || models[0]?.id || 'auto'}`;
      }
      renderModelOverrides();
      showStatus(`${provider.name || id} : ${models.length} modèle${models.length > 1 ? 's' : ''} chargé${models.length > 1 ? 's' : ''}.`, 'success');
      if (btn) btn.style.borderColor = 'var(--success-color)';
    } else {
      showStatus(`Aucun modèle retourné pour ${provider.name || id}.`, 'error');
      if (btn) btn.style.borderColor = 'var(--error-color)';
    }
  } catch (err) {
    showStatus(`Échec sync ${id} : ${err.message}`, 'error');
    if (btn) btn.style.borderColor = 'var(--error-color)';
  } finally {
    if (btn) {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }
}

// Tester un fournisseur
async function testProvider(id, btn) {
  const originalText = btn.textContent;
  btn.textContent = 'Test…';
  btn.disabled = true;

  try {
    const providerKey = String(id).toLowerCase();
    const providersMap = window.QuizProviders && window.QuizProviders.PROVIDERS;
    const provider = (providersMap && Object.prototype.hasOwnProperty.call(providersMap, providerKey))
      ? providersMap[providerKey]
      : null;
    if (!provider) {
      showStatus(`Fournisseur inconnu : ${id}.`, 'error');
      btn.style.borderColor = 'var(--error-color)';
      return;
    }

    const apiKeyInput = getProviderKeyInput(providerKey, provider) || document.getElementById(`${id}ApiKey`);
    if (provider.local !== true && !apiKeyInput) {
      showStatus(`Champ de clé introuvable pour ${id}.`, 'error');
      btn.style.borderColor = 'var(--error-color)';
      return;
    }

    const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
    const cfg = readProviderCardConfig(providerKey, provider);

    if (provider.local !== true && !apiKey) {
      showStatus(`Entrez d'abord une clé pour ${id}.`, 'error');
      return;
    }
    if (provider.local === true && !cfg.enabled) {
      showStatus(`Cochez d'abord « Activer ce fournisseur local » pour ${provider.name || id}.`, 'error');
      btn.style.borderColor = 'var(--error-color)';
      return;
    }
    if (provider.requiresAccountId && !cfg.accountId) {
      showStatus(`Entrez d'abord l'Account ID pour ${provider.name || id}.`, 'error');
      btn.style.borderColor = 'var(--error-color)';
      return;
    }
    if (provider.requiresBaseUrl && !cfg.baseUrl) {
      showStatus(`Entrez d'abord l'URL de base pour ${provider.name || id}.`, 'error');
      btn.style.borderColor = 'var(--error-color)';
      return;
    }
    if (cfg.baseUrl) {
      const urlCheck = validateProviderBaseUrl(provider, cfg.baseUrl);
      if (!urlCheck.ok) {
        showStatus(urlCheck.reason, 'error');
        btn.style.borderColor = 'var(--error-color)';
        return;
      }
    }

    await persistSingleProviderConfig(providerKey);

    syncVisibleModelInputsIntoState();
    const liveModelInput = elements.modelOverrides
      ? elements.modelOverrides.querySelector(`.model-input[data-provider="${providerKey}"][data-type="text"]`)
      : null;
    const overrideModel = liveModelInput
      ? liveModelInput.value.trim()
      : (typeof customModels[providerKey]?.text === 'string' ? customModels[providerKey].text.trim() : '');
    const model = overrideModel || provider.defaultTextModel || '';
    if (!model) {
      showStatus(`Renseignez d'abord un modèle texte pour ${provider.name || id} (onglet Modèles).`, 'error');
      btn.style.borderColor = 'var(--error-color)';
      return;
    }

    const response = await window.QuizProviders.callProvider(
      providerKey,
      apiKey,
      model,
      "Hello, respond with 'OK' if you see this.",
      [],
      {
        ...cfg,
        providerConfig: cfg,
        providerConfigs: { ...providerConfigs, [providerKey]: cfg }
      }
    );

    if (response) {
      showStatus(`Connexion ${provider.name || id} OK.`, 'success');
      btn.style.borderColor = 'var(--success-color)';

      // DET-01 : Lancement de la synchronisation des modèles en arrière-plan
      if (window.ModelRegistry && typeof window.ModelRegistry.syncProviderModels === 'function') {
        console.log(`Synchronisation des modèles pour ${providerKey}...`);
        window.ModelRegistry.syncProviderModels(providerKey, apiKey, cfg)
          .then((models) => {
            if (Array.isArray(models) && models.length > 0) {
              syncedModelsByProvider[providerKey] = models;
              const infoEl = document.getElementById(`${providerKey}ModelsInfo`);
              if (infoEl) {
                infoEl.textContent = `${models.length} modèle${models.length > 1 ? 's' : ''} synchronisé${models.length > 1 ? 's' : ''} · défaut : ${provider.defaultTextModel || models[0]?.id || 'auto'}`;
              }
              renderModelOverrides();
            }
            console.log(`Synchronisation des modèles terminée pour ${providerKey}`);
          })
          .catch(syncErr => {
            console.warn(`Échec de la synchronisation des modèles pour ${providerKey}:`, syncErr);
          });
      }
    } else {
      throw new Error('Réponse vide');
    }
  } catch (err) {
    showStatus(`Échec ${id} : ${err.message}`, 'error');
    btn.style.borderColor = 'var(--error-color)';
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// Traiter les fichiers
async function handleFiles(files) {
  for (const file of files) {
    try {
      const { text: content, stats } = await readFileWithStats(file);
      if (content && content.trim().length > 0) {
        uploadedFiles.push({
          name: file.name,
          content: content,
          size: file.size,
          type: file.type,
          nlpStats: stats || null
        });
        const pct = stats && stats.reductionRatio > 0
          ? ` (-${Math.round(stats.reductionRatio * 100)}% bruit)`
          : '';
        showStatus(`Fichier ajouté : ${file.name}${pct}`, 'success');
      } else {
        showStatus(`Fichier vide ou illisible : ${file.name}`, 'error');
      }
    } catch (error) {
      console.error(`Erreur lecture ${file.name}:`, error);
      showStatus(`Impossible de lire : ${file.name}`, 'error');
    }
  }
  renderFileList();
}

function readTextFileUTF8(file) {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(typeof e.target.result === 'string' ? e.target.result : '');
    reader.onerror = reject;
    reader.readAsText(file, 'UTF-8');
  });
}

async function readFileWithStats(file) {
  const extension = (file.name.split('.').pop() || '').toLowerCase();
  const cleaner = globalThis.NLPCleaner;
  let rawText = '';

  if (extension === 'pdf') {
    rawText = await extractTextFromPDF(file);
  } else if (extension === 'docx') {
    rawText = await extractTextFromDOCX(file);
  } else {
    rawText = await readTextFileUTF8(file);
    if (extension === 'html' || extension === 'htm') {
      rawText = cleaner && typeof cleaner.extractTextFromHTML === 'function'
        ? cleaner.extractTextFromHTML(rawText)
        : rawText.replace(/<[^>]+>/g, ' ');
    } else if (extension === 'csv') {
      rawText = cleaner && typeof cleaner.parseCSV === 'function'
        ? cleaner.parseCSV(rawText)
        : rawText;
    }
  }

  if (cleaner && typeof cleaner.cleanText === 'function') {
    const isFlatTabular = extension === 'csv';
    return cleaner.cleanText(rawText, {
      dehyphenate: !isFlatTabular,
      stripPagination: !isFlatTabular
    });
  }

  return {
    text: rawText,
    stats: {
      originalChars: rawText.length,
      cleanedChars: rawText.length,
      removedLines: 0,
      reductionRatio: 0
    }
  };
}

async function readFileContent(file) {
  const result = await readFileWithStats(file);
  return result.text;
}

// Extraction PDF via PDF.js
async function extractTextFromPDF(file) {
  let loadingTask = null;
  let pdf = null;
  try {
    const arrayBuffer = await file.arrayBuffer();

    if (typeof pdfjsLib === 'undefined') {
      throw new Error('Bibliothèque PDF.js non chargée');
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

    loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const textContent = await page.getTextContent();
        let pageText = '';
        let prevY = null;

        for (const item of textContent.items) {
          const str = item.str || '';
          const y = Array.isArray(item.transform) ? item.transform[5] : null;
          if (
            pageText.length > 0 &&
            !pageText.endsWith('\n') &&
            prevY !== null &&
            y !== null &&
            Math.abs(y - prevY) > 2
          ) {
            pageText += '\n';
          } else if (
            pageText.length > 0 &&
            !pageText.endsWith('\n') &&
            !pageText.endsWith(' ') &&
            !str.startsWith(' ')
          ) {
            pageText += ' ';
          }
          pageText += str;
          if (item.hasEOL) {
            pageText += '\n';
          }
          if (y !== null) {
            prevY = y;
          }
        }

        fullText += pageText + (i < pdf.numPages ? '\f' : '\n');
      } finally {
        if (page && typeof page.cleanup === 'function') {
          page.cleanup();
        }
      }
    }

    return fullText;
  } catch (error) {
    console.error('Erreur PDF.js:', error);
    throw error;
  } finally {
    if (pdf && typeof pdf.destroy === 'function') {
      try { await pdf.destroy(); } catch { /* ignore PDF cleanup error */ }
    } else if (loadingTask && typeof loadingTask.destroy === 'function') {
      try { await loadingTask.destroy(); } catch { /* ignore loadingTask cleanup error */ }
    }
  }
}

// Extraction DOCX via Mammoth.js
async function extractTextFromDOCX(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();

    if (typeof mammoth === 'undefined') {
      throw new Error('Bibliothèque Mammoth.js non chargée');
    }

    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    return result.value;
  } catch (error) {
    console.error('Erreur Mammoth.js:', error);
    throw error;
  }
}

function renderFileList() {
  elements.fileList.textContent = '';
  uploadedFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file-item';

    const labelWrap = document.createElement('span');
    labelWrap.className = 'file-name';
    labelWrap.textContent = file.name;

    if (file.nlpStats && file.nlpStats.reductionRatio > 0) {
      const statsSpan = document.createElement('span');
      statsSpan.className = 'file-stats';
      statsSpan.textContent = `(-${Math.round(file.nlpStats.reductionRatio * 100)}% bruit)`;
      labelWrap.appendChild(statsSpan);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-file';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      uploadedFiles.splice(index, 1);
      renderFileList();
    });

    item.appendChild(labelWrap);
    item.appendChild(removeBtn);
    elements.fileList.appendChild(item);
  });
}

// Sauvegarder les paramètres
async function saveSettings() {
  syncVisibleModelInputsIntoState();
  const models = {};
  for (const [p, entry] of Object.entries(customModels)) {
    if (!entry || typeof entry !== 'object') continue;
    const textVal = typeof entry.text === 'string' ? entry.text.trim() : '';
    const visionVal = typeof entry.vision === 'string' ? entry.vision.trim() : '';
    if (textVal || visionVal) {
      models[p] = { text: textVal, vision: visionVal };
    }
  }

  const { apiKeyValues, nextProviderConfigs, snapshot } = collectAllProviderFormState();
  const providersMap = getProvidersMap();
  for (const [pKey, pCfg] of Object.entries(nextProviderConfigs)) {
    if (pCfg && pCfg.baseUrl) {
      const check = validateProviderBaseUrl(providersMap[pKey], pCfg.baseUrl);
      if (!check.ok) {
        showStatus(check.reason, 'error');
        return;
      }
    }
  }
  providerConfigs = nextProviderConfigs;
  syncProviderOrder(snapshot);

  const discretionVal = parseInt(elements.discretionSlider.value);
  const discretionStr = discretionIntToString[discretionVal] || 'furtif';

  const domainPreset = elements.domainPreset
    ? normalizeDomainPreset(elements.domainPreset.value)
    : DEFAULT_BEHAVIOR_SETTINGS.domainPreset;
  const customDomainRules = elements.customDomainRules
    ? elements.customDomainRules.value.trim()
    : DEFAULT_BEHAVIOR_SETTINGS.customDomainRules;
  const crossValidationEnabled = elements.crossValidationEnabled
    ? elements.crossValidationEnabled.checked === true
    : DEFAULT_BEHAVIOR_SETTINGS.crossValidationEnabled;
  const crossValidationThreshold = elements.crossValidationThreshold
    ? clampInt(elements.crossValidationThreshold.value, 50, 90, DEFAULT_BEHAVIOR_SETTINGS.crossValidationThreshold)
    : DEFAULT_BEHAVIOR_SETTINGS.crossValidationThreshold;
  const autoSubmitEnabled = elements.autoSubmitEnabled
    ? elements.autoSubmitEnabled.checked === true
    : DEFAULT_BEHAVIOR_SETTINGS.autoSubmitEnabled;
  const autoSubmitMinConfidence = elements.autoSubmitMinConfidence
    ? clampInt(elements.autoSubmitMinConfidence.value, 70, 99, DEFAULT_BEHAVIOR_SETTINGS.autoSubmitMinConfidence)
    : DEFAULT_BEHAVIOR_SETTINGS.autoSubmitMinConfidence;
  const autoSubmitDelayMs = elements.autoSubmitDelayMs
    ? clampInt(elements.autoSubmitDelayMs.value, 800, 5000, DEFAULT_BEHAVIOR_SETTINGS.autoSubmitDelayMs)
    : DEFAULT_BEHAVIOR_SETTINGS.autoSubmitDelayMs;
  const passiveNetworkIntercept = elements.passiveNetworkIntercept
    ? elements.passiveNetworkIntercept.checked === true
    : DEFAULT_BEHAVIOR_SETTINGS.passiveNetworkIntercept;

  try {
    // S1 — Save API keys + provider configs + context files + behavior options to local storage (sécurité)
    await chrome.storage.local.set({
      ...apiKeyValues,
      providerConfigs: nextProviderConfigs,
      serpApiKey: elements.serpApiKey ? elements.serpApiKey.value.trim() : '',
      contextFiles: uploadedFiles,
      domainPreset,
      customDomainRules,
      crossValidationEnabled,
      crossValidationThreshold,
      autoSubmitEnabled,
      autoSubmitMinConfidence,
      autoSubmitDelayMs,
      passiveNetworkIntercept
    });

    // Save non-sensitive UI settings to sync
    await chrome.storage.sync.set({
      captureImages: elements.captureImages.checked,
      imageMinSize: parseInt(elements.imageMinSize.value),
      imageQuality: parseFloat(elements.imageQuality.value),
      providerOrder: providerOrder,
      customModels: models,
      agenticSearch: elements.agenticSearch ? elements.agenticSearch.checked : false,
      autoMode: elements.autoMode ? elements.autoMode.checked : false,
      contextText: elements.contextText.value,
      customQuestionSelector: elements.customQuestionSelector.value,
      customAnswerSelector: elements.customAnswerSelector.value,
      highlightColor: elements.highlightColor.value,
      highlightIntensity: parseFloat(elements.highlightIntensity.value),
      highlightDiscretion: discretionStr,
      showConfidenceBadge: elements.showConfidenceBadge ? elements.showConfidenceBadge.checked : true
    });

    updateApiKeyBadges();
    applyProviderFilters();
    renderPriorityList();
    renderModelOverrides();
    showStatus('Enregistré.', 'success');
  } catch (error) {
    console.error('Erreur sauvegarde:', error);
    showStatus('Échec de l\'enregistrement.', 'error');
  }
}

async function resetSettings() {
  if (confirm('Réinitialiser tous les paramètres ?')) {
    await chrome.storage.sync.clear();
    await chrome.storage.local.remove(Object.keys(DEFAULT_BEHAVIOR_SETTINGS));
    location.reload();
  }
}

function showStatus(message, type) {
  elements.saveStatus.textContent = message;
  elements.saveStatus.className = `save-status ${type}`;
  setTimeout(() => elements.saveStatus.textContent = '', 4000);
}

// Gestion du Cache des Schémas
async function loadSchemas() {
  if (!elements.schemaList) return;
  if (typeof SchemaCache === 'undefined') {
    elements.schemaList.innerHTML = '<p class="help-text">SchemaCache non disponible</p>';
    return;
  }

  try {
    const schemas = await SchemaCache.listCachedSchemas();
    renderSchemaList(schemas);
  } catch (e) {
    elements.schemaList.innerHTML = '<p class="help-text">Erreur de chargement</p>';
  }
}

function renderSchemaList(schemas) {
  if (!elements.schemaList) return;
  elements.schemaList.innerHTML = '';

  if (schemas.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'help-text';
    empty.textContent = 'Aucun site en cache pour l\'instant.';
    elements.schemaList.appendChild(empty);
    return;
  }

  schemas.forEach(schema => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';

    const info = document.createElement('div');
    const confidence = schema.confidence ? ` (${Math.round(schema.confidence * 100)}%)` : '';
    const date = schema.discoveredAt !== 'N/A'
      ? new Date(schema.discoveredAt).toLocaleDateString('fr-FR')
      : '';

    const hostSpan = document.createElement('span');
    hostSpan.className = 'file-name';
    hostSpan.textContent = schema.hostname;
    info.appendChild(hostSpan);

    const detailSpan = document.createElement('span');
    detailSpan.style.fontSize = '0.8em';
    detailSpan.style.opacity = '0.7';
    detailSpan.style.display = 'block';
    detailSpan.textContent = `${schema.platform}${confidence}${date ? ' — ' + date : ''}`;
    info.appendChild(detailSpan);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'remove-file';
    deleteBtn.textContent = '✕';
    deleteBtn.dataset.hostname = schema.hostname;
    deleteBtn.addEventListener('click', () => handleDeleteSchema(schema.hostname));

    item.appendChild(info);
    item.appendChild(deleteBtn);
    elements.schemaList.appendChild(item);
  });
}

async function handleDeleteSchema(hostname) {
  if (typeof SchemaCache === 'undefined') return;
  await SchemaCache.clearSchema(hostname);
  showStatus(`Cache supprimé pour ${hostname}.`, 'success');
  loadSchemas();
}

async function handleClearAllSchemas() {
  if (typeof SchemaCache === 'undefined') return;
  if (!confirm('Supprimer tous les sites en cache ?')) return;
  const count = await SchemaCache.clearAllSchemas();
  showStatus(`${count} site(s) supprimé(s) du cache.`, 'success');
  loadSchemas();
}