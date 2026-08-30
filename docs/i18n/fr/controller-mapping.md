---
title: "Affectation des contrôleurs - EffeTune"
description: "Contrôlez les paramètres d'EffeTune par MIDI, manette ou clavier."
lang: fr
---

# Affectation des contrôleurs

Cette fonction permet de régler les paramètres sans faire glisser les commandes à l'écran. Vous pouvez utiliser un contrôleur MIDI, une manette ou des touches lorsque EffeTune a le focus ; les modifications sont également visibles dans l'interface.

## Ajouter une affectation

1. Ouvrez **Settings**, puis **Affectation des contrôleurs...**.
2. Choisissez **Ajouter (Learn)** et actionnez la commande, la touche ou la manette.
3. Sélectionnez l'effet, la règle d'instance et le paramètre.
4. Réglez au besoin Min, Max, Sensitivity, le sens ou le mode. Chaque modification est enregistrée immédiatement.

Pour des boutons d'augmentation et de diminution séparés, créez deux affectations, l'une en **+**, l'autre en **−**. Si une touche correspond à un raccourci EffeTune, un avertissement apparaît et l'affectation est prioritaire lorsque l'application a le focus.

Pour une affectation de bouton, choisissez le **Mode du bouton** : **Bascule** change l'état à chaque pression, tandis que **Momentané** ne reste actif que pendant l'appui.

## Automatiser selon l'heure ou de façon aléatoire

Choisissez **Ajouter une automatisation** pour faire varier un paramètre numérique sans contrôleur physique. La nouvelle affectation utilise d'abord un **Minuteur** d'une seconde. Avec **Horloge**, choisissez **Heure**, **Minute** ou **Seconde**, puis une onde **Montante**, **Sinus** ou **Cosinus**. L'heure locale est lue une fois par seconde et reportée entre Min. et Max.

Avec Minuteur, réglez **Intervalle (secondes)** sur 1 ou plus. **Modifier de la quantité** ajoute ou retranche la **Quantité** à chaque événement ; **Valeur aléatoire dans la plage** choisit une nouvelle valeur entre Min. et Max. ; **Pas aléatoire depuis la valeur actuelle** monte ou descend depuis la valeur en cours.

La **Planification** propose **Intervalle**, **Une fois** et **Tous les jours**. L'intervalle va de 1 à 2 147 483,647 secondes et mesure le temps écoulé pendant l'exécution de l'application. En cas de retard, une seule modification est appliquée, puis l'intervalle suivant repart de cet instant, sans rejouer les événements manqués. Une fois utilise la **Date** et l'**Heure** locales ; Tous les jours utilise l'heure locale et attend le lendemain si l'heure du jour est passée. Les deux suivent le calendrier et l'horloge locaux de l'ordinateur, y compris les changements manuels et l'heure d'été ; Tous les jours ne s'exécute qu'une fois au maximum par date locale. Une échéance passée apparaît comme **Expiré** et n'est pas rattrapée ; placez la date ou l'heure dans le futur pour la réarmer.

Horloge et Minuteur ne contrôlent que les paramètres numériques des effets, pas Enabled, les listes, Master Bypass ou A/B Toggle. Les actions aléatoires sont aussi disponibles pour un bouton ou une touche physique affecté à un paramètre numérique. Si l'application ou l'ordinateur retarde un événement, une seule modification est appliquée à la reprise, sans rejouer les événements manqués. Une même configuration ne reproduit pas toujours la même suite aléatoire.

**Premier** et **Dernier** choisissent la première ou la dernière instance correspondante. **Tous** applique la même valeur à toutes et prend la première comme valeur de départ des réglages relatifs. **Enabled** active ou désactive l'effet ; **Global** propose Master Bypass et A/B Toggle. Min et Max limitent la course et se saisissent dans l'unité affichée pour le paramètre ; inversez-les pour inverser le sens. Commencez avec Sensitivity 1.

## Sources de commande

- **MIDI :** CC, notes et pitch bend via Web MIDI. Les CC sont absolus par défaut ; choisissez le mode relatif adapté à un encodeur sans fin. Chromium et Firefox prennent en charge Web MIDI, contrairement à Safari. BLE-MIDI et MIDI réseau fonctionnent si le système les expose comme ports MIDI.
- **Mackie Control (MCU) :** choisissez **MCU** comme protocol. Les faders motorisés et leur toucher, les V-Pot et anneaux LED, ainsi que les LED des boutons sont pris en charge. Le texte LCD, les vumètres, l'affichage temporel et le handshake ne le sont pas. Après un passage de Generic à MCU ou inversement, recommencez le Learn.
- **Manette :** les boutons avancent ou basculent un réglage et peuvent se répéter lorsqu'ils sont maintenus pour les valeurs continues ou les listes. Les axes sont relatifs par défaut, ce qui convient aux sticks à rappel central ; utilisez le mode absolu pour les commandes sans rappel.
- **Clavier :** il fonctionne uniquement lorsque EffeTune a le focus et reste inactif dans les champs de texte. Les bascules ignorent la répétition du système ; les actions d'augmentation et de diminution peuvent se répéter.

## Connexion et dépannage

Les affectations restent enregistrées après une déconnexion et reprennent au retour d'un périphérique de même nom. Si une mise à jour du système ou du pilote modifie ce nom, recommencez le Learn pour les affectations concernées. Les manettes identiques partagent leurs affectations et les ports MIDI de même nom ne sont distingués que par leur ordre de connexion.

Si aucun périphérique MIDI n'apparaît, autorisez l'accès MIDI pour EffeTune et rouvrez la fenêtre. Sur Safari, le clavier et la manette restent disponibles.
