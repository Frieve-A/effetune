import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { AndroidBridge, isAndroidHost, ANDROID_ORIGIN, base64ToBytes } from '../../js/android/bridge.js';
import { prepareAndroidPipeline } from '../../js/android/pipeline.js';
import { decodeDspPipelineDescriptor } from '../../js/audio/dsp-pipeline-descriptor.js';
import { registerServiceWorker } from '../../js/app-bootstrap.js';
import { AndroidLibraryFilesystem } from '../../js/android/library-filesystem.js';
import { WebMetadataParser } from '../../js/library/scan/web-metadata-parser.js';
import { AndroidDocuments } from '../../js/android/documents.js';
import { bytesToBase64 } from '../../js/android/bridge.js';
import { captureAndroidSweep } from '../../js/android/measurement.js';
import { startAndroidNoise } from '../../js/android/measurement.js';
import { AndroidAssets } from '../../js/android/assets.js';
import { AndroidPlayerContext } from '../../js/android/player-context.js';
import { createPwaPlaybackTrack } from '../../js/network-music/pwa-playback-provider.js';
import { prepareAndroidMidiConfiguration, requestAndroidMidiAccess, subscribeAndroidMidiActions } from '../../js/android/midi.js';
import { ParamAdapter } from '../../js/midi/param-adapter.js';
import { PLAYBACK_SPEED_STEPS } from '../../js/ui/audio-player/playback-speed.js';
import { AndroidAudioManager } from '../../js/android/audio-manager.js';
import { AndroidPlaybackQueue, nativeQueueTrack } from '../../js/android/playback-queue.js';
import { StateManager } from '../../js/ui/audio-player/state-manager.js';

test('Android audio preferences send player input ownership with the selected device', async () => {
    const requests = [];
    const manager = {
        bridge: { request: async (command, payload) => { requests.push({ command, payload }); return {}; } },
        acceptSnapshot() {}
    };
    for (const useInputWithPlayer of [false, true]) {
        await AndroidAudioManager.prototype.reset.call(manager, { inputDeviceId: 'default', useInputWithPlayer });
    }
    assert.deepEqual(requests, [
        { command: 'audio.configure', payload: { inputDeviceId: 'default', useInputWithPlayer: false } },
        { command: 'audio.input', payload: { deviceId: 0 } },
        { command: 'audio.configure', payload: { inputDeviceId: 'default', useInputWithPlayer: true } },
        { command: 'audio.input', payload: { deviceId: 0 } }
    ]);
});

test('real Volume state and routing survive native hydration with independent A/B objects', async () => {
    const sandbox = { window: {}, document: {}, console, performance, setTimeout, clearTimeout };
    vm.runInNewContext(fs.readFileSync(new URL('../../plugins/plugin-base.js', import.meta.url), 'utf8') + '\n' +
        fs.readFileSync(new URL('../../plugins/basics/volume.js', import.meta.url), 'utf8') +
        '\nVolumePlugin.prototype.audioHostActive=false;this.VolumePlugin=VolumePlugin;', sandbox);
    const plugin = new sandbox.VolumePlugin();
    plugin.id = 51; plugin.setParameters({ vl: -9, enabled: false });
    plugin.inputBus = 2; plugin.outputBus = 3; plugin.channel = 'R';
    const record = prepareAndroidPipeline([plugin], { sampleRate: 48000 }).plugins[0];
    assert.equal(record.parameters.inputBus, 2); assert.equal(record.parameters.outputBus, 3);
    assert.equal(record.parameters.channel, 'R');
    record.parameters.enabled = true;
    const manager = { pipelineA: [], pipelineB: [], catalogPublished: true, snapshot: {
        revision: 2, slot: 'A', pipelines: { A: [record], B: [{ ...record, parameters: { ...record.parameters, vl: -3 } }] }
    }, nativeAssets: { synchronize() {}, adopt() {} }, pipelineProcessor: { setPipeline() {} } };
    const previous = globalThis.window; globalThis.window = {};
    try {
        await AndroidAudioManager.prototype.hydratePipeline.call(manager, { nextPluginId: 1, createPlugin: () => new sandbox.VolumePlugin() });
        assert.equal(manager.pipelineA[0].vl, -9); assert.equal(manager.pipelineA[0].enabled, false);
        assert.equal(manager.pipelineA[0].inputBus, 2); assert.equal(manager.pipelineA[0].outputBus, 3);
        assert.equal(manager.pipelineA[0].channel, 'R');
        assert.notEqual(manager.pipelineA[0], manager.pipelineB[0]);
        manager.pipelineA[0].setParameters({ vl: -12 });
        assert.equal(manager.pipelineB[0].vl, -3);
    } finally { globalThis.window = previous; }
});

