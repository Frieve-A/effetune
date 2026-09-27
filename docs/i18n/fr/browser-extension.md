---
title: "Extension de navigateur - EffeTune"
description: "L’extension traite simultanément le son de quatre onglets au maximum, chacun avec son propre Effect Pipeline stéréo."
lang: fr
---

# Extension de navigateur EffeTune

L’extension traite simultanément le son de quatre onglets au maximum, chacun avec son propre **Effect Pipeline** stéréo. Elle permet d’écouter un site vidéo ou musical sans lancer l’application de bureau ni configurer de périphérique audio virtuel.

## Compatibilité et installation

Utilisez-la sur PC avec Chrome 116 ou version ultérieure, ou une version compatible de Microsoft Edge basée sur Chromium. Firefox, Safari, les navigateurs mobiles et la navigation privée ne sont pas pris en charge. Chaque onglet utilise une chaîne d’effets stéréo.

Installez une extension reçue depuis une boutique dans cette boutique. Pour un paquet local, extrayez `effetune-extension-<version>.zip` dans un dossier que vous conserverez. Ouvrez `chrome://extensions` dans Chrome ou `edge://extensions` dans Edge, activez **Developer mode**, choisissez **Load unpacked**, puis ce dossier. **Load unpacked** n’installe pas le fichier ZIP ; rechargez l’extension sur cette page après avoir remplacé des fichiers.

## Démarrer, comparer et arrêter

1. Ouvrez l’onglet dont vous voulez traiter le son et lancez la lecture.
2. Ouvrez l’extension EffeTune depuis la barre d’outils du navigateur.
3. Choisissez **Start on this tab**. Quand la chaîne est prête, l’état passe de **Starting…** à **Processing**.

Pour ajouter un onglet, ouvrez l’extension depuis cet onglet et choisissez **Start on this tab**. La fenêtre affiche toutes les sessions, jusqu’à quatre à la fois ; arrêtez-en une avant d’en démarrer une cinquième. **Bypass** permet d’écouter un onglet sans effets en gardant sa session active. **Stop** rétablit sa lecture normale sans interrompre les autres onglets.

Le traitement continue si vous fermez la fenêtre de l’extension ou l’éditeur. En les rouvrant, vous retrouvez l’onglet et l’état réels. Après avoir redémarré le navigateur, démarrez une nouvelle session manuellement : l’extension ne capture jamais un onglet automatiquement.

## Éditer la chaîne et utiliser des préréglages

Choisissez **Edit pipeline** pour ouvrir **EffeTune Pipeline Editor**. Vous pouvez ajouter, ordonner, activer ou désactiver des effets, ajuster leurs paramètres et utiliser les affichages d’analyse disponibles comme dans EffeTune. **Saved preset** et **Apply to selected tab** changent toute la chaîne depuis la fenêtre de l’extension. Dans l’éditeur, ouvrez **Pipeline Presets** pour enregistrer un préréglage complet avec **Save as**. Pour importer ou exporter des préréglages complets, ouvrez **Settings** et choisissez **Import preset…** ou **Export preset**. Sélectionnez l’onglet dans l’en-tête de l’éditeur pour afficher sa chaîne et ses analyses. Sans session active, **Offline pipeline** permet de modifier la chaîne par défaut du prochain démarrage. Dans la fenêtre de l’extension, sélectionnez l’onglet auquel appliquer un préréglage.

Choisissez **Visualizer** dans l’en-tête de l’éditeur pour afficher dans [Visualizer](visualizer.md) le son traité de l’onglet sélectionné ; choisissez-le de nouveau pour revenir à la chaîne. Si cet onglet n’est pas en cours de traitement, Visualizer affiche « Start EffeTune on a tab to show Visualizer. ». Les titres et pochettes ne s’affichent pas dans l’extension. **Share** et **Import Link** fonctionnent comme dans l’application web, et les liens partagés s’ouvrent dans la version web. Les dispositions et préréglages Visualizer restent dans l’extension et ne se synchronisent pas avec l’application web ou de bureau.

Les réglages et préréglages enregistrés restent dans l’extension ; ils ne se synchronisent pas automatiquement avec l’application web ou de bureau. Si un préréglage exige un routage, un effet ou une ressource externe indisponible, il n’est pas appliqué et la chaîne actuelle est conservée.

