import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { AndroidBridge, isAndroidHost, ANDROID_ORIGIN, base64ToBytes } from '../../js/android/bridge.js';
import { installAndroidWindowUi } from '../../js/android/window-ui.js';
import { prepareAndroidPipeline } from '../../js/android/pipeline.js';
import { PipelineCore } from '../../js/ui/pipeline/pipeline-core.js';
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
import { AudioPlayer } from '../../js/ui/audio-player.js';
import { LibraryManagerV2 } from '../../js/library/library-manager-v2.js';
import { prepareLoudnessSource } from '../../js/library/loudness/analysis-job.js';
import { openDsdWorkerReader } from '../../js/ui/audio-player/dsd-range-channel.js';
import { createPwaPlaybackTrack } from '../../js/network-music/pwa-playback-provider.js';
import { prepareAndroidMidiConfiguration, requestAndroidMidiAccess, subscribeAndroidMidiActions } from '../../js/android/midi.js';
import { ParamAdapter } from '../../js/midi/param-adapter.js';
import { PLAYBACK_SPEED_STEPS } from '../../js/ui/audio-player/playback-speed.js';
import { AndroidAudioManager } from '../../js/android/audio-manager.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../../js/audio/audio-device-constants.js';
import { createAndroidNetworkOutput, attachAndroidNetworkOutput } from '../../js/android/network-output.js';
import { createAndroidOpenHome } from '../../js/android/openhome.js';
import { AndroidPlaybackQueue, nativeQueueTrack } from '../../js/android/playback-queue.js';
import { PlaybackManager } from '../../js/ui/audio-player/playback-manager.js';
import { musicPlayerOwnsMidi } from '../../js/midi/live-input.js';
import { StateManager } from '../../js/ui/audio-player/state-manager.js';
import { WEB_APP_CONFIG_KEY, setWebAppConfigRuntimeForTests, resetWebAppConfigRuntimeForTests } from '../../js/electron/webSettingsStorage.js';
import { AndroidNetworkMusicTransport } from '../../js/android/network-music-transport.js';
import { NetworkMusicController } from '../../js/network-music/controller.js';
import { createAndroidMusicService } from '../../js/android/remote-music-service.js';
import { CONTENT, didl, didlItem, xml } from '../../js/network-music/upnp/protocol.js';

function androidUpnpFixture(t) {
    const location = 'http://music.local/description.xml';
    const address = '192.168.1.20';
    const serverId = 'uuid:android-test-music';
    const uri = 'http://music.local/music/one.flac';
    const token = '0123456789ab4def8123456789abcdef';
    const playbackUrl = `http://127.0.0.1:44200/openhome-media/${token}`;
    const description = `<root><device><UDN>${serverId}</UDN><friendlyName>Music Server</friendlyName>
        <serviceList><service><serviceType>${CONTENT}</serviceType><controlURL>/control</controlURL></service></serviceList>
        </device></root>`;
    const listing = didl([didlItem({ id: 'one', title: 'A song', uri, protocolInfo: 'http-get:*:audio/flac:*' })]);
    const handlers = new Map(), calls = [], config = {};
    const queuePage = { revision: 1, total: 1, items: [{ uri: playbackUrl }] };
    const bridge = {
        on(event, fn) { handlers.set(event, fn); return () => handlers.delete(event); },
        async request(command, payload) {
            if (command === 'share.status') return { enabled: false, folderIds: [] };
            calls.push({ command, payload });
            if (command === 'upnp.search') return {};
            if (command === 'gateway.register') return { token, playbackUrl };
            if (command === 'gateway.release') return { released: true };
            if (command === 'playback.queue.read') return payload.retained ? { ...queuePage, items: [{ uri: playbackUrl }] } : { ...queuePage };
            assert.equal(command, 'upnp.http');
            if (payload.url === location) return { status: 200, text: description, connectionAddress: address };
            assert.equal(payload.url, 'http://music.local/control');
            const action = payload.headers.SOAPAction.split('#')[1].slice(0, -1);
            const body = { GetSearchCapabilities: '<SearchCaps>dc:title</SearchCaps>',
                GetSortCapabilities: '<SortCaps>dc:title</SortCaps>',
                Browse: `<Result>${xml(listing)}</Result><TotalMatches>1</TotalMatches>` }[action];
            assert.ok(body);
            return { status: 200, text: `<${action}Response>${body}</${action}Response>` };
        }
    };
    const api = new AndroidNetworkMusicTransport({ bridge, windowRef: {},
        loadConfig: async () => config, saveConfig: async settings => { Object.assign(config, settings); return true; },
        ensureNetworkAccess: async ({ request }) => { calls.push({ command: 'permission', payload: { request } }); }
    });
    t.after(() => api.dispose());
    return { api, bridge, calls, config, address, location, serverId, uri, token, playbackUrl, queuePage,
        notify: (event, payload) => handlers.get(event)?.(payload) };
}

test('Android audio preferences send player input ownership with the selected device', async () => {
    const requests = [], saved = [];
    const manager = {
        snapshot: { inputDeviceId: -1, preferredOutputDeviceId: 0, channelCount: 2,
            sampleRate: 48000, latencyHint: 'balanced', gaplessPlayback: true },
        bridge: { async request(command, payload) {
            requests.push({ command, payload });
            return { ...manager.snapshot, ...(command === 'audio.input' ? { inputDeviceId: payload.deviceId } : payload) };
        } },
        acceptSnapshot(snapshot) { this.snapshot = snapshot; }
    };
    const previous = globalThis.window;
    globalThis.window = { electronIntegration: { saveAudioPreferences: async preferences => saved.push(preferences) } };
    try {
        for (const useInputWithPlayer of [false, true]) {
            await AndroidAudioManager.prototype.reset.call(manager, { inputDeviceId: 'default', useInputWithPlayer });
        }
    } finally { globalThis.window = previous; }
    assert.deepEqual(saved.map(({ inputDeviceId, useInputWithPlayer }) => ({ inputDeviceId, useInputWithPlayer })),
        [{ inputDeviceId: 'default', useInputWithPlayer: false }, { inputDeviceId: 'default', useInputWithPlayer: true }]);
    assert.ok(saved.every(preferences => !Object.hasOwn(preferences, 'outputChannels')));
    assert.deepEqual(requests, [
        { command: 'audio.configure', payload: { useInputWithPlayer: false } },
        { command: 'audio.input', payload: { deviceId: 0 } },
        { command: 'audio.configure', payload: { useInputWithPlayer: true } },
        { command: 'audio.input', payload: { deviceId: 0 } }
    ]);
});

test('Android saves the confirmed settings and repacks a partially applied format', async () => {
    const error = Object.assign(new Error('output failed'), { code: 'output-unavailable' });
    const saved = [], calls = [];
    const actual = { sampleRate: 96000, channelCount: 2, inputDeviceId: -1, preferredOutputDeviceId: 5,
        useInputWithPlayer: true, gaplessPlayback: false, latencyHint: 'balanced' };
    const manager = {
        snapshot: { ...actual, sampleRate: 48000 },
        bridge: { async request(command) {
            calls.push(command);
            if (command === 'audio.configure') throw error;
            assert.equal(command, 'snapshot.get');
            return actual;
        } },
        acceptSnapshot(snapshot) { this.snapshot = snapshot; },
        _postVisualizerSources() {}, dispatchEvent() {},
        async rebuildPipeline() { calls.push('repack'); }
    };
    await withGlobals({ window: { audioPreferences: { outputDeviceId: '5', outputDeviceLabel: 'Speaker' },
        electronIntegration: { saveAudioPreferences: prefs => saved.push(prefs) } } }, async () => {
        await assert.rejects(AndroidAudioManager.prototype.reset.call(manager, {
            sampleRate: 96000, inputDeviceId: '9', outputDeviceId: '7', outputDeviceLabel: 'USB', latencyHint: 'interactive'
        }), error);
    });
    assert.deepEqual(calls, ['audio.configure', 'snapshot.get', 'repack']);
    assert.deepEqual(saved, [{ sampleRate: 96000, inputDeviceId: NO_AUDIO_INPUT_DEVICE_ID,
        outputDeviceId: '5', useInputWithPlayer: true, gaplessPlayback: false, latencyHint: 'balanced',
        inputDeviceLabel: '', outputDeviceLabel: 'Speaker' }]);
});

test('Android microphone denial releases a previously selected input and propagates the permission code', async () => {
    const denied = Object.assign(new Error(), { code: 'permission-denied' });
    const inputs = [], saved = [];
    const manager = {
        snapshot: { sampleRate: 48000, channelCount: 2, inputDeviceId: 7, preferredOutputDeviceId: 0 },
        bridge: { async request(command, payload) {
            if (command === 'audio.input') {
                inputs.push(payload.deviceId);
                if (payload.deviceId >= 0) throw denied;
                return { ...manager.snapshot, inputDeviceId: -1 };
            }
            return manager.snapshot;
        } },
        acceptSnapshot(snapshot) { this.snapshot = snapshot; }
    };
    await withGlobals({ window: { electronIntegration: { saveAudioPreferences: prefs => saved.push(prefs) } } }, async () => {
        await assert.rejects(AndroidAudioManager.prototype.reset.call(manager, { inputDeviceId: '8' }), denied);
    });
    assert.deepEqual(inputs, [8, -1]);
    assert.equal(saved[0].inputDeviceId, NO_AUDIO_INPUT_DEVICE_ID);
});

test('Android MIDI output saves and applies the Service key after a rejected selection', async () => {
    const failure = Object.assign(new Error('unavailable'), { code: 'midi-unavailable' });
    const calls = [];
    const manager = { bridge: { async request(command, payload) {
        calls.push([command, payload]);
        if (command === 'midi.selectOutput') throw failure;
        assert.equal(command, 'midi.list');
        return { selectedOutputKey: 'Previous synth' };
    } } };
    await withGlobals({ window: {
        app: { async applyMidiOutputPreference(key) { calls.push(['display', key]); } },
        electronIntegration: { async saveAudioPreferences(preferences) { calls.push(['save', preferences]); return true; } }
    } }, async () => {
        await assert.rejects(AndroidAudioManager.prototype.reset.call(manager, { midiOutputDeviceKey: 'Unavailable synth' }), failure);
    });
    assert.deepEqual(calls, [
        ['midi.selectOutput', { key: 'Unavailable synth' }], ['midi.list', undefined],
        ['display', 'Previous synth'], ['save', { midiOutputDeviceKey: 'Previous synth' }]
    ]);
});

test('Android Gapless Playback saves and displays the committed state after failure', async () => {
    const fail = new Error('configure failed');
    const saved = [], calls = [];
    const player = { gaplessPlayback: true };
    const manager = {
        snapshot: { gaplessPlayback: true },
        bridge: { async request(command, payload) {
            calls.push([command, payload]);
            assert.equal(player.gaplessPlayback, true);
            assert.equal(saved.length, 0);
            if (command === 'audio.configure') throw fail;
            return { gaplessPlayback: true };
        } },
        acceptSnapshot(snapshot) { this.snapshot = snapshot; }
    };
    await withGlobals({ window: { uiManager: { audioPlayer: player },
        electronIntegration: { async saveAudioPreferences(preferences) { saved.push(preferences); return true; } }
    } }, async () => {
        await assert.rejects(AndroidAudioManager.prototype.reset.call(manager, { gaplessPlayback: false }), fail);
    });
    assert.deepEqual(calls, [['audio.configure', { gaplessPlayback: false }], ['snapshot.get', undefined]]);
    assert.deepEqual(saved, [{ gaplessPlayback: true }]);
    assert.equal(player.gaplessPlayback, true);
});

