# Execution Plan: Flotte Ultracode — Finalisation Safe Exm

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Codebase 100% conforme ESLint (0 erreur, 0 avertissement), aucun leak d'API keys, injection DOM 100% furtive (WeakMap + identifiants aléatoires), zero-crash sur pages dynamiques / Shadow DOM / SPA React-Vue.
- **Pre-requisites**: `npx eslint .` fonctionnel sur le système.

## 🛠️ Step-by-Step Sequence

### Step 1: Réfactions Techniques P0/P1/P2 (Worker 1)
- [ ] **Action**: Implémenter R-TECH-01 (Clean NLP PDF/DOCX), R-TECH-02 (Proxy Image Anti-SSRF), R-TECH-03 (Head fallback), R-TECH-05 (Retry exponentiel 5xx/429 Jitter).
- [ ] **Verify**: `npx eslint background.js highlight-manager.js providers.js settings.js`
- **Verification Proof**:
```text
(À compléter après exécution)
```

### Step 2: Moteur de Détection DOM & Extraction de State (Worker 2)
- [ ] **Action**: Implémenter F-DET-01 (Formats de Quiz Universels), F-DET-02 (Shadow DOM Traverser), F-DET-03 (React Fiber / Vue state extraction), F-DET-04 (Network Interception intelligence).
- [ ] **Verify**: `npx eslint dom-extractor.js content.js`
- **Verification Proof**:
```text
(À compléter après exécution)
```

### Step 3: Intelligence, Base de Connaissances & Automatisations (Worker 3)
- [ ] **Action**: Implémenter F-INT-03 (Domain Rules), F-INT-04 (Cross-Validation Engine), F-CTX-04 (Import multi-format), F-AUTO-02 (Pre-Analysis Pipeline), F-AUTO-03 (Auto-Submit avec Jitter).
- [ ] **Verify**: `npx eslint background.js providers.js content.js settings.js`
- **Verification Proof**:
```text
(À compléter après exécution)
```

### Step 4: Verification Critic & Audit Final
- [ ] **Action**: Exécution globale de ESLint, validation de non-régression et audit de furtivité DOM.
- [ ] **Verify**: `npx eslint .`
- **Verification Proof**:
```text
(À compléter après exécution)
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: Le contournement de Shadow DOM ou l'accès à `__reactFiber$` peut soulever des erreurs de sécurité ou des exceptions Cross-Origin / Isolated World dans Chrome Extension content script.
- **Mitigation**: Utilisation de scripts d'injection inline isolés via `document.createElement('script')` temporaires immédiatement nettoyés ou passage par le background worker, avec blocs `try/catch` imperméables.
