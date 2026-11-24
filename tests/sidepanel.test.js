'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function createDomEnv() {
  class El {
    constructor(tag = 'DIV') {
      this.tagName = String(tag).toUpperCase();
      this.id = '';
      this.className = '';
      this.style = {};
      this.attributes = {};
      this.dataset = {};
      this.children = [];
      this.parentNode = null;
      this.parentElement = null;
      this.hidden = false;
      this.disabled = false;
      this.checked = false;
      this.value = 0;
      this._textContent = '';
      this._listeners = {};
      const self = this;
      this.classList = {
        add(...cls) {
          const s = new Set(self.className.split(/\s+/).filter(Boolean));
          cls.forEach((c) => c && s.add(c));
          self.className = Array.from(s).join(' ');
        },
        remove(...cls) {
          const drop = new Set(cls);
          self.className = self.className.split(/\s+/).filter((c) => c && !drop.has(c)).join(' ');
        },
        contains: (c) => self.className.split(/\s+/).filter(Boolean).includes(c),
        toggle: (c, f) => {
          const next = f === undefined ? !this.contains(c) : Boolean(f);
          if (next) this.add(c);
          else this.remove(c);
          return next;
        }
      };
    }
    get textContent() {
      if (this.children.length > 0 && !this._textContent) {
        return this.children.map((c) => c.textContent || '').join('');
      }
      return this._textContent;
    }
    set textContent(v) {
      this._textContent = String(v ?? '');
      if (this._textContent === '') this.children = [];
    }
    get nextElementSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.children.indexOf(this);
      return idx >= 0 && idx + 1 < this.parentNode.children.length ? this.parentNode.children[idx + 1] : null;
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === 'id') this.id = String(v);
      if (k === 'class') this.className = String(v);
    }
    getAttribute(k) {
      if (k === 'id' && this.id) return this.id;
      if (k === 'class' && this.className) return this.className;
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    }
    removeAttribute(k) {
      delete this.attributes[k];
    }
    appendChild(child) {
      if (!child) return child;
      child.parentNode = this;
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    replaceChildren(...nodes) {
      this.children = [];
      this._textContent = '';
      nodes.forEach((n) => this.appendChild(n));
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
    querySelectorAll(sel) {
      const out = [];
      const cls = sel.startsWith('.') ? sel.slice(1) : null;
      const visit = (n) => {
        for (const c of n.children || []) {
          if (cls ? c.classList.contains(cls) : c.tagName === sel.toUpperCase()) out.push(c);
          visit(c);
        }
      };
      visit(this);
      return out;
    }
    closest(sel) {
      if (sel.includes('command^="--copy"') && this.tagName === 'BUTTON' && String(this.getAttribute('command') || '').startsWith('--copy')) {
        return this;
      }
      return this.parentElement && typeof this.parentElement.closest === 'function' ? this.parentElement.closest(sel) : null;
    }
    addEventListener(t, fn) {
      this._listeners[t] = this._listeners[t] || [];
      this._listeners[t].push(fn);
    }
    dispatchEvent(e) {
      (this._listeners[e.type] || []).forEach((fn) => fn.call(this, e));
    }
  }

  const doc = {
    documentElement: new El('HTML'),
    head: new El('HEAD'),
    body: new El('BODY'),
    _listeners: {},
    createElement: (tag) => new El(tag),
    getElementById(id) {
      const find = (n) => {
        if (n.id === id) return n;
        for (const c of n.children || []) {
          const hit = find(c);
          if (hit) return hit;
        }
        return null;
      };
      return find(doc.documentElement) || find(doc.body);
    },
    addEventListener(t, fn) {
      doc._listeners[t] = doc._listeners[t] || [];
      doc._listeners[t].push(fn);
    }
  };
  return { doc, El };
}

test('F-UX-01 Manifest & Modern Web Guidance HTML/CSS invariants for Side Panel', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions.includes('sidePanel'), true);
  assert.equal(manifest.permissions.includes('activeTab'), false);
  assert.equal(manifest.action?.default_popup, 'popup.html', 'Popup must be preserved alongside side panel');
  assert.equal(manifest.side_panel?.default_path, 'sidepanel.html');

  const spHtml = read('sidepanel.html');
  const spCss = read('sidepanel.css');
  assert.match(spHtml, /<meta name="color-scheme" content="light dark">/);
  assert.match(spHtml, /<script src="theme-init\.js"><\/script>/);
  assert.match(spHtml, /<progress\b[^>]*id="sidePanelProgress"/);
  assert.match(spHtml, /id="zeroTraceToggle"/);
  assert.match(spHtml, /href="settings\.html#dashboard"/);
  assert.equal(/data-qh-/.test(spHtml) || /data-qh-/.test(spCss), false);

  assert.match(spCss, /color-scheme:\s*light dark/);
  assert.match(spCss, /@media \(prefers-reduced-motion:\s*no-preference\)/);
  assert.match(spCss, /@media \(forced-colors:\s*active\)/);
  assert.match(spCss, /scrollbar-color:/);
  assert.match(spCss, /@supports not \(scrollbar-color:\s*auto\)/);
  assert.equal(/transition:[^;]*\ball\b/.test(spCss), false);
  assert.equal(/font-size:\s*[0-9.]+px/.test(spCss), false);
  assert.equal(/outline:\s*none/.test(spCss), false);
  assert.match(spCss, /--success-color:\s*#166534;/);
  assert.match(spCss, /--warning-color:\s*#92400E;/);
  assert.equal(/\.then\s*\(/.test(read('sidepanel.js')), false, 'sidepanel.js must use async/await with zero .then()');
});

test('F-UX-01 background.js: session persistence, Panic purge, synchronous sidePanel.open, and sanitized notifications', async () => {
  const sharedSession = {};
  const broadcasts = [];
  const broadcastTimestamps = [];
  const notifications = [];
  const tabMessages = [];
  const callOrder = [];

  function loadBg() {
    const listeners = { contextClick: null, command: null };
    const sandbox = {
      console: { log: () => {}, warn: () => {}, error: () => {} },
      URL, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
      encodeURIComponent, decodeURIComponent, parseInt, isNaN, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
      setTimeout, clearTimeout, AbortController, AbortSignal,
      module: { exports: {} },
      globalThis: null,
      fetch: async () => { throw new Error('https://serpapi.com/search.json?q=x&api_key=MY_SERP_SECRET'); },
      chrome: {
        runtime: {
          onMessage: { addListener: () => {} },
          onConnect: { addListener: () => {} },
          onInstalled: { addListener: () => {} },
          sendMessage: (msg, cb) => {
            broadcasts.push(msg);
            broadcastTimestamps.push({ action: msg && msg.action, reason: msg && msg.reason, at: Date.now() });
            if (cb) cb({ ok: true });
          },
          lastError: null
        },
        tabs: {
          onRemoved: { addListener: () => {} },
          query: async () => [{ id: 11, url: 'https://quiz.example.com/1' }, { id: 12, url: 'chrome://extensions' }],
          sendMessage: (tabId, payload, cb) => {
            tabMessages.push({ tabId, payload });
            if (cb) cb({ success: true });
          }
        },
        sidePanel: {
          open: async (opts) => {
            callOrder.push({ fn: 'sidePanel.open', opts });
          }
        },
        notifications: { create: (opts) => notifications.push(opts) },
        commands: { onCommand: { addListener: (fn) => { listeners.command = fn; } } },
        contextMenus: { onClicked: { addListener: (fn) => { listeners.contextClick = fn; } } },
        storage: {
          sync: { get: async () => ({ enabled: true, autoMode: false }), set: async () => {} },
          local: { get: async () => ({}), set: async () => {} },
          session: {
            get: async (keys) => {
              const out = {};
              for (const k of keys) if (Object.prototype.hasOwnProperty.call(sharedSession, k)) out[k] = sharedSession[k];
              return out;
            },
            set: async (obj) => Object.assign(sharedSession, obj),
            remove: async (keys) => keys.forEach((k) => delete sharedSession[k])
          }
        }
      }
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(read('background.js'), sandbox);
    return { bg: sandbox.module.exports, listeners };
  }

  const sw1 = loadBg();
  const saved = await sw1.bg.handleSaveSidePanelState({
    state: {
      hostname: 'quiz.example.com',
      zeroTraceMode: true,
      items: [{
        index: 0,
        text: '<b>Capitale?</b> https://x.test/q?token=TOPSECRET',
        options: ['Paris', 'Lyon'],
        optionIndices: [0],
        answerSummary: 'A. Paris',
        confidence: 95,
        explanation: '<script>evil()</script>Capitale de la France.'
      }]
    }
  }, { tab: { id: 11 } });

  assert.equal(saved.success, true);
  assert.equal(saved.state.items[0].text.includes('<b>'), false);
  assert.equal(saved.state.items[0].text.includes('TOPSECRET'), false);
  assert.equal(saved.state.items[0].explanation.includes('<script>'), false);

  // SW restart recovers state from chrome.storage.session
  const sw2 = loadBg();
  const recovered = await sw2.bg.handleGetSidePanelState();
  assert.equal(recovered.success, true);
  assert.equal(recovered.state.items.length, 1);
  assert.equal(recovered.state.items[0].answerSummary, 'A. Paris');

  // Context menu opens side panel synchronously without prior await
  await sw2.listeners.contextClick({ menuItemId: 'cm-open-side-panel' }, { id: 11, windowId: 7 });
  assert.deepEqual(JSON.parse(JSON.stringify(callOrder[0])), { fn: 'sidePanel.open', opts: { windowId: 7 } });

  // Ctrl+Shift+E (clear-highlights) broadcasts Panic purge in < 50ms
  broadcastTimestamps.length = 0;
  const t0 = Date.now();
  await sw2.listeners.command('clear-highlights');
  const panicEvent = broadcastTimestamps.find((m) => m.action === 'sidePanelPanicClear' && m.reason === 'panic');
  assert.ok(panicEvent, 'sidePanelPanicClear event must be broadcast');
  assert.ok(panicEvent.at - t0 < 50, `Panic broadcast took ${panicEvent.at - t0}ms (must be < 50ms)`);
  const afterPanic = await sw2.bg.handleGetSidePanelState();
  assert.equal(afterPanic.state, null);
  assert.ok(broadcasts.some((m) => m.action === 'sidePanelPanicClear' && m.reason === 'panic'));

  // notifyHttpTabs skips chrome:// tabs on toggleExtension
  tabMessages.length = 0;
  await sw2.listeners.command('toggle-extension');
  assert.equal(tabMessages.some((m) => m.tabId === 12), false, 'Must not send toggleExtension to chrome:// tab');
  assert.equal(tabMessages.some((m) => m.tabId === 11 && m.payload.action === 'toggleExtension'), true);

  // SerpAPI errors redact apiKey
  const serpErr = await sw2.bg.handleFetchSerpApi('test', 'MY_SERP_SECRET');
  assert.equal(serpErr.success, false);
  assert.equal(serpErr.error.includes('MY_SERP_SECRET'), false);
});

test('F-UX-01 popup.js: opens side panel preserving user gesture with pre-cached windowId', async () => {
  const { doc, El } = createDomEnv();
  const btn = new El('BUTTON');
  btn.id = 'openSidePanelBtn';
  doc.body.appendChild(btn);

  let eventSequence = [];
  let closed = false;
  const sandbox = {
    document: doc,
    window: null,
    globalThis: null,
    console, setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error,
    chrome: {
      windows: { getCurrent: async () => ({ id: 42 }) },
      tabs: { query: async () => { eventSequence.push('tabs.query'); return [{ id: 5, windowId: 42 }]; } },
      sidePanel: { open: async (opts) => { eventSequence.push({ open: opts }); } },
      runtime: { onMessage: { addListener: () => {} }, sendMessage: (_m, cb) => cb && cb({ success: true, stats: {} }) },
      storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) } }
    },
    module: { exports: {} }
  };
  sandbox.close = () => { closed = true; };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read('popup.js'), sandbox);

  // Trigger DOMContentLoaded so _cachedWindowId is populated before click
  for (const fn of doc._listeners.DOMContentLoaded || []) {
    await fn();
  }
  eventSequence = [];
  await sandbox.SafeExmPopup.openSidePanel();
  assert.deepEqual(
    JSON.parse(JSON.stringify(eventSequence)),
    [{ open: { windowId: 42 } }],
    'Must call sidePanel.open immediately with cached windowId before any tabs.query'
  );
  assert.equal(closed, true);
});

