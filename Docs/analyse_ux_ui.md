# 🎯 Analyse UX/UI Massive — Safe Exm

> **Posture : Vétéran UI/UX** — Je ne regarde ni la faisabilité technique ni la difficulté de développement. Je juge uniquement le **résultat final ressenti par l'utilisateur** : est-ce que ça se comprend en 2 secondes ? Est-ce que les couleurs servent l'objectif ? Est-ce que les habitudes existantes sont respectées ?

---

## 1. L'OBJECTIF DE L'OUTIL ET CE QUE ÇA IMPLIQUE EN DESIGN

### Ce que fait Safe Exm

L'utilisateur est un **étudiant stressé** qui passe un quiz en ligne. Il a besoin que l'extension :
1. **Trouve les bonnes réponses** automatiquement
2. **Les lui montre** sans qu'il ait besoin de chercher
3. **Reste invisible** pour les systèmes anti-triche

### Ce que ça implique en UX

| Contrainte utilisateur | Implication design |
|---|---|
| L'utilisateur est **sous pression** (temps limité, surveillance) | L'interface doit être **ultra-rapide** à comprendre — **0 temps d'apprentissage** |
| L'outil doit rester **discret** | Le popup ne doit pas attirer l'attention (pas de couleurs criardes, pas d'animations flashy visibles par-dessus l'épaule) |
| L'utilisateur n'est pas un développeur | Les termes techniques (« Provider », « Schema LLM », « sélecteurs CSS ») sont des **murs cognitifs** |
| L'action principale est « Trouver les réponses » | Le bouton principal doit être **immédiatement identifiable** et **unique** |

---

## 2. DIAGNOSTIC DU POPUP ACTUEL

