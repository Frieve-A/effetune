---
title: "Plugins de contrôle - EffeTune"
description: "Plugins de contrôle pour organiser les chaînes d'effets avec des sections."
lang: fr
---

# Effets de contrôle

Les effets de contrôle sont des outils utilitaires qui ne traitent pas directement l'audio. Ils servent à organiser et gérer l'Effect Pipeline lorsque la chaîne devient plus longue.

## Section

L'effet Section regroupe plusieurs effets afin de pouvoir contourner ou rétablir toute cette partie de la chaîne avec un seul basculement ON/OFF. Chaque effet conserve son propre état ON/OFF.

### Aperçu

- **Nom**: Section
- **Catégorie**: Control
- **Rôle**: Regroupe plusieurs effets pour contourner ou rétablir une section entière

### Paramètres

| Paramètre | Rôle |
|-----------|-------------|
| Comment   | Nom ou description du rôle de la section |

### Utilisation

1. Placez l'effet Section au début du groupe d'effets à contrôler ensemble
2. Entrez un nom clair dans le champ "Comment" pour identifier le rôle de la section
3. Mettez l'effet Section sur OFF pour contourner les effets de cette section ; remettez-le sur ON pour rétablir la section, tout en conservant l'état ON/OFF propre à chaque effet
4. Les effets placés après une Section sont contrôlés par cette section jusqu'à la Section suivante

### Exemples d'utilisation

- Regrouper des effets liés, par exemple "Réglages EQ" ou "Effets spatiaux"
- Comparer facilement plusieurs parties d'une chaîne de traitement
- Organiser une chaîne complexe en sections logiques
- Contourner temporairement un groupe d'effets sans les supprimer
