import assert from 'node:assert/strict';
import test from 'node:test';

import {
    clearPipelineHandoff,
    putPipelineHandoff,
    takePipelineHandoffOnce
} from '../../js/pipeline-analyzer/pipeline-handoff-store.js';
import { createFakeIndexedDb } from './web-folder-handle-store-fake-idb.mjs';

function handoff() {
    return {
        snapshot: {
            sampleRate: 48000,
            channelCount: 2,
            dsp: { module: null, bytes: Uint8Array.from([1, 2, 3]).buffer }
        },
        pluginNames: ['Room EQ']
    };
}

test('the pipeline hand-off is consumed exactly once', async () => {
    const indexedDB = createFakeIndexedDb();
    await putPipelineHandoff(handoff(), { indexedDB });

    const taken = await takePipelineHandoffOnce({ indexedDB });
    assert.deepEqual(taken.pluginNames, ['Room EQ']);
    assert.equal(taken.snapshot.channelCount, 2);
    assert.deepEqual(Array.from(new Uint8Array(taken.snapshot.dsp.bytes)), [1, 2, 3]);
    assert.equal(await takePipelineHandoffOnce({ indexedDB }), null);
});

test('clearing the pipeline hand-off removes a saved entry', async () => {
    const indexedDB = createFakeIndexedDb();
    await putPipelineHandoff(handoff(), { indexedDB });
    await clearPipelineHandoff({ indexedDB });
    assert.equal(await takePipelineHandoffOnce({ indexedDB }), null);
});

test('the pipeline hand-off store rejects when IndexedDB is unavailable', async () => {
    await assert.rejects(putPipelineHandoff(handoff(), { indexedDB: null }), /IndexedDB is unavailable/);
});