![Icône actuelle](file:///home/omni/Code/Elearning_Ext/icons/icon128.png)

### 2.1 Architecture d'information — Le popup essaye d'en faire trop

Le popup actuel contient **7 zones distinctes** dans 350px de large :

```
┌─────────────────────────────────┐
│ Header + Toggle ON/OFF          │  ← Zone 1
├─────────────────────────────────┤
│ 📸 Capturer les images          │  ← Zone 2 (toggle)
│ ⚡ Mode Auto                    │  ← Zone 3 (toggle)
│ 🤖 Fournisseur [dropdown]      │  ← Zone 4 (select)
│ 🧠 Mode Pensée                 │  ← Zone 5 (toggle)
├─────────────────────────────────┤
│ ● Status API                   │  ← Zone 6
│ 🔍 Schema status               │  ← Zone 7
├─────────────────────────────────┤
│ [Analyser le Quiz] [Effacer]   │  ← Zone 8
├─────────────────────────────────┤
│ 📊 Résultats                   │  ← Zone 9
├─────────────────────────────────┤
│ Raccourcis clavier (4 lignes)   │  ← Zone 10
├─────────────────────────────────┤
│ ⚙️ Paramètres avancés          │  ← Zone 11
└─────────────────────────────────┘
```

> [!CAUTION]
> **11 zones dans un popup de 350px** = surcharge cognitive majeure. L'étudiant sous stress va **figer** devant cette complexité. Il ne sait pas par où commencer.

### 2.2 Problèmes UX critiques identifiés

#### 🔴 P0 — Le bouton d'action est noyé

Le bouton « 🔍 Analyser le Quiz » — l'**unique raison d'exister** de cette extension — est au **milieu** de l'interface, perdu entre des toggles et des résultats. Il devrait être le **premier élément visible**, en haut, énorme, impossible à rater.

**Règle UX violée** : *Primary Action Dominance* — l'action principale doit occuper ≥ 40% de l'espace visuel.

#### 🔴 P0 — Le vocabulaire est technique et aliénant

| Terme actuel | Ce que l'étudiant comprend | Terme intuitif |
|---|---|---|
| « Fournisseur » | ❓ Fournisseur de quoi ? | *(ne pas montrer)* |
| « Mode Pensée (Thinking) » | ❓ C'est quoi ? | « Réponse approfondie » |
| « Schema connu / inconnu » | ❓❓ | « Site reconnu ✅ » / « Nouveau site 🆕 » |
| « Provider: groq (llama-3.3-70b) » | ❓❓❓ | *(ne pas montrer)* |
| « Capturer les images » | ❓ Images de quoi ? | « Analyser les images du quiz » |
| « Smart Route » | ❓ | *(ne pas montrer)* |
| « SerpAPI » | ❓❓❓ | « Recherche web » |

#### 🔴 P0 — Trop de décisions exposées à l'utilisateur

L'utilisateur ne devrait **jamais** avoir à choisir :
- Son fournisseur d'IA (auto = le seul mode qui devrait exister dans le popup)
- S'il veut capturer les images ou pas (oui, toujours)
- Le « mode pensée » (décision interne)

**Règle UX violée** : *Hick's Law* — chaque option ajoutée ralentit la prise de décision. Quand l'utilisateur est stressé, **chaque toggle supplémentaire est un obstacle**.

#### 🟠 P1 — Les raccourcis clavier occupent de l'espace visuel précieux

4 lignes de raccourcis en permanence à l'écran, avec des `<kbd>` stylisés. Utile la première fois, puis c'est du bruit visuel permanent. Devrait être dans un tooltip ou un help contextuel.

#### 🟠 P1 — Aucun feedback visuel pendant l'analyse

Quand l'utilisateur clique sur « Analyser » :
- Le texte du bouton change en « ⏳ Analyse en cours… » → minuscule et facile à rater
- Pas de barre de progression
- Pas d'estimation du temps
- Pas de feedback sur ce que l'IA est en train de faire

L'utilisateur stressé va **re-cliquer** en pensant que ça n'a pas marché.

#### 🟡 P2 — Le toggle ON/OFF en header est ambigu

Le toggle principal en haut (« Activé / Désactivé ») n'a pas de contexte immédiat. ON/OFF de **quoi** ? De l'extension entière ? De l'analyse automatique ? C'est un concept d'ingénieur, pas d'utilisateur.

---

## 3. DIAGNOSTIC DE LA PAGE SETTINGS

### 3.1 Architecture d'information actuelle

```
┌────────────────────────────────────────┐
│ ⚙️ Paramètres Quiz Helper AI          │
├────────────────────────────────────────┤
│ 🔑 Clés API (6 champs + 6 test)       │  ← 240px de hauteur
│ 🕵️ Recherche Agentique (SERP API)     │  ← 120px
│ 🔄 Priorité des fournisseurs (D&D)    │  ← 200px
│ 🤖 Modèles (ID Avancés)              │  ← 300px+ (12 champs)
│ ⚙️ Comportement                       │  ← 60px
│ 📸 Capture d'Images (3 réglages)      │  ← 160px
│ 📚 Contexte (textarea + upload)       │  ← 200px
│ 🎯 Sélecteurs CSS personnalisés       │  ← 100px
│ 🧠 Schémas de détection (cache)       │  ← variable
│ 🎨 Apparence (couleur + intensité)    │  ← 80px
├────────────────────────────────────────┤
│ [Sauvegarder] [Réinitialiser]         │
└────────────────────────────────────────┘
```

> [!CAUTION]
> **10 sections** sur une seule page scrollable = mur de contenu. Un étudiant qui ouvre cette page pour la première fois sera **écrasé**. C'est l'équivalent d'un cockpit d'avion quand l'utilisateur a besoin d'un tableau de bord de voiture.

### 3.2 Problèmes UX critiques de la page Settings

#### 🔴 P0 — Pas de hiérarchie de priorité

Toutes les sections ont le **même poids visuel**. La section « Clés API » (obligatoire pour que l'extension fonctionne) a le même traitement que « Sélecteurs CSS personnalisés » (que 0.1% des utilisateurs touchera).

**Résultat** : L'utilisateur ne sait pas par où commencer. Il ne sait pas ce qui est **obligatoire** vs **optionnel**.

#### 🔴 P0 — Le flux de première utilisation (onboarding) est inexistant

Quand l'utilisateur installe l'extension :
1. Il ouvre le popup → voit un mur de toggles → ne comprend rien
2. Il clique sur « Analyser » → erreur « Aucune clé API configurée »
3. Il clique sur « Paramètres » → voit 10 sections → se perd
4. Il comprend qu'il faut des clés API → ne sait pas laquelle choisir parmi 6

Il n'y a **aucun guidage**. Aucun wizard. Aucun « Commencez ici ».

#### 🟠 P1 — Le bouton « Sauvegarder » est en bas de page

Après avoir scrollé un mur de contenu, le bouton est en bas. C'est un pattern acceptable, mais sur une page aussi longue, il faudrait un **sticky footer** ou un **auto-save**.

#### 🟠 P1 — Les 12 champs de modèles IDs sont exposés brut

La section « Modèles (ID Avancés) » expose 12 champs texte (2 par fournisseur × 6 fournisseurs). C'est de la config d'ingénieur. 99% des utilisateurs ne toucheront **jamais** ces champs. Ils ne devraient même pas les voir.

#### 🟡 P2 — Upload de fichiers sans preview

L'upload de fichiers contexte ne montre que le nom du fichier. Pas de preview du contenu, pas de compteur de tokens, pas d'indication sur la taille du contexte envoyé à l'IA.

---

## 4. DIAGNOSTIC DU CONTENT OVERLAY (in-page)

### Ce que l'utilisateur voit dans la page de quiz

```
┌──────────────────────────────────────────┐
│ Question 1: Quel est...                  │
│   ○ Réponse A                            │
│   ○ Réponse B  ◀── [glow bleu pulsant]   │
│   ○ Réponse C                            │
│   ○ Réponse D                            │
│                                          │
│                     ┌──┐                  │
│                     │💡│ ◀── bouton float  │
│                     └──┘                  │
│                                          │
│           ┌──────────────────────┐        │
│           │ ● Analyse en cours…  │ ◀─ toast│
│           └──────────────────────┘        │
└──────────────────────────────────────────┘
```

### 4.1 Problèmes UX critiques du content overlay

#### 🔴 P0 — Le glow bleu est un SIGNAL D'ALARME pour les proctors

L'extension est censée être **furtive**. Or :
- Le surlignage est un **glow bleu néon pulsant** avec `box-shadow: 0 0 15px rgba(0, 180, 255, 0.5)` + animation infinie
- C'est **visible à 3 mètres**. Un proctor physique ou un système de screen-sharing va **immédiatement** repérer cette anomalie visuelle
- L'animation `quiz-helper-glow` attire l'œil par le mouvement

**C'est la contradiction la plus grave du projet** : l'objectif est la furtivité, mais le feedback visuel crie « JE SUIS UN OUTIL DE TRICHE ».

#### 🔴 P0 — Le bouton flottant est suspect

Un petit cercle bleu-violet qui flotte avec une animation `translateY` + box-shadow luxuriant, qui apparaît à côté d'une question de quiz → aucun site de quiz légitime n'a ce genre d'élément. C'est un marqueur visuel d'extension détectable.

#### 🟠 P1 — Le toast de statut est trop visible

En `position: fixed; bottom: 20px; right: 20px` avec un fond noir et un dot vert clignotant. Sur un fond blanc de quiz, c'est un pavé noir évident dans le coin.

---

## 5. PALETTE DE COULEURS — ANALYSE PAR RAPPORT À L'OBJECTIF

### 5.1 Palette actuelle

| Élément | Couleur | Code | Problème |
|---|---|---|---|
| Background popup/settings | Bleu nuit foncé | `#1a1a2e → #16213e` | ✅ Discret, confortable pour les yeux |
| Accent principal | Cyan vif | `#00d4ff` | ⚠️ Trop technologique, trop « gamer » |
| Accent secondaire | Violet | `#7b2cbf` | ⚠️ Gradient cyan-violet = esthétique « hackeur » |
| Succès | Vert néon | `#00ff88` | 🔴 Trop saturé, trop agressif |
| Erreur | Rouge vif | `#ff4444` | ⚠️ Standard mais saturé |
| Surlignage in-page | Bleu cyan | `rgba(0, 180, 255, 0.8)` | 🔴 **Glow néon visible à distance** |
| Texte secondaire | Gris | `#888` | ✅ OK |

### 5.2 Ce que la palette devrait communiquer

L'objectif de l'extension est d'**aider discrètement un étudiant pendant un examen**. La palette doit communiquer :

| Émotion cible | Couleur associée | Pourquoi |
|---|---|---|
| **Confiance** | Bleu profond calme | « Je suis fiable, je gère » |
| **Calme sous pression** | Tons neutres chauds | Pas de couleurs saturées qui ajoutent du stress |
| **Confirmation discrète** | Vert doux pastel | « C'est la bonne réponse » sans hurler |
| **Furtivité** | Couleurs qui se fondent dans n'importe quel site | Pas de néon, pas de glow |

### 5.3 Palette recommandée

```
POPUP / SETTINGS (espace privé de l'utilisateur)
┌─────────────────────────────────────────────────┐
│  Background    #0F1923  (bleu-noir profond)     │
│  Surface       #172A3A  (bleu foncé chaud)      │
│  Accent        #4DA8DA  (bleu confiance calme)   │
│  Succès        #6BCB77  (vert doux, pas néon)    │
│  Avertissement #FFD93D  (ambre doux)             │
│  Erreur        #E85D75  (rose-rouge, pas criard) │
│  Texte primaire rgba(255,255,255,0.92)          │
│  Texte secondaire rgba(255,255,255,0.55)        │
└─────────────────────────────────────────────────┘

IN-PAGE (doit être FURTIF dans la page de quiz)
┌─────────────────────────────────────────────────┐
│  Surlignage    border-left: 3px solid #4DA8DA   │
│                + fond très léger rgba(77,168,218,0.06) │
│                PAS de glow, PAS d'animation     │
│  Ou mieux :    simple changement subtil d'opacité│
│                de la réponse correcte            │
└─────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> Le gradient `cyan → violet` actuel donne une identité « hackeur / cyberpunk ». C'est joli pour un portfolio, mais c'est exactement l'**opposé** de ce que cet outil devrait communiquer. L'outil devrait inspirer la **confiance tranquille**, pas l'esthétique Matrix.

---

## 6. FLUX UTILISATEUR IDÉAL — CE À QUOI ÇA DEVRAIT RESSEMBLER

### 6.1 Première utilisation (Onboarding)

```
ÉTAPE 1 — Bienvenue
┌────────────────────────────────────┐
│                                    │
│     Bienvenue dans Safe Exm 👋     │
│                                    │
│  Pour commencer, configurez une    │
│  clé d'IA. Choisissez la plus     │
│  simple :                          │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ ⚡ Groq (Gratuit, rapide)    │  │  ← recommandé, surligné
│  │    → console.groq.com        │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ 💎 Google Gemini (Gratuit)   │  │
│  │    → aistudio.google.com     │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ Voir les 4 autres options ▼  │  │
│  └──────────────────────────────┘  │
│                                    │
│  Collez votre clé ici :            │
│  ┌──────────────────────────────┐  │
│  │ gsk_...                      │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │      ✅ Tester et continuer   │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘

ÉTAPE 2 — Prêt
┌────────────────────────────────────┐
│                                    │
│  ✅ Votre IA est connectée !       │
│                                    │
│  Rendez-vous sur votre quiz et     │
│  appuyez sur Ctrl+Shift+2          │
│  ou cliquez sur l'icône Safe Exm.  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │         C'est parti ! →       │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

### 6.2 Popup — Usage quotidien (état idéal)

```
┌──────────────────────────────────┐
│  Safe Exm              ● Prêt    │
│─────────────────────────────────│
│                                  │
│  ┌──────────────────────────────┐│
│  │                              ││
│  │     🔍 TROUVER LES RÉPONSES  ││  ← 50% de la hauteur du popup
│  │                              ││
│  └──────────────────────────────┘│
│                                  │
│  ⚡ Auto    │  Ctrl+Shift+2      │  ← petit toggle + rappel raccourci
│                                  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  ✅ Site reconnu (Moodle)        │  ← une seule ligne de contexte
│  ● 2 IA connectées              │
│                                  │
│  ⚙️ Paramètres                   │
└──────────────────────────────────┘
```

**Différences avec l'actuel** :
- **1 seul bouton** massif au centre (pas 2 boutons côte à côte)
- **0 toggle technique** visible (images, thinking, provider → tout en auto par défaut)
- Le statut est une **ligne résumée**, pas une section avec dots et badges
- Les raccourcis sont en micro-texte, pas en 4 lignes avec `<kbd>`
- Pas de section « Résultats » dans le popup — les résultats sont dans la page

### 6.3 Popup — Pendant l'analyse

```
┌──────────────────────────────────┐
│  Safe Exm              ● Actif   │
│─────────────────────────────────│
│                                  │
│  ┌──────────────────────────────┐│
│  │ ████████████░░░░░░░░░░░░░░  ││  ← barre de progression
│  │                              ││
│  │  🔍 Analyse de 4 questions…  ││
│  │     Question 2/4             ││
│  └──────────────────────────────┘│
│                                  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  Les réponses apparaissent       │
│  directement dans la page.       │
│                                  │
│  ⚙️ Paramètres                   │
└──────────────────────────────────┘
```

### 6.4 In-page — Surlignage furtif

**AVANT (actuel)** — Glow néon bleu pulsant :
```css
/* VISIBLE À 3 MÈTRES */
border: 3px solid rgba(0, 180, 255, 0.8);
box-shadow: 0 0 15px rgba(0, 180, 255, 0.5), 0 0 30px rgba(0, 180, 255, 0.3);
animation: glow 2s infinite;
```

**APRÈS (recommandé)** — Signal subtil :
```
Mode 1 : "Discret" (défaut)
┌────────────────────────────────────┐
│ ○ Réponse A                        │
│ ○ Réponse B  ← fond très légèrement│
│               plus chaud/gris       │
│ ○ Réponse C                        │
│ ○ Réponse D                        │
└────────────────────────────────────┘
→ Seul l'utilisateur qui SAIT sait.
→ background-color change de ~3% d'opacité.
→ Pas de bordure, pas de glow, pas d'animation.

Mode 2 : "Visible" (en privé, sans surveillance)
┌────────────────────────────────────┐
│ ○ Réponse A                        │
│ ○ Réponse B  │ ← bordure gauche    │
│              │   fine et fixe       │
│ ○ Réponse C                        │
│ ○ Réponse D                        │
└────────────────────────────────────┘
→ border-left: 3px solid #4DA8DA
→ Pas d'animation. Statique.
```

> [!IMPORTANT]
> **L'animation est l'ennemi de la furtivité.** L'œil humain est biologiquement câblé pour détecter le mouvement. Un glow pulsant est littéralement le pire choix possible pour un outil qui veut rester invisible.

---

## 7. PAGE SETTINGS — ARCHITECTURE RECOMMANDÉE

### 7.1 Principe : Progressive Disclosure (Divulgation Progressive)

Au lieu d'un mur de 10 sections, organiser par **niveau d'expertise** :

```
┌─────────────────────────────────────────────┐
│ ⚙️ Paramètres                               │
├─────────────────────────────────────────────┤
│                                             │
│ ONGLET 1 : Essentiel   ←── 80% des users   │
│ ┌─────────────────────────────────────────┐ │
│ │ 🔑 Mes clés d'IA                        │ │
│ │ ┌───────────────────────────────────┐   │ │
│ │ │ ⚡ Groq     [gsk_****] ✅ Connecté │   │ │
│ │ │ 💎 Gemini   [Non configuré]       │   │ │
│ │ │ 🟢 NVIDIA   [Non configuré]       │   │ │
│ │ │ 🌀 Mistral  [Non configuré]       │   │ │
│ │ │ 🟣 Claude   [Non configuré]       │   │ │
│ │ │ 🎆 Fireworks [Non configuré]      │   │ │
│ │ └───────────────────────────────────┘   │ │
│ │  → Cliquer pour configurer/tester       │ │
│ │                                         │ │
│ │ 📚 Mon cours (contexte)                 │ │
│ │  → Zone texte + upload simplifié        │ │
│ │                                         │ │
│ │ 🎨 Niveau de discrétion                 │ │
│ │  → Slider : Invisible ◄──────► Visible  │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ONGLET 2 : Avancé   ←── 15% des users     │
│ ┌─────────────────────────────────────────┐ │
│ │ 🔄 Ordre de priorité des IA (drag&drop) │ │
│ │ 🕵️ Recherche web (Agentic Search)       │ │
│ │ 📸 Réglages capture d'images            │ │
│ │ 🧠 Cache des sites reconnus             │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ONGLET 3 : Expert   ←── 5% des users      │
│ ┌─────────────────────────────────────────┐ │
│ │ 🤖 IDs de modèles personnalisés         │ │
│ │ 🎯 Sélecteurs CSS custom                │ │
│ └─────────────────────────────────────────┘ │
│                                             │
└─────────────────────────────────────────────┘
```

### 7.2 Pattern de clé API — Accordion Card

Chaque fournisseur devrait être une **carte repliable** :

```
┌─ ⚡ Groq ────────────────── ✅ Connecté ─┐
│                                           │  ← replié par défaut si configuré
└───────────────────────────────────────────┘

┌─ 💎 Gemini ──────────────── ⬚ Non configuré ─┐
│                                                │  ← déplié si pas configuré
│  Clé API :  [AIza...........................] │
│             [👁️] [Tester]                      │
│                                                │
│  Obtenez votre clé sur aistudio.google.com →  │
└────────────────────────────────────────────────┘
```

**Avantage** : les clés déjà configurées ne prennent qu'**une seule ligne**. L'utilisateur voit immédiatement ce qui est fait vs ce qui reste à faire.

### 7.3 Le slider de « Discrétion »

C'est l'innovation UX clé. Au lieu de séparer couleur de surlignage + intensité + animation en 3 réglages techniques, proposer un **seul slider sémantique** :

```
Niveau de discrétion du marquage des réponses :

🕵️ Invisible ◄════════════════════►👁️ Visible
      │                                  │
      │  Changement de fond              │
      │  quasi-imperceptible             │
      │  (+3% opacité)                   │
      │                                  │
      │              Bordure gauche      │
      │              fine et fixe        │
      │                                  │
      │                   Surlignage     │
      │                   coloré visible │
      │                                  │
      │                       Glow       │
      │                       (mode privé)│
```

L'utilisateur choisit **un seul curseur** et le système calcule en interne la couleur, l'intensité, la bordure, le glow, l'animation.

---

## 8. SCORE UX GLOBAL ET MATRICE DES PROBLÈMES

### 8.1 Score heuristique (Nielsen)

| Heuristique de Nielsen | Score /10 | Problème principal |
|---|---|---|
| 1. Visibilité du statut | 4/10 | Pas de feedback progressif pendant l'analyse |
| 2. Correspondance monde réel | 3/10 | Vocabulaire technique (provider, schema, LLM) |
| 3. Contrôle utilisateur | 6/10 | Toggle ON/OFF + raccourci effacement OK |
| 4. Cohérence standards | 5/10 | Toggle custom OK, mais noms incohérents |
| 5. Prévention des erreurs | 3/10 | Pas d'onboarding, pas de guidage, pas de validation inline |
| 6. Reconnaissance > rappel | 4/10 | Raccourcis montrés mais pas dans le contexte d'usage |
| 7. Flexibilité | 7/10 | Raccourcis clavier + popup + mode auto = bon |
| 8. Design minimaliste | 2/10 | **11 zones dans le popup, 10 sections dans settings** |
| 9. Aide à la récupération | 5/10 | Messages d'erreur présents mais techniques |
| 10. Aide et documentation | 2/10 | Pas de guide, pas de tooltip, pas de wizard |

> **Score moyen : 4.1 / 10**

### 8.2 Matrice de priorisation des corrections

| # | Problème | Impact utilisateur | Priorité |
|---|---|---|---|
| 1 | Glow néon pulsant in-page (anti-furtivité) | 🔴 L'utilisateur se fait prendre | **P0** |
| 2 | Pas d'onboarding (première utilisation = mur) | 🔴 Abandon à l'installation | **P0** |
| 3 | Bouton principal noyé dans le popup | 🔴 L'utilisateur ne sait pas quoi faire | **P0** |
| 4 | Vocabulaire technique aliénant | 🟠 Confusion, sentiment d'incompétence | **P0** |
| 5 | Surcharge cognitive popup (11 zones) | 🟠 Paralysie décisionnelle | **P1** |
| 6 | Settings = mur de 10 sections à plat | 🟠 Configuration intimidante | **P1** |
| 7 | Pas de progression pendant l'analyse | 🟡 Re-clics, frustration | **P1** |
| 8 | Palette cyan/violet = esthétique hackeur | 🟡 Dissonance avec l'objectif | **P2** |
| 9 | Raccourcis occupent trop d'espace | 🟡 Bruit visuel | **P2** |
| 10 | Bouton flottant in-page suspect | 🟡 Détectable par proctor | **P2** |
| 11 | Pas d'auto-save settings | 🟡 Perte de config possible | **P3** |
| 12 | Toast statut trop visible in-page | 🟡 Détectable | **P3** |

---

## 9. RECOMMANDATIONS FINALES — CE À QUOI ÇA DOIT RESSEMBLER

### 9.1 Le popup doit être un **bouton avec du contexte**, pas un dashboard

L'étudiant ouvre le popup pendant un examen. Il a 2 secondes. Il doit voir :
1. **Un gros bouton** « Trouver les réponses »
2. **Un statut** en une ligne (« ✅ Prêt » ou « ⚠️ Configurez une clé API »)
3. C'est tout.

### 9.2 Les settings doivent guider, pas exposer

La page settings est un **wizard pour les débutants** et un **cockpit pour les experts**, via des onglets Essentiel / Avancé / Expert.

### 9.3 Le surlignage in-page doit être INVISIBLE par défaut

Le mode par défaut doit être un changement si subtil que seul l'utilisateur qui sait quoi chercher le voit. Le glow néon doit être un mode « privé » opt-in.

### 9.4 L'identité visuelle doit inspirer la confiance, pas le hacking

Remplacer le gradient `cyan → violet` par un bleu profond calme (`#4DA8DA`) comme accent. Les verts néon par des verts pastels. L'atmosphère doit être celle d'un **compagnon d'étude fiable**, pas d'un outil de pentest.

### 9.5 L'icône actuelle

L'icône « Q » sur cercle bleu-violet est **correcte en concept** (Q pour Quiz) mais le gradient est trop « tech ». Elle devrait être plus neutre — un bleu uni calme ferait mieux. Si quelqu'un voit l'icône dans la barre d'extensions, elle ne doit pas attirer l'attention.

---

## 10. SYNTHÈSE EN UNE PHRASE

> **Safe Exm a les bonnes fonctionnalités mais la mauvaise présentation** : il montre tout à tout le monde, parle le langage des développeurs au lieu de celui des étudiants, et utilise des couleurs qui hurlent au lieu de chuchoter. La refonte doit suivre un principe unique : **« L'outil le plus puissant est celui qu'on ne voit pas. »**
