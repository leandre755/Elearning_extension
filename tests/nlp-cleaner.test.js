'use strict';
// Behavioral & edge-case tests for nlp-cleaner.js & settings.js/html
// (R-TECH-01 NLP pipeline, F-CTX-04 multi-format import, and Wave 1/2 settings persistence).
// Zero external dependencies — Node 26 node:test + node:assert/strict.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TARGET_ROOT = process.env.TEST_TARGET_ROOT
  ? path.resolve(process.env.TEST_TARGET_ROOT)
  : path.resolve(__dirname, '..');

const NLPCleaner = require(path.join(TARGET_ROOT, 'nlp-cleaner.js'));

// ===========================================================================
// R-TECH-01: NLP Cleaning Pipeline
// ===========================================================================

test('R-TECH-01: normalizeTypography converts CRLF/CR to LF, applies NFKC ligature normalization, and strips zero-width/control chars', () => {
  // \uFB01 is the 'fi' ligature (-> 'fi' under NFKC), \u200B is zero-width space, \uFEFF is BOM
  const raw = '\uFEFFDé\uFB01nition\u200B du cours\r\nLigne 2\rLigne 3\x00\x07';
  const res = NLPCleaner.cleanText(raw);
  assert.equal(res.text, 'Définition du cours\nLigne 2\nLigne 3');
  assert.equal(res.stats.originalChars, raw.length);
  assert.equal(res.stats.cleanedChars, res.text.length);
  assert.ok(res.stats.reductionRatio > 0);
});

test('R-TECH-01: dehyphenate rejoins line-broken words while preserving legitimate compound words', () => {
  const input = [
    'Un algo-',
    'rithme et une archi-',
    'tecture multi-',
    'cou-',
    'che.',
    'Un système well-',
    'known en temps réel avec Jean-',
    'Pierre et UTF-',
    '8 ou e-',
    'learning et sous-',
    'ensemble.'
  ].join('\n');

  const { text } = NLPCleaner.cleanText(input);
  assert.ok(text.includes('algorithme'), `expected algorithme in: ${text}`);
  assert.ok(text.includes('architecture'), `expected architecture in: ${text}`);
  assert.ok(text.includes('multicouche'), `expected multicouche in: ${text}`);
  assert.ok(text.includes('well-known'), `expected well-known preserved in: ${text}`);
  assert.ok(text.includes('Jean-Pierre'), `expected Jean-Pierre preserved in: ${text}`);
  assert.ok(text.includes('UTF-8'), `expected UTF-8 preserved in: ${text}`);
  assert.ok(text.includes('e-learning'), `expected e-learning preserved in: ${text}`);
  assert.ok(text.includes('sous-ensemble'), `expected sous-ensemble preserved in: ${text}`);
});

test('R-TECH-01: strips repeated headers/footers across pages, standalone page numbers, and TOC dot-leaders while keeping list items', () => {
  const page1 = [
    'Université Paris - Cours Bio 101',
    'Table des matières',
    'Chapitre 1 : Introduction .................... 1',
    'Chapitre 2 : Métabolisme . . . . . . . . . . 14',
    'La cellule possède une membrane plasmique.',
    '- Premier point essentiel',
    '- Deuxième point essentiel',
    '1. Étape A',
    '2. Étape B',
    'Page 1 / 3',
    '© Tous droits réservés 2026'
  ].join('\n');

  const page2 = [
    'Université Paris - Cours Bio 101',
    'Le cycle de Krebs produit de l’ATP dans la mitochondrie.',
    '3 / 3',
    '© Tous droits réservés 2026'
  ].join('\n');

  const page3 = [
    'Université Paris - Cours Bio 101',
    'La glycolyse a lieu dans le cytoplasme.',
    '- 3 -',
    'Page 4',
    '© Tous droits réservés 2026'
  ].join('\n');

  const doc = `${page1}\f${page2}\f${page3}`;
  const { text, stats } = NLPCleaner.cleanText(doc);

  // Repeated headers & footers must be stripped
  assert.ok(!text.includes('Université Paris - Cours Bio 101'), 'repeated header must be stripped');
  assert.ok(!text.includes('Tous droits réservés'), 'repeated footer must be stripped');

  // TOC dot-leaders must be stripped
  assert.ok(!text.includes('.....'), 'TOC dot-leaders must be stripped');
  assert.ok(!text.includes('. . . .'), 'spaced TOC dot-leaders must be stripped');

  // Standalone page numbers must be stripped
  assert.ok(!/^Page 1 \/ 3$/m.test(text));
  assert.ok(!/^3 \/ 3$/m.test(text));
  assert.ok(!/^- 3 -$/m.test(text));
  assert.ok(!/^Page 4$/m.test(text));

  // Core content and list structure must be preserved
  assert.ok(text.includes('La cellule possède une membrane plasmique.'));
  assert.ok(text.includes('Le cycle de Krebs produit'));
  assert.ok(text.includes('La glycolyse a lieu dans le cytoplasme.'));
  assert.ok(text.includes('- Premier point essentiel'));
  assert.ok(text.includes('1. Étape A'));
  assert.ok(stats.removedLines >= 8);
  assert.ok(stats.reductionRatio > 0.2);
});

