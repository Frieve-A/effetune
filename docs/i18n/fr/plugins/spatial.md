---
title: "Plugins Spatial - EffeTune"
description: "Plugins audio spatiaux incluant Stereo Blend, Crossfeed Filter, MS Matrix et Multiband Balance."
lang: fr
---

# Plugins Audio Spatiaux

Une collection de plugins qui améliorent le rendu de votre musique dans vos casques ou enceintes en ajustant la balance stéréo (gauche et droite). Ces effets peuvent rendre votre musique plus spacieuse et naturelle, particulièrement lors de l'écoute au casque.

## Liste des Plugins

- [Crossfeed Filter](#crossfeed-filter) - Filtre de crossfeed pour casques pour une image stéréo naturelle
- [MS Matrix](#ms-matrix) - Convertit entre stéréo gauche/droite et format Mid/Side
- [Multiband Balance](#multiband-balance) - Contrôle de balance stéréo dépendant de la fréquence à 5 bandes
- [Stereo Blend](#stereo-blend) - Contrôle la largeur stéréo de mono à stéréo élargie ou inversion de side

## Crossfeed Filter

Un filtre de crossfeed pour casques qui simule la diaphonie acoustique naturelle qui se produit lors de l'écoute via des haut-parleurs. Cet effet aide à réduire la séparation stéréo exagérée souvent ressentie avec des casques, créant une expérience d'écoute plus naturelle et confortable qui imite la façon dont le son atteint nos oreilles dans un environnement acoustique réel.

### Fonctionnalités clés
- Simule la diaphonie acoustique naturelle pour l'écoute au casque
- Niveau de crossfeed et timing ajustables
- Filtrage passe-bas pour imiter la diaphonie dépendante de la fréquence
- Traitement stéréo uniquement (automatiquement contourné pour les signaux mono ou non stéréo)

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
   - Rock/Pop : Niveaux modérés (-12 à -8 dB) pour adoucir les guitares ou voix très latéralisées tout en gardant l'énergie
   - Électronique ou mix très large : Niveaux bas à modérés (-18 à -10 dB) pour garder la largeur, ou plus hauts seulement pour calmer une séparation gauche/droite excessive

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

MS Matrix convertit un signal stéréo normal au format Mid/Side, ou reconvertit un signal Mid/Side en stéréo normale. Utilisez-le lorsque vous voulez ajuster séparément les informations de centre et de côté dans une chaîne d'effets, par exemple encoder en M/S, modifier le niveau Mid ou Side, puis décoder vers la stéréo. Pour un simple réglage de largeur stéréo sur de la musique normale, [Stereo Blend](#stereo-blend) est l'outil le plus direct.

### Fonctionnalités clés
- Gains Mid et Side séparés (–18 dB à +18 dB)  
- Sélecteur de Mode : Encode (Stereo→M/S) ou Decode (M/S→Stereo)  
- Permutation Left/Right facultative avant l'encodage ou après le décodage  

### Paramètres
- **Mode** (Encode/Decode) : Encode transforme la stéréo gauche/droite en Mid sur le canal gauche et Side sur le canal droit. Decode traite le canal gauche comme Mid et le canal droit comme Side, puis reconstruit une stéréo normale.
- **Mid Gain** (–18 dB à +18 dB) : Ajuste le niveau Mid pendant la conversion sélectionnée
- **Side Gain** (–18 dB à +18 dB) : Ajuste le niveau Side pendant la conversion sélectionnée
- **Swap L/R** (Off/On) : Échange les canaux gauche et droit avant l'encodage ou après le décodage  

### Paramètres recommandés
1. **Élargissement subtil**  
   - Premier MS Matrix : Mode: Encode, Mid Gain: 0 dB, Side Gain: +3 dB, Swap: Off
   - Second MS Matrix après lui : Mode: Decode, Mid Gain: 0 dB, Side Gain: 0 dB, Swap: Off
   - Effet : Renforce légèrement la composante Side, puis ramène le résultat en stéréo normale
2. **Focus central**  
   - Premier MS Matrix : Mode: Encode, Mid Gain: +3 dB, Side Gain: -3 dB, Swap: Off
   - Second MS Matrix après lui : Mode: Decode, Mid Gain: 0 dB, Side Gain: 0 dB, Swap: Off
   - Effet : Met les voix et sons centrés plus en avant tout en réduisant l'ambiance latérale
3. **Décoder un Signal M/S Existant**
   - Mode: Decode
   - Mid Gain: 0 dB
   - Side Gain: 0 dB
   - Swap: Off
   - À utiliser seulement lorsque le signal entrant est déjà au format Mid/Side
4. **Inversion créative**
   - Mode: Encode  
   - Mid Gain: 0 dB  
   - Side Gain: 0 dB  
   - Swap: On  

### Guide de démarrage rapide
1. Décidez si vous avez besoin d'une seule conversion ou d'une chaîne complète Encode -> ajustement -> Decode.
2. Pour une écoute stéréo normale, placez un MS Matrix en mode Encode puis un second plus loin en mode Decode.
3. Ajustez **Mid Gain** et **Side Gain** sur l'étage Encode.
4. Activez **Swap L/R** seulement pour corriger les canaux ou créer une inversion.
5. Bypass pour comparer et vérifier que l'image stéréo reste naturelle.

## Multiband Balance

Un processeur de balance dépendant de la fréquence qui divise l'audio en cinq bandes et permet de déplacer chaque bande légèrement vers la gauche ou la droite. Utilisez-le lorsque les basses, voix, cymbales ou autres plages de fréquences semblent tirées d'un côté et que vous voulez rééquilibrer seulement cette partie du son sans déplacer tout le morceau.

### Caractéristiques Principales
- Contrôle de balance stéréo dépendant de la fréquence à 5 bandes
- Filtres de séparation Linkwitz-Riley de haute qualité
- Contrôle de balance linéaire pour ajustement stéréo précis
- Traitement indépendant des canaux gauche et droit
- Gestion automatique des fondus lorsque les filtres de crossover sont réinitialisés

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

1. Corriger des Aigus Tirés vers la Droite
   - Bande Basse (20-100 Hz) : 0% (centré)
   - Médium-Basse (100-500 Hz) : 0%
   - Médium (500-2000 Hz) : 0%
   - Médium-Haute (2000-8000 Hz) : -10% à -25%
   - Haute (8000+ Hz) : -10% à -30%
   - Effet : Déplace légèrement le contenu brillant vers la gauche tout en gardant les basses et voix stables

2. Corriger un Bas-Médium Tiré vers la Gauche
   - Bande Basse : 0%
   - Médium-Basse : +10% à +25%
   - Médium : +5% à +15%
   - Médium-Haute : 0%
   - Haute : 0%
   - Effet : Déplace légèrement le corps chaleureux et les voix basses vers la droite sans changer toute l'image stéréo

3. Garder les Basses Centrées en Ajustant l'Air
   - Bande Basse : 0%
   - Médium-Basse : 0%
   - Médium : 0%
   - Médium-Haute : +5% à +15%
   - Haute : +10% à +20%
   - Effet : Déplace doucement l'ambiance haute vers la droite tandis que le grave reste centré

### Guide d'Application

1. Correction de Balance à l'Écoute
   - Gardez les basses fréquences (sous 100 Hz) centrées pour des basses stables
   - Déplacez seulement la plage de fréquences qui semble décentrée
   - Utilisez d'abord de petites valeurs signées (environ 5-20%)
   - Vérifiez l'écoute mono pour repérer les changements de tonalité ou de niveau

2. Résolution de Problèmes
   - Rééquilibrez les plages de fréquences qui semblent trop à gauche ou à droite
   - Resserrez les basses non focalisées en centrant les basses fréquences
   - Réduisez les artefacts stéréo agressifs dans les hautes fréquences
   - Améliorez les enregistrements où différentes parties du son penchent de côtés différents

3. Effets d'Écoute Créatifs
   - Créez un placement inhabituel dépendant de la fréquence
   - Faites pencher les hautes fréquences d'un côté tout en gardant les basses centrées
   - Construisez une ambiance qui semble plus large avec de petits déplacements dans les bandes hautes

4. Ajustement du Champ Stéréo
   - Ajustement fin de la balance stéréo par bande de fréquence
   - Correction de la distribution stéréo inégale
   - Ne l'utilisez pas comme contrôle de largeur stéréo ; utilisez Stereo Blend pour élargir ou rétrécir l'image entière
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
  - Utilisez les valeurs négatives seulement pour une inversion de polarité du composant Side à des fins correctives ou créatives
  - Optimisez pour votre environnement d'écoute spécifique

### Paramètres
- **Stereo** - Contrôle la largeur stéréo (-200% à 200%)
  - Valeurs négatives : Inversent la polarité du composant stéréo side (L-R) avant reconstruction
  - -200% : Largeur maximale avec polarité side inversée ; à utiliser seulement pour correction ou cas particuliers
  - -100% : Largeur stéréo originale avec image gauche/droite inversée
  - 0% : Mono complet (canaux gauche et droit additionnés)
  - 100% : Image stéréo originale
  - 200% : Largeur maximale ; garde le centre tout en renforçant fortement la différence stéréo side

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
