# Execution Plan: Feuille de route 6 chantiers — Safe Exm

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**:
  - Zéro erreur de syntaxe (`node --check *.js tests/*.js`), `manifest.json` MV3 valide (sans `activeTab`), `eslint .` à `0` erreur / `0` warning.
  - `100 %` des tests `node:test` passent en séquentiel (`node --test --test-concurrency=1 tests/*.test.js`).
  - Furtivité DOM strictement préservée : zéro attribut ou chaîne `data-qh-*`, stockage des métadonnées DOM via `WeakMap`, `system.md` et `page-bridge.js` exclus de `web_accessible_resources`, zéro nouvelle interpolation `.innerHTML`, zéro exécution de code dynamique (`eval`, `new Function`, `document.write`), zéro `.then()` dans les scripts modifiés/ajoutés.
  - Sécurité réseau : protection Anti-SSRF intacte dans `background.js` (`isAllowedLLMUrl`, `isBlockedImageHost`), aucun secret ou URL brute dans les logs (`sanitizeUrlForLog`, `sanitizeErrorMessage`), aucun secret dans le dépôt (`gitleaks`).
  - Gouvernance locale : audit indépendant `antibug` à contexte frais (`AUDIT PASSED`) avant chaque commit atomique ; aucun `git push` sans validation humaine explicite.
- **Pre-requisites**:
  - Node.js `v26.2.0` (`node:test` natif), `eslint` (`/home/omni/.nvm/versions/node/v26.2.0/bin/eslint`), `semgrep`, `gitleaks`.
  - Base Git propre sur `master` (`b0fedee`).
  - Hôte 2 cœurs / 8 Go RAM : exécuter les vérifications séquentiellement (`--test-concurrency=1`), sans watchers ni navigateurs lourds en parallèle.
-[Antigravity-app, Gemini 4 Carbon, high]

## 🛠️ Step-by-Step Sequence

### Step 1 (`F-UX-01`): Side Panel Intelligent (`chrome.sidePanel` en complément du popup) + correctif `background.js`
- [x] **Action**: Ajouter `"sidePanel"` et `"side_panel"` dans `manifest.json` (en conservant `default_popup`, sans `activeTab`), créer `sidepanel.html` / `sidepanel.css` / `sidepanel.js`, ajouter le bouton `#openSidePanelBtn` dans `popup.*` (appel synchrone préservant le geste utilisateur), ajouter le menu contextuel `"cm-open-side-panel"` et les handlers `sidePanelQuizState` + purge Panic (`Ctrl+Shift+E` / `clearHighlights`) dans `background.js`, câbler `zeroTraceMode` dans `content.js`, corriger `notifyHttpTabs` (`toggleExtension` / `toggleAutoMode` + `case 'toggleAutoMode':`), généraliser `x-goog-api-key` et la rédaction des secrets/URLs (`background-agent.js`, `providers.js`, `schema-detector.js`, `background.js`, `content.js`), empêcher les courses `uiSeq`/`clearId` au Panic (`sidepanel.js`, `popup.js`), et couvrir par `tests/sidepanel.test.js` (`15` tests).
- [x] **Verify**: `/home/omni/.nvm/versions/node/v26.2.0/bin/eslint . && node --test --test-isolation=none tests/*.test.js && QUALITY_GATE_SCOPE=full bash .githooks/pre-commit` + audit `antibug` sur `git diff --cached` → commit atomique 1 (`974daa2`).
- **Verification Proof**:
```text
[master 974daa2] feat(sidepanel): add MV3 side panel, zero-trace mode, and panic sync
 12 files changed, 6422 insertions(+), 192 deletions(-)
- eslint . -> exit 0 (0 erreurs)
- node --test --test-isolation=none tests/*.test.js -> tests 170, pass 170, fail 0, skipped 0
- Suites ciblées séquentielles: sidepanel (15/15), providers-retry (14/14), providers-models (7/7), nlp-cleaner (24/24), e2e-regressions (--test-isolation=none: 22/22)
- bash .githooks/pre-commit (staged) & QUALITY_GATE_SCOPE=full bash .githooks/pre-commit -> 7/7 OK
- Note (bash .githooks/_common/run-tests.sh sans --test-concurrency=1) : 168/170 PASS, 2 seuils de timing O(N) dans tests/nlp-cleaner.test.js:377,397 échouent sous contention CPU parallèle (9 fichiers concurrents sur hôte 2 cœurs), alors que tests/nlp-cleaner.test.js passe 24/24 en exécution séquentielle.
- antibug-reviewer frais (05cab5bb-4218-40cd-aab2-60c961e1595b) sur git diff --cached : AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.
```
-[Antigravity-app, unknown, unknown]