test('native snapshot restores bounded queue ordinal and settings without stale local track authority', () => {
    const player = {}; player.stateManager = new StateManager(player);
    player.playbackManager = { installCatalogSequence(sequence) { this.catalogSequence = sequence; } };
    const context = Object.create(AndroidPlayerContext.prototype);
    Object.assign(context, { audioPlayer: player, audioManager: { snapshot: { revision: 8 } },
        sourceCache: new WeakMap(), nativeTracks: [{ uri: 'content://stale' }],
        nativeQueue: new AndroidPlaybackQueue({}), updateState: updates => player.stateManager.updateState(updates),
        presentedSourceUri: 'content://current', presentNativeTrack: async () => {} });
    context.acceptPlayback({ revision: 8, playback: { source: { uri: 'content://current', title: 'Native song' },
        index: 7, queueLength: 80, queueOffset: 7, queue: [{ uri: 'content://current', title: 'Native song' }],
        speed: 1.5, preservePitch: false, volume: 0.42, muted: true, repeat: 'all', shuffle: true } });
    const state = player.stateManager.getStateSnapshot();
    assert.equal(state.currentTrackIndex, 7); assert.equal(state.playlistLength, 80);
    assert.equal(state.currentTrack.name, 'Native song'); assert.equal(state.playbackSpeed, 1.5);
    assert.equal(state.preservePitch, false); assert.equal(state.playerVolume, 42); assert.equal(state.playerMute, true);
    assert.equal(state.queueWindow.startOrdinal, 7); assert.equal(state.queueWindow.rows.length, 1);
    context.acceptPlayback({ revision: 8, playback: { source: null, index: -1, queueLength: 0, queue: [] } });
    assert.equal(player.stateManager.getStateSnapshot().currentTrack, null);
    assert.equal(player.stateManager.getStateSnapshot().playlistLength, 0);
});

test('native mutation authority is synchronous and waits only for its captured writes', async () => {
    const manager = Object.create(AndroidAudioManager.prototype);
    let finish;
    const write = new Promise(resolve => { finish = resolve; });
    const options = { remoteRequestId: 'remote-operation' };
    let completed = false;
    const remote = manager.withMutationOptions(options, () => {
        assert.equal(manager.getMutationOptions(), options);
        manager.mutationWrites.push(write);
        return 'remote-result';
    }).then(value => { completed = true; return value; });
    assert.equal(manager.getMutationOptions(), undefined);
    assert.equal(await manager.withMutationOptions(undefined, () => 'local-result'), 'local-result');
    assert.equal(completed, false);
    finish(); assert.equal(await remote, 'remote-result');
});

test('native-only asset clear stays in its captured guarded transaction', async () => {
    const calls = [], assets = new AndroidAssets({ request: async (command, payload) => calls.push({ command, payload }) });
    class FixturePlugin { constructor() { this.id = 3; } getWasmAssets() { return new Map(); } clearWasmAsset() {} }
    const plugin = new FixturePlugin(); let clears;
    assets.synchronize([plugin], () => { clears = [...assets.pendingClears]; assets.pendingClears.clear(); });
    assets.adopt([plugin], { 'FixturePlugin:3:0': { id: 'immutable-version' } });
    plugin.clearWasmAsset(0);
    assert.deepEqual(calls, []);
    await assert.rejects(assets.transfer([plugin], { beforeCommit() { throw new Error('revoked'); } }, clears), /revoked/);
    assert.deepEqual(calls, []);
    await assets.transfer([plugin], { remoteRequestId: 'operation' }, clears);
    assert.equal(calls[0].payload._remoteRequestId, 'operation');
    assert.equal(calls[0].command, 'pipeline.asset.clear');
});

test('native retained asset definitions protect sources in filtered and common library browsers', () => {
    const manager = Object.create(AndroidAudioManager.prototype);
    manager.snapshot = { retainedAssetDefinitions: [{ externalAssetParameters: { ir: 'older-ir' } },
        { externalAssetParameters: { sf: 'older-bank' } }] };
    assert.equal(manager.isExternalAssetInUse(undefined, 'older-ir'), true);
    assert.equal(manager.isExternalAssetInUse('SFZ', 'older-bank'), true);
    assert.equal(manager.isExternalAssetInUse('SFZ', 'older-ir'), false);
});

