---
title: "Utiliser la Bibliothèque musicale - EffeTune"
description: "Découvrez comment créer une Bibliothèque musicale dans EffeTune, rechercher et lire de la musique à partir de sous-dossiers ou de métadonnées, et gérer les listes de lecture."
lang: fr
---

# Utiliser la Bibliothèque musicale

La version 2.1.0 introduit la Bibliothèque musicale compatible avec les fichiers CUE et fondée sur le schéma de catalogue v3. Les dossiers et les playlists de l'ancienne Bibliothèque musicale ne sont pas repris : ajoutez de nouveau vos dossiers, puis recréez ou réimportez vos playlists. L'ancien catalogue et vos fichiers audio ne sont pas modifiés.

La Bibliothèque musicale indexe les dossiers de musique que vous choisissez et vous permet de parcourir votre collection locale par morceaux, albums, artistes, genres, sous-dossiers, dossiers, ajouts récents et listes de lecture. Comme pour la lecture normale des fichiers musicaux, le son passe par le pipeline d'effets EffeTune actuel.

La Bibliothèque musicale enregistre le catalogue interne de l'application, le cache des illustrations et les listes de lecture. Elle ne modifie, ne renomme, ne déplace et ne supprime jamais les fichiers musicaux eux-mêmes.

## Environnements disponibles

- **Application de bureau :** utilise l'analyseur de dossiers complet et permet de réutiliser les dossiers choisis au prochain démarrage. La version de bureau peut aussi afficher les morceaux dans le dossier qui contient leur fichier.
- **Navigateurs Chromium sur ordinateur avec File System Access :** enregistrent durablement le handle du dossier sélectionné. Il peut être réutilisé après un rechargement une fois l'accès accordé, même si le navigateur peut redemander une autorisation.
- **Navigateurs mobiles, Safari, Firefox et autres navigateurs sans File System Access :** ne conservent les objets `File` sélectionnés que pendant la session de page en cours. Le catalogue reste enregistré, mais les fichiers ne peuvent plus être rouverts après un rechargement. Sélectionnez de nouveau le dossier ou les fichiers après chaque rechargement ; EffeTune les rattache aux entrées existantes grâce au chemin relatif normalisé.

La Bibliothèque musicale indexe les extensions de fichiers multimédias courantes, notamment MP3, WAV, OGG, FLAC, Opus, M4A, AAC, WebM et MP4. Elle peut aussi utiliser une feuille CUE externe pour diviser en morceaux un fichier d'album WAV ou FLAC placé dans le même dossier. Pour les fichiers MP4, EffeTune lit uniquement la piste audio et n'affiche pas la vidéo. La lecture effective, y compris la prise en charge du codec audio contenu dans le MP4, dépend aussi des capacités de décodage du navigateur et du système d'exploitation.

## Ouvrir la Bibliothèque musicale

- **Disposition ordinateur :** cliquez sur le bouton **Bibliothèque musicale** dans l'en-tête.
- **Disposition mobile :** ouvrez l'onglet **Bibliothèque** dans la navigation en bas de l'écran.
- **Application de bureau :** vous pouvez aussi l'ouvrir avec **Affichage > Bibliothèque musicale** ou **Ctrl+L** (**Command+L** sur macOS).

Pour revenir à l'édition des effets, cliquez sur le bouton **Effect Pipeline** en disposition ordinateur, ou revenez à l'onglet **Effets** en disposition mobile. Dans l'application de bureau, vous pouvez aussi utiliser **Affichage > Effect Pipeline** ou **Ctrl+E** (**Command+E** sur macOS).

Si vous voulez afficher la Bibliothèque musicale en premier au démarrage, ouvrez **Paramètres > Configuration...** et réglez **Vue au démarrage :** sur **Bibliothèque musicale**. Dans la liste située à côté de **Bibliothèque musicale**, choisissez la section qui s'affichera en premier : **Morceaux**, **Albums**, **Artistes**, **Genres** ou **Sous-dossiers**.

