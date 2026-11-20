// ============================================================
// providers.js — Multi-Provider LLM Registry, Smart Switcher & Router
// ============================================================

const ConfigCache = (() => {
  'use strict';

  let _data = {};
  let _initialized = false;
  const _listeners = [];

  const SYNC_KEYS = [
    'captureImages', 'imageMinSize', 'imageQuality',
    'contextText', 'customQuestionSelector', 'customAnswerSelector',
    'highlightColor', 'highlightIntensity', 'highlightDiscretion',
    'providerOrder', 'customModels', 'agenticSearch', 'autoMode', 'enabled'
  ];

  const LOCAL_KEYS = [
    'groqApiKey', 'geminiApiKey', 'nvidiaApiKey',
    'mistralApiKey', 'claudeApiKey',
    'serpApiKey', 'contextFiles'
  ];

  async function init() {
    if (_initialized) {
      return;
    }
    try {
      const [syncData, localData] = await Promise.all([
        chrome.storage.sync.get(SYNC_KEYS),
        chrome.storage.local.get(LOCAL_KEYS)
      ]);
      _data = { ...syncData, ...localData };
      _initialized = true;

      chrome.storage.onChanged.addListener((changes) => {
        for (const [key, { newValue }] of Object.entries(changes)) {
          _data[key] = newValue;
        }
        _listeners.forEach(cb => cb(changes));
      });
    } catch (e) {
      console.error('❌ ConfigCache: Erreur d\'initialisation:', e.message);
    }
  }

  function get(key) {
    return _data[key];
  }

  function getAll() {
    return { ..._data };
  }

  function onChange(cb) {
    if (typeof cb === 'function') {
      _listeners.push(cb);
    }
  }

  return {
    init,
    get,
    getAll,
    onChange,
    isInitialized: () => _initialized
  };
})();

if (typeof window !== 'undefined') {
  window.ConfigCache = ConfigCache;
}

