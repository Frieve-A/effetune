import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const pluginUrl = new URL('../../plugins/eq/group_delay_eq.js', import.meta.url);
const pluginSource = fs.readFileSync(pluginUrl, 'utf8');

function loadPlugin() {
    const calls = [];
    class PluginBase {
        constructor(name, description) {
            this.name = name;
            this.description = description;
            this.id = 'group-delay-eq-test';
            this.enabled = true;
            this.channel = null;
            this.powerGainUpperBoundDb = 0;
        }

        registerProcessor(processor) {
            this.processor = processor;
        }

        getParameters() {
            return {
                type: this.constructor.name,
                id: this.id,
                enabled: this.enabled
            };
        }

        getSerializableParameters() {
            const { type, id, ...rest } = this.getParameters();
            return rest;
        }

        _setValidatedParameters(parameters) {
            if (parameters.enabled !== undefined) this.enabled = Boolean(parameters.enabled);
            if (parameters.channel !== undefined) this.channel = parameters.channel;
        }

        parseFiniteNumber(value, minimum, maximum, fallback) {
            const number = Number(value);
            if (!Number.isFinite(number)) return fallback;
            return Math.max(minimum, Math.min(maximum, number));
        }

        updateParameters() {
            calls.push(['updateParameters']);
        }

        setWasmAsset(slot, descriptor) {
            calls.push(['setWasmAsset', slot, descriptor]);
            return 17;
        }

        clearWasmAsset(slot) {
            calls.push(['clearWasmAsset', slot]);
        }

        _isCurrentWasmAssetOperation(slot, revision) {
            return slot === 0 && revision === 17;
        }

        cleanup() {
            calls.push(['cleanup']);
        }
    }

    const context = {
        PluginBase,
        window: {},
        document: { removeEventListener() {} },
        console,
        Math,
        Number,
        JSON,
        Array,
        ArrayBuffer,
        Float32Array,
        Map,
        Promise,
        setTimeout,
        clearTimeout
    };
    vm.runInNewContext(
        `${pluginSource}\nthis.Plugin = GroupDelayEqPlugin;`,
        context,
        { filename: pluginUrl.pathname }
    );
    return { Plugin: context.Plugin, calls };
}

function stubRuntime(plugin) {
    plugin._runtimePromise = Promise.resolve({
        IR_ASSET_TOPOLOGY: { mono: 1 },
        selectedIrChannelCount: () => 2,
        estimateIrKernelCommitFootprint: () => 4 * 1024 * 1024
    });
}

test('Group Delay EQ starts flat and validates its parameters', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};

    assert.equal(plugin.name, 'Group Delay EQ');
    assert.equal(plugin.tp, 16384);
    assert.equal(plugin.lt, '128');
    assert.equal(plugin.offlineDspAssetRequired, false);
    assert.deepEqual(
        Array.from({ length: 15 }, (_, band) => plugin['d' + band]),
        new Array(15).fill(0)
    );

    // The range covers the whole delay the filter can hold at the current tap count.
    assert.equal(plugin._delayLimitMs(), 149.3);
    plugin.setParameters({ d0: 500, d1: -500, d2: 3.5, tp: 12345, lt: '2048' });
    assert.equal(plugin.d0, 149.3);
    assert.equal(plugin.d1, -149.3);
    assert.equal(plugin.d2, 3.5);
    assert.equal(plugin.tp, 16384);
    assert.equal(plugin.lt, '128');
    assert.equal(plugin.offlineDspAssetRequired, true);

    plugin.setParameters({ tp: 32768, lt: '512' });
    assert.equal(plugin.tp, 32768);
    assert.equal(plugin.lt, '512');
    assert.equal(plugin._delayLimitMs(), 298.6);
    plugin.cleanup();
});

test('Group Delay EQ shrinks stored delays when the tap count drops', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};
    plugin.setParameters({ tp: 32768, d0: 200, d5: -1.5 });
    assert.equal(plugin.d0, 200);

    plugin.setParameters({ tp: 4096 });
    assert.equal(plugin._delayLimitMs(), 37.3);
    assert.equal(plugin.d0, 37.3);
    assert.equal(plugin.d5, -1.5);
    plugin.cleanup();
});

