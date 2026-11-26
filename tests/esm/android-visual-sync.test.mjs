import assert from 'node:assert/strict';
import test from 'node:test';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { AndroidAudioManager } from '../../js/android/audio-manager.js';
import { bytesToBase64 } from '../../js/android/bridge.js';

// A Service bridge that records commands and lets the test emit Service events.
function createManager(reply = () => ({})) {
    const requests = [], handlers = new Map();
    const bridge = {
        on(name, handler) { handlers.set(name, handler); },
        async request(command, payload) { requests.push({ command, payload }); return reply(command, payload); }
    };
    const manager = new AndroidAudioManager(null, { bridge });
    manager.acceptSnapshot({ revision: 1, sampleRate: 48000, channelCount: 2 });
    return { manager, requests, emit: (name, data) => handlers.get(name)(data),
        commands: name => requests.filter(request => request.command === name).map(request => request.payload) };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('Android Spectrum Overlay taps use the desktop port contract and survive an engine rate change', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const { manager, requests, commands } = createManager();
        const port = manager.spectrumOverlayEndpoint.port;
        requests.length = 0;
        port.postMessage({ type: 'setSpectrumTapRoute', pluginId: 7, enabled: true });
        port.postMessage({ type: 'setSpectrumTap', pluginId: 7, enabled: true, mode: 'compare', quality: 'hq' });
        port.postMessage({ type: 'setSpectrumTap', pluginId: 9, enabled: true, mode: 'after', quality: 'normal' });
        assert.deepEqual(commands('spectrum.tap'), [
            { pluginId: 7, route: true },
            { pluginId: 7, enabled: true, mode: 'compare', quality: 'hq' },
            { pluginId: 9, enabled: true, mode: 'after', quality: 'normal' }
        ]);
        // Only routed taps are replayed to the engine reopened at another rate.
        requests.length = 0;
        manager.acceptSnapshot({ revision: 2, sampleRate: 96000, channelCount: 2 });
        assert.deepEqual(commands('spectrum.tap'), [
            { pluginId: 7, route: true },
            { pluginId: 7, enabled: true, mode: 'compare', quality: 'hq' }
        ]);
        port.postMessage({ type: 'setSpectrumTap', pluginId: 7, enabled: false, mode: 'compare', quality: 'hq' });
        port.postMessage({ type: 'setSpectrumTapRoute', pluginId: 7, enabled: false });
        requests.length = 0;
        manager.acceptSnapshot({ revision: 3, sampleRate: 48000, channelCount: 2 });
        assert.deepEqual(commands('spectrum.tap'), []);
    });
});

test('Android Spectrum Overlay frames reach the overlay port in the desktop message shape', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const { manager, emit } = createManager();
        const received = [];
        manager.spectrumOverlayEndpoint.port.addEventListener('message', event => received.push(event.data));
        const samples = new Float32Array(4096).fill(0.25);
        emit('spectrum-overlay', { type: 'spectrumOverlay', spectrumPluginId: 7, mode: 'after', quality: 'normal',
            bufferPosition: 12, sampleRate: 48000, endFrame: 4096, packet: bytesToBase64(new Uint8Array(samples.buffer)) });
        emit('spectrum-overlay', { type: 'spectrumOverlay', spectrumPluginId: 7, mode: 'after', quality: 'normal',
            packet: bytesToBase64(new Uint8Array(100)) });
        assert.equal(received.length, 1);
        assert.equal(received[0].spectrumPluginId, 7);
        assert.equal(received[0].bufferPosition, 12);
        assert.equal(received[0].outputBuffer.length, 4096);
        assert.equal(received[0].outputBuffer[4095], 0.25);
        assert.equal(received[0].inputBuffer, undefined);
    });
});

test('Android Visual Sync follows the engine clock and stays unsynced while the latency is unknown', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const { manager, emit } = createManager(command => (command === 'audio.outputDelay' ? { samples: 0 } : {}));
        await manager.setVisualSyncEnabled(true);
        const before = performance.now();
        assert.ok(Math.abs(manager._visualSyncNow() - before) < 50, 'without a clock frames show on arrival');
        assert.equal(manager._resolveVisualSyncDue(1, 1000), null);
        // One second of engine frames with 100 ms of output latency is audible at 900 ms.
        emit('telemetry', { revision: 0, clockPipelineFrame: 48000, clockTimeNs: performance.now() * 1e6,
            outputLatencyFrames: 4800, outputDelayFrames: 0 });
        assert.ok(Math.abs(manager._visualSyncNow() - 900) < 50);
        assert.equal(manager.contextManager.audioContext, null, 'the clock stand-in is visible only while read');
        // A later route reports another latency: deadlines follow it, the delay keeps the first estimate.
        emit('spectrum-overlay', { clockPipelineFrame: 48000, clockTimeNs: performance.now() * 1e6,
            outputLatencyFrames: 9600, outputDelayFrames: 0 });
        assert.ok(Math.abs(manager._visualSyncNow() - 800) < 50);
        assert.equal(manager._getDeviceLatencyFrames(), 4800);
        // Another rate restarts the engine frames, so the clock is unknown again.
        manager.acceptSnapshot({ revision: 2, sampleRate: 96000, channelCount: 2 });
        assert.equal(manager.visualClock, null);
        await settle();
    });
});

test('Android Visual Sync requests the output delay and restores it when the Service output loses it', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const { manager, emit, commands } = createManager((command, payload) =>
            (command === 'audio.outputDelay' ? { samples: payload.samples } : {}));
        manager._recomputeVisualSyncDelay = () => (manager.visualSyncDelayFrames = manager.visualSyncEnabled ? 2400 : 0);
        await manager.setVisualSyncEnabled(true);
        assert.deepEqual(commands('visualSync').at(-1), { enabled: true });
        assert.deepEqual(commands('audio.outputDelay').at(-1), { samples: 2400 });
        assert.equal(manager._appliedOutputDelayFrames.get(null), 2400);
        const sent = commands('audio.outputDelay').length;
        emit('telemetry', { revision: 0, outputDelayFrames: 2400 });
        await settle();
        assert.equal(commands('audio.outputDelay').length, sent, 'a matching report sends nothing');
        // A restarted output reports no delay; the requested one is sent again.
        emit('telemetry', { revision: 0, outputDelayFrames: 0 });
        await settle();
        assert.deepEqual(commands('audio.outputDelay').slice(sent), [{ samples: 2400 }]);
        assert.equal(manager._appliedOutputDelayFrames.get(null), 2400);
        // The playback position the user hears is held back by the applied delay.
        manager.snapshot = { ...manager.snapshot, playback: { position: 10, duration: 60, playing: false, speed: 1 } };
        assert.ok(Math.abs(manager.getAudiblePlaybackPosition() - 9.95) < 1e-9);
        manager.snapshotTime = performance.now() - 1000;
        Object.assign(manager.snapshot.playback, { playing: true, pcmStalled: true });
        assert.ok(Math.abs(manager.getAudiblePlaybackPosition() - 9.95) < 1e-9);
        manager.snapshot.playback.pcmStalled = false;
        assert.ok(manager.getAudiblePlaybackPosition() >= 10.95);
    });
});
