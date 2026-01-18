---
title: "Delay Plugins - EffeTune"
description: "Delay effect plugins including standard Delay and Time Alignment for precise audio timing."
lang: en
---

# Plugins Delay

Une collection d'outils pour ajuster la synchronisation de vos signaux audio ou ajouter des répétitions distinctes. Ces plugins vous aident à affiner l'alignement temporel de votre audio, à créer des échos rythmiques ou à ajouter une sensation d'espace et de profondeur à votre expérience d'écoute.

## Liste des Plugins

- [Delay](#delay) - Crée des échos avec contrôle sur le timing, la tonalité et la dispersion stéréo.
- [Time Alignment](#time-alignment) - Ajustements précis du timing pour les canaux audio.

## Delay

Cet effet ajoute des échos distincts à votre audio. Vous pouvez contrôler la vitesse à laquelle les échos se répètent, comment ils s'estompent et comment ils se répartissent entre vos haut-parleurs, vous permettant d'ajouter une profondeur subtile, un intérêt rythmique ou des effets spatiaux créatifs à votre lecture musicale.

### Guide d'Expérience d'Écoute

- **Profondeur et Espace Subtils :**
  - Ajoute une douce sensation d'espace sans délaver le son.
  - Peut donner aux voix ou aux instruments principaux une sensation légèrement plus ample ou plus présente.
  - Utilisez des temps de delay courts et un faible feedback/mix.
- **Amélioration Rythmique :**
  - Crée des échos qui se synchronisent avec le tempo de la musique (réglé manuellement).
  - Ajoute du groove et de l'énergie, en particulier à la musique électronique, aux batteries ou aux guitares.
  - Expérimentez avec différents temps de delay (par exemple, en faisant correspondre les croches ou les noires à l'oreille).
- **Écho Slapback :**
  - Un écho très court et unique, souvent utilisé sur les voix ou les guitares dans le rock et la country.
  - Ajoute un effet percussif de doublage.
  - Utilisez des temps de delay très courts (30-120ms), un feedback nul et un mix modéré.
- **Dispersion Stéréo Créative :**
  - En utilisant le contrôle Ping-Pong, les échos peuvent rebondir entre les haut-parleurs gauche et droit.
  - Crée une image stéréo plus large et plus engageante.
  - Peut rendre le son plus dynamique et intéressant.

### Paramètres

- **Pre-Delay (ms)** - Temps avant que le *premier* écho soit entendu (0 à 100 ms).
  - Valeurs basses (0-20ms) : L'écho commence presque immédiatement.
  - Valeurs hautes (20-100ms) : Crée un écart notable avant l'écho, le séparant du son original.
- **Delay Size (ms)** - Le temps entre chaque écho (1 à 5000 ms).
  - Court (1-100ms) : Crée des effets d'épaississement ou de 'slapback'.
  - Moyen (100-600ms) : Effets d'écho standard, bons pour l'amélioration rythmique.
  - Long (600ms+) : Échos distincts et très espacés.
  - *Astuce :* Essayez de taper en rythme avec la musique pour trouver un temps de delay qui semble rythmique.
- **Damping (%)** - Contrôle à quel point les hautes et basses fréquences s'estompent à chaque écho (0 à 100%).
  - 0% : Les échos conservent leur tonalité d'origine (plus brillants).
  - 50% : Un estompage naturel et équilibré.
  - 100% : Les échos deviennent significativement plus sombres et plus fins rapidement (plus étouffés).
  - À utiliser conjointement avec High/Low Damp.
- **High Damp (Hz)** - Définit la fréquence au-dessus de laquelle les échos commencent à perdre de la brillance (1000 à 20000 Hz).
  - Valeurs basses (par ex., 2000Hz) : Les échos s'assombrissent rapidement.
  - Valeurs hautes (par ex., 10000Hz) : Les échos restent brillants plus longtemps.
  - Ajuster avec Damping pour le contrôle tonal des échos.
- **Low Damp (Hz)** - Définit la fréquence en dessous de laquelle les échos commencent à perdre du corps (20 à 1000 Hz).
  - Valeurs basses (par ex., 50Hz) : Les échos conservent plus de basses.
  - Valeurs hautes (par ex., 500Hz) : Les échos deviennent plus fins rapidement.
  - Ajuster avec Damping pour le contrôle tonal des échos.
- **Feedback (%)** - Combien d'échos vous entendez, ou combien de temps ils durent (0 à 99%).
  - 0% : Un seul écho est entendu.
  - 10-40% : Quelques répétitions notables.
  - 40-70% : Traînées d'échos plus longues et qui s'estompent.
  - 70-99% : Traînées très longues, approchant l'auto-oscillation (à utiliser avec précaution !).
- **Ping-Pong (%)** - Contrôle comment les échos rebondissent entre les canaux stéréo (0 à 100%). (Affecte uniquement la lecture stéréo).
  - 0% : Delay standard - l'écho de l'entrée gauche sur la gauche, celui de la droite sur la droite.
  - 50% : Feedback mono - les échos sont centrés entre les haut-parleurs.
  - 100% : Ping-Pong complet - les échos alternent entre les haut-parleurs gauche et droit.
  - Les valeurs intermédiaires créent des degrés variables de dispersion stéréo.
- **Mix (%)** - Équilibre le volume des échos par rapport au son original (0 à 100%).
  - 0% : Aucun effet.
  - 5-15% : Profondeur ou rythme subtil.
  - 15-30% : Échos clairement audibles (bon point de départ).
  - 30%+ : Effet plus fort et plus prononcé. La valeur par défaut est 16%.

### Paramètres Recommandés pour l'Amélioration de l'Écoute

1.  **Profondeur Subtile Voix/Instrument :**
    - Delay Size: 80-150ms
    - Feedback: 0-15%
    - Mix: 8-16%
    - Ping-Pong: 0% (ou essayez 20-40% pour une légère largeur)
    - Damping: 40-60%
2.  **Amélioration Rythmique (Électronique/Pop) :**
    - Delay Size: Essayez de correspondre au tempo à l'oreille (par ex., 120-500ms)
    - Feedback: 20-40%
    - Mix: 15-25%
    - Ping-Pong: 0% ou 100%
    - Damping: Ajustez selon le goût (plus bas pour des répétitions plus brillantes)
3.  **Slapback Rock Classique (Guitares/Voix) :**
    - Delay Size: 50-120ms
    - Feedback: 0%
    - Mix: 15-30%
    - Ping-Pong: 0%
    - Damping: 20-40%
4.  **Échos Stéréo Larges (Ambient/Pads) :**
    - Delay Size: 300-800ms
    - Feedback: 40-60%
    - Mix: 20-35%
    - Ping-Pong: 70-100%
    - Damping: 50-70% (pour des queues plus douces)

### Guide de Démarrage Rapide

1.  **Régler le Timing :**
    - Commencez avec `Delay Size` pour définir le rythme principal de l'écho.
    - Ajustez `Feedback` pour contrôler le nombre d'échos que vous entendez.
    - Utilisez `Pre-Delay` si vous souhaitez un intervalle avant le premier écho.
2.  **Ajuster la Tonalité :**
    - Utilisez `Damping`, `High Damp` et `Low Damp` ensemble pour façonner le son des échos lorsqu'ils s'estompent. Commencez avec Damping autour de 50% et ajustez les fréquences Damp.
3.  **Position en Stéréo (Optionnel) :**
    - Si vous écoutez en stéréo, expérimentez avec `Ping-Pong` pour contrôler la largeur des échos.
4.  **Mélanger :**
    - Utilisez `Mix` pour équilibrer le volume de l'écho avec la musique originale. Commencez bas (environ 16%) et augmentez jusqu'à ce que l'effet semble correct.

---

## Time Alignment

Un outil de précision qui vous permet d'ajuster la synchronisation des canaux audio avec une précision à la milliseconde. Parfait pour corriger les problèmes de phase ou créer des effets stéréo spécifiques.

### Quand Utiliser
- Corriger l'alignement de phase entre les canaux stéréo
- Compenser les différences de distance des haut-parleurs
- Affiner l'image stéréo
- Corriger les désynchronisations dans les enregistrements

### Paramètres
- **Delay** - Contrôle le temps de delay (0 à 100ms)
  - 0ms : Pas de delay (timing original)
  - Valeurs hautes : Augmentation du delay
  - Ajustements fins pour un contrôle précis
- **Channel** - Sélectionne le canal à retarder
  - All : Affecte les deux canaux
  - Left : Retarde uniquement le canal gauche
  - Right : Retarde uniquement le canal droit

### Utilisations Recommandées

1. Alignement des Haut-parleurs
   - Compenser les différentes distances des haut-parleurs
   - Faire correspondre le timing entre les moniteurs
   - Ajuster à l'acoustique de la pièce

2. Correction d'Enregistrement
   - Corriger les problèmes de phase entre les microphones
   - Aligner plusieurs sources audio
   - Corriger les divergences de timing

3. Effets Créatifs
   - Créer un élargissement stéréo subtil
   - Concevoir des effets spatiaux
   - Expérimenter avec le timing des canaux

Rappelez-vous : L'objectif est d'améliorer votre plaisir d'écoute. Expérimentez avec les commandes pour trouver des sons qui ajoutent de l'intérêt et de la profondeur à votre musique préférée sans la surcharger.
