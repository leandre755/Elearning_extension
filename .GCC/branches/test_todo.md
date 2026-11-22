# Test Backlog

## Pending Test Scenarios

### Static Checks
- [ ] Scenario: ESLint (non installé localement, pas de `package.json`)
  - Verification: installer ESLint explicitement avec accord mainteneur avant de lancer `npx eslint .` (ne jamais lancer `npx` sans `--no`/installation préalable : prompt npm interactif bloquant)
-[Antigravity-app, Gemini 4 Argon, high]

### Live Browser Runtime (E2E Chromium)
- [ ] Scenario: Chargement de l'extension non empaquetée dans Chromium (`chrome://extensions`) et test E2E sur un quiz réel (Shadow DOM, `page-bridge.js` en `world: 'MAIN'`, badges de confiance et popup analytics)
  - Verification: Inspection manuelle ou test navigateur en environnement graphique avec extension MV3 chargée
-[Antigravity-app, Gemini 4 Argon, high]
