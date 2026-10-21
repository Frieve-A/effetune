import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserInputController } from '../../js/audio/browser-input-controller.js';
import { AudioIOManager } from '../../js/audio/audio-io-manager.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../../js/audio/audio-device-constants.js';
import { PowerPolicyController } from '../../js/audio/power-policy-controller.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function stream(calls) {
    const track = type => ({
        readyState: 'live', listeners: new Map(),
        getSettings: () => ({ channelCount: 2, echoCancellation: false,
            noiseSuppression: false, autoGainControl: false }),
        stop() { calls.push('stop:' + type); this.readyState = 'ended'; },
        addEventListener(type, listener) { this.listeners.set(type, listener); },
        removeEventListener() {}
    });
    const audio = track('audio');
    const video = track('video');
    return { getAudioTracks: () => [audio], getVideoTracks: () => [video],
        getTracks: () => [audio, video] };
}

async function withBrowser(callback, preferences = { inputDeviceId: NO_AUDIO_INPUT_DEVICE_ID }) {
    const calls = [];
    let stateListener;
    let nextStream = stream(calls);
    const connected = new Set();
    const context = {
        resume: async () => { calls.push('resume'); },
        createMediaStreamSource: captured => ({
            captured, disconnect() { calls.push('disconnect'); connected.delete(this); }
        })
    };
    const io = new AudioIOManager({ audioContext: context });
    const silent = {};
    io.ensureSilentSourceFallback = () => silent;
    const audioManager = {
        ioManager: io, contextManager: { audioContext: context },
        isSourceConnectedToPipeline: source => connected.has(source),
        ensureSourceConnectedToPipeline(source) {
            if (!connected.has(source)) { connected.add(source); calls.push('connect'); }
            return true;
        },
        disconnectSourceFromPipeline(source) { connected.delete(source); },
        adoptPowerMutation() {},
        powerPolicyController: {
            audioManager: null,
            acquireLease: () => () => { calls.push('release-lease'); },
            _getTokensAndGuards: () => ({ tokens: {}, guards: {} }),
            mutations: { commitOwnedMutation: () => ({}) },
            _invalidateTopologyBoundPowerEvidence() {},
            _configureWorklets() {},
            _deriveRouteAndPlayerFacts: PowerPolicyController.prototype._deriveRouteAndPlayerFacts,
            _handoffPipelineToSilentSource: PowerPolicyController.prototype._handoffPipelineToSilentSource,
            selectBrowserPlaybackSource: PowerPolicyController.prototype.selectBrowserPlaybackSource,
            refreshPlaybackInputRouting: PowerPolicyController.prototype.refreshPlaybackInputRouting,
            async selectCapturedInput(captured, isCurrent) {
                if (!isCurrent()) return false;
                const source = io._adoptInputStream(captured);
                audioManager.ensureSourceConnectedToPipeline(source);
                return true;
            },
            ensureActive: async kind => { calls.push(kind); return true; },
            requestReconcile: async () => true
        }
    };
    audioManager.powerPolicyController.audioManager = audioManager;
    let generation = 0;
    const api = {
        prepareCapture() { calls.push('prepare'); return { generation: ++generation }; },
        async setCaptureState(value) { calls.push(value.active ? 'unmute' : 'mute'); return { ok: true }; },
        onState(listener) { stateListener = listener; return () => {}; }
    };
    await withGlobals({
        window: { audioPreferences: preferences,
            uiManager: { audioPlayer: { stop: async () => { calls.push('player-stop'); } } } },
        navigator: { mediaDevices: { getDisplayMedia(constraints) {
            calls.push('capture');
            assert.equal(constraints.audio.echoCancellation, false);
            return Promise.resolve(nextStream);
        } } }
    }, async () => {
        audioManager.powerPolicyController.windowRef = window;
        const input = new BrowserInputController(audioManager, api);
        await callback({ input, io, calls, connected, audioManager, api, getStream: () => nextStream,
            setStream: value => { nextStream = value; }, emit: value => stateListener(value) });
    });
}

test('Browser capture starts on the click stack and connects before its single unmute', async () => {
    await withBrowser(async ({ input, calls, io, connected }) => {
        const pending = input.select();
        assert.deepEqual(calls.slice(0, 3), ['prepare', 'capture', 'resume']);
        assert.equal(await pending, true);
        assert.ok(calls.indexOf('connect') < calls.indexOf('unmute'));
        assert.equal(calls.filter(call => call === 'unmute').length, 1);
        assert.ok(calls.includes('stop:video'));
        assert.equal(io.getInputSnapshot().inputConfigured, false);
        assert.equal(io.inputStream, null);
        assert.equal(input.selected, true);
        assert.equal(input.active, true);
        assert.equal(connected.has(input.sourceNode), true);
    });
});

