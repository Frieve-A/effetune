---
title: "Musique en réseau et télécommande (application de bureau) - EffeTune"
description: "Écoutez la musique du réseau avec EffeTune, recevez l’audio OpenHome, UPnP AV / DLNA et AirPlay, partagez votre musique et commandez la lecture sur votre réseau local."
lang: fr
---

# Musique en réseau et télécommande (application de bureau)

L’application de bureau peut recevoir la musique d’autres appareils du réseau local et la faire passer par vos effets EffeTune. Les réglages de réception OpenHome, UPnP AV / DLNA et AirPlay sont indépendants et désactivés par défaut. Activez uniquement ceux dont vous avez besoin dans **Paramètres > Configuration... > Réseau**.

## Recevoir de la musique avec OpenHome

Dans les versions de bureau compatibles (Windows x64, macOS sur Intel ou Apple silicon et Linux x64), EffeTune peut apparaître comme lecteur OpenHome auprès des applications de contrôle du même réseau local. Ouvrez **Paramètres > Configuration... > Réseau**, activez **Autoriser les contrôleurs OpenHome sur ce réseau** (désactivé par défaut), puis attendez que l’état indique qu’EffeTune est disponible.

Le champ **Nom de l’appareil** dans **Réseau** définit le nom du lecteur réseau, du récepteur AirPlay et de la bibliothèque partagée. Par défaut, le nom de cet ordinateur est utilisé. Saisissez un nom personnalisé, comme `Living Room`, ou videz le champ pour revenir au nom de l’ordinateur. UPnP AV / DLNA apparaît comme une destination distincte, avec un court suffixe ; les deux destinations utilisent le même lecteur EffeTune.

OpenHome ne demande aucune connexion. Tant que l’option est active, les autres appareils du réseau local peuvent consulter les métadonnées de lecture, modifier la file d’attente du lecteur et commander la lecture. Si le Pare-feu Windows demande une autorisation, autorisez EffeTune uniquement sur les **réseaux privés**, et non sur les **réseaux publics**. Désactivez l’option lorsque la télécommande n’est pas nécessaire.

Les contrôleurs peuvent ajouter des flux audio HTTP ou HTTPS, gérer la file de lecture distante et commander la lecture, la pause, l’arrêt, le saut, la recherche, la répétition et la lecture aléatoire. L’audio distant passe comme d’habitude par le pipeline d’effets EffeTune actif. Les opérations OpenHome de base sur la file et la lecture ont été vérifiées avec BubbleUPnP sur Android ; d’autres applications OpenHome peuvent afficher les services différemment. La destination OpenHome fournit une source OpenHome Playlist et ne propose via OpenHome ni la modification des effets, ni les chemins de fichiers locaux, ni le volume principal, Radio, Songcast ou la synchronisation multiroom.

La lecture sans interruption n’est pas garantie, et les informations techniques peuvent rester inconnues tant que la source ne les fournit pas. Après une mise en veille, un réveil, une connexion VPN ou un changement de réseau, le lecteur peut disparaître brièvement le temps de se reconnecter.

## Recevoir de la musique avec UPnP AV / DLNA

Activez **Autoriser la lecture UPnP AV / DLNA sur ce réseau** dans **Paramètres > Configuration... > Réseau**. Dans votre application de contrôle, choisissez la destination UPnP AV / DLNA d’EffeTune, puis un morceau sur un serveur accessible depuis l’ordinateur. L’autorisation OpenHome est indépendante et peut rester désactivée.

Cette destination reçoit du MP3, du FLAC, du WAV en PCM et de l’AAC (ADTS ou MP4/M4A) par HTTP ou HTTPS. Ogg (Vorbis/Opus/FLAC), WebM (Vorbis/Opus) et l’audio Matroska (PCM/FLAC/MP3/Opus/Vorbis/AAC) sont également pris en charge. Un type de fichier compatible doit aussi contenir un codec pris en charge ; ALAC n’est pas pris en charge.

Les contrôleurs peuvent lancer la lecture, mettre en pause, arrêter, changer de piste, avancer dans le morceau si la source le permet et régler le volume ou couper le son du lecteur. Ce volume s’applique aussi à la musique locale et OpenHome, sans modifier le volume de l’ordinateur ni les effets. Choisir un nouveau morceau remplace la file par ce seul morceau. Le contrôleur et EffeTune affichent le même état de lecture. Lorsqu’ils sont fournis par le serveur musical, les tags et les détails de l’audio source sont aussi disponibles dans l’élément **Informations sur le morceau** de Visualizer.

