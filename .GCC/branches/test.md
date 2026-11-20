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
