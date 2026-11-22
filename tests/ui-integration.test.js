'use strict';
// Wave 2 Lot 5 — UI, Content Script, Highlight Manager, Popup Stats & Auto-Submit tests.
// Uses node:test and node:assert/strict with zero external dependencies.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TARGET_ROOT = process.env.TEST_TARGET_ROOT
  ? path.resolve(process.env.TEST_TARGET_ROOT)
  : path.resolve(__dirname, '..');

// ──────────────────────────────────────────────
// Minimal DOM Mock for VM Execution
// ──────────────────────────────────────────────

class MockElement {
  constructor(tagName = 'DIV', ownerDocument = null) {
    this.tagName = String(tagName).toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = ownerDocument;
    this.style = {};
    this.dataset = {};
    this.attributes = Object.create(null);
    this.children = [];
    this.childNodes = [];
    this.parentNode = null;
    this.parentElement = null;
    this.shadowRoot = null;
    this.isConnected = false;
    this.textContent = '';
    this.innerText = '';
    this.value = '';
    this.checked = false;
    this.selected = false;
    this.disabled = false;
    this.id = '';
    this.name = '';
    this.title = '';
    this._classSet = new Set();
    this._listeners = new Map();
    this.classList = {
      add: (...cls) => cls.forEach((c) => c && this._classSet.add(c)),
      remove: (...cls) => cls.forEach((c) => this._classSet.delete(c)),
      contains: (c) => this._classSet.has(c),
      toggle: (c, force) => {
        const shouldHave = force !== undefined ? Boolean(force) : !this._classSet.has(c);
        if (shouldHave) this._classSet.add(c);
        else this._classSet.delete(c);
        return shouldHave;
      }
    };
  }

  get className() {
    return Array.from(this._classSet).join(' ');
  }

  set className(val) {
    this._classSet = new Set(String(val || '').split(/\s+/).filter(Boolean));
  }

  setAttribute(name, value) {
    const strVal = String(value);
    this.attributes[name] = strVal;
    if (name === 'id') this.id = strVal;
    if (name === 'class') this.className = strVal;
  }

  getAttribute(name) {
    if (name === 'id' && this.id) return this.id;
    if (name === 'class' && this._classSet.size > 0) return this.className;
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  appendChild(child) {
    if (!child) return child;
    if (child.parentNode && typeof child.parentNode.removeChild === 'function') {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    child.parentElement = this.nodeType === 1 ? this : null;
    this._propagateConnection(child, this.isConnected);
    this.children.push(child);
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    const cIdx = this.childNodes.indexOf(child);
    if (cIdx !== -1) this.childNodes.splice(cIdx, 1);
    if (child) {
      child.parentNode = null;
      child.parentElement = null;
      this._propagateConnection(child, false);
    }
    return child;
  }

  replaceChildren(...newChildren) {
    while (this.children.length > 0) {
      this.removeChild(this.children[0]);
    }
    for (const c of newChildren) {
      this.appendChild(c);
    }
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  remove() {
    if (this.parentNode && typeof this.parentNode.removeChild === 'function') {
      this.parentNode.removeChild(this);
    }
  }

  _propagateConnection(node, connected) {
    if (!node || typeof node !== 'object') return;
    node.isConnected = Boolean(connected);
    if (Array.isArray(node.children)) {
      node.children.forEach((c) => this._propagateConnection(c, connected));
    }
    if (node.shadowRoot) {
      this._propagateConnection(node.shadowRoot, connected);
    }
  }

  attachShadow({ mode = 'open' } = {}) {
    const sr = new MockElement('#shadow-root', this.ownerDocument);
    sr.nodeType = 11;
    sr.mode = mode;
    sr.host = this;
    sr.isConnected = this.isConnected;
    this.shadowRoot = sr;
    return sr;
  }

  getRootNode(opts = {}) {
    let curr = this;
    while (curr.parentNode) {
      curr = curr.parentNode;
    }
    if (opts && opts.composed && curr.nodeType === 11 && curr.host) {
      return curr.host.getRootNode({ composed: true });
    }
    return curr;
  }

  contains(target) {
    if (!target) return false;
    if (target === this) return true;
    for (const child of this.children) {
      if (child === target || (typeof child.contains === 'function' && child.contains(target))) {
        return true;
      }
    }
    return false;
  }

  getBoundingClientRect() {
    return { top: 10, left: 10, right: 110, bottom: 40, width: 100, height: 30 };
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const arr = this._listeners.get(type);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx !== -1) arr.splice(idx, 1);
  }

  dispatchEvent(evt) {
    const type = evt && evt.type;
    const arr = this._listeners.get(type) || [];
    for (const fn of arr) {
      fn.call(this, evt);
    }
    return true;
  }

  click() {
    this.clickedCount = (this.clickedCount || 0) + 1;
    this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} });
  }

  querySelectorAll(selector) {
    const results = [];
    const tokens = String(selector || '').split(',').map((s) => s.trim()).filter(Boolean);
    const matchesToken = (el, tok) => {
      if (!el || el.nodeType !== 1) return false;
      if (tok === '*') return true;
      if (tok.startsWith('#')) return el.id === tok.slice(1);
      if (tok.startsWith('.')) return el.classList.contains(tok.slice(1));
      if (tok === 'button[type="submit"]') return el.tagName === 'BUTTON' && (el.type === 'submit' || el.getAttribute('type') === 'submit');
      if (tok === 'input[type="submit"]') return el.tagName === 'INPUT' && (el.type === 'submit' || el.getAttribute('type') === 'submit');
      if (tok === '[role="button"]') return el.getAttribute('role') === 'button';
      return el.tagName === tok.toUpperCase();
    };
    const walk = (node) => {
      for (const child of node.children || []) {
        if (tokens.some((t) => matchesToken(child, t))) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all[0] || null;
  }
}

function createMockDocument() {
  const doc = new MockElement('#document', null);
  doc.nodeType = 9;
  doc.isConnected = true;
  doc.documentElement = new MockElement('HTML', doc);
  doc.documentElement.isConnected = true;
  doc.head = new MockElement('HEAD', doc);
  doc.body = new MockElement('BODY', doc);
  doc.appendChild(doc.documentElement);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);

  doc.createElement = (tag) => new MockElement(tag, doc);
  doc.getElementById = (id) => {
    const find = (node) => {
      if (node.id === id) return node;
      for (const c of node.children || []) {
        const found = find(c);
        if (found) return found;
      }
      return null;
    };
    return find(doc.documentElement);
  };
  return doc;
}

