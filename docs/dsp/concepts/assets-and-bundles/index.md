---
layout: dsp
title: "Assets and bundles"
description: "Assets and bundles"
lang: en
permalink: /dsp/concepts/assets-and-bundles/
---
# Assets and bundles

## Asset-required effects

`FIRCrossover`, `FiveBandFIRPEQ`, `GroupDelayEQ`, `GroupDelayPEQ`, `IRReverb`, and
`RoomEQ` require `assets.impulseResponse`. FIR filter effects require prepared
coefficients at the processing rate; IR Reverb accepts supported convolution
topologies. The resolver returns Python `AssetData` or deterministic ETA1
bytes/`{bytes, format}` in JavaScript. It never relies on repository fixtures.

The examples below run each effect with two distinct caller-owned IRs and require
finite, non-zero, different output. FIR Crossover uses two coefficient channels,
accepts stereo in processing lanes 0 and 1, and routes its two bands to four output
lanes.

Bundle v1 combines Chain JSON with external ETA1 manifests. Python
`Bundle.pack()` writes a deterministic directory bundle, and
`effetune bundle pack CHAIN DESTINATION --asset ID=FILE` provides the same writer for
decoded IR audio files. Payloads are SHA-256 and size checked, with a 32 MiB cap. ETA1
is little-endian planar float32 with a 32-byte header, optional 12-byte matrix paths,
and explicit rate/channel/topology metadata. ZIP is not part of Bundle v1.

Programmatic and CLI bundle writing:

```python
import json
from pathlib import Path

import numpy as np
import soundfile as sf

import effetune as et


chain = {
    "version": 1,
    "chain": [{
        "id": "room",
        "type": "IRReverb",
        "parameters": {
            "channelMode": "mono",
            "latency": 0,
            "convolutionRate": "full",
            "wetLevel": 0,
            "dryLevel": -96,
            "preDelay": 0,
        },
        "assets": {"impulseResponse": "room-ir"},
    }],
}
ir_samples = np.array([[0.75, 0.2]], dtype=np.float32)
ir = et.AssetData(ir_samples, 48_000, topology="automatic")
bundle = et.Bundle.pack("python-bundle", chain, {"room-ir": ir})
loaded = et.Bundle.load("python-bundle")
assert loaded.manifest == bundle.manifest

source = np.zeros((2, 1024), dtype=np.float32)
source[:, 0] = (0.5, -0.25)
output = et.Chain.from_bundle("python-bundle").process(
    source,
    sample_rate=48_000,
    block_size=64,
)
assert np.isfinite(output).all()
assert np.max(np.abs(output)) > 1e-7

Path("room-chain.json").write_text(
    json.dumps(chain, indent=2) + "\n",
    encoding="utf-8",
)
sf.write("room-ir.wav", ir_samples.T, 48_000, subtype="FLOAT")
sf.write("input.wav", source.T, 48_000, subtype="FLOAT")
```

```console
effetune bundle pack room-chain.json cli-bundle \
  --asset room-ir=room-ir.wav
effetune render input.wav convolved.wav --preset cli-bundle --subtype FLOAT
```

`--preset cli-bundle/bundle.json` is equivalent to the Bundle-directory form above.
For WAV output, omitting `--subtype` keeps SoundFile's PCM_16 default; use
`--subtype FLOAT` when the rendered samples must remain 32-bit floating point.

Python `AssetData` examples for all six types:

```python
import numpy as np
import effetune as et

SAMPLE_RATE = 48_000
COEFFICIENTS = {
    "a": (
        np.array([0.75, 0.2], dtype=np.float32),
        np.array([0.35, -0.1], dtype=np.float32),
    ),
    "b": (
        np.array([0.4, -0.3, 0.1], dtype=np.float32),
        np.array([0.8, 0.1, -0.05], dtype=np.float32),
    ),
}

for effect_type in (
    "FIRCrossover",
    "FiveBandFIRPEQ",
    "GroupDelayEQ",
    "GroupDelayPEQ",
    "IRReverb",
    "RoomEQ",
):
    channels = 4 if effect_type == "FIRCrossover" else 2
    source = np.zeros((channels, 4096), dtype=np.float32)
    source[0, 0] = 0.5
    source[1, 0] = -0.25
    outputs = []
    for ir_variant in ("a", "b"):
        coefficients = COEFFICIENTS[ir_variant]
        if effect_type == "FIRCrossover":
            frames = max(len(channel) for channel in coefficients)
            samples = np.zeros((2, frames), dtype=np.float32)
            for index, channel in enumerate(coefficients):
                samples[index, : len(channel)] = channel
            asset = et.AssetData(
                samples,
                SAMPLE_RATE,
                topology="matrix",
                paths=(
                    et.ConvolutionPath(0, 0, 0),
                    et.ConvolutionPath(1, 1, 0),
                    et.ConvolutionPath(0, 2, 1),
                    et.ConvolutionPath(1, 3, 1),
                ),
                input_count=2,
            )
            parameters = {
                "latencyMode": "0",
                "filterDelaySamples": 0,
                "bandCount": 2,
            }
        else:
            asset = et.AssetData(
                coefficients[0][np.newaxis, :],
                SAMPLE_RATE,
                topology="mono",
            )
            parameters = (
                {
                    "channelMode": "mono",
                    "latency": 0,
                    "convolutionRate": "full",
                    "wetLevel": 0,
                    "dryLevel": -96,
                    "preDelay": 0,
                }
                if effect_type == "IRReverb"
                else {"latencyMode": "0", "filterDelaySamples": 0}
            )
        chain = et.Chain.from_preset(
            {
                "version": 1,
                "chain": [{
                    "id": effect_type,
                    "type": effect_type,
                    "parameters": parameters,
                    "assets": {"impulseResponse": f"memory:{effect_type}"},
                }],
            },
            asset_resolver=lambda _reference, resolved=asset: resolved,
        )
        output = chain(source, SAMPLE_RATE, seed=0, block_size=64)
        assert output.shape == source.shape
        assert np.isfinite(output).all()
        assert np.max(np.abs(output)) > 1e-7
        outputs.append(output)
    assert np.max(np.abs(outputs[0] - outputs[1])) > 1e-5
```

