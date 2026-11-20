'use strict';
// Behavioral & edge-case tests for providers.js (R-TECH-05, F-ANA-03, F-AUTO-02).
// Zero external dependencies — Node 26 node:test + node:assert/strict.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const TARGET_ROOT = process.env.TEST_TARGET_ROOT
  ? path.resolve(process.env.TEST_TARGET_ROOT)
  : path.resolve(__dirname, '..');

const {
  QuizProviders,
  ConfigCache,
  ModelRegistry,
  fetchWithRetry,
  ProviderAnalytics
} = require(path.join(TARGET_ROOT, 'providers.js'));

function makeResponse(status, body = {}, headers = {}) {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (headerMap.has(k.toLowerCase()) ? headerMap.get(k.toLowerCase()) : null) },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

// ===========================================================================
// R-TECH-05: fetchWithRetry
// ===========================================================================

test('R-TECH-05: exponential backoff (500ms, 1000ms, 2000ms) with deterministic sleep & jitter', async () => {
  const delays = [];
  let calls = 0;

  const res = await fetchWithRetry(
    async () => {
      calls++;
      if (calls <= 3) return makeResponse(503);
      return makeResponse(200, { ok: true });
    },
    {
      maxRetries: 3,
      baseDelayMs: 500,
      jitter: false,
      sleep: async (ms) => { delays.push(ms); }
    }
  );

  assert.equal(calls, 4);
  assert.equal(res.status, 200);
  assert.deepEqual(delays, [500, 1000, 2000]);

  // Bounded jitter verification (rand=0 -> 0.75x, rand=1 -> 1.0x)
  const jitterDelaysLow = [];
  let c2 = 0;
  await fetchWithRetry(
    async () => (++c2 <= 2 ? makeResponse(500) : makeResponse(200)),
    { maxRetries: 2, baseDelayMs: 500, jitter: true, random: () => 0, sleep: async (ms) => jitterDelaysLow.push(ms) }
  );
  assert.deepEqual(jitterDelaysLow, [375, 750]);
});

test('R-TECH-05: Retry-After header supports integer seconds, HTTP-date, and clamps to [0, maxDelayMs]', async () => {
  const delays = [];
  const fixedNow = Date.UTC(2026, 10, 20, 12, 0, 0);
  const futureHttpDate = new Date(fixedNow + 4000).toUTCString();
  const pastHttpDate = new Date(fixedNow - 10000).toUTCString();

  const responses = [
    makeResponse(429, {}, { 'Retry-After': '2' }),
    makeResponse(429, {}, { 'Retry-After': futureHttpDate }),
    makeResponse(429, {}, { 'Retry-After': '99999999' }), // must clamp to maxDelayMs
    makeResponse(429, {}, { 'Retry-After': pastHttpDate }), // must clamp to 0
    makeResponse(200, { ok: true })
  ];
  let idx = 0;

  const res = await fetchWithRetry(
    async () => responses[idx++],
    {
      maxRetries: 5,
      baseDelayMs: 500,
      maxDelayMs: 5000,
      jitter: false,
      now: () => fixedNow,
      sleep: async (ms) => delays.push(ms)
    }
  );

  assert.equal(res.status, 200);
  assert.deepEqual(delays, [2000, 4000, 5000, 0]);
});

test('R-TECH-05 negative control: NEVER retries 400/401/403/404/422 or AbortError, DOES retry TypeError', async () => {
  for (const status of [400, 401, 403, 404, 422]) {
    let calls = 0;
    const res = await fetchWithRetry(
      async () => { calls++; return makeResponse(status); },
      { maxRetries: 3, sleep: async () => { throw new Error('should not sleep'); } }
    );
    assert.equal(calls, 1, `status ${status} must not retry`);
    assert.equal(res.status, status);
  }

  // AbortError thrown by fetchFn must not retry
  let abortCalls = 0;
  await assert.rejects(
    () => fetchWithRetry(
      async () => {
        abortCalls++;
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      },
      { maxRetries: 3, sleep: async () => { throw new Error('should not sleep'); } }
    ),
    (err) => err.name === 'AbortError'
  );
  assert.equal(abortCalls, 1);

  // TypeError (network failure) MUST retry and succeed on recovery
  let netCalls = 0;
  const netDelays = [];
  const recovered = await fetchWithRetry(
    async () => {
      netCalls++;
      if (netCalls < 3) throw new TypeError('Failed to fetch');
      return makeResponse(200, { recovered: true });
    },
    { maxRetries: 3, baseDelayMs: 100, jitter: false, sleep: async (ms) => netDelays.push(ms) }
  );
  assert.equal(netCalls, 3);
  assert.equal(recovered.status, 200);
  assert.deepEqual(netDelays, [100, 200]);
});