function createSandboxEnvironment(overrides = {}) {
  const doc = createMockDocument();
  const consoleLogs = [];
  const runtimeMessages = [];
  const onMessageListeners = [];
  let configStore = {
    enabled: true,
    autoMode: false,
    highlightDiscretion: 'furtif',
    highlightColor: '#00b4ff',
    ...(overrides.config || {})
  };

  const ConfigCache = {
    _init: true,
    isInitialized: () => true,
    init: async () => {},
    get: (k) => configStore[k],
    getAll: () => ({ ...configStore }),
    set: (k, v) => { configStore[k] = v; },
    onChange: () => {}
  };

  const chromeMock = {
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => {
        runtimeMessages.push(msg);
        if (typeof overrides.onSendMessage === 'function') {
          const customResp = overrides.onSendMessage(msg);
          if (typeof cb === 'function') cb(customResp);
          return Promise.resolve(customResp);
        }
        if (typeof cb === 'function') cb({ success: true });
        return Promise.resolve({ success: true });
      },
      onMessage: {
        addListener: (fn) => onMessageListeners.push(fn)
      },
      connect: ({ name }) => {
        let msgListener = null;
        return {
          name,
          onMessage: { addListener: (fn) => { msgListener = fn; } },
          onDisconnect: { addListener: () => {} },
          disconnect: () => {},
          postMessage: (payload) => {
            if (typeof overrides.onPortPostMessage === 'function') {
              const resp = overrides.onPortPostMessage(payload);
              if (msgListener) setTimeout(() => msgListener(resp), 5);
            }
          }
        };
      }
    },
    storage: {
      sync: {
        get: async () => ({ ...configStore }),
        set: async (vals) => Object.assign(configStore, vals)
      },
      local: {
        get: async () => ({ ...(overrides.localStorage || {}) }),
        set: async () => {}
      }
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://quiz.example.com/test' }],
      sendMessage: async () => ({ success: true })
    }
  };

  const sandbox = {
    window: null,
    globalThis: null,
    document: doc,
    chrome: chromeMock,
    ConfigCache,
    SchemaDetector: overrides.SchemaDetector || {
      hasInteractiveContent: () => false,
      discoverSchema: async () => null
    },
    SchemaCache: {
      getCachedSchema: async () => null,
      saveSchema: async () => {}
    },
    console: {
      log: (...args) => consoleLogs.push(args),
      warn: (...args) => consoleLogs.push(args),
      error: (...args) => consoleLogs.push(args),
      info: (...args) => consoleLogs.push(args),
      group: () => {},
      groupEnd: () => {}
    },
    location: overrides.location || {
      pathname: '/course/page',
      href: 'https://example.com/course/page',
      hostname: 'example.com'
    },
    Event: class {
      constructor(type, init) {
        this.type = type;
        this.bubbles = Boolean(init && init.bubbles);
      }
    },
    MutationObserver: class {
      constructor(cb) { this.cb = cb; }
      observe() {}
      disconnect() {}
    },
    IntersectionObserver: class {
      constructor(cb) { this.cb = cb; }
      observe() {}
      disconnect() {}
    },
    WeakMap,
    WeakSet,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Math,
    Date,
    RegExp,
    Error,
    Promise,
    JSON,
    parseInt,
    isNaN,
    setTimeout,
    clearTimeout,
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.location = sandbox.location;

  return { sandbox, doc, consoleLogs, runtimeMessages, onMessageListeners, ConfigCache };
}

function loadScriptInSandbox(relPath, sandbox) {
  const fullPath = path.join(TARGET_ROOT, relPath);
  const code = fs.readFileSync(fullPath, 'utf8');
  vm.runInNewContext(code, sandbox, { filename: fullPath });
}

// ──────────────────────────────────────────────
// 1. Forensic Defect #1: Zero API Key / Secret Leak to Page Console
// ──────────────────────────────────────────────

