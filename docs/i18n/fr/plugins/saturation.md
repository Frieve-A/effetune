---
title: "Saturation Plugins - EffeTune"
description: "Saturation and distortion plugins including Saturation, Exciter, Hard Clipping, and more."
lang: en
---

# Saturation Plugins

Une collection de plugins qui ajoutent de la chaleur et du caractère à votre musique. Ces effets peuvent donner à la musique numérique un son plus analogique et ajouter une richesse agréable au son, similaire à la coloration sonore des équipements audio vintage.

## Plugin List

- [Dynamic Saturation](#dynamic-saturation) - Simule le déplacement non linéaire des cônes de haut-parleur
- [Exciter](#exciter) - Ajoute du contenu harmonique pour améliorer la clarté et la présence
- [Hard Clipping](#hard-clipping) - Ajoute de l'intensité et du mordant au son
- [Harmonic Distortion](#harmonic-distortion) - Apporte un caractère unique via la distorsion harmonique avec contrôle indépendant de chaque harmonique
- [Multiband Saturation](#multiband-saturation) - Façonne et améliore différentes plages de fréquences indépendamment
- [Saturation](#saturation) - Ajoute de la chaleur et de la richesse comme un équipement vintage
- [Sub Synth](#sub-synth) - Génère et mélange des signaux sous-harmoniques pour l'amélioration des graves

## Dynamic Saturation

Un effet basé sur la physique qui simule le déplacement non linéaire des cônes de haut-parleur dans différentes conditions. En modélisant le comportement mécanique d'un haut-parleur, puis en appliquant une saturation à ce déplacement, il crée une forme unique de distorsion qui répond de manière dynamique à votre musique.

### Guide d'Amélioration de l'Écoute
- **Amélioration Subtile :**
  - Ajoute une chaleur douce et un léger comportement de type compression
  - Crée un son naturellement "poussé" sans distorsion évidente
  - Ajoute une profondeur et une dimensionnalité subtiles au son
- **Effet Modéré :**
  - Crée une distorsion plus dynamique et réactive
  - Ajoute un mouvement unique et de la vivacité aux sons soutenus
  - Accentue les transitoires avec une compression naturelle
- **Effet Créatif :**
  - Produit des modèles de distorsion complexes qui évoluent avec l'entrée
  - Crée des comportements résonants similaires à ceux des haut-parleurs
  - Permet des possibilités dramatiques de design sonore

### Paramètres
- **Speaker Drive** (0.0-10.0) - Contrôle la force avec laquelle le signal audio déplace le cône
  - Valeurs basses : Mouvement subtil et effet doux
  - Valeurs hautes : Mouvement dramatique et caractère plus fort
- **Speaker Stiffness** (0.0-10.0) - Simule la rigidité de la suspension du cône
  - Valeurs basses : Mouvement libre et souple avec une décroissance plus longue
  - Valeurs hautes : Mouvement contrôlé et serré avec une réponse rapide
- **Speaker Damping** (0.0-10.0) - Contrôle la rapidité avec laquelle le mouvement du cône se stabilise
  - Valeurs basses : Vibration et résonance prolongées
  - Valeurs hautes : Amortissement rapide pour un son contrôlé
- **Speaker Mass** (0.1-5.0) - Simule l'inertie du cône
  - Valeurs basses : Mouvement rapide et réactif
  - Valeurs hautes : Mouvement plus lent et plus prononcé
- **Distortion Drive** (0.0-10.0) - Contrôle l'intensité de la saturation du déplacement
  - Valeurs basses : Non-linéarité subtile
  - Valeurs hautes : Caractère de saturation fort
- **Distortion Bias** (-1.0-1.0) - Ajuste la symétrie de la courbe de saturation
  - Négatif : Accentue le déplacement négatif
  - Zéro : Saturation symétrique
  - Positif : Accentue le déplacement positif
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

- Pour un Design Sonore Créatif :
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
4. Gardez initialement le Distortion Bias à 0.0
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
  - Révèle les détails cachés dans le mix
  - Ajoute de l'éclat et de la brillance
  - Rend la musique plus "hi-fi"
- **Effet Créatif :**
  - Crée des tonalités brillantes et tranchantes
  - Ajoute une présence agressive
  - Parfait pour les styles de production modernes

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
  - Négatif : Accentue les portions négatives du signal
  - Zéro : Saturation symétrique
  - Positif : Accentue les portions positives du signal
- **Mix** (0-100%) - Mélange le signal excité avec le signal sec
  - Bas (0-30%) : Amélioration subtile
  - Moyen (30-60%) : Effet équilibré
  - Élevé (60-100%) : Excitation forte

### Affichage Visuel
- Graphique de réponse en fréquence du filtre passe-haut
- Visualisation de la courbe de transfert de saturation
- Retour visuel clair pour le filtre et la saturation

### Conseils d'Amélioration Musicale
- Pour la Présence Vocale :
  - HPF Freq : 3000-5000Hz
  - HPF Slope : 6dB/oct
  - Drive : 2.0-4.0
  - Bias : 0.05 à 0.1
  - Mix : 20-40%

- Pour la Clarté des Instruments :
  - HPF Freq : 2000-4000Hz
  - HPF Slope : 12dB/oct
  - Drive : 3.0-5.0
  - Bias : 0.0
  - Mix : 30-50%

- Pour l'Amélioration du Bus Master :
  - HPF Freq : 5000-8000Hz
  - HPF Slope : 6dB/oct
  - Drive : 1.0-3.0
  - Bias : 0.0 à 0.1
  - Mix : 10-25%

### Guide de Démarrage Rapide
1. Réglez HPF Freq pour cibler la plage de fréquences désirée
2. Choisissez HPF Slope (commencez avec 6dB/oct)
3. Commencez avec un Drive modéré (3.0)
4. Gardez le Bias proche de 0.1 pour la brillance
5. Réglez Mix à 25% et ajustez selon votre goût
6. Affinez tous les paramètres en écoutant

## Hard Clipping

Un effet qui peut ajouter tout, de la chaleur subtile au caractère intense à votre musique. Il fonctionne en modelant doucement ou agressivement les ondes sonores, créant tout, de l'amélioration douce aux effets dramatiques.

### Guide d'Amélioration de l'Écoute
- Amélioration Subtile :
  - Rend la musique numérique légèrement plus chaleureuse
  - Ajoute une qualité douce "type analogique"
  - Maintient la clarté tout en réduisant la dureté
- Effet Modéré :
  - Crée un son plus énergique
  - Ajoute de l'excitation aux éléments rythmiques
  - Donne à la musique une sensation plus "dynamique"
- Effet Créatif :
  - Crée des transformations sonores dramatiques
  - Ajoute du caractère agressif à la musique
  - Parfait pour l'écoute expérimentale

### Parameters
- **Threshold** - Contrôle la quantité de son affectée (-60dB à 0dB)
  - Valeurs hautes (-6dB à 0dB) : Chaleur subtile
  - Valeurs moyennes (-24dB à -6dB) : Caractère notable
  - Valeurs basses (-60dB à -24dB) : Effet dramatique
- **Mode** - Choisit quelles parties du son affecter
  - Both Sides : Effet équilibré et naturel
  - Positive Only : Son plus brillant et agressif
  - Negative Only : Caractère plus sombre et unique

### Affichage Visuel
- Graphique en temps réel montrant comment le son est modelé
- Retour visuel clair lors des ajustements
- Lignes de référence pour guider vos ajustements

### Conseils d'Écoute
- Pour une amélioration subtile :
  1. Commencez avec un Threshold élevé (-6dB)
  2. Utilisez le mode "Both Sides"
  3. Écoutez la chaleur ajoutée
- Pour des effets créatifs :
  1. Baissez progressivement le Threshold
  2. Essayez différents Modes
  3. Combinez avec d'autres effets pour des sons uniques

## Harmonic Distortion

Le plugin Harmonic Distortion introduit un effet de distorsion harmonique qui va au-delà de la saturation traditionnelle. Contrairement à la saturation standard qui ajoute des harmoniques selon un schéma fixe, cet effet permet un contrôle indépendant de chaque composante harmonique. En injectant délibérément des composantes harmoniques contrôlées avec des ajustements individuels précis, il crée des interactions complexes qui enrichissent votre son avec de nouvelles textures et un caractère dynamique.

### Guide d'amélioration de l'écoute

- **Effet subtil :**
  - Ajoute une légère couche de chaleur harmonique
  - Améliore la tonalité naturelle sans écraser le signal d'origine
  - Idéal pour apporter une profondeur subtile, rappelant l'analogique
- **Effet modéré :**
  - Met en évidence des harmoniques distinctes pour un caractère plus marqué
  - Apporte clarté et luminosité à divers éléments musicaux
  - Idéal pour les genres nécessitant un son équilibré et enrichi
- **Effet agressif :**
  - Intensifie plusieurs harmoniques pour créer une distorsion riche et complexe
  - Offre des possibilités créatives de design sonore pour des pistes expérimentales
  - Parfait pour ajouter des textures audacieuses et non conventionnelles
- **Valeurs positives vs. négatives :**
  - Valeurs positives : Créent un effet de type compression, contrôlant les pics et ajoutant de la chaleur avec une plus grande densité
  - Valeurs négatives : Génèrent un effet de type expansion, accentuant la dynamique et créant des sons plus ouverts et aérés

### Paramètres

- **2nd Harm (%):** Contrôle la quantité de deuxième harmonique ajoutée (-30 à 30%, défaut: 2%)
- **3rd Harm (%):** Ajuste la contribution de la troisième harmonique (-30 à 30%, défaut: 3%)
- **4th Harm (%):** Modifie l'intensité de la quatrième harmonique (-30 à 30%, défaut: 0.5%)
- **5th Harm (%):** Définit le niveau de la cinquième harmonique (-30 à 30%, défaut: 0.3%)
- **Sensitivity (x):** Ajuste la sensibilité globale de l'entrée (0.1–2.0, défaut: 0.5)
  - Une sensibilité plus faible fournit un effet plus discret
  - Une sensibilité plus élevée augmente l'intensité de la distorsion
  - Fonctionne comme un contrôle global affectant l'intensité de toutes les harmoniques

### Affichage Visuel

- Visualisation en temps réel de l'interaction harmonique et de la courbe de distorsion
- Curseurs intuitifs et champs de saisie offrant un retour immédiat
- Graphique dynamique affichant les modifications du contenu harmonique lors des ajustements des paramètres

### Guide de démarrage rapide

1. **Initialisation:** Commencez avec les réglages par défaut (2nd: 2%, 3rd: 3%, 4th: 0.5%, 5th: 0.3%, Sensitivity: 0.5)
2. **Ajustez les paramètres:** Utilisez le retour en temps réel pour ajuster précisément chaque niveau harmonique en fonction de votre contexte musical
3. **Mélangez votre son:** Équilibrez l'effet à l'aide de Sensitivity pour obtenir soit une chaleur subtile, soit une distorsion prononcée

## Multiband Saturation

Un effet polyvalent qui permet d'ajouter de la chaleur et du caractère à des plages de fréquences spécifiques de votre musique. En divisant le son en bandes basses, moyennes et hautes, vous pouvez façonner chaque plage indépendamment pour une amélioration sonore précise.

### Guide d'Amélioration de l'Écoute
- Amélioration des Basses :
  - Ajoute de la chaleur et du punch aux basses fréquences
  - Parfait pour améliorer les basses et les kicks
  - Crée des basses plus pleines et plus riches
- Façonnage des Médiums :
  - Met en valeur le corps des voix et des instruments
  - Ajoute de la présence aux guitares et aux claviers
  - Crée un son plus clair et plus défini
- Amélioration des Aigus :
  - Ajoute de l'éclat aux cymbales et aux hi-hats
  - Améliore l'air et la brillance
  - Crée des aigus nets et détaillés

### Parameters
- **Fréquences de Crossover**
  - Freq 1 (20Hz-2kHz) : Définit où la bande basse se termine et la bande moyenne commence
  - Freq 2 (200Hz-20kHz) : Définit où la bande moyenne se termine et la bande haute commence
- **Contrôles de Bande** (pour chaque bande Basse, Moyenne et Haute) :
  - **Drive** (0.0-10.0) : Contrôle l'intensité de la saturation
    - Léger (0.0-3.0) : Amélioration subtile
    - Moyen (3.0-6.0) : Chaleur notable
    - Fort (6.0-10.0) : Caractère prononcé
  - **Bias** (-0.3 à 0.3) : Ajuste la symétrie de la courbe de saturation
    - Négatif : Accentue les pics négatifs
    - Zéro : Saturation symétrique
    - Positif : Accentue les pics positifs
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
- Pour l'Amélioration Globale du Mix :
  1. Commencez avec un Drive doux (2.0-3.0) sur toutes les bandes
  2. Gardez le Bias à 0.0 pour une saturation naturelle
  3. Réglez le Mix autour de 40-50% pour un mélange naturel
  4. Affinez le Gain pour chaque bande

- Pour l'Amélioration des Basses :
  1. Concentrez-vous sur la bande basse
  2. Utilisez un Drive modéré (3.0-5.0)
  3. Gardez le Bias neutre pour une réponse cohérente
  4. Gardez le Mix autour de 50-70%

- Pour l'Amélioration des Voix :
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
3. Gardez initialement le Bias à 0.0
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

### Parameters
- **Drive** - Contrôle la quantité de chaleur et de caractère (0.0 à 10.0)
  - Léger (0.0-3.0) : Chaleur analogique subtile
  - Moyen (3.0-6.0) : Caractère riche et vintage
  - Fort (6.0-10.0) : Effet audacieux et dramatique
- **Bias** - Ajuste la symétrie de la courbe de saturation (-0.3 à 0.3)
  - 0.0 : Saturation symétrique
  - Positif : Accentue les pics positifs
  - Négatif : Accentue les pics négatifs
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
2. Gardez initialement le Bias à 0.0
3. Ajustez Mix pour équilibrer l'effet
4. Ajustez Gain si nécessaire pour un volume approprié
5. Expérimentez et faites confiance à vos oreilles !

## Sub Synth

Un effet spécialisé qui améliore les basses de votre musique en générant et en mélangeant des signaux sous-harmoniques. Parfait pour ajouter de la profondeur et de la puissance aux enregistrements manquant de graves ou créer des sons de basse riches et corpulents.

### Guide d'Amélioration de l'Écoute
- Amélioration des Graves :
  - Ajoute de la profondeur et de la puissance aux enregistrements fins
  - Crée des graves plus pleines et plus riches
  - Parfait pour l'écoute au casque
- Contrôle de Fréquence :
  - Contrôle précis sur les fréquences sous-harmoniques
  - Filtrage indépendant pour des graves propres
  - Maintient la clarté tout en ajoutant de la puissance

### Parameters
- **Sub Level** - Contrôle le niveau du signal sous-harmonique (0-200%)
  - Léger (0-50%) : Amélioration subtile des graves
  - Moyen (50-100%) : Renforcement équilibré des graves
  - Fort (100-200%) : Effet dramatique sur les graves
- **Dry Level** - Ajuste le niveau du signal original (0-200%)
  - Utilisé pour équilibrer avec le signal sous-harmonique
  - Maintient la clarté du son original
- **Sub LPF** - Filtre passe-bas pour le signal sous-harmonique (5-400Hz)
  - Fréquence : Contrôle la limite supérieure du sub
  - Pente : Ajuste la pente du filtre (Off à -24dB/oct)
- **Sub HPF** - Filtre passe-haut pour le signal sous-harmonique (5-400Hz)
  - Fréquence : Élimine le grondement indésirable
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
  4. Activez Dry HPF à 40Hz

- Pour un Impact Maximum :
  1. Augmentez Sub Level jusqu'à 150%
  2. Réglez Sub LPF à 120Hz (-24dB/oct)
  3. Gardez Sub HPF à 15Hz (-6dB/oct)
  4. Équilibrez avec Dry Level

### Guide de Démarrage Rapide
1. Commencez avec un Sub Level modéré (50-70%)
2. Réglez Sub LPF autour de 100Hz
3. Activez Sub HPF autour de 20Hz
4. Ajustez Dry Level pour l'équilibre
5. Affinez les filtres selon les besoins
6. Faites confiance à vos oreilles et ajustez progressivement !
