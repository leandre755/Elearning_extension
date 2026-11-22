'use strict';
// Behavioral regression tests for E2E runtime bugs BUG-01 through BUG-09.
// Zero external dependencies — Node 26 node:test + node:assert/strict.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TARGET_ROOT = process.env.TEST_TARGET_ROOT
  ? path.resolve(process.env.TEST_TARGET_ROOT)
  : path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Minimal deterministic DOM & sandbox helpers (local to this test file)
// ---------------------------------------------------------------------------
function makeElement(tag, attrs = {}, children = []) {
  const attrMap = new Map();
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) attrMap.set(k.toLowerCase(), String(v));
  }
  const el = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    nodeName: String(tag).toUpperCase(),
    parentNode: null,
    parentElement: null,
    childNodes: [],
    style: {},
    attributes: [],
    hidden: false,
    shadowRoot: null,
    isConnected: false,
    checked: Boolean(attrs.checked),
    selected: Boolean(attrs.selected),
    disabled: Boolean(attrs.disabled),
    title: '',
    value: attrs.value !== undefined ? String(attrs.value) : '',
    _classSet: new Set(String(attrs.class || '').split(/\s+/).filter(Boolean)),
    get id() { return attrMap.get('id') || ''; },
    set id(v) { attrMap.set('id', String(v)); syncAttrs(); },
    get name() { return attrMap.get('name') || ''; },
    get type() { return attrMap.get('type') || ''; },
    get htmlFor() { return attrMap.get('for') || ''; },
    get className() { return Array.from(this._classSet).join(' '); },
    set className(v) {
      this._classSet = new Set(String(v || '').split(/\s+/).filter(Boolean));
      attrMap.set('class', Array.from(this._classSet).join(' '));
      syncAttrs();
    },
    get children() { return this.childNodes.filter((c) => c.nodeType === 1); },
    get nextElementSibling() {
      if (!this.parentNode) return null;
      const sibs = this.parentNode.children;
      const i = sibs.indexOf(this);
      return i >= 0 && i + 1 < sibs.length ? sibs[i + 1] : null;
    },
    get previousElementSibling() {
      if (!this.parentNode) return null;
      const sibs = this.parentNode.children;
      const i = sibs.indexOf(this);
      return i > 0 ? sibs[i - 1] : null;
    },
    get textContent() { return this.childNodes.map((c) => c.textContent || '').join(''); },
    set textContent(v) { this.childNodes = v ? [{ nodeType: 3, textContent: String(v), parentNode: this }] : []; },
    get innerText() { return this.textContent; },
    set innerText(v) { this.textContent = v; },
    classList: null,
    getAttribute(name) {
      const k = String(name).toLowerCase();
      if (k === 'class' && this._classSet.size > 0) return this.className;
      return attrMap.has(k) ? attrMap.get(k) : null;
    },
    hasAttribute(name) { return attrMap.has(String(name).toLowerCase()); },
    setAttribute(name, val) {
      const k = String(name).toLowerCase();
      attrMap.set(k, String(val));
      if (k === 'class') this._classSet = new Set(String(val || '').split(/\s+/).filter(Boolean));
      syncAttrs();
    },
    appendChild(child) {
      if (typeof child === 'string') child = { nodeType: 3, textContent: child, parentNode: this };
      if (child.parentNode && typeof child.parentNode.removeChild === 'function') {
        child.parentNode.removeChild(child);
      }
      child.parentNode = this;
      if (child.nodeType === 1) child.parentElement = this;
      propagateConnected(child, this.isConnected);
      this.childNodes.push(child);
      return child;
    },
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx !== -1) this.childNodes.splice(idx, 1);
      if (child) {
        child.parentNode = null;
        child.parentElement = null;
        propagateConnected(child, false);
      }
      return child;
    },
    remove() {
      if (this.parentNode && typeof this.parentNode.removeChild === 'function') {
        this.parentNode.removeChild(this);
      }
    },
    getRootNode() {
      let c = this;
      while (c.parentNode) c = c.parentNode;
      return c;
    },
    contains(target) {
      let c = target;
      while (c) {
        if (c === this) return true;
        c = c.parentNode;
      }
      return false;
    },
    getBoundingClientRect() {
      return this.isConnected
        ? { top: 10, left: 10, right: 120, bottom: 40, width: 110, height: 30 }
        : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    matches(sel) { return matchesList(this, sel); },
    closest(sel) {
      let c = this;
      while (c && c.nodeType === 1) {
        if (matchesList(c, sel)) return c;
        c = c.parentElement;
      }
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const ch of n.children || []) {
          if (matchesList(ch, sel)) out.push(ch);
          walk(ch);
        }
      };
      walk(this);
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    addEventListener() {}
  };
  el.classList = {
    add: (...c) => { c.forEach((x) => x && el._classSet.add(x)); attrMap.set('class', el.className); syncAttrs(); },
    remove: (...c) => { c.forEach((x) => el._classSet.delete(x)); attrMap.set('class', el.className); syncAttrs(); },
    contains: (c) => el._classSet.has(c)
  };
  function syncAttrs() {
    el.attributes = Array.from(attrMap.entries()).map(([name, value]) => ({ name, value }));
  }
  syncAttrs();
  children.forEach((ch) => el.appendChild(ch));
  return el;
}

function propagateConnected(node, connected) {
  if (!node || typeof node !== 'object') return;
  node.isConnected = Boolean(connected);
  (node.childNodes || []).forEach((ch) => propagateConnected(ch, connected));
}

function matchesList(el, selList) {
  return String(selList || '').split(',').some((s) => matchesSingle(el, s.trim()));
}

function matchesSingle(el, sel) {
  if (!sel || !el || el.nodeType !== 1) return false;
  if (sel === '*') return true;
  const parts = sel.split(/\s+/);
  if (parts.length > 1) {
    if (!matchesSimple(el, parts[parts.length - 1])) return false;
    let anc = el.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      let ok = false;
      while (anc && anc.nodeType === 1) {
        if (matchesSimple(anc, parts[i])) { ok = true; anc = anc.parentElement; break; }
        anc = anc.parentElement;
      }
      if (!ok) return false;
    }
    return true;
  }
  return matchesSimple(el, sel);
}

function matchesSimple(el, simple) {
  let rest = simple;
  const nots = [];
  rest = rest.replace(/:not\(([^)]+)\)/g, (_, inner) => { nots.push(inner.trim()); return ''; });
  const attrs = [];
  rest = rest.replace(/\[([^\]=*]+)(\*?=)?(?:"([^"]*)"|'([^']*)'|([^\]]*))?\]/g, (_, n, op, v1, v2, v3) => {
    attrs.push({ name: n.trim(), op: op || null, val: v1 ?? v2 ?? v3 });
    return '';
  });
  const cls = [];
  rest = rest.replace(/\.([A-Za-z0-9_-]+)/g, (_, c) => { cls.push(c); return ''; });
  let id = null;
  rest = rest.replace(/#([A-Za-z0-9_-]+)/g, (_, i) => { id = i; return ''; });
  const tag = rest.trim().toUpperCase();
  if (tag && tag !== '*' && el.tagName !== tag) return false;
  if (id && el.id !== id) return false;
  for (const c of cls) if (!el.classList.contains(c)) return false;
  for (const a of attrs) {
    const raw = el.getAttribute(a.name);
    if (!a.op && raw === null) return false;
    if (a.op === '=' && raw !== a.val) return false;
    if (a.op === '*=' && (raw === null || !raw.includes(a.val))) return false;
  }
  for (const n of nots) if (matchesSimple(el, n)) return false;
  return true;
}

function makeDoc() {
  const doc = makeElement('#document');
  doc.nodeType = 9;
  doc.isConnected = true;
  const html = makeElement('HTML');
  html.isConnected = true;
  const head = makeElement('HEAD');
  const body = makeElement('BODY');
  doc.documentElement = html;
  doc.head = head;
  doc.body = body;
  doc.appendChild(html);
  html.appendChild(head);
  html.appendChild(body);
  doc.createElement = (tag) => makeElement(tag);
  doc.getElementById = (id) => doc.documentElement.querySelector(`#${id}`);
  return doc;
}

