# Execution Plan: Mise en conformité Modern Web Guidance & Manifest V3

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Aligner Safe Exm sur les guides `modern-web-guidance` et `chrome-extensions` (MV3) en conservant à 100 % l'esthétique GRAPHITE (Papier Coton `#F5F2EB` / Ardoise `#0D0D0E`, grille fine, Caveat Brush, accent N3), sans dépendance externe, sans édition de fichier protégé, sans `text-decoration-skip-spaces` (porte volatile), sans `structuredClone` (absent de `eslint.config.js`), et sans casser le contrat `AbortError` dans `providers.js` / `background-agent.js`.
- **Pre-requisites**: Node v26 (`node --test`), `pnpx modern-web-guidance@latest`, Google Chrome (`/bin/google-chrome` via Playwright pour la vérification visuelle finale), et `antibug-reviewer`.
-[Antigravity, Gemini 4 Neon, XHigh]

## 🛠️ Step-by-Step Sequence

### Step 1: Bootstrap GCC & décision architecturale
- [x] **Action**: Lire `.GCC/PROTOCOL.md`, `.gouvernance/accompanied-agent.md`, `.gouvernance/review-policy.md`, `.gouvernance/antibug-prompt.md` et créer ce plan + l'entrée `.GCC/main.md`.
- [x] **Verify**: Contrôle visuel de présence et signature `-[Antigravity, Gemini 4 Neon, XHigh]`.
- **Verification Proof**:
```text
.GCC/branches/plan_modern_web_guidance.md créé et enregistré dans .GCC/main.md avec décision architecturale du 2026-11-23.
```

### Step 2: Thème sombre FOUC-free, retour système & synchronisation (`theme-init.js`, `popup.*`, `settings.*`)
- [x] **Action**: Créer `theme-init.js`, l'inclure dans `popup.html` et `settings.html` avec `<meta name="color-scheme" content="light dark">`, puis raccorder `popup.js` et `settings.js` (avec fallback VM si `theme-init.js` n'est pas chargé dans un test isolé).
- [x] **Verify**: `node --check theme-init.js popup.js settings.js` et tests unitaires `theme-init.js`.
- **Verification Proof**:
```text
✔ theme-init.js: FOUC-free bootstrap, system mode return, matchMedia change & cross-tab sync (11.428885ms)
CHROME_UI_VERIFY_PASS: color-scheme transitions light dark -> dark -> light dark (0 errors)
```

### Step 3: CSS GRAPHITE moderne, contrastes WCAG, focus, `forced-colors`, `prefers-reduced-motion`, typographie `rem`
- [x] **Action**: Mettre à jour `popup.css` et `settings.css` (`color-scheme`, `--border-control`, `--ink-muted`, `--n3-gradient-cta`, `--progress-track-fill`, `--danger-hover-bg`, `scrollbar-color` + `@supports not (scrollbar-color: auto)`, soulignement natif sans propriété volatile, reset ciblé, `:focus-visible` sans clipping, `@media (forced-colors: active)`, `@media (prefers-reduced-motion: no-preference)`, `::details-content`, `<progress>`, `<dialog>`, `.priority-actions`).
- [x] **Verify**: Contrôle contrastes + `legacy-scan popup.css` / `legacy-scan settings.css`.
- **Verification Proof**:
```text
Modern Web Guidance Analyzer — popup.css : 0 findings from 38 qualified guides.
Modern Web Guidance Analyzer — settings.css : 0 findings from 38 qualified guides.
WCAG 2.1 AA : --ink-muted light 5.52..6.14:1, --success-color #166534 (5.46..6.72:1), --warning-color #92400E (5.43..6.68:1), --danger-hover-bg #B91C1C w/ #FFFFFF (6.47:1), light <progress> --n3-gradient-cta on #E8E3D7 (4.04..5.23:1) + 1px border (3.41:1).
```

### Step 4: Sémantique HTML, accessibilité clavier & JS (`popup.html`/`.js`, `settings.html`/`.js`)
- [x] **Action**: `<progress>` natif, extraction `#resetStatsBtn` hors `<summary>`, régions `aria-live`, onglets clavier + `hidden="until-found"` + `beforematch`, réordonnancement clavier `#priorityList` (même à 0 fournisseur configuré) + annonceur, modale `<dialog id="resetConfirmDialog">`, suppression des 3 `.innerHTML`, suppression des `.then()` dans `settings.js`, déclaration `/* global CourseMedia */`.
- [x] **Verify**: `eslint` + `node --check` + `legacy-scan` + tests VM + Playwright Chrome.
- **Verification Proof**:
```text
eslint theme-init.js popup.js settings.js background.js content.js highlight-manager.js tests/modern-web-guidance.test.js -> exit 0 (0 errors, 0 warnings)
✔ settings.js: accessible tabs (keyboard + beforematch), priority keyboard reorder, <dialog> reset, zero innerHTML (212.150336ms)
✔ settings.js: priorityList preserves user reorder even when zero providers are configured (7.838193ms)
✔ popup.js: native <progress> value/error state and live announcer updates (3.999905ms)
CHROME_UI_VERIFY_PASS: popup_light, popup_dark, settings_light, settings_dark, settings_dialog verified cleanly (0 errors)
```

