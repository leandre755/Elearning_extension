# Test Execution Log

## Verification Runs

### Run: Syntaxe JS + manifest (état avant sprint essaim)
- **Date**: 2026-11-19
- **Target**: `*.js` + `manifest.json`
- **Status**: PASS
- **Output / Evidence**:
  ```text
  manifest.json OK
  ALL JS SYNTAX OK
  ```
  (source : `.GCC/resume.md` de la session du 2026-11-19, commande `node --check` sur chaque `*.js` + `JSON.parse(manifest.json)`)
-[Antigravity-app, Claude Sonnet 5.5, high]

### Run: Test d'acceptation comportemental Protocol A (agent frais)
- **Date**: 2026-11-20
- **Target**: `AGENTS.md` (Protocol A `priority="blocking"`)
- **Status**: PASS
- **Output / Evidence**:
  ```text
  Sous-agent frais (research, conv 1ab5dc52), message « Salut, on en est où sur le projet ? ».
  Tool calls avant réponse : 1. .GCC/main.md  2. .GCC/resume.md  (aucune autre lecture)
  1re phrase : « Salut ! D'après .GCC/main.md et .GCC/resume.md, l'objectif courant est d'exécuter le sprint essaim ... »
  ```
  Limite : le prompt de test n'a pas de contrôle négatif (ancien AGENTS.md) ; le sous-agent a lu les fichiers après leur écriture.
-[Antigravity-app, Claude Sonnet 5.5, high]

### Run: Suite d'invariants + Quality Gate + Contrôles négatifs + Audits ANTIBUG
- **Date**: 2026-11-20
- **Target**: `.githooks/*`, `.semgrep/rules.yml`, `tests/invariants.test.js`, `.claude/settings.json`, `.coding-stuff/*`, `background.js`, `providers.js`
- **Status**: PASS
- **Output / Evidence**:
  - `node --test tests/invariants.test.js` : `tests 10, pass 10, fail 0, skipped 0`
  - `ALLOW_CONFIG_EDIT=1 .githooks/pre-commit` (staged) : 7/7 étapes OK (`exit 0`)
  - `QUALITY_GATE_SCOPE=full .githooks/pre-commit` : 7/7 étapes OK (`exit 0`)
  - Tests négatifs en clone `/tmp` (10+ scénarios : `.env`, secret `ghp_...`, `secrets/token.json`, `eslint-disable`, `++ // nosemgrep`, fichier avec espace + erreur syntaxe, index cassé vs working tree sain, `system.md` dans WAR, `data-qh-id`, `eval`, `console.log(token)`, ``console.log(`k=${apiKey}`)``, `innerHTML` ratcheting, suppression Anti-SSRF, suite 100% skippée, `pre-push` sur `HEAD` cassé avec working tree sain) : tous bloqués (`rc=1`).
  - Audit `antibug` v1 (`1c6d2c2c`) : 2 CRITICAL (`background.js` IPv6 dead code + redirect/MIME SSRF), 5 HIGH (`pre-commit` spaces, `pre-push` dirty WT, Semgrep console regex, `sanitizeUrlForLog` userinfo/hash, `invariants.test.js` multiline console), 10 MEDIUM → tous corrigés (y compris `providers.js:375` `_sanitizeUrl` découvert lors du grep).
  - Contre-audit `antibug` v2 (`076bcc55`) : Areas 1-4 (code, hooks, Semgrep, invariants) = 0 défaut ; Area 5 (profils) = 2 findings (Codex `"deny"` → `"read"` sur paths protégés non-secrets ; `Edit`/`Write`/`write_file` manquants pour secrets non-`.env`) → corrigés.
-[Antigravity-app, Gemini 4 Hydrogen, high]

