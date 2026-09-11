---
title: "Extension de navigateur - EffeTune"
description: "Traitez le son d’un onglet Chrome ou Edge avec l’extension EffeTune."
lang: fr
---

# Extension de navigateur EffeTune

L’extension traite le son d’un seul onglet avec le même **Effect Pipeline** stéréo qu’EffeTune. Elle permet d’écouter un site vidéo ou musical sans lancer l’application de bureau ni configurer de périphérique audio virtuel.

## Compatibilité et installation

Utilisez-la sur PC avec Chrome 116 ou version ultérieure, ou une version compatible de Microsoft Edge basée sur Chromium. Firefox, Safari, les navigateurs mobiles et la navigation privée ne sont pas pris en charge. Une session traite un seul onglet au moyen d’une chaîne stéréo en série.

Installez une extension reçue depuis une boutique dans cette boutique. Pour un paquet local, extrayez `effetune-extension-<version>.zip` dans un dossier que vous conserverez. Ouvrez `chrome://extensions` dans Chrome ou `edge://extensions` dans Edge, activez **Developer mode**, choisissez **Load unpacked**, puis ce dossier. **Load unpacked** n’installe pas le fichier ZIP ; rechargez l’extension sur cette page après avoir remplacé des fichiers.

## Démarrer, comparer et arrêter

1. Ouvrez l’onglet dont vous voulez traiter le son et lancez la lecture.
2. Ouvrez l’extension EffeTune depuis la barre d’outils du navigateur.
3. Choisissez **Start processing**. Quand la chaîne est prête, l’état passe de **Starting…** à **Processing**.

L’onglet choisi reste le même pendant la session. Pour en traiter un autre, choisissez **Stop processing**, ouvrez l’extension dans cet autre onglet, puis recommencez. **Bypass effects** permet d’écouter l’onglet capturé sans effet en conservant la session. **Stop processing** libère le son de l’onglet et rétablit sa lecture normale.

Le traitement continue si vous fermez la fenêtre de l’extension ou l’éditeur. En les rouvrant, vous retrouvez l’onglet et l’état réels. Après avoir redémarré le navigateur, démarrez une nouvelle session manuellement : l’extension ne capture jamais un onglet automatiquement.

## Éditer la chaîne et utiliser des préréglages

Choisissez **Edit pipeline** pour ouvrir **EffeTune Pipeline Editor**. Vous pouvez ajouter, ordonner, activer ou désactiver des effets, ajuster leurs paramètres et utiliser les affichages d’analyse disponibles comme dans EffeTune. **Saved preset** et **Apply** changent toute la chaîne depuis la fenêtre de l’extension. Dans l’éditeur, ouvrez **Pipeline Presets** pour enregistrer un préréglage complet avec **Save as**. Pour importer ou exporter des préréglages complets, ouvrez **Settings** et choisissez **Import preset…** ou **Export preset**.

Les réglages et préréglages enregistrés restent dans l’extension ; ils ne se synchronisent pas automatiquement avec l’application web ou de bureau. Si un préréglage exige un routage, un effet ou une ressource externe indisponible, il n’est pas appliqué et la chaîne actuelle est conservée.

Pour utiliser dans Room EQ ou Crosstalk Cancellation une mesure provenant de l’application web ou de bureau, exportez-la au format JSON depuis cette application. Dans l’éditeur de l’extension, ouvrez **Settings**, choisissez **Import measurement…**, puis sélectionnez ce fichier JSON. Incluez les réponses impulsionnelles dans l’export pour Crosstalk Cancellation ou la correction de phase de Room EQ. Les mesures importées apparaissent immédiatement dans la liste **Measurement** de Room EQ, restent dans le stockage du navigateur réservé à l’extension et ne sont pas synchronisées automatiquement. Pour supprimer une copie importée, sélectionnez-la dans cette liste et choisissez **Delete** à côté. Après confirmation, toutes les affectations de Room EQ et Crosstalk Cancellation qui l’utilisent sont effacées avant la suppression de la copie.

## Autorisations, limites et aide

L’extension ne capture le son que de l’onglet où vous démarrez explicitement le traitement. Elle ne demande ni microphone, ni accès à tous les sites, ni enregistrement, ni envoi du son ailleurs.

Les chaînes stéréo ordinaires sont prises en charge. Les chaînes multibus ou ramifiées, plus de deux canaux, la réalisation de nouvelles mesures et le contrôle des appareils, Music Library, la conversion par lots et les fonctions de bureau dépendant d’appareils ou de chemins de fichiers ne sont pas disponibles.

Certains contenus protégés peuvent ne pas être capturables ; l’extension ne contourne pas leur protection. Si la capture ne démarre pas, EffeTune arrête le traitement et l’onglet reprend sa lecture normale. Vérifiez que l’onglet lit du son, puis choisissez de nouveau **Start processing**. Si **Needs attention** apparaît, faites de même. Si un préréglage est refusé, la chaîne actuelle est conservée : changez de préréglage ou rendez les ressources requises disponibles.
