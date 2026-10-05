---
layout: dsp
title: "Streaming and events"
description: "Streaming and events"
lang: en
permalink: /dsp/concepts/streaming-and-events/
---
# Streaming and events

Use streams for tails, filter history, stateful dynamics, and seeded random continuity.
Reproduction requires the exact input block list and every event's content, frame, and
order, including `setParam` and `reset` positions. Scheduled frame events are stream
operations. Close streams deterministically. Python exposes the aggregate
`latency_samples`; JavaScript exposes the same value as `latencySamples` on a
`ChainStream`. `EffeTuneNode.latencySamples` exposes the cached aggregate for
the AudioWorklet path.

Python and JavaScript event `parameters` are partial updates merged with the effect's
current semantic values. Frames are zero-based within that `process()` input. Events
must be in non-decreasing frame order; events sharing a frame are merged in supplied
order before that sample:

```python
output = stream.process(audio, events=[
    {"frame": 0, "effectId": "voice", "parameters": {"threshold": -24}},
    {"frame": 0, "effectId": "voice", "parameters": {"ratio": 6}},
])
```

A scheduled event updates the semantic target at its frame; the event mechanism
itself generates no ramp. Each effect's own smoothing can still delay the audible
transition to that target. Scheduling small events does not bypass that smoothing
or guarantee an exact sample-by-sample automation curve.

An open stream or AudioWorklet accepts only values the native parameter commit can
apply immediately. Open a new stream after changing `IRReverb.channelMode`,
`latency`, or `convolutionRate`; `FIRCrossover.bandCount`, `latencyMode`, or
`filterDelaySamples`; or `latencyMode` / `filterDelaySamples` on
`FiveBandFIRPEQ`, `GroupDelayEQ`, `GroupDelayPEQ`, `CrosstalkCancellation`, or `RoomEQ`. Live updates to those
asset-configuration parameters raise `ValidationError` before processing or posting
a Worklet command.

## Processing a file in blocks

A frame-direction slice of a multi-channel planar array, such as
`audio[:, start:stop]`, is a non-contiguous view, so copy each block before passing it
to the stream. Mono arrays stay contiguous under the same slice, and the copy is a
no-op for them, so the pattern below is correct for any channel count:

```python
with chain.stream(sample_rate, channels=audio.shape[0]) as stream:
    blocks = [
        stream.process(np.ascontiguousarray(audio[:, start:start + 4096]))
        for start in range(0, audio.shape[1], 4096)
    ]
output = np.concatenate(blocks, axis=1)
```

Passing a non-contiguous view directly raises `ValidationError` with the same guidance.

## Volume automation

`Volume` applies its initial gain immediately. After processing has started,
each target update makes a linear-in-gain transition lasting
`ceil(sampleRate * 0.005)` samples. At 48 kHz this is 240 samples (5 ms).
The first interpolation step is applied at the event frame, and the target is
reached at `eventFrame + 239`. A target received before the transition finishes
starts another 240-sample transition from the current gain. This behavior also
applies to JavaScript `setParam`; it is not an interpolation between dB values.

These complete examples reduce a constant 0.25 input from 0 dB to -6 dB at
frame 128, then to -12 dB at frame 608. The output remains 0.25 through frame 127,
is about 0.2494804 at frame 128, reaches about 0.1252968 at frame 367, and reaches
about 0.0627972 at frame 847. The targets are 10 ms apart, leaving 5 ms at each
settled level before the next transition. Internal 128-frame blocks do not change
those positions.

```python
import numpy as np
import effetune as et

sample_rate = 48_000
audio = np.full((2, 1024), 0.25, dtype=np.float32)
chain = et.Chain([et.Volume(id="level", volume=0)])
with chain.stream(sample_rate, channels=2, block_size=128) as stream:
    output = stream.process(audio, events=[
        {"frame": 128, "effectId": "level", "parameters": {"volume": -6}},
        {"frame": 608, "effectId": "level", "parameters": {"volume": -12}},
    ])

# Each target change completes after 240 samples at 48 kHz.
np.testing.assert_allclose(output[:, :128], 0.25, rtol=0, atol=1e-7)
np.testing.assert_allclose(output[:, 367:608], 0.25 * 10 ** (-6 / 20), atol=1e-7)
np.testing.assert_allclose(output[:, 847:], 0.25 * 10 ** (-12 / 20), atol=1e-7)
print({frame: float(output[0, frame]) for frame in (127, 128, 367, 608, 847)})
```

```js
import { createChain } from '@effetune/dsp';

const chain = await createChain({
  version: 1,
  chain: [{ id: 'level', type: 'Volume', parameters: { volume: 0 } }]
});
const stream = await chain.stream({ sampleRate: 48000, channels: 2, blockSize: 128 });
try {
  const audio = [new Float32Array(1024).fill(0.25), new Float32Array(1024).fill(0.25)];
  const output = await stream.process(audio, {
    events: [
      { frame: 128, effectId: 'level', parameters: { volume: -6 } },
      { frame: 608, effectId: 'level', parameters: { volume: -12 } }
    ]
  });
  // Each target change completes after 240 samples at 48 kHz.
  for (const channel of output) {
    for (let frame = 0; frame < channel.length; frame += 1) {
      const expected = frame < 128 ? 0.25
        : frame >= 367 && frame < 608 ? 0.25 * 10 ** (-6 / 20)
          : frame >= 847 ? 0.25 * 10 ** (-12 / 20) : null;
      if (expected !== null && Math.abs(channel[frame] - expected) > 1e-7) {
        throw new Error(`Unexpected gain at frame ${frame}`);
      }
    }
  }
  console.log(Object.fromEntries([127, 128, 367, 608, 847].map(
    frame => [frame, output[0][frame]]
  )));
} finally {
  stream.close();
  chain.close();
}
```
