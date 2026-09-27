---
title: "Plugins d'analyse - EffeTune"
description: "Plugins de visualisation audio, dont Analog Meter, Chroma Spiral, Level Meter, Note Spectrogram, Oscilloscope, Pitch Meter, Spectrogram, Spectrum Analyzer et Stereo Meter."
lang: fr
---

# Plugins d'analyse

Une collection de plugins qui vous permettent de visualiser votre musique de manière fascinante. Ces outils visuels vous aident à comprendre ce que vous entendez en montrant différents aspects du son, rendant votre expérience d'écoute plus immersive et interactive.

## Liste des plugins

- [Analog Meter](#analog-meter) - Affiche les niveaux de canal sur un vu-mètre à aiguille avec des échelles VU, PPM, pic et sonie
- [Chroma Spiral](#chroma-spiral) - Place les composantes fréquentielles sur une spirale de notes et d'octaves
- [Level Meter](#level-meter) - Affiche le niveau du signal numérique et les risques de clipping
- [Note Spectrogram](#note-spectrogram) - Affiche les hauteurs estimées au fil du temps sous forme de piano roll
- [Oscilloscope](#oscilloscope) - Affiche la visualisation de la forme d'onde en temps réel
- [Pitch Meter](#pitch-meter) - Suit une fréquence fondamentale et son accord au fil du temps
- [Spectrogram](#spectrogram) - Crée de magnifiques motifs visuels à partir de votre musique
- [Spectrum Analyzer](#spectrum-analyzer) - Affiche les différentes fréquences de votre musique
- [Stereo Meter](#stereo-meter) - Visualise l'équilibre stéréo et la corrélation entre canaux

## Analog Meter

Affiche le niveau de chaque canal sur un vu-mètre à aiguille classique, sans modifier le son. Utilisez-le pour suivre d'un instant à l'autre l'intensité de votre musique, ou pour voir comment votre lecture se lit sur les échelles utilisées en radiodiffusion et en streaming : VU, PPM, pic et sonie (LUFS).

### Guide d'utilisation

- **Suivez le niveau moyen avec VU** : observez l'aiguille pendant une chanson. Les couplets calmes et les refrains intenses montrent une nette différence, tandis que les coups de batterie brefs déplacent à peine l'aiguille.
- **Vérifiez l'écrêtage avec True Peak** : placez Analog Meter après vos effets d'égalisation et de gain, puis lisez le passage le plus fort d'un morceau. Si la lecture dépasse 0 dBFS ou que le voyant over s'allume, la chaîne peut écrêter ; réduisez le gain jusqu'à ce que les pics restent sous 0 dBFS, avec une petite marge comme -1 dBFS.
- **Comparez des morceaux avec Loudness** : réglez **Target** sur une référence de streaming comme -14 LUFS, appuyez sur **Reset** au début d'un morceau ou d'un album, puis lisez-le en entier. La valeur Integrated indique la sonie globale et le maximum True Peak indique son pic le plus élevé, ce qui donne un repère pour égaliser le volume d'un album ou d'une playlist. LRA permet de comparer l'ampleur de variation de la sonie de chaque morceau.

### Préréglages système

Cliquez sur **Préréglages d’effet** dans l'en-tête de l'effet pour régler le vu-mètre sur un standard reconnu en une seule étape. Un préréglage qui change **Mode** redémarre la mesure ; passer d'un préréglage Loudness à un autre ne l'interrompt pas.

- **Studio VU (-18 dBFS)** - VU avec 0 VU à -18 dBFS, l'alignement de studio courant (EBU R68). Convient aux enregistrements qui gardent une large marge (headroom).
- **SMPTE VU (-20 dBFS)** - VU avec 0 VU à -20 dBFS (SMPTE RP 155), la pratique des studios et de la radiodiffusion en Amérique du Nord.
- **Hot VU (-14 dBFS)** - Les réglages initiaux : VU avec 0 VU à -14 dBFS, adapté à la plupart des enregistrements commerciaux finalisés.
- **Loud Master VU (-8 dBFS)** - VU avec 0 VU à -8 dBFS, pour les CD modernes et les masters pop poussés au maximum de sonie, qui bloqueraient sinon l'aiguille en haut de l'échelle.
- **DIN PPM** - Le vu-mètre DIN (**Attack** de 5 ms, chute de 20 dB en 1,5 s, échelle DIN) avec le repère -9 à -18 dBFS, si bien que le 0 se trouve à -9 dBFS. L'échelle descend jusqu'à -50.
- **BBC PPM** - Le vu-mètre BBC (**Attack** de 10 ms, chute de 24 dB en 2,8 s, échelle BBC) avec le repère 4 à -18 dBFS, si bien que le repère 6 se trouve à -10 dBFS.
- **Nagra Modulometer** - Le modulomètre des magnétophones Nagra (**Attack** de 7,5 ms, échelle en dB de -30 à +5 dB) avec 0 dB à -18 dBFS. **Release** reprend la valeur DIN de 1,5 s.
- **K-20** - Le K-System de Bob Katz sur un vu-mètre RMS, avec 0 à -20 dBFS et une échelle qui descend jusqu'à -60 dBFS. Pour les enregistrements à grande dynamique.
- **K-14** - Identique, avec 0 à -14 dBFS et l'échelle jusqu'à -60 dBFS. Pour la musique pop courante.
- **K-12** - Identique, avec 0 à -12 dBFS et l'échelle jusqu'à -60 dBFS. Pour les contenus fortement compressés destinés à la diffusion.
- **Digital Peak** - Un vu-mètre de pic numérique standard (IEC 60268-18) de -60 à 0 dBFS, avec un maintien de pic de 2 s.
- **True Peak Clip Watch** - True Peak resserré sur les 20 dB du haut de l'échelle, avec le maintien de pic le plus long (10 s), pour repérer les pics au-dessus de 0 dBFS après une modification de l'EQ ou du gain.
- **EBU R128 (-23 LUFS)** - Loudness avec la cible de la radiodiffusion européenne et l'échelle EBU +9.
- **EBU R128 +18 Scale** - La même cible avec l'échelle EBU +18, plus large, pour la musique classique et les autres contenus à grande dynamique.
- **TV (-24 LKFS)** - Loudness avec la cible de -24 LKFS utilisée pour la télévision aux États-Unis (ATSC A/85) et au Japon (ARIB TR-B32).
- **Streaming (-14 LUFS)** - Loudness avec une cible de -14 LUFS, proche de la normalisation du volume de nombreux services de streaming musical, et l'aiguille Short-term, plus calme.
- **Streaming (-16 LUFS)** - Loudness avec la cible de -16 LUFS recommandée pour le streaming et les podcasts (AES TD1008), et l'aiguille Short-term.

### Paramètres

Seules les commandes qui s'appliquent au **Mode** sélectionné sont affichées.

- **Mode** - Sélectionne le type de vu-mètre : **VU** (par défaut), **PPM**, **RMS**, **Sample Peak**, **True Peak** ou **Loudness**. Chaque mode déplace l'aiguille différemment et utilise sa propre échelle (voir Lire la visualisation). Changer de mode redémarre la mesure.
- **Integration** (RMS ; de 0,05 à 3 s ; valeur initiale : 0,3 s) - Définit le temps de moyennage. Des valeurs plus longues rendent l'aiguille plus stable et plus lente ; des valeurs plus courtes la font suivre les changements plus vite.
- **Attack** (PPM ; de 1 à 20 ms ; valeur initiale : 5 ms) - Définit la vitesse à laquelle l'aiguille monte en mode PPM, exprimée comme la durée d'une salve qui se lit 2 dB sous un signal continu. Des valeurs plus courtes montrent les pics brefs plus près de leur niveau réel ; des valeurs plus longues font lire les pics brefs plus bas. 5 ms correspond au vu-mètre DIN.
- **Release** (PPM, Sample Peak, True Peak ; de 0,1 à 5 s ; valeur initiale : 1,5 s) - Définit le temps que met l'aiguille à retomber de 20 dB après un pic. Des valeurs plus longues facilitent la lecture des pics ; des valeurs plus courtes suivent la musique de plus près. 1,5 s correspond au vu-mètre DIN et au vu-mètre de pic numérique standard.
- **Reference** (VU, PPM, RMS ; de -30 à 0 dBFS ; valeur initiale : -14 dBFS) - Définit le niveau numérique qui correspond au repère de référence du vu-mètre. La valeur initiale convient à la plupart des enregistrements commerciaux finalisés ; avec les alignements de studio à -18 ou -20 dBFS (voir Préréglages système), un CD ordinaire maintient souvent l'aiguille près du haut de l'échelle. Augmentez-le quand des enregistrements intenses poussent l'aiguille en haut de l'échelle ; diminuez-le quand des enregistrements calmes la déplacent à peine.
- **Range** (PPM avec l'échelle DIN ou dB, RMS, Sample Peak, True Peak ; de 20 à 60 dB ; valeur initiale : 40 dB) - Définit jusqu'où l'échelle descend. Élargissez-la pour voir les passages calmes ; réduisez-la pour mieux répartir le haut de l'échelle.
- **PPM Scale** (PPM ; valeur initiale : DIN) - Sélectionne l'échelle du PPM : **DIN**, **BBC** ou **dB** (voir Lire la visualisation).
- **Peak Hold** (PPM, RMS, Sample Peak, True Peak ; de 0 à 10 s ; valeur initiale : 1 s) - Définit la durée pendant laquelle le repère de pic reste sur la lecture la plus haute récente, ainsi que la durée pendant laquelle le voyant over reste allumé. 0 désactive le repère ; le voyant over reste alors allumé 1 s.
- **Needle** (Loudness ; valeur initiale : Momentary) - Sélectionne ce que montre l'aiguille. **Momentary** suit la sonie des 0,4 dernières secondes ; **Short-term** montre les 3 dernières secondes et se déplace plus calmement.
- **Target** (Loudness ; de -36 à -10 LUFS ; valeur initiale : -23 LUFS) - Définit la sonie repérée sur l'échelle et positionne l'échelle par rapport à cette valeur. -23 LUFS est le niveau de diffusion EBU R128 ; de nombreux services de streaming utilisent des valeurs autour de -14 LUFS.
- **Scale** (Loudness ; valeur initiale : EBU +9) - Sélectionne la largeur de l'échelle de sonie. **EBU +9** couvre de 18 LU en dessous à 9 LU au-dessus de **Target** ; **EBU +18** couvre de 36 LU en dessous à 18 LU au-dessus, ce qui convient à une musique à grande dynamique ou à des contenus très intenses.

### Lire la visualisation

- Chaque canal a son propre vu-mètre, jusqu'à quatre par ligne et jusqu'à 16 canaux.
- Les niveaux suivent la convention numérique courante selon laquelle une sinusoïde à pleine échelle se lit 0 dBFS ; une sinusoïde constante donne donc la même lecture dans tous les modes sauf Loudness.
- Les modes diffèrent par la rapidité du mouvement de l'aiguille :

| Mode | Mouvement de l'aiguille | Échelle |
|---|---|---|
| VU | Lent. Il atteint un nouveau niveau en environ 0,3 s et montre le niveau moyen (IEC 60268-17). | De -20 à +3 VU. 0 VU = **Reference**. |
| PPM | Une approximation basée sur IEC 60268-10. Il monte rapidement à la vitesse fixée par **Attack** ; avec la valeur par défaut de 5 ms, une salve de 10 ms est lue environ 1 dB en dessous d'un son continu, comme sur un vu-mètre DIN. Il redescend de 20 dB en un temps égal à **Release**. | Choisie avec **PPM Scale**. **DIN** : le repère -9 = **Reference**, donc 0 se trouve 9 dB au-dessus. **BBC** : repères de 1 à 7, avec 4 dB entre les repères de 2 à 7 et 6 dB entre 1 et 2 ; le repère 4 = **Reference**. **dB** : le repère 0 = **Reference**, de **Range** en dessous jusqu'à +5 dB. |
| RMS | Montre la puissance moyenne sur la durée d'**Integration**, sans lissage supplémentaire. | Le repère 0 = **Reference**. |
| Sample Peak | Saute immédiatement à la valeur d'échantillon la plus haute. | Le haut de l'échelle = 0 dBFS. |
| True Peak | Comme Sample Peak, mais estime aussi les pics entre les échantillons. Peut lire au-dessus de 0 dBFS ; ces pics peuvent écrêter dans un CNA ou pendant la conversion. | Le haut de l'échelle = 0 dBFS. |
| Loudness | Montre la sonie en LUFS selon ITU-R BS.1770 et EBU R128. | Défini par **Target** et **Scale** ; les lectures sont affichées en LUFS. |

- Le repère de pic montre la lecture la plus haute récente pendant la durée de **Peak Hold**. Le voyant over s'allume quand le niveau dépasse 0 dBFS et reste allumé pendant la durée de **Peak Hold**, ou 1 s si **Peak Hold** vaut 0.
- En mode Loudness, le premier vu-mètre montre le programme entier. Son aiguille suit le réglage **Needle**, et il liste Momentary (M), Short-term (S), Integrated (I), Loudness Range (LRA), le maximum True Peak et la durée de mesure écoulée, avec un bouton **Reset**. Integrated et LRA apparaissent une fois qu'assez d'audio a été mesuré.
  - Pour le mono, la stéréo et le 5.1 (ordre des canaux L, R, C, LFE, Ls, Rs), ces valeurs suivent la pondération de canaux standard. Pour d'autres nombres de canaux, tous les canaux sont additionnés à poids égal, donc les valeurs sont indicatives.
  - Les vu-mètres suivants montrent chaque canal séparément. Ce sont des valeurs indicatives, mesurées sans pondération de canaux ni porte.
- Integrated, LRA et le maximum True Peak continuent de s'accumuler jusqu'à ce que vous appuyiez sur **Reset**, changiez de **Mode**, que la fréquence d'échantillonnage ou le nombre de canaux change, ou que le traitement audio redémarre.
- Le temps pendant lequel le traitement est en pause n'est pas mesuré : pendant les pauses d'économie d'énergie en silence, tant que Master Bypass est actif ou qu'Analog Meter est désactivé, ou tant qu'Effect Pipeline n'est pas affiché (par exemple dans la Bibliothèque musicale, lorsque la fenêtre est réduite ou en Mini-lecteur) alors que l'option **Ignorer le DSP d’affichage lorsque l’application est masquée** est activée dans Configuration (c'est le cas par défaut). Les lectures reprennent là où elles s'étaient arrêtées.

## Chroma Spiral

Montre à quelles notes et octaves correspondent les composantes fréquentielles de la musique, sans modifier le son. Utilisez-le pour voir des harmoniques qui se superposent, comparer la tessiture d'une voix et d'une basse ou observer l'étendue d'un instrument.

### Guide d'utilisation

- Tenez une note et regardez sa position ainsi que celles de ses harmoniques. Une seule note peut éclairer plusieurs noms de notes : ce ne sont pas forcément des notes jouées séparément.
- Suivez un accord ou une mélodie pour voir évoluer les positions actives. L'affichage peut suggérer une tonalité, mais ne nomme ni accord ni tonalité.
- Pour observer l'accordage, regardez si un point lumineux ou le bord d'une zone colorée se trouve entre deux repères de notes. Pour lire en cents l'écart d'une fondamentale, utilisez Pitch Meter.
- Appuyez sur le graphique avec la souris, un doigt ou un stylet pour entendre une onde sinusoïdale à la position choisie sur la spirale. Faites glisser pour changer la hauteur ; relâchez ou annulez le geste pour arrêter le son. Cet aperçu fonctionne avec tous les choix de **Color**.

### Paramètres

- **Color** - Choisit la représentation du spectre. Le même guide en spirale reste visible à l'arrière-plan avec chaque choix, même pendant le silence.
  - **Normal** (par défaut) : montre chaque cellule de fréquence sous forme de point dans la couleur du tracé du thème. Sa luminosité suit le niveau de la cellule et sa surface augmente proportionnellement à ce niveau, ce qui rend les fréquences faibles plus faciles à voir. Au niveau maximal, le rayon du point atteint la moitié de l'écart avec le tour suivant.
  - **Normal 2** : colore depuis la position de chaque fréquence sur la spirale jusqu'à son niveau dans la couleur du tracé, sans tracer de contour des données.
  - **Note Colors** : montre les mêmes points que Normal, mais avec une couleur différente pour chaque note, répétée d'une octave à l'autre.
- **Lowest Octave** (1 à 8 ; valeur initiale : 1) - Définit l'octave intérieure. Augmentez-la pour vous concentrer sur les sons aigus.
- **Highest Octave** (1 à 9 ; valeur initiale : 7) - Définit l'octave extérieure. Diminuez-la pour vous concentrer sur les graves et les médiums. Les deux limites restent dans l'ordre.
- **Frequency Tilt** (de -6 à +6 dB/oct par pas de 0,5 ; valeur initiale : +3) - Ajuste le niveau affiché des fréquences au-dessus de 100 Hz sans modifier le son. Les valeurs positives mettent les hautes fréquences en avant, les valeurs négatives les atténuent à l'écran. À 0, aucune correction selon la fréquence n'est appliquée.
- **Level Range** (de 6 à 96 dB par pas de 1 dB ; valeur initiale : 24) - Définit la largeur de la plage d'affichage mobile. Réduisez-la pour accentuer les écarts de niveau ou élargissez-la pour voir les composantes plus faibles à côté des plus fortes.
- **Display Floor** (de -120 à -24 dB par pas de 1 dB ; valeur initiale : -60) - Définit jusqu'où la plage mobile peut descendre dans les passages calmes. Abaissez-le pour permettre l'affichage de composantes plus faibles dans le **Level Range** choisi. La plage suit aussi les pics récents : ce réglage ne garantit donc pas que chaque composante faible sera visible.

### Lire la visualisation

- Un tour représente une octave. C se trouve en haut et les notes suivent le sens horaire ; les tours intérieurs sont plus graves. Les repères C indiquent les numéros d'octave.
- Dans **Normal** et **Note Colors**, les points plus lumineux et plus grands signalent des composantes plus fortes à leur position, y compris entre les notes. Dans **Normal 2**, la zone colorée s'étend davantage vers l'extérieur là où les composantes sont plus fortes ; son bord extérieur montre l'évolution du spectre sans trait distinct.
- La luminosité et la surface des points, ainsi que l'étendue de la zone colorée, indiquent une intensité relative, pas un niveau absolu : l'échelle suit les pics récents.
- Dans le grave, les notes proches se distinguent moins bien et l'affichage réagit plus lentement ; elles peuvent se confondre.

### Affichage Visuel
- Survolez l'affichage, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

## Level Meter

Un affichage visuel qui montre le niveau du signal en temps réel. Il vous aide à vérifier les niveaux après les effets et à repérer un éventuel clipping numérique.

### Guide de Visualisation
- La barre s'étend vers la droite quand le niveau du signal augmente
- Le marqueur blanc conserve un nouveau pic pendant une seconde, puis descend progressivement
- L'avertissement OVERLOAD signifie que le signal a dépassé la plage numérique sûre et peut se déformer
- Pour une lecture propre, évitez les niveaux rouges fréquents et les avertissements OVERLOAD ; réglez le volume d'écoute réel sur votre appareil

## Note Spectrogram

Affiche les fréquences fondamentales (F0) estimées de A0 à C8 dans un piano roll défilant, sans modifier le son. Utilisez-le pour suivre les notes d'un accord, les lignes vocales et mélodiques changeantes, une ligne de basse et les notes superposées dans différentes octaves.

### Guide de Visualisation

- **Vertical** affiche le temps de gauche à droite, avec le clavier et le son actuel sur le bord droit. Les notes aiguës apparaissent en haut.
- **Horizontal** place le clavier en bas, avec les notes graves à gauche et les aiguës à droite. Le nouveau son apparaît juste au-dessus du clavier et l’historique défile vers le haut.
- Les lignes placées sur chaque C délimitent les octaves.
- Les lignes correspondant aux touches noires utilisent un fond gris presque noir afin de rester reconnaissables lorsqu’aucune note n’est détectée.
- **Normal** utilise la couleur du tracé du graphique du thème ; **Note Colors** attribue une couleur à chaque note, identique à toutes les octaves. Les deux affichent entre E et F des repères plus sombres que les limites d’octave.
- **1/12 Octave** affiche une ligne par demi-ton. **High (1/60 Octave)** divise chaque demi-ton en cinq lignes afin de mieux suivre les petites variations de hauteur ; les couleurs sont fondues entre les notes voisines.
- La couleur suit la confiance du modèle de 0 (couleur de fond) à 1 (couleur complète), y compris pour les notes faiblement détectées, sans seuil d’affichage. La confiance indique dans quelle mesure le modèle estime une note présente ; ce n’est pas une probabilité calibrée.
- Lorsque **Volume** est activé, chaque hauteur détectée devient une barre dont l’épaisseur du cœur opaque représente le volume relatif corrigé en fonction de la fréquence, de 1/60 d’octave au bas de l’échelle à 1/12 d’octave en haut. Un fondu de 1/120 d’octave s’étend de chaque côté du cœur, ce qui élargit la largeur totale dessinée de 1/60 d’octave par rapport au cœur. **Pitch Resolution** modifie la position centrale de la barre, pas l’épaisseur de son cœur.
- Au bord du clavier, un demi-cercle aux bords adoucis s’étend vers le graphique et indique le volume actuel. Il réagit immédiatement aux hausses et diminue de 20 dB par seconde ; aucun maintien de crête visible distinct n’est affiché.
- L’échelle de volume couvre 24 dB. Sa limite supérieure suit la plus élevée des deux valeurs entre une référence récente qui stabilise l’échelle de l’historique (sur environ une seconde) et -36 dB, afin que les passages calmes restent lisibles sans que les passages forts remplissent continuellement l’affichage. Cette référence est distincte du demi-cercle du volume actuel.
- Les lignes guides des octaves et de E–F sont tracées derrière les barres de volume afin que la grille des hauteurs reste un repère visuel.
- Les touches passent progressivement de leur couleur habituelle à la couleur d’affichage lorsque la confiance de la dernière image augmente, jusqu’à atteindre cette couleur à 1.
- Changer **Color** recolore l’historique existant.

### Affichage Visuel
- Survolez l'affichage, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

### Ce que vous pouvez voir

- Les accords apparaissent sous forme de plusieurs lignes lumineuses au même instant
- Les mélodies et les lignes de basse dessinent des trajectoires entre les rangées de notes
- L'affichage ne crée ni MIDI ni partition, n'identifie pas les instruments et ne peut pas séparer entièrement tous les sons simultanés. Les superpositions complexes peuvent masquer une partie d'une mélodie ou d'une harmonie, tandis que les percussions, le bruit et les répétitions peu claires peuvent produire occasionnellement une hauteur incorrecte.

### Paramètres

- **Color** - Choisit les couleurs d’affichage sans modifier les estimations de notes.
  - **Normal** (par défaut) : couleur du tracé du graphique du thème.
  - **Note Colors** : une couleur par note, identique à toutes les octaves.
- **Pitch Resolution** - Règle le niveau de détail vertical sans effacer l’historique existant.
  - **1/12 Octave** (par défaut) : une ligne par demi-ton, avec l’estimation la plus forte de cette note.
  - **High (1/60 Octave)** : cinq lignes par demi-ton pour afficher des variations de hauteur plus fines.
- **Layout** - Choisit **Horizontal** (par défaut) ou **Vertical**. L’historique est conservé lors du changement de disposition.
- **Volume** - Affiche le volume relatif par l’épaisseur des barres et des indicateurs en demi-cercle. Il est activé par défaut ; lorsqu’il est désactivé, l’intensité des lignes traduit la confiance.
- **Time Span** (de 1 à 10 s) - Définit la durée affichée dans le piano roll
  - Une valeur courte facilite l'observation des changements de rythme
  - Une valeur longue affiche une portion musicale plus étendue
  - Valeur par défaut : 2 s
- **Regular Note Limit** (1 à 16 notes) - Définit le nombre de notes simultanées hors de la plage grave dédiée qui peuvent atteindre l’étape finale de détection. La valeur par défaut est 8. Augmentez-la pour les accords exceptionnellement denses ; une valeur plus faible réduit le travail d’analyse et la concurrence entre les candidats.
- **Lowest Note** - Définit la note la plus basse de la plage affichée et analysée. Valeur par défaut : E1.
- **Highest Note** - Définit la note la plus haute de la plage affichée et analysée. Valeur par défaut : G6.
- Lorsque l'entrée est trop faible pour l'analyse, le piano roll reste sombre au lieu d'afficher une entrée extrêmement faible comme des hauteurs. Cette suppression ne détermine pas si un son serait audible ou masqué par la perception.

## Oscilloscope

Affiche la forme de l'onde sonore en temps réel, afin de voir les impacts, les battements et les changements de niveau pendant l'écoute. Les réglages de déclenchement peuvent stabiliser l'affichage lorsqu'une forme d'onde se répète.

### Guide de Visualisation
- L'axe horizontal montre le temps (millisecondes)
- L'axe vertical montre l'amplitude normalisée ; la plage visible change avec Display Level et Vertical Offset
- La ligne verte trace la forme d'onde réelle
- Les lignes de la grille aident à mesurer les valeurs de temps et d'amplitude
- Quand un déclenchement est détecté, la forme d'onde affichée démarre depuis cette position ; aucun marqueur séparé n'est affiché

### Affichage Visuel
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

### Paramètres
- **Display Time** - Durée d'affichage (1 à 100 ms)
  - Valeurs basses : Voir plus de détails dans les événements courts
  - Valeurs hautes : Voir des motifs plus longs
- **Trigger Mode**
  - Auto : Mises à jour continues même sans déclenchement
  - Normal : Fige l'affichage jusqu'au prochain déclenchement
  - Off : Sans déclenchement ; affiche en continu la forme d'onde la plus récente. Trigger Level, Trigger Edge et Holdoff sont sans effet
- La détection du déclenchement utilise la moyenne des canaux gauche et droit. Une entrée mono est utilisée directement.
- **Trigger Level** - Niveau d'amplitude qui démarre la capture
  - Plage : -1 à 1 (amplitude normalisée)
- **Trigger Edge**
  - Rising : Déclenche quand le signal monte
  - Falling : Déclenche quand le signal descend
- **Holdoff** - Temps minimum entre les déclenchements (0.1 à 10 ms)
- **Display Level** - Échelle verticale en dB (-96 à 0 dB)
- **Vertical Offset** - Décale la forme d'onde vers le haut/bas (-1 à 1)

### Note sur l'Affichage de la Forme d'Onde
La forme d'onde relie les points capturés dans l'ordre chronologique. Pour les durées d'affichage longues, chaque intervalle conserve son premier et son dernier échantillon, ainsi que les échantillons minimum et maximum à leur position d'origine. La continuité et les pics brefs sont ainsi préservés dans les limites de la résolution d'affichage. Utilisez-la comme guide visuel plutôt que comme outil de mesure exact.

## Pitch Meter

Suit une fréquence fondamentale (F0) à la fois dans un piano roll défilant sur deux secondes, sans modifier le son. Utilisez-le pour vérifier l'accord et les variations de hauteur d'une voix ou d'un instrument seul.

### Guide de visualisation

- **Horizontal** (par défaut) place les notes graves à gauche et les aiguës à droite. La dernière estimation apparaît au-dessus du clavier et l'historique défile vers le haut.
- **Vertical** place les notes graves en bas et les aiguës en haut. La dernière estimation apparaît près du clavier à droite et l'historique avance vers la gauche.
- La position de la ligne indique la hauteur entre les demi-tons. Une estimation plus fiable apparaît plus nettement ; la ligne s'interrompt si l'entrée est trop faible ou si aucune hauteur unique et stable n'est trouvée.
- L'étiquette actuelle indique la note la plus proche et l'écart en cents. Une valeur positive est au-dessus de la note, une valeur négative en dessous. L'étiquette disparaît en l'absence d'estimation fiable.
- Le nom de la note reprend les couleurs de Note Spectrogram. La taille du nom et de l'écart en cents s'adapte à la largeur disponible, et le point décimal des cents reste au même endroit.

### Affichage Visuel
- Survolez l'affichage, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

### Guide d'utilisation

- Commencez par une seule note tenue, puis observez si la ligne reste centrée sur la note ou dérive vers l'aigu ou le grave.
- Le vibrato et les pitch bends apparaissent comme des mouvements fluides entre les rangées de notes.
- Cet analyseur suit une hauteur dominante. Les accords, les mixages denses, les percussions, le bruit ou les sons périodiques indistincts peuvent interrompre la ligne ou produire une octave erronée.

### Paramètres

- **Layout** - Sélectionne **Horizontal** (par défaut) ou **Vertical**.
- **Color** - Change la couleur de la ligne sans modifier la détection de hauteur. **Normal** (par défaut) reprend la couleur du graphique du thème ; **Heatmap** indique le volume sur la même échelle de 24 dB que Note Spectrogram ; **Note Colors** suit la hauteur entre les couleurs des notes.
- **Reference A4** (400 à 480 Hz) - Règle la référence d'accord utilisée pour le nom des notes et l'écart en cents. Valeur par défaut : 440 Hz.
- **Lowest Note** - Définit la limite basse de la plage affichée et analysée. Valeur par défaut : C2. Le réglage minimal est A0.
- **Highest Note** - Définit la limite haute de la plage affichée et analysée. Valeur par défaut : C7. Le réglage maximal est C8.
- L'entrée stéréo est analysée en faisant la moyenne des deux premiers canaux ; une entrée mono est utilisée directement. Un contenu de polarité fortement opposée peut s'annuler dans cette moyenne et ne laisser aucune trace de hauteur.

## Spectrogram

Crée des motifs colorés qui montrent comment votre musique change au fil du temps. Les couleurs indiquent l'intensité de chaque son, tandis que la position verticale indique sa fréquence.

Le graphique défile de droite à gauche à vitesse constante, avec un repère chaque seconde.

### Guide de Visualisation
- Les couleurs montrent l'intensité des différentes fréquences :
  - Couleurs sombres : Sons faibles
  - Couleurs vives : Sons forts
  - Observez les motifs changer avec la musique
- La position verticale indique la fréquence :
  - Bas : Sons graves
  - Milieu : Instruments principaux
  - Haut : Hautes fréquences

### Affichage Visuel
- Survolez l'affichage, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

### Ce Que Vous Pouvez Voir
- Mélodies : Lignes de couleur fluides
- Rythmes : Bandes verticales
- Basses : Couleurs vives en bas
- Harmonies : Lignes parallèles multiples
- Différents instruments créent des motifs uniques

### Paramètres
- **Color** - **Normal** utilise la couleur du graphique du thème et s’éclaircit avec l’intensité des fréquences. **Heatmap** (par défaut) conserve l’échelle multicolore d’origine. Le changement recolore l’historique existant.
- **DB Range** - Intensité des couleurs (-144dB à -48dB)
  - Nombres plus bas : Voir plus de détails subtils
  - Nombres plus hauts : Se concentrer sur les sons principaux
- **Points** - Taille FFT utilisée pour l'affichage (256 à 16384)
  - Nombres plus hauts : plus de détail en fréquence, mais mises à jour temporelles plus lentes
  - Nombres plus bas : mouvement plus rapide, mais moins de détail en fréquence
  - Avec **Log (HQ)**, Points définit la fenêtre d'analyse courte ; une fenêtre quatre fois plus longue améliore la séparation des basses fréquences.
- **Frequency Scale** - **Log** accorde davantage d'espace aux basses fréquences. **Log (HQ)** ajoute une mesure plus longue pour mieux séparer les graves proches tout en conservant la mesure courte pour les aigus. Il demande davantage de traitement et les changements dans le grave peuvent apparaître ou disparaître plus lentement, sans modifier le son. **Linear** répartit uniformément des largeurs de fréquence égales.
- **Keyboard** - Affiche à droite du graphique un clavier statique qui met en relation les notes et les fréquences. Il ne modifie ni l'analyse ni le son. La disposition des touches suit **Log**, **Log (HQ)** ou **Linear** ; **Log (HQ)** conserve le même espacement logarithmique que **Log**, tandis qu'avec **Linear**, les touches graves paraissent plus étroites.
- L'analyseur utilise la moyenne des canaux gauche et droit. Une entrée mono est analysée directement.

## Spectrum Analyzer

Crée un affichage visuel en temps réel des fréquences de votre musique, des basses profondes aux aigus. C'est comme voir les ingrédients individuels qui composent le son complet de votre musique.

### Guide de Visualisation
- La gauche montre les basses fréquences (batterie, basse)
- Le milieu montre les fréquences principales (voix, guitares, piano)
- La droite montre les hautes fréquences (cymbales, brillance, air)
- La ligne épaisse représente le son actuel
- La ligne fine suit les crêtes récentes et descend progressivement lorsqu’elles s’estompent
- Dans l'affichage **Bar**, chaque barre indique le niveau le plus élevé dans une partie de largeur égale de l'affichage. **Log** et **Log (HQ)** utilisent des largeurs d'octave égales ; **Linear** utilise des largeurs de fréquence égales.
- Le fin repère au-dessus d'une barre indique son pic récent et descend progressivement.
- Les pics plus hauts indiquent une présence plus forte de ces fréquences
- Observez comment différents instruments créent différents motifs

### Affichage Visuel
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

### Ce Que Vous Pouvez Voir
- Drops de basse : Grands mouvements à gauche
- Mélodies vocales : Activité au milieu
- Aigus cristallins : Étincelles à droite
- Mix complet : Comment toutes les fréquences fonctionnent ensemble

### Paramètres
- **Color** - **Normal** (par défaut) conserve les couleurs du graphique du thème. **Heatmap** éclaircit les niveaux élevés et **Note Colors** suit les couleurs des notes sur l’axe des fréquences. Le choix s’applique à **Line** et à **Bar**. Avec **Bar** et **Note Colors**, chaque barre et son repère de crête prennent une seule couleur déterminée par la fréquence centrale de la bande.
- **DB Range** - Sensibilité de l'affichage (-144dB à -48dB)
  - Nombres plus bas : Voir plus de détails subtils
  - Nombres plus hauts : Se concentrer sur les sons principaux
- **Points** - Finesse avec laquelle l'affichage sépare les fréquences proches (256 à 16384)
  - Nombres plus hauts : plus de détail en fréquence, avec des mises à jour plus lentes
  - Nombres plus bas : mises à jour plus rapides, avec moins de détail en fréquence
  - Avec **Log (HQ)**, Points définit la fenêtre d'analyse courte ; une fenêtre quatre fois plus longue améliore la séparation des basses fréquences.
- **Frequency Scale** - **Log** accorde davantage d'espace aux basses fréquences. **Log (HQ)** ajoute une mesure plus longue pour mieux séparer les graves proches tout en conservant la mesure courte pour les aigus. Il demande davantage de traitement et les changements dans le grave peuvent apparaître ou disparaître plus lentement, sans modifier le son. **Linear** répartit uniformément des largeurs de fréquence égales.
- **Display** - Change uniquement l'apparence du spectre ; il ne modifie ni l'analyse ni le son.
  - **Line** (par défaut) : Affiche le spectre sous forme de lignes continues.
  - **Bar** : Affiche sous forme de barre le niveau le plus élevé de chaque bande affichée.
- **Keyboard** - Affiche sous le graphique un clavier statique qui met en relation les notes et les fréquences. Il ne modifie ni l'analyse ni le son. La disposition des touches suit **Log**, **Log (HQ)** ou **Linear** ; **Log (HQ)** conserve le même espacement logarithmique que **Log**, tandis qu'avec **Linear**, les touches graves paraissent plus étroites.
- L'analyseur utilise la moyenne des canaux gauche et droit. Une entrée mono est analysée directement.

### Façons Amusantes d'Utiliser Ces Outils

1. Explorer Votre Musique
   - Observez comment différents genres créent différents motifs
   - Voyez la différence entre la musique acoustique et électronique
   - Observez comment les instruments occupent différentes plages de fréquences

2. Apprendre Sur le Son
   - Voyez les basses dans la musique électronique
   - Suivez les mélodies vocales à travers l'affichage
   - Observez comment la batterie crée des motifs nets

3. Améliorer Votre Expérience
   - Utilisez le Level Meter pour vérifier les pics du signal après l'ajout d'effets
   - Regardez le Spectrum Analyzer danser avec la musique
   - Créez un spectacle de lumière visuel avec le Spectrogram

## Stereo Meter

Un outil de visualisation fascinant qui vous permet de voir comment votre musique crée une sensation d'espace à travers le son stéréo. Observez comment les différents instruments et sons se déplacent entre vos enceintes ou votre casque, ajoutant une dimension visuelle captivante à votre expérience d'écoute.

### Guide de Visualisation
- **Affichage en diamant** - La fenêtre principale où la musique prend vie :
  - Centre : niveau très faible ou moment où la somme gauche/droite est proche de zéro
  - Haut/Bas : composante commune aux deux canaux, proche du centre ou du mono (L + R)
  - Gauche/Droite : différence entre les canaux ou composante en opposition de phase (R - L)
  - Lorsqu'un seul côté domine, les points peuvent aussi se diriger vers les coins selon la polarité du signal
  - Les points verts dansent avec la musique actuelle
  - La ligne blanche trace les pics musicaux
  - La ligne blanche des crêtes décroît à chaque échantillon audio, de sorte que son mouvement reste identique quelle que soit la taille des blocs de traitement
- **Barre de corrélation LR** (côté gauche)
  - Montre la corrélation entre les canaux gauche et droit
  - Haut (+1.0) : les canaux sont presque identiques, avec un son qui se regroupe facilement au centre
  - Milieu (0.0) : la relation gauche/droite est faible, souvent avec plus d'ambiance ou de largeur
  - Bas (-1.0) : les canaux sont proches de l'opposition de phase et peuvent sembler plus faibles sur enceintes
- **Barre de Balance** (Bas)
  - Indique si une enceinte est plus forte que l'autre
  - Centre : Musique également forte dans les deux enceintes
  - Gauche/Droite : Musique plus forte dans une enceinte
  - Les chiffres montrent la différence en décibels (dB)

### Ce Que Vous Pouvez Voir
- **Son Centré** : Mouvement vertical fort au milieu
- **Son Spacieux** : Activité répartie sur tout l'affichage
- **Effets Spéciaux** : Motifs intéressants dans les coins
- **Balance des Enceintes** : Où pointe la barre inférieure
- **Corrélation du son** : Position de la barre gauche

### Paramètres
- **Window** (10-1000 ms)
  - Valeurs basses : Voir les changements musicaux rapides
  - Valeurs hautes : Voir les motifs sonores globaux
  - Par défaut : 100 ms convient bien à la plupart des musiques
- **Gain** (0 à 24 dB ; valeur par défaut : 0 dB) - Agrandit uniquement les points et la courbe des crêtes dans le losange. Augmentez la valeur pour mieux voir les motifs des passages à faible niveau. Le son et les indications de corrélation et d'équilibre restent inchangés.

### Profiter de Votre Musique
1. **Observez Différents Styles**
   - La musique classique montre souvent des motifs doux et équilibrés
   - La musique électronique peut créer des designs sauvages et expansifs
   - Les enregistrements live peuvent montrer un mouvement naturel de la salle

2. **Découvrez les Qualités Sonores**
   - Voyez comment différents albums utilisent les effets stéréo
   - Remarquez comment certaines chansons semblent plus larges que d'autres
   - Observez comment les instruments se déplacent entre les enceintes

3. **Améliorez Votre Expérience**
   - Essayez différents casques pour voir comment ils restituent la stéréo
   - Comparez les anciennes et nouvelles versions de vos chansons préférées
   - Observez comment différentes positions d'écoute changent l'affichage

N'oubliez pas : Ces outils sont conçus pour améliorer votre plaisir d'écoute en ajoutant une dimension visuelle à votre expérience musicale. Amusez-vous à explorer et à découvrir de nouvelles façons de voir votre musique préférée !
