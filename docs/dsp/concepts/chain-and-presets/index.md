---
layout: dsp
title: "Chain and presets"
description: "Chain and presets"
lang: en
permalink: /dsp/concepts/chain-and-presets/
---
# Chain and presets

Chain v1 is an ordered serial list. Each item uses a unique optional ID, semantic type,
enabled flag, channel selector, semantic parameters, and optional asset references.
Unknown fields are rejected. EffeTune app presets with `pipeline` or `plugins` are a
different contract and require the explicit legacy importer.

The importer accepts app presets whose effects form one ordered serial path. It rejects
branched or multi-bus routing because flattening it into Chain v1 would change the
acoustic result. To migrate such a preset, first move or copy the desired effects into
one serial path in the app and export it again, or reproduce the branching in the host
around separate Chains.

App presets containing `FIR Crossover`, `5Band FIR PEQ`, `Group Delay EQ`,
`Group Delay PEQ`, `Room EQ`, or `IR Reverb` cannot be imported in v0.1: the library
drives these six effects from a caller-supplied precomputed impulse-response asset
instead of the app's filter-design parameters, so those parameters have no conversion
and the importer rejects the node with an `EffectError` naming the effect. Construct
such an effect directly and supply its asset.

## Visual editor to code

The example below exports an asset-free stereo app pipeline, imports it explicitly, and
processes a fixed stereo input through the canonical Chain. The import report identifies
editor-only metadata that is intentionally discarded; unsupported fields are not
silently dropped.

Input exported by the visual editor:

```json
{
  "name": "DSP docs Volume",
  "plugins": [
    {
      "nm": "Volume",
      "en": true,
      "ch": "A",
      "vl": -6
    }
  ]
}
```

Golden long-format export with `Date.now()` frozen to `1710000000000`:

```json
{
  "name": "DSP docs Volume",
  "pipeline": [
    {
      "name": "Volume",
      "enabled": true,
      "parameters": {
        "vl": -6
      },
      "channel": "A"
    }
  ],
  "timestamp": 1710000000000
}
```

Import and process that exact golden:

```python
import json
import os
from pathlib import Path

import numpy as np
import effetune as et

exported = json.loads(Path(os.environ["DSP_VISUAL_GOLDEN"]).read_text("utf-8"))
chain, report = et.Chain.from_legacy_preset(exported)
assert isinstance(report.warnings, tuple)
audio = np.ones((2, 256), dtype=np.float32) * np.float32(0.25)
output = chain(audio, 48_000, seed=0)
expected = audio * np.float32(10 ** (-6 / 20))
assert output.shape == audio.shape
assert np.allclose(output, expected, rtol=1e-5, atol=1e-6)
```
