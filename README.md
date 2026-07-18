# 🧠 Safe Exm — Assistant IA pour Quiz (Édition Furtive & Automatisée)

Extension Chrome avancée (Manifest V3) conçue pour analyser les quiz en ligne, s'adapter dynamiquement aux architectures de sites complexes (React, SPAs, Quizgecko), et proposer ou injecter les réponses correctes de manière furtive et fiable.

---

## ✨ Fonctionnalités Principales

*   **Mode Auto (Nouveau !)** : S'intègre directement au DOM (`MutationObserver`) et surveille le routeur SPA (`history.pushState`). Naviguez de question en question, l'extension s'active intelligemment en arrière-plan sans aucune action de votre part.
*   **Découverte de Schéma Adaptative** : Surmonte les mesures anti-bot ou les structures HTML exotiques en interrogeant le LLM pour découvrir où se cachent les questions et les options. Les schémas découverts sont mis en cache par domaine pour une exécution ultra-rapide aux pages suivantes.
*   **Surlignage Furtif & Universel** : Les bonnes réponses sont illuminées directement sur les éléments de la page via CSS natif (outline + box-shadow), fonctionnant parfaitement même dans des conteneurs isolés (overflow: hidden) ou des z-index complexes.
*   **Injection de Réponse (Click-Droit)** : Un menu contextuel "📋 Coller la réponse" permet d'insérer instantanément la réponse textuelle du LLM dans n'importe quel champ de texte ou formulaire React contrôlé (`contentEditable`, textarea, inputs), contournant les protections d'interface.
*   **Multi-Provider Intelligent** : Support complet de Groq, Gemini, NVIDIA NIM, Fireworks, Mistral et Claude avec un routeur intelligent qui bascule automatiquement vers le fournisseur suivant si un quota est atteint (Erreur 429).
*   **Protection Anti-Détection** : Inclus un script (`randomize_name.js`) permettant de modifier dynamiquement l'empreinte et le nom de l'extension avant chaque installation.

---

## 🚀 Installation & Déploiement

L'extension est fournie sous forme de code source à charger manuellement.

### Étape 1 : Préparation (Essentiel pour la furtivité)
Avant d'installer l'extension, il est **fortement recommandé** de brouiller son empreinte pour ne pas être détecté par les plateformes de surveillance en ligne.
1. Ouvrez un terminal dans le dossier de l'extension.
2. Lancez le script de randomisation avec Node.js :
   ```bash
   node randomize_name.js
   ```
   *Ce script modifie le nom, la description et l'ID d'installation de façon aléatoire (ex: "System Cache Optimizer v7.2").*

### Étape 2 : Chargement dans Chrome
1. Ouvrez Google Chrome et accédez à l'URL : `chrome://extensions/`
2. Activez le **Mode développeur** (en haut à droite).
3. Cliquez sur **« Charger l'extension non empaquetée »**.
4. Sélectionnez ce dossier (celui contenant le `manifest.json`).

---

## ⚙️ Configuration Initiale

Dès que l'extension est chargée, la page des **Paramètres** s'ouvrira.

1.  **Clés d'API (Le "Cerveau")** : L'extension a besoin d'un LLM pour réfléchir.
    *   Allez sur [Groq Cloud](https://console.groq.com/keys) (Gratuit, Ultra-Rapide) et créez une clé API.
    *   Allez sur [Google AI Studio](https://aistudio.google.com/app/apikey) (Gratuit, Très intelligent) pour une clé Gemini.
    *   Collez ces clés dans la page des paramètres de l'extension.
2.  **Apprentissage (Le "Savoir")** :
    *   Dans l'onglet "Contexte", vous pouvez copier-coller les textes de vos cours ou importer des PDF/DOCX. L'IA utilisera cette base de connaissances prioritairement pour répondre aux questions.
3.  **Comportement** :
    *   Activez le **Mode Auto** si vous souhaitez une prise en charge "mains libres".

---

## ⌨️ Raccourcis Clavier & Contrôle

Les raccourcis sont enregistrés de manière "Globale", signifiant qu'ils forcent l'exécution du script même si le site web bloque vos touches ou vous empêche de cliquer sur l'extension.

| Raccourci | Action | Description |
| :--- | :--- | :--- |
| `Ctrl+Shift+1` | **Activer/Désactiver** | Met l'extension en pause ou la réveille. |
| `Ctrl+Shift+2` | **Analyser la page** | Lance un scan forcé de la page pour trouver et résoudre un quiz. Indispensable si le Mode Auto est désactivé. |
| `Ctrl+Shift+3` | **Toggle Mode Auto** | Active ou désactive le moteur automatique en direct. |
| `Ctrl+Shift+E` | **Effacement Furtif** | 🥷 Fait disparaître TOUS les surlignages instantanément en restaurant les styles CSS d'origine de la page. |

---

## 💡 Astuces d'Utilisation en Situation Réelle

1. **La page ne détecte aucune question ?** 
   Si l'analyse échoue (0 question), l'extension lance automatiquement la **Découverte de Schéma**. Elle lit l'écran, comprend comment le site est construit, sauvegarde cette règle, et réessaie. Patientez quelques secondes.
2. **Comment remplir les champs de texte (QCM ouverts) ?**
   Les sites en React bloquent souvent le copier-coller classique. Faites un clic-droit dans le champ de texte, puis sélectionnez "Safe Exm > 📋 Coller la réponse". Le script simulera une frappe humaine compatible React.
3. **Le professeur s'approche ?**
   Appuyez immédiatement sur `Ctrl+Shift+E`. Tout redevient normal.

---
*Ce logiciel est conçu à des fins d'expérimentation d'ingénierie inversée sur les Single Page Applications.*