test('content.js: settings logging never outputs API keys or contextFiles to console.log', async () => {
  let capturedTask = null;
  const { sandbox, doc, consoleLogs } = createSandboxEnvironment({
    config: {
      enabled: true,
      autoMode: false,
      selectedProvider: 'gemini',
      highlightDiscretion: 'furtif',
      geminiApiKey: 'AIzaSySUPER_SECRET_GEMINI_KEY_12345',
      claudeApiKey: 'sk-ant-SUPER_SECRET_CLAUDE_KEY_67890',
      groqApiKey: 'gsk_SUPER_SECRET_GROQ_KEY_ABCDEF',
      nvidiaApiKey: 'nvapi-SUPER_SECRET_NVIDIA_KEY_XYZ',
      mistralApiKey: 'MISTRAL_SUPER_SECRET_KEY_999',
      serpApiKey: 'SERP_SUPER_SECRET_KEY_888',
      contextFiles: [{ name: 'exam-secrets.pdf', content: 'CONFIDENTIAL_EXAM_CONTENT' }]
    },
    onPortPostMessage: (msg) => {
      capturedTask = msg.task;
      return {
        success: true,
        answers: [{ questionIndex: 0, optionIndices: [0], confidence: 90 }],
        metadata: { questionsTotal: 1, answersFound: 1, provider: 'gemini', totalDurationMs: 120 }
      };
    }
  });

  const qEl = doc.createElement('DIV');
  const optEl = doc.createElement('INPUT');
  const lblEl = doc.createElement('LABEL');
  qEl.appendChild(lblEl);
  lblEl.appendChild(optEl);
  doc.body.appendChild(qEl);

  sandbox.SafeExm = {
    DOMExtractor: {
      QUIZ_SELECTORS: { quizContainer: ['.quiz'] },
      isElementVisible: () => true,
      extractQuizData: async () => ({
        questions: [{
          index: 1,
          element: qEl,
          text: 'What is 2 + 2?',
          type: 'radio',
          questionType: 'single_choice',
          options: [{ index: 0, element: optEl, labelElement: lblEl, text: '4' }]
        }],
        totalImages: 0
      })
    }
  };

  loadScriptInSandbox('highlight-manager.js', sandbox);
  loadScriptInSandbox('content.js', sandbox);

  const secretSettings = sandbox.ConfigCache.getAll();
  const result = await sandbox.SafeExm.Content.handleAnalyzeQuiz(secretSettings, false, false);
  assert.equal(result.success, true);
  assert.ok(capturedTask, 'BackgroundAgent should still receive the task via internal port');

  const serializedLogs = JSON.stringify(consoleLogs);
  const forbiddenSecrets = [
    'AIzaSySUPER_SECRET_GEMINI_KEY_12345',
    'sk-ant-SUPER_SECRET_CLAUDE_KEY_67890',
    'gsk_SUPER_SECRET_GROQ_KEY_ABCDEF',
    'nvapi-SUPER_SECRET_NVIDIA_KEY_XYZ',
    'MISTRAL_SUPER_SECRET_KEY_999',
    'SERP_SUPER_SECRET_KEY_888',
    'CONFIDENTIAL_EXAM_CONTENT',
    'geminiApiKey',
    'claudeApiKey',
    'groqApiKey',
    'nvidiaApiKey',
    'mistralApiKey',
    'serpApiKey',
    'contextFiles'
  ];

  for (const secret of forbiddenSecrets) {
    assert.ok(!serializedLogs.includes(secret), `console.log leaked forbidden secret or key field: ${secret}`);
  }
});

// ──────────────────────────────────────────────
// 2. Forensic Defect #2: Auto Mode Delta Re-indexing
// ──────────────────────────────────────────────

test('content.js: Auto Mode delta filtering re-indexes newQuestions (1..N) so answer indices align', async () => {
  let sentQuestions = null;
  const { sandbox, doc } = createSandboxEnvironment({
    onPortPostMessage: (msg) => {
      sentQuestions = msg.task.questions;
      return {
        success: true,
        // BackgroundAgent returns 0-based questionIndex corresponding to 1-based q.index (1..2 -> 0..1)
        answers: [
          { questionIndex: 0, optionIndices: [1], confidence: 92 },
          { questionIndex: 1, optionIndices: [0], confidence: 88 }
        ],
        metadata: { questionsTotal: 2, answersFound: 2, provider: 'groq', totalDurationMs: 80 }
      };
    }
  });

  const makeQuestionDom = (text, idx) => {
    const qEl = doc.createElement('DIV');
    const lbl0 = doc.createElement('LABEL');
    const opt0 = doc.createElement('INPUT');
    const lbl1 = doc.createElement('LABEL');
    const opt1 = doc.createElement('INPUT');
    lbl0.appendChild(opt0);
    lbl1.appendChild(opt1);
    qEl.appendChild(lbl0);
    qEl.appendChild(lbl1);
    doc.body.appendChild(qEl);
    return {
      index: idx,
      element: qEl,
      text,
      type: 'radio',
      questionType: 'single_choice',
      options: [
        { index: 0, element: opt0, labelElement: lbl0, text: 'A' },
        { index: 1, element: opt1, labelElement: lbl1, text: 'B' }
      ]
    };
  };

  const allFourQuestions = [
    makeQuestionDom('Question already analyzed 1', 1),
    makeQuestionDom('Question already analyzed 2', 2),
    makeQuestionDom('New Delta Question 3', 3),
    makeQuestionDom('New Delta Question 4', 4)
  ];

  sandbox.SafeExm = {
    DOMExtractor: {
      QUIZ_SELECTORS: { quizContainer: ['.quiz'] },
      isElementVisible: () => true,
      extractQuizData: async () => ({
        questions: allFourQuestions.map((q) => ({ ...q })),
        totalImages: 0
      })
    }
  };

  loadScriptInSandbox('highlight-manager.js', sandbox);
  loadScriptInSandbox('content.js', sandbox);

  // Mark Q1 and Q2 as already analyzed
  const analyzedSet = sandbox.SafeExm.Content.getAnalyzedQuestionTexts();
  analyzedSet.add('Question already analyzed 1');
  analyzedSet.add('Question already analyzed 2');

  const res = await sandbox.SafeExm.Content.handleAnalyzeQuiz({ enabled: true, autoMode: true }, true, true);
  assert.equal(res.success, true);
  assert.ok(Array.isArray(sentQuestions), 'Questions must be sent to BackgroundAgent');
  assert.equal(sentQuestions.length, 2);
  assert.equal(sentQuestions[0].text, 'New Delta Question 3');
  assert.equal(sentQuestions[0].index, 1, 'First delta question must be re-indexed to 1');
  assert.equal(sentQuestions[1].text, 'New Delta Question 4');
  assert.equal(sentQuestions[1].index, 2, 'Second delta question must be re-indexed to 2');

  // Verify highlights were applied to Q3 option 1 and Q4 option 0
  assert.ok(allFourQuestions[2].options[1].labelElement.style.borderLeft.includes('3px solid'));
  assert.ok(allFourQuestions[3].options[0].labelElement.style.borderLeft.includes('3px solid'));
});