test('native SFZ preview sends only ephemeral notes and keeps canonical pipeline serialization unchanged', async () => {
    const manager = Object.create(AndroidAudioManager.prototype), calls = [];
    manager.bridge = { request: async (name, payload) => calls.push({ name, payload }) };
    manager.acceptSnapshot = () => {};
    manager.rebuildPipeline = () => assert.fail('Preview must not create canonical history');
    for (const pm of [60, -1]) manager.commitPowerTopologyMutation({ plugin: {
        id: 3, type: 'SFZNotePlayerPlugin', parameters: { pm, pv: 64 }
    } }, { reason: 'sfz-note-preview' });
    await Promise.resolve();
    assert.deepEqual(calls.map(call => call.name), ['pipeline.preview', 'pipeline.preview']);
    assert.deepEqual(calls.map(call => call.payload.pm), [60, -1]);
});

test('native library queue keeps row identity for lazy sibling resolution after recreation', async () => {
    const context = Object.create(AndroidPlayerContext.prototype);
    context.sourceCache = new WeakMap(); context.resolveTrackProvider = value => value;
    const source = await context.resolveNativeSource({ uri: 'content://music/album.wav', name: 'Cue title',
        libraryTrackId: 'catalog-row-2', startFrame: 750, endFrame: 1500, durationSec: 10, meta: { title: 'Cue title' } });
    const restored = nativeQueueTrack(structuredClone(source), 4);
    assert.equal(restored.libraryTrackId, 'catalog-row-2'); assert.equal(restored.startFrame, 750);
    assert.equal(restored.meta.title, 'Cue title'); assert.equal(source.lyricsFile, undefined);
});

test('native DSP fault notifications reject stale graphs and reach existing plugin notices', () => {
    const received = [];
    class TubeSimulatorPlugin { constructor() { this.id = 7; } onMessage(message) { received.push(message); } }
    const manager = { snapshot: { revision: 4 }, pipeline: [new TubeSimulatorPlugin()],
        nativeRuntimeEvents: new Map(), dispatchEvent() {} };
    const event = { revision: 4, type: 'tubeSimulatorCircuitFault', pluginType: 'TubeSimulatorPlugin',
        pluginId: 7, instanceEpoch: 2, generation: 1, latched: true, cause: 'feedbackOscillation' };
    const accept = data => AndroidAudioManager.prototype.acceptRuntimeEvent.call(manager, data);
    assert.equal(accept({ ...event, revision: 3 }), false);
    assert.equal(accept(event), true);
    assert.equal(received[0].validated, true);
    assert.equal(accept(event), false);
    assert.equal(accept({ ...event, instanceEpoch: 1, generation: 4 }), false);
    assert.equal(accept({ ...event, generation: 2, latched: false, cause: 'none' }), true);
});

test('renderer recreation never starts an existing stopped Android Service', async () => {
    const commands = [];
    let revision = 8;
    const manager = { bridge: { request: async command => {
        if (command === 'snapshot.get') return { revision, powerState: 'SUSPENDED' };
        commands.push(command); return { revision: ++revision };
    } }, acceptSnapshot() {} };
    await AndroidAudioManager.prototype.initAudio.call(manager);
    await AndroidAudioManager.prototype.fadeInOutputWhenReady.call(manager);
    assert.deepEqual(commands, []);
    revision = 0;
    await AndroidAudioManager.prototype.initAudio.call(manager);
    await AndroidAudioManager.prototype.fadeInOutputWhenReady.call(manager);
    await AndroidAudioManager.prototype.fadeInOutputWhenReady.call(manager);
    assert.deepEqual(commands, ['audio.start']);
    assert.equal(revision, 1);
});

