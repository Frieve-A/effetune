import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { AndroidAudioManager } from '../../js/android/audio-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('Android SoundFont mixer receives fresh frames after a visual clock reset', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const manager = new AndroidAudioManager(null, { bridge: { on() {} } });
        const source = ['sfz-instrument.js', 'others/soundfont_player.js'].map(name =>
            fs.readFileSync(new URL(`../../plugins/${name}`, import.meta.url), 'utf8')).join('\n');
        class PluginBase { registerProcessor() {} onMessage() {} }
        vm.runInNewContext(source, { window, PluginBase, document: {}, performance, clearTimeout });
        const plugin = new window.SoundFontPlayerPlugin();
        plugin.id = 7;
        manager.pipeline = [plugin];
        plugin.onMessage({ type: 'dspExecutionState' });
        const hub = manager.telemetryHub;
        const packet = new ArrayBuffer(16 + 588), view = new DataView(packet);
        view.setUint16(0, 35, true);
        view.setUint16(2, 3, true);
        view.setUint32(4, plugin.id, true);
        view.setUint16(12, 588, true);
        view.setUint16(16 + 2, 256, true);
        view.setUint8(16 + 584, 1);
        for (const peak of [0.125, 0.25]) {
            manager.resetVisualClock();
            view.setFloat32(16 + 520, peak, true);
            hub.handleMessage({ type: 'dspTelemetry', packet, bytes: packet.byteLength, recycle: false });
            assert.equal(plugin._mixerState?.channels[0].levelPeak, peak);
        }
        hub.clearSubscriptions();
        assert.equal(hub.subscribers.size, 0);
    });
});

test('Android restore accepts a pending bridge poll after the worklet deadline', async t => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const poll = Promise.withResolvers(), pages = [], calls = [];
        const stream = { pluginId: 7, token: 91, generation: 27, operationRevision: 4, preparing: true };
        const bridge = { on() {}, async request(command, payload) {
            calls.push(command);
            if (command === 'sfz.resume') return payload.operationRevision === undefined
                ? { ok: true, token: stream.token } : { ok: true, stream: { ...stream, type: 'sfzStreamReady' } };
            if (command === 'sfz.poll') {
                assert.equal(payload.token, stream.token);
                assert.equal(payload.generation, stream.generation);
                assert.equal(payload.operationRevision, stream.operationRevision);
                return poll.promise;
            }
            return { ok: true };
        } };
        const manager = new AndroidAudioManager(null, { bridge });
        const asset = { operationRevision: 4, externalAssetSignature: 'bank', sampleProviderFactory({ onProvider }) {
            onProvider({ close() {}, requestPages(batch) { pages.push(...batch); } });
        } };
        const plugin = { id: 7, sf: 'bank', getWasmAssetOperationRevision: () => 4,
            getWasmAssets: () => new Map([[0, asset]]), getWasmAssetRevisionDescriptor: () => asset };
        manager.pipeline = [plugin];
        await manager.resumeSfzStream(plugin);
        assert.deepEqual(calls, ['sfz.resume', 'sfz.resume', 'sfz.poll']);
        t.mock.timers.tick(5100);
        await new Promise(resolve => setImmediate(resolve));
        poll.resolve({ ok: true, requests: [{ generation: 27, sample: 2, pageIndex: 0 }] });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(calls.includes('sfz.failed'), false);
        assert.deepEqual(pages, [{ generation: 27, sample: 2, pageIndex: 0 }]);
    });
});

test('Android keeps SoundFont page delivery across 48/96 kHz engine replacements', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const events = new Map(), published = [], failures = [], transfers = [];
        const turn = () => new Promise(resolve => setImmediate(resolve));
        let snapshot = { sampleRate: 48000, channelCount: 2, revision: 1 };
        // Each new engine reuses generation 1. The service issues a new bank token.
        let token = 10, heldPoll, latePoll;
        const stream = () => ({ pluginId: 7, generation: 1, token, operationRevision: 4 });
        const bridge = { on: (name, listener) => events.set(name, listener), async request(command, payload) {
            switch (command) {
                case 'audio.configure':
                    snapshot = { ...snapshot, sampleRate: payload.sampleRate, revision: snapshot.revision + 1,
                        pipelineRateMismatch: true };
                    events.get('snapshot')(snapshot);
                    return snapshot;
                case 'pipeline.set':
                    if (snapshot.sampleRate === 96000) {
                        heldPoll.resolve({ ok: false });
                        await turn();
                    } else latePoll = heldPoll;
                    heldPoll = null;
                    events.get('sfz-stream')({ ...stream(), type: 'sfzStreamStop' });
                    token++;
                    snapshot = { ...snapshot, revision: snapshot.revision + 1, pipelineRateMismatch: false };
                    events.get('sfz-stream')({ ...stream(), type: 'sfzStreamReady', operationRevision: -1 });
                    return snapshot;
                case 'sfz.resume':
                    if (payload.signature !== 'bank') return { ok: false };
                    if (payload.operationRevision === undefined) return { ok: true, token };
                    return { ok: payload.token === token && payload.operationRevision === 4,
                        stream: { ...stream(), type: 'sfzStreamReady' } };
                case 'sfz.poll':
                    if (heldPoll) return heldPoll.promise;
                    return { ok: payload.token === token && payload.operationRevision === 4 && payload.generation === 1,
                        requests: [{ sample: 0, pageIndex: token, generation: 1 }] };
                case 'sfz.publish':
                    published.push([snapshot.sampleRate, payload.token, payload.page.pageIndex]);
                    return { ok: true };
                case 'sfz.failed': failures.push(command); break;
                case 'pipeline.asset.commit': transfers.push(command); break;
            }
            return snapshot;
        } };
        const manager = new AndroidAudioManager(null, { bridge });
        const asset = { operationRevision: 4, externalAssetSignature: 'bank', payload: new ArrayBuffer(32),
            sampleProviderFactory({ publish, onProvider }) {
                onProvider({ close() {}, async requestPages(batch) {
                    for (const page of batch) await publish({ ...page, channels: 1, frames: 1, pcm: Float32Array.of(0.5) });
                } });
            } };
        class SoundFontPlayerPlugin {
            id = 7;
            sf = 'bank';
            getParameters() { return { sf: this.sf }; }
            getWasmAssets() { return new Map([[0, asset]]); }
            getWasmAssetRevisionDescriptor() { return asset; }
            getWasmAssetOperationRevision() { return asset.operationRevision; }
            onWasmAssetRejected(_slot, reason) { failures.push(reason); }
        }
        manager.pipeline = [new SoundFontPlayerPlugin()];
        manager.acceptSnapshot(snapshot);
        await manager.resumeSfzStream(manager.pipeline[0]);
        await turn();
        for (const sampleRate of [96000, 48000]) {
            heldPoll = Promise.withResolvers();
            events.get('sfz-stream')({ ...stream(), type: 'sfzStreamPollNeeded' });
            await manager.reset({ sampleRate });
            latePoll?.resolve({ ok: false });
            await turn();
        }
        assert.deepEqual(failures, []);
        assert.deepEqual(transfers, []);
        assert.deepEqual(published, [[48000, 10, 10], [96000, 11, 11], [48000, 12, 12]]);
    });
});
