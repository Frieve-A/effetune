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
