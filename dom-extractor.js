// dom-extractor.js - Safe Exm Quiz Extractor (part of CRIT-01 refactoring)
/* global ConfigCache, SchemaCache, SchemaDetector */
(function () {
  'use strict';

  // Initialize namespace
  window.SafeExm = window.SafeExm || {};

  const QUIZ_SELECTORS = {
    quizContainer: [
      '.quiz', '.quiz-container', '.question-container',
      '[class*="quiz"]', '[class*="question"]', '[data-quiz]',
      '.assessment', '.test-container', 'form[class*="quiz"]',
      '.quiz-form', '#quizForm'
    ],
    question: [
      '.question', '.question-text', '.quiz-question',
      '[class*="question-title"]', '.q-text', 'legend',
      '.question-content', '[class*="questionText"]',
      '.question-card h3', '.question-card .question-text h3'
    ],
    answerOption: [
      'input[type="radio"]', 'input[type="checkbox"]',
      '.answer-option', '.quiz-option', '.choice',
      '[class*="answer"]', '[class*="option"]'
    ],
    answerLabel: [
      'label', '.answer-text', '.option-text',
      '[class*="answer-label"]', '.choice-text', '.option'
    ],
    textInput: [
      'input[type="text"].text-answer', 'textarea.text-answer',
      'input[type="text"]', 'textarea',
      '.answer-input input', '.answer-input textarea'
    ],
    questionNumber: [
      '.question-number', '.q-number', '[class*="questionNum"]',
      '.question-index', 'span.number'
    ]
  };

  const ImageCapture = {
    MIN_SIZE: 50,       // Ignore images smaller than 50px
    MAX_DATA_SIZE: 5 * 1024 * 1024, // 5MB max per image
    QUALITY: 0.8,       // JPEG compression quality

    /**
     * Capture all images within a DOM container.
     * Returns array of { dataUrl, mimeType, width, height, source }
     */
    async captureAllImages(container) {
      const images = [];
      if (!container) {
        return images;
      }

      // Load settings from ConfigCache
      try {
        if (!ConfigCache.isInitialized()) {
          await ConfigCache.init();
        }
        if (ConfigCache.get('captureImages') === false) {
          return images;
        }
        const minSize = ConfigCache.get('imageMinSize');
        if (minSize) {
          this.MIN_SIZE = minSize;
        }
        const quality = ConfigCache.get('imageQuality');
        if (quality) {
          this.QUALITY = quality;
        }
      } catch (e) { /* use defaults */ }

      const capturePromises = [];

      // 1. Standard <img> tags
      const imgElements = container.querySelectorAll('img');
      imgElements.forEach(img => {
        capturePromises.push(this.captureImgElement(img));
      });

      // 2. CSS background-image
      const allElements = container.querySelectorAll('*');
      allElements.forEach(el => {
        const bgImg = window.getComputedStyle(el).backgroundImage;
        if (bgImg && bgImg !== 'none' && bgImg.startsWith('url(')) {
          capturePromises.push(this.captureBgImage(bgImg));
        }
      });

      // Execute captures in parallel
      const results = await Promise.all(capturePromises);
      return results.filter(img => img !== null);
    },

    async captureImgElement(img) {
      if (img.naturalWidth > 0 && img.naturalWidth < this.MIN_SIZE) return null;
      if (img.width > 0 && img.width < this.MIN_SIZE) return null;

      try {
        if (img.src.startsWith('data:')) {
          return { dataUrl: img.src, mimeType: this.getMimeType(img.src), width: img.naturalWidth, height: img.naturalHeight, source: 'img-tag-base64' };
        }

        // Use Proxy to fetch third-party images and bypass CORS restrictions
        const proxyData = await this.fetchImageViaProxy(img.src);
        if (proxyData) {
          return { dataUrl: proxyData.dataUrl, mimeType: proxyData.mimeType, width: img.naturalWidth || 100, height: img.naturalHeight || 100, source: 'img-tag-proxy' };
        }

        return await this.canvasRender(img);
      } catch (e) {
        console.warn('⚠️ ImageCapture.captureImgElement failed:', e.message);
        return null;
      }
    },

    async captureBgImage(bgImgProperty) {
      const match = bgImgProperty.match(/^url\((['"]?)(.*)\1\)$/);
      if (!match) return null;
      const url = match[2];

      try {
        if (url.startsWith('data:')) {
          return { dataUrl: url, mimeType: this.getMimeType(url), width: 100, height: 100, source: 'bg-style-base64' };
        }

        const proxyData = await this.fetchImageViaProxy(url);
        if (proxyData) {
          return { dataUrl: proxyData.dataUrl, mimeType: proxyData.mimeType, width: 100, height: 100, source: 'bg-style-proxy' };
        }

        return new Promise((resolve) => {
          const tempImg = new Image();
          tempImg.crossOrigin = 'anonymous';
          tempImg.onload = async () => {
            if (tempImg.naturalWidth < this.MIN_SIZE) {
              return resolve(null);
            }
            const res = await this.canvasRender(tempImg).catch(() => null);
            resolve(res);
          };
          tempImg.onerror = () => resolve(null);
          tempImg.src = url;
        });
      } catch (e) {
        console.warn('⚠️ ImageCapture.captureBgImage failed:', e.message);
        return null;
      }
    },

    fetchImageViaProxy(url) {
      // Règle 8.5 : assertions de préconditions
      if (typeof url !== 'string' || !url) {
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'fetchImage', url }, (response) => {
          if (chrome.runtime.lastError || !response || !response.success) {
            resolve(null);
          } else {
            resolve(response);
          }
        });
      });
    },

    canvasRender(imgElement) {
      // Règle 8.5 : assertions de préconditions
      if (!imgElement || typeof imgElement !== 'object') {
        return Promise.reject(new Error('ImageCapture.canvasRender: imgElement invalide.'));
      }
      return new Promise((resolve, reject) => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const width = imgElement.naturalWidth || imgElement.width || 100;
          const height = imgElement.naturalHeight || imgElement.height || 100;

          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(imgElement, 0, 0, width, height);

          const dataUrl = canvas.toDataURL('image/jpeg', this.QUALITY);
          if (dataUrl.length > this.MAX_DATA_SIZE) {
            return reject(new Error('Image trop volumineuse après rendu canvas.'));
          }

          resolve({ dataUrl, mimeType: 'image/jpeg', width, height, source: 'canvas-render' });
        } catch (e) {
          reject(e);
        }
      });
    },

    getMimeType(base64Url) {
      const match = base64Url.match(/data:([^;]+);/);
      return match ? match[1] : 'image/jpeg';
    }
  };

  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }
    return true;
  }

  function cleanText(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/\s+/g, ' ')
      .replace(/[\r\n]+/g, ' ')
      .trim();
  }

  async function extractQuestionFromCard(card, index) {
    const questionData = {
      index: index + 1,
      element: card,
      text: '',
      type: 'unknown',
      options: [],
      inputElement: null,
      images: []
    };

    // Extract question text
    const questionText = card.querySelector('.question-text h3, .question-text, h3');
    if (questionText) {
      questionData.text = questionText.innerText.trim();
    }

    console.log(`📝 Q${index + 1}: "${questionData.text.substring(0, 50)}..."`);

    // Capture images within this card
    questionData.images = await ImageCapture.captureAllImages(card);
    if (questionData.images.length > 0) {
      console.log(`   📸 ${questionData.images.length} image(s) capturée(s)`);
    }

    // Look for radio/checkbox options
    const inputs = card.querySelectorAll('input[type="radio"], input[type="checkbox"]');

    if (inputs.length > 0) {
      questionData.type = inputs[0].type;

      inputs.forEach((input, idx) => {
        const label = input.closest('label') ||
          input.parentElement.querySelector('.option-text') ||
          input.nextElementSibling;

        const optionText = label ?
          (label.querySelector('.option-text')?.innerText || label.innerText || '').trim() :
          `Option ${idx + 1}`;

        questionData.options.push({
          index: idx,
          element: input,
          labelElement: input.closest('label') || input.parentElement,
          text: optionText.replace(/^\s*/, ''),
          value: input.value
        });
      });

      console.log(`   Type: ${questionData.type}, Options: ${questionData.options.length}`);
    } else {
      // Look for text input
      const textInput = card.querySelector('input[type="text"], textarea');
      if (textInput) {
        questionData.type = 'text';
        questionData.inputElement = textInput;
        console.log(`   Type: text input`);
      }
    }

    return (questionData.text && (questionData.options.length > 0 || questionData.inputElement || questionData.images.length > 0))
      ? questionData : null;
  }

  async function extractQuestionGeneric(element, index) {
    const questionData = {
      index: index + 1,
      element: element,
      text: element.innerText?.trim() || '',
      type: 'unknown',
      options: [],
      inputElement: null,
      images: []
    };

    const parent = element.closest('form') || element.closest('div') || element.parentElement;

    // Capture images
    questionData.images = await ImageCapture.captureAllImages(parent);

    const inputs = parent.querySelectorAll('input[type="radio"], input[type="checkbox"]');

    if (inputs.length > 0) {
      questionData.type = inputs[0].type;
      inputs.forEach((input, idx) => {
        const label = document.querySelector(`label[for="${input.id}"]`) ||
          input.closest('label') ||
          input.parentElement;
        questionData.options.push({
          index: idx,
          element: input,
          labelElement: label,
          text: label?.innerText?.trim() || `Option ${idx + 1}`,
          value: input.value
        });
      });
    } else {
      const textInput = parent.querySelector('input[type="text"], textarea');
      if (textInput) {
        questionData.type = 'text';
        questionData.inputElement = textInput;
      }
    }

    return (questionData.text && (questionData.options.length > 0 || questionData.inputElement || questionData.images.length > 0))
      ? questionData : null;
  }

  async function extractQuizData() {
    console.log('📡 Phase 1: Détection via sélecteurs connus...');
    const questions = [];
    let totalImages = 0;

    // Try question cards first
    const questionCards = document.querySelectorAll('.question-card');
    console.log('🔍 Question cards trouvées:', questionCards.length);

    if (questionCards.length > 0) {
      for (let index = 0; index < questionCards.length; index++) {
        const card = questionCards[index];
        const questionData = await extractQuestionFromCard(card, index);
        if (questionData) {
          totalImages += questionData.images.length;
          questions.push(questionData);
        }
      }
    } else {
      // Fallback: generic question extraction
      const questionElements = document.querySelectorAll(QUIZ_SELECTORS.question.join(','));
      console.log('🔍 Questions génériques trouvées:', questionElements.length);

      for (let index = 0; index < questionElements.length; index++) {
        const el = questionElements[index];
        const questionData = await extractQuestionGeneric(el, index);
        if (questionData) {
          totalImages += questionData.images.length;
          questions.push(questionData);
        }
      }
    }

    // If Phase 1 found questions, return immediately
    if (questions.length > 0) {
      console.log(`✅ Phase 1: ${questions.length} questions trouvées via sélecteurs connus`);
      return { questions, totalImages };
    }

    // Phase 2: Cache de schéma (domaine déjà analysé ?)
    if (typeof SchemaCache !== 'undefined' && typeof SchemaDetector !== 'undefined') {
      console.log('📡 Phase 2: Recherche de schéma en cache...');
      const hostname = window.location.hostname;

      try {
        const cachedSchema = await SchemaCache.getCachedSchema(hostname);

        if (cachedSchema) {
          console.log(`✅ Phase 2: Schéma trouvé en cache pour ${hostname} (${cachedSchema.platform})`);
          const schemaResult = await SchemaDetector.applySchema(cachedSchema);

          if (schemaResult.questions.length > 0) {
            console.log(`✅ Phase 2: ${schemaResult.questions.length} questions extraites via schéma en cache`);
            return schemaResult;
          } else {
            console.warn('⚠️ Phase 2: Schéma en cache mais aucune question extraite — schéma peut-être obsolète');
          }
        } else {
          console.log(`ℹ️ Phase 2: Aucun schéma en cache pour ${hostname}`);
        }

        // Phase 3: Découverte LLM (première visite)
        console.log('📡 Phase 3: Lancement de la découverte LLM...');
        const discoveredSchema = await SchemaDetector.discoverSchema(true); // force=true: l'utilisateur a demandé l'analyse

        if (discoveredSchema) {
          // Save the schema permanently
          await SchemaCache.saveSchema(hostname, discoveredSchema);
          console.log(`💾 Phase 3: SchemaMap sauvegardé pour ${hostname}`);

          // Apply the discovered schema
          const discoveryResult = await SchemaDetector.applySchema(discoveredSchema);
          if (discoveryResult.questions.length > 0) {
            console.log(`✅ Phase 3: ${discoveryResult.questions.length} questions extraites via découverte LLM`);
            return discoveryResult;
          }
        } else {
          console.log('ℹ️ Phase 3: La découverte LLM n\'a pas trouvé de quiz');
        }
      } catch (adaptiveError) {
        console.error('❌ Erreur dans le pipeline adaptatif:', adaptiveError.message);
      }
    } else {
      console.log('ℹ️ SchemaDetector/SchemaCache non disponible — skip phases 2 & 3');
    }

    console.log(`📋 Total: ${questions.length} questions, ${totalImages} images`);
    return { questions, totalImages };
  }

  // Export DOMExtractor API
  window.SafeExm.DOMExtractor = {
    QUIZ_SELECTORS,
    ImageCapture,
    isElementVisible,
    cleanText,
    extractQuizData
  };
})();
