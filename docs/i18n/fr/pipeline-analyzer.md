---
title: "Pipeline Analyzer - Réponse en fréquence et en phase de la chaîne d’effets - EffeTune"
description: "Pipeline Analyzer mesure la réponse en fréquence, la phase, le retard de groupe, la réponse impulsionnelle, la distorsion et la décroissance de l’Effect Pipeline actif sans modifier l’audio écouté."
lang: fr
---

# Pipeline Analyzer

Pipeline Analyzer mesure la réponse de l’Effect Pipeline actif sans modifier l’audio que vous écoutez. Il s’affiche à côté du pipeline dans les fenêtres larges ou sous l’en-tête du pipeline dans les fenêtres étroites, ce qui permet d’ajuster les effets tout en observant la réponse se mettre à jour.

Ouvrez-le avec le bouton graphique de l’en-tête de l’Effect Pipeline ou via **Affichage > Pipeline Analyzer** dans l’application de bureau. Lorsque **Auto** est activé, les modifications du pipeline relancent automatiquement une mesure. Décochez **Auto** pour ne remesurer les modifications du pipeline que lorsque vous cliquez sur **Refresh measurements** ; un changement de canaux, de réponses de haut-parleur ou de réglages de mesure lance toujours une nouvelle mesure.

## Choisir les canaux et les réponses de haut-parleur

Sélectionnez un canal d’entrée du pipeline actif (jusqu’à 16 canaux) et jusqu’à quatre canaux de sortie avec **+ Add Output**. Au moins une sortie reste toujours présente : la dernière ne peut donc pas être supprimée. Supprimer une sortie supprime aussi son réglage de réponse de haut-parleur.

Chaque sortie peut utiliser **No speaker IR** ou un point de mesure enregistré pour le haut-parleur ou le transducteur connecté :

- Sans RI de haut-parleur : **Before** est une impulsion de référence idéalement plate, et **After** affiche la réponse du pipeline d’effets seul.
- Avec RI de haut-parleur : **Before** est la réponse combinée des mesures de haut-parleur sélectionnées, et **After** la réponse combinée après le traitement de chaque sortie par le pipeline. Vous pouvez ainsi vérifier un **Channel Divider** ou un **FIR Crossover** avec les mesures réelles de vos transducteurs.

Une réponse enregistrée qui n’est plus disponible reste sélectionnée mais s’affiche sous la forme — tant que vous ne la remplacez pas ou ne l’effacez pas.

Comme les mesures de haut-parleur séparées sont alignées sur leur attaque détectée et ne conservent pas les écarts physiques de temps d’arrivée entre transducteurs, réglez le délai relatif et la polarité des transducteurs dans le pipeline avant d’évaluer la réponse sommée.

## Réglages de mesure

Ouvrez **Measurement settings** pour régler la façon dont le pipeline est mesuré :

- **Signal** : **Log Sweep** (par défaut), **MLS**, **TSP** ou **Unit Impulse**. Utilisez **Log Sweep** pour examiner aussi la distorsion harmonique. Le balayage couvre de 20 Hz à 20 kHz dans les limites de la fréquence d’échantillonnage. **MLS** et **TSP** utilisent des signaux périodiques ; **Unit Impulse** capture directement la réponse impulsionnelle.
- **Level** : niveau crête du signal de test (`-12 dBFS` par défaut). Les filtres linéaires donnent la même mesure à tout niveau, alors que les compresseurs, saturateurs et autres effets dépendants du niveau changent selon **Level**.
- **Requested sweep length** (**Log Sweep**) / **Sequence Length** (autres signaux) : **Log Sweep** utilise `131072` échantillons par défaut et peut allonger le balayage pour séparer les harmoniques ; les valeurs réelles de **Sweep length** et **Total stimulus time** s’affichent après la mesure. La réponse ne couvre que les 1,5 seconde suivant le pic principal de l’impulsion, même si vous allongez le balayage. Pour examiner des queues de réverbération, des délais ou des résonances plus longs, choisissez **MLS**, **TSP** ou **Unit Impulse**, puis augmentez **Sequence Length** si nécessaire.
- **Stabilization Periods** : nombre de périodes jouées avant la capture (`12` par défaut, utilisé par MLS et TSP) pour laisser les effets à évolution lente se stabiliser. Ce réglage n’est pas disponible avec **Log Sweep** ni **Unit Impulse**.
- **Averages** : nombre de captures dont la moyenne est calculée (`2` par défaut, utilisé par **Log Sweep**, MLS et TSP) pour réduire les variations.

## Lire les graphiques

Utilisez le sélecteur **Graph** au-dessus du tracé pour changer de vue sans remesurer :

- **Frequency** : réponse en amplitude (dB) en fonction de la fréquence, référencée à 0 dB.
- **Phase** : réponse en phase (degrés) en fonction de la fréquence.
- **Min Group Delay** : retard de groupe impliqué par la réponse en amplitude à phase minimale.
- **Excess Group Delay** : retard de groupe restant après retrait de la partie à phase minimale (le tracé est limité à ±100 ms, tandis que les valeurs lues au curseur indiquent la valeur réelle), ce qui permet de repérer facilement un retard pur et le comportement temporel d’un filtre à phase linéaire ou passe-tout.
- **Impulse** : réponse impulsionnelle dans le domaine temporel, de `-2 ms` jusqu’à **Impulse Range (ms)**, normalisée sur sa crête.
- **Distortion** : avec **Log Sweep**, affiche la distorsion harmonique en pourcentage de la fondamentale selon la fréquence. H2, H3 et THD (ordres 2 à 3) sont affichés au départ ; vous pouvez ajouter H4 à H10 sans refaire la mesure. Plus la valeur est élevée, plus la distorsion est importante. Si ce graphique est indisponible avec un autre signal, sélectionnez **Log Sweep**. Une sortie silencieuse ou sans données valides ne permet pas de calculer la distorsion. Les réponses de haut-parleur enregistrées apportent leur réponse linéaire, pas la distorsion propre au haut-parleur.
- **Waterfall** : affiche la fréquence, le niveau relatif (dB) et le temps de décroissance (ms). Dans **Response**, choisissez **After** (par défaut) ou **Before** pour examiner la sortie du pipeline ou les réponses de haut-parleur sélectionnées avant traitement. Chaque vue est normalisée sur sa propre crête : comparez la forme de la décroissance, pas les niveaux absolus. Faites glisser le graphique 3D pour le tourner et utilisez la molette ou le pincement pour zoomer.

Sur les graphiques de fréquence, de phase, de retard de groupe et d’impulsion, survolez le tracé pour lire les valeurs **Before** et **After** sous le curseur ; survolez l’étiquette **Before** de la légende pour masquer temporairement **After**. Utilisez **Smoothing (oct)** pour les graphiques de fréquence, de phase et de retard de groupe, et **Impulse Range (ms)** pour le graphique d’impulsion.

## Fonctionnement de la mesure

Pipeline Analyzer capture le pipeline actif, son routage et les réponses de haut-parleur sélectionnées, puis compense automatiquement sur **After** la latence déclarée par le pipeline. Pour les effets non linéaires, modulés ou aléatoires, considérez le tracé comme un instantané aux réglages et au **Level** actuels.

[← Retour au README](README.md)
