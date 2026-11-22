'use strict';
// Behavioral & edge-case tests for dom-extractor.js (F-DET-01, F-DET-02)
// and page-bridge.js (F-DET-03, F-DET-04). Zero external dependencies.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TARGET_ROOT = process.env.TEST_TARGET_ROOT
  ? path.resolve(process.env.TEST_TARGET_ROOT)
  : path.resolve(__dirname, '..');

const DOMExtractor = require(path.join(TARGET_ROOT, 'dom-extractor.js'));
const PageBridge = require(path.join(TARGET_ROOT, 'page-bridge.js'));

// ---------------------------------------------------------------------------
// Minimal deterministic mock DOM (supports shadowRoot, slots, CSS selectors,
// CustomEvent / EventTarget) so tests run in pure Node 26 without jsdom.
// ---------------------------------------------------------------------------
function matchSingleSelector(el, sel) {
  sel = sel.trim();
  if (!sel || !el || el.nodeType !== 1) return false;
  if (sel === '*') return true;

  // Descendant combinator: "A B" -> el matches B and some ancestor matches A
  const parts = sel.split(/\s+/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (!matchSimple(el, last)) return false;
    let anc = el.parentElement || el.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) {
      let found = false;
      while (anc && anc.nodeType === 1) {
        if (matchSimple(anc, parts[i])) {
          found = true;
          anc = anc.parentElement || anc.parentNode;
          break;
        }
        anc = anc.parentElement || anc.parentNode;
      }
      if (!found) return false;
    }
    return true;
  }
  return matchSimple(el, sel);
}

function matchSimple(el, simple) {
  let rest = simple;

  // Handle :not([attr])
  const notMatches = [];
  rest = rest.replace(/:not\(([^)]+)\)/g, (_, inner) => {
    notMatches.push(inner.trim());
    return '';
  });

  // Extract attribute selectors [name], [name="val"], [name*="val"]
  const attrChecks = [];
  rest = rest.replace(/\[([^\]=*]+)(\*?=)?(?:"([^"]*)"|'([^']*)'|([^\]]*))?\]/g, (_, name, op, v1, v2, v3) => {
    const val = v1 !== undefined ? v1 : (v2 !== undefined ? v2 : v3);
    attrChecks.push({ name: name.trim(), op: op || null, val });
    return '';
  });

  // Extract classes and ids
  const classes = [];
  rest = rest.replace(/\.([A-Za-z0-9_-]+)/g, (_, cls) => {
    classes.push(cls);
    return '';
  });
  let idCheck = null;
  rest = rest.replace(/#([A-Za-z0-9_-]+)/g, (_, id) => {
    idCheck = id;
    return '';
  });

  const tagCheck = rest.trim().toUpperCase();
  if (tagCheck && tagCheck !== '*' && el.tagName !== tagCheck) return false;
  if (idCheck && el.id !== idCheck) return false;

  const elClasses = (el.className || '').split(/\s+/).filter(Boolean);
  for (const c of classes) {
    if (!elClasses.includes(c)) return false;
  }

  for (const a of attrChecks) {
    const raw = el.getAttribute(a.name);
    if (!a.op) {
      if (raw === null) return false;
    } else if (a.op === '=') {
      if (raw !== a.val) return false;
    } else if (a.op === '*=') {
      if (raw === null || !raw.includes(a.val)) return false;
    }
  }

  for (const neg of notMatches) {
    if (matchSimple(el, neg)) return false;
  }
  return true;
}

function matchesSelectorList(el, selectorList) {
  return selectorList.split(',').some((s) => matchSingleSelector(el, s));
}

function createTextNode(text) {
  return { nodeType: 3, nodeName: '#text', textContent: text, nodeValue: text, parentNode: null };
}

function createElement(tag, attrs = {}, children = []) {
  const attrMap = new Map();
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) attrMap.set(k.toLowerCase(), String(v));
  }
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    nodeName: tag.toUpperCase(),
    parentNode: null,
    parentElement: null,
    childNodes: [],
    style: {},
    hidden: false,
    shadowRoot: null,
    checked: Boolean(attrs.checked),
    selected: Boolean(attrs.selected),
    disabled: Boolean(attrs.disabled),
    get id() { return attrMap.get('id') || ''; },
    get className() { return attrMap.get('class') || ''; },
    get type() { return attrMap.get('type') || ''; },
    get value() { return attrMap.has('value') ? attrMap.get('value') : ''; },
    get htmlFor() { return attrMap.get('for') || ''; },
    get children() { return this.childNodes.filter((c) => c.nodeType === 1); },
    get nextElementSibling() {
      if (!this.parentNode) return null;
      const sibs = this.parentNode.children;
      const idx = sibs.indexOf(this);
      return idx >= 0 && idx + 1 < sibs.length ? sibs[idx + 1] : null;
    },
    get previousElementSibling() {
      if (!this.parentNode) return null;
      const sibs = this.parentNode.children;
      const idx = sibs.indexOf(this);
      return idx > 0 ? sibs[idx - 1] : null;
    },
    get textContent() {
      return this.childNodes.map((c) => c.textContent || '').join('');
    },
    getAttribute(name) {
      const k = name.toLowerCase();
      return attrMap.has(k) ? attrMap.get(k) : null;
    },
    hasAttribute(name) {
      return attrMap.has(name.toLowerCase());
    },
    setAttribute(name, val) {
      attrMap.set(name.toLowerCase(), String(val));
    },
    appendChild(child) {
      if (typeof child === 'string') child = createTextNode(child);
      child.parentNode = this;
      if (child.nodeType === 1) child.parentElement = this;
      this.childNodes.push(child);
      return child;
    },
    contains(other) {
      let curr = other;
      let steps = 0;
      while (curr && steps < 50) {
        if (curr === this) return true;
        curr = curr.parentNode;
        steps++;
      }
      return false;
    },
    matches(sel) {
      return matchesSelectorList(this, sel);
    },
    closest(sel) {
      let curr = this;
      let steps = 0;
      while (curr && curr.nodeType === 1 && steps < 50) {
        if (matchesSelectorList(curr, sel)) return curr;
        curr = curr.parentElement;
        steps++;
      }
      return null;
    },
    getRootNode() {
      let curr = this;
      let steps = 0;
      while (curr.parentNode && steps < 50) {
        curr = curr.parentNode;
        steps++;
      }
      return curr;
    },
    querySelectorAll(sel) {
      const out = [];
      const seen = new WeakSet();
      function walk(node) {
        for (const ch of node.children) {
          if (seen.has(ch)) continue;
          seen.add(ch);
          if (matchesSelectorList(ch, sel)) out.push(ch);
          walk(ch);
        }
      }
      walk(this);
      return out;
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
    attachShadow() {
      const sr = {
        nodeType: 11,
        host: this,
        parentNode: null,
        childNodes: [],
        get children() { return this.childNodes.filter((c) => c.nodeType === 1); },
        appendChild(child) {
          if (typeof child === 'string') child = createTextNode(child);
          child.parentNode = this;
          this.childNodes.push(child);
          return child;
        },
        querySelectorAll(sel) {
          const out = [];
          const seen = new WeakSet();
          function walk(node) {
            for (const ch of node.children) {
              if (seen.has(ch)) continue;
              seen.add(ch);
              if (matchesSelectorList(ch, sel)) out.push(ch);
              walk(ch);
            }
          }
          walk(this);
          return out;
        },
        querySelector(sel) {
          return this.querySelectorAll(sel)[0] || null;
        }
      };
      this.shadowRoot = sr;
      return sr;
    }
  };

  for (const ch of children) el.appendChild(ch);
  return el;
}

function createMockDocument(bodyChildren = []) {
  const listeners = new Map();
  const body = createElement('body', {}, bodyChildren);
  const doc = {
    nodeType: 9,
    body,
    documentElement: body,
    get children() { return [body]; },
    querySelectorAll(sel) { return body.querySelectorAll(sel); },
    querySelector(sel) { return body.querySelector(sel); },
    getElementById(id) {
      return body.querySelectorAll('[id]').find((el) => el.id === id) || null;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      if (listeners.has(type)) listeners.get(type).delete(fn);
    },
    dispatchEvent(ev) {
      const set = listeners.get(ev.type);
      if (set) {
        for (const fn of Array.from(set)) fn(ev);
      }
      return true;
    },
    _listenerCount(type) {
      if (type) return listeners.has(type) ? listeners.get(type).size : 0;
      let total = 0;
      for (const s of listeners.values()) total += s.size;
      return total;
    }
  };
  return doc;
}

class MockCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail !== undefined ? init.detail : null;
  }
}

// ===========================================================================
// F-DET-02: Recursive Shadow DOM Traversal
// ===========================================================================

