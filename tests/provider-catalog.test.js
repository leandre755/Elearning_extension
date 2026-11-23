'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadModules() {
  const ProviderCatalog = require(path.join(ROOT, 'provider-catalog.js'));
  globalThis.ProviderCatalog = ProviderCatalog;
  const providersMod = require(path.join(ROOT, 'providers.js'));
  globalThis.QuizProviders = providersMod.QuizProviders;
  const Background = require(path.join(ROOT, 'background.js'));
  const BackgroundAgent = require(path.join(ROOT, 'background-agent.js'));
  return { ProviderCatalog, ...providersMod, Background, BackgroundAgent };
}

function makeMemoryStorage() {
  const store = {};
  return {
    store,
    async get(keys) {
      if (!keys) return { ...store };
      if (typeof keys === 'string') return { [keys]: store[keys] };
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) out[k] = store[k];
        return out;
      }
      return { ...store };
    },
    async set(obj) {
      Object.assign(store, obj);
    }
  };
}

function createFetchMock(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const entry = {
      url: String(url),
      method: init.method || 'GET',
      headers: { ...(init.headers || {}) },
      bodyText: typeof init.body === 'string' ? init.body : undefined,
      bodyJson: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      redirect: init.redirect
    };
    calls.push(entry);
    const res = await handler(entry);
    const status = res.status ?? 200;
    const payload = res.body ?? {};
    const textPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      async json() {
        return typeof payload === 'string' ? JSON.parse(payload) : payload;
      },
      async text() {
        return textPayload;
      }
    };
  };
  return { fn, calls };
}

async function withMockEnv({ fetchHandler, storageInit } = {}, run) {
  const prevFetch = globalThis.fetch;
  const prevChrome = globalThis.chrome;
  const localMem = makeMemoryStorage();
  if (storageInit && typeof storageInit === 'object') {
    Object.assign(localMem.store, storageInit);
  }

  const fetchMock = fetchHandler ? createFetchMock(fetchHandler) : null;
  if (fetchMock) {
    globalThis.fetch = fetchMock.fn;
  }
  globalThis.chrome = {
    storage: {
      local: localMem,
      sync: makeMemoryStorage()
    },
    runtime: {}
  };

  try {
    return await run({ fetchCalls: fetchMock ? fetchMock.calls : [], localStore: localMem.store });
  } finally {
    globalThis.fetch = prevFetch;
    globalThis.chrome = prevChrome;
  }
}

// ===========================================================================
// 1. Catalog integrity & exclusion guarantees
// ===========================================================================
test('Catalog integrity: 41 total providers (5 core + 36 catalog), OS/OAuth excluded, unique apiKeyFields', () => {
  const { ProviderCatalog, QuizProviders } = loadModules();

  const extraKeys = Object.keys(ProviderCatalog.EXTRA_PROVIDERS);
  const allKeys = Object.keys(QuizProviders.PROVIDERS);

  assert.equal(extraKeys.length, 36, `Expected 36 extra providers, got ${extraKeys.length}`);
  assert.equal(allKeys.length, 41, `Expected 41 total providers, got ${allKeys.length}`);

  for (const excluded of ['openai', 'vertex', 'antigravity']) {
    assert.equal(Object.prototype.hasOwnProperty.call(ProviderCatalog.EXTRA_PROVIDERS, excluded), false, `${excluded} must stay excluded`);
    assert.equal(Object.prototype.hasOwnProperty.call(QuizProviders.PROVIDERS, excluded), false, `${excluded} must stay excluded`);
  }

  assert.deepEqual(
    QuizProviders.DEFAULT_PRIORITY,
    ['groq', 'gemini', 'nvidia', 'mistral', 'claude'],
    'DEFAULT_PRIORITY must remain the 5 core providers'
  );

  const FORBIDDEN_LEGACY_MODEL_RE = /(?:gpt-4o|gpt-4\.1|gpt-3\.5|claude-3|claude-(?:sonnet|opus|haiku)-4|llama-?3|qwen2(?:\.5|p5)|grok-[23]|deepseek-v3|glm-4|minimax-m2\.5|kimi-k2\.5|kimi-k2-0905)/i;

  const seenFields = new Set();
  for (const [id, def] of Object.entries(QuizProviders.PROVIDERS)) {
    assert.ok(def && typeof def.name === 'string' && def.name.trim(), `${id} must have a non-empty name`);
    assert.ok(['openai-compatible', 'claude', 'gemini'].includes(def.type), `${id} invalid type: ${def.type}`);
    assert.ok(typeof def.apiKeyField === 'string' && def.apiKeyField.trim(), `${id} missing apiKeyField`);
    assert.equal(seenFields.has(def.apiKeyField), false, `Duplicate apiKeyField: ${def.apiKeyField}`);
    seenFields.add(def.apiKeyField);

    assert.equal(
      FORBIDDEN_LEGACY_MODEL_RE.test(String(def.defaultTextModel || '')),
      false,
      `${id}.defaultTextModel "${def.defaultTextModel}" uses a deprecated pre-2026 model ID`
    );
    assert.equal(
      FORBIDDEN_LEGACY_MODEL_RE.test(String(def.defaultVisionModel || '')),
      false,
      `${id}.defaultVisionModel "${def.defaultVisionModel}" uses a deprecated pre-2026 model ID`
    );
    for (const m of [...(def.textModels || []), ...(def.visionModels || [])]) {
      assert.equal(
        FORBIDDEN_LEGACY_MODEL_RE.test(String(m?.id || '')),
        false,
        `${id} model "${m?.id}" uses a deprecated pre-2026 model ID`
      );
    }
  }

  for (const genericKey of ['openai_compatible', 'anthropic_compatible']) {
    const gDef = QuizProviders.PROVIDERS[genericKey];
    assert.equal(gDef.baseUrl, '', `${genericKey} must not hardcode a vendor baseUrl`);
    assert.equal(gDef.requiresBaseUrl, true, `${genericKey} must require an explicit endpoint baseUrl`);
    assert.equal(gDef.genericProtocolConnector, true, `${genericKey} must be marked as a generic protocol connector`);
    assert.equal(gDef.defaultTextModel, 'auto', `${genericKey} defaultTextModel must be protocol-neutral 'auto'`);
  }

  const fccDef = QuizProviders.PROVIDERS.fcc_local;
  assert.equal(fccDef.staticApiKey, 'freecc', 'fcc_local.staticApiKey must match fcc-server default token');
  assert.equal(fccDef.defaultTextModel, 'groq/openai/gpt-oss-120b');
  assert.equal(fccDef.defaultVisionModel, 'antigravity/gemini-3.8-flash-tiered');
});

