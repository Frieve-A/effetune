---
title: "Spatial Plugins - EffeTune"
description: "Spatial audio plugins including Stereo Blend, Crossfeed Filter, MS Matrix, and Multiband Balance."
lang: en
---

# Spatial Audio Plugins

Une collection de plugins qui améliorent le rendu de votre musique dans vos casques ou enceintes en ajustant la balance stéréo (gauche et droite). Ces effets peuvent rendre votre musique plus spacieuse et naturelle, particulièrement lors de l'écoute au casque.

## Liste des Plugins

- [Crossfeed Filter](#crossfeed-filter) - Filtre de crossfeed pour casques pour une image stéréo naturelle
- [MS Matrix](#ms-matrix) - Ajuste l'image stéréo en contrôlant séparément les niveaux Mid et Side, avec option de permutation Left/Right  
- [Multiband Balance](#multiband-balance) - Contrôle de balance stéréo dépendant de la fréquence à 5 bandes
- [Stereo Blend](#stereo-blend) - Contrôle la largeur stéréo de mono à stéréo améliorée

## Crossfeed Filter

Un filtre de crossfeed pour casques qui simule la diaphonie acoustique naturelle qui se produit lors de l'écoute via des haut-parleurs. Cet effet aide à réduire la séparation stéréo exagérée souvent ressentie avec des casques, créant une expérience d'écoute plus naturelle et confortable qui imite la façon dont le son atteint nos oreilles dans un environnement acoustique réel.

### Fonctionnalités clés
- Simule la diaphonie acoustique naturelle pour l'écoute au casque
- Niveau de crossfeed et timing ajustables
- Filtrage passe-bas pour imiter la diaphonie dépendante de la fréquence
- Traitement stéréo uniquement (automatiquement contourné pour les signaux mono)

### Paramètres
- **Level** (-60 dB à 0 dB) : Contrôle la quantité de signal de crossfeed
  - Valeurs plus basses (-20 dB à -6 dB) : Crossfeed subtil et naturel
  - Valeurs plus élevées (-6 dB à 0 dB) : Effet plus prononcé
- **Delay** (0 ms à 1 ms) : Simule la différence de temps de la diaphonie acoustique
  - Valeurs plus basses (0.1-0.3 ms) : Image plus serrée et focalisée
  - Valeurs plus élevées (0.3-1.0 ms) : Présentation plus spacieuse, similaire aux haut-parleurs
- **LPF Freq** (100 Hz à 20000 Hz) : Contrôle la réponse en fréquence du crossfeed
  - Valeurs plus basses (500-1000 Hz) : Diaphonie plus naturelle dépendante de la fréquence
  - Valeurs plus élevées (1000-20000 Hz) : Réponse en fréquence plus large

### Réglages recommandés

1. Écoute Naturelle au Casque
   - Level : -12 dB
   - Delay : 0.3 ms
   - LPF Freq : 700 Hz
   - Effet : Crossfeed subtil pour une écoute confortable à long terme

2. Simulation de Haut-parleurs
   - Level : -6 dB
   - Delay : 0.5 ms
   - LPF Freq : 1000 Hz
   - Effet : Présentation plus prononcée similaire aux haut-parleurs

3. Amélioration Subtile
   - Level : -20 dB
   - Delay : 0.2 ms
   - LPF Freq : 500 Hz
   - Effet : Crossfeed très doux pour les auditeurs sensibles

### Guide d'application

1. Optimisation du Casque
   - Commencez par des réglages conservateurs (-15 dB level, 0.3 ms delay)
   - Ajustez le niveau pour le confort et la naturalité
   - Affinez le délai pour la perception spatiale
   - Utilisez LPF pour contrôler la réponse en fréquence

2. Considérations de Style Musical
   - Classique/Jazz : Niveaux plus bas (-15 à -10 dB) pour une présentation naturelle
   - Rock/Pop : Niveaux modérés (-10 à -6 dB) pour l'énergie
   - Électronique : Niveaux plus élevés (-6 à 0 dB) pour la spatialité

3. Environnement d'Écoute
   - Environnements calmes : Niveaux plus bas pour un effet subtil
   - Environnements bruyants : Niveaux plus élevés pour une meilleure focalisation
   - Sessions d'écoute longues : Réglages conservateurs pour réduire la fatigue

### Guide de démarrage rapide

1. Configuration initiale
   - Réglez Level à -12 dB
   - Réglez Delay à 0.3 ms
   - Réglez LPF Freq à 700 Hz

2. Ajustement fin
   - Ajustez Level pour la quantité de crossfeed souhaitée
   - Modifiez Delay pour la perception spatiale
   - Affinez LPF Freq pour la réponse en fréquence

3. Optimisation
   - Écoutez pour une présentation naturelle et confortable
   - Évitez les réglages excessifs qui sonnent artificiels
   - Testez avec différents styles musicaux

Rappel : Le Crossfeed Filter est conçu pour rendre l'écoute au casque plus naturelle et confortable. Commencez par des réglages conservateurs et ajustez progressivement pour trouver l'équilibre optimal pour vos préférences d'écoute et votre matériel musical.

## MS Matrix

Un processeur mid/side flexible qui vous permet de contrôler indépendamment le centre (mid) et la largeur (side) de votre signal stéréo. Utilisez des commandes de gain simples et une option de permutation Left/Right pour affiner la position de votre son dans le champ stéréo sans routage complexe.

### Fonctionnalités clés
- Gains Mid et Side séparés (–18 dB à +18 dB)  
- Sélecteur de Mode : Encode (Stereo→M/S) ou Decode (M/S→Stereo)  
- Permutation Left/Right facultative avant l'encodage ou après le décodage  
- Modifications de paramètres sans clic pour des ajustements fluides  

### Paramètres
- **Mode** (Encode/Decode)  
- **Mid Gain** (–18 dB à +18 dB) : Ajuste le niveau du contenu central  
- **Side Gain** (–18 dB à +18 dB) : Ajuste le niveau de la différence stéréo (largeur)  
- **Swap L/R** (Off/On) : Échange les canaux gauche et droit avant l'encodage ou après le décodage  

### Paramètres recommandés
1. **Élargissement subtil**  
   - Mode: Decode  
   - Mid Gain: 0 dB  
   - Side Gain: +3 dB  
   - Swap: Off  
2. **Focus central**  
   - Mode: Decode  
   - Mid Gain: +3 dB  
   - Side Gain: –3 dB  
   - Swap: Off  
3. **Inversion créative**  
   - Mode: Encode  
   - Mid Gain: 0 dB  
   - Side Gain: 0 dB  
   - Swap: On  

### Guide de démarrage rapide
1. Sélectionnez **Mode** pour la conversion  
2. Ajustez **Mid Gain** et **Side Gain**  
3. Activez **Swap L/R** pour la correction des canaux ou l'inversion créative  
4. Bypass pour comparer et vérifier l'absence de problèmes de phase  

## Multiband Balance

Un processeur spatial sophistiqué qui divise l'audio en cinq bandes de fréquences et permet un contrôle de balance stéréo indépendant de chaque bande. Ce plugin permet un contrôle précis de l'image stéréo à travers le spectre des fréquences, offrant des possibilités créatives pour le design sonore et le mixage, ainsi que des applications correctives pour les enregistrements stéréo problématiques.

### Caractéristiques Principales
- Contrôle de balance stéréo dépendant de la fréquence à 5 bandes
- Filtres de séparation Linkwitz-Riley de haute qualité
- Contrôle de balance linéaire pour ajustement stéréo précis
- Traitement indépendant des canaux gauche et droit
- Changements de paramètres sans clics avec gestion automatique des fondus

### Paramètres

#### Fréquences de Séparation
- **Freq 1** (20-500 Hz) : Sépare les bandes basses et médium-basses
- **Freq 2** (100-2000 Hz) : Sépare les bandes médium-basses et médiums
- **Freq 3** (500-8000 Hz) : Sépare les bandes médiums et médium-hautes
- **Freq 4** (1000-20000 Hz) : Sépare les bandes médium-hautes et hautes

#### Contrôles de Bande
Chaque bande dispose d'un contrôle de balance indépendant :
- **Band 1 Bal.** (-100% à +100%) : Contrôle la balance stéréo des basses fréquences
- **Band 2 Bal.** (-100% à +100%) : Contrôle la balance stéréo des fréquences médium-basses
- **Band 3 Bal.** (-100% à +100%) : Contrôle la balance stéréo des fréquences médiums
- **Band 4 Bal.** (-100% à +100%) : Contrôle la balance stéréo des fréquences médium-hautes
- **Band 5 Bal.** (-100% à +100%) : Contrôle la balance stéréo des hautes fréquences

### Réglages Recommandés

1. Amélioration Stéréo Naturelle
   - Bande Basse (20-100 Hz) : 0% (centré)
   - Médium-Basse (100-500 Hz) : ±20%
   - Médium (500-2000 Hz) : ±40%
   - Médium-Haute (2000-8000 Hz) : ±60%
   - Haute (8000+ Hz) : ±80%
   - Effet : Crée une expansion stéréo progressive qui s'élargit avec la fréquence

2. Mix Focalisé
   - Bande Basse : 0%
   - Médium-Basse : ±10%
   - Médium : ±30%
   - Médium-Haute : ±20%
   - Haute : ±40%
   - Effet : Maintient la focalisation centrale tout en ajoutant une largeur subtile

3. Paysage Sonore Immersif
   - Bande Basse : 0%
   - Médium-Basse : ±40%
   - Médium : ±60%
   - Médium-Haute : ±80%
   - Haute : ±100%
   - Effet : Crée un champ sonore enveloppant avec des basses ancrées

### Guide d'Application

1. Amélioration du Mix
   - Gardez les basses fréquences (sous 100 Hz) centrées pour des basses stables
   - Augmentez progressivement la largeur stéréo avec la fréquence
   - Utilisez des réglages modérés (±30-50%) pour une amélioration naturelle
   - Contrôlez en mono pour vérifier les problèmes de phase

2. Résolution de Problèmes
   - Corrigez les problèmes de phase dans des plages de fréquences spécifiques
   - Resserrez les basses non focalisées en centrant les basses fréquences
   - Réduisez les artefacts stéréo agressifs dans les hautes fréquences
   - Réparez les pistes stéréo mal enregistrées

3. Design Sonore Créatif
   - Créez des mouvements dépendants de la fréquence
   - Concevez des effets spatiaux uniques
   - Construisez des paysages sonores immersifs
   - Améliorez des instruments ou éléments spécifiques

4. Ajustement du Champ Stéréo
   - Ajustement fin de la balance stéréo par bande de fréquence
   - Correction de la distribution stéréo inégale
   - Amélioration de la séparation stéréo où nécessaire
   - Maintien de la compatibilité mono

### Guide de Démarrage Rapide

1. Configuration Initiale
   - Commencez avec toutes les bandes centrées (0%)
   - Réglez les fréquences de séparation aux points standards :
     * Freq 1 : 100 Hz
     * Freq 2 : 500 Hz
     * Freq 3 : 2000 Hz
     * Freq 4 : 8000 Hz

2. Amélioration de Base
   - Gardez Band 1 (basses) centré
   - Faites de petits ajustements sur les bandes plus hautes
   - Écoutez les changements dans l'image spatiale
   - Vérifiez la compatibilité mono

3. Réglage Fin
   - Ajustez les points de séparation pour correspondre à votre matériel
   - Effectuez des changements graduels des positions de bande
   - Écoutez les artefacts indésirables
   - Comparez avec le bypass pour perspective

N'oubliez pas : Le Multiband Balance est un outil puissant qui nécessite un ajustement soigneux. Commencez avec des réglages subtils et augmentez la complexité selon les besoins. Vérifiez toujours vos ajustements en stéréo et en mono pour assurer la compatibilité.

## Stereo Blend

Un effet qui aide à obtenir un champ sonore plus naturel en ajustant la largeur stéréo de votre musique. Il est particulièrement utile pour l'écoute au casque, où il peut réduire la séparation stéréo exagérée qui se produit souvent avec les casques, rendant l'expérience d'écoute plus naturelle et moins fatigante. Il peut également améliorer l'image stéréo pour l'écoute sur enceintes lorsque nécessaire.

### Guide d'Amélioration de l'Écoute
- Optimisation Casque :
  - Réduisez la largeur stéréo (60-90%) pour une présentation plus naturelle, similaire aux enceintes
  - Minimisez la fatigue d'écoute due à une séparation stéréo excessive
  - Créez une scène sonore frontale plus réaliste
- Amélioration Enceintes :
  - Maintenez l'image stéréo originale (100%) pour une reproduction précise
  - Amélioration subtile (110-130%) pour une scène sonore plus large si nécessaire
  - Ajustement prudent pour maintenir un champ sonore naturel
- Contrôle du Champ Sonore :
  - Concentration sur une présentation naturelle et réaliste
  - Évitez une largeur excessive qui pourrait sonner artificielle
  - Optimisez pour votre environnement d'écoute spécifique

### Parameters
- **Stereo** - Contrôle la largeur stéréo (0-200%)
  - 0% : Mono complet (canaux gauche et droit additionnés)
  - 100% : Image stéréo originale
  - 200% : Stéréo améliorée avec largeur maximale (L-R/R-L)

### Réglages Recommandés pour Différents Scénarios d'Écoute

1. Écoute au Casque (Naturel)
   - Stereo : 60-90%
   - Effet : Séparation stéréo réduite
   - Parfait pour : Longues sessions d'écoute, réduction de la fatigue

2. Écoute sur Enceintes (Référence)
   - Stereo : 100%
   - Effet : Image stéréo originale
   - Parfait pour : Reproduction précise

3. Amélioration Enceintes
   - Stereo : 110-130%
   - Effet : Amélioration subtile de la largeur
   - Parfait pour : Pièces avec placement rapproché des enceintes

### Guide d'Optimisation par Style Musical

- Musique Classique
  - Casque : 70-80%
  - Enceintes : 100%
  - Avantage : Perspective naturelle de salle de concert

- Jazz & Acoustique
  - Casque : 80-90%
  - Enceintes : 100-110%
  - Avantage : Son d'ensemble intime et réaliste

- Rock & Pop
  - Casque : 85-95%
  - Enceintes : 100-120%
  - Avantage : Impact équilibré sans largeur artificielle

- Musique Électronique
  - Casque : 90-100%
  - Enceintes : 100-130%
  - Avantage : Spatialisation contrôlée tout en maintenant la focalisation

### Guide de Démarrage Rapide

1. Choisissez Votre Configuration d'Écoute
   - Identifiez si vous utilisez un casque ou des enceintes
   - Cela détermine votre point de départ pour l'ajustement

2. Commencez avec des Réglages Conservateurs
   - Casque : Commencez à 80%
   - Enceintes : Commencez à 100%
   - Écoutez le placement naturel du son

3. Affinez pour Votre Musique
   - Faites de petits ajustements (5-10% à la fois)
   - Concentrez-vous sur l'obtention d'un champ sonore naturel
   - Prêtez attention au confort d'écoute

N'oubliez pas : L'objectif est d'obtenir une expérience d'écoute naturelle et confortable qui réduit la fatigue et maintient la présentation musicale voulue. Évitez les réglages extrêmes qui peuvent sembler impressionnants au début mais deviennent fatigants avec le temps.