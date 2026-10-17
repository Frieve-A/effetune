---
title: "Mesure et correction de la réponse en fréquence - EffeTune"
description: "Mesurez la réponse en fréquence de votre système audio avec un microphone dans EffeTune, créez un EQ de correction, puis importez, calibrez et exportez des réponses impulsionnelles."
lang: fr
---

# Mesure et correction de la réponse en fréquence

Pour mesurer la réponse en fréquence de votre système audio et créer un EQ de correction plat :
1. Lancez l’[outil de mesure de la réponse en fréquence](https://effetune.frieve.com/features/measurement/measurement.html) ou sélectionnez **Mesure de la réponse en fréquence** dans le menu **Paramètres**.
2. Suivez l’assistant pour configurer votre microphone de mesure et votre périphérique de sortie.
3. Mesurez la réponse en fréquence de votre système à une ou plusieurs positions d’écoute.
4. Générez une correction EQ paramétrique qui peut être importée directement dans EffeTune.
5. Appliquez la correction pour obtenir une reproduction sonore plus précise et plus neutre.

## Canaux de sortie

Réglez **Nombre de canaux du périphérique de sortie** selon la configuration de votre périphérique : **6** pour 5.1 ou **8** pour 7.1. Les choix de canal de sortie et de bande passante par canal restent dans cette plage. Les signaux de test et les mesures utilisent toujours ce nombre de canaux : gardez donc **6** même pour mesurer uniquement Ch 3 (centre) et Ch 4 (caisson de basses) sur un périphérique 5.1.

Pour un système multicanal, sélectionnez **Tous les canaux** pour mesurer toutes les sorties ensemble, ou les éléments individuels de **Canal de sortie** pour les mesurer un par un. Dans **Paramètres avancés**, choisissez **Désactivé**, **Identique pour tous les canaux** ou **Par canal** pour la bande passante du balayage. Avec **Par canal**, utilisez **Canal à configurer** pour régler la plage de fréquences de chaque canal de sortie sélectionné. Pendant le réglage du niveau, le **Mode de canal** démarre sur **Rotation automatique** ; choisissez un canal de signal de test ou **Manuel** si nécessaire.

## Importer une réponse impulsionnelle

Si vous disposez déjà d’un fichier WAV de réponse impulsionnelle, choisissez **Importer** et sélectionnez-le. EffeTune enregistre chaque canal du WAV comme un résultat de mesure utilisable dans **Room EQ** et les autres fonctions basées sur les mesures.

## Étalonnage de l’interface audio

Pour retirer la réponse propre à votre interface audio, reliez directement sa sortie à son entrée et enregistrez cette boucle comme une mesure normale, sans étalonnage, avec réponse impulsionnelle. Pour mesurer vos enceintes, sélectionnez ce point enregistré dans **Étalonnage de l’interface audio** en conservant la même interface, les mêmes canaux, la même fréquence d’échantillonnage et les mêmes réglages de gain d’entrée et de sortie. Choisissez **Aucun (sans étalonnage)** pour mesurer sans étalonnage par boucle.

## Lire et exporter les résultats

Les mesures enregistrées qui contiennent des données de réponse impulsionnelle affichent un graphique **Réponse impulsionnelle** normalisé, ouvert sur 0 à 10 ms à partir de l’attaque détectée. Zoomez sur l’axe temporel avec la molette ou les boutons, et faites défiler la vue en faisant glisser le graphique ou avec le curseur. La sélection d’un point met le graphique à jour ; **Tous (moyenne)** affiche le premier point dont la réponse impulsionnelle a été enregistrée et l’identifie au-dessus du graphique. Utilisez **Exporter la réponse impulsionnelle (WAV)** sous le graphique pour enregistrer la réponse complète et non normalisée du point affiché dans un fichier WAV mono à virgule flottante 32 bits, à la fréquence d’échantillonnage de la mesure.

Pour examiner les réponses Frequency, Phase, Min Group Delay, Excess Group Delay et Impulse du pipeline actif, y compris jusqu’à quatre sorties sélectionnées et, si vous le souhaitez, des réponses d’enceintes enregistrées, consultez le [guide de Pipeline Analyzer](pipeline-analyzer.md).

[← Retour au README](README.md)
