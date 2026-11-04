import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSfzRegionSentinels } from '../../js/sfz/region-sentinels.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { prepareSfzSamples } from '../../js/sfz/service.js';
import { SFZ_REGION_FIELDS } from '../../js/sfz/asset.js';
import { SFZ_MOD_PROPERTY_IDS } from '../../js/sfz/modulation-schema.js';
import { AudioEncoder } from '../../js/audio/audio-encoder.js';
import { generateSfzSentinelFixture } from '../../tools/generate-sfz-sentinel-fixture.mjs';

test('sentinel normalization preserves authored identity and harmless prepared geometry', () => {
    const opcodes = { key: '-1', lokey: '-1', hikey: '-1', pitch_keycenter: '-1', end: '-1', sample: 'unused.wav' };
    const region = { opcodes, lokey: -1, hikey: -1, pitch_keycenter: -1, end: -1, sample: 'unused.wav' };
    assert.deepEqual(normalizeSfzRegionSentinels(region), { noteEnabled: false, silentAction: true });
    assert.deepEqual(opcodes, { key: '-1', lokey: '-1', hikey: '-1', pitch_keycenter: '-1', end: '-1', sample: 'unused.wav' });
    assert.equal(region.sample, '*silence');
    assert.deepEqual([region.lokey, region.hikey, region.pitch_keycenter, region.end, region.offset, region.loop_mode], [0, 127, 60, 0, 0, 0]);
    const restored = { opcodes: { key: '-1', lokey: '20', hikey: '40' }, lokey: 20, hikey: 40, pitch_keycenter: -1 };
    assert.equal(normalizeSfzRegionSentinels(restored).noteEnabled, true);
    assert.deepEqual([restored.lokey, restored.hikey, restored.pitch_keycenter], [20, 40, 60]);
});

test('normal producer accepts CC-only and silent choke regions without reading silent source files', async () => {
    const source = '<region> sample=pedal.wav key=-1 on_locc64=127 on_hicc64=127 ' +
        '<region> sample=unneeded.wav key=-1 end=-1 group=2 on_locc64=127 on_hicc64=127';
    const checked = [];
    const parsed = await parseSfz({ selectedPath: 'instrument.sfz', readText: async () => source,
        hasSample: path => { checked.push(path); return path === 'pedal.wav'; }, onDiagnostic: null });
    assert.equal(parsed.regions.length, 2);
    assert.deepEqual(checked, ['pedal.wav']);
    assert.deepEqual(parsed.diagnostics.invalidRegions, []);
    assert.equal(parsed.source.trim(), source);
    for (const region of parsed.modulation.regions)
        assert.ok(region.parameters.some(parameter => parameter.property === SFZ_MOD_PROPERTY_IDS.NoteEnabled && parameter.value === 0));
    assert.ok(parsed.modulation.regions[1].parameters.some(parameter =>
        parameter.property === SFZ_MOD_PROPERTY_IDS.SilentAction && parameter.value === 1));
    const pcm = new Float32Array(32).fill(.25);
    const wave = new Uint8Array(await new AudioEncoder().encodeWav({ numberOfChannels: 1,
        length: pcm.length, sampleRate: 48000, getChannelData: () => pcm }, 'float32').arrayBuffer());
    const reads = [];
    const prepared = await prepareSfzSamples(parsed, async path => {
        reads.push(path); assert.equal(path, 'pedal.wav'); return wave;
    }, async () => ({ sampleRate: 48000, channels: [new Float32Array(32).fill(.25)] }), 2 * 1024 * 1024, null);
    assert.deepEqual(reads, ['pedal.wav']);
    const words = new Uint32Array(prepared.descriptor.payload, 32);
    const end = SFZ_REGION_FIELDS.indexOf('end');
    assert.equal(words[12 + SFZ_REGION_FIELDS.length + end], 0, 'silent action does not encode unsigned minus one');
});

test('native sentinel fixtures retain normal parser and asset provenance', async () => {
    await generateSfzSentinelFixture({ check: true });
});

test('later complete key range restores note eligibility without inventing partial sentinel ranges', async () => {
    const parsed = await parseSfz({ selectedPath: 'instrument.sfz', onDiagnostic: null,
        readText: async () => '<region> sample=tone.wav key=-1 lokey=20 hikey=40 ' +
            '<region> sample=tone.wav key=-1 lokey=20' });
    assert.equal(parsed.regions.length, 1);
    assert.equal(parsed.diagnostics.invalidRegions.length, 1);
    assert.deepEqual([parsed.regions[0].lokey, parsed.regions[0].hikey, parsed.regions[0].pitch_keycenter], [20, 40, 60]);
    assert.ok(parsed.modulation.regions[0].parameters.some(parameter =>
        parameter.property === SFZ_MOD_PROPERTY_IDS.NoteEnabled && parameter.value === 1));
});
