---
title: "Plugins EQ - EffeTune"
description: "Plugins d'égalisation incluant Parametric EQ, Graphic EQ, Dynamic EQ, 5Band FIR PEQ, Room EQ, Earphone Cable Sim, des filtres et Tone Control."
lang: fr
---

# Plugins d'Égaliseur
Une collection de plugins qui vous permet d'ajuster différents aspects du son de votre musique, des basses profondes aux aigus nets. Ces outils vous aident à personnaliser votre expérience d'écoute en renforçant ou en atténuant certains éléments sonores.

## Liste des Plugins

- [15Band GEQ](#15band-geq) - Réglage détaillé du son avec 15 contrôles précis
- [15Band PEQ](#15band-peq) - Égaliseur paramétrique à 15 bandes pour des réglages détaillés
- [5Band Dynamic EQ](#5band-dynamic-eq) - Égaliseur dynamique qui réagit à votre musique
- [5Band FIR PEQ](#5band-fir-peq) - Égaliseur FIR à cinq bandes pour des réglages raides et stables
- [5Band PEQ](#5band-peq) - Égaliseur paramétrique à cinq bandes avec des contrôles flexibles
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
- [Tilt EQ](#tilt-eq) - Égaliseur d'inclinaison pour un réglage tonal simple
- [Tone Control](#tone-control) - Réglage simple des basses, médiums et aigus

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

## 15Band PEQ

Un égaliseur paramétrique à 15 bandes pour ajuster finement les basses, les voix, la présence et les aigus pendant l'écoute. Utilisez-le lorsque vous voulez plus de contrôle qu'avec un égaliseur graphique, depuis de petits changements de tonalité jusqu'à la recherche d'une fréquence précise qui gêne l'écoute.

### Guide d'Amélioration Sonore
- Clarté des Voix et des Instruments:
  - Réglez une bande autour de 3.2kHz avec un Q modéré (1.0-2.0) pour une présence naturelle
  - Appliquez des coupes avec un Q étroit (4.0-8.0) seulement lorsqu'une résonance précise gêne l'écoute
  - Ajoutez une légère sensation d'air avec une étagère haute 10kHz (+2 à +4dB)
- Contrôle de la Qualité des Basses:
  - Façonnez les fondamentaux avec un filtre en cloche à 100Hz
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
    - En cloche : Réglage symétrique des fréquences
    - Passe Bas/Haut : Pente de 12dB/octave
    - Étagère Bas/Haut : Modelage spectral doux
    - Passe Bande : Isolation ciblée des fréquences
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

### Affichage Technique
- Visualisation de la réponse en fréquence en haute résolution
- Points de contrôle interactifs avec affichage précis des paramètres
- Calcul en temps réel de la fonction de transfert
- Grille de fréquences et de gains calibrée
- Affichages numériques précis pour tous les paramètres

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
- Indicateurs de gain/coupe dynamique par bande
- Contrôles interactifs de Frequency et de Gain

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

- La courbe grise indique la « Cible » combinée correspondant aux réglages actuels des bandes.
- La courbe verte indique la réponse en amplitude réellement obtenue par le FIR conçu. Un écart visible signifie que le réglage Taps ne peut pas reproduire exactement la cible.
- Les marqueurs numérotés correspondent aux cinq bandes. Faites-les glisser horizontalement pour modifier Freq et verticalement pour modifier Gain ; les bandes désactivées apparaissent estompées.
- La ligne d'état indique si le FIR est en cours de conception, de préparation ou d'utilisation, ainsi que la latence totale de traitement en samples et en millisecondes.
- Si le réglage Taps ne peut pas reproduire précisément une réponse extrême, l'état recommande d'augmenter Taps ou de réduire Q ou Slope.

## 5Band PEQ
Un égaliseur paramétrique à cinq bandes avec des contrôles de fréquence détaillés. Il convient aux ajustements subtils du son comme aux corrections ciblées pendant l'écoute.

### Guide d'Amélioration Sonore
- Clarté des Voix et des Instruments:
  - Utilisez Band 4 autour de 3.2kHz avec un Q modéré (1.0-2.0) pour une présence naturelle
  - Appliquez des coupes avec un Q étroit (4.0-8.0) seulement lorsqu'une résonance précise gêne l'écoute
  - Ajoutez une légère sensation d'air avec une étagère haute 10kHz (+2 à +4dB)
- Contrôle de la Qualité des Basses:
  - Façonnez les fondamentaux avec un filtre en cloche à 100Hz
  - Utilisez une coupe étroite si une note de basse ou un boom de pièce ressort trop
  - Créez une extension de basse fluide avec une étagère basse
- Ajustements Fins à l'Écoute:
  - Utilisez de petits boosts ou coupes larges pour des résultats naturels
  - Réservez les réglages étroits aux problèmes ciblés plutôt qu'à la tonalité générale
  - Comparez souvent avec le bypass pour garder une musique équilibrée

### Paramètres
- **Bandes Configurables**
  - Bande 1: 100Hz (Contrôle des Sub et des Basses)
  - Bande 2: 316Hz (Définition des Bas-Médiums)
  - Bande 3: 1.0kHz (Présence des Médiums)
  - Bande 4: 3.2kHz (Détail des Hauts-Médiums)
  - Bande 5: 10kHz (Extension des Hautes Fréquences)
- **Contrôles par Bande**
  - Fréquence Centrale: Ajustable de 20Hz à 20kHz
  - Plage de Gain: ±20dB pour les filtres Peaking et Low/High Shelf
  - Facteur Q: 0.1-10.0 pour la plupart des types de filtres ; Low/High Shelf est limité à 0.1-2.0
  - Un Q élevé affecte une plage plus étroite ; un Q bas sonne plus large et plus doux
  - Pour Low/High Pass, Band Pass, Notch et AllPass, Frequency et Q façonnent le filtre ; Gain n'est pas utilisé
  - Types de Filtres Multiples:
    - En cloche : Réglage symétrique des fréquences
    - Passe Bas/Haut : Pente de 12dB/octave
    - Étagère Bas/Haut : Modelage spectral doux
    - Passe Bande : Isolation ciblée des fréquences
    - Notch: Suppression précise de fréquence
    - AllPass: Alignement fréquentiel focalisé sur la phase

### Affichage Technique
- Visualisation de la réponse en fréquence en haute résolution
- Points de contrôle interactifs avec affichage précis des paramètres
- Calcul en temps réel de la fonction de transfert
- Grille de fréquences et de gains calibrée
- Affichages numériques précis pour tous les paramètres

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
- **Fréquence Fondamentale (Hz)** - Contrôle le délai temporel et l'espacement harmonique (20Hz à 20000Hz)
  - Valeurs plus basses: Délais plus longs, pics et creux de peigne plus rapprochés
  - Valeurs plus élevées: Délais plus courts, pics et creux de peigne plus espacés
- **Gain de Rétroaction** - Contrôle l'intensité de l'effet du filtre en peigne (-1.0 à 1.0)
  - Valeurs négatives: Crée des motifs harmoniques inverses
  - Valeurs positives: Crée des motifs harmoniques de renforcement
  - Zéro: Aucun effet (signal sec uniquement)
  - Valeurs absolues plus élevées: Effet plus prononcé
- **Type de Peigne** - Contrôle la structure du filtre
  - Alimentation Directe: Crée un renforcement harmonique sans rétroaction
  - Rétroaction: Crée des effets de résonance et d'écho
- **Mélange Sec/Humide** - Contrôle l'équilibre entre le signal traité et l'original (0% à 100%)
  - 0%: Signal original uniquement
  - 50%: Mélange égal de signal original et traité
  - 100%: Signal traité uniquement

### Détails Techniques
- **Calcul du Délai**: Temps de délai = 1 / Fréquence Fondamentale
- **Réponse Harmonique**: Crée des pics et des creux régulièrement espacés à partir de la fréquence fondamentale
- **Coloration Spatiale**: Peut rappeler des réflexions très courtes, une couleur creuse ou une résonance métallique
- **Visualisation en Temps Réel**: Affiche la réponse en fréquence avec marqueur de fréquence fondamentale

### Affichage Visuel
- Graphique de réponse en fréquence en temps réel avec échelle de fréquence logarithmique
- Visualisation claire des pics et creux du filtre en peigne
- Marqueur de fréquence fondamentale montrant le délai temporel
- Contrôles interactifs pour un ajustement précis
- Calcul de la distance de délai en millimètres

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

## Group Delay EQ

Group Delay EQ est le pendant d'un égaliseur ordinaire : au lieu de changer le niveau de chaque bande, il change **le moment où** chaque bande arrive. Quinze curseurs règlent le retard de chaque plage de fréquences, et le plugin construit un seul filtre FIR conçu pour réaliser ces retards avec une réponse en amplitude plate. Une réponse plate est l'objectif de conception, pas une garantie : un nombre fini de Taps ne fait qu'approcher la cible idéale, et des réglages de retard importants ou variant rapidement entre les bandes peuvent produire une ondulation d'amplitude mesurable. Utilisez-le pour compenser les erreurs temporelles d'une enceinte ou d'un filtre de coupure, ou pour vérifier vous-même à quel point la distorsion de phase est audible sur votre système. Le plugin nécessite le moteur WASM DSP ; sans lui, le signal passe sans modification.

Seules les différences entre bandes comptent pour le son. Un filtre qui retarde toutes les bandes de la même façon n'est qu'un simple délai : le plugin conserve donc un retard interne fixe et vous laisse avancer ou retarder chaque bande autour de lui. Tant que tous les curseurs sont à 0 ms, le plugin est totalement transparent et n'ajoute aucune latence.

### Guide d'amélioration du son

- **Alignement enceintes / caisson de grave**: Si les graves arrivent en retard par rapport au reste, retardez les bandes situées au-dessus de la coupure de la même valeur jusqu'à ce que le graphique y devienne plat. Les corrections typiques vont de 2 à 10 ms et se jugent au mieux sur la grosse caisse et la basse.
- **Enceintes bass-reflex et modes de pièce**: Un évent ajoute du temps de propagation de groupe autour de sa fréquence d'accord. Abaissez la bande grave concernée, ou remontez toutes les autres, pour aplanir la courbe. De petites différences résiduelles sous 50 Hz sont normales.
- **Test d'écoute de la distorsion de phase**: Réglez une bande sur +10 ms, comparez avec l'effet désactivé, puis réduisez la valeur jusqu'à ne plus entendre de différence. N'interprétez le résultat comme une comparaison de phase seule que si l'« Ondulation » de la ligne d'état est suffisamment faible et que la courbe verte « Obtenu » se superpose étroitement à la courbe grise « Cible ». Sinon, les variations d'amplitude ou un retard réalisé avec une précision insuffisante peuvent aussi influer sur ce que vous entendez.
- **Procédez bande par bande**: Déplacez un curseur à la fois et écoutez. Les changements purement de phase sont subtils sur la plupart des programmes et se manifestent surtout sur les transitoires : batterie, cordes pincées, attaques de piano.
- **Surveillez les deux courbes**: Si la courbe verte ne suit plus la courbe grise, le réglage Taps actuel ne peut pas réaliser cette forme. Augmentez Taps ou réduisez l'écart entre bandes voisines.

### Paramètres

- **Taps** - Longueur du FIR : 4096, 8192, 16384 ou 32768. Les basses fréquences exigent un filtre long : à 96 kHz, 16384 taps suivent même de grands écarts de retard jusque vers 60 Hz, tandis que les réglages plus courts perdent d'abord en précision dans le grave. Taps détermine aussi le retard que le filtre peut contenir, donc la portée des curseurs. Plus de taps signifie plus de latence et plus de calcul.
- **Latency** - Latence de tête du moteur de convolution : 0, 128, 256, 512 ou 1024 samples. Des valeurs plus faibles réduisent le retard mais demandent plus de calcul.
- **Curseurs de bande (25 Hz à 16 kHz)** - Quinze curseurs règlent le temps de propagation de groupe de chaque bande. Les valeurs positives font arriver la plage plus tard, les négatives plus tôt. La plage couvre tout le retard que le filtre peut contenir : à 96 kHz, ±18,6 ms avec 4096 taps et ±149,3 ms avec 32768 taps. La bande la plus haute réalise ces valeurs intégralement, tandis que les bandes basses demandent davantage de taps pour suivre un réglage important ; le graphique montre jusqu'où chacune parvient. Les valeurs sont interpolées en douceur selon la fréquence, si bien que les bandes voisines se fondent toujours l'une dans l'autre.
- **Angle de phase** - Sous chaque valeur en millisecondes, le curseur affiche le même retard sous forme de rotation de phase à la fréquence centrale de la bande. Au-delà d'un tour complet, la lecture est décomposée en cycles entiers et angle restant : `+2c180°` signifie deux cycles complets plus un demi-tour.
- **Réinitialisation** - Double-cliquez sur un curseur pour ramener cette bande à 0 ms. Le bouton Reset du graphique réinitialise toutes les bandes d'un coup.

La latence totale vaut le réglage Latency plus la moitié des Taps. Elle ne change pas quand vous déplacez les curseurs : seul un changement de Taps ou de Latency modifie le retard de toute la chaîne.

### Affichage visuel

- La courbe grise est la cible : le retard demandé, interpolé sur un axe logarithmique de 20 Hz à 20 kHz. L'axe des retards se remet à l'échelle selon les réglages en cours, à partir de ±5 ms.
- La courbe verte est ce que le filtre conçu réalise réellement. Là où les deux se superposent, le réglage est pleinement réalisé ; là où elles s'écartent, le filtre ne peut pas suivre la demande avec les Taps actuels.
- La ligne d'état indique la latence totale en samples et en millisecondes, ainsi que l'ondulation d'amplitude du filtre. L'ondulation mesure l'écart entre la réponse en amplitude réalisée et l'objectif de conception plat : plus la valeur est faible, plus elle est proche de l'objectif, et 0,3 dB est le seuil d'avertissement de précision.

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
- **Freq** - Règle la fréquence de la bande de 20 Hz à 20 kHz.
- **Delay** - Règle en millisecondes la valeur extrême de la courbe propre à cette bande. Les valeurs positives font arriver la zone plus tard, les négatives plus tôt. La plage couvre tout le retard que le filtre peut contenir : à 96 kHz, ±18,6 ms avec 4096 taps et ±149,3 ms avec 32768 taps. Un changement de Taps ou de fréquence d'échantillonnage ramène les valeurs enregistrées à la nouvelle limite.
- **Q** - Règle la largeur ou la raideur de la forme de 0,1 à 100 sur un curseur logarithmique ; tous les Type l'utilisent. Les plages utiles diffèrent : de 0,25 à 16 pour Low Shelf et High Shelf, de 0,1 à 10 pour Filter GD. En pratique, les shelves s'emploient à Q 2 à 4 et Filter GD à Q 0,5 à 8 — 0,5 correspond à un passe-tout du premier ordre ou à une somme LR2, 0,7071 à un alignement Butterworth ou à une somme LR4, et 8 à une résonance étroite. Les réglages hors de ces plages sont acceptés ; la ligne d'état signale lorsque les Taps actuels ne peuvent pas les réaliser.
- **Enabled** - Active ou désactive chacune des cinq bandes. Les bandes désactivées n'apportent rien à la courbe cible et apparaissent estompées sur le graphique.
- **Taps** - Longueur du FIR : 4096, 8192, 16384 ou 32768. Les basses fréquences exigent un filtre long, et les formes à Q élevé également. Taps détermine aussi le retard que le filtre peut contenir, donc la portée de Delay. Plus de taps signifie plus de latence et plus de calcul.
- **Latency** - Latence de tête du moteur de convolution : 0, 128, 256, 512 ou 1024 samples. Des valeurs plus faibles réduisent le retard mais demandent plus de calcul.

La latence totale vaut le réglage Latency plus la moitié des Taps. Elle ne change pas quand vous modifiez les bandes : seul un changement de Taps ou de Latency modifie le retard de toute la chaîne.

### Affichage visuel

- La courbe grise est la cible : la somme des formes des bandes actives, tracée sur un axe logarithmique des fréquences. L'axe des retards se remet à l'échelle selon les réglages en cours, à partir de ±5 ms.
- La courbe verte est ce que le filtre conçu réalise réellement. Là où les deux se superposent, le réglage est pleinement réalisé ; là où elles s'écartent, le filtre ne peut pas suivre la demande avec les Taps actuels.
- Vers 18 à 20 kHz, la cible est adoucie progressivement jusqu'à zéro. Cette atténuation de l'extrême aigu fait partie de la conception : une bande placée près du haut du spectre est donc affichée — et réalisée — avec un effet réduit.
- Les marqueurs numérotés correspondent aux cinq bandes. Faites-les glisser horizontalement pour modifier Freq et verticalement pour modifier Delay. Le marqueur se pose sur la courbe uniquement avec Peak : un shelf passe par la moitié de Delay à Freq, et Filter GD atteint sa valeur extrême en dessous de Freq : juste en dessous à Q élevé, et de plus en plus bas à mesure que Q diminue, jusqu'à ce qu'à un Q d'environ 0,577 ou moins la valeur extrême se situe à l'extrémité grave du graphique.
- La ligne d'état indique la latence totale en samples et en millisecondes, ainsi que l'ondulation d'amplitude du filtre. L'ondulation mesure l'écart entre la réponse en amplitude réalisée et l'objectif de conception plat : plus la valeur est faible, plus elle est proche de l'objectif, et 0,3 dB est le seuil d'avertissement de précision.

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
  - Crée un caractère sonore plus analogue
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

## Room EQ

Room EQ crée des filtres de correction FIR à partir de mesures de réponse en fréquence enregistrées dans EffeTune. Par défaut, il conçoit un seul filtre à partir d'une mesure partagée et l'applique à tous les canaux routés vers le plugin ; attribuez une mesure différente à un canal individuel pour donner à ce canal son propre filtre, tandis que tous les autres réglages restent communs à l'ensemble de l'instance. Le sélecteur de bus standard du plugin détermine les canaux traités. Room EQ moyenne tous les points de la mesure choisie, lisse le résultat et réduit les écarts dans la plage de correction sélectionnée. Utilisez-le pour corriger les bosses récurrentes ou un déséquilibre tonal large causés par l'interaction des enceintes avec la pièce dans la zone d'écoute. Il peut aussi appliquer une correction d'amplitude à phase linéaire ou une correction à phase mixte combinant une correction d'amplitude à phase minimale avec la correction de la phase excédentaire mesurée : Phase Correction agit sur le son direct et Reverb Correction peut en plus contrer la réverbération mesurée de la pièce qui le suit. Par défaut, les deux corrections conservent la composante commune aux points de mesure et diminuent la correction là où les points divergent. Room EQ nécessite le moteur DSP WASM ; sans celui-ci, le signal traverse le plugin sans modification.

### Guide d'amélioration sonore

- Mesurez le groupe d'enceintes à corriger depuis plusieurs positions de microphone voisines dans la zone d'écoute, puis sélectionnez cette mesure dans Room EQ. Plusieurs points rendent la correction moins dépendante d'une seule position précise.
- Commencez avec **Phase: Minimum**, **Smoothing: 0.17 oct**, **Correction Low: 20 Hz**, **Correction High: 16000 Hz**, **Max Boost: 6 dB** et **Level Correction: 100%**. Comparez avec le contrôle principal d'activation du plugin pour vérifier que l'équilibre est plus régulier sans devenir artificiellement maigre ou brillant.
- Si le filtre tente de combler des creux étroits qui varient selon la position du microphone, augmentez Smoothing ou réduisez Max Boost. À 0 dB, Max Boost empêche les amplifications automatiques tout en laissant la correction atténuer les bosses.
- Si la correction de niveau complète paraît trop prononcée, réduisez Level Correction. Comme ce réglage met chaque valeur de correction automatique à l'échelle en dB, 50% transforme une correction de +6 dB en +3 dB et une correction de -8 dB en -4 dB.
- Limitez Correction Low et Correction High à la plage reproduite de manière fiable par les enceintes et le microphone. Corriger au-delà d'une plage de mesure fiable peut dégrader le résultat.
- Une fois la correction de pièce stabilisée, utilisez l'EQ supplémentaire pour définir une cible d'écoute douce, par exemple un Low shelf large de +2 dB vers 100 Hz ou un léger réglage High shelf vers 10 kHz. Ces bandes modifient la cible et sont intégrées au filtre FIR.
- Choisissez **Minimum** lorsque la latence doit rester faible. Utilisez **Correction** pour corriger la phase excédentaire en plus de la réponse en fréquence. Commencez avec Reference Point sur **Consensus (tous les points)**, la valeur par défaut de Direct Window et **Phase Correction: 100%**. Ne sélectionnez un point particulier que pour optimiser la phase excédentaire à cette position du microphone. Réduisez Phase Correction indépendamment si le résultat de phase paraît trop prononcé.
- **Low-frequency Phase Extension** est désactivée par défaut. Activez-la uniquement pour corriger la phase excédentaire sous Phase Low. Les fréquences plus basses utilisent des fenêtres d'analyse de plus en plus longues et peuvent inclure une partie plus tardive de la réponse de la pièce ; Consensus constitue donc le point de départ le plus sûr. Comparez plusieurs positions d'écoute et désactivez l'extension si le calage temporel du grave devient moins homogène.
- **Reverb Correction** est à 0% par défaut. En mode Correction, augmentez-la petit à petit en conservant la valeur par défaut **Reverb Max Freq: 250 Hz** ; cela contre la réverbération des basses fréquences tout en restant utile dans toute la zone d'écoute. N'étendez Reverb Max Freq vers les fréquences plus élevées qu'en sachant que le résultat devient alors une optimisation pour une seule position d'écoute.
- Room EQ ne calcule pas l'alignement lié à la distance des enceintes. **Delay** est partagé pour l'ensemble de l'instance, même lorsque les canaux utilisent des mesures différentes ; n'utilisez des instances Room EQ séparées que lorsque des groupes de canaux différents ont besoin de valeurs de retard manuel différentes.

La mesure est une référence locale à l'appareil. Une URL ou un preset conserve son nom et son identifiant, mais pas les données mesurées. Pour l'utiliser sur un autre appareil, activez **Inclure les réponses impulsionnelles dans les exports JSON de mesure** sur l'écran de mesure avant de l'exporter, puis importez-la sur l'autre appareil avant de la sélectionner. Cette option est désactivée par défaut, et l'inclusion des réponses impulsionnelles peut alourdir le fichier de plusieurs dizaines de mégaoctets. Si la mesure manque, un avertissement s'affiche et Room EQ utilise un bypass aligné au lieu d'anciennes données de correction.

### Paramètres

- **Measurement** - Sélectionne la mesure de réponse en fréquence partagée utilisée par tout canal sans substitution propre au canal. La liste affiche son nom, son nombre de points et `IR` lorsqu'une réponse impulsionnelle est disponible. Utilisez **Refresh measurements** après une modification.
- **Measurement Ch N** - Un sélecteur de substitution facultatif pour chaque canal géré par la sélection de bus de l'instance. Laissez-le sur **(Partagé)**, la valeur par défaut, pour utiliser le Measurement ci-dessus ; attribuez une mesure enregistrée différente pour donner à ce canal son propre filtre. Laisser tous les canaux sur **(Partagé)** reproduit exactement le comportement d'un filtre partagé unique.
- **Delay** - Ajoute manuellement 0 à 20 ms de retard à tous les canaux traités. Ce retard n'est pas compris dans la latence de traitement annoncée par le plugin.
- **Phase** - Définit le traitement de phase du filtre FIR.
  - **Minimum** - Correction d'amplitude à phase minimale avec la latence ajoutée la plus faible.
  - **Linear** - Correction d'amplitude à phase linéaire. Elle préserve la phase relative du signal, mais ajoute un retard égal à la moitié du nombre de taps.
  - **Correction** - Ajoute à la correction d'amplitude à phase minimale la correction de la phase excédentaire de la réponse impulsionnelle enregistrée : Phase Correction contrôle la composante du son direct analysée dans Direct Window, et Reverb Correction peut en plus contrer la réverbération plus tardive analysée dans Reverb Window. Cela réduit les variations du délai de groupe tout en conservant `Taps / 2` échantillons de retard pour le filtre à phase mixte. Lors de la conception, la position de l'énergie de l'impulsion principale reste alignée sur la réponse Minimum utilisant le même réglage Level Correction. Lorsque tous les canaux utilisent la mesure partagée, un seul filtre est conçu à partir de celle-ci et appliqué sans modification à tous les canaux routés : modifier Level Correction, Phase Correction ou Reverb Correction n'introduit alors pas de différence de synchronisation propre à chaque canal. Lorsqu'une mesure distincte est attribuée à un canal, un filtre distinct est conçu pour ce canal. Nécessite Reference Point, Direct Window et des données impulsionnelles.
- **Taps** - Longueur FIR : 8192, 16384, 32768, 65536 ou 131072. Une valeur supérieure améliore la résolution dans le grave, mais augmente le retard, la mémoire utilisée et le temps de conception. Linear et Correction ajoutent `Taps / 2` échantillons de retard.
- **Latency** - Latence de tête du moteur de convolution : 0, 128, 256, 512 ou 1024 échantillons. Une valeur basse réduit le retard au prix d'une charge de calcul accrue ; avec Linear et Correction, le demi-nombre de taps domine généralement.
- **Smoothing** - Lissage gaussien de 0,02 à 1,00 octave. Une valeur élevée produit une correction plus large et prudente ; une valeur basse suit des variations plus fines.
- **Phase Smoothing** - Lissage gaussien de 0,02 à 1,00 octave appliqué à la correction de la phase excédentaire mesurée du son direct en mode Correction. Avec **Auto** activé par défaut, il suit Smoothing, de sorte que les corrections d'amplitude et de phase sont lissées de la même façon. Désactivez Auto pour lisser la correction de phase indépendamment ; la valeur effective actuelle sert alors de point de départ. Une valeur basse suit des détails temporels plus fins, une valeur élevée donne une correction de phase plus prudente. Reverb Correction n'est pas concernée : elle utilise Reverb Smoothing.
- **Correction Low / Correction High** - Définissent les limites de transition basse et haute de la correction automatique d'amplitude. Avant le lissage gaussien, la correction automatique est considérée comme égale à 0 dB sur ces limites et au-delà. Smoothing détermine donc la progressivité de l'atténuation de la correction et son extension au-delà de chaque limite. La limite haute est aussi bornée en interne pour conserver une marge sous la fréquence de Nyquist.
- **Direct Window** - Portion de 1 à 50 ms après l'arrivée du son direct utilisée par Correction. Il s'agit de la fenêtre d'analyse fixe à partir de Phase Low et, lorsque Low-frequency Phase Extension est activée, de la fenêtre d'analyse la plus courte. Une fenêtre plus longue peut abaisser la valeur automatique de Phase Low, mais inclut davantage de réflexions de la pièce.
- **Phase Low** - Règle entre 20 et 20000 Hz la fréquence basse de la correction de phase excédentaire mesurée en mode Correction lorsque Low-frequency Phase Extension est désactivée. Lorsque l'extension est activée, Phase Low délimite la fenêtre Direct Window fixe et les fenêtres de basses fréquences qui s'allongent progressivement. Avec **Auto** activé par défaut, Room EQ retient la valeur la plus élevée entre Correction Low et la fréquence dont trois périodes tiennent dans Direct Window (500 Hz pour 6 ms). Désactivez Auto pour régler cette limite manuellement. La valeur manuelle est indépendante de Correction Low et ne peut pas être inférieure à la fréquence d'une période dans Direct Window (167 Hz pour 6 ms). Les valeurs inférieures à la limite automatique sont plus sensibles à la troncature de la fenêtre temporelle et aux réflexions de la pièce.
- **Low-frequency Phase Extension** - Étend la correction de la phase excédentaire mesurée de Phase Low vers Correction Low au moyen de fenêtres d'analyse dépendantes de la fréquence et de plus en plus longues sous Phase Low. À partir de Phase Low, une fenêtre d'analyse fixe est utilisée. Ce réglage est désactivé par défaut. Il est disponible uniquement avec Correction ; avec Minimum et Linear, la commande est désactivée mais la valeur choisie est conservée. Si la réponse impulsionnelle mesurée est plus courte que la fenêtre demandée dans les basses fréquences, Room EQ utilise la fenêtre de mesure plus courte disponible et affiche un avertissement. Il ne réduit ou n’ignore la correction que lorsque le FIR obtenu approche de ses limites temporelles ou que le budget de calcul de la conception du filtre est dépassé ; le reste du filtre Room EQ demeure actif. L'extension ne fonctionne que lorsque Phase Correction est supérieure à 0% ; à 0%, elle reste inactive même si Reverb Correction est utilisée.
- **Max Boost** - Limite de 0 à 18 dB les amplifications produites par l'inversion automatique de la réponse. La limite est appliquée avant le lissage gaussien afin que les zones plafonnées se raccordent en douceur à la courbe de correction environnante. Les atténuations ne sont pas limitées.
- **Level Correction** - Règle la correction automatique d'amplitude de 0% à 100% par pas de 1%, linéairement en dB. À 0%, la correction automatique de niveau est désactivée ; Phase Correction, Additional EQ, Delay et Gain restent actifs.
- **Phase Correction** - Règle la correction de la phase excédentaire mesurée du son direct de 0% à 100% par pas de 1% et n'agit qu'en mode Correction. Ses commandes sont désactivées dans les modes Minimum et Linear. Elle est indépendante de Reverb Correction : à 0%, la correction de phase excédentaire du son direct est désactivée tandis que Level Correction et une éventuelle Reverb Correction restent actives. Le déphasage minimal intrinsèquement lié à la réponse d'amplitude de Level Correction demeure ; Phase Correction ne règle donc que la composante supplémentaire de phase excédentaire mesurée du son direct.
- **Reverb Correction** - Règle la correction de la réverbération mesurée de la pièce de 0% à 100% par pas de 1% et n'agit qu'en mode Correction ; ses commandes sont désactivées dans Minimum et Linear mais conservent leurs valeurs. À 0%, valeur par défaut, la correction de réverbération est totalement désactivée et Room EQ se comporte exactement comme sans ce réglage. Au-dessus de 0%, Room EQ analyse la réponse sur toute la durée de Reverb Window et, jusqu'à Reverb Max Freq, contre la réverbération qui se prolonge après le son direct : il corrige la phase excédentaire de la réverbération indépendamment de Phase Correction et ajoute dans la même bande une correction d'amplitude plus fine, suivant Reverb Smoothing, qui réduit les ondulations en peigne et les modes de la pièce à décroissance lente. Cette correction d'amplitude plus fine respecte Max Boost et est mise à l'échelle par Level Correction comme le reste de la correction automatique d'amplitude. Sous Phase Low, là où la correction de phase du son direct n'atteint pas, elle agit comme une correction purement additionnelle. Avec plusieurs points de mesure, la correction est réduite automatiquement là où les points divergent, ce qui garde le résultat par défaut naturel dans toute la zone d'écoute ; avec un seul point de mesure, cette protection n'existe pas et la correction s'applique strictement à la position mesurée. Lorsque la fenêtre de réverbération ou la bande de fréquences utilisable est trop petite, ou lorsque la correction de réverbération synthétisée ne tient pas de façon sûre dans les limites temporelles du FIR obtenu, Room EQ réduit ou ignore la correction de réverbération et affiche un avertissement ; le reste du filtre demeure actif.
- **Reverb Window** - Définit la portion de la réponse mesurée après l'arrivée du son direct, de 20 à 1000 ms, que la correction de réverbération analyse et contre. Une fenêtre plus longue atteint une réverbération plus tardive. La fenêtre de réverbération effective est automatiquement bornée par le nombre de taps du FIR, par Direct Window et par la longueur de la réponse impulsionnelle mesurée après son début ; elle peut donc être plus courte que la valeur affichée. Avec les 32768 taps par défaut à 96 kHz, la limite supérieure est d'environ 170 ms. La fréquence maximale à laquelle la structure fine de la réverbération peut être suivie décroît en proportion inverse de la profondeur de la fenêtre : environ f < 1/(0,0139 × fenêtre effective), soit environ 420 Hz pour une fenêtre effective de 170,7 ms et environ 240 Hz pour 300 ms. Si la fenêtre effective ne dépasse pas Direct Window — que ce soit à cause du budget de taps, d'une réponse impulsionnelle mesurée courte ou d'un Reverb Window réglé au niveau de Direct Window ou en dessous —, la correction de réverbération est entièrement ignorée et un avertissement s'affiche ; le reste du filtre demeure actif.
- **Reverb Max Freq** - Définit la limite haute en fréquence de la correction de réverbération, de 20 à 20000 Hz. La valeur par défaut de 250 Hz maintient la correction dans le grave, où la réverbération de la pièce se comporte de manière cohérente entre positions voisines. La partie phase est en pratique limitée à la plus basse des valeurs entre Reverb Max Freq, Correction High et 45% de la fréquence d'échantillonnage ; Correction High reste donc le plafond de toute correction et Reverb Max Freq choisit la limite de la réverbération à l'intérieur de celui-ci. L'augmenter étend la correction de réverbération vers des fréquences plus élevées, où le champ réverbéré varie d'un siège à l'autre et se déplace même avec la température de l'air ; le résultat n'est alors valable qu'à la position d'écoute mesurée. S'il ne reste aucune bande de fréquences sous la limite effective — par exemple lorsque Correction Low est réglé à cette limite ou au-dessus —, la correction de réverbération est entièrement ignorée et un avertissement s'affiche ; le reste du filtre demeure actif.
- **Reverb Smoothing** - Lissage gaussien de 0,02 à 1,00 octave utilisé par la correction de réverbération, à la fois pour son analyse de phase et pour sa correction d'amplitude plus fine. La valeur par défaut de 0,05 oct est beaucoup plus fine que le Smoothing principal, afin que la correction puisse suivre les ondulations étroites que la réverbération crée dans la réponse. Une valeur plus élevée rend la correction de réverbération plus large et prudente. Avec plusieurs points de mesure, elle définit aussi l'échelle de fréquence sur laquelle leur concordance est évaluée.
- **Reference Point** - Sélectionne la source de phase excédentaire en mode Correction pour l'analyse du son direct comme pour celle de la réverbération. **Consensus (tous les points)** est la valeur par défaut et de repli : les points sont alignés dans le temps, leur phase excédentaire est combinée, les phases peu fiables près des creux profonds reçoivent moins de poids et la correction diminue lorsque les points divergent. Choisir un point nommé utilise uniquement sa phase excédentaire. La correction d'amplitude utilise toujours tous les points. Si le point choisi est supprimé, le réglage revient à Consensus.
- **EQ supplémentaire (intégré au FIR)** - Réutilise la même interface à cinq bandes et le même graphique que 5Band PEQ. Chaque bande peut être activée, configurée en Peak, Low shelf ou High shelf, puis réglée de 20 Hz à 20 kHz, de -20 à +20 dB et avec un Q de 0,1 à 10. La réponse est intégrée au FIR et non traitée par un étage IIR séparé. Sa phase est nulle en mode Linear et minimale dans les modes Minimum et Correction. Max Boost limite l'inversion automatique de la pièce, pas les amplifications voulues de cet EQ.
- **Gain** - Applique de -12 à +12 dB à tous les canaux après la réunion des chemins corrigés et bypassés.

### Affichage visuel

- Les boutons radio **Graph**, placés hors du graphique, permettent de choisir entre **Fréquence**, **Phase**, **Temps de groupe minimal**, **Temps de groupe excédentaire** et **Impulsion**.
- **Phase** représente la fréquence sur une échelle logarithmique à l'horizontale et la phase de -180° à 180° à la verticale. La courbe grise montre la phase avant correction et la courbe verte la phase calculée après application du FIR réel. Le début mesuré est retiré des deux courbes et le retard fixe connu du FIR est également retiré du résultat corrigé : le graphique montre ainsi la variation de phase introduite par le filtre sans ces décalages temporels fixes. Si la mesure ne contient pas de réponse impulsionnelle, un message indique que ces données ne sont pas disponibles.
- **Temps de groupe minimal** affiche le retard associé à la composante à phase minimale de la réponse en amplitude. **Temps de groupe excédentaire** affiche séparément le retard restant après retrait de cette composante, ce qui facilite l'examen des réflexions et des autres écarts temporels non minimum-phase. Les deux vues utilisent une fréquence logarithmique à l'horizontale et les millisecondes à la verticale. Chaque courbe est référencée à sa propre valeur à 1 kHz ; toutes deux passent donc par 0 ms à cet endroit et une valeur positive indique un retard par rapport à 1 kHz. La courbe grise correspond à l'état avant correction et la verte au résultat calculé après application du FIR réel. La pente est relevée entre deux points voisins, puis lissée uniquement par Smoothing, comme la réponse en fréquence mesurée ; une valeur plus faible révèle davantage de détails. L'échelle verticale s'adapte automatiquement. Si la mesure ne contient pas de réponse impulsionnelle, un message indique que ces données ne sont pas disponibles.
- **Impulsion** affiche le point sélectionné ou, lorsque Reference Point est réglé sur Consensus, la forme d'onde moyenne alignée dans le temps. La plage commence 2 ms avant le début mesuré et se termine à la plus grande valeur entre 5 ms, Direct Window et, lorsque Reverb Correction est supérieure à 0%, Reverb Window limité à 50 ms. La courbe grise correspond au signal avant correction et la courbe verte au résultat calculé après application du FIR réel. Le début mesuré sert de référence commune à 0 ms et seul le retard fixe connu du FIR est retiré de la courbe corrigée, de sorte que la position relative du pic et le pré-ringing restent visibles. Les deux courbes utilisent la même échelle d'amplitude normalisée. Low-frequency Phase Extension et Reverb Correction peuvent analyser une partie de la réponse postérieure à la limite de cette vue. Pour l'affichage uniquement, les composantes à partir de 20 kHz sont supprimées ; cela n'affecte ni le filtre de correction ni le traitement audio. Si la mesure ne contient pas de réponse impulsionnelle, un message indique que ces données ne sont pas disponibles.
- **Fréquence** représente la fréquence sur une échelle logarithmique à l'horizontale et le niveau en dB à la verticale.
- Le sélecteur **Preview channel**, placé hors du graphique, n'apparaît que lorsque des filtres ont été conçus pour plusieurs canaux ; il choisit le canal dont la réponse est affichée dans le graphique et sert de base à l'EQ supplémentaire, sans effet sur le son.
- Lorsque le pointeur se déplace sur le graphique, chaque courbe reçoit un point à la position horizontale du pointeur et sa valeur s'affiche à droite de son nom dans la légende, la fréquence du pointeur — ou le temps dans la vue Impulsion — étant indiquée au-dessus. L'affichage disparaît dès que le pointeur quitte le graphique.
- Les deux lignes verticales blanches en pointillés indiquent les fréquences définies par Correction Low et Correction High.
- Les marqueurs permettent de modifier la fréquence et le gain de chaque bande.
- La courbe gris clair montre la réponse en fréquence mesurée et lissée avec le décalage d'affichage commun du graphique.
- La fine courbe vert pâle montre la correction automatique calculée à partir de la mesure sélectionnée et des réglages actuels de Room EQ, avant l'EQ supplémentaire.
- La courbe vert vif montre cette correction après application de l'EQ supplémentaire. Cette réponse en amplitude combinée est intégrée au FIR.
- La courbe blanche montre la réponse corrigée estimée obtenue en ajoutant la correction combinée vert vif à la réponse mesurée gris clair. Les courbes grise et blanche partagent un décalage qui place à 0 dB le niveau cible d'une correction automatique à 100 % ; les limites de Max Boost peuvent laisser des écarts résiduels, tandis qu'Additional EQ remodèle volontairement la réponse autour de cette référence. Il s'agit d'un aperçu calculé, et non d'une nouvelle mesure acoustique.
- L'état sous les contrôles indique la latence totale, la résolution FIR et si le filtre est en bypass, staged, preparing, active ou error.

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
- Bouton de réinitialisation rapide
## Tilt EQ

Un égaliseur simple mais efficace qui incline en douceur l'équilibre des fréquences de votre musique. Conçu pour des ajustements subtils permettant de réchauffer ou d'éclaircir le son sans contrôles complexes. Idéal pour adapter rapidement la tonalité générale à vos préférences.

### Guide d'amélioration musicale
- Réchauffer la musique :
  - Utilisez des valeurs de Slope négatives pour atténuer les hautes fréquences et renforcer les basses
  - Parfait pour les enregistrements trop brillants ou les écouteurs à son agressif
  - Crée une expérience d'écoute chaleureuse et relaxante
- Éclaircir la musique :
  - Utilisez des valeurs de Slope positives pour accentuer les aigus et atténuer les basses
  - Idéal pour les enregistrements étouffés ou les enceintes au son mat
  - Ajoute de la clarté et de la brillance
- Réglages subtils :
  - Utilisez de faibles valeurs de Slope pour des ajustements globaux doux
  - Ajustez l'équilibre selon votre environnement d'écoute ou votre humeur

### Paramètres
- **Pivot Frequency** - Contrôle la fréquence centrale d'inclinaison (20Hz à ~20kHz)
  - Détermine le point autour duquel s'effectue l'inclinaison
- **Slope** - Contrôle la pente d'inclinaison autour de la fréquence pivot (-12 à +12dB/octave)
  - Détermine l'intensité de l'effet d'inclinaison
  - Les valeurs positives rendent le son plus brillant ; les valeurs négatives le rendent plus chaleureux
  - Les petites valeurs produisent des changements plus doux

### Affichage
- Curseur de réglage intuitif
- Courbe de réponse en fréquence en temps réel
- Indication claire de la valeur actuelle de Slope
