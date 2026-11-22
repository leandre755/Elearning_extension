'use strict';
// Comprehensive Security & Stealth Test Suite (tests/security-stealth.test.js)
// Covers Wave 1 & Wave 2 Lot 6 security/stealth invariants and background.js handlers:
// 1. Stealth of page-bridge.js in MAIN world (zero own properties or Symbols on window/document, no <script>).
// 2. Manifest MV3 & shipped code stealth (system.md & page-bridge.js excluded from web_accessible_resources,
//    zero data-qh-*, zero wildcard postMessage, zero suppression comments, page-bridge not in injectCoreScripts).
// 3. handleInjectPageBridge security gates (https?: only, MAIN world, tabId validation, _bridgeInjectionsInProgress mutex).
// 4. handlePreWarmProviders, handleGetProviderStats, handleResetProviderStats & onMessage wiring + secret redaction.
// 5. Anti-SSRF (isBlockedImageHost, handleFetchImage redirect: 'error' & magic-byte MIME sniffing) & sanitizeUrlForLog.
// 6. Safe HTML extraction (nlp-cleaner.js / settings.js), DoS Retry-After clamping (providers.js), highlight-manager stealth.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TARGET_ROOT = process.env.TEST_TARGET_ROOT
  ? path.resolve(process.env.TEST_TARGET_ROOT)
  : path.resolve(__dirname, '..');

const ROOT = TARGET_ROOT;
const NLP_ROOT = process.env.NLP_ROOT ? path.resolve(process.env.NLP_ROOT) : TARGET_ROOT;
const DOM_ROOT = process.env.DOM_ROOT ? path.resolve(process.env.DOM_ROOT) : TARGET_ROOT;
const PROVIDERS_ROOT = process.env.PROVIDERS_ROOT ? path.resolve(process.env.PROVIDERS_ROOT) : TARGET_ROOT;
const AGENT_ROOT = process.env.AGENT_ROOT ? path.resolve(process.env.AGENT_ROOT) : TARGET_ROOT;

const SKIP_DIRS = new Set(['lib', 'graphify-out', 'node_modules', '.git', 'tests', 'Docs', 'icons']);

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        walk(path.join(dir, entry.name), exts, out);
      }
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function stripJsComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      out += ch;
      i++;
      while (i < src.length) {
        const c = src[i];
        out += c;
        if (c === '\\') {
          i++;
          if (i < src.length) out += src[i];
        } else if (c === q) {
          i++;
          break;
        }
        i++;
      }
    } else if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

