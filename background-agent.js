// ============================================================
// background-agent.js — Autonomous Tool-Calling Agent (F-INT-01-V2 Unified)
// Architecture : ReAct loop + Multi-Provider Tool Calling Adapters + Robust Fallbacks
// Ce fichier est chargé dans le service worker via importScripts.
// ============================================================
/* global ConfigCache, QuizProviders, CourseMedia, handleFetchSerpApi, chrome, module, Date, Array, Number, Boolean, RegExp, parseInt, isNaN */

const _LoadedCourseMedia = (() => {
  if (typeof globalThis !== 'undefined' && globalThis.CourseMedia) {
    return globalThis.CourseMedia;
  }
  if (typeof self !== 'undefined' && self.CourseMedia) {
    return self.CourseMedia;
  }
  if (typeof window !== 'undefined' && window.CourseMedia) {
    return window.CourseMedia;
  }
  if (typeof require === 'function') {
    try {
      return require('./course-media.js');
    } catch (_) {
      return null;
    }
  }
  return null;
})();

const BackgroundAgent = (() => {
  'use strict';

  // ─── Constantes de Gouvernance ───
  const MAX_TURNS = 5;
  const SEARCH_TIMEOUT_MS = 15000;
  const MAX_TOTAL_TIMEOUT_MS = 180000;
  const MAX_CUSTOM_DOMAIN_RULES_CHARS = 500;
  const MAX_EXPLANATION_CHARS = 280;
  const DEFAULT_CONFIDENCE = 75;
  const DEFAULT_CROSS_VALIDATION_THRESHOLD = 70;
  const MAX_CROSS_VALIDATION_QUESTIONS = 5;
  const CROSS_VALIDATION_TIMEOUT_MS = 45000;
  const SAFE_RASTER_DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

  function _parseImageDataUrl(dataUrl) {
    if (_LoadedCourseMedia && typeof _LoadedCourseMedia.parseImageDataUrl === 'function') {
      return _LoadedCourseMedia.parseImageDataUrl(dataUrl);
    }
    if (typeof dataUrl !== 'string') return null;
    const match = SAFE_RASTER_DATA_URL_RE.exec(dataUrl);
    if (!match) return null;
    return { mimeType: match[1], base64: match[2] };
  }

  function _extractContextMedia(contextFiles) {
    if (_LoadedCourseMedia && typeof _LoadedCourseMedia.extractContextMedia === 'function') {
      return _LoadedCourseMedia.extractContextMedia(contextFiles);
    }
    const textFiles = [];
    const imageFiles = [];
    if (!Array.isArray(contextFiles)) {
      return { textFiles, imageFiles };
    }
    const seen = new Set();
    for (const entry of contextFiles) {
      if (!entry || typeof entry !== 'object') continue;
      if (entry.kind === 'image' || typeof entry.dataUrl === 'string') {
        const parsed = _parseImageDataUrl(entry.dataUrl);
        if (!parsed || seen.has(entry.dataUrl)) continue;
        seen.add(entry.dataUrl);
        imageFiles.push({
          name: (typeof entry.name === 'string' && entry.name.trim()) ? entry.name.trim() : 'image',
          dataUrl: entry.dataUrl,
          mimeType: parsed.mimeType,
          width: (typeof entry.width === 'number' && Number.isFinite(entry.width) && entry.width > 0) ? entry.width : 0,
          height: (typeof entry.height === 'number' && Number.isFinite(entry.height) && entry.height > 0) ? entry.height : 0,
          source: 'course-note'
        });
        continue;
      }
      if (typeof entry.content === 'string' && entry.content.trim().length > 0) {
        textFiles.push(entry);
      }
    }
    return { textFiles, imageFiles };
  }

  function _mergeRequestImages(contextImages, questionImages) {
    if (_LoadedCourseMedia && typeof _LoadedCourseMedia.mergeRequestImages === 'function') {
      return _LoadedCourseMedia.mergeRequestImages(contextImages, questionImages);
    }
    const merged = [];
    const seen = new Set();
    const sources = [
      ...(Array.isArray(contextImages) ? contextImages : []),
      ...(Array.isArray(questionImages) ? questionImages : [])
    ];
    for (const img of sources) {
      if (!img || typeof img !== 'object') continue;
      const parsed = _parseImageDataUrl(img.dataUrl);
      if (!parsed || seen.has(img.dataUrl)) continue;
      seen.add(img.dataUrl);
      merged.push({ ...img, mimeType: parsed.mimeType, dataUrl: img.dataUrl });
    }
    return merged;
  }

  function _getValidQuestionImages(q) {
    if (!q || !Array.isArray(q.images) || q.images.length === 0) {
      return [];
    }
    return _mergeRequestImages([], q.images);
  }

  function _buildCombinedContextText(rawContextText, textFiles) {
    const parts = [];
    if (typeof rawContextText === 'string' && rawContextText.trim().length > 0) {
      parts.push(rawContextText.trim());
    }
    if (Array.isArray(textFiles)) {
      for (const f of textFiles) {
        if (f && typeof f.content === 'string' && f.content.trim().length > 0) {
          parts.push(f.content.trim());
        }
      }
    }
    return parts.join('\n\n');
  }

  // ─── F-INT-03 : Presets de règles modulaires par domaine ───
  const DOMAIN_PRESETS = Object.freeze({
    general: 'Verify facts against the provided context first; eliminate distractors with logical contradictions; assign lower confidence (< 70) when key details are missing or ambiguous.',
    law: 'Always verify the applicable jurisdiction (country/state), hierarchy of norms, and effective date or statutory version. Distinguish general rules from exceptions, case-law nuances, and procedural deadlines. Prioritize authoritative primary texts or web verification over memory.',
    medicine: 'Check exact clinical criteria, anatomical terms, dosages, contraindications, and first-line vs. second-line guidelines. Watch for age, pregnancy, comorbidity modifiers, and negative stems (EXCEPT / NOT). Never extrapolate uncertain clinical values.',
    cs: 'Trace code execution, operator precedence, boundary conditions (null/undefined, off-by-one, overflow), time/space complexity, and protocol/RFC specifics step by step. Verify exact syntax, scoping, and concurrency semantics before choosing.',
    math: 'Derive formulas and arithmetic step by step, checking signs, units, domain restrictions, boundary cases, and quantifier scope (for-all vs. exists). Verify final numeric or symbolic results by substitution when possible.'
  });

  // ─── Cache System Prompt ───
  let _cachedSystemPrompt = null;

  function _redactUrlForText(urlStr) {
    try {
      const parsed = new URL(urlStr);
      parsed.username = '';
      parsed.password = '';
      parsed.hash = '';
      const sensitiveParamRe = /key|token|secret|auth|passw|credential|signature|sig/i;
      for (const name of Array.from(parsed.searchParams.keys())) {
        if (sensitiveParamRe.test(name)) {
          parsed.searchParams.set(name, '***');
        }
      }
      return parsed.toString();
    } catch (_) {
      return String(urlStr || '').replace(/([?&][^=&#]*?(?:key|token|secret|auth|passw|credential|sig)[^=&#]*=)[^&#]*/gi, '$1***');
    }
  }

  const NON_SECRET_LOCAL_PLACEHOLDERS = new Set([
    'ollama', 'lm-studio', 'llamacpp', 'freecc', 'local'
  ]);

  function _collectRedactionStrings(input, depth = 0, out = []) {
    if (!input || depth > 3 || out.length >= 80) {
      return out;
    }
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (trimmed.length >= 4 && !NON_SECRET_LOCAL_PLACEHOLDERS.has(trimmed.toLowerCase()) && !out.includes(trimmed)) {
        out.push(trimmed);
      }
      return out;
    }
    if (Array.isArray(input) || typeof input !== 'object') {
      return out;
    }
    const entries = Object.entries(input);
    for (let i = 0; i < entries.length && out.length < 80; i++) {
      const field = entries[i][0];
      const val = entries[i][1];
      if (!field || field === 'contextFiles' || field === 'questions' || field === 'journal' ||
          field === 'answers' || field === 'customModels' || field === 'providerOrder' ||
          field === 'domainPreset' || field === 'customDomainRules' ||
          field === 'selectedProvider' || field === 'language' || field === 'theme' || field === 'model') {
        continue;
      }
      if (val && typeof val === 'object') {
        _collectRedactionStrings(val, depth + 1, out);
        continue;
      }
      if (typeof val === 'string' && /(?:apikey|secret|token|password|credential|serpapi)/i.test(field)) {
        const trimmed = val.trim();
        if (trimmed.length >= 4 && !NON_SECRET_LOCAL_PLACEHOLDERS.has(trimmed.toLowerCase()) && !out.includes(trimmed)) {
          out.push(trimmed);
        }
      }
    }
    return out;
  }

  function _sanitizeErrorMessage(rawError, redactionInput = null) {
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
      .replace(/https?:\/\/[^\s"'<>\\]+/gi, (match) => _redactUrlForText(match))
      .replace(/\b(Bearer|Basic|Token)\s+[^\s,;}"'\\\]]+/gi, '$1 ***')
      .replace(/\b(?:AIza[0-9A-Za-z\-_]{10,}|sk-[A-Za-z0-9\-_]{10,}|gsk_[A-Za-z0-9\-_]{10,}|nvapi-[A-Za-z0-9\-_]{10,}|xai-[A-Za-z0-9\-_]{10,}|hf_[A-Za-z0-9\-_]{10,}|ghp_[A-Za-z0-9\-_]{10,})\b/g, '***')
      .replace(/(\\"?\b(?:api[\s_-]?key|x-api-key|x-goog-api-key|authorization|access[\s_-]?token|token|secret|auth|password|credential|key)\b\\"?\s*[:=]\s*\\")[^"]*\\"/gi, '$1***\\"')
      .replace(/(\\'?\b(?:api[\s_-]?key|x-api-key|x-goog-api-key|authorization|access[\s_-]?token|token|secret|auth|password|credential|key)\b\\'?\s*[:=]\s*\\')[^']*\\'/gi, "$1***\\'")
      .replace(/(["']?\b(?:api[\s_-]?key|x-api-key|x-goog-api-key|authorization|access[\s_-]?token|token|secret|auth|password|credential|key)\b["']?\s*[:=]\s*)(["'])(?:(?!\2)[^\\]|\\.)*\2/gi, '$1$2***$2')
      .replace(/(["']?\b(?:api[\s_-]?key|x-api-key|x-goog-api-key|authorization|access[\s_-]?token|token|secret|auth|password|credential)\b["']?\s*[:=]\s*)(?:(?:Bearer|Basic|Token)\s+)?[^\s&,;}"'\\\]]+/gi, '$1***')
      .replace(/(\bkey\s*=\s*)[^\s&,;}"'\\\]]+/gi, '$1***');

    const allRedactValues = Array.from(new Set(_collectRedactionStrings(redactionInput)))
      .sort((a, b) => b.length - a.length);
    for (let i = 0; i < allRedactValues.length; i++) {
      const val = allRedactValues[i];
      if (cleaned.includes(val)) {
        cleaned = cleaned.split(val).join('***');
      }
    }
    return cleaned;
  }

  function _createSanitizedError(rawError, redactionInput = null) {
    const safeMsg = _sanitizeErrorMessage(rawError, redactionInput);
    const wrapped = new Error(safeMsg);
    if (rawError && typeof rawError === 'object') {
      if (typeof rawError.status === 'number') {
        wrapped.status = rawError.status;
      }
      if (typeof rawError.name === 'string' && rawError.name && rawError.name !== 'Error') {
        wrapped.name = rawError.name;
      }
    }
    return wrapped;
  }

  /**
   * Sanitise une chaîne en texte brut sans balises HTML ni espaces superflus ni secrets d'URL.
   * @param {*} text
   * @param {number} maxLen
   * @returns {string}
   */
  function _sanitizePlainText(text, maxLen = MAX_EXPLANATION_CHARS) {
    if (typeof text !== 'string') {
      return '';
    }
    const bounded = text.slice(0, Math.max(maxLen * 4, 4096));
    const stripped = bounded
      .replace(/<!--[\s\S]*?-->|<\/[a-zA-Z][a-zA-Z0-9:-]{0,30}\s*>|<[a-zA-Z][a-zA-Z0-9:-]{0,30}(?:\s+(?:[a-zA-Z_:][a-zA-Z0-9_.:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`]+)|disabled|checked|selected|readonly|required|multiple|hidden|open|async|defer|autofocus|controls|autoplay|loop|muted|novalidate|formnovalidate|nomodule|inert|default|reversed|ismap|data-[a-zA-Z0-9_-]+))*\s*\/?>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!stripped) {
      return '';
    }
    const safe = stripped.replace(/https?:\/\/[^\s"'<>\\]+/gi, (m) => _redactUrlForText(m));
    if (maxLen > 3 && safe.length > maxLen) {
      return safe.slice(0, maxLen - 3).trimEnd() + '...';
    }
    return safe.slice(0, maxLen);
  }

  /**
   * F-INT-03 : Classifieur heuristique déterministe du domaine d'un quiz.
   * @param {string} quizText
   * @returns {'law'|'medicine'|'cs'|'math'|'general'}
   */
  function detectDomain(quizText) {
    if (typeof quizText !== 'string' || quizText.trim().length === 0) {
      return 'general';
    }

    const rules = {
      law: [
        { re: /\b(jurisdiction|statute|statutory|plaintiff|defendant|tort|jurisprudence|litigation|indictment|subpoena|habeas corpus|mens rea|fiduciary|case law|supreme court|cour de cassation|conseil d'état|code civil|code pénal|droit civil|droit pénal|droit administratif|droit constitutionnel|responsabilité civile|procédure pénale)\b/gi, weight: 2 },
        { re: /\b(contract|contrat|constitution|verdict|tribunal|législation|article\s+\d+|arrêt|directive\s+\d+|breach|appeal|liability)\b/gi, weight: 1 }
      ],
      medicine: [
        { re: /\b(diagnosis|diagnostic|pathology|pathologie|pharmacology|pharmacologie|contraindication|contre-indication|myocardial infarction|infarctus|tachycardia|bradycardia|leukocyte|pathogen|biopsy|biopsie|prognosis|pronostic|anaphylaxis|anaphylaxie|mg\/kg|auscultation)\b/gi, weight: 2 },
        { re: /\b(symptom|symptôme|dosage|posologie|patient|clinical|clinique|anatomy|anatomie|physiology|physiologie|antibiotic|antibiotique|hypertension|insulin|insuline|ecg|irm|mri|syndrome|therapy|thérapie|anemia|anémie|subcutaneous|intravenous)\b/gi, weight: 1 }
      ],
      cs: [
        { re: /\b(algorithm|algorithme|time complexity|space complexity|big-o|o\(n|o\(log|binary tree|binary search|arbre binaire|hash table|table de hachage|linked list|liste chaînée|javascript|typescript|python|c\+\+|deadlock|semaphore|sémaphore|mutex|tcp\/ip|compiler|compilateur)\b/gi, weight: 2 },
        { re: /\b(complexity|complexité|recursion|récursion|java|rust|sql|http|dns|thread|pointer|pointeur|regex|json|xml|dom|html|css|async|await|promise|array|boolean|bitmask|bitwise|function\s+\w+\s*\(|def\s+\w+\s*\(|select\s+.+\s+from\s+)\b/gi, weight: 1 }
      ],
      math: [
        { re: /\b(eigenvalue|valeur propre|determinant|déterminant|polynomial|polynôme|integral|intégrale|derivative|dérivée|vector space|espace vectoriel|standard deviation|écart-type|binomial|gaussian|gaussienne|combinatorics|logarithm|logarithme|trigonometric|differential equation|équation différentielle)\b/gi, weight: 2 },
        { re: /\b(matrix|matrice|equation|équation|inequality|inéquation|theorem|théorème|lemma|lemme|probability|probabilité|variance|converge|divergence|calculus|algebra|algèbre|modulo|prime number|nombre premier|sin\(|cos\(|tan\(|sqrt\(|f\([a-z]\))\b/gi, weight: 1 },
        { re: /[∑∫∀∃∈⊆≠≤≥]/g, weight: 2 }
      ]
    };

    const scores = { law: 0, medicine: 0, cs: 0, math: 0 };
    for (const [domain, patterns] of Object.entries(rules)) {
      for (const { re, weight } of patterns) {
        const matches = quizText.match(re);
        if (matches) {
          scores[domain] += matches.length * weight;
        }
      }
    }

    let bestDomain = 'general';
    let bestScore = 1; // Seuil minimum >= 2 pour éviter les faux positifs
    for (const domain of ['law', 'medicine', 'cs', 'math']) {
      if (scores[domain] > bestScore) {
        bestScore = scores[domain];
        bestDomain = domain;
      }
    }

    return bestDomain;
  }

  /**
   * F-INT-03 : Construit le bloc de règles de domaine en combinant preset (avec résolution 'auto')
   * et directives personnalisées assainies et bornées.
   * @param {string} preset
   * @param {string} customRules
   * @param {string} quizText
   * @returns {string}
   */
  function buildDomainRules(preset = 'general', customRules = '', quizText = '') {
    let resolvedPreset = typeof preset === 'string' ? preset.trim().toLowerCase() : 'general';
    if (!resolvedPreset) {
      resolvedPreset = 'general';
    }
    if (resolvedPreset === 'auto') {
      resolvedPreset = detectDomain(quizText);
    }

    let presetText = '';
    if (resolvedPreset !== 'none' && resolvedPreset !== 'off') {
      if (!Object.prototype.hasOwnProperty.call(DOMAIN_PRESETS, resolvedPreset)) {
        resolvedPreset = 'general';
      }
      presetText = DOMAIN_PRESETS[resolvedPreset] || '';
    }

    let sanitizedCustom = '';
    if (typeof customRules === 'string' && customRules.trim().length > 0) {
      sanitizedCustom = customRules
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\{\{|\}\}/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (sanitizedCustom.length > MAX_CUSTOM_DOMAIN_RULES_CHARS) {
        sanitizedCustom = sanitizedCustom.slice(0, MAX_CUSTOM_DOMAIN_RULES_CHARS - 3).trimEnd() + '...';
      }
    }

    const parts = [];
    if (presetText) {
      parts.push(`Domain Focus (${resolvedPreset}): ${presetText}`);
    }
    if (sanitizedCustom) {
      parts.push(`Custom Directives: ${sanitizedCustom}`);
    }
    return parts.join('\n');
  }

  /**
   * F-INT-03 : Injecte ou retire proprement {{domain_rules}} dans le system prompt.
   * @param {string} systemPrompt
   * @param {string} domainRulesText
   * @returns {string}
   */
  function applyDomainRules(systemPrompt, domainRulesText) {
    if (typeof systemPrompt !== 'string') {
      return '';
    }
    const cleaned = typeof domainRulesText === 'string' ? domainRulesText.trim() : '';
    const hasPlaceholder = systemPrompt.includes('{{domain_rules}}');

    if (hasPlaceholder) {
      if (cleaned) {
        return systemPrompt.replaceAll('{{domain_rules}}', () => `## Domain Rules\n${cleaned}`);
      }
      return systemPrompt
        .replaceAll('{{domain_rules}}', () => '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    if (cleaned) {
      return `${systemPrompt.trim()}\n\n## Domain Rules\n${cleaned}`;
    }
    return systemPrompt;
  }

  /**
   * Normalise et borne un score de confiance sur [0, 100].
   * @param {*} confidence
   * @returns {number}
   */
  function _normalizeConfidence(confidence) {
    if (typeof confidence === 'number' && Number.isFinite(confidence)) {
      return Math.round(Math.max(0, Math.min(100, confidence)));
    }
    if (typeof confidence === 'string') {
      const stripped = confidence.trim().replace(/%$/, '').trim();
      if (stripped.length > 0) {
        const parsed = Number(stripped);
        if (Number.isFinite(parsed)) {
          return Math.round(Math.max(0, Math.min(100, parsed)));
        }
      }
    }
    return DEFAULT_CONFIDENCE;
  }

  /**
   * F-INT-02 : Calcule le palier de confiance ('high' | 'medium' | 'low').
   * @param {number|string} confidence
   * @returns {'high'|'medium'|'low'}
   */
  function computeConfidenceTier(confidence) {
    const numeric = _normalizeConfidence(confidence);
    if (numeric >= 80) return 'high';
    if (numeric >= 50) return 'medium';
    return 'low';
  }

  /**
   * F-INT-02 : Normalise une entrée de réponse pour garantir cohérence et compatibilité aval.
   * @param {Object} entry
   * @returns {Object}
   */
  function normalizeAnswerEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return {
        questionIndex: 0,
        raw: '',
        optionIndices: [],
        textAnswer: null,
        confidence: DEFAULT_CONFIDENCE,
        confidenceTier: computeConfidenceTier(DEFAULT_CONFIDENCE),
        explanation: '',
        crossValidated: false
      };
    }

    let questionIndex = 0;
    if (typeof entry.questionIndex === 'number' && Number.isFinite(entry.questionIndex) && entry.questionIndex >= 0) {
      questionIndex = Math.floor(entry.questionIndex);
    } else if (typeof entry.questionIndex === 'string' && entry.questionIndex.trim().length > 0) {
      const parsedIdx = Number(entry.questionIndex.trim());
      if (Number.isFinite(parsedIdx) && parsedIdx >= 0) {
        questionIndex = Math.floor(parsedIdx);
      }
    }

    const confidence = _normalizeConfidence(entry.confidence);

    const optionIndices = Array.isArray(entry.optionIndices)
      ? [...new Set(
          entry.optionIndices
            .map(n => {
              if (typeof n === 'number') return n;
              if (typeof n === 'string' && n.trim().length > 0) return Number(n.trim());
              return NaN;
            })
            .filter(n => Number.isInteger(n) && n >= 0)
        )]
      : [];

    const normalized = {
      questionIndex,
      raw: typeof entry.raw === 'string' ? entry.raw : (entry.raw != null ? String(entry.raw) : ''),
      optionIndices,
      textAnswer: entry.textAnswer !== undefined && entry.textAnswer !== null ? String(entry.textAnswer) : null,
      confidence,
      confidenceTier: computeConfidenceTier(confidence),
      explanation: _sanitizePlainText(entry.explanation, MAX_EXPLANATION_CHARS),
      crossValidated: Boolean(entry.crossValidated)
    };

    if (typeof entry.crossValidationStatus === 'string' && entry.crossValidationStatus.trim().length > 0) {
      normalized.crossValidationStatus = entry.crossValidationStatus.trim();
    }
    if (typeof entry.crossValidationNote === 'string' && entry.crossValidationNote.trim().length > 0) {
      normalized.crossValidationNote = _sanitizePlainText(entry.crossValidationNote, MAX_EXPLANATION_CHARS);
    }

    return normalized;
  }

  const BLOCKED_PROVIDER_KEYS = new Set(['', 'auto', '__proto__', 'constructor', 'prototype']);

  function _normalizeProviderKey(key) {
    if (typeof key !== 'string') return null;
    const norm = key.trim().toLowerCase();
    return BLOCKED_PROVIDER_KEYS.has(norm) ? null : norm;
  }

  function _getProviderDef(providerKey) {
    const normKey = _normalizeProviderKey(providerKey);
    if (!normKey || typeof QuizProviders === 'undefined' || !QuizProviders || !QuizProviders.PROVIDERS) {
      return null;
    }
    return Object.prototype.hasOwnProperty.call(QuizProviders.PROVIDERS, normKey)
      ? QuizProviders.PROVIDERS[normKey]
      : null;
  }

  function _getProviderType(providerKey) {
    const normKey = _normalizeProviderKey(providerKey) || '';
    const provider = _getProviderDef(normKey);
    if (provider && typeof provider.type === 'string' && provider.type) {
      return provider.type;
    }
    if (normKey === 'gemini') return 'gemini';
    if (normKey === 'claude') return 'claude';
    return 'openai-compatible';
  }

  function _buildEndpointUrl(baseUrl, suffix) {
    const cat = typeof globalThis !== 'undefined' ? globalThis.ProviderCatalog : null;
    if (cat && typeof cat.buildEndpointUrl === 'function') {
      return cat.buildEndpointUrl(baseUrl, suffix);
    }
    const cleanBase = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
    const cleanSuffix = typeof suffix === 'string' ? suffix.trim() : '';
    if (!cleanBase) return '';
    if (!cleanSuffix) return cleanBase;
    return `${cleanBase}${cleanSuffix.startsWith('/') ? cleanSuffix : `/${cleanSuffix}`}`;
  }

  function _isProviderConfigured(providerKey, config) {
    const normKey = _normalizeProviderKey(providerKey);
    const provider = _getProviderDef(normKey);
    if (!normKey || !provider || !config || typeof config !== 'object') {
      return false;
    }
    if (typeof QuizProviders !== 'undefined' && QuizProviders && typeof QuizProviders.isProviderConfigured === 'function') {
      return QuizProviders.isProviderConfigured(normKey, config);
    }
    const pConfigs = (config.providerConfigs && typeof config.providerConfigs === 'object') ? config.providerConfigs : null;
    const pCfg = (pConfigs && Object.prototype.hasOwnProperty.call(pConfigs, normKey) && pConfigs[normKey] && typeof pConfigs[normKey] === 'object')
      ? pConfigs[normKey]
      : null;
    if (provider.local === true) {
      return Boolean(pCfg && pCfg.enabled === true);
    }
    const field = provider.apiKeyField;
    const hasKey = Boolean(field && Object.prototype.hasOwnProperty.call(config, field) && typeof config[field] === 'string' && config[field].trim().length > 0);
    if (!hasKey) return false;
    if (provider.requiresAccountId && (!pCfg || typeof pCfg.accountId !== 'string' || !pCfg.accountId.trim())) return false;
    if (provider.requiresBaseUrl && (!pCfg || typeof pCfg.baseUrl !== 'string' || !pCfg.baseUrl.trim())) return false;
    return true;
  }

  function _resolveRuntimeConfig(providerKey, config) {
    const normKey = _normalizeProviderKey(providerKey);
    const provider = _getProviderDef(normKey);
    if (typeof QuizProviders !== 'undefined' && QuizProviders && typeof QuizProviders.resolveProviderRuntimeConfig === 'function') {
      return QuizProviders.resolveProviderRuntimeConfig(normKey, config);
    }
    const pConfigs = (config && config.providerConfigs && typeof config.providerConfigs === 'object') ? config.providerConfigs : null;
    const providerConfig = (normKey && pConfigs && Object.prototype.hasOwnProperty.call(pConfigs, normKey) && pConfigs[normKey] && typeof pConfigs[normKey] === 'object')
      ? { ...pConfigs[normKey] }
      : {};
    const field = provider && provider.apiKeyField;
    const rawKey = (config && field && Object.prototype.hasOwnProperty.call(config, field) && typeof config[field] === 'string')
      ? config[field].trim()
      : '';
    return {
      apiKey: rawKey || (provider && provider.local ? (provider.staticApiKey || 'local') : ''),
      providerConfig,
      baseUrl: provider ? (provider.baseUrl || '') : ''
    };
  }

  function _resolveEndpointBaseUrl(providerKey, provider, providerConfig, model) {
    const normKey = _normalizeProviderKey(providerKey) || '';
    if (typeof QuizProviders !== 'undefined' && QuizProviders && typeof QuizProviders.resolveProviderBaseUrl === 'function') {
      return QuizProviders.resolveProviderBaseUrl(normKey, providerConfig, model);
    }
    if (normKey === 'mistral' && typeof model === 'string' && model.toLowerCase().includes('codestral')) {
      return 'https://codestral.mistral.ai/v1';
    }
    const customBase = (providerConfig && typeof providerConfig.baseUrl === 'string') ? providerConfig.baseUrl.trim() : '';
    return customBase || (provider && provider.baseUrl) || '';
  }

  /**
   * Liste strictement les providers configurés dans l'ordre de priorité.
   */
  function _getStrictlyConfiguredProviders(mergedConfig, order) {
    if (typeof QuizProviders === 'undefined' || !QuizProviders || !QuizProviders.PROVIDERS) {
      return [];
    }
    const defaultOrder = QuizProviders.DEFAULT_PRIORITY || [];
    const fallbackAllOrder = [
      ...defaultOrder,
      ...Object.keys(QuizProviders.PROVIDERS).filter(k => !defaultOrder.includes(k))
    ];
    const priority = (Array.isArray(order) && order.length > 0)
      ? order
      : ((mergedConfig && Array.isArray(mergedConfig.providerOrder) && mergedConfig.providerOrder.length > 0)
          ? mergedConfig.providerOrder
          : fallbackAllOrder);
    const configured = [];
    for (const rawKey of priority) {
      const pKey = _normalizeProviderKey(rawKey);
      if (!pKey || !Object.prototype.hasOwnProperty.call(QuizProviders.PROVIDERS, pKey)) {
        continue;
      }
      if (_isProviderConfigured(pKey, mergedConfig) && !configured.includes(pKey)) {
        configured.push(pKey);
      }
    }
    if (configured.length === 0) {
      for (const pKey of fallbackAllOrder) {
        if (_isProviderConfigured(pKey, mergedConfig) && !configured.includes(pKey)) {
          configured.push(pKey);
        }
      }
    }
    return configured;
  }

  /**
   * Normalise les métadonnées de type et d'options/cibles d'une question.
   */
  function _getNormalizedQuestionMeta(q) {
    const rawType = String((q && q.type) || '').toLowerCase();
    const normType = String((q && (q.questionType || q.type)) || 'unknown').toLowerCase();
    const selects = q && Array.isArray(q.selects) ? q.selects : [];
    const options = q && Array.isArray(q.options) ? q.options : [];
    const draggables = q && Array.isArray(q.draggables) ? q.draggables : [];
    const dropTargets = q && Array.isArray(q.dropTargets) ? q.dropTargets : [];
    const isMultiSelectMatching = (rawType === 'select_matching' || normType === 'select_matching') && selects.length > 1;
    const isSingleSelectMatching = (rawType === 'select_matching' || normType === 'select_matching') && selects.length <= 1;
    const isDragDrop = rawType === 'drag_drop' || normType === 'drag_drop' || dropTargets.length > 0;
    const isTextLike = rawType === 'text' || rawType === 'fill_blank' || normType === 'text' || normType === 'fill_blank';
    const singleSelectOptions = (selects.length === 1 && selects[0] && Array.isArray(selects[0].options))
      ? selects[0].options
      : [];
    const effectiveOptions = options.length > 0
      ? options
      : (singleSelectOptions.length > 0 ? singleSelectOptions : draggables);
    return {
      rawType,
      normType,
      selects,
      options,
      draggables,
      dropTargets,
      effectiveOptions,
      isMultiSelectMatching,
      isSingleSelectMatching,
      isDragDrop,
      isTextLike
    };
  }

  /**
   * Formate de manière uniforme une question normalisée (QCM, select_matching, drag_drop,
   * fill_blank, texte) pour les prompts de résolution et de vérification.
   */
  function _formatQuestionForPrompt(q, displayNumber, opts = {}) {
    if (!q || typeof q !== 'object') return '';
    let out = `Question ${displayNumber}: ${q.text || ''}\n`;
    const validImages = opts.includeImageNote ? _getValidQuestionImages(q) : [];
    if (validImages.length > 0) {
      out += `  [${validImages.length} image(s) jointe(s) pour cette question]\n`;
    }

    const meta = _getNormalizedQuestionMeta(q);
    const rawType = meta.rawType || meta.normType;
    const qType = meta.normType;
    const qOptions = meta.options;
    const qSelects = meta.selects;
    const qDraggables = meta.draggables;
    const qDropTargets = meta.dropTargets;

    if (rawType === 'radio' || rawType === 'checkbox' || qType === 'single_choice' || qType === 'multi_choice') {
      const isSingle = rawType === 'radio' || qType === 'single_choice';
      out += `Type: Choix ${isSingle ? 'unique' : 'multiple'}\n`;
      out += `Options:\n`;
      for (let optIdx = 0; optIdx < qOptions.length; optIdx++) {
        out += `  ${optIdx + 1}. ${qOptions[optIdx].text}\n`;
      }
    } else if (rawType === 'select_matching' || qType === 'select_matching' || qSelects.length > 0) {
      if (qSelects.length === 1) {
        const singleOpts = (Array.isArray(qSelects[0].options) && qSelects[0].options.length > 0)
          ? qSelects[0].options
          : qOptions;
        out += `Type: Choix unique (menu déroulant — réponds avec type="radio" et <option_index>)\n`;
        out += `Options:\n`;
        for (let optIdx = 0; optIdx < singleOpts.length; optIdx++) {
          out += `  ${optIdx + 1}. ${singleOpts[optIdx].text}\n`;
        }
      } else if (qSelects.length > 1) {
        out += `Type: Association par menus déroulants (réponds avec type="text" et <text_reply> en séparant chaque choix par " | " dans l'ordre des paires)\n`;
        out += `Paires à associer:\n`;
        for (let sIdx = 0; sIdx < qSelects.length; sIdx++) {
          const sel = qSelects[sIdx] || {};
          const selOpts = Array.isArray(sel.options) ? sel.options.map(o => o.text).join(' | ') : '';
          out += `  ${sIdx + 1}. ${sel.label || `Élément ${sIdx + 1}`}: ${selOpts}\n`;
        }
      } else if (qOptions.length > 0) {
        out += `Type: Choix unique (menu déroulant — réponds avec type="radio" et <option_index>)\n`;
        out += `Options:\n`;
        for (let optIdx = 0; optIdx < qOptions.length; optIdx++) {
          out += `  ${optIdx + 1}. ${qOptions[optIdx].text}\n`;
        }
      } else {
        out += `Type: Réponse textuelle\n`;
      }
    } else if (meta.isDragDrop) {
      const drags = meta.effectiveOptions;
      out += `Type: Glisser-déposer (réponds avec type="checkbox" <option_indices> pour les éléments à placer et/ou type="text" <text_reply> au format "Élément -> Cible | ...")\n`;
      if (drags.length > 0) {
        out += `Éléments déplaçables:\n`;
        for (let dIdx = 0; dIdx < drags.length; dIdx++) {
          out += `  ${dIdx + 1}. ${drags[dIdx].text}\n`;
        }
      }
      if (qDropTargets.length > 0) {
        out += `Zones cibles:\n`;
        for (let tIdx = 0; tIdx < qDropTargets.length; tIdx++) {
          out += `  ${tIdx + 1}. ${qDropTargets[tIdx].label || qDropTargets[tIdx].text || `Cible ${tIdx + 1}`}\n`;
        }
      }
    } else if (qType === 'fill_blank' && Array.isArray(q.blanks) && q.blanks.length > 1) {
      out += `Type: Texte à trous (${q.blanks.length} champs — réponds avec type="text" et sépare chaque réponse par " | " dans <text_reply>)\n`;
    } else {
      out += `Type: Réponse textuelle\n`;
    }
    return out;
  }

  /**
   * Associe un texte de réponse aux index d'options/éléments correspondants.
   */
  function _matchOptionIndexByText(question, rawText, matchAll = false) {
    if (!question || !rawText) return [];
    const opts = _getNormalizedQuestionMeta(question).effectiveOptions;
    if (opts.length === 0) return [];

    const cleanExact = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanSpaced = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const isBoundaryContain = (aSpaced, bSpaced) => {
      if (!aSpaced || !bSpaced || aSpaced.length < 2 || bSpaced.length < 2) return false;
      return (` ${aSpaced} `).includes(` ${bSpaced} `) || (` ${bSpaced} `).includes(` ${aSpaced} `);
    };

    const findMatchesForToken = (tok, singleMode) => {
      const tokLower = String(tok || '').toLowerCase().trim();
      const tokClean = cleanExact(tok);
      const tokSpaced = cleanSpaced(tok);
      if (!tokClean && !tokLower) return [];

      // Pass 0: strict trimmed lowercase equality across all options/values (preserves C++ vs C#, 2+2 vs 2*2)
      const strictHits = [];
      for (let optIdx = 0; optIdx < opts.length; optIdx++) {
        const opt = opts[optIdx];
        if (!opt) continue;
        const optRawLower = String(opt.text || '').toLowerCase().trim();
        const optValLower = String(opt.value || '').toLowerCase().trim();
        if (tokLower && ((optRawLower && optRawLower === tokLower) || (optValLower && optValLower === tokLower))) {
          strictHits.push(optIdx);
          if (singleMode) return [optIdx];
        }
      }
      if (strictHits.length > 0) return strictHits;

      // Pass 1: alphanumeric-normalized equality (only when Pass 0 found zero strict matches)
      if (tokClean && tokClean.length >= 2) {
        const cleanHits = [];
        for (let optIdx = 0; optIdx < opts.length; optIdx++) {
          const opt = opts[optIdx];
          if (!opt) continue;
          const optTextClean = cleanExact(opt.text);
          const optValClean = cleanExact(opt.value);
          if (optTextClean === tokClean || optValClean === tokClean) {
            cleanHits.push(optIdx);
            if (singleMode) return [optIdx];
          }
        }
        if (cleanHits.length > 0) return cleanHits;
      }

      // Pass 2: word-boundary containment fallback (only when Pass 0 & Pass 1 found zero hits)
      if (!tokSpaced || tokSpaced.length < 2) return [];
      const boundaryHits = [];
      let bestIdx = -1;
      let bestLen = -1;
      for (let optIdx = 0; optIdx < opts.length; optIdx++) {
        const opt = opts[optIdx];
        if (!opt) continue;
        const optSpaced = cleanSpaced(opt.text);
        if (isBoundaryContain(tokSpaced, optSpaced)) {
          boundaryHits.push(optIdx);
          if (optSpaced.length > bestLen) {
            bestLen = optSpaced.length;
            bestIdx = optIdx;
          }
        }
      }
      if (singleMode) {
        return bestIdx >= 0 ? [bestIdx] : [];
      }
      return boundaryHits;
    };

    if (matchAll) {
      const segments = String(rawText)
        .split(/[|;\n]+/)
        .map(s => s.trim())
        .filter(Boolean);
      const lhsTokens = [];
      for (const seg of segments) {
        const arrowParts = seg.split(/->|=>/);
        const lhs = (arrowParts.length > 1 ? arrowParts[0] : seg.split(':')[0]).trim();
        if (lhs) lhsTokens.push(lhs);
      }
      if (lhsTokens.length === 0) lhsTokens.push(String(rawText));

      const matched = [];
      const seen = new Set();
      const collectFromList = (tokenList) => {
        for (const tok of tokenList) {
          for (const optIdx of findMatchesForToken(tok, false)) {
            if (!seen.has(optIdx)) {
              seen.add(optIdx);
              matched.push(optIdx);
            }
          }
        }
      };

      collectFromList(lhsTokens);
      if (matched.length === 0 && segments.length > 0) {
        collectFromList(segments);
      }
      return matched;
    }

    return findMatchesForToken(rawText, true);
  }

  /**
   * Compare de façon normalisée la réponse primaire et la réponse secondaire.
   */
  function _answersAgree(primaryAns, secondaryAns, question) {
    if (!primaryAns || !secondaryAns) {
      return false;
    }
    const pOpts = Array.isArray(primaryAns.optionIndices) ? [...new Set(primaryAns.optionIndices)].sort((a, b) => a - b) : [];
    const sOpts = Array.isArray(secondaryAns.optionIndices) ? [...new Set(secondaryAns.optionIndices)].sort((a, b) => a - b) : [];

    const normText = (txt) => String(txt || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[.,;:!?]+$/, '');
    const pText = normText(primaryAns.textAnswer);
    const sText = normText(secondaryAns.textAnswer);

    const meta = _getNormalizedQuestionMeta(question);
    if (meta.isDragDrop && pText.length > 0 && sText.length > 0) {
      return pText === sText;
    }

    const isPureChoice = question && !meta.isMultiSelectMatching && !meta.isDragDrop && !meta.isTextLike &&
      (meta.rawType === 'radio' || meta.rawType === 'checkbox' || meta.normType === 'single_choice' || meta.normType === 'multi_choice' || meta.options.length > 0);
    if (isPureChoice || (!meta.isDragDrop && !meta.isTextLike && pOpts.length > 0 && sOpts.length > 0)) {
      if (pOpts.length === 0 || sOpts.length === 0 || pOpts.length !== sOpts.length) {
        return false;
      }
      return pOpts.every((val, idx) => val === sOpts[idx]);
    }

    if (pText.length > 0 && sText.length > 0) {
      return pText === sText;
    }
    if (meta.isDragDrop && pOpts.length > 0 && sOpts.length > 0) {
      return pOpts.length === sOpts.length && pOpts.every((val, idx) => val === sOpts[idx]);
    }
    return false;
  }

  /**
   * Construit le prompt ciblé de vérification pour une question unique.
   */
  function _buildVerificationPrompt(question, baseContextText, searchEvidence, settings, contextImages = []) {
    let sys = [
      'You are an independent quiz verification reviewer. Analyze the single question carefully and output ONLY a valid <quiz_answers> XML block.',
      'Format:',
      '<quiz_answers>',
      '  <answer question_id="1" type="radio|checkbox|text|drag_drop">',
      '    <!-- Use ONLY the tag matching the type attribute: -->',
      '    <!-- If type="radio": <option_index>N</option_index> (1-based index from Options) -->',
      '    <!-- If type="checkbox": <option_indices>N, M</option_indices> (1-based comma-separated indices) -->',
      '    <!-- If type="text": <text_reply>exact answer text</text_reply> -->',
      '    <!-- If type="drag_drop": <option_indices>N, M</option_indices> and/or <text_reply>Item -> Target</text_reply> -->',
      '    <confidence>0-100</confidence>',
      '    <explanation>brief plain-text rationale</explanation>',
      '  </answer>',
      '</quiz_answers>',
      'Allowed type values are strictly: "radio", "checkbox", "text", or "drag_drop". Always include the selected option index/indices or text_reply tag.'
    ].join('\n');
    const domainRulesText = buildDomainRules(
      settings?.domainPreset || 'auto',
      settings?.customDomainRules || '',
      question.text || ''
    );
    sys = applyDomainRules(sys, domainRulesText);

    let usr = '';
    if (baseContextText && typeof baseContextText === 'string' && baseContextText.trim().length > 0) {
      usr += `CONTEXT:\n${baseContextText.trim().slice(0, 2000)}\n\n`;
    }
    if (Array.isArray(contextImages) && contextImages.length > 0) {
      const names = contextImages.map(img => (img && img.name) ? img.name : 'image').join(', ');
      usr += `COURSE NOTE IMAGES: ${contextImages.length} course reference image(s) are attached first (${names}). Use them as primary reference.\n\n`;
    }
    if (searchEvidence && typeof searchEvidence === 'string' && searchEvidence.trim().length > 0) {
      usr += `WEB EVIDENCE:\n${searchEvidence.trim().slice(0, 1500)}\n\n`;
    }
    usr += _formatQuestionForPrompt({ ...question, index: 1 }, 1, { includeImageNote: false });
    usr += '\nVerify and return the exact answer in <quiz_answers> XML format.';
    return { system: sys, user: usr };
  }

  /**
   * F-INT-04 : Cross-Validation Engine.
   * Vérifie les réponses sous le seuil de confiance via un provider distinct et/ou web_search.
   * @param {Array<Object>} answers
   * @param {Array<Object>} questions
   * @param {Object} context
   * @returns {Promise<Array<Object>>}
   */
  async function crossValidateAnswers(answers, questions, context = {}) {
    if (!Array.isArray(answers) || answers.length === 0) {
      return [];
    }

    const resultAnswers = answers.map(ans => normalizeAnswerEntry({
      ...(ans && typeof ans === 'object' ? ans : {}),
      crossValidated: false
    }));

    if (!Array.isArray(questions) || questions.length === 0) {
      return resultAnswers;
    }

    const externalSignal = context?.signal || null;
    if (externalSignal && externalSignal.aborted) {
      return resultAnswers;
    }

    const syncConfig = (context?.config?.syncConfig && typeof context.config.syncConfig === 'object')
      ? context.config.syncConfig
      : (context?.syncConfig && typeof context.syncConfig === 'object' ? context.syncConfig : {});
    const apiKeys = (context?.config?.apiKeys && typeof context.config.apiKeys === 'object')
      ? context.config.apiKeys
      : (context?.apiKeys && typeof context.apiKeys === 'object' ? context.apiKeys : {});
    const settings = (context?.config?.settings && typeof context.config.settings === 'object')
      ? context.config.settings
      : (context?.settings && typeof context.settings === 'object' ? context.settings : {});
    const mergedConfig = { ...syncConfig, ...apiKeys };
    const journal = Array.isArray(context?.journal) ? context.journal : null;

    const rawThreshold = context?.threshold ?? context?.crossValidationThreshold ?? settings.crossValidationThreshold ?? syncConfig.crossValidationThreshold ?? DEFAULT_CROSS_VALIDATION_THRESHOLD;
    let threshold = DEFAULT_CROSS_VALIDATION_THRESHOLD;
    if (typeof rawThreshold === 'number' && Number.isFinite(rawThreshold)) {
      threshold = Math.max(1, Math.min(100, rawThreshold));
    } else if (typeof rawThreshold === 'string' && rawThreshold.trim().length > 0) {
      const parsedThreshold = Number(rawThreshold.trim());
      if (Number.isFinite(parsedThreshold)) {
        threshold = Math.max(1, Math.min(100, parsedThreshold));
      }
    }

    const rawMax = context?.maxQuestions ?? MAX_CROSS_VALIDATION_QUESTIONS;
    const maxQuestions = (typeof rawMax === 'number' && Number.isFinite(rawMax))
      ? Math.max(0, Math.min(MAX_CROSS_VALIDATION_QUESTIONS, Math.floor(rawMax)))
      : MAX_CROSS_VALIDATION_QUESTIONS;
    if (maxQuestions === 0) {
      return resultAnswers;
    }

    const primaryProvider = _normalizeProviderKey(context?.primaryProvider || settings.selectedProvider);
    const configured = _getStrictlyConfiguredProviders(mergedConfig, syncConfig.providerOrder);
    let secondaryProviders = configured.filter(p => p !== primaryProvider);

    const hasLLMOverride = typeof context?.callLLM === 'function';
    const explicitSecondary = _normalizeProviderKey(context?.secondaryProvider);
    if (explicitSecondary && explicitSecondary !== primaryProvider && !secondaryProviders.includes(explicitSecondary)) {
      const hasProvidersRegistry = typeof QuizProviders !== 'undefined' && QuizProviders && QuizProviders.PROVIDERS;
      let canUseExplicitSecondary = hasLLMOverride;
      if (!canUseExplicitSecondary && hasProvidersRegistry &&
          Object.prototype.hasOwnProperty.call(QuizProviders.PROVIDERS, explicitSecondary)) {
        canUseExplicitSecondary = _isProviderConfigured(explicitSecondary, mergedConfig);
      }
      if (canUseExplicitSecondary) {
        secondaryProviders = [explicitSecondary, ...secondaryProviders];
      }
    }

    const serpApiKey = typeof mergedConfig.serpApiKey === 'string' ? mergedConfig.serpApiKey.trim() : '';
    const webSearchConfigured = typeof context?.searchFn === 'function' ||
      (serpApiKey.length > 0 && (syncConfig.agenticSearch === true || settings.agenticSearch === true || context?.useWebSearch === true));

    // Sélectionner les questions < threshold (plus faibles confiances en premier, max 5)
    const candidateIndices = resultAnswers
      .map((ans, idx) => ({ idx, confidence: ans.confidence, questionIndex: ans.questionIndex }))
      .filter(item => item.confidence < threshold)
      .sort((a, b) => (a.confidence - b.confidence) || (a.questionIndex - b.questionIndex))
      .slice(0, maxQuestions)
      .map(item => item.idx);

    if (candidateIndices.length === 0) {
      return resultAnswers;
    }

    // Dégradation gracieuse si aucune source de validation secondaire n'est disponible
    if (secondaryProviders.length === 0 && !webSearchConfigured) {
      if (journal) _log(journal, 'cross_val_skip', 'Cross-validation ignorée : aucun provider secondaire ni recherche web disponible.');
      return resultAnswers;
    }
    if (secondaryProviders.length === 0 && !primaryProvider && !hasLLMOverride) {
      if (journal) _log(journal, 'cross_val_skip', 'Cross-validation ignorée : aucun provider disponible.');
      return resultAnswers;
    }

    const cvAbort = new AbortController();
    const rawTimeoutMs = context?.timeoutMs;
    const timeoutMs = (typeof rawTimeoutMs === 'number' && Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0)
      ? rawTimeoutMs
      : CROSS_VALIDATION_TIMEOUT_MS;
    const timeoutId = setTimeout(() => cvAbort.abort(), timeoutMs);
    const onExternalAbort = () => cvAbort.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        cvAbort.abort();
      } else if (typeof externalSignal.addEventListener === 'function') {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    const llmCaller = hasLLMOverride ? context.callLLM : _callLLMWithTools;
    const searchCaller = typeof context?.searchFn === 'function' ? context.searchFn : _executeSingleSearch;
    const contextImages = Array.isArray(context?.contextImages)
      ? _mergeRequestImages(context.contextImages, [])
      : _extractContextMedia(syncConfig.contextFiles).imageFiles;

    try {
      for (const idx of candidateIndices) {
        if (cvAbort.signal.aborted) {
          break;
        }

        const primaryAns = resultAnswers[idx];
        const q = questions.find((item, qPos) => item && typeof item === 'object' && ((typeof item.index === 'number' ? item.index - 1 : qPos) === primaryAns.questionIndex))
          || questions[primaryAns.questionIndex];
        if (!q || typeof q !== 'object') {
          continue;
        }

        try {
          let searchEvidence = '';
          if (webSearchConfigured && typeof q.text === 'string' && q.text.trim().length > 0) {
            try {
              const query = q.text.replace(/\s+/g, ' ').trim().slice(0, 140);
              const rawSearch = await searchCaller(query, serpApiKey, cvAbort.signal);
              if (!cvAbort.signal.aborted && typeof rawSearch === 'string' && rawSearch.trim().length > 0 &&
                  !rawSearch.startsWith('Échec de la recherche') &&
                  !rawSearch.startsWith('Aucun résultat')) {
                searchEvidence = rawSearch.trim();
              }
            } catch (_) {
              searchEvidence = '';
            }
          }

          if (cvAbort.signal.aborted) {
            break;
          }

          // Strictement un provider distinct du primaryProvider lorsqu'disponible
          const candidateProviders = secondaryProviders.length > 0
            ? secondaryProviders
            : (searchEvidence && primaryProvider ? [primaryProvider] : []);

          if (candidateProviders.length === 0) {
            continue;
          }

          const singleQ = {
            ...q,
            index: 1,
            type: q.type || (Array.isArray(q.options) && q.options.length > 0 ? 'radio' : 'text')
          };
          const prompts = _buildVerificationPrompt(singleQ, context?.baseContextText || '', searchEvidence, {
            ...syncConfig,
            ...settings
          }, contextImages);
          const verifyImages = _mergeRequestImages(contextImages, q.images || []);

          let secAns = null;
          let usedProvider = null;

          for (const secProvider of candidateProviders) {
            if (cvAbort.signal.aborted) {
              break;
            }
            try {
              const hasImages = verifyImages.length > 0;
              const modelId = (typeof QuizProviders !== 'undefined' && QuizProviders?.PROVIDERS &&
                Object.prototype.hasOwnProperty.call(QuizProviders.PROVIDERS, secProvider))
                ? QuizProviders.getModelForContext(secProvider, hasImages, syncConfig.customModels || {})
                : (context?.secondaryModel || 'default');
              const messages = _initHistory(secProvider, prompts.system, prompts.user);
              const resp = await llmCaller(
                secProvider,
                mergedConfig,
                modelId,
                messages,
                verifyImages,
                [],
                cvAbort.signal
              );
              if (cvAbort.signal.aborted) {
                break;
              }
              const parsed = _parseAIResponse(resp?.text || '', [singleQ]);
              if (parsed.length > 0) {
                const candidateAns = normalizeAnswerEntry(parsed[0]);
                const meta = _getNormalizedQuestionMeta(singleQ);
                const isPureChoice = !meta.isMultiSelectMatching && !meta.isDragDrop && !meta.isTextLike &&
                  (meta.rawType === 'radio' || meta.rawType === 'checkbox' || meta.normType === 'single_choice' || meta.normType === 'multi_choice' || meta.options.length > 0);
                const hasValidIndices = candidateAns.optionIndices.length > 0 &&
                  (meta.effectiveOptions.length === 0 || candidateAns.optionIndices.every(i => i >= 0 && i < meta.effectiveOptions.length));
                const hasText = typeof candidateAns.textAnswer === 'string' && candidateAns.textAnswer.trim().length > 0;
                const hasActionable = isPureChoice ? hasValidIndices : (hasValidIndices || hasText);
                if (hasActionable) {
                  secAns = candidateAns;
                  usedProvider = secProvider;
                  break;
                }
              }
            } catch (_) {
              // Essayer le prochain provider secondaire
            }
          }

          if (cvAbort.signal.aborted || !secAns || !usedProvider) {
            continue;
          }

          const agreed = _answersAgree(primaryAns, secAns, q);
          const evidenceTag = searchEvidence ? ' + web_search' : '';

          if (agreed) {
            const boostedConfidence = Math.min(98, Math.max(primaryAns.confidence, secAns.confidence) + 12);
            const note = `Confirmed by ${usedProvider}${evidenceTag} (${secAns.confidence}%).`;
            resultAnswers[idx] = normalizeAnswerEntry({
              ...primaryAns,
              confidence: boostedConfidence,
              explanation: primaryAns.explanation || secAns.explanation,
              crossValidated: true,
              crossValidationStatus: 'confirmed',
              crossValidationNote: note
            });
          } else {
            const preferSecondary = (secAns.confidence > primaryAns.confidence) ||
              (Boolean(searchEvidence) && secAns.confidence >= primaryAns.confidence);
            const cappedConfidence = Math.min(60, preferSecondary ? secAns.confidence : primaryAns.confidence);
            const note = preferSecondary
              ? `Disputed: adopted ${usedProvider} (${secAns.confidence}% vs ${primaryAns.confidence}%)${evidenceTag}.`
              : `Disputed with ${usedProvider} (${primaryAns.confidence}% vs ${secAns.confidence}%)${evidenceTag}.`;

            resultAnswers[idx] = normalizeAnswerEntry({
              ...primaryAns,
              optionIndices: preferSecondary ? secAns.optionIndices : primaryAns.optionIndices,
              textAnswer: preferSecondary ? secAns.textAnswer : primaryAns.textAnswer,
              raw: preferSecondary ? secAns.raw : primaryAns.raw,
              confidence: cappedConfidence,
              explanation: (preferSecondary && secAns.explanation) ? secAns.explanation : primaryAns.explanation,
              crossValidated: true,
              crossValidationStatus: 'disputed',
              crossValidationNote: note
            });
          }
        } catch (err) {
          if (journal) _log(journal, 'cross_val_err', `Erreur cross-validation Q${primaryAns.questionIndex + 1}: ${_sanitizeErrorMessage(err, mergedConfig)}`);
        }
      }
    } finally {
      clearTimeout(timeoutId);
      if (externalSignal && typeof externalSignal.removeEventListener === 'function') {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }

    return resultAnswers;
  }

  /**
   * Calcule le score de complexité d'un quiz pour déterminer s'il doit être routé
   * vers le Fast Path ou l'Agent Path.
   * Preconditions: task est un objet, task.questions est un tableau.
   * @param {Object} task
   * @returns {number}
   */
  function _computeComplexityScore(task) {
    if (!task || typeof task !== 'object') {
      throw new Error('_computeComplexityScore: task doit être un objet.');
    }
    if (!Array.isArray(task.questions)) {
      throw new Error('_computeComplexityScore: task.questions doit être un tableau.');
    }

    let score = 0;

    // Nombre de questions
    if (task.questions.length >= 3) {
      score += 3;
    }

    // Longueur totale des questions
    let totalChars = 0;
    for (const q of task.questions) {
      totalChars += (q.text || '').length;
      if (_getNormalizedQuestionMeta(q).isTextLike) {
        score += 2; // +2 par question ouverte / texte à trous
      }
    }
    if (totalChars > 1000) {
      score += 2;
    }

    // Images (quiz ou notes de cours)
    const syncConfig = task.config?.syncConfig || {};
    const contextText = syncConfig.contextText || '';
    const contextFiles = syncConfig.contextFiles || [];
    const { imageFiles: contextImages } = _extractContextMedia(contextFiles);
    const hasImages = task.questions.some(q => _getValidQuestionImages(q).length > 0) || contextImages.length > 0;
    if (hasImages) {
      score += 1;
    }

    // Contexte utilisateur
    if (contextText.trim().length > 0 || contextFiles.length > 0) {
      score += 1;
    }

    // SerpAPI activé
    const searchEnabled = syncConfig.agenticSearch === true &&
                          typeof syncConfig.serpApiKey === 'string' &&
                          syncConfig.serpApiKey.length > 0;
    if (searchEnabled) {
      score += 2;
    }

    // Thinking mode
    const settings = task.config?.settings || {};
    if (settings.thinkingMode === true) {
      score += 1;
    }

    return score;
  }

  /**
   * Résout le quiz via le Fast Path (un seul appel LLM direct, sans boucle ReAct, sans outils).
   * Si la confiance moyenne est <= 20% ou si toutes les questions ne sont pas répondues,
   * retourne null pour forcer l'escalade vers l'Agent Path.
   * Preconditions: task est un objet, journal est un tableau.
   * @param {Object} task
   * @param {Array} journal
   * @param {AbortSignal} signal
   * @returns {Promise<Object|null>}
   */
  async function _solveFastPath(task, journal, signal) {
    if (!task || typeof task !== 'object') {
      throw new Error('_solveFastPath: task doit être un objet.');
    }
    if (!Array.isArray(journal)) {
      throw new Error('_solveFastPath: journal doit être un tableau.');
    }

    const startTime = Date.now();
    const syncConfig = task.config?.syncConfig || {};
    const apiKeys = task.config?.apiKeys || {};
    const mergedConfig = { ...syncConfig, ...apiKeys };
    const settings = task.config?.settings || {};

    // Trouver le provider key
    let providerKey = settings.selectedProvider && settings.selectedProvider !== 'auto'
      ? _normalizeProviderKey(settings.selectedProvider)
      : null;

    if (providerKey && !_isProviderConfigured(providerKey, mergedConfig)) {
      providerKey = null;
    }

    if (!providerKey) {
      if (typeof QuizProviders.getFirstConfiguredProvider === 'function') {
        providerKey = QuizProviders.getFirstConfiguredProvider(
          mergedConfig,
          syncConfig.providerOrder || QuizProviders.DEFAULT_PRIORITY
        );
      } else {
        providerKey = _getAllConfiguredProviders(task.config, syncConfig.providerOrder)[0] || null;
      }
    }

    if (!providerKey) {
      _log(journal, 'fast_path_fail', 'Aucun provider configuré pour le Fast Path');
      return null;
    }

    // Contexte utilisateur
    const rawContextText = syncConfig.contextText || '';
    const contextFiles = Array.isArray(syncConfig.contextFiles) ? syncConfig.contextFiles : [];
    const { imageFiles: contextImages } = _extractContextMedia(contextFiles);

    const questionImages = [];
    for (const q of task.questions) {
      for (const img of _getValidQuestionImages(q)) {
        questionImages.push(img);
      }
    }
    const uniqueQuestionImages = _mergeRequestImages([], questionImages);
    const quizData = {
      questions: task.questions,
      totalImages: uniqueQuestionImages.length
    };
    const allImages = _mergeRequestImages(contextImages, uniqueQuestionImages);

    const hasImages = allImages.length > 0;
    const modelId = QuizProviders.getModelForContext(providerKey, hasImages, (syncConfig.customModels || {}));

    _log(journal, 'fast_path_start', `Démarrage Fast Path avec ${providerKey} (${modelId})`);

    const initialPrompts = await _buildPrompt(quizData, rawContextText, contextFiles, { ...syncConfig, ...settings });

    // Messages pour le provider
    const messages = _initHistory(providerKey, initialPrompts.system, initialPrompts.user);

    try {
      // Un seul appel direct sans outils
      const response = await _callLLMWithTools(
        providerKey,
        mergedConfig,
        modelId,
        messages,
        allImages,
        [], // Aucun outil
        signal
      );

      const parsedAnswers = _parseAIResponse(response.text, task.questions);
      _log(journal, 'fast_path_parsed', `${parsedAnswers.length}/${task.questions.length} questions résolues en Fast Path`);

      // Filet de sécurité 1: Toutes les questions doivent avoir une réponse
      if (parsedAnswers.length === 0) {
        _log(journal, 'fast_path_escalate', 'Aucune réponse analysée en Fast Path. Escalade vers l\'Agent Path.');
        return null;
      }
      const answeredIndices = new Set(parsedAnswers.map(ans => ans.questionIndex));
      const missingCount = task.questions.filter((q, idx) => !answeredIndices.has(typeof q.index === 'number' ? q.index - 1 : idx)).length;
      if (missingCount > 0) {
        _log(journal, 'fast_path_escalate', `Fast Path incomplet (${missingCount} manquantes). Escalade vers l'Agent Path.`);
        return null;
      }

      // Filet de sécurité 2: Confiance moyenne > 20%
      const totalConfidence = parsedAnswers.reduce(
        (sum, ans) => sum + (typeof ans.confidence === 'number' && Number.isFinite(ans.confidence) ? ans.confidence : 50),
        0
      );
      const avgConfidence = totalConfidence / parsedAnswers.length;

      if (avgConfidence <= 20) {
        _log(journal, 'fast_path_escalate', `Confiance moyenne trop faible (${avgConfidence.toFixed(1)}% <= 20%). Escalade vers l'Agent Path.`);
        return null;
      }

      _log(journal, 'fast_path_success', `Fast Path validé avec une confiance moyenne de ${avgConfidence.toFixed(1)}%`);

      return {
        success: true,
        answers: parsedAnswers,
        metadata: {
          provider: providerKey,
          model: response.model || modelId,
          questionsTotal: task.questions.length,
          answersFound: parsedAnswers.length,
          searchQueriesRun: 0,
          chunksProcessed: 1,
          retriesUsed: 0,
          totalDurationMs: Date.now() - startTime
        },
        journal
      };
    } catch (e) {
      if (signal && signal.aborted) {
        throw _createSanitizedError(e, task && task.config);
      }
      _log(journal, 'fast_path_err', `Erreur Fast Path: ${_sanitizeErrorMessage(e, task && task.config)}. Escalade vers l'Agent Path.`);
      return null;
    }
  }

  // ────────────────────────────────────────────────
  // PUBLIC API
  // ────────────────────────────────────────────────

  /**
   * Point d'entrée principal de l'agent.
   * Reçoit une tâche complète et retourne les réponses via boucle ReAct.
   *
   * @param {Object} task
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async function solve(task, options = {}) {
    if (!task || typeof task !== 'object') {
      throw new Error('BackgroundAgent.solve: task doit être un objet.');
    }
    if (!Array.isArray(task.questions) || task.questions.length === 0) {
      throw new Error('BackgroundAgent.solve: task.questions doit être un tableau non vide.');
    }
    if (!task.config || typeof task.config !== 'object') {
      throw new Error('BackgroundAgent.solve: task.config doit être un objet.');
    }

    const journal = [];
    const startTime = Date.now();

    // AbortController global avec timeout maximal + signal externe (Panic / fermeture de port)
    const globalAbort = new AbortController();
    const externalSignal = (options && options.signal) || (task && task.signal) || null;
    const onExternalAbort = () => globalAbort.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        globalAbort.abort();
      } else if (typeof externalSignal.addEventListener === 'function') {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }
    const globalTimer = setTimeout(() => globalAbort.abort(), MAX_TOTAL_TIMEOUT_MS);
    const report = (step, percent) => {
      if (!globalAbort.signal.aborted) {
        _reportProgress(task.tabId, step, percent, task.startedAt || startTime);
      }
    };

    try {
      if (globalAbort.signal.aborted) {
        throw new Error('Résolution annulée');
      }
      _log(journal, 'agent_start', `Agent démarré pour ${task.questions.length} question(s)`);
      report('Analyse démarrée…', 15);

      const settings = task.config.settings || {};
      const effectiveSyncConfig = { ...(task.config.syncConfig || {}) };
      const effectiveApiKeys = { ...(task.config.apiKeys || {}) };
      const isServiceWorkerCtx = typeof ServiceWorkerGlobalScope !== 'undefined' &&
        self instanceof ServiceWorkerGlobalScope;
      const intelKeys = ['domainPreset', 'customDomainRules', 'crossValidationEnabled', 'crossValidationThreshold'];
      if (isServiceWorkerCtx || intelKeys.some(k => effectiveSyncConfig[k] === undefined && settings[k] === undefined)) {
        if (isServiceWorkerCtx) {
          delete effectiveSyncConfig.providerConfigs;
          delete effectiveApiKeys.providerConfigs;
        }
        if (typeof chrome !== 'undefined' && chrome.storage) {
          try {
            const needContextFiles = effectiveSyncConfig.contextFiles === undefined;
            const localReadKeys = isServiceWorkerCtx
              ? [...intelKeys, 'providerConfigs', ...(needContextFiles ? ['contextFiles'] : [])]
              : [...intelKeys, ...(needContextFiles ? ['contextFiles'] : [])];
            const localData = (chrome.storage.local && typeof chrome.storage.local.get === 'function')
              ? await chrome.storage.local.get(localReadKeys)
              : {};
            const syncData = (chrome.storage.sync && typeof chrome.storage.sync.get === 'function')
              ? await chrome.storage.sync.get(intelKeys)
              : {};
            const mergedStored = { ...(syncData || {}), ...(localData || {}) };
            for (const k of intelKeys) {
              if (effectiveSyncConfig[k] === undefined && settings[k] === undefined && mergedStored[k] !== undefined) {
                effectiveSyncConfig[k] = mergedStored[k];
              }
            }
            if (needContextFiles && Array.isArray(localData?.contextFiles)) {
              effectiveSyncConfig.contextFiles = localData.contextFiles;
            }
            if (isServiceWorkerCtx) {
              const trustedCfgs = (localData && localData.providerConfigs && typeof localData.providerConfigs === 'object')
                ? localData.providerConfigs
                : {};
              effectiveSyncConfig.providerConfigs = trustedCfgs;
              effectiveApiKeys.providerConfigs = trustedCfgs;
            }
          } catch (_) {
            // Ignorer les erreurs storage en environnement de test
          }
        }
      }
      const effectiveConfig = { ...task.config, syncConfig: effectiveSyncConfig, apiKeys: effectiveApiKeys };
      const effectiveTask = { ...task, config: effectiveConfig };
      const crossValidationEnabled =
        settings.crossValidationEnabled === true ||
        effectiveSyncConfig.crossValidationEnabled === true;

      // ─── Routage adaptatif (Fast Path vs Agent Path) ───
      const complexityScore = _computeComplexityScore(effectiveTask);
      _log(journal, 'routing_eval', `Score de complexité calculé: ${complexityScore} (Seuil Fast <= 3)`);

      if (globalAbort.signal.aborted) {
        throw new Error('Résolution annulée');
      }
      if (complexityScore <= 3) {
        report('Analyse rapide…', 18);
        const fastResult = await _solveFastPath(effectiveTask, journal, globalAbort.signal);
        if (globalAbort.signal.aborted) {
          throw new Error('Résolution annulée');
        }
        if (fastResult) {
          let finalFastAnswers = (fastResult.answers || []).map(normalizeAnswerEntry);
          if (crossValidationEnabled && !globalAbort.signal.aborted) {
            report('Double vérification…', 90);
            const { textFiles: fastTextFiles, imageFiles: fastContextImages } = _extractContextMedia(effectiveSyncConfig.contextFiles);
            const fastContextText = _buildCombinedContextText(effectiveSyncConfig.contextText || '', fastTextFiles);
            finalFastAnswers = await crossValidateAnswers(finalFastAnswers, task.questions, {
              primaryProvider: fastResult.metadata?.provider || null,
              config: effectiveConfig,
              baseContextText: fastContextText,
              contextImages: fastContextImages,
              journal,
              signal: globalAbort.signal
            });
          }
          if (globalAbort.signal.aborted) {
            throw new Error('Résolution annulée');
          }
          fastResult.answers = finalFastAnswers.map(normalizeAnswerEntry);
          fastResult.metadata.answersFound = fastResult.answers.length;
          fastResult.metadata.crossValidatedCount = fastResult.answers.filter(a => a.crossValidated).length;
          clearTimeout(globalTimer);
          return fastResult;
        }
        _log(journal, 'routing_fallback', 'Fast Path rejeté ou échoué. Basculement vers l\'Agent Path.');
      }

      if (globalAbort.signal.aborted) {
        throw new Error('Résolution annulée');
      }
      _log(journal, 'routing_agent', 'Démarrage de l\'Agent Path complet (ReAct loop)...');

      // ─── Phase 1 : Planning ───
      const plan = await _planStrategy(effectiveTask, journal, globalAbort.signal);
      if (globalAbort.signal.aborted) {
        throw new Error('Résolution annulée');
      }
      report('Découpage des questions…', 20);

      // Contexte de base : texte brut + texte combiné pour cross-validation
      const rawContextText = plan.rawContextText !== undefined ? plan.rawContextText : plan.baseContextText;
      const baseContextText = plan.baseContextText;
      const contextFiles = plan.contextFiles;
      const contextImages = Array.isArray(plan.contextImages) ? plan.contextImages : [];

      let allParsedAnswers = [];
      let searchQueriesRun = 0;
      let providerKey = plan.providerKey;
      let lastUsedModel = '';

      // Boucle sur chaque chunk
      for (let i = 0; i < plan.chunks.length; i++) {
        if (globalAbort.signal.aborted) {
          throw new Error('Résolution annulée');
        }

        const chunk = plan.chunks[i];
        const progressPercent = Math.min(75, 25 + Math.round((i / plan.chunks.length) * 50));
        report(`Lot ${i + 1}/${plan.chunks.length}…`, progressPercent);

        _log(journal, 'llm_chunk', `Traitement Chunk ${i + 1}/${plan.chunks.length}: ${chunk.questions.length} questions`);

        // Cascade de secours sur les providers configurés
        let chunkResult = null;
        let attemptProviders = [providerKey];
        const otherConfigured = _getAllConfiguredProviders(effectiveConfig, effectiveSyncConfig.providerOrder);
        for (const p of otherConfigured) {
          if (!attemptProviders.includes(p)) {
            attemptProviders.push(p);
          }
        }

        let lastError = null;
        for (const pKey of attemptProviders) {
          try {
            if (pKey !== providerKey) {
              _log(journal, 'plan_fallback_switch', `Provider précédent échoué. Basculement vers le provider de secours: "${pKey}"`);
            }
            // Exécuter la boucle ReAct pour ce chunk
            chunkResult = await _executeReActLoop(
              effectiveTask,
              chunk,
              rawContextText,
              contextFiles,
              pKey,
              journal,
              globalAbort.signal
            );
            // Si ça réussit, on met à jour providerKey pour les chunks suivants
            providerKey = pKey;
            lastError = null;
            break;
          } catch (err) {
            _log(journal, 'llm_chunk_fail', `Échec du provider "${pKey}" pour le chunk ${i + 1}: ${_sanitizeErrorMessage(err, effectiveConfig)}`);
            lastError = _createSanitizedError(err, effectiveConfig);
            if (globalAbort.signal.aborted) {
              throw lastError;
            }
          }
        }

        if (!chunkResult) {
          throw lastError || new Error(`Tous les providers ont échoué pour le chunk ${i + 1}`);
        }

        if (chunkResult.model) {
          lastUsedModel = chunkResult.model;
        }

        if (chunkResult.answers && chunkResult.answers.length > 0) {
          // Fusionner les réponses du chunk
          for (const ans of chunkResult.answers) {
            if (ans && typeof ans.questionIndex === 'number') {
              allParsedAnswers[ans.questionIndex] = ans;
            }
          }
        }
        searchQueriesRun += chunkResult.searchCount;
      }

      // Nettoyer les éléments vides/undefined du tableau answers
      const cleanedAnswers = allParsedAnswers.filter(ans => ans !== undefined);

      if (globalAbort.signal.aborted) {
        throw new Error('Résolution annulée');
      }

      // ─── Phase 4 : Validation (Ralph Loop) ───
      const validated = await _validateAndRetry(
        effectiveTask,
        { answers: cleanedAnswers, provider: providerKey, model: lastUsedModel, chunksProcessed: plan.chunks.length },
        rawContextText,
        plan,
        journal,
        globalAbort.signal
      );
      if (globalAbort.signal.aborted) {
        throw new Error('Résolution annulée');
      }

      let finalAnswers = (validated.answers || []).map(normalizeAnswerEntry);
      if (crossValidationEnabled && !globalAbort.signal.aborted) {
        report('Double vérification…', 90);
        finalAnswers = await crossValidateAnswers(finalAnswers, task.questions, {
          primaryProvider: providerKey,
          config: effectiveConfig,
          baseContextText,
          contextImages,
          journal,
          signal: globalAbort.signal
        });
      }
      if (globalAbort.signal.aborted) {
        throw new Error('Résolution annulée');
      }
      finalAnswers = finalAnswers.map(normalizeAnswerEntry);

      report('Analyse terminée', 95);

      const result = {
        success: true,
        answers: finalAnswers,
        metadata: {
          provider: providerKey,
          model: validated.model || '',
          questionsTotal: task.questions.length,
          answersFound: finalAnswers.length,
          searchQueriesRun: searchQueriesRun,
          chunksProcessed: plan.chunks.length,
          retriesUsed: validated.retriesUsed,
          crossValidatedCount: finalAnswers.filter(a => a.crossValidated).length,
          totalDurationMs: Date.now() - startTime
        },
        journal
      };

      _log(journal, 'agent_end', `Terminé: ${finalAnswers.length}/${task.questions.length} réponses en ${result.metadata.totalDurationMs}ms`);
      return result;

    } catch (error) {
      const wasAborted = globalAbort.signal.aborted;
      const safeFatalMessage = _sanitizeErrorMessage(error, task && task.config);
      _log(journal, 'agent_fatal', `Erreur fatale: ${safeFatalMessage}`);
      return {
        success: false,
        cancelled: wasAborted,
        answers: [],
        metadata: {
          provider: '',
          model: '',
          questionsTotal: task.questions.length,
          answersFound: 0,
          searchQueriesRun: 0,
          chunksProcessed: 0,
          retriesUsed: 0,
          totalDurationMs: Date.now() - startTime
        },
        journal,
        error: safeFatalMessage
      };
    } finally {
      clearTimeout(globalTimer);
      if (externalSignal && typeof externalSignal.removeEventListener === 'function') {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
      try {
        const qp = typeof QuizProviders !== 'undefined' ? QuizProviders : (typeof globalThis !== 'undefined' ? globalThis.QuizProviders : null);
        const analytics = qp && qp.ProviderAnalytics ? qp.ProviderAnalytics : null;
        if (analytics && typeof analytics.flush === 'function' && typeof analytics.getStats === 'function') {
          const curStats = analytics.getStats();
          if (curStats && curStats.totals && curStats.totals.requests > 0) {
            await analytics.flush();
          }
        }
      } catch (_) { /* non-blocking telemetry flush */ }
    }
  }

  /**
   * Helper pour lister tous les providers configurés dans l'ordre de priorité.
   */
  function _getAllConfiguredProviders(config, order) {
    const syncConfig = config.syncConfig || {};
    const apiKeys = config.apiKeys || {};
    const mergedConfig = { ...syncConfig, ...apiKeys };
    const priority = Array.isArray(order) ? order : (syncConfig.providerOrder || QuizProviders.DEFAULT_PRIORITY);
    const configured = [];
    for (const rawKey of priority) {
      const pKey = _normalizeProviderKey(rawKey);
      if (!pKey || !Object.prototype.hasOwnProperty.call(QuizProviders.PROVIDERS, pKey)) {
        continue;
      }
      if (_isProviderConfigured(pKey, mergedConfig) && !configured.includes(pKey)) {
        configured.push(pKey);
      }
    }
    if (configured.length === 0) {
      for (const pKey of Object.keys(QuizProviders.PROVIDERS)) {
        if (_isProviderConfigured(pKey, mergedConfig) && !configured.includes(pKey)) {
          configured.push(pKey);
        }
      }
    }
    return configured.length > 0 ? configured : priority;
  }

  // ────────────────────────────────────────────────
  // PHASE 1 — PLANNING
  // ────────────────────────────────────────────────

  async function _planStrategy(task, journal, signal) {
    const config = task.config;
    const syncConfig = config.syncConfig || {};

    const settings = config.settings || {};
    const apiKeys = config.apiKeys || {};
    const mergedConfig = { ...syncConfig, ...apiKeys };

    let providerKey = _normalizeProviderKey(settings.selectedProvider);

    // Si un provider spécifique est sélectionné, on vérifie qu'il est correctement configuré
    if (providerKey) {
      if (!_isProviderConfigured(providerKey, mergedConfig)) {
        _log(journal, 'plan_fallback', `Le provider sélectionné "${providerKey}" n'est pas configuré. Recherche d'un fallback intelligent...`);
        providerKey = null;
      }
    }

    // Routage intelligent de secours : recherche du premier provider configuré
    if (!providerKey) {
      if (typeof QuizProviders.getFirstConfiguredProvider === 'function') {
        providerKey = QuizProviders.getFirstConfiguredProvider(
          mergedConfig,
          syncConfig.providerOrder || QuizProviders.DEFAULT_PRIORITY
        );
      } else {
        providerKey = _getAllConfiguredProviders(config, syncConfig.providerOrder)[0];
      }
    }

    // Base context text + files + images
    const rawContextText = syncConfig.contextText || '';
    const contextFiles = Array.isArray(syncConfig.contextFiles) ? syncConfig.contextFiles : [];
    const { textFiles, imageFiles: contextImages } = _extractContextMedia(contextFiles);
    const fullContextText = _buildCombinedContextText(rawContextText, textFiles);
    const contextImageTokens = contextImages.reduce((acc, img) => acc + _estimateImageTokens(img), 0);
    const baseTokens = _estimateTokens(fullContextText) + contextImageTokens;

    // Découper en chunks
    const chunks = _createQuizChunks(task.questions, providerKey, baseTokens, syncConfig, contextImages.length > 0);

    // Stratégie dérivée directement de la configuration utilisateur (pas d'appel LLM préliminaire)
    const strategy = { useSearch: syncConfig.agenticSearch === true, analysis: 'standard' };

    const plan = {
      providerKey,
      rawContextText,
      baseContextText: fullContextText,
      contextFiles,
      contextImages,
      baseTokens,
      chunks,
      strategy
    };

    _log(journal, 'plan', `Provider=${providerKey}, Chunks=${chunks.length}`);
    return plan;
  }

  // ────────────────────────────────────────────────
  // CORE REACT LOOP
  // ────────────────────────────────────────────────

  /**
   * Exécute la boucle Reasoning & Acting (ReAct) pour un chunk.
   *
   * @param {Object} task
   * @param {Object} chunk
   * @param {string} rawContextText
   * @param {Array} contextFiles
   * @param {string} providerKey
   * @param {Array} journal
   * @param {AbortSignal} signal
   * @returns {Promise<{answers: Array, searchCount: number, model: string}>}
   */
  async function _executeReActLoop(task, chunk, rawContextText, contextFiles, providerKey, journal, signal) {
    const config = task.config;
    const syncConfig = config.syncConfig;
    const { imageFiles: contextImages } = _extractContextMedia(contextFiles);
    const chunkQuestionImages = [];
    for (const q of chunk.questions) {
      for (const img of _getValidQuestionImages(q)) {
        chunkQuestionImages.push(img);
      }
    }
    const uniqueChunkQuestionImages = _mergeRequestImages([], chunkQuestionImages);
    const allImages = _mergeRequestImages(contextImages, uniqueChunkQuestionImages);
    const requiresVision = allImages.length > 0;
    const modelId = QuizProviders.getModelForContext(providerKey, requiresVision, (syncConfig.customModels || {}));

    const searchEnabled = syncConfig.agenticSearch === true &&
                          typeof syncConfig.serpApiKey === 'string' &&
                          syncConfig.serpApiKey.length > 0;
    const serpApiKey = syncConfig.serpApiKey;

    const chunkQuizData = {
      questions: chunk.questions,
      totalImages: uniqueChunkQuestionImages.length
    };

    const initialPrompts = await _buildPrompt(chunkQuizData, rawContextText, contextFiles, {
      ...(syncConfig || {}),
      ...(config.settings || {})
    });

    // Définir les outils disponibles pour le modèle
    const tools = [];
    if (searchEnabled) {
      tools.push({
        name: 'web_search',
        description: 'Recherche des informations sur internet pour répondre à une question de culture générale ou technique complexe.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Requête textuelle de recherche Google.'
            }
          },
          required: ['query']
        }
      });
    }

    tools.push({
      name: 'submit_answers',
      description: 'Soumet la liste finale des réponses pour le quiz en cours.',
      parameters: {
        type: 'object',
        properties: {
          thought_process: {
            type: 'string',
            description: 'Etape de réflexion interne. Analyse les options pour chaque question et justifie ton choix AVANT de fournir le tableau answers.'
          },
          answers: {
            type: 'array',
            description: 'Les réponses pour chaque question demandée.',
            items: {
              type: 'object',
              properties: {
                questionIndex: {
                  type: 'integer',
                  description: 'L\'index de la question (0-indexed).'
                },
                answers: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Les réponses choisies ou saisies (par exemple : index de l\'option, texte exact).'
                },
                explanation: {
                  type: 'string',
                  description: 'Brève explication de la réponse.'
                },
                confidence: {
                  type: 'integer',
                  description: 'Niveau de confiance auto-évalué de 0 à 100.'
                }
              },
              required: ['questionIndex', 'answers']
            }
          }
        },
        required: ['answers']
      }
    });

    // Initialiser l'historique des messages selon le provider
    let messages = _initHistory(providerKey, initialPrompts.system, initialPrompts.user);

    let turn = 0;
    let searchCount = 0;
    let answers = [];
    let finalModel = modelId;
    const executedSearches = new Set();

    // Concept AION 2.0 (Deferred Loading/Bypass) : Si SerpAPI est désactivé, on élimine 
    // l'overhead du tool-calling pour maximiser la vitesse de génération directe.
    const mergedRuntimeConfig = { ...(syncConfig || {}), ...(config.apiKeys || {}) };

    if (!searchEnabled) {
      _log(journal, 'react_direct_bypass', 'SerpAPI désactivé, basculement en mode direct ultra-rapide.');
      const response = await _callLLMWithTools(
        providerKey,
        mergedRuntimeConfig,
        modelId,
        messages,
        allImages,
        [], // Aucun outil
        signal
      );
      answers = _parseAIResponse(response.text, chunk.questions);
      return { answers, searchCount: 0, model: response.model || modelId };
    }

    _log(journal, 'react_loop_start', `Début boucle ReAct pour ${chunk.questions.length} questions`);

    while (turn < MAX_TURNS) {
      if (signal.aborted) {
        throw new Error('Résolution annulée durant la boucle ReAct');
      }

      turn++;
      _log(journal, 'react_turn', `Tour ${turn}/${MAX_TURNS}`);

      // 1. Appeler le LLM avec l'historique des messages et les outils
      const response = await _callLLMWithTools(
        providerKey,
        mergedRuntimeConfig,
        modelId,
        messages,
        allImages,
        tools,
        signal
      );

      if (response.model) {
        finalModel = response.model;
      }

      _log(journal, 'react_response', `Reçu du modèle: textLength=${response.text.length}, toolCalls=${response.toolCalls.length}`);

      // Mettre à jour l'historique avec le message de l'assistant/model
      messages = _appendAssistantMessage(providerKey, messages, response);

      // Si pas de tool call, ou si le modèle appelle submit_answers, on extrait et on s'arrête
      if (response.toolCalls.length === 0) {
        // Fallback sur le parsing de texte classique si aucun appel d'outil n'a été fait
        _log(journal, 'react_fallback_parse', 'Pas de tool call, parsing du texte brut...');
        answers = _parseAIResponse(response.text, chunk.questions);
        break;
      }

      // Parcourir les tool calls
      let hasSubmit = false;
      const toolResults = [];

      for (const call of response.toolCalls) {
        if (call.name === 'submit_answers') {
          hasSubmit = true;
          try {
            const args = typeof call.args === 'string' ? JSON.parse(call.args) : call.args;
            if (args && Array.isArray(args.answers)) {
              _log(journal, 'react_submit_tool', `Outil submit_answers appelé avec ${args.answers.length} réponses`);
              answers = _mapToolAnswersToParsedAnswers(args.answers, chunk.questions);
            }
          } catch (err) {
            _log(journal, 'react_tool_err', `Erreur de parsing des arguments de submit_answers: ${_sanitizeErrorMessage(err)}`);
          }
        } else if (call.name === 'web_search') {
          searchCount++;
          let queryStr = '';
          try {
            const args = typeof call.args === 'string' ? JSON.parse(call.args) : call.args;
            queryStr = args?.query || '';
          } catch (e) {
            queryStr = '';
          }

          if (queryStr) {
            const normalizedQuery = queryStr.trim().toLowerCase();
            if (executedSearches.has(normalizedQuery)) {
              _log(journal, 'react_search_blocked', `Requête déjà tentée bloquée pour éviter une boucle: "${queryStr}"`);
              toolResults.push({
                id: call.id,
                name: 'web_search',
                content: 'Erreur: Cette requête de recherche a déjà été tentée et a échoué. Modifie tes mots-clés ou résous le problème avec tes connaissances.'
              });
            } else {
              executedSearches.add(normalizedQuery);
              _log(journal, 'react_search_tool', `Outil web_search demandé pour query: "${queryStr}"`);
              const searchResult = await _executeSingleSearch(queryStr, serpApiKey, signal);
              toolResults.push({
                id: call.id,
                name: 'web_search',
                content: searchResult || 'Aucun résultat trouvé sur le web.'
              });
            }
          } else {
            toolResults.push({
              id: call.id,
              name: 'web_search',
              content: 'Erreur: argument "query" manquant.'
            });
          }
        } else {
          _log(journal, 'react_unknown_tool', `Outil inconnu demandé: ${call.name}`);
          toolResults.push({
            id: call.id,
            name: call.name,
            content: 'Erreur: outil non supporté.'
          });
        }
      }

      // S'il y a eu un submit_answers et qu'on a pu extraire des réponses valides, on s'arrête
      if (hasSubmit && answers.length > 0) {
        break;
      }

      // Mettre à jour l'historique avec les résultats d'outils
      if (toolResults.length > 0) {
        messages = _appendToolResults(providerKey, messages, toolResults);
        // Micro-compactor AION/Claude Code : supprime les anciens résultats de recherche pour économiser du contexte
        messages = _compactHistory(providerKey, messages, journal);
      } else {
        // Si on a des tool calls mais aucun résultat généré (ex: submit_answers échoué), on force le fallback text
        _log(journal, 'react_fallback_empty', 'Aucun résultat d\'outil exploitable, parsing du texte...');
        answers = _parseAIResponse(response.text, chunk.questions);
        break;
      }

      // Attendre un peu pour éviter les rate-limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (answers.length === 0) {
      _log(journal, 'react_empty_result', 'Attention: aucune réponse extraite pour ce chunk');
    }

    return { answers, searchCount, model: finalModel };
  }

  // ────────────────────────────────────────────────
  // TOOL CALLING MESSAGES ADAPTERS
  // ────────────────────────────────────────────────

  function _initHistory(providerKey, systemPrompt, userPrompt) {
    const providerType = _getProviderType(providerKey);
    if (providerType === 'gemini') {
      return {
        systemInstruction: systemPrompt,
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
      };
    } else if (providerType === 'claude') {
      return {
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      };
    } else {
      // OpenAI-compatible
      return {
        system: systemPrompt,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      };
    }
  }

  function _appendAssistantMessage(providerKey, history, response) {
    const providerType = _getProviderType(providerKey);
    if (providerType === 'gemini') {
      const parts = [];
      if (response.text) {
        parts.push({ text: response.text });
      }
      for (const call of response.toolCalls) {
        let argsObj = {};
        try {
          argsObj = typeof call.args === 'string' ? JSON.parse(call.args) : call.args;
        } catch (e) {
          argsObj = {};
        }
        parts.push({
          functionCall: {
            name: call.name,
            args: argsObj
          }
        });
      }
      history.contents.push({ role: 'model', parts });
      return history;
    } else if (providerType === 'claude') {
      const content = [];
      if (response.text) {
        content.push({ type: 'text', text: response.text });
      }
      for (const call of response.toolCalls) {
        let argsObj = {};
        try {
          argsObj = typeof call.args === 'string' ? JSON.parse(call.args) : call.args;
        } catch (e) {
          argsObj = {};
        }
        content.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: argsObj
        });
      }
      history.messages.push({ role: 'assistant', content });
      return history;
    } else {
      // OpenAI Compatible
      const msg = { role: 'assistant', content: response.text || null };
      if (response.toolCalls.length > 0) {
        msg.tool_calls = response.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: typeof call.args === 'string' ? call.args : JSON.stringify(call.args)
          }
        }));
      }
      history.messages.push(msg);
      return history;
    }
  }

  function _appendToolResults(providerKey, history, toolResults) {
    const providerType = _getProviderType(providerKey);
    if (providerType === 'gemini') {
      const parts = toolResults.map(res => ({
        functionResponse: {
          name: res.name,
          response: { result: res.content }
        }
      }));
      history.contents.push({ role: 'user', parts });
      return history;
    } else if (providerType === 'claude') {
      const content = toolResults.map(res => ({
        type: 'tool_result',
        tool_use_id: res.id,
        content: res.content
      }));
      history.messages.push({ role: 'user', content });
      return history;
    } else {
      // OpenAI
      for (const res of toolResults) {
        history.messages.push({
          role: 'tool',
          tool_call_id: res.id,
          name: res.name,
          content: res.content
        });
      }
      return history;
    }
  }

  /**
   * Estime le nombre cumulé de tokens dans l'historique.
   */
  function _estimateHistoryTokens(providerKey, history) {
    const providerType = _getProviderType(providerKey);
    let tokens = 0;
    try {
      if (providerType === 'gemini') {
        const contents = history.contents || [];
        contents.forEach(msg => {
          if (Array.isArray(msg.parts)) {
            msg.parts.forEach(part => {
              if (part.text) tokens += _estimateTokens(part.text);
              if (part.inlineData) tokens += _estimateImageTokens(part.inlineData);
              if (part.functionCall) tokens += _estimateTokens(JSON.stringify(part.functionCall.args));
              if (part.functionResponse) tokens += _estimateTokens(JSON.stringify(part.functionResponse.response));
            });
          }
        });
      } else {
        const messages = history.messages || [];
        messages.forEach(msg => {
          if (typeof msg.content === 'string') {
            tokens += _estimateTokens(msg.content);
          } else if (Array.isArray(msg.content)) {
            msg.content.forEach(block => {
              if (block.type === 'text') tokens += _estimateTokens(block.text);
              if (block.type === 'tool_result' && typeof block.content === 'string') tokens += _estimateTokens(block.content);
            });
          }
          if (msg.tool_calls) {
            tokens += _estimateTokens(JSON.stringify(msg.tool_calls));
          }
        });
      }
    } catch (e) {
      // Ignorer les erreurs d'estimation
    }
    return tokens;
  }

  /**
   * Compacte l'historique des résultats de recherche obsolètes (Micro-Compaction)
   * UNIQUEMENT en cas de dépassement d'un seuil critique de 150K tokens (seuil effectif d'attention).
   * Sinon, conserve 100% de la fidélité de recherche de l'agent.
   */
  function _compactHistory(providerKey, history, journal) {
    const providerType = _getProviderType(providerKey);
    const totalTokens = _estimateHistoryTokens(providerKey, history);
    const COMPACTION_THRESHOLD_TOKENS = 150000; // 150K tokens

    if (totalTokens < COMPACTION_THRESHOLD_TOKENS) {
      // Conserver l'intégralité du contexte pour préserver la qualité de recherche SerpAPI
      return history;
    }

    _log(journal, 'reactive_compact_start', `Taille de contexte (${totalTokens} tokens) supérieure au seuil (${COMPACTION_THRESHOLD_TOKENS} tokens). Déclenchement de la compaction réactive.`);

    try {
      if (providerType === 'gemini') {
        const contents = history.contents || [];
        const searchResponses = [];
        contents.forEach((msg, msgIdx) => {
          if (msg.role === 'user' && Array.isArray(msg.parts)) {
            msg.parts.forEach((part, partIdx) => {
              if (part.functionResponse && part.functionResponse.name === 'web_search') {
                searchResponses.push({ msgIdx, partIdx });
              }
            });
          }
        });
        if (searchResponses.length > 1) {
          const toCompact = searchResponses.slice(0, -1);
          toCompact.forEach(({ msgIdx, partIdx }) => {
            contents[msgIdx].parts[partIdx].functionResponse.response = {
              result: 'Recherche précédente obsolète (contexte purgé).'
            };
          });
          _log(journal, 'micro_compact', `Compacted ${toCompact.length} old search response(s) for Gemini.`);
        }
      } else if (providerType === 'claude') {
        const messages = history.messages || [];
        const searchResults = [];
        messages.forEach((msg, msgIdx) => {
          if (msg.role === 'user' && Array.isArray(msg.content)) {
            msg.content.forEach((block, blockIdx) => {
              if (block.type === 'tool_result' && block.content && typeof block.content === 'string' && block.content.includes('Résultats de recherche')) {
                searchResults.push({ msgIdx, blockIdx });
              }
            });
          }
        });
        if (searchResults.length > 1) {
          const toCompact = searchResults.slice(0, -1);
          toCompact.forEach(({ msgIdx, blockIdx }) => {
            messages[msgIdx].content[blockIdx].content = 'Recherche précédente obsolète (contexte purgé).';
          });
          _log(journal, 'micro_compact', `Compacted ${toCompact.length} old search result(s) for Claude.`);
        }
      } else {
        // OpenAI Compatible
        const messages = history.messages || [];
        const searchMessages = [];
        messages.forEach((msg, msgIdx) => {
          if (msg.role === 'tool' && msg.name === 'web_search') {
            searchMessages.push(msgIdx);
          }
        });
        if (searchMessages.length > 1) {
          const toCompact = searchMessages.slice(0, -1);
          toCompact.forEach((msgIdx) => {
            messages[msgIdx].content = 'Recherche précédente obsolète (contexte purgé).';
          });
          _log(journal, 'micro_compact', `Compacted ${toCompact.length} old search messages for OpenAI.`);
        }
      }
    } catch (e) {
      _log(journal, 'compact_err', `Échec de la micro-compaction de l'historique : ${_sanitizeErrorMessage(e)}`);
    }
    return history;
  }

  // ────────────────────────────────────────────────
  // API CALLS DISPATCHER WITH TOOLS & MULTI-MODEL FALLBACK
  // ────────────────────────────────────────────────

  async function _callLLMWithTools(providerKey, apiKeys, model, history, images, tools, signal) {
    const normalizedKey = _normalizeProviderKey(providerKey);
    const provider = _getProviderDef(normalizedKey);
    if (!provider) {
      throw new Error(`Provider inconnu: ${providerKey}`);
    }
    const { apiKey, providerConfig } = _resolveRuntimeConfig(normalizedKey, apiKeys);
    if (!apiKey) {
      throw new Error(`Clé API manquante pour le provider: ${provider.name}`);
    }
    const providerType = _getProviderType(normalizedKey);

    const validImages = _mergeRequestImages([], images);
    const hasImages = validImages.length > 0;
    const providerModelsObj = hasImages ? (provider.visionModels || []) : (provider.textModels || []);
    const candidateModels = [model];
    for (const m of providerModelsObj) {
      if (m.id && m.id !== model && !candidateModels.includes(m.id)) {
        candidateModels.push(m.id);
      }
    }

    let lastError = null;
    const qpRef = typeof QuizProviders !== 'undefined' ? QuizProviders : (typeof globalThis !== 'undefined' ? globalThis.QuizProviders : null);
    const analytics = qpRef && qpRef.ProviderAnalytics ? qpRef.ProviderAnalytics : null;
    for (const candidateModel of candidateModels) {
      const startedAt = Date.now();
      try {
        if (candidateModel !== model) {
          console.warn(`🔄 Fallback modèle interne: essai de ${candidateModel} car ${model} a échoué`);
        }
        let result;
        if (providerType === 'gemini') {
          result = await _callGeminiWithTools(apiKey, candidateModel, history, validImages, tools, signal);
        } else if (providerType === 'claude') {
          result = await _callClaudeWithTools(apiKey, candidateModel, history, validImages, tools, signal, normalizedKey, providerConfig);
        } else {
          result = await _callOpenAIWithTools(normalizedKey, apiKey, candidateModel, history, validImages, tools, signal, providerConfig);
        }
        if (analytics && typeof analytics.record === 'function') {
          analytics.record({
            provider: normalizedKey,
            model: candidateModel,
            ok: true,
            latencyMs: Date.now() - startedAt,
            status: 200
          });
        }
        return { ...result, model: candidateModel };
      } catch (err) {
        const isStaticLocalPlaceholder = (provider && provider.local === true && apiKey === (provider.staticApiKey || 'local')) ||
          NON_SECRET_LOCAL_PLACEHOLDERS.has(String(apiKey || '').trim().toLowerCase());
        const redactScope = {
          ...(apiKeys && typeof apiKeys === 'object' ? apiKeys : {}),
          ...(!isStaticLocalPlaceholder && typeof apiKey === 'string' ? { apiKey } : {})
        };
        const safeErrObj = _createSanitizedError(err, redactScope);
        const safeErrText = safeErrObj.message;
        console.error(`❌ Échec du modèle ${candidateModel} sur ${normalizedKey}:`, safeErrText);
        if (analytics && typeof analytics.record === 'function' && !(signal && signal.aborted)) {
          analytics.record({
            provider: normalizedKey,
            model: candidateModel,
            ok: false,
            latencyMs: Date.now() - startedAt,
            status: safeErrObj && typeof safeErrObj.status === 'number' ? safeErrObj.status : undefined,
            error: safeErrObj
          });
        }
        lastError = safeErrObj;
        if (signal && signal.aborted) {
          throw safeErrObj;
        }
      }
    }
    throw lastError || new Error(`Tous les modèles ont échoué pour le provider ${normalizedKey}`);
  }

  // --- OpenAI-compatible tool calling ---
  async function _callOpenAIWithTools(providerKey, apiKey, model, history, images, tools, signal, providerConfig = null) {
    const normalizedKey = String(providerKey).toLowerCase();
    const provider = _getProviderDef(normalizedKey);
    const payloadTools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    const payload = {
      model: model,
      messages: history.messages
    };
    if (provider && provider.maxTokensField === 'max_completion_tokens') {
      payload.max_completion_tokens = 4096;
    }

    if (payloadTools.length > 0) {
      payload.tools = payloadTools;
      payload.tool_choice = 'auto';
    }

    // Gérer l'intégration d'images dans le premier message user (après un éventuel message system)
    const validImages = _mergeRequestImages([], images);
    if (validImages.length > 0 && payload.messages.length > 0) {
      const firstUserIdx = payload.messages.findIndex(m => m.role === 'user');
      if (firstUserIdx !== -1) {
        const originalUserText = typeof payload.messages[firstUserIdx].content === 'string'
          ? payload.messages[firstUserIdx].content
          : '';
        const lowerModel = model.toLowerCase();
        const isLegacyNvidiaVision = normalizedKey === 'nvidia' && (lowerModel.includes('phi-') || lowerModel.includes('neva'));
        payload.messages = JSON.parse(JSON.stringify(payload.messages)); // deep copy

        if (isLegacyNvidiaVision) {
          const imgTags = validImages
            .map(img => {
              const parsed = _parseImageDataUrl(img.dataUrl);
              return parsed ? `<img src="data:${parsed.mimeType};base64,${parsed.base64}" />` : '';
            })
            .filter(Boolean)
            .join(' ');
          payload.messages[firstUserIdx].content = `${originalUserText}\n${imgTags}`;
        } else {
          const mixedContent = [];
          validImages.forEach(img => {
            const parsed = _parseImageDataUrl(img.dataUrl);
            if (!parsed) return;
            mixedContent.push({
              type: 'image_url',
              image_url: { url: `data:${parsed.mimeType};base64,${parsed.base64}` }
            });
          });
          mixedContent.push({ type: 'text', text: originalUserText });
          payload.messages[firstUserIdx].content = mixedContent;
        }
      }
    }

    const targetBaseUrl = _resolveEndpointBaseUrl(normalizedKey, provider, providerConfig, model);
    const endpoint = _buildEndpointUrl(targetBaseUrl, '/chat/completions');
    const customHeaders = (provider && provider.defaultHeaders && typeof provider.defaultHeaders === 'object')
      ? provider.defaultHeaders
      : {};

    const response = await QuizProviders.extensionFetch(endpoint, {
      method: 'POST',
      headers: {
        ...customHeaders,
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': customHeaders.Accept || 'application/json'
      },
      body: JSON.stringify(payload),
      signal
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const apiErr = new Error(err.error?.message || `Erreur ${provider?.name || 'OpenAI'} API: HTTP ${response.status}`);
      apiErr.status = response.status;
      throw apiErr;
    }

    const data = await response.json();
    const choice = data.choices?.[0]?.message;
    const text = choice?.content || '';
    const toolCalls = [];

    if (choice?.tool_calls && Array.isArray(choice.tool_calls)) {
      for (const call of choice.tool_calls) {
        if (call.type === 'function') {
          toolCalls.push({
            id: call.id,
            name: call.function.name,
            args: call.function.arguments // stringified JSON
          });
        }
      }
    }

    return { text, toolCalls };
  }

  // --- Claude & Anthropic-compatible tool calling ---
  async function _callClaudeWithTools(apiKey, model, history, images, tools, signal, providerKey = 'claude', providerConfig = null) {
    const normKey = _normalizeProviderKey(providerKey) || 'claude';
    const provider = _getProviderDef(normKey) || _getProviderDef('claude');
    const payloadTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));

    const messagesToSend = JSON.parse(JSON.stringify(history.messages));

    const validImages = _mergeRequestImages([], images);
    if (validImages.length > 0 && messagesToSend.length > 0 && messagesToSend[0].role === 'user') {
      const originalUserText = typeof messagesToSend[0].content === 'string'
        ? messagesToSend[0].content
        : '';
      const blocks = [];
      validImages.forEach(img => {
        const parsed = _parseImageDataUrl(img.dataUrl);
        if (!parsed) return;
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: parsed.mimeType,
            data: parsed.base64
          }
        });
      });
      blocks.push({ type: 'text', text: originalUserText });
      messagesToSend[0].content = blocks;
    }

    const payload = {
      model: model,
      max_tokens: 4096,
      messages: messagesToSend
    };

    if (payloadTools.length > 0) {
      payload.tools = payloadTools;
    }

    if (history.system) {
      payload.system = history.system;
    }

    const baseUrl = _resolveEndpointBaseUrl(normKey, provider, providerConfig, model) || 'https://api.anthropic.com/v1';
    const endpoint = _buildEndpointUrl(baseUrl, (provider && provider.messagesPath) || '/messages');
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (provider && provider.sendBearerAuth === true && apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await QuizProviders.extensionFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const apiErr = new Error(err.error?.message || `Erreur ${provider?.name || 'Claude'} API: HTTP ${response.status}`);
      apiErr.status = response.status;
      throw apiErr;
    }

    const data = await response.json();
    let text = '';
    const toolCalls = [];

    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') {
          text += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            args: block.input // object JSON
          });
        }
      }
    }

    return { text, toolCalls };
  }

  // --- Gemini tool calling ---
  async function _callGeminiWithTools(apiKey, model, history, images, tools, signal) {
    const functionDeclarations = tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));

    const contentsToSend = JSON.parse(JSON.stringify(history.contents));

    const validImages = _mergeRequestImages([], images);
    if (validImages.length > 0 && contentsToSend.length > 0 && contentsToSend[0].role === 'user') {
      const originalUserText = contentsToSend[0].parts[0]?.text || '';
      const parts = [];
      validImages.forEach(img => {
        const parsed = _parseImageDataUrl(img.dataUrl);
        if (!parsed) return;
        parts.push({
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.base64
          }
        });
      });
      parts.push({ text: originalUserText });
      contentsToSend[0].parts = parts;
    }

    const payload = {
      contents: contentsToSend,
      generationConfig: {
        maxOutputTokens: 4096
      }
    };

    if (functionDeclarations.length > 0) {
      payload.tools = [{ functionDeclarations }];
    }

    if (history.systemInstruction) {
      payload.systemInstruction = {
        parts: [{ text: history.systemInstruction }]
      };
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const response = await QuizProviders.extensionFetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
      signal
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const apiErr = new Error(err.error?.message || `Erreur Gemini API: HTTP ${response.status}`);
      apiErr.status = response.status;
      throw apiErr;
    }

    const data = await response.json();
    let text = '';
    const toolCalls = [];

    const responseParts = data.candidates?.[0]?.content?.parts || [];
    for (const part of responseParts) {
      if (part.text && part.thought !== true) {
        text += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: part.functionCall.name + '_' + Date.now(),
          name: part.functionCall.name,
          args: part.functionCall.args // object JSON
        });
      }
    }

    return { text, toolCalls };
  }

  // ────────────────────────────────────────────────
  // TOOL RESULT MAPPING
  // ────────────────────────────────────────────────

  function _mapToolAnswersToParsedAnswers(toolAnswers, questions) {
    if (!Array.isArray(toolAnswers) || !Array.isArray(questions)) return [];
    const parsed = [];
    for (const item of toolAnswers) {
      if (!item || typeof item !== 'object') continue;
      const rawIdx = typeof item.questionIndex === 'number'
        ? item.questionIndex
        : parseInt(item.questionIndex, 10);
      if (!Number.isInteger(rawIdx) || rawIdx < 0) continue;
      const question = (rawIdx < questions.length && questions[rawIdx])
        ? questions[rawIdx]
        : questions.find((q, qPos) => q && ((typeof q.index === 'number' ? q.index - 1 : qPos) === rawIdx));
      if (!question) continue;
      const idx = typeof question.index === 'number' ? question.index - 1 : rawIdx;

      const userAns = Array.isArray(item.answers) ? item.answers : [item.answers];
      const explanation = item.explanation || '';
      const confidence = item.confidence;

      const meta = _getNormalizedQuestionMeta(question);
      const isDragDrop = meta.isDragDrop;

      if (meta.isTextLike || meta.isMultiSelectMatching) {
        const joinedText = userAns
          .map(v => (v === undefined || v === null ? '' : String(v).trim()))
          .filter(Boolean)
          .join(' | ');
        parsed.push(normalizeAnswerEntry({
          questionIndex: idx,
          raw: JSON.stringify(item),
          optionIndices: [],
          textAnswer: joinedText,
          confidence,
          explanation
        }));
      } else if (meta.effectiveOptions.length > 0 || isDragDrop) {
        const optionIndices = [];
        const textParts = [];
        const qOptions = meta.effectiveOptions;

        for (const val of userAns) {
          if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val < qOptions.length) {
            optionIndices.push(val);
            continue;
          }
          if (typeof val === 'string' && /^\s*\d+\s*$/.test(val)) {
            const numeric = parseInt(val.trim(), 10);
            if (!isNaN(numeric) && numeric >= 0 && numeric < qOptions.length) {
              optionIndices.push(numeric);
              continue;
            }
          }

          if (typeof val === 'string' && val.length === 1) {
            const code = val.toUpperCase().charCodeAt(0) - 65;
            if (code >= 0 && code < qOptions.length) {
              optionIndices.push(code);
              continue;
            }
          }

          if (typeof val === 'string') {
            textParts.push(val.trim());
            const textMatches = _matchOptionIndexByText(question, val, isDragDrop);
            for (const mIdx of textMatches) {
              if (!optionIndices.includes(mIdx)) {
                optionIndices.push(mIdx);
              }
            }
          }
        }

        const joinedFallbackText = textParts.filter(Boolean).join(' | ');
        parsed.push(normalizeAnswerEntry({
          questionIndex: idx,
          raw: JSON.stringify(item),
          optionIndices: optionIndices,
          textAnswer: isDragDrop
            ? (joinedFallbackText || null)
            : (optionIndices.length === 0 ? (joinedFallbackText || userAns[0] || '') : null),
          confidence,
          explanation
        }));
      }
    }
    return parsed;
  }

  // ────────────────────────────────────────────────
  // SINGLE SEARCH WRAPPER
  // ────────────────────────────────────────────────

  async function _executeSingleSearch(queryText, apiKey, parentSignal) {
    if (parentSignal && parentSignal.aborted) {
      return null;
    }
    if (typeof handleFetchSerpApi !== 'function') {
      return 'Échec de la recherche web: SerpAPI indisponible.';
    }

    let searchTimer = null;
    let onSearchAbort = null;
    try {
      const result = await Promise.race([
        handleFetchSerpApi(queryText, apiKey),
        new Promise((_, reject) => {
          searchTimer = setTimeout(() => reject(new Error('Search timeout')), SEARCH_TIMEOUT_MS);
          if (parentSignal && typeof parentSignal.addEventListener === 'function') {
            onSearchAbort = () => {
              reject(new Error('Search aborted'));
            };
            parentSignal.addEventListener('abort', onSearchAbort, { once: true });
          }
        })
      ]);

      if (!result || !result.success || !result.data) {
        return 'Aucun résultat trouvé.';
      }

      let content = `Résultats de recherche Google pour "${queryText}":\n`;
      if (result.data.answer_box && result.data.answer_box.snippet) {
        content += `Réponse directe Google: ${result.data.answer_box.snippet}\n`;
      }
      if (Array.isArray(result.data.organic_results)) {
        const top = result.data.organic_results.slice(0, 3);
        for (let i = 0; i < top.length; i++) {
          content += `- ${top[i].title}: ${top[i].snippet}\n`;
        }
      }

      const maxChars = 2000;
      if (content.length > maxChars) {
        content = content.substring(0, maxChars) + '\n... (résultats tronqués pour préserver le budget de tokens)';
      }
      return content;
    } catch (e) {
      return `Échec de la recherche web: ${_sanitizeErrorMessage(e, apiKey)}`;
    } finally {
      if (searchTimer !== null) {
        clearTimeout(searchTimer);
      }
      if (parentSignal && onSearchAbort && typeof parentSignal.removeEventListener === 'function') {
        parentSignal.removeEventListener('abort', onSearchAbort);
      }
    }
  }

  // ────────────────────────────────────────────────
  // RALPH LOOP (Validation & Retry)
  // ────────────────────────────────────────────────

  async function _validateAndRetry(task, llmResult, rawContextText, plan, journal, signal) {
    let { answers, provider, model, chunksProcessed } = llmResult;
    const MAX_RETRIES = 2;
    let retriesUsed = 0;

    const getQIdx = (q, pos) => (typeof q.index === 'number' ? q.index - 1 : pos);
    const answerByQIdx = new Map();
    for (const ans of (Array.isArray(answers) ? answers : [])) {
      if (ans && typeof ans.questionIndex === 'number') {
        answerByQIdx.set(ans.questionIndex, ans);
      }
    }
    let missingQuestions = task.questions.filter((q, pos) => !answerByQIdx.has(getQIdx(q, pos)));
    const contextFiles = Array.isArray(plan?.contextFiles) ? plan.contextFiles : [];
    const { imageFiles: contextImages } = _extractContextMedia(contextFiles);

    while (missingQuestions.length > 0 && retriesUsed < MAX_RETRIES) {
      if (signal.aborted) {
        break;
      }

      retriesUsed++;
      _log(journal, 'ralph_retry', `Ralph Loop: ${missingQuestions.length} questions manquantes, retry ${retriesUsed}/${MAX_RETRIES}`);
      if (!signal || !signal.aborted) {
        _reportProgress(task.tabId, `Vérification de ${missingQuestions.length} question(s) (${retriesUsed}/${MAX_RETRIES})…`, 85, task.startedAt);
      }

      const missingQuestionImages = [];
      for (const q of missingQuestions) {
        for (const img of _getValidQuestionImages(q)) {
          missingQuestionImages.push(img);
        }
      }
      const uniqueMissingQuestionImages = _mergeRequestImages([], missingQuestionImages);

      const retryQuizData = {
        questions: missingQuestions,
        totalImages: uniqueMissingQuestionImages.length
      };

      try {
        const syncConfig = task.config.syncConfig;
        const attemptProviders = _getAllConfiguredProviders(task.config, syncConfig.providerOrder);
        let response = null;
        let lastError = null;

        for (const pKey of attemptProviders) {
          if (signal && signal.aborted) {
            throw new Error('Résolution annulée');
          }
          try {
            const initialPrompts = await _buildPrompt(retryQuizData, rawContextText, contextFiles, {
              ...(syncConfig || {}),
              ...(task.config.settings || {}),
              isRetry: true
            });
            if (signal && signal.aborted) {
              throw new Error('Résolution annulée');
            }
            const messages = _initHistory(pKey, initialPrompts.system, initialPrompts.user);

            const retryImages = _mergeRequestImages(contextImages, uniqueMissingQuestionImages);

            const currentModel = QuizProviders.getModelForContext(pKey, retryImages.length > 0, (syncConfig.customModels || {}));

            // Pour les retries, on fait un appel direct simple (pas de boucle ReAct pour aller vite)
            response = await _callLLMWithTools(
              pKey,
              { ...(syncConfig || {}), ...(task.config.apiKeys || {}) },
              currentModel,
              messages,
              retryImages,
              [], // Pas d'outils, résolution directe rapide
              signal
            );
            
            break; // Succès
          } catch (e) {
            if (signal && signal.aborted) {
              throw _createSanitizedError(e, task && task.config);
            }
            _log(journal, 'ralph_provider_error', `Erreur retry avec ${pKey}: ${_sanitizeErrorMessage(e, task && task.config)}`);
            lastError = _createSanitizedError(e, task && task.config);
          }
        }

        if (!response) {
          throw new Error(`Tous les providers ont échoué en retry. Dernière erreur: ${lastError ? _sanitizeErrorMessage(lastError, task && task.config) : 'inconnue'}`);
        }

        if (response.model) {
          model = response.model;
        }

        const retryAnswers = _parseAIResponse(response.text, missingQuestions);

        for (const ans of retryAnswers) {
          if (ans && typeof ans.questionIndex === 'number') {
            answerByQIdx.set(ans.questionIndex, ans);
          }
        }

        missingQuestions = task.questions.filter((q, pos) => !answerByQIdx.has(getQIdx(q, pos)));
      } catch (retryError) {
        _log(journal, 'ralph_fail', `Retry ${retriesUsed} échoué: ${_sanitizeErrorMessage(retryError, task && task.config)}`);
        break;
      }
    }

    if (missingQuestions.length > 0) {
      _log(journal, 'ralph_incomplete', `${missingQuestions.length} question(s) sans réponse après ${retriesUsed} retries`);
    }

    const mergedAnswers = Array.from(answerByQIdx.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, ans]) => ans);

    return { answers: mergedAnswers, provider, model, retriesUsed, chunksProcessed };
  }

  // ────────────────────────────────────────────────
  // UTILITAIRES ET PARSERS
  // ────────────────────────────────────────────────

  function _estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
  }

  function _estimateImageTokens(image) {
    if (!image || !image.dataUrl) { return 0; }
    if (
      typeof image.width === 'number' && Number.isFinite(image.width) && image.width > 0 &&
      typeof image.height === 'number' && Number.isFinite(image.height) && image.height > 0
    ) {
      return Math.max(256, Math.min(2500, Math.ceil((image.width * image.height) / 750)));
    }
    return 1500;
  }

  async function _loadSystemPrompt() {
    if (_cachedSystemPrompt) {
      return _cachedSystemPrompt;
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
    _cachedSystemPrompt = text.trim();
    return _cachedSystemPrompt;
  }

  async function _buildPrompt(quizData, contextText, contextFiles, settings) {
    if (!quizData || !Array.isArray(quizData.questions)) {
      throw new Error('_buildPrompt: quizData.questions doit être un tableau.');
    }

    let systemPrompt = await _loadSystemPrompt();

    // F-INT-03 : Injection modulaire des règles de domaine (preset / auto / custom)
    let domainPreset = settings && settings.domainPreset;
    let customDomainRules = settings && settings.customDomainRules;
    if ((domainPreset === undefined || customDomainRules === undefined) &&
        typeof chrome !== 'undefined' && chrome.storage) {
      try {
        const localDomain = (chrome.storage.local && typeof chrome.storage.local.get === 'function')
          ? await chrome.storage.local.get(['domainPreset', 'customDomainRules'])
          : {};
        const syncDomain = (chrome.storage.sync && typeof chrome.storage.sync.get === 'function')
          ? await chrome.storage.sync.get(['domainPreset', 'customDomainRules'])
          : {};
        const storedDomain = { ...(syncDomain || {}), ...(localDomain || {}) };
        if (domainPreset === undefined && storedDomain.domainPreset !== undefined) {
          domainPreset = storedDomain.domainPreset;
        }
        if (customDomainRules === undefined && storedDomain.customDomainRules !== undefined) {
          customDomainRules = storedDomain.customDomainRules;
        }
      } catch (_) {
        // Ignorer les erreurs d'accès storage en contexte isolé/test
      }
    }

    const quizTextForDomain = quizData.questions
      .map(q => {
        const optsText = Array.isArray(q.options) ? q.options.map(o => o?.text || '').join(' ') : '';
        return `${q?.text || ''} ${optsText}`.trim();
      })
      .join('\n');

    const domainRulesText = buildDomainRules(
      domainPreset !== undefined ? domainPreset : 'auto',
      customDomainRules || '',
      quizTextForDomain
    );
    systemPrompt = applyDomainRules(systemPrompt, domainRulesText);
    
    // Pilier 1 : Mémoire persistante intégrée
    const memory = await _loadAgentMemory();
    if (memory && memory.length > 0) {
      systemPrompt += `\n\n### LEÇONS APPRISES DES SESSIONS PRÉCÉDENTES\nTu dois tenir compte de ces leçons pour éviter de répéter les mêmes erreurs :\n`;
      memory.forEach(m => {
        systemPrompt += `- ${m.lesson}\n`;
      });
    }

    const { textFiles, imageFiles } = _extractContextMedia(contextFiles);
    let userPrompt = '';

    if (typeof contextText === 'string' && contextText.trim().length > 0) {
      userPrompt += `CONTEXTE FOURNI (Texte):\n${contextText}\n\n`;
    }

    if (textFiles.length > 0) {
      userPrompt += `CONTEXTE FOURNI (Fichiers):\n`;
      for (const file of textFiles) {
        userPrompt += `--- Fichier: ${file.name || 'document'} ---\n${file.content}\n\n`;
      }
    }

    if (imageFiles.length > 0) {
      userPrompt += `CONTEXTE FOURNI (Images de cours — ${imageFiles.length} image(s) jointe(s) en premier):\n`;
      for (let i = 0; i < imageFiles.length; i++) {
        userPrompt += `- Image de cours ${i + 1} : ${imageFiles[i].name}\n`;
      }
      userPrompt += `Appuie-toi prioritairement sur ces images de cours (schémas, tableaux, formules, notes) pour répondre aux questions.\n\n`;
    }

    if (imageFiles.length > 0 && quizData.totalImages > 0) {
      userPrompt += `NOTE: ${imageFiles.length} image(s) de cours sont jointes en premier, suivies de ${quizData.totalImages} image(s) issues des questions du quiz. Analyse-les attentivement.\n\n`;
    } else if (imageFiles.length > 0) {
      userPrompt += `NOTE: Des images de notes de cours sont jointes à ce message. Analyse-les attentivement pour répondre aux questions.\n\n`;
    } else if (quizData.totalImages > 0) {
      userPrompt += `NOTE: Des images sont jointes à ce message. Analyse-les attentivement.\n\n`;
    }

    userPrompt += `QUESTIONS:\n\n`;

    for (let idx = 0; idx < quizData.questions.length; idx++) {
      userPrompt += _formatQuestionForPrompt(quizData.questions[idx], idx + 1, { includeImageNote: true });
      userPrompt += `\n`;
    }

    if (settings && settings.isRetry) {
      userPrompt += `[RATTRAPAGE / AUTO-CORRECTION] Tu as précédemment échoué à répondre à ces questions (format invalide ou omission). Avant d'appeler l'outil submit_answers, tu DOIS analyser pourquoi tu as échoué et corriger ton approche (remplis bien le champ thought_process de l'outil). Tu DOIS fournir une réponse pour CHAQUE question ci-dessus.\n\n`;
    }

    userPrompt += `RÉPONSES:`;
    return { system: systemPrompt, user: userPrompt };
  }

  function _createQuizChunks(questions, providerKey, baseTokens, syncConfig, hasContextImages = false) {
    if (!Array.isArray(questions)) {
      throw new Error('_createQuizChunks: questions doit être un tableau.');
    }

    const buildChunksForList = (questionsList, isVisionBucket) => {
      if (questionsList.length === 0) { return []; }

      let modelId = QuizProviders.getModelForContext(providerKey, isVisionBucket, (syncConfig.customModels || {}));
      let maxModelTokens = QuizProviders.getModelContextLimit(providerKey, modelId);

      const MAX_CHUNK_TOKENS = Math.max(8000, maxModelTokens - 5000);
      const chunks = [];
      let currentChunk = { questions: [], tokens: baseTokens, images: 0, isVisionBucket, fallbackModelId: null };

      for (const q of questionsList) {
        let qTokens = _estimateTokens(q.text);
        if (Array.isArray(q.options)) {
          for (const opt of q.options) {
            qTokens += _estimateTokens(opt && opt.text);
          }
        }
        if (Array.isArray(q.selects)) {
          for (const sel of q.selects) {
            qTokens += _estimateTokens(sel && sel.label);
            if (sel && Array.isArray(sel.options)) {
              for (const so of sel.options) qTokens += _estimateTokens(so && so.text);
            }
          }
        }
        if (Array.isArray(q.dropTargets)) {
          for (const dt of q.dropTargets) {
            qTokens += _estimateTokens((dt && (dt.label || dt.text)) || '');
          }
        }
        const validQImages = _getValidQuestionImages(q);
        for (const img of validQImages) {
          qTokens += _estimateImageTokens(img);
        }

        if (currentChunk.tokens + qTokens > MAX_CHUNK_TOKENS && currentChunk.questions.length > 0) {
          chunks.push(currentChunk);
          currentChunk = { questions: [], tokens: baseTokens, images: 0, isVisionBucket, fallbackModelId: null };
        }

        currentChunk.questions.push(q);
        currentChunk.tokens += qTokens;
        currentChunk.images += validQImages.length;
      }
      if (currentChunk.questions.length > 0) { chunks.push(currentChunk); }

      return chunks;
    };

    if (hasContextImages) {
      return buildChunksForList(questions, true);
    }

    const textQuestions = [];
    const visionQuestions = [];

    for (const q of questions) {
      if (_getValidQuestionImages(q).length > 0) {
        visionQuestions.push(q);
      } else {
        textQuestions.push(q);
      }
    }

    return [
      ...buildChunksForList(textQuestions, false),
      ...buildChunksForList(visionQuestions, true)
    ];
  }

  function _parseAIResponse(response, questions) {
    if (!response || typeof response !== 'string') { return []; }
    if (!Array.isArray(questions) || questions.length === 0) { return []; }

    const answers = [];
    const getGlobalIdx = (q, fallbackPos) => (q && typeof q.index === 'number' ? q.index - 1 : fallbackPos);
    const isValidOptionIndex = (q, idx) => {
      if (!Number.isInteger(idx) || idx < 0) return false;
      const qMeta = _getNormalizedQuestionMeta(q);
      if (qMeta.isTextLike) return false;
      return qMeta.effectiveOptions.length > 0 && idx < qMeta.effectiveOptions.length;
    };

    // NIVEAU 1: XML
    const xmlMatch = response.match(/<quiz_answers>([\s\S]*?)<\/quiz_answers>/i);
    if (xmlMatch) {
      const xmlContent = xmlMatch[1];
      const answerRegex = /<answer\b([^>]*)>([\s\S]*?)<\/answer>/gi;
      let match;

      while ((match = answerRegex.exec(xmlContent)) !== null) {
        const attrs = match[1] || '';
        const idMatch = attrs.match(/question_id\s*=\s*["'](\d+)["']/i);
        if (!idMatch) { continue; }
        const id = parseInt(idMatch[1], 10);
        const typeMatch = attrs.match(/type\s*=\s*["']([^"']+)["']/i);
        const inner = match[2];
        const questionNum = id - 1;
        const question = questions[questionNum];
        if (!question) { continue; }

        const qMeta = _getNormalizedQuestionMeta(question);
        const typeAliasMap = {
          single_choice: 'radio',
          multi_choice: 'checkbox',
          fill_blank: 'text'
        };
        const allowedXmlTypes = new Set(['radio', 'checkbox', 'select_matching', 'drag_drop', 'text']);
        const fallbackRawType = String(qMeta.rawType || qMeta.normType || (qMeta.effectiveOptions.length > 0 ? 'radio' : 'text')).toLowerCase();
        const fallbackMapped = typeAliasMap[fallbackRawType] || fallbackRawType;
        const fallbackType = allowedXmlTypes.has(fallbackMapped)
          ? fallbackMapped
          : (qMeta.effectiveOptions.length > 0 ? 'radio' : 'text');
        const rawTypeAttr = (typeMatch ? typeMatch[1] : fallbackType).trim().toLowerCase();
        const mappedAttr = typeAliasMap[rawTypeAttr] || rawTypeAttr;
        const type = allowedXmlTypes.has(mappedAttr) ? mappedAttr : fallbackType;
        const globalIdx = getGlobalIdx(question, questionNum);

        // Extraction de confidence et explanation
        let confidence = DEFAULT_CONFIDENCE;
        const confidenceMatch = inner.match(/<confidence>\s*([+-]?\d+(?:\.\d+)?)\s*%?\s*<\/confidence>/i);
        if (confidenceMatch) {
          confidence = _normalizeConfidence(confidenceMatch[1]);
        }

        let explanation = '';
        const explanationMatch = inner.match(/<explanation>([\s\S]*?)<\/explanation>/i);
        if (explanationMatch) {
          explanation = explanationMatch[1].trim();
        }

        const isSingleSelectMatching = qMeta.isSingleSelectMatching;

        if (type === 'radio') {
          const optIdxMatch = inner.match(/<option_index>\s*(\d+)\s*<\/option_index>/i);
          if (optIdxMatch) {
            const optIdx = parseInt(optIdxMatch[1], 10) - 1;
            if (isValidOptionIndex(question, optIdx)) {
              answers[globalIdx] = {
                questionIndex: globalIdx,
                raw: optIdxMatch[0],
                optionIndices: [optIdx],
                textAnswer: null,
                confidence,
                explanation
              };
            }
          } else {
            const textMatch = inner.match(/<text_reply>([\s\S]*?)<\/text_reply>/i);
            if (textMatch) {
              const txt = textMatch[1].trim();
              const matched = isSingleSelectMatching ? _matchOptionIndexByText(question, txt) : [];
              if (matched.length > 0 || (isSingleSelectMatching && txt.length > 0)) {
                answers[globalIdx] = {
                  questionIndex: globalIdx,
                  raw: textMatch[0],
                  optionIndices: matched,
                  textAnswer: txt,
                  confidence,
                  explanation
                };
              }
            }
          }
        } else if (type === 'checkbox') {
          const optIndicesMatch = inner.match(/<option_indices>\s*([\d,\s]+)\s*<\/option_indices>/i);
          const singleOptMatch = inner.match(/<option_index>\s*(\d+)\s*<\/option_index>/i);
          const textMatch = inner.match(/<text_reply>([\s\S]*?)<\/text_reply>/i);
          const txt = textMatch ? textMatch[1].trim() : null;

          let indices = [];
          if (optIndicesMatch) {
            indices = optIndicesMatch[1].split(',')
              .map(n => parseInt(n.trim(), 10) - 1)
              .filter(n => isValidOptionIndex(question, n));
          } else if (singleOptMatch) {
            const optIdx = parseInt(singleOptMatch[1], 10) - 1;
            if (isValidOptionIndex(question, optIdx)) {
              indices = [optIdx];
            }
          }
          if (indices.length === 0 && qMeta.isDragDrop && txt) {
            indices = _matchOptionIndexByText(question, txt, true);
          }

          if (indices.length > 0 || (qMeta.isDragDrop && txt && txt.length > 0)) {
            answers[globalIdx] = {
              questionIndex: globalIdx,
              raw: (optIndicesMatch || singleOptMatch || textMatch)[0],
              optionIndices: indices,
              textAnswer: (txt && txt.length > 0) ? txt : null,
              confidence,
              explanation
            };
          }
        } else if (type === 'select_matching' || type === 'drag_drop') {
          const optIndicesMatch = inner.match(/<option_indices>\s*([\d,\s]+)\s*<\/option_indices>/i);
          const optIdxMatch = inner.match(/<option_index>\s*(\d+)\s*<\/option_index>/i);
          const textMatch = inner.match(/<text_reply>([\s\S]*?)<\/text_reply>/i);

          let indices = [];
          if (optIndicesMatch) {
            indices = optIndicesMatch[1].split(',')
              .map(n => parseInt(n.trim(), 10) - 1)
              .filter(n => isValidOptionIndex(question, n));
          } else if (optIdxMatch) {
            const optIdx = parseInt(optIdxMatch[1], 10) - 1;
            if (isValidOptionIndex(question, optIdx)) {
              indices = [optIdx];
            }
          }

          const txt = textMatch ? textMatch[1].trim() : null;
          const isDragMulti = type === 'drag_drop' || qMeta.isDragDrop;
          if (indices.length === 0 && txt && (isDragMulti || isSingleSelectMatching)) {
            indices = _matchOptionIndexByText(question, txt, isDragMulti);
          }

          if (indices.length > 0 || (txt && txt.length > 0)) {
            answers[globalIdx] = {
              questionIndex: globalIdx,
              raw: (optIndicesMatch || optIdxMatch || textMatch)[0],
              optionIndices: indices,
              textAnswer: (txt && txt.length > 0) ? txt : null,
              confidence,
              explanation
            };
          }
        } else if (type === 'text') {
          const textMatch = inner.match(/<text_reply>([\s\S]*?)<\/text_reply>/i);
          if (textMatch) {
            const txt = textMatch[1].trim();
            const matched = qMeta.isDragDrop
              ? _matchOptionIndexByText(question, txt, true)
              : (isSingleSelectMatching ? _matchOptionIndexByText(question, txt, false) : []);
            if (txt.length > 0 || matched.length > 0) {
              answers[globalIdx] = {
                questionIndex: globalIdx,
                raw: textMatch[0],
                optionIndices: matched,
                textAnswer: txt,
                confidence,
                explanation
              };
            }
          }
        }
      }
    }

    const parseFallbackOptionIndices = (text, question, qMeta) => {
      const trimmed = String(text || '').trim();
      const opts = qMeta.effectiveOptions;
      if (!trimmed) return [];

      const isSingleChoice = !qMeta.isDragDrop && qMeta.rawType !== 'checkbox' && qMeta.normType !== 'multi_choice';
      const trimmedLower = trimmed.toLowerCase();

      // Strict raw text/value check before numeric splitting (protects "1/2", "1 + 2", "C++")
      if (opts.length > 0 && !/^\d+$/.test(trimmed)) {
        const directExact = [];
        for (let optIdx = 0; optIdx < opts.length; optIdx++) {
          const opt = opts[optIdx];
          if (!opt) continue;
          const optRawLower = String(opt.text || '').toLowerCase().trim();
          const optValLower = String(opt.value || '').toLowerCase().trim();
          if ((optRawLower && optRawLower === trimmedLower) || (optValLower && optValLower === trimmedLower)) {
            directExact.push(optIdx);
            if (isSingleChoice) return [optIdx];
          }
        }
        if (directExact.length > 0) return directExact;
      }

      let optionIndices = [];

      // Case A: standalone numeric index / list (never split unprefixed fractions/expressions like "1/2" or "1 + 2")
      const standalonePattern = isSingleChoice
        ? /^(?:(?:option|answer|r[eé]ponse|choix)\s*[:#]?\s*)?(\d+)\s*[.)]?$/i
        : /^(?:(?:options|answers|r[eé]ponses|choix)\s*[:#]?\s*(\d+(?:\s*(?:,|;|\/|et|and|\+)\s*\d+)*)|(?:(?:option|answer|r[eé]ponse|choix)\s*[:#]?\s*)?(\d+(?:\s*(?:,|;|et|and)\s*\d+)*))\s*[.)]?$/i;
      const standaloneNums = trimmed.match(standalonePattern);
      if (standaloneNums) {
        const numGroup = standaloneNums[1] || standaloneNums[2] || '';
        const nums = numGroup.match(/\d+/g) || [];
        optionIndices = nums.map(n => parseInt(n, 10) - 1).filter(n => isValidOptionIndex(question, n));
      }

      // Case B: standalone letter A-G
      if (optionIndices.length === 0 && opts.length > 0) {
        const letterMatch = trimmed.match(/^(?:(?:option|answer|r[eé]ponse|choix)\s*[:#]?\s*)?([A-G])(?:\s*[.)])?$/i);
        if (letterMatch) {
          const code = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
          if (code >= 0 && code < opts.length) {
            optionIndices = [code];
          }
        }
      }

      // Case C: text matching (runs before scraping numbers from text like IPv4 / HTTP/2 / Layer 3)
      if (optionIndices.length === 0 && opts.length > 0) {
        const multiTextMatch = qMeta.isDragDrop || qMeta.rawType === 'checkbox' || qMeta.normType === 'multi_choice';
        optionIndices = _matchOptionIndexByText(question, trimmed, multiTextMatch);
      }

      // Case D: explicit labelled option numbers (e.g. "The answer is option 2")
      if (optionIndices.length === 0 && !(qMeta.isDragDrop && /->|=>/.test(trimmed))) {
        const explicitMatches = Array.from(trimmed.matchAll(/(?:option|choix|index|#)\s*(\d+)/gi));
        if (explicitMatches.length > 0) {
          optionIndices = explicitMatches
            .map(m => parseInt(m[1], 10) - 1)
            .filter(n => isValidOptionIndex(question, n));
        }
      }

      return [...new Set(optionIndices)];
    };

    // NIVEAU 2: Regex de lignes
    const missingIndices = questions.map((_, idx) => idx).filter(idx => !answers[getGlobalIdx(questions[idx], idx)]);
    if (missingIndices.length > 0) {
      const lines = response.split('\n');
      for (const line of lines) {
        const lineMatch = line.match(/^\s*[-*+]?\s*(?:Q|Question)?\s*(\d+)\s*[.:)-]\s*(.+)$/i);
        if (!lineMatch) { continue; }

        const questionNum = parseInt(lineMatch[1], 10) - 1;
        const rawAnswer = lineMatch[2].trim();
        const question = questions[questionNum];
        if (!question) { continue; }

        const globalIdx = getGlobalIdx(question, questionNum);
        if (answers[globalIdx]) { continue; }

        const qMeta = _getNormalizedQuestionMeta(question);
        if (qMeta.isTextLike || qMeta.isMultiSelectMatching) {
          answers[globalIdx] = {
            questionIndex: globalIdx,
            raw: rawAnswer,
            optionIndices: [],
            textAnswer: rawAnswer,
            confidence: 50,
            explanation: ''
          };
        } else {
          const optionIndices = parseFallbackOptionIndices(rawAnswer, question, qMeta);
          answers[globalIdx] = {
            questionIndex: globalIdx,
            raw: rawAnswer,
            optionIndices: optionIndices,
            textAnswer: (optionIndices.length === 0 || qMeta.isDragDrop) ? rawAnswer : null,
            confidence: 50,
            explanation: ''
          };
        }
      }
    }

    // NIVEAU 3: Sémantique par blocs
    const finalMissing = questions.map((_, idx) => idx).filter(idx => !answers[getGlobalIdx(questions[idx], idx)]);
    if (finalMissing.length > 0) {
      for (const idx of finalMissing) {
        const question = questions[idx];
        const globalIdx = getGlobalIdx(question, idx);

        const escapedIdx = (idx + 1).toString();
        const searchPattern = new RegExp(`(?:Question|Q)\\s*${escapedIdx}\\b[\\s\\S]*?(?=(?:Question|Q)\\s*(?:${idx + 2})\\b|$)`, 'i');
        const textBlockMatch = response.match(searchPattern);

        if (!textBlockMatch) { continue; }

        const blockText = textBlockMatch[0];
        const bodyText = blockText.replace(/^(?:Question|Q)\s*\d+\s*[.:)-]?\s*/i, '').trim();

        const qMeta = _getNormalizedQuestionMeta(question);
        if (qMeta.isTextLike || qMeta.isMultiSelectMatching) {
          if (bodyText) {
            answers[globalIdx] = {
              questionIndex: globalIdx,
              raw: blockText,
              optionIndices: [],
              textAnswer: bodyText,
              confidence: 50,
              explanation: ''
            };
          }
        } else if (qMeta.effectiveOptions.length > 0) {
          const optionIndices = parseFallbackOptionIndices(bodyText, question, qMeta);
          if (optionIndices.length > 0 || (qMeta.isDragDrop && bodyText.length > 0)) {
            answers[globalIdx] = {
              questionIndex: globalIdx,
              raw: blockText,
              optionIndices: optionIndices,
              textAnswer: qMeta.isDragDrop ? (bodyText || null) : null,
              confidence: 50,
              explanation: ''
            };
          }
        }
      }
    }

    return answers.filter(ans => ans !== undefined).map(normalizeAnswerEntry);
  }

  function _log(journal, type, message) {
    const entry = { ts: Date.now(), type, message };
    journal.push(entry);
    console.log(`🤖 [Agent/${type}] ${message}`);
  }

  function _reportProgress(tabId, step, percent, startedAt = null) {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      return;
    }
    const msg = {
      action: 'analysisProgress',
      step,
      percent
    };
    if (typeof startedAt === 'number' && Number.isFinite(startedAt)) {
      msg.startedAt = startedAt;
    }
    Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => {});
  }

  // ────────────────────────────────────────────────
  // AGENT 3.0: PERSISTENT MEMORY & FEEDBACK
  // ────────────────────────────────────────────────

  async function _loadAgentMemory() {
    try {
      const data = await chrome.storage.local.get(['agentMemory']);
      return data.agentMemory || [];
    } catch (e) {
      console.error("Erreur lecture mémoire agent:", e);
      return [];
    }
  }

  async function _saveAgentMemory(memoryArray) {
    try {
      // Limiter à 50 entrées pour éviter de saturer le quota
      if (memoryArray.length > 50) {
        memoryArray = memoryArray.slice(memoryArray.length - 50);
      }
      await chrome.storage.local.set({ agentMemory: memoryArray });
    } catch (e) {
      console.error("Erreur sauvegarde mémoire agent:", e);
    }
  }

  /**
   * Pilier 5: Boucle de feedback post-soumission.
   * Analyse les résultats du quiz et génère une leçon apprise qui sera stockée en mémoire.
   */
  async function learnFromFeedback(feedbackData, config) {
    if (!feedbackData || feedbackData.length === 0) return { success: false, reason: "No feedback data" };
    
    // Normalisation du config : accepte le format plat (ConfigCache.getAll())
    // ET le format structuré (task.config avec syncConfig/apiKeys séparés)
    const rawCfg = (config && typeof config === 'object') ? config : {};
    const syncConfig = (rawCfg.syncConfig && typeof rawCfg.syncConfig === 'object')
      ? { ...rawCfg, ...rawCfg.syncConfig }
      : { ...rawCfg };
    const apiKeys = (rawCfg.apiKeys && typeof rawCfg.apiKeys === 'object')
      ? { ...rawCfg, ...rawCfg.apiKeys }
      : { ...rawCfg };
    const isServiceWorkerCtx = typeof ServiceWorkerGlobalScope !== 'undefined' &&
      self instanceof ServiceWorkerGlobalScope;
    if (isServiceWorkerCtx) {
      delete syncConfig.providerConfigs;
      delete apiKeys.providerConfigs;
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
        try {
          const localData = await chrome.storage.local.get(['providerConfigs']);
          const trustedCfgs = (localData && localData.providerConfigs && typeof localData.providerConfigs === 'object')
            ? localData.providerConfigs
            : {};
          syncConfig.providerConfigs = trustedCfgs;
          apiKeys.providerConfigs = trustedCfgs;
        } catch (_) { /* fallback {} */ }
      }
    }
    const mergedConfig = { ...syncConfig, ...apiKeys };

    // Construire la liste ordonnée des providers configurés (clé API présente)
    const configuredProviders = _getStrictlyConfiguredProviders(mergedConfig, syncConfig.providerOrder);

    if (configuredProviders.length === 0) {
      return { success: false, reason: "No configured provider for feedback" };
    }

    const feedbackText = feedbackData.map(item => 
      `Question: ${item.questionText}\nRéponse Agent: ${item.agentAnswer}\nBonne Réponse: ${item.correctAnswer}\nErreur: ${item.isCorrect ? 'Non' : 'Oui'}`
    ).join('\n\n');

    const prompt = `Tu es un sous-système de réflexion d'un agent de résolution de quiz.\nVoici les résultats de la dernière session après soumission du quiz :\n${feedbackText}\n\nAnalyse les erreurs (s'il y en a) et génère une leçon très concise (2 phrases maximum) sur les pièges à éviter ou la méthode à retenir pour l'avenir. Si tout est correct, génère une brève confirmation du pattern de réussite. Ne retourne QUE la leçon, sans introduction.`;
    
    // Cascade multi-provider : essayer chaque provider configuré jusqu'au succès
    let lastError = null;
    for (const providerKey of configuredProviders) {
      const provider = _getProviderDef(providerKey);
      if (!provider) continue;
      if (!_isProviderConfigured(providerKey, mergedConfig)) continue;

      const model = QuizProviders.getModelForContext(providerKey, false, (syncConfig.customModels || {}));
      const messages = _initHistory(providerKey, "Tu es un système d'apprentissage et de réflexion post-action.", prompt);

      try {
        const response = await _callLLMWithTools(
          providerKey,
          mergedConfig,
          model,
          messages,
          [],
          [], // no tools
          new AbortController().signal
        );
        
        const lesson = response.text.trim();
        if (lesson) {
          const memory = await _loadAgentMemory();
          memory.push({ ts: Date.now(), lesson });
          await _saveAgentMemory(memory);
          console.log("🧠 Leçon apprise et stockée:", lesson);
          return { success: true, lesson };
        }
      } catch (e) {
        console.warn(`⚠️ learnFromFeedback: échec avec ${provider.name}: ${_sanitizeErrorMessage(e, mergedConfig)}`);
        lastError = _createSanitizedError(e, mergedConfig);
      }
    }

    const safeFeedbackError = lastError ? _sanitizeErrorMessage(lastError, mergedConfig) : 'Tous les providers ont échoué';
    console.error("Erreur lors de la réflexion sur le feedback:", safeFeedbackError);
    return { success: false, error: safeFeedbackError };
  }

  return {
    solve,
    learnFromFeedback,
    DOMAIN_PRESETS,
    detectDomain,
    buildDomainRules,
    applyDomainRules,
    computeConfidenceTier,
    normalizeAnswerEntry,
    crossValidateAnswers,
    _formatQuestionForPrompt,
    _buildPrompt,
    _parseAIResponse,
    _callLLMWithTools,
    _answersAgree,
    _mapToolAnswersToParsedAnswers,
    _extractContextMedia,
    _mergeRequestImages,
    _estimateImageTokens,
    _createQuizChunks
  };
})();

if (typeof self !== 'undefined') {
  self.BackgroundAgent = BackgroundAgent;
} else if (typeof window !== 'undefined') {
  window.BackgroundAgent = BackgroundAgent;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BackgroundAgent,
    solve: BackgroundAgent.solve,
    learnFromFeedback: BackgroundAgent.learnFromFeedback,
    DOMAIN_PRESETS: BackgroundAgent.DOMAIN_PRESETS,
    detectDomain: BackgroundAgent.detectDomain,
    buildDomainRules: BackgroundAgent.buildDomainRules,
    applyDomainRules: BackgroundAgent.applyDomainRules,
    computeConfidenceTier: BackgroundAgent.computeConfidenceTier,
    normalizeAnswerEntry: BackgroundAgent.normalizeAnswerEntry,
    crossValidateAnswers: BackgroundAgent.crossValidateAnswers,
    _formatQuestionForPrompt: BackgroundAgent._formatQuestionForPrompt,
    _buildPrompt: BackgroundAgent._buildPrompt,
    _parseAIResponse: BackgroundAgent._parseAIResponse,
    _callLLMWithTools: BackgroundAgent._callLLMWithTools,
    _answersAgree: BackgroundAgent._answersAgree,
    _mapToolAnswersToParsedAnswers: BackgroundAgent._mapToolAnswersToParsedAnswers,
    _extractContextMedia: BackgroundAgent._extractContextMedia,
    _mergeRequestImages: BackgroundAgent._mergeRequestImages,
    _estimateImageTokens: BackgroundAgent._estimateImageTokens,
    _createQuizChunks: BackgroundAgent._createQuizChunks
  };
}
