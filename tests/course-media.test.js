'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.TEST_TARGET_ROOT
  ? path.resolve(process.env.TEST_TARGET_ROOT)
  : path.resolve(__dirname, '..');

const CourseMedia = require(path.join(ROOT, 'course-media.js'));

const SAMPLE_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const SAMPLE_PNG_DATA_URL = `data:image/png;base64,${SAMPLE_PNG_B64}`;
const SAMPLE_JPEG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const SAMPLE_JPEG_DATA_URL = `data:image/jpeg;base64,${SAMPLE_JPEG_B64}`;

// ──────────────────────────────────────────────
// 1. CourseMedia pure helpers (nominal + negative)
// ──────────────────────────────────────────────

test('CourseMedia.sniffCourseImageMime detects PNG/JPEG/GIF/WebP and rejects SVG/HTML/BMP/empty', () => {
  assert.equal(CourseMedia.sniffCourseImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), 'image/png');
  assert.equal(CourseMedia.sniffCourseImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])), 'image/jpeg');
  assert.equal(CourseMedia.sniffCourseImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'image/gif');
  assert.equal(
    CourseMedia.sniffCourseImageMime(new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50
    ])),
    'image/webp'
  );

  // Negative controls
  assert.equal(CourseMedia.sniffCourseImageMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(CourseMedia.sniffCourseImageMime(new TextEncoder().encode('<html>bad</html>')), null);
  assert.equal(CourseMedia.sniffCourseImageMime(new Uint8Array([0x42, 0x4d, 0x00, 0x00])), null); // BMP
  assert.equal(CourseMedia.sniffCourseImageMime(new Uint8Array([])), null);
  assert.equal(CourseMedia.sniffCourseImageMime(null), null);
});

test('CourseMedia.classifyCourseFile classifies images, text docs, rejected_svg, and unsupported', () => {
  assert.equal(CourseMedia.classifyCourseFile({ name: 'schema.PNG', type: 'image/png' }), 'image');
  assert.equal(CourseMedia.classifyCourseFile({ name: 'photo.jpg', type: '' }), 'image');
  assert.equal(CourseMedia.classifyCourseFile({ name: 'fig.jpeg', type: 'image/jpeg' }), 'image');
  assert.equal(CourseMedia.classifyCourseFile({ name: 'diagram.webp', type: 'image/webp' }), 'image');
  assert.equal(CourseMedia.classifyCourseFile({ name: 'anim.gif', type: 'image/gif' }), 'image');

  for (const name of ['cours.pdf', 'notes.docx', 'memo.txt', 'fiche.md', 'readme.markdown', 'page.html', 'page.htm', 'data.csv']) {
    assert.equal(CourseMedia.classifyCourseFile({ name, type: '' }), 'text', `Expected text for ${name}`);
  }

  assert.equal(CourseMedia.classifyCourseFile({ name: 'vector.svg', type: 'image/svg+xml' }), 'rejected_svg');
  assert.equal(CourseMedia.classifyCourseFile({ name: 'weird', type: 'image/svg+xml' }), 'rejected_svg');
  assert.equal(CourseMedia.classifyCourseFile({ name: 'archive.zip', type: 'application/zip' }), 'unsupported');
  assert.equal(CourseMedia.classifyCourseFile({ name: 'noext', type: '' }), 'unsupported');
});

