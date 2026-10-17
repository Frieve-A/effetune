---
title: "Affectation des contrôleurs - MIDI, manette et clavier - EffeTune"
description: "Pilotez les paramètres des effets d’EffeTune depuis un contrôleur MIDI, une manette ou le clavier."
lang: fr
---

# Affectation des contrôleurs

L’affectation des contrôleurs permet de régler les paramètres d’effet sans faire glisser leurs commandes à l’écran. Vous pouvez utiliser un contrôleur MIDI, une manette ou le clavier tant qu’EffeTune a le focus. Les modifications respectent les mêmes plages de paramètres que l’interface de l’effet et sont répercutées à l’écran.

## Ajouter une affectation

1. Ouvrez **Paramètres**, puis sélectionnez **Affectation des contrôleurs...**.
2. Cliquez sur **Ajouter (Learn)**.
3. Actionnez une commande MIDI, appuyez sur une touche ou manipulez un bouton ou un axe de manette.
4. Choisissez l’effet cible, la règle d’instance et le paramètre.
5. Ajustez au besoin Min., Max., Sensibilité, le sens ou le mode d’entrée. Les modifications sont enregistrées immédiatement.

Pour attribuer l’augmentation et la diminution à deux boutons ou touches distincts, créez deux affectations : réglez **Sens** sur **Augmenter (+)** pour l’une et sur **Diminuer (−)** pour l’autre. Si une touche apprise correspond déjà à un raccourci d’EffeTune, un avertissement s’affiche ; l’affectation reste prioritaire tant que l’application a le focus.

Pour les affectations de bouton, choisissez le **Mode du bouton** : **Bascule** inverse l’état à chaque appui, tandis que **Momentané** ne maintient l’action que tant que la commande est enfoncée.

## Choisir la cible

- **Premier** pilote le premier effet correspondant dans la chaîne actuelle.
- **Dernier** pilote le dernier effet correspondant.
- **Tous** applique la même valeur à tous les effets correspondants, en prenant le premier comme référence pour les variations relatives.
- **Activé** active ou désactive l’effet.

**Global** pilote l’application et le lecteur de musique plutôt qu’un effet : **Bypass général**, **Basculer A/B**, **Lecture/Pause**, **Arrêter**, **Piste suivante/précédente**, **Avancer/reculer de 10 s**, **Vitesse de lecture**, **Conserver la hauteur**, **Répétition**, **Aléatoire** et **Préréglage suivant/précédent**.

- Pour **Piste suivante/précédente**, **Avancer/reculer de 10 s** et **Préréglage suivant/précédent**, **Sens** définit **Augmenter (+)** (avancer) ou **Diminuer (−)** (reculer). Un encodeur sans fin ou une molette jog suit le sens de rotation.
- **Vitesse de lecture** varie en continu avec un fader ou un potentiomètre (`1x` au centre), ou passe d’une vitesse standard à la suivante avec un bouton ou une touche.
- **Préréglage suivant/précédent** parcourt les préréglages utilisateur dans l’ordre de leur nom et boucle d’une extrémité à l’autre.
- Les actions du lecteur nécessitent que le lecteur de musique soit ouvert. Si le navigateur bloque le démarrage automatique de l’audio, lancez d’abord la lecture depuis l’interface du lecteur.

**Min.** et **Max.** délimitent la plage active du paramètre (dans son unité) ; inversez-les pour inverser le sens d’action. **Sensibilité** ajuste l’amplitude des pas relatifs (commencez à `1`).

## Automatiser selon l’heure ou de façon aléatoire

Cliquez sur **Ajouter une automatisation** pour faire évoluer automatiquement un paramètre numérique sans contrôleur physique. Sélectionnez d’abord l’effet et le paramètre cibles, puis configurez les options suivantes :

- **Source** : choisissez **Minuteur** (par défaut, intervalle de 1 seconde) ou **Horloge**.
- **Horloge** : **Partie de l'heure** sélectionne **Heure**, **Minute** ou **Seconde**, et **Onde** sélectionne **Montante**, **Sinus** ou **Cosinus**. L’heure locale est lue chaque seconde et projetée entre **Min.** et **Max.**.
- **Minuteur** : **Planification** propose **Intervalle**, **Une fois** et **Tous les jours**. **Intervalle** utilise **Intervalle (secondes)** de `1` à `2 147 483,647` secondes. **Une fois** se déclenche aux **Date** et **Heure** locales choisies ; **Tous les jours** se déclenche chaque jour à l’**Heure** locale indiquée.
- **Action** (minuteur et boutons ou touches affectés à un paramètre numérique) : **Modifier de la quantité** ajoute ou retranche **Quantité** à chaque déclenchement, **Valeur aléatoire dans la plage** tire une nouvelle valeur entre **Min.** et **Max.**, et **Pas aléatoire depuis la valeur actuelle** monte ou descend aléatoirement de **Quantité**.

