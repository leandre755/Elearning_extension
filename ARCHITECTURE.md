# Architecture — Safe Exm

Extension Chrome **Manifest V3** sans bundler ni `package.json` (`ecmaVersion: 2022`, `sourceType: "script"`, cf. [eslint.config.js](eslint.config.js)).

## 1. Flux d'exécution

```
Page Web
  └─ loader.js (content_script léger sur <all_urls>, document_end)
       │ détecte l'activation et demande l'injection au service worker
       ▼
background.js (Service Worker MV3)
  ├─ importScripts('providers.js', 'background-agent.js')
  ├─ injectCoreScripts(tabId)  [mutex _injectionsInProgress]
  │    └─ injecte séquentiellement dans la page :
  │         providers.js → schema-cache.js → schema-detector.js
  │         → dom-extractor.js → highlight-manager.js → content.js
  ├─ Proxy réseau LLM + Proxy image avec garde Anti-SSRF (isPrivateHost + protocole)
  └─ Service de lecture privée de system.md (absent de web_accessible_resources)
```

## 2. Inventaire des fichiers

| Fichier | Rôle | Contexte d'exécution |
|---|---|---|
| `manifest.json` | Déclaration MV3, permissions (`tabs`, `activeTab`, `storage`, `scripting`, `notifications`, `contextMenus`) | Extension |
| `loader.js` | Détecteur léger injecté sur toutes les pages ; déclenche l'injection du cœur à la demande | Content script |
| `background.js` | Service worker : routage des messages, mutex d'injection, proxy LLM/images (Anti-SSRF), `sanitizeUrlForLog()`, lecture de `system.md` | Service worker |
| `providers.js` | `ConfigCache`, `ModelRegistry` (découverte dynamique + TTL 24h), `QuizProviders` (Gemini, Claude, Groq, Mistral/Codestral, NVIDIA NIM) avec fallback interne et thinking natif | Service worker & Content script |
| `background-agent.js` | Agent autonome ReAct + adaptateurs tool-calling multi-provider (`_planStrategy`, `_executeReActLoop`, `_validateAndRetry`, mémoire) | Service worker |
| `schema-cache.js` | Cache persistant des schémas DOM découverts par domaine (`chrome.storage.local`) | Content script |
| `schema-detector.js` | Analyse DOM par LLM pour inférer la structure d'un quiz inconnu | Content script |
| `dom-extractor.js` | Extraction sémantique des questions/options et capture d'images | Content script |
| `highlight-manager.js` | Surlignage furtif (métadonnées en `WeakMap`, `_styleTagId` aléatoire par session, suspension des observers pour l'Auto-Heal, fallback `document.head`) | Content script |
| `content.js` | Orchestrateur côté page + parseur multi-stratégies de réponses XML `<quiz_answers>` | Content script |
| `content.css` | Styles injectés de base | Content script |
| `system.md` | Prompt système détaché + few-shots XML (servi uniquement via message au service worker) | Ressource interne |
| `popup.html` / `popup.js` / `popup.css` | Interface rapide (bouton d'analyse, barre de progression, état fournisseurs/erreurs) | Popup extension |
| `settings.html` / `settings.js` / `settings.css` | Page d'options (`options_page`), clés API, priorité providers, import PDF/DOCX | Options extension |
| `lib/` | Bibliothèques vendored (`pdf.min.js`, `pdf.worker.min.js`, `mammoth.browser.min.js`) — non modifiables | Options extension |
| `bench.js` | Utilitaire de benchmark manuel dans la console du service worker | Dev / manuel |
| `randomize_name.js` | Script Node local pour brouiller le nom dans `manifest.json` | Dev / CLI Node |

## 3. Gouvernance, qualité et tests

- **`.GCC/`** : persistance de session entre agents (`PROTOCOL.md`, `main.md`, `resume.md`, `scratch.md`, `branches/`).
- **`.githooks/`** : 3 hooks autonomes (`pre-commit`, `commit-msg`, `pre-push`) + `_common/run-tests.sh`.
- **`.semgrep/rules.yml`** : règles locales hors-ligne (code dynamique, MV2, code distant, `data-qh-*`, secrets en console, `postMessage` wildcard).
- **`tests/invariants.test.js`** : suite `node:test` (Node 26 natif) vérifiant manifest MV3, furtivité, absence d'`eval`/remote code, Anti-SSRF, `sanitizeUrlForLog()`, et cliquet sur `.innerHTML` avec interpolation.
- **`.gouvernance/`** : politiques locales (`accompanied-agent.md`, `autonomous-agent.md`, `review-policy.md`, `GOVERNANCE.md`, `antibug-prompt.md`).
- **`.coding-stuff/`** : modèles de profils de permissions (`antigravity-permissions.example.json`, `codex-config.example.toml`).
- **`Docs/`** : analyses et feuille de route (`Docs/task_tracking.md`).
