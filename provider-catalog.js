// ============================================================
// provider-catalog.js — Declarative LLM Provider Catalog (fcc-server parity)
// ============================================================
/* global URL, module, self */

const ProviderCatalog = (() => {
  'use strict';

  const CORE_STATIC_ALLOWED_HOSTS = Object.freeze([
    'api.groq.com',
    'generativelanguage.googleapis.com',
    'integrate.api.nvidia.com',
    'api.mistral.ai',
    'codestral.mistral.ai',
    'api.anthropic.com'
  ]);

  function modelEntry(id, label, contextLimit = 128000, free = false) {
    return { id, label, free, contextLimit };
  }

  const EXTRA_PROVIDERS = {
    open_router: {
      name: 'OpenRouter',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Passerelle',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKeyField: 'openRouterApiKey',
      keyPlaceholder: 'sk-or-v1-...',
      credentialUrl: 'https://openrouter.ai/keys',
      defaultTextModel: 'openrouter/auto',
      defaultVisionModel: 'openrouter/auto',
      textModels: [
        modelEntry('openrouter/auto', 'OpenRouter Auto', 128000),
        modelEntry('anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5 (OpenRouter)', 200000),
        modelEntry('openai/gpt-4.1-mini', 'GPT-4.1 Mini (OpenRouter)', 1047576),
        modelEntry('google/gemini-2.5-flash', 'Gemini 2.5 Flash (OpenRouter)', 1048576)
      ],
      visionModels: [
        modelEntry('openrouter/auto', 'OpenRouter Auto (Vision)', 128000),
        modelEntry('anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5 Vision', 200000),
        modelEntry('openai/gpt-4.1-mini', 'GPT-4.1 Mini Vision', 1047576)
      ]
    },

    opencode_zen: {
      name: 'OpenCode Zen',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Passerelle',
      baseUrl: 'https://opencode.ai/zen/v1',
      apiKeyField: 'opencodeZenApiKey',
      keyPlaceholder: 'sk-...',
      credentialUrl: 'https://opencode.ai/auth',
      defaultTextModel: 'big-pickle',
      defaultVisionModel: 'big-pickle',
      textModels: [
        modelEntry('big-pickle', 'Big Pickle', 128000),
        modelEntry('gpt-5-nano', 'GPT-5 Nano', 128000),
        modelEntry('glm-4.7-free', 'GLM 4.7 Free', 128000, true)
      ],
      visionModels: [
        modelEntry('big-pickle', 'Big Pickle (Vision)', 128000),
        modelEntry('gpt-5-nano', 'GPT-5 Nano (Vision)', 128000)
      ]
    },

    opencode_go: {
      name: 'OpenCode Go',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Passerelle',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKeyField: 'opencodeGoApiKey',
      keyPlaceholder: 'sk-...',
      credentialUrl: 'https://opencode.ai/auth',
      defaultTextModel: 'glm-5',
      defaultVisionModel: 'glm-5',
      textModels: [
        modelEntry('glm-5', 'GLM-5', 128000),
        modelEntry('kimi-k2.5', 'Kimi K2.5', 262144),
        modelEntry('minimax-m2.5', 'MiniMax M2.5', 196608)
      ],
      visionModels: [
        modelEntry('glm-5', 'GLM-5 (Vision)', 128000),
        modelEntry('kimi-k2.5', 'Kimi K2.5 (Vision)', 262144)
      ]
    },

    wafer: {
      name: 'Wafer',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Passerelle',
      baseUrl: 'https://pass.wafer.ai/v1',
      apiKeyField: 'waferApiKey',
      keyPlaceholder: 'wf_...',
      credentialUrl: 'https://www.wafer.ai/pass',
      defaultTextModel: 'auto',
      defaultVisionModel: 'auto',
      textModels: [
        modelEntry('auto', 'Wafer Auto', 128000)
      ],
      visionModels: [
        modelEntry('auto', 'Wafer Auto (Vision)', 128000)
      ]
    },

    cerebras: {
      name: 'Cerebras',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://api.cerebras.ai/v1',
      apiKeyField: 'cerebrasApiKey',
      keyPlaceholder: 'csk-...',
      credentialUrl: 'https://cloud.cerebras.ai',
      maxTokensField: 'max_completion_tokens',
      defaultTextModel: 'qwen-3-235b-a22b-instruct-2507',
      defaultVisionModel: 'qwen-3-235b-a22b-instruct-2507',
      textModels: [
        modelEntry('qwen-3-235b-a22b-instruct-2507', 'Qwen 3 235B Instruct', 131072),
        modelEntry('llama-3.3-70b', 'Llama 3.3 70B', 128000),
        modelEntry('gpt-oss-120b', 'GPT-OSS 120B', 131072)
      ],
      visionModels: [
        modelEntry('qwen-3-235b-a22b-instruct-2507', 'Qwen 3 235B', 131072)
      ]
    },

    tokenrouter: {
      name: 'TokenRouter',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Passerelle',
      baseUrl: 'https://api.tokenrouter.com/v1',
      apiKeyField: 'tokenrouterApiKey',
      keyPlaceholder: 'tr_...',
      credentialUrl: 'https://www.tokenrouter.com/',
      supportsCustomBaseUrl: true,
      maxTokensField: 'max_completion_tokens',
      defaultTextModel: 'auto',
      defaultVisionModel: 'auto',
      textModels: [
        modelEntry('auto', 'TokenRouter Auto', 128000)
      ],
      visionModels: [
        modelEntry('auto', 'TokenRouter Auto (Vision)', 128000)
      ]
    },

    commandcode: {
      name: 'CommandCode',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Passerelle',
      baseUrl: 'https://api.commandcode.ai/provider/v1',
      apiKeyField: 'commandcodeApiKey',
      keyPlaceholder: 'cc_...',
      supportsCustomBaseUrl: true,
      maxTokensField: 'max_completion_tokens',
      defaultTextModel: 'auto',
      defaultVisionModel: 'auto',
      textModels: [
        modelEntry('auto', 'CommandCode Auto', 128000)
      ],
      visionModels: [
        modelEntry('auto', 'CommandCode Auto (Vision)', 128000)
      ]
    },

    openai_compatible: {
      name: 'OpenAI Compatible',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Générique',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyField: 'openaiCompatibleApiKey',
      keyPlaceholder: 'sk-...',
      supportsCustomBaseUrl: true,
      allowsLoopbackBaseUrl: true,
      defaultTextModel: 'gpt-4o-mini',
      defaultVisionModel: 'gpt-4o-mini',
      textModels: [
        modelEntry('gpt-4o-mini', 'GPT-4o Mini', 128000),
        modelEntry('gpt-4o', 'GPT-4o', 128000),
        modelEntry('gpt-4.1-mini', 'GPT-4.1 Mini', 1047576)
      ],
      visionModels: [
        modelEntry('gpt-4o-mini', 'GPT-4o Mini (Vision)', 128000),
        modelEntry('gpt-4o', 'GPT-4o (Vision)', 128000)
      ]
    },

    xai: {
      name: 'xAI (Grok)',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://api.x.ai/v1',
      apiKeyField: 'xaiApiKey',
      keyPlaceholder: 'xai-...',
      credentialUrl: 'https://console.x.ai/team/default/api-keys',
      modelListing: {
        path: '/language-models',
        collectionField: 'models',
        aliasesField: 'aliases'
      },
      defaultTextModel: 'grok-4',
      defaultVisionModel: 'grok-4',
      textModels: [
        modelEntry('grok-4', 'Grok 4', 256000),
        modelEntry('grok-3-mini', 'Grok 3 Mini', 131072)
      ],
      visionModels: [
        modelEntry('grok-4', 'Grok 4 (Vision)', 256000),
        modelEntry('grok-2-vision-1212', 'Grok 2 Vision', 32768)
      ]
    },

    qwencloud: {
      name: 'QwenCloud Token Plan',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
      apiKeyField: 'qwencloudApiKey',
      keyPlaceholder: 'sk-...',
      credentialUrl: 'https://home.qwencloud.com/api-keys',
      defaultTextModel: 'qwen3-max',
      defaultVisionModel: 'qwen3-vl-plus',
      textModels: [
        modelEntry('qwen3-max', 'Qwen 3 Max', 131072),
        modelEntry('qwen3-coder-plus', 'Qwen 3 Coder Plus', 131072)
      ],
      visionModels: [
        modelEntry('qwen3-vl-plus', 'Qwen 3 VL Plus', 131072)
      ]
    },

    together: {
      name: 'Together AI',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://api.together.ai/v1',
      apiKeyField: 'togetherApiKey',
      keyPlaceholder: 'tgp_v1_...',
      credentialUrl: 'https://api.together.ai/settings/api-keys',
      modelListing: {
        path: '/models',
        collectionField: null,
        fieldEquals: ['type', 'chat']
      },
      defaultTextModel: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
      defaultVisionModel: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
      textModels: [
        modelEntry('meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', 'Llama 4 Maverick', 524288),
        modelEntry('deepseek-ai/DeepSeek-V3', 'DeepSeek V3', 131072)
      ],
      visionModels: [
        modelEntry('meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', 'Llama 4 Maverick (Vision)', 524288)
      ]
    },

    azure_openai: {
      name: 'Azure OpenAI',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: '',
      apiKeyField: 'azureOpenaiApiKey',
      keyPlaceholder: 'Clé Azure OpenAI...',
      credentialUrl: 'https://ai.azure.com/',
      supportsCustomBaseUrl: true,
      requiresBaseUrl: true,
      maxTokensField: 'max_completion_tokens',
      defaultTextModel: 'gpt-4o',
      defaultVisionModel: 'gpt-4o',
      textModels: [
        modelEntry('gpt-4o', 'Azure GPT-4o', 128000),
        modelEntry('gpt-4o-mini', 'Azure GPT-4o Mini', 128000)
      ],
      visionModels: [
        modelEntry('gpt-4o', 'Azure GPT-4o (Vision)', 128000),
        modelEntry('gpt-4o-mini', 'Azure GPT-4o Mini (Vision)', 128000)
      ]
    },

    deepseek: {
      name: 'DeepSeek',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://api.deepseek.com',
      apiKeyField: 'deepseekApiKey',
      keyPlaceholder: 'sk-...',
      credentialUrl: 'https://platform.deepseek.com/api_keys',
      defaultTextModel: 'deepseek-chat',
      defaultVisionModel: 'deepseek-chat',
      textModels: [
        modelEntry('deepseek-chat', 'DeepSeek Chat (V3)', 131072),
        modelEntry('deepseek-reasoner', 'DeepSeek Reasoner (R1)', 131072)
      ],
      visionModels: [
        modelEntry('deepseek-chat', 'DeepSeek Chat', 131072)
      ]
    },

    vercel: {
      name: 'Vercel AI Gateway',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Passerelle',
      baseUrl: 'https://ai-gateway.vercel.sh/v1',
      apiKeyField: 'vercelApiKey',
      keyPlaceholder: 'vck_...',
      credentialUrl: 'https://vercel.com/docs/ai-gateway',
      defaultTextModel: 'openai/gpt-4o-mini',
      defaultVisionModel: 'openai/gpt-4o-mini',
      textModels: [
        modelEntry('openai/gpt-4o-mini', 'GPT-4o Mini (Vercel)', 128000),
        modelEntry('anthropic/claude-sonnet-4', 'Claude Sonnet 4 (Vercel)', 200000)
      ],
      visionModels: [
        modelEntry('openai/gpt-4o-mini', 'GPT-4o Mini (Vercel Vision)', 128000)
      ]
    },

    bedrock: {
      name: 'Amazon Bedrock',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/v1',
      apiKeyField: 'bedrockApiKey',
      keyPlaceholder: 'ABSK...',
      credentialUrl: 'https://console.aws.amazon.com/bedrock/',
      supportsCustomBaseUrl: true,
      normalizeV1: true,
      defaultTextModel: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      defaultVisionModel: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      textModels: [
        modelEntry('anthropic.claude-sonnet-4-5-20250929-v1:0', 'Claude Sonnet 4.5 (Bedrock)', 200000),
        modelEntry('amazon.nova-pro-v1:0', 'Amazon Nova Pro', 300000)
      ],
      visionModels: [
        modelEntry('anthropic.claude-sonnet-4-5-20250929-v1:0', 'Claude Sonnet 4.5 Vision', 200000),
        modelEntry('amazon.nova-pro-v1:0', 'Amazon Nova Pro Vision', 300000)
      ]
    },

    huggingface: {
      name: 'Hugging Face',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://router.huggingface.co/v1',
      apiKeyField: 'huggingfaceApiKey',
      keyPlaceholder: 'hf_...',
      credentialUrl: 'https://huggingface.co/settings/tokens',
      defaultTextModel: 'Qwen/Qwen3-235B-A22B',
      defaultVisionModel: 'Qwen/Qwen2.5-VL-72B-Instruct',
      textModels: [
        modelEntry('Qwen/Qwen3-235B-A22B', 'Qwen 3 235B', 131072),
        modelEntry('meta-llama/Llama-3.3-70B-Instruct', 'Llama 3.3 70B', 131072)
      ],
      visionModels: [
        modelEntry('Qwen/Qwen2.5-VL-72B-Instruct', 'Qwen 2.5 VL 72B', 131072)
      ]
    },

    cohere: {
      name: 'Cohere',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://api.cohere.ai/compatibility/v1',
      apiKeyField: 'cohereApiKey',
      keyPlaceholder: 'Clé Cohere...',
      credentialUrl: 'https://dashboard.cohere.com/api-keys',
      defaultTextModel: 'command-a-03-2025',
      defaultVisionModel: 'command-a-vision-07-2025',
      textModels: [
        modelEntry('command-a-03-2025', 'Command A', 256000),
        modelEntry('command-r-plus-08-2024', 'Command R+', 128000)
      ],
      visionModels: [
        modelEntry('command-a-vision-07-2025', 'Command A Vision', 128000)
      ]
    },

    github_models: {
      name: 'GitHub Models',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://models.github.ai/inference',
      apiKeyField: 'githubModelsToken',
      keyPlaceholder: 'github_pat_...',
      credentialUrl: 'https://github.com/settings/tokens',
      defaultHeaders: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10'
      },
      modelListing: {
        absoluteUrl: 'https://models.github.ai/catalog/models',
        collectionField: null,
        githubCatalog: true
      },
      defaultTextModel: 'openai/gpt-4.1-mini',
      defaultVisionModel: 'openai/gpt-4.1-mini',
      textModels: [
        modelEntry('openai/gpt-4.1-mini', 'GPT-4.1 Mini (GitHub)', 1047576),
        modelEntry('openai/gpt-4o', 'GPT-4o (GitHub)', 128000)
      ],
      visionModels: [
        modelEntry('openai/gpt-4.1-mini', 'GPT-4.1 Mini Vision', 1047576),
        modelEntry('openai/gpt-4o', 'GPT-4o Vision', 128000)
      ]
    },

    kimi: {
      name: 'Kimi',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://api.moonshot.ai/v1',
      apiKeyField: 'kimiApiKey',
      keyPlaceholder: 'sk-...',
      credentialUrl: 'https://platform.moonshot.cn/console/api-keys',
      defaultTextModel: 'kimi-k2.5',
      defaultVisionModel: 'kimi-k2.5',
      textModels: [
        modelEntry('kimi-k2.5', 'Kimi K2.5', 262144),
        modelEntry('kimi-k2-0905-preview', 'Kimi K2 Preview', 262144)
      ],
      visionModels: [
        modelEntry('kimi-k2.5', 'Kimi K2.5 (Vision)', 262144)
      ]
    },

    kimi_code: {
      name: 'Kimi Code',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://api.kimi.com/coding/v1',
      apiKeyField: 'kimiCodeApiKey',
      keyPlaceholder: 'sk-kimi-...',
      credentialUrl: 'https://www.kimi.com/code/console',
      maxTokensField: 'max_completion_tokens',
      defaultTextModel: 'kimi-for-coding',
      defaultVisionModel: 'kimi-for-coding',
      textModels: [
        modelEntry('kimi-for-coding', 'Kimi For Coding', 262144)
      ],
      visionModels: [
        modelEntry('kimi-for-coding', 'Kimi For Coding (Vision)', 262144)
      ]
    },

    kilo: {
      name: 'Kilo.ai',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Passerelle',
      baseUrl: 'https://api.kilo.ai/api/gateway',
      apiKeyField: 'kiloApiKey',
      keyPlaceholder: 'sk-kilo-...',
      credentialUrl: 'https://app.kilo.ai',
      defaultTextModel: 'kilo/auto',
      defaultVisionModel: 'kilo/auto',
      textModels: [
        modelEntry('kilo/auto', 'Kilo Auto', 128000)
      ],
      visionModels: [
        modelEntry('kilo/auto', 'Kilo Auto (Vision)', 128000)
      ]
    },

    minimax: {
      name: 'MiniMax',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://api.minimax.io/v1',
      apiKeyField: 'minimaxApiKey',
      keyPlaceholder: 'eyJ...',
      credentialUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
      maxTokensField: 'max_completion_tokens',
      defaultTextModel: 'MiniMax-M2.5',
      defaultVisionModel: 'MiniMax-M2.5',
      textModels: [
        modelEntry('MiniMax-M2.5', 'MiniMax M2.5', 196608),
        modelEntry('MiniMax-M2.5-highspeed', 'MiniMax M2.5 Highspeed', 196608)
      ],
      visionModels: [
        modelEntry('MiniMax-M2.5', 'MiniMax M2.5 (Vision)', 196608)
      ]
    },

    sambanova: {
      name: 'SambaNova',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://api.sambanova.ai/v1',
      apiKeyField: 'sambanovaApiKey',
      keyPlaceholder: 'Clé SambaNova...',
      credentialUrl: 'https://cloud.sambanova.ai/apis',
      defaultTextModel: 'Meta-Llama-3.3-70B-Instruct',
      defaultVisionModel: 'Llama-4-Maverick-17B-128E-Instruct',
      textModels: [
        modelEntry('Meta-Llama-3.3-70B-Instruct', 'Llama 3.3 70B', 131072),
        modelEntry('DeepSeek-V3-0324', 'DeepSeek V3', 131072)
      ],
      visionModels: [
        modelEntry('Llama-4-Maverick-17B-128E-Instruct', 'Llama 4 Maverick Vision', 131072)
      ]
    },

    fireworks: {
      name: 'Fireworks',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://api.fireworks.ai/inference/v1',
      apiKeyField: 'fireworksApiKey',
      keyPlaceholder: 'fw_...',
      credentialUrl: 'https://fireworks.ai/account/api-keys',
      defaultTextModel: 'accounts/fireworks/models/deepseek-v3p1',
      defaultVisionModel: 'accounts/fireworks/models/qwen2p5-vl-32b-instruct',
      textModels: [
        modelEntry('accounts/fireworks/models/deepseek-v3p1', 'DeepSeek V3.1', 163840),
        modelEntry('accounts/fireworks/models/qwen3-235b-a22b', 'Qwen 3 235B', 131072)
      ],
      visionModels: [
        modelEntry('accounts/fireworks/models/qwen2p5-vl-32b-instruct', 'Qwen 2.5 VL 32B', 128000)
      ]
    },

    novita: {
      name: 'Novita AI',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://api.novita.ai/openai/v1',
      apiKeyField: 'novitaApiKey',
      keyPlaceholder: 'sk_...',
      credentialUrl: 'https://novita.ai/settings/key-management',
      defaultTextModel: 'deepseek/deepseek-v3-0324',
      defaultVisionModel: 'qwen/qwen2.5-vl-72b-instruct',
      textModels: [
        modelEntry('deepseek/deepseek-v3-0324', 'DeepSeek V3', 131072),
        modelEntry('meta-llama/llama-3.3-70b-instruct', 'Llama 3.3 70B', 131072)
      ],
      visionModels: [
        modelEntry('qwen/qwen2.5-vl-72b-instruct', 'Qwen 2.5 VL 72B', 32768)
      ]
    },

    cloudflare: {
      name: 'Cloudflare Workers AI',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://api.cloudflare.com/client/v4',
      apiKeyField: 'cloudflareApiToken',
      keyPlaceholder: 'Jeton API Cloudflare...',
      credentialUrl: 'https://dash.cloudflare.com/profile/api-tokens',
      requiresAccountId: true,
      maxTokensField: 'max_completion_tokens',
      modelListing: {
        cloudflareSearch: true
      },
      defaultTextModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      defaultVisionModel: '@cf/meta/llama-3.2-11b-vision-instruct',
      textModels: [
        modelEntry('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'Llama 3.3 70B Fast', 131072),
        modelEntry('@cf/qwen/qwen2.5-coder-32b-instruct', 'Qwen 2.5 Coder 32B', 32768)
      ],
      visionModels: [
        modelEntry('@cf/meta/llama-3.2-11b-vision-instruct', 'Llama 3.2 11B Vision', 128000)
      ]
    },

    zai: {
      name: 'Z.ai',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      apiKeyField: 'zaiApiKey',
      keyPlaceholder: 'Clé Z.ai...',
      defaultTextModel: 'glm-4.7',
      defaultVisionModel: 'glm-4.6v',
      textModels: [
        modelEntry('glm-4.7', 'GLM-4.7', 128000),
        modelEntry('glm-4.5', 'GLM-4.5', 128000)
      ],
      visionModels: [
        modelEntry('glm-4.6v', 'GLM-4.6V (Vision)', 128000)
      ]
    },

    alibaba: {
      name: 'Alibaba DashScope',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      apiKeyField: 'alibabaApiKey',
      keyPlaceholder: 'sk-...',
      supportsCustomBaseUrl: true,
      maxTokensField: 'max_completion_tokens',
      defaultTextModel: 'qwen-plus',
      defaultVisionModel: 'qwen-vl-plus',
      textModels: [
        modelEntry('qwen-plus', 'Qwen Plus', 131072),
        modelEntry('qwen-max', 'Qwen Max', 131072)
      ],
      visionModels: [
        modelEntry('qwen-vl-plus', 'Qwen VL Plus', 131072)
      ]
    },

    nararoute: {
      name: 'NaraRoute',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Passerelle',
      baseUrl: 'https://router.bynara.id/v1',
      apiKeyField: 'nararouteApiKey',
      keyPlaceholder: 'nr-...',
      credentialUrl: 'https://router.bynara.id/keys',
      supportsCustomBaseUrl: true,
      defaultTextModel: 'auto',
      defaultVisionModel: 'auto',
      textModels: [
        modelEntry('auto', 'NaraRoute Auto', 128000)
      ],
      visionModels: [
        modelEntry('auto', 'NaraRoute Auto (Vision)', 128000)
      ]
    },

    ollama_cloud: {
      name: 'Ollama Cloud',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Cloud',
      baseUrl: 'https://ollama.com/v1',
      apiKeyField: 'ollamaCloudApiKey',
      keyPlaceholder: 'Clé Ollama Cloud...',
      credentialUrl: 'https://ollama.com/settings/keys',
      defaultTextModel: 'gpt-oss:120b',
      defaultVisionModel: 'qwen3-vl:235b',
      textModels: [
        modelEntry('gpt-oss:120b', 'GPT-OSS 120B', 131072),
        modelEntry('deepseek-v3.1:671b', 'DeepSeek V3.1 671B', 131072)
      ],
      visionModels: [
        modelEntry('qwen3-vl:235b', 'Qwen 3 VL 235B', 131072)
      ]
    },

    anthropic_compatible: {
      name: 'Anthropic Compatible',
      type: 'claude',
      category: 'cloud',
      local: false,
      tierLabel: 'Générique',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKeyField: 'anthropicCompatibleApiKey',
      keyPlaceholder: 'sk-ant-...',
      supportsCustomBaseUrl: true,
      allowsLoopbackBaseUrl: true,
      messagesPath: '/messages',
      defaultTextModel: 'claude-sonnet-5-5',
      defaultVisionModel: 'claude-sonnet-5-5',
      textModels: [
        modelEntry('claude-sonnet-5-5', 'Claude Sonnet 5.5', 200000),
        modelEntry('claude-opus-5-5', 'Claude Opus 5.5', 200000)
      ],
      visionModels: [
        modelEntry('claude-sonnet-5-5', 'Claude Sonnet 5.5 (Vision)', 200000),
        modelEntry('claude-opus-5-5', 'Claude Opus 5.5 (Vision)', 200000)
      ]
    },

    agentrouter: {
      name: 'AgentRouter',
      type: 'claude',
      category: 'cloud',
      local: false,
      tierLabel: 'Passerelle',
      baseUrl: 'https://ps.air-outer.com/v1',
      apiKeyField: 'agentrouterApiKey',
      keyPlaceholder: 'sk-...',
      supportsCustomBaseUrl: true,
      messagesPath: '/messages?beta=true',
      sendBearerAuth: true,
      defaultTextModel: 'claude-fable-5',
      defaultVisionModel: 'claude-fable-5',
      textModels: [
        modelEntry('claude-fable-5', 'Claude Fable 5', 200000),
        modelEntry('claude-opus-5', 'Claude Opus 5', 200000),
        modelEntry('claude-opus-4-8', 'Claude Opus 4.8', 200000),
        modelEntry('claude-opus-4-6', 'Claude Opus 4.6', 200000),
        modelEntry('glm-5.2', 'GLM-5.2', 200000),
        modelEntry('gpt-5.5', 'GPT-5.5', 200000),
        modelEntry('gpt-5.6-sol', 'GPT-5.6 Sol', 200000),
        modelEntry('kimi-k3', 'Kimi K3', 200000)
      ],
      visionModels: [
        modelEntry('claude-fable-5', 'Claude Fable 5 (Vision)', 200000),
        modelEntry('claude-opus-5', 'Claude Opus 5 (Vision)', 200000)
      ]
    },

    lmstudio: {
      name: 'LM Studio',
      type: 'openai-compatible',
      category: 'local',
      local: true,
      tierLabel: 'Local',
      baseUrl: 'http://localhost:1234/v1',
      apiKeyField: 'lmstudioApiKey',
      staticApiKey: 'lm-studio',
      keyPlaceholder: 'Optionnelle (défaut : lm-studio)',
      supportsCustomBaseUrl: true,
      allowsLoopbackBaseUrl: true,
      normalizeV1: true,
      defaultTextModel: 'local-model',
      defaultVisionModel: 'local-model',
      textModels: [
        modelEntry('local-model', 'Modèle chargé (LM Studio)', 128000, true)
      ],
      visionModels: [
        modelEntry('local-model', 'Modèle vision (LM Studio)', 128000, true)
      ]
    },

    llamacpp: {
      name: 'llama.cpp',
      type: 'openai-compatible',
      category: 'local',
      local: true,
      tierLabel: 'Local',
      baseUrl: 'http://localhost:8080/v1',
      apiKeyField: 'llamacppApiKey',
      staticApiKey: 'llamacpp',
      keyPlaceholder: 'Optionnelle (défaut : llamacpp)',
      supportsCustomBaseUrl: true,
      allowsLoopbackBaseUrl: true,
      normalizeV1: true,
      defaultTextModel: 'local-model',
      defaultVisionModel: 'local-model',
      textModels: [
        modelEntry('local-model', 'Modèle chargé (llama.cpp)', 128000, true)
      ],
      visionModels: [
        modelEntry('local-model', 'Modèle vision (llama.cpp)', 128000, true)
      ]
    },

    ollama: {
      name: 'Ollama',
      type: 'openai-compatible',
      category: 'local',
      local: true,
      tierLabel: 'Local',
      baseUrl: 'http://localhost:11434',
      apiKeyField: 'ollamaApiKey',
      staticApiKey: 'ollama',
      keyPlaceholder: 'Optionnelle (défaut : ollama)',
      supportsCustomBaseUrl: true,
      allowsLoopbackBaseUrl: true,
      normalizeV1: true,
      defaultTextModel: 'llama3.2',
      defaultVisionModel: 'llama3.2-vision',
      textModels: [
        modelEntry('llama3.2', 'Llama 3.2', 128000, true),
        modelEntry('qwen3:8b', 'Qwen 3 8B', 128000, true)
      ],
      visionModels: [
        modelEntry('llama3.2-vision', 'Llama 3.2 Vision', 128000, true)
      ]
    }
  };

  function normalizeOpenAIV1BaseUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return '';
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    const qIdx = trimmed.indexOf('?');
    const basePart = (qIdx >= 0 ? trimmed.slice(0, qIdx) : trimmed).replace(/\/+$/, '');
    const queryPart = qIdx >= 0 ? trimmed.slice(qIdx) : '';
    if (!basePart) return '';
    const normalizedPath = basePart.endsWith('/v1') ? basePart : `${basePart}/v1`;
    return `${normalizedPath}${queryPart}`;
  }

  function buildEndpointUrl(baseUrl, suffix) {
    const rawBase = typeof baseUrl === 'string' ? baseUrl.trim() : '';
    const rawSuffix = typeof suffix === 'string' ? suffix.trim() : '';
    if (!rawBase) return '';
    if (!rawSuffix) return rawBase.replace(/\/+$/, '');

    const bQIdx = rawBase.indexOf('?');
    const basePath = (bQIdx >= 0 ? rawBase.slice(0, bQIdx) : rawBase).replace(/\/+$/, '');
    const baseQuery = bQIdx >= 0 ? rawBase.slice(bQIdx + 1) : '';

    const sQIdx = rawSuffix.indexOf('?');
    const suffixPathRaw = sQIdx >= 0 ? rawSuffix.slice(0, sQIdx) : rawSuffix;
    const suffixPath = suffixPathRaw ? (suffixPathRaw.startsWith('/') ? suffixPathRaw : `/${suffixPathRaw}`) : '';
    const suffixQuery = sQIdx >= 0 ? rawSuffix.slice(sQIdx + 1) : '';

    const combinedQuery = [baseQuery, suffixQuery].filter(Boolean).join('&');
    return `${basePath}${suffixPath}${combinedQuery ? `?${combinedQuery}` : ''}`;
  }

  function resolveCloudflareAccountRoot(provider, providerConfig) {
    const cfg = providerConfig && typeof providerConfig === 'object' ? providerConfig : {};
    const accountId = typeof cfg.accountId === 'string' ? cfg.accountId.trim() : '';
    if (!accountId) {
      throw new Error('Account ID Cloudflare requis.');
    }
    const customBase = typeof cfg.baseUrl === 'string' ? cfg.baseUrl.trim() : '';
    const rootRaw = (customBase && (provider?.supportsCustomBaseUrl || provider?.local))
      ? customBase
      : (provider?.baseUrl || 'https://api.cloudflare.com/client/v4');
    const root = rootRaw.replace(/\/+$/, '');
    return `${root}/accounts/${encodeURIComponent(accountId)}`;
  }

  function resolveProviderBaseUrl(providerKey, provider, providerConfig, modelId) {
    if (!provider || typeof provider !== 'object') {
      throw new Error(`Provider inconnu: ${String(providerKey || '')}`);
    }
    const normalizedKey = String(providerKey || '').toLowerCase();
    if (normalizedKey === 'mistral' && typeof modelId === 'string' && modelId.toLowerCase().includes('codestral')) {
      return 'https://codestral.mistral.ai/v1';
    }

    const cfg = providerConfig && typeof providerConfig === 'object' ? providerConfig : {};
    if (provider.requiresAccountId) {
      return `${resolveCloudflareAccountRoot(provider, cfg)}/ai/v1`;
    }

    const customBase = typeof cfg.baseUrl === 'string' ? cfg.baseUrl.trim() : '';
    const canOverrideBase = Boolean(provider.supportsCustomBaseUrl || provider.requiresBaseUrl || provider.local);
    let rawBase = (canOverrideBase && customBase)
      ? customBase
      : (typeof provider.baseUrl === 'string' ? provider.baseUrl.trim() : '');

    if (provider.requiresBaseUrl && !rawBase) {
      throw new Error(`URL de base requise pour ${provider.name || providerKey}.`);
    }
    if (!rawBase) {
      return '';
    }

    if (provider.normalizeV1 === true) {
      rawBase = normalizeOpenAIV1BaseUrl(rawBase);
    } else {
      const qIdx = rawBase.indexOf('?');
      if (qIdx >= 0) {
        rawBase = `${rawBase.slice(0, qIdx).replace(/\/+$/, '')}${rawBase.slice(qIdx)}`;
      } else {
        rawBase = rawBase.replace(/\/+$/, '');
      }
    }
    return rawBase;
  }

  function resolveCloudflareModelSearchUrl(provider, providerConfig) {
    return `${resolveCloudflareAccountRoot(provider, providerConfig)}/ai/models/search?format=openrouter`;
  }

  function isProviderConfigured(providerKey, provider, config) {
    if (!provider || typeof provider !== 'object' || !config || typeof config !== 'object') {
      return false;
    }
    const normalizedKey = String(providerKey || '').trim().toLowerCase();
    if (!normalizedKey || normalizedKey === '__proto__' || normalizedKey === 'constructor' || normalizedKey === 'prototype') {
      return false;
    }
    const allProviderConfigs = (config.providerConfigs && typeof config.providerConfigs === 'object')
      ? config.providerConfigs
      : null;
    const pCfg = (allProviderConfigs &&
      Object.prototype.hasOwnProperty.call(allProviderConfigs, normalizedKey) &&
      allProviderConfigs[normalizedKey] &&
      typeof allProviderConfigs[normalizedKey] === 'object')
      ? allProviderConfigs[normalizedKey]
      : null;

    if (provider.local === true) {
      return Boolean(pCfg && pCfg.enabled === true);
    }

    const field = provider.apiKeyField;
    const hasKey = Boolean(
      field &&
      Object.prototype.hasOwnProperty.call(config, field) &&
      typeof config[field] === 'string' &&
      config[field].trim().length > 0
    );
    if (!hasKey) {
      return false;
    }
    if (provider.requiresAccountId) {
      if (!pCfg || typeof pCfg.accountId !== 'string' || pCfg.accountId.trim().length === 0) {
        return false;
      }
    }
    if (provider.requiresBaseUrl) {
      if (!pCfg || typeof pCfg.baseUrl !== 'string' || pCfg.baseUrl.trim().length === 0) {
        return false;
      }
    }
    return true;
  }

  function resolveProviderRuntimeConfig(providerKey, provider, config) {
    const normalizedKey = String(providerKey || '').trim().toLowerCase();
    const allProviderConfigs = (config && config.providerConfigs && typeof config.providerConfigs === 'object')
      ? config.providerConfigs
      : null;
    const providerConfig = (allProviderConfigs &&
      Object.prototype.hasOwnProperty.call(allProviderConfigs, normalizedKey) &&
      allProviderConfigs[normalizedKey] &&
      typeof allProviderConfigs[normalizedKey] === 'object')
      ? { ...allProviderConfigs[normalizedKey] }
      : {};

    const field = provider && provider.apiKeyField;
    const rawKey = (config && field && Object.prototype.hasOwnProperty.call(config, field) && typeof config[field] === 'string')
      ? config[field].trim()
      : '';
    const apiKey = rawKey || (provider && provider.local ? (provider.staticApiKey || 'local') : '');

    let baseUrl = '';
    if (provider) {
      try {
        baseUrl = resolveProviderBaseUrl(normalizedKey, provider, providerConfig);
      } catch (_) {
        baseUrl = '';
      }
    }

    return { apiKey, providerConfig, baseUrl };
  }

  function buildStaticAllowedHosts() {
    const hosts = new Set(CORE_STATIC_ALLOWED_HOSTS);
    for (const provider of Object.values(EXTRA_PROVIDERS)) {
      if (!provider || provider.local) continue;
      const candidateUrls = [];
      if (typeof provider.baseUrl === 'string' && provider.baseUrl.trim()) {
        candidateUrls.push(provider.baseUrl.trim());
      }
      if (provider.modelListing && typeof provider.modelListing.absoluteUrl === 'string' && provider.modelListing.absoluteUrl.trim()) {
        candidateUrls.push(provider.modelListing.absoluteUrl.trim());
      }
      for (const rawUrl of candidateUrls) {
        try {
          const parsed = new URL(rawUrl);
          if (parsed.protocol === 'https:' && parsed.hostname) {
            hosts.add(parsed.hostname.toLowerCase());
          }
        } catch (_) { /* skip invalid url */ }
      }
    }
    return Object.freeze([...hosts]);
  }

  const LLM_STATIC_ALLOWED_HOSTS = buildStaticAllowedHosts();

  return {
    CORE_STATIC_ALLOWED_HOSTS,
    EXTRA_PROVIDERS,
    LLM_STATIC_ALLOWED_HOSTS,
    normalizeOpenAIV1BaseUrl,
    buildEndpointUrl,
    resolveProviderBaseUrl,
    resolveCloudflareModelSearchUrl,
    isProviderConfigured,
    resolveProviderRuntimeConfig
  };
})();

if (typeof window !== 'undefined') {
  window.ProviderCatalog = ProviderCatalog;
}
if (typeof self !== 'undefined') {
  self.ProviderCatalog = ProviderCatalog;
}
if (typeof globalThis !== 'undefined') {
  globalThis.ProviderCatalog = ProviderCatalog;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProviderCatalog;
}