// ===========================================================================
// BUG-01: Residual #card-fireworks removed + testProvider defensive guards
// ===========================================================================
test('BUG-01: settings.html omits Fireworks card and settings.js testProvider handles unknown providers without crashing', async () => {
  const html = fs.readFileSync(path.join(TARGET_ROOT, 'settings.html'), 'utf8');
  assert.ok(!html.includes('card-fireworks'), 'settings.html must not contain #card-fireworks');
  assert.ok(!html.includes('fireworksApiKey'), 'settings.html must not contain fireworksApiKey');
  assert.ok(html.includes('card-groq') && html.includes('card-gemini') && html.includes('card-claude'));

  const doc = makeDoc();
  const saveStatus = makeElement('DIV', { id: 'saveStatus' });
  const groqInput = makeElement('INPUT', { id: 'groqApiKey', value: 'test-token' });
  doc.body.appendChild(saveStatus);
  doc.body.appendChild(groqInput);

  let callProviderArgs = null;
  const sandbox = {
    document: doc,
    window: null,
    chrome: { storage: { sync: { get: async () => ({}), set: async () => {} }, local: { get: async () => ({}), set: async () => {} } } },
    QuizProviders: {
      PROVIDERS: { groq: { name: 'Groq', defaultTextModel: 'llama-3.3-70b-versatile' } },
      DEFAULT_PRIORITY: ['groq'],
      callProvider: async (...args) => { callProviderArgs = args; return 'OK'; }
    },
    ModelRegistry: { syncProviderModels: async () => {} },
    console, setTimeout, clearTimeout
  };
  sandbox.window = sandbox;
  doc.addEventListener = () => {};
  vm.runInNewContext(fs.readFileSync(path.join(TARGET_ROOT, 'settings.js'), 'utf8'), sandbox);

  // Unknown provider without input AND with input must never throw TypeError
  const fakeBtn = { textContent: 'Tester', disabled: false, style: {} };
  await sandbox.testProvider('fireworks', fakeBtn);
  assert.equal(fakeBtn.disabled, false);
  assert.equal(fakeBtn.textContent, 'Tester');
  assert.ok(saveStatus.textContent.length > 0);

  const fwInput = makeElement('INPUT', { id: 'fireworksApiKey', value: 'dummy-value' });
  doc.body.appendChild(fwInput);
  await sandbox.testProvider('fireworks', fakeBtn);
  assert.equal(fakeBtn.disabled, false);
  assert.ok(saveStatus.textContent.includes('Fournisseur inconnu'));

  // Negative/nominal control: valid provider still calls QuizProviders.callProvider
  await sandbox.testProvider('groq', fakeBtn);
  assert.equal(callProviderArgs[0], 'groq');
  assert.ok(saveStatus.textContent.includes('réussi'));
});

// ===========================================================================
// BUG-02: select_matching, drag_drop, fill_blank prompts & XML parsing
// ===========================================================================
test('BUG-02: background-agent formats select_matching, drag_drop, fill_blank options in prompts and parses responses', async () => {
  const origChrome = globalThis.chrome;
  const origFetch = globalThis.fetch;
  try {
    globalThis.chrome = {
      runtime: { getURL: (p) => `chrome-extension://test/${p}` },
      storage: {
        local: { get: async () => ({ agentMemory: [] }) },
        sync: { get: async () => ({}) }
      }
    };
    globalThis.fetch = async (url) => {
      if (String(url).includes('system.md')) {
        return { ok: true, text: async () => fs.readFileSync(path.join(TARGET_ROOT, 'system.md'), 'utf8') };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const { _buildPrompt, _parseAIResponse } = require(path.join(TARGET_ROOT, 'background-agent.js'));

    const questions = [
      {
        index: 1,
        type: 'select_matching',
        questionType: 'select_matching',
        text: 'HTTP code for Not Found?',
        options: [{ text: '200 OK', value: '200' }, { text: '404 Not Found', value: '404' }],
        selects: [{ index: 0, label: '', options: [{ text: '200 OK', value: '200' }, { text: '404 Not Found', value: '404' }] }]
      },
      {
        index: 2,
        type: 'select_matching',
        questionType: 'select_matching',
        text: 'Match countries to capitals',
        options: [{ text: 'France [Paris | Rome]', value: '' }, { text: 'Italy [Paris | Rome]', value: '' }],
        selects: [
          { index: 0, label: 'France', options: [{ text: 'Paris' }, { text: 'Rome' }] },
          { index: 1, label: 'Italy', options: [{ text: 'Paris' }, { text: 'Rome' }] }
        ]
      },
      {
        index: 3,
        type: 'drag_drop',
        questionType: 'drag_drop',
        text: 'Match layers',
        options: [{ text: 'TCP' }, { text: 'HTTP' }],
        draggables: [{ text: 'TCP' }, { text: 'HTTP' }],
        dropTargets: [{ label: 'Transport Zone' }, { label: 'Application Zone' }]
      },
      {
        index: 4,
        type: 'text',
        questionType: 'fill_blank',
        text: 'Capital is ___ and currency is ___.',
        blanks: [{ index: 0 }, { index: 1 }]
      }
    ];

    const prompt = await _buildPrompt({ questions, totalImages: 0 }, '', [], { domainPreset: 'general' });
    assert.ok(prompt.user.includes('404 Not Found'), 'single select options must be included in prompt');
    assert.ok(prompt.user.includes('France: Paris | Rome'), 'multi-select matching pairs must be included');
    assert.ok(prompt.user.includes('Transport Zone'), 'drag_drop dropTargets must be included');
    assert.ok(prompt.user.includes('Application Zone'), 'drag_drop dropTargets must be included');
    assert.ok(prompt.user.includes('2 champs'), 'multi-blank fill_blank hint must be included');

    const xml = `<quiz_answers>
    <answer question_id="1" type="select_matching"><text_reply>404 Not Found</text_reply><confidence>91</confidence></answer>
    <answer question_id="2" type="select_matching"><text_reply>Paris | Rome</text_reply><confidence>90</confidence></answer>
    <answer question_id="3" type="drag_drop"><option_indices>1,2</option_indices><text_reply>TCP -> Transport Zone | HTTP -> Application Zone</text_reply><confidence>89</confidence></answer>
    <answer question_id="4" type="fill_blank"><text_reply>Tokyo | Yen</text_reply><confidence>95</confidence></answer>
  </quiz_answers>`;

    const parsed = _parseAIResponse(xml, questions);
    assert.equal(parsed.length, 4);
    assert.deepEqual(parsed[0].optionIndices, [1]);
    assert.equal(parsed[1].textAnswer, 'Paris | Rome');
    assert.deepEqual(parsed[2].optionIndices, [0, 1]);
    assert.equal(parsed[2].textAnswer, 'TCP -> Transport Zone | HTTP -> Application Zone');
    assert.equal(parsed[3].textAnswer, 'Tokyo | Yen');

    // Negative controls: malformed XML / OOB index
    assert.deepEqual(_parseAIResponse('no answers', questions), []);
    const oob = _parseAIResponse('<quiz_answers><answer question_id="1" type="radio"><option_index>99</option_index></answer></quiz_answers>', [questions[0]]);
    assert.equal(oob.length, 0);
  } finally {
    globalThis.fetch = origFetch;
    if (origChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = origChrome;
  }
});

// ===========================================================================
// BUG-03: Zero static CSS/DOM classes on badges & floating buttons
// ===========================================================================
test('BUG-03: HighlightManager badges and floating buttons have zero static classes and manifest drops static content.css', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(TARGET_ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.content_scripts[0].css, undefined, 'manifest must not inject static content.css');
  const css = fs.readFileSync(path.join(TARGET_ROOT, 'content.css'), 'utf8');
  assert.ok(!css.includes('qh-confidence-badge') && !css.includes('quiz-helper-float-button'));

  const doc = makeDoc();
  const qEl = makeElement('DIV');
  const lbl = makeElement('LABEL', {}, ['Answer A']);
  const radio = makeElement('INPUT', { type: 'radio' });
  const txtInput = makeElement('INPUT', { type: 'text' });
  lbl.appendChild(radio);
  qEl.appendChild(lbl);
  qEl.appendChild(txtInput);
  doc.body.appendChild(qEl);

  const sandbox = {
    window: null,
    globalThis: null,
    document: doc,
    console, setTimeout, clearTimeout,
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise,
    parseInt, isNaN,
    SafeExm: { DOMExtractor: { isElementVisible: () => true } },
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(TARGET_ROOT, 'highlight-manager.js'), 'utf8'), sandbox);
  const HM = sandbox.SafeExm.HighlightManager;

  await HM.applyHighlights(
    [
      { index: 1, element: qEl, text: 'Q1', type: 'radio', options: [{ index: 0, element: radio, labelElement: lbl, text: 'Answer A' }] },
      { index: 2, element: qEl, text: 'Q2', type: 'text', inputElement: txtInput }
    ],
    [
      { questionIndex: 0, optionIndices: [0], confidence: 95 },
      { questionIndex: 1, textAnswer: 'Hello', confidence: 88 }
    ],
    { stealthLevel: 'glow' }
  );

  const badges = HM.getActiveBadges();
  const floats = HM.getFloatingButtons();
  assert.equal(badges.length, 2);
  assert.equal(floats.length, 1);

  for (const el of [...badges, ...floats]) {
    assert.ok(!/qh-|quiz-helper|tier-|discreet|visible-mode|glow-mode/.test(el.className), `Static class leaked: ${el.className}`);
    assert.ok(el.className.startsWith(HM._styleTagId), `Class must use randomized session prefix: ${el.className}`);
  }
  const styleTag = doc.getElementById(HM._styleTagId);
  assert.ok(styleTag, 'Dynamic <style> tag must exist');
  assert.ok(styleTag.textContent.includes(`.${HM._styleTagId}-f:hover::after`), 'Tooltip styles must live inside dynamic style tag');
});

// ===========================================================================
// BUG-04: Opt-in passiveNetworkIntercept auto-wires MAIN bridge only when enabled
// ===========================================================================
test('BUG-04: content.js injects/enables page-bridge network interceptor strictly when passiveNetworkIntercept is true', async () => {
  const runScenario = async (initialLocalFlag) => {
    const doc = makeDoc();
    doc.addEventListener = () => {};
    const runtimeMessages = [];
    const bridgeCalls = [];
    let configState = { enabled: true, autoMode: false };
    let onChangeCb = null;

    const sandbox = {
      window: null, globalThis: null, document: doc,
      chrome: {
        runtime: {
          lastError: null,
          sendMessage: (msg, cb) => {
            runtimeMessages.push(msg);
            const resp = msg.action === 'injectPageBridge' ? { success: true } : { success: true };
            if (cb) cb(resp);
            return Promise.resolve(resp);
          },
          onMessage: { addListener() {} },
          connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {} })
        },
        storage: {
          local: {
            get: async () => ({ passiveNetworkIntercept: initialLocalFlag }),
            set: async () => {}
          },
          sync: { get: async () => configState, set: async () => {} }
        }
      },
      ConfigCache: {
        isInitialized: () => true,
        init: async () => {},
        get: (k) => configState[k],
        getAll: () => ({ ...configState }),
        onChange: (cb) => { onChangeCb = cb; }
      },
      SafeExm: {
        HighlightManager: { applyHighlights: async () => 'OK', clearAllHighlights() {}, isElementConnected: () => true },
        DOMExtractor: {
          QUIZ_SELECTORS: { quizContainer: ['.quiz'] },
          requestPageBridge: async (action) => {
            bridgeCalls.push(action);
            return { ok: true, data: { enabled: action === 'enableNetworkInterceptor' } };
          }
        }
      },
      location: { pathname: '/', href: 'https://quiz.example.com/', hostname: 'quiz.example.com' },
      console, setTimeout, clearTimeout,
      WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise, JSON, parseInt, isNaN,
      module: { exports: {} }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(TARGET_ROOT, 'content.js'), 'utf8'), sandbox);
    await new Promise((r) => setTimeout(r, 15));
    return { content: sandbox.SafeExm.Content, runtimeMessages, bridgeCalls, fireChange: (c) => onChangeCb(c) };
  };

  // Negative control: disabled by default -> zero injectPageBridge calls
  const offRun = await runScenario(false);
  assert.equal(offRun.runtimeMessages.filter((m) => m.action === 'injectPageBridge').length, 0);
  assert.deepEqual(offRun.bridgeCalls, []);
  assert.equal(offRun.content.isPassiveNetworkInterceptorEnabled(), false);

  // Toggling ON via ConfigCache.onChange -> injects + enables, toggling OFF -> restores
  offRun.fireChange({ passiveNetworkIntercept: { oldValue: false, newValue: true } });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(offRun.runtimeMessages.filter((m) => m.action === 'injectPageBridge').length, 1);
  assert.deepEqual(offRun.bridgeCalls, ['enableNetworkInterceptor']);
  assert.equal(offRun.content.isPassiveNetworkInterceptorEnabled(), true);

  offRun.fireChange({ passiveNetworkIntercept: { oldValue: true, newValue: false } });
  await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual(offRun.bridgeCalls, ['enableNetworkInterceptor', 'restoreNetworkInterceptor']);
  assert.equal(offRun.content.isPassiveNetworkInterceptorEnabled(), false);

  // Positive control: bootstrap when flag is already true
  const onRun = await runScenario(true);
  assert.equal(onRun.runtimeMessages.filter((m) => m.action === 'injectPageBridge').length, 1);
  assert.deepEqual(onRun.bridgeCalls, ['enableNetworkInterceptor']);
  assert.equal(onRun.content.isPassiveNetworkInterceptorEnabled(), true);
});

