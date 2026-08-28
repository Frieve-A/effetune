import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { programSignal, renderPreset } from '../../tools/preset-render-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginRoot = path.join(repoRoot, 'plugins');
const excludedParameterKeys = new Set(['type', 'enabled', 'fr', 'en']);
const forbiddenPresetKeys = new Set(['id', 'enabled', 'fr', 'en', 'ib', 'ob', 'ch']);

const expectedTargetPresetIds = new Map([
    ['VinylSimulatorPlugin', [
        'audiophile-pressing', 'well-worn-favorite', 'flea-market-45',
        'shellac-78', 'end-of-side'
    ]],
    ['VinylArtifactsPlugin', [
        'gentle-patina', 'thrift-store-copy', 'rumbly-old-player'
    ]],
    ['CassetteArtifactsPlugin', [
        'flagship-deck-metal', 'hifi-chrome', 'pocket-cassette-player',
        'worn-mixtape', 'hot-deck-saturation'
    ]],
    ['TapeArtifactsPlugin', [
        'pristine-30-ips-reel', 'hobbyist-reel-to-reel', 'tired-old-reel'
    ]],
    ['AMRadioSimulatorPlugin', [
        'local-daytime', 'pocket-transistor', 'night-skywave',
        'summer-thunderstorm', 'stereo-am-broadcast'
    ]],
    ['FMRadioSimulatorPlugin', [
        'powerhouse-broadcast', 'distant-station', 'city-multipath'
    ]],
    ['SWRadioSimulatorPlugin', [
        'major-broadcaster', 'transoceanic-night', 'stormy-49m-band'
    ]],
    ['RSReverbPlugin', [
        'small-room', 'jazz-club', 'concert-hall', 'cathedral'
    ]],
    ['FDNReverbPlugin', [
        'tight-room', 'warm-hall', 'bright-plate', 'vast-cavern'
    ]],
    ['HornResonatorPlugin', ['gramophone', 'vintage-theater', 'megaphone']],
    ['HornResonatorPlusPlugin', ['gramophone', 'vintage-theater', 'megaphone']],
    ['CrossfeedFilterPlugin', [
        'subtle-blend', 'vintage-receiver', 'living-room-speakers'
    ]],
    ['DattorroPlateReverbPlugin', [
        'studio-plate', 'vocal-plate', 'dark-vintage-plate', 'long-wash'
    ]],
    ['WowFlutterPlugin', [
        'warped-record', 'worn-cassette-motor', 'seasick-tape'
    ]],
    ['PowerAmpSagPlugin', [
        'vintage-tube-sag', 'modern-monoblocks', 'pushed-combo'
    ]],
    ['EarphoneCableSimPlugin', [
        'high-impedance-source', 'long-thin-cable', 'vintage-portable-out'
    ]],
    ['ModalResonatorPlugin', [
        'wooden-body', 'metal-can', 'plastic-enclosure'
    ]],
    ['LoudnessEqualizerPlugin', [
        'late-night-listening', 'quiet-background', 'near-reference-level'
    ]],
    ['DynamicSaturationPlugin', [
        'subtle-cone-color', 'pushed-speaker', 'ragged-cone'
    ]],
    ['ChorusPlugin', [
        'classic-chorus', 'stereo-chorus', 'ensemble', 'flanger', 'jet-flanger', 'vibrato'
    ]],
    ['PhaserPlugin', [
        'classic-phaser', 'deep-phaser', 'stereo-phaser', 'barber-pole-up', 'barber-pole-down'
    ]],
    ['AutoFilterPlugin', [
        'auto-filter-sweep', 'stereo-filter-sweep', 'envelope-filter', 'auto-wah', 'reverse-auto-wah'
    ]],
    ['AutoPanPlugin', [
        'gentle-auto-pan', 'wide-auto-pan', 'fast-auto-pan'
    ]],
    ['FrequencyShifterPlugin', [
        'shift-up', 'shift-down', 'fine-detune', 'ring-modulator', 'barber-pole-up', 'barber-pole-down'
    ]],
    ['RotarySpeakerPlugin', [
        'rotary-slow', 'rotary-fast', 'gentle-rotary', 'vintage-rotor-slow', 'vintage-rotor-fast'
    ]]
]);

const defaultMatchingPresetIds = new Map([
    ['ChorusPlugin', new Set(['classic-chorus'])],
    ['PhaserPlugin', new Set(['classic-phaser'])],
    ['AutoFilterPlugin', new Set(['auto-filter-sweep'])],
    ['AutoPanPlugin', new Set(['gentle-auto-pan'])],
    ['FrequencyShifterPlugin', new Set(['shift-up'])],
    ['RotarySpeakerPlugin', new Set(['rotary-slow'])]
]);