test('F-UX-01 content.js: zeroTraceMode skips HighlightManager DOM touches and sends Side Panel snapshot', async () => {
  const { doc, El } = createDomEnv();
  const qEl = new El('DIV');
  const lbl = new El('LABEL');
  const radio = new El('INPUT');
  lbl.appendChild(radio);
  qEl.appendChild(lbl);
  doc.body.appendChild(qEl);

  let highlightCalls = 0;
  const sentMessages = [];
  let portHandler = null;
  let msgListener = null;

  const sandbox = {
    window: null,
    globalThis: null,
    document: doc,
    location: { hostname: 'course.example.edu', href: 'https://course.example.edu/quiz' },
    console: { log: () => {}, warn: () => {}, error: () => {}, group: () => {}, groupEnd: () => {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise, Error,
    parseInt, parseFloat, isNaN, setTimeout, clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    ConfigCache: { isInitialized: () => true, getAll: () => ({ enabled: true }), get: () => true },
    SchemaCache: { getCachedSchema: async () => null },
    SchemaDetector: { hasInteractiveContent: () => false },
    chrome: {
      storage: {
        sync: { get: async () => ({ enabled: true }) },
        local: { get: async () => ({ zeroTraceMode: true }) },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        onMessage: { addListener: (fn) => { msgListener = fn; } },
        sendMessage: (msg, cb) => {
          sentMessages.push(msg);
          if (cb) cb({ success: true });
          return Promise.resolve({ success: true });
        },
        connect: () => ({
          onMessage: { addListener: (fn) => { portHandler = fn; } },
          onDisconnect: { addListener: () => {} },
          disconnect: () => {},
          postMessage: () => {
            queueMicrotask(() => {
              portHandler({
                success: true,
                answers: [{ questionIndex: 0, optionIndices: [0], confidence: 92, explanation: 'Explication zero-trace' }],
                metadata: { questionsTotal: 1, answersFound: 1, provider: 'groq', model: 'm1', totalDurationMs: 40 }
              });
            });
          }
        })
      }
    },
    SafeExm: {
      DOMExtractor: {
        QUIZ_SELECTORS: { quizContainer: ['.quiz'] },
        isElementVisible: () => true,
        extractQuizData: async () => ({
          questions: [{
            index: 1,
            element: qEl,
            text: 'Question zero-trace ?',
            type: 'radio',
            questionType: 'single_choice',
            options: [{ index: 0, element: radio, labelElement: lbl, text: 'Réponse juste' }]
          }],
          totalImages: 0
        })
      },
      HighlightManager: {
        applyHighlights: async () => { highlightCalls++; return 'OK'; },
        clearAllHighlights: () => {},
        isElementConnected: () => true
      }
    },
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read('content.js'), sandbox);

  const res = await sandbox.SafeExm.Content.handleAnalyzeQuiz({ enabled: true, autoSubmitEnabled: true, autoSubmitMinConfidence: 50 });
  assert.equal(res.success, true);
  assert.equal(res.data.zeroTraceMode, true);
  assert.equal(highlightCalls, 0, 'Zero-trace mode must NOT call HighlightManager.applyHighlights');

  const spMsg = sentMessages.find((m) => m.action === 'saveSidePanelState');
  assert.ok(spMsg, 'Must emit saveSidePanelState');
  assert.equal(spMsg.state.items[0].answerSummary, 'A. Réponse juste');
  assert.equal(spMsg.state.items[0].explanation, 'Explication zero-trace');

  // Panic clearHighlights propagates clearSidePanelState
  msgListener({ action: 'clearHighlights' }, {}, () => {});
  assert.ok(sentMessages.some((m) => m.action === 'clearSidePanelState' && m.reason === 'panic'));
});

test('F-UX-01 sidepanel.js: renders cards, copies answers via live region, and wipes instantly on Panic', async () => {
  const { doc, El } = createDomEnv();
  for (const id of [
    'sidePanelThemeBtn', 'sidePanelAnalyzeBtn', 'sidePanelClearBtn', 'zeroTraceToggle',
    'sidePanelProgressSection', 'sidePanelProgress', 'sidePanelProgressText',
    'sidePanelProgressPercentage', 'sidePanelAnnouncer', 'sidePanelMeta',
    'sidePanelEmpty', 'sidePanelResults'
  ]) {
    const tag = id === 'sidePanelProgress' ? 'PROGRESS' : (id === 'zeroTraceToggle' ? 'INPUT' : 'DIV');
    const el = new El(tag);
    el.id = id;
    if (id === 'sidePanelProgressSection' || id === 'sidePanelMeta' || id === 'sidePanelResults') el.hidden = true;
    doc.body.appendChild(el);
  }

  let copiedText = '';
  let runtimeListener = null;
  const sent = [];

  const sandbox = {
    document: doc,
    window: null,
    globalThis: null,
    console, setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error, WeakMap,
    requestAnimationFrame: (cb) => cb(),
    navigator: { clipboard: { writeText: async (t) => { copiedText = t; } } },
    chrome: {
      runtime: {
        onMessage: { addListener: (fn) => { runtimeListener = fn; } },
        sendMessage: (msg, cb) => { sent.push(msg); if (cb) cb({ success: true }); }
      },
      storage: {
        local: { get: async () => ({ zeroTraceMode: true }), set: async () => {} },
        onChanged: { addListener: () => {} }
      }
    },
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read('sidepanel.js'), sandbox);
  for (const fn of doc._listeners.DOMContentLoaded || []) await fn();

  // Render sample state via runtime broadcast
  runtimeListener({
    action: 'sidePanelStateUpdated',
    state: {
      hostname: 'quiz.example.com',
      zeroTraceMode: true,
      metadata: { provider: 'groq', model: 'gpt-oss', questionsTotal: 1, answersFound: 1 },
      items: [{
        index: 0,
        text: 'What is 2 + 2?',
        answerSummary: 'B. 4',
        confidence: 96,
        confidenceTier: 'high',
        explanation: 'Basic arithmetic.',
        crossValidationStatus: 'confirmed',
        crossValidationNote: 'Confirmed by gemini (96%).'
      }]
    }
  });

  const results = doc.getElementById('sidePanelResults');
  assert.equal(results.hidden, false);
  assert.equal(results.children.length, 1);
  const copyBtn = results.querySelector('.copy-btn');
  const ansTarget = doc.getElementById('sp-ans-0');
  assert.ok(copyBtn && ansTarget);
  assert.equal(ansTarget.textContent, 'B. 4');

  const ok = await sandbox.SafeExmSidePanel.copyAnswerText(copyBtn, ansTarget);
  assert.equal(ok, true);
  assert.equal(copiedText, 'B. 4');
  assert.equal(copyBtn.getAttribute('data-copied'), '');

  // Panic wipe clears cards immediately
  runtimeListener({ action: 'sidePanelPanicClear', reason: 'panic' });
  assert.equal(results.children.length, 0);
  assert.equal(results.hidden, true);
  assert.equal(doc.getElementById('sidePanelEmpty').hidden, false);
});

test('F-UX-01 Regression (Defects 1, 3, 6): popup disable wipes Side Panel & notifies all HTTP tabs; epoch/write tracking blocks Panic resurrection & stale reads; inequalities preserved', async () => {
  const sessionStore = {};
  const broadcasts = [];
  const bgTabMessages = [];
  let storageChangedCb = null;

  let resolvePendingSet = null;
  let holdNextSessionSet = false;

  const bgSandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    URL, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
    encodeURIComponent, decodeURIComponent, parseInt, isNaN, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout, clearTimeout, AbortController, AbortSignal,
    module: { exports: {} },
    globalThis: null,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
        onConnect: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
        sendMessage: (msg, cb) => {
          broadcasts.push(msg);
          if (cb) cb({ ok: true });
        },
        lastError: null
      },
      tabs: {
        onRemoved: { addListener: () => {} },
        query: async () => [
          { id: 21, url: 'https://quiz-a.example.com/1' },
          { id: 22, url: 'chrome://newtab' },
          { id: 23, url: 'https://quiz-b.example.com/2' }
        ],
        sendMessage: (tabId, payload, cb) => {
          bgTabMessages.push({ tabId, payload });
          if (cb) cb({ success: true });
        }
      },
      notifications: { create: () => {} },
      commands: { onCommand: { addListener: () => {} } },
      contextMenus: { onClicked: { addListener: () => {} } },
      storage: {
        onChanged: { addListener: (fn) => { storageChangedCb = fn; } },
        sync: { get: async () => ({ enabled: true }), set: async () => {} },
        local: { get: async () => ({}), set: async () => {} },
        session: {
          get: async (keys) => {
            const out = {};
            for (const k of keys) if (Object.prototype.hasOwnProperty.call(sessionStore, k)) out[k] = sessionStore[k];
            return out;
          },
          set: async (obj) => {
            if (holdNextSessionSet) {
              holdNextSessionSet = false;
              await new Promise((r) => { resolvePendingSet = r; });
            }
            Object.assign(sessionStore, obj);
          },
          remove: async (keys) => keys.forEach((k) => delete sessionStore[k])
        }
      }
    }
  };
  bgSandbox.globalThis = bgSandbox;
  vm.runInNewContext(read('background.js'), bgSandbox);
  const bg = bgSandbox.module.exports;

  // Defect 6: preserve inequalities while stripping real HTML tags
  const sanitized = bg.sanitizeSidePanelState({
    items: [{
      index: 0,
      text: 'If x < 5 and y > 10 <b>check</b>',
      options: ['', 'Paris', 'Lyon'],
      optionIndices: [1],
      answerSummary: 'A. a < b && b > c; x<y && z>0',
      explanation: '<!-- hid --><script>x()</script>a<b && c>d',
      confidence: 88
    }]
  });
  assert.equal(sanitized.items[0].text, 'If x < 5 and y > 10 check');
  assert.equal(sanitized.items[0].answerSummary, 'A. a < b && b > c; x<y && z>0');
  assert.equal(sanitized.items[0].explanation, 'x() a<b && c>d');
  // Defect 4 in sanitizeSidePanelState: empty option index preserved
  assert.deepEqual(JSON.parse(JSON.stringify(sanitized.items[0].options)), ['', 'Paris', 'Lyon']);

  // Defect 3a: Panic clear during in-flight save must prevent resurrection
  holdNextSessionSet = true;
  resolvePendingSet = null;
  const slowSavePromise = bg.handleSaveSidePanelState({
    state: { hostname: 'quiz.test', items: [{ index: 0, text: 'Slow', answerSummary: 'A. 1', confidence: 90 }] }
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(typeof resolvePendingSet, 'function');
  await bg.handleClearSidePanelState('panic');
  resolvePendingSet();
  const slowSaveRes = await slowSavePromise;
  assert.equal(slowSaveRes.cancelled, true);
  assert.equal(sessionStore.sidePanelQuizState, undefined);
  assert.deepEqual(broadcasts.map((b) => b.action), ['sidePanelPanicClear']);

  // Defect 3b: Concurrent get during in-flight save returns NEW, never stale OLD
  sessionStore.sidePanelQuizState = { hostname: 'old.test', items: [{ index: 0, text: 'OLD', answerSummary: 'A. 0', confidence: 70 }] };
  holdNextSessionSet = true;
  resolvePendingSet = null;
  const newSavePromise = bg.handleSaveSidePanelState({
    state: { hostname: 'new.test', items: [{ index: 0, text: 'NEW', answerSummary: 'B. 2', confidence: 95 }] }
  });
  await new Promise((r) => setTimeout(r, 5));
  const concurrentGet = await bg.handleGetSidePanelState();
  assert.equal(concurrentGet.state.items[0].text, 'NEW');
  if (resolvePendingSet) resolvePendingSet();
  await newSavePromise;

  // Defect 1 (background safety net): storage.onChanged sync.enabled=false clears Side Panel and notifies HTTP tabs
  broadcasts.length = 0;
  bgTabMessages.length = 0;
  storageChangedCb({ enabled: { oldValue: true, newValue: false } }, 'sync');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await bg.handleGetSidePanelState()).state, null);
  assert.equal(bgTabMessages.some((m) => m.tabId === 21 && m.payload.enabled === false), true);
  assert.equal(bgTabMessages.some((m) => m.tabId === 23 && m.payload.enabled === false), true);
  assert.equal(bgTabMessages.some((m) => m.tabId === 22), false);

  // Defect 1 (popup.js): #extensionToggle change -> false sends clearSidePanelState + notifies all HTTP tabs even on chrome:// active tab
  const { doc, El } = createDomEnv();
  const extToggle = new El('INPUT');
  extToggle.id = 'extensionToggle';
  extToggle.checked = true;
  doc.body.appendChild(extToggle);
  const popupRuntimeSent = [];
  const popupTabSent = [];
  const popupSandbox = {
    document: doc,
    window: null,
    globalThis: null,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error,
    chrome: {
      windows: { getCurrent: async () => ({ id: 1 }) },
      tabs: {
        query: async (q) => (q && q.active
          ? [{ id: 22, url: 'chrome://newtab' }]
          : [{ id: 21, url: 'https://quiz-a.example.com/1' }, { id: 22, url: 'chrome://newtab' }, { id: 23, url: 'https://quiz-b.example.com/2' }]),
        sendMessage: (tabId, payload, cb) => {
          popupTabSent.push({ tabId, payload });
          if (cb) cb({ success: true });
        }
      },
      runtime: {
        lastError: null,
        onMessage: { addListener: () => {} },
        sendMessage: (msg, cb) => {
          popupRuntimeSent.push(msg);
          if (msg.action === 'clearSidePanelState') {
            void bg.handleClearSidePanelState(msg.reason || 'disabled');
          }
          if (cb) cb({ success: true, stats: {} });
        }
      },
      storage: {
        sync: { get: async () => ({ enabled: true }), set: async () => {} },
        local: { get: async () => ({}), set: async () => {} }
      }
    },
    module: { exports: {} }
  };
  popupSandbox.window = popupSandbox;
  popupSandbox.globalThis = popupSandbox;
  vm.runInNewContext(read('popup.js'), popupSandbox);
  await bg.handleSaveSidePanelState({ state: { hostname: 'quiz-a.example.com', items: [{ index: 0, text: 'Q', answerSummary: 'A', confidence: 90 }] } });
  for (const fn of doc._listeners.DOMContentLoaded || []) await fn();
  await new Promise((r) => setTimeout(r, 15));
  popupTabSent.length = 0;

  extToggle.checked = false;
  await Promise.all((extToggle._listeners.change || []).map((fn) => fn({ target: extToggle })));
  assert.equal(popupRuntimeSent.some((m) => m.action === 'clearSidePanelState' && m.reason === 'disabled'), true);
  assert.equal(popupTabSent.some((m) => m.tabId === 21 && m.payload.action === 'toggleExtension' && m.payload.enabled === false), true);
  assert.equal(popupTabSent.some((m) => m.tabId === 23 && m.payload.action === 'toggleExtension' && m.payload.enabled === false), true);
  assert.equal(popupTabSent.some((m) => m.tabId === 22 && m.payload.action === 'toggleExtension'), false);
  assert.equal((await bg.handleGetSidePanelState()).state, null);
});