// ===========================================================================
// 2. URL normalization, endpoint resolution & isProviderConfigured
// ===========================================================================
test('URL normalization, base URL resolution, and isProviderConfigured contracts', () => {
  const { ProviderCatalog, QuizProviders } = loadModules();

  assert.equal(ProviderCatalog.normalizeOpenAIV1BaseUrl('http://localhost:11434'), 'http://localhost:11434/v1');
  assert.equal(ProviderCatalog.normalizeOpenAIV1BaseUrl('http://localhost:11434/'), 'http://localhost:11434/v1');
  assert.equal(ProviderCatalog.normalizeOpenAIV1BaseUrl('http://127.0.0.1:8080/v1'), 'http://127.0.0.1:8080/v1');
  assert.equal(ProviderCatalog.buildEndpointUrl('https://ps.air-outer.com/v1', '/messages?beta=true'), 'https://ps.air-outer.com/v1/messages?beta=true');

  // Ollama default & custom normalization
  assert.equal(QuizProviders.resolveProviderBaseUrl('ollama', null), 'http://localhost:11434/v1');
  assert.equal(QuizProviders.resolveProviderBaseUrl('ollama', { baseUrl: 'http://127.0.0.1:11434' }), 'http://127.0.0.1:11434/v1');

  // Cloudflare accountId interpolation + missing error
  assert.equal(
    QuizProviders.resolveProviderBaseUrl('cloudflare', { accountId: 'cf-acc-01' }),
    'https://api.cloudflare.com/client/v4/accounts/cf-acc-01/ai/v1'
  );
  assert.throws(() => QuizProviders.resolveProviderBaseUrl('cloudflare', {}), /Account ID/i);

  // Bedrock default + region override
  assert.equal(QuizProviders.resolveProviderBaseUrl('bedrock', null), 'https://bedrock-mantle.us-east-1.api.aws/v1');
  assert.equal(
    QuizProviders.resolveProviderBaseUrl('bedrock', { baseUrl: 'https://bedrock-mantle.eu-west-1.api.aws' }),
    'https://bedrock-mantle.eu-west-1.api.aws/v1'
  );

  // Azure OpenAI requires explicit baseUrl
  assert.throws(() => QuizProviders.resolveProviderBaseUrl('azure_openai', {}), /URL de base/i);
  assert.equal(
    QuizProviders.resolveProviderBaseUrl('azure_openai', { baseUrl: 'https://demo.openai.azure.com/openai/v1/' }),
    'https://demo.openai.azure.com/openai/v1'
  );

  // Mistral Codestral specialized route
  assert.equal(
    QuizProviders.resolveProviderBaseUrl('mistral', null, 'codestral-latest'),
    'https://codestral.mistral.ai/v1'
  );

  // isProviderConfigured matrix
  assert.equal(QuizProviders.isProviderConfigured('open_router', { openRouterApiKey: 'test-token-or' }), true);
  assert.equal(QuizProviders.isProviderConfigured('open_router', { openRouterApiKey: '   ' }), false);

  assert.equal(QuizProviders.isProviderConfigured('cloudflare', { cloudflareApiToken: 'test-cf-tok' }), false);
  assert.equal(QuizProviders.isProviderConfigured('cloudflare', {
    cloudflareApiToken: 'test-cf-tok',
    providerConfigs: { cloudflare: { accountId: 'cf-acc-99' } }
  }), true);

  assert.equal(QuizProviders.isProviderConfigured('azure_openai', { azureOpenaiApiKey: 'test-az' }), false);
  assert.equal(QuizProviders.isProviderConfigured('azure_openai', {
    azureOpenaiApiKey: 'test-az',
    providerConfigs: { azure_openai: { baseUrl: 'https://demo.openai.azure.com/openai/v1' } }
  }), true);

  assert.equal(QuizProviders.isProviderConfigured('openai_compatible', { openaiCompatibleApiKey: 'test-oc' }), false);
  assert.equal(QuizProviders.isProviderConfigured('openai_compatible', {
    openaiCompatibleApiKey: 'test-oc',
    providerConfigs: { openai_compatible: { baseUrl: 'https://gateway.example.com/v1' } }
  }), true);

  assert.equal(QuizProviders.isProviderConfigured('anthropic_compatible', { anthropicCompatibleApiKey: 'test-ac' }), false);
  assert.equal(QuizProviders.isProviderConfigured('anthropic_compatible', {
    anthropicCompatibleApiKey: 'test-ac',
    providerConfigs: { anthropic_compatible: { baseUrl: 'http://127.0.0.1:8082/v1' } }
  }), true);

  assert.equal(QuizProviders.resolveProviderBaseUrl('fcc_local', null), 'http://127.0.0.1:8082/v1');
  assert.equal(QuizProviders.resolveProviderBaseUrl('fcc_local', { baseUrl: 'http://localhost:8082' }), 'http://localhost:8082/v1');
  assert.equal(QuizProviders.isProviderConfigured('fcc_local', {}), false);
  assert.equal(QuizProviders.isProviderConfigured('fcc_local', { providerConfigs: { fcc_local: { enabled: false } } }), false);
  assert.equal(QuizProviders.isProviderConfigured('fcc_local', { providerConfigs: { fcc_local: { enabled: true } } }), true);
  assert.equal(QuizProviders.isProviderConfigured('ollama', {}), false);
  assert.equal(QuizProviders.isProviderConfigured('ollama', { providerConfigs: { ollama: { enabled: false } } }), false);
  assert.equal(QuizProviders.isProviderConfigured('ollama', { providerConfigs: { ollama: { enabled: true } } }), true);
  assert.equal(QuizProviders.isProviderConfigured('lmstudio', { providerConfigs: { lmstudio: { enabled: true } } }), true);
  assert.equal(QuizProviders.isProviderConfigured('llamacpp', { providerConfigs: { llamacpp: { enabled: true } } }), true);
});

