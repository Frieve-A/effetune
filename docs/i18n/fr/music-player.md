---
title: "Lecteur de musique - EffeTune"
description: "Lisez des fichiers musicaux et vidéo à travers la chaîne d’effets d’EffeTune, changez la vitesse de lecture, utilisez le mini-lecteur et configurez la lecture sans interruption et ReplayGain."
lang: fr
---

# Lecteur de musique

Ouvrez un fichier musical dans EffeTune pour l’écouter à travers la chaîne d’effets actuelle. Les commandes du lecteur permettent de mettre en pause, de reprendre la lecture ou de régler la vitesse.

## Ouvrir des fichiers musicaux

- Cliquez sur **Ouvrir des fichiers musicaux** (le bouton dossier de l’en-tête) ou faites glisser des fichiers musicaux dans la fenêtre.
- **Application de bureau :** choisissez **Fichier > Ouvrir un fichier musical...** ou ouvrez un fichier musical avec EffeTune depuis votre système d’exploitation.
- **Disposition mobile :** touchez **Ouvrir la musique**.

Pour utiliser uniquement le lecteur, réglez **Périphérique d'entrée :** sur **Aucun (lecteur de fichiers musicaux uniquement)** dans **Configuration audio** : EffeTune n’utilise alors aucune entrée audio en direct.

## Fichiers DSD {#dsd-files}

Ouvrez les fichiers `.dsf` (DSF) ou `.dff` (DSDIFF) comme les autres fichiers musicaux. Les fichiers DFF non compressés et compressés en DST sont pris en charge. EffeTune convertit en PCM les fichiers DSD64, DSD128 et DSD256 comptant jusqu’à six canaux (5.1) pour les lire avec les effets actuels. L’appareil audio reçoit du PCM, et non du DSD natif ou du DoP.