test('F-UX-01 Regression (Defects 2, 4, 5, 7): zeroTrace preserveSidePanel avoids Panic boomerang, option indices stay aligned, Auto delta merges connected questions, Panic cancel suppresses error banner', async () => {
  const { doc, El } = createDomEnv();
  const q1El = new El('DIV');
  q1El.isConnected = true;
  const q2El = new El('DIV');
  q2El.isConnected = true;

  let currentQuestions = [{
    index: 1,
    element: q1El,
    text: 'Q1?',
    type: 'radio',
    questionType: 'single_choice',
    options: [
      { index: 0, element: new El('INPUT'), labelElement: new El('LABEL'), text: '' },
      { index: 1, element: new El('INPUT'), labelElement: new El('LABEL'), text: 'Paris' },
      { index: 2, element: new El('INPUT'), labelElement: new El('LABEL'), text: 'Lyon' }
    ]
  }];
  let nextAnswers = [{ questionIndex: 0, optionIndices: [1], confidence: 91 }];

  let clearHighlightCalls = 0;
  let msgListener = null;
  let portHandler = null;
  const savedSnapshots = [];
  const clearedReasons = [];

  const contentSandbox = {
    window: null,
    globalThis: null,
    document: doc,
    location: { hostname: 'course.example.edu', href: 'https://course.example.edu/quiz' },
    console: { log: () => {}, warn: () => {}, error: () => {}, group: () => {}, groupEnd: () => {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise, Error,
    parseInt, parseFloat, isNaN, setTimeout, clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    ConfigCache: { isInitialized: () => true, getAll: () => ({ enabled: true }), get: () => true },
    SchemaCache: { getCachedSchema: async () => null },
    SchemaDetector: { hasInteractiveContent: () => false },
    chrome: {
      storage: {
        sync: { get: async () => ({ enabled: true }) },
        local: { get: async () => ({ zeroTraceMode: true }) },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        onMessage: { addListener: (fn) => { msgListener = fn; } },
        sendMessage: (msg, cb) => {
          if (msg.action === 'saveSidePanelState') savedSnapshots.push(msg.state);
          if (msg.action === 'clearSidePanelState') clearedReasons.push(msg.reason);
          if (cb) cb({ success: true });
          return Promise.resolve({ success: true });
        },
        connect: () => ({
          onMessage: { addListener: (fn) => { portHandler = fn; } },
          onDisconnect: { addListener: () => {} },
          disconnect: () => {},
          postMessage: () => {
            queueMicrotask(() => {
              portHandler({
                success: true,
                answers: nextAnswers,
                metadata: { questionsTotal: currentQuestions.length, answersFound: nextAnswers.length, provider: 'groq', model: 'm1', totalDurationMs: 12 }
              });
            });
          }
        })
      }
    },
    SafeExm: {
      DOMExtractor: {
        QUIZ_SELECTORS: { quizContainer: ['.quiz'] },
        isElementVisible: () => true,
        extractQuizData: async () => ({ questions: currentQuestions.map((q) => ({ ...q })), totalImages: 0 })
      },
      HighlightManager: {
        applyHighlights: async () => 'OK',
        clearAllHighlights: () => { clearHighlightCalls++; },
        isElementConnected: (el) => el.isConnected !== false
      }
    },
    module: { exports: {} }
  };
  contentSandbox.window = contentSandbox;
  contentSandbox.globalThis = contentSandbox;
  vm.runInNewContext(read('content.js'), contentSandbox);
  const Content = contentSandbox.SafeExm.Content;

  // Defect 4 + Defect 5 batch 1 (Auto delta [Q1])
  await Content.handleAnalyzeQuiz({ enabled: true }, true, true);
  assert.equal(savedSnapshots.length, 1);
  assert.equal(savedSnapshots[0].items[0].answerSummary, 'B. Paris');

  // Defect 5 batch 2 (append Q2 while Q1 stays connected -> both preserved)
  currentQuestions = [
    currentQuestions[0],
    {
      index: 2,
      element: q2El,
      text: 'Q2?',
      type: 'radio',
      questionType: 'single_choice',
      options: [{ index: 0, element: new El('INPUT'), labelElement: new El('LABEL'), text: 'Rome' }]
    }
  ];
  nextAnswers = [{ questionIndex: 0, optionIndices: [0], confidence: 95 }];
  await Content.handleAnalyzeQuiz({ enabled: true }, true, true);
  assert.equal(savedSnapshots.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(savedSnapshots[1].items.map((it) => it.text))), ['Q1?', 'Q2?']);

  // Now check Side Panel + Defect 2 & Defect 7
  const spEnv = createDomEnv();
  for (const id of [
    'sidePanelThemeBtn', 'sidePanelAnalyzeBtn', 'sidePanelClearBtn', 'zeroTraceToggle',
    'sidePanelProgressSection', 'sidePanelProgress', 'sidePanelProgressText',
    'sidePanelProgressPercentage', 'sidePanelAnnouncer', 'sidePanelMeta',
    'sidePanelEmpty', 'sidePanelResults'
  ]) {
    const tag = id === 'sidePanelProgress' ? 'PROGRESS' : (id === 'zeroTraceToggle' ? 'INPUT' : 'DIV');
    const el = new spEnv.El(tag);
    el.id = id;
    if (id === 'sidePanelProgressSection' || id === 'sidePanelMeta' || id === 'sidePanelResults') el.hidden = true;
    spEnv.doc.body.appendChild(el);
  }

  let spRuntimeListener = null;
  let storedState = savedSnapshots[1];
  let resolveTabAnalyze = null;
  const spSandbox = {
    document: spEnv.doc,
    window: null,
    globalThis: null,
    console, setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error, WeakMap,
    requestAnimationFrame: (cb) => cb(),
    navigator: { clipboard: { writeText: async () => {} } },
    chrome: {
      tabs: {
        query: async () => [{ id: 1, url: 'https://course.example.edu/quiz' }],
        sendMessage: (_tabId, msg, cb) => {
          if (msg.action === 'clearHighlights') {
            let reply = { success: true };
            msgListener(msg, {}, (r) => { reply = r; });
            if (cb) cb(reply);
            return;
          }
          if (msg.action === 'analyzeQuiz') {
            resolveTabAnalyze = (r) => { if (cb) cb(r); };
          }
        }
      },
      runtime: {
        onMessage: { addListener: (fn) => { spRuntimeListener = fn; } },
        sendMessage: (msg, cb) => {
          if (msg.action === 'getSidePanelState' && cb) cb({ success: true, state: storedState });
          else if (cb) cb({ success: true });
        }
      },
      storage: {
        sync: { get: async () => ({ enabled: true }) },
        local: { get: async () => ({ zeroTraceMode: false }), set: async () => {} },
        onChanged: { addListener: () => {} }
      }
    },
    module: { exports: {} }
  };
  spSandbox.window = spSandbox;
  spSandbox.globalThis = spSandbox;
  vm.runInNewContext(read('sidepanel.js'), spSandbox);
  for (const fn of spEnv.doc._listeners.DOMContentLoaded || []) await fn();

  assert.equal(spSandbox.SafeExmSidePanel.getCurrentState().items.length, 2);

  // Defect 2: Enabling zeroTraceMode clears host highlights while preserving Side Panel answers!
  await spSandbox.SafeExmSidePanel.setZeroTraceMode(true);
  assert.equal(clearHighlightCalls, 1);
  assert.equal(clearedReasons.length, 0, 'preserveSidePanel must not trigger clearSidePanelState panic');
  assert.equal(spSandbox.SafeExmSidePanel.getCurrentState().items.length, 2);

  // Defect 7: Panic cancellation during analyzeFromSidePanel keeps progressSection hidden without showing Erreur
  storedState = null;
  const runPromise = spSandbox.SafeExmSidePanel.analyzeFromSidePanel();
  await new Promise((r) => setTimeout(r, 15));
  spRuntimeListener({ action: 'sidePanelPanicClear', reason: 'panic' });
  resolveTabAnalyze({ success: false, cancelled: true, error: 'Analyse annulée' });
  await runPromise;

  assert.equal(spEnv.doc.getElementById('sidePanelProgressSection').hidden, true);
  assert.equal(spEnv.doc.getElementById('sidePanelProgressText').textContent.includes('Erreur'), false);
});

test('F-UX-01 Re-audit Regression (6 concurrency & edge defects): serialized session ops, all-tab Panic purge, loadSidePanelState epoch guard, live zeroTraceMode re-read, popup cancel, sync open guard', async () => {
  const sessionStore = {};
  const broadcasts = [];
  const bgTabMessages = [];
  const notifications = [];
  let holdRemoveCount = 0;
  let releaseRemove = null;
  let holdSetQueue = [];

  const listeners = { command: null, contextClick: null };
  const bgSandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    URL, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
    encodeURIComponent, decodeURIComponent, parseInt, isNaN, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout, clearTimeout, AbortController, AbortSignal,
    module: { exports: {} },
    globalThis: null,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    chrome: {
      sidePanel: {
        open: () => { throw new Error('Sync sidePanel.open failure'); }
      },
      runtime: {
        onMessage: { addListener: () => {} },
        onConnect: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
        sendMessage: (msg, cb) => {
          broadcasts.push(msg);
          if (cb) cb({ ok: true });
        },
        lastError: null
      },
      tabs: {
        onRemoved: { addListener: () => {} },
        query: async (q) => (q && q.active
          ? [{ id: 2, active: true, url: 'https://docs.example.com' }]
          : [{ id: 1, active: false, url: 'https://quiz-a.example.com' }, { id: 2, active: true, url: 'https://docs.example.com' }]),
        sendMessage: (tabId, payload, cb) => {
          bgTabMessages.push({ tabId, payload });
          if (cb) cb({ success: true });
        }
      },
      notifications: { create: (opts) => notifications.push(opts) },
      commands: { onCommand: { addListener: (fn) => { listeners.command = fn; } } },
      contextMenus: { onClicked: { addListener: (fn) => { listeners.contextClick = fn; } } },
      storage: {
        sync: { get: async () => ({ enabled: true }), set: async () => {} },
        local: { get: async () => ({}), set: async () => {} },
        session: {
          get: async (keys) => {
            const out = {};
            for (const k of keys) if (Object.prototype.hasOwnProperty.call(sessionStore, k)) out[k] = sessionStore[k];
            return out;
          },
          set: async (obj) => {
            if (holdSetQueue.length > 0) {
              const hold = holdSetQueue.shift();
              await new Promise((r) => hold(r));
            }
            Object.assign(sessionStore, obj);
          },
          remove: async (keys) => {
            if (holdRemoveCount > 0) {
              holdRemoveCount--;
              await new Promise((r) => { releaseRemove = r; });
            }
            keys.forEach((k) => delete sessionStore[k]);
          }
        }
      }
    }
  };
  bgSandbox.globalThis = bgSandbox;
  vm.runInNewContext(read('background.js'), bgSandbox);
  const bg = bgSandbox.module.exports;

  // Finding 1 Case A: clear (pending remove) -> save2 (S2) serializes clean without post-save wipe
  sessionStore.sidePanelQuizState = { hostname: 'old.com', items: [] };
  holdRemoveCount = 1;
  broadcasts.length = 0;
  const pClear = bg.handleClearSidePanelState('panic');
  const pSave2 = bg.handleSaveSidePanelState({ state: { hostname: 'b.com', items: [{ index: 0, text: 'S2', answerSummary: 'A', confidence: 90 }] } });
  await new Promise((r) => setTimeout(r, 10));
  releaseRemove();
  await Promise.all([pClear, pSave2]);
  assert.equal(sessionStore.sidePanelQuizState?.hostname, 'b.com');
  assert.deepEqual(broadcasts.map((b) => b.action), ['sidePanelPanicClear', 'sidePanelStateUpdated']);

  // Finding 1 Case B: save1 (slow set) -> clear -> save2 leaves s2 in both storage and memory
  broadcasts.length = 0;
  let releaseB1 = null;
  holdSetQueue = [(res) => { releaseB1 = res; }];
  const bSave1 = bg.handleSaveSidePanelState({ state: { hostname: 'b1.com', items: [{ index: 0, text: 'B1', answerSummary: 'A', confidence: 80 }] } });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(typeof releaseB1, 'function');
  const bClear = bg.handleClearSidePanelState('panic');
  const bSave2 = bg.handleSaveSidePanelState({ state: { hostname: 'b2.com', items: [{ index: 0, text: 'B2', answerSummary: 'B', confidence: 95 }] } });
  await bClear;
  releaseB1();
  await Promise.all([bSave1, bSave2]);
  holdSetQueue.length = 0;
  assert.equal(sessionStore.sidePanelQuizState?.hostname, 'b2.com');
  assert.equal((await bg.handleGetSidePanelState()).state?.hostname, 'b2.com');
  assert.deepEqual(broadcasts.map((b) => b.action), ['sidePanelPanicClear', 'sidePanelStateUpdated']);

  // Finding 1 Case C: save1 -> save2 -> save3 leaves S3 in both storage and memory
  broadcasts.length = 0;
  let r1, r2, r3;
  holdSetQueue = [(res) => { r1 = res; }, (res) => { r2 = res; }, (res) => { r3 = res; }];
  const s1 = bg.handleSaveSidePanelState({ state: { hostname: 's1.com', items: [{ index: 0, text: '1', answerSummary: 'A', confidence: 80 }] } });
  const s2 = bg.handleSaveSidePanelState({ state: { hostname: 's2.com', items: [{ index: 0, text: '2', answerSummary: 'A', confidence: 85 }] } });
  const s3 = bg.handleSaveSidePanelState({ state: { hostname: 's3.com', items: [{ index: 0, text: '3', answerSummary: 'A', confidence: 90 }] } });
  await new Promise((r) => setTimeout(r, 10));
  if (r1) r1();
  await new Promise((r) => setTimeout(r, 10));
  if (r2) r2();
  await new Promise((r) => setTimeout(r, 10));
  if (r3) r3();
  await Promise.all([s1, s2, s3]);
  holdSetQueue.length = 0;
  assert.equal(sessionStore.sidePanelQuizState?.hostname, 's3.com');
  assert.equal((await bg.handleGetSidePanelState()).state?.hostname, 's3.com');

  // Finding 2: Panic shortcut cancels background tab (tab 1) as well as active tab (tab 2) and rejects stale pre-Panic analysis
  bgTabMessages.length = 0;
  const oldStartedAt = Date.now() - 500;
  await new Promise((r) => setTimeout(r, 10));
  await listeners.command('clear-highlights');
  assert.equal(bgTabMessages.some((m) => m.tabId === 1 && m.payload.action === 'clearHighlights'), true);
  assert.equal(bgTabMessages.some((m) => m.tabId === 2 && m.payload.action === 'clearHighlights'), true);
  const staleSave = await bg.handleSaveSidePanelState({
    state: { analysisStartedAt: oldStartedAt, hostname: 'quiz-a.example.com', items: [{ index: 0, text: 'Late', answerSummary: 'A', confidence: 90 }] }
  });
  assert.equal(staleSave.cancelled, true);
  assert.equal((await bg.handleGetSidePanelState()).state, null);

  // Finding 6: Synchronous chrome.sidePanel.open throw in context menu is caught cleanly
  notifications.length = 0;
  await assert.doesNotReject(() => listeners.contextClick({ menuItemId: 'cm-open-side-panel' }, { id: 2, windowId: 9 }));
  assert.equal(notifications.some((n) => n.message && n.message.includes('Impossible')), true);

  // Finding 3: sidepanel.js loadSidePanelState() does not resurrect cards if sidePanelPanicClear fires mid-flight
  const spEnv = createDomEnv();
  for (const id of [
    'sidePanelThemeBtn', 'sidePanelAnalyzeBtn', 'sidePanelClearBtn', 'zeroTraceToggle',
    'sidePanelProgressSection', 'sidePanelProgress', 'sidePanelProgressText',
    'sidePanelProgressPercentage', 'sidePanelAnnouncer', 'sidePanelMeta',
    'sidePanelEmpty', 'sidePanelResults'
  ]) {
    const tag = id === 'sidePanelProgress' ? 'PROGRESS' : (id === 'zeroTraceToggle' ? 'INPUT' : 'DIV');
    const el = new spEnv.El(tag);
    el.id = id;
    spEnv.doc.body.appendChild(el);
  }
  let resolveGetState = null;
  let spRuntimeListener = null;
  const spSandbox = {
    document: spEnv.doc,
    window: null,
    globalThis: null,
    console, setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error, WeakMap,
    requestAnimationFrame: (cb) => cb(),
    navigator: { clipboard: { writeText: async () => {} } },
    chrome: {
      runtime: {
        onMessage: { addListener: (fn) => { spRuntimeListener = fn; } },
        sendMessage: (msg, cb) => {
          if (msg.action === 'getSidePanelState') {
            resolveGetState = () => cb && cb({
              success: true,
              state: { hostname: 'quiz.test', items: [{ index: 0, text: 'Stale', answerSummary: 'A', confidence: 95 }] }
            });
          } else if (cb) {
            cb({ success: true });
          }
        }
      },
      storage: { local: { get: async () => ({ zeroTraceMode: false }), set: async () => {} }, onChanged: { addListener: () => {} } }
    },
    module: { exports: {} }
  };
  spSandbox.window = spSandbox;
  spSandbox.globalThis = spSandbox;
  vm.runInNewContext(read('sidepanel.js'), spSandbox);
  for (const fn of spEnv.doc._listeners.DOMContentLoaded || []) void fn();
  await new Promise((r) => setTimeout(r, 15));
  spRuntimeListener({ action: 'sidePanelPanicClear', reason: 'panic' });
  resolveGetState();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(spSandbox.SafeExmSidePanel.getCurrentState(), null);
  assert.equal(spEnv.doc.getElementById('sidePanelResults').hidden, true);

  // Finding 4: content.js re-reads live zeroTraceMode after LLM response resolves
  const cEnv = createDomEnv();
  let liveZeroTrace = false;
  let midFlightHighlights = 0;
  let cPortHandler = null;
  const contentSandbox = {
    window: null,
    globalThis: null,
    document: cEnv.doc,
    location: { hostname: 'course.example.edu', href: 'https://course.example.edu/quiz' },
    console: { log: () => {}, warn: () => {}, error: () => {}, group: () => {}, groupEnd: () => {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise, Error,
    parseInt, parseFloat, isNaN, setTimeout, clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    ConfigCache: { isInitialized: () => true, getAll: () => ({ enabled: true, zeroTraceMode: false }), get: () => false },
    SchemaCache: { getCachedSchema: async () => null },
    SchemaDetector: { hasInteractiveContent: () => false },
    chrome: {
      storage: {
        sync: { get: async () => ({ enabled: true }) },
        local: { get: async () => ({ zeroTraceMode: liveZeroTrace }), onChanged: null },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: (_m, cb) => { if (cb) cb({ success: true }); return Promise.resolve({ success: true }); },
        connect: () => ({
          onMessage: { addListener: (fn) => { cPortHandler = fn; } },
          onDisconnect: { addListener: () => {} },
          disconnect: () => {},
          postMessage: () => {
            setTimeout(() => {
              liveZeroTrace = true; // user enabled zero-trace while LLM was solving!
              cPortHandler({
                success: true,
                answers: [{ questionIndex: 0, optionIndices: [0], confidence: 95 }],
                metadata: { questionsTotal: 1, answersFound: 1, provider: 'groq', model: 'm1', totalDurationMs: 10 }
              });
            }, 15);
          }
        })
      }
    },
    SafeExm: {
      DOMExtractor: {
        QUIZ_SELECTORS: { quizContainer: ['.quiz'] },
        isElementVisible: () => true,
        extractQuizData: async () => ({
          questions: [{ index: 1, element: new cEnv.El('DIV'), text: 'Q?', type: 'radio', questionType: 'single_choice', options: [{ index: 0, element: new cEnv.El('INPUT'), labelElement: new cEnv.El('LABEL'), text: 'Oui' }] }],
          totalImages: 0
        })
      },
      HighlightManager: {
        applyHighlights: async () => { midFlightHighlights++; return 'OK'; },
        clearAllHighlights: () => {},
        isElementConnected: () => true
      }
    },
    module: { exports: {} }
  };
  contentSandbox.window = contentSandbox;
  contentSandbox.globalThis = contentSandbox;
  vm.runInNewContext(read('content.js'), contentSandbox);
  const liveZtRes = await contentSandbox.SafeExm.Content.handleAnalyzeQuiz({ enabled: true, zeroTraceMode: false });
  assert.equal(liveZtRes.success, true);
  assert.equal(liveZtRes.data.zeroTraceMode, true);
  assert.equal(midFlightHighlights, 0, 'Enabling zeroTraceMode mid-flight must skip DOM highlights');

  // Finding 5: popup.js analyzeQuiz cancelled via clearHighlights keeps progressSection hidden without error banner
  const pEnv = createDomEnv();
  const progSec = new pEnv.El('DIV'); progSec.id = 'progressSection'; progSec.hidden = true;
  const progText = new pEnv.El('DIV'); progText.id = 'progressText';
  const progBar = new pEnv.El('DIV'); progBar.id = 'progressBarFill';
  const anaBtn = new pEnv.El('BUTTON'); anaBtn.id = 'analyzeBtn';
  pEnv.doc.body.appendChild(progSec); pEnv.doc.body.appendChild(progText); pEnv.doc.body.appendChild(progBar); pEnv.doc.body.appendChild(anaBtn);
  let resolvePopupAnalyze = null;
  const pSandbox = {
    document: pEnv.doc,
    window: null,
    globalThis: null,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error,
    chrome: {
      tabs: {
        query: async () => [{ id: 1, url: 'https://quiz.test' }],
        sendMessage: (_id, msg, cb) => {
          if (msg.action === 'analyzeQuiz') resolvePopupAnalyze = (r) => cb && cb(r);
          else if (cb) cb({ success: true });
        }
      },
      runtime: { lastError: null, onMessage: { addListener: () => {} }, sendMessage: (_m, cb) => cb && cb({ success: true, stats: {} }) },
      storage: { sync: { get: async () => ({ enabled: true }), set: async () => {} }, local: { get: async () => ({}) } }
    },
    module: { exports: {} }
  };
  pSandbox.window = pSandbox;
  pSandbox.globalThis = pSandbox;
  vm.runInNewContext(read('popup.js'), pSandbox);

  const pAnaPromise = pSandbox.SafeExmPopup.analyzeQuiz();
  await new Promise((r) => setTimeout(r, 15));
  await pSandbox.SafeExmPopup.clearHighlights();
  resolvePopupAnalyze({ success: false, cancelled: true, error: 'Analyse annulée' });
  await pAnaPromise;
  assert.equal(progSec.hidden, true);
  assert.equal(progText.textContent.includes('Erreur'), false);
});

test('F-UX-01 Re-audit Pass 3 Regression: BackgroundAgent aborts on solveQuiz port disconnect & Panic purge; UI drops post-Panic analysisProgress and external Panic hides Popup progress', { timeout: 8000 }, async () => {
  // 1. Background + BackgroundAgent real integration: port.onDisconnect and Panic abort cross-validation / retries & block post-Panic analysisProgress
  let onConnectHandler = null;
  const runtimeProgressSent = [];
  let llmCalls = 0;
  const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for ${label}`)), ms);
    if (t && typeof t.unref === 'function') t.unref();
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });

  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {}, group: () => {}, groupEnd: () => {} },
    URL, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
    encodeURIComponent, decodeURIComponent, parseInt, isNaN, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout, clearTimeout, AbortController, AbortSignal,
    module: { exports: {} },
    globalThis: null,
    fetch: async () => ({ ok: true, status: 200, text: async () => 'System prompt {{domain_rules}}' }),
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
        onConnect: { addListener: (fn) => { onConnectHandler = fn; } },
        onInstalled: { addListener: () => {} },
        sendMessage: (msg, cb) => {
          runtimeProgressSent.push(msg);
          if (cb) cb({ ok: true });
          return Promise.resolve({ ok: true });
        },
        getURL: (p) => `chrome-extension://test/${p}`,
        lastError: null
      },
      tabs: { onRemoved: { addListener: () => {} }, query: async () => [], sendMessage: (_id, _m, cb) => cb && cb({ success: true }) },
      notifications: { create: () => {} },
      commands: { onCommand: { addListener: () => {} } },
      contextMenus: { onClicked: { addListener: () => {} } },
      storage: {
        sync: { get: async () => ({ enabled: true }), set: async () => {} },
        local: { get: async () => ({ groqApiKey: 'gsk_1', geminiApiKey: 'AIza1' }), set: async () => {} },
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} }
      }
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.QuizProviders = {
    PROVIDERS: {
      groq: { name: 'Groq', apiKeyField: 'groqApiKey', apiUrl: 'https://api.groq.com/openai/v1/chat/completions', textModels: [{ id: 'm1' }] },
      gemini: { name: 'Gemini', apiKeyField: 'geminiApiKey', apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models', textModels: [{ id: 'm2' }] }
    },
    DEFAULT_PRIORITY: ['groq', 'gemini'],
    getAllStorageKeys: () => ['groqApiKey', 'geminiApiKey', 'providerConfigs'],
    getAllApiKeyFields: () => ['groqApiKey', 'geminiApiKey'],
    isProviderConfigured: () => true,
    getFirstConfiguredProvider: () => 'groq',
    getModelForContext: (_p, _v) => 'm1',
    getModelContextLimit: () => 128000,
    extensionFetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) }),
    callProvider: async () => ({ text: '', model: 'm1' })
  };

  vm.runInNewContext(read('background-agent.js'), sandbox);
  const agentApi = sandbox.module.exports.BackgroundAgent;
  sandbox.module = { exports: {} };
  vm.runInNewContext(read('background.js'), sandbox);
  const bg = sandbox.module.exports;

  // Test 1a: Panic mid-solve aborts before crossValidation second LLM call and stops further progress messages
  let msgHandler1 = null;
  const posted1 = [];
  onConnectHandler({
    name: 'solveQuiz',
    onMessage: { addListener: (fn) => { msgHandler1 = fn; } },
    onDisconnect: { addListener: () => {} },
    postMessage: (p) => posted1.push(p)
  });

  let resolveCall1Started = null;
  const call1Started = new Promise((r) => { resolveCall1Started = r; });
  let releaseCall1 = null;
  const call1Gate = new Promise((r) => { releaseCall1 = r; });
  const answerXml = '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index><confidence>45</confidence><explanation>uncertain</explanation></answer></quiz_answers>';
  sandbox.QuizProviders.extensionFetch = async () => {
    llmCalls++;
    resolveCall1Started();
    await call1Gate;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: answerXml } }] }) };
  };
  sandbox.QuizProviders.callProvider = async () => {
    llmCalls++;
    return { text: answerXml, model: 'groq-m1' };
  };

  const taskPayload = {
    questions: [{ index: 1, text: 'Q?', type: 'radio', questionType: 'single_choice', options: [{ index: 0, text: 'Yes' }] }],
    config: {
      syncConfig: { enabled: true },
      apiKeys: { groqApiKey: 'gsk_1', geminiApiKey: 'AIza1' },
      settings: { crossValidationEnabled: true, crossValidationThreshold: 70, selectedProvider: 'groq' }
    }
  };

  const p1 = msgHandler1({ action: 'solveQuiz', task: taskPayload });
  await withTimeout(call1Started, 1500, 'call1Started');
  await bg.handleClearSidePanelState('panic');
  releaseCall1();
  await p1;
  assert.equal(llmCalls, 1, 'Panic abort must stop cross-validation secondary LLM call');
  assert.equal(posted1.length, 0, 'Aborted solve must not postMessage back on cancelled run');
  const postPanicProgress = runtimeProgressSent
    .slice(runtimeProgressSent.findIndex((m) => m.action === 'sidePanelPanicClear') + 1)
    .filter((m) => m.action === 'analysisProgress');
  assert.equal(postPanicProgress.length, 0, 'No analysisProgress may emit after Panic');

  // Test 1b: port.onDisconnect triggers AbortSignal immediately
  llmCalls = 0;
  let resolveCall2Started = null;
  const call2Started = new Promise((r) => { resolveCall2Started = r; });
  let releaseCall2 = null;
  const call2Gate = new Promise((r) => { releaseCall2 = r; });
  let disconnectCb2 = null;
  let msgHandler2 = null;
  let disconnectSeenInSignal = false;
  sandbox.QuizProviders.extensionFetch = async (_url, opts) => {
    llmCalls++;
    resolveCall2Started();
    await call2Gate;
    disconnectSeenInSignal = Boolean(opts?.signal?.aborted);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: answerXml } }] }) };
  };
  onConnectHandler({
    name: 'solveQuiz',
    onMessage: { addListener: (fn) => { msgHandler2 = fn; } },
    onDisconnect: { addListener: (fn) => { disconnectCb2 = fn; } },
    postMessage: () => {}
  });
  const p2 = msgHandler2({ action: 'solveQuiz', task: taskPayload });
  await withTimeout(call2Started, 1500, 'call2Started');
  disconnectCb2();
  releaseCall2();
  await p2;
  assert.equal(disconnectSeenInSignal, true, 'port.onDisconnect must abort signal inside BackgroundAgent');
  assert.equal(llmCalls, 1, 'port.onDisconnect must prevent follow-up cross-validation call');

  // 2. Side Panel ignores late post-Panic analysisProgress (> 10%)
  const spEnv = createDomEnv();
  for (const id of [
    'sidePanelThemeBtn', 'sidePanelAnalyzeBtn', 'sidePanelClearBtn', 'zeroTraceToggle',
    'sidePanelProgressSection', 'sidePanelProgress', 'sidePanelProgressText',
    'sidePanelProgressPercentage', 'sidePanelAnnouncer', 'sidePanelMeta',
    'sidePanelEmpty', 'sidePanelResults'
  ]) {
    const tag = id === 'sidePanelProgress' ? 'PROGRESS' : (id === 'zeroTraceToggle' ? 'INPUT' : 'DIV');
    const el = new spEnv.El(tag);
    el.id = id;
    if (id === 'sidePanelProgressSection' || id === 'sidePanelResults') el.hidden = true;
    spEnv.doc.body.appendChild(el);
  }
  let spRuntime = null;
  const spSandbox = {
    document: spEnv.doc, window: null, globalThis: null,
    console, setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error, WeakMap,
    requestAnimationFrame: (cb) => cb(),
    navigator: { clipboard: { writeText: async () => {} } },
    chrome: {
      runtime: { onMessage: { addListener: (fn) => { spRuntime = fn; } }, sendMessage: (_m, cb) => cb && cb({ success: true }) },
      storage: { local: { get: async () => ({ zeroTraceMode: false }), set: async () => {} }, onChanged: { addListener: () => {} } }
    },
    module: { exports: {} }
  };
  spSandbox.window = spSandbox;
  spSandbox.globalThis = spSandbox;
  vm.runInNewContext(read('sidepanel.js'), spSandbox);
  for (const fn of spEnv.doc._listeners.DOMContentLoaded || []) await fn();

  spRuntime({ action: 'sidePanelPanicClear', reason: 'panic' });
  spRuntime({ action: 'analysisProgress', step: 'Double vérification…', percent: 90 });
  assert.equal(spEnv.doc.getElementById('sidePanelProgressSection').hidden, true);

  // 3. Popup: external sidePanelPanicClear + { cancelled: true } hides progressSection cleanly & drops late progress
  const pEnv = createDomEnv();
  const progSec = new pEnv.El('DIV'); progSec.id = 'progressSection'; progSec.hidden = true;
  const progText = new pEnv.El('DIV'); progText.id = 'progressText';
  const progPct = new pEnv.El('DIV'); progPct.id = 'progressPercentage';
  const progBar = new pEnv.El('DIV'); progBar.id = 'progressBarFill';
  const anaBtn = new pEnv.El('BUTTON'); anaBtn.id = 'analyzeBtn';
  pEnv.doc.body.appendChild(progSec); pEnv.doc.body.appendChild(progText);
  pEnv.doc.body.appendChild(progPct); pEnv.doc.body.appendChild(progBar); pEnv.doc.body.appendChild(anaBtn);

  let popupRuntime = null;
  let resolveTab = null;
  const pSandbox = {
    document: pEnv.doc, window: null, globalThis: null,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error,
    chrome: {
      tabs: {
        query: async () => [{ id: 1, url: 'https://quiz.test' }],
        sendMessage: (_id, msg, cb) => {
          if (msg.action === 'analyzeQuiz') resolveTab = (r) => cb && cb(r);
          else if (cb) cb({ success: true });
        }
      },
      runtime: { lastError: null, onMessage: { addListener: (fn) => { popupRuntime = fn; } }, sendMessage: (_m, cb) => cb && cb({ success: true, stats: {} }) },
      storage: { sync: { get: async () => ({ enabled: true }), set: async () => {} }, local: { get: async () => ({}) } }
    },
    module: { exports: {} }
  };
  pSandbox.window = pSandbox;
  pSandbox.globalThis = pSandbox;
  vm.runInNewContext(read('popup.js'), pSandbox);
  for (const fn of pEnv.doc._listeners.DOMContentLoaded || []) await fn();

  const anaPromise = pSandbox.SafeExmPopup.analyzeQuiz();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(progSec.hidden, false);
  popupRuntime({ action: 'sidePanelPanicClear', reason: 'panic' });
  popupRuntime({ action: 'analysisProgress', step: 'Double vérification…', percent: 90 });
  resolveTab({ success: false, cancelled: true, error: 'Analyse annulée' });
  await anaPromise;
  assert.equal(progSec.hidden, true);
  assert.equal(progSec.style.display, 'none');

  // 4. Pass 4 Finding 1: Late { success: true } response after Panic must NOT resurrect popup progressSection
  const lateAnaPromise = pSandbox.SafeExmPopup.analyzeQuiz();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(progSec.hidden, false);
  popupRuntime({ action: 'sidePanelPanicClear', reason: 'panic' });
  assert.equal(progSec.hidden, true);
  resolveTab({ success: true, data: { questionsFound: 3, answersHighlighted: 3 } });
  await lateAnaPromise;
  assert.equal(progSec.hidden, true);
  assert.equal(progSec.style.display, 'none');

  // 5. Pass 4 Finding 3 & 4: BackgroundAgent preserves inequalities in explanation/notes and aborts Ralph retry before backup provider
  const normInequal = agentApi.normalizeAnswerEntry({
    questionIndex: 0,
    confidence: 80,
    explanation: 'Because x < 5 && y > 10 and <b>bold</b>',
    crossValidationNote: 'Check a<b && c>d'
  });
  assert.equal(normInequal.explanation, 'Because x < 5 && y > 10 and bold');
  assert.equal(normInequal.crossValidationNote, 'Check a<b && c>d');

  // Pass 4 Finding 4: Ralph retry (missing Q2 after Fast Path & Agent Chunk solve Q1) aborts after provider 1 without trying provider 2
  let ralphCalls = 0;
  let ralphStarted = null;
  const ralphStartedP = new Promise((r) => { ralphStarted = r; });
  let releaseRalph = null;
  const ralphGate = new Promise((r) => { releaseRalph = r; });
  const abortCtrlRalph = new AbortController();
  let ralphCallCount = 0;
  sandbox.QuizProviders.extensionFetch = async () => {
    ralphCallCount++;
    if (ralphCallCount <= 2) {
      // Fast Path (1) + Agent Chunk (2) solve Q1 only -> forces Ralph retry for missing Q2!
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index><confidence>90</confidence></answer></quiz_answers>' } }] })
      };
    }
    ralphCalls++;
    ralphStarted();
    await ralphGate;
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  };
  const ralphPromise = agentApi.solve({
    questions: [
      { index: 1, text: 'Q1?', type: 'radio', questionType: 'single_choice', options: [{ index: 0, text: 'A' }] },
      { index: 2, text: 'Q2?', type: 'radio', questionType: 'single_choice', options: [{ index: 0, text: 'B' }] }
    ],
    config: {
      syncConfig: { enabled: true, maxChunkQuestions: 10 },
      apiKeys: { groqApiKey: 'gsk_1', geminiApiKey: 'AIza1' },
      settings: { selectedProvider: 'groq' }
    }
  }, { signal: abortCtrlRalph.signal });
  await withTimeout(ralphStartedP, 1500, 'ralphStartedP');
  abortCtrlRalph.abort();
  releaseRalph();
  const ralphRes = await ralphPromise;
  assert.equal(ralphRes.cancelled, true);
  assert.equal(ralphCalls, 1, 'Aborted Ralph retry must not advance to secondary provider');

  // 6. Pass 4 Finding 2: toggleExtension disable triggers sidePanelPanicClear in < 50ms even with an unresponsive HTTP tab
  let commandCb = null;
  const disableEvents = [];
  const slowSandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    URL, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
    encodeURIComponent, decodeURIComponent, parseInt, isNaN, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout, clearTimeout, AbortController, AbortSignal,
    module: { exports: {} },
    globalThis: null,
    fetch: async () => ({ ok: true, status: 200, text: async () => '' }),
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
        onConnect: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
        sendMessage: (msg, cb) => {
          disableEvents.push({ action: msg.action, at: Date.now() });
          if (cb) cb({ ok: true });
        },
        lastError: null
      },
      tabs: {
        onRemoved: { addListener: () => {} },
        query: async () => [{ id: 99, url: 'https://slow-tab.example.com' }],
        sendMessage: () => {} // never invokes callback or returns a Promise!
      },
      notifications: { create: () => {} },
      commands: { onCommand: { addListener: (fn) => { commandCb = fn; } } },
      contextMenus: { onClicked: { addListener: () => {} } },
      storage: {
        sync: { get: async () => ({ enabled: true }), set: async () => {} },
        local: { get: async () => ({}), set: async () => {} },
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} }
      }
    }
  };
  slowSandbox.globalThis = slowSandbox;
  vm.runInNewContext(read('background.js'), slowSandbox);
  const tDisable0 = Date.now();
  const disablePromise = commandCb('toggle-extension');
  await new Promise((r) => setTimeout(r, 15));
  const panicBroadcast = disableEvents.find((e) => e.action === 'sidePanelPanicClear');
  assert.ok(panicBroadcast, 'toggleExtension disable must broadcast sidePanelPanicClear immediately');
  assert.ok(panicBroadcast.at - tDisable0 < 50, `Panic broadcast took ${panicBroadcast.at - tDisable0}ms (must be < 50ms)`);
  await disablePromise;
});

