---
title: "Télécommande OpenHome (application de bureau) - EffeTune"
description: "Commandez l’application de bureau EffeTune depuis des applications de contrôle OpenHome de votre réseau local : configuration, accès réseau, compatibilité et limites."
lang: fr
---

# Télécommande OpenHome (application de bureau)

Dans les versions de bureau compatibles (Windows x64, macOS sur Intel ou Apple silicon et Linux x64), EffeTune peut apparaître comme lecteur OpenHome auprès des applications de contrôle du même réseau local. Ouvrez **Paramètres > Configuration...**, activez **Autoriser les contrôleurs OpenHome sur ce réseau** (désactivé par défaut), puis attendez que l’état indique qu’EffeTune est disponible. Le nom par défaut du lecteur est `EffeTune (nom de l’ordinateur)` ; utilisez **Nom du lecteur** pour choisir un nom personnalisé, par exemple `EffeTune Living Room`.

OpenHome ne demande aucune connexion. Tant que l’option est active, les autres appareils du réseau local peuvent consulter les métadonnées de lecture, modifier la file d’attente du lecteur et commander la lecture. Si le Pare-feu Windows demande une autorisation, autorisez EffeTune uniquement sur les **réseaux privés**, et non sur les **réseaux publics**. Désactivez l’option lorsque la télécommande n’est pas nécessaire.

Les contrôleurs peuvent ajouter des flux audio HTTP ou HTTPS, gérer la file de lecture distante et commander la lecture, la pause, l’arrêt, le saut, la recherche, la répétition et la lecture aléatoire. L’audio distant passe comme d’habitude par le pipeline d’effets EffeTune actif. Les opérations de base sur la file et la lecture ont été vérifiées avec BubbleUPnP sur Android ; d’autres applications OpenHome peuvent afficher les services différemment. EffeTune fonctionne comme une source OpenHome Playlist (et non comme un UPnP AV MediaRenderer) et ne propose via OpenHome ni la modification des effets, ni les chemins de fichiers locaux, ni le volume principal, Radio, Songcast ou la synchronisation multiroom.

La lecture sans interruption n’est pas garantie, et les informations techniques peuvent rester inconnues tant que la source ne les fournit pas. Après une mise en veille, un réveil, une connexion VPN ou un changement de réseau, le lecteur peut disparaître brièvement le temps de se reconnecter.

[← Retour au README](README.md)
