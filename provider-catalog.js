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
        modelEntry('moonshotai/kimi-k2.6:free', 'Kimi K2.6 (Free)', 262144, true),
        modelEntry('nvidia/nemotron-3-super-120b-a12b:free', 'Nemotron 3 Super 120B (Free)', 1048576, true),
        modelEntry('openai/gpt-oss-120b:free', 'GPT-OSS 120B (Free)', 131072, true),
        modelEntry('poolside/laguna-m.1:free', 'Laguna M.1 (Free)', 131072, true),
        modelEntry('anthropic/claude-sonnet-5-5', 'Claude Sonnet 5.5 (OpenRouter)', 1000000),
        modelEntry('google/gemini-4-hydrogen', 'Gemini 4 Hydrogen (OpenRouter)', 1048576)
      ],
      visionModels: [
        modelEntry('openrouter/auto', 'OpenRouter Auto (Vision)', 128000),
        modelEntry('anthropic/claude-sonnet-5-5', 'Claude Sonnet 5.5 Vision', 1000000),
        modelEntry('google/gemini-4-hydrogen', 'Gemini 4 Hydrogen Vision', 1048576)
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
      defaultTextModel: 'gpt-5.3-codex',
      defaultVisionModel: 'gpt-5.3-codex',
      textModels: [
        modelEntry('gpt-5.3-codex', 'GPT-5.3 Codex', 256000),
        modelEntry('muse-spark-1.3-free', 'Muse Spark 1.3 (Free)', 131072, true),
        modelEntry('mimo-v2.5-free', 'MiMo v2.5 (Free)', 131072, true),
        modelEntry('laguna-s-2.1-free', 'Laguna S 2.1 (Free)', 131072, true)
      ],
      visionModels: [
        modelEntry('gpt-5.3-codex', 'GPT-5.3 Codex (Vision)', 256000),
        modelEntry('muse-spark-1.3-free', 'Muse Spark 1.3 Vision (Free)', 131072, true)
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
      defaultTextModel: 'minimax-m2.7',
      defaultVisionModel: 'minimax-m2.7',
      textModels: [
        modelEntry('minimax-m2.7', 'MiniMax M2.7', 196608),
        modelEntry('glm-5.2', 'GLM-5.2', 200000),
        modelEntry('kimi-k3', 'Kimi K3', 262144)
      ],
      visionModels: [
        modelEntry('minimax-m2.7', 'MiniMax M2.7 (Vision)', 196608),
        modelEntry('glm-5.2', 'GLM-5.2 (Vision)', 200000),
        modelEntry('kimi-k3', 'Kimi K3 (Vision)', 262144)
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
      defaultTextModel: 'DeepSeek-V4-Pro',
      defaultVisionModel: 'DeepSeek-V4-Pro',
      textModels: [
        modelEntry('DeepSeek-V4-Pro', 'DeepSeek V4 Pro', 131072),
        modelEntry('auto', 'Wafer Auto', 128000)
      ],
      visionModels: [
        modelEntry('DeepSeek-V4-Pro', 'DeepSeek V4 Pro (Vision)', 131072),
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
      defaultTextModel: 'gpt-oss-120b',
      defaultVisionModel: 'qwen-3.8-27b',
      textModels: [
        modelEntry('gpt-oss-120b', 'GPT-OSS 120B', 131072),
        modelEntry('qwen-3.8-27b', 'Qwen 3.8 27B', 131072),
        modelEntry('qwen-3-235b-a22b-instruct-2507', 'Qwen 3 235B Instruct', 131072)
      ],
      visionModels: [
        modelEntry('qwen-3.8-27b', 'Qwen 3.8 27B (Vision)', 131072),
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
      defaultTextModel: 'moonshotai/kimi-k3-free',
      defaultVisionModel: 'glm-5.3-free',
      textModels: [
        modelEntry('moonshotai/kimi-k3-free', 'Kimi K3 (Free)', 262144, true),
        modelEntry('glm-5.3-free', 'GLM 5.3 (Free)', 128000, true),
        modelEntry('auto', 'TokenRouter Auto', 128000)
      ],
      visionModels: [
        modelEntry('glm-5.3-free', 'GLM 5.3 Vision (Free)', 128000, true),
        modelEntry('moonshotai/kimi-k3-free', 'Kimi K3 Vision (Free)', 262144, true)
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
      defaultTextModel: 'laguna-s-2.1-free',
      defaultVisionModel: 'laguna-s-2.1-free',
      textModels: [
        modelEntry('laguna-s-2.1-free', 'Laguna S 2.1 (Free)', 131072, true),
        modelEntry('auto', 'CommandCode Auto', 128000)
      ],
      visionModels: [
        modelEntry('laguna-s-2.1-free', 'Laguna S 2.1 Vision (Free)', 131072, true),
        modelEntry('auto', 'CommandCode Auto (Vision)', 128000)
      ]
    },

    openai_compatible: {
      name: 'OpenAI Compatible',
      type: 'openai-compatible',
      category: 'cloud',
      local: false,
      tierLabel: 'Générique',
      baseUrl: '',
      apiKeyField: 'openaiCompatibleApiKey',
      keyPlaceholder: 'Clé ou jeton API du serveur...',
      baseUrlPlaceholder: 'https://votre-serveur.example.com/v1 ou http://127.0.0.1:8080/v1',
      supportsCustomBaseUrl: true,
      requiresBaseUrl: true,
      allowsLoopbackBaseUrl: true,
      normalizeV1: true,
      genericProtocolConnector: true,
      defaultTextModel: 'auto',
      defaultVisionModel: 'auto',
      textModels: [
        modelEntry('auto', 'Modèle du serveur (/v1/models)', 131072)
      ],
      visionModels: [
        modelEntry('auto', 'Modèle vision du serveur (/v1/models)', 131072)
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
      defaultTextModel: 'grok-4.5',
      defaultVisionModel: 'grok-4.5',
      textModels: [
        modelEntry('grok-4.5', 'Grok 4.5', 256000),
        modelEntry('grok-4', 'Grok 4', 256000)
      ],
      visionModels: [
        modelEntry('grok-4.5', 'Grok 4.5 (Vision)', 256000),
        modelEntry('grok-4', 'Grok 4 (Vision)', 256000)
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
      defaultTextModel: 'qwen3.7-plus',
      defaultVisionModel: 'qwen3.8-vl',
      textModels: [
        modelEntry('qwen3.7-plus', 'Qwen 3.7 Plus', 131072),
        modelEntry('qwen3-max', 'Qwen 3 Max', 131072),
        modelEntry('qwen3-coder-plus', 'Qwen 3 Coder Plus', 131072)
      ],
      visionModels: [
        modelEntry('qwen3.8-vl', 'Qwen 3.8 VL', 131072),
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
      defaultTextModel: 'zai-org/GLM-5.2',
      defaultVisionModel: 'Qwen/Qwen3.8-27B',
      textModels: [
        modelEntry('zai-org/GLM-5.2', 'GLM-5.2', 200000),
        modelEntry('deepseek-ai/DeepSeek-V4-Pro', 'DeepSeek V4 Pro', 131072),
        modelEntry('Qwen/Qwen3.8-27B', 'Qwen 3.8 27B', 131072)
      ],
      visionModels: [
        modelEntry('Qwen/Qwen3.8-27B', 'Qwen 3.8 27B (Vision)', 131072),
        modelEntry('zai-org/GLM-5.2', 'GLM-5.2 (Vision)', 200000)
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
      defaultTextModel: 'gpt-5.5',
      defaultVisionModel: 'gpt-5.5',
      textModels: [
        modelEntry('gpt-5.5', 'Azure GPT-5.5', 256000),
        modelEntry('gpt-5.1', 'Azure GPT-5.1', 256000),
        modelEntry('gpt-5.3-codex', 'Azure GPT-5.3 Codex', 256000)
      ],
      visionModels: [
        modelEntry('gpt-5.5', 'Azure GPT-5.5 (Vision)', 256000),
        modelEntry('gpt-5.1', 'Azure GPT-5.1 (Vision)', 256000)
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
      defaultTextModel: 'deepseek-v4-pro',
      defaultVisionModel: 'deepseek-v4-pro',
      textModels: [
        modelEntry('deepseek-v4-pro', 'DeepSeek V4 Pro', 131072),
        modelEntry('deepseek-v4-flash', 'DeepSeek V4 Flash', 131072),
        modelEntry('deepseek-chat', 'DeepSeek Chat', 131072),
        modelEntry('deepseek-reasoner', 'DeepSeek Reasoner', 131072)
      ],
      visionModels: [
        modelEntry('deepseek-v4-pro', 'DeepSeek V4 Pro (Vision)', 131072),
        modelEntry('deepseek-v4-flash', 'DeepSeek V4 Flash (Vision)', 131072)
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
      defaultTextModel: 'openai/gpt-5.5',
      defaultVisionModel: 'openai/gpt-5.5',
      textModels: [
        modelEntry('openai/gpt-5.5', 'GPT-5.5 (Vercel)', 256000),
        modelEntry('anthropic/claude-sonnet-5-5', 'Claude Sonnet 5.5 (Vercel)', 1000000),
        modelEntry('google/gemini-4-hydrogen', 'Gemini 4 Hydrogen (Vercel)', 1048576)
      ],
      visionModels: [
        modelEntry('openai/gpt-5.5', 'GPT-5.5 (Vercel Vision)', 256000),
        modelEntry('anthropic/claude-sonnet-5-5', 'Claude Sonnet 5.5 (Vercel Vision)', 1000000),
        modelEntry('google/gemini-4-hydrogen', 'Gemini 4 Hydrogen (Vercel Vision)', 1048576)
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
      defaultTextModel: 'openai.gpt-oss-120b',
      defaultVisionModel: 'anthropic.claude-sonnet-5-5-v1:0',
      textModels: [
        modelEntry('openai.gpt-oss-120b', 'GPT-OSS 120B (Bedrock)', 131072),
        modelEntry('anthropic.claude-sonnet-5-5-v1:0', 'Claude Sonnet 5.5 (Bedrock)', 1000000),
        modelEntry('anthropic.claude-opus-5-5-v1:0', 'Claude Opus 5.5 (Bedrock)', 1000000)
      ],
      visionModels: [
        modelEntry('anthropic.claude-sonnet-5-5-v1:0', 'Claude Sonnet 5.5 Vision', 1000000),
        modelEntry('anthropic.claude-opus-5-5-v1:0', 'Claude Opus 5.5 Vision', 1000000)
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
      defaultTextModel: 'openai/gpt-oss-120b:fastest',
      defaultVisionModel: 'Qwen/Qwen3.8-27B',
      textModels: [
        modelEntry('openai/gpt-oss-120b:fastest', 'GPT-OSS 120B Fastest', 131072),
        modelEntry('Qwen/Qwen3.8-27B', 'Qwen 3.8 27B', 131072),
        modelEntry('google/gemma-4-31b-it', 'Gemma 4 31B', 262144)
      ],
      visionModels: [
        modelEntry('Qwen/Qwen3.8-27B', 'Qwen 3.8 27B (Vision)', 131072),
        modelEntry('google/gemma-4-31b-it', 'Gemma 4 31B (Vision)', 262144)
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
      defaultTextModel: 'command-a-plus-05-2026',
      defaultVisionModel: 'command-a-vision-07-2025',
      textModels: [
        modelEntry('command-a-plus-05-2026', 'Command A+ (2026)', 256000),
        modelEntry('command-a-03-2025', 'Command A', 256000)
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
      defaultTextModel: 'openai/gpt-5.5',
      defaultVisionModel: 'openai/gpt-5.5',
      textModels: [
        modelEntry('openai/gpt-5.5', 'GPT-5.5 (GitHub)', 256000),
        modelEntry('openai/gpt-5.1', 'GPT-5.1 (GitHub)', 256000),
        modelEntry('openai/gpt-oss-120b', 'GPT-OSS 120B (GitHub)', 131072)
      ],
      visionModels: [
        modelEntry('openai/gpt-5.5', 'GPT-5.5 Vision (GitHub)', 256000),
        modelEntry('openai/gpt-5.1', 'GPT-5.1 Vision (GitHub)', 256000)
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
      defaultTextModel: 'kimi-k3.1-pro',
      defaultVisionModel: 'kimi-k3.1-pro',
      textModels: [
        modelEntry('kimi-k3.1-pro', 'Kimi K3.1 Pro', 1048576),
        modelEntry('kimi-k3', 'Kimi K3', 262144),
        modelEntry('kimi-k2.6', 'Kimi K2.6', 262144)
      ],
      visionModels: [
        modelEntry('kimi-k3.1-pro', 'Kimi K3.1 Pro (Vision)', 1048576),
        modelEntry('kimi-k3', 'Kimi K3 (Vision)', 262144)
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
      defaultTextModel: 'k3',
      defaultVisionModel: 'k3',
      textModels: [
        modelEntry('k3', 'Kimi Code K3', 262144),
        modelEntry('kimi-k3.1-pro', 'Kimi K3.1 Pro', 1048576)
      ],
      visionModels: [
        modelEntry('k3', 'Kimi Code K3 (Vision)', 262144),
        modelEntry('kimi-k3.1-pro', 'Kimi K3.1 Pro (Vision)', 1048576)
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
      defaultTextModel: 'kilo-auto/free',
      defaultVisionModel: 'kilo-auto/free',
      textModels: [
        modelEntry('kilo-auto/free', 'Kilo Auto (Free)', 128000, true)
      ],
      visionModels: [
        modelEntry('kilo-auto/free', 'Kilo Auto Vision (Free)', 128000, true)
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
      defaultTextModel: 'MiniMax-M3',
      defaultVisionModel: 'MiniMax-M3.1-Flash',
      textModels: [
        modelEntry('MiniMax-M3', 'MiniMax M3', 1048576),
        modelEntry('MiniMax-M3.1-Flash', 'MiniMax M3.1 Flash', 1048576),
        modelEntry('MiniMax-M2.7', 'MiniMax M2.7', 196608)
      ],
      visionModels: [
        modelEntry('MiniMax-M3.1-Flash', 'MiniMax M3.1 Flash (Vision)', 1048576),
        modelEntry('MiniMax-M3', 'MiniMax M3 (Vision)', 1048576)
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
      defaultTextModel: 'DeepSeek-V4-Pro',
      defaultVisionModel: 'Qwen3.8-27B',
      textModels: [
        modelEntry('DeepSeek-V4-Pro', 'DeepSeek V4 Pro', 131072),
        modelEntry('Qwen3.8-27B', 'Qwen 3.8 27B', 131072),
        modelEntry('gpt-oss-120b', 'GPT-OSS 120B', 131072)
      ],
      visionModels: [
        modelEntry('Qwen3.8-27B', 'Qwen 3.8 27B (Vision)', 131072)
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
      defaultTextModel: 'accounts/fireworks/models/deepseek-v4-pro',
      defaultVisionModel: 'accounts/fireworks/models/qwen3p8-27b',
      textModels: [
        modelEntry('accounts/fireworks/models/deepseek-v4-pro', 'DeepSeek V4 Pro', 163840),
        modelEntry('accounts/fireworks/models/qwen3p8-27b', 'Qwen 3.8 27B', 131072),
        modelEntry('accounts/fireworks/models/gpt-oss-120b', 'GPT-OSS 120B', 131072)
      ],
      visionModels: [
        modelEntry('accounts/fireworks/models/qwen3p8-27b', 'Qwen 3.8 27B (Vision)', 131072)
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
      defaultTextModel: 'deepseek/deepseek-v4-flash-0731',
      defaultVisionModel: 'qwen/qwen3.8-27b',
      textModels: [
        modelEntry('deepseek/deepseek-v4-flash-0731', 'DeepSeek V4 Flash', 131072),
        modelEntry('deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro', 131072),
        modelEntry('qwen/qwen3.8-27b', 'Qwen 3.8 27B', 131072)
      ],
      visionModels: [
        modelEntry('qwen/qwen3.8-27b', 'Qwen 3.8 27B (Vision)', 131072)
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
      defaultTextModel: '@cf/moonshotai/kimi-k2.6',
      defaultVisionModel: '@cf/google/gemma-4-31b-it',
      textModels: [
        modelEntry('@cf/moonshotai/kimi-k2.6', 'Kimi K2.6 (Workers AI)', 262144),
        modelEntry('@cf/openai/gpt-oss-120b', 'GPT-OSS 120B (Workers AI)', 131072),
        modelEntry('@cf/google/gemma-4-31b-it', 'Gemma 4 31B (Workers AI)', 262144)
      ],
      visionModels: [
        modelEntry('@cf/google/gemma-4-31b-it', 'Gemma 4 31B Vision', 262144),
        modelEntry('@cf/moonshotai/kimi-k2.6', 'Kimi K2.6 Vision', 262144)
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
      defaultTextModel: 'glm-5.2',
      defaultVisionModel: 'glm-5.3-flash',
      textModels: [
        modelEntry('glm-5.2', 'GLM-5.2', 200000),
        modelEntry('glm-5.3-flash', 'GLM-5.3 Flash', 1048576)
      ],
      visionModels: [
        modelEntry('glm-5.3-flash', 'GLM-5.3 Flash (Vision)', 1048576),
        modelEntry('glm-5.2', 'GLM-5.2 (Vision)', 200000)
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
      defaultTextModel: 'qwen3.7-plus',
      defaultVisionModel: 'qwen3.8-vl',
      textModels: [
        modelEntry('qwen3.7-plus', 'Qwen 3.7 Plus', 131072),
        modelEntry('qwen3-max', 'Qwen 3 Max', 131072),
        modelEntry('qwen3-coder-plus', 'Qwen 3 Coder Plus', 131072)
      ],
      visionModels: [
        modelEntry('qwen3.8-vl', 'Qwen 3.8 VL', 131072),
        modelEntry('qwen3-vl-plus', 'Qwen 3 VL Plus', 131072)
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
      defaultTextModel: 'kimi-k3-free',
      defaultVisionModel: 'kimi-k3-free',
      textModels: [
        modelEntry('kimi-k3-free', 'Kimi K3 (Free)', 262144, true),
        modelEntry('auto', 'NaraRoute Auto', 128000)
      ],
      visionModels: [
        modelEntry('kimi-k3-free', 'Kimi K3 Vision (Free)', 262144, true),
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
      defaultTextModel: 'qwen3-coder:480b',
      defaultVisionModel: 'gemma4:31b',
      textModels: [
        modelEntry('qwen3-coder:480b', 'Qwen 3 Coder 480B', 262144),
        modelEntry('gpt-oss:120b', 'GPT-OSS 120B', 131072),
        modelEntry('gemma4:31b', 'Gemma 4 31B', 262144)
      ],
      visionModels: [
        modelEntry('gemma4:31b', 'Gemma 4 31B (Vision)', 262144),
        modelEntry('qwen3.8:27b', 'Qwen 3.8 27B (Vision)', 131072)
      ]
    },

    anthropic_compatible: {
      name: 'Anthropic Compatible',
      type: 'claude',
      category: 'cloud',
      local: false,
      tierLabel: 'Générique',
      baseUrl: '',
      apiKeyField: 'anthropicCompatibleApiKey',
      keyPlaceholder: 'Clé ou jeton API du serveur...',
      baseUrlPlaceholder: 'https://votre-serveur.example.com/v1 ou http://127.0.0.1:8082/v1',
      supportsCustomBaseUrl: true,
      requiresBaseUrl: true,
      allowsLoopbackBaseUrl: true,
      normalizeV1: true,
      genericProtocolConnector: true,
      messagesPath: '/messages',
      defaultTextModel: 'auto',
      defaultVisionModel: 'auto',
      textModels: [
        modelEntry('auto', 'Modèle du serveur (/v1/models)', 200000)
      ],
      visionModels: [
        modelEntry('auto', 'Modèle vision du serveur (/v1/models)', 200000)
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
      defaultTextModel: 'claude-fable-5-2',
      defaultVisionModel: 'claude-fable-5-2',
      textModels: [
        modelEntry('claude-fable-5-2', 'Claude Fable 5.2', 1000000),
        modelEntry('claude-opus-5-5', 'Claude Opus 5.5', 1000000),
        modelEntry('claude-sonnet-5-5', 'Claude Sonnet 5.5', 1000000),
        modelEntry('glm-5.2', 'GLM-5.2', 200000),
        modelEntry('gpt-5.6-sol', 'GPT-5.6 Sol', 256000),
        modelEntry('gpt-5.5', 'GPT-5.5', 256000),
        modelEntry('kimi-k3', 'Kimi K3', 262144)
      ],
      visionModels: [
        modelEntry('claude-fable-5-2', 'Claude Fable 5.2 (Vision)', 1000000),
        modelEntry('claude-opus-5-5', 'Claude Opus 5.5 (Vision)', 1000000),
        modelEntry('claude-sonnet-5-5', 'Claude Sonnet 5.5 (Vision)', 1000000)
      ]
    },

    fcc_local: {
      name: 'FreeClaudeCode (Local)',
      type: 'claude',
      category: 'local',
      local: true,
      tierLabel: 'Local',
      baseUrl: 'http://127.0.0.1:8082/v1',
      apiKeyField: 'fccLocalApiKey',
      staticApiKey: 'fcc-local',
      keyPlaceholder: 'Optionnelle (ANTHROPIC_AUTH_TOKEN si activé)',
      baseUrlPlaceholder: 'http://127.0.0.1:8082/v1',
      supportsCustomBaseUrl: true,
      allowsLoopbackBaseUrl: true,
      normalizeV1: true,
      messagesPath: '/messages',
      sendBearerAuth: true,
      defaultTextModel: 'nvidia_nim/nvidia/nemotron-3-super-120b-a12b',
      defaultVisionModel: 'antigravity/gemini-4-hydrogen',
      textModels: [
        modelEntry('nvidia_nim/nvidia/nemotron-3-super-120b-a12b', 'Nemotron 3 Super 120B (fcc-server)', 1048576, true),
        modelEntry('antigravity/gemini-4-hydrogen', 'Antigravity Gemini 4 Hydrogen (fcc-server)', 1048576, true),
        modelEntry('claude-fable-5-2', 'Claude Fable 5.2 (fcc-server)', 1000000, true),
        modelEntry('claude-sonnet-5-5', 'Claude Sonnet 5.5 (fcc-server)', 1000000, true)
      ],
      visionModels: [
        modelEntry('antigravity/gemini-4-hydrogen', 'Antigravity Gemini 4 Hydrogen Vision (fcc-server)', 1048576, true),
        modelEntry('nvidia_nim/nvidia/nemotron-3-super-120b-a12b', 'Nemotron 3 Super 120B Vision (fcc-server)', 1048576, true),
        modelEntry('claude-sonnet-5-5', 'Claude Sonnet 5.5 Vision (fcc-server)', 1000000, true)
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
      defaultTextModel: 'qwen3.8:27b',
      defaultVisionModel: 'gemma4:12b',
      textModels: [
        modelEntry('qwen3.8:27b', 'Qwen 3.8 27B', 131072, true),
        modelEntry('gemma4:12b', 'Gemma 4 12B', 262144, true),
        modelEntry('gpt-oss:20b', 'GPT-OSS 20B', 131072, true)
      ],
      visionModels: [
        modelEntry('gemma4:12b', 'Gemma 4 12B (Vision)', 262144, true),
        modelEntry('qwen3.8:27b', 'Qwen 3.8 27B (Vision)', 131072, true)
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
