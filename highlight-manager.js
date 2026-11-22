// highlight-manager.js - Safe Exm Highlight Manager (CRIT-01, F-INT-02, F-UX-02)
/* global ConfigCache, WeakMap, WeakSet, Number, Boolean, Array, RegExp, parseInt */
(function () {
  'use strict';

  // Initialize namespace
  const rootWin = typeof window !== 'undefined' ? window : globalThis;
  rootWin.SafeExm = rootWin.SafeExm || {};

  // SEC-03 : WeakMap pour stocker les styles originaux et métadonnées SANS toucher au DOM.
  const _originalStyles = new WeakMap();
  const _badgeMetadata = new WeakMap();
  const _badgeNodes = new Set();

  // SEC-04 : Identifiant de session et classes aléatoires pour la balise <style> injectée.
  const _styleTagId = `_s${Math.random().toString(36).slice(2, 9)}`;
  const _badgeClass = `${_styleTagId}-b`;
  const _floatClass = `${_styleTagId}-f`;
  const _floatDiscreetClass = `${_styleTagId}-fd`;
  const _floatVisibleClass = `${_styleTagId}-fv`;
  const _floatGlowClass = `${_styleTagId}-fg`;

  let highlights = [];
  let floatingButtons = [];
  let _storedHighlightData = null;
  let _intersectionObserver = null;
  let _mutationObserver = null;
  let _isHealing = false;
  let _healGeneration = 0;
  let _renderedQuestions = new WeakSet();
  let _intersectingTargets = new WeakMap();

  /**
   * Vérifie si un élément DOM est connecté au document, y compris à l'intérieur d'un ShadowRoot.
   * Corrige la boucle infinie NEEDS_HEAL sur les quiz en Shadow DOM où document.body.contains(el) vaut false.
   * @param {*} el
   * @returns {boolean}
   */
  function isElementConnected(el) {
    if (!el || typeof el !== 'object') return false;
    if (el.isConnected === true) return true;
    if (typeof el.getRootNode === 'function') {
      try {
        const composedRoot = el.getRootNode({ composed: true });
        if (composedRoot && (
          (typeof document !== 'undefined' && composedRoot === document) ||
          composedRoot.nodeType === 9
        )) {
          return true;
        }
        const localRoot = el.getRootNode();
        if (localRoot && localRoot !== el) {
          if ((typeof document !== 'undefined' && localRoot === document) || localRoot.nodeType === 9) {
            return true;
          }
          if (localRoot.host) {
            return isElementConnected(localRoot.host);
          }
        }
      } catch (e) { /* fallback below */ }
    }
    if (typeof document !== 'undefined' && document && document.body && typeof document.body.contains === 'function') {
      try {
        if (document.body.contains(el)) return true;
      } catch (e) { /* ignore */ }
    }
    let curr = el.parentNode || el.parentElement || el.host || null;
    let steps = 0;
    const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    while (curr && steps < 64) {
      if (seen) {
        if (seen.has(curr)) break;
        seen.add(curr);
      }
      steps++;
      if (typeof document !== 'undefined' && document && (
        curr === document ||
        curr === document.body ||
        curr === document.documentElement
      )) {
        return true;
      }
      if (curr.isConnected === true) return true;
      curr = curr.parentNode || curr.parentElement || curr.host || null;
    }
    return false;
  }

  /**
   * Normalise une valeur de discrétion / niveau de furtivité.
   * @param {*} raw
   * @returns {'ultra-furtif'|'furtif'|'visible'|'glow'|null}
   */
  function normalizeDiscretionLevel(raw) {
    if (raw === 0 || raw === '0' || raw === 1 || raw === '1') return 'ultra-furtif';
    if (raw === 2 || raw === '2') return 'furtif';
    if (raw === 3 || raw === '3') return 'visible';
    if (raw === 4 || raw === '4') return 'glow';
    if (typeof raw === 'string') {
      const lower = raw.trim().toLowerCase();
      if (lower === 'ultra-furtif' || lower === 'ultra-stealth' || lower === 'ultrafurtif' || lower === 'ultrastealth') {
        return 'ultra-furtif';
      }
      if (lower === 'furtif' || lower === 'stealth' || lower === 'discreet') {
        return 'furtif';
      }
      if (lower === 'visible' || lower === 'normal') {
        return 'visible';
      }
      if (lower === 'glow') {
        return 'glow';
      }
    }
    return null;
  }

  /**
   * Résout le niveau de discrétion actif à partir des options ou de ConfigCache.
   * @param {Object} [options]
   * @returns {'ultra-furtif'|'furtif'|'visible'|'glow'}
   */
  function resolveDiscretionLevel(options) {
    if (options && typeof options === 'object') {
      const fromOpts = normalizeDiscretionLevel(
        options.stealthLevel ?? options.discretionLevel ?? options.highlightDiscretion
      );
      if (fromOpts) return fromOpts;
    }
    if (_storedHighlightData && _storedHighlightData.options && typeof _storedHighlightData.options === 'object') {
      const fromStored = normalizeDiscretionLevel(
        _storedHighlightData.options.stealthLevel ??
        _storedHighlightData.options.discretionLevel ??
        _storedHighlightData.options.highlightDiscretion
      );
      if (fromStored) return fromStored;
    }
    try {
      if (typeof ConfigCache !== 'undefined' && ConfigCache && typeof ConfigCache.get === 'function') {
        if (!ConfigCache.isInitialized || ConfigCache.isInitialized()) {
          const cached = ConfigCache.get('stealthLevel') ??
            ConfigCache.get('discretionLevel') ??
            ConfigCache.get('highlightDiscretion');
          const normalized = normalizeDiscretionLevel(cached);
          if (normalized) return normalized;
        }
      }
    } catch (e) { /* use default */ }
    return 'furtif';
  }

  /**
   * Détermine si le badge de pourcentage de confiance doit être affiché.
   * @param {Object} [options]
   * @returns {boolean}
   */
  function resolveShowConfidenceBadge(options) {
    if (options && typeof options === 'object' && typeof options.showConfidenceBadge === 'boolean') {
      return options.showConfidenceBadge;
    }
    if (
      _storedHighlightData &&
      _storedHighlightData.options &&
      typeof _storedHighlightData.options === 'object' &&
      typeof _storedHighlightData.options.showConfidenceBadge === 'boolean'
    ) {
      return _storedHighlightData.options.showConfidenceBadge;
    }
    try {
      if (typeof ConfigCache !== 'undefined' && ConfigCache && typeof ConfigCache.get === 'function') {
        if (!ConfigCache.isInitialized || ConfigCache.isInitialized()) {
          const cached = ConfigCache.get('showConfidenceBadge');
          if (typeof cached === 'boolean') return cached;
        }
      }
    } catch (e) { /* use default */ }
    return true;
  }

  /**
   * Calcule le palier de confiance ('high' >= 80, 'medium' 50..79, 'low' < 50).
   * @param {Object|number|string} answerOrConfidence
   * @returns {'high'|'medium'|'low'|null}
   */
  function resolveConfidenceTier(answerOrConfidence) {
    if (typeof answerOrConfidence === 'number' && Number.isFinite(answerOrConfidence)) {
      const c = Math.max(0, Math.min(100, Math.round(answerOrConfidence)));
      if (c >= 80) return 'high';
      if (c >= 50) return 'medium';
      return 'low';
    }
    if (typeof answerOrConfidence === 'string') {
      const lower = answerOrConfidence.trim().toLowerCase();
      if (lower === 'high' || lower === 'medium' || lower === 'low') return lower;
      const parsed = Number(lower.replace(/%$/, '').trim());
      if (Number.isFinite(parsed)) {
        const c = Math.max(0, Math.min(100, Math.round(parsed)));
        if (c >= 80) return 'high';
        if (c >= 50) return 'medium';
        return 'low';
      }
      return null;
    }
    if (!answerOrConfidence || typeof answerOrConfidence !== 'object') {
      return null;
    }
    if (typeof answerOrConfidence.confidence === 'number' && Number.isFinite(answerOrConfidence.confidence)) {
      const c = Math.max(0, Math.min(100, Math.round(answerOrConfidence.confidence)));
      if (c >= 80) return 'high';
      if (c >= 50) return 'medium';
      return 'low';
    }
    if (typeof answerOrConfidence.confidence === 'string' && answerOrConfidence.confidence.trim().length > 0) {
      const parsed = Number(answerOrConfidence.confidence.trim().replace(/%$/, '').trim());
      if (Number.isFinite(parsed)) {
        const c = Math.max(0, Math.min(100, Math.round(parsed)));
        if (c >= 80) return 'high';
        if (c >= 50) return 'medium';
        return 'low';
      }
    }
    if (typeof answerOrConfidence.confidenceTier === 'string') {
      const tier = answerOrConfidence.confidenceTier.trim().toLowerCase();
      if (tier === 'high' || tier === 'medium' || tier === 'low') {
        return tier;
      }
    }
    return null;
  }

  function resolveTierColor(tier, fallbackColor = '#00b4ff') {
    if (tier === 'high') return '#22c55e';
    if (tier === 'medium') return '#f59e0b';
    if (tier === 'low') return '#ef4444';
    return fallbackColor || '#00b4ff';
  }

  function getStoredHighlightData() {
    return _storedHighlightData;
  }

  function setStoredHighlightData(data) {
    _storedHighlightData = data;
  }

  function clearObservers() {
    if (_intersectionObserver) {
      _intersectionObserver.disconnect();
      _intersectionObserver = null;
    }
    if (_mutationObserver) {
      _mutationObserver.disconnect();
      _mutationObserver = null;
    }
    _intersectingTargets = new WeakMap();
  }

  function suspendObservers() {
    if (_intersectionObserver) _intersectionObserver.disconnect();
    if (_mutationObserver) _mutationObserver.disconnect();
  }

  function observeMutationTargets(mo, questions) {
    if (!mo || !Array.isArray(questions)) return;
    const observedParents = new Set();
    questions.forEach(q => {
      if (q && q.element) {
        try {
          mo.observe(q.element, {
            attributes: true,
            attributeFilter: ['class', 'style', 'aria-hidden'],
            subtree: true
          });
        } catch (e) { /* element might be detached */ }
        const parent = q.element.parentNode;
        if (parent && (parent.nodeType === 1 || parent.nodeType === 11) && !observedParents.has(parent)) {
          observedParents.add(parent);
          try {
            mo.observe(parent, { childList: true });
          } catch (e) { /* parent might be detached */ }
        }
      }
    });
  }

  function observeIntersectionTargets(io, questions) {
    if (!io || !Array.isArray(questions)) return;
    questions.forEach(q => {
      if (q && q.element) {
        try { io.observe(q.element); } catch (e) { /* ignore */ }
      }
    });
  }

  /**
   * Attache les observateurs aux conteneurs de questions et à leurs parents directs
   * pour détecter les remplacements de nœuds (SPA re-render) via childList.
   */
  function observeQuestionTargets(mo, io, questions) {
    observeIntersectionTargets(io, questions);
    observeMutationTargets(mo, questions);
  }

  function isOwnUiNode(node) {
    if (!node || typeof node !== 'object') return false;
    if (_badgeNodes.has(node) || floatingButtons.includes(node) || node.id === _styleTagId) {
      return true;
    }
    if (node.classList && typeof node.classList.contains === 'function') {
      if (node.classList.contains(_badgeClass) || node.classList.contains(_floatClass)) {
        return true;
      }
    }
    if (typeof node.className === 'string') {
      if (node.className.includes(_badgeClass) || node.className.includes(_floatClass)) {
        return true;
      }
    }
    return false;
  }

  function isOwnUiMutation(records) {
    if (!Array.isArray(records) || records.length === 0) return false;
    for (const rec of records) {
      if (!rec || rec.type !== 'childList') return false;
      const changed = [
        ...(rec.addedNodes ? Array.from(rec.addedNodes) : []),
        ...(rec.removedNodes ? Array.from(rec.removedNodes) : [])
      ];
      if (changed.length === 0) return false;
      for (const node of changed) {
        if (!isOwnUiNode(node)) {
          return false;
        }
      }
    }
    return true;
  }

  function alignAnswersToRefreshedQuestions(prevQuestions, prevAnswers, newQuestions) {
    if (!Array.isArray(prevQuestions) || !Array.isArray(prevAnswers) || !Array.isArray(newQuestions)) {
      return [];
    }
    const ansByPrevIdx = new Map();
    prevAnswers.forEach(a => {
      if (a && typeof a.questionIndex === 'number') {
        ansByPrevIdx.set(a.questionIndex, a);
      }
    });
    const ansByText = new Map();
    prevQuestions.forEach((pq, pPos) => {
      const logicalIdx = (pq && typeof pq.index === 'number') ? pq.index - 1 : pPos;
      const a = ansByPrevIdx.get(logicalIdx) || ansByPrevIdx.get(pPos);
      const t = pq && typeof pq.text === 'string' ? pq.text.trim() : '';
      if (t && a && !ansByText.has(t)) {
        ansByText.set(t, a);
      }
    });
    const remapped = [];
    newQuestions.forEach((nq, nPos) => {
      if (nq) nq.index = nPos + 1;
      const t = nq && typeof nq.text === 'string' ? nq.text.trim() : '';
      const matched = t ? ansByText.get(t) : null;
      if (matched) {
        remapped.push({ ...matched, questionIndex: nPos });
      }
    });
    return remapped;
  }

  function resumeObservers() {
    if (!_storedHighlightData || !Array.isArray(_storedHighlightData.questions)) return;
    observeQuestionTargets(_mutationObserver, _intersectionObserver, _storedHighlightData.questions);
  }

  function setupHighlightObservers() {
    clearObservers();

    if (!_storedHighlightData) {
      return;
    }

    if (typeof IntersectionObserver === 'function') {
      _intersectionObserver = new IntersectionObserver((entries) => {
        if (_isHealing || !_storedHighlightData) return;
        let needsRedraw = false;
        for (const entry of entries) {
          if (!entry || !entry.target) continue;
          const wasIntersecting = _intersectingTargets.get(entry.target);
          const nowIntersecting = Boolean(entry.isIntersecting);
          _intersectingTargets.set(entry.target, nowIntersecting);
          if (nowIntersecting && (!_renderedQuestions.has(entry.target) || wasIntersecting === false)) {
            needsRedraw = true;
          }
        }
        if (needsRedraw) {
          const cur = _storedHighlightData;
          const status = renderVisibleHighlights(cur.questions, cur.answers, cur.color, cur.options);
          if (status === 'NEEDS_HEAL') {
            repairDeadNodes(cur.answers, cur.color);
          }
        }
      }, { threshold: 0.05 });
    }

    if (typeof MutationObserver === 'function') {
      _mutationObserver = new MutationObserver((records) => {
        if (_isHealing || !_storedHighlightData) return;
        if (isOwnUiMutation(records)) return;
        const cur = _storedHighlightData;
        const status = renderVisibleHighlights(cur.questions, cur.answers, cur.color, cur.options);
        if (status === 'NEEDS_HEAL') {
          repairDeadNodes(cur.answers, cur.color);
        }
      });
    }

    resumeObservers();
  }

  async function repairDeadNodes(answers, color) {
    if (_isHealing) return;
    const healGen = ++_healGeneration;
    const targetData = _storedHighlightData;
    _isHealing = true;
    suspendObservers();
    try {
      console.log('🔄 [Auto-Heal] Ré-extraction du DOM suite à une navigation SPA...');

      if (!rootWin.SafeExm.DOMExtractor) {
        throw new Error('DOMExtractor non disponible.');
      }
      const newData = await rootWin.SafeExm.DOMExtractor.extractQuizData();

      if (healGen !== _healGeneration || !_storedHighlightData || _storedHighlightData !== targetData) {
        return;
      }

      if (!newData || !Array.isArray(newData.questions) || newData.questions.length === 0) {
        clearAllHighlights();
        return;
      }

      const prevQuestions = _storedHighlightData.questions || [];
      const baseAnswers = Array.isArray(answers) ? answers : (_storedHighlightData.answers || []);
      const alignedAnswers = alignAnswersToRefreshedQuestions(prevQuestions, baseAnswers, newData.questions);
      if (alignedAnswers.length === 0) {
        console.log('ℹ️ [Auto-Heal] Questions remplacées sans correspondance — nettoyage des surlignages.');
        clearAllHighlights();
        return;
      }
      if (newData.questions.length === prevQuestions.length && alignedAnswers.length === prevQuestions.length) {
        console.log('✅ [Auto-Heal] Nœuds rafraîchis avec succès !');
      } else {
        console.warn(`⚠️ [Auto-Heal] Le nombre de questions alignées a changé (${alignedAnswers.length} vs ${prevQuestions.length})`);
      }
      _storedHighlightData.questions = newData.questions;
      _storedHighlightData.answers = alignedAnswers;
      renderVisibleHighlights(newData.questions, alignedAnswers, color, _storedHighlightData.options);
    } catch (e) {
      console.error('❌ [Auto-Heal] Erreur:', e);
    } finally {
      if (healGen === _healGeneration) {
        _isHealing = false;
        _intersectingTargets = new WeakMap();
        if (_storedHighlightData) {
          resumeObservers();
        }
      }
    }
  }

  function ensureDynamicStyleTag(color = '#00b4ff') {
    if (typeof document === 'undefined' || !document || typeof document.createElement !== 'function') {
      return;
    }
    if (typeof document.getElementById === 'function' && document.getElementById(_styleTagId)) {
      return;
    }
    const hex = typeof color === 'string' && color.startsWith('#') && color.length >= 7 ? color : '#00b4ff';
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 180;
    const b = parseInt(hex.slice(5, 7), 16) || 255;

    const style = document.createElement('style');
    style.id = _styleTagId;
    style.textContent = `
      .${_styleTagId} {
        animation: ${_styleTagId}-glow 2s ease-in-out infinite !important;
      }
      @keyframes ${_styleTagId}-glow {
        0%, 100% { outline-color: ${hex}; }
        50% { outline-color: rgba(${r}, ${g}, ${b}, 0.4); }
      }
      @keyframes ${_styleTagId}-float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-5px); }
      }
      .${_floatClass}.${_floatDiscreetClass}:hover {
        background: #20374C !important;
        color: #fff !important;
        border-color: rgba(255, 255, 255, 0.3) !important;
      }
      .${_floatClass}.${_floatVisibleClass}:hover {
        transform: scale(1.05) !important;
      }
      .${_floatClass}.${_floatGlowClass}:hover {
        transform: scale(1.2) !important;
        box-shadow: 0 6px 20px rgba(0, 180, 255, 0.7) !important;
      }
      .${_floatClass}::after {
        content: attr(title);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        padding: 5px 10px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        font-size: 11px;
        border-radius: 4px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
      }
      .${_floatClass}:hover::after {
        opacity: 1;
      }
    `;
    const styleRoot = document.head || document.documentElement;
    if (styleRoot && typeof styleRoot.appendChild === 'function') {
      styleRoot.appendChild(style);
    }
  }

  function highlightOption(option, color = '#00b4ff', explicitDiscretion = null) {
    if (!option || typeof option !== 'object') return null;
    const element = option.labelElement || option.element?.parentElement || option.element;
    if (!element) {
      console.warn('⚠️ Élément à surligner non trouvé');
      return null;
    }

    const discretion = normalizeDiscretionLevel(explicitDiscretion) || resolveDiscretionLevel();
    const hex = typeof color === 'string' && color.startsWith('#') && color.length >= 7 ? color : '#00b4ff';
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 180;
    const b = parseInt(hex.slice(5, 7), 16) || 255;

    element.style = element.style || {};

    // SEC-03 : Sauvegarder les styles originaux dans le WeakMap
    if (!_originalStyles.has(element)) {
      _originalStyles.set(element, {
        outline: element.style.outline || '',
        outlineOffset: element.style.outlineOffset || '',
        boxShadow: element.style.boxShadow || '',
        position: element.style.position || '',
        backgroundColor: element.style.backgroundColor || '',
        borderLeft: element.style.borderLeft || ''
      });
    }

    if (discretion === 'ultra-furtif') {
      element.style.backgroundColor = 'rgba(77, 168, 218, 0.04)';
    } else if (discretion === 'furtif') {
      element.style.borderLeft = `3px solid ${hex}`;
      element.style.backgroundColor = 'rgba(77, 168, 218, 0.02)';
    } else if (discretion === 'visible') {
      element.style.outline = `1.5px solid ${hex}`;
      element.style.outlineOffset = '1px';
      element.style.backgroundColor = 'rgba(77, 168, 218, 0.02)';
    } else { // glow
      element.style.outline = `3px solid ${hex}`;
      element.style.outlineOffset = '2px';
      element.style.boxShadow = `0 0 15px rgba(${r}, ${g}, ${b}, 0.6), 0 0 30px rgba(${r}, ${g}, ${b}, 0.3)`;
      if (element.classList && typeof element.classList.add === 'function') {
        element.classList.add(_styleTagId);
      }
    }

    element.style.position = element.style.position || 'relative';
    highlights.push(element);

    ensureDynamicStyleTag(hex);
    return element;
  }

  /**
   * F-INT-02 & F-UX-02 : Crée un badge de confiance furtif et indicateur de cross-validation.
   * Zéro innerHTML, zéro signature DOM statique (stockage WeakMap + Set).
   * En mode ultra-furtif, n'injecte aucun nœud DOM.
   */
  function createConfidenceBadge(answer, targetElement, explicitDiscretion = null, explicitShowBadge = null) {
    if (!answer || typeof answer !== 'object') return null;
    const showBadge = typeof explicitShowBadge === 'boolean'
      ? explicitShowBadge
      : resolveShowConfidenceBadge();
    if (!showBadge) {
      return null;
    }
    const discretion = normalizeDiscretionLevel(explicitDiscretion) || resolveDiscretionLevel();
    if (discretion === 'ultra-furtif') {
      return null;
    }

    const hasConfidenceInfo = (
      answer.confidence !== undefined ||
      answer.confidenceTier !== undefined ||
      answer.crossValidated !== undefined ||
      answer.crossValidationStatus !== undefined ||
      answer.explanation !== undefined
    );
    if (!hasConfidenceInfo) {
      return null;
    }

    if (typeof document === 'undefined' || !document || typeof document.createElement !== 'function') {
      return null;
    }

    const tier = resolveConfidenceTier(answer) || 'medium';
    let numericConfidence = null;
    if (typeof answer.confidence === 'number' && Number.isFinite(answer.confidence)) {
      numericConfidence = Math.max(0, Math.min(100, Math.round(answer.confidence)));
    } else if (typeof answer.confidence === 'string' && answer.confidence.trim().length > 0) {
      const parsed = Number(answer.confidence.trim().replace(/%$/, '').trim());
      if (Number.isFinite(parsed)) {
        numericConfidence = Math.max(0, Math.min(100, Math.round(parsed)));
      }
    }

    const rawCvStatus = typeof answer.crossValidationStatus === 'string'
      ? answer.crossValidationStatus.trim().toLowerCase()
      : (answer.crossValidated === true ? 'confirmed' : 'unverified');

    let cvIndicator = '';
    let normalizedCvStatus = 'unverified';
    if (rawCvStatus === 'confirmed') {
      cvIndicator = '✓✓';
      normalizedCvStatus = 'confirmed';
    } else if (rawCvStatus === 'disagreed' || rawCvStatus === 'disputed') {
      cvIndicator = '!';
      normalizedCvStatus = rawCvStatus;
    }

    const tierPalettes = {
      high: {
        bg: 'rgba(34, 197, 94, 0.14)',
        fg: '#22c55e',
        border: 'rgba(34, 197, 94, 0.38)'
      },
      medium: {
        bg: 'rgba(245, 158, 11, 0.14)',
        fg: '#f59e0b',
        border: 'rgba(245, 158, 11, 0.38)'
      },
      low: {
        bg: 'rgba(239, 68, 68, 0.14)',
        fg: '#ef4444',
        border: 'rgba(239, 68, 68, 0.38)'
      }
    };
    const palette = tierPalettes[tier] || tierPalettes.medium;

    const badge = document.createElement('span');
    badge.className = _badgeClass;
    const baseLabel = numericConfidence !== null ? `${numericConfidence}%` : tier.toUpperCase();
    badge.textContent = cvIndicator ? `${baseLabel} ${cvIndicator}` : baseLabel;

    badge.style = badge.style || {};
    Object.assign(badge.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '3px',
      marginLeft: '6px',
      padding: '1px 6px',
      borderRadius: '999px',
      fontSize: '10px',
      fontWeight: '600',
      lineHeight: '1.3',
      backgroundColor: palette.bg,
      color: palette.fg,
      border: `1px solid ${palette.border}`,
      verticalAlign: 'middle',
      userSelect: 'none',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    });

    const explanation = typeof answer.explanation === 'string' ? answer.explanation.trim() : '';
    const cvNote = typeof answer.crossValidationNote === 'string' ? answer.crossValidationNote.trim() : '';
    const tooltipParts = [];
    if (explanation) tooltipParts.push(explanation);
    if (cvNote) tooltipParts.push(cvNote);
    const tooltipText = tooltipParts.join(' — ');
    if (tooltipText) {
      badge.title = tooltipText;
    }

    const meta = {
      confidence: numericConfidence !== null ? numericConfidence : (tier === 'high' ? 90 : tier === 'medium' ? 65 : 35),
      confidenceTier: tier,
      crossValidated: Boolean(answer.crossValidated || normalizedCvStatus === 'confirmed' || normalizedCvStatus === 'disagreed' || normalizedCvStatus === 'disputed'),
      crossValidationStatus: normalizedCvStatus,
      indicator: cvIndicator,
      explanation,
      crossValidationNote: cvNote
    };
    _badgeMetadata.set(badge, meta);

    // Résoudre le conteneur parent où attacher le badge (éviter d'insérer dans un élément vide <input>/<select>/<textarea>)
    let container = targetElement;
    if (container && typeof container.tagName === 'string') {
      const tag = container.tagName.toUpperCase();
      if ((tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'IMG') && container.parentElement) {
        container = container.parentElement;
      }
    }
    if (!container || typeof container.appendChild !== 'function') {
      container = (typeof document !== 'undefined' && document && document.body) ? document.body : null;
    }
    if (container && typeof container.appendChild === 'function') {
      container.appendChild(badge);
    }

    _badgeNodes.add(badge);
    highlights.push(badge);
    return badge;
  }

  function createFloatingButton(inputElement, textAnswer, overrideColor = null, explicitDiscretion = null) {
    if (!inputElement) return null;
    if (rootWin.SafeExm.DOMExtractor && typeof rootWin.SafeExm.DOMExtractor.isElementVisible === 'function') {
      if (!rootWin.SafeExm.DOMExtractor.isElementVisible(inputElement)) return null;
    }

    const discretion = normalizeDiscretionLevel(explicitDiscretion) || resolveDiscretionLevel();
    let color = overrideColor || '#4DA8DA';
    try {
      if (!overrideColor && typeof ConfigCache !== 'undefined' && ConfigCache && (!ConfigCache.isInitialized || ConfigCache.isInitialized())) {
        const cachedColor = ConfigCache.get('highlightColor');
        if (cachedColor) color = cachedColor;
      }
    } catch (e) { /* use default */ }

    if (discretion === 'ultra-furtif') return null;
    if (typeof document === 'undefined' || !document || typeof document.createElement !== 'function') return null;

    const button = document.createElement('div');
    button.className = _floatClass;
    button.textContent = '✨';
    button.title = 'Cliquer pour insérer la réponse';

    const rect = typeof inputElement.getBoundingClientRect === 'function'
      ? inputElement.getBoundingClientRect()
      : { top: 0, right: 40, left: 0, height: 24, width: 40 };
    const scrollTop = (typeof window !== 'undefined' && window.pageYOffset) ||
      (document.documentElement && document.documentElement.scrollTop) || 0;
    const scrollLeft = (typeof window !== 'undefined' && window.pageXOffset) ||
      (document.documentElement && document.documentElement.scrollLeft) || 0;

    button.style = button.style || {};
    if (discretion === 'furtif') {
      if (button.classList) button.classList.add(_floatDiscreetClass);
      Object.assign(button.style, {
        position: 'absolute',
        top: `${rect.top + scrollTop + (rect.height - 20) / 2}px`,
        left: `${rect.right + scrollLeft - 26}px`,
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        background: '#172A3A',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        fontSize: '10px',
        color: 'rgba(255, 255, 255, 0.6)',
        boxShadow: 'none',
        zIndex: '2147483647',
        userSelect: 'none'
      });
    } else if (discretion === 'visible') {
      if (button.classList) button.classList.add(_floatVisibleClass);
      Object.assign(button.style, {
        position: 'absolute',
        top: `${rect.top + scrollTop + (rect.height - 24) / 2}px`,
        left: `${rect.right + scrollLeft - 30}px`,
        width: '24px',
        height: '24px',
        borderRadius: '50%',
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        fontSize: '12px',
        color: '#000',
        boxShadow: 'none',
        zIndex: '2147483647',
        userSelect: 'none'
      });
    } else { // glow
      if (button.classList) button.classList.add(_floatGlowClass);
      Object.assign(button.style, {
        position: 'absolute',
        top: `${rect.top + scrollTop + 10}px`,
        left: `${rect.right + scrollLeft - 40}px`,
        width: '30px',
        height: '30px',
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #00d4ff 0%, #7b2cbf 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        fontSize: '14px',
        boxShadow: '0 4px 15px rgba(0, 180, 255, 0.5)',
        animation: `${_styleTagId}-float 3s ease-in-out infinite`,
        zIndex: '2147483647',
        userSelect: 'none'
      });
    }
    ensureDynamicStyleTag(color);

    if (typeof button.addEventListener === 'function') {
      button.addEventListener('click', () => {
        inputElement.value = textAnswer;
        if (typeof inputElement.dispatchEvent === 'function' && typeof Event === 'function') {
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
          inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        }

        button.style.background = '#6BCB77';
        button.style.color = '#000';
        button.textContent = '✓';

        setTimeout(() => {
          if (discretion === 'furtif') {
            button.style.background = '#172A3A';
            button.style.color = 'rgba(255, 255, 255, 0.6)';
            button.textContent = '✨';
          } else if (discretion === 'visible') {
            button.style.background = color;
            button.style.color = '#000';
            button.textContent = '✨';
          } else {
            button.style.background = 'linear-gradient(135deg, #00d4ff 0%, #7b2cbf 100%)';
            button.style.color = 'white';
            button.textContent = '✨';
          }
        }, 1500);
      });
    }

    if (document.body && typeof document.body.appendChild === 'function') {
      document.body.appendChild(button);
    }
    floatingButtons.push(button);
    return button;
  }

  /**
   * Surligne une question individuelle (QCM, texte, select_matching, fill_blank, drag_drop)
   * et affiche le badge de confiance furtif si le niveau de discrétion l'autorise.
   */
  function highlightQuestion(question, answer, colorOrOptions = '#00b4ff', maybeOptions = null) {
    if (!question || typeof question !== 'object' || !answer || typeof answer !== 'object') {
      return null;
    }

    let baseColor = '#00b4ff';
    let options = maybeOptions && typeof maybeOptions === 'object' ? maybeOptions : {};
    if (typeof colorOrOptions === 'string') {
      baseColor = colorOrOptions;
    } else if (colorOrOptions && typeof colorOrOptions === 'object') {
      options = colorOrOptions;
      if (typeof options.color === 'string') {
        baseColor = options.color;
      }
    }

    const discretion = resolveDiscretionLevel(options);
    const tier = resolveConfidenceTier(answer);
    const activeColor = tier ? resolveTierColor(tier, baseColor) : baseColor;
    const isVisibleFn = (el) => {
      if (!el) return false;
      if (rootWin.SafeExm.DOMExtractor && typeof rootWin.SafeExm.DOMExtractor.isElementVisible === 'function') {
        return rootWin.SafeExm.DOMExtractor.isElementVisible(el);
      }
      return true;
    };

    const qType = question.questionType || question.type || 'unknown';
    let badgeTarget = null;
    let highlightedCount = 0;

    if (qType === 'radio' || qType === 'checkbox' || qType === 'single_choice' || qType === 'multi_choice') {
      const optionIndices = Array.isArray(answer.optionIndices) ? answer.optionIndices : [];
      const qOptions = Array.isArray(question.options) ? question.options : [];
      for (const optIdx of optionIndices) {
        const option = qOptions[optIdx];
        if (option) {
          const visualElement = option.labelElement || option.element?.parentElement || option.element;
          if (isVisibleFn(visualElement)) {
            const hlEl = highlightOption(option, activeColor, discretion);
            if (!badgeTarget) {
              badgeTarget = hlEl || visualElement;
            }
            highlightedCount++;
          }
        }
      }
      if (!badgeTarget && question.element) {
        badgeTarget = question.element;
      }
    } else if (qType === 'select_matching' || (Array.isArray(question.selects) && question.selects.length > 0)) {
      const selects = Array.isArray(question.selects) ? question.selects : [];
      for (const selEntry of selects) {
        const selEl = selEntry && selEntry.element;
        if (selEl && isVisibleFn(selEl)) {
          highlightOption({ element: selEl, labelElement: selEl }, activeColor, discretion);
          if (!badgeTarget) {
            badgeTarget = selEl.parentElement || question.element || selEl;
          }
          highlightedCount++;
        }
      }
      if (!badgeTarget) {
        badgeTarget = question.element;
      }
    } else if (qType === 'drag_drop' || (Array.isArray(question.dropTargets) && question.dropTargets.length > 0)) {
      const draggables = Array.isArray(question.draggables) ? question.draggables : [];
      const dropTargets = Array.isArray(question.dropTargets) ? question.dropTargets : [];
      const optionIndices = Array.isArray(answer.optionIndices) && answer.optionIndices.length > 0
        ? answer.optionIndices
        : draggables.map((_, i) => i);

      for (const idx of optionIndices) {
        const d = draggables[idx];
        if (d && d.element && isVisibleFn(d.element)) {
          highlightOption({ element: d.element, labelElement: d.element }, activeColor, discretion);
          if (!badgeTarget) badgeTarget = d.element;
          highlightedCount++;
        }
      }
      for (const dt of dropTargets) {
        if (dt && dt.element && isVisibleFn(dt.element)) {
          highlightOption({ element: dt.element, labelElement: dt.element }, activeColor, discretion);
          if (!badgeTarget) badgeTarget = dt.element;
          highlightedCount++;
        }
      }
      if (!badgeTarget) {
        badgeTarget = question.element;
      }
    } else if (qType === 'fill_blank' || qType === 'text' || question.inputElement) {
      const textAnswer = answer.textAnswer || answer.raw || '';
      const blanks = Array.isArray(question.blanks) && question.blanks.length > 0
        ? question.blanks.map(b => b && b.element).filter(Boolean)
        : (Array.isArray(question.inputElements) && question.inputElements.length > 0
          ? question.inputElements
          : (question.inputElement ? [question.inputElement] : []));

      const parts = blanks.length > 1 && typeof textAnswer === 'string' && /[|;,]/.test(textAnswer)
        ? textAnswer.split(/\s*[|;,]\s*/)
        : [textAnswer];

      blanks.forEach((inputEl, bIdx) => {
        if (isVisibleFn(inputEl)) {
          const partAns = parts[bIdx] !== undefined ? parts[bIdx] : (parts[0] || '');
          createFloatingButton(inputEl, partAns, activeColor, discretion);
          if (!badgeTarget) {
            badgeTarget = inputEl.parentElement || question.element || inputEl;
          }
          highlightedCount++;
        }
      });
      if (!badgeTarget) {
        badgeTarget = question.element || (question.inputElement && question.inputElement.parentElement) || question.inputElement;
      }
    } else if (question.element) {
      badgeTarget = question.element;
    }

    const showConfidenceBadge = resolveShowConfidenceBadge(options);
    const badge = createConfidenceBadge(answer, badgeTarget || question.element, discretion, showConfidenceBadge);
    return {
      highlightedCount,
      badge,
      tier,
      color: activeColor,
      discretion
    };
  }

  function removeTransientHighlights() {
    highlights.forEach(el => {
      if (el && _originalStyles.has(el)) {
        const orig = _originalStyles.get(el);
        if (el.style) {
          el.style.outline = orig.outline;
          el.style.outlineOffset = orig.outlineOffset || '';
          el.style.boxShadow = orig.boxShadow;
          el.style.position = orig.position;
          el.style.backgroundColor = orig.backgroundColor;
          el.style.borderLeft = orig.borderLeft;
        }
        if (el.classList && typeof el.classList.remove === 'function') {
          el.classList.remove(_styleTagId);
        }
        _originalStyles.delete(el);
      }
    });
    for (const badge of _badgeNodes) {
      if (badge && typeof badge.remove === 'function') {
        badge.remove();
      } else if (badge && badge.parentNode && typeof badge.parentNode.removeChild === 'function') {
        badge.parentNode.removeChild(badge);
      }
      _badgeMetadata.delete(badge);
    }
    _badgeNodes.clear();
    floatingButtons.forEach(b => {
      if (b && typeof b.remove === 'function') {
        b.remove();
      } else if (b && b.parentNode && typeof b.parentNode.removeChild === 'function') {
        b.parentNode.removeChild(b);
      }
    });
    highlights = [];
    floatingButtons = [];
    _renderedQuestions = new WeakSet();
  }

  function renderVisibleHighlights(questions, answers, color = '#00b4ff', options = {}) {
    const tempMO = _mutationObserver;
    if (tempMO) tempMO.disconnect();

    try {
      removeTransientHighlights();

      if (!Array.isArray(questions) || !Array.isArray(answers)) {
        return 'OK';
      }

      const answersMap = new Map();
      answers.forEach(ans => {
        if (ans && typeof ans.questionIndex === 'number') {
          answersMap.set(ans.questionIndex, ans);
        }
      });

      const hasExtractor = Boolean(rootWin.SafeExm.DOMExtractor);
      const isVisibleFn = (el) => {
        if (!el) return true;
        if (hasExtractor && typeof rootWin.SafeExm.DOMExtractor.isElementVisible === 'function') {
          return rootWin.SafeExm.DOMExtractor.isElementVisible(el);
        }
        return true;
      };

      for (let idx = 0; idx < questions.length; idx++) {
        const question = questions[idx];
        const answer = answersMap.get(idx);
        if (!question || !answer) {
          continue;
        }

        // 🚨 AUTO-HEAL CHECK BEFORE isElementVisible (detached nodes have zero bounding rect!) 🚨
        if (question.element && !isElementConnected(question.element)) {
          console.warn(`⚠️ [Auto-Heal] Conteneur mort détecté pour Q${idx + 1} (SPA Re-render)`);
          return 'NEEDS_HEAL';
        }
        if (Array.isArray(question.options) && question.options.length > 0) {
          const sampleElement = question.options[0].element;
          if (sampleElement && !isElementConnected(sampleElement)) {
            console.warn(`⚠️ [Auto-Heal] Nœuds morts détectés pour Q${idx + 1} (SPA Re-render)`);
            return 'NEEDS_HEAL';
          }
        } else if (question.inputElement && !isElementConnected(question.inputElement)) {
          console.warn(`⚠️ [Auto-Heal] Champ texte mort pour Q${idx + 1}`);
          return 'NEEDS_HEAL';
        } else if (Array.isArray(question.selects) && question.selects.length > 0 && question.selects[0].element && !isElementConnected(question.selects[0].element)) {
          console.warn(`⚠️ [Auto-Heal] Select mort pour Q${idx + 1}`);
          return 'NEEDS_HEAL';
        } else if (Array.isArray(question.dropTargets) && question.dropTargets.length > 0 && question.dropTargets[0].element && !isElementConnected(question.dropTargets[0].element)) {
          console.warn(`⚠️ [Auto-Heal] DropTarget mort pour Q${idx + 1}`);
          return 'NEEDS_HEAL';
        }

        if (question.element && !isVisibleFn(question.element)) {
          continue;
        }

        highlightQuestion(question, answer, color, options);
        if (question.element) {
          _renderedQuestions.add(question.element);
        }
      }

      return 'OK';
    } finally {
      if (!_isHealing && Array.isArray(questions)) {
        observeMutationTargets(tempMO, questions);
      }
    }
  }

  function verifyAndRepair(questions, answers, color, options) {
    const qList = Array.isArray(questions)
      ? questions
      : (_storedHighlightData && Array.isArray(_storedHighlightData.questions) ? _storedHighlightData.questions : []);
    const aList = Array.isArray(answers)
      ? answers
      : (_storedHighlightData && Array.isArray(_storedHighlightData.answers) ? _storedHighlightData.answers : []);
    const activeColor = color || (_storedHighlightData && _storedHighlightData.color) || '#00b4ff';
    const activeOptions = options || (_storedHighlightData && _storedHighlightData.options) || {};
    return renderVisibleHighlights(qList, aList, activeColor, activeOptions);
  }

  function clearAllHighlights() {
    console.log('🧹 Nettoyage des surlignages...');
    _healGeneration++;
    _isHealing = false;
    if (rootWin.SafeExm && rootWin.SafeExm.Content && typeof rootWin.SafeExm.Content.cancelPendingAutoSubmit === 'function') {
      try {
        rootWin.SafeExm.Content.cancelPendingAutoSubmit();
      } catch (e) { /* ignore */ }
    }

    highlights.forEach(el => {
      if (el && _originalStyles.has(el)) {
        const orig = _originalStyles.get(el);
        if (el.style) {
          el.style.outline = orig.outline;
          el.style.outlineOffset = orig.outlineOffset || '';
          el.style.boxShadow = orig.boxShadow;
          el.style.position = orig.position;
          el.style.backgroundColor = orig.backgroundColor;
          el.style.borderLeft = orig.borderLeft;
        }
        if (el.classList && typeof el.classList.remove === 'function') {
          el.classList.remove(_styleTagId);
        }
        _originalStyles.delete(el);
      } else if (el && typeof el.remove === 'function') {
        el.remove();
      } else if (el && el.parentNode && typeof el.parentNode.removeChild === 'function') {
        el.parentNode.removeChild(el);
      }
    });

    for (const badge of _badgeNodes) {
      if (badge && typeof badge.remove === 'function') {
        badge.remove();
      } else if (badge && badge.parentNode && typeof badge.parentNode.removeChild === 'function') {
        badge.parentNode.removeChild(badge);
      }
      _badgeMetadata.delete(badge);
    }
    _badgeNodes.clear();

    floatingButtons.forEach(b => {
      if (b && typeof b.remove === 'function') {
        b.remove();
      } else if (b && b.parentNode && typeof b.parentNode.removeChild === 'function') {
        b.parentNode.removeChild(b);
      }
    });

    highlights = [];
    floatingButtons = [];
    _renderedQuestions = new WeakSet();
    _storedHighlightData = null;
    clearObservers();

    if (typeof document !== 'undefined' && document && typeof document.getElementById === 'function') {
      const styleEl = document.getElementById(_styleTagId);
      if (styleEl && typeof styleEl.remove === 'function') {
        styleEl.remove();
      } else if (styleEl && styleEl.parentNode && typeof styleEl.parentNode.removeChild === 'function') {
        styleEl.parentNode.removeChild(styleEl);
      }
    }
  }

  function buildAppendMergedState(prevData, nextQuestions, nextAnswers) {
    const prevQuestions = Array.isArray(prevData && prevData.questions) ? prevData.questions : [];
    const prevAnswers = Array.isArray(prevData && prevData.answers) ? prevData.answers : [];
    const prevAnswerByIdx = new Map();
    prevAnswers.forEach(a => {
      if (a && typeof a.questionIndex === 'number') {
        prevAnswerByIdx.set(a.questionIndex, a);
      }
    });

    const incomingElements = new Set();
    const incomingTexts = new Set();
    (Array.isArray(nextQuestions) ? nextQuestions : []).forEach(q => {
      if (q && q.element) incomingElements.add(q.element);
      if (q && typeof q.text === 'string' && q.text.trim()) incomingTexts.add(q.text.trim());
    });

    const mergedQuestions = [];
    const mergedAnswers = [];

    prevQuestions.forEach((pq, pPos) => {
      const logicalIdx = (pq && typeof pq.index === 'number') ? pq.index - 1 : pPos;
      const pa = prevAnswerByIdx.get(logicalIdx) || prevAnswerByIdx.get(pPos);
      if (!pq || !pa) return;
      if (pq.element && !isElementConnected(pq.element)) return;
      const t = typeof pq.text === 'string' ? pq.text.trim() : '';
      if ((pq.element && incomingElements.has(pq.element)) || (t && incomingTexts.has(t))) return;
      const newPos = mergedQuestions.length;
      mergedQuestions.push({ ...pq, index: newPos + 1 });
      mergedAnswers.push({ ...pa, questionIndex: newPos });
    });

    const nextAnswerByIdx = new Map();
    (Array.isArray(nextAnswers) ? nextAnswers : []).forEach(a => {
      if (a && typeof a.questionIndex === 'number') {
        nextAnswerByIdx.set(a.questionIndex, a);
      }
    });
    (Array.isArray(nextQuestions) ? nextQuestions : []).forEach((nq, nPos) => {
      const logicalIdx = (nq && typeof nq.index === 'number') ? nq.index - 1 : nPos;
      const na = nextAnswerByIdx.get(logicalIdx) || nextAnswerByIdx.get(nPos);
      const newPos = mergedQuestions.length;
      mergedQuestions.push(nq ? { ...nq, index: newPos + 1 } : nq);
      if (na) {
        mergedAnswers.push({ ...na, questionIndex: newPos });
      }
    });

    return { questions: mergedQuestions, answers: mergedAnswers };
  }

  async function applyHighlights(questions, answers, options = {}) {
    console.log('✨ Application des surlignages...');
    const prevData = (options && options.append === true && _storedHighlightData) ? _storedHighlightData : null;
    clearAllHighlights();
    const applyGen = _healGeneration;

    const merged = prevData
      ? buildAppendMergedState(prevData, questions, answers)
      : { questions, answers };
    const effectiveQuestions = merged.questions;
    const effectiveAnswers = merged.answers;

    const targetData = { questions: effectiveQuestions, answers: effectiveAnswers, options };
    _storedHighlightData = targetData;

    let highlightColor = (options && typeof options.color === 'string') ? options.color : '#00b4ff';
    try {
      if (typeof ConfigCache !== 'undefined' && ConfigCache) {
        if (typeof ConfigCache.isInitialized === 'function' && !ConfigCache.isInitialized() && typeof ConfigCache.init === 'function') {
          await ConfigCache.init();
        }
        const cachedColor = typeof ConfigCache.get === 'function' ? ConfigCache.get('highlightColor') : null;
        if (cachedColor && !(options && options.color)) {
          highlightColor = cachedColor;
        }
      }
    } catch (e) { /* use default */ }

    if (applyGen !== _healGeneration || _storedHighlightData !== targetData) {
      return 'CANCELLED';
    }

    targetData.color = highlightColor;

    const status = renderVisibleHighlights(effectiveQuestions, effectiveAnswers, highlightColor, options);
    if (status === 'NEEDS_HEAL') {
      await repairDeadNodes(effectiveAnswers, highlightColor);
      if (_storedHighlightData === targetData) {
        setupHighlightObservers();
      }
      return status;
    }

    if (_storedHighlightData === targetData) {
      setupHighlightObservers();
    }
    return status;
  }

  function getActiveBadges() {
    return Array.from(_badgeNodes);
  }

  function getFloatingButtons() {
    return Array.from(floatingButtons);
  }

  function getBadgeMetadata(badgeEl) {
    return _badgeMetadata.get(badgeEl) || null;
  }

  // Export HighlightManager API
  const HighlightManagerAPI = {
    applyHighlights,
    highlightQuestion,
    highlightOption,
    createConfidenceBadge,
    clearAllHighlights,
    setupHighlightObservers,
    renderVisibleHighlights,
    verifyAndRepair,
    isElementConnected,
    resolveConfidenceTier,
    resolveDiscretionLevel,
    getActiveBadges,
    getFloatingButtons,
    getBadgeMetadata,
    getStoredHighlightData,
    setStoredHighlightData,
    suspendObservers,
    resumeObservers,
    isOwnUiMutation,
    _styleTagId
  };

  rootWin.SafeExm.HighlightManager = HighlightManagerAPI;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HighlightManagerAPI;
  }
})();
