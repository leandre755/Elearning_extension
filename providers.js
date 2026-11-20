// ============================================================
// providers.js — Multi-Provider LLM Registry, Smart Switcher & Router
// ============================================================

const ConfigCache = (() => {
  'use strict';

  let _data = {};
  let _initialized = false;
  const _listeners = [];

  const SYNC_KEYS = [
    'captureImages', 'imageMinSize', 'imageQuality',
    'contextText', 'customQuestionSelector', 'customAnswerSelector',
    'highlightColor', 'highlightIntensity', 'highlightDiscretion',
    'providerOrder', 'customModels', 'agenticSearch', 'autoMode', 'enabled'
  ];

  const LOCAL_KEYS = [
    'groqApiKey', 'geminiApiKey', 'nvidiaApiKey',
    'mistralApiKey', 'claudeApiKey',
    'serpApiKey', 'contextFiles'
  ];

  async function init() {
    if (_initialized) {
      return;
    }
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return;
    }
    try {
      const [syncData, localData] = await Promise.all([
        chrome.storage.sync ? chrome.storage.sync.get(SYNC_KEYS) : Promise.resolve({}),
        chrome.storage.local ? chrome.storage.local.get(LOCAL_KEYS) : Promise.resolve({})
      ]);
      _data = { ...syncData, ...localData };
      _initialized = true;

      if (chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === 'function') {
        chrome.storage.onChanged.addListener((changes) => {
          for (const [key, { newValue }] of Object.entries(changes)) {
            _data[key] = newValue;
          }
          _listeners.forEach(cb => cb(changes));
        });
      }
    } catch (e) {
      console.error('❌ ConfigCache: Erreur d\'initialisation:', e.message);
    }
  }

  function get(key) {
    return _data[key];
  }

  function getAll() {
    return { ..._data };
  }

  function onChange(cb) {
    if (typeof cb === 'function') {
      _listeners.push(cb);
    }
  }

  return {
    init,
    get,
    getAll,
    onChange,
    isInitialized: () => _initialized
  };
})();

if (typeof window !== 'undefined') {
  window.ConfigCache = ConfigCache;
}

// ============================================================
// _ProviderNetUtils & fetchWithRetry (R-TECH-05)
// ============================================================
const _ProviderNetUtils = (() => {
  'use strict';

  const TRANSIENT_NET_CODES = new Set([
    'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED',
    'EAI_AGAIN', 'EPIPE', 'ERR_NETWORK',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'
  ]);

  function sanitizeUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (u.username) u.username = '***';
      if (u.password) u.password = '***';
      if (u.hash) u.hash = '#***';
      for (const name of [...u.searchParams.keys()]) {
        if (/key|token|sig|secret|auth|credential|passw/i.test(name)) {
          u.searchParams.set(name, '***');
        }
      }
      return u.toString();
    } catch {
      return '[invalid url]';
    }
  }

  function createAbortError(reason) {
    if (reason instanceof Error && reason.name === 'AbortError') {
      return reason;
    }
    const msg = typeof reason === 'string' && reason
      ? reason
      : (reason && reason.message) || 'The operation was aborted.';
    const err = new Error(msg);
    err.name = 'AbortError';
    err.code = 'ABORT_ERR';
    return err;
  }

  function isAbortError(err, signal) {
    if (signal && signal.aborted) {
      return true;
    }
    if (!err) {
      return false;
    }
    return err.name === 'AbortError' || err.code === 'ABORT_ERR';
  }

  function getHeader(headers, name) {
    if (!headers || !name) return null;
    if (typeof headers.get === 'function') {
      const val = headers.get(name);
      return val !== undefined && val !== null ? val : headers.get(name.toLowerCase());
    }
    if (typeof headers === 'object') {
      const lower = name.toLowerCase();
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === lower) {
          return headers[k];
        }
      }
    }
    return null;
  }

  function parseRetryAfterMs(headerVal, maxDelayMs, nowFn = Date.now) {
    if (headerVal === undefined || headerVal === null) return null;
    const raw = String(headerVal).trim();
    if (!raw) return null;

    if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
      const secs = Number(raw);
      if (!Number.isFinite(secs)) return null;
      return Math.min(maxDelayMs, Math.max(0, Math.round(secs * 1000)));
    }

    const parsedDateMs = Date.parse(raw);
    if (!Number.isNaN(parsedDateMs)) {
      const deltaMs = parsedDateMs - nowFn();
      return Math.min(maxDelayMs, Math.max(0, Math.round(deltaMs)));
    }

    return null;
  }

  function isRetryableStatus(status, retryStatuses) {
    if (typeof status !== 'number' || !Number.isFinite(status)) return false;
    if (typeof retryStatuses === 'function') return Boolean(retryStatuses(status));
    if (retryStatuses instanceof Set) return retryStatuses.has(status);
    if (Array.isArray(retryStatuses)) return retryStatuses.includes(status);
    return status === 429 || (status >= 500 && status <= 599);
  }

  function isRetryableError(err, retryStatuses, signal) {
    if (isAbortError(err, signal)) return false;
    if (!err) return false;
    if (err.retryable === false) return false;
    if (typeof err.status === 'number') {
      return isRetryableStatus(err.status, retryStatuses);
    }
    if (
      err instanceof SyntaxError ||
      err instanceof ReferenceError ||
      err instanceof RangeError ||
      err instanceof URIError ||
      err instanceof EvalError
    ) {
      return false;
    }
    if (err instanceof TypeError) return true;
    if (err.networkError === true || err.isNetworkError === true) return true;
    if (err.code && TRANSIENT_NET_CODES.has(err.code)) return true;

    const msg = String(err.message || '');
    if (/\b(400|401|403|404|422)\b/.test(msg)) return false;
    if (/\b(network|fetch failed|failed to fetch|socket hang up|econnreset|etimedout|enotfound|econnrefused|connection reset|temporarily unavailable)\b/i.test(msg)) {
      return true;
    }
    return false;
  }

  function computeBackoffDelayMs({ attempt, baseDelayMs, maxDelayMs, jitter, randomFn, response, nowFn }) {
    if (response) {
      const retryAfterRaw = getHeader(response.headers, 'Retry-After');
      const retryAfterMs = parseRetryAfterMs(retryAfterRaw, maxDelayMs, nowFn);
      if (retryAfterMs !== null) {
        return retryAfterMs;
      }
    }

    const expDelay = Math.min(maxDelayMs, Math.max(0, baseDelayMs * Math.pow(2, attempt)));
    if (typeof jitter === 'function') {
      const custom = Number(jitter(expDelay, attempt));
      if (!Number.isFinite(custom)) return expDelay;
      return Math.min(maxDelayMs, Math.max(0, Math.round(custom)));
    }
    if (jitter === false) {
      return Math.min(maxDelayMs, Math.max(0, Math.round(expDelay)));
    }

    const randRaw = Number(randomFn());
    const randVal = Number.isFinite(randRaw) ? Math.min(1, Math.max(0, randRaw)) : 0.5;
    const jittered = expDelay * (0.75 + 0.25 * randVal);
    return Math.min(maxDelayMs, Math.max(0, Math.round(jittered)));
  }

  async function cancellableSleep(delayMs, signal, customSleep) {
    if (signal && signal.aborted) {
      throw createAbortError(signal.reason);
    }

    if (customSleep) {
      if (!signal) {
        await customSleep(delayMs);
        return;
      }
      let onAbort = null;
      try {
        await Promise.race([
          Promise.resolve(customSleep(delayMs, signal)),
          new Promise((_, reject) => {
            onAbort = () => reject(createAbortError(signal.reason));
            signal.addEventListener('abort', onAbort, { once: true });
          })
        ]);
      } finally {
        if (onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
      }
      if (signal.aborted) {
        throw createAbortError(signal.reason);
      }
      return;
    }

    if (delayMs <= 0) {
      return;
    }

    return new Promise((resolve, reject) => {
      let timerId = null;
      let onAbort = null;

      const cleanup = () => {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
          onAbort = null;
        }
      };

      if (signal) {
        onAbort = () => {
          cleanup();
          reject(createAbortError(signal.reason));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      timerId = setTimeout(() => {
        cleanup();
        resolve();
      }, delayMs);
    });
  }

  /**
   * Exponential backoff retry helper for transient HTTP (429/5xx) and network failures.
   * Honors Retry-After headers and AbortSignal with leak-free timer/listener cleanup.
   * @param {Function} fetchFn
   * @param {Object} [options]
   * @returns {Promise<*>}
   */
  async function fetchWithRetry(fetchFn, options = {}) {
    if (typeof fetchFn !== 'function') {
      throw new TypeError('fetchWithRetry: fetchFn doit être une fonction.');
    }

    const opts = options && typeof options === 'object' ? options : {};
    const maxRetries = (typeof opts.maxRetries === 'number' && Number.isFinite(opts.maxRetries))
      ? Math.max(0, Math.floor(opts.maxRetries))
      : 3;
    const baseDelayMs = (typeof opts.baseDelayMs === 'number' && Number.isFinite(opts.baseDelayMs) && opts.baseDelayMs >= 0)
      ? opts.baseDelayMs
      : 500;
    const maxDelayMs = (typeof opts.maxDelayMs === 'number' && Number.isFinite(opts.maxDelayMs) && opts.maxDelayMs >= 0)
      ? opts.maxDelayMs
      : 30000;
    const jitter = opts.jitter !== undefined ? opts.jitter : true;
    const signal = opts.signal || null;
    const retryStatuses = opts.retryStatuses;
    const customSleep = typeof opts.sleep === 'function' ? opts.sleep : null;
    const randomFn = typeof opts.random === 'function' ? opts.random : Math.random;
    const nowFn = typeof opts.now === 'function' ? opts.now : Date.now;
    const onRetry = typeof opts.onRetry === 'function' ? opts.onRetry : null;

    if (signal && signal.aborted) {
      throw createAbortError(signal.reason);
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal && signal.aborted) {
        throw createAbortError(signal.reason);
      }

      let response = null;
      try {
        response = await fetchFn();
      } catch (err) {
        if (isAbortError(err, signal)) {
          throw err && err.name === 'AbortError' ? err : createAbortError(signal?.reason || err);
        }
        if (attempt >= maxRetries || !isRetryableError(err, retryStatuses, signal)) {
          throw err;
        }
        const delayMs = computeBackoffDelayMs({
          attempt,
          baseDelayMs,
          maxDelayMs,
          jitter,
          randomFn,
          response: null,
          nowFn
        });
        if (onRetry) {
          try { onRetry({ attempt: attempt + 1, maxRetries, delayMs, status: err.status, error: err }); } catch (_) { /* ignore hook error */ }
        }
        await cancellableSleep(delayMs, signal, customSleep);
        continue;
      }

      if (signal && signal.aborted) {
        throw createAbortError(signal.reason);
      }

      if (response && typeof response.status === 'number' && isRetryableStatus(response.status, retryStatuses)) {
        if (attempt >= maxRetries) {
          return response;
        }
        const delayMs = computeBackoffDelayMs({
          attempt,
          baseDelayMs,
          maxDelayMs,
          jitter,
          randomFn,
          response,
          nowFn
        });
        if (response.body && typeof response.body.cancel === 'function') {
          response.body.cancel().catch(() => {});
        }
        if (onRetry) {
          try { onRetry({ attempt: attempt + 1, maxRetries, delayMs, status: response.status, error: null }); } catch (_) { /* ignore hook error */ }
        }
        await cancellableSleep(delayMs, signal, customSleep);
        continue;
      }

      return response;
    }
  }

  return {
    sanitizeUrl,
    createAbortError,
    isAbortError,
    parseRetryAfterMs,
    fetchWithRetry
  };
})();