test('CourseMedia.computeScaledDimensions downscales preserving aspect ratio and never upscales', () => {
  assert.deepEqual(CourseMedia.computeScaledDimensions(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(CourseMedia.computeScaledDimensions(3200, 1600, 1600), { width: 1600, height: 800 });
  assert.deepEqual(CourseMedia.computeScaledDimensions(1000, 2000, 1600), { width: 800, height: 1600 });
  assert.equal(CourseMedia.computeScaledDimensions(0, 100, 1600), null);
  assert.equal(CourseMedia.computeScaledDimensions(-10, 100, 1600), null);
  assert.equal(CourseMedia.computeScaledDimensions(NaN, 100, 1600), null);
});

test('CourseMedia.parseImageDataUrl & isImageContextFile reject SVG/malicious/corrupt dataUrls', () => {
  assert.deepEqual(CourseMedia.parseImageDataUrl(SAMPLE_PNG_DATA_URL), {
    mimeType: 'image/png',
    base64: SAMPLE_PNG_B64
  });
  assert.equal(CourseMedia.isImageContextFile({ kind: 'image', dataUrl: SAMPLE_PNG_DATA_URL }), true);

  const badInputs = [
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:text/html;base64,PHNjcmlwdD4=',
    'javascript:alert(1)',
    'https://evil.example/a.png',
    'data:image/png;base64,not valid!',
    '',
    null
  ];
  for (const bad of badInputs) {
    assert.equal(CourseMedia.parseImageDataUrl(bad), null, `Must reject ${bad}`);
    assert.equal(CourseMedia.isImageContextFile({ kind: 'image', dataUrl: bad }), false);
  }
});

test('CourseMedia.checkContextBudget enforces 12-image cap and 4.5MB total cap', () => {
  const existing12 = Array.from({ length: 12 }, (_, i) => ({
    kind: 'image',
    name: `img-${i}.png`,
    dataUrl: `data:image/png;base64,${'A'.repeat(16)}${i === 0 ? 'B' : 'C'.repeat(i)}`
  }));
  const countReject = CourseMedia.checkContextBudget(existing12, {
    kind: 'image',
    name: 'img-13.png',
    dataUrl: SAMPLE_PNG_DATA_URL
  });
  assert.equal(countReject.ok, false);
  assert.match(countReject.reason, /12 images maximum/);

  const hugeText = { name: 'huge.txt', content: 'x'.repeat(CourseMedia.LIMITS.TOTAL_CONTEXT_BUDGET_BYTES + 100) };
  const byteReject = CourseMedia.checkContextBudget([], hugeText);
  assert.equal(byteReject.ok, false);
  assert.match(byteReject.reason, /4,5 Mo/);

  const okRes = CourseMedia.checkContextBudget([], { kind: 'image', name: 'ok.png', dataUrl: SAMPLE_PNG_DATA_URL });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.imageCount, 1);
});

test('CourseMedia.extractContextMedia & mergeRequestImages partition, validate, order, and deduplicate', () => {
  const files = [
    { name: 'notes.txt', content: 'Cours chapitre 1' },
    { kind: 'image', name: 'schema1.png', dataUrl: SAMPLE_PNG_DATA_URL, width: 800, height: 600 },
    { kind: 'image', name: 'dup.png', dataUrl: SAMPLE_PNG_DATA_URL, width: 800, height: 600 },
    { kind: 'image', name: 'bad.svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' },
    { name: 'empty.txt', content: '   ' }
  ];

  const { textFiles, imageFiles } = CourseMedia.extractContextMedia(files);
  assert.equal(textFiles.length, 1);
  assert.equal(textFiles[0].name, 'notes.txt');
  assert.equal(imageFiles.length, 1);
  assert.equal(imageFiles[0].name, 'schema1.png');
  assert.equal(imageFiles[0].mimeType, 'image/png');

  const merged = CourseMedia.mergeRequestImages(imageFiles, [
    { dataUrl: SAMPLE_PNG_DATA_URL, mimeType: 'image/png' },
    { dataUrl: SAMPLE_JPEG_DATA_URL, mimeType: 'image/jpeg' },
    { dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', mimeType: 'image/svg+xml' }
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].dataUrl, SAMPLE_PNG_DATA_URL);
  assert.equal(merged[1].dataUrl, SAMPLE_JPEG_DATA_URL);
});

// ──────────────────────────────────────────────
// 2. BackgroundAgent pipeline integration
// ──────────────────────────────────────────────

function loadAgentEnv({ fetchImpl, storageLocal = {}, asServiceWorker = true } = {}) {
  const providersSrc = fs.readFileSync(path.join(ROOT, 'providers.js'), 'utf8');
  const catalogSrc = fs.readFileSync(path.join(ROOT, 'provider-catalog.js'), 'utf8');
  const mediaSrc = fs.readFileSync(path.join(ROOT, 'course-media.js'), 'utf8');
  const agentSrc = fs.readFileSync(path.join(ROOT, 'background-agent.js'), 'utf8');
  const sysMd = fs.readFileSync(path.join(ROOT, 'system.md'), 'utf8');

  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {}, group: () => {}, groupEnd: () => {} },
    Date,
    Math,
    JSON,
    Promise,
    AbortController,
    setTimeout,
    clearTimeout,
    URL,
    chrome: {
      runtime: {
        getURL: (p) => `chrome-extension://test/${p}`,
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: async (keys) => {
            const store = { agentMemory: [], ...storageLocal };
            const out = {};
            for (const k of (Array.isArray(keys) ? keys : [])) {
              if (k in store) out[k] = store[k];
            }
            return out;
          },
          set: async () => {}
        },
        sync: { get: async () => ({}) }
      }
    },
    fetch: async (url, init) => {
      if (String(url).endsWith('/system.md')) {
        return { ok: true, status: 200, text: async () => sysMd };
      }
      if (fetchImpl) {
        return fetchImpl(url, init);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  vm.createContext(sandbox);
  if (asServiceWorker) {
    vm.runInContext('class ServiceWorkerGlobalScope {} Object.setPrototypeOf(self, ServiceWorkerGlobalScope.prototype);', sandbox);
  }
  vm.runInContext(catalogSrc, sandbox, { filename: 'provider-catalog.js' });
  vm.runInContext(mediaSrc, sandbox, { filename: 'course-media.js' });
  vm.runInContext(providersSrc, sandbox, { filename: 'providers.js' });
  vm.runInContext(agentSrc, sandbox, { filename: 'background-agent.js' });
  return sandbox;
}

test('BackgroundAgent._buildPrompt avoids double text injection and formats course images cleanly without "undefined"', async () => {
  const env = loadAgentEnv();
  const prompt = await env.BackgroundAgent._buildPrompt(
    { questions: [{ index: 1, type: 'radio', text: 'Q1?', options: [{ text: 'A' }, { text: 'B' }] }], totalImages: 0 },
    'Note libre',
    [
      { name: 'cours.txt', content: 'CONTENU_UNIQUE_COURS' },
      { kind: 'image', name: 'tableau_valeurs.png', dataUrl: SAMPLE_PNG_DATA_URL, width: 1000, height: 800 }
    ],
    { domainPreset: 'general' }
  );

  assert.ok(!prompt.user.includes('undefined'), 'user prompt must never contain "undefined"');
  const occurrences = prompt.user.split('CONTENU_UNIQUE_COURS').length - 1;
  assert.equal(occurrences, 1, 'text file content must be injected exactly once');
  assert.ok(prompt.user.includes('Note libre'));
  assert.ok(prompt.user.includes('CONTEXTE FOURNI (Images de cours — 1 image(s) jointe(s) en premier):'));
  assert.ok(prompt.user.includes('- Image de cours 1 : tableau_valeurs.png'));
  assert.ok(prompt.user.includes('NOTE: Des images de notes de cours sont jointes'));
});

test('BackgroundAgent._estimateImageTokens & _createQuizChunks prevent chunking explosion and route all questions to vision bucket when course images exist', () => {
  const env = loadAgentEnv();
  const tokens = env.BackgroundAgent._estimateImageTokens({
    dataUrl: `data:image/jpeg;base64,${'A'.repeat(500000)}`,
    width: 1200,
    height: 900
  });
  assert.equal(tokens, 1440);
  assert.equal(env.BackgroundAgent._estimateImageTokens({ dataUrl: SAMPLE_PNG_DATA_URL }), 1500);
  assert.equal(env.BackgroundAgent._estimateImageTokens(null), 0);

  const questions = [
    { index: 1, type: 'radio', text: 'Text question 1', options: [{ text: 'A' }], images: [] },
    { index: 2, type: 'radio', text: 'Vision question 2', options: [{ text: 'B' }], images: [{ dataUrl: SAMPLE_JPEG_DATA_URL }] }
  ];

  const withCourseImgs = env.BackgroundAgent._createQuizChunks(questions, 'gemini', 2000, {}, true);
  assert.equal(withCourseImgs.length, 1);
  assert.equal(withCourseImgs[0].isVisionBucket, true);
  assert.equal(withCourseImgs[0].questions.length, 2);

  const withoutCourseImgs = env.BackgroundAgent._createQuizChunks(questions, 'gemini', 2000, {}, false);
  assert.equal(withoutCourseImgs.length, 2);
  assert.equal(withoutCourseImgs[0].isVisionBucket, false);
  assert.equal(withoutCourseImgs[1].isVisionBucket, true);
});

test('BackgroundAgent Fast Path sends course-note images and selects vision model across Gemini, Claude, and OpenAI (even when quiz has 0 images & captureImages=false)', async () => {
  const scenarios = [
    {
      provider: 'gemini',
      keyField: 'geminiApiKey',
      keyValue: ['AIza', 'TestKey', '123456'].join(''),
      expectedVisionModel: 'gemini-3.8-flash',
      customModels: { gemini: { text: 'gemini-3.5-flash-lite', vision: 'gemini-3.8-flash' } },
      responseBody: () => ({
        candidates: [{ content: { parts: [{ text: '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index><confidence>92</confidence></answer></quiz_answers>' }] } }]
      }),
      verifyPayload: (url, body) => {
        assert.ok(url.includes('/gemini-3.8-flash:generateContent'));
        const parts = body.contents[0].parts;
        assert.equal(parts[0].inlineData.mimeType, 'image/png');
        assert.equal(parts[0].inlineData.data, SAMPLE_PNG_B64);
      }
    },
    {
      provider: 'claude',
      keyField: 'claudeApiKey',
      keyValue: ['sk-', 'ant-', 'test-key'].join(''),
      expectedVisionModel: 'claude-opus-5-5',
      customModels: { claude: { text: 'claude-haiku-5-5', vision: 'claude-opus-5-5' } },
      responseBody: () => ({
        content: [{ type: 'text', text: '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index><confidence>92</confidence></answer></quiz_answers>' }]
      }),
      verifyPayload: (_url, body) => {
        assert.equal(body.model, 'claude-opus-5-5');
        const content = body.messages[0].content;
        assert.equal(content[0].type, 'image');
        assert.equal(content[0].source.media_type, 'image/png');
        assert.equal(content[0].source.data, SAMPLE_PNG_B64);
      }
    },
    {
      provider: 'groq',
      keyField: 'groqApiKey',
      keyValue: ['gsk_', 'test_key_', '123'].join(''),
      expectedVisionModel: 'qwen/qwen3.8-27b',
      customModels: {},
      responseBody: () => ({
        choices: [{ message: { content: '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index><confidence>92</confidence></answer></quiz_answers>' } }]
      }),
      verifyPayload: (_url, body) => {
        assert.equal(body.model, 'qwen/qwen3.8-27b');
        const userMsg = body.messages.find(m => m.role === 'user');
        assert.equal(userMsg.content[0].type, 'image_url');
        assert.equal(userMsg.content[0].image_url.url, SAMPLE_PNG_DATA_URL);
      }
    }
  ];

  for (const sc of scenarios) {
    let capturedUrl = '';
    let capturedBody = null;
    const env = loadAgentEnv({
      fetchImpl: async (url, init) => {
        capturedUrl = String(url);
        capturedBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          headers: null,
          text: async () => JSON.stringify(sc.responseBody()),
          json: async () => sc.responseBody()
        };
      }
    });

    const result = await env.BackgroundAgent.solve({
      questions: [{ index: 1, type: 'radio', text: 'Quel schéma correspond ?', options: [{ text: 'Alpha' }, { text: 'Beta' }], images: [] }],
      config: {
        syncConfig: {
          captureImages: false,
          providerOrder: [sc.provider],
          customModels: sc.customModels,
          contextFiles: [{ kind: 'image', name: 'cours_schema.png', dataUrl: SAMPLE_PNG_DATA_URL, width: 640, height: 480 }]
        },
        apiKeys: { [sc.keyField]: sc.keyValue },
        settings: { selectedProvider: sc.provider }
      }
    });

    assert.equal(result.success, true, `Expected success for ${sc.provider}`);
    assert.equal(result.metadata.model, sc.expectedVisionModel);
    sc.verifyPayload(capturedUrl, capturedBody);
  }
});

test('BackgroundAgent Agent Path (ReAct + Ralph retry) + Cross-Validation + SW hydration include course-note images before quiz images', async () => {
  const calls = [];
  let attempt = 0;

  const env = loadAgentEnv({
    asServiceWorker: true,
    storageLocal: {
      contextFiles: [
        { kind: 'image', name: 'formule.png', dataUrl: SAMPLE_PNG_DATA_URL, width: 800, height: 600 },
        { kind: 'image', name: 'corrupt.svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' },
        { name: 'cours.txt', content: 'TEXTE_COURS_UNIQUE' }
      ]
    },
    fetchImpl: async (url, init) => {
      attempt++;
      const body = JSON.parse(init.body);
      calls.push({ url: String(url), body });

      if (String(url).includes('generativelanguage.googleapis.com')) {
        // Call 1 (chunk) answers only Q1 & Q2, omitting Q3 to force Ralph retry
        // Call 2 (Ralph retry on Q3) answers Q3
        const xml = attempt === 1
          ? '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index><confidence>90</confidence></answer><answer question_id="2" type="radio"><option_index>2</option_index><confidence>55</confidence></answer></quiz_answers>'
          : '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index><confidence>88</confidence></answer></quiz_answers>';
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates: [{ content: { parts: [{ text: xml }] } }] }),
          text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: xml }] } }] })
        };
      }

      // Cross-validation on Claude (Q2 has confidence 55 < 70)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: '<quiz_answers><answer question_id="1" type="radio"><option_index>2</option_index><confidence>90</confidence></answer></quiz_answers>' }]
        }),
        text: async () => JSON.stringify({
          content: [{ type: 'text', text: '<quiz_answers><answer question_id="1" type="radio"><option_index>2</option_index><confidence>90</confidence></answer></quiz_answers>' }]
        })
      };
    }
  });

  const result = await env.BackgroundAgent.solve({
    questions: [
      { index: 1, type: 'radio', text: 'Q1', options: [{ text: 'A' }, { text: 'B' }], images: [] },
      { index: 2, type: 'radio', text: 'Q2', options: [{ text: 'C' }, { text: 'D' }], images: [{ dataUrl: SAMPLE_JPEG_DATA_URL, mimeType: 'image/jpeg' }] },
      { index: 3, type: 'radio', text: 'Q3', options: [{ text: 'E' }, { text: 'F' }], images: [] }
    ],
    config: {
      syncConfig: {
        providerOrder: ['gemini', 'claude'],
        crossValidationEnabled: true,
        crossValidationThreshold: 70
      },
      apiKeys: {
        geminiApiKey: ['AIza', 'PrimaryTest'].join(''),
        claudeApiKey: ['sk-', 'ant-', 'secondary-test'].join('')
      },
      settings: {}
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.answers.length, 3);
  assert.equal(result.metadata.retriesUsed, 1);
  assert.equal(calls.length, 3, 'Expected 1 chunk call + 1 Ralph retry + 1 cross-validation call');

  // Call 1 (Gemini chunk): course PNG first, then Q2 JPEG; text file appears once
  const gemParts1 = calls[0].body.contents[0].parts;
  assert.equal(gemParts1.length, 3);
  assert.equal(gemParts1[0].inlineData.data, SAMPLE_PNG_B64);
  assert.equal(gemParts1[1].inlineData.data, SAMPLE_JPEG_B64);
  assert.equal(gemParts1[2].text.split('TEXTE_COURS_UNIQUE').length - 1, 1);

  // Call 2 (Ralph retry on Q3): still attaches course PNG and selects Gemini vision model
  const gemParts2 = calls[1].body.contents[0].parts;
  assert.equal(gemParts2[0].inlineData.data, SAMPLE_PNG_B64);
  assert.ok(calls[1].url.includes('gemini-4-hydrogen'));

  // Call 3 (Cross-validation on Claude for Q2): course PNG first, then Q2 JPEG, uses Claude vision model
  assert.equal(calls[2].body.model, 'claude-sonnet-5-5');
  const claudeBlocks = calls[2].body.messages[0].content;
  assert.equal(claudeBlocks[0].type, 'image');
  assert.equal(claudeBlocks[0].source.data, SAMPLE_PNG_B64);
  assert.equal(claudeBlocks[1].type, 'image');
  assert.equal(claudeBlocks[1].source.data, SAMPLE_JPEG_B64);
  assert.ok(claudeBlocks[2].text.includes('COURSE NOTE IMAGES: 1'));
});

