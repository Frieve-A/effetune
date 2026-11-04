---
title: "Autres Plugins - Générateur de sons et de bruits de test, SoundFont Note Player, SoundFont Player - EffeTune"
description: "Oscillator : sons de test, bruit blanc ou rose pour vérifier enceintes et casques. SoundFont Note Player joue les notes détectées dans l’audio avec un instrument SF2/SF3/SFZ. SoundFont Player joue des morceaux MIDI avec des SoundFonts SF2/SF3 ou des instruments SFZ."
lang: fr
---

# Autres Outils Audio

Une collection d'outils audio spécialisés et de générateurs qui complètent les catégories d'effets principales. Ces plugins sont utiles pour vérifier les haut-parleurs, casques, équilibre des canaux et comportement de lecture avant ou pendant l'écoute.

## Liste des Plugins

- [Oscillator](#oscillator) - Générateur de sons et bruits de test pour vérifier haut-parleurs/casques
- [SoundFont Note Player](#sfz-note-player) - Joue les notes détectées avec des SoundFonts SF2/SF3 et des instruments SFZ
- [SoundFont Player](#soundfont-player) - Joue des morceaux MIDI avec des SoundFonts SF2/SF3 et des instruments SFZ

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

## SoundFont Note Player

<a id="sfz-note-player"></a>

SoundFont Note Player détecte les notes du signal entrant et les joue avec un instrument SF2/SF3/SFZ importé. Vous pouvez suivre les notes d’une chanson avec un SFZ de piano, ou superposer un autre instrument à l’enregistrement d’origine. L’estimation polyphonique des notes est un outil d’écoute et de superposition, pas une transcription exacte : dans un mixage dense, des notes peuvent être manquées ou jouées en trop.

### Guide de réglage du son

- **Importer et charger un instrument** : Ouvrez **SoundFont Library…**, utilisez **Importer des fichiers…** pour importer un fichier `.sf2` / `.sf3`, cliquez sur **Charger**, puis choisissez un son avec **Preset**. Pour SFZ, utilisez **Importer un dossier…** pour ajouter la définition avec ses échantillons (ou le dossier complet d’une banque ARIA avec `.bank.xml`, `Programs` et `Samples`). L’application de bureau lit les fichiers d’origine à leur emplacement ; l’application web enregistre les instruments importés sur votre appareil. Avec **Importer des fichiers…** pour SFZ, incluez tous les échantillons et autres fichiers nécessaires. Un instrument en cours d’utilisation ne peut pas être supprimé.
- **Écouter et mélanger** : Commencez avec **Dry: 0%** et **Wet: 100%** pour entendre l’instrument SFZ seul, puis augmentez **Dry** pour réintroduire le morceau d’origine. Réglez **Timing** (−100 à +100 ms) pour aligner les attaques des notes SFZ sur l’enregistrement d’origine (à 0 ms, le signal d’origine est retardé pour correspondre à la détection des notes : environ 90 ms en Classic, environ 230 ms en Event).
- **Cibler la plage de notes et les voix** : Augmentez **Threshold** pour ne déclencher que les notes détectées avec une forte confiance, resserrez **Lowest Note** et **Highest Note**, ou n’activez que **Lowest** (ligne de basse) ou **Highest** (mélodie supérieure) pour suivre une seule ligne musicale. Une ligne colorée dans Note Spectrogram ne garantit pas la lecture, car **Threshold** et la plage de notes s’appliquent toujours.
- **Façonner le timbre et l’octave** : Utilisez **Octave** (−2 à +2) pour doubler une ligne une octave plus bas ou plus haut, et **Sample Shift** (−6 à +6 demi-tons) pour jouer les échantillons attribués aux notes voisines, ramenés à la hauteur de la note détectée, afin d’obtenir un timbre plus sombre ou plus brillant.

### Paramètres

- **SoundFont** - Ouvre **SoundFont Library…** pour importer, rechercher, trier, charger ou supprimer des instruments (**Clear** décharge l’instrument actuel sans le supprimer de la bibliothèque).
- **Preset** - Pour une collection SF2/SF3, choisit le son des notes détectées. **Default** utilise le premier preset jouable. Ce réglage est masqué pour les instruments SFZ.
- **Detection** :
  - **Classic (Low Latency)** (par défaut) : Détecteur à faible latence (retard d’alignement d’environ 90 ms) qui utilise **Threshold** et **Retrigger Drop**.
  - **Event (+140 ms)** : Utilise le même détecteur d’attaques et d’événements que Note Spectrogram (retard d’alignement d’environ 230 ms, charge CPU plus élevée ; **Threshold** et **Retrigger Drop** sont désactivés). Lorsqu’un Note Spectrogram actif placé plus tôt dans la chaîne analyse la même entrée avec la même plage de notes et que le signal n’est pas modifié entre les deux, son analyse est partagée pour réduire la charge si **Onsets**, la couleur **Instrument** ou **Highlight** est activé dans Note Spectrogram. Sinon, SoundFont Note Player effectue sa propre analyse.
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

### Instrument Details

Ouvrez **Instrument Details**, sous les commandes principales, pour consulter les libellés fournis par l’instrument SFZ : touches, contrôleurs MIDI (**CC**), sorties, groupes, couches et articulations sélectionnées par touche. Ces libellés décrivent les correspondances de l’instrument ; ce ne sont pas des commandes supplémentaires. Lorsqu’une articulation nommée est active, **Keyswitch** indique celle qui est sélectionnée sur chaque canal. L’illustration fournie par l’instrument s’affiche également ; si plusieurs images sont déclarées, la dernière est utilisée.

### Affichage de lecture et remarques

- **Clavier interactif et barres de vélocité** : Le clavier couvre la plage de **Lowest Note** à **Highest Note** et allume les notes jouées, fins de relâchement comprises. Les touches allumées suivent **Octave** ; **Sample Shift** modifie le timbre sans les déplacer. Chaque barre part de la vélocité de jeu (1–127) et redescend avec le temps, même après la fin de la note ; **Color** change leurs couleurs sans relancer la descente. **Voices / Max Voices** compte les voix d’échantillons, relâchements compris.
- **Écoute directe** : Cliquez ou faites glisser sur le clavier ou la zone de vélocité pour jouer directement l’instrument SFZ chargé. Le clavier joue à la vélocité 100 ; dans la zone de vélocité, la vélocité dépend de la hauteur à laquelle vous touchez. L’écoute directe joue la hauteur affichée sans tenir compte d’**Octave**, mais **Sample Shift** reste appliqué.
- **Limite de mémoire** : Le budget des instruments et du cache d’échantillons est de **256 MiB**, réglable jusqu’à **1024 MiB** avec **Limite de taille SoundFont** dans **Paramètres > Configuration... > Général**. Les fichiers lus progressivement peuvent être plus grands. Si cette limite empêche le chargement, augmentez-la ou choisissez un instrument plus petit.
- **Fonctions SFZ prises en charge**: SoundFont Note Player suit les attaques des notes détectées. Les couches dépendant des contrôleurs et les articulations par touche utilisent les réglages initiaux de l’instrument, sans suivre les événements du morceau MIDI. Pour les morceaux MIDI et les commandes qui évoluent pendant le jeu, utilisez SoundFont Player. Un instrument qui utilise des réglages non pris en charge ou dont des échantillons nécessaires sont manquants ne peut pas être chargé. Vérifiez ses fichiers ou choisissez un autre instrument.
- **Partage et sauvegardes** : Les préréglages, les liens partagés et les sauvegardes des données utilisateur enregistrent une référence à l’instrument, et non ses échantillons audio ; conservez vos dossiers SFZ d’origine pour les utiliser sur d’autres appareils.

## SoundFont Player

Jouez des morceaux MIDI avec une collection SoundFont SF2/SF3 ou un instrument SFZ, puis ajustez le son avec les effets placés après le lecteur. Le signal audio entrant reste inchangé ; le son de l’instrument s’y ajoute à cet endroit de la chaîne.

### Pour commencer

Ouvrez un fichier `.mid`, ajoutez SoundFont Player et ouvrez **SoundFont Library…**. Importez un fichier `.sf2` / `.sf3`, ou un instrument `.sfz` accompagné de ses échantillons, puis choisissez **Charger**. L’application de bureau lit les fichiers d’origine ; la version web stocke les fichiers importés sur votre appareil. Commencez avec **Instrument Level** à 0 dB et baissez-le si le résultat est trop fort.

Le format SF3 (.sf3) utilise des échantillons compressés ; l’importation et le choix des sons se font comme pour SF2. La lecture des fichiers SF3 nécessite un navigateur prenant en charge le décodage Vorbis. Sinon, choisissez un SoundFont SF2 ou utilisez un navigateur compatible.

**SoundFont Library…** permet d’importer, de rechercher, de charger et de supprimer des instruments. **Clear** décharge l’instrument sans le supprimer de la bibliothèque. Un instrument en cours d’utilisation ne peut pas être supprimé. Si vous changez d’instrument pendant un morceau, la chronologie MIDI continue pendant la préparation du nouvel instrument. Une fois prêt, celui-ci joue les événements MIDI suivants avec les réglages actuels des contrôleurs ; les notes précédentes ne sont pas rejouées.

### MIDI Mixer

L’onglet **MIDI Mixer** comporte une ligne pour chacun des 16 canaux MIDI. Une collection SF2/SF3 peut fournir un son différent à chaque canal ; les messages Bank Select et Program Change choisissent les sons, et le canal 10 utilise la banque de percussions par défaut. Les messages d’affectation des percussions GS/XG peuvent affecter d’autres canaux aux percussions ou les rétablir comme canaux mélodiques. Program Change choisit une batterie disponible dans le SoundFont chargé. Un instrument SFZ conserve ses propres correspondances.

Avant tout message Program Change, les canaux mélodiques utilisent le programme 1 de la banque 0 et le canal 10 utilise la batterie standard, si ces sons sont disponibles. Si le son demandé manque dans le SF2/SF3, les canaux mélodiques essaient le même programme dans la banque 0, puis le programme 1 de cette banque ; les canaux de percussions essaient la batterie standard. **Patch** affiche le son réellement utilisé. Si aucun de ces sons n’existe, le canal reste muet.

- **Patch** permet de choisir par son nom un son de la collection SF2/SF3 chargée pour ce canal. Les nouvelles notes utilisent le son choisi ; les notes déjà en cours conservent leur son d’origine.
- **Notes** allume les touches de chaque canal de Note On à Note Off. Les touches s’éteignent à Note Off même si la pédale de sustain ou la fin de note prolonge le son. **Voices** indique le nombre réel de voix d’échantillons encore actives, y compris pendant leur relâchement, par rapport à la limite **Max Voices**. Une note peut utiliser plusieurs voix d’échantillons.
- **Vol.** (CC7, 0–127) règle le niveau du canal. **EXP** (expression, CC11, 0–127) est un réglage de niveau supplémentaire. Les valeurs élevées augmentent le volume ; mettre l’un des deux à 0 coupe le son du canal.
- **Pan** (CC10, 0–127) déplace le son de gauche à droite, avec le centre à 64.
- **Rev.** (CC91) et **Cho.** (CC93) règlent les envois vers les effets de 0 à 127. Une valeur élevée envoie davantage de son vers l’effet correspondant ; le résultat audible dépend des effets pris en charge par l’instrument et de leurs réglages.
- **Level** affiche le niveau audio mesuré de chaque canal après Vol., EXP, Pan et Mute/Solo. La barre colorée suit le signal et le trait fin retient brièvement les crêtes récentes. Les retours communs de réverbération et de chorus ne sont pas inclus.
- **Mute** (**M**) coupe le son du canal. **Solo** (**S**) permet d’entendre uniquement les canaux dont Solo est activé. Utilisez-les pour comparer les parties d’un morceau.

Faites glisser les boutons rotatifs verticalement, ou sélectionnez-les et utilisez les touches fléchées. Les modifications du mixeur sont temporaires et ne sont pas enregistrées dans les préréglages, les liens partagés ou les sauvegardes. Les changements de Patch et de contrôleurs utilisent l’état MIDI entrant ; les messages suivants du même type peuvent les remplacer. Toutes les modifications du mixeur, y compris Mute et Solo, sont réinitialisées au morceau suivant ou à la réception d’un message de réinitialisation GM, GS ou XG.

Lorsqu’un message MIDI entrant modifie la valeur affichée de Patch ou d’un bouton rotatif, la commande s’illumine brièvement.

### Settings

L’onglet **Settings** contient les réglages de lecture qui sont enregistrés :

- **MIDI Channel** joue tous les canaux avec **All** par défaut, ou uniquement le canal choisi de **1 à 16**.
- **Instrument Level** règle le son généré de -60 à +12 dB (0 dB par défaut), sans modifier le signal entrant.
- **Max Voices** limite les voix d’échantillons simultanées, fins de notes comprises, de 1 à 1024 (64 par défaut). Une valeur élevée conserve davantage de notes superposées et demande plus de calcul.
- **Interpolation** choisit comment les échantillons de l’instrument sont rééchantillonnés. **FIR (64 taps)** utilise le filtre SF2/SF3 habituel ou respecte le réglage de qualité de l’instrument SFZ. **FIR (32 taps)** (par défaut) réduit le calcul pour les SF2/SF3 : il emploie 32 coefficients sans réduction de fréquence d’échantillonnage ; les filtres FIR s’allongent lorsque la lecture exige cette réduction pour limiter le repliement spectral. **Cubic (4 points)** utilise une interpolation légère, mais n’emploie pas de filtre passe-bas contre le repliement spectral ; une forte transposition vers l’aigu ou des échantillons riches en harmoniques aiguës peuvent donc produire des fréquences parasites. FIR et Cubic remplacent le réglage de qualité de l’instrument SFZ.

L’instrument sélectionné et ces réglages sont enregistrés normalement. Le volume et la coupure du son du lecteur agissent aussi sur l’instrument MIDI. Les presets, liens partagés et sauvegardes conservent sa référence, pas ses échantillons. Gardez les fichiers d’origine pour les utiliser sur un autre appareil.

**Color** change uniquement les couleurs du clavier. **Normal** utilise la couleur habituelle des graphiques, **Note Colors** reprend les couleurs des notes de Note Spectrogram et **Channel Colors** attribue une couleur différente à chaque canal MIDI. Le choix des couleurs n’est pas enregistré dans les presets.

### Instrument Details

Le résumé de l’instrument chargé indique, lorsque ces informations sont disponibles, le nombre d’échantillons et de sons, la taille des fichiers source et la mémoire de lecture. Les gros instruments lisent les échantillons nécessaires au fil de la lecture, sans charger toute la source en mémoire. La taille de la source peut donc dépasser largement la mémoire de lecture.

L’état indique la lecture des fichiers, la préparation de l’instrument ou du cache d’échantillons, la disponibilité pour jouer ou une erreur de chargement. La progression compare le travail effectué au total lorsque celui-ci est connu ; sinon, l’indicateur reste sans pourcentage déterminé. En cas d’échec, vérifiez que les fichiers d’origine sont disponibles ou choisissez un autre instrument. Même avec un préchargement limité, l’instrument reste utilisable, mais certaines notes peuvent démarrer en retard.

Dans **Settings**, ouvrez **Instrument Details** pour consulter les libellés fournis par l’instrument SFZ : touches, contrôleurs MIDI (**CC**), sorties, groupes, couches et articulations sélectionnées par touche. Ces libellés décrivent les correspondances de l’instrument ; ce ne sont pas des commandes supplémentaires. Lorsqu’une articulation nommée est active, **Keyswitch** indique celle qui est sélectionnée sur chaque canal. L’illustration fournie par l’instrument s’affiche également ; si plusieurs images sont déclarées, la dernière est utilisée.

### Entrée MIDI en direct

Le jeu MIDI en direct est disponible dans l’application de bureau et le lecteur web/PWA. Il n’est pas pris en charge dans l’application Android, où l’assignation des contrôleurs reste disponible.

Pour jouer depuis un clavier MIDI ou un port MIDI virtuel, fermez Music Player. Dans **Configuration audio**, choisissez **Actualiser les périphériques MIDI**, autorisez l’accès MIDI si nécessaire et sélectionnez le **Périphérique d’entrée MIDI**. Gardez un instrument chargé dans SoundFont Player. Music Player reste prioritaire tant qu’il est ouvert, même en pause ; choisissez **Aucun** pour arrêter l’entrée MIDI en direct. Sans instrument chargé, les données MIDI continuent d’arriver en silence. Une fois l’instrument chargé, les événements MIDI suivants deviennent audibles ; les notes passées ne sont pas rejouées.

### Instruments SFZ

Un instrument SFZ peut faire évoluer le volume, la hauteur et le timbre de chaque note, combiner filtres et effets intégrés, et définir les boucles d’échantillons ainsi que les sons de relâchement. Les déclenchements et effets synchronisés sur les temps suivent le tempo et la vitesse de lecture du morceau MIDI. Ces réglages appartiennent au fichier de l’instrument. Pour modifier vous-même le son d’ensemble, ajoutez des effets après SoundFont Player.

`amp_veltrack_random` permet à un instrument SFZ de faire varier aléatoirement la relation entre vélocité et volume à chaque nouvelle note. La valeur par défaut 0 n’ajoute aucune variation aléatoire. Le réglage modifie l’effet de la force du jeu sur le volume, pas la vélocité MIDI elle-même.

Les instruments volumineux lisent les échantillons au fur et à mesure des besoins, dans la limite de mémoire configurée. Importez le fichier de définition avec tous les échantillons nécessaires ; les échantillons incorporés et les fichiers utilisés uniquement par les effets de l’instrument sont également inclus. Si la vérification du contenu d’un échantillon échoue, restaurez le fichier d’origine ou importez à nouveau l’instrument. Un instrument à sorties séparées nécessite une configuration de sortie comportant assez de canaux.

Un fichier SFZ peut choisir le stockage des échantillons avec `load_mode` : 0 (par défaut) utilise la virgule flottante sur 32 bits, et 1 utilise du PCM sur 16 bits pour réduire la mémoire des échantillons. Les sources de plus haute précision perdent en précision en mode 16 bits. Dans EffeTune, `load_start` et `load_end` désignent la première et la dernière trame de l’échantillon source à conserver en mémoire, dernière trame comprise. Lorsqu’une plage est spécifiée, un début omis vaut 0 et une fin omise correspond à la fin de l’échantillon. Les données hors de cette plage sont lues à la demande ; cela ne raccourcit pas la lecture et ne décale pas les points de boucle. Si les deux bornes sont omises, la lecture des échantillons reste automatique.

La compatibilité dépend de l’instrument, et certains comportements propres à un fabricant ne sont pas disponibles. Consultez la [référence de compatibilité SFZ](../../../../specifications/sfz/README.md) pour connaître le profil pris en charge et ses limites. SoundFont Note Player prépare les instruments de la même manière, mais les notes détectées ne fournissent ni les changements de contrôleurs ni le tempo d’un morceau MIDI.