const fetchWithRetry = _ProviderNetUtils.fetchWithRetry;

// ============================================================
// ProviderAnalytics — Performance & Reliability Telemetry (F-ANA-03)
// ============================================================
const ProviderAnalytics = (() => {
  'use strict';

  const STORAGE_KEY = 'providerStats';
  const DEFAULT_DEBOUNCE_MS = 500;
  const MAX_ERROR_LENGTH = 160;

  let _debounceMs = DEFAULT_DEBOUNCE_MS;
  let _persistTimer = null;
  let _dirty = false;
  let _inFlightWrite = null;
  let _loaded = false;
  let _loadPromise = null;
  let _resetGeneration = 0;

  function _hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function _safeKey(raw, fallback) {
    const k = typeof raw === 'string' && raw.trim() ? raw.trim() : fallback;
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      return `_${k}`;
    }
    return k;
  }

  function _createMetricBucket() {
    return {
      requests: 0,
      successes: 0,
      failures: 0,
      rateLimits: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 0,
      lastError: null,
      lastSuccessAt: null,
      lastUpdatedAt: null
    };
  }

  function _createEmptyState() {
    return {
      providers: Object.create(null),
      totals: {
        requests: 0,
        successes: 0,
        failures: 0,
        rateLimits: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0
      },
      lastUpdatedAt: null
    };
  }

  let _state = _createEmptyState();

  function _cloneState(src) {
    return JSON.parse(JSON.stringify(src));
  }

  function _sanitizeErrorText(error, status) {
    let raw = '';
    if (typeof error === 'string') {
      raw = error;
    } else if (error && typeof error.message === 'string') {
      raw = error.message;
    } else if (typeof status === 'number') {
      raw = `HTTP ${status}`;
    } else {
      raw = 'Unknown error';
    }

    let cleaned = raw
      .replace(/https?:\/\/[^\s"'<>\\]+/gi, '[url]')
      .replace(/\b(Bearer|Basic|Token)\s+[^\s,;}"'\\\]]+/gi, '$1 ***')
      .replace(/\b(?:AIza[0-9A-Za-z\-_]{10,}|sk-[A-Za-z0-9\-_]{10,}|gsk_[A-Za-z0-9\-_]{10,}|nvapi-[A-Za-z0-9\-_]{10,})\b/g, '***')
      .replace(/(\\"?\b(?:api[\s_-]?key|x-api-key|authorization|access[\s_-]?token|token|secret|auth|password|credential|key)\b\\"?\s*[:=]\s*\\")[^"]*\\"/gi, '$1***\\"')
      .replace(/(\\'?\b(?:api[\s_-]?key|x-api-key|authorization|access[\s_-]?token|token|secret|auth|password|credential|key)\b\\'?\s*[:=]\s*\\')[^']*\\'/gi, "$1***\\'")
      .replace(/(["']?\b(?:api[\s_-]?key|x-api-key|authorization|access[\s_-]?token|token|secret|auth|password|credential|key)\b["']?\s*[:=]\s*)(["'])(?:(?!\2)[^\\]|\\.)*\2/gi, '$1$2***$2')
      .replace(/(["']?\b(?:api[\s_-]?key|x-api-key|authorization|access[\s_-]?token|token|secret|auth|password|credential)\b["']?\s*[:=]\s*)(?:(?:Bearer|Basic|Token)\s+)?[^\s,;}"'\\\]]+/gi, '$1***')
      .replace(/(\bkey\s*=\s*)[^\s&,;}"'\\\]]+/gi, '$1***')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) {
      cleaned = typeof status === 'number' ? `HTTP ${status}` : 'Unknown error';
    }
    if (cleaned.length > MAX_ERROR_LENGTH) {
      cleaned = `${cleaned.slice(0, MAX_ERROR_LENGTH - 3)}...`;
    }
    return cleaned;
  }

  function _isRateLimitEvent(status, error) {
    if (status === 429) return true;
    if (error && error.status === 429) return true;
    const msg = typeof error === 'string'
      ? error
      : (error && typeof error.message === 'string' ? error.message : '');
    return /\b(429|rate limit|quota|too many requests|resource_exhausted)\b/i.test(msg);
  }

  function _applyBucketUpdate(bucket, { ok, latencyMs, isRateLimit, sanitizedError, now }) {
    bucket.requests += 1;
    if (ok) {
      bucket.successes += 1;
      bucket.lastSuccessAt = now;
    } else {
      bucket.failures += 1;
      if (isRateLimit) {
        bucket.rateLimits += 1;
      }
      bucket.lastError = sanitizedError;
    }
    bucket.totalLatencyMs += latencyMs;
    bucket.avgLatencyMs = bucket.requests > 0 ? Math.round(bucket.totalLatencyMs / bucket.requests) : 0;
    bucket.lastUpdatedAt = now;
  }

  function _numOrZero(val) {
    return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : 0;
  }

  function _maxTimestamp(a, b) {
    const aOk = typeof a === 'number' && Number.isFinite(a);
    const bOk = typeof b === 'number' && Number.isFinite(b);
    if (aOk && bOk) return Math.max(a, b);
    if (aOk) return a;
    if (bOk) return b;
    return null;
  }

  function _mergeBuckets(storedBucket, deltaBucket) {
    const s = storedBucket && typeof storedBucket === 'object' ? storedBucket : _createMetricBucket();
    const d = deltaBucket && typeof deltaBucket === 'object' ? deltaBucket : _createMetricBucket();
    const requests = _numOrZero(s.requests) + _numOrZero(d.requests);
    const successes = _numOrZero(s.successes) + _numOrZero(d.successes);
    const failures = _numOrZero(s.failures) + _numOrZero(d.failures);
    const rateLimits = _numOrZero(s.rateLimits) + _numOrZero(d.rateLimits);
    const totalLatencyMs = _numOrZero(s.totalLatencyMs) + _numOrZero(d.totalLatencyMs);
    const avgLatencyMs = requests > 0 ? Math.round(totalLatencyMs / requests) : 0;
    const lastError = _numOrZero(d.failures) > 0 && d.lastError
      ? d.lastError
      : (typeof s.lastError === 'string' ? s.lastError : null);
    return {
      requests,
      successes,
      failures,
      rateLimits,
      totalLatencyMs,
      avgLatencyMs,
      lastError,
      lastSuccessAt: _maxTimestamp(s.lastSuccessAt, d.lastSuccessAt),
      lastUpdatedAt: _maxTimestamp(s.lastUpdatedAt, d.lastUpdatedAt)
    };
  }

  function _mergeStoredIntoState(stored, delta) {
    const merged = _createEmptyState();
    const storedProviders = (stored && stored.providers && typeof stored.providers === 'object') ? stored.providers : {};
    const deltaProviders = (delta && delta.providers && typeof delta.providers === 'object') ? delta.providers : {};

    const addProviderEntry = (rawKey, sourceObj, isDelta) => {
      if (!sourceObj || typeof sourceObj !== 'object') return;
      const pKey = _safeKey(rawKey.trim().toLowerCase(), 'unknown');
      const existing = _hasOwn(merged.providers, pKey) ? merged.providers[pKey] : null;
      const mergedBucket = existing
        ? _mergeBuckets(existing, sourceObj)
        : _mergeBuckets(isDelta ? null : sourceObj, isDelta ? sourceObj : null);
      const mergedModels = existing ? existing.models : Object.create(null);

      const srcModels = (sourceObj.models && typeof sourceObj.models === 'object') ? sourceObj.models : {};
      for (const rawModelId of Object.keys(srcModels)) {
        if (!_hasOwn(srcModels, rawModelId)) continue;
        const mId = _safeKey(rawModelId, 'unknown');
        const modObj = srcModels[rawModelId];
        const prevMod = _hasOwn(mergedModels, mId) ? mergedModels[mId] : null;
        mergedModels[mId] = prevMod
          ? _mergeBuckets(prevMod, modObj)
          : _mergeBuckets(isDelta ? null : modObj, isDelta ? modObj : null);
      }

      merged.providers[pKey] = {
        ...mergedBucket,
        models: mergedModels
      };
    };

    for (const rawKey of Object.keys(storedProviders)) {
      if (_hasOwn(storedProviders, rawKey)) {
        addProviderEntry(rawKey, storedProviders[rawKey], false);
      }
    }
    for (const rawKey of Object.keys(deltaProviders)) {
      if (_hasOwn(deltaProviders, rawKey)) {
        addProviderEntry(rawKey, deltaProviders[rawKey], true);
      }
    }

    const sTotals = (stored && stored.totals && typeof stored.totals === 'object') ? stored.totals : {};
    const dTotals = (delta && delta.totals && typeof delta.totals === 'object') ? delta.totals : {};
    const totalReqs = _numOrZero(sTotals.requests) + _numOrZero(dTotals.requests);
    const totalLat = _numOrZero(sTotals.totalLatencyMs) + _numOrZero(dTotals.totalLatencyMs);
    merged.totals = {
      requests: totalReqs,
      successes: _numOrZero(sTotals.successes) + _numOrZero(dTotals.successes),
      failures: _numOrZero(sTotals.failures) + _numOrZero(dTotals.failures),
      rateLimits: _numOrZero(sTotals.rateLimits) + _numOrZero(dTotals.rateLimits),
      totalLatencyMs: totalLat,
      avgLatencyMs: totalReqs > 0 ? Math.round(totalLat / totalReqs) : 0
    };
    merged.lastUpdatedAt = _maxTimestamp(stored && stored.lastUpdatedAt, delta && delta.lastUpdatedAt);
    return merged;
  }

  async function _writeSnapshotToStorage() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      _dirty = false;
      return;
    }
    // Hydrate & merge persisted stats before first write so MV3 SW restarts never wipe history
    if (!_loaded) {
      await loadStats();
      if (!_loaded) {
        // Hydration failed transiently: do not overwrite persisted history with partial cold-start state
        _dirty = false;
        return;
      }
    }
    while (_dirty) {
      _dirty = false;
      const snapshot = _cloneState(_state);
      try {
        await Promise.resolve(chrome.storage.local.set({ [STORAGE_KEY]: snapshot }));
      } catch (e) {
        console.warn('⚠️ ProviderAnalytics: échec de sauvegarde:', e.message);
        break;
      }
    }
  }

  function _startWriteLoop() {
    if (_inFlightWrite) {
      return _inFlightWrite;
    }
    const writePromise = _writeSnapshotToStorage().finally(() => {
      if (_inFlightWrite === writePromise) {
        _inFlightWrite = null;
      }
      // If another record() arrived right as the write finished, drain it sequentially
      if (_dirty && _persistTimer === null && !_inFlightWrite) {
        _schedulePersist();
      }
    });
    _inFlightWrite = writePromise;
    return writePromise;
  }

  function _schedulePersist() {
    _dirty = true;
    // Single-flight guarantee: if a write loop is already active, let its while(_dirty) drain it
    if (_inFlightWrite) {
      return;
    }
    if (_persistTimer !== null) {
      clearTimeout(_persistTimer);
    }
    _persistTimer = setTimeout(() => {
      _persistTimer = null;
      if (_dirty && !_inFlightWrite) {
        _startWriteLoop();
      }
    }, _debounceMs);
    if (_persistTimer && typeof _persistTimer.unref === 'function') {
      _persistTimer.unref();
    }
  }

  function record(entry) {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    const providerKey = _safeKey(
      typeof entry.provider === 'string' ? entry.provider.trim().toLowerCase() : '',
      'unknown'
    );
    const modelId = _safeKey(
      typeof entry.model === 'string' ? entry.model.trim() : '',
      'unknown'
    );
    const ok = Boolean(entry.ok);
    const latencyMs = (typeof entry.latencyMs === 'number' && Number.isFinite(entry.latencyMs) && entry.latencyMs >= 0)
      ? Math.round(entry.latencyMs)
      : 0;
    const status = typeof entry.status === 'number'
      ? entry.status
      : (entry.error && typeof entry.error.status === 'number' ? entry.error.status : undefined);
    const now = (typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp))
      ? entry.timestamp
      : Date.now();
    const isRateLimit = !ok && _isRateLimitEvent(status, entry.error);
    const sanitizedError = ok ? null : _sanitizeErrorText(entry.error, status);

    if (!_hasOwn(_state.providers, providerKey)) {
      _state.providers[providerKey] = {
        ..._createMetricBucket(),
        models: Object.create(null)
      };
    }
    const providerBucket = _state.providers[providerKey];
    if (!_hasOwn(providerBucket.models, modelId)) {
      providerBucket.models[modelId] = _createMetricBucket();
    }

    const updateArgs = { ok, latencyMs, isRateLimit, sanitizedError, now };
    _applyBucketUpdate(providerBucket, updateArgs);
    _applyBucketUpdate(providerBucket.models[modelId], updateArgs);

    _state.totals.requests += 1;
    if (ok) {
      _state.totals.successes += 1;
    } else {
      _state.totals.failures += 1;
      if (isRateLimit) {
        _state.totals.rateLimits += 1;
      }
    }
    _state.totals.totalLatencyMs += latencyMs;
    _state.totals.avgLatencyMs = _state.totals.requests > 0
      ? Math.round(_state.totals.totalLatencyMs / _state.totals.requests)
      : 0;
    _state.lastUpdatedAt = now;

    _schedulePersist();
  }

  function getStats() {
    return _cloneState(_state);
  }

  async function loadStats() {
    if (_loaded) {
      return _cloneState(_state);
    }
    if (_loadPromise) {
      return _loadPromise;
    }
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      _loaded = true;
      return _cloneState(_state);
    }

    const startGen = _resetGeneration;
    _loadPromise = (async () => {
      try {
        const res = await Promise.resolve(chrome.storage.local.get(STORAGE_KEY));
        if (_resetGeneration !== startGen) {
          return _cloneState(_state);
        }
        const stored = res && res[STORAGE_KEY];
        if (stored && typeof stored === 'object' && stored.providers) {
          _state = _mergeStoredIntoState(stored, _state);
        }
        _loaded = true;
      } catch (e) {
        console.warn('⚠️ ProviderAnalytics: impossible de charger les stats:', e.message);
      } finally {
        _loadPromise = null;
      }
      return _cloneState(_state);
    })();

    return _loadPromise;
  }

  async function flush() {
    if (_persistTimer !== null) {
      clearTimeout(_persistTimer);
      _persistTimer = null;
    }
    _dirty = true;
    while (_inFlightWrite || _dirty) {
      if (_inFlightWrite) {
        await _inFlightWrite;
      }
      if (_dirty && !_inFlightWrite) {
        await _startWriteLoop();
      }
    }
    return _cloneState(_state);
  }

  async function resetStats() {
    _resetGeneration += 1;
    if (_persistTimer !== null) {
      clearTimeout(_persistTimer);
      _persistTimer = null;
    }
    if (_loadPromise) {
      try {
        await _loadPromise;
      } catch { /* ignore concurrent load error on reset */ }
    }
    while (_inFlightWrite) {
      await _inFlightWrite;
    }
    _state = _createEmptyState();
    _loaded = true;
    _dirty = true;
    await _startWriteLoop();
    return _cloneState(_state);
  }

  function setDebounceMs(ms) {
    if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) {
      _debounceMs = Math.floor(ms);
    }
  }

  return {
    record,
    getStats,
    loadStats,
    flush,
    resetStats,
    setDebounceMs
  };
})();

