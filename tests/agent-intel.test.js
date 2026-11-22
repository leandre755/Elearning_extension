'use strict';
// Behavioral & edge-case tests for background-agent.js & system.md
// (F-INT-03 domain rules, F-INT-04 cross-validation engine, F-INT-02 confidence/explanation normalization).
// Zero external dependencies — Node 26 node:test + node:assert/strict.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TARGET_ROOT = process.env.TEST_TARGET_ROOT
  ? path.resolve(process.env.TEST_TARGET_ROOT)
  : path.resolve(__dirname, '..');

const {
  BackgroundAgent,
  DOMAIN_PRESETS,
  detectDomain,
  buildDomainRules,
  applyDomainRules,
  computeConfidenceTier,
  normalizeAnswerEntry,
  crossValidateAnswers
} = require(path.join(TARGET_ROOT, 'background-agent.js'));

// ===========================================================================
// F-INT-03: Modular Domain Rules & system.md
// ===========================================================================

test('F-INT-03: system.md contains {{domain_rules}} placeholder and backwards-compatible <confidence>/<explanation> docs', () => {
  const sysMd = fs.readFileSync(path.join(TARGET_ROOT, 'system.md'), 'utf8');
  assert.ok(sysMd.includes('{{domain_rules}}'), 'system.md must include {{domain_rules}} placeholder');
  assert.ok(sysMd.includes('<quiz_answers>'), 'system.md must preserve <quiz_answers> XML contract');
  assert.ok(sysMd.includes('<confidence>'), 'system.md must document <confidence>');
  assert.ok(sysMd.includes('<explanation>'), 'system.md must document <explanation>');
  assert.deepEqual(Object.keys(DOMAIN_PRESETS).sort(), ['cs', 'general', 'law', 'math', 'medicine']);
});

test('F-INT-03: detectDomain deterministically classifies law, medicine, cs, math, and falls back to general', () => {
  assert.equal(
    detectDomain('According to the Supreme Court jurisprudence and Code civil article 1240 on tort liability of the defendant:'),
    'law'
  );
  assert.equal(
    detectDomain('A 54-year-old patient presents with myocardial infarction, tachycardia, and contraindication to antibiotic posologie:'),
    'medicine'
  );
  assert.equal(
    detectDomain('What is the time complexity O(n log n) of binary search on a sorted array and mutex deadlock prevention in C++?'),
    'cs'
  );
  assert.equal(
    detectDomain('Compute the eigenvalue and determinant of the matrix and solve the differential equation ∫ f(x) dx:'),
    'math'
  );
  // Negative control: empty, non-string, or generic trivia -> general
  assert.equal(detectDomain('What color is the sky on a clear sunny afternoon?'), 'general');
  assert.equal(detectDomain(''), 'general');
  assert.equal(detectDomain(null), 'general');
});

test('F-INT-03: buildDomainRules resolves auto, sanitizes HTML/placeholders in customRules, caps length, and applyDomainRules injects/strips cleanly', () => {
  const longCustom = `<script>alert(1)</script> {{domain_rules}} Always cite articles. ${'X'.repeat(800)}`;
  const built = buildDomainRules('auto', longCustom, 'Code civil jurisprudence Cour de cassation');
  assert.ok(built.includes('Domain Focus (law):'));
  assert.ok(!built.includes('<script>'), 'HTML tags must be stripped from customRules');
  assert.ok(!built.includes('{{domain_rules}}'), 'template braces must be stripped from customRules');
  assert.ok(built.length < 900, 'customRules must be capped to prevent prompt bloat');

  const template = 'Header\n\n{{domain_rules}}\n\nFooter';
  const injected = applyDomainRules(template, built);
  assert.ok(!injected.includes('{{domain_rules}}'));
  assert.ok(injected.includes('## Domain Rules'));
  assert.ok(injected.includes('Domain Focus (law):'));

  // Empty rules removes placeholder without leaving triple blank lines
  const stripped = applyDomainRules(template, '   ');
  assert.equal(stripped, 'Header\n\nFooter');
});

// ===========================================================================
// F-INT-02: Confidence & Explanation Normalization
// ===========================================================================