test('Android Live PCM reports the native cursor and delays for the adopted route', async () => {
    const calls = [];
    let reported;
    const report = new Promise(resolve => { reported = resolve; });
    const host = { on: () => () => {}, async request(name, data) {
        calls.push([name, data]);
        if (name === 'live.start') return { connectionId: 'connection' };
        if (name === 'live.activate') return { active: true };
        if (name === 'live.position') return { started: true, positionFrames: 1234.5, sampleRate: 48000,
            outputDelayFrames: 48, physicalOutputMs: null };
        if (name === 'openhome.liveFeedback' && !data.probeId) return { value: 'probe' };
        if (data.probeId) reported(data);
        return {};
    } };
    const player = { audioManager: { networkRoute: { generation: 7, revision: 9, receiveId: 3, receiveActive: true },
        networkPaths: { revision: 9, localDelaySamples: 48, receive: { localSamples: 96 } } } };
    const live = createAndroidOpenHome(host, new EventTarget()).createLivePcm(player);
    try {
        assert.equal(await live.start({ liveSessionId: 'session' }), true);
        live.followReceiveRoute(7);
        assert.equal(await live.activate(), true);
        live.beginReporting();
        assert.deepEqual(await report, { sessionId: 'session', connectionId: 'connection', probeId: 'probe',
            positionFrames: 1234.5, revision: 9, dspMs: 2, softwareOutputMs: 2, physicalOutputMs: null });
        assert.deepEqual(calls.map(([name]) => name), ['live.start', 'live.activate', 'openhome.liveFeedback',
            'live.position', 'openhome.liveFeedback']);
    } finally { live.stop(); }
});

test('Android Live PCM ignores a superseded start and cleans up an ended connection', async () => {
    const starts = [], ended = new Set(), stops = [], states = [];
    const host = { on(event, callback) {
        assert.equal(event, 'live-ended');
        ended.add(callback);
        return () => ended.delete(callback);
    }, async request(name, payload) {
        if (name === 'live.start') return new Promise(resolve => starts.push({ ...payload, resolve }));
        if (name === 'live.stop') stops.push(payload.id);
        return {};
    } };
    const live = createAndroidOpenHome(host, new EventTarget()).createLivePcm({
        stateManager: { updateState: state => states.push(state) }
    });
    const first = live.start({ liveSessionId: 'first' });
    const signal = live.controller.signal;
    const second = live.start({ liveSessionId: 'second' });
    starts[1].resolve({ connectionId: 'two' });
    assert.equal(await second, true);
    starts[0].resolve({ connectionId: 'one' });
    assert.equal(await first, false);
    assert.equal(signal.aborted, true);
    const [onEnded] = ended;
    onEnded({ id: starts[0].id });
    assert.ok(live.source);
    onEnded({ id: starts[1].id });
    assert.equal(await live.position(), null);
    assert.equal(live.source, null);
    assert.equal(ended.size, 0);
    assert.deepEqual(stops, starts.map(start => start.id));
    assert.deepEqual(states, [{ isPlaying: false, isPaused: false, isStopped: true }]);
});

test('Android OpenHome forwards desktop payloads and unwraps native results', async () => {
    const calls = [];
    const windowRef = new EventTarget();
    const status = { apiVersion: 1, enabled: false, upnpAvEnabled: false, state: 'stopped' };
    const response = { requestId: 'action-1', ok: true, result: {} };
    const ack = { resetId: 'reset-1', ok: true };
    const snapshot = { transportState: 'Paused' };
    const probe = { sessionId: 'session-1', connectionId: 'connection-1' };
    const report = { ...probe, probeId: 'probe-1', positionFrames: 24,
        dspMs: null, softwareOutputMs: null, physicalOutputMs: null, revision: 0 };
    const api = createAndroidOpenHome({
        async request(command, payload) {
            calls.push([command, payload]);
            switch (command) {
            case 'openhome.getStatus':
            case 'openhome.setEnabled':
            case 'openhome.setUpnpAvEnabled':
            case 'openhome.setFriendlyName': return status;
            case 'openhome.rendererUnavailable': return { value: false };
            case 'openhome.publishState': return { value: 0 };
            case 'openhome.liveFeedback': return { value: payload.probeId ? payload.positionFrames === 24 : 'probe-1' };
            default: return { value: true };
            }
        }
    }, windowRef);

    assert.equal(api.apiVersion, 1);
    assert.equal(await api.getStatus(), status);
    assert.throws(() => api.setEnabled(1), TypeError);
    assert.throws(() => api.setUpnpAvEnabled('true'), TypeError);
    assert.throws(() => api.setFriendlyName(null), TypeError);
    assert.equal(await api.setEnabled(true), status);
    assert.equal(await api.setUpnpAvEnabled(true), status);
    assert.equal(await api.setEnabled(false), status);
    assert.equal(await api.setFriendlyName('Living Room'), status);
    assert.equal(await api.rendererReady(), true);
    assert.equal(await api.rendererUnavailable(), false);
    assert.equal(await api.respond(response), true);
    assert.equal(await api.resetComplete(ack), true);
    assert.equal(await api.publishState(snapshot), 0);
    assert.equal(await api.probeLivePlayback({ ...probe, ignored: true }), 'probe-1');
    assert.equal(await api.reportLivePlayback(report), true);
    assert.equal(await api.reportLivePlayback({ ...report, positionFrames: 0 }), false);
    windowRef.dispatchEvent(new Event('pagehide'));
    windowRef.dispatchEvent(new Event('pagehide'));

    assert.deepEqual(calls, [
        ['openhome.getStatus', {}],
        ['network.ensurePermission', { request: true }],
        ['openhome.setEnabled', { enabled: true }],
        ['network.ensurePermission', { request: true }],
        ['openhome.setUpnpAvEnabled', { enabled: true }],
        ['openhome.setEnabled', { enabled: false }],
        ['openhome.setFriendlyName', { friendlyName: 'Living Room' }],
        ['openhome.rendererReady', {}],
        ['openhome.rendererUnavailable', {}],
        ['openhome.respond', response],
        ['openhome.resetAck', ack],
        ['openhome.publishState', snapshot],
        ['openhome.liveFeedback', probe],
        ['openhome.liveFeedback', report],
        ['openhome.liveFeedback', { ...report, positionFrames: 0 }],
        ['openhome.rendererUnavailable', {}]
    ]);
});

test('Android OpenHome forwards and unsubscribes desktop notifications', () => {
    const listeners = new Map();
    const api = createAndroidOpenHome({
        on(event, listener) {
            listeners.set(event, listener);
            return () => { listeners.delete(event); };
        }
    }, new EventTarget());

    for (const [method, event, data] of [
        ['onAction', 'openhome-action', { requestId: 'action-1', action: 'Play' }],
        ['onCancel', 'openhome-cancel', { requestId: 'action-1' }],
        ['onReset', 'openhome-reset', { resetId: 'reset-1' }],
        ['onStatus', 'openhome-status', { enabled: true }]
    ]) {
        assert.throws(() => api[method](null), TypeError);
        const received = [];
        const unsubscribe = api[method]((...args) => received.push(args));
        listeners.get(event)(data);
        assert.deepEqual(received, [[data]]);
        unsubscribe();
        assert.equal(listeners.has(event), false);
    }
});

test('Android discovery asks on refresh and pauses while the page is hidden', async t => {
    const document = new EventTarget();
    const permissions = [], searches = [];
    let granted = false;
    const api = new AndroidNetworkMusicTransport({ windowRef: { document },
        bridge: { on: () => () => {}, request: async (name, args) => {
            assert.equal(name, 'upnp.search');
            searches.push(args.enabled ?? true);
        } },
        loadConfig: async () => ({}),
        ensureNetworkAccess: async ({ request }) => {
            permissions.push(request);
            if (request) granted = true;
            if (!granted) throw Object.assign(new Error(), { code: 'permission-required' });
        }
    });
    api.networkMusicGetState = async () => ({ libraries: [], players: [] });
    const controller = new NetworkMusicController({ api });
    t.after(() => controller.dispose());
    await controller.initialize();
    assert.deepEqual(permissions, [false]);
    assert.deepEqual(searches, []);
    await controller.discover();
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(searches, [true, false]);
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(permissions, [false, true, false]);
    assert.deepEqual(searches, [true, false, true]);
});

test('Android UPnP discovery publishes state and pins HTTP to the SSDP sender', async t => {
    const { api, notify, calls, location, address, serverId } = androidUpnpFixture(t);
    await api.networkMusicDiscover();
    assert.deepEqual(calls.slice(0, 2).map(call => call.command), ['permission', 'upnp.search']);
    const discovered = new Promise(resolve => api.onNetworkMusicState(state => {
        if (state.libraries.some(library => library.available)) resolve();
    }));
    const packet = { usn: `${serverId}::upnp:rootdevice`, location, address, maxAge: 180 };
    notify('upnp-device', packet);
    notify('upnp-device', packet);
    await discovered;
    assert.equal((await api.networkMusicGetState()).libraries[0].id, serverId);
    assert.equal((await api.networkMusicBrowse({ serverId })).items[0].title, 'A song');
    const http = calls.filter(call => call.command === 'upnp.http');
    assert.equal(http.filter(call => call.payload.url === location).length, 1);
    assert.ok(http.every(call => call.payload.address === address));
    notify('upnp-device', { ...packet, location: '', nts: 'ssdp:byebye', nt: 'upnp:rootdevice' });
    assert.equal((await api.networkMusicGetState()).libraries[0].available, false);
});

test('Android UPnP persists a manual description and browses without an SSDP address', async t => {
    const { api, calls, config, location, serverId } = androidUpnpFixture(t);
    const state = await api.networkMusicConfigure({ manualDevice: { action: 'add', url: location } });
    assert.deepEqual(config.networkMusicManualDevices.map(device => device.url), [location]);
    assert.equal(state.manualDevices[0].available, true);
    assert.equal((await api.networkMusicBrowse({ serverId })).items[0].title, 'A song');
    assert.ok(calls.filter(call => call.command === 'upnp.http').every(call => !Object.hasOwn(call.payload, 'address')));
    await api.networkMusicConfigure({ manualDevice: { action: 'remove', id: state.manualDevices[0].id } });
    await assert.rejects(api.networkMusicBrowse({ serverId }), { code: 'unavailable' });
});

