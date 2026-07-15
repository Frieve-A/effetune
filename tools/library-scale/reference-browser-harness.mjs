import { WebCatalogRepositoryClient } from '../../js/library/repository/web-catalog-client.js';

function p95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function createReferenceClient() {
  return new WebCatalogRepositoryClient({
    worker: new Worker(new URL('./reference-browser-worker.mjs', import.meta.url), { type: 'module' })
  });
}

export function observeAudioWorkletFailures(worklet) {
  const failures = [];
  const handleMessage = event => {
    const type = event.data?.type;
    if (type === 'error' || type === 'dspFailed' || type === 'dspFailure') failures.push(type);
  };
  const handleProcessorError = () => failures.push('processorerror');
  worklet.port.addEventListener('message', handleMessage);
  worklet.addEventListener('processorerror', handleProcessorError);
  worklet.port.start();
  return {
    failures,
    dispose() {
      worklet.port.removeEventListener('message', handleMessage);
      worklet.removeEventListener('processorerror', handleProcessorError);
    }
  };
}

async function seedCatalog(client, { count, seed }) {
  const started = performance.now();
  await client.request('loadReferenceFixture', { count, seed });
  return performance.now() - started;
}

async function measureCatalog(client, { count, samples }) {
  const firstPageSamples = [];
  const rareSearchSamples = [];
  for (let index = 0; index < samples; index += 1) {
    let started = performance.now();
    const page = await client.queryTracks({ query: '', sort: 'title', direction: 'asc', limit: 100 });
    firstPageSamples.push(performance.now() - started);
    await client.releaseContext(page.contextToken);
    started = performance.now();
    const search = await client.queryTracks({
      query: 'Needle 0000997', sort: 'title', direction: 'asc', limit: 100
    });
    rareSearchSamples.push(performance.now() - started);
    await client.releaseContext(search.contextToken);
  }
  const context = await client.createContext({ query: '', sort: 'title', direction: 'asc', scope: null });
  const jumps = [];
  for (const ordinal of [0, Math.floor(count / 2), Math.max(0, count - 100)]) {
    const started = performance.now();
    await client.readContextPageAtOrdinal({ contextToken: context.contextToken, ordinal, limit: 100 });
    jumps.push(performance.now() - started);
  }
  await client.releaseContext(context.contextToken);
  return {
    commonQueryFirstPageP95Ms: p95(firstPageSamples),
    rareSearchFirstPageP95Ms: p95(rareSearchSamples),
    arbitraryJumpMaxMs: Math.max(...jumps)
  };
}

async function runMixedAudioWorklet(client, seconds) {
  const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('AudioContext is unavailable on the reference browser');
  const context = new AudioContextConstructor({ latencyHint: 'interactive' });
  await context.audioWorklet.addModule('/plugins/audio-processor.js');
  const worklet = new AudioWorkletNode(context, 'plugin-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2]
  });
  const source = new ConstantSourceNode(context, { offset: 0.001 });
  const muted = new GainNode(context, { gain: 0 });
  const failureObserver = observeAudioWorkletFailures(worklet);
  source.connect(worklet).connect(muted).connect(context.destination);
  source.start();
  await context.resume();

  const wallStarted = performance.now();
  const contextStarted = context.currentTime;
  const querySamples = [];
  try {
    while (performance.now() - wallStarted < seconds * 1_000) {
      const started = performance.now();
      const page = await client.queryTracks({ query: 'Needle', sort: 'title', direction: 'asc', limit: 100 });
      querySamples.push(performance.now() - started);
      await client.releaseContext(page.contextToken);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  } finally {
    source.stop();
    source.disconnect();
    worklet.disconnect();
    muted.disconnect();
  }
  const wallSeconds = (performance.now() - wallStarted) / 1_000;
  const contextSeconds = context.currentTime - contextStarted;
  const state = context.state;
  await context.close();
  failureObserver.dispose();
  return {
    measured: true,
    measurementSeconds: wallSeconds,
    contextTimelineSeconds: contextSeconds,
    timelineRatio: wallSeconds > 0 ? contextSeconds / wallSeconds : 0,
    stateDuringMeasurement: state,
    mixedQueryP95Ms: p95(querySamples),
    workletErrorCount: failureObserver.failures.length
  };
}

export async function runReferenceBrowserMeasurement(options) {
  const { count, seed, digest, samples, audioWorkletSeconds } = options;
  let client = createReferenceClient();
  await client.resetCatalog();
  const open = await client.open({ mode: 'readwrite' });
  const fixtureLoadMs = await seedCatalog(client, { count, seed });
  const counts = await client.getCounts();
  await client.close();

  const firstRowSamples = [];
  for (let index = 0; index < samples; index += 1) {
    client = createReferenceClient();
    const started = performance.now();
    await client.open({ mode: 'readwrite' });
    const firstPage = await client.queryTracks({ query: '', sort: 'title', direction: 'asc', limit: 100 });
    firstRowSamples.push(performance.now() - started);
    await client.releaseContext(firstPage.contextToken);
    if (index < samples - 1) await client.close();
  }
  try {
    const metrics = await measureCatalog(client, { count, samples });
    const audioWorklet = await runMixedAudioWorklet(client, audioWorkletSeconds);
    return {
      web: {
        adapterId: 'web-catalog-worker-v2',
        production: true,
        fixture: { count, seed, digest },
        runtime: {
          backend: open.backend,
          userAgent: navigator.userAgent
        },
        metrics: { fixtureLoadMs, libraryFirstRowP95Ms: p95(firstRowSamples), ...metrics },
        assertions: { catalogTrackCount: Number(counts.tracks) }
      },
      audioWorklet: {
        adapterId: 'plugin-processor-audio-worklet-v1',
        production: true,
        fixture: { count, seed, digest },
        ...audioWorklet
      }
    };
  } finally {
    await client.close();
  }
}
