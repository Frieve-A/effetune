---
title: "Plugins Spatial - Crossfeed, annulation de diaphonie, largeur stéréo et upmix - EffeTune"
description: "Plugins audio spatiaux incluant Crossfeed Filter, Crosstalk Cancellation, MS Matrix, Multiband Balance, Phase Select EQ, Spatial Mapper et Stereo Blend."
lang: fr
---

# Plugins Audio Spatiaux

Une collection de plugins qui améliorent le rendu de votre musique dans vos casques ou enceintes en ajustant la balance stéréo (gauche et droite). Ces effets peuvent rendre votre musique plus spacieuse et naturelle, particulièrement lors de l'écoute au casque.

## Liste des Plugins

- [Crossfeed Filter](#crossfeed-filter) - Filtre de crossfeed pour casques pour une image stéréo naturelle
- [Crosstalk Cancellation](#crosstalk-cancellation) - Réduit la diaphonie entre enceintes stéréo grâce à des mesures près des oreilles
- [MS Matrix](#ms-matrix) - Convertit entre stéréo gauche/droite et format Mid/Side
- [Multiband Balance](#multiband-balance) - Contrôle de balance stéréo dépendant de la fréquence à 5 bandes
- [Phase Select EQ](#phase-select-eq) - Accentue ou atténue les composantes fréquentielles selon la différence de phase G/D et Balance
- [Spatial Mapper](#spatial-mapper) - Sépare le son Direct, Diffuse et Residual et achemine chaque composante entre les canaux
- [Stereo Blend](#stereo-blend) - Contrôle la largeur stéréo de mono à stéréo élargie ou inversion de side

## Crossfeed Filter

Un filtre de crossfeed pour casques qui simule la diaphonie acoustique naturelle qui se produit lors de l'écoute via des haut-parleurs. Cet effet aide à réduire la séparation stéréo exagérée souvent ressentie avec des casques, créant une expérience d'écoute plus naturelle et confortable qui imite la façon dont le son atteint nos oreilles dans un environnement acoustique réel.

### Fonctionnalités clés
- Simule la diaphonie acoustique naturelle pour l'écoute au casque
- Niveau de crossfeed et timing ajustables
- Filtrage passe-bas pour imiter la diaphonie dépendante de la fréquence
- Traitement stéréo uniquement (automatiquement contourné pour les signaux mono ou non stéréo)

### Préréglages système

Cliquez sur **Préréglages d’effet** dans l’en-tête de l’effet pour choisir un dosage de crossfeed complet pour l'écoute au casque.

- **Subtle Blend** - Un crossfeed très léger qui préserve l'essentiel de la largeur d'origine.
- **Vintage Receiver** - Un crossfeed modéré rappelant un adaptateur de casque traditionnel.
- **Living Room Speakers** - Un mélange fort, de type haut-parleurs, pour les enregistrements à séparation stéréo très large.

### Paramètres
- **Level** (-60 dB à 0 dB) : Contrôle la quantité de signal de crossfeed
  - Valeurs plus basses (-20 dB à -6 dB) : Crossfeed subtil et naturel
  - Valeurs plus élevées (-6 dB à 0 dB) : Effet plus prononcé
- **Delay** (0 ms à 1 ms) : Simule la différence de temps de la diaphonie acoustique
  - Valeurs plus basses (0.1-0.3 ms) : Image plus serrée et focalisée
  - Valeurs plus élevées (0.3-1.0 ms) : Présentation plus spacieuse, similaire aux haut-parleurs
- **LPF Freq** (100 Hz à 20000 Hz) : Contrôle la réponse en fréquence du crossfeed
  - Valeurs plus basses (500-1000 Hz) : Diaphonie plus naturelle dépendante de la fréquence
  - Valeurs plus élevées (1000-20000 Hz) : Réponse en fréquence plus large

### Points de départ

Utilisez le préréglage système **Subtle Blend**, **Vintage Receiver** ou **Living Room Speakers** comme point de départ complet. Ajustez ensuite Level en premier : des valeurs plus basses préservent davantage la largeur stéréo, tandis que des valeurs plus élevées rendent le mélange de type haut-parleurs plus évident.

### Guide d'application

1. Optimisation du Casque
   - Commencez par des réglages conservateurs (-15 dB level, 0.3 ms delay)
   - Ajustez le niveau pour le confort et la naturalité
   - Affinez le délai pour la perception spatiale
   - Utilisez LPF pour contrôler la réponse en fréquence

2. Considérations de Style Musical
   - Classique/Jazz : Niveaux plus bas (-15 à -10 dB) pour une présentation naturelle
   - Rock/Pop : Niveaux modérés (-12 à -8 dB) pour adoucir les guitares ou voix très latéralisées tout en gardant l'énergie
   - Électronique ou mix très large : Niveaux bas à modérés (-18 à -10 dB) pour garder la largeur, ou plus hauts seulement pour calmer une séparation gauche/droite excessive

3. Environnement d'Écoute
   - Environnements calmes : Niveaux plus bas pour un effet subtil
   - Environnements bruyants : Niveaux plus élevés pour une meilleure focalisation
   - Sessions d'écoute longues : Réglages conservateurs pour réduire la fatigue

### Guide de démarrage rapide

1. Configuration initiale
   - Réglez Level à -12 dB
   - Réglez Delay à 0.3 ms
   - Réglez LPF Freq à 700 Hz

2. Ajustement fin
   - Ajustez Level pour la quantité de crossfeed souhaitée
   - Modifiez Delay pour la perception spatiale
   - Affinez LPF Freq pour la réponse en fréquence

3. Optimisation
   - Écoutez pour une présentation naturelle et confortable
   - Évitez les réglages excessifs qui sonnent artificiels
   - Testez avec différents styles musicaux

Rappel : Le Crossfeed Filter est conçu pour rendre l'écoute au casque plus naturelle et confortable. Commencez par des réglages conservateurs et ajustez progressivement pour trouver l'équilibre optimal pour vos préférences d'écoute et votre matériel musical.

## Crosstalk Cancellation

Crosstalk Cancellation s'appuie sur des mesures prises au niveau de vos oreilles pour réduire le son de chaque enceinte stéréo qui atteint l'oreille opposée. Utilisez-le avec deux enceintes stéréo lorsque vous écoutez depuis une position mesurée et souhaitez une image stéréo plus nette, proche du binaural. Il n'est pas destiné à l'écoute au casque ni à la lecture mono.

Contrairement à [Crossfeed Filter](#crossfeed-filter), qui ajoute un peu de diaphonie de type enceintes pour l'écoute au casque, Crosstalk Cancellation réduit la diaphonie mesurée pour l'écoute sur enceintes.

### Mesurer et affecter

1. Placez le microphone à la position de votre oreille gauche et effectuez une mesure avec les sorties des enceintes gauche et droite sélectionnées. Affectez le canal gauche de cette mesure à **LL: L Speaker → Left Ear** et son canal droit à **RL: R Speaker → Left Ear**.
2. Déplacez le microphone à la position de votre oreille droite et répétez la même mesure sur les deux sorties. Affectez son canal gauche à **LR: L Speaker → Right Ear** et son canal droit à **RR: R Speaker → Right Ear**.
3. Utilisez des mesures à point unique réalisées avec la même installation d'enceintes et la même position d'écoute. Affectez un canal de mesure différent à chaque emplacement, puis attendez que les filtres soient prêts.

Commencez avec les valeurs par défaut : **Taps** 4096, **Regularization** 50%, **Max Gain** 12 dB, **Freq Low** 200 Hz, **Freq High** 6000 Hz, **Direct Window** 8 ms, **Strength** 70%, **Output Gain** 0 dB et **Latency** 128 échantillons. Comparez avec le bypass et procédez par petits réglages, assis à la position mesurée.

### Paramètres

- **Taps** (1024–16384) : Définit la longueur du filtre. Davantage de taps peut améliorer l'annulation, mais demande plus de calcul et allonge le retard modélisé. Si l'état signale que la queue du filtre risque d'être tronquée, augmentez d'abord Taps.
- **Regularization** (0–100%) : Limite les corrections agressives là où les mesures sont difficiles à annuler. Augmentez-la si le résultat paraît instable ou coloré lorsque vous bougez légèrement ; ne la baissez que si la position mesurée a besoin de davantage d'annulation.
- **Max Gain** (0–24 dB) : Plafonne le relèvement que les filtres de correction peuvent appliquer. Une valeur plus basse est plus douce et préserve la marge ; une valeur plus élevée peut annuler davantage, mais rendre le résultat moins robuste.
- **Freq Low** (20–2000 Hz) et **Freq High** (1000–20000 Hz) : Définissent la bande de correction principale. Les fréquences situées sous cette bande et au-dessus passent sans correction. Commencez avec 200 Hz–6000 Hz ; resserrez la bande si l'effet est trop sensible aux mouvements de la tête.
- **Direct Window** (2–50 ms) : Définit la part de chaque son direct mesuré qui est utilisée. Une fenêtre plus courte réduit les réflexions de la pièce mais peut relever la limite basse effective ; une fenêtre plus longue apporte davantage d'informations dans le grave, mais peut inclure davantage de son de la pièce.
- **Strength** (0–100%) : Passe progressivement du signal non corrigé retardé à 0% à la correction complète à 100%. Commencez à 70% ; baissez-la si le son devient artificiel hors de la position mesurée.
- **Output Gain** (-24 à +24 dB) : Règle le niveau final après correction. Laissez-le d'abord à 0 dB, puis baissez-le si nécessaire pour conserver de la marge.
- **Latency** (0, 128, 256, 512 ou 1024 échantillons) : Sélectionne la latence des blocs de traitement. Des valeurs plus élevées peuvent faciliter le traitement des filtres ; des valeurs plus basses sont préférables lorsque la latence d'écoute de contrôle compte.

### État et latence

L'état commence par **Assign all four measurements to begin.** Pendant la création des filtres, il indique que la conception est en cours ; une fois les filtres prêts, il affiche le gain maximal du filtre. Un avertissement concernant la queue signifie qu'augmenter **Taps** ou **Regularization** peut aider. Un avertissement indiquant que **Direct Window** a relevé la fréquence basse effective signifie que la fenêtre choisie est trop courte pour exploiter les fréquences les plus basses demandées.

Si une mesure affectée est introuvable, sélectionnez-la de nouveau. Si les filtres ne peuvent pas être préparés, essayez moins de **Taps** ou une **Latency** plus élevée. Tant que quatre mesures adaptées ne sont pas affectées et que les filtres ne sont pas prêts, le plugin laisse passer le son sans modification et n'annonce aucune latence de traitement supplémentaire.

Une fois prêt, la latence ajoutée totale correspond à la **Latency** choisie plus le retard modélisé du filtre ; l'application applique sa compensation habituelle du retard de la chaîne. Vérifiez le **Délai total** si l'écoute de contrôle en temps réel ou la synchronisation audio/vidéo compte. Crosstalk Cancellation n'a ni graphique ni autre visualisation.

## MS Matrix

MS Matrix convertit un signal stéréo normal au format Mid/Side, ou reconvertit un signal Mid/Side en stéréo normale. Utilisez-le lorsque vous voulez ajuster séparément les informations de centre et de côté dans une chaîne d'effets, par exemple encoder en M/S, modifier le niveau Mid ou Side, puis décoder vers la stéréo. Pour un simple réglage de largeur stéréo sur de la musique normale, [Stereo Blend](#stereo-blend) est l'outil le plus direct.

### Fonctionnalités clés
- Gains Mid et Side séparés (–18 dB à +18 dB)  
- Sélecteur de Mode : Encode (Stereo→M/S) ou Decode (M/S→Stereo)  
- Permutation Left/Right facultative avant l'encodage ou après le décodage  

### Paramètres
- **Mode** (Encode/Decode) : Encode transforme la stéréo gauche/droite en Mid sur le canal gauche et Side sur le canal droit. Decode traite le canal gauche comme Mid et le canal droit comme Side, puis reconstruit une stéréo normale.
- **Mid Gain** (–18 dB à +18 dB) : Ajuste le niveau Mid pendant la conversion sélectionnée
- **Side Gain** (–18 dB à +18 dB) : Ajuste le niveau Side pendant la conversion sélectionnée
- **Swap L/R** (Off/On) : Échange les canaux gauche et droit avant l'encodage ou après le décodage  

### Paramètres recommandés
1. **Élargissement subtil d'une stéréo normale**
   - Premier MS Matrix : Mode: Encode, Mid Gain: 0 dB, Side Gain: +3 dB, Swap: Off
   - Second MS Matrix après lui : Mode: Decode, Mid Gain: 0 dB, Side Gain: 0 dB, Swap: Off
   - Effet : Renforce légèrement la composante Side, puis ramène le résultat en stéréo normale
2. **Focus central sur une stéréo normale**
   - Premier MS Matrix : Mode: Encode, Mid Gain: +3 dB, Side Gain: -3 dB, Swap: Off
   - Second MS Matrix après lui : Mode: Decode, Mid Gain: 0 dB, Side Gain: 0 dB, Swap: Off
   - Effet : Met les voix et sons centrés plus en avant tout en réduisant l'ambiance latérale
3. **Décoder un Signal M/S Existant**
   - Mode: Decode
   - Mid Gain: 0 dB
   - Side Gain: 0 dB
   - Swap: Off
   - À utiliser seulement lorsque le signal entrant est déjà au format Mid/Side
4. **Inversion créative**
   - Mode: Encode  
   - Mid Gain: 0 dB  
   - Side Gain: 0 dB  
   - Swap: On  

### Guide de démarrage rapide
1. Décidez si vous avez besoin d'une seule conversion ou d'une chaîne complète Encode -> ajustement -> Decode.
2. Pour une écoute stéréo normale, placez un MS Matrix en mode Encode puis un second plus loin en mode Decode.
3. Ajustez **Mid Gain** et **Side Gain** sur l'étage Encode.
4. Activez **Swap L/R** seulement pour corriger les canaux ou créer une inversion.
5. Bypass pour comparer et vérifier que l'image stéréo reste naturelle.

## Multiband Balance

Un processeur de balance dépendant de la fréquence qui divise l'audio en cinq bandes et permet de déplacer chaque bande légèrement vers la gauche ou la droite. Utilisez-le lorsque les basses, voix, cymbales ou autres plages de fréquences semblent tirées d'un côté et que vous voulez rééquilibrer seulement cette partie du son sans déplacer tout le morceau.

### Caractéristiques Principales
- Contrôle de balance stéréo dépendant de la fréquence à 5 bandes
- Filtres de séparation Linkwitz-Riley de haute qualité
- Contrôle de balance linéaire pour ajustement stéréo précis
- Traitement indépendant des canaux gauche et droit
- Gestion automatique des fondus lorsque les filtres de crossover sont réinitialisés

### Paramètres

#### Fréquences de Séparation
- **Freq 1** (20-500 Hz) : Sépare les bandes basses et médium-basses
- **Freq 2** (100-2000 Hz) : Sépare les bandes médium-basses et médiums
- **Freq 3** (500-8000 Hz) : Sépare les bandes médiums et médium-hautes
- **Freq 4** (1000-20000 Hz) : Sépare les bandes médium-hautes et hautes

#### Contrôles de Bande
Chaque bande dispose d'un contrôle de balance indépendant :
- **Band 1 Bal.** (-100% à +100%) : Contrôle la balance stéréo des basses fréquences
- **Band 2 Bal.** (-100% à +100%) : Contrôle la balance stéréo des fréquences médium-basses
- **Band 3 Bal.** (-100% à +100%) : Contrôle la balance stéréo des fréquences médiums
- **Band 4 Bal.** (-100% à +100%) : Contrôle la balance stéréo des fréquences médium-hautes
- **Band 5 Bal.** (-100% à +100%) : Contrôle la balance stéréo des hautes fréquences

### Réglages Recommandés

1. Corriger des Aigus Tirés vers la Droite
   - Bande Basse (20-100 Hz) : 0% (centré)
   - Médium-Basse (100-500 Hz) : 0%
   - Médium (500-2000 Hz) : 0%
   - Médium-Haute (2000-8000 Hz) : -10% à -25%
   - Haute (8000+ Hz) : -10% à -30%
   - Effet : Déplace légèrement le contenu brillant vers la gauche tout en gardant les basses et voix stables

2. Corriger un Bas-Médium Tiré vers la Gauche
   - Bande Basse : 0%
   - Médium-Basse : +10% à +25%
   - Médium : +5% à +15%
   - Médium-Haute : 0%
   - Haute : 0%
   - Effet : Déplace légèrement le corps chaleureux et les voix basses vers la droite sans changer toute l'image stéréo

3. Garder les Basses Centrées en Ajustant l'Air
   - Bande Basse : 0%
   - Médium-Basse : 0%
   - Médium : 0%
   - Médium-Haute : +5% à +15%
   - Haute : +10% à +20%
   - Effet : Déplace doucement l'ambiance haute vers la droite tandis que le grave reste centré

### Guide d'Application

1. Correction de Balance à l'Écoute
   - Gardez les basses fréquences (sous 100 Hz) centrées pour des basses stables
   - Déplacez seulement la plage de fréquences qui semble décentrée
   - Utilisez d'abord de petites valeurs signées (environ 5-20%)
   - Vérifiez l'écoute mono pour repérer les changements de tonalité ou de niveau

2. Résolution de Problèmes
   - Rééquilibrez les plages de fréquences qui semblent trop à gauche ou à droite
   - Resserrez les basses non focalisées en centrant les basses fréquences
   - Réduisez les artefacts stéréo agressifs dans les hautes fréquences
   - Améliorez les enregistrements où différentes parties du son penchent de côtés différents

3. Effets d'Écoute Créatifs
   - Créez un placement inhabituel dépendant de la fréquence
   - Faites pencher les hautes fréquences d'un côté tout en gardant les basses centrées
   - Construisez une ambiance qui semble plus large avec de petits déplacements dans les bandes hautes

4. Ajustement du Champ Stéréo
   - Ajustement fin de la balance stéréo par bande de fréquence
   - Correction de la distribution stéréo inégale
   - Ne l'utilisez pas comme contrôle de largeur stéréo ; utilisez Stereo Blend pour élargir ou rétrécir l'image entière
   - Maintien de la compatibilité mono

### Guide de Démarrage Rapide

1. Configuration Initiale
   - Commencez avec toutes les bandes centrées (0%)
   - Réglez les fréquences de séparation aux points standards :
     * Freq 1 : 100 Hz
     * Freq 2 : 500 Hz
     * Freq 3 : 2000 Hz
     * Freq 4 : 8000 Hz

2. Amélioration de Base
   - Gardez Band 1 (basses) centré
   - Faites de petits ajustements sur les bandes plus hautes
   - Écoutez les changements dans l'image spatiale
   - Vérifiez la compatibilité mono

3. Réglage Fin
   - Ajustez les points de séparation pour correspondre à votre matériel
   - Effectuez des changements graduels des positions de bande
   - Écoutez les artefacts indésirables
   - Comparez avec le bypass pour perspective

N'oubliez pas : Le Multiband Balance est un outil puissant qui nécessite un ajustement soigneux. Commencez avec des réglages subtils et augmentez la complexité selon les besoins. Vérifiez toujours vos ajustements en stéréo et en mono pour assurer la compatibilité.

## Phase Select EQ

Phase Select EQ accentue ou atténue les composantes fréquentielles stéréo sélectionnées simultanément par la **fréquence**, la **différence de phase gauche/droite absolue** et l'**équilibre de niveau gauche/droite**. Il applique le même multiplicateur de gain positif aux deux canaux : il agit donc sur le niveau des composantes spatiales visées sans faire tourner ni modifier la phase. Utilisez-le lorsqu'un EQ classique, qui ne s'appuie que sur la fréquence, ne permet pas de séparer une voix ou un instrument centré de sons plus larges ou fortement panoramiqués occupant la même bande de fréquences.

Cinq Bands indépendants sont disponibles, chacun avec un **Core** intérieur (Gain appliqué intégralement) et une **Transition** extérieure (retour progressif vers 100%). Les gains des Bands superposés se multiplient : plusieurs accentuations peuvent donc porter le signal au-delà de 0 dBFS ; conservez une marge suffisante et comparez avec le bypass. Phase Select EQ ajoute une latence d'analyse FFT (5 120 échantillons, soit environ 106,7 ms à 48 kHz ; environ 116,1 ms à 44,1 kHz), qui est incluse dans le **Délai total** et peut affecter l'écoute de contrôle en temps réel et la synchronisation audio/vidéo.

### Guide d'amélioration sonore

1. **Adoucir l'éclat des aigus larges** : Réglez un Band vers 4–12 kHz et 90–180° de Phase, avec un Gain de 70 à 90% et des transitions larges, pour adoucir la dureté de l'extrême aigu en opposition de phase tout en préservant les détails centrés.
2. **Donner de la présence à une voix centrée** : Réglez un Band vers 1–4 kHz et 0–30° de Phase (ou -17% à +17% de Balance), avec un Gain de 110 à 125%, pour faire ressortir les médiums proches du centre sans accentuer l'ambiance large.
3. **Maîtriser une ambiance diffuse dans le bas-médium** : Réglez un Band vers 150–600 Hz et 60–150° de Phase, avec un Gain de 80 à 90%, pour nettoyer l'empâtement large du bas-médium tout en conservant le grave centré et le corps de la caisse claire.
4. **Atténuer un instrument fortement panoramiqué** : En vue **Balance**, sélectionnez -100% à -70% (gauche) ou +70% à +100% (droite) avec un Phase Core de 150–180°, afin d'inclure les points unilatéraux situés à -180° et +180° (ou 0–180° si Balance doit être le seul critère), resserrez la plage de fréquences autour de l'instrument et réduisez le Gain à 70–90%.

Ces plages de phase indiquent des tendances courantes, pas des positions fixes de sources sonores. Observez où les points apparaissent réellement, procédez par petits réglages et vérifiez le résultat au casque comme sur enceintes.

### Paramètres

- **Band 1–5 / case à cocher** (Off/On) : Sélectionne un Band à modifier et l'active ou le désactive.
- **Gain** (0% à 200%) : Multiplicateur de niveau dans le Core (100% = inchangé, 0% = coupé, 200% = +6 dB).
- **Solo** (Off/On) : Permet d'écouter uniquement les composantes sélectionnées par le ou les Bands en Solo ; tant que Solo est activé, Gain est ignoré et tout ce qui se trouve hors des Bands en Solo est coupé.
- **Core Low Freq / Core High Freq** (20 Hz à 40 kHz, dans la limite permise par la fréquence d'échantillonnage) : Plage de fréquences traitée intégralement.
- **Low Freq Trans / High Freq Trans** : Largeurs du fondu fréquentiel sous et au-dessus du Core.
- **Core Low Phase / Core High Phase** (0° à 180°) : Plage de différence de phase G/D absolue traitée intégralement.
- **Low Phase Trans / High Phase Trans** : Largeurs du fondu de phase vers 0° et vers 180°.
- **Outer Low Bal / Core Low Bal / Core High Bal / Outer High Bal** (-100% à +100%) : Limites du Core et de la Transition extérieure pour l'équilibre d'amplitude gauche/droite.
- **Poignées de la carte** : Faites glisser l'intérieur du cadre d'un Band pour le déplacer, les bords ou les coins du Core pour le redimensionner, ou les poignées extérieures en pointillés pour régler les transitions.

### Lecture de la carte de sélection

- **Axe vertical** : Fréquence sur une échelle logarithmique (graves en bas, aigus en haut).
- **Axe horizontal** : Basculez entre **Phase** et **Balance** au-dessus de la carte ; modifier un réglage Phase ou Balance change automatiquement de vue.
  - **Phase** : 0° (en phase) au centre ; -180° et +180° sur les bords représentent le même point en opposition de phase. La sélection utilisant la différence de phase absolue, le cadre est symétrique de part et d'autre de 0°, se rejoint au centre lorsqu'il touche 0° et se prolonge par-delà les deux bords lorsqu'il atteint 180°.
  - **Balance** : 50:50 au centre, gauche seule sur le bord gauche, droite seule sur le bord droit. Balance vaut `(amplitude droite - amplitude gauche) / (amplitude gauche + amplitude droite) × 100%`.
- **Sons unilatéraux** : Une composante présente dans un seul canal a une Balance de -100% ou +100% et apparaît à -180° (gauche) ou +180° (droite) en vue Phase ; les sons fortement panoramiqués peuvent donc être sélectionnés depuis l'une ou l'autre vue.
- **Points et cadres** : Les points blancs représentent les composantes récentes de l'entrée (plus lumineux et plus grands = plus forts ; les points exclus par l'axe masqué sont assombris). Les rectangles intérieurs pleins montrent le **Core** de chaque Band activé et les rectangles extérieurs en pointillés sa **Transition** ; le Band en cours de modification est mis en évidence, et le numéro placé au coin de chaque Core identifie le Band.
- **Badges** : Le badge à côté de chaque numéro de Band indique sa plage sur l'axe masqué sous la forme limite extérieure basse › Core bas–haut › limite extérieure haute, par exemple `P 20°›40°–80°›100°` ou `B 100:0›80:20–70:30›0:100` (rapports gauche:droite). `P full` ou `B full` signifie que cet axe n'est pas limité.
- **Lecture des valeurs** : Survolez la carte, ou touchez-la et faites glisser, pour lire la fréquence et la différence de phase ou la balance à cet endroit.

La grille Balance utilise des rapports de canaux courants ; les écarts de niveau G/D approximatifs sont indiqués à titre de repère :

| Balance | 0% | ±17% | ±33% | ±60% | ±82% | ±100% |
|---|---:|---:|---:|---:|---:|---:|
| Rapport des canaux | 50:50 | 59:41 | 67:33 | 80:20 | 91:9 | 100:0 |
| Écart de niveau G/D | 0 dB | ±3 dB | ±6 dB | ±12 dB | ±20 dB | un seul canal |

## Spatial Mapper

Spatial Mapper analyse les relations entre les canaux d'entrée par bandes de fréquences, sépare en continu le son en composantes Direct, Diffuse et Residual, puis achemine chaque composante dans le bus de canaux actuel. Il permet de maintenir les sons précis à l'avant, d'envoyer l'ambiance vers les canaux surround ou en hauteur, d'extraire le centre ou l'ambiance et de modifier la largeur stéréo. Le preset **Transparent**, sélectionné par défaut, conserve la disposition d'origine des canaux.

Les trois composantes jouent des rôles différents. **Direct** contient le son cohérent dominant de chaque bande. **Diffuse** contient le son moins cohérent et réparti. **Residual** conserve ce qui n'est pas entièrement affecté à l'une ou l'autre de ces composantes. La séparation est progressive : les sons ne basculent pas brutalement d'un routage à l'autre lorsque vous modifiez les réglages.

Spatial Mapper ajoute une latence liée à l'analyse fréquentielle. EffeTune l'inclut dans l'affichage **Délai total**. Tenez-en compte pour l'écoute de contrôle en temps réel et la synchronisation audio/vidéo.

### Préréglages système

Cliquez sur **Préréglages d’effet** dans l’en-tête de l’effet pour choisir une configuration de départ complète.

- **Transparent** - Conserve la disposition d'origine des canaux et constitue le preset par défaut.
- **Stereo Enhance** - Élargit une entrée stéréo par le routage Residual tout en conservant la position des sons précis et diffus.
- **Center Extract** - Envoie la composante Direct vers le canal 3. Utilisez un bus d'au moins trois canaux.
- **5.1 Upmix** - Répartit la stéréo dans l'ordre L, R, C, LFE, Ls, Rs. Le canal LFE reste vide et le bus doit compter au moins six canaux.
- **7.1.4 Upmix** - Répartit la stéréo dans l'ordre L, R, C, LFE, Ls, Rs, Lb, Rb, Ltf, Rtf, Ltb, Rtb. Le canal LFE reste vide et le bus doit compter au moins douze canaux.
- **Ambience Extract** - Conserve la composante Diffuse et supprime les composantes Direct et Residual.

### Lecture et modification de la grille de routage

Dans **Component Routing**, choisissez l'onglet **Direct**, **Diffuse** ou **Residual**. Les colonnes correspondent aux canaux d'entrée analysés et les lignes aux canaux du bus de sortie. Utilisez le petit curseur ou le champ numérique de chaque cellule pour régler un gain linéaire de -1,00 à +1,00 par pas de 0,01 : 0 ne crée aucune liaison, +1,00 envoie la composante avec sa polarité positive complète, et une valeur négative l'envoie avec la polarité inversée. Les valeurs négatives apparaissent en rouge. Les valeurs intermédiaires donnent un niveau réduit en proportion.

Une ligne de sortie routée remplace le canal correspondant du bus par le résultat. Un canal de sortie compris dans la plage **Input Channels** devient silencieux si aucune composante n'est dirigée vers sa ligne. Les canaux hors de la plage **Input Channels** traversent l'effet avec un retard identique lorsqu'aucune composante n'y écrit.

### Guide d'amélioration de l'écoute

1. **Élargir la stéréo sans déplacer autant les sons précis**
   - Commencez avec **Stereo Enhance**.
   - Ne réduisez **Directness** ou **Diffuse Extraction** que si davantage de contenu doit rester dans Residual pour le routage d'élargissement.
   - Comparez avec **Transparent** et réduisez la modification si les images centrales faiblissent ou si trop de contenu disparaît en lecture mono.
2. **Créer un canal central à partir d'une source stéréo**
   - Utilisez un bus d'au moins trois canaux et choisissez **Center Extract**.
   - Augmentez **Directness** et **Separation** pour concentrer davantage de contenu cohérent dans Direct.
   - Vérifiez que la voix et les autres éléments centrés restent stables, tandis que l'ambiance large reste principalement à gauche et à droite.
3. **Étendre la stéréo aux canaux surround ou en hauteur**
   - Configurez le bus dans l'ordre de canaux indiqué ci-dessus, puis choisissez **5.1 Upmix** ou **7.1.4 Upmix**.
   - Réglez **Diffuse Extraction** pour doser la part de contenu réparti envoyée aux routages surround et en hauteur.
   - Le preset ne génère pas de signal LFE ; ajoutez une gestion des graves séparée si nécessaire.
4. **Isoler l'ambiance**
   - Commencez avec **Ambience Extract**.
   - Augmentez **Diffuse Extraction** pour une sélection diffuse plus marquée, et utilisez **Phase Sensitivity** pour décider dans quelle mesure une opposition de phase entre canaux réduit la classification Direct.

### Paramètres

- **Input Channels** (1 à 16) : Définit le nombre de canaux analysés à partir du début du bus. Si le bus en possède moins, Spatial Mapper utilise les canaux disponibles.
- **Analysis Bands** (8, 16, 24, 32 ou 48) : Définit la résolution fréquentielle de l'analyse spatiale. Un plus grand nombre de bandes suit plus précisément les variations de position selon la fréquence, mais demande davantage de calcul. La valeur par défaut est 24.
- **Directness** (0 % à 100 %) : Règle la quantité de contenu cohérent dominant affectée à Direct. Une valeur élevée renforce l'extraction Direct.
- **Separation** (0 % à 100 %) : Règle la sélectivité de l'affectation à Direct et Diffuse. Une valeur élevée laisse davantage de contenu ambigu dans Residual et accentue le contraste entre les routages.
- **Diffuse Extraction** (0 % à 100 %) : Règle la quantité de contenu peu cohérent affectée à Diffuse. Une valeur élevée envoie davantage d'ambiance répartie vers le routage Diffuse.
- **Phase Sensitivity** (0 % à 100 %) : Règle l'influence de l'opposition de phase entre canaux sur la classification Direct. Une valeur faible traite le contenu cohérent de polarité opposée comme les autres sons cohérents ; une valeur élevée en laisse davantage hors de Direct. Ce réglage ne désigne pas automatiquement les sons en opposition de phase comme du contenu arrière.
- **Temporal Smoothing** (0 % à 100 %, Fast à Stable) : Règle la vitesse à laquelle l'analyse et le routage suivent les changements. Une valeur faible réagit plus vite ; une valeur élevée réduit les mouvements de l'image et le pompage, mais réagit plus lentement.
- **Energy Preservation** (Off/On) : Normalise séparément les routages Direct, Diffuse et Residual afin d'éviter les variations de niveau involontaires dues aux matrices de routage. Désactivez-le lorsque le gain de la matrice doit lui-même modifier le niveau d'une composante.
- **Component Routing / Direct** : Sélectionne la grille Direct et règle ses gains de sortie.
- **Component Routing / Diffuse** : Sélectionne la grille Diffuse et règle ses gains de sortie.
- **Component Routing / Residual** : Sélectionne la grille Residual et règle ses gains de sortie.

## Stereo Blend

Un effet qui aide à obtenir un champ sonore plus naturel en ajustant la largeur stéréo de votre musique. Il est particulièrement utile pour l'écoute au casque, où il peut réduire la séparation stéréo exagérée qui se produit souvent avec les casques, rendant l'expérience d'écoute plus naturelle et moins fatigante. Il peut également améliorer l'image stéréo pour l'écoute sur enceintes lorsque nécessaire.

### Guide d'Amélioration de l'Écoute
- Optimisation Casque :
  - Réduisez la largeur stéréo (60-90%) pour une présentation plus naturelle, similaire aux enceintes
  - Minimisez la fatigue d'écoute due à une séparation stéréo excessive
  - Créez une scène sonore frontale plus réaliste
- Amélioration Enceintes :
  - Maintenez l'image stéréo originale (100%) pour une reproduction précise
  - Amélioration subtile (110-130%) pour une scène sonore plus large si nécessaire
  - Ajustement prudent pour maintenir un champ sonore naturel
- Contrôle du Champ Sonore :
  - Concentration sur une présentation naturelle et réaliste
  - Évitez une largeur excessive qui pourrait sonner artificielle
  - Utilisez les valeurs négatives seulement pour une inversion de polarité du composant Side à des fins correctives ou créatives
  - Optimisez pour votre environnement d'écoute spécifique

### Paramètres
- **Stereo** - Contrôle la largeur stéréo (-200% à 200%)
  - Valeurs négatives : Inversent la polarité du composant stéréo side (L-R) avant reconstruction
  - -200% : Largeur maximale avec polarité side inversée ; à utiliser seulement pour correction ou cas particuliers
  - -100% : Largeur stéréo originale avec image gauche/droite inversée
  - 0% : Mono complet (canaux gauche et droit additionnés)
  - 100% : Image stéréo originale
  - 200% : Largeur maximale ; garde le centre tout en renforçant fortement la différence stéréo side

### Réglages Recommandés pour Différents Scénarios d'Écoute

1. Écoute au Casque (Naturel)
   - Stereo : 60-90%
   - Effet : Séparation stéréo réduite
   - Parfait pour : Longues sessions d'écoute, réduction de la fatigue

2. Écoute sur Enceintes (Référence)
   - Stereo : 100%
   - Effet : Image stéréo originale
   - Parfait pour : Reproduction précise

3. Amélioration Enceintes
   - Stereo : 110-130%
   - Effet : Amélioration subtile de la largeur
   - Parfait pour : Pièces avec placement rapproché des enceintes

### Guide d'Optimisation par Style Musical

- Musique Classique
  - Casque : 70-80%
  - Enceintes : 100%
  - Avantage : Perspective naturelle de salle de concert

- Jazz & Acoustique
  - Casque : 80-90%
  - Enceintes : 100-110%
  - Avantage : Son d'ensemble intime et réaliste

- Rock & Pop
  - Casque : 85-95%
  - Enceintes : 100-120%
  - Avantage : Impact équilibré sans largeur artificielle

- Musique Électronique
  - Casque : 90-100%
  - Enceintes : 100-130%
  - Avantage : Spatialisation contrôlée tout en maintenant la focalisation

### Guide de Démarrage Rapide

1. Choisissez Votre Configuration d'Écoute
   - Identifiez si vous utilisez un casque ou des enceintes
   - Cela détermine votre point de départ pour l'ajustement

2. Commencez avec des Réglages Conservateurs
   - Casque : Commencez à 80%
   - Enceintes : Commencez à 100%
   - Écoutez le placement naturel du son

3. Affinez pour Votre Musique
   - Faites de petits ajustements (5-10% à la fois)
   - Concentrez-vous sur l'obtention d'un champ sonore naturel
   - Prêtez attention au confort d'écoute

N'oubliez pas : L'objectif est d'obtenir une expérience d'écoute naturelle et confortable qui réduit la fatigue et maintient la présentation musicale voulue. Évitez les réglages extrêmes qui peuvent sembler impressionnants au début mais deviennent fatigants avec le temps.
