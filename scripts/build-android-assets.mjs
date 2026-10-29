import { createRequire } from 'node:module';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadParamSpecs } from './gen-dsp-params.mjs';
import * as parameterPackers from '../js/audio/dsp-params.generated.js';
import { buildAndroidTemporalContract } from './android-temporal-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { collectPrecacheUrls } = require('./generate-sw-precache.js');
const destination = path.join(root, 'out', 'android', 'assets', 'web');
await rm(destination, { recursive: true, force: true });
const inputs = new Set(collectPrecacheUrls(root).filter(file => !['sw.js', 'manifest.json'].includes(file)));

// Measurement pages and help are bundled in addition to the established PWA
// runtime inventory. Restrict discovery to these public asset directories.
async function includeDirectory(relative) {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
        const name = `${relative}/${entry.name}`;
        if (entry.isDirectory()) await includeDirectory(name);
        else if (/\.(?:html|md|css|js|mjs|json5?|png|jpg|svg|woff2|txt)$/i.test(name)) inputs.add(name);
    }
}
await includeDirectory('features/measurement');
await includeDirectory('docs');
for (const file of [...inputs].sort()) {
    const output = path.join(destination, file);
    await mkdir(path.dirname(output), { recursive: true });
    await cp(path.join(root, file), output);
}
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const names = {};
for (const line of (await readFile(path.join(root, 'plugins/plugins.txt'), 'utf8')).split(/\r?\n/)) {
    const match = line.match(/^[^:#]+:\s*([^|]+)\|[^|]+\|\s*(\w+)/);
    if (match) names[match[2]] = match[1].trim();
}
const specs = loadParamSpecs();
const musicImport = "const { MAX_QUEUE } = require('./network-music-host.cjs');";
const musicExport = 'module.exports = { MUSIC_OPS, dispatchMusic, projectPlayback, projectBrowse, projectDevices };';
let musicProtocol = await readFile(path.join(root, 'electron/remote-music-dispatcher.cjs'), 'utf8');
if (musicProtocol.split(musicImport).length !== 2 || musicProtocol.split(musicExport).length !== 2) {
    throw new Error('The shared music dispatcher module boundaries changed. Update the Android asset adapter.');
}
musicProtocol = musicProtocol.replace(musicImport, `const MAX_QUEUE = ${require('../electron/network-music-host.cjs').MAX_QUEUE};`)
    .replace(musicExport, 'export { MUSIC_OPS, dispatchMusic, projectPlayback, projectBrowse, projectDevices };');
await mkdir(path.join(destination, 'js/android'), { recursive: true });
await writeFile(path.join(destination, 'js/android/remote-music-protocol.js'), musicProtocol);
await mkdir(path.join(root, 'out/android/assets/licenses'), { recursive: true });
await cp(path.join(root, 'dsp/vendor/pffft/LICENSE.txt'), path.join(root, 'out/android/assets/licenses/pffft-LICENSE.txt'));
const temporal = await buildAndroidTemporalContract(root, specs);
await writeFile(path.join(destination, 'android-dsp-contract.json'), JSON.stringify({ specs, names, temporal: temporal.policies }) + '\n');
await writeFile(path.join(destination, 'android-temporal-fixtures.json'), JSON.stringify(temporal.fixtures) + '\n');
// Compare Android's generic schema reader against the actual generated browser
// packers, including enums, arrays, object arrays and structured Matrix routes.
const fixtures = [];
for (const spec of specs) {
    const changed = {};
    for (const field of spec.fields) {
        for (let index = 0; index < field.count; index++) {
            const value = field.kind === 'enum' ? field.values.at(-1)
                : field.kind === 'bool' ? !field.defaults[index]
                    : field.max ?? field.min ?? field.defaults[index];
            if (field.objectArrayKey) {
                changed[field.objectArrayKey] ??= [];
                changed[field.objectArrayKey][index] ??= {};
                changed[field.objectArrayKey][index][field.memberKey] = value;
            } else if (field.arrayKey) {
                changed[field.arrayKey] ??= [];
                changed[field.arrayKey][index] = value;
            } else changed[field.keys[index]] = value;
        }
    }
    if (spec.structured) changed.mx = '00p0110p11';
    for (const [name, parameters] of [['defaults', {}], ['changed', changed]]) {
        const bytes = parameterPackers[`pack${spec.type}ParamBytes`]?.(parameters);
        fixtures.push({ type: spec.type, name, parameters,
            floats: [...parameterPackers[`pack${spec.type}Params`](parameters)],
            bytes: bytes ? Buffer.from(bytes).toString('base64') : '' });
    }
}
await writeFile(path.join(destination, 'android-packing-fixtures.json'), JSON.stringify(fixtures) + '\n');
const automationKinds = new Map();
for (const descriptor of Object.values(parameterPackers.DSP_AUTOMATION_CATALOG).flat()) {
    const kind = [descriptor.normalization, descriptor.transform, !!descriptor.containerKey, !!descriptor.memberKey].join(':');
    if (!automationKinds.has(kind)) automationKinds.set(kind, descriptor);
}
await writeFile(path.join(destination, 'android-automation-fixtures.json'), JSON.stringify(
    [...automationKinds.values()].map(descriptor => ({ descriptor, values: [0, 0.25, 0.5, 0.75, 1].map(normalized => ({
        normalized, plain: parameterPackers.denormalizeDSPAutomationValue(descriptor, normalized)
    })) }))
) + '\n');
await writeFile(path.join(destination, 'android-assets.json'), JSON.stringify({
    version: packageJson.version,
    files: [...inputs].sort()
}, null, 2) + '\n');
console.log(`Bundled ${inputs.size} Android assets for EffeTune ${packageJson.version}.`);
