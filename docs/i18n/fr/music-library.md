---
title: "Utiliser la Bibliothèque musicale - Parcourir et lire vos fichiers musicaux locaux - EffeTune"
description: "Découvrez comment créer une Bibliothèque musicale dans EffeTune, rechercher et lire de la musique à partir de sous-dossiers ou de métadonnées, et gérer les listes de lecture."
lang: fr
---

# Utiliser la Bibliothèque musicale

La Bibliothèque musicale indexe les dossiers de musique que vous sélectionnez afin de parcourir votre collection locale par morceaux, fichiers, albums, artistes, genres, sous-dossiers, dossiers, ajouts récents ou listes de lecture. Comme pour la lecture normale de fichiers musicaux, le son passe par le pipeline d’effets EffeTune actif.

La Bibliothèque musicale enregistre son catalogue, le cache des pochettes et les listes de lecture dans l’application. Elle ne modifie, ne renomme, ne déplace et ne supprime jamais vos fichiers audio.

## Environnements disponibles {#availability}

- **Application de bureau :** utilise l’analyse complète des dossiers et conserve les dossiers sélectionnés d’un lancement à l’autre. Elle permet aussi d’afficher un morceau dans son dossier.
- **Navigateurs Chromium sur PC avec File System Access :** conservent l’accès aux dossiers sélectionnés après un rechargement. Le navigateur peut redemander l’autorisation.
- **Navigateurs mobiles, Safari, Firefox et autres navigateurs sans File System Access :** ne conservent l’accès aux fichiers sélectionnés que pendant la session en cours. Le catalogue reste enregistré, mais sélectionnez de nouveau le dossier ou les fichiers après chaque rechargement pour qu’EffeTune puisse les rattacher.

La Bibliothèque musicale indexe les extensions de fichiers audio courantes telles que MP3, WAV, OGG, FLAC, Opus, M4A et AAC. Elle peut aussi utiliser une feuille CUE externe pour découper en pistes individuelles un fichier d’album WAV ou FLAC placé dans le même dossier.

