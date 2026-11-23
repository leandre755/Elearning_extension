'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const SETTINGS_FIXTURE_ELEMENT_IDS = [
  'providersAccordion', 'providerSearchInput', 'providerFilterCount', 'providersEmptyState',
  'showAllPriorityProviders', 'showAllModelOverrides', 'serpApiKey', 'agenticSearch', 'autoMode',
  'captureImages', 'imageMinSize', 'imageMinSizeDisplay', 'imageQuality', 'imageQualityDisplay',
  'priorityList', 'priorityAnnouncer', 'modelOverrides', 'contextText', 'fileInput', 'fileUploadArea',
  'fileList', 'fileBudgetInfo', 'customQuestionSelector', 'customAnswerSelector', 'highlightColor',
  'highlightIntensity', 'schemaList', 'refreshSchemasBtn', 'clearAllSchemasBtn', 'saveBtn',
  'resetBtn', 'saveStatus', 'discretionSlider', 'highlightPreviewElement', 'discretionDescription',
  'colorCustomizerRow', 'showConfidenceBadge', 'domainPreset', 'customDomainRules',
  'crossValidationEnabled', 'crossValidationThreshold', 'crossValidationThresholdDisplay',
  'crossValidationOptionsRow', 'autoSubmitEnabled', 'autoSubmitMinConfidence',
  'autoSubmitMinConfidenceDisplay', 'autoSubmitDelayMs', 'autoSubmitDelayMsDisplay',
  'autoSubmitOptionsGroup', 'passiveNetworkIntercept', 'themeToggleBtn'
];

function createDomSandbox() {
  class FakeEl {
    constructor(tagName = 'DIV') {
      this.tagName = String(tagName).toUpperCase();
      this.id = '';
      this.className = '';
      this.style = {};
      this.dataset = {};
      this.attributes = {};
      this.children = [];
      this.parentNode = null;
      this.parentElement = null;
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this.checked = false;
      this.type = '';
      this.name = '';
      this.placeholder = '';
      this.returnValue = '';
      this.isConnected = true;
      this._textContent = '';
      this._listeners = {};
      this._focused = false;
      const self = this;
      this.classList = {
        add(...cls) {
          const set = new Set(self.className.split(/\s+/).filter(Boolean));
          for (const c of cls) set.add(c);
          self.className = Array.from(set).join(' ');
        },
        remove(...cls) {
          const drop = new Set(cls);
          self.className = self.className.split(/\s+/).filter((c) => c && !drop.has(c)).join(' ');
        },
        toggle(c, force) {
          const has = this.contains(c);
          const next = force === undefined ? !has : Boolean(force);
          if (next) this.add(c);
          else this.remove(c);
          return next;
        },
        contains(c) {
          return self.className.split(/\s+/).filter(Boolean).includes(c);
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
      if (this._textContent === '') {
        this.children = [];
      }
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === 'id') this.id = String(v);
      if (k === 'class') this.className = String(v);
      if (k === 'hidden') this.hidden = v === '' ? true : String(v);
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        this.dataset[camel] = String(v);
      }
    }
    getAttribute(k) {
      if (k === 'id' && this.id) return this.id;
      if (k === 'class' && this.className) return this.className;
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    }
    removeAttribute(k) {
      delete this.attributes[k];
      if (k === 'hidden') this.hidden = false;
    }
    hasAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attributes, k) || (k === 'hidden' && Boolean(this.hidden));
    }
    appendChild(child) {
      if (!child) return child;
      if (child.parentNode && Array.isArray(child.parentNode.children)) {
        const idx = child.parentNode.children.indexOf(child);
        if (idx !== -1) child.parentNode.children.splice(idx, 1);
      }
      child.parentNode = this;
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
      if (child) {
        child.parentNode = null;
        child.parentElement = null;
      }
      return child;
    }
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }
    replaceChildren(...nodes) {
      for (const c of this.children) {
        if (c) {
          c.parentNode = null;
          c.parentElement = null;
        }
      }
      this.children = [];
      this._textContent = '';
      for (const n of nodes) {
        if (typeof n === 'string') {
          this.appendChild({ nodeType: 3, textContent: n });
        } else if (n) {
          this.appendChild(n);
        }
      }
    }
    addEventListener(type, fn, opts) {
      this._listeners[type] = this._listeners[type] || [];
      this._listeners[type].push({ fn, once: Boolean(opts && opts.once) });
    }
    removeEventListener(type, fn) {
      if (!this._listeners[type]) return;
      this._listeners[type] = this._listeners[type].filter((item) => item.fn !== fn);
    }
    dispatchEvent(event) {
      const list = (this._listeners[event.type] || []).slice();
      for (const entry of list) {
        if (entry.once) {
          this.removeEventListener(event.type, entry.fn);
        }
        entry.fn.call(this, event);
      }
    }
    contains(other) {
      return other === this || this.children.some((c) => typeof c.contains === 'function' && c.contains(other));
    }
    querySelectorAll(selector) {
      const results = [];
      const visit = (node) => {
        for (const c of node.children || []) {
          if (c && typeof c.matchesSelector === 'function' && c.matchesSelector(selector)) {
            results.push(c);
          }
          if (c && Array.isArray(c.children)) visit(c);
        }
      };
      visit(this);
      return results;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    matchesSelector(selector) {
      const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
      return parts.some((part) => {
        if (part.startsWith('.')) {
          const dotParts = part.split('[');
          const cls = dotParts[0].slice(1);
          if (!this.classList.contains(cls)) return false;
          for (let i = 1; i < dotParts.length; i++) {
            const m = dotParts[i].match(/^data-([^=]+)="([^"]+)"\]$/);
            if (m && this.getAttribute(`data-${m[1]}`) !== m[2]) return false;
          }
          return true;
        }
        const m = part.match(/^([a-z0-9]+)\[name="([^"]+)"\]$/i);
        if (m) {
          return this.tagName === m[1].toUpperCase() && this.getAttribute('name') === m[2];
        }
        return this.tagName === part.toUpperCase();
      });
    }
    scrollIntoView() {}
    focus() {
      this._focused = true;
      if (this._ownerDoc) this._ownerDoc.activeElement = this;
    }
  }

  const doc = {
    documentElement: new FakeEl('HTML'),
    head: new FakeEl('HEAD'),
    body: new FakeEl('BODY'),
    activeElement: null,
    _listeners: {},
    createElement(tag) {
      const el = new FakeEl(tag);
      el._ownerDoc = doc;
      return el;
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
    getElementById(id) {
      const find = (node) => {
        if (node.id === id) return node;
        for (const c of node.children || []) {
          if (c && typeof c === 'object') {
            const hit = find(c);
            if (hit) return hit;
          }
        }
        return null;
      };
      return find(doc.documentElement) || find(doc.head) || find(doc.body);
    },
    querySelectorAll(selector) {
      return [...doc.head.querySelectorAll(selector), ...doc.body.querySelectorAll(selector)];
    },
    querySelector(selector) {
      return doc.querySelectorAll(selector)[0] || null;
    },
    addEventListener(type, fn) {
      doc._listeners[type] = doc._listeners[type] || [];
      doc._listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (!doc._listeners[type]) return;
      doc._listeners[type] = doc._listeners[type].filter((f) => f !== fn);
    },
    dispatchEvent(event) {
      const list = (doc._listeners[event.type] || []).slice();
      for (const fn of list) fn.call(doc, event);
    }
  };
  doc.documentElement._ownerDoc = doc;
  doc.head._ownerDoc = doc;
  doc.body._ownerDoc = doc;
  return { doc, FakeEl };
}

