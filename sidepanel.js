// sidepanel.js — Safe Exm Intelligent Side Panel Controller (F-UX-01)
/* global globalThis, Number, Boolean, Array, WeakMap, Date, Promise, navigator, requestAnimationFrame */

(function initSafeExmSidePanel(root) {
  'use strict';

  const elements = {
    themeBtn: typeof document !== 'undefined' ? document.getElementById('sidePanelThemeBtn') : null,
    analyzeBtn: typeof document !== 'undefined' ? document.getElementById('sidePanelAnalyzeBtn') : null,
    clearBtn: typeof document !== 'undefined' ? document.getElementById('sidePanelClearBtn') : null,
    zeroTraceToggle: typeof document !== 'undefined' ? document.getElementById('zeroTraceToggle') : null,
    progressSection: typeof document !== 'undefined' ? document.getElementById('sidePanelProgressSection') : null,
    progressBar: typeof document !== 'undefined' ? document.getElementById('sidePanelProgress') : null,
    progressText: typeof document !== 'undefined' ? document.getElementById('sidePanelProgressText') : null,
    progressPct: typeof document !== 'undefined' ? document.getElementById('sidePanelProgressPercentage') : null,
    announcer: typeof document !== 'undefined' ? document.getElementById('sidePanelAnnouncer') : null,
    metaBar: typeof document !== 'undefined' ? document.getElementById('sidePanelMeta') : null,
    emptyState: typeof document !== 'undefined' ? document.getElementById('sidePanelEmpty') : null,
    resultsList: typeof document !== 'undefined' ? document.getElementById('sidePanelResults') : null
  };

  let _progressHideTimer = null;
  let _lastCopyMessage = '';
  const _copyTimers = new WeakMap();
  let _copyListenersBound = false;
  let _currentState = null;
  let _analyzeSeq = 0;
  let _uiAnalyzeSeq = 0;
  let _panicClearEpoch = 0;
  let _stateEventEpoch = 0;
  let _suppressProgressUntilStart = false;
  let _lastPanicClearedAt = 0;
  let _lastAnalyzeStartedAt = 0;
  let _localClearSeq = 0;
  const _ownClearIds = [];
  let _pendingClearPromise = null;

  function announce(msg) {
    if (elements.announcer) {
      elements.announcer.textContent = String(msg || '');
    }
  }

  function clearProgressHideTimer() {
    if (_progressHideTimer !== null) {
      clearTimeout(_progressHideTimer);
      _progressHideTimer = null;
    }
  }

  function setVisible(el, visible, displayVal = '') {
    if (!el) return;
    el.hidden = !visible;
    if (el.style) {
      el.style.display = visible ? displayVal : 'none';
    }
  }

  function clearChildren(node) {
    if (!node) return;
    if (typeof node.replaceChildren === 'function') {
      node.replaceChildren();
      return;
    }
    node.textContent = '';
  }

  function getThemeManager() {
    return (typeof window !== 'undefined' && window.SafeExmTheme) ? window.SafeExmTheme : null;
  }

  function syncThemeLabel(stateInfo) {
    const tm = getThemeManager();
    if (tm && typeof tm.syncThemeButtonLabel === 'function' && elements.themeBtn) {
      tm.syncThemeButtonLabel(elements.themeBtn, stateInfo);
    }
  }

  async function initTheme() {
    const tm = getThemeManager();
    if (tm && typeof tm.initThemeFromStorage === 'function') {
      await tm.initThemeFromStorage((nextState) => syncThemeLabel(nextState));
    }
  }

  function showProgress(stepMessage, percent) {
    clearProgressHideTimer();
    if (!elements.progressSection) return;
    const clamped = Math.max(0, Math.min(100, Number(percent) || 0));

    if (elements.progressText) {
      elements.progressText.classList?.remove('is-error');
      elements.progressText.textContent = String(stepMessage || '');
    }
    if (elements.progressBar) {
      elements.progressBar.classList?.remove('is-error');
      elements.progressBar.value = clamped;
    }
    if (elements.progressPct) {
      elements.progressPct.hidden = false;
      elements.progressPct.textContent = `${clamped}%`;
    }
    setVisible(elements.progressSection, true, 'flex');
    if (clamped >= 100) {
      _progressHideTimer = setTimeout(() => {
        _progressHideTimer = null;
        setVisible(elements.progressSection, false, 'flex');
      }, 2500);
      if (_progressHideTimer && typeof _progressHideTimer.unref === 'function') {
        _progressHideTimer.unref();
      }
    }
  }

  function showError(message) {
    clearProgressHideTimer();
    const errorText = `Erreur : ${message || 'Analyse impossible'}`;
    if (elements.progressText) {
      elements.progressText.classList?.add('is-error');
      elements.progressText.textContent = errorText;
    }
    if (elements.progressBar) {
      elements.progressBar.classList?.add('is-error');
      elements.progressBar.value = 100;
    }
    if (elements.progressPct) {
      elements.progressPct.textContent = '';
      elements.progressPct.hidden = true;
    }
    setVisible(elements.progressSection, true, 'flex');
    announce(errorText);
  }

  function getTierDisplay(tier) {
    if (tier === 'high') return { cls: 'tier-high', label: 'Haute' };
    if (tier === 'low') return { cls: 'tier-low', label: 'Faible' };
    return { cls: 'tier-medium', label: 'Moyenne' };
  }

  function resetAnalyzeButton() {
    if (elements.analyzeBtn) {
      elements.analyzeBtn.disabled = false;
      elements.analyzeBtn.textContent = 'Analyser la page';
    }
  }

  function reportCopyOutcome(button, ok) {
    if (!button) return;
    const tip = button.nextElementSibling;
    const prevTimer = _copyTimers.get(button);
    if (prevTimer !== undefined) {
      clearTimeout(prevTimer);
      _copyTimers.delete(button);
    }

    button.removeAttribute('data-copied');
    button.removeAttribute('data-failed');

    let msg = ok ? 'Copié' : 'Échec copie';
    if (msg === _lastCopyMessage) {
      msg += '\u00A0';
    }
    _lastCopyMessage = msg;

    const iconEl = typeof button.querySelector === 'function' ? button.querySelector('.copy-icon') : null;
    if (iconEl) {
      iconEl.textContent = ok ? '✓' : '!';
    }
    button.setAttribute(ok ? 'data-copied' : 'data-failed', '');

    if (tip) {
      tip.textContent = '';
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          tip.textContent = msg;
        });
      } else {
        tip.textContent = msg;
      }
    }

    const timerId = setTimeout(() => {
      button.removeAttribute('data-copied');
      button.removeAttribute('data-failed');
      if (iconEl) iconEl.textContent = '⧉';
      if (tip) tip.textContent = '';
      _copyTimers.delete(button);
    }, 2000);
    _copyTimers.set(button, timerId);
  }

  async function copyAnswerText(button, target) {
    if (!button || !target) return false;
    const text = (typeof target.innerText === 'string' && target.innerText.trim())
      ? target.innerText.trim()
      : String(target.textContent || '').trim();
    if (!text) return false;

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        reportCopyOutcome(button, true);
        return true;
      }
      throw new Error('Clipboard unavailable');
    } catch {
      reportCopyOutcome(button, false);
      return false;
    }
  }

  function setupCopyListeners() {
    if (_copyListenersBound || typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return;
    }
    _copyListenersBound = true;
    if (typeof window !== 'undefined' && 'CommandEvent' in window) {
      document.addEventListener('command', (event) => {
        if (event && typeof event.command === 'string' && event.command.startsWith('--copy')) {
          void copyAnswerText(event.source, event.target);
        }
      }, true);
    } else {
      document.addEventListener('click', (event) => {
        if (!event || event.defaultPrevented || !event.target || typeof event.target.closest !== 'function') {
          return;
        }
        const button = event.target.closest('button[command^="--copy"]');
        if (!button) return;
        const targetId = button.getAttribute('commandfor');
        const target = targetId ? document.getElementById(targetId) : null;
        if (target) {
          void copyAnswerText(button, target);
        }
      });
    }
  }

  function renderSidePanelState(state) {
    _currentState = state && typeof state === 'object' && Array.isArray(state.items) && state.items.length > 0
      ? state
      : null;

    if (!elements.resultsList || !elements.emptyState) return;

    if (!_currentState) {
      clearChildren(elements.resultsList);
      setVisible(elements.resultsList, false);
      setVisible(elements.emptyState, true, 'flex');
      if (elements.metaBar) {
        clearChildren(elements.metaBar);
        setVisible(elements.metaBar, false);
      }
      return;
    }

    if (elements.metaBar) {
      clearChildren(elements.metaBar);
      const chips = [];
      if (_currentState.hostname) chips.push({ text: _currentState.hostname, zeroTrace: false });
      chips.push({
        text: `${_currentState.items.length} réponse${_currentState.items.length > 1 ? 's' : ''}`,
        zeroTrace: false
      });
      if (_currentState.metadata?.provider) {
        chips.push({ text: _currentState.metadata.provider, zeroTrace: false });
      }
      chips.push({
        text: _currentState.zeroTraceMode ? 'Zéro-trace actif' : 'Marquage page actif',
        zeroTrace: Boolean(_currentState.zeroTraceMode)
      });

      for (const chipInfo of chips) {
        const chip = document.createElement('span');
        chip.className = chipInfo.zeroTrace ? 'sp-meta-chip is-zero-trace' : 'sp-meta-chip';
        chip.textContent = chipInfo.text;
        elements.metaBar.appendChild(chip);
      }
      setVisible(elements.metaBar, true, 'flex');
    }

    clearChildren(elements.resultsList);
    _currentState.items.forEach((item, idx) => {
      const card = document.createElement('article');
      card.className = 'sp-card';

      const head = document.createElement('div');
      head.className = 'sp-card-head';

      const qLabel = document.createElement('span');
      qLabel.className = 'sp-q-label';
      qLabel.textContent = `Q${idx + 1}`;
      head.appendChild(qLabel);

      const tierInfo = getTierDisplay(item.confidenceTier);
      const cvMark = item.crossValidationStatus === 'confirmed'
        ? ' ✓✓'
        : ((item.crossValidationStatus === 'disputed' || item.crossValidationStatus === 'disagreed') ? ' !' : '');
      const confBadge = document.createElement('span');
      confBadge.className = `sp-conf-badge ${tierInfo.cls}`;
      confBadge.textContent = `${tierInfo.label} · ${item.confidence}%${cvMark}`;
      head.appendChild(confBadge);
      card.appendChild(head);

      const qText = document.createElement('p');
      qText.className = 'sp-question-text';
      qText.textContent = item.text || `Question ${idx + 1}`;
      card.appendChild(qText);

      const answerRow = document.createElement('div');
      answerRow.className = 'sp-answer-row';

      const answerBody = document.createElement('div');
      answerBody.className = 'sp-answer-body';

      const answerCaption = document.createElement('span');
      answerCaption.className = 'sp-answer-caption';
      answerCaption.textContent = 'Réponse';

      const answerId = `sp-ans-${idx}`;
      const answerEl = document.createElement('p');
      answerEl.className = 'sp-answer-text';
      answerEl.id = answerId;
      answerEl.textContent = item.answerSummary || item.textAnswer || 'Réponse indisponible';

      answerBody.appendChild(answerCaption);
      answerBody.appendChild(answerEl);
      answerRow.appendChild(answerBody);

      const copyWrap = document.createElement('span');
      copyWrap.className = 'copy';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'copy-btn';
      copyBtn.setAttribute('command', '--copy');
      copyBtn.setAttribute('commandfor', answerId);
      copyBtn.setAttribute('aria-label', `Copier la réponse ${idx + 1}`);

      const copyIcon = document.createElement('span');
      copyIcon.className = 'copy-icon';
      copyIcon.setAttribute('aria-hidden', 'true');
      copyIcon.textContent = '⧉';
      copyBtn.appendChild(copyIcon);

      const copyTip = document.createElement('span');
      copyTip.className = 'copy-tip';
      copyTip.setAttribute('role', 'status');

      copyWrap.appendChild(copyBtn);
      copyWrap.appendChild(copyTip);
      answerRow.appendChild(copyWrap);
      card.appendChild(answerRow);

      if (item.explanation) {
        const expEl = document.createElement('p');
        expEl.className = 'sp-explanation';
        expEl.textContent = item.explanation;
        card.appendChild(expEl);
      }

      if (item.crossValidationNote) {
        const cvEl = document.createElement('p');
        cvEl.className = 'sp-cv-note';
        cvEl.textContent = item.crossValidationNote;
        card.appendChild(cvEl);
      }

      elements.resultsList.appendChild(card);
    });

    setVisible(elements.emptyState, false);
    setVisible(elements.resultsList, true, 'flex');
  }

  async function sendRuntimeMessageAsync(payload) {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      return null;
    }
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (resp) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(resp || null);
        }
      });
    });
  }

  async function loadSidePanelState() {
    const startEpoch = _stateEventEpoch;
    const resp = await sendRuntimeMessageAsync({ action: 'getSidePanelState' });
    if (startEpoch !== _stateEventEpoch) {
      return _currentState;
    }
    renderSidePanelState(resp && resp.state ? resp.state : null);
    return resp ? resp.state : null;
  }

  async function loadZeroTraceSetting() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local || typeof chrome.storage.local.get !== 'function') {
      return false;
    }
    try {
      const data = await chrome.storage.local.get(['zeroTraceMode']);
      const enabled = data?.zeroTraceMode === true;
      if (elements.zeroTraceToggle) {
        elements.zeroTraceToggle.checked = enabled;
      }
      return enabled;
    } catch {
      return false;
    }
  }

  async function setZeroTraceMode(enabled) {
    const want = Boolean(enabled);
    if (elements.zeroTraceToggle) {
      elements.zeroTraceToggle.checked = want;
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && typeof chrome.storage.local.set === 'function') {
      await chrome.storage.local.set({ zeroTraceMode: want });
    }
    if (want && typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.query === 'function') {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && typeof tab.id === 'number') {
          await new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { action: 'clearHighlights', preserveSidePanel: true }, () => {
              void chrome.runtime?.lastError;
              resolve();
            });
          });
        }
      } catch { /* ignore */ }
    }
    announce(want ? 'Lecture zéro-trace activée' : 'Lecture zéro-trace désactivée');
  }

  function sendAnalyzeMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || 'Erreur de communication avec l\'onglet';
          const err = new Error(msg);
          err.isMissingReceiver = /receiving end does not exist|could not establish connection/i.test(msg);
          reject(err);
          return;
        }
        if (response && response.cancelled === true) {
          resolve({ success: false, cancelled: true });
          return;
        }
        if (response && response.success) {
          resolve(response);
        } else {
          const err = new Error(response?.error || 'Erreur inconnue');
          err.isMissingReceiver = false;
          reject(err);
        }
      });
    });
  }

  async function analyzeFromSidePanel() {
    const runSeq = ++_analyzeSeq;
    const uiSeq = ++_uiAnalyzeSeq;
    const startPanicEpoch = _panicClearEpoch;
    _lastAnalyzeStartedAt = Date.now();
    _suppressProgressUntilStart = false;
    clearProgressHideTimer();
    let hasError = false;
    let wasCancelled = false;
    if (elements.analyzeBtn) {
      elements.analyzeBtn.disabled = true;
      elements.analyzeBtn.textContent = 'Analyse…';
    }
    showProgress('Préparation…', 5);

    try {
      if (_pendingClearPromise) {
        let waitTimer = null;
        await Promise.race([
          _pendingClearPromise,
          new Promise((resolve) => {
            waitTimer = setTimeout(resolve, 500);
            if (waitTimer && typeof waitTimer.unref === 'function') waitTimer.unref();
          })
        ]);
        if (waitTimer !== null) clearTimeout(waitTimer);
        if (runSeq !== _analyzeSeq) {
          wasCancelled = true;
          return;
        }
      }
      if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.query !== 'function') {
        throw new Error('API onglets indisponible');
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (runSeq !== _analyzeSeq) {
        wasCancelled = true;
        return;
      }
      if (!tab || typeof tab.id !== 'number') {
        throw new Error('Aucun onglet actif trouvé');
      }

      const syncSettings = chrome.storage?.sync
        ? await chrome.storage.sync.get(['enabled', 'captureImages', 'selectedProvider', 'thinkingMode', 'autoMode'])
        : {};
      if (runSeq !== _analyzeSeq) {
        wasCancelled = true;
        return;
      }
      const zeroTraceMode = elements.zeroTraceToggle ? elements.zeroTraceToggle.checked === true : false;
      const runSettings = { ...syncSettings, zeroTraceMode };

      let res;
      try {
        res = await sendAnalyzeMessageToTab(tab.id, {
          action: 'analyzeQuiz',
          settings: runSettings,
          forceFallback: true
        });
      } catch (err) {
        if (runSeq !== _analyzeSeq) {
          wasCancelled = true;
          return;
        }
        if (!err || !err.isMissingReceiver || !chrome.scripting || typeof chrome.scripting.executeScript !== 'function') {
          throw err;
        }
        showProgress('Chargement…', 15);
        for (const file of ['provider-catalog.js', 'providers.js', 'schema-cache.js', 'schema-detector.js', 'dom-extractor.js', 'highlight-manager.js', 'content.js']) {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
        }
        if (runSeq !== _analyzeSeq) {
          wasCancelled = true;
          return;
        }
        await new Promise((r) => setTimeout(r, 250));
        if (runSeq !== _analyzeSeq) {
          wasCancelled = true;
          return;
        }
        showProgress('Lecture du quiz…', 25);
        res = await sendAnalyzeMessageToTab(tab.id, {
          action: 'analyzeQuiz',
          settings: runSettings,
          forceFallback: true
        });
      }

      if ((res && res.cancelled === true) || runSeq !== _analyzeSeq) {
        wasCancelled = true;
        return;
      }

      const data = res && res.data ? res.data : {};
      const totalQ = data.questionsFound ?? 0;
      const foundA = data.answersHighlighted ?? 0;
      const summary = `${foundA}/${totalQ} réponse${totalQ > 1 ? 's' : ''} prête${totalQ > 1 ? 's' : ''}`;
      showProgress(summary, 100);
      announce(summary);
      await loadSidePanelState();
    } catch (error) {
      if (runSeq !== _analyzeSeq || (error && error.cancelled === true)) {
        wasCancelled = true;
        return;
      }
      hasError = true;
      showError(error?.message || 'Erreur inconnue');
    } finally {
      if (uiSeq === _uiAnalyzeSeq) {
        resetAnalyzeButton();
      }
      if ((wasCancelled || startPanicEpoch !== _panicClearEpoch) && uiSeq === _uiAnalyzeSeq) {
        clearProgressHideTimer();
        setVisible(elements.progressSection, false, 'flex');
      } else if (!hasError && !wasCancelled && runSeq === _analyzeSeq && startPanicEpoch === _panicClearEpoch) {
        clearProgressHideTimer();
        _progressHideTimer = setTimeout(() => {
          _progressHideTimer = null;
          setVisible(elements.progressSection, false, 'flex');
        }, 2500);
        if (_progressHideTimer && typeof _progressHideTimer.unref === 'function') {
          _progressHideTimer.unref();
        }
      }
    }
  }

  async function clearHighlightsAllHttpTabs() {
    if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.query !== 'function' ||
        typeof chrome.tabs.sendMessage !== 'function') {
      return;
    }
    try {
      let tabs = await chrome.tabs.query({});
      let targetTabs = Array.isArray(tabs)
        ? tabs.filter((tab) => tab && typeof tab.id === 'number' && (tab.url === undefined || /^https?:\/\//i.test(String(tab.url))))
        : [];
      if (targetTabs.length === 0) {
        tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        targetTabs = Array.isArray(tabs)
          ? tabs.filter((tab) => tab && typeof tab.id === 'number' && (tab.url === undefined || /^https?:\/\//i.test(String(tab.url))))
          : [];
      }
      await Promise.allSettled(targetTabs.map((tab) => new Promise((resolve) => {
        try {
          chrome.tabs.sendMessage(tab.id, { action: 'clearHighlights', skipSidePanelClear: true }, () => {
            void chrome.runtime?.lastError;
            resolve();
          });
        } catch {
          resolve();
        }
      })));
    } catch { /* ignore */ }
  }

  async function clearSidePanelAndPage(reason = 'sidepanel-clear') {
    _analyzeSeq += 1;
    _panicClearEpoch += 1;
    _stateEventEpoch += 1;
    _suppressProgressUntilStart = true;
    _lastPanicClearedAt = Date.now();
    const clearId = `sp-${Date.now()}-${++_localClearSeq}`;
    _ownClearIds.push(clearId);
    if (_ownClearIds.length > 32) {
      _ownClearIds.shift();
    }
    clearProgressHideTimer();
    resetAnalyzeButton();
    renderSidePanelState(null);
    setVisible(elements.progressSection, false, 'flex');
    const clearOp = Promise.allSettled([
      sendRuntimeMessageAsync({ action: 'clearSidePanelState', reason, clearId }),
      clearHighlightsAllHttpTabs()
    ]);
    _pendingClearPromise = clearOp;
    try {
      await clearOp;
    } finally {
      if (_pendingClearPromise === clearOp) {
        _pendingClearPromise = null;
      }
    }
    announce('Panneau latéral et marques effacés');
  }

  function setupEventListeners() {
    setupCopyListeners();

    if (elements.themeBtn) {
      elements.themeBtn.addEventListener('click', async () => {
        const tm = getThemeManager();
        if (tm && typeof tm.toggleTheme === 'function') {
          await tm.toggleTheme((nextState) => syncThemeLabel(nextState));
        }
      });
    }

    if (elements.analyzeBtn) {
      elements.analyzeBtn.addEventListener('click', () => {
        void analyzeFromSidePanel();
      });
    }

    if (elements.clearBtn) {
      elements.clearBtn.addEventListener('click', () => {
        void clearSidePanelAndPage('sidepanel-clear');
      });
    }

    if (elements.zeroTraceToggle) {
      elements.zeroTraceToggle.addEventListener('change', (e) => {
        void setZeroTraceMode(e.target.checked);
      });
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage &&
        typeof chrome.runtime.onMessage.addListener === 'function') {
      chrome.runtime.onMessage.addListener((message) => {
        if (!message || typeof message !== 'object') return;
        if (message.action === 'sidePanelStateUpdated') {
          _stateEventEpoch += 1;
          renderSidePanelState(message.state || null);
        } else if (message.action === 'sidePanelPanicClear') {
          if (typeof message.clearId === 'string') {
            const ownIdx = _ownClearIds.indexOf(message.clearId);
            if (ownIdx >= 0) {
              _ownClearIds.splice(ownIdx, 1);
              return;
            }
          }
          if (typeof message.clearedAt === 'number' && Number.isFinite(message.clearedAt) &&
              _lastAnalyzeStartedAt > 0 && message.clearedAt < _lastAnalyzeStartedAt) {
            return;
          }
          _analyzeSeq += 1;
          _panicClearEpoch += 1;
          _stateEventEpoch += 1;
          _suppressProgressUntilStart = true;
          _lastPanicClearedAt = (typeof message.clearedAt === 'number' && Number.isFinite(message.clearedAt))
            ? message.clearedAt
            : Date.now();
          clearProgressHideTimer();
          resetAnalyzeButton();
          setVisible(elements.progressSection, false, 'flex');
          renderSidePanelState(null);
          announce('Panneau latéral effacé');
        } else if (message.action === 'analysisProgress') {
          const msgStartedAt = (typeof message.startedAt === 'number' && Number.isFinite(message.startedAt))
            ? message.startedAt
            : null;
          if (_lastPanicClearedAt > 0 && msgStartedAt !== null && msgStartedAt < _lastPanicClearedAt) {
            return;
          }
          if (_suppressProgressUntilStart) {
            if (msgStartedAt === null || msgStartedAt <= _lastPanicClearedAt) {
              return;
            }
            _suppressProgressUntilStart = false;
          }
          if (message.hide === true) {
            clearProgressHideTimer();
            setVisible(elements.progressSection, false, 'flex');
            return;
          }
          showProgress(message.step, message.percent);
        }
      });
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged &&
        typeof chrome.storage.onChanged.addListener === 'function') {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes && Object.prototype.hasOwnProperty.call(changes, 'zeroTraceMode')) {
          if (elements.zeroTraceToggle) {
            elements.zeroTraceToggle.checked = changes.zeroTraceMode.newValue === true;
          }
        }
      });
    }
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', async () => {
      setupEventListeners();
      await Promise.all([initTheme(), loadZeroTraceSetting(), loadSidePanelState()]);
    });
  }

  const SidePanelAPI = {
    loadSidePanelState,
    renderSidePanelState,
    analyzeFromSidePanel,
    clearSidePanelAndPage,
    setZeroTraceMode,
    copyAnswerText,
    showProgress,
    showError,
    getCurrentState: () => _currentState
  };

  if (root && typeof root === 'object') {
    root.SafeExmSidePanel = SidePanelAPI;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SidePanelAPI;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