test('F-UX-01 Re-audit Pass 5 Regression: mid-batch zeroTrace toggle preserves Side Panel sync, skipSidePanelClear stops multi-tab boomerang, and cold-tab analyze aborts if Panic/disable fires during injectCoreScripts', { timeout: 8000 }, async () => {
  // 1. Mid-batch zeroTraceMode toggle while HighlightManager.applyHighlights returns 'CANCELLED' still syncs Side Panel
  const cEnv = createDomEnv();
  let liveZeroTrace = false;
  let clearAllCalls = 0;
  let applyCancelledByZeroTrace = null;
  let configOnChangeCb = null;
  let msgListener = null;
  let portHandler = null;
  const savedStates = [];
  const runtimeCleared = [];
  const questions18 = Array.from({ length: 18 }, (_, i) => ({
    index: i + 1,
    element: new cEnv.El('DIV'),
    text: `Question ${i + 1}?`,
    type: 'radio',
    questionType: 'single_choice',
    options: [{ index: 0, element: new cEnv.El('INPUT'), labelElement: new cEnv.El('LABEL'), text: `Opt ${i + 1}` }]
  }));

  const cSandbox = {
    window: null,
    globalThis: null,
    document: cEnv.doc,
    location: { hostname: 'quiz.example.edu', href: 'https://quiz.example.edu/q' },
    console: { log: () => {}, warn: () => {}, error: () => {}, group: () => {}, groupEnd: () => {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise, Error,
    parseInt, parseFloat, isNaN, setTimeout, clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    ConfigCache: {
      isInitialized: () => true,
      getAll: () => ({ enabled: true }),
      get: () => false,
      onChange: (fn) => { configOnChangeCb = fn; }
    },
    SchemaCache: { getCachedSchema: async () => null },
    SchemaDetector: { hasInteractiveContent: () => false },
    chrome: {
      storage: {
        sync: { get: async () => ({ enabled: true }) },
        local: { get: async () => ({ zeroTraceMode: liveZeroTrace }) },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        onMessage: { addListener: (fn) => { msgListener = fn; } },
        sendMessage: (msg, cb) => {
          if (msg.action === 'saveSidePanelState') savedStates.push(msg.state);
          if (msg.action === 'clearSidePanelState') runtimeCleared.push(msg.reason);
          if (cb) cb({ success: true });
          return Promise.resolve({ success: true });
        },
        connect: () => ({
          onMessage: { addListener: (fn) => { portHandler = fn; } },
          onDisconnect: { addListener: () => {} },
          disconnect: () => {},
          postMessage: () => {
            queueMicrotask(() => {
              portHandler({
                success: true,
                answers: questions18.map((_, idx) => ({ questionIndex: idx, optionIndices: [0], confidence: 90 })),
                metadata: { questionsTotal: 18, answersFound: 18, provider: 'groq', model: 'm1', totalDurationMs: 25 }
              });
            });
          }
        })
      }
    },
    SafeExm: {
      DOMExtractor: {
        QUIZ_SELECTORS: { quizContainer: ['.quiz'] },
        isElementVisible: () => true,
        extractQuizData: async () => ({ questions: questions18, totalImages: 0 })
      },
      HighlightManager: {
        applyHighlights: async () => {
          await new Promise((r) => { applyCancelledByZeroTrace = r; });
          return 'CANCELLED';
        },
        clearAllHighlights: () => {
          clearAllCalls++;
          if (applyCancelledByZeroTrace) applyCancelledByZeroTrace();
        },
        isElementConnected: () => true
      }
    },
    module: { exports: {} }
  };
  cSandbox.window = cSandbox;
  cSandbox.globalThis = cSandbox;
  vm.runInNewContext(read('content.js'), cSandbox);

  const analyzePromise = cSandbox.SafeExm.Content.handleAnalyzeQuiz({ enabled: true, zeroTraceMode: false });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(typeof applyCancelledByZeroTrace, 'function');
  liveZeroTrace = true;
  msgListener({ action: 'clearHighlights', preserveSidePanel: true }, {}, () => {});
  const analyzeRes = await analyzePromise;
  assert.equal(analyzeRes.success, true);
  assert.equal(analyzeRes.data.zeroTraceMode, true);
  assert.equal(savedStates.length, 1);
  assert.equal(savedStates[0].items.length, 18);
  assert.ok(clearAllCalls >= 1);

  // 2. Global skipSidePanelClear & ConfigCache.onChange disable do NOT boomerang clearSidePanelState
  runtimeCleared.length = 0;
  msgListener({ action: 'clearHighlights', skipSidePanelClear: true }, {}, () => {});
  msgListener({ action: 'toggleExtension', enabled: false, skipSidePanelClear: true }, {}, () => {});
  if (configOnChangeCb) configOnChangeCb({ enabled: { oldValue: true, newValue: false } });
  assert.equal(runtimeCleared.length, 0, 'Global clear/disable must never boomerang clearSidePanelState');

  // 3. Multi-tab delayed clearHighlights + cold-tab Ctrl+Shift+2 injectCoreScripts Panic abort
  let cmdCb = null;
  let releaseSlowTab = null;
  let releaseSlowInject = null;
  let syncEnabled = true;
  const panicBroadcasts = [];
  const coldTabMessages = [];
  const notifications = [];

  const bgSandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    URL, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
    encodeURIComponent, decodeURIComponent, parseInt, isNaN, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout, clearTimeout, AbortController, AbortSignal,
    module: { exports: {} },
    globalThis: null,
    fetch: async () => ({ ok: true, status: 200, text: async () => '' }),
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
        onConnect: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
        sendMessage: (msg, cb) => {
          if (msg.action === 'sidePanelPanicClear') panicBroadcasts.push(msg);
          if (cb) cb({ ok: true });
        },
        lastError: null
      },
      scripting: {
        executeScript: async ({ target, func }) => {
          if (func) return [{ result: false }];
          if (target.tabId === 88) {
            await new Promise((r) => { releaseSlowInject = r; });
          }
          return [{ result: true }];
        }
      },
      tabs: {
        onRemoved: { addListener: () => {} },
        query: async (q) => (q && q.active
          ? [{ id: 88, active: true, url: 'https://cold-quiz.example.com' }]
          : [{ id: 1, url: 'https://slow-tab.example.com' }, { id: 88, url: 'https://cold-quiz.example.com' }]),
        sendMessage: (tabId, payload, cb) => {
          if (tabId === 1 && payload.action === 'clearHighlights') {
            releaseSlowTab = () => {
              // Simulate delayed Tab 1 content.js receiving { skipSidePanelClear: true }
              msgListener(payload, {}, () => {});
              if (cb) cb({ success: true });
            };
            return;
          }
          coldTabMessages.push({ tabId, payload });
          if (cb) cb({ success: true });
        }
      },
      notifications: { create: (opts) => notifications.push(opts) },
      commands: { onCommand: { addListener: (fn) => { cmdCb = fn; } } },
      contextMenus: { onClicked: { addListener: () => {} } },
      storage: {
        onChanged: { addListener: () => {} },
        sync: { get: async () => ({ enabled: syncEnabled }), set: async () => {} },
        local: { get: async () => ({}), set: async () => {} },
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} }
      }
    }
  };
  bgSandbox.globalThis = bgSandbox;
  vm.runInNewContext(read('background.js'), bgSandbox);

  // Start cold-tab Ctrl+Shift+2; while executeScript is in-flight, fire Ctrl+Shift+E!
  coldTabMessages.length = 0;
  const analyzeCmdPromise = cmdCb('analyze-quiz');
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(typeof releaseSlowInject, 'function');
  const panicCmdPromise = cmdCb('clear-highlights');
  await new Promise((r) => setTimeout(r, 15));
  releaseSlowInject();
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (releaseSlowInject) releaseSlowInject();
  }
  await analyzeCmdPromise;
  if (releaseSlowTab) releaseSlowTab();
  await panicCmdPromise;

  assert.equal(coldTabMessages.some((m) => m.tabId === 88 && m.payload.action === 'analyzeQuiz'), false, 'Panic during injectCoreScripts must abort analyzeQuiz dispatch');
  assert.equal(panicBroadcasts.length, 1, 'Delayed Tab 1 must NOT trigger duplicate sidePanelPanicClear broadcasts');
  assert.equal(notifications.some((n) => n.message && n.message.includes('Impossible de trouver l\'onglet actif')), false, 'Aborted cold-tab analyze must not show missing-tab error');
});