Pour inclure les fichiers MP4, WebM, M4V, MOV, MKV et 3GP, activez **Inclure les formats vidéo dans la Bibliothèque musicale** dans **Paramètres > Configuration... > Général**, puis ajoutez un dossier ou relancez son analyse. Cette option est désactivée par défaut ; sa modification ne change pas immédiatement le catalogue existant. La prise en charge effective de la lecture, y compris le codec audio d’un fichier vidéo, dépend du décodeur du navigateur ou du système d’exploitation. Pour l’affichage des vidéos, consultez le [guide du lecteur de musique](music-player.md#video).

## Ouvrir la Bibliothèque musicale

- **Disposition ordinateur :** cliquez sur le bouton **Bibliothèque musicale** dans l’en-tête.
- **Disposition mobile :** ouvrez l’onglet **Bibliothèque** dans la navigation en bas de l’écran.
- **Application de bureau :** utilisez aussi **Affichage > Bibliothèque musicale** ou **Ctrl+L** (**Command+L** sur macOS).

Pour revenir à l’édition des effets, cliquez sur le bouton **Effect Pipeline** en disposition ordinateur, revenez à l’onglet **Effets** en disposition mobile, ou utilisez **Affichage > Effect Pipeline** ou **Ctrl+E** (**Command+E** sur macOS) dans l’application de bureau.

Pour afficher la Bibliothèque musicale dès le démarrage, ouvrez **Paramètres > Configuration...**, puis réglez **Vue au démarrage :** sur **Bibliothèque musicale**. Utilisez la liste située à côté de Bibliothèque musicale pour choisir la vue ouverte en premier : **Morceaux**, **Fichiers**, **Albums**, **Artistes**, **Genres**, **Sous-dossiers**, **Dossiers** ou **Listes de lecture**.

## Ajouter un dossier de musique

1. Ouvrez la Bibliothèque musicale.
2. Sélectionnez **Ajouter un dossier de musique**.
3. Choisissez le dossier contenant votre musique. Sur mobile ou dans les navigateurs utilisant le mode de repli, le sélecteur peut demander de choisir le contenu du dossier au lieu d’accorder un accès persistant au dossier.
4. Attendez la fin de l’analyse. La ligne d’état affiche le nombre de morceaux et d’albums ainsi que la progression de l’indexation.

Si vous ajoutez un dossier déjà inclus dans un dossier existant de la bibliothèque, EffeTune vous avertit au lieu d’indexer des doublons. Si vous ajoutez un dossier parent contenant des dossiers déjà indexés, EffeTune propose de les fusionner dans le nouveau dossier.

## Parcourir et rechercher

Utilisez les onglets de navigation pour parcourir votre collection :

- **Morceaux :** tous les morceaux indexés (tableau triable sur PC, liste compacte sur mobile).
- **Fichiers :** morceaux classés par chemin de fichier pour les choisir directement. Les pistes définies par une feuille CUE apparaissent comme des entrées distinctes.
- **Albums :** albums regroupés à partir des métadonnées des morceaux.
- **Artistes :** artistes et artistes d’album issus des métadonnées (les valeurs séparées par des points-virgules comme `Artist A; Artist B` sont indexées sous chaque artiste tout en conservant l’affichage complet).
- **Genres :** genres regroupés à partir des métadonnées.
- **Sous-dossiers :** morceaux regroupés selon leur sous-dossier parent direct dans chaque dossier racine indexé (par exemple `Artist/Album`).
- **Dossiers :** dossiers racines enregistrés, état d’analyse et hiérarchie de dossiers.
- **Ajouts récents :** morceaux récemment indexés.
- **Listes de lecture :** listes de lecture créées ou importées dans la Bibliothèque musicale.

Dans **Dossiers**, ouvrez une racine enregistrée pour parcourir ses dossiers en **Arborescence** ou passez en **Vue à plat** pour lister d’un coup tous les morceaux de cette racine. En **Arborescence**, les dossiers à sous-dossier unique qui ne contiennent aucun morceau direct sont regroupés sur une seule ligne (par exemple `Artist / Album`) pour accéder directement au dossier de l’album, tandis que le fil d’Ariane permet d’ouvrir tout dossier intermédiaire.

Utilisez **Rechercher dans la bibliothèque** pour filtrer les morceaux, albums, artistes et listes de lecture. Les termes d’au moins trois caractères correspondent à n’importe quelle partie du titre, de l’artiste, de l’album, du genre, du nom de fichier ou du chemin ; les termes d’un ou deux caractères correspondent au début des mots. Sur PC, cliquez sur les en-têtes du tableau des morceaux (**N° de piste**, **Titre**, **Artiste**, **Album**, **Genre** ou **Durée**) ou utilisez la liste **Trier** dans les autres vues. Sur mobile, utilisez la liste **Trier** dans toutes les vues hors listes de lecture enregistrées.

Lorsqu’un résultat de recherche, un niveau de dossier, un album, un artiste, un genre, un sous-dossier ou une liste de lecture contient 300 morceaux ou moins, tous les morceaux sont sélectionnés par défaut pour lancer la lecture immédiatement. À partir de 301 morceaux, rien n’est sélectionné automatiquement ; utilisez les cases à cocher des lignes, **Tout sélectionner** ou **Tout désélectionner** pour modifier la sélection. Sur mobile, maintenez le doigt sur une ligne de morceau pour afficher les cases à cocher et les commandes de sélection.

Si les tags sont absents, EffeTune utilise le nom du fichier et du dossier. Les propriétés d’un morceau affichent le chemin du fichier, le format, la fréquence d’échantillonnage, la profondeur de bits, le débit binaire, les métadonnées et, pour les pistes CUE, le chemin de la feuille CUE et la plage du morceau.

## Fichiers d'album avec CUE

Placez une feuille `.cue` externe dans le même dossier que les fichiers WAV ou FLAC qu’elle référence, puis ajoutez ou analysez de nouveau le dossier. Chaque entrée `TRACK ... AUDIO` valide apparaît comme un morceau distinct dans la Bibliothèque musicale.

Pour la pochette, la Bibliothèque musicale vérifie d’abord l’image intégrée au fichier audio source, puis recherche à côté du fichier `.cue` les fichiers `cover.jpg`, `cover.png`, `front.jpg`, `front.png` ou une image portant le nom du fichier audio.

Vous pouvez aussi ouvrir une feuille `.cue` directement depuis le lecteur (**Ouvrir des fichiers musicaux**, **Fichier > Ouvrir un fichier musical...** sur ordinateur, ou **Ouvrir la musique** sur mobile) :
- **Application de bureau :** sélectionnez uniquement le fichier `.cue`.
- **Navigateur Chromium sur PC :** si le dossier de l’album est déjà enregistré dans la Bibliothèque musicale avec l’autorisation accordée, sélectionnez uniquement le fichier `.cue`.
- **Autres navigateurs :** sélectionnez le fichier `.cue` avec tous les fichiers WAV/FLAC qu’il référence, et uniquement ceux-là, ainsi qu’une image de pochette correspondante si vous le souhaitez.

Si une feuille CUE n’est pas valide ou si ses fichiers audio ne peuvent pas être associés, EffeTune vous en informe et importe chaque fichier WAV ou FLAC comme un seul morceau couvrant tout le fichier. Corrigez la feuille CUE ou les noms de fichiers, puis réanalysez le dossier pour réessayer.

## Lire depuis la bibliothèque

Sélectionnez un morceau, un album, un artiste, un genre, un sous-dossier, un dossier, un résultat de recherche ou une liste de lecture, puis choisissez :

- **Lire** pour remplacer la file d’attente actuelle du lecteur et démarrer la lecture.
- **Aléatoire** pour lire la sélection dans un ordre aléatoire.
- **Lire ensuite** pour insérer la sélection juste après le morceau en cours.
- **Ajouter à la file** pour ajouter la sélection à la fin de la file d’attente.
- **Ajouter à une liste** pour enregistrer la sélection dans une liste de lecture de la Bibliothèque musicale.

Sur PC, double-cliquez sur une ligne de morceau pour lancer la lecture à partir de ce titre, ou faites un clic droit / ouvrez **Plus** pour accéder aux actions du morceau. Sur mobile, touchez un morceau pour le lire ou maintenez le doigt dessus pour sélectionner plusieurs morceaux.

## Mettre à jour et reconnecter les dossiers

Utilisez **Analyser à nouveau** après avoir ajouté, supprimé, renommé ou modifié les tags de fichiers dans vos dossiers de musique. La nouvelle analyse met à jour les morceaux modifiés, retire les fichiers supprimés du catalogue et rattache automatiquement les entrées de listes de lecture lorsque des fichiers correspondants sont trouvés.

État des dossiers dans **Dossiers** :
- **OK :** prêt à être parcouru et lu.
- **Non analysé :** ajouté, mais pas encore indexé.
- **Introuvable :** le chemin du dossier est introuvable.
- **Reconnecter :** l’autorisation du navigateur ou du dossier est de nouveau requise ; cliquez sur **Reconnecter** et accordez l’accès au même dossier.

Si un morceau de la bibliothèque ne peut pas être ouvert parce que son dossier est hors ligne, reconnectez ou réimportez ce dossier.

Choisir **Retirer** enlève uniquement le dossier du catalogue d’EffeTune ; vos fichiers sur le disque ne sont jamais supprimés.

## Listes de lecture

Les listes de lecture de la Bibliothèque musicale sont enregistrées dans EffeTune et peuvent regrouper des morceaux issus de n’importe quel dossier indexé :

- Créez une liste de lecture à partir de morceaux sélectionnés dans la bibliothèque ou enregistrez la file d’attente actuelle du lecteur comme liste de lecture.
- Utilisez **Renommer**, **Dupliquer** et **Supprimer** pour gérer vos listes de lecture, et faites glisser les morceaux (ou utilisez **Monter** / **Descendre**) pour modifier leur ordre.
- Utilisez **Importer une liste** pour les fichiers M3U, M3U8, PLS et XSPF, et **Exporter M3U8** ou **Exporter XSPF** depuis une liste de lecture pour l’exporter.

### Titres récemment écoutés et Favoris

Deux listes de lecture automatiques apparaissent dans la grille des listes de lecture dès qu’elles sont utilisées :

- **Titres récemment écoutés :** conserve les 100 derniers morceaux distincts lus depuis la Bibliothèque musicale, du plus récent au plus ancien.
- **Favoris :** regroupe les morceaux marqués avec l’**☆** affichée à côté d’un morceau sur PC, ou avec **Ajouter aux favoris** dans le menu **Plus** du morceau (également accessible par clic droit sur PC). Cliquez sur le bouton de lecture de la carte **Favoris** pour lancer la liste immédiatement.

Leur nom suit la langue de l’interface et ne peut pas être renommé, mais vous pouvez les dupliquer, les exporter ou les supprimer comme n’importe quelle liste de lecture.

### Importer et exporter des listes de lecture

L’analyse d’un dossier importe automatiquement les fichiers de listes de lecture pris en charge trouvés dans vos dossiers de musique et les met à jour lors d’une nouvelle analyse si le fichier a changé sur le disque ; cette mise à jour remplace les modifications apportées à cette liste dans EffeTune. Les entrées sans correspondance sont conservées comme éléments non résolus afin d’être rattachées automatiquement lorsque le dossier correspondant est ajouté ou reconnecté.

Lors de l’exportation d’une liste de lecture, activez **Chemins relatifs** si vous souhaitez déplacer le fichier M3U8 ou XSPF exporté avec votre dossier de musique. Comme les formats M3U8 et XSPF standard ne stockent pas les plages de sous-pistes CUE, les pistes CUE sont omises à l’exportation et EffeTune indique combien ont été ignorées.

## Sécurité et stockage

- La Bibliothèque musicale lit les fichiers audio et les métadonnées sans jamais modifier vos fichiers sur le disque.
- Effacer les données de site du navigateur supprime le catalogue et les listes de lecture de l’application web ; exportez vos listes importantes pour les conserver.
- Les grandes collections sont chargées progressivement au fil du défilement. Utilisez la Bibliothèque musicale dans une seule fenêtre EffeTune à la fois.

[← Retour au README](README.md)
