// ============================================================
// background-agent.js — Autonomous Tool-Calling Agent (F-INT-01-V2 Unified)
// Architecture : ReAct loop + Multi-Provider Tool Calling Adapters + Robust Fallbacks
// Ce fichier est chargé dans le service worker via importScripts.
// ============================================================
/* global ConfigCache, QuizProviders, handleFetchSerpApi, BackgroundAgent, chrome */

(typeof self !== 'undefined' ? self : window).BackgroundAgent = (() => {
  'use strict';

  // ─── Constantes de Gouvernance ───
  const MAX_TURNS = 5;
  const SEARCH_TIMEOUT_MS = 15000;
  const MAX_TOTAL_TIMEOUT_MS = 180000;

  // ─── Cache System Prompt ───
  let _cachedSystemPrompt = null;

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
      ? settings.selectedProvider
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

    const initialPrompts = await _buildPrompt(quizData, baseContextText, contextFiles, settings);

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
      const answeredIndices = new Set(parsedAnswers.map(ans => ans.questionIndex));
      const missingCount = task.questions.filter(q => !answeredIndices.has(q.index - 1)).length;
      if (missingCount > 0) {
        _log(journal, 'fast_path_escalate', `Fast Path incomplet (${missingCount} manquantes). Escalade vers l'Agent Path.`);
        return null;
      }

      // Filet de sécurité 2: Confiance moyenne > 20%
      const totalConfidence = parsedAnswers.reduce((sum, ans) => sum + (ans.confidence || 50), 0);
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

      // ─── Routage adaptatif (Fast Path vs Agent Path) ───
      const complexityScore = _computeComplexityScore(task);
      _log(journal, 'routing_eval', `Score de complexité calculé: ${complexityScore} (Seuil Fast <= 3)`);

      if (complexityScore <= 3) {
        _reportProgress(task.tabId, 'Résolution rapide (Fast Path)...', 18);
        const fastResult = await _solveFastPath(task, journal, globalAbort.signal);
        if (fastResult) {
          clearTimeout(globalTimer);
          return fastResult;
        }
        _log(journal, 'routing_fallback', 'Fast Path rejeté ou échoué. Basculement vers l\'Agent Path.');
      }

      _log(journal, 'routing_agent', 'Démarrage de l\'Agent Path complet (ReAct loop)...');

      // ─── Phase 1 : Planning ───
      const plan = await _planStrategy(task, journal, globalAbort.signal);
      _reportProgress(task.tabId, `Planification de la résolution...`, 20);

      // Contexte de base : baseContextText
      const baseContextText = plan.baseContextText;
      const contextFiles = plan.contextFiles;

      let allParsedAnswers = [];
      let searchQueriesRun = 0;
      let providerKey = plan.providerKey;
      let lastUsedModel = '';
      const syncConfig = task.config.syncConfig || {};

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
        const otherConfigured = _getAllConfiguredProviders(task.config, syncConfig.providerOrder);
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
              task,
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
        task,
        { answers: cleanedAnswers, provider: providerKey, model: lastUsedModel, chunksProcessed: plan.chunks.length },
        baseContextText,
        plan,
        journal,
        globalAbort.signal
      );

      _reportProgress(task.tabId, 'Résolution terminée', 95);

      const result = {
        success: true,
        answers: validated.answers,
        metadata: {
          provider: providerKey,
          model: validated.model || '',
          questionsTotal: task.questions.length,
          answersFound: validated.answers.length,
          searchQueriesRun: searchQueriesRun,
          chunksProcessed: plan.chunks.length,
          retriesUsed: validated.retriesUsed,
          totalDurationMs: Date.now() - startTime
        },
        journal
      };

      _log(journal, 'agent_end', `Terminé: ${validated.answers.length}/${task.questions.length} réponses en ${result.metadata.totalDurationMs}ms`);
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
    const priority = order || syncConfig.providerOrder || QuizProviders.DEFAULT_PRIORITY;
    const configured = [];
    for (const pKey of priority) {
      const provider = QuizProviders.PROVIDERS[pKey];
      if (provider && mergedConfig[provider.apiKeyField] && mergedConfig[provider.apiKeyField].trim().length > 0) {
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
    const syncConfig = config.syncConfig;

    const settings = config.settings || {};
    const apiKeys = config.apiKeys || {};

    let providerKey = settings.selectedProvider && settings.selectedProvider !== 'auto'
      ? settings.selectedProvider
      : null;

    // Si un provider spécifique est sélectionné, on vérifie s'il dispose d'une clé API valide
    if (providerKey) {
      const provider = QuizProviders.PROVIDERS[providerKey];
      const apiKey = provider ? apiKeys[provider.apiKeyField] : null;
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

    const initialPrompts = await _buildPrompt(chunkQuizData, baseContextText, contextFiles, config.settings || {});

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
    if (providerKey === 'gemini') {
      return {
        systemInstruction: systemPrompt,
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
      };
    } else if (providerKey === 'claude') {
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
    if (providerKey === 'gemini') {
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
    } else if (providerKey === 'claude') {
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
    if (providerKey === 'gemini') {
      const parts = toolResults.map(res => ({
        functionResponse: {
          name: res.name,
          response: { result: res.content }
        }
      }));
      history.contents.push({ role: 'user', parts });
      return history;
    } else if (providerKey === 'claude') {
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
    let tokens = 0;
    try {
      if (providerKey === 'gemini') {
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
    const totalTokens = _estimateHistoryTokens(providerKey, history);
    const COMPACTION_THRESHOLD_TOKENS = 150000; // 150K tokens

    if (totalTokens < COMPACTION_THRESHOLD_TOKENS) {
      // Conserver l'intégralité du contexte pour préserver la qualité de recherche SerpAPI
      return history;
    }

    _log(journal, 'reactive_compact_start', `Taille de contexte (${totalTokens} tokens) supérieure au seuil (${COMPACTION_THRESHOLD_TOKENS} tokens). Déclenchement de la compaction réactive.`);

    try {
      if (providerKey === 'gemini') {
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
      } else if (providerKey === 'claude') {
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
    const provider = QuizProviders.PROVIDERS[providerKey];
    if (!provider) {
      throw new Error(`Provider inconnu: ${providerKey}`);
    }
    const apiKey = apiKeys[provider.apiKeyField];
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
        if (providerKey === 'gemini') {
          result = await _callGeminiWithTools(apiKey, candidateModel, history, images, tools, signal);
        } else if (providerKey === 'claude') {
          result = await _callClaudeWithTools(apiKey, candidateModel, history, images, tools, signal);
        } else {
          result = await _callOpenAIWithTools(providerKey, apiKey, candidateModel, history, images, tools, signal);
        }
        return { ...result, model: candidateModel };
      } catch (err) {
        console.error(`❌ Échec du modèle ${candidateModel} sur ${providerKey}:`, err.message);
        lastError = err;
        if (signal && signal.aborted) {
          throw err;
        }
      }
    }
    throw lastError || new Error(`Tous les modèles ont échoué pour le provider ${providerKey}`);
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
        const isLegacyNvidiaVision = providerKey === 'nvidia' && (lowerModel.includes('phi-') || lowerModel.includes('neva'));
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
    if (providerKey === 'mistral' && model.toLowerCase().includes('codestral')) {
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
      const idx = item.questionIndex;
      const question = questions.find(q => (q.index - 1) === idx);
      if (!question) continue;

      const userAns = Array.isArray(item.answers) ? item.answers : [item.answers];
      const explanation = item.explanation || '';
      const confidence = typeof item.confidence === 'number' ? Math.max(0, Math.min(100, item.confidence)) : 90;

      if (question.type === 'text') {
        parsed.push({
          questionIndex: idx,
          raw: JSON.stringify(item),
          optionIndices: [],
          textAnswer: userAns[0] || '',
          confidence,
          explanation
        });
      } else if (question.options && question.options.length > 0) {
        const optionIndices = [];

        for (const val of userAns) {
          const numeric = parseInt(val);
          if (!isNaN(numeric) && numeric >= 0 && numeric < question.options.length) {
            optionIndices.push(numeric);
            continue;
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

        parsed.push({
          questionIndex: idx,
          raw: JSON.stringify(item),
          optionIndices: optionIndices,
          textAnswer: optionIndices.length === 0 ? (userAns[0] || '') : null,
          confidence,
          explanation
        });
      }
    }
    return parsed;
  }

  // ────────────────────────────────────────────────
  // SINGLE SEARCH WRAPPER
  // ────────────────────────────────────────────────

  async function _executeSingleSearch(queryText, apiKey, parentSignal) {
    if (parentSignal.aborted) {
      return null;
    }

    try {
      const result = await Promise.race([
        handleFetchSerpApi(queryText, apiKey),
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('Search timeout')), SEARCH_TIMEOUT_MS);
          parentSignal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Search aborted'));
          }, { once: true });
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
    }
  }

  // ────────────────────────────────────────────────
  // RALPH LOOP (Validation & Retry)
  // ────────────────────────────────────────────────

  async function _validateAndRetry(task, llmResult, baseContextText, plan, journal, signal) {
    let { answers, provider, model, chunksProcessed } = llmResult;
    const MAX_RETRIES = 2;
    let retriesUsed = 0;

    const answeredIndices = new Set(answers.map(ans => ans.questionIndex));
    let missingQuestions = task.questions.filter(q => !answeredIndices.has(q.index - 1));

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
            const initialPrompts = await _buildPrompt(retryQuizData, baseContextText, plan.contextFiles, { isRetry: true });
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
        missingQuestions = task.questions.filter(q => !newAnsweredIndices.has(q.index - 1));
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

    // NIVEAU 1: XML
    const xmlMatch = response.match(/<quiz_answers>([\s\S]*?)<\/quiz_answers>/i);
    if (xmlMatch) {
      const xmlContent = xmlMatch[1];
      const answerRegex = /<answer\s+question_id="(\d+)"\s+type="([^"]+)">([\s\S]*?)<\/answer>/gi;
      let match;

      while ((match = answerRegex.exec(xmlContent)) !== null) {
        const id = parseInt(match[1]);
        const type = match[2];
        const inner = match[3];
        const questionNum = id - 1;
        const question = questions[questionNum];
        if (!question) { continue; }

        const globalIdx = question.index - 1;

        // Extraction de confidence et explanation
        let confidence = 50;
        const confidenceMatch = inner.match(/<confidence>\s*(\d+)\s*<\/confidence>/i);
        if (confidenceMatch) {
          const val = parseInt(confidenceMatch[1]);
          if (!isNaN(val)) {
            confidence = Math.max(0, Math.min(100, val));
          }
        }

        let explanation = '';
        const explanationMatch = inner.match(/<explanation>([\s\S]*?)<\/explanation>/i);
        if (explanationMatch) {
          explanation = explanationMatch[1].trim();
        }

        if (type === 'radio') {
          const optIdxMatch = inner.match(/<option_index>\s*(\d+)\s*<\/option_index>/i);
          if (optIdxMatch) {
            const optIdx = parseInt(optIdxMatch[1]) - 1;
            answers[globalIdx] = {
              questionIndex: globalIdx,
              raw: optIdxMatch[0],
              optionIndices: [optIdx],
              textAnswer: null,
              confidence,
              explanation
            };
          }
        } else if (type === 'checkbox') {
          const optIndicesMatch = inner.match(/<option_indices>\s*([\d,\s]+)\s*<\/option_indices>/i);
          if (optIndicesMatch) {
            const indices = optIndicesMatch[1].split(',')
              .map(n => parseInt(n.trim()) - 1)
              .filter(n => !isNaN(n));
            answers[globalIdx] = {
              questionIndex: globalIdx,
              raw: optIndicesMatch[0],
              optionIndices: indices,
              textAnswer: null,
              confidence,
              explanation
            };
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
    const missingIndices = questions.map((_, idx) => idx).filter(idx => !answers[questions[idx].index - 1]);
    if (missingIndices.length > 0) {
      const lines = response.split('\n');
      for (const line of lines) {
        const lineMatch = line.match(/^\s*[-*+]?\s*(?:Q|Question)?\s*(\d+)\s*[.:)-]\s*(.+)$/i);
        if (!lineMatch) { continue; }

        const questionNum = parseInt(lineMatch[1]) - 1;
        const rawAnswer = lineMatch[2].trim();
        const question = questions[questionNum];
        if (!question) { continue; }

        const globalIdx = question.index - 1;
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
          let optionIndices = numbers ? numbers.map(n => parseInt(n) - 1) : [];

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
    const finalMissing = questions.map((_, idx) => idx).filter(idx => !answers[questions[idx].index - 1]);
    if (finalMissing.length > 0) {
      for (const idx of finalMissing) {
        const question = questions[idx];
        const globalIdx = question.index - 1;

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

    return answers.filter(ans => ans !== undefined);
  }

  function _log(journal, type, message) {
    const entry = { ts: Date.now(), type, message };
    journal.push(entry);
    console.log(`🤖 [Agent/${type}] ${message}`);
  }

  function _reportProgress(tabId, step, percent) {
    chrome.runtime.sendMessage({
      action: 'analysisProgress',
      step,
      percent
    }).catch(() => {});
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

  return { solve, learnFromFeedback };
})();