test('BackgroundAgent ignores corrupt/SVG context image when deciding vision vs text model', async () => {
  let calledUrl = '';
  const env = loadAgentEnv({
    fetchImpl: async (url) => {
      calledUrl = String(url);
      const xml = '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index><confidence>95</confidence></answer></quiz_answers>';
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: xml }] } }] }),
        text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: xml }] } }] })
      };
    }
  });

  const res = await env.BackgroundAgent.solve({
    questions: [{ index: 1, type: 'radio', text: 'Q1', options: [{ text: 'A' }, { text: 'B' }], images: [] }],
    config: {
      syncConfig: {
        providerOrder: ['groq'],
        contextFiles: [{ kind: 'image', name: 'evil.svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }]
      },
      apiKeys: { groqApiKey: ['gsk_', 'test_key'].join('') },
      settings: {}
    }
  });

  assert.equal(res.success, true);
  assert.equal(res.metadata.model, 'openai/gpt-oss-120b');
});

test('Regression Antibug #2 & #3: Ralph retry recovers Q1 without overwriting Q2/Q3, and SVG q.images stays on text model without false image note', async () => {
  const bodies = [];
  const env = loadAgentEnv({
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      const userText = typeof body.messages[1]?.content === 'string' ? body.messages[1].content : '';
      // Full-quiz call omits Q1 and answers Q2 & Q3; Ralph retry call (only Q1) answers Q1
      const xml = userText.includes('Q2 plain text')
        ? '<quiz_answers><answer question_id="2" type="radio"><option_index>1</option_index><confidence>90</confidence></answer><answer question_id="3" type="radio"><option_index>2</option_index><confidence>91</confidence></answer></quiz_answers>'
        : '<quiz_answers><answer question_id="1" type="radio"><option_index>2</option_index><confidence>92</confidence></answer></quiz_answers>';
      return {
        ok: true,
        status: 200,
        headers: null,
        json: async () => ({ choices: [{ message: { content: xml } }] }),
        text: async () => JSON.stringify({ choices: [{ message: { content: xml } }] })
      };
    }
  });

  const res = await env.BackgroundAgent.solve({
    questions: [
      { index: 1, type: 'radio', text: 'Q1 with invalid SVG', options: [{ text: 'A1' }, { text: 'A2' }], images: [{ dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }] },
      { index: 2, type: 'radio', text: 'Q2 plain text', options: [{ text: 'B1' }, { text: 'B2' }], images: [] },
      { index: 3, type: 'radio', text: 'Q3 plain text', options: [{ text: 'C1' }, { text: 'C2' }], images: [] }
    ],
    config: {
      syncConfig: { providerOrder: ['groq'] },
      apiKeys: { groqApiKey: ['gsk_', 'regression_', 'key'].join('') },
      settings: { thinkingMode: true }
    }
  });

  assert.equal(res.success, true);
  assert.equal(res.metadata.chunksProcessed, 1, 'SVG-only question image must not split into separate vision chunk');
  assert.equal(res.metadata.retriesUsed, 1, 'Ralph must recover Q1 in 1 retry without overwriting Q2');
  assert.deepEqual(Array.from(res.answers, a => a.questionIndex), [0, 1, 2]);
  assert.deepEqual(Array.from(res.answers, a => Array.from(a.optionIndices)), [[1], [0], [1]]);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].model, 'openai/gpt-oss-120b');
  assert.equal(bodies[1].model, 'openai/gpt-oss-120b');
  assert.equal(typeof bodies[0].messages[1].content, 'string');
  assert.ok(!bodies[0].messages[1].content.includes('Des images sont jointes'));
  assert.ok(!bodies[0].messages[1].content.includes('image(s) jointe(s) pour cette question'));
});