test('Android UPnP uses a loopback URL until the track leaves the native queue', async t => {
    const { api, calls, notify, location, serverId, uri, token, playbackUrl, queuePage } = androidUpnpFixture(t);
    await api.networkMusicConfigure({ manualDevice: { action: 'add', url: location } });
    const request = { serverId, trackId: 'one', localPlayback: true };
    const tracks = await Promise.all([api.networkMusicResolveTrack(request), api.networkMusicResolveTrack(request)]);
    assert.deepEqual(tracks.map(track => track.uri), [playbackUrl, playbackUrl]);
    assert.equal((await api.networkMusicResolveTrack(request)).uri, playbackUrl);
    assert.deepEqual(calls.filter(call => call.command === 'gateway.register').map(call => call.payload), [{ url: uri }]);
    notify('snapshot', { revision: 1, playback: {
        queueRevision: 1, queueLength: 1, sourceInQueue: true, source: { uri: playbackUrl }
    } });
    await new Promise(resolve => setImmediate(resolve));
    notify('snapshot', { revision: 2, playback: {
        queueRevision: 1, queueLength: 1, sourceInQueue: true, source: { uri: 'https://example.test/next' }
    } });
    assert.equal(calls.filter(call => call.command === 'playback.queue.read').length, 1);
    Object.assign(queuePage, { revision: 3, items: [{ uri: 'https://example.test/next' }] });
    notify('snapshot', { revision: 3, playback: { queueRevision: 2, queueLength: 1 } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.some(call => call.command === 'gateway.release'), false);
    notify('snapshot', { revision: 4, playback: { queueRevision: 3, queueLength: 1, source: { uri: playbackUrl } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.some(call => call.command === 'gateway.release'), false);
    notify('snapshot', { revision: 5, playback: { queueRevision: 3, queueLength: 1 } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.find(call => call.command === 'gateway.release')?.payload, { token });
});

test('Android UPnP keeps the loopback URL retained by Library Play Undo', async t => {
    const { api, calls, notify, location, serverId, token, playbackUrl, queuePage } = androidUpnpFixture(t);
    await api.networkMusicConfigure({ manualDevice: { action: 'add', url: location } });
    await api.networkMusicResolveTrack({ serverId, trackId: 'one', localPlayback: true });
    notify('snapshot', { revision: 1, playback: { queueRevision: 1, queueLength: 1, sourceInQueue: true } });
    await new Promise(resolve => setImmediate(resolve));
    Object.assign(queuePage, { revision: 2, items: [{ uri: 'https://example.test/replacement' }] });
    notify('snapshot', { revision: 2, playback: { queueRevision: 2, queueLength: 1, retainedQueueLength: 1 } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.some(call => call.command === 'playback.queue.read' && call.payload.retained), true);
    assert.equal(calls.some(call => call.command === 'gateway.release'), false);
    queuePage.revision = 3;
    notify('snapshot', { revision: 3, playback: { queueRevision: 3, queueLength: 1, retainedQueueLength: 0 } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.find(call => call.command === 'gateway.release')?.payload, { token });
});

test('Android remote music hides gateway libraries and rejects browsing until permitted', async t => {
    const { api, bridge, config, location, serverId } = androidUpnpFixture(t);
    await api.networkMusicConfigure({ manualDevice: { action: 'add', url: location } });
    const service = createAndroidMusicService(bridge, { uiManager: { networkMusic: { api } } });
    assert.deepEqual((await service.getState()).libraries, []);
    await assert.rejects(service.browse({ serverId }), { code: 'unavailable' });
    await assert.rejects(service.playerCommand({ playerId: 'uuid:renderer', action: 'play', isCurrent: () => true }), { code: 'unavailable' });
    await api.networkMusicConfigure({ gatewayPermissions: { libraries: true, players: false } });
    assert.deepEqual(config.networkMusicGateway, { libraries: true, players: false });
    assert.equal((await service.getState()).libraries[0].id, serverId);
    assert.equal((await service.browse({ serverId })).items[0].title, 'A song');
    await assert.rejects(service.browse({ serverId: 'uuid:unknown' }), { code: 'unavailable' });
});

test('Android network output gates discovery on permission and forwards the receive generation', async () => {
    const calls = [], listeners = new Map();
    const api = createAndroidNetworkOutput({
        async request(name, payload) { calls.push([name, payload]); return {}; },
        on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name); }
    });
    const manager = {
        _networkReceiveSession: { active: false, generation: 0 },
        addEventListener: (name, listener) => listeners.set(name, listener),
        removeEventListener: name => listeners.delete(name),
        dispatchEvent: name => listeners.get(name)?.()
    };
    const detach = attachAndroidNetworkOutput(manager, api);
    await api.setPickerOpen(true);
    await api.setTargetEnabled('kitchen', true);
    await api.setPickerOpen(false);
    manager._networkReceiveSession = { active: true, generation: 2 };
    manager.dispatchEvent('networkRoute');
    listeners.get('network-report')({ type: 'networkRoute', generation: 1 });
    assert.equal(manager.networkRoute, undefined);
    listeners.get('network-report')({ type: 'networkRoute', generation: 2, receiveId: 8, localDelaySamples: 20 });
    assert.equal(manager.networkRoute.receiveId, 8);
    assert.equal(manager._appliedNetworkDelay.localDelaySamples, 20);
    detach();
    assert.deepEqual(calls.map(([name]) => name), [
        'network.output.rendererReady', 'network.ensurePermission', 'network.output.setPickerOpen',
        'network.ensurePermission', 'network.output.setTargetEnabled', 'network.output.setPickerOpen',
        'network.output.setReceiveSession', 'network.output.rendererUnavailable'
    ]);
    assert.deepEqual(calls.at(-2)[1], { active: true, generation: 2 });
    assert.equal(listeners.size, 0);
});

test('Closing the Android picker while permission is pending keeps discovery closed', async () => {
    const toggles = [];
    let grant;
    const api = createAndroidNetworkOutput({ request(name, payload) {
        if (name === 'network.ensurePermission') return new Promise(resolve => { grant = resolve; });
        if (name === 'network.output.setPickerOpen') toggles.push(payload.open);
        return Promise.resolve({});
    } });
    const pending = api.setPickerOpen(true);
    await api.setPickerOpen(false);
    grant();
    await pending;
    assert.deepEqual(toggles, [false]);
});

test('Android offers both live audio markers and packs them in their original routing order', async () => {
    class NetworkSendPlugin {}
    class NetworkReceivePlugin {}
    const pluginClasses = { 'Live Audio Send': NetworkSendPlugin, 'Live Audio Receive': NetworkReceivePlugin };
    let catalog;
    const manager = { bridge: { request: async (_command, payload) => { catalog = payload; } } };
    await AndroidAudioManager.prototype.hydratePipeline.call(manager, { pluginClasses });
    assert.deepEqual(catalog.offered, ['Live Audio Send', 'Live Audio Receive']);
    const marker = (id, name) => ({ id, name, constructor: { name }, enabled: true,
        getParameters: () => ({ type: name, enabled: true }), getSerializableParameters: () => ({}) });
    const chain = prepareAndroidPipeline([marker(7, 'NetworkSendPlugin'), marker(8, 'NetworkReceivePlugin')], { sampleRate: 48000 });
    assert.deepEqual(chain.plugins.map(({ id, type, parameterValues }) => [id, type, parameterValues]),
        [[7, 'NetworkSendPlugin', []], [8, 'NetworkReceivePlugin', []]]);
});

test('Android counts native kernels and display passthroughs even for disabled effects', () => {
    const plugin = (type, id) => ({ id, name: type, constructor: { name: type }, enabled: false,
        getParameters: () => ({}), getSerializableParameters: () => ({}) });
    for (const [type, limit] of [['VolumePlugin', 96], ['LevelMeterPlugin', 48]]) {
        const chain = Array.from({ length: limit }, (_, i) => plugin(type, i + 1));
        chain.unshift(plugin('SectionPlugin', 100));
        const prepare = () => prepareAndroidPipeline(chain, { sampleRate: 48000 });
        assert.equal(prepare().plugins.length, limit + 1);
        chain.push(plugin(type, limit + 1));
        assert.throws(prepare, { code: 'pipeline-too-large' });
    }
});

test('Android reports pipeline CPU, latency and native execution states like the worklet', () => {
    class AmRadioPlugin { constructor(id, enabled) { this.id = id; this.enabled = enabled; this.messages = []; }
        onMessage(message) { this.messages.push(message); } }
    const active = new AmRadioPlugin(4, true), disabled = new AmRadioPlugin(5, false);
    const events = [];
    const manager = Object.assign(Object.create(AndroidAudioManager.prototype), {
        pipeline: [active, disabled], snapshot: { sampleRate: 48000 }, _dspExecutionGenerationsByNode: new Map(),
        pipelineProcessor: { prepareSectionAwarePluginData: () => [active, disabled].map(plugin => ({
            id: plugin.id, type: 'AmRadioPlugin', enabled: plugin.enabled, wasmParams: new Float32Array(1) })) },
        dispatchEvent: (type, detail) => events.push({ type, detail })
    });
    manager.acceptPipelineStats({ cpuAverage: 12.5, latencySamples: 256, compensated: true, sampleRate: 48000 });
    manager.acceptPipelineStats({ latencySamples: 256, compensated: true, sampleRate: 48000 });
    assert.deepEqual(events.map(event => event.type), ['pipelineCpuUsage', 'dspLatency']);
    assert.equal(events[0].detail.average, 12.5);
    assert.equal(events[1].detail.totalSamples, 256);
    manager.publishExecutionStates(manager.pipeline, 7);
    assert.deepEqual(active.messages.map(message => [message.state, message.validated]), [['active', true]]);
    assert.equal(disabled.messages.length, 0);
    assert.deepEqual(manager.getDspExecutionStateSnapshot().states.map(state => [state.pluginId, state.state]), [[4, 'active']]);
});

test('blind selection maps the current Android slot to the primary output and waits for applied delay', async () => {
    for (const primary of ['A', 'B']) {
        const calls = [], events = [];
        let alignments = 0;
        const manager = Object.assign(Object.create(AndroidAudioManager.prototype), {
            pipelineA: [], pipelineB: [], currentPipeline: primary, snapshot: { revision: 2 },
            bridge: { request: async (name, payload) => {
                calls.push([name, payload]);
                return name === 'dbt.align' ? { ready: ++alignments >= 2 } : {};
            } },
            dispatchEvent: event => events.push(event)
        });
        assert.equal(await manager.enableParallelPipelines('A'), true);
        assert.deepEqual(calls.map(([name]) => name), ['dbt.start', 'dbt.align', 'dbt.align', 'dbt.select']);
        assert.equal(calls[0][1].pipeline.slot, primary === 'A' ? 'B' : 'A');
        assert.equal(calls[0][1].pipeline.prepareAssets, false);
        assert.equal(calls[3][1].branch, primary === 'A' ? 0 : 1);
        const stale = manager.fadeOutOutput(.02), current = manager.fadeOutOutput(.03);
        assert.equal(await manager.setBlindSelection('B'), true);
        assert.equal(calls.at(-1)[1].branch, primary === 'B' ? 0 : 1);
        assert.equal(manager.fadeInOutputForToken(stale), false);
        assert.equal(manager.fadeInOutputForToken(current), true);
        assert.deepEqual(calls.at(-1), ['dbt.fade', { gain: 1, seconds: .05 }]);
        await manager.disableParallelPipelines();
        manager.fadeOutOutput(.02);
        assert.equal(calls.at(-1)[0], 'dbt.stop');
        assert.equal(await manager.enableParallelPipelines('B'), true);
        manager.invalidateBlindTest();
        assert.deepEqual(events, ['parallelInvalidated']);
        assert.equal(await manager.setBlindSelection('A'), false);
    }
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
    const display = [];
    const manager = Object.assign(Object.create(AndroidAudioManager.prototype), { pipelineA: [], pipelineB: [], catalogPublished: true, snapshot: {
        revision: 2, slot: 'A', masterBypass: true, pipelines: { A: [record], B: [{ ...record, parameters: { ...record.parameters, vl: -3 } }] }
    }, nativeAssets: new AndroidAssets({}), pipelineProcessor: { setPipeline() {} }, publishExecutionStates() {} });
    const previous = globalThis.window; globalThis.window = {};
    try {
        manager.setMasterBypass = AndroidAudioManager.prototype.setMasterBypass;
        const core = { applyMasterBypass: PipelineCore.prototype.applyMasterBypass,
            masterToggle: { classList: { toggle: (...args) => display.push(args) } },
            updateAllPluginDisplayState: () => display.push('rows') };
        manager.pipelineManager = { core };
        await AndroidAudioManager.prototype.hydratePipeline.call(manager, { nextPluginId: 1, createPlugin: () => new sandbox.VolumePlugin() });
        assert.equal(manager.masterBypass, true);
        assert.equal(core.enabled, false);
        assert.deepEqual(display, [['off', true], 'rows']);
        assert.equal(manager.pipelineA[0].vl, -9); assert.equal(manager.pipelineA[0].enabled, false);
        assert.equal(manager.pipelineA[0].inputBus, 2); assert.equal(manager.pipelineA[0].outputBus, 3);
        assert.equal(manager.pipelineA[0].channel, 'R');
        assert.notEqual(manager.pipelineA[0], manager.pipelineB[0]);
        manager.pipelineA[0].setParameters({ vl: -12 });
        assert.equal(manager.pipelineB[0].vl, -3);
    } finally { globalThis.window = previous; }
});

test('native snapshots preserve the browsed page, tag title and unloaded session ownership', async () => {
    const player = { ui: { container: {} } }; player.stateManager = new StateManager(player);
    player.playbackManager = await withGlobals({ document: { addEventListener() {} } }, () => new PlaybackManager(player));
    const requests = [];
    const queue = new AndroidPlaybackQueue({ async request(command, { offset, limit }) {
        assert.equal(command, 'playback.queue.read');
        requests.push([offset, limit]);
        return { offset, total: 160, items: Array.from({ length: limit }, (_, i) => ({ title: String(offset + i) })) };
    } });
    const context = Object.create(AndroidPlayerContext.prototype);
    Object.assign(context, { audioPlayer: player, audioManager: { snapshot: { revision: 8 } },
        pendingWrites: { volume: 0, speed: 0, position: 0 },
        sourceCache: new WeakMap(), nativeTracks: [{ uri: 'content://stale' }],
        nativeQueue: queue, updateState: updates => player.stateManager.updateState(updates),
        presentedSourceUri: 'content://current', presentNativeTrack: async () => {} });
    const playback = { source: { uri: 'content://current', title: 'Native song' }, index: 7, queueLength: 160,
        restoredUnloaded: true, speed: 1.5, preservePitch: false, volume: 0.42, muted: true, repeat: 'all' };
    context.acceptPlayback({ revision: 8, playback });
    await new Promise(resolve => setImmediate(resolve));
    const state = player.stateManager.getStateSnapshot();
    assert.equal(state.currentTrackIndex, 7); assert.equal(state.playlistLength, 160);
    assert.equal(state.currentTrack.name, 'Native song'); assert.equal(state.playbackSpeed, 1.5);
    assert.equal(state.preservePitch, false); assert.equal(state.playerVolume, 42); assert.equal(state.playerMute, true);
    assert.equal(state.queueWindow.rows.length, 80);
    assert.equal(musicPlayerOwnsMidi({ player }), false);
    await player.playbackManager.refreshCatalogQueuePage(80);
    const page = player.stateManager.getStateSnapshot().queueWindow;
    assert.equal(page.rows[0].name, '80'); assert.equal(page.rows.at(-1).name, '159');
    player.stateManager.updateState({ currentTrackName: 'Artist - Tag title' });
    context.acceptPlayback({ revision: 8, playback: { ...playback, playing: true, restoredUnloaded: false } });
    assert.equal(player.stateManager.getStateSnapshot().currentTrackName, 'Artist - Tag title');
    assert.equal(player.stateManager.getStateSnapshot().queueWindow, page);
    assert.deepEqual(requests, [[0, 64], [64, 16], [80, 64], [144, 16]]);
    assert.equal(musicPlayerOwnsMidi({ player }), true);
    context.acceptPlayback({ revision: 8, playback: { ...playback, stopped: true, restoredUnloaded: false } });
    assert.equal(player.stateManager.getStateSnapshot().isStopped, true);
    assert.equal(player.stateManager.getStateSnapshot().isPaused, false);
    context.acceptPlayback({ revision: 8, playback: { source: null, index: -1, queueLength: 0 } });
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

test('normal Android rebuild retains an unchanged SFZ asset while routing and order change', async () => {
    const bank = { payload: Uint8Array.of(1, 2, 3).buffer, operationRevision: 4 };
    class SFZNotePlayerPlugin {
        constructor(id) { this.id = id; this.enabled = true; this.name = 'SFZ'; }
        getParameters() { return {}; }
        getWasmAssets() { return new Map([[0, bank]]); }
    }
    class VolumePlugin {
        constructor() { this.id = 19; this.enabled = true; this.name = 'Volume'; }
        getParameters() { return { vl: 0 }; }
    }
    const sfz = new SFZNotePlayerPlugin(17), volume = new VolumePlugin();
    const commands = [];
    const manager = Object.create(AndroidAudioManager.prototype);
    const bridge = { async request(command, payload, revision) {
        commands.push({ command, payload, revision });
        return { revision: revision + 1 };
    } };
    Object.assign(manager, {
        bridge, nativeAssets: new AndroidAssets(bridge), pendingMutation: Promise.resolve(),
        currentPipeline: 'A', externalPipelineEpoch: 0, snapshot: { revision: 10 },
        acceptSnapshot(snapshot) { this.snapshot = snapshot; },
        dispatchEvent() {},
    });
    manager.pipeline = [sfz];
    await manager.rebuildPipeline();
    assert.equal(commands.filter(item => item.command === 'pipeline.asset.commit').length, 1);
    const batch = commands.find(item => item.command === 'pipeline.asset.begin').payload._assetBatch;
    assert.ok(batch);
    assert.ok(commands.filter(item => item.command.startsWith('pipeline.asset.'))
        .every(item => item.payload._assetBatch === batch));
    const descriptor = commands[0].payload.descriptor;
    commands.length = 0;
    sfz.inputBus = 1;
    manager.pipeline = [volume, sfz];
    await manager.rebuildPipeline();
    assert.notEqual(commands[0].payload.descriptor, descriptor);
    assert.deepEqual(commands.map(item => item.command), ['pipeline.set']);
    assert.equal(manager.nativeAssets.resident.get('17:0'), bank);

    manager.pipeline = [volume];
    await manager.rebuildPipeline();
    assert.equal(manager.nativeAssets.resident.has('17:0'), false);
    commands.length = 0;
    manager.pipeline = [volume, new SFZNotePlayerPlugin(17)];
    await manager.rebuildPipeline();
    assert.equal(commands.filter(item => item.command === 'pipeline.asset.commit').length, 1);
});

test('Android supplies SoundFont pages through the shared stream with native preparation geometry', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const calls = [], events = new Map(), pages = [];
        const context = { sampleRate: 192000, processingChannels: 1, maxFrames: 128, minimumPhysicalBpm: 42 };
        const request = { generation: 27, sample: 2, pageIndex: 4 };
        const bridge = { on: (name, listener) => events.set(name, listener), async request(command, payload) {
            calls.push({ command, payload });
            if (command === 'sfz.preparationContext') return { ok: true, context };
            if (command === 'sfz.poll') return { ok: true, requests: [request], limited: false,
                readiness: { scope: 2, pendingPages: 0, plannedPages: 1 } };
            return { ok: true };
        } };
        const manager = new AndroidAudioManager(null, { bridge });
        const id = 7, revision = 4;
        const pcm = Float32Array.of(99, 0.5, -0.5, 99).subarray(1, 3);
        let closed = false, rejection;
        const asset = { operationRevision: revision, footprintBytes: 12345, payload: new ArrayBuffer(32),
            async sampleProviderFactory({ publish, onProvider, publishWindow, generation }) {
                assert.equal(publishWindow, 16);
                onProvider({ requestPages: wanted => pages.push(...wanted), close() { closed = true; } });
                assert.equal(await publish({ generation, sample: 2, pageIndex: 0, frames: 1, channels: 2,
                    resident: true, pcm }), true);
            } };
        class SoundFontPlayerPlugin {
            onWasmAssetRejected(...args) { rejection = args; }
            getWasmAssets() { return new Map([[0, asset]]); }
            getWasmAssetOperationRevision() { return revision; }
            getWasmAssetRevisionDescriptor(slot, token) { return slot === 0 && token === revision ? asset : null; }
        }
        const plugin = new SoundFontPlayerPlugin();
        plugin.id = id;
        manager.pipeline = [plugin];
        assert.equal(manager.hasSfzSampleStreaming(), true);
        assert.equal(manager._getActiveDspWorklets().has(manager.sfzEndpoint), false);
        assert.deepEqual(await manager.getSfzPreparationContext(plugin), { ...context, playerKind: 1 });
        manager.nativeAssets.synchronize([plugin], () => {});
        await manager.nativeAssets.transfer([plugin]);
        assert.equal(calls.find(c => c.command === 'pipeline.asset.begin').payload.footprintBytes, asset.footprintBytes);
        events.get('sfz-stream')({ type: 'sfzStreamReady', pluginId: id, generation: 27, operationRevision: revision, token: 91 });
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(pages, [request]);
        const publication = calls.find(c => c.command === 'sfz.publish').payload;
        assert.equal(publication.token, 91);
        assert.equal(publication.operationRevision, revision);
        assert.deepEqual(base64ToBytes(publication.page.pcm), new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
        assert.equal(manager._sfzSampleStreams.get(manager.sfzEndpoint).get(id).initialCacheReady, true);
        manager.setSoundFontMidiMetering(plugin, true);
        assert.deepEqual(calls.find(c => c.command === 'sfz.midiMetering').payload, { pluginId: id, enabled: true });
        await manager.sendSfzMessage({ type: 'sfzStreamFailed', generation: 27, pluginId: id });
        assert.deepEqual(calls.at(-1), { command: 'sfz.failed', payload: { pluginId: id, generation: 27,
            operationRevision: revision, token: 91 } });
        events.get('sfz-stream')({ type: 'sfzStreamStop', pluginId: id, generation: 27 });
        assert.equal(closed, true);
        events.get('asset-state')({ pluginId: id, slot: 0, rejected: true, reason: 'sample-read', operationRevision: revision });
        assert.deepEqual(rejection, [0, 'sample-read', revision]);
    });
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

test('native SoundFont Player keyboard and mixer reach the Service through pipeline.preview', async () => {
    class SoundFontPlayerPlugin { constructor(id) { this.id = id; } }
    const plugin = new SoundFontPlayerPlugin(5), manager = Object.create(AndroidAudioManager.prototype), calls = [];
    manager.bridge = { request: async (name, payload) => { calls.push({ name, payload }); return { appliedFrame: 4800 }; } };
    manager.acceptSnapshot = () => {};
    manager.rebuildPipeline = () => assert.fail('Preview must not create canonical history');
    manager.pipeline = [plugin];
    manager.snapshot = { assetRefs: {} };
    await assert.rejects(manager.sendSoundFontMixerAction(plugin, { type: 'mute', channel: 2, value: true }), /ready/);
    manager.snapshot = { assetRefs: { 'SoundFontPlayerPlugin:5:0': {} } };
    manager.commitPowerTopologyMutation({ plugin: { id: 5, type: 'SoundFontPlayerPlugin', parameters: { pm: 30, pc: 9 } } },
        { reason: 'sfz-note-preview' });
    const action = { type: 'control', channel: 3, controller: 7, value: 90 };
    assert.equal(await manager.sendSoundFontMixerAction(plugin, action, true), 4800);
    assert.equal(await manager.sendSoundFontMixerAction(plugin, action), true);
    assert.deepEqual(calls.slice(0, 2), [
        { name: 'pipeline.preview', payload: { pluginId: 5, pm: 30, pc: 9 } },
        { name: 'pipeline.preview', payload: { pluginId: 5, action } }
    ]);
});

test('Android frequency preview and effect Reset reach the Service in the desktop message shape', async () => {
    const manager = Object.create(AndroidAudioManager.prototype), calls = [];
    manager.bridge = { request: async (name, payload) => { calls.push({ name, payload }); return {}; } };
    manager.acceptSnapshot = () => {};
    manager.setFrequencyPreview(1000, 'bandpassNoise');
    manager.setFrequencyPreview(null);
    manager.resetPluginState(7);
    await Promise.resolve();
    assert.deepEqual(calls, [
        { name: 'pipeline.frequencyPreview', payload: { frequency: 1000, sound: 'bandpassNoise' } },
        { name: 'pipeline.frequencyPreview', payload: { frequency: 0, sound: 'sine' } },
        { name: 'pipeline.resetPlugin', payload: { pluginId: 7 } }
    ]);
});

test('Android Service errors show plain guidance only for actionable codes', async () => {
    const shown = [], warnings = [], transient = [];
    await withGlobals({ window: { uiManager: { setError: (key, isError) => shown.push([key, isError]),
        showTransientMessage: (...args) => transient.push(args) } },
        console: { ...console, warn: (...args) => warnings.push(args) } }, () => {
        const manager = Object.create(AndroidAudioManager.prototype);
        for (const code of ['source-unavailable', 'track-unavailable', 'audio-unavailable', 'input-unavailable', 'pipeline-failed', 'audio-focus-denied', 'stale-pipeline', 'operation-failed']) {
            manager.reportHostError({ code, count: 3, message: 'details' });
        }
    });
    assert.deepEqual(shown, [['error.audioPlaybackFailed', true], ['error.audioOutputStopped', true],
        ['error.audioInputUnavailable', true], ['error.audioEffectFailed', true], ['error.audioFocusDenied', true]]);
    assert.equal(warnings.length, 8);
    assert.deepEqual(transient, [['status.libraryTracksSkippedOffline', false, { count: 3 }]]);
});

test('Android Gapless Playback changes reach the Service', async () => {
    const context = Object.create(AndroidPlayerContext.prototype), calls = [], accepted = [];
    Object.assign(context, { audioPlayer: { gaplessPlayback: true },
        audioManager: { acceptSnapshot: snapshot => accepted.push(snapshot) },
        bridge: { request: async (name, payload) => {
            calls.push({ name, payload });
            assert.equal(context.audioPlayer.gaplessPlayback, true);
            return { revision: 3, gaplessPlayback: false };
        } } });
    assert.equal(await context.applyGaplessPlaybackPreference(false), true);
    assert.equal(context.audioPlayer.gaplessPlayback, false);
    assert.deepEqual(calls, [{ name: 'audio.configure', payload: { gaplessPlayback: false } }]);
    assert.deepEqual(accepted, [{ revision: 3, gaplessPlayback: false }]);
});

test('Android visualizer sources reach the Service in the desktop source format', async () => {
    const manager = Object.create(AndroidAudioManager.prototype), calls = [];
    manager.bridge = { request: async (name, payload) => calls.push({ name, payload }) };
    manager.visualizerSources = [{ tapId: 0xf0000001, type: 'LevelMeterPlugin', channel: 'L',
        packed: new Float32Array([0.5, 2]), paramsHash: 7, gain: 1 }];
    manager._postVisualizerSources();
    await Promise.resolve();
    assert.deepEqual(calls, [{ name: 'visualizer.sources', payload: { sources: [{ tapId: 0xf0000001,
        type: 'LevelMeterPlugin', channel: 'L', params: [0.5, 2], paramsHash: 7, gain: 1 }] } }]);
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

test('only an explicit Android output resume starts a stopped source-only pipeline', async () => {
    const commands = [];
    const manager = Object.assign(Object.create(AndroidAudioManager.prototype), {
        snapshot: { outputStopReason: 'feature-page', outputStarted: true },
        bridge: { async request(name) { commands.push(name); return { outputStarted: true }; } },
        acceptSnapshot(value) { this.snapshot = value; }
    });
    await manager.fadeInOutputWhenReady();
    assert.deepEqual(commands, []);
    await manager.resumeStoppedOutput();
    await manager.resumeStoppedOutput();
    assert.deepEqual(commands, ['audio.start']);
});

test('denied startup focus leaves the Android output available for explicit retry', async () => {
    const denied = Object.assign(new Error('focus'), { code: 'audio-focus-denied' });
    let calls = 0;
    const manager = Object.assign(Object.create(AndroidAudioManager.prototype), {
        startInitialOutput: true,
        bridge: { async request(name) {
            assert.equal(name, 'audio.start');
            if (++calls === 1) {
                manager.snapshot = { outputStarted: true, outputStopReason: denied.code };
                throw denied;
            }
            return { outputStarted: true };
        } },
        acceptSnapshot(value) { this.snapshot = value; }
    });
    await manager.fadeInOutputWhenReady();
    assert.equal(manager.outputErrorKey, 'error.audioFocusDenied');
    await manager.fadeInOutputWhenReady();
    assert.equal(calls, 1);
    await manager.resumeStoppedOutput();
    assert.equal(calls, 2);
    assert.equal(manager.outputErrorKey, null);
    manager.startInitialOutput = true;
    manager.bridge.request = async () => { throw new Error('disconnected'); };
    await assert.rejects(manager.fadeInOutputWhenReady(), /disconnected/);
});

test('renderer recreation never starts an existing stopped Android Service', async () => {
    const commands = [];
    let revision = 8, outputStarted = true;
    const manager = { bridge: { request: async command => {
        if (command === 'snapshot.get') return { revision, powerState: 'SUSPENDED', outputStarted };
        commands.push(command); return { revision: ++revision };
    } }, acceptSnapshot() {}, _postVisualizerSources() {}, async applyPersistedPowerSettings() {} };
    await withGlobals({ window: {} }, () => AndroidAudioManager.prototype.initAudio.call(manager));
    await AndroidAudioManager.prototype.fadeInOutputWhenReady.call(manager);
    assert.deepEqual(commands, []);
    // A restarted Service restores its saved pipeline (revision 1) without having started its output.
    revision = 1; outputStarted = false;
    await withGlobals({ window: {} }, () => AndroidAudioManager.prototype.initAudio.call(manager));
    await AndroidAudioManager.prototype.fadeInOutputWhenReady.call(manager);
    await AndroidAudioManager.prototype.fadeInOutputWhenReady.call(manager);
    assert.deepEqual(commands, ['audio.start']);
    assert.equal(revision, 2);
});

test('an Android sample rate change resends the chain and returns to the previous rate when it cannot be built', async () => {
    const requests = [], rebuilt = [];
    let failing = false;
    const manager = {
        snapshot: { revision: 1, sampleRate: 48000 },
        bridge: { request: async (command, payload) => {
            requests.push({ command, payload });
            return { revision: manager.snapshot.revision + 1, sampleRate: payload.sampleRate ?? manager.snapshot.sampleRate };
        } },
        acceptSnapshot(snapshot) { this.snapshot = snapshot; },
        dispatchEvent() {}, getOutputChannelCount() { return 2; },
        _postVisualizerSources() {},
        async rebuildPipeline() {
            rebuilt.push(this.snapshot.sampleRate);
            if (failing && this.snapshot.sampleRate === 96000) throw new Error('pipeline');
            return '';
        }
    };
    const reset = preferences => AndroidAudioManager.prototype.reset.call(manager, preferences);
    await withGlobals({ window: { electronIntegration: { saveAudioPreferences: async () => true } } }, async () => {
        await reset({ sampleRate: 48000 });
        assert.deepEqual(rebuilt, []);
        await reset({ sampleRate: 96000 });
        await reset({ sampleRate: 48000 });
        assert.deepEqual(rebuilt, [96000, 48000]);
        failing = true;
        await assert.rejects(reset({ sampleRate: 96000 }), /pipeline/);
    });
    assert.deepEqual(rebuilt, [96000, 48000, 96000, 48000]);
    assert.deepEqual(requests.at(-1), { command: 'audio.configure', payload: { sampleRate: 48000 } });
    assert.equal(manager.snapshot.sampleRate, 48000);
});

test('Android rebuilds the graph at the device width and restores the previous width on failure', async () => {
    const widths = [], stored = [];
    const manager = {
        snapshot: { revision: 1, sampleRate: 48000, channelCount: 2 },
        bridge: { async request(command, payload) {
            assert.equal(command, 'audio.configure');
            return { ...manager.snapshot, revision: manager.snapshot.revision + 1,
                channelCount: payload.channelCount === 16 ? 6 : payload.channelCount };
        } },
        acceptSnapshot(snapshot) { this.snapshot = snapshot; },
        dispatchEvent() {},
        getOutputChannelCount() { return this.snapshot.channelCount; },
        _postVisualizerSources() {},
        async rebuildPipeline() {
            widths.push(this.snapshot.channelCount);
            if (this.snapshot.channelCount === 3) throw new Error('pipeline');
        }
    };
    const reset = outputChannels => AndroidAudioManager.prototype.reset.call(manager, { outputChannels });
    await withGlobals({ window: { electronIntegration: { saveAudioPreferences: prefs => stored.push(prefs) } } }, async () => {
        await reset(16);
        await assert.rejects(reset(3), /pipeline/);
    });
    assert.deepEqual(widths, [6, 3, 6]);
    assert.deepEqual(stored.map(prefs => prefs.outputChannels), [6, 6]);
    assert.equal(manager.snapshot.channelCount, 6);
});

test('switching to an Android chain packed for another rate packs it again once', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const requests = [];
        // The Service reports the mismatch until it receives the chain packed for its rate.
        let snapshot = { revision: 1, sampleRate: 96000, channelCount: 2, slot: 'A', pipelines: { A: [], B: [] } };
        const bridge = { on() {}, async request(command, payload) {
            requests.push({ command, payload });
            if (command === 'pipeline.slot') snapshot = { ...snapshot, slot: payload.slot, pipelineRateMismatch: true };
            if (command === 'pipeline.set') snapshot = { ...snapshot, pipelineRateMismatch: false };
            if (command !== 'snapshot.get') snapshot = { ...snapshot, revision: snapshot.revision + 1 };
            return snapshot;
        } };
        const manager = new AndroidAudioManager(null, { bridge });
        await manager.initAudio();
        await manager.hydratePipeline({ pluginClasses: {}, nextPluginId: 1 });
        await manager.setCurrentPipeline('B');
        const packed = requests.filter(request => request.command === 'pipeline.set');
        assert.equal(packed.length, 1);
        assert.equal(packed[0].payload.slot, 'B');
        assert.equal(packed[0].payload.sampleRate, 96000);
    });
});

test('Android restores a missing B and accepts the copied A on first switch', async () => {
    const sandbox = { window: {}, document: {}, console, performance, setTimeout, clearTimeout };
    vm.runInNewContext(fs.readFileSync(new URL('../../plugins/plugin-base.js', import.meta.url), 'utf8') + '\n' +
        fs.readFileSync(new URL('../../plugins/basics/volume.js', import.meta.url), 'utf8') +
        '\nVolumePlugin.prototype.audioHostActive=false;this.VolumePlugin=VolumePlugin;', sandbox);
    const plugin = new sandbox.VolumePlugin();
    plugin.id = 51; plugin.setParameters({ vl: -9 });
    const record = prepareAndroidPipeline([plugin], { sampleRate: 48000 }).plugins[0];
    const manager = Object.assign(Object.create(AndroidAudioManager.prototype), {
        pipelineA: [], pipelineB: null, catalogPublished: true,
        snapshot: { revision: 1, slot: 'A', pipelines: { A: [record], B: null } },
        nativeAssets: new AndroidAssets({}), pipelineProcessor: { setPipeline() {} },
        publishExecutionStates() {}, pendingMutation: Promise.resolve(),
        bridge: { async request(command, payload) {
            assert.equal(command, 'pipeline.slot'); assert.deepEqual(payload, { slot: 'B' });
            return { revision: 2, slot: 'B', pipelines: { A: [record], B: [record] } };
        } },
        acceptSnapshot(snapshot) { this.snapshot = snapshot; },
        async restoreNativePipeline() { await this.hydratePipeline({ nextPluginId: 1, createPlugin: () => new sandbox.VolumePlugin() }); }
    });
    await withGlobals({ window: {} }, async () => {
        await manager.hydratePipeline({ nextPluginId: 1, createPlugin: () => new sandbox.VolumePlugin() });
        assert.equal(manager.pipelineB, null);
        await manager.togglePipeline();
        assert.equal(manager.currentPipeline, 'B');
        assert.equal(manager.pipelineB[0].vl, -9);
        assert.notEqual(manager.pipelineA[0], manager.pipelineB[0]);
    });
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
    assert.equal(event.timeStamp, event.receivedTime);
    listeners.get('midi-connected')({ id: '1:out:0', type: 'output', name: 'Synth' });
    const output = access.outputs.get('1:out:0');
    output.send([0x90, 60, 127], performance.now() + 50);
    assert.equal(commands.at(-1).command, 'midi.send');
    assert.equal(commands.at(-1).payload.data, 'kDx/');
    assert.ok(commands.at(-1).payload.delayMs <= 50);
    listeners.get('midi-disconnected')({ id: output.id });
    assert.equal(output.state, 'disconnected');
    states.splice(0);
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

test('Android sends controller hydration before the next live note and resets on disconnect', async () => {
    const manager = Object.create(AndroidAudioManager.prototype);
    const calls = [];
    manager.bridge = { async request(command, payload) { calls.push({ command, payload }); } };
    manager.setLiveMidiInputSource('Keys');
    const send = (...bytes) => manager.enqueueLiveMidiInput({ sourceKey: 'Keys',
        data: Uint8Array.from(bytes), timeStamp: performance.now() });
    assert.equal(send(0xc0, 5), true);
    assert.equal(send(0x90, 60, 90), true);
    const note = calls.at(-1).payload;
    assert.equal(note.message, 0x5a3c90);
    assert.ok(note.note > 0);
    assert.ok(note.state.includes(0x5c0));
    assert.equal(send(0x80, 60, 0), true);
    assert.equal(calls.at(-1).payload.state, undefined);
    manager.setLiveMidiInputSource(null);
    assert.equal(send(0x90, 64, 80), false);
    assert.deepEqual(calls.at(-1), { command: 'midi.liveSource', payload: { enabled: false } });
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

test('Android native parameters include values added for the DSP payload', () => {
    class NoteSpectrogramPlugin {
        constructor() { this.id = 1; this.name = 'Note Spectrogram'; this.enabled = true; }
        getParameters() { return { mn: 21, mx: 108, ck: 0 }; }
        getWorkletPluginData(parameters) { return { parameters: { ...parameters, te: 1 } }; }
    }
    const record = prepareAndroidPipeline([new NoteSpectrogramPlugin()]).plugins[0];
    assert.equal(record.parameters.te, 1);
    assert.deepEqual(record.parameterValues, [21, 108, 1, 0]);
});

test('Android native parameters leave held keyboard preview state to the Service', () => {
    class SFZNotePlayerPlugin {
        constructor() { this.id = 1; this.name = 'SFZ Note Player'; this.enabled = true; }
        getParameters() { return { og: -1 }; }
        getWorkletPluginData(parameters) { return { parameters: { ...parameters, pm: 69, pv: 64 } }; }
    }
    const record = prepareAndroidPipeline([new SFZNotePlayerPlugin()]).plugins[0];
    assert.equal(record.parameters.og, -1);
    assert.equal('pm' in record.parameters || 'pv' in record.parameters, false);
    assert.deepEqual(record.parameterValues.slice(17, 19), [-1, 100]);
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

function blindAssetFixture(request) {
    class VolumePlugin {
        constructor(signature) { this.id = 7; this.name = 'Volume'; this.enabled = true; this.signature = signature; }
        getParameters() { return { vl: 0 }; }
        getWasmAssets() { return new Map([[0, { payload: Uint8Array.of(42).buffer,
            formatTag: 1, operationRevision: 2, externalAssetSignature: this.signature }]]); }
    }
    const manager = Object.assign(Object.create(AndroidAudioManager.prototype), {
        currentPipeline: 'B', pipelineA: [new VolumePlugin('other')], pipelineB: [new VolumePlugin('current')],
        snapshot: { revision: 12 }, bridge: { request }, dispatchEvent() {}
    });
    manager.pipeline = manager.pipelineB;
    return manager;
}

test('a stopped primary graph can finish a pending asset before starting blind preparation', async () => {
    const calls = [];
    const manager = blindAssetFixture(async (name, payload) => {
        calls.push(name);
        if (name === 'audio.start') {
            manager.pipelineB[0].externalAssetInfo.pending = false;
            return { ...manager.snapshot, powerState: 'ACTIVE' };
        }
        if (name === 'dbt.start') assert.equal(payload.pipeline.prepareAssets, true);
        return name === 'dbt.align' ? { ready: true } : {};
    });
    manager.snapshot.powerState = 'SUSPENDED';
    manager.acceptSnapshot = snapshot => { manager.snapshot = snapshot; };
    manager.pipelineB[0].externalAssetInfo = { pending: true, assetSignature: 'current' };
    try {
        assert.equal(await manager.enableParallelPipelines(), true);
        assert.deepEqual(calls.slice(0, 2), ['audio.start', 'dbt.start']);
    } finally {
        await manager.disableParallelPipelines();
    }
});

test('Android requests audio processing when preparing assets in each blind pipeline', async () => {
    for (const assetSlot of ['A', 'B']) {
        const manager = blindAssetFixture(async (name, payload) => {
            if (name === 'dbt.start') assert.equal(payload.pipeline.prepareAssets, true);
            return name === 'dbt.align' ? { ready: true } : {};
        });
        manager[assetSlot === 'A' ? 'pipelineB' : 'pipelineA'] = [];
        manager.pipeline = manager.pipelineB;
        try {
            assert.equal(await manager.enableParallelPipelines(), true);
        } finally {
            await manager.disableParallelPipelines();
        }
    }
});

test('Android blind selection sends a live note once and preserves the input after stop', async () => {
    const calls = [];
    const manager = blindAssetFixture(async (command, payload) => {
        calls.push([command, payload]);
        return command === 'dbt.align' ? { ready: true } : {};
    });
    manager.setLiveMidiInputSource('keyboard');
    const note = key => manager.enqueueLiveMidiInput({
        sourceKey: 'keyboard', data: [0x90, key, 100], timeStamp: performance.now()
    });
    try {
        assert.equal(await manager.enableParallelPipelines('A'), true);
        note(60);
        assert.equal(await manager.setBlindSelection('B'), true);
        note(62);
    } finally {
        await manager.disableParallelPipelines();
    }
    note(64);
    assert.deepEqual(calls.filter(([cmd]) => cmd === 'midi.liveEvent').map(([, event]) => event.message),
        [60, 62, 64].map(key => 0x90 | key << 8 | 100 << 16));
    assert.equal(calls.filter(([cmd]) => cmd === 'midi.liveSource').length, 1);
});

test('Android blind selection waits for secondary pipeline assets with overlapping plugin IDs', async () => {
    const calls = [];
    let align;
    const waiting = Promise.withResolvers();
    const manager = blindAssetFixture(async (command, payload) => {
        calls.push([command, payload]);
        if (command === 'dbt.align') {
            align = payload;
            return waiting.promise;
        }
        return {};
    });
    const start = manager.enableParallelPipelines('A');
    try {
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(calls.map(([command]) => command), ['dbt.start', 'pipeline.asset.begin',
            'pipeline.asset.chunk', 'pipeline.asset.commit', 'dbt.align']);
        assert.equal(calls[0][1].pipeline.slot, 'A');
        assert.equal(calls[1][1].externalAssetSignature, 'other');
        assert.ok(calls.slice(1, 4).every(([, payload]) => payload.branch === 1));
        assert.deepEqual(align, { primary: { 'VolumePlugin:7:0': 'current' }, secondary: { 'VolumePlugin:7:0': 'other' } });
        assert.equal(await manager.setBlindSelection('A'), false);
        waiting.resolve({ ready: true });
        assert.equal(await start, true);
        assert.deepEqual(calls.at(-1), ['dbt.select', { branch: 1, seconds: 0 }]);
        const assets = manager.blindTest.assets;
        await manager.disableParallelPipelines();
        assert.equal(assets.resident.size, 0);
        assert.equal(calls.at(-1)[0], 'dbt.stop');
    } finally {
        waiting.resolve({ ready: false });
        await manager.disableParallelPipelines();
    }
});

test('cancelling an Android blind asset upload prevents late commit and selection', async () => {
    const calls = [], chunk = Promise.withResolvers();
    const manager = blindAssetFixture(async command => {
        calls.push(command);
        return command === 'pipeline.asset.chunk' ? chunk.promise : {};
    });
    const start = manager.enableParallelPipelines('A');
    try {
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(calls.at(-1), 'pipeline.asset.chunk');
        await manager.disableParallelPipelines();
        chunk.resolve({});
        assert.equal(await start, false);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(calls, ['dbt.start', 'pipeline.asset.begin', 'pipeline.asset.chunk', 'dbt.stop']);
    } finally {
        chunk.resolve({});
        await manager.disableParallelPipelines();
    }
});

test('Android blind sampler pages use the endpoint of the originating bank', async () => {
    const calls = [], replies = [];
    const manager = blindAssetFixture(async (command, payload) => {
        calls.push([command, payload]);
        return { ok: true, requests: [] };
    });
    manager.sfzEndpoint = manager.createSfzEndpoint(0);
    const endpoint = manager.createSfzEndpoint(1);
    manager.blindTest = { endpoint, plugins: manager.pipelineA, loaders: new Map() };
    manager._sfzSampleStreams = new Map([manager.sfzEndpoint, endpoint].map((node, index) =>
        [node, new Map([[7, { generation: 3, operationRevision: 8, token: index + 10 }]])]));
    manager._handleSfzRuntimeMessage = (node, data) => replies.push([node, data]);
    manager.acceptSfzEvent({ type: 'sfzStreamReady', branch: 1, pluginId: 7, operationRevision: 8 });
    assert.equal(replies[0][0], endpoint);
    assert.equal(replies[0][1].plugin, manager.pipelineA[0]);
    for (const node of [manager.sfzEndpoint, endpoint]) {
        await manager.sendSfzMessage({ type: 'sfzPollPages', requestId: 1, pluginId: 7, generation: 3 }, node);
    }
    assert.deepEqual(calls.map(([name, payload]) => [name, payload.branch ?? 0, payload.token]),
        [['sfz.poll', 0, 10], ['sfz.poll', 1, 11]]);
    assert.equal(replies.at(-1)[0], endpoint);
    manager.blindTest = null;
    await manager.sendSfzMessage({ type: 'sfzPollPages', pluginId: 7, generation: 3 }, endpoint);
    assert.equal(calls.length, 2);
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

test('native assets defer readiness and use the notice operation revision', async () => {
    const states = [], rejections = [];
    let receive;
    const asset = { payload: new ArrayBuffer(8), operationRevision: 5, formatTag: 1 };
    const plugin = { id: 47, getWasmAssets: () => new Map([[0, asset]]),
        onWasmAssetState: (...args) => states.push(args),
        onWasmAssetRejected: (...args) => rejections.push(args) };
    const host = new AndroidAssets({
        on(name, listener) { if (name === 'asset-state') receive = listener; },
        async request(name) { if (name === 'pipeline.asset.commit') return { state: 'pending' }; },
    });
    host.synchronize([plugin], () => {});
    await host.transfer([plugin]);
    assert.deepEqual(states, []);
    receive({ pluginId: 47, slot: 0, state: 3, operationRevision: 4 });
    receive({ pluginId: 47, slot: 0, rejected: true, operationRevision: 5 });
    assert.deepEqual(states, [[0, 3, 4]]);
    assert.deepEqual(rejections, [[0, 'prepare', 5]]);
    assert.equal(host.resident.has('47:0'), false);
});

test('Android queue items use the common track gain and peak ceiling', async () => {
    const context = Object.create(AndroidPlayerContext.prototype);
    context.audioPlayer = { replayGain: { mode: 'track', preampDb: 6, preventClipping: true, peakCeilingDb: 0 } };
    context.resolveNativeSource = async track => ({ uri: track.uri, libraryTrackId: track.libraryTrackId });
    context.readPlaybackReplayGain = async track => track.libraryTrackId === 'loud'
        ? { trackGainDb: 0, trackPeak: 0.8 } : { trackGainDb: -12 };
    const tracks = ['loud', 'quiet'].map(id => ({ uri: 'content://music/' + id, libraryTrackId: id }));
    assert.equal((await context.resolveQueueItem(tracks, null, 0)).replayGainFactor, 1.25);
    assert.equal((await context.resolveQueueItem(tracks, null, 1)).replayGainFactor, 10 ** (-6 / 20));
    context.audioPlayer.replayGain.mode = 'off';
    assert.equal((await context.resolveQueueItem(tracks, null, 0)).replayGainFactor, 1);
});

test('Android refreshes the playing and prepared entries before the rest of the stored queue', async () => {
    const entries = [5, 12, 53].map(queueEntryId => ({
        queueEntryId, uri: 'https://example.org/private/' + queueEntryId, libraryTrackId: String(queueEntryId)
    }));
    const sent = [];
    const queue = new AndroidPlaybackQueue({ async request(command, payload) {
        if (command === 'playback.queue.readGains') {
            if (!payload) return { items: [entries[2], entries[1]] };
            return { items: entries.filter(entry => entry.queueEntryId > payload.afterId).slice(0, 2) };
        }
        assert.equal(command, 'playback.queue.updateGains');
        sent.push(payload.items);
        return {};
    } });
    const player = Object.create(AudioPlayer.prototype);
    player.audioManager = { isAndroid: true };
    player.contextManager = Object.assign(Object.create(AndroidPlayerContext.prototype), {
        audioPlayer: player, nativeQueue: queue
    });
    let trackPlr = 12, measured = -20;
    const manager = new LibraryManagerV2({ uiManager: { audioPlayer: player } });
    manager.client = {
        async getLoudnessStats({ coverage }) { assert.equal(coverage, 90); return { trackPlr }; },
        async getTrackLoudness({ trackUid }) {
            return { integrated: measured + (trackUid === '53' ? 3 : 0), truePeak: -6 };
        },
        async finalizeLoudness() { trackPlr = 16; measured = -22; }
    };
    const expectUpdates = (current, others) => {
        assert.deepEqual(sent.splice(0), [[{ queueEntryId: 53, replayGainFactor: current }],
            [{ queueEntryId: 12, replayGainFactor: others }], [{ queueEntryId: 5, replayGainFactor: others }]]);
    };
    await withGlobals({ window: { uiManager: { libraryManager: manager } } }, async () => {
        await player.applyReplayGainPreference({ mode: 'track', target: 'auto', autoCoverage: 90 });
        assert.equal(player.replayGain.autoTarget, -12);
        expectUpdates(10 ** (5 / 20), 10 ** (8 / 20));
        await manager.refreshLoudness();
        assert.equal(player.replayGain.autoTarget, -16);
        expectUpdates(10 ** (3 / 20), 10 ** (6 / 20));
        await player.applyReplayGainPreference({ mode: 'off' });
        expectUpdates(1, 1);
    });
});

test('a superseded Android gain read cannot overwrite the latest factor', async () => {
    const source = { queueEntryId: 7 };
    const writes = [];
    const queue = new AndroidPlaybackQueue({ async request(command, payload) {
        if (command === 'playback.queue.readGains') return { items: payload ? [] : [source] };
        writes.push(...payload.items);
    } });
    const context = Object.assign(Object.create(AndroidPlayerContext.prototype), { nativeQueue: queue });
    const started = Promise.withResolvers(), oldGain = Promise.withResolvers();
    context.nativeReplayGain = () => { started.resolve(); return oldGain.promise; };
    const first = context.applyReplayGainPreference();
    await started.promise;
    context.nativeReplayGain = () => 0.5;
    await context.applyReplayGainPreference();
    oldGain.resolve(2);
    await first;
    assert.deepEqual(writes, [{ queueEntryId: 7, replayGainFactor: 0.5 }]);
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

test('Android Back dismisses one layer and Visualizer system bars follow page visibility', () => {
    const win = new EventTarget();
    let notify, expanded = false;
    const bars = [];
    const observed = new Map();
    const dismissed = [];
    const control = (name, zIndex, id) => ({
        id, zIndex, open: true,
        closest: () => null,
        getClientRects: () => [{}],
        click() { this.open = false; dismissed.push(name); }
    });
    const dbt = control('DBT', 0);
    const ab = control('A/B', 900, 'pipelineMenu');
    const mapping = control('Mapping', 10030);
    const config = control('Config', 1000);
    const menu = control('Menu', 1200);
    const modal = { open: true, contains: () => false,
        dispatchEvent: event => event.type === 'cancel',
        close() { this.open = false; dismissed.push('Modal'); } };
    const popover = { open: true, contains: () => false,
        hidePopover() { this.open = false; dismissed.push('Network Output'); } };
    win.MutationObserver = class {
        constructor(callback) { notify = callback; }
        observe(node, options) { observed.set(node, options.attributeFilter); }
    };
    win.document = {
        documentElement: { dataset: { theme: 'paper' } },
        body: { classList: { contains: name => name === 'visualizer-expanded' && expanded } },
        querySelectorAll(selector) {
            if (selector === 'dialog[open]') return modal.open ? [modal] : [];
            if (selector === ':popover-open') return popover.open ? [popover] : [];
            return [dbt, ab, menu, mapping, config].filter(item => item.open);
        },
        querySelector: () => null
    };
    win.getComputedStyle = element => ({ zIndex: element.zIndex });
    win.uiManager = {
        mobileMenu: { panel: menu, close: () => menu.click() },
        hidePipelineMenu: () => ab.click(),
        visualizerView: { get expanded() { return expanded; }, setExpanded(value) { expanded = value; notify(); } }
    };
    installAndroidWindowUi(win, { async request(command, { expanded, light }) {
        assert.equal(command, 'window.systemBars');
        bars.push([expanded, light]);
    } });
    assert.deepEqual(observed.get(win.document.body), ['class']);
    assert.deepEqual(observed.get(win.document.documentElement), ['data-theme']);
    win.document.documentElement.dataset.theme = 'mint';
    notify();
    win.document.documentElement.dataset.theme = 'graphite';
    notify();
    win.uiManager.visualizerView.setExpanded(true);
    const order = ['Modal', 'Network Output', 'Mapping', 'Menu', 'Config', 'A/B', 'DBT'];
    for (let index = 0; index < order.length; index++) {
        assert.equal(win.effetuneHandleBack(), true);
        assert.deepEqual(dismissed, order.slice(0, index + 1));
    }
    assert.equal(expanded, true);
    notify();
    win.dispatchEvent(new Event('pagehide'));
    win.dispatchEvent(new Event('pageshow'));
    assert.equal(win.effetuneHandleBack(), true);
    assert.equal(win.effetuneHandleBack(), false);
    assert.deepEqual(bars, [[false, true], [false, false], [true, false],
        [false, false], [true, false], [false, false]]);
});

test('Android Back uses the measurement step control and falls through on the results screen', async () => {
    const { UIManager } = await import('../../features/measurement/ui/ui-manager.js');
    const wizard = Object.assign(Object.create(UIManager.prototype), { currentScreen: 'sweepMeasurementScreen' });
    const screen = prior => ({ querySelector: selector => selector.includes('.back-btn')
        ? { click() { wizard.currentScreen = prior; } } : null });
    const screens = {
        sweepMeasurementScreen: screen('levelAdjustmentScreen'),
        levelAdjustmentScreen: screen('measurementConfigScreen'),
        measurementConfigScreen: screen('newMeasurementScreen'),
        newMeasurementScreen: screen('resultsDisplayScreen')
    };
    const win = Object.assign(new EventTarget(), {
        app: { uiManager: wizard },
        MutationObserver: class { observe() {} },
        document: {
            body: { classList: { contains: () => false } }, documentElement: { dataset: {} },
            querySelectorAll: () => [], querySelector: () => null,
            getElementById: id => screens[id]
        }
    });
    await withGlobals({ document: win.document }, () => {
        installAndroidWindowUi(win, { async request() {} });
        for (const prior of ['levelAdjustmentScreen', 'measurementConfigScreen', 'newMeasurementScreen', 'resultsDisplayScreen']) {
            assert.equal(win.effetuneHandleBack(), true);
            assert.equal(wizard.currentScreen, prior);
        }
        assert.equal(win.effetuneHandleBack(), false);
    });
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

test('Android bridge starts a new command deadline when the permission result arrives', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let id;
    const transport = { postMessage(text) { id = JSON.parse(text).id; } };
    const bridge = new AndroidBridge({ location: { origin: ANDROID_ORIGIN }, effetuneAndroid: transport }, { timeoutMs: 10 });
    const reply = values => transport.onmessage({ data: JSON.stringify({ version: 1, id, ...values }) });
    try {
        const input = bridge.request('audio.input', { deviceId: 1 });
        t.mock.timers.tick(9);
        reply({ permissionWaiting: true });
        t.mock.timers.tick(100);
        assert.equal(bridge.pending.size, 1);
        reply({ permissionWaiting: false });
        t.mock.timers.tick(9);
        reply({ ok: true, result: { inputDeviceId: 1 } });
        assert.deepEqual(await input, { inputDeviceId: 1 });

        const remote = bridge.request('remote.configure', { enabled: true });
        const expired = assert.rejects(remote, /timed out/);
        reply({ permissionWaiting: true });
        t.mock.timers.tick(100);
        reply({ permissionWaiting: false });
        t.mock.timers.tick(10);
        await expired;
        assert.equal(bridge.pending.size, 0);

        const cancelled = bridge.request('measurement.options');
        reply({ permissionWaiting: true });
        t.mock.timers.tick(100);
        reply({ ok: false, error: { code: 'cancelled' } });
        await assert.rejects(cancelled, { name: 'AbortError', code: 'cancelled' });
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
        const source = { uri: 'content://test/tone.wav' };
        const track = { size: bytes.length, mtimeMs: 1 };
        assert.equal((await prepareLoudnessSource({ ...track, mtimeMs: 2 }, source)).status, 'unavailable');
        const input = await prepareLoudnessSource(track, source);
        assert.equal(input.size, bytes.length);
        const reader = openDsdWorkerReader(input.port, input.size);
        try {
            assert.deepEqual(await reader.read(8, 4), bytes.slice(8, 12));
            assert.deepEqual(ranges.at(-1), { uri: source.uri, offset: 8, length: 4 });
        } finally {
            reader.dispose();
            await input.dispose();
        }
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
                if (command === 'pipeline.copySlot') snapshot = { ...snapshot, slot: payload.to };
                if (command === 'pipeline.set') snapshot = { ...snapshot, masterBypass: payload.masterBypass };
                if (command === 'audio.start') snapshot = { ...snapshot, outputStarted: true };
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
        await manager.applyPersistedPowerSettings({ mode: 'maximum' });
        assert.deepEqual(requests.findLast(request => request.command === 'audio.configure').payload,
            { powerSettings: { mode: 'maximum', silenceThresholdDb: -80, fullSuspendDelaySeconds: 300,
                skipDisplayDspWhenHidden: true } });
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

test('Android power settings are persisted through the common Web path and restored at startup', async () => {
    const values = new Map();
    const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    setWebAppConfigRuntimeForTests(null);
    try {
        await withGlobals({ window: { localStorage, appConfig: { powerSaving: { mode: 'continuous' } } } }, async () => {
            const configured = [];
            const bridge = { on() {}, async request(command, payload) {
                if (command === 'audio.configure') configured.push(payload.powerSettings);
                return { revision: configured.length, channelCount: 2 };
            } };
            const manager = new AndroidAudioManager(null, { bridge });
            await manager.initAudio();
            assert.equal(configured[0].mode, 'continuous');
            await manager.updatePowerSettings({ silenceThresholdDb: -60 });
            assert.equal(configured.at(-1).silenceThresholdDb, -60);
            assert.equal(JSON.parse(values.get(WEB_APP_CONFIG_KEY)).powerSaving.silenceThresholdDb, -60);
        });
    } finally { resetWebAppConfigRuntimeForTests(); }
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
    assert.equal(requests.at(-1).command, 'playback.close');
});

test('Android playback position interpolates only while playing and clamps to duration', () => {
    const context = Object.create(AndroidPlayerContext.prototype);
    context.audioPlayer = { stateManager: { getCurrentTrack: () => null } };
    context.getCurrentState = () => ({ currentTrackPosition: 3 });
    context.pendingWrites = { position: 0 };
    context.audioManager = { snapshotTime: performance.now() - 1000,
        snapshot: { playback: { position: 2, duration: 3, speed: 2, playing: true } } };
    assert.equal(context.getCurrentPlaybackTime(), 3);
    context.audioManager.snapshot.playback.scorePreparing = true;
    assert.equal(context.getCurrentPlaybackTime(), 2);
    context.audioManager.snapshot.playback.scorePreparing = false;
    context.audioManager.snapshot.playback.pcmStalled = true;
    assert.equal(context.getCurrentPlaybackTime(), 2);
    context.audioManager.snapshot.playback.pcmStalled = false;
    assert.equal(context.getCurrentPlaybackTime(), 3);
    context.audioManager.snapshot.playback.playing = false;
    assert.equal(context.getCurrentPlaybackTime(), 2);
    context.pendingWrites.position = 1;
    assert.equal(context.getCurrentPlaybackTime(), 3);
});

test('Android player keeps local volume, speed and seek until their last native write settles', async () => {
    const listeners = new Map(), pending = [];
    let revision = 0;
    const manager = { snapshot: { revision }, bridge: {
        on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name); },
        request(command, payload) { return new Promise(resolve => pending.push({ command, payload, resolve })); }
    }, acceptSnapshot(snapshot) { this.snapshot = snapshot; } };
    const player = { playbackManager: {} };
    player.stateManager = new StateManager(player);
    const context = new AndroidPlayerContext(player, manager);
    const state = () => player.stateManager.getStateSnapshot();
    const native = { playing: true, position: 1, queueLength: 0, volume: 0.2, speed: 1 };
    const answer = changes => {
        const request = pending.shift();
        Object.assign(native, changes);
        request.resolve({ revision: ++revision, playback: { ...native } });
    };
    for (const volume of [20, 50, 80]) context.setPlayerVolume(volume);
    const seek = context.seek(30);
    player.stateManager.updateState({ playbackSpeed: 1.5 });
    const speed = context.applyPlaybackSpeed();
    assert.equal(state().volume, 80);
    assert.equal(context.getCurrentPlaybackTime(), 30);
    answer({ volume: 0.2 });
    await Promise.resolve();
    listeners.get('snapshot')({ revision: ++revision, playback: { ...native, volume: 0.9 } });
    assert.equal(state().volume, 80);
    assert.equal(state().currentTrackPosition, 30);
    assert.equal(state().playbackSpeed, 1.5);
    answer({ volume: 0.5 }); answer({ volume: 0.8 }); answer({ position: 30 }); answer({ speed: 1.5 });
    await Promise.all([seek, speed]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state().volume, 80); assert.equal(state().currentTrackPosition, 30);
    listeners.get('snapshot')({ revision: ++revision, playback: { ...native, volume: 0.4 } });
    assert.equal(state().volume, 40);
    assert.equal(context.playerVolume, 40);
});

test('Android queue fetches missing ordinals without duplicating the durable queue', async () => {
    const requests = [];
    const queue = new AndroidPlaybackQueue({ async request(command, payload) {
        requests.push({ command, payload });
        return { offset: payload.offset, total: 200, items: Array.from({ length: payload.limit }, (_, i) => ({
            title: String(payload.offset + i), region: { start: 1, end: 2, durationSec: 1 } })) };
    } });
    queue.accept({ queueLength: 200, shuffle: true, shuffleSeed: 42 });
    const window = await queue.getWindow({ startOrdinal: 10 });
    assert.equal((await queue.getEntry(10)).name, '10');
    assert.equal(requests.length, 2);
    const entry = await queue.getEntry(150);
    assert.equal(queue.toTransportOrdinal(entry.nativeQueueIndex), 150);
    assert.equal(entry.startFrame, 75);
    assert.equal(entry.endFrame, 150);
    assert.equal(await queue.resolveEntrySource(entry), entry);
    assert.equal(queue.window, window);
    await queue.getWindow({ startOrdinal: 199 });
    assert.deepEqual(requests.map(request => request.payload), [{ offset: 10, limit: 64 }, { offset: 74, limit: 16 },
        { offset: 150, limit: 1 }, { offset: 199, limit: 1 }]);
    assert.equal(queue.window.totalCount, 200);
    assert.equal(queue.window.rows.length, 1);
});

test('Android queue reads the service ordinals after a shuffled insertion', async () => {
    const order = [1, 3, 0, 2];
    const queue = new AndroidPlaybackQueue({ async request(command, { offset, limit, canonical }) {
        assert.equal(command, 'playback.queue.read');
        const items = Array.from({ length: limit }, (_, i) => {
            const index = offset + i;
            const canonicalOrdinal = canonical ? index : order[index];
            const transportOrdinal = canonical ? order.indexOf(index) : index;
            return { canonicalOrdinal, transportOrdinal, title: String(canonicalOrdinal) };
        });
        return { items, total: order.length };
    } });
    queue.accept({ queueLength: 4, shuffle: true, shuffleSeed: 0, explicitOrder: true, index: 1, ordinal: 0 });
    assert.equal(queue.toTransportOrdinal(1), 0);
    const window = await queue.getWindow({ startOrdinal: 0 });
    assert.deepEqual(window.rows.map(row => row.nativeQueueIndex), order);
    assert.equal((await queue.getCanonicalEntry(3)).transportOrdinal, 1);
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

test('native finite capture sends the overload stop and reports an early stop', async () => {
    let begin;
    let uploaded;
    const sweep = { sampleRate: 8, length: 2, tailSamples: 0, channels: [new Float32Array([0.5, -0.5])] };
    const bridge = { async request(command, payload) {
        if (command === 'measurement.begin') begin = payload;
        if (command === 'measurement.chunk') uploaded = payload.data;
        if (command === 'measurement.status') return { status: 'complete', overloadStopped: true };
        if (command === 'measurement.read') return { data: uploaded, frames: 10, channels: 2, sampleRate: 8 };
        return {};
    } };
    const result = await captureAndroidSweep(sweep, { repetitions: 1, levelDb: 0, channel: 'both',
        overload: { peak: 0.999, tailSeconds: 1 }, bridge });
    assert.equal(begin.inputChannel, 2);
    assert.equal(begin.overloadPeak, 0.999);
    assert.equal(begin.overloadTailFrames, 8);
    assert.equal(result.overloadStopped, true);
});

test('Android packs skipped and display-only effects with the desktop configure rules', () => {
    const plugin = (type, id, parameters, extra = {}) => {
        const Plugin = { [type]: class { getParameters() { return parameters; } } }[type];
        return Object.assign(new Plugin(), { id, name: type, enabled: true }, extra);
    };
    const pipeline = [
        plugin('RoomEqPlugin', 1, {}),
        plugin('NoteSpectrogramPlugin', 2, { mn: 21, mx: 108, ck: 0 }),
        plugin('SFZNotePlayerPlugin', 3, { og: -1, mn: 21, mx: 108 }),
        plugin('SpectrumAnalyzerPlugin', 4, {}),
        plugin('UnpackedPlugin', 5, {})
    ];
    const byId = result => new Map(result.plugins.map(record => [record.id, record]));
    const unsupported = byId(prepareAndroidPipeline(pipeline, { sampleRate: 32000 }));
    assert.deepEqual([unsupported.get(1).skip, unsupported.get(1).reason, unsupported.get(1).parameterValues],
        [true, 'unsupportedSampleRate', []]);
    assert.deepEqual([unsupported.get(5).skip, unsupported.get(5).reason], [true, 'wasmUnavailable']);
    assert.equal(unsupported.get(2).displayOnly, false, 'an analyzer feeding SFZ Note Player keeps processing');
    assert.equal(unsupported.get(4).displayOnly, true);
    const supported = byId(prepareAndroidPipeline(pipeline, { sampleRate: 48000, masterBypass: true }));
    assert.deepEqual([supported.get(1).skip, supported.get(1).reason], [false, null]);
    assert.equal(supported.get(2).displayOnly, true, 'master bypass leaves no consumer, as on desktop');
});

test('Android reports skipped effects as bypassed with their reason', () => {
    class RoomEqPlugin { constructor() { this.id = 4; this.enabled = true; this.messages = []; }
        onMessage(message) { this.messages.push(message); } }
    const plugin = new RoomEqPlugin();
    const manager = Object.assign(Object.create(AndroidAudioManager.prototype), {
        pipeline: [plugin], snapshot: { sampleRate: 32000 }, _dspExecutionGenerationsByNode: new Map(),
        pipelineProcessor: { prepareSectionAwarePluginData: () => [{ id: 4, type: 'RoomEqPlugin', enabled: true }] },
        dispatchEvent() {}
    });
    manager.publishExecutionStates(manager.pipeline, 3, [{ id: 4, reason: 'unsupportedSampleRate' }]);
    assert.deepEqual(plugin.messages.map(message => [message.state, message.reason]), [['bypassed', 'unsupportedSampleRate']]);
});

test('Android forwards processing overload and hidden effect displays like the desktop host', async () => {
    const handlers = new Map(), requests = [];
    const bridge = { on: (type, handler) => handlers.set(type, handler),
        async request(command, payload) { requests.push({ command, payload }); return {}; } };
    await withGlobals({ window: {} }, async () => {
        const manager = new AndroidAudioManager(null, { bridge });
        const overloads = [];
        manager.addEventListener('audioProcessingOverload', event => overloads.push(event.active));
        handlers.get('audio-overload')({ active: true });
        handlers.get('audio-overload')({ active: false });
        assert.deepEqual(overloads, [true, false]);
        // The mini player and a hidden effect pipeline reach the Service through the common UI gate.
        const displayHidden = () => requests.filter(request => request.command === 'telemetry.configure').at(-1)?.payload.displayHidden;
        manager.powerPolicyController.setDspUiSuppressed('mini-player', true);
        assert.equal(displayHidden(), true);
        manager.powerPolicyController.setDspUiSuppressed('mini-player', false);
        assert.equal(displayHidden(), false);
    });
});