Utilisez un réseau local de confiance : les contrôleurs autorisés peuvent modifier la lecture sans connexion. Si le pare-feu le demande, autorisez l’accès au réseau privé. L’audio n’est pas converti ; la compatibilité dépend du contrôleur et de la source. Il s’agit d’un récepteur audio, sans garantie de certification DLNA, de lecture vidéo ni de prise en charge de tous les formats DLNA.

## Recevoir de l’audio avec AirPlay

Activez **Autoriser l’audio AirPlay sur ce réseau** dans **Paramètres > Configuration... > Réseau**, puis choisissez le **Nom de l’appareil** dans la liste des sorties audio AirPlay de l’appareil émetteur. L’état indique si le récepteur est disponible ou reçoit de l’audio. Gardez EffeTune ouvert et les deux appareils sur le même réseau local de confiance. Tout appareil pouvant accéder au récepteur activé peut envoyer de l’audio sans connexion.

AirPlay reçoit le son stéréo d’un seul émetteur à la fois. Lancez ou arrêtez la lecture et réglez le volume sur l’émetteur. Les réglages locaux et UPnP AV de volume et de sourdine s’appliquent uniquement à la lecture de fichiers et d’URL. Dès que l’audio AirPlay est prêt, il remplace la musique en cours. Lancer de la musique locale, OpenHome ou UPnP AV met fin à la réception AirPlay. La piste précédente ne reprend pas automatiquement à la fin d’AirPlay. Fermer le lecteur EffeTune avec **×**, ou utiliser **Arrêter**, met fin à la session AirPlay en cours ; le récepteur reste activé et disponible pour une nouvelle connexion.

Lorsque l’émetteur les fournit, le lecteur affiche le titre, l’artiste, la pochette et le temps de lecture. Survolez le titre pour consulter d’autres informations, comme l’album, le compositeur, le genre, les commentaires, l’émetteur et le format audio. Les informations disponibles dépendent de l’application émettrice et du contenu ; le temps de lecture est actualisé lorsque l’émetteur le communique. Vous pouvez aussi les afficher dans [Visualizer](visualizer.md).

**Audio reçu** indique le codec AirPlay, par exemple ALAC ou AAC-ELD. **PCM du récepteur** décrit le son reçu par EffeTune pour le traitement : stéréo, 44.1 kHz, 16 bits. Ces valeurs ne décrivent pas la qualité du fichier musical d’origine. Lorsqu’il est fourni, **Volume de l’émetteur** indique la position du curseur de volume de l’appareil émetteur sous forme de pourcentage en lecture seule ; réglez le volume sur cet appareil.

La mise en mémoire tampon du réseau et les effets EffeTune ajoutent du retard : le son peut être décalé par rapport à la vidéo. Les fonctions AirPlay 2, la synchronisation multiroom, la recopie d’écran, la vidéo et les contenus protégés ne sont pas pris en charge. La compatibilité varie selon l’appareil et l’application émettrice.

La détection AirPlay nécessite Bonjour sous Windows et macOS, ou un service Avahi / DNS-SD actif sous Linux. L’installateur Windows standard fournit le service de détection si nécessaire ; les versions portable et Microsoft Store exigent qu’il soit déjà installé. Sous Linux, installez le service Avahi / DNS-SD de votre distribution et activez-le avec ses outils habituels de gestion des services. Si le récepteur est indisponible, vérifiez ces conditions et l’accès au réseau privé dans le pare-feu, puis réessayez. Un Wi-Fi invité, un VPN ou l’isolation réseau peut empêcher les appareils de se trouver.

## Choisir une bibliothèque et un lecteur

Dans l’application de bureau, **Library** dans Music Library permet de choisir **This device** ou un serveur musical du réseau local. Les bibliothèques partagées d’EffeTune proposent les catégories habituelles, la recherche et le tri décrits dans le [guide Music Library](music-library.md). Les autres serveurs musicaux affichent les catégories et l’arborescence qu’ils publient ; la recherche et le tri ne sont disponibles que si le serveur les prend en charge.

