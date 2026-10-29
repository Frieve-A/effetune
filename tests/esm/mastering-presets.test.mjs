import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { PresetManager } from '../../js/preset-manager.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { loadReferencePlugin } from '../../tools/dsp-parity/node-host.mjs';

const root = new URL('../../', import.meta.url);

test('Mastering catalog loads unchanged parameters and renders complete stereo chains', async t => {
    const manager = new PresetManager();
    const catalog = manager.parsePresetsDefinition(await fs.readFile(new URL('presets/presets.txt', root), 'utf8'));
    const names = catalog.categories.Mastering.presets;
    assert.equal(names.length, 10);
    const results = new Map();
    for (const name of names) {
        await t.test(name, async () => {
            const definition = catalog.presetDefinitions.get(name);
            const { pipeline } = JSON.parse(await fs.readFile(new URL(`${definition.path}.effetune_preset`, root), 'utf8'));
            assert.equal(pipeline.at(-1).name, 'Brickwall Limiter');
            const binding = await instantiateDsp(await fs.readFile(new URL('plugins/dsp/effetune-dsp.wasm', root)));
            try {
                assert.ok(binding.createEngine());
                assert.equal(binding.prepare(48000, 2, 128, 8192), 0);
                const instances = [];
                for (const effect of pipeline) {
                    assert.equal(effect.enabled, true);
                    const { PluginClass, definition: pluginDefinition } = await loadReferencePlugin(effect.name);
                    const plugin = new PluginClass();
                    try {
                        plugin.setParameters({ ...effect.parameters, enabled: true });
                        const parameters = structuredClone(plugin.getParameters());
                        for (const [key, value] of Object.entries(effect.parameters)) {
                            // Compare serialized values across the reference VM boundary.
                            assert.equal(JSON.stringify(parameters[key]), JSON.stringify(value), `${name}/${effect.name}/${key}`);
                        }
                        const packer = DSP_PARAM_PACKERS.get(pluginDefinition.type);
                        const instance = binding.createInstance(pluginDefinition.type);
                        assert.ok(instance);
                        assert.equal(binding.instanceSetParams(instance, packer.pack(parameters), packer.hash), 0);
                        if (packer.packBytes) assert.equal(binding.instanceSetParamBytes(instance, packer.packBytes(parameters), packer.hash), 0);
                        instances.push(instance);
                    } finally {
                        plugin.cleanup?.();
                    }
                }
                let peak = 0;
                let squares = 0;
                let count = 0;
                // Initial silence, a changing stereo program, then silence to exercise release.
                for (let block = 0; block < 1875; block++) {
                    let arena = binding.getArenaViews();
                    for (let channel = 0; channel < 2; channel++) {
                        for (let i = 0; i < 128; i++) {
                            const time = (block * 128 + i) / 48000;
                            const envelope = 0.12 + 0.88 * Math.exp(-12 * (time % 0.5));
                            arena.combined[channel * 128 + i] = block < 75 || block >= 1500 ? 0 : envelope * (
                                0.3 * Math.sin(2 * Math.PI * 83 * time + channel * 0.2) +
                                0.12 * Math.sin(2 * Math.PI * 997 * time) +
                                0.08 * Math.sin(2 * Math.PI * 6301 * time));
                        }
                    }
                    for (const instance of instances) {
                        assert.equal(binding.instanceProcess(instance, arena.offsets.combined, 2, 128, block * 128 / 48000), 0);
                        arena = binding.getArenaViews();
                    }
                    for (const sample of arena.combined.subarray(0, 256)) {
                        assert.ok(Number.isFinite(sample), name);
                        assert.ok(Math.abs(sample) < 1, `${name}: clipped output`);
                        if (block < 75 || block >= 1800) assert.ok(Math.abs(sample) < 1e-5, `${name}: non-silent output`);
                        if (block >= 750 && block < 1500) {
                            peak = Math.max(peak, Math.abs(sample));
                            squares += sample * sample;
                            count++;
                        }
                    }
                }
                for (const instance of instances) {
                    assert.equal(binding.instanceRuntimeEvent(instance).generation, 0);
                }
                assert.ok(squares > 0, `${name}: silent program`);
                results.set(name, 20 * Math.log10(peak / Math.sqrt(squares / count)));
            } finally {
                binding.close();
            }
        });
    }
    assert.ok(results.get('J-Pop Dense') < results.get('Classical') - 3,
        `Dense J-Pop must reduce crest factor: ${JSON.stringify(Object.fromEntries(results))}`);
});
