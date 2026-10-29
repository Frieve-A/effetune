# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

<div class="doc-primary-actions" aria-label="Actions principales">
  <a class="button button-primary" href="https://effetune.frieve.com/effetune.html">Ouvrir l'application web</a>
  <install class="button button-secondary"><a href="https://effetune.frieve.com/effetune.html">Installer la version PWA</a></install>
  <a class="button button-secondary" href="/dsp/">DSP Library</a>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune/releases/">Télécharger l'application de bureau</a>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune-mixwright/releases">Télécharger la version VST</a>
  <a class="button button-secondary" href="https://chromewebstore.google.com/detail/effetune/fhjhnpepnhkcdggogicifibfegpbhibp">Installer l’extension Chrome</a>
  <a class="button button-secondary" href="https://microsoftedge.microsoft.com/addons/detail/effetune/kjpcfdidpphaclfkfdahchhibgjcngdk">Installer l’extension Edge</a>
</div>

Un processeur d'effets audio en temps réel, conçu pour les passionnés de musique afin d'améliorer leur expérience d'écoute. EffeTune vous permet de traiter n'importe quelle source audio via divers effets de haute qualité, vous offrant la possibilité de personnaliser et de perfectionner votre expérience d'écoute en temps réel.

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## Vidéo d'introduction