test('R-TECH-01 negative control: empty, non-string, or clean prose with repeated quiz answers ("Vrai"/"Faux") is not corrupted', () => {
  assert.deepEqual(NLPCleaner.cleanText(''), {
    text: '',
    stats: { originalChars: 0, cleanedChars: 0, removedLines: 0, reductionRatio: 0 }
  });
  assert.equal(NLPCleaner.cleanText(null).text, '');

  // Protected short tokens like Vrai / Faux repeated >= 3 times must NOT be stripped as headers!
  const quizAnswers = ['Question 1', 'Vrai', '', 'Question 2', 'Vrai', '', 'Question 3', 'Vrai'].join('\n');
  const cleaned = NLPCleaner.cleanText(quizAnswers).text;
  assert.equal((cleaned.match(/Vrai/g) || []).length, 3, 'protected short tokens Vrai must not be stripped');
});

// ===========================================================================
// F-CTX-04: Multi-Format Parsing (HTML & CSV)
// ===========================================================================

test('F-CTX-04: extractTextFromHTML strips script/style/noscript/svg/template safely and decodes entities', () => {
  const maliciousHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Ignored</title>
        <style>body { display: none; }</style>
        <script>window.__pwned = true; alert("xss");</script>
      </head>
      <body>
        <h1>Chapitre 1 &amp; 2</h1>
        <p>Formule : x &lt; y &gt; z &quot;ok&quot; &#169; &#x20AC;</p>
        <noscript>Enable JS</noscript>
        <svg><text>SVG NOISE</text></svg>
        <template><div>TEMPLATE NOISE</div></template>
        <table><tr><th>Clé</th><th>Valeur</th></tr><tr><td>A</td><td>42</td></tr></table>
      </body>
    </html>
  `;

  const extracted = NLPCleaner.extractTextFromHTML(maliciousHtml);
  const { text } = NLPCleaner.cleanText(extracted);

  assert.ok(!text.includes('alert') && !text.includes('__pwned'), 'script content must be stripped');
  assert.ok(!text.includes('display: none'), 'style content must be stripped');
  assert.ok(!text.includes('Enable JS'), 'noscript content must be stripped');
  assert.ok(!text.includes('SVG NOISE'), 'svg content must be stripped');
  assert.ok(!text.includes('TEMPLATE NOISE'), 'template content must be stripped');
  assert.ok(text.includes('Chapitre 1 & 2'));
  assert.ok(text.includes('Formule : x < y > z "ok" © €'));
  assert.ok(text.includes('Clé') && text.includes('Valeur'));
  assert.ok(text.includes('A') && text.includes('42'));
});

test('F-CTX-04: parseCSV parses quoted fields, escaped quotes (""), embedded commas/newlines, and semicolon CSVs', () => {
  const csv = [
    'Question,Réponse,Notes',
    '"Capitale de la France, UE","Paris, ""Ville Lumière""",OK',
    '2 + 2,4,"Ligne 1\nLigne 2"'
  ].join('\r\n');

  const parsed = NLPCleaner.parseCSV(csv);
  const lines = parsed.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'Question | Réponse | Notes');
  assert.equal(lines[1], 'Capitale de la France, UE | Paris, "Ville Lumière" | OK');
  assert.equal(lines[2], '2 + 2 | 4 | Ligne 1 Ligne 2');

  // Auto-detected semicolon CSV
  const semiCsv = 'Terme;Définition\nMitose;"Division cellulaire; phase M"';
  assert.equal(
    NLPCleaner.parseCSV(semiCsv),
    'Terme | Définition\nMitose | Division cellulaire; phase M'
  );
});

test('Settings wiring: settings.html loads nlp-cleaner.js & course-media.js before settings.js and exposes all required Wave 1/2 controls', () => {
  const html = fs.readFileSync(path.join(TARGET_ROOT, 'settings.html'), 'utf8');
  const nlpIdx = html.indexOf('<script src="nlp-cleaner.js"></script>');
  const mediaIdx = html.indexOf('<script src="course-media.js"></script>');
  const settingsIdx = html.indexOf('<script src="settings.js"></script>');
  assert.ok(nlpIdx > 0 && settingsIdx > nlpIdx, 'nlp-cleaner.js must be loaded before settings.js in settings.html');
  assert.ok(mediaIdx > 0 && settingsIdx > mediaIdx, 'course-media.js must be loaded before settings.js in settings.html');
  assert.match(html, /accept="\.pdf,\.docx,\.txt,\.md,\.html,\.htm,\.csv,\.png,\.jpg,\.jpeg,\.webp,\.gif,image\/png,image\/jpeg,image\/webp,image\/gif"/);
  assert.doesNotMatch(html, /accept="[^"]*\.svg/i);

  for (const id of [
    'domainPreset',
    'customDomainRules',
    'crossValidationEnabled',
    'crossValidationThreshold',
    'autoSubmitEnabled',
    'autoSubmitMinConfidence',
    'autoSubmitDelayMs',
    'passiveNetworkIntercept'
  ]) {
    assert.ok(html.includes(`id="${id}"`), `settings.html must contain control #${id}`);
  }
});

// ===========================================================================
// Regressions from ANTIBUG Lot 1 Audit (all 7 findings)
// ===========================================================================

test('Regression: dehyphenate scales linearly O(N) on 400KB+ text without blocking UI thread', () => {
  const bigDoc = ('Chapitre 1 : Introduction aux algo-\nrithmes modernes et optimi-\nsations numériques. '.repeat(3) + '\n').repeat(1600);
  const t0 = Date.now();
  const out = NLPCleaner.dehyphenate(bigDoc);
  const elapsedMs = Date.now() - t0;
  assert.ok(out.includes('algorithmes') && out.includes('optimisations'));
  assert.ok(elapsedMs < 1500, `dehyphenate took ${elapsedMs}ms on 405KB (expected < 1500ms linear)`);
});

