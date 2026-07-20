---
title: "Plugins d'analyse - EffeTune"
description: "Plugins de visualisation audio, dont Level Meter, Oscilloscope, Spectrogram, Spectrum Analyzer et Stereo Meter."
lang: fr
---

# Plugins d'analyse

Une collection de plugins qui vous permettent de visualiser votre musique de manière fascinante. Ces outils visuels vous aident à comprendre ce que vous entendez en montrant différents aspects du son, rendant votre expérience d'écoute plus immersive et interactive.

## Liste des plugins

- [Level Meter](#level-meter) - Affiche le niveau du signal numérique et les risques de clipping
- [Oscilloscope](#oscilloscope) - Affiche la visualisation de la forme d'onde en temps réel
- [Spectrogram](#spectrogram) - Crée de magnifiques motifs visuels à partir de votre musique
- [Spectrum Analyzer](#spectrum-analyzer) - Affiche les différentes fréquences de votre musique
- [Stereo Meter](#stereo-meter) - Visualise l'équilibre stéréo et la corrélation entre canaux

## Level Meter

Un affichage visuel qui montre le niveau du signal en temps réel. Il vous aide à vérifier les niveaux après les effets et à repérer un éventuel clipping numérique.

### Guide de Visualisation
- La barre s'étend vers la droite quand le niveau du signal augmente
- Le marqueur blanc conserve brièvement le niveau le plus élevé récent
- L'avertissement OVERLOAD signifie que le signal a dépassé la plage numérique sûre et peut se déformer
- Pour une lecture propre, évitez les niveaux rouges fréquents et les avertissements OVERLOAD ; réglez le volume d'écoute réel sur votre appareil

## Oscilloscope

Affiche la forme de l'onde sonore en temps réel, afin de voir les impacts, les battements et les changements de niveau pendant l'écoute. Les réglages de déclenchement peuvent stabiliser l'affichage lorsqu'une forme d'onde se répète.

### Guide de Visualisation
- L'axe horizontal montre le temps (millisecondes)
- L'axe vertical montre l'amplitude normalisée ; la plage visible change avec Display Level et Vertical Offset
- La ligne verte trace la forme d'onde réelle
- Les lignes de la grille aident à mesurer les valeurs de temps et d'amplitude
- Quand un déclenchement est détecté, la forme d'onde affichée démarre depuis cette position ; aucun marqueur séparé n'est affiché

### Paramètres
- **Display Time** - Durée d'affichage (1 à 100 ms)
  - Valeurs basses : Voir plus de détails dans les événements courts
  - Valeurs hautes : Voir des motifs plus longs
- **Trigger Mode**
  - Auto : Mises à jour continues même sans déclenchement
  - Normal : Fige l'affichage jusqu'au prochain déclenchement
- La détection du déclenchement utilise la moyenne des canaux gauche et droit. Une entrée mono est utilisée directement.
- **Trigger Level** - Niveau d'amplitude qui démarre la capture
  - Plage : -1 à 1 (amplitude normalisée)
- **Trigger Edge**
  - Rising : Déclenche quand le signal monte
  - Falling : Déclenche quand le signal descend
- **Holdoff** - Temps minimum entre les déclenchements (0.1 à 10 ms)
- **Display Level** - Échelle verticale en dB (-96 à 0 dB)
- **Vertical Offset** - Décale la forme d'onde vers le haut/bas (-1 à 1)

### Note sur l'Affichage de la Forme d'Onde
La forme d'onde relie les points capturés dans l'ordre chronologique. Pour les durées d'affichage longues, chaque intervalle conserve son premier et son dernier échantillon, ainsi que les échantillons minimum et maximum à leur position d'origine. La continuité et les pics brefs sont ainsi préservés dans les limites de la résolution d'affichage. Utilisez-la comme guide visuel plutôt que comme outil de mesure exact.

## Spectrogram

Crée des motifs colorés qui montrent comment votre musique change au fil du temps. Les couleurs indiquent l'intensité de chaque son, tandis que la position verticale indique sa fréquence.

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

### Paramètres
- **DB Range** - Intensité des couleurs (-144dB à -48dB)
  - Nombres plus bas : Voir plus de détails subtils
  - Nombres plus hauts : Se concentrer sur les sons principaux
- **Points** - Taille FFT utilisée pour l'affichage (256 à 16384)
  - Nombres plus hauts : plus de détail en fréquence, mais mises à jour temporelles plus lentes
  - Nombres plus bas : mouvement plus rapide, mais moins de détail en fréquence
- L'analyseur utilise la moyenne des canaux gauche et droit. Une entrée mono est analysée directement.

## Spectrum Analyzer

Crée un affichage visuel en temps réel des fréquences de votre musique, des basses profondes aux aigus. C'est comme voir les ingrédients individuels qui composent le son complet de votre musique.

### Guide de Visualisation
- La gauche montre les basses fréquences (batterie, basse)
- Le milieu montre les fréquences principales (voix, guitares, piano)
- La droite montre les hautes fréquences (cymbales, brillance, air)
- La ligne vert foncé montre le son actuel
- La ligne vert clair conserve brièvement les pics récents, ce qui permet de voir les sons forts qui viennent de passer
- Les pics plus hauts indiquent une présence plus forte de ces fréquences
- Observez comment différents instruments créent différents motifs

### Ce Que Vous Pouvez Voir
- Drops de basse : Grands mouvements à gauche
- Mélodies vocales : Activité au milieu
- Aigus cristallins : Étincelles à droite
- Mix complet : Comment toutes les fréquences fonctionnent ensemble

### Paramètres
- **DB Range** - Sensibilité de l'affichage (-144dB à -48dB)
  - Nombres plus bas : Voir plus de détails subtils
  - Nombres plus hauts : Se concentrer sur les sons principaux
- **Points** - Finesse avec laquelle l'affichage sépare les fréquences proches (256 à 16384)
  - Nombres plus hauts : plus de détail en fréquence, avec des mises à jour plus lentes
  - Nombres plus bas : mises à jour plus rapides, avec moins de détail en fréquence
- L'analyseur utilise la moyenne des canaux gauche et droit. Une entrée mono est analysée directement.

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
   - Utilisez le Level Meter pour vérifier les pics du signal après l'ajout d'effets
   - Regardez le Spectrum Analyzer danser avec la musique
   - Créez un spectacle de lumière visuel avec le Spectrogram

## Stereo Meter

Un outil de visualisation fascinant qui vous permet de voir comment votre musique crée une sensation d'espace à travers le son stéréo. Observez comment les différents instruments et sons se déplacent entre vos enceintes ou votre casque, ajoutant une dimension visuelle captivante à votre expérience d'écoute.

### Guide de Visualisation
- **Affichage en diamant** - La fenêtre principale où la musique prend vie :
  - Centre : niveau très faible ou moment où la somme gauche/droite est proche de zéro
  - Haut/Bas : composante commune aux deux canaux, proche du centre ou du mono (L + R)
  - Gauche/Droite : différence entre les canaux ou composante en opposition de phase (R - L)
  - Lorsqu'un seul côté domine, les points peuvent aussi se diriger vers les coins selon la polarité du signal
  - Les points verts dansent avec la musique actuelle
  - La ligne blanche trace les pics musicaux
- **Barre de corrélation LR** (côté gauche)
  - Montre la corrélation entre les canaux gauche et droit
  - Haut (+1.0) : les canaux sont presque identiques, avec un son qui se regroupe facilement au centre
  - Milieu (0.0) : la relation gauche/droite est faible, souvent avec plus d'ambiance ou de largeur
  - Bas (-1.0) : les canaux sont proches de l'opposition de phase et peuvent sembler plus faibles sur enceintes
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
- **Corrélation du son** : Position de la barre gauche

### Paramètres
- **Window** (10-1000 ms)
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
