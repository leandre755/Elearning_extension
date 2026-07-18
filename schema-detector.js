// ============================================================
// schema-detector.js — LLM-Powered DOM Analysis & Schema Discovery
// ============================================================

const SchemaDetector = (() => {
  'use strict';

  // Tags to fully ignore when building the skeleton
  const IGNORE_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'HEAD',
    'SVG', 'PATH', 'CIRCLE', 'RECT', 'LINE', 'POLYGON',
    'BR', 'HR', 'WBR', 'IFRAME', 'OBJECT', 'EMBED',
    'AUDIO', 'VIDEO', 'SOURCE', 'TRACK'
  ]);

  // Structural tags that are never quiz content containers
  const SKIP_CONTAINERS = new Set([
    'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'MENU', 'MENUITEM'
  ]);

  // Max depth for DOM traversal
  const MAX_DEPTH = 15;

  // Max nodes in skeleton (to keep LLM payload small)
  const MAX_SKELETON_NODES = 500;

  // ──────────────────────────────────────────────
  // DOM SKELETON BUILDER
  // ──────────────────────────────────────────────

  /**
   * Build a lightweight DOM skeleton for LLM analysis.
   * Only includes structure-relevant attributes (tag, class, id, input type).
   * Filters out non-interactive branches to keep size small.
   *
   * @returns {string} Compact text representation of the DOM
   */
  function buildDOMSkeleton() {
    const body = document.body;
    if (!body) return '';

    let nodeCount = 0;
    const lines = [];

    function walk(node, depth) {
      if (nodeCount >= MAX_SKELETON_NODES) return;
      if (depth > MAX_DEPTH) return;
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName;

      // Skip ignored tags entirely
      if (IGNORE_TAGS.has(tag)) return;

      // Skip structural containers that are never quiz content
      if (SKIP_CONTAINERS.has(tag) && depth < 4) return;

      // Skip hidden elements
      if (node.hidden || node.style?.display === 'none') return;
      // Check aria-hidden
      if (node.getAttribute('aria-hidden') === 'true') return;

      // Build compact descriptor
      const attrs = [];
      if (node.id) attrs.push(`#${node.id}`);
      if (node.className && typeof node.className === 'string') {
        const classes = node.className.trim().split(/\s+/).slice(0, 5).join('.');
        if (classes) attrs.push(`.${classes}`);
      }
      if (tag === 'INPUT') {
        const type = node.getAttribute('type') || 'text';
        attrs.push(`[type=${type}]`);
        if (node.name) attrs.push(`[name=${node.name}]`);
      }
      if (tag === 'TEXTAREA') {
        if (node.name) attrs.push(`[name=${node.name}]`);
      }
      if (tag === 'SELECT') {
        const optCount = node.querySelectorAll('option').length;
        attrs.push(`[options=${optCount}]`);
      }
      // Note click handlers and cursor style (custom quiz elements)
      if (node.onclick || node.getAttribute('role') === 'button' || node.getAttribute('role') === 'option') {
        attrs.push(`[clickable]`);
      }
      // Note data attributes that hint at quiz content
      for (const attr of node.attributes) {
        if (attr.name.startsWith('data-') && attr.name.length < 30) {
          attrs.push(`[${attr.name}=${attr.value.substring(0, 20)}]`);
        }
      }
      // Note if element has meaningful text content
      const directText = getDirectTextContent(node);
      if (directText.length > 3) {
        let cleanText = directText.substring(0, 40).replace(/["\n\r]/g, '');
        // Identify utility buttons visually so LLM ignores them as options
        const lowerText = cleanText.toLowerCase();
        if (lowerText.includes('copy') || lowerText.includes('copier') || 
            lowerText.includes('next') || lowerText.includes('suivant') ||
            lowerText.includes('prev') || lowerText.includes('précédent') ||
            lowerText.includes('submit') || lowerText.includes('soumettre') ||
            lowerText.includes('report') || lowerText.includes('signaler')) {
           attrs.push(`[utility-btn]`);
        }
        attrs.push(`{text:"${cleanText}"}`);
      }

      const indent = '  '.repeat(depth);
      const attrStr = attrs.length > 0 ? attrs.join('') : '';
      lines.push(`${indent}<${tag.toLowerCase()}${attrStr}>`);
      nodeCount++;

      // Recurse into children
      for (const child of node.children) {
        walk(child, depth + 1);
      }
    }

    walk(body, 0);

    console.log(`🦴 DOM Skeleton: ${nodeCount} nœuds, ${lines.join('\n').length} caractères`);
    return lines.join('\n');
  }

  /**
   * Get the direct text content of a node (excluding children's text).
   */
  function getDirectTextContent(node) {
    let text = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      }
    }
    return text.trim();
  }

  /**
   * Broad check: does the page have ANY content that could be a quiz?
   * Checks for standard inputs, but also for typical quiz-like patterns
   * (repeated clickable elements, ordered lists of options, etc.)
   */
  function hasInteractiveContent() {
    // Explicit whitelist for known tricky platforms (like Quizgecko SPAs)
    if (window.location.hostname.includes('quizgecko.com')) return true;

    // Standard HTML inputs
    const standardInputs = document.querySelectorAll(
      'input[type="radio"], input[type="checkbox"], select, textarea, input[type="text"]'
    );
    if (standardInputs.length >= 2) return true;

    // Custom clickable elements — common in modern quiz platforms
    // Look for repeated sibling elements that look like options (buttons, cards, etc.)
    const buttons = document.querySelectorAll('button, [role="button"], [role="option"], [role="radio"]');
    if (buttons.length >= 3) return true;

    // Look for elements with data attributes suggesting quiz structure
    const quizHints = document.querySelectorAll(
      '[data-answer], [data-option], [data-question], [data-choice], [data-correct], [data-quiz], [data-test]'
    );
    if (quizHints.length >= 1) return true;

    // Look for any question-mark text patterns in headings/paragraphs
    const textElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, legend');
    let questionCount = 0;
    for (const el of textElements) {
      const text = el.textContent || '';
      if (text.includes('?') && text.length > 10 && text.length < 500) {
        questionCount++;
      }
    }
    if (questionCount >= 1) return true;

    // Look for repeated list-like structures that resemble options
    const listItems = document.querySelectorAll('li, [class*="option"], [class*="answer"], [class*="choice"]');
    if (listItems.length >= 3) return true;

    return false;
  }

  // ──────────────────────────────────────────────
  // DISCOVERY PROMPT
  // ──────────────────────────────────────────────

  /**
   * Build the specialized prompt for SchemaMap discovery.
   */
  function buildDiscoveryPrompt(skeleton) {
    return `Tu es un expert en analyse de structures HTML de plateformes e-learning et de quiz en ligne.

Analyse ce DOM simplifié (squelette) et identifie les sélecteurs CSS nécessaires pour extraire les éléments d'un quiz.

SQUELETTE DOM DE LA PAGE:
\`\`\`
${skeleton}
\`\`\`

CONTEXTE:
- L'URL est: ${window.location.href}
- Le titre de la page est: ${document.title}
- La page contient: ${document.querySelectorAll('input[type="radio"]').length} radios, ${document.querySelectorAll('input[type="checkbox"]').length} checkboxes, ${document.querySelectorAll('textarea, input[type="text"]').length} champs texte, ${document.querySelectorAll('button, [role="button"]').length} boutons

INSTRUCTIONS CRITIQUES:
1. Identifie le pattern de répétition qui représente les questions du quiz.
2. Pour chaque question, trouve le sélecteur du texte de la question et le sélecteur des options de réponse.
3. Les sélecteurs doivent être relatifs au conteneur de question et très robustes (utilise les classes structurelles plutôt que des IDs dynamiques).
4. Si la plateforme est connue (Moodle, Canvas, Google Forms, etc.), indique-le.
5. 🚨 ATTENTION AUX FAUX POSITIFS : Ne sélectionne JAMAIS de boutons utilitaires marqués [utility-btn] (comme "Copy", "Next", "Submit") comme étant des options de réponse (optionItems) ! Les options sont les choix (A, B, C, Vrai/Faux, etc.).
6. Dans les quiz modernes, les options ne sont pas toujours des <input>. Elles peuvent être de simples <div>, <li> ou <span> cliquables. Analyse bien le texte "{text:...}" pour comprendre si c'est une option de réponse.

Retourne UNIQUEMENT un objet JSON STRICT avec ces champs (utilise null si introuvable) :
{
  "platform": "Nom de la plateforme détectée ou 'Inconnue'",
  "confidence": 0.0 à 1.0,
  "questionContainer": "sélecteur CSS du conteneur répété de chaque question (ou de la page entière si une seule question)",
  "questionText": "sélecteur CSS du texte de la question (relatif au container)",
  "optionsContainer": "sélecteur CSS du conteneur des options (relatif au container, ou null)",
  "optionItems": "sélecteur CSS de chaque item d'option individuel (relatif au container). PEUT être un div/button/li cliquable, pas forcément un input!",
  "optionInput": "sélecteur CSS de l'input radio/checkbox SI il existe (sinon null — quiz custom)",
  "optionLabel": "sélecteur CSS du label/texte de l'option (relatif à l'option item, ou null si le texte est directement dans optionItems)",
  "textInput": "sélecteur CSS des champs texte libres (relatif au container, ou null)",
  "questionNumber": "sélecteur CSS du numéro de question (relatif au container, ou null)",
  "isCustomUI": true/false (true si les options sont des éléments cliquables custom, pas des radio/checkbox standard)
}

RÈGLES CRITIQUES:
- Retourne UNIQUEMENT le JSON, AUCUN texte avant ou après, AUCUN markdown
- Si tu n'es pas sûr d'un sélecteur, utilise null
- Le questionContainer DOIT être un sélecteur qui matche TOUTES les questions
- Préfère des sélecteurs courts et robustes
- Si la page n'a qu'une seule question visible, le questionContainer peut être le conteneur de cette unique question
- Si aucun quiz n'est détecté, retourne: {"platform":"Aucun quiz","confidence":0,"questionContainer":null}`;
  }

  // ──────────────────────────────────────────────
  // LLM DISCOVERY
  // ──────────────────────────────────────────────

  /**
   * Discover the quiz schema by sending the DOM skeleton to an LLM.
   * Uses the existing QuizProviders smart router.
   *
   * @param {boolean} force - If true, skip pre-flight checks (user explicitly asked)
   * @returns {Object|null} The SchemaMap or null if discovery failed.
   */
  async function discoverSchema(force = false) {
    console.log(`🔬 SchemaDetector: Début de la découverte de schéma... (force=${force})`);

    // Pre-flight: check if page has interactive content (skip if forced)
    if (!force && !hasInteractiveContent()) {
      console.log('ℹ️ SchemaDetector: Aucun contenu interactif détecté, skip.');
      return null;
    }

    // Build DOM skeleton
    const skeleton = buildDOMSkeleton();
    if (!skeleton || skeleton.length < 50) {
      console.log('ℹ️ SchemaDetector: Squelette DOM trop petit, skip.');
      return null;
    }

    // Build discovery prompt
    const prompt = buildDiscoveryPrompt(skeleton);
    console.log(`📝 SchemaDetector: Prompt de découverte — ${prompt.length} caractères`);

    // Load API config
    const syncConfig = await chrome.storage.sync.get(['providerOrder', 'customModels']);
    const localConfig = await chrome.storage.local.get(
      window.QuizProviders.getAllApiKeyFields()
    );
    Object.assign(syncConfig, localConfig);

    const order = syncConfig.providerOrder || window.QuizProviders.DEFAULT_PRIORITY;

    try {
      // Pour une tâche de code complexe (sélecteurs CSS), on essaie de forcer 
      // un modèle très intelligent si possible (ex: un modèle "gros" plutôt que "flash" ou "8b").
      // Toutefois, on passe par le smartRoute normal pour utiliser les clés dispos.
      const result = await window.QuizProviders.smartRoute(
        prompt,
        [],           // No images
        syncConfig,   // API keys
        order,        // Priority
        {},           // No model overrides
        { maxTokens: 2048, temperature: 0.1 }  // Basse température pour Json strict
      );

      console.log(`🤖 SchemaDetector: Réponse de ${result.providerName} (${result.model})`);
      console.log(`📄 SchemaDetector: Réponse brute:`, result.text.substring(0, 500));

      // Parse the JSON response
      const schemaMap = parseSchemaResponse(result.text);
      if (!schemaMap) {
        console.warn('⚠️ SchemaDetector: Impossible de parser la réponse LLM');
        return null;
      }

      // Validate the schema
      if (!schemaMap.questionContainer) {
        console.log('ℹ️ SchemaDetector: LLM n\'a trouvé aucun quiz sur cette page.');
        return null;
      }

      // Live-validate: check if the selectors actually match anything
      const validated = validateSchema(schemaMap);
      if (!validated) {
        console.warn('⚠️ SchemaDetector: Les sélecteurs LLM ne matchent rien sur la page.');
        // Return the schema anyway — it might work for future page loads
        // (current page could be in a different state than the quiz view)
        console.log('🔄 SchemaDetector: Conservation du schéma malgré validation échouée (pourrait fonctionner au rechargement)');
        schemaMap._validated = { matchedQuestions: 0, validatedAt: new Date().toISOString(), warning: 'validation_failed' };
        return schemaMap;
      }

      console.log(`✅ SchemaDetector: SchemaMap validé — ${validated.matchedQuestions} questions détectées`);
      schemaMap._validated = {
        matchedQuestions: validated.matchedQuestions,
        validatedAt: new Date().toISOString()
      };

      return schemaMap;

    } catch (error) {
      console.error('❌ SchemaDetector: Erreur lors de la découverte:', error.message);
      return null;
    }
  }

  /**
   * Parse the LLM response text to extract the JSON SchemaMap.
   * Handles possible markdown code blocks or extra text around the JSON.
   */
  function parseSchemaResponse(text) {
    try {
      // Try direct JSON parse first
      return JSON.parse(text.trim());
    } catch (e) {
      // Try to extract JSON from markdown code block
      const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1].trim());
        } catch (e2) { /* fall through */ }
      }

      // Try to find JSON object in the text
      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          return JSON.parse(objectMatch[0]);
        } catch (e3) { /* fall through */ }
      }

      console.warn('⚠️ parseSchemaResponse: aucun JSON valide trouvé dans la réponse');
      return null;
    }
  }

  /**
   * Helper: Escape special CSS characters (like Tailwind's sm:p-6) inside class selectors
   * Converts .sm:p-6 to .sm\:p-6, but leaves pseudo-classes like :hover alone if possible.
   * A simplified approach is just to trust CSS.escape on individual class parts,
   * but since the LLM returns full selectors (e.g. "div.sm:p-6 p"),
   * we replace non-pseudo colons with \:
   */
  function safeSelector(sel) {
    if (!sel || typeof sel !== 'string') return sel;
    // Replace colons inside class names (.sm:p-6 -> .sm\:p-6)
    // Matches a dot, then word chars/hyphens, then a colon, then more word chars/hyphens
    return sel.replace(/\.([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)/g, '.$1\\:$2');
  }

  /**
   * Validate that a SchemaMap's selectors actually work on the current page.
   * @returns {Object|null} Validation result or null if invalid.
   */
  function validateSchema(schemaMap) {
    if (!schemaMap.questionContainer) return null;

    try {
      const qSel = safeSelector(schemaMap.questionContainer);
      const containers = document.querySelectorAll(qSel);
      if (containers.length === 0) return null;

      // Check that at least some containers have recognizable quiz content
      let validContainers = 0;

      for (const container of containers) {
        let hasContent = false;

        // Check for question text
        if (schemaMap.questionText) {
          const tSel = safeSelector(schemaMap.questionText);
          const textEl = container.querySelector(tSel);
          if (textEl && textEl.textContent.trim().length > 3) hasContent = true;
        }

        // Check for standard interactive inputs
        if (schemaMap.optionInput) {
          const optInpSel = safeSelector(schemaMap.optionInput);
          const inputs = container.querySelectorAll(optInpSel);
          if (inputs.length > 0) hasContent = true;
        }

        // Check for custom clickable option items (modern UIs)
        if (schemaMap.optionItems) {
          const optItmSel = safeSelector(schemaMap.optionItems);
          const items = container.querySelectorAll(optItmSel);
          if (items.length > 1) hasContent = true;
        }

        if (schemaMap.textInput) {
          const tInpSel = safeSelector(schemaMap.textInput);
          const textInputs = container.querySelectorAll(tInpSel);
          if (textInputs.length > 0) hasContent = true;
        }

        // Even if no specific selector matched, if container has text it could be valid
        if (!hasContent && container.textContent.trim().length > 10) {
          hasContent = true;
        }

        if (hasContent) validContainers++;
      }

      if (validContainers === 0) return null;

      return { matchedQuestions: validContainers };
    } catch (e) {
      console.warn('⚠️ validateSchema: erreur de sélecteur CSS:', e.message);
      return null;
    }
  }

  // ──────────────────────────────────────────────
  // SCHEMA APPLICATION — Extract quiz data using a SchemaMap
  // ──────────────────────────────────────────────

  /**
   * Extract quiz data from the page using a SchemaMap.
   * Returns the same format as extractQuizData() in content.js.
   * Handles both standard HTML inputs and custom clickable elements.
   *
   * @param {Object} schemaMap - The SchemaMap to apply.
   * @returns {Object} { questions: [...], totalImages: number }
   */
  async function applySchema(schemaMap) {
    console.log(`🎯 SchemaDetector.applySchema: plateforme="${schemaMap.platform}", confidence=${schemaMap.confidence}, customUI=${schemaMap.isCustomUI}`);

    const questions = [];
    let totalImages = 0;

    if (!schemaMap.questionContainer) {
      return { questions, totalImages };
    }

    const qSel = safeSelector(schemaMap.questionContainer);
    const containers = document.querySelectorAll(qSel);
    console.log(`📦 ${containers.length} conteneurs de question trouvés (${qSel})`);

    for (let index = 0; index < containers.length; index++) {
      const container = containers[index];

      const questionData = {
        index: index + 1,
        element: container,
        text: '',
        type: 'unknown',
        options: [],
        inputElement: null,
        images: []
      };

      // Extract question text
      if (schemaMap.questionText) {
        const tSel = safeSelector(schemaMap.questionText);
        const textEl = container.querySelector(tSel);
        if (textEl) {
          questionData.text = textEl.innerText?.trim() || '';
        }
      }

      // Fallback: grab any heading or first paragraph as question text
      if (!questionData.text) {
        const fallbackText = container.querySelector('h1, h2, h3, h4, h5, h6, p, legend, .qtext');
        if (fallbackText) {
          questionData.text = fallbackText.innerText?.trim() || '';
        }
      }

      // Last resort: use all direct text from the container
      if (!questionData.text) {
        questionData.text = getDirectTextContent(container);
      }

      // Extract images within container (using existing ImageCapture if available)
      if (typeof ImageCapture !== 'undefined' && ImageCapture.captureAllImages) {
        try {
          questionData.images = await ImageCapture.captureAllImages(container);
          totalImages += questionData.images.length;
        } catch (e) {
          // ImageCapture not available in this scope, skip
        }
      }

      // ═══════════════════════════════════════════
      // OPTION EXTRACTION (Standard OR Custom UI)
      // ═══════════════════════════════════════════

      // Case 1: Standard HTML inputs (radio/checkbox)
      if (schemaMap.optionInput) {
        const optInpSel = safeSelector(schemaMap.optionInput);
        const inputs = container.querySelectorAll(optInpSel);
        if (inputs.length > 0) {
          questionData.type = inputs[0].type || 'radio';

          inputs.forEach((input, idx) => {
            let labelText = '';

            if (schemaMap.optionLabel) {
              const optItemSel = safeSelector(schemaMap.optionItems);
              const optionParent = findOptionParent(input, optItemSel, container);
              if (optionParent) {
                const optLabSel = safeSelector(schemaMap.optionLabel);
                const label = optionParent.querySelector(optLabSel);
                if (label) labelText = label.innerText?.trim() || '';
              }
            }

            // Fallback label detection
            if (!labelText) {
              const htmlLabel = document.querySelector(`label[for="${input.id}"]`);
              if (htmlLabel) labelText = htmlLabel.innerText?.trim() || '';
            }
            if (!labelText) {
              const closestLabel = input.closest('label');
              if (closestLabel) labelText = closestLabel.innerText?.trim() || '';
            }
            if (!labelText) {
              const parent = input.parentElement;
              if (parent) labelText = parent.innerText?.trim() || '';
            }
            if (!labelText) labelText = `Option ${idx + 1}`;

            questionData.options.push({
              index: idx,
              element: input,
              labelElement: input.closest('label') || input.parentElement,
              text: labelText,
              value: input.value
            });
          });
        }
      }

      // Case 2: Custom UI — clickable div/button/li options (no radio/checkbox)
      if (questionData.options.length === 0 && schemaMap.optionItems) {
        const optItmSel = safeSelector(schemaMap.optionItems);
        const optionElements = container.querySelectorAll(optItmSel);

        if (optionElements.length > 0) {
          questionData.type = 'radio'; // Treat as single-choice by default

          optionElements.forEach((optEl, idx) => {
            let labelText = '';

            // Get label text from optionLabel selector or directly from the element
            if (schemaMap.optionLabel) {
              const optLabSel = safeSelector(schemaMap.optionLabel);
              const label = optEl.querySelector(optLabSel);
              if (label) labelText = label.innerText?.trim() || '';
            }
            if (!labelText) {
              labelText = optEl.innerText?.trim() || `Option ${idx + 1}`;
            }

            questionData.options.push({
              index: idx,
              element: optEl,           // The clickable element itself
              labelElement: optEl,       // Same element for highlighting
              text: labelText,
              value: labelText           // Use text as value for custom UIs
            });
          });

          console.log(`   🎨 Custom UI: ${optionElements.length} options cliquables détectées`);
        }
      }

      // Case 3: Text input
      if (questionData.options.length === 0 && schemaMap.textInput) {
        const tInpSel = safeSelector(schemaMap.textInput);
        const textInput = container.querySelector(tInpSel);
        if (textInput) {
          questionData.type = 'text';
          questionData.inputElement = textInput;
        }
      }

      // Fallback: look for any text input if schema didn't specify
      if (questionData.options.length === 0 && !questionData.inputElement) {
        const anyTextInput = container.querySelector('input[type="text"], textarea');
        if (anyTextInput) {
          questionData.type = 'text';
          questionData.inputElement = anyTextInput;
        }
      }

      // Only add valid questions (relaxed: text alone is valid)
      const hasOptions = questionData.options.length > 0;
      const hasInput = questionData.inputElement !== null;
      const hasImages = questionData.images.length > 0;
      const hasText = questionData.text.length > 5;

      if (hasText && (hasOptions || hasInput || hasImages)) {
        console.log(`   Q${index + 1}: "${questionData.text.substring(0, 60)}..." (${questionData.type}, ${questionData.options.length} options)`);
        questions.push(questionData);
      } else if (hasText && !hasOptions && !hasInput) {
        // Question with text only — still valid if it contains a question mark
        if (questionData.text.includes('?')) {
          console.log(`   Q${index + 1}: "${questionData.text.substring(0, 60)}..." (text-only question)`);
          questionData.type = 'text';
          questions.push(questionData);
        }
      }
    }

    console.log(`📋 SchemaDetector: ${questions.length} questions extraites, ${totalImages} images`);
    return { questions, totalImages };
  }

  /**
   * Find the option parent container for a given input element.
   * Walks up from the input until it finds a parent matching the optionItems selector
   * or hits the question container boundary.
   */
  function findOptionParent(input, optionItemsSelector, questionContainer) {
    if (!optionItemsSelector) return input.parentElement;

    let current = input.parentElement;
    while (current && current !== questionContainer) {
      try {
        if (current.matches(optionItemsSelector)) return current;
      } catch (e) {
        // Invalid selector, just use parent
        return input.parentElement;
      }
      current = current.parentElement;
    }
    return input.parentElement;
  }

  // Public API
  return {
    buildDOMSkeleton,
    discoverSchema,
    applySchema,
    validateSchema,
    hasInteractiveContent
  };
})();

// Export for content script usage
if (typeof window !== 'undefined') {
  window.SchemaDetector = SchemaDetector;
}
