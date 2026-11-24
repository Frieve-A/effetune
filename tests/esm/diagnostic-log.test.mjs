import assert from 'node:assert/strict';
import test from 'node:test';
import {
    closeNativeCounterIntervals, getDiagnosticLog, recordDiagnosticEvent,
    recordNativeCounters, startDiagnosticRecording
} from '../../js/diagnostics/diagnostic-log.js';

test('recording starts explicitly, coalesces consecutive deltas, and evicts oldest events', t => {
    recordDiagnosticEvent('before');
    assert.deepEqual(getDiagnosticLog().events, []);
    const stop = startDiagnosticRecording({});
    t.after(stop);
    recordDiagnosticEvent('change', { reason: 'input', delta: 2 });
    recordDiagnosticEvent('change', { reason: 'input', delta: 4 });
    const [event] = getDiagnosticLog().events;
    assert.equal(event.count, 2);
    assert.equal(event.delta, 6);
    assert.equal(event.origin, 'renderer');
    assert.ok(event.epochMs <= event.lastEpochMs);
    for (let index = 0; index <= 500; index++) recordDiagnosticEvent('sample', { index });
    assert.equal(getDiagnosticLog().events.length, 500);
    assert.equal(getDiagnosticLog().events[0].index, 1);
});

test('Console receives original arguments and repeated cumulative warnings keep earlier errors', t => {
    const originalCalls = [];
    const win = { console: { warn() {}, error(...args) { originalCalls.push(args); } } };
    const stop = startDiagnosticRecording(win);
    t.after(stop);
    assert.equal(startDiagnosticRecording(win), stop);
    const details = { privatePath: '/home/private' };
    win.console.error('Read failed', details);
    for (let i = 1; i <= 300; i++) win.console.warn('Native file playback underruns:', i);
    const entries = getDiagnosticLog().console;
    assert.deepEqual(originalCalls, [['Read failed', details]]);
    assert.equal(originalCalls[0][1], details);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].level, 'error');
    assert.deepEqual(entries[0].args, ['Read failed', '[object Object]']);
    assert.equal(entries[1].count, 300);
    assert.equal(entries[1].args[1], '300');
    for (let i = 0; i < 210; i++) win.console[i % 2 ? 'warn' : 'error']('next');
    assert.equal(getDiagnosticLog().console.length, 200);
});

test('counter intervals survive interleaved observations and restart after a flat observation or session close', t => {
    t.after(startDiagnosticRecording({}));
    for (let i = 1; i <= 700; i++) recordNativeCounters({ feedGaps: i, fileUnderruns: 2 * i });
    let intervals = getDiagnosticLog().events;
    assert.equal(intervals.length, 2);
    assert.ok(intervals.every(entry => entry.ongoing && entry.count === 700));
    recordNativeCounters({ feedGaps: 700, fileUnderruns: 1401 });
    recordNativeCounters({ feedGaps: 703, fileUnderruns: 0 });
    closeNativeCounterIntervals();
    recordNativeCounters({ feedGaps: 1 });
    intervals = getDiagnosticLog().events;
    assert.deepEqual(intervals.map(({ counter, delta }) => [counter, delta]), [
        ['feedGaps', 700], ['fileUnderruns', 1401], ['feedGaps', 3], ['feedGaps', 1]
    ]);
    assert.equal(intervals[3].ongoing, true);
});
