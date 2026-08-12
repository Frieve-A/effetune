---
title: "Plugins Modulation - EffeTune"
description: "Effets de modulation, notamment Auto Filter, Auto Pan, Chorus, Frequency Shifter, Phaser et Rotary Speaker."
lang: fr
---

# Plugins Modulation

Une collection de plugins qui ajoutent du mouvement et des variations à votre musique grâce aux effets de modulation. Ces effets peuvent rendre votre musique numérique plus organique et dynamique, améliorant votre expérience d'écoute avec des variations subtiles ou dramatiques du son.

## Liste des plugins

- [Auto Filter](#auto-filter) - Balaye un filtre résonant par LFO ou enveloppe
- [Auto Pan](#auto-pan) - Déplace doucement chaque paire stéréo dans l'espace
- [Chorus](#chorus) - Réunit chorus, ensemble, flanger et vibrato par retards mobiles
- [Doppler Distortion](#doppler-distortion) - Simule les changements naturels et dynamiques du son dus aux mouvements subtils de la membrane du haut-parleur.
- [Frequency Shifter](#frequency-shifter) - Translate les fréquences, module en anneau ou crée un balayage barber-pole
- [Phaser](#phaser) - Crée des pics et creux mobiles par filtres passe-tout
- [Pitch Shifter](#pitch-shifter) - Modifie la hauteur de votre musique sans altérer la vitesse de lecture
- [Pitch Shifter HQ](#pitch-shifter-hq) - Modifie la hauteur avec moins d'artefacts de phase lorsque la qualité prime sur la latence ou la charge CPU
- [Rotary Speaker](#rotary-speaker) - Combine les mouvements indépendants de la trompe et du tambour
- [Tremolo](#tremolo) - Crée des variations rythmiques de volume pour un son pulsé et dynamique
- [Wow Flutter](#wow-flutter) - Recrée les légères variations de hauteur caractéristiques des disques vinyles et des magnétophones

## Auto Filter

Anime automatiquement un filtre à variables d'état au moyen d'un LFO ou de l'enveloppe du signal d'entrée. Le mode Envelope peut servir d'Envelope Filter ou d'Auto Wah. La latence algorithmique est nulle.

### Conseils de réglage

- Pour une évolution douce du timbre, commencez avec LFO, Low-pass, une Resonance faible et environ 30 à 50% de Mix.
- Pour un Auto Wah, choisissez Envelope et Band-pass, puis réglez Sensitivity afin que les sons forts ouvrent suffisamment le filtre.
- Un Attack plus long adoucit la réaction aux attaques ; un Release plus long rend le retour plus progressif.

### Paramètres

- **Style** : Réglage d'usine complet de tous les paramètres. Choix : **Auto Filter Sweep** (LFO), **Stereo Filter Sweep** (LFO), **Envelope Filter** (Envelope), **Auto Wah** (Envelope) et **Reverse Auto Wah** (Envelope). La modification d'un paramètre le fait passer à **Custom**.
- **Mode** : Alterne entre le mouvement périodique LFO et le suivi du volume Envelope.
- **Filter Type** : Low-pass, Band-pass ou High-pass.
- **Minimum Frequency / Maximum Frequency** (20–20 000 Hz) : Plage du mouvement. Les valeurs inversées sont automatiquement remises dans l'ordre ; des valeurs identiques fixent le filtre. Pendant le traitement, elles sont limitées à une plage sûre sous la fréquence de Nyquist.
- **Resonance** (Q 0,5–20) : Une valeur élevée accentue davantage la zone autour de la fréquence de coupure.
- **Mix** (0–100%) : Proportion du signal d'origine et du signal filtré. À 0%, seul le signal d'origine est présent.
- **Rate**, **Waveform**, **Stereo Phase** : Vitesse, trajectoire et écart de phase dans chaque paire stéréo du LFO. Utilisés uniquement en mode LFO.
- **Sensitivity**, **Attack**, **Release**, **Direction** : Sensibilité, montée, retour et sens du mouvement de l'enveloppe. Utilisés uniquement en mode Envelope.

## Auto Pan

Déplace le volume de chaque paire stéréo adjacente de gauche à droite. Les paires ne sont pas mélangées entre elles et un dernier canal isolé est traité en mono. La latence algorithmique est nulle.

### Conseils de réglage

- Commencez avec une Rate d'environ 0,2 à 0,5 Hz et une Depth modérée pour un mouvement détendu.
- Si l'effet paraît trop large au casque, réduisez Width ; réglez la position gauche/droite de base avec Center.
- Sine ralentit aux extrémités, tandis que Triangle se déplace à une vitesse plus régulière.

### Paramètres

- **Style** : Réglage d'usine complet de tous les paramètres. Choix : **Gentle Auto Pan**, **Wide Auto Pan** et **Fast Auto Pan**. La modification d'un paramètre le fait passer à **Custom**.
- **Rate** (0,05–20 Hz) : Vitesse du mouvement.
- **Depth** (0–100%) : Amplitude du mouvement autour de Center. À 0%, aucun changement.
- **Center** (-100–100%) : Déplace la position centrale vers la gauche ou la droite.
- **Width** (0–100%) : Largeur stéréo utilisée.
- **Waveform** : Sine ou Triangle.
- **Phase** (0–360°) : Position initiale du mouvement périodique.

## Chorus

Ajoute plusieurs signaux à retard variable avec une interpolation cubique à quatre points. Mode propose Chorus, Stereo Chorus, Ensemble, Flanger et Vibrato. Les retards variables sont audibles, mais ne constituent pas une latence fixe ; la latence algorithmique annoncée est donc nulle.

### Conseils de réglage

- Pour une épaisseur naturelle, utilisez Classic Chorus ou Stereo Chorus avec une Rate et une Depth modérées.
- Ensemble devient plus dense lorsque Voices augmente. Une Depth excessive rend la variation de hauteur plus audible.
- Seul Flanger utilise Feedback ; les valeurs positives et négatives changent la polarité du filtre en peigne.
- Vibrato est toujours traité à 100%.

### Paramètres

- **Style** : Réglage d'usine complet de tous les paramètres. Choix : **Classic Chorus** (Chorus), **Stereo Chorus** (Stereo Chorus), **Ensemble** (Ensemble), **Flanger** (Flanger), **Jet Flanger** (Flanger) et **Vibrato** (Vibrato). La modification d'un paramètre le fait passer à **Custom**.
- **Mode** : Chorus, Stereo Chorus, Ensemble, Flanger ou Vibrato.
- **Rate** (0,05–10 Hz) : Vitesse de modulation.
- **Delay** (0,5–30 ms) : Retard de référence du signal traité.
- **Depth** (0–20 ms) : Variation du retard. Pour éviter une lecture à retard négatif, la valeur enregistrée est limitée à Delay.
- **Voices** (1–6) : Nombre de prises variables en Chorus et Ensemble. Ignoré dans les autres modes.
- **Stereo Spread** (0–100%) : Écart de modulation dans chaque paire stéréo. Ignoré en mode Chorus.
- **Feedback** (-75–75%) : Utilisé uniquement en mode Flanger.
- **Mix** (0–100%) : Proportion linéaire entre le signal d'origine et le signal traité. Ignoré en Vibrato, qui est toujours traité à 100%.

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

## Frequency Shifter

Déplace chaque composante fréquentielle d'un nombre fixe de hertz, et non selon un rapport de hauteur. Ring Mod multiplie le signal par une porteuse ; Barber-pole superpose des décalages donnant l'impression d'une montée ou d'une descente continue. Shift et Barber-pole emploient un FIR de signal analytique de Hilbert ; Ring Mod multiplie la porteuse par le signal réel retardé de façon correspondante, extrait de la même FIFO. Les voies d'origine et traitée restent ainsi alignées dans tous les modes. La latence fixe dépend de la fréquence d'échantillonnage et est indiquée par DSP Library.

### Conseils de réglage

- Pour un changement discret, choisissez Shift et commencez vers ±5 à 15 Hz. Contrairement à Pitch Shifter, l'espacement des harmoniques change aussi.
- Pour un timbre métallique, utilisez Ring Mod. Une Carrier Frequency plus basse préserve mieux le rythme d'origine.
- Pour un mouvement continu, utilisez Barber-pole avec une Rate faible et un Mix modéré afin de préserver la clarté.

### Paramètres

- **Style** : Réglage d'usine complet de tous les paramètres. Choix : **Shift Up** (Shift), **Shift Down** (Shift), **Fine Detune** (Shift), **Ring Modulator** (Ring Mod), **Barber-pole Up** (Barber-pole) et **Barber-pole Down** (Barber-pole). La modification d'un paramètre le fait passer à **Custom**.
- **Mode** : Shift, Ring Mod ou Barber-pole.
- **Shift** (-5 000–5 000 Hz) : Décalage en mode Shift. Une valeur positive monte les fréquences ; une valeur négative les descend.
- **Carrier Frequency** (0,1–10 000 Hz) : Fréquence de la porteuse de Ring Mod.
- **Minimum Shift / Maximum Shift** (0–5 000 Hz) : Plage de Barber-pole. Les valeurs inversées sont remises dans l'ordre ; des valeurs identiques fixent le décalage.
- **Rate** (0,01–2 Hz), **Direction** : Vitesse et sens de Barber-pole.
- **Stereo Phase** (0–180°) : Dans tous les modes, décale la porteuse ou le balayage entre la gauche et la droite de chaque paire stéréo.
- **Mix** (0–100%) : Proportion du signal d'origine retardé pour être aligné et du signal traité. Même à 0%, la latence fixe indiquée demeure.

Les décalages importants peuvent créer des composantes au-dessus de la fréquence de Nyquist et rendre l'aliasing audible. La première version n'effectue pas de suréchantillonnage.

## Phaser

Mélange le signal d'origine à la sortie d'une chaîne de filtres passe-tout pour créer des pics et des creux mobiles. Classic effectue un aller-retour ; Barber-pole superpose trois fenêtres à puissance constante pour donner une impression continue de montée ou de descente. La latence algorithmique est nulle.

### Conseils de réglage

- Pour des creux nets, commencez avec Classic, 4 à 6 Stages, une Range modérée et environ 50% de Mix.
- Une augmentation de Stages et Feedback rend l'effet plus profond et résonant. Réduisez-les si les attaques sont trop colorées.
- Réglez l'ampleur avec Stereo Phase et choisissez Barber-pole Up/Down pour un mouvement continu.

### Paramètres

- **Style** : Réglage d'usine complet de tous les paramètres. Choix : **Classic Phaser** (Classic), **Deep Phaser** (Classic), **Stereo Phaser** (Classic), **Barber-pole Up** (Barber-pole) et **Barber-pole Down** (Barber-pole). La modification d'un paramètre le fait passer à **Custom**.
- **Mode** : Classic ou Barber-pole.
- **Rate** (0,05–10 Hz) : Vitesse du balayage.
- **Center Frequency** (80–8 000 Hz) : Centre du balayage logarithmique.
- **Range** (0–6 octaves) : Largeur du balayage.
- **Stages** (nombres pairs de 2 à 12) : Nombre d'étages passe-tout. Davantage d'étages créent davantage de creux.
- **Feedback** (-90–90%) : Quantité de signal traité renvoyée à l'entrée. La valeur absolue détermine la force ; le signe modifie la manière d'accentuer.
- **Stereo Phase** (0–180°) : Décalage du mouvement dans chaque paire stéréo.
- **Direction** : Sens Up/Down de Barber-pole. Ignoré en mode Classic.
- **Mix** (0–100%) : Proportion linéaire du signal d'origine et du signal traité. L'annulation est la plus profonde près du milieu.

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

## Pitch Shifter HQ

Un transpositeur de meilleure qualité pour une écoute attentive, lorsque la réduction du flou dû aux déphasages compte davantage qu'une faible latence ou une charge CPU réduite. Il modifie la hauteur sans changer la vitesse de lecture et maintient les composantes spectrales mieux regroupées que le Pitch Shifter standard. En contrepartie, il sollicite davantage le processeur et ajoute un retard de traitement fixe d'environ 106,7 à 116,1ms : environ 106,7ms à 48, 96 et 192kHz, et environ 116,1ms à 44,1, 88,2 et 176,4kHz. Il nécessite le moteur DSP WASM d'EffeTune ; si ce moteur n'est pas disponible, le signal audio est transmis sans traitement.

Pitch Shifter HQ ne conserve pas les formants. Les transpositions importantes modifient donc le timbre apparent des voix et des instruments en plus de leur hauteur.

### Guide de l'expérience d'écoute

- Pour un changement discret, commencez avec **Pitch Shift** à -1 ou +1 et laissez **Fine Tune** à 0.
- Utilisez **Fine Tune** pour accorder une musique légèrement trop haute ou trop basse sans la déplacer d'un demi-ton complet.
- Préférez Pitch Shifter HQ au Pitch Shifter standard lorsque la réduction des artefacts de phase justifie la charge CPU et le retard supplémentaires. Utilisez la version standard si la latence est importante ou si l'appareil est moins puissant.
- Comparez soigneusement les transpositions importantes : la hauteur évolue de manière stable, mais l'absence de conservation des formants rend le changement de timbre plus évident.

### Paramètres

- **Pitch Shift** - Modifie la hauteur globale en demi-tons (-6 à +6)
  - Les valeurs négatives abaissent la hauteur et les valeurs positives l'augmentent
  - Zéro laisse la hauteur inchangée
- **Fine Tune** - Ajuste la hauteur en cents (-50 à +50)
  - Permet un réglage précis entre les demi-tons
  - 100 cents correspondent à un demi-ton

## Rotary Speaker

Sépare le signal entre une trompe d'aigus et un tambour de graves au moyen d'un crossover Linkwitz–Riley, puis applique à chacun une vitesse de rotation, une modulation de volume et un court retard Doppler distincts. Il ne reproduit pas les mesures d'une enceinte Leslie particulière. Le retard étant variable, il n'est pas annoncé comme une latence algorithmique fixe.

### Conseils de réglage

- Slow donne un mouvement détendu et Fast une rotation plus marquée. Une Acceleration plus longue rend les changements de vitesse plus naturels.
- Réglez le mouvement de hauteur avec Doppler Depth et celui du volume avec Amplitude Depth.
- Équilibrez le tambour et la trompe avec Rotor Balance, et l'ampleur avec Stereo Width.

### Paramètres

- **Style** : Réglage d'usine complet de tous les paramètres. Choix : **Rotary Slow** (Slow), **Rotary Fast** (Fast), **Gentle Rotary** (Slow), **Leslie Slow** (Slow) et **Leslie Fast** (Fast). La modification d'un paramètre le fait passer à **Custom**.
- **Speed State** : Stop, Slow ou Fast. Le changement accélère ou ralentit progressivement, sans coupure.
- **Speed** (25–200%) : Multiplicateur de vitesse de la trompe et du tambour.
- **Acceleration** (0,1–10 s) : Règle la vitesse à laquelle les rotors se rapprochent d'une nouvelle vitesse.
- **Crossover** (200–2 000 Hz) : Fréquence de séparation des bandes du tambour et de la trompe.
- **Rotor Balance** (-100–100%) : Les valeurs négatives accentuent le tambour ; les positives, la trompe.
- **Stereo Width** (0–100%) : Ampleur de chaque paire stéréo.
- **Doppler Depth** (0–100%) : Variation de hauteur produite par le retard variable.
- **Amplitude Depth** (0–100%) : Variation de volume produite par l'orientation du rotor virtuel.
- **Mix** (0–100%) : Proportion du signal d'origine et du signal rotatif. À 0%, seul le signal d'origine est présent.

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