test('Regression: valid consecutive quiz options, equations, headings, and numbered answers are never stripped as headers', () => {
  const cases = [
    'Question 1 : Quelle est la probabilité ?\n- Probabilité : 1/2\n- Probabilité : 1/4\n- Probabilité : 3/4',
    'Valeurs possibles :\nx = -1\nx = -2\nx = -3',
    '1 - Vrai\n2 - Vrai\n3 - Vrai',
    'État : P1\nÉtat : P2\nÉtat : P3',
    '### Propriété\nA\n### Propriété\nB\n### Propriété\nC'
  ];
  for (const input of cases) {
    const out = NLPCleaner.cleanText(input).text;
    for (const line of input.split('\n')) {
      assert.ok(out.includes(line), `valid line "${line}" was wrongly stripped from:\n${out}`);
    }
  }
});

test('Regression: NFKC ellipsis (…) and fill-in-the-blank underscores (____) are not stripped as TOC lines', () => {
  const input = [
    'Les nombres premiers : 2, 3, 5, 7\u2026 11',
    'La suite des entiers 1, 2, 3... 10',
    'Soit la suite x1, x2, ... m',
    'Complétez la formule : 2 + 2 = ____ 4'
  ].join('\n');
  const out = NLPCleaner.cleanText(input).text;
  assert.equal(out.split('\n').length, 4, `expected all 4 lines kept, got:\n${out}`);
  assert.ok(out.includes('2 + 2 = ____ 4'));
});

test('Regression: dehyphenate checks corpus evidence first and does not mangle common French/English suffixes', () => {
  const input = 'Une function et une functi-\non, une questi-\non, de l oxyg-\nen, de l energ-\ny,\nune méthode actu-\nelle, un cas séri-\neux, un citoy-\nen, des comm-\nunes, un foss-\nil, dit-\nil.';
  const out = NLPCleaner.dehyphenate(input);
  for (const expected of ['function', 'question', 'oxygen', 'energy', 'actuelle', 'sérieux', 'citoyen', 'communes', 'fossil', 'dit-il']) {
    assert.ok(out.includes(expected), `expected "${expected}" in: ${out}`);
  }
});

test('Regression: parseCSV handles UTF-8 BOM and multiline quoted headers with semicolon delimiter', () => {
  const bomCsv = '\uFEFF"Capitale de la France, UE","Paris, ""Ville Lumière"""\r\n"2 + 2","4"';
  assert.equal(
    NLPCleaner.parseCSV(bomCsv),
    'Capitale de la France, UE | Paris, "Ville Lumière"\n2 + 2 | 4'
  );

  const multilineSemi = '"Question\n(obligatoire)";"Réponse"\n"Quelle est la capitale ?";"Paris"';
  assert.equal(
    NLPCleaner.parseCSV(multilineSemi),
    'Question (obligatoire) | Réponse\nQuelle est la capitale ? | Paris'
  );
});

test('Regression: extractTextFromHTML fallback strips unclosed dangerous tags and HTML5 closing tags with trailing chars', () => {
  const unclosed = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p>Cours</p><script>alert(1)')).text;
  assert.equal(unclosed, 'Cours');

  const trailingClose = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p>Cours</p><script>alert(1)</script foo><p>Fin</p>')).text;
  assert.ok(!trailingClose.includes('alert'));
  assert.equal(trailingClose, 'Cours\n\nFin');
});

test('Regression: settings.js extractTextFromPDF cleans up page and destroys PDF document/loadingTask in finally', () => {
  const src = fs.readFileSync(path.join(TARGET_ROOT, 'settings.js'), 'utf8');
  const start = src.indexOf('async function extractTextFromPDF');
  const end = src.indexOf('async function extractTextFromDOCX');
  assert.ok(start >= 0 && end > start);
  const body = src.slice(start, end);
  assert.match(body, /page\.cleanup\(\)/, 'extractTextFromPDF must call page.cleanup()');
  assert.match(body, /pdf\.destroy\(\)/, 'extractTextFromPDF must call pdf.destroy()');
  assert.match(body, /loadingTask\.destroy\(\)/, 'extractTextFromPDF must call loadingTask.destroy() on early failure');
});

