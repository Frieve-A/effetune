---
title: "Plugins de restauration - EffeTune"
description: "Plugins de restauration pour les clics, crêtes écrêtées, ronflement électrique et bruit de fond constant."
lang: fr
---

# Plugins de restauration

Les plugins de restauration réduisent les défauts indésirables d'un enregistrement tout en préservant le plaisir d'écoute.

## Liste des plugins

- [Click Remover](#click-remover) - Répare clics, crépitements, pops et brèves coupures
- [Clip Restorer](#clip-restorer) - Restaure les crêtes aplaties par un écrêtage dur
- [Hum Remover](#hum-remover) - Supprime le ronflement électrique constant et ses harmoniques
- [Noise Reduction](#noise-reduction) - Atténue le souffle et le bourdonnement de fond constants sans abîmer la musique

## Click Remover

Click Remover répare les défauts courts et isolés, comme les crépitements de disque, les pops, les clics et les microcoupures. Utilisez-le pour des interruptions occasionnelles, pas pour un souffle ou un ronflement constant.

### Guide d'écoute

1. Commencez avec **Sensitivity** à 50 % et **Max Repair Length** à 1 ms.
2. Augmentez progressivement **Sensitivity** jusqu'à ce que les clics soient moins gênants. Si les attaques de batterie ou d'autres détails vifs s'adoucissent, baissez-la.
3. Augmentez **Max Repair Length** seulement pour des pops ou coupures plus longs; gardez une durée courte pour un crépitement ordinaire.
4. Pendant le passage concerné, vérifiez **REPAIRS/S** et comparez avec l'effet désactivé avant de retenir un réglage plus fort.

### Paramètres

- **Sensitivity** (0–100 %, valeur initiale 50 %) règle la facilité avec laquelle un bref changement est considéré comme un défaut. Une valeur élevée répare davantage de clics supposés; une valeur basse reste prudente et préserve les attaques musicales.
- **Max Repair Length** (0,1–2 ms, valeur initiale 1 ms) limite la durée de chaque réparation. Augmentez-la pour des pops ou coupures un peu plus longs; baissez-la pour les crépitements courts.

### Lire l'affichage

**REPAIRS/S** indique le nombre récent de réparations par seconde. Une valeur proche de zéro signifie qu'aucun défaut bref n'est réparé. Une valeur durablement élevée sur une musique normale invite à baisser **Sensitivity** ou **Max Repair Length**.

## Clip Restorer

Clip Restorer reconstruit les crêtes aplaties par un écrêtage numérique dur. Il convient aux enregistrements présentant une distorsion aux sommets clairement plats, mais ne peut pas restituer tous les détails perdus avant l'arrivée dans EffeTune.

### Guide d'écoute

1. Commencez avec **Threshold** à -0,10 dB et **Output Gain** à -3 dB.
2. Baissez légèrement **Threshold** si des crêtes écrêtées restent audibles. Remontez-le vers 0 dB s'il modifie inutilement des sons forts et soutenus.
3. Gardez si possible **Output Gain** sous 0 dB : les crêtes restaurées peuvent dépasser les sommets plats d'origine.
4. Consultez **RESTORED** sur un passage abîmé et comparez avec l'effet désactivé pour choisir le réglage le moins intrusif.

### Paramètres

- **Threshold** (-18–0 dB, valeur initiale -0,10 dB) définit le niveau traité comme une crête écrêtée. Près de 0 dB, seuls les sommets presque à pleine échelle sont visés; une valeur plus basse inclut un écrêtage moins évident, mais peut agir sur davantage de sons forts.
- **Output Gain** (-12–0 dB, valeur initiale -3 dB) fixe le niveau de sortie après restauration. Remontez-le vers 0 dB pour plus de niveau; baissez-le pour garder de la marge.

### Lire l'affichage

**RESTORED** indique le pourcentage récent d'échantillons réparés comme crêtes écrêtées. Une faible valeur peut être normale, car l'écrêtage est souvent très bref. S'il reste élevé sur un son non écrêté, augmentez **Threshold**.

## Hum Remover

Hum Remover réduit un ronflement électrique constant et ses harmoniques, par exemple à 50 ou 60 Hz, provenant d'une platine, d'un câble ou de l'alimentation. Il vise une tonalité continue, pas le bruit de fond général.

### Guide d'écoute

1. Commencez avec **Frequency** sur **Auto**, **Harmonics** à 8 et **Tracking Speed** à 50 %.
2. Si vous connaissez la fréquence du secteur de l'enregistrement, choisissez **50 Hz** ou **60 Hz**. Sinon, laissez **Auto** et consultez **FUNDAMENTAL**.
3. Augmentez **Harmonics** si un bourdonnement subsiste au-dessus de la fondamentale; baissez-le si la musique perd du corps ou du détail.
4. Augmentez **Tracking Speed** si le ronflement dérive lentement; baissez-le pour un ronflement stable. Si une basse soutenue coïncide exactement avec une harmonique, réduisez **Harmonics**.

### Paramètres

- **Frequency** (**Auto**, **50 Hz** ou **60 Hz**; valeur initiale **Auto**) sélectionne la fondamentale du ronflement. **Auto** suit un ronflement de secteur détecté; choisissez une valeur fixe si vous la connaissez.
- **Harmonics** (1–64, valeur initiale 8) choisit le nombre de multiples de la fondamentale retirés. Une valeur élevée élimine davantage de bourdonnement; une valeur basse préserve davantage de musique près des harmoniques aiguës. Le curseur suit une échelle logarithmique afin d'offrir un réglage plus précis pour les valeurs basses.
- **Tracking Speed** (0–100 %, valeur initiale 50 %) règle la rapidité du suivi automatique. Une valeur élevée suit plus vite les variations; une valeur basse convient à un ronflement stable.

### Lire l'affichage

**FUNDAMENTAL** indique la fréquence actuellement visée. **REMOVED** indique en dBFS le niveau du composant retiré : plus il est proche de 0 dBFS, plus le ronflement retiré est fort; une valeur très basse, telle que -140 dBFS, signifie qu'il y en a peu ou pas.

## Noise Reduction

Noise Reduction diminue le bruit de fond constant, tel que le souffle de bande, le bruit d'un appareil ou le bruit d'une pièce. Utilisez-le lorsqu'un voile de bruit reste présent derrière la musique. Il convient surtout au bruit audible entre les notes; il ne vise pas les clics isolés, les sons de fond changeants ou une autre musique enregistrée.

### Guide d'écoute

1. Commencez avec **Reduction** 12 dB, **Sensitivity** 0 dB, **Smoothing** 50 %, **Treble Care** 50 % et **Mix** 100 %.
2. Augmentez doucement **Reduction** jusqu'à nettoyer les passages calmes. Réduisez-la si les voix, cymbales ou l'ambiance deviennent peu naturels.
3. Pour un souffle continu évident, augmentez légèrement **Sensitivity**; pour une musique déjà propre, baissez-la.
4. Si la réduction semble flotter ou modifier la couleur du son, augmentez **Smoothing**. Si la musique devient trop adoucie, baissez **Smoothing** ou **Reduction**.
5. Comparez avec l'effet désactivé et utilisez **Mix** pour conserver un peu du son original si cela paraît plus naturel.

### Paramètres

- **Reduction** (0–24 dB, valeur initiale 12 dB) définit la réduction maximale du bruit de fond. Une valeur faible est plus discrète; une valeur élevée réduit davantage le bruit mais peut masquer les détails faibles. Commencez entre 6 et 12 dB pour un bruit léger.
- **Sensitivity** (-12–+12 dB, valeur initiale 0 dB) règle la facilité avec laquelle le son est traité comme du bruit de fond. Augmentez-la si le bruit constant reste audible; baissez-la si instruments doux, fins de réverbération ou ambiance disparaissent trop. De petits ajustements suffisent généralement.
- **Smoothing** (0–100 %, valeur initiale 50 %) rend la réduction plus homogène entre fréquences voisines. Une valeur élevée limite un caractère flottant ou aqueux; une valeur basse est plus sélective. Si la musique semble terne, réduisez ce réglage et **Reduction**.
- **Treble Care** (0–100 %, valeur initiale 50 %) protège les détails musicaux aigus. Augmentez-le pour garder l'éclat des cymbales, cordes et voix; baissez-le seulement si le souffle aigu reste gênant. Une valeur médiane convient à la plupart des musiques.
- **Mix** (0–100 %, valeur initiale 100 %) équilibre le son traité et le son original. À 100 %, seul le résultat traité est audible; baissez-le si un peu d'ambiance originale paraît plus naturelle. À 0 %, le son est inchangé, ce qui facilite la comparaison.

### Réglages recommandés

1. **Nettoyage léger :** Reduction 6–10 dB, Sensitivity -2 à 0 dB, Smoothing 40–60 %, Treble Care 50–70 %.
2. **Souffle de bande ou d'appareil net :** Reduction 12–18 dB, Sensitivity 0 à +4 dB, Smoothing 60–80 %, Treble Care 50–70 %.
3. **Préserver les aigus délicats :** Reduction 6–12 dB, Sensitivity -4 à 0 dB, Smoothing 50–70 %, Treble Care 70–100 %, Mix 70–100 %.