test('R-TECH-05: AbortSignal rejects immediately pre-start and mid-backoff without timer leaks', async () => {
  // 1. Pre-aborted signal
  const preController = new AbortController();
  preController.abort();
  let called = false;
  await assert.rejects(
    () => fetchWithRetry(async () => { called = true; return makeResponse(200); }, { signal: preController.signal }),
    (err) => err.name === 'AbortError'
  );
  assert.equal(called, false, 'must not call fetchFn if signal already aborted');

  // 2. Abort mid-backoff sleep (real timer set to 10s, aborted in 25ms)
  const midController = new AbortController();
  const start = Date.now();
  setTimeout(() => midController.abort(), 25);

  await assert.rejects(
    () => fetchWithRetry(
      async () => makeResponse(503),
      { maxRetries: 3, baseDelayMs: 10000, jitter: false, signal: midController.signal }
    ),
    (err) => err.name === 'AbortError'
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `expected immediate abort cleanup (<1000ms), took ${elapsed}ms`);
});

test('R-TECH-05: QuizProviders.extensionFetch retries transient errors in both direct and proxy modes', async () => {
  const origFetch = globalThis.fetch;
  const origChrome = globalThis.chrome;
  try {
    // Direct mode (no chrome.runtime)
    delete globalThis.chrome;
    let directAttempts = 0;
    globalThis.fetch = async () => {
      directAttempts++;
      if (directAttempts === 1) return makeResponse(502);
      return makeResponse(200, { ok: true });
    };
    const r1 = await QuizProviders.extensionFetch('https://api.example.com/v1/chat', {
      method: 'POST',
      retry: { maxRetries: 2, baseDelayMs: 1, jitter: false, sleep: async () => {} }
    });
    assert.equal(directAttempts, 2);
    assert.equal(r1.status, 200);

    // Proxy mode (chrome.runtime.sendMessage)
    let proxyAttempts = 0;
    let receivedOpts = null;
    globalThis.chrome = {
      runtime: {
        lastError: null,
        sendMessage(msg, cb) {
          proxyAttempts++;
          receivedOpts = msg.options;
          if (proxyAttempts === 1) {
            cb({ ok: false, status: 429, headers: { 'retry-after': '0' }, data: {} });
          } else {
            cb({ ok: true, status: 200, data: { text: 'ok' } });
          }
        }
      }
    };
    const ac = new AbortController();
    const r2 = await QuizProviders.extensionFetch('https://api.example.com/v1/chat', {
      method: 'POST',
      signal: ac.signal,
      retry: { maxRetries: 2, baseDelayMs: 1, jitter: false, sleep: async () => {} }
    });
    assert.equal(proxyAttempts, 2);
    assert.equal(r2.status, 200);
    assert.equal('signal' in receivedOpts, false, 'non-cloneable signal must be stripped before sendMessage');
    assert.equal('retry' in receivedOpts, false, 'retry config must be stripped before sendMessage');
  } finally {
    globalThis.fetch = origFetch;
    if (origChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = origChrome;
  }
});

// ===========================================================================
// F-ANA-03: ProviderAnalytics
// ===========================================================================

test('F-ANA-03: ProviderAnalytics tracks metrics, sanitizes secrets/URLs in errors, and coalesces storage writes', async () => {
  const origChrome = globalThis.chrome;
  let storageWrites = 0;
  let lastSaved = null;

  globalThis.chrome = {
    storage: {
      local: {
        async get() { return lastSaved ? { providerStats: lastSaved } : {}; },
        async set(obj) {
          storageWrites++;
          lastSaved = obj.providerStats;
        }
      }
    }
  };

  try {
    ProviderAnalytics.setDebounceMs(40);
    await ProviderAnalytics.resetStats();
    storageWrites = 0;

    // Rapid burst of 4 records should coalesce into ONE debounced write
    ProviderAnalytics.record({ provider: 'groq', model: 'llama-3.3-70b-versatile', ok: true, latencyMs: 120, status: 200 });
    ProviderAnalytics.record({ provider: 'groq', model: 'llama-3.3-70b-versatile', ok: true, latencyMs: 180, status: 200 });
    const fakeGeminiKey = ['AIza', 'SyDummy', '123456789'].join('');
    const fakeBearer = ['tok', '_dummy_999'].join('');
    const fakeApiVal = ['MY', 'DUMMYVAL'].join('');
    const fakeClaudeKey = ['sk-ant', '-dummykey', '1234567'].join('');
    ProviderAnalytics.record({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      ok: false,
      latencyMs: 300,
      status: 429,
      error: new Error(`Rate limit on https://generativelanguage.googleapis.com/v1beta?key=${fakeGeminiKey} Bearer ${fakeBearer} api_key=${fakeApiVal}`)
    });
    ProviderAnalytics.record({
      provider: 'claude',
      model: 'claude-sonnet-5',
      ok: false,
      latencyMs: 200,
      status: 500,
      error: `Internal error ${fakeClaudeKey}`
    });

    await new Promise((r) => setTimeout(r, 90));
    assert.equal(storageWrites, 1, 'rapid burst must coalesce into 1 storage write');

    const stats = ProviderAnalytics.getStats();
    assert.equal(stats.totals.requests, 4);
    assert.equal(stats.totals.successes, 2);
    assert.equal(stats.totals.failures, 2);
    assert.equal(stats.totals.rateLimits, 1);
    assert.equal(stats.providers.groq.avgLatencyMs, 150);
    assert.equal(stats.providers.groq.models['llama-3.3-70b-versatile'].requests, 2);

    // Verify zero secret/URL leakage in lastError
    const geminiErr = stats.providers.gemini.lastError;
    assert.ok(!geminiErr.includes(fakeGeminiKey), `API key leaked: ${geminiErr}`);
    assert.ok(!geminiErr.includes(fakeBearer), `Bearer leaked: ${geminiErr}`);
    assert.ok(!geminiErr.includes(fakeApiVal), `api_key leaked: ${geminiErr}`);
    assert.ok(!geminiErr.includes('https://'), `raw URL leaked: ${geminiErr}`);
    assert.ok(!stats.providers.claude.lastError.includes(fakeClaudeKey), 'Claude key leaked');

    // Reset clears stats
    const cleared = await ProviderAnalytics.resetStats();
    assert.equal(cleared.totals.requests, 0);
    assert.deepEqual(cleared.providers, {});
  } finally {
    ProviderAnalytics.setDebounceMs(500);
    if (origChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = origChrome;
  }
});

// ===========================================================================
// F-AUTO-02: preWarmProviders
// ===========================================================================

test('F-AUTO-02: preWarmProviders deduplicates concurrent calls, honors TTL cooldown, supports force:true, makes 0 LLM calls', async () => {
  const origFetch = globalThis.fetch;
  let fetchCalled = 0;
  globalThis.fetch = async () => {
    fetchCalled++;
    throw new Error('preWarmProviders must not make billable fetch calls by default');
  };

  try {
    let clock = 100000;
    const cfg = {
      groqApiKey: 'test-groq-key',
      geminiApiKey: 'test-gemini-key',
      providerOrder: ['gemini', 'groq']
    };

    // Concurrent calls should deduplicate onto the same promise
    const [r1, r2] = await Promise.all([
      QuizProviders.preWarmProviders({ force: true, config: cfg, now: () => clock }),
      QuizProviders.preWarmProviders({ force: true, config: cfg, now: () => clock })
    ]);
    assert.equal(r1.warmed, true);
    assert.deepEqual(r1.providersReady, ['gemini', 'groq']);
    assert.deepEqual(r2, r1);
    assert.equal(fetchCalled, 0, 'zero network LLM calls during default preWarm');

    // Within TTL (60s): cached response, warmed=false
    clock += 15000;
    const r3 = await QuizProviders.preWarmProviders({ config: cfg, ttlMs: 60000, now: () => clock });
    assert.equal(r3.warmed, false);
    assert.equal(r3.cached, true);
    assert.deepEqual(r3.providersReady, ['gemini', 'groq']);

    // Force bypasses TTL
    const r4 = await QuizProviders.preWarmProviders({ force: true, config: cfg, ttlMs: 60000, now: () => clock });
    assert.equal(r4.warmed, true);
    assert.equal(r4.cached, false);

    // After TTL expiry: warms again
    clock += 65000;
    const r5 = await QuizProviders.preWarmProviders({ config: cfg, ttlMs: 60000, now: () => clock });
    assert.equal(r5.warmed, true);
    assert.equal(fetchCalled, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('CJS & global compatibility exports are present', () => {
  assert.equal(typeof fetchWithRetry, 'function');
  assert.equal(typeof ProviderAnalytics.record, 'function');
  assert.equal(typeof QuizProviders.preWarmProviders, 'function');
  assert.equal(typeof ConfigCache.get, 'function');
  assert.equal(typeof ModelRegistry.warmContextCache, 'function');
});

// ===========================================================================
// Regressions from ANTIBUG Lot 2 Audit (all 6 findings)
// ===========================================================================

test('Regression: ProviderAnalytics cold-start hydration merges prior storage & deduplicates concurrent loadStats()', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(TARGET_ROOT, 'providers.js'), 'utf8');

  let getCalls = 0;
  const store = {
    providerStats: {
      providers: {
        gemini: {
          requests: 50, successes: 48, failures: 2, rateLimits: 1,
          totalLatencyMs: 5000, avgLatencyMs: 100, lastError: 'old err',
          lastSuccessAt: 1000, lastUpdatedAt: 1000,
          models: {
            'gemini-2.5-flash': {
              requests: 50, successes: 48, failures: 2, rateLimits: 1,
              totalLatencyMs: 5000, avgLatencyMs: 100, lastError: 'old err',
              lastSuccessAt: 1000, lastUpdatedAt: 1000
            }
          }
        }
      },
      totals: { requests: 50, successes: 48, failures: 2, rateLimits: 1, totalLatencyMs: 5000, avgLatencyMs: 100 },
      lastUpdatedAt: 1000
    }
  };

  const sandbox = {
    console, setTimeout, clearTimeout, AbortController, AbortSignal, URL, Date, Promise, Math, JSON, Object, Array, Map, Set, Number, String, Boolean, Error, TypeError,
    chrome: {
      storage: {
        local: {
          get: async (k) => {
            getCalls++;
            await new Promise(r => setTimeout(r, 15));
            return { [k]: JSON.parse(JSON.stringify(store[k])) };
          },
          set: async (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); }
        },
        sync: { get: async () => ({}) }
      }
    },
    module: { exports: {} }
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(src, sandbox);
  const FreshAnalytics = sandbox.module.exports.ProviderAnalytics;

  // Cold-start record() BEFORE loadStats() must merge with persisted 50 requests -> 51
  FreshAnalytics.record({ provider: 'gemini', model: 'gemini-2.5-flash', ok: true, latencyMs: 200, timestamp: 2000 });
  const [l1, l2] = await Promise.all([FreshAnalytics.loadStats(), FreshAnalytics.loadStats()]);
  assert.equal(getCalls, 1, 'concurrent loadStats() must deduplicate into 1 storage.get');
  assert.equal(l1.totals.requests, 51);
  assert.equal(l2.totals.requests, 51);

  await FreshAnalytics.flush();
  assert.equal(store.providerStats.totals.requests, 51, 'persisted history must not be wiped on SW restart');
});

test('Regression: ProviderAnalytics enforces single-flight storage writes so slow writes never overwrite newer metrics', async () => {
  const origChrome = globalThis.chrome;
  let writeSeq = 0;
  let activeWrites = 0;
  let maxConcurrentWrites = 0;
  const store = {};

  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async (obj) => {
          const seq = ++writeSeq;
          activeWrites++;
          maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
          const delay = seq === 1 ? 80 : 10;
          await new Promise(r => setTimeout(r, delay));
          Object.assign(store, JSON.parse(JSON.stringify(obj)));
          activeWrites--;
        }
      },
      sync: { get: async () => ({}) }
    }
  };

  try {
    await ProviderAnalytics.resetStats();
    writeSeq = 0;
    ProviderAnalytics.setDebounceMs(15);

    ProviderAnalytics.record({ provider: 'groq', model: 'llama', ok: true, latencyMs: 50 });
    await new Promise(r => setTimeout(r, 30)); // write #1 in-flight (80ms)
    ProviderAnalytics.record({ provider: 'groq', model: 'llama', ok: true, latencyMs: 60 });
    await new Promise(r => setTimeout(r, 150));

    assert.equal(maxConcurrentWrites, 1, 'storage writes must never overlap');
    assert.equal(store.providerStats.totals.requests, 2, 'newer metrics must not be overwritten by slower write');
  } finally {
    ProviderAnalytics.setDebounceMs(500);
    if (origChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = origChrome;
  }
});

test('Regression: ProviderAnalytics sanitizes JSON-formatted api_key/authorization/Basic secrets and handles prototype keys safely', async () => {
  const origChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      sync: { get: async () => ({}) }
    }
  };

  try {
    await ProviderAnalytics.resetStats();
    const fakeMistralVal = ['mistral', '_raw_val_987654321'].join('');
    const fakeBasicB64 = Buffer.from('user:pass').toString('base64');
    ProviderAnalytics.record({
      provider: 'mistral',
      model: 'mistral-small-latest',
      ok: false,
      latencyMs: 50,
      status: 401,
      error: new Error('Erreur Mistral: ' + JSON.stringify({
        error: 'bad auth',
        api_key: fakeMistralVal,
        authorization: `Basic ${fakeBasicB64}`
      }))
    });

    const stats = ProviderAnalytics.getStats();
    const errText = stats.providers.mistral.lastError;
    assert.ok(!errText.includes(fakeMistralVal), `JSON api_key leaked: ${errText}`);
    assert.ok(!errText.includes(fakeBasicB64), `Basic auth credential leaked: ${errText}`);

    // Prototype keys must not throw or pollute Object.prototype
    ProviderAnalytics.record({ provider: 'constructor', model: 'toString', ok: true, latencyMs: 10 });
    assert.equal(typeof Object.prototype.requests, 'undefined');
  } finally {
    if (origChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = origChrome;
  }
});

test('Regression: preWarmProviders({ syncModels: true }) serializes ModelRegistry cache writes without lost updates', async () => {
  const origChrome = globalThis.chrome;
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (k) => {
          await new Promise(r => setTimeout(r, 10));
          return { [k]: store[k] ? JSON.parse(JSON.stringify(store[k])) : undefined };
        },
        set: async (obj) => {
          await new Promise(r => setTimeout(r, 10));
          Object.assign(store, JSON.parse(JSON.stringify(obj)));
        }
      },
      sync: { get: async () => ({}) }
    }
  };

  try {
    await QuizProviders.preWarmProviders({
      force: true,
      syncModels: true,
      config: { groqApiKey: ['gsk', '_dummy'].join(''), nvidiaApiKey: ['nvapi', '-dummy'].join(''), providerOrder: ['groq', 'nvidia'] }
    });
    const keys = Object.keys(store.modelMetadataCache || {}).sort();
    assert.deepEqual(keys, ['groq', 'nvidia'], `expected both providers persisted, got: ${JSON.stringify(keys)}`);
  } finally {
    if (origChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = origChrome;
  }
});