test('F-UX-01 Re-audit Pass 6 Regression: late zeroTrace blocks auto-submit (NEEDS_HEAL & saveSidePanelState), pre-Panic 10% progress suppressed, _panicClearEpoch ignores saves & aborts retry sleep, boolean attrs & agent URLs sanitized', { timeout: 8000 }, async () => {
  // 1. Late zeroTraceMode enabled during NEEDS_HEAL and during saveSidePanelState skips auto-submit
  const cEnv = createDomEnv();
  const radioEl = new cEnv.El('INPUT');
  const submitBtn = new cEnv.El('BUTTON');
  submitBtn.setAttribute('type', 'submit');
  submitBtn.textContent = 'Valider';
  const formEl = new cEnv.El('FORM');
  formEl.appendChild(radioEl);
  formEl.appendChild(submitBtn);
  cEnv.doc.body.appendChild(formEl);

  let liveZt = false;
  let releaseSaveState = null;
  let clearHighlightsCount = 0;
  let portCb = null;

  const cSandbox = {
    window: null,
    globalThis: null,
    document: cEnv.doc,
    location: { hostname: 'q.example.edu', href: 'https://q.example.edu/exam' },
    console: { log: () => {}, warn: () => {}, error: () => {}, group: () => {}, groupEnd: () => {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise, Error,
    parseInt, parseFloat, isNaN, setTimeout, clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    ConfigCache: { isInitialized: () => true, getAll: () => ({ enabled: true, autoSubmitEnabled: true, autoSubmitMinConfidence: 80, autoSubmitDelayMs: 30 }), get: () => false },
    SchemaCache: { getCachedSchema: async () => null },
    SchemaDetector: { hasInteractiveContent: () => false },
    chrome: {
      storage: {
        sync: { get: async () => ({ enabled: true, autoSubmitEnabled: true, autoSubmitMinConfidence: 80, autoSubmitDelayMs: 30 }) },
        local: { get: async () => ({ zeroTraceMode: liveZt }) },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: (msg, cb) => {
          if (msg.action === 'saveSidePanelState') {
            releaseSaveState = () => cb && cb({ success: true });
            return;
          }
          if (cb) cb({ success: true });
        },
        connect: () => ({
          onMessage: { addListener: (fn) => { portCb = fn; } },
          onDisconnect: { addListener: () => {} },
          disconnect: () => {},
          postMessage: () => {
            queueMicrotask(() => {
              portCb({
                success: true,
                answers: [{ questionIndex: 0, optionIndices: [0], confidence: 95 }],
                metadata: { questionsTotal: 1, answersFound: 1, provider: 'groq', model: 'm1', totalDurationMs: 10 }
              });
            });
          }
        })
      }
    },
    SafeExm: {
      DOMExtractor: {
        QUIZ_SELECTORS: { quizContainer: ['.quiz'] },
        isElementVisible: () => true,
        extractQuizData: async () => ({
          questions: [{
            index: 1, element: formEl, text: 'Q?', type: 'radio', questionType: 'single_choice',
            options: [{ index: 0, element: radioEl, labelElement: radioEl, text: 'A' }]
          }],
          totalImages: 0
        })
      },
      HighlightManager: {
        applyHighlights: async () => 'NEEDS_HEAL',
        clearAllHighlights: () => { clearHighlightsCount++; },
        isElementConnected: () => true
      }
    },
    module: { exports: {} }
  };
  cSandbox.window = cSandbox;
  cSandbox.globalThis = cSandbox;
  vm.runInNewContext(read('content.js'), cSandbox);

  const runP = cSandbox.SafeExm.Content.handleAnalyzeQuiz({
    enabled: true, zeroTraceMode: false, autoSubmitEnabled: true, autoSubmitMinConfidence: 80, autoSubmitDelayMs: 30
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(typeof releaseSaveState, 'function');
  liveZt = true; // Toggled during saveSidePanelState!
  releaseSaveState();
  const ztRes = await runP;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(ztRes.success, true);
  assert.equal(ztRes.data.zeroTraceMode, true);
  assert.equal(ztRes.data.autoSubmitScheduled, false);
  assert.equal(radioEl.checked, false);
  assert.equal(submitBtn.clickedCount || 0, 0);

  // 2. Post-Panic <= 10% analysisProgress does NOT reopen progress bar in Side Panel or Popup
  const spEnv = createDomEnv();
  for (const id of [
    'sidePanelThemeBtn', 'sidePanelAnalyzeBtn', 'sidePanelClearBtn', 'zeroTraceToggle',
    'sidePanelProgressSection', 'sidePanelProgress', 'sidePanelProgressText',
    'sidePanelProgressPercentage', 'sidePanelAnnouncer', 'sidePanelMeta',
    'sidePanelEmpty', 'sidePanelResults'
  ]) {
    const tag = id === 'sidePanelProgress' ? 'PROGRESS' : (id === 'zeroTraceToggle' ? 'INPUT' : 'DIV');
    const el = new spEnv.El(tag);
    el.id = id;
    if (id === 'sidePanelProgressSection' || id === 'sidePanelResults') el.hidden = true;
    spEnv.doc.body.appendChild(el);
  }
  let spRuntime = null;
  let resolveSpAnalyze = null;
  const spSandbox = {
    document: spEnv.doc, window: null, globalThis: null,
    console, setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error, WeakMap,
    requestAnimationFrame: (cb) => cb(),
    navigator: { clipboard: { writeText: async () => {} } },
    chrome: {
      tabs: {
        query: async () => [{ id: 1, url: 'https://q.test' }],
        sendMessage: (_id, msg, cb) => {
          if (msg.action === 'analyzeQuiz') resolveSpAnalyze = (r) => cb && cb(r);
          else if (cb) cb({ success: true });
        }
      },
      runtime: { onMessage: { addListener: (fn) => { spRuntime = fn; } }, sendMessage: (_m, cb) => cb && cb({ success: true }) },
      storage: { sync: { get: async () => ({ enabled: true }) }, local: { get: async () => ({ zeroTraceMode: false }), set: async () => {} }, onChanged: { addListener: () => {} } }
    },
    module: { exports: {} }
  };
  spSandbox.window = spSandbox;
  spSandbox.globalThis = spSandbox;
  vm.runInNewContext(read('sidepanel.js'), spSandbox);
  for (const fn of spEnv.doc._listeners.DOMContentLoaded || []) await fn();

  const spAnaP = spSandbox.SafeExmSidePanel.analyzeFromSidePanel();
  await new Promise((r) => setTimeout(r, 15));
  const prePanicAt = Date.now() - 50;
  spRuntime({ action: 'sidePanelPanicClear', reason: 'panic', clearedAt: Date.now() });
  spRuntime({ action: 'analysisProgress', step: 'Lecture du quiz…', percent: 10, startedAt: prePanicAt });
  spRuntime({ action: 'analysisProgress', step: 'Repérage de la page…', percent: 12, startedAt: prePanicAt });
  assert.equal(spEnv.doc.getElementById('sidePanelProgressSection').hidden, true);
  resolveSpAnalyze({ success: false, cancelled: true, error: 'Analyse annulée' });
  await spAnaP;
  assert.equal(spEnv.doc.getElementById('sidePanelProgressSection').hidden, true);

  // 3. background.js: Tab 1 Side Panel save does not abort Tab 2 injection, while Panic during 50ms retry sleep aborts Tab 2
  let cmdCb = null;
  let releaseInject = null;
  let analyzeDispatches = 0;
  let sendAttempt = 0;
  const bgSandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    URL, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
    encodeURIComponent, decodeURIComponent, parseInt, isNaN, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout, clearTimeout, AbortController, AbortSignal,
    module: { exports: {} },
    globalThis: null,
    fetch: async () => ({ ok: true, status: 200, text: async () => '' }),
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
        onConnect: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
        sendMessage: (_m, cb) => cb && cb({ ok: true }),
        lastError: null
      },
      scripting: {
        executeScript: async ({ target, func }) => {
          if (func) return [{ result: false }];
          if (target.tabId === 2) {
            await new Promise((r) => { releaseInject = r; });
          }
          return [{ result: true }];
        }
      },
      tabs: {
        onRemoved: { addListener: () => {} },
        query: async () => [{ id: 2, active: true, url: 'https://cold2.example.com' }],
        sendMessage: (tabId, payload, cb) => {
          if (tabId === 2 && payload.action === 'analyzeQuiz') {
            analyzeDispatches++;
            sendAttempt++;
            if (sendAttempt === 1) {
              bgSandbox.chrome.runtime.lastError = { message: 'Receiving end does not exist.' };
              if (cb) cb(undefined);
              bgSandbox.chrome.runtime.lastError = null;
              return;
            }
          }
          if (cb) cb({ success: true });
        }
      },
      notifications: { create: () => {} },
      commands: { onCommand: { addListener: (fn) => { cmdCb = fn; } } },
      contextMenus: { onClicked: { addListener: () => {} } },
      storage: {
        onChanged: { addListener: () => {} },
        sync: { get: async () => ({ enabled: true }), set: async () => {} },
        local: { get: async () => ({}), set: async () => {} },
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} }
      }
    }
  };
  bgSandbox.globalThis = bgSandbox;
  vm.runInNewContext(read('background-agent.js'), bgSandbox);
  const agentApi = bgSandbox.module.exports.BackgroundAgent;
  bgSandbox.module = { exports: {} };
  vm.runInNewContext(read('background.js'), bgSandbox);
  const bg = bgSandbox.module.exports;

  // Case 3a: Tab 1 save during Tab 2 injectCoreScripts does NOT cancel Tab 2!
  const cmdP = cmdCb('analyze-quiz');
  await new Promise((r) => setTimeout(r, 15));
  await bg.handleSaveSidePanelState({ state: { hostname: 'tab1.test', items: [{ index: 0, text: 'T1', answerSummary: 'A', confidence: 90 }] } });
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (releaseInject) releaseInject();
  }
  await cmdP;
  assert.equal(analyzeDispatches, 2, 'Tab 1 save must not cancel Tab 2 injectCoreScripts');

  // Case 3b: Panic during 50ms retry sleep in sendMessageWithMissingReceiverRetry aborts second attempt
  analyzeDispatches = 0;
  sendAttempt = 0;
  releaseInject = null;
  const retryP = bg.handleAnalyzeQuizCommand();
  await new Promise((r) => setTimeout(r, 15));
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (releaseInject) releaseInject();
  }
  // Fire Panic right as attempt 1 failed with missing receiver and enters 50ms sleep
  await bg.handleClearSidePanelState('panic');
  await retryP;
  assert.equal(analyzeDispatches, 1, 'Panic during retry sleep must abort retry attempt 2');

  // 4. Boolean HTML attributes (<script async>, <div data-test>) stripped & URL secrets redacted in both cleaners
  const bgSan = bg.sanitizeSidePanelState({
    items: [{ index: 0, text: '<script async>alert(1)</script> <div data-test>hello</div> If x < 5 && y > 10', answerSummary: 'A', confidence: 90 }]
  });
  assert.equal(bgSan.items[0].text, 'alert(1) hello If x < 5 && y > 10');

  const agentSan = agentApi.normalizeAnswerEntry({
    questionIndex: 0,
    confidence: 88,
    explanation: '<script async>evil()</script> <div data-foo>Note</div> Check https://serpapi.com/search.json?q=test&api_key=SECRET123 and x < 5'
  });
  assert.equal(agentSan.explanation.includes('SECRET123'), false);
  assert.equal(agentSan.explanation.includes('***'), true);
  assert.equal(agentSan.explanation.includes('<script'), false);
  assert.equal(agentSan.explanation.includes('<div'), false);
  assert.equal(agentSan.explanation.includes('x < 5'), true);
});

