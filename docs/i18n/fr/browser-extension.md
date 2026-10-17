---
title: "Extension de navigateur - Égaliseur et effets audio pour Chrome et Edge - EffeTune"
description: "Traitez le son de jusqu’à quatre onglets Chrome ou Edge avec EffeTune, avec des préréglages par URL et une fréquence d’échantillonnage sélectionnable."
lang: fr
---

# Extension de navigateur EffeTune

L’extension de navigateur EffeTune traite simultanément le son de jusqu’à quatre onglets du navigateur, chacun avec son propre Effect Pipeline stéréo. Elle permet d’écouter un site vidéo ou musical sans lancer l’application de bureau ni configurer de périphérique audio virtuel.

Pour en savoir plus sur le traitement des données locales et les liens externes facultatifs, consultez la [Politique de confidentialité de l’extension](../../browser-extension-privacy.md). Pour obtenir de l’aide, utilisez [GitHub Issues](https://github.com/Frieve-A/effetune/issues), mais ne publiez aucun audio, titre ou URL d’onglet, préréglage, mesure, réponse impulsionnelle ou autre information privée dans un ticket public.

## Compatibilité

Utilisez l’extension sur un PC avec Chrome 116 ou version ultérieure, ou une version compatible de Microsoft Edge basée sur Chromium. Firefox, Safari, les navigateurs mobiles et la navigation privée ne sont pas pris en charge. Chaque onglet utilise une chaîne d’effets stéréo.

## Installer un paquet local

Si vous avez obtenu l’extension depuis la boutique de votre navigateur, installez-la directement depuis cette boutique. Pour un paquet local, extrayez `effetune-extension-<version>.zip` dans un dossier que vous conserverez, puis chargez ce dossier extrait :

1. Dans Chrome, ouvrez `chrome://extensions`. Dans Edge, ouvrez `edge://extensions`.
2. Activez **Developer mode**.
3. Choisissez **Load unpacked**, puis sélectionnez le dossier extrait de l’extension.

**Load unpacked** ne peut pas installer le fichier ZIP lui-même. Rechargez l’extension depuis cette page après avoir remplacé des fichiers dans le dossier extrait.

## Démarrer, comparer et arrêter le traitement

1. Ouvrez l’onglet dont vous voulez traiter le son et lancez la lecture.
2. Ouvrez l’extension EffeTune depuis la barre d’outils du navigateur.
3. Choisissez **Start on this tab**. L’état passe de **Starting…** à **Processing** dès que la chaîne d’effets est prête.

Pour ajouter un autre onglet, ouvrez l’extension depuis cet onglet et choisissez **Start on this tab**. La fenêtre contextuelle affiche toutes les sessions. Jusqu’à quatre onglets peuvent fonctionner simultanément ; arrêtez-en un avant d’en démarrer un cinquième.

Utilisez **Bypass** à côté d’un onglet pour l’écouter sans effets tout en maintenant sa session active. Choisissez **Stop** à côté de cet onglet lorsque vous avez terminé. L’arrêt rétablit la lecture normale de cet onglet sans interrompre les autres.

Vous pouvez fermer la fenêtre contextuelle ou l’éditeur pendant que le traitement se poursuit. Lorsque vous rouvrez l’un ou l’autre, il affiche l’onglet actuel et l’état du traitement. Après avoir redémarré le navigateur, démarrez une nouvelle session ; l’extension ne capture pas automatiquement un onglet.

## Éditer l’Effect Pipeline et utiliser des préréglages

Choisissez **Edit pipeline** pour ouvrir **EffeTune Pipeline Editor**, puis sélectionnez l’onglet cible dans l’en-tête. Ajoutez, réordonnez, activez ou désactivez et ajustez les effets exactement comme dans EffeTune ; les affichages des analyseurs suivent l’onglet sélectionné. Lorsqu’aucun onglet n’est actif, **Offline pipeline** permet de modifier la chaîne par défaut utilisée pour le prochain onglet que vous démarrerez.

Sélectionnez **Visualizer** dans l’en-tête de l’éditeur pour afficher le son traité de l’onglet sélectionné dans [Visualizer](visualizer.md), ou cliquez à nouveau dessus pour revenir à la chaîne d’effets. Les titres des pistes et les pochettes ne sont pas affichés dans l’extension, et **Share** / **Import Link** fonctionnent comme dans l’application web.

Pour changer rapidement de préréglage depuis la fenêtre contextuelle, sélectionnez un onglet, choisissez un **Saved preset**, puis cliquez sur **Apply to selected tab**. Dans l’éditeur, utilisez **Pipeline Presets > Save as** pour enregistrer un préréglage, ou **Settings > Import preset…** / **Export preset** pour échanger des fichiers `.effetune_preset`. Si un préréglage exige un routage multicanal non pris en charge, des effets incompatibles ou des ressources externes manquantes, la chaîne actuelle est conservée sans modification.

Pour utiliser dans **Room EQ** ou **Crosstalk Cancellation** une mesure provenant de l’application web ou de bureau :

1. Exportez la mesure au format JSON depuis l’application web ou de bureau (incluez les réponses impulsionnelles pour **Crosstalk Cancellation** ou la correction de phase de **Room EQ**).
2. Dans l’éditeur de l’extension, ouvrez **Settings > Import measurement…** et sélectionnez le fichier JSON.
3. Sélectionnez la mesure importée dans **Room EQ** ou **Crosstalk Cancellation**. Pour supprimer une copie importée, sélectionnez-la dans la liste **Measurement** de Room EQ et choisissez **Delete** ; après confirmation, toutes les affectations Room EQ et Crosstalk Cancellation qui l’utilisent sont effacées.

Pour transférer conjointement les préréglages, préréglages d’effets, préréglages Visualizer, réponses impulsionnelles et mesures importées entre l’application web, l’application de bureau et l’extension, utilisez **Settings > Backup / Restore** (`.effetune_backup`). Les préréglages, dispositions et mesures importées de l’extension sont stockés localement dans l’extension et ne sont pas synchronisés automatiquement avec l’application web ou de bureau. Les sauvegardes n’incluent ni les règles d’URL ni le réglage de fréquence d’échantillonnage de l’extension.

## Préréglages par URL et fréquence d’échantillonnage

Ouvrez **Settings > URL rules…** pour charger automatiquement un préréglage enregistré lorsque l’URL d’un onglet correspond à un motif `host/path` (tel que `example.com/music/*`, où `*` correspond à n’importe quel texte). Vous démarrez toujours chaque onglet vous-même ; les règles choisissent seulement son préréglage au démarrage et lorsque son URL change. La première règle active correspondante dans la liste s’applique ; si aucune règle ne correspond, la chaîne par défaut est utilisée. Les modifications des règles prennent effet au prochain démarrage ou à la prochaine navigation de la page. Modifier une chaîne chargée par une règle d’URL met à jour le préréglage enregistré de cette règle, tandis que les autres modifications, y compris celles faites après avoir appliqué manuellement un préréglage, mettent à jour la chaîne par défaut. Supprimer un préréglage désactive ses règles et ramène à la chaîne par défaut les onglets qui les utilisaient.

**Sample rate** dans **Settings** s’applique à tous les onglets actifs (**Auto**, **44.1 kHz**, **48 kHz**, **96 kHz** ou **192 kHz**). **Auto** laisse le navigateur choisir. Modifier la fréquence redémarre brièvement le traitement sur les onglets actifs, tout en conservant leurs captures. Si un onglet ne peut pas fonctionner à la nouvelle fréquence, il revient à la lecture normale ; sélectionnez une autre fréquence et redémarrez l’onglet.

## Autorisations et limites

L’extension capture uniquement le son des onglets où vous cliquez sur **Start on this tab** et ne lit l’URL de ces onglets que pour faire correspondre les règles de préréglages par URL. Elle ne lit jamais le contenu des pages, n’injecte aucun script, n’utilise pas le microphone et n’envoie aucun son sur le réseau.

Chaque onglet utilise une chaîne stéréo prenant en charge **Main** et les **Bus 1–4**. La sortie multicanal (>2 canaux), l’exécution de mesures acoustiques, la Bibliothèque musicale, la conversion hors ligne de fichiers par lots et les fonctionnalités matérielles exclusives à la version de bureau ne sont pas disponibles dans l’extension. Les flux protégés (DRM) qui bloquent la capture du navigateur reprennent leur lecture normale.

## En cas de problème

- L’état affiche **Needs attention** ou la capture ne démarre pas : assurez-vous que l’onglet lit activement du son, puis cliquez de nouveau sur **Start on this tab**.
- Un préréglage ne peut pas être appliqué : l’éditeur conserve votre chaîne actuelle. Vérifiez que toutes les mesures ou réponses impulsionnelles requises ont d’abord été importées dans l’extension.

[← Retour au README](README.md)