Pour utiliser dans Room EQ ou Crosstalk Cancellation une mesure provenant de l’application web ou de bureau, exportez-la au format JSON depuis cette application. Dans l’éditeur de l’extension, ouvrez **Settings**, choisissez **Import measurement…**, puis sélectionnez ce fichier JSON. Incluez les réponses impulsionnelles dans l’export pour Crosstalk Cancellation ou la correction de phase de Room EQ. Les mesures importées apparaissent immédiatement dans la liste **Measurement** de Room EQ, restent dans le stockage du navigateur réservé à l’extension et ne sont pas synchronisées automatiquement. Pour supprimer une copie importée, sélectionnez-la dans cette liste et choisissez **Delete** à côté. Après confirmation, toutes les affectations de Room EQ et Crosstalk Cancellation qui l’utilisent sont effacées avant la suppression de la copie.

Pour choisir les données enregistrées à transférer, ouvrez **Settings > Backup / Restore** dans l’éditeur. Le même fichier `.effetune_backup` fonctionne dans les applications web et de bureau et peut contenir des préréglages de chaîne, des préréglages d’effets, des préréglages Visualizer, des réponses impulsionnelles et des mesures importées. Une chaîne dont le routage ou les effets ne sont pas pris en charge par l’extension reste enregistrée et peut être sauvegardée à nouveau, même si elle ne peut pas être appliquée dans l’extension. Les règles d’URL et le réglage Sample rate de l’extension ne sont pas inclus.

## Préréglages par URL et fréquence d’échantillonnage

Dans **Settings**, ouvrez **URL rules…**, ajoutez un motif, choisissez un préréglage enregistré et activez la règle. Les motifs ont la forme `host/path`, par exemple `example.com/music/*` ; `*` correspond à n’importe quel texte. La première règle active correspondante est retenue. La casse du nom d’hôte, le protocole, la chaîne de requête et le fragment sont ignorés. Réordonnez les règles pour fixer leur priorité, ou désactivez-les et supprimez-les.

Vous démarrez toujours chaque onglet manuellement. Le préréglage est choisi au démarrage et lorsque l’URL change ; sans correspondance, la chaîne par défaut s’applique. Les modifications des règles prennent effet au prochain démarrage ou à la prochaine navigation. Modifier une chaîne choisie par une règle met à jour ce préréglage enregistré. Les autres modifications, y compris après l’application manuelle d’un préréglage, mettent à jour la chaîne par défaut. Supprimer un préréglage désactive ses règles et ramène les onglets qui les utilisent à la chaîne par défaut.

**Sample rate**, dans **Settings**, s’applique à tous les onglets actifs : **Auto**, **44.1 kHz**, **48 kHz**, **96 kHz** ou **192 kHz**. Auto laisse le navigateur choisir. Le changement relance brièvement le traitement de tous les onglets en conservant leur capture. Si un onglet ne peut pas fonctionner à cette fréquence, il reprend sa lecture normale ; choisissez une autre fréquence, puis redémarrez son traitement.

## Autorisations, limites et aide

L’extension capture uniquement le son des onglets où vous lancez explicitement le traitement. Elle lit leur URL, y compris après navigation, pour choisir un préréglage enregistré. Elle ne lit pas le contenu des pages, n’y insère aucun script, n’utilise pas le microphone, n’enregistre pas le son et ne le transmet pas.

Les chaînes stéréo prennent en charge Bus Routing avec Main et Bus 1–4, y compris les chemins d’effets parallèles. L’extension ne prend pas en charge plus de deux canaux, la réalisation de nouvelles mesures et le contrôle des périphériques, Music Library, la conversion de fichiers par lots, ni les fonctions propres à l’application de bureau qui dépendent de périphériques ou de chemins de fichiers.

Certains contenus protégés peuvent ne pas être capturables ; l’extension ne contourne pas leur protection. Si la capture ne démarre pas, EffeTune arrête le traitement et l’onglet reprend sa lecture normale. Vérifiez que l’onglet lit du son, puis choisissez de nouveau **Start on this tab**. Si **Needs attention** apparaît, faites de même. Si un préréglage est refusé, la chaîne actuelle est conservée : changez de préréglage ou rendez les ressources requises disponibles.