// ===========================================================================
// BUG-05: BackgroundAgent._callLLMWithTools records ProviderAnalytics metrics
// ===========================================================================
test('BUG-05: _callLLMWithTools records latency, successes, 429 rate-limits, and ignores aborted cancellations', async () => {
  const { QuizProviders, ProviderAnalytics } = require(path.join(TARGET_ROOT, 'providers.js'));
  const { _callLLMWithTools } = require(path.join(TARGET_ROOT, 'background-agent.js'));
  const origFetch = QuizProviders.extensionFetch;
  const origProviders = globalThis.QuizProviders;

  try {
    globalThis.QuizProviders = QuizProviders;
    await ProviderAnalytics.resetStats();

    let attempt = 0;
    QuizProviders.extensionFetch = async () => {
      attempt++;
      if (attempt === 1) {
        return { ok: false, status: 429, json: async () => ({ error: { message: 'rate limit' } }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '<quiz_answers></quiz_answers>' } }] })
      };
    };

    const res = await _callLLMWithTools(
      'groq',
      { groqApiKey: 'dummy-test-key' },
      QuizProviders.PROVIDERS.groq.defaultTextModel,
      { messages: [{ role: 'user', content: 'hi' }] },
      [],
      [],
      new AbortController().signal
    );
    assert.ok(res.model);

    const stats = ProviderAnalytics.getStats();
    assert.equal(stats.totals.requests, 2);
    assert.equal(stats.totals.failures, 1);
    assert.equal(stats.totals.rateLimits, 1);
    assert.equal(stats.totals.successes, 1);

    // Negative control: pre-aborted signal failure must not increment failures
    const ac = new AbortController();
    ac.abort();
    QuizProviders.extensionFetch = async () => { throw new Error('Aborted'); };
    await assert.rejects(() => _callLLMWithTools(
      'groq',
      { groqApiKey: 'dummy-test-key' },
      QuizProviders.PROVIDERS.groq.defaultTextModel,
      { messages: [{ role: 'user', content: 'hi' }] },
      [],
      [],
      ac.signal
    ));
    assert.equal(ProviderAnalytics.getStats().totals.requests, 2);
  } finally {
    QuizProviders.extensionFetch = origFetch;
    if (origProviders === undefined) delete globalThis.QuizProviders;
    else globalThis.QuizProviders = origProviders;
  }
});

