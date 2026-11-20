// Service Worker - Background Script
/* global ConfigCache, QuizProviders, handleFetchSerpApi, BackgroundAgent, chrome */

// Charger les modules partagés dans le contexte du service worker
importScripts('providers.js', 'background-agent.js');

// CRIT-05 : Mutex global d'injections en cours par tabId pour éviter la double injection
const _injectionsInProgress = new Map();

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

chrome.commands.onCommand.addListener(async (command) => {
  console.log(`Command received: ${command}`);

  switch (command) {
    case 'toggle-extension':
      await toggleExtension();
      break;

    case 'analyze-quiz':
      const settings = await chrome.storage.sync.get(['enabled', 'model', 'thinkingMode', 'thinkingDepth']);
      if (!settings.enabled) {
        showNotification('Activez d\'abord l\'extension (Alt+Q)');
        return;
      }
      const analyzeSuccess = await broadcastToActiveTabs({
        action: 'analyzeQuiz',
        settings,
        forceFallback: true
      });
      if (!analyzeSuccess) showNotification("Impossible de trouver l'onglet actif pour analyser. Rechargez la page.");
      break;

    case 'toggle-auto-mode':
      await toggleAutoMode();
      break;

    case 'clear-highlights':
      const clearSuccess = await broadcastToActiveTabs({ action: 'clearHighlights' });
      if (clearSuccess) {
        showNotification('Surlignages effacés');
      }
      break;
  }
});

// ──────────────────────────────────────────────
// Toggle Extension
// ──────────────────────────────────────────────

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

  await chrome.storage.sync.set({ enabled: newState });

  const tabs = await chrome.tabs.query({});
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, {
      action: 'toggleExtension',
      enabled: newState
    }).catch((err) => {
      console.warn(`Impossible de notifier l'onglet ${tab.id} de la désactivation :`, err.message);
    });
  });

  showNotification(newState ? 'Extension activée' : 'Extension désactivée');
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
  
  // Notifier tous les onglets du changement de mode automatique
  const tabs = await chrome.tabs.query({});
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, {
      action: 'toggleAutoMode',
      autoMode: newState
    }).catch((err) => {
      console.warn(`Impossible de notifier l'onglet ${tab.id} du mode automatique :`, err.message);
    });
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

  const settings = await chrome.storage.sync.get(['enabled', 'model', 'thinkingMode', 'thinkingDepth']);
  if (!settings.enabled) {
    showNotification('Activez d\'abord l\'extension (Alt+Q)');
    return;
  }

  try {
    await injectCoreScripts(tab.id);
    await chrome.tabs.sendMessage(tab.id, {
      action: 'analyzeQuiz',
      settings,
      forceFallback: true
    });
  } catch (error) {
    console.error(`[analyzeCurrentQuiz] Échec d'envoi du message d'analyse à l'onglet ${tab.id}:`, error);
    showNotification("Impossible d'analyser le quiz. Assurez-vous que la page est entièrement chargée.");
  }
}

// ──────────────────────────────────────────────
// CORS Image Proxy
// ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'injectCoreScripts') {
    const tabId = sender.tab?.id;
    if (tabId) {
      injectCoreScripts(tabId)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
    } else {
      sendResponse({ success: false, error: 'tabId introuvable' });
    }
    return true; // Async response
  }

  if (message.action === 'fetchImage') {
    handleFetchImage(message.url)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Async response
  }
  
  if (message.action === 'fetchLLM') {
    handleFetchLLM(message.url, message.options)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, networkError: true, error: error.message }));
    return true; // Async response
  }
  
  if (message.action === 'fetchSerpApi') {
    handleFetchSerpApi(message.query, message.apiKey)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, networkError: true, error: error.message }));
    return true; // Async response
  }

  // SEC-05 : Charger system.md depuis le SW (hors web_accessible_resources)
  if (message.action === 'loadSystemPrompt') {
    handleLoadSystemPrompt()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Async response
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
    BackgroundAgent.learnFromFeedback(message.feedbackData, message.config)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Async response
  }
});

