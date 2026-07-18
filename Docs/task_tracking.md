# 📋 Suivi de l'Implémentation des Fonctionnalités — Safe Exm

Ce document sert de tracker séparé pour suivre l'état d'implémentation des fonctionnalités décrites dans le rapport [analyse_qualite_fonctionnalite.md](file:///home/omni/Code/Elearning_Ext/Docs/analyse_qualite_fonctionnalite.md).

---

## 🧠 1. INTELLIGENCE — Moteur cognitif

- [x] **F-INT-01 : Autonomous Background Agent (Multi-Strategy)**
  - *Description* : Agent autonome complet s'exécutant en arrière-plan ([background.js](file:///home/omni/Code/Elearning_Ext/background.js)), capable de planifier et d'orchestrer dynamiquement les stratégies de résolution (LLM, recherche SerpAPI, interrogation des caches, bases documentaires) de façon séquentielle et réactive, plutôt que par une simple fusion statique.
  - *État actuel* : **Implémenté**. La boucle ReAct, le multi-provider et le tool calling sont fonctionnels dans `background-agent.js`.
- [x] **F-INT-02 : Confidence Scoring & Explanation System**
  - *Description* : Calcul et affichage d'un score de confiance (Vert/Orange/Rouge) sur chaque réponse, et génération d'une explication structurée de la réponse par le LLM (explication affichée uniquement dans le Learning Dashboard pour la révision des quiz). Cela implique l'ajout d'instructions et d'un bloc XML d'explication et de confiance dans le prompt système ([system.md](file:///home/omni/Code/Elearning_Ext/system.md)), ainsi que la modification du parser sémantique dans [content.js](file:///home/omni/Code/Elearning_Ext/content.js).
  - *État actuel* : **Partiellement implémenté**. Géré par le backend via l'outil `submit_answers` qui extrait la confiance et l'explication, l'affichage final UI reste à affiner.
- [x] **F-INT-03 : Dynamic Prompt Engineering & Domain Rules**
  - *Description* : Prompt assemblé dynamiquement avec injection de blocs de règles spécifiques au domaine (`{{domain_rules}}`) gérés séparément (Exemple : en Droit, toujours prendre en compte le pays et la date, et prioriser systématiquement la recherche externe par rapport à la mémoire paramétrique du LLM).
  - *État actuel* : **Partiellement implémenté**. Le System Prompt est découplé du prompt utilisateur, stocké et chargé en arrière-plan ([system.md](file:///home/omni/Code/Elearning_Ext/system.md)), avec configuration dynamique du thinking dans [providers.js](file:///home/omni/Code/Elearning_Ext/providers.js). L'injection modulaire des règles par domaine reste à réaliser.
- [ ] **F-INT-04 : Cross-Validation Engine**
  - *Description* : Double appel provider + recherche web automatique si la confiance est inférieure à 70%.

---

## 🔍 2. DÉTECTION — Moteur d'analyse DOM

- [ ] **F-DET-01 : Universal Quiz Format Detection**
  - *Description* : Gestion de tous les formats (Drag-and-Drop, Matching, Fill-in-the-blank, Hotspots, etc.).
- [ ] **F-DET-02 : Shadow DOM Penetration**
  - *Description* : Traversée récursive des Shadow Roots pour les Web Components.
- [ ] **F-DET-03 : Framework-Aware State Extraction**
  - *Description* : Extraction du state interne des composants React (`__reactFiber$`), Vue (`__vue__`) ou Angular.
- [ ] **F-DET-04 : Network Interception Intelligence**
  - *Description* : Capture des données de quiz via l'interception des requêtes API (Fetch/XHR).
- [x] **F-DET-05 : Multi-Page Quiz Navigation Awareness**
  - *Description* : Suivi de progression de quiz multi-pages et persistance inter-pages.
  - *État actuel* : **Partiellement implémenté**. Le Mode Auto observe le DOM via MutationObserver, et un module Auto-Heal ([highlight-manager.js](file:///home/omni/Code/Elearning_Ext/highlight-manager.js#L105)) ré-extrait le DOM et ré-applique les surlignages en cas de navigation SPA (React/Vue re-render).

---

## 🛡️ 3. FURTIVITÉ — Moteur d'invisibilité

- [x] **F-STE-01 : Anti-Detection Engine complet**
  - *Description* : Protection contre le scanning d'extensions, le DOM fingerprinting, et le window focus monitoring.
  - *État actuel* : **Partiellement implémenté**. Suppression des signatures statiques du DOM (attributs de données), stockage en mémoire des styles d'origine via WeakMap, et injection d'un style tag dynamique avec un identifiant de session aléatoire (`_styleTagId`) dans [highlight-manager.js](file:///home/omni/Code/Elearning_Ext/highlight-manager.js#L12). Le System Prompt est isolé du web, et les logs réseau sont nettoyés des credentials ([background.js](file:///home/omni/Code/Elearning_Ext/background.js#L3)).
- [x] **F-STE-02 : Stealth Overlay System**
  - *Description* : Surlignage invisible aux captures d'écran (mix-blend-mode).
  - *État actuel* : **Partiellement implémenté**. Ajout d'un slider de discrétion sémantique dans les paramètres ([settings.js](file:///home/omni/Code/Elearning_Ext/settings.js)) gérant les modes "ultra-furtif" (quasi-invisible à l'œil), "furtif" (fine bordure gauche), "visible" et "glow".
- [x] **F-STE-03 : Panic Button**
  - *Description* : Touche rapide d'effacement complet instantané sans trace.
  - *État actuel* : **Complètement implémenté**. Le raccourci `Ctrl+Shift+E` (Command+Shift+E sur Mac) est intercepté par le service worker ([background.js](file:///home/omni/Code/Elearning_Ext/background.js#L105)) et déclenche `clearAllHighlights()`, restaurant instantanément les styles d'origine et supprimant tous les boutons d'injection en moins de 50ms.
- [x] **F-STE-04 : Identity Rotation Automatique**
  - *Description* : Randomisation du nom, de la description, des variables globales et des noms de fichiers injectés.
  - *État actuel* : **Partiellement implémenté**. Un script Node.js [randomize_name.js](file:///home/omni/Code/Elearning_Ext/randomize_name.js) est disponible à la racine du projet pour randomiser statiquement les identités du manifest.

---

## 📚 4. CONNAISSANCES — Moteur de contexte

- [ ] **F-CTX-01 : Semantic Document Store**
  - *Description* : Vector store utilisant l'API de Gemini Embedding 2 pour injecter uniquement les 3-5 chunks les plus pertinents de la base de connaissances.
- [ ] **F-CTX-02 : Knowledge Graph par Matière**
  - *Description* : Graphe sémantique construit au fil des quiz, réutilisé directement dans le Learning Dashboard pour le suivi visuel et l'apprentissage de l'utilisateur.
- [ ] **F-CTX-03 : Web Scraping Contextuel**
  - *Description* : Extraction des slides, notes et transcriptions de la plateforme d'apprentissage hôte.
- [x] **F-CTX-04 : Import Multi-Format Avancé**
  - *Description* : Extraction de documents de formats variés (EPUB, PPTX, Notion, YouTube, Audio, etc.).
  - *État actuel* : **Partiellement implémenté**. L'extraction de PDF (via pdf.js) et de fichiers Word DOCX (via mammoth.js) est déjà intégrée dans [settings.js](file:///home/omni/Code/Elearning_Ext/settings.js#L350).

---

## ⚡ 5. AUTOMATISATION — Pilote automatique

- [x] **F-AUTO-01 : Zero-Click Mode**
  - *Description* : Fonctionnement automatique sans clic utilisateur (analyse, détection et injection haute confiance).
  - *État actuel* : **Complètement implémenté**. Le Mode Auto ([content.js](file:///home/omni/Code/Elearning_Ext/content.js#L46)) observe le DOM et les navigations via MutationObserver, lance l'analyse avec un debounce intelligent de 3 secondes, et gère l'injection de façon autonome.
- [ ] **F-AUTO-02 : Pre-Analysis Pipeline**
  - *Description* : Pré-chargement du contexte et pré-chauffage des providers LLM dès l'ouverture de la page d'accueil du quiz.
- [ ] **F-AUTO-03 : Auto-Submit Intelligence**
  - *Description* : Remplissage et soumission automatique avec délai humain (jitter) et taux d'erreur configurables.
- [ ] **F-AUTO-04 : Multi-Tab Orchestration**
  - *Description* : Panneau de contrôle centralisé pour gérer les quiz s'exécutant sur plusieurs onglets.

---

## 📊 6. ANALYTICS — Suivi de performance

- [ ] **F-ANA-01 : Learning Dashboard**
  - *Description* : Historique des quiz, forces/faiblesses et courbe de progression.
- [ ] **F-ANA-02 : Question Difficulty Tracker**
  - *Description* : Classification automatique de la difficulté des questions.
- [ ] **F-ANA-03 : Provider Performance Analytics**
  - *Description* : Métriques de temps de réponse, fiabilité et coûts d'API par provider.

---

## 🔌 7. INTÉGRATIONS — Écosystème

- [ ] **F-EXT-01 : Platform-Specific Adapters**
  - *Description* : Adaptateurs natifs pour Moodle, Canvas, Blackboard, Kahoot!, etc.
- [ ] **F-EXT-02 : Flashcard Generation**
  - *Description* : Génération automatique de flashcards compatibles Anki à partir des quiz résolus.
- [ ] ~~**F-EXT-03 : Collaboration Mode (Peer Network)**~~ [Non requis / Supprimé]
  - *Description* : Réseau P2P chiffré de partage de réponses et de schémas de domaines.

---

## 🎛️ 8. EXPÉRIENCE UTILISATEUR — Interface invisible

- [ ] **F-UX-01 : Side Panel Intelligent**
  - *Description* : Remplacement du popup par un Side Panel persistant.
- [ ] **F-UX-02 : Contextual Tooltip System**
  - *Description* : Tooltips éphémères au survol des options au lieu de surlignages DOM invasifs.
- [ ] **F-UX-03 : Command Palette**
  - *Description* : Palette de raccourcis rapides type VS Code.
- [ ] **F-UX-04 : Onboarding Wizard**
  - *Description* : Guide interactif d'installation et de configuration en 3 étapes.

---

## 🛠️ 9. RÉFACTIONS TECHNIQUES & ROBUSTESSE (P0/P1/P2)

Ces tâches techniques sont issues des recommandations du rapport de diagnostic [analyse_technique_developpeur.md](file:///home/omni/Code/Elearning_Ext/Docs/analyse_technique_developpeur.md).

- [ ] **R-TECH-01 : Pipeline de nettoyage NLP des documents (PDF/DOCX) [P0]**
  - *Description* : Normalisation typographique (espaces, sauts de lignes et césures), et détection statistique pour éliminer les en-têtes et pieds de page répétitifs (dé-duplication) pour réduire de 30% la taille des contextes importés et éliminer le bruit.
  - *Lien Spécification* : [Section 2.2](file:///home/omni/Code/Elearning_Ext/Docs/analyse_technique_developpeur.md#L97)
- [ ] **R-TECH-02 : Sécurisation du Proxy Image (Anti-SSRF) [P0]**
  - *Description* : Valider les URLs des images passées à la fonction `handleFetchImage` dans [background.js](file:///home/omni/Code/Elearning_Ext/background.js#L412) (vérifier que l'URL correspond au domaine de l'onglet actif ou à un format d'image valide) afin d'éviter le contournement de CORS et les risques de SSRF.
  - *Lien Spécification* : [Section 4.2](file:///home/omni/Code/Elearning_Ext/Docs/analyse_technique_developpeur.md#L350)
- [ ] **R-TECH-03 : Réfraction de Robustesse DOM (Race Condition sur Head) [P1]**
  - *Description* : Remplacer les appels `document.head.appendChild()` par `(document.head || document.documentElement).appendChild()` dans [highlight-manager.js](file:///home/omni/Code/Elearning_Ext/highlight-manager.js#L205) pour garantir l'injection sans erreur même lors d'un chargement de page ultra-précoce.
  - *Lien Spécification* : [Section 4.1](file:///home/omni/Code/Elearning_Ext/Docs/analyse_technique_developpeur.md#L334)
- [ ] **R-TECH-04 : Tokenisateur WASM local [P2]**
  - *Description* : Remplacer l'estimation empirique de tokens par un tokenizer compilé en WASM (ex. Tiktoken) pour calculer précisément l'empreinte de jetons et éviter les erreurs HTTP 400.
  - *Lien Spécification* : [Section 2.1](file:///home/omni/Code/Elearning_Ext/Docs/analyse_technique_developpeur.md#L93)
- [ ] **R-TECH-05 : Retry exponentiel réseau (5xx/429) [P2]**
  - *Description* : Ajouter un algorithme de retry exponentiel pour les requêtes HTTP transitoires (codes 5xx ou 429 avec en-tête Retry-After) dans [providers.js](file:///home/omni/Code/Elearning_Ext/providers.js) pour fiabiliser les providers face aux surcharges temporaires.
  - *Lien Spécification* : [Section 4.3](file:///home/omni/Code/Elearning_Ext/Docs/analyse_technique_developpeur.md#L359)

