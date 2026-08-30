---
title: "Plugins Saturation - EffeTune"
description: "Plugins de saturation et de distorsion incluant Saturation, Exciter, Hard Clipping et plus encore."
lang: fr
---

# Plugins Saturation

Une collection de plugins qui ajoutent de la chaleur et du caractère à votre musique. Ces effets peuvent donner à la musique numérique un son plus analogique et ajouter une richesse agréable au son, similaire à la coloration sonore des équipements audio vintage.

<!-- spectrum-overlay -->
## Superposition du spectre

Appuyez sur l’icône de spectre d’un graphique compatible pour passer successivement de After à Before + After, puis à Off. After affiche uniquement le spectre après traitement sous forme de courbe bleue. Before + After remplit la variation entre le spectre avant et après traitement : une couleur chaude signale les fréquences dont le niveau a augmenté, le bleu celles dont le niveau a diminué, et une courbe grise indique le spectre After. Les deux affichages utilisent un lissage au 1/12 d’octave pour faciliter la lecture des tendances dans les hautes fréquences. Utilisez cette comparaison pour voir comment chaque réglage modifie les graves, les médiums et les aigus pendant l’écoute. Lisez les niveaux du spectre sur l’échelle dBFS à droite du graphique. Elle est distincte de l’échelle de gain du graphique : 0 dBFS est la référence numérique de pleine échelle et les valeurs plus basses correspondent à des niveaux plus faibles. En mode After, seul le spectre après traitement est recueilli ; en mode Off, l’acquisition et le tracé s’arrêtent.

## Liste des Plugins