test('Regression (re-audit): standalone fractions, repeated plain quiz options, multi-hyphen compounds, CSV edge cases, and O(N) HTML scanner', () => {
  // 1. Standalone math fractions & blood pressure outside \f page boundaries
  const fracInput = 'Question 1 : Probabilité de pile ?\n1/2\n1/3\n1/4\n3/4\nQuestion 2 : Tension normale ?\n120/80\nQuestion 3 : Approximation de pi ?\n22/7';
  const fracOut = NLPCleaner.cleanText(fracInput).text;
  for (const ans of ['1/2', '1/3', '1/4', '3/4', '120/80', '22/7']) {
    assert.ok(fracOut.includes(ans), `fraction/value "${ans}" must not be stripped: ${fracOut}`);
  }
  const htmlFrac = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p>Quelle fraction ?</p><ul><li>1/2</li><li>1/4</li><li>3/4</li></ul>')).text;
  assert.ok(htmlFrac.includes('1/2') && htmlFrac.includes('1/4') && htmlFrac.includes('3/4'));

  // 2. Repeated plain quiz options without bullets/prefixes
  const plainOpts = [
    'Question 1 : Résoudre x^2 = 0', 'x = 0', 'Toutes les réponses ci-dessus', 'Paris', '',
    'Question 2 : Résoudre 2x = 0', 'x = 0', 'Toutes les réponses ci-dessus', 'Paris', '',
    'Question 3 : Résoudre 3x = 0', 'x = 0', 'Toutes les réponses ci-dessus', 'Paris'
  ].join('\n');
  const plainOut = NLPCleaner.cleanText(plainOpts).text;
  assert.equal((plainOut.match(/^Toutes les réponses ci-dessus$/gm) || []).length, 3);
  assert.equal((plainOut.match(/^x = 0$/gm) || []).length, 3);

  // 3. Multi-hyphen & apostrophe compounds wrapped at first hyphen
  assert.equal(NLPCleaner.dehyphenate("chef-\nd'œuvre"), "chef-d'œuvre");
  assert.equal(NLPCleaner.dehyphenate("c'est-\nà-dire"), "c'est-à-dire");
  assert.equal(NLPCleaner.dehyphenate('up-\nto-date'), 'up-to-date');
  assert.equal(NLPCleaner.dehyphenate('end-\nto-end'), 'end-to-end');
  assert.equal(NLPCleaner.dehyphenate('vis-\nà-vis'), 'vis-à-vis');
  assert.equal(NLPCleaner.dehyphenate('up-\nto-\ndate'), 'up-to-date');
  assert.equal(NLPCleaner.dehyphenate('state-\nof-the-art'), 'state-of-the-art');

  // 4. CSV mid-field quote & header-with-comma semicolon CSV
  assert.equal(
    NLPCleaner.parseCSV('Ecran 24";Prix;Stock\nClavier;50;10\nSouris;20;30'),
    'Ecran 24" | Prix | Stock\nClavier | 50 | 10\nSouris | 20 | 30'
  );
  assert.equal(
    NLPCleaner.parseCSV("Question (A, B, ou C);Réponse\nCapitale de la France;Paris\nCapitale de l'Italie;Rome\nCapitale de l'Espagne;Madrid"),
    "Question (A, B, ou C) | Réponse\nCapitale de la France | Paris\nCapitale de l'Italie | Rome\nCapitale de l'Espagne | Madrid"
  );

  // 5. HTML5 <script/> non-self-closing + O(N) unclosed comments/tags
  const fakeSelfClose = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p>Cours</p><script/>alert(1)</script><p>Fin</p>')).text;
  assert.ok(!fakeSelfClose.includes('alert'), `fake <script/> must not leak body: ${fakeSelfClose}`);
  assert.equal(fakeSelfClose, 'Cours\n\nFin');

  const t0 = Date.now();
  NLPCleaner.extractTextFromHTML('<!--'.repeat(25000) + 'text');
  NLPCleaner.extractTextFromHTML('<div '.repeat(20000));
  const htmlMs = Date.now() - t0;
  assert.ok(htmlMs < 500, `HTML fallback scanner took ${htmlMs}ms on 200KB adversarial input (expected < 500ms)`);
});

