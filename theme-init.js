// Synchronous theme bootstrapper & light/dark/system coordinator (FOUC-free, MV3 CSP-safe)
/* global window, document, chrome, globalThis, module */

(function initSafeExmThemeModule(root) {
  'use strict';

  const STORAGE_KEY = 'uiTheme';
  const LOCAL_CACHE_KEY = 'safeExmUiTheme';

  function normalizeOverride(value) {
    return value === 'light' || value === 'dark' ? value : null;
  }

  function getSystemScheme() {
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
    } catch {
      /* ignore matchMedia errors */
    }
    return 'light';
  }

  function getStoredOverride() {
    try {
      if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.getItem === 'function') {
        return normalizeOverride(window.localStorage.getItem(LOCAL_CACHE_KEY));
      }
    } catch {
      /* ignore blocked localStorage */
    }
    return null;
  }

  function writeLocalCache(override) {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      if (override === 'light' || override === 'dark') {
        if (typeof window.localStorage.setItem === 'function') {
          window.localStorage.setItem(LOCAL_CACHE_KEY, override);
        }
      } else if (typeof window.localStorage.removeItem === 'function') {
        window.localStorage.removeItem(LOCAL_CACHE_KEY);
      }
    } catch {
      /* ignore blocked localStorage */
    }
  }

  let _currentOverride = getStoredOverride();
  let _themeEpoch = 0;
  let _initSeq = 0;
  let _detachListeners = null;

  function applyThemeOverride(rawOverride) {
    const override = normalizeOverride(rawOverride);
    const systemScheme = getSystemScheme();
    const resolved = override || systemScheme;
    _currentOverride = override;

    if (typeof document !== 'undefined') {
      const docEl = document.documentElement;
      if (docEl && typeof docEl.setAttribute === 'function') {
        docEl.setAttribute('data-theme', resolved);
        docEl.setAttribute('data-theme-mode', override ? 'override' : 'system');
      }
      if (typeof document.querySelector === 'function') {
        const meta = document.querySelector('meta[name="color-scheme"]');
        if (meta && typeof meta.setAttribute === 'function') {
          meta.setAttribute('content', override || 'light dark');
        }
      }
    }

    writeLocalCache(override);
    return { override, resolved, systemScheme };
  }

  function computeNextOverride(currentOverride, systemScheme = getSystemScheme()) {
    const normalizedSystem = systemScheme === 'dark' ? 'dark' : 'light';
    const current = normalizeOverride(currentOverride);
    const rendered = current || normalizedSystem;
    const target = rendered === 'dark' ? 'light' : 'dark';
    return target === normalizedSystem ? null : target;
  }

  function getNextToggleDescription(state) {
    const info = state || {
      override: _currentOverride,
      systemScheme: getSystemScheme()
    };
    const next = computeNextOverride(info.override, info.systemScheme);
    if (next === 'dark') {
      return 'Passer en mode ardoise';
    }
    if (next === 'light') {
      return 'Passer en mode papier';
    }
    const sysLabel = info.systemScheme === 'dark' ? 'ardoise' : 'papier';
    return `Revenir au thème système (${sysLabel})`;
  }

  function syncThemeButtonLabel(btn, state) {
    if (!btn) return;
    const desc = getNextToggleDescription(state);
    btn.title = desc;
    const hasVisibleTextLabel = typeof btn.querySelector === 'function' &&
      Boolean(btn.querySelector('.theme-label-light, .theme-label-dark'));
    if (!hasVisibleTextLabel && typeof btn.setAttribute === 'function') {
      btn.setAttribute('aria-label', desc);
    }
  }

  function detachThemeListeners() {
    if (typeof _detachListeners === 'function') {
      try {
        _detachListeners();
      } catch {
        /* ignore cleanup errors */
      }
      _detachListeners = null;
    }
  }

  async function initThemeFromStorage(onApplied) {
    const mySeq = ++_initSeq;
    const startEpoch = _themeEpoch;

    let initialState = applyThemeOverride(_currentOverride);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local &&
        typeof chrome.storage.local.get === 'function') {
      try {
        const data = await chrome.storage.local.get([STORAGE_KEY]);
        if (mySeq !== _initSeq) {
          return getCurrentState();
        }
        if (_themeEpoch === startEpoch) {
          initialState = applyThemeOverride(data ? data[STORAGE_KEY] : null);
        } else {
          initialState = getCurrentState();
        }
      } catch {
        if (mySeq !== _initSeq) {
          return getCurrentState();
        }
        /* keep current state */
      }
    }

    if (mySeq !== _initSeq) {
      return getCurrentState();
    }

    if (typeof onApplied === 'function') {
      onApplied(initialState);
    }

    detachThemeListeners();
    const cleanups = [];

    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        if (mq && typeof mq.addEventListener === 'function') {
          const handleMediaChange = () => {
            if (_currentOverride === null) {
              const nextState = applyThemeOverride(null);
              if (typeof onApplied === 'function') onApplied(nextState);
            } else if (typeof onApplied === 'function') {
              onApplied(getCurrentState());
            }
          };
          mq.addEventListener('change', handleMediaChange);
          cleanups.push(() => {
            if (typeof mq.removeEventListener === 'function') {
              mq.removeEventListener('change', handleMediaChange);
            }
          });
        }
      }
    } catch {
      /* ignore matchMedia listener issues */
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged &&
        typeof chrome.storage.onChanged.addListener === 'function') {
      const handleChromeStorageChange = (changes, areaName) => {
        if (areaName !== 'local' || !changes || !Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) {
          return;
        }
        _themeEpoch++;
        const nextState = applyThemeOverride(changes[STORAGE_KEY] ? changes[STORAGE_KEY].newValue : null);
        if (typeof onApplied === 'function') onApplied(nextState);
      };
      chrome.storage.onChanged.addListener(handleChromeStorageChange);
      cleanups.push(() => {
        if (typeof chrome.storage.onChanged.removeListener === 'function') {
          chrome.storage.onChanged.removeListener(handleChromeStorageChange);
        }
      });
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const handleLocalStorageEvent = (event) => {
        if (!event || event.key !== LOCAL_CACHE_KEY) return;
        _themeEpoch++;
        const nextState = applyThemeOverride(event.newValue);
        if (typeof onApplied === 'function') onApplied(nextState);
      };
      window.addEventListener('storage', handleLocalStorageEvent);
      cleanups.push(() => {
        if (typeof window.removeEventListener === 'function') {
          window.removeEventListener('storage', handleLocalStorageEvent);
        }
      });
    }

    _detachListeners = () => {
      for (const fn of cleanups) fn();
    };

    return initialState;
  }

  async function toggleTheme(onApplied) {
    const myEpoch = ++_themeEpoch;
    const nextOverride = computeNextOverride(_currentOverride, getSystemScheme());
    const nextState = applyThemeOverride(nextOverride);

    if (typeof onApplied === 'function') {
      onApplied(nextState);
    }

    if (myEpoch === _themeEpoch && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        if (nextOverride === null) {
          if (typeof chrome.storage.local.remove === 'function') {
            await chrome.storage.local.remove([STORAGE_KEY]);
          } else if (typeof chrome.storage.local.set === 'function') {
            await chrome.storage.local.set({ [STORAGE_KEY]: null });
          }
        } else if (typeof chrome.storage.local.set === 'function') {
          await chrome.storage.local.set({ [STORAGE_KEY]: nextOverride });
        }
      } catch {
        /* state remains applied visually even if persistence fails */
      }
    }

    return nextState;
  }

  function getCurrentState() {
    const systemScheme = getSystemScheme();
    return {
      override: _currentOverride,
      resolved: _currentOverride || systemScheme,
      systemScheme
    };
  }

  // Apply synchronously at parse time inside <head> to eliminate FOUC
  if (typeof document !== 'undefined') {
    applyThemeOverride(_currentOverride);
  }

  const api = {
    STORAGE_KEY,
    LOCAL_CACHE_KEY,
    normalizeOverride,
    getSystemScheme,
    getStoredOverride,
    applyThemeOverride,
    computeNextOverride,
    getNextToggleDescription,
    syncThemeButtonLabel,
    initThemeFromStorage,
    toggleTheme,
    detachThemeListeners,
    getCurrentState
  };

  if (root && typeof root === 'object') {
    root.SafeExmTheme = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
