---
title: "Plugins Lo-Fi - EffeTune"
description: "Plugins d'effets lo-fi incluant AM Radio Simulator, Bit Crusher, Noise Blender, Vinyl Artifacts et plus encore."
lang: fr
---

# Plugins Audio Lo-Fi

Une collection de plugins qui ajoutent du caractère vintage et des qualités nostalgiques à votre musique. Ces effets peuvent faire sonner la musique numérique moderne comme si elle était jouée à travers des équipements classiques ou lui donner ce son "lo-fi" populaire qui est à la fois relaxant et atmosphérique.

## Liste des Plugins

- [AM Radio Simulator](#am-radio-simulator) - Fait passer la musique dans une chaîne de diffusion et de réception AM modélisée
- [Bit Crusher](#bit-crusher) - Crée des sons rétro de jeux vidéo et numériques vintage
- [Cassette Artifacts](#cassette-artifacts) - Enregistre la musique sur une cassette compacte modélisée et la relit sur une platine Type I/II/IV avec Dolby B/C
- [Digital Error Emulator](#digital-error-emulator) - Simule diverses erreurs de transmission audio numérique
- [DSD64 IMD Simulator](#dsd64-imd-simulator) - Simule la distorsion d'intermodulation audible issue du bruit ultrasonique du DSD64
- [FM Radio Simulator](#fm-radio-simulator) - Fait passer la musique par une chaîne d'émission et de réception FM simulée physiquement
- [G.726 Simulator](#g726-simulator) - Simule un aller-retour d’encodage/décodage vocal ITU-T G.726 avec une liaison radio bruitée facultative
- [GSM-FR Simulator](#gsm-fr-simulator) - Simule un aller-retour d’encodage/décodage vocal GSM-FR à 13 kbit/s sur liaison radio avec masquage des pertes de trames
- [Hum Generator](#hum-generator) - Ajoute une ambiance de ronflement électrique contrôlable pour une écoute vintage/lo-fi
- [MP3 Codec Simulator](#mp3-codec-simulator) - Simule un aller-retour propre MPEG Layer III à faible débit
- [Noise Blender](#noise-blender) - Ajoute une texture atmosphérique en arrière-plan
- [SBC Codec Simulator](#sbc-codec-simulator) - Reproduit un aller-retour Bluetooth A2DP SBC avec pertes de paquets et masquage facultatifs
- [Simple Jitter](#simple-jitter) - Crée des imperfections numériques vintage subtiles
- [SW Radio Simulator](#sw-radio-simulator) - Fait passer la musique dans une chaîne modélisée d'émission en ondes courtes, de propagation ionosphérique et de réception
- [Tape Artifacts](#tape-artifacts) - Enregistre la musique sur une bande magnétique à bobines modélisée puis la relit
- [Vinyl Artifacts](#vinyl-artifacts) - Ajoute des pops, crépitements, souffle, rumble et fuite de bruit stéréo façon vinyle
- [Vinyl Simulator](#vinyl-simulator) - Grave le signal dans un sillon modélisé puis le lit avec un modèle physique de pointe

## AM Radio Simulator

AM Radio Simulator transforme la musique au moyen d'une chaîne de radiodiffusion AM modélisée : traitement et modulation de l'émetteur, propagation par onde de sol et onde ionosphérique, parasites et brouillage du canal adjacent, accord, détection et AGC du récepteur, puis haut-parleur de radio facultatif. Utilisez-le pour comparer une station locale puissante à une station lointaine qui s'évanouit la nuit, explorer une bande encombrée ou appliquer à la musique la bande passante, la distorsion, les évanouissements et les interférences propres à la réception AM.

Cet effet nécessite un environnement compatible avec son traitement en temps réel. Lorsque ce traitement n'est pas disponible, le son reste inchangé et le HUD indique que l'effet est indisponible.

### Différences avec les effets lo-fi additifs

- **AM Radio Simulator** modifie le signal d'entrée en le modulant, puis en lui faisant subir propagation, filtrage et détection. Les parasites, le brouillage et le ronflement sont introduits à des endroits modélisés de la chaîne radio ; ils interagissent donc avec l'accord, le filtre IF et l'AGC.
- **Noise Blender** ajoute un bruit de fond général, tandis que **Hum Generator** ajoute une couche de ronflement réglable. Choisissez-les si vous voulez ces sons sans transformer la musique au moyen d'un récepteur radio.
- **Vinyl Artifacts** ajoute des bruits de surface de disque sans modifier le signal musical d'origine. **Vinyl Simulator** transforme lui aussi le signal à l'aide d'un modèle physique, mais il simule un sillon et une pointe de lecture plutôt qu'une transmission radio.

### Guide d'amélioration du son

- **Station locale claire :** utilisez un Signal puissant, peu de Skywave et de Static, centrez Tuning et élargissez IF Bandwidth. Choisissez Table pour une réponse de radio plus ample ou Off pour une sortie ligne.
- **Station lointaine de nuit :** baissez Signal, augmentez Skywave et choisissez un Fading Speed modéré. Avec AGC Speed sur Slow, le niveau revient plus progressivement ; Static ajoute des salves occasionnelles rappelant des éclairs lointains.
- **Bande encombrée :** augmentez Interference et réglez Interf. Offset sur 9 ou 10 kHz. Un IF Bandwidth étroit rejette davantage la station voisine ; de petits changements de Tuning modifient la quantité de brouillage qui atteint le détecteur.
- **Surcharge de l'émission :** poussez Mod Depth au-dessus de 100 % ou allongez Detector RC pour entendre la surmodulation et la distorsion de coupure diagonale propres à l'AM. Réduisez l'un des deux pour une réception plus propre.
- **Profondeur des évanouissements :** les nouvelles instances utilisent Skywave à 1 % pour des variations de niveau plus calmes en Mono et un évanouissement nocturne moins marqué. Montez Skywave à environ 8 % si vous recherchez un évanouissement nettement plus profond ; les valeurs supérieures accentuent encore l'effet.
- Commencez avec Mix à 100 % pour évaluer le modèle radio. Réduisez-le uniquement si vous souhaitez conserver délibérément une partie de l'image stéréo d'origine.

### Mélange C-QUAM et modèle Static

En C-QUAM, le mélange stéréo automatique observe les pertes de signal qualifiées sur deux axes orthogonaux du récepteur : le signal somme décodé et la région du pilote à 25 Hz du signal différence en quadrature. L'effet de l'AGC est retiré des deux observations, et la qualité ne diminue que lorsque la perte coïncide sur les deux axes. Cette règle de coïncidence évite de confondre les variations normales du programme sur un seul axe avec un évanouissement RF. L'observation ne fonctionne que lorsque la PLL est en TRACK et que le pilote est accepté ; dans les autres cas, elle est effacée.

La valeur Skywave par défaut des nouvelles instances est de 1 %, adoptée après validation des contrôles intégrés du modèle. Les préréglages enregistrés conservent leur valeur Skywave explicitement stockée. Par rapport à 8 %, le réglage de 1 % donne en Mono des variations de niveau plus calmes et des évanouissements moins profonds ; choisissez environ 8 % pour simuler un évanouissement nocturne plus sévère.

La plage figée et validée de la réponse de qualité commence à Fading Speed 0.05 Hz. Une atténuation qui évolue beaucoup plus lentement que la constante de descente de 60 s de la référence adaptative est absorbée dans cette référence et n'est volontairement pas conservée comme perte de qualité continue. La tolérance résiduelle de programme de 0.75 dB, le décalage de rapport de 0.04, la bande d'observation du pilote Q=4, les constantes de temps de qualité de 0.05/0.2/0.5/60 s, ainsi que la zone morte de 0.5 dB et l'étendue de transition de 5.0 dB, sont des calibrages empiriques du simulateur et non des spécifications générales des récepteurs C-QUAM.

Cette observation fidèle au récepteur partage avec le matériel C-QUAM à pilote une ambiguïté liée au programme. Si un programme contient à la fois de l'énergie de différence près de 25 Hz et une somme/DC asymétrique, l'arrêt simultané des deux composantes peut réduire brièvement le mélange stéréo, car le récepteur reçoit les mêmes indices que lors d'un évanouissement RF. De même, un résidu cohérent en opposition de phase peut réduire l'observation de qualité alors que la PLL reste en TRACK et que le pilote demeure accepté. Ces comportements sont intentionnels dans les limites approuvées du modèle et ne constituent pas des défauts.

Les événements Static utilisent un calibrage d'aire vectorielle relatif à la porteuse. Chaque événement part d'une aire de 20.0 µs rapportée à la porteuse nominale de la station souhaitée, avec une distribution uniforme empirique de 0.5 à 1.5 et une phase aléatoire. Les événements sont planifiés selon des échéances absolues en double précision, et non par un compte à rebours d'échantillons arrondi : le temps reste donc continu entre les blocs de rendu et plusieurs événements dus dans un même échantillon sont cumulés. L'échelle de 20.0 µs et sa distribution sont des calibrages empiriques du simulateur.

### Paramètres

#### Station

- **Radio** (activé ou désactivé) - Active ou coupe l'émission de la station. Une fois coupée, la porteuse disparaît entièrement : il ne reste au récepteur que les parasites atmosphériques, la station voisine et son propre bruit, et l'AGC s'ouvre en grand jusqu'à faire monter ce fond très fort. De quoi entendre l'instant où une station prend l'antenne ou la quitte. À ne pas confondre avec la désactivation de l'effet lui-même, qui laisse la musique passer telle quelle.
- **Stereo Mode** (Mono ou C-QUAM) - Mono utilise un récepteur classique à détecteur d'enveloppe. C-QUAM permet une réception stéréo, avec un rapport signal/bruit inférieur à celui du mono, et revient automatiquement vers le mono lorsque le signal est faible ou mal accordé. Comme le récepteur emploie une méthode de détection physiquement différente, le changement de mode peut aussi modifier le timbre ; Detector RC et son écrêtage diagonal ne s'appliquent qu'à Mono et sont sans effet en C-QUAM. La stéréo C-QUAM fonctionne jusqu’à une fréquence d’échantillonnage de 192 kHz ; au-delà, la réception est monophonique. La simulation ne modélise que la limite de phase de modulation C-QUAM c(5) de la FCC, et non un test complet de conformité.
- **TX Bandwidth** (2.0 à 10.0 kHz) - Règle la bande passante audio de l'émetteur. Une valeur basse donne un son plus sombre et restreint ; une valeur élevée conserve davantage de détails.
- **Pre-emphasis** (0 à 100 %) - Renforce les hautes fréquences avant l'émission. Un réglage élevé ajoute de la présence, mais sollicite aussi davantage la chaîne de diffusion sur les crêtes brillantes.
- **Mod Depth** (10 à 125 %) - Règle la profondeur de modulation AM. Au-dessus de 100 %, une surmodulation et un écrêtage des crêtes négatives apparaissent.
- **Compression** (0 à 20 dB) - Règle la profondeur du limiteur de diffusion. Un réglage élevé maîtrise les crêtes et uniformise la modulation.

#### Path

- **Signal** (-50 à 0 dB) - Règle la puissance du signal reçu. Un signal faible révèle davantage le bruit du récepteur et demande plus de gain AGC.
- **Skywave** (0 à 100 %) - Mélange l'onde de sol stable aux trajets ionosphériques retardés. Les nouvelles instances démarrent à 1 % pour un mouvement discret ; autour de 8 %, l'évanouissement nocturne devient plus sévère, et les valeurs supérieures approfondissent encore l'évanouissement sélectif.
- **Fading Speed** (0.05 à 2.0 Hz) - Règle la vitesse de variation des conditions de propagation ionosphérique.
- **Static** (0 à 100/s) - Règle la fréquence des événements parasites semblables à des éclairs. Chaque événement relatif à la porteuse suit un calendrier absolu et résonne dans le filtre IF au lieu d'être ajouté après réception.
- **Interference** (-80 à 0 dB) - Règle la puissance de la station voisine. -80 dB la désactive ; elle devient plus forte à mesure que la valeur approche de 0 dB.
- **Interf. Offset** (5 à 10 kHz) - Règle l'espacement de la station voisine et la fréquence de battement de porteuses qui en résulte. 9 et 10 kHz correspondent à des espacements de canaux courants.

#### Receiver

- **Tuning** (-30.0 à +30.0 kHz) - Décale l'accord du récepteur par rapport à la station voulue ; une valeur positive accorde le récepteur au-dessus de la station et une valeur négative en dessous. Un faible décalage réduit la clarté et accentue la distorsion du filtrage asymétrique ; avec un fort décalage, la station disparaît sous le bruit du récepteur. Le sens détermine aussi si le récepteur se rapproche ou s'éloigne de la station adjacente supérieure définie par Interf. Offset.
- **IF Bandwidth** (2.0 à 20.0 kHz) - Règle la largeur totale de la bande passante IF du récepteur. Une bande étroite rejette davantage de bruit et de brouillage, mais atténue plus d'aigus ; une bande large conserve davantage de détails.
- **AGC Speed** (Slow, Mid ou Fast) - Règle la vitesse de suivi des variations du signal par le contrôle automatique de gain. Slow donne un retour de niveau et un pompage plus progressifs ; Fast maîtrise mieux les évanouissements rapides.
- **Detector RC** (20 à 500 µs) - Règle le temps de décharge du détecteur d'enveloppe. Une valeur longue lisse davantage l'enveloppe, mais accroît la distorsion de coupure diagonale dans les aigus lorsque la modulation est forte.
- **Hum** (-80 à -20 dB) - Règle le ronflement d'alimentation. -80 dB le désactive. Contrairement à une couche de ronflement ajoutée, la majeure partie de cet effet module le gain du récepteur avant la détection.
- **Hum Freq** (50 ou 60 Hz) - Sélectionne la fréquence secteur simulée.

#### Output

- **Speaker** (Off, Small ou Table) - Sélectionne une sortie ligne, la réponse limitée d'une radio de poche ou la réponse plus ample d'un poste de table.
- **Output Gain** (-24 à +24 dB) - Règle le niveau après le traitement du récepteur et du haut-parleur.
- **Mix** (0 à 100 %) - Mélange le signal stéréo d'origine avec la réception mono simulée. À 0 %, la stéréo reste inchangée ; à 100 %, le même signal traité est envoyé à gauche et à droite. La sortie n'est entièrement mono qu'avec Mix à 100 %.
- En C-QUAM, le signal traité est stéréo lorsque la réception le permet ; la description mono ci-dessus ne concerne que le mode Mono. Le retard du filtre FIR reste dans le trajet traité du récepteur. Mix ne retarde pas le signal sec pour l'aligner : les réglages intermédiaires combinent donc les deux avec ce décalage temporel.

### Lecture du HUD

- **S METER** indique, sur une échelle de S1 à S9, la puissance du signal que le récepteur reçoit dans sa bande avant l'AGC. Comme le S-mètre d'un poste réel, il additionne tout ce qui se trouve dans la bande passante : la station voisine, le bruit et les parasites font donc monter l'indication en même temps que la station voulue.
- **AGC GAIN** indique le gain actuellement appliqué par le récepteur. Il augmente normalement lorsque Signal baisse ou qu'un évanouissement s'accentue. Il est plafonné à +42 dB : les évanouissements plus profonds et les signaux plus faibles restent donc moins forts au lieu d'être entièrement compensés.
- **MODULATION** indique le taux de modulation effectif après le filtrage de l'émetteur.
- **FADE / EVENTS** indique en dB la variation actuelle du gain de propagation et clignote selon les fréquences récentes de parasites et d'écrêtage. Si vous recherchez un résultat plus propre et que l'écrêtage est fréquent, réduisez Mod Depth ou Detector RC.
- **STEREO** suit le mélange stéréo décodé. Il s'illumine lorsque la réception stéréo s'ouvre et s'atténue quand le récepteur revient automatiquement vers le mono.

### Réglages recommandés

1. **Station locale puissante**
   - TX Bandwidth: 6.0 kHz, Mod Depth: 90 %, Signal: -10 dB, Skywave: 5 %, Fading Speed: 0.1 Hz, Static: 0.5/s
   - Interference: -80 dB, Tuning: 0 kHz, IF Bandwidth: 12 kHz, AGC Speed: Fast, Speaker: Table, Mix: 100 %

2. **Station lointaine de nuit**
   - TX Bandwidth: 4.5 kHz, Signal: -35 dB, Skywave: 75 %, Fading Speed: 0.3 Hz, Static: 6/s
   - Interference: -55 dB, Interf. Offset: 9 kHz, IF Bandwidth: 6 kHz, AGC Speed: Slow, Detector RC: 150 µs, Speaker: Small, Mix: 100 %

3. **Canal adjacent encombré**
   - Signal: -25 dB, Skywave: 40 %, Fading Speed: 0.5 Hz, Static: 3/s
   - Interference: -28 dB, Interf. Offset: 9 kHz, Tuning: +0.5 kHz, IF Bandwidth: 6 kHz, AGC Speed: Mid, Speaker: Small, Mix: 100 %

## Bit Crusher

Un effet qui recrée le son des appareils numériques vintage comme les anciennes consoles de jeux et les premiers échantillonneurs. Parfait pour ajouter du caractère rétro ou créer une atmosphère lo-fi.

### Guide du Caractère Sonore
- Style Rétro Gaming :
  - Crée des sons classiques de console 8-bit
  - Parfait pour la nostalgie des jeux vidéo
  - Ajoute une texture pixelisée au son
- Style Lo-Fi Hip Hop :
  - Crée ce son relaxant de study-beats
  - Dégradation numérique chaude et douce
  - Parfait pour l'écoute en arrière-plan
- Effets Créatifs :
  - Créez des sons uniques style glitch
  - Transformez la musique moderne en versions rétro
  - Ajoutez du caractère numérique à n'importe quelle musique

### Paramètres
- **Bit Depth** - Contrôle à quel point le son devient "numérique" (4 à 24 bits)
  - 4-6 bits : Son rétro gaming extrême
  - 8 bits : Numérique vintage classique
  - 12-16 bits : Caractère lo-fi subtil
  - Valeurs plus hautes : Effet très doux
- **TPDF Dither** - Rend l'effet plus doux
  - On : Son plus doux et musical
  - Off : Effet plus brut et agressif
- **ZOH Frequency** - Affecte la clarté globale (4000Hz à 96000Hz)
  - Valeurs plus basses : Plus rétro, moins clair
  - Valeurs plus hautes : Plus clair, effet plus subtil
- **Bit Error** - Ajoute du caractère matériel vintage (0.00% à 10.00%)
  - 0% : Aucun décalage de poids de bits de DAC ; Random Seed n'a pas d'effet audible
  - 0.1-1% : Coloration numérique DAC subtile
  - 1-3% : Imperfections matérielles classiques
  - 3-10% : Caractère lo-fi créatif
- **Random Seed** - Contrôle l'unicité des imperfections (0 à 1000)
  - Change le motif d'imperfection fixe utilisé par Bit Error
  - Audible seulement lorsque Bit Error est supérieur à 0%
  - La même valeur reproduit toujours le même motif d'imperfection

## Cassette Artifacts

Cassette Artifacts enregistre la musique sur une cassette compacte modélisée puis la relit. Le signal traverse l'encodeur Dolby, l'amplificateur d'enregistrement avec la remontée d'aigus et la remontée de grave bornée qu'il inscrit sur la bande, la saturation magnétique de la couche magnétique, l'effacement des aigus provoqué par la polarisation d'enregistrement, les pertes de longueur d'onde de la tête de lecture, les décrochages locaux de la couche magnétique, le wow et le flutter du défilement, la dérive de l'azimut de tête de la platine, la bosse de contour de la tête de lecture, puis la courbe de lecture qui retire de nouveau cette remontée d'aigus, avant que le souffle de bande et le bruit de modulation ne soient ajoutés et que le décodeur Dolby n'intervienne. Utilisez-le lorsque vous voulez une musique qui est réellement passée par une platine cassette, plutôt qu'une musique sur laquelle on a posé un bruit de cassette.

### Différences avec les autres effets lo-fi

- **Tape Artifacts** modélise une machine de studio à bobines, et l'écart entre les deux est l'écart entre les formats. À leurs valeurs par défaut, avec un petit signal et un hôte à 96 kHz, la cassette perd 2.0 dB à 8 kHz, 4.4 dB à 12 kHz et 7.9 dB à 16 kHz, là où la machine à bobines perd 0.7, 1.7 et 3.5 dB. Réduction de bruit coupée, le fond de la cassette est aussi le plus fort des deux - -65.5 dBFS contre -68.5 dBFS pour la machine à bobines - et avec Dolby B ou C il passe sous celui-ci, à -73.6 et -82.8 dBFS : exactement le rapport qu'ont les formats réels. La vitesse est un réglage là-bas et une valeur fixe de 4.76 cm/s ici, et Deck Grade, les colonnes Type I/II/IV, Dolby B/C, les décrochages, l'azimut de tête et l'erreur de niveau Dolby n'existent qu'ici.
- **Wow Flutter** (Modulation) ne reproduit que la variation de vitesse d'un défilement. Choisissez-le lorsque vous voulez l'instabilité sans la saturation de bande, sans le comportement des Type et de la polarisation, sans la réduction de bruit et sans le souffle.
- **Saturation** et **Hard Clipping** n'ajoutent que la non-linéarité, sans le comportement dépendant de la fréquence ni le défilement d'une machine à bande.
- **Vinyl Artifacts**, **Noise Blender** et **Hum Generator** ajoutent une couche de bruit par-dessus une musique inchangée. Ici le souffle, le bruit de modulation et les décrochages sont produits au bon endroit dans la platine, si bien que la réduction de bruit agit sur eux et qu'ils suivent Tape Type et Hiss comme le fait le bruit d'une vraie cassette.

### Guide du caractère sonore

- **Deck Grade fixe la classe de la machine :** il déplace ensemble les extrémités de la bande passante et la stabilité à court terme, et rien d'autre. Mesurés à la polarisation de référence, avec un petit signal et un hôte à 96 kHz, les points à -3 dB vont de 13.6 Hz à 18.0 kHz sur Reference, de 16.7 Hz à 14.0 kHz sur Hi-Fi, de 19.9 Hz à 10.0 kHz sur Consumer et de 26.1 Hz à 6.5 kHz sur Portable. À 16 kHz cela fait respectivement 2.4, 4.0, 7.8 et 16.7 dB de moins. L'oscillation d'azimut croît dans le même ordre - nulle sur Reference, la classe de platine qui embarque un asservissement d'azimut, et maximale sur Portable, où le haut du spectre respire visiblement.
- **Record Level est le point de fonctionnement, pas un gain :** il indique avec quelle force une crête à 0 dBFS attaque la bande, et le niveau de sortie ne bouge pas avec lui. Ce qui bouge, c'est tout le reste. À la valeur par défaut de +9.0 dB, une tonalité de 1 kHz à pleine échelle ressort arrondie de 3.6 dB avec environ 6 % de troisième harmonique, et sur un master moderne dense les 6 dB supérieurs du matériau ressortent sous forme d'environ 4.2 dB. À +0.0 dB le même matériau ressort presque sans compression (les 6 dB supérieurs restent 5.9 dB) et la bande n'est jamais mise à contribution ; à +15.0 dB ces 6 dB supérieurs se sont réduits à environ 1.9 dB. Le fond le suit décibel pour décibel dans l'autre sens : monter Record Level achète du rapport signal/bruit et dépense de la dynamique.
- **Le grave atteint le plafond en premier :** le côté enregistrement doit remonter tout ce qui se trouve sous 50 Hz pour l'inscrire sur la bande, et cette remontée a un plafond fixé par Deck Grade, si bien que le grave profond atteint la saturation avant le médium. Sur une platine Consumer à Record Level +12.0 dB, une tonalité à pleine échelle ressort 7.8 dB plus bas à 20 Hz et 5.4 dB plus bas à 40 Hz, contre 3.3 dB à 315 Hz. C'est cette même asymétrie qui explique que le grave décroisse tout court.
- **Tape Type n'est pas un interrupteur de volume :** un petit signal à 1 kHz ressort au même niveau sur les trois, à 0.01 dB près. Ce qui change, c'est la réserve et le bruit. Type IV offre le plus de réserve dans l'aigu - sa sortie de saturation à 10 kHz est 6.5 dB au-dessus de Type II et son niveau de sortie maximal à 315 Hz 1 dB au-dessus - et au Record Level par défaut elle conserve environ 4.9 dB de plus à 10 kHz que Type II sur une tonalité à -6 dBFS, et environ 7.5 dB de plus sur une tonalité à pleine échelle ; son propre plancher de bruit, en revanche, est 2.5 dB moins bon que celui de Type II. Type I est la plus bruyante des trois, 4 dB au-dessus de Type II, et colore les petits signaux exactement comme Type II, si bien que l'essentiel de ce qu'on en entend est le fond supplémentaire.
- **La réduction de bruit est un aller-retour apparié :** le même compandeur à bande glissante encode avant la bande et détend après elle, si bien que dans des conditions idéales la musique ressort telle quelle. Le gain de silence est la valeur effective mesurée et non les 10 et 20 dB nominaux : environ 8 dB pour Dolby B et environ 17 dB pour Dolby C, en pondération A et aux réglages par défaut. Le prix à payer est le décalage de suivi dans l'aigu à niveau élevé, où le décodeur lit des aigus déjà comprimés par la bande comme un signal plus faible et les baisse davantage ; les plateaux anti-saturation de Dolby C l'atténuent, et au Record Level par défaut C conserve environ 3.9 dB de plus que B sur une tonalité de 10 kHz à -6 dBFS, et environ 8.4 dB de plus sur une tonalité à pleine échelle.
- **L'octave supérieure est la limite de la platine :** à la polarisation de référence, avec un petit signal et un hôte à 96 kHz, la platine Consumer par défaut mesure +1.1 dB à 50 Hz (la bosse de contour de tête), 0.0 dB à 1 kHz, -0.8 dB à 5 kHz, -3.0 dB à 10 kHz et -7.8 dB à 16 kHz, et -2.9 dB à 20 Hz. Cette légère remontée du grave par-dessus un bas du spectre déjà déclinant, et cette chute du haut du spectre, sont la réponse propre de la platine, avant même de la pousser.
- **Le défilement est plus lent et plus ample que celui d'une machine à bobines :** un wow de cabestan à 6.9 Hz, une rotation de noyau à 0.42 Hz et un flutter large bande entre 1 et 40 Hz. À la valeur par défaut de 0.200 %, la hauteur bouge d'environ 9 cents crête à crête, juste au niveau des 5 à 10 cents à partir desquels la modulation de fréquence commence à s'entendre comme telle : l'instabilité est donc audible sur les notes tenues et masquée dans un programme dense ; 0.040 % est le chiffre que publie une platine de référence et ne déplace la hauteur que d'environ 2 cents, et le maximum de 1.000 % donne environ 46 cents, un fort chevrotement.
- **Un fond vivant :** le souffle dans les silences, plus un bruit de modulation qui voyage sur la musique elle-même, environ 48, 50 et 52 dB sous le signal sur Type I, Type II et Type IV. Descendez Hiss jusqu'à -92.0 dB re 250 nWb/m lorsque vous voulez un fond silencieux.
- **Les décrochages sont des pertes, pas des clics :** chaque événement est un creux doux en cosinus surélevé de 2.1 à 21 ms et de 3 à 30 dB plutôt qu'une porte, et le tirage de profondeur penche vers les pertes faibles, si bien que ce qu'on entend habituellement est la musique qui s'efface brièvement plutôt qu'un claquement. La valeur par défaut de 2.0 events/min correspond à environ un événement toutes les trente secondes sur une piste donnée.
- **Azimuth et Dolby Level Error sont les axes de compatibilité :** tous deux sont signés, et c'est leur signe qui compte. Azimuth assombrit le haut du spectre sur les deux canaux et introduit un retard entre eux, et c'est son signe qui décide quel canal est en avance. Un Dolby Level Error supérieur à zéro fait que le décodeur retire trop peu : le résultat est plus brillant et plus soufflant ; en dessous de zéro il retire trop et le résultat est plus terne.

### Paramètres

La vitesse est indiquée plutôt que choisie : la cassette compacte défile à 4.76 cm/s (1⅞ ips) par définition, ce n'est donc pas un réglage, et la ligne d'état en bas du panneau la nomme une seule fois, dans l'affichage de Wow/Flutter.

- **Deck Grade** (Reference, Hi-Fi, Consumer ou Portable) - Choisit la classe de la platine. Il ne gouverne que les mécanismes qui n'ont pas de réglage propre : le budget d'égalisation d'enregistrement qui compense la perte de longueur d'onde de la tête, la bande passante de l'amplificateur d'enregistrement, le plafond de la remontée de grave à l'enregistrement, l'amplitude de l'oscillation d'azimut et la forme de la bosse de contour de tête. Il ne touche jamais à Wow/Flutter, Hiss ni Dropouts : le changer ne peut donc jamais effacer vos propres réglages. Les extrémités de la bande passante, mesurées avec un petit signal sur un hôte à 96 kHz, vont de 13.6 Hz à 18.0 kHz (Reference), de 16.7 Hz à 14.0 kHz (Hi-Fi), de 19.9 Hz à 10.0 kHz (Consumer) et de 26.1 Hz à 6.5 kHz (Portable), et l'oscillation d'azimut vaut 0, 1, 2 et 4 arcmin d'écart type sur ces mêmes quatre classes. Reference n'oscille pas du tout, parce qu'une platine de cette classe embarque un asservissement d'azimut. La valeur par défaut, Consumer, est une machine domestique ordinaire.
- **Tape Type** (Type I, Type II ou Type IV) - Choisit la formulation de la bande : ferrique, haute polarisation et métal. C'est un profil de réserve et de bruit, pas un préréglage d'égalisation ni un réglage de niveau - un petit signal à 1 kHz ressort au même niveau sur les trois, à 0.01 dB près. Type II est la colonne de référence : Type I est 4.0 dB plus bruyante et Type IV 2.5 dB plus bruyante, tandis que Type IV offre 6.5 dB de réserve d'aigu et 1 dB de réserve de grave de plus que Type II. Chaque Type a aussi son propre point de polarisation recommandé, si bien que Bias 0 dB désigne une platine correctement réglée quelle que soit celle qui est choisie.
- **Noise Reduction** (Off, Dolby B ou Dolby C) - Choisit la réduction de bruit par compression-extension. C'est toujours un aller-retour encodage/décodage apparié - la même loi à bande glissante enregistre et relit -, si bien qu'elle rend la bande plus silencieuse sans changer la musique dans des conditions idéales. Dolby B est une seule bande glissante et Dolby C deux bandes décalées avec plateaux anti-saturation ; le gain de silence obtenu ici est mesuré et non nominal, environ 8 dB pour B et environ 17 dB pour C, et il dépend de Tape Type, Hiss, Dolby Level Error et de la fréquence d'échantillonnage de l'hôte, raison pour laquelle la ligne d'état indique la valeur correspondant aux réglages courants. Toutes deux décalent aussi le suivi sur les aigus forts comme le fait une vraie platine, et Dolby C décale moins que Dolby B.
- **Bias** (-6.0 à +6.0 dB) - Règle la polarisation d'enregistrement par rapport au point recommandé du Tape Type choisi. 0 dB est la platine correctement réglée : elle se situe 2.5 dB (Type I), 3.0 dB (Type II) ou 2.0 dB (Type IV) au-delà du sommet de la courbe de sensibilité à 10 kHz, c'est-à-dire là où l'on règle une platine. Les valeurs hautes (surpolarisation) sont plus propres dans le grave et le médium et plus ternes dans l'aigu : à +2.0 dB la sensibilité à 10 kHz chute de 1.67, 1.81 et 1.52 dB sur les trois Type, et à +6.0 dB de 5.31, 5.71 et 4.86 dB. Les valeurs basses (sous-polarisation) sont plus brillantes et plus distordues, comme sur une platine déréglée, mais seulement jusqu'à ce sommet - environ -3.6 dB sur Type I, -3.9 dB sur Type II et -3.2 dB sur Type IV, ce qui vaut environ +2.5, +3.0 et +2.0 dB à 10 kHz - et en dessous l'aigu s'assombrit de nouveau tandis que la distorsion continue de monter, si bien que -6.0 dB est déjà moins brillant que -4.0 dB. À 1 kHz toute la course bouge de moins de 0.2 dB : Bias n'est donc pas un réglage de volume.
- **Record Level** (-12.0 à +18.0 dB) - Règle la force avec laquelle la platine enregistre. Le chiffre est le niveau de bande qu'atteint une crête à 0 dBFS, en dB au-dessus du flux de référence de 250 nWb/m, et la ligne d'état rappelle cette convention. Le réglage n'applique aucun gain propre : tant que la bande ne sature pas, le même signal ressort au même niveau quelle que soit la position de Record Level, si bien que ce qu'il change est la bande, pas le volume. La valeur par défaut de +9.0 dB correspond à une cassette enregistrée normalement, où une tonalité de 1 kHz à pleine échelle ressort arrondie de 3.6 dB avec environ 6 % de troisième harmonique et où le grave profond touche déjà le plafond. Les valeurs plus basses tendent vers un report qui n'utilise jamais la bande - à +0.0 dB une tonalité à pleine échelle ne perd que 0.5 dB - et relèvent le fond d'un décibel par décibel, puisque le souffle est sur la bande et que la bande se trouve désormais plus loin sous la crête. Les valeurs plus hautes compriment davantage et rendent le fond plus silencieux selon la même règle ; au-delà d'environ +15.0 dB la dynamique cesse de s'élargir et seule la compression continue de croître.
- **Wow/Flutter** (0 à 1 %) - Règle la variation de vitesse du défilement, sous forme d'un écart pondéré crête DIN 45507 en pourcentage aux 4.76 cm/s fixes. 0 % est un défilement parfaitement stable. La valeur par défaut de 0.200 % se situe au milieu de la fenêtre de 0.15 à 0.25 % que publient les platines cassette ordinaires et déplace la hauteur d'environ 9 cents crête à crête, juste au niveau des 5 à 10 cents à partir desquels la modulation de fréquence commence à s'entendre comme telle. 0.040 % est la crête pondérée que publie une platine de référence et ne déplace la hauteur que d'environ 2 cents ; le maximum de 1.000 % donne environ 46 cents, un fort chevrotement. Le mouvement est plus lent ici que sur une machine à bobines, parce que la rotation de noyau à 0.42 Hz le domine.
- **Hiss** (-92.0 à -42.0 dB re 250 nWb/m) - Règle ensemble le niveau du souffle de bande et du bruit de modulation, exprimé comme le flux sans signal pondéré A de Type II avec réduction de bruit coupée, rapporté à la référence de 250 nWb/m. C'est le chiffre de la fiche technique de la bande elle-même et non un niveau en sortie : le bruit est enregistré sur la bande, si bien que ce qu'il mesure en sortie dépend de Record Level. -92.0 dB re 250 nWb/m coupe complètement les deux. La valeur par défaut de -60.5 dB re 250 nWb/m est le bruit de polarisation publié par le fabricant pour une bande Type II. Type I se situe 4.0 dB au-dessus de cette colonne et Type IV 2.5 dB au-dessus, Record Level déplace l'ensemble d'un décibel par décibel, puis le décodeur Dolby en retire sa propre quantité mesurée : ce que vous entendez dans les silences n'est donc pas ce chiffre - la ligne d'état indique ce qu'il devient. Tout cela est en amont d'Output, si bien qu'un indicateur placé après Output le lit relevé de la valeur d'Output. Pendant que la musique joue, ce que ce réglage ajoute surtout est le bruit de modulation qui voyage sur le signal.
- **Dropouts** (0 à 20 events/min) - Règle le taux moyen de décrochages de la couche magnétique, compté par piste : quelle que soit la piste que vous mesurez, elle voit ce nombre d'événements par minute. La moitié concerne toute la bande et affecte tous les canaux ensemble, l'autre moitié est locale à une seule piste. Chaque événement est un creux doux en cosinus surélevé de 2.1 à 21 ms et de 3 à 30 dB, et non une porte, si bien qu'il s'entend comme une brève perte de signal et non comme un clic. La valeur par défaut de 2.0 events/min correspond à une cassette en service ordinaire, soit environ un événement toutes les trente secondes sur une piste donnée ; 0 correspond à une bande sans défaut et n'ajoute strictement rien, et le maximum de 20 events/min vaut trois fois la limite de contrôle qualité publiée par une cassette haut de gamme, ce qui relève clairement de la bande dégradée.
- **Azimuth** (-6.0 à +6.0 arcmin) - Règle l'erreur d'alignement de tête entre la platine qui a enregistré la bande et celle qui la relit. Ce n'est pas un indice de qualité mais l'état d'alignement de cette paire de machines précise, raison pour laquelle il est signé et indépendant de Deck Grade. Toute erreur coûte de l'aigu sur les deux canaux : à la valeur par défaut de +2.0 arcmin une tonalité à 10 kHz perd 0.25 dB et une tonalité à 16 kHz 0.60 dB par rapport à une paire parfaitement alignée, et à ±6.0 arcmin cela devient 1.03 et 2.26 dB. Cela introduit aussi un retard de 11.0 µs entre les canaux à +2.0 arcmin, et c'est le signe qui décide quel canal est en avance, si bien qu'une somme mono d'un matériau corrélé perd encore 0.8 dB à 8 kHz, 1.8 dB à 12 kHz et 3.2 dB à 16 kHz ; un matériau non corrélé ne montre pas ce filtrage en peigne. Deck Grade ajoute une dérive lente par-dessus ce réglage : Azimuth est donc le centre autour duquel la dérive erre, et non une valeur figée.
- **Dolby Level Error** (-3.0 à +3.0 dB) - Règle l'écart entre la référence Dolby de la platine de lecture et celle de la platine d'enregistrement. Cela n'a de sens qu'avec Noise Reduction activée, et c'est son signe qui compte : au-dessus de zéro le décodeur lit la bande comme plus forte qu'elle ne l'est, retire trop peu, et le résultat est plus brillant et plus soufflant ; en dessous de zéro il retire trop et le résultat est plus terne. Sur la platine par défaut, une tonalité de niveau moyen bouge d'environ 2.4 dB vers le bas à 5 kHz et 1.0 dB vers le bas à 10 kHz à -3.0 dB, et d'environ 1.9 dB vers le haut à 5 kHz et 2.2 dB vers le haut à 10 kHz à +3.0 dB. 0.0 dB correspond à deux platines calibrées l'une sur l'autre. Le décalage de suivi sur les aigus forts est présent à tous les réglages, parce que la bande elle-même modifie le signal entre l'encodage et le décodage ; ce que ce réglage ouvre, c'est le côté brillant, qu'une paire appariée ne peut pas atteindre.
- **Output** (-24.0 à +24.0 dB) - Ajuste le niveau après toute la chaîne. Sert à égaliser le volume lors d'une comparaison avec le contournement, ou à rattraper le volume qu'un Record Level élevé a coûté.
- **Mix** (0 à 100 %) - Mélange le signal cassette avec l'original. 100 % correspond à la lecture cassette complète. Le signal sec est aligné en temps sur le trajet de bande, si bien que le médium se mélange proprement - 1 kHz reste à 0.06 dB de l'unité à 50 % - mais pas l'octave supérieure, parce que sec et bande n'y partagent plus la même phase et s'annulent en partie. Cette annulation n'est pas la même sur les deux canaux, car l'erreur d'azimut introduit un retard entre eux : à 50 %, aux réglages par défaut et sur un hôte à 96 kHz, le canal gauche ressort 1.7 dB plus bas à 8 kHz, 3.6 dB à 12 kHz, 5.3 dB à 16 kHz et 6.2 dB à 20 kHz, tandis que le canal droit est 4.4, 8.9, 9.0 et 7.0 dB plus bas aux mêmes fréquences. À 0 % l'entrée passe totalement inchangée et l'effet n'ajoute aucune latence ; à tout autre réglage il ajoute 165 échantillons (3.741 ms) sur un hôte à 44.1 kHz, 179 (3.729 ms) à 48 kHz, 347 (3.615 ms) à 96 kHz et 683 (3.557 ms) à 192 kHz.

### Lecture de la ligne d'état

La ligne sous les réglages rappelle la convention de Record Level et indique ce que deviennent les deux valeurs Base sur la platine telle qu'elle est configurée, sous la forme `Record Level +9.0 dB → tape peak +9.0 dB re 250 nWb/m at 0 dBFS in · Wow/Flutter Base 0.200% → 0.200% at 4.76 cm/s (1⅞ ips) · Hiss Base -60.5 dB re 250 nWb/m → -73.6 dBFS, Type I, Dolby B`.

- **Record Level** reformule le réglage en ce qu'il signifie sur la bande : le flux qu'atteint une crête à 0 dBFS. C'est un rappel de la convention et non un indicateur - il n'y en a pas -, et un master plus discret se pose d'autant plus bas sur la bande.
- **Wow/Flutter** indique la valeur Base et la valeur effective. La vitesse étant fixe, les deux sont toujours le même chiffre ; la ligne est là pour nommer la convention de mesure à laquelle appartient ce pourcentage, et c'est le seul endroit où la vitesse de défilement est indiquée.
- **Hiss** indique la valeur Base et le plancher sans signal pondéré A qu'elle devient en sortie, après la colonne Tape Type, Record Level et le décodeur Dolby, en amont d'Output. Avec Hiss à -92.0 dB re 250 nWb/m toute la famille de bruits est coupée et la ligne affiche `→ off`.
- Le plancher effectif est mesuré, et non déduit des 10 et 20 dB nominaux de Dolby B et C ; il dépend conjointement de Tape Type, de la réduction de bruit, de Hiss, de Dolby Level Error, de Record Level et de la fréquence d'échantillonnage de l'hôte. Avec Hiss à sa valeur par défaut de -60.5 dB re 250 nWb/m et Record Level à +9.0 dB, sur un hôte à 96 kHz, il vaut :

  | Tape Type | NR Off | Dolby B | Dolby C |
  |---|---|---|---|
  | Type I | -65.5 dBFS | -73.6 dBFS | -82.8 dBFS |
  | Type II | -69.5 dBFS | -77.7 dBFS | -87.0 dBFS |
  | Type IV | -67.0 dBFS | -75.2 dBFS | -84.4 dBFS |

  Record Level décale tout le tableau d'un décibel par décibel : à +12.0 dB chaque valeur est 3 dB plus basse, à +6.0 dB chaque valeur est 3 dB plus haute. La quantité que retire le décodeur Dolby ne change pas avec lui, parce que le plancher de la bande et la référence propre du décodeur se déplacent ensemble.
- Chaque combinaison est mesurée une fois puis mémorisée, si bien que le chiffre apparaît immédiatement pour tout réglage déjà visité. Pendant que vous faites glisser Hiss ou Dolby Level Error à travers des combinaisons qui n'ont pas encore été mesurées, la ligne affiche `measuring…` et complète le nombre dès que le réglage s'arrête - annoncer un chiffre d'apparence définitive faux de plusieurs décibels serait pire que de ne rien annoncer.

### Réglages recommandés

1. **Platine cassette ordinaire (par défaut)**
   - Deck Grade : Consumer, Tape Type : Type I, Noise Reduction : Dolby B, Bias : 0.0 dB, Record Level : +9.0 dB
   - Wow/Flutter : 0.200 %, Hiss : -60.5 dB re 250 nWb/m, Dropouts : 2.0 events/min, Azimuth : +2.0 arcmin, Dolby Level Error : 0.0 dB, Output : 0.0 dB, Mix : 100 %
   - Le son de cassette de tous les jours, et la valeur par défaut du plugin lui-même : le haut du spectre adouci de 7.9 dB à 16 kHz, une remontée de 1.1 dB autour de 50 Hz par-dessus un bas du spectre déjà 2.9 dB plus bas à 20 Hz, environ 6 % de troisième harmonique et 3.6 dB d'arrondi sur une tonalité à pleine échelle, un fond à -73.6 dBFS sur un hôte à 96 kHz, un mouvement de hauteur d'environ 9 cents, et un décrochage toutes les trente secondes environ sur chaque piste.

2. **Platine de référence, bande métal avec Dolby C**
   - Deck Grade : Reference, Tape Type : Type IV, Noise Reduction : Dolby C, Bias : 0.0 dB, Record Level : +9.0 dB
   - Wow/Flutter : 0.040 %, Hiss : -60.5 dB re 250 nWb/m, Dropouts : 0.0 events/min, Azimuth : 0.0 arcmin, Dolby Level Error : 0.0 dB, Output : 0.0 dB, Mix : 100 %
   - La combinaison la plus performante qu'offre le format : une platine Reference atteint -3 dB à 18.0 kHz et ne dérive pas du tout, Type IV apporte 6.5 dB de réserve d'aigu de plus que Type II, et le fond se situe à -84.4 dBFS sur un hôte à 96 kHz. Le plancher de bande propre à Type IV est 2.5 dB moins bon que celui de Type II - c'est Dolby C qui fait de ce réglage le plus silencieux d'ici, et c'est aussi celui qui décale le moins le suivi sur les aigus forts. Avec l'instabilité, le souffle, les décrochages et la dérive d'azimut tous coupés, cette platine est entièrement déterministe.

3. **Bande ferrique, sans réduction de bruit**
   - Deck Grade : Consumer, Tape Type : Type I, Noise Reduction : Off, Bias : 0.0 dB, Record Level : +9.0 dB
   - Wow/Flutter : 0.200 %, Hiss : -60.5 dB re 250 nWb/m, Dropouts : 2.0 events/min, Azimuth : +2.0 arcmin, Dolby Level Error : 0.0 dB, Output : 0.0 dB, Mix : 100 %
   - Une simple bande ferrique enregistrée sans réduction de bruit : le fond se situe à -65.5 dBFS sur un hôte à 96 kHz, 8.1 dB plus fort que par défaut, et rien ne le retire, si bien que le souffle fait partie du son dans chaque silence. Le timbre est exactement celui de la valeur par défaut pour les petits signaux - la différence entre les Type est le bruit et la réserve, pas la couleur - et rien ne décale le suivi, puisqu'il n'y a pas de décodeur pour le décaler.

4. **Platine domestique, légèrement surpolarisée**
   - Deck Grade : Consumer, Tape Type : Type I, Noise Reduction : Dolby B, Bias : +2.0 dB, Record Level : +12.0 dB
   - Wow/Flutter : 0.300 %, Hiss : -58.0 dB re 250 nWb/m, Dropouts : 4.0 events/min, Azimuth : +3.0 arcmin, Dolby Level Error : -1.0 dB, Output : +0.5 dB, Mix : 100 %
   - Une platine domestique ordinaire avec de la bande générique, et une bande enregistrée sur une autre platine : la polarisation un peu haute, si bien que le haut du spectre est environ 1.7 dB plus sombre à 10 kHz que sur une platine réglée et que le grave et le médium sont un peu plus propres, un défilement moins stable, un plancher de bande relevé, un décrochage toutes les quinze secondes environ par piste, une erreur d'azimut plus large, et un décodeur calibré 1 dB trop bas, ce qui l'assombrit davantage. Record Level est 3 dB au-dessus de la valeur par défaut, si bien que les 6 dB supérieurs d'un master dense ressortent sous forme d'environ 3.1 dB et qu'Output monte légèrement pour compenser la compression. La ligne d'état indique ce que devient le réglage de Hiss relevé après Type I, Dolby B et le Record Level.

5. **Portable, bande usée**
   - Deck Grade : Portable, Tape Type : Type I, Noise Reduction : Off, Bias : -2.0 dB, Record Level : +12.0 dB
   - Wow/Flutter : 0.480 %, Hiss : -54.0 dB re 250 nWb/m, Dropouts : 8.0 events/min, Azimuth : +4.0 arcmin, Dolby Level Error : 0.0 dB, Output : +1.0 dB, Mix : 100 %
   - Un effet lo-fi volontairement dégradé. Une platine Portable atteint -3 dB à 6.5 kHz et à 26 Hz et dérive deux fois plus que celle par défaut ; la polarisation est sous le point réglé, ce qui éclaircit 10 kHz d'environ 1.6 dB et ajoute de la distorsion au passage ; le défilement dépasse largement le point où l'instabilité devient évidente ; la bande est forte et bruyante ; l'azimut est franchement déréglé ; et les décrochages arrivent plusieurs fois par minute sur chaque piste. Record Level est assez élevé pour que le grave soit fermement dans le plafond, et Output rattrape le volume.

### Notes sur le modèle

L'effet modélise un passage d'enregistrement et de lecture sur une platine tournant aux 4.76 cm/s fixes de la cassette compacte. Le côté enregistrement remonte l'aigu avant la bande et le côté lecture retire exactement la même remontée, au lieu de suivre une norme de lecture publiée ; la moitié grave de la courbe n'est délibérément pas symétrique, parce que la remontée que le côté enregistrement d'une vraie platine applique sous 50 Hz a un plafond, et c'est ce plafond qui produit à la fois la décroissance du grave et le fait que le grave atteigne la saturation en premier. Deck Grade ne gouverne que les mécanismes qui n'ont pas de réglage propre : il ne change donc jamais Wow/Flutter, Hiss ni Dropouts. L'oscillation d'azimut est un processus borné ramené vers la valeur d'Azimuth plutôt qu'une marche aléatoire, et Reference n'en a aucune, parce qu'une platine de cette classe embarque un asservissement d'azimut ; avec Wow/Flutter à 0, Hiss coupé, Dropouts à 0 et Deck Grade sur Reference, plus rien d'aléatoire ne tourne. Dolby B et Dolby C sont modélisés comme des compandeurs à bande glissante appariés et fonctionnent toujours comme un aller-retour complet d'encodage et de décodage ; il n'y a pas de fonctionnement encodage seul ou décodage seul, et aucune prétention de conformité à une spécification de réduction de bruit ni de certification vis-à-vis d'une telle spécification. Dolby Level Error ne décale que la référence du décodeur, ce qui correspond à l'écart de calibrage entre deux platines et non à un second étage de traitement. Les bandes Type III, les formats microcassette et Elcaset, les autres vitesses de défilement, le contrôle de hauteur, l'autoreverse, la copie par contact, le bruit de collure, le ronflement moteur, le bruit de la coque et du mécanisme, et la diaphonie de la face opposée sont hors de ce modèle. Il n'existe pas de statistiques publiques de décrochages par bande : la plage de taux, les durées et les profondeurs des décrochages sont donc un modèle calibré contraint par une limite de contrôle qualité publiée, et non la transcription de données mesurées. Le trajet de bande porte 165 échantillons (3.741 ms) de retard de défilement et de traitement sur un hôte à 44.1 kHz, et descend à 683 échantillons (3.557 ms) sur un hôte à 192 kHz ; à Mix 0 % l'entrée passe au bit près, sans aucun retard. Les chiffres de timbre cités plus haut sont mesurés sur un hôte à 96 kHz et au Bias de référence de 0.0 dB. Cet effet coûte environ une fois et demie ce que coûte Tape Artifacts.

## Digital Error Emulator

Un effet qui simule le son d'erreurs de transmission audio numérique, depuis de faibles clics d'interface jusqu'aux imperfections de lecteurs CD vintage et aux pertes sans fil. Utilisez-le lorsque vous voulez un caractère numérique nostalgique ou une texture glitch évidente pendant l'écoute.

### Guide du Caractère Sonore
- Caractère Subtil de Lecture Numérique :
  - Simule les artefacts de transmission S/PDIF, AES3 et MADI
  - Ajoute de faibles imperfections numériques occasionnelles
  - Utile lorsque la lecture propre semble trop parfaite
- Décrochages Numériques Grand Public :
  - Recrée le comportement de correction d'erreur des lecteurs CD classiques
  - Simule les glitches d'interface audio USB
  - Idéal pour la nostalgie de la musique numérique des années 90/2000
- Artefacts de Streaming et Audio Sans Fil :
  - Simule les erreurs de transmission Bluetooth
  - Décrochages et artefacts de streaming réseau
  - Imperfections de la vie numérique moderne
- Textures Numériques Créatives :
  - Interférences RF et erreurs de transmission sans fil
  - Effets de corruption audio HDMI/DisplayPort
  - Possibilités sonores expérimentales uniques

### Paramètres
- **Bit Error Rate** - Contrôle la fréquence d'occurrence des erreurs (10^-12 à 10^-2)
  - Très Rare (10^-10 à 10^-8) : Artefacts subtils occasionnels
  - Occasionnel (10^-8 à 10^-6) : Comportement d'équipement grand public classique
  - Fréquent (10^-6 à 10^-4) : Caractère vintage notable
  - Extrême (10^-4 à 10^-2) : Effets expérimentaux créatifs
  - Défaut : 10^-6 (équipement grand public typique)
- **Mode** - Sélectionne le type de transmission numérique à simuler
  - AES3/S-PDIF : Erreurs de bits d'interface numérique avec maintien d'échantillon
  - ADAT/TDIF/MADI : Erreurs en rafale multicanal (maintien ou silence)
  - HDMI/DP : Corruption de ligne audio d'affichage ou mise en silence
  - USB/FireWire/Thunderbolt : Décrochages de micro-trame avec interpolation
  - Dante/AES67/AVB : Perte de paquets audio réseau (64/128/256 échantillons)
  - Bluetooth A2DP/LE : Erreurs de transmission sans fil avec dissimulation
  - WiSA : Erreurs de blocs FEC d'enceintes sans fil
  - RF Systems : Silencieux de fréquence radio et interférences
  - CD Audio : Simulation de correction d'erreur CIRC
  - Défaut : CD Audio — CIRC Error Correction (Interpolated)
- **Reference Fs (kHz)** - Définit la fréquence d'échantillonnage de référence utilisée uniquement par les modes de perte de paquets Dante / AES67 / AVB pour dimensionner les paquets de 64/128/256 échantillons
  - Taux disponibles : 44.1, 48, 88.2, 96, 176.4, 192 kHz
  - Les autres modes utilisent leur propre timing fixe ou la fréquence d'échantillonnage courante
  - Défaut : 48 kHz
- **Wet Mix** - Contrôle le mélange entre l'audio original et traité (0-100%)
  - Note : Pour une simulation réaliste d'erreur numérique, maintenir à 100%
  - Les valeurs plus basses créent des erreurs "partielles" irréalistes qui ne se produisent pas dans les vrais systèmes numériques
  - Défaut : 100% (comportement d'erreur numérique authentique)

### Détails des Modes

**Interfaces Professionnelles :**
- AES3/S-PDIF : Erreurs d'échantillon unique avec maintien de l'échantillon précédent
- ADAT/TDIF/MADI : Erreurs en rafale de 32 échantillons - maintien des derniers bons échantillons ou silence
- HDMI/DisplayPort : Corruption de ligne de 192 échantillons avec erreurs au niveau bit ou silence complet

**Audio Informatique :**
- USB/FireWire/Thunderbolt : Décrochages de micro-trame avec dissimulation par interpolation
- Audio Réseau (Dante/AES67/AVB) : Perte de paquets avec différentes options de taille et dissimulation

**Sans Fil Grand Public :**
- Bluetooth A2DP : Erreurs de transmission post-codec avec artefacts de tremblement et décroissance
- Bluetooth LE : Dissimulation améliorée avec filtrage haute fréquence et bruit
- WiSA : Silence de blocs FEC d'enceintes sans fil

**Systèmes Spécialisés :**
- RF Systems : Événements de silence de longueur variable simulant les interférences radio
- CD Audio : Simulation de correction d'erreur CIRC avec comportement style Reed-Solomon

### Réglages Recommandés pour Différents Styles

1. Caractère de Lecture Numérique Subtil
   - Mode : AES3 / S-PDIF (I²S) — Bit Error (Hold), BER : 10^-8, Fs : 48kHz, Wet : 100%
   - Parfait pour : Ajouter de faibles imperfections numériques occasionnelles

2. Expérience Lecteur CD Classique
   - Mode : CD Audio — CIRC Error Correction (Interpolated), BER : 10^-7, Fs : 44.1kHz, Wet : 100%
   - Parfait pour : Nostalgie de la musique numérique des années 90

3. Glitches de Streaming Moderne
   - Mode : Dante / AES67 / AVB — UDP Drop (128 samp), BER : 10^-6, Fs : 48kHz, Wet : 100%
   - Parfait pour : Imperfections de la vie numérique contemporaine

4. Expérience d'Écoute Bluetooth
   - Mode : Bluetooth A2DP — Digital Transmission, BER : 10^-6, Fs : 48kHz, Wet : 100%
   - Parfait pour : Souvenirs d'audio sans fil

5. Texture de Décrochage Sans Fil
   - Mode : WMAS / DECT / Axient — RF Squelch, BER : 10^-5, Fs : 48kHz, Wet : 100%
   - Parfait pour : Interruptions radio évidentes et texture glitch

Note : Toutes les recommandations utilisent 100% de Wet Mix pour un comportement d'erreur numérique réaliste. Les valeurs de mix humide plus basses peuvent être utilisées pour des effets créatifs, mais elles ne représentent pas comment les vraies erreurs numériques se produisent réellement.

## DSD64 IMD Simulator

Un effet qui recrée un effet secondaire subtil et souvent débattu de la lecture DSD64 : le bruit ultrasonique que le DSD transporte au-dessus de la plage audible peut, à travers les petites imperfections des DAC, amplificateurs et enceintes réels, engendrer de la distorsion d'intermodulation (IMD) — du grain et des tonalités supplémentaires qui retombent dans la plage que vous pouvez entendre. Cet effet reproduit ce résultat audible afin que vous puissiez l'entendre et l'ajuster. Il s'agit d'une simulation et il ne génère pas de véritable flux DSD.

**Cet effet nécessite une fréquence d'échantillonnage de 88.2 kHz ou plus** (88.2 / 96 / 176.4 / 192 kHz). À 44.1 / 48 kHz, il ne peut pas fonctionner et est contourné (le signal sec passe sans modification) avec un avertissement affiché. Réglez la fréquence d'échantillonnage sur 88.2 kHz ou plus dans les paramètres audio de l'application pour utiliser cet effet.

### Guide du Caractère Sonore
- « Grain numérique » très subtil : un léger bruit de fond sableux et constant, ainsi qu'une fine âpreté qui suit la musique.
- Outil de démonstration : rend audible et ajustable l'IMD ultrasonique du DSD64 habituellement inaudible.
- Texture créative : avec des valeurs plus élevées d'Amount et d'Analog Nonlinearity, il devient un effet lo-fi évident de grattement/arête.

### Paramètres

Paramètres principaux
- **Amount** (-40.0 à +50.0 dB) - Niveau global de la distorsion générée.
- **Dry-Wet** (100:0 à 0:100) - Équilibre entre le signal sec et la distorsion générée, exprimé sous forme de rapport sec:traité. 100:0 = signal sec uniquement ; 100:100 (centre) = signal sec complet plus distorsion complète ; 0:100 = distorsion uniquement.
- **Ultrasonic Level** (-48.0 à -18.0 dBFS RMS) - Niveau du bruit ultrasonique DSD simulé. Plus de bruit produit plus de distorsion.
- **Noise Color** (-100 à +100%) - Déplace le bruit ultrasonique vers le bas ou le haut du spectre et incline son équilibre.
- **Analog Nonlinearity** (0.00 à 10.00%) - Degré d'imperfection (de non-linéarité) de l'équipement analogique simulé. Des valeurs plus élevées produisent plus de distorsion.
- **Even Bias** (0 à 100%) - Équilibre la composition de la distorsion. Les valeurs basses privilégient la distorsion qui suit la musique (Attached) ; les valeurs élevées privilégient la distorsion constante, proche d'un bruit (Additive), ainsi que la composante Cross.
- **Signal Coupling** (0 à 200%) - Intensité de la distorsion dépendante de la musique (Attached et Cross). À 0, seul subsiste le bruit Additive constant.
- **IMD Path HPF** (0.0 à 8.0 kHz) - Limite la génération de distorsion aux fréquences au-dessus de ce point. 0.0 = Off (pleine bande, comme un amplificateur) ; autour de 2.5 kHz, émule un système où seul le tweeter produit la distorsion. Le signal sec n'est jamais affecté.
- **Scratch Tone** (3.0 à 14.0 kHz) - Fréquence centrale du caractère audible de « grattement ».

Paramètres avancés / utilitaires
- **Noise Texture** (0 à 100%) - Ajoute une ondulation résonante au bruit ultrasonique pour une texture légèrement différente.
- **Cross Sideband** (0 à 100%) - Quantité de distorsion créée par le mélange de la musique avec le bruit ultrasonique.
- **Output Trim** (-24.0 à +12.0 dB) - Ajustement final du niveau de sortie.

### Visualisations
- **Indicateurs Term Contribution** - Niveaux en temps réel de chaque composante de l'effet :
  - **Additive** - la distorsion constante issue du bruit seul, présente même en l'absence de signal d'entrée.
  - **Attached** - la distorsion qui s'attache à la musique et la suit.
  - **Cross** - la distorsion issue du mélange de la musique avec le bruit ultrasonique.
  - **Total IMD** - la distorsion combinée qui est générée.
  - **Output** - le niveau de sortie final (signal sec plus distorsion, après Dry-Wet et Output Trim).
- **Analog Transfer Curve** - Affiche la courbe de distorsion créée par Analog Nonlinearity et Even Bias, dans le même style entrée/sortie que les plugins Saturation.
- **Vue Difference-Frequency** - Un graphique statique montrant quelles fréquences audibles le bruit ultrasonique produit, en fonction des réglages de bruit actuels.

### Réglages Recommandés
- Subtil (par défaut) : Amount +24 dB, Ultrasonic Level -30 dBFS, Analog Nonlinearity 1.40%, Even Bias 20%, Signal Coupling 150%, Cross Sideband 75%, Scratch Tone 10.5 kHz.
- IMD du tweeter uniquement : IMD Path HPF 2.5 kHz, Signal Coupling 80–150%, Cross Sideband 50–100%, Scratch Tone 9–14 kHz.
- Effet marqué : augmentez Amount, Ultrasonic Level et Analog Nonlinearity.

## FM Radio Simulator

FM Radio Simulator fait passer la musique par une chaîne modélisée d'émission et de réception FM : traitement audio d'émission et préaccentuation, composition du multiplex stéréo (MPX) avec le pilote à 19 kHz, modulation FM d'une porteuse, propagation par trajets multiples et bruit d'antenne, accord du récepteur, filtrage FI, limitation dure, discrimination FM, décodage stéréo par PLL du pilote et désaccentuation. Comme le signal est réellement modulé puis démodulé en FM, les comportements caractéristiques de la réception FM émergent de la physique au lieu d'être synthétisés : le souffle brillant qui monte quand le signal faiblit, la pénalité de bruit du mode stéréo avec le fondu automatique vers le mono, les clics et crachotements sous le seuil FM, et la distorsion par trajets multiples.

Cet effet nécessite un environnement prenant en charge son traitement en temps réel. Lorsque ce traitement n'est pas disponible, l'audio reste inchangé et le HUD signale que l'effet est indisponible.

### Différences avec les effets lo-fi additifs

- **FM Radio Simulator** ne synthétise pas un bruit « façon radio » à superposer. Il module la musique sur une porteuse, dégrade cette porteuse et la démodule. Le souffle, les clics et la distorsion n'apparaissent que là où la physique du récepteur les crée, et ils réagissent à Signal, Tuning, au filtre FI et au décodeur stéréo en montrant les mêmes tendances physiques que la réception FM réelle.
- **Noise Blender** ajoute une texture de bruit de fond constante sans modifier la musique ; choisissez-le quand vous ne voulez qu'une ambiance. Il peut aussi être chaîné après cet effet pour représenter des parasites impulsionnels de type allumage moteur, que ce modèle n'inclut pas.
- **Digital Error Emulator** reproduit des erreurs de transmission numérique telles que coupures et artefacts de masquage — une famille de dégradations différente de la réception FM analogique.
- **AM Radio Simulator** est le modèle physique équivalent pour la radiodiffusion AM ; FM Radio Simulator reproduit le son FM large bande avec son multiplex stéréo, le verrouillage du pilote et le comportement de bruit propre à la FM.

### Guide du caractère sonore

- **Diffusion propre :** avec un signal fort, la chaîne apporte surtout le traitement d'émission lui-même — la limite de bande à 15 kHz et la densité du limiteur de la station réglée par Processing.
- **Souffle de signal faible :** quand Signal baisse, un souffle brillant et aérien monte d'abord en stéréo. Passer Stereo sur Mono rend la même réception nettement plus silencieuse, pour la même raison que le mono est plus silencieux sur un vrai tuner.
- **Réception en limite de zone :** près du seuil FM, clics et crachotements apparaissent, le récepteur fond vers le mono, et le programme finit par sombrer dans le bruit.
- **Couleur des trajets multiples :** les réflexions ajoutent une distorsion âpre et creuse dont le caractère suit Path Delay ; augmenter Fading la transforme en flottement typique de la réception mobile.

### Paramètres

- **Radio** (activé ou désactivé) - Active ou coupe l'émission de la station. Une fois coupée, la porteuse disparaît entièrement : le récepteur n'a plus que son propre plancher de bruit à limiter et produit le souffle à pleine échelle d'un canal vide. De quoi entendre l'instant où une station prend l'antenne ou la quitte. À ne pas confondre avec la désactivation de l'effet lui-même, qui laisse la musique passer telle quelle.
- **Emphasis** (50 ou 75 µs) - Sélectionne la paire de constantes de temps de préaccentuation/désaccentuation (50 µs : Japon/Europe, 75 µs : Amériques). Sur un signal propre, la paire s'annule presque ; le choix modifie subtilement le timbre du souffle et de la distorsion.
- **Processing** (0 à +18 dB) - Niveau d'attaque du limiteur d'émission — la « puissance sonore » de la station. 0 dB est presque transparent ; les valeurs élevées sonnent plus denses et plus fortes, comme les stations très traitées.
- **Signal** (0 à 70 dBµV) - Niveau de porteuse à l'entrée d'antenne. Le plancher de bruit est fixé par la physique (bruit thermique 75 Ω plus facteur de bruit du récepteur), ce réglage détermine donc le rapport porteuse/bruit et constitue l'axe principal de dégradation. Vers 50 dBµV et au-dessus, la réception est pratiquement propre ; vers 30, le souffle stéréo est clairement audible ; vers 15, le fondu Auto est passé en mono ; à 6 et en dessous, les clics se multiplient et le programme sombre dans le bruit.
- **Tuning** (-200 à +200 kHz) - Désaccorde le récepteur par rapport à la station. Les petits écarts passent presque inaperçus ; à partir d'environ ±40 kHz, le son devient de plus en plus distordu, asymétrique et faible à mesure que les bandes latérales sortent de la bande passante FI. À ±200 kHz, la station se trouve entièrement hors de la bande passante et seul le bruit du récepteur subsiste.
- **IF Band** (80 à 240 kHz) - Largeur du filtre FI du récepteur. Les réglages étroits représentent un récepteur conçu pour des bandes encombrées : ils tronquent les bandes latérales FM et augmentent la distorsion, surtout combinés au désaccord. Les réglages larges sont plus propres pour une station forte et bien accordée.
- **Multipath** (0 à 100%) - Quantité d'effet de deux réflexions retardées : à 100%, la première réflexion atteint la même amplitude que l'onde directe et la seconde 60% de la première. À mesure que les réflexions augmentent, les creux d'interférence s'approfondissent et transforment la FM en erreurs d'amplitude et de phase que le limiteur ne peut pas éliminer complètement — d'une coloration subtile aux réglages faibles jusqu'à la distorsion âpre et crépitante des trajets multiples sévères près de 100%.
- **Path Delay** (0.5 à 50 µs) - Retard de la première réflexion (la seconde est fixée à 2.7 fois). Les retards courts donnent une coloration large, un peu « phasing » ; les retards longs produisent une distorsion plus nette et localisée.
- **Fading** (0 à 20 Hz) - Vitesse de rotation des phases des réflexions. 0 Hz fige le motif de trajets multiples ; les valeurs élevées créent le flottement et l'effet « palissade » de la réception en voiture.
- **Stereo** (Auto / Stereo / Mono) - Auto fond continûment de la stéréo vers le mono à mesure que le verrouillage du pilote et la qualité du signal se dégradent, comme un récepteur réel. Stereo force le décodeur et expose toute la pénalité de bruit stéréo sur les signaux faibles. Mono abandonne le sous-canal L−R pour une réception nettement plus silencieuse en signal faible.
- **Output** (-24 à +24 dB) - Ajustement de niveau après démodulation.
- **Mix** (0 à 100%) - Mélange le signal démodulé avec un signal sec aligné en latence. 100% correspond à la réception radio complète ; les valeurs plus basses réintègrent l'original sans filtrage en peigne.

### Lecture du HUD

- Le graphique montre le **spectre MPX** observé à la sortie du démodulateur sur un axe de fréquence logarithmique, avec des repères à 15 kHz (fin de la région L+R), au pilote de 19 kHz et au sous-canal L−R autour de 38 kHz (bande de 23 à 53 kHz). Quand Signal baisse, le plancher de bruit monte d'autant plus que la fréquence est haute — le spectre de bruit triangulaire caractéristique de la FM — et engloutit d'abord la région L−R. C'est la raison visible pour laquelle la stéréo devient bruyante avant le mono.
- Le **vumètre de signal et l'affichage en dBµV** montrent le niveau de porteuse reçu, fixé par Signal et fluctuant avec l'interférence des trajets multiples.
- **CNR** est le rapport porteuse/bruit estimé. Les clics commencent à apparaître lorsqu'il approche le seuil FM, vers 12 dB.
- Le **témoin ST et son pourcentage** indiquent le fondu stéréo courant : 100% est la stéréo complète, 0% le mono. Avec Stereo sur Auto, le pourcentage baisse quand le signal se dégrade.
- **MPath** indique le niveau de la première réflexion par rapport à l'onde directe en dB (−∞ quand Multipath est à 0%).
- **Clicks** compte les clics de seuil FM récents par seconde et se met en évidence quand ils deviennent fréquents.
- Si le moteur **WASM** est indisponible, le HUD affiche une notification et le signal traverse sans modification.

### Réglages recommandés

1. **Station locale puissante**
   - Emphasis : 50 µs, Processing : 6 dB, Signal : 50 dBµV, Tuning : 0 kHz, IF Band : 230 kHz
   - Multipath : 0%, Fading : 0 Hz, Stereo : Auto, Mix : 100%
   - Stéréo propre avec seulement le caractère du traitement d'émission. Augmentez Processing pour comparer le son des stations.

2. **Réception de banlieue**
   - Signal : 30 dBµV, Tuning : 0 kHz, IF Band : 230 kHz, Multipath : 20%, Path Delay : 5 µs, Fading : 0.5 Hz
   - Stereo : Auto, Mix : 100%
   - Souffle stéréo clairement audible par-dessus la musique. Comparez avec Stereo : Mono pour entendre disparaître la pénalité de bruit stéréo.

3. **Réception en limite de couverture**
   - Signal : 15 dBµV, IF Band : 180 kHz, Multipath : 40%, Path Delay : 12 µs, Fading : 2 Hz
   - Stereo : Auto, Mix : 100%
   - Le fondu Auto est passé en mono et la réception flotte. Forcez Stereo pour entendre pourquoi les récepteurs fondent vers le mono.

4. **Signal à peine présent**
   - Signal : 6 dBµV, Tuning : +30 kHz, Multipath : 60%, Path Delay : 12 µs, Fading : 5 Hz
   - Stereo : Auto, Mix : 100%
   - Sous le seuil FM : clics crachotants, bruit intense et un programme qui émerge et disparaît dans les parasites.

### Notes sur le modèle

L'effet traite la première paire stéréo comme une seule chaîne d'émission ; une entrée mono est diffusée avec un canal L−R vide. Le RDS, les stations adjacentes et les sources d'interférence sont hors du périmètre de ce modèle. Pour un son multibande de « grosse station », placez un Multiband Compressor avant cet effet ; pour des parasites impulsionnels, chaînez Noise Blender ou Digital Error Emulator après.

## G.726 Simulator

G.726 Simulator fait passer le canal mono ou la paire stéréo sélectionnée par un véritable aller-retour d’encodage/décodage ITU-T G.726 à 8 kHz. Une paire stéréo est convertie en mono avant l’encodage, puis le signal décodé est envoyé aux deux canaux sélectionnés. Il permet d’entendre la bande passante, la quantification différentielle adaptative et les erreurs de prédiction de la téléphonie numérique. Avec Bit Error Rate à sa valeur par défaut, le trajet reste parfaitement propre ; en l’augmentant, on ajoute les erreurs binaires d’une liaison sans fil comme le DECT.

Les modes 16, 24, 32 et 40 kbit/s sont les quatre débits normalisés de G.726. Le réglage par défaut de 32 kbit/s correspond au mode vocal full-slot historiquement utilisé par le DECT. Les débits inférieurs consacrent moins de bits à chaque échantillon à 8 kHz et rendent plus audibles la quantification granulaire, la rugosité des sons tenus et la surcharge de pente. Le codec étant conçu pour la parole, la musique large bande en révèle nettement les limites.

Cet effet nécessite son moteur WebAssembly. Si le moteur, la fréquence d’échantillonnage ou le mode de canaux n’est pas disponible, l’entrée reste inchangée et le plugin affiche un message clair. Après une suspension, les rééchantillonneurs et l’état prédictif du codec redémarrent ensemble afin de ne pas rejouer l’audio mis en mémoire avant la suspension.

### Guide d’amélioration sonore

- **Voix téléphonique représentative :** commencez à 32 kbit/s, avec Output à 0 dB et Mix à 100 %. La voix met en évidence la bande étroite à 8 kHz et la texture ADPCM adaptative à un point de fonctionnement historiquement courant.
- **Comparer les artefacts selon le débit :** passez de 40 à 32, 24 puis 16 kbit/s sur le même extrait parlé. Aux faibles débits, écoutez le grain des voyelles, la rugosité des sons tenus et le rétablissement après un changement brusque de niveau.
- **Révéler le codec avec de la musique :** utilisez des percussions, des notes aiguës tenues ou un mixage dense à 16 ou 24 kbit/s pour mieux distinguer la limitation de bande et les erreurs de prédiction.
- **Ajouter des erreurs radio :** montez Bit Error Rate vers -4.5 à -2 pour entendre les mots de code se briser en crépitements et en passages rugueux. Laissez-le à -6 pour une comparaison propre entre encodage et décodage.
- **Mélanger l’effet :** baissez Mix pour conserver une partie du signal original. La voie sèche est alignée en latence sur la voie décodée.
- **Égaliser les niveaux :** utilisez Output uniquement pour compenser une différence de volume ; il ne modifie pas l’allocation des bits G.726.

### Paramètres

- **Bitrate** — Sélectionne 16, 24, 32 ou 40 kbit/s. Chaque échantillon à 8 kHz utilise respectivement 2, 3, 4 ou 5 bits ADPCM. Les faibles débits renforcent les artefacts de quantification et de prédiction.
- **Output** — Règle le niveau décodé de -24,0 à +12,0 dB sans modifier l’état ni le débit du codec.
- **Mix** — Mélange de 0 % à 100 % l’original aligné en latence avec le résultat décodé.
- **Bit Error Rate** — Règle le taux d’erreur binaire de la liaison sans fil sous forme de puissance de dix, de -6 à -2 (par défaut -6). À -6, le trajet est exempt d’erreurs. Les valeurs plus élevées inversent davantage de bits dans les mots de code ADPCM et produisent le crépitement d’une liaison DECT mal reçue.

## GSM-FR Simulator

Lorsque la sortie audio comporte un seul canal, GSM-FR Simulator traite directement ce canal. Avec deux canaux de sortie ou plus, il réunit en mono la paire stéréo sélectionnée. Il rééchantillonne ensuite le signal mono à 8 kHz et le fait passer par l’encodeur et le décodeur RPE-LTP normalisés de GSM-FR à 13 kbit/s. Le résultat décodé revient dans l’unique canal de sortie ou dans les deux canaux de la paire sélectionnée. L’effet permet d’examiner comment le codage vocal des premiers téléphones mobiles numériques transforme les voix, les percussions, les sons tenus et les musiques denses. Avec C/I à sa valeur par défaut, le trajet reste parfaitement propre ; en le baissant, on reproduit une mauvaise réception GSM.

Chaque trame de 20 ms est représentée par des paramètres quantifiés de prédiction linéaire, de prédiction à long terme et d’excitation par impulsions régulières. Transcodes répète l’étape complète d’encodage et de décodage avec des états indépendants : il reproduit donc un codage en tandem au lieu de servir de réglage générique de « qualité ». Les canaux supplémentaires situés après la paire stéréo sélectionnée restent inchangés.

Cet effet nécessite son moteur de traitement WebAssembly. Si ce moteur, la fréquence d’échantillonnage ou le mode de canaux sélectionnés ne sont pas disponibles, l’entrée reste inchangée et le plugin affiche un message d’état clair. À la reprise après une suspension, les rééchantillonneurs, les tampons de trames et l’état du codec redémarrent ensemble afin de ne pas rejouer l’audio mis en mémoire avant la suspension.

### Guide d’amélioration sonore

- **Voix typique des premiers mobiles :** Réglez Transcodes sur 1, Output sur 0 dB et Mix sur 100 %, puis comparez les voix, les cymbales et les percussions avec le bypass.
- **Écouter le codage en tandem :** Gardez le même passage et faites passer Transcodes de 1 à 2 puis à 3. Le gazouillis, l’instabilité et la perte de clarté augmentent parce que le signal est réellement réencodé et redécodé ; les défauts de réception radio sont distincts : à C/I 30 dB il n’y en a aucun, et abaisser C/I les reproduit.
- **Révéler le modèle vocal avec de la musique :** Utilisez Transcodes 3 sur une musique brillante ou dense pour mieux repérer la bande vocale à 8 kHz, le bourdonnement RPE-LTP et la modification des formants.
- **Mélanger le résultat :** Réduisez Mix pour rétablir une partie du signal stéréo d’origine. La voie directe est alignée sur la latence du codec.
- **Égaliser les niveaux avant comparaison :** Utilisez uniquement Output pour compenser les différences de volume perçues ou mesurées. Il ne modifie pas l’algorithme du codec.

### Paramètres

- **Transcodes** — Sélectionne 1, 2 ou 3 cycles complets d’encodage et de décodage GSM-FR. Chaque cycle possède un état indépendant et utilise le même codec à 13 kbit/s. Les valeurs élevées renforcent les artefacts du codage en tandem.
- **Output** — Règle le niveau de sortie décodé de -24,0 à +12,0 dB. Ce réglage sert à égaliser les niveaux ; il ne modifie ni l’état ni le débit du codec.
- **Mix** — Mélange de 0 à 100 % le signal d’origine, aligné en latence, et le résultat décodé. À 100 %, les deux canaux de la paire stéréo sélectionnée reçoivent le même signal mono décodé ; les valeurs inférieures rétablissent la différence stéréo d’origine.
- **C/I** — Règle le rapport porteuse/interférence de la liaison radio de 4 à 30 dB (par défaut 30). À 30 dB, la réception est pratiquement parfaite. Les valeurs plus faibles ajoutent des pertes de trames avec masquage de type GSM 06.11 (répétition atténuée de la trame précédente, coupure du son après plusieurs pertes consécutives) et une distorsion due aux erreurs binaires de classe 2, donnant les coupures hachées d’un téléphone en limite de couverture. Si Transcodes est supérieur à 1, la dégradation s’applique uniquement au dernier saut.

## Hum Generator

Ajoute une couche contrôlable de ronflement électrique 50/60 Hz pour une ambiance d'écoute vintage et lo-fi. Utilisez des niveaux bas lorsque la lecture propre semble trop stérile, ou montez Level pour un ronflement volontairement évident.

### Guide de Caractère Sonore
- Ambiance d'Équipement Vintage :
  - Recrée le ronflement subtil d'amplificateurs et équipements classiques
  - Ajoute le caractère d'être "branché" à l'alimentation AC
  - Crée une atmosphère de lecture vintage
- Caractéristiques d'Alimentation Électrique :
  - Simule différents types de bruit d'alimentation électrique
  - Recrée les caractéristiques régionales du réseau électrique (50Hz vs 60Hz)
  - Ajoute un caractère subtil d'infrastructure électrique
- Texture d'Arrière-plan :
  - Crée une présence organique de bas niveau en arrière-plan
  - Ajoute de la profondeur et de la "vie" aux lectures très propres
  - Utile pour une ambiance d'écoute vintage ou lo-fi

### Paramètres
- **Frequency** - Définit la fréquence fondamentale du ronflement (10-120 Hz)
  - 50 Hz : Standard du réseau électrique européen/asiatique
  - 60 Hz : Standard du réseau électrique nord-américain
  - Autres valeurs : Fréquences personnalisées pour effets créatifs
- **Type** - Contrôle la structure harmonique du ronflement
  - Standard : Contient uniquement des harmoniques impaires (plus pur, type transformateur)
  - Rich : Contient tous les harmoniques (complexe, type équipement)
  - Dirty : Harmoniques riches avec distorsion subtile (caractère d'équipement vintage)
- **Harmonics** - Contrôle la brillance et le contenu harmonique (0-100%)
  - 0-30% : Ronflement chaud et doux avec harmoniques supérieures minimales
  - 30-70% : Contenu harmonique équilibré typique d'équipements réels
  - 70-100% : Ronflement brillant et complexe avec harmoniques supérieures fortes
  - En mode Dirty, des valeurs plus élevées de Harmonics augmentent aussi la distorsion et la rugosité
- **Tone** - Fréquence de coupure du filtre de modelage tonal final (1.0-20.0 kHz)
  - 1-5 kHz : Caractère chaud et étouffé
  - 5-10 kHz : Ton naturel type équipement
  - 10-20 kHz : Caractère brillant et présent
- **Instability** - Quantité de variation subtile de fréquence et d'amplitude (0-10%)
  - 0% : Ronflement parfaitement stable (précision numérique)
  - 1-3% : Léger drift naturel
  - 3-10% : Fluctuation plus perceptible mais encore douce
- **Level** - Niveau de sortie du signal de ronflement (-80.0 à 0.0 dB)
  - -80 à -60 dB : Présence d'arrière-plan à peine audible
  - -60 à -40 dB : Ronflement subtil mais notable
  - -40 à -20 dB : Caractère vintage proéminent
  - -20 à 0 dB : Niveaux créatifs ou d'effets spéciaux

### Réglages Recommandés pour Différents Styles

1. Amplificateur Vintage Subtil
   - Frequency : 50/60 Hz, Type : Standard, Harmonics : 25%
   - Tone : 8.0 kHz, Instability : 1.5%, Level : -54 dB
   - Parfait pour : Ajouter un caractère doux de lecture vintage

2. Lecture Vintage Classique
   - Frequency : 60 Hz, Type : Rich, Harmonics : 45%
   - Tone : 6.0 kHz, Instability : 2.0%, Level : -48 dB
   - Parfait pour : Ambiance électrique d'arrière-plan d'un ancien équipement de lecture

3. Équipement Vintage à Tubes
   - Frequency : 50 Hz, Type : Dirty, Harmonics : 60%
   - Tone : 5.0 kHz, Instability : 3.5%, Level : -42 dB
   - Parfait pour : Caractère chaud d'amplificateur à tubes

4. Ambiance de Réseau Électrique
   - Frequency : 50/60 Hz, Type : Standard, Harmonics : 35%
   - Tone : 10.0 kHz, Instability : 1.0%, Level : -60 dB
   - Parfait pour : Arrière-plan réaliste d'alimentation électrique

5. Texture de Ronflement Plus Marquée
   - Frequency : 40 Hz, Type : Dirty, Harmonics : 80%
   - Tone : 15.0 kHz, Instability : 6.0%, Level : -36 dB
   - Parfait pour : Texture lo-fi plus évidente

## MP3 Codec Simulator

MP3 Codec Simulator fait passer les canaux sélectionnés par une analyse MPEG Layer III simplifiée en temps réel, une quantification spectrale à budget de bits limité, puis une synthèse. Il permet d’entendre comment un MP3 à faible débit modifie les transitoires, les détails aigus, les sons tenus et l’image stéréo. Il modélise uniquement un aller-retour propre du codec : il n’ajoute ni clics de fichier endommagé, ni coupures, ni perte de paquets, ni erreurs de transmission.

Le profil MPEG-1 à 44.1 kHz propose 32 à 320 kbit/s. Le profil MPEG-2 à 22.05 kHz propose 32 à 160 kbit/s et limite davantage la bande codée. Cet effet exige son moteur WebAssembly ; si le moteur, la fréquence d’échantillonnage ou le mode de canaux n’est pas disponible, le son reste inchangé.

### Guide d’amélioration sonore

- Pour entendre clairement le caractère MP3, commencez à 44.1 kHz, 48 ou 64 kbit/s, avec Joint Stereo, Bit Reservoir On et Mix à 100 %. Les percussions, cymbales, sons tenus et enregistrements stéréo larges révèlent bien les différences.
- Comparez 64 kbit/s à 128 ou 192 kbit/s pour mesurer le détail préservé par un budget supérieur. Essayez 22.05 kHz à 32 ou 48 kbit/s pour une limitation de bande plus marquée.
- Désactivez Bit Reservoir sur un morceau alternant passages calmes et denses. Chaque trame doit alors respecter seule son budget, ce qui peut rendre les transitoires complexes plus rugueux.

### Paramètres

- **Codec Rate** — Sélectionne `44.1 kHz (MPEG-1)` ou `22.05 kHz (MPEG-2)` et change le profil, la structure des trames et la bande codée.
- **Bitrate** — Règle le débit constant total du flux mono ou stéréo. MPEG-1 va jusqu’à 320 kbit/s et MPEG-2 jusqu’à 160 kbit/s ; les faibles valeurs accentuent les trous spectraux, la rugosité tonale et l’étalement des transitoires.
- **Stereo Mode** — `Joint Stereo` peut coder la première paire stéréo en Mid/Side lorsque c’est plus efficace ; `Stereo` conserve les spectres gauche et droit séparés.
- **Bit Reservoir** — Permet aux trames simples de réserver leur capacité inutilisée aux trames complexes suivantes.
- **Output** — Ajuste le niveau décodé de -24.0 à +12.0 dB.
- **Mix** — Mélange de 0 à 100 % le signal original aligné en latence avec le résultat décodé.

## Noise Blender

Un effet qui ajoute une texture atmosphérique en arrière-plan à votre musique, similaire au son des disques vinyles ou des équipements vintage. Parfait pour créer des atmosphères chaleureuses et nostalgiques.

### Guide du Caractère Sonore
- Son d'Équipement Vintage :
  - Recrée la chaleur des vieux équipements audio
  - Ajoute de la "vie" subtile aux enregistrements numériques
  - Crée une sensation vintage authentique
- Expérience Vinyle :
  - Ajoute cette atmosphère classique de platine vinyle
  - Crée une sensation chaleureuse et familière
  - Parfait pour l'écoute nocturne
- Texture Ambiante :
  - Ajoute une atmosphère en arrière-plan
  - Crée de la profondeur et de l'espace
  - Rend la musique numérique plus organique

### Paramètres
- **Noise Type** - Choisit le caractère de la texture d'arrière-plan
  - White : Texture plus brillante et présente
  - Pink : Son plus chaud et naturel
  - Brown : Texture plus profonde et plus douce avec davantage de poids dans le grave
- **Level** - Contrôle la perceptibilité de l'effet (-96dB à 0dB)
  - Très Subtil (-96dB à -72dB) : Juste un soupçon
  - Doux (-72dB à -48dB) : Texture perceptible
  - Fort (-48dB à -24dB) : Caractère vintage dominant
- **Per Channel** - Crée un effet plus spacieux
  - On : Son plus large et immersif
  - Off : Texture plus focalisée et centrée

## SBC Codec Simulator

SBC Codec Simulator fait passer les canaux sélectionnés par une analyse SBC en temps réel, une allocation des bits, une quantification et une synthèse. Il permet d'entendre comment le codec de base obligatoire de Bluetooth A2DP modifie les détails dans l'aigu, les textures tonales, les transitoires et l'image stéréo. Avec Packet Loss à sa valeur par défaut, l'aller-retour reste parfaitement propre ; en l'augmentant, on reproduit les coupures d'une liaison Bluetooth réelle.

Le codec fonctionne en interne à 44,1 kHz pour la famille des fréquences de 44,1 kHz et à 48 kHz pour celle de 48 kHz. La valeur Bitrate, en lecture seule, est calculée à partir de la longueur exacte de trame SBC correspondant aux réglages Bitpool, Channel Mode, Blocks et à la fréquence du codec.

Cet effet nécessite le moteur de traitement WebAssembly. Si le moteur, la fréquence d'échantillonnage ou le mode de canaux n'est pas disponible, le signal d'entrée reste inchangé et le plugin affiche un message d'état clair.

### Guide d'amélioration sonore

- **Comparaison SBC courante :** Commencez avec Bitpool 35, Joint Stereo, 16 Blocks et Mix à 100 %. Comparez au bypass avec des cymbales, des sons tenus, des percussions et des enregistrements stéréo larges.
- **Rendre les artefacts plus audibles :** Réduisez Bitpool vers 12–20. Les huit sous-bandes disposent de moins de bits de quantification, ce qui accentue les changements dans l'aigu et les résidus tonals.
- **Comparer l'allocation stéréo :** Alternez Joint Stereo et Stereo en observant Bitrate. Joint Stereo peut coder plus efficacement un contenu stéréo corrélé, tandis que Stereo conserve les sous-bandes gauche et droite séparées.
- **Reproduire le SBC XQ :** Choisissez Dual Channel et réglez Bitpool sur 38 pour la configuration couramment appelée « SBC XQ », ou sur 47 pour « SBC XQ+ ». Sur une source à 44,1 kHz, Bitrate affiche respectivement 452.0 et 551.3 kbit/s, ce qui correspond aux chiffres bien connus. À Bitpool 53, on atteint 617.4 kbit/s, le débit maximal que ce simulateur peut produire. Ces réglages sortent de la recommandation A2DP, mais ils correspondent à ce qu'émettent réellement les émetteurs SBC à haut débit, et c'est là que le codec devient le plus difficile à distinguer du bypass.
- **Comparer l'adaptation des trames :** Passez Blocks de 16 à 4. Les trames courtes actualisent plus souvent les facteurs d'échelle, mais consacrent une part plus grande aux données fixes et modifient le bitrate affiché.
- **Ajouter des coupures sans fil :** Montez Packet Loss vers 5–20 % pour entendre des trames disparaître par rafales, puis le masquage s'estomper. Laissez 0 % pour une comparaison propre.
- **Mélanger l'effet :** Réduisez Mix pour ajouter plus discrètement le caractère SBC. Le chemin d'origine est aligné sur la latence du chemin codé.

### Paramètres

- **Bitpool** — Règle de 2 à 53 le budget de bits de quantification de chaque trame SBC. `Joint Stereo` et `Stereo` le partagent entre les deux canaux, tandis que `Dual Channel` l'attribue intégralement à chaque canal. Une valeur basse laisse davantage de sous-bandes avec peu ou pas de bits et renforce les artefacts. Bitpool n'est pas une valeur directe en kbit/s.
- **Channel Mode** — `Joint Stereo` peut coder les sous-bandes corrélées en somme/différence lorsque cela réduit les facteurs d'échelle nécessaires. `Stereo` conserve les sous-bandes gauche et droite séparées. Ces deux modes partagent un Bitpool pour la première paire stéréo ; Joint Stereo ne convertit pas simplement le signal en mono. `Dual Channel` donne à chaque canal sa propre allocation indépendante au Bitpool complet : la trame et le débit doublent donc à peu près. C'est la configuration qui se cache derrière le « SBC XQ », et comme la gauche et la droite sont quantifiées indépendamment, l'image stéréo fluctue autrement qu'en Joint Stereo.
- **Blocks** — Sélectionne 4, 8, 12 ou 16 blocs d'échantillons de sous-bande par trame SBC. Moins de blocs raccourcissent la trame et augmentent la part des données fixes ; davantage de blocs espacera les mises à jour des facteurs d'échelle.
- **Bitrate** — Bitrate actuel en lecture seule, en kbit/s, calculé avec le nombre exact d'octets de trame et la fréquence du codec. Il se met à jour avec Bitpool, Channel Mode, Blocks, la famille de fréquence d'échantillonnage de l'hôte ou le routage de la sortie de l'hôte entre mono et stéréo.
- **Packet Loss** — Règle le taux de perte de paquets de la liaison Bluetooth de 0 % à 20 % (par défaut 0 %). À 0 %, aucune trame n'est perdue. Les valeurs plus élevées suppriment des trames SBC entières par rafales (modèle de Gilbert-Elliott), et le masquage intégré répète la trame précédente en l'atténuant avant de fondre vers le silence, comme sur une liaison sans fil réelle.
- **Output** — Règle le niveau décodé de -24,0 à +12,0 dB. Réduisez-le si le dépassement des filtres du codec produit des crêtes trop élevées.
- **Mix** — Mélange de 0 à 100 % le signal original aligné en latence et le résultat décodé.

## Simple Jitter

Un effet qui ajoute des variations de timing subtiles pour créer ce son numérique vintage imparfait. Il peut faire sonner la musique comme si elle était jouée à travers de vieux lecteurs CD ou des équipements numériques vintage.

### Guide du Caractère Sonore
- Sensation Vintage Subtile :
  - Ajoute une instabilité douce comme les vieux équipements
  - Crée un son plus organique, moins parfait
  - Parfait pour ajouter du caractère subtilement
- Son de Lecteur CD Classique :
  - Recrée le son des premiers lecteurs numériques
  - Ajoute du caractère numérique nostalgique
  - Idéal pour l'appréciation de la musique des années 90
- Effets Créatifs :
  - Créez des effets de wobble uniques
  - Transformez les sons modernes en sons vintage
  - Ajoutez du caractère expérimental

### Paramètres
- **RMS Jitter** - Contrôle la quantité de variation de timing (1ps à 10ms)
  - Subtil (1-10ps) : Caractère vintage doux
  - Moyen (10-100ps) : Sensation de lecteur CD classique
  - Fort (100ps-1ms) : Effets de wobble créatifs

### Réglages Recommandés pour Différents Styles

1. À Peine Perceptible
   - RMS Jitter : 1-5ps
   - Parfait pour : Rendre la lecture légèrement moins parfaitement numérique

2. Caractère de Lecteur CD Classique
   - RMS Jitter : 50-100ps
   - Parfait pour : Recréer le son des premiers équipements de lecture numérique

3. Machine DAT Vintage
   - RMS Jitter : 200-500ps
   - Parfait pour : Caractère d'équipement d'enregistrement numérique des années 90

4. Équipement Numérique Usé
   - RMS Jitter : 1-2ns (1000-2000ps)
   - Parfait pour : Créer le son d'équipements numériques vieillissants ou mal entretenus

5. Effet de Fluctuation Créatif
   - RMS Jitter : 10-100µs (0.01-0.1ms)
   - Parfait pour : Effets expérimentaux et modulation de hauteur notable

## SW Radio Simulator

SW Radio Simulator fait passer la musique dans une chaîne modélisée en ondes courtes : traitement d'émission et modulation AM ou à bande latérale unique, propagation ionosphérique avec évanouissement sélectif profond, parasites atmosphériques et station partageant le canal, récepteur de trafic à bande étroite avec détection d'enveloppe, synchrone ou par BFO et AGC, et haut-parleur de radio optionnel. Utilisez-le pour entendre la musique comme une émission internationale lointaine reçue sur un poste à ondes courtes : étroite et creuse, montant et descendant au gré de l'ionosphère, sifflant là où un autre émetteur est proche en fréquence. Réglez Mode sur USB ou LSB et la même chaîne devient un récepteur de trafic, où un cadran qui n'est pas exactement sur la fréquence décale tout le son et le rend nasillard et inharmonique.

Cet effet nécessite un environnement prenant en charge son traitement en temps réel. Lorsque ce traitement n'est pas disponible, l'audio reste inchangé et le HUD signale que l'effet est indisponible.

### Différences avec l'AM, la FM et les effets lo-fi additifs

- **AM Radio Simulator** modélise la réception en ondes moyennes, où une onde de sol stable domine généralement et où l'évanouissement reste secondaire. Sa bande passante est plus large et la stéréo C-QUAM est disponible.
- **SW Radio Simulator** modélise les ondes courtes, où le signal arrive par réflexion ionosphérique. L'évanouissement sélectif profond est au premier plan, la bande audio est plus étroite, et le sifflement hétérodyne d'une station sur le même canal fait partie du son. Il propose aussi la réception USB et LSB, qu'aucun autre effet présenté ici n'offre. L'émission en ondes courtes est monophonique : le signal traité est donc toujours mono.
- **FM Radio Simulator** reproduit la FM à bande large avec son multiplex stéréo, son souffle croissant et ses clics de seuil — une autre famille de dégradations.
- **Noise Blender** et **Hum Generator** ajoutent du bruit ou du ronflement sur une musique inchangée. Cet effet, lui, module, propage et détecte la musique : son bruit, ses interférences et sa distorsion réagissent donc à Tuning, au filtre FI et à l'AGC comme en réception réelle.

### Guide du caractère sonore

- **Étroit et creux :** la bande passante d'émission et la FI étroite du récepteur retirent l'essentiel de l'aigu et donnent le timbre restreint et boîteux d'un poste à ondes courtes.
- **Évanouissement lent et profond (QSB) :** le niveau reçu monte et descend en permanence. C'est le comportement caractéristique des ondes courtes, actif dès les réglages par défaut.
- **Distorsion aqueuse d'évanouissement :** dans un évanouissement profond, la porteuse et les bandes latérales chutent différemment, et le détecteur d'enveloppe ne reconstruit plus proprement l'audio. Au creux de chaque évanouissement, le son devient creux, instable et « sous-marin » au lieu de simplement baisser. Delay Spread en règle l'intensité, et la détection synchrone l'élimine en grande partie.
- **Flutter :** à Fading Speed élevée, les ondulations deviennent un scintillement rapide, comme une réception par un trajet perturbé ou polaire.
- **Sifflement hétérodyne (QRM) :** l'émetteur partageant le canal bat avec votre porteuse et produit une note continue dont la hauteur est égale à Interf. Offset.
- **Parasites atmosphériques (QRN) :** les éclairs lointains arrivent sous forme de craquements qui résonnent dans le filtre FI.
- **Pompage :** au passage des évanouissements, l'AGC poursuit le niveau et le bruit de fond respire entre les passages.
- **Étroitesse de la bande latérale unique (USB, LSB) :** l'audio restitué ne monte qu'à la moitié d'IF Bandwidth dans tous les modes — environ 3 kHz avec la valeur par défaut de 6 kHz — et, la porteuse étant supprimée et une seule bande latérale émise, l'autre moitié de la bande passante ne porte aucun signal et ne laisse passer que bruit et brouillage : c'est le son sec et restreint d'une liaison de trafic.
- **Désaccord « voix de canard » (USB, LSB) :** le BFO décale tous les composants du même nombre de hertz au lieu de les multiplier, si bien que les harmoniques ne sont plus des multiples entiers du fondamental. Les voix et les instruments deviennent nasillards et inharmoniques, et USB et LSB décalent en sens inverse.
- **AGC syllabique (USB, LSB) :** rien n'est émis entre les phrases, l'AGC suit donc le programme lui-même. Le fond remonte dans les silences et chaque nouvelle phrase démarre avec une attaque audible.
- **Instant fort après un silence :** quand la musique démarre — au début de la lecture ou après un blanc — le gain est encore grand ouvert depuis le silence, si bien que le premier instant passe fort avant que l'AGC ne se stabilise, surtout en USB et LSB. C'est ce que fait un récepteur allumé sur un canal calme, et c'est conservé volontairement.
- **Évanouissements maigres et troués (USB, LSB) :** un évanouissement profond atténue inégalement des parties de l'unique bande latérale au lieu de produire la distorsion aqueuse du détecteur d'enveloppe en AM : le son maigrit et des morceaux disparaissent.

### Paramètres

#### Station

- **Radio** (activé ou désactivé) - Active ou coupe l'émission de la station. Une fois coupée, la porteuse disparaît entièrement : il ne reste au récepteur que les parasites atmosphériques, la station partageant le canal et son propre bruit, et l'AGC s'ouvre en grand jusqu'à faire monter ce fond très fort. De quoi entendre l'instant où une station prend l'antenne ou la quitte. À ne pas confondre avec la désactivation de l'effet lui-même, qui laisse la musique passer telle quelle.
- **TX Bandwidth** (2.0 à 10.0 kHz) - Règle la bande passante audio de l'émetteur. Les canaux de radiodiffusion en ondes courtes sont espacés de 5 kHz : la valeur par défaut, étroite, sonne donc déjà plus sombre qu'une station en ondes moyennes ; augmentez-la pour un émetteur plus ouvert.
- **Pre-emphasis** (0 à 100 %) - Renforce les hautes fréquences avant l'émission. Un réglage élevé ajoute de la présence dans cette bande étroite, mais sollicite davantage le limiteur de diffusion sur les crêtes brillantes.
- **Mod Depth** (10 à 125 %) - Règle la profondeur de modulation AM. Au-dessus de 100 %, une surmodulation et un écrêtage des crêtes négatives apparaissent.
- **Compression** (0 à 20 dB) - Règle l'intensité du limiteur de diffusion. Un réglage élevé retient les crêtes et rend la modulation plus régulière : c'est ainsi que les radiodiffuseurs internationaux restent intelligibles à travers les évanouissements.

#### Propagation

- **Signal** (-50 à 0 dB) - Règle la puissance du signal reçu. Un réglage faible laisse entendre davantage de bruit du récepteur et demande plus de gain AGC.
- **Fading** (0 à 100 %) - Répartit la puissance reçue entre un trajet direct stable et deux trajets ionosphériques retardés. À 0 %, la réception à courte distance est stable ; la valeur par défaut donne l'évanouissement continu d'un signal lointain ; à 100 %, les évanouissements sont les plus profonds et la distorsion sélective la plus marquée.
- **Fading Speed** (0.1 à 10.0 Hz) - Règle la vitesse d'évolution des trajets ionosphériques. Les valeurs basses donnent de lentes ondulations ; à partir de quelques hertz, le mouvement devient un flutter rapide.
- **Delay Spread** (0.2 à 8.0 ms) - Règle l'écart de retard entre les deux trajets ionosphériques. Il détermine l'espacement des creux d'évanouissement dans la bande audio (environ 1 kHz d'écart à 1 ms, et d'autant plus serré que la valeur monte), ce qui fait qu'un évanouissement profond sonne aqueux au lieu de simplement s'atténuer. Les valeurs courtes font s'évanouir toute la bande ensemble ; les valeurs longues font s'évanouir chaque zone du spectre à un moment différent.
- **Static** (0 à 100/s) - Règle la fréquence des parasites de type éclair. Chaque événement est injecté avant le filtre FI et y résonne. À 0, ils sont désactivés.
- **Interference** (-80 à 0 dB) - Règle la puissance d'une station partageant le canal. À -80 dB, elle est pratiquement désactivée ; plus la valeur approche 0 dB, plus elle est forte.
- **Interf. Offset** (0.1 à 10 kHz) - Règle l'écart entre la porteuse brouilleuse et la vôtre. Les deux porteuses battent à cet écart et produisent le sifflement hétérodyne : ce réglage en fixe donc la hauteur. En dessous d'environ 3 kHz, c'est une note claire ; en montant, elle monte en hauteur jusqu'à ce que le filtre FI commence à l'atténuer. Le programme de la station brouilleuse est modélisé par un bruit mis en forme : il apporte une texture rugueuse et sifflante plutôt qu'une parole intelligible.

#### Tuning

- **Mode** (AM, USB ou LSB) - Sélectionne le mode d'émission et de réception de la station. AM est la diffusion à double bande latérale que suppose le reste de cette description. USB et LSB suppriment la porteuse et n'émettent qu'une seule bande latérale, comme le font les stations d'amateur et de service, et le récepteur restitue l'audio en s'appuyant sur son propre oscillateur de battement. Mode détermine aussi quels réglages s'appliquent : BFO Offset ne fonctionne qu'en USB et LSB, et Detector et Detector RC qu'en AM. Les réglages qui ne s'appliquent pas apparaissent désactivés et conservent leur valeur. USB et LSB sortent à un niveau très proche de celui d'AM aux mêmes réglages, et l'écart résiduel dépend du facteur de crête du programme et de la part de silences qu'il contient : un matériau dense se mesure environ un décibel au-dessus d'AM, tandis qu'un matériau de type voix comportant de nombreuses pauses monte à quelques décibels au-dessus, car l'AGC remonte le fond pendant les silences. C'est ce que fait un récepteur réel : l'AGC normalise le niveau à l'intérieur de la bande passante FI et, la porteuse étant supprimée, ce niveau est le programme lui-même au lieu d'une porteuse constante, si bien que le gain suit le programme et remonte à chaque silence.
- **Tuning** (-5.0 à +5.0 kHz) - Désaccorde le récepteur par rapport à la station : une valeur positive l'accorde au-dessus de celle-ci et une valeur négative, en dessous. Les faibles écarts ternissent le son, ajoutent une distorsion de filtrage asymétrique et modifient le volume du sifflement hétérodyne ; les écarts plus importants font sortir la station de l'étroite bande passante FI. Un accord vers le haut abaisse l'audio restitué en USB et le relève en LSB ; un accord vers le bas inverse ces directions.
- **BFO Offset** (-1000 à +1000 Hz) - Règle finement l'oscillateur de battement en USB et LSB ; sans effet en AM. Avec Tuning, il fixe le décalage de fréquence appliqué à tout ce que le récepteur restitue. Le décalage total du récepteur en hertz vaut Tuning × 1000 + BFO Offset : il se retranche de chaque composante en USB et s'ajoute à chacune en LSB. Zéro correspond au réglage exact sur la fréquence, quelques dizaines de hertz rendent déjà le son nasillard, et des valeurs plus grandes le rendent inintelligible comme le ferait un récepteur mal accordé.
- **IF Bandwidth** (2.0 à 10.0 kHz) - Règle la bande passante FI du récepteur. Les réglages étroits correspondent à la réponse d'un récepteur de trafic : ils rejettent davantage de bruit et de station brouilleuse, mais retirent plus d'aigu ; les réglages larges conservent plus de détails et plus d'interférences. L'audio restitué ne monte qu'à la moitié de ce réglage dans tous les modes, soit environ 3 kHz avec la valeur par défaut de 6 kHz ; en USB et LSB, une seule bande latérale est présente, si bien que l'autre moitié de la bande passante ne laisse passer que bruit et brouillage. Mode ne modifie pas ce réglage à votre place ; baissez-le vous-même pour un son de trafic plus étroit.

#### Receiver

- **Detector** (Envelope ou Synchronous) - Envelope est le détecteur à diode classique : c'est lui qui transforme un évanouissement sélectif profond en distorsion aqueuse. Synchronous récupère la porteuse avec une PLL et démodule par rapport à elle, ce qui réduit fortement cette distorsion pendant les évanouissements profonds. Il accroche sur environ ±1 kHz de Tuning et décroche au-delà : utilisez Envelope pendant que vous tournez le cadran. Changer de détecteur relance l'acquisition de la porteuse. Ce réglage ne s'applique qu'en AM, car USB et LSB utilisent toujours le détecteur de produit à BFO.
- **AGC Speed** (Slow, Mid ou Fast) - Règle la vitesse à laquelle le contrôle automatique de gain suit les évanouissements. Slow laisse les variations de niveau audibles et pompe à la remontée du signal ; Fast tient le niveau plus serré. En AM, il règle à la fois la vitesse à laquelle le gain redescend sur une montée et celle à laquelle il remonte. En USB et LSB, il ne règle que la remontée : le gain redescend toujours en quelques millisecondes, comme dans un vrai récepteur à bande latérale unique, si bien que chaque nouvelle phrase est rattrapée aussitôt au lieu de passer en force.
- **Detector RC** (20 à 500 µs) - Règle le temps de décharge du détecteur d'enveloppe. Les valeurs longues lissent davantage l'enveloppe mais augmentent la distorsion d'écrêtage diagonal dans l'aigu à forte modulation. Sans effet lorsque Detector est sur Synchronous, ainsi qu'en USB et LSB.
- **Hum** (-80 à -20 dB) - Règle le ronflement d'alimentation. À -80 dB, il est pratiquement désactivé. Contrairement à une couche de ronflement ajoutée, l'essentiel de ce réglage module le gain du récepteur avant la détection.
- **Hum Freq** (50 ou 60 Hz) - Sélectionne la fréquence secteur simulée.

#### Output

- **Speaker** (Off, Small ou Table) - Sélectionne une sortie ligne, le haut-parleur limité d'un poste portatif à ondes courtes ou la réponse plus ample d'un récepteur de trafic de table.
- **Output Gain** (-24 à +24 dB) - Règle le niveau après le traitement du récepteur et du haut-parleur.
- **Mix** (0 à 100 %) - Mélange le signal stéréo d'origine avec la réception mono simulée. À 100 %, c'est la réception en ondes courtes complète, identique à gauche et à droite. Mix ne retarde pas le signal sec pour l'aligner : les réglages intermédiaires combinent donc les deux avec le décalage temporel du récepteur et de la propagation.

### Lecture du HUD

- **S METER** indique, sur une échelle de S1 à S9, la puissance totale du signal que le récepteur reçoit dans sa bande avant l'AGC, quel que soit le mode. Comme le S-mètre d'un poste réel, il additionne tout ce qui se trouve dans la bande passante : la station co-canal, le bruit et les parasites font donc monter l'indication en même temps que la station voulue. En AM, ce total est dominé par la porteuse et reste donc stable ; en USB et LSB, la porteuse est supprimée : l'indication suit le programme et retombe vers le bruit entre les phrases.
- **FADE** indique en dB la variation actuelle du gain de propagation, et il oscille aussi bien au-dessous qu'au-dessus de 0 dB selon que le trajet direct et les deux trajets ionosphériques s'annulent ou se renforcent. En ondes courtes, c'est l'affichage à surveiller : il bouge en permanence aux réglages par défaut, et c'est dans les creux les plus profonds que le son devient aqueux et distordu. Il s'agit toujours du gain du trajet à la fréquence de la porteuse : en USB et LSB, il rend donc compte de ce gain pour la porteuse supprimée, et non de l'atténuation de la bande latérale dans son ensemble ni du niveau du programme.
- **AGC GAIN** indique le gain actuellement appliqué par le récepteur. Il augmente lorsque Signal baisse ou qu'un évanouissement s'accentue. Il est plafonné à +42 dB : les évanouissements les plus profonds restent donc moins forts au lieu d'être entièrement compensés.
- **MOD / EVENTS**, intitulé **TX / EVENTS** en USB et LSB, indique le taux de modulation effectif — le niveau d'attaque de la bande latérale en USB et LSB — puis les fréquences récentes par seconde des parasites (⚡) et de l'écrêtage (▲), et clignote au passage de ces événements. Si vous recherchez un résultat plus propre et que l'écrêtage est fréquent, réduisez Mod Depth ou Detector RC. Le compteur d'écrêtage relève la surmodulation AM et l'écrêtage du détecteur d'enveloppe : il reste donc au repos en USB et LSB.
- Si le moteur **WASM** n'est pas disponible, le HUD l'indique et le plugin laisse passer l'audio inchangé.

### Réglages recommandés

1. **Émission internationale lointaine**
   - TX Bandwidth : 4.5 kHz, Mod Depth : 90 %, Signal : -15 dB, Fading : 55 %, Fading Speed : 0.5 Hz, Delay Spread : 1.4 ms, Static : 2/s
   - Interference : -47 dB, Interf. Offset : 1.0 kHz, Tuning : 0 kHz, IF Bandwidth : 6.0 kHz, Detector : Envelope, AGC Speed : Fast, Hum : -80 dB, Speaker : Small, Mix : 100 %
   - Le son quotidien des ondes courtes : étroit, en évanouissement continu, avec quelques craquements et un sifflement discret.

2. **Évanouissement nocturne profond**
   - Signal : -30 dB, Fading : 100 %, Fading Speed : 0.3 Hz, Delay Spread : 5.0 ms, Static : 10/s
   - IF Bandwidth : 4.0 kHz, Detector : Envelope, AGC Speed : Slow, Detector RC : 150 µs, Speaker : Small, Mix : 100 %
   - De longues ondulations profondes, une distorsion aqueuse au creux de chaque évanouissement et un pompage d'AGC nettement audible à la remontée.

3. **Bande encombrée**
   - Signal : -20 dB, Fading : 60 %, Fading Speed : 0.5 Hz, Static : 8/s, Interference : -18 dB, Interf. Offset : 0.8 kHz
   - Tuning : +0.3 kHz, IF Bandwidth : 4.0 kHz, AGC Speed : Mid, Speaker : Small, Mix : 100 %
   - Un sifflement hétérodyne continu par-dessus le programme. Changez Interf. Offset pour en déplacer la hauteur et Tuning pour en modifier le volume.

4. **Détection synchrone**
   - Partez d'Évanouissement nocturne profond et réglez Detector : Synchronous
   - Les évanouissements profonds subsistent, mais la distorsion à leur creux est bien plus faible et le programme reste intelligible. Gardez Tuning dans une plage d'environ ±1 kHz pour que le détecteur reste accroché, et comparez avec Envelope pour entendre son action.

5. **Flutter polaire**
   - Signal : -25 dB, Fading : 90 %, Fading Speed : 6 Hz, Delay Spread : 3.0 ms, Static : 5/s
   - IF Bandwidth : 5.0 kHz, Detector : Envelope, AGC Speed : Fast, Speaker : Small, Mix : 100 %
   - Le scintillement rapide d'un trajet perturbé ou polaire, au lieu d'une lente ondulation.

6. **Station en bande latérale unique**
   - Mode : USB, Tuning : 0 kHz, BFO Offset : 0 Hz, TX Bandwidth : 3.0 kHz, IF Bandwidth : 6.0 kHz
   - Signal : -20 dB, Fading : 55 %, Fading Speed : 0.5 Hz, Static : 2/s, AGC Speed : Fast, Speaker : Small, Output Gain : 0 dB, Mix : 100 %
   - Un son de trafic étroit et sec, accordé pile sur la fréquence, avec l'AGC qui respire entre les phrases. Le niveau est déjà proche de celui d'une station AM, aucun ajustement supplémentaire n'est nécessaire.

7. **Voix de canard hors fréquence**
   - Partez de Station en bande latérale unique et réglez BFO Offset : -150 Hz
   - Tous les composants montent de 150 Hz : les harmoniques ne s'alignent plus et les voix comme les instruments deviennent nasillards et inharmoniques. Passez Mode sur LSB au même réglage pour que tout descende de 150 Hz à la place, et servez-vous de Tuning pour des écarts plus grossiers.

### Notes sur le modèle

L'effet traite la première paire stéréo comme une seule émission mono, comme le font les ondes courtes réelles, et le signal reçu est toujours mono. Une seule station partageant le canal est modélisée, et son programme est un bruit mis en forme, non de la parole ou de la musique. USB et LSB modélisent la réception d'un signal à bande latérale unique et porteuse supprimée ; la bande latérale est choisie à l'émission, le récepteur n'ajoute donc pas sa propre réjection de la bande latérale opposée, et les modes CW et données ne sont pas modélisés. Les conditions réelles de bande — variations de propagation jour/nuit et bandes de radiodiffusion précises — sortent de ce modèle ; réglez les conditions souhaitées avec Signal, Fading et les autres commandes de propagation.

## Tape Artifacts

Tape Artifacts enregistre la musique sur un magnétophone à bobines analogique modélisé, puis la relit. Le signal traverse l'amplificateur d'enregistrement et le relèvement des aigus qu'il inscrit sur la bande, la saturation magnétique de la bande elle-même, l'effacement des aigus dû à la polarisation d'enregistrement, les pertes de longueur d'onde de la tête de lecture, le pleurage et le scintillement du défilement, la bosse de grave de la tête, puis la courbe de lecture qui retire exactement ce même relèvement, avant l'ajout du souffle de bande et du bruit de modulation. Utilisez-le lorsque vous voulez que la musique sonne comme si elle était passée par un magnétophone, plutôt que de simplement lui superposer du bruit ou de l'instabilité.

### Différences avec les autres effets lo-fi

- **Tape Artifacts** transforme la musique elle-même. La compression douce, la chaleur ajoutée, les aigus adoucis et l'instabilité de hauteur proviennent tous de la même chaîne d'enregistrement et de lecture : ils réagissent donc ensemble à Speed, Tape, Bias et Record Level.
- **Wow Flutter** (Modulation) ne reproduit que les variations de vitesse d'un défilement. Choisissez-le si vous voulez l'instabilité sans la saturation, la correction ni le souffle de la bande.
- **Saturation** et **Hard Clipping** ajoutent uniquement de la non-linéarité, sans le comportement dépendant de la fréquence ni le défilement d'un magnétophone.
- **Noise Blender** et **Hum Generator** ajoutent une couche de bruit ou de ronflement par-dessus une musique inchangée. Ici, le souffle et le bruit de modulation naissent au bon endroit de la machine et suivent donc Speed et Tape comme le fait le bruit d'une vraie bande.

### Guide du caractère sonore

- **Speed détermine la tonalité de base :** 30 ips est le plus ouvert, 15 ips donne le son de studio familier, et 7.5 ips est nettement plus sombre, avec une remontée de grave plus marquée. Le bruit ne suit pas simplement la vitesse : sans signal, le plancher de souffle est le plus élevé à 15 ips et le plus bas à 30 ips, tandis que le bruit de modulation qui accompagne la musique est le plus fort à 7.5 ips.
- **Compression douce du niveau :** plus vous montez Record Level, plus la bande arrondit les crêtes avant de distordre de façon audible ; les passages forts deviennent donc plus denses et plus stables au lieu d'être manifestement écrêtés. À la valeur par défaut de +6.0 dB et avec le Bias de référence de 0.0 dB, une tonalité de 1 kHz à pleine échelle ressort arrondie de 0.17 dB avec 0.49 % de distorsion - une machine à son niveau de travail normal, pas une chaîne numérique propre. La quantité croît régulièrement à partir de là : 0.68 dB et 2.0 % à +12.0 dB, 2.49 dB et 6.8 % au maximum de +18.0 dB. Tout écart de niveau plus important observé au réglage par défaut vient du changement de timbre et non de la compression, et celui-là joue dans les deux sens selon le programme : une musique très riche en grave peut ressortir environ 1 dB plus fort, un programme très riche en aigu environ 1 dB plus faible.
- **Chaleur :** la saturation est asymétrique et produit donc des harmoniques paires et impaires ; la chaleur s'installe progressivement à mesure que Record Level monte, au lieu d'apparaître d'un coup.
- **Le défilement s'entend sur les notes tenues :** le pleurage lent et le scintillement plus rapide font très légèrement dériver les notes tenues de piano, d'orgue et de cordes (0.160 %, l'écart qu'indique le réglage, avec Wow/Flutter et Speed par défaut). C'est ce qui distingue le plus nettement la bande d'un fichier numérique.
- **Un fond vivant :** aux réglages normaux, le souffle et le bruit de modulation qui accompagne la musique font partie du son. Le souffle est sur la bande : Record Level déplace donc décibel pour décibel ce qu'il mesure en sortie. Baissez Hiss jusqu'à -89.0 dB re 320 nWb/m si vous voulez un fond silencieux.

### Paramètres

- **Speed** (7.5, 15 ou 30 ips) - Choisit la vitesse de défilement. Les vitesses élevées étendent les aigus et déplacent la bosse de grave vers le haut en la réduisant : +1.4 dB à 41 Hz à 7.5 ips, +0.8 dB à 80 Hz à 15 ips et +0.4 dB à 159 Hz à 30 ips. Elles rendent aussi le pleurage et le scintillement plus rapides et moins profonds : Wow/Flutter indique l'écart pondéré à 15 ips et la vitesse le multiplie par 1.5 à 7.5 ips et par 0.75 à 30 ips, si bien que les 0.04 % que la machine de référence publie à 15 ips donnent les 0.06 % et 0.03 % qu'elle publie pour les deux autres. Le bruit ne varie pas dans un seul sens avec la vitesse : le plancher de souffle est le plus élevé à 15 ips et le plus bas à 30 ips, tandis que le bruit de modulation qui accompagne la musique est le plus fort à 7.5 ips. 15 ips est le réglage de studio habituel, 7.5 ips le plus sombre, et 30 ips le plus proche de l'original. Wow/Flutter et Hiss sont donnés tous deux aux 15 ips de référence, et la dernière ligne de l'effet affiche la valeur effective de chacun pour les Speed, Tape et Record Level choisis, à côté de la convention de Record Level elle-même.
- **Tape** (Standard ou Master) - Choisit la formulation de la bande. Master a une couche plus épaisse et environ 3 dB de marge supplémentaire avant saturation : elle reste propre plus longtemps et son extrême aigu est un peu plus doux. Aux valeurs basses de Record Level, les deux bandes sont proches en niveau (0.08 dB d'écart au réglage par défaut), mais plus vous montez Record Level, plus Master reste forte : 0.34 dB à +12.0 dB et 1.16 dB à +18.0 dB, justement parce qu'elle sature plus tard ; rétablissez l'égalité de volume avec Output quand vous les comparez.
- **Bias** (-6.0 à +6.0 dB) - Règle la polarisation d'enregistrement. 0 dB correspond à une machine correctement alignée, et c'est le point auquel aboutit la procédure de réglage du fabricant : enregistrer un 10 kHz 20 dB sous le niveau de travail, chercher le maximum de la courbe de sensibilité, puis augmenter la polarisation jusqu'à ce que la lecture ait baissé de la valeur publiée, soit, sur la bande Standard, 1.5 dB à 30 ips, 4.0 dB à 15 ips et 5.0 dB à 7.5 ips. La bande Master ne s'en écarte qu'à 7.5 ips, où la chute est de 6.5 dB. Les valeurs élevées (surpolarisation) sont plus propres et plus sombres. Les valeurs basses (sous-polarisation) sont plus brillantes et plus distordues, comme sur une platine mal réglée, mais seulement jusqu'à ce maximum, situé sur la bande Standard vers -2.7 dB à 30 ips, -4.5 dB à 15 ips et -5.0 dB à 7.5 ips, et sur Master à 7.5 ips vers -5.7 dB. En dessous, l'aigu s'assombrit de nouveau tandis que la distorsion continue d'augmenter. Le gain de brillance dépend autant de la fréquence que de la vitesse : à 30 ips le maximum vaut 1.5 dB à 10 kHz mais 2.9 dB à 16 kHz, et à -6.0 dB l'extrême aigu est déjà plus sombre qu'à 0 dB, de 0.2 dB à 10 kHz et de 0.5 dB à 16 kHz.
- **Record Level** (-12.0 à +18.0 dB) - Règle la force avec laquelle la machine enregistre. Le chiffre est le niveau de bande qu'atteint une crête à 0 dBFS, en dB au-dessus du flux de référence de 320 nWb/m, et la ligne d'état rappelle cette convention. Le réglage n'applique aucun gain par lui-même : tant que la bande ne sature pas, le même signal ressort au même niveau quelle que soit la position de Record Level. Ce niveau n'est pas exactement l'unité - il en reste à moins de 0.05 dB, un peu au-dessus à 30 ips et un peu au-dessous à 7.5 ips - mais il ne bouge pas avec Record Level. La valeur par défaut de +6.0 dB correspond à une machine à son niveau de travail normal, où une tonalité de 1 kHz à pleine échelle distord de 0.49 % ; +12.0 dB donne 2.0 % et le maximum de +18.0 dB 6.8 %, et c'est ainsi que l'on obtient la compression et la chaleur de la bande. L'aplatissement des crêtes est le fait de la bande et non du réglage qui baisserait quoi que ce soit : plus la bande est attaquée fort, plus le résultat est faible, et Output est là pour rattraper le volume. Le réglage déplace aussi le fond d'un décibel par décibel dans l'autre sens, puisque le souffle est enregistré sur la bande et que la bande se trouve désormais plus loin sous la crête.
- **Wow/Flutter** (0 à 1 %) - Règle les variations de vitesse du défilement, sous forme d'écart en crête pondéré selon DIN 45507, en pourcentage à 15 ips. 0 % correspond à une machine parfaitement stable. 0.04 % est la tolérance que la machine de studio de référence publie à cette vitesse, et la choisir donne les 0.06 % à 7.5 ips et les 0.03 % à 30 ips que cette même machine publie pour ces vitesses. La valeur par défaut de 0.160 % vaut quatre fois cette tolérance ; au-delà, on obtient la dérive et le tremblement audibles d'une platine fatiguée, jusqu'à 1.5 % à 7.5 ips.
- **Hiss** (-89.0 à -39.0 dB re 320 nWb/m) - Règle ensemble le niveau du souffle de bande et du bruit de modulation, sous forme de flux de souffle pondéré A à 15 ips sur bande Standard, rapporté à la référence de 320 nWb/m. C'est le chiffre de la fiche technique de la bande elle-même et non un niveau en sortie : le bruit est enregistré sur la bande, si bien que ce qu'il mesure en sortie dépend de Record Level. -89.0 dB re 320 nWb/m les coupe complètement tous les deux. La valeur par défaut de -62.5 dB re 320 nWb/m est le bruit de polarisation que le fabricant publie pour cette bande à cette vitesse ; les autres vitesses et la bande Master s'en écartent de ce qu'indique la fiche technique, si bien qu'à cette valeur par défaut et avec Record Level à +6.0 dB les six combinaisons s'étalent de -68.0 à -72.0 dBFS, et l'ensemble se déplace avec les deux réglages. Toutes ces valeurs sont en amont d'Output : un appareil de mesure placé après Output les lit relevées de ce qu'affiche Output. Ce plancher est ce que l'on entend dans les silences ; pendant que la musique joue, ce que ce réglage ajoute surtout est le bruit de modulation porté par le signal, environ 57 dB sous une tonalité stable sur bande Standard à 15 ips, à quelques décibels près selon les autres réglages de Speed et de Tape et selon le programme réel. Les valeurs supérieures rendent le fond plus présent.
- **Output** (-24.0 à +24.0 dB) - Ajuste le niveau après toute la chaîne. Il sert à égaliser le volume lors d'une comparaison avec le bypass, ou à rattraper le niveau sonore qu'un Record Level élevé a coûté.
- **Mix** (0 à 100 %) - Mélange le signal de bande et le signal d'origine. 100 % correspond à la lecture de bande complète. Le signal sec est aligné temporellement sur le trajet de bande : le médium se mélange donc proprement, 1 kHz restant à moins de 0.1 dB de l'unité à tous les réglages de Mix et à toutes les vitesses avec le Bias de référence de 0.0 dB, et à moins de 0.5 dB en tout point de la course de Bias, mais pas l'octave supérieure, où le sec et la bande ne partagent plus la même phase et s'annulent en partie. À 50 %, le niveau à 16 kHz ressort 1.7 dB plus bas sur un hôte à 44.1 kHz, 2.1 dB à 48 kHz, 4.6 dB à 96 kHz et 5.7 dB à 192 kHz, et sur un hôte à 96 ou 192 kHz le point le plus sombre du réglage n'est pas 100 % mais environ 70 %. Sur un hôte à 44.1 kHz, il ne fait que s'assombrir à mesure qu'on le monte, et sur un hôte à 48 kHz le point le plus sombre est 89 %, soit 0.06 dB sous 100 %, de sorte que dans les deux cas le milieu de la course est plus brillant tout en haut que 100 %. À 0 %, l'entrée passe sans aucune modification et l'effet n'ajoute aucune latence ; à tout autre réglage, il ajoute 5.26 ms sur un hôte à 44.1 kHz et 5.06 ms sur un hôte à 192 kHz.

### Réglages recommandés

1. **Bande master de studio (par défaut)**
   - Speed : 15 ips, Tape : Standard, Bias : 0.0 dB, Record Level : +6.0 dB
   - Wow/Flutter : 0.160 %, Hiss : -62.5 dB re 320 nWb/m, Output : 0.0 dB, Mix : 100 %
   - Le son de bande de tous les jours, qui est aussi la valeur par défaut du plugin : aigu adouci de 3.5 dB à 16 kHz, remontée de 0.8 dB vers 80 Hz, 0.49 % de distorsion et 0.17 dB d'arrondi sur une tonalité à pleine échelle, un fond à -68.5 dBFS et 0.160 % de pleurage et scintillement, audibles sur les notes tenues et non sur les transitoires.

2. **Report propre à grande vitesse**
   - Speed : 30 ips, Tape : Master, Bias : 0.0 dB, Record Level : 0.0 dB
   - Wow/Flutter : 0.070 %, Hiss : -68.5 dB re 320 nWb/m, Output : 0.0 dB, Mix : 100 %
   - Très proche de l'original : 0.07 % de distorsion et 0.02 dB d'arrondi sur une tonalité à pleine échelle, 2.2 dB de moins à 16 kHz, un fond à -72.0 dBFS - ce que devient le réglage Base de -68.5 dB re 320 nWb/m à 30 ips sur bande Master à ce Record Level - et 0.053 % de pleurage et scintillement. La bande est enregistrée 6 dB sous la valeur par défaut, et c'est ce qui la garde aussi propre. Utile comme point de repère pour comparer les autres réglages.

3. **Chaud et compressé**
   - Speed : 15 ips, Tape : Standard, Bias : 0.0 dB, Record Level : +18.0 dB
   - Wow/Flutter : 0.200 %, Hiss : -62.5 dB re 320 nWb/m, Output : +1.5 dB, Mix : 100 %
   - La bande est enregistrée 12 dB au-dessus de la valeur par défaut, au maximum de la course : une tonalité à pleine échelle ressort arrondie de 2.49 dB avec 6.8 % de distorsion, si bien que le mixage devient plus dense et plus chaud pendant que les crêtes s'aplatissent. Le fond descend en même temps à -80.5 dBFS, parce que le souffle est sur la bande et que la bande se trouve désormais d'autant plus haut. Output monte, et ne descend pas, car la compression coûte du niveau sonore ; affinez à l'oreille.

4. **Magnétophone domestique à 7.5 ips**
   - Speed : 7.5 ips, Tape : Standard, Bias : +2.0 dB, Record Level : +12.0 dB
   - Wow/Flutter : 0.300 %, Hiss : -59.5 dB re 320 nWb/m, Output : +0.5 dB, Mix : 100 %
   - Plus sombre (10.2 dB de moins à 16 kHz, avec une remontée de 1.4 dB à 50 Hz) et plus bruyant (un fond à -72.5 dBFS, soit le plancher de bande propre de -73.0 dBFS augmenté de ses +0.5 dB d'Output), et moins stable (0.450 % de pleurage et scintillement), avec 1.3 % de distorsion sur une tonalité à pleine échelle. La polarisation est réglée un peu haut, comme l'est souvent un magnétophone domestique utilisant une bande générique : une machine ordinaire plutôt qu'un appareil de studio.

5. **Défilement usé**
   - Speed : 7.5 ips, Tape : Standard, Bias : -2.0 dB, Record Level : +15.0 dB
   - Wow/Flutter : 0.480 %, Hiss : -56.5 dB re 320 nWb/m, Output : +1.0 dB, Mix : 100 %
   - 0.720 % de pleurage et scintillement, 5.2 % de distorsion et 1.80 dB d'arrondi sur une tonalité à pleine échelle, et un fond à -72.0 dBFS - le plancher de bande propre de -73.0 dBFS augmenté de ses +1.0 dB d'Output - avec l'aigu râpeux et en avant d'une machine sous-polarisée, seulement 4.4 dB plus bas à 16 kHz là où une machine alignée à cette vitesse est 7.2 dB plus bas. Output doit monter pour rétablir le volume. Un effet lo-fi volontairement dégradé.

### Notes sur le modèle

L'effet modélise un seul passage d'enregistrement et de lecture sur une machine correctement alignée. Le côté enregistrement relève les aigus avant la bande et le côté lecture retire exactement le même relèvement, à toutes les vitesses, au lieu de suivre une norme de correction publiée telle que la NAB. L'effet d'écho (copie magnétique), les décrochages de bande, les erreurs d'azimut, le bruit de collure et les normes de correction propres à chaque machine sont hors du modèle. Le trajet de bande comporte 5.06 à 5.26 ms de retard de défilement et de traitement sur les hôtes de 44.1 à 192 kHz. Les valeurs de timbre citées plus haut sont mesurées sur un hôte à 96 kHz avec le Bias de référence de 0.0 dB ; l'extrême aigu dépend de la fréquence d'échantillonnage de l'hôte, si bien que les 3.5 dB à 16 kHz du réglage par défaut deviennent 2.7 dB à 44.1 ou 48 kHz.

## Vinyl Artifacts

Un effet qui ajoute des artefacts de lecture façon vinyle, comme pops, crépitements, souffle, rumble et bruit de surface réactif. Il ajoute un bruit de disque généré à la musique ; il ne modifie pas la tonalité du signal musical original comme le ferait un modèle complet de platine, cellule ou préampli phono.

### Guide du Caractère Sonore
- Expérience de Disque Vinyle :
  - Recrée le son authentique de la lecture de disques vinyles
  - Ajoute le bruit de surface caractéristique et les artefacts
  - Crée cette sensation analogique chaleureuse et nostalgique
- Système de Lecture Vintage :
  - Ajoute des artefacts de lecture générés autour de la musique
  - Façonne la tonalité du bruit vinyle généré
  - Ajoute un bruit réactif qui répond à la musique
- Texture Ambiante :
  - Crée une texture d'arrière-plan riche et organique
  - Ajoute de la profondeur et du caractère aux enregistrements numériques
  - Parfait pour créer des expériences d'écoute chaleureuses et intimes

### Paramètres
- **Pops/min** - Contrôle la fréquence des gros bruits de clic par minute (0 à 120)
  - 0-20 : Pops doux occasionnels
  - 20-60 : Caractère vintage modéré
  - 60-120 : Son d'usure importante
- **Pop Level** - Contrôle le volume des bruits de pop (-80.0 à 0.0 dB)
  - -80 à -48 dB : Clics subtils
  - -48 à -24 dB : Pops modérés
  - -24 à 0 dB : Pops forts (réglages extrêmes)
- **Crackles/min** - Contrôle la densité du bruit de crépitement par minute (0 à 2000)
  - 0-200 : Texture de surface subtile
  - 200-1000 : Caractère vinyle classique
  - 1000-2000 : Bruit de surface lourd
- **Crackle Level** - Contrôle le volume du bruit de crépitement (-80.0 à 0.0 dB)
  - -80 à -48 dB : Crépitement subtil
  - -48 à -24 dB : Crépitement modéré
  - -24 à 0 dB : Crépitement fort (réglages extrêmes)
- **Hiss** - Contrôle le niveau de bruit de surface constant (-80.0 à 0.0 dB)
  - -80 à -48 dB : Texture d'arrière-plan subtile
  - -48 à -30 dB : Bruit de surface perceptible
  - -30 à 0 dB : Sifflement proéminent (réglages extrêmes)
- **Rumble** - Contrôle le grondement basse fréquence de la platine (-80.0 à 0.0 dB)
  - -80 à -60 dB : Chaleur subtile dans les graves
  - -60 à -40 dB : Grondement perceptible
  - -40 à 0 dB : Grondement lourd (réglages extrêmes)
- **Crosstalk** - Mélange le bruit d'artefacts généré entre les canaux gauche et droit ; le signal musical original garde sa séparation stéréo (0 à 100%)
  - 0% : Le bruit généré garde sa séparation de canaux originale
  - 30-60% : Débordement de bruit réaliste façon vinyle
  - 100% : Le bruit généré devient presque identique entre gauche et droite
- **Noise Profile** - Ajuste la réponse en fréquence du bruit généré (0.0 à 10.0)
  - 0 : Tonalité de bruit la plus sombre et chaleureuse
  - 5 : Tonalité de bruit partiellement façonnée
  - 10 : Tonalité de bruit plate / modelage tonal contourné
- **Wear** - Multiplie les artefacts d'usure de surface comme pops, crépitements et souffle (0 à 200%)
  - 0-50% : Bruit de surface plus propre
  - 50-100% : Usure de surface normale
  - 100-200% : Bruit de surface fortement usé
  - Rumble, Crosstalk et Noise Profile sont contrôlés séparément
- **React** - À quel point le bruit répond au signal d'entrée (0 à 100%)
  - 0% : Niveaux de bruit statiques
  - 25-50% : Réponse modérée à la musique
  - 75-100% : Très réactif à l'entrée
- **React Mode** - Sélectionne quel aspect du signal contrôle la réaction
  - Velocity : Répond au contenu haute fréquence (vitesse d'aiguille)
  - Amplitude : Répond au niveau général du signal
- **Mix** - Contrôle la quantité de bruit ajoutée au signal sec (0 à 100%)
  - 0% : Aucun bruit ajouté (signal sec seulement)
  - 50% : Addition de bruit modérée
  - 100% : Addition de bruit maximale
  - Note : Le niveau du signal sec reste inchangé ; ce paramètre contrôle seulement la quantité de bruit

### Réglages Recommandés pour Différents Styles

1. Caractère Vinyle Subtil
   - Pops/min : 20, Pop Level : -48dB, Crackles/min : 200, Crackle Level : -48dB
   - Hiss : -48dB, Rumble : -60dB, Crosstalk : 30%, Noise Profile : 5.0
   - Wear : 25%, React : 20%, React Mode : Velocity, Mix : 100%
   - Parfait pour : Ajouter une texture vinyle douce

2. Expérience Vinyle Classique
   - Pops/min : 40, Pop Level : -36dB, Crackles/min : 400, Crackle Level : -36dB
   - Hiss : -36dB, Rumble : -50dB, Crosstalk : 50%, Noise Profile : 4.0
   - Wear : 60%, React : 30%, React Mode : Velocity, Mix : 100%
   - Parfait pour : Expérience d'écoute vinyle authentique

3. Disque Très Usé
   - Pops/min : 80, Pop Level : -24dB, Crackles/min : 800, Crackle Level : -24dB
   - Hiss : -30dB, Rumble : -40dB, Crosstalk : 70%, Noise Profile : 3.0
   - Wear : 120%, React : 50%, React Mode : Velocity, Mix : 100%
   - Parfait pour : Caractère de disque fortement vieilli

4. Lo-Fi Ambiant
   - Pops/min : 15, Pop Level : -54dB, Crackles/min : 150, Crackle Level : -54dB
   - Hiss : -42dB, Rumble : -66dB, Crosstalk : 25%, Noise Profile : 6.0
   - Wear : 40%, React : 15%, React Mode : Amplitude, Mix : 100%
   - Parfait pour : Texture ambiante d'arrière-plan

5. Vinyle Dynamique
   - Pops/min : 60, Pop Level : -30dB, Crackles/min : 600, Crackle Level : -30dB
   - Hiss : -39dB, Rumble : -45dB, Crosstalk : 60%, Noise Profile : 5.0
   - Wear : 80%, React : 75%, React Mode : Velocity, Mix : 100%
   - Parfait pour : Bruit qui répond de manière dramatique à la musique

## Vinyl Simulator

Vinyl Simulator transforme la musique elle-même à l'aide d'un modèle physique de gravure et de lecture. Le signal passe par les filtres de gravure et la courbe RIAA, est inscrit dans un sillon avec rugosité et débris, puis lu par une simulation mécanique de la pointe et du bras avant la correction RIAA de lecture. Utilisez-le lorsque vous voulez que la géométrie du sillon, le suivi et la surface interagissent réellement avec la musique.

### Différence avec Vinyl Artifacts

- **Vinyl Simulator** modifie le signal en le faisant passer par le sillon et la pointe modélisés. Rugosité, poussière, statique, force d'appui, forme de pointe, vitesse et rayon participent au résultat.
- **Vinyl Artifacts** conserve la musique intacte et lui ajoute pops, crépitements, souffle, rumble et fuite de bruit. Choisissez-le pour une couche de bruit plus légère et prévisible, ou sans WASM.
- Les deux peuvent être combinés, mais des réglages de surface forts dans chacun accumulent rapidement clics et bruit.

### Guide d'amélioration sonore

- **Lecture douce :** Cut Level près de 0 dB, pointe Elliptical, Roughness modérée, peu de Dust et de Static, et Mix réduit pour préserver davantage l'original.
- **Caractère de fin de face :** rapprochez Radius de 60 mm. La vitesse linéaire plus faible rend les aigus et le suivi plus exigeants.
- **Lecture propre et stable :** baissez Roughness, Dust, Static et Scratch, gardez Tracking Force autour de 2 g et utilisez Standard ou High.
- **Surface usée :** augmentez d'abord Roughness, puis Dust, Static et un peu de Scratch. Chaque réglage représente un phénomène physique différent.
- **Coloration plus marquée :** augmentez Cut Level avec prudence, baissez HF Cutoff ou réduisez Radius. Surveillez la baisse de Tracking S/E et les événements mistrack/skip.
- Vinyl Simulator ne produit ni wow/flutter, ni excentration, ni voile, ni rumble de platine. Ajoutez **Wow Flutter** dans la chaîne si nécessaire.

### Paramètres

#### Cutting

- **Cut Level** (-20 à +20 dB) — Niveau d'entraînement du burin. Une valeur élevée accentue déplacement et non-linéarité ; une valeur basse laisse plus de marge mécanique.
- **HF Cutoff** (6000 à 24000 Hz) — Limite des aigus avant gravure. Plus bas donne un sillon plus sombre et facile à suivre ; plus haut préserve davantage de détails.
- **Bass Mono Below** (50 à 1000 Hz) — Plage sous laquelle la composante Side est réduite. Une valeur élevée recentre davantage les graves.
- **Side Mix** (0 à 100 %) — Quantité de Side conservée sous Bass Mono Below. 0 % rend cette plage mono ; 100 % conserve le Side d'origine.

#### Record

- **Speed** (33⅓, 45 ou 78 rpm) — Vitesse de rotation. À Radius égal, une vitesse supérieure augmente la vitesse linéaire et facilite le suivi des détails fins.
- **Radius** (60 à 146 mm) — Position de la pointe. Une petite valeur représente le sillon intérieur, plus lent et plus difficile dans l'aigu.
- **Roughness** (0,1 à 100 nm) — Rugosité microscopique de surface ; l'augmenter renforce la texture continue.
- **Dust** (0 à 10000/s) — Fréquence des particules de poussière et de leurs perturbations brèves.
- **Static** (0 à 10000/s) — Fréquence des décharges électriques, ajoutées comme pops à la sortie de la cellule.
- **Scratch** (0 à 1000/s) — Fréquence des défauts de sillon plus importants.

#### Stylus

- **Shape** (Spherical ou Elliptical) — Géométrie de contact. En Spherical, Scan Radius suit Side Radius. Un changement reconstruit l'état de simulation.
- **Side Radius** (5 à 25 µm) — Rayon transversal à la paroi ; il modifie l'empreinte et la pression de contact.
- **Scan Radius** (2 à 25 µm) — Rayon dans le sens du sillon. Petit, il suit les détails fins ; grand, il les moyenne sur un contact plus large.
- **Tracking Force** (0,5 à 5,0 g) — Force d'appui. Davantage stabilise parfois le contact mais augmente force et pression ; trop peu favorise mistrack et skip.
- **Tip Mass** (0,1 à 1,5 mg) — Masse mobile de la pointe. Une valeur élevée accroît l'inertie et gêne les mouvements rapides.
- **Compliance** (5 à 35 cu) — Souplesse de suspension. Une valeur élevée autorise plus de mouvement et change la réponse mécanique.
- **Damping** (0,05 à 1,0 ζ) — Amortissement des résonances. Une valeur élevée réduit davantage le ringing.

#### Output

- **Quality** (Eco, Standard, High ou Ultra) — Définit le nombre de base de sous-pas physiques et de points de contact. Pour stabiliser la résonance de contact, le moteur peut augmenter automatiquement le nombre effectif de sous-pas selon la fréquence d'échantillonnage, Tracking Force, Tip Mass, Compliance, Shape, Side Radius et Scan Radius. Standard est le défaut en temps réel ; un changement reconstruit la simulation.
- **Output Gain** (-24 à +24 dB) — Niveau après correction RIAA et normalisation.
- **Mix** (0 à 100 %) — Mélange de la lecture simulée avec le signal sec aligné en latence. 0 % = sec, 100 % = simulé.

### Lecture du HUD

- **Force L/R (mN)** : force sur chaque paroi ; des valeurs fortes ou déséquilibrées signalent un passage exigeant.
- **Pressure (GPa)** : pression de contact la plus élevée ; à lire avec Force lors du réglage de la pointe.
- **Tip (cm/s, dB)** : vitesse de pointe et niveau de lecture correspondant.
- **Tracking S/E L/R (dB)** : rapport signal suivi/erreur. Plus haut est plus propre ; une baisse durable indique un suivi difficile.
- **Jitter (ns)** : variation temporelle du point de lecture, visible dans Stylus.
- **Mistrack, Skip, Static Pop et Dust Hit (/s)** : taux d'événements récents, avec flash à chaque nouvel événement. En cas de répétition, baissez Cut Level, augmentez modérément Tracking Force, augmentez Radius ou Quality.

Le HUD s'active avec la télémétrie DSP native. À l'arrêt ou lorsque la télémétrie est suspendue pour économiser l'énergie, il peut afficher un état inactif.

### Réglages conseillés

1. **Lecture douce :** Cut Level 0 dB, HF Cutoff 16 kHz, 33⅓ rpm, Radius 120 mm, Roughness 5 nm, Dust 0,5/s, Static 0,02/s, Scratch 0/s, Elliptical, Tracking Force 2,0 g, Standard, Mix 75 %.
2. **Sillon extérieur classique :** Cut Level 0 dB, 33⅓ rpm, Radius 135 mm, Roughness 13,17 nm, Dust 2/s, Static 0,08/s, Elliptical, Tracking Force 2,0 g, Standard, Mix 100 %.
3. **Démonstration intérieure :** Cut Level +3 dB, HF Cutoff 14 kHz, 33⅓ rpm, Radius 60 mm, Elliptical, Scan Radius 8 µm, Tracking Force 2,0 g, High, Mix 100 % ; comparez Tracking S/E à un grand Radius.
4. **Surface usée :** Radius 100 mm, Roughness 35 nm, Dust 25/s, Static 1/s, Scratch 0,5/s, Tracking Force 2,2 g, Standard, Output Gain -3 dB, Mix 100 %.

### Quality et charge CPU

Chaque preset Quality fixe un nombre de base de sous-pas et de points de contact. Pour garantir la stabilité, le moteur calcule aussi `Nmin = ceil(8 × f_c / sampleRate)`, où la fréquence de résonance de contact `f_c` dépend de Tracking Force, Tip Mass, Compliance, Shape, Side Radius et Scan Radius, puis utilise `effectiveSubsteps = max(base, Nmin)`. Avec les réglages par défaut, Standard à 96 kHz reste à sa base de 4 sous-pas : l'objectif de performances existant ne change pas.

La charge principale est proportionnelle à fréquence d'échantillonnage × sous-pas effectifs × points de contact. Les évaluations et charges relatives ci-dessous sont des valeurs de base lorsque le seuil de stabilité n'augmente pas les sous-pas, et non des pourcentages CPU mesurés ; le processeur, le navigateur et WASM SIMD influencent aussi le résultat.

| Quality | Détail de base | Évaluations de base à 96 kHz | Charge relative de base | Usage |
|---|---:|---:|---:|---|
| Eco | 2 × 7 | 2,7 millions/s | 0,39× | Mobile, basse consommation, plusieurs instances |
| Standard | 4 × 9 | 6,9 millions/s | 1,00× | Écoute normale en temps réel |
| High | 8 × 13 | 20 millions/s | 2,89× | Systèmes rapides, comparaison ciblée |
| Ultra | 20 × 25 | 96 millions/s | 13,89× | Rendu hors ligne et vérification |

Lorsque le seuil de stabilité est inactif, appliquez à la charge relative de base les multiplicateurs suivants : 44,1 kHz = 0,46× ; 48 = 0,50× ; 88,2 = 0,92× ; 96 = 1,00× ; 176,4 = 1,84× ; 192 = 2,00×. La fréquence d'échantillonnage et les réglages Tracking Force, Tip Mass, Compliance, Shape, Side Radius et Scan Radius peuvent activer ce seuil et porter la charge réelle au-dessus de l'estimation de base. En cas de coupures, baissez d'abord Quality.

### WASM requis et limites

Vinyl Simulator exige le noyau DSP WebAssembly natif en temps réel. Si WASM est désactivé avec `?dsp=off`, non pris en charge ou mal initialisé, le signal traverse sans modification et l'interface indique que WASM est requis. Il n'utilise pas la simulation JavaScript de référence, beaucoup plus lente.

Le modèle traite la première paire stéréo. La déformation de la poussière ne dure que pendant la vie de chaque particule ; la pointe avance toujours dans un sillon nouvellement généré. L'usure ne s'accumule donc pas d'un tour à l'autre et n'est pas enregistrée dans les presets. Usure à long terme, vue 3D, compteurs SNR/THD temps réel, wow/flutter, excentration, voile, rumble de platine et charge électrique de cellule sont hors modèle.

N'oubliez pas : Ces effets sont destinés à ajouter du caractère et de la nostalgie à votre musique. Commencez avec des réglages subtils et ajustez selon vos goûts !
