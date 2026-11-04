import assert from 'node:assert/strict';
import { parseSfz } from '../../js/sfz/parser.js';
import { packSfzAsset, packStreamedSfzAsset } from '../../js/sfz/asset.js';

const region = '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 ampeg_release=.001';
const delay = 'type=delay delay_timel=.001 delay_timec=.001 delay_timer=.001 delay_dry=0';
export const SFZ_EFFECT_ASSET_SOURCES = Object.freeze({
    Dry: region,
    Gain: `${region} <effect> type=comp comp_ratio=1 comp_threshold=0 comp_attack=0 comp_release=0 comp_gain_oncc7=12`,
    Send: `${region} effect1=50 <effect> bus=fx1 ${delay} fx1tomain=100`,
    Aux: `${region} output=1 <effect> bus=aux1 type=comp comp_ratio=1 comp_gain=6`,
    Sync: `${region} <effect> ${delay} delay_syncl=.002 delay_syncc=.002 delay_syncr=.002`,
    Impulse: `${region} <effect> type=tdfir tdfir_impulse=impulse.wav tdfir_dry=0`,
    Paged: `${region} effect1=50 <effect> bus=fx1 ${delay} fx1tomain=100`
});

export function sfzEffectsFixtureSamples() {
    const impulse = new Float32Array(441);
    impulse[220] = 1;
    return new Map([
        ['constant.wav', { channels: [new Float32Array(64).fill(.25)], sampleRate: 48000 }],
        ['impulse.wav', { channels: [impulse], sampleRate: 44100 }]
    ]);
}

export async function createSfzEffectsAsset(name) {
    const source = SFZ_EFFECT_ASSET_SOURCES[name];
    assert.equal(typeof source, 'string');
    const parsed = await parseSfz({ selectedPath: 'fixture.sfz', readText: async () => source,
        hasSample: () => true, onDiagnostic: null });
    assert.deepEqual(parsed.unsupportedOpcodes, [], `${name}: unsupported fixture`);
    if (name !== 'Dry') assert.ok(parsed.effects, `${name}: normal parser must produce the effect plan`);
    const options = { modulation: parsed.modulation, effects: parsed.effects };
    const asset = name === 'Paged' ? packStreamedSfzAsset(parsed.regions,
        new Map([['constant.wav', { frames: 16384, channels: 1, sampleRate: 48000, revision: 'a'.repeat(64) }]]),
        { ...options, cacheSlots: 4 }) : packSfzAsset(parsed.regions, sfzEffectsFixtureSamples(), options);
    return { ...asset, source, parsed };
}