// ===========================================================================
// BUG-06: Schema status & rediscovery contract between content.js & popup.js
// ===========================================================================
test('BUG-06: handleGetSchemaStatus and handleDiscoverSchema return { success, data } consumed by popup.js', async () => {
  const doc = makeDoc();
  doc.addEventListener = () => {};
  const btn = makeElement('BUTTON', { id: 'schemaRediscoverBtn' });
  const schemaStatus = makeElement('DIV', { id: 'schemaStatus' });
  const schemaIcon = makeElement('SPAN', { id: 'schemaIcon' });
  const schemaText = makeElement('SPAN', { id: 'schemaText' });
  doc.body.appendChild(schemaStatus);
  doc.body.appendChild(schemaIcon);
  doc.body.appendChild(schemaText);
  doc.body.appendChild(btn);

  let cached = null;
  const contentSandbox = {
    window: null, globalThis: null, document: doc,
    chrome: {
      runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage: (_m, cb) => cb && cb({ success: true }) },
      storage: { local: { get: async () => ({}), set: async () => {} }, sync: { get: async () => ({ enabled: true }) } }
    },
    ConfigCache: { isInitialized: () => true, init: async () => {}, get: () => true, getAll: () => ({ enabled: true }), onChange() {} },
    SchemaDetector: {
      hasInteractiveContent: () => true,
      discoverSchema: async () => ({ platform: 'W3 Test', questionContainer: '.q' })
    },
    SchemaCache: {
      getCachedSchema: async () => cached,
      saveSchema: async (_h, s) => { cached = s; }
    },
    SafeExm: { HighlightManager: { clearAllHighlights() {} } },
    location: { pathname: '/', href: 'https://quiz.test/', hostname: 'quiz.test' },
    console, setTimeout, clearTimeout,
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise, JSON, parseInt, isNaN,
    module: { exports: {} }
  };
  contentSandbox.window = contentSandbox;
  contentSandbox.globalThis = contentSandbox;
  vm.runInNewContext(fs.readFileSync(path.join(TARGET_ROOT, 'content.js'), 'utf8'), contentSandbox);
  const Content = contentSandbox.SafeExm.Content;

  const statusBefore = await Content.handleGetSchemaStatus();
  assert.equal(statusBefore.success, true);
  assert.equal(statusBefore.data.hasSchema, false);
  assert.equal(statusBefore.data.hasInteractive, true);

  const discRes = await Content.handleDiscoverSchema();
  assert.equal(discRes.success, true);
  assert.equal(discRes.data.platform, 'W3 Test');

  // Wire popup.js against live content handlers
  const popupSandbox = {
    document: doc,
    window: null,
    chrome: {
      runtime: { lastError: null, onMessage: { addListener() {} } },
      storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) } },
      tabs: {
        query: async () => [{ id: 1 }],
        sendMessage: (_id, msg, cb) => {
          const p = msg.action === 'getSchemaStatus' ? Content.handleGetSchemaStatus() : Content.handleDiscoverSchema();
          p.then((r) => cb(r));
        }
      }
    },
    console, setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date
  };
  popupSandbox.window = popupSandbox;
  vm.runInNewContext(fs.readFileSync(path.join(TARGET_ROOT, 'popup.js'), 'utf8'), popupSandbox);

  await popupSandbox.SafeExmPopup.checkSchemaStatus();
  assert.ok(schemaText.textContent.includes('Structure reconnue (W3 Test)'));
  await popupSandbox.SafeExmPopup.rediscoverSchema();
  assert.equal(schemaText.textContent, 'Structure apprise (W3 Test)');
});

