import { Worker } from 'node:worker_threads';
import { createSf2Fixture } from './sf2-fixture.mjs';
import { openSf2Source } from '../../js/sf2/source.js';
import { prepareSoundFontBank } from '../../js/sf2/asset.js';

export function createSampleWorkerPool() {
  const threads = new Set();
  const workerEntry = new URL('../../js/sfz/sample-stream-worker.js', import.meta.url).href;
  const workerFactory = () => {
    const thread = new Worker(`const {parentPort}=require('node:worker_threads'); import(${JSON.stringify(workerEntry)}).then(({attachSfzSampleStreamWorker})=>{const endpoint={postMessage:(...args)=>parentPort.postMessage(...args)};attachSfzSampleStreamWorker(endpoint);parentPort.on('message',data=>endpoint.onmessage({data}));});`, { eval: true });
    threads.add(thread); thread.once('exit', () => threads.delete(thread));
    const adapter = { postMessage: (...args) => thread.postMessage(...args), terminate: () => thread.terminate() };
    thread.on('message', data => adapter.onmessage?.({ data })); thread.on('error', error => adapter.onerror?.(error));
    return adapter;
  };
  return { workerFactory, async close() { await Promise.all([...threads].map(thread => thread.terminate())); } };
}

export async function createSf2RuntimeFixture({ resident = false, loopStart = 16384, loopEnd = 24576,
  sampleFrames = 32768, latePage = 4 } = {}) {
  const pcm16 = Int16Array.from({ length: sampleFrames }, (_, frame) => Math.round(16000 * Math.sin(2 * Math.PI * frame / 64)));
  const bytes = createSf2Fixture({ sampleFrames: pcm16.length, sampleRate: 48000, loopStart, loopEnd,
    // Quiet presets sound 120 cB down after the Standard 0.4 attenuation-generator factor.
    pcm16, keyRange: [48, 96], presets: [{ name: 'Bright', bank: 0, program: 0, attenuation: 0 },
      { name: 'Quiet', bank: 1, program: 1, attenuation: 300 },
      { name: 'Drum Bright', bank: 128, program: 0, attenuation: 0 },
      { name: 'Drum Quiet', bank: 128, program: 1, attenuation: 300 }],
    modulators: [{ source: 13, destination: 48, amount: 120 }, { source: 10, destination: 48, amount: 120 }] });
  let sampleOffset = Infinity, lateRead = null;
  const reader = { size: bytes.length, revision: 'authored-runtime-fixture',
    async readRange(offset, length) {
      if (lateRead && offset + length > sampleOffset + latePage * 4096 * 2 &&
          offset < sampleOffset + pcm16.length * 2) {
        lateRead.waiting = true;
        await lateRead.failed;
      }
      return new Uint8Array(bytes.subarray(offset, offset + length));
    } };
  const source = await openSf2Source(reader), workers = createSampleWorkerPool();
  sampleOffset = source.parsed.smplOffset;
  try {
    const { descriptor } = await prepareSoundFontBank({ id: 'a'.repeat(24), source, maxBytes: 8 * 1024 * 1024 },
      { workerFactory: workers.workerFactory, persistentCache: null });
    if (resident) {
      const factory = descriptor.sampleProviderFactory;
      descriptor.sampleProviderFactory = async options => {
        const provider = await factory(options);
        try {
          await provider.preload(source.samples.flatMap((sample, index) =>
            Array.from({ length: Math.ceil(sample.frames / 4096) }, (_, pageIndex) => ({ sample: index, pageIndex }))));
          return provider;
        } catch (error) { provider.close(); throw error; }
      };
    }
    return { source, descriptor,
      blockLateReads() {
        let fail, release;
        const failed = new Promise((resolve, reject) => { release = resolve; fail = reject; });
        lateRead = { failed, fail, release, waiting: false };
      },
      releaseLateReads() { const pending = lateRead; lateRead = null; pending?.release(); },
      get lateReadWaiting() { return lateRead?.waiting === true; },
      failLateRead() { if (lateRead?.waiting) lateRead.fail(Object.assign(new Error('Authored late source read failed'), { code: 'sample-read' })); },
      async close() {
        if (lateRead?.waiting) lateRead.fail(Object.assign(new Error('Fixture closed'), { code: 'sample-cancelled' }));
        await workers.close();
      } };
  } catch (error) { await workers.close(); throw error; }
}
