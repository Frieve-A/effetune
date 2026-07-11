---
title: "Utiliser la Bibliothèque musicale - EffeTune"
description: "Découvrez comment créer une Bibliothèque musicale dans EffeTune, rechercher et lire de la musique à partir de dossiers et de métadonnées, et gérer les listes de lecture."
lang: fr
---

# Utiliser la Bibliothèque musicale

La Bibliothèque musicale indexe les dossiers de musique que vous choisissez et vous permet de parcourir votre collection locale par morceaux, albums, artistes, genres, dossiers, ajouts récents et listes de lecture. Comme pour la lecture normale des fichiers musicaux, le son passe par le pipeline d'effets EffeTune actuel.

La Bibliothèque musicale enregistre le catalogue interne de l'application, le cache des illustrations et les listes de lecture. Elle ne modifie, ne renomme, ne déplace et ne supprime jamais les fichiers musicaux eux-mêmes.

## Environnements disponibles

- **Application de bureau :** utilise l'analyseur de dossiers complet et permet de réutiliser les dossiers choisis au prochain démarrage. La version de bureau peut aussi afficher les morceaux dans le dossier qui contient leur fichier.
- **Navigateurs Chromium sur ordinateur :** utilisent File System Access dans les environnements compatibles. L'accès aux dossiers peut parfois être conservé, mais le navigateur peut aussi redemander une autorisation.
- **Navigateurs mobiles, Safari et Firefox :** utilisent la sélection de dossier ou de fichier disponible dans le navigateur. Avec la méthode de repli, les fichiers du dossier choisi peuvent être indexés, mais il peut être nécessaire de sélectionner à nouveau le dossier ou les fichiers après un rechargement ou l'expiration des autorisations.

La Bibliothèque musicale indexe les extensions de fichiers multimédias courantes, notamment MP3, WAV, OGG, FLAC, Opus, M4A, AAC, WebM et MP4. Pour les fichiers MP4, EffeTune lit uniquement la piste audio et n'affiche pas la vidéo. La lecture effective, y compris la prise en charge du codec audio contenu dans le MP4, dépend aussi des capacités de décodage du navigateur et du système d'exploitation.

## Ouvrir la Bibliothèque musicale

- **Disposition ordinateur :** cliquez sur le bouton **Bibliothèque musicale** dans l'en-tête.
- **Disposition mobile :** ouvrez l'onglet **Bibliothèque** dans la navigation en bas de l'écran.
- **Application de bureau :** vous pouvez aussi l'ouvrir avec **Affichage > Bibliothèque musicale** ou **Ctrl+L** (**Command+L** sur macOS).

Pour revenir à l'édition des effets, cliquez sur le bouton **Effect Pipeline** en disposition ordinateur, ou revenez à l'onglet **Effets** en disposition mobile. Dans l'application de bureau, vous pouvez aussi utiliser **Affichage > Effect Pipeline** ou **Ctrl+E** (**Command+E** sur macOS).

Si vous voulez afficher la Bibliothèque musicale en premier au démarrage, ouvrez **Paramètres > Configuration...** et réglez **Vue au démarrage :** sur **Bibliothèque musicale**.

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
- **Dossiers** - affiche les dossiers de bibliothèque enregistrés et leur état d'analyse.
- **Ajouts récents** - affiche les morceaux récemment indexés.
- **Listes de lecture** - affiche les listes de lecture créées ou importées dans la Bibliothèque musicale.

**Rechercher dans la bibliothèque** permet de rechercher dans les morceaux, albums, artistes et listes de lecture. En disposition ordinateur, l'en-tête de la liste des morceaux permet de trier par titre, artiste, album, genre ou durée.

Quand les métadonnées sont absentes ou illisibles, EffeTune utilise le nom du fichier et les informations de dossier pour l'affichage. Les propriétés d'un morceau permettent de consulter le chemin du fichier, le format, la fréquence d'échantillonnage, la profondeur de bits, le débit binaire et les principaux champs de métadonnées.

## Lire depuis la bibliothèque

Sélectionnez des morceaux, albums, artistes, genres, dossiers, résultats de recherche ou listes de lecture, puis utilisez les actions suivantes.

- **Lire** - remplace la file d'attente actuelle du lecteur et lance la lecture.
- **Aléatoire** - lit les morceaux sélectionnés dans un ordre aléatoire.
- **Lire ensuite** - insère les morceaux sélectionnés juste après le morceau actuel.
- **Ajouter à la file** - ajoute les morceaux sélectionnés à la fin de la file.
- **Ajouter à une liste** - enregistre les morceaux sélectionnés dans une liste de lecture de la Bibliothèque musicale.

Sur ordinateur, vous pouvez double-cliquer sur la ligne d'un morceau pour lancer la lecture depuis cette position, ou ouvrir les actions du morceau par clic droit ou depuis le menu **Plus**. Sur mobile, touchez le bouton de lecture sur la ligne du morceau pour le lire, ou appuyez longuement sur un morceau pour ouvrir la feuille d'actions.

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
- Utiliser **Exporter M3U8** ou **Exporter XSPF** pour exporter une liste de lecture.

Lors de l'importation, un aperçu indique combien d'éléments correspondent à des morceaux de la bibliothèque actuelle. Les éléments sans correspondance sont aussi conservés autant que possible comme éléments non résolus, afin de pouvoir être résolus si le dossier concerné est ajouté ou reconnecté plus tard.

Lors de l'exportation, si vous choisissez **Chemins relatifs**, les chemins sont écrits, quand c'est possible, sous forme de chemins relatifs à partir de l'emplacement d'exportation. C'est utile si vous voulez déplacer une liste de lecture avec le dossier de musique.

## Sécurité et emplacement d'enregistrement

- La Bibliothèque musicale lit les fichiers musicaux et les métadonnées, mais n'écrit aucune modification dans les fichiers musicaux.
- Le cache des illustrations et les listes de lecture sont des données internes à l'application, pas des modifications intégrées aux fichiers musicaux.
- L'espace de stockage du navigateur peut être effacé par les paramètres du navigateur ou par une action de l'utilisateur. Exportez les listes de lecture importantes si nécessaire.
- Dans l'application web, la disponibilité des dossiers après un rechargement dépend de la gestion des autorisations par le navigateur.

[← Retour au README](README.md)