Utilisez le sélecteur d’appareils en haut de la fenêtre pour choisir **This device** ou un lecteur OpenHome. Bibliothèque et lecteur sont indépendants : vous pouvez parcourir la musique d’un ordinateur et la lire sur un autre. Changer de lecteur change seulement la cible des commandes, sans arrêter l’ancien lecteur ni déplacer sa file. La piste, la file, la position, la répétition et la lecture aléatoire du lecteur choisi sont affichées, avec les commandes qu’il prend en charge. Les modifications des autres contrôleurs sont également répercutées.

## Partager des dossiers musicaux

Ouvrez **Paramètres > Configuration... > Réseau**. Sous **Partage de la bibliothèque**, choisissez les dossiers, activez **Partager les dossiers sélectionnés sur ce réseau**, puis cliquez sur **Enregistrer**. Si aucun dossier n’apparaît, ajoutez-en d’abord à Music Library. Désactivé par défaut, le partage ne publie que les dossiers enregistrés que vous avez sélectionnés. Les appareils du même réseau peuvent les parcourir et les lire sans connexion à un compte. Désactivez le partage ou désélectionnez un dossier, puis cliquez sur **Enregistrer** pour retirer l’accès. Laissez EffeTune ouvert sur l’ordinateur qui contient les fichiers.

Pour lire des fichiers locaux individuels sans activer le partage de la bibliothèque, choisissez un autre lecteur et utilisez **Open music files**. EffeTune rend uniquement les fichiers sélectionnés accessibles à ce lecteur ; laissez l’application ouverte sur l’ordinateur source.

Le partage transmet l’audio original, sans les effets de l’ordinateur source. Si la destination est EffeTune, elle applique ses propres effets. L’appareil utilisé pour choisir la musique ne traite pas l’audio et ne le relaie pas en continu. Le serveur et le lecteur doivent pouvoir communiquer entre eux ; la lecture de la file peut continuer après la déconnexion de l’application de contrôle.

## Modifier les effets du lecteur choisi (application de bureau)

Choisissez un lecteur EffeTune et ouvrez **Effect Pipeline**. Avant la première connexion, activez **Autoriser la télécommande** sur ce lecteur dans **Paramètres > Configuration... > Réseau** ou **Paramètres > Télécommande...**. Choisissez **Connect effects** ici, puis **Autoriser** dans la demande affichée sur l’ordinateur du lecteur. Aucun lien d’appairage n’est nécessaire. La connexion autorisée est mémorisée : lorsque vous sélectionnerez à nouveau ce lecteur, ses effets se connecteront automatiquement. La découverte d’un appareil ou le partage de sa bibliothèque n’autorise pas la modification des effets.

L’en-tête indique le lecteur en cours de modification. Sa chaîne, son bypass, A/B, annuler/rétablir et ses préréglages de chaîne enregistrés sont accessibles selon ses capacités. Le sélecteur d’IR utilise aussi sa bibliothèque IR. Enregistrer ou supprimer un préréglage de chaîne agit sur ce lecteur. Les préréglages intégrés de chaque effet restent disponibles ; les préréglages utilisateur des effets individuels ne sont pas accessibles à distance. Les opérations non prises en charge sont indisponibles. Un lecteur d’un autre fabricant peut lire la musique, mais ne peut pas utiliser l’éditeur d’effets d’EffeTune.

Dans la bibliothèque d’IR Reverb, **Envoyer un fichier…** importe un fichier IR de 64 MiB maximum sur le lecteur choisi, et **Télécharger** enregistre une IR composée d’un seul fichier sur l’appareil que vous utilisez. Les paires True Stereo peuvent être sélectionnées, mais pas transférées. Pour supprimer des IR, ouvrez la bibliothèque sur le lecteur lui-même. Les transferts ont lieu uniquement à votre demande ; les bibliothèques ne sont pas copiées automatiquement entre appareils.

Si la connexion est perdue, le lecteur reste sélectionné et la modification est désactivée jusqu’à la reconnexion. Celle-ci relit ses réglages actuels sans renvoyer les modifications non confirmées. Pour vous reconnecter, choisissez **Change connection**, puis **Connect effects**. Le bouton de télécommande continue de gérer l’accès à cet ordinateur ; les liens d’appairage, l’éditeur dans le navigateur et les fenêtres distantes séparées restent disponibles.

<a id="pwa"></a>

