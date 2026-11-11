---
title: "Control Plugins - EffeTune"
description: "Control plugins for organizing effect chains with Section grouping."
lang: en
---

# Control Effects

Control effects are special utility effects that don't process audio directly but instead control how other effects operate. They help organize and manage complex effect chains.

## Live Audio Receive

Use Live Audio Receive on a receiving EffeTune computer to start processing a live stream from another EffeTune at this position. Effects before it are skipped; effects after it process the received sound. Ordinary music and unidentified streams still start at the beginning of the pipeline. This marker has no adjustable parameters.

Place it before the effects you want to apply on the receiving computer. “Receiving live audio · Processing starts here” identifies the marker actually receiving the stream. If it is off, in a disabled Section, or absent, the stream passes through the entire pipeline. The receiving computer does not forward the live stream through Network Output.

## Live Audio Send

Use Live Audio Send to send the sound at this position to Network Output while continuing through the local effects. For example, place a shared EQ before it and a local Room EQ after it. Enable Network Output and select the receiving devices. This marker has no adjustable parameters.

Without an enabled marker, Network Output sends the final pipeline output. With multiple enabled markers of the same kind, only the first is used; later markers show that another marker is in use. With master bypass on, Network Output uses the normal output instead.

## Section

The Section effect groups multiple effects so you can bypass or restore that whole part of the chain with one ON/OFF toggle. Each effect keeps its own ON/OFF setting.

### Overview

- **Name**: Section
- **Category**: Control
- **Description**: Groups effects so a whole section can be bypassed or restored

### Parameters

| Parameter | Description |
|-----------|-------------|
| Comment   | A name or description of the section's purpose |

### Usage

1. Place the Section effect at the beginning of a group of effects you want to control together
2. Enter a descriptive name in the "Comment" field to identify the section's purpose
3. Toggle the Section effect OFF to bypass the effects in that section; toggle it ON to restore the section, while preserving each effect's own ON/OFF state
4. Effects placed after a Section effect will be controlled by that section until another Section effect is encountered

### Application Examples

- Group related effects (e.g., "EQ Adjustments", "Spatial Effects")
- Create alternative processing chains that can be easily toggled
- Organize complex effect chains into logical sections
- Temporarily disable a group of effects without removing them