test('Android MIDI publishes shared descriptors and keeps native ports alive after renderer disposal', async () => {
    const mappings = [
        { id: 'volume', target: { type: 'VolumePlugin', param: 'vl', element: 0 } },
        { id: 'speed', target: { type: '_global', param: 'playbackSpeed' } }
    ];
    const adapter = new ParamAdapter();
    const config = prepareAndroidMidiConfiguration({ snapshot: () => ({ version: 1, devices: [], mappings }) }, adapter, true);
    assert.equal(config.learning, true);
    assert.deepEqual(config.mappings[0].descriptor, adapter.resolve('VolumePlugin', 'vl', 0).descriptor);
    assert.deepEqual(config.mappings[1].descriptor.valuesForButtons, PLAYBACK_SPEED_STEPS);
    assert.equal(mappings[0].descriptor, undefined);
    const listeners = new Map(), commands = [];
    const bridge = {
        request: async (command, payload) => { commands.push({ command, payload }); return { inputs: [{ id: '1', name: 'Controller' }] }; },
        on: (name, listener) => { listeners.set(name, listener); return () => listeners.delete(name); }
    };
    const access = await requestAndroidMidiAccess(bridge);
    const states = [];
    const onState = ({ port }) => states.push([port.id, port.state, port.connection]);
    access.addEventListener('statechange', onState);
    let event;
    access.inputs.get('1').onmidimessage = value => { event = value; };
    listeners.get('midi')({ id: '1', data: [0xb0, 7, 100], consumed: true });
    assert.equal(event.nativeConsumed, true);
    assert.deepEqual([...event.data], [0xb0, 7, 100]);
    listeners.get('midi-connected')({ id: '2', name: 'Second' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(access.inputs.get('2').name, 'Second');
    listeners.get('midi-disconnected')({ id: '1' });
    assert.equal(access.inputs.get('1').onmidimessage, null);
    assert.deepEqual(states, [['2', 'connected', 'open'], ['1', 'disconnected', 'closed']]);
    access.removeEventListener('statechange', onState);
    await access.inputs.get('2').close();
    assert.deepEqual(commands.at(-1), { command: 'midi.close', payload: { id: '2' } });
    const closedPorts = commands.filter(item => item.command === 'midi.close').length;
    access.close();
    assert.equal(listeners.size, 0);
    assert.equal(commands.filter(item => item.command === 'midi.close').length, closedPorts);
});

test('native preset actions reuse the existing ordered preset loader', async () => {
    let listener, selected;
    const off = subscribeAndroidMidiActions({ pipelineManager: { presetManager: {
        currentPresetName: 'A', getLoadablePresets: async () => ({ B: {}, A: {} }),
        loadPreset: async name => { selected = name; }
    } } }, { on: (name, callback) => { assert.equal(name, 'midi-action'); listener = callback; return () => { listener = null; }; } });
    listener({ key: 'preset', direction: 1 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(selected, 'B');
    off(); assert.equal(listener, null);
});

test('existing PWA gateway and Subsonic providers retain media URLs and authorization on Android', async () => {
    const previous = globalThis.window;
    globalThis.window = {};
    try {
        for (const serverId of ['pwa:gateway:library', 'subsonic:test']) {
            const track = createPwaPlaybackTrack({ networkMusicResolveTrack: async request => {
                assert.equal(request.serverId, serverId);
                return { uri: 'https://music.example/stream?token=authorized', headers: { Authorization: 'Bearer fixture' },
                    title: 'Song', artist: 'Artist', album: 'Album', artwork: 'https://music.example/art/42' };
            } }, { serverId, trackId: '42', title: 'Song' });
            const context = Object.create(AndroidPlayerContext.prototype);
            context.sourceCache = new WeakMap();
            context.resolvedProviderTracks = new WeakSet();
            const source = await context.resolveNativeSource(track);
            assert.equal(source.uri, 'https://music.example/stream?token=authorized');
            assert.deepEqual(source.headers, { Authorization: 'Bearer fixture' });
            assert.equal(source.metadata.artist, 'Artist');
            assert.equal(source.metadata.album, 'Album');
            assert.equal(source.metadata.artworkUrl, 'https://music.example/art/42');
        }
    } finally { globalThis.window = previous; }
});

test('Android matrix routing preserves structured parameter bytes', () => {
    class MatrixPlugin {
        constructor() { this.id = 1; this.name = 'Matrix'; this.enabled = true; }
        getParameters() { return { mx: 'p0110' }; }
    }
    const result = prepareAndroidPipeline([new MatrixPlugin()]);
    assert.deepEqual([...base64ToBytes(result.plugins[0].parameterBytes)], [1, 0, 2, 0, 0, 1, 1, 1, 0, 0]);
});

test('CUE frame ranges use seconds at the native boundary and restore the shared descriptor', async () => {
    const previous = globalThis.window; globalThis.window = {};
    try {
        const context = Object.create(AndroidPlayerContext.prototype);
        context.sourceCache = new WeakMap();
        const source = await context.resolveNativeSource({ uri: 'content://music/album', name: 'Second',
            startFrame: 150, endFrame: null, durationSec: 3 });
        assert.deepEqual(source.region, { start: 2, end: null, durationSec: 3 });
        const track = nativeQueueTrack(source, 7);
        assert.equal(track.startFrame, 150); assert.equal(track.endFrame, null); assert.equal(track.durationSec, 3);
    } finally { globalThis.window = previous; }
});

test('native power allows reset-on-resume tails to idle and protects generators and aging state', () => {
    class VolumePlugin {
        constructor(capability) { this.id = 1; this.enabled = true; this.temporalCapability = capability; }
        getParameters() { return { vl: 0 }; }
    }
    for (const capability of ['stateless', 'reset-on-resume']) {
        assert.equal(prepareAndroidPipeline([new VolumePlugin(capability)]).temporalMustProcess, false);
    }
    for (const capability of ['must-process', 'age-by-skipped-frames']) {
        assert.equal(prepareAndroidPipeline([new VolumePlugin(capability)]).temporalMustProcess, true);
    }
    const disabled = new VolumePlugin('must-process'); disabled.enabled = false;
    assert.equal(prepareAndroidPipeline([disabled]).temporalMustProcess, false);
});

test('native noise uploads bounded stereo loops with selected output routing', async () => {
    const samples = new Float32Array(40000).fill(0.25);
    const commands = [];
    const bridge = { request: async (name, payload) => commands.push({ name, payload }) };
    await startAndroidNoise({ length: samples.length, sampleRate: 48000, numberOfChannels: 1,
        getChannelData: () => samples }, { bridge, levelDb: -18, channel: 'right', outputDeviceId: '7' });
    assert.equal(commands[0].payload.outputDeviceId, 7);
    assert.equal(commands.at(-1).name, 'measurement.noise.start');
    const chunks = commands.filter(item => item.name === 'measurement.noise.chunk');
    assert.deepEqual(chunks.map(item => item.payload.offset), [0, 256 * 1024]);
    for (const chunk of chunks) {
        const bytes = base64ToBytes(chunk.payload.data);
        assert.ok(bytes.length <= 256 * 1024);
        const data = new Float32Array(bytes.buffer);
        assert.equal(data[0], 0);
        assert.equal(data[1], 0.25);
    }
    await assert.rejects(startAndroidNoise({ length: 1 }, { bridge, isCurrent: () => false }), { name: 'AbortError' });
});

test('native assets acknowledge readiness and clear removed slots', async () => {
    const commands = [], states = [];
    const assets = new Map([[0, { payload: new ArrayBuffer(300000), operationRevision: 2, formatTag: 1 }]]);
    const plugin = { id: 3, getWasmAssets: () => assets,
        onWasmAssetState: (...state) => states.push(state) };
    const host = new AndroidAssets({ request: async (name, payload) => commands.push({ name, payload }) });
    await host.transfer([plugin]);
    assert.deepEqual(states, [[0, 3, 2]]);
    assert.equal(commands.filter(item => item.name === 'pipeline.asset.chunk').length, 2);
    await host.transfer([plugin]);
    assert.equal(commands.filter(item => item.name === 'pipeline.asset.commit').length, 1);
    assets.clear();
    await host.transfer([plugin]);
    assert.deepEqual(commands.at(-1), { name: 'pipeline.asset.clear', payload: { pluginId: 3, slot: 0, externalAssetParameters: undefined } });
});

test('native query queue materialization pages sources without a 4096-track cutoff', async () => {
    const commands = [];
    const context = Object.create(AndroidPlayerContext.prototype);
    Object.assign(context, {
        audioPlayer: { playbackManager: { playlist: [], sequence: {
            itemCount: 4100,
            getEntry: async ordinal => ({ ordinal, name: `Track ${ordinal}` }),
            resolveEntrySource: async entry => ({ uri: `content://music/${entry.ordinal}` })
        } } },
        resolveTrackProvider: async track => track,
        resolveNativeSource: async track => ({ uri: track.uri, title: track.name }),
        getCurrentState: () => ({ repeatMode: 'ALL', shuffleMode: false, currentTrackIndex: 2 }),
        command: async (name, payload) => commands.push({ name, payload }),
        audioManager: { snapshot: null }, acceptPlayback() {},
        setVideoPresentationSource() {}, updateState() {}
    });
    await context.loadTrack({ uri: 'content://music/2', name: 'Track 2' }, 2);
    assert.equal(commands[0].name, 'queue.begin');
    assert.equal(commands[0].payload.index, 2);
    const batches = commands.filter(item => item.name === 'queue.append');
    assert.equal(batches.reduce((count, item) => count + item.payload.items.length, 0), 4100);
    assert.ok(batches.every(item => item.payload.items.length <= 64 && item.payload.transactionId === commands[0].payload.transactionId));
    assert.equal(commands.at(-1).name, 'queue.commit');
});

test('Android bridge requires the bundled origin and correlates validated replies', async () => {
    const sent = [];
    const windowRef = { location: { origin: ANDROID_ORIGIN }, effetuneAndroid: {
        postMessage: message => sent.push(JSON.parse(message))
    } };
    assert.equal(isAndroidHost(windowRef), true);
    assert.equal(isAndroidHost({ ...windowRef, location: { origin: 'https://example.com' } }), false);
    const bridge = new AndroidBridge(windowRef);
    const pending = bridge.request('pipeline.set', { plugins: [] }, 4);
    assert.equal(sent[0].expectedRevision, 4);
    bridge.receive('{');
    bridge.receive(JSON.stringify({ version: 2, id: sent[0].id, ok: true, result: 'wrong' }));
    bridge.receive(JSON.stringify({ version: 1, id: sent[0].id, ok: true, result: { revision: 5 } }));
    assert.deepEqual(await pending, { revision: 5 });
    const failed = bridge.request('audio.start');
    bridge.receive(JSON.stringify({ version: 1, id: sent[1].id, ok: false,
        error: { code: 'denied', message: 'private diagnostic' } }));
    await assert.rejects(failed, error => error.code === 'denied' && !error.message.includes('private'));
    bridge.close();
});

test('Android bridge bounds transfers and releases pending requests on detach', async () => {
    const bridge = new AndroidBridge({ location: { origin: ANDROID_ORIGIN },
        effetuneAndroid: { postMessage() {} } });
    await assert.rejects(bridge.request('documents.write', { data: 'x'.repeat(1024 * 1024) }), RangeError);
    const pending = bridge.request('snapshot.get');
    bridge.close();
    await assert.rejects(pending, /closed/);
});

test('Android bridge releases unanswered and undeliverable native requests', async () => {
    const transport = { postMessage() {} };
    const bridge = new AndroidBridge({ location: { origin: ANDROID_ORIGIN }, effetuneAndroid: transport }, { timeoutMs: 10 });
    try {
        await assert.rejects(bridge.request('snapshot.get'), /timed out/);
        assert.equal(bridge.pending.size, 0);
        transport.postMessage = () => { throw new Error('Native transport detached'); };
        await assert.rejects(bridge.request('snapshot.get'), /detached/);
        assert.equal(bridge.pending.size, 0);
    } finally { bridge.close(); }
});

test('Android pipeline uses generated parameter layouts and preserves section gating', () => {
    class VolumePlugin {
        constructor(id) { this.id = id; this.name = 'Volume'; this.enabled = true; }
        getParameters() { return { vl: -6, inputBus: 0, outputBus: 0 }; }
    }
    class SectionPlugin {
        constructor() { this.id = 2; this.name = 'Section'; this.enabled = false; }
        getParameters() { return {}; }
    }
    const result = prepareAndroidPipeline([new VolumePlugin(1), new SectionPlugin(), new VolumePlugin(3)]);
    assert.ok(result.plugins[0].parameterValues.includes(-6));
    assert.ok(result.plugins[0].layoutHash > 0);
    const { nodes } = decodeDspPipelineDescriptor(base64ToBytes(result.descriptor));
    assert.deepEqual(nodes.map(node => [node.instanceId, node.sectionGate]), [[1, 1], [3, 0]]);
});

test('Android bundled assets never register a PWA service worker', () => {
    registerServiceWorker({ location: { origin: ANDROID_ORIGIN },
        effetuneAndroid: { postMessage() {} },
        navigator: { serviceWorker: { register() { throw new Error('must not register'); } } } });
});

test('SAF directory and streaming WAV metadata use bounded native ranges', async () => {
    const previous = globalThis.window;
    const bytes = new Uint8Array(44 + 48000 * 2);
    const view = new DataView(bytes.buffer);
    const label = (offset, value) => bytes.set(new TextEncoder().encode(value), offset);
    label(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); label(8, 'WAVE');
    label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, 48000, true); view.setUint32(28, 96000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, bytes.length - 44, true);
    const ranges = [];
    const transport = { postMessage(raw) {
        const request = JSON.parse(raw);
        let result;
        if (request.command === 'documents.list') result = { entries: [{ name: 'tone.wav', isDirectory: false }], nextOffset: null };
        else if (request.command === 'documents.resolve') result = { uri: 'content://test/tone.wav' };
        else if (request.command === 'documents.stat') result = { name: 'tone.wav', size: bytes.length, lastModified: 1, mimeType: 'audio/wav' };
        else if (request.command === 'documents.read') {
            ranges.push(request.payload);
            const { offset, length } = request.payload;
            result = { data: bytesToBase64(bytes.slice(offset, offset + length)), eof: offset + length >= bytes.length };
        } else throw new Error(`Unexpected command ${request.command}`);
        queueMicrotask(() => transport.onmessage({ data: JSON.stringify({ version: 1, id: request.id, ok: true, result }) }));
    } };
    globalThis.window = { location: { origin: ANDROID_ORIGIN }, effetuneAndroid: transport };
    try {
        const filesystem = new AndroidLibraryFilesystem({ rootHandle: { androidUri: 'content://test/tree' } });
        const entries = [];
        for await (const entry of filesystem.enumerateDirectory()) entries.push(entry);
        assert.equal(entries[0].relativePath, 'tone.wav');
        const parser = new WebMetadataParser({ filesystem });
        const metadata = await parser.parse({ relativePath: 'tone.wav', skipCovers: true });
        assert.equal(metadata.sampleRate, 48000);
        assert.ok(ranges.length > 0);
        assert.ok(ranges.every(range => range.length <= 256 * 1024));
    } finally { globalThis.window = previous; }
});

test('document writes chunk binary data and read enforces the import limit', async () => {
    const calls = [];
    const documents = new AndroidDocuments({ request: async (command, payload) => {
        calls.push({ command, payload });
        return { data: bytesToBase64(new Uint8Array([1, 2, 3])), eof: true };
    } });
    await documents.write('content://test/output', new Uint8Array(256 * 1024 + 1));
    assert.deepEqual(calls.map(call => call.payload.append), [false, true]);
    await assert.rejects(documents.read('content://test/input', { maximumBytes: 2 }), RangeError);
});

test('Android host startup and A/B edits retain native snapshot authority', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const listeners = new Map(), requests = [];
        let snapshot = { revision: 0, sampleRate: 48000, channelCount: 2, slot: 'A',
            pipelines: { A: [], B: [] }, playback: { position: 3, duration: 10, playing: false } };
        const bridge = {
            on(name, listener) { listeners.set(name, listener); },
            async request(command, payload) {
                requests.push({ command, payload });
                if (command === 'pipeline.slot') snapshot = { ...snapshot, slot: payload.slot };
                if (command === 'pipeline.set') snapshot = { ...snapshot, masterBypass: payload.masterBypass };
                if (command !== 'snapshot.get') snapshot = { ...snapshot, revision: snapshot.revision + 1 };
                return snapshot;
            }
        };
        const manager = new AndroidAudioManager(null, { bridge });
        assert.equal(manager.isDspReady(), false);
        await manager.initAudio();
        await manager.fadeInOutputWhenReady();
        await manager.fadeInOutputWhenReady();
        assert.equal(requests.filter(request => request.command === 'audio.start').length, 1);
        assert.equal(manager.needsSystemResumeRecovery, false);
        await manager.handleSystemResume();
        await manager.fadeInOutputWhenReady();
        assert.equal(requests.filter(request => request.command === 'audio.start').length, 1);
        assert.equal(manager.isDspReady(), true);
        await manager.hydratePipeline({ pluginClasses: {}, nextPluginId: 1 });
        await manager.setCurrentPipelineWithTransition('B');
        assert.equal(manager.currentPipeline, 'B');
        await manager.copyBToA();
        assert.equal(manager.currentPipeline, 'A');
        await manager.copyAToB();
        await manager.togglePipelineWithTransition();
        assert.equal(manager.currentPipeline, 'A');
        manager.setMasterBypass(true);
        await manager.pendingMutation;
        assert.equal(requests.findLast(request => request.command === 'pipeline.set').payload.masterBypass, true);
        await manager.updateAudioConfig({ outputDeviceId: 'default', outputChannels: 4 });
        await manager.applyPersistedPowerSettings({ enabled: false });
        assert.deepEqual(requests.findLast(request => request.command === 'audio.configure').payload,
            { powerSettings: { enabled: false } });
        listeners.get('snapshot')({ ...snapshot, revision: 100, channelCount: 4 });
        listeners.get('snapshot')({ ...snapshot, revision: 99, channelCount: 2 });
        assert.equal(manager.getOutputChannelCount(), 4);
        assert.equal(manager.getPowerSnapshot().revision, 100);
        assert.equal(manager.getAudiblePlaybackPosition(0), 3);
        assert.equal(manager.getNativeSampleRate(), 48000);
        assert.deepEqual(requests.filter(request => request.command === 'pipeline.copySlot').map(request => request.payload),
            [{ from: 'B', to: 'A' }, { from: 'A', to: 'B' }]);
    });
});

