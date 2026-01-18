---
title: "Lo-Fi Plugins - EffeTune"
description: "Lo-Fi effect plugins including Bit Crusher, Noise Blender, Vinyl Artifacts, and more."
lang: en
---

# Lo-Fi Audio Plugins

Une collection de plugins qui ajoutent du caractère vintage et des qualités nostalgiques à votre musique. Ces effets peuvent faire sonner la musique numérique moderne comme si elle était jouée à travers des équipements classiques ou lui donner ce son "lo-fi" populaire qui est à la fois relaxant et atmosphérique.

## Plugin List

- [Bit Crusher](#bit-crusher) - Crée des sons rétro de jeux vidéo et numériques vintage
- [Digital Error Emulator](#digital-error-emulator) - Simule diverses erreurs de transmission audio numérique
- [Hum Generator](#hum-generator) - Générateur de bruit de ronflement haute précision
- [Noise Blender](#noise-blender) - Ajoute une texture atmosphérique en arrière-plan
- [Simple Jitter](#simple-jitter) - Crée des imperfections numériques vintage subtiles
- [Vinyl Artifacts](#vinyl-artifacts) - Simulation physique du bruit de disques analogiques

## Bit Crusher

Un effet qui recrée le son des appareils numériques vintage comme les anciennes consoles de jeux et les premiers échantillonneurs. Parfait pour ajouter du caractère rétro ou créer une atmosphère lo-fi.

### Guide du Caractère Sonore
- Style Rétro Gaming :
  - Crée des sons classiques de console 8-bit
  - Parfait pour la nostalgie des jeux vidéo
  - Ajoute une texture pixelisée au son
- Style Lo-Fi Hip Hop :
  - Crée ce son relaxant de study-beats
  - Dégradation numérique chaude et douce
  - Parfait pour l'écoute en arrière-plan
- Effets Créatifs :
  - Créez des sons uniques style glitch
  - Transformez la musique moderne en versions rétro
  - Ajoutez du caractère numérique à n'importe quelle musique

### Parameters
- **Bit Depth** - Contrôle à quel point le son devient "numérique" (4 à 24 bits)
  - 4-6 bits : Son rétro gaming extrême
  - 8 bits : Numérique vintage classique
  - 12-16 bits : Caractère lo-fi subtil
  - Valeurs plus hautes : Effet très doux
- **TPDF Dither** - Rend l'effet plus doux
  - On : Son plus doux et musical
  - Off : Effet plus brut et agressif
- **ZOH Frequency** - Affecte la clarté globale (4000Hz à 96000Hz)
  - Valeurs plus basses : Plus rétro, moins clair
  - Valeurs plus hautes : Plus clair, effet plus subtil
- **Bit Error** - Ajoute du caractère matériel vintage (0.00% à 10.00%)
  - 0-1% : Chaleur vintage subtile
  - 1-3% : Imperfections matérielles classiques
  - 3-10% : Caractère lo-fi créatif
- **Random Seed** - Contrôle l'unicité des imperfections (0 à 1000)
  - Différentes valeurs créent différentes "personnalités" vintage
  - La même valeur reproduit toujours le même caractère
  - Parfait pour trouver et sauvegarder votre son vintage préféré

## Digital Error Emulator

Un effet qui simule le son de diverses erreurs de transmission audio numérique, depuis les glitches d'interface professionnelle subtils jusqu'aux imperfections des lecteurs CD vintage. Parfait pour ajouter du caractère numérique vintage ou créer des expériences d'écoute uniques qui vous rappellent les équipements audio numériques classiques.

### Guide du Caractère Sonore
- Glitches d'Interface Numérique Professionnelle :
  - Simule les artefacts de transmission S/PDIF, AES3 et MADI
  - Ajoute le caractère d'équipements professionnels vieillissants
  - Parfait pour le son de studio vintage
- Décrochages Numériques Grand Public :
  - Recrée le comportement de correction d'erreur des lecteurs CD classiques
  - Simule les glitches d'interface audio USB
  - Idéal pour la nostalgie de la musique numérique des années 90/2000
- Artefacts de Streaming et Audio Sans Fil :
  - Simule les erreurs de transmission Bluetooth
  - Décrochages et artefacts de streaming réseau
  - Imperfections de la vie numérique moderne
- Textures Numériques Créatives :
  - Interférences RF et erreurs de transmission sans fil
  - Effets de corruption audio HDMI/DisplayPort
  - Possibilités sonores expérimentales uniques

### Paramètres
- **Bit Error Rate** - Contrôle la fréquence d'occurrence des erreurs (10^-12 à 10^-2)
  - Très Rare (10^-10 à 10^-8) : Artefacts subtils occasionnels
  - Occasionnel (10^-8 à 10^-6) : Comportement d'équipement grand public classique
  - Fréquent (10^-6 à 10^-4) : Caractère vintage notable
  - Extrême (10^-4 à 10^-2) : Effets expérimentaux créatifs
  - Défaut : 10^-6 (équipement grand public typique)
- **Mode** - Sélectionne le type de transmission numérique à simuler
  - AES3/S-PDIF : Erreurs de bits d'interface professionnelle avec maintien d'échantillon
  - ADAT/TDIF/MADI : Erreurs en rafale multicanal (maintien ou silence)
  - HDMI/DP : Corruption de ligne audio d'affichage ou mise en silence
  - USB/FireWire/Thunderbolt : Décrochages de micro-trame avec interpolation
  - Dante/AES67/AVB : Perte de paquets audio réseau (64/128/256 échantillons)
  - Bluetooth A2DP/LE : Erreurs de transmission sans fil avec dissimulation
  - WiSA : Erreurs de blocs FEC d'enceintes sans fil
  - RF Systems : Silencieux de fréquence radio et interférences
  - CD Audio : Simulation de correction d'erreur CIRC
  - Défaut : CD Audio (le plus familier aux auditeurs de musique)
- **Reference Fs (kHz)** - Définit le taux d'échantillonnage de référence pour les calculs de timing
  - Taux disponibles : 44.1, 48, 88.2, 96, 176.4, 192 kHz
  - Affecte la précision du timing pour les modes audio réseau
  - Défaut : 48 kHz
- **Wet Mix** - Contrôle le mélange entre l'audio original et traité (0-100%)
  - Note : Pour une simulation réaliste d'erreur numérique, maintenir à 100%
  - Les valeurs plus basses créent des erreurs "partielles" irréalistes qui ne se produisent pas dans les vrais systèmes numériques
  - Défaut : 100% (comportement d'erreur numérique authentique)

### Détails des Modes

**Interfaces Professionnelles :**
- AES3/S-PDIF : Erreurs d'échantillon unique avec maintien de l'échantillon précédent
- ADAT/TDIF/MADI : Erreurs en rafale de 32 échantillons - maintien des derniers bons échantillons ou silence
- HDMI/DisplayPort : Corruption de ligne de 192 échantillons avec erreurs au niveau bit ou silence complet

**Audio Informatique :**
- USB/FireWire/Thunderbolt : Décrochages de micro-trame avec dissimulation par interpolation
- Audio Réseau (Dante/AES67/AVB) : Perte de paquets avec différentes options de taille et dissimulation

**Sans Fil Grand Public :**
- Bluetooth A2DP : Erreurs de transmission post-codec avec artefacts de tremblement et décroissance
- Bluetooth LE : Dissimulation améliorée avec filtrage haute fréquence et bruit
- WiSA : Silence de blocs FEC d'enceintes sans fil

**Systèmes Spécialisés :**
- RF Systems : Événements de silence de longueur variable simulant les interférences radio
- CD Audio : Simulation de correction d'erreur CIRC avec comportement style Reed-Solomon

### Réglages Recommandés pour Différents Styles

1. Caractère d'Équipement Professionnel Subtil
   - Mode : AES3/S-PDIF, BER : 10^-8, Fs : 48kHz, Wet : 100%
   - Parfait pour : Ajouter un vieillissement subtil d'équipement professionnel

2. Expérience Lecteur CD Classique
   - Mode : CD Audio, BER : 10^-7, Fs : 44.1kHz, Wet : 100%
   - Parfait pour : Nostalgie de la musique numérique des années 90

3. Glitches de Streaming Moderne
   - Mode : Dante/AES67 (128 samp), BER : 10^-6, Fs : 48kHz, Wet : 100%
   - Parfait pour : Imperfections de la vie numérique contemporaine

4. Expérience d'Écoute Bluetooth
   - Mode : Bluetooth A2DP, BER : 10^-6, Fs : 48kHz, Wet : 100%
   - Parfait pour : Souvenirs d'audio sans fil

5. Effets Expérimentaux Créatifs
   - Mode : RF Systems, BER : 10^-5, Fs : 48kHz, Wet : 100%
   - Parfait pour : Sons expérimentaux uniques

Note : Toutes les recommandations utilisent 100% de Wet Mix pour un comportement d'erreur numérique réaliste. Les valeurs de mix humide plus basses peuvent être utilisées pour des effets créatifs, mais elles ne représentent pas comment les vraies erreurs numériques se produisent réellement.

## Hum Generator

Un effet qui génère un bruit de ronflement électrique authentique et de haute précision avec sa structure harmonique caractéristique et ses instabilités subtiles. Parfait pour ajouter un ronflement de fond réaliste d'équipements vintage, d'alimentations électriques, ou créer cette sensation authentique d'être "branché" que possèdent de nombreux enregistrements classiques.

### Guide de Caractère Sonore
- Ambiance d'Équipement Vintage :
  - Recrée le ronflement subtil d'amplificateurs et équipements classiques
  - Ajoute le caractère d'être "branché" à l'alimentation AC
  - Crée une atmosphère authentique de studio vintage
- Caractéristiques d'Alimentation Électrique :
  - Simule différents types de bruit d'alimentation électrique
  - Recrée les caractéristiques régionales du réseau électrique (50Hz vs 60Hz)
  - Ajoute un caractère subtil d'infrastructure électrique
- Texture d'Arrière-plan :
  - Crée une présence organique de bas niveau en arrière-plan
  - Ajoute de la profondeur et de la "vie" aux enregistrements numériques stériles
  - Parfait pour les productions inspirées du vintage

### Paramètres
- **Frequency** - Définit la fréquence fondamentale du ronflement (10-120 Hz)
  - 50 Hz : Standard du réseau électrique européen/asiatique
  - 60 Hz : Standard du réseau électrique nord-américain
  - Autres valeurs : Fréquences personnalisées pour effets créatifs
- **Type** - Contrôle la structure harmonique du ronflement
  - Standard : Contient uniquement des harmoniques impaires (plus pur, type transformateur)
  - Rich : Contient tous les harmoniques (complexe, type équipement)
  - Dirty : Harmoniques riches avec distorsion subtile (caractère d'équipement vintage)
- **Harmonics** - Contrôle la brillance et le contenu harmonique (0-100%)
  - 0-30% : Ronflement chaud et doux avec harmoniques supérieures minimales
  - 30-70% : Contenu harmonique équilibré typique d'équipements réels
  - 70-100% : Ronflement brillant et complexe avec harmoniques supérieures fortes
- **Tone** - Fréquence de coupure du filtre de modelage tonal final (1.0-20.0 kHz)
  - 1-5 kHz : Caractère chaud et étouffé
  - 5-10 kHz : Ton naturel type équipement
  - 10-20 kHz : Caractère brillant et présent
- **Instability** - Quantité de variation subtile de fréquence et d'amplitude (0-10%)
  - 0% : Ronflement parfaitement stable (précision numérique)
  - 1-3% : Instabilité subtile du monde réel
  - 3-7% : Caractère notable d'équipement vintage
  - 7-10% : Effets de modulation créatifs
- **Level** - Niveau de sortie du signal de ronflement (-80.0 à 0.0 dB)
  - -80 à -60 dB : Présence d'arrière-plan à peine audible
  - -60 à -40 dB : Ronflement subtil mais notable
  - -40 à -20 dB : Caractère vintage proéminent
  - -20 à 0 dB : Niveaux créatifs ou d'effets spéciaux

### Réglages Recommandés pour Différents Styles

1. Amplificateur Vintage Subtil
   - Frequency : 50/60 Hz, Type : Standard, Harmonics : 25%
   - Tone : 8.0 kHz, Instability : 1.5%, Level : -54 dB
   - Parfait pour : Ajouter un caractère doux d'amplificateur vintage

2. Studio d'Enregistrement Classique
   - Frequency : 60 Hz, Type : Rich, Harmonics : 45%
   - Tone : 6.0 kHz, Instability : 2.0%, Level : -48 dB
   - Parfait pour : Atmosphère authentique de studio de l'ère analogique

3. Équipement Vintage à Tubes
   - Frequency : 50 Hz, Type : Dirty, Harmonics : 60%
   - Tone : 5.0 kHz, Instability : 3.5%, Level : -42 dB
   - Parfait pour : Caractère chaud d'amplificateur à tubes

4. Ambiance de Réseau Électrique
   - Frequency : 50/60 Hz, Type : Standard, Harmonics : 35%
   - Tone : 10.0 kHz, Instability : 1.0%, Level : -60 dB
   - Parfait pour : Arrière-plan réaliste d'alimentation électrique

5. Effets Créatifs de Ronflement
   - Frequency : 40 Hz, Type : Dirty, Harmonics : 80%
   - Tone : 15.0 kHz, Instability : 6.0%, Level : -36 dB
   - Parfait pour : Applications artistiques et expérimentales

## Noise Blender

Un effet qui ajoute une texture atmosphérique en arrière-plan à votre musique, similaire au son des disques vinyles ou des équipements vintage. Parfait pour créer des atmosphères chaleureuses et nostalgiques.

### Guide du Caractère Sonore
- Son d'Équipement Vintage :
  - Recrée la chaleur des vieux équipements audio
  - Ajoute de la "vie" subtile aux enregistrements numériques
  - Crée une sensation vintage authentique
- Expérience Vinyle :
  - Ajoute cette atmosphère classique de platine vinyle
  - Crée une sensation chaleureuse et familière
  - Parfait pour l'écoute nocturne
- Texture Ambiante :
  - Ajoute une atmosphère en arrière-plan
  - Crée de la profondeur et de l'espace
  - Rend la musique numérique plus organique

### Parameters
- **Noise Type** - Choisit le caractère de la texture d'arrière-plan
  - White : Texture plus brillante et présente
  - Pink : Son plus chaud et naturel
- **Level** - Contrôle la perceptibilité de l'effet (-96dB à 0dB)
  - Très Subtil (-96dB à -72dB) : Juste un soupçon
  - Doux (-72dB à -48dB) : Texture perceptible
  - Fort (-48dB à -24dB) : Caractère vintage dominant
- **Per Channel** - Crée un effet plus spacieux
  - On : Son plus large et immersif
  - Off : Texture plus focalisée et centrée

## Simple Jitter

Un effet qui ajoute des variations de timing subtiles pour créer ce son numérique vintage imparfait. Il peut faire sonner la musique comme si elle était jouée à travers de vieux lecteurs CD ou des équipements numériques vintage.

### Guide du Caractère Sonore
- Sensation Vintage Subtile :
  - Ajoute une instabilité douce comme les vieux équipements
  - Crée un son plus organique, moins parfait
  - Parfait pour ajouter du caractère subtilement
- Son de Lecteur CD Classique :
  - Recrée le son des premiers lecteurs numériques
  - Ajoute du caractère numérique nostalgique
  - Idéal pour l'appréciation de la musique des années 90
- Effets Créatifs :
  - Créez des effets de wobble uniques
  - Transformez les sons modernes en sons vintage
  - Ajoutez du caractère expérimental

### Parameters
- **RMS Jitter** - Contrôle la quantité de variation de timing (1ps à 10ms)
  - Subtil (1-10ps) : Caractère vintage doux
  - Moyen (10-100ps) : Sensation de lecteur CD classique
  - Fort (100ps-1ms) : Effets de wobble créatifs

### Réglages Recommandés pour Différents Styles

1. À Peine Perceptible
   - RMS Jitter : 1-5ps
   - Parfait pour : Ajouter la plus subtile touche de chaleur analogique aux enregistrements numériques

2. Caractère de Lecteur CD Classique
   - RMS Jitter : 50-100ps
   - Parfait pour : Recréer le son des premiers équipements de lecture numérique

3. Machine DAT Vintage
   - RMS Jitter : 200-500ps
   - Parfait pour : Caractère d'équipement d'enregistrement numérique des années 90

4. Équipement Numérique Usé
   - RMS Jitter : 1-2ns (1000-2000ps)
   - Parfait pour : Créer le son d'équipements numériques vieillissants ou mal entretenus

5. Effet de Fluctuation Créatif
   - RMS Jitter : 10-100µs (10000-100000ps)
   - Parfait pour : Effets expérimentaux et modulation de hauteur notable

## Vinyl Artifacts

Un effet qui recrée les caractéristiques de bruit physique des disques vinyles analogiques. Ce plugin simule les divers artefacts qui se produisent lors de la lecture de disques vinyles, du bruit de surface aux caractéristiques électriques de la chaîne de lecture.

### Guide du Caractère Sonore
- Expérience de Disque Vinyle :
  - Recrée le son authentique de la lecture de disques vinyles
  - Ajoute le bruit de surface caractéristique et les artefacts
  - Crée cette sensation analogique chaleureuse et nostalgique
- Système de Lecture Vintage :
  - Simule la chaîne de lecture analogique complète
  - Inclut les caractéristiques d'égalisation RIAA
  - Ajoute un bruit réactif qui répond à la musique
- Texture Ambiante :
  - Crée une texture d'arrière-plan riche et organique
  - Ajoute de la profondeur et du caractère aux enregistrements numériques
  - Parfait pour créer des expériences d'écoute chaleureuses et intimes

### Paramètres
- **Pops/min** - Contrôle la fréquence des gros bruits de clic par minute (0 à 120)
  - 0-20 : Pops doux occasionnels
  - 20-60 : Caractère vintage modéré
  - 60-120 : Son d'usure importante
- **Pop Level** - Contrôle le volume des bruits de pop (-80.0 à 0.0 dB)
  - -80 à -48 dB : Clics subtils
  - -48 à -24 dB : Pops modérés
  - -24 à 0 dB : Pops forts (réglages extrêmes)
- **Crackles/min** - Contrôle la densité du bruit de crépitement par minute (0 à 2000)
  - 0-200 : Texture de surface subtile
  - 200-1000 : Caractère vinyle classique
  - 1000-2000 : Bruit de surface lourd
- **Crackle Level** - Contrôle le volume du bruit de crépitement (-80.0 à 0.0 dB)
  - -80 à -48 dB : Crépitement subtil
  - -48 à -24 dB : Crépitement modéré
  - -24 à 0 dB : Crépitement fort (réglages extrêmes)
- **Hiss** - Contrôle le niveau de bruit de surface constant (-80.0 à 0.0 dB)
  - -80 à -48 dB : Texture d'arrière-plan subtile
  - -48 à -30 dB : Bruit de surface perceptible
  - -30 à 0 dB : Sifflement proéminent (réglages extrêmes)
- **Rumble** - Contrôle le grondement basse fréquence de la platine (-80.0 à 0.0 dB)
  - -80 à -60 dB : Chaleur subtile dans les graves
  - -60 à -40 dB : Grondement perceptible
  - -40 à 0 dB : Grondement lourd (réglages extrêmes)
- **Crosstalk** - Contrôle la diaphonie entre les canaux stéréo gauche et droit (0 à 100%)
  - 0% : Séparation stéréo parfaite
  - 30-60% : Diaphonie vinyle réaliste
  - 100% : Diaphonie maximale entre canaux
- **Noise Profile** - Ajuste la réponse en fréquence du bruit (0.0 à 10.0)
  - 0 : Reproduction de la courbe RIAA (réponse en fréquence vinyle authentique)
  - 5 : Réponse partiellement corrigée
  - 10 : Réponse plate (contournée)
- **Wear** - Multiplicateur maître pour l'état général du disque (0 à 200%)
  - 0-50% : Disque bien entretenu
  - 50-100% : Usure et âge normaux
  - 100-200% : Disque fortement usé
- **React** - À quel point le bruit répond au signal d'entrée (0 à 100%)
  - 0% : Niveaux de bruit statiques
  - 25-50% : Réponse modérée à la musique
  - 75-100% : Très réactif à l'entrée
- **React Mode** - Sélectionne quel aspect du signal contrôle la réaction
  - Velocity : Répond au contenu haute fréquence (vitesse d'aiguille)
  - Amplitude : Répond au niveau général du signal
- **Mix** - Contrôle la quantité de bruit ajoutée au signal sec (0 à 100%)
  - 0% : Aucun bruit ajouté (signal sec seulement)
  - 50% : Addition de bruit modérée
  - 100% : Addition de bruit maximale
  - Note : Le niveau du signal sec reste inchangé ; ce paramètre contrôle seulement la quantité de bruit

### Réglages Recommandés pour Différents Styles

1. Caractère Vinyle Subtil
   - Pops/min : 20, Pop Level : -48dB, Crackles/min : 200, Crackle Level : -48dB
   - Hiss : -48dB, Rumble : -60dB, Crosstalk : 30%, Noise Profile : 5.0
   - Wear : 25%, React : 20%, React Mode : Velocity, Mix : 100%
   - Parfait pour : Ajouter une chaleur analogique douce

2. Expérience Vinyle Classique
   - Pops/min : 40, Pop Level : -36dB, Crackles/min : 400, Crackle Level : -36dB
   - Hiss : -36dB, Rumble : -50dB, Crosstalk : 50%, Noise Profile : 4.0
   - Wear : 60%, React : 30%, React Mode : Velocity, Mix : 100%
   - Parfait pour : Expérience d'écoute vinyle authentique

3. Disque Très Usé
   - Pops/min : 80, Pop Level : -24dB, Crackles/min : 800, Crackle Level : -24dB
   - Hiss : -30dB, Rumble : -40dB, Crosstalk : 70%, Noise Profile : 3.0
   - Wear : 120%, React : 50%, React Mode : Velocity, Mix : 100%
   - Parfait pour : Caractère de disque fortement vieilli

4. Lo-Fi Ambiant
   - Pops/min : 15, Pop Level : -54dB, Crackles/min : 150, Crackle Level : -54dB
   - Hiss : -42dB, Rumble : -66dB, Crosstalk : 25%, Noise Profile : 6.0
   - Wear : 40%, React : 15%, React Mode : Amplitude, Mix : 100%
   - Parfait pour : Texture ambiante d'arrière-plan

5. Vinyle Dynamique
   - Pops/min : 60, Pop Level : -30dB, Crackles/min : 600, Crackle Level : -30dB
   - Hiss : -39dB, Rumble : -45dB, Crosstalk : 60%, Noise Profile : 5.0
   - Wear : 80%, React : 75%, React Mode : Velocity, Mix : 100%
   - Parfait pour : Bruit qui répond de manière dramatique à la musique

N'oubliez pas : Ces effets sont destinés à ajouter du caractère et de la nostalgie à votre musique. Commencez avec des réglages subtils et ajustez selon vos goûts !
