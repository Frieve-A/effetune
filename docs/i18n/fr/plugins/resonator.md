---
title: "Plugins Resonator - EffeTune"
description: "Plugins d'effet de résonateur incluant Horn Resonator et Modal Resonator."
lang: fr
---

# Plugins Resonator

Une collection de plugins qui mettent en valeur les caractéristiques résonantes pour ajouter des textures tonales uniques et de la couleur à votre musique. Ces effets simulent les résonances présentes dans des objets physiques ou des systèmes de haut-parleurs, améliorant votre expérience d'écoute avec chaleur, scintillement ou caractère vintage.

## Liste des plugins

- [Horn Resonator](#horn-resonator) - Simule la résonance des systèmes d'enceintes à pavillon
- [Horn Resonator Plus](#horn-resonator-plus) - Résonance de haut-parleur à pavillon plus douce pour une couleur d'écoute naturelle
- [Modal Resonator](#modal-resonator) - Effet de résonance de fréquence avec jusqu'à 5 résonateurs

## Horn Resonator

Un plugin qui simule la résonance d'un haut-parleur à pavillon (horn-loaded speaker) en utilisant un modèle de guide d'onde numérique. Il ajoute un caractère chaud et naturel de horn speaker en modélisant les réflexions d'onde dans le goulot et à la sortie, vous permettant de façonner le son avec des contrôles simples.

### Guide d'écoute

- Mise en valeur douce des médiums : met en avant les voix et les instruments acoustiques sans agressivité.
- Ambiance horn naturelle : ajoute une coloration vintage de haut-parleurs pour une écoute plus riche.
- Amortissement doux des hautes fréquences : prévient les pics tranchants pour un timbre détendu.

### Paramètres

- **Crossover (Hz)** - Définit la fréquence de coupure entre le chemin basse fréquence (délayé) et le chemin haute fréquence traité par le horn model. (20–5000 Hz)
- **Horn Length (cm)** - Ajuste la longueur du pavillon simulé. Les pavillons plus longs déplacent les résonances vers le bas et les rapprochent ; les plus courts les déplacent vers le haut et les espacent davantage pour un son plus serré. (20–120 cm)
- **Throat Diameter (cm)** - Contrôle la taille de l'ouverture du goulot du pavillon (input). Des valeurs plus petites tendent à augmenter la brillance et l'accentuation des médiums supérieurs, des valeurs plus grandes ajoutent de la chaleur. (0.5–50 cm)
- **Mouth Diameter (cm)** - Contrôle la taille de l'ouverture à la sortie du pavillon (output). Cela affecte l'adaptation d'impédance avec l'air environnant et influence la réflexion dépendante de la fréquence à la sortie. Des valeurs plus grandes élargissent généralement la perception du son et réduisent la réflexion des basses, des valeurs plus petites concentrent le son et augmentent cette réflexion. (5–200 cm)
- **Curve (%)** - Ajuste la forme de la corne (flare) du pavillon (comment le rayon augmente du goulot à la sortie).
    - `0 %` : crée un pavillon conique (rayon augmentant linéairement).
    - Valeurs positives (`> 0 %`) : créent des flares qui s'élargissent plus rapidement vers la sortie (ex. exponentiel). Des valeurs plus élevées signifient une expansion plus lente près du goulot et plus rapide près de la sortie.
    - Valeurs négatives (`< 0 %`) : créent des flares qui s'élargissent très rapidement près du goulot, puis plus lentement vers la sortie (ex. paraboliques ou de type tractrix). Des valeurs plus négatives signifient une expansion initiale plus rapide. (-100–100 %)
- **Damping (dB/m)** - Définit l'atténuation interne (absorption sonore) par mètre dans le guide d'onde du pavillon. Des valeurs plus élevées réduisent les pics de résonance et créent un son plus lisse et amorti. (0–10 dB/m)
- **Throat Reflection** - Ajuste le coefficient de réflexion au niveau du goulot du pavillon (input). Des valeurs plus élevées augmentent la quantité de son renvoyée dans la corne depuis la frontière du goulot, ce qui peut éclaircir la réponse et souligner certaines résonances. (0–0.99)
- **Output Gain (dB)** - Contrôle le niveau de sortie global du chemin du signal traité (haute fréquence) avant de le mélanger avec le chemin basse fréquence retardé. Utilisez-le pour égaliser ou augmenter le niveau de l'effet. (-36–36 dB)

### Démarrage rapide

1.  Définissez **Crossover** pour déterminer la plage de fréquences envoyées au horn model (ex. : 800–2000 Hz). Les fréquences en dessous sont retardées et réinjectées.
2.  Commencez avec un **Horn Length** d'environ 60-70 cm pour un caractère typique des médiums.
3.  Ajustez **Throat Diameter** et **Mouth Diameter** pour façonner le timbre central (brillance vs chaleur, focalisation vs largeur).
4.  Utilisez **Curve** pour affiner le caractère résonant (essayez 0 % pour conique, positif pour exponentiel, négatif pour type tractrix).
5.  Réglez **Damping** et **Throat Reflection** pour adoucir ou accentuer les résonances du pavillon.
6.  Utilisez **Output Gain** pour équilibrer le niveau du son de la corne avec les basses fréquences bypassées.

## Horn Resonator Plus

Horn Resonator Plus ajoute à la musique un caractère de haut-parleur à pavillon plus doux et plus naturel. Utilisez-le lorsque vous voulez que les voix, cuivres, instruments acoustiques ou morceaux complets semblent plus chaleureux et vivants, avec une résonance moins tranchante que le Horn Resonator standard.

Il est basé sur le même modèle de pavillon que [Horn Resonator](#horn-resonator), avec un modèle plus détaillé de réflexion à la bouche et à la gorge pour que les résonances décroissent plus doucement.

### Guide d'écoute

- Couleur de pavillon plus douce : ajoute un caractère de haut-parleur à pavillon avec moins de sonnerie pointue.
- Présence plus chaleureuse : peut rendre les voix, cuivres et musiques acoustiques plus vivants.
- Comportement naturel des hautes fréquences : le haut du spectre se rapproche davantage d'un pavillon acoustique ou d'une enceinte à pavillon que la version standard.

### Améliorations Techniques

- **Filtre de réflexion de bouche de 2ème ordre** : Modélisation plus précise de la réflexion dépendante de la fréquence à l'ouverture de la bouche pour des caractéristiques de résonance plus douces
- **Réflexion de gorge dépendante de la fréquence** : Caractéristiques de réflexion de gorge qui s'adaptent à la fréquence pour un comportement acoustique plus naturel

### Paramètres et Utilisation

Horn Resonator Plus utilise les mêmes paramètres que [Horn Resonator](#horn-resonator). Veuillez vous référer à la section Horn Resonator pour les descriptions des paramètres, réglages et valeurs recommandées.

### Directives d'Utilisation

- **Horn Resonator** : Choisissez quand vous avez besoin d'un traitement léger avec des caractéristiques de pavillon de base
- **Horn Resonator Plus** : Choisissez quand vous voulez une coloration de pavillon plus douce et plus naturelle, et que vous pouvez accepter une utilisation CPU légèrement plus élevée

### Guide de Démarrage Rapide

Utilisez les mêmes contrôles que [Horn Resonator](#horn-resonator). Choisissez Horn Resonator Plus quand vous voulez un caractère de haut-parleur à pavillon plus doux.

## Modal Resonator

Un effet qui ajoute des résonances accordées à votre musique, comme lorsque des objets physiques ou des éléments de haut-parleur résonnent à leurs fréquences naturelles. Utilisez-le lorsque vous voulez ajouter du scintillement, du corps, une couleur métallique ou une résonance de type haut-parleur pendant l'écoute.

### Guide d'expérience d'écoute

- **Résonance métallique :**
  - Crée des tonalités de type cloche ou métalliques suivant la dynamique de la source.
  - Utile pour ajouter de la brillance ou un caractère métallique aux percussions, synthés ou morceaux complets.
  - Utilisez plusieurs résonateurs à des fréquences soigneusement réglées avec des temps de décroissance modérés.
- **Renforcement tonal :**
  - Renforce subtilement des fréquences spécifiques dans la musique.
  - Peut accentuer les harmoniques ou ajouter de la richesse à certaines plages de fréquences.
  - Utilisez une valeur de mix faible (10-20 %) pour un renforcement discret.
- **Simulation d'enceinte large bande :**
  - Simule le comportement modal d'enceintes physiques.
  - Recrée les résonances distinctives qui se produisent lorsque les membranes vibrent à différentes fréquences.
  - Aide à simuler le son caractéristique de types d'enceintes spécifiques.
- **Effets spéciaux :**
  - Produit des qualités timbrales inhabituelles et des textures irréelles.
  - Utile lorsque vous voulez un effet de résonance évident plutôt qu'une amélioration naturelle.
  - Essayez des réglages extrêmes seulement lorsque les résonances doivent devenir une partie du son.

### Paramètres

- **Resonator Selection (1-5)** - Cinq résonateurs indépendants pouvant être activés/désactivés et configurés séparément.
  - Utilisez plusieurs résonateurs pour des effets de résonance complexes et superposés.
  - Chaque résonateur peut cibler différentes régions de fréquence.
  - Essayez des relations harmoniques entre résonateurs pour des résultats plus musicaux.

Pour chaque résonateur :

- **Enable** - Active/désactive le résonateur individuel.
- **Freq (Hz)** - Définit la fréquence de résonance principale (20 à 20 000 Hz).
- **Decay (ms)** - Contrôle la durée de la résonance après la sonorisation d'entrée (1 à 500 ms).
- **LPF Freq (Hz)** - Filtre passe-bas qui façonne le timbre de la résonance (20 à 20 000 Hz).
- **HPF Freq (Hz)** - Filtre passe-haut qui supprime les basses indésirables de la résonance (20 à 20 000 Hz).
- **Gain (dB)** - Contrôle le niveau de sortie individuel de chaque résonateur (-18 à +18 dB).

Contrôle global :

- **Mix (%)** - Équilibre la sortie combinée de tous les résonateurs activés par rapport au son original (0 à 100 %).

### Réglages recommandés pour l'amélioration d'écoute

1. **Amélioration discrète du rendu d'enceinte :**
   - Activez 2-3 résonateurs
   - Fréquences : 400 Hz, 900 Hz, 1600 Hz
   - Decay : 60-100 ms
   - LPF Freq : 2000-4000 Hz
   - Mix : 10-20 %

2. **Caractère métallique :**
   - Activez 3-5 résonateurs
   - Fréquences : échelonnées entre 1000-6500 Hz
   - Decay : 100-200 ms
   - LPF Freq : 4000-8000 Hz
   - Mix : 15-30 %

3. **Renforcement des basses :**
   - Activez 1-2 résonateurs
   - Fréquences : 50-150 Hz
   - HPF Freq : 20-60 Hz, maintenu sous la résonance cible
   - Decay : 50-100 ms
   - LPF Freq : 1000-2000 Hz
   - Mix : 10-25 %

4. **Simulation d'enceinte large bande :**
   - Activez tous les 5 résonateurs
   - Fréquences : 100 Hz, 400 Hz, 800 Hz, 1600 Hz, 3000 Hz
   - HPF Freq : 20 Hz, 120 Hz, 250 Hz, 500 Hz, 1000 Hz
   - Decay : plus court progressivement des basses vers les aigus (100 ms à 30 ms)
   - LPF Freq : plus élevé progressivement des basses vers les aigus (2000 Hz à 4000 Hz)
   - Mix : 20-40 %

### Guide de démarrage rapide

1. **Choisir les points de résonance :**
   - Commencez par activer un ou deux résonateurs.
   - Réglez leurs fréquences pour cibler les zones à améliorer.
   - Pour des effets plus complexes, ajoutez des résonateurs complémentaires.

2. **Ajuster le timbre :**
   - Utilisez le paramètre `Decay` pour contrôler la durée de sustain des résonances.
   - Façonnez le timbre avec le contrôle `LPF Freq`.
   - Réglez `HPF Freq` sous la résonance que vous voulez conserver, surtout pour les réglages de basses.
   - Les temps de decay plus longs créent des tonalités plus prononcées, type cloche.

3. **Mélanger avec le signal original :**
   - Utilisez `Mix` pour équilibrer l'effet avec votre source sonore.
   - Commencez avec des valeurs faibles (10-20 %) pour un effet subtil.
   - Augmentez pour un effet plus marqué.

4. **Affiner :**
   - Apportez de petits ajustements aux fréquences et aux temps de decay.
   - Activez/désactivez des résonateurs individuels pour trouver la combinaison parfaite.
   - Rappelez-vous que de subtils changements peuvent avoir un impact significatif sur le son global.
