// highlight-manager.js - Safe Exm Highlight Manager (part of CRIT-01 refactoring)
/* global ConfigCache */
(function () {
  'use strict';

  // Initialize namespace
  window.SafeExm = window.SafeExm || {};

  // SEC-03 : WeakMap pour stocker les styles originaux SANS toucher au DOM.
  const _originalStyles = new WeakMap();

  // SEC-04 : Identifiant de session aléatoire pour la balise <style> injectée.
  const _styleTagId = `_s${Math.random().toString(36).slice(2, 9)}`;

  let highlights = [];
  let floatingButtons = [];
  let _storedHighlightData = null;
  let _intersectionObserver = null;
  let _mutationObserver = null;
  let _isHealing = false;

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
  }

  function suspendObservers() {
    if (_intersectionObserver) _intersectionObserver.disconnect();
    if (_mutationObserver) _mutationObserver.disconnect();
  }

  function resumeObservers() {
    if (!_storedHighlightData) return;
    const { questions } = _storedHighlightData;
    questions.forEach(q => {
      if (q.element) {
        if (_intersectionObserver) _intersectionObserver.observe(q.element);
        if (_mutationObserver) {
          try {
            _mutationObserver.observe(q.element, {
              attributes: true,
              attributeFilter: ['class', 'style', 'aria-hidden'],
              subtree: true
            });
          } catch (e) { /* element might be detached */ }
        }
      }
    });
  }

  function setupHighlightObservers() {
    clearObservers();

    if (!_storedHighlightData) {
      return;
    }
    const { questions, answers, color } = _storedHighlightData;

    _intersectionObserver = new IntersectionObserver((entries) => {
      let needsRedraw = false;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          needsRedraw = true;
          break;
        }
      }
      if (needsRedraw) {
        suspendObservers();
        const status = renderVisibleHighlights(questions, answers, color);
        if (status === 'NEEDS_HEAL') {
          repairDeadNodes(answers, color);
        } else {
          resumeObservers();
        }
      }
    }, { threshold: 0.05 });

    _mutationObserver = new MutationObserver(() => {
      suspendObservers();
      const status = renderVisibleHighlights(questions, answers, color);
      if (status === 'NEEDS_HEAL') {
        repairDeadNodes(answers, color);
      } else {
        resumeObservers();
      }
    });

    resumeObservers();
  }

  async function repairDeadNodes(answers, color) {
    if (_isHealing) return;
    _isHealing = true;
    suspendObservers();
    try {
      console.log('🔄 [Auto-Heal] Ré-extraction du DOM suite à une navigation SPA...');
      
      // Call DOMExtractor API
      if (!window.SafeExm.DOMExtractor) {
        throw new Error('DOMExtractor non disponible.');
      }
      const newData = await window.SafeExm.DOMExtractor.extractQuizData();
      
      if (newData && newData.questions.length > 0) {
        if (newData.questions.length === _storedHighlightData.questions.length) {
          _storedHighlightData.questions = newData.questions;
          console.log(`✅ [Auto-Heal] Nœuds rafraîchis avec succès !`);
          renderVisibleHighlights(newData.questions, answers, color);
        } else {
          console.warn(`⚠️ [Auto-Heal] Le nombre de questions a changé (${newData.questions.length} vs ${_storedHighlightData.questions.length})`);
          _storedHighlightData.questions = newData.questions;
          renderVisibleHighlights(newData.questions, answers, color);
        }
      }
    } catch(e) {
      console.error('❌ [Auto-Heal] Erreur:', e);
    } finally {
      _isHealing = false;
      resumeObservers();
    }
  }

  function highlightOption(option, color = '#00b4ff') {
    const element = option.labelElement || option.element?.parentElement || option.element;
    if (!element) {
      console.warn('⚠️ Élément à surligner non trouvé');
      return;
    }

    let discretion = 'furtif';
    try {
      if (typeof ConfigCache !== 'undefined' && ConfigCache.isInitialized()) {
        const cachedDiscr = ConfigCache.get('highlightDiscretion');
        if (cachedDiscr) {
          discretion = cachedDiscr;
        }
      }
    } catch (e) { /* use default */ }

    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);

    // SEC-03 : Sauvegarder les styles originaux dans le WeakMap
    if (!_originalStyles.has(element)) {
      _originalStyles.set(element, {
        outline: element.style.outline || '',
        boxShadow: element.style.boxShadow || '',
        position: element.style.position || '',
        backgroundColor: element.style.backgroundColor || '',
        borderLeft: element.style.borderLeft || ''
      });
    }

    if (discretion === 'ultra-furtif') {
      element.style.backgroundColor = 'rgba(77, 168, 218, 0.04)';
    } else if (discretion === 'furtif') {
      element.style.borderLeft = `3px solid ${color}`;
      element.style.backgroundColor = 'rgba(77, 168, 218, 0.02)';
    } else if (discretion === 'visible') {
      element.style.outline = `1.5px solid ${color}`;
      element.style.outlineOffset = '1px';
      element.style.backgroundColor = 'rgba(77, 168, 218, 0.02)';
    } else { // glow
      element.style.outline = `3px solid ${color}`;
      element.style.outlineOffset = '2px';
      element.style.boxShadow = `0 0 15px rgba(${r}, ${g}, ${b}, 0.6), 0 0 30px rgba(${r}, ${g}, ${b}, 0.3)`;
      element.classList.add(_styleTagId);
    }

    element.style.position = element.style.position || 'relative';
    highlights.push(element);

    // SEC-04 : Inject animation styles avec l'ID aléatoire
    if (!document.getElementById(_styleTagId)) {
      const style = document.createElement('style');
      style.id = _styleTagId;
      style.textContent = `
        .${_styleTagId} {
          animation: ${_styleTagId}-glow 2s ease-in-out infinite !important;
        }
        @keyframes ${_styleTagId}-glow {
          0%, 100% { outline-color: ${color}; }
          50% { outline-color: rgba(${r}, ${g}, ${b}, 0.4); }
        }
        @keyframes ${_styleTagId}-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  function createFloatingButton(inputElement, textAnswer, overrideColor = null) {
    if (!window.SafeExm.DOMExtractor || !window.SafeExm.DOMExtractor.isElementVisible(inputElement)) return;

    let discretion = 'furtif';
    let color = '#4DA8DA';
    try {
      if (typeof ConfigCache !== 'undefined' && ConfigCache.isInitialized()) {
        const cachedDiscr = ConfigCache.get('highlightDiscretion');
        if (cachedDiscr) discretion = cachedDiscr;
        const cachedColor = ConfigCache.get('highlightColor');
        if (cachedColor) color = cachedColor;
        if (overrideColor) color = overrideColor;
      }
    } catch (e) {}

    if (discretion === 'ultra-furtif') return;

    const button = document.createElement('div');
    button.className = 'quiz-helper-float-button';
    button.innerHTML = '✨';
    button.title = 'Cliquer pour insérer la réponse';

    const rect = inputElement.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    if (discretion === 'furtif') {
      button.classList.add('discreet');
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
      button.classList.add('visible-mode');
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
      button.classList.add(_styleTagId);
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

    button.addEventListener('click', () => {
      inputElement.value = textAnswer;
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));

      button.style.background = '#6BCB77';
      button.style.color = '#000';
      button.innerHTML = '✓';

      setTimeout(() => {
        if (discretion === 'furtif') {
          button.style.background = '#172A3A';
          button.style.color = 'rgba(255, 255, 255, 0.6)';
          button.innerHTML = '✨';
        } else if (discretion === 'visible') {
          button.style.background = color;
          button.style.color = '#000';
          button.innerHTML = '✨';
        } else {
          button.style.background = 'linear-gradient(135deg, #00d4ff 0%, #7b2cbf 100%)';
          button.style.color = 'white';
          button.innerHTML = '✨';
        }
      }, 1500);
    });

    document.body.appendChild(button);
    floatingButtons.push(button);
  }

  function renderVisibleHighlights(questions, answers, color) {
    // Désactiver temporairement les observateurs pour éviter une boucle de mutation infinie
    const tempMO = _mutationObserver;
    const tempIO = _intersectionObserver;
    if (tempMO) tempMO.disconnect();
    if (tempIO) tempIO.disconnect();

    try {
      // Nettoyer les styles avant de redessiner via WeakMap (SEC-03)
      highlights.forEach(el => {
        if (el && _originalStyles.has(el)) {
          const orig = _originalStyles.get(el);
          el.style.outline = orig.outline;
          el.style.outlineOffset = '';
          el.style.boxShadow = orig.boxShadow;
          el.style.position = orig.position;
          el.style.backgroundColor = orig.backgroundColor;
          el.style.borderLeft = orig.borderLeft;
          el.classList.remove(_styleTagId);
          _originalStyles.delete(el);
        }
      });
      floatingButtons.forEach(b => b.remove());
      highlights = [];
      floatingButtons = [];

      const answersMap = new Map();
      answers.forEach(ans => {
        answersMap.set(ans.questionIndex, ans);
      });

      if (!window.SafeExm.DOMExtractor) return 'OK';

      for (let idx = 0; idx < questions.length; idx++) {
        const question = questions[idx];
        const answer = answersMap.get(idx);
        if (!answer) {
          continue;
        }

        // Check visibility via DOMExtractor
        const isVisible = window.SafeExm.DOMExtractor.isElementVisible(question.element);
        if (!isVisible) {
          continue;
        }

        // 🚨 AUTO-HEAL CHECK 🚨
        if (question.options && question.options.length > 0) {
          const sampleElement = question.options[0].element;
          if (sampleElement && !document.body.contains(sampleElement)) {
            console.warn(`⚠️ [Auto-Heal] Nœuds morts détectés pour Q${idx + 1} (SPA Re-render)`);
            return 'NEEDS_HEAL';
          }
        } else if (question.inputElement && !document.body.contains(question.inputElement)) {
          console.warn(`⚠️ [Auto-Heal] Champ texte mort pour Q${idx + 1}`);
          return 'NEEDS_HEAL';
        }

        // Déterminer la couleur active en fonction du score de confiance
        let activeColor = color;
        if (answer && typeof answer.confidence === 'number') {
          if (answer.confidence >= 80) {
            activeColor = '#22c55e'; // Vert pour confiance haute
          } else if (answer.confidence >= 40) {
            activeColor = '#f59e0b'; // Orange pour confiance moyenne
          } else {
            activeColor = '#ef4444'; // Rouge pour confiance faible
          }
        }

        if (question.type === 'radio' || question.type === 'checkbox') {
          for (const optIdx of answer.optionIndices) {
            const option = question.options[optIdx];
            if (option) {
              const visualElement = option.labelElement || option.element?.parentElement || option.element;
              if (window.SafeExm.DOMExtractor.isElementVisible(visualElement)) {
                highlightOption(option, activeColor);
              }
            }
          }
        } else if (question.type === 'text' && question.inputElement) {
          if (window.SafeExm.DOMExtractor.isElementVisible(question.inputElement)) {
            const textAnswer = answer.textAnswer || answer.raw;
            createFloatingButton(question.inputElement, textAnswer, activeColor);
          }
        }
      }

      return 'OK';
    } finally {
      // Réactiver les observateurs
      if (tempMO && questions) {
        questions.forEach(q => {
          if (q.element) {
            try {
              tempMO.observe(q.element, {
                attributes: true,
                attributeFilter: ['class', 'style', 'aria-hidden'],
                subtree: true
              });
            } catch (e) { /* detached */ }
          }
        });
      }
      if (tempIO && questions) {
        questions.forEach(q => {
          if (q.element) {
            try {
              tempIO.observe(q.element);
            } catch (e) { /* detached */ }
          }
        });
      }
    }
  }

  function clearAllHighlights() {
    console.log('🧹 Nettoyage des surlignages...');
    highlights.forEach(el => {
      if (el && _originalStyles.has(el)) {
        const orig = _originalStyles.get(el);
        el.style.outline = orig.outline;
        el.style.outlineOffset = '';
        el.style.boxShadow = orig.boxShadow;
        el.style.position = orig.position;
        el.style.backgroundColor = orig.backgroundColor;
        el.style.borderLeft = orig.borderLeft;
        el.classList.remove(_styleTagId);
        _originalStyles.delete(el);
      } else if (el && el.remove) {
        el.remove();
      }
    });
    floatingButtons.forEach(b => b.remove());
    highlights = [];
    floatingButtons = [];
    _storedHighlightData = null;
    clearObservers();

    const styleEl = document.getElementById(_styleTagId);
    if (styleEl) {
      styleEl.remove();
    }
  }

  async function applyHighlights(questions, answers) {
    console.log('✨ Application des surlignages...');
    clearAllHighlights();

    _storedHighlightData = { questions, answers };

    let highlightColor = '#00b4ff';
    try {
      if (!ConfigCache.isInitialized()) {
        await ConfigCache.init();
      }
      const cachedColor = ConfigCache.get('highlightColor');
      if (cachedColor) {
        highlightColor = cachedColor;
      }
    } catch (e) { /* use default */ }

    _storedHighlightData.color = highlightColor;

    const status = renderVisibleHighlights(questions, answers, highlightColor);
    if (status === 'NEEDS_HEAL') {
      repairDeadNodes(answers, highlightColor);
    }

    setupHighlightObservers();
  }

  // Export HighlightManager API
  window.SafeExm.HighlightManager = {
    applyHighlights,
    clearAllHighlights,
    setupHighlightObservers,
    getStoredHighlightData,
    setStoredHighlightData,
    suspendObservers,
    resumeObservers,
    _styleTagId
  };
})();