Use the public `encodeEta1()` helper to encode deterministic JavaScript IR data:

```js
import { encodeEta1 } from '@effetune/dsp';

export const ASSET_EFFECT_TYPES = Object.freeze([
  'FIRCrossover',
  'FiveBandFIRPEQ',
  'GroupDelayEQ',
  'GroupDelayPEQ',
  'RoomEQ',
  'IRReverb'
]);

const COEFFICIENTS = Object.freeze({
  a: Object.freeze([
    Float32Array.of(0.75, 0.2),
    Float32Array.of(0.35, -0.1)
  ]),
  b: Object.freeze([
    Float32Array.of(0.4, -0.3, 0.1),
    Float32Array.of(0.8, 0.1, -0.05)
  ])
});

export function assetSetup(effect, sampleRate = 48000, irVariant = 'a') {
  if (!effect.assets.length) {
    return { channels: 2, references: undefined, assetResolver: undefined };
  }
  if (!ASSET_EFFECT_TYPES.includes(effect.type)) {
    throw new Error(`No canonical asset fixture for ${effect.type}.`);
  }
  const coefficients = COEFFICIENTS[irVariant];
  if (!coefficients) throw new Error(`Unknown IR variant: ${irVariant}.`);
  const crossover = effect.type === 'FIRCrossover';
  const bytes = crossover
    ? encodeEta1({
        channels: coefficients,
        sampleRate,
        topology: 'matrix',
        paths: [
          { inputSlot: 0, outputSlot: 0, irChannel: 0 },
          { inputSlot: 1, outputSlot: 1, irChannel: 0 },
          { inputSlot: 0, outputSlot: 2, irChannel: 1 },
          { inputSlot: 1, outputSlot: 3, irChannel: 1 }
        ]
      })
    : encodeEta1({
        channels: [coefficients[0]],
        sampleRate,
        topology: 'mono'
      });
  const parameters = effect.type === 'IRReverb'
    ? {
        channelMode: 'mono',
        latency: 0,
        convolutionRate: 'full',
        wetLevel: 0,
        dryLevel: -96,
        preDelay: 0
      }
    : effect.type === 'FIRCrossover'
      ? { latencyMode: '0', filterDelaySamples: 0, bandCount: 2 }
      : { latencyMode: '0', filterDelaySamples: 0 };
  return {
    channels: crossover ? 4 : 2,
    parameters,
    references: Object.fromEntries(effect.assets.map(asset => [
      asset.name,
      `memory:${effect.type}:${asset.name}`
    ])),
    assetResolver: () => bytes
  };
}
```

Then run the JavaScript resolver examples for all six types:

```js
import assert from 'node:assert/strict';
import { createChain, getEffectCatalog } from '@effetune/dsp';
import { ASSET_EFFECT_TYPES, assetSetup } from './asset-fixtures.mjs';

const sampleRate = 48000;
const effects = getEffectCatalog().effects.filter(effect => effect.assets.length);
assert.deepEqual(effects.map(effect => effect.type), ASSET_EFFECT_TYPES);
for (const variant of ['baseline', 'simd']) {
  for (const effect of effects) {
    const inputChannels = effect.type === 'FIRCrossover' ? 4 : 2;
    const input = Array.from({ length: inputChannels }, (_, channelIndex) => {
      const channel = new Float32Array(4096);
      if (channelIndex < 2) channel[0] = channelIndex === 0 ? 0.5 : -0.25;
      return channel;
    });
    const outputs = [];
    for (const irVariant of ['a', 'b']) {
      const {
        channels,
        parameters,
        references,
        assetResolver
      } = assetSetup(effect, sampleRate, irVariant);
      assert.equal(channels, inputChannels);
      const chain = await createChain({
        version: 1,
        chain: [{
          id: effect.type,
          type: effect.type,
          parameters,
          assets: references
        }]
      }, { variant, assetResolver });
      const output = await chain.process(input, {
        sampleRate,
        seed: 0,
        blockSize: 64
      });
      assert.equal(output.length, input.length);
      assert.ok(output.every(channel =>
        channel.length === input[0].length && channel.every(Number.isFinite)
      ));
      assert.ok(output.some(channel =>
        channel.some(sample => Math.abs(sample) > 1e-7)
      ));
      outputs.push(output);
      chain.close();
    }
    let maximumDifference = 0;
    for (let channel = 0; channel < outputs[0].length; channel += 1) {
      for (let frame = 0; frame < outputs[0][channel].length; frame += 1) {
        maximumDifference = Math.max(
          maximumDifference,
          Math.abs(outputs[0][channel][frame] - outputs[1][channel][frame])
        );
      }
    }
    assert.ok(maximumDifference > 1e-5);
  }
}
```
