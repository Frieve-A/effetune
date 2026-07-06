# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

<div class="doc-primary-actions" aria-label="Actions principales">
  <a class="button button-primary" href="https://effetune.frieve.com/effetune.html">Ouvrir l'application web</a>
  <install class="button button-secondary"><a href="https://effetune.frieve.com/effetune.html">Installer la version PWA</a></install>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune/releases/">Télécharger l'application de bureau</a>
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
- Mesure et correction de la réponse en fréquence pour calibrer votre système
- Traitement et sortie multicanal

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

### Utilisation des préréglages

1. Enregistrez votre chaîne d'effets :
   - Configurez la chaîne d'effets et les paramètres souhaités
   - Entrez un nom pour votre préréglage dans le champ de saisie
   - Cliquez sur le bouton save pour enregistrer votre préréglage

2. Charger un préréglage :
   - Tapez ou sélectionnez un nom de préréglage dans la liste déroulante
   - Le préréglage sera chargé automatiquement
   - Tous les effets et leurs paramètres seront restaurés

3. Supprimer un préréglage :
   - Sélectionnez le préréglage que vous souhaitez supprimer
   - Cliquez sur le bouton delete
   - Confirmez la suppression lorsqu'on vous le demande

4. Informations sur le préréglage :
   - Chaque préréglage stocke la configuration complète de votre chaîne d'effets
   - Inclut l'ordre des effets, les paramètres et les états

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
   - Tout le traitement est effectué à la fréquence d'échantillonnage de la Pipeline

2. État du traitement :
   - La barre de progression affiche l'état actuel du traitement
   - Le temps de traitement dépend de la taille du fichier et de la complexité de la chaîne d'effets

