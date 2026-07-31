---
layout: dsp
title: "Chain v1"
description: "Chain v1"
lang: en
permalink: /dsp/reference/chain-v1/
---
# Chain v1

The [raw schema](/dsp/schemas/chain-v1.schema.json) is authoritative. A document has
`version: 1` and ordered `chain` items. IDs are unique when present; semantic types,
parameters, channels, enabled state, and asset references reject unknown fields.
Some asset and cross-field rules require runtime validation after schema validation.