// ──────────────────────────────────────────────
// 3. Forensic Defect #3: Shadow DOM isElementConnected & isQuizPage
// ──────────────────────────────────────────────

test('highlight-manager.js & content.js: Shadow DOM elements do not trigger false NEEDS_HEAL and isQuizPage detects Shadow DOM quizzes', () => {
  const { sandbox, doc } = createSandboxEnvironment();

  // Host in document.body with an open ShadowRoot containing a quiz container and question
  const host = doc.createElement('DIV');
  doc.body.appendChild(host);
  const shadowRoot = host.attachShadow({ mode: 'open' });

  const quizContainer = doc.createElement('DIV');
  quizContainer.className = 'quiz-container';
  shadowRoot.appendChild(quizContainer);

  const qEl = doc.createElement('DIV');
  const lblEl = doc.createElement('LABEL');
  const optEl = doc.createElement('INPUT');
  lblEl.appendChild(optEl);
  qEl.appendChild(lblEl);
  quizContainer.appendChild(qEl);

  // Importantly, document.body.contains(optEl) is FALSE across ShadowRoot boundary
  assert.equal(doc.body.contains(optEl), false, 'Standard document.body.contains returns false across Shadow DOM');

  sandbox.SafeExm = {
    DOMExtractor: {
      QUIZ_SELECTORS: { quizContainer: ['.quiz-container'] },
      isElementVisible: () => true,
      querySelectorDeep: (sel) => {
        if (sel.includes('.quiz-container')) return quizContainer;
        return null;
      }
    }
  };
  sandbox.DOMExtractor = sandbox.SafeExm.DOMExtractor;

  loadScriptInSandbox('highlight-manager.js', sandbox);
  loadScriptInSandbox('content.js', sandbox);

  const HM = sandbox.SafeExm.HighlightManager;
  const Content = sandbox.SafeExm.Content;

  // 1. isElementConnected returns true for Shadow DOM element and false for detached element
  assert.equal(HM.isElementConnected(optEl), true, 'Shadow DOM element must be recognized as connected');
  const detachedEl = doc.createElement('INPUT');
  assert.equal(HM.isElementConnected(detachedEl), false, 'Detached element must return false');

  // 2. renderVisibleHighlights / verifyAndRepair returns 'OK' for Shadow DOM question (not 'NEEDS_HEAL')
  const shadowQuestion = {
    index: 1,
    element: qEl,
    text: 'Shadow DOM question?',
    type: 'radio',
    questionType: 'single_choice',
    options: [{ index: 0, element: optEl, labelElement: lblEl, text: 'Shadow Option' }]
  };
  const answers = [{ questionIndex: 0, optionIndices: [0], confidence: 90 }];
  const status = HM.renderVisibleHighlights([shadowQuestion], answers, '#00b4ff');
  assert.equal(status, 'OK', 'Shadow DOM elements must not trigger NEEDS_HEAL');

  // Negative control: detached element DOES trigger 'NEEDS_HEAL'
  const detachedQuestion = {
    index: 1,
    element: doc.createElement('DIV'),
    text: 'Detached question?',
    type: 'radio',
    questionType: 'single_choice',
    options: [{ index: 0, element: detachedEl, labelElement: detachedEl, text: 'Detached' }]
  };
  assert.equal(HM.renderVisibleHighlights([detachedQuestion], answers, '#00b4ff'), 'NEEDS_HEAL');

  // 3. isQuizPage() detects quiz inside Shadow DOM even when document.querySelector returns null
  assert.equal(doc.querySelector('.quiz-container'), null);
  assert.equal(Content.isQuizPage(), true, 'isQuizPage must detect Shadow DOM quiz via DOMExtractor.querySelectorDeep');
});