## Ajouter un dossier de musique

1. Ouvrez la Bibliothèque musicale.
2. Sélectionnez **Ajouter un dossier de musique**.
3. Choisissez le dossier qui contient vos fichiers musicaux. Sur mobile ou dans les navigateurs utilisant la méthode de repli, l'écran peut demander de sélectionner les fichiers du dossier au lieu d'accorder un accès permanent au dossier.
4. Attendez la fin de l'analyse. La ligne d'état affiche le nombre de morceaux et d'albums, ainsi que la progression pendant l'indexation.

Si vous essayez d'ajouter un dossier qui se trouve déjà dans un dossier enregistré, EffeTune affiche un avertissement sans l'indexer en double. Si vous ajoutez un dossier parent qui contient des dossiers déjà enregistrés, vous pouvez fusionner les dossiers existants dans le nouveau dossier.

## Parcourir et rechercher

Les onglets de navigation permettent de changer de catalogue.

- **Morceaux** - affiche tous les morceaux indexés. La disposition ordinateur utilise un tableau triable, tandis que la disposition mobile utilise une liste compacte.
- **Albums** - regroupe les morceaux par album à partir des métadonnées.
- **Artistes** - regroupe les morceaux par artiste ou artiste de l'album dans les métadonnées.
- **Genres** - regroupe les morceaux par genre dans les métadonnées.
- **Sous-dossiers** - regroupe les morceaux selon le sous-dossier qui les contient.
- **Dossiers** - affiche les dossiers de bibliothèque enregistrés et leur état d'analyse.
- **Ajouts récents** - affiche les morceaux récemment indexés.
- **Listes de lecture** - affiche les listes de lecture créées ou importées dans la Bibliothèque musicale.

Une valeur d'artiste de l'album séparée par des points-virgules, comme `Artist A; Artist B`, est indexée sous chaque artiste tout en conservant la mention complète à l'affichage. `&`, `/` et `feat.` ne sont pas considérés comme des séparateurs.

Les groupes **Sous-dossiers** utilisent le chemin du sous-dossier qui contient directement chaque morceau, relatif à son dossier de musique importé. Des chemins relatifs identiques appartenant à des dossiers importés différents restent dans des groupes distincts. Les fichiers placés directement à la racine importée ne créent pas de groupe de sous-dossier, mais restent disponibles dans **Morceaux** et **Dossiers**.

**Rechercher dans la bibliothèque** permet de rechercher dans les morceaux, albums, artistes et listes de lecture. En disposition ordinateur, l'en-tête de la liste des morceaux permet de trier par titre, artiste, album, genre ou durée. Les vues des albums, artistes, genres, sous-dossiers et listes de lecture proposent une liste **Trier** alimentée par le catalogue. Selon la vue, elle permet un tri croissant ou décroissant par nom, artiste, année, chemin, nombre de pistes, durée totale, date de mise à jour ou date de création. Chaque vue conserve son propre choix.

Pour les morceaux, les termes d’au moins trois caractères peuvent correspondre à n’importe quelle partie du titre, de l’artiste, de l’album, du genre, du nom de fichier ou du chemin. Les termes d’un ou deux caractères ne correspondent qu’au début d’un mot. Saisissez au moins trois caractères pour rechercher au milieu d’un mot.

Dans les dispositions ordinateur et mobile, lorsqu’une recherche de morceaux ou la fiche d’un album, d’un artiste, d’un genre, d’un sous-dossier ou d’une liste de lecture contient 300 morceaux ou moins, tous sont sélectionnés par défaut. À partir de 301 morceaux, aucune sélection automatique n’est effectuée. Utilisez les cases des lignes, **Tout sélectionner** ou **Tout désélectionner** pour modifier la sélection.

