// content.js - Safe Exm Orchestrator & Parser (CRIT-01, CRIT-03, F-AUTO-02, F-AUTO-03)
/* global ConfigCache, SchemaDetector, SchemaCache, DOMExtractor, Number, Boolean, Array, RegExp */
(async function () {
  'use strict';

  const rootWin = typeof window !== 'undefined' ? window : globalThis;

  // Prevent multiple executions of the core script
  if (rootWin.__quizHelperLoaded) {
    return;
  }
  rootWin.__quizHelperLoaded = true;

  // Initialize namespace
  rootWin.SafeExm = rootWin.SafeExm || {};

  let isEnabled = true;
  let pendingTextAnswers = [];

  // Auto Mode Tracking
  let _lastAutoContentHash = '';
  let _autoAnalysisRunning = false;

  // Auto Mode Observer (déclaré ici pour éviter la TDZ lors du bootstrap)
  let _autoModeObserver = null;
  let _autoModeDebounceTimer = null;

  // F-AUTO-02 : Pre-Warm state (une seule fois par page)
  let _preWarmTriggered = false;

  // F-AUTO-03 : Auto-Submit pending timer state
  let _pendingAutoSubmitTimer = null;
  let _pendingAutoSubmitResolve = null;

  // Tracking des questions déjà analysées pour le delta Auto Mode
  const _analyzedQuestionTexts = new Set();
  // Feedback tracking
  let _feedbackSent = false;

  // F-DET-04 : Etat opt-in de l'interception réseau passive dans le MAIN world
  let _passiveBridgeEnabled = false;
  let _passiveBridgeSyncPromise = Promise.resolve();

  function _performSyncPassiveNetworkInterceptor(shouldEnable) {
    const wantEnable = shouldEnable === true;
    const extractor = (rootWin.SafeExm && rootWin.SafeExm.DOMExtractor) ||
      (typeof DOMExtractor !== 'undefined' ? DOMExtractor : null);

    return (async () => {
      if (wantEnable) {
        if (!isExtensionEnabled()) {
          return { enabled: false, skipped: 'disabled' };
        }
        if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
          return { enabled: false, skipped: 'no-runtime' };
        }
        const injectResp = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'injectPageBridge' }, (resp) => {
            if (chrome.runtime && chrome.runtime.lastError) {
              resolve(null);
            } else {
              resolve(resp);
            }
          });
        });
        if (!injectResp || !injectResp.success) {
          _passiveBridgeEnabled = false;
          return { enabled: false, error: (injectResp && injectResp.error) || 'inject_failed' };
        }
        const bridgeRes = (extractor && typeof extractor.requestPageBridge === 'function')
          ? await extractor.requestPageBridge('enableNetworkInterceptor')
          : null;
        _passiveBridgeEnabled = Boolean(bridgeRes && bridgeRes.ok && bridgeRes.data && bridgeRes.data.enabled);
        return { enabled: _passiveBridgeEnabled, response: bridgeRes };
      }

      if (!_passiveBridgeEnabled) {
        return { enabled: false, skipped: 'not-active' };
      }
      if (extractor && typeof extractor.requestPageBridge === 'function') {
        await extractor.requestPageBridge('restoreNetworkInterceptor');
      }
      _passiveBridgeEnabled = false;
      return { enabled: false, restored: true };
    })();
  }

  /**
   * Active ou restaure de façon sérialisée et strictement opt-in le bridge réseau MAIN world.
   */
  function syncPassiveNetworkInterceptor(shouldEnable) {
    const next = _passiveBridgeSyncPromise.then(
      () => _performSyncPassiveNetworkInterceptor(shouldEnable),
      () => _performSyncPassiveNetworkInterceptor(shouldEnable)
    );
    _passiveBridgeSyncPromise = next.catch(() => {});
    return next;
  }

  const EXTRA_LOCAL_BEHAVIOR_KEYS = [
    'domainPreset',
    'customDomainRules',
    'crossValidationEnabled',
    'crossValidationThreshold',
    'autoSubmitEnabled',
    'autoSubmitMinConfidence',
    'autoSubmitDelayMs',
    'passiveNetworkIntercept'
  ];

  // Initialisation de la configuration au chargement
  try {
    if (typeof ConfigCache !== 'undefined' && ConfigCache) {
      if (typeof ConfigCache.isInitialized === 'function' && !ConfigCache.isInitialized() && typeof ConfigCache.init === 'function') {
        await ConfigCache.init();
      }
      const rawEnabled = typeof ConfigCache.get === 'function' ? ConfigCache.get('enabled') : undefined;
      if (rawEnabled !== undefined) {
        isEnabled = rawEnabled === true;
      }

      // Auto Mode Bootstrapping
      if (typeof ConfigCache.get === 'function' && ConfigCache.get('autoMode') === true) {
        setupAutoModeObserver();
      }

      // Opt-in MAIN-world passive network interception bootstrap (non-blocking, zero await before ContentAPI export)
      if (isEnabled && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
        Promise.resolve(chrome.storage.local.get(['passiveNetworkIntercept']))
          .then((localBridgeCfg) => {
            if (isExtensionEnabled() && localBridgeCfg && localBridgeCfg.passiveNetworkIntercept === true) {
              syncPassiveNetworkInterceptor(true).catch(() => {});
            }
          })
          .catch(() => {});
      }
    }
  } catch (e) {
    console.warn('⚠️ Erreur initialisation ConfigCache:', e.message);
  }

  // Setup message listener
  setupMessageListener();

  console.log('🚀 Safe Exm - Cœur d\'orchestration chargé avec succès !');

  // ──────────────────────────────────────────────
  // SAFE SETTINGS SUMMARY (Forensic Fix: zero secret leak to console)
  // ──────────────────────────────────────────────

  /**
   * Construit un résumé de configuration strictement dépourvu de clés API, tokens, secrets ou fichiers.
   * @param {Object} rawSettings
   * @returns {Object}
   */
  function buildSafeSettingsSummary(rawSettings) {
    const s = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
    const stealth = s.stealthLevel || s.discretionLevel || s.highlightDiscretion || 'furtif';
    return {
      enabled: Boolean(s.enabled ?? isEnabled),
      autoMode: Boolean(s.autoMode),
      selectedProvider: typeof s.selectedProvider === 'string' && s.selectedProvider ? s.selectedProvider : 'auto',
      stealthLevel: typeof stealth === 'string' ? stealth : String(stealth),
      domainPreset: typeof s.domainPreset === 'string' && s.domainPreset ? s.domainPreset : 'auto',
      crossValidationEnabled: Boolean(s.crossValidationEnabled),
      autoSubmitEnabled: Boolean(s.autoSubmitEnabled)
    };
  }

  // ──────────────────────────────────────────────
  // F-AUTO-02 : PRE-WARM PROVIDERS TRIGGER
  // ──────────────────────────────────────────────

  function isExtensionEnabled() {
    if (isEnabled === false) return false;
    try {
      if (typeof ConfigCache !== 'undefined' && ConfigCache && typeof ConfigCache.get === 'function') {
        if (!ConfigCache.isInitialized || ConfigCache.isInitialized()) {
          const cached = ConfigCache.get('enabled');
          if (cached === false) return false;
          if (cached === true) return true;
        }
      }
    } catch (e) { /* ignore */ }
    return Boolean(isEnabled);
  }

  function triggerPreWarmProviders(force = false) {
    if (_preWarmTriggered && !force) {
      return false;
    }
    if (!isExtensionEnabled()) {
      return false;
    }
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      return false;
    }
    _preWarmTriggered = true;
    try {
      chrome.runtime.sendMessage({ action: 'preWarmProviders' }, () => {
        void chrome.runtime?.lastError;
      });
    } catch (e) { /* non-blocking */ }
    return true;
  }

  function resetPreWarmState() {
    _preWarmTriggered = false;
  }

  // ──────────────────────────────────────────────
  // AUTO MODE OBSERVER (SPA/Pagination detection)
  // ──────────────────────────────────────────────

  function setupAutoModeObserver() {
    if (_autoModeObserver) return;
    if (typeof MutationObserver !== 'function' || typeof document === 'undefined' || !document || !document.body) {
      return;
    }

    _autoModeObserver = new MutationObserver((records) => {
      const hm = rootWin.SafeExm && rootWin.SafeExm.HighlightManager;
      if (hm && typeof hm.isOwnUiMutation === 'function' && hm.isOwnUiMutation(records)) {
        return;
      }
      triggerAutoAnalysis('DOM Mutation');
    });

    _autoModeObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('🤖 Auto Mode: Observateur démarré.');
  }

  function clearAutoModeObserver() {
    if (_autoModeObserver) {
      _autoModeObserver.disconnect();
      _autoModeObserver = null;
    }
    if (_autoModeDebounceTimer) {
      clearTimeout(_autoModeDebounceTimer);
      _autoModeDebounceTimer = null;
    }
    console.log('🤖 Auto Mode: Observateur arrêté.');
  }

  // Listen to configuration change to toggle Auto Mode, Panic abort & opt-in network bridge
  if (typeof ConfigCache !== 'undefined' && ConfigCache && typeof ConfigCache.onChange === 'function') {
    ConfigCache.onChange((changes) => {
      if (changes.autoMode) {
        if (changes.autoMode.newValue === true) {
          setupAutoModeObserver();
        } else {
          clearAutoModeObserver();
        }
      }
      if (changes.autoSubmitEnabled && changes.autoSubmitEnabled.newValue !== true) {
        cancelPendingAutoSubmit();
      }
      if (changes.passiveNetworkIntercept) {
        syncPassiveNetworkInterceptor(changes.passiveNetworkIntercept.newValue === true).catch(() => {});
      }
      if (changes.enabled) {
        isEnabled = changes.enabled.newValue === true;
        if (!isEnabled) {
          cancelPendingAutoSubmit();
          syncPassiveNetworkInterceptor(false).catch(() => {});
          if (rootWin.SafeExm.HighlightManager) {
            rootWin.SafeExm.HighlightManager.clearAllHighlights();
          }
        }
      }
    });
  }

  function triggerAutoAnalysis(reason) {
    if (!isExtensionEnabled() || _autoAnalysisRunning) return;

    if (_autoModeDebounceTimer) {
      clearTimeout(_autoModeDebounceTimer);
    }

    _autoModeDebounceTimer = setTimeout(async () => {
      try {
        if (!isQuizPage()) return;

        // Pilier 5: Détection de feedback
        if (!_feedbackSent && detectAndSendFeedback()) {
          _feedbackSent = true;
          return;
        }

        const rawBodyText = (document.body?.innerText || document.body?.textContent || '').trim();
        const contentHash = rawBodyText.length <= 1000
          ? rawBodyText
          : `${rawBodyText.length}:${rawBodyText.slice(0, 500)}:${rawBodyText.slice(-500)}`;
        if (contentHash === _lastAutoContentHash && rawBodyText.length > 50) {
          return;
        }
        _lastAutoContentHash = contentHash;

        console.log(`⚡ Auto Mode: Lancement de l'analyse (raison: ${reason})`);
        _autoAnalysisRunning = true;

        const allSettings = typeof ConfigCache !== 'undefined' && ConfigCache && typeof ConfigCache.getAll === 'function'
          ? ConfigCache.getAll()
          : {};
        await handleAnalyzeQuiz(allSettings, true, true);
      } catch (e) {
        if (e.message && e.message.includes('Extension context invalidated')) {
          console.warn('🔄 Auto Mode: Extension rechargée. Rechargez la page pour continuer.');
          isEnabled = false;
          cancelPendingAutoSubmit();
          clearAutoModeObserver();
          return;
        }
        console.error('❌ Auto Mode: Erreur:', e.message);
      } finally {
        _autoAnalysisRunning = false;
      }
    }, 3000);
  }

  function detectAndSendFeedback() {
    if (typeof document === 'undefined' || !document || !document.body) return false;
    const bodyText = (document.body.innerText || document.body.textContent || '').toLowerCase();
    const hasScore = bodyText.includes('score') || bodyText.includes('résultat') || bodyText.includes('result');
    const hasCorrection = bodyText.includes('correct answer') ||
      bodyText.includes('bonne réponse') ||
      (typeof document.querySelectorAll === 'function' && document.querySelectorAll('.correct, .incorrect, [data-correct]').length > 0);

    if (hasScore && hasCorrection) {
      console.log('🎓 Page de résultat détectée, extraction du feedback...');
      const feedbackData = [];
      const questions = typeof document.querySelectorAll === 'function'
        ? document.querySelectorAll('.question-block, .quiz-question, [class*="question"]')
        : [];
      questions.forEach(q => {
        const text = q.innerText || q.textContent;
        if (text) {
          feedbackData.push({
            questionText: text.substring(0, 150),
            agentAnswer: 'N/A',
            correctAnswer: 'Voir le DOM',
            isCorrect: text.toLowerCase().includes('correct') && !text.toLowerCase().includes('incorrect')
          });
        }
      });

      if (feedbackData.length > 0 && typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        chrome.runtime.sendMessage({
          action: 'submitQuizFeedback',
          feedbackData,
          config: typeof ConfigCache !== 'undefined' && ConfigCache ? ConfigCache.getAll() : {}
        });
        return true;
      }
    }
    return false;
  }

  // ──────────────────────────────────────────────
  // MESSAGE LISTENER
  // ──────────────────────────────────────────────

  function setupMessageListener() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage || typeof chrome.runtime.onMessage.addListener !== 'function') {
      return;
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const safeAction = message && typeof message === 'object' ? message.action : 'unknown';
      console.log('📨 Message reçu:', { action: safeAction });

      if (!rootWin.SafeExm.HighlightManager) {
        console.warn('⚠️ HighlightManager non encore injecté/disponible.');
        sendResponse({ success: false, error: 'HighlightManager non disponible' });
        return;
      }

      switch (safeAction) {
        case 'toggleExtension':
          isEnabled = Boolean(message.enabled);
          if (!isEnabled) {
            cancelPendingAutoSubmit();
            syncPassiveNetworkInterceptor(false).catch(() => {});
            rootWin.SafeExm.HighlightManager.clearAllHighlights();
          }
          console.log('🔄 Extension:', isEnabled ? 'activée' : 'désactivée');
          sendResponse({ success: true });
          break;

        case 'analyzeQuiz':
          console.log('🔍 Début analyse quiz...');
          handleAnalyzeQuiz(message.settings, message.forceFallback)
            .then(result => {
              console.log('📊 Résultat analyse:', result);
              sendResponse(result);
            })
            .catch(error => {
              console.error('❌ Erreur analyse:', error);
              sendResponse({ success: false, error: error.message });
            });
          return true;

        case 'clearHighlights':
          cancelPendingAutoSubmit();
          rootWin.SafeExm.HighlightManager.clearAllHighlights();
          sendResponse({ success: true });
          break;

        case 'discoverSchema':
          console.log('🔬 Découverte de schéma manuelle...');
          handleDiscoverSchema()
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true;

        case 'getSchemaStatus':
          handleGetSchemaStatus()
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true;

        case 'pasteAnswer':
          handlePasteAnswer();
          sendResponse({ success: true });
          break;
      }
    });
  }

  /**
   * Détecte si la page courante contient un quiz (y compris dans un Shadow DOM via querySelectorDeep).
   * Déclenche le pre-warm des providers (F-AUTO-02) une fois par page lorsque l'extension est activée.
   */
  function isQuizPage() {
    const extractor = (rootWin.SafeExm && rootWin.SafeExm.DOMExtractor) ||
      (typeof DOMExtractor !== 'undefined' ? DOMExtractor : null);
    if (!extractor) return false;

    const loc = (typeof window !== 'undefined' && window.location)
      ? window.location
      : { pathname: '', href: '', hostname: '' };
    const isQuizUrl = (loc.pathname || '').includes('quiz') ||
      (loc.href || '').includes('quiz') ||
      (loc.hostname || '').includes('quizgecko.com');

    const selectorsList = (extractor.QUIZ_SELECTORS && Array.isArray(extractor.QUIZ_SELECTORS.quizContainer))
      ? extractor.QUIZ_SELECTORS.quizContainer
      : ['.quiz', '.quiz-container', '.question-container'];
    const selectorStr = selectorsList.join(',');

    let quizContainerEl = null;
    if (typeof DOMExtractor !== 'undefined' && DOMExtractor && typeof DOMExtractor.querySelectorDeep === 'function') {
      quizContainerEl = DOMExtractor.querySelectorDeep(selectorStr, typeof document !== 'undefined' ? document : null);
    } else if (typeof extractor.querySelectorDeep === 'function') {
      quizContainerEl = extractor.querySelectorDeep(selectorStr, typeof document !== 'undefined' ? document : null);
    } else if (typeof document !== 'undefined' && document && typeof document.querySelector === 'function') {
      quizContainerEl = document.querySelector(selectorStr);
    }

    const hasQuizElements = Boolean(quizContainerEl);
    const hasInteractive = typeof SchemaDetector !== 'undefined' &&
      SchemaDetector &&
      typeof SchemaDetector.hasInteractiveContent === 'function' &&
      Boolean(SchemaDetector.hasInteractiveContent());

    const detected = Boolean(isQuizUrl || hasQuizElements || hasInteractive);
    if (detected && isExtensionEnabled()) {
      triggerPreWarmProviders();
    }
    return detected;
  }

  // ──────────────────────────────────────────────
  // AUTO MODE DELTA FILTER & RE-INDEXING
  // ──────────────────────────────────────────────

  /**
   * Filtre les questions non encore analysées en mode Auto et ré-indexe 1..N
   * pour aligner q.index (1-based) avec ans.questionIndex (0-based).
   * @param {Array<Object>} questions
   * @param {Set<string>} [analyzedSet]
   * @returns {Array<Object>}
   */
  function filterAndReindexDeltaQuestions(questions, analyzedSet = _analyzedQuestionTexts) {
    if (!Array.isArray(questions)) return [];
    const targetSet = analyzedSet instanceof Set ? analyzedSet : _analyzedQuestionTexts;
    const newQuestions = questions.filter((q) => {
      if (!q || typeof q.text !== 'string') return false;
      return !targetSet.has(q.text.trim());
    });
    newQuestions.forEach((q, idx) => {
      q.index = idx + 1;
    });
    return newQuestions;
  }

  // ──────────────────────────────────────────────
  // F-AUTO-03 : OPT-IN AUTO-SUBMIT INTELLIGENCE
  // ──────────────────────────────────────────────

  function computeAutoSubmitDelay(baseDelayMs) {
    const baseDelay = Math.max(300, Number(baseDelayMs) || 1500);
    const jitter = Math.floor((Math.random() * 0.4 - 0.2) * baseDelay);
    return Math.max(200, baseDelay + jitter);
  }

  function cancelPendingAutoSubmit() {
    let wasCancelled = false;
    if (_pendingAutoSubmitTimer !== null) {
      clearTimeout(_pendingAutoSubmitTimer);
      _pendingAutoSubmitTimer = null;
      wasCancelled = true;
    }
    if (typeof _pendingAutoSubmitResolve === 'function') {
      const resolve = _pendingAutoSubmitResolve;
      _pendingAutoSubmitResolve = null;
      resolve({ scheduled: true, executed: false, aborted: true });
      wasCancelled = true;
    }
    if (wasCancelled) {
      console.log('🛑 Auto-Submit: Soumission programmée annulée (Panic / Désactivation).');
    }
    return wasCancelled;
  }

  function canAutoSubmitBatch(questions, answers, settings) {
    if (!settings || typeof settings !== 'object' || settings.autoSubmitEnabled !== true) {
      return { allowed: false, reason: 'disabled' };
    }
    if (settings.enabled === false || !isExtensionEnabled()) {
      return { allowed: false, reason: 'extension_disabled' };
    }
    if (!Array.isArray(questions) || questions.length === 0 || !Array.isArray(answers) || answers.length === 0) {
      console.log('🛡️ Auto-Submit ignoré : aucune question ou réponse disponible.');
      return { allowed: false, reason: 'empty_batch' };
    }
    if (answers.length < questions.length) {
      console.log(`🛡️ Auto-Submit ignoré : réponses incomplètes (${answers.length}/${questions.length}).`);
      return { allowed: false, reason: 'incomplete_answers' };
    }

    const minConfidence = Number(settings.autoSubmitMinConfidence) || 85;
    const answersByIndex = new Map();
    answers.forEach((ans, idx) => {
      if (ans && typeof ans === 'object') {
        const qIdx = typeof ans.questionIndex === 'number' ? ans.questionIndex : idx;
        answersByIndex.set(qIdx, ans);
      }
    });

    for (let qIdx = 0; qIdx < questions.length; qIdx++) {
      const ans = answersByIndex.get(qIdx) || answers[qIdx];
      if (!ans || typeof ans !== 'object') {
        console.log(`🛡️ Auto-Submit ignoré : réponse manquante pour Q${qIdx + 1}.`);
        return { allowed: false, reason: 'missing_answer', questionIndex: qIdx };
      }
      const confidence = (typeof ans.confidence === 'number' && Number.isFinite(ans.confidence))
        ? ans.confidence
        : 0;
      if (confidence < minConfidence) {
        console.log(`🛡️ Auto-Submit ignoré : confiance insuffisante sur Q${qIdx + 1} (${confidence}% < ${minConfidence}%).`);
        return {
          allowed: false,
          reason: 'low_confidence',
          questionIndex: qIdx,
          confidence,
          minConfidence
        };
      }
    }

    return { allowed: true, minConfidence };
  }

  function dispatchInputEvents(el) {
    if (!el || typeof el.dispatchEvent !== 'function') return;
    try {
      if (typeof Event === 'function') {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.dispatchEvent({ type: 'input', bubbles: true });
        el.dispatchEvent({ type: 'change', bubbles: true });
      }
    } catch (e) { /* ignore mock event errors */ }
  }

  function fillQuestionAnswer(question, answer) {
    if (!question || typeof question !== 'object' || !answer || typeof answer !== 'object') {
      return false;
    }

    const qType = question.questionType || question.type || 'unknown';
    const optionIndices = Array.isArray(answer.optionIndices) ? answer.optionIndices : [];
    const textAnswer = answer.textAnswer !== undefined && answer.textAnswer !== null
      ? String(answer.textAnswer)
      : (typeof answer.raw === 'string' ? answer.raw : '');

    if (qType === 'radio' || qType === 'single_choice') {
      const targetIdx = optionIndices.length > 0 ? optionIndices[0] : -1;
      const options = Array.isArray(question.options) ? question.options : [];
      const chosen = options[targetIdx];
      if (!chosen) return false;
      const el = chosen.element || chosen.labelElement;
      if (!el) return false;

      options.forEach((opt, idx) => {
        if (opt && opt.element && idx !== targetIdx) {
          opt.element.checked = false;
        }
      });
      el.checked = true;
      chosen.checked = true;
      if (typeof el.setAttribute === 'function' && typeof el.getAttribute === 'function' && el.getAttribute('role') === 'radio') {
        el.setAttribute('aria-checked', 'true');
      }
      if (typeof el.click === 'function') {
        el.click();
      } else if (chosen.labelElement && typeof chosen.labelElement.click === 'function') {
        chosen.labelElement.click();
      }
      dispatchInputEvents(el);
      return true;
    }

    if (qType === 'checkbox' || qType === 'multi_choice') {
      const options = Array.isArray(question.options) ? question.options : [];
      if (optionIndices.length === 0) return false;
      const selectedSet = new Set(optionIndices);
      let filled = false;

      options.forEach((opt, idx) => {
        if (!opt || !opt.element) return;
        const shouldCheck = selectedSet.has(idx);
        if (shouldCheck) {
          const wasChecked = Boolean(opt.element.checked);
          opt.element.checked = true;
          opt.checked = true;
          if (typeof opt.element.setAttribute === 'function' && typeof opt.element.getAttribute === 'function' && opt.element.getAttribute('role') === 'checkbox') {
            opt.element.setAttribute('aria-checked', 'true');
          }
          if (!wasChecked && typeof opt.element.click === 'function') {
            opt.element.click();
            opt.element.checked = true;
          }
          dispatchInputEvents(opt.element);
          filled = true;
        }
      });
      return filled;
    }

    if (qType === 'select_matching' || qType === 'select' || (Array.isArray(question.selects) && question.selects.length > 0)) {
      const selects = Array.isArray(question.selects) && question.selects.length > 0
        ? question.selects
        : (question.inputElement ? [{ element: question.inputElement, options: question.options || [] }] : []);
      if (selects.length === 0) return false;

      const textParts = textAnswer ? textAnswer.split(/\s*[|;\n,]\s*/).filter(Boolean) : [];
      let filled = false;

      selects.forEach((selEntry, sIdx) => {
        const selectEl = selEntry && (selEntry.element || selEntry.selectElement);
        if (!selectEl) return;
        const opts = Array.isArray(selEntry.options) ? selEntry.options : [];
        let chosenOpt = null;

        if (selects.length === 1 && optionIndices.length > 0 && opts[optionIndices[0]]) {
          chosenOpt = opts[optionIndices[0]];
        } else if (optionIndices[sIdx] !== undefined && opts[optionIndices[sIdx]]) {
          chosenOpt = opts[optionIndices[sIdx]];
        } else {
          const targetText = (textParts[sIdx] || textParts[0] || textAnswer || '').trim().toLowerCase();
          if (targetText) {
            chosenOpt = opts.find(o => o && (
              String(o.value || '').trim().toLowerCase() === targetText ||
              String(o.text || '').trim().toLowerCase() === targetText ||
              String(o.text || '').trim().toLowerCase().includes(targetText)
            ));
            if (!chosenOpt) {
              selectEl.value = textParts[sIdx] || textParts[0] || textAnswer;
              dispatchInputEvents(selectEl);
              filled = true;
              return;
            }
          }
        }

        if (chosenOpt) {
          opts.forEach(o => {
            if (o && o.element) o.element.selected = false;
          });
          if (chosenOpt.element) {
            chosenOpt.element.selected = true;
          }
          chosenOpt.selected = true;
          selectEl.value = chosenOpt.value !== undefined ? chosenOpt.value : chosenOpt.text;
          dispatchInputEvents(selectEl);
          filled = true;
        }
      });

      return filled;
    }

    if (qType === 'fill_blank' || qType === 'text' || question.inputElement || (Array.isArray(question.blanks) && question.blanks.length > 0)) {
      const blanks = Array.isArray(question.blanks) && question.blanks.length > 0
        ? question.blanks.map(b => b && b.element).filter(Boolean)
        : (Array.isArray(question.inputElements) && question.inputElements.length > 0
          ? question.inputElements
          : (question.inputElement ? [question.inputElement] : []));

      if (blanks.length === 0 || !textAnswer) return false;

      const parts = blanks.length > 1 && /[|;,]/.test(textAnswer)
        ? textAnswer.split(/\s*[|;,]\s*/)
        : [textAnswer];

      blanks.forEach((inputEl, idx) => {
        const val = parts[idx] !== undefined ? parts[idx] : (parts[0] || textAnswer);
        if (inputEl.isContentEditable) {
          inputEl.textContent = val;
          inputEl.innerText = val;
        } else {
          inputEl.value = val;
        }
        dispatchInputEvents(inputEl);
      });
      return true;
    }

    return false;
  }

  const SUBMIT_POSITIVE_RE = /^(submit|valider|envoyer|check|v[eé]rifier|finish|terminer|soumettre|confirmer)\b/i;
  const SUBMIT_DESTRUCTIVE_RE = /\b(cancel|annuler|reset|r[eé]initialiser|delete|supprimer|remove|logout|d[eé]connexion|sign\s*out|back|retour|pr[eé]c[eé]dent|exit|quitter|abort|clear|effacer)\b/i;

  function isSafeSubmitControl(el) {
    if (!el || typeof el !== 'object') return false;
    if (el.disabled === true) return false;
    const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
    if (tag === 'A' && (el.href || (typeof el.getAttribute === 'function' && el.getAttribute('href')))) {
      return false;
    }

    const typeAttr = (typeof el.getAttribute === 'function' ? el.getAttribute('type') : null) || el.type || '';
    const lowerType = String(typeAttr).toLowerCase();
    if (lowerType === 'reset') return false;

    const label = [
      el.textContent || '',
      el.innerText || '',
      el.value || '',
      (typeof el.getAttribute === 'function' && el.getAttribute('aria-label')) || el.ariaLabel || '',
      el.title || '',
      el.name || '',
      el.id || ''
    ].join(' ').replace(/\s+/g, ' ').trim();

    if (SUBMIT_DESTRUCTIVE_RE.test(label)) {
      return false;
    }

    if ((tag === 'BUTTON' || tag === 'INPUT') && lowerType === 'submit') {
      return true;
    }

    const primaryLabel = (
      (el.textContent || el.innerText || el.value || (typeof el.getAttribute === 'function' && el.getAttribute('aria-label')) || '')
    ).replace(/\s+/g, ' ').trim();

    return SUBMIT_POSITIVE_RE.test(primaryLabel);
  }

  function findQuizSubmitButton(root = null, questions = []) {
    const extractor = (rootWin.SafeExm && rootWin.SafeExm.DOMExtractor) ||
      (typeof DOMExtractor !== 'undefined' ? DOMExtractor : null);

    const searchScopes = [];
    if (root) searchScopes.push(root);
    if (Array.isArray(questions)) {
      for (const q of questions) {
        if (q && q.element) {
          if (typeof q.element.closest === 'function') {
            try {
              const formOrContainer = q.element.closest('form, .quiz, .quiz-container, .assessment, .test-container');
              if (formOrContainer && !searchScopes.includes(formOrContainer)) {
                searchScopes.push(formOrContainer);
              }
            } catch (e) { /* ignore */ }
          }
          if (q.element.parentElement && !searchScopes.includes(q.element.parentElement)) {
            searchScopes.push(q.element.parentElement);
          }
        }
      }
    }
    if (typeof document !== 'undefined' && document && !searchScopes.includes(document)) {
      searchScopes.push(document);
    }

    const candidateSelector = 'button[type="submit"], input[type="submit"], button, [role="button"]';

    for (const scope of searchScopes) {
      if (!scope) continue;
      let candidates = [];
      if (extractor && typeof extractor.querySelectorAllDeep === 'function') {
        candidates = extractor.querySelectorAllDeep(candidateSelector, scope);
      } else if (typeof scope.querySelectorAll === 'function') {
        candidates = Array.from(scope.querySelectorAll(candidateSelector));
      }

      for (const candidate of candidates) {
        if (extractor && typeof extractor.isElementVisible === 'function' && !extractor.isElementVisible(candidate)) {
          continue;
        }
        if (isSafeSubmitControl(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  function executeAutoSubmit(questions, answers, root = null) {
    const answersByIndex = new Map();
    if (Array.isArray(answers)) {
      answers.forEach((ans, idx) => {
        if (ans && typeof ans === 'object') {
          const qIdx = typeof ans.questionIndex === 'number' ? ans.questionIndex : idx;
          answersByIndex.set(qIdx, ans);
        }
      });
    }

    let filledCount = 0;
    if (Array.isArray(questions)) {
      questions.forEach((q, qIdx) => {
        const ans = answersByIndex.get(qIdx) || (Array.isArray(answers) ? answers[qIdx] : null);
        if (q && ans && fillQuestionAnswer(q, ans)) {
          filledCount++;
        }
      });
    }

    const submitBtn = findQuizSubmitButton(root, questions);
    let submitted = false;
    if (submitBtn && typeof submitBtn.click === 'function') {
      submitBtn.click();
      submitted = true;
      console.log(`✅ Auto-Submit exécuté : ${filledCount} question(s) remplie(s), bouton soumis.`);
    } else {
      console.log(`ℹ️ Auto-Submit : ${filledCount} question(s) remplie(s), aucun bouton de soumission trouvé.`);
    }

    return {
      filledCount,
      submitted,
      submitButton: submitBtn
    };
  }

  function scheduleAutoSubmit(questions, answers, settings, root = null) {
    cancelPendingAutoSubmit();

    const check = canAutoSubmitBatch(questions, answers, settings);
    if (!check.allowed) {
      return {
        scheduled: false,
        reason: check.reason,
        questionIndex: check.questionIndex,
        confidence: check.confidence,
        minConfidence: check.minConfidence,
        promise: Promise.resolve({ scheduled: false, executed: false, reason: check.reason })
      };
    }

    const delayMs = computeAutoSubmitDelay(settings.autoSubmitDelayMs);
    console.log(`⏱️ Auto-Submit programmé dans ${delayMs}ms (seuil=${check.minConfidence}%)...`);

    const promise = new Promise((resolve) => {
      _pendingAutoSubmitResolve = resolve;
      _pendingAutoSubmitTimer = setTimeout(() => {
        _pendingAutoSubmitTimer = null;
        const finish = _pendingAutoSubmitResolve;
        _pendingAutoSubmitResolve = null;

        if (!isExtensionEnabled()) {
          if (finish) finish({ scheduled: true, executed: false, aborted: true });
          return;
        }

        const result = executeAutoSubmit(questions, answers, root);
        if (finish) {
          finish({
            scheduled: true,
            executed: true,
            aborted: false,
            delayMs,
            ...result
          });
        }
      }, delayMs);
    });

    return {
      scheduled: true,
      delayMs,
      timerId: _pendingAutoSubmitTimer,
      promise
    };
  }

  // ──────────────────────────────────────────────
  // QUIZ ANALYSIS — Délégation au Background Agent (F-INT-01)
  // ──────────────────────────────────────────────

  async function loadEffectiveSettings(inputSettings) {
    let syncConfig = {};
    try {
      if (typeof ConfigCache !== 'undefined' && ConfigCache) {
        if (typeof ConfigCache.isInitialized === 'function' && !ConfigCache.isInitialized() && typeof ConfigCache.init === 'function') {
          await ConfigCache.init();
        }
        if (typeof ConfigCache.getAll === 'function') {
          syncConfig = ConfigCache.getAll() || {};
        }
      }
    } catch (e) { /* ignore */ }

    let localExtra = {};
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
        const res = await Promise.resolve(chrome.storage.local.get(EXTRA_LOCAL_BEHAVIOR_KEYS));
        if (res && typeof res === 'object') {
          localExtra = res;
        }
      }
    } catch (e) { /* ignore */ }

    const effective = {
      ...localExtra,
      ...syncConfig,
      ...(inputSettings && typeof inputSettings === 'object' ? inputSettings : {})
    };
    return { syncConfig: { ...localExtra, ...syncConfig }, effective };
  }

  async function handleAnalyzeQuiz(settings, forceFallback = false, isAuto = false) {
    if (!settings || typeof settings !== 'object') {
      throw new Error('Argument settings invalide dans handleAnalyzeQuiz.');
    }

    const { syncConfig, effective: effectiveSettings } = await loadEffectiveSettings(settings);
    const safeSummary = buildSafeSettingsSummary(effectiveSettings);
    console.log('⚙️ Settings:', safeSummary, 'Force Fallback:', Boolean(forceFallback));

    if (effectiveSettings.passiveNetworkIntercept === true) {
      await syncPassiveNetworkInterceptor(true).catch(() => {});
    } else if (_passiveBridgeEnabled) {
      await syncPassiveNetworkInterceptor(false).catch(() => {});
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
      Promise.resolve(chrome.runtime.sendMessage({ action: 'analysisProgress', step: 'Lecture du quiz…', percent: 10 })).catch(() => {});
    }

    if (!rootWin.SafeExm.DOMExtractor || !rootWin.SafeExm.HighlightManager) {
      throw new Error('Les modules SafeExm ne sont pas tous disponibles.');
    }

    // ─── Extraction DOM (reste dans le content script) ───
    let quizData = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 2;

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      quizData = await rootWin.SafeExm.DOMExtractor.extractQuizData();
      console.log(`📝 [Essai ${attempts}] Questions extraites: ${quizData && Array.isArray(quizData.questions) ? quizData.questions.length : 0}`);

      if (quizData && Array.isArray(quizData.questions) && quizData.questions.length > 0) {
        break;
      }

      console.log('ℹ️ Aucune question trouvée. Tentative de découverte automatique du schéma...');
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        Promise.resolve(chrome.runtime.sendMessage({ action: 'analysisProgress', step: 'Repérage de la page…', percent: 12 })).catch(() => {});
      }
      if (forceFallback || (typeof SchemaDetector !== 'undefined' && SchemaDetector && SchemaDetector.hasInteractiveContent())) {
        try {
          const newSchema = await SchemaDetector.discoverSchema(true);
          if (newSchema) {
            if (typeof SchemaCache !== 'undefined' && SchemaCache) {
              const hostname = (typeof window !== 'undefined' && window.location) ? window.location.hostname : '';
              await SchemaCache.saveSchema(hostname, newSchema);
            }
            console.log('🔄 Schéma découvert ! La boucle va relancer l\'extraction...');
            continue;
          }
        } catch (e) {
          console.error('❌ Échec de la découverte automatique du schéma:', e);
        }
      }
      break;
    }

    if (quizData && Array.isArray(quizData.questions) && quizData.questions.length > 0 && isAuto) {
      const newQuestions = filterAndReindexDeltaQuestions(quizData.questions, _analyzedQuestionTexts);
      if (newQuestions.length === 0) {
        console.log('⚡ Auto Mode: Aucune nouvelle question à analyser (Delta vide).');
        return { success: true, data: { questionsFound: 0 } };
      }
      quizData.questions = newQuestions;
    }

    if (!quizData || !Array.isArray(quizData.questions) || quizData.questions.length === 0) {
      return { success: false, error: 'Aucune question trouvée sur cette page, même après analyse approfondie.' };
    }

    // Extraire les clés API du config mergé (ConfigCache fusionne sync + local)
    const apiKeys = {
      groqApiKey: syncConfig.groqApiKey || '',
      geminiApiKey: syncConfig.geminiApiKey || '',
      nvidiaApiKey: syncConfig.nvidiaApiKey || '',
      mistralApiKey: syncConfig.mistralApiKey || '',
      claudeApiKey: syncConfig.claudeApiKey || '',
      serpApiKey: syncConfig.serpApiKey || ''
    };

    try {
      // ─── Construire la tâche pour le Background Agent ───
      const task = {
        questions: quizData.questions,
        config: {
          syncConfig,
          apiKeys,
          settings: {
            selectedProvider: effectiveSettings.selectedProvider || null,
            thinkingMode: effectiveSettings.thinkingMode || false,
            thinkingDepth: effectiveSettings.thinkingDepth || 10000,
            forceFallback: forceFallback,
            domainPreset: effectiveSettings.domainPreset || 'auto',
            customDomainRules: effectiveSettings.customDomainRules || '',
            crossValidationEnabled: Boolean(effectiveSettings.crossValidationEnabled),
            crossValidationThreshold: Number(effectiveSettings.crossValidationThreshold) || 70
          }
        },
        tabId: null
      };

      console.log(`🤖 Délégation au BackgroundAgent: ${quizData.questions.length} questions`);
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        Promise.resolve(chrome.runtime.sendMessage({ action: 'analysisProgress', step: 'Analyse en cours…', percent: 15 })).catch(() => {});
      }

      // ─── Appel asynchrone au Background Agent via port persistant ───
      const agentResult = await new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: 'solveQuiz' });
        let resolved = false;

        port.onMessage.addListener((response) => {
          resolved = true;
          port.disconnect();
          if (!response) {
            return reject(new Error('Pas de réponse du BackgroundAgent'));
          }
          resolve(response);
        });

        port.onDisconnect.addListener(() => {
          if (!resolved) {
            const err = chrome.runtime.lastError;
            reject(new Error(err ? err.message : 'Port déconnecté avant réponse'));
          }
        });

        port.postMessage({ action: 'solveQuiz', task });
      });

      if (!agentResult.success) {
        console.error('❌ BackgroundAgent a échoué:', agentResult.error);
        if (agentResult.journal && agentResult.journal.length > 0) {
          console.group('📋 Journal de l\'agent:');
          for (const entry of agentResult.journal) {
            console.log(`  [${entry.type}] ${entry.message}`);
          }
          console.groupEnd();
        }
        return { success: false, error: agentResult.error || 'L\'agent de résolution a échoué.' };
      }

      // ─── Application des résultats (reste dans le content script) ───
      const allParsedAnswers = agentResult.answers || [];
      const meta = agentResult.metadata || {};

      console.log(`🔗 Agent terminé: ${meta.answersFound}/${meta.questionsTotal} réponses, provider=${meta.provider}, durée=${meta.totalDurationMs}ms`);
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        Promise.resolve(chrome.runtime.sendMessage({ action: 'analysisProgress', step: 'Marquage des réponses…', percent: 90 })).catch(() => {});
      }

      // Call HighlightManager API (preserve existing connected highlights in Auto Mode Delta)
      await rootWin.SafeExm.HighlightManager.applyHighlights(quizData.questions, allParsedAnswers, {
        stealthLevel: effectiveSettings.stealthLevel || effectiveSettings.highlightDiscretion,
        append: Boolean(isAuto)
      });

      // Stocker les questions analysées pour le mode Auto (Delta)
      for (const q of quizData.questions) {
        if (q && typeof q.text === 'string') {
          _analyzedQuestionTexts.add(q.text.trim());
        }
      }

      // Stocker les réponses texte pour le menu contextuel
      const isConnectedFn = rootWin.SafeExm.HighlightManager && rootWin.SafeExm.HighlightManager.isElementConnected;
      pendingTextAnswers = isAuto
        ? pendingTextAnswers.filter(item => item && (!item.element || (typeof isConnectedFn === 'function' ? isConnectedFn(item.element) : true)))
        : [];
      for (const ans of allParsedAnswers) {
        const text = ans.textAnswer || ans.raw;
        if (text && text.trim().length > 0) {
          const q = quizData.questions[ans.questionIndex];
          const el = q ? (q.inputElement || null) : null;
          if (!el || !pendingTextAnswers.some(p => p.element === el)) {
            pendingTextAnswers.push({
              questionIndex: ans.questionIndex,
              answer: text,
              element: el
            });
          }
        }
      }
      console.log(`📋 ${pendingTextAnswers.length} réponse(s) texte en attente pour le collage via menu contextuel.`);

      // F-AUTO-03 : Opt-In Auto-Submit Intelligence
      const autoSubmitSchedule = scheduleAutoSubmit(quizData.questions, allParsedAnswers, effectiveSettings);

      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        Promise.resolve(chrome.runtime.sendMessage({ action: 'analysisProgress', step: 'Terminé.', percent: 100 })).catch(() => {});
      }

      return {
        success: true,
        data: {
          questionsFound: meta.questionsTotal ?? quizData.questions.length,
          answersHighlighted: meta.answersFound ?? allParsedAnswers.length,
          provider: meta.provider,
          model: meta.model,
          imagesCount: quizData.totalImages,
          chunksProcessed: meta.chunksProcessed,
          searchQueriesRun: meta.searchQueriesRun,
          retriesUsed: meta.retriesUsed,
          totalDurationMs: meta.totalDurationMs,
          autoSubmitScheduled: autoSubmitSchedule.scheduled
        }
      };
    } catch (error) {
      console.error('❌ Erreur globale d\'analyse:', error);
      return { success: false, error: error.message };
    }
  }

  // ──────────────────────────────────────────────
  // SCHEMA DISCOVERY HANDLERS
  // ──────────────────────────────────────────────

  async function handleDiscoverSchema() {
    if (typeof SchemaDetector === 'undefined') {
      throw new Error('SchemaDetector non disponible.');
    }
    const schema = await SchemaDetector.discoverSchema(true);
    if (!schema) {
      return { success: false, error: 'Impossible de générer un schéma valide pour ce domaine.' };
    }

    const hostname = (typeof window !== 'undefined' && window.location) ? window.location.hostname : '';
    if (typeof SchemaCache !== 'undefined') {
      await SchemaCache.saveSchema(hostname, schema);
    }
    return { success: true, schema, data: schema };
  }

  async function handleGetSchemaStatus() {
    const hostname = (typeof window !== 'undefined' && window.location) ? window.location.hostname : '';
    let cached = null;
    if (typeof SchemaCache !== 'undefined') {
      cached = await SchemaCache.getCachedSchema(hostname);
    }
    let hasInteractive = false;
    try {
      if (typeof SchemaDetector !== 'undefined' && SchemaDetector && typeof SchemaDetector.hasInteractiveContent === 'function') {
        hasInteractive = Boolean(SchemaDetector.hasInteractiveContent());
      }
    } catch (e) { /* ignore */ }
    const payload = {
      hasSchema: !!cached,
      platform: cached ? cached.platform : null,
      hostname,
      hasInteractive
    };
    return {
      success: true,
      ...payload,
      data: payload
    };
  }

  function handlePasteAnswer() {
    if (pendingTextAnswers.length === 0) return;

    console.log('📋 Injection du texte de réponse par clic droit / raccourci...');
    pendingTextAnswers.forEach(item => {
      const activeEl = item.element || (typeof document !== 'undefined' && document ? document.activeElement : null);
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
          activeEl.value = item.answer;
        } else {
          activeEl.innerText = item.answer;
        }
        dispatchInputEvents(activeEl);
      }
    });
  }

  // Export Content API
  const ContentAPI = {
    handleAnalyzeQuiz,
    handleDiscoverSchema,
    handleGetSchemaStatus,
    syncPassiveNetworkInterceptor,
    isPassiveNetworkInterceptorEnabled: () => _passiveBridgeEnabled,
    isQuizPage,
    buildSafeSettingsSummary,
    filterAndReindexDeltaQuestions,
    triggerPreWarmProviders,
    resetPreWarmState,
    scheduleAutoSubmit,
    cancelPendingAutoSubmit,
    executeAutoSubmit,
    canAutoSubmitBatch,
    computeAutoSubmitDelay,
    findQuizSubmitButton,
    fillQuestionAnswer,
    getAnalyzedQuestionTexts: () => _analyzedQuestionTexts,
    clearAnalyzedQuestionTexts: () => _analyzedQuestionTexts.clear(),
    setEnabled: (val) => {
      isEnabled = Boolean(val);
      if (!isEnabled) {
        cancelPendingAutoSubmit();
        syncPassiveNetworkInterceptor(false).catch(() => {});
      }
    },
    getEnabled: () => isExtensionEnabled()
  };

  rootWin.SafeExm.Content = ContentAPI;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ContentAPI;
  }
})();
