---
title: "Plugins EQ - Égaliseurs paramétriques, graphiques et à phase linéaire, correction de salle - EffeTune"
description: "EQ paramétrique (import AutoEQ), graphique, dynamique et à phase linéaire, Room EQ selon vos mesures, Tonal Balance EQ, Loudness Equalizer et filtres."
lang: fr
---

# Plugins d'Égaliseur

Une collection de plugins qui vous permet d'ajuster différents aspects du son de votre musique, des basses profondes aux aigus nets. Ces outils vous aident à personnaliser votre expérience d'écoute en renforçant ou en atténuant certains éléments sonores.

## Commandes du graphique

Dans les graphiques à points déplaçables de 5Band PEQ, 15Band PEQ, 5Band FIR PEQ, Group Delay PEQ et Additional EQ de Room EQ, faites glisser un point normalement pour modifier les deux axes. Maintenez la touche Shift pendant le glissement pour limiter le mouvement à un seul axe : commencez principalement à l’horizontale pour ne modifier que Frequency, ou principalement à la verticale pour ne modifier que Level (Delay dans Group Delay PEQ). Relâchez Shift pour retrouver un déplacement libre. Placez le pointeur sur un point et faites défiler la molette vers le haut pour augmenter Q, ou vers le bas pour le diminuer.

## Sélection des bandes sur mobile

Sur mobile, 5Band PEQ, 5Band FIR PEQ, Group Delay PEQ, Additional EQ de Room EQ et Target Adjust de Tonal Balance EQ affichent les réglages d’une seule bande à la fois. Touchez un bouton numéroté pour changer de bande. Les réglages de toutes les bandes sont conservés.

## Liste des Plugins

