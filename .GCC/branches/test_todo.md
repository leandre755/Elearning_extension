# Test Backlog

## Pending Test Scenarios

### Unit Tests (`node:test`, Node 26 natif — aucun `tests/` n'existe encore)
- [ ] Scenario: Suite `tests/*.test.js` créée par le sprint essaim (voir `.GCC/branches/plan_swarm_core_sprint.md`)
  - Verification: `node --test tests/*.test.js`

### Static Checks
- [ ] Scenario: Syntaxe de tous les scripts et validité du manifest
  - Verification: `for f in *.js tests/*.js; do node --check "$f" || exit 1; done && node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"`
- [ ] Scenario: ESLint (non installé localement, pas de `package.json`)
  - Verification: installer ESLint explicitement avant de lancer `npx eslint .` (ne jamais lancer `npx` sans `--no`/installation préalable : prompt npm interactif bloquant)

### Edge Cases & Regressions
- [ ] Scenario: Furtivité DOM — aucun attribut `data-qh-*`, `system.md` absent de `web_accessible_resources`
  - Verification: `grep -rn "data-qh-" *.js` ne retourne rien ; inspection de `manifest.json`
-[Antigravity-app, Claude Sonnet 5.5, high]
