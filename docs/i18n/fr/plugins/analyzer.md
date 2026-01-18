---
title: "Analyzer Plugins - EffeTune"
description: "Audio analysis plugins including Level Meter, Oscilloscope, Spectrogram, Spectrum Analyzer, and Stereo Meter."
lang: en
---

# Analyzer Plugins

Une collection de plugins qui vous permettent de visualiser votre musique de manière fascinante. Ces outils visuels vous aident à comprendre ce que vous entendez en montrant différents aspects du son, rendant votre expérience d'écoute plus immersive et interactive.

## Plugin List

- [Level Meter](#level-meter) - Affiche le volume sonore de la musique
- [Oscilloscope](#oscilloscope) - Affiche la visualisation de la forme d'onde en temps réel
- [Spectrogram](#spectrogram) - Crée de magnifiques motifs visuels à partir de votre musique
- [Spectrum Analyzer](#spectrum-analyzer) - Affiche les différentes fréquences de votre musique
- [Stereo Meter](#stereo-meter) - Visualise l'équilibre stéréo et le mouvement du son

## Level Meter

Un affichage visuel qui montre en temps réel le volume de votre musique. Il vous aide à vous assurer que vous écoutez à des niveaux confortables et à éviter toute distorsion due à un volume trop élevé.

### Guide de Visualisation
- L'indicateur monte et descend avec le volume de la musique
- Plus l'indicateur est haut, plus le son est fort
- Le marqueur rouge indique le niveau le plus élevé récent
- L'avertissement rouge en haut signifie que le volume pourrait être trop fort
- Pour une écoute confortable, essayez de maintenir les niveaux dans la plage moyenne

## Oscilloscope

Un oscilloscope de qualité professionnelle qui affiche les formes d'onde audio en temps réel, vous aidant à visualiser la forme réelle de vos ondes sonores. Il dispose d'une fonction de déclenchement pour un affichage stable de la forme d'onde, facilitant l'analyse des signaux périodiques et des transitoires.

### Guide de Visualisation
- L'axe horizontal montre le temps (millisecondes)
- L'axe vertical montre l'amplitude (-1 à 1)
- La ligne verte trace la forme d'onde réelle
- Les lignes de la grille aident à mesurer les valeurs de temps et d'amplitude
- Le point de déclenchement marque où commence la capture de la forme d'onde

### Parameters
- **Display Time** - Durée d'affichage (1 à 100 ms)
  - Valeurs basses : Voir plus de détails dans les événements courts
  - Valeurs hautes : Voir des motifs plus longs
- **Trigger Mode**
  - Auto : Mises à jour continues même sans déclenchement
  - Normal : Fige l'affichage jusqu'au prochain déclenchement
- **Trigger Source** - Canal de déclenchement
  - Sélection du canal gauche/droit
- **Trigger Level** - Niveau d'amplitude qui démarre la capture
  - Plage : -1 à 1 (amplitude normalisée)
- **Trigger Edge**
  - Rising : Déclenche quand le signal monte
  - Falling : Déclenche quand le signal descend
- **Holdoff** - Temps minimum entre les déclenchements (0.1 à 10 ms)
- **Display Level** - Échelle verticale en dB (-96 à 0 dB)
- **Vertical Offset** - Décale la forme d'onde vers le haut/bas (-1 à 1)

### Note sur l'Affichage de la Forme d'Onde
L'affichage de la forme d'onde utilise une interpolation linéaire entre les points d'échantillonnage pour une visualisation fluide. Cela signifie que le signal audio réel entre les échantillons peut différer de ce qui est affiché. Pour une représentation plus précise, en particulier lors de l'analyse du contenu haute fréquence, envisagez d'utiliser des taux d'échantillonnage plus élevés (96kHz ou plus).

## Spectrogram

Crée de magnifiques motifs colorés qui montrent l'évolution de votre musique dans le temps. C'est comme voir une peinture de votre musique, où différentes couleurs représentent différents sons et fréquences.

### Guide de Visualisation
- Les couleurs montrent l'intensité des différentes fréquences :
  - Couleurs sombres : Sons faibles
  - Couleurs vives : Sons forts
  - Observez les motifs changer avec la musique
- La position verticale indique la fréquence :
  - Bas : Sons graves
  - Milieu : Instruments principaux
  - Haut : Hautes fréquences

### Ce Que Vous Pouvez Voir
- Mélodies : Lignes de couleur fluides
- Rythmes : Bandes verticales
- Basses : Couleurs vives en bas
- Harmonies : Lignes parallèles multiples
- Différents instruments créent des motifs uniques

### Parameters
- **DB Range** - Intensité des couleurs (-144dB à -48dB)
  - Nombres plus bas : Voir plus de détails subtils
  - Nombres plus hauts : Se concentrer sur les sons principaux
- **Points** - Niveau de détail des motifs (256 à 16384)
  - Nombres plus hauts : Motifs plus précis
  - Nombres plus bas : Visuels plus fluides
- **Channel** - Quelle partie du champ stéréo afficher
  - All : Tout combiné
  - Left/Right : Côtés individuels

## Spectrum Analyzer

Crée un affichage visuel en temps réel des fréquences de votre musique, des basses profondes aux aigus. C'est comme voir les ingrédients individuels qui composent le son complet de votre musique.

### Guide de Visualisation
- La gauche montre les basses fréquences (batterie, basse)
- Le milieu montre les fréquences principales (voix, guitares, piano)
- La droite montre les hautes fréquences (cymbales, brillance, air)
- Les pics plus hauts indiquent une présence plus forte de ces fréquences
- Observez comment différents instruments créent différents motifs

### Ce Que Vous Pouvez Voir
- Drops de basse : Grands mouvements à gauche
- Mélodies vocales : Activité au milieu
- Aigus cristallins : Étincelles à droite
- Mix complet : Comment toutes les fréquences fonctionnent ensemble

### Parameters
- **DB Range** - Sensibilité de l'affichage (-144dB à -48dB)
  - Nombres plus bas : Voir plus de détails subtils
  - Nombres plus hauts : Se concentrer sur les sons principaux
- **Points** - Niveau de détail de l'affichage (256 à 16384)
  - Nombres plus hauts : Plus de détails précis
  - Nombres plus bas : Mouvement plus fluide
- **Channel** - Quelle partie du champ stéréo afficher
  - All : Tout combiné
  - Left/Right : Côtés individuels

### Façons Amusantes d'Utiliser Ces Outils

1. Explorer Votre Musique
   - Observez comment différents genres créent différents motifs
   - Voyez la différence entre la musique acoustique et électronique
   - Observez comment les instruments occupent différentes plages de fréquences

2. Apprendre Sur le Son
   - Voyez les basses dans la musique électronique
   - Suivez les mélodies vocales à travers l'affichage
   - Observez comment la batterie crée des motifs nets

3. Améliorer Votre Expérience
   - Utilisez le Level Meter pour trouver des volumes d'écoute confortables
   - Regardez le Spectrum Analyzer danser avec la musique
   - Créez un spectacle de lumière visuel avec le Spectrogram

## Stereo Meter

Un outil de visualisation fascinant qui vous permet de voir comment votre musique crée une sensation d'espace à travers le son stéréo. Observez comment les différents instruments et sons se déplacent entre vos enceintes ou votre casque, ajoutant une dimension visuelle captivante à votre expérience d'écoute.

### Guide de Visualisation
- **Affichage en Diamant** - La fenêtre principale où la musique prend vie :
  - Centre : Quand le son est parfaitement équilibré
  - Haut/Bas : Quand la musique remplit uniformément les deux enceintes
  - Gauche/Droite : Quand le son provient davantage d'une enceinte
  - Les points verts dansent avec la musique actuelle
  - La ligne blanche trace les pics musicaux
- **Barre de Mouvement** (Côté gauche)
  - Montre comment vos enceintes travaillent ensemble
  - Haut (+1.0) : Les deux enceintes jouent le même son
  - Milieu (0.0) : Les enceintes créent un bel effet stéréo
  - Bas (-1.0) : Les enceintes créent des effets spéciaux
- **Barre de Balance** (Bas)
  - Indique si une enceinte est plus forte que l'autre
  - Centre : Musique également forte dans les deux enceintes
  - Gauche/Droite : Musique plus forte dans une enceinte
  - Les chiffres montrent la différence en décibels (dB)

### Ce Que Vous Pouvez Voir
- **Son Centré** : Mouvement vertical fort au milieu
- **Son Spacieux** : Activité répartie sur tout l'affichage
- **Effets Spéciaux** : Motifs intéressants dans les coins
- **Balance des Enceintes** : Où pointe la barre inférieure
- **Mouvement du Son** : Hauteur de la barre gauche

### Parameters
- **Window Time** (10-1000 ms)
  - Valeurs basses : Voir les changements musicaux rapides
  - Valeurs hautes : Voir les motifs sonores globaux
  - Par défaut : 100 ms convient bien à la plupart des musiques

### Profiter de Votre Musique
1. **Observez Différents Styles**
   - La musique classique montre souvent des motifs doux et équilibrés
   - La musique électronique peut créer des designs sauvages et expansifs
   - Les enregistrements live peuvent montrer un mouvement naturel de la salle

2. **Découvrez les Qualités Sonores**
   - Voyez comment différents albums utilisent les effets stéréo
   - Remarquez comment certaines chansons semblent plus larges que d'autres
   - Observez comment les instruments se déplacent entre les enceintes

3. **Améliorez Votre Expérience**
   - Essayez différents casques pour voir comment ils restituent la stéréo
   - Comparez les anciennes et nouvelles versions de vos chansons préférées
   - Observez comment différentes positions d'écoute changent l'affichage

N'oubliez pas : Ces outils sont conçus pour améliorer votre plaisir d'écoute en ajoutant une dimension visuelle à votre expérience musicale. Amusez-vous à explorer et à découvrir de nouvelles façons de voir votre musique préférée !