test('F-DET-02: querySelectorAllDeep traverses nested Shadow DOM and enforces maxDepth', () => {
  const root = createElement('div', { id: 'app' });
  const lightBtn = createElement('button', { class: 'target', id: 'lvl0' }, ['L0']);
  root.appendChild(lightBtn);

  const host1 = createElement('x-quiz-1');
  const sr1 = host1.attachShadow();
  const s1Btn = createElement('button', { class: 'target', id: 'lvl1' }, ['L1']);
  sr1.appendChild(s1Btn);

  const host2 = createElement('x-quiz-2');
  const sr2 = host2.attachShadow();
  const s2Btn = createElement('button', { class: 'target', id: 'lvl2' }, ['L2']);
  sr2.appendChild(s2Btn);

  const host3 = createElement('x-quiz-3');
  const sr3 = host3.attachShadow();
  const s3Btn = createElement('button', { class: 'target', id: 'lvl3' }, ['L3']);
  sr3.appendChild(s3Btn);

  sr2.appendChild(host3);
  sr1.appendChild(host2);
  root.appendChild(host1);

  const all = DOMExtractor.querySelectorAllDeep('button.target', root);
  assert.deepEqual(all.map((e) => e.id), ['lvl0', 'lvl1', 'lvl2', 'lvl3']);
  assert.equal(DOMExtractor.querySelectorDeep('button.target', root).id, 'lvl0');

  // Depth caps
  assert.deepEqual(
    DOMExtractor.querySelectorAllDeep('button.target', root, { maxDepth: 0 }).map((e) => e.id),
    ['lvl0']
  );
  assert.deepEqual(
    DOMExtractor.querySelectorAllDeep('button.target', root, { maxDepth: 1 }).map((e) => e.id),
    ['lvl0', 'lvl1']
  );
  assert.deepEqual(
    DOMExtractor.querySelectorAllDeep('button.target', root, { maxDepth: 2 }).map((e) => e.id),
    ['lvl0', 'lvl1', 'lvl2']
  );
});

test('F-DET-02: WeakSet cycle guard prevents infinite recursion on cyclic shadow/element graphs', () => {
  const root = createElement('div', { id: 'cycle-root' });
  const host = createElement('x-host', { class: 'hit' });
  const sr = host.attachShadow();
  const inner = createElement('span', { class: 'hit', id: 'inner' }, ['inside']);
  sr.appendChild(inner);
  // Introduce explicit cycles: shadowRoot -> root and inner -> host
  sr.childNodes.push(root);
  inner.shadowRoot = sr;
  root.appendChild(host);

  const found = DOMExtractor.querySelectorAllDeep('.hit', root, { maxDepth: 20 });
  assert.equal(found.length, 2);
  assert.equal(DOMExtractor.extractTextDeep(root), 'inside');
});

test('F-DET-02: extractTextDeep skips hidden/script/style nodes and resolves slotted shadow text', () => {
  const host = createElement('div');
  const slottedSpan = createElement('span', {}, ['Slotted answer']);
  host.appendChild(slottedSpan);

  const sr = host.attachShadow();
  const prefix = createElement('p', {}, ['Question:']);
  const hidden = createElement('span', { 'aria-hidden': 'true' }, ['SECRET_HIDDEN']);
  const script = createElement('script', {}, ['window.alert(1)']);
  const style = createElement('style', {}, ['.x { color: red }']);
  const dispNone = createElement('div', {}, ['INVISIBLE']);
  dispNone.style.display = 'none';
  const slot = createElement('slot');
  slot.assignedNodes = () => [slottedSpan];

  sr.appendChild(prefix);
  sr.appendChild(hidden);
  sr.appendChild(script);
  sr.appendChild(style);
  sr.appendChild(dispNone);
  sr.appendChild(slot);

  const text = DOMExtractor.extractTextDeep(host);
  assert.equal(text, 'Question: Slotted answer');
  assert.ok(!text.includes('SECRET_HIDDEN'));
  assert.ok(!text.includes('alert'));
  assert.ok(!text.includes('INVISIBLE'));
});

test('F-DET-02 negative control: empty/invalid selector or null root returns safely', () => {
  assert.deepEqual(DOMExtractor.querySelectorAllDeep('', null), []);
  assert.deepEqual(DOMExtractor.querySelectorAllDeep('   ', createElement('div')), []);
  assert.equal(DOMExtractor.querySelectorDeep('div', null), null);
  assert.equal(DOMExtractor.extractTextDeep(null), '');
});

// ===========================================================================
// F-DET-01: Universal Quiz Formats
// ===========================================================================

test('F-DET-01: extracts all 6 normalized questionType formats + Shadow DOM cards', async () => {
  // 1. Native radio (single_choice)
  const q1 = createElement('div', { class: 'question-card' }, [
    createElement('h3', { class: 'question-text' }, ['Capital of France?']),
    createElement('label', {}, [createElement('input', { type: 'radio', name: 'q1', value: 'a' }), 'London']),
    createElement('label', {}, [createElement('input', { type: 'radio', name: 'q1', value: 'b' }), 'Paris'])
  ]);

  // 2. ARIA checkbox (multi_choice)
  const q2 = createElement('div', { class: 'question-card' }, [
    createElement('h3', {}, ['Select prime numbers']),
    createElement('div', { role: 'checkbox', 'aria-checked': 'false', 'data-value': '2' }, ['2']),
    createElement('div', { role: 'checkbox', 'aria-checked': 'true', 'data-value': '3' }, ['3']),
    createElement('div', { role: 'checkbox', 'aria-checked': 'false', 'data-value': '4' }, ['4'])
  ]);

  // 3. Select & matching with placeholder skipped
  const sel1 = createElement('select', { 'aria-label': 'France' }, [
    createElement('option', { value: '' }, ['-- Select capital --']),
    createElement('option', { value: 'paris' }, ['Paris']),
    createElement('option', { value: 'rome' }, ['Rome'])
  ]);
  const sel2 = createElement('select', { 'aria-label': 'Italy' }, [
    createElement('option', { value: '', disabled: true }, ['Choose...']),
    createElement('option', { value: 'paris' }, ['Paris']),
    createElement('option', { value: 'rome' }, ['Rome'])
  ]);
  const q3 = createElement('div', { class: 'question-card' }, [
    createElement('h3', {}, ['Match each country to its capital']),
    createElement('div', { class: 'matching-pair' }, [sel1]),
    createElement('div', { class: 'matching-pair' }, [sel2])
  ]);

  // 4. Fill in the blank (inline input + contenteditable)
  const blank1 = createElement('input', { type: 'text', placeholder: 'city', name: 'blank_1' });
  const blank2 = createElement('span', { contenteditable: 'true' });
  const q4 = createElement('div', { class: 'question-card' }, [
    createElement('p', { class: 'question-text' }, ['The capital of Japan is ', blank1, ' and currency is ', blank2, '.'])
  ]);

  // 5. Drag and drop
  const q5 = createElement('div', { class: 'question-card' }, [
    createElement('h3', {}, ['Drag protocols to their OSI layers']),
    createElement('div', { draggable: 'true', id: 'drag-tcp' }, ['TCP']),
    createElement('div', { draggable: 'true', id: 'drag-http' }, ['HTTP']),
    createElement('div', { class: 'dropzone', 'data-droppable': 'true', id: 'drop-l4' }, ['Layer 4']),
    createElement('div', { class: 'dropzone', 'data-droppable': 'true', id: 'drop-l7' }, ['Layer 7'])
  ]);

  // 6. Open essay text
  const q6 = createElement('div', { class: 'question-card' }, [
    createElement('h3', {}, ['Explain photosynthesis']),
    createElement('textarea', { class: 'text-answer', 'aria-multiline': 'true' })
  ]);

  // 7. Shadow DOM embedded ARIA radio card
  const shadowHost = createElement('quiz-widget');
  const sr = shadowHost.attachShadow();
  const q7 = createElement('div', { class: 'question-card' }, [
    createElement('h3', {}, ['Inside Shadow DOM?']),
    createElement('div', { role: 'radio', 'aria-checked': 'false' }, ['Yes']),
    createElement('div', { role: 'radio', 'aria-checked': 'false' }, ['No'])
  ]);
  sr.appendChild(q7);

  // 8. Negative control: decorative card with no interactive controls
  const decoy = createElement('div', { class: 'question-card' }, [
    createElement('h3', {}, ['Instructions: read carefully before starting.'])
  ]);

  const doc = createMockDocument([q1, q2, q3, q4, q5, q6, shadowHost, decoy]);
  const res = await DOMExtractor.extractQuizData(doc, { skipAdaptive: true });

  assert.equal(res.questions.length, 7, 'decoy non-interactive card must be excluded');
  assert.deepEqual(
    res.questions.map((q) => q.questionType),
    ['single_choice', 'multi_choice', 'select_matching', 'fill_blank', 'drag_drop', 'text', 'single_choice']
  );

  // Backwards compatibility checks
  assert.equal(res.questions[0].type, 'radio');
  assert.deepEqual(res.questions[0].options.map((o) => o.text), ['London', 'Paris']);
  assert.equal(res.questions[1].type, 'checkbox');
  assert.equal(res.questions[1].options[1].checked, true);

  // Select matching checks (placeholders stripped)
  assert.equal(res.questions[2].selects.length, 2);
  assert.deepEqual(res.questions[2].selects[0].options.map((o) => o.text), ['Paris', 'Rome']);
  assert.equal(res.questions[2].pairs[1].prompt, 'Italy');

  // Fill blank checks
  assert.equal(res.questions[3].blanks.length, 2);
  assert.equal(res.questions[3].blanks[1].isContentEditable, true);
  assert.ok(res.questions[3].text.includes('___'));

  // Drag drop checks
  assert.deepEqual(res.questions[4].draggables.map((d) => d.text), ['TCP', 'HTTP']);
  assert.deepEqual(res.questions[4].dropTargets.map((t) => t.label), ['Layer 4', 'Layer 7']);

  // Open essay
  assert.equal(res.questions[5].type, 'text');
  assert.ok(res.questions[5].inputElement);

  // Shadow DOM flag
  assert.equal(res.questions[6].inShadowDom, true);
  assert.equal(res.questions[0].inShadowDom, false);
});