- [15Band GEQ](#15band-geq) - Réglage détaillé du son avec 15 contrôles précis
- [15Band PEQ](#15band-peq) - Réglage tonal détaillé sur 15 bandes pour l'écoute de musique
- [5Band Dynamic EQ](#5band-dynamic-eq) - Égaliseur dynamique qui réagit à votre musique
- [5Band FIR PEQ](#5band-fir-peq) - Réglage tonal à cinq bandes par filtrage FIR à phase minimale ou linéaire
- [5Band PEQ](#5band-peq) - Égaliseur flexible pour façonner les graves, les médiums et les aigus
- [Band Pass Filter](#band-pass-filter) - Concentrez-vous sur des fréquences spécifiques
- [Comb Filter](#comb-filter) - Coloration sonore phasée, creuse ou métallique
- [Earphone Cable Sim](#earphone-cable-sim) - Vérifie à quel point les variations de réponse en fréquence des câbles d'écouteurs ordinaires restent généralement faibles
- [Group Delay EQ](#group-delay-eq) - Règle le retard de chaque bande de fréquence sans modifier le timbre
- [Group Delay PEQ](#group-delay-peq) - Contrôle paramétrique à cinq bandes du retard par fréquence sans modifier le timbre
- [Hi Pass Filter](#hi-pass-filter) - Éliminez avec précision les basses fréquences indésirables
- [Lo Pass Filter](#lo-pass-filter) - Éliminez avec précision les hautes fréquences indésirables
- [Loudness Equalizer](#loudness-equalizer) - Correction de l'équilibre des fréquences pour une écoute à faible volume
- [Narrow Range](#narrow-range) - Concentrez-vous sur des parties spécifiques du son
- [Room EQ](#room-eq) - Correction FIR fondée sur des mesures acoustiques enregistrées
- [Tilt EQ](#tilt-eq) - Égaliseur simple qui incline le spectre sonore
- [Tonal Balance EQ](#tonal-balance-eq) - Corrige automatiquement l'équilibre tonal à long terme vers une cible propre à un style musical
- [Tone Control](#tone-control) - Réglage simple des basses, médiums et aigus

<!-- spectrum-overlay -->
## Superposition du spectre

Appuyez sur l’icône de spectre d’un graphique compatible pour passer successivement de After à Before + After, puis à Off. After affiche uniquement le spectre après traitement sous forme de courbe bleue. Before + After remplit la variation entre le spectre avant et après traitement : une couleur chaude signale les fréquences dont le niveau a augmenté, le bleu celles dont le niveau a diminué, et une courbe grise indique le spectre After. Les spectres d’entrée et de sortie sont alignés sur le même instant de lecture, afin de comparer le même son. Le réglage Normale applique un lissage au 1/12 d’octave ; Haute qualité analyse les basses fréquences plus en détail. Utilisez cette comparaison pour voir comment chaque réglage modifie les graves, les médiums et les aigus pendant l’écoute. Lisez les niveaux du spectre sur l’échelle dBFS à droite du graphique. Elle est distincte de l’échelle de gain du graphique : 0 dBFS est la référence numérique de pleine échelle et les valeurs plus basses correspondent à des niveaux plus faibles. Dans Configuration, choisissez **Normale** ou **Haute qualité** pour la qualité du spectre superposé, et **Valeur instantanée** ou **Maintien des crêtes** pour son affichage. Le maintien des crêtes garde les pics récents visibles puis les fait diminuer progressivement. En mode After, seul le spectre après traitement est recueilli ; en mode Off, l’acquisition et le tracé s’arrêtent.

## 15Band GEQ
Un outil de réglage du son détaillé avec 15 contrôles distincts, chacun affectant une partie spécifique du spectre sonore. Parfait pour ajuster votre musique exactement comme vous l'aimez.

### Guide d'Amélioration de l'Écoute
- Région des basses (25Hz-160Hz):
  - Renforcez la puissance de la grosse caisse et des basses profondes
  - Ajustez la plénitude des instruments de basse
  - Contrôlez les sub-basses capables de faire vibrer la pièce
- Bas des médiums (250Hz-630Hz):
  - Ajustez la chaleur de la musique
  - Contrôlez la plénitude du son global
  - Réduisez ou accentuez l'épaisseur du son
- Haut des médiums (1kHz-2.5kHz):
  - Rendez les voix plus claires et présentes
  - Ajustez la présence des instruments principaux
  - Contrôlez l'aspect en avant du son
- Hautes Fréquences (4kHz-16kHz):
  - Améliorez la netteté et le détail
  - Contrôlez l'éclat et l'air de la musique
  - Ajustez la brillance globale

### Paramètres
- **Gains de Bande** - Contrôles individuels pour chaque plage de fréquences (-12dB à +12dB)
  - Basses Profondes
    - 25Hz: Sensation de basse la plus faible
    - 40Hz: Impact des basses profondes
    - 63Hz: Puissance des basses
    - 100Hz: Plénitude des basses
    - 160Hz: Basses supérieures
  - Son Bas
    - 250Hz: Chaleur du son
    - 400Hz: Plénitude du son
    - 630Hz: Corps du son
  - Son Moyen
    - 1kHz: Présence du son principal
    - 1.6kHz: Clarté du son
    - 2.5kHz: Détail du son
  - Son Aigu
    - 4kHz: Netteté du son
    - 6.3kHz: Brillance du son
    - 10kHz: Air du son
    - 16kHz: Éclat du son

### Affichage Visuel
- Graphique en temps réel montrant vos ajustements sonores
- Curseurs faciles à utiliser avec un contrôle précis
- Réinitialisation en un clic aux paramètres par défaut
- Double-cliquez sur un curseur pour ramener cette bande à 0dB
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## 15Band PEQ

Un égaliseur paramétrique à 15 bandes pour ajuster finement les basses, les voix, la présence et les aigus pendant l'écoute. Utilisez-le lorsque vous voulez plus de contrôle qu'avec un égaliseur graphique, depuis de petits changements de tonalité jusqu'à la recherche d'une fréquence précise qui gêne l'écoute.

### Guide d'Amélioration Sonore
- Clarté des Voix et des Instruments:
  - Réglez une bande autour de 3.2kHz avec un Q modéré (1.0-2.0) pour une présence naturelle
  - Appliquez des coupes avec un Q étroit (4.0-8.0) seulement lorsqu'une résonance précise gêne l'écoute
  - Ajoutez une légère sensation d'air avec une étagère haute 10kHz (+2 à +4dB)
- Contrôle de la Qualité des Basses:
  - Façonnez la plénitude des basses avec un filtre en cloche à 100Hz
  - Utilisez une coupe étroite si une note de basse ou un boom de pièce ressort trop
  - Créez une extension de basse fluide avec une étagère basse
- Ajustements Fins à l'Écoute:
  - Utilisez de petits boosts ou coupes larges pour des résultats naturels
  - Réservez les réglages étroits aux problèmes ciblés plutôt qu'à la tonalité générale
  - Comparez souvent avec le bypass pour garder une musique équilibrée

### Paramètres
- **Bandes Configurables**
  - 15 bandes de fréquence entièrement configurables
  - Configuration de fréquence initiale:
    - 25Hz, 40Hz, 63Hz, 100Hz, 160Hz (Basses profondes)
    - 250Hz, 400Hz, 630Hz (Sons bas)
    - 1kHz, 1.6kHz, 2.5kHz (Sons médiums)
    - 4kHz, 6.3kHz, 10kHz, 16kHz (Sons aigus)
- **Contrôles par Bande**
  - Fréquence Centrale: Ajustable de 20Hz à 20kHz
  - Plage de Gain: ±20dB pour les filtres Peaking et Low/High Shelf
  - Facteur Q: 0.1-10.0 pour la plupart des types de filtres ; Low/High Shelf est limité à 0.1-2.0
  - Un Q élevé affecte une plage plus étroite ; un Q bas sonne plus large et plus doux
  - Pour Low/High Pass, Band Pass, Notch et AllPass, Frequency et Q façonnent le filtre ; Gain n'est pas utilisé
  - Types de Filtres Multiples:
    - Peaking : Réglage symétrique des fréquences
    - Low/High Pass : Pente de 12dB/octave
    - Low/High Shelf : Modelage spectral doux
    - Band Pass : Isolation ciblée des fréquences
    - Notch: Suppression précise de fréquence
    - AllPass: Alignement fréquentiel focalisé sur la phase
- **Gestion des Préréglages**
  - Importation: Chargement de lignes de filtres TXT de style Equalizer APO
  - Jusqu'à 15 filtres `ON` PK/LS/LSC/HS/HSC sont importés ; les lignes `Preamp` et les types de filtres non pris en charge sont ignorés
    - Exemple de format:
      ```
      Filter 1: ON PK Fc 50 Hz Gain -3.0 dB Q 2.00
      Filter 2: ON HS Fc 12000 Hz Gain 4.0 dB Q 0.70
      ...
      ```

### Affichage Visuel
- Visualisation de la réponse en fréquence en haute résolution
- Points de contrôle interactifs avec affichage précis des paramètres
- Mise à jour de la courbe en temps réel pendant vos réglages
- Grille de fréquences et de gains
- Affichages numériques précis pour tous les paramètres
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## 5Band Dynamic EQ

Un égaliseur intelligent qui ajuste automatiquement les bandes de fréquences en fonction du contenu de votre musique. Il combine une égalisation précise avec un traitement dynamique qui réagit aux variations de votre musique en temps réel, offrant une expérience d'écoute améliorée sans réglages manuels constants.

### Guide d'amélioration d'écoute
- Adoucir les voix agressives :
  - Utilisez un filtre Peak à 3000Hz avec un ratio élevé (4.0-10.0)
  - Réglez un Threshold modéré (-24dB) et un Attack rapide (10ms)
  - Réduit automatiquement la dureté uniquement lorsque les voix deviennent trop agressives
- Améliorer la clarté et l'éclat :
  - Utilisez Band 5 avec Filter Type : Highshelf, Frequency : autour de 10000Hz, SC Freq : autour de 1200Hz, Ratio : 0.5, Attack : 1ms
  - Les médiums déclenchent les hautes fréquences pour une clarté naturelle
  - Apporte de l'éclat à la musique sans brillance permanente
- Maîtriser les basses excessives :
  - Utilisez un filtre Lowshelf à 100Hz avec un ratio modéré (2.0-4.0)
  - Conservez l'impact des basses tout en évitant la distorsion des haut-parleurs
  - Idéal pour la musique à forte basse sur des enceintes de petite taille
- Adaptation sonore dynamique :
  - Permet à la dynamique de la musique de contrôler l'équilibre sonore
  - S'ajuste automatiquement à différents morceaux et enregistrements
  - Maintient une qualité sonore constante tout au long de votre playlist

### Paramètres
- **Contrôles des cinq bandes** - chacun dispose de réglages indépendants
  - Band 1 : 100Hz (région des basses)
  - Band 2 : 300Hz (bas médium)
  - Band 3 : 1000Hz (médium)
  - Band 4 : 3000Hz (haut médium)
  - Band 5 : 10000Hz (hautes fréquences)
- **Réglages des bandes**
  - Filter Type : choisissez entre Peak, Lowshelf ou Highshelf
  - Frequency : ajustez précisément la fréquence centrale/de coupure (20Hz-20kHz)
  - Q : contrôle de la bande passante/raideur (0.1-10.0)
  - Max Gain : réglez le gain maximal (0-24dB)
  - Threshold : réglez le niveau de déclenchement (-60dB à 0dB)
  - Ratio : contrôle l'intensité du traitement (0.1-100.0)
    - En dessous de 1.0 : Expander (améliore lorsque le signal dépasse le Threshold)
    - Au-dessus de 1.0 : Compressor (réduit lorsque le signal dépasse le Threshold)
  - Knee Width : transition douce autour du Threshold (0-10dB)
  - Attack : vitesse de déclenchement du traitement (0.1-100ms)
  - Release : vitesse de relâchement du traitement (1-1000ms)
  - Sidechain Frequency : fréquence de détection (20Hz-20kHz)
  - Sidechain Q : bande passante de détection (0.1-10.0)

### Affichage visuel
- Graphe de réponse en fréquence en temps réel
- Courbe de réponse dynamique montrant les accentuations et atténuations en cours
- Contrôles interactifs de fréquence et de gain
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## 5Band FIR PEQ

5Band FIR PEQ reprend les cinq bandes familières de 5Band PEQ, mais construit leur réponse combinée sous la forme d'un seul filtre FIR. Utilisez-le pour corriger précisément le son à la lecture, appliquer des coupures très étroites ou créer des transitions de shelf prononcées sans les limites de stabilité des filtres récursifs. Minimum Phase réduit la latence de traitement, tandis que Linear Phase retarde toutes les fréquences d'une même durée fixe. Le plugin nécessite le moteur WASM DSP ; sans lui, le signal passe sans modification.

### Guide d'amélioration du son

- Commencez avec **Minimum Phase**, 32768 Taps et une Latency de 128 samples. Pour les réglages courants des graves, des médiums et des aigus, utilisez des valeurs de Q larges, d'environ 0,7 à 2.
- Pour atténuer un pic étroit confirmé par une mesure, choisissez Peaking, placez la fréquence centrale sur le pic, puis augmentez progressivement Q. Les valeurs supérieures à 10 sont destinées aux corrections précises ; vérifiez l'état, car une réponse extrêmement étroite peut exiger davantage de Taps.
- Utilisez Low Shelf pour équilibrer les graves et High Shelf pour équilibrer les aigus. Pour l'écoute quotidienne, commencez par de petites modifications de 1 à 3 dB.
- Utilisez LowPass ou HighPass pour supprimer les extrémités indésirables du spectre. Commencez avec une Slope de 12 ou 24 dB/oct, puis augmentez-la uniquement si une coupure plus franche est nécessaire.
- Choisissez **Linear Phase** lorsqu'un retard de phase constant sur tout le spectre est important et que la latence supplémentaire est acceptable. De l'énergie peut apparaître avant une transitoire, surtout avec des réglages prononcés ; comparez donc avec Minimum Phase sur les musiques aux attaques marquées.
- La construction FIR évite l'instabilité liée aux pôles de rétroaction, mais une forte accentuation ou un Q très élevé produit tout de même une réponse impulsionnelle longue et sélective. Pour une résonance isolée, préférez une atténuation à une accentuation et conservez une marge de niveau suffisante à la lecture.

### Paramètres

- **Phase**
  - **Minimum Phase** - Crée une réponse causale à phase minimale et n'ajoute pas le retard correspondant à la moitié de la longueur du FIR. La Latency sélectionnée s'applique toujours.
  - **Linear Phase** - Crée une réponse symétrique à phase linéaire et ajoute `Taps / 2` samples de retard FIR en plus de la Latency sélectionnée.
- **Taps** - Longueur du FIR : 8192, 16384, 32768, 65536 ou 131072. Davantage de taps améliore la précision dans le grave et pour les valeurs de Q très élevées, mais augmente l'utilisation de la mémoire, le temps de conception et le retard de Linear Phase.
- **Latency** - Latence de tête du moteur de convolution : 0, 128, 256, 512 ou 1024 samples. Les valeurs faibles réduisent le retard mais demandent plus de calcul.
- **Cinq bandes réglables** - Les fréquences centrales initiales sont 100 Hz, 316 Hz, 1 kHz, 3,16 kHz et 10 kHz. Chaque bande peut être activée séparément avec Enable.
- **Type** - Sélectionne Peaking, LowPass, HighPass, Low Shelf, High Shelf, BandPass ou Notch. Toutes les bandes actives sont combinées avant la conception du filtre FIR.
- **Freq** - Règle la fréquence de la bande de 20 Hz à 20 kHz.
- **Gain** - Règle l'accentuation ou l'atténuation de -20 à +20 dB pour Peaking, Low Shelf et High Shelf. LowPass, HighPass, BandPass et Notch n'utilisent pas Gain.
- **Q** - Règle la largeur de la réponse de 0,1 à 100. Les valeurs élevées produisent un changement plus étroit, les valeurs faibles un changement plus large. Le curseur utilise une échelle logarithmique.
- **Slope** - Règle la pente de coupure de LowPass ou HighPass de 0,1 à 384 dB/oct. Le curseur utilise une échelle logarithmique et le réglage n'est disponible que pour ces deux valeurs de Type.

### Lecture de l'affichage

- La courbe grise indique la réponse cible combinée correspondant aux réglages actuels des bandes.
- La courbe verte indique la réponse en amplitude réellement obtenue par le FIR conçu. Un écart visible signifie que le réglage Taps ne peut pas reproduire exactement la cible.
- Les marqueurs numérotés correspondent aux cinq bandes. Faites-les glisser horizontalement pour modifier Freq et verticalement pour modifier Gain ; les bandes désactivées apparaissent estompées.
- La ligne d'état indique si le FIR est en cours de conception, de préparation ou d'utilisation, ainsi que la latence totale de traitement en samples et en millisecondes.
- Si le réglage Taps ne peut pas reproduire précisément une réponse extrême, l'état recommande d'augmenter Taps ou de réduire Q ou Slope.
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## 5Band PEQ
Un égaliseur flexible à 5 bandes pour façonner la lecture musicale. Utilisez-le lorsque les basses sont bourdonnantes, que les voix paraissent dures ou que les aigus manquent un peu d'éclat, sans ouvrir la version à 15 bandes, plus détaillée.

### Guide d'Amélioration Sonore
- Clarté des Voix et des Instruments:
  - Utilisez la bande de 3.16kHz avec un Q modéré (1.0-2.0) pour une présence naturelle
  - Appliquez des coupes avec un Q étroit (4.0-8.0) seulement lorsqu'une résonance précise gêne l'écoute
  - Ajoutez une légère sensation d'air avec une étagère haute 10kHz (+2 à +4dB)
- Contrôle de la Qualité des Basses:
  - Façonnez la plénitude des basses avec un filtre en cloche à 100Hz
  - Utilisez une coupe étroite si une note de basse ou un boom de pièce ressort trop
  - Créez une extension de basse fluide avec une étagère basse
- Réglage Sonore au Quotidien:
  - Utilisez de petits réglages larges pour des changements de tonalité naturels
  - Atténuez à l'oreille la dureté, le caractère bourdonnant ou le manque d'éclat
  - Comparez souvent avec le bypass pour garder une musique équilibrée

### Paramètres
- **Cinq bandes réglables**
  - Band 1: 100Hz (Contrôle des Sub et des Basses)
  - Band 2: 316Hz (Définition des Bas-Médiums)
  - Band 3: 1.0kHz (Présence des Médiums)
  - Band 4: 3.2kHz (Détail des Hauts-Médiums)
  - Band 5: 10kHz (Extension des Hautes Fréquences)
- **Contrôles par Bande**
  - Fréquence Centrale: Ajustable de 20Hz à 20kHz
  - Plage de Gain: ±20dB pour les filtres Peaking et Low/High Shelf
  - Facteur Q: 0.1-10.0 pour la plupart des types de filtres ; Low/High Shelf est limité à 0.1-2.0
  - Un Q élevé affecte une plage plus étroite ; un Q bas sonne plus large et plus doux
  - Pour Low/High Pass, Band Pass, Notch et AllPass, Frequency et Q façonnent le filtre ; Gain n'est pas utilisé
  - Types de Filtres Multiples:
    - Peaking : Réglage symétrique des fréquences
    - Low/High Pass : Pente de 12dB/octave
    - Low/High Shelf : Modelage spectral doux
    - Band Pass : Isolation ciblée des fréquences
    - Notch: Suppression précise de fréquence
    - AllPass: Alignement fréquentiel focalisé sur la phase

### Affichage Visuel
- Visualisation de la réponse en fréquence en haute résolution
- Points de contrôle interactifs avec affichage précis des paramètres
- Mise à jour de la courbe en temps réel pendant vos réglages
- Grille de fréquences et de gains
- Affichages numériques précis pour tous les paramètres
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## Band Pass Filter

Un filtre passe-bande de précision qui combine les filtres passe-haut et passe-bas pour ne laisser passer que les fréquences dans une plage spécifique. Basé sur la conception de filtre Linkwitz-Riley pour une réponse de phase optimale et une qualité sonore transparente.

### Guide d'Amélioration de l'Écoute
- Focalisation sur la Plage Vocale:
  - Réglez le HPF entre 100-300Hz et le LPF entre 4-8kHz pour accentuer la clarté vocale
  - Utilisez des pentes modérées (-24dB/oct) pour un son naturel
  - Aide les voix à se distinguer dans les arrangements chargés
- Création d'Effets Spéciaux:
  - Définissez des plages de fréquences étroites pour des effets de téléphone, radio ou mégaphone
  - Utilisez des pentes plus abruptes (-36dB/oct ou plus) pour un filtrage plus dramatique
  - Expérimentez avec différentes plages de fréquences pour des sons créatifs
- Nettoyage de Plages de Fréquences Spécifiques:
  - Ciblez les fréquences problématiques avec un contrôle précis
  - Utilisez différentes pentes pour les sections passe-haut et passe-bas selon les besoins
  - Parfait pour éliminer simultanément les bruits de basse et haute fréquence

### Paramètres
- **HPF Frequency (Hz)** - Contrôle où les basses fréquences sont filtrées (10Hz à 40000Hz ; la limite supérieure effective dépend aussi de la fréquence d'échantillonnage audio)
  - Valeurs inférieures: Seules les fréquences les plus basses sont éliminées
  - Valeurs supérieures: Plus de basses fréquences sont éliminées
  - Ajustez en fonction du contenu basse fréquence spécifique que vous souhaitez éliminer
- **HPF Slope** - Contrôle l'agressivité de la réduction des fréquences en dessous du point de coupure
  - Off: Aucun filtrage appliqué
  - -12dB/oct: Filtrage doux (LR2 - Linkwitz-Riley du 2ème ordre)
  - -24dB/oct: Filtrage standard (LR4 - Linkwitz-Riley du 4ème ordre)
  - -36dB/oct: Filtrage plus fort (LR6 - Linkwitz-Riley du 6ème ordre)
  - -48dB/oct: Filtrage très fort (LR8 - Linkwitz-Riley du 8ème ordre)
- **LPF Frequency (Hz)** - Contrôle où les hautes fréquences sont filtrées (10Hz à 40000Hz ; la limite supérieure effective dépend aussi de la fréquence d'échantillonnage audio)
  - Valeurs inférieures: Plus de hautes fréquences sont éliminées
  - Valeurs supérieures: Seules les fréquences les plus hautes sont éliminées
  - Ajustez en fonction du contenu haute fréquence spécifique que vous souhaitez éliminer
- **LPF Slope** - Contrôle l'agressivité de la réduction des fréquences au-dessus du point de coupure
  - Off: Aucun filtrage appliqué
  - -12dB/oct: Filtrage doux (LR2 - Linkwitz-Riley du 2ème ordre)
  - -24dB/oct: Filtrage standard (LR4 - Linkwitz-Riley du 4ème ordre)
  - -36dB/oct: Filtrage plus fort (LR6 - Linkwitz-Riley du 6ème ordre)
  - -48dB/oct: Filtrage très fort (LR8 - Linkwitz-Riley du 8ème ordre)

### Affichage Visuel
- Graphique de réponse en fréquence en temps réel avec échelle de fréquence logarithmique
- Visualisation claire des deux pentes de filtre et des points de coupure
- Contrôles interactifs pour un ajustement précis
- Grille de fréquences avec marqueurs aux points de référence clés
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## Comb Filter

Un filtre en peigne qui ajoute un caractère phasé, creux, métallique ou résonant en mélangeant le son avec une copie très légèrement retardée. Utilisez-le lorsque vous voulez donner à un morceau une couleur plus marquée, plus spatiale ou plus expérimentale.

### Guide d'Amélioration de l'Écoute
- Ajouter une Coloration Subtile:
  - Commencez avec le mode Feedforward, Feedback Gain autour de 0.2-0.4 et Dry-Wet Mix autour de 20-40%
  - Ajustez Fundamental Frequency jusqu'à ce que la couleur creuse ou phasée s'accorde avec la musique
  - Gardez un feedback bas pour un effet plus doux qui se mélange au son original
- Créer Résonance et Effets d'Écho:
  - Utilisez le mode Feedback ou un Feedback Gain plus élevé pour obtenir une sonnerie ou un effet proche de l'écho
  - Expérimentez avec différentes fréquences fondamentales pour un caractère tonal unique
  - Réduisez Dry-Wet Mix si l'effet devient trop évident
- Couleur Métallique Brillante:
  - Essayez des valeurs de Fundamental Frequency plus élevées pour des pics et creux de peigne plus brillants et plus espacés
  - Utilisez un Feedback Gain positif ou négatif pour changer le motif des pics et des creux
  - Combinez avec d'autres effets pour des écoutes plus expérimentales

### Paramètres
- **Fundamental Frequency (Hz)** - Contrôle le délai temporel et l'espacement harmonique (20Hz à 20000Hz)
  - Valeurs plus basses: Délais plus longs, pics et creux de peigne plus rapprochés
  - Valeurs plus élevées: Délais plus courts, pics et creux de peigne plus espacés
- **Feedback Gain** - Contrôle l'intensité de l'effet du filtre en peigne (-1.0 à 1.0)
  - Valeurs négatives: Crée des motifs harmoniques inverses
  - Valeurs positives: Crée des motifs harmoniques de renforcement
  - Zéro: Aucun effet (signal sec uniquement)
  - Valeurs absolues plus élevées: Effet plus prononcé
- **Comb Type** - Contrôle la structure du filtre
  - Feedforward: Crée un renforcement harmonique sans rétroaction
  - Feedback: Crée des effets de résonance et d'écho
- **Dry-Wet Mix** - Contrôle l'équilibre entre le signal traité et l'original (0% à 100%)
  - 0%: Signal original uniquement
  - 50%: Mélange égal de signal original et traité
  - 100%: Signal traité uniquement

### Détails Techniques
- **Calcul du Délai**: Temps de délai = 1 / Fundamental Frequency
- **Réponse Harmonique**: Crée des pics et des creux régulièrement espacés à partir de la fréquence fondamentale
- **Coloration Spatiale**: Peut rappeler des réflexions très courtes, une couleur creuse ou une résonance métallique
- **Visualisation en Temps Réel**: Affiche la réponse en fréquence avec marqueur de fréquence fondamentale

### Affichage Visuel
- Graphique de réponse en fréquence en temps réel avec échelle de fréquence logarithmique
- Visualisation claire des pics et creux du filtre en peigne
- Marqueur de fréquence fondamentale montrant le délai temporel
- Contrôles interactifs pour un ajustement précis
- Calcul de la distance de délai en millimètres
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## Earphone Cable Sim

Reproduit les petites variations de réponse en fréquence qui apparaissent lorsqu'un écouteur est alimenté par un amplificateur via la résistance et l'inductance réelles du câble, avec une impédance de sortie non nulle. Comme l'impédance d'un écouteur varie selon la fréquence (résonances du transducteur et inductance de la bobine mobile), l'impédance de la source et du câble provoque des changements de niveau propres à chaque écouteur. Le plugin sert aussi de vérification pratique : avec des câbles de construction et de qualité courantes, une impédance de sortie d'amplificateur courante et des écouteurs qui n'ont pas une impédance exceptionnellement basse ni d'autre comportement atypique, l'effet audible des différences entre câbles d'écouteurs ordinaires reste généralement négligeable. L'effet est le plus marqué avec des écouteurs à faible impédance présentant de grands pics d'impédance, et il reste habituellement discret avec les amplificateurs modernes à faible impédance de sortie.

### Guide d'amélioration de l'écoute
- Évaluer l'interaction avec l'impédance de source:
  - Augmentez Output Z pour simuler un amplificateur à tubes ou une sortie casque à haute impédance
  - Comparez avec le bypass pour entendre l'évolution des graves et des zones proches des pics d'impédance
- Explorer le comportement des écouteurs multi-transducteurs:
  - Activez des Resonances supplémentaires pour modéliser des écouteurs à armature équilibrée ou hybrides avec plusieurs pics d'impédance
  - De grands pics d'impédance associés à une impédance de source plus élevée créent une coloration plus forte
- Simuler la résistance et l'inductance du câble:
  - Augmentez Cable R pour représenter des câbles plus longs ou plus fins, avec une résistance continue plus élevée
  - Augmentez Cable L pour représenter des câbles à plus forte inductance ; son effet se situe surtout dans l'extrême aigu
  - Cable R s'ajoute à la résistance série totale et peut donc renforcer l'interaction sur l'ensemble du spectre
- Vérifier l'audibilité des câbles ordinaires:
  - Utilisez des valeurs réalistes de Cable R et Cable L, puis comparez avec le bypass pour estimer la faiblesse des différences entre câbles ordinaires
  - Si seules des valeurs extrêmes de Output Z, de Cable R ou une Base Z très basse rendent le changement évident, la même comparaison indique que les câbles ordinaires sont peu susceptibles d'avoir un effet audible notable avec cet écouteur et cet amplificateur

### Préréglages système

Cliquez sur **Préréglages d’effet** dans l’en-tête de l’effet pour comparer des configurations complètes de source et de câble.

- **High Impedance Source** - Une source à forte impédance de sortie alimentant un écouteur à faible impédance.
- **Long Thin Cable** - Une résistance et une inductance du câble plus élevées.
- **Vintage Portable Out** - Une sortie d’appareil portable à impédance plus élevée, associée à un écouteur de 32 Ω.

### Paramètres
- **Output Z (Ω)** - Impédance de sortie de l'amplificateur (0 à 20). Les valeurs inférieures à 1Ω sont typiques des amplificateurs modernes ; des valeurs plus élevées renforcent la coloration liée à l'impédance.
- **Cable R (Ω)** - Résistance continue du câble (0 à 2). Des valeurs plus élevées représentent des câbles plus longs ou plus fins et s'ajoutent à la résistance série totale.
- **Cable L (µH)** - Inductance du câble (0 à 5). Elle affecte surtout la réponse dans l'extrême aigu, en particulier avec des écouteurs à faible impédance.
- **Voice Coil L (mH)** - Inductance de la bobine mobile de l'écouteur (0.01 à 2). Elle augmente l'impédance de charge vers les hautes fréquences et modifie l'interaction dans l'aigu.
- **Base Z (Ω)** - Impédance nominale de l'écouteur dans le grave (4 à 64). Plus la valeur est basse, plus l'impédance de la source et du câble a d'influence.
- **Resonances (jusqu'à 5)** - Chacune modélise un pic d'impédance du transducteur. La première est activée par défaut ; les autres sont préréglées sur des résonances de transducteur typiques et peuvent être activées ou désactivées.
  - **Enable** - Active ou désactive chaque résonance
  - **Freq (Hz)** - Fréquence de résonance (20 à 20000)
  - **Q** - Netteté du pic d'impédance (0.5 à 10)
  - **Peak Z (Ω)** - Impédance au sommet de la résonance (16 à 116)

### Détails Techniques
- **Modèle Physique**: Calcule `H(f) = Zload / (Zsource + Zload)`, où `Zsource` est l'impédance de sortie plus la résistance et l'inductance du câble, et `Zload` l'impédance de l'écouteur (impédance de base, inductance de bobine mobile et pics de résonance).
- **Réalisation**: La fonction de transfert est factorisée puis convertie en cascade de filtres biquad par méthode matched-Z, ce qui donne une latence nulle et un comportement à phase minimale comparable aux autres plugins d'EQ.
- **Normalisation**: La réponse est normalisée sur une moyenne de puissance à 0dB (20Hz à 20kHz), afin que l'activation ou la désactivation de l'effet ne change pas le volume global.

### Affichage Visuel
- Graphique en temps réel de la réponse du filtre appliqué, avec une échelle de fréquence logarithmique
- Les libellés de grille couvrent 20Hz à 20kHz ; la courbe tracée s'étend sur toute la plage du graphique, de 10Hz à 40kHz
- Courbe de réponse verte sur une grille sombre, avec un axe dB automatiquement ajusté autour de la référence normalisée à 0dB
- Les plus grands écarts de la courbe indiquent les zones où le modèle modifie le plus le niveau de lecture
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## Group Delay EQ

Group Delay EQ est le pendant d'un égaliseur ordinaire : au lieu de changer le niveau de chaque bande, il change **le moment où** chaque bande arrive. Quinze curseurs règlent le retard de chaque plage de fréquences, et le plugin construit un seul filtre FIR conçu pour réaliser ces retards avec une réponse en amplitude plate. Une réponse plate est l'objectif de conception, pas une garantie : un nombre fini de Taps ne fait qu'approcher la cible idéale, et des réglages de retard importants ou variant rapidement entre les bandes peuvent produire une ondulation d'amplitude mesurable. Utilisez-le pour compenser les erreurs temporelles d'une enceinte ou d'un filtre de coupure, ou pour vérifier vous-même à quel point la distorsion de phase est audible sur votre système. Le plugin nécessite le moteur WASM DSP ; sans lui, le signal passe sans modification.

Seules les différences entre bandes comptent pour le son. Un filtre qui retarde toutes les bandes de la même façon n'est qu'un simple délai : le plugin conserve donc un retard interne fixe et vous laisse avancer ou retarder chaque bande autour de lui. Tant que tous les curseurs sont à 0 ms, le plugin est totalement transparent et n'ajoute aucune latence.

### Guide d'amélioration du son

- **Alignement enceintes / caisson de grave**: Si les graves arrivent en retard par rapport au reste, retardez les bandes situées au-dessus de la coupure de la même valeur jusqu'à ce que le graphique y devienne plat. Les corrections typiques vont de 2 à 10 ms et se jugent au mieux sur la grosse caisse et la basse.
- **Enceintes bass-reflex et modes de pièce**: Un évent ajoute du temps de propagation de groupe autour de sa fréquence d'accord. Abaissez la bande grave concernée, ou remontez toutes les autres, pour aplanir la courbe. De petites différences résiduelles sous 50 Hz sont normales.
- **Test d'écoute de la distorsion de phase**: Réglez une bande sur +10 ms, comparez avec l'effet désactivé, puis réduisez la valeur jusqu'à ne plus entendre de différence. N'interprétez le résultat comme une comparaison de phase seule que si Ripple dans la ligne d'état est suffisamment faible et que la courbe verte Realized se superpose étroitement à la courbe grise Target. Sinon, les variations d'amplitude ou un retard réalisé avec une précision insuffisante peuvent aussi influer sur ce que vous entendez.
- **Procédez bande par bande**: Déplacez un curseur à la fois et écoutez. Les changements purement de phase sont subtils sur la plupart des programmes et se manifestent surtout sur les transitoires : batterie, cordes pincées, attaques de piano.
- **Surveillez les deux courbes**: Si la courbe verte ne suit plus la courbe grise, le réglage Taps actuel ne peut pas réaliser cette forme. Augmentez Taps ou réduisez l'écart entre bandes voisines.

### Paramètres

- **Taps** - Longueur du FIR : 4096, 8192, 16384 ou 32768. Les basses fréquences exigent un filtre long : à 96 kHz, 16384 taps suivent même de grands écarts de retard jusque vers 60 Hz, tandis que les réglages plus courts perdent d'abord en précision dans le grave. Taps détermine aussi le retard que le filtre peut contenir, donc la portée des curseurs. Plus de taps signifie plus de latence et plus de calcul.
- **Latency** - Latence de tête du moteur de convolution : 0, 128, 256, 512 ou 1024 samples. Des valeurs plus faibles réduisent le retard mais demandent plus de calcul.
- **Curseurs de bande (25 Hz à 16 kHz)** - Quinze curseurs règlent le temps de propagation de groupe de chaque bande. Les valeurs positives font arriver la plage plus tard, les négatives plus tôt. La plage couvre tout le retard que le filtre peut contenir : à 96 kHz, ±18,6 ms avec 4096 taps et ±149,3 ms avec 32768 taps. La bande la plus haute réalise ces valeurs intégralement, tandis que les bandes basses demandent davantage de taps pour suivre un réglage important ; le graphique montre jusqu'où chacune parvient. Les valeurs sont interpolées en douceur selon la fréquence, si bien que les bandes voisines se fondent toujours l'une dans l'autre.
- **Angle de phase** - Sous chaque valeur en millisecondes, le curseur affiche le même retard sous forme de rotation de phase à la fréquence centrale de la bande. Au-delà d'un tour complet, la lecture est décomposée en cycles entiers et angle restant : `+2c180°` signifie deux cycles complets plus un demi-tour.
- **Reset** - Double-cliquez sur un curseur pour ramener cette bande à 0 ms. Le bouton Reset du graphique réinitialise toutes les bandes d'un coup.

La latence totale vaut le réglage Latency plus la moitié des Taps. Elle ne change pas quand vous déplacez les curseurs : seul un changement de Taps ou de Latency modifie le retard de toute la chaîne.

### Affichage visuel

- La courbe grise est la cible : le retard demandé, interpolé sur un axe logarithmique de 20 Hz à 20 kHz. L'axe des retards se remet à l'échelle selon les réglages en cours, à partir de ±5 ms.
- La courbe verte est ce que le filtre conçu réalise réellement. Là où les deux se superposent, le réglage est pleinement réalisé ; là où elles s'écartent, le filtre ne peut pas suivre la demande avec les Taps actuels.
- La ligne d'état indique la latence totale en samples et en millisecondes, ainsi que l'ondulation d'amplitude du filtre. L'ondulation mesure l'écart entre la réponse en amplitude réalisée et l'objectif de conception plat : plus la valeur est faible, plus elle est proche de l'objectif, et 0,3 dB est le seuil d'avertissement de précision.
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## Group Delay PEQ

Group Delay PEQ est la version paramétrique de Group Delay EQ. Au lieu de quinze curseurs fixes, il propose cinq bandes librement placées, chacune avec sa forme, sa fréquence, son retard et son Q. Les bandes actives sont additionnées en une seule courbe de retard cible, et le plugin construit un unique filtre FIR conçu pour réaliser cette courbe avec une réponse en amplitude plate. Une réponse plate est l'objectif de conception, pas une garantie : un nombre fini de Taps ne fait qu'approcher la cible idéale, et des retards importants ou des formes très étroites peuvent produire une ondulation d'amplitude mesurable. Utilisez-le lorsque l'erreur temporelle à corriger a une forme connue — un filtre de coupure, une enceinte bass-reflex, un passe-haut raide ou une résonance — car une ou deux bandes suffisent alors à reproduire exactement cette forme. Le plugin nécessite le moteur WASM DSP ; sans lui, le signal passe sans modification.

Seules les différences entre fréquences comptent pour le son. Un filtre qui retarde tout de la même façon n'est qu'un simple délai : le plugin conserve donc un retard interne fixe et vous laisse avancer ou retarder chaque zone autour de lui. Tant que toutes les bandes actives sont à 0 ms, le plugin est totalement transparent et n'ajoute aucune latence. Comme la réponse en amplitude reste plate, l'effet est subtil : il modifie le temps, pas le timbre, et se manifeste surtout sur les transitoires — batterie, cordes pincées, attaques de piano.

### Guide d'amélioration du son

- **Recopier un filtre connu avec Filter GD**: Une section analogique du second ordre présente une bosse de temps de propagation de groupe dont la forme est fixée par sa fréquence de coupure et son Q. Saisissez ces deux valeurs dans Freq et Q, puis réglez Delay sur la hauteur mesurée de la bosse avec le signe négatif : la bande l'annule. Un caisson clos ou une somme LR2 demandent une bande ; un alignement bass-reflex du quatrième ordre ou une somme LR4 se couvrent avec une ou deux.
- **Aligner toute une zone avec les shelves**: Lorsqu'une partie du spectre arrive en retard dans son ensemble, et non autour d'une seule fréquence, utilisez Low Shelf ou High Shelf avec un Q de 2 à 4. On obtient une marche large d'environ une octave, si bien que tout ce qui se trouve d'un côté de la fréquence de coupure est décalé de la même valeur.
- **Retoucher le reste avec Peak**: Peak est une cloche douce dont la largeur à mi-hauteur suit Q exactement comme dans un égaliseur paramétrique. Utilisez-la pour les bosses résiduelles qu'aucune forme de filtre précise n'explique.
- **Rester réaliste sur les coupures d'aigus**: Un filtre de coupure LR4 à 3 kHz ne présente qu'un pic de temps de propagation de groupe d'environ 0,2 ms. Le corriger reste sous le seuil d'audibilité : le gain y est donc minime, alors que les erreurs temporelles dans le grave comptent bien davantage.
- **Le grave et les Q élevés exigent des filtres longs**: Corriger une résonance grave avec un Q élevé, autour de Q 8, demande 32768 taps à 96 kHz. Surveillez les deux courbes : si la verte ne peut pas suivre la grise, augmentez Taps ou réduisez Q.
- **Procédez bande par bande**: Modifiez une bande à la fois et écoutez. Les changements purement de phase sont subtils sur la plupart des programmes, et la comparaison avec l'effet désactivé en dit plus que le graphique seul.

### Paramètres

- **Type** - Sélectionne la forme de retard de la bande. Les quatre types sont décrits par les trois mêmes valeurs, Freq, Delay et Q, et Delay est toujours la valeur extrême de la courbe propre à cette bande.
  - **Peak** - Une cloche centrée sur Freq dont la largeur à mi-hauteur correspond à la bande passante impliquée par Q. Elle ne dépasse jamais, ce qui en fait le choix naturel pour les corrections de forme libre et les retouches de résidu.
  - **Low Shelf** - Une marche douce qui maintient Delay sous Freq, passe par la moitié de Delay à Freq et retombe à zéro au-dessus. Q règle la raideur de la transition : à Q 1, elle coïncide avec la transition de temps de propagation de groupe d'un passe-tout du premier ordre, tandis qu'un Q de 2 à 4 donne la marche pratique d'environ une octave utilisée pour l'alignement limité en bande.
  - **High Shelf** - L'image miroir de Low Shelf, et son complément : à Freq et Q identiques, les deux formes s'additionnent en un Delay constant.
  - **Filter GD** - Ajoute ou retranche telle quelle la forme du temps de propagation de groupe d'un étage de filtre analogique (passe-haut, filtre de coupure ou résonance). Saisissez dans Freq et Q la fréquence de coupure et le Q du filtre à corriger, et dans Delay la hauteur de la bosse relevée sur la courbe de temps de propagation de groupe mesurée, avec une valeur négative pour l'annuler.
- **Freq** - Règle la fréquence de la bande de 20 Hz à 20 kHz. Vers 18 à 20 kHz, la cible est adoucie progressivement jusqu'à zéro, si bien qu'une bande placée près du haut de cette plage a un effet réduit.
- **Delay** - Règle en millisecondes la valeur extrême de la courbe propre à cette bande. Les valeurs positives font arriver la zone plus tard, les négatives plus tôt. La plage couvre tout le retard que le filtre peut contenir : à 96 kHz, ±18,6 ms avec 4096 taps et ±149,3 ms avec 32768 taps. Un changement de Taps ou de fréquence d'échantillonnage ramène les valeurs enregistrées à la nouvelle limite.
- **Q** - Règle la largeur ou la raideur de la forme de 0,1 à 100 sur un curseur logarithmique ; tous les Type l'utilisent. Les plages utiles diffèrent : de 0,25 à 16 pour Low Shelf et High Shelf, de 0,1 à 10 pour Filter GD. En pratique, les shelves s'emploient à Q 2 à 4 et Filter GD à Q 0,5 à 8 — 0,5 correspond à un passe-tout du premier ordre ou à une somme LR2, 0,7071 à un alignement Butterworth ou à une somme LR4, et 8 à une résonance étroite. Les réglages hors de ces plages sont acceptés ; la ligne d'état signale lorsque les Taps actuels ne peuvent pas les réaliser.
- **Enabled** - Active ou désactive chacune des cinq bandes. Les bandes désactivées n'apportent rien à la courbe cible et apparaissent estompées sur le graphique.
- **Taps** - Longueur du FIR : 4096, 8192, 16384 ou 32768. Les basses fréquences exigent un filtre long, et les formes à Q élevé également. Taps détermine aussi le retard que le filtre peut contenir, donc la portée de Delay. Plus de taps signifie plus de latence et plus de calcul.
- **Latency** - Latence de tête du moteur de convolution : 0, 128, 256, 512 ou 1024 samples. Des valeurs plus faibles réduisent le retard mais demandent plus de calcul.

La latence totale vaut le réglage Latency plus la moitié des Taps. Elle ne change pas quand vous modifiez les bandes : seul un changement de Taps ou de Latency modifie le retard de toute la chaîne.

### Affichage visuel

- La courbe grise est la cible : la somme des formes des bandes actives, tracée sur un axe logarithmique des fréquences. L'axe des retards se remet à l'échelle selon les réglages en cours, à partir de ±5 ms.
- La courbe verte est ce que le filtre conçu réalise réellement. Là où les deux se superposent, le réglage est pleinement réalisé ; là où elles s'écartent, le filtre ne peut pas suivre la demande avec les Taps actuels.
- Les marqueurs numérotés correspondent aux cinq bandes. Faites-les glisser horizontalement pour modifier Freq et verticalement pour modifier Delay. Le marqueur se pose sur la courbe uniquement avec Peak : un shelf passe par la moitié de Delay à Freq, et Filter GD atteint sa valeur extrême en dessous de Freq : juste en dessous à Q élevé, et de plus en plus bas à mesure que Q diminue, jusqu'à ce qu'à un Q d'environ 0,577 ou moins la valeur extrême se situe à l'extrémité grave du graphique.
- La ligne d'état indique la latence totale en samples et en millisecondes, ainsi que l'ondulation d'amplitude du filtre. L'ondulation mesure l'écart entre la réponse en amplitude réalisée et l'objectif de conception plat : plus la valeur est faible, plus elle est proche de l'objectif, et 0,3 dB est le seuil d'avertissement de précision.
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## Hi Pass Filter
Un filtre passe-haut de précision qui élimine les basses fréquences indésirables tout en préservant la clarté des fréquences élevées. Basé sur le design de filtre Linkwitz-Riley pour une réponse en phase optimale et une qualité sonore transparente.

### Guide d'Amélioration de l'Écoute
- Éliminez les grondements indésirables:
  - Réglez la fréquence entre 20-40Hz pour éliminer le bruit subsonique
  - Utilisez des pentes plus raides (-24dB/oct ou plus) pour des basses plus propres
  - Idéal pour les enregistrements vinyles ou les performances live avec des vibrations scéniques
- Nettoyez la musique à dominante basse:
  - Réglez la fréquence entre 60-100Hz pour resserrer la réponse des basses
  - Utilisez des pentes modérées (-12dB/oct à -24dB/oct) pour une transition naturelle
  - Aide à prévenir la surcharge des enceintes et améliore la clarté
- Créez des effets spéciaux:
  - Réglez la fréquence entre 200-500Hz pour un effet de voix plus mince avec les basses coupées
  - Utilisez des pentes raides (-48dB/oct ou plus) pour un filtrage dramatique
  - Pour un effet de voix façon téléphone, combinez avec Lo Pass Filter autour de 3-4kHz

### Paramètres
- **Frequency (Hz)** - Contrôle l'endroit où les basses fréquences sont filtrées (10Hz à 40000Hz ; la limite supérieure effective dépend aussi de la fréquence d'échantillonnage audio)
  - Valeurs inférieures : Seules les fréquences les plus basses sont supprimées
  - Valeurs supérieures : Davantage de basses fréquences sont supprimées
  - Réglez en fonction du contenu en basses fréquences spécifique que vous souhaitez éliminer
- **Slope** - Contrôle la rapidité avec laquelle les fréquences en dessous du seuil sont atténuées
  - Off : Aucun filtrage appliqué
  - -12dB/oct : Filtrage doux (LR2 - filtre Linkwitz-Riley du 2ème ordre)
  - -24dB/oct : Filtrage standard (LR4 - filtre Linkwitz-Riley du 4ème ordre)
  - -36dB/oct : Filtrage plus marqué (LR6 - filtre Linkwitz-Riley du 6ème ordre)
  - -48dB/oct : Filtrage très marqué (LR8 - filtre Linkwitz-Riley du 8ème ordre)
  - -60dB/oct à -96dB/oct : Filtrage extrêmement raide pour des applications spéciales

### Affichage Visuel
- Graphique de réponse en fréquence en temps réel avec échelle logarithmique
- Visualisation claire de la pente du filtre et du point de coupure
- Contrôles interactifs pour un réglage précis
- Grille de fréquences avec repères aux points de référence clés
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## Lo Pass Filter
Un filtre passe-bas de précision qui élimine les hautes fréquences indésirables tout en préservant la chaleur et le corps des fréquences basses. Basé sur le design de filtre Linkwitz-Riley pour une réponse en phase optimale et une qualité sonore transparente.

### Guide d'Amélioration de l'Écoute
- Réduisez la dureté et la sibilance:
  - Réglez la fréquence entre 8-12kHz pour dompter les enregistrements agressifs
  - Utilisez des pentes modérées (-12dB/oct à -24dB/oct) pour un son naturel
  - Aide à réduire la fatigue auditive avec des enregistrements brillants
- Réchauffez les enregistrements numériques:
  - Réglez la fréquence entre 12-16kHz pour atténuer le tranchant numérique
  - Utilisez des pentes douces (-12dB/oct) pour un effet de réchauffement subtil
  - Crée un caractère sonore plus analogique
- Créez des effets spéciaux:
  - Réglez la fréquence entre 1-3kHz avec une pente raide pour un caractère étouffé et étroit
  - Utilisez des pentes raides (-48dB/oct ou plus) pour un filtrage dramatique
  - Pour un effet de radio vintage, combinez avec Hi Pass Filter afin de retirer aussi les basses fréquences
- Contrôlez le bruit et le sifflement:
  - Réglez la fréquence juste au-dessus du contenu musical (typiquement 14-18kHz)
  - Utilisez des pentes plus raides (-36dB/oct ou plus) pour un contrôle efficace du bruit
  - Réduit le sifflement des cassettes ou le bruit de fond tout en préservant l'essentiel du contenu musical

### Paramètres
- **Frequency (Hz)** - Contrôle l'endroit où les hautes fréquences sont supprimées (10Hz à 40000Hz ; la limite supérieure effective dépend aussi de la fréquence d'échantillonnage audio)
  - Valeurs inférieures : Davantage de hautes fréquences sont supprimées
  - Valeurs supérieures : Seules les toutes plus hautes fréquences sont supprimées
  - Réglez en fonction du contenu en hautes fréquences spécifique que vous souhaitez éliminer
- **Slope** - Contrôle l'agressivité de la réduction des fréquences au-dessus du seuil de coupure
  - Off : Aucun filtrage appliqué
  - -12dB/oct : Filtrage doux (LR2 - filtre Linkwitz-Riley du 2ème ordre)
  - -24dB/oct : Filtrage standard (LR4 - filtre Linkwitz-Riley du 4ème ordre)
  - -36dB/oct : Filtrage plus marqué (LR6 - filtre Linkwitz-Riley du 6ème ordre)
  - -48dB/oct : Filtrage très marqué (LR8 - filtre Linkwitz-Riley du 8ème ordre)
  - -60dB/oct à -96dB/oct : Filtrage extrêmement raide pour des applications spéciales

### Affichage Visuel
- Graphique de réponse en fréquence en temps réel avec échelle logarithmique
- Visualisation claire de la pente du filtre et du point de coupure
- Contrôles interactifs pour un réglage précis
- Grille de fréquences avec repères aux points de référence clés
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## Loudness Equalizer

Un égaliseur spécialisé qui associe le réglage du volume à la correction de l'équilibre fréquentiel. Réglez Average SPL sur le niveau de pression acoustique moyen estimé lorsque Relative Volume vaut 0dB, puis utilisez Relative Volume pour les variations courantes du volume. La correction augmente automatiquement lorsque vous baissez le volume et diminue lorsque vous le montez.

### Guide d'Amélioration de l'Écoute
- Écoute à Faible Volume:
  - Renforce les fréquences de basse et d'aigus
  - Maintient l'équilibre musical à des niveaux bas
  - Compense les caractéristiques de l'audition humaine
- Réglage Average SPL:
  - Réglez-le sur le niveau de pression acoustique moyen estimé avec Relative Volume à 0dB
  - Il s'agit d'une valeur de référence manuelle ; le plugin ne mesure pas le SPL
- Réglage Relative Volume:
  - Les valeurs négatives réduisent le niveau de sortie et renforcent la correction
  - Les valeurs positives augmentent le niveau de sortie et réduisent la correction
  - La correction d'EQ est calculée à partir de `Average SPL + Relative Volume` et reste limitée à la plage de correction de 60dB à 85dB
- Équilibre des Fréquences:
  - Étagère basse pour l'amélioration des basses (100-300Hz)
  - Étagère haute pour l'amélioration des aigus (3-6kHz)
  - Transition fluide entre les plages de fréquences

### Préréglages système

Cliquez sur **Préréglages d’effet** dans l’en-tête de l’effet pour partir d’une courbe complète de compensation de sonie.

- **Late Night Listening** - Une compensation plus forte pour une écoute à faible volume.
- **Quiet Background** - Une courbe de compensation modérée pour l’écoute courante.
- **Near Reference Level** - Une compensation minimale à proximité d’un niveau de référence plus élevé.

### Paramètres
- **Average SPL** - Niveau de pression acoustique moyen estimé avec Relative Volume à 0dB (60dB à 96dB)
  - Réglez-le manuellement selon le niveau moyen à votre position d'écoute
  - Les valeurs supérieures à 85dB permettent de définir une référence plus élevée ; la correction d'EQ reste inactive tant que `Average SPL + Relative Volume` ne descend pas sous 85dB
- **Relative Volume** - Réglage du volume par rapport à Average SPL (-30dB à +12dB)
  - 0dB : Niveau de sortie correspondant à Average SPL
  - Valeurs négatives : Volume plus faible et correction physiologique plus forte
  - Valeurs positives : Volume plus élevé et correction physiologique plus faible
  - Les valeurs positives peuvent provoquer un écrêtage si l'entrée ou l'accentuation de l'EQ est déjà élevée
- **Contrôles des Basses Fréquences**
  - Frequency: Centre d'amélioration des basses (100Hz à 300Hz)
  - Gain: Boost maximal des basses (0dB à 15dB)
  - Q: Forme de l'amélioration des basses (0.5 à 1.0)
- **Contrôles des Hautes Fréquences**
  - Frequency: Centre d'amélioration des aigus (3kHz à 6kHz)
  - Gain: Boost maximal des aigus (0dB à 15dB)
  - Q: Forme de l'amélioration des aigus (0.5 à 1.0)

### Affichage Visuel
- Graphique de réponse de l'EQ en temps réel
- Contrôles interactifs des paramètres
- Courbe de correction dépendante du volume ; la variation uniforme de niveau due à Relative Volume n'est pas représentée
- Affichages numériques précis
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## Narrow Range
Un outil qui vous permet de vous concentrer sur des parties spécifiques de la musique en filtrant les fréquences indésirables. Utile pour créer des effets sonores spéciaux ou éliminer des sons indésirables.

### Guide d'Amélioration de l'Écoute
- Créez des effets sonores uniques:
  - Effet « voix de téléphone »
  - Son « vieille radio »
  - Effet « sous-marin »
- Concentrez-vous sur une plage de fréquences:
  - Rendez les parties chargées en basses plus faciles à entendre
  - Concentrez-vous sur la plage vocale
  - Réduisez le son à la plage où les voix ou instruments sont les plus perceptibles
- Éliminez les sons indésirables:
  - Réduisez le grondement des basses fréquences
  - Coupez le sifflement excessif des hautes fréquences
  - Concentrez-vous sur la plage que vous voulez entendre le plus clairement

### Paramètres
- **HPF Frequency** - Contrôle l'endroit où les sons bas commencent à être réduits (20Hz à 4000Hz)
  - Valeurs supérieures : Élimine davantage de basses
  - Valeurs inférieures : Conserve plus de basses
  - Commencez avec de faibles valeurs et ajustez selon vos préférences
- **HPF Slope** - Contrôle la rapidité avec laquelle les sons bas sont atténués (0 à -48 dB/octave)
  - 0dB : Aucune réduction (off)
  - -6dB à -48dB : Réduction de plus en plus forte par paliers de 6dB
- **LPF Frequency** - Contrôle l'endroit où les sons aigus commencent à être réduits (200Hz à 40000Hz)
  - Valeurs inférieures : Élimine davantage d'aigus
  - Valeurs supérieures : Conserve plus d'aigus
  - Commencez par une valeur élevée et ajustez à la baisse si nécessaire
- **LPF Slope** - Contrôle la rapidité avec laquelle les sons aigus sont atténués (0 à -48 dB/octave)
  - 0dB : Aucune réduction (off)
  - -6dB à -48dB : Réduction de plus en plus forte par paliers de 6dB

### Affichage Visuel
- Graphique clair montrant la réponse en fréquence
- Contrôles de fréquence faciles à ajuster
- Menus simples de sélection de pente
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## Room EQ

Room EQ crée des filtres de correction FIR à partir des mesures de réponse en fréquence enregistrées dans EffeTune. Par défaut, il conçoit un seul filtre partagé et l'applique à tous les canaux routés vers le plugin ; vous pouvez aussi attribuer une mesure enregistrée distincte à certains canaux, les autres réglages de correction restant communs à toute l'instance. Le filtre fait la moyenne de tous les points de la mesure choisie, lisse la courbe et réduit les bosses et les creux dans la plage de fréquences sélectionnée. Utilisez-le lorsque l'interaction entre les enceintes et la pièce produit, à votre place d'écoute, des bosses reproductibles ou un déséquilibre tonal général. En plus de la correction d'amplitude à phase minimale ou linéaire, le mode **Correction** peut corriger la phase excédentaire mesurée du son direct (**Phase Correction**) et de la réverbération de la pièce (**Reverb Correction**). Room EQ nécessite le moteur DSP WASM ; sans lui, le signal traverse le plugin sans modification.

### Guide d'amélioration sonore

- **Mesure multipoint**: Mesurez l'enceinte ou le groupe de canaux depuis plusieurs positions de microphone proches autour de votre place d'écoute, puis sélectionnez cette mesure enregistrée, afin que la correction ne s'ajuste pas excessivement à une seule position du microphone.
- **Réglages de départ**: Commencez avec **Phase: Minimum**, **Smoothing: 0.17 oct**, **Correction Low: 80 Hz**, **Correction High: 16000 Hz**, **Max Boost: 6 dB** et **Level Correction: 100%**. Activez et désactivez l'effet pour vérifier que l'équilibre tonal devient plus régulier sans paraître maigre ni agressif.
- **Ne pas trop relever les creux**: Si le filtre tente de combler des annulations acoustiques étroites, augmentez **Smoothing** ou baissez **Max Boost** (0 dB désactive les relèvements automatiques tout en conservant l'atténuation des bosses).
- **Doser l'intensité de la correction**: Baissez **Level Correction** si 100% paraît trop prononcé (50% ramène un relèvement de +6 dB à +3 dB et une atténuation de −8 dB à −4 dB).
- **Plage fiable uniquement**: Gardez **Correction Low** et **Correction High** dans la plage que votre enceinte et votre microphone de mesure reproduisent de manière fiable ; corriger au-delà rend le résultat moins précis.
- **Façonner la cible**: Une fois les bosses de la pièce maîtrisées, utilisez **Additional EQ** (intégré directement au filtre FIR) pour des préférences tonales douces, comme un Low shelf large de +2 dB vers 100 Hz.
- **Correction de la phase excédentaire et de la réverbération**: Choisissez **Phase: Minimum** pour la latence la plus faible, ou **Phase: Correction** pour aligner aussi la phase excédentaire. Commencez avec **Reference Point: Consensus (all points)**, la valeur par défaut de **Direct Window** et **Phase Correction: 100%**. N'activez **Low-frequency Phase Extension** que si vous voulez corriger la phase excédentaire sous **Phase Low**, et désactivez-la si le calage temporel du grave devient moins homogène d'une position d'écoute à l'autre. Augmentez progressivement **Reverb Correction** avec **Reverb Max Freq: 250 Hz** pour contrer la réverbération des basses fréquences dans toute la zone d'écoute ; augmenter **Reverb Max Freq** fait du résultat une optimisation pour la seule position mesurée.
- **Retard manuel**: Room EQ ne calcule pas l'alignement lié à la distance des enceintes. **Delay** s'applique à tous les canaux de l'instance ; utilisez des instances Room EQ séparées si des groupes de canaux ont besoin de retards manuels différents.

> **Partager des mesures entre appareils**: Les presets et les URL enregistrent le nom et l'identifiant de la mesure, pas les données acoustiques. Pour transférer une mesure vers un autre appareil, exportez-la depuis l'outil de mesure avec **Inclure les réponses impulsionnelles dans les exports JSON de mesure** activé (valeur par défaut ; le fichier peut grossir de plusieurs dizaines de mégaoctets), puis importez le fichier JSON sur l'appareil cible. Si la mesure sélectionnée est introuvable, Room EQ affiche un avertissement et laisse passer le signal sans correction.

### Paramètres

- **Measurement** - Sélectionne la mesure enregistrée partagée (avec son nom, son nombre de points et `IR` lorsque des données de réponse impulsionnelle sont présentes). Cliquez sur **Refresh measurements** après avoir ajouté ou modifié des mesures.
- **Measurement ChN** - Mesure facultative propre à chaque canal de bus routé. Laissez **(Shared)** pour utiliser la **Measurement** partagée.
- **Delay** (0 à 20 ms) - Retard manuel appliqué à tous les canaux routés ; il n'est pas inclus dans la latence de traitement indiquée.
- **Phase** - Sélectionne le comportement de phase du FIR :
  - **Minimum**: Correction d'amplitude à phase minimale, avec la latence la plus faible.
  - **Linear**: Correction d'amplitude à phase linéaire (ajoute `Taps / 2` samples de retard).
  - **Correction**: Correction d'amplitude à phase minimale, plus une correction de la phase excédentaire du son direct (**Phase Correction** dans **Direct Window**) et, en option, de la décroissance de la pièce (**Reverb Correction** dans **Reverb Window**). Ajoute `Taps / 2` samples de retard et nécessite des données de réponse impulsionnelle (`IR`). **Phase Smoothing**, **Phase Low**, **Low-frequency Phase Extension**, **Phase Correction**, les quatre réglages Reverb et **Reference Point** n'agissent que dans ce mode ; en Minimum et Linear, ils sont désactivés et conservent leurs valeurs.
- **Taps** (8192, 16384, 32768, 65536 ou 131072) - Longueur du filtre FIR. Des valeurs plus élevées améliorent la résolution dans le grave, au prix de la mémoire, du temps de conception et du retard en modes Linear/Correction.
- **Latency** (0, 128, 256, 512 ou 1024 samples) - Latence du premier bloc de convolution. Des valeurs plus faibles réduisent le retard mais augmentent la charge de traitement.
- **Smoothing** (0,02 à 1,00 oct) - Lissage fréquentiel gaussien de la correction d'amplitude. Des valeurs plus élevées donnent une correction plus large et plus prudente ; des valeurs plus faibles suivent des variations plus fines de la réponse.
- **Phase Smoothing** (0,02 à 1,00 oct, ou **Auto**) - Lissage gaussien de la correction de phase excédentaire du son direct en mode Correction (suit **Smoothing** lorsque **Auto** est coché).
- **Correction Low / Correction High** - Limites basse et haute de la correction automatique.
- **Direct Window** (1 à 50 ms) - Fenêtre temporelle analysée après l'attaque pour la correction de phase du son direct. Une fenêtre plus longue abaisse la valeur automatique de **Phase Low**, mais inclut davantage de réflexions de la pièce.
- **Phase Low** (20 à 20000 Hz, ou **Auto**) - Limite basse de la correction de phase du son direct à fenêtre fixe (par défaut, la plus élevée entre **Correction Low** et la fréquence dont trois périodes tiennent dans **Direct Window**, par exemple 500 Hz pour 6 ms). Lorsque **Low-frequency Phase Extension** est activé, il marque plutôt la limite où la fenêtre fixe cède la place à des fenêtres plus longues pour le grave.
- **Low-frequency Phase Extension** (désactivé par défaut) - Prolonge la correction de phase excédentaire sous **Phase Low** jusque vers **Correction Low**, avec des fenêtres de plus en plus longues selon la fréquence.
- **Max Boost** (0 à 18 dB) - Plafonne les relèvements de la correction automatique avant lissage, sans limiter les atténuations ni les relèvements volontaires de **Additional EQ**.
- **Level Correction** (0% à 100%) - Met à l'échelle la correction d'amplitude automatique, linéairement en dB. À 0%, seule la correction automatique s'arrête ; **Phase Correction**, **Additional EQ**, **Delay** et **Gain** restent actifs.
- **Phase Correction** (0% à 100%) - Met à l'échelle la correction de phase excédentaire du son direct en mode Correction, indépendamment de **Reverb Correction**.
- **Reverb Correction** (0% à 100% ; 0% par défaut) - Met à l'échelle la correction de phase excédentaire de la réverbération plus tardive de la pièce, analysée dans **Reverb Window** jusqu'à **Reverb Max Freq**. Elle ne modifie pas la correction d'amplitude.
- **Reverb Window** (20 à 1000 ms) - Fenêtre temporelle analysée après l'attaque par **Reverb Correction**. Si elle n'est pas plus longue que **Direct Window** (ou si la mesure est trop courte), seule la correction de la réverbération est ignorée, avec un avertissement, et le reste du filtre reste actif.
- **Reverb Max Freq** (20 à 20000 Hz ; 250 Hz par défaut) - Limite haute de **Reverb Correction**, plafonnée par **Correction High** (vers 250 Hz, elle se concentre sur la décroissance grave de la pièce, qui se comporte de façon homogène entre places voisines).
- **Reverb Smoothing** (0,02 à 1,00 oct) - Lissage gaussien appliqué au retard de phase excédentaire de la réverbération.
- **Reference Point** - Sélectionne **Consensus (all points)** (moyenne des points de mesure pondérée par leur fiabilité) ou un seul point de mesure pour l'analyse de la phase excédentaire. Si le point sélectionné est supprimé, le réglage revient à Consensus.
- **Additional EQ (folded into FIR)** - Cinq bandes paramétriques de façonnage de la cible (Peak, Low shelf, High shelf ; 20 Hz–20 kHz, ±20 dB, Q 0,1–10, jusqu'à 2 pour les shelves) intégrées directement au filtre FIR. Leur phase est nulle en mode Linear et minimale en modes Minimum et Correction.
- **Gain** (-12 à +12 dB) - Ajustement du niveau de sortie.

### Affichage visuel

- **Graph**: Bascule entre **Frequency** (mesure lissée en gris clair, correction automatique en vert pâle, correction combinée avec Additional EQ en vert vif, et réponse corrigée estimée en blanc, qui est un aperçu calculé et non une nouvelle mesure), **Phase** (−180° à +180° avant et après le FIR), **Min Group Delay**, **Excess Group Delay** et **Impulse** (forme d'onde normalisée avant et après le FIR, de 2 ms avant l'attaque mesurée jusqu'à la plus longue des durées suivantes : 5 ms, **Direct Window** et, lorsque **Reverb Correction** dépasse 0%, **Reverb Window** dans la limite de 50 ms). Dans les vues Phase, temps de propagation de groupe et Impulse, la ligne grise **Before** est la réponse avant correction et la ligne verte **After** le résultat calculé après le FIR. Deux lignes verticales pointillées blanches marquent **Correction Low** et **Correction High**.
- Dans la vue Frequency, les courbes grise et blanche sont décalées de sorte que le niveau cible de la correction automatique complète (100%) se trouve à 0 dB ; les écarts qui subsistent dans la courbe blanche proviennent de limites comme **Max Boost** ou une **Level Correction** inférieure à 100%, ou d'un façonnage volontaire par **Additional EQ**.
- Les vues Phase, temps de propagation de groupe et Impulse retirent l'attaque mesurée, et le retard fixe du FIR est retiré du résultat corrigé. Le temps de propagation de groupe n'est pas recalé à 1 kHz : il ne vaut donc pas forcément 0 ms à cette fréquence. **Min Group Delay** ajuste son échelle automatiquement ; **Excess Group Delay** reste entre −100 et +100 ms, mais la lecture indique aussi les valeurs hors de cette plage. Sans données de réponse impulsionnelle, ces vues affichent un message d'indisponibilité.
- **Graph Preview Ch**: Apparaît lorsque des filtres sont conçus pour plusieurs canaux ; choisit le canal dont les courbes sont affichées, sans effet sur le son.
- **Contrôles interactifs**: Faites glisser les marqueurs numérotés horizontalement pour modifier la fréquence d'une bande de **Additional EQ** et verticalement pour modifier son gain (les bandes désactivées apparaissent estompées), et survolez le graphique ou faites glisser dessus pour lire les valeurs en tout point.
- La ligne d'état sous les contrôles indique la latence de traitement totale, la résolution du FIR et si le filtre est contourné, en attente, en préparation, actif ou en erreur.

## Tilt EQ

Incline l'équilibre fréquentiel global autour d'une fréquence pivot à l'aide d'une paire de filtres en plateau appariés : un côté du spectre est relevé et l'autre abaissé. Utilisez-le pour rendre le son globalement plus chaud ou plus brillant avec un seul réglage, par exemple lorsqu'un enregistrement ou un casque sonne systématiquement trop brillant ou trop terne.

### Guide d'amélioration sonore
- **Plus chaud**: Utilisez une petite valeur négative de **Slope** (par exemple -1 dB/oct) pour abaisser les aigus et relever les graves, par exemple pour des enregistrements ou un casque brillants.
- **Plus brillant**: Utilisez une petite valeur positive de **Slope** (par exemple +1 dB/oct) pour relever les aigus et abaisser les graves, par exemple pour des enregistrements ou des enceintes ternes.
- **Où commence le changement**: Baissez **Pivot Freq (Hz)** pour étendre le changement côté aigus jusque dans les médiums ; montez-la pour le limiter aux dernières octaves.

### Paramètres
- **Pivot Freq (Hz)** (20 Hz à ~20 kHz ; environ 1 kHz par défaut) - Fréquence autour de laquelle l'équilibre s'incline.
- **Slope** (-12 à +12 dB/oct ; 0 par défaut) - Intensité et sens de l'inclinaison. Les valeurs positives rendent le son plus brillant, les valeurs négatives plus chaud, et 0 le laisse inchangé.

### Affichage visuel
- Le graphique montre la réponse en fréquence obtenue.
- **Reset** ramène les deux paramètres à leurs valeurs par défaut.
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## Tonal Balance EQ

Mesure l'équilibre tonal à long terme de ce qui est en cours de lecture et l'oriente en douceur vers l'équilibre spectral typique de la musique publiée dans le style choisi. Utilisez-le lorsque les morceaux d'une playlist, d'un album ou d'un flux sonnent régulièrement trop sombres, trop brillants, trop gonflés dans le grave ou trop maigres, et que vous voulez les homogénéiser automatiquement sans régler un EQ à la main pour chaque morceau. (Il corrige l'équilibre de l'enregistrement, pas vos enceintes ni votre pièce ; pour la correction acoustique, utilisez [Room EQ](#room-eq).)

Le plugin compare le spectre mesuré à la cible après avoir aligné la sonie globale, atténue les zones trop présentes et applique un gain de compensation unique, si bien que les zones plus faibles ressortent sans que la sonie perçue change. Il exclut les silences et les pauses de la mesure et ne relève ni le souffle ni les bandes stables proches du bruit (y compris une nappe de synthé tenue), afin que les extrémités vides du spectre ne soient pas amplifiées artificiellement. Tous les canaux reçoivent la même correction sans latence, ce qui préserve l'image stéréo.

### Guide d'amélioration sonore
- **Playlists variées et streaming**: Commencez avec les valeurs par défaut (**Target: All**, **Amount: 100%**, **Averaging Time: 30 s**). La correction se met en place en quelques dizaines de secondes, à mesure que la mesure devient fiable : laissez donc la musique jouer une trentaine de secondes avant de comparer avec le bypass.
- **Une correction stable pour tout un album**: Cliquez sur **Reset** au début de l'album et réglez **Averaging Time** sur **∞** : la correction fait la moyenne de toute la session d'écoute et se stabilise en une courbe fixe.
- **Cibles par genre**: Choisissez **Classical**, **Electronic**, **Pop** ou **Rock** pour un style précis, ou **All** pour une écoute variée.
- **Un façonnage plus doux**: Baissez **Amount** (par exemple 50%), réduisez **Range** (par exemple 3 dB) ou montez **Smoothing** (par exemple 1 oct) pour des inclinaisons larges et discrètes.
- **Votre propre courbe de référence**: Utilisez les cinq bandes de **Target Adjust** sous le graphique pour incliner ou modeler la cible selon vos goûts (par exemple un High shelf de +1,5 dB à 8 kHz). Chaque enregistrement n'est alors corrigé vers votre cible que dans la mesure nécessaire.
- **Référence à pente fixe**: Sélectionnez **Target: Tilt** pour une réponse plate sous **Corner**, suivie d'une décroissance constante selon **Slope** (−5 dB/oct correspond approximativement aux masters commerciaux typiques ; −3 dB/oct correspond au bruit rose).

Le gain de compensation préserve la sonie, pas le niveau de crête : les crêtes peuvent donc monter. Si un étage suivant écrête, baissez le niveau après ce plugin ou ajoutez un limiteur.

### Paramètres
- **Target** - Équilibre tonal visé : **All** (par défaut, mélange à parts égales des quatre styles), **Classical**, **Electronic**, **Pop**, **Rock** ou **Tilt** (référence à pente fixe).
- **Slope** (-18 à 0 dB/oct ; -6 dB/oct par défaut ; mode Tilt uniquement) - Pente de décroissance au-dessus de **Corner** (-3 dB/oct = bruit rose, ~-5 dB/oct = productions commerciales typiques). Des valeurs plus douces demandent davantage d'aigus ; la valeur par défaut demande un équilibre un peu plus sombre que la musique typique.
- **Corner** (20 à 1000 Hz ; 250 Hz par défaut ; mode Tilt uniquement) - Fréquence en dessous de laquelle la cible **Tilt** reste plate. Des valeurs plus basses demandent davantage d'extrême grave ; des valeurs plus hautes, moins de grave.
- **Amount** (0% à 100% ; 100% par défaut) - Intensité globale de la correction. À 0%, le son n'est pas modifié, mais la mesure et le graphique continuent de fonctionner, et **Range**, **Smoothing**, **Low** et **High** sont désactivés.
- **Range** (0 à 12 dB ; 6 dB par défaut) - Ajustement de gain maximal autorisé dans chaque bande, vers le haut comme vers le bas. Des valeurs faibles gardent des changements discrets (0 dB désactive la correction) ; des valeurs élevées permettent de rapprocher de la cible des enregistrements qui en sont éloignés.
- **Smoothing** (0,1667 à 2 oct ; 0,5 oct par défaut) - Largeur des détails de la courbe de correction (des valeurs plus élevées produisent des inclinaisons plus larges).
- **Averaging Time** (0,1 s à ∞ ; 30 s par défaut) - Fenêtre d'intégration de la mesure. Des valeurs courtes (par exemple 0,5 à 1 s) suivent les changements au sein d'un morceau, comme un couplet sombre suivi d'un refrain brillant ; des valeurs longues donnent une correction stable (**∞** fait la moyenne en continu depuis le dernier **Reset**).
- **Low** (20 à 200 Hz ; 20 Hz par défaut) / **High** (2000 à 20000 Hz ; 16000 Hz par défaut) - Limites basse et haute du remodelage actif (au-delà, la correction reste constante). Montez **Low** pour laisser l'extrême grave intact, ou baissez **High** pour laisser l'octave la plus aiguë intacte.
- **Average SPL** (60 à 96 dB ; 83 dB par défaut) - Niveau d'écoute estimé, utilisé pour déterminer quelles bandes faibles sont assez audibles pour être relevées ; il ne modifie pas le niveau de sortie. Des valeurs plus basses considèrent davantage de bandes faibles comme inaudibles, qui ne sont donc pas relevées ; des valeurs plus hautes en comptent davantage comme audibles.
- **Target Adjust** - Cinq bandes paramétriques (Peak, Low shelf, High shelf ; 20 Hz–20 kHz, ±20 dB, Q 0,1–10, jusqu'à 2 pour les shelves ; Q 0,7 par défaut) qui remodèlent la courbe cible. Un gain positif demande davantage de cette zone, un gain négatif moins.

**Target Adjust** ne modifie que la cible ; chaque enregistrement reste corrigé vers elle dans les limites de **Amount** et **Range**, si bien qu'un ajustement important peut nécessiter un **Range** plus grand. Relever toute la cible d'une même valeur ne change rien, car les niveaux globaux sont alignés avant la comparaison. Les pics et les creux étroits sont lissés ; pour les retouches étroites, utilisez 5Band PEQ.

### Affichage visuel
- L'axe horizontal représente la fréquence, d'environ 26 Hz à 18,6 kHz, et l'axe vertical le niveau en dB, affiché par hertz : le bruit rose apparaît donc comme une droite descendant à -3 dB/oct. L'échelle verticale s'élargit pour contenir les courbes et revient à ±12 dB après **Reset** ou un changement de **Target**. Les zones sous **Low** et au-dessus de **High** sont estompées.
- **Target** est l'équilibre visé, Target Adjust compris. Pour un style, la bande ombrée montre la dispersion typique entre les morceaux, apprise à partir des spectres à long terme d'une collection musicale ; **Tilt** n'en a pas.
- **Measured** est la ligne à points : le spectre à long terme mesuré, aligné sur la cible. Là où elle passe sous la bande de la cible, l'enregistrement est plus faible que la normale dans cette zone ; au-dessus, il est plus fort. La mesure est suspendue pendant la pré-écoute d'une fréquence.
- **EQ response** est la ligne épaisse : le gain appliqué, gain de compensation compris (0 dB = aucun changement).
- **Withheld lift** est la zone ombrée qui montre approximativement le relèvement supplémentaire qu'une bande recevrait si elle n'était pas retenue comme contenu proche du bruit ou non musical.
- **Target adjust** est la courbe fine autour de 0 dB, dont les poignées numérotées montrent les bandes telles que vous les réglez ; les poignées ne se trouvent pas sur la ligne **Target**. Faites glisser une poignée pour modifier la fréquence et le gain, tournez la molette de la souris au-dessus d'elle pour modifier Q, et faites un clic droit dessus pour activer ou désactiver la bande. Pendant la lecture, la ligne **Target** suit les poignées après un court instant ; à l'arrêt, elle garde sa dernière forme.
- Survolez le graphique ou faites glisser dessus pour lire les valeurs de chaque bande, **Presence** (% du temps reconnu comme contenu musical), **Make-up gain** et la **Loudness** intégrée (LKFS). Tant qu'aucun son n'a été mesuré, le graphique affiche « Play audio to start measuring ».
- **Reset** efface la mesure accumulée ; **Target Adjust** n'est pas modifié. La mesure repart aussi de zéro lorsque le traitement reprend après une pause d'économie d'énergie.
- **Copy as PEQ** copie la courbe EQ response sous forme de réglages 5Band PEQ. Appuyez sur **Ctrl+V** dans l'Effect Pipeline pour l'insérer avant l'effet sélectionné (ou à la fin), puis désactivez Tonal Balance EQ pour figer la correction. La copie reproduit la forme de la courbe entre **Low** et **High**, mais pas son niveau global : la sonie peut donc légèrement différer. Le bouton est disponible dès que le graphique affiche une courbe EQ response et que **Amount** est supérieur à 0%.

## Tone Control

Un ajusteur de son à trois bandes simple pour une personnalisation rapide et facile du son. Parfait pour une mise en forme basique du son sans trop de technicité.

### Guide d'Amélioration Musicale
- Musique Classique:
  - Légère amplification des aigus pour plus de détails dans les cordes
  - Amplification douce des basses pour un son orchestral plus riche
  - Médiums neutres pour un son naturel
- Musique Rock/Pop:
  - Amplification modérée des basses pour plus d'impact
  - Légère réduction des médiums pour un son plus clair
  - Amplification des aigus pour des cymbales nettes et des détails
- Musique Jazz:
  - Basses chaudes pour un son plus riche
  - Médiums clairs pour le détail des instruments
  - Aigus doux pour l'éclat des cymbales
- Musique Électronique:
  - Basses puissantes pour un impact profond
  - Médiums réduits pour un son plus clair
  - Aigus renforcés pour des détails nets

### Paramètres
- **Bass** - Contrôle les sons graves (-24dB à +24dB)
  - Augmentez pour des basses plus puissantes
  - Diminuez pour un son plus léger et plus clair
  - Affecte le « poids » de la musique
- **Mid** - Contrôle le corps principal du son (-24dB à +24dB)
  - Augmentez pour des voix/instruments plus présents
  - Diminuez pour un son plus spacieux
  - Affecte la « plénitude » de la musique
- **Treble** - Contrôle les sons aigus (-24dB à +24dB)
  - Augmentez pour plus d'éclat et de détails
  - Diminuez pour un son plus doux et plus lisse
  - Affecte la « brillance » de la musique

### Affichage Visuel
- Graphique facile à lire montrant vos ajustements
- Curseurs simples pour chaque contrôle
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.