Les automatisations par horloge ou minuteur ne s’appliquent qu’aux paramètres numériques des effets (ni **Activé**, ni les listes de choix, ni les actions **Global**) et s’exécutent au plus une fois par seconde. Si l’application ou l’ordinateur est en pause ou en veille à l’échéance d’un **Intervalle**, EffeTune applique un seul pas à la reprise puis relance l’intervalle suivant. Une échéance **Une fois** dépassée pendant la fermeture d’EffeTune est marquée **Expiré** ; choisissez une **Date** ou une **Heure** future pour la réarmer.

### Exemples pratiques

- Rayon de Vinyl Simulator : utilisez **Minuteur** avec **Intervalle (secondes)** réglé sur `1`, choisissez **Modifier de la quantité**, réglez **Sens** sur **Diminuer (−)** et **Quantité** sur `1 mm`, puis réglez **Min.** et **Max.** sur `60` et `146 mm` pour faire avancer la pointe du bord extérieur vers le sillon intérieur jusqu’à l’arrêt sur **Min.**.
- Variation tonale selon l’heure : utilisez **Horloge** avec **Minute** et **Sinus** pour faire évoluer en douceur un paramètre numérique de Radio Simulator entre **Min.** et **Max.**.
- Dérive aléatoire lente : utilisez **Minuteur** avec un intervalle plus long et **Pas aléatoire depuis la valeur actuelle**, en commençant par une petite **Quantité** pour garder des transitions progressives.
- Changement programmé : sélectionnez **Une fois** pour une date et une heure locales précises, ou **Tous les jours** pour répéter l’action chaque jour à la même heure locale.

## Types d’entrée

### MIDI

EffeTune prend en charge les messages MIDI CC, les notes et le pitch bend via Web MIDI (disponible dans les navigateurs Chromium, Firefox et l’application de bureau ; non pris en charge dans Safari). Les appareils génériques utilisent par défaut le mode CC absolu ; choisissez un mode relatif pour les encodeurs sans fin. Le BLE-MIDI et le MIDI réseau fonctionnent lorsqu’ils apparaissent comme ports MIDI du système.

### Mackie Control (MCU)

Réglez le protocole de l’appareil sur **MCU** pour les surfaces de contrôle compatibles. Les faders motorisés, la détection de toucher, les encodeurs V-Pot, les couronnes de LED et les LED de boutons sont pris en charge (l’affichage LCD, les vumètres, le timecode et le handshake matériel ne sont pas utilisés). Réapprenez les affectations après avoir basculé un appareil entre **Generic** et **MCU**.

### Manette

Les boutons peuvent basculer un état ou incrémenter un paramètre, avec répétition en cas d’appui maintenu. Les axes utilisent par défaut le mode relatif afin qu’un stick à retour au centre laisse le paramètre à sa nouvelle valeur lorsqu’on le relâche ; passez en mode absolu pour les axes de type manette des gaz qui restent en position.

### Clavier

Les affectations clavier fonctionnent tant qu’EffeTune a le focus et sont ignorées pendant la saisie dans un champ de texte. Les commandes en bascule ignorent la répétition automatique des touches, tandis que les commandes d’augmentation ou de diminution se répètent au rythme de répétition des touches de votre système d’exploitation tant que la touche est maintenue.

## Connexion et dépannage

Chaque appareil MIDI affiche **Connecté** ou **Déconnecté** sous son nom. Les affectations restent enregistrées lorsqu’un contrôleur est débranché et se reconnectent automatiquement dès qu’un appareil portant le même nom de port MIDI ou de manette réapparaît. Si une mise à jour du système ou d’un pilote modifie ce nom, réapprenez les affectations concernées. Les manettes portant le même nom partagent leurs affectations, et les ports MIDI portant le même nom ne sont distingués que par leur ordre de connexion. Si aucun appareil MIDI n’apparaît, accordez l’autorisation MIDI puis rouvrez **Affectation des contrôleurs...**. Sous Safari, les affectations au clavier et à la manette restent utilisables.

[← Retour au README](README.md)