Les effets reçoivent les canaux DSD dans l’ordre du fichier. Si cet ordre diffère de celui des sorties de vos enceintes, placez [**Matrix**](plugins/basics.md#matrix) en tête de la chaîne d’effets. Pour lire un fichier DSF à cinq canaux sur une sortie 5.1 standard, reliez les entrées 1 à 3 aux sorties de même numéro, l’entrée 4 à la seule sortie 5 et l’entrée 5 à la seule sortie 6. La sortie 4 (LFE) reste ainsi silencieuse.

Certaines variantes d’encodage DST (trames segmentées), les fichiers de plus de six canaux, le DSD512 et le DSD basé sur 48 kHz ne sont pas pris en charge. Si un fichier ne peut pas être lu, utilisez un DFF non compressé ou une copie PCM compatible, par exemple en FLAC ou WAV. La lecture des fichiers DSD est disponible dans l’application de bureau et le lecteur web/PWA, mais pas dans l’application Android native.

Les fichiers DSD à fréquence élevée demandent davantage de puissance de traitement, surtout à vitesse de lecture accélérée. Si le son s’interrompt ou si la lecture s’arrête, réduisez la vitesse.

## Fichiers MIDI

La lecture MIDI et MusicXML et l’ajout de ces fichiers à la bibliothèque sont disponibles dans l’application de bureau et le lecteur web/PWA. Ces fonctions ne sont pas prises en charge dans l’application Android.

Ouvrez les fichiers `.mid`, `.midi` ou `.kar` avec le sélecteur musical habituel ou par glisser-déposer. MIDI contient des notes et leur chronologie, pas du son enregistré. Ajoutez [**SoundFont Player**](plugins/others.md#soundfont-player) depuis **Others** dans Effect Pipeline, puis choisissez un instrument avec **SoundFont Library…**. L’ouverture du fichier n’ajoute pas d’instrument automatiquement. Vous pouvez aussi l’ajouter à Music Library.
Pour afficher les paroles dans **Lyrics** de Visualizer, utilisez les paroles intégrées au MIDI ou placez un fichier `.wrd` de même nom à côté. Sur le Web, sélectionnez ou déposez les deux fichiers ensemble, sauf si le dossier est accessible via Music Library. Le `.wrd` accompagne le morceau sans créer de piste ; si sa lecture échoue, le MIDI continue.

Pour afficher une pochette avec un fichier MIDI ou MusicXML, placez `cover.jpg` (prioritaire) ou `folder.jpg` dans le même dossier. Sur le Web, sélectionnez ou déposez l’image avec le fichier musical, sauf si le dossier est accessible depuis Music Library.

Utilisez **Ouvrir des fichiers musicaux** ou faites glisser une archive ZIP, LZH/LHA, tar, gzip ou tar compressée avec gzip pour lire les fichiers MIDI, KAR et MusicXML qu’elle contient. Cela fonctionne aussi lorsque les options de la bibliothèque sont désactivées. Si les archives sélectionnées contiennent au moins deux fichiers lisibles, choisissez ceux que vous voulez ouvrir. S’ils sont trop volumineux pour être ouverts ensemble, sélectionnez-en moins. Le lecteur utilise les paroles du fichier `.wrd` correspondant et la pochette qui se trouvent dans le dossier du morceau à l’intérieur de l’archive.

Si vous lancez un morceau pendant le chargement de l’instrument choisi, la lecture attend que celui-ci soit prêt pour que vous entendiez les premières notes. Si un autre instrument est prêt ou qu’une sortie MIDI est connectée, la lecture démarre immédiatement.

Si SoundFont Player est absent ou qu’aucun instrument n’est sélectionné, et qu’aucun [périphérique de sortie MIDI externe](#midi-output-device) n’est connecté, le lecteur affiche des indications et continue d’envoyer le MIDI au rythme du morceau, en silence, sans passer au suivant. Le morceau se termine normalement. Vous pouvez ajouter SoundFont Player ou charger un instrument pendant la lecture : une fois prêt, il réagit aux événements MIDI qui suivent, avec les sons et réglages de contrôle actuels de chaque canal. Les notes précédentes ne sont pas rejouées, même si elles sont encore tenues dans le morceau.

Les commandes habituelles de lecture, pause, déplacement, répétition, lecture aléatoire, vitesse, volume et coupure du son restent disponibles. La vitesse modifie le rythme du MIDI sans changer la hauteur des notes. **Conserver la hauteur** n’est pas disponible pendant la lecture MIDI. Avec une collection SF2/SF3, un seul SoundFont Player suit Bank Select et Program Change indépendamment sur les 16 canaux, avec la banque de percussions sur le canal 10 par défaut. Utilisez **MIDI Mixer** pour régler le **Patch**, le niveau et les autres commandes de jeu de chaque canal. Ces modifications sont temporaires, suivent les messages MIDI ultérieurs et sont réinitialisées au morceau suivant. Les instruments SFZ gardent leurs propres correspondances.

Pour enregistrer de l’audio, préparez l’instrument dans SoundFont Player et sélectionnez le MIDI dans le traitement de fichiers hors ligne. Le morceau entier est traité avec cet instrument et les effets suivants, à vitesse 1 et gain de morceau unitaire, puis enregistré en WAV ou FLAC selon vos réglages. Si la durée maximale de résonance est atteinte, l’application vous avertit et coupe le son restant.

Les Standard MIDI File de formats 0 et 1 sont acceptés. Convertissez les fichiers de format 2 ou RMID en `.mid` standard de format 0 ou 1 avant de les ouvrir.

### Jouer avec un appareil MIDI externe {#midi-output-device}

Pour lire des fichiers MIDI sur un module de sons ou un synthétiseur matériel, ou sur un synthétiseur logiciel via un port MIDI virtuel, sélectionnez-le dans **Périphérique de sortie MIDI**, dans **Configuration audio**. Cette option se trouve sous **Périphérique d’entrée MIDI**, et **Actualiser les périphériques MIDI** met à jour les deux listes. La valeur par défaut est **Aucun**. Dans la version web, autorisez l’accès MIDI lorsque le navigateur le demande, y compris pour les messages système exclusifs.

Tant que le périphérique est connecté, la lecture MIDI et MusicXML lui envoie au bon moment les messages MIDI du fichier, y compris les messages système exclusifs, en suivant les déplacements, la pause, l’arrêt et les changements de vitesse. Les paroles et autres textes du fichier ne sont pas envoyés. EffeTune fonctionne alors comme un simple lecteur MIDI, et SoundFont Player est facultatif ; s’il a un instrument chargé, les deux sonnent en même temps. Le son du périphérique externe ne traverse pas les effets d’EffeTune, et ni le curseur de volume ni le bouton de sourdine du lecteur ne l’affectent : utilisez le volume du périphérique lui-même. L’enregistrement audio décrit plus haut continue d’utiliser uniquement SoundFont Player.

## Fichiers MusicXML {#musicxml-files}

Ouvrez les fichiers `.musicxml`, `.xml` ou `.mxl` compressés comme des fichiers MIDI. Pour les écouter, ajoutez **SoundFont Player** et chargez un instrument, ou utilisez un [périphérique de sortie MIDI externe](#midi-output-device). Ils utilisent les commandes MIDI décrites ci-dessus, mais la partition ne s’affiche pas. Vous pouvez aussi les ajouter à Music Library.
Les paroles MusicXML peuvent s’afficher dans **Lyrics** de Visualizer pendant la lecture. Choisissez une **Partie** et un **Couplet** si la partition en contient plusieurs, ou gardez **Automatique**.

Les notes, silences, accords, voix, liaisons de tenue, changements de tempo et reprises habituelles avec fins alternatives sont pris en charge. Certains détails de notation, tels que les ornements et les appoggiatures, ne sont pas reproduits. Si la partition contient des reprises imbriquées, des signes de répétition de mesure ou des notes microtonales, ou dépend de D.C., D.S., Coda ou Fine, ou si le fichier est un recueil opus de plusieurs partitions, exportez-la en fichier MIDI standard depuis un logiciel de notation, puis ouvrez ce fichier.

## Commandes de lecture

- La mise en pause, la reprise et la fermeture du lecteur avec **×** s’accompagnent d’un court fondu pour éviter les clics.
- Cliquez sur le bouton de vitesse à côté du bouton **Aléatoire** pour choisir l’un des neuf préréglages ou régler n’importe quelle vitesse de `0.25x` à `4x` par pas de `0.01x`. **Conserver la hauteur** est activé par défaut : la hauteur reste la même quand la vitesse change. Désactivez-le pour que la hauteur monte et descende avec la vitesse, comme sur une bande ou un disque.
- Dans l’application de bureau, choisissez **Affichage > Mini-lecteur** (`Ctrl/Cmd+Shift+M`) ou cliquez sur le bouton mini-lecteur du lecteur pour passer à une fenêtre compacte. Cliquez sur le bouton d’épingle pour la garder toujours au premier plan.

Le lecteur de bureau affiche aussi la [musique en réseau et AirPlay](openhome.md). Pendant AirPlay, les informations du morceau, la pochette et le temps apparaissent lorsqu’ils sont transmis par l’émetteur ; survolez le titre pour en savoir plus. Commandez la lecture et le volume depuis l’appareil émetteur. Fermer le lecteur avec **×**, ou utiliser **Arrêter**, met fin à cette session ; le récepteur reste activé et disponible pour une nouvelle connexion.

Le curseur de volume et le bouton de sourdine règlent le son du lecteur avant son passage dans les effets. Les changements effectués à distance sont également affichés ici : vous pouvez ainsi vérifier le volume et rétablir le son sur l’appareil qui lit la musique.

## Reprendre là où vous vous êtes arrêté

Lorsque vous rouvrez l’application de bureau ou l’application web, le lecteur retrouve la file d’attente et se met en pause à la dernière position enregistrée dans le morceau en cours. La vitesse de lecture revient à 1x. La position est enregistrée toutes les 10 secondes environ pendant la lecture. Les changements effectués juste avant de quitter peuvent donc être perdus.

Les deux versions retrouvent les morceaux de la bibliothèque. La version de bureau retrouve aussi les fichiers locaux ouverts directement. Sur le web, le navigateur peut vous demander de sélectionner à nouveau votre dossier de musique au moment de lancer la lecture. Ajoutez à nouveau les fichiers ouverts directement dans la version web et les morceaux provenant du réseau.

Pour retrouver les morceaux d’une archive, lisez-les depuis la bibliothèque. Si vous avez ouvert l’archive directement, ouvrez-la de nouveau.

Pour effacer la file enregistrée, fermez le lecteur avec **×**. Si une fonction de réception ou de commande à distance conserve la file, désactivez-la, puis fermez le lecteur affiché avec **×**.

## Lecture sans interruption

**Lecture sans interruption**, dans **Configuration audio**, est activée par défaut et enchaîne sans blanc les morceaux locaux compatibles ; la prise en charge dépend du format du fichier et de l’environnement, navigateur ou application. Les formats non pris en charge et certains environnements mobiles utilisent un mode de secours économe en mémoire, si bien qu’un bref silence peut subsister. La désactiver privilégie une faible consommation de mémoire et la stabilité, au prix d’un bref silence possible ; ce changement n’interrompt pas le morceau en cours. La lecture sans interruption ne fonctionne qu’à la vitesse 1x ; changer la vitesse pendant une lecture sans interruption relance le morceau à la même position après une brève coupure.

Dans l’application de bureau, lorsque le **Pilote** de **Configuration audio** est autre que **Standard**, les fichiers WAV et FLAC multicanaux jusqu’à six canaux sont eux aussi lus sans interruption. Les effets reçoivent leurs canaux dans l’ordre du fichier. Si cet ordre diffère de celui des sorties de vos enceintes, placez [**Matrix**](plugins/basics.md#matrix) en tête de la chaîne d’effets, comme pour le [DSD multicanal](#dsd-files).

## ReplayGain

Dans **Configuration audio**, activez **ReplayGain** pour réduire les écarts de volume entre enregistrements. Le lecteur utilise en priorité les [mesures de la bibliothèque](music-library.md#loudness-analysis), puis les balises ReplayGain du fichier, dont `R128_TRACK_GAIN` et `R128_ALBUM_GAIN` pour Opus. En l’absence de mesure et de balise, le morceau conserve son volume d’origine.

- **Désactivé** (par défaut) conserve le volume d’origine.
- **Piste** : amène tous les morceaux à un volume comparable. À choisir pour la lecture aléatoire et les listes qui mélangent plusieurs albums.
- **Album** : ajuste chaque album comme un tout et conserve les écarts de volume entre ses morceaux, par exemple une introduction calme. À choisir pour écouter un album du début à la fin.

Si seule la valeur de piste ou celle d’album est disponible, elle sert dans les deux modes. Chaque piste CUE mesurée possède sa propre valeur. À défaut, le lecteur utilise les balises du fichier audio référencé.

Avec **Niveau cible** réglé sur **Manuel** (par défaut), la cible est de −18 LUFS. Le **Préampli ReplayGain** (−15 à +15 dB, 0 dB par défaut) permet de la relever ou de l’abaisser. **Automatique** affiche la cible la plus élevée que la proportion de pistes ou d’albums mesurés définie par **Couverture automatique (%)** peut atteindre sans dépasser le **Plafond de crête (dB)**. La couverture initiale est de 95 %. Augmentez-la pour que davantage de morceaux atteignent la cible, ou réduisez-la pour permettre une cible plus élevée. Sans mesure, la cible automatique est de −18 LUFS.

**Éviter l’écrêtage**, activé par défaut, réduit le gain si la crête vraie mesurée ou la crête indiquée dans les balises risque de dépasser le plafond. Abaissez le plafond, initialement à 0 dB, pour laisser de la marge aux effets qui amplifient le signal. Le mode automatique tient compte du plafond même si la protection est désactivée. Les réglages prennent effet pendant la lecture.

La correction s’applique au son du lecteur avant son entrée dans la chaîne d’effets ; la position du curseur de volume ne change pas. ReplayGain ne s’applique pas à la lecture MIDI ou MusicXML, à la musique en réseau, à la réception AirPlay, à la lecture sur des lecteurs OpenHome ou UPnP AV / DLNA, ni au traitement de fichiers hors ligne. ReplayGain est disponible dans l’application de bureau et le lecteur web/PWA, mais pas dans l’application Android.

## Vidéo {#video}

La vidéo s’affiche dans la zone de pochette du lecteur. Dans l’interface de bureau, le panneau du lecteur se développe automatiquement au démarrage d’une vidéo. Vous pouvez le réduire à nouveau pendant la lecture en cours. Déplacez le pointeur sur la vidéo ou touchez-la pour afficher le bouton d’agrandissement ; il disparaît après un court moment sans interaction. Sélectionnez **⛶** pour qu’elle occupe tout l’affichage de l’application ; survolez la vidéo avec le pointeur ou touchez-la pour afficher les commandes de lecture en bas. Vous pouvez aussi ajouter un élément **Video** dans Visualizer. Pour inclure les fichiers vidéo dans la Bibliothèque musicale, consultez le [guide de la Bibliothèque musicale](music-library.md#availability).

Dans l’interface mobile, la vidéo agrandie et ses commandes pivotent ensemble si cela permet de mieux occuper l’écran. **Faire pivoter la vidéo agrandie sur mobile**, dans **Paramètres > Configuration... > Affichage**, est activé par défaut ; désactivez cette option pour empêcher la rotation. Le retour au petit lecteur rétablit l’affichage normal. L’interface de bureau et les réglages d’orientation de l’appareil restent inchangés.

Hors de Mini Player, utilisez ces gestes sur la vidéo ou les bandes noires qui l’entourent :

- **Souris :** Cliquez pour lire ou mettre en pause. Double-cliquez pour agrandir la vidéo ou rétablir sa taille sans modifier son état de lecture ou de pause.
- **Écran tactile :** Touchez la vidéo pour afficher les commandes. Lorsqu’elle est agrandie, touchez deux fois la moitié gauche pour reculer de 10 secondes ou la moitié droite pour avancer de 10 secondes. Un double toucher sur le petit aperçu ne change pas la position de lecture.

Les boutons et curseurs conservent leur fonctionnement habituel.

## Lire sur un autre appareil

Dans le sélecteur en haut de la fenêtre, choisissez **This device**, un lecteur OpenHome ou un lecteur UPnP AV / DLNA. La bibliothèque et le lecteur se choisissent séparément. Changer de lecteur n’arrête pas le précédent et ne déplace pas sa file. La piste, la file, la position et les commandes prises en charge sont affichées, dont **Volume** et **Muet** si disponibles. Les modifications des autres contrôleurs sont également reflétées.

Le son transmis est celui d’origine, sans les effets de l’ordinateur source. Un lecteur EffeTune applique ses propres effets. Le serveur et le lecteur doivent pouvoir communiquer. La file propre à OpenHome peut continuer après la déconnexion du contrôleur ; une séquence gérée par EffeTune ou une connexion passant par un ordinateur EffeTune exige que celui-ci reste allumé.

[musique en réseau et télécommande](openhome.md)

[← Retour au README](README.md)