test('F-INT-02: computeConfidenceTier and normalizeAnswerEntry clamp confidence, strip HTML, cap explanation, and preserve fields', () => {
  assert.equal(computeConfidenceTier(95), 'high');
  assert.equal(computeConfidenceTier(80), 'high');
  assert.equal(computeConfidenceTier(79), 'medium');
  assert.equal(computeConfidenceTier(50), 'medium');
  assert.equal(computeConfidenceTier(49), 'low');
  assert.equal(computeConfidenceTier(0), 'low');
  assert.equal(computeConfidenceTier('88%'), 'high');
  assert.equal(computeConfidenceTier(undefined), 'medium'); // default 75

  const dirty = normalizeAnswerEntry({
    questionIndex: 2,
    raw: '<option_index>1</option_index>',
    optionIndices: ['0', 2, -1, 'nan'],
    textAnswer: null,
    confidence: 145,
    explanation: `<b>Because</b> <script>evil()</script> ${'A'.repeat(400)}`,
    crossValidated: 1,
    crossValidationStatus: 'confirmed',
    crossValidationNote: '<i>Verified</i> by secondary'
  });

  assert.equal(dirty.questionIndex, 2);
  assert.deepEqual(dirty.optionIndices, [0, 2]);
  assert.equal(dirty.confidence, 100);
  assert.equal(dirty.confidenceTier, 'high');
  assert.ok(!dirty.explanation.includes('<b>') && !dirty.explanation.includes('<script>'));
  assert.ok(dirty.explanation.length <= 280, `explanation length ${dirty.explanation.length} must be <= 280`);
  assert.equal(dirty.crossValidated, true);
  assert.equal(dirty.crossValidationStatus, 'confirmed');
  assert.equal(dirty.crossValidationNote, 'Verified by secondary');

  // Negative/missing confidence clamping
  const low = normalizeAnswerEntry({ questionIndex: 0, confidence: -30 });
  assert.equal(low.confidence, 0);
  assert.equal(low.confidenceTier, 'low');

  const defaulted = normalizeAnswerEntry(null);
  assert.equal(defaulted.confidence, 75);
  assert.equal(defaulted.confidenceTier, 'medium');
  assert.equal(defaulted.crossValidated, false);
});

// ===========================================================================
// F-INT-04: Cross-Validation Engine
// ===========================================================================

test('F-INT-04: crossValidateAnswers caps at 5 lowest-confidence (< threshold) questions and queries a distinct secondary provider', async () => {
  const questions = Array.from({ length: 7 }, (_, i) => ({
    index: i + 1,
    type: 'radio',
    text: `Question ${i + 1}?`,
    options: [{ text: 'Opt A' }, { text: 'Opt B' }]
  }));

  // 6 answers below threshold (70) and 1 above (90)
  const confidences = [65, 20, 55, 10, 40, 30, 90];
  const initialAnswers = confidences.map((c, i) => ({
    questionIndex: i,
    raw: '1',
    optionIndices: [0],
    textAnswer: null,
    confidence: c,
    explanation: `Initial Q${i + 1}`
  }));

  const calledProviders = [];
  const calledPrompts = [];

  const validated = await crossValidateAnswers(initialAnswers, questions, {
    primaryProvider: 'groq',
    secondaryProvider: 'gemini',
    threshold: 70,
    callLLM: async (provider, _cfg, _model, history) => {
      calledProviders.push(provider);
      const userMsg = history?.contents?.[0]?.parts?.[0]?.text ||
        history?.messages?.find((m) => m.role === 'user')?.content || '';
      calledPrompts.push(userMsg);
      // Agree on all except Question 4 (index 3, confidence 10) where secondary picks option 2 with 88%
      if (userMsg.includes('Question 4?')) {
        return {
          text: '<quiz_answers><answer question_id="1" type="radio"><option_index>2</option_index><confidence>88</confidence><explanation>Secondary correction</explanation></answer></quiz_answers>'
        };
      }
      return {
        text: '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index><confidence>82</confidence><explanation>Confirmed</explanation></answer></quiz_answers>'
      };
    }
  });

  // Must strictly cap at 5 questions (the 5 lowest: confidences 10, 20, 30, 40, 55 -> indices 3, 1, 5, 4, 2)
  assert.equal(calledProviders.length, 5, 'must cap cross-validation at maxQuestions = 5');
  assert.ok(calledProviders.every((p) => p === 'gemini'), 'must only query secondary provider distinct from primary');

  // Index 0 (conf 65, 6th lowest) and index 6 (conf 90, >= threshold) must remain untouched
  assert.equal(validated[0].crossValidated, false);
  assert.equal(validated[6].crossValidated, false);

  // Index 1 (conf 20 -> agreed with secondary 82 -> boosted to min(98, max(20,82)+12) = 94)
  assert.equal(validated[1].crossValidated, true);
  assert.equal(validated[1].crossValidationStatus, 'confirmed');
  assert.equal(validated[1].confidence, 94);
  assert.equal(validated[1].confidenceTier, 'high');

  // Index 3 (conf 10 -> disputed with secondary 88 picking option 2 -> adopts secondary option [1], confidence capped <= 60)
  assert.equal(validated[3].crossValidated, true);
  assert.equal(validated[3].crossValidationStatus, 'disputed');
  assert.deepEqual(validated[3].optionIndices, [1]);
  assert.ok(validated[3].confidence <= 60, `disputed confidence ${validated[3].confidence} must be capped <= 60`);
  assert.ok(validated[3].crossValidationNote.includes('Disputed'));
});

