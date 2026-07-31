---
layout: dsp
title: "AudioWorklet Start"
description: "AudioWorklet Start"
lang: en
permalink: /dsp/getting-started/audioworklet/
---
# AudioWorklet Start

Use this path to run the package-owned WASM processor in a browser audio graph.

<!-- DSP-RELEASE-NOTICE -->
> **Release state:** npm is **unreleased**. The public install command is intentionally disabled until a version-matched smoke test passes.

Serve the app over HTTPS or localhost. Direct `file:` loading is unsupported because
ordinary browser module, AudioWorklet, and WASM security rules generally reject it.
Start from a user gesture, keep processor/WASM/meta assets same-origin with correct MIME
types, and permit them in CSP.

## Browser audio

Copy the package's complete `dist/` directory to
`/vendor/@effetune/dsp/dist/`. This import map resolves the package's bare Worklet
specifier; the module script is the runnable Start below.

```html
<!doctype html>
<meta charset="utf-8">
<title>EffeTune AudioWorklet Start</title>
<script type="importmap">
{
  "imports": {
    "@effetune/dsp/worklet": "/vendor/@effetune/dsp/dist/worklet.js"
  }
}
</script>
<script type="module" src="./audioworklet-start.js"></script>
```

```js
import { EffeTuneNode } from '@effetune/dsp/worklet';

export async function createVolumeGraph(
  context,
  source,
  destination = context.destination,
  options = {}
) {
  if (typeof OfflineAudioContext === 'undefined' ||
      !(context instanceof OfflineAudioContext)) {
    await context.resume();
  }
  const node = await EffeTuneNode.create(context, {
    version: 1,
    chain: [{
      id: 'volume',
      type: 'Volume',
      parameters: { volume: -6 }
    }]
  }, { channels: 2, seed: 0, ...options });
  source.connect(node).connect(destination);
  return {
    node,
    async setVolume(volume) {
      await node.setParam('volume', 'volume', volume);
    },
    async close() {
      source.disconnect();
      node.disconnect();
      node.close();
      if (typeof context.close === 'function') await context.close();
    }
  };
}

if (typeof document !== 'undefined') {
  const controls = document.createElement('p');
  controls.innerHTML = '<button type="button">Start</button> ' +
    '<button type="button" disabled>Stop</button>';
  document.body.append(controls);
  const [startButton, stopButton] = controls.querySelectorAll('button');
  let graph;

  startButton.addEventListener('click', async () => {
    const context = new AudioContext();
    const source = new OscillatorNode(context, { frequency: 440 });
    graph = await createVolumeGraph(context, source);
    source.start();
    startButton.disabled = true;
    stopButton.disabled = false;
  });
  stopButton.addEventListener('click', async () => {
    await graph.close();
    graph = undefined;
    startButton.disabled = false;
    stopButton.disabled = true;
  });
}
```

By default, `worklet-processor.js`, `assets/effetune-dsp.wasm`,
`assets/effetune-dsp.simd.wasm`, and `assets/effetune-dsp.meta.json` resolve
beside the mapped `dist/worklet.js`. If a deployment rebases them, pass
`processorUrl`, `wasmUrl`, `simdWasmUrl`, and `metaUrl` in the third
`EffeTuneNode.create` options argument; each accepts a string or `URL`.

The example starts a 440 Hz oscillator after a user click and routes it through a
-6 dB Volume effect. Use [Verification](/dsp/reference/verification/) for the
candidate-package browser checks.

## API

`EffeTuneNode.create(context, chain, options)` creates the node.
`setParam(effectId, semanticName, value)` applies an immediate update.
`subscribe(callback)` enables decoded analyzer telemetry on the first subscriber and
returns an unsubscribe function; `unsubscribe(callback)` removes it. Callbacks run on
the node side, never inside DSP processing. `droppedTelemetryFrames` reports loss.
`reset()` clears state and `close()` releases the worklet-side instance.
Scheduled frame events belong to Python/JavaScript streams, not this Worklet API.