## Écouter et piloter depuis la PWA

Sur le même réseau, la [PWA EffeTune](https://effetune.frieve.com/effetune.html) peut lire la musique partagée d’un ordinateur avec les effets EffeTune de votre téléphone, ou piloter la lecture et les effets des ordinateurs EffeTune enregistrés. **Library** et l’appareil de lecture démarrent tous deux sur **This device**. La PWA utilise les appareils que vous ajoutez ; elle ne détecte pas les autres serveurs musicaux.

1. Sur l’ordinateur, ouvrez **Paramètres > Télécommande...**, activez **Autoriser la télécommande**, puis choisissez **Copier le lien**. Pour parcourir sa musique, partagez aussi des dossiers via **Partage de la bibliothèque**, comme indiqué plus haut. Il n’est pas nécessaire d’autoriser les contrôleurs OpenHome.
2. Dans le sélecteur d’appareils de lecture de la PWA, choisissez **Add device…**. Collez le lien dans **Pairing link**, puis choisissez **Connect**. Autorisez l’accès au réseau local lorsque le navigateur le demande. Utilisez **Scan QR code** si cette option apparaît ; sinon, collez le lien. Ouvrir le QR code avec l’appareil photo habituel du téléphone ouvre l’éditeur distant séparé.

Choisissez l’ordinateur dans **Library** pour retrouver les neuf vues de navigation. Gardez **This device** comme appareil de lecture pour écouter avec les effets de la PWA, ou choisissez un ordinateur enregistré et ouvrez **Effect Pipeline** pour modifier ses effets. Pour lire la musique de l’ordinateur A sur B, ajoutez les deux, puis choisissez A comme bibliothèque et B comme lecteur. Changer la sélection n’arrête pas le lecteur précédent et ne déplace pas sa file.

Rouvrez **Add device…** pour gérer **Saved devices**. Si l’adresse ou le code de connexion change, utilisez **Update connection** avec un nouveau lien ; utilisez **Remove** pour supprimer l’enregistrement. **Refresh** actualise la disponibilité et les paramètres de partage. Effacer les données du navigateur supprime les appareils enregistrés ; si le stockage est indisponible, l’enregistrement ne dure que le temps de la session. Les anciens ordinateurs peuvent proposer **Open remote editor** au lieu de la lecture depuis la PWA.

Utilisez un navigateur Chromium récent et autorisez l’accès au réseau local. La prise en charge varie ; consultez les [permissions réseau local de Chrome](https://developer.chrome.com/blog/local-network-access) et la [prise en charge de WebSocket](https://developer.chrome.com/release-notes/147). Les liens HTTP ne sont pas chiffrés : utilisez-les uniquement sur un réseau de confiance. Safari/iOS et les navigateurs sans prise en charge du HTTP local nécessitent une [configuration HTTPS de confiance](../../remote-v1.md#encrypted-connections), avec un certificat correspondant à l’adresse IP de l’ordinateur et reconnu par le navigateur. Les règles du navigateur ou du système peuvent encore bloquer l’accès ; scanner un QR code ne rend pas le certificat fiable.

La PWA ne peut pas envoyer ses fichiers locaux à un autre lecteur ; choisissez une bibliothèque partagée sur un ordinateur. Gardez la source et le lecteur éveillés et connectés. Fermer la PWA n’arrête pas la lecture sur un autre ordinateur tant que la source et le lecteur peuvent communiquer. La lecture sur le téléphone dépend des formats qu’il prend en charge et peut se mettre en pause lorsque l’application passe en arrière-plan.

## Limites de la lecture en réseau

La détection automatique des serveurs et le partage de dossiers musicaux nécessitent l’application de bureau. La PWA se connecte aux ordinateurs EffeTune enregistrés, comme indiqué plus haut. Les formats lisibles et le déplacement dans une piste dépendent de la destination et de la source ; l’audio n’est pas converti. Les segments CUE ne peuvent pas être envoyés comme pistes réseau distinctes. La lecture sans interruption et la synchronisation multiroom ne sont pas garanties. Si un serveur ou lecteur disparaît, vérifiez qu’il est éveillé, sur le même réseau et autorisé par le pare-feu du réseau privé, puis actualisez la liste. Le partage s’arrête lorsque l’application source se ferme ou que son ordinateur se met en veille.

[← Retour au README](README.md)