test('F-INT-04 negative controls: graceful degradation when no secondary provider/search exists or when AbortSignal is aborted', async () => {
  const questions = [{ index: 1, type: 'text', text: 'What is H2O?' }];
  const answers = [{ questionIndex: 0, textAnswer: 'Water', confidence: 40 }];

  // 1. No secondary provider and no web search -> returns normalized answers with crossValidated: false
  const degraded = await crossValidateAnswers(answers, questions, {
    primaryProvider: 'groq',
    config: { apiKeys: { groqApiKey: 'only-primary' }, syncConfig: { providerOrder: ['groq'] } }
  });
  assert.equal(degraded.length, 1);
  assert.equal(degraded[0].crossValidated, false);
  assert.equal(degraded[0].textAnswer, 'Water');

  // 2. Pre-aborted signal -> does not invoke LLM or search
  const ac = new AbortController();
  ac.abort();
  let called = false;
  const abortedRes = await crossValidateAnswers(answers, questions, {
    primaryProvider: 'groq',
    secondaryProvider: 'gemini',
    signal: ac.signal,
    callLLM: async () => { called = true; return { text: '' }; }
  });
  assert.equal(called, false);
  assert.equal(abortedRes[0].crossValidated, false);
});

test('CJS export contract matches BackgroundAgent singleton', () => {
  assert.equal(typeof BackgroundAgent.solve, 'function');
  assert.equal(typeof BackgroundAgent.learnFromFeedback, 'function');
  assert.equal(BackgroundAgent.detectDomain, detectDomain);
  assert.equal(BackgroundAgent.crossValidateAnswers, crossValidateAnswers);
});

// ===========================================================================
// Regression tests from forensic audit
// ===========================================================================

test('Regression F-INT-03: applyDomainRules preserves $&, $100, and $$ without String.replace pattern expansion', () => {
  const rules = buildDomainRules('general', 'Always check $& tokens, $100 limits, and $$ signs.');
  const tpl = 'Intro\n\n{{domain_rules}}\n\nOutro';
  const out = applyDomainRules(tpl, rules);
  assert.ok(!out.includes('{{domain_rules}}'), 'placeholder must not be re-injected via $&');
  assert.ok(out.includes('Always check $& tokens, $100 limits, and $$ signs.'), 'literal $ patterns must stay intact');
});

test('Regression F-INT-02: normalizeAnswerEntry & computeConfidenceTier reject falsy coercion and bare %', () => {
  assert.equal(computeConfidenceTier('%'), 'medium');
  assert.equal(computeConfidenceTier('  % '), 'medium');
  assert.equal(computeConfidenceTier(''), 'medium');
  assert.equal(computeConfidenceTier(null), 'medium');

  const cleaned = normalizeAnswerEntry({
    questionIndex: true,
    optionIndices: [null, '', false, true, ' 1 ', 1, 3],
    confidence: '%'
  });
  assert.equal(cleaned.questionIndex, 0);
  assert.deepEqual(cleaned.optionIndices, [1, 3]);
  assert.equal(cleaned.confidence, 75);
  assert.equal(cleaned.confidenceTier, 'medium');
});

