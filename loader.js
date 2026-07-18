// Loader Script - Quiz Helper AI
(async function () {
  'use strict';

  if (window.__quizHelperLoaderActive || window.__quizHelperLoaded) {
    return;
  }
  window.__quizHelperLoaderActive = true;

  const hostname = window.location.hostname.replace(/^www\./, '').toLowerCase();
  const storageKey = `schema_${hostname}`;

  function hasInteractiveContent() {
    if (window.location.hostname.includes('quizgecko.com')) {
      return true;
    }

    // Critère 1 : Présence d'éléments QCM typiques (au moins 2 radio ou checkbox)
    const qcmInputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    if (qcmInputs.length >= 2) {
      return true;
    }

    // Critère 2 : URL contenant des mots-clés d'évaluation
    const urlLower = window.location.href.toLowerCase();
    const isQuizUrl = urlLower.includes('quiz') || 
                      urlLower.includes('exam') || 
                      urlLower.includes('assessment') || 
                      urlLower.includes('test-') || 
                      urlLower.includes('/test/') || 
                      urlLower.includes('questionnaire') || 
                      urlLower.includes('qcm');
    
    if (isQuizUrl) {
      // Pour confirmer l'URL, on s'assure qu'il y a au moins un élément interactif de formulaire/bouton
      const hasFormElements = document.querySelectorAll('input, textarea, button').length > 0;
      if (hasFormElements) return true;
    }

    // Critère 3 : Sélecteurs sémantiques forts dans le DOM
    const hasSemanticQuiz = document.querySelector(
      '.quiz, .quiz-container, .question-container, [class*="quiz"], [class*="question"], .assessment'
    );
    if (hasSemanticQuiz) {
      return true;
    }

    return false;
  }

  try {
    const cacheResult = await chrome.storage.local.get([storageKey]);
    const hasCachedSchema = cacheResult[storageKey] && cacheResult[storageKey].schema;

    if (hasCachedSchema || hasInteractiveContent()) {
      console.log('🧠 Quiz Helper - Quiz potentiel détecté, chargement des modules...');
      chrome.runtime.sendMessage({ action: 'injectCoreScripts' });
    }
  } catch (e) {
    console.warn('⚠️ Quiz Helper Loader error:', e.message);
  }
})();
