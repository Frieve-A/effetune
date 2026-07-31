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