// ===========================================================================
// BUG-07: Auto-Heal on detached zero-rect parent mutation + Delta append preserve
// ===========================================================================
test('BUG-07: Auto-Heal detects detached zero-rect nodes via parent childList and Delta append preserves connected highlights', async () => {
  const doc = makeDoc();
  const container = makeElement('DIV', { class: 'quiz' });
  doc.body.appendChild(container);

  function buildQ(text, val) {
    const qEl = makeElement('DIV', { class: 'question-card' });
    const lbl = makeElement('LABEL', {}, [val]);
    const inp = makeElement('INPUT', { type: 'radio', value: val });
    lbl.appendChild(inp);
    qEl.appendChild(lbl);
    container.appendChild(qEl);
    return { index: 1, element: qEl, text, type: 'radio', options: [{ index: 0, element: inp, labelElement: lbl, text: val }] };
  }

  let q1 = buildQ('Question 1', 'Right');
  const observedTargets = [];
  let moCallback = null;

  class MockMO {
    constructor(cb) { moCallback = cb; }
    observe(target, opts) { observedTargets.push({ target, opts }); }
    disconnect() { observedTargets.length = 0; }
  }

  let currentQuestions = [q1];
  const sandbox = {
    window: null, globalThis: null, document: doc,
    MutationObserver: MockMO,
    IntersectionObserver: class { observe() {} disconnect() {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise,
    parseInt, isNaN, console, setTimeout, clearTimeout,
    SafeExm: {
      DOMExtractor: {
        isElementVisible: (el) => Boolean(el && el.isConnected), // detached element has 0 rect in real browser!
        extractQuizData: async () => ({ questions: currentQuestions, totalImages: 0 })
      }
    },
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(TARGET_ROOT, 'highlight-manager.js'), 'utf8'), sandbox);
  const HM = sandbox.SafeExm.HighlightManager;

  await HM.applyHighlights([q1], [{ questionIndex: 0, optionIndices: [0], confidence: 95 }], { stealthLevel: 'furtif' });
  assert.ok(observedTargets.some((o) => o.target === container && o.opts.childList === true), 'parent container must be observed with childList');

  // Replace q1 node in DOM and trigger MO childList record -> must auto-heal even when detached getBoundingClientRect is 0
  const oldQ1 = q1.element;
  oldQ1.remove();
  const q1ReRendered = buildQ('Question 1', 'Right');
  currentQuestions = [q1ReRendered];
  moCallback([{ type: 'childList', addedNodes: [q1ReRendered.element], removedNodes: [oldQ1] }]);
  await new Promise((r) => setTimeout(r, 15));
  assert.ok(q1ReRendered.options[0].labelElement.style.borderLeft.includes('3px solid'), 'Re-rendered Q1 option must be highlighted automatically');

  // Part B: Delta append retains Q1 while adding Q2
  const q2 = buildQ('Question 2', 'Two');
  q2.index = 1;
  await HM.applyHighlights([q2], [{ questionIndex: 0, optionIndices: [0], confidence: 90 }], { stealthLevel: 'furtif', append: true });
  assert.ok(q1ReRendered.options[0].labelElement.style.borderLeft.includes('3px solid'), 'Q1 highlight must remain preserved after append:true');
  assert.ok(q2.options[0].labelElement.style.borderLeft.includes('3px solid'), 'Q2 highlight must be applied after append:true');
  assert.equal(HM.getActiveBadges().length, 2);

  // Negative control: append: false clears Q1
  await HM.applyHighlights([q2], [{ questionIndex: 0, optionIndices: [0], confidence: 90 }], { stealthLevel: 'furtif', append: false });
  assert.equal(q1ReRendered.options[0].labelElement.style.borderLeft, '');
  assert.equal(HM.getActiveBadges().length, 1);
});

// ===========================================================================
// BUG-08: SchemaDetector skips SVG/chrome + targets quiz root; DOMExtractor #qtext
// ===========================================================================
test('BUG-08: SchemaDetector finds W3Schools-style quiz beyond 500 nav/svg nodes and DOMExtractor Phase 1 extracts #qtext', async () => {
  const doc = makeDoc();
  const nav = makeElement('HEADER');
  for (let i = 0; i < 600; i++) {
    const svg = makeElement('svg'); // lowercase SVG element as in real DOM
    svg.appendChild(makeElement('path'));
    nav.appendChild(svg);
    nav.appendChild(makeElement('div', {}, [`Menu item ${i}`]));
  }
  doc.body.appendChild(nav);

  const qMain = makeElement('DIV', { id: 'quizmain' });
  const qCont = makeElement('DIV', { id: 'quizcontainer' });
  const h3Counter = makeElement('H3', {}, ['Question 1 of 40:']);
  const pQtext = makeElement('P', { id: 'qtext' }, ['What does HTML stand for?']);
  const form = makeElement('FORM', { id: 'quizform' });
  const alt = makeElement('DIV', { id: 'altcontainer' });
  for (const ans of ['Hyperlinks Markup', 'Hyper Text Markup Language', 'Home Tool Markup']) {
    const lbl = makeElement('LABEL', { class: 'radiocontainer' }, [
      ans,
      makeElement('INPUT', { type: 'radio', name: 'quiz', value: ans })
    ]);
    alt.appendChild(lbl);
  }
  form.appendChild(alt);
  qCont.appendChild(h3Counter);
  qCont.appendChild(pQtext);
  qCont.appendChild(form);
  qMain.appendChild(qCont);
  doc.body.appendChild(qMain);

  const sdSandbox = {
    document: doc,
    window: null,
    location: { href: 'https://www.w3schools.com/quiztest/', hostname: 'www.w3schools.com' },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    console,
    module: { exports: {} }
  };
  sdSandbox.window = sdSandbox;
  vm.runInNewContext(fs.readFileSync(path.join(TARGET_ROOT, 'schema-detector.js'), 'utf8'), sdSandbox);
  const skeleton = sdSandbox.SchemaDetector.buildDOMSkeleton();
  assert.ok(skeleton.includes('What does HTML stand for?'), 'DOM skeleton must include real #qtext prompt despite 600+ header/svg nodes');
  assert.ok(skeleton.includes('<input[type=radio]'), 'DOM skeleton must include quiz radio inputs');
  assert.ok(!skeleton.includes('<svg') && !skeleton.includes('<path'), 'DOM skeleton must skip lowercase <svg>/<path>');

  // Verify Phase 1 extraction
  const deSandbox = {
    document: doc, window: null, globalThis: null, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Date, Math, JSON, RegExp, Error, Promise,
    CustomEvent: class {}, console, setTimeout, clearTimeout, module: { exports: {} }
  };
  deSandbox.window = deSandbox;
  deSandbox.globalThis = deSandbox;
  vm.runInNewContext(fs.readFileSync(path.join(TARGET_ROOT, 'dom-extractor.js'), 'utf8'), deSandbox);
  const extracted = await deSandbox.SafeExm.DOMExtractor.extractQuizData(doc, { skipAdaptive: true });
  assert.equal(extracted.questions.length, 1);
  assert.equal(extracted.questions[0].text, 'What does HTML stand for?');
  assert.equal(extracted.questions[0].options.length, 3);
});

// ===========================================================================
// BUG-09: DOMExtractor ignores generic "Answers" heading and gets real W3docs stem
// ===========================================================================
test('BUG-09: DOMExtractor skips generic Answers legend and recovers preceding <h2> question stem on W3docs-style DOM', async () => {
  const doc = makeDoc();
  const card = makeElement('DIV', { 'data-testid': 'quiz-take' }, [
    makeElement('DIV', {}, [makeElement('SPAN', {}, ['Question 1 of 25'])]),
    makeElement('H2', {}, ['The <title> element must be located inside']),
    makeElement('FIELDSET', {}, [
      makeElement('LEGEND', { class: 'sr-only' }, ['Answers']),
      makeElement('LABEL', {}, [
        makeElement('INPUT', { type: 'radio', name: 'q32', value: '115' }),
        makeElement('SPAN', {}, ['the <head> element'])
      ]),
      makeElement('LABEL', {}, [
        makeElement('INPUT', { type: 'radio', name: 'q32', value: '116' }),
        makeElement('SPAN', {}, ['the <body> element'])
      ])
    ]),
    // Control check: second fieldset with an explicit real <legend> must still use its own legend,
    // and first question's stem must not bleed into a subsequent fieldset if preceded by controls
    makeElement('FIELDSET', {}, [
      makeElement('LEGEND', {}, ['What is 2 + 2?']),
      makeElement('LABEL', {}, [makeElement('INPUT', { type: 'radio', name: 'q33', value: '4' }), '4'])
    ])
  ]);
  doc.body.appendChild(card);

  const deSandbox = {
    document: doc, window: null, globalThis: null, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Date, Math, JSON, RegExp, Error, Promise,
    CustomEvent: class {}, console, setTimeout, clearTimeout, module: { exports: {} }
  };
  deSandbox.window = deSandbox;
  deSandbox.globalThis = deSandbox;
  vm.runInNewContext(fs.readFileSync(path.join(TARGET_ROOT, 'dom-extractor.js'), 'utf8'), deSandbox);
  const res = await deSandbox.SafeExm.DOMExtractor.extractQuizData(doc, { skipAdaptive: true });
  assert.equal(res.questions.length, 2);
  assert.equal(res.questions[0].text, 'The <title> element must be located inside');
  assert.equal(res.questions[1].text, 'What is 2 + 2?');
});

// ===========================================================================
// BUG-07b: Spec-compliant IntersectionObserver does not loop; isOwnUiMutation detects removed badges/floats/style
// ===========================================================================
test('BUG-07b: IntersectionObserver initial delivery causes zero redraw loop, hidden->visible draws once, and isOwnUiMutation recognizes cleared UI nodes', async () => {
  const doc = makeDoc();
  const container = makeElement('DIV', { class: 'quiz' });
  doc.body.appendChild(container);

  const origCreateElement = doc.createElement.bind(doc);
  let badgeSpanCreations = 0;
  doc.createElement = (tag) => {
    if (String(tag).toLowerCase() === 'span') badgeSpanCreations++;
    return origCreateElement(tag);
  };

  function makeRadioQuestion(text, val) {
    const qEl = makeElement('DIV', { class: 'question-card' });
    const lbl = makeElement('LABEL', {}, [val]);
    const inp = makeElement('INPUT', { type: 'radio', value: val });
    lbl.appendChild(inp);
    qEl.appendChild(lbl);
    container.appendChild(qEl);
    return { index: 1, element: qEl, text, type: 'radio', options: [{ index: 0, element: inp, labelElement: lbl, text: val }] };
  }

  const qVisible = makeRadioQuestion('Visible Q1', 'Alpha');
  const qHidden = makeRadioQuestion('Hidden Q2', 'Beta');
  const visibleMap = new WeakMap([[qVisible.element, true], [qHidden.element, false]]);

  let ioCallback = null;
  let ioObserveCalls = 0;
  let ioDisconnectCalls = 0;
  let ioDeliveries = 0;
  const activeIoTargets = new Set();

  class SpecMockIO {
    constructor(cb) {
      ioCallback = cb;
    }
    observe(target) {
      ioObserveCalls++;
      activeIoTargets.add(target);
      // Spec behavior in Chromium/Brave: observe() asynchronously emits initial intersection state
      queueMicrotask(() => {
        if (!activeIoTargets.has(target) || ioDeliveries >= 25) return;
        ioDeliveries++;
        ioCallback([{ target, isIntersecting: visibleMap.get(target) !== false }]);
      });
    }
    disconnect() {
      ioDisconnectCalls++;
      activeIoTargets.clear();
    }
  }

  const sandbox = {
    window: null, globalThis: null, document: doc,
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: SpecMockIO,
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise,
    parseInt, isNaN, console, setTimeout, clearTimeout, queueMicrotask,
    SafeExm: {
      DOMExtractor: {
        isElementVisible: (el) => {
          if (!el) return false;
          if (visibleMap.has(el)) return Boolean(visibleMap.get(el));
          return Boolean(el.isConnected);
        },
        extractQuizData: async () => ({ questions: [qVisible], totalImages: 0 })
      }
    },
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(TARGET_ROOT, 'highlight-manager.js'), 'utf8'), sandbox);
  const HM = sandbox.SafeExm.HighlightManager;

  // 1. Visible question: spec-compliant IO delivers initial isIntersecting:true -> MUST NOT trigger redraw loop
  await HM.applyHighlights([qVisible], [{ questionIndex: 0, optionIndices: [0], confidence: 95 }], { stealthLevel: 'furtif' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ioObserveCalls, 1, 'IO must observe once without disconnect/re-observe cycle');
  assert.equal(badgeSpanCreations, 1, 'Initial IO isIntersecting:true must NOT redraw already-rendered question');
  assert.ok(ioDeliveries <= 2, `Unexpected IO delivery loop: ${ioDeliveries}`);

  // 2. Hidden -> Visible transition renders once without disconnecting/re-observing IO
  badgeSpanCreations = 0;
  ioObserveCalls = 0;
  ioDisconnectCalls = 0;
  qHidden.index = 1;
  await HM.applyHighlights([qHidden], [{ questionIndex: 0, optionIndices: [0], confidence: 90 }], { stealthLevel: 'furtif' });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(badgeSpanCreations, 0, 'Hidden question must not create badge before becoming visible');
  assert.equal(ioObserveCalls, 1);

  visibleMap.set(qHidden.element, true);
  ioCallback([{ target: qHidden.element, isIntersecting: true }]);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(badgeSpanCreations, 1, 'Transition false -> true must highlight once');
  assert.equal(ioObserveCalls, 1, 'IO must remain attached rather than being re-observed');
  assert.equal(ioDisconnectCalls, 1, 'Only initial clearObservers disconnect during applyHighlights');

  // Repeat isIntersecting:true notification must be a no-op
  ioCallback([{ target: qHidden.element, isIntersecting: true }]);
  assert.equal(badgeSpanCreations, 1, 'Repeated isIntersecting:true must not redraw');

  // 3. isOwnUiMutation must still identify removed badges, floats, and <style> after clearAllHighlights()
  const inp = makeElement('INPUT', { type: 'text' });
  const qFill = makeElement('DIV', { class: 'question-card' }, [inp]);
  container.appendChild(qFill);
  const fillQuestion = { index: 1, element: qFill, text: 'Fill blank', type: 'fill_blank', inputElement: inp };
  await HM.applyHighlights([fillQuestion], [{ questionIndex: 0, textAnswer: '443', confidence: 92 }], { stealthLevel: 'visible' });

  const badgeNode = HM.getActiveBadges()[0];
  const floatNode = HM.getFloatingButtons()[0];
  const styleNode = doc.getElementById(HM._styleTagId);
  assert.ok(badgeNode && floatNode && styleNode, 'Badge, float button, and style node must exist before clear');

  HM.clearAllHighlights();
  assert.equal(HM.isOwnUiMutation([{ type: 'childList', addedNodes: [], removedNodes: [badgeNode] }]), true);
  assert.equal(HM.isOwnUiMutation([{ type: 'childList', addedNodes: [], removedNodes: [floatNode] }]), true);
  assert.equal(HM.isOwnUiMutation([{ type: 'childList', addedNodes: [], removedNodes: [styleNode] }]), true);
  assert.equal(HM.isOwnUiMutation([{ type: 'childList', addedNodes: [badgeNode, floatNode], removedNodes: [] }]), true);

  const foreignNode = makeElement('DIV', { class: 'question-card' });
  assert.equal(HM.isOwnUiMutation([{ type: 'childList', addedNodes: [foreignNode], removedNodes: [] }]), false);
});

// ===========================================================================
// BUG-06b: popup.js analyzeQuiz does not re-inject content scripts on LLM error
// ===========================================================================
test('BUG-06b: popup.js analyzeQuiz does not call chrome.scripting.executeScript on { success: false }, only on missing receiver', async () => {
  function makePopupEnv(mode) {
    const doc = makeDoc();
    doc.addEventListener = () => {};
    const analyzeBtn = makeElement('BUTTON', { id: 'analyzeBtn' });
    const progressSection = makeElement('DIV', { id: 'progressSection' });
    const progressBarFill = makeElement('DIV', { id: 'progressBarFill' });
    const progressText = makeElement('SPAN', { id: 'progressText' });
    const progressPercentage = makeElement('SPAN', { id: 'progressPercentage' });
    doc.body.appendChild(analyzeBtn);
    doc.body.appendChild(progressSection);
    doc.body.appendChild(progressBarFill);
    doc.body.appendChild(progressPercentage);
    doc.body.appendChild(progressText);

    let sendCalls = 0;
    const executeScriptCalls = [];
    const chromeMock = {
      runtime: {
        lastError: null,
        onMessage: { addListener() {} },
        sendMessage: (_msg, cb) => {
          if (typeof cb === 'function') cb({ success: true, stats: {} });
        }
      },
      storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) } },
      tabs: {
        query: async () => [{ id: 42 }],
        sendMessage: (_tabId, _msg, cb) => {
          sendCalls++;
          if (mode === 'llm_error') {
            chromeMock.runtime.lastError = null;
            cb({ success: false, error: 'Simulated Claude outage' });
            return;
          }
          if (mode === 'missing_then_ok') {
            if (sendCalls === 1) {
              chromeMock.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
              cb(undefined);
              chromeMock.runtime.lastError = null;
            } else {
              chromeMock.runtime.lastError = null;
              cb({ success: true, data: { questionsFound: 1, answersHighlighted: 1 } });
            }
          }
        }
      },
      scripting: {
        executeScript: async (opts) => {
          executeScriptCalls.push(opts.files);
          return [];
        }
      }
    };

    const sandbox = {
      document: doc,
      window: null,
      chrome: chromeMock,
      console, setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error
    };
    sandbox.window = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(TARGET_ROOT, 'popup.js'), 'utf8'), sandbox);
    return {
      PopupAPI: sandbox.SafeExmPopup,
      progressText,
      getSendCalls: () => sendCalls,
      executeScriptCalls
    };
  }

  // Case 1: { success: false } must show error cleanly with ZERO executeScript calls and 1 sendMessage call
  const errEnv = makePopupEnv('llm_error');
  await errEnv.PopupAPI.analyzeQuiz();
  assert.equal(errEnv.getSendCalls(), 1, 'LLM failure must not re-run analyzeQuiz');
  assert.equal(errEnv.executeScriptCalls.length, 0, 'LLM failure must never re-inject content scripts');
  assert.equal(errEnv.progressText.textContent, '❌ Erreur: Simulated Claude outage');

  // Case 2: Positive control — missing receiver triggers injection and retries once
  const missEnv = makePopupEnv('missing_then_ok');
  await missEnv.PopupAPI.analyzeQuiz();
  assert.equal(missEnv.getSendCalls(), 2, 'Missing receiver must retry once after script injection');
  assert.equal(missEnv.executeScriptCalls.length, 6, 'Missing receiver must inject all 6 core files');
  assert.ok(missEnv.progressText.textContent.includes('✅ Surligné 1/1 réponse'));
});