// ──────────────────────────────────────────────
// 4. F-INT-02 & F-UX-02: Confidence Badges, Cross-Validation & Ultra-Stealth
// ──────────────────────────────────────────────

test('highlight-manager.js: confidence badges (high/medium/low + crossValidationStatus) have zero data-qh-*, respect ultra-furtif, and clear in <50ms', async () => {
  const { sandbox, doc } = createSandboxEnvironment({
    config: { highlightDiscretion: 'furtif', highlightColor: '#00b4ff' }
  });

  sandbox.SafeExm = {
    DOMExtractor: {
      isElementVisible: () => true
    }
  };

  loadScriptInSandbox('highlight-manager.js', sandbox);
  const HM = sandbox.SafeExm.HighlightManager;

  const buildChoiceQ = (idx) => {
    const qEl = doc.createElement('DIV');
    const lblEl = doc.createElement('LABEL');
    const optEl = doc.createElement('INPUT');
    lblEl.appendChild(optEl);
    qEl.appendChild(lblEl);
    doc.body.appendChild(qEl);
    return {
      index: idx + 1,
      element: qEl,
      text: `Q${idx + 1}`,
      type: 'radio',
      questionType: 'single_choice',
      options: [{ index: 0, element: optEl, labelElement: lblEl, text: 'Option 1' }]
    };
  };

  // Also test new formats: select_matching, fill_blank, drag_drop
  const selectEl = doc.createElement('SELECT');
  const selectQEl = doc.createElement('DIV');
  selectQEl.appendChild(selectEl);
  doc.body.appendChild(selectQEl);
  const selectQ = {
    index: 4,
    element: selectQEl,
    text: 'Match item',
    type: 'select_matching',
    questionType: 'select_matching',
    selects: [{ index: 0, element: selectEl, options: [{ index: 0, text: 'Match A', value: 'A' }] }]
  };

  const dragEl = doc.createElement('DIV');
  const dropEl = doc.createElement('DIV');
  const dndQEl = doc.createElement('DIV');
  dndQEl.appendChild(dragEl);
  dndQEl.appendChild(dropEl);
  doc.body.appendChild(dndQEl);
  const dndQ = {
    index: 5,
    element: dndQEl,
    text: 'Drag item',
    type: 'drag_drop',
    questionType: 'drag_drop',
    draggables: [{ index: 0, element: dragEl, text: 'Item 1' }],
    dropTargets: [{ index: 0, element: dropEl, label: 'Zone 1' }]
  };

  const questions = [buildChoiceQ(0), buildChoiceQ(1), buildChoiceQ(2), selectQ, dndQ];
  const answers = [
    {
      questionIndex: 0,
      optionIndices: [0],
      confidence: 94,
      crossValidated: true,
      crossValidationStatus: 'confirmed',
      explanation: 'Verified by law statute'
    },
    {
      questionIndex: 1,
      optionIndices: [0],
      confidence: 65,
      crossValidated: true,
      crossValidationStatus: 'disagreed',
      explanation: 'Providers differed on nuance'
    },
    {
      questionIndex: 2,
      optionIndices: [0],
      confidence: 30,
      crossValidated: false,
      crossValidationStatus: 'unverified',
      explanation: 'Ambiguous stem'
    },
    {
      questionIndex: 3,
      optionIndices: [0],
      textAnswer: 'A',
      confidence: 88
    },
    {
      questionIndex: 4,
      optionIndices: [0],
      confidence: 82
    }
  ];

  await HM.applyHighlights(questions, answers, { stealthLevel: 'furtif' });

  const badges = HM.getActiveBadges();
  assert.equal(badges.length, 5, 'Should render 5 confidence badges in furtif mode');

  // Verify tier computation and cross-validation indicator text
  const meta0 = HM.getBadgeMetadata(badges[0]);
  assert.equal(meta0.confidenceTier, 'high');
  assert.ok(badges[0].textContent.includes('94%'));
  assert.ok(badges[0].textContent.includes('✓✓'), 'Confirmed cross-validation must display ✓✓');
  assert.equal(badges[0].title, 'Verified by law statute');

  const meta1 = HM.getBadgeMetadata(badges[1]);
  assert.equal(meta1.confidenceTier, 'medium');
  assert.ok(badges[1].textContent.includes('65%'));
  assert.ok(badges[1].textContent.includes('!'), 'Disagreed cross-validation must display !');

  const meta2 = HM.getBadgeMetadata(badges[2]);
  assert.equal(meta2.confidenceTier, 'low');
  assert.ok(badges[2].textContent.includes('30%'));

  // Verify ZERO data-qh-* attributes on any badge
  for (const b of badges) {
    const attrKeys = Object.keys(b.attributes || {});
    assert.ok(!attrKeys.some((k) => k.startsWith('data-qh-')), 'Badge must have zero data-qh-* attributes');
  }

  // Verify clearAllHighlights removes 100% of badges in < 50ms
  const t0 = Date.now();
  HM.clearAllHighlights();
  const elapsedMs = Date.now() - t0;
  assert.ok(elapsedMs < 50, `clearAllHighlights took ${elapsedMs}ms (must be < 50ms)`);
  assert.equal(HM.getActiveBadges().length, 0, 'All badges must be cleared');
  assert.equal(questions[0].options[0].labelElement.children.length, 1, 'Badge node must be detached from labelElement');

  // Negative control: ultra-furtif (or level 0) injects ZERO badge DOM nodes
  await HM.applyHighlights(questions, answers, { stealthLevel: 'ultra-furtif' });
  assert.equal(HM.getActiveBadges().length, 0, 'ultra-furtif must not inject any badge DOM node');
  assert.equal(questions[0].options[0].labelElement.children.length, 1, 'No badge child in ultra-furtif mode');

  // Setting toggle: showConfidenceBadge: false hides all percentage badges even in furtif/glow while preserving highlights
  await HM.applyHighlights(questions, answers, { stealthLevel: 'furtif', showConfidenceBadge: false });
  assert.equal(HM.getActiveBadges().length, 0, 'showConfidenceBadge: false must inject 0 badges in furtif mode');
  assert.equal(questions[0].options[0].labelElement.children.length, 1, 'No badge child when showConfidenceBadge is false');
  assert.ok(questions[0].options[0].labelElement.style.borderLeft, 'Option highlight must remain active when badges are disabled');

  await HM.applyHighlights(questions, answers, { stealthLevel: 'glow', showConfidenceBadge: false });
  assert.equal(HM.getActiveBadges().length, 0, 'showConfidenceBadge: false must inject 0 badges in glow mode');

  // ConfigCache fallback when options.showConfidenceBadge is omitted
  const { sandbox: sbCache, doc: docCache } = createSandboxEnvironment({
    config: { highlightDiscretion: 'furtif', highlightColor: '#00b4ff', showConfidenceBadge: false }
  });
  sbCache.SafeExm = { DOMExtractor: { isElementVisible: () => true } };
  loadScriptInSandbox('highlight-manager.js', sbCache);
  const HMCache = sbCache.SafeExm.HighlightManager;
  const qCacheEl = docCache.createElement('div');
  const lblCache = docCache.createElement('label');
  const inpCache = docCache.createElement('input');
  lblCache.appendChild(inpCache);
  qCacheEl.appendChild(lblCache);
  docCache.body.appendChild(qCacheEl);
  const qCache = [{ index: 1, questionType: 'single_choice', element: qCacheEl, options: [{ element: inpCache, labelElement: lblCache }] }];
  const aCache = [{ questionIndex: 0, optionIndices: [0], confidence: 100 }];

  await HMCache.applyHighlights(qCache, aCache, { stealthLevel: 'furtif' });
  assert.equal(HMCache.getActiveBadges().length, 0, 'ConfigCache showConfidenceBadge: false must suppress badges');

  await HMCache.applyHighlights(qCache, aCache, { stealthLevel: 'furtif', showConfidenceBadge: true });
  assert.equal(HMCache.getActiveBadges().length, 1, 'Explicit showConfidenceBadge: true must render badge');
  assert.ok(HMCache.getActiveBadges()[0].textContent.includes('100%'));

  // Wiring check: settings.html exposes #showConfidenceBadge and providers.js caches it in SYNC_KEYS
  const settingsHtml = fs.readFileSync(path.join(TARGET_ROOT, 'settings.html'), 'utf8');
  const providersJs = fs.readFileSync(path.join(TARGET_ROOT, 'providers.js'), 'utf8');
  assert.ok(settingsHtml.includes('id="showConfidenceBadge"'), 'settings.html must expose #showConfidenceBadge');
  assert.ok(providersJs.includes("'showConfidenceBadge'"), 'providers.js SYNC_KEYS must include showConfidenceBadge');
});

