---
title: "Plugins EQ - EffeTune"
description: "Plugins d'égalisation incluant Parametric EQ, Graphic EQ, Dynamic EQ, Room EQ, Earphone Cable Sim, des filtres et Tone Control."
lang: fr
---

# Plugins d'Égaliseur
Une collection de plugins qui vous permet d'ajuster différents aspects du son de votre musique, des basses profondes aux aigus nets. Ces outils vous aident à personnaliser votre expérience d'écoute en renforçant ou en atténuant certains éléments sonores.

## Liste des Plugins

- [15Band GEQ](#15band-geq) - Réglage détaillé du son avec 15 contrôles précis
- [15Band PEQ](#15band-peq) - Égaliseur paramétrique à 15 bandes pour des réglages détaillés
- [5Band Dynamic EQ](#5band-dynamic-eq) - Égaliseur dynamique qui réagit à votre musique
- [5Band PEQ](#5band-peq) - Égaliseur paramétrique à cinq bandes avec des contrôles flexibles
- [Band Pass Filter](#band-pass-filter) - Concentrez-vous sur des fréquences spécifiques
- [Comb Filter](#comb-filter) - Coloration sonore phasée, creuse ou métallique
- [Earphone Cable Sim](#earphone-cable-sim) - Vérifie à quel point les variations de réponse en fréquence des câbles d'écouteurs ordinaires restent généralement faibles
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
Un égaliseur spécialisé qui ajuste l'équilibre des fréquences en fonction de la valeur Average SPL que vous réglez. Utilisez-le pour l'écoute à volume faible, où les basses et les aigus peuvent sembler plus discrets, afin de garder une musique équilibrée et agréable.

### Guide d'Amélioration de l'Écoute
- Écoute à Faible Volume:
  - Renforce les fréquences de basse et d'aigus
  - Maintient l'équilibre musical à des niveaux bas
  - Compense les caractéristiques de l'audition humaine
- Réglage Average SPL:
  - Plus d'amélioration avec des valeurs Average SPL plus basses
  - Réduction progressive du traitement à mesure que le réglage augmente
  - Son naturel à des niveaux d'écoute plus élevés
- Équilibre des Fréquences:
  - Étagère basse pour l'amélioration des basses (100-300Hz)
  - Étagère haute pour l'amélioration des aigus (3-6kHz)
  - Transition fluide entre les plages de fréquences

### Paramètres
- **Average SPL** - Niveau d'écoute moyen estimé utilisé pour la correction (60dB à 85dB)
  - Valeurs inférieures : Plus d'amélioration
  - Valeurs supérieures : Moins d'amélioration
  - Réglez cette valeur manuellement pour correspondre à votre volume d'écoute typique
- **Contrôles des Basses Fréquences**
  - Frequency: Centre d'amélioration des basses (100Hz à 300Hz)
  - Gain: Boost maximal des basses (0dB à 15dB)
  - Q: Forme de l'amélioration des basses (0.5 à 1.0)
- **Contrôles des Hautes Fréquences**
  - Frequency: Centre d'amélioration des aigus (3kHz à 6kHz)
  - Gain: Boost maximal des aigus (0dB à 15dB)
  - Q: Forme de l'amélioration des aigus (0.5 à 1.0)

### Affichage Visuel
- Graphique de réponse en fréquence en temps réel
- Contrôles interactifs des paramètres
- Visualisation de la courbe dépendante du volume
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

Room EQ crée un seul filtre de correction FIR à partir d'une mesure de réponse en fréquence enregistrée dans EffeTune, puis applique ce même filtre à tous les canaux routés vers le plugin. Le sélecteur de bus standard du plugin détermine les canaux traités. Room EQ moyenne tous les points de la mesure choisie, lisse le résultat et réduit les écarts dans la plage de correction sélectionnée. Utilisez-le pour corriger les bosses récurrentes ou un déséquilibre tonal large causés par l'interaction des enceintes avec la pièce dans la zone d'écoute. Il peut aussi appliquer une correction d'amplitude à phase linéaire ou une correction à phase mixte combinant une correction d'amplitude à phase minimale avec la correction de la phase excédentaire du son direct mesuré. Par défaut, la correction de phase excédentaire conserve la composante commune aux points de mesure et diminue là où leurs phases divergent. Room EQ nécessite le moteur DSP WASM ; sans celui-ci, le signal traverse le plugin sans modification.

### Guide d'amélioration sonore

- Mesurez le groupe d'enceintes à corriger depuis plusieurs positions de microphone voisines dans la zone d'écoute, puis sélectionnez cette mesure dans Room EQ. Plusieurs points rendent la correction moins dépendante d'une seule position précise.
- Commencez avec **Phase: Linear**, **Smoothing: 0.17 oct**, **Correction Low: 20 Hz**, **Correction High: 16000 Hz**, **Max Boost: 6 dB** et **Level Correction: 100%**. Comparez avec le contrôle principal d'activation du plugin pour vérifier que l'équilibre est plus régulier sans devenir artificiellement maigre ou brillant.
- Si le filtre tente de combler des creux étroits qui varient selon la position du microphone, augmentez Smoothing ou réduisez Max Boost. À 0 dB, Max Boost empêche les amplifications automatiques tout en laissant la correction atténuer les bosses.
- Si la correction de niveau complète paraît trop prononcée, réduisez Level Correction. Comme ce réglage met chaque valeur de correction automatique à l'échelle en dB, 50% transforme une correction de +6 dB en +3 dB et une correction de -8 dB en -4 dB.
- Limitez Correction Low et Correction High à la plage reproduite de manière fiable par les enceintes et le microphone. Corriger au-delà d'une plage de mesure fiable peut dégrader le résultat.
- Une fois la correction de pièce stabilisée, utilisez l'EQ supplémentaire pour définir une cible d'écoute douce, par exemple un Low shelf large de +2 dB vers 100 Hz ou un léger réglage High shelf vers 10 kHz. Ces bandes modifient la cible et sont intégrées au filtre FIR.
- Choisissez **Minimum** lorsque la latence doit rester faible. Utilisez **Correction** pour corriger la phase excédentaire en plus de la réponse en fréquence. Commencez avec Reference Point sur **Consensus (tous les points)**, la valeur par défaut de Direct Window et **Phase Correction: 100%**. Ne sélectionnez un point particulier que pour optimiser la phase excédentaire à cette position du microphone. Réduisez Phase Correction indépendamment si le résultat de phase paraît trop prononcé.
- Room EQ ne calcule pas l'alignement lié à la distance des enceintes. **Delay** ajoute le même retard manuel à tous les canaux traités. Si des groupes différents nécessitent des retards différents, utilisez des instances Room EQ séparées.

La mesure est une référence locale à l'appareil. Une URL ou un preset conserve son nom et son identifiant, mais pas les données mesurées. Pour l'utiliser sur un autre appareil, activez **Inclure les réponses impulsionnelles dans les exports JSON de mesure** sur l'écran de mesure avant de l'exporter, puis importez-la sur l'autre appareil avant de la sélectionner. Cette option est désactivée par défaut, et l'inclusion des réponses impulsionnelles peut alourdir le fichier de plusieurs dizaines de mégaoctets. Si la mesure manque, un avertissement s'affiche et Room EQ utilise un bypass aligné au lieu d'anciennes données de correction.

### Paramètres

- **Measurement** - Sélectionne une mesure enregistrée pour tous les canaux traités. La liste affiche son nom, son nombre de points et `IR` lorsqu'une réponse impulsionnelle est disponible. Utilisez **Refresh measurements** après une modification.
- **Delay** - Ajoute manuellement 0 à 20 ms de retard à tous les canaux traités. Ce retard n'est pas compris dans la latence de traitement annoncée par le plugin.
- **Phase** - Définit le traitement de phase du filtre FIR.
  - **Minimum** - Correction d'amplitude à phase minimale avec la latence ajoutée la plus faible.
  - **Linear** - Correction d'amplitude à phase linéaire. Elle préserve la phase relative du signal, mais ajoute un retard égal à la moitié du nombre de taps.
  - **Correction** - Ajoute à la correction d'amplitude à phase minimale la correction de la phase excédentaire de la réponse impulsionnelle directe enregistrée. Cela réduit les variations du délai de groupe tout en conservant `Taps / 2` échantillons de retard pour le filtre à phase mixte. Lors de la conception, la position de l'énergie de l'impulsion principale reste alignée sur la réponse Minimum utilisant le même réglage Level Correction. Un seul filtre est conçu à partir de la mesure sélectionnée et appliqué sans modification à tous les canaux routés. Modifier Level Correction ou Phase Correction n'introduit donc pas de différence de synchronisation propre à chaque canal. Nécessite Reference Point, Direct Window et des données impulsionnelles.
- **Taps** - Longueur FIR : 8192, 16384, 32768, 65536 ou 131072. Une valeur supérieure améliore la résolution dans le grave, mais augmente le retard, la mémoire utilisée et le temps de conception. Linear et Correction ajoutent `Taps / 2` échantillons de retard.
- **Latency** - Latence de tête du moteur de convolution : 0, 128, 256, 512 ou 1024 échantillons. Une valeur basse réduit le retard au prix d'une charge de calcul accrue ; avec Linear et Correction, le demi-nombre de taps domine généralement.
- **Smoothing** - Lissage gaussien de 0,02 à 1,00 octave. Une valeur élevée produit une correction plus large et prudente ; une valeur basse suit des variations plus fines.
- **Correction Low / Correction High** - Définissent les limites de transition basse et haute de la correction automatique d'amplitude. Avant le lissage gaussien, la correction automatique est considérée comme égale à 0 dB sur ces limites et au-delà. Smoothing détermine donc la progressivité de l'atténuation de la correction et son extension au-delà de chaque limite. La limite haute est aussi bornée en interne pour conserver une marge sous la fréquence de Nyquist.
- **Direct Window** - Portion de 1 à 50 ms après l'arrivée du son direct utilisée par Correction. Une fenêtre plus longue étend la correction de phase vers le grave, mais inclut davantage de réflexions de la pièce.
- **Max Boost** - Limite de 0 à 18 dB les amplifications produites par l'inversion automatique de la réponse. La limite est appliquée avant le lissage gaussien afin que les zones plafonnées se raccordent en douceur à la courbe de correction environnante. Les atténuations ne sont pas limitées.
- **Level Correction** - Règle la correction automatique d'amplitude de 0% à 100% par pas de 1%, linéairement en dB. À 0%, la correction automatique de niveau est désactivée ; Phase Correction, Additional EQ, Delay et Gain restent actifs.
- **Phase Correction** - Règle la correction de la phase excédentaire mesurée de 0% à 100% par pas de 1% et n'agit qu'en mode Correction. Ses commandes sont désactivées dans les modes Minimum et Linear. À 0%, la correction de phase excédentaire est désactivée tandis que Level Correction reste active. Le déphasage minimal intrinsèquement lié à la réponse d'amplitude de Level Correction demeure ; Phase Correction ne règle donc que la composante supplémentaire de phase excédentaire issue de la mesure.
- **Reference Point** - Sélectionne la source de phase excédentaire du son direct en mode Correction. **Consensus (tous les points)** est la valeur par défaut et de repli : les points sont alignés dans le temps, leur phase excédentaire est combinée, les phases peu fiables près des creux profonds reçoivent moins de poids et la correction diminue lorsque les points divergent. Choisir un point nommé utilise uniquement sa phase excédentaire. La correction d'amplitude utilise toujours tous les points. Si le point choisi est supprimé, le réglage revient à Consensus.
- **EQ supplémentaire (intégré au FIR)** - Réutilise la même interface à cinq bandes et le même graphique que 5Band PEQ. Chaque bande peut être activée, configurée en Peak, Low shelf ou High shelf, puis réglée de 20 Hz à 20 kHz, de -20 à +20 dB et avec un Q de 0,1 à 10. La réponse est intégrée au FIR et non traitée par un étage IIR séparé. Sa phase est nulle en mode Linear et minimale dans les modes Minimum et Correction. Max Boost limite l'inversion automatique de la pièce, pas les amplifications voulues de cet EQ.
- **Gain** - Applique de -12 à +12 dB à tous les canaux après la réunion des chemins corrigés et bypassés.

### Affichage visuel

- Les boutons radio **Réponse en fréquence** et **Réponse impulsionnelle**, en haut du graphique, permettent de changer de vue.
- **Réponse impulsionnelle** affiche le point sélectionné ou, lorsque Reference Point est réglé sur Consensus, la forme d'onde moyenne alignée dans le temps. La plage commence 5 ms avant le début mesuré et se termine à la plus grande valeur entre 5 ms et Direct Window. La courbe grise correspond au signal avant correction et la courbe blanche au résultat calculé après application du FIR réel. Le début mesuré sert de référence commune à 0 ms et seul le retard fixe connu du FIR est retiré de la courbe corrigée, de sorte que la position relative du pic et le pré-ringing restent visibles. Les deux courbes utilisent la même échelle d'amplitude normalisée. Si la mesure ne contient pas de réponse impulsionnelle, un message indique que ces données ne sont pas disponibles.
- Le graphique représente la fréquence sur une échelle logarithmique à l'horizontale et le niveau en dB à la verticale.
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