[![YouTube Video](../../../images/video_thumbnail.jpg)](https://www.youtube.com/watch?v=Qb5Airg0kI8)

## Concept

EffeTune a été créé pour les passionnés de musique souhaitant améliorer leur expérience d'écoute. Que vous diffusiez de la musique en streaming ou que vous écoutiez des supports physiques, EffeTune vous permet d'ajouter des effets de haute qualité pour personnaliser le son selon vos préférences exactes. Transformez votre ordinateur en un puissant processeur d'effets audio qui se place entre votre source audio et vos enceintes ou amplificateur.

Aucun mythe audiophile, juste de la science pure.

## Fonctionnalités

- Traitement audio en temps réel
- Interface glisser-déposer pour construire des chaînes d'effets
- Système d'effets extensible avec des effets catégorisés
- Visualisation audio en direct
- Dispositions Visualizer personnalisables avec graphiques animés, pochette et informations du morceau
- Pipeline audio pouvant être modifié en temps réel
- Traitement de fichiers audio hors ligne avec la chaîne d'effets actuelle
- Bibliothèque musicale pour parcourir les sous-dossiers locaux, les métadonnées et les listes de lecture
- Mini-lecteur compact toujours au premier plan pour l'application de bureau
- Mesure et correction de la réponse en fréquence pour calibrer votre système
- Traitement et sortie multicanal
- Interface web adaptée aux téléphones et aux tablettes

## Guide de configuration

### Application Android

Utilisez Android 10 ou une version ultérieure, avec Android System WebView à jour. Ouvrez des fichiers musicaux ou choisissez un dossier dans la bibliothèque musicale ; Android vous permet de sélectionner les fichiers et dossiers auxquels EffeTune peut accéder. Si un dossier devient inaccessible, sélectionnez-le à nouveau dans la bibliothèque. La lecture continue lorsque l’écran est éteint, et les commandes des notifications et de l’écran de verrouillage pilotent le même lecteur.

Enregistrez ou partagez les fichiers exportés depuis les écrans de fichiers et de partage d’Android. Pour exporter plusieurs fichiers audio, choisissez un dossier de destination et gardez l’application ouverte. L’application Android et l’application web conservent leurs données séparément. Sauvegarde / Restauration permet d’échanger les préréglages, réponses impulsionnelles, mesures et données du visualiseur (jusqu’à 256 Mo) ; les fichiers musicaux, le catalogue musical, les identifiants de connexion et les réglages ne sont pas inclus. Les effets traitent le son lu ou reçu par EffeTune, sans remplacer celui des autres applications Android.

Les commandes MIDI des paramètres et les changements programmés continuent lorsque l’écran est éteint. Gardez l’application ouverte pour utiliser le clavier ou une manette. Android accepte les entrées MIDI, mais n’envoie pas de retour aux faders motorisés ni aux LED. Touchez l’icône **Remote Control** dans la barre d’outils pour autoriser le contrôle à distance et copier un lien d’appairage. Gardez ce lien confidentiel.

Choisissez la méthode de configuration adaptée à la source audio que vous souhaitez écouter.

### Configuration du lecteur de fichiers musicaux

- Ouvrez l'application web EffeTune dans votre navigateur, ou lancez l'application de bureau EffeTune
- Ouvrez et lisez un fichier musical pour assurer une lecture correcte
   - Cliquez sur le bouton **Ouvrir des fichiers musicaux** et sélectionnez un fichier musical
   - Ou ouvrez un fichier musical et sélectionnez EffeTune comme application (application de bureau uniquement)
   - Ou sélectionnez **Ouvrir un fichier musical...** depuis le menu **Fichier** (application de bureau uniquement)
   - Ou faites glisser le fichier musical dans la fenêtre
- Pour une utilisation limitée au lecteur, sélectionnez **Aucun (lecteur de fichiers musicaux uniquement)** comme **Périphérique d'entrée** dans **Configuration audio** afin de ne pas utiliser d'entrée audio en direct. C'est le réglage par défaut de l'application de bureau ; si vous avez déjà enregistré un périphérique d'entrée, votre choix est conservé.

[Lecteur de musique](music-player.md)

### Navigateur intégré à l’application de bureau

Dans l’application de bureau, **Navigateur** permet d’écouter le son des sites web avec vos effets actuels, sans périphérique audio virtuel.

1. Cliquez sur **Navigateur** dans l’en-tête. Le traitement du son du navigateur démarre.
2. Saisissez une adresse HTTP ou HTTPS, puis connectez-vous et lancez la musique depuis le site. Si vous omettez le protocole, HTTPS est utilisé.
3. Passez à **Effect Pipeline** pour régler le son. Le changement de vue n’interrompt pas le son du navigateur.

Utilisez Retour, Suivant, Actualiser et Arrêter le chargement pour naviguer. Ouvrez **Favoris** pour ajouter la page actuelle, ouvrir une page enregistrée, renommer un favori ou le supprimer. Le menu du navigateur propose **Afficher la page de démarrage**, **Ouvrir dans le navigateur par défaut**, **Définir comme page de démarrage** et **Effacer les données des sites**. Les favoris et la page de démarrage choisie sont enregistrés. Les connexions aux sites sont conservées séparément et restent disponibles après le redémarrage de l’application. Les pages du navigateur suivent le niveau de zoom de l’application.

Lorsque la barre du navigateur a le focus, utilisez **F5** pour recharger, **F6** pour sélectionner l’adresse, **Alt+Gauche/Droite** pour reculer ou avancer et **Alt+Home** pour afficher la page de démarrage. Ces raccourcis fonctionnent aussi dans la page. Quand la page a le focus, **Ctrl/Cmd+L** sélectionne l’adresse, **Ctrl/Cmd+R** recharge et **Ctrl/Cmd+D** ouvre les favoris. Sur macOS, **Cmd+[/]** permet aussi de reculer ou d’avancer. **Échap** arrête le chargement. Un clic droit sur la page propose les commandes de navigation, sur un lien les options pour l’ouvrir ici ou dans le navigateur par défaut et copier son adresse, et sur du texte sélectionné ou un champ de saisie les commandes d’édition disponibles. Hors de la page, les raccourcis de l’application gardent leurs fonctions habituelles.

Ouvrir **Navigateur** ou y revenir sélectionne automatiquement le son du navigateur. Le son du navigateur est mélangé à celui du périphérique d’entrée sélectionné. Choisissez **Aucun** comme périphérique d’entrée pour écouter uniquement le navigateur. L’option d’entrée du lecteur ne modifie pas la lecture dans le navigateur. La musique locale peut être lue en même temps que le son du navigateur. Si la capture s’arrête, cliquez à nouveau sur **Navigateur** pour réessayer. **Effacer les données des sites** vous déconnecte des sites et efface leurs données enregistrées, tout en conservant les favoris.

Utilisez **Fermer** dans la barre d’outils du navigateur pour arrêter le traitement de son audio et revenir à **Effect Pipeline**. La page et l’historique de navigation sont conservés. Rouvrez **Navigateur** pour reprendre le traitement audio sur la même page.

Dans **Paramètres > Configuration... > Navigateur** :

- **Page de démarrage** définit l’adresse HTTP ou HTTPS affichée à la première ouverture du navigateur. Le champ est vide par défaut ; lorsqu’il est vide, le [guide de streaming d’EffeTune](https://effetune.frieve.com/streaming/) s’ouvre. **Réinitialiser** vide le champ sans changer la page actuelle.
- **Ouvrir les nouveaux onglets dans le navigateur par défaut** est activé par défaut. Désactivez cette option pour ouvrir ces liens dans le navigateur d’EffeTune. Les fenêtres séparées, notamment pour la connexion à un compte, restent dans EffeTune dans les deux cas.
- **User-Agent** est l’identification du navigateur transmise aux sites web. La valeur par défaut présente le navigateur comme compatible avec Chrome et inclut le nom EffeTune. Laissez le champ vide ou cliquez sur **Réinitialiser** pour rétablir la valeur par défaut. Après toute modification, rechargez la page dans le navigateur.

Pour changer automatiquement d’effets selon le site, enregistrez d’abord vos chaînes comme préréglages. Sous **Règles d’URL**, cliquez sur **Ajouter une règle**, saisissez un site et un chemin comme `example.com/music/*`, puis choisissez un préréglage de chaîne. Omettez `http://` ou `https://`, les paramètres de requête et les fragments `#` ; `*` correspond à n’importe quel texte. Réglez la priorité avec les boutons de déplacement vers le haut et le bas, puis cliquez sur **Enregistrer les règles**. La première règle activée qui correspond et dont le préréglage est disponible est utilisée.

Les règles s’appliquent tant que l’audio du navigateur est sélectionné, même dans une autre vue. L’enregistrement des règles, l’ouverture du navigateur ou la navigation vers une page correspondante peut charger son préréglage. La navigation entre des pages utilisant le même préréglage conserve vos réglages manuels. Sans règle correspondante, la chaîne actuelle reste inchangée.

Certains sites refusent les navigateurs intégrés, la connexion, la lecture de contenus protégés ou la capture audio. La disponibilité dépend du site et du système d’exploitation ; la lecture avec DRM n’est pas garantie. Si la connexion est refusée, essayez une autre méthode proposée par le site ou utilisez votre navigateur habituel. S’y connecter ne vous connecte pas dans EffeTune. Le navigateur est réservé à l’application de bureau.

### Configuration de l’extension de navigateur

Traitez jusqu’à quatre onglets Chrome ou Edge avec des chaînes indépendantes, des préréglages selon l’URL et une fréquence d’échantillonnage réglable, sans périphérique audio virtuel. Consultez le [guide de l’extension de navigateur](browser-extension.md).

1. Installez l’extension EffeTune depuis la boutique [Chrome](https://chromewebstore.google.com/detail/effetune/fhjhnpepnhkcdggogicifibfegpbhibp) ou [Edge](https://microsoftedge.microsoft.com/addons/detail/effetune/kjpcfdidpphaclfkfdahchhibgjcngdk).
2. Lancez la lecture dans l’onglet dont vous souhaitez traiter le son, ouvrez EffeTune depuis la barre d’outils du navigateur, puis choisissez **Start on this tab**.
3. Choisissez **Edit pipeline** pour ajouter des effets et régler le son.

### Configuration des services de streaming

Pour traiter l'audio des services de streaming (Spotify, YouTube Music, etc.) :

Dans l’application de bureau, essayez d’abord le [navigateur intégré](#navigateur-intégré-à-lapplication-de-bureau). Pour utiliser une application de streaming distincte ou une source que ce navigateur ne peut pas lire, suivez la configuration audio ci-dessous.

1. Prérequis :
   - Installer un périphérique audio virtuel (par exemple, VB Cable, Voice Meeter ou ASIO Link Tool)
   - Configurer votre service de streaming pour envoyer l'audio vers le périphérique audio virtuel

2. Configuration :
   - Ouvrez l'application web EffeTune dans votre navigateur, ou lancez l'application de bureau EffeTune
   - Sélectionnez le périphérique audio virtuel comme source d'entrée
     - Dans Chrome, la première fois que vous l'ouvrez, une boîte de dialogue apparaît vous demandant de sélectionner et d'autoriser l'entrée audio
     - Ouvrez **Configuration audio...** depuis le menu **Paramètres** pour choisir les périphériques d'entrée/sortie et le format audio
   - Lancez la lecture de la musique depuis votre service de streaming
   - Vérifiez que l'audio circule via EffeTune
   - Pour des instructions de configuration plus détaillées, consultez la [FAQ](faq.md)

### Configuration des sources audio physiques

Pour utiliser EffeTune avec des lecteurs CD, lecteurs réseau ou autres sources physiques :

- Connectez votre interface audio à votre ordinateur
- Ouvrez l'application web EffeTune dans votre navigateur, ou lancez l'application de bureau EffeTune
- Sélectionnez votre interface audio comme source d'entrée et de sortie
   - Dans Chrome, la première fois que vous l'ouvrez, une boîte de dialogue apparaît vous demandant de sélectionner et d'autoriser l'entrée audio
   - Ouvrez **Configuration audio...** depuis le menu **Paramètres** pour choisir les périphériques d'entrée/sortie et le format audio
- Votre interface audio fonctionne désormais comme un processeur multi-effets :
   * Entrée : Votre lecteur CD, lecteur réseau ou autre source audio
   * Traitement : Effets en temps réel via EffeTune
   * Sortie : Audio traité vers votre amplificateur ou vos enceintes

## Utilisation

Au premier lancement, la fenêtre de l’application de bureau s’ouvre agrandie. Aux lancements suivants, l’application rétablit sa taille, sa position et son état d’agrandissement précédents.

Au premier lancement, une courte visite vous montre où écouter de la musique, ajouter des effets et ajuster le son. Vous pouvez la revoir à tout moment avec **Découvrir l’application** dans le menu des paramètres, dans le menu **Aide** de l’application de bureau ou via le bouton de menu sur mobile.

### Construction de votre chaîne d'effets

1. Les effets disponibles sont listés sur le côté gauche de l'écran
   - Utilisez le bouton de recherche à côté de "Available Effects" pour filtrer les effets
   - Tapez n'importe quel texte pour trouver des effets par nom ou catégorie
   - Appuyez sur ESC pour effacer la recherche
2. Glissez-déposez les effets de la liste vers la zone de l'Effect Pipeline
   - Sur mobile, ouvrez l'onglet **Effets** et touchez le bouton **+** pour ajouter des effets depuis la liste en plein écran
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
10. Cliquez sur le bouton Préréglages d’effet de chaque effet pour enregistrer ou appliquer des réglages pour cet effet uniquement

Cliquez sur le cadenas à côté de × pour verrouiller ou déverrouiller les réglages d’un effet. Le verrouillage empêche de modifier ses paramètres, de les réinitialiser, d’appliquer des préréglages ou de changer le routage. Le traitement audio, ON/OFF, le déplacement, le repli et la suppression restent disponibles. Les états replié et verrouillé sont enregistrés et restaurés avec la chaîne d’effets, y compris dans ses préréglages et lors de la reprise de la dernière session. Le cadenas devient jaune lorsque les réglages sont verrouillés et clignote si vous essayez de les modifier. La lecture des valeurs sur les graphiques et le changement d’onglet restent disponibles.

### Parcourir votre Bibliothèque musicale

Vous pouvez organiser les fichiers musicaux stockés sur votre appareil dans une bibliothèque.

1. Ouvrez la **Bibliothèque musicale** depuis l'en-tête sur ordinateur, l'onglet mobile **Bibliothèque** ou **Affichage > Bibliothèque musicale** dans l'application de bureau.
2. Sélectionnez **Ajouter un dossier de musique** pour indexer un dossier de fichiers musicaux. Les feuilles CUE externes permettent de découper en morceaux individuels les fichiers d'album WAV ou FLAC du même dossier.
3. Parcourez **Morceaux**, **Albums**, **Artistes**, **Genres**, **Sous-dossiers**, **Dossiers**, **Ajouts récents** ou **Listes de lecture**, et utilisez **Rechercher dans la bibliothèque** pour filtrer votre collection.
4. Utilisez **Lire** pour écouter à travers le pipeline d'effets actuel, ou **Lire ensuite**, **Ajouter à la file** et **Ajouter à une liste** pour gérer la lecture.
5. Utilisez **Analyser à nouveau** après avoir modifié des fichiers, et **Reconnecter** si une autorisation du navigateur ou du dossier a été perdue.
   - [Détails de la Bibliothèque musicale](music-library.md)

### Visualizer

Vous pouvez profiter de visualisations basées sur la musique en cours de lecture.

Ouvrez **Visualizer** depuis l’en-tête sur ordinateur, l’onglet mobile **Lecteur** ou le menu **Affichage** de l’application de bureau. Choisissez une disposition intégrée ou sélectionnez **Edit** pour disposer graphiques audio, pochette et informations du morceau. Les modifications s’appliquent immédiatement et sont retrouvées au prochain lancement ; pour en garder une copie nommée, utilisez la boîte de dialogue des préréglages. Survolez ou touchez l’affichage, puis sélectionnez **⛶** pour remplir la fenêtre de l’application. Consultez le [guide Visualizer](visualizer.md) pour l’édition, les effets et les options d’affichage.

### Utilisation des préréglages

Vous pouvez enregistrer et charger les chaînes d’effets que vous créez.

Cliquez sur le bouton **Préréglages de chaîne d’effets** dans l’en-tête de l’Effect Pipeline pour ouvrir la boîte de dialogue des préréglages.

1. Chargez un préréglage en le sélectionnant dans la liste des préréglages enregistrés. La chaîne d’effets complète est restaurée, y compris l’ordre des effets, les réglages et les états ON/OFF.
2. Enregistrez la chaîne actuelle en saisissant un nom puis en choisissant **Enregistrer**.
3. Renommez un préréglage enregistré avec son bouton de renommage.
4. Sélectionnez un ou plusieurs préréglages enregistrés, puis choisissez **Supprimer la sélection** et confirmez pour les retirer.
5. Appuyez sur Ctrl+S (ou Cmd+S sous macOS) pour ouvrir la boîte de dialogue avec le nom du préréglage actuel prêt à être modifié.

Chaque effet possède également son propre bouton **Préréglages d’effet**. Il ouvre les préréglages système lorsque l’effet en fournit et permet d’enregistrer, renommer, charger ou supprimer vos réglages pour cet effet. Les préréglages d’effet ne modifient que les paramètres de cet effet ; ils ne modifient ni son état ON/OFF ni son routage.

L’importation, l’exportation et le partage de fichiers `.effetune_preset` continuent d’utiliser des préréglages de chaîne d’effets complète.

### Commandes communes aux effets

- Pour régler précisément un curseur, maintenez la touche Maj enfoncée pendant que vous le faites glisser ; la valeur change alors d'une unité minimale à la fois
   - Pour les curseurs acceptant des valeurs négatives et positives, la zone colorée s’étend de 0 à la valeur actuelle. Les curseurs Ratio prennent 1.0 comme point de départ.
- Sur les graphiques compatibles dotés d’un axe de fréquences ou de notes, faites glisser le pointeur le long de cet axe pour écouter la fréquence choisie à travers la chaîne d’effets. Dans **Configuration > Général > Son de préécoute des fréquences**, choisissez **Onde sinusoïdale** (par défaut, -12 dB) ou **Bruit filtré passe-bande**, qui joue un bruit centré sur cette fréquence. Note Spectrogram, Pitch Meter, Chroma Spiral et les claviers de piano utilisent toujours une onde sinusoïdale. Lorsqu’un clavier est affiché, la fréquence s’aligne sur le demi-ton le plus proche ; faites glisser le pointeur sur une touche pour écouter sa note

[Contrôler les effets par MIDI, manette ou clavier](controller-mapping.md)

### Utilisation de la fonction Section

Vous pouvez regrouper plusieurs effets et les contrôler ensemble.

1. Utilisation de l'effet Section :
   - Ajouter un effet Section au début d'un groupe d'effets
   - Entrer un nom descriptif dans le champ Comment
   - Basculer la Section ON/OFF contourne ou rétablit cette section tout en conservant l'état ON/OFF propre à chaque effet
   - Utiliser plusieurs effets Section pour organiser votre chaîne d'effets en groupes logiques
   - [En savoir plus sur les effets de contrôle](plugins/control.md)

### Utilisation des fonctions Pipeline AB

Vous pouvez passer d’une chaîne d’effets à l’autre pour comparer leur rendu à l’écoute.

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

4. Test en double aveugle :
   - Comparez Pipeline A et Pipeline B à l'écoute sans savoir lequel est en cours de lecture
   - Lancez un test ABX pour vérifier si vous pouvez réellement distinguer les deux pipelines, ou un test de préférence A/B pour savoir lequel vous préférez, avec une vérification de la significativité statistique
   - Ouvrez-le depuis le menu de pipeline **▼** à droite du bouton de basculement AB (également disponible depuis le menu **Fichier** dans l'application de bureau)
   - [En savoir plus sur le test en double aveugle](double-blind-test.md)

### Sélection d'effets et raccourcis clavier

1. Méthodes de sélection des effets :
   - Cliquez sur les en-têtes d'effet pour sélectionner des effets individuels
   - Maintenez Ctrl en cliquant pour sélectionner plusieurs effets
   - Cliquez sur un espace vide dans la zone Pipeline pour désélectionner tous les effets

2. Raccourcis clavier :
   - Ctrl + Z : Annuler
   - Ctrl + Y : Rétablir
   - Ctrl + S : Enregistrer le pipeline actuel
   - Ctrl + Shift + S : Enregistrer le pipeline actuel sous
   - Ctrl + X : Couper les effets sélectionnés
   - Ctrl + C : Copier les effets sélectionnés
   - Ctrl + V : Coller les effets depuis le presse-papiers
   - Ctrl + F : Rechercher des effets
   - Ctrl + A : Sélectionner tous les effets du pipeline
   - Delete : Supprimer les effets sélectionnés
   - ESC : Désélectionner tous les effets
   - T : Basculer entre Pipeline A et Pipeline B
   - A : Basculer vers Pipeline A
   - B : Basculer vers Pipeline B

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

Vous pouvez appliquer la chaîne d’effets à des fichiers musicaux et enregistrer le résultat dans de nouveaux fichiers.

1. Zone de dépôt ou de spécification de fichiers :
   - Une zone de dépôt dédiée est toujours visible sous l'Effect Pipeline
   - Prend en charge un ou plusieurs fichiers audio
   - Les fichiers sont traités en utilisant les paramètres actuels du pipeline
   - Les effets sont traités à la fréquence d’échantillonnage du pipeline ; une éventuelle conversion de la fréquence de sortie a lieu ensuite

2. État du traitement :
   - La barre de progression affiche l'état actuel du traitement
   - Le temps de traitement dépend de la taille du fichier et de la complexité de la chaîne d'effets

3. Options de téléchargement ou de sauvegarde :
   - Dans **Paramètres > Configuration > Sortie de fichier hors ligne**, choisissez WAV ou FLAC, ainsi que la fréquence d’échantillonnage et la qualité. Pour FLAC, choisissez un encodage sans perte sur 16 ou 24 bits. Le réglage initial est WAV 96 kHz en PCM 24 bits
   - Chaque format a sa propre limite de canaux. Si un fichier dépasse celle du format choisi, EffeTune s’arrête et indique la marche à suivre sans effectuer de mixage automatique
   - Pour plusieurs fichiers, sélectionnez un dossier de sortie avant le traitement ; chaque fichier y est enregistré directement à la fin de son traitement
   - Sur les navigateurs anciens sans sélection de dossier, plusieurs fichiers sont regroupés dans un ZIP à télécharger

### Partage de chaînes d'effets

Vous pouvez partager la configuration de votre chaîne d'effets avec d'autres utilisateurs.
1. Après avoir configuré la chaîne d'effets souhaitée, cliquez sur le bouton **Partager** dans le coin supérieur droit de la zone Effect Pipeline
2. L'URL de l'application web sera automatiquement copiée dans votre presse-papiers
3. Partagez l'URL copiée avec d'autres — ils pourront recréer exactement votre chaîne d'effets en l'ouvrant
4. Les URL partagées enregistrent les réglages d'effets nécessaires à la reproduction ; l'application web restaure aussi votre état de travail habituel depuis le stockage du navigateur
5. Dans la version application de bureau, exportez les paramètres vers un fichier `.effetune_preset` depuis le menu **Fichier**
6. Partagez le fichier `.effetune_preset` exporté. Le fichier `.effetune_preset` peut également être chargé en le faisant glisser dans la fenêtre de l'application web

### Sauvegarder et restaurer les données enregistrées

Ouvrez **Paramètres > Sauvegarde / Restauration** pour transférer les préréglages de chaîne, les préréglages d’effet, les réponses impulsionnelles et les mesures enregistrés entre l’application web, l’application de bureau et l’extension de navigateur. Dans les applications web et de bureau, vous pouvez aussi inclure les préréglages Visualizer nommés. La sélection d’un préréglage sélectionne automatiquement les données de mesure ou de réponse impulsionnelle qu’il utilise.

**Inclure les données de mesure** et **Inclure les réponses impulsionnelles** sont activés par défaut afin que les sauvegardes soient autonomes. Ne désactivez l’une de ces options que si la destination dispose déjà des fichiers de mesure ou de réponse impulsionnelle correspondants. Les réponses impulsionnelles restaurées sont ajoutées à la **Bibliothèque de réponses impulsionnelles** d’EffeTune. La restauration d’une sauvegarde ne modifie ni le pipeline actuel, ni le volume, ni le préréglage sélectionné, ni les réglages des périphériques, ni la Bibliothèque musicale, ni les règles d’URL de l’extension. Chaque fichier `.effetune_backup` accepte jusqu’à 256 Mo ; si nécessaire, répartissez les sauvegardes plus volumineuses sur plusieurs fichiers. Si la restauration s’interrompt, les éléments déjà restaurés sont conservés et vous pouvez restaurer à nouveau le même fichier en toute sécurité.

Avant de partager une sauvegarde, vérifiez la sélection : elle peut contenir des noms et commentaires de préréglages, les fichiers de réponse impulsionnelle d’origine et des détails de mesure. Les fichiers musicaux, les données de la Bibliothèque musicale, les préférences de l’application, les choix de périphériques, les règles d’URL, les identifiants et un pipeline actuel non enregistré ne sont pas inclus.

### Paramètres de l'application

Ouvrez **Paramètres > Configuration...** pour choisir la **Langue**, régler **Vue au démarrage :** (`Effect Pipeline (par défaut)`, `Bibliothèque musicale` ou `Visualizer`), configurer **Pipeline d'effets au démarrage :** et sélectionner un **Thème** (`Graphite`, `Paper`, `Midnight`, `Ember` ou `Mint`). Lorsque **Vue au démarrage :** est réglée sur **Bibliothèque musicale**, vous pouvez aussi choisir la catégorie de la bibliothèque qui s'ouvre en premier. Dans l’application de bureau, vous pouvez aussi choisir **Browser** comme vue au démarrage.

Dans **Colonnes de la chaîne d’effets**, choisissez **Manuel** pour régler le nombre de colonnes avec les boutons +/−, ou **Automatique** (par défaut) pour que les colonnes et la liste des effets tiennent dans la largeur de la fenêtre. Le mode automatique ajuste le nombre de colonnes lorsque vous redimensionnez la fenêtre.

La version Microsoft Store reçoit ses mises à jour via Microsoft Store. Dans **Paramètres > Configuration...**, utilisez **Ouvrir les mises à jour du Microsoft Store** pour rechercher des mises à jour et **Ouvrir les paramètres de démarrage de Windows** pour choisir si EffeTune se lance automatiquement. Cette version conserve ses paramètres et ses connexions dans Browser séparément des autres versions de bureau.

### Mesure acoustique

Mesurez votre système audio avec un microphone pour examiner sa réponse en fréquence, sa réponse impulsionnelle, sa distorsion et sa décroissance, et créez un EQ de correction importable dans EffeTune ; consultez [Mesure acoustique](measurement.md) et le [guide de Pipeline Analyzer](pipeline-analyzer.md).

### Réinitialisation audio

Si vous rencontrez des problèmes audio (coupures, parasites) :
1. Choisissez **Réinitialiser l'audio** dans le menu **Paramètres** ou dans le menu supplémentaire sur mobile. Dans l'application de bureau, vous pouvez aussi sélectionner **Recharger** dans le menu **Affichage**
2. Le pipeline audio sera reconstruit automatiquement
3. La configuration de votre chaîne d'effets sera préservée

### Musique en réseau et télécommande

**Application de bureau :** Parcourez les serveurs musicaux, dont Subsonic / OpenSubsonic, partagez les dossiers choisis et écoutez sur cet appareil, un lecteur OpenHome ou un lecteur UPnP AV / DLNA. Après appairage, les effets d’un lecteur EffeTune se modifient dans la même fenêtre. Le partage et l’accès par télécommande sont désactivés par défaut. Consultez [musique en réseau et télécommande](openhome.md). Vous pouvez aussi activer la réception UPnP AV / DLNA et AirPlay pour écouter la musique envoyée par d’autres appareils avec les effets de cet ordinateur.

La PWA peut lire la musique partagée d’un ordinateur EffeTune enregistré et les bibliothèques réseau autorisées avec les effets de cet appareil, ou piloter un lecteur réseau autorisé. Les connexions Subsonic directes sont aussi disponibles. Consultez la [configuration et la lecture depuis la PWA](openhome.md#pwa) pour connaître les conditions de navigateur et de connexion.

### Piloter EffeTune avec un assistant IA (MCP)

Vous pouvez confier la configuration de MCP à Codex ou Claude Code, puis lui demander d'ajouter des effets, de modifier leurs réglages et de charger ou d'enregistrer des préréglages dans EffeTune pour ordinateur. Utilisez un agent capable d'exécuter des commandes sur votre ordinateur.

1. Dans EffeTune pour ordinateur, ouvrez **Paramètres > Télécommande...**, activez **Autoriser la télécommande**, puis cliquez sur **Copier le lien**.
2. Envoyez le texte suivant à votre agent IA en remplaçant le champ prévu par le lien copié :

```text
Configure EffeTune MCP en suivant le guide officiel :
https://github.com/Frieve-A/effetune/blob/main/mcp/README.md
Lien de connexion : <coller ici le lien copié>
```

Une fois la configuration terminée, redémarrez le client si cela vous est demandé, puis essayez : « Affiche mes effets actuels ». Gardez le lien de connexion confidentiel ; si vous cliquez sur **Nouveau jeton** ou changez de port, refaites la configuration avec le nouveau lien.

Ajoutez des morceaux à Music Library dans l’EffeTune auquel vous êtes connecté, puis demandez : « Joue [morceau] ». L’assistant cherche d’abord dans la bibliothèque de cet EffeTune et utilise son lecteur par défaut ; nul besoin de partager son dossier musical. Pour utiliser une autre bibliothèque ou un autre lecteur, précisez-le : « Cherche [morceau] dans [bibliothèque] et lis-le sur [lecteur] ». Si la musique se trouve sur un autre ordinateur avec EffeTune, partagez d’abord son dossier musical.

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

En cas de problème, consultez la page [Dépannage et FAQ](faq.md).
Si le souci persiste, signalez-le sur [GitHub Issues](https://github.com/Frieve-A/effetune/issues).

## Effets disponibles

| Catégorie | Effet             | Description                                                              | Documentation                                           |
| --------- | ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| Analyzer  | Analog Meter      | Affiche les niveaux de canal sur un vumètre à aiguille avec des échelles VU, PPM, pic et sonie | [Détails](plugins/analyzer.md#analog-meter)             |
| Analyzer  | Chroma Spiral     | Affiche les composantes fréquentielles par note et par octave sur une spirale | [Détails](plugins/analyzer.md#chroma-spiral)            |
| Analyzer  | Level Meter       | Affiche le niveau audio avec maintien du pic                             | [Détails](plugins/analyzer.md#level-meter)              |
| Analyzer  | Note Spectrogram | Affiche les hauteurs estimées au fil du temps sous forme de piano roll | [Détails](plugins/analyzer.md#note-spectrogram)      |
| Analyzer  | Oscilloscope      | Visualisation en temps réel de la forme d'onde                           | [Détails](plugins/analyzer.md#oscilloscope)             |
| Analyzer  | Pitch Meter | Suit une fréquence fondamentale et son accord au fil du temps | [Détails](plugins/analyzer.md#pitch-meter) |
| Analyzer  | Rhythm Analyzer | Affiche le tempo et les attaques par bande de fréquences ou catégorie de batterie | [Détails](plugins/analyzer.md#rhythm-analyzer) |
| Analyzer  | Spectrogram       | Montre l'évolution du spectre de fréquences au fil du temps              | [Détails](plugins/analyzer.md#spectrogram)              |
| Analyzer  | Spectrum Analyzer | Montre en temps réel l'intensité des graves, médiums et aigus            | [Détails](plugins/analyzer.md#spectrum-analyzer)        |
| Analyzer  | Stereo Meter      | Visualise l'équilibre stéréo et la corrélation entre canaux              | [Détails](plugins/analyzer.md#stereo-meter)             |
| Basics    | Bass Management   | Redirige les basses fréquences vers un ou plusieurs caissons de basses et additionne le LFE aux graves des canaux principaux | [Détails](plugins/basics.md#bass-management)            |
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
| Dynamics  | Attack Tonal Balance | Équilibre les attaques brèves et la structure tonale soutenue | [Détails](plugins/dynamics.md#attack-tonal-balance) |
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
| EQ        | Tonal Balance EQ | Corrige automatiquement l'équilibre tonal à long terme vers une cible propre à un style musical | [Détails](plugins/eq.md#tonal-balance-eq) |
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
| Lo-Fi     | TV Audio Simulator | Fait passer la musique par des chaînes sonores télévisées analogiques et NICAM modélisées | [Détails](plugins/lofi.md#tv-audio-simulator) |
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
| Resonator | Adaptive Prediction | Apprend à prédire le son pour extraire le résidu ou créer une résonance évolutive | [Détails](plugins/resonator.md#adaptive-prediction) |
| Resonator | Horn Resonator | Simulation de résonance de pavillon avec dimensions personnalisables | [Détails](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | Résonance de pavillon plus douce pour une couleur d'écoute naturelle | [Détails](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | Effet de résonance fréquentielle avec jusqu'à 5 résonateurs | [Détails](plugins/resonator.md#modal-resonator) |
| Restoration | Click Remover | Répare clics, crépitements, pops et brèves coupures | [Détails](plugins/restoration.md#click-remover) |
| Restoration | Clip Restorer | Restaure les crêtes aplaties par un écrêtage dur | [Détails](plugins/restoration.md#clip-restorer) |
| Restoration | Hum Remover | Supprime le ronflement électrique constant et ses harmoniques | [Détails](plugins/restoration.md#hum-remover) |
| Restoration | Noise Reduction | Atténue le bruit de fond constant sans abîmer la musique | [Détails](plugins/restoration.md#noise-reduction) |
| Reverb    | Dattorro Plate Reverb | Reverb à plaque classique basé sur l'algorithme Dattorro | [Détails](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb    | FDN Reverb | Réverbération à réseau de délais avec rétroaction produisant des textures riches et denses | [Détails](plugins/reverb.md#fdn-reverb) |
| Reverb    | IR Reverb | Réverbération à convolution avec des réponses impulsionnelles de salles et d'équipements | [Détails](plugins/reverb.md#ir-reverb) |
| Reverb    | RS Reverb | Réverbération à dispersion aléatoire avec diffusion naturelle | [Détails](plugins/reverb.md#rs-reverb) |
| Saturation| Bandwidth Extender | Génère du contenu haute fréquence au-dessus d'une coupure détectée ou spécifiée | [Détails](plugins/saturation.md#bandwidth-extender) |
| Saturation| Bass Extender | Génère des graves une octave sous un contenu adapté | [Détails](plugins/saturation.md#bass-extender) |
| Saturation| Dynamic Saturation | Simule le déplacement non linéaire des cônes de haut-parleur | [Détails](plugins/saturation.md#dynamic-saturation) |
| Saturation| Exciter | Ajoute du contenu harmonique pour améliorer la clarté et la présence | [Détails](plugins/saturation.md#exciter) |
| Saturation| Hard Clipping | Effet d'écrêtage dur numérique | [Détails](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | Ajoute du caractère avec une distorsion harmonique réglable du 2e au 5e ordre | [Détails](plugins/saturation.md#harmonic-distortion) |
| Saturation| Multiband Saturation | Ajoute séparément chaleur ou mordant aux graves, médiums et aigus | [Détails](plugins/saturation.md#multiband-saturation) |
| Saturation| Saturation | Ajoute richesse et caractère chaleureux façon analogique | [Détails](plugins/saturation.md#saturation) |
| Saturation| Sub Synth | Mélange un signal de basse fréquence filtré pour renforcer les graves | [Détails](plugins/saturation.md#sub-synth) |
| Saturation| Tube Simulator | Modélise des étages ligne à lampes et des amplificateurs de puissance push-pull ou à triode single-ended 300B/2A3 | [Détails](plugins/saturation.md#tube-simulator) |
| Spatial   | Crossfeed Filter | Filtre de crossfeed pour casques pour imagerie stéréo naturelle | [Détails](plugins/spatial.md#crossfeed-filter) |
| Spatial   | Crosstalk Cancellation | Utilise des mesures près des oreilles pour réduire la diaphonie entre enceintes stéréo | [Détails](plugins/spatial.md#crosstalk-cancellation) |
| Spatial   | MS Matrix | Convertit entre stéréo et Mid/Side pour ajuster centre et ambiance | [Détails](plugins/spatial.md#ms-matrix) |
| Spatial   | Multiband Balance | Contrôle de l'équilibre stéréo dépendant de la fréquence sur 5 bandes | [Détails](plugins/spatial.md#multiband-balance) |
| Spatial   | Phase Select EQ | Accentue ou atténue les composantes fréquentielles selon la différence de phase G/D et Balance | [Détails](plugins/spatial.md#phase-select-eq) |
| Spatial   | Spatial Mapper | Sépare le son Direct, Diffuse et Residual pour un routage multicanal flexible | [Détails](plugins/spatial.md#spatial-mapper) |
| Spatial   | Stereo Blend | Contrôle la largeur stéréo, de la stéréo à polarité inversée à la stéréo élargie en passant par le mono | [Détails](plugins/spatial.md#stereo-blend) |
| Others    | Oscillator | Générateur de sons de test et de bruit pour vérifier enceintes/casques | [Détails](plugins/others.md#oscillator) |
| Others    | SFZ Note Player | Joue un instrument SFZ importé à partir des notes détectées | [Détails](plugins/others.md#sfz-note-player) |
| Control   | Section | Regroupe les effets pour contourner ou rétablir toute une section | [Détails](plugins/control.md) |

## Informations techniques

### Compatibilité des navigateurs

Frieve EffeTune a été testé et vérifié pour fonctionner sur Google Chrome. L'application nécessite un navigateur moderne avec le support de :
- Web Audio API
- Audio Worklet
- getUserMedia API
- Drag and Drop API
- Service Worker (pour l'installation de l'application web et l'ouverture hors ligne)

### Détails de la compatibilité des navigateurs
1. **Chrome/Chromium**
   - Entièrement supporté et recommandé
   - Mettez à jour vers la dernière version pour des performances optimales

2. **Firefox/Safari**
   - Support limité
   - Certaines fonctions comme le choix du périphérique de sortie, Wake Lock, l'installation ou les formats audio pris en charge peuvent varier selon le navigateur
   - Envisagez d'utiliser Chrome pour une meilleure expérience

### Fréquence d'échantillonnage recommandée

Réglez la **Fréquence d'échantillonnage** d'EffeTune sur 96 kHz. Cela réduit le repliement audible produit par les effets non linéaires comme la saturation. Ce réglage détermine la fréquence de traitement interne d'EffeTune et fonctionne indépendamment de la fréquence d'échantillonnage du système, de l'interface audio ou du périphérique audio virtuel. Vérifiez la fréquence d'échantillonnage effective affichée dans l'application : tant que vous n'avez pas enregistré de réglage, elle peut suivre la valeur par défaut du système ou du navigateur, et l'application web peut passer à une autre fréquence si 96 kHz n'est pas disponible. En cas de coupures, désactivez d'abord les effets exigeants ou raccourcissez la chaîne ; ne baissez la fréquence d'échantillonnage que si nécessaire.

## Guide de développement

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Frieve-A/effetune)

Vous souhaitez créer vos propres plugins audio ? Consultez notre [Guide de développement de plugins](../../plugin-development.md).

## Bibliothèque DSP

Le moteur DSP d'EffeTune existe aussi sous la forme d'une bibliothèque indépendante et déterministe, sous licence MIT, pour Python, JavaScript et les AudioWorklets du navigateur. Son schéma Chain public et son catalogue d'effets généré automatiquement s'utilisent sans l'application EffeTune. Consultez la [documentation d'EffeTune DSP Library](https://effetune.frieve.com/dsp/).

Les guides de démarrage rapide de chaque paquet expliquent l'installation et proposent des exemples complets prêts à exécuter :

- [Paquet Python](https://effetune.frieve.com/dsp/getting-started/python/)
- [Paquet JavaScript et AudioWorklet](https://effetune.frieve.com/dsp/getting-started/javascript/)

Le [guide de DSP Library](https://effetune.frieve.com/dsp/) présente les effets, les schémas, le comportement du traitement et les ressources nécessaires.

## Liens

[Historique des versions](../../version-history.md)

[Code source](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)

[Soutenez-nous sur Ko-fi](https://ko-fi.com/frievea)
