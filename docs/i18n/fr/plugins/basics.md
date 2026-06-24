---
title: "Plugins de base - EffeTune"
description: "Plugins audio essentiels, dont Volume, Mute, Stereo Balance, Matrix et plus encore."
lang: fr
---

# Plugins audio de base

Un ensemble d'outils essentiels pour ajuster les aspects fondamentaux de la lecture de votre musique. Ces plugins vous aident à contrôler le volume, l'équilibre et d'autres aspects basiques de votre expérience d'écoute.

## Liste des plugins

* [Channel Divider](#channel-divider) - Divise l'audio stéréo en bandes de fréquences et les répartit vers des paires de sorties stéréo
* [DC Offset](#dc-offset) - Ajoute ou corrige un décalage DC constant
* [Matrix](#matrix) - Dirige et mélange les canaux audio avec un contrôle flexible
* [MultiChannel Panel](#multichannel-panel) - Contrôle plusieurs canaux audio avec des réglages individuels
* [Mute](#mute) - Met le son en sourdine
* [Polarity Inversion](#polarity-inversion) - Inverse la polarité du signal pour correction ou routage spécial
* [Stereo Balance](#stereo-balance) - Ajuste l'équilibre gauche-droite de votre musique
* [Volume](#volume) - Contrôle le volume de la lecture

## Channel Divider

Un outil spécialisé qui sépare votre signal stéréo en bandes de fréquences distinctes et envoie chaque bande vers une paire de sorties stéréo séparée. Il est utile pour les systèmes multicanaux, les configurations multi-amplifiées et les essais de crossover personnalisés.

Pour utiliser cet effet, vous devez passer par l'application de bureau, définir le nombre de canaux de sortie dans les paramètres audio à 4, 6 ou 8 selon le nombre de bandes, et régler le canal dans le routage du bus d'effet sur "All".

### Quand l'utiliser

* Lors de l'utilisation de sorties audio multicanaux (4, 6 ou 8 canaux)
* Pour créer un routage de canaux personnalisé basé sur la fréquence
* Pour des configurations multi-amplificateurs ou multi-haut-parleurs

### Paramètres

* **Band Count** - Nombre de bandes de fréquences à créer (2 à 4 bandes)

  * 2 bandes : séparation Low/High, nécessite 4 canaux de sortie
  * 3 bandes : séparation Low/Mid/High, nécessite 6 canaux de sortie
  * 4 bandes : séparation Low/Mid-Low/Mid-High/High, nécessite 8 canaux de sortie
  * Si le nombre de canaux de sortie est insuffisant, les nombres de bandes supérieurs ne sont pas disponibles

* **Crossover Frequencies** - Définit où l'audio est divisé entre les bandes

  * F1 : premier point de crossover
  * F2 : deuxième point de crossover (pour 3 bandes ou plus)
  * F3 : troisième point de crossover (pour 4 bandes)
  * Chaque fréquence peut être réglée de 10 Hz à 40000 Hz
  * Le plugin maintient F1, F2 et F3 dans l'ordre croissant avec au moins 1 Hz d'écart

* **Slopes** - Contrôle la netteté de la séparation des bandes

  * Options : -12 dB à -96 dB par octave
  * Des pentes plus raides offrent une séparation plus nette
  * Des pentes plus faibles offrent des transitions plus naturelles

### Notes techniques

* Ne traite que les deux premiers canaux d'entrée
* Les canaux de sortie doivent être multiples de 2 (4, 6 ou 8)
* Chaque bande conserve la paire stéréo d'origine : en mode 2 bandes, Low sort sur les canaux 1-2 et High sur 3-4 ; en mode 3 bandes, Low/Mid/High utilisent 1-2, 3-4 et 5-6 ; en mode 4 bandes, Low/Mid-Low/Mid-High/High utilisent 1-2, 3-4, 5-6 et 7-8
* Utilise des filtres crossover Linkwitz-Riley de haute qualité
* Graphique de réponse en fréquence pour une configuration facilitée

## DC Offset

Un utilitaire pour corriger un signal dont la forme d'onde est décalée par rapport à la ligne zéro. La plupart des auditeurs devraient le laisser à 0.0, mais il peut aider avec des fichiers ou chaînes de traitement inhabituels contenant un décalage DC.

### Quand l'utiliser

* Quand l'audio contient un biais DC constant ou provoque des clics/problèmes de marge après d'autres traitements
* Quand un outil de diagnostic ou un analyseur montre que la forme d'onde est décalée par rapport à zéro
* Laissez-le à 0.0 pour l'écoute normale

### Paramètres

* **Offset** - Ajoute une valeur constante à chaque échantillon (-1.0 à +1.0)

  * 0.0 : aucun décalage
  * Les valeurs positives déplacent le signal vers le haut
  * Les valeurs négatives déplacent le signal vers le bas
  * Utilisez de très petits ajustements lorsqu'une correction est nécessaire

## Matrix

Un outil de routage de canaux pour corriger des dispositions inhabituelles d'enceintes ou de casques, échanger des canaux, combiner des canaux ou envoyer un canal vers plusieurs sorties disponibles.

### Quand l'utiliser

* Lorsque la lecture gauche/droite ou multicanal sort des mauvaises enceintes
* Pour mélanger la stéréo en mono ou dupliquer un canal vers une autre sortie disponible
* Pour corriger un routage spécial dans une installation d'écoute multicanal

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
* Lorsque plusieurs entrées sont envoyées vers la même sortie, leurs niveaux s'additionnent ; il peut être nécessaire de baisser le volume
* Matrix ne crée pas de canaux de sortie supplémentaires à elle seule : elle route l'audio dans les canaux actuellement disponibles

### Applications pratiques

* Downmix personnalisé, échange de canaux ou routage dans les canaux disponibles
* Correction de canaux gauche/droite inversés
* Combinaison de canaux pour une écoute mono
* Envoi d'un même canal vers plusieurs sorties disponibles

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
* Ajustement du timing quand les enceintes sont à des distances différentes
* Coupure ou mise en solo temporaire d'enceintes individuelles pendant la configuration
* Liaison de paires stéréo ou de groupes d'enceintes pour les régler plus facilement

## Mute

Un utilitaire simple qui coupe tout le son en remplissant le tampon de zéros. Utile pour couper instantanément les signaux audio.

### Quand l'utiliser

* Pour couper instantanément le son sans fondu
* Pendant les sections silencieuses ou les pauses
* Pour éviter la sortie de bruits indésirables

## Polarity Inversion

Un utilitaire qui inverse la polarité du signal audio. Inverser tous les canaux ne change généralement presque rien à l'écoute, mais cela peut aider lorsqu'une enceinte, un câble ou un canal semble câblé avec une polarité opposée.

Pour corriger un décalage de polarité gauche/droite ou multicanal suspecté, limitez les canaux traités dans les paramètres communs de routage de l'effet et inversez uniquement le canal concerné.

### Quand l'utiliser

* Quand l'image centrale semble faible, creuse ou trop étalée parce qu'un canal pourrait avoir une polarité opposée
* Pour vérifier ou corriger la polarité d'une enceinte, d'un câble ou d'un canal dans une installation d'écoute
* En combinaison avec des réglages de routage ou des effets stéréo qui nécessitent l'inversion d'un seul canal

## Stereo Balance

Vous permet d'ajuster la distribution de la musique entre vos enceintes ou écouteurs gauche et droit. Idéal pour corriger une stéréo déséquilibrée ou créer votre placement sonore préféré.

### Guide d'amélioration de l'écoute

* Équilibre parfait :

  * Position centrale pour une stéréo naturelle
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
