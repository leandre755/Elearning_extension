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
