---
title: "Autres Plugins - EffeTune"
description: "Plugins utilitaires supplémentaires incluant Oscillator pour générer des signaux audio."
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
  - Onde sinusoïdale pure pour les tons de référence
  - Onde carrée pour un contenu harmonique riche
  - Onde triangulaire pour des harmoniques plus douces
  - Onde en dents de scie pour des timbres brillants
  - Impulsions périodiques d'un échantillon pour vérifier la réponse impulsionnelle et la synchronisation
  - Bruit blanc pour les tests système
  - Bruit rose pour les mesures acoustiques
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

SFZ Note Player détecte les notes du signal entrant et les joue avec un instrument SFZ choisi. Vous pouvez suivre une chanson au piano ou superposer un autre timbre à l’enregistrement. L’estimation polyphonique peut manquer des notes ou en détecter en trop, surtout dans les passages denses.

La lecture atténue automatiquement les bruits de repliement lors des changements de hauteur ou de fréquence d’échantillonnage.

**Retrigger Drop** détermine quand une note peut être rejouée alors que sa détection se poursuit. Une fois la détection et la durée de maintien **Note Hold** terminées, une nouvelle détection à la même hauteur déclenche une nouvelle note.

### Guide de réglage du son

Dans Electron, cliquez sur **Select SFZ Folder…** et choisissez le dossier de l’instrument contenant ses fichiers SFZ, ses échantillons et ses fichiers inclus. Si plusieurs fichiers SFZ sont trouvés, choisissez un instrument et cliquez sur **Select**. Les fichiers de ce dossier sont lus directement à chaque chargement. **Remove** retire l’entrée de la liste sans supprimer les fichiers d’origine.

Dans la version web, cliquez sur **Import Folder…** et choisissez un dossier contenant le fichier SFZ et ses échantillons. S’il contient plusieurs SFZ, choisissez-en un et cliquez sur **Import**. **SFZ** sélectionne un instrument enregistré ; **Remove** supprime la banque sélectionnée du stockage local.

Commencez avec **Dry** à 0% et **Wet** à 100% pour entendre l’instrument seul, puis augmentez **Dry** pour ajouter le son d’origine. Réglez **Octave** sur -1 pour ajouter une couche plus grave, ou sur +1 pour une couche plus aiguë. Augmentez **Threshold** pour retenir moins de notes, avec une meilleure certitude. Limitez le registre avec **Lowest Note** et **Highest Note**. Si l’instrument joue toujours trop doucement ou trop fort, ajustez **Velocity 1 Level** et **Velocity 127 Level**, puis équilibrez le volume final avec **Output Gain**.

Activez uniquement **Lowest** pour suivre une ligne grave, ou uniquement **Highest** pour suivre une ligne aiguë.

Si une note tenue se répète sans que vous le souhaitiez, augmentez **Retrigger Drop** au-delà de sa valeur par défaut de 40 dB. À 96 dB, les répétitions dues aux variations de niveau sont fortement réduites. Diminuez-le pour mieux suivre les frappes répétées d’une même note.

Augmentez **Note Hold** pour prolonger les notes et relier les courtes interruptions de détection. À 100 ms, la note est maintenue 100 ms de plus avant l’envoi de la commande de fin de note.

Une note visible dans **Note Spectrogram** ne sera pas forcément jouée : elle doit aussi respecter les réglages **Threshold** et **Lowest Note / Highest Note**. Si les notes très graves ou très aiguës ne sont pas jouées, vérifiez la plage de notes et essayez de réduire **Threshold**. Vérifiez aussi que l’instrument SFZ couvre la note obtenue après l’application de **Octave**.

### Paramètres