test('F-DET-01: ARIA listbox multi-select extracts multi_choice options', async () => {
  const lb = createElement('div', {
    role: 'listbox',
    'aria-label': 'Choose European cities',
    'aria-multiselectable': 'true'
  }, [
    createElement('div', { role: 'option', 'aria-selected': 'true' }, ['Berlin']),
    createElement('div', { role: 'option', 'aria-selected': 'false' }, ['Tokyo'])
  ]);
  const doc = createMockDocument([lb]);
  const res = await DOMExtractor.extractQuizData(doc, { skipAdaptive: true });
  assert.equal(res.questions.length, 1);
  assert.equal(res.questions[0].questionType, 'multi_choice');
  assert.equal(res.questions[0].type, 'checkbox');
  assert.deepEqual(res.questions[0].options.map((o) => o.text), ['Berlin', 'Tokyo']);
  assert.equal(res.questions[0].options[0].checked, true);
});

// ===========================================================================
// F-DET-03: Defensive React & Vue State Extractor
// ===========================================================================

test('F-DET-03: extracts React fiber/props and Vue 2/3 state safely, surviving throwing getters & cycles', () => {
  const reactEl = createElement('div');
  const circular = { question: '2 + 2 = ?', choices: ['3', '4'], onClick: () => {}, sym: Symbol('x') };
  circular.self = circular;
  Object.defineProperty(circular, 'explodingGetter', {
    enumerable: true,
    get() { throw new Error('Host getter explosion'); }
  });
  reactEl['__reactProps$abc123'] = circular;

  const fiberHooks = {
    memoizedState: { prompt: 'Hook question', options: ['A', 'B'] },
    next: { memoizedState: { answer: 'B' }, next: null }
  };
  fiberHooks.next.next = fiberHooks; // circular hooks list!
  reactEl['__reactFiber$abc123'] = {
    memoizedProps: { title: 'Quiz title' },
    memoizedState: fiberHooks,
    return: null
  };

  const vue2El = createElement('section');
  vue2El.__vue__ = {
    $data: { questions: [{ text: 'Vue2 Q1', options: ['X', 'Y'] }] },
    $el: vue2El // DOM node must be stripped
  };

  const vue3El = createElement('article');
  vue3El.__vueParentComponent = {
    setupState: { items: [{ label: 'Vue3 Option 1' }] },
    props: { quiz: 'Biology 101' }
  };

  // Negative control: non-quiz React props should be ignored by default
  const noiseEl = createElement('footer');
  noiseEl['__reactProps$noise'] = { theme: 'dark', version: 42 };

  const doc = createMockDocument([reactEl, vue2El, vue3El, noiseEl]);
  const out = PageBridge.extractFrameworkState(doc, { maxDepth: 5, maxNodes: 50 });

  assert.ok(out.snapshots.length >= 3, 'should capture React, Vue2, Vue3 snapshots');
  assert.ok(out.stats.frameworksDetected.includes('react'));
  assert.ok(out.stats.frameworksDetected.includes('vue2'));
  assert.ok(out.stats.frameworksDetected.includes('vue3'));

  // Must be strictly JSON-serializable (no functions, symbols, DOM nodes, cycles)
  const serialized = JSON.stringify(out);
  assert.ok(serialized.includes('2 + 2 = ?'));
  assert.ok(serialized.includes('Vue2 Q1'));
  assert.ok(serialized.includes('Vue3 Option 1'));
  assert.ok(!serialized.includes('"theme":"dark"'), 'non-quiz noise should be filtered when includeAllKeys is false');

  // Negative control: null root
  const empty = PageBridge.extractFrameworkState(null);
  assert.deepEqual(empty.snapshots, []);
});

// ===========================================================================
// F-DET-04: Passive Opt-In Fetch/XHR Network Interceptor
// ===========================================================================

test('F-DET-04: interceptor is opt-in, clones fetch passively, sanitizes URLs, enforces buffer & byte caps, restores cleanly', async () => {
  let fetchCalls = 0;
  const originalFetch = async (url) => {
    fetchCalls++;
    const body = url.includes('big')
      ? JSON.stringify({ question: '😀'.repeat(300) })
      : (url.includes('image')
        ? 'PNGDATA'
        : JSON.stringify({ question: `Q#${fetchCalls}`, options: ['A', 'B'] }));
    const ct = url.includes('image') ? 'image/png' : 'application/json';
    return {
      status: 200,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? ct : null) },
      clone() { return { text: async () => body }; },
      text: async () => body
    };
  };

  class FakeXHR {
    constructor() {
      this.status = 200;
      this.responseType = '';
      this.responseText = '';
      this._listeners = new Map();
    }
    open(method, url) { this._method = method; this._url = url; }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    }
    getResponseHeader(name) { return name.toLowerCase() === 'content-type' ? 'application/json' : null; }
    send() {
      this.responseText = JSON.stringify({ quiz: 'xhr-quiz', answers: [1] });
      for (const fn of (this._listeners.get('load') || [])) fn();
    }
  }
  const origOpen = FakeXHR.prototype.open;
  const origSend = FakeXHR.prototype.send;
  const mockTarget = { fetch: originalFetch, XMLHttpRequest: FakeXHR };

  const interceptor = PageBridge.createNetworkInterceptor({
    target: mockTarget,
    maxEntries: 3,
    maxBodyBytes: 256,
    filterQuizOnly: true
  });

  // Must NOT patch or record before enable()
  assert.equal(interceptor.isEnabled(), false);
  assert.equal(mockTarget.fetch, originalFetch);
  await mockTarget.fetch('https://example.com/api/quiz?token=TOPSECRET');
  assert.equal(interceptor.getEntries().length, 0);

  // Enable and exercise fetch + XHR + filtering + circular buffer + UTF-8 truncation
  interceptor.enable();
  assert.equal(interceptor.isEnabled(), true);
  assert.notEqual(mockTarget.fetch, originalFetch);

  // Non-quiz image should be skipped
  await mockTarget.fetch('https://cdn.example.com/image.png');

  // Quiz fetch with sensitive credentials/token/hash -> must sanitize URL and keep caller body intact
  const callerRes = await mockTarget.fetch('https://alice:pw@example.com/api/quiz/1?api_key=SECRET123&page=1#access_token=abc');
  const callerText = await callerRes.text();
  assert.ok(callerText.includes('Q#3'), 'caller response must remain intact');

  // Oversized UTF-8 emoji payload -> truncated cleanly <= 256 bytes without broken surrogate
  await mockTarget.fetch('https://example.com/api/quiz/big');

  // XHR capture
  const xhr = new mockTarget.XMLHttpRequest();
  xhr.open('POST', 'https://example.com/api/assessment?token=XHR_SECRET');
  xhr.send();

  // Push 2 more to verify circular buffer cap of 3
  await mockTarget.fetch('https://example.com/api/quiz/4');
  await mockTarget.fetch('https://example.com/api/quiz/5');

  // Wait a microtask tick for cloned.text() promises to settle
  await new Promise((r) => setTimeout(r, 20));

  const entries = interceptor.getEntries();
  assert.equal(entries.length, 3, 'circular buffer must cap at maxEntries=3');
  const joinedUrls = entries.map((e) => e.url).join(' ');
  assert.ok(!joinedUrls.includes('SECRET123') && !joinedUrls.includes('XHR_SECRET') && !joinedUrls.includes('alice'));

  // Test oversized entry directly after clear()
  interceptor.clear();
  assert.equal(interceptor.getEntries().length, 0);
  await mockTarget.fetch('https://example.com/api/quiz/big');
  await new Promise((r) => setTimeout(r, 20));
  const bigEntries = interceptor.getEntries();
  assert.equal(bigEntries.length, 1);
  assert.equal(bigEntries[0].truncated, true);
  assert.ok(bigEntries[0].byteLength <= 256);
  assert.equal(Buffer.byteLength(bigEntries[0].body, 'utf8'), bigEntries[0].byteLength);

  // Disable stops recording; restore puts back exact originals
  interceptor.disable();
  await mockTarget.fetch('https://example.com/api/quiz/after-disable');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(interceptor.getEntries().length, 1);

  interceptor.restore();
  assert.equal(mockTarget.fetch, originalFetch);
  assert.equal(FakeXHR.prototype.open, origOpen);
  assert.equal(FakeXHR.prototype.send, origSend);
});

