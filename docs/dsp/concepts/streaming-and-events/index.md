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

A scheduled event replaces the semantic parameter value at its frame; the event
mechanism itself generates no ramp between the old and new value. For value-only
effects such as `Volume`, schedule a series of small events across successive
frames when an audible-click-free ramp is required.

An open stream or AudioWorklet accepts only values the native parameter commit can
apply immediately. Open a new stream after changing `IRReverb.channelMode`,
`latency`, or `convolutionRate`; `FIRCrossover.bandCount`, `latencyMode`, or
`filterDelaySamples`; or `latencyMode` / `filterDelaySamples` on
`FiveBandFIRPEQ`, `GroupDelayEQ`, `GroupDelayPEQ`, or `RoomEQ`. Live updates to those
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