// ──────────────────────────────────────────────
// 5. F-AUTO-03: Opt-In Auto-Submit Intelligence & Panic Abort
// ──────────────────────────────────────────────

test('content.js (F-AUTO-03): opt-in gate, confidence threshold gate, jittered fill+submit across formats, and immediate Panic abort', async () => {
  const { sandbox, doc } = createSandboxEnvironment();

  sandbox.SafeExm = {
    DOMExtractor: {
      QUIZ_SELECTORS: { quizContainer: ['.quiz'] },
      isElementVisible: () => true,
      querySelectorAllDeep: (sel, scope) => (scope || doc).querySelectorAll(sel)
    }
  };

  loadScriptInSandbox('highlight-manager.js', sandbox);
  loadScriptInSandbox('content.js', sandbox);
  const Content = sandbox.SafeExm.Content;
  const HM = sandbox.SafeExm.HighlightManager;

  // Build form with radio, checkbox, select, text input, a cancel button, and a submit button
  const formEl = doc.createElement('FORM');
  doc.body.appendChild(formEl);

  const radio0 = doc.createElement('INPUT');
  const radio1 = doc.createElement('INPUT');
  const qRadio = {
    index: 1,
    element: formEl,
    text: 'Q1 Radio',
    type: 'radio',
    questionType: 'single_choice',
    options: [
      { index: 0, element: radio0, labelElement: radio0, text: 'Wrong' },
      { index: 1, element: radio1, labelElement: radio1, text: 'Correct' }
    ]
  };

  const chk0 = doc.createElement('INPUT');
  const chk1 = doc.createElement('INPUT');
  const qCheckbox = {
    index: 2,
    element: formEl,
    text: 'Q2 Checkbox',
    type: 'checkbox',
    questionType: 'multi_choice',
    options: [
      { index: 0, element: chk0, labelElement: chk0, text: 'Opt A' },
      { index: 1, element: chk1, labelElement: chk1, text: 'Opt B' }
    ]
  };

  const selectEl = doc.createElement('SELECT');
  const optElA = doc.createElement('OPTION');
  const optElB = doc.createElement('OPTION');
  const qSelect = {
    index: 3,
    element: formEl,
    text: 'Q3 Select',
    type: 'select_matching',
    questionType: 'select_matching',
    selects: [{
      index: 0,
      element: selectEl,
      options: [
        { index: 0, element: optElA, text: 'Paris', value: 'paris' },
        { index: 1, element: optElB, text: 'Lyon', value: 'lyon' }
      ]
    }]
  };

  const textInput = doc.createElement('INPUT');
  const qText = {
    index: 4,
    element: formEl,
    text: 'Q4 Fill Blank',
    type: 'text',
    questionType: 'fill_blank',
    inputElement: textInput,
    blanks: [{ index: 0, element: textInput }]
  };

  const cancelBtn = doc.createElement('BUTTON');
  cancelBtn.setAttribute('type', 'submit');
  cancelBtn.textContent = 'Annuler';
  formEl.appendChild(cancelBtn);

  const submitBtn = doc.createElement('BUTTON');
  submitBtn.setAttribute('type', 'submit');
  submitBtn.textContent = 'Valider le quiz';
  formEl.appendChild(submitBtn);

  const questions = [qRadio, qCheckbox, qSelect, qText];
  const highConfAnswers = [
    { questionIndex: 0, optionIndices: [1], confidence: 95 },
    { questionIndex: 1, optionIndices: [0, 1], confidence: 90 },
    { questionIndex: 2, optionIndices: [0], confidence: 92 },
    { questionIndex: 3, textAnswer: '42', confidence: 88 }
  ];

  // Negative Control 1: autoSubmitEnabled: false -> must NOT schedule
  const disabledRes = Content.scheduleAutoSubmit(questions, highConfAnswers, {
    autoSubmitEnabled: false,
    autoSubmitMinConfidence: 85,
    autoSubmitDelayMs: 300
  });
  assert.equal(disabledRes.scheduled, false);
  assert.equal(disabledRes.reason, 'disabled');
  assert.equal(submitBtn.clickedCount || 0, 0);

  // Negative Control 2: one answer below autoSubmitMinConfidence (70 < 85) -> must NOT schedule
  const lowConfAnswers = [
    { questionIndex: 0, optionIndices: [1], confidence: 95 },
    { questionIndex: 1, optionIndices: [0, 1], confidence: 70 },
    { questionIndex: 2, optionIndices: [0], confidence: 92 },
    { questionIndex: 3, textAnswer: '42', confidence: 88 }
  ];
  const lowConfRes = Content.scheduleAutoSubmit(questions, lowConfAnswers, {
    autoSubmitEnabled: true,
    autoSubmitMinConfidence: 85,
    autoSubmitDelayMs: 300
  });
  assert.equal(lowConfRes.scheduled, false);
  assert.equal(lowConfRes.reason, 'low_confidence');
  assert.equal(submitBtn.clickedCount || 0, 0);

  // Negative Control 3: Panic / clearAllHighlights called before timer fires -> aborts immediately!
  const abortSchedule = Content.scheduleAutoSubmit(questions, highConfAnswers, {
    autoSubmitEnabled: true,
    autoSubmitMinConfidence: 85,
    autoSubmitDelayMs: 400
  });
  assert.equal(abortSchedule.scheduled, true);
  HM.clearAllHighlights(); // Triggers Panic abort hook
  const abortOutcome = await abortSchedule.promise;
  assert.equal(abortOutcome.aborted, true);
  assert.equal(abortOutcome.executed, false);
  assert.equal(radio1.checked, false, 'Radio must not be filled after Panic abort');
  assert.equal(submitBtn.clickedCount || 0, 0, 'Submit must not be clicked after Panic abort');

  // Positive Case: all answers >= 85% -> fills all 4 formats and clicks non-destructive submit button
  const activeSchedule = Content.scheduleAutoSubmit(questions, highConfAnswers, {
    autoSubmitEnabled: true,
    autoSubmitMinConfidence: 85,
    autoSubmitDelayMs: 300
  }, formEl);
  assert.equal(activeSchedule.scheduled, true);
  assert.ok(activeSchedule.delayMs >= 240 && activeSchedule.delayMs <= 360, `Jittered delay ${activeSchedule.delayMs}ms out of expected [240..360] range`);

  const finalOutcome = await activeSchedule.promise;
  assert.equal(finalOutcome.executed, true);
  assert.equal(finalOutcome.submitted, true);
  assert.equal(radio1.checked, true, 'Single choice radio option 1 must be checked');
  assert.equal(chk0.checked, true, 'Checkbox option 0 must be checked');
  assert.equal(chk1.checked, true, 'Checkbox option 1 must be checked');
  assert.equal(selectEl.value, 'paris', 'Select dropdown must be set to paris');
  assert.equal(textInput.value, '42', 'Fill-in-the-blank input must be set to 42');
  assert.equal(cancelBtn.clickedCount || 0, 0, 'Destructive/Cancel button must never be clicked');
  assert.equal(submitBtn.clickedCount, 1, 'Valid submit button must be clicked exactly once');
});

