---
title: "Lecteur de musique - EffeTune"
description: "Lisez des fichiers musicaux et vidéo à travers la chaîne d’effets d’EffeTune, changez la vitesse de lecture, utilisez le mini-lecteur et configurez la lecture sans interruption."
lang: fr
---

# Lecteur de musique

Ouvrez un fichier musical dans EffeTune pour l’écouter à travers la chaîne d’effets actuelle. Les commandes du lecteur permettent de mettre en pause, de reprendre la lecture ou de régler la vitesse.

## Ouvrir des fichiers musicaux

- Cliquez sur **Ouvrir des fichiers musicaux** (le bouton dossier de l’en-tête) ou faites glisser des fichiers musicaux dans la fenêtre.
- **Application de bureau :** choisissez **Fichier > Ouvrir un fichier musical...** ou ouvrez un fichier musical avec EffeTune depuis votre système d’exploitation.
- **Disposition mobile :** touchez **Ouvrir la musique**.

Pour utiliser uniquement le lecteur, réglez **Périphérique d'entrée :** sur **Aucun (lecteur de fichiers musicaux uniquement)** dans **Configuration audio** : EffeTune n’utilise alors aucune entrée audio en direct.

## Commandes de lecture

- La mise en pause, la reprise et la fermeture du lecteur avec **×** s’accompagnent d’un court fondu pour éviter les clics.
- Cliquez sur le bouton de vitesse à côté du bouton **Aléatoire** pour choisir l’un des neuf préréglages ou régler n’importe quelle vitesse de `0.25x` à `4x` par pas de `0.01x`. **Conserver la hauteur** est activé par défaut : la hauteur reste la même quand la vitesse change. Désactivez-le pour que la hauteur monte et descende avec la vitesse, comme sur une bande ou un disque.
- Dans l’application de bureau, choisissez **Affichage > Mini-lecteur** (`Ctrl/Cmd+Shift+M`) ou cliquez sur le bouton mini-lecteur du lecteur pour passer à une fenêtre compacte. Cliquez sur le bouton d’épingle pour la garder toujours au premier plan.

## Lecture sans interruption

**Lecture sans interruption**, dans **Configuration audio**, est activée par défaut et enchaîne sans blanc les morceaux locaux compatibles ; la prise en charge dépend du format du fichier et de l’environnement, navigateur ou application. Les formats non pris en charge et certains environnements mobiles utilisent un mode de secours économe en mémoire, si bien qu’un bref silence peut subsister. La désactiver privilégie une faible consommation de mémoire et la stabilité, au prix d’un bref silence possible ; ce changement n’interrompt pas le morceau en cours. La lecture sans interruption ne fonctionne qu’à la vitesse 1x ; changer la vitesse pendant une lecture sans interruption relance le morceau à la même position après une brève coupure.

## Vidéo {#video}

La vidéo s’affiche dans la zone de pochette du lecteur. Sélectionnez **⛶** pour qu’elle occupe tout l’affichage de l’application ; survolez la vidéo avec le pointeur ou touchez-la pour afficher les commandes de lecture en bas. Vous pouvez aussi ajouter un élément **Video** dans Visualizer. Pour inclure les fichiers vidéo dans la Bibliothèque musicale, consultez le [guide de la Bibliothèque musicale](music-library.md#availability).

[← Retour au README](README.md)
