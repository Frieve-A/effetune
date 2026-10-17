---
title: "Plugins d'analyse - Analyseur de spectre, spectrogramme, vumètre et sonie en LUFS - EffeTune"
description: "Plugins de visualisation audio, dont Analog Meter, Chroma Spiral, Level Meter, Note Spectrogram, Oscilloscope, Pitch Meter, Rhythm Analyzer, Spectrogram, Spectrum Analyzer et Stereo Meter."
lang: fr
---

# Plugins d'analyse

Une collection de plugins qui vous permettent de visualiser votre musique de manière fascinante. Ces outils visuels vous aident à comprendre ce que vous entendez en montrant différents aspects du son, rendant votre expérience d'écoute plus immersive et interactive.

## Liste des plugins

- [Analog Meter](#analog-meter) - Affiche les niveaux de canal sur un vumètre à aiguille avec des échelles VU, PPM, pic et sonie
- [Chroma Spiral](#chroma-spiral) - Place les composantes fréquentielles sur une spirale de notes et d'octaves
- [Level Meter](#level-meter) - Affiche le niveau du signal numérique et les risques de clipping
- [Note Spectrogram](#note-spectrogram) - Affiche les hauteurs estimées au fil du temps sous forme de piano roll
- [Oscilloscope](#oscilloscope) - Affiche la visualisation de la forme d'onde en temps réel
- [Pitch Meter](#pitch-meter) - Suit une fréquence fondamentale et son accord au fil du temps
- [Rhythm Analyzer](#rhythm-analyzer) - Affiche le tempo, les coups temps par temps, et l'avance ou le retard de chaque partie
- [Spectrogram](#spectrogram) - Crée de magnifiques motifs visuels à partir de votre musique
- [Spectrum Analyzer](#spectrum-analyzer) - Affiche les différentes fréquences de votre musique
- [Stereo Meter](#stereo-meter) - Visualise l'équilibre stéréo et la corrélation entre canaux

## Analog Meter

Affiche le niveau de chaque canal sur un vumètre à aiguille classique, sans modifier le son. Utilisez-le pour suivre d'un instant à l'autre l'intensité de votre musique, ou pour voir comment votre lecture se lit sur les échelles utilisées en radiodiffusion et en streaming : VU, PPM, pic et sonie (LUFS). **Custom** permet de combiner un détecteur, le mouvement de l’aiguille et une graduation pour créer votre propre indicateur.

### Guide d'utilisation

- **Suivez le niveau moyen avec VU** : observez l'aiguille pendant une chanson. Les couplets calmes et les refrains intenses montrent une nette différence, tandis que les coups de batterie brefs déplacent à peine l'aiguille.
- **Vérifiez l'écrêtage avec True Peak** : placez Analog Meter après vos effets d'égalisation et de gain, puis lisez le passage le plus fort d'un morceau. Si la lecture dépasse 0 dBFS ou que le voyant over s'allume, la chaîne peut écrêter ; réduisez le gain jusqu'à ce que les pics restent sous 0 dBFS, avec une petite marge comme -1 dBFS.
- **Comparez des morceaux avec Loudness** : réglez **Target** sur une référence de streaming comme -14 LUFS, appuyez sur **Reset** au début d'un morceau ou d'un album, puis lisez-le en entier. La valeur Integrated indique la sonie globale et le maximum True Peak indique son pic le plus élevé, ce qui donne un repère pour égaliser le volume d'un album ou d'une playlist. LRA permet de comparer l'ampleur de variation de la sonie de chaque morceau.
- **Créez votre indicateur avec Custom** : commencez par **Bouncy VU** pour une aiguille plus vive, **Slow RMS** pour suivre le niveau moyen calmement ou **Fast Peak** pour suivre les pics brefs. Réglez la vitesse avec **Needle Response** et le rebond avec **Overshoot**. Custom peut donner une montée et un retour d’allure PPM, mais ses détecteurs de pic montent instantanément ; utilisez **PPM** pour la réponse PPM standard.

### Préréglages système

Cliquez sur **Préréglages d’effet** dans l'en-tête de l'effet pour choisir un indicateur standard ou personnalisé en une seule étape. Un préréglage qui change **Mode** redémarre la mesure ; passer d'un préréglage Loudness à un autre ne l'interrompt pas.

- **Studio VU (-18 dBFS)** - VU avec 0 VU à -18 dBFS, l'alignement de studio courant (EBU R68). Convient aux enregistrements qui gardent une large marge (headroom).
- **SMPTE VU (-20 dBFS)** - VU avec 0 VU à -20 dBFS (SMPTE RP 155), la pratique des studios et de la radiodiffusion en Amérique du Nord.
- **Hot VU (-14 dBFS)** - Les réglages initiaux : VU avec 0 VU à -14 dBFS, adapté à la plupart des enregistrements commerciaux finalisés.
- **Loud Master VU (-8 dBFS)** - VU avec 0 VU à -8 dBFS, pour les CD modernes et les masters pop poussés au maximum de sonie, qui bloqueraient sinon l'aiguille en haut de l'échelle.
- **DIN PPM** - Le vumètre DIN (**Attack** de 5 ms, chute de 20 dB en 1,5 s, échelle DIN) avec le repère -9 à -18 dBFS, si bien que le 0 se trouve à -9 dBFS. L'échelle descend jusqu'à -50.
- **BBC PPM** - Le vumètre BBC (**Attack** de 10 ms, chute de 24 dB en 2,8 s, échelle BBC) avec le repère 4 à -18 dBFS, si bien que le repère 6 se trouve à -10 dBFS.
- **Nagra Modulometer** - Le modulomètre des magnétophones Nagra (**Attack** de 7,5 ms, échelle en dB de -30 à +5 dB) avec 0 dB à -18 dBFS. **Release** reprend la valeur DIN de 1,5 s.
- **K-20** - Le K-System de Bob Katz sur un vumètre RMS, avec 0 à -20 dBFS et une échelle qui descend jusqu'à -60 dBFS. Pour les enregistrements à grande dynamique.
- **K-14** - Identique, avec 0 à -14 dBFS et l'échelle jusqu'à -60 dBFS. Pour la musique pop courante.
- **K-12** - Identique, avec 0 à -12 dBFS et l'échelle jusqu'à -60 dBFS. Pour les contenus fortement compressés destinés à la diffusion.
- **Digital Peak** - Un vumètre de pic numérique standard (IEC 60268-18) de -60 à 0 dBFS, avec un maintien de pic de 2 s.
- **True Peak Clip Watch** - True Peak resserré sur les 20 dB du haut de l'échelle, avec le maintien de pic le plus long (10 s), pour repérer les pics au-dessus de 0 dBFS après une modification de l'EQ ou du gain.
- **EBU R128 (-23 LUFS)** - Loudness avec la cible de la radiodiffusion européenne et l'échelle EBU +9.
- **EBU R128 +18 Scale** - La même cible avec l'échelle EBU +18, plus large, pour la musique classique et les autres contenus à grande dynamique.
- **TV (-24 LKFS)** - Loudness avec la cible de -24 LKFS utilisée pour la télévision aux États-Unis (ATSC A/85) et au Japon (ARIB TR-B32).
- **Streaming (-14 LUFS)** - Loudness avec une cible de -14 LUFS, proche de la normalisation du volume de nombreux services de streaming musical, et l'aiguille Short-term, plus calme.
- **Streaming (-16 LUFS)** - Loudness avec la cible de -16 LUFS recommandée pour le streaming et les podcasts (AES TD1008), et l'aiguille Short-term.
- **Bouncy VU** - Custom avec le détecteur et la graduation VU, et un dépassement de 15% pour accentuer le rebond de l’aiguille.
- **Slow RMS** - Custom avec une moyenne RMS de 3 s, une réponse d’aiguille de 1000 ms et sans dépassement. La graduation dB place le 0 à -18 dBFS et descend jusqu’à -60 dBFS.
- **Fast Peak** - Custom avec détection True Peak, relâchement du détecteur de 0,5 s, réponse d’aiguille de 10 ms et sans dépassement. La graduation dBFS couvre les 40 dB supérieurs et affiche les lectures en dBTP.

### Paramètres

Seules les commandes qui s'appliquent au **Mode** sélectionné sont affichées. En **Custom**, toutes les commandes de ce mode restent visibles ; celles qui ne s’appliquent pas sont désactivées, et le panneau de réglages conserve la même hauteur.

- **Mode** - Choisit le type d’indicateur : **VU** (par défaut), **PPM**, **RMS**, **Sample Peak**, **True Peak**, **Loudness** ou **Custom**. Chaque mode déplace l’aiguille différemment et utilise sa propre échelle (voir le Guide de visualisation). Changer de mode redémarre la mesure.
- **Detector** (Custom ; par défaut : Average Rectified) - Choisit le niveau que suit l’aiguille. **Average Rectified** utilise l’amplitude absolue du signal, moyennée par l’aiguille elle-même sans fenêtre de moyenne supplémentaire, comme en VU. **RMS** mesure la puissance moyenne sur **Integration**. **Sample Peak** détecte la valeur d’échantillon la plus élevée ; **True Peak** estime aussi les pics entre les échantillons. Les deux détecteurs de pic montent instantanément et redescendent selon **Release**. Changer de détecteur redémarre la mesure.
- **Integration** (RMS , Custom avec détecteur RMS; de 0,05 à 3 s ; valeur initiale : 0,3 s) - Définit le temps de moyennage. Des valeurs plus longues rendent l'aiguille plus stable et plus lente ; des valeurs plus courtes la font suivre les changements plus vite. En Custom, la réponse propre de l’aiguille s’ajoute après cette moyenne.
- **Attack** (PPM ; de 1 à 20 ms ; valeur initiale : 5 ms) - Définit la vitesse à laquelle l'aiguille monte en mode PPM, exprimée comme la durée d'une salve qui se lit 2 dB sous un signal continu. Des valeurs plus courtes montrent les pics brefs plus près de leur niveau réel ; des valeurs plus longues font lire les pics brefs plus bas. 5 ms correspond au vumètre DIN.
- **Release** (PPM, Sample Peak, True Peak, Custom avec détecteur Sample Peak ou True Peak ; de 0,1 à 5 s ; par défaut : 1,5 s) - Définit le temps de retour de 20 dB après un pic. Une durée plus longue facilite la lecture des pics ; une durée plus courte suit la musique de plus près. En Custom, ce réglage contrôle le retour du détecteur, suivi de la réponse de l’aiguille. 1,5 s correspond à l’indicateur DIN et à l’indicateur de pic numérique standard.
- **Needle Response** (Custom ; de 1 à 3000 ms ; par défaut : 300 ms) - Définit le temps nécessaire à l’aiguille pour atteindre pour la première fois 99% d’un nouveau niveau constant du détecteur. Une valeur plus basse accélère l’aiguille ; une valeur plus haute la ralentit. La moyenne RMS et le relâchement des pics influencent aussi le mouvement global.
- **Overshoot** (Custom ; de 0 à 25% ; par défaut : 1,25%) - Définit de combien l’aiguille dépasse un nouveau niveau constant du détecteur, en pourcentage du changement de niveau. Une valeur plus haute accentue le rebond ; à 0, l’aiguille s’approche sans dépasser le niveau.
- **Dial** (Custom ; par défaut : VU) - Choisit **VU**, **DIN**, **BBC**, **dB** ou **dBFS** indépendamment du détecteur et du mouvement de l’aiguille. VU, DIN et BBC utilisent les échelles décrites ci-dessous. En dB, le repère 0 correspond à **Reference** et le haut de l’échelle à 0 dBFS. En dBFS, le haut est à 0 dBFS et les lectures sont en dBTP lorsque **Detector** est True Peak.
- **Reference** (VU, PPM, RMS , Custom sauf avec graduation dBFS; de -30 à 0 dBFS ; valeur initiale : -14 dBFS) - Définit le niveau numérique qui correspond au repère de référence du vumètre. La valeur initiale convient à la plupart des enregistrements commerciaux finalisés ; avec les alignements de studio à -18 ou -20 dBFS (voir Préréglages système), un CD ordinaire maintient souvent l'aiguille près du haut de l'échelle. Augmentez-le quand des enregistrements intenses poussent l'aiguille en haut de l'échelle ; diminuez-le quand des enregistrements calmes la déplacent à peine.
- **Range** (PPM avec l'échelle DIN ou dB, RMS, Sample Peak, True Peak , Custom avec graduation DIN, dB ou dBFS; de 20 à 60 dB ; valeur initiale : 40 dB) - Définit jusqu'où l'échelle descend. Élargissez-la pour voir les passages calmes ; réduisez-la pour mieux répartir le haut de l'échelle.
- **PPM Scale** (PPM ; valeur initiale : DIN) - Sélectionne l'échelle du PPM : **DIN**, **BBC** ou **dB** (voir Lire la visualisation).
- **Peak Hold** (PPM, RMS, Sample Peak, True Peak , Custom; de 0 à 10 s ; valeur initiale : 1 s) - Définit la durée pendant laquelle le repère de pic reste sur la lecture la plus haute récente, ainsi que la durée pendant laquelle le voyant over reste allumé. 0 désactive le repère ; le voyant over reste alors allumé 1 s.
- **Needle** (Loudness ; valeur initiale : Momentary) - Sélectionne ce que montre l'aiguille. **Momentary** suit la sonie des 0,4 dernières secondes ; **Short-term** montre les 3 dernières secondes et se déplace plus calmement.
- **Target** (Loudness ; de -36 à -10 LUFS ; valeur initiale : -23 LUFS) - Définit la sonie repérée sur l'échelle et positionne l'échelle par rapport à cette valeur. -23 LUFS est le niveau de diffusion EBU R128 ; de nombreux services de streaming utilisent des valeurs autour de -14 LUFS.
- **Scale** (Loudness ; valeur initiale : EBU +9) - Sélectionne la largeur de l'échelle de sonie. **EBU +9** couvre de 18 LU en dessous à 9 LU au-dessus de **Target** ; **EBU +18** couvre de 36 LU en dessous à 18 LU au-dessus, ce qui convient à une musique à grande dynamique ou à des contenus très intenses.

### Lire la visualisation

- Chaque canal a son propre vumètre, jusqu'à quatre par ligne et jusqu'à 16 canaux.
- Les niveaux suivent la convention numérique courante selon laquelle une sinusoïde à pleine échelle se lit 0 dBFS ; une sinusoïde constante donne donc la même lecture dans tous les modes sauf Loudness.
- Les modes diffèrent par la rapidité du mouvement de l'aiguille :

| Mode | Mouvement de l'aiguille | Échelle |
|---|---|---|
| VU | Lent. Il atteint un nouveau niveau en environ 0,3 s et montre le niveau moyen (IEC 60268-17). | De -20 à +3 VU. 0 VU = **Reference**. |
| PPM | Une approximation basée sur IEC 60268-10. Il monte rapidement à la vitesse fixée par **Attack** ; avec la valeur par défaut de 5 ms, une salve de 10 ms est lue environ 1 dB en dessous d'un son continu, comme sur un vumètre DIN. Il redescend de 20 dB en un temps égal à **Release**. | Choisie avec **PPM Scale**. **DIN** : le repère -9 = **Reference**, donc 0 se trouve 9 dB au-dessus. **BBC** : repères de 1 à 7, avec 4 dB entre les repères de 2 à 7 et 6 dB entre 1 et 2 ; le repère 4 = **Reference**. **dB** : le repère 0 = **Reference**, de **Range** en dessous jusqu'à +5 dB. |
| RMS | Montre la puissance moyenne sur la durée d'**Integration**, sans lissage supplémentaire. | Le repère 0 = **Reference**. |
| Sample Peak | Saute immédiatement à la valeur d'échantillon la plus haute. | Le haut de l'échelle = 0 dBFS. |
| True Peak | Comme Sample Peak, mais estime aussi les pics entre les échantillons. Peut lire au-dessus de 0 dBFS ; ces pics peuvent écrêter dans un CNA ou pendant la conversion. | Le haut de l'échelle = 0 dBFS. |
| Loudness | Montre la sonie en LUFS selon ITU-R BS.1770 et EBU R128. | Défini par **Target** et **Scale** ; les lectures sont affichées en LUFS. |
| Custom | Suit **Detector**, avec une vitesse définie par **Needle Response** et un rebond défini par **Overshoot**. Les réglages par défaut donnent le même mouvement qu’en VU. | Choisie avec **Dial**, indépendamment du mouvement de l’aiguille. |

- Le repère de pic montre la lecture la plus haute récente pendant la durée de **Peak Hold**. Le voyant over s'allume quand le niveau dépasse 0 dBFS et reste allumé pendant la durée de **Peak Hold**, ou 1 s si **Peak Hold** vaut 0.
- En mode Loudness, le premier vumètre montre le programme entier. Son aiguille suit le réglage **Needle**, et il liste Momentary (M), Short-term (S), Integrated (I), Loudness Range (LRA), le maximum True Peak et la durée de mesure écoulée, avec un bouton **Reset**. Integrated et LRA apparaissent une fois qu'assez d'audio a été mesuré.
  - Pour le mono, la stéréo et le 5.1 (ordre des canaux L, R, C, LFE, Ls, Rs), ces valeurs suivent la pondération de canaux standard. Pour d'autres nombres de canaux, tous les canaux sont additionnés à poids égal, donc les valeurs sont indicatives.
  - Les vumètres suivants montrent chaque canal séparément. Ce sont des valeurs indicatives, mesurées sans pondération de canaux ni porte.
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

Affiche les fréquences fondamentales (F0) estimées de A0 à C8 dans un piano roll défilant, sans modifier le son. Utilisez-le pour suivre les notes d'un accord, les lignes vocales et mélodiques, les lignes de basse et les notes superposées sur plusieurs octaves, avec en option un codage couleur et une mise en évidence par instrument.

### Guide d'utilisation

- **Accords et mélodies** : Les accords apparaissent sous forme de plusieurs rangées lumineuses simultanées ; les mélodies et les lignes de basse dessinent des trajectoires entre les rangées de notes.
- **Suivre la voix ou la basse** : Choisissez **Instrument (3)**, ou gardez **Note Colors** et sélectionnez **Vocal** ou **Bass** dans **Highlight**. Utilisez **Instrument (9)** pour un regroupement plus fin des instruments.
- **Fiabilité des estimations** : Les estimations de hauteur et d'instrument sont une aide visuelle à l'écoute, pas une transcription exacte. Les sons superposés, les percussions ou le bruit peuvent produire des estimations ambiguës, et la batterie n'est pas classée. L'estimation des instruments s'appuie sur les notes précédentes : elle est donc moins fiable juste après son activation ou un déplacement de la position de lecture ; une fois établie, une estimation n'est plus modifiée.

### Groupes d'instruments

**Instrument (3)** regroupe les hauteurs en **Vocal**, **Bass** et **Other** (tous les groupes ci-dessous sauf Vocal et Bass).

**Instrument (9)** répartit les hauteurs en neuf groupes :
- **Vocal** : Chant humain enregistré, voix solistes et chœurs compris.
- **Bass** : Basses acoustiques, électriques et synthétiques.
- **Guitar** : Guitares acoustiques, électriques au son clair et saturées.
- **Piano** : Pianos acoustiques et électriques, clavecin et clavinet.
- **Strings** : Cordes solistes et d'ensemble, pizzicato, harpe et cordes synthétiques.
- **Wind** : Cuivres et bois, saxophones et flûtes compris.
- **Synth** : Leads et nappes de synthétiseur.
- **Organ** : Orgues, accordéon et harmonica.
- **Other** : Percussions à hauteur déterminée (célesta, vibraphone), sons synthétiques de chœur ou de voix, effets de synthétiseur, accents orchestraux, instruments ethniques et effets sonores.

### Paramètres

- **Color** - Choisit les couleurs d'affichage sans modifier la détection des hauteurs (changer de réglage recolore l'historique existant) :
  - **Normal** (par défaut) : Couleur du tracé du graphique du thème.
  - **Note Colors** : Une couleur distincte par classe de hauteur, répétée à chaque octave.
  - **Instrument (3)** : Couleurs pour Vocal, Bass et Other.
  - **Instrument (9)** : Couleurs pour les neuf groupes d'instruments ci-dessus.
- **Highlight** - Met en évidence un groupe précis (**Vocal**, **Bass**, **Other (3)**, **Guitar**, **Piano**, **Strings**, **Wind**, **Synth**, **Organ** ou **Other (9)**) en rapprochant d'un gris neutre les notes d'autant plus qu'elles ont peu de chances d'appartenir à ce groupe, tout en conservant l'épaisseur liée au volume. **None** (par défaut) désactive la mise en évidence.
  - L'analyse des attaques et des instruments utilise davantage de processeur. Pour réduire au minimum l'utilisation du processeur, désactivez **Onsets**, choisissez **Normal** ou **Note Colors**, et réglez **Highlight** sur **None**.
- **Pitch Resolution** - Choisit le niveau de détail vertical des hauteurs sans effacer l'historique :
  - **1/12 Octave** (par défaut) : Une rangée par demi-ton.
  - **High** : Place les hauteurs à leur position estimée en cents pour montrer le vibrato et les pitch bends.
- **Layout** - **Horizontal** (par défaut, clavier en bas, l'historique défile vers le haut) ou **Vertical** (clavier à droite, l'historique défile vers la gauche).
- **Volume** - Traduit le volume relatif par l'épaisseur des barres et par des indicateurs en demi-cercle au bord du clavier (activé par défaut). Lorsqu'il est désactivé, l'épaisseur des barres est fixe.
- **Onsets** - Marque les attaques de notes estimées par des triangles (▼ en Horizontal, ▶ en Vertical ; désactivé par défaut). Le milieu de la base de chaque triangle indique l'instant et la hauteur de l'attaque : les attaques répétées d'une même hauteur tenue reçoivent donc des marques distinctes. Le désactiver n'arrête pas l'analyse des instruments tant qu'un réglage Instrument de **Color** ou **Highlight** en a besoin.
- **Time Span** (1 à 10 s ; 2 s par défaut) - Durée de l'historique visible dans le piano roll.
- **Lowest Note** / **Highest Note** - Définit la plage de hauteurs analysée et affichée (par défaut : E1 à G6).

### Lire la visualisation

- **Mise à jour des hauteurs** : Un nouveau son apparaît immédiatement, puis son estimation est affinée environ 40, 80 et 160 ms plus tard grâce au son qui suit, sans ajouter de retard à l'affichage ni affecter **Synchroniser les affichages avec l’audio**.
- **Grille et clavier** : Les lignes placées sur chaque C marquent les limites d'octave, les repères E–F restent visibles dans tous les modes, et les rangées des touches noires ont un fond plus sombre. Les touches du piano s'allument selon la confiance actuelle dans la hauteur.
- **Intensité de la couleur** : L'intensité de la couleur indique toujours la confiance dans la hauteur. Lorsque l'entrée est trop faible pour l'analyse, le piano roll reste sombre.
- **Couleurs d'instrument et mise en évidence** : Les couleurs d'instrument mélangent les couleurs des groupes selon leurs probabilités estimées. Les couleurs apparaissent aux positions correspondantes de l’historique une fois l’instrument estimé ; les notes en attente de classement apparaissent en gris neutre. La légende énumère les groupes affichés, suivis de **Highlight:** et du groupe sélectionné lorsque la mise en évidence est active. Survolez un groupe dans la légende pour le mettre temporairement en évidence.
- **Barres de volume** : Lorsque **Volume** est activé, l'épaisseur des barres couvre une plage relative de 24 dB, et un demi-cercle aux bords adoucis au bord du clavier monte immédiatement avec le volume actuel et redescend de 20 dB/s.

### Affichage visuel
- Survolez l'historique, ou touchez-le et faites glisser le doigt, pour lire la note, le temps, **Salience** (confiance dans la hauteur), **Level** (dB) et, lorsque l'analyse des instruments est active, les probabilités estimées des groupes : **Vocal**, **Bass** et **Other** en **Instrument (3)**, les neuf groupes sinon, plus le groupe de **Highlight** s'il n'en fait pas partie (**Not classified** pour les notes sans estimation).

## Oscilloscope

Affiche la forme de l'onde sonore en temps réel : vous voyez les temps forts, les attaques franches et les variations de volume pendant l'écoute. Les réglages de déclenchement stabilisent l'affichage lorsque l'onde se répète.

### Conseils d'utilisation
- Réglez **Display Time** sur 1–20 ms et **Trigger Mode** sur **Auto** pour examiner un cycle d'onde répétitif.
- Réglez **Display Time** sur 1 000–10 000 ms et **Trigger Mode** sur **Off** pour suivre les temps forts et l'enveloppe de volume qui défilent en douceur de droite à gauche.
- En modes **Auto** et **Normal**, la trace se met à jour une fois tout l'intervalle de **Display Time** collecté.

### Paramètres
- **Display Time** (1 à 10 000 ms) - Durée affichée. Les valeurs courtes montrent les cycles individuels de l'onde ; les valeurs longues, l'enveloppe globale.
- **Trigger Mode** :
  - **Auto** : Se met à jour en continu, même sans déclenchement.
  - **Normal** : Ne se met à jour que lorsqu'un déclenchement se produit et conserve la dernière capture jusqu'au déclenchement suivant.
  - **Off** : Défile en continu de droite à gauche ; les réglages de déclenchement sont sans effet.
- **Trigger Level** (-1 à 1) - Seuil d'amplitude normalisée qui lance la capture (détecté sur le signal mono ou sur la moyenne G/D).
- **Trigger Edge** - **Rising** (déclenche au franchissement montant) ou **Falling** (déclenche au franchissement descendant).
- **Holdoff** (0,1 à 10 ms) - Délai minimal entre deux déclenchements.
- **Display Level** (-96 à 0 dB ; 0 dB par défaut) - Définit le niveau qui correspond aux bords haut et bas de l'affichage. 0 dB montre toute la plage ±1 ; des valeurs plus basses agrandissent les signaux plus faibles.
- **Vertical Offset** (-1 à 1) - Décale l'onde verticalement ; les valeurs positives la déplacent vers le haut.

### Lire la visualisation
- **Axe horizontal** : Temps en millisecondes ou en secondes.
- **Axe vertical** : Amplitude normalisée, mise à l'échelle par **Display Level** et décalée par **Vertical Offset**.
- **Ligne ou bande d'enveloppe** : Avec une durée courte, une ligne d'onde continue est tracée ; avec une durée longue, une bande pleine des minima et maxima, pour que les crêtes brèves restent visibles même lorsque de nombreux échantillons partagent la même colonne de pixels.

### Affichage visuel
- Survolez le graphique, ou touchez-le et faites glisser le doigt, pour lire le temps et l'amplitude (ou Minimum/Maximum aux durées longues).

## Pitch Meter

Suit une fréquence fondamentale (F0) à la fois dans un piano roll défilant sur deux secondes, sans modifier le son. Utilisez-le pour vérifier la justesse et les mouvements de hauteur d'une voix ou d'un instrument seul.

### Guide d'utilisation

- Jouez ou chantez une seule note tenue, puis observez si la trace reste centrée sur la rangée de la note ou dérive vers l'aigu ou le grave.
- Le vibrato, les glissés et les pitch bends apparaissent comme des courbes fluides entre les rangées de notes.
- Comme Pitch Meter suit une seule hauteur dominante, les accords, les mixages denses ou les percussions peuvent interrompre la trace ou la faire sauter d'octave ; utilisez [Note Spectrogram](#note-spectrogram) pour la musique polyphonique.
- L'entrée stéréo est analysée en faisant la moyenne des deux premiers canaux (une entrée mono est utilisée directement) : un son de polarité opposée sur les deux canaux peut donc s'annuler et ne laisser aucune trace.

### Paramètres

- **Color** - Change la couleur de la trace sans modifier la détection : **Normal** (couleur de tracé du thème, par défaut), **Heatmap** (volume relatif sur une plage de 24 dB) ou **Note Colors** (couleurs des classes de hauteur).
- **Layout** - **Horizontal** (par défaut, clavier en bas, l'historique défile vers le haut) ou **Vertical** (clavier à droite, l'historique défile vers la gauche).
- **Reference A4** (400 à 480 Hz ; 440 Hz par défaut) - Référence d'accord utilisée pour le nom des notes et l'écart en cents.
- **Lowest Note** / **Highest Note** - Définit la plage de hauteurs analysée et affichée (par défaut : C2 à C7 ; plage complète : A0 à C8).

### Lire la visualisation

- La position de la trace indique la hauteur en continu entre les demi-tons ; une confiance plus élevée trace une ligne plus lumineuse, et le silence ou un son sans hauteur interrompt la ligne.
- L'étiquette indique le nom de la note la plus proche (colorée selon la classe de hauteur) et l'écart de justesse en cents (`+` au-dessus, `-` en dessous ; par exemple `+3.5 cent`).

### Affichage visuel
- Survolez l'affichage, ou touchez-le et faites glisser le doigt, pour lire les valeurs à cet endroit.

## Rhythm Analyzer

Calcule le tempo de votre musique et affiche, temps par temps, où tombent les coups de batterie et d'instruments, ainsi que l'avance ou le retard de chaque partie, sans modifier le son sauf si **Metronome Click** est activé. Utilisez-le pour trouver le BPM d'un morceau, mesurer le swing, voir si la caisse claire tombe derrière le temps, ou repérer les fills de batterie et les changements de section.

### Guide d'utilisation

- **Vérifier le tempo** : Lancez un morceau au rythme régulier. Le BPM confirmé et la ligne **adopted** apparaissent environ 1 à 2 secondes après le son, tandis que **LOCKED** indique que les pulsations actives sont montrées par le voyant et le clic. Si l'analyseur se cale au double ou à la moitié du tempo que vous ressentez, comparez **×½**, **×2** et **strongest**.
- **Entendre où tombe le temps** : Activez **Metronome Click** pour entendre un clic sur chaque temps détecté. Placez Rhythm Analyzer à la fin de la chaîne d'effets lorsque vous écoutez avec le clic, et désactivez **Metronome Click** avant d'exporter des fichiers audio traités.
- **Corriger un calage au double ou à la moitié du tempo** : Si une ballade lente se cale au double du tempo, baissez **Max BPM** en dessous de cette valeur ; si un morceau rapide se cale à la moitié du tempo, augmentez **Min BPM** au-dessus.
- **Lire le groove et le micro-timing** : Les rythmes programmés se placent près du centre de la voie, avec un **jitter** proche de 0 ms. Une caisse claire systématiquement en retard de 15 ms sur la grosse caisse apparaît comme des points **Mid** au-dessus du centre de la voie aux temps 2 et 4, et comme un repère **+15** dans la **Beat lens**.
- **Lire le swing** : **swing** indique le rapport de retard du contre-temps (1.00:1 est droit, 2.00:1 est un shuffle en triolet). Dans un groove swingué, les coups du contre-temps se regroupent dans la colonne **⅔** de la **Beat lens** plutôt que dans **&**.
- **Repérer les fills et les changements** : Les anneaux (**◎**) signalent les coups qui n'étaient pas joués à la même position un ou deux cycles plus tôt, ce qui fait ressortir les fills de batterie et les transitions de section dans les **Echo rows**.
- **Quand searching s'affiche** : Les nouvelles pulsations et les clics s'arrêtent, mais l'analyse continue ; le tempo, les **Timing lanes** et la **Beat lens** restent visibles et s'estompent à mesure que la confiance diminue. Le silence efface les valeurs du temps en cours et la colonne du **Tempogram** ; l'analyse reprend dès que le son revient.

### Paramètres

- **Min BPM** (40 à 192 ; 40 par défaut) / **Max BPM** (50 à 240 ; 240 par défaut) - Plage de recherche du tempo (Max BPM reste au moins égal à 1,25 × Min BPM ; modifier l'une ou l'autre relance l'analyse).
- **Metronome Click** (désactivé par défaut) - Mélange un clic bref à −10 dBFS aux canaux 1 et 2 (canal 1 en mono) à chaque pulsation détectée ; les autres canaux restent inchangés.
- **Span (beats)** (4, 6, 8, 12 ou 16 ; 8 par défaut) - Nombre de temps affichés dans les **Timing lanes** et dans chaque ligne des **Echo rows** (par exemple 8 pour deux mesures à 4/4, 6 pour deux mesures à 3/4).
- **Tempogram**, **Timing lanes**, **Echo rows**, **Beat lens** - Affichent ou masquent chaque panneau (**Timing lanes** et **Beat lens** sont activés au départ ; masquer un panneau n'arrête pas l'analyse).

### Lire la visualisation

Sur un affichage large, la **Beat lens** se place à droite des **Timing lanes** ; sur un affichage haut, tous les panneaux sont empilés. Les coups sont répartis en rangées **High** (charleston, cymbales), **Mid** (caisse claire, voix, instruments) et **Low** (grosse caisse, basse) :
- **En-tête** : Affiche le voyant qui clignote à chaque pulsation (plus faible quand la confiance baisse, vide pendant **searching**), le BPM confirmé (**LOCKED** ou **searching**), **×½**, **×2**, le candidat **strongest** du **Tempogram**, le rapport **swing** (calculé sur les 32 derniers temps), le **jitter** (dispersion typique des coups autour de leur position moyenne, en ms) et la légende des symboles. Les valeurs pas encore disponibles s'affichent sous la forme —.
- **Tempogram** : Historique de 20 secondes de l'appui de chaque tempo, avec **Time** de gauche à droite et **Tempo (BPM)** de 30 à 480 sur une échelle logarithmique, et en surimpression la ligne pleine du tempo **adopted** et les lignes en tirets **×2** / **×½**. La luminosité montre l'appui relatif de chaque tempo, pas la probabilité qu'il soit correct.
- **Timing lanes** : Montrent les coups des *N* derniers temps (**Span (beats)** ; légende **Last N beats**) ; un point plus gros indique un coup plus certain, et les positions les plus récentes sont des estimations qui se fixent environ 1 à 2 secondes plus tard. La hauteur du trait vertical indique le micro-timing par rapport à la grille de doubles croches ou de triolets la plus proche, comparé au timing typique des 16 temps précédents (repères pointillés **+20** / **−20** ms ; au-dessus du centre = en retard, en dessous = en avance ; les coups au-delà de ±30 ms restent au bord de la voie). Les cercles vides (**○**) sont des coups dont le timing n'est pas disponible (tracés au centre de la voie), les zones ombrées marquent les périodes sans analyse du timing, les anneaux (**◎**) marquent les coups nouveaux par rapport à 1–2 cycles plus tôt, et les lignes verticales en tirets marquent les réalignements de la grille des temps.
- **Echo rows** : Empilent verticalement les cycles précédents de *N* temps, le plus récent en haut, pour que les motifs de mesure répétés s'alignent en colonnes et que les fills ou variations ressortent. **Cycles ago** numérote les lignes à partir de 1 ; lorsque les **Timing lanes** sont masquées, la ligne du haut est le cycle en cours (0). Chaque coup montre sa bande, mais pas son timing.
- **Beat lens** : Résume, pour chaque bande, l'avance (repère à gauche) ou le retard (repère à droite) moyen de jeu (échelle ±30 ms) et la dispersion (barre estompée, ± un écart type) selon les subdivisions du temps (**1**, **e**, **&**, **a**, **⅓**, **⅔**) sur les 32 dernières pulsations confirmées. Les décalages sont relatifs à l'ensemble ; un repère plus opaque signifie que la position est jouée plus souvent ; une position a besoin d'au moins quatre coups pour apparaître, et les décalages de 3 ms ou plus sont étiquetés. Tant que l'analyse des temps n'est pas disponible, la **Beat lens** affiche **waiting for a steady beat**.
- **Confiance** : Des valeurs plus pâles indiquent une confiance moindre dans l'analyse, pas un jeu moins précis.
- **Reset** : Le bouton **Reset** sous l'affichage l'efface et relance l'analyse, par exemple lorsqu'une autre application change de morceau. Lorsque le lecteur d'EffeTune démarre un nouveau morceau, l'analyse repart automatiquement.

### Affichage visuel
- Survolez l'affichage, ou touchez-le et faites glisser le doigt, pour lire les valeurs : dans les **Timing lanes** et les **Echo rows**, le nombre de temps écoulés, la bande et le timing du coup le plus proche (— si indisponible) ; dans le **Tempogram**, le tempo, **Tempo support** et le tempo **Adopted** ; dans la **Beat lens**, le décalage et la dispersion de chaque bande.

### Limites

- Le suivi du tempo et des temps est moins sûr sur le rubato, la musique classique, le piano solo ou les passages ambiants ou sans pulsation, et la pulsation peut se caler au double, à la moitié, aux deux tiers ou à une fois et demie le tempo que vous ressentez, ou sur le contre-temps (utilisez **Min BPM** / **Max BPM** pour restreindre la plage). **LOCKED** ne garantit pas que la pulsation est correcte.
- Quand le tempo change en continu, la pulsation suit avec un léger retard : le clic peut donc tomber un peu en avance ou en retard.
- Dans les mixages denses et les enregistrements bruités, les voies **Mid** et **High** peuvent montrer des points en trop, et la voie **Low** manque certaines notes graves de piano.
- L'analyseur suit les temps, pas les barres de mesure ni la métrique (il n'identifie pas le premier temps).
- Fréquences d'échantillonnage prises en charge : 8 ; 11,025 ; 16 ; 22,05 ; 24 ; 32 ; 44,1 ; 48 ; 88,2 ; 96 ; 176,4 ; 192 ; 352,8 et 384 kHz. À d'autres fréquences, le son passe sans modification, mais l'analyse et les clics sont indisponibles.

## Spectrogram

Montre comment votre musique évolue au fil du temps. L'intensité de la couleur indique la force de chaque fréquence, tandis que la position verticale indique sa fréquence.

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
- Avec **Log (HQ)**, les sons graves proches apparaissent sous forme de bandes plus nettement séparées. La mesure plus longue des basses fréquences peut mettre un peu plus de temps à se stabiliser ou à s'estomper.

### Affichage Visuel
- Survolez l'affichage, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

### Ce Que Vous Pouvez Voir
- Mélodies : Lignes de couleur fluides
- Rythmes : Bandes verticales
- Basses : Couleurs vives en bas
- Harmonies : Lignes parallèles multiples
- Différents instruments créent des motifs uniques

### Paramètres
- **DB Range** - Intensité des couleurs (-144dB à -48dB)
  - Nombres plus bas : Voir plus de détails subtils
  - Nombres plus hauts : Se concentrer sur les sons principaux
- **Points** - Taille FFT utilisée pour l'affichage (256 à 16384)
  - Nombres plus hauts : plus de détail en fréquence, mais mises à jour temporelles plus lentes
  - Nombres plus bas : mouvement plus rapide, mais moins de détail en fréquence
  - Avec **Log (HQ)**, Points définit la fenêtre d'analyse courte ; une fenêtre quatre fois plus longue améliore la séparation des basses fréquences.
- **Color** - **Normal** utilise la couleur du graphique du thème et affiche plus lumineusement les fréquences les plus fortes. **Heatmap** (par défaut) utilise l’échelle multicolore d’origine, du sombre au lumineux. Changer de couleur recolore l’historique existant.
- **Frequency Scale** - **Log** accorde davantage d'espace aux basses fréquences. **Log (HQ)** ajoute une mesure plus longue pour mieux séparer les graves proches tout en conservant la mesure courte pour les aigus. Il demande davantage de traitement et les changements dans le grave peuvent apparaître ou disparaître plus lentement ; il ne modifie pas le son. **Linear** répartit des largeurs de fréquence égales à intervalles égaux.
- **Keyboard** - Affiche à droite du graphique un clavier statique qui met en relation les notes et les fréquences. Il ne modifie ni l'analyse ni le son. La disposition des touches suit **Log**, **Log (HQ)** ou **Linear** ; **Log (HQ)** conserve le même espacement logarithmique que **Log**, tandis qu'avec **Linear**, les touches graves paraissent plus étroites.
- L'analyseur utilise la moyenne des canaux gauche et droit. Une entrée mono est analysée directement.

## Spectrum Analyzer

Crée un affichage visuel en temps réel des fréquences de votre musique, des basses profondes aux aigus. C'est comme voir les ingrédients individuels qui composent le son complet de votre musique.

### Guide de Visualisation
- La gauche montre les basses fréquences (batterie, basse)
- Le milieu montre les fréquences principales (voix, guitares, piano)
- La droite montre les hautes fréquences (cymbales, brillance, air)
- Les pics plus hauts indiquent une présence plus forte de ces fréquences
- La ligne épaisse représente le son actuel
- La ligne fine suit les crêtes récentes et descend progressivement lorsqu’elles s’estompent
- Dans l'affichage **Bar**, chaque barre indique le niveau le plus élevé dans une partie de largeur égale de l'affichage. **Log** et **Log (HQ)** utilisent des largeurs d'octave égales ; **Linear** utilise des largeurs de fréquence égales.
- Le fin repère au-dessus d'une barre indique son pic récent et descend progressivement.
- Avec **Log (HQ)**, des sons graves proches peuvent apparaître comme des pics distincts. Leur mesure plus longue des basses fréquences peut mettre un peu plus de temps à se stabiliser ou à s'estomper.
- Observez comment différents instruments créent différents motifs

### Affichage Visuel
- Survolez le graphique, ou touchez-le et faites glisser, pour lire les valeurs à cet endroit.

### Ce Que Vous Pouvez Voir
- Drops de basse : Grands mouvements à gauche
- Mélodies vocales : Activité au milieu
- Aigus cristallins : Étincelles à droite
- Mix complet : Comment toutes les fréquences fonctionnent ensemble

### Paramètres
- **DB Range** - Sensibilité de l'affichage (-144dB à -48dB)
  - Nombres plus bas : Voir plus de détails subtils
  - Nombres plus hauts : Se concentrer sur les sons principaux
- **Points** - Finesse avec laquelle l'affichage sépare les fréquences proches (256 à 16384)
  - Nombres plus hauts : plus de détail en fréquence, avec des mises à jour plus lentes
  - Nombres plus bas : mises à jour plus rapides, avec moins de détail en fréquence
  - Avec **Log (HQ)**, Points définit la fenêtre d'analyse courte ; une fenêtre quatre fois plus longue améliore la séparation des basses fréquences.
- **Color** - **Normal** (par défaut) conserve les couleurs du graphique du thème. **Heatmap** éclaircit les niveaux élevés et **Note Colors** suit les couleurs des notes sur l’axe des fréquences. Le choix s’applique aux affichages Line et Bar. Avec **Bar** et **Note Colors**, chaque barre et son repère de crête prennent une seule couleur déterminée par la fréquence centrale de la bande.
- **Frequency Scale** - **Log** accorde davantage d'espace aux basses fréquences. **Log (HQ)** ajoute une mesure plus longue pour mieux séparer les graves proches tout en conservant la mesure courte pour les aigus. Il demande davantage de traitement et les changements dans le grave peuvent apparaître ou disparaître plus lentement ; il ne modifie pas le son. **Linear** répartit des largeurs de fréquence égales à intervalles égaux.
- **Display** - Change uniquement l'apparence du spectre ; il ne modifie ni l'analyse ni le son.
  - **Line** (par défaut) : Affiche le spectre sous forme de lignes continues.
  - **Bar** : Affiche sous forme de barre le niveau le plus élevé de chaque bande affichée.
- **Keyboard** - Affiche sous le graphique un clavier statique qui met en relation les notes et les fréquences. Il ne modifie ni l'analyse ni le son. La disposition des touches suit **Log**, **Log (HQ)** ou **Linear** ; **Log (HQ)** conserve le même espacement logarithmique que **Log**, tandis qu'avec **Linear**, les touches graves paraissent plus étroites.
- L'analyseur utilise la moyenne des canaux gauche et droit. Une entrée mono est analysée directement.

## Stereo Meter

Un outil de visualisation fascinant qui vous permet de voir comment votre musique crée une sensation d'espace à travers le son stéréo. Observez comment les différents instruments et sons se déplacent entre vos enceintes ou votre casque, ajoutant une dimension visuelle captivante à votre expérience d'écoute.

### Guide de Visualisation
- **Affichage en diamant** - La fenêtre principale où la musique prend vie :
  - Centre : moments très calmes ou moments où le signal combiné est proche de zéro
  - Haut/Bas : son commun aux canaux gauche et droit, comme un contenu centré ou proche du mono
  - Gauche/Droite : différence entre les canaux ou contenu en opposition de phase
  - Les sons beaucoup plus forts d'un côté peuvent apparaître vers les coins étiquetés
  - Les points verts dansent avec la musique actuelle
  - La ligne blanche trace les pics musicaux
  - La ligne blanche des crêtes décroît à chaque échantillon audio, de sorte que son mouvement reste identique quelle que soit la taille des blocs de traitement
- **Barre de corrélation** (côté gauche)
  - Montre la corrélation entre les canaux gauche et droit
  - Haut (+1.0) : gauche et droite sont presque identiques, ce qui sonne souvent centré
  - Milieu (0.0) : relation faible entre les canaux, souvent due à une ambiance large ou à des contenus gauche/droite sans rapport
  - Bas (-1.0) : gauche et droite sont presque en polarité opposée, ce qui peut sonner faible sur enceintes
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
- **Corrélation des canaux** : Ce qu'indique la barre de corrélation à gauche

### Paramètres
- **Window** (10-1000 ms) - Quantité d'audio récent montrée dans l'affichage
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

## Façons Amusantes d'Utiliser Ces Outils

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

N'oubliez pas : Ces outils sont conçus pour améliorer votre plaisir d'écoute en ajoutant une dimension visuelle à votre expérience musicale. Amusez-vous à explorer et à découvrir de nouvelles façons de voir votre musique préférée !
