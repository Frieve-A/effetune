---
layout: dsp
title: "Bundle v1"
description: "Bundle v1"
lang: en
permalink: /dsp/reference/bundle-v1/
---
# Bundle v1

The [raw schema](/dsp/schemas/bundle-v1.schema.json) is authoritative. A Bundle contains
Chain v1 plus external asset manifests with ID, reference, SHA-256, byte length, and
ETA1 format. Python `Bundle.pack()` and `effetune bundle pack` write this directory
layout; JavaScript `encodeEta1()` writes canonical ETA1 bytes for resolvers. The
resolver verifies hash, size, rate, channel, topology, and cross-field rules before
processing. ZIP containers are outside v1.
