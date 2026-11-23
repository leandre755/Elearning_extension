// Loader Script - Quiz Helper AI
/* global WeakSet */
(async function () {
  'use strict';

  const QUIZ_SELECTORS_CSS = '.quiz, .quiz-container, .question-container, [class*="quiz"], [class*="question"], .assessment';
  const QUIZ_URL_KEYWORDS = ['quiz', 'exam', 'assessment', 'test-', '/test/', 'questionnaire', 'qcm'];
  const MAX_SHADOW_DEPTH = 8;
  const MAX_SHADOW_WALK_NODES = 1500;

  function matchesQuizUrl(urlStr) {
    if (typeof urlStr !== 'string' || !urlStr) return false;
    const urlLower = urlStr.toLowerCase();
    return QUIZ_URL_KEYWORDS.some((kw) => urlLower.includes(kw));
  }

  function hasQuizInRoot(root, isQuizUrl) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return { matched: false, qcmCount: 0 };
    }
    const qcmInputs = root.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    const qcmCount = qcmInputs ? qcmInputs.length : 0;
    if (qcmCount >= 2) {
      return { matched: true, qcmCount };
    }
    if (isQuizUrl) {
      const formElements = root.querySelectorAll('input, textarea, button');
      if (formElements && formElements.length > 0) {
        return { matched: true, qcmCount };
      }
    }
    if (typeof root.querySelector === 'function' && root.querySelector(QUIZ_SELECTORS_CSS)) {
      return { matched: true, qcmCount };
    }
    return { matched: false, qcmCount };
  }

  function resolveHostname(href, fallbackWin) {
    if (typeof href === 'string' && href) {
      try {
        return new URL(href).hostname.toLowerCase();
      } catch {
        // fallback to window.location if relative or unparseable
      }
    }
    if (fallbackWin && fallbackWin.location && typeof fallbackWin.location.hostname === 'string') {
      return fallbackWin.location.hostname.toLowerCase();
    }
    return '';
  }

  /**
   * Detect quiz-like DOM structures in light DOM and bounded nested open Shadow DOMs.
   * @param {Document} [rootDoc]
   * @param {string} [href]
   * @returns {boolean}
   */
  function hasInteractiveContent(rootDoc, href) {
    const winRef = typeof window !== 'undefined' ? window : null;
    const targetDoc = rootDoc || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc) return false;

    const currentHref = typeof href === 'string'
      ? href
      : (winRef && winRef.location && typeof winRef.location.href === 'string' ? winRef.location.href : '');
    if (resolveHostname(currentHref, winRef).includes('quizgecko.com')) {
      return true;
    }

    const isQuizUrl = matchesQuizUrl(currentHref);
    const lightCheck = hasQuizInRoot(targetDoc, isQuizUrl);
    if (lightCheck.matched) {
      return true;
    }

    let accumulatedQcm = lightCheck.qcmCount;
    const visitedNodes = new WeakSet();
    const visitedRoots = new WeakSet();
    const startNode = targetDoc.body || targetDoc.documentElement || targetDoc;
    if (!startNode || typeof startNode !== 'object') {
      return false;
    }

    const queue = [{ node: startNode, depth: 0 }];
    let inspectedNodes = 0;

    while (queue.length > 0 && inspectedNodes < MAX_SHADOW_WALK_NODES) {
      const { node, depth } = queue.shift();
      if (!node || typeof node !== 'object' || visitedNodes.has(node)) {
        continue;
      }
      visitedNodes.add(node);
      inspectedNodes++;

      if (node.shadowRoot && typeof node.shadowRoot === 'object' && depth < MAX_SHADOW_DEPTH) {
        const sr = node.shadowRoot;
        if (!visitedRoots.has(sr)) {
          visitedRoots.add(sr);
          const shadowCheck = hasQuizInRoot(sr, isQuizUrl);
          if (shadowCheck.matched) {
            return true;
          }
          accumulatedQcm += shadowCheck.qcmCount;
          if (accumulatedQcm >= 2) {
            return true;
          }
          const shadowChildren = sr.children;
          if (shadowChildren && typeof shadowChildren.length === 'number') {
            for (let i = 0; i < shadowChildren.length; i++) {
              const ch = shadowChildren[i];
              if (ch && typeof ch === 'object' && !visitedNodes.has(ch)) {
                queue.push({ node: ch, depth: depth + 1 });
              }
            }
          }
        }
      }

      const children = node.children;
      if (children && typeof children.length === 'number') {
        for (let i = 0; i < children.length; i++) {
          const ch = children[i];
          if (ch && typeof ch === 'object' && !visitedNodes.has(ch)) {
            queue.push({ node: ch, depth });
          }
        }
      }
    }

    return false;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { hasInteractiveContent };
  }

  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    return;
  }

  if (window.__quizHelperLoaderActive || window.__quizHelperLoaded) {
    return;
  }
  window.__quizHelperLoaderActive = true;

  const hostname = window.location.hostname.replace(/^www\./, '').toLowerCase();
  const storageKey = `schema_${hostname}`;

  try {
    const cacheResult = await chrome.storage.local.get([storageKey]);
    const hasCachedSchema = cacheResult[storageKey] && cacheResult[storageKey].schema;

    if (hasCachedSchema || hasInteractiveContent(document, window.location.href)) {
      console.log('🧠 Quiz Helper - Quiz potentiel détecté, chargement des modules...');
      chrome.runtime.sendMessage({ action: 'injectCoreScripts' });
    }
  } catch (e) {
    console.warn('⚠️ Quiz Helper Loader error:', e.message);
  }
})();