// ===========================================================================
// ANTIBUG-01 & ANTIBUG-04: drag_drop multi-index/cross-val & fill_blank normalization
// ===========================================================================
test('ANTIBUG-01 & ANTIBUG-04: drag_drop preserves pairings/all indices/cross-val agreement and fill_blank normalizes uniformly', () => {
  const { _parseAIResponse, _answersAgree, _mapToolAnswersToParsedAnswers } = require(path.join(TARGET_ROOT, 'background-agent.js'));

  const dragQ = {
    index: 1,
    type: 'drag_drop',
    questionType: 'drag_drop',
    text: 'Match layers',
    options: [{ text: 'TCP' }, { text: 'HTTP' }],
    draggables: [{ text: 'TCP' }, { text: 'HTTP' }],
    dropTargets: [{ label: 'Transport Zone' }, { label: 'Application Zone' }]
  };

  // 1a. type="checkbox" preserves <text_reply> on drag_drop
  const pCheckbox = _parseAIResponse(
    '<quiz_answers><answer question_id="1" type="checkbox"><option_indices>1,2</option_indices><text_reply>TCP -> Transport Zone | HTTP -> Application Zone</text_reply><confidence>90</confidence></answer></quiz_answers>',
    [dragQ]
  );
  assert.deepEqual(pCheckbox[0].optionIndices, [0, 1]);
  assert.equal(pCheckbox[0].textAnswer, 'TCP -> Transport Zone | HTTP -> Application Zone');

  // 1b. type="text" and type="drag_drop" without <option_indices> recover ALL draggables ([0, 1]) without target collision
  const pText = _parseAIResponse(
    '<quiz_answers><answer question_id="1" type="text"><text_reply>TCP -> Transport Zone | HTTP -> Application Zone</text_reply></answer></quiz_answers>',
    [dragQ]
  );
  assert.deepEqual(pText[0].optionIndices, [0, 1]);

  const pDrag = _parseAIResponse(
    '<quiz_answers><answer question_id="1" type="drag_drop"><text_reply>TCP -> Transport Zone | HTTP -> Application Zone</text_reply></answer></quiz_answers>',
    [dragQ]
  );
  assert.deepEqual(pDrag[0].optionIndices, [0, 1]);

  // 1c. Contradictory target pairings disagree in _answersAgree even when optionIndices are equal
  assert.equal(
    _answersAgree(
      { optionIndices: [0, 1], textAnswer: 'TCP -> Transport Zone | HTTP -> Application Zone' },
      { optionIndices: [0, 1], textAnswer: 'TCP -> Application Zone | HTTP -> Transport Zone' },
      dragQ
    ),
    false
  );
  assert.equal(
    _answersAgree(
      { optionIndices: [0, 1], textAnswer: 'TCP -> Transport Zone | HTTP -> Application Zone' },
      { optionIndices: [0, 1], textAnswer: 'TCP -> Transport Zone | HTTP -> Application Zone' },
      dragQ
    ),
    true
  );

  // 4a. fill_blank numeric answers preserved as textAnswer across tool calls, Level 2, and Level 3
  const fillQ = { index: 1, type: 'fill_blank', questionType: 'fill_blank', text: 'HTTPS default port is ___.' };
  const mappedFill = _mapToolAnswersToParsedAnswers([{ questionIndex: 0, answers: ['443'], confidence: 94 }], [fillQ]);
  assert.equal(mappedFill.length, 1);
  assert.deepEqual(mappedFill[0].optionIndices, []);
  assert.equal(mappedFill[0].textAnswer, '443');

  const lvl2Fill = _parseAIResponse('1. 443', [fillQ]);
  assert.equal(lvl2Fill.length, 1);
  assert.deepEqual(lvl2Fill[0].optionIndices, []);
  assert.equal(lvl2Fill[0].textAnswer, '443');

  const lvl3Fill = _parseAIResponse('Question 1: 443', [fillQ]);
  assert.equal(lvl3Fill.length, 1);
  assert.deepEqual(lvl3Fill[0].optionIndices, []);
  assert.equal(lvl3Fill[0].textAnswer, '443');

  // 4b. Empty whitespace <text_reply> on select_matching must not emit empty entry
  const selQ = {
    index: 1,
    type: 'select_matching',
    questionType: 'select_matching',
    text: 'Pick HTTP code',
    options: [{ text: '200 OK' }, { text: '404 Not Found' }],
    selects: [{ index: 0, options: [{ text: '200 OK' }, { text: '404 Not Found' }] }]
  };
  assert.deepEqual(
    _parseAIResponse('<quiz_answers><answer question_id="1" type="radio"><text_reply>   </text_reply></answer></quiz_answers>', [selQ]),
    []
  );
});