test('Android playback controls adopt native results and detach their event listeners', async () => {
    const listeners = new Map(), requests = [];
    let revision = 0;
    const manager = { snapshot: { revision }, bridge: {
        on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name); },
        async request(command, payload) {
            requests.push({ command, payload });
            return { revision: ++revision, playback: { position: payload.position ?? 2,
                playing: command === 'playback.play', queueLength: 0, volume: 0.3, muted: true, repeat: 'all' } };
        }
    }, acceptSnapshot(snapshot) { this.snapshot = snapshot; } };
    const player = { playbackManager: {} };
    player.stateManager = new StateManager(player);
    const context = new AndroidPlayerContext(player, manager);
    await context.play();
    assert.equal(player.stateManager.getStateSnapshot().isPlaying, true);
    await context.pause();
    assert.equal(player.stateManager.getStateSnapshot().isPlaying, false);
    await context.seek(7);
    assert.equal(context.getCurrentPlaybackTime(), 7);
    player.stateManager.updateState({ playbackSpeed: 1.5, preservePitch: false, repeatMode: 'ALL', shuffleMode: true });
    await context.applyPlaybackSpeedToElement();
    await context.queueMode({ shuffle: false });
    await context.applyPlayerVolume();
    context.nativeLoadAbort = new AbortController();
    await context.stop();
    assert.equal(context.nativeLoadAbort.signal.aborted, true);
    assert.deepEqual(requests.map(request => request.command), [
        'playback.play', 'playback.pause', 'playback.seek', 'playback.speed',
        'playback.queueMode', 'playback.volume', 'playback.stop'
    ]);
    assert.deepEqual(requests[3].payload, { speed: 1.5, preservePitch: false });
    assert.deepEqual(requests[4].payload, { repeat: 'all', shuffle: false });
    assert.deepEqual(requests[5].payload, { volume: 0.3, muted: true });
    listeners.get('playback-ended')({ revision: 100, playback: { position: 9, queueLength: 0 } });
    assert.equal(player.stateManager.getStateSnapshot().currentTrackPosition, 9);
    context.disconnect();
    assert.equal(listeners.size, 0);
});

