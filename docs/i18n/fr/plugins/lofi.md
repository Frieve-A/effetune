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
- [Digital Error Emulator](#digital-error-emulator) - Simule diverses erreurs de transmission audio numérique
- [DSD64 IMD Simulator](#dsd64-imd-simulator) - Simule la distorsion d'intermodulation audible issue du bruit ultrasonique du DSD64
- [FM Radio Simulator](#fm-radio-simulator) - Fait passer la musique par une chaîne d'émission et de réception FM simulée physiquement
- [Hum Generator](#hum-generator) - Ajoute une ambiance de ronflement électrique contrôlable pour une écoute vintage/lo-fi
- [Noise Blender](#noise-blender) - Ajoute une texture atmosphérique en arrière-plan
- [Simple Jitter](#simple-jitter) - Crée des imperfections numériques vintage subtiles
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

- **Tuning** (-30.0 à +30.0 kHz) - Décale l'accord du récepteur par rapport à la station voulue. Un faible décalage réduit la clarté et accentue la distorsion du filtrage asymétrique ; avec un fort décalage, la station disparaît sous le bruit du récepteur.
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

- **Emphasis** (50 ou 75 µs) - Sélectionne la paire de constantes de temps de préaccentuation/désaccentuation (50 µs : Japon/Europe, 75 µs : Amériques). Sur un signal propre, la paire s'annule presque ; le choix modifie subtilement le timbre du souffle et de la distorsion.
- **Processing** (0 à +18 dB) - Niveau d'attaque du limiteur d'émission — la « puissance sonore » de la station. 0 dB est presque transparent ; les valeurs élevées sonnent plus denses et plus fortes, comme les stations très traitées.
- **Signal** (0 à 70 dBµV) - Niveau de porteuse à l'entrée d'antenne. Le plancher de bruit est fixé par la physique (bruit thermique 75 Ω plus facteur de bruit du récepteur), ce réglage détermine donc le rapport porteuse/bruit et constitue l'axe principal de dégradation. Vers 50 dBµV et au-dessus, la réception est pratiquement propre ; vers 30, le souffle stéréo est clairement audible ; vers 15, le fondu Auto est passé en mono ; à 6 et en dessous, les clics se multiplient et le programme sombre dans le bruit.
- **Tuning** (-200 à +200 kHz) - Désaccorde le récepteur par rapport à la station. Les petits écarts passent presque inaperçus ; à partir d'environ ±40 kHz, le son devient de plus en plus distordu, asymétrique et faible à mesure que les bandes latérales sortent de la bande passante FI. À ±200 kHz, la station se trouve entièrement hors de la bande passante et seul le bruit du récepteur subsiste.
- **IF Band** (80 à 240 kHz) - Largeur du filtre FI du récepteur. Les réglages étroits représentent un récepteur conçu pour des bandes encombrées : ils tronquent les bandes latérales FM et augmentent la distorsion, surtout combinés au désaccord. Les réglages larges sont plus propres pour une station forte et bien accordée.
- **Multipath** (0 à 100%) - Quantité d'effet de deux réflexions retardées : à 100%, la première réflexion atteint 30% de l'onde directe et la seconde 60% de la première. Les creux d'interférence transforment la FM en erreurs d'amplitude et de phase que le limiteur ne peut pas éliminer complètement, produisant la distorsion âpre typique des trajets multiples.
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