// ===========================================================================
// 3. Multi-protocol outbound requests via QuizProviders.callProvider
// ===========================================================================
test('QuizProviders.callProvider routes headers, URLs, max_completion_tokens, Anthropic & local protocols accurately', async () => {
  const { QuizProviders } = loadModules();

  await withMockEnv({
    fetchHandler: async (req) => {
      if (req.url.includes('/messages')) {
        return { status: 200, body: { content: [{ type: 'text', text: 'claude-ok' }] } };
      }
      return { status: 200, body: { choices: [{ message: { content: 'openai-ok' } }] } };
    }
  }, async ({ fetchCalls }) => {
    // open_router
    await QuizProviders.callProvider('open_router', 'tok-or', 'openrouter/auto', 'Ping', []);
    let call = fetchCalls.at(-1);
    assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(call.headers.Authorization, 'Bearer tok-or');
    assert.equal(typeof call.bodyJson.max_tokens, 'number');

    // cloudflare
    await QuizProviders.callProvider('cloudflare', 'tok-cf', '@cf/moonshotai/kimi-k2.6', 'Ping', [], {
      providerConfig: { accountId: 'cf-acc-01' }
    });
    call = fetchCalls.at(-1);
    assert.equal(call.url, 'https://api.cloudflare.com/client/v4/accounts/cf-acc-01/ai/v1/chat/completions');
    assert.equal(typeof call.bodyJson.max_completion_tokens, 'number');
    assert.equal(call.bodyJson.max_tokens, undefined);

    // azure_openai & other max_completion_tokens OpenAI-compatible profiles
    const maxCompletionCases = [
      ['azure_openai', { baseUrl: 'https://demo.openai.azure.com/openai/v1' }, 'https://demo.openai.azure.com/openai/v1/chat/completions'],
      ['cerebras', null, 'https://api.cerebras.ai/v1/chat/completions'],
      ['kimi_code', null, 'https://api.kimi.com/coding/v1/chat/completions'],
      ['minimax', null, 'https://api.minimax.io/v1/chat/completions'],
      ['alibaba', null, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'],
      ['commandcode', null, 'https://api.commandcode.ai/provider/v1/chat/completions'],
      ['tokenrouter', null, 'https://api.tokenrouter.com/v1/chat/completions']
    ];
    for (const [pKey, pCfg, expectedUrl] of maxCompletionCases) {
      const def = QuizProviders.PROVIDERS[pKey];
      await QuizProviders.callProvider(pKey, `tok-${pKey}`, def.defaultTextModel, 'Ping', [], pCfg ? { providerConfig: pCfg } : {});
      call = fetchCalls.at(-1);
      assert.equal(call.url, expectedUrl, `${pKey} URL mismatch`);
      assert.equal(typeof call.bodyJson.max_completion_tokens, 'number', `${pKey} must send max_completion_tokens`);
      assert.equal(call.bodyJson.max_tokens, undefined, `${pKey} must not send max_tokens`);
    }

    // github_models
    await QuizProviders.callProvider('github_models', 'tok-gh', 'openai/gpt-5.5', 'Ping', []);
    call = fetchCalls.at(-1);
    assert.equal(call.url, 'https://models.github.ai/inference/chat/completions');
    assert.equal(call.headers.Accept, 'application/vnd.github+json');
    assert.equal(call.headers['X-GitHub-Api-Version'], '2026-03-10');
    assert.equal(call.headers.Authorization, 'Bearer tok-gh');

    // agentrouter (Claude protocol with /messages?beta=true + Bearer + x-api-key)
    const arRes = await QuizProviders.callProvider('agentrouter', 'tok-ar', 'claude-fable-5-2', 'Ping', []);
    assert.equal(arRes, 'claude-ok');
    call = fetchCalls.at(-1);
    assert.equal(call.url, 'https://ps.air-outer.com/v1/messages?beta=true');
    assert.equal(call.headers['x-api-key'], 'tok-ar');
    assert.equal(call.headers.Authorization, 'Bearer tok-ar');
    assert.equal(call.headers['anthropic-version'], '2023-06-01');

    // anthropic_compatible with custom baseUrl
    await QuizProviders.callProvider('anthropic_compatible', 'tok-ac', 'claude-sonnet-5-5', 'Ping', [], {
      providerConfig: { baseUrl: 'https://claude-proxy.example.com/v1' }
    });
    call = fetchCalls.at(-1);
    assert.equal(call.url, 'https://claude-proxy.example.com/v1/messages');
    assert.equal(call.headers['x-api-key'], 'tok-ac');
    assert.equal(call.headers.Authorization, undefined);

    // fcc_local with empty key uses fallback static key ('freecc') & Anthropic /v1/messages on 127.0.0.1:8082
    const fccRes = await QuizProviders.callProvider('fcc_local', '', 'groq/openai/gpt-oss-120b', 'Ping', [], {
      providerConfig: { enabled: true }
    });
    assert.equal(fccRes, 'claude-ok');
    call = fetchCalls.at(-1);
    assert.equal(call.url, 'http://127.0.0.1:8082/v1/messages');
    assert.equal(call.headers['x-api-key'], 'freecc');
    assert.equal(call.headers.Authorization, 'Bearer freecc');

    // ollama local with empty key uses fallback static key & /v1 normalization
    await QuizProviders.callProvider('ollama', '', 'qwen3.8:27b', 'Ping', [], {
      providerConfig: { enabled: true }
    });
    call = fetchCalls.at(-1);
    assert.equal(call.url, 'http://localhost:11434/v1/chat/completions');
    assert.equal(call.headers.Authorization, 'Bearer ollama');
  });
});

// ===========================================================================
// 4. ModelRegistry discovery formats across providers
// ===========================================================================
test('ModelRegistry.syncProviderModels parses xAI, Together, GitHub Models, Cloudflare, Anthropic Compatible, standard, and AgentRouter fallback', async () => {
  const { ModelRegistry, QuizProviders } = loadModules();

  await withMockEnv({
    fetchHandler: async (req) => {
      if (req.url === 'https://openrouter.ai/api/v1/models') {
        return { status: 200, body: { data: [{ id: 'openrouter/auto', context_length: 128000 }] } };
      }
      if (req.url === 'http://127.0.0.1:8082/v1/models') {
        return {
          status: 200,
          body: {
            object: 'list',
            data: [{ id: 'antigravity/gemini-4-hydrogen', context_length: 1048576 }]
          }
        };
      }
      if (req.url === 'http://localhost:11434/v1/models') {
        return { status: 200, body: { data: [{ id: 'qwen3.8:27b', name: 'Qwen 3.8 27B' }] } };
      }
      if (req.url === 'https://api.x.ai/v1/language-models') {
        return { status: 200, body: { models: [{ id: 'grok-4.5', aliases: ['grok-4.5-latest'], max_input_tokens: 256000 }] } };
      }
      if (req.url === 'https://api.together.xyz/v1/models' || req.url === 'https://api.together.ai/v1/models') {
        return {
          status: 200,
          body: [
            { id: 'zai-org/GLM-5.2', type: 'chat', context_length: 200000 },
            { id: 'black-forest-labs/FLUX.1', type: 'image' }
          ]
        };
      }
      if (req.url === 'https://models.github.ai/catalog/models') {
        return {
          status: 200,
          body: [
            { id: 'openai/gpt-5.5', capabilities: ['streaming', 'tool-calling'] },
            { id: 'legacy/no-tools', capabilities: ['streaming'] }
          ]
        };
      }
      if (req.url === 'https://api.cloudflare.com/client/v4/accounts/cf-acc-42/ai/models/search?format=openrouter') {
        return {
          status: 200,
          body: { data: [{ id: '@cf/moonshotai/kimi-k2.6', name: 'Kimi K2.6' }] }
        };
      }
      if (req.url === 'https://claude-proxy.example.com/v1/models') {
        return {
          status: 200,
          body: { data: [{ id: 'claude-custom-1', display_name: 'Claude Custom 1' }] }
        };
      }
      if (req.url === 'https://ps.air-outer.com/v1/models') {
        return { status: 404, body: { error: { message: 'Not supported' } } };
      }
      return { status: 404, body: {} };
    }
  }, async () => {
    const orModels = await ModelRegistry.syncProviderModels('open_router', 'tok-or', null, { force: true });
    assert.deepEqual(orModels.map(m => m.id), ['openrouter/auto']);

    const fccModels = await ModelRegistry.syncProviderModels('fcc_local', '', { enabled: true }, { force: true });
    assert.deepEqual(fccModels.map(m => m.id), ['antigravity/gemini-4-hydrogen']);
    assert.equal(fccModels[0].free, true);
    assert.equal(fccModels[0].contextWindow, 1048576);
    assert.equal(fccModels[0].vision, true);

    const ollamaModels = await ModelRegistry.syncProviderModels('ollama', '', { enabled: true }, { force: true });
    assert.deepEqual(ollamaModels.map(m => m.id), ['qwen3.8:27b']);
    assert.equal(ollamaModels[0].free, true);

    const xaiModels = await ModelRegistry.syncProviderModels('xai', 'tok-xai', null, { force: true });
    assert.deepEqual(xaiModels.map(m => m.id), ['grok-4.5', 'grok-4.5-latest']);

    const togetherModels = await ModelRegistry.syncProviderModels('together', 'tok-tg', null, { force: true });
    assert.deepEqual(togetherModels.map(m => m.id), ['zai-org/GLM-5.2']);

    const ghModels = await ModelRegistry.syncProviderModels('github_models', 'tok-gh', null, { force: true });
    assert.deepEqual(ghModels.map(m => m.id), ['openai/gpt-5.5']);

    const cfModels = await ModelRegistry.syncProviderModels('cloudflare', 'tok-cf', { accountId: 'cf-acc-42' }, { force: true });
    assert.deepEqual(cfModels.map(m => m.id), ['@cf/moonshotai/kimi-k2.6']);

    const acModels = await ModelRegistry.syncProviderModels('anthropic_compatible', 'tok-ac', {
      baseUrl: 'https://claude-proxy.example.com/v1'
    }, { force: true });
    assert.deepEqual(acModels.map(m => m.id), ['claude-custom-1']);
    assert.equal(acModels[0].contextWindow, 200000);

    const arModels = await ModelRegistry.syncProviderModels('agentrouter', 'tok-ar', null, { force: true });
    assert.ok(Array.isArray(arModels) && arModels.length >= QuizProviders.PROVIDERS.agentrouter.textModels.length);
    assert.ok(arModels.some(m => m.id === 'claude-fable-5-2'));
  });
});

// ===========================================================================
// 5. Anti-SSRF (isAllowedLLMUrl, handleFetchLLM redirect:error, isBlockedImageHost)
// ===========================================================================
test('background.js Anti-SSRF allows static/regex/configured origins & scoped loopback while blocking private/metadata/unconfigured/redirect hosts', async () => {
  const { Background } = loadModules();

  const configs = {
    openai_compatible: { baseUrl: 'https://llm-gateway.example.com/v1' },
    fcc_local: { enabled: true },
    ollama: { enabled: true },
    lmstudio: { enabled: false }
  };

  assert.equal(
    Background.isAllowedLLMUrl(new URL('http://127.0.0.1:8082/v1/messages'), { fcc_local: { enabled: false } }),
    false,
    'Disabled fcc_local must not allow 127.0.0.1:8082'
  );

  // Positive controls
  for (const allowed of [
    'https://api.deepseek.com/v1/chat/completions',
    'https://openrouter.ai/api/v1/chat/completions',
    'https://models.github.ai/inference/chat/completions',
    'https://ps.air-outer.com/v1/messages?beta=true',
    'https://bedrock-mantle.eu-west-1.api.aws/v1/chat/completions',
    'https://my-res.openai.azure.com/openai/v1/chat/completions',
    'https://llm-gateway.example.com/v1/chat/completions',
    'http://localhost:11434/v1/chat/completions',
    'http://127.0.0.1:8082/v1/messages'
  ]) {
    assert.equal(Background.isAllowedLLMUrl(new URL(allowed), configs), true, `Expected allowed: ${allowed}`);
  }

  // Negative SSRF controls — even when maliciously injected into providerConfigs
  const hostileConfigs = {
    ...configs,
    open_router: { baseUrl: 'http://localhost:9999/v1' },
    groq: { baseUrl: 'http://127.0.0.1:8080/v1' },
    openai_compatible: { baseUrl: 'http://169.254.169.254/latest/meta-data/' },
    commandcode: { baseUrl: 'https://10.0.0.1/v1' },
    tokenrouter: { baseUrl: 'https://192.168.1.50/v1' }
  };

  for (const blocked of [
    'http://169.254.169.254/latest/meta-data/',
    'https://10.0.0.1/v1/chat/completions',
    'https://192.168.1.50/v1/chat/completions',
    'http://127.0.0.1:8080/v1/chat/completions',
    'http://localhost:9999/v1/chat/completions',
    'http://localhost:11434/v1/chat/completions',
    'http://localhost:1234/v1/chat/completions',
    'https://user:pass@api.groq.com/openai/v1/chat/completions',
    'https://api.groq.com:8443/openai/v1/chat/completions',
    'http://api.groq.com/openai/v1/chat/completions',
    'https://-bad.openai.azure.com/openai/v1/chat/completions',
    'https://bedrock-mantle.-bad.api.aws/v1/chat/completions',
    'https://evil.unregistered.example.com/v1/chat/completions'
  ]) {
    const useConfigs = blocked === 'http://localhost:11434/v1/chat/completions' ? { lmstudio: { enabled: true } } : hostileConfigs;
    assert.equal(Background.isAllowedLLMUrl(new URL(blocked), useConfigs), false, `Expected blocked: ${blocked}`);
  }

  // Image proxy SSRF guard must remain strict on loopback & private ranges
  assert.equal(Background.isBlockedImageHost('localhost'), true);
  assert.equal(Background.isBlockedImageHost('127.0.0.1'), true);
  assert.equal(Background.isBlockedImageHost('169.254.169.254'), true);
  assert.equal(Background.isBlockedImageHost('10.0.0.5'), true);

  // handleFetchLLM enforces redirect: 'error' & blocks unregistered origins before fetch
  const seenInits = [];
  const prevFetch = globalThis.fetch;
  const prevChrome = globalThis.chrome;
  globalThis.fetch = async (url, init) => {
    seenInits.push({ url, redirect: init.redirect, method: init.method });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ ok: true });
      }
    };
  };
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          return { providerConfigs: { ollama: { enabled: true } } };
        }
      }
    }
  };
  try {
    const blockedRes = await Background.handleFetchLLM('http://169.254.169.254/latest/meta-data/', { method: 'GET' });
    assert.equal(blockedRes.success, false);
    assert.equal(seenInits.length, 0, 'Blocked URL must never trigger fetch()');

    const okRes = await Background.handleFetchLLM('http://localhost:11434/v1/chat/completions', { method: 'POST', body: '{}' });
    assert.equal(okRes.success, true);
    assert.equal(seenInits.length, 1);
    assert.equal(seenInits[0].redirect, 'error', 'handleFetchLLM must enforce redirect: error');
  } finally {
    globalThis.fetch = prevFetch;
    globalThis.chrome = prevChrome;
  }
});

