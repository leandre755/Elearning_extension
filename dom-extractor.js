// dom-extractor.js - Safe Exm Quiz Extractor (F-DET-01 & F-DET-02)
/* global ConfigCache, SchemaCache, SchemaDetector, WeakMap, WeakSet, Set, Array, Object, String, Number, Boolean, Date, Math, JSON, RegExp, Error, Promise, CustomEvent, document, window, globalThis, module, Node, Image, setTimeout, clearTimeout, console */
(function () {
  'use strict';

  const DEFAULT_MAX_SHADOW_DEPTH = 12;
  const DEFAULT_BRIDGE_HANDSHAKE_EVENT = 'dom-bridge:handshake';
  const NON_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const SKIPPED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'radio', 'checkbox', 'file', 'image', 'range', 'color', 'password']);
  const PLACEHOLDER_OPTION_RE = /^(--|s[eé]lect\b|choose\b|chois|pick\b|please\b|\.\.\.)/i;
  const BLANK_MARKER_RE = /(_{3,}|\[\s*\.{2,}\s*\])/;
  const GENERIC_SECTION_LABEL_RE = /^(?:answers?|options?|choices?|select(?:\s+an?)?\s+(?:answer|option|choice)|choose(?:\s+an?)?\s+(?:answer|option)|your\s+answer|r[eé]ponses?|choix|s[eé]lectionnez\s+une\s+r[eé]ponse)\s*:?$/i;
  const QUESTION_COUNTER_ONLY_RE = /^(?:question|q)\s*\d+\s*(?:of|sur|\/)\s*\d+\s*:?$/i;

  function isGenericSectionLabel(text) {
    const cleaned = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    if (!cleaned) return true;
    return GENERIC_SECTION_LABEL_RE.test(cleaned) || QUESTION_COUNTER_ONLY_RE.test(cleaned);
  }

  const QUIZ_SELECTORS = {
    quizContainer: [
      '.quiz', '.quiz-container', '.question-container',
      '[class*="quiz"]', '[class*="question"]', '[data-quiz]',
      '.assessment', '.test-container', 'form[class*="quiz"]',
      '.quiz-form', '#quizForm', '#quizmain', '#quizcontainer', '#quizform'
    ],
    question: [
      '#qtext', '.qtext',
      '.question', '.question-text', '.quiz-question',
      '[class*="question-title"]', '.q-text', 'legend',
      '.question-content', '[class*="questionText"]',
      '.question-card h3', '.question-card .question-text h3'
    ],
    answerOption: [
      'input[type="radio"]', 'input[type="checkbox"]',
      '[role="radio"]', '[role="checkbox"]', '[role="option"]',
      '.answer-option', '.quiz-option', '.choice',
      '[class*="answer"]', '[class*="option"]'
    ],
    answerLabel: [
      'label', '.answer-text', '.option-text',
      '[class*="answer-label"]', '.choice-text', '.option'
    ],
    textInput: [
      'input[type="text"].text-answer', 'textarea.text-answer',
      'input[type="text"]', 'input:not([type])', 'textarea',
      '[contenteditable="true"]',
      '.answer-input input', '.answer-input textarea'
    ],
    questionNumber: [
      '.question-number', '.q-number', '[class*="questionNum"]',
      '.question-index', 'span.number'
    ],
    selectMatching: [
      'select', '.matching-pair', '[data-match-pair]'
    ],
    dragDrop: [
      '[draggable="true"]', '[aria-grabbed]',
      '[data-droppable]', '[aria-dropeffect]',
      '.dropzone', '.drop-zone', '.drop-target', '[data-dropzone]'
    ]
  };

  function getDoc(fallbackDoc) {
    if (fallbackDoc) return fallbackDoc;
    return typeof document !== 'undefined' ? document : null;
  }

  function getWin() {
    if (typeof window !== 'undefined') return window;
    if (typeof globalThis !== 'undefined') return globalThis;
    return null;
  }

  function safeAttr(el, name) {
    if (!el) return null;
    try {
      if (typeof el.getAttribute === 'function') {
        return el.getAttribute(name);
      }
      if (el.attributes && typeof el.attributes === 'object') {
        return el.attributes[name] !== undefined ? String(el.attributes[name]) : null;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function safeHasAttr(el, name) {
    if (!el) return false;
    try {
      if (typeof el.hasAttribute === 'function') {
        return el.hasAttribute(name);
      }
    } catch (e) { /* ignore */ }
    return safeAttr(el, name) !== null;
  }

  function getChildElements(node) {
    if (!node) return [];
    if (node.children && typeof node.children.length === 'number') {
      return Array.from(node.children);
    }
    if (node.childNodes && typeof node.childNodes.length === 'number') {
      const out = [];
      for (let i = 0; i < node.childNodes.length; i++) {
        const ch = node.childNodes[i];
        if (ch && (ch.nodeType === 1 || (typeof ch.tagName === 'string' && ch.nodeType !== 3))) {
          out.push(ch);
        }
      }
      return out;
    }
    return [];
  }

  function getSlottedElements(slotEl) {
    if (!slotEl || typeof slotEl !== 'object') return [];
    const tag = typeof slotEl.tagName === 'string' ? slotEl.tagName.toUpperCase() : '';
    if (tag !== 'SLOT') return [];
    try {
      if (typeof slotEl.assignedElements === 'function') {
        return Array.from(slotEl.assignedElements({ flatten: true }) || []);
      }
      if (typeof slotEl.assignedNodes === 'function') {
        return Array.from(slotEl.assignedNodes({ flatten: true }) || [])
          .filter((n) => n && typeof n === 'object' && (n.nodeType === 1 || typeof n.tagName === 'string'));
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  /**
   * F-DET-02: Recursively query all elements matching `selector` across light DOM,
   * open Shadow DOM trees, and `<slot>` projections (`assignedElements({ flatten: true })`),
   * guarded against cycles with WeakSet and capped at maxDepth.
   */
  function querySelectorAllDeep(selector, root, options = {}) {
    if (typeof selector !== 'string' || !selector.trim()) return [];
    const startRoot = root || getDoc();
    if (!startRoot || typeof startRoot !== 'object') return [];

    const maxDepth = typeof options.maxDepth === 'number' && !Number.isNaN(options.maxDepth)
      ? Math.max(0, Math.floor(options.maxDepth))
      : DEFAULT_MAX_SHADOW_DEPTH;

    const results = [];
    const matchedSet = new WeakSet();
    const visitedRootMinDepth = new WeakMap();
    const visitedElMinDepth = new WeakMap();

    function addMatch(el) {
      if (el && typeof el === 'object' && !matchedSet.has(el)) {
        matchedSet.add(el);
        results.push(el);
      }
    }

    function inspectElementForShadowsAndSlots(el, depth) {
      if (el.shadowRoot && typeof el.shadowRoot === 'object' && depth < maxDepth) {
        traverseRoot(el.shadowRoot, depth + 1);
      }
      const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
      if (tag === 'SLOT') {
        const slotted = getSlottedElements(el);
        for (let j = 0; j < slotted.length; j++) {
          const sEl = slotted[j];
          if (!sEl || typeof sEl !== 'object') continue;
          if (typeof sEl.matches === 'function') {
            try {
              if (sEl.matches(selector)) addMatch(sEl);
            } catch (e) { /* ignore invalid selector */ }
          }
          traverseRoot(sEl, depth);
        }
      }
    }

    function walkLightForShadows(container, depth) {
      if (!container || typeof container !== 'object') return;
      const children = getChildElements(container);
      if (children.length > 0) {
        for (let i = 0; i < children.length; i++) {
          const el = children[i];
          if (!el || typeof el !== 'object') continue;
          const prevElDepth = visitedElMinDepth.get(el);
          if (prevElDepth !== undefined && prevElDepth <= depth) continue;
          visitedElMinDepth.set(el, depth);
          inspectElementForShadowsAndSlots(el, depth);
          walkLightForShadows(el, depth);
        }
      } else if (typeof container.querySelectorAll === 'function') {
        try {
          const all = container.querySelectorAll('*');
          for (let i = 0; i < all.length; i++) {
            const el = all[i];
            if (!el || typeof el !== 'object') continue;
            const prevElDepth = visitedElMinDepth.get(el);
            if (prevElDepth !== undefined && prevElDepth <= depth) continue;
            visitedElMinDepth.set(el, depth);
            inspectElementForShadowsAndSlots(el, depth);
          }
        } catch (e) { /* ignore invalid wildcard query */ }
      }
    }

    function traverseRoot(currentRoot, depth) {
      if (!currentRoot || typeof currentRoot !== 'object') return;
      const prevRootDepth = visitedRootMinDepth.get(currentRoot);
      if (prevRootDepth !== undefined && prevRootDepth <= depth) return;
      visitedRootMinDepth.set(currentRoot, depth);

      if (typeof currentRoot.querySelectorAll === 'function') {
        try {
          const matches = currentRoot.querySelectorAll(selector);
          for (let i = 0; i < matches.length; i++) {
            addMatch(matches[i]);
          }
        } catch (e) { /* invalid selector or mock error */ }
      }

      if (typeof currentRoot.tagName === 'string' && currentRoot.tagName.toUpperCase() === 'SLOT') {
        inspectElementForShadowsAndSlots(currentRoot, depth);
      }

      // Walk light DOM unconditionally before descending into currentRoot.shadowRoot
      // so <slot> projections stay resolved at maxDepth and true light-DOM depth wins.
      walkLightForShadows(currentRoot, depth);

      if (currentRoot.shadowRoot && typeof currentRoot.shadowRoot === 'object' && depth < maxDepth) {
        traverseRoot(currentRoot.shadowRoot, depth + 1);
      }
    }

    traverseRoot(startRoot, 0);
    return results;
  }

  /**
   * F-DET-02: Find the first element matching `selector` across light DOM and open Shadow DOM.
   */
  function querySelectorDeep(selector, root, options = {}) {
    const matches = querySelectorAllDeep(selector, root, options);
    return matches.length > 0 ? matches[0] : null;
  }

  function isNodeHiddenForText(el) {
    if (!el || typeof el !== 'object') return true;
    if (el.hidden === true) return true;
    if (safeAttr(el, 'aria-hidden') === 'true') return true;
    if (el.style) {
      if (el.style.display === 'none' || el.style.visibility === 'hidden' || el.style.opacity === '0') {
        return true;
      }
    }
    const win = getWin();
    if (win && typeof win.getComputedStyle === 'function' && (el.nodeType === 1 || typeof el.tagName === 'string')) {
      try {
        const style = win.getComputedStyle(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
          return true;
        }
      } catch (e) { /* ignore detached/mock errors */ }
    }
    return false;
  }

  function isContentEditableElement(el) {
    if (!el) return false;
    if (el.isContentEditable === true) return true;
    const ce = safeAttr(el, 'contenteditable');
    return ce === '' || ce === 'true';
  }

  /**
   * F-DET-02: Extract and concatenate visible text across light DOM, open shadow roots, and slots.
   */
  function extractTextDeep(el, options = {}) {
    if (!el || typeof el !== 'object') return '';
    const maxDepth = typeof options.maxDepth === 'number' && !Number.isNaN(options.maxDepth)
      ? Math.max(0, Math.floor(options.maxDepth))
      : DEFAULT_MAX_SHADOW_DEPTH;
    const includeBlankMarkers = Boolean(options.includeBlankMarkers);
    const excludeNode = options.excludeNode || null;
    const skipNode = typeof options.skipNode === 'function' ? options.skipNode : null;
    const skipTags = Array.isArray(options.skipTags) && options.skipTags.length > 0
      ? new Set(options.skipTags.map((t) => String(t).toUpperCase()))
      : null;
    const visitedNodes = new WeakSet();
    let buffer = '';
    let needBoundarySpace = false;

    function appendSegment(seg) {
      if (typeof seg !== 'string' || !seg) return;
      const collapsed = seg.replace(/\s+/g, ' ');
      if (!collapsed) return;
      if (collapsed === ' ') {
        if (buffer.length > 0 && !buffer.endsWith(' ')) {
          buffer += ' ';
        }
        needBoundarySpace = false;
        return;
      }
      if (needBoundarySpace && buffer.length > 0 && !buffer.endsWith(' ') && !/^[.,!?;:)\]]/.test(collapsed) && !collapsed.startsWith(' ')) {
        buffer += ' ';
      }
      needBoundarySpace = false;
      buffer += collapsed;
    }

    function hasUnresolvableSlot(sr) {
      if (!sr || typeof sr.querySelectorAll !== 'function') return false;
      try {
        const slots = sr.querySelectorAll('slot');
        for (let i = 0; i < slots.length; i++) {
          if (typeof slots[i].assignedNodes !== 'function' && typeof slots[i].assignedElements !== 'function') {
            return true;
          }
        }
      } catch (e) { /* ignore */ }
      return false;
    }

    function walk(node, shadowDepth) {
      if (!node || typeof node !== 'object') return;
      if (excludeNode && node === excludeNode) return;
      if (skipNode && node !== el && skipNode(node)) return;
      if (visitedNodes.has(node)) return;
      visitedNodes.add(node);

      const nType = node.nodeType;
      // Ignore HTML comments (8) and processing instructions (7)
      if (nType === 8 || nType === 7) return;
      // Text node (nodeType === 3)
      if (nType === 3) {
        const raw = typeof node.textContent === 'string'
          ? node.textContent
          : (typeof node.nodeValue === 'string' ? node.nodeValue : '');
        appendSegment(raw);
        return;
      }

      const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
      if (tag && (NON_TEXT_TAGS.has(tag) || (skipTags && skipTags.has(tag)))) return;
      if (nType === 1 || tag) {
        if (isNodeHiddenForText(node)) return;
        if (buffer.length > 0) needBoundarySpace = true;
      }

      if (includeBlankMarkers && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) {
        if (tag === 'SELECT') {
          appendSegment('___');
          needBoundarySpace = true;
          return;
        }
        const iType = (safeAttr(node, 'type') || node.type || 'text').toLowerCase();
        if (!SKIPPED_INPUT_TYPES.has(iType)) {
          appendSegment('___');
          needBoundarySpace = true;
          return;
        }
      }

      if (includeBlankMarkers && isContentEditableElement(node) && !cleanText(node.textContent || node.innerText || '')) {
        appendSegment('___');
        needBoundarySpace = true;
        return;
      }

      // Handle <slot> assigned nodes/elements in shadow DOM
      if (tag === 'SLOT') {
        let assigned = null;
        try {
          if (typeof node.assignedNodes === 'function') {
            assigned = node.assignedNodes({ flatten: true });
          } else if (typeof node.assignedElements === 'function') {
            assigned = node.assignedElements({ flatten: true });
          }
        } catch (e) { assigned = null; }
        if (assigned && assigned.length > 0) {
          for (let i = 0; i < assigned.length; i++) {
            walk(assigned[i], shadowDepth);
          }
          if (buffer.length > 0) needBoundarySpace = true;
          return;
        }
      }

      const beforeLen = buffer.length;
      if (node.shadowRoot && typeof node.shadowRoot === 'object') {
        if (shadowDepth >= maxDepth) {
          return;
        }
        if (!visitedNodes.has(node.shadowRoot)) {
          walk(node.shadowRoot, shadowDepth + 1);
          // Composed Shadow DOM only renders light DOM children via <slot>;
          // only fall back to light childNodes if a mock <slot> lacks slot APIs.
          if (!hasUnresolvableSlot(node.shadowRoot)) {
            if (buffer.length > beforeLen && (nType === 1 || tag)) {
              needBoundarySpace = true;
            }
            return;
          }
        }
      }

      const childNodes = node.childNodes;
      if (childNodes && typeof childNodes.length === 'number' && childNodes.length > 0) {
        for (let i = 0; i < childNodes.length; i++) {
          walk(childNodes[i], shadowDepth);
        }
      } else if (node.children && typeof node.children.length === 'number' && node.children.length > 0) {
        for (let i = 0; i < node.children.length; i++) {
          walk(node.children[i], shadowDepth);
        }
      } else if (!node.shadowRoot && (nType === 1 || tag)) {
        const fallback = typeof node.innerText === 'string'
          ? node.innerText
          : (typeof node.textContent === 'string' ? node.textContent : '');
        if (fallback) {
          appendSegment(fallback);
        }
      }

      if (buffer.length > beforeLen && (nType === 1 || tag)) {
        needBoundarySpace = true;
      }
    }

    walk(el, 0);
    return cleanText(buffer);
  }

  const ImageCapture = {
    MIN_SIZE: 50,       // Ignore images smaller than 50px
    MAX_DATA_SIZE: 5 * 1024 * 1024, // 5MB max per image
    QUALITY: 0.8,       // JPEG compression quality

    /**
     * Capture all images within a DOM container (including open Shadow DOM).
     * Returns array of { dataUrl, mimeType, width, height, source }
     */
    async captureAllImages(container) {
      const images = [];
      if (!container) {
        return images;
      }

      // Load settings from ConfigCache
      try {
        if (typeof ConfigCache !== 'undefined') {
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
        }
      } catch (e) { /* use defaults */ }

      const capturePromises = [];

      // 1. Standard <img> tags (including Shadow DOM)
      const imgElements = querySelectorAllDeep('img', container);
      imgElements.forEach(img => {
        capturePromises.push(this.captureImgElement(img));
      });

      // 2. CSS background-image (only when window.getComputedStyle is available)
      const win = getWin();
      if (win && typeof win.getComputedStyle === 'function') {
        const allElements = querySelectorAllDeep('*', container);
        allElements.forEach(el => {
          try {
            const bgImg = win.getComputedStyle(el).backgroundImage;
            if (bgImg && bgImg !== 'none' && bgImg.startsWith('url(')) {
              capturePromises.push(this.captureBgImage(bgImg));
            }
          } catch (e) { /* ignore mock elements */ }
        });
      }

      // Execute captures in parallel
      const results = await Promise.all(capturePromises);
      return results.filter(img => img !== null);
    },

    async captureImgElement(img) {
      if (!img || typeof img.src !== 'string' || !img.src) return null;
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
      const rawImgUrl = match[2];

      try {
        if (rawImgUrl.startsWith('data:')) {
          return { dataUrl: rawImgUrl, mimeType: this.getMimeType(rawImgUrl), width: 100, height: 100, source: 'bg-style-base64' };
        }

        const proxyData = await this.fetchImageViaProxy(rawImgUrl);
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
          tempImg.src = rawImgUrl;
        });
      } catch (e) {
        console.warn('⚠️ ImageCapture.captureBgImage failed:', e.message);
        return null;
      }
    },

    fetchImageViaProxy(imageUrl) {
      if (typeof imageUrl !== 'string' || !imageUrl) {
        return Promise.resolve(null);
      }
      if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'fetchImage', url: imageUrl }, (response) => {
          if (chrome.runtime.lastError || !response || !response.success) {
            resolve(null);
          } else {
            resolve(response);
          }
        });
      });
    },

    canvasRender(imgElement) {
      if (!imgElement || typeof imgElement !== 'object') {
        return Promise.reject(new Error('ImageCapture.canvasRender: imgElement invalide.'));
      }
      const doc = getDoc();
      if (!doc || typeof doc.createElement !== 'function') {
        return Promise.reject(new Error('ImageCapture.canvasRender: document indisponible.'));
      }
      return new Promise((resolve, reject) => {
        try {
          const canvas = doc.createElement('canvas');
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
    if (el.hidden === true) return false;
    if (safeAttr(el, 'aria-hidden') === 'true') return false;
    if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden' || el.style.opacity === '0')) {
      return false;
    }
    const win = getWin();
    if (win && typeof win.getComputedStyle === 'function') {
      try {
        const style = win.getComputedStyle(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
          return false;
        }
      } catch (e) { /* ignore non-DOM mock */ }
    }
    if (typeof el.getBoundingClientRect === 'function') {
      try {
        const rect = el.getBoundingClientRect();
        if (rect && rect.width === 0 && rect.height === 0) {
          return false;
        }
      } catch (e) { /* ignore mock */ }
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

  function isInShadowDom(el) {
    if (!el || typeof el !== 'object') return false;
    try {
      if (typeof el.getRootNode === 'function') {
        const rootNode = el.getRootNode();
        if (rootNode && rootNode.nodeType === 11 && rootNode.host) {
          return true;
        }
      }
      let curr = el;
      let steps = 0;
      while (curr && steps < 40) {
        steps++;
        if (curr.host) return true;
        curr = curr.parentNode || curr.parentElement;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function getComposedParent(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.assignedSlot && typeof node.assignedSlot === 'object') {
      return node.assignedSlot;
    }
    if (node.parentElement) return node.parentElement;
    if (node.parentNode) return node.parentNode;
    if (node.host) return node.host;
    if (typeof node.getRootNode === 'function') {
      try {
        const root = node.getRootNode();
        if (root && root !== node && typeof root === 'object' && root.host) {
          return root.host;
        }
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  function containsAcrossShadows(container, node) {
    if (!container || !node || typeof container !== 'object' || typeof node !== 'object') return false;
    if (container === node) return true;
    if (typeof container.contains === 'function') {
      try {
        if (container.contains(node)) return true;
      } catch (e) { /* ignore */ }
    }
    let curr = node;
    let steps = 0;
    const seen = new WeakSet();
    while (curr && steps < 64 && !seen.has(curr)) {
      seen.add(curr);
      if (curr === container) return true;
      curr = getComposedParent(curr);
      steps++;
    }
    return false;
  }

  function safeClosest(el, selector, stopAt) {
    if (!el || typeof el !== 'object') return null;
    const tagTarget = selector.toUpperCase();
    let curr = el;
    let steps = 0;
    const seen = new WeakSet();
    let sawMatchesFn = false;
    while (curr && curr !== stopAt && steps < 40 && !seen.has(curr)) {
      seen.add(curr);
      steps++;
      let matched = false;
      if (typeof curr.matches === 'function') {
        sawMatchesFn = true;
        try {
          if (curr.matches(selector)) matched = true;
        } catch (e) { /* ignore */ }
      } else if (typeof curr.tagName === 'string' && curr.tagName.toUpperCase() === tagTarget) {
        matched = true;
      }
      if (matched && (!stopAt || containsAcrossShadows(stopAt, curr))) {
        return curr;
      }
      curr = getComposedParent(curr);
    }
    if (!sawMatchesFn && typeof el.closest === 'function') {
      try {
        const found = el.closest(selector);
        if (found && found !== stopAt && (!stopAt || containsAcrossShadows(stopAt, found))) {
          return found;
        }
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  function getTreeRoot(node) {
    if (!node || typeof node !== 'object') return null;
    if (typeof node.getRootNode === 'function') {
      try {
        const root = node.getRootNode();
        if (root && typeof root === 'object') return root;
      } catch (e) { /* ignore */ }
    }
    let curr = node;
    let steps = 0;
    const seen = new WeakSet();
    while (curr && curr.parentNode && steps < 60 && !seen.has(curr)) {
      seen.add(curr);
      curr = curr.parentNode;
      steps++;
    }
    return curr || null;
  }

  function queryLocalTree(root, selector) {
    if (!root || typeof root !== 'object') return [];
    const results = [];
    if (typeof root.matches === 'function') {
      try {
        if (root.matches(selector)) results.push(root);
      } catch (e) { /* ignore */ }
    }
    if (typeof root.querySelectorAll === 'function') {
      try {
        const list = root.querySelectorAll(selector);
        for (let i = 0; i < list.length; i++) {
          if (list[i] && list[i] !== root) results.push(list[i]);
        }
      } catch (e) { /* ignore */ }
    }
    return results;
  }

  function buildScopedSearchRoots(contextEl, scope, rootScope) {
    const searchRoots = [];
    const seen = new Set();
    const pushRoot = (r, localOnly) => {
      if (r && typeof r === 'object' && !seen.has(r)) {
        seen.add(r);
        searchRoots.push({ root: r, localOnly });
      }
    };
    const ctxRoot = getTreeRoot(contextEl);
    if (ctxRoot && ctxRoot.nodeType === 11) {
      if (scope && getTreeRoot(scope) === ctxRoot) {
        pushRoot(scope, true);
      }
      pushRoot(ctxRoot, true);
      return searchRoots;
    }
    if (ctxRoot) {
      if (scope && getTreeRoot(scope) === ctxRoot) {
        pushRoot(scope, true);
      }
      pushRoot(ctxRoot, true);
      if (rootScope && getTreeRoot(rootScope) === ctxRoot) {
        pushRoot(rootScope, true);
      }
      return searchRoots;
    }
    pushRoot(scope, true);
    pushRoot(rootScope, true);
    return searchRoots;
  }

  function findByIdDeep(id, scope, rootScope, contextEl) {
    if (!id) return null;
    const searchRoots = buildScopedSearchRoots(contextEl, scope, rootScope);
    for (const entry of searchRoots) {
      const r = entry.root;
      if (typeof r.getElementById === 'function') {
        try {
          const found = r.getElementById(id);
          if (found) return found;
        } catch (e) { /* ignore */ }
      }
      const all = entry.localOnly ? queryLocalTree(r, '[id]') : querySelectorAllDeep('[id]', r);
      for (const node of all) {
        if (node.id === id || safeAttr(node, 'id') === id) {
          return node;
        }
      }
    }
    return null;
  }

  function resolveAriaLabelledByText(el, scope, rootScope) {
    const idsRaw = safeAttr(el, 'aria-labelledby');
    if (!idsRaw) return '';
    const parts = [];
    for (const id of idsRaw.trim().split(/\s+/)) {
      if (!id) continue;
      const target = findByIdDeep(id, scope, rootScope, el);
      if (target) {
        const txt = extractTextDeep(target);
        if (txt) parts.push(txt);
      }
    }
    return cleanText(parts.join(' '));
  }

  function findLabelForInput(input, scope, rootScope) {
    const closestLabel = safeClosest(input, 'label', scope);
    if (closestLabel) return closestLabel;

    const inputId = input.id || safeAttr(input, 'id');
    if (inputId) {
      for (const entry of buildScopedSearchRoots(input, scope, rootScope)) {
        const labels = entry.localOnly ? queryLocalTree(entry.root, 'label') : querySelectorAllDeep('label', entry.root);
        for (const lbl of labels) {
          if (lbl.htmlFor === inputId || safeAttr(lbl, 'for') === inputId) {
            return lbl;
          }
        }
      }
    }

    const parent = input.parentElement;
    const isSingleControlParent = parent && querySelectorAllDeep('input[type="radio"], input[type="checkbox"], select', parent).length <= 1;

    if (isSingleControlParent) {
      const optTextEl = querySelectorDeep('.option-text, .answer-text, .choice-text', parent);
      if (optTextEl) return optTextEl;
    }

    const inputTag = typeof input.tagName === 'string' ? input.tagName.toUpperCase() : '';
    if (
      inputTag !== 'SELECT' &&
      input.nextElementSibling &&
      input.nextElementSibling.tagName !== 'INPUT'
    ) {
      return input.nextElementSibling;
    }

    return (inputTag !== 'SELECT' && isSingleControlParent) ? parent : null;
  }

  function extractInputOptionText(input, labelEl, idx, scope, rootScope) {
    if (labelEl) {
      const optSub = querySelectorDeep('.option-text, .answer-text, .choice-text', labelEl);
      const fromSub = optSub ? extractTextDeep(optSub) : '';
      const raw = fromSub || extractTextDeep(labelEl);
      if (raw) return raw;
    }
    const ariaLabel = safeAttr(input, 'aria-label');
    if (ariaLabel && cleanText(ariaLabel)) return cleanText(ariaLabel);
    const labelledByText = resolveAriaLabelledByText(input, scope, rootScope);
    if (labelledByText) return labelledByText;
    if (typeof input.value === 'string' && input.value && input.value !== 'on') {
      return cleanText(input.value);
    }
    return `Option ${idx + 1}`;
  }

  function isPlaceholderOption(opt, idx, total) {
    if (!opt) return true;
    const hasExplicitVal = safeHasAttr(opt, 'value');
    const rawAttrVal = safeAttr(opt, 'value');
    const val = hasExplicitVal ? String(rawAttrVal ?? '') : (opt.value !== undefined ? String(opt.value) : '');
    const txt = cleanText(extractTextDeep(opt) || opt.text || opt.textContent || '');
    const isEffectivelyEmptyVal = val === '' || (!hasExplicitVal && val === txt);
    const disabled = Boolean(opt.disabled || safeHasAttr(opt, 'disabled'));
    if (disabled && (isEffectivelyEmptyVal || PLACEHOLDER_OPTION_RE.test(txt))) return true;
    if (safeHasAttr(opt, 'data-placeholder') || opt.dataset?.placeholder === 'true') return true;
    if (idx === 0 && isEffectivelyEmptyVal && total > 1) {
      if (!txt || PLACEHOLDER_OPTION_RE.test(txt)) {
        return true;
      }
    }
    return false;
  }

  function extractSelectPairPrompt(selectEl, scope, rootScope) {
    const lbl = findLabelForInput(selectEl, scope, rootScope);
    if (lbl && lbl !== scope) {
      const txt = cleanText(extractTextDeep(lbl, { excludeNode: selectEl, skipTags: ['SELECT'] }));
      if (txt) return txt;
    }
    const ariaLabel = safeAttr(selectEl, 'aria-label');
    if (ariaLabel && cleanText(ariaLabel)) return cleanText(ariaLabel);

    const labelledBy = resolveAriaLabelledByText(selectEl, scope, rootScope);
    if (labelledBy) return labelledBy;

    // Look at previous sibling or enclosing matching row excluding select options text
    if (selectEl.previousElementSibling && selectEl.previousElementSibling.tagName !== 'SELECT') {
      const prevTxt = extractTextDeep(selectEl.previousElementSibling, { excludeNode: selectEl, skipTags: ['SELECT'] });
      if (prevTxt) return prevTxt;
    }

    const row = safeClosest(selectEl, '.matching-pair, .match-row, tr, li', scope) || selectEl.parentElement;
    if (row && row !== scope) {
      const rowLabel = cleanText(extractTextDeep(row, { excludeNode: selectEl, skipTags: ['SELECT'] }));
      if (rowLabel) return rowLabel;
    }
    return '';
  }

  function isNonStemElement(node) {
    if (!node || typeof node !== 'object') return false;
    const t = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
    if (t === 'LABEL' || t === 'SELECT' || t === 'BUTTON' || t === 'DATALIST') return true;
    const role = (safeAttr(node, 'role') || '').toLowerCase();
    if (role === 'radio' || role === 'checkbox' || role === 'option' || role === 'listbox' || role === 'radiogroup') {
      return true;
    }
    const cls = typeof node.className === 'string' ? node.className : (safeAttr(node, 'class') || '');
    const nameAttr = safeAttr(node, 'name') || '';
    const isExplicitBlank = /(blank|cloze|gap)/i.test(`${cls} ${nameAttr}`) || safeHasAttr(node, 'data-blank');
    if (t === 'TEXTAREA' && !isExplicitBlank) {
      return true;
    }
    if (
      (t === 'INPUT' || isContentEditableElement(node)) &&
      !isExplicitBlank &&
      (/(text-answer|essay|open-response)/i.test(cls) || safeAttr(node, 'aria-multiline') === 'true')
    ) {
      return true;
    }
    if (
      safeAttr(node, 'draggable') === 'true' ||
      safeHasAttr(node, 'aria-grabbed') ||
      safeHasAttr(node, 'data-droppable') ||
      safeHasAttr(node, 'aria-dropeffect') ||
      safeHasAttr(node, 'data-dropzone')
    ) {
      return true;
    }
    if (
      /(?:^|\s)(?:options?|option-text|answer-text|choice-text|answer-option|quiz-option|choices?|answers?|answer-label|matching-pair|match-row)(?:\s|$)/i.test(cls) ||
      /(?:dropzone|drop-zone|drop-target|answer-option|quiz-option|option-item|choice-item)/i.test(cls)
    ) {
      return true;
    }
    return false;
  }

  function hasNonStemAncestor(el, stopAt) {
    let curr = el;
    let steps = 0;
    const seen = new WeakSet();
    while (curr && curr !== stopAt && steps < 40 && !seen.has(curr)) {
      seen.add(curr);
      if (isNonStemElement(curr)) return true;
      curr = getComposedParent(curr);
      steps++;
    }
    return false;
  }

  function findQuestionTextElement(container) {
    const specificSelectors = [
      '#qtext', '.qtext',
      '.question-text h3', '.question-text', 'legend',
      'h3', 'h4', '.q-text', '.question-content',
      '[class*="question-title"]', '[class*="questionText"]',
      '.question-prompt', '.prompt', '.question-stem', '.stem', 'h2'
    ];
    for (const sel of specificSelectors) {
      const matches = querySelectorAllDeep(sel, container);
      for (const found of matches) {
        if (hasNonStemAncestor(found, container)) continue;
        const txt = extractTextDeep(found, { includeBlankMarkers: true });
        if (txt && !isGenericSectionLabel(txt)) return found;
      }
    }
    // Fallback to <p> only if it is not inside an option/label/matching/dropzone container
    const paragraphs = querySelectorAllDeep('p', container);
    for (const p of paragraphs) {
      if (hasNonStemAncestor(p, container)) continue;
      const txt = extractTextDeep(p, { includeBlankMarkers: true });
      if (txt && !isGenericSectionLabel(txt)) {
        return p;
      }
    }
    return null;
  }

  function findPrecedingQuestionText(container, rootScope) {
    if (!container || typeof container !== 'object') return '';
    const headingTags = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P']);
    let sib = container.previousElementSibling;
    let steps = 0;
    while (sib && steps < 3) {
      if (sib === rootScope) break;
      if (isNonStemElement(sib) || containerHasInteractiveControls(sib)) break;
      const nested = findQuestionTextElement(sib);
      if (nested) {
        const nestedTxt = extractTextDeep(nested, { includeBlankMarkers: true });
        if (nestedTxt && !isGenericSectionLabel(nestedTxt)) {
          return nestedTxt;
        }
      }
      const tag = typeof sib.tagName === 'string' ? sib.tagName.toUpperCase() : '';
      if (headingTags.has(tag)) {
        const directTxt = extractTextDeep(sib, { includeBlankMarkers: true, skipNode: isNonStemElement });
        if (directTxt && !isGenericSectionLabel(directTxt)) {
          return directTxt;
        }
      }
      sib = sib.previousElementSibling;
      steps++;
    }
    return '';
  }

  function collectTextInputs(container) {
    const candidates = querySelectorAllDeep(
      'input[type="text"], input[type="number"], input:not([type]), textarea, [contenteditable="true"], [contenteditable=""]',
      container
    );
    const seen = new WeakSet();
    const valid = [];
    for (const el of candidates) {
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'INPUT') {
        const iType = (safeAttr(el, 'type') || el.type || 'text').toLowerCase();
        if (SKIPPED_INPUT_TYPES.has(iType)) continue;
      }
      if (safeAttr(el, 'contenteditable') === 'false') continue;
      valid.push(el);
    }
    return valid;
  }

  function isFillBlankPattern(textInputs, questionData, questionTextEl) {
    if (textInputs.length > 1) return true;
    if (BLANK_MARKER_RE.test(questionData.text || '')) return true;
    const el = textInputs[0];
    if (!el) return false;

    if (questionTextEl && typeof questionTextEl.contains === 'function') {
      try {
        if (questionTextEl.contains(el)) return true;
      } catch (e) { /* ignore */ }
    }

    const cls = typeof el.className === 'string' ? el.className : (safeAttr(el, 'class') || '');
    const nameAttr = safeAttr(el, 'name') || '';
    if (/(blank|cloze|gap)/i.test(`${cls} ${nameAttr}`) || safeHasAttr(el, 'data-blank')) {
      return true;
    }

    const isExplicitEssay = /(text-answer|essay|open-response)/i.test(cls) || safeAttr(el, 'aria-multiline') === 'true';
    if (isExplicitEssay) return false;

    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || isContentEditableElement(el)) {
      return true;
    }
    return false;
  }

  /**
   * Extract a single normalized question object from a container element.
   */
  async function extractQuestionFromContainer(container, index, opts = {}) {
    const rootScope = opts.rootScope || getDoc() || container;
    let questionTextEl = opts.questionTextEl || findQuestionTextElement(container);

    let extractedText = '';
    let genericFallbackText = '';
    if (opts.promptOverride) {
      extractedText = cleanText(opts.promptOverride);
    } else if (questionTextEl) {
      const cand = extractTextDeep(questionTextEl, { includeBlankMarkers: true });
      if (cand && !isGenericSectionLabel(cand)) {
        extractedText = cand;
      } else {
        if (cand) genericFallbackText = cand;
        const altEl = findQuestionTextElement(container);
        if (altEl) {
          questionTextEl = altEl;
          extractedText = extractTextDeep(altEl, { includeBlankMarkers: true });
        }
      }
    }
    if (!extractedText) {
      const ariaTxt = cleanText(
        safeAttr(container, 'aria-label') ||
        resolveAriaLabelledByText(container, container, rootScope) ||
        ''
      );
      if (ariaTxt && !isGenericSectionLabel(ariaTxt)) {
        extractedText = ariaTxt;
      }
    }
    if (!extractedText) {
      extractedText = findPrecedingQuestionText(container, rootScope);
    }
    if (!extractedText && opts.fallbackTextEl) {
      const fallbackOpts = { includeBlankMarkers: true };
      if (opts.fallbackTextEl === container) {
        fallbackOpts.skipNode = isNonStemElement;
      }
      const fb = extractTextDeep(opts.fallbackTextEl, fallbackOpts);
      if (fb && !isGenericSectionLabel(fb)) {
        extractedText = fb;
      } else if (fb && !genericFallbackText) {
        genericFallbackText = fb;
      }
    }
    if (!extractedText && genericFallbackText) {
      extractedText = genericFallbackText;
    }

    const questionData = {
      index: index + 1,
      element: container,
      text: extractedText,
      type: 'unknown',
      questionType: 'unknown',
      options: [],
      inputElement: null,
      images: [],
      inShadowDom: isInShadowDom(container)
    };

    questionData.images = await ImageCapture.captureAllImages(container);

    // 1. Native radio / checkbox inputs
    const nativeInputs = querySelectorAllDeep('input[type="radio"], input[type="checkbox"]', container);
    if (nativeInputs.length > 0) {
      const firstType = (safeAttr(nativeInputs[0], 'type') || nativeInputs[0].type || 'radio').toLowerCase();
      const isMulti = firstType === 'checkbox';
      questionData.type = isMulti ? 'checkbox' : 'radio';
      questionData.questionType = isMulti ? 'multi_choice' : 'single_choice';

      nativeInputs.forEach((input, idx) => {
        const label = findLabelForInput(input, container, rootScope);
        const optionText = extractInputOptionText(input, label, idx, container, rootScope);
        if (isInShadowDom(input)) questionData.inShadowDom = true;
        questionData.options.push({
          index: idx,
          element: input,
          labelElement: safeClosest(input, 'label', container) || label || input.parentElement,
          text: optionText,
          value: input.value !== undefined ? input.value : (safeAttr(input, 'value') ?? ''),
          checked: Boolean(input.checked)
        });
      });
    } else {
      // 2. ARIA radio / checkbox / listbox
      const ariaRadios = querySelectorAllDeep('[role="radio"]', container);
      const ariaCheckboxes = querySelectorAllDeep('[role="checkbox"]', container);
      const ariaListboxes = safeAttr(container, 'role') === 'listbox'
        ? [container, ...querySelectorAllDeep('[role="listbox"]', container)]
        : querySelectorAllDeep('[role="listbox"]', container);

      if (ariaRadios.length > 0) {
        questionData.type = 'radio';
        questionData.questionType = 'single_choice';
        ariaRadios.forEach((el, idx) => {
          const text = extractInputOptionText(el, el, idx, container, rootScope);
          if (isInShadowDom(el)) questionData.inShadowDom = true;
          questionData.options.push({
            index: idx,
            element: el,
            labelElement: el,
            text,
            value: safeAttr(el, 'data-value') ?? safeAttr(el, 'value') ?? text,
            checked: safeAttr(el, 'aria-checked') === 'true'
          });
        });
      } else if (ariaCheckboxes.length > 0) {
        questionData.type = 'checkbox';
        questionData.questionType = 'multi_choice';
        ariaCheckboxes.forEach((el, idx) => {
          const text = extractInputOptionText(el, el, idx, container, rootScope);
          if (isInShadowDom(el)) questionData.inShadowDom = true;
          questionData.options.push({
            index: idx,
            element: el,
            labelElement: el,
            text,
            value: safeAttr(el, 'data-value') ?? safeAttr(el, 'value') ?? text,
            checked: safeAttr(el, 'aria-checked') === 'true'
          });
        });
      } else if (ariaListboxes.length > 0) {
        const lb = ariaListboxes[0];
        const isMulti = safeAttr(lb, 'aria-multiselectable') === 'true';
        const roleOpts = querySelectorAllDeep('[role="option"]', lb);
        if (roleOpts.length > 0) {
          questionData.type = isMulti ? 'checkbox' : 'radio';
          questionData.questionType = isMulti ? 'multi_choice' : 'single_choice';
          roleOpts.forEach((el, idx) => {
            const text = extractInputOptionText(el, el, idx, container, rootScope);
            if (isInShadowDom(el)) questionData.inShadowDom = true;
            questionData.options.push({
              index: idx,
              element: el,
              labelElement: el,
              text,
              value: safeAttr(el, 'data-value') ?? safeAttr(el, 'value') ?? text,
              checked: safeAttr(el, 'aria-selected') === 'true'
            });
          });
        }
      }
    }

    // 3. Drag and Drop (if no choice options matched)
    if (questionData.questionType === 'unknown') {
      const rawDraggables = querySelectorAllDeep('[draggable="true"], [aria-grabbed]', container);
      const dropzones = querySelectorAllDeep(
        '[data-droppable], [aria-dropeffect], .dropzone, .drop-zone, .drop-target, [data-dropzone], [class*="dropzone"], [class*="drop-target"]',
        container
      );
      const draggables = dropzones.length > 0
        ? rawDraggables
        : rawDraggables.filter((el) => (el.tagName || '').toUpperCase() !== 'IMG' || safeHasAttr(el, 'aria-grabbed') || safeHasAttr(el, 'data-draggable'));

      if ((draggables.length > 0 && dropzones.length > 0) || draggables.length >= 2 || dropzones.length >= 1) {
        questionData.type = 'drag_drop';
        questionData.questionType = 'drag_drop';
        questionData.draggables = draggables.map((el, idx) => {
          if (isInShadowDom(el)) questionData.inShadowDom = true;
          const text = cleanText(extractTextDeep(el) || safeAttr(el, 'aria-label') || safeAttr(el, 'data-value') || `Item ${idx + 1}`);
          return {
            index: idx,
            element: el,
            id: el.id || safeAttr(el, 'id') || null,
            text,
            value: safeAttr(el, 'data-value') ?? el.id ?? text
          };
        });
        questionData.dropTargets = dropzones.map((el, idx) => {
          if (isInShadowDom(el)) questionData.inShadowDom = true;
          const label = cleanText(extractTextDeep(el) || safeAttr(el, 'aria-label') || safeAttr(el, 'data-target') || `Target ${idx + 1}`);
          return {
            index: idx,
            element: el,
            id: el.id || safeAttr(el, 'id') || null,
            label,
            text: label,
            accept: safeAttr(el, 'data-accept') || safeAttr(el, 'aria-dropeffect') || null
          };
        });
        questionData.targets = questionData.dropTargets;
        questionData.options = questionData.draggables.map((d) => ({
          index: d.index,
          element: d.element,
          labelElement: d.element,
          text: d.text,
          value: d.value,
          role: 'draggable'
        }));
      }
    }

    // 4. Select & Matching dropdowns
    if (questionData.questionType === 'unknown') {
      const selects = querySelectorAllDeep('select', container);
      if (selects.length > 0) {
        questionData.type = 'select_matching';
        questionData.questionType = 'select_matching';
        const selectEntries = [];

        selects.forEach((selectEl, sIdx) => {
          if (isInShadowDom(selectEl)) questionData.inShadowDom = true;
          const rawOpts = querySelectorAllDeep('option', selectEl);
          const optList = rawOpts.length > 0
            ? rawOpts
            : (selectEl.options ? Array.from(selectEl.options) : getChildElements(selectEl));
          const validOptions = [];

          optList.forEach((optEl, oIdx) => {
            if (isPlaceholderOption(optEl, oIdx, optList.length)) return;
            const txt = cleanText(extractTextDeep(optEl) || optEl.text || optEl.textContent || '');
            const val = optEl.value !== undefined ? String(optEl.value) : (safeAttr(optEl, 'value') ?? txt);
            if (!txt && !val) return;
            validOptions.push({
              index: validOptions.length,
              element: optEl,
              text: txt || val,
              value: val,
              selected: Boolean(optEl.selected)
            });
          });

          const pairLabel = extractSelectPairPrompt(selectEl, container, rootScope);
          selectEntries.push({
            index: sIdx,
            element: selectEl,
            label: pairLabel,
            options: validOptions
          });
        });

        questionData.selects = selectEntries;
        questionData.pairs = selectEntries.map((s) => ({
          index: s.index,
          prompt: s.label,
          selectElement: s.element,
          options: s.options
        }));

        if (selectEntries.length === 1) {
          questionData.options = selectEntries[0].options.map((o, i) => ({
            index: i,
            element: o.element,
            labelElement: selectEntries[0].element,
            text: o.text,
            value: o.value
          }));
        } else {
          questionData.options = selectEntries.map((s) => ({
            index: s.index,
            element: s.element,
            labelElement: s.element,
            text: s.label
              ? `${s.label} [${s.options.map((o) => o.text).join(' | ')}]`
              : s.options.map((o) => o.text).join(' | '),
            value: ''
          }));
        }
      }
    }

    // 5. Fill-in-the-blank & Open text fallback
    if (questionData.questionType === 'unknown') {
      const textInputs = collectTextInputs(container);
      if (textInputs.length > 0) {
        const isFillBlank = isFillBlankPattern(textInputs, questionData, questionTextEl);
        questionData.type = 'text';
        questionData.questionType = isFillBlank ? 'fill_blank' : 'text';
        questionData.inputElement = textInputs[0];
        questionData.inputElements = textInputs;
        questionData.blanks = textInputs.map((el, idx) => {
          if (isInShadowDom(el)) questionData.inShadowDom = true;
          return {
            index: idx,
            element: el,
            placeholder: safeAttr(el, 'placeholder') || '',
            value: el.value !== undefined ? String(el.value) : extractTextDeep(el),
            isContentEditable: isContentEditableElement(el)
          };
        });
      }
    }

    const hasInteractive = (
      questionData.options.length > 0 ||
      questionData.inputElement !== null ||
      questionData.images.length > 0 ||
      (questionData.dropTargets && questionData.dropTargets.length > 0) ||
      (questionData.selects && questionData.selects.length > 0)
    );

    if (!questionData.text || !hasInteractive) {
      return null;
    }

    return questionData;
  }

  async function extractQuestionFromCard(card, index, rootScope) {
    const q = await extractQuestionFromContainer(card, index, { rootScope, fallbackTextEl: card });
    if (q) {
      console.log(`📝 Q${index + 1}: "${q.text.substring(0, 50)}..." [${q.questionType}]`);
    }
    return q;
  }

  function containerHasInteractiveControls(node) {
    if (!node || typeof node !== 'object') return false;
    const found = querySelectorDeep(
      'input[type="radio"], input[type="checkbox"], input[type="text"], input[type="number"], input:not([type]), textarea, select, [contenteditable="true"], [contenteditable=""], [role="radio"], [role="checkbox"], [role="listbox"], [draggable="true"], [aria-grabbed], [data-droppable], [aria-dropeffect], .dropzone, .drop-zone, .drop-target, [data-dropzone], [class*="dropzone"], [class*="drop-target"]',
      node
    );
    return Boolean(found);
  }

  function resolveGenericContainer(element, rootScope) {
    let curr = element;
    let steps = 0;
    const seen = new WeakSet();
    while (curr && curr !== rootScope && steps < 10 && !seen.has(curr)) {
      seen.add(curr);
      if (curr.nodeType !== 11) {
        const tag = typeof curr.tagName === 'string' ? curr.tagName.toUpperCase() : '';
        if (tag === 'BODY' || tag === 'HTML') break;
        if (containerHasInteractiveControls(curr)) {
          return curr;
        }
      }
      curr = getComposedParent(curr);
      steps++;
    }
    const fallback = safeClosest(element, '.question-card, .question-block, [data-question], fieldset, section, article, li, form, div', rootScope);
    if (fallback && fallback.nodeType !== 11) return fallback;
    const parent = getComposedParent(element);
    if (parent && parent.nodeType === 11 && parent.host) {
      return parent.host;
    }
    const parentTag = parent && typeof parent.tagName === 'string' ? parent.tagName.toUpperCase() : '';
    if (parent && parent.nodeType !== 11 && parentTag !== 'BODY' && parentTag !== 'HTML') {
      return parent;
    }
    return element;
  }

  async function extractQuestionGeneric(element, index, rootScope) {
    const parent = resolveGenericContainer(element, rootScope);
    return extractQuestionFromContainer(parent, index, {
      rootScope,
      questionTextEl: element !== parent ? element : null,
      fallbackTextEl: element
    });
  }

  function filterTopLevelContainers(containers) {
    const set = new Set(containers);
    return containers.filter((el) => {
      let curr = getComposedParent(el);
      let steps = 0;
      const seen = new WeakSet();
      while (curr && steps < 40 && !seen.has(curr)) {
        seen.add(curr);
        if (set.has(curr)) return false;
        curr = getComposedParent(curr);
        steps++;
      }
      return true;
    });
  }

  async function extractQuizData(root = null, options = {}) {
    const targetRoot = root || getDoc();
    if (!targetRoot) {
      return { questions: [], totalImages: 0 };
    }

    console.log('📡 Phase 1: Détection via sélecteurs connus & Shadow DOM...');
    const questions = [];
    const seenContainers = new WeakSet();
    let totalImages = 0;

    function registerQuestion(q, container) {
      if (!q) return false;
      if (container && typeof container === 'object') {
        if (seenContainers.has(container)) return false;
        seenContainers.add(container);
      }
      totalImages += q.images.length;
      questions.push(q);
      return true;
    }

    // Tier 1A: Explicit question cards & structured blocks
    const questionCards = querySelectorAllDeep('.question-card', targetRoot);
    console.log('🔍 Question cards trouvées:', questionCards.length);

    if (questionCards.length > 0) {
      for (let index = 0; index < questionCards.length; index++) {
        const card = questionCards[index];
        if (seenContainers.has(card)) continue;
        const q = await extractQuestionFromCard(card, questions.length, targetRoot);
        registerQuestion(q, card);
      }
    } else {
      const blockContainers = filterTopLevelContainers(
        querySelectorAllDeep('.question-block, .quiz-question-card, [data-question], fieldset', targetRoot)
      );
      for (let index = 0; index < blockContainers.length; index++) {
        const block = blockContainers[index];
        if (seenContainers.has(block)) continue;
        const q = await extractQuestionFromContainer(block, questions.length, { rootScope: targetRoot, fallbackTextEl: block });
        registerQuestion(q, block);
      }
    }

    // Tier 1B: Generic question heading/prompt elements
    if (questions.length === 0) {
      const questionElements = querySelectorAllDeep(QUIZ_SELECTORS.question.join(','), targetRoot);
      console.log('🔍 Questions génériques trouvées:', questionElements.length);

      for (let index = 0; index < questionElements.length; index++) {
        const el = questionElements[index];
        if (hasNonStemAncestor(el, targetRoot)) continue;
        const candidateTxt = extractTextDeep(el, { includeBlankMarkers: true });
        if (!candidateTxt || isGenericSectionLabel(candidateTxt)) continue;
        const container = resolveGenericContainer(el, targetRoot);
        if (seenContainers.has(container)) continue;
        const q = await extractQuestionFromContainer(container, questions.length, {
          rootScope: targetRoot,
          questionTextEl: el !== container ? el : null,
          fallbackTextEl: el
        });
        registerQuestion(q, container);
      }
    }

    // Tier 1C: Standalone ARIA radiogroups / listboxes
    if (questions.length === 0) {
      const ariaGroups = filterTopLevelContainers(
        querySelectorAllDeep('[role="radiogroup"], [role="listbox"]', targetRoot)
      );
      for (let index = 0; index < ariaGroups.length; index++) {
        const grp = ariaGroups[index];
        if (seenContainers.has(grp)) continue;
        const prompt = safeAttr(grp, 'aria-label') || resolveAriaLabelledByText(grp, grp, targetRoot);
        const q = await extractQuestionFromContainer(grp, questions.length, {
          rootScope: targetRoot,
          promptOverride: prompt
        });
        registerQuestion(q, grp);
      }
    }

    // Normalize contiguous 1-based indices
    for (let i = 0; i < questions.length; i++) {
      questions[i].index = i + 1;
    }

    if (questions.length > 0) {
      console.log(`✅ Phase 1: ${questions.length} questions trouvées`);
      return { questions, totalImages };
    }

    // Phase 2 & 3: SchemaCache & SchemaDetector (when running inside browser extension)
    if (!options.skipAdaptive && typeof SchemaCache !== 'undefined' && typeof SchemaDetector !== 'undefined') {
      console.log('📡 Phase 2: Recherche de schéma en cache...');
      const win = getWin();
      const hostname = win && win.location ? win.location.hostname : '';

      try {
        const cachedSchema = await SchemaCache.getCachedSchema(hostname);
        if (cachedSchema) {
          console.log(`✅ Phase 2: Schéma trouvé en cache pour ${hostname} (${cachedSchema.platform})`);
          const schemaResult = await SchemaDetector.applySchema(cachedSchema);
          if (schemaResult && schemaResult.questions && schemaResult.questions.length > 0) {
            console.log(`✅ Phase 2: ${schemaResult.questions.length} questions extraites via schéma en cache`);
            return schemaResult;
          }
          console.warn('⚠️ Phase 2: Schéma en cache mais aucune question extraite — schéma peut-être obsolète');
        } else {
          console.log(`ℹ️ Phase 2: Aucun schéma en cache pour ${hostname}`);
        }

        console.log('📡 Phase 3: Lancement de la découverte LLM...');
        const discoveredSchema = await SchemaDetector.discoverSchema(true);
        if (discoveredSchema) {
          await SchemaCache.saveSchema(hostname, discoveredSchema);
          console.log(`💾 Phase 3: SchemaMap sauvegardé pour ${hostname}`);
          const discoveryResult = await SchemaDetector.applySchema(discoveredSchema);
          if (discoveryResult && discoveryResult.questions && discoveryResult.questions.length > 0) {
            console.log(`✅ Phase 3: ${discoveryResult.questions.length} questions extraites via découverte LLM`);
            return discoveryResult;
          }
        } else {
          console.log('ℹ️ Phase 3: La découverte LLM n\'a pas trouvé de quiz');
        }
      } catch (adaptiveError) {
        console.error('❌ Erreur dans le pipeline adaptatif:', adaptiveError.message);
      }
    }

    console.log(`📋 Total: ${questions.length} questions, ${totalImages} images`);
    return { questions, totalImages };
  }

  function resolveBridgeOrigin(targetDoc, explicitOrigin) {
    if (typeof explicitOrigin === 'string') return explicitOrigin;
    try {
      if (targetDoc && targetDoc.location && typeof targetDoc.location.origin === 'string') {
        return targetDoc.location.origin;
      }
      const win = getWin();
      if (win && win.location && typeof win.location.origin === 'string') {
        return win.location.origin;
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  /**
   * Call the MAIN-world page-bridge via CustomEvent handshake on document (never window.postMessage('*')).
   * Gracefully resolves to null if page-bridge.js is not active on the page.
   */
  function requestPageBridge(action, actionOptions = {}, bridgeOptions = {}) {
    const targetDoc = bridgeOptions.document || getDoc();
    if (!targetDoc || typeof targetDoc.addEventListener !== 'function' || typeof targetDoc.dispatchEvent !== 'function') {
      return Promise.resolve(null);
    }

    const CustomEventCtor = bridgeOptions.CustomEvent || (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
    if (!CustomEventCtor) {
      return Promise.resolve(null);
    }

    const handshakeEvent = bridgeOptions.handshakeEvent || DEFAULT_BRIDGE_HANDSHAKE_EVENT;
    const timeoutMs = typeof bridgeOptions.timeoutMs === 'number' && bridgeOptions.timeoutMs > 0
      ? bridgeOptions.timeoutMs
      : 500;
    const channel = bridgeOptions.channel || `ch_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    const nonce = Math.random().toString(36).slice(2);
    const reqId = `req_${Math.random().toString(36).slice(2)}`;
    const expectedOrigin = resolveBridgeOrigin(targetDoc, bridgeOptions.origin);

    return new Promise((resolve) => {
      let settled = false;
      let handshakeAcked = false;
      let timer = null;

      function cleanup() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        targetDoc.removeEventListener(`${channel}:ack`, onAck);
        targetDoc.removeEventListener(`${channel}:res`, onRes);
      }

      function finish(val) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(val);
      }

      function isOriginValid(msg) {
        if (expectedOrigin && expectedOrigin !== 'null') {
          return msg.origin === expectedOrigin;
        }
        return msg.origin === undefined || msg.origin === '' || msg.origin === expectedOrigin;
      }

      function onRes(ev) {
        if (ev && ev.target && ev.target !== targetDoc) return;
        let msg = ev && ev.detail;
        if (typeof msg === 'string') {
          try {
            msg = JSON.parse(msg);
          } catch (e) {
            return;
          }
        }
        if (!msg || msg.id !== reqId || msg.nonce !== nonce || !isOriginValid(msg)) return;
        finish(msg);
      }

      function onAck(ev) {
        if (handshakeAcked) return;
        if (ev && ev.target && ev.target !== targetDoc) return;
        let msg = ev && ev.detail;
        if (typeof msg === 'string') {
          try {
            msg = JSON.parse(msg);
          } catch (e) {
            return;
          }
        }
        if (!msg || !msg.ready || msg.nonce !== nonce || !isOriginValid(msg)) return;
        handshakeAcked = true;
        if (typeof targetDoc.removeEventListener === 'function') {
          try { targetDoc.removeEventListener(`${channel}:ack`, onAck); } catch (e) { /* ignore */ }
        }
        targetDoc.dispatchEvent(new CustomEventCtor(`${channel}:req`, {
          detail: JSON.stringify({
            id: reqId,
            nonce,
            origin: expectedOrigin,
            action,
            options: actionOptions,
            closeChannel: true
          })
        }));
      }

      timer = setTimeout(() => {
        finish(handshakeAcked ? { ok: false, error: 'Bridge response timeout' } : null);
      }, timeoutMs);

      targetDoc.addEventListener(`${channel}:ack`, onAck);
      targetDoc.addEventListener(`${channel}:res`, onRes);

      targetDoc.dispatchEvent(new CustomEventCtor(handshakeEvent, {
        detail: JSON.stringify({ channel, nonce, origin: expectedOrigin })
      }));
    });
  }

  const DOMExtractor = {
    QUIZ_SELECTORS,
    ImageCapture,
    isElementVisible,
    cleanText,
    querySelectorAllDeep,
    querySelectorDeep,
    extractTextDeep,
    extractQuestionFromContainer,
    extractQuestionFromCard,
    extractQuestionGeneric,
    extractQuizData,
    requestPageBridge
  };

  const rootScope = getWin();
  if (rootScope) {
    rootScope.SafeExm = rootScope.SafeExm || {};
    rootScope.SafeExm.DOMExtractor = DOMExtractor;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DOMExtractor;
  }
})();