// ===========================================================================
// Bridge CustomEvent Handshake + VM Stealth Isolation
// ===========================================================================

test('Bridge handshake: DOMExtractor.requestPageBridge communicates with PageBridge via CustomEvent', async () => {
  const reactNode = createElement('div');
  reactNode['__reactProps$bridge'] = { question: 'Bridge Q', choices: ['One', 'Two'] };
  const doc = createMockDocument([reactNode]);

  // Negative control: before installBridge, requestPageBridge resolves to null and cleans up listeners
  const missing = await DOMExtractor.requestPageBridge('ping', {}, {
    document: doc,
    CustomEvent: MockCustomEvent,
    timeoutMs: 30
  });
  assert.equal(missing, null);
  assert.equal(doc._listenerCount(), 0, 'no leaked listeners after timeout');

  // Install bridge and run round-trip actions
  const ctrl = PageBridge.installBridge({
    document: doc,
    CustomEvent: MockCustomEvent,
    target: {}
  });
  assert.ok(ctrl);

  const ping = await DOMExtractor.requestPageBridge('ping', {}, {
    document: doc,
    CustomEvent: MockCustomEvent,
    timeoutMs: 100
  });
  assert.equal(ping.ok, true);
  assert.equal(ping.data.alive, true);
  assert.equal(ping.data.interceptorEnabled, false);

  const stateRes = await DOMExtractor.requestPageBridge('extractFrameworkState', {}, {
    document: doc,
    CustomEvent: MockCustomEvent,
    timeoutMs: 100
  });
  assert.equal(stateRes.ok, true);
  assert.equal(stateRes.data.snapshots.length, 1);
  assert.equal(stateRes.data.snapshots[0].data.question, 'Bridge Q');

  const unknownRes = await DOMExtractor.requestPageBridge('doesNotExist', {}, {
    document: doc,
    CustomEvent: MockCustomEvent,
    timeoutMs: 100
  });
  assert.equal(unknownRes.ok, false);

  ctrl.destroy();
  assert.equal(doc._listenerCount(), 0, 'destroy() must remove all bridge listeners');
});

test('Stealth VM check: page-bridge.js adds zero properties to window in MAIN world', () => {
  const src = fs.readFileSync(path.join(TARGET_ROOT, 'page-bridge.js'), 'utf8');
  const doc = createMockDocument([]);
  const sandbox = {
    document: doc,
    CustomEvent: MockCustomEvent,
    TextEncoder,
    URL,
    console
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const beforeKeys = Object.getOwnPropertyNames(sandbox).sort();

  vm.runInNewContext(src, sandbox);

  const afterKeys = Object.getOwnPropertyNames(sandbox).sort();
  assert.deepEqual(afterKeys, beforeKeys, 'page-bridge.js must not leak any global property on window');
  assert.deepEqual(Object.keys(doc).filter((k) => /safeexm|qh|bridge/i.test(k)), []);
  assert.deepEqual(Object.getOwnPropertySymbols(doc), [], 'page-bridge.js must not attach enumerable or symbol keys onto document');
});

// ===========================================================================
// Forensic Audit Regression Tests (Lot 3)
// ===========================================================================

test('Regression F-DET-02: querySelectorAllDeep resolves <slot> assignedElements({flatten:true}) and extractTextDeep hides unslotted light DOM', () => {
  const host = createElement('x-quiz-host');
  const slottedRadio = createElement('div', { role: 'radio', id: 'slotted-opt' }, ['Projected Option']);
  const unslottedFallback = createElement('span', {}, ['UNSLOTTED_FALLBACK']);
  host.appendChild(slottedRadio);
  host.appendChild(unslottedFallback);

  const sr = host.attachShadow();
  const stem = createElement('p', {}, ['Shadow Stem']);
  const slot = createElement('slot', { name: 'opts' });
  slot.assignedElements = ({ flatten } = {}) => (flatten ? [slottedRadio] : []);
  slot.assignedNodes = ({ flatten } = {}) => (flatten ? [slottedRadio] : []);
  sr.appendChild(stem);
  sr.appendChild(slot);

  const foundFromShadow = DOMExtractor.querySelectorAllDeep('[role="radio"]', sr);
  assert.equal(foundFromShadow.length, 1);
  assert.equal(foundFromShadow[0].id, 'slotted-opt');

  const text = DOMExtractor.extractTextDeep(host);
  assert.equal(text, 'Shadow Stem Projected Option');
  assert.ok(!text.includes('UNSLOTTED_FALLBACK'));
});

test('Regression F-DET-01: Tier 1B .question container, safeClosest stopAt, shared option parent, and browser-style <option> placeholder', async () => {
  // 1. Tier 1B: .question container must NOT include radio labels in question.text
  const tier1bCard = createElement('div', { class: 'question' }, [
    createElement('p', {}, ['What is 2 + 2?']),
    createElement('div', { class: 'options' }, [
      createElement('input', { type: 'radio', name: 'q1', value: '3' }),
      createElement('span', { class: 'option-text' }, ['3']),
      createElement('input', { type: 'radio', name: 'q1', value: '4' }),
      createElement('span', { class: 'option-text' }, ['4'])
    ])
  ]);
  // Stray heading outside card must not capture document.body
  const strayHeading = createElement('h3', { class: 'question' }, ['FAQ Section']);

  // 2. <select> inside outer <li>: safeClosest must stop at card scope; placeholder without value="" must be stripped
  const sel = createElement('select', {}, [
    createElement('option', { disabled: true }, ['-- Choose --']),
    createElement('option', { value: 'fr' }, ['Paris']),
    createElement('option', { value: 'de' }, ['Berlin'])
  ]);
  // Simulate native HTMLOptionElement.value returning text when value attribute is absent
  Object.defineProperty(sel.children[0], 'value', { get: () => '-- Choose --' });
  const matchCard = createElement('div', { class: 'question' }, [
    createElement('h3', {}, ['Select capital']),
    createElement('div', {}, [createElement('span', {}, ['France']), sel])
  ]);
  const outerList = createElement('ol', {}, [createElement('li', {}, [tier1bCard, matchCard])]);

  const doc = createMockDocument([strayHeading, outerList]);
  const res = await DOMExtractor.extractQuizData(doc, { skipAdaptive: true });

  assert.equal(res.questions.length, 2);
  assert.equal(res.questions[0].text, 'What is 2 + 2?');
  assert.deepEqual(res.questions[0].options.map((o) => o.text), ['3', '4']);
  assert.equal(res.questions[1].questionType, 'select_matching');
  assert.deepEqual(res.questions[1].selects[0].options.map((o) => o.text), ['Paris', 'Berlin']);
  assert.equal(res.questions[1].selects[0].label, 'France');
});

test('Regression F-DET-03: survives Proxy children throwing traps, blocks __proto__ pollution, keeps React class state with next field', () => {
  const throwingChildren = new Proxy([], {
    get(target, prop) {
      if (prop === 'length' || prop === '0') {
        throw new Error('Proxy children trap!');
      }
      return Reflect.get(target, prop);
    }
  });
  const hostileNode = {
    nodeType: 1,
    tagName: 'DIV',
    get children() { return throwingChildren; }
  };

  const reactNode = createElement('div');
  const pollutedProps = JSON.parse('{"question":"Safe Q","__proto__":{"polluted":true}}');
  reactNode['__reactProps$p1'] = pollutedProps;
  reactNode['__reactFiber$f1'] = {
    memoizedState: { question: 'Class State Q', next: null },
    return: null
  };

  const doc = createMockDocument([hostileNode, reactNode]);
  const out = PageBridge.extractFrameworkState(doc, { maxNodes: 20 });

  assert.equal(({}).polluted, undefined, 'Object.prototype must never be polluted');
  const serialized = JSON.stringify(out);
  assert.ok(serialized.includes('Safe Q'));
  assert.ok(serialized.includes('Class State Q'));
});

test('Regression F-DET-04: XHR error/reuse cleans up listeners and Proxy fetch input never breaks page fetch', async () => {
  class ReusableXHR {
    constructor() {
      this.status = 200;
      this.responseType = '';
      this.responseText = '';
      this._listeners = new Map();
    }
    open(method, url) { this._method = method; this._url = url; }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) {
      if (this._listeners.has(type)) this._listeners.get(type).delete(fn);
    }
    getResponseHeader() { return 'application/json'; }
    send(fail) {
      if (fail) {
        for (const fn of Array.from(this._listeners.get('error') || [])) fn();
        return;
      }
      this.responseText = JSON.stringify({ question: 'XHR OK' });
      for (const fn of Array.from(this._listeners.get('load') || [])) fn();
    }
  }

  const origFetch = async () => ({
    status: 200,
    headers: { get: () => 'application/json' },
    clone() { return { text: async () => JSON.stringify({ question: 'Fetch OK' }) }; }
  });
  const target = { fetch: origFetch, XMLHttpRequest: ReusableXHR };
  const ic = PageBridge.createNetworkInterceptor({ target, filterQuizOnly: true });
  ic.enable();

  const xhr = new ReusableXHR();
  xhr.open('GET', 'https://example.com/api/quiz/1');
  xhr.send(true); // error -> must clean up load listener
  assert.equal(xhr._listeners.get('load')?.size || 0, 0, 'error must clean up pending load listener');

  xhr.open('GET', 'https://example.com/api/quiz/2');
  xhr.send(false);
  assert.equal(ic.getEntries().length, 1);

  const hostileReq = new Proxy({}, {
    get() { throw new Error('Hostile Request proxy'); }
  });
  const res = await target.fetch(hostileReq);
  assert.equal(res.status, 200, 'page fetch must succeed even when Request getter throws');
  await new Promise((r) => setTimeout(r, 10));
  ic.restore();
});

