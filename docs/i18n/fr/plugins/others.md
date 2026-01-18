---
title: "Other Plugins - EffeTune"
description: "Additional utility plugins including Oscillator for audio signal generation."
lang: en
---

# Other Audio Tools

Une collection d'outils audio spécialisés et de générateurs qui complètent les catégories d'effets principales. Ces plugins offrent des capacités uniques pour la génération de son et l'expérimentation audio.

## Plugin List

- [Oscillator](#oscillator) - Générateur de signal audio multi-forme d'onde avec contrôle précis de la fréquence

## Oscillator

Un générateur de signal audio polyvalent qui produit diverses formes d'onde avec un contrôle précis de la fréquence. Parfait pour tester les systèmes audio, créer des tons de référence ou expérimenter avec la synthèse sonore.

### Caractéristiques
- Plusieurs types de formes d'onde :
  - Onde sinusoïdale pure pour les tons de référence
  - Onde carrée pour un contenu harmonique riche
  - Onde triangulaire pour des harmoniques plus douces
  - Onde en dents de scie pour des timbres brillants
  - Bruit blanc pour les tests système
  - Bruit rose pour les mesures acoustiques
- Mode d'opération pulsé pour les tests en rafales et les signaux intermittents

### Parameters
- **Frequency (Hz)** - Contrôle la hauteur du ton généré (20 Hz à 96 kHz)
  - Basses fréquences : Tons graves profonds
  - Fréquences moyennes : Gamme musicale
  - Hautes fréquences : Test système
- **Volume (dB)** - Ajuste le niveau de sortie (-96 dB à 0 dB)
  - Utilisez des valeurs plus basses pour les tons de référence
  - Valeurs plus hautes pour les tests système
- **Panning (L/R)** - Contrôle le placement stéréo
  - Centre : Égal dans les deux canaux
  - Gauche/Droite : Test d'équilibre des canaux
- **Waveform Type** - Sélectionne le type de signal
  - Sine : Ton de référence pur
  - Square : Riche en harmoniques impaires
  - Triangle : Contenu harmonique plus doux
  - Sawtooth : Série harmonique complète
  - White Noise : Énergie égale par Hz
  - Pink Noise : Énergie égale par octave
- **Mode** - Contrôle le motif de génération du signal
  - Continuous : Génération de signal continu standard
  - Pulsed : Signal intermittent avec timing contrôlable
- **Interval (ms)** - Temps entre les rafales de pulses en mode pulsé (100-2000 ms, pas de 10 ms)
  - Intervalles courts : Séquences de pulses rapides
  - Intervalles longs : Pulses largement espacés
  - Actif seulement quand le Mode est réglé sur Pulsed
- **Width (ms)** - Durée du temps de rampe des pulses en mode pulsé (2-100 ms, pas de 1 ms)
  - Contrôle le temps de fondu entrant/sortant de chaque pulse
  - Largeurs courtes : Bords de pulse nets
  - Largeurs longues : Transitions de pulse plus douces
  - Actif seulement quand le Mode est réglé sur Pulsed

### Exemples d'Utilisation

1. Test de Haut-parleurs
   - Vérifier la plage de reproduction des fréquences
     * Utilisez un balayage sinusoïdal des basses aux hautes fréquences
     * Notez où le son devient inaudible ou distordu
   - Tester les caractéristiques de distorsion
     * Utilisez des ondes sinusoïdales pures à différentes fréquences
     * Écoutez les harmoniques ou distorsions indésirables
     * Comparez le comportement à différents niveaux de volume
   - Test de signal en rafale
     * Utilisez le mode pulsé avec des intervalles et largeurs courts
     * Analysez la réponse du système aux signaux intermittents

2. Analyse Acoustique de la Pièce
   - Identifier les ondes stationnaires
     * Utilisez des ondes sinusoïdales aux fréquences suspectées des modes de pièce
     * Déplacez-vous dans la pièce pour trouver les nœuds et antinœuds
   - Vérifier la résonance et la réverbération
     * Testez différentes fréquences pour trouver les résonances problématiques
     * Utilisez du bruit rose pour évaluer la réponse globale de la pièce
   - Cartographier la réponse en fréquence à différentes positions
     * Utilisez des balayages sinusoïdaux pour vérifier la cohérence dans la zone d'écoute
   - Analyse d'écho et de réflexion
     * Utilisez le mode pulsé pour séparer clairement les sons directs et réfléchis

3. Test de Casques/Écouteurs
   - Évaluer la diaphonie entre les canaux
     * Envoyez le signal à un seul canal
     * Vérifiez les fuites indésirables dans l'autre canal
   - Tester la réponse en fréquence
     * Utilisez des balayages sinusoïdaux pour vérifier l'équilibre des fréquences
     * Comparez les réponses des canaux gauche et droit
   - Test de réponse transitoire
     * Utilisez le mode pulsé pour évaluer le comportement du système avec des signaux en rafale

4. Tests Auditifs
   - Vérifier la plage auditive personnelle
     * Balayez les fréquences pour trouver les limites supérieures et inférieures
     * Notez les lacunes ou faiblesses en fréquence
   - Déterminer le volume minimum audible
     * Testez différentes fréquences à des volumes variables
     * Cartographiez vos courbes d'isosonie personnelles
   - Évaluation du traitement temporel
     * Utilisez le mode pulsé avec des intervalles variables pour tester la résolution temporelle

5. Calibration Système
   - Adaptation des niveaux entre composants
     * Utilisez des ondes sinusoïdales aux fréquences de référence
     * Assurez des niveaux cohérents dans la chaîne de signal
   - Vérification de l'équilibre des canaux
     * Testez l'équilibre gauche/droite à différentes fréquences
     * Assurez une image stéréo appropriée
   - Test de réponse de signal en rafale
     * Utilisez le mode pulsé pour tester la réponse du système aux signaux intermittents
     * Évaluez le comportement des portes/compresseurs avec des signaux en rafale

N'oubliez pas : L'Oscillator est un outil de précision - commencez avec des volumes bas et augmentez progressivement pour éviter d'endommager l'équipement ou la fatigue auditive.