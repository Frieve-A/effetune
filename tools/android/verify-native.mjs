import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeNativeControl, runWasmCase } from '../dsp-parity/runners.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const serial = process.env.ANDROID_SERIAL;
const nativeDirectory = process.env.ANDROID_NATIVE_DIR;
const sdk = process.env.ANDROID_HOME;
assert(serial && nativeDirectory && sdk, 'Set ANDROID_SERIAL, ANDROID_HOME and ANDROID_NATIVE_DIR.');
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const remote = '/data/local/tmp/effetune-native-acceptance';
const output = path.join(root, 'out/android/acceptance', serial.replace(/[^a-zA-Z0-9_-]/g, '_'));
await fs.mkdir(output, { recursive: true });
function run(...args) {
    return execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 60_000 });
}
run('shell', 'mkdir', '-p', remote);
for (const file of ['android_runtime_test', 'android_dsp_parity', 'libc++_shared.so', 'liboboe.so']) {
    run('push', path.join(nativeDirectory, file), `${remote}/${file}`);
}
run('shell', 'chmod', '755', `${remote}/android_runtime_test`, `${remote}/android_dsp_parity`);
console.log(run('shell', `LD_LIBRARY_PATH=${remote} ${remote}/android_runtime_test`).trim());
const results = [];
const targets = process.argv.includes('--all')
    ? [...(await fs.readFile(path.join(root, 'dsp/registry.inc'), 'utf8')).matchAll(/^EFFETUNE_PLUGIN\((\w+), ([\w/]+)\)$/gm)].map(match => [match[1], match[2]])
    : [
    ['VolumePlugin', 'basics/volume'],
    ['PolarityInversionPlugin', 'basics/polarity_inversion'],
    ['DelayPlugin', 'delay/delay'],
    ['OscillatorPlugin', 'others/oscillator']
];
targets.push(
    ['IRReverbPlugin', 'reverb/ir_reverb', { name: 'synthetic-ir', params: { lt: '0', cr: 'full', dw: 0, de: false },
        asset: { channels: 1, frames: 256, topology: 1, headBlock: 0, rateDivider: 1, ir: { kind: 'sparse-decay-v1', tapCount: 7 } } }],
    ['SFZNotePlayerPlugin', 'others/sfz_note_player', { name: 'synthetic-sfz', params: { pm: 83, pv: 100 },
        asset: { sfz: { kind: 'sfz-sine-v1' } } }]
);
for (const [type, directory, settings = {}] of targets) {
    const schema = JSON.parse(await fs.readFile(path.join(root, 'dsp/plugins', directory, 'params.json'), 'utf8'));
    const testCase = { sampleRate: 48000, channels: 2, frames: 8192, blockSize: 128, seed: 0xeffe7a5en, params: {}, events: [], ...settings };
    const name = settings.name ?? 'defaults';
    const input = new Float32Array(testCase.frames * 2);
    for (let channel = 0; channel < 2; channel++) {
        for (let frame = 0; frame < testCase.frames; frame++) input[channel * testCase.frames + frame] = Math.sin(frame * 0.0575959) * (channel ? 0.125 : 0.25);
    }
    const controlFile = path.join(output, `${type}.${name}.etpc`);
    const inputFile = path.join(output, `${type}.${name}.input.f32`);
    const outputFile = path.join(output, `${type}.${name}.android.f32`);
    await fs.writeFile(controlFile, encodeNativeControl(schema, testCase));
    await fs.writeFile(inputFile, new Uint8Array(input.buffer));
    run('push', controlFile, `${remote}/case.etpc`);
    run('push', inputFile, `${remote}/input.f32`);
    run('shell', `LD_LIBRARY_PATH=${remote} ${remote}/android_dsp_parity --type ${type} --control ${remote}/case.etpc --input ${remote}/input.f32 --output ${remote}/output.f32 --seed-low 4026432094 --seed-high 0`);
    run('pull', `${remote}/output.f32`, outputFile);
    const actual = await fs.readFile(outputFile);
    const expected = await runWasmCase({ type, schema, testCase, input });
    assert.equal(actual.length, expected.length * 4);
    let maximumError = 0;
    for (let i = 0; i < expected.length; i++) maximumError = Math.max(maximumError, Math.abs(actual.readFloatLE(i * 4) - expected[i]));
    assert(maximumError <= (schema.tolerance?.abs ?? 0.000001), `${type}: Android/WASM maximum error ${maximumError}`);
    results.push({ type, name, frames: testCase.frames, maximumError });
    console.log(`${type}/${name}: max error ${maximumError}`);
    globalThis.gc?.();
}
await fs.writeFile(path.join(output, 'native-parity.json'), JSON.stringify({ serial, results }, null, 2) + '\n');
console.log(`Passed ${results.length} Android/WASM cases; maximum error ${Math.max(...results.map(result => result.maximumError))}.`);