test('Regression (pass 3): O(N) unbroken tokens/apostrophes, multi-page fraction options, CSV consistency, literal <, nested svg/template, 4-part compounds', () => {
  // 1. O(N) on long unbroken tokens and repeated apostrophes
  const t0 = Date.now();
  assert.equal(NLPCleaner.dehyphenate('a'.repeat(40000)).length, 40000);
  assert.equal(NLPCleaner.dehyphenate("'".repeat(20000)).length, 20000);
  assert.ok(Date.now() - t0 < 500, 'dehyphenate must stay O(N) on long unbroken tokens/apostrophes');

  // 2. Multi-page PDF ending with fraction options preserves all 9 fractions
  const p1 = ['Header', 'Line 1', 'Line 2', 'Line 3', 'Line 4', 'Q1?', '1/2', '1/4', '3/4'].join('\n');
  const p2 = ['Header', 'Line 1', 'Line 2', 'Line 3', 'Line 4', 'Q2?', '2/3', '1/3', '5/6'].join('\n');
  const p3 = ['Header', 'Line 1', 'Line 2', 'Line 3', 'Line 4', 'Q3?', '1/5', '2/5', '4/5'].join('\n');
  const multiPdf = NLPCleaner.cleanText(`${p1}\f${p2}\f${p3}`).text;
  for (const frac of ['1/2', '1/4', '3/4', '2/3', '1/3', '5/6', '1/5', '2/5', '4/5']) {
    assert.ok(multiPdf.includes(frac), `fraction "${frac}" was wrongly stripped from multi-page PDF`);
  }

  // 3. European semicolon CSV with decimal commas + space before quoted fields
  const euCsv = 'Question;Réponse\nQuelle est la valeur de pi (3,14 ou 3,15) ?;3,14\nCombien vaut 1,5 + 2,5 ?;4,0';
  assert.equal(
    NLPCleaner.parseCSV(euCsv),
    'Question | Réponse\nQuelle est la valeur de pi (3,14 ou 3,15) ? | 3,14\nCombien vaut 1,5 + 2,5 ? | 4,0'
  );
  assert.equal(
    NLPCleaner.parseCSV('Q, "A, B", C\n1, "2, 3", 4'),
    'Q | A, B | C\n1 | 2, 3 | 4'
  );

  // 4. Literal '<' in HTML fallback (math inequalities + O(N) on '< '.repeat(160000))
  assert.equal(NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p>If x < 5 and y > 3, solve</p>')).text, 'If x < 5 and y > 3, solve');
  assert.equal(NLPCleaner.extractTextFromHTML('If x < 5'), 'If x < 5');
  const t1 = Date.now();
  NLPCleaner.extractTextFromHTML('< '.repeat(160000) + '>');
  assert.ok(Date.now() - t1 < 500, 'extractTextFromHTML must stay O(N) on 320KB literal <');

  // 5. Nested <template> and <svg> must not leak inner content
  const nestedTpl = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<template><div><template>inner</template>LEAKED_TEMPLATE</div></template><p>OK</p>')).text;
  assert.equal(nestedTpl, 'OK');
  const nestedSvg = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<svg><svg></svg><text>LEAKED_SVG</text></svg><p>OK</p>')).text;
  assert.equal(nestedSvg, 'OK');

  // 6. 4+ part multi-line compounds
  assert.equal(NLPCleaner.dehyphenate('state-\nof-\nthe-\nart'), 'state-of-the-art');
  assert.equal(NLPCleaner.dehyphenate('out-\nof-\nthe-\nbox'), 'out-of-the-box');
  assert.equal(NLPCleaner.dehyphenate('au-\nfur-\net-\nà-\nmesure'), 'au-fur-et-à-mesure');
});

test('Regression (pass 4): O(N) nested svg/template/script, bare numeric quiz options, quoted > in HTML attrs, null options', () => {
  // 1. O(N) on 20k nested <svg>/<template> and unclosed </script
  const t0 = Date.now();
  assert.equal(NLPCleaner.extractTextFromHTML('<svg>'.repeat(20000) + '</svg>').trim(), '');
  assert.equal(NLPCleaner.extractTextFromHTML('<template>'.repeat(20000) + '</template>').trim(), '');
  assert.equal(NLPCleaner.extractTextFromHTML('<script>' + '</script '.repeat(20000)).trim(), '');
  assert.ok(Date.now() - t0 < 500, 'nested svg/template/script scanner must stay O(N)');

  // 2. Numeric quiz options / years in multi-page PDF must NOT be stripped as page numbers
  const numPdf = [
    'Question 1 : Combien vaut 20 + 22 ?\n10\n20\n42',
    'Question 2 : Année de la Révolution ?\n1789\n1815\n1914',
    'Question 3 : Combien vaut 0 * 5 ?\n5\n1\n0'
  ].join('\f');
  const numOut = NLPCleaner.cleanText(numPdf).text;
  for (const val of ['42', '1914', '0', '1789']) {
    assert.ok(numOut.includes(val), `numeric option "${val}" was wrongly stripped: ${numOut}`);
  }

  // 3. Quoted '>' inside HTML attributes must not prematurely close tags
  const svgAttr = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<svg data-x="a/>">LEAKED_SVG</svg><p>OK</p>')).text;
  assert.equal(svgAttr, 'OK');
  const pAttr = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p title="x > 0">Hello</p>')).text;
  assert.equal(pAttr, 'Hello');

  // 4. Null options must not throw
  assert.equal(NLPCleaner.cleanText('hello', null).text, 'hello');
  assert.equal(NLPCleaner.stripHeadersAndFooters('hello', null), 'hello');
  assert.equal(NLPCleaner.parseCSV('a,b', null), 'a | b');
});

test('Regression (pass 5): unquoted apostrophe attrs, attribute-nested svg/template, table pipes, short HTML comments, bare PDF answers, Copyright option, clitic splits', () => {
  // 1. Unquoted HTML5 attribute with apostrophe
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML("<div title=O'Reilly><p>Question 1: What is 2+2?</p></div>")).text,
    'Question 1: What is 2+2?'
  );
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML("<img alt=l'ADN src=x.png><p>Cours</p>")).text,
    'Cours'
  );

  // 2. Attribute-nested </svg> and <template>
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<svg><g data-x="</svg>">LEAKED_SVG</g></svg><p>OK</p>')).text,
    'OK'
  );
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<template><div title="<template>">secret</div></template><p>VISIBLE</p>')).text,
    'VISIBLE'
  );

  // 3. Table cells emit single separator pipe only on closing tag
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<table><tr><th>Clé</th><th>Valeur</th></tr><tr><td>A</td><td>42</td></tr></table>')).text,
    'Clé | Valeur\n\nA | 42'
  );

  // 4. HTML5 short comments <!--> and <!--->
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p>Before</p><!--><p>After</p><!---><p>End</p>')).text,
    'Before\n\nAfter\n\nEnd'
  );

  // 5. Bare single-number quiz answers in multi-page PDF are preserved
  const pdf5 = [
    'Intro\nPage de garde\nCours de géométrie',
    'Question 2 : Combien de côtés a un carré ?\nRéponse :\n4',
    'Question 3 : Combien de côtés a un triangle ?\nRéponse :\n3',
    'Question 4 : Combien de côtés a un pentagone ?\nRéponse :\n5',
    'Conclusion\nFin du chapitre\nExercices'
  ].join('\f');
  const pdf5Out = NLPCleaner.cleanText(pdf5).text;
  assert.ok(pdf5Out.includes('Réponse :\n4') && pdf5Out.includes('Réponse :\n3') && pdf5Out.includes('Réponse :\n5'));

  // 6. Bare "Copyright" quiz option & long plain-text repeated quiz options preserved
  const lawQuiz = [
    'Question 1\nBrevet\nCopyright\nMarque',
    'Question 2\nBrevet\nCopyright\nMarque',
    'Question 3\nBrevet\nCopyright\nMarque'
  ].join('\n\n');
  assert.equal((NLPCleaner.cleanText(lawQuiz).text.match(/^Copyright$/gm) || []).length, 3);

  const longQuizBlock = (i) => [
    `Question ${i} : Enoncé détaillé`,
    ...Array.from({ length: 12 }, (_, k) => `Ligne de contexte ${i}.${k}`),
    'Option A',
    'Toutes les réponses ci-dessus',
    'Option C'
  ].join('\n');
  const longQuiz = [longQuizBlock(1), longQuizBlock(2), longQuizBlock(3)].join('\n\n');
  assert.equal((NLPCleaner.cleanText(longQuiz).text.match(/^Toutes les réponses ci-dessus$/gm) || []).length, 3);

  // 7. Common French/English words ending in être / ils / lui de-hyphenated properly
  for (const [broken, expected] of [
    ['fen-\nêtre', 'fenêtre'],
    ['anc-\nêtre', 'ancêtre'],
    ['pr-\nêtre', 'prêtre'],
    ['ce-\nlui', 'celui'],
    ['out-\nils', 'outils'],
    ['conse-\nils', 'conseils'],
    ['appare-\nils', 'appareils'],
    ['foss-\nils', 'fossils'],
    ['peut-\nêtre', 'peut-être'],
    ['bien-\nêtre', 'bien-être']
  ]) {
    assert.equal(NLPCleaner.dehyphenate(broken), expected);
  }
});

