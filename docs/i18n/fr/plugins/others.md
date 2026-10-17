---
title: "Autres Plugins - Générateur de sons et de bruits de test, SFZ Note Player - EffeTune"
description: "Oscillator : sons de test, bruit blanc ou rose pour vérifier enceintes et casques. SFZ Note Player joue les notes détectées dans l’audio avec un instrument SFZ."
lang: fr
---

# Autres Outils Audio

Une collection d'outils audio spécialisés et de générateurs qui complètent les catégories d'effets principales. Ces plugins sont utiles pour vérifier les haut-parleurs, casques, équilibre des canaux et comportement de lecture avant ou pendant l'écoute.

## Liste des Plugins

- [Oscillator](#oscillator) - Générateur de sons et bruits de test pour vérifier haut-parleurs/casques
- [SFZ Note Player](#sfz-note-player) - Joue un instrument SFZ importé à partir des notes détectées

## Oscillator

Un générateur de sons et bruits de test pour vérifier votre système d'écoute. Utilisez-le à bas niveau pour confirmer la sortie des haut-parleurs/casques, le placement gauche/droite, l'équilibre de niveau, les vibrations, bourdonnements ou problèmes simples de réponse en fréquence.

Le son ou bruit généré est mélangé dans le chemin audio courant au lieu de remplacer l'entrée. Baissez Volume avant de l'activer, surtout si de la musique est déjà en cours de lecture.

### Caractéristiques
- Plusieurs types de formes d'onde :
  - Onde sinusoïdale pure pour de simples vérifications de tonalité
  - Onde carrée pour un contenu harmonique riche
  - Onde triangulaire pour des harmoniques plus douces
  - Onde en dents de scie pour des timbres brillants
  - Impulsions périodiques d'un échantillon pour vérifier la réponse impulsionnelle et la synchronisation
  - Bruit blanc pour des vérifications large bande des enceintes et du casque
  - Bruit rose pour un équilibre de bruit plus doux et plus naturel
- Mode d'opération pulsé pour des tons ou rafales de bruit intermittents

### Paramètres
- **Frequency (Hz)** - Contrôle la hauteur du ton généré (20 Hz à 96 kHz)
  - Basses fréquences : Tons graves profonds
  - Fréquences moyennes : Gamme musicale
  - Hautes fréquences : À utiliser prudemment et seulement à des niveaux d'écoute sûrs
  - S'applique seulement à Sine, Square, Triangle et Sawtooth ; désactivé pour Impulse, White Noise et Pink Noise
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
  - Impulse : Un échantillon à amplitude maximale à chaque Interval, selon la fréquence d'échantillonnage actuelle ; Frequency n'a aucun effet
  - White Noise : Énergie égale par Hz ; Frequency ne l'affecte pas
  - Pink Noise : Énergie égale par octave ; Frequency ne l'affecte pas
- **Mode** - Contrôle le motif de génération du signal
  - Continuous : Génération de signal continue et ininterrompue
  - Pulsed : Signal intermittent avec timing contrôlable
  - Impulse utilise toujours Pulsed ; Continuous est désactivé
- **Interval (ms)** - Temps entre les rafales de pulses en mode pulsé (100-2000 ms, pas de 10 ms)
  - Intervalles courts : Séquences de pulses rapides
  - Intervalles longs : Pulses largement espacés
  - Actif quand le Mode est réglé sur Pulsed, y compris pour Impulse
- **Width (ms)** - Temps de rampe des pulses en mode pulsé (2-100 ms, limité à la moitié de Interval, pas de 1 ms)
  - Contrôle le temps de fondu entrant/sortant de chaque pulse
  - Le pulse généré dure environ deux fois Width, sans section maintenue à niveau constant
  - Largeurs courtes : Bords de pulse nets
  - Largeurs longues : Transitions de pulse plus douces
  - Actif seulement quand le Mode est réglé sur Pulsed ; désactivé pour Impulse, car chaque impulsion dure exactement un échantillon

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

6. Vérifications de la réponse impulsionnelle et de la synchronisation
   - Sélectionnez Impulse pour générer des transitoires d'un échantillon selon l'Interval défini
     * Utilisez un Interval plus long pour séparer les réflexions ou les traînes d'effets
     * Enregistrez la sortie pour analyser la réponse impulsionnelle d'un système ou d'une chaîne de plugins
     * Commencez avec un Volume faible, car l'impulsion présente un pic abrupt et un contenu large bande

N'oubliez pas : Oscillator est un générateur de signal de test. Commencez avec un Volume bas, augmentez progressivement et évitez les tons forts ou très aigus pouvant endommager l'équipement ou fatiguer l'audition.

## SFZ Note Player

SFZ Note Player détecte les notes du signal entrant et les joue avec un instrument SFZ importé. Vous pouvez suivre les notes d’une chanson avec un SFZ de piano, ou superposer un autre instrument à l’enregistrement d’origine. L’estimation polyphonique des notes est un outil d’écoute et de superposition, pas une transcription exacte : dans un mixage dense, des notes peuvent être manquées ou jouées en trop.

### Guide de réglage du son

- **Importer et charger un instrument** : Cliquez sur **SFZ Library…**, utilisez **Importer un dossier…** pour ajouter un dossier contenant les définitions `.sfz` et les fichiers d’échantillons (ou le dossier complet d’une banque ARIA avec `.bank.xml`, `Programs` et `Samples`), puis cliquez sur **Charger** à côté de l’instrument. Dans l’application de bureau, EffeTune lit les fichiers d’origine là où ils se trouvent ; dans l’application web, les instruments sont enregistrés sur votre appareil et **Importer des fichiers…** doit inclure les échantillons et les autres fichiers dont l’instrument a besoin. Un instrument en cours d’utilisation ne peut pas être supprimé.
- **Écouter et mélanger** : Commencez avec **Dry: 0%** et **Wet: 100%** pour entendre l’instrument SFZ seul, puis augmentez **Dry** pour réintroduire le morceau d’origine. Réglez **Timing** (−100 à +100 ms) pour aligner les attaques des notes SFZ sur l’enregistrement d’origine (à 0 ms, le signal d’origine est retardé pour correspondre à la détection des notes : environ 90 ms en Classic, environ 230 ms en Event).
- **Cibler la plage de notes et les voix** : Augmentez **Threshold** pour ne déclencher que les notes détectées avec une forte confiance, resserrez **Lowest Note** et **Highest Note**, ou n’activez que **Lowest** (ligne de basse) ou **Highest** (mélodie supérieure) pour suivre une seule ligne musicale. Une ligne colorée dans Note Spectrogram ne garantit pas la lecture, car **Threshold** et la plage de notes s’appliquent toujours.
- **Façonner le timbre et l’octave** : Utilisez **Octave** (−2 à +2) pour doubler une ligne une octave plus bas ou plus haut, et **Sample Shift** (−6 à +6 demi-tons) pour jouer les échantillons attribués aux notes voisines, ramenés à la hauteur de la note détectée, afin d’obtenir un timbre plus sombre ou plus brillant.

### Paramètres

- **SFZ** - Ouvre **SFZ Library…** pour importer, rechercher, trier, charger ou supprimer des instruments (**Clear** décharge l’instrument actuel sans le supprimer de la bibliothèque).
- **Detection** :
  - **Classic (Low Latency)** (par défaut) : Détecteur à faible latence (retard d’alignement d’environ 90 ms) qui utilise **Threshold** et **Retrigger Drop**.
  - **Event (+140 ms)** : Utilise le même détecteur d’attaques et d’événements que Note Spectrogram (retard d’alignement d’environ 230 ms, charge CPU plus élevée ; **Threshold** et **Retrigger Drop** sont désactivés). Lorsqu’un Note Spectrogram actif placé plus tôt dans la chaîne analyse la même entrée avec la même plage de notes et que le signal n’est pas modifié entre les deux, son analyse est partagée pour réduire la charge si **Onsets**, la couleur **Instrument** ou **Highlight** est activé dans Note Spectrogram. Sinon, SFZ Note Player effectue sa propre analyse.
- **Color** - **Normal** (couleur du graphique définie par le thème) ou **Note Colors** (une couleur par nom de note, comme dans Note Spectrogram).
- **Threshold** (0,01 à 1 ; 0,75 par défaut) - Seuil de confiance de détection en mode Classic.
- **Retrigger Drop (dB)** (1 à 96 dB ; 40 dB par défaut) - Baisse de niveau nécessaire avant de redéclencher une note tenue au-dessus de B5 en mode Classic ; le niveau doit ensuite remonter d’au moins 6 dB. Une valeur élevée limite les répétitions indésirables pendant les notes tenues ; une valeur faible suit plus facilement les frappes répétées d’une même note. Jusqu’à B5 inclus, les attaques détectées déclenchent directement de nouvelles notes.
- **Note Hold (ms)** (0 à 100 ms ; 50 ms par défaut) - Comble les brèves interruptions de détection avant de relâcher une note.
- **Velocity 1 Level / Velocity 127 Level (dB)** (-96 à 0 dB / -60 à +24 dB ; -60 dB / -10 dB par défaut) - Plage de niveaux d’entrée associée aux vélocités MIDI 1–127. Les diminuer donne des vélocités plus fortes pour une même entrée.
- **Lowest Note / Highest Note** (A0 à C8 ; E1 à G6 par défaut) - Plage de détection des hauteurs.
- **Highest / Middle / Lowest** - Choisit lesquelles des notes détectées simultanément sont jouées (ligne supérieure, voix intérieures ou ligne de basse ; toutes activées par défaut).
- **Octave** (-2 à +2 ; 0 par défaut) - Transpose par octaves entières les nouvelles notes SFZ déclenchées.
- **Sample Shift** (-6 à +6 demi-tons ; 0 par défaut) - Décale la région d’échantillon sélectionnée tout en compensant sa hauteur pour conserver celle de la note visée. Les valeurs positives jouent plus lentement des échantillons de notes plus aiguës (à +1, un C4 détecté utilise l’échantillon de C#4 à la hauteur de C4) ; les valeurs négatives jouent plus vite des échantillons de notes plus graves.
- **Max Voices** (1 à 128 ; 32 par défaut) - Nombre maximal de voix d’échantillons simultanées (fins de relâchement comprises). Une valeur plus élevée conserve davantage de notes superposées, mais demande plus de traitement.
- **Dry (%)** / **Wet (%)** (0 à 100% ; 20% / 100% par défaut) - Niveaux indépendants du son d’origine aligné sur la latence et de l’instrument SFZ.
- **Timing (ms)** (-100 à +100 ms ; 0 ms par défaut) - Affine l’alignement temporel entre le son d’origine et l’instrument SFZ. Les valeurs négatives retardent davantage le son d’origine ; les valeurs positives retardent l’instrument.
- **Output Gain (dB)** (-60 à +12 dB ; 0 dB par défaut) - Ajustement du niveau de sortie final.

### Affichage de lecture et remarques

- **Clavier interactif et barres de vélocité** : Le clavier couvre la plage de **Lowest Note** à **Highest Note** et allume les notes jouées, fins de relâchement comprises. Les touches allumées suivent **Octave** ; **Sample Shift** modifie le timbre sans les déplacer. Chaque barre part de la vélocité de jeu (1–127) et redescend avec le temps, même après la fin de la note ; **Color** change leurs couleurs sans relancer la descente. **Voices / Max Voices** compte les voix d’échantillons, relâchements compris.
- **Écoute directe** : Cliquez ou faites glisser sur le clavier ou la zone de vélocité pour jouer directement l’instrument SFZ chargé. Le clavier joue à la vélocité 100 ; dans la zone de vélocité, la vélocité dépend de la hauteur à laquelle vous touchez. L’écoute directe joue la hauteur affichée sans tenir compte d’**Octave**, mais **Sample Shift** reste appliqué.
- **Limite de mémoire** : Par défaut, les instruments sont limités à **256 MiB** (réglable jusqu’à **1024 MiB** avec **Limite de taille SFZ** dans **Paramètres > Configuration... > Général**). Si un instrument dépasse la limite, des échantillons représentatifs répartis sur le clavier sont chargés automatiquement. Dans l’application web, réimportez le dossier après avoir augmenté la limite.
- **Fonctions SFZ prises en charge** : Les couches qui nécessitent un relâchement de note, des événements de contrôleur ou un changement dynamique d’articulation par touche sont omises, et les autres réglages non pris en charge sont ignorés.
- **Partage et sauvegardes** : Les préréglages, les liens partagés et les sauvegardes des données utilisateur enregistrent une référence à l’instrument, et non ses échantillons audio ; conservez vos dossiers SFZ d’origine pour les utiliser sur d’autres appareils.