test('theme-init.js: FOUC-free bootstrap, system mode return, matchMedia change & cross-tab sync', async () => {
  const { doc, FakeEl } = createDomSandbox();
  const meta = new FakeEl('META');
  meta.setAttribute('name', 'color-scheme');
  meta.setAttribute('content', 'light dark');
  doc.head.appendChild(meta);

  let osMatchesDark = true;
  let mediaChangeListeners = [];
  const windowListeners = {};
  const localCache = new Map();
  const chromeStore = {};
  let chromeListeners = [];
  let removedKeys = [];
  let storageGetDelay = null;

  const sandbox = {
    document: doc,
    window: null,
    globalThis: null,
    module: { exports: {} },
    console,
    Promise,
    Set,
    Map,
    localStorage: {
      getItem: (k) => (localCache.has(k) ? localCache.get(k) : null),
      setItem: (k, v) => localCache.set(k, String(v)),
      removeItem: (k) => localCache.delete(k)
    },
    matchMedia: () => ({
      get matches() { return osMatchesDark; },
      addEventListener: (_ev, fn) => mediaChangeListeners.push(fn),
      removeEventListener: (_ev, fn) => {
        mediaChangeListeners = mediaChangeListeners.filter((f) => f !== fn);
      }
    }),
    addEventListener: (ev, fn) => {
      windowListeners[ev] = windowListeners[ev] || [];
      windowListeners[ev].push(fn);
    },
    removeEventListener: () => {},
    chrome: {
      storage: {
        local: {
          get: async (keys) => {
            if (storageGetDelay) await storageGetDelay();
            const out = {};
            for (const k of keys) if (Object.prototype.hasOwnProperty.call(chromeStore, k)) out[k] = chromeStore[k];
            return out;
          },
          set: async (obj) => Object.assign(chromeStore, obj),
          remove: async (keys) => {
            for (const k of keys) {
              delete chromeStore[k];
              removedKeys.push(k);
            }
          }
        },
        onChanged: {
          addListener: (fn) => chromeListeners.push(fn),
          removeListener: (fn) => {
            chromeListeners = chromeListeners.filter((f) => f !== fn);
          }
        }
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.localStorage = sandbox.localStorage;

  vm.runInNewContext(read('theme-init.js'), sandbox);
  const Theme = sandbox.SafeExmTheme;

  // Synchronous FOUC-free parse-time application with OS dark & no stored override
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme-mode'), 'system');
  assert.equal(meta.getAttribute('content'), 'light dark');

  await Theme.initThemeFromStorage();

  // Concurrent initThemeFromStorage() calls must not duplicate listeners
  let unblockFirstGet;
  let getCallCount = 0;
  storageGetDelay = () => {
    getCallCount++;
    if (getCallCount === 1) {
      return new Promise((resolve) => { unblockFirstGet = resolve; });
    }
    return Promise.resolve();
  };
  const appliedStates = [];
  const init1 = Theme.initThemeFromStorage((st) => appliedStates.push(st));
  const init2 = Theme.initThemeFromStorage((st) => appliedStates.push(st));
  unblockFirstGet();
  await Promise.all([init1, init2]);
  storageGetDelay = null;
  assert.equal(mediaChangeListeners.length, 1, 'concurrent init must keep exactly 1 matchMedia listener');
  assert.equal(chromeListeners.length, 1, 'concurrent init must keep exactly 1 storage.onChanged listener');

  // OS changes while in system mode -> updates automatically
  osMatchesDark = false;
  mediaChangeListeners.forEach((fn) => fn());
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(doc.documentElement.getAttribute('data-theme-mode'), 'system');

  // Toggle from system light -> pins 'dark'
  await Theme.toggleTheme();
  assert.equal(chromeStore.uiTheme, 'dark');
  assert.equal(localCache.get('safeExmUiTheme'), 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme-mode'), 'override');
  assert.equal(meta.getAttribute('content'), 'dark');

  // OS changes to dark while override='dark': MUST NOT remove pinned override, AND must still notify onApplied
  appliedStates.length = 0;
  osMatchesDark = true;
  mediaChangeListeners.forEach((fn) => fn());
  assert.equal(chromeStore.uiTheme, 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme-mode'), 'override');
  assert.equal(appliedStates.length, 1);
  assert.equal(appliedStates[0].systemScheme, 'dark');
  assert.equal(appliedStates[0].override, 'dark');

  // OS returns to light -> override 'dark' stayed pinned!
  osMatchesDark = false;
  mediaChangeListeners.forEach((fn) => fn());
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme-mode'), 'override');

  // Toggle again when target === system ('light') -> removes override & returns to system
  removedKeys = [];
  await Theme.toggleTheme();
  assert.ok(removedKeys.includes('uiTheme'));
  assert.equal(Object.prototype.hasOwnProperty.call(chromeStore, 'uiTheme'), false);
  assert.equal(localCache.has('safeExmUiTheme'), false);
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(doc.documentElement.getAttribute('data-theme-mode'), 'system');
  assert.equal(meta.getAttribute('content'), 'light dark');

  // Rapid back-to-back toggleTheme() calls flip deterministically without double-click race
  const t1 = Theme.toggleTheme();
  const t2 = Theme.toggleTheme();
  await Promise.all([t1, t2]);
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(doc.documentElement.getAttribute('data-theme-mode'), 'system');
  assert.equal(Object.prototype.hasOwnProperty.call(chromeStore, 'uiTheme'), false);

  // Sync via chrome.storage.onChanged
  chromeListeners.forEach((fn) => fn({ uiTheme: { newValue: 'dark' } }, 'local'));
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme-mode'), 'override');
});

test('settings.js: accessible tabs (keyboard + beforematch), priority keyboard reorder, <dialog> reset, zero innerHTML', async () => {
  const { doc, FakeEl } = createDomSandbox();

  const tabNav = new FakeEl('NAV');
  tabNav.className = 'settings-tabs';
  const tabDefs = [
    ['btn-essential', 'tab-essential', true],
    ['btn-providers', 'tab-providers', false],
    ['btn-advanced', 'tab-advanced', false],
    ['btn-expert', 'tab-expert', false]
  ];
  const tabs = [];
  const panels = [];
  for (const [btnId, panelId, active] of tabDefs) {
    const b = new FakeEl('BUTTON');
    b.id = btnId;
    b.className = active ? 'tab-btn active' : 'tab-btn';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', active ? 'true' : 'false');
    b.setAttribute('tabindex', active ? '0' : '-1');
    b.setAttribute('data-panel', panelId);
    b._ownerDoc = doc;
    tabNav.appendChild(b);
    tabs.push(b);

    const p = new FakeEl('DIV');
    p.id = panelId;
    p.className = active ? 'tab-content active' : 'tab-content';
    p.setAttribute('role', 'tabpanel');
    if (!active) p.setAttribute('hidden', 'until-found');
    p._ownerDoc = doc;
    doc.body.appendChild(p);
    panels.push(p);
  }
  doc.body.appendChild(tabNav);

  const ids = SETTINGS_FIXTURE_ELEMENT_IDS;
  for (const id of ids) {
    const tag = id === 'discretionSlider' || id === 'fileInput' ? 'INPUT' : 'DIV';
    const el = new FakeEl(tag);
    el.id = id;
    el._ownerDoc = doc;
    doc.body.appendChild(el);
  }

  let dialogShowCalls = 0;
  let dialogNextReturn = 'cancel';
  const dialog = new FakeEl('DIALOG');
  dialog.id = 'resetConfirmDialog';
  const dTitle = new FakeEl('H2');
  dTitle.id = 'resetDialogTitle';
  const dDesc = new FakeEl('P');
  dDesc.id = 'resetDialogDesc';
  const dConfirm = new FakeEl('BUTTON');
  dConfirm.id = 'resetConfirmBtn';
  dialog.appendChild(dTitle);
  dialog.appendChild(dDesc);
  dialog.appendChild(dConfirm);
  dialog.showModal = () => {
    dialogShowCalls++;
    dialog.returnValue = dialogNextReturn;
    queueMicrotask(() => dialog.dispatchEvent({ type: 'close' }));
  };
  doc.body.appendChild(dialog);

  let syncCleared = false;
  let localRemoved = [];
  let reloaded = false;
  let confirmCalled = false;

  const sandbox = {
    document: doc,
    window: null,
    globalThis: null,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Date, Math, JSON, Promise, Set, Map, Array, Object, Number, String, Boolean, URL,
    setTimeout, clearTimeout, parseInt, parseFloat, isNaN,
    location: { reload: () => { reloaded = true; } },
    confirm: () => { confirmCalled = true; return true; },
    QuizProviders: {
      PROVIDERS: {
        groq: { name: 'Groq', apiKeyField: 'groqApiKey', defaultTextModel: 'm1' },
        gemini: { name: 'Gemini', apiKeyField: 'geminiApiKey', defaultTextModel: 'm2' },
        mistral: { name: 'Mistral', apiKeyField: 'mistralApiKey', defaultTextModel: 'm3' }
      },
      DEFAULT_PRIORITY: ['groq', 'gemini', 'mistral'],
      getAllStorageKeys: () => ['groqApiKey', 'geminiApiKey', 'mistralApiKey', 'providerConfigs'],
      isProviderConfigured: (k, snap) => Boolean(snap && snap[`${k}ApiKey`])
    },
    SchemaCache: {
      listCachedSchemas: async () => [{ hostname: 'quiz.example.com', platform: 'moodle', confidence: 0.9, discoveredAt: '2026-11-22T00:00:00Z' }],
      clearSchema: async () => {},
      clearAllSchemas: async () => 1
    },
    chrome: {
      storage: {
        sync: {
          get: async () => ({ providerOrder: ['groq', 'gemini', 'mistral'] }),
          set: async () => {},
          clear: async () => { syncCleared = true; }
        },
        local: {
          get: async () => ({ groqApiKey: 'g', geminiApiKey: 'x', mistralApiKey: 'm' }),
          set: async () => {},
          remove: async (keys) => { localRemoved = keys; }
        }
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const settingsSrc = read('settings.js');
  assert.equal(/\.innerHTML/.test(settingsSrc), false, 'settings.js must have zero .innerHTML usages');
  assert.equal(/\.then\s*\(/.test(settingsSrc), false, 'settings.js must have zero .then() chains');

  vm.runInNewContext(settingsSrc, sandbox);
  for (const fn of doc._listeners.DOMContentLoaded || []) {
    await fn();
  }

  // 1. Tab keyboard navigation & beforematch
  tabs[0].focus();
  tabNav.dispatchEvent({ type: 'keydown', key: 'ArrowRight', preventDefault() {} });
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(tabs[1].getAttribute('tabindex'), '0');
  assert.equal(tabs[0].getAttribute('tabindex'), '-1');
  assert.equal(panels[0].getAttribute('hidden'), 'until-found');
  assert.equal(panels[1].hidden, false);

  tabNav.dispatchEvent({ type: 'keydown', key: 'End', preventDefault() {} });
  assert.equal(tabs[3].getAttribute('aria-selected'), 'true');

  // Ctrl+F beforematch on hidden first panel re-activates its tab
  panels[0].dispatchEvent({ type: 'beforematch' });
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(panels[0].hidden, false);

  // 2. Keyboard reordering in priorityList + boundary focus transfer + live announcement
  const pList = doc.getElementById('priorityList');
  assert.equal(pList.children.length, 3);
  const secondItemUpBtn = pList.children[1].querySelectorAll('.priority-move-btn').find((b) => b.dataset.dir === 'up');
  secondItemUpBtn.dispatchEvent({ type: 'click', stopPropagation() {} });
  const newOrderIds = pList.children.map((el) => el.dataset.id);
  assert.deepEqual(newOrderIds, ['gemini', 'groq', 'mistral']);
  // First item Up button is now disabled, so focus transferred to Down button on the moved item
  const movedFirstDownBtn = pList.children[0].querySelectorAll('.priority-move-btn').find((b) => b.dataset.dir === 'down');
  assert.equal(movedFirstDownBtn._focused, true);
  assert.equal(doc.activeElement, movedFirstDownBtn);

  await new Promise((r) => setTimeout(r, 190));
  assert.match(doc.getElementById('priorityAnnouncer').textContent, /Gemini déplacé en position 1 sur 3/);

  // 3. Schema list rendered cleanly without innerHTML
  const schemaItems = doc.getElementById('schemaList').children;
  assert.equal(schemaItems.length, 1);
  assert.equal(schemaItems[0].querySelector('.remove-file').getAttribute('aria-label'), 'Supprimer quiz.example.com');

  // 4. Native <dialog> reset confirmation (cancel, already-open guard, then confirm)
  dialogNextReturn = 'cancel';
  await sandbox.SafeExmSettings.resetSettings();
  assert.equal(dialogShowCalls, 1);
  assert.equal(confirmCalled, false);
  assert.equal(syncCleared, false);

  // Re-entrant call while dialog.open === true must abort cleanly without calling showModal()
  dialog.open = true;
  await sandbox.SafeExmSettings.resetSettings();
  assert.equal(dialogShowCalls, 1);
  assert.equal(syncCleared, false);
  dialog.open = false;

  dialogNextReturn = 'confirm';
  await sandbox.SafeExmSettings.resetSettings();
  assert.equal(dialogShowCalls, 2);
  assert.equal(confirmCalled, false);
  assert.equal(syncCleared, true);
  assert.ok(localRemoved.includes('domainPreset'));
  assert.equal(reloaded, true);
});

test('popup.js: native <progress> value/error state and live announcer updates', () => {
  const { doc, FakeEl } = createDomSandbox();
  const progressSection = new FakeEl('DIV');
  progressSection.id = 'progressSection';
  progressSection.hidden = true;
  const progressBar = new FakeEl('PROGRESS');
  progressBar.id = 'progressBarFill';
  const progressText = new FakeEl('SPAN');
  progressText.id = 'progressText';
  const progressPct = new FakeEl('SPAN');
  progressPct.id = 'progressPercentage';
  const announcer = new FakeEl('SPAN');
  announcer.id = 'popupAnnouncer';
  doc.body.appendChild(progressSection);
  doc.body.appendChild(progressBar);
  doc.body.appendChild(progressText);
  doc.body.appendChild(progressPct);
  doc.body.appendChild(announcer);

  let msgHandler = null;
  const sandbox = {
    document: doc,
    window: null,
    globalThis: null,
    console, setTimeout, clearTimeout, Promise, Array, Object, Number, Boolean, String, Math, Date, Error,
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener: () => {} },
        sendMessage: (_m, cb) => cb && cb({ success: true, stats: {} })
      },
      storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) } },
      tabs: {
        query: async () => [{ id: 1 }],
        sendMessage: (_id, _m, cb) => {
          msgHandler = cb;
        }
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const popupSrc = read('popup.js');
  assert.equal(/\.then\s*\(/.test(popupSrc), false, 'popup.js must have zero .then() chains');
  vm.runInNewContext(popupSrc, sandbox);

  return (async () => {
    const p = sandbox.SafeExmPopup.sendMessageToTab(1, { action: 'analyzeQuiz' });
    msgHandler({ success: true, data: { questionsFound: 3, answersHighlighted: 3 } });
    await p;
    assert.equal(progressBar.value, 100);
    assert.equal(progressBar.classList.contains('is-error'), false);
    assert.equal(progressSection.hidden, false);
    assert.equal(announcer.textContent, '3/3 réponses trouvées');
  })();
});

test('background.js: chrome.storage.session pre-warm persistence across SW restart, context menu feedback, AbortSignal.timeout, and async/await', async () => {
  const sharedSession = {};
  const notifications = [];

  function loadBg() {
    const listeners = { contextClick: null };
    const fetchCalls = [];
    const sandbox = {
      console: { log: () => {}, warn: () => {}, error: () => {} },
      URL, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, Promise, Map, Set, Object, Array, Number, Boolean, String, RegExp, Date, Error, Math, JSON,
      encodeURIComponent, decodeURIComponent, parseInt, isNaN, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
      setTimeout, clearTimeout, AbortController, AbortSignal,
      module: { exports: {} },
      globalThis: null,
      QuizProviders: {
        PROVIDERS: { groq: { name: 'Groq', apiKeyField: 'groqApiKey' }, gemini: { name: 'Gemini', apiKeyField: 'geminiApiKey' } },
        getAllStorageKeys: () => ['groqApiKey', 'geminiApiKey', 'providerConfigs'],
        getAllApiKeyFields: () => ['groqApiKey', 'geminiApiKey'],
        preWarmProviders: async (arg) => ({ warmed: true, forced: Boolean(arg.force) })
      },
      fetch: async (url, opts) => {
        fetchCalls.push({ url, opts });
        return {
          ok: true,
          status: 200,
          blob: async () => ({
            type: 'image/png',
            arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer
          })
        };
      },
      chrome: {
        runtime: {
          onMessage: { addListener: () => {} },
          onConnect: { addListener: () => {} },
          onInstalled: { addListener: () => {} },
          getURL: (p) => `chrome-extension://test/${p}`,
          lastError: null
        },
        tabs: {
          onRemoved: { addListener: () => {} },
          sendMessage: async (_tabId, msg) => {
            if (msg.action === 'pasteAnswer') return { success: false, pasted: 0 };
            return { success: true };
          }
        },
        notifications: {
          create: (opts) => notifications.push(opts)
        },
        contextMenus: {
          create: () => {},
          removeAll: (cb) => cb && cb(),
          onClicked: { addListener: (fn) => { listeners.contextClick = fn; } }
        },
        storage: {
          sync: { get: async () => ({ providerOrder: ['groq'] }) },
          local: { get: async () => ({ groqApiKey: 'test-key-1234' }) },
          session: {
            get: async (keys) => {
              const res = {};
              for (const k of keys) if (Object.prototype.hasOwnProperty.call(sharedSession, k)) res[k] = sharedSession[k];
              return res;
            },
            set: async (obj) => Object.assign(sharedSession, obj)
          }
        }
      }
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(read('background.js'), sandbox);
    return { bg: sandbox.module.exports, listeners, fetchCalls };
  }

  const bgSrc = read('background.js');
  assert.equal(/\.then\s*\(/.test(bgSrc), false, 'background.js must have zero .then() chains');
  assert.equal(/\.then\s*\(/.test(read('content.js')), false, 'content.js must have zero .then() chains');

  // First SW instance warms and records signature in chrome.storage.session
  const sw1 = loadBg();
  const r1 = await sw1.bg.handlePreWarmProviders({});
  assert.equal(r1.success, true);
  assert.equal(r1.forced, false);
  assert.equal(typeof sharedSession._lastPreWarmConfigSignature, 'string');

  // Second SW instance (simulating 30s SW termination + restart) reads signature from session storage
  const sw2 = loadBg();
  const r2 = await sw2.bg.handlePreWarmProviders({});
  assert.equal(r2.forced, false);

  // Changing active provider config across SW restart forces re-warm
  const r3 = await sw2.bg.handlePreWarmProviders({ config: { groqApiKey: 'k', geminiApiKey: 'g' } });
  assert.equal(r3.forced, true);

  // Context menu feedback notifications
  await sw2.listeners.contextClick({ menuItemId: 'cm-clear-highlights' }, { id: 7 });
  await sw2.listeners.contextClick({ menuItemId: 'cm-paste-answer' }, { id: 7 });
  assert.equal(notifications.length, 2);
  assert.match(notifications[0].message, /Marques effacées/);
  assert.match(notifications[1].message, /Aucune réponse texte/);

  // handleFetchImage uses AbortSignal (AbortSignal.timeout) + redirect: 'error'
  const imgRes = await sw2.bg.handleFetchImage('https://cdn.example.com/q.png');
  assert.equal(imgRes.success, true);
  assert.equal(sw2.fetchCalls.length, 1);
  assert.ok(sw2.fetchCalls[0].opts.signal instanceof AbortSignal);
  assert.equal(sw2.fetchCalls[0].opts.redirect, 'error');

  // handleRuntimeMessage works via async/await
  const keepAliveRes = await new Promise((resolve) => {
    const isAsync = sw2.bg.handleRuntimeMessage({ action: 'fetchImage', url: 'https://cdn.example.com/q2.png' }, {}, resolve);
    assert.equal(isAsync, true);
  });
  assert.equal(keepAliveRes.success, true);
});

test('highlight-manager.js: batches > 15 questions with rAF/scheduler.yield and cancels safely on clearAllHighlights', async () => {
  const { doc, FakeEl } = createDomSandbox();
  let rAFQueue = [];
  let yieldCalls = 0;

  const sandbox = {
    window: null,
    globalThis: null,
    document: doc,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise,
    parseInt, isNaN, setTimeout, clearTimeout,
    performance: { now: () => 0 },
    requestAnimationFrame: (cb) => {
      rAFQueue.push(cb);
      return rAFQueue.length;
    },
    scheduler: {
      yield: async () => { yieldCalls++; }
    },
    SafeExm: {
      DOMExtractor: { isElementVisible: () => true }
    },
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read('highlight-manager.js'), sandbox);
  const HM = sandbox.SafeExm.HighlightManager;

  function makeQuestions(count) {
    const qs = [];
    const ans = [];
    for (let i = 0; i < count; i++) {
      const qEl = new FakeEl('DIV');
      const lbl = new FakeEl('LABEL');
      const inp = new FakeEl('INPUT');
      inp.type = 'radio';
      lbl.appendChild(inp);
      qEl.appendChild(lbl);
      doc.body.appendChild(qEl);
      qs.push({
        index: i + 1,
        element: qEl,
        type: 'radio',
        options: [{ index: 0, element: inp, labelElement: lbl, text: `Opt ${i}` }]
      });
      ans.push({ questionIndex: i, optionIndices: [0], confidence: 95 });
    }
    return { qs, ans };
  }

  // 20 questions -> 15 highlighted first, then 5 after rAF + scheduler.yield
  const batch1 = makeQuestions(20);
  const applyPromise = HM.applyHighlights(batch1.qs, batch1.ans, { stealthLevel: 'furtif' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(HM.getActiveBadges().length, 15, 'First batch should apply 15 highlights before yielding');
  assert.equal(rAFQueue.length, 1);

  const cb1 = rAFQueue.shift();
  cb1();
  const status1 = await applyPromise;
  assert.equal(status1, 'OK');
  assert.equal(HM.getActiveBadges().length, 20);
  assert.equal(yieldCalls, 1);

  // Cancellation mid-batch via clearAllHighlights()
  const batch2 = makeQuestions(20);
  const cancelPromise = HM.applyHighlights(batch2.qs, batch2.ans, { stealthLevel: 'furtif' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(HM.getActiveBadges().length, 15);
  HM.clearAllHighlights();
  const cb2 = rAFQueue.shift();
  cb2();
  const status2 = await cancelPromise;
  assert.equal(status2, 'CANCELLED');
  assert.equal(HM.getActiveBadges().length, 0);

  // Background tab guard: when document.hidden === true and rAF is paused, applyHighlights does not hang
  doc.hidden = true;
  const batchHidden = makeQuestions(20);
  const hiddenStatus = await HM.applyHighlights(batchHidden.qs, batchHidden.ans, { stealthLevel: 'furtif' });
  assert.equal(hiddenStatus, 'OK');
  assert.equal(HM.getActiveBadges().length, 20);
  doc.hidden = false;

  // Switching tab while awaiting rAF settles via visibilitychange without hanging
  const batchSwitch = makeQuestions(20);
  const switchPromise = HM.applyHighlights(batchSwitch.qs, batchSwitch.ans, { stealthLevel: 'furtif' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(HM.getActiveBadges().length, 15);
  doc.hidden = true;
  doc.dispatchEvent({ type: 'visibilitychange' });
  const switchStatus = await switchPromise;
  assert.equal(switchStatus, 'OK');
  assert.equal(HM.getActiveBadges().length, 20);
  doc.hidden = false;
});

test('highlight-manager.js: applyHighlights runs setupHighlightObservers() after NEEDS_HEAL repairDeadNodes()', async () => {
  const { doc, FakeEl } = createDomSandbox();
  let moCount = 0;
  let ioCount = 0;

  const deadQ = new FakeEl('DIV');
  deadQ.isConnected = false;
  const deadInp = new FakeEl('INPUT');
  deadInp.type = 'radio';
  deadInp.isConnected = false;
  const deadLbl = new FakeEl('LABEL');
  deadLbl.appendChild(deadInp);
  deadQ.appendChild(deadLbl);

  const liveQ = new FakeEl('DIV');
  liveQ.isConnected = true;
  const liveInp = new FakeEl('INPUT');
  liveInp.type = 'radio';
  liveInp.isConnected = true;
  const liveLbl = new FakeEl('LABEL');
  liveLbl.appendChild(liveInp);
  liveQ.appendChild(liveLbl);
  doc.body.appendChild(liveQ);

  class MockObserver {
    observe() {}
    disconnect() {}
  }

  const sandbox = {
    window: null,
    globalThis: null,
    document: doc,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise,
    parseInt, isNaN, setTimeout, clearTimeout,
    MutationObserver: class extends MockObserver { constructor() { super(); moCount++; } },
    IntersectionObserver: class extends MockObserver { constructor() { super(); ioCount++; } },
    SafeExm: {
      DOMExtractor: {
        isElementVisible: () => true,
        extractQuizData: async () => ({
          questions: [{ index: 1, element: liveQ, type: 'radio', text: 'Q1', options: [{ index: 0, element: liveInp, labelElement: liveLbl, text: 'A' }] }]
        })
      }
    },
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read('highlight-manager.js'), sandbox);

  const status = await sandbox.SafeExm.HighlightManager.applyHighlights(
    [{ index: 1, element: deadQ, type: 'radio', text: 'Q1', options: [{ index: 0, element: deadInp, labelElement: deadLbl, text: 'A' }] }],
    [{ questionIndex: 0, optionIndices: [0], confidence: 95 }],
    { stealthLevel: 'furtif' }
  );
  assert.equal(status, 'NEEDS_HEAL');
  assert.ok(moCount >= 1, 'MutationObserver must be initialized after NEEDS_HEAL recovery');
  assert.ok(ioCount >= 1, 'IntersectionObserver must be initialized after NEEDS_HEAL recovery');
});

test('settings.js: priorityList preserves user reorder even when zero providers are configured', async () => {
  const { doc, FakeEl } = createDomSandbox();
  for (const id of SETTINGS_FIXTURE_ELEMENT_IDS) {
    const tag = id === 'discretionSlider' || id === 'fileInput' ? 'INPUT' : 'DIV';
    const el = new FakeEl(tag);
    el.id = id;
    el._ownerDoc = doc;
    doc.body.appendChild(el);
  }
  const sandbox = {
    document: doc,
    window: null,
    globalThis: null,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Date, Math, JSON, Promise, Set, Map, Array, Object, Number, String, Boolean, URL,
    setTimeout, clearTimeout, parseInt, parseFloat, isNaN,
    QuizProviders: {
      PROVIDERS: {
        groq: { name: 'Groq', apiKeyField: 'groqApiKey', defaultTextModel: 'm1' },
        gemini: { name: 'Gemini', apiKeyField: 'geminiApiKey', defaultTextModel: 'm2' },
        mistral: { name: 'Mistral', apiKeyField: 'mistralApiKey', defaultTextModel: 'm3' }
      },
      DEFAULT_PRIORITY: ['groq', 'gemini', 'mistral'],
      getAllStorageKeys: () => ['groqApiKey', 'geminiApiKey', 'mistralApiKey', 'providerConfigs'],
      isProviderConfigured: () => false
    },
    chrome: {
      storage: {
        sync: { get: async () => ({ providerOrder: ['groq', 'gemini', 'mistral'] }), set: async () => {} },
        local: { get: async () => ({}), set: async () => {}, remove: async () => {} }
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read('settings.js'), sandbox);
  for (const fn of doc._listeners.DOMContentLoaded || []) await fn();

  const pList = doc.getElementById('priorityList');
  assert.deepEqual(pList.children.map((c) => c.dataset.id), ['groq', 'gemini', 'mistral']);
  assert.equal(sandbox.SafeExmSettings.movePriorityProvider('gemini', -1, { focusDir: 'up' }), true);
  assert.deepEqual(pList.children.map((c) => c.dataset.id), ['gemini', 'groq', 'mistral']);
});

test('content.js: Panic/clearHighlights mid-batch aborts handleAnalyzeQuiz cleanly without auto-submit, delta poisoning, or 100% progress', async () => {
  const { doc, FakeEl } = createDomSandbox();
  let rAFQueue = [];
  let messageListener = null;
  const progressMessages = [];
  let clickedCount = 0;

  const questions = [];
  const answers = [];
  for (let i = 0; i < 20; i++) {
    const qEl = new FakeEl('DIV');
    const lbl = new FakeEl('LABEL');
    const inp = new FakeEl('INPUT');
    inp.type = 'radio';
    inp.click = () => { clickedCount++; inp.checked = true; };
    lbl.appendChild(inp);
    qEl.appendChild(lbl);
    doc.body.appendChild(qEl);
    questions.push({
      index: i + 1,
      element: qEl,
      text: `Panic guard Q${i + 1}`,
      type: 'radio',
      questionType: 'single_choice',
      options: [{ index: 0, element: inp, labelElement: lbl, text: 'Opt A' }]
    });
    answers.push({ questionIndex: i, optionIndices: [0], confidence: 98 });
  }

  const portHandlers = { message: [] };
  const sandbox = {
    window: null,
    globalThis: null,
    document: doc,
    location: { hostname: 'quiz.example.com', href: 'https://quiz.example.com/q' },
    console: { log: () => {}, warn: () => {}, error: () => {}, group: () => {}, groupEnd: () => {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise, Error,
    parseInt, parseFloat, isNaN, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => 0 },
    requestAnimationFrame: (cb) => {
      rAFQueue.push(cb);
      return rAFQueue.length;
    },
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    ConfigCache: {
      isInitialized: () => true,
      getAll: () => ({ enabled: true, autoMode: false }),
      get: (k) => (k === 'enabled' ? true : undefined)
    },
    SchemaCache: { getCachedSchema: async () => null, saveCachedSchema: async () => {} },
    SchemaDetector: { extractSkeleton: () => ({ nodeCount: 1, text: 'q' }) },
    chrome: {
      storage: {
        sync: { get: async () => ({ enabled: true }) },
        local: { get: async () => ({ autoSubmitEnabled: true, autoSubmitMinConfidence: 50, autoSubmitDelayMs: 50 }) },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        onMessage: { addListener: (fn) => { messageListener = fn; } },
        sendMessage: async (msg) => {
          if (msg && msg.action === 'analysisProgress') progressMessages.push(msg.percent);
          return { success: true };
        },
        connect: () => ({
          onMessage: { addListener: (fn) => portHandlers.message.push(fn) },
          onDisconnect: { addListener: () => {} },
          disconnect: () => {},
          postMessage: () => {
            queueMicrotask(() => {
              for (const fn of portHandlers.message) {
                fn({
                  success: true,
                  answers,
                  metadata: { questionsTotal: 20, answersFound: 20, provider: 'groq', totalDurationMs: 10 }
                });
              }
            });
          }
        })
      }
    },
    SafeExm: {
      DOMExtractor: {
        QUIZ_SELECTORS: { quizContainer: ['.quiz'] },
        isElementVisible: () => true,
        extractQuizData: async () => ({ questions, totalImages: 0 })
      }
    },
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read('highlight-manager.js'), sandbox);
  vm.runInNewContext(read('content.js'), sandbox);

  const analyzePromise = sandbox.SafeExm.Content.handleAnalyzeQuiz({
    enabled: true,
    autoSubmitEnabled: true,
    autoSubmitMinConfidence: 50,
    autoSubmitDelayMs: 50
  });

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(rAFQueue.length, 1, 'Batch 1 should pause on rAF before batch 2');
  assert.equal(sandbox.SafeExm.HighlightManager.getActiveBadges().length, 15);

  // Trigger Panic / clearHighlights mid-batch
  messageListener({ action: 'clearHighlights' }, {}, () => {});
  const cb = rAFQueue.shift();
  cb();

  const res = await analyzePromise;
  assert.equal(res.success, false);
  assert.equal(res.cancelled, true);

  // Wait past autoSubmitDelayMs to confirm zero delayed clicks fire
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(clickedCount, 0, 'Cancelled analysis must never schedule or trigger auto-submit clicks');
  assert.equal(sandbox.SafeExm.Content.getAnalyzedQuestionTexts().size, 0, 'Cancelled analysis must not pollute _analyzedQuestionTexts');
  assert.equal(sandbox.SafeExm.HighlightManager.getActiveBadges().length, 0);
  assert.equal(progressMessages.includes(100), false, 'Cancelled analysis must not emit 100% progress');
});

test('content.js: ConfigCache.onChange and pre-LLM await cancellation abort before solveQuiz port or discoverSchema', async () => {
  const { doc, FakeEl } = createDomSandbox();
  let onChangeCb = null;
  let delayedDeliverPort = null;
  let portDisconnects = 0;
  let portCalls = 0;
  let discoverCalls = 0;
  const progressMessages = [];
  let resolveExtract = null;

  const qEl = new FakeEl('DIV');
  const lbl = new FakeEl('LABEL');
  const inp = new FakeEl('INPUT');
  inp.type = 'radio';
  lbl.appendChild(inp);
  qEl.appendChild(lbl);
  doc.body.appendChild(qEl);

  let extractMode = 'immediate';
  const portHandlers = { message: [] };
  const sandbox = {
    window: null,
    globalThis: null,
    document: doc,
    location: { hostname: 'quiz.example.com', href: 'https://quiz.example.com/q' },
    console: { log: () => {}, warn: () => {}, error: () => {}, group: () => {}, groupEnd: () => {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise, Error,
    parseInt, parseFloat, isNaN, setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    ConfigCache: {
      isInitialized: () => true,
      onChange: (fn) => { onChangeCb = fn; },
      getAll: () => ({ enabled: true, autoMode: false }),
      get: (k) => (k === 'enabled' ? true : undefined)
    },
    SchemaCache: { getCachedSchema: async () => null, saveCachedSchema: async () => {} },
    SchemaDetector: {
      extractSkeleton: () => ({ nodeCount: 1, text: 'q' }),
      hasInteractiveContent: () => true,
      discoverSchema: async () => { discoverCalls++; return null; }
    },
    chrome: {
      storage: {
        sync: { get: async () => ({ enabled: true }) },
        local: { get: async () => ({}) },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: async (msg) => {
          if (msg && msg.action === 'analysisProgress') progressMessages.push(msg.percent);
          return { success: true };
        },
        connect: () => {
          portCalls++;
          return {
            onMessage: { addListener: (fn) => portHandlers.message.push(fn) },
            onDisconnect: { addListener: () => {} },
            disconnect: () => { portDisconnects++; },
            postMessage: () => {
              delayedDeliverPort = () => {
                for (const fn of portHandlers.message) {
                  fn({
                    success: true,
                    answers: [{ questionIndex: 0, optionIndices: [0], confidence: 95 }],
                    metadata: { questionsTotal: 1, answersFound: 1, provider: 'groq', totalDurationMs: 15 }
                  });
                }
              };
            }
          };
        }
      }
    },
    SafeExm: {
      DOMExtractor: {
        QUIZ_SELECTORS: { quizContainer: ['.quiz'] },
        isElementVisible: () => true,
        extractQuizData: async () => {
          if (extractMode === 'deferred') {
            return new Promise((resolve) => { resolveExtract = resolve; });
          }
          return {
            questions: [{
              index: 1,
              element: qEl,
              text: 'Storage disable Q1',
              type: 'radio',
              questionType: 'single_choice',
              options: [{ index: 0, element: inp, labelElement: lbl, text: 'Opt A' }]
            }],
            totalImages: 0
          };
        }
      }
    },
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read('highlight-manager.js'), sandbox);
  vm.runInNewContext(read('content.js'), sandbox);

  // Case 1: Disabled while solveQuiz port is in-flight -> disconnects port immediately
  const analyzePromise = sandbox.SafeExm.Content.handleAnalyzeQuiz({ enabled: true });
  await new Promise((r) => setTimeout(r, 15));
  assert.ok(delayedDeliverPort, 'solveQuiz port request should be in-flight');
  assert.ok(onChangeCb, 'ConfigCache.onChange listener should be registered');

  onChangeCb({ enabled: { oldValue: true, newValue: false } });
  const res = await analyzePromise;
  assert.equal(res.success, false);
  assert.equal(res.cancelled, true);
  assert.equal(portDisconnects, 1, 'Pending solveQuiz port must disconnect immediately on disable');
  assert.equal(sandbox.SafeExm.HighlightManager.getActiveBadges().length, 0);
  assert.equal(sandbox.SafeExm.Content.getAnalyzedQuestionTexts().size, 0);
  assert.equal(progressMessages.includes(100), false);

  // Case 2: Cancelled while awaiting DOMExtractor.extractQuizData() -> never opens port or discovers schema
  portCalls = 0;
  discoverCalls = 0;
  extractMode = 'deferred';
  onChangeCb({ enabled: { oldValue: false, newValue: true } });
  const preLlmPromise = sandbox.SafeExm.Content.handleAnalyzeQuiz({ enabled: true }, true);
  await new Promise((r) => setTimeout(r, 15));
  assert.ok(resolveExtract, 'extractQuizData should be awaiting resolution');
  onChangeCb({ enabled: { oldValue: true, newValue: false } });
  resolveExtract({ questions: [], totalImages: 0 });
  const preLlmRes = await preLlmPromise;
  assert.equal(preLlmRes.success, false);
  assert.equal(preLlmRes.cancelled, true);
  assert.equal(portCalls, 0, 'Pre-LLM cancellation must never invoke solveQuiz port');
  assert.equal(discoverCalls, 0, 'Pre-LLM cancellation must never invoke SchemaDetector.discoverSchema');
});

test('content.js: pending Auto Mode debounce timer is cleared and ignored when extension is disabled', async () => {
  const { doc, FakeEl } = createDomSandbox();
  let onChangeCb = null;
  let moCallback = null;
  let scheduledAutoFn = null;
  let scheduledTimerId = 0;
  let clearedTimerIds = [];
  let portCalls = 0;

  const qEl = new FakeEl('DIV');
  qEl.className = 'quiz';
  doc.body.appendChild(qEl);
  doc.body.innerText = 'Quiz question text long enough '.repeat(3);

  const sandbox = {
    window: null,
    globalThis: null,
    document: doc,
    location: { hostname: 'quiz.example.com', href: 'https://quiz.example.com/q' },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    WeakMap, WeakSet, Set, Map, Array, Object, String, Number, Boolean, Math, Date, RegExp, Promise, Error,
    parseInt, parseFloat, isNaN,
    setTimeout: (fn, delay) => {
      const id = ++scheduledTimerId;
      if (delay === 3000) scheduledAutoFn = fn;
      return id;
    },
    clearTimeout: (id) => clearedTimerIds.push(id),
    setInterval, clearInterval,
    MutationObserver: class {
      constructor(cb) { moCallback = cb; }
      observe() {}
      disconnect() {}
    },
    IntersectionObserver: class { observe() {} disconnect() {} },
    ConfigCache: {
      isInitialized: () => true,
      onChange: (fn) => { onChangeCb = fn; },
      getAll: () => ({ enabled: true, autoMode: true }),
      get: (k) => (k === 'enabled' || k === 'autoMode' ? true : undefined)
    },
    SchemaCache: { getCachedSchema: async () => null, saveCachedSchema: async () => {} },
    SchemaDetector: { extractSkeleton: () => ({ nodeCount: 1, text: 'q' }) },
    chrome: {
      storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) }, onChanged: { addListener: () => {} } },
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: async () => ({ success: true }),
        connect: () => {
          portCalls++;
          return {
            onMessage: { addListener: () => {} },
            onDisconnect: { addListener: () => {} },
            disconnect: () => {},
            postMessage: () => {}
          };
        }
      }
    },
    SafeExm: {
      DOMExtractor: {
        QUIZ_SELECTORS: { quizContainer: ['.quiz'] },
        isElementVisible: () => true,
        extractQuizData: async () => ({
          questions: [{ index: 1, element: qEl, text: 'Auto Q1', type: 'radio', options: [] }],
          totalImages: 0
        })
      }
    },
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read('highlight-manager.js'), sandbox);
  vm.runInNewContext(read('content.js'), sandbox);

  assert.ok(moCallback, 'Auto Mode MutationObserver callback must be registered');
  assert.ok(onChangeCb, 'ConfigCache.onChange must be registered');

  // Schedule 3000ms debounce timer on mutation
  moCallback([{ type: 'childList' }]);
  assert.ok(scheduledAutoFn, 'Auto Mode should schedule 3000ms debounce timer');
  assert.equal(clearedTimerIds.includes(scheduledTimerId), false);

  // Disable extension before 3000ms fires -> must clear debounce timer AND block stale callback
  onChangeCb({ enabled: { oldValue: true, newValue: false } });
  assert.ok(clearedTimerIds.includes(scheduledTimerId), 'Disabling extension must clear _autoModeDebounceTimer');

  await scheduledAutoFn();
  assert.equal(portCalls, 0, 'Even if stale timer callback runs, Auto Mode must never execute while disabled');

  // Direct isAuto=true call while disabled also returns cancelled
  const directAutoRes = await sandbox.SafeExm.Content.handleAnalyzeQuiz({ enabled: false }, true, true);
  assert.equal(directAutoRes.success, false);
  assert.equal(directAutoRes.cancelled, true);
  assert.equal(portCalls, 0);
});

test('Static HTML/CSS/Manifest Modern Web Guidance invariants', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.permissions.includes('activeTab'), false, 'activeTab is redundant with tabs + <all_urls>');

  const popupHtml = read('popup.html');
  const settingsHtml = read('settings.html');
  for (const [name, html] of [['popup.html', popupHtml], ['settings.html', settingsHtml]]) {
    assert.match(html, /<meta name="color-scheme" content="light dark">/, `${name} needs color-scheme meta`);
    assert.match(html, /<script src="theme-init\.js"><\/script>/, `${name} needs synchronous theme-init.js`);
    assert.equal(/<summary\b[^>]*>(?:(?!<\/summary>)[\s\S])*?<button/i.test(html), false, `${name} must not nest <button> inside <summary>`);
  }
  assert.match(popupHtml, /<progress\b[^>]*id="progressBarFill"/, 'popup.html must use native <progress>');
  assert.match(settingsHtml, /<search\b[^>]*class="providers-toolbar"/, 'settings.html must wrap provider filter in <search>');
  assert.match(settingsHtml, /<dialog\b[^>]*id="resetConfirmDialog"/, 'settings.html must define native <dialog>');
  assert.match(settingsHtml, /for="fileInput"/, 'settings.html must bind Fichiers joints label');
  assert.match(settingsHtml, /id="discretionSlider"[^>]*aria-label=/, 'settings.html discretionSlider needs aria-label');
  assert.match(settingsHtml, /id="tab-providers"[^>]*hidden="until-found"/, 'inactive panels need hidden="until-found"');

  for (const cssFile of ['popup.css', 'settings.css']) {
    const css = read(cssFile);
    assert.match(css, /color-scheme:\s*light dark/, `${cssFile} needs color-scheme: light dark`);
    assert.match(css, /@media \(prefers-reduced-motion:\s*no-preference\)/, `${cssFile} needs reduced-motion query`);
    assert.match(css, /@media \(forced-colors:\s*active\)/, `${cssFile} needs forced-colors support`);
    assert.match(css, /scrollbar-color:/, `${cssFile} needs standard scrollbar-color`);
    assert.match(css, /@supports not \(scrollbar-color:\s*auto\)/, `${cssFile} needs @supports guard on ::-webkit-scrollbar`);
    assert.equal(/transition:[^;]*\ball\b/.test(css), false, `${cssFile} must not use transition: all`);
    assert.equal(/font-size:\s*[0-9.]+px/.test(css), false, `${cssFile} must use rem instead of px for font-size`);
    assert.equal(/outline:\s*none/.test(css), false, `${cssFile} must not use outline: none`);
    assert.equal(/text-decoration-skip-spaces/.test(css), false, `${cssFile} must not use volatile text-decoration-skip-spaces`);
    assert.match(css, /--success-color:\s*#166534;/, `${cssFile} light --success-color must pass 4.5:1 AA`);
    assert.match(css, /--warning-color:\s*#92400E;/, `${cssFile} light --warning-color must pass 4.5:1 AA`);
  }
  const popupCss = read('popup.css');
  const settingsCss = read('settings.css');
  assert.match(settingsCss, /\[aria-selected="true"\]::after/, 'settings.css active tab needs non-color indicator');
  assert.match(settingsCss, /--danger-hover-bg:\s*#B91C1C;/, 'settings.css danger hover needs accessible dark-mode background');
  assert.match(settingsCss, /\.settings-tabs\s*\{[^}]*padding:\s*4px 4px 10px;/s, '.settings-tabs needs padding around focus-visible outlines');
  assert.equal(/\.shortcuts-accordion,\s*\.stats-accordion\s*\{[^}]*overflow:\s*hidden/s.test(popupCss), false, 'popup accordions must not clip <summary>:focus-visible');
  assert.equal(/\.key-card\s*\{[^}]*overflow:\s*hidden/s.test(settingsCss), false, '.key-card must not clip <summary>:focus-visible');
  assert.match(popupCss, /--progress-track-fill:\s*var\(--n3-gradient-cta\);/, 'popup.css light progress fill must meet SC 1.4.11 3:1');
  assert.match(popupCss, /progress\.progress-bar\s*\{[^}]*border:\s*1px solid var\(--border-control\);/s, 'popup.css progress track must have >=3:1 border');
});