test('Regression F-INT-04: crossValidateAnswers handles invalid threshold, case/prototype provider keys, out-of-bounds secondary answers, and signal cleanup', async () => {
  const questions = [
    { index: 1, type: 'radio', text: 'Q1?', options: [{ text: 'A' }, { text: 'B' }] },
    null
  ];
  const answers = [
    { questionIndex: 0, optionIndices: [0], confidence: 55, explanation: 'Primary' }
  ];

  // 1. Empty string / null threshold must fall back to 70 (not clamp to 1) and reject same-provider uppercase 'GROQ' + prototype keys
  let calls = 0;
  const sameProviderRes = await crossValidateAnswers(answers, questions, {
    primaryProvider: 'groq',
    secondaryProvider: 'GROQ',
    threshold: '',
    config: { syncConfig: { providerOrder: ['__proto__', 'constructor', 'toString', 'groq'] }, apiKeys: { groqApiKey: 'k1' } },
    callLLM: async () => { calls++; return { text: '' }; }
  });
  assert.equal(calls, 0, 'must not treat uppercase primary provider or prototype keys as secondary provider');
  assert.equal(sameProviderRes[0].crossValidated, false);
  assert.equal(({}).polluted, undefined);

  // 2. Out-of-bounds or invalid secondary option (0 -> -1 or 99 -> 98) must NOT overwrite valid primary answer
  const oobRes = await crossValidateAnswers(answers, questions, {
    primaryProvider: 'groq',
    secondaryProvider: 'gemini',
    threshold: null, // falls back to 70
    callLLM: async () => ({
      text: '<quiz_answers><answer question_id="1" type="radio"><option_index>99</option_index><confidence>98</confidence><explanation>Invalid OOB</explanation></answer></quiz_answers>'
    })
  });
  assert.deepEqual(oobRes[0].optionIndices, [0], 'out-of-bounds secondary option must not overwrite primary');
  assert.equal(oobRes[0].crossValidated, false);

  // 3. Web search alone with primaryProvider + AbortSignal listener cleanup
  const ac = new AbortController();
  let removed = false;
  const origRemove = ac.signal.removeEventListener.bind(ac.signal);
  ac.signal.removeEventListener = (type, fn) => {
    if (type === 'abort') removed = true;
    return origRemove(type, fn);
  };
  const searchOnlyRes = await crossValidateAnswers(answers, questions, {
    primaryProvider: 'groq',
    threshold: 70,
    signal: ac.signal,
    searchFn: async () => 'Verified fact: Option B is correct.',
    callLLM: async (prov, _cfg, _m, history) => {
      assert.equal(prov, 'groq');
      const userMsg = history.messages.find(m => m.role === 'user').content;
      assert.ok(userMsg.includes('WEB EVIDENCE:'), 'must include web search evidence in prompt');
      return {
        text: '<quiz_answers><answer question_id="1" type="radio"><option_index>2</option_index><confidence>85</confidence><explanation>Updated via web</explanation></answer></quiz_answers>'
      };
    }
  });
  assert.equal(removed, true, 'must remove abort listener in finally block');
  assert.equal(searchOnlyRes[0].crossValidated, true);
  assert.equal(searchOnlyRes[0].crossValidationStatus, 'disputed');
  assert.deepEqual(searchOnlyRes[0].optionIndices, [1]);
});

