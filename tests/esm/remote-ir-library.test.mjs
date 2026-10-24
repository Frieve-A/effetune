import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRemoteIrLibrary } from '../../js/remote/remote-ir-library.js';
import { RemoteAudioManager } from '../../js/remote/remote-audio-manager.js';

test('remote IR selection lists host entries including pairs, with filename and date ordering', async () => {
    const requests = [];
    const items = [
        { id: 'a'.repeat(24), name: 'Alpha.wav', channels: 1, topology: 'mono', sampleRate: 48000, frames: 48000, importedAt: '2026-01-01' },
        { id: 'b'.repeat(24), name: 'Hall L.wav + Hall R.wav', channels: 4, topology: 'true-stereo', importedAt: '2026-03-01' }
    ];
    const service = createRemoteIrLibrary({
        request: async (...args) => { requests.push(args); return { items: args[0].includePairs ? items : items.slice(0, 1) }; }
    }, () => {});
    assert.deepEqual((await service.list()).map(entry => entry.irId), items.map(item => item.id));
    assert.deepEqual((await service.list({ query: 'HALL' })).map(entry => entry.irId), [items[1].id]);
    assert.deepEqual((await service.list({ sort: 'recent' })).map(entry => entry.irId), [items[1].id, items[0].id]);
    assert.deepEqual(requests[0], [{ op: 'listIRs', includePairs: true }, 'irs']);
    items.push({ id: 'c'.repeat(24), name: 'New.wav' });
    assert.equal((await service.list()).length, 3, 'reopening uses the current host library');
    assert.equal(service.readOnly, true);
    assert.deepEqual((await service.list()).slice(0, 2).map(entry => entry.downloadable), [true, false]);
});

const irBytes = new Uint8Array(512 * 1024 + 11).fill(37);
const irId = createHash('sha256').update(irBytes).digest('hex').slice(0, 24);
const irFile = () => new File([irBytes], 'Hall.wav');
const openSession = overrides => ({
    ws: { readyState: 1 }, features: new Set(['irSync', 'irSelection']), ...overrides
});

test('explicit IR upload uses the existing ordered chunk contract, including plain HTTP hashing', async () => {
    const sent = [];
    const session = openSession({ sendCommand: async message => sent.push(message) });
    const service = createRemoteIrLibrary(session, null, { cryptoProvider: null });
    const result = await service.importFiles([irFile()]);
    assert.equal(result.imported[0].irId, irId);
    assert.deepEqual(sent.map(({ op, id, index, total, bytes }) => ({ op, id, index, total, bytes })),
        [0, 1].map(index => ({ op: 'putIR', id: irId, index, total: 2, bytes: irBytes.length })));
    assert.deepEqual(Buffer.concat(sent.map(message => Buffer.from(message.data, 'base64'))), Buffer.from(irBytes));
    assert.ok(sent.every(message => Buffer.from(message.data, 'base64').length <= 512 * 1024));
    const oversized = await service.importFiles([{ name: 'Large.wav', size: 64 * 1024 * 1024 + 1,
        arrayBuffer: () => assert.fail('Oversized uploads must not be read') }]);
    assert.deepEqual(oversized.failureCodes, ['file-too-large']);
    assert.equal(sent.length, 2);
});

test('IR upload never continues after disconnect, reconnect, cancellation, or rejected host ack', async () => {
    for (const mode of ['reconnect', 'cancel', 'reject']) {
        let current = true;
        let sent = 0;
        const session = openSession({ sendCommand: async () => {
            sent += 1;
            if (mode === 'reconnect') session.ws = { readyState: 1 };
            if (mode === 'cancel') current = false;
            if (mode === 'reject') throw new Error('host rejected');
        } });
        const service = createRemoteIrLibrary(session, null);
        await assert.rejects(service.importFiles([irFile()], { isCurrent: () => current }));
        assert.equal(sent, 1, mode);
    }
    const session = openSession({ sendCommand: () => assert.fail('Disconnected upload must not send') });
    session.ws = null;
    await assert.rejects(createRemoteIrLibrary(session, null).importFiles([irFile()]));
});

test('IR download validates the entire file before saving and excludes paired entries', async () => {
    const saved = [];
    const session = openSession({ requestChunks: async (request, response, onChunk) => {
        assert.deepEqual(request, { op: 'getIR', id: irId });
        assert.equal(response, 'irChunk');
        for (let index = 0; index < 2; index += 1) onChunk({
            id: irId, index, total: 2, bytes: irBytes.length, name: 'Hall.wav',
            data: Buffer.from(irBytes.subarray(index * 512 * 1024, (index + 1) * 512 * 1024)).toString('base64')
        });
    } });
    const service = createRemoteIrLibrary(session, null, { cryptoProvider: null, download: (...args) => saved.push(args) });
    await service.downloadEntry({ irId, downloadable: true });
    assert.deepEqual(saved, [[irBytes, 'Hall.wav']]);
    await assert.rejects(service.downloadEntry({ irId, downloadable: false }));
    session.features = new Set(['irSelection']);
    assert.equal(service.canImport, false);
    await assert.rejects(service.importFiles([irFile()]));
    await assert.rejects(service.downloadEntry({ irId, downloadable: true }));
});

test('invalid or stale IR downloads never create a local file', async () => {
    for (const mode of ['missing', 'order', 'oversized', 'hash', 'reconnect', 'closed-dialog']) {
        let current = true;
        const downloadId = mode === 'hash' ? irId : createHash('sha256').update(new Uint8Array([0])).digest('hex').slice(0, 24);
        const session = openSession({ requestChunks: async (_request, _response, onChunk) => {
            if (mode === 'missing') return;
            onChunk({ id: downloadId, index: mode === 'order' ? 1 : 0, total: 1,
                bytes: mode === 'oversized' ? 64 * 1024 * 1024 + 1 : 1,
                name: 'Hall.wav', data: 'AA==' });
            if (mode === 'reconnect') session.ws = { readyState: 1 };
            if (mode === 'closed-dialog') current = false;
        } });
        const service = createRemoteIrLibrary(session, null, { download: () => assert.fail('Invalid download saved') });
        await assert.rejects(service.downloadEntry({ irId: downloadId, downloadable: true }, { isCurrent: () => current }), mode);
    }
});

test('remote UI uses host audio and routing formats without producing a local edit', () => {
    const manager = new RemoteAudioManager();
    manager.suppressMutations = false;
    manager.onLocalChange = () => assert.fail('host format updates must not edit the pipeline');
    const committedFormats = [];
    const plugin = {
        id: 1,
        getParameters(options) {
            committedFormats.push(options);
            manager.commitPowerTopologyMutation({ type: 'updatePlugin', plugin: this });
        }
    };
    manager.pipeline.push(plugin);
    assert.equal(manager.outputChannelCount, 16, 'desktop routing can be prepared before audio starts');
    const format = { sampleRate: 96000, channelCount: 8, routingChannelCount: 8 };
    assert.equal(manager.applyHostAudioState(format), true);
    assert.equal(manager.audioContext.sampleRate, 96000);
    assert.equal(manager.workletNode.channelCount, 8);
    assert.equal(manager.audioContext.destination.channelCount, 8);
    assert.equal(manager.outputChannelCount, 8);
    assert.deepEqual(committedFormats, [{ sampleRate: 96000, outputChannelCount: 8, commitSampleRate: true }]);
    assert.equal(manager.suppressMutations, false);
    assert.equal(manager.applyHostAudioState(format), false);
    assert.equal(manager.applyHostAudioState({ sampleRate: NaN, channelCount: 99, routingChannelCount: -1 }), false);
    assert.equal(committedFormats.length, 1);
});