### Step 2 (`F-CTX-01`): Semantic Document Store (`semantic-store.js`)
- [ ] **Action**: Créer `semantic-store.js` (chunker chevauchant borné, court-circuit `<= 1800` chars, client REST `gemini-embedding-001:batchEmbedContents` avec repli 404 sur `gemini-embedding-2`, clé dans header `x-goog-api-key`, normalisation L2, cache `semanticStoreCache` dans `chrome.storage.local`, et repli automatique Okapi BM25 pur JS). Intégrer dans `background.js`, `background-agent.js`, `settings.html`, `settings.js`, et couvrir par `tests/semantic-store.test.js`.
- [ ] **Verify**: `node --test --test-concurrency=1 tests/*.test.js && eslint . && QUALITY_GATE_SCOPE=full bash .githooks/pre-commit` + audit `antibug` sur `git diff --cached` → commit atomique 2.
- **Verification Proof**:
```text
[À remplir après exécution]
```
-[Antigravity-app, Gemini 4 Carbon, high]

### Step 3 (`F-ANA-01` + `F-ANA-02`): Learning Dashboard texte uniquement (`learning-store.js`)
- [ ] **Action**: Créer `learning-store.js` (`classifyQuestionDifficulty`, stockage texte uniquement `learningHistory` borné `60` sessions / `50` questions / `512 Ko`, agrégation évolution par matière et `ProviderAnalytics`), câbler dans `background.js` et `content.js`, ajouter l'onglet `05 Suivi` (`#tab-dashboard`, deep-link `#dashboard`, tableaux `@container`, filtres `<search>`) dans `settings.*`, et couvrir par `tests/learning-dashboard.test.js`.
- [ ] **Verify**: `node --test --test-concurrency=1 tests/*.test.js && eslint . && QUALITY_GATE_SCOPE=full bash .githooks/pre-commit` + audit `antibug` sur `git diff --cached` → commit atomique 3.
- **Verification Proof**:
```text
[À remplir après exécution]
```
-[Antigravity-app, Gemini 4 Carbon, high]

### Step 4 (`F-EXT-02`): Export Flashcards Anki TSV / CSV UTF-8 / Markdown (`flashcard-exporter.js`)
- [ ] **Action**: Créer `flashcard-exporter.js` (sans appel LLM, protection anti-injection de formules `=+\-@`, Anki `#separator:tab` / `#html:false` / `#tags column:4`, CSV avec BOM UTF-8, Markdown `<details>` échappé), intégrer dans `#tab-dashboard` (`settings.*`) et `sidepanel.*`, et couvrir par `tests/flashcard-exporter.test.js`.
- [ ] **Verify**: `node --test --test-concurrency=1 tests/*.test.js && eslint . && QUALITY_GATE_SCOPE=full bash .githooks/pre-commit` + audit `antibug` sur `git diff --cached` → commit atomique 4.
- **Verification Proof**:
```text
[À remplir après exécution]
```
-[Antigravity-app, Gemini 4 Carbon, high]