### Run: Sprint Cœur & Robustesse (Lots 1 à 6) — Suite complète `node:test`, Quality Gate `full` & Audits ANTIBUG
- **Date**: 2026-11-22
- **Target**: `nlp-cleaner.js`, `settings.*`, `providers.js`, `dom-extractor.js`, `page-bridge.js`, `background-agent.js`, `system.md`, `content.js`, `highlight-manager.js`, `content.css`, `popup.*`, `background.js`, `tests/*.test.js`
- **Status**: PASS
- **Output / Evidence**:
  ```text
  $ for f in *.js tests/*.js; do node --check "$f" || exit 1; done && node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('ALL JS + MANIFEST SYNTAX OK');"
  ALL JS + MANIFEST SYNTAX OK

  $ node --test --test-concurrency=1 tests/*.test.js
  ℹ tests 101
  ℹ suites 0
  ℹ pass 101
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 7160.593118

  $ QUALITY_GATE_SCOPE=full bash .githooks/pre-commit
  [Quality Gate] Démarrage (périmètre : full, source : INDEX)
  [Quality Gate] 1/7 Fichiers interdits (secrets, identifiants)...
  [Quality Gate] 2/7 Fichiers de politique protégés : contrôlés au commit (ignoré en full).
  [Quality Gate] 3/7 Recherche de secrets (gitleaks)...
  [Quality Gate] 4/7 Commentaires d'inhibition interdits...
  [Quality Gate] 5/7 Syntaxe JavaScript et manifest.json...
  [Quality Gate] 6/7 Règles de sécurité du projet (Semgrep)...
  [Quality Gate] 7/7 Tests d'invariants du projet (node:test)...
  [Quality Gate] ✅ Toutes les vérifications sont passées (périmètre : full).
  ```
  - **Détail des 7 fichiers de tests (`101/101` tests `node:test`)** :
    1. `tests/invariants.test.js` (10 tests) : MV3, absence de `data-qh-*`, pas d'`eval`/remote code, Anti-SSRF, `sanitizeUrlForLog`, cliquet `.innerHTML`.
    2. `tests/nlp-cleaner.test.js` (16 tests) : `R-TECH-01` & `F-CTX-04` (`.txt`, `.md`, `.html`, `.csv`, dé-duplication d'en-têtes/pieds de page, XSS neutralization).
    3. `tests/providers-models.test.js` (7 tests) : catalogues de modèles 2026-11, thinking natif Gemini 4/Claude 5.5/Groq/NVIDIA/Mistral, omission de `temperature` dépréciée.
    4. `tests/providers-retry.test.js` (13 tests) : `R-TECH-05` (`fetchWithRetry` backoff/jitter/`Retry-After`/`AbortSignal`), `F-ANA-03` (`ProviderAnalytics` single-flight & redaction secrets), `F-AUTO-02` (`preWarmProviders`).
    5. `tests/dom-extractor.test.js` (19 tests) : `F-DET-02` (Shadow DOM + `<slot>` + `maxDepth`), `F-DET-01` (6 formats + encapsulation d'IDs ShadowRoot), `F-DET-03` (React Fiber/Vue state Proxy-safe), `F-DET-04` (intercepteur réseau opt-in & handshake `CustomEvent` sécurisé).
    6. `tests/agent-intel.test.js` (11 tests) : `F-INT-03` (`DOMAIN_PRESETS`, `detectDomain`, `buildDomainRules`, `applyDomainRules`), `F-INT-02` (`computeConfidenceTier`, `normalizeAnswerEntry`, escalade Fast Path `confidence=0`), `F-INT-04` (`crossValidateAnswers`).
    7. `tests/ui-integration.test.js` (7 tests) & `tests/security-stealth.test.js` (9 tests + 9 tests partagés/invariants) : redaction de `settings` dans `content.js`, ré-indexation delta Auto Mode, connexion Shadow DOM `isElementConnected`, badges de confiance en `WeakMap`, auto-submit opt-in (`F-AUTO-03`) avec annulation Panic, `preWarmProviders`, stats popup (`F-ANA-03`), et sécurité `handleInjectPageBridge` (`^https?:\/\/`, `world: 'MAIN'`, mutex par onglet).
  - **Audits indépendants `antibug` (tous `AUDIT PASSED` avant chaque commit)** :
    - Lot 1 (`ba29bd3`) : `antibug-1` -> `AUDIT PASSED`.
    - Lot 2 (`5a838ca`) : `antibug-2` / `antibug-2b` -> `AUDIT PASSED`.
    - Lot 3 (`aaea7b3`) : passes 1–6 (`c9656d1d`..`9466c1cd`, 27 défauts corrigés au total sur `dom-extractor.js` & `page-bridge.js`) + `antibug-lot3` (`1d11879d`, message `#37`) -> `AUDIT PASSED`.
    - Lot 4 (`e9b0478`) : `verifier-2` (`#35`) + `antibug-lot4` (`da5d11e7`, message `#39`) -> `AUDIT PASSED`.
    - Lot 5 (`9671839`) : `verifier-2` (`#45`) + `antibug-lot5` (`c015c157`, message `#47`) -> `AUDIT PASSED`.
    - Lot 6 (`14bddca`) : `verifier-2` (`#45`) + `antibug-lot6` (`850b020c`, message `#49`) -> `AUDIT PASSED`.
-[Antigravity-app, Gemini 4 Argon, high]

### Run: Campagne E2E Navigateur Réel (Brave 158 MV3 + Playwright + LLM vivant `fcc-server` + Sites Publics)
- **Date**: 2026-11-22
- **Target**: Extension MV3 non empaquetée (`/home/omni/Code/Elearning_Ext`) dans Brave Browser 158.1.100.58 (`--headless=new`), banc multi-sites local (6 pages + fixtures NLP), `mock_quiz.html`, et sites de quiz publics réels avec `fcc-server` (`antigravity/gemini-4-hydrogen-sonar`).
- **Status**: PARTIAL (25/25 assertions déterministes PASS, `mock_quiz.html` + `Examveda` + `W3docs` PASS côté résolution/surlignage live, `W3Schools` FAIL extraction/schema, 9 bugs runtime réels documentés)
- **Output / Evidence**:
  - **Phase 1 & 2 (25/25 PASS, 0 `pageerror`)** — `/home/omni/.gemini/antigravity/brain/9820e5b7-1e45-45ee-b0c9-776f91241957/scratch/e2e/run_e2e_deterministic.py` → `reports/phase1_results.json` :
    ```text
    === SUMMARY === {"total": 25, "passed": 25, "failed": 0, "bugsObservedCount": 7, "pageErrorsCount": 0}
    ```
    - Suite 1 : Service Worker, `agentMemory` init, `handleLoadSystemPrompt()`, blocage `fetch('.../system.md')` depuis origine web (`Failed to fetch`).
    - Suite 2 : Navigation 3 onglets `settings.html`, upload NLP 4 formats (`.txt`, `.md`, `.html` sans `<script>`, `.csv`), isolement `chrome.storage.local` vs `sync` (S1), persistance après rechargement (`01_settings.png`).
    - Suite 3 : Contrôle négatif `non-quiz.html` (cœur non injecté), auto-injection `loader.js` en monde `ISOLATED`, frontière monde `MAIN`, mutex 3× `injectCoreScripts`.
    - Suite 4 : Extraction des 6 formats universels (`single_choice`, `multi_choice`, `select_matching`, `fill_blank`, `drag_drop`, `text`), modes `ultra-furtif` / `furtif` / `visible` / `glow` (`02_quiz_6formats_furtif.png`, `03_quiz_glow.png`), bouton flottant `✨`, `pasteAnswer`, zéro `data-qh-*`, zéro fuite de clé console, Panic `clearAllHighlights` en `4.6 ms`.
    - Suite 5 : Shadow DOM imbriqué + `<slot>` + encapsulation d'IDs + zéro boucle Auto-Heal (`04_shadow_dom.png`). Observation : `querySelectorAllDeep` place l'élément projeté via `<slot>` après les frères du ShadowRoot (`[Osaka, Kyoto, Tokyo]`).
    - Suite 6 : Pont `world: 'MAIN'` (`page-bridge.js`) : extraction React Fiber/Props + Vue 3 malgré nœud throwing getter, interception Fetch/XHR avec rédaction `%5BREDACTED%5D`, filtrage `/api/unrelated`, 0 propriété/Symbol ajouté sur `window`/`document`, rejet mauvais nonce et rejet `chrome://` & `file://`.
    - Suite 7 : Mode Auto Delta (envoi uniquement Q2..Q3 1-based sans Q1) + détection feedback -> `agentMemory` mis à jour.
    - Suite 8 : Auto-Submit opt-in (`F-AUTO-03`) : bloqué si off, bloqué sous seuil confiance (42% < 85%), annulé par Panic, et soumission valide sur `#real-submit-btn` sans toucher `Annuler`/`Reset`.
    - Suite 9 : `preWarmProviders` (1 fois/page), retry HTTP `429` (`Retry-After: 0`), fallback Groq `500` -> Gemini `200`, cross-validation `< 70%` (`98% ✓✓`), UI `popup.html` (`3 IA prêtes`, stats Gemini, reset stats, barre d'erreur persistante > 3s, `05_popup.png`).
    - Suite 10 : `SchemaDetector.discoverSchema` + `SchemaCache` (`schema_127.0.0.1`) sur `eval-custom.html` (note : `loader.js` n'auto-injecte pas sur UI custom sans `<input>`/mot-clé), surlignage, listing & purge dans `settings.html`.
    - Suite 11 : Anti-SSRF `handleFetchImage` bloque `127.0.0.1`, `localhost`, `169.254.169.254`, `[::ffff:127.0.0.1]`, `file:///etc/passwd`, MIME `text/html`, redirect `302` (`redirect: 'error'`) ; autorise `image/png` valide ; `handleFetchLLM` bloque `evil.example.com`.
  - **Phase 3 (Live LLM `antigravity/gemini-4-hydrogen-sonar` via `fcc-server` + Sites Publics)** — `/home/omni/.gemini/antigravity/brain/9820e5b7-1e45-45ee-b0c9-776f91241957/scratch/e2e/run_e2e_live.py` → `reports/phase2_live_results.json` :
    - `mock_quiz.html` : `PASS` (`autoInjected: true`, `2/2`, `"Paris"` surligné `100%`, `#q2-input` rempli avec `"Selenium"` via bouton `✨`, `06_live_mock_quiz.png`).
    - `https://www.examveda.com/html/practice-mcq-question-on-basic-html/` : `PASS` (`autoInjected: true`, `10/10` questions extraites et surlignées avec badges `85%..100%`, `07_live_site1.png`).
    - `https://www.w3docs.com/quiz-start/html-basic` : `PASS` technique (`autoInjected: true`, `1/1`, surlignage `50%` ambre sur `the <head> element`, `08_live_site2.png`), mais extraction du mauvais titre (`"Answers"`, voir `BUG-09`).
    - `https://www.w3schools.com/quiztest/quiztest.asp?qtest=HTML` & `JS` : `FAIL` (`0` question extraite Phase 1 et `SchemaDetector` retourne `Aucun quiz`, voir `BUG-08`).
    - `https://www.geeksforgeeks.org/quizzes/javascript-gq/` : `BLOCKED_ANTIBOT` (`captcha_iframe`, ignoré sans contournement).
  - **Bugs runtime réels découverts (9 bugs)** :
    1. `BUG-01` (MEDIUM) — `settings.html:139-155` / `settings.js:577` : Carte résiduelle `#card-fireworks` présente ; cliquer Tester lance `Cannot read properties of undefined (reading 'defaultTextModel')`.
    2. `BUG-02` (HIGH) — `background-agent.js:2371-2379, 2495-2539` : `_buildPrompt()` omet les options de `select_matching` et les éléments/cibles `drag_drop` ; `_parseAIResponse()` XML ne gère que `radio`, `checkbox`, `text`.
    3. `BUG-03` (MEDIUM) — `highlight-manager.js:479, 561` : Classes CSS statiques injectées (`qh-confidence-badge`, `tier-*`, `quiz-helper-float-button`) contraires à l'objectif de furtivité DOM.
    4. `BUG-04` (MEDIUM) — `content.js:48` / `dom-extractor.js` : `passiveNetworkIntercept` sauvegardé mais jamais câblé pour déclencher `injectPageBridge`/`requestPageBridge` à l'analyse.
    5. `BUG-05` (HIGH) — `background-agent.js:1821,1902,1986` vs `providers.js:1731-1748` : `BackgroundAgent` contourne `QuizProviders.callProvider()`, donc `ProviderAnalytics.record()` reste à 0 requête après résolution de quiz.
    6. `BUG-06` (HIGH) — `content.js:1094-1105` vs `popup.js:523-584` : Désalignement IPC sur `getSchemaStatus` (`{ hasSchema }` au lieu de `{ success: true, data: ... }`) et `discoverSchema` (`{ success, schema }` vs `response.data.platform`).
    7. `BUG-07` (HIGH) — `highlight-manager.js:235-240, 275-284` : Auto-Heal ne détecte pas le remplacement de `q.element` par son parent (`_mutationObserver` limité aux `attributes` de `q.element` sans `childList` parent) ; de plus `applyHighlights` en Mode Auto Delta efface les surlignages précédents.
    8. `BUG-08` (HIGH) — `schema-detector.js:9-14, 25, 53` : Sur un site réel dense (`W3Schools`), `IGNORE_TAGS` en majuscules échoue sur `<svg>`/`<path>` en minuscules et sature `MAX_SKELETON_NODES = 500` dans le menu avant `#quizmain`.
    9. `BUG-09` (MEDIUM) — `dom-extractor.js:983-1004` : Sur `W3docs`, `findQuestionTextElement` capture un sous-titre `"Answers"` dans le sous-bloc d'options au lieu de la vraie consigne située au-dessus.
-[Antigravity-app, Orchestrator (Neon), unknown]

### Run: Correctifs BUG-01..BUG-09 + Correctifs Audits ANTIBUG + Revalidation E2E Brave 158 & Tests Unitaires
- **Date**: 2026-11-22
- **Target**: `settings.html`, `settings.js`, `background-agent.js`, `highlight-manager.js`, `content.css`, `manifest.json`, `content.js`, `popup.js`, `schema-detector.js`, `dom-extractor.js`, `tests/e2e-regressions.test.js`
- **Status**: PASS
- **Output / Evidence**:
  - **Syntaxe JS + Suite unitaire séquentielle (`117/117` tests PASS sur 9 fichiers, `0 fail`)** :
    - `tests/agent-intel.test.js` : 11/11 PASS
    - `tests/dom-extractor.test.js` : 19/19 PASS
    - `tests/e2e-regressions.test.js` : 16/16 PASS (`BUG-01`..`BUG-09`, `BUG-06b`, `BUG-07b`, `ANTIBUG-01`..`04`, `ANTIBUG-P2`, `ANTIBUG-P3`)
    - `tests/invariants.test.js` : 10/10 PASS
    - `tests/nlp-cleaner.test.js` : 24/24 PASS
    - `tests/providers-models.test.js` : 7/7 PASS
    - `tests/providers-retry.test.js` : 14/14 PASS
    - `tests/security-stealth.test.js` : 9/9 PASS
    - `tests/ui-integration.test.js` : 7/7 PASS
  - **E2E Déterministe Brave 158 MV3 (`run_e2e_deterministic.py`, post-derniers correctifs)** :
    ```text
    === SUMMARY === {"total": 30, "passed": 30, "failed": 0, "bugsObservedCount": 0, "pageErrorsCount": 0}
    ```
    Inclut : suppression `#card-fireworks` + garde `testProvider` (`BUG-01`), options `select_matching`/`drag_drop` (`BUG-02`), zéro classe statique DOM/CSS (`BUG-03`), pont `MAIN` opt-in `passiveNetworkIntercept` (`BUG-04`), télémétrie `ProviderAnalytics` + `rateLimits` depuis `BackgroundAgent` (`BUG-05`), contrat popup `{ success, data }` + zéro ré-injection sur erreur LLM (`BUG-06`/`BUG-06b`), Auto-Heal parent `childList` + prévention boucle `IntersectionObserver` + Auto Mode Delta + Feedback (`BUG-07`/`BUG-07b`).
  - **E2E Live Brave 158 + `fcc-server` (`antigravity/gemini-4-hydrogen-sonar`, exécuté avant les derniers ajustements `background-agent.js`/`schema-detector.js` issus des passes `antibug` 1–3)** :
    - `mock_quiz.html` : PASS (`2/2`, `"Paris"`, bouton flottant `"Selenium"`, 0 signature statique)
    - `Examveda HTML MCQ` : PASS (`10/10` extraites/surlignées, badges `85%..100%`, 0 signature statique)
    - `W3docs HTML Basic Quiz` : vraie consigne extraite (`"HTML stands for"`), réponse `"Hyper Text Markup Language"` à `100%`, 1 option surlignée, 1 badge, 0 signature statique (code de sortie `1` du script uniquement dû au seuil `len > 15` sur `"HTML stands for"` = 15 caractères et à une `pageerror` du script tiers du site contre `HeadlessChrome/158.0.0.0`, hors Safe Exm)
    - `W3Schools HTML Quiz` (`"What does HTML stand for?"`) & `W3Schools JS Quiz` (`"Inside which HTML element do we put the JavaScript?"`) : PASS (`1/1`, `#qtext` présent dans le squelette DOM, surligné `100%`, 0 signature statique)
    - `ProviderAnalytics` live : `requests: 5, successes: 5, failures: 0, totalLatencyMs: 24244, avgLatencyMs: 4849`
  - **Quality Gate (`QUALITY_GATE_SCOPE=full bash .githooks/pre-commit`)** :
    ```text
    [Quality Gate] ✅ Toutes les vérifications sont passées (périmètre : full).
    ```
  - **Revue forensique indépendante `antibug` (contexte frais, 4 passes)** :
    - Passe 1 (`ff53878f`, modèle hérité) : 4 constats (3 HIGH, 1 MEDIUM) corrigés avec tests.
    - Passe 2 (`98c01d0f`, modèle hérité) : 2 constats MEDIUM corrigés avec tests (`ANTIBUG-P2`).
    - Passe 3 (`7ba288dc`, modèle hérité) : 5 constats (2 HIGH, 3 MEDIUM) corrigés avec tests (`ANTIBUG-P3`).
    - Passe 4 (`0a72ddce` bloqué en 429 sur modèle hérité ; relancé sur `Model: "flash"` avec accord utilisateur, ID `12eeb67f`) : `AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.`
-[Antigravity-app, unknown, unknown]

### Run: Re-exécution E2E Live sur `HEAD` (`0df6c06`) + Vérification ESLint globale (`eslint .`)
- **Date**: 2026-11-22
- **Target**: `HEAD` (`0df6c06`) dans Brave 158 + `fcc-server` (`antigravity/gemini-4-hydrogen-sonar`), et `eslint .` (ESLint `v10.15.0` installé globalement) après mise à jour autorisée de `eslint.config.js`
- **Status**: PASS
- **Output / Evidence**:
  - **E2E Live Brave 158 + `fcc-server` (`run_e2e_live.py`, code de sortie `0`)** :
    ```text
    === LIVE SUMMARY === {"liveModel": "antigravity/gemini-4-hydrogen-sonar", "mockQuizStatus": "PASS", "publicSites": [{"label": "Examveda HTML MCQ", "status": "PASS", "phase1ExtractedCount": 10}, {"label": "W3docs HTML Basic Quiz", "status": "PASS", "phase1ExtractedCount": 1}, {"label": "W3Schools HTML Quiz", "status": "PASS", "phase1ExtractedCount": 1}, {"label": "W3Schools JS Quiz", "status": "PASS", "phase1ExtractedCount": 1}], "providerRequests": 5, "pageErrorsCount": 0, "thirdPartyPageErrorsCount": 1}
    ```
    - `Examveda HTML MCQ` : PASS (`phase1=10`, `solve=10`, badges `85%..100%`, `staticSigs=0`).
    - `W3docs HTML Basic Quiz` : PASS (`phase1=1`, `stem='How you can open the link in a new window?'`, réponse `target="_blank"` `100%`, `highlighted=1`, `badges=1`, `staticSigs=0`) ; l'unique `thirdPartyPageErrors` provient du script tiers hôte rejetant `HeadlessChrome/158.0.0.0`.
    - `W3Schools HTML Quiz` (`'What does HTML stand for?'`, `100%`) & `W3Schools JS Quiz` (`'Inside which HTML element do we put the JavaScript?'`) : PASS (`1/1`, `#qtext` dans le squelette DOM, `0` signature statique).
    - `ProviderAnalytics` live : `requests: 5, successes: 5, failures: 0, rateLimits: 0, avgLatencyMs: 4871`.
  - **ESLint (`eslint .`, code de sortie `0`)** :
    - 10/10 fichiers modifiés sur `0df6c06` avaient déjà 0 erreur ; 41 erreurs préexistantes `no-undef` relevées sur globaux manquants (`DOMParser` dans `nlp-cleaner.js`, `AbortSignal` dans `providers.js` + `providers-retry.test.js`, `process`/`Buffer`/`TextEncoder`/`queueMicrotask` dans `tests/*.test.js`).
    - Mise à jour de `eslint.config.js` (autorisée par le mainteneur via `ALLOW_CONFIG_EDIT=1`) : ajout de `AbortSignal`, `DOMParser`, `TextEncoder`, `queueMicrotask` aux globaux runtime + bloc ciblé `files: ["tests/**/*.test.js"]` pour `process`/`Buffer`.
    - Résultat après correction : `eslint .` -> `0` erreur, `0` warning ; contrôle négatif `echo "process.exit(0)" | eslint --stdin --stdin-filename background.js` -> rejeté `'process' is not defined (no-undef)`.
-[Antigravity-app, unknown, unknown]

### Run: Onglet dédié « Fournisseurs » dans `settings.html` (4 onglets) + Vérification Playwright Chrome & ANTIBUG
- **Date**: 2026-11-22
- **Target**: `settings.html` (commit `67deb62`)
- **Status**: PASS
- **Output / Evidence**:
  - `node --test --test-concurrency=1 tests/*.test.js` → `tests 117, pass 117, fail 0`
  - `QUALITY_GATE_SCOPE=full bash .githooks/pre-commit` → `7/7 ✅` (gitleaks, syntax, Semgrep, invariants)
  - Vérification navigateur réel (Playwright + `/bin/google-chrome`, viewport `1024x900`, thèmes clair et sombre) : 4 onglets (`01 Général`, `02 Fournisseurs`, `03 Avancé`, `04 Expert`), `#tab-essential` = `['Discrétion', 'Notes de cours']`, `#tab-providers` = `['Clés API', 'Ordre des fournisseurs']` (`5` cartes clés + `5` lignes `#priorityList`), `#tab-advanced` commence par `Recherche web` (sans doublon d'ordre), `#tab-expert` inchangé, `TABS_OVERFLOW_1024: False`.
  - Revue indépendante `antibug-reviewer` (`c6027b5a`) sur le diff stagé : `AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.`
-[Antigravity-app, Gemini 4 Neon, medium]

### Run: Option `showConfidenceBadge` (masquage du pourcentage de confiance) + Playwright Chrome & ANTIBUG
- **Date**: 2026-11-22
- **Target**: `providers.js`, `highlight-manager.js`, `content.js`, `settings.html`, `settings.css`, `settings.js`, `tests/ui-integration.test.js` (commit `365b248`)
- **Status**: PASS
- **Output / Evidence**:
  - `node --test tests/ui-integration.test.js` (`7/7` PASS, incluant `showConfidenceBadge: false` via `options` et `ConfigCache`, `showConfidenceBadge: true`, et vérification de câblage `settings.html`/`providers.js`) + `node --test tests/e2e-regressions.test.js` (`16/16` PASS).
  - `QUALITY_GATE_SCOPE=full bash .githooks/pre-commit` → `7/7 ✅`.
  - Playwright + `/bin/google-chrome` sur `settings.html` : `#showConfidenceBadge` visible et coché par défaut dans `01 // MARQUAGE`, sauvegarde `showConfidenceBadge: false`, rechargement `loadSettings()` rétablit l'état décoché (`PLAYWRIGHT_BADGE_TOGGLE_OK`).
  - Revue indépendante `antibug-reviewer` (`1f4ecaaa`) sur le diff stagé : `AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.`
-[Antigravity-app, Gemini 4 Neon, medium]

### Run: Intégration des 35 fournisseurs HTTP REST `fcc-server` (40 providers au total) — Tests unitaires, Playwright Chrome & Audits ANTIBUG
- **Date**: 2026-11-22
- **Target**: `provider-catalog.js`, `providers.js`, `background.js`, `background-agent.js`, `content.js`, `schema-detector.js`, `settings.html`, `settings.css`, `settings.js`, `popup.html`, `popup.js`, `tests/e2e-regressions.test.js`, `tests/provider-catalog.test.js` (commit `f61df5b`)
- **Status**: PASS
- **Output / Evidence**:
  - **Tests unitaires & protocolaires (`node --test --test-concurrency=1 tests/provider-catalog.test.js` → `8/8 PASS`)** :
    1. `Catalog integrity`: `40` fournisseurs dans `QuizProviders.PROVIDERS` (`5` cœur + `35` catalogue), `openai`/`vertex`/`antigravity` exclus, `40` `apiKeyField` uniques, `DEFAULT_PRIORITY` inchangé.
    2. `URL normalization, base URL resolution, and isProviderConfigured`: normalisation `/v1` (`ollama`, `lmstudio`, `llamacpp`, `bedrock`), interpolation `accountId` (`cloudflare`), `requiresBaseUrl` (`azure_openai`), routage `codestral.mistral.ai`, matrice `isProviderConfigured`.
    3. `QuizProviders.callProvider`: vérification URL/headers/payload sur `open_router`, `cloudflare` (`max_completion_tokens`), `azure_openai`, `cerebras`, `kimi_code`, `minimax`, `alibaba`, `commandcode`, `tokenrouter`, `github_models` (`Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2026-03-10`), `agentrouter` (`/messages?beta=true` + Bearer + `x-api-key`), `anthropic_compatible`, `ollama`.
    4. `ModelRegistry.syncProviderModels`: formats `open_router`, `ollama`, `xai` (`/language-models` + `aliases`), `together` (filtre `type === 'chat'`), `github_models` (`models.github.ai/catalog/models`), `cloudflare` (`/ai/models/search?format=openrouter`), `anthropic_compatible`, et fallback statique `agentrouter`.
    5. `background.js Anti-SSRF`: `isAllowedLLMUrl` (hôtes HTTPS statiques, regex `bedrock-mantle`/`openai.azure.com`, origines HTTPS publiques dans `providerConfigs`, loopback limité aux locaux activés et connecteurs `allowsLoopbackBaseUrl` ; rejet `169.254.169.254`, `10.0.0.1`, `192.168.1.50`, userinfo, ports non-443, loopback non activé), `handleFetchLLM` (`redirect: 'error'`), et `isBlockedImageHost` intact.
    6. `BackgroundAgent._callLLMWithTools`: appels avec outils sur `agentrouter`, `anthropic_compatible`, `ollama`, `cloudflare`.
    7. `Antibug regressions (pass 1)`: `smartRoute` et `crossValidateAnswers` atteignent les fournisseurs du catalogue quand `providerOrder` est absent ; `settings.js:testProvider` efface bien un override `customModels` périmé lorsque le champ DOM est vidé.
    8. `Antibug regressions (pass 2 & 3)`: `crossValidateAnswers` fonctionne avec `providerOrder: []` ou la liste historique des 5 providers cœur ; `_enforceDirectFetchPolicy` et `BackgroundAgent.solve` dans le Service Worker bloquent les tentatives SSRF IPC (`169.254.169.254`) et forcent `redirect: 'error'` ; `submitQuizFeedback` préserve les configurations plates `ConfigCache.getAll()` tout en écartant un `providerConfigs` non fiable ; `validateProviderBaseUrl` bloque `.localhost` et `>= 224.0.0.0/4`.
  - **Suite globale (`node --test --test-concurrency=1 tests/*.test.js`)** :
    ```text
    ℹ tests 125 | ℹ suites 0 | ℹ pass 125 | ℹ fail 0 | ℹ cancelled 0 | ℹ skipped 0 | ℹ duration_ms 17946.84752
    ```
    (Note : 1 erreur IPC transitoire du runner Node `v26.2.0` `Unable to deserialize cloned data due to invalid or unsupported version` observée une fois lors d'un lancement multi-fichiers sous charge CPU, non reproduite sur les exécutions suivantes.)
  - **Quality Gate (`QUALITY_GATE_SCOPE=full bash .githooks/pre-commit` & staged `bash .githooks/pre-commit`)** : `7/7 ✅` (exit `0`).
  - **Vérification E2E & Visuelle Playwright Chrome (`/bin/google-chrome`, `1024×900`, thèmes clair et sombre)** :
    - `40` `.key-card` rendues (`#providerFilterCount` = `40 / 40`), recherche (`"ollama"` → `2`, `"cloudflare"` → `1`), filtres (`Locaux` = `3`, `Cloud` = `37`, `Configurés` = `0` → `4`), sauvegarde et rechargement de `open_router`, `cloudflare` (`accountId`), `anthropic_compatible` (`http://127.0.0.1:8082/v1`) et `ollama` (`enabled: true`), `#priorityList` = `4`, `#modelOverrides` = `4`, `popup.html` `#connectionStatus` = `'4 clés'`, `0` erreur console/page/404.
    - Défaut CSS corrigé lors de l'inspection visuelle des captures : `.setting-item label` (`0,1,1`) écrasait `.checkbox-label` (`0,1,0`) en `display: block` dans `settings.css:341` ; sélecteur relevé à `.setting-item label.checkbox-label, .checkbox-label` (`getComputedStyle` = `'flex'`).
  - **Cycles de revue forensique `antibug-reviewer` (contexte frais)** :
    - Passe 1 (`7a7110f7`) : 3 défauts (fallback `smartRoute`/`schema-detector.js`, `_getStrictlyConfiguredProviders` sans `providerOrder`, et `testProvider` modèle périmé) → corrigés + test 7.
    - Passe 2 (`ee8bcb64` & `eba3903f`) : 2 défauts (SSRF/redirect sur `fetch` direct du Service Worker via `BackgroundAgent` + `providerOrder` vide `[]` ou historique 5-cœur dans `_getStrictlyConfiguredProviders`) → corrigés + test 8.
    - Passe 3 (`73feb0e7`) : 2 défauts (`hydrateTrustedConfig` écrasant les configs plates `ConfigCache.getAll()` de `submitQuizFeedback`, et rejet `.localhost`/multicast `>= 224` dans `settings.js:validateProviderBaseUrl`) → corrigés + test 8 étendu.
    - Passe 4 finale (`5fb6e6dd-e00c-4541-8908-1d310dd6667c`) : `AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.`
-[Antigravity-app, Gemini 4 Argon, medium]

### Run: Purge des IDs de modèles pré-2026, neutralisation des connecteurs génériques de protocole (`96fbcbe`) & ajout natif de `FreeClaudeCode (Local)` (`fcc_local`, `41ca56a`)
- **Date**: 2026-11-22
- **Target**: `provider-catalog.js`, `providers.js`, `settings.js`, `tests/provider-catalog.test.js` (commits `96fbcbe` et `41ca56a`)
- **Status**: PASS
- **Output / Evidence**:
  - **Commit 1 (`96fbcbe`) — Purge pré-2026 & connecteurs génériques `openai_compatible` / `anthropic_compatible`** :
    - Vérification `FORBIDDEN_LEGACY_MODEL_RE` sur les 40/41 fournisseurs (`defaultTextModel`, `defaultVisionModel`, `textModels`, `visionModels`) : `0` ID de modèle pré-2026.
    - `openai_compatible` et `anthropic_compatible` : `baseUrl: ''`, `requiresBaseUrl: true`, `genericProtocolConnector: true`, `defaultTextModel: 'auto'`, `defaultVisionModel: 'auto'`.
    - Passe 1 `antibug-reviewer` (`528da316`) : 2 défauts détectés (`ModelRegistry.syncProviderModels` sur cache hit `< 24h` et `ModelRegistry.getCachedModels` ne réchauffant pas `_syncedModelsCache` via `QuizProviders.warmContextCache` ; repli statique `'auto'` de `preWarmProviders` écrasant `_syncedModelsCache`) → corrigés dans `providers.js` + testés dans `tests/provider-catalog.test.js`.
    - Passe 2 `antibug-reviewer` (`94c0cc61-b1de-47d3-89b4-36e016a6ce03`) : `AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.`
  - **Commit 2 (`41ca56a`) — Fournisseur local intégré `FreeClaudeCode (Local)` (`fcc_local`) sur `http://127.0.0.1:8082/v1`** :
    - `41` fournisseurs au total (`5` cœur + `36` catalogue ; `37` cloud + `4` locaux : `fcc_local`, `lmstudio`, `llamacpp`, `ollama`).
    - Passe 1 `antibug-reviewer` (`7eda3f17`) : 1 défaut détecté (`_extractOpenAIContextWindow(m)` dans `_fetchClaudeModels` retournant `128000` par défaut et rendant `|| 200000` inatteignable lorsque `max_input_tokens` est omis) → corrigé via `_extractOpenAIContextWindow(rawObj, fallback = 128000)` appelé avec `_extractOpenAIContextWindow(m, 200000)` dans `_fetchClaudeModels` + assertion `assert.equal(acModels[0].contextWindow, 200000)`.
    - Passe 2 `antibug-reviewer` (`265cc45d-6f44-40a7-a518-85f8fbb18d54`) : `AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.`
    - Suite complète `node --test --test-concurrency=1 tests/*.test.js` : `125/125 PASS` (`0` fail).
    - Playwright Chrome E2E (`verify_ui.py`) : `PLAYWRIGHT_OK {'total_cards': 41, 'configured_after_reload': 4, 'priority_items': 4, 'override_cards': 4, 'popup_status': '4 clés'}` (`4` locaux, `37` cloud, `#card-fcc_local` testé et persisté).
-[Antigravity-app, Gemini 4 Argon, medium]

### Run: Images raster (`PNG`, `JPEG`, `WebP`, `GIF`) dans Notes de cours — Mode Vision direct (`course-media.js`, `settings.*`, `background-agent.js`)
- **Date**: 2026-11-22
- **Target**: `course-media.js`, `background.js`, `background-agent.js`, `settings.html`, `settings.css`, `settings.js`, `tests/course-media.test.js`, `tests/nlp-cleaner.test.js`
- **Status**: PASS
- **Output / Evidence**:
  - **Syntaxe & Quality Gate (`bash .githooks/pre-commit` staged + `QUALITY_GATE_SCOPE=full bash .githooks/pre-commit`)** : `7/7 ✅` (`exit 0`, incluant `gitleaks git --staged`, suppression ban, `node --check`, Semgrep `.semgrep/rules.yml`, `tests/invariants.test.js`).
  - **Suite complète (`node --test --test-concurrency=1 tests/*.test.js`)** :
    ```text
    ℹ tests 138
    ℹ suites 0
    ℹ pass 138
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 20913.950436
    ```
    (`13` tests dans `tests/course-media.test.js` couvrant `CourseMedia`, `_buildPrompt`, `_estimateImageTokens`, `_createQuizChunks`, Fast Path Gemini/Claude/Groq, ReAct + Ralph retry + Cross-Validation + SW hydration, rejet SVG/HTML spoofé, et `settings.js` DOM VM).
  - **Vérification Chrome réel (Playwright `/bin/google-chrome`, thèmes Papier & Ardoise + CDP audits)** :
    - PNG transparent `600×400` (`15 Ko`) + JPEG `2400×1600` redimensionné `1600×1067` (`46 Ko`), WebP `2000×1000` -> `1600×800`, GIF89a `1×1` -> PNG, fond `#FFFFFF` appliqué, `.file-thumb` fond `#FFFFFF` en mode Ardoise, rejet `.svg` et faux `.png` (`<svg>`), rejet `> 15 Mo`, drag-and-drop sans double ajout, persistance après `Enregistrer` + rechargement (`0` `pageerror`, `0` erreur console non-favicon).
  - **Audits indépendants `antibug-reviewer` (contexte frais sur `git diff --cached`)** :
    - Passe 1 (`2deb663c`) : 3 constats (`gitleaks` sur faux token de test `tests/course-media.test.js:260`, écrasement `answers[ans.questionIndex]` dans `_validateAndRetry` `background-agent.js:2771`, comptage brut de `q.images` SVG dans `background-agent.js`) + observation `Buffer` ESLint → tous corrigés avec tests de non-régression.
    - Passe 2 (`e1063e70`) : `AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.`
-[Antigravity, Gemini 4 Neon, XHigh]

### Run: Mise en conformité `modern-web-guidance` & Manifest V3 (`theme-init.js`, `popup.*`, `settings.*`, `background.js`, `content.js`, `highlight-manager.js`, `manifest.json`)
- **Date**: 2026-11-23
- **Target**: `theme-init.js`, `popup.html`, `popup.css`, `popup.js`, `settings.html`, `settings.css`, `settings.js`, `background.js`, `content.js`, `highlight-manager.js`, `manifest.json`, `ARCHITECTURE.md`, `tests/modern-web-guidance.test.js`
- **Status**: PASS
- **Output / Evidence**:
  - **Syntaxe & ESLint (`eslint theme-init.js popup.js settings.js background.js content.js highlight-manager.js tests/modern-web-guidance.test.js`)** : `exit 0` (`0` erreur, `0` warning ; note : `eslint .` sur le dépôt complet signale 2 erreurs préexistantes hors périmètre dans `providers.js:1435,1437`).
  - **Suite complète (`node --test --test-concurrency=1 tests/*.test.js`)** :
    ```text
    ℹ tests 149 | ℹ suites 0 | ℹ pass 149 | ℹ fail 0 | ℹ cancelled 0 | ℹ skipped 0 | ℹ todo 0 | ℹ duration_ms 15975.361921
    ```
    (`11` tests dans `tests/modern-web-guidance.test.js` : FOUC-free `theme-init.js` + concurrence `initThemeFromStorage` + bascule rapide + `matchMedia` sous override + sync `storage.onChanged`, onglets clavier + `beforematch`, `#priorityList` clavier même à 0 fournisseur configuré, `<dialog>` + garde `dialog.open`, `<progress>` + annonceur `popup.js`, `chrome.storage.session` pre-warm + notifications menus contextuels + `AbortSignal.timeout`, batching rAF/`scheduler.yield()` + onglet arrière-plan `document.hidden`/`visibilitychange` + `_applyGeneration` post-`NEEDS_HEAL`, annulation Panic/effacement/`ConfigCache.onChange` pré-LLM & port `solveQuiz` & timer debounce Auto Mode dans `content.js`, et invariants CSS/HTML/Manifest.)
    *(Note : 1 erreur IPC transitoire du runner Node `v26.2.0` `Unable to deserialize cloned data due to invalid or unsupported version` observée une fois sur `tests/e2e-regressions.test.js` en cours d'itération ; `16/16 PASS` en isolé puis `149/149 PASS` sur la passe complète finale.)*
  - **`pnpx modern-web-guidance@latest legacy-scan` (par fichier)** : `0 findings` sur `theme-init.js`, `popup.html`, `popup.css`, `popup.js`, `settings.html`, `settings.css`, `background.js`, `content.js`, `highlight-manager.js` ; `settings.js` ne remonte que les 2 `JSON.parse(JSON.stringify(...))` volontairement conservés (`eslint.config.js` sans `structuredClone`).
  - **Vérification Chrome réel (Playwright `/bin/google-chrome`, `344×620` popup & `1024×900` settings)** :
    - `CHROME_UI_VERIFY_PASS: popup_light, popup_dark, settings_light, settings_dark, settings_dialog verified cleanly (0 errors)` (avec 5 captures inspectées visuellement).
    - Vérifiés : zéro débordement horizontal popup (`<= 344 px`), cascade `color-scheme` (`light dark` -> `dark` -> `light dark`), `<progress>` visible, `#resetStatsBtn` fonctionnel sans refermer `<details>`, panneaux `hidden="until-found"` à hauteur `0 px`, navigation clavier onglets + `beforematch`, réordonnancement `#priorityList` avec transfert de focus et `#priorityAnnouncer`, et modale `<dialog id="resetConfirmDialog">` fermée par `Escape` sans `window.confirm`.
  - **Quality Gate (`bash .githooks/pre-commit` staged + `QUALITY_GATE_SCOPE=full bash .githooks/pre-commit`)** : `7/7 ✅` (`exit 0`).
  - **Audits forensiques `antibug-reviewer` (contexte frais sur `git diff --cached`)** :
    - Passe 1 (`0170ab20`) : 5 constats (2 HIGH : `_applyGeneration` post-`NEEDS_HEAL` `highlight-manager.js`, `providerOrder` à 0 fournisseur `settings.js` ; 3 MEDIUM : `document.hidden` `rAF`, contrastes `--success-color`/`--warning-color`/hover danger, clipping `overflow` `:focus-visible`) → corrigés.
    - Passe 2 (`3d064a5a`) : 2 constats (`content.js` `'CANCELLED'` ignoré par `handleAnalyzeQuiz()`, `/* global CourseMedia */` dans `settings.js`) → corrigés.
    - Passe 3 (`7bad7275`) : 1 constat (`ConfigCache.onChange` `enabled=false` sans `_clearGeneration++` dans `content.js`) → corrigé via `setExtensionEnabled()`.
    - Passe 4 (`abbc3750`) : 2 constats (annulation pré-LLM/port `solveQuiz` `content.js`, contraste SC 1.4.11 `<progress>` clair `popup.css`) → corrigés.
    - Passe 5 (`f57b702a-5144-4f48-8643-efa834441d7e`) après correctif `_autoModeDebounceTimer` (`29a7a7ef`) : `AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.`
-[Antigravity, unknown, unknown]

### Run: Campagne E2E 100/100 Brave 158 décompressé + LLM réel (fcc-server)
- **Date**: 2026-11-23
- **Target**: `provider-catalog.js`, `background.js`, `content.js`, `providers.js`, `schema-detector.js`, `settings.js`, `popup.js`, `loader.js`, `background-agent.js`, `tests/provider-catalog.test.js`, `tests/e2e-regressions.test.js`
- **Status**: PASS
- **Output / Evidence**:
  - **Environnement live** : Brave `158` réel avec extension chargée en mode décompressé (`--load-extension=/home/omni/Code/Elearning_Ext`) + `fcc-server` réel (`http://127.0.0.1:8082/v1`, modèles `groq/openai/gpt-oss-120b` et Vision `antigravity/gemini-3.8-flash-tiered`).
  - **Passe initiale (`33/41 PASS`) & correctifs appliqués** (`8` défauts réels + `2` erreurs ESLint préexistantes + correctif d'audit) :
    - `BUG-LIVE-01` & `BUG-LIVE-02` (`provider-catalog.js`) : `fcc_local.staticApiKey` aligné sur `'freecc'` ; modèles `fcc_local` mis à jour vers `groq/openai/gpt-oss-120b` et Vision `antigravity/gemini-3.8-flash-tiered`.
    - `BUG-LIVE-03` (`background.js`) : extraction de `handleAnalyzeQuizCommand`, `sendAnalyzeQuizToTab` et `sendMessageWithMissingReceiverRetry` pour injecter les scripts à froid avant `analyzeQuiz`.
    - `BUG-LIVE-04` (`schema-detector.js`) : passage de `syncConfig.customModels` au lieu de `{}` à `QuizProviders.smartRoute()`.
    - `BUG-LIVE-06` (`settings.js`) : hydratation DOM avant les lectures async `ModelRegistry.getCachedModels()`, parallélisation `DOMContentLoaded`/`loadSettings()`, et `await loadSchemas()`.
    - `BUG-LIVE-07` (`popup.js`) : nettoyage/masquage de `#progressPercentage` dans `showError()` et restauration dans `showProgress()`.
    - `BUG-LIVE-08` (`loader.js`) : extraction de `hasInteractiveContent()` avec parcours borné du Shadow DOM ouvert (`MAX_SHADOW_DEPTH = 8`, `MAX_SHADOW_WALK_NODES = 1500`).
    - `BUG-LIVE-09` (`background-agent.js`) : schéma XML strict dans `_buildVerificationPrompt()` et fallback de type normalisé dans `_parseAIResponse()`.
    - ESLint (`providers.js:1435,1437`) : résolution de `isAllowedLLMUrl` et `getStoredProviderConfigs` via `globalThis` / `self` dans `_enforceDirectFetchPolicy`.
  - **Audits forensiques `antibug-reviewer` (contexte frais sur `git diff --cached`)** :
    - Passe 1 (`39ad0b78-e719-4491-bb79-5a9b2ace8235`) : constat HIGH sur la race d'initialisation asynchrone MV3 dans `content.js` (enregistrement `setupMessageListener` et export `SafeExm.Content` après `await ConfigCache.init()`) et absence de single-flight dans `ConfigCache.init()` (`providers.js`) → corrigés (`bootstrapConfig()` non bloquant avec gardes `_hasExplicitEnabledState`/`_hasExplicitAutoModeState`, `_initPromise` et `_onChangedBound` dans `providers.js`, zéro `.then(`).
    - Passe finale (`828f1c35-a34a-4ead-ac64-7f5ee0e79ca0`) : `AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.`
  - **Revalidation E2E live après correctifs (`e2e_100_results.json`)** :
    - `41/41 PASS` (`failed: 0`, `bugsObservedCount: 0`, `consoleErrorsCount: 0`, `pageErrorsCount: 0`, `secretLeaksCount: 0`).
    - Couverture vérifiée : Suite A (`A01`..`A07c` — paramètres 4 onglets, thèmes système/clair/ardoise, `<dialog>`, upload/redimensionnement multi-formats + rejet SVG/spoofed/EXE, `41` cartes, sync & `Tester` réels `fcc_local` à vide, DnD/`Alt+ArrowUp` `#priorityList`, rechargement complet), Suite B (`B01`..`B08` — `SchemaDetector` réel, `2/2` réponses, `RÀZ` sans fermer `<details>`, erreur persistante sans `%` résiduel), Suite C (`C01`..`C10` — `system.md` protégé SW-only, `4` commandes manifeste `Ctrl+Shift+1/2/3/E` + `5` menus contextuels, `6` formats universels + `4` niveaux de discrétion + `0` signature statique, Vision réelle `9182`/`Mars`, Shadow DOM + Auto-Heal `childList`, `page-bridge.js` `MAIN` + redaction Fetch/XHR, `SchemaDetector` sur `/eval-board.html`, Mode Auto Delta + Feedback/`agentMemory` + Auto-Submit/Panic + annulation en vol, failover `429`/`500` -> `fcc_local` + `ProviderAnalytics` + Cross-Validation live `confirmed`, Anti-SSRF `7/7` URLs d'images + `3/3` hôtes LLM bloqués). Captures `01` à `10` inspectées visuellement.
  - **Suite complète (`node --test --test-concurrency=1 tests/*.test.js`)** :
    ```text
    ℹ tests 155
    ℹ suites 0
    ℹ pass 155
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 33003.161929
    ```
  - **ESLint (`eslint .`)** : `exit 0` (`ESLINT_OK`, `0` erreur, `0` warning).
  - **Quality Gate (`pre-commit`)** : `7/7` vérifications passées en portée `full` et à la validation du commit.
-[Antigravity-app, unknown, unknown]

### Run: Step 1 (`F-UX-01`) Side Panel MV3, `zeroTraceMode`, Panic Sync, `x-goog-api-key` & Rédaction des secrets (`974daa2`)
- **Date**: 2026-11-24
- **Target**: `manifest.json`, `background.js`, `background-agent.js`, `providers.js`, `schema-detector.js`, `popup.html`, `popup.js`, `content.js`, `sidepanel.html`, `sidepanel.css`, `sidepanel.js`, `tests/sidepanel.test.js`
- **Status**: PASS
- **Output / Evidence**:
  - **ESLint (`/home/omni/.nvm/versions/node/v26.2.0/bin/eslint .`)** : `exit 0` (`0` erreur).
  - **Suite complète (`node --test --test-isolation=none tests/*.test.js`)** : `tests 170 | pass 170 | fail 0 | skipped 0`.
  - **Exécutions séquentielles ciblées** : `tests/sidepanel.test.js` (`15/15`), `tests/providers-retry.test.js` (`14/14`), `tests/providers-models.test.js` (`7/7`), `tests/nlp-cleaner.test.js` (`24/24`), `tests/e2e-regressions.test.js --test-isolation=none` (`22/22`).
  - **Limite runner parallèle (`bash .githooks/_common/run-tests.sh` sur hôte 2 cœurs)** : `168/170 PASS` ; échecs ponctuels de timing O(N) sur `tests/nlp-cleaner.test.js:377,397` sous contention CPU parallèle (9 fichiers simultanés ; `24/24 PASS` en séquentiel).
  - **Quality Gate (`bash .githooks/pre-commit` staged + `QUALITY_GATE_SCOPE=full bash .githooks/pre-commit`)** : `7/7 ✅` (`exit 0`, incluant `gitleaks`, bannissement de suppressions, `node --check` + `manifest.json`, Semgrep `.semgrep/rules.yml`, `tests/invariants.test.js`).
  - **Commit local** : `[master 974daa2] feat(sidepanel): add MV3 side panel, zero-trace mode, and panic sync` (`12 files changed, 6422 insertions(+), 192 deletions(-)`).
  - **Audits indépendants `antibug-reviewer` (contexte frais sur `git diff --cached`)** :
    - Passe `3068585a-b70b-41ba-abee-1f42cf55b21e` : 2 findings (`BackgroundAgent.solve()` fuite clé/URL sur échec + flake `< 50ms` `tests/sidepanel.test.js:275`) → corrigés (`x-goog-api-key`, `_sanitizeErrorMessage`, timestamp broadcast Panic + Pass 9).
    - Passe `3a4fcfb3-7463-4f6a-b0ea-21e9e45507d5` : 3 findings (`providers.js` `?key=` & logs + `schema-detector.js:509`, `content.js` ACK `toggleAutoMode`, `analyzeBtn` Panic & garde `uiSeq`) → corrigés (+ Pass 10).
    - Passe `301e4c0a-3703-45cf-a359-5709ae279366` : 4 findings (`callProvider`/`ProviderAnalytics`/`_proxyFetchViaRuntime`/`ModelRegistry`, `handleFetchImage`/`handleFetchLLM`/`handleRuntimeMessage`, auto-écho différé `sidePanelPanicClear` avant Run 2, sur-rédaction placeholders locaux `ollama`/`freecc`) → corrigés (+ `clearId` + `_lastAnalyzeStartedAt` + `NON_SECRET_PLACEHOLDERS` + Pass 11).
    - Passe finale (`05cab5bb-4218-40cd-aab2-60c961e1595b`) : `AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.`
-[Antigravity-app, unknown, unknown]
