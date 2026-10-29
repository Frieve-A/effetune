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

Le lecteur de bureau affiche aussi la [musique en réseau et AirPlay](openhome.md). Pendant AirPlay, les informations du morceau, la pochette et le temps apparaissent lorsqu’ils sont transmis par l’émetteur ; survolez le titre pour en savoir plus. Commandez la lecture et le volume depuis l’appareil émetteur. Fermer le lecteur avec **×**, ou utiliser **Arrêter**, met fin à cette session ; le récepteur reste activé et disponible pour une nouvelle connexion.

Le curseur de volume et le bouton de sourdine règlent le son du lecteur avant son passage dans les effets. Les changements effectués à distance sont également affichés ici : vous pouvez ainsi vérifier le volume et rétablir le son sur l’appareil qui lit la musique.

## Lecture sans interruption

**Lecture sans interruption**, dans **Configuration audio**, est activée par défaut et enchaîne sans blanc les morceaux locaux compatibles ; la prise en charge dépend du format du fichier et de l’environnement, navigateur ou application. Les formats non pris en charge et certains environnements mobiles utilisent un mode de secours économe en mémoire, si bien qu’un bref silence peut subsister. La désactiver privilégie une faible consommation de mémoire et la stabilité, au prix d’un bref silence possible ; ce changement n’interrompt pas le morceau en cours. La lecture sans interruption ne fonctionne qu’à la vitesse 1x ; changer la vitesse pendant une lecture sans interruption relance le morceau à la même position après une brève coupure.

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
