---
title: "Autres Plugins - EffeTune"
description: "Plugins utilitaires supplémentaires incluant Oscillator pour générer des signaux audio."
lang: fr
---

# Autres Outils Audio

Une collection d'outils audio spécialisés et de générateurs qui complètent les catégories d'effets principales. Ces plugins sont utiles pour vérifier les haut-parleurs, casques, équilibre des canaux et comportement de lecture avant ou pendant l'écoute.

## Liste des Plugins

- [Oscillator](#oscillator) - Générateur de sons et bruits de test pour vérifier haut-parleurs/casques

## Oscillator

Un générateur de sons et bruits de test pour vérifier votre système d'écoute. Utilisez-le à bas niveau pour confirmer la sortie des haut-parleurs/casques, le placement gauche/droite, l'équilibre de niveau, les vibrations, bourdonnements ou problèmes simples de réponse en fréquence.

Le son ou bruit généré est mélangé dans le chemin audio courant au lieu de remplacer l'entrée. Baissez Volume avant de l'activer, surtout si de la musique est déjà en cours de lecture.

### Caractéristiques
- Plusieurs types de formes d'onde :
  - Onde sinusoïdale pure pour les tons de référence
  - Onde carrée pour un contenu harmonique riche
  - Onde triangulaire pour des harmoniques plus douces
  - Onde en dents de scie pour des timbres brillants
  - Bruit blanc pour les tests système
  - Bruit rose pour les mesures acoustiques
- Mode d'opération pulsé pour des tons ou rafales de bruit intermittents

### Paramètres
- **Frequency (Hz)** - Contrôle la hauteur du ton généré (20 Hz à 96 kHz)
  - Basses fréquences : Tons graves profonds
  - Fréquences moyennes : Gamme musicale
  - Hautes fréquences : À utiliser prudemment et seulement à des niveaux d'écoute sûrs
  - S'applique seulement à Sine, Square, Triangle et Sawtooth ; désactivé pour White Noise et Pink Noise
  - La sortie disponible dans les hautes fréquences dépend de la fréquence d'échantillonnage audio courante ; les tons au-dessus de la fréquence de Nyquist utilisable sont coupés
- **Volume (dB)** - Ajuste le niveau de sortie (-96 dB à 0 dB)
  - Commencez bas et montez lentement
  - Les valeurs plus hautes peuvent être fortes ou fatigantes
- **Panning (L/R)** - Contrôle le placement stéréo
  - Centre : Égal dans les deux canaux
  - Gauche/Droite : Vérification du routage et de l'équilibre des canaux
- **Waveform Type** - Sélectionne le type de signal
  - Sine : Ton de référence propre
  - Square : Riche en harmoniques impaires
  - Triangle : Contenu harmonique plus doux
  - Sawtooth : Série harmonique complète
  - White Noise : Énergie égale par Hz ; Frequency ne l'affecte pas
  - Pink Noise : Énergie égale par octave ; Frequency ne l'affecte pas
- **Mode** - Contrôle le motif de génération du signal
  - Continuous : Génération de signal continue et ininterrompue
  - Pulsed : Signal intermittent avec timing contrôlable
- **Interval (ms)** - Temps entre les rafales de pulses en mode pulsé (100-2000 ms, pas de 10 ms)
  - Intervalles courts : Séquences de pulses rapides
  - Intervalles longs : Pulses largement espacés
  - Actif seulement quand le Mode est réglé sur Pulsed
- **Width (ms)** - Temps de rampe des pulses en mode pulsé (2-100 ms, limité à la moitié de Interval, pas de 1 ms)
  - Contrôle le temps de fondu entrant/sortant de chaque pulse
  - Le pulse généré dure environ deux fois Width, sans section maintenue à niveau constant
  - Largeurs courtes : Bords de pulse nets
  - Largeurs longues : Transitions de pulse plus douces
  - Actif seulement quand le Mode est réglé sur Pulsed

### Exemples d'Utilisation

1. Vérification des Haut-parleurs ou Casques
   - Vérifier la reproduction de fréquence de base
     * Utilisez un balayage sinusoïdal des basses aux hautes fréquences
     * Notez où le son devient inaudible ou distordu
   - Écouter les vibrations, bourdonnements ou résonances dures
     * Utilisez d'abord un Volume bas
     * Testez une plage de fréquences à la fois
   - Comparer la sortie gauche et droite
     * Pannez complètement à gauche puis à droite
     * Confirmez que chaque côté sort du haut-parleur ou transducteur attendu

2. Équilibre des Canaux et des Niveaux
   - Vérifier le placement stéréo
     * Utilisez une onde sinusoïdale centrée ou du bruit rose
     * Confirmez que le son apparaît au centre
   - Comparer le volume gauche/droite
     * Pannez de chaque côté avec le même Volume
     * Ajustez votre système de lecture si un côté semble plus fort
   - Vérifier les chaînes de plugins
     * Placez Oscillator avant ou après d'autres effets pour entendre comment la chaîne traite un signal simple

3. Vérifications de Résonance de Pièce ou de Bureau
   - Repérer les accumulations de grave ou vibrations évidentes
     * Utilisez des tons sinusoïdaux graves à niveau sûr
     * Déplacez-vous autour de la position d'écoute et notez les pics ou creux marqués
   - Vérifier les objets sujets aux vibrations
     * Balayez lentement les basses et bas-médiums
     * Réduisez immédiatement Volume si quelque chose vibre fortement

4. Vérifications d'Équilibre au Bruit
   - Utilisez Pink Noise comme référence large et stable
     * Écoutez les déséquilibres gauche/droite ou tonalité évidents
     * Gardez un niveau confortable et évitez les lectures longues à volume élevé
   - Utilisez White Noise seulement lorsqu'un signal large bande plus brillant est nécessaire

5. Vérifications par Signal Pulsé
   - Utilisez le mode Pulsed pour rendre les courtes rafales plus faciles à identifier
     * Des intervalles plus longs rendent chaque rafale plus distincte
     * Des valeurs Width plus courtes créent des débuts et fins plus nets
     * Comparez le comportement à différents volumes

N'oubliez pas : Oscillator est un générateur de signal de test. Commencez avec un Volume bas, augmentez progressivement et évitez les tons forts ou très aigus pouvant endommager l'équipement ou fatiguer l'audition.
