import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSfz } from '../js/sfz/parser.js';
import { packSfzAsset } from '../js/sfz/asset.js';
import { createSfzGeneratorSample } from '../js/sfz/generators.js';
import { prepareSfzOscillatorSources } from '../js/sfz/oscillator-source.js';

const sounding = '<region> sample=tone.wav key=60 loop_mode=loop_continuous amp_veltrack=0 off_by=2 off_mode=fast';
export const SFZ_SENTINEL_SOURCES = Object.freeze({
    CCOnly: '<region> sample=tone.wav key=-1 on_locc64=127 on_hicc64=127 amp_veltrack=0',
    MuteCC: `${sounding} <region> key=-1 end=-1 sample=*silence group=2 on_locc64=127 on_hicc64=127`,
    MuteNote: `${sounding} <region> key=61 end=-1 sample=*silence group=2`,
    SilentOnly: '<region> key=-1 end=-1 sample=*silence group=2 on_locc64=127 on_hicc64=127'
});

export async function createSfzSentinelFixture(name) {
    const source = SFZ_SENTINEL_SOURCES[name];
    assert.equal(typeof source, 'string');
    let parsed = await parseSfz({ selectedPath: 'sentinel.sfz', readText: async () => source,
        hasSample: () => true, onDiagnostic: null });
    assert.deepEqual(parsed.diagnostics.invalidRegions, [], name);
    assert.deepEqual(parsed.unsupportedOpcodes, [], name);
    const samples = new Map([['tone.wav', { sampleRate: 48000, channels: [new Float32Array(64).fill(.25)] }],
        ['*silence', createSfzGeneratorSample('*silence')]]);
    const residentBytes = [...samples.values()].reduce((total, pcm) =>
        total + pcm.channels.reduce((bytes, channel) => bytes + channel.byteLength, 0), 0);
    const prepared = await prepareSfzOscillatorSources(parsed, async sample => samples.get(sample),
        64 * 1024 * 1024, { residentBytes });
    parsed = prepared.parsed;
    for (const [sample, pcm] of prepared.samples) samples.set(sample, pcm);
    return { source, parsed, ...packSfzAsset(parsed.regions, samples, { modulation: parsed.modulation }) };
}

export async function generateSfzSentinelFixture({ check = false } = {}) {
    const declarations = [];
    for (const name of Object.keys(SFZ_SENTINEL_SOURCES)) {
        const asset = await createSfzSentinelFixture(name), bytes = new Uint8Array(asset.payload), lines = [];
        for (let index = 0; index < bytes.length; index += 24)
            lines.push(`  ${[...bytes.subarray(index, index + 24)].join(', ')},`);
        declarations.push(`inline constexpr char kSentinel${name}Source[] = R"SFZ(${asset.source})SFZ";\n` +
            `inline constexpr std::uint32_t kSentinel${name}Footprint = ${asset.footprintBytes}u;\n` +
            `inline constexpr std::array<std::uint8_t, ${bytes.length}> kSentinel${name}Payload{\n${lines.join('\n')}\n};`);
    }
    const output = '#pragma once\n#include <array>\n#include <cstdint>\n' +
        '// Generated from authored sources by tools/generate-sfz-sentinel-fixture.mjs.\n' +
        '// clang-format off\n' + declarations.join('\n') + '\n// clang-format on\n';
    const destination = new URL('../dsp/plugins/others/soundfont_player/sentinel_fixture.h', import.meta.url);
    if (check) assert.equal((await fs.readFile(destination, 'utf8')).replaceAll('\r\n', '\n'), output);
    else await fs.writeFile(destination, output);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
    await generateSfzSentinelFixture({ check: process.argv.includes('--check') });