// ──────────────────────────────────────────────
// 6. F-AUTO-02: Pre-Warm Providers Trigger
// ──────────────────────────────────────────────

test('content.js (F-AUTO-02): sends preWarmProviders once on quiz detection when enabled', () => {
  const { sandbox, doc, runtimeMessages } = createSandboxEnvironment({
    config: { enabled: true }
  });

  const quizDiv = doc.createElement('DIV');
  quizDiv.className = 'quiz-container';
  doc.body.appendChild(quizDiv);

  sandbox.SafeExm = {
    DOMExtractor: {
      QUIZ_SELECTORS: { quizContainer: ['.quiz-container'] },
      querySelectorDeep: (sel) => doc.querySelector(sel)
    }
  };

  loadScriptInSandbox('highlight-manager.js', sandbox);
  loadScriptInSandbox('content.js', sandbox);
  const Content = sandbox.SafeExm.Content;

  runtimeMessages.length = 0;
  Content.resetPreWarmState();

  // First call to isQuizPage() -> detects quiz and sends preWarmProviders once
  assert.equal(Content.isQuizPage(), true);
  const preWarmCalls1 = runtimeMessages.filter((m) => m && m.action === 'preWarmProviders');
  assert.equal(preWarmCalls1.length, 1, 'preWarmProviders must be sent on first quiz detection');

  // Second call to isQuizPage() on same page -> no duplicate message
  assert.equal(Content.isQuizPage(), true);
  const preWarmCalls2 = runtimeMessages.filter((m) => m && m.action === 'preWarmProviders');
  assert.equal(preWarmCalls2.length, 1, 'preWarmProviders must not be sent more than once per page');

  // Negative control: when extension is disabled, preWarmProviders is not sent
  Content.resetPreWarmState();
  Content.setEnabled(false);
  assert.equal(Content.isQuizPage(), true);
  const preWarmCalls3 = runtimeMessages.filter((m) => m && m.action === 'preWarmProviders');
  assert.equal(preWarmCalls3.length, 1, 'preWarmProviders must not fire when extension is disabled');
});