test('Group Delay EQ shows the phase rotation as whole cycles plus an angle', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};
    plugin.setParameters({ d0: 8, d3: -2, d8: 2.5, d14: 8 });

    assert.equal(plugin._formatAngle(0), '+72°');      // 25 Hz, less than one cycle
    assert.equal(plugin._formatAngle(3), '-72°');      // 100 Hz, negative
    assert.equal(plugin._formatAngle(1), '+0°');       // 40 Hz, still at zero
    assert.equal(plugin._formatAngle(8), '+2c180°');   // 1 kHz, two cycles and a half turn
    assert.equal(plugin._formatAngle(14), '+128c0°');  // 16 kHz, many cycles
    plugin.cleanup();
});

test('Group Delay EQ reports the bulk delay through the packed parameters', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};
    plugin.setParameters({ tp: 8192, d4: 2 });

    const parameters = plugin.getParameters();
    assert.equal(parameters.fd, 4096);
    assert.equal(parameters.lt, '128');
    assert.equal(parameters.tp, 8192);
    assert.equal(parameters.d4, 2);
    assert.equal(plugin.getSerializableParameters().fd, undefined);
    plugin.cleanup();
});

test('Group Delay EQ stages a mono FIR through the shared asset contract', async () => {
    const { Plugin, calls } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};
    plugin.setParameters({ d0: 5 });
    const payload = new ArrayBuffer(32 + plugin.tp * Float32Array.BYTES_PER_ELEMENT);
    const result = { payload, rippleDb: 0.01, clamped: false, limitMs: 74 };
    plugin._lastDesign = result;
    plugin._designGeneration = 4;
    stubRuntime(plugin);

    assert.equal(await plugin._stageDesign(result, 4), true);
    const stage = calls.find(call => call[0] === 'setWasmAsset');
    assert.ok(stage);
    assert.equal(stage[1], 0);
    assert.equal(stage[2].payload, payload);
    assert.equal(stage[2].headBlock, 128);
    assert.equal(stage[2].processingChannels, 2);
    assert.equal(stage[2].formatTag, 1);
    assert.equal(stage[2].rateDivider, 1);
    assert.equal(plugin._candidateAssetRevision, 17);
    plugin.cleanup();
});

test('Group Delay EQ releases the filter when every band returns to zero', async () => {
    const { Plugin, calls } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};
    plugin._lastDesign = { payload: new ArrayBuffer(32), rippleDb: 0 };
    plugin._designStaged = true;

    assert.equal(await plugin._designAndStage(plugin._designGeneration), true);
    assert.ok(calls.some(call => call[0] === 'clearWasmAsset' && call[1] === 0));
    assert.equal(plugin._lastDesign, null);
    assert.equal(plugin._assetState, 0);
    assert.equal(plugin.powerGainUpperBoundDb, 0);
    plugin.cleanup();
});

test('Group Delay EQ offline state bypasses while flat and carries the filter otherwise', async () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};
    plugin.setParameters({ tp: 8192, lt: '256' });

    const bypass = await plugin.createOfflineDspState({ sampleRate: 96000, outputChannelCount: 2 });
    assert.equal(bypass.offlineDspAssetRequired, false);
    assert.equal(bypass.assets.size, 0);
    assert.equal(bypass.parameters.fd, 4096);
    assert.equal(bypass.parameters.lt, '256');

    plugin.setParameters({ d2: -3 });
    const payload = new ArrayBuffer(32 + plugin.tp * Float32Array.BYTES_PER_ELEMENT);
    let closed = false;
    plugin._runtimePromise = Promise.resolve({
        IR_ASSET_TOPOLOGY: { mono: 1 },
        selectedIrChannelCount: () => 4,
        estimateIrKernelCommitFootprint: () => 8 * 1024 * 1024,
        createGroupDelayEqDesigner: () => ({
            design: config => {
                assert.equal(config.sampleRate, 96000);
                assert.equal(config.taps, 8192);
                assert.equal(config.delaysMs[2], -3);
                return Promise.resolve({ payload });
            },
            close: () => { closed = true; }
        })
    });

    const state = await plugin.createOfflineDspState({ sampleRate: 96000, outputChannelCount: 4 });
    assert.equal(state.offlineDspAssetRequired, true);
    assert.equal(closed, true);
    const asset = state.assets.get(0);
    assert.equal(asset.payload, payload);
    assert.equal(asset.headBlock, 256);
    assert.equal(asset.processingChannels, 4);
    assert.equal(asset.warmupSamples, 256 + 4096);
    plugin.cleanup();
});