class FakeObserver {
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
}

const documentStub = {
    body: {},
    documentElement: {},
    createElement: () => ({
        addEventListener() {},
        appendChild() {},
        classList: { add() {}, contains() { return false; }, toggle() {} },
        getContext() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        setAttribute() {},
        style: { setProperty() {} }
    }),
    querySelector() { return null; },
    querySelectorAll() { return []; }
};

const sandbox = {
    window: {},
    console,
    document: documentStub,
    MutationObserver: FakeObserver,
    IntersectionObserver: FakeObserver,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout
};
sandbox.window.window = sandbox.window;
sandbox.window.document = documentStub;

const pluginEntries = (await fs.readFile(path.join(pluginRoot, 'plugins.txt'), 'utf8'))
    .split(/\r?\n/)
    .map(line => /^([^#\s][^:]*):\s*[^|]+\|\s*[^|]+\|\s*([^|\s]+)/.exec(line))
    .filter(Boolean)
    .map(([, relativePath, className]) => ({
        className,
        relativePath: `${relativePath.trim()}.js`
    }));

const context = vm.createContext(sandbox);
const pluginBaseSource = await fs.readFile(path.join(pluginRoot, 'plugin-base.js'), 'utf8');
vm.runInContext(pluginBaseSource, context, { filename: 'plugins/plugin-base.js' });

const presetProviders = [];
for (const entry of pluginEntries) {
    const source = await fs.readFile(path.join(pluginRoot, entry.relativePath), 'utf8');
    if (!source.includes('getSystemPresetGroups')) continue;

    vm.runInContext(source, context, { filename: `plugins/${entry.relativePath}` });
    const Plugin = context.window[entry.className];
    assert.equal(typeof Plugin, 'function', `${entry.className} must register on window`);
    presetProviders.push({ ...entry, Plugin });
}

const cloneParams = params => structuredClone(params);
const publicParameterKeys = plugin => Object.keys(plugin.getSerializableParameters())
    .filter(key => !excludedParameterKeys.has(key))
    .sort();

test('plugin system presets have complete, valid, round-trippable parameter records', () => {
    assert.equal(presetProviders.length, 26, 'system preset provider count');
    const targetPresetCount = [...expectedTargetPresetIds.values()]
        .reduce((count, ids) => count + ids.length, 0);
    assert.equal(targetPresetCount, 96);

    const providersByClass = new Map(presetProviders.map(provider => [provider.className, provider]));
    for (const [className, expectedIds] of expectedTargetPresetIds) {
        assert.ok(providersByClass.has(className), `${className} must expose system presets`);
        const Plugin = providersByClass.get(className).Plugin;
        const groups = Plugin.getSystemPresetGroups();
        assert.equal(groups.length, 1, `${className} system preset group count`);
        assert.equal(groups[0].label, '', `${className} single group must not show a heading`);
        const presets = Array.from(groups, group => Array.from(group.presets)).flat();
        assert.deepEqual(presets.map(preset => preset.id), expectedIds, `${className} preset ids`);
    }

    for (const { className, Plugin } of presetProviders) {
        const groups = Plugin.getSystemPresetGroups();
        assert.ok(Array.isArray(groups), `${className} groups must be an array`);

        const presets = [];
        for (const group of groups) {
            assert.deepEqual(Object.keys(group).sort(), ['label', 'presets'],
                `${className} group shape`);
            assert.equal(typeof group?.label, 'string', `${className} group label`);
            assert.ok(Array.isArray(group?.presets), `${className} group presets`);
            presets.push(...group.presets);
        }

        const ids = new Set();
        const parameterRecords = new Set();
        const isNewTarget = expectedTargetPresetIds.has(className);
        const defaultPlugin = new Plugin();
        const expectedKeys = publicParameterKeys(defaultPlugin);
        const defaultParameters = defaultPlugin.getParameters();

        for (const preset of presets) {
            assert.deepEqual(Object.keys(preset).sort(), ['id', 'label', 'params'],
                `${className} preset shape`);
            assert.equal(typeof preset?.id, 'string', `${className} preset id`);
            assert.match(preset.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${className} ${preset.id}`);
            assert.equal(ids.has(preset.id), false, `${className} duplicate id ${preset.id}`);
            ids.add(preset.id);

            assert.equal(typeof preset?.label, 'string', `${className} ${preset.id} label`);
            assert.ok(preset.label.length > 0, `${className} ${preset.id} label must not be empty`);
            if (isNewTarget) {
                assert.match(preset.label, /^[\x20-\x7e]+$/, `${className} ${preset.id} English label`);
            }

            assert.ok(preset?.params && typeof preset.params === 'object' &&
                !Array.isArray(preset.params), `${className} ${preset.id} params`);
            for (const key of Object.keys(preset.params)) {
                assert.equal(forbiddenPresetKeys.has(key), false,
                    `${className} ${preset.id} contains forbidden key ${key}`);
            }

            const parameterRecord = JSON.stringify(preset.params);
            assert.equal(parameterRecords.has(parameterRecord), false,
                `${className} ${preset.id} duplicates another parameter record`);
            parameterRecords.add(parameterRecord);

            if (isNewTarget) {
                assert.deepEqual(Object.keys(preset.params).sort(), expectedKeys,
                    `${className} ${preset.id} parameter keys`);
                const matchesDefaults = expectedKeys.every(key =>
                    isDeepStrictEqual(preset.params[key], defaultParameters[key]));
                assert.equal(matchesDefaults && !defaultMatchingPresetIds.get(className)?.has(preset.id), false,
                    `${className} ${preset.id} must differ from defaults`);
            }

            const plugin = new Plugin();
            plugin.setParameters(cloneParams(preset.params));
            const applied = plugin.getParameters();
            for (const [key, value] of Object.entries(preset.params)) {
                assert.deepEqual(applied[key], value,
                    `${className} ${preset.id} failed to round-trip ${key}`);
            }
        }
    }
});

test('preset renderer applies processing-only presets through the selected system preset path', async () => {
    const processingTypes = [
        'AMRadioSimulatorPlugin',
        'FMRadioSimulatorPlugin',
        'SWRadioSimulatorPlugin',
        'VinylSimulatorPlugin',
        'TubeSimulatorPlugin'
    ];
    const providersByClass = new Map(presetProviders.map(provider => [provider.className, provider]));
    const frames = 128;
    const stimulus = programSignal(frames);

    for (const type of processingTypes) {
        const provider = providersByClass.get(type);
        assert.ok(provider, `${type} must expose system presets`);
        const preset = provider.Plugin.getSystemPresetGroups()[0].presets[0];
        assert.equal('fr' in preset.params, false, `${type} preset must not expose reference mode`);
        const rendered = await renderPreset(type, preset, stimulus, frames, repoRoot);
        assert.equal(rendered.backend, 'baseline-wasm', `${type} must use baseline WASM rendering`);
        assert.deepEqual(rendered.runtimeEvent, { generation: 0, latched: false, cause: 0 },
            `${type} must not demote or fault during baseline WASM rendering`);
        assert.equal(rendered.nonFiniteCount, 0, `${type} output must remain finite`);
        assert.notDeepEqual(rendered.output, stimulus, `${type} must not bypass preset rendering`);
        if (type === 'TubeSimulatorPlugin') {
            assert.equal(preset.id, 'listening-line-12at7-thd0p01');
            assert.equal(Number(preset.params.sl), 8);
            assert.equal(rendered.parameters.rl, Number(preset.params.sl),
                'Tube Simulator system preset must apply its matched speaker load');
        }
    }
});

test('preset renderer keeps partial blocks densely planar for both channels', async () => {
    const provider = presetProviders.find(entry => entry.className === 'CrossfeedFilterPlugin');
    assert.ok(provider, 'CrossfeedFilterPlugin must expose system presets');
    const preset = provider.Plugin.getSystemPresetGroups()[0].presets[0];
    const stereoSignal = frames => {
        const input = new Float32Array(frames * 2);
        input.fill(0.4, 0, frames);
        input.fill(0.1, frames);
        return input;
    };

    for (const frames of [64, 4800]) {
        const alignedFrames = Math.ceil(frames / 128) * 128;
        const actual = await renderPreset('CrossfeedFilterPlugin', preset,
            stereoSignal(frames), frames, repoRoot);
        const aligned = await renderPreset('CrossfeedFilterPlugin', preset,
            stereoSignal(alignedFrames), alignedFrames, repoRoot);
        const expected = new Float32Array(frames * 2);
        expected.set(aligned.output.subarray(0, frames));
        expected.set(aligned.output.subarray(alignedFrames, alignedFrames + frames), frames);
        assert.deepEqual(actual.output, expected,
            `${frames}-frame render must match the 128-aligned prefix in both channels`);
    }
});
