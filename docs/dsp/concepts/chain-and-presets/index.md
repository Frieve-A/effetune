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
one serial path in the app and export it again, or rebuild the branching with
[Graph v1](/dsp/reference/graph-v1/), or reproduce it in the host around separate Chains.

App presets containing an effect that the library drives from a required
caller-supplied precomputed impulse-response asset cannot be imported: `FIR Crossover`,
`5Band FIR PEQ`, `Group Delay EQ`, `Group Delay PEQ`, `Room EQ`, `IR Reverb`,
and `Crosstalk Cancellation`. The app's filter-design parameters have no conversion,
so the importer rejects the node with an `EffectError` naming the effect. Construct
such an effect directly and supply its asset.

## Visual editor to code

The example below imports an asset-free stereo app preset and
processes a fixed stereo input through the canonical Chain. The importer validates and
then discards the duplicate structural keys and display-only state that the app writes.
In Python, the import report lists a warning when it discards preset metadata such as
the name or timestamp, discards a few editor states such as compressor meter display, or
flattens Section structure. JavaScript `importLegacyPreset()` returns only the
ChainDocument, so it discards that metadata and flattens Sections without a warning. Any
other unknown field is an error; it is never silently dropped.

In the desktop app, build a pipeline containing only Volume at -6 dB, choose
**File > Export Preset...**, and save it as `listening.effetune_preset` in your
working directory (the export is named after the preset by default). Alternatively,
save the following example under that name:

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

Run this Python example from the same directory. It checks that the imported
preset applies the expected gain to a short stereo signal:

```python
import json
from pathlib import Path

import numpy as np
import effetune as et

exported = json.loads(Path("listening.effetune_preset").read_text("utf-8"))
chain, report = et.Chain.from_legacy_preset(exported)
assert isinstance(report.warnings, tuple)
audio = np.ones((2, 256), dtype=np.float32) * np.float32(0.25)
output = chain(audio, 48_000, seed=0)
expected = audio * np.float32(10 ** (-6 / 20))
assert output.shape == audio.shape
assert np.allclose(output, expected, rtol=1e-5, atol=1e-6)
```
