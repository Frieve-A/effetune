---
title: "Bus Function Guide - EffeTune"
description: "Learn how to use the Bus feature in EffeTune for flexible audio routing and complex effect chains."
lang: en
---

# Comment utiliser la fonctionnalité Bus

La fonctionnalité Bus permet une gestion audio flexible entre les effets, offrant un traitement audio plus complexe et polyvalent.

## Concept de base

- Chaque effet vous permet de spécifier un **Bus d'entrée** qui reçoit le signal audio à traiter, et un **Bus de sortie** qui émet l'audio traité.
- Par défaut, sauf indication contraire, chaque effet utilise le **Bus principal** pour l'entrée et la sortie.
- Jusqu'à quatre bus supplémentaires (**Bus 1 à Bus 4**) peuvent être utilisés.

![Fonction du Bus](../../../images/bus_function.png)

## Configuration des bus d'entrée et de sortie pour les effets

- Cliquez sur le **bouton de routage** situé à gauche des boutons haut/bas affichés sur chaque effet.
- En cliquant sur le bouton de routage, une fenêtre de paramètres s'ouvre, permettant de sélectionner librement le Bus d'entrée et le Bus de sortie parmi le Bus principal ou Bus 1 à Bus 4.
- Les modifications prennent effet immédiatement.
- Pour fermer la fenêtre, cliquez sur le bouton × en haut à droite ou cliquez en dehors de la fenêtre.

- Si l'entrée ou la sortie est définie sur Bus 1 ou plus, "Bus X→Bus Y" sera affiché à côté du bouton de routage.
  - Exemple : Lors du traitement de l'audio du Bus 2 et de sa diffusion vers le Bus 3, il affichera "Bus 2→Bus 3".

## Mécanisme de traitement audio

- Les effets sont traités séquentiellement de haut en bas.
- Chaque effet récupère les signaux audio du Bus d'entrée spécifié, les traite et envoie le résultat vers le Bus de sortie.
- Si un Bus d'entrée est utilisé pour la première fois, le traitement commence à partir du silence.
- Si les bus d'entrée et de sortie sont identiques, l'audio du Bus de sortie est écrasé par le résultat traité.
- Si des bus différents sont spécifiés pour l'entrée et la sortie, l'audio traité est ajouté au Bus de sortie.
- Finalement, la lecture audio provient toujours du **Bus principal**.

[← Retour au README](README.md)