test('Regression Bridge Security: validates origin, nonce, channel format, and cleans up ephemeral :req listeners', async () => {
  const doc = createMockDocument([]);
  doc.location = { origin: 'https://quiz.example.com' };

  const ctrl = PageBridge.installBridge({
    document: doc,
    CustomEvent: MockCustomEvent,
    target: { location: doc.location }
  });

  // Valid request cleans up ephemeral :req/:ack/:res listeners immediately
  const okRes = await DOMExtractor.requestPageBridge('ping', {}, {
    document: doc,
    CustomEvent: MockCustomEvent,
    timeoutMs: 100
  });
  assert.equal(okRes.ok, true);
  assert.equal(doc._listenerCount(), 1, 'only handshake listener should remain after request finishes');

  // Spoofed origin rejected
  const badOrigin = await DOMExtractor.requestPageBridge('ping', {}, {
    document: doc,
    CustomEvent: MockCustomEvent,
    origin: 'https://evil.example.com',
    timeoutMs: 30
  });
  assert.equal(badOrigin, null);

  // Invalid channel with colon rejected
  const badChannel = await DOMExtractor.requestPageBridge('ping', {}, {
    document: doc,
    CustomEvent: MockCustomEvent,
    channel: 'bad:channel',
    timeoutMs: 30
  });
  assert.equal(badChannel, null);

  // Missing nonce handshake rejected directly
  let acked = false;
  const onUnnoncedAck = () => { acked = true; };
  doc.addEventListener('unnonced:ack', onUnnoncedAck);
  doc.dispatchEvent(new MockCustomEvent(PageBridge.DEFAULT_HANDSHAKE_EVENT, {
    detail: JSON.stringify({ channel: 'unnonced', origin: 'https://quiz.example.com' })
  }));
  doc.removeEventListener('unnonced:ack', onUnnoncedAck);
  assert.equal(acked, false);

  ctrl.destroy();
  assert.equal(doc._listenerCount(), 0);
});

test('Regression Lot 3 re-audit: Shadow DOM safeClosest, wrapping <label><select>, maxDepth unslotted leak, contenteditable <br>, slot depth, url params, XHR timeout', async () => {
  // 1. safeClosest across Shadow DOM boundaries (<quiz-card> Web Component)
  const webCompCard = createElement('quiz-card', { class: 'question-card' });
  const wcShadow = webCompCard.attachShadow();
  const wcStem = createElement('p', {}, ['What is 2 + 2?']);
  const wcRadio1 = createElement('input', { type: 'radio', name: 'wc', value: 'p' });
  const wcLbl1 = createElement('label', {}, [createElement('span', {}, [wcRadio1]), 'Paris']);
  const wcRadio2 = createElement('input', { type: 'radio', name: 'wc', value: 'o' });
  const wcPInsideLbl = createElement('p', {}, ['Option inside label']);
  const wcLbl2 = createElement('label', {}, [wcRadio2, wcPInsideLbl]);
  // Simulate native browser closest/contains behavior (contains() false across Shadow DOM)
  webCompCard.contains = () => false;
  for (const el of [wcStem, wcRadio1, wcLbl1, wcRadio2, wcPInsideLbl, wcLbl2]) {
    el.getRootNode = () => wcShadow;
    el.closest = (sel) => {
      let c = el;
      while (c) {
        if (typeof c.matches === 'function' && c.matches(sel)) return c;
        c = c.parentElement || c.parentNode;
      }
      return null;
    };
  }
  wcShadow.appendChild(wcLbl1);
  wcShadow.appendChild(wcLbl2);
  wcShadow.appendChild(wcStem);

  const wcExtracted = await DOMExtractor.extractQuestionFromCard(webCompCard, 0);
  assert.ok(wcExtracted, 'Web Component question card should be extracted');
  assert.equal(wcExtracted.text, 'What is 2 + 2?');
  assert.equal(wcExtracted.options[0].text, 'Paris');

  // 2. <label> wrapping <select> and raw text nodes inside .matching-pair
  const matchCard = createElement('div', { class: 'question-card' }, [
    createElement('p', { class: 'question-text' }, ['Match country and capital']),
    createElement('div', { class: 'matching-pair' }, [
      createElement('label', {}, [
        'France ',
        createElement('select', {}, [
          createElement('option', { value: '' }, ['-- Select --']),
          createElement('option', { value: 'p' }, ['Paris']),
          createElement('option', { value: 'r' }, ['Rome'])
        ])
      ])
    ]),
    createElement('div', { class: 'matching-pair' }, [
      'Germany ',
      createElement('select', {}, [
        createElement('option', { value: 'b' }, ['Berlin']),
        createElement('option', { value: 'm' }, ['Munich'])
      ])
    ])
  ]);
  const extractedMatch = await DOMExtractor.extractQuestionFromCard(matchCard, 0);
  assert.equal(extractedMatch.selects.length, 2);
  assert.equal(extractedMatch.selects[0].label, 'France');
  assert.equal(extractedMatch.selects[1].label, 'Germany');

  // 3. extractTextDeep at shadowDepth >= maxDepth never leaks unslotted light DOM
  const leakHost = createElement('div', {}, [createElement('span', {}, ['UNSLOTTED_SECRET'])]);
  leakHost.attachShadow().appendChild(createElement('p', {}, ['Shadow Text']));
  assert.equal(DOMExtractor.extractTextDeep(leakHost, { maxDepth: 0 }), '');

  // 4. contenteditable blank with child <br> emits ___
  const blankLine = createElement('p', { class: 'question-text' }, [
    'Capital is ',
    createElement('span', { contenteditable: 'true' }, [createElement('br')]),
    '.'
  ]);
  assert.equal(DOMExtractor.extractTextDeep(blankLine, { includeBlankMarkers: true }), 'Capital is ___.');

  // 5. querySelectorAllDeep does not inflate depth for light-DOM children projected through <slot>
  const h1 = createElement('div');
  const sEl = createElement('div');
  h1.appendChild(sEl);
  const sr1 = h1.attachShadow();
  const slot1 = createElement('slot');
  slot1.assignedElements = ({ flatten } = {}) => (flatten ? [sEl] : []);
  sr1.appendChild(slot1);
  const sr2 = sEl.attachShadow();
  const h3 = createElement('div');
  sr2.appendChild(h3);
  const sr3 = h3.attachShadow();
  sr3.appendChild(createElement('button', { class: 'hit', id: 'depth2' }, ['OK']));
  const slotHits = DOMExtractor.querySelectorAllDeep('.hit', h1, { maxDepth: 2 });
  assert.deepEqual(slotHits.map((n) => n.id), ['depth2']);

  // 6. page-bridge.js unanchored sanitizeUrl redaction
  const cleanUrl = PageBridge.sanitizeUrl('https://api.example.com/quiz?authToken=SEC1&session_token=SEC2&x-goog-signature=SEC3&page=2');
  assert.ok(!cleanUrl.includes('SEC1') && !cleanUrl.includes('SEC2') && !cleanUrl.includes('SEC3'));
  assert.ok(cleanUrl.includes('page=2'));

  // 7. XHR timeout cleans up listeners
  class TimeoutXHR {
    constructor() {
      this._listeners = new Map();
      this.status = 0;
      this.responseType = 'text';
      this.responseText = '';
    }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) {
      this._listeners.get(type)?.delete(fn);
    }
    open() {}
    send() {
      for (const fn of [...(this._listeners.get('timeout') || [])]) fn();
      for (const fn of [...(this._listeners.get('loadend') || [])]) fn();
    }
    getResponseHeader() { return ''; }
  }
  const xhrIc = PageBridge.createNetworkInterceptor({
    target: { XMLHttpRequest: TimeoutXHR }
  });
  xhrIc.enable();
  const tx = new TimeoutXHR();
  tx.open('GET', '/quiz');
  tx.send();
  assert.equal(tx._listeners.get('load')?.size || 0, 0, 'XHR timeout must clean up load listener');
  assert.equal(tx._listeners.get('timeout')?.size || 0, 0, 'XHR timeout must clean up timeout listener');
  xhrIc.restore();
});