const QuizProviders = (() => {
  'use strict';

  // ──────────────────────────────────────────────
  // Provider Registry
  // ──────────────────────────────────────────────
  const PROVIDERS = {
    groq: {
      name: 'Groq',
      icon: '⚡',
      type: 'openai-compatible',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKeyField: 'groqApiKey',
      textModels: [
        // Contextes vérifiés depuis console.groq.com/docs/models
        { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Rapide)', free: true, contextLimit: 131072 },
        { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Très rapide)', free: true, contextLimit: 131072 },
        { id: 'qwen/qwen3-32b', label: 'Qwen 3 32B', free: true, contextLimit: 131072 },
        { id: 'moonshotai/kimi-k2-instruct-0905', label: 'Kimi k2 Instruct', free: true, contextLimit: 262144 },
      ],
      visionModels: [
        // Scout : 128k effectif sur Groq (limite plateforme) ; modèle nativement multimodal
        { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B Vision', free: true, contextLimit: 131072 },
        // Maverick : 1M théorique, 131k effectif sur Groq
        { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick 17B', free: true, contextLimit: 131072 },
      ],
      defaultTextModel: 'llama-3.3-70b-versatile',
      defaultVisionModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    },

    gemini: {
      name: 'Gemini',
      icon: '💎',
      type: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKeyField: 'geminiApiKey',
      textModels: [
        // Gemini 3.5 / 3.1 / 2.5 et Gemma 4 ouverts gratuits sur l'API Google AI Studio
        { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (Recommandé)', free: true, contextLimit: 1048576 },
        { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite', free: true, contextLimit: 1000000 },
        { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', free: true, contextLimit: 1000000 },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', free: true, contextLimit: 1000000 },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', free: true, contextLimit: 2000000 },
        { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', free: true, contextLimit: 1000000 },
        { id: 'gemma-4-31b-it', label: 'Gemma 4 31B (Raisonnement)', free: true, contextLimit: 262144 },
        { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B (Vitesse)', free: true, contextLimit: 262144 },
        { id: 'gemma-4-12b-it', label: 'Gemma 4 12B', free: true, contextLimit: 262144 },
        { id: 'gemma-4-e4b-it', label: 'Gemma 4 Edge (4B)', free: true, contextLimit: 131072 },
        { id: 'gemma-4-e2b-it', label: 'Gemma 4 Edge (2B)', free: true, contextLimit: 131072 },
      ],
      visionModels: [
        { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (Vision)', free: true, contextLimit: 1048576 },
        { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite (Vision)', free: true, contextLimit: 1000000 },
        { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Vision)', free: true, contextLimit: 1000000 },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Vision)', free: true, contextLimit: 1000000 },
      ],
      defaultTextModel: 'gemma-4-26b-a4b-it',
      defaultVisionModel: 'gemini-3.5-flash',
    },

    nvidia: {
      name: 'NVIDIA NIM',
      icon: '🟢',
      type: 'openai-compatible',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKeyField: 'nvidiaApiKey',
      textModels: [
        // Crédits développeur build.nvidia.com gratuits en permanence pour prototypage
        { id: 'moonshotai/kimi-k2.5', label: 'Kimi k2.5 (Thinking)', free: true, contextLimit: 256000 },
        { id: 'minimaxai/minimax-m2.5', label: 'MiniMax m2.5', free: true, contextLimit: 196608 },
        { id: 'deepseek-ai/deepseek-v3.2', label: 'DeepSeek v3.2', free: true, contextLimit: 128000 },
        { id: 'mistralai/devstral-2-123b-instruct-2512', label: 'Mistral Devstral', free: true, contextLimit: 256000 },
      ],
      visionModels: [
        // Phi-3.5 Vision : 128k tokens (contexte Microsoft officiel)
        { id: 'microsoft/phi-3.5-vision-instruct', label: 'Phi-3.5 Vision', free: true, contextLimit: 128000 },
        { id: 'moonshotai/kimi-k2.5', label: 'Kimi k2.5 Vision', free: true, contextLimit: 256000 },
      ],
      defaultTextModel: 'moonshotai/kimi-k2.5',
      defaultVisionModel: 'microsoft/phi-3.5-vision-instruct',
    },

    mistral: {
      name: 'Mistral',
      icon: '🌀',
      type: 'openai-compatible',
      baseUrl: 'https://api.mistral.ai/v1',
      apiKeyField: 'mistralApiKey',
      textModels: [
        { id: 'mistral-small-latest', label: 'Mistral Small 4 (Rapide)', free: false, contextLimit: 256000 },
        { id: 'mistral-large-latest', label: 'Mistral Large 3 (Flagship)', free: false, contextLimit: 262144 },
        { id: 'codestral-latest', label: 'Codestral (Code & FIM)', free: false, contextLimit: 262144 },
      ],
      visionModels: [
        { id: 'mistral-small-latest', label: 'Mistral Small 4 Vision', free: false, contextLimit: 256000 },
        { id: 'mistral-large-latest', label: 'Mistral Large 3 Vision', free: false, contextLimit: 262144 },
      ],
      defaultTextModel: 'mistral-small-latest',
      defaultVisionModel: 'mistral-small-latest',
    },

    claude: {
      name: 'Claude',
      icon: '🟣',
      type: 'claude',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKeyField: 'claudeApiKey',
      textModels: [
        { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (Recommandé)', free: false, contextLimit: 1000000 },
        { id: 'claude-fable-5', label: 'Claude Fable 5 (Raisonnement)', free: false, contextLimit: 1000000 },
        { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (Flagship)', free: false, contextLimit: 1000000 },
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Legacy)', free: false, contextLimit: 200000 },
      ],
      visionModels: [
        { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 Vision', free: false, contextLimit: 1000000 },
        { id: 'claude-fable-5', label: 'Claude Fable 5 Vision', free: false, contextLimit: 1000000 },
        { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 Vision', free: false, contextLimit: 1000000 },
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet Vision', free: false, contextLimit: 200000 },
      ],
      defaultTextModel: 'claude-sonnet-5',
      defaultVisionModel: 'claude-sonnet-5',
    },
  };

  // Default provider priority (free-first)
  const DEFAULT_PRIORITY = ['groq', 'gemini', 'nvidia', 'mistral', 'claude'];

  // Cache synchrone en mémoire : Map<`${providerKey}:${modelId}`, contextWindow>
  // Alimenté statiquement au démarrage et mis à jour après une sync dynamique (ModelRegistry).
  // Invariant : toujours retourne une valeur >= 1000 depuis getModelContextLimit.
  const _contextWindowCache = new Map();

  // ── NOTE : _initStaticContextCache() est appelée juste avant le return du module.
  //           Le bloc ci-dessus (void) était un placeholder provisoire — supprimé.

  /**
   * Initialise le cache synchrone depuis PROVIDERS (données statiques).
   * Doit être appelée une fois après la déclaration de PROVIDERS.
   * Invariant de postcondition : _contextWindowCache contient au moins 1 entrée par provider.
   */
  function _initStaticContextCache() {
    for (const [pKey, pDef] of Object.entries(PROVIDERS)) {
      const allModels = [...(pDef.textModels || []), ...(pDef.visionModels || [])];
      for (const m of allModels) {
        if (m.id && m.contextLimit) {
          _contextWindowCache.set(`${pKey}:${m.id}`, m.contextLimit);
        }
      }
    }
  }

  /**
   * Met à jour le cache synchrone depuis des données dynamiques (résultat de ModelRegistry).
   * Appelée après une synchronisation réussie via ModelRegistry.syncProviderModels().
   * Invariant : ne lève jamais d'exception.
   * @param {string} providerKey
   * @param {Array<{id: string, contextWindow: number}>} models
   */
  function warmContextCache(providerKey, models) {
    if (!Array.isArray(models)) return;
    for (const m of models) {
      if (m.id && m.contextWindow > 0) {
        _contextWindowCache.set(`${providerKey}:${m.id}`, m.contextWindow);
      }
    }
    console.log(`🔥 warmContextCache [${providerKey}]: ${models.length} entrées chargées.`);
  }

  /**
   * Helper to fetch the actual context limit for a specific provider & model.
   * Consulte d'abord le cache synchrone en mémoire (alimenté par données statiques
   * ou dynamiques via warmContextCache), puis fallback sur PROVIDERS statique.
   * Invariant de postcondition : retourne toujours un entier >= 1000.
   * @param {string} providerKey
   * @param {string} modelId
   * @returns {number}
   */
  function getModelContextLimit(providerKey, modelId) {
    // 1. Consulter le cache synchrone en mémoire (le plus à jour)
    const cacheKey = `${providerKey}:${modelId}`;
    if (_contextWindowCache.has(cacheKey)) {
      return _contextWindowCache.get(cacheKey);
    }

    // 2. Fallback sur les données statiques de PROVIDERS
    const provider = PROVIDERS[providerKey];
    if (!provider) return 100000;

    const modelObj = [...(provider.textModels || []), ...(provider.visionModels || [])]
      .find(m => m.id === modelId);

    return (modelObj && modelObj.contextLimit) ? modelObj.contextLimit : 100000;
  }

  /**
   * Helper to find the first provider in priority list that has an API key configured.
   */
  function getFirstConfiguredProvider(syncConfig, order) {
    for (const pKey of order) {
      const provider = PROVIDERS[pKey];
      if (provider && syncConfig[provider.apiKeyField] && syncConfig[provider.apiKeyField].length > 0) {
        return pKey;
      }
    }
    return order[0]; // fallback
  }

  // ──────────────────────────────────────────────
  // Intelligent Text ↔ Vision Switcher
  // ──────────────────────────────────────────────

  /**
   * Select the correct model for the given context.
   * When images are present, use the vision model; otherwise text model.
   */
  function getModelForContext(providerKey, hasImages, overrides = {}) {
    // Règle 8.5 : assertions de préconditions
    if (typeof providerKey !== 'string') {
      throw new Error('L\'argument providerKey doit être une chaîne de caractères.');
    }
    if (typeof hasImages !== 'boolean') {
      throw new Error('L\'argument hasImages doit être un booléen.');
    }

    const provider = PROVIDERS[providerKey];
    if (!provider) throw new Error(`Provider inconnu: ${providerKey}`);

    if (hasImages) {
      return overrides[`${providerKey}_visionModel`] || provider.defaultVisionModel;
    }
    return overrides[`${providerKey}_textModel`] || provider.defaultTextModel;
  }

  // ──────────────────────────────────────────────
  // Unified API Callers
  // ──────────────────────────────────────────────

  /**
   * Fetch wrapper that routes requests based on execution context:
   * - Service Worker : fetch() direct (pas de CORS dans le SW)
   * - Content Script / Popup : proxy via chrome.runtime.sendMessage → background fetchLLM
   * - Hors extension : fetch() direct avec timeout
   */
  async function extensionFetch(url, options) {
    // Règle 8.5 : assertions de préconditions
    if (typeof url !== 'string' || !url.startsWith('http')) {
      throw new Error('L\'argument url doit être une chaîne de caractères valide commençant par http.');
    }

    // Détection du contexte Service Worker : on peut fetch() directement sans proxy
    // car le SW n'a pas de restrictions CORS (contrairement aux content scripts).
    // Envoyer sendMessage() du SW vers lui-même provoque "message port closed".
    const isServiceWorker = typeof ServiceWorkerGlobalScope !== 'undefined' &&
      self instanceof ServiceWorkerGlobalScope;

    if (isServiceWorker) {
      return _directFetchWithTimeout(url, options, 120000);
    }

    // Content script / Popup : proxy via le background service worker
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'fetchLLM', url, options }, (response) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (!response) {
            return reject(new Error('Pas de réponse du proxy'));
          }
          if (response.networkError || response.success === false) {
            return reject(new Error(response.error || 'Erreur proxy LLM'));
          }

          // Mock fetch response object
          resolve({
            ok: response.ok,
            status: response.status,
            json: async () => response.data
          });
        });
      });
    }

    // Fallback hors extension
    return _directFetchWithTimeout(url, options, 120000);
  }

  /**
   * Helper interne : fetch() avec timeout explicite et AbortSignal.
   * Utilisé par le Service Worker et le fallback hors extension.
   * Invariant : retourne un objet Response natif ou lève une erreur.
   * @param {string} url
   * @param {Object} options
   * @param {number} timeoutMs
   * @returns {Promise<Response>}
   */
  function _sanitizeUrl(url) {
    try {
      const u = new URL(url);
      if (u.username) u.username = '***';
      if (u.password) u.password = '***';
      if (u.hash) u.hash = '#***';
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

  async function _directFetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.warn(`⏱️ extensionFetch timeout (${timeoutMs}ms) sur l'URL : ${_sanitizeUrl(url).substring(0, 80)}...`);
    }, timeoutMs);

    // Fusionner le signal externe (si fourni) avec notre timeout
    const externalSignal = options?.signal;
    if (externalSignal && externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new Error('Requête annulée avant envoi (signal externe).');
    }

    // Écouter l'abort externe pour propager au controller interne
    let externalAbortHandler = null;
    if (externalSignal) {
      externalAbortHandler = () => controller.abort();
      externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }

    try {
      // Retirer le signal externe des options, on utilise notre controller unifié
      const { signal: _ignoredSignal, ...restOptions } = options || {};
      const response = await fetch(url, { ...restOptions, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        // Distinguer timeout interne vs annulation externe
        if (externalSignal && externalSignal.aborted) {
          throw new Error('Requête annulée par le signal externe.');
        }
        throw new Error(`La requête réseau a expiré après ${timeoutMs / 1000} secondes.`);
      }
      throw error;
    } finally {
      if (externalSignal && externalAbortHandler) {
        externalSignal.removeEventListener('abort', externalAbortHandler);
      }
    }
  }

  /**
   * Build OpenAI-compatible messages array with optional images
   */
  function buildOpenAIMessages(prompt, images = []) {
    const systemPrompt = (typeof prompt === 'object' && prompt.system) ? prompt.system : null;
    const userPrompt = (typeof prompt === 'object' && prompt.user) ? prompt.user : (typeof prompt === 'string' ? prompt : '');

    const msgs = [];
    if (systemPrompt) {
      msgs.push({ role: 'system', content: systemPrompt });
    }

    if (images.length === 0) {
      msgs.push({ role: 'user', content: userPrompt });
      return msgs;
    }

    // Multimodal message with text + images
    const contentParts = [{ type: 'text', text: userPrompt }];
    images.forEach(img => {
      contentParts.push({
        type: 'image_url',
        image_url: {
          url: img.dataUrl, // data:image/jpeg;base64,...
          detail: 'auto'
        }
      });
    });

    msgs.push({ role: 'user', content: contentParts });
    return msgs;
  }

  /**
   * Call any OpenAI-compatible endpoint (Groq, NVIDIA, Fireworks, Mistral)
   */
  async function callOpenAICompatible(providerKey, apiKey, model, prompt, images = [], extraConfig = {}) {
    const provider = PROVIDERS[providerKey];
    let messages;
    let extraBodyParams = {};

    // Specific formatting for NVIDIA Vision (all NV vision models prefer this)
    const isNvidia = providerKey === 'nvidia';
    if (isNvidia && images.length > 0) {
      const systemPrompt = (typeof prompt === 'object' && prompt.system) ? prompt.system : null;
      const userPrompt = (typeof prompt === 'object' && prompt.user) ? prompt.user : (typeof prompt === 'string' ? prompt : '');
      const imgTags = images.map(img => `<img src="${img.dataUrl}" />`).join(' ');

      messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({
        role: 'user',
        content: `${userPrompt}\n${imgTags}`
      });
    } else {
      messages = buildOpenAIMessages(prompt, images);
    }

    // Configuration du thinking pour les providers OpenAI-compatibles
    if (extraConfig.thinking?.enabled) {
      if (providerKey === 'groq') {
        // Groq en 2026 supporte include_reasoning et reasoning_format: 'parsed'
        extraBodyParams.include_reasoning = true;
        extraBodyParams.reasoning_format = 'parsed';
        extraBodyParams.reasoning_effort = extraConfig.thinking.effort || 'high';
      } else if (providerKey === 'nvidia') {
        // NVIDIA NIM requiert chat_template_kwargs pour activer le thinking sur les modèles de raisonnement
        extraBodyParams.chat_template_kwargs = { enable_thinking: true, thinking: true };
        extraBodyParams.reasoning_effort = extraConfig.thinking.effort || 'high';
      } else {
        // Paramètre de raisonnement générique OpenAI (ex: o1, o3-mini, deepseek, etc.)
        const lowerModel = model.toLowerCase();
        const isReasoningModel = lowerModel.includes('kimi') ||
          lowerModel.includes('deepseek') ||
          lowerModel.includes('scout') ||
          lowerModel.includes('maverick') ||
          lowerModel.includes('devstral') ||
          lowerModel.includes('reasoning');
        if (isReasoningModel) {
          extraBodyParams.reasoning_effort = extraConfig.thinking.effort || 'high';
        }
      }
    } else {
      if (providerKey === 'groq') {
        extraBodyParams.include_reasoning = false;
      }
    }

    console.log(`🔗 [${provider.name}] Appel ${model}...`);

    // Adjust token limit: Vision models (like Phi) often have lower output limits than reasoning models
    let defaultMaxTokens = 4096;
    if (providerKey === 'nvidia') {
      defaultMaxTokens = (model.includes('phi')) ? 4096 : 16384;
    }

    const payload = {
      model: model,
      messages: messages,
      max_tokens: extraConfig.maxTokens || defaultMaxTokens,
      temperature: extraConfig.thinking?.enabled ? undefined : 0.3, // OpenAI interdit temperature/top_p pour certains modèles de raisonnement (ex: o1)
      stream: false,
      ...extraBodyParams
    };

    // Routage vers l'endpoint personnalisé pour Codestral si requis
    let targetBaseUrl = provider ? provider.baseUrl : '';
    if (providerKey === 'mistral' && model.toLowerCase().includes('codestral')) {
      targetBaseUrl = 'https://codestral.mistral.ai/v1';
      console.log(`✨ Redirection transparente de Codestral vers son endpoint personnalisé : ${targetBaseUrl}`);
    }

    const response = await extensionFetch(`${targetBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) || {};
      const errorDetail = errorData.error?.message || errorData.detail || (Object.keys(errorData).length > 0 ? JSON.stringify(errorData) : '');
      const error = new Error(errorDetail ? `Erreur ${provider.name}: ${errorDetail}` : `Erreur ${provider.name}: Code HTTP ${response.status}`);
      error.status = response.status;
      error.providerName = provider.name;
      throw error;
    }

    const data = await response.json();
    console.log(`✅ [${provider.name}] Réponse reçue`);

    const choice = data.choices?.[0];
    let outputText = choice?.message?.content || '';
    let thinkingText = choice?.message?.reasoning_content || '';

    // Extraction robuste en cas de balisage <think>...</think> dans le texte de réponse brute (ex: DeepSeek-R1)
    if (outputText.includes('<think>')) {
      const thinkStart = outputText.indexOf('<think>');
      const thinkEnd = outputText.indexOf('</think>');
      if (thinkStart !== -1 && thinkEnd !== -1) {
        thinkingText = outputText.substring(thinkStart + 7, thinkEnd).trim();
        outputText = (outputText.substring(0, thinkStart) + outputText.substring(thinkEnd + 8)).trim();
      }
    }

    if (thinkingText) {
      console.log(`💭 [${provider.name} Thoughts]:\n${thinkingText}`);
    }

    return outputText || '';
  }

  async function callClaudeProvider(apiKey, model, prompt, images = [], maxTokens = 4096, thinkingConfig = null) {
    console.log(`🟣 [Claude] Appel ${model}...`);

    const systemPrompt = (typeof prompt === 'object' && prompt.system) ? prompt.system : null;
    const userPrompt = (typeof prompt === 'object' && prompt.user) ? prompt.user : (typeof prompt === 'string' ? prompt : '');

    // Build content blocks
    const contentBlocks = [];

    // Add images first
    images.forEach(img => {
      const base64Data = img.dataUrl.split(',')[1]; // Remove data:image/...;base64, prefix
      const mediaType = img.mimeType || 'image/jpeg';
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64Data,
        }
      });
    });

    // Add text prompt
    contentBlocks.push({ type: 'text', text: userPrompt });

    const requestBody = {
      model: model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: contentBlocks }]
    };

    if (systemPrompt) {
      requestBody.system = systemPrompt;
    }

    // Détection de la génération du modèle Claude (Claude 5+ ou Opus 4.8+)
    const isClaude5OrOpus48 = model.includes('claude-sonnet-5') ||
      model.includes('claude-fable-5') ||
      model.includes('claude-opus-4-8');

    if (thinkingConfig?.enabled) {
      if (isClaude5OrOpus48) {
        // En 2026, Claude 5+ utilise le mode adaptive thinking avec effort dans output_config
        requestBody.thinking = {
          type: 'adaptive',
          display: 'summarized' // Permet d'obtenir le flux de pensée dans le stream/JSON
        };
        requestBody.output_config = {
          effort: thinkingConfig.effort || 'high'
        };
        // CRITICAL : la température et l'échantillonnage ne doivent pas être définis avec le thinking actif
        // (ils causeraient une erreur 400 s'ils étaient passés en arguments).
      } else {
        // Fallback legacy pour les modèles plus anciens comme Claude 3.5 Sonnet
        requestBody.thinking = {
          type: 'enabled',
          budget_tokens: thinkingConfig.depth || 10000
        };
        requestBody.temperature = 1.0; // Spécification Anthropic pour le mode thinking legacy
      }
    } else {
      // Mode standard (sans thinking)
      requestBody.temperature = 0.3;
    }

    const response = await extensionFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error?.message || `Erreur Claude: ${response.status}`);
      error.status = response.status;
      error.providerName = 'Claude';
      throw error;
    }

    const data = await response.json();
    console.log(`✅ [Claude] Réponse reçue`);

    // Séparation et extraction du flux de pensée (thinking) et du texte final
    const content = data.content || [];
    let outputText = '';
    let thinkingText = '';

    for (const block of content) {
      if (block.type === 'thinking') {
        thinkingText += block.thinking || '';
      } else if (block.type === 'text') {
        outputText += block.text || '';
      }
    }

    if (thinkingText) {
      console.log(`💭 [Claude Thoughts]:\n${thinkingText}`);
    }

    return outputText || '';
  }

  /**
   * Call Gemini API (Google-specific format)
   */
  async function callGeminiProvider(apiKey, model, prompt, images = [], maxTokens = 2048, thinkingConfig = null) {
    console.log(`💎 [Gemini] Appel ${model}...`);

    const systemPrompt = (typeof prompt === 'object' && prompt.system) ? prompt.system : null;
    const userPrompt = (typeof prompt === 'object' && prompt.user) ? prompt.user : (typeof prompt === 'string' ? prompt : '');

    const parts = [];

    // Add images
    images.forEach(img => {
      const base64Data = img.dataUrl.split(',')[1];
      const mimeType = img.mimeType || 'image/jpeg';
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      });
    });

    // Add text
    parts.push({ text: userPrompt });

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const generationConfig = {
      temperature: 0.3,
      maxOutputTokens: maxTokens,
      topP: 0.8,
      topK: 40
    };

    // Détection de la génération du modèle Gemini (Gemini 3+ et Gemma 4)
    const isGemini3PlusOrGemma4 = model.includes('gemini-3') || model.includes('gemma-4');

    // Add thinking configuration if enabled
    if (thinkingConfig?.enabled) {
      if (isGemini3PlusOrGemma4) {
        // En 2026, Gemini 3+ utilise thinkingLevel
        generationConfig.thinkingConfig = {
          thinkingLevel: thinkingConfig.level || 'HIGH'
        };
      } else {
        // Gemini 2.5 utilise thinkingBudget
        generationConfig.thinkingConfig = {
          includeThoughts: true,
          thinkingBudget: thinkingConfig.depth || -1
        };
      }
    }

    const requestPayload = {
      contents: [{ parts }],
      generationConfig: generationConfig
    };

    if (systemPrompt) {
      requestPayload.systemInstruction = {
        parts: [{ text: systemPrompt }]
      };
    }

    const response = await extensionFetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error?.message || `Erreur Gemini: ${response.status}`);
      error.status = response.status;
      error.providerName = 'Gemini';
      throw error;
    }

    const data = await response.json();
    console.log(`✅ [Gemini] Réponse reçue`);

    // Séparation et extraction du flux de pensée et du texte de réponse
    const responseParts = data.candidates?.[0]?.content?.parts || [];
    let outputText = '';
    let thinkingText = '';

    for (const part of responseParts) {
      if (part.thought === true) {
        thinkingText += part.text || '';
      } else {
        outputText += part.text || '';
      }
    }

    if (thinkingText) {
      console.log(`💭 [Gemini Thoughts]:\n${thinkingText}`);
    }

    return outputText || '';
  }

  // ──────────────────────────────────────────────
  // Call dispatcher
  // ──────────────────────────────────────────────

  /**
   * Route a call to the correct provider-specific function.
   */
  async function callProvider(providerKey, apiKey, model, prompt, images = [], extraConfig = {}) {
    // Règle 8.5 : assertions de préconditions
    if (typeof providerKey !== 'string' || typeof apiKey !== 'string' || typeof model !== 'string' ||
      (typeof prompt !== 'string' && (typeof prompt !== 'object' || !prompt || !prompt.user))) {
      throw new Error('Arguments obligatoires manquants ou invalides dans callProvider (providerKey, apiKey, model, prompt).');
    }
    if (!Array.isArray(images)) {
      throw new Error('L\'argument images doit être un tableau.');
    }

    // Force lowercase for registry lookup but keep original for logging or error messages
    const normalizedKey = providerKey.toLowerCase();
    const provider = PROVIDERS[normalizedKey];
    if (!provider) throw new Error(`Provider inconnu: ${providerKey}`);

    switch (provider.type) {
      case 'openai-compatible':
        return await callOpenAICompatible(providerKey, apiKey, model, prompt, images, extraConfig);
      case 'claude':
        return await callClaudeProvider(apiKey, model, prompt, images, extraConfig.maxTokens, extraConfig.thinking);
      case 'gemini':
        return await callGeminiProvider(apiKey, model, prompt, images, extraConfig.maxTokens, extraConfig.thinking);
      default:
        throw new Error(`Type de provider inconnu: ${provider.type}`);
    }
  }

  // ──────────────────────────────────────────────
  // Smart Quota Router
  // ──────────────────────────────────────────────

  /**
   * Check if an error is a quota/rate-limit error.
   */
  function isQuotaError(error) {
    if (error.status === 429) return true;
    const msg = (error.message || '').toLowerCase();
    return msg.includes('rate limit') ||
      msg.includes('quota') ||
      msg.includes('exceeded') ||
      msg.includes('too many requests') ||
      msg.includes('resource_exhausted');
  }

  /**
   * Smart Router: tries providers in priority order.
   * Auto-switches text model ↔ vision model if images are present.
   * Auto-failovers to next provider on quota exhaustion (429).
   *
   * @param {string} prompt - The text prompt
   * @param {Array} images - Array of { dataUrl, mimeType } objects
   * @param {Object} apiKeys - Map of provider apiKeyField → key value
   * @param {Array} priority - Ordered array of provider keys
   * @param {Object} modelOverrides - Optional model ID overrides per provider
   * @param {Object} extraConfig - { maxTokens, thinking: { enabled, depth } }
   * @returns {{ text: string, provider: string, model: string }}
   */
  async function smartRoute(prompt, images = [], apiKeys = {}, priority = null, modelOverrides = {}, extraConfig = {}) {
    // Règle 8.5 : assertions de préconditions
    if (typeof prompt !== 'string' && (typeof prompt !== 'object' || !prompt || !prompt.user)) {
      throw new Error('L\'argument prompt doit être une chaîne de caractères ou un objet avec une propriété "user".');
    }
    if (!Array.isArray(images)) {
      throw new Error('L\'argument images doit être un tableau.');
    }

    const orderedProviders = priority || DEFAULT_PRIORITY;
    const hasImages = images.length > 0;
    const triedProviders = [];

    console.log(`🧠 Smart Router: ${hasImages ? '🖼️ Mode Vision' : '📝 Mode Texte'}, ${orderedProviders.length} providers disponibles`);

    for (const providerKey of orderedProviders) {
      const provider = PROVIDERS[providerKey];
      if (!provider) continue;

      const apiKey = apiKeys[provider.apiKeyField];
      if (!apiKey) {
        console.log(`   ⏭️ ${provider.name}: pas de clé API`);
        continue;
      }

      const model = getModelForContext(providerKey, hasImages, modelOverrides);
      console.log(`   🔄 Essai ${provider.icon} ${provider.name} → ${model}`);

      try {
        const text = await callProvider(providerKey, apiKey, model, prompt, images, extraConfig);
        console.log(`   ✅ ${provider.name} a répondu avec succès!`);
        return { text, provider: providerKey, providerName: provider.name, model };
      } catch (error) {
        console.warn(`   ⚠️ ${provider.name} (Modèle principal ${model}) a échoué: ${error.message}`);

        // Tentative de fallback interne sur les modèles alternatifs du même provider
        const altModels = (hasImages ? (provider.visionModels || []) : (provider.textModels || []))
          .filter(m => m.id !== model);

        let successWithAlt = false;
        let altText = '';
        let altModelUsed = '';

        if (altModels.length > 0) {
          console.log(`   🔄 Tentative de repli sur les modèles alternatifs de ${provider.name} (${altModels.length} disponibles)...`);
          for (const altModel of altModels) {
            console.log(`     🔄 Essai modèle alternatif → ${altModel.id}`);
            try {
              altText = await callProvider(providerKey, apiKey, altModel.id, prompt, images, extraConfig);
              console.log(`     ✅ Succès avec le modèle alternatif ${altModel.id}!`);
              successWithAlt = true;
              altModelUsed = altModel.id;
              break;
            } catch (altError) {
              console.warn(`     ❌ Échec du modèle alternatif ${altModel.id}: ${altError.message}`);
            }
          }
        }

        if (successWithAlt) {
          return { text: altText, provider: providerKey, providerName: provider.name, model: altModelUsed };
        }

        triedProviders.push(provider.name);
        const isForcedSelection = priority && priority.length > 0 && priority[0] === providerKey;

        if (isQuotaError(error)) {
          console.warn(`   ⚠️ ${provider.name}: quota épuisé (tous les modèles ont échoué), passage au suivant...`);
          continue;
        }

        if (isForcedSelection) {
          console.error(`   ❌ ${provider.name} (Forcé, tous les modèles ont échoué): ${error.message}`);
          throw error; // Arrêt si choix forcé par l'utilisateur
        }

        // Non-quota error on non-forced provider: log but continue trying
        console.error(`   ❌ ${provider.name} (tous les modèles ont échoué): ${error.message}`);
        continue;
      }
    }

    throw new Error(
      `Tous les providers ont échoué.\nEssayés: ${triedProviders.join(', ') || 'aucun (pas de clés API configurées)'}\nConfigurez vos clés API dans les paramètres.`
    );
  }

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  /**
   * Get all API key storage field names from the provider registry.
   */
  function getAllApiKeyFields() {
    return Object.values(PROVIDERS).map(p => p.apiKeyField);
  }

  // Initialise le cache synchrone depuis les données PROVIDERS (données statiques vérifiées)
  _initStaticContextCache();

  // ──────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────

  return {
    PROVIDERS,
    DEFAULT_PRIORITY,
    getModelForContext,
    getModelContextLimit,
    warmContextCache,
    getFirstConfiguredProvider,
    callProvider,
    smartRoute,
    isQuotaError,
    buildOpenAIMessages,
    getAllApiKeyFields,
    extensionFetch,
  };
})();

// Export for content script usage
if (typeof window !== 'undefined') {
  window.QuizProviders = QuizProviders;
}

// ============================================================
// ModelRegistry — Découverte Dynamique des Modèles (Grand Chantier 1)
// Stratégie :
//   - Gemini  : endpoint natif /v1beta/models (inputTokenLimit, supportedGenerationMethods)
//   - Mistral : endpoint natif /v1/models (max_context_length, capabilities.vision)
//   - Claude  : endpoint natif /v1/models (max_input_tokens, capabilities)
//   - Groq / NVIDIA / Fireworks : pas de métadonnées dans le /models OAI basique
//     → on utilise les données statiques de PROVIDERS (déjà corrigées)
//
// Invariant : si la synchronisation échoue, le système reste opérationnel
//             via le fallback sur les données statiques de PROVIDERS.
// ============================================================
const ModelRegistry = (() => {
  'use strict';

  const CACHE_KEY = 'modelMetadataCache';
  // TTL de 24h en millisecondes
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  /**
   * Retourne le cache stocké dans chrome.storage.local.
   * Invariant de postcondition : retourne toujours un objet (jamais null/undefined).
   * @returns {Promise<Object>}
   */
  async function _loadCache() {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return {};
    }
    try {
      const result = await chrome.storage.local.get(CACHE_KEY);
      return result[CACHE_KEY] || {};
    } catch (e) {
      console.warn('⚠️ ModelRegistry: impossible de lire le cache:', e.message);
      return {};
    }
  }

  /**
   * Persiste le cache dans chrome.storage.local.
   * @param {Object} cache
   */
  async function _saveCache(cache) {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return;
    }
    try {
      await chrome.storage.local.set({ [CACHE_KEY]: cache });
    } catch (e) {
      console.warn('⚠️ ModelRegistry: impossible de sauvegarder le cache:', e.message);
    }
  }

  /**
   * Vérifie si le cache pour un provider est encore valide (< 24h).
   * Invariant : retourne false si lastSync est absent ou expiré.
   * @param {Object} cache
   * @param {string} providerKey
   * @returns {boolean}
   */
  function _isCacheValid(cache, providerKey) {
    const entry = cache[providerKey];
    if (!entry || !entry.lastSync || !Array.isArray(entry.models)) {
      return false;
    }
    return (Date.now() - entry.lastSync) < CACHE_TTL_MS;
  }

  /**
   * Découverte dynamique pour Gemini.
   * L'API /v1beta/models retourne inputTokenLimit et supportedGenerationMethods.
   * @param {string} apiKey
   * @returns {Promise<Array|null>}
   */
  async function _fetchGeminiModels(apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await QuizProviders.extensionFetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) {
        console.warn(`⚠️ ModelRegistry Gemini: HTTP ${resp.status}`);
        return null;
      }
      const data = await resp.json();
      if (!Array.isArray(data.models)) {
        return null;
      }
      return data.models
        .filter(m => m.name && m.inputTokenLimit)
        .map(m => {
          const id = m.name.replace('models/', '');
          // Un modèle supporte la vision si generateContent est dans ses méthodes supportées
          // et si la description ou le displayName mentionne la vision ou multimodal.
          // En 2025+, tous les modèles Gemini Flash/Pro supportent la vision.
          const supportsVision = (m.supportedGenerationMethods || []).includes('generateContent');
          return {
            id,
            label: m.displayName || id,
            contextWindow: m.inputTokenLimit,
            maxOutputTokens: m.outputTokenLimit || 8192,
            vision: supportsVision,
            free: true
          };
        });
    } catch (e) {
      clearTimeout(timer);
      if (e.name !== 'AbortError') {
        console.warn(`⚠️ ModelRegistry Gemini: erreur fetch - ${e.message}`);
      }
      return null;
    }
  }

  /**
   * Découverte dynamique pour Mistral.
   * L'API /v1/models retourne max_context_length et capabilities.vision.
   * Gère le fallback vers l'endpoint dédié de Codestral si la clé API y est restreinte.
   * @param {string} apiKey
   * @returns {Promise<Array|null>}
   */
  async function _fetchMistralModels(apiKey) {
    const urls = [
      'https://api.mistral.ai/v1/models',
      'https://codestral.mistral.ai/v1/models'
    ];

    for (const url of urls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const resp = await QuizProviders.extensionFetch(url, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: controller.signal
        });
        clearTimeout(timer);
        if (resp.status === 401 || resp.status === 403) {
          console.warn(`⚠️ ModelRegistry Mistral [${new URL(url).origin}]: HTTP ${resp.status}, tentative de l'autre endpoint...`);
          continue; // Tente le suivant (ex: codestral)
        }
        if (!resp.ok) {
          console.warn(`⚠️ ModelRegistry Mistral [${new URL(url).origin}]: HTTP ${resp.status}`);
          continue;
        }
        const data = await resp.json();
        const items = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : null);
        if (!items) continue;
        return items
          .filter(m => m.id && m.max_context_length)
          .map(m => ({
            id: m.id,
            label: m.name || m.id,
            contextWindow: m.max_context_length,
            maxOutputTokens: m.max_context_length,
            vision: m.capabilities?.vision === true,
            free: false
          }));
      } catch (e) {
        clearTimeout(timer);
        if (e.name !== 'AbortError') {
          console.warn(`⚠️ ModelRegistry Mistral [${new URL(url).origin}]: erreur fetch - ${e.message}`);
        }
      }
    }
    return null;
  }

  /**
   * Découverte dynamique pour Claude (Anthropic).
   * L'API /v1/models retourne max_input_tokens et capabilities.
   * Nécessite l'en-tête anthropic-dangerous-direct-browser-access pour le contexte browser.
   * @param {string} apiKey
   * @returns {Promise<Array|null>}
   */
  async function _fetchClaudeModels(apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await QuizProviders.extensionFetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!resp.ok) {
        console.warn(`⚠️ ModelRegistry Claude: HTTP ${resp.status}`);
        return null;
      }
      const data = await resp.json();
      const items = Array.isArray(data.data) ? data.data : null;
      if (!items) return null;
      return items
        .filter(m => m.id && m.max_input_tokens)
        .map(m => ({
          id: m.id,
          label: m.display_name || m.id,
          contextWindow: m.max_input_tokens,
          maxOutputTokens: m.max_output_tokens || 8192,
          // image_input est le flag de vision dans l'API Claude
          vision: m.capabilities?.image_input === true,
          free: false
        }));
    } catch (e) {
      clearTimeout(timer);
      if (e.name !== 'AbortError') {
        console.warn(`⚠️ ModelRegistry Claude: erreur fetch - ${e.message}`);
      }
      return null;
    }
  }

  /**
   * Synchronise les métadonnées d'un provider donné.
   * Pour Gemini/Mistral/Claude : appel dynamique à l'API.
   * Pour Groq/NVIDIA/Fireworks : utilisation des données statiques de PROVIDERS (déjà à jour).
   *
   * Invariant : ne lève jamais d'exception — toujours retourne null en cas d'erreur.
   * @param {string} providerKey - Clé du provider (ex: 'gemini', 'mistral', 'claude')
   * @param {string} apiKey - Clé API du provider
   * @returns {Promise<void>}
   */
  async function syncProviderModels(providerKey, apiKey) {
    if (typeof providerKey !== 'string' || typeof apiKey !== 'string' || !apiKey) {
      return;
    }

    const cache = await _loadCache();

    // Si le cache est encore valide, on ne re-synchronise pas
    if (_isCacheValid(cache, providerKey)) {
      console.log(`✅ ModelRegistry [${providerKey}]: cache valide (< 24h), pas de resync.`);
      return;
    }

    let models = null;

    switch (providerKey) {
      case 'gemini':
        models = await _fetchGeminiModels(apiKey);
        break;
      case 'mistral':
        models = await _fetchMistralModels(apiKey);
        break;
      case 'claude':
        models = await _fetchClaudeModels(apiKey);
        break;
      case 'groq':
      case 'nvidia': {
        // Ces providers n'exposent pas les métadonnées dans leur /models basique.
        // On sérialise les données statiques de PROVIDERS dans le cache pour
        // que getCachedModels() soit uniforme pour tous les providers.
        const staticProvider = QuizProviders.PROVIDERS[providerKey];
        if (staticProvider) {
          const allModels = [
            ...(staticProvider.textModels || []),
            ...(staticProvider.visionModels || [])
          ];
          models = allModels.map(m => ({
            id: m.id,
            label: m.label,
            contextWindow: m.contextLimit,
            maxOutputTokens: Math.min(m.contextLimit, 16384),
            vision: (staticProvider.visionModels || []).some(vm => vm.id === m.id),
            free: m.free
          }));
        }
        break;
      }
      default:
        console.warn(`⚠️ ModelRegistry: provider inconnu - ${providerKey}`);
        return;
    }

    if (!models || models.length === 0) {
      console.warn(`⚠️ ModelRegistry [${providerKey}]: aucun modèle retourné, cache conservé.`);
      return;
    }

    // Limiter à 500 modèles max par provider pour éviter la saturation du cache Chrome
    const MAX_MODELS_PER_PROVIDER = 500;
    cache[providerKey] = {
      lastSync: Date.now(),
      models: models.slice(0, MAX_MODELS_PER_PROVIDER)
    };
    await _saveCache(cache);
    // DET-01 : Alimenter automatiquement le cache synchrone en mémoire
    QuizProviders.warmContextCache(providerKey, cache[providerKey].models);
    console.log(`✅ ModelRegistry [${providerKey}]: ${models.length} modèles synchronisés.`);
  }

  /**
   * Retourne les modèles en cache pour un provider, ou null si absent/expiré.
   * @param {string} providerKey
   * @returns {Promise<Array|null>}
   */
  async function getCachedModels(providerKey) {
    const cache = await _loadCache();
    if (!_isCacheValid(cache, providerKey)) {
      return null;
    }
    return cache[providerKey].models;
  }

  /**
   * Retourne la contextWindow d'un modèle donné depuis le cache.
   * Si absent du cache, retourne null (le caller utilisera le fallback statique).
   * @param {string} providerKey
   * @param {string} modelId
   * @returns {Promise<number|null>}
   */
  async function getContextWindowFromCache(providerKey, modelId) {
    const models = await getCachedModels(providerKey);
    if (!models) return null;
    const found = models.find(m => m.id === modelId);
    return found ? found.contextWindow : null;
  }

  return {
    syncProviderModels,
    getCachedModels,
    getContextWindowFromCache
  };
})();

if (typeof window !== 'undefined') {
  window.ModelRegistry = ModelRegistry;
}
