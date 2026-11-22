// ============================================================
// background-agent.js — Autonomous Tool-Calling Agent (F-INT-01-V2 Unified)
// Architecture : ReAct loop + Multi-Provider Tool Calling Adapters + Robust Fallbacks
// Ce fichier est chargé dans le service worker via importScripts.
// ============================================================
/* global ConfigCache, QuizProviders, handleFetchSerpApi, chrome, module, Date, Array, Number, Boolean, RegExp, parseInt, isNaN */

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

  /**
   * Sanitise une chaîne en texte brut sans balises HTML ni espaces superflus.
   * @param {*} text
   * @param {number} maxLen
   * @returns {string}
   */
  function _sanitizePlainText(text, maxLen = MAX_EXPLANATION_CHARS) {
    if (typeof text !== 'string') {
      return '';
    }
    const stripped = text
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!stripped) {
      return '';
    }
    if (maxLen > 3 && stripped.length > maxLen) {
      return stripped.slice(0, maxLen - 3).trimEnd() + '...';
    }
    return stripped.slice(0, maxLen);
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

  /**
   * Liste strictement les providers possédant une clé API non vide.
   */
  function _getStrictlyConfiguredProviders(mergedConfig, order) {
    if (typeof QuizProviders === 'undefined' || !QuizProviders || !QuizProviders.PROVIDERS) {
      return [];
    }
    const priority = Array.isArray(order) ? order
      : (mergedConfig && Array.isArray(mergedConfig.providerOrder) ? mergedConfig.providerOrder : (QuizProviders.DEFAULT_PRIORITY || []));
    const configured = [];
    for (const rawKey of priority) {
      const pKey = _normalizeProviderKey(rawKey);
      if (!pKey || !Object.prototype.hasOwnProperty.call(QuizProviders.PROVIDERS, pKey)) {
        continue;
      }
      const provider = QuizProviders.PROVIDERS[pKey];
      const field = provider && provider.apiKeyField;
      if (provider && field && mergedConfig && Object.prototype.hasOwnProperty.call(mergedConfig, field) &&
          typeof mergedConfig[field] === 'string' && mergedConfig[field].trim().length > 0 && !configured.includes(pKey)) {
        configured.push(pKey);
      }
    }
    return configured;
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

    const isChoiceQuestion = question && (question.type === 'radio' || question.type === 'checkbox' || (Array.isArray(question.options) && question.options.length > 0));
    if (isChoiceQuestion || (pOpts.length > 0 && sOpts.length > 0)) {
      if (pOpts.length === 0 || sOpts.length === 0 || pOpts.length !== sOpts.length) {
        return false;
      }
      return pOpts.every((val, idx) => val === sOpts[idx]);
    }

    const normText = (txt) => String(txt || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[.,;:!?]+$/, '');
    const pText = normText(primaryAns.textAnswer);
    const sText = normText(secondaryAns.textAnswer);
    return pText.length > 0 && pText === sText;
  }

  /**
   * Construit le prompt ciblé de vérification pour une question unique.
   */
  function _buildVerificationPrompt(question, baseContextText, searchEvidence, settings) {
    let sys = 'You are an independent quiz verification reviewer. Analyze the single question carefully and output ONLY a valid <quiz_answers> XML block with <answer question_id="1" type="..."><confidence>0-100</confidence><explanation>brief plain-text rationale</explanation></answer>.';
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
    if (searchEvidence && typeof searchEvidence === 'string' && searchEvidence.trim().length > 0) {
      usr += `WEB EVIDENCE:\n${searchEvidence.trim().slice(0, 1500)}\n\n`;
    }
    usr += `Question 1: ${question.text || ''}\n`;
    if (question.type === 'radio' || question.type === 'checkbox') {
      usr += `Type: Choix ${question.type === 'radio' ? 'unique' : 'multiple'}\nOptions:\n`;
      const opts = Array.isArray(question.options) ? question.options : [];
      for (let i = 0; i < opts.length; i++) {
        usr += `  ${i + 1}. ${opts[i].text}\n`;
      }
    } else {
      usr += `Type: Réponse textuelle\n`;
    }
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
        const secDef = QuizProviders.PROVIDERS[explicitSecondary];
        const secField = secDef && secDef.apiKeyField;
        canUseExplicitSecondary = Boolean(
          secField &&
          Object.prototype.hasOwnProperty.call(mergedConfig, secField) &&
          typeof mergedConfig[secField] === 'string' &&
          mergedConfig[secField].trim().length > 0
        );
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
          });

          let secAns = null;
          let usedProvider = null;

          for (const secProvider of candidateProviders) {
            if (cvAbort.signal.aborted) {
              break;
            }
            try {
              const hasImages = Array.isArray(q.images) && q.images.length > 0;
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
                q.images || [],
                [],
                cvAbort.signal
              );
              if (cvAbort.signal.aborted) {
                break;
              }
              const parsed = _parseAIResponse(resp?.text || '', [singleQ]);
              if (parsed.length > 0) {
                const candidateAns = normalizeAnswerEntry(parsed[0]);
                const isChoiceQ = singleQ.type === 'radio' || singleQ.type === 'checkbox' || (Array.isArray(singleQ.options) && singleQ.options.length > 0);
                const hasActionable = isChoiceQ
                  ? (candidateAns.optionIndices.length > 0 && (!Array.isArray(singleQ.options) || singleQ.options.length === 0 || candidateAns.optionIndices.every(i => i >= 0 && i < singleQ.options.length)))
                  : (typeof candidateAns.textAnswer === 'string' && candidateAns.textAnswer.trim().length > 0);
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
          if (journal) _log(journal, 'cross_val_err', `Erreur cross-validation Q${primaryAns.questionIndex + 1}: ${err.message}`);
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
      if (q.type === 'text') {
        score += 2; // +2 par question ouverte
      }
    }
    if (totalChars > 1000) {
      score += 2;
    }

    // Images
    const hasImages = task.questions.some(q => q.images && q.images.length > 0);
    if (hasImages) {
      score += 1;
    }

    // Contexte utilisateur
    const syncConfig = task.config?.syncConfig || {};
    const contextText = syncConfig.contextText || '';
    const contextFiles = syncConfig.contextFiles || [];
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

    if (providerKey) {
      const provider = QuizProviders.PROVIDERS[providerKey];
      const apiKey = provider ? mergedConfig[provider.apiKeyField] : null;
      if (!apiKey || apiKey.length === 0) {
        providerKey = null;
      }
    }

    if (!providerKey) {
      providerKey = QuizProviders.getFirstConfiguredProvider(
        mergedConfig,
        syncConfig.providerOrder || QuizProviders.DEFAULT_PRIORITY
      );
    }

    if (!providerKey) {
      _log(journal, 'fast_path_fail', 'Aucun provider configuré pour le Fast Path');
      return null;
    }

    // Contexte utilisateur
    let baseContextText = syncConfig.contextText || '';
    const contextFiles = syncConfig.contextFiles || [];
    for (const f of contextFiles) {
      baseContextText += (f.content || '');
    }

    const quizData = {
      questions: task.questions,
      totalImages: task.questions.reduce((acc, q) => acc + (q.images ? q.images.length : 0), 0)
    };

    const hasImages = quizData.totalImages > 0;
    const modelId = QuizProviders.getModelForContext(providerKey, hasImages, (syncConfig.customModels || {}));

    _log(journal, 'fast_path_start', `Démarrage Fast Path avec ${providerKey} (${modelId})`);

    const initialPrompts = await _buildPrompt(quizData, baseContextText, contextFiles, { ...syncConfig, ...settings });

    // Rassembler toutes les images
    const allImages = [];
    for (const q of task.questions) {
      if (q.images) {
        for (const img of q.images) {
          if (!allImages.some(item => item.dataUrl === img.dataUrl)) {
            allImages.push(img);
          }
        }
      }
    }

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
      _log(journal, 'fast_path_err', `Erreur Fast Path: ${e.message}. Escalade vers l'Agent Path.`);
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
   * @returns {Promise<Object>}
   */
  async function solve(task) {
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

    // AbortController global avec timeout maximal
    const globalAbort = new AbortController();
    const globalTimer = setTimeout(() => globalAbort.abort(), MAX_TOTAL_TIMEOUT_MS);

    try {
      _log(journal, 'agent_start', `Agent démarré pour ${task.questions.length} question(s)`);
      _reportProgress(task.tabId, 'Agent de résolution démarré...', 15);

      const settings = task.config.settings || {};
      const effectiveSyncConfig = { ...(task.config.syncConfig || {}) };
      const intelKeys = ['domainPreset', 'customDomainRules', 'crossValidationEnabled', 'crossValidationThreshold'];
      if (intelKeys.some(k => effectiveSyncConfig[k] === undefined && settings[k] === undefined)) {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          try {
            const localData = (chrome.storage.local && typeof chrome.storage.local.get === 'function')
              ? await chrome.storage.local.get(intelKeys)
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
          } catch (_) {
            // Ignorer les erreurs storage en environnement de test
          }
        }
      }
      const effectiveConfig = { ...task.config, syncConfig: effectiveSyncConfig };
      const effectiveTask = { ...task, config: effectiveConfig };
      const crossValidationEnabled =
        settings.crossValidationEnabled === true ||
        effectiveSyncConfig.crossValidationEnabled === true;

      // ─── Routage adaptatif (Fast Path vs Agent Path) ───
      const complexityScore = _computeComplexityScore(effectiveTask);
      _log(journal, 'routing_eval', `Score de complexité calculé: ${complexityScore} (Seuil Fast <= 3)`);

      if (complexityScore <= 3) {
        _reportProgress(task.tabId, 'Résolution rapide (Fast Path)...', 18);
        const fastResult = await _solveFastPath(effectiveTask, journal, globalAbort.signal);
        if (fastResult) {
          let finalFastAnswers = (fastResult.answers || []).map(normalizeAnswerEntry);
          if (crossValidationEnabled && !globalAbort.signal.aborted) {
            _reportProgress(task.tabId, 'Cross-validation des réponses incertaines...', 90);
            let fastContextText = effectiveSyncConfig.contextText || '';
            for (const f of (effectiveSyncConfig.contextFiles || [])) {
              fastContextText += (f.content || '');
            }
            finalFastAnswers = await crossValidateAnswers(finalFastAnswers, task.questions, {
              primaryProvider: fastResult.metadata?.provider || null,
              config: effectiveConfig,
              baseContextText: fastContextText,
              journal,
              signal: globalAbort.signal
            });
          }
          fastResult.answers = finalFastAnswers.map(normalizeAnswerEntry);
          fastResult.metadata.answersFound = fastResult.answers.length;
          fastResult.metadata.crossValidatedCount = fastResult.answers.filter(a => a.crossValidated).length;
          clearTimeout(globalTimer);
          return fastResult;
        }
        _log(journal, 'routing_fallback', 'Fast Path rejeté ou échoué. Basculement vers l\'Agent Path.');
      }

      _log(journal, 'routing_agent', 'Démarrage de l\'Agent Path complet (ReAct loop)...');

      // ─── Phase 1 : Planning ───
      const plan = await _planStrategy(effectiveTask, journal, globalAbort.signal);
      _reportProgress(task.tabId, `Planification de la résolution...`, 20);

      // Contexte de base : baseContextText
      const baseContextText = plan.baseContextText;
      const contextFiles = plan.contextFiles;

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
        _reportProgress(task.tabId, `Résolution de la partie ${i + 1}/${plan.chunks.length}...`, progressPercent);

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
              baseContextText,
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
            _log(journal, 'llm_chunk_fail', `Échec du provider "${pKey}" pour le chunk ${i + 1}: ${err.message}`);
            lastError = err;
            if (globalAbort.signal.aborted) {
              throw err;
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

      // ─── Phase 4 : Validation (Ralph Loop) ───
      const validated = await _validateAndRetry(
        effectiveTask,
        { answers: cleanedAnswers, provider: providerKey, model: lastUsedModel, chunksProcessed: plan.chunks.length },
        baseContextText,
        plan,
        journal,
        globalAbort.signal
      );

      let finalAnswers = (validated.answers || []).map(normalizeAnswerEntry);
      if (crossValidationEnabled && !globalAbort.signal.aborted) {
        _reportProgress(task.tabId, 'Cross-validation des réponses incertaines...', 90);
        finalAnswers = await crossValidateAnswers(finalAnswers, task.questions, {
          primaryProvider: providerKey,
          config: effectiveConfig,
          baseContextText,
          journal,
          signal: globalAbort.signal
        });
      }
      finalAnswers = finalAnswers.map(normalizeAnswerEntry);

      _reportProgress(task.tabId, 'Résolution terminée', 95);

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
      _log(journal, 'agent_fatal', `Erreur fatale: ${error.message}`);
      return {
        success: false,
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
        error: error.message
      };
    } finally {
      clearTimeout(globalTimer);
    }
  }

  /**
   * Helper pour lister tous les providers configurés avec une clé API dans l'ordre de priorité.
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
      const provider = QuizProviders.PROVIDERS[pKey];
      if (provider && Object.prototype.hasOwnProperty.call(mergedConfig, provider.apiKeyField) &&
          typeof mergedConfig[provider.apiKeyField] === 'string' && mergedConfig[provider.apiKeyField].trim().length > 0 &&
          !configured.includes(pKey)) {
        configured.push(pKey);
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

    let providerKey = _normalizeProviderKey(settings.selectedProvider);

    // Si un provider spécifique est sélectionné, on vérifie s'il dispose d'une clé API valide
    if (providerKey) {
      const provider = Object.prototype.hasOwnProperty.call(QuizProviders.PROVIDERS, providerKey)
        ? QuizProviders.PROVIDERS[providerKey]
        : null;
      const apiKey = (provider && Object.prototype.hasOwnProperty.call(apiKeys, provider.apiKeyField))
        ? apiKeys[provider.apiKeyField]
        : null;
      if (!apiKey || apiKey.length === 0) {
        _log(journal, 'plan_fallback', `Le provider sélectionné "${providerKey}" n'a pas de clé API configurée. Recherche d'un fallback intelligent...`);
        providerKey = null;
      }
    }

    // Routage intelligent de secours : recherche du premier provider configuré avec clé
    if (!providerKey) {
      const mergedConfig = { ...syncConfig, ...apiKeys };
      providerKey = QuizProviders.getFirstConfiguredProvider(
        mergedConfig,
        syncConfig.providerOrder || QuizProviders.DEFAULT_PRIORITY
      );
    }

    // Base context text + files
    let baseContextText = syncConfig.contextText || '';
    const contextFiles = syncConfig.contextFiles || [];
    for (const f of contextFiles) {
      baseContextText += (f.content || '');
    }
    const baseTokens = _estimateTokens(baseContextText);

    // Découper en chunks
    const chunks = _createQuizChunks(task.questions, providerKey, baseTokens, syncConfig);

    // Stratégie dérivée directement de la configuration utilisateur (pas d'appel LLM préliminaire)
    const strategy = { useSearch: syncConfig.agenticSearch === true, analysis: 'standard' };

    const plan = {
      providerKey,
      baseContextText,
      contextFiles,
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
   * @param {string} baseContextText
   * @param {Array} contextFiles
   * @param {string} providerKey
   * @param {Array} journal
   * @param {AbortSignal} signal
   * @returns {Promise<{answers: Array, searchCount: number, model: string}>}
   */
  async function _executeReActLoop(task, chunk, baseContextText, contextFiles, providerKey, journal, signal) {
    const config = task.config;
    const syncConfig = config.syncConfig;
    const modelId = QuizProviders.getModelForContext(providerKey, chunk.isVisionBucket, (syncConfig.customModels || {}));

    const searchEnabled = syncConfig.agenticSearch === true &&
                          typeof syncConfig.serpApiKey === 'string' &&
                          syncConfig.serpApiKey.length > 0;
    const serpApiKey = syncConfig.serpApiKey;

    const chunkQuizData = {
      questions: chunk.questions,
      totalImages: chunk.images
    };

    const initialPrompts = await _buildPrompt(chunkQuizData, baseContextText, contextFiles, {
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

    // Images à joindre
    const allImages = [];
    for (const q of chunk.questions) {
      if (q.images) {
        for (const img of q.images) {
          if (!allImages.some(item => item.dataUrl === img.dataUrl)) {
            allImages.push(img);
          }
        }
      }
    }

    let turn = 0;
    let searchCount = 0;
    let answers = [];
    let finalModel = modelId;
    const executedSearches = new Set();

    // Concept AION 2.0 (Deferred Loading/Bypass) : Si SerpAPI est désactivé, on élimine 
    // l'overhead du tool-calling pour maximiser la vitesse de génération directe.
    if (!searchEnabled) {
      _log(journal, 'react_direct_bypass', 'SerpAPI désactivé, basculement en mode direct ultra-rapide.');
      const response = await _callLLMWithTools(
        providerKey,
        config.apiKeys || {},
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
        config.apiKeys || {},
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
            _log(journal, 'react_tool_err', `Erreur de parsing des arguments de submit_answers: ${err.message}`);
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
    const normalizedKey = String(providerKey || '').trim().toLowerCase();
    if (normalizedKey === 'gemini') {
      return {
        systemInstruction: systemPrompt,
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
      };
    } else if (normalizedKey === 'claude') {
      return {
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      };
    } else {
      // OpenAI, Groq, Mistral, NVIDIA
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
    const normalizedKey = String(providerKey || '').trim().toLowerCase();
    if (normalizedKey === 'gemini') {
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
    } else if (normalizedKey === 'claude') {
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
    const normalizedKey = String(providerKey || '').trim().toLowerCase();
    if (normalizedKey === 'gemini') {
      const parts = toolResults.map(res => ({
        functionResponse: {
          name: res.name,
          response: { result: res.content }
        }
      }));
      history.contents.push({ role: 'user', parts });
      return history;
    } else if (normalizedKey === 'claude') {
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
    const normalizedKey = String(providerKey || '').trim().toLowerCase();
    let tokens = 0;
    try {
      if (normalizedKey === 'gemini') {
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
    const normalizedKey = String(providerKey || '').trim().toLowerCase();
    const totalTokens = _estimateHistoryTokens(normalizedKey, history);
    const COMPACTION_THRESHOLD_TOKENS = 150000; // 150K tokens

    if (totalTokens < COMPACTION_THRESHOLD_TOKENS) {
      // Conserver l'intégralité du contexte pour préserver la qualité de recherche SerpAPI
      return history;
    }

    _log(journal, 'reactive_compact_start', `Taille de contexte (${totalTokens} tokens) supérieure au seuil (${COMPACTION_THRESHOLD_TOKENS} tokens). Déclenchement de la compaction réactive.`);

    try {
      if (normalizedKey === 'gemini') {
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
      } else if (normalizedKey === 'claude') {
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
      _log(journal, 'compact_err', `Échec de la micro-compaction de l'historique : ${e.message}`);
    }
    return history;
  }

  // ────────────────────────────────────────────────
  // API CALLS DISPATCHER WITH TOOLS & MULTI-MODEL FALLBACK
  // ────────────────────────────────────────────────

  async function _callLLMWithTools(providerKey, apiKeys, model, history, images, tools, signal) {
    const normalizedKey = String(providerKey || '').trim().toLowerCase();
    const provider = Object.prototype.hasOwnProperty.call(QuizProviders.PROVIDERS, normalizedKey)
      ? QuizProviders.PROVIDERS[normalizedKey]
      : null;
    if (!provider) {
      throw new Error(`Provider inconnu: ${providerKey}`);
    }
    const apiKey = (apiKeys && Object.prototype.hasOwnProperty.call(apiKeys, provider.apiKeyField))
      ? apiKeys[provider.apiKeyField]
      : null;
    if (!apiKey) {
      throw new Error(`Clé API manquante pour le provider: ${provider.name}`);
    }

    const hasImages = images && images.length > 0;
    const providerModelsObj = hasImages ? (provider.visionModels || []) : (provider.textModels || []);
    const candidateModels = [model];
    for (const m of providerModelsObj) {
      if (m.id && m.id !== model && !candidateModels.includes(m.id)) {
        candidateModels.push(m.id);
      }
    }

    let lastError = null;
    for (const candidateModel of candidateModels) {
      try {
        if (candidateModel !== model) {
          console.warn(`🔄 Fallback modèle interne: essai de ${candidateModel} car ${model} a échoué`);
        }
        let result;
        if (normalizedKey === 'gemini') {
          result = await _callGeminiWithTools(apiKey, candidateModel, history, images, tools, signal);
        } else if (normalizedKey === 'claude') {
          result = await _callClaudeWithTools(apiKey, candidateModel, history, images, tools, signal);
        } else {
          result = await _callOpenAIWithTools(normalizedKey, apiKey, candidateModel, history, images, tools, signal);
        }
        return { ...result, model: candidateModel };
      } catch (err) {
        console.error(`❌ Échec du modèle ${candidateModel} sur ${normalizedKey}:`, err.message);
        lastError = err;
        if (signal && signal.aborted) {
          throw err;
        }
      }
    }
    throw lastError || new Error(`Tous les modèles ont échoué pour le provider ${normalizedKey}`);
  }

  // --- OpenAI / Groq / Mistral / NVIDIA tool calling ---
  async function _callOpenAIWithTools(providerKey, apiKey, model, history, images, tools, signal) {
    const normalizedKey = String(providerKey).toLowerCase();
    const provider = QuizProviders.PROVIDERS[normalizedKey];
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

    if (payloadTools.length > 0) {
      payload.tools = payloadTools;
      payload.tool_choice = 'auto';
    }

    // Gérer l'intégration d'images dans le premier message user (après un éventuel message system)
    if (images && images.length > 0 && payload.messages.length > 0) {
      const firstUserIdx = payload.messages.findIndex(m => m.role === 'user');
      if (firstUserIdx !== -1) {
        const originalUserText = typeof payload.messages[firstUserIdx].content === 'string'
          ? payload.messages[firstUserIdx].content
          : '';
        const lowerModel = model.toLowerCase();
        const isLegacyNvidiaVision = normalizedKey === 'nvidia' && (lowerModel.includes('phi-') || lowerModel.includes('neva'));
        payload.messages = JSON.parse(JSON.stringify(payload.messages)); // deep copy

        if (isLegacyNvidiaVision) {
          const imgTags = images.map(img => `<img src="${img.dataUrl}" />`).join(' ');
          payload.messages[firstUserIdx].content = `${originalUserText}\n${imgTags}`;
        } else {
          const mixedContent = [];
          images.forEach(img => {
            const base64Data = img.dataUrl.split(',')[1];
            const mediaType = img.mimeType || 'image/jpeg';
            mixedContent.push({
              type: 'image_url',
              image_url: { url: `data:${mediaType};base64,${base64Data}` }
            });
          });
          mixedContent.push({ type: 'text', text: originalUserText });
          payload.messages[firstUserIdx].content = mixedContent;
        }
      }
    }

    let targetBaseUrl = provider.baseUrl;
    if (normalizedKey === 'mistral' && model.toLowerCase().includes('codestral')) {
      targetBaseUrl = 'https://codestral.mistral.ai/v1';
    }

    const response = await QuizProviders.extensionFetch(`${targetBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      signal
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Erreur OpenAI API: HTTP ${response.status}`);
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

  // --- Claude tool calling ---
  async function _callClaudeWithTools(apiKey, model, history, images, tools, signal) {
    const payloadTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));

    const messagesToSend = JSON.parse(JSON.stringify(history.messages));

    if (images && images.length > 0 && messagesToSend.length > 0 && messagesToSend[0].role === 'user') {
      const originalUserText = typeof messagesToSend[0].content === 'string'
        ? messagesToSend[0].content
        : '';
      const blocks = [];
      images.forEach(img => {
        const base64Data = img.dataUrl.split(',')[1];
        const mediaType = img.mimeType || 'image/jpeg';
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: base64Data
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

    const response = await QuizProviders.extensionFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(payload),
      signal
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Erreur Claude API: HTTP ${response.status}`);
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

    if (images && images.length > 0 && contentsToSend.length > 0 && contentsToSend[0].role === 'user') {
      const originalUserText = contentsToSend[0].parts[0]?.text || '';
      const parts = [];
      images.forEach(img => {
        const base64Data = img.dataUrl.split(',')[1];
        const mediaType = img.mimeType || 'image/jpeg';
        parts.push({
          inlineData: {
            mimeType: mediaType,
            data: base64Data
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

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await QuizProviders.extensionFetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Erreur Gemini API: HTTP ${response.status}`);
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
    const parsed = [];
    for (const item of toolAnswers) {
      if (!item || typeof item !== 'object') continue;
      const idx = item.questionIndex;
      const question = questions.find((q, qPos) => ((typeof q.index === 'number' ? q.index - 1 : qPos) === idx));
      if (!question) continue;

      const userAns = Array.isArray(item.answers) ? item.answers : [item.answers];
      const explanation = item.explanation || '';
      const confidence = item.confidence;

      if (question.type === 'text') {
        parsed.push(normalizeAnswerEntry({
          questionIndex: idx,
          raw: JSON.stringify(item),
          optionIndices: [],
          textAnswer: userAns[0] || '',
          confidence,
          explanation
        }));
      } else if (question.options && question.options.length > 0) {
        const optionIndices = [];

        for (const val of userAns) {
          if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val < question.options.length) {
            optionIndices.push(val);
            continue;
          }
          if (typeof val === 'string' && /^\s*\d+\s*$/.test(val)) {
            const numeric = parseInt(val.trim(), 10);
            if (!isNaN(numeric) && numeric >= 0 && numeric < question.options.length) {
              optionIndices.push(numeric);
              continue;
            }
          }

          if (typeof val === 'string' && val.length === 1) {
            const code = val.toUpperCase().charCodeAt(0) - 65;
            if (code >= 0 && code < question.options.length) {
              optionIndices.push(code);
              continue;
            }
          }

          if (typeof val === 'string') {
            const valClean = val.toLowerCase().replace(/[^a-z0-9]/g, '');
            let matched = false;
            for (let optIdx = 0; optIdx < question.options.length; optIdx++) {
              const optClean = question.options[optIdx].text.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (optClean && (valClean.includes(optClean) || optClean.includes(valClean))) {
                optionIndices.push(optIdx);
                matched = true;
                break;
              }
            }
            if (matched) continue;
          }
        }

        parsed.push(normalizeAnswerEntry({
          questionIndex: idx,
          raw: JSON.stringify(item),
          optionIndices: optionIndices,
          textAnswer: optionIndices.length === 0 ? (userAns[0] || '') : null,
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
      return `Échec de la recherche web: ${e.message}`;
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

  async function _validateAndRetry(task, llmResult, baseContextText, plan, journal, signal) {
    let { answers, provider, model, chunksProcessed } = llmResult;
    const MAX_RETRIES = 2;
    let retriesUsed = 0;

    const getQIdx = (q, pos) => (typeof q.index === 'number' ? q.index - 1 : pos);
    const answeredIndices = new Set(answers.map(ans => ans.questionIndex));
    let missingQuestions = task.questions.filter((q, pos) => !answeredIndices.has(getQIdx(q, pos)));

    while (missingQuestions.length > 0 && retriesUsed < MAX_RETRIES) {
      if (signal.aborted) {
        break;
      }

      retriesUsed++;
      _log(journal, 'ralph_retry', `Ralph Loop: ${missingQuestions.length} questions manquantes, retry ${retriesUsed}/${MAX_RETRIES}`);
      _reportProgress(task.tabId, `Retry: ${missingQuestions.length} questions manquantes (${retriesUsed}/${MAX_RETRIES})...`, 85);

      const retryQuizData = {
        questions: missingQuestions,
        totalImages: missingQuestions.reduce((acc, q) => acc + (q.images ? q.images.length : 0), 0)
      };

      try {
        const syncConfig = task.config.syncConfig;
        const attemptProviders = _getAllConfiguredProviders(task.config, syncConfig.providerOrder);
        let response = null;
        let lastError = null;

        for (const pKey of attemptProviders) {
          try {
            const initialPrompts = await _buildPrompt(retryQuizData, baseContextText, plan.contextFiles, {
              ...(syncConfig || {}),
              ...(task.config.settings || {}),
              isRetry: true
            });
            const messages = _initHistory(pKey, initialPrompts.system, initialPrompts.user);

            const retryImages = [];
            for (const q of missingQuestions) {
              if (q.images) {
                for (const img of q.images) {
                  if (!retryImages.some(item => item.dataUrl === img.dataUrl)) {
                    retryImages.push(img);
                  }
                }
              }
            }

            const currentModel = QuizProviders.getModelForContext(pKey, retryQuizData.totalImages > 0, (syncConfig.customModels || {}));

            // Pour les retries, on fait un appel direct simple (pas de boucle ReAct pour aller vite)
            response = await _callLLMWithTools(
              pKey,
              task.config.apiKeys || {},
              currentModel,
              messages,
              retryImages,
              [], // Pas d'outils, résolution directe rapide
              signal
            );
            
            break; // Succès
          } catch (e) {
            _log(journal, 'ralph_provider_error', `Erreur retry avec ${pKey}: ${e.message}`);
            lastError = e;
          }
        }

        if (!response) {
          throw new Error(`Tous les providers ont échoué en retry. Dernière erreur: ${lastError ? lastError.message : 'inconnue'}`);
        }

        if (response.model) {
          model = response.model;
        }

        const retryAnswers = _parseAIResponse(response.text, missingQuestions);

        for (const ans of retryAnswers) {
          if (ans && typeof ans.questionIndex === 'number') {
            answers[ans.questionIndex] = ans;
          }
        }

        const newAnsweredIndices = new Set(answers.map(ans => ans.questionIndex));
        missingQuestions = task.questions.filter((q, pos) => !newAnsweredIndices.has(getQIdx(q, pos)));
      } catch (retryError) {
        _log(journal, 'ralph_fail', `Retry ${retriesUsed} échoué: ${retryError.message}`);
        break;
      }
    }

    if (missingQuestions.length > 0) {
      _log(journal, 'ralph_incomplete', `${missingQuestions.length} question(s) sans réponse après ${retriesUsed} retries`);
    }

    return { answers: answers.filter(a => a !== undefined), provider, model, retriesUsed, chunksProcessed };
  }

  // ────────────────────────────────────────────────
  // UTILITAIRES ET PARSERS
  // ────────────────────────────────────────────────

  function _estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
  }

  function _estimateImageTokens(image) {
    if (!image || !image.dataUrl) { return 0; }
    return Math.ceil(image.dataUrl.length / 4);
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

    let userPrompt = '';

    if (contextText) {
      userPrompt += `CONTEXTE FOURNI (Texte):\n${contextText}\n\n`;
    }

    if (contextFiles && contextFiles.length > 0) {
      userPrompt += `CONTEXTE FOURNI (Fichiers):\n`;
      for (const file of contextFiles) {
        userPrompt += `--- Fichier: ${file.name} ---\n${file.content}\n\n`;
      }
    }

    if (quizData.totalImages > 0) {
      userPrompt += `NOTE: Des images sont jointes à ce message. Analyse-les attentivement.\n\n`;
    }

    userPrompt += `QUESTIONS:\n\n`;

    for (let idx = 0; idx < quizData.questions.length; idx++) {
      const q = quizData.questions[idx];
      userPrompt += `Question ${idx + 1}: ${q.text}\n`;

      if (q.images && q.images.length > 0) {
        userPrompt += `  [${q.images.length} image(s) jointe(s) pour cette question]\n`;
      }

      if (q.type === 'radio' || q.type === 'checkbox') {
        userPrompt += `Type: Choix ${q.type === 'radio' ? 'unique' : 'multiple'}\n`;
        userPrompt += `Options:\n`;
        for (let optIdx = 0; optIdx < q.options.length; optIdx++) {
          userPrompt += `  ${optIdx + 1}. ${q.options[optIdx].text}\n`;
        }
      } else if (q.type === 'text') {
        userPrompt += `Type: Réponse textuelle\n`;
      }
      userPrompt += `\n`;
    }

    if (settings && settings.isRetry) {
      userPrompt += `[RATTRAPAGE / AUTO-CORRECTION] Tu as précédemment échoué à répondre à ces questions (format invalide ou omission). Avant d'appeler l'outil submit_answers, tu DOIS analyser pourquoi tu as échoué et corriger ton approche (remplis bien le champ thought_process de l'outil). Tu DOIS fournir une réponse pour CHAQUE question ci-dessus.\n\n`;
    }

    userPrompt += `RÉPONSES:`;
    return { system: systemPrompt, user: userPrompt };
  }

  function _createQuizChunks(questions, providerKey, baseTokens, syncConfig) {
    if (!Array.isArray(questions)) {
      throw new Error('_createQuizChunks: questions doit être un tableau.');
    }
    const textQuestions = [];
    const visionQuestions = [];

    for (const q of questions) {
      if (q.images && q.images.length > 0) {
        visionQuestions.push(q);
      } else {
        textQuestions.push(q);
      }
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
        for (const opt of q.options) {
          qTokens += _estimateTokens(opt.text);
        }
        if (q.images) {
          for (const img of q.images) {
            qTokens += _estimateImageTokens(img);
          }
        }

        if (currentChunk.tokens + qTokens > MAX_CHUNK_TOKENS && currentChunk.questions.length > 0) {
          chunks.push(currentChunk);
          currentChunk = { questions: [], tokens: baseTokens, images: 0, isVisionBucket, fallbackModelId: null };
        }

        currentChunk.questions.push(q);
        currentChunk.tokens += qTokens;
        if (q.images) { currentChunk.images += q.images.length; }
      }
      if (currentChunk.questions.length > 0) { chunks.push(currentChunk); }

      return chunks;
    };

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
      if (Array.isArray(q.options) && q.options.length > 0) {
        return idx < q.options.length;
      }
      return true;
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

        const type = (typeMatch ? typeMatch[1] : (question.type || 'radio')).toLowerCase();
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
          }
        } else if (type === 'checkbox') {
          const optIndicesMatch = inner.match(/<option_indices>\s*([\d,\s]+)\s*<\/option_indices>/i);
          if (optIndicesMatch) {
            const indices = optIndicesMatch[1].split(',')
              .map(n => parseInt(n.trim(), 10) - 1)
              .filter(n => isValidOptionIndex(question, n));
            if (indices.length > 0) {
              answers[globalIdx] = {
                questionIndex: globalIdx,
                raw: optIndicesMatch[0],
                optionIndices: indices,
                textAnswer: null,
                confidence,
                explanation
              };
            }
          }
        } else if (type === 'text') {
          const textMatch = inner.match(/<text_reply>([\s\S]*?)<\/text_reply>/i);
          if (textMatch) {
            answers[globalIdx] = {
              questionIndex: globalIdx,
              raw: textMatch[0],
              optionIndices: [],
              textAnswer: textMatch[1].trim(),
              confidence,
              explanation
            };
          }
        }
      }
    }

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

        if (question.type === 'text') {
          answers[globalIdx] = {
            questionIndex: globalIdx,
            raw: rawAnswer,
            optionIndices: [],
            textAnswer: rawAnswer,
            confidence: 50,
            explanation: ''
          };
        } else {
          const numbers = rawAnswer.match(/\d+/g);
          let optionIndices = numbers
            ? numbers.map(n => parseInt(n, 10) - 1).filter(n => isValidOptionIndex(question, n))
            : [];

          if (optionIndices.length === 0 && question.options && question.options.length > 0) {
            const letterMatch = rawAnswer.match(/^[A-G]$/i) || rawAnswer.match(/^option\s+([A-G])$/i);
            if (letterMatch) {
              const letter = (letterMatch[1] || letterMatch[0]).toUpperCase();
              const code = letter.charCodeAt(0) - 65;
              if (code >= 0 && code < question.options.length) {
                optionIndices.push(code);
              }
            }
          }

          if (optionIndices.length === 0 && question.options && question.options.length > 0) {
            const cleanAns = rawAnswer.toLowerCase().replace(/[^a-z0-9]/g, '');
            for (let oIdx = 0; oIdx < question.options.length; oIdx++) {
              const cleanOpt = question.options[oIdx].text.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (cleanOpt && (cleanAns.includes(cleanOpt) || cleanOpt.includes(cleanAns))) {
                optionIndices.push(oIdx);
              }
            }
          }

          answers[globalIdx] = {
            questionIndex: globalIdx,
            raw: rawAnswer,
            optionIndices: optionIndices,
            textAnswer: optionIndices.length === 0 ? rawAnswer : null,
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

        if (question.type === 'text') {
          const textAns = blockText.replace(/^(?:Question|Q)\s*\d+[\s\S]*?[.:)-]/i, '').trim();
          if (textAns) {
            answers[globalIdx] = {
              questionIndex: globalIdx,
              raw: blockText,
              optionIndices: [],
              textAnswer: textAns,
              confidence: 50,
              explanation: ''
            };
          }
        } else if (question.options && question.options.length > 0) {
          const numbers = blockText.match(/\d+/g);
          let optionIndices = numbers
            ? numbers.map(n => parseInt(n) - 1).filter(n => n >= 0 && n < question.options.length)
            : [];

          if (optionIndices.length === 0) {
            for (let oIdx = 0; oIdx < question.options.length; oIdx++) {
              const optClean = question.options[oIdx].text.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (optClean && blockText.toLowerCase().replace(/[^a-z0-9]/g, '').includes(optClean)) {
                optionIndices.push(oIdx);
              }
            }
          }

          if (optionIndices.length > 0) {
            answers[globalIdx] = {
              questionIndex: globalIdx,
              raw: blockText,
              optionIndices: optionIndices,
              textAnswer: null,
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

  function _reportProgress(tabId, step, percent) {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      return;
    }
    Promise.resolve(chrome.runtime.sendMessage({
      action: 'analysisProgress',
      step,
      percent
    })).catch(() => {});
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
    const syncConfig = config.syncConfig || config || {};
    const apiKeys = config.apiKeys || config || {};
    const mergedConfig = { ...syncConfig, ...apiKeys };

    // Construire la liste ordonnée des providers configurés (clé API présente)
    const configuredProviders = _getAllConfiguredProviders(
      { syncConfig: mergedConfig, apiKeys: mergedConfig },
      syncConfig.providerOrder || QuizProviders.DEFAULT_PRIORITY
    );

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
      const provider = QuizProviders.PROVIDERS[providerKey];
      if (!provider) continue;

      const apiKey = mergedConfig[provider.apiKeyField];
      if (!apiKey || apiKey.trim().length === 0) continue;

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
        console.warn(`⚠️ learnFromFeedback: échec avec ${provider.name}: ${e.message}`);
        lastError = e;
      }
    }

    console.error("Erreur lors de la réflexion sur le feedback:", lastError);
    return { success: false, error: lastError ? lastError.message : 'Tous les providers ont échoué' };
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
    crossValidateAnswers
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
    crossValidateAnswers: BackgroundAgent.crossValidateAnswers
  };
}