### Step 5: Service Worker, content scripts, batching surlignage & manifest (`background.js`, `content.js`, `highlight-manager.js`, `manifest.json`, `ARCHITECTURE.md`)
- [x] **Action**: `AbortSignal.timeout(15000)` dans `handleFetchImage`, `chrome.storage.session` pour la signature pre-warm, `contextMenus.removeAll` + notifications de retour, `async`/`await` dans `handleRuntimeMessage`/`onConnect`/`content.js`, batching `requestAnimationFrame`/`visibilitychange`/`scheduler.yield()` + `_applyGeneration` dans `highlight-manager.js`, annulation complète pré-LLM / port / debounce auto-mode dans `content.js`, retrait `activeTab` redondant dans `manifest.json`, mise à jour `ARCHITECTURE.md`.
- [x] **Verify**: `node --check` + `eslint` + `legacy-scan` + tests unitaires dédiés.
- **Verification Proof**:
```text
✔ background.js: chrome.storage.session pre-warm persistence across SW restart, context menu feedback, AbortSignal.timeout, and async/await (7.728692ms)
✔ highlight-manager.js: batches > 15 questions with rAF/scheduler.yield and cancels safely on clearAllHighlights (43.678877ms)
✔ highlight-manager.js: applyHighlights runs setupHighlightObservers() after NEEDS_HEAL repairDeadNodes() (2.737091ms)
✔ content.js: Panic/clearHighlights mid-batch aborts handleAnalyzeQuiz cleanly without auto-submit, delta poisoning, or 100% progress (117.611915ms)
✔ content.js: ConfigCache.onChange and pre-LLM await cancellation abort before solveQuiz port or discoverSchema (37.175567ms)
✔ content.js: pending Auto Mode debounce timer is cleared and ignored when extension is disabled (10.542486ms)
```

### Step 6: Suite de tests, Chrome réel (Playwright), Quality Gate `full` & Audit `antibug`
- [x] **Action**: Ajouter `tests/modern-web-guidance.test.js`, exécuter `node --test --test-concurrency=1 tests/*.test.js`, `legacy-scan`, `eslint`, `QUALITY_GATE_SCOPE=full bash .githooks/pre-commit`, vérifier le rendu Chrome clair/sombre et les interactions clavier, passer `antibug-reviewer`, mettre à jour `.GCC/branches/test.md` / `.GCC/main.md` / `.GCC/resume.md`, et commiter localement.
- [x] **Verify**: `0` fail sur `node --test`, `7/7` Quality Gate, `AUDIT PASSED` `antibug-reviewer`.
- **Verification Proof**:
```text
ℹ tests 149 | ℹ suites 0 | ℹ pass 149 | ℹ fail 0 | ℹ cancelled 0 | ℹ skipped 0 | ℹ todo 0 | ℹ duration_ms 15975.361921
[Quality Gate] ✅ Toutes les vérifications sont passées (périmètre : staged).
[Quality Gate] ✅ Toutes les vérifications sont passées (périmètre : full).
antibug-reviewer (f57b702a-5144-4f48-8643-efa834441d7e): AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.
```
-[Antigravity, unknown, unknown]

## ⚠️ Mitigations & Edge Cases
- **Risk**: `hidden="until-found"` sur `.tab-content` dans `settings.html` pourrait interférer avec `.tab-content` flex ou les tests existants.
- **Mitigation**: Conserver `.tab-content:not(.active)` masqué proprement sans padding/marge sur le panneau externe (styles sur enfants internes ou sur `.tab-content.active`) et vérifier visuellement dans Chrome réel + `beforematch`.
- **Risk**: Tests VM existants (`tests/course-media.test.js`, `tests/e2e-regressions.test.js`) chargent `popup.js` ou `settings.js` avec des mocks DOM simplifiés (`DIV` pour `progressBarFill`, sans `theme-init.js`, sans `<dialog>.showModal`).
- **Mitigation**: Gardes défensives dans `popup.js` et `settings.js` (`tagName === 'PROGRESS'`, fallback si `SafeExmTheme` absent, fallback `confirm()` si `showModal` absent).
-[Antigravity, Gemini 4 Neon, XHigh]