const QuizProviders = (() => {
  'use strict';

  // ──────────────────────────────────────────────
  // Provider Registry
  // ──────────────────────────────────────────────
  const PROVIDERS = {
    groq: {
      name: 'Groq',
      icon: '⚡',
      type: 'openai-compatible',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKeyField: 'groqApiKey',
      textModels: [
        // Contextes vérifiés depuis console.groq.com/docs/models
        { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (Recommandé)', free: true, contextLimit: 131072 },
        { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (Ultra rapide)', free: true, contextLimit: 131072 },
        { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (Raisonnement)', free: true, contextLimit: 131072 },
        { id: 'meta-models/muse-spark-open', label: 'Muse Spark Open', free: true, contextLimit: 131072 },
        { id: 'minimaxai/minimax-m2.7', label: 'MiniMax M2.7', free: true, contextLimit: 196608 },
      ],
      visionModels: [
        // Qwen 3.8 27B & Muse Spark Open supportent texte + images sur Groq
        { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B Vision', free: true, contextLimit: 131072 },
        { id: 'meta-models/muse-spark-open', label: 'Muse Spark Open Vision', free: true, contextLimit: 131072 },
      ],
      defaultTextModel: 'openai/gpt-oss-120b',
      defaultVisionModel: 'qwen/qwen3.8-27b',
    },

    gemini: {
      name: 'Gemini',
      icon: '💎',
      type: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKeyField: 'geminiApiKey',
      textModels: [
        // Gemini 4 / 3.x et Gemma 4 vérifiés sur ai.google.dev/gemini-api/docs/models & /docs/pricing
        { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (Recommandé)', free: true, contextLimit: 1048576 },
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', free: true, contextLimit: 1048576 },
        { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', free: true, contextLimit: 1048576 },
        { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (Rapide)', free: true, contextLimit: 1048576 },
        { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', free: true, contextLimit: 1048576 },
        { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (Legacy)', free: true, contextLimit: 1000000 },
        { id: 'gemma-4-31b-it', label: 'Gemma 4 31B (Raisonnement)', free: true, contextLimit: 262144 },
        { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B MoE (Vitesse)', free: true, contextLimit: 262144 },
        { id: 'gemma-4-12b-it', label: 'Gemma 4 12B', free: true, contextLimit: 262144 },
        { id: 'gemma-4-e4b-it', label: 'Gemma 4 Edge (4B)', free: true, contextLimit: 131072 },
        { id: 'gemma-4-e2b-it', label: 'Gemma 4 Edge (2B)', free: true, contextLimit: 131072 },
        { id: 'gemini-4-argon', label: 'Gemini 4 Argon (Payant)', free: false, contextLimit: 1048576 },
        { id: 'gemini-4-neon', label: 'Gemini 4 Neon (Flagship Payant)', free: false, contextLimit: 1048576 },
        { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon (Flash Payant)', free: false, contextLimit: 1048576 },
      ],
      visionModels: [
        { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (Vision)', free: true, contextLimit: 1048576 },
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Vision)', free: true, contextLimit: 1048576 },
        { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (Vision)', free: true, contextLimit: 1048576 },
        { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (Vision)', free: true, contextLimit: 1048576 },
        { id: 'gemma-4-31b-it', label: 'Gemma 4 31B (Vision)', free: true, contextLimit: 262144 },
        { id: 'gemini-4-argon', label: 'Gemini 4 Argon (Vision Payant)', free: false, contextLimit: 1048576 },
        { id: 'gemini-4-neon', label: 'Gemini 4 Neon (Vision Payant)', free: false, contextLimit: 1048576 },
      ],
      defaultTextModel: 'gemini-4-hydrogen',
      defaultVisionModel: 'gemini-4-hydrogen',
    },

    nvidia: {
      name: 'NVIDIA NIM',
      icon: '🟢',
      type: 'openai-compatible',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKeyField: 'nvidiaApiKey',
      textModels: [
        // Catalogue live vérifié sur integrate.api.nvidia.com/v1/models (crédits gratuits build.nvidia.com)
        { id: 'moonshotai/kimi-k3.1-pro', label: 'Kimi k3.1 Pro (Thinking)', free: true, contextLimit: 1048576 },
        { id: 'nvidia/nemotron-3.5-super-vl-120b-a12b', label: 'Nemotron 3.5 Super 120B', free: true, contextLimit: 1048576 },
        { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', label: 'Nemotron 3.5 Lightning 30B (Rapide)', free: true, contextLimit: 1048576 },
        { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: 'Nemotron 3 Ultra 550B', free: true, contextLimit: 1048576 },
        { id: 'mistralai/mistral-large-4-1t-a52b', label: 'Mistral Large 4', free: true, contextLimit: 1048576 },
        { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash', free: true, contextLimit: 1048576 },
        { id: 'minimaxai/minimax-m3.1-flash', label: 'MiniMax M3.1 Flash', free: true, contextLimit: 1048576 },
        { id: 'google/gemma-4-31b-it', label: 'Gemma 4 31B', free: true, contextLimit: 262144 },
        { id: 'stepfun-ai/step-5-preview', label: 'Step 5 Preview', free: true, contextLimit: 1048576 },
      ],
      visionModels: [
        { id: 'nvidia/nemotron-3.5-super-vl-120b-a12b', label: 'Nemotron 3.5 Super VL (Vision)', free: true, contextLimit: 1048576 },
        { id: 'moonshotai/kimi-k3.1-pro', label: 'Kimi k3.1 Pro (Vision)', free: true, contextLimit: 1048576 },
        { id: 'mistralai/mistral-large-4-1t-a52b', label: 'Mistral Large 4 (Vision)', free: true, contextLimit: 1048576 },
        { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash (Vision)', free: true, contextLimit: 1048576 },
        { id: 'minimaxai/minimax-m3.1-flash', label: 'MiniMax M3.1 Flash (Vision)', free: true, contextLimit: 1048576 },
        { id: 'google/gemma-4-31b-it', label: 'Gemma 4 31B (Vision)', free: true, contextLimit: 262144 },
      ],
      defaultTextModel: 'moonshotai/kimi-k3.1-pro',
      defaultVisionModel: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
    },

    mistral: {
      name: 'Mistral',
      icon: '🌀',
      type: 'openai-compatible',
      baseUrl: 'https://api.mistral.ai/v1',
      apiKeyField: 'mistralApiKey',
      textModels: [
        { id: 'mistral-small-latest', label: 'Mistral Small 4 (Rapide)', free: false, contextLimit: 256000 },
        { id: 'mistral-large-latest', label: 'Mistral Large 4 (Flagship)', free: false, contextLimit: 1000000 },
        { id: 'codestral-latest', label: 'Codestral (Code & FIM)', free: false, contextLimit: 131072 },
      ],
      visionModels: [
        { id: 'mistral-small-latest', label: 'Mistral Small 4 Vision', free: false, contextLimit: 256000 },
        { id: 'mistral-large-latest', label: 'Mistral Large 4 Vision', free: false, contextLimit: 1000000 },
      ],
      defaultTextModel: 'mistral-small-latest',
      defaultVisionModel: 'mistral-small-latest',
    },

    claude: {
      name: 'Claude',
      icon: '🟣',
      type: 'claude',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKeyField: 'claudeApiKey',
      textModels: [
        { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (Recommandé)', free: false, contextLimit: 1000000 },
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (Flagship)', free: false, contextLimit: 1000000 },
        { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (Rapide)', free: false, contextLimit: 1000000 },
        { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 (Raisonnement)', free: false, contextLimit: 1000000 },
      ],
      visionModels: [
        { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 Vision', free: false, contextLimit: 1000000 },
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 Vision', free: false, contextLimit: 1000000 },
        { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 Vision', free: false, contextLimit: 1000000 },
        { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 Vision', free: false, contextLimit: 1000000 },
      ],
      defaultTextModel: 'claude-sonnet-5-5',
      defaultVisionModel: 'claude-sonnet-5-5',
    },
  };

  // Default provider priority (free-first)
  const DEFAULT_PRIORITY = ['groq', 'gemini', 'nvidia', 'mistral', 'claude'];

  // Cache synchrone en mémoire : Map<`${providerKey}:${modelId}`, contextWindow>
  // Alimenté statiquement au démarrage et mis à jour après une sync dynamique (ModelRegistry).
  // Invariant : toujours retourne une valeur >= 1000 depuis getModelContextLimit.
  const _contextWindowCache = new Map();

  // ── NOTE : _initStaticContextCache() est appelée juste avant le return du module.
  //           Le bloc ci-dessus (void) était un placeholder provisoire — supprimé.

  /**
   * Initialise le cache synchrone depuis PROVIDERS (données statiques).
   * Doit être appelée une fois après la déclaration de PROVIDERS.
   * Invariant de postcondition : _contextWindowCache contient au moins 1 entrée par provider.
   */
  function _initStaticContextCache() {
    for (const [pKey, pDef] of Object.entries(PROVIDERS)) {
      const allModels = [...(pDef.textModels || []), ...(pDef.visionModels || [])];
      for (const m of allModels) {
        if (m.id && m.contextLimit) {
          _contextWindowCache.set(`${pKey}:${m.id}`, m.contextLimit);
        }
      }
    }
  }

  /**
   * Met à jour le cache synchrone depuis des données dynamiques (résultat de ModelRegistry).
   * Appelée après une synchronisation réussie via ModelRegistry.syncProviderModels().
   * Invariant : ne lève jamais d'exception.
   * @param {string} providerKey
   * @param {Array<{id: string, contextWindow: number}>} models
   */
  function warmContextCache(providerKey, models) {
    if (!Array.isArray(models)) return;
    for (const m of models) {
      if (m.id && m.contextWindow > 0) {
        _contextWindowCache.set(`${providerKey}:${m.id}`, m.contextWindow);
      }
    }
    console.log(`🔥 warmContextCache [${providerKey}]: ${models.length} entrées chargées.`);
  }

  /**
   * Helper to fetch the actual context limit for a specific provider & model.
   * Consulte d'abord le cache synchrone en mémoire (alimenté par données statiques
   * ou dynamiques via warmContextCache), puis fallback sur PROVIDERS statique.
   * Invariant de postcondition : retourne toujours un entier >= 1000.
   * @param {string} providerKey
   * @param {string} modelId
   * @returns {number}
   */
  function getModelContextLimit(providerKey, modelId) {
    // 1. Consulter le cache synchrone en mémoire (le plus à jour)
    const cacheKey = `${providerKey}:${modelId}`;
    if (_contextWindowCache.has(cacheKey)) {
      return _contextWindowCache.get(cacheKey);
    }

    // 2. Fallback sur les données statiques de PROVIDERS
    const provider = PROVIDERS[providerKey];
    if (!provider) return 100000;

    const modelObj = [...(provider.textModels || []), ...(provider.visionModels || [])]
      .find(m => m.id === modelId);

    return (modelObj && modelObj.contextLimit) ? modelObj.contextLimit : 100000;
  }

  /**
   * Helper to find the first provider in priority list that has an API key configured.
   */
  function getFirstConfiguredProvider(syncConfig, order) {
    for (const pKey of order) {
      const provider = PROVIDERS[pKey];
      if (provider && syncConfig[provider.apiKeyField] && syncConfig[provider.apiKeyField].length > 0) {
        return pKey;
      }
    }
    return order[0]; // fallback
  }

  // ──────────────────────────────────────────────
  // Intelligent Text ↔ Vision Switcher
  // ──────────────────────────────────────────────

  /**
   * Select the correct model for the given context.
   * When images are present, use the vision model; otherwise text model.
   */
  function getModelForContext(providerKey, hasImages, overrides = {}) {
    // Règle 8.5 : assertions de préconditions
    if (typeof providerKey !== 'string') {
      throw new Error('L\'argument providerKey doit être une chaîne de caractères.');
    }
    if (typeof hasImages !== 'boolean') {
      throw new Error('L\'argument hasImages doit être un booléen.');
    }

    const normalizedKey = providerKey.toLowerCase();
    const provider = PROVIDERS[normalizedKey];
    if (!provider) throw new Error(`Provider inconnu: ${providerKey}`);

    const nestedOverride = overrides?.[normalizedKey];
    if (hasImages) {
      return nestedOverride?.vision || overrides?.[`${normalizedKey}_visionModel`] || provider.defaultVisionModel;
    }
    return nestedOverride?.text || overrides?.[`${normalizedKey}_textModel`] || provider.defaultTextModel;
  }

  // ──────────────────────────────────────────────
  // Unified API Callers
  // ──────────────────────────────────────────────

  function _proxyFetchViaRuntime(url, fetchOptions, signal) {
    if (signal && signal.aborted) {
      return Promise.reject(_ProviderNetUtils.createAbortError(signal.reason));
    }

    const { signal: _ignoredSignal, retry: _ignoredRetry, timeoutMs: _ignoredTimeout, ...serializableOptions } = fetchOptions || {};

    return new Promise((resolve, reject) => {
      let settled = false;
      let onAbort = null;

      const cleanup = () => {
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
          onAbort = null;
        }
      };

      if (signal) {
        onAbort = () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(_ProviderNetUtils.createAbortError(signal.reason));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        chrome.runtime.sendMessage({ action: 'fetchLLM', url, options: serializableOptions }, (response) => {
          if (settled) return;
          settled = true;
          cleanup();

          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (!response) {
            return reject(new Error('Pas de réponse du proxy'));
          }
          if (response.networkError || response.success === false) {
            const msg = response.error || 'Erreur proxy LLM';
            const err = new Error(msg);
            if (msg.includes('non autorisée') || msg.startsWith('Timeout:')) {
              err.retryable = false;
            } else if (response.networkError) {
              err.networkError = true;
            }
            return reject(err);
          }

          // Mock fetch response object (preserves status & optional headers for retry handling)
          resolve({
            ok: response.ok,
            status: response.status,
            headers: response.headers || null,
            json: async () => response.data
          });
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      }
    });
  }

  /**
   * Fetch wrapper that routes requests based on execution context:
   * - Service Worker : fetch() direct (pas de CORS dans le SW)
   * - Content Script / Popup : proxy via chrome.runtime.sendMessage → background fetchLLM
   * - Hors extension : fetch() direct avec timeout
   * Wired with fetchWithRetry for transient 429/5xx/network failures.
   */
  async function extensionFetch(url, options) {
    // Règle 8.5 : assertions de préconditions
    if (typeof url !== 'string' || !url.startsWith('http')) {
      throw new Error('L\'argument url doit être une chaîne de caractères valide commençant par http.');
    }

    const opts = options && typeof options === 'object' ? options : {};
    const timeoutMs = (typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0)
      ? opts.timeoutMs
      : 120000;
    const { retry: retryConfig, timeoutMs: _ignoredTimeout, ...rawFetchOptions } = opts;
    const reqSignal = opts.signal || null;
    const retrySig = (retryConfig && typeof retryConfig === 'object' && retryConfig.signal) ? retryConfig.signal : null;
    let signal = null;
    let cleanupSignals = null;

    if (reqSignal && retrySig && reqSignal !== retrySig) {
      if (reqSignal.aborted) {
        throw _ProviderNetUtils.createAbortError(reqSignal.reason);
      }
      if (retrySig.aborted) {
        throw _ProviderNetUtils.createAbortError(retrySig.reason);
      }
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
        signal = AbortSignal.any([reqSignal, retrySig]);
      } else {
        const combinedController = new AbortController();
        const onReqAbort = () => combinedController.abort(reqSignal.reason);
        const onRetryAbort = () => combinedController.abort(retrySig.reason);
        reqSignal.addEventListener('abort', onReqAbort, { once: true });
        retrySig.addEventListener('abort', onRetryAbort, { once: true });
        signal = combinedController.signal;
        cleanupSignals = () => {
          reqSignal.removeEventListener('abort', onReqAbort);
          retrySig.removeEventListener('abort', onRetryAbort);
        };
      }
    } else {
      signal = reqSignal || retrySig || null;
    }

    const fetchOptions = signal ? { ...rawFetchOptions, signal } : rawFetchOptions;

    if (signal && signal.aborted) {
      if (cleanupSignals) cleanupSignals();
      throw _ProviderNetUtils.createAbortError(signal.reason);
    }

    // Détection du contexte Service Worker : on peut fetch() directement sans proxy
    // car le SW n'a pas de restrictions CORS (contrairement aux content scripts).
    // Envoyer sendMessage() du SW vers lui-même provoque "message port closed".
    const isServiceWorker = typeof ServiceWorkerGlobalScope !== 'undefined' &&
      self instanceof ServiceWorkerGlobalScope;
    const useProxy = !isServiceWorker &&
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === 'function';

    const performSingleAttempt = () => {
      if (useProxy) {
        return _proxyFetchViaRuntime(url, fetchOptions, signal);
      }
      return _directFetchWithTimeout(url, fetchOptions, timeoutMs);
    };

    try {
      if (retryConfig === false) {
        return await performSingleAttempt();
      }

      const retryOptions = {
        ...(retryConfig && typeof retryConfig === 'object' ? retryConfig : {}),
        signal
      };

      return await fetchWithRetry(performSingleAttempt, retryOptions);
    } finally {
      if (cleanupSignals) cleanupSignals();
    }
  }

  /**
   * Helper interne : fetch() avec timeout explicite et AbortSignal.
   * Utilisé par le Service Worker et le fallback hors extension.
   * Invariant : retourne un objet Response natif ou lève une erreur.
   * @param {string} url
   * @param {Object} options
   * @param {number} timeoutMs
   * @returns {Promise<Response>}
   */
  const _sanitizeUrl = _ProviderNetUtils.sanitizeUrl;

  async function _directFetchWithTimeout(url, options, timeoutMs) {
    const externalSignal = options?.signal;
    if (externalSignal && externalSignal.aborted) {
      throw _ProviderNetUtils.createAbortError(externalSignal.reason || 'Requête annulée avant envoi (signal externe).');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.warn(`⏱️ extensionFetch timeout (${timeoutMs}ms) sur l'URL : ${_sanitizeUrl(url).substring(0, 80)}...`);
    }, timeoutMs);

    // Écouter l'abort externe pour propager au controller interne
    let externalAbortHandler = null;
    if (externalSignal) {
      externalAbortHandler = () => controller.abort();
      externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }

    try {
      // Retirer le signal externe des options, on utilise notre controller unifié
      const { signal: _ignoredSignal, ...restOptions } = options || {};
      const response = await fetch(url, { ...restOptions, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (_ProviderNetUtils.isAbortError(error, externalSignal)) {
        if (externalSignal && externalSignal.aborted) {
          const abortErr = new Error('Requête annulée par le signal externe.');
          abortErr.name = 'AbortError';
          abortErr.code = 'ABORT_ERR';
          throw abortErr;
        }
        const timeoutErr = new Error(`La requête réseau a expiré après ${timeoutMs / 1000} secondes.`);
        timeoutErr.isTimeout = true;
        throw timeoutErr;
      }
      throw error;
    } finally {
      if (externalSignal && externalAbortHandler) {
        externalSignal.removeEventListener('abort', externalAbortHandler);
      }
    }
  }

  /**
   * Build OpenAI-compatible messages array with optional images
   */
  function buildOpenAIMessages(prompt, images = []) {
    const systemPrompt = (typeof prompt === 'object' && prompt.system) ? prompt.system : null;
    const userPrompt = (typeof prompt === 'object' && prompt.user) ? prompt.user : (typeof prompt === 'string' ? prompt : '');

    const msgs = [];
    if (systemPrompt) {
      msgs.push({ role: 'system', content: systemPrompt });
    }

    if (images.length === 0) {
      msgs.push({ role: 'user', content: userPrompt });
      return msgs;
    }

    // Multimodal message with text + images
    const contentParts = [{ type: 'text', text: userPrompt }];
    images.forEach(img => {
      contentParts.push({
        type: 'image_url',
        image_url: {
          url: img.dataUrl, // data:image/jpeg;base64,...
          detail: 'auto'
        }
      });
    });

    msgs.push({ role: 'user', content: contentParts });
    return msgs;
  }

  /**
   * Call any OpenAI-compatible endpoint (Groq, NVIDIA, Fireworks, Mistral)
   */
  async function callOpenAICompatible(providerKey, apiKey, model, prompt, images = [], extraConfig = {}) {
    const normalizedKey = String(providerKey).toLowerCase();
    const provider = PROVIDERS[normalizedKey];
    if (!provider) throw new Error(`Provider inconnu: ${providerKey}`);
    let messages;
    let extraBodyParams = {};

    const lowerModel = model.toLowerCase();
    // Les modèles legacy NeVA/Phi sur NVIDIA NIM attendent <img src="..."> ; les VLM récents utilisent image_url standard
    const isLegacyNvidiaVision = normalizedKey === 'nvidia' && (lowerModel.includes('phi-') || lowerModel.includes('neva'));
    if (isLegacyNvidiaVision && images.length > 0) {
      const systemPrompt = (typeof prompt === 'object' && prompt.system) ? prompt.system : null;
      const userPrompt = (typeof prompt === 'object' && prompt.user) ? prompt.user : (typeof prompt === 'string' ? prompt : '');
      const imgTags = images.map(img => `<img src="${img.dataUrl}" />`).join(' ');

      messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({
        role: 'user',
        content: `${userPrompt}\n${imgTags}`
      });
    } else {
      messages = buildOpenAIMessages(prompt, images);
    }

    const isGroqReasoningModel = /gpt-oss|qwen3|muse-spark|minimax|kimi|deepseek|reasoning/.test(lowerModel);
    const isNvidiaReasoningModel = /kimi|nemotron|deepseek|mistral-large|glm-5|minimax|step-5|reasoning/.test(lowerModel);

    // Configuration du thinking pour les providers OpenAI-compatibles
    if (extraConfig.thinking?.enabled) {
      if (normalizedKey === 'groq') {
        if (isGroqReasoningModel) {
          // reasoning_format et include_reasoning sont mutuellement exclusifs sur Groq
          extraBodyParams.reasoning_format = 'parsed';
          extraBodyParams.reasoning_effort = extraConfig.thinking.effort || 'high';
        }
      } else if (normalizedKey === 'nvidia') {
        if (isNvidiaReasoningModel) {
          // NVIDIA NIM requiert chat_template_kwargs pour activer le thinking sur les modèles de raisonnement
          extraBodyParams.chat_template_kwargs = { enable_thinking: true, thinking: true };
          extraBodyParams.reasoning_effort = extraConfig.thinking.effort || 'high';
        }
      } else {
        // Paramètre de raisonnement générique OpenAI / Mistral
        const isReasoningModel = lowerModel.includes('kimi') ||
          lowerModel.includes('deepseek') ||
          lowerModel.includes('nemotron') ||
          lowerModel.includes('gpt-oss') ||
          lowerModel.includes('qwen3') ||
          lowerModel.includes('mistral-large') ||
          lowerModel.includes('mistral-small') ||
          lowerModel.includes('magistral') ||
          lowerModel.includes('glm-5') ||
          lowerModel.includes('minimax-m3') ||
          lowerModel.includes('step-5') ||
          lowerModel.includes('devstral') ||
          lowerModel.includes('reasoning');
        if (isReasoningModel) {
          extraBodyParams.reasoning_effort = extraConfig.thinking.effort || 'high';
        }
      }
    } else if (normalizedKey === 'groq' && isGroqReasoningModel) {
      extraBodyParams.reasoning_format = 'hidden';
    }

    console.log(`🔗 [${provider.name}] Appel ${model}...`);

    // Adjust token limit: Vision models (like Phi) often have lower output limits than reasoning models
    let defaultMaxTokens = 4096;
    if (normalizedKey === 'nvidia') {
      defaultMaxTokens = lowerModel.includes('phi') ? 4096 : 16384;
    }

    const payload = {
      model: model,
      messages: messages,
      max_tokens: extraConfig.maxTokens || defaultMaxTokens,
      // Laisser la température par défaut du provider si non demandée explicitement (et jamais en mode thinking)
      ...(typeof extraConfig.temperature === 'number' && !extraConfig.thinking?.enabled
        ? { temperature: extraConfig.temperature }
        : {}),
      stream: false,
      ...extraBodyParams
    };

    // Routage vers l'endpoint personnalisé pour Codestral si requis
    let targetBaseUrl = provider ? provider.baseUrl : '';
    if (normalizedKey === 'mistral' && lowerModel.includes('codestral')) {
      targetBaseUrl = 'https://codestral.mistral.ai/v1';
      console.log(`✨ Redirection transparente de Codestral vers son endpoint personnalisé : ${targetBaseUrl}`);
    }

    const response = await extensionFetch(`${targetBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: extraConfig?.signal,
      retry: extraConfig?.retry
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) || {};
      const errorDetail = errorData.error?.message || errorData.detail || (Object.keys(errorData).length > 0 ? JSON.stringify(errorData) : '');
      const error = new Error(errorDetail ? `Erreur ${provider.name}: ${errorDetail}` : `Erreur ${provider.name}: Code HTTP ${response.status}`);
      error.status = response.status;
      error.providerName = provider.name;
      throw error;
    }

    const data = await response.json();
    console.log(`✅ [${provider.name}] Réponse reçue`);

    const choice = data.choices?.[0];
    let outputText = choice?.message?.content || '';
    let thinkingText = choice?.message?.reasoning_content || choice?.message?.reasoning || '';

    // Extraction robuste en cas de balisage <think>...</think> dans le texte de réponse brute (ex: DeepSeek-R1)
    if (outputText.includes('<think>')) {
      const thinkStart = outputText.indexOf('<think>');
      const thinkEnd = outputText.indexOf('</think>');
      if (thinkStart !== -1 && thinkEnd !== -1) {
        thinkingText = outputText.substring(thinkStart + 7, thinkEnd).trim();
        outputText = (outputText.substring(0, thinkStart) + outputText.substring(thinkEnd + 8)).trim();
      }
    }

    if (thinkingText) {
      console.log(`💭 [${provider.name} Thoughts]:\n${thinkingText}`);
    }

    return outputText || '';
  }

  async function callClaudeProvider(apiKey, model, prompt, images = [], maxTokens = 4096, thinkingConfig = null, extraConfig = {}) {
    console.log(`🟣 [Claude] Appel ${model}...`);

    const systemPrompt = (typeof prompt === 'object' && prompt.system) ? prompt.system : null;
    const userPrompt = (typeof prompt === 'object' && prompt.user) ? prompt.user : (typeof prompt === 'string' ? prompt : '');

    // Build content blocks
    const contentBlocks = [];

    // Add images first
    images.forEach(img => {
      const base64Data = img.dataUrl.split(',')[1]; // Remove data:image/...;base64, prefix
      const mediaType = img.mimeType || 'image/jpeg';
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64Data,
        }
      });
    });

    // Add text prompt
    contentBlocks.push({ type: 'text', text: userPrompt });

    const requestBody = {
      model: model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: contentBlocks }]
    };

    if (systemPrompt) {
      requestBody.system = systemPrompt;
    }

    // Détection de la génération du modèle Claude (Claude 5+ / Opus 4.6-4.8 : adaptive thinking)
    const isAdaptiveClaude = /claude-(?:opus|sonnet|haiku|fable)-5|claude-opus-4-[678]/i.test(model);
    // Opus 4.7+, Opus 5.x, Sonnet 5.x, Haiku 5.x et Fable 5.x déprécient/rejettent temperature (HTTP 400)
    const isSamplingDeprecatedClaude = /claude-(?:opus|sonnet|haiku|fable)-5|claude-opus-4-[78]/i.test(model);

    if (thinkingConfig?.enabled) {
      if (isAdaptiveClaude) {
        requestBody.thinking = {
          type: 'adaptive',
          display: 'summarized' // Permet d'obtenir le flux de pensée dans le stream/JSON
        };
        requestBody.output_config = {
          effort: thinkingConfig.effort || 'high'
        };
      } else {
        // Fallback legacy pour les modèles plus anciens comme Claude 3.5/3.7 (max_tokens doit dépasser budget_tokens)
        const budgetTokens = thinkingConfig.depth ?? 10000;
        requestBody.max_tokens = Math.max(maxTokens, budgetTokens + 1024);
        requestBody.thinking = {
          type: 'enabled',
          budget_tokens: budgetTokens
        };
        requestBody.temperature = 1.0; // Spécification Anthropic requise pour le mode thinking legacy
      }
    } else if (!isSamplingDeprecatedClaude && typeof extraConfig?.temperature === 'number') {
      // Sur modèles legacy uniquement si demandé explicitement ; sinon température par défaut du provider
      requestBody.temperature = extraConfig.temperature;
    }

    const response = await extensionFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(requestBody),
      signal: extraConfig?.signal,
      retry: extraConfig?.retry
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error?.message || `Erreur Claude: ${response.status}`);
      error.status = response.status;
      error.providerName = 'Claude';
      throw error;
    }

    const data = await response.json();
    console.log(`✅ [Claude] Réponse reçue`);

    // Séparation et extraction du flux de pensée (thinking) et du texte final
    const content = data.content || [];
    let outputText = '';
    let thinkingText = '';

    for (const block of content) {
      if (block.type === 'thinking') {
        thinkingText += block.thinking || '';
      } else if (block.type === 'text') {
        outputText += block.text || '';
      }
    }

    if (thinkingText) {
      console.log(`💭 [Claude Thoughts]:\n${thinkingText}`);
    }

    return outputText || '';
  }

  /**
   * Call Gemini API (Google-specific format)
   */
  async function callGeminiProvider(apiKey, model, prompt, images = [], maxTokens = 2048, thinkingConfig = null, extraConfig = {}) {
    console.log(`💎 [Gemini] Appel ${model}...`);

    const systemPrompt = (typeof prompt === 'object' && prompt.system) ? prompt.system : null;
    const userPrompt = (typeof prompt === 'object' && prompt.user) ? prompt.user : (typeof prompt === 'string' ? prompt : '');

    const parts = [];

    // Add images
    images.forEach(img => {
      const base64Data = img.dataUrl.split(',')[1];
      const mimeType = img.mimeType || 'image/jpeg';
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      });
    });

    // Add text
    parts.push({ text: userPrompt });

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const generationConfig = {
      maxOutputTokens: maxTokens
    };

    if (typeof extraConfig?.temperature === 'number' && !thinkingConfig?.enabled) {
      generationConfig.temperature = extraConfig.temperature;
    }

    // Détection de la génération du modèle Gemini (Gemini 3, Gemini 4 et Gemma 4)
    const isGemini3PlusOrGemma4 = /gemini-[34]|gemma-4/i.test(model);

    // Add thinking configuration if enabled
    if (thinkingConfig?.enabled) {
      if (isGemini3PlusOrGemma4) {
        // Gemini 3+ et Gemini 4 utilisent thinkingLevel (incompatible avec thinkingBudget)
        generationConfig.thinkingConfig = {
          thinkingLevel: thinkingConfig.level || 'HIGH'
        };
      } else {
        // Gemini 2.5 utilise thinkingBudget (depth = 0 désactive explicitement le thinking)
        generationConfig.thinkingConfig = {
          includeThoughts: (thinkingConfig.depth ?? -1) !== 0,
          thinkingBudget: thinkingConfig.depth ?? -1
        };
      }
    }

    const requestPayload = {
      contents: [{ parts }],
      generationConfig: generationConfig
    };

    if (systemPrompt) {
      requestPayload.systemInstruction = {
        parts: [{ text: systemPrompt }]
      };
    }

    const response = await extensionFetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
      signal: extraConfig?.signal,
      retry: extraConfig?.retry
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error?.message || `Erreur Gemini: ${response.status}`);
      error.status = response.status;
      error.providerName = 'Gemini';
      throw error;
    }

    const data = await response.json();
    console.log(`✅ [Gemini] Réponse reçue`);

    // Séparation et extraction du flux de pensée et du texte de réponse
    const responseParts = data.candidates?.[0]?.content?.parts || [];
    let outputText = '';
    let thinkingText = '';

    for (const part of responseParts) {
      if (part.thought === true) {
        thinkingText += part.text || '';
      } else {
        outputText += part.text || '';
      }
    }

    if (thinkingText) {
      console.log(`💭 [Gemini Thoughts]:\n${thinkingText}`);
    }

    return outputText || '';
  }

  // ──────────────────────────────────────────────
  // Call dispatcher
  // ──────────────────────────────────────────────

  /**
   * Route a call to the correct provider-specific function.
   * Records latency, success/failure, and rate-limit metrics in ProviderAnalytics.
   */
  async function callProvider(providerKey, apiKey, model, prompt, images = [], extraConfig = {}) {
    // Règle 8.5 : assertions de préconditions
    if (typeof providerKey !== 'string' || typeof apiKey !== 'string' || typeof model !== 'string' ||
      (typeof prompt !== 'string' && (typeof prompt !== 'object' || !prompt || !prompt.user))) {
      throw new Error('Arguments obligatoires manquants ou invalides dans callProvider (providerKey, apiKey, model, prompt).');
    }
    if (!Array.isArray(images)) {
      throw new Error('L\'argument images doit être un tableau.');
    }

    // Force lowercase for registry lookup but keep original for logging or error messages
    const normalizedKey = providerKey.toLowerCase();
    const provider = PROVIDERS[normalizedKey];
    if (!provider) throw new Error(`Provider inconnu: ${providerKey}`);

    const startedAt = Date.now();
    try {
      let result;
      switch (provider.type) {
        case 'openai-compatible':
          result = await callOpenAICompatible(normalizedKey, apiKey, model, prompt, images, extraConfig);
          break;
        case 'claude':
          result = await callClaudeProvider(apiKey, model, prompt, images, extraConfig.maxTokens, extraConfig.thinking, extraConfig);
          break;
        case 'gemini':
          result = await callGeminiProvider(apiKey, model, prompt, images, extraConfig.maxTokens, extraConfig.thinking, extraConfig);
          break;
        default:
          throw new Error(`Type de provider inconnu: ${provider.type}`);
      }
      ProviderAnalytics.record({
        provider: normalizedKey,
        model,
        ok: true,
        latencyMs: Date.now() - startedAt,
        status: 200
      });
      return result;
    } catch (error) {
      ProviderAnalytics.record({
        provider: normalizedKey,
        model,
        ok: false,
        latencyMs: Date.now() - startedAt,
        status: error?.status,
        error
      });
      throw error;
    }
  }

  // ──────────────────────────────────────────────
  // Smart Quota Router
  // ──────────────────────────────────────────────

  /**
   * Check if an error is a quota/rate-limit error.
   */
  function isQuotaError(error) {
    if (error.status === 429) return true;
    const msg = (error.message || '').toLowerCase();
    return msg.includes('rate limit') ||
      msg.includes('quota') ||
      msg.includes('exceeded') ||
      msg.includes('too many requests') ||
      msg.includes('resource_exhausted');
  }

  /**
   * Smart Router: tries providers in priority order.
   * Auto-switches text model ↔ vision model if images are present.
   * Auto-failovers to next provider on quota exhaustion (429).
   *
   * @param {string} prompt - The text prompt
   * @param {Array} images - Array of { dataUrl, mimeType } objects
   * @param {Object} apiKeys - Map of provider apiKeyField → key value
   * @param {Array} priority - Ordered array of provider keys
   * @param {Object} modelOverrides - Optional model ID overrides per provider
   * @param {Object} extraConfig - { maxTokens, thinking: { enabled, depth } }
   * @returns {{ text: string, provider: string, model: string }}
   */
  async function smartRoute(prompt, images = [], apiKeys = {}, priority = null, modelOverrides = {}, extraConfig = {}) {
    // Règle 8.5 : assertions de préconditions
    if (typeof prompt !== 'string' && (typeof prompt !== 'object' || !prompt || !prompt.user)) {
      throw new Error('L\'argument prompt doit être une chaîne de caractères ou un objet avec une propriété "user".');
    }
    if (!Array.isArray(images)) {
      throw new Error('L\'argument images doit être un tableau.');
    }

    const signal = extraConfig?.signal || null;
    if (signal && signal.aborted) {
      throw _ProviderNetUtils.createAbortError(signal.reason);
    }

    const orderedProviders = priority || DEFAULT_PRIORITY;
    const hasImages = images.length > 0;
    const triedProviders = [];

    console.log(`🧠 Smart Router: ${hasImages ? '🖼️ Mode Vision' : '📝 Mode Texte'}, ${orderedProviders.length} providers disponibles`);

    for (const providerKey of orderedProviders) {
      if (signal && signal.aborted) {
        throw _ProviderNetUtils.createAbortError(signal.reason);
      }

      const provider = PROVIDERS[providerKey];
      if (!provider) continue;

      const apiKey = apiKeys[provider.apiKeyField];
      if (!apiKey) {
        console.log(`   ⏭️ ${provider.name}: pas de clé API`);
        continue;
      }

      const model = getModelForContext(providerKey, hasImages, modelOverrides);
      console.log(`   🔄 Essai ${provider.icon} ${provider.name} → ${model}`);

      try {
        const text = await callProvider(providerKey, apiKey, model, prompt, images, extraConfig);
        console.log(`   ✅ ${provider.name} a répondu avec succès!`);
        return { text, provider: providerKey, providerName: provider.name, model };
      } catch (error) {
        if (_ProviderNetUtils.isAbortError(error, signal)) {
          throw error;
        }
        console.warn(`   ⚠️ ${provider.name} (Modèle principal ${model}) a échoué: ${error.message}`);

        // Tentative de fallback interne sur les modèles alternatifs du même provider
        const altModels = (hasImages ? (provider.visionModels || []) : (provider.textModels || []))
          .filter(m => m.id !== model);

        let successWithAlt = false;
        let altText = '';
        let altModelUsed = '';

        if (altModels.length > 0) {
          console.log(`   🔄 Tentative de repli sur les modèles alternatifs de ${provider.name} (${altModels.length} disponibles)...`);
          for (const altModel of altModels) {
            if (signal && signal.aborted) {
              throw _ProviderNetUtils.createAbortError(signal.reason);
            }
            console.log(`     🔄 Essai modèle alternatif → ${altModel.id}`);
            try {
              altText = await callProvider(providerKey, apiKey, altModel.id, prompt, images, extraConfig);
              console.log(`     ✅ Succès avec le modèle alternatif ${altModel.id}!`);
              successWithAlt = true;
              altModelUsed = altModel.id;
              break;
            } catch (altError) {
              if (_ProviderNetUtils.isAbortError(altError, signal)) {
                throw altError;
              }
              console.warn(`     ❌ Échec du modèle alternatif ${altModel.id}: ${altError.message}`);
            }
          }
        }

        if (successWithAlt) {
          return { text: altText, provider: providerKey, providerName: provider.name, model: altModelUsed };
        }

        triedProviders.push(provider.name);
        const isForcedSelection = priority && priority.length > 0 && priority[0] === providerKey;

        if (isQuotaError(error)) {
          console.warn(`   ⚠️ ${provider.name}: quota épuisé (tous les modèles ont échoué), passage au suivant...`);
          continue;
        }

        if (isForcedSelection) {
          console.error(`   ❌ ${provider.name} (Forcé, tous les modèles ont échoué): ${error.message}`);
          throw error; // Arrêt si choix forcé par l'utilisateur
        }

        // Non-quota error on non-forced provider: log but continue trying
        console.error(`   ❌ ${provider.name} (tous les modèles ont échoué): ${error.message}`);
        continue;
      }
    }

    throw new Error(
      `Tous les providers ont échoué.\nEssayés: ${triedProviders.join(', ') || 'aucun (pas de clés API configurées)'}\nConfigurez vos clés API dans les paramètres.`
    );
  }

  // ──────────────────────────────────────────────
  // Pre-Warm Pipeline (F-AUTO-02)
  // ──────────────────────────────────────────────

  const DEFAULT_PREWARM_TTL_MS = 60000;
  let _preWarmInFlight = null;
  let _lastPreWarmAt = 0;
  let _lastPreWarmProviders = [];
  let _warmupMeta = {
    lastWarmedAt: null,
    providersReady: [],
    cacheSize: 0
  };

  /**
   * Pre-warms ConfigCache, ModelRegistry context cache, and provider readiness metadata
   * without making any billable LLM generation calls.
   * Deduplicated via an in-flight promise guard and TTL cooldown (60s default).
   * @param {Object} [options]
   * @returns {Promise<{warmed: boolean, cached?: boolean, providersReady: string[], durationMs: number}>}
   */
  async function preWarmProviders(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const force = opts.force === true;
    const ttlMs = (typeof opts.ttlMs === 'number' && Number.isFinite(opts.ttlMs) && opts.ttlMs >= 0)
      ? opts.ttlMs
      : DEFAULT_PREWARM_TTL_MS;
    const nowFn = typeof opts.now === 'function' ? opts.now : Date.now;

    if (_preWarmInFlight) {
      return _preWarmInFlight;
    }

    const currentNow = nowFn();
    if (!force && _lastPreWarmAt > 0 && (currentNow - _lastPreWarmAt) < ttlMs) {
      return {
        warmed: false,
        cached: true,
        providersReady: [..._lastPreWarmProviders],
        durationMs: 0
      };
    }

    _preWarmInFlight = (async () => {
      const startedAt = nowFn();
      try {
        if (typeof ConfigCache !== 'undefined' && !ConfigCache.isInitialized()) {
          await ConfigCache.init();
        }
        if (typeof ProviderAnalytics !== 'undefined' && typeof ProviderAnalytics.loadStats === 'function') {
          await ProviderAnalytics.loadStats();
        }

        const config = (opts.config && typeof opts.config === 'object')
          ? opts.config
          : (typeof ConfigCache !== 'undefined' ? ConfigCache.getAll() : {});

        const order = Array.isArray(config.providerOrder) && config.providerOrder.length > 0
          ? config.providerOrder
          : DEFAULT_PRIORITY;
        const candidateKeys = [...new Set([...order, ...Object.keys(PROVIDERS)])];

        const providersReady = [];
        for (const pKey of candidateKeys) {
          const pDef = PROVIDERS[pKey];
          if (!pDef) continue;
          const keyVal = config[pDef.apiKeyField];
          if (typeof keyVal === 'string' && keyVal.trim().length > 0) {
            providersReady.push(pKey);
          }
        }

        const warmTasks = providersReady.map(async (pKey) => {
          const pDef = PROVIDERS[pKey];
          const apiKey = config[pDef.apiKeyField];
          let cachedModels = null;

          if (typeof ModelRegistry !== 'undefined') {
            if (opts.syncModels === true && typeof ModelRegistry.syncProviderModels === 'function') {
              await ModelRegistry.syncProviderModels(pKey, apiKey);
            }
            if (typeof ModelRegistry.getCachedModels === 'function') {
              cachedModels = await ModelRegistry.getCachedModels(pKey);
            }
          }

          if (Array.isArray(cachedModels) && cachedModels.length > 0) {
            if (typeof ModelRegistry !== 'undefined' && typeof ModelRegistry.warmContextCache === 'function') {
              ModelRegistry.warmContextCache(pKey, cachedModels);
            } else {
              warmContextCache(pKey, cachedModels);
            }
          } else {
            const seenIds = new Set();
            const staticModels = [];
            for (const m of [...(pDef.textModels || []), ...(pDef.visionModels || [])]) {
              if (m.id && m.contextLimit > 0 && !seenIds.has(m.id)) {
                seenIds.add(m.id);
                staticModels.push({ id: m.id, contextWindow: m.contextLimit });
              }
            }
            if (staticModels.length > 0) {
              if (typeof ModelRegistry !== 'undefined' && typeof ModelRegistry.warmContextCache === 'function') {
                ModelRegistry.warmContextCache(pKey, staticModels);
              } else {
                warmContextCache(pKey, staticModels);
              }
            }
          }
        });

        await Promise.allSettled(warmTasks);

        const finishedAt = nowFn();
        _lastPreWarmAt = finishedAt;
        _lastPreWarmProviders = [...providersReady];
        _warmupMeta = {
          lastWarmedAt: finishedAt,
          providersReady: [...providersReady],
          cacheSize: _contextWindowCache.size
        };

        return {
          warmed: true,
          cached: false,
          providersReady,
          durationMs: Math.max(0, finishedAt - startedAt)
        };
      } finally {
        _preWarmInFlight = null;
      }
    })();

    return _preWarmInFlight;
  }

  function getWarmupStatus() {
    return {
      lastWarmedAt: _warmupMeta.lastWarmedAt,
      providersReady: [..._warmupMeta.providersReady],
      cacheSize: _contextWindowCache.size,
      inFlight: Boolean(_preWarmInFlight)
    };
  }

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  /**
   * Get all API key storage field names from the provider registry.
   */
  function getAllApiKeyFields() {
    return Object.values(PROVIDERS).map(p => p.apiKeyField);
  }

  // Initialise le cache synchrone depuis les données PROVIDERS (données statiques vérifiées)
  _initStaticContextCache();

  // ──────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────

  return {
    PROVIDERS,
    DEFAULT_PRIORITY,
    getModelForContext,
    getModelContextLimit,
    warmContextCache,
    getFirstConfiguredProvider,
    callProvider,
    smartRoute,
    isQuotaError,
    buildOpenAIMessages,
    getAllApiKeyFields,
    extensionFetch,
    preWarmProviders,
    getWarmupStatus,
    fetchWithRetry,
    ProviderAnalytics
  };
})();

// Export for content script usage
if (typeof window !== 'undefined') {
  window.QuizProviders = QuizProviders;
}

// ============================================================
// ModelRegistry — Découverte Dynamique des Modèles (Grand Chantier 1)
// Stratégie :
//   - Gemini  : endpoint natif /v1beta/models (inputTokenLimit, supportedGenerationMethods)
//   - Mistral : endpoint natif /v1/models (max_context_length, capabilities.vision)
//   - Claude  : endpoint natif /v1/models (max_input_tokens, capabilities)
//   - Groq / NVIDIA / Fireworks : pas de métadonnées dans le /models OAI basique
//     → on utilise les données statiques de PROVIDERS (déjà corrigées)
//
// Invariant : si la synchronisation échoue, le système reste opérationnel
//             via le fallback sur les données statiques de PROVIDERS.
// ============================================================
const ModelRegistry = (() => {
  'use strict';

  const CACHE_KEY = 'modelMetadataCache';
  // TTL de 24h en millisecondes
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  // File de sérialisation des écritures pour éviter les lost updates en sync concurrente
  let _cacheWriteQueue = Promise.resolve();

  /**
   * Retourne le cache stocké dans chrome.storage.local.
   * Invariant de postcondition : retourne toujours un objet (jamais null/undefined).
   * @returns {Promise<Object>}
   */
  async function _loadCache() {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return {};
    }
    try {
      const result = await chrome.storage.local.get(CACHE_KEY);
      return result[CACHE_KEY] || {};
    } catch (e) {
      console.warn('⚠️ ModelRegistry: impossible de lire le cache:', e.message);
      return {};
    }
  }

  /**
   * Persiste le cache dans chrome.storage.local.
   * @param {Object} cache
   */
  async function _saveCache(cache) {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return;
    }
    try {
      await chrome.storage.local.set({ [CACHE_KEY]: cache });
    } catch (e) {
      console.warn('⚠️ ModelRegistry: impossible de sauvegarder le cache:', e.message);
    }
  }

  /**
   * Vérifie si le cache pour un provider est encore valide (< 24h).
   * Invariant : retourne false si lastSync est absent ou expiré.
   * @param {Object} cache
   * @param {string} providerKey
   * @returns {boolean}
   */
  function _isCacheValid(cache, providerKey) {
    const entry = cache[providerKey];
    if (!entry || !entry.lastSync || !Array.isArray(entry.models)) {
      return false;
    }
    return (Date.now() - entry.lastSync) < CACHE_TTL_MS;
  }

  /**
   * Découverte dynamique pour Gemini.
   * L'API /v1beta/models retourne inputTokenLimit et supportedGenerationMethods.
   * @param {string} apiKey
   * @returns {Promise<Array|null>}
   */
  async function _fetchGeminiModels(apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await QuizProviders.extensionFetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) {
        console.warn(`⚠️ ModelRegistry Gemini: HTTP ${resp.status}`);
        return null;
      }
      const data = await resp.json();
      if (!Array.isArray(data.models)) {
        return null;
      }
      return data.models
        .filter(m => m.name && m.inputTokenLimit)
        .map(m => {
          const id = m.name.replace('models/', '');
          // Un modèle supporte la vision si generateContent est dans ses méthodes supportées
          // et si la description ou le displayName mentionne la vision ou multimodal.
          // En 2025+, tous les modèles Gemini Flash/Pro supportent la vision.
          const supportsVision = (m.supportedGenerationMethods || []).includes('generateContent');
          return {
            id,
            label: m.displayName || id,
            contextWindow: m.inputTokenLimit,
            maxOutputTokens: m.outputTokenLimit || 8192,
            vision: supportsVision,
            free: true
          };
        });
    } catch (e) {
      clearTimeout(timer);
      if (e.name !== 'AbortError') {
        console.warn(`⚠️ ModelRegistry Gemini: erreur fetch - ${e.message}`);
      }
      return null;
    }
  }

  /**
   * Découverte dynamique pour Mistral.
   * L'API /v1/models retourne max_context_length et capabilities.vision.
   * Gère le fallback vers l'endpoint dédié de Codestral si la clé API y est restreinte.
   * @param {string} apiKey
   * @returns {Promise<Array|null>}
   */
  async function _fetchMistralModels(apiKey) {
    const urls = [
      'https://api.mistral.ai/v1/models',
      'https://codestral.mistral.ai/v1/models'
    ];

    for (const url of urls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const resp = await QuizProviders.extensionFetch(url, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: controller.signal
        });
        clearTimeout(timer);
        if (resp.status === 401 || resp.status === 403) {
          console.warn(`⚠️ ModelRegistry Mistral [${new URL(url).origin}]: HTTP ${resp.status}, tentative de l'autre endpoint...`);
          continue; // Tente le suivant (ex: codestral)
        }
        if (!resp.ok) {
          console.warn(`⚠️ ModelRegistry Mistral [${new URL(url).origin}]: HTTP ${resp.status}`);
          continue;
        }
        const data = await resp.json();
        const items = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : null);
        if (!items) continue;
        return items
          .filter(m => m.id && m.max_context_length)
          .map(m => ({
            id: m.id,
            label: m.name || m.id,
            contextWindow: m.max_context_length,
            maxOutputTokens: m.max_context_length,
            vision: m.capabilities?.vision === true,
            free: false
          }));
      } catch (e) {
        clearTimeout(timer);
        if (e.name !== 'AbortError') {
          console.warn(`⚠️ ModelRegistry Mistral [${new URL(url).origin}]: erreur fetch - ${e.message}`);
        }
      }
    }
    return null;
  }

  /**
   * Découverte dynamique pour Claude (Anthropic).
   * L'API /v1/models retourne max_input_tokens et capabilities.
   * Nécessite l'en-tête anthropic-dangerous-direct-browser-access pour le contexte browser.
   * @param {string} apiKey
   * @returns {Promise<Array|null>}
   */
  async function _fetchClaudeModels(apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await QuizProviders.extensionFetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!resp.ok) {
        console.warn(`⚠️ ModelRegistry Claude: HTTP ${resp.status}`);
        return null;
      }
      const data = await resp.json();
      const items = Array.isArray(data.data) ? data.data : null;
      if (!items) return null;
      return items
        .filter(m => m.id && m.max_input_tokens)
        .map(m => ({
          id: m.id,
          label: m.display_name || m.id,
          contextWindow: m.max_input_tokens,
          maxOutputTokens: m.max_output_tokens || 8192,
          // image_input est le flag de vision dans l'API Claude
          vision: m.capabilities?.image_input === true,
          free: false
        }));
    } catch (e) {
      clearTimeout(timer);
      if (e.name !== 'AbortError') {
        console.warn(`⚠️ ModelRegistry Claude: erreur fetch - ${e.message}`);
      }
      return null;
    }
  }

  /**
   * Synchronise les métadonnées d'un provider donné.
   * Pour Gemini/Mistral/Claude : appel dynamique à l'API.
   * Pour Groq/NVIDIA/Fireworks : utilisation des données statiques de PROVIDERS (déjà à jour).
   *
   * Invariant : ne lève jamais d'exception — toujours retourne null en cas d'erreur.
   * @param {string} providerKey - Clé du provider (ex: 'gemini', 'mistral', 'claude')
   * @param {string} apiKey - Clé API du provider
   * @returns {Promise<void>}
   */
  async function syncProviderModels(providerKey, apiKey) {
    if (typeof providerKey !== 'string' || typeof apiKey !== 'string' || !apiKey) {
      return;
    }

    const cache = await _loadCache();

    // Si le cache est encore valide, on ne re-synchronise pas
    if (_isCacheValid(cache, providerKey)) {
      console.log(`✅ ModelRegistry [${providerKey}]: cache valide (< 24h), pas de resync.`);
      return;
    }

    let models = null;

    switch (providerKey) {
      case 'gemini':
        models = await _fetchGeminiModels(apiKey);
        break;
      case 'mistral':
        models = await _fetchMistralModels(apiKey);
        break;
      case 'claude':
        models = await _fetchClaudeModels(apiKey);
        break;
      case 'groq':
      case 'nvidia': {
        // Ces providers n'exposent pas les métadonnées dans leur /models basique.
        // On sérialise les données statiques de PROVIDERS dans le cache pour
        // que getCachedModels() soit uniforme pour tous les providers.
        const staticProvider = QuizProviders.PROVIDERS[providerKey];
        if (staticProvider) {
          const allModels = [
            ...(staticProvider.textModels || []),
            ...(staticProvider.visionModels || [])
          ];
          models = allModels.map(m => ({
            id: m.id,
            label: m.label,
            contextWindow: m.contextLimit,
            maxOutputTokens: Math.min(m.contextLimit, 16384),
            vision: (staticProvider.visionModels || []).some(vm => vm.id === m.id),
            free: m.free
          }));
        }
        break;
      }
      default:
        console.warn(`⚠️ ModelRegistry: provider inconnu - ${providerKey}`);
        return;
    }

    if (!models || models.length === 0) {
      console.warn(`⚠️ ModelRegistry [${providerKey}]: aucun modèle retourné, cache conservé.`);
      return;
    }

    // Limiter à 500 modèles max par provider pour éviter la saturation du cache Chrome.
    // Sérialiser le read-modify-write du cache pour éviter les lost updates en sync concurrente.
    const MAX_MODELS_PER_PROVIDER = 500;
    const slicedModels = models.slice(0, MAX_MODELS_PER_PROVIDER);
    const writeTask = _cacheWriteQueue.then(async () => {
      const latestCache = await _loadCache();
      latestCache[providerKey] = {
        lastSync: Date.now(),
        models: slicedModels
      };
      await _saveCache(latestCache);
    });
    _cacheWriteQueue = writeTask.catch(() => {});
    await writeTask;
    // DET-01 : Alimenter automatiquement le cache synchrone en mémoire
    QuizProviders.warmContextCache(providerKey, slicedModels);
    console.log(`✅ ModelRegistry [${providerKey}]: ${models.length} modèles synchronisés.`);
  }

  /**
   * Retourne les modèles en cache pour un provider, ou null si absent/expiré.
   * @param {string} providerKey
   * @returns {Promise<Array|null>}
   */
  async function getCachedModels(providerKey) {
    const cache = await _loadCache();
    if (!_isCacheValid(cache, providerKey)) {
      return null;
    }
    return cache[providerKey].models;
  }

  /**
   * Retourne la contextWindow d'un modèle donné depuis le cache.
   * Si absent du cache, retourne null (le caller utilisera le fallback statique).
   * @param {string} providerKey
   * @param {string} modelId
   * @returns {Promise<number|null>}
   */
  async function getContextWindowFromCache(providerKey, modelId) {
    const models = await getCachedModels(providerKey);
    if (!models) return null;
    const found = models.find(m => m.id === modelId);
    return found ? found.contextWindow : null;
  }

  /**
   * Délègue le réchauffement du cache synchrone de contexte vers QuizProviders.
   * @param {string} providerKey
   * @param {Array<{id: string, contextWindow: number}>} models
   */
  function warmContextCache(providerKey, models) {
    QuizProviders.warmContextCache(providerKey, models);
  }

  return {
    syncProviderModels,
    getCachedModels,
    getContextWindowFromCache,
    warmContextCache
  };
})();

if (typeof window !== 'undefined') {
  window.ConfigCache = ConfigCache;
  window.QuizProviders = QuizProviders;
  window.ModelRegistry = ModelRegistry;
  window.fetchWithRetry = fetchWithRetry;
  window.ProviderAnalytics = ProviderAnalytics;
}

if (typeof self !== 'undefined') {
  self.ConfigCache = ConfigCache;
  self.QuizProviders = QuizProviders;
  self.ModelRegistry = ModelRegistry;
  self.fetchWithRetry = fetchWithRetry;
  self.ProviderAnalytics = ProviderAnalytics;
}

if (typeof globalThis !== 'undefined') {
  globalThis.ConfigCache = ConfigCache;
  globalThis.QuizProviders = QuizProviders;
  globalThis.ModelRegistry = ModelRegistry;
  globalThis.fetchWithRetry = fetchWithRetry;
  globalThis.ProviderAnalytics = ProviderAnalytics;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    QuizProviders,
    ConfigCache,
    ModelRegistry,
    fetchWithRetry,
    ProviderAnalytics
  };
}