- [Bandwidth Extender](#bandwidth-extender) - Génère des aigus au-dessus d'une coupure détectée ou définie
- [Dynamic Saturation](#dynamic-saturation) - Simule le déplacement non linéaire des cônes de haut-parleur
- [Exciter](#exciter) - Ajoute du contenu harmonique pour améliorer la clarté et la présence
- [Hard Clipping](#hard-clipping) - Ajoute de l'intensité et du mordant au son
- [Harmonic Distortion](#harmonic-distortion) - Façonne la forme d'onde avec des termes non linéaires ajustables
- [Multiband Saturation](#multiband-saturation) - Façonne et améliore différentes plages de fréquences indépendamment
- [Saturation](#saturation) - Ajoute de la chaleur et de la richesse comme un équipement vintage
- [Sub Synth](#sub-synth) - Ajoute un signal basse fréquence filtré dérivé de l'audio original
- [Tube Simulator](#tube-simulator) - Modélise des étages ligne à lampes et des amplificateurs de puissance push-pull ou single-ended

## Bandwidth Extender

Bandwidth Extender est destiné aux sources présentant une coupure nette dans les aigus, comme certains MP3 à faible débit. Il analyse la paire stéréo ensemble et n'ajoute du contenu qu'au-dessus de la limite détectée ou définie. Il ne reconstitue pas la forme d'onde d'origine ; en mode Auto, il reste inactif si aucune coupure stable n'est trouvée.

La bande générée comprend deux composantes réglables séparément : une continuation harmonique liée au signal d'entrée et un bruit façonné déterministe. Le signal d'origine reste présent pendant l'ajout de ces composantes.

### Guide d'amélioration de l'écoute

- Commencez avec **Auto** et les deux réglages Amount à leur valeur par défaut de 100 %. Utilisez **Manual** si la fréquence de coupure est connue.
- Réduisez **Noise Amount** pour les sons tonals soutenus, ou **Harmonic Amount** pour les percussions et les sons soufflés. Gardez les deux actifs sur un contenu mixte.
- Comparez au bypass à niveau égal. Pour éclaircir une source déjà large bande, utilisez plutôt Exciter.

### Paramètres

- **Harmonic Amount** (0-200 %, 100 % par défaut) règle uniquement la continuation harmonique : 0 % la supprime, 100 % est son niveau de référence et 200 % la double sans modifier le bruit ni la voie sèche.
- **Noise Amount** (0-200 %, 100 % par défaut) règle uniquement le bruit façonné : 0 % le supprime, 100 % est son niveau de référence et 200 % le double sans modifier les harmoniques ni la voie sèche.
- **Cutoff** choisit **Auto**, qui recherche une chute spectrale abrupte et persistante commune aux deux canaux, ou **Manual**. En Manual, la bande générée reste automatiquement dans la plage disponible à la lecture.
- **Manual Cutoff** (6000-24000 Hz) fixe le début de la génération en mode Manual.

Bandwidth Extender ajoute environ 26,7-29,0 ms de latence, dont un saut de traitement supplémentaire : 1 280 échantillons à 48 kHz, 2 560 à 96 kHz ou 5 120 à 192 kHz. S'il ne peut pas fonctionner avec la fréquence d'échantillonnage, la configuration des canaux ou l'appareil actuels, son panneau indique qu'il est contourné et le son reste inchangé. Utilisez un réglage compatible ou désactivez le plugin.

## Dynamic Saturation

Un effet basé sur la physique qui simule le déplacement non linéaire des cônes de haut-parleur dans différentes conditions. En modélisant le comportement mécanique d'un haut-parleur, puis en appliquant une saturation à ce déplacement, il crée une forme unique de distorsion qui répond de manière dynamique à votre musique.

### Préréglages système

Cliquez sur **Préréglages d’effet** dans l’en-tête de l’effet pour comparer des réglages complets du mouvement du cône.

- **Subtle Cone Color** - Un caractère de cône de haut-parleur discret, presque sans distorsion.
- **Pushed Speaker** - Un mouvement du cône et une saturation plus marqués, avec compensation du niveau de sortie.
- **Ragged Cone** - Le caractère de cône le plus prononcé, volontairement rugueux.

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

Tube Simulator ajoute les harmoniques, la compression et la réaction de l’alimentation qui évoluent avec le signal dans les étages ligne et de puissance à lampes. **Line** utilise uniquement le driver, **Push-Pull Power** propose des circuits équilibrés à EL84, EL34, 6L6GC et KT88, et **SE Triode** des circuits single-ended à 300B et 2A3. Les deux circuits de puissance modélisent aussi le noyau du transformateur de sortie, dont la saturation magnétique et l’hystérésis ajoutent de la distorsion sur les graves à fort niveau. Il modélise la charge électrique du haut-parleur vue par l’amplificateur, mais n’ajoute pas la sonorité d’une enceinte ou d’un microphone.

### Guide de Réglage à l’Écoute

- Pour une coloration discrète, choisissez dans le groupe **Pre** un preset portant le suffixe **@0.01%** ou **@0.1%**. Choisissez le suffixe **@1%** ou **@2%** pour rendre les harmoniques et la compression plus audibles.
- Utilisez **Pre** pour le son de l’étage ligne, **Power** pour l’étage de sortie seul ou **Pre+Power** pour le parcours complet de l’amplificateur.
- Commencez par **EL84 Distributed 10 W @2%** pour un son push-pull mesuré. Comparez-le à **EL84 Pentode 10 W @2%** pour un caractère plus ferme et direct.
- Essayez **300B SE @2%** ou **2A3 SE @2%** pour des harmoniques paires plus présentes et une réponse single-ended plus douce.
- Si le son devient trop comprimé ou distordu, baissez **Input Volume**, puis égalisez le volume d’écoute avec **Output Trim**.
- Baissez **Negative Feedback** pour une réponse plus souple et riche en harmoniques ; augmentez-le pour un contrôle plus ferme. En SE Triode, partez de 3dB et restez généralement autour de 0–6dB.
- Baissez **Wet/Dry Mix** pour n’ajouter qu’une touche de l’effet.

### Organisation du Panneau

Les commandes sont réparties dans cinq onglets.

- **Input** - Input Volume, Input Reference, Source Z
- **Driver** - Driver Type, Bias, Plate, Supply, Negative Feedback
- **Power** - Output Circuit ; Power Tubes, Output B+ et Cathode Resistor pour le push-pull ; SE Triode, SE B+ et SE Cathode Resistor pour le single-ended
- **Transformer** - Screen Tap, Push-Pull Primary, SE Primary, Assumed Speaker Load, Actual Speaker Load
- **Output** - Output Trim, Output Safety Trim, Auto Gain Reduction, Wet/Dry Mix

Les onglets Power et Transformer n’affichent que les commandes utilisées par le Output Circuit sélectionné.

### Choix d’un Preset

Cliquez sur le bouton **Préréglages d’effet** dans l’en-tête de l’effet pour ouvrir la boîte de dialogue des presets. Choisissez un réglage de Préréglages système dans le groupe Pre, Power ou Pre+Power pour l’appliquer immédiatement. Le preset qui correspond aux réglages actuels est mis en évidence ; si aucun ne correspond, aucun preset n’est mis en évidence. Les réglages initiaux correspondent à **EL84 Pentode @2%**. **Output Safety Trim** et **Auto Gain Reduction** ne servent pas à la correspondance ; les modifier ne retire donc pas la mise en évidence.

Le suffixe du preset donne un repère pratique sur l’intensité de l’effet : **@0.01%** est très subtil, **@0.1%** ajoute une coloration légère, et **@1%** ou **@2%** rendent les harmoniques et la compression plus évidentes. Les presets règlent aussi Output Trim pour faciliter la comparaison, mais le volume perçu peut varier selon la musique. Égalisez les niveaux avec Output Trim avant de choisir le son que vous préférez.

### Paramètres

- **Input Volume** (-96 à 0dB) - Réduit le niveau qui attaque le circuit choisi. Une valeur plus basse réduit la compression et la distorsion et augmente la réserve.
- **Driver Type** (12AX7, 12AT7, 12AU7 ou Bypass) - Sélectionne les lampes du driver à deux étages ou le retire du trajet. La 12AX7 offre le gain le plus élevé, la 12AT7 est intermédiaire et la 12AU7 offre le gain le plus faible et la plus grande réserve.
- **Bias** (-50 à +50%) - Déplace le point de polarisation du driver. L’augmenter déplace les étages vers un courant plus élevé ; le réduire fait l’inverse et modifie le caractère des harmoniques et de la compression.
- **Plate** (150 à 300 V) - Règle la tension de plaque du driver. Une valeur plus élevée donne généralement plus de réserve ; une valeur plus basse fait apparaître plus tôt la compression et la non-linéarité.
- **Source Z** (0.6 à 100 kΩ) - Règle l’impédance de la source qui alimente le premier étage. Une valeur plus élevée peut adoucir les aigus et les transitoires.
- **Supply** (0.1 à 47 kΩ) - Règle la résistance d’alimentation du driver. Une valeur plus élevée accentue l’affaissement de l’alimentation ; une valeur plus basse donne une réponse plus ferme.
- **Negative Feedback** (0 à 30dB) - Règle la contre-réaction globale. L’augmenter réduit généralement la distorsion et raffermit la réponse et le contrôle du haut-parleur ; 0dB ouvre la boucle.
- **Output Trim** (-48 à +48dB) - Égalise le volume traité sans modifier l’excitation à l’intérieur du circuit.
- **Output Safety Trim** (-96 à 0dB) - Offre un réglage de niveau séparé pour la protection de sortie. Auto Gain Reduction ne réduit que cette commande, pas Output Trim.
- **Auto Gain Reduction** (activé par défaut) - Réduit automatiquement Output Safety Trim lorsque la sortie traitée risquerait de dépasser le maximum numérique. Une fois désactivé, aucune nouvelle réduction n’est ajoutée, mais celle déjà appliquée reste en place.
- **Wet/Dry Mix** (0 à 100%) - Mélange le signal traité et l’original. Une valeur plus basse rend l’effet plus discret.
- **Input Reference** (0.100 à 300.000 Vpk) - Définit la tension d’entrée représentée par un pic numérique à pleine échelle. Une valeur plus élevée attaque davantage le circuit ; utilisez Input Volume pour le réglage principal de l’intensité.
- **Output Circuit** (Line, Push-Pull Power ou SE Triode) - Sélectionne la topologie. Line comprend seulement le driver ; les deux autres modes ajoutent l’étage de puissance, le transformateur et la charge du haut-parleur.
- **Power Tubes** (EL84 ×2, EL34 ×2, 6L6GC ×2 ou KT88 ×2) - Sélectionne les lampes de sortie push-pull et leur caractère.
- **Output B+** (300 à 470 V) - Règle l’alimentation de l’étage push-pull. Une valeur plus élevée augmente l’excursion disponible et la réserve des lampes.
- **Cathode Resistor** (270 à 500 Ω / valve) - Règle la résistance de polarisation de chaque lampe push-pull. L’augmenter réduit le courant de repos ; la diminuer l’augmente.
- **SE Triode** (300B ou 2A3) - Sélectionne la lampe de sortie single-ended.
- **SE B+** (250 à 450 V) - Règle l’alimentation de l’étage single-ended.
- **SE Cathode Resistor** (700 à 1300 Ω) - Règle la résistance de polarisation de la lampe single-ended et modifie son point de fonctionnement et sa compression.
- **Screen Tap** (0%, 20% ou 43%) - Sélectionne la connexion de grille-écran. 0% correspond au fonctionnement pentode ; 20% et 43% donnent une charge répartie.
- **Push-Pull Primary** (6.0, 6.6 ou 8.0 kΩ) - Règle l’impédance primaire du transformateur push-pull et modifie la charge des lampes et leur réponse. Ce choix fixe aussi le flux de saturation magnétique du noyau.
- **SE Primary** (2.5, 3.5 ou 5.0 kΩ) - Règle l’impédance primaire du transformateur single-ended. Ce choix détermine aussi la quantité de flux qu’un signal donné envoie dans le noyau à entrefer, si bien que les impédances plus élevées atteignent la saturation plus tôt à niveau égal. Le courant de repos du fonctionnement single-ended maintient un flux permanent dans le noyau : le signal le sature donc de façon asymétrique et ajoute des harmoniques de rang pair dans les graves.
- **Assumed Speaker Load** (4, 8, 15 ou 16 Ω) - Sélectionne l’impédance nominale et la prise secondaire pour lesquelles le circuit est conçu.
- **Actual Speaker Load** (2 à 32 Ω) - Règle l’impédance du haut-parleur réellement connecté. Si elle diffère de Assumed Speaker Load, la charge renvoyée aux lampes, l’amortissement et la puissance disponible changent ; des valeurs identiques correspondent au point de fonctionnement prévu.

### Protection du Niveau de Sortie

La modification des paramètres du circuit peut provoquer un saut important de niveau. Lorsque **Auto Gain Reduction** est activé, Tube Simulator réduit **Output Safety Trim** si la sortie traitée risque de dépasser la pleine échelle numérique. La réduction reste appliquée au lieu de remonter automatiquement et s’affiche dans l’état sous le graphique.

- Si la réduction devient importante, baissez Input Volume ou Output Trim, puis sélectionnez à nouveau un preset ou réglez Output Safety Trim.
- Désactivez Auto Gain Reduction uniquement si vous surveillez déjà les crêtes de sortie par un autre moyen.
- Cette protection réduit le niveau de sortie ; elle ne supprime pas les harmoniques ni la compression créées dans le circuit choisi.

### Bypass de Sécurité et Récupération

- Si un réglage instable active le bypass, baissez Negative Feedback ou sélectionnez un preset. Le son traité revient automatiquement dès que le réglage est stable.
- Si l’état indique toujours un bypass, restaurez un preset et rechargez l’effet. Lorsque le traitement n’est pas disponible sur l’appareil, le son traverse sans modification.

### Lecture du HUD

- Les points représentent les positions de fonctionnement récentes. Plus ils sont dispersés, plus la musique sollicite fortement l’étage concerné. Chaque panneau superpose les deux canaux : le bleu pour la gauche, l’orange pour la droite.
- Le nom de la lampe représentée sur le graphique apparaît en haut à gauche.
- **Graph**, au-dessus de l’affichage, choisit les lampes à observer. **Stage 1 / Stage 2** montre les deux étages du driver, **Push / Pull** les deux lampes de la paire de sortie push-pull et **SE Triode** la lampe de sortie single-ended. Seuls les étages réellement utilisés par le circuit actuel sont sélectionnables : sur un étage de puissance précédé d’un driver, vous pouvez donc passer de l’un à l’autre et les comparer.
- Quand aucune lampe ne fonctionne — Line avec **Driver Type** sur Bypass, ou l’effet désactivé — l’affichage reste vide et l’état indique **No tube stage is active**.
- **Speaker Output** et **Speaker Real Power** indiquent à quel point l’étage de puissance et la charge du haut-parleur sont sollicités.
- **Transformer Flux** affiche l’amplitude du flux totalisé du transformateur de sortie, en Wb. Plus les graves poussent cette valeur vers le haut, plus le transformateur ajoute lui-même de la distorsion. En SE Triode, la valeur inclut le flux de polarisation permanent du noyau à entrefer et reste donc supérieure à zéro même en l’absence de signal.
- L’état sous le graphique indique si l’effet est actif ou en bypass et affiche toute réduction automatique du niveau de sortie.

Tube Simulator ajoute un bref délai de traitement d’environ 0.3 à 1.5ms selon la fréquence d’échantillonnage.
