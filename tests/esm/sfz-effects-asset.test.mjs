import assert from 'node:assert/strict';
import test from 'node:test';
import { createSfzEffectsAsset } from '../helpers/sfz-effects-asset-fixture.mjs';
import { generateSfzEffectsAssetFixture } from '../../tools/generate-sfz-effects-fixture.mjs';
import { parseSfz } from '../../js/sfz/parser.js';
import { SfzLibraryService } from '../../js/sfz/service.js';
import { decodeSfzBank } from '../../js/sfz/bank.js';
import { prepareStreamedSfzBank } from '../../js/sfz/streamed-bank.js';
import { createSfzMemorySampleReader } from '../../js/sfz/sample-reader.js';
import { AudioEncoder } from '../../js/audio/audio-encoder.js';
import { createSampleWorkerPool } from '../helpers/sf2-runtime-fixture.mjs';

test('normal SFZ producer preserves v3 and emits v4 with IR-only sample geometry', async () => {
    const dry = await createSfzEffectsAsset('Dry');
    const dryWords = new Uint32Array(dry.payload, 32);
    assert.equal(dryWords[dryWords[10] + 1], 3);
    for (const name of ['Gain', 'Send', 'Aux', 'Sync', 'Impulse', 'Paged']) {
        const asset = await createSfzEffectsAsset(name);
        const words = new Uint32Array(asset.payload, 32), mod = words.subarray(words[10], words[10] + words[11]);
        assert.equal(words[1], name === 'Paged' ? 8 : 7);
        assert.equal(mod[1], 4);
        assert.equal(mod[14] + mod[15], mod.length);
        const fx = mod.subarray(mod[14]);
        assert.equal(fx[5], 22);
        if (name === 'Impulse') {
            assert.equal(fx[21], 1);
            const ir = fx.subarray(fx[20], fx[20] + 4);
            assert.deepEqual([...ir.subarray(1)], [441, 1, 44100]);
            assert.equal(new Float32Array(asset.payload, 32)[words[4] + ir[0] + 220], 1);
        }
    }
});

test('effect IR paths follow the encountered control default path', async () => {
    const parsed = await parseSfz({ selectedPath: 'bundle/instrument.sfz', onDiagnostic: null,
        readText: async () => '<control> default_path=audio/ <region> sample=tone.wav <effect> type=tdfir tdfir_impulse=room.wav' });
    assert.equal(parsed.effects.nodes[0].impulse, 'bundle/audio/room.wav');
    assert.deepEqual(parsed.unsupportedOpcodes, []);
});

test('actual native FX fixture is current with normal parser and serializer', async () => {
    await generateSfzEffectsAssetFixture({ check: true });
});

test('browser save and reopen retain IR-only dependencies and decode them again', async () => {
    const files = new Map();
    const backend = { read: async name => files.get(name) ?? null,
        writeAtomic: async (name, bytes) => { files.set(name, bytes.slice()); } };
    const service = await new SfzLibraryService(backend, { onDiagnostic: null }).open();
    const definition = new TextEncoder().encode('<region> sample=tone.wav <effect> type=tdfir tdfir_impulse=room.wav');
    const selected = [['instrument.sfz', definition], ['tone.wav', Uint8Array.of(1)],
        ['room.wav', Uint8Array.of(2)], ['unused.wav', Uint8Array.of(3)]].map(([name, bytes]) =>
        ({ name, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer }));
    const decoded = [];
    const decode = async buffer => {
        const code = new Uint8Array(buffer)[0]; decoded.push(code);
        return { sampleRate: code === 2 ? 44100 : 48000, channels: [Float32Array.of(.25, .125)] };
    };
    const entry = await service.importFolderFiles(selected, 'instrument.sfz', { decode });
    assert.deepEqual([...decodeSfzBank(files.get(`${entry.id}.sfzbank`)).files.keys()], ['instrument.sfz', 'room.wav', 'tone.wav']);
    const reopened = await new SfzLibraryService(backend, { onDiagnostic: null }).open();
    decoded.length = 0;
    const prepared = await reopened.prepare(entry.id, { decode });
    assert.deepEqual(decoded.sort(), [1, 2]);
    assert.equal(prepared.regionCount, 1);
    const words = new Uint32Array(prepared.descriptor.payload, 32);
    assert.equal(words[words[10] + 1], 4);
});

test('stream preparation pins every IR-only page through the actual sample decode worker', { timeout: 15000 }, async () => {
    const workers = createSampleWorkerPool();
    let provider;
    try {
        const readers = new Map();
        for (const [name, frames] of [['tone.wav', 64], ['room.wav', 8193]]) {
            const samples = new Float32Array(frames).fill(name === 'room.wav' ? .125 : .25);
            const blob = new AudioEncoder().encodeWav({ numberOfChannels: 1, length: frames,
                sampleRate: 48000, getChannelData: () => samples }, 'float32');
            readers.set(name, await createSfzMemorySampleReader(new Uint8Array(await blob.arrayBuffer())));
        }
        const parsed = await parseSfz({ selectedPath: 'instrument.sfz', onDiagnostic: null,
            readText: async () => '<region> sample=tone.wav <effect> type=tdfir tdfir_impulse=room.wav' });
        const prepared = await prepareStreamedSfzBank({ id: 'e'.repeat(24), parsed, maxBytes: 2 * 1024 * 1024,
            createSampleReader: path => readers.get(path) }, { workerFactory: workers.workerFactory, persistentCache: null });
        const pages = [];
        provider = await prepared.descriptor.sampleProviderFactory({ generation: 1, publish: page => pages.push(page) });
        const impulsePages = pages.filter(page => page.sample === 0);
        assert.deepEqual(impulsePages.map(page => [page.pageIndex, page.frames, page.resident]),
            [[0, 4096, true], [1, 4096, true], [2, 1, true]]);
        assert.ok(impulsePages.every(page => page.pcm.every(value => value === .125)));
        assert.equal(pages.some(page => page.sample === 1), false, 'ordinary sample pages stay demand-loaded');
        await provider.requestPages([{ sample: 1, pageIndex: 0, generation: 1, resident: false }]);
        assert.ok(pages.some(page => page.sample === 1 && page.pageIndex === 0 && !page.resident &&
            page.pcm.every(value => value === .25)));
    } finally { provider?.close(); await workers.close(); }
});