// ===========================================================================
// ANTIBUG-02: findSkeletonRoot resists unrelated toolbar <select> & keeps sibling stems
// ===========================================================================
test('ANTIBUG-02: findSkeletonRoot excludes toolbar <select> from hijacking <main> quiz and retains sibling <h2> on single textarea', () => {
  function runSkeleton(bodyChildren) {
    const doc = makeDoc();
    bodyChildren.forEach((ch) => doc.body.appendChild(ch));
    const sb = {
      document: doc,
      window: null,
      location: { href: 'https://quiz.example.com/', hostname: 'quiz.example.com' },
      Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
      console,
      module: { exports: {} }
    };
    sb.window = sb;
    vm.runInNewContext(fs.readFileSync(path.join(TARGET_ROOT, 'schema-detector.js'), 'utf8'), sb);
    return sb.SchemaDetector.buildDOMSkeleton();
  }

  // Case 1: Toolbar <select> outside <main> with custom [role="option"] quiz inside <main>
  const skCustom = runSkeleton([
    makeElement('DIV', { class: 'toolbar' }, [
      makeElement('SELECT', { id: 'lang' }, [makeElement('OPTION', {}, ['EN']), makeElement('OPTION', {}, ['FR'])])
    ]),
    makeElement('MAIN', {}, [
      makeElement('DIV', { class: 'quiz' }, [
        makeElement('H3', {}, ['What is HTTPS?']),
        makeElement('DIV', { role: 'option' }, ['Secure HTTP']),
        makeElement('DIV', { role: 'option' }, ['FTP'])
      ])
    ])
  ]);
  assert.ok(skCustom.includes('What is HTTPS?'), 'Custom quiz in <main> must not be dropped for toolbar <select>');
  assert.ok(!skCustom.includes('select#lang'), 'Toolbar <select> must be excluded from custom quiz skeleton');

  // Case 2: Sibling <h2> stem before <form><textarea></textarea></form>
  const skSibling = runSkeleton([
    makeElement('H2', {}, ['Explain TCP vs UDP.']),
    makeElement('FORM', {}, [makeElement('TEXTAREA', { name: 'ans' })])
  ]);
  assert.ok(skSibling.includes('Explain TCP vs UDP.'), 'Single-textarea quiz must retain sibling <h2> stem');
  assert.ok(skSibling.includes('<textarea'), 'Single-textarea quiz must retain textarea control');
});

