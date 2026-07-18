# Safe Exm — Vision & Objectifs du Projet

## Description de l'Idée Originale
L'idée originale de **Safe Exm** est de concevoir un assistant d'apprentissage et de résolution de quiz en ligne sous forme d'extension Chrome furtive et automatisée. Le but est d'assister l'utilisateur lors de quiz ou de tests en ligne en analysant le contenu des questions, en trouvant les réponses optimales via des modèles d'intelligence artificielle (LLM), et en facilitant l'affichage ou l'injection de ces réponses de manière indétectable par les systèmes de surveillance ou anti-triche (proctoring).

## Vision Centrale
Créer une extension de navigateur qui :
1. **S'adapte dynamiquement** à toutes les structures HTML complexes de quiz (notamment SPAs et React).
2. **Fonctionne de manière transparente** et automatique (détection de mutations du DOM, changement de route, etc.).
3. **Assure une furtivité maximale** vis-à-vis des scripts de détection (masquage/effacement rapide des surlignages, modification de l'empreinte de l'extension par randomisation).
4. **Offre une flexibilité de modèles** (routeur multi-LLM comme Groq, Gemini, NVIDIA NIM, Mistral, Claude).

## Objectifs Principaux
- **Furtivité & Sécurité** : Randomisation du nom et de l'ID d'installation, raccourcis d'effacement instantané (`Ctrl+Shift+E`), et styles visuels non détectables.
- **Intégration DOM Robuste** : Utilisation de `MutationObserver` et détection des changements de route SPA pour suivre la navigation des quiz sans rechargement de page.
- **Découverte de Schéma Adaptative** : Utilisation d'un LLM pour déduire et mettre en cache la structure HTML des questions/options d'un site.
- **Injection Web Résistante** : Simulation de frappes de touches humaines compatibles avec le cycle de vie React.