// ===========================================================================
// 6. BackgroundAgent._callLLMWithTools multi-protocol smoke tests
// ===========================================================================
test('BackgroundAgent._callLLMWithTools routes agentrouter, anthropic_compatible, ollama, and cloudflare', async () => {
  const { BackgroundAgent } = loadModules();

  const dummyTools = [
    {
      name: 'answer_quiz',
      description: 'Submit final answer',
      parameters: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] }
    }
  ];
  const history = {
    system: 'Solve carefully.',
    messages: [{ role: 'user', content: 'Question 1?' }]
  };

  await withMockEnv({
    fetchHandler: async (req) => {
      if (req.url.includes('/messages')) {
        return {
          status: 200,
          body: { content: [{ type: 'tool_use', id: 'tool-1', name: 'answer_quiz', input: { answer: 'B' } }] }
        };
      }
      return {
        status: 200,
        body: {
          choices: [{
            message: {
              content: '',
              tool_calls: [{ id: 'tool-2', type: 'function', function: { name: 'answer_quiz', arguments: '{"answer":"A"}' } }]
            }
          }]
        }
      };
    }
  }, async ({ fetchCalls }) => {
    const apiKeys = {
      agentrouterApiKey: 'tok-ar',
      anthropicCompatibleApiKey: 'tok-ac',
      cloudflareApiToken: 'tok-cf',
      providerConfigs: {
        anthropic_compatible: { baseUrl: 'https://claude-proxy.example.com/v1' },
        cloudflare: { accountId: 'cf-acc-77' },
        fcc_local: { enabled: true },
        ollama: { enabled: true }
      }
    };

    const fcc = await BackgroundAgent._callLLMWithTools('fcc_local', apiKeys, 'groq/openai/gpt-oss-120b', history, [], dummyTools);
    assert.equal(fcc.toolCalls[0].name, 'answer_quiz');
    assert.equal(fetchCalls.at(-1).url, 'http://127.0.0.1:8082/v1/messages');
    assert.equal(fetchCalls.at(-1).headers['x-api-key'], 'freecc');
    assert.equal(fetchCalls.at(-1).headers.Authorization, 'Bearer freecc');

    const ar = await BackgroundAgent._callLLMWithTools('agentrouter', apiKeys, 'claude-fable-5-2', history, [], dummyTools);
    assert.equal(ar.toolCalls[0].name, 'answer_quiz');
    assert.equal(fetchCalls.at(-1).url, 'https://ps.air-outer.com/v1/messages?beta=true');
    assert.equal(fetchCalls.at(-1).headers.Authorization, 'Bearer tok-ar');
    assert.equal(fetchCalls.at(-1).headers['x-api-key'], 'tok-ar');

    const ac = await BackgroundAgent._callLLMWithTools('anthropic_compatible', apiKeys, 'claude-sonnet-5-5', history, [], dummyTools);
    assert.equal(ac.toolCalls[0].input || ac.toolCalls[0].args.answer, 'B');
    assert.equal(fetchCalls.at(-1).url, 'https://claude-proxy.example.com/v1/messages');

    const ol = await BackgroundAgent._callLLMWithTools('ollama', apiKeys, 'qwen3.8:27b', history, [], dummyTools);
    assert.equal(ol.toolCalls[0].name, 'answer_quiz');
    assert.equal(fetchCalls.at(-1).url, 'http://localhost:11434/v1/chat/completions');
    assert.equal(fetchCalls.at(-1).headers.Authorization, 'Bearer ollama');

    const cf = await BackgroundAgent._callLLMWithTools('cloudflare', apiKeys, '@cf/moonshotai/kimi-k2.6', history, [], dummyTools);
    assert.equal(cf.toolCalls[0].name, 'answer_quiz');
    assert.equal(fetchCalls.at(-1).url, 'https://api.cloudflare.com/client/v4/accounts/cf-acc-77/ai/v1/chat/completions');
    assert.equal(typeof fetchCalls.at(-1).bodyJson.max_completion_tokens, 'number');
  });
});