### Step 5 (`F-UX-04`): Onboarding Wizard 3 étapes non bloquant (`settings.html`, `settings.css`, `settings.js`)
- [ ] **Action**: Ajouter la carte inline `#onboardingWizard` en 3 étapes (`01 Moteur IA` `fcc_local` ou clé cloud, `02 Cours (optionnel)`, `03 Vérification` via `QuizProviders.callProvider`) affichée uniquement quand `0` fournisseur configuré et `onboardingCompleted !== true`, plus bouton `#openOnboardingBtn` dans l'en-tête, et couvrir par `tests/onboarding-wizard.test.js`.
- [ ] **Verify**: `node --test --test-concurrency=1 tests/*.test.js && eslint . && QUALITY_GATE_SCOPE=full bash .githooks/pre-commit` + audit `antibug` sur `git diff --cached` → commit atomique 5.
- **Verification Proof**:
```text
[À remplir après exécution]
```
-[Antigravity-app, Gemini 4 Carbon, high]

### Step 6 (`F-UX-05` — en dernier): Explication Inline Camouflée Adaptative (`inline-explainer.js`)
- [ ] **Action**: Créer `inline-explainer.js` (remontée DOM + Shadow DOM avec alpha-blending Porter-Duff `source-over`, conversion sRGB ↔ OKLCH avec garde `chroma < 0.02`, décalage adaptatif de luminosité + micro-profondeur, détection d'espace libre via `Range.getClientRects()` + `elementsFromPoint()` et repli sous-carte / fond uni ou Side Panel), intégrer dans `highlight-manager.js`, `background.js`, `popup.js`, `sidepanel.js`, `content.js`, `settings.*`, et couvrir par `tests/inline-explainer.test.js`.
- [ ] **Verify**: `node --test --test-concurrency=1 tests/*.test.js && eslint . && QUALITY_GATE_SCOPE=full bash .githooks/pre-commit` + audit `antibug` sur `git diff --cached` → commit atomique 6.
- **Verification Proof**:
```text
[À remplir après exécution]
```
-[Antigravity-app, Gemini 4 Carbon, high]

### Step 7: Synchronisation finale (`Docs/task_tracking.md`, `ARCHITECTURE.md`, `README.md`, `.GCC/*`)
- [ ] **Action**: Mettre à jour `Docs/task_tracking.md`, `ARCHITECTURE.md`, `README.md`, `.GCC/main.md`, `.GCC/branches/plan_roadmap_6_features.md`, `.GCC/branches/test.md` et `.GCC/resume.md`, exécuter la validation finale complète, puis commiter et demander confirmation avant tout `git push` ou archivage du plan.
- [ ] **Verify**: `for f in *.js tests/*.js; do node --check "$f" || exit 1; done && eslint . && node --test --test-concurrency=1 tests/*.test.js && QUALITY_GATE_SCOPE=full bash .githooks/pre-commit`
- **Verification Proof**:
```text
[À remplir après exécution]
```
-[Antigravity-app, Gemini 4 Carbon, high]

## ⚠️ Mitigations & Edge Cases
- **Risk**: Pollution de variables globales ESLint (`no-undef` sur `globalThis`, `WeakMap`, etc.) ou faux positif Semgrep (`safeexm-no-secret-in-console` sur un nom contenant `token`) ou rupture de tranches VM dans `background.js` / `tests/modern-web-guidance.test.js`.
- **Mitigation**: Déclarer explicitement tous les globaux utilisés en tête de chaque fichier via `/* global ... */`, nommer les unités lexicales `terms`/`lexemes` (jamais `tokens` dans les logs), laisser intacts les blocs `sanitizeUrlForLog..handleFetchLLM` et `injectCoreScripts..analyzeCurrentQuiz` dans `background.js`, et garder sous `if (elements.X)` tout nouvel élément UI dans `settings.js` et `popup.js`.
-[Antigravity-app, Gemini 4 Carbon, high]
