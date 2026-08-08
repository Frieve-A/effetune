---
title: "Plugins Saturation - EffeTune"
description: "Plugins de saturation et de distorsion incluant Saturation, Exciter, Hard Clipping et plus encore."
lang: fr
---

# Plugins Saturation

Une collection de plugins qui ajoutent de la chaleur et du caractère à votre musique. Ces effets peuvent donner à la musique numérique un son plus analogique et ajouter une richesse agréable au son, similaire à la coloration sonore des équipements audio vintage.

## Liste des Plugins

- [Dynamic Saturation](#dynamic-saturation) - Simule le déplacement non linéaire des cônes de haut-parleur
- [Exciter](#exciter) - Ajoute du contenu harmonique pour améliorer la clarté et la présence
- [Hard Clipping](#hard-clipping) - Ajoute de l'intensité et du mordant au son
- [Harmonic Distortion](#harmonic-distortion) - Façonne la forme d'onde avec des termes non linéaires ajustables
- [Multiband Saturation](#multiband-saturation) - Façonne et améliore différentes plages de fréquences indépendamment
- [Saturation](#saturation) - Ajoute de la chaleur et de la richesse comme un équipement vintage
- [Sub Synth](#sub-synth) - Ajoute un signal basse fréquence filtré dérivé de l'audio original
- [Tube Simulator](#tube-simulator) - Modélise des étages ligne à lampes et un amplificateur de puissance push-pull

## Dynamic Saturation

Un effet basé sur la physique qui simule le déplacement non linéaire des cônes de haut-parleur dans différentes conditions. En modélisant le comportement mécanique d'un haut-parleur, puis en appliquant une saturation à ce déplacement, il crée une forme unique de distorsion qui répond de manière dynamique à votre musique.

### Guide d'Amélioration de l'Écoute
- **Amélioration Subtile :**
  - Ajoute une chaleur douce et un léger arrondi des crêtes
  - Crée un son naturellement "poussé" sans distorsion évidente
  - Ajoute une profondeur et une dimensionnalité subtiles au son
- **Effet Modéré :**
  - Crée une distorsion plus dynamique et réactive
  - Ajoute un mouvement unique et de la vivacité aux sons soutenus
  - Donne aux transitoires un caractère mobile et réactif
- **Effet Créatif :**
  - Produit des modèles de distorsion complexes qui évoluent avec l'entrée
  - Crée des comportements résonants similaires à ceux des haut-parleurs
  - Crée un caractère marqué et évolutif pour une écoute expérimentale

### Paramètres
- **Speaker Drive** (0.0-10.0) - Contrôle la force avec laquelle le signal audio déplace le cône
  - Valeurs basses : Mouvement subtil et effet doux
  - Valeurs hautes : Mouvement dramatique et caractère plus fort
- **Speaker Stiffness** (0.0-10.0) - Simule la rigidité de la suspension du cône
  - Valeurs basses : Mouvement libre et souple avec une décroissance plus longue
  - Valeurs hautes : Mouvement contrôlé et serré avec une réponse rapide
- **Speaker Damping** (0.1-10.0) - Contrôle la rapidité avec laquelle le mouvement du cône se stabilise
  - Valeurs basses proches de 0.1 : Vibration et résonance prolongées
  - Valeurs hautes : Amortissement rapide pour un son contrôlé
- **Speaker Mass** (0.1-5.0) - Simule l'inertie du cône
  - Valeurs basses : Mouvement rapide et réactif
  - Valeurs hautes : Mouvement plus lent et plus prononcé
- **Distortion Drive** (0.0-10.0) - Contrôle l'intensité de la saturation du déplacement
  - Valeurs basses : Non-linéarité subtile
  - Valeurs hautes : Caractère de saturation fort
- **Distortion Bias** (-1.0-1.0) - Ajuste la symétrie de la courbe de saturation
  - Zéro : Saturation symétrique
  - Positif/Négatif : Ajoute un caractère asymétrique en changeant le côté du déplacement qui sature le plus fortement
- **Distortion Mix** (0-100%) - Mélange entre le déplacement linéaire et saturé
  - Valeurs basses : Réponse plus linéaire
  - Valeurs hautes : Caractère plus saturé
- **Cone Motion Mix** (0-100%) - Contrôle l'influence du mouvement du cône sur le son original
  - Valeurs basses : Amélioration subtile
  - Valeurs hautes : Effet dramatique
- **Output Gain** (-18.0-18.0dB) - Ajuste le niveau de sortie final

### Affichage Visuel
- Graphique interactif de la courbe de transfert montrant comment le déplacement est saturé
- Retour visuel clair des caractéristiques de distorsion
- Représentation visuelle de l'effet du Distortion Drive et du Bias sur le son

### Conseils d'Amélioration Musicale
- Pour une Chaleur Subtile :
  - Speaker Drive : 2.0-3.0
  - Speaker Stiffness : 1.5-2.5
  - Speaker Damping : 0.5-1.5
  - Distortion Drive : 1.0-2.0
  - Cone Motion Mix : 20-40%
  - Distortion Mix : 30-50%

- Pour un Caractère Dynamique :
  - Speaker Drive : 3.0-5.0
  - Speaker Stiffness : 2.0-4.0
  - Speaker Mass : 0.5-1.5
  - Distortion Drive : 3.0-6.0
  - Distortion Bias : Essayez ±0.2 pour un caractère asymétrique
  - Cone Motion Mix : 40-70%

- Pour un Effet Expérimental Marqué :
  - Speaker Drive : 6.0-10.0
  - Speaker Stiffness : Essayez des valeurs extrêmes (très basses ou hautes)
  - Speaker Mass : 2.0-5.0 pour un mouvement exagéré
  - Distortion Drive : 5.0-10.0
  - Expérimentez avec différentes valeurs de Bias
  - Cone Motion Mix : 70-100%

### Guide de Démarrage Rapide
1. Commencez avec un Speaker Drive modéré (3.0) et Stiffness (2.0)
2. Réglez le Speaker Damping pour contrôler la résonance (1.0 pour une réponse équilibrée)
3. Ajustez le Distortion Drive selon votre goût (3.0 pour un effet modéré)
4. Réglez d'abord Distortion Bias à 0.0 pour une saturation symétrique
5. Réglez le Distortion Mix à 50% et le Cone Motion Mix à 50%
6. Ajustez la Speaker Mass pour changer le caractère de l'effet
7. Affinez avec l'Output Gain pour équilibrer les niveaux

## Exciter

Un effet qui ajoute du contenu harmonique pour améliorer la clarté et la présence. En filtrant le contenu haute fréquence et en appliquant une saturation, il crée des harmoniques supplémentaires qui illuminent et améliorent votre musique.

### Guide d'Amélioration de l'Écoute
- **Amélioration Subtile :**
  - Ajoute de la clarté et de l'air aux voix
  - Améliore la présence des instruments
  - Crée un son plus ouvert et détaillé
- **Effet Modéré :**
  - Fait ressortir des détails cachés dans les enregistrements chargés
  - Ajoute de l'éclat et de la brillance
  - Rend la musique plus "hi-fi"
- **Effet Créatif :**
  - Crée des tonalités brillantes et tranchantes
  - Ajoute une présence agressive
  - Utile lorsque vous voulez un son plus brillant et plus en avant, mais à utiliser avec retenue

### Paramètres
- **HPF Freq** (500-10000Hz) - Définit la fréquence de coupure pour le filtrage passe-haut
  - Valeurs basses (500-2000Hz) : Affecte plus du signal
  - Valeurs moyennes (2000-5000Hz) : Cible les fréquences de présence
  - Valeurs hautes (5000-10000Hz) : Se concentre sur l'air et la brillance
- **HPF Slope** - Contrôle la pente du filtre
  - Off : Pas de filtrage, traite tout le spectre
  - 6dB/oct : Filtrage doux
  - 12dB/oct : Filtrage plus prononcé
- **Drive** (0.0-10.0) - Contrôle l'intensité de la saturation
  - Léger (0.0-3.0) : Amélioration harmonique subtile
  - Moyen (3.0-6.0) : Brillance notable
  - Élevé (6.0-10.0) : Excitation forte
- **Bias** (-0.3 à 0.3) - Ajuste l'asymétrie de la saturation
  - Zéro : Saturation symétrique
  - Positif/Négatif : Ajoute un caractère asymétrique en changeant le côté de l'amélioration générée qui sature le plus fortement
- **Mix** (0-100%) - Contrôle la quantité d'amélioration harmonique générée ajoutée au son original
  - Bas (0-30%) : Brillance ajoutée subtile
  - Moyen (30-60%) : Présence et détails plus clairs
  - Élevé (60-100%) : Harmoniques ajoutées fortes ; à utiliser prudemment pour éviter la dureté

### Affichage Visuel
- Graphique de réponse en fréquence du filtre passe-haut
- Visualisation de la courbe de transfert de saturation
- Retour visuel clair pour le filtre et la saturation

### Conseils d'Amélioration Musicale
- Pour des Voix Plus Claires dans les Morceaux, Podcasts ou Vidéos :
  - HPF Freq : 3000-5000Hz
  - HPF Slope : 6dB/oct
  - Drive : 2.0-4.0
  - Bias : 0.05 à 0.1
  - Mix : 20-40%

- Pour des Détails Médiums/Aigus Plus Clairs dans les Enregistrements Chargés :
  - HPF Freq : 2000-4000Hz
  - HPF Slope : 12dB/oct
  - Drive : 3.0-5.0
  - Bias : 0.0
  - Mix : 30-50%

- Pour une Brillance Subtile du Morceau Complet :
  - HPF Freq : 5000-8000Hz
  - HPF Slope : 6dB/oct
  - Drive : 1.0-3.0
  - Bias : 0.0 à 0.1
  - Mix : 10-25%

### Guide de Démarrage Rapide
1. Réglez HPF Freq pour cibler la plage de fréquences désirée
2. Choisissez HPF Slope (commencez avec 6dB/oct)
3. Commencez avec un Drive modéré (3.0)
4. Réglez Bias près de 0.1 pour un caractère légèrement asymétrique
5. Réglez Mix à 25% et ajustez selon votre goût
6. Affinez tous les paramètres en écoutant

## Hard Clipping

Un effet d'écrêtage numérique qui limite les crêtes au-dessus d'un seuil défini. Utilisez-le lorsque vous voulez plus de mordant, de densité ou de distorsion créative ; gardez le seuil haut pour un contrôle léger des crêtes et baissez-le progressivement pour un caractère plus fort.

### Guide d'Amélioration de l'Écoute
- Amélioration Subtile :
  - Ajoute un peu de mordant et de densité lorsque Threshold reste haut
  - Peut rogner les crêtes pointues lorsqu'il est utilisé légèrement
  - Comparez avec le bypass, car l'écrêtage peut devenir dur si on le pousse trop
- Effet Modéré :
  - Crée un son plus énergique
  - Ajoute de l'excitation aux éléments rythmiques
  - Donne à la musique une sensation plus "dynamique"
- Effet Créatif :
  - Crée des transformations sonores dramatiques
  - Ajoute du caractère agressif à la musique
  - Parfait pour l'écoute expérimentale

### Paramètres
- **Threshold** - Contrôle la quantité de son affectée (-60dB à 0dB)
  - Valeurs hautes (-6dB à 0dB) : Contrôle léger des crêtes ou mordant subtil
  - Valeurs moyennes (-24dB à -6dB) : Caractère d'écrêtage et densité notables
  - Valeurs basses (-60dB à -24dB) : Distorsion lourde et effet dramatique
- **Mode** - Choisit quelles parties du son affecter
  - Both Sides : Écrête symétriquement les crêtes positives et négatives ; mode le plus prévisible
  - Positive Only : Écrête seulement les crêtes positives, créant un écrêtage asymétrique et une couleur différente
  - Negative Only : Écrête seulement les crêtes négatives, créant un écrêtage asymétrique avec une sensation différente de Positive Only

### Affichage Visuel
- Graphique en temps réel montrant comment le son est modelé
- Retour visuel clair lors des ajustements
- Lignes de référence pour guider vos ajustements

### Conseils d'Écoute
- Pour une amélioration subtile :
  1. Commencez avec Threshold à 0dB
  2. Utilisez le mode "Both Sides"
  3. Baissez-le progressivement vers -3dB à -6dB et arrêtez-vous lorsque l'effet devient juste audible
- Pour des effets créatifs :
  1. Baissez progressivement le Threshold
  2. Essayez différents Modes
  3. Combinez avec d'autres effets pour des sons uniques

## Harmonic Distortion

Le plugin Harmonic Distortion façonne la forme d'onde avec des termes non linéaires ajustables du 2e au 5e ordre. Il permet de régler le caractère des distorsions paires et impaires, d'une chaleur subtile à une coloration plus forte, ce qui peut rendre plus vivant un son trop propre, mince ou plat.

### Guide d'amélioration de l'écoute

- **Effet subtil :**
  - Ajoute une légère couche de chaleur harmonique
  - Améliore la tonalité naturelle sans écraser le signal d'origine
  - Idéal pour apporter une profondeur subtile, rappelant l'analogique
- **Effet modéré :**
  - Ajoute un caractère harmonique plus prononcé
  - Peut ajouter du corps, de la brillance ou du mordant à l'ensemble de l'enregistrement
  - Utile lorsque le son paraît trop plat ou retenu
- **Effet agressif :**
  - Intensifie plusieurs termes non linéaires pour une distorsion riche et complexe
  - Crée des textures marquées pour une écoute expérimentale
  - Peut sonner tranchant ou inhabituel lorsqu'il est poussé fort
- **Valeurs positives vs. négatives :**
  - Les valeurs positives et négatives inversent la direction de chaque terme non linéaire
  - Les termes pairs changent surtout l'asymétrie et la couleur tonale
  - Les termes impairs changent surtout le caractère de distorsion symétrique

### Paramètres

- **2nd Harm (%):** Définit le terme de distorsion du deuxième ordre (-30 à 30%, défaut: 2%)
- **3rd Harm (%):** Définit le terme de distorsion du troisième ordre (-30 à 30%, défaut: 3%)
- **4th Harm (%):** Définit le terme de distorsion du quatrième ordre (-30 à 30%, défaut: 0.5%)
- **5th Harm (%):** Définit le terme de distorsion du cinquième ordre (-30 à 30%, défaut: 0.3%)
- **Sensitivity (x):** Ajuste la sensibilité globale de l'entrée (0.1–2.0, défaut: 0.5)
  - Une sensibilité plus faible fournit un effet plus discret
  - Une sensibilité plus élevée augmente l'intensité de la distorsion
  - Fonctionne comme un contrôle global affectant l'intensité du façonnage non linéaire

### Affichage Visuel

- Courbe de transfert montrant comment les niveaux d'entrée sont façonnés en niveaux de sortie
- Curseurs intuitifs et champs de saisie offrant un retour immédiat
- Le graphique se met à jour lorsque les réglages harmoniques et Sensitivity changent

### Guide de démarrage rapide

1. **Initialisation:** Commencez avec les réglages par défaut (2nd: 2%, 3rd: 3%, 4th: 0.5%, 5th: 0.3%, Sensitivity: 0.5)
2. **Ajustez les paramètres:** Changez un ou deux contrôles harmoniques à la fois en écoutant la dureté ou la perte de clarté
3. **Mélangez votre son:** Équilibrez l'effet à l'aide de Sensitivity pour obtenir soit une chaleur subtile, soit une distorsion prononcée

## Multiband Saturation

Un effet polyvalent qui permet d'ajouter de la chaleur et du caractère à des plages de fréquences spécifiques du signal de lecture entier. En divisant le son en bandes basses, moyennes et hautes, vous pouvez façonner chaque plage indépendamment pour une amélioration sonore précise.

### Guide d'Amélioration de l'Écoute
- Amélioration des Basses :
  - Ajoute de la chaleur et du punch aux basses fréquences
  - Ajoute de la plénitude et un léger punch à la plage grave du signal de lecture entier
  - Crée des basses plus pleines et plus riches
- Façonnage des Médiums :
  - Ajoute du corps et de la définition aux médiums où se trouvent beaucoup de voix et d'instruments
  - Aide les enregistrements chargés à paraître plus clairs
  - Crée un son plus clair et plus défini
- Amélioration des Aigus :
  - Ajoute de l'éclat aux cymbales et aux hi-hats
  - Améliore l'air et la brillance
  - Crée des aigus nets et détaillés

Comme ce traitement agit par bande de fréquences, il affecte tous les sons de la plage sélectionnée, pas des instruments ou voix isolés.

### Paramètres
- **Fréquences de Crossover**
  - Freq 1 (20Hz-2kHz) : Définit où la bande basse se termine et la bande moyenne commence
  - Freq 2 (200Hz-20kHz, toujours maintenu à Freq 1 ou au-dessus) : Définit où la bande moyenne se termine et la bande haute commence
  - Si Freq 2 est réglé sous Freq 1, il est automatiquement relevé pour préserver l'ordre basse-médium-aigu
- **Contrôles de Bande** (pour chaque bande Basse, Moyenne et Haute) :
  - **Drive** (0.0-10.0) : Contrôle l'intensité de la saturation
    - Léger (0.0-3.0) : Amélioration subtile
    - Moyen (3.0-6.0) : Chaleur notable
    - Fort (6.0-10.0) : Caractère prononcé
  - **Bias** (-0.3 à 0.3) : Ajuste la symétrie de la courbe de saturation
    - Zéro : Saturation symétrique
    - Positif/Négatif : Ajoute un caractère asymétrique en changeant le côté de la forme d'onde qui sature le plus fortement
  - **Mix** (0-100%) : Mélange l'effet avec l'original
    - Bas (0-30%) : Amélioration subtile
    - Moyen (30-70%) : Effet équilibré
    - Haut (70-100%) : Caractère prononcé
  - **Gain** (-18dB à +18dB) : Ajuste le volume de la bande
    - Utilisé pour équilibrer les bandes entre elles
    - Compense les changements de volume

### Affichage Visuel
- Onglets de sélection de bande interactifs
- Graphique de courbe de transfert en temps réel pour chaque bande
- Retour visuel clair lors des ajustements

### Conseils d'Amélioration Musicale
- Pour l'Amélioration du Morceau Complet :
  1. Commencez avec un Drive doux (2.0-3.0) sur toutes les bandes
  2. Gardez le Bias à 0.0 pour une saturation naturelle
  3. Réglez le Mix autour de 40-50% pour un mélange naturel
  4. Affinez le Gain pour chaque bande

- Pour l'Amélioration des Basses :
  1. Concentrez-vous sur la bande basse
  2. Utilisez un Drive modéré (3.0-5.0)
  3. Gardez le Bias neutre pour une réponse cohérente
  4. Gardez le Mix autour de 50-70%

- Pour la Présence des Médiums :
  1. Concentrez-vous sur la bande moyenne
  2. Utilisez un Drive léger (1.0-3.0)
  3. Gardez le Bias à 0.0 pour un son naturel
  4. Ajustez le Mix selon le goût (30-50%)

- Pour Ajouter de la Brillance :
  1. Concentrez-vous sur la bande haute
  2. Utilisez un Drive doux (1.0-2.0)
  3. Gardez le Bias neutre pour une saturation propre
  4. Gardez le Mix subtil (20-40%)

### Guide de Démarrage Rapide
1. Réglez les fréquences de crossover pour diviser votre son
2. Commencez avec des valeurs de Drive basses sur toutes les bandes
3. Réglez d'abord Bias à 0.0 pour une saturation symétrique
4. Utilisez le Mix pour mélanger l'effet naturellement
5. Affinez avec les contrôles de Gain
6. Faites confiance à vos oreilles et ajustez selon le goût !

## Saturation

Un effet qui simule le son chaud et agréable des équipements à lampes vintage. Il peut ajouter de la richesse et du caractère à votre musique, lui donnant un son plus "analogique" et moins "numérique".

### Guide d'Amélioration de l'Écoute
- Ajout de Chaleur :
  - Rend la musique numérique plus naturelle
  - Ajoute une richesse agréable au son
  - Parfait pour le jazz et la musique acoustique
- Caractère Riche :
  - Crée un son plus "vintage"
  - Ajoute de la profondeur et de la dimension
  - Excellent pour le rock et la musique électronique
- Effet Fort :
  - Transforme le son de manière dramatique
  - Crée des tonalités audacieuses et pleines de caractère
  - Idéal pour l'écoute expérimentale

### Paramètres
- **Drive** - Contrôle la quantité de chaleur et de caractère (0.0 à 10.0)
  - Léger (0.0-3.0) : Chaleur analogique subtile
  - Moyen (3.0-6.0) : Caractère riche et vintage
  - Fort (6.0-10.0) : Effet audacieux et dramatique
- **Bias** - Ajuste la symétrie de la courbe de saturation (-0.3 à 0.3)
  - 0.0 : Saturation symétrique
  - Positif : Rend le côté négatif de la forme d'onde plus présent
  - Négatif : Rend le côté positif de la forme d'onde plus présent
- **Mix** - Équilibre l'effet avec le son original (0% à 100%)
  - 0-30% : Amélioration subtile
  - 30-70% : Effet équilibré
  - 70-100% : Caractère fort
- **Gain** - Ajuste le volume global (-18dB à +18dB)
  - Utilisez des valeurs négatives si l'effet est trop fort
  - Utilisez des valeurs positives si l'effet est trop faible

### Affichage Visuel
- Graphique clair montrant comment le son est modelé
- Retour visuel en temps réel
- Contrôles faciles à lire

### Conseils d'Amélioration Musicale
- Classique & Jazz :
  - Drive léger (1.0-2.0) pour une chaleur naturelle
  - Gardez le Bias à 0.0 pour une saturation propre
  - Mix bas (20-40%) pour la subtilité
- Rock & Pop :
  - Drive moyen (3.0-5.0) pour un caractère riche
  - Gardez le Bias neutre pour une réponse cohérente
  - Mix moyen (40-60%) pour l'équilibre
- Électronique :
  - Drive plus élevé (4.0-7.0) pour un effet audacieux
  - Expérimentez avec différentes valeurs de Bias
  - Mix plus élevé (60-80%) pour le caractère

### Guide de Démarrage Rapide
1. Commencez avec un Drive bas pour une chaleur douce
2. Réglez d'abord Bias à 0.0 pour une saturation symétrique
3. Ajustez Mix pour équilibrer l'effet
4. Ajustez Gain si nécessaire pour un volume approprié
5. Expérimentez et faites confiance à vos oreilles !

## Sub Synth

Un effet spécialisé qui renforce le bas du spectre en mélangeant un signal basse fréquence filtré dérivé de l'audio original. Utile lorsqu'une musique légère en basses a besoin de plus de chaleur, de plénitude ou d'impact au casque.

### Guide d'Amélioration de l'Écoute
- Amélioration des Graves :
  - Ajoute de la profondeur et de la puissance aux enregistrements fins
  - Crée des graves plus pleines et plus riches
  - Parfait pour l'écoute au casque
- Contrôle de Fréquence :
  - Contrôle la plage basse fréquence ajoutée qui est conservée
  - Filtrage indépendant pour des graves propres
  - Maintient la clarté tout en ajoutant de la puissance

### Paramètres
- **Sub Level** - Contrôle le niveau du signal basse fréquence ajouté (0-200%)
  - Léger (0-50%) : Amélioration subtile des graves
  - Moyen (50-100%) : Renforcement équilibré des graves
  - Fort (100-200%) : Effet dramatique sur les graves
- **Dry Level** - Ajuste le niveau du signal original (0-200%)
  - Utilisé pour équilibrer avec le signal basse fréquence ajouté
  - Maintient la clarté du son original
- **Sub LPF** - Filtre passe-bas pour le signal basse fréquence ajouté (5-400Hz)
  - Fréquence : Contrôle la limite supérieure du signal basse fréquence ajouté
  - Pente : Ajuste la pente du filtre (Off à -24dB/oct)
- **Sub HPF** - Filtre passe-haut pour le signal basse fréquence ajouté (5-400Hz)
  - Fréquence : Élimine le grondement indésirable du signal basse fréquence ajouté
  - Pente : Contrôle la pente du filtre (Off à -24dB/oct)
- **Dry HPF** - Filtre passe-haut pour le signal original (5-400Hz)
  - Fréquence : Prévient l'accumulation des graves
  - Pente : Ajuste la pente du filtre (Off à -24dB/oct)

### Affichage Visuel
- Graphique interactif de réponse en fréquence
- Visualisation claire des courbes de filtre
- Retour visuel en temps réel

### Conseils d'Amélioration Musicale
- Pour l'Amélioration Générale des Graves :
  1. Commencez avec Sub Level à 50%
  2. Réglez Sub LPF autour de 100Hz (-12dB/oct)
  3. Gardez Sub HPF à 20Hz (-6dB/oct)
  4. Ajustez Dry Level selon le goût

- Pour un Renforcement Propre des Graves :
  1. Réglez Sub Level à 70-100%
  2. Utilisez Sub LPF à 80Hz (-18dB/oct)
  3. Réglez Sub HPF à 30Hz (-12dB/oct)
  4. Réglez Dry HPF à 40Hz (-6dB/oct)

- Pour un Impact Maximum :
  1. Augmentez Sub Level jusqu'à 150%
  2. Réglez Sub LPF à 120Hz (-24dB/oct)
  3. Gardez Sub HPF à 15Hz (-6dB/oct)
  4. Équilibrez avec Dry Level

### Guide de Démarrage Rapide
1. Commencez avec un Sub Level modéré (50-70%)
2. Réglez Sub LPF autour de 100Hz
3. Activez Sub HPF autour de 20Hz (-6dB/oct)
4. Ajustez Dry Level pour l'équilibre
5. Affinez les filtres selon les besoins
6. Faites confiance à vos oreilles et ajustez progressivement !

## Tube Simulator

Tube Simulator modélise une chaîne électrique complète à partir de valeurs de composants de circuits à lampes. **Line** utilise seul l'amplificateur de petit signal à deux étages. **Push-Pull Power** envoie ce même driver, via un volume fixe, vers un déphaseur 12AX7 résolu comme une paire différentielle de lampes réelles, puis vers deux lampes de sortie EL84 ou EL34, un transformateur de sortie et une charge de haut-parleur dépendante de la fréquence. Le bias, le B+, le transformateur et la charge évoluent avec le signal : les harmoniques, la compression, l'affaissement de l'alimentation et l'amortissement électrique réagissent donc à la musique. La charge de haut-parleur représente la charge électrique vue par l'amplificateur, et non une enceinte ou un microphone.

### Guide de Réglage du Son

- Le plugin démarre sur **EL84 Pentode @2%** : un convertisseur N/A de 2 Vrms n'a donc rien à régler. Les vraies valeurs par défaut du produit sont Input Reference 2.828 Vpk, Input Volume -55.9648dB, 12AX7, Negative Feedback 3dB et Output Trim +4.626dB, ce qui place le circuit push-pull EL84 à 2% de distorsion harmonique totale à gain unitaire.
- Si la saturation est trop forte, baissez Input Volume pour réduire la tension interne, puis restaurez uniquement le volume d'écoute avec Output Trim. Output Trim ne recrée pas de marge dans le circuit.
- Choisissez **Line Default** lorsque vous voulez le circuit de ligne petit signal seul plutôt qu'un amplificateur de puissance.
- Utilisez les presets **Listening (THD-matched)** pour comparer les lampes et les circuits sur le seul caractère sonore. Ils sont déjà égalisés en volume entre eux : aucun ajustement n'est nécessaire d'un preset à l'autre.
- Pour une réponse de puissance mesurée, commencez avec **EL84 Distributed 10 W**. Comparez-le à **EL84 Pentode 10 W** pour entendre l'effet du raccordement de l'écran et de la charge du transformateur avec les mêmes lampes.
- Choisissez **EL34 Distributed 20–37 W** pour explorer le circuit EL34 à tension plus élevée. Égalisez le volume avec Output Trim avant toute comparaison avec EL84.
- Une valeur Negative Feedback plus basse laisse davantage entendre les harmoniques et variations de niveau en boucle ouverte ; une valeur plus haute contrôle davantage la réponse en boucle fermée. Si une combinaison extrême active le contournement de sécurité, revenez à un preset.
- Baissez Wet/Dry Mix pour n'ajouter le circuit que discrètement.

### Disposition du Panneau

Les 20 paramètres sont répartis sur cinq onglets, sous la liste déroulante **Preset**.

- **Input** - Input Volume, Input Reference, Source Z
- **Driver** - Tube, Bias, Plate, Supply, Negative Feedback
- **Power** - Output Circuit, Power Tubes, Output B+, Cathode Resistor
- **Transformer** - Screen Tap, Transformer Primary, Assumed Speaker Load, Actual Speaker Load
- **Output** - Output Trim, Output Safety Trim, Auto Gain Reduction, Wet/Dry Mix

La liste Preset commence par **Custom**, suivi des groupes **Listening (THD-matched)** et **Circuit** ; Custom s'affiche dès que les réglages ne correspondent à aucun preset ; les réglages de protection de sortie (Output Safety Trim et Auto Gain Reduction) ne font pas partie de cette comparaison. Tant que Output Circuit est sur Line, les sept commandes du circuit de puissance des onglets Power et Transformer sont grisées. Elles restent réglables et conservent leurs valeurs.

### Presets de Circuit et Valeurs par Défaut

Le plugin s'ouvre sur le preset d'écoute **EL84 Pentode @2%**. Un preset applique tout le circuit du tableau ; toute modification ultérieure crée un réglage personnalisé.

| Circuit Preset | Output Circuit | Driver / lampes de sortie | Negative Feedback | Réglages de puissance | Entrée / sortie |
| --- | --- | --- | ---: | --- | --- |
| Line Default | Line | 12AU7 / — | 30dB | Les commandes de puissance sont conservées mais grisées | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim +9dB |
| EL84 Pentode 10 W | Push-Pull Power | 12AX7 / EL84 ×2 | 3dB | Output B+ 329.696 V, Cathode Resistor 270 Ω / valve, Screen Tap 0%, Transformer Primary 8.0 kΩ, Assumed Speaker Load 15 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |
| EL84 Distributed 10 W | Push-Pull Power | 12AX7 / EL84 ×2 | 3dB | Output B+ 330.107 V, Cathode Resistor 270 Ω / valve, Screen Tap 20%, Transformer Primary 6.6 kΩ, Assumed Speaker Load 15 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |
| EL34 Distributed 20–37 W | Push-Pull Power | 12AX7 / EL34 ×2 | 4dB | Output B+ 443.775 V, Cathode Resistor 470 Ω / valve, Screen Tap 43%, Transformer Primary 6.6 kΩ, Assumed Speaker Load 8 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |

Les quatre presets utilisent Bias 0%, Plate 250 V, Source Z 10 kΩ, Supply 10 kΩ et Wet/Dry Mix 100%. Chaque preset règle en outre Actual Speaker Load sur son Assumed Speaker Load : il démarre donc au point de conception du circuit.

### Presets d'Écoute

Le groupe **Listening (THD-matched)** contient sept réglages étalonnés. Chacun hérite de toutes les valeurs de circuit du preset Circuit dont il dérive, et seuls Input Volume, Input Reference et Output Trim sont étalonnés : le circuit lui-même reste intact. Les sept se situent à ±0.0005dB du même niveau à 1 kHz, si bien que passer de l'un à l'autre change le caractère et non le volume.

| Listening Preset | Basé sur | Modification du circuit | Input Volume | Input Reference | Output Trim |
| --- | --- | --- | ---: | ---: | ---: |
| Line 12AU7 @1% | Line Default | — | 0dB | 20 Vpk | -7.749dB |
| Line 12AT7 @1% | Line Default | Tube 12AT7 | -3.6973dB | 2.828 Vpk | -9.42dB |
| Line 12AX7 @1% | Line Default | Tube 12AX7 | -4.4805dB | 2.828 Vpk | -11.276dB |
| Line 12AU7 Open-Loop @3% | Line Default | Negative Feedback 0dB | -16.793dB | 2.828 Vpk | +26.427dB |
| EL84 Pentode @2% | EL84 Pentode 10 W | — | -55.9648dB | 2.828 Vpk | +4.626dB |
| EL84 Distributed @2% | EL84 Distributed 10 W | — | -52.9414dB | 2.828 Vpk | +4.908dB |
| EL34 Distributed @2% | EL34 Distributed 20–37 W | — | -43.6504dB | 2.828 Vpk | +5.212dB |

Le circuit ligne à 12AU7 reste juste en deçà de 1% de distorsion, même au maximum d'Input Reference : Line 12AU7 @1% se place donc à la valeur la plus haute que ce circuit atteigne.

### Paramètres
- **Preset** - Charge un preset Circuit (Line Default ou l'un des trois circuits de puissance complets) ou l'un des réglages Listening (THD-matched)
- **Input Volume** (-96 à 0dB) - Atténuateur passif placé après les bornes d'entrée
  - 0dB correspond à l'ouverture maximale et n'amplifie jamais la tension d'entrée
  - Une valeur plus basse réduit la tension appliquée à Stage 1 et augmente la marge interne
- **Tube** (12AX7, 12AT7 ou 12AU7) - Sélectionne les lampes du driver à deux étages
  - 12AX7 offre le gain en tension le plus élevé et se sollicite le plus facilement
  - 12AT7 offre un gain intermédiaire
  - 12AU7 offre un gain plus faible et davantage de marge
  - En Power, ce circuit reste le driver et attaque le déphaseur 12AX7 fixe via un volume fixe ; changer Tube réinitialise l'état pour la lampe sélectionnée
- **Bias** (-50 à +50%) - Déplace le point de fonctionnement de la polarisation de cathode
  - L'augmenter réduit la résistance de cathode modélisée et déplace les étages vers un courant plus élevé
  - Le diminuer augmente la résistance de cathode et déplace les étages vers un courant plus faible
- **Plate** (150 à 300V) - Règle la tension d'alimentation de plaque modélisée
  - L'augmenter offre généralement davantage de marge en tension et une réponse plus ferme
  - La réduire fait apparaître plus tôt la compression et les comportements non linéaires
- **Source Z** (0.6 à 100kΩ) - Règle l'impédance de la source qui alimente le premier étage
  - L'augmenter renforce l'interaction avec les capacités d'entrée modélisées et adoucit l'aigu ainsi que les transitoires
  - La réduire commande l'entrée plus fermement et préserve davantage d'énergie dans l'aigu
- **Supply** (0.1 à 47kΩ) - Règle la résistance de l'alimentation B+ modélisée
  - L'augmenter accentue la chute du B+ lorsque les étages consomment du courant, ce qui rend l'affaissement de l'alimentation plus marqué
  - La réduire rend l'alimentation plus ferme et limite ses variations
- **Negative Feedback** (0 à 30dB) - Règle la contre-réaction globale étalonnée
  - Line reprend la réponse de plaque du second étage ; Push-Pull Power emploie un enroulement secondaire fixe du transformateur
  - L'augmenter réduit généralement le gain et la distorsion en boucle ouverte et raffermit la réponse ; 0dB ouvre la boucle
  - L'amortissement électrique de la charge du haut-parleur naît de cette boucle elle-même : l'augmenter renforce donc aussi la tenue de l'amplificateur sur la charge
- **Output Trim** (-48 à +48dB) - Applique un étalonnage numérique du niveau après le circuit modélisé
  - Il ne modifie que le niveau du signal traité et n'augmente pas la marge interne des étages à lampes
- **Output Safety Trim** (-96 à 0dB) - Applique après le circuit modélisé un réglage de niveau linéaire distinct d'Output Trim, réservé à la protection du niveau de sortie
  - Auto Gain Reduction n'abaisse que ce réglage ; il n'écrit jamais dans Output Trim
  - Le curseur et son champ de valeur affichent le réglage effectif, c'est-à-dire la valeur que vous avez fixée moins la réduction automatique appliquée à cet instant ; le réglage mémorisé est la dernière valeur que vous avez fixée vous-même, et c'est elle qui est enregistrée
  - Lorsque vous saisissez le curseur, la valeur effective affichée devient votre réglage : le niveau ne saute donc pas, et la réduction accumulée est effacée à ce moment-là
- **Auto Gain Reduction** (activé par défaut) - Autorise la protection du niveau de sortie à réduire elle-même Output Safety Trim
  - Lorsqu'il est désactivé, aucune nouvelle réduction ne s'accumule et la réduction déjà appliquée est conservée
- **Wet/Dry Mix** (0 à 100%) - Mélange les signaux original et traité alignés dans le temps
  - Une valeur basse préserve davantage le signal original ; une valeur élevée met en avant la réponse du modèle à lampes
  - Même à 0%, la voie directe reste retardée de 64 samples afin de préserver l'alignement
- **Input Reference** (0.100 à 20.000 Vpk) - Définit la tension de crête aux bornes d'entrée représentée par une crête numérique de 0dBFS
  - 2.828 Vpk correspond à une sinusoïde de 2 Vrms à pleine échelle ; 5.657 Vpk correspond à 4 Vrms
  - Stage 1 reçoit Input Reference multiplié par Input Volume avant le suréchantillonnage
  - Il s'agit d'un étalonnage physique de l'entrée, et non d'une commande d'excitation supplémentaire
- **Output Circuit** (Line ou Push-Pull Power) - Sélectionne la topologie. Line s'arrête après le driver à deux étages ; Power ajoute le déphaseur, les lampes de sortie, le transformateur et la charge
- **Power Tubes** (EL84 ×2 ou EL34 ×2) - Sélectionne le modèle de courant des lampes de sortie et les composants associés ; actif uniquement en Power
  - Les deux modèles suivent des données réelles de lampes de sortie en plaque, écran et grille, y compris le blocage complet atteint lorsque la grille devient suffisamment négative
- **Output B+** (300 à 470 V) - Règle l'alimentation de puissance ; l'augmenter accroît l'excursion disponible et la dissipation des lampes
- **Cathode Resistor** (270 à 500 Ω / valve) - Règle la résistance de polarisation de chaque lampe ; l'augmenter réduit le courant de repos, la diminuer l'accroît
- **Screen Tap** (0%, 20% ou 43%) - 0% utilise l'alimentation d'écran fixe ; 20% et 43% relient les écrans aux prises primaires correspondantes pour la charge répartie (ultralinéaire)
  - La prise est un rapport de spires : les écrans suivent donc cette part du couplage magnétique de l'enroulement primaire
- **Transformer Primary** (6.0, 6.6 ou 8.0 kΩ) - Sélectionne l'impédance primaire plaque à plaque et, avec Assumed Speaker Load, le rapport de transformation
- **Assumed Speaker Load** (4, 8, 15 ou 16 Ω) - Sélectionne la prise du secondaire et l'impédance nominale autour de laquelle le circuit est conçu. Chaque choix emploie une charge RLC électrique dépendante de la fréquence, pas une simple résistance, et agit sur le transformateur et la contre-réaction
- **Actual Speaker Load** (2 à 32 Ω) - Règle l'impédance du haut-parleur réellement raccordé à cette prise
  - Le réseau de charge est mis à l'échelle par son rapport à Assumed Speaker Load : la fréquence de résonance et le Q sont conservés, seul le niveau d'impédance change
  - Le rapport de transformation reste calé sur Assumed Speaker Load : un écart renvoie donc une autre impédance vers les lampes de sortie et modifie l'amortissement, la puissance disponible et l'excitation ; avec les deux valeurs identiques, le circuit fonctionne à son point de conception

### Protection du Niveau de Sortie

Les presets de Circuit ne sont pas égalisés en niveau entre eux. Passer Tube de 12AU7 à 12AX7 élève le niveau d'environ 25dB, et passer Output Circuit de Line à Push-Pull Power l'élève d'environ 33dB, car les deux circuits se normalisent sur des références de pleine échelle différentes. Output Safety Trim et Auto Gain Reduction protègent de ce saut le matériel raccordé à la sortie.

- Chaque fois que l'amplitude d'un échantillon de sortie dépasse 0 dBFS crête, Output Safety Trim est abaissé immédiatement, exactement de ce dont cet échantillon dépasse. Tous les échantillons sont examinés : il n'y a donc ni fenêtre de détection ni moyennage. Le seuil est une valeur de politique fixe.
- La réduction est appliquée par une rampe unidirectionnelle de 20 ms, de sorte que le niveau évolue sans marche.
- Elle ne fait que réduire et ne rétablit jamais. Il n'y a ni release ni reprise : ce n'est donc ni un limiteur ni un niveleur automatique.
- Le curseur et son champ de valeur affichent le réglage effectif, soit votre réglage moins la réduction appliquée à cet instant. Le réglage mémorisé reste la dernière valeur que vous avez fixée vous-même, et c'est elle qui est enregistrée.
- La réduction accumulée est effacée lorsque vous saisissez vous-même Output Safety Trim. La valeur effective affichée devient alors votre réglage, de sorte que le niveau ne saute pas.
- Le chargement d'un preset ramène Output Safety Trim à 0dB. La réduction accumulée est effacée lorsque la valeur du réglage change elle-même ou lorsqu'une même écriture change deux valeurs ou plus à la fois, comme le fait normalement le chargement d'un preset ; resélectionner le preset sur lequel le circuit se trouve déjà après avoir déplacé une seule commande ne change que cette valeur et conserve la réduction.
- Avec Auto Gain Reduction désactivé, aucune nouvelle réduction ne s'accumule et la réduction déjà appliquée est conservée.
- La réduction en cours est indiquée dans la ligne de statut sous le graphique, y compris lorsqu'elle vaut 0.0 dB.
- Le mécanisme se situe en dehors du modèle d'amplificateur. La résolution du circuit, les harmoniques, la compression et l'affaissement de l'alimentation restent inchangés ; seul le niveau de sortie change, jamais le caractère de la surcharge. Ce qu'il supprime, c'est le dépassement numérique de la pleine échelle en sortie, et non la distorsion produite par le modèle.

### Contournement de Sécurité et Reprise

- Si une oscillation de contre-réaction est détectée, le signal traité s'estompe vers la voie directe alignée en latence et le contournement sûr est verrouillé. Baissez Negative Feedback, choisissez un preset ou modifiez un autre réglage. Le nouveau circuit est testé pendant que la sortie reste directe ; s'il est stable, le signal traité revient progressivement, sinon le contournement demeure actif.
- Pour toute autre défaillance de sécurité du traitement, le plugin passe à la sortie directe sûre. Restaurez le circuit par défaut, puis rechargez l'effet.
- Une fréquence ou un mode de canal incompatible, WebAssembly indisponible ou l'arrêt du moteur activent aussi le contournement. Le statut sous le HUD indique la marche à suivre.

### Lecture du HUD
- **Input Reference (0 dBFS)** affiche la tension aux bornes d'entrée en Vpk, la valeur Vrms d'une sinusoïde et la valeur pleine échelle correspondante en dBu (**dBuFS**)
- **Stage 1 External Input (0 dBFS)** affiche la tension de crête après Input Volume, mais avant le réseau d'entrée modélisé
- **Stage 1 bias** et **Stage 2 bias** indiquent la tension actuelle de polarisation de cathode des canaux gauche et droit
- **B+** indique la tension d'alimentation instantanée après l'affaissement modélisé
- **Plate − B+ sag** indique la tension de plaque de chaque étage par rapport au B+ ; une valeur plus négative correspond à une chute plus importante
- En Line, les deux graphiques montrent les caractéristiques de plaque et les points de fonctionnement récents de Stage 1 et Stage 2, tracés comme des points distincts et non comme une ligne continue
  - L'axe horizontal représente la tension anode-cathode, **Vak (V)**, et l'axe vertical le courant de plaque, **Ia (mA)**
  - Les fines courbes grises sont les caractéristiques de plaque statiques du tube pour plusieurs valeurs de **Vgk** ; la ligne pointillée plus claire est la droite de charge du circuit
  - Le cyan correspond au canal gauche et l'orange au canal droit ; des points répartis plus largement traduisent une plage de fonctionnement plus large
- En Push-Pull Power, ils deviennent les droites de charge **Push** et **Pull** et tracent en points les courants récents des deux lampes de sortie
- **Power LTP Balance** indique la tension différentielle du déphaseur et **Power B+** l'alimentation de puissance après affaissement
- **Speaker Output (100 ms)** et **Speaker Real Power (100 ms)** sont des mesures électriques sur des fenêtres non chevauchantes de 100 ms. Real Power utilise tension et courant instantanés, et non un simple calcul Vrms²/impédance nominale
- **Transformer Flux** indique le flux magnétique modélisé en webers. Les mesures de puissance n'ont de sens qu'avec Push-Pull Power
- Le statut sous le graphique indique si le traitement se charge, est actif ou est contourné en toute sécurité, et affiche toujours la réduction en cours de la protection de sortie en dB, y compris lorsqu'elle vaut 0.0 dB

### Conditions de Traitement et Latence
- Tube Simulator traite les signaux à 44.1, 48, 88.2, 96, 176.4 et 192 kHz avec WebAssembly
- La famille 44.1 kHz est traitée en interne à 352.8 kHz, et la famille 48 kHz à 384 kHz
- À 44.1 ou 48 kHz, l'avertissement général de faible fréquence d'échantillonnage reste affiché, car la source ne contient pas les informations de haute fréquence disponibles aux fréquences supérieures
- Les modes Stereo et paire de canaux sont pris en charge ; les autres fréquences ou modes utilisent la voie de contournement
- Les filtres de suréchantillonnage ajoutent une latence fixe de 64 samples à toutes les fréquences prises en charge (environ 1.45ms à 44.1 kHz et 0.33ms à 192 kHz)