test('Stealth: page-bridge.js leaves zero static global properties or Symbols on window/document and injects no <script>', () => {
  const bridgePath = path.join(DOM_ROOT, 'page-bridge.js');
  assert.ok(fs.existsSync(bridgePath), `page-bridge.js must exist at ${bridgePath}`);
  const src = fs.readFileSync(bridgePath, 'utf8');
  const clean = stripJsComments(src);

  // Must never create inline <script> elements or use wildcard postMessage
  assert.ok(!/createElement\s*\(\s*['"`]script['"`]\s*\)/i.test(clean), 'page-bridge.js must not inject <script> tags');
  assert.ok(!/\.postMessage\s*\([^)]*['"`]\*['"`]/.test(clean), 'page-bridge.js must not use wildcard postMessage');
  assert.ok(!/data-qh-/i.test(src), 'page-bridge.js must not contain data-qh-* attributes');

  // Execute in isolated VM simulating MAIN world window & document
  const doc = {
    nodeType: 9,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; }
  };
  const win = {
    document: doc,
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i?.detail; } },
    TextEncoder,
    URL
  };
  win.window = win;
  win.globalThis = win;
  const initialWindowKeys = new Set(Object.getOwnPropertyNames(win));
  const initialWindowSymbols = new Set(Object.getOwnPropertySymbols(win));
  const initialDocSymbols = new Set(Object.getOwnPropertySymbols(doc));

  vm.runInNewContext(src, win);

  const addedWindowKeys = Object.getOwnPropertyNames(win).filter((k) => !initialWindowKeys.has(k));
  const addedWindowSymbols = Object.getOwnPropertySymbols(win).filter((s) => !initialWindowSymbols.has(s));
  const addedDocSymbols = Object.getOwnPropertySymbols(doc).filter((s) => !initialDocSymbols.has(s));
  assert.deepEqual(addedWindowKeys, [], 'page-bridge.js must not add any own property to window');
  assert.deepEqual(addedWindowSymbols, [], 'page-bridge.js must not add any Symbol to window');
  assert.deepEqual(addedDocSymbols, [], 'page-bridge.js must not add any Symbol to document');
  assert.deepEqual(Object.getOwnPropertyNames(doc).filter((k) => /safe|exm|qh|quiz|bridge/i.test(k)), []);
});

test('Stealth & Manifest: MV3, system.md & page-bridge.js excluded from web_accessible_resources, no auto MAIN injection', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(TARGET_ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  const war = JSON.stringify(manifest.web_accessible_resources || []);
  assert.ok(!/system\.md/i.test(war), 'system.md must be excluded from web_accessible_resources');
  assert.ok(!/page-bridge\.js/i.test(war), 'page-bridge.js must be excluded from web_accessible_resources');
  const csp = JSON.stringify(manifest.content_security_policy || {});
  assert.ok(!/unsafe-eval|unsafe-inline/i.test(csp), 'CSP must not allow unsafe-eval or unsafe-inline');

  // Verify injectCoreScripts in background.js does NOT auto-inject page-bridge.js
  const bgClean = stripJsComments(fs.readFileSync(path.join(TARGET_ROOT, 'background.js'), 'utf8'));
  const startIdx = bgClean.indexOf('async function injectCoreScripts');
  const endIdx = bgClean.indexOf('async function analyzeCurrentQuiz');
  assert.ok(startIdx >= 0 && endIdx > startIdx, 'injectCoreScripts block must exist in background.js');
  const injectCoreBody = bgClean.slice(startIdx, endIdx);
  assert.ok(!/page-bridge\.js/.test(injectCoreBody), 'injectCoreScripts must not auto-inject page-bridge.js');
});

test('Stealth & Security: no wildcard postMessage, no data-qh-*, no suppression comments across shipped files', () => {
  const roots = [...new Set([ROOT, NLP_ROOT, DOM_ROOT, PROVIDERS_ROOT, AGENT_ROOT])];
  const wildcardOffenders = [];
  const dataQhOffenders = [];
  const suppressionOffenders = [];
  const suppressionRe = new RegExp(
    '\\b(' + ['eslint-' + 'disable', 'no' + 'semgrep', '@ts-' + 'ignore', '@ts-' + 'nocheck'].join('|') + ')\\b'
  );

  for (const r of roots) {
    for (const f of walk(r, ['.js', '.html', '.css'])) {
      const raw = fs.readFileSync(f, 'utf8');
      const rel = path.relative(r, f);
      if (/data-qh-/.test(raw)) dataQhOffenders.push(`${r}:${rel}`);
      if (suppressionRe.test(raw)) {
        suppressionOffenders.push(`${r}:${rel}`);
      }
      if (f.endsWith('.js')) {
        const clean = stripJsComments(raw);
        if (/\.postMessage\s*\([\s\S]*?,\s*['"`]\*['"`]\s*\)/.test(clean)) {
          wildcardOffenders.push(`${r}:${rel}`);
        }
      }
    }
  }

  assert.deepEqual(dataQhOffenders, [], 'zero data-qh-* allowed');
  assert.deepEqual(wildcardOffenders, [], 'zero wildcard postMessage allowed');
  assert.deepEqual(suppressionOffenders, [], 'zero linter/semgrep suppression comments allowed');
});

test('background.js: handleInjectPageBridge enforces https?: gate, MAIN world target, tabId validation, and per-tab mutex', async () => {
  const origChrome = globalThis.chrome;
  const executeCalls = [];
  let resolveGate = null;

  try {
    globalThis.chrome = {
      scripting: {
        executeScript: async (opts) => {
          executeCalls.push(opts);
          if (resolveGate) {
            await new Promise((r) => { resolveGate = r; });
          }
          return [{ result: true }];
        }
      },
      tabs: {
        get: async (tabId) => {
          if (tabId === 77) return { id: 77, url: 'https://quiz.example.com/from-tabs-get' };
          if (tabId === 88) return { id: 88, url: 'chrome://settings' };
          return { id: tabId, url: '' };
        },
        onRemoved: { addListener() {} }
      },
      runtime: { onMessage: { addListener() {} }, onConnect: { addListener() {} }, onInstalled: { addListener() {} } },
      commands: { onCommand: { addListener() {} } },
      contextMenus: { onClicked: { addListener() {} } }
    };

    const bg = require(path.join(TARGET_ROOT, 'background.js'));
    assert.equal(typeof bg.handleInjectPageBridge, 'function');
    assert.ok(bg._bridgeInjectionsInProgress instanceof Map);

    // 1. Allows https://quiz.example.com/test -> world: 'MAIN', files: ['page-bridge.js']
    const okRes = await bg.handleInjectPageBridge({}, { tab: { id: 10, url: 'https://quiz.example.com/test' } });
    assert.equal(okRes.success, true);
    assert.equal(executeCalls.length, 1);
    assert.deepEqual(executeCalls[0], {
      target: { tabId: 10 },
      files: ['page-bridge.js'],
      world: 'MAIN'
    });

    // 2. Fallback to chrome.tabs.get(tabId) when sender.tab.url is absent
    const fallbackOk = await bg.handleInjectPageBridge({ tabId: 77 }, {});
    assert.equal(fallbackOk.success, true);
    assert.equal(executeCalls.length, 2);
    assert.deepEqual(executeCalls[1], {
      target: { tabId: 77 },
      files: ['page-bridge.js'],
      world: 'MAIN'
    });

    const fallbackBlocked = await bg.handleInjectPageBridge({ tabId: 88 }, {});
    assert.deepEqual(fallbackBlocked, { success: false, error: 'URL non autorisée pour page-bridge' });
    assert.equal(executeCalls.length, 2);

    // 3. Rejects forbidden schemes and empty URLs
    const forbiddenUrls = [
      'chrome://extensions',
      'file:///etc/passwd',
      'about:blank',
      'chrome-extension://abcdefghijklmnop/popup.html',
      'edge://settings',
      'javascript:alert(1)',
      'data:text/html,<h1>quiz</h1>',
      ''
    ];
    for (const badUrl of forbiddenUrls) {
      const res = await bg.handleInjectPageBridge({}, { tab: { id: 15, url: badUrl } });
      assert.deepEqual(res, { success: false, error: 'URL non autorisée pour page-bridge' }, `must reject URL: ${badUrl}`);
    }
    assert.equal(executeCalls.length, 2, 'zero executeScript calls for rejected URLs');

    // 4. Rejects missing or non-positive-integer tabId
    for (const badTabId of [undefined, null, 0, -1, 3.14, '10', NaN]) {
      const res = await bg.handleInjectPageBridge({ tabId: badTabId }, { tab: { id: badTabId, url: 'https://quiz.example.com/test' } });
      assert.equal(res.success, false, `must reject invalid tabId: ${String(badTabId)}`);
    }
    assert.equal(executeCalls.length, 2, 'zero executeScript calls for invalid tabIds');

    // 5. Deduplicates concurrent calls for the same tabId via _bridgeInjectionsInProgress
    let releasePromise;
    globalThis.chrome.scripting.executeScript = async (opts) => {
      executeCalls.push(opts);
      await new Promise((r) => { releasePromise = r; });
      return [{ result: true }];
    };

    const sender42 = { tab: { id: 42, url: 'https://quiz.example.com/concurrent' } };
    const p1 = bg.handleInjectPageBridge({}, sender42);
    const p2 = bg.handleInjectPageBridge({}, sender42);
    assert.equal(bg._bridgeInjectionsInProgress.has(42), true, 'mutex must track in-flight tabId');
    assert.equal(executeCalls.length, 3, 'concurrent calls for same tabId must share single executeScript');

    releasePromise();
    const [res1, res2] = await Promise.all([p1, p2]);
    assert.deepEqual(res1, { success: true });
    assert.deepEqual(res2, { success: true });
    assert.equal(bg._bridgeInjectionsInProgress.has(42), false, 'mutex must clean up in finally');

    // Verify handleTabRemoved cleans up _bridgeInjectionsInProgress
    bg._bridgeInjectionsInProgress.set(99, Promise.resolve({ success: true }));
    bg.handleTabRemoved(99);
    assert.equal(bg._bridgeInjectionsInProgress.has(99), false);
  } finally {
    if (origChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = origChrome;
  }
});

test('background.js: handlePreWarmProviders, handleGetProviderStats, and handleResetProviderStats work end-to-end and never leak API keys', async () => {
  const origChrome = globalThis.chrome;
  const origFetch = globalThis.fetch;
  const fakeGroqKey = ['gsk_', 'superSecretGroqKey', '1234567890'].join('');
  const fakeGeminiKey = ['AIza', 'SySecretGeminiKey', '1234567890'].join('');
  const fakeCustomSecret = ['myCustom', 'ProviderSecret', '987654'].join('');

  const store = {
    providerOrder: ['gemini', 'groq'],
    groqApiKey: fakeGroqKey,
    geminiApiKey: fakeGeminiKey,
    mistralApiKey: fakeCustomSecret
  };

  try {
    globalThis.fetch = async () => {
      throw new Error('Default pre-warm must not perform network fetch');
    };

    globalThis.chrome = {
      storage: {
        sync: {
          get: async (keys) => {
            const out = {};
            for (const k of (Array.isArray(keys) ? keys : Object.keys(store))) {
              if (store[k] !== undefined) out[k] = store[k];
            }
            return out;
          }
        },
        local: {
          get: async (keys) => {
            if (typeof keys === 'string') {
              return store[keys] !== undefined ? { [keys]: store[keys] } : {};
            }
            const out = {};
            for (const k of (Array.isArray(keys) ? keys : Object.keys(store))) {
              if (store[k] !== undefined) out[k] = store[k];
            }
            return out;
          },
          set: async (obj) => {
            Object.assign(store, JSON.parse(JSON.stringify(obj)));
          }
        }
      },
      tabs: { onRemoved: { addListener() {} } },
      runtime: { onMessage: { addListener() {} }, onConnect: { addListener() {} }, onInstalled: { addListener() {} } },
      commands: { onCommand: { addListener() {} } },
      contextMenus: { onClicked: { addListener() {} } }
    };

    const bg = require(path.join(TARGET_ROOT, 'background.js'));
    const { QuizProviders, ProviderAnalytics } = require(path.join(PROVIDERS_ROOT, 'providers.js'));

    // 1. End-to-end preWarmProviders
    const warmRes = await bg.handlePreWarmProviders({ options: { force: true } });
    assert.equal(warmRes.success, true);
    assert.equal(warmRes.warmed, true);
    assert.deepEqual(warmRes.providersReady, ['gemini', 'groq', 'mistral']);

    // Also test via handleRuntimeMessage ('preWarmProviders')
    const msgWarmRes = await new Promise((resolve) => {
      const isAsync = bg.handleRuntimeMessage({ action: 'preWarmProviders', options: { force: true } }, {}, resolve);
      assert.equal(isAsync, true);
    });
    assert.equal(msgWarmRes.success, true);
    assert.deepEqual(msgWarmRes.providersReady, ['gemini', 'groq', 'mistral']);

    // 2. Secret redaction on preWarmProviders failure (both response and console.error)
    const origPreWarm = QuizProviders.preWarmProviders;
    const origConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...args) => {
      loggedErrors.push(args.map(String).join(' '));
    };

    try {
      QuizProviders.preWarmProviders = async () => {
        throw new Error(
          `Sync failed at https://generativelanguage.googleapis.com/v1beta/models?key=${fakeGeminiKey}&token=${fakeCustomSecret} with Bearer ${fakeGroqKey} and key=${fakeCustomSecret}`
        );
      };

      const errRes = await bg.handlePreWarmProviders({ options: { force: true } });
      assert.equal(errRes.success, false);
      assert.ok(!errRes.error.includes(fakeGeminiKey), `Gemini key leaked in error response: ${errRes.error}`);
      assert.ok(!errRes.error.includes(fakeGroqKey), `Groq key leaked in error response: ${errRes.error}`);
      assert.ok(!errRes.error.includes(fakeCustomSecret), `Custom key leaked in error response: ${errRes.error}`);

      const combinedLogs = loggedErrors.join('\n');
      assert.ok(!combinedLogs.includes(fakeGeminiKey), `Gemini key leaked in console.error: ${combinedLogs}`);
      assert.ok(!combinedLogs.includes(fakeGroqKey), `Groq key leaked in console.error: ${combinedLogs}`);
      assert.ok(!combinedLogs.includes(fakeCustomSecret), `Custom key leaked in console.error: ${combinedLogs}`);
    } finally {
      QuizProviders.preWarmProviders = origPreWarm;
      console.error = origConsoleError;
    }

    // 3. End-to-end getProviderStats & resetProviderStats
    await bg.handleResetProviderStats();
    ProviderAnalytics.record({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      ok: true,
      latencyMs: 120,
      status: 200
    });
    ProviderAnalytics.record({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      ok: false,
      latencyMs: 240,
      status: 401,
      error: new Error(`Invalid key https://generativelanguage.googleapis.com/v1beta?key=${fakeGeminiKey} Bearer ${fakeGroqKey}`)
    });

    const statsRes = await bg.handleGetProviderStats();
    assert.equal(statsRes.success, true);
    assert.equal(statsRes.stats.totals.requests, 2);
    assert.equal(statsRes.stats.totals.successes, 1);
    assert.equal(statsRes.stats.totals.failures, 1);
    const recordedErr = statsRes.stats.providers.gemini.lastError;
    assert.ok(!recordedErr.includes(fakeGeminiKey), 'Gemini key must not appear in ProviderAnalytics stats');
    assert.ok(!recordedErr.includes(fakeGroqKey), 'Groq key must not appear in ProviderAnalytics stats');

    const resetRes = await bg.handleResetProviderStats();
    assert.deepEqual(resetRes, { success: true });

    const afterReset = await bg.handleGetProviderStats();
    assert.equal(afterReset.success, true);
    assert.equal(afterReset.stats.totals.requests, 0);
    assert.deepEqual(afterReset.stats.providers, {});
  } finally {
    globalThis.fetch = origFetch;
    if (origChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = origChrome;
  }
});

test('Anti-SSRF & URL Sanitization: isBlockedImageHost, handleFetchImage, and sanitizeUrlForLog', async () => {
  const origFetch = globalThis.fetch;
  const bg = require(path.join(TARGET_ROOT, 'background.js'));

  try {
    // 1. isBlockedImageHost blocks private, loopback, IPv6, metadata, and local hosts
    const blockedHosts = [
      'localhost', 'a.localhost', 'service.local', 'db.internal', 'metadata', 'redis',
      '0.0.0.0', '10.0.0.1', '127.0.0.1', '127.0.0.2', '100.64.0.1', '169.254.169.254',
      '172.16.0.1', '172.31.255.255', '192.168.1.1', '224.0.0.1',
      '::1', '::', '[::1]', 'fe80::1', 'fc00::1', 'fd12:3456::1',
      '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1'
    ];
    for (const h of blockedHosts) {
      assert.equal(bg.isBlockedImageHost(h), true, `isBlockedImageHost must block ${h}`);
    }
    assert.equal(bg.isBlockedImageHost('cdn.example.com'), false);
    assert.equal(bg.isBlockedImageHost('1.1.1.1'), false);

    // 2. handleFetchImage blocks private hosts & non-http(s) protocols BEFORE calling fetch
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls++;
      throw new Error('fetch should not be called for blocked URLs');
    };

    const blockedImageUrls = [
      'file:///etc/passwd',
      'ftp://example.com/img.png',
      'http://127.0.0.1/secret.png',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/admin.png',
      'http://[::ffff:127.0.0.1]/x.png',
      'http://internal-host/x.png'
    ];
    for (const u of blockedImageUrls) {
      const res = await bg.handleFetchImage(u);
      assert.equal(res.success, false, `handleFetchImage must reject ${u}`);
    }
    assert.equal(fetchCalls, 0, 'fetch must never be invoked for SSRF-blocked URLs');

    // 3. handleFetchImage passes redirect: 'error' to fetch and rejects redirect / non-image responses
    let capturedFetchOptions = null;
    globalThis.fetch = async (_url, opts) => {
      capturedFetchOptions = opts;
      throw new TypeError('fetch failed: unexpected redirect');
    };
    const redirectRes = await bg.handleFetchImage('https://cdn.example.com/redirect.png');
    assert.equal(redirectRes.success, false);
    assert.equal(capturedFetchOptions?.redirect, 'error', "handleFetchImage must enforce redirect: 'error'");

    // Rejects HTML disguised as octet-stream
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      blob: async () => ({
        type: 'application/octet-stream',
        arrayBuffer: async () => new TextEncoder().encode('<html>not an image</html>').buffer
      })
    });
    const htmlRes = await bg.handleFetchImage('https://cdn.example.com/fake.png');
    assert.equal(htmlRes.success, false);

    // Accepts valid PNG magic bytes
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      blob: async () => ({
        type: 'application/octet-stream',
        arrayBuffer: async () => pngBytes.buffer
      })
    });
    const pngRes = await bg.handleFetchImage('https://cdn.example.com/valid.png');
    assert.equal(pngRes.success, true);
    assert.equal(pngRes.mimeType, 'image/png');
    assert.ok(pngRes.dataUrl.startsWith('data:image/png;base64,'));

    // 4. sanitizeUrlForLog redacts query secrets, credentials in URL, and hash fragments
    const rawSecret = ['TOP', 'SECRET', 'VAL999'].join('');
    for (const param of ['key', 'api_key', 'token', 'access_token', 'secret', 'auth', 'credential', 'password']) {
      const sanitized = bg.sanitizeUrlForLog(`https://api.example.com/v1/models?${param}=${rawSecret}&page=1`);
      assert.ok(!sanitized.includes(rawSecret), `sanitizeUrlForLog must redact ${param}`);
      assert.ok(sanitized.includes('page=1'), 'non-sensitive query parameter must remain intact');
    }
    const credsSanitized = bg.sanitizeUrlForLog(`https://admin:${rawSecret}@api.example.com/path#access_token=${rawSecret}`);
    assert.ok(!credsSanitized.includes('admin'), 'URL username must be redacted');
    assert.ok(!credsSanitized.includes(rawSecret), 'URL password and hash secret must be redacted');
    assert.equal(bg.sanitizeUrlForLog('not-a-valid-url'), '[invalid url]');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Security: safe HTML extraction in nlp-cleaner.js & settings.js neutralizes XSS payloads without innerHTML', () => {
  const NLPCleaner = require(path.join(NLP_ROOT, 'nlp-cleaner.js'));
  const settingsSrc = stripJsComments(fs.readFileSync(path.join(NLP_ROOT, 'settings.js'), 'utf8'));

  // Verify settings.js routes HTML files through NLPCleaner.extractTextFromHTML and does not assign file content to innerHTML
  assert.match(settingsSrc, /extractTextFromHTML/, 'settings.js must use extractTextFromHTML for .html/.htm imports');
  const innerHtmlInterpolations = (settingsSrc.match(/\.innerHTML\s*\+?=\s*`[^`]*\$\{/g) || []).length;
  assert.ok(innerHtmlInterpolations <= 4, `settings.js innerHTML interpolation count (${innerHtmlInterpolations}) exceeds baseline 4`);

  const xssPayloads = [
    '<script>globalThis.__xssExecuted = true;</script><p>Safe text 1</p>',
    '<img src="x" onerror="globalThis.__xssExecuted=true"><svg onload="alert(1)"><script>evil()</script></svg><div>Safe text 2</div>',
    '<style>@import "javascript:alert(1)";</style><template><script>alert(2)</script></template>Safe text 3'
  ].join('\n');

  const extracted = NLPCleaner.extractTextFromHTML(xssPayloads);
  const { text } = NLPCleaner.cleanText(extracted);

  assert.equal(Boolean(globalThis.__xssExecuted), false, 'XSS payload must never execute');
  assert.ok(!/<script|<img|<svg|onerror|onload|javascript:|evil\(\)|alert\(/i.test(text), `XSS artifacts remained in: ${text}`);
  assert.ok(text.includes('Safe text 1') && text.includes('Safe text 2') && text.includes('Safe text 3'));
});

test('Security & DoS bounds: providers.js clamps malicious Retry-After headers and aborts cleanly via AbortSignal', async () => {
  const { fetchWithRetry, ProviderAnalytics } = require(path.join(PROVIDERS_ROOT, 'providers.js'));

  // 1. Malicious server sends Retry-After: 999999999 (31 years) -> must clamp to maxDelayMs
  const observedDelays = [];
  let calls = 0;
  await fetchWithRetry(
    async () => {
      calls++;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? '999999999' : null) }
        };
      }
      return { ok: true, status: 200, headers: { get: () => null } };
    },
    {
      maxRetries: 2,
      maxDelayMs: 2500,
      sleep: async (ms) => observedDelays.push(ms)
    }
  );
  assert.deepEqual(observedDelays, [2500], 'Retry-After must be strictly clamped to maxDelayMs');

  // 2. ProviderAnalytics must redact API keys, Bearer tokens, and URLs from recorded errors
  const fakeGroqKey = ['gsk_', 'superSecretKey', '123456'].join('');
  const fakeJwt = ['secret', '_jwt_', 'token'].join('');
  await ProviderAnalytics.resetStats();
  ProviderAnalytics.record({
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    ok: false,
    latencyMs: 50,
    status: 401,
    error: new Error(`Auth failed for https://api.groq.com/openai/v1/chat?api_key=${fakeGroqKey} with Bearer ${fakeJwt}`)
  });
  const stats = ProviderAnalytics.getStats();
  const errStr = stats.providers.groq.lastError;
  assert.ok(!errStr.includes(fakeGroqKey), 'Groq API key must be redacted');
  assert.ok(!errStr.includes(fakeJwt), 'Bearer token must be redacted');
  assert.ok(!errStr.includes('https://api.groq.com'), 'URL must be redacted');
});

test('Stealth: highlight-manager.js uses WeakMap and randomized _styleTagId with document.head fallback (R-TECH-03)', () => {
  const hmSrc = stripJsComments(fs.readFileSync(path.join(ROOT, 'highlight-manager.js'), 'utf8'));
  assert.match(hmSrc, /new\s+WeakMap\s*\(\)/, 'highlight-manager.js must store DOM state in WeakMap');
  assert.match(hmSrc, /_styleTagId/, 'highlight-manager.js must use randomized _styleTagId');
  assert.match(hmSrc, /document\.head\s*\|\|\s*document\.documentElement/, 'R-TECH-03: must fallback to document.documentElement if document.head is null');
});