// ──────────────────────────────────────────────
// PORT-BASED MESSAGING pour les opérations longues (solveQuiz / analyzeDelta)
// Chrome maintient le Service Worker en vie tant qu'un port est ouvert.
// ──────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'solveQuiz') return;

  port.onMessage.addListener((message) => {
    if (message.action === 'solveQuiz' || message.action === 'analyzeDelta') {
      BackgroundAgent.solve(message.task)
        .then(result => {
          try { port.postMessage(result); } catch (_) { /* port fermé côté content */ }
        })
        .catch(error => {
          try {
            port.postMessage({
              success: false,
              answers: [],
              metadata: { questionsTotal: 0, answersFound: 0, totalDurationMs: 0 },
              journal: [],
              error: error.message
            });
          } catch (_) { /* port fermé côté content */ }
        });
    }
  });
});

/**
 * Allowed LLM API hosts — prevents the proxy from being used as an open relay.
 */
const LLM_ALLOWED_HOSTS = [
  'api.groq.com',
  'generativelanguage.googleapis.com',
  'integrate.api.nvidia.com',
  'api.mistral.ai',
  'codestral.mistral.ai',
  'api.anthropic.com'
];

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
    // S5 — Validate URL against allowlist
    const parsedUrl = new URL(url);
    if (!LLM_ALLOWED_HOSTS.includes(parsedUrl.hostname)) {
      console.warn(`⛔ URL bloquée par le proxy LLM: ${parsedUrl.hostname} (${sanitizeUrlForLog(url)})`);
      return { success: false, networkError: true, error: 'URL non autorisée pour le proxy LLM' };
    }

    // Timeout de 120s pour éviter les requêtes infinies (ex: NVIDIA Kimi Thinking)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
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
    console.error("❌ fetchLLM network error:", error);
    return { success: false, networkError: true, error: error.message };
  }
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
    console.error("❌ fetchSerpApi network error:", error);
    if (error.name === 'AbortError') {
      return { success: false, networkError: true, error: 'Timeout: SerpAPI n\'a pas répondu en 30 secondes' };
    }
    return { success: false, networkError: true, error: error.message };
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout image

    let blob, arrayBuffer;
    try {
      // Interdit les redirections 3xx (un redirect externe vers 169.254.169.254 / localhost contournerait le filtre).
      const response = await fetch(url, { signal: controller.signal, redirect: 'error' });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      blob = await response.blob();
      arrayBuffer = await blob.arrayBuffer();
    } finally {
      clearTimeout(timeoutId);
    }

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
    console.error(`❌ Image proxy failed:`, error.message);
    return { success: false, error: error.message };
  }
}

// ──────────────────────────────────────────────
// Notifications
// ──────────────────────────────────────────────

function showNotification(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'Quiz Helper AI',
    message: message
  });
}

// ──────────────────────────────────────────────
// Installation
// ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  // S1 — Migrate API keys from sync to local storage (security)
  const API_KEY_FIELDS = [
    'claudeApiKey', 'geminiApiKey', 'groqApiKey',
    'nvidiaApiKey', 'mistralApiKey'
  ];

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
    // Parent root menu
    chrome.contextMenus.create({
      id: "safe-exm-root",
      title: "🧠 Quiz Helper AI",
      contexts: ["all"]
    });

    // Child menus
    chrome.contextMenus.create({
      id: "cm-analyze-quiz",
      parentId: "safe-exm-root",
      title: "🔍 Analyser le Quiz",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "cm-toggle-extension",
      parentId: "safe-exm-root",
      title: "🔛 Activer/Désactiver l'extension",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "cm-toggle-auto-mode",
      parentId: "safe-exm-root",
      title: "⚡ Activer/Désactiver le Mode Auto",
      contexts: ["all"]
    });
    
    chrome.contextMenus.create({
      id: "cm-clear-highlights",
      parentId: "safe-exm-root",
      title: "🧹 Effacer les surlignages",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "cm-paste-answer",
      parentId: "safe-exm-root",
      title: "📋 Coller la réponse",
      contexts: ["all"]
    });
  } catch (e) {
    console.error("Context Menu Creation Error:", e);
  }
});

// ──────────────────────────────────────────────
// Context Menus Handler
// ──────────────────────────────────────────────
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
      
    case 'cm-clear-highlights':
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'clearHighlights' });
      } catch(e) { /* ignore if content script not loaded */ }
      break;

    case 'cm-paste-answer':
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'pasteAnswer' });
      } catch(e) { /* ignore if content script not loaded */ }
      break;
  }
});