// ===========================================================================
// 7. Regressions: smartRoute catalog fallback, crossValidateAnswers & testProvider stale model reset
// ===========================================================================
test('Antibug regressions: smartRoute & crossValidateAnswers reach catalog providers when providerOrder is unset, and testProvider clears stale override', async () => {
  const { QuizProviders, BackgroundAgent } = loadModules();

  await withMockEnv({
    fetchHandler: async (req) => {
      if (req.url === 'https://openrouter.ai/api/v1/chat/completions') {
        return { status: 200, body: { choices: [{ message: { content: 'smart-or-ok' } }] } };
      }
      return { status: 404, body: {} };
    }
  }, async ({ fetchCalls }) => {
    // smartRoute with null order OR legacy 5-core priority resolves configured catalog provider
    const resNullOrder = await QuizProviders.smartRoute('Hello', [], { openRouterApiKey: 'tok-or-only' }, null);
    assert.equal(resNullOrder.provider, 'open_router');
    assert.equal(resNullOrder.text, 'smart-or-ok');

    const resLegacyOrder = await QuizProviders.smartRoute(
      'Hello',
      [],
      { openRouterApiKey: 'tok-or-only' },
      ['groq', 'gemini', 'nvidia', 'mistral', 'claude']
    );
    assert.equal(resLegacyOrder.provider, 'open_router');
    assert.ok(fetchCalls.some(c => c.url === 'https://openrouter.ai/api/v1/chat/completions'));

    // crossValidateAnswers uses open_router as secondary reviewer when providerOrder is unset
    const secondaryCalled = [];
    const answers = [{ questionIndex: 0, confidence: 40, optionIndices: [0] }];
    const questions = [{ index: 1, type: 'single_choice', questionType: 'single_choice', text: '2+2?', options: [{ text: '4' }, { text: '5' }] }];
    const cvResult = await BackgroundAgent.crossValidateAnswers(answers, questions, {
      primaryProvider: 'groq',
      threshold: 70,
      apiKeys: { groqApiKey: 'tok-groq-1', openRouterApiKey: 'tok-or-2' },
      callLLM: async (secProvider) => {
        secondaryCalled.push(secProvider);
        return { text: '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index><confidence>95</confidence><explanation>Confirmed</explanation></answer></quiz_answers>' };
      }
    });
    assert.deepEqual(secondaryCalled, ['open_router']);
    assert.equal(cvResult[0].crossValidated, true);
  });

  // settings.js testProvider drops stale customModels.groq.text when live DOM override input is cleared
  const capturedCalls = [];
  const groqKeyInput = { value: 'tok-groq-live', id: 'groqApiKey' };
  const liveOverrideInput = {
    value: '',
    dataset: { provider: 'groq', type: 'text' }
  };
  const saveStatusEl = { textContent: '', className: '' };
  const modelOverridesEl = {
    querySelector: (sel) => (sel.includes('groq') && sel.includes('text') ? liveOverrideInput : null),
    querySelectorAll: () => [liveOverrideInput]
  };
  const doc = {
    documentElement: { setAttribute() {}, getAttribute() { return 'light'; } },
    getElementById: (id) => {
      if (id === 'groqApiKey') return groqKeyInput;
      if (id === 'saveStatus') return saveStatusEl;
      if (id === 'modelOverrides') return modelOverridesEl;
      return null;
    },
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  const sandbox = {
    document: doc,
    window: null,
    chrome: {
      storage: {
        sync: { async get() { return {}; }, async set() {} },
        local: { async get() { return {}; }, async set() {} }
      }
    },
    QuizProviders: {
      PROVIDERS: {
        groq: {
          name: 'Groq',
          apiKeyField: 'groqApiKey',
          defaultTextModel: 'openai/gpt-oss-120b'
        }
      },
      DEFAULT_PRIORITY: ['groq'],
      getAllStorageKeys: () => ['groqApiKey', 'providerConfigs'],
      isProviderConfigured: () => true,
      async callProvider(pKey, key, model) {
        capturedCalls.push({ pKey, key, model });
        return 'OK';
      }
    },
    ModelRegistry: null,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Array,
    Object,
    String,
    Set,
    JSON,
    Math
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'settings.js'), 'utf8'), sandbox);
  vm.runInNewContext("customModels = { groq: { text: 'stale-broken-model' } };", sandbox);
  const fakeBtn = { textContent: 'Tester', disabled: false, style: {} };
  await sandbox.testProvider('groq', fakeBtn);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].model, 'openai/gpt-oss-120b', 'Cleared live input must override stale saved customModels entry');
});