// ──────────────────────────────────────────────
// 3. Settings UI integration (VM DOM mock)
// ──────────────────────────────────────────────

test('settings.js renderFileList renders safe image thumbnails & budget and handleFiles rejects SVG / non-raster & resets fileInput', async () => {
  const settingsSrc = fs.readFileSync(path.join(ROOT, 'settings.js'), 'utf8');
  const mediaSrc = fs.readFileSync(path.join(ROOT, 'course-media.js'), 'utf8');
  const cleanerSrc = fs.readFileSync(path.join(ROOT, 'nlp-cleaner.js'), 'utf8');
  const catalogSrc = fs.readFileSync(path.join(ROOT, 'provider-catalog.js'), 'utf8');
  const providersSrc = fs.readFileSync(path.join(ROOT, 'providers.js'), 'utf8');

  class MiniEl {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.style = {};
      this.dataset = {};
      this.attributes = {};
      this.children = [];
      this.parentNode = null;
      this._textContent = '';
      this.value = '';
      this.checked = false;
      this.hidden = false;
      this.id = '';
      this.src = '';
      this.alt = '';
      this.loading = '';
      this.className = '';
      this._listeners = {};
      this.classList = {
        add: () => {},
        remove: () => {},
        contains: () => false,
        toggle: () => false
      };
    }
    get textContent() { return this._textContent; }
    set textContent(v) {
      this._textContent = String(v ?? '');
      this.children = [];
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] ?? null; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    contains(other) { return other === this || this.children.some(c => c.contains && c.contains(other)); }
    getContext() { return null; }
  }

  const byId = new Map();
  const ids = [
    'providersAccordion', 'providerSearchInput', 'providerFilterCount', 'providersEmptyState',
    'showAllPriorityProviders', 'showAllModelOverrides', 'serpApiKey', 'agenticSearch', 'autoMode',
    'captureImages', 'imageMinSize', 'imageMinSizeDisplay', 'imageQuality', 'imageQualityDisplay',
    'priorityList', 'modelOverrides', 'contextText', 'fileInput', 'fileUploadArea', 'fileList',
    'fileBudgetInfo', 'customQuestionSelector', 'customAnswerSelector', 'highlightColor',
    'highlightIntensity', 'schemaList', 'refreshSchemasBtn', 'clearAllSchemasBtn', 'saveBtn',
    'resetBtn', 'saveStatus', 'discretionSlider', 'highlightPreviewElement', 'discretionDescription',
    'colorCustomizerRow', 'showConfidenceBadge', 'domainPreset', 'customDomainRules',
    'crossValidationEnabled', 'crossValidationThreshold', 'crossValidationThresholdDisplay',
    'crossValidationOptionsRow', 'autoSubmitEnabled', 'autoSubmitMinConfidence',
    'autoSubmitMinConfidenceDisplay', 'autoSubmitDelayMs', 'autoSubmitDelayMsDisplay',
    'autoSubmitOptionsGroup', 'passiveNetworkIntercept', 'themeToggleBtn'
  ];
  for (const id of ids) {
    const el = new MiniEl(id === 'fileInput' || id.includes('Slider') ? 'input' : 'div');
    el.id = id;
    byId.set(id, el);
  }

  const docEl = new MiniEl('html');
  docEl.getAttribute = (k) => (k === 'data-theme' ? 'light' : docEl.attributes[k] ?? null);

  const documentMock = {
    documentElement: docEl,
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => new MiniEl(tag),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    querySelectorAll: () => [],
    addEventListener: () => {}
  };

  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Date,
    Math,
    JSON,
    Promise,
    Set,
    Map,
    Array,
    Number,
    String,
    Boolean,
    Uint8Array,
    TextEncoder,
    URL,
    setTimeout,
    clearTimeout,
    document: documentMock,
    location: { reload: () => {} },
    confirm: () => true,
    chrome: {
      storage: {
        local: {
          get: async () => ({
            contextFiles: [
              { kind: 'image', name: 'saved_diagram.png', dataUrl: SAMPLE_PNG_DATA_URL, width: 320, height: 240, size: SAMPLE_PNG_DATA_URL.length }
            ]
          }),
          set: async () => {},
          remove: async () => {}
        },
        sync: {
          get: async () => ({}),
          set: async () => {},
          clear: async () => {}
        }
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(catalogSrc, sandbox, { filename: 'provider-catalog.js' });
  vm.runInContext(cleanerSrc, sandbox, { filename: 'nlp-cleaner.js' });
  vm.runInContext(mediaSrc, sandbox, { filename: 'course-media.js' });
  vm.runInContext(providersSrc, sandbox, { filename: 'providers.js' });
  vm.runInContext(settingsSrc, sandbox, { filename: 'settings.js' });

  await sandbox.loadSettings();
  await sandbox.setupEventListeners();

  const fileListEl = byId.get('fileList');
  assert.equal(fileListEl.children.length, 1);
  const item = fileListEl.children[0];
  const thumb = item.children[0].children[0];
  assert.equal(thumb.tagName, 'IMG');
  assert.equal(thumb.src, SAMPLE_PNG_DATA_URL);
  assert.equal(byId.get('fileBudgetInfo').hidden, false);
  assert.match(byId.get('fileBudgetInfo').textContent, /1 fichier \(1 image\)/);

  // Simulate selecting an SVG via fileInput change -> must reset value and reject SVG
  const fileInputEl = byId.get('fileInput');
  fileInputEl.value = 'C:\\fakepath\\vector.svg';
  fileInputEl.files = [{ name: 'vector.svg', type: 'image/svg+xml', size: 20 }];
  await fileInputEl._listeners.change[0]({ target: fileInputEl });
  assert.equal(fileInputEl.value, '');
  assert.match(byId.get('saveStatus').textContent, /SVG non pris en charge/);
  assert.equal(fileListEl.children.length, 1);

  // Simulate dropping a spoofed PNG containing HTML magic bytes -> must reject via sniffCourseImageMime
  const uploadArea = byId.get('fileUploadArea');
  const htmlBytes = new TextEncoder().encode('<html>not a png</html>');
  await uploadArea._listeners.drop[0]({
    preventDefault: () => {},
    stopPropagation: () => {},
    dataTransfer: {
      files: [{
        name: 'fake.png',
        type: 'image/png',
        size: htmlBytes.length,
        slice: (s, e) => ({ arrayBuffer: async () => htmlBytes.slice(s, e).buffer }),
        arrayBuffer: async () => htmlBytes.buffer
      }]
    }
  });
  assert.match(byId.get('saveStatus').textContent, /Image invalide ou format non pris en charge/);
  assert.equal(fileListEl.children.length, 1);

  // Mixed batch: valid text file + rejected SVG reports both added and refused counts
  await sandbox.handleFiles([
    {
      name: 'note_valide.txt',
      type: 'text/plain',
      size: 24,
      text: async () => 'Formule importante: F = m * a'
    },
    {
      name: 'bad.svg',
      type: 'image/svg+xml',
      size: 12
    }
  ]);
  assert.match(byId.get('saveStatus').textContent, /1 ajouté\(s\), 1 refusé\(s\)/);
  assert.equal(fileListEl.children.length, 2);

  // Remove the added text file, then the loaded PNG -> list empties & budget hides
  fileListEl.children[1].children[1]._listeners.click[0]();
  assert.equal(fileListEl.children.length, 1);
  fileListEl.children[0].children[1]._listeners.click[0]();
  assert.equal(fileListEl.children.length, 0);
  assert.equal(byId.get('fileBudgetInfo').hidden, true);
});