test('Regression (pass 6): Unicode İ HTML offsets, raw-text inside template, PDF fraction edge guards, SVG self-closing, --!> comment, curly apostrophe', () => {
  // 1. Turkish İ (U+0130) case-expansion must not shift HTML tag/script offsets
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p>İstanbul</p><script>alert(1)</script><p>Fin</p>')).text,
    'İstanbul\n\nFin'
  );
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML(`<p>Intro</p><script>var s = "${'İ'.repeat(20)}";</script><p>IMPORTANT QUESTION</p>`)).text,
    'Intro\n\nIMPORTANT QUESTION'
  );

  // 2. Raw-text <script>/<style> inside <template>
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<template><script>var s = "</template>"; alert(1);</script>SECRET</template><p>OK</p>')).text,
    'OK'
  );
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<template><script>var s = "<template>";</script></template><p>VISIBLE QUESTION</p>')).text,
    'VISIBLE QUESTION'
  );
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<template><style>/* </template> */ body { display: none; }</style>SECRET</template><p>OK</p>')).text,
    'OK'
  );

  // 3. Multi-page PDF fraction answers after prompt or as sole page content
  const probPdf = [
    'Cours de probabilités\nChapitre 1 : Introduction\nDéfinition de la probabilité.',
    'Question 1 : Probabilité de deux piles consécutifs ?\nRéponse :\n1/4',
    'Question 2 : Probabilité d au moins un pile ?\nRéponse :\n3/4',
    'Conclusion\nFin du cours\nBon courage'
  ].join('\f');
  const probOut = NLPCleaner.cleanText(probPdf).text;
  assert.ok(probOut.includes('Réponse :\n1/4') && probOut.includes('Réponse :\n3/4'));
  const soleFrac = NLPCleaner.cleanText(['Header\n1/3\nFooter', 'Header\nContent page 2\nFooter', 'Header\nContent page 3\nFooter'].join('\f')).text;
  assert.ok(soleFrac.includes('1/3'));

  // 4. HTML5 <svg> self-closing edge cases (unquoted URL ending in / and spaced / >)
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<svg xmlns=http://www.w3.org/2000/svg/><text>LEAKED_SVG</text></svg><p>OK</p>')).text,
    'OK'
  );
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<svg / ><text>LEAKED_SVG</text></svg><p>OK</p>')).text,
    'OK'
  );
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<svg><svg href=https://example.com/></svg><text>LEAKED_SVG</text></svg><p>OK</p>')).text,
    'OK'
  );

  // 5. HTML5 --!> comment terminator
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p>Before</p><!-- comment --!><p>IMPORTANT QUESTION</p>')).text,
    'Before\n\nIMPORTANT QUESTION'
  );

  // 6. Typographic curly apostrophe in French compound dehyphenation
  assert.equal(NLPCleaner.dehyphenate('chef-\nd\u2019œuvre'), 'chef-d\u2019œuvre');
});

test('Regression (pass 7): O(N) comments, foreign self-closing SVG script, SVG CDATA, Copyright Law/Page N: quiz lines, CSV dehyphenate:false', () => {
  // 1. O(N) skipComment on 15,000 standard comments
  const t0 = Date.now();
  assert.equal(NLPCleaner.extractTextFromHTML('<!-- c -->'.repeat(15000)).trim(), '');
  assert.ok(Date.now() - t0 < 500, 'skipComment must stay O(N) on 15k comments');

  // 2. Self-closing foreign <script/> inside <svg>
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<svg><script href="icon.js"/><rect/></svg><p>IMPORTANT QUESTION</p>')).text,
    'IMPORTANT QUESTION'
  );

  // 3. <![CDATA[...]]> inside <svg>
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<svg><desc><![CDATA[ a > b </svg> ]]></desc><text>SECRET_SVG</text></svg><p>OK</p>')).text,
    'OK'
  );

  // 4. "Copyright Law" quiz option and "Page N : valide" quiz lines preserved
  const q = ['Q1', 'Patent Law', 'Copyright Law', 'Trademark Law', '', 'Q2', 'Patent Law', 'Copyright Law', 'Trademark Law', '', 'Q3', 'Patent Law', 'Copyright Law', 'Trademark Law'].join('\n');
  assert.equal((NLPCleaner.cleanText(q).text.match(/^Copyright Law$/gm) || []).length, 3);
  const pageTable = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p>Question 1 : Table des pages</p><p>Page 0 : valide</p><p>Page 1 : valide</p><p>Page 2 : valide</p>')).text;
  assert.ok(pageTable.includes('Page 0 : valide') && pageTable.includes('Page 1 : valide') && pageTable.includes('Page 2 : valide'));

  // 5. CSV records ending in '-' must not be merged across rows when dehyphenate:false
  const csvChem = 'Question,Réponse\nIon hydroxyde,OH-\npH neutre,7\nIon chlorure,Cl-\nIon sodium,Na+';
  const cleanedCsv = NLPCleaner.cleanText(NLPCleaner.parseCSV(csvChem), { dehyphenate: false }).text;
  assert.equal(cleanedCsv, 'Question | Réponse\nIon hydroxyde | OH-\npH neutre | 7\nIon chlorure | Cl-\nIon sodium | Na+');
});