test('F-UX-01 Re-audit Pass 7 Regression: external 100% progress auto-hides, empty Auto delta emits no 10% progress, and 0-question exit hides active progress', { timeout: 8000 }, async () => {
  // 1. Auto Mode empty delta emits ZERO analysisProgress; manual 0-question exit emits { hide: true }
  const cEnv = createDomEnv();
  const progressEvents = [];
  let questionsToReturn = [{
    index: 1, element: new cEnv.El('DIV'), text: 'Already solved?', type: 'radio', questionType: 'single_choice',
    options: [{ index: 0, element: new cEnv.El('INPUT'), labelElement: new cEnv.El('LABEL'), text: 'Yes' }]
  }];

  const cSandbox = {
    window: null, globalThis: null, document: cEnv.doc,
    location: { hostname: 'q.example.edu', href: 'https://q.example.edu/q' },
    console: { log: () => {}, warn: () => {}, error: () => {}, group: () => {}, groupEnd: () => {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise, Error,
    parseInt, parseFloat, isNaN, setTimeout, clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    ConfigCache: { isInitialized: () => true, getAll: () => ({ enabled: true }), get: () => true },
    SchemaCache: { getCachedSchema: async () => null },
    SchemaDetector: { hasInteractiveContent: () => false },
    chrome: {
      storage: { sync: { get: async () => ({ enabled: true }) }, local: { get: async () => ({ zeroTraceMode: true }) } },
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: (msg, cb) => {
          if (msg.action === 'analysisProgress') progressEvents.push(msg);
          if (cb) cb({ success: true });
          return Promise.resolve({ success: true });
        },
        connect: () => ({ onMessage: { addListener: () => {} }, onDisconnect: { addListener: () => {} }, disconnect: () => {}, postMessage: () => {} })
      }
    },
    SafeExm: {
      DOMExtractor: { QUIZ_SELECTORS: { quizContainer: ['.quiz'] }, isElementVisible: () => true, extractQuizData: async () => ({ questions: questionsToReturn, totalImages: 0 }) },
      HighlightManager: { applyHighlights: async () => 'OK', clearAllHighlights: () => {}, isElementConnected: () => true }
    },
    module: { exports: {} }
  };
  cSandbox.window = cSandbox;
  cSandbox.globalThis = cSandbox;
  vm.runInNewContext(read('content.js'), cSandbox);
  cSandbox.SafeExm.Content.getAnalyzedQuestionTexts().add('Already solved?');

  const emptyDeltaRes = await cSandbox.SafeExm.Content.handleAnalyzeQuiz({ enabled: true }, true, true);
  assert.equal(emptyDeltaRes.data.questionsFound, 0);
  assert.equal(progressEvents.length, 0, 'Empty Auto delta must emit 0 analysisProgress events');

  questionsToReturn = [];
  progressEvents.length = 0;
  const zeroQRes = await cSandbox.SafeExm.Content.handleAnalyzeQuiz({ enabled: true }, false, false);
  assert.equal(zeroQRes.success, false);
  assert.equal(progressEvents[0].percent, 10);
  assert.equal(progressEvents[progressEvents.length - 1].hide, true, '0-question failure after 10% progress must emit hide: true');

  // 2. External 100% analysisProgress auto-hides #sidePanelProgressSection and { hide: true } hides it immediately
  const spEnv = createDomEnv();
  for (const id of [
    'sidePanelThemeBtn', 'sidePanelAnalyzeBtn', 'sidePanelClearBtn', 'zeroTraceToggle',
    'sidePanelProgressSection', 'sidePanelProgress', 'sidePanelProgressText',
    'sidePanelProgressPercentage', 'sidePanelAnnouncer', 'sidePanelMeta',
    'sidePanelEmpty', 'sidePanelResults'
  ]) {
    const tag = id === 'sidePanelProgress' ? 'PROGRESS' : (id === 'zeroTraceToggle' ? 'INPUT' : 'DIV');
    const el = new spEnv.El(tag);
    el.id = id;
    if (id === 'sidePanelProgressSection' || id === 'sidePanelResults') el.hidden = true;
    spEnv.doc.body.appendChild(el);
  }
  let spRuntime = null;
  let scheduledHideCb = null;
  const spSandbox = {
    document: spEnv.doc, window: null, globalThis: null, console,
    setTimeout: (fn, delay) => {
      if (delay >= 2000) scheduledHideCb = fn;
      return 123;
    },
    clearTimeout: () => {},
    Promise, Array, Object, Number, Boolean, String, Math, Date, Error, WeakMap,
    requestAnimationFrame: (cb) => cb(),
    navigator: { clipboard: { writeText: async () => {} } },
    chrome: {
      runtime: { onMessage: { addListener: (fn) => { spRuntime = fn; } }, sendMessage: (_m, cb) => cb && cb({ success: true }) },
      storage: { local: { get: async () => ({ zeroTraceMode: false }), set: async () => {} }, onChanged: { addListener: () => {} } }
    },
    module: { exports: {} }
  };
  spSandbox.window = spSandbox;
  spSandbox.globalThis = spSandbox;
  vm.runInNewContext(read('sidepanel.js'), spSandbox);
  for (const fn of spEnv.doc._listeners.DOMContentLoaded || []) await fn();

  spRuntime({ action: 'analysisProgress', step: 'Lecture du quiz…', percent: 10 });
  assert.equal(spEnv.doc.getElementById('sidePanelProgressSection').hidden, false);
  spRuntime({ action: 'analysisProgress', hide: true });
  assert.equal(spEnv.doc.getElementById('sidePanelProgressSection').hidden, true);

  spRuntime({ action: 'analysisProgress', step: 'Terminé.', percent: 100 });
  assert.equal(spEnv.doc.getElementById('sidePanelProgressSection').hidden, false);
  assert.equal(typeof scheduledHideCb, 'function', 'External 100% progress must schedule auto-hide timer');
  scheduledHideCb();
  assert.equal(spEnv.doc.getElementById('sidePanelProgressSection').hidden, true);

  // 3. analyzeFromSidePanel() clears any prior _progressHideTimer from showProgress(summary, 100) before setting final timer
  const activeTimers = new Set();
  let nextTimerId = 1;
  const spEnv2 = createDomEnv();
  for (const id of [
    'sidePanelThemeBtn', 'sidePanelAnalyzeBtn', 'sidePanelClearBtn', 'zeroTraceToggle',
    'sidePanelProgressSection', 'sidePanelProgress', 'sidePanelProgressText',
    'sidePanelProgressPercentage', 'sidePanelAnnouncer', 'sidePanelMeta',
    'sidePanelEmpty', 'sidePanelResults'
  ]) {
    const tag = id === 'sidePanelProgress' ? 'PROGRESS' : (id === 'zeroTraceToggle' ? 'INPUT' : 'DIV');
    const el = new spEnv2.El(tag);
    el.id = id;
    spEnv2.doc.body.appendChild(el);
  }
  const spSandbox2 = {
    document: spEnv2.doc, window: null, globalThis: null, console,
    setTimeout: (_fn, _ms) => {
      const id = nextTimerId++;
      activeTimers.add(id);
      return id;
    },
    clearTimeout: (id) => { activeTimers.delete(id); },
    Promise, Array, Object, Number, Boolean, String, Math, Date, Error, WeakMap,
    requestAnimationFrame: (cb) => cb(),
    navigator: { clipboard: { writeText: async () => {} } },
    chrome: {
      tabs: { query: async () => [{ id: 1, url: 'https://q.test' }], sendMessage: (_id, _m, cb) => cb && cb({ success: true, data: { questionsFound: 1, answersHighlighted: 1 } }) },
      runtime: { onMessage: { addListener: () => {} }, sendMessage: (_m, cb) => cb && cb({ success: true, state: null }) },
      storage: { sync: { get: async () => ({ enabled: true }) }, local: { get: async () => ({ zeroTraceMode: false }), set: async () => {} }, onChanged: { addListener: () => {} } }
    },
    module: { exports: {} }
  };
  spSandbox2.window = spSandbox2;
  spSandbox2.globalThis = spSandbox2;
  vm.runInNewContext(read('sidepanel.js'), spSandbox2);
  await spSandbox2.SafeExmSidePanel.analyzeFromSidePanel();
  assert.equal(activeTimers.size, 1, 'Only 1 active hide timer may remain after analyzeFromSidePanel completes');
  spSandbox2.SafeExmSidePanel.showProgress('Second run', 10);
  assert.equal(activeTimers.size, 0, 'Starting a second run must clear the sole active hide timer with 0 orphans');
});

test('F-UX-01 Re-audit Pass 9 Regression: BackgroundAgent uses x-goog-api-key header and failure paths redact API keys/URLs end-to-end without over-redacting provider names', { timeout: 8000 }, async () => {
  const geminiKey = ['AIza', 'SyEXPOSED_SECRET_999'].join('');
  const customCfgSecret = 'CUSTOM_CFG_KEY_777';
  const swLogs = [];
  const pageLogs = [];
  let capturedFetch = null;
  let onConnectHandler = null;
  const recordSwLog = (...args) => swLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  const recordPageLog = (...args) => pageLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));

  const geminiDef = {
    id: 'gemini',
    name: 'Gemini',
    apiKeyField: 'geminiApiKey',
    type: 'gemini',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    textModels: [{ id: 'gemini-2.5-flash' }],
    visionModels: [{ id: 'gemini-2.5-flash' }]
  };

  const swSandbox = {
    console: { log: recordSwLog, warn: recordSwLog, error: recordSwLog, group: recordSwLog, groupEnd: () => {} },
    URL, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout, clearTimeout, AbortController, AbortSignal,
    fetch: async () => ({ ok: true, status: 200, text: async () => 'System prompt {{domain_rules}}' }),
    ConfigCache: {
      init: async () => {},
      isInitialized: () => true,
      getAll: () => ({ enabled: true, selectedProvider: 'gemini', geminiApiKey: geminiKey, serpApiKey: customCfgSecret }),
      get: (k) => (k === 'geminiApiKey' ? geminiKey : (k === 'serpApiKey' ? customCfgSecret : undefined)),
      onChange: () => {}
    },
    QuizProviders: {
      PROVIDERS: { gemini: geminiDef },
      DEFAULT_PRIORITY: ['gemini'],
      ProviderAnalytics: { record: () => {}, flush: async () => {}, getStats: () => ({ totals: { requests: 0 } }) },
      getProvider: (k) => (String(k).toLowerCase() === 'gemini' ? geminiDef : null),
      getProviderType: () => 'gemini',
      getAllStorageKeys: () => ['geminiApiKey', 'serpApiKey', 'providerConfigs'],
      getAllApiKeyFields: () => ['geminiApiKey'],
      isProviderConfigured: () => true,
      getFirstConfiguredProvider: () => 'gemini',
      getModelForContext: () => 'gemini-2.5-flash',
      getModelContextLimit: () => 128000,
      getConfiguredProviders: () => ['gemini'],
      smartRoute: () => 'gemini',
      callProvider: async () => ({ text: '', model: 'gemini-2.5-flash' }),
      extensionFetch: async (url, init) => {
        capturedFetch = { url, headers: init && init.headers ? { ...init.headers } : {} };
        throw new TypeError(`Failed to fetch ${url}?key=${geminiKey}&sig=${customCfgSecret} Bearer ${customCfgSecret}`);
      }
    },
    chrome: {
      runtime: {
        getURL: (p) => `chrome-extension://test-id/${p}`,
        onMessage: { addListener: () => {} },
        onConnect: { addListener: (fn) => { onConnectHandler = fn; } },
        onInstalled: { addListener: () => {} },
        sendMessage: (_msg, cb) => {
          if (cb) cb({ ok: true });
          return Promise.resolve({ ok: true });
        },
        lastError: null
      },
      tabs: { onRemoved: { addListener: () => {} }, query: async () => [], sendMessage: (_id, _p, cb) => cb && cb({ success: true }) },
      notifications: { create: () => {} },
      commands: { onCommand: { addListener: () => {} } },
      contextMenus: { onClicked: { addListener: () => {} } },
      storage: {
        sync: { get: async () => ({ enabled: true, selectedProvider: 'gemini' }), set: async () => {} },
        local: { get: async () => ({ geminiApiKey: geminiKey, serpApiKey: customCfgSecret, providerConfigs: { gemini: { apiKey: geminiKey } } }), set: async () => {} },
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} }
      }
    },
    module: { exports: {} },
    globalThis: null
  };
  swSandbox.globalThis = swSandbox;
  swSandbox.self = swSandbox;
  vm.runInNewContext(read('background-agent.js'), swSandbox);
  swSandbox.BackgroundAgent = swSandbox.module.exports.BackgroundAgent;
  swSandbox.module = { exports: {} };
  vm.runInNewContext(read('background.js'), swSandbox);

  assert.equal(typeof onConnectHandler, 'function');

  const cEnv = createDomEnv();
  const questionEl = new cEnv.El('DIV');
  const q1 = {
    index: 1,
    element: questionEl,
    text: 'Capital of France?',
    type: 'radio',
    questionType: 'single_choice',
    options: [{ index: 0, element: new cEnv.El('INPUT'), labelElement: new cEnv.El('LABEL'), text: 'Paris' }]
  };

  const cSandbox = {
    window: null,
    globalThis: null,
    document: cEnv.doc,
    location: { hostname: 'quiz.example.edu', href: 'https://quiz.example.edu/q' },
    console: { log: recordPageLog, warn: recordPageLog, error: recordPageLog, group: recordPageLog, groupEnd: () => {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise, Error, URL,
    parseInt, parseFloat, isNaN, setTimeout, clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    ConfigCache: {
      isInitialized: () => true,
      getAll: () => ({ enabled: true, selectedProvider: 'gemini', geminiApiKey: geminiKey, serpApiKey: customCfgSecret }),
      get: () => false,
      onChange: () => {}
    },
    SchemaCache: { getCachedSchema: async () => null },
    SchemaDetector: { hasInteractiveContent: () => false },
    chrome: {
      storage: {
        sync: { get: async () => ({ enabled: true, selectedProvider: 'gemini' }) },
        local: { get: async () => ({ zeroTraceMode: false }) },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: (_msg, cb) => {
          if (cb) cb({ success: true });
          return Promise.resolve({ success: true });
        },
        connect: (opts) => {
          let clientMsgCb = null;
          let swMsgCb = null;
          const swPort = {
            name: opts && opts.name,
            onMessage: { addListener: (fn) => { swMsgCb = fn; } },
            onDisconnect: { addListener: () => {} },
            postMessage: (msg) => { if (clientMsgCb) queueMicrotask(() => clientMsgCb(msg)); }
          };
          onConnectHandler(swPort);
          return {
            onMessage: { addListener: (fn) => { clientMsgCb = fn; } },
            onDisconnect: { addListener: () => {} },
            disconnect: () => {},
            postMessage: (msg) => { if (swMsgCb) queueMicrotask(() => swMsgCb(msg)); }
          };
        }
      }
    },
    SafeExm: {
      DOMExtractor: {
        QUIZ_SELECTORS: { quizContainer: ['.quiz'] },
        isElementVisible: () => true,
        extractQuizData: async () => ({ questions: [q1], totalImages: 0 })
      },
      HighlightManager: {
        applyHighlights: async () => 0,
        clearAllHighlights: () => {},
        isElementConnected: () => true
      }
    },
    module: { exports: {} }
  };
  cSandbox.window = cSandbox;
  cSandbox.globalThis = cSandbox;
  vm.runInNewContext(read('content.js'), cSandbox);

  const contentRes = await cSandbox.SafeExm.Content.handleAnalyzeQuiz({
    enabled: true,
    selectedProvider: 'gemini',
    geminiApiKey: geminiKey,
    serpApiKey: customCfgSecret
  });

  assert.ok(capturedFetch, `_callGeminiWithTools must invoke extensionFetch; res=${JSON.stringify(contentRes)}; swLogs=${JSON.stringify(swLogs.slice(-8))}`);
  assert.equal(capturedFetch.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  assert.equal(capturedFetch.url.includes('?key='), false, 'Must not place Gemini API key in URL query string');
  assert.equal(capturedFetch.headers['x-goog-api-key'], geminiKey);

  assert.equal(contentRes.success, false);
  assert.ok(contentRes.error.includes('gemini-2.5-flash'), 'Non-secret provider/model name must remain readable');
  for (const leak of [geminiKey, customCfgSecret, 'AIza']) {
    assert.equal(contentRes.error.includes(leak), false, `contentRes.error must not leak ${leak}`);
    assert.equal(swLogs.join('\n').includes(leak), false, `SW logs must not leak ${leak}`);
    assert.equal(pageLogs.join('\n').includes(leak), false, `Page console must not leak ${leak}`);
  }
});

test('F-UX-01 Re-audit Pass 10 Regression: providers.js uses x-goog-api-key & sanitizes errors, content.js ACKs toggleAutoMode, and UI analyzeBtn resets on Panic + respects uiSeq', { timeout: 8000 }, async () => {
  // 1. providers.js (smartRoute + ModelRegistry) & schema-detector.js: header auth + redacted logs/errors
  const geminiLeakKey = ['AIza', 'SyTEST_GEMINI_LEAK_12345'].join('');
  const bearerLeak = ['sk-', 'LEAKED_BEARER_98765'].join('');
  const pLogs = [];
  const pCalls = [];
  const logP = (...args) => pLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  const pSandbox = {
    console: { log: logP, warn: logP, error: logP },
    URL, TextDecoder, TextEncoder, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
    setTimeout, clearTimeout, AbortController, AbortSignal,
    fetch: async (url, init) => {
      const hdrs = init && init.headers ? { ...init.headers } : {};
      pCalls.push({ url: String(url), headers: hdrs });
      throw new TypeError(`request to ${url}?key=${geminiLeakKey} failed Bearer ${bearerLeak}`);
    },
    chrome: {
      storage: {
        local: { get: async () => ({}), set: async () => {} },
        sync: { get: async () => ({}), set: async () => {} },
        onChanged: { addListener: () => {} }
      }
    },
    module: { exports: {} },
    globalThis: null
  };
  pSandbox.globalThis = pSandbox;
  pSandbox.self = pSandbox;
  pSandbox.window = pSandbox;
  vm.runInNewContext(read('provider-catalog.js'), pSandbox);
  pSandbox.ProviderCatalog = pSandbox.module.exports;
  pSandbox.module = { exports: {} };
  vm.runInNewContext(read('providers.js'), pSandbox);

  await assert.rejects(
    () => pSandbox.QuizProviders.smartRoute(
      { system: 'sys', user: 'usr' },
      [],
      { geminiApiKey: geminiLeakKey },
      ['gemini'],
      {},
      { retry: { maxRetries: 0 } }
    ),
    (err) => {
      assert.equal(err.message.includes(geminiLeakKey), false, 'smartRoute error must not contain Gemini API key');
      assert.equal(err.message.includes(bearerLeak), false, 'smartRoute error must not contain Bearer secret');
      assert.equal(err.message.includes('AIza'), false);
      return true;
    }
  );
  assert.ok(pCalls.length >= 1, 'smartRoute must invoke fetch');
  for (const req of pCalls) {
    assert.equal(req.url.includes('?key='), false, `URL must not contain ?key=: ${req.url}`);
    assert.equal(req.headers['x-goog-api-key'], geminiLeakKey, 'Gemini generateContent must send x-goog-api-key header');
  }

  pCalls.length = 0;
  pLogs.length = 0;
  const modelsRes = await pSandbox.ModelRegistry.syncProviderModels('gemini', geminiLeakKey, null, { force: true });
  assert.equal(modelsRes, null);
  assert.ok(pCalls.length >= 1, 'ModelRegistry.syncProviderModels must invoke fetch');
  assert.equal(pCalls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100');
  assert.equal(pCalls[0].headers['x-goog-api-key'], geminiLeakKey);
  assert.equal(pLogs.join('\n').includes(geminiLeakKey), false, 'ModelRegistry logs must not leak Gemini key');
  assert.equal(pLogs.join('\n').includes('AIza'), false);

  const sdLogs = [];
  const logSd = (...args) => sdLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  const sdDom = createDomEnv();
  const qWrap = new sdDom.El('MAIN');
  qWrap.nodeType = 1;
  qWrap.attributes = [];
  const qH2 = new sdDom.El('H2');
  qH2.nodeType = 1;
  qH2.attributes = [];
  qH2.childNodes = [{ nodeType: 3, textContent: 'Which TLS port is used by HTTPS servers on the public web today?' }];
  const qOpt = new sdDom.El('INPUT');
  qOpt.nodeType = 1;
  qOpt.attributes = [{ name: 'type', value: 'radio' }];
  qOpt.childNodes = [];
  qWrap.appendChild(qH2);
  qWrap.appendChild(qOpt);
  qWrap.childNodes = [qH2, qOpt];
  sdDom.doc.title = 'Quiz Test';
  sdDom.doc.querySelectorAll = () => [];
  sdDom.doc.body.nodeType = 1;
  sdDom.doc.body.attributes = [];
  sdDom.doc.body.appendChild(qWrap);
  sdDom.doc.body.childNodes = [qWrap];

  const sdSandbox = {
    document: sdDom.doc,
    window: null,
    globalThis: null,
    location: { href: 'https://quiz.test/exam', hostname: 'quiz.test' },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    Set, Array, Object, String, Number, Boolean, Date, Math, JSON, RegExp, Error, Promise,
    console: { log: logSd, warn: logSd, error: logSd },
    chrome: {
      storage: {
        sync: { get: async () => ({ providerOrder: ['gemini'] }) },
        local: { get: async () => ({ geminiApiKey: geminiLeakKey }) }
      }
    },
    QuizProviders: {
      getAllStorageKeys: () => ['geminiApiKey', 'providerConfigs'],
      getAllApiKeyFields: () => ['geminiApiKey'],
      sanitizeErrorMessage: pSandbox.QuizProviders.sanitizeErrorMessage,
      smartRoute: async () => {
        throw new Error(`discover fail https://generativelanguage.googleapis.com/v1beta/models?key=${geminiLeakKey} Bearer ${bearerLeak}`);
      }
    },
    module: { exports: {} }
  };
  sdSandbox.window = sdSandbox;
  sdSandbox.globalThis = sdSandbox;
  vm.runInNewContext(read('schema-detector.js'), sdSandbox);
  const discovered = await sdSandbox.SchemaDetector.discoverSchema(true);
  assert.equal(discovered, null);
  assert.equal(sdLogs.join('\n').includes(geminiLeakKey), false, 'SchemaDetector error log must not leak Gemini key');
  assert.equal(sdLogs.join('\n').includes(bearerLeak), false, 'SchemaDetector error log must not leak Bearer token');
  assert.equal(sdLogs.join('\n').includes('AIza'), false);

  // 2. background.js toggleAutoMode -> content.js case 'toggleAutoMode' ACK with zero port-closed warnings
  const cEnv2 = createDomEnv();
  cEnv2.doc.body.tagName = 'BODY';
  let contentOnMessage = null;
  let observeCalls = 0;
  let disconnectCalls = 0;
  let autoModeSync = false;
  const swWarnings = [];

  const cSandbox2 = {
    window: null,
    globalThis: null,
    document: cEnv2.doc,
    location: { hostname: 'quiz.example.com', href: 'https://quiz.example.com/1' },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise, Error, URL,
    parseInt, parseFloat, isNaN, setTimeout, clearTimeout,
    MutationObserver: class {
      observe() { observeCalls += 1; }
      disconnect() { disconnectCalls += 1; }
    },
    IntersectionObserver: class { observe() {} disconnect() {} },
    ConfigCache: { isInitialized: () => true, getAll: () => ({ enabled: true, autoMode: autoModeSync }), get: (k) => (k === 'enabled' ? true : undefined), onChange: () => {} },
    SchemaCache: { getCachedSchema: async () => null },
    SchemaDetector: { hasInteractiveContent: () => false },
    chrome: {
      storage: { sync: { get: async () => ({ enabled: true, autoMode: autoModeSync }) }, local: { get: async () => ({}) }, onChanged: { addListener: () => {} } },
      runtime: { onMessage: { addListener: (fn) => { contentOnMessage = fn; } }, sendMessage: (_m, cb) => cb && cb({ success: true }) }
    },
    SafeExm: { HighlightManager: { clearAllHighlights: () => {}, isOwnUiMutation: () => false } },
    module: { exports: {} }
  };
  cSandbox2.window = cSandbox2;
  cSandbox2.globalThis = cSandbox2;
  vm.runInNewContext(read('content.js'), cSandbox2);

  let swCommandCb = null;
  const swAutoSandbox = {
    console: { log: () => {}, warn: (...a) => swWarnings.push(a.join(' ')), error: () => {} },
    URL, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
    encodeURIComponent, decodeURIComponent, parseInt, isNaN, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout, clearTimeout, AbortController, AbortSignal,
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
        onConnect: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
        sendMessage: (_m, cb) => cb && cb({ ok: true }),
        lastError: null
      },
      tabs: {
        onRemoved: { addListener: () => {} },
        query: async () => [{ id: 11, url: 'https://quiz.example.com/1' }],
        sendMessage: (_tabId, payload, cb) => {
          let responded = false;
          let ret = false;
          const sendResp = (res) => {
            responded = true;
            swAutoSandbox.chrome.runtime.lastError = null;
            if (cb) cb(res);
          };
          ret = contentOnMessage(payload, {}, sendResp);
          if (!responded && ret !== true) {
            swAutoSandbox.chrome.runtime.lastError = { message: 'The message port closed before a response was received.' };
            if (cb) cb(undefined);
            swAutoSandbox.chrome.runtime.lastError = null;
          }
        }
      },
      notifications: { create: () => {} },
      commands: { onCommand: { addListener: (fn) => { swCommandCb = fn; } } },
      contextMenus: { onClicked: { addListener: () => {} } },
      storage: {
        sync: {
          get: async () => ({ autoMode: autoModeSync, enabled: true }),
          set: async (obj) => { if (Object.prototype.hasOwnProperty.call(obj, 'autoMode')) autoModeSync = obj.autoMode; }
        },
        local: { get: async () => ({}), set: async () => {} },
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} }
      }
    },
    module: { exports: {} },
    globalThis: null
  };
  swAutoSandbox.globalThis = swAutoSandbox;
  vm.runInNewContext(read('background.js'), swAutoSandbox);

  await swCommandCb('toggle-auto-mode');
  await swCommandCb('toggle-auto-mode');
  assert.equal(swWarnings.length, 0, `Unexpected toggleAutoMode warnings: ${JSON.stringify(swWarnings)}`);
  assert.equal(observeCalls, 1, 'toggleAutoMode(true) must start Auto Mode observer');
  assert.equal(disconnectCalls, 1, 'toggleAutoMode(false) must stop Auto Mode observer');

  // 3. sidepanel.js & popup.js: Panic restores analyzeBtn immediately & Run 1 finally does not unlock Run 2
  const spDom3 = createDomEnv();
  for (const id of [
    'sidePanelThemeBtn', 'sidePanelAnalyzeBtn', 'sidePanelClearBtn', 'zeroTraceToggle',
    'sidePanelProgressSection', 'sidePanelProgress', 'sidePanelProgressText',
    'sidePanelProgressPercentage', 'sidePanelAnnouncer', 'sidePanelMeta',
    'sidePanelEmpty', 'sidePanelResults'
  ]) {
    const tag = id === 'sidePanelProgress' ? 'PROGRESS' : (id === 'zeroTraceToggle' ? 'INPUT' : (id === 'sidePanelAnalyzeBtn' ? 'BUTTON' : 'DIV'));
    const el = new spDom3.El(tag);
    el.id = id;
    spDom3.doc.body.appendChild(el);
  }
  const spPendingResolvers = [];
  let spRuntimeListener = null;
  const spSandbox3 = {
    document: spDom3.doc, window: null, globalThis: null, console,
    setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error, WeakMap,
    requestAnimationFrame: (cb) => cb(),
    navigator: { clipboard: { writeText: async () => {} } },
    chrome: {
      tabs: {
        query: async () => [{ id: 1, url: 'https://quiz.test' }],
        sendMessage: (_id, msg, cb) => {
          if (msg.action === 'analyzeQuiz') spPendingResolvers.push((res) => cb && cb(res));
          else if (cb) cb({ success: true });
        }
      },
      runtime: {
        onMessage: { addListener: (fn) => { spRuntimeListener = fn; } },
        sendMessage: (_m, cb) => cb && cb({ success: true, state: null }),
        lastError: null
      },
      storage: { sync: { get: async () => ({ enabled: true }) }, local: { get: async () => ({ zeroTraceMode: false }), set: async () => {} }, onChanged: { addListener: () => {} } }
    },
    module: { exports: {} }
  };
  spSandbox3.window = spSandbox3;
  spSandbox3.globalThis = spSandbox3;
  vm.runInNewContext(read('sidepanel.js'), spSandbox3);
  for (const fn of spDom3.doc._listeners.DOMContentLoaded || []) await fn();

  const spBtn = spDom3.doc.getElementById('sidePanelAnalyzeBtn');
  const spRun1 = spSandbox3.SafeExmSidePanel.analyzeFromSidePanel();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(spBtn.disabled, true);
  await spSandbox3.SafeExmSidePanel.clearSidePanelAndPage('panic');
  assert.equal(spBtn.disabled, false, 'Side Panel clearSidePanelAndPage must re-enable analyzeBtn immediately');
  assert.equal(spBtn.textContent, 'Analyser la page');

  const spRun2 = spSandbox3.SafeExmSidePanel.analyzeFromSidePanel();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(spBtn.disabled, true);
  spPendingResolvers[0]({ success: false, cancelled: true, error: 'cancelled' });
  await spRun1;
  assert.equal(spBtn.disabled, true, 'Side Panel Run 1 finally must not unlock analyzeBtn while Run 2 is in-flight');
  spRuntimeListener({ action: 'sidePanelPanicClear', clearedAt: Date.now() });
  assert.equal(spBtn.disabled, false, 'Side Panel external sidePanelPanicClear must unlock analyzeBtn immediately');
  spPendingResolvers[1]({ success: false, cancelled: true, error: 'cancelled' });
  await spRun2;

  const pDom3 = createDomEnv();
  const pBtn = new pDom3.El('BUTTON'); pBtn.id = 'analyzeBtn';
  const pProg = new pDom3.El('DIV'); pProg.id = 'progressSection'; pProg.hidden = true;
  const pText = new pDom3.El('DIV'); pText.id = 'progressText';
  const pFill = new pDom3.El('PROGRESS'); pFill.id = 'progressBarFill';
  pDom3.doc.body.appendChild(pBtn); pDom3.doc.body.appendChild(pProg); pDom3.doc.body.appendChild(pText); pDom3.doc.body.appendChild(pFill);
  const pPendingResolvers = [];
  let pRuntimeListener = null;
  const pUiSandbox = {
    document: pDom3.doc, window: null, globalThis: null,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error,
    chrome: {
      tabs: {
        query: async () => [{ id: 1, url: 'https://quiz.test' }],
        sendMessage: (_id, msg, cb) => {
          if (msg.action === 'analyzeQuiz') pPendingResolvers.push((res) => cb && cb(res));
          else if (cb) cb({ success: true });
        }
      },
      runtime: {
        lastError: null,
        onMessage: { addListener: (fn) => { pRuntimeListener = fn; } },
        sendMessage: (_m, cb) => cb && cb({ success: true, stats: {} })
      },
      storage: { sync: { get: async () => ({ enabled: true }), set: async () => {} }, local: { get: async () => ({}) } }
    },
    module: { exports: {} }
  };
  pUiSandbox.window = pUiSandbox;
  pUiSandbox.globalThis = pUiSandbox;
  vm.runInNewContext(read('popup.js'), pUiSandbox);
  for (const fn of pDom3.doc._listeners.DOMContentLoaded || []) await fn();

  const pRun1 = pUiSandbox.SafeExmPopup.analyzeQuiz();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(pBtn.disabled, true);
  await pUiSandbox.SafeExmPopup.clearHighlights();
  assert.equal(pBtn.disabled, false, 'Popup clearHighlights must re-enable analyzeBtn immediately');
  assert.equal(pBtn.textContent, 'Analyser la page');

  const pRun2 = pUiSandbox.SafeExmPopup.analyzeQuiz();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(pBtn.disabled, true);
  pPendingResolvers[0]({ success: false, cancelled: true, error: 'cancelled' });
  await pRun1;
  assert.equal(pBtn.disabled, true, 'Popup Run 1 finally must not unlock analyzeBtn while Run 2 is in-flight');
  pRuntimeListener({ action: 'sidePanelPanicClear', clearedAt: Date.now() });
  assert.equal(pBtn.disabled, false, 'Popup sidePanelPanicClear must unlock analyzeBtn immediately');
  pPendingResolvers[1]({ success: false, cancelled: true, error: 'cancelled' });
  await pRun2;
});

