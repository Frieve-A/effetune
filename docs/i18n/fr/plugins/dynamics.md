# Dynamics Plugins

Une collection de plugins qui aident à équilibrer les parties fortes et douces de votre musique, rendant votre expérience d'écoute plus agréable et confortable.

## Plugin List

- [Auto Leveler](#auto-leveler) - Contrôle automatique du volume pour une expérience d'écoute uniforme
- [Brickwall Limiter](#brickwall-limiter) - Contrôle transparent des crêtes pour une écoute sûre et confortable
- [Compressor](#compressor) - Équilibre automatiquement les niveaux de volume pour une écoute plus confortable (inclut l'expansion vers le haut)
- [Expander](#expander) - Expansion de plage dynamique en dessous du seuil avec contrôle de ratio et knee (inclut la compression vers le haut)
- [Gate](#gate) - Réduit les bruits de fond indésirables en atténuant les signaux sous un seuil
- [Multiband Compressor](#multiband-compressor) - Processeur de dynamique professionnel à 5 bandes avec mise en forme du son style radio FM
- [Multiband Expander](#multiband-expander) - Expanseur professionnel 5 bandes pour l'expansion de plage dynamique spécifique par fréquence
- [Multiband Transient](#multiband-transient) - Processeur avancé de mise en forme des transitoires 3 bandes pour un contrôle spécifique des attaques et sustains par fréquence
- [Power Amp Sag](#power-amp-sag) - Simule l'affaissement de tension d'amplificateur de puissance sous conditions de charge élevée
- [Transient Shaper](#transient-shaper) - Contrôle les parties d'attaque et de sustain du signal

## Auto Leveler

Un contrôle intelligent du volume qui ajuste automatiquement votre musique pour maintenir un niveau d'écoute constant. Il utilise des mesures LUFS standard de l'industrie pour garantir que votre musique reste à un volume confortable, que vous écoutiez des pièces classiques calmes ou des morceaux pop dynamiques.

### Guide d'Amélioration de l'Écoute
- **Musique Classique :**
  - Profitez des passages calmes et des crescendos puissants sans avoir à ajuster le volume.
  - Percevez tous les détails subtils des pièces pour piano.
  - Idéal pour les albums aux niveaux d'enregistrement variés.
- **Musique Pop/Rock :**
  - Maintenez un volume constant entre les morceaux.
  - Fini les surprises dues à des pistes trop fortes ou trop faibles.
  - Une écoute confortable lors de longues sessions.
- **Musique de Fond :**
  - Gardez un volume stable pendant que vous travaillez ou étudiez.
  - Ni trop fort, ni trop faible.
  - Parfait pour les playlists à contenu mixte.

### Parameters

- **Target** (-36.0dB to 0.0dB LUFS)
  - Définit le niveau d'écoute souhaité.
  - La valeur par défaut de -18.0dB LUFS convient à la majorité des musiques.
  - Des valeurs plus basses pour une écoute de fond plus discrète.
  - Des valeurs plus élevées pour un son plus percutant.

- **Time Window** (1000ms to 10000ms)
  - Indique la rapidité de mesure du niveau.
  - Des temps plus courts offrent une réponse plus réactive aux variations.
  - Des temps plus longs produisent un son plus stable et naturel.
  - La valeur par défaut de 3000ms convient à la plupart des musiques.

- **Max Gain** (0.0dB to 12.0dB)
  - Limite l'amplification des sons faibles.
  - Des valeurs plus élevées assurent un volume plus constant.
  - Des valeurs plus basses conservent une dynamique plus naturelle.
  - Commencez avec 6.0dB pour un contrôle en douceur.

- **Min Gain** (-36.0dB to 0.0dB)
  - Limite la réduction des sons forts.
  - Des valeurs plus élevées offrent un son plus naturel.
  - Des valeurs plus basses garantissent un volume plus constant.
  - Essayez -12.0dB comme point de départ.

- **Attack Time** (1ms to 1000ms)
  - Détermine la rapidité de réduction du volume.
  - Des temps plus rapides permettent un meilleur contrôle des pics soudains.
  - Des temps plus lents offrent des transitions plus naturelles.
  - La valeur par défaut de 50ms équilibre contrôle et naturel.

- **Release Time** (10ms to 10000ms)
  - Indique la rapidité de retour du volume à son niveau normal.
  - Des temps plus rapides offrent une réponse plus réactive.
  - Des temps plus lents garantissent des transitions plus fluides.
  - La valeur par défaut de 1000ms procure un son naturel.

- **Noise Gate** (-96dB to -24dB)
  - Réduit le traitement des sons très faibles.
  - Des valeurs plus élevées diminuent le bruit de fond.
  - Des valeurs plus basses traitent davantage les sons faibles.
  - Commencez à -60dB et ajustez si nécessaire.

### Visual Feedback
- Affichage en temps réel du niveau LUFS.
- Niveau d'entrée (ligne verte).
- Niveau de sortie (ligne blanche).
- Retour visuel clair des ajustements de volume.
- Graphique temporel facile à lire.

### Réglages Recommandés

#### Écoute Générale
- Target: -18.0dB LUFS
- Time Window: 3000ms
- Max Gain: 6.0dB
- Min Gain: -12.0dB
- Attack Time: 50ms
- Release Time: 1000ms
- Noise Gate: -60dB

#### Musique de Fond
- Target: -23.0dB LUFS
- Time Window: 5000ms
- Max Gain: 9.0dB
- Min Gain: -18.0dB
- Attack Time: 100ms
- Release Time: 2000ms
- Noise Gate: -54dB

#### Musique Dynamique
- Target: -16.0dB LUFS
- Time Window: 2000ms
- Max Gain: 3.0dB
- Min Gain: -6.0dB
- Attack Time: 30ms
- Release Time: 500ms
- Noise Gate: -72dB

## Brickwall Limiter

Un limiteur de crêtes de haute qualité qui garantit que votre musique ne dépasse jamais un niveau spécifié, évitant l'écrêtage numérique tout en maintenant une qualité sonore naturelle. Parfait pour protéger votre système audio et assurer des niveaux d'écoute confortables sans compromettre la dynamique de la musique.

### Guide d'Amélioration de l'Écoute
- Musique Classique :
  - Profitez en toute sécurité des crescendos orchestraux complets
  - Maintenez la dynamique naturelle des pièces de piano
  - Protégez contre les pics inattendus dans les enregistrements live
- Musique Pop/Rock :
  - Maintenez un volume constant pendant les passages intenses
  - Profitez de la musique dynamique à n'importe quel niveau d'écoute
  - Prévenez la distorsion dans les sections riches en basses
- Musique Électronique :
  - Contrôlez les pics de synthétiseur de manière transparente
  - Maintenez l'impact tout en évitant la surcharge
  - Gardez les drops de basse puissants mais contrôlés

### Paramètres
- **Input Gain** (-18dB à +18dB)
  - Ajuste le niveau entrant dans le limiteur
  - Augmentez pour pousser davantage le limiteur
  - Diminuez si vous entendez trop de limitation
  - Valeur par défaut 0dB

- **Threshold** (-24dB à 0dB)
  - Définit le niveau maximal des crêtes
  - Valeurs plus basses offrent plus de marge de sécurité
  - Valeurs plus hautes préservent plus de dynamique
  - Commencez à -3dB pour une protection douce

- **Release Time** (10ms à 500ms)
  - Rapidité de relâchement de la limitation
  - Temps plus rapides maintiennent plus de dynamique
  - Temps plus lents pour un son plus doux
  - Essayez 100ms comme point de départ

- **Lookahead** (0ms à 10ms)
  - Permet au limiteur d'anticiper les crêtes
  - Valeurs plus hautes pour une limitation plus transparente
  - Valeurs plus basses pour moins de latence
  - 3ms est un bon compromis

- **Margin** (-1.000dB à 0.000dB)
  - Ajustement fin du seuil effectif
  - Fournit une marge de sécurité supplémentaire
  - Valeur par défaut -1.000dB convient à la plupart des matériaux
  - Ajustez pour un contrôle précis des crêtes

- **Oversampling** (1x, 2x, 4x, 8x)
  - Valeurs plus hautes pour une limitation plus propre
  - Valeurs plus basses pour moins d'utilisation CPU
  - 4x est un bon compromis entre qualité et performance

### Affichage Visuel
- Mesure de réduction de gain en temps réel
- Indication claire du niveau de seuil
- Ajustement interactif des paramètres
- Surveillance du niveau des crêtes

### Réglages Recommandés

#### Protection Transparente
- Input Gain : 0dB
- Threshold : -3dB
- Release : 100ms
- Lookahead : 3ms
- Margin : -1.000dB
- Oversampling : 4x

#### Sécurité Maximale
- Input Gain : -6dB
- Threshold : -6dB
- Release : 50ms
- Lookahead : 5ms
- Margin : -1.000dB
- Oversampling : 8x

#### Dynamique Naturelle
- Input Gain : 0dB
- Threshold : -1.5dB
- Release : 200ms
- Lookahead : 2ms
- Margin : -0.500dB
- Oversampling : 4x

## Compressor

Un effet qui gère automatiquement les différences de volume dans votre musique en réduisant doucement les sons forts et en améliorant les sons faibles. Cela crée une expérience d'écoute plus équilibrée et agréable en lissant les changements de volume soudains qui pourraient être dérangeants ou inconfortables.

### Guide d'Amélioration de l'Écoute
- Musique Classique :
  - Rend les crescendos orchestraux dramatiques plus confortables à écouter
  - Équilibre la différence entre les passages piano doux et forts
  - Aide à entendre les détails subtils même dans les sections puissantes
- Musique Pop/Rock :
  - Crée une expérience d'écoute plus confortable pendant les sections intenses
  - Rend les voix plus claires et plus faciles à comprendre
  - Réduit la fatigue auditive pendant les longues sessions
- Musique Jazz :
  - Équilibre le volume entre les différents instruments
  - Fait se fondre plus naturellement les sections solo avec l'ensemble
  - Maintient la clarté pendant les passages doux et forts

### Parameters

- **Threshold** - Définit le niveau de volume où l'effet commence à agir (-60dB à 0dB)
  - Réglages plus élevés : N'affecte que les parties les plus fortes de la musique
  - Réglages plus bas : Crée plus d'équilibre global
  - Commencez à -24dB pour un équilibrage doux
- **Ratio** - Contrôle l'intensité de l'équilibrage du volume (1:0.5 à 1:20)
  - 1:0.5 : Expansion vers le haut (amplifie les sons forts)
  - 1:1 : Pas d'effet (son original)
  - 1:2 : Compression douce
  - 1:4 : Compression modérée
  - 1:8+ : Contrôle du volume fort
- **Attack Time** - Rapidité de réaction de l'effet aux sons forts (0.1ms à 100ms)
  - Temps plus rapides : Contrôle du volume plus immédiat
  - Temps plus lents : Son plus naturel
  - Essayez 20ms comme point de départ
- **Release Time** - Rapidité de retour du volume à la normale (10ms à 1000ms)
  - Temps plus rapides : Son plus dynamique
  - Temps plus lents : Transitions plus douces et naturelles
  - Commencez avec 200ms pour l'écoute générale
- **Knee** - Douceur de la transition de l'effet (0dB à 12dB)
  - Valeurs plus basses : Contrôle plus précis
  - Valeurs plus hautes : Son plus doux et naturel
  - 6dB est un bon point de départ
- **Gain** - Ajuste le volume global après traitement (-12dB à +12dB)
  - Utilisez-le pour faire correspondre le volume avec le son original
  - Augmentez si la musique semble trop douce
  - Diminuez si elle est trop forte

### Affichage Visuel

- Graphique interactif montrant le fonctionnement de l'effet
- Indicateurs de niveau de volume faciles à lire
- Retour visuel pour tous les ajustements de paramètres
- Lignes de référence pour guider vos réglages

### Réglages Recommandés pour Différents Scénarios d'Écoute
- Écoute de Fond Décontractée :
  - Threshold : -24dB
  - Ratio : 1:2
  - Attack : 20ms
  - Release : 200ms
  - Knee : 6dB
- Sessions d'Écoute Critique :
  - Threshold : -18dB
  - Ratio : 1:1.5
  - Attack : 30ms
  - Release : 300ms
  - Knee : 3dB
- Écoute Nocturne :
  - Threshold : -30dB
  - Ratio : 1:4
  - Attack : 10ms
  - Release : 150ms
  - Knee : 9dB
- Amélioration des Sons Forts :
  - Threshold : -12dB
  - Ratio : 1:0.5
  - Attack : 5ms
  - Release : 100ms
  - Knee : 0dB

## Expander

Un processeur de plage dynamique qui étend la plage dynamique des signaux en dessous d'un seuil, rendant les sons doux encore plus doux tout en laissant les sons forts inchangés. Cela crée des dynamiques plus dramatiques et peut aider à restaurer les dynamiques naturelles du matériel sur-comprimé.

### Guide d'Amélioration de l'Écoute
- Musique Classique :
  - Restaure les dynamiques naturelles des enregistrements sur-comprimés
  - Améliore le contraste entre les passages doux et les crescendos forts
  - Restaure le flux naturel des performances orchestrales
- Musique Pop/Rock :
  - Ajoute plus de punch et d'impact aux sections dynamiques
  - Crée un contraste plus dramatique entre les couplets et les refrains
  - Restaure les dynamiques naturelles des pistes fortement comprimées
- Musique Jazz :
  - Améliore les dynamiques naturelles entre les instruments
  - Rend les solos doux plus intimes et les sections fortes plus puissantes
  - Restaure la respiration naturelle des performances de jazz

### Paramètres

- **Threshold** - Définit le niveau de volume où commence l'expansion (-60dB à 0dB)
  - Réglages plus élevés : N'affecte que les parties plus douces de la musique
  - Réglages plus bas : Crée plus d'expansion dynamique globale
  - Commencez à -24dB pour une expansion douce
- **Ratio** - Contrôle l'intensité avec laquelle l'effet étend la plage dynamique (1:0.05 à 1:20)
  - 1:0.5 : Compression vers le haut (amplifie les sons doux)
  - 1:1 : Pas d'effet (son original)
  - 1:2 : Expansion douce
  - 1:4 : Expansion modérée
  - 1:8+ : Expansion dynamique forte
- **Attack Time** - Rapidité de réaction de l'effet aux sons doux (0.1ms à 100ms)
  - Temps plus rapides : Contrôle dynamique plus immédiat
  - Temps plus lents : Son plus naturel
  - Essayez 10ms comme point de départ
- **Release Time** - Rapidité de retour des dynamiques à la normale (10ms à 1000ms)
  - Temps plus rapides : Son plus dynamique
  - Temps plus lents : Transitions plus douces et naturelles
  - Commencez avec 100ms pour l'écoute générale
- **Knee** - Douceur de la transition de l'effet (0dB à 12dB)
  - Valeurs plus basses : Contrôle plus précis
  - Valeurs plus élevées : Son plus doux et naturel
  - 3dB est un bon point de départ
- **Gain** - Ajuste le volume global après traitement (-12dB à +12dB)
  - Utilisez pour faire correspondre le volume avec le son original
  - Augmentez si la musique semble trop douce
  - Diminuez si elle est trop forte

### Affichage Visuel

- Graphique interactif montrant comment fonctionne l'expansion
- Indicateurs de niveau de volume faciles à lire
- Retour visuel pour tous les ajustements de paramètres
- Lignes de référence pour guider vos réglages

### Réglages Recommandés pour Différents Scénarios d'Écoute
- Restauration de Dynamiques Naturelles :
  - Threshold : -18dB
  - Ratio : 1:2
  - Attack : 10ms
  - Release : 100ms
  - Knee : 3dB
- Amélioration Dynamique Dramatique :
  - Threshold : -12dB
  - Ratio : 1:4
  - Attack : 5ms
  - Release : 50ms
  - Knee : 1dB
- Amélioration des Sons Doux :
  - Threshold : -30dB
  - Ratio : 1:0.5
  - Attack : 20ms
  - Release : 200ms
  - Knee : 6dB
- Amélioration Dynamique Subtile :
  - Threshold : -24dB
  - Ratio : 1:1.5
  - Attack : 15ms
  - Release : 150ms
  - Knee : 6dB

## Gate

Une porte de bruit qui aide à réduire les bruits de fond indésirables en atténuant automatiquement les signaux qui tombent sous un seuil spécifié. Ce plugin est particulièrement utile pour nettoyer les sources audio avec un bruit de fond constant, comme le bruit de ventilateur, le bourdonnement ou le bruit ambiant de la pièce.

### Caractéristiques Principales
- Contrôle précis du seuil pour une détection précise du bruit
- Ratio ajustable pour une réduction du bruit naturelle ou agressive
- Temps d'attaque et de relâchement variables pour un contrôle optimal du timing
- Option de knee douce pour des transitions fluides
- Mesure de réduction de gain en temps réel
- Affichage interactif de la fonction de transfert

### Parameters

- **Threshold** (-96dB à 0dB)
  - Définit le niveau où commence la réduction du bruit
  - Les signaux sous ce niveau seront atténués
  - Valeurs plus hautes : Réduction du bruit plus agressive
  - Valeurs plus basses : Effet plus subtil
  - Commencez à -40dB et ajustez selon votre niveau de bruit de fond

- **Ratio** (1:1 à 100:1)
  - Contrôle l'intensité de l'atténuation des signaux sous le seuil
  - 1:1 : Pas d'effet
  - 10:1 : Forte réduction du bruit
  - 100:1 : Silence presque complet sous le seuil
  - Commencez à 10:1 pour une réduction du bruit typique

- **Attack Time** (0.01ms à 50ms)
  - Rapidité de réaction de la porte quand le signal dépasse le seuil
  - Temps plus rapides : Plus précis mais peut sembler brusque
  - Temps plus lents : Transitions plus naturelles
  - Essayez 1ms comme point de départ

- **Release Time** (10ms à 2000ms)
  - Rapidité de fermeture de la porte quand le signal passe sous le seuil
  - Temps plus rapides : Contrôle du bruit plus serré
  - Temps plus lents : Déclin plus naturel
  - Commencez avec 200ms pour un son naturel

- **Knee** (0dB à 6dB)
  - Contrôle la progressivité de la transition de la porte autour du seuil
  - 0dB : Knee dure pour un gating précis
  - 6dB : Knee douce pour des transitions plus fluides
  - Utilisez 1dB pour une réduction du bruit générale

- **Gain** (-12dB à +12dB)
  - Ajuste le niveau de sortie après le gating
  - Utilisez pour compenser toute perte de volume perçue
  - Typiquement laissé à 0dB sauf si nécessaire

### Retour Visuel
- Graphique de fonction de transfert interactif montrant :
  - Relation entrée/sortie
  - Point de seuil
  - Courbe de knee
  - Pente du ratio
- Vumètre de réduction de gain en temps réel affichant :
  - Quantité actuelle de réduction du bruit
  - Retour visuel de l'activité de la porte

### Réglages Recommandés

#### Réduction Légère du Bruit
- Threshold : -50dB
- Ratio : 2:1
- Attack : 5ms
- Release : 300ms
- Knee : 3dB
- Gain : 0dB

#### Bruit de Fond Modéré
- Threshold : -40dB
- Ratio : 10:1
- Attack : 1ms
- Release : 200ms
- Knee : 1dB
- Gain : 0dB

#### Suppression de Bruit Intense
- Threshold : -30dB
- Ratio : 50:1
- Attack : 0.1ms
- Release : 100ms
- Knee : 0dB
- Gain : 0dB

### Conseils d'Application
- Réglez le seuil juste au-dessus du bruit de fond pour des résultats optimaux
- Utilisez des temps de relâchement plus longs pour un son plus naturel
- Ajoutez de la knee lors du traitement de matériel complexe
- Surveillez le vumètre de réduction de gain pour assurer un gating approprié
- Combinez avec d'autres processeurs de dynamique pour un contrôle complet


## Multiband Compressor

Un processeur de dynamique professionnel qui divise votre audio en cinq bandes de fréquences et traite chacune indépendamment. Ce plugin est particulièrement efficace pour créer ce son "radio FM" poli, où chaque partie du spectre de fréquences est parfaitement contrôlée et équilibrée.

### Caractéristiques Principales
- Traitement 5 bandes avec fréquences de crossover ajustables
- Contrôles de compression indépendants pour chaque bande
- Réglages par défaut optimisés pour un son style radio FM
- Visualisation en temps réel de la réduction de gain par bande
- Filtres de crossover Linkwitz-Riley de haute qualité

### Bandes de Fréquences
- Bande 1 (Basse) : Sous 100 Hz
  - Contrôle les basses profondes et les sous-fréquences
  - Ratio plus élevé et relâchement plus long pour des basses serrées et contrôlées
- Bande 2 (Bas-médium) : 100-500 Hz
  - Gère les basses supérieures et le bas-médium
  - Compression modérée pour maintenir la chaleur
- Bande 3 (Médium) : 500-2000 Hz
  - Gamme critique de présence vocale et instrumentale
  - Compression douce pour préserver le naturel
- Bande 4 (Haut-médium) : 2000-8000 Hz
  - Contrôle la présence et l'air
  - Compression légère avec réponse plus rapide
- Bande 5 (Aigu) : Au-dessus de 8000 Hz
  - Gère la brillance et l'éclat
  - Temps de réponse rapides avec ratio plus élevé

### Parameters (Par Bande)
- **Threshold** (-60dB à 0dB)
  - Définit le niveau où commence la compression
  - Réglages plus bas créent des niveaux plus constants
- **Ratio** (1:1 à 20:1)
  - Contrôle la quantité de réduction de gain
  - Ratios plus élevés pour un contrôle plus agressif
- **Attack** (0.1ms à 100ms)
  - Rapidité de réponse de la compression
  - Temps plus rapides pour le contrôle des transitoires
- **Release** (10ms à 1000ms)
  - Rapidité de retour du gain à la normale
  - Temps plus longs pour un son plus doux
- **Knee** (0dB à 12dB)
  - Douceur de l'apparition de la compression
  - Valeurs plus élevées pour une transition plus naturelle
- **Gain** (-12dB à +12dB)
  - Ajustement du niveau de sortie par bande
  - Affinez l'équilibre des fréquences

### Traitement Style Radio FM
Le Multiband Compressor est livré avec des réglages par défaut optimisés qui recréent le son poli et professionnel de la radiodiffusion FM :

- Bande Basse (< 100 Hz)
  - Ratio plus élevé (4:1) pour un contrôle serré des basses
  - Attaque/relâchement plus lents pour maintenir le punch
  - Légère réduction pour éviter la boue sonore

- Bande Bas-médium (100-500 Hz)
  - Compression modérée (3:1)
  - Timing équilibré pour une réponse naturelle
  - Gain neutre pour maintenir la chaleur

- Bande Médium (500-2000 Hz)
  - Compression douce (2.5:1)
  - Temps de réponse rapides
  - Léger boost pour la présence vocale

- Bande Haut-médium (2000-8000 Hz)
  - Compression légère (2:1)
  - Attaque/relâchement rapides
  - Boost de présence amélioré

- Bande Haute (> 8000 Hz)
  - Ratio plus élevé (5:1) pour une brillance constante
  - Temps de réponse très rapides
  - Réduction contrôlée pour le poli

Cette configuration crée le son caractéristique "prêt pour la radio" :
- Basses constantes et impactantes
- Voix claires et en avant
- Dynamique contrôlée sur toutes les fréquences
- Poli et brillance professionnels
- Présence et clarté améliorées
- Fatigue d'écoute réduite

### Retour Visuel
- Graphiques de fonction de transfert interactifs pour chaque bande
- Vumètres de réduction de gain en temps réel
- Visualisation de l'activité des bandes de fréquences
- Indicateurs clairs des points de crossover

### Conseils d'Utilisation
- Commencez avec le preset radio FM par défaut
- Ajustez les fréquences de crossover selon votre matériel
- Affinez le seuil de chaque bande pour le niveau de contrôle souhaité
- Utilisez les contrôles de gain pour façonner l'équilibre final des fréquences
- Surveillez les vumètres de réduction de gain pour assurer un traitement approprié

## Multiband Expander

Un processeur de dynamique de qualité professionnelle qui divise votre audio en cinq bandes de fréquences et applique une expansion indépendante à chacune. Ce plugin est conçu pour étendre la plage dynamique de plages de fréquences spécifiques, rendant les sons doux plus doux tout en maintenant les sons forts inchangés. Il est particulièrement efficace pour restaurer la dynamique naturelle des enregistrements sur-compressés du mastering moderne ou créer un contraste dynamique plus dramatique spécifique par fréquence.

### Caractéristiques Principales
- Traitement 5 bandes avec fréquences de crossover ajustables
- Contrôles d'expansion indépendants pour chaque bande
- Paramètres par défaut optimisés suivant la distribution d'énergie 1/f
- Visualisation en temps réel du boost de gain par bande
- Filtres de crossover Linkwitz-Riley haute qualité

### Guide d'Amélioration de l'Écoute
- **Musique Pop/Rock :**
  - Réduire l'effet "mur de son" du mastering sur-compressé
  - Restaurer le contraste dynamique entre les couplets et les refrains
  - Améliorer l'impression plate des sources audio en streaming
- **Musique Classique :**
  - Restaurer le flux et reflux dynamique naturel des enregistrements
  - Améliorer le contraste entre les passages doux et les crescendos forts
  - Retrouver l'expression vivante des performances orchestrales
- **Musique Jazz :**
  - Améliorer la dynamique naturelle entre les instruments
  - Rendre les solos doux plus intimes et les sections fortes plus puissantes
  - Restaurer la respiration naturelle des performances jazz

### Bandes de Fréquences
- Bande 1 (Grave) : En dessous de 100 Hz
  - Contrôle les basses profondes et les sous-fréquences
  - Expansion douce avec attaque/release plus long pour une dynamique de basses naturelle
- Bande 2 (Grave-Médium) : 100-500 Hz
  - Gère les basses supérieures et les médiums inférieurs
  - Expansion modérée pour restaurer la chaleur et le corps
- Bande 3 (Médium) : 500-2000 Hz
  - Plage critique de présence vocale et instrumentale
  - Expansion équilibrée pour préserver le naturel
- Bande 4 (Médium-Aigu) : 2000-8000 Hz
  - Contrôle la présence et l'air
  - Expansion légère avec réponse plus rapide
- Bande 5 (Aigu) : Au-dessus de 8000 Hz
  - Gère la brillance et l'éclat
  - Temps de réponse rapides avec expansion plus douce

### Paramètres (Par Bande)
- **Threshold** (-60dB à 0dB)
  - Définit le niveau où l'expansion commence
  - Les signaux en dessous de ce niveau seront étendus (rendus plus doux)
- **Ratio** (1:0.05 à 1:20)
  - Contrôle la quantité d'expansion appliquée
  - Ratios plus élevés pour une expansion de plage dynamique plus dramatique
- **Attack** (0.1ms à 100ms)
  - Vitesse de réponse de l'expansion
  - Temps plus rapides pour un contrôle précis des transitoires
- **Release** (10ms à 1000ms)
  - Vitesse de retour du gain à la normale
  - Temps plus longs pour un son plus doux et naturel
- **Knee** (0dB à 12dB)
  - Douceur du début de l'expansion
  - Valeurs plus élevées pour une transition plus naturelle
- **Gain** (-12dB à +12dB)
  - Ajustement du niveau de sortie par bande
  - Affinage de l'équilibre fréquentiel

### Restauration de Plage Dynamique
Multiband Expander est livré avec des paramètres par défaut optimisés qui suivent la distribution naturelle d'énergie 1/f pour restaurer la dynamique du matériel sur-compressé :

- Bande Grave (< 100 Hz)
  - Expansion douce (1.2:1) pour une dynamique de basses contrôlée
  - Attaque/release plus long pour maintenir le punch
  - Seuil défini pour accommoder l'énergie typique des basses

- Bande Grave-Médium (100-500 Hz)
  - Expansion modérée (1.2:1)
  - Timing équilibré pour une réponse naturelle
  - Seuil suivant le rolloff d'énergie de -6dB

- Bande Médium (500-2000 Hz)
  - Expansion équilibrée (1.2:1)
  - Temps de réponse moyens
  - Optimisée pour la dynamique vocale et instrumentale

- Bande Médium-Aigu (2000-8000 Hz)
  - Expansion légère (1.2:1)
  - Attaque/release plus rapide
  - Restauration naturelle de la présence

- Bande Aigu (> 8000 Hz)
  - Expansion la plus douce (1.1:1)
  - Temps de réponse très rapides
  - Amélioration subtile de l'air et de la brillance

Cette configuration crée une restauration dynamique au son naturel :
- Dynamique naturelle restaurée sur toutes les fréquences
- Contraste amélioré entre les passages doux et forts
- Contrôle spécifique par fréquence pour des résultats optimaux
- Expansion naturelle et musicale sans artefacts
- Clarté et séparation améliorées
- Planéité réduite dans les enregistrements sur-compressés

### Retour Visuel
- Graphiques de fonction de transfert interactifs pour chaque bande
- Vumètres de boost de gain en temps réel montrant l'activité d'expansion
- Visualisation de l'activité des bandes de fréquences
- Indicateurs clairs des points de crossover

### Conseils d'Utilisation
- Commencez avec les paramètres par défaut pour la restauration dynamique générale
- Ajustez les fréquences de crossover selon votre matériel
- Affinez le seuil de chaque bande selon le contenu fréquentiel
- Utilisez les contrôles de gain pour compenser les changements de volume perçus
- Surveillez les vumètres de boost de gain pour assurer une expansion appropriée

## Multiband Transient

Un processeur avancé de mise en forme des transitoires qui divise votre audio en trois bandes de fréquences (Grave, Médium, Aigu) et applique une mise en forme indépendante des transitoires à chaque bande. Cet outil sophistiqué vous permet d'améliorer ou de réduire simultanément les caractéristiques d'attaque et de sustain de différentes plages de fréquences, offrant un contrôle précis sur le punch, la clarté et le corps de votre musique.

### Guide d'Amélioration de l'Écoute
- **Musique Classique :**
  - Améliorer l'attaque des sections de cordes pour une meilleure clarté tout en contrôlant la réverbération de salle dans les basses fréquences
  - Façonner les transitoires de piano différemment à travers le spectre fréquentiel pour un son plus équilibré
  - Contrôler indépendamment le punch des timbales (grave) et des cymbales (aigu) pour un équilibre orchestral optimal

- **Musique Rock/Pop :**
  - Ajouter du punch à la grosse caisse (bande grave) tout en améliorant la présence de la caisse claire (bande médium)
  - Contrôler l'attaque de la basse guitare séparément de la clarté vocale
  - Façonner les attaques de médiator guitare dans les hautes fréquences sans affecter la réponse des basses

- **Musique Électronique :**
  - Façonner indépendamment les drops de basse et les synthétiseurs leads
  - Contrôler le punch des sub-bass tout en maintenant la clarté dans les hautes fréquences
  - Ajouter de la définition aux éléments individuels à travers le spectre fréquentiel

### Bandes de Fréquences

Le processeur Multiband Transient divise votre audio en trois bandes de fréquences soigneusement conçues :

- **Low Band** (En dessous de Freq 1)
  - Contrôle les fréquences graves et sub-graves
  - Idéal pour façonner les grosses caisses, instruments de basse et éléments basse fréquence
  - Fréquence de coupure par défaut : 200 Hz

- **Mid Band** (Entre Freq 1 et Freq 2)
  - Gère les fréquences médium critiques
  - Contient la plupart de la présence vocale et instrumentale
  - Fréquence de coupure par défaut : 200 Hz à 4000 Hz

- **High Band** (Au-dessus de Freq 2)
  - Gère les fréquences aiguës et l'air
  - Contrôle les cymbales, attaques de guitare et brillance
  - Fréquence de coupure par défaut : Au-dessus de 4000 Hz

### Paramètres

#### Fréquences de Coupure
- **Freq 1** (20Hz à 2000Hz)
  - Définit le point de coupure Grave/Médium
  - Valeurs plus basses : Plus de contenu dans les bandes médium et aigu
  - Valeurs plus hautes : Plus de contenu dans la bande grave
  - Par défaut : 200Hz

- **Freq 2** (200Hz à 20000Hz)
  - Définit le point de coupure Médium/Aigu
  - Valeurs plus basses : Plus de contenu dans la bande aigu
  - Valeurs plus hautes : Plus de contenu dans la bande médium
  - Par défaut : 4000Hz

#### Contrôles par Bande (Low, Mid, High)
Chaque bande de fréquence a des contrôles indépendants de mise en forme des transitoires :

- **Fast Attack** (0.1ms à 10.0ms)
  - Rapidité de réponse de l'enveloppe rapide aux transitoires
  - Valeurs plus basses : Détection plus précise des transitoires
  - Valeurs plus hautes : Réponse transitoire plus douce
  - Plage typique : 0.5ms à 5.0ms

- **Fast Release** (1ms à 200ms)
  - Rapidité de remise à zéro de l'enveloppe rapide
  - Valeurs plus basses : Contrôle plus strict des transitoires
  - Valeurs plus hautes : Décroissance transitoire plus naturelle
  - Plage typique : 20ms à 50ms

- **Slow Attack** (1ms à 100ms)
  - Contrôle le temps de réponse de l'enveloppe lente
  - Valeurs plus basses : Meilleure séparation transitoire vs sustain
  - Valeurs plus hautes : Détection plus graduelle du sustain
  - Plage typique : 10ms à 50ms

- **Slow Release** (50ms à 1000ms)
  - Durée de suivi de la partie sustain
  - Valeurs plus basses : Détection de sustain plus courte
  - Valeurs plus hautes : Suivi de queue de sustain plus long
  - Plage typique : 150ms à 500ms

- **Transient Gain** (-24dB à +24dB)
  - Améliore ou réduit la partie attaque
  - Valeurs positives : Plus de punch et de définition
  - Valeurs négatives : Attaques plus douces, moins agressives
  - Plage typique : 0dB à +12dB

- **Sustain Gain** (-24dB à +24dB)
  - Améliore ou réduit la partie sustain
  - Valeurs positives : Plus de corps et de résonance
  - Valeurs négatives : Son plus serré, plus contrôlé
  - Plage typique : -6dB à +6dB

- **Smoothing** (0.1ms à 20.0ms)
  - Contrôle la douceur d'application des changements de gain
  - Valeurs plus basses : Façonnage plus précis
  - Valeurs plus hautes : Traitement plus naturel, transparent
  - Plage typique : 3ms à 8ms

### Retour Visuel
- Trois graphiques de visualisation de gain indépendants (un par bande)
- Affichage de l'historique de gain en temps réel pour chaque bande de fréquence
- Marqueurs temporels de référence
- Sélection interactive des bandes
- Retour visuel clair de l'activité de mise en forme des transitoires

### Réglages Recommandés

#### Amélioration de Batterie
- **Low Band (Grosse Caisse) :**
  - Fast Attack: 2.0ms, Fast Release: 50ms
  - Slow Attack: 25ms, Slow Release: 250ms
  - Transient Gain: +6dB, Sustain Gain: -3dB
  - Smoothing: 5.0ms

- **Mid Band (Caisse Claire/Voix) :**
  - Fast Attack: 1.0ms, Fast Release: 30ms
  - Slow Attack: 15ms, Slow Release: 150ms
  - Transient Gain: +9dB, Sustain Gain: 0dB
  - Smoothing: 3.0ms

- **High Band (Cymbales/Hi-hat) :**
  - Fast Attack: 0.5ms, Fast Release: 20ms
  - Slow Attack: 10ms, Slow Release: 100ms
  - Transient Gain: +3dB, Sustain Gain: -6dB
  - Smoothing: 2.0ms

#### Mix Complet Équilibré
- **Toutes les Bandes :**
  - Fast Attack: 2.0ms, Fast Release: 30ms
  - Slow Attack: 20ms, Slow Release: 200ms
  - Transient Gain: +3dB, Sustain Gain: 0dB
  - Smoothing: 5.0ms

#### Amélioration Acoustique Naturelle
- **Low Band :**
  - Fast Attack: 5.0ms, Fast Release: 50ms
  - Slow Attack: 30ms, Slow Release: 400ms
  - Transient Gain: +2dB, Sustain Gain: +1dB
  - Smoothing: 8.0ms

- **Mid Band :**
  - Fast Attack: 3.0ms, Fast Release: 35ms
  - Slow Attack: 25ms, Slow Release: 300ms
  - Transient Gain: +4dB, Sustain Gain: +1dB
  - Smoothing: 6.0ms

- **High Band :**
  - Fast Attack: 1.5ms, Fast Release: 25ms
  - Slow Attack: 15ms, Slow Release: 200ms
  - Transient Gain: +3dB, Sustain Gain: -2dB
  - Smoothing: 4.0ms

### Conseils d'Application
- Commencer avec des réglages modérés et ajuster chaque bande indépendamment
- Utiliser le retour visuel pour surveiller la quantité de mise en forme des transitoires appliquée
- Considérer le contenu musical lors du réglage des fréquences de coupure
- Les bandes de hautes fréquences bénéficient généralement de temps d'attaque plus rapides
- Les bandes de basses fréquences nécessitent souvent des temps de release plus longs pour un son naturel
- Combiner avec d'autres processeurs de dynamique pour un contrôle compréhensif

## Power Amp Sag

Simule le comportement d'affaissement de tension des amplificateurs de puissance sous des conditions de charge élevée. Cet effet recrée la compression naturelle et la chaleur qui se produisent lorsque l'alimentation d'un amplificateur est sollicitée par des passages musicaux exigeants, ajoutant du punch et du caractère musical à votre audio.

### Guide d'Amélioration de l'Écoute
- Systèmes Audio Vintage :
  - Recrée le caractère d'amplificateur classique avec compression naturelle
  - Ajoute la chaleur et la richesse des équipements hi-fi vintage
  - Parfait pour obtenir un son analogique authentique
- Musique Rock/Pop :
  - Améliore le punch et la présence pendant les passages puissants
  - Ajoute une compression naturelle sans dureté
  - Crée une sensation satisfaisante de "drive" d'amplificateur
- Musique Classique :
  - Fournit une dynamique naturelle aux crescendos orchestraux
  - Ajoute la chaleur d'amplificateur aux sections de cordes et de cuivres
  - Améliore le réalisme des performances amplifiées
- Musique Jazz :
  - Recrée le comportement de compression d'amplificateur classique
  - Ajoute chaleur et caractère aux instruments solo
  - Maintient le flux dynamique naturel

### Paramètres

- **Sensitivity** (-18.0dB à +18.0dB)
  - Contrôle la sensibilité de l'effet de sag aux niveaux d'entrée
  - Valeurs plus élevées : Plus de sag à volumes faibles
  - Valeurs plus basses : N'affecte que les signaux forts
  - Commencer avec 0dB pour une réponse naturelle

- **Stability** (0% à 100%)
  - Simule la taille de capacité de l'alimentation
  - Valeurs plus basses : Condensateurs plus petits (sag plus dramatique)
  - Valeurs plus élevées : Condensateurs plus gros (tension plus stable)
  - Représente physiquement la capacité de stockage d'énergie de l'alimentation
  - 50% fournit un caractère équilibré

- **Recovery Speed** (0% à 100%)
  - Contrôle la capacité de recharge de l'alimentation
  - Valeurs plus basses : Taux de recharge plus lent (compression soutenue)
  - Valeurs plus élevées : Taux de recharge plus rapide (récupération plus rapide)
  - Représente physiquement la capacité de livraison de courant du circuit de charge
  - 40% fournit un comportement naturel

- **Monoblock** (Case à cocher)
  - Active le traitement indépendant par canal
  - Décoché : Alimentation partagée (amplificateur stéréo)
  - Coché : Alimentations indépendantes (configuration monoblock)
  - Utiliser pour une meilleure séparation des canaux et imagerie

### Affichage Visuel

- Graphiques en temps réel doubles montrant l'enveloppe d'entrée et la réduction de gain
- Enveloppe d'entrée (vert) : Énergie du signal pilotant l'effet
- Réduction de gain (blanc) : Quantité de sag de tension appliqué
- Affichage temporel avec marqueurs de référence d'une seconde
- Valeurs actuelles affichées en temps réel

### Réglages Recommandés

#### Caractère Vintage
- Sensitivity: +3.0dB
- Stability: 30% (condensateurs plus petits)
- Recovery Speed: 25% (recharge plus lente)
- Monoblock: Décoché

#### Amélioration Hi-Fi Moderne
- Sensitivity: 0.0dB
- Stability: 70% (condensateurs plus gros)
- Recovery Speed: 60% (recharge plus rapide)
- Monoblock: Coché

#### Rock/Pop Dynamique
- Sensitivity: +6.0dB
- Stability: 40% (condensateurs modérés)
- Recovery Speed: 50% (recharge modérée)
- Monoblock: Décoché

## Transient Shaper

Un processeur de dynamique spécialisé qui vous permet d'améliorer ou de réduire indépendamment les parties d'attaque et de sustain de votre audio. Cet outil puissant vous donne un contrôle précis sur le punch et le corps de votre musique, vous permettant de remodeler le caractère des sons sans affecter leur niveau global.

### Listening Enhancement Guide
- Percussion :
  - Ajoutez du punch et de la définition aux batteries en améliorant les transitoires
  - Réduisez la résonance de la pièce en maîtrisant la portion de sustain
  - Créez des sons de batterie plus impactants sans augmenter le volume
- Guitare Acoustique :
  - Améliorez les attaques de médiator pour plus de clarté et de présence
  - Contrôlez le sustain pour trouver l'équilibre parfait avec les autres instruments
  - Façonnez les motifs de strumming pour mieux s'intégrer dans le mixage
- Musique Électronique :
  - Accentuez les attaques de synthétiseur pour une sensation plus percussive
  - Contrôlez le sustain des sons de basse pour des mixages plus serrés
  - Ajoutez du punch aux batteries électroniques sans changer leur timbre

### Parameters

- **Fast Attack** (0.1ms à 10.0ms)
  - Contrôle la rapidité de réponse du suiveur d'enveloppe rapide
  - Valeurs plus basses : Plus réactif aux transitoires nettes
  - Valeurs plus hautes : Détection de transitoires plus douce
  - Commencez avec 1.0ms pour la plupart des matériaux

- **Fast Release** (1ms à 200ms)
  - Rapidité de réinitialisation du suiveur d'enveloppe rapide
  - Valeurs plus basses : Suivi des transitoires plus précis
  - Valeurs plus hautes : Façonnage des transitoires plus naturel
  - 20ms fonctionne bien comme point de départ

- **Slow Attack** (1ms à 100ms)
  - Contrôle la rapidité de réponse du suiveur d'enveloppe lent
  - Valeurs plus basses : Séparation plus prononcée entre transitoires et sustain
  - Valeurs plus hautes : Détection plus naturelle de la portion de sustain
  - 20ms est un bon réglage par défaut

- **Slow Release** (50ms à 1000ms)
  - Rapidité avec laquelle l'enveloppe lente revient à l'état de repos
  - Valeurs plus basses : Portion de sustain plus courte
  - Valeurs plus hautes : Détection de queues de sustain plus longues
  - Essayez 300ms comme point de départ

- **Transient Gain** (-24dB à +24dB)
  - Augmente ou supprime la partie d'attaque du son
  - Valeurs positives : Accentue le punch et la clarté
  - Valeurs négatives : Crée un son plus doux et moins agressif
  - Commencez avec +6dB pour accentuer les transitoires

- **Sustain Gain** (-24dB à +24dB)
  - Augmente ou supprime la partie de sustain du son
  - Valeurs positives : Ajoute plus de richesse et de corps
  - Valeurs négatives : Crée un son plus serré et contrôlé
  - Commencez à 0dB et ajustez selon vos goûts

- **Smoothing** (0.1ms à 20.0ms)
  - Contrôle la douceur des changements de gain
  - Valeurs plus basses : Façonnage plus précis mais potentiellement plus agressif
  - Valeurs plus hautes : Traitement plus naturel et transparent
  - 5.0ms offre un bon équilibre pour la plupart des matériaux

### Visual Feedback
- Visualisation du gain en temps réel
- Affichage clair de l'historique de gain
- Marqueurs temporels pour référence
- Interface intuitive pour tous les paramètres

### Recommended Settings

#### Percussion Améliorée
- Fast Attack : 0.5ms
- Fast Release : 10ms
- Slow Attack : 15ms
- Slow Release : 200ms
- Transient Gain : +9dB
- Sustain Gain : -3dB
- Smoothing : 3.0ms

#### Instruments Acoustiques Naturels
- Fast Attack : 2.0ms
- Fast Release : 30ms
- Slow Attack : 25ms
- Slow Release : 400ms
- Transient Gain : +3dB
- Sustain Gain : 0dB
- Smoothing : 8.0ms

#### Son Électronique Serré
- Fast Attack : 1.0ms
- Fast Release : 15ms
- Slow Attack : 10ms
- Slow Release : 250ms
- Transient Gain : +6dB
- Sustain Gain : -6dB
- Smoothing : 4.0ms