- **SFZ** : Choisit un instrument par son nom. Une boîte de dialogue signale les problèmes lors de la première tentative de chargement après une sélection ou un import manuel ; aucun dialogue ne s’affiche lors des rechargements automatiques.
- **Threshold** : Confiance minimale de détection (0,01–1, 0,75 par défaut). L’augmenter réduit les notes indésirables, mais peut écarter des notes faibles ou peu distinctes.
- **Retrigger Drop (dB)** : Baisse nécessaire depuis le niveau maximal de la note entrante avant qu’elle puisse être rejouée (1–96 dB, 40 dB par défaut). Le niveau doit ensuite remonter d’au moins 6 dB. Une valeur élevée réduit les répétitions des notes tenues ; une valeur basse facilite le suivi des frappes répétées d’une même note.
- **Note Hold (ms)** : Durée supplémentaire de maintien après la fin de la détection, avant l’envoi de la commande de fin de note (0–100 ms, 50 ms par défaut). Si la même note réapparaît pendant cette durée, elle continue sans redémarrer. L’enveloppe de l’instrument et la durée de l’échantillon restent applicables.
- **Velocity 1 Level / Velocity 127 Level (dB)** : Niveaux des notes entrantes associés aux vélocités la plus faible et la plus forte (-60 dB / -10 dB par défaut). Les diminuer donne une vélocité plus élevée pour la même entrée. Leur écart détermine la répartition des niveaux dans la plage de vélocité.
- **Lowest Note / Highest Note** : Notes minimale et maximale à détecter dans l’entrée (A0–C8, MIDI 21–108 ; E1 et G6 par défaut), affichées sous forme de noms de notes. Les notes hors de cette plage sont ignorées.
- **Highest / Middle / Lowest** : Sélectionne la ligne grave, les notes intérieures et la ligne aiguë avant l’application d’Octave (toutes activées par défaut). Middle sélectionne les notes strictement comprises entre la plus grave et la plus aiguë actuellement détectées. Les lignes extérieures suivent l’évolution des hauteurs pour réduire les changements brusques ; une seule note détectée appartient aux deux. Les notes qui ne sont plus sélectionnées s’estompent naturellement. Désactivez les trois options pour arrêter les nouvelles notes.
- **Octave** : Décale les nouvelles notes du SFZ de -2 à +2 octaves, par pas d’une octave (valeur par défaut 0). Les valeurs négatives donnent des notes plus graves, les valeurs positives des notes plus aiguës. La plage de détection du signal entrant et les notes déjà en cours restent inchangées.
- **Max Voices** : Nombre maximal de voix d’échantillons simultanées. L’augmenter préserve davantage de notes et de fins de sons superposées, au prix d’une charge supérieure. Le diminuer remplace plus vite les voix anciennes.
- **Dry (%)** : Niveau du son d’origine (0–100%, valeur par défaut 20%). 0% le coupe ; 100% conserve son niveau d’origine.
- **Wet (%)** : Niveau de l’instrument SFZ (0–100%, valeur par défaut 100%). 0% le coupe ; 100% conserve son niveau intégral. Dry et Wet se règlent indépendamment.
- **Timing (ms)** : Ajuste le décalage entre le son d’origine et l’instrument SFZ (de -100 à +100 ms, valeur par défaut 0). Les valeurs négatives retardent davantage le son d’origine ; les valeurs positives retardent l’instrument. Réglez-le à l’écoute pour rapprocher le début de leurs notes.
- **Output Gain (dB)** : Niveau final du mélange.

Avec **Timing** à 0 ms, le son d’origine est retardé d’environ **80 ms** pour suivre le traitement et la correction de la détection des notes. Le cycle d’analyse et l’attaque de l’instrument peuvent encore entraîner de petits écarts de timing. Un **Note Spectrogram** actif placé en amont peut partager son analyse et réduire la charge si la plage de notes, le bus d’entrée et les canaux sont identiques et si le signal n’est pas modifié entre les deux.

Le chargement prend en charge les réglages SFZ courants de sélection, hauteur, volume, panoramique, boucles et enveloppe d’amplitude. Le fondu de relâchement dure au moins **0,2 seconde**, en conservant les durées plus longues définies dans le SFZ ; le son peut s’arrêter plus tôt si l’échantillon arrive à sa fin. Les conditions de plage des contrôleurs utilisent leurs valeurs initiales, avec priorité aux réglages `set_ccN` du SFZ. Par exemple, un piano dont la pédale est initialement relâchée utilise les échantillons correspondants sans ajouter la couche enregistrée avec la pédale enfoncée. L’articulation par défaut commandée par une touche est utilisée si l’instrument la précise. Les couches nécessitant un relâchement de note, des événements de contrôleur, un changement d’articulation pendant le jeu ou d’autres conditions non prises en charge sont omises. Les régions invalides sont écartées et le chargement des régions valides continue. Les autres réglages de son non pris en charge sont ignorés.

La limite par défaut est de **256 MiB**. Vous pouvez l’augmenter jusqu’à **1024 MiB (1 GiB)** avec **Limite de taille SFZ** dans **Configuration → Général**. Elle s’applique aux fichiers de l’instrument et aux échantillons décompressés pour la lecture, à partir de la prochaine sélection, importation ou chargement. Une limite plus élevée utilise davantage de mémoire. Si l’instrument complet dépasse la limite, le chargement essaie des échantillons représentatifs couvrant sa plage de notes jouables. La vélocité modifie toujours le volume, mais les variations entre couches de vélocité et échantillons alternés sont simplifiées. Si ces échantillons ne tiennent pas non plus, choisissez un instrument plus petit ou augmentez la limite. Dans la version web, réimportez le dossier d’origine après avoir augmenté la limite pour retrouver les échantillons omis. Les autres effets utilisant des échantillons partagent aussi la mémoire de traitement.

Les préréglages et les chaînes partagées ne contiennent qu’une référence à l’instrument, sans ses fichiers audio. Sur un autre appareil, sélectionnez le dossier local de l’instrument dans Electron ou importez son dossier dans la version web. Les fichiers audio SFZ ne sont pas inclus dans la sauvegarde des données utilisateur ; conservez vos dossiers SFZ d’origine.