test('Android queue fetches missing ordinals without duplicating the durable queue', async () => {
    const requests = [];
    const queue = new AndroidPlaybackQueue({ async request(command, payload) {
        requests.push({ command, payload });
        return { offset: payload.offset, total: 200, items: [{ uri: 'content://music/next', title: 'Next',
            region: { start: 1, end: 2, durationSec: 1 } }] };
    } });
    queue.accept({ queueLength: 200, queueOffset: 10, queue: [{ uri: 'content://music/current', title: 'Current' }] });
    assert.equal((await queue.getEntry(10)).name, 'Current');
    assert.equal(requests.length, 0);
    const entry = await queue.getEntry(150);
    assert.equal(entry.nativeQueueIndex, 150);
    assert.equal(entry.startFrame, 75);
    assert.equal(entry.endFrame, 150);
    assert.equal(await queue.resolveEntrySource(entry), entry);
    assert.equal(queue.toCanonicalOrdinal(150), queue.toTransportOrdinal(150));
    await queue.getWindow({ centerOrdinal: 250, limit: 100 });
    assert.deepEqual(requests.map(request => request.payload), [{ offset: 150, limit: 1 }, { offset: 199, limit: 64 }]);
    assert.equal(queue.window.totalCount, 200);
    assert.equal(queue.window.rows.length, 1);
});