// ──────────────────────────────────────────────
// 7. F-ANA-03: Popup Provider Performance Analytics
// ──────────────────────────────────────────────

test('popup.js (F-ANA-03): renders provider metrics from getProviderStats using safe DOM APIs and supports resetProviderStats', async () => {
  const { sandbox, doc, runtimeMessages } = createSandboxEnvironment({
    onSendMessage: (msg) => {
      if (msg.action === 'getProviderStats') {
        return {
          success: true,
          stats: {
            providers: {
              groq: { requests: 10, successes: 9, failures: 1, avgLatencyMs: 320 },
              claude: { requests: 4, successes: 4, failures: 0, avgLatencyMs: 910 }
            },
            totals: { requests: 14, successes: 13, failures: 1, avgLatencyMs: 488 }
          }
        };
      }
      if (msg.action === 'resetProviderStats') {
        return { success: true };
      }
      return { success: true };
    }
  });

  // Create popup DOM containers
  const statsSection = doc.createElement('DETAILS');
  statsSection.id = 'providerStatsSection';
  const statsList = doc.createElement('DIV');
  statsList.id = 'providerStatsList';
  const resetBtn = doc.createElement('BUTTON');
  resetBtn.id = 'resetStatsBtn';
  statsSection.appendChild(resetBtn);
  statsSection.appendChild(statsList);
  doc.body.appendChild(statsSection);

  loadScriptInSandbox('popup.js', sandbox);
  const Popup = sandbox.SafeExmPopup;

  await Popup.loadProviderStats(statsList);

  assert.ok(runtimeMessages.some((m) => m.action === 'getProviderStats'), 'Popup must request getProviderStats');
  assert.equal(statsList.children.length, 2, 'Two provider rows (groq & claude) must be rendered');

  const row0Text = statsList.children[0].children.map((c) => c.textContent || c.children.map((x) => x.textContent).join(' ')).join(' ');
  assert.ok(row0Text.includes('Groq'), 'First row must display Groq');
  assert.ok(row0Text.includes('10 req'), 'First row must display 10 req');
  assert.ok(row0Text.includes('90%'), 'First row must display 90% success rate');
  assert.ok(row0Text.includes('320ms'), 'First row must display 320ms latency');
  assert.ok(row0Text.includes('$0.00'), 'Free provider Groq must display $0.00 cost');

  const row1Text = statsList.children[1].children.map((c) => c.textContent || c.children.map((x) => x.textContent).join(' ')).join(' ');
  assert.ok(row1Text.includes('Claude'), 'Second row must display Claude');
  assert.ok(row1Text.includes('100%'), 'Second row must display 100% success rate');
  assert.ok(row1Text.includes('$0.0060'), 'Paid provider Claude must display estimated cost');

  // Reset stats -> sends resetProviderStats and renders empty state
  await Popup.resetProviderStats(statsList);
  assert.ok(runtimeMessages.some((m) => m.action === 'resetProviderStats'), 'Popup must send resetProviderStats');
  assert.equal(statsList.children.length, 1);
  assert.equal(statsList.children[0].className, 'stats-empty');
});
