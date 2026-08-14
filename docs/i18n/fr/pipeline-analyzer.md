# Pipeline Analyzer

Pipeline Analyzer mesure la réponse de l’Effect Pipeline actif sans modifier le son entendu. Il reste à côté du pipeline dans une fenêtre large et passe sous son en-tête dans une fenêtre étroite, ce qui permet de régler un effet tout en suivant le résultat.

Ouvrez-le avec le bouton graphique de l’en-tête Effect Pipeline ou avec **View > Pipeline Analyzer** dans l’application de bureau. Lorsque **Auto** est sélectionné, toute modification du pipeline lance automatiquement une nouvelle mesure. Désactivez **Auto** pour ne mesurer les modifications du pipeline qu’en sélectionnant **Refresh measurements**. Toute modification des réglages de mesure lance toujours une nouvelle mesure.

## Canaux et réponses de haut-parleur

Choisissez un canal d’entrée. Une sortie est affichée au départ ; **+ Ajouter une sortie** permet d’ajouter jusqu’à quatre canaux distincts disponibles sur le périphérique actuel. Supprimer une sortie efface aussi son réglage de réponse. La dernière sortie ne peut pas être supprimée.

Chaque sortie peut utiliser **Sans IR de haut-parleur** ou un point de mesure enregistré correspondant au tweeter, au woofer ou à une autre unité raccordée. Choisir une mesure sans sélectionner son point revient à choisir **Sans IR de haut-parleur**. Lorsqu’aucune sortie n’utilise d’IR de haut-parleur, **Avant** est l’impulsion unité idéale : 1,0 à 0 ms et 0 partout ailleurs. Avec des IR de haut-parleur, **Avant** est la somme signée des réponses alignées ; **Après** est la somme signée après traitement de chaque sortie par le pipeline choisi. Vous pouvez ainsi examiner un FIR Crossover avec ses haut-parleurs. Une réponse enregistrée manquante reste indiquée comme telle jusqu’à son remplacement ou sa suppression.

Les réponses enregistrées sont alignées sur leur début détecté. Des mesures séparées ne conservent pas l’écart acoustique d’arrivée entre haut-parleurs ; réglez le retard relatif et la polarité dans le pipeline avant d’interpréter Total.

## Réglages de mesure

Ouvrez **Réglages de mesure** pour modifier les options suivantes :

- **Signal** utilise **MLS** par défaut. **TSP** est un autre signal de test périodique, tandis que **Impulsion unitaire** capture directement la réponse temporelle. Ces méthodes peuvent mesurer différemment le pipeline avec des effets non linéaires ou variables dans le temps.
- **Niveau** règle la crête du signal de test et vaut -12 dBFS par défaut. Les effets linéaires donnent normalement la même réponse normalisée à tous les niveaux ; les effets non linéaires ou dépendants du niveau peuvent changer.
- **Longueur de séquence** détermine la durée de réponse que MLS ou TSP peut mesurer sans chevauchement. Une valeur plus longue demande davantage de temps et de mémoire. Augmentez-la pour les delays, reverbs et autres effets à longue traîne, surtout si l'analyseur le recommande.
- **Périodes de stabilisation** vaut 12 par défaut et laisse le pipeline se stabiliser avant la capture. Augmentez-la si un effet lent n'a pas encore atteint un état stable.
- **Moyennes** vaut 2 par défaut. Augmentez-la pour réduire les variations lorsque le graphique est instable ; la mesure prendra plus de temps.

Les détails indiquent si la longueur actuelle suffit, la longueur et la stabilisation recommandées, ainsi que la durée totale de la mesure. Ces recommandations sont indicatives ; appliquez-les lorsqu'elles correspondent aux effets mesurés.

Longueur de séquence, Périodes de stabilisation et Moyennes sont désactivées uniquement avec Impulsion unitaire. Changer Frequency, Phase, Min Group Delay, Excess Group Delay ou Impulse ne fait que modifier le graphique affiché, sans relancer la mesure.

## Lecture et méthode

Choisissez la vue avec les boutons **Graph** placés hors du graphique. **Frequency** affiche le niveau, **Phase** la phase, **Min Group Delay** le retard impliqué par la partie à phase minimale de la réponse en amplitude, **Excess Group Delay** le retard restant après son retrait et **Impulse** la réponse temporelle. Le graphique affiche toujours **Avant** et **Après**. Déplacez le pointeur pour lire les deux valeurs ; lorsque vous survolez **Avant**, **Après** est temporairement masqué. Frequency et les deux vues Group Delay partagent **Lissage (oct)**. Chaque courbe de fréquence est référencée séparément à 0 dB ; chaque impulsion est normalisée sur son propre pic global et affichée de -2 ms jusqu'à la **Plage d'impulsion (ms)** choisie.

Chaque mesure capture le pipeline actif, ses réglages et son routage actuels, ainsi que les réponses de haut-parleur sélectionnées. Les graphiques montrent les réponses en fréquence, phase, retard de groupe minimal, retard de groupe excédentaire et impulsion ; **Après** compense la latence indiquée par le pipeline.

MLS et TSP conviennent aux mesures générales. Si un delay, une reverb ou une autre traîne dépasse la fenêtre choisie, la réponse peut se chevaucher ; augmentez la **Longueur de séquence**. **Impulsion unitaire** enregistre directement la réponse pendant une durée limitée et peut donc couper une traîne exceptionnellement longue.

Les effets non linéaires, variables dans le temps, aléatoires, bruyants ou générateurs de son peuvent produire des résultats différents selon le niveau ou d'une mesure à l'autre. Considérez ces graphiques comme des instantanés des réglages choisis, et non comme des caractéristiques fixes.
