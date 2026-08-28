import { EffeTuneNode } from './vendor/@effetune/dsp/worklet.js';

const fileInput = document.querySelector('#audio-file');
const sourceMode = document.querySelector('#source-mode');
const localFileControl = document.querySelector('[data-local-file]');
const volumeInput = document.querySelector('#volume');
const volumeValue = document.querySelector('#volume-value');
const startButton = document.querySelector('#start');
const bypassButton = document.querySelector('#bypass');
const stopButton = document.querySelector('#stop');
const status = document.querySelector('#status');

let context;
let activeGraph;
let bypassed = false;

if (new URLSearchParams(location.search).get('compact') === '1') {
  document.body.classList.add('is-compact');
}

function setStatus(message, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
}

function volumePreset(volume) {
  return {
    version: 1,
    chain: [
      {
        id: 'demo-volume',
        type: 'Volume',
        enabled: true,
        channel: 'all',
        parameters: {
          volume
        }
      }
    ]
  };
}

function setIdleControls() {
  startButton.disabled = false;
  bypassButton.disabled = true;
  stopButton.disabled = true;
  bypassed = false;
  bypassButton.ariaPressed = 'false';
  bypassButton.textContent = 'Bypass off';
}

function closeGraph(graph) {
  if (!graph) return;
  if (graph.source) {
    graph.source.onended = null;
    try {
      graph.source.stop();
    } catch {
      // A source that already ended needs no further action.
    }
    graph.source.disconnect();
  }
  graph.node?.close();
}

function closeActiveGraph() {
  closeGraph(activeGraph);
  activeGraph = undefined;
  setIdleControls();
}

sourceMode.addEventListener('change', () => {
  const local = sourceMode.value === 'local';
  localFileControl.hidden = !local;
  setStatus(local
    ? 'Choose a local audio file, then start processing.'
    : 'Ready to play a generated test signal.');
});

volumeInput.addEventListener('input', async () => {
  const volume = Number(volumeInput.value);
  volumeValue.value = `${volume} dB`;
  if (!activeGraph) return;
  try {
    if (!bypassed) {
      await activeGraph.node.setParam('demo-volume', 'volume', volume);
    }
  } catch (error) {
    console.error('Unable to update the processed volume.', error);
    setStatus('The volume could not be updated. Stop playback and try again.', 'error');
  }
});

function generatedBuffer(audioContext) {
  const frames = audioContext.sampleRate * 6;
  const buffer = audioContext.createBuffer(2, frames, audioContext.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let frame = 0; frame < frames; frame += 1) {
      const time = frame / audioContext.sampleRate;
      samples[frame] = 0.3 * Math.sin(2 * Math.PI * 220 * time) +
        0.2 * Math.sin(2 * Math.PI * 440 * time);
    }
  }
  return buffer;
}

startButton.addEventListener('click', async () => {
  const [file] = fileInput.files;
  if (sourceMode.value === 'local' && !file) {
    setStatus('Choose an audio file before starting playback.', 'error');
    return;
  }

  startButton.disabled = true;
  let pendingGraph;
  setStatus('Preparing the audio processor…');
  try {
    context ??= new AudioContext();
    await context.resume();
    const buffer = sourceMode.value === 'local'
      ? await context.decodeAudioData(await file.arrayBuffer())
      : generatedBuffer(context);
    if (buffer.numberOfChannels > 16) {
      throw new RangeError('This demo supports audio files with up to sixteen channels.');
    }

    const node = await EffeTuneNode.create(
      context,
      volumePreset(Number(volumeInput.value)),
      {
        channels: buffer.numberOfChannels,
        seed: 42
      }
    );
    pendingGraph = { node };
    const source = new AudioBufferSourceNode(context, { buffer });
    pendingGraph.source = source;
    source.connect(node).connect(context.destination);
    activeGraph = pendingGraph;
    pendingGraph = undefined;
    source.onended = () => {
      closeActiveGraph();
      setStatus('Playback finished. You can play the file again.');
    };
    bypassButton.disabled = false;
    stopButton.disabled = false;
    source.start();
    setStatus('Playing through the EffeTune DSP AudioWorklet.');
  } catch (error) {
    console.error('Unable to start the EffeTune DSP demo.', error);
    closeGraph(pendingGraph);
    closeActiveGraph();
    setStatus(
      error instanceof RangeError
        ? error.message
        : 'The audio processor could not start. Try another audio file or browser.',
      'error'
    );
  }
});

bypassButton.addEventListener('click', async () => {
  if (!activeGraph) return;
  bypassButton.disabled = true;
  try {
    bypassed = !bypassed;
    await activeGraph.node.setParam(
      'demo-volume',
      'volume',
      bypassed ? 0 : Number(volumeInput.value)
    );
    bypassButton.ariaPressed = String(bypassed);
    bypassButton.textContent = bypassed ? 'Bypass on' : 'Bypass off';
    setStatus(bypassed ? 'Bypass is on.' : 'Processing is on.');
  } catch (error) {
    console.error('Unable to change bypass state.', error);
    setStatus('Bypass could not be changed. Stop playback and try again.', 'error');
  } finally {
    bypassButton.disabled = false;
  }
});

stopButton.addEventListener('click', () => {
  closeActiveGraph();
  setStatus('Playback stopped.');
});