// ===========================================================================
// 8. Regressions: SW SSRF/redirect defense & crossValidateAnswers empty/legacy priority
// ===========================================================================
test('Antibug regressions (pass 2): Service Worker direct fetch blocks SSRF + enforces redirect:error, and crossValidateAnswers works with [] or legacy 5-core order', async () => {
  const { BackgroundAgent } = loadModules();

  // 1. crossValidateAnswers works when providerOrder is [] or legacy 5-core list with catalog providers only
  for (const order of [[], ['groq', 'gemini', 'nvidia', 'mistral', 'claude']]) {
    const called = [];
    const res = await BackgroundAgent.crossValidateAnswers(
      [{ questionIndex: 0, confidence: 45, optionIndices: [0] }],
      [{ index: 1, type: 'radio', text: '1+1?', options: [{ text: '2' }, { text: '3' }] }],
      {
        primaryProvider: 'open_router',
        threshold: 70,
        config: {
          syncConfig: { providerOrder: order },
          apiKeys: { openRouterApiKey: 'tok-or', deepseekApiKey: 'tok-ds' }
        },
        callLLM: async (secProvider) => {
          called.push(secProvider);
          return { text: '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index><confidence>92</confidence><explanation>OK</explanation></answer></quiz_answers>' };
        }
      }
    );
    assert.deepEqual(called, ['deepseek'], `Expected secondary deepseek for order=${JSON.stringify(order)}`);
    assert.equal(res[0].crossValidated, true);
  }

  // 2. Service Worker SSRF defense: untrusted IPC providerConfigs cannot reach 169.254.169.254 via BackgroundAgent.solve(),
  //    and allowed SW direct fetches enforce redirect: 'error'
  const swFetchCalls = [];
  const swSandbox = {
    URL,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    AbortSignal,
    Promise,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Set,
    Map,
    WeakMap,
    JSON,
    Math,
    Date,
    RegExp,
    Error,
    TypeError,
    chrome: {
      storage: {
        local: {
          async get(keys) {
            if (Array.isArray(keys) && keys.includes('providerConfigs')) {
              return { providerConfigs: {} };
            }
            return {};
          },
          async set() {}
        },
        sync: { async get() { return {}; }, async set() {} }
      },
      runtime: { getURL: (p) => `chrome-extension://test-ext/${p}` }
    },
    fetch: async (url, init = {}) => {
      swFetchCalls.push({ url: String(url), redirect: init.redirect });
      if (String(url).endsWith('system.md')) {
        return { ok: true, status: 200, text: async () => 'System prompt {{domain_rules}}' };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          choices: [{
            message: {
              content: '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index><confidence>90</confidence></answer></quiz_answers>'
            }
          }]
        })
      };
    }
  };
  swSandbox.self = swSandbox;
  swSandbox.window = undefined;
  swSandbox.globalThis = swSandbox;
  vm.createContext(swSandbox);
  vm.runInContext('class ServiceWorkerGlobalScope {} Object.setPrototypeOf(self, ServiceWorkerGlobalScope.prototype);', swSandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'provider-catalog.js'), 'utf8'), swSandbox, { filename: 'provider-catalog.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'providers.js'), 'utf8'), swSandbox, { filename: 'providers.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background-agent.js'), 'utf8'), swSandbox, { filename: 'background-agent.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), swSandbox, { filename: 'background.js' });

  const ssrfRes = await swSandbox.BackgroundAgent.solve({
    questions: [{ index: 1, type: 'radio', text: 'Q1?', options: [{ text: 'A' }, { text: 'B' }] }],
    config: {
      settings: { selectedProvider: 'azure_openai' },
      syncConfig: {},
      apiKeys: {
        azureOpenaiApiKey: 'tok-untrusted-ssrf',
        providerConfigs: { azure_openai: { baseUrl: 'http://169.254.169.254/latest/meta-data' } }
      }
    }
  });
  assert.equal(ssrfRes.success, false, 'Untrusted metadata baseUrl in SW IPC task must fail closed');
  assert.equal(
    swFetchCalls.some(c => c.url.includes('169.254.169.254')),
    false,
    'SW fetch must never contact untrusted metadata endpoint'
  );

  // Even a direct QuizProviders.callProvider bypass attempt inside SW is blocked by _enforceDirectFetchPolicy
  await assert.rejects(
    swSandbox.QuizProviders.callProvider(
      'openai_compatible',
      'tok-untrusted-ssrf',
      'auto',
      'Ping',
      [],
      { retry: false, providerConfig: { baseUrl: 'http://169.254.169.254/latest/meta-data' } }
    ),
    /non autorisée/i
  );
  assert.equal(
    swFetchCalls.some(c => c.url.includes('169.254.169.254')),
    false,
    'Direct SW fetch policy must reject metadata host before fetch()'
  );

  // Positive SW control: allowed cloud host succeeds and enforces redirect: 'error'
  swFetchCalls.length = 0;
  const okSwRes = await swSandbox.BackgroundAgent.solve({
    questions: [{ index: 1, type: 'radio', text: 'Q1?', options: [{ text: 'A' }, { text: 'B' }] }],
    config: {
      settings: { selectedProvider: 'groq' },
      syncConfig: {},
      apiKeys: { groqApiKey: 'tok-groq-sw' }
    }
  });
  assert.equal(okSwRes.success, true);
  const groqCall = swFetchCalls.find(c => c.url.includes('api.groq.com'));
  assert.ok(groqCall, 'Expected allowed call to api.groq.com');
  assert.equal(groqCall.redirect, 'error', 'SW direct fetch must enforce redirect: error');

  // submitQuizFeedback with flat ConfigCache.getAll() preserves API keys/providerOrder and strips untrusted providerConfigs
  swFetchCalls.length = 0;
  let feedbackReply = null;
  swSandbox.fetch = async (url, init = {}) => {
    swFetchCalls.push({ url: String(url), redirect: init.redirect });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content: 'Feedback lesson OK.' } }] })
    };
  };
  await new Promise((resolve) => {
    const isAsync = swSandbox.handleRuntimeMessage(
      {
        action: 'submitQuizFeedback',
        feedbackData: [{ questionText: 'Q1', agentAnswer: 'A', correctAnswer: 'B', isCorrect: false }],
        config: {
          openRouterApiKey: 'tok-or-flat-feedback',
          providerOrder: ['open_router'],
          providerConfigs: { open_router: { baseUrl: 'http://169.254.169.254/latest' } }
        }
      },
      {},
      (reply) => {
        feedbackReply = reply;
        resolve();
      }
    );
    assert.equal(isAsync, true);
  });
  assert.equal(feedbackReply?.success, true, 'Flat ConfigCache config in submitQuizFeedback must reach OpenRouter cleanly');
  assert.ok(
    swFetchCalls.some(c => c.url === 'https://openrouter.ai/api/v1/chat/completions' && c.redirect === 'error'),
    'submitQuizFeedback must use openrouter.ai and redirect: error without calling untrusted providerConfigs'
  );
  assert.equal(swFetchCalls.some(c => c.url.includes('169.254.169.254')), false);

  // settings.js validateProviderBaseUrl aligns with background Anti-SSRF on .localhost and multicast >=224
  const { QuizProviders: QpUi } = loadModules();
  const uiDoc = {
    documentElement: { setAttribute() {}, getAttribute() { return 'light'; } },
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  const uiSandbox = {
    document: uiDoc,
    window: null,
    chrome: { storage: { sync: { async get() { return {}; } }, local: { async get() { return {}; } } } },
    QuizProviders: QpUi,
    ModelRegistry: null,
    URL,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Array,
    Object,
    String,
    Set,
    JSON,
    Math
  };
  uiSandbox.window = uiSandbox;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'settings.js'), 'utf8'), uiSandbox);
  assert.equal(uiSandbox.validateProviderBaseUrl(QpUi.PROVIDERS.openai_compatible, 'https://sub.localhost/v1').ok, false);
  assert.equal(uiSandbox.validateProviderBaseUrl(QpUi.PROVIDERS.openai_compatible, 'https://224.0.0.1/v1').ok, false);
  assert.equal(uiSandbox.validateProviderBaseUrl(QpUi.PROVIDERS.anthropic_compatible, 'http://127.0.0.1:8082/v1').ok, true);

  // Generic protocol connector synced-model warming across cache hits, getCachedModels, and preWarmProviders
  await withMockEnv({
    storageInit: {
      modelMetadataCache: {
        openai_compatible: {
          lastSync: Date.now(),
          models: [
            { id: 'vllm-primary-text', contextWindow: 131072, vision: false },
            { id: 'vllm-secondary-vision', contextWindow: 131072, vision: true }
          ]
        }
      }
    },
    fetchHandler: async (req) => {
      if (req.bodyJson && req.bodyJson.model === 'vllm-primary-text') {
        return { status: 500, body: { error: { message: 'primary down' } } };
      }
      return { status: 200, body: { choices: [{ message: { content: 'fallback-synced-ok' } }] } };
    }
  }, async () => {
    const { QuizProviders: QpCache, ModelRegistry: MrCache } = loadModules();
    assert.equal(QpCache.getModelForContext('openai_compatible', false, {}), 'auto');

    // Cache hit via getCachedModels (with uppercase key) warms _syncedModelsCache
    const cachedList = await MrCache.getCachedModels('OPENAI_COMPATIBLE');
    assert.equal(cachedList?.length, 2);
    assert.equal(QpCache.getModelForContext('openai_compatible', false, {}), 'vllm-primary-text');
    assert.equal(QpCache.getModelForContext('openai_compatible', true, {}), 'vllm-secondary-vision');

    // Fresh module instance: cache hit via syncProviderModels (without force) also warms _syncedModelsCache
    const { QuizProviders: QpHit, ModelRegistry: MrHit } = loadModules();
    await MrHit.syncProviderModels('openai_compatible', 'tok-gw', { baseUrl: 'https://gateway.example.com/v1' });
    assert.equal(QpHit.getModelForContext('openai_compatible', false, {}), 'vllm-primary-text');

    // preWarmProviders static 'auto' fallback must never clobber previously warmed models
    QpHit.warmContextCache('anthropic_compatible', [
      { id: 'proxy-claude-model', contextWindow: 200000, vision: true }
    ]);
    await QpHit.preWarmProviders({
      force: true,
      config: {
        anthropicCompatibleApiKey: 'tok-ac',
        providerConfigs: { anthropic_compatible: { baseUrl: 'https://proxy.example.com/v1' } }
      }
    });
    assert.equal(QpHit.getModelForContext('anthropic_compatible', false, {}), 'proxy-claude-model');

    // smartRoute uses synced primary model and falls back to second synced model on failure
    const routed = await QpHit.smartRoute(
      'Solve Q1',
      [],
      {
        openaiCompatibleApiKey: 'tok-gw',
        providerConfigs: { openai_compatible: { baseUrl: 'https://gateway.example.com/v1' } }
      },
      ['openai_compatible'],
      {},
      { retry: false }
    );
    assert.equal(routed.provider, 'openai_compatible');
    assert.equal(routed.model, 'vllm-secondary-vision');
    assert.equal(routed.text, 'fallback-synced-ok');
  });
});
