---
title: "Plugins Modulation - EffeTune"
description: "Plugins d'effets de modulation incluant Tremolo, Wow Flutter, Pitch Shifter et Doppler Distortion."
lang: fr
---

# Plugins Modulation

Une collection de plugins qui ajoutent du mouvement et des variations à votre musique grâce aux effets de modulation. Ces effets peuvent rendre votre musique numérique plus organique et dynamique, améliorant votre expérience d'écoute avec des variations subtiles ou dramatiques du son.

## Liste des plugins

- [Doppler Distortion](#doppler-distortion) - Simule les changements naturels et dynamiques du son dus aux mouvements subtils de la membrane du haut-parleur.
- [Pitch Shifter](#pitch-shifter) - Modifie la hauteur de votre musique sans altérer la vitesse de lecture
- [Tremolo](#tremolo) - Crée des variations rythmiques de volume pour un son pulsé et dynamique
- [Wow Flutter](#wow-flutter) - Recrée les légères variations de hauteur caractéristiques des disques vinyles et des magnétophones

## Doppler Distortion

Découvrez un effet audio unique qui apporte une touche de mouvement naturel à votre musique. Doppler Distortion simule les légères distorsions créées par le déplacement physique de la membrane du haut-parleur. Cet effet introduit de légères modifications de la profondeur et du timbre du son, semblables aux variations de tonalité que vous entendez lorsque la source sonore se déplace par rapport à vous. Il confère une qualité dynamique et immersive à votre expérience d'écoute en rendant le son plus vivant et captivant.

### Paramètres

- **Coil Force (N / V)**
  Contrôle avec quelle force le signal d'entrée entraîne le mouvement simulé de la bobine du haut-parleur. Des valeurs plus élevées produisent une distorsion Doppler plus marquée.

- **Speaker Mass (kg)**  
  Simule le poids de la membrane du haut-parleur, influençant la reproduction naturelle du mouvement.  
  - **Valeurs plus élevées :** Augmentent l'inertie, entraînant une réponse plus lente et des distorsions plus douces et subtiles.
  - **Valeurs plus faibles :** Réduisent l'inertie, provoquant un effet de modulation plus rapide et plus marqué.

- **Spring Constant (N/m)**  
  Détermine la rigidité de la suspension du haut-parleur. Une constante de ressort plus élevée produit une réponse plus nette et définie.

- **Damping Factor (N·s/m)**  
  Ajuste la rapidité avec laquelle le mouvement simulé se stabilise, équilibrant un mouvement vif avec des transitions fluides.  
  - **Valeurs plus élevées :** Conduisent à une stabilisation plus rapide, réduisant les oscillations et produisant un effet plus serré et contrôlé.
  - **Valeurs plus faibles :** Permettent au mouvement de persister plus longtemps, entraînant une fluctuation dynamique plus lâche et prolongée.

### Réglages recommandés

Pour une amélioration équilibrée et naturelle, commencez avec:
- **Coil Force:** 8.0 N / V
- **Speaker Mass:** 0.03 kg  
- **Spring Constant:** 6000 N/m  
- **Damping Factor:** 1.5 N·s/m  

Ces réglages offrent un Doppler Distortion subtil qui enrichit l'expérience d'écoute sans dominer le son original.

## Pitch Shifter

Un effet qui modifie la hauteur de votre musique sans en altérer la vitesse de lecture. Cela vous permet d'écouter vos morceaux préférés dans différentes tonalités, les rendant plus aigus ou plus graves tout en conservant le tempo et le rythme d'origine.

### Paramètres
- **Pitch Shift** - Modifie la hauteur globale en demi-tons (-6 à +6)
  - Valeurs négatives : Abaisse la hauteur (son plus grave et profond)
  - Zéro : Aucun changement (hauteur originale)
  - Valeurs positives : Augmente la hauteur (son plus aigu et lumineux)
- **Fine Tune** - Effectue des ajustements fins de la hauteur en cents (-50 à +50)
  - Permet un réglage précis entre les demi-tons
  - Idéal pour de légères corrections lorsque l'intervalle d'un demi-ton est trop important
- **Window Size** - Contrôle la taille de la fenêtre d'analyse en millisecondes (80 à 500ms)
  - Valeurs plus petites (80-150ms) : Mieux adaptées aux matériaux riches en transitoires comme les percussions
  - Valeurs moyennes (150-300ms) : Bon compromis pour la plupart des musiques
  - Valeurs plus grandes (300-500ms) : Mieux adaptées aux sons doux et soutenus
- **XFade Time** - Définit le temps de fondu enchaîné entre les segments traités en millisecondes (20 à 40ms)
  - Influence la fluidité de la transition entre les segments modifiés
  - Des valeurs plus faibles peuvent paraître plus immédiates, mais potentiellement moins fluides
  - Des valeurs plus élevées créent des transitions plus douces entre les segments, mais peuvent augmenter les fluctuations sonores et provoquer une sensation de chevauchement

## Tremolo

Un effet qui ajoute des variations rythmiques du volume à votre musique, similaire au son pulsé que l'on retrouve dans les amplificateurs vintage et les enregistrements classiques. Cela crée une qualité dynamique et expressive qui apporte mouvement et intérêt à votre expérience d'écoute.

### Guide de l'expérience d'écoute
- Expérience d'amplificateur classique :
  - Recrée le son pulsé emblématique des amplificateurs à lampes vintage
  - Ajoute du mouvement rythmique aux enregistrements statiques
  - Crée une expérience d'écoute hypnotique et captivante
- Caractère d'enregistrement vintage :
  - Simule les effets naturels de tremolo utilisés dans les enregistrements classiques
  - Ajoute du caractère vintage et de la chaleur
  - Parfait pour l'écoute de jazz, de blues et de rock
- Ambiance créative :
  - Crée des montées et des descentes dramatiques
  - Ajoute une intensité émotionnelle à la musique
  - Parfait pour une écoute ambiante et atmosphérique

### Paramètres
- **Rate** - À quelle vitesse le volume change (0,1 à 50 Hz)
  - Plus lent (0.1-2 Hz) : Pulsation douce et subtile
  - Moyen (2-6 Hz) : Effet tremolo classique
  - Plus rapide (6-20 Hz) : Effets dramatiques et saccadés
  - Très rapide (20-50 Hz) : Modulation de volume extrêmement rapide pouvant ajouter une texture rugueuse ou bourdonnante ; à utiliser avec retenue pour une écoute confortable
- **Depth** - L'amplitude des variations de volume (0 à 12 dB)
  - Subtil (0-3 dB) : Variations de volume légères
  - Moyen (3-6 dB) : Effet de pulsation perceptible
  - Fort (6-12 dB) : Montées de volume dramatiques
- **Ch Phase** - Différence de phase entre les canaux stéréo (-180 à 180 degrés)
  - 0° : Les deux canaux pulsent ensemble (tremolo mono)
  - 90° ou -90° : Crée un effet de rotation tourbillonnant
  - 180° ou -180° : Les canaux pulsent en sens opposé (largeur stéréo maximale)
- **Randomness** - Irrégularité des variations de volume (0 à 96 dB)
  - Faible : Pulsations plus prévisibles et régulières
  - Moyen : Variation vintage naturelle
  - Élevé : Son plus instable et organique
- **Randomness Cutoff** - Vitesse à laquelle les changements aléatoires se produisent (1 à 1000 Hz)
  - Plus bas : Variations aléatoires plus lentes et douces
  - Plus haut : Changements plus rapides et imprévisibles
- **Randomness Slope** - Contrôle l'intensité du filtrage aléatoire (-12 à 0 dB)
  - -12 dB: Variations aléatoires plus douces et progressives (effet plus subtil)
  - -6 dB: Réponse équilibrée
  - 0 dB: Variations aléatoires plus prononcées et accentuées (effet plus fort)
- **Ch Sync** - Niveau de synchronisation de l'aléatoire entre les canaux (0 à 100%)
  - 0% : Chaque canal a une aléatoire indépendante
  - 50% : Synchronisation partielle entre les canaux
  - 100% : Les deux canaux partagent le même schéma d'aléatoire

### Réglages recommandés pour différents styles

1. Tremolo d'ampli guitare classique
   - Rate: 4-6 Hz (vitesse moyenne)
   - Depth: 6-8 dB
   - Ch Phase: 0° (mono)
   - Randomness: 0-5 dB
   - Parfait pour : Blues, Rock, Surf Music

2. Effet psychédélique stéréo
   - Rate: 2-4 Hz
   - Depth: 4-6 dB
   - Ch Phase: 180° (canaux opposés)
   - Randomness: 10-20 dB
   - Parfait pour : Psychedelic Rock, Electronic, Experimental

3. Amélioration subtile
   - Rate: 1-2 Hz
   - Depth: 2-3 dB
   - Ch Phase: 0-45°
   - Randomness: 5-10 dB
   - Parfait pour : Toute musique nécessitant un mouvement subtil

4. Pulsation dramatique
   - Rate: 8-12 Hz
   - Depth: 8-12 dB
   - Ch Phase: 90°
   - Randomness: 20-30 dB
   - Parfait pour : Electronic, Dance, Ambient

### Guide de démarrage rapide

1. Pour un son Tremolo classique :
   - Commencez avec un Rate moyen (4-5 Hz)
   - Ajoutez un Depth modéré (6 dB)
   - Réglez Ch Phase sur 0° pour un effet mono ou 90° pour un mouvement stéréo
   - Gardez Randomness bas (0-5 dB)
   - Ajustez selon vos préférences

2. Pour plus de caractère :
   - Augmentez progressivement Randomness
   - Expérimentez avec différents réglages de Ch Phase
   - Essayez différentes combinaisons de Rate et Depth
   - Fiez-vous à votre oreille

## Wow Flutter

Un effet qui ajoute des variations subtiles de hauteur à votre musique, semblable au son ondulant naturel que vous vous rappelez peut-être des disques vinyles ou des cassettes. Cela crée une sensation chaleureuse et nostalgique que beaucoup trouvent agréable et relaxante.

### Guide de l'expérience d'écoute
- Expérience de disque vinyle :
  - Recrée l'ondulation douce des platines
  - Ajoute un mouvement organique au son
  - Crée une atmosphère chaleureuse et nostalgique
- Souvenir de cassette :
  - Simule le flutter caractéristique des magnétocassette
  - Ajoute le caractère vintage d'un magnétocassette
  - Parfait pour les ambiances lo-fi et rétro
- Ambiance créative :
  - Crée des effets oniriques et aquatiques
  - Ajoute du mouvement et de la vie aux sons statiques
  - Parfait pour une écoute ambiante et expérimentale

### Paramètres
- **Rate** - À quelle vitesse le son oscille (0,1 à 20 Hz)
  - Plus lent (0.1-2 Hz) : Mouvement semblable à un disque vinyle
  - Moyen (2-6 Hz) : Flutter similaire à celui d'une cassette
  - Plus rapide (6-20 Hz) : Effets créatifs
- **Depth** - Intensité de la modulation du temps de delay, qui fait osciller la hauteur (0 à 40 ms)
  - Subtil (0-6 ms) : Caractère vintage doux
  - Moyen (6-15 ms) : Sensation cassette/vinyle clairement audible
  - Fort (15-40 ms) : Effets spéciaux dramatiques
- **Ch Phase** - Différence de phase entre les canaux stéréo (-180 à 180 degrés)
  - 0° : Les deux canaux oscillent ensemble
  - 90° ou -90° : Crée un effet de rotation tourbillonnant
  - 180° ou -180° : Les canaux oscillent en sens opposé
- **Randomness** - Irrégularité de l'oscillation (0 à 40 ms)
  - Faible : Mouvement plus prévisible et régulier
  - Moyen : Variation vintage naturelle
  - Élevé : Son plus instable, rappelant un équipement usé
- **Randomness Cutoff** - Vitesse d'occurrence des variations aléatoires (0,1 à 20 Hz)
  - Plus bas : Changements plus lents et doux
  - Plus haut : Changements plus rapides et erratiques
- **Randomness Slope** - Contrôle l'intensité du filtrage aléatoire (-12 à 0 dB)
  - -12 dB: Variations aléatoires plus douces et progressives (effet plus subtil)
  - -6 dB: Réponse équilibrée
  - 0 dB: Variations aléatoires plus prononcées et accentuées (effet plus fort)
- **Ch Sync** - Niveau de synchronisation de l'aléatoire entre les canaux (0 à 100%)
  - 0% : Chaque canal a une aléatoire indépendante
  - 50% : Synchronisation partielle entre les canaux
  - 100% : Les deux canaux partagent le même schéma d'aléatoire

### Réglages recommandés pour différents styles

1. Expérience classique du vinyle
   - Rate: 0.3-0.8 Hz (mouvement lent et doux)
   - Depth: 2-6 ms
   - Randomness: 1-4 ms
   - Randomness Cutoff: 0.5-3 Hz
   - Ch Phase: 0°
   - Ch Sync: 100%
   - Parfait pour : Jazz, Classical, Vintage Rock
2. Ambiance cassette rétro
   - Rate: 4-6 Hz (flutter plus rapide)
   - Depth: 1-3 ms
   - Randomness: 1-5 ms
   - Randomness Cutoff: 3-8 Hz
   - Ch Phase: 0-30°
   - Ch Sync: 80-100%
   - Parfait pour : Lo-Fi, Pop, Rock
3. Ambiance onirique
   - Rate: 1-2 Hz
   - Depth: 25-30 ms
   - Randomness: 20-25 ms
   - Ch Phase: 90-180°
   - Ch Sync: 50-70%
   - Parfait pour : Ambient, Electronic, Experimental
4. Amélioration subtile
   - Rate: 1-2 Hz
   - Depth: 2-5 ms
   - Randomness: 1-3 ms
   - Ch Phase: 0°
   - Ch Sync: 100%
   - Parfait pour : Toute musique nécessitant un caractère vintage subtil

### Guide de démarrage rapide

1. Pour un son vintage naturel :
   - Commencez avec un Rate lent (0.5-1 Hz)
   - Ajoutez un Depth léger (2-6 ms)
   - Ajoutez un peu de Randomness (1-4 ms)
   - Utilisez Randomness Cutoff autour de 0.5-3 Hz
   - Maintenez Ch Phase à 0° et Ch Sync à 100%
   - Ajustez selon vos préférences

2. Pour plus de caractère :
   - Augmentez progressivement Depth
   - Ajoutez davantage de Randomness
   - Expérimentez avec différents réglages de Ch Phase
   - Réduisez Ch Sync pour plus de variation stéréo
   - Fiez-vous à votre oreille

Rappelez-vous : Le but est d'ajouter un caractère vintage agréable à votre musique. Commencez subtilement et ajustez jusqu'à trouver le juste équilibre qui améliore votre expérience d'écoute!
