# Execution Plan: Intégration massive de 35 fournisseurs LLM (`fcc-server` → 40 total)

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**:
  - `QuizProviders.PROVIDERS` expose exactement les `5` fournisseurs cœur (`groq`, `gemini`, `nvidia`, `mistral`, `claude`) + `35` fournisseurs HTTP REST issus du catalogue `fcc-server` (`40` au total), à l'exclusion de `openai`, `vertex` et `antigravity`.
  - Aucune duplication de code par fournisseur dans les couches d'exécution ; catalogue unique dans `provider-catalog.js`.
  - Politique Anti-SSRF stricte dans `background.js` : `isBlockedImageHost` / `handleFetchImage` strictement inchangés ; `isAllowedLLMUrl` n'autorise que les hôtes cloud HTTPS statiques, les motifs `bedrock-mantle`/`openai.azure.com`, les origines HTTPS publiques configurées dans `chrome.storage.local` (`providerConfigs`), et le loopback HTTP (`localhost`/`127.0.0.1`/`[::1]`) uniquement pour les fournisseurs locaux activés (`lmstudio`, `llamacpp`, `ollama`) ou `openai_compatible`/`anthropic_compatible` configurés ; `redirect: 'error'` forcé sur `handleFetchLLM`.
  - Furtivité DOM et cliquet `.innerHTML` : zéro `data-qh-*`, zéro nouvelle interpolation `.innerHTML = \`...${...}\`` dans `settings.js` (baisse en dessous du baseline `4`) ou `popup.js` (`<= 1`).
  - Rétrocompatibilité totale des tests existants (`DEFAULT_PRIORITY` inchangé, sandboxes VM minimalistes préservés).
- **Pre-requisites**:
  - Node.js v26 (`node --test --test-concurrency=1`), Python + Playwright + `/bin/google-chrome`, Quality Gate `.githooks/pre-commit`, `antibug-reviewer` à contexte frais.
-[Antigravity-app, Gemini 4 Neon, high]

## 🛠️ Step-by-Step Sequence

### Step 1: Catalogue déclaratif `provider-catalog.js` & moteur `providers.js`
- [x] **Action**: Créer `provider-catalog.js` (35 profils + helpers URL/config + `LLM_STATIC_ALLOWED_HOSTS`) et intégrer le catalogue dans `providers.js` (`QuizProviders`, `ConfigCache`, `ModelRegistry`, `_enforceDirectFetchPolicy` avec `redirect: 'error'`).
- [x] **Verify**: `node --check provider-catalog.js && node --check providers.js`
- **Verification Proof**:
```text
extra_count= 35 unique_fields= 35 hosts= 35
node --check provider-catalog.js && node --check providers.js -> exit 0
```
-[Antigravity-app, Gemini 4 Argon, medium]

### Step 2: Service Worker `background.js`, Agent `background-agent.js`, `content.js`, `schema-detector.js`
- [x] **Action**: Charger `provider-catalog.js`, remplacer les listes statiques de clés par `QuizProviders.getAllStorageKeys()`, implémenter `isAllowedLLMUrl(parsedUrl, providerConfigs)` et `hydrateTrustedConfig` avec `redirect: 'error'`, généraliser le dispatch multi-protocole et `_getStrictlyConfiguredProviders` dans `background-agent.js`.
- [x] **Verify**: `node --check background.js && node --check background-agent.js && node --check content.js && node --check schema-detector.js`
- **Verification Proof**:
```text
node --check background.js background-agent.js content.js schema-detector.js -> exit 0
node --test --test-concurrency=1 tests/invariants.test.js tests/security-stealth.test.js -> 19/19 PASS
```
-[Antigravity-app, Gemini 4 Argon, medium]

### Step 3: Interface Utilisateur (`settings.*`, `popup.*`)
- [x] **Action**: Générer dynamiquement les 40 cartes fournisseurs en DOM natif (`createElement` / `textContent`), ajouter recherche/filtres/bouton `Modèles`, validation `validateProviderBaseUrl`, bascules « Afficher tous » sur `#priorityList` et `#modelOverrides`, corriger la spécificité CSS `.setting-item label.checkbox-label`, et mettre à jour `popup.html`/`popup.js`.
- [x] **Verify**: `node --check settings.js && node --check popup.js` + vérification visuelle & fonctionnelle Playwright Chrome (light/dark, `1024×900`).
- **Verification Proof**:
```text
node --check settings.js && node --check popup.js -> exit 0
TAB_CLASSES [['btn-essential', 'tab-btn'], ['btn-providers', 'tab-btn'], ['btn-advanced', 'tab-btn'], ['btn-expert', 'tab-btn tab-expert active']]
PLAYWRIGHT_OK {'total_cards': 40, 'configured_after_reload': 4, 'priority_items': 4, 'override_cards': 4, 'popup_status': '4 clés'} (0 console/page/404 errors)
```
-[Antigravity-app, Gemini 4 Argon, medium]

### Step 4: Suite de tests, Quality Gate, Audit `antibug-reviewer` & Commit local
- [x] **Action**: Ajouter `tests/provider-catalog.test.js` (8 tests unitaires/protocolaires/SSRF/régressions), adapter `tests/e2e-regressions.test.js` (`BUG-01`, `BUG-06b`), exécuter toute la suite séquentielle, `QUALITY_GATE_SCOPE=full bash .githooks/pre-commit`, auditer et corriger 100% des findings `antibug-reviewer` jusqu'à `AUDIT PASSED`, puis commiter localement (`f61df5b`).
- [x] **Verify**: `node --test --test-concurrency=1 tests/*.test.js && QUALITY_GATE_SCOPE=full bash .githooks/pre-commit`
- **Verification Proof**:
```text
$ QUALITY_GATE_SCOPE=full bash .githooks/pre-commit
[Quality Gate] ✅ Toutes les vérifications sont passées (périmètre : full).

$ node --test --test-concurrency=1 tests/*.test.js
ℹ tests 125 | ℹ pass 125 | ℹ fail 0 | ℹ skipped 0

antibug-reviewer (5fb6e6dd-e00c-4541-8908-1d310dd6667c):
AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.

Commit: [master f61df5b] feat(providers): add 35 fcc-server HTTP REST providers with declarative catalog
```
-[Antigravity-app, Gemini 4 Argon, medium]

## ⚠️ Mitigations & Edge Cases
- **Risk**: `tests/invariants.test.js` (`loadBgHelpers`) évalue `background.js` entre `sanitizeUrlForLog` et `handleFetchLLM` dans un contexte `{ URL }` isolé.
  - **Mitigation**: Laisser le bloc `sanitizeUrlForLog..sniffRasterImageMime` strictement isolé et placer `isAllowedLLMUrl` / `isLoopbackHostname` après `handleFetchLLM`.
- **Risk**: Des tests existants (`tests/providers-models.test.js`, `tests/e2e-regressions.test.js`) chargent `background-agent.js` ou `settings.js` avec des mocks partiels de `QuizProviders` et du DOM.
  - **Mitigation**: Garder tous les accès à `ProviderCatalog` / nouveaux helpers `QuizProviders` et nouveaux éléments DOM défensifs avec repli propre.
- **Risk**: Test immédiat (`Tester` / `Modèles`) d'une URL personnalisée ou d'un fournisseur local avant d'avoir cliqué `Enregistrer`.
  - **Mitigation**: Persister `providerConfigs[id]` dans `chrome.storage.local` avant l'appel réseau de test/sync pour que `isAllowedLLMUrl` côté Service Worker reste strictement ancré sur `chrome.storage.local`.
-[Antigravity-app, Gemini 4 Neon, high]