test('Regression (pass 8): <svg> inside <template>, prose "page N" quiz options, pretty-printed HTML tables', () => {
  // 1. <svg> inside <template>: self-closing <script/> and CDATA with </template>
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<template><svg><script href="icon.js"/></svg></template><p>IMPORTANT QUESTION</p>')).text,
    'IMPORTANT QUESTION'
  );
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<template><svg><desc><![CDATA[ a > </template> ]]></desc></svg>SECRET</template><p>OK</p>')).text,
    'OK'
  );

  // 2. Prose "page N" options in HTML/MD preserved
  const lru = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p>Question 1 : Dans LRU, quelle page est évincée ?</p><p>La page 1</p><p>La page 2</p><p>La page 3</p>')).text;
  assert.ok(lru.includes('La page 1') && lru.includes('La page 2') && lru.includes('La page 3'));
  const pt = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p>Question 1 : Table des pages</p><p>Page 0 est valide</p><p>Page 1 est valide</p><p>Page 2 est valide</p>')).text;
  assert.ok(pt.includes('Page 0 est valide') && pt.includes('Page 1 est valide') && pt.includes('Page 2 est valide'));
  const voir = NLPCleaner.cleanText('Question 1\n\nVoir page 12\n\nQuestion 2\n\nVoir page 24\n\nQuestion 3\n\nVoir page 36').text;
  assert.ok(voir.includes('Voir page 12') && voir.includes('Voir page 24') && voir.includes('Voir page 36'));

  // 3. Pretty-printed HTML table preserves column pipe separators
  const prettyTable = '<table>\n  <tr>\n    <th>Question</th>\n    <th>Réponse</th>\n  </tr>\n  <tr>\n    <td>Capitale de la France</td>\n    <td>Paris</td>\n  </tr>\n</table>';
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML(prettyTable)).text,
    'Question | Réponse\n\nCapitale de la France | Paris'
  );
});

test('Regression (pass 9): RCDATA <title>/<textarea>, labeled PDF ratios, block/multiline/empty HTML table cells, form-feed tag boundary', () => {
  // 1. HTML5 RCDATA <title> and <textarea>
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<html><head><title>Apprendre <script> en HTML</title></head><body><h1>Cours</h1><p>Question 1 : Paris</p></body></html>')).text,
    'Cours\n\nQuestion 1 : Paris'
  );
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<form><textarea>Exemple: <svg></textarea></form><p>Question 2 : Rome</p>')).text,
    'Exemple: <svg>\n\nQuestion 2 : Rome'
  );

  // 2. Labeled medical/probability ratios at PDF page boundaries are preserved
  const medPdf = [
    'Cours de Médecine\nQuestion 1 : Tension normale ?\nTension : 120/80',
    'Cours de Médecine\nQuestion 2 : Hypertension ?\nTension : 140/90',
    'Cours de Médecine\nQuestion 3 : Hypotension ?\nTension : 90/60'
  ].join('\f');
  const medOut = NLPCleaner.cleanText(medPdf).text;
  assert.ok(medOut.includes('120/80') && medOut.includes('140/90') && medOut.includes('90/60'));

  const probPdf = [
    'Cours de Probabilités\nQuestion 1 : Pile ?\nProbabilité : 1/2',
    'Cours de Probabilités\nQuestion 2 : Double pile ?\nProbabilité : 1/4',
    'Cours de Probabilités\nQuestion 3 : Au moins un pile ?\nProbabilité : 3/4'
  ].join('\f');
  const probOut = NLPCleaner.cleanText(probPdf).text;
  assert.ok(probOut.includes('1/2') && probOut.includes('1/4') && probOut.includes('3/4'));

  // 3. Multiline/block table cells and empty spacer rows
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<table><tr><td><p>Question 1</p></td><td><p>Réponse A</p></td></tr></table>')).text,
    'Question 1 | Réponse A'
  );
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<table>\n  <tr>\n    <td>\n      Question 1\n    </td>\n    <td>\n      Réponse A\n    </td>\n  </tr>\n</table>')).text,
    'Question 1 | Réponse A'
  );
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<table><tr><td></td><td></td><td></td></tr><tr><td>A</td><td>B</td><td>C</td></tr></table>')).text,
    'A | B | C'
  );

  // 4. Form-feed \f as HTML5 tag boundary
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p>OK</p><script\f>alert(1)</script><p>Fin</p>')).text,
    'OK\n\nFin'
  );
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p>OK</p><script>alert(1)</script\f><p>IMPORTANT QUESTION</p>')).text,
    'OK\n\nIMPORTANT QUESTION'
  );
});