test('Regression Lot 3 pass 2: comments/PI ignored, shared React/Vue fibers deduplicated, ShadowRoot never container, select chevron, slot at maxDepth:0, NaN interceptor options', async () => {
  // 1. HTML Comment (nodeType 8) and ProcessingInstruction (nodeType 7) must NOT leak into extracted text
  const commentNode = { nodeType: 8, textContent: ' ANSWER=4 ', childNodes: [] };
  const piNode = { nodeType: 7, textContent: 'secret-pi', childNodes: [] };
  const qWithComments = createElement('p', {}, ['What is 2 + 2?', commentNode, piNode]);
  assert.equal(DOMExtractor.extractTextDeep(qWithComments), 'What is 2 + 2?');

  // 2. React shared parent fiber + shared Vue component deduplicated across child nodes so maxSnapshots (50) is not exhausted
  const sharedParentFiber = { memoizedProps: { quizTitle: 'Shared Quiz Root', choices: ['A', 'B'] }, return: null };
  const fwContainer = createElement('div');
  for (let i = 0; i < 55; i++) {
    const sp = createElement('span', {}, [`opt ${i}`]);
    sp.__reactFiber$1 = { memoizedProps: { idx: i }, return: sharedParentFiber };
    fwContainer.appendChild(sp);
  }
  const sharedVueVm = { $data: { question: 'Shared Vue Stem', answers: ['X'] } };
  const q56 = createElement('div', {}, ['Q56']);
  q56.__reactFiber$1 = { memoizedProps: { question: 'Question 56 Prompt', options: ['Yes', 'No'] }, return: null };
  q56.__vue__ = sharedVueVm;
  const q56Dup = createElement('div', {}, ['Q56 dup']);
  q56Dup.__vue__ = sharedVueVm;
  fwContainer.appendChild(q56);
  fwContainer.appendChild(q56Dup);

  const fwState = PageBridge.extractFrameworkState(fwContainer);
  assert.ok(fwState.snapshots.some((s) => s.framework === 'react' && s.data?.props?.question === 'Question 56 Prompt'), 'Q56 React state must be captured without snapshot exhaustion');
  assert.equal(fwState.snapshots.filter((s) => s.framework === 'vue2').length, 1, 'shared Vue instance must be deduplicated');

  // 3. resolveGenericContainer inside ShadowRoot must return host Element (nodeType 1), NEVER ShadowRoot (nodeType 11)
  const quizHost = createElement('quiz-item');
  const hostSr = quizHost.attachShadow();
  const qTitle = createElement('h3', { class: 'quiz-question' }, ['Shadow generic stem?']);
  const r1 = createElement('input', { type: 'radio', name: 'sg', value: 'yes' });
  const r2 = createElement('input', { type: 'radio', name: 'sg', value: 'no' });
  hostSr.appendChild(qTitle);
  hostSr.appendChild(createElement('label', {}, [r1, 'Yes']));
  hostSr.appendChild(createElement('label', {}, [r2, 'No']));
  const genericDoc = createMockDocument([quizHost]);
  const genericExtracted = await DOMExtractor.extractQuizData(genericDoc);
  assert.equal(genericExtracted.questions.length, 1);
  assert.notEqual(genericExtracted.questions[0].element.nodeType, 11, 'question.element must not be ShadowRoot');
  assert.equal(genericExtracted.questions[0].element, quizHost);

  // 4. <select> followed by trailing UI icon (<span class="chevron">▼</span>) must not pick "▼" as prompt
  const chevCard = createElement('div', { class: 'question-card' }, [
    createElement('p', { class: 'question-text' }, ['Select country']),
    createElement('div', { class: 'matching-pair' }, [
      createElement('span', {}, ['France']),
      createElement('select', { 'aria-label': 'France' }, [
        createElement('option', { value: 'p' }, ['Paris']),
        createElement('option', { value: 'l' }, ['Lyon'])
      ]),
      createElement('span', { class: 'chevron' }, ['▼'])
    ])
  ]);
  const chevExtracted = await DOMExtractor.extractQuestionFromCard(chevCard, 0);
  assert.equal(chevExtracted.selects[0].label, 'France');

  // 5. querySelectorAllDeep resolves <slot> projected elements even at maxDepth: 0 on a ShadowRoot
  const slotHost = createElement('div');
  const projectedRadio = createElement('div', { role: 'radio', id: 'slotted-at-0' }, ['Opt1']);
  const slotSr = slotHost.attachShadow();
  const slotNode = createElement('slot');
  slotNode.assignedElements = ({ flatten } = {}) => (flatten ? [projectedRadio] : []);
  slotSr.appendChild(slotNode);
  const slotFound = DOMExtractor.querySelectorAllDeep('[role="radio"]', slotSr, { maxDepth: 0 });
  assert.deepEqual(slotFound.map((el) => el.id), ['slotted-at-0']);

  // 6. createNetworkInterceptor ignores NaN maxEntries/maxBodyBytes and keeps safe caps
  const mockTarget = {
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      clone() {
        return { text: async () => JSON.stringify({ question: 'NaN cap test' }) };
      }
    })
  };
  const nanIc = PageBridge.createNetworkInterceptor({
    target: mockTarget,
    maxEntries: NaN,
    maxBodyBytes: NaN
  });
  nanIc.enable();
  for (let i = 0; i < 25; i++) {
    await mockTarget.fetch(`https://quiz.example.com/api/quiz/${i}`);
  }
  await new Promise((r) => setTimeout(r, 15));
  const capturedEntries = nanIc.getEntries();
  assert.equal(capturedEntries.length, 20, 'NaN maxEntries must fall back to default 20');
  assert.ok(capturedEntries[0].body.includes('NaN cap test'), 'NaN maxBodyBytes must fall back to default 65536');
  nanIc.restore();
});

test('Regression Lot 3 pass 3: slotted label ancestry in Shadow card, nested host/shadow deduplication, and MAIN-world UMD module immunity', async () => {
  // 1. Slotted <label> inside light DOM projected into a Shadow DOM .question-card
  const shell = createElement('quiz-shell');
  const shellSr = shell.attachShadow();
  const shadowCard = createElement('div', { class: 'question-card' });
  const slotEl = createElement('slot');
  const shadowStem = createElement('p', {}, ['Capital of France?']);
  shadowCard.appendChild(shadowStem);
  shadowCard.appendChild(slotEl);
  shellSr.appendChild(shadowCard);

  const slottedBadge = createElement('span', { class: 'badge' }, ['(capital)']);
  const rParis = createElement('input', { type: 'radio', name: 'qslot', value: 'p' });
  const slottedLbl1 = createElement('label', {}, [rParis, 'Paris ', slottedBadge]);
  const rLondon = createElement('input', { type: 'radio', name: 'qslot', value: 'l' });
  const slottedLbl2 = createElement('label', {}, [rLondon, 'London']);
  shell.appendChild(slottedLbl1);
  shell.appendChild(slottedLbl2);
  slotEl.assignedElements = ({ flatten } = {}) => (flatten ? [slottedLbl1, slottedLbl2] : []);
  slotEl.assignedNodes = ({ flatten } = {}) => (flatten ? [slottedLbl1, slottedLbl2] : []);
  slottedLbl1.assignedSlot = slotEl;
  slottedLbl2.assignedSlot = slotEl;
  shadowCard.contains = () => false;
  for (const el of [rParis, slottedLbl1, rLondon, slottedLbl2]) {
    el.closest = (sel) => {
      let c = el;
      while (c) {
        if (typeof c.matches === 'function' && c.matches(sel)) return c;
        c = c.parentElement || c.parentNode;
      }
      return null;
    };
  }

  const slottedQ = await DOMExtractor.extractQuestionFromCard(shadowCard, 0);
  assert.ok(slottedQ);
  assert.equal(slottedQ.options[0].text, 'Paris (capital)');
  assert.equal(slottedQ.options[1].text, 'London');

  // 2. Host [data-question] wrapping a <fieldset> inside its shadowRoot must yield 1 deduplicated question
  const nestedHost = createElement('quiz-question', { 'data-question': '1' });
  const nestedSr = nestedHost.attachShadow();
  const innerFieldset = createElement('fieldset', {}, [
    createElement('legend', {}, ['What is 2 + 2?']),
    createElement('label', {}, [createElement('input', { type: 'radio', name: 'nf', value: '3' }), '3']),
    createElement('label', {}, [createElement('input', { type: 'radio', name: 'nf', value: '4' }), '4'])
  ]);
  nestedSr.appendChild(innerFieldset);
  const dedupDoc = createMockDocument([nestedHost]);
  const dedupOut = await DOMExtractor.extractQuizData(dedupDoc, { skipAdaptive: true });
  assert.equal(dedupOut.questions.length, 1);

  // 3. page-bridge.js installs in browser MAIN world even when window.module = { exports: {} } exists
  const pbSrc = fs.readFileSync(path.join(TARGET_ROOT, 'page-bridge.js'), 'utf8');
  const umdDoc = createMockDocument([]);
  umdDoc.location = { origin: 'https://quiz.example.com' };
  const fakeExports = {};
  const umdSandbox = {
    document: umdDoc,
    CustomEvent: MockCustomEvent,
    TextEncoder,
    URL,
    console,
    module: { exports: fakeExports }
  };
  umdSandbox.window = umdSandbox;
  umdSandbox.globalThis = umdSandbox;
  vm.runInNewContext(pbSrc, umdSandbox);
  assert.equal(umdDoc._listenerCount(), 1, 'handshake listener must install despite UMD module shim');
  assert.deepEqual(Object.keys(umdSandbox.module.exports), [], 'must not leak bridge APIs onto window.module.exports');

  // 4. Slotted <select> inside outer <li><quiz-shell> falls back across assignedSlot into shadow .matching-pair
  const outerLi = createElement('li');
  const outerOl = createElement('ol', {}, [outerLi]);
  const slotQuizShell = createElement('quiz-shell');
  outerLi.appendChild(slotQuizShell);
  const qShellSr = slotQuizShell.attachShadow();
  const sCard = createElement('div', { class: 'question-card' });
  const pairA = createElement('div', { class: 'matching-pair' }, ['France ']);
  const slotA = createElement('slot', { name: 'a' });
  pairA.appendChild(slotA);
  const pairB = createElement('div', { class: 'matching-pair' }, ['Germany ']);
  const slotB = createElement('slot', { name: 'b' });
  pairB.appendChild(slotB);
  sCard.appendChild(createElement('p', { class: 'question-text' }, ['Match country']));
  sCard.appendChild(pairA);
  sCard.appendChild(pairB);
  qShellSr.appendChild(sCard);

  const selA = createElement('select', { slot: 'a' }, [createElement('option', { value: 'p' }, ['Paris']), createElement('option', { value: 'r' }, ['Rome'])]);
  const selB = createElement('select', { slot: 'b' }, [createElement('option', { value: 'b' }, ['Berlin']), createElement('option', { value: 'm' }, ['Munich'])]);
  slotQuizShell.appendChild(selA);
  slotQuizShell.appendChild(selB);
  slotA.assignedElements = ({ flatten } = {}) => (flatten ? [selA] : []);
  slotB.assignedElements = ({ flatten } = {}) => (flatten ? [selB] : []);
  selA.assignedSlot = slotA;
  selB.assignedSlot = slotB;
  sCard.contains = () => false;
  // Simulate native closest() walking only light DOM up to outerLi
  for (const selNode of [selA, selB]) {
    selNode.closest = (query) => {
      let c = selNode;
      while (c) {
        if (typeof c.matches === 'function' && c.matches(query)) return c;
        c = c.parentElement || c.parentNode;
      }
      return null;
    };
  }
  const slottedSelectQ = await DOMExtractor.extractQuestionFromCard(sCard, 0);
  assert.ok(slottedSelectQ);
  assert.equal(slottedSelectQ.selects.length, 2);
  assert.equal(slottedSelectQ.selects[0].label, 'France');
  assert.equal(slottedSelectQ.selects[1].label, 'Germany');
});

