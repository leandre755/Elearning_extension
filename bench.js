// =============================================================
// bench.js — Mesure de performance de l'Agent Unifié
//
// ⚡ MODE DE FONCTIONNEMENT : Console du Service Worker
//   chrome://extensions → Safe Exm → "Service Worker" → Console
//   Coller le bloc ci-dessous.
// =============================================================

/* global chrome, performance, BackgroundAgent */
(async () => {
  'use strict';

  const RUNS = 3;

  const QUESTIONS = [
    {
      index: 1,
      type: 'radio',
      text: 'What is the capital of France?',
      options: [
        { index: 1, text: 'Berlin' },
        { index: 2, text: 'Madrid' },
        { index: 3, text: 'Paris' },
        { index: 4, text: 'Rome' }
      ]
    },
    {
      index: 2,
      type: 'radio',
      text: 'Which planet is closest to the Sun?',
      options: [
        { index: 1, text: 'Earth' },
        { index: 2, text: 'Mercury' },
        { index: 3, text: 'Venus' },
        { index: 4, text: 'Mars' }
      ]
    },
    {
      index: 3,
      type: 'radio',
      text: 'What is 2 + 2?',
      options: [
        { index: 1, text: '3' },
        { index: 2, text: '4' },
        { index: 3, text: '5' },
        { index: 4, text: '6' }
      ]
    }
  ];

  // Récupérer la config locale
  const localItems = await new Promise((resolve) => {
    chrome.storage.local.get(null, (items) => resolve(items || {}));
  });

  const syncItems = await new Promise((resolve) => {
    chrome.storage.sync.get(null, (items) => resolve(items || {}));
  });

  const config = {
    settings: {
      selectedProvider: 'gemini'
    },
    syncConfig: {
      ...syncItems,
      ...localItems,
      providerOrder: ['gemini', 'openai', 'groq'],
      selectedProvider: 'gemini',
      customModels: {
        gemini: {
          text: 'gemini-3.1-flash-lite',
          vision: 'gemini-4-hydrogen'
        }
      }
    },
    apiKeys: localItems
  };

  console.group('%c[BENCH SW] 🚀 Performance Benchmark: Unified Agent', 'color:#00e5ff;font-weight:bold');
  console.log('Provider :', config.settings.selectedProvider);
  console.log('Questions:', QUESTIONS.length);
  console.log('');

  async function runBenchmarkFor(modeName, agenticSearchEnabled) {
    console.log(`%c▶ Benchmarking: ${modeName}...`, 'color:#ffa726;font-weight:bold');
    const results = [];

    for (let i = 0; i < RUNS; i++) {
      const task = {
        questions: QUESTIONS,
        config: {
          ...config,
          syncConfig: {
            ...config.syncConfig,
            agenticSearch: agenticSearchEnabled,
            serpApiKey: localItems.serpApiKey || ''
          }
        },
        tabId: null,
        pageText: '',
      };

      console.log(`  Run ${i + 1}/${RUNS}...`);
      const t0 = performance.now();

      let result;
      try {
        result = await BackgroundAgent.solve(task);
      } catch (e) {
        result = { success: false, error: e.message, metadata: {} };
      }

      const wallMs = Math.round(performance.now() - t0);
      const agentMs = result?.metadata?.totalDurationMs ?? wallMs;
      const found = result?.metadata?.answersFound ?? 0;
      const status = result?.success ? '✅' : '❌';

      console.log(`    ${status} Wall: ${wallMs}ms | Agent: ${agentMs}ms | Réponses: ${found}/${QUESTIONS.length}`);
      results.push({ wallMs, agentMs, found, success: !!result?.success });
      
      // Pause entre les runs
      await new Promise(r => setTimeout(r, 1000));
    }
    return results;
  }

  // Lancer Résolution Directe (SerpAPI inactif)
  const directResults = await runBenchmarkFor('Résolution Directe (Bypass SerpAPI)', false);
  
  // Pause de transition
  await new Promise(r => setTimeout(r, 2000));

  // Lancer ReAct (SerpAPI actif)
  const reactResults = await runBenchmarkFor('ReAct Loop (SerpAPI Actif)', true);

  // Synthèse
  const getStats = (results) => {
    const ok = results.filter(r => r.success);
    const wall = ok.map(r => r.wallMs);
    const agt = ok.map(r => r.agentMs);
    const avg = (a) => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : 'N/A';
    return {
      avgWall: avg(wall),
      minWall: wall.length ? Math.min(...wall) : 'N/A',
      maxWall: wall.length ? Math.max(...wall) : 'N/A',
      avgAgent: avg(agt),
      successRate: `${ok.length}/${results.length}`
    };
  };

  const directStats = getStats(directResults);
  const reactStats = getStats(reactResults);

  console.log('');
  console.log('%c── Synthèse Comparative ──────────────────────────', 'color:#00e5ff;font-weight:bold');
  console.table({
    'Résolution Directe (Bypass)': {
      'Wall Avg (ms)': directStats.avgWall,
      'Wall Min (ms)': directStats.minWall,
      'Wall Max (ms)': directStats.maxWall,
      'Agent Avg (ms)': directStats.avgAgent,
      'Success Rate': directStats.successRate
    },
    'Boucle ReAct (SerpAPI)': {
      'Wall Avg (ms)': reactStats.avgWall,
      'Wall Min (ms)': reactStats.minWall,
      'Wall Max (ms)': reactStats.maxWall,
      'Agent Avg (ms)': reactStats.avgAgent,
      'Success Rate': reactStats.successRate
    }
  });

  const speedup = directStats.avgWall !== 'N/A' && reactStats.avgWall !== 'N/A'
    ? ((reactStats.avgWall - directStats.avgWall) / reactStats.avgWall * 100).toFixed(1)
    : null;

  if (speedup !== null) {
    if (speedup > 0) {
      console.log(`%c⚡ Le mode Résolution Directe est ${speedup}% plus rapide que la boucle ReAct (SerpAPI) !`, 'color:#66bb6a;font-weight:bold');
    } else {
      console.log(`%cℹ️ La boucle ReAct est plus rapide de ${Math.abs(speedup)}% (cas inattendu).`, 'color:#26a69a;font-weight:bold');
    }
  }

  console.groupEnd();
})();
