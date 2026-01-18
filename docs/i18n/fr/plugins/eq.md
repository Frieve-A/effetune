---
title: "EQ Plugins - EffeTune"
description: "Equalizer plugins including Parametric EQ, Graphic EQ, Dynamic EQ, Filters, and Tone Control."
lang: en
---

# Plugins d'Égaliseur
Une collection de plugins qui vous permet d'ajuster différents aspects du son de votre musique, des basses profondes aux aigus nets. Ces outils vous aident à personnaliser votre expérience d'écoute en renforçant ou en atténuant certains éléments sonores.

## Liste des Plugins

- [15Band GEQ](#15band-geq) - Réglage détaillé du son avec 15 contrôles précis
- [15Band PEQ](#15band-peq) - Égaliseur paramétrique professionnel à 15 bandes offrant une flexibilité maximale
- [5Band Dynamic EQ](#5band-dynamic-eq) - Égaliseur dynamique qui réagit à votre musique
- [5Band PEQ](#5band-peq) - Égaliseur paramétrique professionnel avec des contrôles flexibles
- [Band Pass Filter](#band-pass-filter) - Concentrez-vous sur des fréquences spécifiques
- [Comb Filter](#comb-filter) - Filtre en peigne numérique pour coloration harmonique et simulation de résonance
- [Hi Pass Filter](#hi-pass-filter) - Éliminez avec précision les basses fréquences indésirables
- [Lo Pass Filter](#lo-pass-filter) - Éliminez avec précision les hautes fréquences indésirables
- [Loudness Equalizer](#loudness-equalizer) - Correction de l'équilibre des fréquences pour une écoute à faible volume
- [Narrow Range](#narrow-range) - Concentrez-vous sur des parties spécifiques du son
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

Un égaliseur paramétrique professionnel avec un contrôle étendu sur 15 bandes, offrant des ajustements de fréquence précis. Parfait tant pour le raffinement subtil du son que pour le traitement audio correctif avec une flexibilité maximale.

### Guide d'Amélioration Sonore
- Clarté des Voix et des Instruments:
  - Utilisez la bande 3.2kHz avec un Q modéré (1.0-2.0) pour une présence naturelle
  - Appliquez des coupes avec un Q étroit (4.0-8.0) pour éliminer les résonances
  - Ajoutez une légère sensation d'air avec une étagère haute 10kHz (+2 à +4dB)
- Contrôle de la Qualité des Basses:
  - Façonnez les fondamentaux avec un filtre en cloche à 100Hz
  - Éliminez la résonance de la pièce en utilisant un Q étroit à des fréquences spécifiques
  - Créez une extension de basse fluide avec une étagère basse
- Réglage Scientifique du Son:
  - Ciblez des fréquences spécifiques avec précision
  - Utilisez des analyseurs pour identifier les zones problématiques
  - Appliquez des corrections mesurées avec un impact de phase minimal

### Paramètres Techniques
- **Bandes de Précision**
  - 15 bandes de fréquence entièrement configurables
  - Configuration de fréquence initiale:
    - 25Hz, 40Hz, 63Hz, 100Hz, 160Hz (Basses profondes)
    - 250Hz, 400Hz, 630Hz (Sons bas)
    - 1kHz, 1.6kHz, 2.5kHz (Sons médiums)
    - 4kHz, 6.3kHz, 10kHz, 16kHz (Sons aigus)
- **Contrôles Professionnels par Bande**
  - Fréquence Centrale: Espacée logarithmiquement pour une couverture optimale
  - Plage de Gain: Réglage précis de ±20dB
  - Facteur Q: De 0.1 (large) à 10.0 (précis)
  - Types de Filtres Multiples:
    - En cloche : Réglage symétrique des fréquences
    - Passe Bas/Haut : Pente de 12dB/octave
    - Étagère Bas/Haut : Modelage spectral doux
    - Passe Bande : Isolation ciblée des fréquences
    - Notch: Suppression précise de fréquence
    - AllPass: Alignement fréquentiel focalisé sur la phase
- **Gestion des Préréglages**
  - Importation: Chargement des réglages d'égalisation à partir de fichiers texte au format standard
    - Exemple de format:
      ```
      Preamp: -6.0 dB
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
  - Utilisez un rehaussement HF de style BBE (Filter Type : Highshelf, SC Freq : 1200Hz, Ratio : 0.5, Attack : 1ms)
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
- **Band Settings**
  - Filter Type : choisissez entre Peak, Lowshelf ou Highshelf
  - Frequency : ajustez précisément la fréquence centrale/de coupure (20Hz-20kHz)
  - Q : contrôle de la bande passante/raideur (0.1-10.0)
  - Max Gain : réglez le gain maximal (0-24dB)
  - Threshold : réglez le niveau de déclenchement (-60dB à 0dB)
  - Ratio : contrôle l'intensité du traitement (0.1-10.0)
    - En dessous de 1.0 : Expander (améliore lorsque le signal dépasse le Threshold)
    - Au-dessus de 1.0 : Compressor (réduit lorsque le signal dépasse le Threshold)
  - Knee Width : transition douce autour du Threshold (0-30dB)
  - Attack : vitesse de déclenchement du traitement (0.1-100ms)
  - Release : vitesse de relâchement du traitement (1-1000ms)
  - Sidechain Frequency : fréquence de détection (20Hz-20kHz)
  - Sidechain Q : bande passante de détection (0.1-10.0)

### Affichage visuel
- Graphe de réponse en fréquence en temps réel
- Indicateurs de réduction de gain par bande
- Contrôles interactifs de Frequency et de Gain

## 5Band PEQ
Un égaliseur paramétrique de qualité professionnelle basé sur des principes scientifiques, offrant cinq bandes entièrement configurables avec un contrôle précis des fréquences. Parfait pour un raffinement subtil du son ainsi que pour un traitement correctif audio.

### Guide d'Amélioration Sonore
- Clarté des Voix et des Instruments:
  - Utilisez la bande 3.2kHz avec un Q modéré (1.0-2.0) pour une présence naturelle
  - Appliquez des coupes avec un Q étroit (4.0-8.0) pour éliminer les résonances
  - Ajoutez une légère sensation d'air avec une étagère haute 10kHz (+2 à +4dB)
- Contrôle de la Qualité des Basses:
  - Façonnez les fondamentaux avec un filtre en cloche à 100Hz
  - Éliminez la résonance de la pièce en utilisant un Q étroit à des fréquences spécifiques
  - Créez une extension de basse fluide avec une étagère basse
- Réglage Scientifique du Son:
  - Ciblez des fréquences spécifiques avec précision
  - Utilisez des analyseurs pour identifier les zones problématiques
  - Appliquez des corrections mesurées avec un impact de phase minimal

### Paramètres Techniques
- **Bandes de Précision**
  - Bande 1: 100Hz (Contrôle des Sub et des Basses)
  - Bande 2: 316Hz (Définition des Bas-Médiums)
  - Bande 3: 1.0kHz (Présence des Médiums)
  - Bande 4: 3.2kHz (Détail des Hauts-Médiums)
  - Bande 5: 10kHz (Extension des Hautes Fréquences)
- **Contrôles Professionnels par Bande**
  - Fréquence Centrale: Espacée logarithmiquement pour une couverture optimale
  - Plage de Gain: Réglage précis de ±20dB
  - Facteur Q: De 0.1 (large) à 10.0 (précis)
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
  - Aide les voix à se distinguer dans les mixages complexes
- Création d'Effets Spéciaux:
  - Définissez des plages de fréquences étroites pour des effets de téléphone, radio ou mégaphone
  - Utilisez des pentes plus abruptes (-36dB/oct ou plus) pour un filtrage plus dramatique
  - Expérimentez avec différentes plages de fréquences pour des sons créatifs
- Nettoyage de Plages de Fréquences Spécifiques:
  - Ciblez les fréquences problématiques avec un contrôle précis
  - Utilisez différentes pentes pour les sections passe-haut et passe-bas selon les besoins
  - Parfait pour éliminer simultanément les bruits de basse et haute fréquence

### Paramètres
- **HPF Frequency (Hz)** - Contrôle où les basses fréquences sont filtrées (1Hz à 40000Hz)
  - Valeurs inférieures: Seules les fréquences les plus basses sont éliminées
  - Valeurs supérieures: Plus de basses fréquences sont éliminées
  - Ajustez en fonction du contenu basse fréquence spécifique que vous souhaitez éliminer
- **HPF Slope** - Contrôle l'agressivité de la réduction des fréquences en dessous du point de coupure
  - Off: Aucun filtrage appliqué
  - -12dB/oct: Filtrage doux (LR2 - Linkwitz-Riley du 2ème ordre)
  - -24dB/oct: Filtrage standard (LR4 - Linkwitz-Riley du 4ème ordre)
  - -36dB/oct: Filtrage plus fort (LR6 - Linkwitz-Riley du 6ème ordre)
  - -48dB/oct: Filtrage très fort (LR8 - Linkwitz-Riley du 8ème ordre)
- **LPF Frequency (Hz)** - Contrôle où les hautes fréquences sont filtrées (1Hz à 40000Hz)
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

Un filtre en peigne numérique qui crée des effets de coloration harmonique et de résonance à travers des délais temporels précis. Ce plugin simule des phénomènes acoustiques comme les réflexions précoces des murs et des surfaces, parfait pour les passionnés d'audio qui veulent comprendre et recréer les interactions complexes entre le son et l'espace.

### Guide d'Amélioration de l'Écoute
- Simulez l'Acoustique de la Pièce:
  - Utilisez des fréquences fondamentales entre 100-500Hz pour simuler les réflexions des murs
  - Ajustez le gain de rétroaction pour contrôler l'intensité de la réflexion
  - Parfait pour comprendre comment les dimensions de la pièce affectent le son
- Créez une Coloration Harmonique:
  - Utilisez le mode d'alimentation directe pour un renforcement harmonique subtil
  - Utilisez le mode de rétroaction pour des effets de résonance plus prononcés
  - Expérimentez avec différentes fréquences fondamentales pour un caractère tonal unique
- Simulation des Réflexions Précoces:
  - Définissez la fréquence fondamentale basée sur les dimensions de la pièce (ex., 343Hz pour 1 mètre de distance)
  - Utilisez un gain de rétroaction modéré (0.3-0.7) pour une simulation réaliste des réflexions
  - Aide à recréer les caractéristiques acoustiques de différents espaces d'écoute
- Effets de Résonance et d'Écho:
  - Des valeurs plus élevées de gain de rétroaction créent une résonance plus prononcée
  - Des fréquences fondamentales plus basses créent des délais plus longs
  - Combinez avec d'autres effets pour un traitement spatial complexe

### Paramètres
- **Fréquence Fondamentale (Hz)** - Contrôle le délai temporel et l'espacement harmonique (20Hz à 20000Hz)
  - Valeurs plus basses: Délais plus longs, harmoniques plus espacés
  - Valeurs plus élevées: Délais plus courts, harmoniques plus rapprochés
  - Basé sur l'acoustique de la pièce: Fréquence = Vitesse du Son / Distance
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
- **Réponse Harmonique**: Crée des pics et des creux aux multiples entiers de la fréquence fondamentale
- **Simulation Spatiale**: Peut simuler les réflexions précoces des murs et des surfaces
- **Visualisation en Temps Réel**: Affiche la réponse en fréquence avec marqueur de fréquence fondamentale

### Affichage Visuel
- Graphique de réponse en fréquence en temps réel avec échelle de fréquence logarithmique
- Visualisation claire des pics et creux du filtre en peigne
- Marqueur de fréquence fondamentale montrant le délai temporel
- Contrôles interactifs pour un ajustement précis
- Calcul de la distance de délai en millimètres

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
  - Réglez la fréquence entre 200-500Hz pour un effet de voix de type téléphone
  - Utilisez des pentes raides (-48dB/oct ou plus) pour un filtrage dramatique
  - Combinez avec Lo Pass Filter pour des effets de passe-bande

### Paramètres
- **Frequency (Hz)** - Contrôle l'endroit où les basses fréquences sont filtrées (1Hz à 40000Hz)
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
  - Réglez la fréquence entre 1-3kHz pour un effet de radio vintage
  - Utilisez des pentes raides (-48dB/oct ou plus) pour un filtrage dramatique
  - Combinez avec Hi Pass Filter pour des effets de passe-bande
- Contrôlez le bruit et le sifflement:
  - Réglez la fréquence juste au-dessus du contenu musical (typiquement 14-18kHz)
  - Utilisez des pentes plus raides (-36dB/oct ou plus) pour un contrôle efficace du bruit
  - Réduit le sifflement des cassettes ou le bruit de fond tout en préservant l'essentiel du contenu musical

### Paramètres
- **Frequency (Hz)** - Contrôle l'endroit où les hautes fréquences sont supprimées (1Hz à 40000Hz)
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
Un égaliseur spécialisé qui ajuste automatiquement l'équilibre des fréquences en fonction de votre niveau d'écoute. Ce plugin compense la sensibilité réduite de l'oreille humaine aux basses et hautes fréquences à faible volume, garantissant une expérience d'écoute cohérente et agréable quel que soit le niveau de lecture.

### Guide d'Amélioration de l'Écoute
- Écoute à Faible Volume:
  - Renforce les fréquences de basse et d'aigus
  - Maintient l'équilibre musical à des niveaux bas
  - Compense les caractéristiques de l'audition humaine
- Traitement Dépendant du Volume:
  - Plus d'amélioration à faible volume
  - Réduction progressive du traitement à mesure que le volume augmente
  - Son naturel à des niveaux d'écoute plus élevés
- Équilibre des Fréquences:
  - Étagère basse pour l'amélioration des basses (100-300Hz)
  - Étagère haute pour l'amélioration des aigus (3-6kHz)
  - Transition fluide entre les plages de fréquences

### Paramètres
- **Average SPL** - Niveau d'écoute actuel (60dB à 85dB)
  - Valeurs inférieures : Plus d'amélioration
  - Valeurs supérieures : Moins d'amélioration
  - Représente le volume d'écoute typique
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
- Concentrez-vous sur des instruments spécifiques:
  - Isolez les fréquences basses
  - Concentrez-vous sur la plage vocale
  - Mettez en valeur des instruments spécifiques
- Éliminez les sons indésirables:
  - Réduisez le grondement des basses fréquences
  - Coupez le sifflement excessif des hautes fréquences
  - Concentrez-vous sur les parties les plus importantes de la musique

### Paramètres
- **HPF Frequency** - Contrôle l'endroit où les sons bas commencent à être réduits (20Hz à 1000Hz)
  - Valeurs supérieures : Élimine davantage de basses
  - Valeurs inférieures : Conserve plus de basses
  - Commencez avec de faibles valeurs et ajustez selon vos préférences
- **HPF Slope** - Contrôle la rapidité avec laquelle les sons bas sont atténués (0 à -48 dB/octave)
  - 0dB : Aucune réduction (off)
  - -6dB à -48dB : Réduction de plus en plus forte par paliers de 6dB
- **LPF Frequency** - Contrôle l'endroit où les sons aigus commencent à être réduits (200Hz à 20000Hz)
  - Valeurs inférieures : Élimine davantage d'aigus
  - Valeurs supérieures : Conserve plus d'aigus
  - Commencez par une valeur élevée et ajustez à la baisse si nécessaire
- **LPF Slope** - Contrôle la rapidité avec laquelle les sons aigus sont atténués (0 à -48 dB/octave)
  - 0dB : Aucune réduction (off)
  - -6dB à -48dB : Réduction de plus en plus forte par paliers de 6dB

### Affichage Visuel
- Graphique clair montrant la réponse en fréquence
- Contrôles de fréquence faciles à ajuster
- Boutons de sélection de pente simples

## Tilt EQ

Un égaliseur simple mais efficace qui incline en douceur l'équilibre des fréquences de votre musique. Conçu pour des ajustements subtils permettant de réchauffer ou d'éclaircir le son sans contrôles complexes. Idéal pour adapter rapidement la tonalité générale à vos préférences.

### Guide d'amélioration musicale
- Réchauffer la musique :
  - Utilisez des valeurs de gain négatives pour atténuer les hautes fréquences et renforcer les basses
  - Parfait pour les enregistrements trop brillants ou les écouteurs à son agressif
  - Crée une expérience d'écoute chaleureuse et relaxante
- Éclaircir la musique :
  - Utilisez des valeurs de gain positives pour accentuer les aigus et atténuer les basses
  - Idéal pour les enregistrements étouffés ou les enceintes au son mat
  - Ajoute de la clarté et de la brillance
- Réglages subtils :
  - Utilisez de faibles valeurs de gain pour des ajustements précis
  - Ajustez l'équilibre selon votre environnement d'écoute ou votre humeur

### Paramètres
- **Pivot Frequency** - Contrôle la fréquence centrale d'inclinaison (20Hz à ~20kHz)
  - Détermine le point autour duquel s'effectue l'inclinaison
- **Slope** - Contrôle la pente d'inclinaison autour de la fréquence pivot (-12 à +12dB/octave)
  - Détermine l'intensité de l'effet d'inclinaison

### Affichage
- Curseur de réglage intuitif
- Courbe de réponse en fréquence en temps réel
- Indication claire de la valeur de gain

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