test('F-UX-01 Re-audit Pass 11 Regression: callProvider/ProviderAnalytics/proxy/ModelRegistry/handleFetchImage/handleFetchLLM redact secrets, delayed self-echo clear preserves Run 2, and local provider placeholders stay intact', { timeout: 8000 }, async () => {
  const customSecret = 'myCustomAzureSecret_987654';
  const xaiLeak = ['xai-', 'SECRET_KEY_1234567890'].join('');
  const headerSecret = 'CustomHeaderKey_ABC12345';
  const mistralSecret = ['mistral_', 'LEAK_888888'].join('');
  const groqSecret = ['gsk_', 'LEAK_999999'].join('');

  // 1a. callProvider HTTP 401 -> thrown error & ProviderAnalytics.lastError redact custom keys, xai- tokens, and URLs
  const pLogs = [];
  const logP = (...args) => pLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  let fetchResponder = async (url) => ({
    ok: false,
    status: 401,
    headers: { get: () => null },
    json: async () => ({
      error: {
        message: `Auth failed for ${customSecret} and ${xaiLeak} at ${url}?key=${customSecret}`
      }
    }),
    text: async () => ''
  });
  const pSandbox = {
    console: { log: logP, warn: logP, error: logP },
    URL, TextDecoder, TextEncoder, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
    setTimeout, clearTimeout, AbortController, AbortSignal,
    fetch: (url, init) => fetchResponder(url, init),
    chrome: {
      storage: {
        local: { get: async () => ({}), set: async () => {} },
        sync: { get: async () => ({}), set: async () => {} },
        onChanged: { addListener: () => {} }
      }
    },
    module: { exports: {} },
    globalThis: null
  };
  pSandbox.globalThis = pSandbox;
  pSandbox.self = pSandbox;
  pSandbox.window = pSandbox;
  vm.runInNewContext(read('provider-catalog.js'), pSandbox);
  pSandbox.ProviderCatalog = pSandbox.module.exports;
  pSandbox.module = { exports: {} };
  vm.runInNewContext(read('providers.js'), pSandbox);

  await assert.rejects(
    () => pSandbox.QuizProviders.callProvider('gemini', customSecret, 'gemini-2.5-flash', 'Hello', [], { retry: { maxRetries: 0 } }),
    (err) => {
      assert.equal(err.message.includes(customSecret), false, 'callProvider error must redact custom secret');
      assert.equal(err.message.includes(xaiLeak), false, 'callProvider error must redact xai- token');
      assert.equal(err.message.includes('https://'), true);
      assert.equal(err.message.includes(`?key=${customSecret}`), false);
      assert.equal(err.message.includes('?key=***'), true);
      return true;
    }
  );
  const analyticsStats = pSandbox.QuizProviders.ProviderAnalytics.getStats();
  const gemLastErr = analyticsStats.providers.gemini.lastError;
  assert.equal(gemLastErr.includes(customSecret), false, 'ProviderAnalytics.lastError must redact custom secret');
  assert.equal(gemLastErr.includes(xaiLeak), false, 'ProviderAnalytics.lastError must redact xai- token');
  assert.equal(gemLastErr.includes('https://'), false, 'ProviderAnalytics.lastError must mask full URL');

  // 1b. ModelRegistry catch blocks redact Mistral / Groq keys
  pLogs.length = 0;
  fetchResponder = async () => {
    throw Object.assign(new Error(`upstream error (400) for ${mistralSecret} Bearer ${groqSecret}`), { retryable: false });
  };
  await pSandbox.ModelRegistry.syncProviderModels('mistral', mistralSecret, null, { force: true });
  await pSandbox.ModelRegistry.syncProviderModels('groq', groqSecret, null, { force: true });
  assert.equal(pLogs.join('\n').includes(mistralSecret), false, 'ModelRegistry Mistral logs must redact key');
  assert.equal(pLogs.join('\n').includes(groqSecret), false, 'ModelRegistry Groq logs must redact key');

  // 1c. _proxyFetchViaRuntime redacts header secrets from proxy errors
  const proxySandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    URL, TextDecoder, TextEncoder, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
    setTimeout, clearTimeout, AbortController, AbortSignal,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (_msg, cb) => cb && cb({ success: false, networkError: true, error: `Upstream rejected credential ${headerSecret}` })
      },
      storage: { local: { get: async () => ({}), set: async () => {} }, sync: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } }
    },
    module: { exports: {} },
    globalThis: null
  };
  proxySandbox.globalThis = proxySandbox;
  proxySandbox.window = proxySandbox;
  vm.runInNewContext(read('provider-catalog.js'), proxySandbox);
  proxySandbox.ProviderCatalog = proxySandbox.module.exports;
  proxySandbox.module = { exports: {} };
  vm.runInNewContext(read('providers.js'), proxySandbox);
  await assert.rejects(
    () => proxySandbox.QuizProviders.extensionFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${headerSecret}` },
      retry: { maxRetries: 0 }
    }),
    (err) => {
      assert.equal(err.message.includes(headerSecret), false, '_proxyFetchViaRuntime must redact header secret');
      return true;
    }
  );

  // 2. background.js handleFetchImage, handleFetchLLM (options.headers), and handleRuntimeMessage redact secrets/URLs
  const bgLogs = [];
  let bgOnMessage = null;
  const logBg = (...args) => bgLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  const bgSandbox = {
    console: { log: logBg, warn: logBg, error: logBg },
    URL, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
    encodeURIComponent, decodeURIComponent, parseInt, isNaN, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout, clearTimeout, AbortController, AbortSignal,
    fetch: async (u) => {
      throw new TypeError(`Failed to fetch ${u} with credential ${headerSecret}`);
    },
    chrome: {
      runtime: {
        onMessage: { addListener: (fn) => { bgOnMessage = fn; } },
        onConnect: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
        sendMessage: (_m, cb) => cb && cb({ ok: true }),
        lastError: null
      },
      tabs: { onRemoved: { addListener: () => {} }, query: async () => [], sendMessage: (_id, _p, cb) => cb && cb({ success: true }) },
      notifications: { create: () => {} },
      commands: { onCommand: { addListener: () => {} } },
      contextMenus: { onClicked: { addListener: () => {} } },
      storage: { sync: { get: async () => ({}), set: async () => {} }, local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}), set: async () => {}, remove: async () => {} } }
    },
    module: { exports: {} },
    globalThis: null
  };
  bgSandbox.globalThis = bgSandbox;
  vm.runInNewContext(read('background.js'), bgSandbox);

  const imgRes = await bgSandbox.module.exports.handleFetchImage('https://cdn.example.com/q.png?token=IMG_SECRET_999&X-Amz-Signature=SIG777');
  assert.equal(imgRes.success, false);
  assert.equal(imgRes.error.includes('IMG_SECRET_999'), false);
  assert.equal(imgRes.error.includes('SIG777'), false);
  assert.equal(bgLogs.join('\n').includes('IMG_SECRET_999'), false);

  bgLogs.length = 0;
  const llmRes = await bgSandbox.module.exports.handleFetchLLM('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${headerSecret}` }
  });
  assert.equal(llmRes.success, false);
  assert.equal(llmRes.error.includes(headerSecret), false, 'handleFetchLLM must redact options.headers secret');
  assert.equal(bgLogs.join('\n').includes(headerSecret), false);

  const serpMsgRes = await new Promise((resolve) => {
    bgOnMessage({ action: 'fetchSerpApi', query: 'test', apiKey: 'SERP_SECRET_65432' }, {}, resolve);
  });
  assert.equal(serpMsgRes.success, false);
  assert.equal(serpMsgRes.error.includes('SERP_SECRET_65432'), false);

  // 3a. sidepanel.js: delayed self-echo sidePanelPanicClear from Clear(t=0) does not cancel Run 2(t=2ms)
  const spDom = createDomEnv();
  for (const id of [
    'sidePanelThemeBtn', 'sidePanelAnalyzeBtn', 'sidePanelClearBtn', 'zeroTraceToggle',
    'sidePanelProgressSection', 'sidePanelProgress', 'sidePanelProgressText',
    'sidePanelProgressPercentage', 'sidePanelAnnouncer', 'sidePanelMeta',
    'sidePanelEmpty', 'sidePanelResults'
  ]) {
    const tag = id === 'sidePanelProgress' ? 'PROGRESS' : (id === 'zeroTraceToggle' ? 'INPUT' : (id === 'sidePanelAnalyzeBtn' ? 'BUTTON' : 'DIV'));
    const el = new spDom.El(tag);
    el.id = id;
    if (id === 'sidePanelProgressSection' || id === 'sidePanelResults') el.hidden = true;
    spDom.doc.body.appendChild(el);
  }
  let spRuntime = null;
  let spStateStorage = { hostname: 'quiz.test', zeroTraceMode: false, items: [{ index: 0, text: 'Q?', answerSummary: 'A', confidence: 95, confidenceTier: 'high' }] };
  let resolveSpRun = null;
  const spSandbox = {
    document: spDom.doc, window: null, globalThis: null, console,
    setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error, WeakMap,
    requestAnimationFrame: (cb) => cb(),
    navigator: { clipboard: { writeText: async () => {} } },
    chrome: {
      tabs: {
        query: async () => [{ id: 1, url: 'https://quiz.test' }],
        sendMessage: (_id, msg, cb) => {
          if (msg.action === 'clearHighlights') {
            setTimeout(() => cb && cb({ success: true }), 10);
          } else if (msg.action === 'analyzeQuiz') {
            resolveSpRun = () => {
              spStateStorage = { hostname: 'quiz.test', zeroTraceMode: true, items: [{ index: 0, text: 'Q2?', answerSummary: 'B', confidence: 98, confidenceTier: 'high' }] };
              cb && cb({ success: true, data: { questionsFound: 1, answersHighlighted: 0, zeroTraceMode: true } });
            };
          }
        }
      },
      runtime: {
        onMessage: { addListener: (fn) => { spRuntime = fn; } },
        sendMessage: (msg, cb) => {
          if (msg.action === 'clearSidePanelState') {
            const clearedAt = Date.now();
            setTimeout(() => {
              if (spRuntime) {
                spRuntime({ action: 'sidePanelPanicClear', reason: msg.reason, clearId: msg.clearId, clearedAt });
              }
              cb && cb({ success: true, cleared: true });
            }, 12);
          } else if (msg.action === 'getSidePanelState') {
            cb && cb({ success: true, state: spStateStorage });
          } else {
            cb && cb({ success: true });
          }
        },
        lastError: null
      },
      storage: { sync: { get: async () => ({ enabled: true }) }, local: { get: async () => ({ zeroTraceMode: true }), set: async () => {} }, onChanged: { addListener: () => {} } }
    },
    module: { exports: {} }
  };
  spSandbox.window = spSandbox;
  spSandbox.globalThis = spSandbox;
  vm.runInNewContext(read('sidepanel.js'), spSandbox);
  for (const fn of spDom.doc._listeners.DOMContentLoaded || []) await fn();

  const spAnalyzeBtn = spDom.doc.getElementById('sidePanelAnalyzeBtn');
  const spClearP = spSandbox.SafeExmSidePanel.clearSidePanelAndPage('sidepanel-clear');
  await new Promise((r) => setTimeout(r, 2));
  const spRun2P = spSandbox.SafeExmSidePanel.analyzeFromSidePanel();
  await spClearP;
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(spAnalyzeBtn.disabled, true, 'Delayed self-echo sidePanelPanicClear must not unlock Run 2 analyzeBtn');
  assert.equal(spDom.doc.getElementById('sidePanelProgressSection').hidden, false, 'Delayed self-echo must not hide Run 2 progress');
  resolveSpRun();
  await spRun2P;
  assert.equal(spAnalyzeBtn.disabled, false);
  assert.equal(spSandbox.SafeExmSidePanel.getCurrentState().items.length, 1, 'Run 2 result must not be dropped after self-echo clear');

  // External clear during Run 3 still cancels immediately
  const spRun3P = spSandbox.SafeExmSidePanel.analyzeFromSidePanel();
  await new Promise((r) => setTimeout(r, 5));
  spRuntime({ action: 'sidePanelPanicClear', reason: 'panic', clearedAt: Date.now() });
  assert.equal(spAnalyzeBtn.disabled, false);
  assert.equal(spDom.doc.getElementById('sidePanelProgressSection').hidden, true);
  resolveSpRun();
  await spRun3P;

  // 3b. popup.js: delayed self-echo sidePanelPanicClear does not cancel Run 2
  const pDom = createDomEnv();
  const pBtn = new pDom.El('BUTTON'); pBtn.id = 'analyzeBtn';
  const pProg = new pDom.El('DIV'); pProg.id = 'progressSection'; pProg.hidden = true;
  const pText = new pDom.El('DIV'); pText.id = 'progressText';
  const pFill = new pDom.El('PROGRESS'); pFill.id = 'progressBarFill';
  pDom.doc.body.appendChild(pBtn); pDom.doc.body.appendChild(pProg); pDom.doc.body.appendChild(pText); pDom.doc.body.appendChild(pFill);
  let pRuntime = null;
  let resolvePRun = null;
  const pUiSb = {
    document: pDom.doc, window: null, globalThis: null,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error,
    chrome: {
      tabs: {
        query: async () => [{ id: 1, url: 'https://quiz.test' }],
        sendMessage: (_id, msg, cb) => {
          if (msg.action === 'clearHighlights') setTimeout(() => cb && cb({ success: true }), 10);
          else if (msg.action === 'analyzeQuiz') {
            resolvePRun = () => cb && cb({ success: true, data: { questionsFound: 2, answersHighlighted: 2 } });
          }
        }
      },
      runtime: {
        lastError: null,
        onMessage: { addListener: (fn) => { pRuntime = fn; } },
        sendMessage: (msg, cb) => {
          if (msg.action === 'clearSidePanelState') {
            const clearedAt = Date.now();
            setTimeout(() => {
              if (pRuntime) pRuntime({ action: 'sidePanelPanicClear', reason: msg.reason, clearId: msg.clearId, clearedAt });
              cb && cb({ success: true });
            }, 12);
          } else {
            cb && cb({ success: true, stats: {} });
          }
        }
      },
      storage: { sync: { get: async () => ({ enabled: true }), set: async () => {} }, local: { get: async () => ({}) } }
    },
    module: { exports: {} }
  };
  pUiSb.window = pUiSb;
  pUiSb.globalThis = pUiSb;
  vm.runInNewContext(read('popup.js'), pUiSb);
  for (const fn of pDom.doc._listeners.DOMContentLoaded || []) await fn();

  const pClearP = pUiSb.SafeExmPopup.clearHighlights();
  await new Promise((r) => setTimeout(r, 2));
  const pRun2P = pUiSb.SafeExmPopup.analyzeQuiz();
  await pClearP;
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(pBtn.disabled, true, 'Popup delayed self-echo must not unlock Run 2 analyzeBtn');
  assert.equal(pProg.hidden, false, 'Popup delayed self-echo must not hide Run 2 progress');
  resolvePRun();
  await pRun2P;
  assert.ok(pText.textContent.includes('2/2'), 'Popup Run 2 summary must survive delayed self-echo clear');

  // 4. Local provider placeholders ('ollama', 'freecc', etc.) do not corrupt model/provider strings while Bearer regex still masks headers
  fetchResponder = async () => ({
    ok: false,
    status: 404,
    headers: { get: () => null },
    json: async () => ({
      error: { message: 'model "ollama-llama3.2" not found on ollama local endpoint; Authorization: Bearer ollama' }
    }),
    text: async () => ''
  });
  await assert.rejects(
    () => pSandbox.QuizProviders.smartRoute(
      { system: 's', user: 'u' },
      [],
      { providerConfigs: { ollama: { enabled: true, baseUrl: 'http://127.0.0.1:11434/v1' } } },
      ['ollama'],
      { ollama: { text: 'ollama-llama3.2' } },
      { retry: { maxRetries: 0 } }
    ),
    (err) => {
      assert.equal(err.message.includes('ollama-llama3.2'), true, 'Local model name ollama-llama3.2 must not be redacted');
      assert.equal(err.message.includes('on ollama local endpoint'), true, 'Local provider name must not be redacted');
      assert.equal(err.message.includes('Bearer ollama'), false, 'Bearer header token must still be masked');
      return true;
    }
  );

  const agSandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    URL, TextDecoder, TextEncoder, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
    setTimeout, clearTimeout, AbortController, AbortSignal,
    fetch: async () => ({ ok: true, status: 200, text: async () => 'System {{domain_rules}}' }),
    QuizProviders: {
      ...pSandbox.QuizProviders,
      PROVIDERS: pSandbox.QuizProviders.PROVIDERS,
      extensionFetch: async () => ({
        ok: false,
        status: 404,
        json: async () => ({
          error: { message: 'model "ollama-llama3.2" not found on ollama local endpoint; Authorization: Bearer ollama' }
        })
      })
    },
    chrome: { runtime: { getURL: (p) => `chrome-extension://test/${p}`, sendMessage: () => Promise.resolve({ ok: true }) } },
    module: { exports: {} },
    globalThis: null
  };
  agSandbox.globalThis = agSandbox;
  agSandbox.self = agSandbox;
  vm.runInNewContext(read('background-agent.js'), agSandbox);
  const agRes = await agSandbox.module.exports.BackgroundAgent.solve({
    questions: [{ index: 1, text: 'Q?', type: 'radio', questionType: 'single_choice', options: [{ index: 0, text: 'A' }] }],
    config: {
      syncConfig: { enabled: true, providerConfigs: { ollama: { enabled: true, baseUrl: 'http://127.0.0.1:11434/v1' } }, customModels: { ollama: { text: 'ollama-llama3.2' } } },
      apiKeys: { providerConfigs: { ollama: { enabled: true } } },
      settings: { selectedProvider: 'ollama' }
    }
  });
  assert.equal(agRes.success, false);
  assert.equal(agRes.error.includes('ollama-llama3.2'), true, 'BackgroundAgent must preserve ollama-llama3.2 identifier');
  assert.equal(agRes.error.includes('on ollama local endpoint'), true);
  assert.equal(agRes.error.includes('Bearer ollama'), false, 'BackgroundAgent must still mask Authorization: Bearer ollama');
});