// ===========================================================================
// ANTIBUG-03: Auto-Heal clears mismatched SPA pagination & prevents async race clobber
// ===========================================================================
test('ANTIBUG-03: HighlightManager clears mismatched SPA page questions and guards async repairDeadNodes against newer applyHighlights/clearAllHighlights', async () => {
  const doc = makeDoc();
  const container = makeElement('DIV', { class: 'quiz' });
  doc.body.appendChild(container);

  function buildQ(text, val) {
    const qEl = makeElement('DIV', { class: 'question-card' });
    const lbl = makeElement('LABEL', {}, [val]);
    const inp = makeElement('INPUT', { type: 'radio', value: val });
    lbl.appendChild(inp);
    qEl.appendChild(lbl);
    container.appendChild(qEl);
    return { index: 1, element: qEl, text, type: 'radio', options: [{ index: 0, element: inp, labelElement: lbl, text: val }] };
  }

  let moCallback = null;
  class MockMO {
    constructor(cb) { moCallback = cb; }
    observe() {}
    disconnect() {}
  }

  let resolveExtract = null;
  let nextExtractQueue = [];
  const sandbox = {
    window: null, globalThis: null, document: doc,
    MutationObserver: MockMO,
    IntersectionObserver: class { observe() {} disconnect() {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise,
    parseInt, isNaN, console, setTimeout, clearTimeout,
    SafeExm: {
      DOMExtractor: {
        isElementVisible: (el) => Boolean(el && el.isConnected),
        extractQuizData: () => {
          if (nextExtractQueue.length > 0) return nextExtractQueue.shift()();
          return new Promise((res) => { resolveExtract = res; });
        }
      }
    },
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(TARGET_ROOT, 'highlight-manager.js'), 'utf8'), sandbox);
  const HM = sandbox.SafeExm.HighlightManager;

  // Part A: SPA pagination swaps "What is 2+2?" (length 1) -> "Capital of Japan?" (length 1)
  const q1 = buildQ('What is 2+2?', '4');
  await HM.applyHighlights([q1], [{ questionIndex: 0, optionIndices: [0], confidence: 95 }], { stealthLevel: 'furtif' });
  assert.equal(HM.getActiveBadges().length, 1);

  q1.element.remove();
  const q2 = buildQ('Capital of Japan?', 'Osaka');
  nextExtractQueue.push(async () => ({ questions: [q2], totalImages: 0 }));
  moCallback([{ type: 'childList', addedNodes: [q2.element], removedNodes: [q1.element] }]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(q2.options[0].labelElement.style.borderLeft || '', '', 'Unseen Q2 must NOT inherit Q1 wrong highlight');
  assert.equal(HM.getActiveBadges().length, 0, 'Stale badges must be cleared on unrelated page transition');
  assert.equal(HM.getStoredHighlightData(), null);

  // Part B: Async race — newer applyHighlights() during in-flight repairDeadNodes must NOT be clobbered
  const qOld = buildQ('Old Question', 'Old');
  await HM.applyHighlights([qOld], [{ questionIndex: 0, optionIndices: [0], confidence: 90 }], { stealthLevel: 'furtif' });
  qOld.element.remove();
  const qOldRefreshed = buildQ('Old Question', 'Old');
  moCallback([{ type: 'childList', addedNodes: [qOldRefreshed.element], removedNodes: [qOld.element] }]);
  assert.ok(typeof resolveExtract === 'function', 'repairDeadNodes must be paused awaiting extractQuizData');

  const qNew = buildQ('Brand New Quiz', 'Fresh');
  await HM.applyHighlights([qNew], [{ questionIndex: 0, optionIndices: [0], confidence: 99 }], { stealthLevel: 'furtif' });

  // Stale extract resolves now
  resolveExtract({ questions: [qOldRefreshed], totalImages: 0 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(HM.getStoredHighlightData().questions[0].text, 'Brand New Quiz', 'Stale repairDeadNodes must not overwrite newer applyHighlights state');
  assert.equal(qOldRefreshed.options[0].labelElement.style.borderLeft || '', '', 'Stale Q must remain unhighlighted');
  assert.ok(qNew.options[0].labelElement.style.borderLeft.includes('3px solid'), 'Newer Q must remain highlighted');
});

// ===========================================================================
// ANTIBUG-P2: Exact-over-substring option matching & non-digit-scraping fallback
// ===========================================================================
test('ANTIBUG-P2: _matchOptionIndexByText prefers exact/boundary over substring and Level 2/3 never scrape numbers inside option labels', () => {
  const { _parseAIResponse } = require(path.join(TARGET_ROOT, 'background-agent.js'));

  // 1. drag_drop false-positive extra index: HTTP vs HTTPS
  const dragHttpQ = {
    index: 1,
    type: 'drag_drop',
    questionType: 'drag_drop',
    text: 'Match protocols',
    draggables: [{ text: 'HTTP' }, { text: 'HTTPS' }, { text: 'FTP' }],
    dropTargets: [{ label: 'Insecure Web' }, { label: 'Encrypted Web' }]
  };
  const resDragHttp = _parseAIResponse(
    '<quiz_answers><answer question_id="1" type="drag_drop"><text_reply>HTTP -> Insecure Web</text_reply></answer></quiz_answers>',
    [dragHttpQ]
  );
  assert.deepEqual(resDragHttp[0].optionIndices, [0], 'HTTP must NOT falsely match HTTPS');

  // 2. select_matching exact match wins over earlier substring (HTTP vs HTTPS, Java vs JavaScript)
  const selHttpQ = {
    index: 1,
    type: 'select_matching',
    questionType: 'select_matching',
    text: 'Port 80 protocol?',
    options: [{ text: 'HTTPS' }, { text: 'HTTP' }],
    selects: [{ index: 0, options: [{ text: 'HTTPS' }, { text: 'HTTP' }] }]
  };
  const resSelHttp = _parseAIResponse(
    '<quiz_answers><answer question_id="1" type="select_matching"><text_reply>HTTP</text_reply></answer></quiz_answers>',
    [selHttpQ]
  );
  assert.deepEqual(resSelHttp[0].optionIndices, [1]);

  const selJavaQ = {
    index: 1,
    type: 'select_matching',
    questionType: 'select_matching',
    text: 'JVM language?',
    options: [{ text: 'JavaScript' }, { text: 'Java' }],
    selects: [{ index: 0, options: [{ text: 'JavaScript' }, { text: 'Java' }] }]
  };
  const resSelJava = _parseAIResponse(
    '<quiz_answers><answer question_id="1" type="select_matching"><text_reply>Java</text_reply></answer></quiz_answers>',
    [selJavaQ]
  );
  assert.deepEqual(resSelJava[0].optionIndices, [1]);

  // 3. Level 2 '1. IPv4 -> Layer 3' on drag_drop must match IPv4 (0), NOT scrape 4 & 3
  const dragIpQ = {
    index: 1,
    type: 'drag_drop',
    questionType: 'drag_drop',
    text: 'Match protocol',
    options: [{ text: 'IPv4' }, { text: 'TCP' }, { text: 'HTTP' }, { text: 'DNS' }],
    draggables: [{ text: 'IPv4' }, { text: 'TCP' }, { text: 'HTTP' }, { text: 'DNS' }],
    dropTargets: [{ label: 'Layer 3' }, { label: 'Layer 4' }]
  };
  const resLvl2Ip = _parseAIResponse('1. IPv4 -> Layer 3', [dragIpQ]);
  assert.deepEqual(resLvl2Ip[0].optionIndices, [0]);
  assert.equal(resLvl2Ip[0].textAnswer, 'IPv4 -> Layer 3');

  // 4. Level 2 '1. HTTP/2' on select_matching must match HTTP/2 (2), NOT scrape 2 -> TCP (1)
  const selHttp2Q = {
    index: 1,
    type: 'select_matching',
    questionType: 'select_matching',
    text: 'Protocol?',
    options: [{ text: 'UDP' }, { text: 'TCP' }, { text: 'HTTP/2' }],
    selects: [{ index: 0, options: [{ text: 'UDP' }, { text: 'TCP' }, { text: 'HTTP/2' }] }]
  };
  const resLvl2Http2 = _parseAIResponse('1. HTTP/2', [selHttp2Q]);
  assert.deepEqual(resLvl2Http2[0].optionIndices, [2]);

  // 5. Level 3 'Question 1: HTTP -> Layer 7' must strip 'Question 1:', match HTTP (1), and preserve pairing
  const dragLayer7Q = {
    index: 1,
    type: 'drag_drop',
    questionType: 'drag_drop',
    text: 'Match layer',
    options: [{ text: 'TCP' }, { text: 'HTTP' }],
    draggables: [{ text: 'TCP' }, { text: 'HTTP' }],
    dropTargets: [{ label: 'Layer 7' }]
  };
  const resLvl3Drag = _parseAIResponse('Question 1: HTTP -> Layer 7', [dragLayer7Q]);
  assert.deepEqual(resLvl3Drag[0].optionIndices, [1]);
  assert.equal(resLvl3Drag[0].textAnswer, 'HTTP -> Layer 7');
});

// ===========================================================================
// ANTIBUG-P3: Punctuation equality, colon-in-label, fraction options, chunked tool map, sibling stem skeleton
// ===========================================================================
test('ANTIBUG-P3: strict lowercase beats punctuation strip, arrow before colon, fraction options, chunked tool map, sibling stem skeleton', () => {
  const { _parseAIResponse, _mapToolAnswersToParsedAnswers } = require(path.join(TARGET_ROOT, 'background-agent.js'));

  // 1. Strict lowercase equality ('C++' vs 'C#')
  const selCppQ = {
    index: 1,
    type: 'select_matching',
    questionType: 'select_matching',
    text: 'Which language uses pointers?',
    options: [{ text: 'C#' }, { text: 'C++' }],
    selects: [{ index: 0, options: [{ text: 'C#' }, { text: 'C++' }] }]
  };
  const resSelCpp = _parseAIResponse(
    '<quiz_answers><answer question_id="1" type="select_matching"><text_reply>C++</text_reply></answer></quiz_answers>',
    [selCppQ]
  );
  assert.deepEqual(resSelCpp[0].optionIndices, [1]);

  const dragCppQ = {
    index: 1,
    type: 'drag_drop',
    questionType: 'drag_drop',
    text: 'Match systems language',
    draggables: [{ text: 'C#' }, { text: 'C++' }],
    dropTargets: [{ label: 'Systems' }]
  };
  const resDragCpp = _parseAIResponse(
    '<quiz_answers><answer question_id="1" type="drag_drop"><text_reply>C++ -> Systems</text_reply></answer></quiz_answers>',
    [dragCppQ]
  );
  assert.deepEqual(resDragCpp[0].optionIndices, [1]);

  // 2. Arrow delimiter splits before colon ('Port: 80 -> HTTP')
  const dragPortQ = {
    index: 1,
    type: 'drag_drop',
    questionType: 'drag_drop',
    text: 'Match ports',
    draggables: [{ text: 'Port: 80' }, { text: 'Port: 443' }],
    dropTargets: [{ label: 'HTTP' }, { label: 'HTTPS' }]
  };
  const resDragPort = _parseAIResponse(
    '<quiz_answers><answer question_id="1" type="drag_drop"><text_reply>Port: 80 -> HTTP</text_reply></answer></quiz_answers>',
    [dragPortQ]
  );
  assert.deepEqual(resDragPort[0].optionIndices, [0]);

  // 3. Fraction option text ('1. 1/2') on single_choice must match option [1], NOT split [0, 1]
  const fracQ = {
    index: 1,
    type: 'radio',
    questionType: 'single_choice',
    text: 'Half equals?',
    options: [{ text: '1/4' }, { text: '1/2' }, { text: '3/4' }]
  };
  const resFrac = _parseAIResponse('1. 1/2', [fracQ]);
  assert.deepEqual(resFrac[0].optionIndices, [1]);

  // 4. Multi-chunk / vision-split ReAct tool call translates prompt-relative index 0 -> global questionIndex (q.index - 1 = 1)
  const chunkedFillQ = { index: 2, type: 'fill_blank', questionType: 'fill_blank', text: 'Default HTTPS port?' };
  const mappedChunked = _mapToolAnswersToParsedAnswers(
    [{ questionIndex: 0, answers: ['443'], confidence: 92 }],
    [chunkedFillQ]
  );
  assert.equal(mappedChunked.length, 1);
  assert.equal(mappedChunked[0].questionIndex, 1);
  assert.equal(mappedChunked[0].textAnswer, '443');

  // 5. findSkeletonRoot keeps sibling <h2> before <fieldset> with generic legend
  const doc = makeDoc();
  doc.body.appendChild(makeElement('H2', {}, ['The <title> element must be located inside']));
  doc.body.appendChild(makeElement('FIELDSET', {}, [
    makeElement('LEGEND', { class: 'sr-only' }, ['Answers']),
    makeElement('LABEL', {}, [makeElement('INPUT', { type: 'radio', name: 'q32' }), 'the <head> element']),
    makeElement('LABEL', {}, [makeElement('INPUT', { type: 'radio', name: 'q32' }), 'the <body> element'])
  ]));
  const sb = {
    document: doc,
    window: null,
    location: { href: 'https://quiz.example.com/', hostname: 'quiz.example.com' },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    console,
    module: { exports: {} }
  };
  sb.window = sb;
  vm.runInNewContext(fs.readFileSync(path.join(TARGET_ROOT, 'schema-detector.js'), 'utf8'), sb);
  const sk = sb.SchemaDetector.buildDOMSkeleton();
  assert.equal(sb.SchemaDetector.findSkeletonRoot(doc.body), doc.body, 'findSkeletonRoot must fall back to body so sibling <h2> stem is not clipped');
  assert.ok(sk.includes('The <title> element must be located'), 'Skeleton must retain sibling <h2> stem');
  assert.ok(sk.includes('<input[type=radio]'), 'Skeleton must retain radios');
});