test('repeated Browser visits reuse pending and active capture without restarting playback', async () => {
    await withBrowser(async ({ input, calls }) => {
        const selecting = input.select();
        assert.equal(input.select(), selecting);
        assert.equal(await selecting, true);
        calls.length = 0;
        assert.equal(await input.select(), true);
        assert.deepEqual(calls, []);
    });
});

test('Browser mixes the configured device regardless of the local Player input setting', async () => {
    for (const mixed of [false, true]) {
        await withBrowser(async ({ input, io, calls, connected, audioManager }) => {
            const device = stream(calls);
            const deviceSource = io._adoptInputStream(device);
            audioManager.ensureSourceConnectedToPipeline(deviceSource);
            assert.equal(await input.select(), true);
            assert.equal(io.inputStream, device);
            assert.equal(io.inputSourceNode, deviceSource);
            assert.equal(device.getAudioTracks()[0].readyState, 'live');
            assert.equal(connected.has(deviceSource), true);
            assert.equal(connected.has(input.sourceNode), true);
            assert.ok(calls.includes('mixed-play'));
        }, { inputDeviceId: 'default', useInputWithPlayer: mixed });
    }
});

test('releasing Browser playback mutes before its silent handoff and track stop', async () => {
    await withBrowser(async ({ input, calls, io, connected }) => {
        await input.select();
        const source = input.sourceNode;
        calls.length = 0;
        await input.release();
        assert.ok(calls.indexOf('mute') < calls.indexOf('disconnect'));
        assert.ok(calls.indexOf('disconnect') < calls.indexOf('stop:audio'));
        assert.equal(connected.has(io.ensureSilentSourceFallback()), true);
        assert.equal(connected.has(source), false);
        assert.equal(input.stream, null);
        assert.equal(input.selected, false);
        assert.equal(io.inputStream, null);
    });
});

test('a superseded capture stops its late tracks without replacing the selected device', async () => {
    await withBrowser(async ({ input, setStream }) => {
        const late = deferred();
        setStream(late.promise);
        const selection = input.select();
        await input.release();
        const captured = stream([]);
        late.resolve(captured);
        assert.equal(await selection, false);
        assert.equal(captured.getAudioTracks()[0].readyState, 'ended');
        assert.equal(input.selected, false);
        assert.equal(input.active, false);
    });
});

test('Browser graph rebuild preserves capture and its device mix without duplicate sources', async () => {
    await withBrowser(async ({ input, io, calls, connected, audioManager }) => {
        const device = stream(calls);
        const deviceSource = io._adoptInputStream(device);
        await input.select();
        const captured = input.stream;
        const original = input.sourceNode;
        for (const mixed of [true, false, true]) {
            window.audioPreferences.useInputWithPlayer = mixed;
            input.detachGraph();
            assert.equal(await input.bindGraph(), true);
            assert.equal(connected.has(deviceSource), true);
            assert.equal(connected.has(original), false);
            assert.equal(connected.has(input.sourceNode), true);
            assert.equal([...connected].filter(source => source.captured === captured).length, 1);
            assert.equal(input.stream, captured);
            assert.equal(captured.getAudioTracks()[0].readyState, 'live');
            assert.equal(audioManager.ioManager.inputStream, device);
        }
        assert.equal(calls.filter(call => call === 'unmute').length, 1);
    }, { inputDeviceId: 'default' });
});

test('Browser site-data cleanup leaves a subsequently selected device running', async () => {
    await withBrowser(async ({ input, io, calls, connected, audioManager }) => {
        await input.select();
        await input.release();
        const device = stream(calls);
        const source = io._adoptInputStream(device);
        audioManager.ensureSourceConnectedToPipeline(source);
        calls.length = 0;
        await input.release({ keepSelection: true });
        assert.equal(io.inputStream, device);
        assert.equal(connected.has(source), true);
        assert.equal(device.getAudioTracks()[0].readyState, 'live');
        assert.equal(calls.includes('stop:audio'), false);
    });
});

test('a delayed return-to-device mute cannot release a newer Browser capture', async () => {
    await withBrowser(async ({ input, calls, api, setStream }) => {
        await input.select();
        const muted = deferred();
        api.setCaptureState = async value => {
            calls.push(value.active ? 'unmute' : 'mute');
            if (!value.active) await muted.promise;
            return { ok: true };
        };
        const returning = input.release();
        const latest = stream(calls);
        setStream(latest);
        assert.equal(await input.select(), true);
        calls.length = 0;
        muted.resolve();
        assert.equal(await returning, false);
        assert.equal(input.stream, latest);
        assert.equal(input.active, true);
        assert.equal(latest.getAudioTracks()[0].readyState, 'live');
        assert.equal(calls.includes('stop:audio'), false);
    });
});
