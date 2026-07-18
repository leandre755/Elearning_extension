// content.js - Safe Exm Orchestrator & Parser (part of CRIT-01 and CRIT-03 refactoring)
/* global ConfigCache, SchemaDetector, SchemaCache */
(async function () {
  'use strict';

  // Prevent multiple executions of the core script
  if (window.__quizHelperLoaded) {
    return;
  }
  window.__quizHelperLoaded = true;

  // Initialize namespace
  window.SafeExm = window.SafeExm || {};

  let isEnabled = false;
  let pendingTextAnswers = [];

  // Auto Mode Tracking
  let _lastAutoContentHash = '';
  let _autoAnalysisRunning = false;

  // Auto Mode Observer (déclaré ici pour éviter la TDZ lors du bootstrap)
  let _autoModeObserver = null;
  let _autoModeDebounceTimer = null;

  // Initialisation de la configuration au chargement
  try {
    if (!ConfigCache.isInitialized()) {
      await ConfigCache.init();
    }
    isEnabled = ConfigCache.get('enabled') === true;
    
    // Auto Mode Bootstrapping
    if (ConfigCache.get('autoMode') === true) {
      setupAutoModeObserver();
    }
  } catch (e) {
    console.warn('⚠️ Erreur initialisation ConfigCache:', e.message);
  }

  // Setup message listener
  setupMessageListener();

  console.log('🚀 Safe Exm - Cœur d\'orchestration chargé avec succès !');

  // ──────────────────────────────────────────────
  // AUTO MODE OBSERVER (SPA/Pagination detection)
  // ──────────────────────────────────────────────
  // Tracking des questions déjà analysées pour le delta
  let _analyzedQuestionTexts = new Set();
  // Feedback tracking
  let _feedbackSent = false;

  function setupAutoModeObserver() {
    if (_autoModeObserver) return;

    _autoModeObserver = new MutationObserver(() => {
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

  // Listen to configuration change to toggle Auto Mode
  ConfigCache.onChange((changes) => {
    if (changes.autoMode) {
      if (changes.autoMode.newValue === true) {
        setupAutoModeObserver();
      } else {
        clearAutoModeObserver();
      }
    }
    if (changes.enabled) {
      isEnabled = changes.enabled.newValue === true;
      if (!isEnabled && window.SafeExm.HighlightManager) {
        window.SafeExm.HighlightManager.clearAllHighlights();
      }
    }
  });

  function triggerAutoAnalysis(reason) {
    if (!isEnabled || _autoAnalysisRunning) return;

    if (_autoModeDebounceTimer) {
      clearTimeout(_autoModeDebounceTimer);
    }

    _autoModeDebounceTimer = setTimeout(async () => {
      try {
        if (!isQuizPage()) return;
        
        // Pilier 5: Détection de feedback
        if (!_feedbackSent && detectAndSendFeedback()) {
          _feedbackSent = true;
          return; // Si on est sur une page de feedback, on arrête l'analyse de quiz.
        }

        const contentHash = (document.body?.textContent || '').substring(0, 500);
        if (contentHash === _lastAutoContentHash && contentHash.length > 50) {
          return;
        }
        _lastAutoContentHash = contentHash;

        console.log(`⚡ Auto Mode: Lancement de l'analyse (raison: ${reason})`);
        _autoAnalysisRunning = true;

        const allSettings = ConfigCache.getAll();
        await handleAnalyzeQuiz(allSettings, true, true); // forceFallback=true, isAuto=true
      } catch (e) {
        // "Extension context invalidated" = l'extension a été rechargée,
        // ce content script est orphelin et ne peut plus communiquer avec le SW.
        // Arrêter proprement l'auto-mode plutôt que de spammer des erreurs.
        if (e.message && e.message.includes('Extension context invalidated')) {
          console.warn('🔄 Auto Mode: Extension rechargée. Rechargez la page pour continuer.');
          isEnabled = false;
          clearAutoModeObserver();
          return;
        }
        console.error('❌ Auto Mode: Erreur:', e.message);
      } finally {
        _autoAnalysisRunning = false;
      }
    }, 3000); // 3s debounce
  }

  function detectAndSendFeedback() {
    // Logique heuristique basique pour détecter une page de résultat
    const bodyText = document.body.innerText.toLowerCase();
    const hasScore = bodyText.includes('score') || bodyText.includes('résultat') || bodyText.includes('result');
    const hasCorrection = bodyText.includes('correct answer') || bodyText.includes('bonne réponse') || document.querySelectorAll('.correct, .incorrect, [data-correct]').length > 0;
    
    if (hasScore && hasCorrection) {
      console.log('🎓 Page de résultat détectée, extraction du feedback...');
      const feedbackData = [];
      const questions = document.querySelectorAll('.question-block, .quiz-question, [class*="question"]'); 
      questions.forEach(q => {
        const text = q.innerText;
        if (text) {
          feedbackData.push({
            questionText: text.substring(0, 150),
            agentAnswer: 'N/A', // Corrélation gérée côté UI
            correctAnswer: 'Voir le DOM',
            isCorrect: text.toLowerCase().includes('correct') && !text.toLowerCase().includes('incorrect')
          });
        }
      });
      
      if (feedbackData.length > 0) {
        chrome.runtime.sendMessage({
          action: 'submitQuizFeedback',
          feedbackData,
          config: ConfigCache.getAll()
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
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('📨 Message reçu:', message);

      if (!window.SafeExm.HighlightManager) {
        console.warn('⚠️ HighlightManager non encore injecté/disponible.');
        sendResponse({ success: false, error: 'HighlightManager non disponible' });
        return;
      }

      switch (message.action) {
        case 'toggleExtension':
          isEnabled = message.enabled;
          if (!isEnabled) {
            window.SafeExm.HighlightManager.clearAllHighlights();
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
          return true; // Async response

        case 'clearHighlights':
          window.SafeExm.HighlightManager.clearAllHighlights();
          sendResponse({ success: true });
          break;

        case 'discoverSchema':
          console.log('🔬 Découverte de schéma manuelle...');
          handleDiscoverSchema()
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true; // Async response

        case 'getSchemaStatus':
          handleGetSchemaStatus()
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true; // Async response

        case 'pasteAnswer':
          handlePasteAnswer();
          sendResponse({ success: true });
          break;
      }
    });
  }

  function isQuizPage() {
    if (!window.SafeExm.DOMExtractor) return false;
    const isQuizUrl = window.location.pathname.includes('quiz') ||
      window.location.href.includes('quiz') ||
      window.location.hostname.includes('quizgecko.com');
    const hasQuizElements = document.querySelector(window.SafeExm.DOMExtractor.QUIZ_SELECTORS.quizContainer.join(','));
    const hasInteractive = typeof SchemaDetector !== 'undefined' && SchemaDetector.hasInteractiveContent();
    return isQuizUrl || hasQuizElements || hasInteractive;
  }

  // ──────────────────────────────────────────────
  // QUIZ ANALYSIS — Délégation au Background Agent (F-INT-01)
  // ──────────────────────────────────────────────

  async function handleAnalyzeQuiz(settings, forceFallback = false, isAuto = false) {
    if (!settings || typeof settings !== 'object') {
      throw new Error('Argument settings invalide dans handleAnalyzeQuiz.');
    }

    console.log('⚙️ Settings:', settings, 'Force Fallback:', forceFallback);
    chrome.runtime.sendMessage({ action: 'analysisProgress', step: 'Analyse et extraction du quiz...', percent: 10 }).catch(() => {});

    if (!window.SafeExm.DOMExtractor || !window.SafeExm.HighlightManager) {
      throw new Error('Les modules SafeExm ne sont pas tous disponibles.');
    }

    // ─── Extraction DOM (reste dans le content script) ───
    let quizData = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 2;

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      quizData = await window.SafeExm.DOMExtractor.extractQuizData();
      console.log(`📝 [Essai ${attempts}] Données quiz extraites:`, quizData);

      if (quizData.questions.length > 0) {
        break;
      }

      console.log('ℹ️ Aucune question trouvée. Tentative de découverte automatique du schéma...');
      chrome.runtime.sendMessage({ action: 'analysisProgress', step: 'Découverte automatique de la structure...', percent: 12 }).catch(() => {});
      if (forceFallback || (typeof SchemaDetector !== 'undefined' && SchemaDetector.hasInteractiveContent())) {
        try {
          const newSchema = await SchemaDetector.discoverSchema(true);
          if (newSchema) {
            if (typeof SchemaCache !== 'undefined') {
              await SchemaCache.saveSchema(window.location.hostname, newSchema);
            }
            console.log('🔄 Schéma découvert ! La boucle va relancer l\'extraction...');
            continue;
          }
        } catch(e) {
          console.error('❌ Échec de la découverte automatique du schéma:', e);
        }
      }
      break;
    }

    if (quizData && quizData.questions.length > 0 && isAuto) {
      const newQuestions = quizData.questions.filter(q => !_analyzedQuestionTexts.has(q.text.trim()));
      if (newQuestions.length === 0) {
        console.log("⚡ Auto Mode: Aucune nouvelle question à analyser (Delta vide).");
        return { success: true, data: { questionsFound: 0 } };
      }
      quizData.questions = newQuestions;
    }

    if (!quizData || quizData.questions.length === 0) {
      return { success: false, error: 'Aucune question trouvée sur cette page, même après analyse approfondie.' };
    }

    // ─── Charger la configuration pour la transmettre à l'agent ───
    if (!ConfigCache.isInitialized()) {
      await ConfigCache.init();
    }
    const syncConfig = ConfigCache.getAll();

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
            selectedProvider: settings.selectedProvider || null,
            thinkingMode: settings.thinkingMode || false,
            thinkingDepth: settings.thinkingDepth || 10000,
            forceFallback: forceFallback
          }
        },
        tabId: null // Le tabId sera résolu côté SW si nécessaire
      };

      console.log(`🤖 Délégation au BackgroundAgent: ${quizData.questions.length} questions`);
      chrome.runtime.sendMessage({ action: 'analysisProgress', step: 'Agent de résolution activé...', percent: 15 }).catch(() => {});

      // ─── Appel asynchrone au Background Agent via port persistant ───
      // Un port persistant empêche Chrome de tuer le Service Worker pendant l'opération.
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
        // Afficher le journal pour le debug
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
      chrome.runtime.sendMessage({ action: 'analysisProgress', step: 'Application du surlignage...', percent: 90 }).catch(() => {});

      // Call HighlightManager API
      window.SafeExm.HighlightManager.applyHighlights(quizData.questions, allParsedAnswers);

      // Stocker les questions analysées pour le mode Auto (Delta)
      for (const q of quizData.questions) {
        _analyzedQuestionTexts.add(q.text.trim());
      }

      // Stocker les réponses texte pour le menu contextuel
      pendingTextAnswers = [];
      for (const ans of allParsedAnswers) {
        const text = ans.textAnswer || ans.raw;
        if (text && text.trim().length > 0) {
          const q = quizData.questions[ans.questionIndex];
          pendingTextAnswers.push({
            questionIndex: ans.questionIndex,
            answer: text,
            element: q ? (q.inputElement || null) : null
          });
        }
      }
      console.log(`📋 ${pendingTextAnswers.length} réponse(s) texte en attente pour le collage via menu contextuel.`);

      chrome.runtime.sendMessage({ action: 'analysisProgress', step: 'Analyse terminée avec succès !', percent: 100 }).catch(() => {});

      return {
        success: true,
        data: {
          questionsFound: meta.questionsTotal,
          answersHighlighted: meta.answersFound,
          provider: meta.provider,
          model: meta.model,
          imagesCount: quizData.totalImages,
          chunksProcessed: meta.chunksProcessed,
          searchQueriesRun: meta.searchQueriesRun,
          retriesUsed: meta.retriesUsed,
          totalDurationMs: meta.totalDurationMs
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

    const hostname = window.location.hostname;
    if (typeof SchemaCache !== 'undefined') {
      await SchemaCache.saveSchema(hostname, schema);
    }
    return { success: true, schema };
  }

  async function handleGetSchemaStatus() {
    const hostname = window.location.hostname;
    let cached = null;
    if (typeof SchemaCache !== 'undefined') {
      cached = await SchemaCache.getCachedSchema(hostname);
    }
    return {
      hasSchema: !!cached,
      platform: cached ? cached.platform : null,
      hostname
    };
  }

  function handlePasteAnswer() {
    if (pendingTextAnswers.length === 0) return;
    
    console.log('📋 Injection du texte de réponse par clic droit / raccourci...');
    pendingTextAnswers.forEach(item => {
      const activeEl = item.element || document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
          activeEl.value = item.answer;
        } else {
          activeEl.innerText = item.answer;
        }
        activeEl.dispatchEvent(new Event('input', { bubbles: true }));
        activeEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  // Export Content API
  window.SafeExm.Content = {
    handleAnalyzeQuiz,
    isQuizPage
  };
})();