test('Regression (pass 10): O(N) compactWhitespace, repeated HTML/MD quiz options preserved, inline tags & definition lists', () => {
  // 1. O(N) compactWhitespace on 50k leading spaces + non-space + 50k trailing spaces
  const t0 = Date.now();
  assert.equal(NLPCleaner.compactWhitespace(' '.repeat(50000) + 'a' + ' '.repeat(50000)), 'a');
  assert.ok(Date.now() - t0 < 500, 'compactWhitespace must stay O(N) on long space runs');

  // 2. Formatted HTML & MD quizzes preserve repeated boilerplate options ("Aucune des réponses", "Toutes les réponses ci-dessus")
  const htmlQuiz = [1, 2, 3].map(n => [
    `<p>Question ${n} : Enoncé de test</p>`,
    '<p>Option A</p>',
    '<p>Option B</p>',
    '<p>Aucune des réponses</p>',
    '<p>Toutes les réponses ci-dessus</p>'
  ].join('\n')).join('\n');
  const htmlOut = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML(htmlQuiz)).text;
  assert.equal((htmlOut.match(/^Aucune des réponses$/gm) || []).length, 3);
  assert.equal((htmlOut.match(/^Toutes les réponses ci-dessus$/gm) || []).length, 3);

  const mdQuiz = [1, 2, 3].map(n => [
    `Question ${n} : Enoncé`,
    'Contexte 1', 'Contexte 2', 'Contexte 3', 'Contexte 4',
    'Option A', 'Aucune des réponses', 'Toutes les réponses ci-dessus'
  ].join('\n\n')).join('\n\n');
  const mdOut = NLPCleaner.cleanText(mdQuiz).text;
  assert.equal((mdOut.match(/^Aucune des réponses$/gm) || []).length, 3);
  assert.equal((mdOut.match(/^Toutes les réponses ci-dessus$/gm) || []).length, 3);

  // 3. Inline HTML tags do not inject spaces; definition lists keep block breaks
  const chem = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<p>L\u2019eau (H<sub>2</sub>O) et CO<sub>2</sub> à 10<sup>-3</sup>; f(x) = x<sup>2</sup>; <em>algo</em>rithme; <strong>Paris</strong>, France.</p>')).text;
  assert.equal(chem, 'L’eau (H2O) et CO2 à 10-3; f(x) = x2; algorithme; Paris, France.');
  const dl = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<dl><dt>Mitose</dt><dd>Division conforme</dd><dt>Méiose</dt><dd>Division réductionnelle</dd></dl>')).text;
  assert.ok(dl.includes('Mitose\n\nDivision conforme') && dl.includes('Méiose\n\nDivision réductionnelle'));
});

test('Regression (pass 11): multi-page negative equations & numbered-dash answers, tabular CSV/HTML rows, &nbsp; table cells', () => {
  // 1. Multi-page PDF with negative equations and numbered-dash answers
  const negPdf = [
    'Question 1 : Résoudre x + 1 = 0\nDéveloppement de la solution\nx = -1',
    'Question 2 : Résoudre x + 2 = 0\nDéveloppement de la solution\nx = -2',
    'Question 3 : Résoudre x + 3 = 0\nDéveloppement de la solution\nx = -3'
  ].join('\f');
  const negOut = NLPCleaner.cleanText(negPdf).text;
  assert.ok(negOut.includes('x = -1') && negOut.includes('x = -2') && negOut.includes('x = -3'));

  const dashPdf = [
    '1 - Vrai\nExplication détaillée page 1\nFin de la question 1',
    '2 - Vrai\nExplication détaillée page 2\nFin de la question 2',
    '3 - Vrai\nExplication détaillée page 3\nFin de la question 3'
  ].join('\f');
  const dashOut = NLPCleaner.cleanText(dashPdf).text;
  assert.ok(dashOut.includes('1 - Vrai') && dashOut.includes('2 - Vrai') && dashOut.includes('3 - Vrai'));

  // 2. Tabular CSV and HTML table rows containing Confidential / Page N / Copyright are preserved
  const csvRows = ['Categorie,Reponse'];
  for (let r = 1; r <= 30; r++) {
    csvRows.push(r === 1 || r === 15 || r === 30 ? 'Classification,Confidential' : `Item ${r},Valeur ${r}`);
  }
  const csvOut = NLPCleaner.cleanText(NLPCleaner.parseCSV(csvRows.join('\n')), { dehyphenate: false, stripPagination: false }).text;
  assert.equal((csvOut.match(/Classification \| Confidential/g) || []).length, 3);

  const htmlTableRows = [];
  for (let r = 1; r <= 30; r++) {
    htmlTableRows.push(r === 1 || r === 15 || r === 30
      ? '<tr><td>Droit applicable</td><td>Copyright</td></tr>'
      : `<tr><td>Article ${r}</td><td>Contenu ${r}</td></tr>`);
  }
  const htmlTableOut = NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML(`<table>${htmlTableRows.join('')}</table>`)).text;
  assert.equal((htmlTableOut.match(/Droit applicable \| Copyright/g) || []).length, 3);

  // 3. Entity-only whitespace cells (&nbsp;, &#160;, &#xA0;) emit no stray pipes
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<table><tr><td>&nbsp;</td><td>Réponse A</td></tr></table>')).text,
    'Réponse A'
  );
  assert.equal(
    NLPCleaner.cleanText(NLPCleaner.extractTextFromHTML('<table><tr><td>&#160;</td><td>&#xA0;</td></tr><tr><td>A</td><td>B</td></tr></table>')).text,
    'A | B'
  );
});
