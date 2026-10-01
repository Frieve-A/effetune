import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { matchUrlRule, validateRules } from '../../extension/url-rules.js';
import { AudioManager } from '../../js/audio-manager.js';
import { AudioIOManager } from '../../js/audio/audio-io-manager.js';

const hostSource = (await readFile(new URL('../../extension/offscreen.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');

async function hostHarness(loaded = {}, { startStatus = () => 'processing', failSave = () => false,
    failContext = () => false } = {}) {
    const saves = [];
    let saving = 0;
    let maximumSaving = 0;
    let nextId = 0;
    const frames = [];
    const audioSessions = [];
    const decodeContexts = [];
    const visualizerRequests = [];
    class MessageChannel {
        constructor() {
            const session = { status: 'stopped', plugins: [], masterBypass: false, irIds: [] };
            audioSessions.push(session);
            this.port1 = { start() {}, close() {}, postMessage: data => {
                if (data.kind !== 'request') return;
                const args = data.args;
                if (data.command === 'start') Object.assign(session, { ...args, status: startStatus(args.tabId) });
                if (data.command === 'setPipeline') session.plugins = args.plugins;
                if (data.command === 'stop') session.status = 'stopped';
                if (data.command === 'setBypass') session.masterBypass = args.enabled;
                if (data.command === 'rebuild') session.sampleRate = args.sampleRate;
                if (data.command === 'setVisualizerSources') visualizerRequests.push(args.sources);
                if (data.command === 'workletMessage' && args.message?.type === 'updatePlugin') {
                    session.plugins = session.plugins.map(plugin => plugin.id === args.message.plugin.id
                        ? { ...plugin, ...args.message.plugin.parameters, en: args.message.plugin.enabled } : plugin);
                }
                queueMicrotask(() => this.port1.onmessage({ data: { kind: 'response', requestId: data.requestId,
                    ok: true, state: structuredClone(session) } }));
            } };
            this.port2 = {};
        }
    }
    const context = vm.createContext({ console, Map, Set, Promise, Date, Object, Number, Array,
        setTimeout, clearTimeout, setInterval: () => 0, queueMicrotask, structuredClone,
        CHANNEL_NAME: 'test', MODEL_COMMANDS: new Set(), isInternalSender: () => true,
        matchUrlRule, validateRules, MessageChannel,
        crypto: { randomUUID: () => String(++nextId) },
        BroadcastChannel: class { postMessage() {} },
        AudioContext: class {
            constructor(options) {
                if (failContext(options?.sampleRate)) throw new Error('Audio context unavailable');
                this.sampleRate = options?.sampleRate || 48000;
                this.closed = false;
                decodeContexts.push(this);
            }
            async close() { this.closed = true; }
        },
        window: { location: { origin: 'chrome-extension://test' } },
        document: { createElement: () => {
            const frame = { dataset: {}, remove() {}, contentWindow: { postMessage() {} } };
            frames.push(frame); return frame;
        }, body: { append(frame) { queueMicrotask(() => frame.onload()); } } },
        chrome: { runtime: { getURL: value => value, onMessage: { addListener() {} } } },
        runtimeRequest: async (command, args) => {
            if (command === 'loadSettings') return loaded;
            if (failSave()) throw new Error('Storage unavailable');
            saving++; maximumSaving = Math.max(maximumSaving, saving);
            const value = structuredClone(args.settings);
            await new Promise(resolve => setTimeout(resolve, 2));
            saves.push(value); saving--;
        },
        initializePluginModel: async () => ({ pluginClasses: { Default: class DefaultPlugin {} },
            createPlugin: () => ({ setWasmAssetTargetResolver() {} }) }),
        createPipelineModels: async preset => preset.plugins,
        serializePipeline: models => models,
        getPresetPluginStates: preset => preset.plugins,
        getDefaultIrLibraryService: async () => ({}),
        ExtensionIrLibraryHost: class { constructor(service) { this.service = service; } }
    });
    vm.runInContext(hostSource, context);
    const run = (command, args = {}, clientId = 'editor') => context.enqueue(command, args, clientId);
    await run('getState');
    return { context, run, saves, frames, audioSessions, decodeContexts, visualizerRequests,
        maximumSaving: () => maximumSaving };
}

test('sample-rate context creation failure keeps the active and saved rate', async () => {
    let rejectContext = false;
    const host = await hostHarness({}, { failContext: rate => rejectContext && rate === 96000 });
    await host.run('start', { tabId: 1, url: 'https://test/', streamId: 'a' });
    const previousContext = host.context.window.audioContext;
    const previousSessions = structuredClone(host.audioSessions);
    rejectContext = true;
    await assert.rejects(host.run('setSampleRate', { sampleRate: 96000 }), /Audio context unavailable/);
    assert.equal((await host.run('getState')).sampleRate, null);
    assert.equal(host.context.window.audioContext, previousContext);
    assert.equal(previousContext.closed, false);
    assert.deepEqual(structuredClone(host.audioSessions), previousSessions);
    assert.equal(host.saves.length, 0);
    rejectContext = false;
    await host.run('setSampleRate', { sampleRate: 96000 });
    assert.equal(host.saves.at(-1).sampleRate, 96000);
    assert.equal(host.context.window.audioContext.sampleRate, 96000);
});

test('sample-rate storage failure closes the candidate and retains the previous context', async () => {
    let rejectSave = false;
    const host = await hostHarness({}, { failSave: () => rejectSave });
    await host.run('start', { tabId: 1, url: 'https://test/', streamId: 'a' });
    const previousContext = host.context.window.audioContext;
    const previousSessions = structuredClone(host.audioSessions);
    rejectSave = true;
    await assert.rejects(host.run('setSampleRate', { sampleRate: 96000 }), /Storage unavailable/);
    assert.equal((await host.run('getState')).sampleRate, null);
    assert.equal(host.context.window.audioContext, previousContext);
    assert.equal(previousContext.closed, false);
    assert.equal(host.decodeContexts.at(-1).closed, true);
    assert.deepEqual(structuredClone(host.audioSessions), previousSessions);
    assert.equal(host.saves.length, 0);
    rejectSave = false;
    await host.run('setSampleRate', { sampleRate: 96000 });
    assert.equal(host.saves.at(-1).sampleRate, 96000);
    assert.equal(host.context.window.audioContext.sampleRate, 96000);
});

test('failed persistent edits restore settings, audio and preset bindings before later saves', async () => {
    const edits = [
        ['setRules', () => ({ rules: [] })],
        ['savePreset', () => ({ name: 'Saved' })],
        ['setPipeline', () => ({ plugins: [{ nm: 'Edited default' }] })],
        ['importPreset', () => ({ name: 'Imported', preset: { plugins: [{ nm: 'Imported' }] } })],
        ['setPipeline', sessionId => ({ sessionId, plugins: [{ nm: 'Edited bound' }] })],
        ['setPipeline', (_sessionId, unboundId) => ({ sessionId: unboundId, plugins: [{ nm: 'Edited unbound' }] })],
        ['importPreset', sessionId => ({ sessionId, name: 'Imported', preset: { plugins: [{ nm: 'Imported' }] } })],
        ['applyPreset', sessionId => ({ sessionId, name: 'Other' })],
        ['deletePreset', () => ({ name: 'Music' })],
        ['workletMessage', sessionId => ({ sessionId, message: { type: 'updatePlugin',
            plugin: { id: 7, enabled: false, parameters: { gain: 12 } } } })],
        ['workletMessage', () => ({ message: { type: 'updatePlugin',
            plugin: { id: 8, type: 'DefaultPlugin', enabled: false, parameters: { gain: 12 } } } })],
        ['setSampleRate', () => ({ sampleRate: 96000 })]
    ];
    for (const [command, args] of edits) {
        let rejectSave = false;
        const host = await hostHarness({ plugins: [{ id: 8, nm: 'Default' }],
            presets: { Music: { plugins: [{ id: 7, nm: 'Music' }] }, Other: { plugins: [{ nm: 'Other' }] } },
            rules: [{ pattern: 'music.test/*', preset: 'Music', enabled: true }] }, { failSave: () => rejectSave });
        const started = await host.run('start', { tabId: 1, url: 'https://music.test/', streamId: 'a' });
        await host.run('start', { tabId: 2, url: 'https://music.test/second', streamId: 'b' });
        const unbound = await host.run('start', { tabId: 3, url: 'https://other.test/', streamId: 'c' });
        const { revision: _revision, ...before } = structuredClone(await host.run('getState'));
        const audioBefore = structuredClone(host.audioSessions);
        const decodeContext = host.context.window.audioContext;
        rejectSave = true;
        await assert.rejects(host.run(command, args(started.sessionId, unbound.sessionId)), /Storage unavailable/, command);
        const { revision: _afterRevision, ...after } = structuredClone(await host.run('getState'));
        assert.deepEqual(after, before, command);
        assert.deepEqual(host.audioSessions, audioBefore, command);
        assert.equal(host.context.window.audioContext, decodeContext, command);
        rejectSave = false;
        await host.run('savePreset', { name: 'Later' });
        const { presets, ...saved } = host.saves.at(-1);
        const { sessions: _sessions, presets: originalPresets, ...originalSettings } = before;
        assert.deepEqual(saved, originalSettings, command);
        assert.deepEqual(presets, { ...originalPresets,
            Later: { plugins: before.plugins.map(({ id, ...plugin }) => plugin) } }, command);
    }
});

test('all preset writers reject reserved names before applying audio changes', async () => {
    const host = await hostHarness({ plugins: [{ nm: 'Default' }] });
    const started = await host.run('start', { tabId: 1, url: 'https://test/', streamId: 'a' });
    const audioBefore = structuredClone(host.audioSessions);
    for (const command of ['savePreset', 'importPreset', 'appendBackupPreset']) {
        for (const name of ['__proto__', 'constructor', 'prototype']) {
            await assert.rejects(host.run(command, { sessionId: started.sessionId, name: ` ${name} `,
                preset: { plugins: [{ nm: 'Imported' }] } }), /different preset name/);
        }
    }
    assert.deepEqual(host.audioSessions, audioBefore);
    assert.deepEqual(structuredClone(await host.run('readBackupPresets')), {});
    assert.equal(host.saves.length, 0);
});

test('backup presets are stored without applying or changing sessions, rules or unsupported parameters', async () => {
    let rejectSave = false;
    const host = await hostHarness({ plugins: [{ nm: 'Default' }], presets: {},
        rules: [{ pattern: 'music.test/*', preset: 'Other', enabled: false }] }, { failSave: () => rejectSave });
    await host.run('start', { tabId: 1, url: 'https://a.test/', streamId: 'a' });
    const before = structuredClone(await host.run('getState'));
    const preset = { outputChannels: 16, plugins: [{ nm: 'Unknown effect', ib: 3, ch: 9, arbitrary: { value: 7 } }] };
    await host.run('appendBackupPreset', { name: 'Portable', preset });
    const after = structuredClone(await host.run('getState'));
    assert.deepEqual(after.plugins, before.plugins);
    assert.deepEqual(after.sessions, before.sessions);
    assert.deepEqual(after.rules, before.rules);
    assert.deepEqual((await host.run('readBackupPresets')).Portable, preset);
    for (const name of ['__proto__', 'constructor', 'prototype', 'Portable']) {
        await assert.rejects(host.run('appendBackupPreset', { name, preset }));
    }
    rejectSave = true;
    await assert.rejects(host.run('appendBackupPreset', { name: 'Failed', preset }));
    assert.equal(Object.hasOwn(await host.run('readBackupPresets'), 'Failed'), false);
    assert.deepEqual((await host.run('readBackupPresets')).Portable, preset);
});

test('host defaults, per-session edits and bypass keep settings writes serialized', async () => {
    const host = await hostHarness({ plugins: [{ nm: 'Default' }], presets: {}, masterBypass: false });
    const initial = await host.run('getState');
    assert.equal(initial.sampleRate, null);
    assert.equal(initial.rules.length, 0);
    const first = await host.run('start', { tabId: 1, url: 'https://a.test/', streamId: 'a' });
    const second = await host.run('start', { tabId: 2, url: 'https://b.test/', streamId: 'b' });
    await Promise.all([
        host.run('setPipeline', { sessionId: first.sessionId, plugins: [{ nm: 'A' }] }),
        host.run('setPipeline', { sessionId: second.sessionId, plugins: [{ nm: 'B' }] })
    ]);
    assert.equal(host.maximumSaving(), 1);
    assert.equal(host.saves.at(-1).plugins[0].nm, 'B');
    let state = await host.run('setBypass', { sessionId: first.sessionId, enabled: true });
    assert.equal(state.masterBypass, false);
    assert.equal(state.sessions[0].masterBypass, true);
    state = await host.run('stop', { sessionId: first.sessionId });
    assert.equal(state.sessions[0].status, 'stopped');
    assert.equal(state.sessions[1].status, 'processing');
    assert.equal(state.sessions[1].plugins[0].nm, 'B');
    assert.equal(state.sessions[1].masterBypass, false);
});

test('queued telemetry subscriptions follow session lifetime through stop, failure and selection changes', async () => {
    const host = await hostHarness({}, { startStatus: tabId => tabId === 2 ? 'error' : 'processing' });
    const state = await host.run('start', { tabId: 1, url: 'https://test/', streamId: 'a' });
    const sessionId = state.sessionId;
    await host.run('setTelemetry', { sessionId, enabled: true });
    await Promise.all([
        host.run('stop', { sessionId }),
        host.run('setTelemetry', { sessionId, enabled: true })
    ]);
    assert.equal(vm.runInContext('viewers.size', host.context), 0);
    await host.run('setTelemetry', { sessionId, enabled: false });
    assert.equal(vm.runInContext('viewers.size', host.context), 0);
    await host.run('removeTab', { tabId: 1 });
    await host.run('setTelemetry', { sessionId, enabled: false });
    await host.run('setTelemetry', { sessionId, enabled: true });
    assert.equal(vm.runInContext('viewers.size', host.context), 0);
    await assert.rejects(host.run('setBypass', { sessionId, enabled: true }), /no longer being processed/);

    const running = await host.run('start', { tabId: 3, url: 'https://test/', streamId: 'c' });
    await host.run('setTelemetry', { sessionId: running.sessionId, enabled: true });
    const [failed] = await Promise.all([
        host.run('start', { tabId: 2, url: 'https://test/', streamId: 'b' }),
        host.run('setTelemetry', { sessionId: '3', enabled: true })
    ]);
    assert.equal(failed.sessions.find(session => session.tabId === 2).status, 'error');
    assert.equal(vm.runInContext('viewers.size', host.context), 0);
    await host.run('setTelemetry', { sessionId: running.sessionId, enabled: true });
    assert.equal(vm.runInContext('viewers.get("editor").sessionId', host.context), running.sessionId);
});

test('Visualizer sources reach the selected session and are cleared when their owner leaves', async () => {
    const host = await hostHarness();
    const { sessionId } = await host.run('start', { tabId: 1, url: 'https://test/', streamId: 'a' });
    await host.run('setTelemetry', { sessionId, enabled: true });
    const sources = [{ tapId: 0xf0000000, kind: 'level' }];
    assert.equal(await host.run('setVisualizerSources', { sessionId, sources }), null);
    // The harness records values from the host realm, so compare their JSON form.
    assert.equal(JSON.stringify(host.visualizerRequests), JSON.stringify([sources]));
    await host.run('setTelemetry', { sessionId, enabled: false });
    assert.equal(JSON.stringify(host.visualizerRequests), JSON.stringify([sources, []]));
});

test('URL bindings follow navigation and deletion while rule edits wait for navigation', async () => {
    const host = await hostHarness({ plugins: [{ nm: 'Default' }], presets: { Music: { plugins: [{ nm: 'Music' }] } },
        rules: [{ pattern: 'music.test/*', preset: 'Music', enabled: true }] });
    const started = await host.run('start', { tabId: 1, url: 'https://music.test/', streamId: 'a' });
    assert.equal(started.sessions[0].presetName, 'Music');
    await host.run('setPipeline', { sessionId: started.sessionId, plugins: [{ nm: 'Edited music' }] });
    assert.equal(host.saves.at(-1).presets.Music.plugins[0].nm, 'Edited music');
    assert.equal(host.saves.at(-1).plugins[0].nm, 'Default');
    let state = await host.run('navigate', { tabId: 1, url: 'https://other.test/' });
    assert.equal(state.sessions[0].presetName, null);
    assert.equal(state.sessions[0].plugins[0].nm, 'Default');
    await host.run('navigate', { tabId: 1, url: 'https://music.test/' });
    state = await host.run('setRules', { rules: [] });
    assert.equal(state.sessions[0].presetName, 'Music');
    state = await host.run('deletePreset', { name: 'Music' });
    assert.equal(state.sessions[0].presetName, null);
    assert.equal(state.sessions[0].plugins[0].nm, 'Default');
});

test('host bounds live sessions, reuses same-tab sessions and retains terminal state', async () => {
    const host = await hostHarness();
    for (let tabId = 1; tabId <= 4; tabId++) await host.run('start', { tabId, url: 'https://test/', streamId: String(tabId) });
    assert.equal(host.frames.length, 4);
    await host.run('start', { tabId: 1, url: 'https://test/', streamId: 'again' });
    assert.equal(host.frames.length, 4);
    await assert.rejects(host.run('start', { tabId: 5 }), /four tabs/);
    const state = await host.run('getState');
    await host.run('stop', { sessionId: state.sessions[0].sessionId });
    await host.run('start', { tabId: 5, url: 'https://test/', streamId: 'five' });
    assert.equal((await host.run('getState')).sessions.length, 5);
    await host.run('removeTab', { tabId: 1 });
    assert.equal((await host.run('getState')).sessions.length, 4);
});

test('captured-stream teardown retains input only when explicitly requested', async () => {
    let stopped = 0;
    const io = { stopDevicePoll() {}, releaseAudioInput() { stopped++; } };
    AudioIOManager.prototype.cleanupAudio.call(io, { releaseInput: false });
    assert.equal(stopped, 0);
    AudioIOManager.prototype.cleanupAudio.call(io);
    assert.equal(stopped, 1);
    let releaseInput;
    const audio = { async fadeOutOutputForTeardown() {}, _clearSyncedMeasurements() {}, _removeDspVisibilityListener() {},
        powerPolicyController: { dispose() {} },
        ioManager: { cleanupAudio(options) { releaseInput = options.releaseInput; } },
        contextManager: { async closeAudioContext() {} }, updateExposedProperties() {} };
    await AudioManager.prototype.closeCapturedStream.call(audio, { releaseInput: false });
    assert.equal(releaseInput, false);
    await AudioManager.prototype.closeCapturedStream.call(audio);
    assert.equal(releaseInput, true);
});
