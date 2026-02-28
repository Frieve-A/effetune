---
title: "Control Plugins - EffeTune"
description: "Control plugins for organizing effect chains with Section grouping."
lang: en
---

# Control Effects

Control effects are special utility effects that don't process audio directly but instead control how other effects operate. They help organize and manage complex effect chains.

## Section

The Section effect allows you to group multiple effects together and control them with a single ON/OFF toggle.

### Overview

- **Name**: Section
- **Category**: Control
- **Description**: Groups multiple effects together for unified control

### Parameters

| Parameter | Description |
|-----------|-------------|
| Comment   | A name or description of the section's purpose |

### Usage

1. Place the Section effect at the beginning of a group of effects you want to control together
2. Enter a descriptive name in the "Comment" field to identify the section's purpose
3. Toggle the Section effect ON/OFF to enable/disable all effects within the section
4. Effects placed after a Section effect will be controlled by that section until another Section effect is encountered

### Application Examples

- Group related effects (e.g., "EQ Adjustments", "Spatial Effects")
- Create alternative processing chains that can be easily toggled
- Organize complex effect chains into logical sections
- Temporarily disable a group of effects without removing them 