test('Regression: extensionFetch honors options.retry.signal and cleans up AbortSignal listener on sync sendMessage throw', async () => {
  const origFetch = globalThis.fetch;
  const origChrome = globalThis.chrome;
  let fetchCalled = 0;

  globalThis.fetch = async () => {
    fetchCalled++;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  delete globalThis.chrome;

  try {
    // 1. options.retry.signal must not be clobbered by missing top-level options.signal
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () => QuizProviders.extensionFetch('https://api.groq.com/openai/v1/chat/completions', {
        retry: { maxRetries: 2, signal: ac.signal }
      }),
      (err) => err && err.name === 'AbortError'
    );
    assert.equal(fetchCalled, 0, 'pre-aborted options.retry.signal must abort before calling fetch');

    // 2. Sync throw from chrome.runtime.sendMessage must clean up AbortSignal listener
    let activeListeners = 0;
    const fakeSignal = {
      aborted: false,
      addEventListener: () => { activeListeners++; },
      removeEventListener: () => { activeListeners--; }
    };
    globalThis.chrome = {
      runtime: {
        sendMessage: () => { throw new Error('Extension context invalidated.'); }
      }
    };
    await assert.rejects(
      () => QuizProviders.extensionFetch('https://api.groq.com/openai/v1/chat/completions', {
        signal: fakeSignal,
        retry: false
      }),
      /Extension context invalidated/
    );
    assert.equal(activeListeners, 0, 'AbortSignal listener must be cleaned up on synchronous sendMessage throw');
  } finally {
    globalThis.fetch = origFetch;
    if (origChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = origChrome;
  }
});

test('Regression (pass 2): error redaction (API key:/escaped JSON/colon Bearer), combined signals, and normalized key merge', async () => {
  const origFetch = globalThis.fetch;
  const origChrome = globalThis.chrome;
  delete globalThis.chrome;

  // 1. Error redaction for "API key: ...", escaped JSON, and colon Bearer
  const fakeKey1 = ['raw', 'MistralVal', '12345'].join('');
  const fakeKey2 = ['escaped', 'Val', '98765'].join('');
  const fakeKey3 = ['keyId', ':', 'secVal99'].join('');
  globalThis.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} }, sync: { get: async () => ({}) } }
  };
  try {
    await ProviderAnalytics.resetStats();
    ProviderAnalytics.record({ provider: 'mistral', model: 'm', ok: false, latencyMs: 1, error: `Invalid API key: ${fakeKey1}` });
    assert.ok(!ProviderAnalytics.getStats().providers.mistral.lastError.includes(fakeKey1));

    ProviderAnalytics.record({ provider: 'mistral', model: 'm', ok: false, latencyMs: 1, error: `Error: {\\"api_key\\":\\"${fakeKey2}\\"}` });
    assert.ok(!ProviderAnalytics.getStats().providers.mistral.lastError.includes(fakeKey2));

    ProviderAnalytics.record({ provider: 'mistral', model: 'm', ok: false, latencyMs: 1, error: `Authorization: Bearer ${fakeKey3}` });
    assert.ok(!ProviderAnalytics.getStats().providers.mistral.lastError.includes('secVal99'));

    // 2. Both options.signal and options.retry.signal provided -> aborting retry.signal aborts request
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls++; return { ok: true, status: 200, json: async () => ({}) }; };
    const acReq = new AbortController();
    const acRetry = new AbortController();
    acRetry.abort();
    await assert.rejects(
      () => QuizProviders.extensionFetch('https://api.groq.com/openai/v1/chat/completions', {
        signal: acReq.signal,
        retry: { maxRetries: 2, signal: acRetry.signal }
      }),
      (err) => err && err.name === 'AbortError'
    );
    assert.equal(fetchCalls, 0);

    // 3. Normalized key merge: stored "Gemini" + " gemini " + "constructor" merge cleanly with cold-start delta
    const vm = require('node:vm');
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(TARGET_ROOT, 'providers.js'), 'utf8');
    const store = {
      providerStats: {
        providers: {
          Gemini: { requests: 50, successes: 50, failures: 0, rateLimits: 0, totalLatencyMs: 500, avgLatencyMs: 10, lastError: null, lastSuccessAt: 1, lastUpdatedAt: 1, models: { m1: { requests: 50, successes: 50, failures: 0, rateLimits: 0, totalLatencyMs: 500, avgLatencyMs: 10, lastError: null, lastSuccessAt: 1, lastUpdatedAt: 1 } } },
          ' gemini ': { requests: 20, successes: 20, failures: 0, rateLimits: 0, totalLatencyMs: 200, avgLatencyMs: 10, lastError: null, lastSuccessAt: 1, lastUpdatedAt: 1, models: { m1: { requests: 20, successes: 20, failures: 0, rateLimits: 0, totalLatencyMs: 200, avgLatencyMs: 10, lastError: null, lastSuccessAt: 1, lastUpdatedAt: 1 } } },
          constructor: { requests: 10, successes: 10, failures: 0, rateLimits: 0, totalLatencyMs: 100, avgLatencyMs: 10, lastError: null, lastSuccessAt: 1, lastUpdatedAt: 1, models: { m1: { requests: 10, successes: 10, failures: 0, rateLimits: 0, totalLatencyMs: 100, avgLatencyMs: 10, lastError: null, lastSuccessAt: 1, lastUpdatedAt: 1 } } }
        },
        totals: { requests: 80, successes: 80, failures: 0, rateLimits: 0, totalLatencyMs: 800, avgLatencyMs: 10 },
        lastUpdatedAt: 1
      }
    };
    const sandbox = {
      console, setTimeout, clearTimeout, AbortController, AbortSignal, URL, Date, Promise, Math, JSON, Object, Array, Map, Set, Number, String, Boolean, Error, TypeError,
      chrome: { storage: { local: { get: async (k) => ({ [k]: JSON.parse(JSON.stringify(store[k])) }), set: async () => {} }, sync: { get: async () => ({}) } } },
      module: { exports: {} }
    };
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    vm.runInNewContext(src, sandbox);
    const Fresh = sandbox.module.exports.ProviderAnalytics;
    Fresh.record({ provider: 'gemini', model: 'm1', ok: true, latencyMs: 100 });
    Fresh.record({ provider: 'constructor', model: 'm1', ok: true, latencyMs: 50 });
    const merged = await Fresh.loadStats();
    assert.equal(merged.totals.requests, 82);
    assert.equal(merged.providers.gemini.requests, 71);
    assert.equal(merged.providers.gemini.models.m1.requests, 71);
    assert.equal(merged.providers._constructor.requests, 11);
  } finally {
    globalThis.fetch = origFetch;
    if (origChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = origChrome;
  }
});
