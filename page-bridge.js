// page-bridge.js — Stealth MAIN-world bridge (F-DET-03 & F-DET-04)
/* global Symbol, WeakSet, WeakMap, Set, Map, Array, Object, String, Number, Boolean, Date, Math, JSON, RegExp, Error, Promise, URL, CustomEvent, TextEncoder, XMLHttpRequest, document, window, globalThis, module, isNaN */
(function () {
  'use strict';

  const DEFAULT_HANDSHAKE_EVENT = 'dom-bridge:handshake';
  const _bridgeControllers = new WeakMap();
  const SAFE_CHANNEL_RE = /^[A-Za-z0-9._-]{1,128}$/;

  const QUIZ_KEY_RE = /^(question|questions|prompt|prompts|choice|choices|option|options|answer|answers|label|labels|item|items|title|text|quiz|quizz|stem|variants|matches|pairs|blanks|draggables|dropzones|targets|cards|entries|selected|correct|value)$/i;
  const QUIZ_CONTENT_RE = /(question|questions|choice|choices|option|options|answer|answers|prompt|prompts|quiz|assessment|exam|stem|variants|pairs|blanks|draggables|dropzones|targets|items)/i;
  const QUIZ_URL_RE = /(quiz|question|exam|assessment|attempt|survey|test|poll)/i;
  const SENSITIVE_PARAM_RE = /(?:key|token|sig|secret|auth|credential|passw|cookie|jwt|bearer)|^sid$/i;
  const BLOCKED_CONTENT_TYPE_RE = /(text\/html|text\/css|javascript|image\/|audio\/|video\/|font\/|application\/octet-stream|application\/pdf|multipart\/)/i;
  const REACT_INTERNAL_KEYS = new Set([
    '_owner', '_store', '_self', '_source', 'ref', 'alternate',
    'sibling', 'child', 'return', 'stateNode', '$$typeof', 'type',
    'elementType', '_debugSource', '_debugOwner', 'firstEffect',
    'lastEffect', 'nextEffect', 'updateQueue', 'dependencies'
  ]);
  const VUE_SKIP_KEYS = new Set([
    '$el', '$parent', '$root', '$children', '$refs', '$vnode', '_vnode',
    '$slots', '$scopedSlots', '$listeners', '$createElement', '_c',
    'vnode', 'subTree', 'parent', 'appContext', 'provides', 'slots',
    'refs', 'emit', 'exposed', 'suspense', 'scope', 'effect', 'update'
  ]);

  function safeGet(obj, key) {
    try {
      return { ok: true, value: obj[key] };
    } catch (e) {
      return { ok: false, value: undefined };
    }
  }

  function safeHas(obj, key) {
    try {
      return Boolean(obj && typeof obj === 'object' && key in obj);
    } catch (e) {
      return false;
    }
  }

  function safeKeys(obj) {
    try {
      return Object.keys(obj);
    } catch (e) {
      return [];
    }
  }

  function safeOwnNames(obj) {
    try {
      return Object.getOwnPropertyNames(obj);
    } catch (e) {
      return safeKeys(obj);
    }
  }

  function isDomOrHostObject(val) {
    if (!val || typeof val !== 'object') return false;
    try {
      if (typeof window !== 'undefined' && val === window) return true;
      if (typeof document !== 'undefined' && val === document) return true;
      if (typeof globalThis !== 'undefined' && val === globalThis) return true;
      if (typeof val.nodeType === 'number' && typeof val.nodeName === 'string') return true;
      if (typeof val.addEventListener === 'function' && typeof val.dispatchEvent === 'function') return true;
    } catch (e) {
      return true;
    }
    return false;
  }

  function isQuizRelevantKey(key) {
    return QUIZ_KEY_RE.test(String(key));
  }

  function hasQuizRelevantContent(val, depth, seen) {
    if (val === null || val === undefined || depth > 4) return false;
    if (typeof val !== 'object') return false;
    if (seen.has(val)) return false;
    seen.add(val);

    let isArr = false;
    try {
      isArr = Array.isArray(val);
    } catch (e) {
      return false;
    }

    if (isArr) {
      const lenRes = safeGet(val, 'length');
      const len = lenRes.ok && typeof lenRes.value === 'number' ? Math.min(lenRes.value, 20) : 0;
      for (let i = 0; i < len; i++) {
        const itemRes = safeGet(val, i);
        if (itemRes.ok && hasQuizRelevantContent(itemRes.value, depth + 1, seen)) return true;
      }
      return false;
    }

    const keys = safeKeys(val);
    for (let i = 0; i < Math.min(keys.length, 50); i++) {
      const k = keys[i];
      const propRes = safeGet(val, k);
      if (!propRes.ok) continue;
      const child = propRes.value;
      if (isQuizRelevantKey(k)) {
        if (child !== undefined && child !== null && child !== '') {
          return true;
        }
      }
      if (typeof child === 'object' && child !== null) {
        if (hasQuizRelevantContent(child, depth + 1, seen)) return true;
      }
    }
    return false;
  }

  /**
   * Convert an arbitrary framework state/props value into a safe JSON-serializable snapshot,
   * stripping functions, symbols, DOM nodes, and circular references.
   */
  function sanitizeValue(val, depth, state) {
    if (val === null) return null;
    const t = typeof val;
    if (t === 'boolean') return val;
    if (t === 'number') return Number.isFinite(val) ? val : null;
    if (t === 'bigint') return val.toString();
    if (t === 'string') {
      return val.length > state.maxStringLength
        ? val.slice(0, state.maxStringLength)
        : val;
    }
    if (t === 'undefined' || t === 'function' || t === 'symbol') {
      return undefined;
    }

    if (depth >= state.maxDepth || state.budget <= 0) {
      return undefined;
    }

    if (isDomOrHostObject(val)) {
      return undefined;
    }

    try {
      if (val instanceof Date) {
        return Number.isNaN(val.getTime()) ? undefined : val.toISOString();
      }
      if (val instanceof RegExp || val instanceof Error) {
        return undefined;
      }
    } catch (e) {
      return undefined;
    }

    if (state.activeStack.has(val)) {
      return undefined;
    }

    state.activeStack.add(val);
    try {
      let isArr = false;
      try {
        isArr = Array.isArray(val);
      } catch (e) {
        return undefined;
      }

      if (isArr) {
        const outArr = [];
        let len = 0;
        try {
          len = Math.min(val.length, state.maxArrayLength);
        } catch (e) {
          return undefined;
        }
        for (let i = 0; i < len; i++) {
          if (state.budget <= 0) break;
          state.budget--;
          const itemRes = safeGet(val, i);
          if (!itemRes.ok) continue;
          const sanitizedItem = sanitizeValue(itemRes.value, depth + 1, state);
          if (sanitizedItem !== undefined) {
            outArr.push(sanitizedItem);
          }
        }
        return outArr;
      }

      const keys = safeKeys(val);
      const outObj = {};
      let added = 0;
      const limit = Math.min(keys.length, state.maxKeys);
      for (let i = 0; i < limit; i++) {
        if (state.budget <= 0) break;
        const key = keys[i];
        if (key === '__proto__' || REACT_INTERNAL_KEYS.has(key) || VUE_SKIP_KEYS.has(key)) continue;
        state.budget--;
        const propRes = safeGet(val, key);
        if (!propRes.ok) continue;
        const sanitizedProp = sanitizeValue(propRes.value, depth + 1, state);
        if (sanitizedProp !== undefined) {
          Object.defineProperty(outObj, key, {
            value: sanitizedProp,
            enumerable: true,
            writable: true,
            configurable: true
          });
          added++;
        }
      }
      return added > 0 ? outObj : undefined;
    } finally {
      state.activeStack.delete(val);
    }
  }

  function createSanitizeState(opts) {
    return {
      maxDepth: opts.maxDepth,
      maxKeys: opts.maxKeys,
      maxArrayLength: opts.maxArrayLength,
      maxStringLength: opts.maxStringLength,
      budget: opts.maxKeys * 12,
      activeStack: new WeakSet()
    };
  }

  function extractReactHooksState(memoizedState, maxDepth, opts) {
    const states = [];
    const seenHooks = new WeakSet();
    let curr = memoizedState;
    let steps = 0;
    while (curr && typeof curr === 'object' && !seenHooks.has(curr) && steps < 20) {
      seenHooks.add(curr);
      steps++;
      const msRes = safeGet(curr, 'memoizedState');
      if (msRes.ok && msRes.value !== undefined && msRes.value !== null) {
        const cleaned = sanitizeValue(msRes.value, 0, createSanitizeState({ ...opts, maxDepth: Math.min(maxDepth, 4) }));
        if (cleaned !== undefined) {
          states.push(cleaned);
        }
      }
      const nextRes = safeGet(curr, 'next');
      if (!nextRes.ok) break;
      curr = nextRes.value;
    }
    return states.length > 0 ? states : undefined;
  }

  function extractFromReactNode(el, keys, opts, seenFibers) {
    const results = [];
    const fiberVisited = seenFibers || new WeakSet();

    for (const key of keys) {
      if (key.startsWith('__reactProps$')) {
        const propsRes = safeGet(el, key);
        if (propsRes.ok && propsRes.value && typeof propsRes.value === 'object') {
          if (fiberVisited.has(propsRes.value)) continue;
          fiberVisited.add(propsRes.value);
          const sanitized = sanitizeValue(propsRes.value, 0, createSanitizeState(opts));
          if (sanitized && (opts.includeAllKeys || hasQuizRelevantContent(sanitized, 0, new WeakSet()))) {
            results.push({ framework: 'react', source: 'props', data: sanitized });
          }
        }
      } else if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
        const fiberRes = safeGet(el, key);
        let fiber = fiberRes.ok ? fiberRes.value : null;
        let depth = 0;
        while (fiber && typeof fiber === 'object' && !fiberVisited.has(fiber) && depth <= opts.maxDepth) {
          fiberVisited.add(fiber);
          depth++;
          const bundle = {};
          const mp = safeGet(fiber, 'memoizedProps');
          if (mp.ok && mp.value && typeof mp.value === 'object') {
            const cleanMp = sanitizeValue(mp.value, 0, createSanitizeState(opts));
            if (cleanMp) bundle.props = cleanMp;
          }
          const ms = safeGet(fiber, 'memoizedState');
          if (ms.ok && ms.value && typeof ms.value === 'object') {
            if (safeHas(ms.value, 'memoizedState') && safeHas(ms.value, 'next') && safeGet(ms.value, 'next').ok) {
              const hookStates = extractReactHooksState(ms.value, opts.maxDepth, opts);
              if (hookStates) bundle.hooks = hookStates;
            } else {
              const cleanMs = sanitizeValue(ms.value, 0, createSanitizeState(opts));
              if (cleanMs) bundle.state = cleanMs;
            }
          }
          if (Object.keys(bundle).length > 0 && (opts.includeAllKeys || hasQuizRelevantContent(bundle, 0, new WeakSet()))) {
            results.push({ framework: 'react', source: 'fiber', data: bundle });
          }
          const retRes = safeGet(fiber, 'return');
          fiber = retRes.ok ? retRes.value : null;
        }
      }
    }
    return results;
  }

  function extractFromVueNode(el, opts, seenComponents) {
    const results = [];
    const compVisited = seenComponents || new WeakSet();

    const vue2Res = safeGet(el, '__vue__');
    if (vue2Res.ok && vue2Res.value && typeof vue2Res.value === 'object' && !compVisited.has(vue2Res.value)) {
      const vm = vue2Res.value;
      compVisited.add(vm);
      const bundle = {};
      for (const field of ['$props', '$data', '_data']) {
        const fRes = safeGet(vm, field);
        if (fRes.ok && fRes.value && typeof fRes.value === 'object') {
          const cleaned = sanitizeValue(fRes.value, 0, createSanitizeState(opts));
          if (cleaned) bundle[field.replace(/^[$_]/, '')] = cleaned;
        }
      }
      // Also check direct properties on vm if $data/$props didn't cover them
      const directClean = sanitizeValue(vm, 0, createSanitizeState(opts));
      if (directClean && Object.keys(directClean).length > 0) {
        bundle.vm = directClean;
      }
      if (Object.keys(bundle).length > 0 && (opts.includeAllKeys || hasQuizRelevantContent(bundle, 0, new WeakSet()))) {
        results.push({ framework: 'vue2', source: '__vue__', data: bundle });
      }
    }

    const vue3Res = safeGet(el, '__vueParentComponent');
    const vnodeComp = !vue3Res.ok || !vue3Res.value ? safeGet(el, '__vnode') : null;
    const comp = (vue3Res.ok && vue3Res.value)
      ? vue3Res.value
      : (vnodeComp && vnodeComp.ok && vnodeComp.value ? safeGet(vnodeComp.value, 'component').value : null);

    if (comp && typeof comp === 'object' && !compVisited.has(comp)) {
      compVisited.add(comp);
      const bundle = {};
      for (const field of ['props', 'setupState', 'data', 'ctx']) {
        const fRes = safeGet(comp, field);
        if (fRes.ok && fRes.value && typeof fRes.value === 'object') {
          const cleaned = sanitizeValue(fRes.value, 0, createSanitizeState(opts));
          if (cleaned) bundle[field] = cleaned;
        }
      }
      if (Object.keys(bundle).length > 0 && (opts.includeAllKeys || hasQuizRelevantContent(bundle, 0, new WeakSet()))) {
        results.push({ framework: 'vue3', source: '__vueParentComponent', data: bundle });
      }
    }

    return results;
  }

  /**
   * F-DET-03: Defensive React & Vue state/props extractor.
   * Traverses DOM nodes (and open shadow roots) with WeakSet cycle guards, depth/node/key caps,
   * and strict try/catch around every property access.
   */
  function extractFrameworkState(root, options = {}) {
    const targetRoot = root || (typeof document !== 'undefined' ? document : null);
    const opts = {
      maxDepth: typeof options.maxDepth === 'number' && options.maxDepth >= 0 ? options.maxDepth : 6,
      maxNodes: typeof options.maxNodes === 'number' && options.maxNodes > 0 ? options.maxNodes : 250,
      maxKeys: typeof options.maxKeys === 'number' && options.maxKeys > 0 ? options.maxKeys : 50,
      maxArrayLength: typeof options.maxArrayLength === 'number' && options.maxArrayLength > 0 ? options.maxArrayLength : 100,
      maxStringLength: typeof options.maxStringLength === 'number' && options.maxStringLength > 0 ? options.maxStringLength : 2000,
      maxSnapshots: typeof options.maxSnapshots === 'number' && options.maxSnapshots > 0 ? options.maxSnapshots : 50,
      includeAllKeys: Boolean(options.includeAllKeys)
    };

    const snapshots = [];
    const frameworksDetected = new Set();
    let nodesScanned = 0;

    if (!targetRoot || typeof targetRoot !== 'object') {
      return {
        snapshots,
        stats: { nodesScanned: 0, snapshotsFound: 0, frameworksDetected: [] }
      };
    }

    const rootTypeRes = safeGet(targetRoot, 'nodeType');
    let startNode = targetRoot;
    if (rootTypeRes.ok && rootTypeRes.value === 9) {
      const bodyRes = safeGet(targetRoot, 'body');
      const docElRes = safeGet(targetRoot, 'documentElement');
      startNode = (bodyRes.ok && bodyRes.value)
        ? bodyRes.value
        : ((docElRes.ok && docElRes.value) ? docElRes.value : targetRoot);
    }

    const visitedNodes = new WeakSet();
    const seenFibers = new WeakSet();
    const seenVueComponents = new WeakSet();
    const queue = [startNode];

    while (queue.length > 0 && nodesScanned < opts.maxNodes && snapshots.length < opts.maxSnapshots) {
      const node = queue.shift();
      if (!node || typeof node !== 'object' || visitedNodes.has(node)) continue;
      visitedNodes.add(node);
      nodesScanned++;

      let ownNames = [];
      try {
        ownNames = safeOwnNames(node);
      } catch (e) {
        ownNames = [];
      }

      const reactKeys = ownNames.filter((k) =>
        k.startsWith('__reactFiber$') ||
        k.startsWith('__reactProps$') ||
        k.startsWith('__reactInternalInstance$')
      );

      let tag = 'ELEMENT';
      const tagRes = safeGet(node, 'tagName');
      if (tagRes.ok && typeof tagRes.value === 'string') {
        tag = tagRes.value;
      }

      if (reactKeys.length > 0) {
        const reactHits = extractFromReactNode(node, reactKeys, opts, seenFibers);
        for (const hit of reactHits) {
          if (snapshots.length >= opts.maxSnapshots) break;
          frameworksDetected.add(hit.framework);
          snapshots.push({
            framework: hit.framework,
            source: hit.source,
            tag,
            data: hit.data
          });
        }
      }

      const vueHits = extractFromVueNode(node, opts, seenVueComponents);
      for (const hit of vueHits) {
        if (snapshots.length >= opts.maxSnapshots) break;
        frameworksDetected.add(hit.framework);
        snapshots.push({
          framework: hit.framework,
          source: hit.source,
          tag,
          data: hit.data
        });
      }

      // Enqueue light DOM children safely (surviving Proxy / throwing getters)
      const childrenRes = safeGet(node, 'children');
      if (childrenRes.ok && childrenRes.value && typeof childrenRes.value === 'object') {
        const children = childrenRes.value;
        const lenRes = safeGet(children, 'length');
        const len = lenRes.ok && typeof lenRes.value === 'number' ? Math.min(lenRes.value, opts.maxNodes * 4) : 0;
        for (let i = 0; i < len; i++) {
          const chRes = safeGet(children, i);
          if (chRes.ok && chRes.value && typeof chRes.value === 'object' && !visitedNodes.has(chRes.value)) {
            queue.push(chRes.value);
          }
        }
      }

      // Enqueue open shadowRoot if present
      const srRes = safeGet(node, 'shadowRoot');
      if (srRes.ok && srRes.value && typeof srRes.value === 'object' && !visitedNodes.has(srRes.value)) {
        queue.push(srRes.value);
      }
    }

    return {
      snapshots,
      stats: {
        nodesScanned,
        snapshotsFound: snapshots.length,
        frameworksDetected: Array.from(frameworksDetected)
      }
    };
  }

  /**
   * Sanitize URLs before storing in network buffer (strip credentials, hashes, and sensitive query params).
   */
  function sanitizeUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
    try {
      const isRelative = !/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(rawUrl);
      const parsed = isRelative ? new URL(rawUrl, 'https://local.invalid') : new URL(rawUrl);
      parsed.username = '';
      parsed.password = '';
      parsed.hash = '';
      for (const param of Array.from(parsed.searchParams.keys())) {
        if (SENSITIVE_PARAM_RE.test(param)) {
          parsed.searchParams.set(param, '[REDACTED]');
        }
      }
      if (isRelative) {
        return `${parsed.pathname}${parsed.search}`;
      }
      return parsed.toString();
    } catch (e) {
      return rawUrl.split('#')[0].split('?')[0].replace(/(\/\/)[^/@]+@/g, '$1[REDACTED]@');
    }
  }

  function truncateUtf8(str, maxBytes) {
    if (typeof str !== 'string') return { text: '', byteLength: 0, truncated: false };
    if (typeof TextEncoder === 'undefined') {
      const slice = str.slice(0, maxBytes);
      return { text: slice, byteLength: slice.length, truncated: str.length > maxBytes };
    }
    const encoder = new TextEncoder();
    const fullBytes = encoder.encode(str);
    if (fullBytes.length <= maxBytes) {
      return { text: str, byteLength: fullBytes.length, truncated: false };
    }
    let lo = 0;
    let hi = Math.min(str.length, maxBytes);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (encoder.encode(str.slice(0, mid)).length <= maxBytes) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    // Avoid splitting high surrogate
    if (lo > 0) {
      const code = str.charCodeAt(lo - 1);
      if (code >= 0xD800 && code <= 0xDBFF) {
        lo--;
      }
    }
    const sliced = str.slice(0, lo);
    return {
      text: sliced,
      byteLength: encoder.encode(sliced).length,
      truncated: true
    };
  }

  function safeGetHeader(headers, name) {
    if (!headers) return '';
    try {
      if (typeof headers.get === 'function') {
        return String(headers.get(name) || '');
      }
      if (typeof headers === 'object') {
        const lower = name.toLowerCase();
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === lower) {
            return String(headers[k] || '');
          }
        }
      }
    } catch (e) {
      return '';
    }
    return '';
  }

  function isCandidateContentType(contentType) {
    if (!contentType) return true;
    if (BLOCKED_CONTENT_TYPE_RE.test(contentType)) return false;
    return /(json|text\/plain)/i.test(contentType);
  }

  function isRelevantPayload(cleanUrl, contentType, bodyText, filterQuizOnly) {
    if (typeof bodyText !== 'string' || !bodyText.trim()) return false;
    if (!isCandidateContentType(contentType)) return false;

    const trimmed = bodyText.trim();
    const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
    const isJsonCt = /json/i.test(contentType || '');

    if (!isJsonCt && !looksLikeJson) {
      return false;
    }

    if (!filterQuizOnly) return true;

    if (QUIZ_URL_RE.test(cleanUrl)) return true;
    if (QUIZ_CONTENT_RE.test(trimmed.slice(0, 8192))) return true;
    return false;
  }

  function extractFetchUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input === 'object') {
      const urlRes = safeGet(input, 'url');
      if (urlRes.ok && typeof urlRes.value === 'string') return urlRes.value;
      const hrefRes = safeGet(input, 'href');
      if (hrefRes.ok && typeof hrefRes.value === 'string') return hrefRes.value;
    }
    return '';
  }

  function extractFetchMethod(input, init) {
    if (init && typeof init === 'object') {
      const initMethod = safeGet(init, 'method');
      if (initMethod.ok && typeof initMethod.value === 'string') return initMethod.value.toUpperCase();
    }
    if (input && typeof input === 'object') {
      const inputMethod = safeGet(input, 'method');
      if (inputMethod.ok && typeof inputMethod.value === 'string') return inputMethod.value.toUpperCase();
    }
    return 'GET';
  }

  /**
   * F-DET-04: Passive Fetch/XHR network interceptor (strictly opt-in, bounded circular buffer).
   * Never alters returned responses, never blocks page requests, and never stores auth headers/cookies.
   */
  function createNetworkInterceptor(options = {}) {
    const rawMaxEntries = typeof options.maxEntries === 'number' && Number.isFinite(options.maxEntries)
      ? Math.floor(options.maxEntries)
      : 20;
    const rawMaxBodyBytes = typeof options.maxBodyBytes === 'number' && Number.isFinite(options.maxBodyBytes)
      ? Math.floor(options.maxBodyBytes)
      : 65536;
    const maxEntries = Math.max(1, Math.min(200, rawMaxEntries));
    const maxBodyBytes = Math.max(256, Math.min(1048576, rawMaxBodyBytes));
    const filterQuizOnly = options.filterQuizOnly !== false;
    const target = options.target || (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {}));

    let enabled = false;
    let patchedFetch = false;
    let patchedXhr = false;
    let origFetch = null;
    let origXhrOpen = null;
    let origXhrSend = null;
    let nextId = 1;
    const entries = [];
    const xhrMeta = new WeakMap();
    const xhrPendingCleanup = new WeakMap();

    function pushEntry(rawEntry) {
      const cleanUrl = sanitizeUrl(rawEntry.url);
      if (!isRelevantPayload(cleanUrl, rawEntry.contentType, rawEntry.bodyText, filterQuizOnly)) {
        return;
      }
      const { text, byteLength, truncated } = truncateUtf8(rawEntry.bodyText, maxBodyBytes);
      const record = {
        id: nextId++,
        timestamp: Date.now(),
        transport: rawEntry.transport,
        method: rawEntry.method || 'GET',
        url: cleanUrl,
        status: typeof rawEntry.status === 'number' ? rawEntry.status : 0,
        contentType: rawEntry.contentType || '',
        byteLength,
        truncated,
        body: text
      };
      if (entries.length >= maxEntries) {
        entries.shift();
      }
      entries.push(record);
    }

    function installPatches() {
      if (!patchedFetch && typeof target.fetch === 'function') {
        origFetch = target.fetch;
        const wrappedFetch = function (input, init) {
          const promise = origFetch.apply(this, arguments);
          if (enabled && promise && typeof promise.then === 'function') {
            promise.then((response) => {
              if (!enabled || !response || typeof response.clone !== 'function') return;
              const ct = safeGetHeader(response.headers, 'content-type');
              if (!isCandidateContentType(ct)) return;
              let cloned;
              try {
                cloned = response.clone();
              } catch (e) {
                return;
              }
              if (!cloned || typeof cloned.text !== 'function') return;
              Promise.resolve(cloned.text()).then((bodyText) => {
                if (!enabled) return;
                pushEntry({
                  transport: 'fetch',
                  url: extractFetchUrl(input),
                  method: extractFetchMethod(input, init),
                  status: response.status,
                  contentType: ct,
                  bodyText
                });
              }).catch(() => {});
            }).catch(() => {});
          }
          return promise;
        };
        target.fetch = wrappedFetch;
        patchedFetch = true;
      }

      const XhrCtor = target.XMLHttpRequest || (typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest : null);
      if (!patchedXhr && XhrCtor && XhrCtor.prototype) {
        const proto = XhrCtor.prototype;
        if (typeof proto.open === 'function' && typeof proto.send === 'function') {
          origXhrOpen = proto.open;
          origXhrSend = proto.send;

          proto.open = function (method, rawUrl) {
            try {
              xhrMeta.set(this, {
                method: typeof method === 'string' ? method.toUpperCase() : 'GET',
                url: typeof rawUrl === 'string' ? rawUrl : String(rawUrl || '')
              });
            } catch (e) { /* ignore */ }
            return origXhrOpen.apply(this, arguments);
          };

          proto.send = function () {
            if (enabled) {
              const xhr = this;
              const prevCleanup = xhrPendingCleanup.get(xhr);
              if (typeof prevCleanup === 'function') {
                prevCleanup();
              }

              const cleanupListeners = () => {
                xhrPendingCleanup.delete(xhr);
                if (typeof xhr.removeEventListener === 'function') {
                  try {
                    xhr.removeEventListener('load', handleLoad);
                    xhr.removeEventListener('error', cleanupListeners);
                    xhr.removeEventListener('abort', cleanupListeners);
                    xhr.removeEventListener('timeout', cleanupListeners);
                    xhr.removeEventListener('loadend', cleanupListeners);
                  } catch (e) { /* ignore */ }
                }
              };

              const handleLoad = () => {
                cleanupListeners();
                if (!enabled) return;
                try {
                  const rType = xhr.responseType || '';
                  let bodyText = '';
                  if (!rType || rType === 'text') {
                    bodyText = typeof xhr.responseText === 'string' ? xhr.responseText : '';
                  } else if (rType === 'json' && xhr.response !== undefined) {
                    bodyText = JSON.stringify(xhr.response);
                  } else {
                    return;
                  }
                  const ct = typeof xhr.getResponseHeader === 'function'
                    ? (xhr.getResponseHeader('content-type') || '')
                    : '';
                  const meta = xhrMeta.get(xhr) || { method: 'GET', url: '' };
                  pushEntry({
                    transport: 'xhr',
                    url: meta.url,
                    method: meta.method,
                    status: xhr.status,
                    contentType: ct,
                    bodyText
                  });
                } catch (e) { /* never interfere with page XHR */ }
              };

              if (typeof xhr.addEventListener === 'function') {
                xhrPendingCleanup.set(xhr, cleanupListeners);
                xhr.addEventListener('load', handleLoad, { once: true });
                xhr.addEventListener('error', cleanupListeners, { once: true });
                xhr.addEventListener('abort', cleanupListeners, { once: true });
                xhr.addEventListener('timeout', cleanupListeners, { once: true });
                xhr.addEventListener('loadend', cleanupListeners, { once: true });
              } else {
                const prevOnLoad = xhr.onload;
                if (!prevOnLoad || !prevOnLoad._seWrapped) {
                  const wrappedOnLoad = function () {
                    handleLoad();
                    if (typeof prevOnLoad === 'function') {
                      return prevOnLoad.apply(this, arguments);
                    }
                  };
                  wrappedOnLoad._seWrapped = true;
                  xhr.onload = wrappedOnLoad;
                }
              }
            }
            return origXhrSend.apply(this, arguments);
          };

          patchedXhr = true;
        }
      }
    }

    function enable() {
      installPatches();
      enabled = true;
      return true;
    }

    function disable() {
      enabled = false;
      return false;
    }

    function isEnabled() {
      return enabled;
    }

    function getEntries() {
      return entries.map((e) => ({ ...e }));
    }

    function clear() {
      entries.length = 0;
    }

    function restore() {
      enabled = false;
      if (patchedFetch && origFetch) {
        target.fetch = origFetch;
        patchedFetch = false;
        origFetch = null;
      }
      const XhrCtor = target.XMLHttpRequest || (typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest : null);
      if (patchedXhr && XhrCtor && XhrCtor.prototype) {
        if (origXhrOpen) XhrCtor.prototype.open = origXhrOpen;
        if (origXhrSend) XhrCtor.prototype.send = origXhrSend;
        patchedXhr = false;
        origXhrOpen = null;
        origXhrSend = null;
      }
    }

    return {
      enable,
      disable,
      isEnabled,
      getEntries,
      clear,
      restore
    };
  }

  function parseDetail(detail) {
    if (typeof detail === 'string') {
      try {
        return JSON.parse(detail);
      } catch (e) {
        return null;
      }
    }
    if (detail && typeof detail === 'object') {
      return detail;
    }
    return null;
  }

  function dispatchBridgeEvent(targetDoc, CustomEventCtor, eventName, payload) {
    const serialized = JSON.stringify(payload);
    targetDoc.dispatchEvent(new CustomEventCtor(eventName, { detail: serialized }));
  }

  function resolveTargetOrigin(targetDoc, targetGlobal, explicitOrigin) {
    if (typeof explicitOrigin === 'string') return explicitOrigin;
    try {
      if (targetDoc && targetDoc.location && typeof targetDoc.location.origin === 'string') {
        return targetDoc.location.origin;
      }
      if (targetGlobal && targetGlobal.location && typeof targetGlobal.location.origin === 'string') {
        return targetGlobal.location.origin;
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  /**
   * Install the CustomEvent bridge on a Document/EventTarget (zero properties on window).
   */
  function installBridge(options = {}) {
    const targetDoc = options.document || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc || typeof targetDoc.addEventListener !== 'function' || typeof targetDoc.dispatchEvent !== 'function') {
      return null;
    }

    const existing = _bridgeControllers.get(targetDoc);
    if (existing && typeof existing.extractFrameworkState === 'function') {
      return existing;
    }

    const CustomEventCtor = options.CustomEvent || CustomEvent;
    const handshakeEvent = options.handshakeEvent || DEFAULT_HANDSHAKE_EVENT;
    const targetGlobal = options.target || (typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {}));
    const expectedOrigin = resolveTargetOrigin(targetDoc, targetGlobal, options.origin);

    // Zero-fingerprint cross-IIFE deduplication probe (prevents duplicate MAIN-world listeners)
    if (typeof CustomEventCtor === 'function') {
      let alreadyActive = false;
      const probeReply = `prb_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
      const onProbe = () => { alreadyActive = true; };
      targetDoc.addEventListener(probeReply, onProbe, { once: true });
      try {
        dispatchBridgeEvent(targetDoc, CustomEventCtor, handshakeEvent, {
          probe: probeReply,
          origin: expectedOrigin
        });
      } finally {
        if (typeof targetDoc.removeEventListener === 'function') {
          try { targetDoc.removeEventListener(probeReply, onProbe); } catch (e) { /* ignore */ }
        }
      }
      if (alreadyActive) {
        return {
          handshakeEvent,
          duplicate: true,
          extractFrameworkState: (root, opts) => extractFrameworkState(root || targetDoc, opts)
        };
      }
    }

    const interceptor = createNetworkInterceptor({
      target: targetGlobal,
      maxEntries: options.maxEntries,
      maxBodyBytes: options.maxBodyBytes,
      filterQuizOnly: options.filterQuizOnly
    });

    const channelHandlers = new Map();
    const MAX_CHANNELS = 10;

    function isOriginAllowed(msgOrigin) {
      if (expectedOrigin && expectedOrigin !== 'null') {
        return msgOrigin === expectedOrigin;
      }
      return msgOrigin === undefined || msgOrigin === '' || msgOrigin === expectedOrigin;
    }

    function unregisterChannel(channel) {
      const fn = channelHandlers.get(channel);
      if (fn) {
        targetDoc.removeEventListener(`${channel}:req`, fn);
        channelHandlers.delete(channel);
      }
    }

    function handleBridgeAction(action, actionOpts) {
      switch (action) {
        case 'ping':
          return { ok: true, data: { alive: true, interceptorEnabled: interceptor.isEnabled() } };
        case 'extractFrameworkState':
          return { ok: true, data: extractFrameworkState(targetDoc, actionOpts || {}) };
        case 'enableNetworkInterceptor':
          return { ok: true, data: { enabled: interceptor.enable() } };
        case 'disableNetworkInterceptor':
          interceptor.disable();
          return { ok: true, data: { enabled: interceptor.isEnabled() } };
        case 'getNetworkEntries':
          return { ok: true, data: { entries: interceptor.getEntries(), enabled: interceptor.isEnabled() } };
        case 'clearNetworkEntries':
          interceptor.clear();
          return { ok: true, data: { cleared: true } };
        case 'restoreNetworkInterceptor':
          interceptor.restore();
          return { ok: true, data: { restored: true, enabled: interceptor.isEnabled() } };
        default:
          return { ok: false, error: `Unknown bridge action: ${String(action)}` };
      }
    }

    function registerChannel(channel, expectedNonce = null) {
      if (typeof channel !== 'string' || !SAFE_CHANNEL_RE.test(channel)) return;
      if (channelHandlers.has(channel)) {
        unregisterChannel(channel);
      }
      if (channelHandlers.size >= MAX_CHANNELS) {
        const oldest = channelHandlers.keys().next().value;
        unregisterChannel(oldest);
      }

      const reqHandler = (ev) => {
        if (ev && ev.target && ev.target !== targetDoc) return;
        const req = parseDetail(ev && ev.detail);
        if (!req || typeof req !== 'object' || req.id === undefined) return;
        if (expectedNonce !== null && req.nonce !== expectedNonce) return;
        if (!isOriginAllowed(req.origin)) return;

        let result;
        try {
          result = handleBridgeAction(req.action, req.options);
        } catch (err) {
          result = { ok: false, error: err && err.message ? err.message : 'Bridge error' };
        }
        dispatchBridgeEvent(targetDoc, CustomEventCtor, `${channel}:res`, {
          id: req.id,
          nonce: expectedNonce,
          origin: expectedOrigin,
          ok: result.ok,
          data: result.data,
          error: result.error
        });
        if (req.closeChannel === true) {
          unregisterChannel(channel);
        }
      };

      channelHandlers.set(channel, reqHandler);
      targetDoc.addEventListener(`${channel}:req`, reqHandler);
    }

    const handshakeHandler = (ev) => {
      if (ev && ev.target && ev.target !== targetDoc) return;
      const msg = parseDetail(ev && ev.detail);
      if (msg && typeof msg.probe === 'string' && SAFE_CHANNEL_RE.test(msg.probe) && isOriginAllowed(msg.origin)) {
        dispatchBridgeEvent(targetDoc, CustomEventCtor, msg.probe, { active: true });
        return;
      }
      if (!msg || typeof msg.channel !== 'string' || !SAFE_CHANNEL_RE.test(msg.channel)) {
        return;
      }
      if (typeof msg.nonce !== 'string' || !msg.nonce || msg.nonce.length > 128) {
        return;
      }
      if (!isOriginAllowed(msg.origin)) {
        return;
      }
      registerChannel(msg.channel, msg.nonce);
      dispatchBridgeEvent(targetDoc, CustomEventCtor, `${msg.channel}:ack`, {
        nonce: msg.nonce,
        origin: expectedOrigin,
        ready: true,
        capabilities: ['extractFrameworkState', 'networkInterceptor']
      });
    };

    targetDoc.addEventListener(handshakeEvent, handshakeHandler);

    const controller = {
      handshakeEvent,
      extractFrameworkState: (root, opts) => extractFrameworkState(root || targetDoc, opts),
      getInterceptor: () => interceptor,
      registerChannel,
      destroy: () => {
        targetDoc.removeEventListener(handshakeEvent, handshakeHandler);
        for (const ch of Array.from(channelHandlers.keys())) {
          unregisterChannel(ch);
        }
        interceptor.clear();
        interceptor.restore();
        _bridgeControllers.delete(targetDoc);
      }
    };

    _bridgeControllers.set(targetDoc, controller);
    return controller;
  }

  if (typeof document === 'undefined' && typeof module !== 'undefined' && module.exports) {
    module.exports = {
      DEFAULT_HANDSHAKE_EVENT,
      sanitizeUrl,
      extractFrameworkState,
      createNetworkInterceptor,
      installBridge
    };
  } else if (typeof document !== 'undefined') {
    installBridge({
      document,
      target: typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {})
    });
  }
})();
