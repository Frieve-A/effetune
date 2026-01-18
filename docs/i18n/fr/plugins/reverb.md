---
title: "Reverb Plugins - EffeTune"
description: "Reverb effect plugins including RS Reverb, Dattorro Plate Reverb, and FDN Reverb."
lang: en
---

# Reverb Plugins

Une collection de plugins qui ajoutent de l'espace et de l'atmosphère à votre musique. Ces effets peuvent faire sonner votre musique comme si elle était jouée dans différents environnements, des pièces intimes aux grandes salles de concert, améliorant votre expérience d'écoute avec une ambiance et une profondeur naturelles.

## Plugin List

- [Dattorro Plate Reverb](#dattorro-plate-reverb) - Reverb à plaque classique basé sur l'algorithme Dattorro
- [FDN Reverb](#fdn-reverb) - Reverb à réseau de délais à rétroaction avec matrice de diffusion avancée
- [RS Reverb](#rs-reverb) - Crée une ambiance et un espace naturels

## Dattorro Plate Reverb

Une implémentation classique de reverb à plaque basée sur le célèbre algorithme de Jon Dattorro de l'article de 1997 "Effect Design, Part 1: Reverberator and Other Filters." Cet algorithme est célébré pour sa qualité sonore riche et douce et est devenu une référence dans la conception de reverb numérique. Parfait pour ajouter une ambiance riche et scintillante à votre musique.

### Guide d'Expérience d'Écoute
- Son de Plaque Luxuriant :
  - Caractère classique de reverb de plaque de studio
  - Queue de reverb douce et dense sans artefacts métalliques
  - Beau scintillement et chaleur caractéristiques des reverbs à plaque
- Ambiance Polyvalente :
  - De l'amélioration subtile de pièce aux grandes salles expansives
  - Fonctionne magnifiquement avec tout genre musical
  - Ajoute une finition professionnelle aux enregistrements
- Mouvement Naturel :
  - La modulation ajoute une vie organique à la reverb
  - Empêche les queues statiques et artificielles
  - Crée un espace vivant et respirant autour de votre musique

### Parameters
- **Pre Delay** - Silence initial avant le début de la reverb (0.0 à 100.0 ms)
  - 0-10ms : Reverb immédiate, sensation intime
  - 10-30ms : Sensation naturelle d'espace
  - 30-100ms : Crée l'impression d'espaces plus grands
- **Bandwidth** - Filtrage du signal d'entrée (0.0 à 1.0)
  - Valeurs plus basses : Ton d'entrée plus sombre et chaud
  - Valeurs plus hautes (près de 1.0) : Entrée plus brillante, pleine fréquence
  - Par défaut 0.9995 : Optimal selon la suggestion de Dattorro
- **Input Diff 1** - Première étape de diffusion d'entrée (0.0 à 1.0)
  - Contrôle l'étalement initial du signal d'entrée
  - Par défaut 0.75 : Valeur recommandée de l'article de Dattorro
  - Valeurs plus hautes : Réflexions précoces plus diffuses et douces
- **Input Diff 2** - Deuxième étape de diffusion d'entrée (0.0 à 1.0)
  - Étale davantage le signal d'entrée
  - Par défaut 0.625 : Valeur recommandée de l'article de Dattorro
  - Travaille avec Input Diff 1 pour créer une diffusion complexe
- **Decay** - Durée de la queue de reverb (0.0 à 1.0)
  - Bas (0.1-0.3) : Décroissance courte et contrôlée
  - Moyen (0.4-0.6) : Décroissance naturelle type pièce
  - Haut (0.7-1.0) : Queues longues et expansives
- **Decay Diff 1** - Diffusion de décroissance dans le réservoir (0.0 à 1.0)
  - Contrôle la densité pendant la phase de décroissance
  - Par défaut 0.70 : Valeur recommandée de l'article de Dattorro
  - Affecte la douceur de la queue de reverb
- **Damping** - Absorption des hautes fréquences dans le temps (0.0 à 1.0)
  - 0.0 : Pas d'amortissement, reverb brillante partout
  - 0.0005 (par défaut) : Amortissement très subtil et naturel
  - Valeurs plus hautes : Décroissance plus sombre et chaude
- **Mod Depth** - Quantité de modulation de délai (0.0 à 16.0 échantillons)
  - 0.0 : Pas de modulation, reverb statique
  - 1.0-4.0 : Mouvement subtil, ajoute de la vie
  - 8.0-16.0 : Effet type chorus plus notable
- **Mod Rate** - Vitesse de modulation (0.0 à 10.0 Hz)
  - 0.5-1.5Hz : Mouvement lent et doux
  - 2.0-4.0Hz : Modulation plus active
  - Valeurs plus hautes : Effet rapide et scintillant
- **Wet Mix** - Quantité de reverb ajoutée (0 à 100%)
  - 10-30% : Amélioration subtile
  - 30-50% : Présence notable
  - 50-100% : Effet de reverb dominant
- **Dry Mix** - Quantité de signal original (0 à 100%)
  - Habituellement maintenu à 100% pour l'écoute normale
  - Réduire pour effets spéciaux ou nappes ambiantes

### Réglages Recommandés pour Différents Styles Musicaux

1. Piano Classique
   - Decay : 0.6-0.7
   - Damping : 0.001
   - Mod Depth : 1.0
   - Wet Mix : 25-35%
   - Parfait pour : Piano solo, musique de chambre

2. Voix et Acoustique
   - Decay : 0.4-0.5
   - Damping : 0.002
   - Pre Delay : 15-25ms
   - Wet Mix : 20-30%
   - Parfait pour : Voix, guitare acoustique

3. Ambient et Atmosphérique
   - Decay : 0.8-0.95
   - Mod Depth : 4.0-8.0
   - Mod Rate : 0.5-1.0Hz
   - Wet Mix : 50-70%
   - Parfait pour : Ambient, électronique, paysages sonores

4. Amélioration Générale
   - Decay : 0.5
   - Damping : 0.0005
   - Mod Depth : 1.0
   - Wet Mix : 20-30%
   - Parfait pour : Utilisation polyvalente, finition subtile

### Guide de Démarrage Rapide

1. Définir le Caractère de Base
   - Commencez avec Decay pour contrôler la longueur de la reverb
   - Ajustez Pre Delay pour la distance perçue
   - Réglez Wet Mix pour la présence de reverb désirée

2. Façonner le Timbre
   - Utilisez Bandwidth pour contrôler la brillance d'entrée
   - Ajustez Damping pour la décroissance des hautes fréquences
   - Affinez les paramètres de diffusion pour la densité

3. Ajouter du Mouvement
   - Réglez Mod Depth pour une variation subtile (essayez 1.0)
   - Ajustez Mod Rate pour la vitesse (essayez 1.0Hz)
   - Ces paramètres ajoutent de la vie à la reverb

4. Équilibre Final
   - Ajustez le mélange Wet/Dry selon vos goûts
   - Faites confiance à vos oreilles pour les réglages finaux
   - Les valeurs par défaut sont un excellent point de départ

Le Dattorro Plate Reverb apporte une reverb classique de qualité professionnelle à votre expérience d'écoute. Son caractère doux et luxuriant le rend parfait pour améliorer tout enregistrement avec une ambiance belle et naturelle !

## FDN Reverb

Un effet de reverb sophistiqué basé sur l'architecture de réseau de délais à rétroaction (FDN) utilisant une matrice de diffusion Hadamard. Cela crée une réverbération riche et complexe avec une excellente densité et des caractéristiques de décroissance naturelles, parfait pour améliorer votre expérience d'écoute musicale avec des effets spatiaux immersifs.

### Guide d'Expérience d'Écoute
- Sensation de Pièce Naturelle :
  - Crée la sensation d'écouter dans de vrais espaces acoustiques
  - Ajoute profondeur et dimension à votre musique
  - Rend les enregistrements stéréo plus spacieux et vivants
- Amélioration Atmosphérique :
  - Transforme les enregistrements plats en expériences immersives
  - Ajoute de beaux sustains et queues aux notes musicales
  - Crée une sensation d'être dans l'espace de performance
- Ambiance Personnalisable :
  - Ajustable des pièces intimes aux grandes salles de concert
  - Contrôle fin du caractère et de la couleur de l'espace
  - La modulation douce ajoute mouvement naturel et vie

### Parameters
- **Reverb Time** - Durée de l'effet de reverb (0.20 à 10.00 s)
  - Court (0.2-1.0s) : Décroissance rapide et contrôlée pour la clarté
  - Moyen (1.0-3.0s) : Réverbération naturelle de type pièce
  - Long (3.0-10.0s) : Queues expansives et atmosphériques
- **Density** - Nombre de chemins d'écho pour la complexité (4 à 8 lignes)
  - 4 lignes : Échos individuels plus simples et définis
  - 6 lignes : Bon équilibre entre complexité et clarté
  - 8 lignes : Douceur et densité maximales
- **Pre Delay** - Silence initial avant le début de la reverb (0.0 à 100.0 ms)
  - 0-20ms : Reverb immédiate, sensation intime
  - 20-50ms : Sensation naturelle de distance de pièce
  - 50-100ms : Crée l'impression d'espaces plus grands
- **Base Delay** - Timing fondamental pour le réseau de reverb (10.0 à 60.0 ms)
  - Valeurs plus basses : Caractère de reverb plus serré et focalisé
  - Valeurs plus hautes : Qualité sonore plus spacieuse et ouverte
  - Affecte les relations de timing fondamentales
- **Delay Spread** - Variation des temps de délai entre les lignes (0.0 à 25.0 ms)
  - Implémentation : Chaque ligne de délai devient progressivement plus longue en utilisant une courbe de puissance (exposant 0.8)
  - 0.0ms : Toutes les lignes ont le même timing de base (motifs plus réguliers)
  - Valeurs plus hautes : Motifs de réflexion plus naturels et irréguliers
  - Ajoute une variation réaliste trouvée dans les vrais espaces acoustiques
- **HF Damp** - Comment les hautes fréquences s'estompent dans le temps (0.0 à 12.0 dB/s)
  - 0.0 : Pas d'amortissement, son brillant tout au long de la décroissance
  - 3.0-6.0 : Simulation naturelle d'absorption de l'air
  - 12.0 : Amortissement lourd pour un caractère chaud et doux
- **Low Cut** - Supprime les basses fréquences de la reverb (20 à 500 Hz)
  - 20-50Hz : Réponse de basse complète dans la reverb
  - 100-200Hz : Basses contrôlées pour éviter la confusion
  - 300-500Hz : Graves serrés et clairs
- **Mod Depth** - Quantité de modulation de hauteur pour l'effet chorus (0.0 à 10.0 cents)
  - 0.0 : Pas de modulation, reverb statique pure
  - 2.0-5.0 : Mouvement subtil qui ajoute vie et réalisme
  - 10.0 : Effet chorus-like notable
- **Mod Rate** - Vitesse de la modulation (0.10 à 5.00 Hz)
  - 0.1-0.5Hz : Mouvement très lent et doux
  - 1.0-2.0Hz : Variation naturelle
  - 3.0-5.0Hz : Modulation rapide et plus évidente
- **Diffusion** - Degré de mélange des signaux par la matrice Hadamard (0 à 100%)
  - Implémentation : Contrôle la quantité de mélange matriciel appliqué
  - 0% : Mélange minimal, motifs d'écho plus distincts
  - 50% : Diffusion équilibrée pour un son naturel
  - 100% : Mélange maximal pour la densité la plus lisse
- **Wet Mix** - Quantité de reverb ajoutée au son (0 à 100%)
  - 10-30% : Amélioration spatiale subtile
  - 30-60% : Présence notable de reverb
  - 60-100% : Effet de reverb dominant
- **Dry Mix** - Quantité de signal original préservée (0 à 100%)
  - Habituellement maintenu à 100% pour l'écoute normale
  - Peut être réduit pour des effets atmosphériques spéciaux
- **Stereo Width** - Largeur de diffusion de la reverb en stéréo (0 à 200%)
  - Implémentation : 0% = mono, 100% = stéréo normal, 200% = largeur exagérée
  - 0% : La reverb apparaît au centre (mono)
  - 100% : Diffusion stéréo naturelle
  - 200% : Image stéréo extra-large

### Réglages Recommandés pour Différentes Expériences d'Écoute

1. Amélioration de Musique Classique
   - Reverb Time : 2.5-3.5s
   - Density : 8 lignes
   - Pre Delay : 30-50ms
   - HF Damp : 4.0-6.0
   - Parfait pour : Enregistrements orchestraux, musique de chambre

2. Atmosphère de Club de Jazz
   - Reverb Time : 1.2-1.8s
   - Density : 6 lignes
   - Pre Delay : 15-25ms
   - HF Damp : 2.0-4.0
   - Parfait pour : Jazz acoustique, performances intimes

3. Amélioration Pop/Rock
   - Reverb Time : 1.0-2.0s
   - Density : 6-7 lignes
   - Pre Delay : 10-30ms
   - Wet Mix : 20-40%
   - Parfait pour : Enregistrements modernes, ajout d'espace

4. Paysages Sonores Ambiants
   - Reverb Time : 4.0-8.0s
   - Density : 8 lignes
   - Mod Depth : 3.0-6.0
   - Wet Mix : 60-80%
   - Parfait pour : Musique atmosphérique, relaxation

### Guide de Démarrage Rapide

1. Définir le Caractère de l'Espace
   - Commencez avec Reverb Time pour correspondre à la taille d'espace désirée
   - Réglez Density à 6-8 pour un son lisse et naturel
   - Ajustez Pre Delay pour contrôler la perception de distance

2. Façonner le Timbre
   - Utilisez HF Damp pour simuler l'absorption naturelle de l'air
   - Réglez Low Cut pour éviter l'accumulation de basses
   - Ajustez Diffusion pour la douceur (essayez 70-100%)

3. Ajouter un Mouvement Naturel
   - Réglez Mod Depth à 2-4 cents pour une vie subtile
   - Utilisez Mod Rate autour de 0.3-1.0 Hz pour une variation douce
   - Ajustez Stereo Width pour l'impression spatiale

4. Équilibrer l'Effet
   - Commencez avec 30% Wet Mix
   - Maintenez Dry Mix à 100% pour l'écoute normale
   - Ajustez finement selon votre musique et vos préférences

Le FDN Reverb transforme votre expérience d'écoute en ajoutant des espaces acoustiques réalistes avec une réverbération belle et naturelle à tout enregistrement. Parfait pour les mélomanes qui veulent améliorer leurs morceaux favoris avec une belle réverbération au son naturel !

## RS Reverb

Un effet qui peut transporter votre musique dans différents espaces, des pièces chaleureuses aux salles majestueuses. Il ajoute des échos et des réflexions naturels qui rendent votre musique plus tridimensionnelle et immersive.

### Guide d'Expérience d'Écoute
- Espace Intime :
  - Donne l'impression que la musique est dans une pièce chaleureuse et confortable
  - Parfait pour une écoute proche et personnelle
  - Ajoute une profondeur subtile sans perdre en clarté
- Expérience Salle de Concert :
  - Recrée la grandeur des performances live
  - Ajoute un espace majestueux à la musique classique et orchestrale
  - Crée une expérience de concert immersive
- Amélioration Atmosphérique :
  - Ajoute des qualités rêveuses et éthérées
  - Parfait pour la musique ambiante et atmosphérique
  - Crée des paysages sonores captivants

### Parameters
- **Pre-Delay** - Contrôle la rapidité avec laquelle l'effet d'espace commence (0 à 50 ms)
  - Valeurs plus basses : Sensation immédiate et intime
  - Valeurs plus hautes : Plus de sensation de distance
  - Commencez avec 10ms pour un son naturel
- **Room Size** - Définit la taille ressentie de l'espace (2.0 à 50.0 m)
  - Petit (2-5m) : Sensation de pièce confortable
  - Moyen (5-15m) : Atmosphère de salle live
  - Grand (15-50m) : Grandeur de salle de concert
- **Reverb Time** - Durée des échos (0.1 à 10.0 s)
  - Court (0.1-1.0s) : Son clair et focalisé
  - Moyen (1.0-3.0s) : Son naturel de pièce
  - Long (3.0-10.0s) : Spacieux, atmosphérique
- **Density** - Richesse de l'espace (4 à 8)
  - Valeurs plus basses : Échos plus définis
  - Valeurs plus hautes : Atmosphère plus lisse
  - Commencez avec 6 pour un son naturel
- **Diffusion** - Propagation du son (0.2 à 0.8)
  - Valeurs plus basses : Échos plus distincts
  - Valeurs plus hautes : Mélange plus doux
  - Essayez 0.5 pour un son équilibré
- **Damping** - Atténuation des échos (0 à 100%)
  - Valeurs plus basses : Son plus brillant et ouvert
  - Valeurs plus hautes : Plus chaleureux et intime
  - Commencez autour de 40% pour une sensation naturelle
- **High Damp** - Contrôle la brillance de l'espace (1000 à 20000 Hz)
  - Valeurs plus basses : Espace plus sombre et chaleureux
  - Valeurs plus hautes : Plus brillant et ouvert
  - Commencez autour de 8000Hz pour un son naturel
- **Low Damp** - Contrôle la plénitude de l'espace (20 à 500 Hz)
  - Valeurs plus basses : Son plus plein et riche
  - Valeurs plus hautes : Plus clair et contrôlé
  - Commencez autour de 100Hz pour des basses équilibrées
- **Mix** - Équilibre l'effet avec le son original (0 à 100%)
  - 10-30% : Amélioration subtile
  - 30-50% : Espace notable
  - 50-100% : Effet dramatique

### Réglages Recommandés pour Différents Styles de Musique

1. Musique Classique en Salle de Concert
   - Room Size : 30-40m
   - Reverb Time : 2.0-2.5s
   - Mix : 30-40%
   - Parfait pour : Œuvres orchestrales, concertos pour piano

2. Club de Jazz Intime
   - Room Size : 8-12m
   - Reverb Time : 1.0-1.5s
   - Mix : 20-30%
   - Parfait pour : Jazz, performances acoustiques

3. Pop/Rock Moderne
   - Room Size : 15-20m
   - Reverb Time : 1.2-1.8s
   - Mix : 15-25%
   - Parfait pour : Musique contemporaine

4. Ambient/Électronique
   - Room Size : 25-40m
   - Reverb Time : 3.0-6.0s
   - Mix : 40-60%
   - Parfait pour : Musique électronique atmosphérique

### Guide de Démarrage Rapide

1. Choisissez Votre Espace
   - Commencez avec Room Size pour définir l'espace de base
   - Ajustez Reverb Time pour l'atmosphère désirée
   - Affinez Mix pour un équilibre approprié

2. Façonnez le Son
   - Utilisez Damping pour contrôler la chaleur
   - Ajustez High/Low Damp pour le timbre
   - Réglez Density et Diffusion pour la texture

3. Affinez l'Effet
   - Ajoutez Pre-Delay pour plus de profondeur
   - Ajustez Mix pour l'équilibre final
   - Faites confiance à vos oreilles et ajustez selon vos goûts

N'oubliez pas : L'objectif est d'améliorer votre musique avec un espace et une atmosphère naturels. Commencez avec des réglages subtils et ajustez jusqu'à trouver l'équilibre parfait pour votre expérience d'écoute !