3. Options de téléchargement ou de sauvegarde :
   - Les fichiers traités sont exportés au format WAV
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
| Basics    | Matrix            | Routage et mixage des canaux audio avec un contrôle flexible             | [Détails](plugins/basics.md#matrix)                     |
| Basics    | MultiChannel Panel| Panneau de contrôle pour plusieurs canaux avec volume, mute, solo et délai | [Détails](plugins/basics.md#multichannel-panel)        |
| Basics    | Mute              | Silence complètement le signal audio                                     | [Détails](plugins/basics.md#mute)                       |
| Basics    | Polarity Inversion| Inversion de la polarité du signal                                       | [Détails](plugins/basics.md#polarity-inversion)         |
| Basics    | Stereo Balance    | Contrôle de l'équilibre des canaux stéréo                                | [Détails](plugins/basics.md#stereo-balance)             |
| Basics    | Volume            | Contrôle basique du volume                                               | [Détails](plugins/basics.md#volume)                     |
| Delay     | Delay          | Effet de retard standard | [Détails](plugins/delay.md#delay) |
| Delay     | Time Alignment | Réglage fin du timing de lecture pour aligner les enceintes et la position d'écoute | [Détails](plugins/delay.md#time-alignment) |
| Dynamics  | Auto Leveler | Réglage automatique du volume basé sur la mesure LUFS pour une expérience d'écoute cohérente | [Détails](plugins/dynamics.md#auto-leveler) |
| Dynamics  | Brickwall Limiter | Contrôle transparent des crêtes pour une écoute sûre et confortable | [Détails](plugins/dynamics.md#brickwall-limiter) |
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
| EQ        | 5Band PEQ | Égaliseur 5 bandes flexible pour modeler graves, médiums et aigus | [Détails](plugins/eq.md#5band-peq) |
| EQ        | Band Pass Filter | Concentrez-vous sur des fréquences spécifiques | [Détails](plugins/eq.md#band-pass-filter) |
| EQ        | Comb Filter | Ajoute une coloration déphasée, creuse ou métallique | [Détails](plugins/eq.md#comb-filter) |
| EQ        | Earphone Cable Sim | Permet de vérifier à quel point les variations de réponse en fréquence dues aux câbles d'écouteurs ordinaires restent généralement faibles | [Détails](plugins/eq.md#earphone-cable-sim) |
| EQ        | Hi Pass Filter | Élimine avec précision les basses indésirables | [Détails](plugins/eq.md#hi-pass-filter) |
| EQ        | Lo Pass Filter | Élimine avec précision les hautes fréquences indésirables | [Détails](plugins/eq.md#lo-pass-filter) |
| EQ        | Loudness Equalizer | Correction de l'équilibre fréquentiel pour l'écoute à faible volume | [Détails](plugins/eq.md#loudness-equalizer) |
| EQ        | Narrow Range | Combinaison de filtres passe-haut et passe-bas | [Détails](plugins/eq.md#narrow-range) |
| EQ        | Tilt EQ      | Égaliseur incliné pour un façonnage rapide du son | [Détails](plugins/eq.md#tilt-eq) |
| EQ        | Tone Control | Contrôle tonal en trois bandes | [Détails](plugins/eq.md#tone-control) |
| Lo-Fi     | Bit Crusher | Réduction de la profondeur de bits et effet de maintien d'ordre zéro | [Détails](plugins/lofi.md#bit-crusher) |
| Lo-Fi     | Digital Error Emulator | Simule diverses erreurs de transmission audio numérique et caractéristiques d'équipements numériques vintage | [Détails](plugins/lofi.md#digital-error-emulator) |
| Lo-Fi     | DSD64 IMD Simulator | Simule la distorsion d'intermodulation audible issue du bruit ultrasonique du DSD64 | [Détails](plugins/lofi.md#dsd64-imd-simulator) |
| Lo-Fi     | Hum Generator | Ajoute une ambiance de ronflement électrique 50/60 Hz contrôlable pour une écoute vintage/lo-fi | [Détails](plugins/lofi.md#hum-generator) |
| Lo-Fi     | Noise Blender | Ajoute une texture de bruit de fond réglable pour une ambiance lo-fi | [Détails](plugins/lofi.md#noise-blender) |
| Lo-Fi     | Simple Jitter | Simulation de gigue numérique | [Détails](plugins/lofi.md#simple-jitter) |
| Lo-Fi     | Vinyl Artifacts | Ajoute des pops, crépitements, souffle, rumble et fuite de bruit stéréo façon vinyle | [Détails](plugins/lofi.md#vinyl-artifacts) |
| Modulation | Doppler Distortion | Simule les changements naturels et dynamiques du son causés par de subtiles oscillations du cône de haut-parleur | [Détails](plugins/modulation.md#doppler-distortion) |
| Modulation | Pitch Shifter | Monte ou baisse la hauteur de la musique sans changer le tempo | [Détails](plugins/modulation.md#pitch-shifter) |
| Modulation | Tremolo | Effet de modulation basé sur le volume | [Détails](plugins/modulation.md#tremolo) |
| Modulation | Wow Flutter | Ajoute un léger flottement de hauteur façon bande ou disque pour une couleur vintage | [Détails](plugins/modulation.md#wow-flutter) |
| Resonator | Horn Resonator | Simulation de résonance de cornet avec dimensions personnalisables | [Détails](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | Résonance de pavillon plus douce pour une couleur d'écoute naturelle | [Détails](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | Effet de résonance fréquentielle avec jusqu'à 5 résonateurs | [Détails](plugins/resonator.md#modal-resonator) |
| Reverb    | Dattorro Plate Reverb | Reverb à plaque classique basé sur l'algorithme Dattorro | [Détails](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb    | FDN Reverb | Réverbération à réseau de délais avec rétroaction produisant des textures riches et denses | [Détails](plugins/reverb.md#fdn-reverb) |
| Reverb    | RS Reverb | Réverbération à dispersion aléatoire avec diffusion naturelle | [Détails](plugins/reverb.md#rs-reverb) |
| Saturation| Dynamic Saturation | Simule le déplacement non linéaire des cônes de haut-parleur | [Détails](plugins/saturation.md#dynamic-saturation) |
| Saturation| Exciter | Ajoute du contenu harmonique pour améliorer la clarté et la présence | [Détails](plugins/saturation.md#exciter) |
| Saturation| Hard Clipping | Effet d'écrêtage dur numérique | [Détails](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | Ajoute du caractère avec une distorsion harmonique réglable du 2e au 5e ordre | [Détails](plugins/saturation.md#harmonic-distortion) |
| Saturation| Multiband Saturation | Ajoute séparément chaleur ou mordant aux graves, médiums et aigus | [Détails](plugins/saturation.md#multiband-saturation) |
| Saturation| Saturation | Ajoute richesse et caractère chaleureux façon analogique | [Détails](plugins/saturation.md#saturation) |
| Saturation| Sub Synth | Mélange un signal de basse fréquence filtré pour renforcer les graves | [Détails](plugins/saturation.md#sub-synth) |
| Spatial   | Crossfeed Filter | Filtre de crossfeed pour casques pour imagerie stéréo naturelle | [Détails](plugins/spatial.md#crossfeed-filter) |
| Spatial   | MS Matrix | Convertit entre stéréo et Mid/Side pour ajuster centre et ambiance | [Détails](plugins/spatial.md#ms-matrix) |
| Spatial   | Multiband Balance | Contrôle de l'équilibre stéréo dépendant de la fréquence sur 5 bandes | [Détails](plugins/spatial.md#multiband-balance) |
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

Pour des performances optimales avec des effets non linéaires, il est recommandé d'utiliser EffeTune à une fréquence d'échantillonnage de 96 kHz ou plus. Cette fréquence d'échantillonnage élevée permet d'obtenir des caractéristiques idéales lors du traitement de l'audio via des effets non linéaires tels que la saturation et la compression.

## Guide de développement

Vous souhaitez créer vos propres plugins audio ? Consultez notre [Guide de développement de plugins](../../plugin-development.md).
Vous souhaitez créer une application de bureau ? Consultez notre [Guide de construction](../../../BUILD.md).

## Liens

[Historique des versions](../../version-history.md)

[Code source](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)

[Soutenez-nous sur Ko-fi](https://ko-fi.com/frievea)
