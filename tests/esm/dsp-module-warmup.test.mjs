import assert from 'node:assert/strict';
import test from 'node:test';
import { warmUpDspModule } from '../../js/audio/dsp-module-warmup.js';

function harness(moduleCloneable = true) {
    const info = { module: {}, bytes: new Uint8Array(4), moduleCloneable, meta: {} };
    const workers = [];
    const options = { workerFactory() {
        const worker = { messages: [], terminated: false,
            postMessage(message) { this.messages.push(message); },
            terminate() { this.terminated = true; }
        };
        workers.push(worker);
        return worker;
    } };
    return { info, workers, options };
}

test('DSP warm-up waits for the worker and shares one preparation per module and rate', async () => {
    const { info, workers, options } = harness();
    const first = warmUpDspModule(info, 48000, options);
    assert.equal(warmUpDspModule(info, 48000, options), first);
    assert.equal(workers.length, 1);
    assert.deepEqual(workers[0].messages, [{ module: info.module, bytes: null, sampleRate: 48000 }]);
    let settled = false;
    void first.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    const warmed = {};
    workers[0].onmessage({ data: { module: warmed } });
    assert.deepEqual(await first, { ...info, module: warmed });
    assert.equal(workers[0].terminated, true);
    assert.equal(warmUpDspModule(info, 48000, options), first);
    const otherRate = warmUpDspModule(info, 96000, options);
    workers[1].onmessage({ data: { module: warmed } });
    await otherRate;
    assert.equal(workers.length, 2);
});

test('DSP warm-up compiles bytes in the worker when the original module cannot be cloned', async () => {
    const { info, workers, options } = harness(false);
    const pending = warmUpDspModule(info, 44100, options);
    assert.deepEqual(workers[0].messages, [{ module: null, bytes: info.bytes, sampleRate: 44100 }]);
    const module = {};
    workers[0].onmessage({ data: { module } });
    assert.deepEqual(await pending, { ...info, module, moduleCloneable: true });
});

test('DSP warm-up terminates failed workers and allows retry without publishing a cold module', async () => {
    for (const fail of [
        worker => worker.onmessage({ data: { error: 'preparation failed' } }),
        worker => worker.onerror({ message: 'worker failed' }),
        worker => worker.onmessageerror()
    ]) {
        const { info, workers, options } = harness();
        const pending = warmUpDspModule(info, 48000, options);
        fail(workers[0]);
        await assert.rejects(pending);
        assert.equal(workers[0].terminated, true);
        const retry = warmUpDspModule(info, 48000, options);
        workers[1].onmessage({ data: { module: info.module } });
        await retry;
    }
});
