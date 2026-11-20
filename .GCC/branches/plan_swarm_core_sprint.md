# Execution Plan: Essaim d'Agents Safe Exm — Sprint Cœur & Robustesse (A → Z)

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**:
  - Zéro erreur de syntaxe (`node --check *.js`) et `manifest.json` valide.
  - 100% des tests automatisés verts (`node --test tests/*.test.js`, Node 26 natif sans dépendance externe).
  - Furtivité DOM strictement préservée : zéro attribut `data-qh-*`, stockage métadonnées via `WeakMap`, `system.md` absent de `web_accessible_resources`, injection `MAIN` world via `chrome.scripting.executeScript` uniquement (zéro `<script>` inline dans le DOM).
  - Sécurité réseau : protection Anti-SSRF intacte dans `background.js`, aucun leak de clé API dans les logs.
  - Zéro collision d'édition entre workers (partition stricte par fichier + `workspace: "share"` pour chaque auteur).
- **Pre-requisites**:
  - Node.js `v26.2.0` (`node:test` natif disponible).
  - Base Git propre synchronisée sur `origin/master` (commit `c5bb5ea` et suivants).
  - **Configuration des modèles de l'essaim (consigne utilisateur explicite, vérifiée le 2026-11-19 via `swarm{action:"models", all:true}`)** :
    - **Modèle principal (workers auteurs + `monitor`)** : **Gemini 4 Hydrogen** (`gemini-4-hydrogen-high`)
    - **Modèle reviewer (`verifier` + revue/audit final)** : **Gemini 4 Neon** (`gemini-4-neon-high`)
  - **Contraintes matérielles hôte** : i5-4300U (2c/4t), 8 Go RAM (~3,5 Go dispo) → exécuter les commandes locales (`node --test`, `node --check`) de manière séquentielle, sans paralléliser de navigateurs lourds.

---

## 🎯 Périmètre Exact

### ✅ Inclus dans ce plan (13 livrables)
- `R-TECH-02` & `R-TECH-03` *(déjà dans le code — couverture par tests + synchro `Docs/task_tracking.md`)*
- `R-TECH-01 [P0]` : Pipeline NLP nettoyage PDF/DOCX (`nlp-cleaner.js` + `settings.js`)
- `R-TECH-05 [P2]` : Retry exponentiel réseau `5xx`/`429` (`Retry-After` + jitter + `AbortSignal`) dans `providers.js`
- `F-CTX-04` : Extension import multi-format (`.txt`, `.md`, `.html`, `.csv` en plus de PDF/DOCX)
- `F-ANA-03` : Provider Performance Analytics (`providerStats` dans `chrome.storage.local` + résumé popup)
- `F-DET-02` : Traversée récursive Shadow DOM (`querySelectorAllDeep` avec `WeakSet` anti-cycles)
- `F-DET-01` : Formats universels de quiz (`radio`/`checkbox`/ARIA, `<select>`/Matching, Fill-in-the-blank, Drag-and-Drop)
- `F-DET-03` : Extraction défensive state React (`__reactFiber$`) / Vue (`__vue__`) via `page-bridge.js`
- `F-DET-04` : Interception passive Fetch/XHR (tampon circulaire borné en mémoire, opt-in) via `page-bridge.js`
- `F-INT-03` : Règles modulaires par domaine (`{{domain_rules}}` dans `system.md` + presets + UI settings)
- `F-INT-04` : Cross-Validation Engine (double appel provider différent et/ou web search si `confidence < 70%`)
- `F-INT-02` + `F-UX-02` : Badge discret de confiance (Vert/Orange/Rouge) + tooltip éphémère au survol (`WeakMap`)
- `F-AUTO-02` + `F-AUTO-03` : Pre-Analysis warm-up providers + Auto-Submit opt-in (jitter humain, seuil confiance, Panic-safe)

### ⏭️ Explicitement hors périmètre (sessions ultérieures)
- `R-TECH-04` (Tiktoken WASM vendored)
- `F-CTX-01` (Vector Store Gemini Embeddings), `F-CTX-02` (Knowledge Graph), `F-CTX-03` (Scraping LMS)
- `F-ANA-01` (Learning Dashboard complet), `F-ANA-02` (Difficulty Tracker)
- `F-EXT-01` (Adaptateurs natifs Moodle/Canvas/Blackboard/Kahoot), `F-EXT-02` (Export Anki)
- `F-UX-01` (Side Panel), `F-UX-03` (Command Palette), `F-UX-04` (Onboarding Wizard), `F-AUTO-04` (Multi-Tab Orchestration)

---

## 🛠️ Step-by-Step Sequence

