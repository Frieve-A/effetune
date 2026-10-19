import assert from 'node:assert/strict';
import test from 'node:test';
import { animateCounterFrame, counterFrame } from '../../js/visualizer/visualizer-counter.js';
import { normalizeParams } from '../../js/visualizer/visualizer-model.js';

const paramsFor = values => ({ ...normalizeParams('counter', {}), counterWholeDigits: 2,
    counterZeroPad: true, counterDuration: 150, ...values });
const descriptor = (time, values = {}) => ({ time, stamp: time, source: 'track', trackIndex: 1,
    external: false, playing: true, speed: 1, ...values });
const animate = (params, time, previous = null, values = {}) => animateCounterFrame(
    counterFrame(params, time), params, descriptor(time, values), previous?.state);
const changing = result => result.frame.tokens.filter(token => token.from !== undefined);

test('Counter reserves the leading whole field while keeping lower fields and fractional precision', () => {
    const params = paramsFor({ counterWholeDigits: 4 });
    assert.equal(counterFrame(params, 3661.234).text, '0001:01:01.234');
    assert.equal(counterFrame({ ...params, counterZeroPad: false }, 3661.234).text, '   1:01:01.234');
    assert.equal(counterFrame({ ...params, counterHours: false }, 3661.234).text, '0061:01.234');
    assert.equal(counterFrame({ ...params, counterHours: false, counterMinutes: false }, 3661.234).text, '3661.234');
    assert.equal(counterFrame({ ...params, counterHours: false, counterMinutes: false, counterSeconds: false }, .234).text, '234');
    assert.equal(counterFrame({ ...params, counterWholeDigits: 1 }, 360000).text, '100:00:00.000');
});

test('Counter flips and crossfades changed digits together then finishes without restarting', () => {
    for (const counterMotion of ['flip', 'crossfade']) {
        const params = paramsFor({ counterMotion, counterFraction: false });
        const before = animate(params, 59.98);
        const start = animate(params, 60, before);
        assert.equal(start.frame.text, '00:01:00');
        assert.deepEqual(changing(start).map(token => [token.from, token.text]), [['0', '1'], ['5', '0'], ['9', '0']]);
        assert.ok(changing(start).every(token => token.transitionProgress === 0));
        const middle = animate(params, 60.075, start);
        assert.ok(changing(middle).every(token => Math.abs(token.transitionProgress - .5) < 1e-8));
        const after = animate(params, 60.16, middle);
        assert.equal(changing(after).length, 0);
        assert.equal(changing(animate(params, 60.2, after)).length, 0);
    }
});

test('Counter discontinuities display their new value immediately', () => {
    const params = paramsFor({ counterMotion: 'crossfade', counterFraction: false });
    const before = animate(params, 9.98);
    for (const [time, values] of [
        [30, { stamp: 10 }], [0, { stamp: 10 }], [10, { source: 'other' }],
        [10, { trackIndex: 2 }], [10, { external: true }], [10, { playing: false }],
        [10, { speed: 2 }], [11, {}],
    ]) assert.equal(changing(animate(params, time, before, values)).length, 0);
    const paused = animate(params, 9.98, null, { playing: false });
    assert.equal(changing(animate(params, 10, paused)).length, 0);
    const start = animate(params, 10, before);
    assert.ok(changing(start).length);
    assert.equal(changing(animate(params, 10.05, start, { playing: false })).length, 0);
});

test('Counter bounds fast digit transitions and replaces the previous change without a queue', () => {
    const params = paramsFor({ counterMotion: 'crossfade', counterDigits: 1, counterDuration: 1000 });
    const before = animate(params, .09);
    const first = animate(params, .1, before);
    assert.equal(changing(first).at(-1).from, '0');
    const next = animate(params, .2, first);
    assert.equal(changing(next).at(-1).from, '1');
    assert.equal(changing(next).at(-1).text, '2');
    assert.equal(changing(animate(params, .29, next)).length, 0);
    const millis = { ...params, counterDigits: 3 };
    const rapid = animate(millis, .001, animate(millis, 0));
    assert.equal(changing(rapid).length, 0);
    const zeroDuration = { ...params, counterDuration: 0 };
    assert.equal(changing(animate(zeroDuration, .1, animate(zeroDuration, .09))).length, 0);
});

test('Counter transition duration follows playback speed and leaves continuous roll unchanged', () => {
    const params = paramsFor({ counterMotion: 'flip', counterFraction: false, counterDuration: 1000 });
    const before = animate(params, .98, null, { stamp: .49, speed: 2 });
    const start = animate(params, 1, before, { stamp: .5, speed: 2 });
    const middle = animate(params, 1.4, start, { stamp: .7, speed: 2 });
    assert.ok(changing(middle).every(token => Math.abs(token.transitionProgress - .5) < 1e-8));
    assert.equal(changing(animate(params, 1.82, middle, { stamp: .91, speed: 2 })).length, 0);
    const rollParams = { ...params, counterMotion: 'tape' };
    const roll = animate(rollParams, 9.5, animate(rollParams, 9.4));
    assert.ok(roll.frame.tokens.some(token => token.progress === .5));
    assert.equal(changing(roll).length, 0);
});

test('Counter frame fields count from zero and roll every changed wheel into the next second', () => {
    for (const fps of [24, 30, 60, 120]) {
        const params = paramsFor({ counterSubsecond: 'frames', counterFps: fps, counterMotion: 'tape' });
        const before = counterFrame(params, 1 - .5 / fps);
        assert.equal(before.text, `00:00:00.${String(fps - 1).padStart(fps > 100 ? 3 : 2, '0')}`);
        const fraction = before.tokens.slice(-(fps > 100 ? 3 : 2));
        assert.ok(fraction.filter(token => token.text !== '0').every(token => token.next === '0' && Math.abs(token.progress - .5) < 1e-8));
        const after = counterFrame(params, 1);
        assert.equal(after.text, `00:00:01.${'0'.repeat(fps > 100 ? 3 : 2)}`);
        assert.equal(after.tokens.at(-2).previous, String(Math.floor((fps - 1) / 10) % 10));
        assert.equal(after.tokens.at(-1).previous, String((fps - 1) % 10));
    }
    const params = paramsFor({ counterSubsecond: 'frames', counterFps: 24 });
    assert.equal(counterFrame(params, .5).text, '00:00:00.12');
    assert.equal(counterFrame({ ...params, counterFps: 1 }, .9).text, '00:00:00.00');
    assert.equal(counterFrame({ ...params, counterFraction: false }, 1.99).text, '00:00:01');
});

test('Counter frame fields start at zero on exact second boundaries at every supported frame rate', () => {
    for (let fps = 1; fps <= 120; fps++) {
        const params = paramsFor({ counterSubsecond: 'frames', counterFps: fps, counterMotion: 'tape' });
        const suffix = '0'.repeat(Math.max(2, String(fps - 1).length));
        for (const [time, whole] of [[1, '00:00:01'], [60, '00:01:00'], [3600, '01:00:00']]) {
            const frame = counterFrame(params, time);
            assert.equal(frame.text, `${whole}.${suffix}`, `${fps} FPS at ${time} seconds`);
            assert.ok(frame.tokens.every(token => !token.progress));
        }
    }
});