Sur mobile, la liste normale des titres s'affiche d'abord, sans colonnes d'artiste ni de durée. Seul un appui long sur un morceau ouvre le mode sélection ; les cases à cocher, **Tout sélectionner** et **Tout désélectionner** apparaissent alors, tandis que les actions habituelles des lignes restent disponibles. La sélection automatique et les modifications ultérieures — y compris **Tout sélectionner**, **Tout désélectionner** et les cases individuelles — ne changent que l’état de sélection ; elles n’ouvrent ni ne ferment le mode sélection.

Quand les métadonnées sont absentes ou illisibles, EffeTune utilise le nom du fichier et les informations de dossier pour l'affichage. Les propriétés d'un morceau permettent de consulter le chemin du fichier, le format, la fréquence d'échantillonnage, la profondeur de bits, le débit binaire et les principaux champs de métadonnées. Pour un morceau CUE, elles indiquent aussi son type, le chemin du fichier CUE, le chemin du fichier audio source et sa plage dans ce fichier.

## Fichiers d'album avec CUE

Placez le fichier `.cue` externe à côté des fichiers WAV ou FLAC qu'il désigne, puis ajoutez ou analysez de nouveau ce dossier. Chaque entrée `TRACK ... AUDIO` valide apparaît comme un morceau distinct dans la Bibliothèque musicale. Le titre, l'interprète, la date, le genre et le numéro de piste du fichier CUE sont utilisés lorsqu'ils sont disponibles ; les informations audio techniques proviennent du fichier WAV ou FLAC source.

Pour les pistes ajoutées à la Bibliothèque musicale, EffeTune utilise d’abord la pochette intégrée au fichier audio source. S’il n’y en a pas, il recherche, à côté du fichier CUE et dans cet ordre, `cover.jpg`, `cover.png`, `front.jpg`, `front.png`, puis un fichier JPEG ou PNG portant le nom du fichier audio source, avec ou sans son extension audio. La lecture directe dans l’application de bureau utilise automatiquement ces mêmes images voisines ; ce mode de lecture n’extrait pas la pochette intégrée au fichier audio source. La lecture directe dans le navigateur utilise l’image correspondante accessible depuis les fichiers sélectionnés ou le dossier enregistré.

Vous pouvez aussi lire directement un album CUE avec **Open music files**, ou **Open Music** sur mobile. Dans l’application de bureau, vous pouvez également utiliser **File > Open music file...** ; sélectionnez uniquement le fichier `.cue`. Dans un navigateur Chromium sur PC, ajoutez d’abord le dossier de l’album à la Bibliothèque musicale et autorisez l’accès. Vous pourrez ensuite sélectionner uniquement le fichier `.cue` : EffeTune ouvrira les fichiers WAV ou FLAC référencés et la pochette correspondante depuis ce dossier enregistré, sans ajouter la sélection au catalogue. Les navigateurs sans File System Access doivent toujours recevoir le fichier `.cue` avec tous les fichiers WAV ou FLAC qu’il désigne, et la pochette correspondante si vous souhaitez l’utiliser. Une sélection valide remplace la file actuelle. Si la validation échoue, la file reste inchangée.

Si la feuille CUE n'est pas valide ou ne permet pas d'identifier ses fichiers sources de manière fiable, EffeTune explique le problème et importe les fichiers WAV ou FLAC comme des morceaux ordinaires couvrant tout le fichier. Corrigez la feuille CUE ou les noms de fichiers, puis analysez de nouveau le dossier.

## Lire depuis la bibliothèque

Sélectionnez des morceaux, albums, artistes, genres, sous-dossiers, dossiers, résultats de recherche ou listes de lecture, puis utilisez les actions suivantes.

- **Lire** - remplace la file d'attente actuelle du lecteur et lance la lecture.
- **Aléatoire** - lit les morceaux sélectionnés dans un ordre aléatoire.
- **Lire ensuite** - insère les morceaux sélectionnés juste après le morceau actuel.
- **Ajouter à la file** - ajoute les morceaux sélectionnés à la fin de la file.
- **Ajouter à une liste** - enregistre les morceaux sélectionnés dans une liste de lecture de la Bibliothèque musicale.

