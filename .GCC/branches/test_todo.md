# Test Backlog

## Pending Test Scenarios

### Static Checks
- [ ] Scenario: ESLint (non installé localement, pas de `package.json`)
  - Verification: installer ESLint explicitement avec accord mainteneur avant de lancer `npx eslint .` (ne jamais lancer `npx` sans `--no`/installation préalable : prompt npm interactif bloquant)
-[Antigravity-app, Gemini 4 Argon, high]

### Live Browser Runtime (E2E Chromium)
- [x] Scenario: Chargement de l'extension non empaquetée dans Brave/Chromium (`--load-extension`) et test E2E complet (6 formats, Shadow DOM, `page-bridge.js` `world: 'MAIN'`, Mode Auto/Auto-Submit, résilience LLM, Anti-SSRF, `fcc-server` live sur `mock_quiz.html` et sites publics) — Exécuté le 2026-11-22 (25/25 vérifications déterministes PASS, 9 bugs réels consignés `BUG-01`..`BUG-09` dans `.GCC/branches/test.md`).
- [x] Scenario: Ré-exécution E2E ciblée après correction de `BUG-01`..`BUG-09` (Fireworks UI, `select_matching`/`drag_drop` prompt/parser, classes statiques badges/float, câblage `passiveNetworkIntercept`, télémétrie `ProviderAnalytics`, contrat `getSchemaStatus`/`discoverSchema`, Auto-Heal parent `childList`, `buildDOMSkeleton` SVG/W3Schools, extraction consigne W3docs) + vérification action popup native sur onglet quiz réel — Revalidé le 2026-11-22 : 30/30 PASS (`pageErrorsCount: 0`, `bugsObservedCount: 0`) sur `run_e2e_deterministic.py`, 5/5 sites extraits et surlignés en live via `fcc-server` (`run_e2e_live.py`, captures inspectées) et 117/117 tests unitaires séquentiels PASS (y compris `tests/e2e-regressions.test.js`).
-[Antigravity-app, unknown, unknown]
