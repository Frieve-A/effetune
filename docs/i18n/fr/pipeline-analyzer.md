# Pipeline Analyzer

Pipeline Analyzer mesure la réponse de l’Effect Pipeline actif sans modifier le son entendu. Il reste à côté du pipeline dans une fenêtre large et passe sous son en-tête dans une fenêtre étroite, ce qui permet de régler un effet tout en suivant le résultat.

Ouvrez-le avec le bouton graphique de l’en-tête Effect Pipeline ou avec **View > Pipeline Analyzer** dans l’application de bureau. Toute modification du pipeline ou des réglages de mesure lance automatiquement une nouvelle mesure.

## Canaux et réponses de haut-parleur

Choisissez un canal d’entrée. Une sortie est affichée au départ ; **+ Ajouter une sortie** permet d’ajouter jusqu’à quatre canaux distincts disponibles sur le périphérique actuel. Supprimer une sortie efface aussi son réglage de réponse. La dernière sortie ne peut pas être supprimée.

Chaque sortie peut utiliser **Sans IR de haut-parleur** ou un point de mesure enregistré correspondant au tweeter, au woofer ou à une autre unité raccordée. **Avant** est la somme signée des réponses alignées ; **Après** est la somme signée après traitement de chaque sortie par le pipeline choisi. Vous pouvez ainsi examiner un FIR Crossover avec ses haut-parleurs. Une réponse enregistrée manquante reste indiquée comme telle jusqu’à son remplacement ou sa suppression.

Les réponses enregistrées sont alignées sur leur début détecté. Des mesures séparées ne conservent pas l’écart acoustique d’arrivée entre haut-parleurs ; réglez le retard relatif et la polarité dans le pipeline avant d’interpréter Total.

## Réglages de mesure

Ouvrez **Réglages de mesure** pour modifier :

- **Signal** : **MLS** est utilisé par défaut. **TSP** fournit un signal périodique à phase balayée avec les mêmes réglages de stabilisation et de moyennage. **Impulsion unitaire** réalise une capture temporelle directe.
- **Niveau** : crête du signal d’essai, réglée par défaut sur `-12 dBFS`. Les effets non linéaires ou dépendants du niveau peuvent donner une autre réponse.
- **Longueur de séquence** : MLS utilise de 32 767 à 524 287 échantillons et TSP les puissances de deux correspondantes, de 32 768 à 524 288. Le même ordre est conservé lors du changement de signal. Une séquence plus longue représente une réponse plus longue avant recouvrement circulaire. L’analyseur peut conseiller une longueur, sans jamais la modifier automatiquement.
- **Périodes de stabilisation** : 12 par défaut. MLS ou TSP tourne en continu pendant ces périodes avant la capture. La durée réelle est affichée.
- **Moyennes** : 2 par défaut. Davantage de périodes réduisent les variations entre répétitions.

Les détails affichent également l’**étendue actuelle**, la **longueur recommandée**, la **stabilisation recommandée** en périodes et en secondes, ainsi que la **durée totale du signal d’essai**. Ces valeurs sont uniquement indicatives ; Pipeline Analyzer ne modifie jamais les réglages automatiquement.

Longueur de séquence, Périodes de stabilisation et Moyennes ne sont désactivées qu’avec Impulsion unitaire. Passer de Frequency à Phase, Group Delay ou Impulse ne change que l’affichage et ne relance pas la mesure.

## Lecture et méthode

**Frequency** affiche le niveau, **Phase** la phase, **Group Delay** le retard selon la fréquence et **Impulse** la réponse temporelle. Le graphique affiche toujours uniquement **Avant** et **Après**. Déplacez le pointeur pour lire les deux valeurs à la même fréquence ou au même instant ; survolez **Avant** pour masquer temporairement **Après**. Frequency et Group Delay partagent le réglage **Lissage (oct)**. Chaque courbe de fréquence est référencée séparément à 0 dB ; chaque impulsion est normalisée sur son propre pic complet et affichée de -2 ms jusqu’à la **Plage d’impulsion (ms)** choisie.

Chaque mesure fige le pipeline, ses ressources, le routage, les réponses de haut-parleur et les réglages dans un worker isolé. MLS utilise une corrélation circulaire et TSP son balayage inverse pour retrouver la réponse périodique hors DC. La latence signalée par le pipeline est retranchée de la phase, du retard de groupe et du temps d’impulsion affichés. Impulsion unitaire normalise la capture selon le niveau choisi et garde une capture de traîne limitée.

Avec les effets non linéaires, variables dans le temps, aléatoires, bruités ou générateurs de son, le résultat est une seule capture au niveau et dans l’état initial choisis, et non une fonction de transfert universelle. Il peut varier d’une mesure à l’autre. Une sortie numérique invalide ou un processeur ou une ressource indispensable indisponible fait échouer la mesure.