Sur ordinateur, vous pouvez double-cliquer sur la ligne d'un morceau pour lancer la lecture depuis cette position, ou ouvrir ses actions par clic droit ou depuis le menu **Plus**. Sur mobile, touchez un morceau dans la liste normale pour le lire ; un appui long active le mode sélection décrit ci-dessus.

Les commandes habituelles du lecteur musical et les réglages de répétition/aléatoire restent disponibles. Sur les appareils avec clavier, les raccourcis clavier habituels du lecteur restent eux aussi disponibles. Si un dossier passe hors ligne et que les morceaux de la bibliothèque ne peuvent plus être ouverts, reconnectez ou réimportez ce dossier.

## Mettre à jour et reconnecter les dossiers

Après avoir ajouté, supprimé, renommé ou modifié les tags de fichiers dans un dossier de musique, utilisez **Analyser à nouveau**. La nouvelle analyse met à jour les morceaux modifiés, retire du catalogue les fichiers introuvables et tente aussi de résoudre à nouveau les entrées de listes de lecture qui n'étaient pas disponibles auparavant.

L'affichage d'état de l'écran **Dossiers** indique si le dossier est disponible.

- **OK** - le dossier est disponible.
- **Non analysé** - le dossier n'a pas encore été indexé.
- **Introuvable** - le dossier ou le chemin enregistré n'est pas disponible.
- **Reconnecter** - EffeTune a besoin d'une nouvelle autorisation d'accès.

Si un dossier affiche **Reconnecter**, sélectionnez **Reconnecter** et autorisez à nouveau l'accès au même dossier. Retirer un dossier ne fait que l'enlever du catalogue de la Bibliothèque musicale ; les fichiers sur le disque ne sont pas supprimés.

## Listes de lecture

Les listes de lecture de la Bibliothèque musicale sont enregistrées dans EffeTune et peuvent contenir des morceaux situés dans des dossiers indexés.

Vous pouvez effectuer les actions suivantes.

- Créer une liste de lecture à partir des morceaux sélectionnés dans la bibliothèque.
- Enregistrer la file actuelle du lecteur comme liste de lecture.
- Renommer, dupliquer, supprimer et réordonner les listes de lecture.
- Faire glisser les morceaux d'une liste de lecture pour modifier leur ordre. Dans les environnements où le glisser-déposer est difficile, utilisez **Monter** et **Descendre**.
- Utiliser **Importer une liste** pour importer des listes de lecture aux formats M3U, M3U8, PLS et XSPF.
- Ouvrir une liste de lecture précise et l'exporter avec **Exporter M3U8** ou **Exporter XSPF**.

### Titres récemment écoutés et Favoris

EffeTune affiche deux listes spéciales aux côtés des listes ordinaires, dans la même grille de cartes. Elles ne sont créées qu'en cas de besoin : **Titres récemment écoutés** au démarrage d'un titre indexé, et **Favoris** lorsque vous marquez un titre d'une étoile pour la première fois.

- **Titres récemment écoutés** conserve les 100 derniers titres distincts, le plus récent en tête. Réécouter un titre le replace en tête.
- **Favoris** contient les titres marqués avec ☆. Sur PC, utilisez l'étoile à côté du titre ; sur mobile, ouvrez le menu **Plus** du titre. Ce même menu s'ouvre aussi d'un clic droit sur PC.

Leur nom est fixe et s'affiche dans la langue actuelle de l'interface ; il ne peut donc pas être modifié. Vous pouvez toutefois dupliquer, exporter ou supprimer ces listes comme les autres. Une liste supprimée est recréée vide la prochaine fois qu'une lecture ou une action sur les favoris en a besoin. Leurs cartes affichent une horloge ou une étoile dans la zone d'illustration ; le bouton de lecture en bas à droite de **Favoris** lance immédiatement la liste. Les listes spéciales sont exclues des résultats de recherche des listes ordinaires.

