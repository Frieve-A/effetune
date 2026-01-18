---
title: "Basic Plugins - EffeTune"
description: "Essential audio plugins including Volume, Mute, Stereo Balance, Matrix routing, and more."
lang: en
---

# Basic Audio Plugins

Un ensemble d'outils essentiels pour ajuster les aspects fondamentaux de la lecture de votre musique. Ces plugins vous aident à contrôler le volume, l'équilibre et d'autres aspects basiques de votre expérience d'écoute.

## Liste des plugins

* [Channel Divider](#channel-divider) - Divise l'audio en bandes de fréquences réparties sur plusieurs canaux
* [DC Offset](#dc-offset) - Permet de corriger l'audio qui semble déséquilibré
* [Matrix](#matrix) - Dirige et mélange les canaux audio avec un contrôle flexible
* [MultiChannel Panel](#multichannel-panel) - Contrôle plusieurs canaux audio avec des réglages individuels
* [Mute](#mute) - Met le son en sourdine
* [Polarity Inversion](#polarity-inversion) - Peut améliorer le rendu de la musique stéréo
* [Stereo Balance](#stereo-balance) - Ajuste l'équilibre gauche-droite de votre musique
* [Volume](#volume) - Contrôle le volume de la lecture

## Channel Divider

Un outil spécialisé qui sépare votre signal stéréo en bandes de fréquences distinctes et envoie chaque bande vers différents canaux de sortie. Idéal pour les systèmes multicanaux et les configurations de crossovers personnalisés.

Pour utiliser cet effet, vous devez passer par l'application de bureau, définir le nombre de canaux de sortie dans les paramètres audio à 4 ou plus, et régler le canal dans le routage du bus d'effet sur "All".

### Quand l'utiliser

* Lors de l'utilisation de sorties audio multicanaux (4, 6 ou 8 canaux)
* Pour créer un routage de canaux personnalisé basé sur la fréquence
* Pour des configurations multi-amplificateurs ou multi-haut-parleurs

### Paramètres

* **Band Count** - Nombre de bandes de fréquences à créer (2 à 4 bandes)

  * 2 bandes : séparation Low/High
  * 3 bandes : séparation Low/Mid/High
  * 4 bandes : séparation Low/Mid-Low/Mid-High/High

* **Crossover Frequencies** - Définit où l'audio est divisé entre les bandes

  * F1 : premier point de crossover
  * F2 : deuxième point de crossover (pour 3 bandes ou plus)
  * F3 : troisième point de crossover (pour 4 bandes)

* **Slopes** - Contrôle la netteté de la séparation des bandes

  * Options : -12 dB à -96 dB par octave
  * Des pentes plus raides offrent une séparation plus nette
  * Des pentes plus faibles offrent des transitions plus naturelles

### Notes techniques

* Ne traite que les deux premiers canaux d'entrée
* Les canaux de sortie doivent être multiples de 2 (4, 6 ou 8)
* Utilise des filtres crossover Linkwitz-Riley de haute qualité
* Graphique de réponse en fréquence pour une configuration facilitée

## DC Offset

Un utilitaire qui peut aider à corriger un son déséquilibré ou étrange. La plupart des auditeurs n'en auront pas souvent besoin, mais c'est utile lorsque l'audio ne semble pas tout à fait correct.

### Quand l'utiliser

* Si la musique semble anormalement déséquilibrée
* Lorsque l'un des canaux semble plus fort qu'il ne devrait
* Si d'autres effets ne fonctionnent pas comme prévu

### Paramètres

* **Offset** - Ajuste l'équilibre audio (-1.0 à +1.0)

  * 0.0 : réglage normal
  * Ajustez si quelque chose semble incorrect
  * De petits ajustements sont généralement les plus efficaces

## Matrix

Un outil puissant de routage de canaux qui vous permet de créer des chemins de signal personnalisés entre les canaux d'entrée et de sortie. Offre une flexibilité totale dans la connexion et le mixage des signaux audio.

### Quand l'utiliser

* Pour créer un routage personnalisé entre les canaux
* Lorsque vous devez mixer ou séparer les signaux de manières spécifiques
* Pour la conception sonore créative via les interactions de canaux

### Fonctionnalités

* Matrice de routage flexible jusqu'à 8 canaux
* Contrôle individuel des connexions entre chaque paire entrée/sortie
* Options d'inversion de phase pour chaque connexion
* Interface matricielle visuelle pour une configuration intuitive

### Fonctionnement

* Chaque point de connexion représente un routage d'une ligne d'entrée à une colonne de sortie
* Les connexions actives permettent au signal de circuler entre les canaux
* L'option d'inversion de phase inverse la polarité du signal
* Plusieurs connexions d'entrée vers une même sortie sont mixées ensemble

### Applications pratiques

* Configurations personnalisées de downmix ou upmix
* Isolation ou combinaison de canaux spécifiques
* Création de relations de phase entre les canaux
* Résolution de besoins de routage complexes

## MultiChannel Panel

Un panneau de contrôle complet pour gérer individuellement plusieurs canaux audio. Ce plugin offre un contrôle total sur le volume, la mise en sourdine, le solo et le délai pour jusqu'à 8 canaux, avec un indicateur de niveau visuel pour chaque canal.

### Quand l'utiliser

* Lors du travail avec de l'audio multicanal (jusqu'à 8 canaux)
* Pour créer un équilibre de volume personnalisé entre différents canaux
* Lorsque vous devez appliquer un délai individuel à des canaux spécifiques
* Pour surveiller les niveaux sur plusieurs canaux simultanément

### Fonctionnalités

* Contrôles individuels pour jusqu'à 8 canaux audio
* Indicateurs de niveau en temps réel avec maintien des crêtes pour une surveillance visuelle
* Capacité de liaison des canaux pour des changements de paramètres groupés

### Paramètres

#### Contrôles par canal

* **Mute (M)** - Met en sourdine les canaux individuels
  * Activation/désactivation pour chaque canal
  * Fonctionne conjointement avec la fonction solo

* **Solo (S)** - Isole les canaux individuels
  * Lorsqu'un canal est en solo, seuls les canaux en solo sont audibles
  * Plusieurs canaux peuvent être mis en solo simultanément

* **Volume** - Ajuste la sonorité des canaux individuels (-20dB à +10dB)
  * Contrôle précis via curseur ou saisie directe de valeur
  * Les canaux liés maintiennent le même volume

* **Delay** - Ajoute un délai temporel aux canaux individuels (0-30ms)
  * Contrôle précis du délai en millisecondes
  * Utile pour l'alignement temporel entre les canaux
  * Permet l'ajustement de phase entre les canaux

#### Liaison des canaux

* **Link** - Connecte les canaux adjacents pour un contrôle synchronisé
  * Les modifications sur un canal lié affectent tous les canaux connectés
  * Maintient des réglages cohérents entre les groupes de canaux liés
  * Utile pour les paires stéréo ou les groupes multicanaux

### Surveillance visuelle

* Les indicateurs de niveau en temps réel affichent l'intensité actuelle du signal
* Les indicateurs de maintien des crêtes affichent les niveaux maximaux
* Affichage numérique clair des niveaux de crête en dB
* Indicateurs à code couleur pour une reconnaissance facile des niveaux :
  * Vert : niveaux sécuritaires
  * Jaune : approche du maximum
  * Rouge : proche ou au niveau maximum

### Applications pratiques

* Équilibrage des systèmes de son surround
* Création de mixages personnalisés pour casque
* Alignement temporel des configurations multi-microphones
* Surveillance et ajustement des sources audio multicanaux

## Mute

Un utilitaire simple qui coupe tout le son en remplissant le tampon de zéros. Utile pour couper instantanément les signaux audio.

### Quand l'utiliser

* Pour couper instantanément le son sans fondu
* Pendant les sections silencieuses ou les pauses
* Pour éviter la sortie de bruits indésirables

## Polarity Inversion

Un outil qui peut améliorer le rendu de la musique stéréo dans certaines situations. C'est comme "flipping" l'onde audio pour l'améliorer potentiellement.

Vous pouvez également inverser la polarité uniquement de canaux spécifiques en limitant les canaux à traiter dans les paramètres communs de l'effet.

### Quand l'utiliser

* Lorsque la musique stéréo semble "vide" ou "bizarre"
* Si vous combinez ceci avec d'autres effets stéréo
* Lorsque vous cherchez à améliorer l'image stéréo

## Stereo Balance

Vous permet d'ajuster la distribution de la musique entre vos enceintes ou écouteurs gauche et droit. Idéal pour corriger une stéréo déséquilibrée ou créer votre placement sonore préféré.

### Guide d'amélioration de l'écoute

* Équilibre parfait :

  * Center position for natural stereo
  * Volume égal dans les deux oreilles
  * Idéal pour la plupart des musiques
* Équilibre ajusté :

  * Compense l'acoustique de la pièce
  * Ajuste selon les différences d'audition
  * Crée une scène sonore préférée

### Paramètres

* **Balance** - Contrôle la distribution gauche-droite (-100% à +100%)

  * Center (0 %) : égalité des deux côtés
  * Left (-100 %) : plus de son à gauche
  * Right (+100 %) : plus de son à droite

### Affichage visuel

* Curseur facile à utiliser
* Affichage numérique clair
* Indicateur visuel de la position stéréo

### Utilisations recommandées

1. Écoute générale

   * Gardez l'équilibre centré (0 %)
   * Ajustez si la stéréo semble déséquilibrée
   * Utilisez des ajustements subtils

2. Écoute au casque

   * Ajustez finement pour le confort
   * Compensez les différences d'audition
   * Créez votre image stéréo préférée

3. Écoute sur enceintes

   * Ajustez selon la configuration de la pièce
   * Équilibrez selon la position d'écoute
   * Compensez l'acoustique de la pièce

## Volume

Un contrôle simple mais essentiel qui vous permet d'ajuster le volume de votre musique. Idéal pour trouver le bon niveau pour différentes situations.

### Guide d'amélioration de l'écoute

* Ajustez selon différents scénarios d'écoute :

  * Musique de fond pendant le travail
  * Sessions d'écoute active
  * Écoute calme tard le soir
* Maintenez le volume à un niveau confortable pour éviter :

  * Fatigue auditive
  * Distorsion du son
  * Risque de dommages auditifs

### Paramètres

* **Volume** - Contrôle le niveau sonore global (-60 dB à +24 dB)

  * Valeurs plus basses : lecture plus silencieuse
  * Valeurs plus élevées : lecture plus forte
  * 0 dB : niveau de volume d'origine

Rappel : ces contrôles de base sont la base d'un bon son. Commencez par ces réglages avant d'utiliser des effets plus complexes !