test('Regression SW integration: Service Worker importScripts hydrates customDomainRules & crossValidationThreshold from chrome.storage.local without syncConfig', async () => {
  const providersSrc = fs.readFileSync(path.join(TARGET_ROOT, 'providers.js'), 'utf8');
  const agentSrc = fs.readFileSync(path.join(TARGET_ROOT, 'background-agent.js'), 'utf8');
  const sysMd = fs.readFileSync(path.join(TARGET_ROOT, 'system.md'), 'utf8');

  const requests = [];
  const sandbox = {
    console,
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
        getURL: (p) => `chrome-extension://sw-test/${p}`,
        sendMessage: () => Promise.resolve()
      },
      storage: {
        local: {
          get: async (keys) => {
            const store = {
              agentMemory: [],
              domainPreset: 'law',
              customDomainRules: 'Verify $& statute carefully.',
              crossValidationEnabled: true,
              crossValidationThreshold: 80
            };
            const out = {};
            for (const k of (Array.isArray(keys) ? keys : [])) {
              if (k in store) out[k] = store[k];
            }
            return out;
          },
          set: async () => {}
        },
        sync: {
          get: async () => ({})
        }
      }
    }
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.fetch = async (url, init) => {
    if (String(url).endsWith('system.md')) {
      return { ok: true, status: 200, text: async () => sysMd };
    }
    const parsed = JSON.parse(init.body);
    requests.push({ url: String(url), body: parsed });
    const respText = '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index><confidence>75</confidence><explanation>Law rule</explanation></answer></quiz_answers>';
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return {
        ok: true,
        status: 200,
        headers: null,
        json: async () => ({ candidates: [{ content: { parts: [{ text: respText }] } }] })
      };
    }
    return {
      ok: true,
      status: 200,
      headers: null,
      json: async () => ({ choices: [{ message: { content: respText } }] })
    };
  };

  vm.createContext(sandbox);
  vm.runInContext('class ServiceWorkerGlobalScope {} Object.setPrototypeOf(self, ServiceWorkerGlobalScope.prototype);', sandbox);
  vm.runInContext(providersSrc, sandbox, { filename: 'providers.js' });
  vm.runInContext(agentSrc, sandbox, { filename: 'background-agent.js' });

  assert.equal(typeof sandbox.self.BackgroundAgent.solve, 'function');

  // Task omits syncConfig and passes domainPreset & crossValidationEnabled in settings,
  // forcing storage hydration for customDomainRules & crossValidationThreshold (80).
  const res = await sandbox.self.BackgroundAgent.solve({
    questions: [{
      index: 1,
      type: 'radio',
      text: 'Which rule applies?',
      options: [{ text: 'Rule 1' }, { text: 'Rule 2' }]
    }],
    config: {
      settings: { selectedProvider: 'groq', domainPreset: 'auto', crossValidationEnabled: true },
      apiKeys: { groqApiKey: 'dummy-groq', geminiApiKey: 'dummy-gemini' }
    }
  });

  assert.equal(res.success, true);
  assert.equal(res.answers.length, 1);
  // Confidence 75 < hydrated threshold 80 -> cross-validation must have run on gemini
  assert.equal(requests.length, 2, 'must run primary groq + secondary gemini cross-validation');
  const groqSysMsg = requests[0].body.messages.find(m => m.role === 'system').content;
  assert.ok(groqSysMsg.includes('Verify $& statute carefully.'), 'hydrated customDomainRules with $& must appear in system prompt');
  assert.ok(!groqSysMsg.includes('{{domain_rules}}'));
  assert.ok(requests[1].url.includes('generativelanguage.googleapis.com'), 'secondary provider must be distinct (gemini)');
  assert.equal(res.answers[0].crossValidated, true);
  assert.equal(res.answers[0].crossValidationStatus, 'confirmed');
  assert.equal(res.answers[0].confidence, 87);

  // Fast Path regression: uppercase selectedProvider ('GROQ') is normalized and confidence=0 escalates to Agent Path
  let callIdx = 0;
  sandbox.fetch = async (url) => {
    if (String(url).endsWith('system.md')) {
      return { ok: true, status: 200, text: async () => sysMd };
    }
    callIdx++;
    const xml = callIdx === 1
      ? '<quiz_answers><answer question_id="1" type="radio"><option_index>1</option_index><confidence>0</confidence><explanation>Guess</explanation></answer></quiz_answers>'
      : '<quiz_answers><answer question_id="1" type="radio"><option_index>2</option_index><confidence>90</confidence><explanation>Verified</explanation></answer></quiz_answers>';
    return {
      ok: true,
      status: 200,
      headers: null,
      json: async () => ({ choices: [{ message: { content: xml } }] })
    };
  };

  const fastEscalateRes = await sandbox.self.BackgroundAgent.solve({
    questions: [{
      index: 1,
      type: 'radio',
      text: '2+2?',
      options: [{ text: '3' }, { text: '4' }]
    }],
    config: {
      settings: { selectedProvider: '  GROQ ', crossValidationEnabled: false },
      apiKeys: { groqApiKey: 'dummy-groq' }
    }
  });
  assert.equal(fastEscalateRes.success, true);
  assert.ok(callIdx >= 2, 'confidence=0 in Fast Path must escalate to Agent Path instead of coercing 0 || 50 -> 50');
  assert.equal(fastEscalateRes.answers[0].confidence, 90);
});
