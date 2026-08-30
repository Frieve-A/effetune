# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

<div class="doc-primary-actions" aria-label="Actions principales">
  <a class="button button-primary" href="https://effetune.frieve.com/effetune.html">Ouvrir l'application web</a>
  <install class="button button-secondary"><a href="https://effetune.frieve.com/effetune.html">Installer la version PWA</a></install>
  <a class="button button-secondary" href="/dsp/">DSP Library</a>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune/releases/">Télécharger l'application de bureau</a>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune-mixwright/releases">Télécharger la version VST</a>
</div>

Un processeur d'effets audio en temps réel, conçu pour les passionnés de musique afin d'améliorer leur expérience d'écoute. EffeTune vous permet de traiter n'importe quelle source audio via divers effets de haute qualité, vous offrant la possibilité de personnaliser et de perfectionner votre expérience d'écoute en temps réel.

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## Vidéo d'introduction

[![YouTube Video](../../../images/video_thumbnail.jpg)](https://www.youtube.com/watch?v=--mtsy1t4HI)

## Concept

EffeTune a été créé pour les passionnés de musique souhaitant améliorer leur expérience d'écoute. Que vous diffusiez de la musique en streaming ou que vous écoutiez des supports physiques, EffeTune vous permet d'ajouter des effets de haute qualité pour personnaliser le son selon vos préférences exactes. Transformez votre ordinateur en un puissant processeur d'effets audio qui se place entre votre source audio et vos enceintes ou amplificateur.

Aucun mythe audiophile, juste de la science pure.

## Fonctionnalités

- Traitement audio en temps réel
- Interface glisser-déposer pour construire des chaînes d'effets
- Système d'effets extensible avec des effets catégorisés
- Visualisation audio en direct
- Pipeline audio pouvant être modifié en temps réel
- Traitement de fichiers audio hors ligne avec la chaîne d'effets actuelle
- Bibliothèque musicale pour parcourir les sous-dossiers locaux, les métadonnées et les listes de lecture
- Mesure et correction de la réponse en fréquence pour calibrer votre système
- Traitement et sortie multicanal
- Pavé numérique mobile avec séparateur décimal, changement de signe et plage autorisée pour les paramètres des effets
- Économie d’énergie dans les versions Web/PWA et de bureau, avec gestion configurable du silence et de la durée de conservation de l’entrée audio

## Guide de configuration

Avant d'utiliser EffeTune, vous devez configurer votre routage audio. Voici comment configurer différentes sources audio :

### Configuration du lecteur de fichiers musicaux

- Ouvrez l'application web EffeTune dans votre navigateur, ou lancez l'application de bureau EffeTune
- Ouvrez et lisez un fichier musical pour assurer une lecture correcte
   - Ouvrez un fichier musical et sélectionnez EffeTune comme application (application de bureau uniquement)
   - Ou sélectionnez **Ouvrir un fichier musical...** depuis le menu **Fichier** (application de bureau uniquement)
   - Ou faites glisser le fichier musical dans la fenêtre
- Pour une utilisation limitée au lecteur, sélectionnez Aucun (lecteur de fichiers musicaux uniquement) comme périphérique d'entrée dans Configuration audio afin de ne pas utiliser d'entrée audio en direct

### Configuration des services de streaming

Pour traiter l'audio des services de streaming (Spotify, YouTube Music, etc.) :

1. Prérequis :
   - Installer un périphérique audio virtuel (par exemple, VB Cable, Voice Meeter ou ASIO Link Tool)
   - Configurer votre service de streaming pour envoyer l'audio vers le périphérique audio virtuel

2. Configuration :
   - Ouvrez l'application web EffeTune dans votre navigateur, ou lancez l'application de bureau EffeTune
   - Sélectionnez le périphérique audio virtuel comme source d'entrée
     - Dans Chrome, la première fois que vous l'ouvrez, une boîte de dialogue apparaît vous demandant de sélectionner et d'autoriser l'entrée audio
     - Dans l'application de bureau, configurez-la en cliquant sur le bouton Config Audio en haut à droite de l'écran
   - Lancez la lecture de la musique depuis votre service de streaming
   - Vérifiez que l'audio circule via EffeTune
   - Pour des instructions de configuration plus détaillées, consultez la [FAQ](faq.md)

### Configuration des sources audio physiques

Pour utiliser EffeTune avec des lecteurs CD, lecteurs réseau ou autres sources physiques :

- Connectez votre interface audio à votre ordinateur
- Ouvrez l'application web EffeTune dans votre navigateur, ou lancez l'application de bureau EffeTune
- Sélectionnez votre interface audio comme source d'entrée et de sortie
   - Dans Chrome, la première fois que vous l'ouvrez, une boîte de dialogue apparaît vous demandant de sélectionner et d'autoriser l'entrée audio
   - Dans l'application de bureau, configurez-la en cliquant sur le bouton Config Audio en haut à droite de l'écran
- Votre interface audio fonctionne désormais comme un processeur multi-effets :
   * Entrée : Votre lecteur CD, lecteur réseau ou autre source audio
   * Traitement : Effets en temps réel via EffeTune
   * Sortie : Audio traité vers votre amplificateur ou vos enceintes

## Utilisation

### Paramètres de l'application

Ouvrez **Paramètres > Configuration...** pour choisir la langue, la vue au démarrage et le comportement du pipeline d'effets au démarrage. **Vue au démarrage :** peut être réglée sur **Effect Pipeline (par défaut)** ou **Bibliothèque musicale**. Si vous choisissez **Bibliothèque musicale**, utilisez la liste juste à côté pour choisir la section qui s'affichera en premier : **Morceaux**, **Albums**, **Artistes**, **Genres**, **Sous-dossiers**, **Dossiers** ou **Listes de lecture**.

Les versions de bureau compatibles peuvent aussi être pilotées par des applications OpenHome sur le même réseau local. Cette fonction est désactivée par défaut ; consultez [Télécommande OpenHome](music-library.md#télécommande-openhome-application-de-bureau) pour la configuration, l'accès réseau, la compatibilité et les limites.

### Rechercher de la musique dans la Bibliothèque musicale

1. Sur ordinateur, ouvrez-la avec le bouton **Bibliothèque musicale** dans l'en-tête ; sur mobile, avec l'onglet **Bibliothèque** ; dans l'application de bureau, avec **Affichage > Bibliothèque musicale**.
2. Sélectionnez **Ajouter un dossier de musique** pour indexer le dossier qui contient vos fichiers musicaux. Si une feuille CUE externe et les fichiers WAV ou FLAC qu'elle référence se trouvent dans le même dossier, l'ajout de ce dossier à la Bibliothèque musicale permet de traiter l'album morceau par morceau.
3. Parcourez les **Morceaux**, **Albums**, **Artistes**, **Genres**, **Sous-dossiers**, **Dossiers**, **Ajouts récents** et **Listes de lecture**, et utilisez **Rechercher dans la bibliothèque** pour rechercher dans tout le catalogue. La vue **Sous-dossiers** classe les morceaux selon leur chemin au sein de chaque dossier de musique indexé, tandis que la vue **Dossiers** sert à gérer ces dossiers racine.
4. Les morceaux trouvés peuvent être lus via le pipeline d'effets actuel. Utilisez **Lire ensuite**, **Ajouter à la file** et **Ajouter à une liste** pour gérer l'ordre de lecture et les listes de lecture.
5. Après avoir modifié des fichiers, utilisez **Analyser à nouveau** ; si les autorisations du navigateur ou du dossier expirent, utilisez **Reconnecter**.
   - [Détails de la Bibliothèque musicale](music-library.md)

Dans les dispositions ordinateur et mobile, lorsqu’une recherche de morceaux ou la fiche d’un album, d’un artiste, d’un genre, d’un sous-dossier ou d’une liste de lecture contient 300 morceaux ou moins, tous sont sélectionnés par défaut. À partir de 301 morceaux, aucune sélection automatique n’est effectuée. Sur mobile, la sélection automatique ne modifie que l’état de sélection. Seul un appui long sur un morceau ouvre le mode sélection et affiche les cases à cocher, **Tout sélectionner** et **Tout désélectionner** ; sélectionner ou désélectionner des morceaux n’ouvre ni ne ferme ce mode, et les actions habituelles des lignes restent disponibles.

Les navigateurs Chromium sur ordinateur peuvent conserver l'accès aux dossiers musicaux sélectionnés entre les sessions. Dans Safari, Firefox, les navigateurs mobiles et les autres environnements sans accès persistant aux dossiers, sélectionnez de nouveau le dossier ou les fichiers après chaque rechargement ; EffeTune les rattache au catalogue existant.

Les grandes collections sont chargées progressivement depuis le stockage ; la vitesse d'analyse et de chargement dépend de l'appareil, de la collection et de la mémoire disponible. Un défilement très rapide peut afficher brièvement des lignes vides pendant le chargement des morceaux suivants, surtout avec un stockage lent.

### Construction de votre chaîne d'effets

1. Les effets disponibles sont listés sur le côté gauche de l'écran
   - Utilisez le bouton de recherche à côté de "Available Effects" pour filtrer les effets
   - Tapez n'importe quel texte pour trouver des effets par nom ou catégorie
   - Appuyez sur ESC pour effacer la recherche
2. Glissez-déposez les effets de la liste vers la zone de l'Effect Pipeline
3. Les effets sont traités dans l'ordre du haut vers le bas
4. Faites glisser la poignée (⋮) ou cliquez sur les boutons ▲▼ pour réorganiser les effets
   - Pour les effets Section : Maj+clic sur les boutons ▲▼ pour déplacer des sections entières (d'une Section à la Section suivante, début de pipeline, ou fin de pipeline)
5. Cliquez sur le nom d'un effet pour développer/réduire ses paramètres
   - Maj+Clic sur un effet Section pour développer/réduire tous les effets dans cette section
   - Maj+Clic sur d'autres effets pour développer/réduire tous les effets sauf la catégorie Analyzer
   - Ctrl+Clic pour développer/réduire tous les effets
6. Utilisez le bouton ON pour contourner les effets individuels
7. Cliquez sur le bouton ? pour ouvrir sa documentation détaillée dans un nouvel onglet
8. Supprimez les effets en utilisant le bouton ×
   - Pour les effets Section : Maj+clic sur le bouton × pour supprimer des sections entières  
9. Cliquez sur le bouton de routage pour définir les canaux à traiter et les bus d'entrée et de sortie  
   - [Plus d'informations sur les fonctions de bus](bus-function.md)
   - [Contrôler les effets par MIDI, manette ou clavier](controller-mapping.md)
10. Cliquez sur le bouton Préréglages d’effet de chaque effet pour enregistrer ou appliquer des réglages pour cet effet uniquement
11. Pour régler précisément un curseur, maintenez la touche Maj enfoncée pendant que vous le faites glisser ; la valeur change alors d'une unité minimale à la fois

### Utilisation des préréglages

Cliquez sur le bouton **Préréglages de chaîne d’effets** dans l’en-tête de l’Effect Pipeline pour ouvrir la boîte de dialogue des presets.

1. Chargez un preset en le sélectionnant dans la liste des presets enregistrés. La chaîne complète est restaurée, y compris l’ordre des effets, les réglages et les états ON/OFF.
2. Enregistrez la chaîne actuelle en saisissant un nom puis en choisissant Enregistrer.
3. Renommez un preset enregistré avec le bouton de renommage de sa ligne.
4. Sélectionnez un ou plusieurs presets enregistrés, puis choisissez Supprimer la sélection et confirmez pour les retirer.
5. Appuyez sur Ctrl+S (ou Cmd+S sous macOS) pour ouvrir la boîte de dialogue avec le nom du preset actuel prêt à être modifié.

Chaque effet possède également son propre bouton Préréglages d’effet. Il ouvre les préréglages système lorsque l’effet en fournit et permet d’enregistrer, renommer, charger ou supprimer vos réglages pour cet effet. Les préréglages d’effet ne modifient que les paramètres de cet effet ; ils ne modifient ni son état ON/OFF ni son routage.

L’importation, l’exportation et le partage de fichiers `.effetune_preset` restent dédiés aux presets de chaîne d’effets complète.

### Utilisation de la fonction Section

1. Utilisation de l'effet Section :
   - Ajouter un effet Section au début d'un groupe d'effets
   - Entrer un nom descriptif dans le champ Comment
   - Basculer la Section ON/OFF contourne ou rétablit cette section tout en conservant l'état ON/OFF propre à chaque effet
   - Utiliser plusieurs effets Section pour organiser votre chaîne d'effets en groupes logiques
   - [En savoir plus sur les effets de contrôle](plugins/control.md)

### Utilisation des fonctions Pipeline AB

1. Aperçu du Pipeline AB :
   - EffeTune peut maintenir deux pipelines d'effets séparés : Pipeline A et Pipeline B
   - Au démarrage, seul le Pipeline A est chargé ; le Pipeline B est créé si nécessaire
   - Toutes les opérations de traitement, sauvegarde, chargement et édition fonctionnent sur le pipeline actuellement sélectionné

2. Bouton de basculement AB :
   - Situé à droite de l'en-tête Effect Pipeline
   - Affiche "A" par défaut (Pipeline A actif)
   - Cliquez pour basculer entre Pipeline A et Pipeline B
   - Si le Pipeline B n'existe pas lors du basculement, les paramètres du Pipeline A sont copiés vers le Pipeline B

3. Menu AB (Bouton déroulant) :
   - Situé à droite du bouton de basculement AB
   - "A → B" : Copie les paramètres du Pipeline A vers le Pipeline B et bascule vers le Pipeline B
   - "B → A" : Copie les paramètres du Pipeline B vers le Pipeline A et bascule vers le Pipeline A

4. Double Blind Test :
   - Comparez Pipeline A et Pipeline B à l'écoute sans savoir lequel est en cours de lecture
   - Lancez un ABX Test pour vérifier si vous pouvez réellement distinguer les deux pipelines, ou un A/B Preference Test pour savoir lequel vous préférez, avec une vérification de la significativité statistique
   - Ouvrez-le depuis le menu de pipeline **▼** à droite du bouton de basculement AB (également disponible depuis le menu **Fichier** dans l'application de bureau)
   - [En savoir plus sur Double Blind Test](double-blind-test.md)

### Sélection d'effets et raccourcis clavier

1. Méthodes de sélection des effets :
   - Cliquez sur les en-têtes d'effet pour sélectionner des effets individuels
   - Maintenez Ctrl en cliquant pour sélectionner plusieurs effets
   - Cliquez sur un espace vide dans la zone Pipeline pour désélectionner tous les effets

2. Raccourcis clavier :
   - Ctrl + Z: Annuler
   - Ctrl + Y: Rétablir
   - Ctrl + S: Enregistrer le pipeline actuel
   - Ctrl + Shift + S: Enregistrer le pipeline actuel sous
   - Ctrl + X: Couper les effets sélectionnés
   - Ctrl + C: Copier les effets sélectionnés
   - Ctrl + V: Coller les effets depuis le presse-papiers
   - Ctrl + F: Rechercher des effets
   - Ctrl + A: Sélectionner tous les effets du pipeline
   - Delete: Supprimer les effets sélectionnés
   - ESC: Désélectionner tous les effets
   - T: Basculer entre Pipeline A et Pipeline B
   - A: Basculer vers Pipeline A
   - B: Basculer vers Pipeline B

3. Raccourcis clavier (lors de l'utilisation du lecteur) :
   - Space : Lecture/Pause
   - Ctrl + → ou N : Piste suivante
   - Ctrl + ← ou P : Piste précédente
   - Shift + → ou F ou . : Avancer de 10 secondes
   - Shift + ← ou R ou , : Reculer de 10 secondes
   - Ctrl + M : Activer/Désactiver la répétition
   - Ctrl + H : Activer/Désactiver le mode aléatoire
   - T : Basculer entre Pipeline A et Pipeline B
   - A : Basculer vers Pipeline A
   - B : Basculer vers Pipeline B

### Traitement des fichiers audio

1. Zone de dépôt ou de spécification de fichiers :
   - Une zone de dépôt dédiée est toujours visible sous l'Effect Pipeline
   - Prend en charge un ou plusieurs fichiers audio
   - Les fichiers sont traités en utilisant les paramètres actuels de la Pipeline
   - Les effets sont traités à la fréquence d’échantillonnage de la Pipeline ; la conversion de sortie a lieu ensuite

2. État du traitement :
   - La barre de progression affiche l'état actuel du traitement
   - Le temps de traitement dépend de la taille du fichier et de la complexité de la chaîne d'effets

3. Options de téléchargement ou de sauvegarde :
   - Dans **Settings > Config > Sortie de fichier hors ligne**, choisissez WAV ou FLAC, ainsi que la fréquence d’échantillonnage et la qualité. Pour FLAC, choisissez un encodage sans perte sur 16 ou 24 bits. Le réglage initial est WAV 96 kHz en PCM 24 bits
   - Chaque format a sa propre limite de canaux. Si un fichier dépasse celle du format choisi, EffeTune s’arrête et indique la marche à suivre sans effectuer de mixage automatique
   - Pour plusieurs fichiers, sélectionnez un dossier de sortie avant le traitement ; chaque fichier y est enregistré directement à la fin de son traitement
   - Sur les navigateurs anciens sans sélection de dossier, plusieurs fichiers sont regroupés dans un ZIP à télécharger

### Partage de chaînes d'effets

Vous pouvez partager la configuration de votre chaîne d'effets avec d'autres utilisateurs :
1. Après avoir configuré la chaîne d'effets souhaitée, cliquez sur le bouton "Share" dans le coin supérieur droit de la zone Effect Pipeline
2. L'URL sera automatiquement copiée dans votre presse-papiers
3. Partagez l'URL copiée avec d'autres - ils pourront recréer exactement votre chaîne d'effets en l'ouvrant
4. Dans l'application web, tous les paramètres des effets sont stockés dans l'URL, ce qui les rend faciles à sauvegarder et à partager
5. Dans la version application de bureau, exportez les paramètres vers un fichier effetune_preset depuis le menu **Fichier**
6. Partagez le fichier effetune_preset exporté. Le fichier effetune_preset peut également être chargé en le faisant glisser dans la fenêtre de l'application web

### Réinitialisation audio

Si vous rencontrez des problèmes audio (coupures, interférences) :
1. Dans l'application web, cliquez sur le bouton "Reset Audio" dans le coin supérieur gauche, ou dans l'application de bureau, sélectionnez **Recharger** dans le menu **Affichage**
2. La pipeline audio sera reconstruite automatiquement
3. La configuration de votre chaîne d'effets sera préservée

### Mesure et correction de la réponse en fréquence

Pour mesurer la réponse en fréquence de votre système audio et créer une correction EQ plate :
1. Pour la version web, lancez l'[outil de mesure de la réponse en fréquence](https://effetune.frieve.com/features/measurement/measurement.html). Pour la version application, sélectionnez **Mesure de la réponse en fréquence** dans le menu **Paramètres**.
2. Suivez l'assistant pour configurer votre microphone de mesure et votre périphérique de sortie.
3. Mesurez la réponse en fréquence de votre système à une ou plusieurs positions d'écoute.
4. Générez une correction EQ paramétrique qui peut être importée directement dans EffeTune.
5. Appliquez la correction pour obtenir une reproduction sonore plus précise et plus neutre.

Pour un système multicanal, sélectionnez **Tous les canaux** pour mesurer toutes les sorties ensemble, ou les éléments individuels de **Canal de sortie** pour les mesurer un par un. Dans **Paramètres avancés**, choisissez **Désactivé**, **Identique pour tous les canaux** ou **Par canal** pour la bande passante du balayage. Avec **Par canal**, utilisez **Canal à configurer** pour régler la plage de fréquences de chaque canal de sortie sélectionné. Pendant le réglage du niveau, le **Mode de canal** démarre sur **Rotation automatique** ; choisissez un canal de signal de test ou **Manuel** si nécessaire.

Si vous disposez déjà d’un fichier WAV de réponse impulsionnelle, choisissez **Importer** et sélectionnez-le. EffeTune enregistre chaque canal du WAV comme résultat de mesure, afin que vous puissiez le sélectionner dans Room EQ et dans toute autre fonction utilisant les mesures enregistrées.

Pour retirer la réponse propre à l’interface audio, reliez directement sa sortie à son entrée et enregistrez cette boucle comme une mesure normale sans étalonnage, avec une réponse impulsionnelle. Lors de la mesure suivante, choisissez ce point dans **Étalonnage de l’interface audio**. Utilisez la même interface, les mêmes canaux d’entrée et de sortie, la même fréquence d’échantillonnage et les mêmes gains, sans modifier les gains après la mesure en boucle. Choisissez **Aucun (sans étalonnage)** pour effectuer une mesure sans cette correction.

Les mesures contenant des données de réponse impulsionnelle affichent un graphique **Réponse impulsionnelle** normalisé dans les résultats. La vue initiale couvre 0 à 10 ms à partir du début détecté. Utilisez la molette ou les boutons pour modifier l’échelle temporelle, puis faites glisser le graphique ou utilisez le curseur pour vous déplacer. La sélection d’un point met le graphique à jour ; **Tous (moyenne)** affiche le premier point dont la réponse impulsionnelle a été enregistrée et l’identifie au-dessus du graphique. Utilisez **Exporter la réponse impulsionnelle (WAV)** sous le graphique pour enregistrer la réponse complète et non normalisée du point affiché dans un fichier WAV mono à virgule flottante 32 bits, à la fréquence d’échantillonnage de la mesure.

Pour examiner la fréquence, la phase, le retard de groupe minimal, le retard de groupe excédentaire et l'impulsion du pipeline actif, avec jusqu'à quatre sorties et des réponses de haut-parleurs enregistrées, consultez le [guide de Pipeline Analyzer](pipeline-analyzer.md).

## Combinaisons d'effets courantes

Voici quelques combinaisons d'effets populaires pour améliorer votre expérience d'écoute :

### Amélioration pour écouteurs
1. Stereo Blend -> RS Reverb
   - Stereo Blend : Ajuste la largeur stéréo pour le confort (60-100%)
   - RS Reverb : Ajoute une ambiance de pièce subtile (mélange 10-20%)
   - Résultat : Une écoute au casque plus naturelle et moins fatigante

### Simulation vinyle
1. Wow Flutter -> Noise Blender -> Saturation
   - Wow Flutter : Ajoute une légère variation de hauteur
   - Noise Blender : Crée une ambiance similaire à celle du vinyle
   - Saturation : Ajoute une chaleur analogique
   - Résultat : Une expérience authentique de disque vinyle

### Style radio FM
1. Multiband Compressor -> Stereo Blend
   - Multiband Compressor : Crée ce son "radio"
   - Stereo Blend : Ajuste la largeur stéréo pour le confort (100-150%)
   - Résultat : Un son poli façon radio FM

### Caractère Lo-Fi
1. Bit Crusher -> Simple Jitter -> RS Reverb
   - Bit Crusher : Réduit la profondeur de bits pour une sensation rétro
   - Simple Jitter : Ajoute des imperfections numériques
   - RS Reverb : Crée un espace atmosphérique
   - Résultat : Une esthétique lo-fi classique

## Dépannage et FAQ

En cas de problème, consultez la [FAQ](faq.md).
Si le souci persiste, signalez-le sur [GitHub Issues](https://github.com/Frieve-A/effetune/issues).

## Effets disponibles

| Catégorie | Effet             | Description                                                              | Documentation                                           |
| --------- | ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| Analyzer  | Level Meter       | Affiche le niveau audio avec maintien du pic                             | [Détails](plugins/analyzer.md#level-meter)              |
| Analyzer  | Oscilloscope      | Visualisation en temps réel de la forme d'onde                           | [Détails](plugins/analyzer.md#oscilloscope)             |
| Analyzer  | Spectrogram       | Montre l'évolution du spectre de fréquences au fil du temps              | [Détails](plugins/analyzer.md#spectrogram)              |
| Analyzer  | Spectrum Analyzer | Montre en temps réel l'intensité des graves, médiums et aigus            | [Détails](plugins/analyzer.md#spectrum-analyzer)        |
| Analyzer  | Stereo Meter      | Visualise l'équilibre stéréo et la corrélation entre canaux              | [Détails](plugins/analyzer.md#stereo-meter)             |
| Basics    | Channel Divider   | Divise le signal stéréo en bandes de fréquences et envoie chaque bande vers des paires de sorties stéréo séparées | [Détails](plugins/basics.md#channel-divider)            |
| Basics    | DC Offset         | Ajustement du décalage continu                                            | [Détails](plugins/basics.md#dc-offset)                  |
| Basics    | FIR Crossover     | Filtre répartiteur FIR qui achemine des bandes à forte pente vers des paires de sorties stéréo | [Détails](plugins/basics.md#fir-crossover) |
| Basics    | Matrix            | Routage et mixage des canaux audio avec un contrôle flexible             | [Détails](plugins/basics.md#matrix)                     |
| Basics    | MultiChannel Panel| Panneau de contrôle pour plusieurs canaux avec volume, mute, solo et délai | [Détails](plugins/basics.md#multichannel-panel)        |
| Basics    | Mute              | Silence complètement le signal audio                                     | [Détails](plugins/basics.md#mute)                       |
| Basics    | Polarity Inversion| Inversion de la polarité du signal                                       | [Détails](plugins/basics.md#polarity-inversion)         |
| Basics    | Stereo Balance    | Contrôle de l'équilibre des canaux stéréo                                | [Détails](plugins/basics.md#stereo-balance)             |
| Basics    | Volume            | Contrôle basique du volume                                               | [Détails](plugins/basics.md#volume)                     |
| Delay     | Delay          | Effet de retard standard | [Détails](plugins/delay.md#delay) |
| Delay     | Time Alignment | Réglage fin du timing de lecture pour aligner les enceintes et la position d'écoute | [Détails](plugins/delay.md#time-alignment) |
| Dynamics  | Auto Leveler | Réglage automatique du volume basé sur la mesure LUFS pour une expérience d'écoute cohérente | [Détails](plugins/dynamics.md#auto-leveler) |
| Dynamics  | Brickwall Limiter | Limite les crêtes du signal pour éviter l'écrêtage numérique | [Détails](plugins/dynamics.md#brickwall-limiter) |
| Dynamics  | Compressor | Lisse les passages soudainement forts pour une écoute plus confortable | [Détails](plugins/dynamics.md#compressor) |
| Dynamics  | Expander | Restaure le contraste dynamique en rendant plus discrets les sons calmes sous le seuil | [Détails](plugins/dynamics.md#expander) |
| Dynamics  | Gate | Réduit les sons de faible niveau pendant les silences ou les passages calmes | [Détails](plugins/dynamics.md#gate) |
| Dynamics  | Multiband Compressor | Équilibrage de volume 5 bandes pour un son d'écoute stable, proche de la radio | [Détails](plugins/dynamics.md#multiband-compressor) |
| Dynamics  | Multiband Expander | Expanseur 5 bandes pour retrouver un contraste naturel dans les enregistrements trop plats | [Détails](plugins/dynamics.md#multiband-expander) |
| Dynamics  | Multiband Transient | Façonne séparément l'attaque et le sustain dans les graves, médiums et aigus | [Détails](plugins/dynamics.md#multiband-transient) |
| Dynamics  | Power Amp Sag | Simule l'affaissement de tension des amplificateurs de puissance sous fortes charges | [Détails](plugins/dynamics.md#power-amp-sag) |
| Dynamics  | Transient Shaper | Ajuste le punch et le corps de la musique en modelant attaques et sustain | [Détails](plugins/dynamics.md#transient-shaper) |
| EQ        | 15Band GEQ | Égaliseur graphique 15 bandes | [Détails](plugins/eq.md#15band-geq) |
| EQ        | 15Band PEQ | Égaliseur paramétrique 15 bandes pour des réglages d'écoute détaillés | [Détails](plugins/eq.md#15band-peq) |
| EQ        | 5Band Dynamic EQ | Égaliseur dynamique 5 bandes avec ajustement des fréquences basé sur un seuil | [Détails](plugins/eq.md#5band-dynamic-eq) |
| EQ        | 5Band FIR PEQ | Égaliseur paramétrique 5 bandes à filtrage FIR Minimum Phase ou Linear Phase | [Détails](plugins/eq.md#5band-fir-peq) |
| EQ        | 5Band PEQ | Égaliseur 5 bandes flexible pour modeler graves, médiums et aigus | [Détails](plugins/eq.md#5band-peq) |
| EQ        | Band Pass Filter | Concentrez-vous sur des fréquences spécifiques | [Détails](plugins/eq.md#band-pass-filter) |
| EQ        | Comb Filter | Ajoute une coloration déphasée, creuse ou métallique | [Détails](plugins/eq.md#comb-filter) |
| EQ        | Earphone Cable Sim | Permet de vérifier à quel point les variations de réponse en fréquence dues aux câbles d'écouteurs ordinaires restent généralement faibles | [Détails](plugins/eq.md#earphone-cable-sim) |
| EQ        | Group Delay EQ | Règle le retard de chaque bande de fréquence sans modifier le timbre | [Détails](plugins/eq.md#group-delay-eq) |
| EQ        | Group Delay PEQ | Contrôle paramétrique à cinq bandes du retard par fréquence sans modifier le timbre | [Détails](plugins/eq.md#group-delay-peq) |
| EQ        | Hi Pass Filter | Élimine avec précision les basses indésirables | [Détails](plugins/eq.md#hi-pass-filter) |
| EQ        | Lo Pass Filter | Élimine avec précision les hautes fréquences indésirables | [Détails](plugins/eq.md#lo-pass-filter) |
| EQ        | Loudness Equalizer | Correction de l'équilibre fréquentiel pour l'écoute à faible volume | [Détails](plugins/eq.md#loudness-equalizer) |
| EQ        | Narrow Range | Combinaison de filtres passe-haut et passe-bas | [Détails](plugins/eq.md#narrow-range) |
| EQ        | Room EQ      | Correction FIR fondée sur des mesures acoustiques enregistrées | [Détails](plugins/eq.md#room-eq) |
| EQ        | Tilt EQ      | Égaliseur incliné pour un façonnage rapide du son | [Détails](plugins/eq.md#tilt-eq) |
| EQ        | Tone Control | Contrôle tonal en trois bandes | [Détails](plugins/eq.md#tone-control) |
| Lo-Fi     | AM Radio Simulator | Fait passer la musique dans une chaîne de diffusion et de réception AM modélisée | [Détails](plugins/lofi.md#am-radio-simulator) |
| Lo-Fi     | Bit Crusher | Réduction de la profondeur de bits et effet de maintien d'ordre zéro | [Détails](plugins/lofi.md#bit-crusher) |
| Lo-Fi     | Cassette Artifacts | Enregistre la musique sur une cassette compacte modélisée et la relit sur une platine Type I/II/IV avec Dolby B/C | [Détails](plugins/lofi.md#cassette-artifacts) |
| Lo-Fi     | Digital Error Emulator | Simule diverses erreurs de transmission audio numérique et caractéristiques d'équipements numériques vintage | [Détails](plugins/lofi.md#digital-error-emulator) |
| Lo-Fi     | DSD64 IMD Simulator | Simule la distorsion d'intermodulation audible issue du bruit ultrasonique du DSD64 | [Détails](plugins/lofi.md#dsd64-imd-simulator) |
| Lo-Fi     | FM Radio Simulator | Fait passer la musique par une chaîne d'émission et de réception FM simulée physiquement | [Détails](plugins/lofi.md#fm-radio-simulator) |
| Lo-Fi     | G.726 Simulator | Simule un aller-retour d’encodage/décodage vocal ITU-T G.726 avec une liaison radio bruitée facultative | [Détails](plugins/lofi.md#g726-simulator) |
| Lo-Fi     | GSM-FR Simulator | Simule un aller-retour d’encodage/décodage vocal GSM-FR à 13 kbit/s sur liaison radio avec masquage des pertes de trames | [Détails](plugins/lofi.md#gsm-fr-simulator) |
| Lo-Fi     | Hum Generator | Ajoute une ambiance de ronflement électrique 50/60 Hz contrôlable pour une écoute vintage/lo-fi | [Détails](plugins/lofi.md#hum-generator) |
| Lo-Fi     | MD Simulator | Simule un aller-retour d'encodage/décodage ATRAC de l'ère MiniDisc | [Détails](plugins/lofi.md#md-simulator) |
| Lo-Fi     | MP3 Codec Simulator | Simule un aller-retour propre d’encodage/décodage MPEG Layer III à faible débit | [Détails](plugins/lofi.md#mp3-codec-simulator) |
| Lo-Fi     | Noise Blender | Ajoute une texture de bruit de fond réglable pour une ambiance lo-fi | [Détails](plugins/lofi.md#noise-blender) |
| Lo-Fi     | SBC Codec Simulator | Reproduit un aller-retour d'encodage/décodage Bluetooth A2DP SBC avec pertes de paquets et masquage facultatifs | [Détails](plugins/lofi.md#sbc-codec-simulator) |
| Lo-Fi     | Simple Jitter | Simulation de gigue numérique | [Détails](plugins/lofi.md#simple-jitter) |
| Lo-Fi     | SW Radio Simulator | Fait passer la musique dans une chaîne modélisée d'émission en ondes courtes, de propagation ionosphérique et de réception | [Détails](plugins/lofi.md#sw-radio-simulator) |
| Lo-Fi     | Tape Artifacts | Enregistre la musique sur une bande magnétique à bobines modélisée puis la relit | [Détails](plugins/lofi.md#tape-artifacts) |
| Lo-Fi     | Vinyl Artifacts | Ajoute des pops, crépitements, souffle, rumble et fuite de bruit stéréo façon vinyle | [Détails](plugins/lofi.md#vinyl-artifacts) |
| Lo-Fi     | Vinyl Simulator | Grave le signal dans un sillon modélisé puis le lit avec un modèle physique de pointe | [Détails](plugins/lofi.md#vinyl-simulator) |
| Modulation | Auto Filter | Balaye un filtre résonant avec un LFO ou l'enveloppe du signal | [Détails](plugins/modulation.md#auto-filter) |
| Modulation | Auto Pan | Déplace doucement le niveau de chaque paire stéréo dans l'espace | [Détails](plugins/modulation.md#auto-pan) |
| Modulation | Chorus | Ajoute chorus, ensemble, flanger ou vibrato par retards mobiles | [Détails](plugins/modulation.md#chorus) |
| Modulation | Doppler Distortion | Simule les changements naturels et dynamiques du son causés par de subtiles oscillations du cône de haut-parleur | [Détails](plugins/modulation.md#doppler-distortion) |
| Modulation | Frequency Shifter | Translate les fréquences, applique une modulation en anneau ou un décalage barber-pole | [Détails](plugins/modulation.md#frequency-shifter) |
| Modulation | Phaser | Crée des pics et creux mobiles par balayage classique ou barber-pole | [Détails](plugins/modulation.md#phaser) |
| Modulation | Pitch Shifter | Monte ou baisse la hauteur de la musique sans changer le tempo | [Détails](plugins/modulation.md#pitch-shifter) |
| Modulation | Pitch Shifter HQ | Monte ou baisse la hauteur avec moins d'artefacts de phase pour une écoute attentive | [Détails](plugins/modulation.md#pitch-shifter-hq) |
| Modulation | Rotary Speaker | Combine les mouvements indépendants de la trompe et du tambour | [Détails](plugins/modulation.md#rotary-speaker) |
| Modulation | Tremolo | Effet de modulation basé sur le volume | [Détails](plugins/modulation.md#tremolo) |
| Modulation | Wow Flutter | Ajoute un léger flottement de hauteur façon bande ou disque pour une couleur vintage | [Détails](plugins/modulation.md#wow-flutter) |
| Resonator | Horn Resonator | Simulation de résonance de cornet avec dimensions personnalisables | [Détails](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | Résonance de pavillon plus douce pour une couleur d'écoute naturelle | [Détails](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | Effet de résonance fréquentielle avec jusqu'à 5 résonateurs | [Détails](plugins/resonator.md#modal-resonator) |
| Reverb    | Dattorro Plate Reverb | Reverb à plaque classique basé sur l'algorithme Dattorro | [Détails](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb    | FDN Reverb | Réverbération à réseau de délais avec rétroaction produisant des textures riches et denses | [Détails](plugins/reverb.md#fdn-reverb) |
| Reverb    | IR Reverb | Réverbération à convolution avec des réponses impulsionnelles de salles et d'équipements | [Détails](plugins/reverb.md#ir-reverb) |
| Reverb    | RS Reverb | Réverbération à dispersion aléatoire avec diffusion naturelle | [Détails](plugins/reverb.md#rs-reverb) |
| Saturation| Bandwidth Extender | Génère du contenu haute fréquence au-dessus d'une coupure détectée ou spécifiée | [Détails](plugins/saturation.md#bandwidth-extender) |
| Saturation| Dynamic Saturation | Simule le déplacement non linéaire des cônes de haut-parleur | [Détails](plugins/saturation.md#dynamic-saturation) |
| Saturation| Exciter | Ajoute du contenu harmonique pour améliorer la clarté et la présence | [Détails](plugins/saturation.md#exciter) |
| Saturation| Hard Clipping | Effet d'écrêtage dur numérique | [Détails](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | Ajoute du caractère avec une distorsion harmonique réglable du 2e au 5e ordre | [Détails](plugins/saturation.md#harmonic-distortion) |
| Saturation| Multiband Saturation | Ajoute séparément chaleur ou mordant aux graves, médiums et aigus | [Détails](plugins/saturation.md#multiband-saturation) |
| Saturation| Saturation | Ajoute richesse et caractère chaleureux façon analogique | [Détails](plugins/saturation.md#saturation) |
| Saturation| Sub Synth | Mélange un signal de basse fréquence filtré pour renforcer les graves | [Détails](plugins/saturation.md#sub-synth) |
| Saturation| Tube Simulator | Modélise des étages ligne à lampes et des amplificateurs de puissance push-pull ou à triode single-ended 300B/2A3 | [Détails](plugins/saturation.md#tube-simulator) |
| Spatial   | Crossfeed Filter | Filtre de crossfeed pour casques pour imagerie stéréo naturelle | [Détails](plugins/spatial.md#crossfeed-filter) |
| Spatial   | MS Matrix | Convertit entre stéréo et Mid/Side pour ajuster centre et ambiance | [Détails](plugins/spatial.md#ms-matrix) |
| Spatial   | Multiband Balance | Contrôle de l'équilibre stéréo dépendant de la fréquence sur 5 bandes | [Détails](plugins/spatial.md#multiband-balance) |
| Spatial   | Phase Select EQ | Accentue ou atténue les composantes fréquentielles selon la différence de phase G/D et Balance | [Détails](plugins/spatial.md#phase-select-eq) |
| Spatial   | Stereo Blend | Contrôle la largeur stéréo du mono à la stéréo élargie | [Détails](plugins/spatial.md#stereo-blend) |
| Others    | Oscillator | Générateur de sons de test et de bruit pour vérifier enceintes/casques | [Détails](plugins/others.md#oscillator) |
| Control   | Section | Regroupe les effets pour contourner ou rétablir toute une section | [Détails](plugins/control.md) |

## Informations techniques

### Compatibilité des navigateurs

Frieve EffeTune a été testé et vérifié pour fonctionner sur Google Chrome. L'application nécessite un navigateur moderne avec le support de :
- Web Audio API
- Audio Worklet
- getUserMedia API
- Drag and Drop API

### Détails de la compatibilité des navigateurs
1. **Chrome/Chromium**
   - Entièrement supporté et recommandé
   - Mettez à jour vers la dernière version pour des performances optimales

2. **Firefox/Safari**
   - Support limité
   - Certaines fonctionnalités peuvent ne pas fonctionner comme prévu
   - Envisagez d'utiliser Chrome pour une meilleure expérience

### Fréquence d'échantillonnage recommandée

Réglez la **Fréquence d'échantillonnage** d'EffeTune sur 96 kHz. Cela réduit le repliement dans la bande audible lorsque l'antirepliement des effets non linéaires est limité. Ce réglage commande la fréquence de traitement interne d'EffeTune et peut normalement différer de celle du système, des périphériques audio et de VB-CABLE : il n'est donc pas nécessaire de les modifier. Vérifiez la fréquence effective affichée dans l'application : avant le premier enregistrement du réglage, la valeur par défaut du système ou du navigateur peut être utilisée, et la version web peut adopter une autre fréquence si 96 kHz n'est pas disponible. En cas de coupures, réduisez d'abord les effets exigeants ou raccourcissez la chaîne ; ne baissez la fréquence que si nécessaire.

## Guide de développement

Vous souhaitez créer vos propres plugins audio ? Consultez notre [Guide de développement de plugins](../../plugin-development.md).

## Liens

[Historique des versions](../../version-history.md)

[Code source](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)

[Soutenez-nous sur Ko-fi](https://ko-fi.com/frievea)