test('Regression Lot 3 pass 4: React fiber climbs past matching HostComponent, double MAIN injection deduplicates listeners, extractQuestionGeneric avoids self-container text', async () => {
  // 1. React fiber.return climbs past HostComponent with quiz-like prop ("value") to ancestor QuizApp fiber
  const quizAppFiber = {
    memoizedProps: { questions: [{ id: 1, prompt: 'Ancestor quiz stem' }], correct: 'B' },
    memoizedState: { score: 0 },
    return: null
  };
  const wrapperFiber = {
    memoizedProps: { value: 'a', label: 'choice' },
    return: quizAppFiber
  };
  const rootDiv = createElement('div');
  const childDiv = createElement('div');
  rootDiv.__reactFiber$1 = wrapperFiber;
  childDiv.__reactFiber$1 = wrapperFiber;
  rootDiv.appendChild(childDiv);

  const climbOut = PageBridge.extractFrameworkState(rootDiv, { maxDepth: 6 });
  assert.ok(
    climbOut.snapshots.some((s) => s.data?.props?.questions?.[0]?.prompt === 'Ancestor quiz stem'),
    'ancestor React component fiber must not be cut short by inner HostComponent value prop'
  );
  const allKeysOut = PageBridge.extractFrameworkState(rootDiv, { includeAllKeys: true, maxDepth: 6 });
  assert.ok(
    allKeysOut.snapshots.some((s) => s.data?.props?.correct === 'B'),
    'includeAllKeys must climb return chain to ancestor fibers'
  );

  // 2. Re-injecting page-bridge.js in separate VM context on the same document leaves zero duplicate listeners
  const pbSrc = fs.readFileSync(path.join(TARGET_ROOT, 'page-bridge.js'), 'utf8');
  const doc = createMockDocument([]);
  doc.location = { origin: 'https://quiz.example.com' };
  const makeSandbox = () => {
    const sb = {
      document: doc,
      CustomEvent: MockCustomEvent,
      TextEncoder,
      URL,
      console
    };
    sb.window = sb;
    sb.globalThis = sb;
    return sb;
  };
  vm.runInNewContext(pbSrc, makeSandbox());
  vm.runInNewContext(pbSrc, makeSandbox());
  assert.equal(doc._listenerCount(), 1, 'second MAIN injection must not register duplicate handshake listener');
  assert.deepEqual(Object.getOwnPropertySymbols(doc), []);

  const pingRes = await DOMExtractor.requestPageBridge('ping', {}, {
    document: doc,
    CustomEvent: MockCustomEvent,
    timeoutMs: 100
  });
  assert.equal(pingRes.ok, true);
  assert.equal(doc._listenerCount(), 1, 'no ephemeral :req/:ack/:res listeners should leak after bridge call');

  // 3. extractQuestionGeneric when element === container does not soak option labels or turn textarea into fill_blank
  const genericQ = createElement('div', { class: 'question' }, [
    createElement('p', {}, ['What is 2 + 2?']),
    createElement('label', {}, [createElement('input', { type: 'radio', name: 'g', value: '3' }), '3']),
    createElement('label', {}, [createElement('input', { type: 'radio', name: 'g', value: '4' }), '4'])
  ]);
  const resGenericRadio = await DOMExtractor.extractQuestionGeneric(genericQ, 0);
  assert.equal(resGenericRadio.text, 'What is 2 + 2?');

  const genericText = createElement('div', { class: 'question' }, [
    createElement('p', {}, ['Explain photosynthesis']),
    createElement('textarea', { class: 'text-answer', 'aria-multiline': 'true' })
  ]);
  const resGenericText = await DOMExtractor.extractQuestionGeneric(genericText, 0);
  assert.equal(resGenericText.questionType, 'text');
  assert.equal(resGenericText.text, 'Explain photosynthesis');

  // 4. fallbackTextEl === container with non-<p> stem (<span> / <div>) must exclude essay textarea & option labels
  const spanEssay = createElement('div', { class: 'question' }, [
    createElement('span', {}, ['Explain photosynthesis']),
    createElement('textarea', { class: 'text-answer', 'aria-multiline': 'true' })
  ]);
  const spanEssayRes = await DOMExtractor.extractQuestionGeneric(spanEssay, 0);
  assert.equal(spanEssayRes.questionType, 'text');
  assert.equal(spanEssayRes.text, 'Explain photosynthesis');

  const divRadio = createElement('div', { class: 'question' }, [
    createElement('div', {}, ['What is 2 + 2?']),
    createElement('label', {}, [createElement('input', { type: 'radio', name: 'd2', value: '3' }), '3']),
    createElement('label', {}, [createElement('input', { type: 'radio', name: 'd2', value: '4' }), '4'])
  ]);
  const divRadioRes = await DOMExtractor.extractQuestionGeneric(divRadio, 0);
  assert.equal(divRadioRes.questionType, 'single_choice');
  assert.equal(divRadioRes.text, 'What is 2 + 2?');

  // 5. Plain <textarea>, essay [contenteditable], .answer-option, and DnD nodes skipped in fallbackTextEl
  const plainTextareaQ = createElement('div', { class: 'question' }, [
    createElement('span', {}, ['Explain photosynthesis']),
    createElement('textarea', { rows: '4', cols: '40' })
  ]);
  const plainTaRes = await DOMExtractor.extractQuestionGeneric(plainTextareaQ, 0);
  assert.equal(plainTaRes.questionType, 'text');
  assert.equal(plainTaRes.text, 'Explain photosynthesis');

  const essayCeQ = createElement('div', { class: 'question' }, [
    createElement('span', {}, ['Explain photosynthesis']),
    createElement('div', { contenteditable: 'true', class: 'essay', 'aria-multiline': 'true' })
  ]);
  const essayCeRes = await DOMExtractor.extractQuestionGeneric(essayCeQ, 0);
  assert.equal(essayCeRes.questionType, 'text');
  assert.equal(essayCeRes.text, 'Explain photosynthesis');

  const optDivQ = createElement('div', { class: 'question' }, [
    createElement('span', {}, ['What is 2 + 2?']),
    createElement('div', { class: 'answer-option' }, [createElement('input', { type: 'radio', name: 'q3', value: '3' }), createElement('span', {}, ['3'])]),
    createElement('div', { class: 'answer-option' }, [createElement('input', { type: 'radio', name: 'q3', value: '4' }), createElement('span', {}, ['4'])])
  ]);
  const optDivRes = await DOMExtractor.extractQuestionGeneric(optDivQ, 0);
  assert.equal(optDivRes.text, 'What is 2 + 2?');
  assert.deepEqual(optDivRes.options.map((o) => o.text), ['3', '4']);

  const dndFallbackQ = createElement('div', { class: 'question' }, [
    createElement('span', {}, ['Match protocols']),
    createElement('div', { draggable: 'true', id: 'd1' }, ['TCP']),
    createElement('div', { class: 'dropzone', 'data-droppable': 'true', id: 'z1' }, ['Layer 4'])
  ]);
  const dndFbRes = await DOMExtractor.extractQuestionGeneric(dndFallbackQ, 0);
  assert.equal(dndFbRes.questionType, 'drag_drop');
  assert.equal(dndFbRes.text, 'Match protocols');

  // 6. Tier 1A <li class="question-block"><div>...<select></div></li> & slotted <select> inside Light <ol><li><quiz-shell>
  const liBlock = createElement('li', { class: 'question-block' }, [
    createElement('h3', {}, ['Match country']),
    createElement('div', {}, [
      'France ',
      createElement('select', {}, [createElement('option', { value: 'p' }, ['Paris']), createElement('option', { value: 'r' }, ['Rome'])])
    ])
  ]);
  const liDoc = createMockDocument([liBlock]);
  const liOut = await DOMExtractor.extractQuizData(liDoc, { skipAdaptive: true });
  assert.equal(liOut.questions[0].selects[0].label, 'France');

  const cardWithLi = createElement('div', { class: 'question-card' });
  const cardOl = createElement('ol');
  const cardLi = createElement('li');
  const innerShell = createElement('quiz-shell');
  const innerSr = innerShell.attachShadow();
  const innerPairA = createElement('div', { class: 'matching-pair' }, ['France ']);
  const innerSlotA = createElement('slot', { name: 'a' });
  innerPairA.appendChild(innerSlotA);
  const innerPairB = createElement('div', { class: 'matching-pair' }, ['Germany ']);
  const innerSlotB = createElement('slot', { name: 'b' });
  innerPairB.appendChild(innerSlotB);
  innerSr.appendChild(createElement('p', { class: 'question-text' }, ['Match country']));
  innerSr.appendChild(innerPairA);
  innerSr.appendChild(innerPairB);
  const sA = createElement('select', { slot: 'a' }, [createElement('option', { value: 'p' }, ['Paris']), createElement('option', { value: 'r' }, ['Rome'])]);
  const sB = createElement('select', { slot: 'b' }, [createElement('option', { value: 'b' }, ['Berlin']), createElement('option', { value: 'm' }, ['Munich'])]);
  innerShell.appendChild(sA);
  innerShell.appendChild(sB);
  innerSlotA.assignedElements = ({ flatten } = {}) => (flatten ? [sA] : []);
  innerSlotB.assignedElements = ({ flatten } = {}) => (flatten ? [sB] : []);
  sA.assignedSlot = innerSlotA;
  sB.assignedSlot = innerSlotB;
  cardLi.appendChild(innerShell);
  cardOl.appendChild(cardLi);
  cardWithLi.appendChild(cardOl);
  const slottedLiQ = await DOMExtractor.extractQuestionFromCard(cardWithLi, 0);
  assert.deepEqual(slottedLiQ.selects.map((s) => s.label), ['France', 'Germany']);

  // 7. Sibling Web Components with colliding ShadowRoot IDs resolve aria-labelledby locally
  const wc1 = createElement('quiz-item');
  const wc1Sr = wc1.attachShadow();
  wc1Sr.appendChild(createElement('span', { id: 'q-label' }, ['Capital of France?']));
  const rg1 = createElement('div', { role: 'radiogroup', 'aria-labelledby': 'q-label' }, [
    createElement('div', { role: 'radio' }, ['Paris']),
    createElement('div', { role: 'radio' }, ['Lyon'])
  ]);
  wc1Sr.appendChild(rg1);
  rg1.getRootNode = () => wc1Sr;

  const wc2 = createElement('quiz-item');
  const wc2Sr = wc2.attachShadow();
  wc2Sr.appendChild(createElement('span', { id: 'q-label' }, ['Capital of Italy?']));
  const rg2 = createElement('div', { role: 'radiogroup', 'aria-labelledby': 'q-label' }, [
    createElement('div', { role: 'radio' }, ['Rome']),
    createElement('div', { role: 'radio' }, ['Milan'])
  ]);
  wc2Sr.appendChild(rg2);
  rg2.getRootNode = () => wc2Sr;

  const wcSiblingDoc = createMockDocument([wc1, wc2]);
  const wcSiblingOut = await DOMExtractor.extractQuizData(wcSiblingDoc, { skipAdaptive: true });
  assert.deepEqual(wcSiblingOut.questions.map((q) => q.text), ['Capital of France?', 'Capital of Italy?']);

  // 8. Explicit essay <input class="text-answer"> stays text (not fill_blank) when fallbackTextEl === container
  const inputEssay = createElement('div', { class: 'question' }, [
    createElement('span', {}, ['Explain in one sentence']),
    createElement('input', { type: 'text', class: 'text-answer' })
  ]);
  const inputEssayRes = await DOMExtractor.extractQuestionGeneric(inputEssay, 0);
  assert.equal(inputEssayRes.questionType, 'text');
  assert.equal(inputEssayRes.text, 'Explain in one sentence');

  // 9. Shadow DOM ID encapsulation inside a single .question-card (<label for> and aria-labelledby)
  const encapCard = createElement('div', { class: 'question-card' }, [
    createElement('h3', { class: 'question-text' }, ['Pick one shadow option'])
  ]);
  const xOpt1 = createElement('x-opt');
  const xOpt1Sr = xOpt1.attachShadow();
  xOpt1Sr.appendChild(createElement('label', { for: 'opt' }, ['Option A']));
  xOpt1Sr.appendChild(createElement('input', { id: 'opt', type: 'radio', name: 'q_enc', value: 'A' }));

  const xOpt2 = createElement('x-opt');
  const xOpt2Sr = xOpt2.attachShadow();
  xOpt2Sr.appendChild(createElement('label', { for: 'opt' }, ['Option B']));
  xOpt2Sr.appendChild(createElement('input', { id: 'opt', type: 'radio', name: 'q_enc', value: 'B' }));

  encapCard.appendChild(xOpt1);
  encapCard.appendChild(xOpt2);
  const encapQ = await DOMExtractor.extractQuestionFromCard(encapCard, 0);
  assert.deepEqual(encapQ.options.map((o) => o.text), ['Option A', 'Option B']);

  const encapAriaCard = createElement('div', { class: 'question-card' }, [
    createElement('h3', { class: 'question-text' }, ['Pick ARIA shadow option']),
    createElement('span', { id: 'lbl' }, ['Outer Card Noise'])
  ]);
  const xChoice = createElement('x-choice');
  const xChoiceSr = xChoice.attachShadow();
  xChoiceSr.appendChild(createElement('span', { id: 'lbl' }, ['Inner Choice Alpha']));
  xChoiceSr.appendChild(createElement('div', { role: 'radio', 'aria-labelledby': 'lbl' }));
  encapAriaCard.appendChild(xChoice);
  const encapAriaQ = await DOMExtractor.extractQuestionFromCard(encapAriaCard, 0);
  assert.deepEqual(encapAriaQ.options.map((o) => o.text), ['Inner Choice Alpha']);

  // 10.findQuestionTextElement skips <p> inside .answer-option / .dropzone and Tier 1A falls back to card stem
  const stemCard = createElement('div', { class: 'question-card' }, [
    createElement('h2', { class: 'stem' }, ['What is 2 + 2?']),
    createElement('div', { class: 'answer-option' }, [
      createElement('input', { type: 'radio', name: 'q_stem', value: '3' }),
      createElement('p', {}, ['3 (distractor)'])
    ]),
    createElement('div', { class: 'answer-option' }, [
      createElement('input', { type: 'radio', name: 'q_stem', value: '4' }),
      createElement('p', {}, ['4'])
    ])
  ]);
  const stemQ = await DOMExtractor.extractQuestionFromCard(stemCard, 0);
  assert.equal(stemQ.text, 'What is 2 + 2?');

  const spanStemCard = createElement('div', { class: 'question-card' }, [
    createElement('span', {}, ['Span stem question?']),
    createElement('div', { class: 'answer-option' }, [
      createElement('input', { type: 'radio', name: 'q_span', value: 'A' }),
      createElement('p', {}, ['Distractor paragraph'])
    ])
  ]);
  const spanStemQ = await DOMExtractor.extractQuestionFromCard(spanStemCard, 0);
  assert.equal(spanStemQ.text, 'Span stem question?');

  const decoyLabelOnlyCard = createElement('div', { class: 'question-card' }, [
    createElement('label', {}, [createElement('input', { type: 'radio', name: 'q_dec', value: '1' }), 'Only option 1'])
  ]);
  assert.equal(await DOMExtractor.extractQuestionFromCard(decoyLabelOnlyCard, 0), null);
});
