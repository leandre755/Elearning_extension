'use strict';
// Tests for 2026-11 model catalogs and provider payload builders (providers.js & background-agent.js).
// Zero external dependencies — Node 26 node:test + node:assert/strict.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TARGET_ROOT = process.env.TEST_TARGET_ROOT
  ? path.resolve(process.env.TEST_TARGET_ROOT)
  : path.resolve(__dirname, '..');

const { QuizProviders } = require(path.join(TARGET_ROOT, 'providers.js'));

function makeJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

// ===========================================================================
// 1. Model Catalog Integrity & Override Resolution
// ===========================================================================

test('PROVIDERS catalog contains 2026-11 active models, valid defaults, and no deprecated IDs', () => {
  const { PROVIDERS, DEFAULT_PRIORITY, getModelContextLimit, getModelForContext } = QuizProviders;

  assert.deepEqual(DEFAULT_PRIORITY, ['groq', 'gemini', 'nvidia', 'mistral', 'claude']);

  const deprecatedExactIds = new Set([
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'qwen/qwen3-32b',
    'moonshotai/kimi-k2-instruct-0905',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'moonshotai/kimi-k2.5',
    'minimaxai/minimax-m2.5',
    'deepseek-ai/deepseek-v3.2',
    'mistralai/devstral-2-123b-instruct-2512',
    'microsoft/phi-3.5-vision-instruct',
    'claude-sonnet-5',
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-3-5-sonnet-20241022'
  ]);

  for (const key of DEFAULT_PRIORITY) {
    const p = PROVIDERS[key];
    assert.ok(p, `missing provider ${key}`);
    assert.ok(Array.isArray(p.textModels) && p.textModels.length > 0, `${key}.textModels empty`);
    assert.ok(Array.isArray(p.visionModels) && p.visionModels.length > 0, `${key}.visionModels empty`);

    const textIds = p.textModels.map(m => m.id);
    const visionIds = p.visionModels.map(m => m.id);

    assert.ok(textIds.includes(p.defaultTextModel), `${key}.defaultTextModel "${p.defaultTextModel}" not in textModels`);
    assert.ok(visionIds.includes(p.defaultVisionModel), `${key}.defaultVisionModel "${p.defaultVisionModel}" not in visionModels`);

    for (const m of [...p.textModels, ...p.visionModels]) {
      assert.ok(!deprecatedExactIds.has(m.id), `${key} still contains deprecated model "${m.id}"`);
      assert.equal(typeof m.contextLimit, 'number');
      assert.ok(m.contextLimit >= 131072, `${key}:${m.id} unexpected contextLimit ${m.contextLimit}`);
      assert.equal(getModelContextLimit(key, m.id), m.contextLimit);
    }
  }

  assert.equal(PROVIDERS.groq.defaultTextModel, 'openai/gpt-oss-120b');
  assert.equal(PROVIDERS.groq.defaultVisionModel, 'qwen/qwen3.8-27b');
  assert.equal(PROVIDERS.gemini.defaultTextModel, 'gemini-4-hydrogen');
  assert.equal(PROVIDERS.gemini.defaultVisionModel, 'gemini-4-hydrogen');
  assert.equal(PROVIDERS.nvidia.defaultTextModel, 'moonshotai/kimi-k3.1-pro');
  assert.equal(PROVIDERS.nvidia.defaultVisionModel, 'nvidia/nemotron-3.5-super-vl-120b-a12b');
  assert.equal(PROVIDERS.mistral.defaultTextModel, 'mistral-small-latest');
  assert.equal(PROVIDERS.claude.defaultTextModel, 'claude-sonnet-5-5');

  // getModelForContext supports settings/bench nested shape, flat legacy shape, and uppercase provider keys
  assert.equal(
    getModelForContext('GEMINI', false, { gemini: { text: 'gemini-3.1-flash-lite', vision: 'gemini-3.8-flash' } }),
    'gemini-3.1-flash-lite'
  );
  assert.equal(
    getModelForContext('gemini', true, { gemini: { text: 'gemini-3.1-flash-lite', vision: 'gemini-3.8-flash' } }),
    'gemini-3.8-flash'
  );
  assert.equal(
    getModelForContext('claude', false, { claude_textModel: 'claude-fable-5-2' }),
    'claude-fable-5-2'
  );
  assert.equal(
    getModelForContext('claude', false, { claude: { text: '' } }),
    'claude-sonnet-5-5'
  );
});