### Step 1: Initialisation de l'Essaim & Lancement Vague 1 (4 Auteurs + 1 Reviewer + 1 Monitor)
- [ ] **Action**:
  1. Charger le skill `swarm` (`/home/omni/.gemini/antigravity/builtin/skills/native_swarm/SKILL.md`).
  2. Nommer l'essaim : `swarm{action:"title", title:"Safe Exm — Core & Robustness Sprint"}`.
  3. Spawner en parallèle (tous dans le même tour) :
     - **`monitor`** (`workspace: "inherit"`, `model: "gemini-4-hydrogen-high"`) : charge `swarm_monitor`, surveille les blocages silencieux.
     - **`verifier`** (`workspace: "inherit"`, `model: "gemini-4-neon-high"`) : **Reviewer principal**. Propriétaire exclusif de `tests/*.test.js`. Écrit la suite de tests `node:test` sans dépendance externe (NLP, Retry/Analytics, Shadow DOM/Formats, Domain Rules/Cross-Validation, Sécurité/Furtivité) et audite chaque branche Vague 1 avant validation.
     - **`nlp-settings`** (`workspace: "share"`, `model: "gemini-4-hydrogen-high"`) : propriétaire exclusif de `nlp-cleaner.js` *(nouveau)*, `settings.js`, `settings.html`, `settings.css`. Implémente `R-TECH-01`, extension `F-CTX-04` (`.txt/.md/.html/.csv`), et les champs UI (`domainRules`, `crossValidation`, `autoSubmit` opt-in). Inclut `<script src="nlp-cleaner.js"></script>` dans `settings.html`. Committe sur sa branche et poste `@verifier [done]`.
     - **`resilience-net`** (`workspace: "share"`, `model: "gemini-4-hydrogen-high"`) : propriétaire exclusif de `providers.js`. Implémente `R-TECH-05` (`fetchWithRetry` backoff exponentiel `500ms/1s/2s` + jitter + `Retry-After` + `AbortSignal`), `F-ANA-03` (`ProviderAnalytics` coalescé dans `chrome.storage.local`), et `F-AUTO-02` (`preWarmProviders()`). Export compatible Node (`module.exports`). Committe sur sa branche et poste `@verifier [done]`.
     - **`dom-engine`** (`workspace: "share"`, `model: "gemini-4-hydrogen-high"`) : propriétaire exclusif de `dom-extractor.js` et `page-bridge.js` *(nouveau)*. Implémente `F-DET-02` (`querySelectorAllDeep` Shadow DOM + `WeakSet` anti-cycles + profondeur max 12), `F-DET-01` (formats universels ARIA/`select`/Fill-in-the-blank/DnD), `F-DET-03` (lecture défensive `__reactFiber$`/`__vue__`), `F-DET-04` (interception passive Fetch/XHR en tampon circulaire borné). Export compatible Node. Committe sur sa branche et poste `@verifier [done]`.
     - **`agent-intel`** (`workspace: "share"`, `model: "gemini-4-hydrogen-high"`) : propriétaire exclusif de `background-agent.js` et `system.md`. Implémente `F-INT-03` (`{{domain_rules}}` + presets `law/medicine/cs/math/general` + détection auto + fusion custom), `F-INT-04` (Cross-Validation Engine si `confidence < 70%`, budget max 5 questions, second provider différent et/ou `web_search`), et normalisation `F-INT-02` (`confidence`, `confidenceTier`, `explanation`). Export compatible Node. Committe sur sa branche et poste `@verifier [done]`.
- [ ] **Verify**: Chaque auteur reçoit `@coordinator [verified]` de `verifier` (Gemini 4 Neon) après revue de diff + passage des tests ciblés.
- **Verification Proof**:
```text
(À compléter lors de l'exécution en session suivante)
```

### Step 2: Gate 1 — Merge Vague 1 & Validation Intermédiaire
- [ ] **Action**:
  1. Merger séquentiellement dans `master` les 4 branches validées (`nlp-settings`, `resilience-net`, `dom-engine`, `agent-intel`).
  2. Vérifier l'absence totale de conflit et lancer la validation statique + tests Vague 1.
  3. Terminer proprement (`swarm{action:"kill"}`) les 4 auteurs Vague 1 après confirmation du merge (garder `verifier` et `monitor` actifs).
- [ ] **Verify**: `for f in *.js tests/*.js; do node --check "$f" || exit 1; done && node --test tests/*.test.js`
- **Verification Proof**:
```text
(À compléter lors de l'exécution en session suivante)
```