Lors de l’analyse d’un dossier, EffeTune importe automatiquement les fichiers de listes de lecture pris en charge après l’indexation des pistes et ignore ceux dont le contenu n’a pas changé. Si le contenu d’un fichier situé dans le même dossier et au même chemin relatif change, EffeTune remplace de façon atomique les éléments de la liste importée automatiquement, y compris les modifications apportées à ces éléments dans EffeTune. Une importation échouée ou annulée est retentée lors de l’analyse suivante. La suppression ou le renommage du fichier source ne supprime pas la liste existante, et un fichier renommé est importé comme une nouvelle liste.

Lors de l'importation, un aperçu indique combien d'éléments correspondent à des morceaux de la bibliothèque actuelle. Les éléments sans correspondance sont aussi conservés autant que possible comme éléments non résolus, afin de pouvoir être résolus si le dossier concerné est ajouté ou reconnecté plus tard.

Lors de l'exportation, si vous choisissez **Chemins relatifs**, les chemins sont écrits, quand c'est possible, sous forme de chemins relatifs à partir de l'emplacement d'exportation. C'est utile si vous voulez déplacer une liste de lecture avec le dossier de musique. Les formats M3U8 et XSPF ne peuvent pas conserver la plage d'un morceau CUE dans le fichier de l'album. EffeTune exclut donc ces morceaux et indique leur nombre. Il ne les remplace jamais par le chemin physique du fichier d'album.

## Sécurité et emplacement d'enregistrement

- La Bibliothèque musicale lit les fichiers musicaux et les métadonnées, mais n'écrit aucune modification dans les fichiers musicaux.
- Le cache des illustrations et les listes de lecture sont des données internes à l'application, pas des modifications intégrées aux fichiers musicaux.
- Le classement par **Sous-dossiers** est déduit des chemins relatifs enregistrés dans le catalogue.
- L'espace de stockage du navigateur peut être effacé par les paramètres du navigateur ou par une action de l'utilisateur. Exportez les listes de lecture importantes si nécessaire.
- Dans les navigateurs avec File System Access, les autorisations déterminent si le handle de dossier conservé peut être réutilisé après un rechargement. Avec la méthode de repli, les fichiers sélectionnés ne durent que le temps de la session et doivent toujours être sélectionnés de nouveau après un rechargement.

## Grandes bibliothèques

Le catalogue conserve les données sur le disque et répartit le travail en pages ou en lots limités ; une grande collection n'a donc pas besoin d'être chargée entièrement en mémoire. Les mesures d'échelle et à référence fixe sont des diagnostics locaux et facultatifs destinés au développement. Elles ne conditionnent ni les commits, ni les versions, ni `verify`, ni GitHub Actions et ne constituent pas une garantie générale de performances. La durée d'analyse et les limites pratiques dépendent de la vitesse du stockage, de la mémoire disponible, des métadonnées, des illustrations et des limites du navigateur ou du système d'exploitation.

Pendant le défilement de la liste des morceaux, EffeTune garde les pages voisines en cache. Sur mobile, il lit jusqu'à deux pages à l'avance dans le sens du défilement, donne la priorité à la page requise à l'écran sur les lectures anticipées supplémentaires et réutilise les lignes visibles qui se chevauchent. Même si le défilement continue, les lectures terminées pour la zone d'affichage sont immédiatement publiées dans ce cache limité. Les demandes de position sont regroupées sur la plus récente et, si celle-ci se trouve dans la page qui vient d'être chargée, aucune lecture supplémentaire de la base de données n'est effectuée. Les lectures anticipées en attente devenues inutiles sont abandonnées. SQLite permet l'interruption, mais les adaptateurs du catalogue exécutent actuellement chaque instruction de manière synchrone et n'exposent aucun moyen de l'interrompre depuis un autre worker. Un déplacement exceptionnellement rapide peut donc encore laisser un bref espace vide jusqu'à la fin de la lecture en cours, surtout sur un stockage lent.

[← Retour au README](README.md)