// ===========================================================================
// 2. Gemini Thinking Config (Gemini 4 / Gemma 4 vs 2.5)
// ===========================================================================

test('callProvider("gemini"): Gemini 4 / Gemma 4 use thinkingLevel; Gemini 2.5 honors depth=0 and non-zero budget', async () => {
  const origFetch = globalThis.fetch;
  const captured = [];

  globalThis.fetch = async (url, init) => {
    captured.push({ url, body: JSON.parse(init.body) });
    return makeJsonResponse(200, {
      candidates: [{ content: { parts: [{ text: 'ok-gemini' }] } }]
    });
  };

  try {
    await QuizProviders.callProvider(
      'gemini',
      'dummy-gemini-key',
      'gemini-4-hydrogen',
      'Test prompt',
      [],
      { thinking: { enabled: true, level: 'HIGH' }, retry: { maxRetries: 0 } }
    );

    await QuizProviders.callProvider(
      'gemini',
      'dummy-gemini-key',
      'gemma-4-31b-it',
      'Test prompt',
      [],
      { thinking: { enabled: true, level: 'MEDIUM' }, retry: { maxRetries: 0 } }
    );

    await QuizProviders.callProvider(
      'gemini',
      'dummy-gemini-key',
      'gemini-2.5-flash-lite',
      'Test prompt',
      [],
      { thinking: { enabled: true, depth: 2048 }, retry: { maxRetries: 0 } }
    );

    await QuizProviders.callProvider(
      'gemini',
      'dummy-gemini-key',
      'gemini-2.5-flash-lite',
      'Test prompt',
      [],
      { thinking: { enabled: true, depth: 0 }, retry: { maxRetries: 0 } }
    );

    assert.equal(captured.length, 4);
    assert.deepEqual(captured[0].body.generationConfig.thinkingConfig, { thinkingLevel: 'HIGH' });
    assert.equal(captured[0].body.generationConfig.thinkingConfig.thinkingBudget, undefined);

    assert.deepEqual(captured[1].body.generationConfig.thinkingConfig, { thinkingLevel: 'MEDIUM' });

    assert.deepEqual(captured[2].body.generationConfig.thinkingConfig, {
      includeThoughts: true,
      thinkingBudget: 2048
    });

    assert.deepEqual(captured[3].body.generationConfig.thinkingConfig, {
      includeThoughts: false,
      thinkingBudget: 0
    });
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ===========================================================================
// 3. Claude Adaptive & Always-On Thinking Rules (Claude 5.5 / Fable 5.2 / Legacy)
// ===========================================================================

test('callProvider("claude"): adaptive thinking, omits temperature on Opus 5.5 / Fable 5.2, and ensures legacy max_tokens > budget_tokens', async () => {
  const origFetch = globalThis.fetch;
  const captured = [];

  globalThis.fetch = async (url, init) => {
    captured.push(JSON.parse(init.body));
    return makeJsonResponse(200, {
      content: [{ type: 'text', text: 'ok-claude' }]
    });
  };

  try {
    // 1. Sonnet 5.5 with thinking enabled -> adaptive + effort, NO temperature
    await QuizProviders.callProvider('claude', 'dummy-claude-key', 'claude-sonnet-5-5', 'Q1', [], {
      thinking: { enabled: true, effort: 'high' },
      retry: { maxRetries: 0 }
    });
    // 2. Sonnet 5.5 with thinking disabled -> temperature 0.3
    await QuizProviders.callProvider('claude', 'dummy-claude-key', 'claude-sonnet-5-5', 'Q2', [], {
      thinking: { enabled: false },
      retry: { maxRetries: 0 }
    });
    // 3. Opus 5.5 with thinking disabled -> STILL omits temperature (always-on adaptive thinking)
    await QuizProviders.callProvider('claude', 'dummy-claude-key', 'claude-opus-5-5', 'Q3', [], {
      thinking: { enabled: false },
      retry: { maxRetries: 0 }
    });
    // 4. Fable 5.2 with thinking disabled -> STILL omits temperature
    await QuizProviders.callProvider('claude', 'dummy-claude-key', 'claude-fable-5-2', 'Q4', [], {
      thinking: { enabled: false },
      retry: { maxRetries: 0 }
    });
    // 5. Legacy custom model with thinking enabled -> raises max_tokens above budget_tokens
    await QuizProviders.callProvider('claude', 'dummy-claude-key', 'claude-3-7-sonnet-20250219', 'Q5', [], {
      thinking: { enabled: true, depth: 10000 },
      retry: { maxRetries: 0 }
    });

    assert.equal(captured.length, 5);

    assert.deepEqual(captured[0].thinking, { type: 'adaptive', display: 'summarized' });
    assert.deepEqual(captured[0].output_config, { effort: 'high' });
    assert.equal(captured[0].temperature, undefined);

    assert.equal(captured[1].temperature, 0.3);
    assert.equal(captured[1].thinking, undefined);

    assert.equal(captured[2].temperature, undefined);
    assert.equal(captured[3].temperature, undefined);

    assert.equal(captured[4].thinking.type, 'enabled');
    assert.equal(captured[4].thinking.budget_tokens, 10000);
    assert.ok(captured[4].max_tokens > captured[4].thinking.budget_tokens);
    assert.equal(captured[4].temperature, 1.0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ===========================================================================
// 4. OpenAI-Compatible Providers (Groq, NVIDIA NIM, Mistral)
// ===========================================================================

test('callProvider("groq"): avoids include_reasoning + reasoning_format conflict and skips non-reasoning models', async () => {
  const origFetch = globalThis.fetch;
  const captured = [];

  globalThis.fetch = async (_url, init) => {
    captured.push(JSON.parse(init.body));
    return makeJsonResponse(200, {
      choices: [{ message: { content: 'ok-groq', reasoning: 'internal step' } }]
    });
  };

  try {
    const res1 = await QuizProviders.callProvider('groq', 'dummy-groq-key', 'openai/gpt-oss-120b', 'Solve X', [], {
      thinking: { enabled: true, effort: 'medium' },
      retry: { maxRetries: 0 }
    });
    assert.equal(res1, 'ok-groq');

    await QuizProviders.callProvider('groq', 'dummy-groq-key', 'qwen/qwen3.8-27b', 'Solve Y', [], {
      thinking: { enabled: false },
      retry: { maxRetries: 0 }
    });

    await QuizProviders.callProvider('groq', 'dummy-groq-key', 'llama-3.1-8b-instant', 'Solve Z', [], {
      thinking: { enabled: true },
      retry: { maxRetries: 0 }
    });

    assert.equal(captured[0].reasoning_format, 'parsed');
    assert.equal(captured[0].reasoning_effort, 'medium');
    assert.equal(captured[0].include_reasoning, undefined);
    assert.equal(captured[0].temperature, undefined);

    assert.equal(captured[1].reasoning_format, 'hidden');
    assert.equal(captured[1].include_reasoning, undefined);
    assert.equal(captured[1].temperature, 0.3);

    assert.equal(captured[2].reasoning_format, undefined);
    assert.equal(captured[2].include_reasoning, undefined);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('callProvider("nvidia"): handles uppercase providerKey, modern VLM image_url, reasoning chat_template_kwargs, and legacy Phi fallback', async () => {
  const origFetch = globalThis.fetch;
  const captured = [];

  globalThis.fetch = async (_url, init) => {
    captured.push(JSON.parse(init.body));
    return makeJsonResponse(200, {
      choices: [{ message: { content: 'ok-nvidia' } }]
    });
  };

  const fakeImg = [{ dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png' }];

  try {
    await QuizProviders.callProvider(
      'NVIDIA',
      'dummy-nv-key',
      'nvidia/nemotron-3.5-super-vl-120b-a12b',
      'Describe image',
      fakeImg,
      { thinking: { enabled: true, effort: 'high' }, retry: { maxRetries: 0 } }
    );

    await QuizProviders.callProvider(
      'nvidia',
      'dummy-nv-key',
      'microsoft/Phi-3.5-vision-instruct',
      'Describe image',
      fakeImg,
      { retry: { maxRetries: 0 } }
    );

    const modernUser = captured[0].messages.find(m => m.role === 'user');
    assert.ok(Array.isArray(modernUser.content), 'modern NVIDIA VLM must use array content with image_url');
    assert.ok(modernUser.content.some(part => part.type === 'image_url'), 'missing image_url part');
    assert.equal(captured[0].max_tokens, 16384);
    assert.deepEqual(captured[0].chat_template_kwargs, { enable_thinking: true, thinking: true });
    assert.equal(captured[0].reasoning_effort, 'high');

    const legacyUser = captured[1].messages.find(m => m.role === 'user');
    assert.equal(typeof legacyUser.content, 'string');
    assert.ok(legacyUser.content.includes('<img src="data:image/png;base64,AAAA" />'));
    assert.equal(captured[1].max_tokens, 4096);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('callProvider("mistral"): sends reasoning_effort for reasoning models and routes codestral endpoint', async () => {
  const origFetch = globalThis.fetch;
  const captured = [];

  globalThis.fetch = async (url, init) => {
    captured.push({ url, body: JSON.parse(init.body) });
    return makeJsonResponse(200, {
      choices: [{ message: { content: 'ok-mistral' } }]
    });
  };

  try {
    await QuizProviders.callProvider('mistral', 'dummy-mistral-key', 'mistral-large-latest', 'Solve', [], {
      thinking: { enabled: true, effort: 'high' },
      retry: { maxRetries: 0 }
    });
    await QuizProviders.callProvider('mistral', 'dummy-mistral-key', 'codestral-latest', 'Code', [], {
      retry: { maxRetries: 0 }
    });

    assert.equal(captured[0].url, 'https://api.mistral.ai/v1/chat/completions');
    assert.equal(captured[0].body.model, 'mistral-large-latest');
    assert.equal(captured[0].body.reasoning_effort, 'high');
    assert.equal(captured[0].body.temperature, undefined);

    assert.equal(captured[1].url, 'https://codestral.mistral.ai/v1/chat/completions');
    assert.equal(captured[1].body.model, 'codestral-latest');
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ===========================================================================
// 5. BackgroundAgent Adapters (Claude Opus/Fable 5.x, OpenAI Vision, Empty Tools)
// ===========================================================================

test('BackgroundAgent respects customModels, omits temperature on Opus 5.5/Fable 5.2, attaches OpenAI vision after system, and omits empty tools', async () => {
  const agentSrc = fs.readFileSync(path.join(TARGET_ROOT, 'background-agent.js'), 'utf8');
  const sentRequests = [];

  const mockQuizProviders = {
    PROVIDERS: QuizProviders.PROVIDERS,
    DEFAULT_PRIORITY: QuizProviders.DEFAULT_PRIORITY,
    getModelForContext: QuizProviders.getModelForContext,
    extensionFetch: async (url, init) => {
      sentRequests.push({ url, body: JSON.parse(init.body) });
      if (url.includes('generativelanguage.googleapis.com')) {
        return makeJsonResponse(200, {
          candidates: [{
            content: {
              parts: [
                { thought: true, text: 'hidden thought' },
                { text: '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index></answer></quiz_answers>' }
              ]
            }
          }]
        });
      }
      if (url.includes('api.anthropic.com')) {
        return makeJsonResponse(200, {
          content: [{ type: 'text', text: 'Leçon vérifiée.' }]
        });
      }
      return makeJsonResponse(200, {
        choices: [{
          message: {
            content: '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index></answer></quiz_answers>'
          }
        }]
      });
    }
  };

  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Promise,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      if (String(url).endsWith('system.md')) {
        return { ok: true, status: 200, text: async () => 'System prompt' };
      }
      return makeJsonResponse(404, {});
    },
    QuizProviders: mockQuizProviders,
    ConfigCache: {},
    chrome: {
      runtime: {
        getURL: (p) => `chrome-extension://test-id/${p}`,
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: async () => ({ agentMemory: [] }),
          set: async () => {}
        }
      }
    }
  };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.runInNewContext(agentSrc, sandbox, { filename: 'background-agent.js' });

  // 1. Claude Opus 5.5 -> uses real getModelForContext, omits temperature & empty tools
  const resOpus = await sandbox.BackgroundAgent.learnFromFeedback(
    [{ questionText: 'Q1', agentAnswer: 'A', correctAnswer: 'A', isCorrect: true }],
    { providerOrder: ['claude'], claudeApiKey: 'dummy-claude-key', customModels: { claude: { text: 'claude-opus-5-5' } } }
  );
  assert.equal(resOpus.success, true);

  // 2. Claude Fable 5.2 -> omits temperature
  const resFable = await sandbox.BackgroundAgent.learnFromFeedback(
    [{ questionText: 'Q2', agentAnswer: 'B', correctAnswer: 'B', isCorrect: true }],
    { providerOrder: ['claude'], claudeApiKey: 'dummy-claude-key', customModels: { claude: { text: 'claude-fable-5-2' } } }
  );
  assert.equal(resFable.success, true);

  // 3. Claude Sonnet 5.5 -> temperature 0.3
  const resSonnet = await sandbox.BackgroundAgent.learnFromFeedback(
    [{ questionText: 'Q3', agentAnswer: 'C', correctAnswer: 'C', isCorrect: true }],
    { providerOrder: ['claude'], claudeApiKey: 'dummy-claude-key', customModels: { claude: { text: 'claude-sonnet-5-5' } } }
  );
  assert.equal(resSonnet.success, true);

  // 4. NVIDIA vision in BackgroundAgent.solve Fast Path -> attaches image_url on user message & omits empty tools
  const solveRes = await sandbox.BackgroundAgent.solve({
    questions: [{
      index: 1,
      type: 'radio',
      text: 'What is in this image?',
      options: [{ text: 'Cat' }, { text: 'Dog' }],
      images: [{ dataUrl: 'data:image/png;base64,BBBB', mimeType: 'image/png' }]
    }],
    config: {
      settings: { selectedProvider: 'nvidia' },
      syncConfig: { providerOrder: ['nvidia'], customModels: {} },
      apiKeys: { nvidiaApiKey: 'dummy-nv-key' }
    }
  });
  assert.equal(solveRes.success, true);

  assert.equal(sentRequests.length, 4);

  const [opusReq, fableReq, sonnetReq, nvSolveReq] = sentRequests;
  assert.equal(opusReq.body.model, 'claude-opus-5-5');
  assert.equal(opusReq.body.temperature, undefined);
  assert.equal(opusReq.body.tools, undefined);

  assert.equal(fableReq.body.model, 'claude-fable-5-2');
  assert.equal(fableReq.body.temperature, undefined);

  assert.equal(sonnetReq.body.model, 'claude-sonnet-5-5');
  assert.equal(sonnetReq.body.temperature, 0.3);

  assert.equal(nvSolveReq.body.model, 'nvidia/nemotron-3.5-super-vl-120b-a12b');
  assert.equal(nvSolveReq.body.tools, undefined);
  assert.equal(nvSolveReq.body.tool_choice, undefined);
  const nvUserMsg = nvSolveReq.body.messages.find(m => m.role === 'user');
  assert.ok(Array.isArray(nvUserMsg.content), 'OpenAI tool adapter must attach image_url to user message even when system is at index 0');
  assert.ok(nvUserMsg.content.some(p => p.type === 'image_url' && p.image_url?.url === 'data:image/png;base64,BBBB'));
});