test('native finite capture preserves pre-roll, channel selection and cleanup', async () => {
    const calls = [];
    let uploaded;
    const sweep = { sampleRate: 8, length: 2, tailSamples: 0,
        channels: [new Float32Array([0.5, -0.5]), new Float32Array([0.25, -0.25])] };
    const bridge = { async request(command, payload) {
        calls.push(command);
        if (command === 'measurement.chunk') uploaded = payload.data;
        if (command === 'measurement.status') return { status: 'complete' };
        if (command === 'measurement.read') return { data: uploaded, frames: 10, channels: 2, sampleRate: 8 };
        return {};
    } };
    const result = await captureAndroidSweep(sweep, { repetitions: 1, levelDb: 0, channel: 'right', bridge });
    assert.deepEqual(Array.from(result.recording), [0, 0, 0, 0, 0.25, -0.25, 0, 0, 0, 0]);
    assert.equal(calls.at(-1), 'measurement.cancel');
    bridge.request = async command => {
        calls.push(command);
        if (command === 'measurement.status') return { status: 'invalid' };
        return {};
    };
    await assert.rejects(captureAndroidSweep(sweep, { repetitions: 1, levelDb: 0, bridge }), /interrupted/);
    assert.equal(calls.at(-1), 'measurement.cancel');
});