### Step 3: Lancement Vague 2 — Intégration UI & Background (2 Auteurs + `verifier` existant)
- [ ] **Action**: Spawner 2 auteurs Vague 2 sur la base `master` fraîchement mergée :
  - **`integrator-ui`** (`workspace: "share"`, `model: "gemini-4-hydrogen-high"`) : propriétaire exclusif de `content.js`, `highlight-manager.js`, `popup.js`, `popup.html`, `popup.css`, `content.css`.
    - Implémente `F-INT-02` + `F-UX-02` (badge confiance Vert/Orange/Rouge + tooltip éphémère au survol stockés en `WeakMap`, zéro `data-qh-*`, effacement `<50ms` sur `clearAllHighlights()`).
    - Implémente `F-AUTO-03` (Auto-Submit opt-in, désactivé par défaut, jitter humain configurable, événements natifs `input`/`change`/`click`, annulable instantanément par Panic Button `Ctrl+Shift+E`).
    - Implémente `F-AUTO-02` côté page (message `preWarm` léger) + affichage synthétique `F-ANA-03` dans `popup.html`/`popup.js`.
    - Committe sur sa branche et poste `@verifier [done]`.
  - **`integrator-bg`** (`workspace: "share"`, `model: "gemini-4-hydrogen-high"`) : propriétaire exclusif de `background.js`, `manifest.json`, `eslint.config.js`, `Docs/task_tracking.md`.
    - Câble les messages `preWarm`, `getProviderStats`, et l'exécution à la demande de `page-bridge.js` via `chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['page-bridge.js'] })`.
    - Met à jour `manifest.json` (permissions minimales, `system.md` toujours exclu de `web_accessible_resources`) et `eslint.config.js` (nouveaux globals).
    - Met à jour `Docs/task_tracking.md` en cochant uniquement ce qui est vérifié dans le code (`R-TECH-01/02/03/05` et features livrées).
    - Committe sur sa branche et poste `@verifier [done]`.
- [ ] **Verify**: `verifier` (Gemini 4 Neon) valide les deux branches Vague 2 et complète les tests d'intégration + sécurité/furtivité.
- **Verification Proof**:
```text
(À compléter lors de l'exécution en session suivante)
```

### Step 4: Gate 2 — Merge Vague 2, Suite de Tests Complète & Audit Forensic (`antibug`)
- [ ] **Action**:
  1. Merger les 2 branches Vague 2 dans `master`, puis `kill` les auteurs Vague 2.
  2. Exécuter la suite complète des 6 niveaux de vérification :
     - Syntaxe JS & JSON (`node --check *.js tests/*.js` + `JSON.parse(manifest.json)`).
     - `node --test tests/nlp-cleaner.test.js`
     - `node --test tests/providers-retry.test.js`
     - `node --test tests/dom-extractor.test.js`
     - `node --test tests/agent-intel.test.js`
     - `node --test tests/security-stealth.test.js`
  3. Lancer le subagent **`antibug`** sur `git diff c5bb5ea..HEAD` pour un audit forensic (race conditions, fuites mémoire, failles XSS/SSRF, ruptures de furtivité).
  4. Corriger tout défaut remonté (via `verifier` / auteur dédié), re-valider 100% des tests, puis poster `[done]` sur le board (pour endormir `monitor`) et `kill` les workers restants.
- [ ] **Verify**: `for f in *.js tests/*.js; do node --check "$f" || exit 1; done && node --test tests/*.test.js`
- **Verification Proof**:
```text
(À compléter lors de l'exécution en session suivante)
```

### Step 5: Clôture GCC, Commits Conventionnels & Push GitHub
- [ ] **Action**:
  1. Vérifier `git status`, absence totale de secrets dans le diff.
  2. Organiser des commits conventionnels propres (comprenant le code, les tests et la mise à jour de `.GCC/main.md`, `.GCC/resume.md`, `Docs/task_tracking.md`).
  3. Exécuter `git push origin master` (si confirmé par l'utilisateur) et vérifier la synchronisation distante (`git status -sb` + `git ls-remote`).
- [ ] **Verify**: `git status -sb && git log -n 5 --oneline`
- **Verification Proof**:
```text
(À compléter lors de l'exécution en session suivante)
```

---

## ⚠️ Mitigations & Edge Cases
- **Risk**: Contournement CSP / traces DOM lors de l'extraction React/Vue (`F-DET-03`) ou interception Fetch/XHR (`F-DET-04`).
  - **Mitigation**: Injection exclusive via `chrome.scripting.executeScript({ world: 'MAIN', files: ['page-bridge.js'] })` depuis `background.js` (bypass CSP MV3, aucune balise `<script>` dans le DOM) ; interception Fetch/XHR passive, opt-in et bornée en mémoire.
- **Risk**: Soumission involontaire ou trop rapide en mode `Auto-Submit` (`F-AUTO-03`).
  - **Mitigation**: Désactivé par défaut (`false`), seuil de confiance minimal strict (`≥ 85%`), délai jitter humain configurable et annulation instantanée via `AbortController` + Panic Button (`Ctrl+Shift+E`).
- **Risk**: Épuisement de quota sur `gemini-4-hydrogen-high` ou `gemini-4-neon-high` en cours d'essaim.
  - **Mitigation**: Surveiller `swarm{action:"models"}` ; en cas d'alerte `[quota]`, basculer le worker en état `waiting` avec `swarm{action:"model", ...}` (sans jamais `kill` + re-`add`) et informer l'utilisateur.
- **Risk**: Saturation RAM locale (8 Go hôte) si plusieurs workers lancent des commandes lourdes en même temps.
  - **Mitigation**: Centraliser l'exécution des suites de tests chez `verifier` séquentiellement ; limiter les auteurs aux vérifications rapides `node --check`.
