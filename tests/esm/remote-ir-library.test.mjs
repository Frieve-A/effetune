import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteIrLibrary } from '../../js/remote/remote-ir-library.js';
import { RemoteAudioManager } from '../../js/remote/remote-audio-manager.js';

test('remote IR selection lists host entries including pairs, with filename and date ordering', async () => {
    const requests = [];
    const items = [
        { id: 'a'.repeat(24), name: 'Alpha.wav', channels: 1, topology: 'mono', sampleRate: 48000, frames: 48000, importedAt: '2026-01-01' },
        { id: 'b'.repeat(24), name: 'Hall L.wav + Hall R.wav', channels: 4, topology: 'true-stereo', importedAt: '2026-03-01' }
    ];
    const service = createRemoteIrLibrary({
        request: async (...args) => { requests.push(args); return { items }; }
    }, () => {});
    assert.deepEqual((await service.list()).map(entry => entry.irId), items.map(item => item.id));
    assert.deepEqual((await service.list({ query: 'HALL' })).map(entry => entry.irId), [items[1].id]);
    assert.deepEqual((await service.list({ sort: 'recent' })).map(entry => entry.irId), [items[1].id, items[0].id]);
    assert.deepEqual(requests[0], [{ op: 'listIRs', includePairs: true }, 'irs']);
    items.push({ id: 'c'.repeat(24), name: 'New.wav' });
    assert.equal((await service.list()).length, 3, 'reopening uses the current host library');
    assert.equal(service.readOnly, true);
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
