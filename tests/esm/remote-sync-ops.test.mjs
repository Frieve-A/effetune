import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyOps, deepEqual, diff, MAX_OPS, MAX_STAGES, resolvePosition, validateOps
} from '../../js/remote/sync-ops.mjs';

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const NAMES = ['Volume', '5Band PEQ', 'Mute', 'Limiter'];

function randomItem(rand, nm = NAMES[Math.floor(rand() * NAMES.length)]) {
    const item = { nm, en: rand() < 0.8, vl: Math.round(rand() * 40) - 20, tp: ['a', 'b', 'c'][Math.floor(rand() * 3)] };
    if (rand() < 0.3) item.ib = Math.floor(rand() * 3);
    if (rand() < 0.2) item.ob = Math.floor(rand() * 3);
    if (rand() < 0.2) item.ch = 'L';
    if (rand() < 0.3) item.ms0 = 'left-measurement';
    return item;
}

function randomSnapshot(rand, prefix, count) {
    const ids = [];
    const pipeline = [];
    for (let i = 0; i < count; i += 1) { ids.push(`${prefix}${i}`); pipeline.push(randomItem(rand)); }
    return { masterBypass: rand() < 0.5, slot: 'A', pipeline, ids };
}

function mutate(rand, snapshot, serial) {
    const next = {
        masterBypass: snapshot.masterBypass,
        slot: snapshot.slot,
        pipeline: snapshot.pipeline.map(item => ({ ...item })),
        ids: snapshot.ids.slice()
    };
    const steps = 1 + Math.floor(rand() * 8);
    for (let s = 0; s < steps; s += 1) {
        const roll = rand();
        const n = next.ids.length;
        if (roll < 0.2 && n > 0) {
            const i = Math.floor(rand() * n);
            next.ids.splice(i, 1);
            next.pipeline.splice(i, 1);
        } else if (roll < 0.4 && n < 40) {
            const i = Math.floor(rand() * (n + 1));
            next.ids.splice(i, 0, `n${serial.value += 1}`);
            next.pipeline.splice(i, 0, randomItem(rand));
        } else if (roll < 0.6 && n > 1) {
            const from = Math.floor(rand() * n);
            const [id] = next.ids.splice(from, 1);
            const [item] = next.pipeline.splice(from, 1);
            const to = Math.floor(rand() * n);
            next.ids.splice(to, 0, id);
            next.pipeline.splice(to, 0, item);
        } else if (roll < 0.85 && n > 0) {
            const i = Math.floor(rand() * n);
            const item = next.pipeline[i];
            item.vl = Math.round(rand() * 40) - 20;
            if (rand() < 0.3) item.en = !item.en;
            if (rand() < 0.3) { if (item.ib === undefined) item.ib = 1; else delete item.ib; }
            if (rand() < 0.2) { if (item.ch === undefined) item.ch = 'R'; else delete item.ch; }
            if (rand() < 0.3) { if (item.ms0 === undefined) item.ms0 = 'right-measurement'; else delete item.ms0; }
        } else if (roll < 0.92 && n > 0) {
            const i = Math.floor(rand() * n);
            next.pipeline[i] = randomItem(rand, NAMES[(NAMES.indexOf(next.pipeline[i].nm) + 1) % NAMES.length]);
        } else {
            next.masterBypass = !next.masterBypass;
        }
    }
    return next;
}

function lisLength(values) {
    const tails = [];
    for (const value of values) {
        let lo = 0;
        let hi = tails.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < value) lo = mid + 1; else hi = mid; }
        tails[lo] = value;
    }
    return tails.length;
}

test('applying the diff of two random snapshots reproduces the second one', () => {
    for (let seed = 1; seed <= 3000; seed += 1) {
        const rand = rng(seed);
        const prev = randomSnapshot(rand, 'p', Math.floor(rand() * 41));
        const serial = { value: 0 };
        const next = mutate(rand, prev, serial);
        const ops = diff(prev, next);
        const frozen = JSON.stringify(prev);
        const result = applyOps(prev, ops);
        assert.equal(JSON.stringify(prev), frozen, `seed ${seed}: input mutated`);
        assert.deepEqual(result.skipped, [], `seed ${seed}: skipped ops`);
        assert.ok(deepEqual(result.snapshot, next), `seed ${seed}: ${JSON.stringify(ops)}`);
        assert.equal(validateOps(ops, { currentLength: prev.ids.length }).ok, true, `seed ${seed}`);
    }
});

test('a pure reorder emits one move per stage outside the longest stable run', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
        const rand = rng(seed * 7);
        const n = 2 + Math.floor(rand() * 20);
        const prev = randomSnapshot(rand, 'p', n);
        const order = prev.ids.map((_, i) => i);
        for (let i = n - 1; i > 0; i -= 1) {
            const j = Math.floor(rand() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        const next = { ...prev, ids: order.map(i => prev.ids[i]), pipeline: order.map(i => prev.pipeline[i]) };
        const ops = diff(prev, next);
        assert.ok(ops.every(op => op.t === 'mov'));
        assert.equal(ops.length, n - lisLength(order), `seed ${seed}`);
        assert.ok(deepEqual(applyOps(prev, ops).snapshot, next));
    }
});

test('a single parameter tweak is one set with only the changed keys', () => {
    const prev = { masterBypass: false, slot: 'A', ids: ['a', 'b'], pipeline: [{ nm: 'Volume', en: true, vl: 0 }, { nm: 'Mute', en: true }] };
    const next = { ...prev, pipeline: [{ nm: 'Volume', en: true, vl: -3 }, prev.pipeline[1]] };
    assert.deepEqual(diff(prev, next), [{ t: 'set', id: 'a', p: { vl: -3 } }]);
    assert.deepEqual(diff(prev, prev), []);
});

test('removing an optional bus key travels as a deletion list', () => {
    const prev = { masterBypass: false, slot: 'A', ids: ['a'], pipeline: [{ nm: 'Volume', en: true, ib: 2 }] };
    const next = { ...prev, pipeline: [{ nm: 'Volume', en: true }] };
    const ops = diff(prev, next);
    assert.deepEqual(ops, [{ t: 'set', id: 'a', p: {}, d: ['ib'] }]);
    assert.deepEqual(applyOps(prev, ops).snapshot.pipeline[0], { nm: 'Volume', en: true });
});

test('position rule honours the anchor, the head and a missing anchor', () => {
    const ids = ['a', 'b', 'c'];
    assert.equal(resolvePosition(ids, null, 2), 0);
    assert.equal(resolvePosition(ids, 'b', 0), 2);
    assert.equal(resolvePosition(ids, 'gone', 2), 2);
    assert.equal(resolvePosition(ids, 'gone', 99), 3);
    const snapshot = { masterBypass: false, ids, pipeline: ids.map(id => ({ nm: id })) };
    const insert = after => applyOps(snapshot, [{ t: 'ins', id: 'x', after, at: 1, item: { nm: 'X' } }]).snapshot.ids;
    assert.deepEqual(insert(null), ['x', 'a', 'b', 'c']);
    assert.deepEqual(insert('c'), ['a', 'b', 'c', 'x']);
    assert.deepEqual(insert('gone'), ['a', 'x', 'b', 'c']);
});

test('operations on missing stages are skipped and reported', () => {
    const snapshot = { masterBypass: false, ids: ['a'], pipeline: [{ nm: 'Volume', vl: 1 }] };
    const ops = [
        { t: 'set', id: 'zz', p: { vl: 2 } },
        { t: 'del', id: 'zz' },
        { t: 'mov', id: 'zz', after: null, at: 0 },
        { t: 'ins', id: 'a', after: null, at: 0, item: { nm: 'Mute' } },
        { t: 'set', id: 'a', p: { vl: 5 } }
    ];
    const result = applyOps(snapshot, ops);
    assert.deepEqual(result.skipped, [0, 1, 2, 3]);
    assert.equal(result.snapshot.pipeline[0].vl, 5);
});

test('applying a batch twice gives the same result as applying it once', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
        const rand = rng(seed * 13);
        const prev = randomSnapshot(rand, 'p', Math.floor(rand() * 15));
        const next = mutate(rand, prev, { value: 0 });
        const ops = diff(prev, next);
        const once = applyOps(prev, ops).snapshot;
        const twice = applyOps(once, ops).snapshot;
        assert.ok(deepEqual(once, twice), `seed ${seed}`);
    }
});

test('validation rejects malformed batches before anything is applied', () => {
    const ok = { isAvailable: nm => nm === 'Volume', currentLength: 0 };
    assert.equal(validateOps('x', ok).error, 'invalid-op');
    assert.equal(validateOps([null], ok).error, 'invalid-op');
    assert.equal(validateOps([{ t: 'nope' }], ok).error, 'invalid-op');
    assert.equal(validateOps([{ t: 'set', id: 'bad id', p: {} }], ok).error, 'invalid-op');
    assert.equal(validateOps([{ t: 'set', id: 'a', p: { nm: 'X' } }], ok).error, 'invalid-op');
    assert.equal(validateOps([{ t: 'set', id: 'a', p: JSON.parse('{"__proto__":1}') }], ok).error, 'invalid-op');
    for (const key of ['nm', 'en', '__proto__', 'constructor', 'prototype', 1]) {
        assert.equal(validateOps([{ t: 'set', id: 'a', p: {}, d: [key] }], ok).error, 'invalid-op');
    }
    assert.equal(validateOps([{ t: 'set', id: 'a', p: {}, d: ['ms0', 'mn0'] }], ok).ok, true);
    assert.equal(validateOps([{ t: 'ins', id: 'a', after: null, at: -1, item: { nm: 'Volume' } }], ok).error, 'invalid-op');
    assert.equal(validateOps([{ t: 'ins', id: 'a', after: null, at: 0, item: { nm: 'Nope' } }], ok).error, 'unknown-effect');
    assert.equal(validateOps([{ t: 'bypass', on: 1 }], ok).error, 'invalid-op');
    assert.equal(validateOps([{ t: 'mov', id: 'a', after: 5, at: 0 }], ok).error, 'invalid-op');
    assert.equal(validateOps(new Array(MAX_OPS + 1).fill({ t: 'bypass', on: true }), ok).error, 'too-long');
    const inserts = Array.from({ length: 3 }, (_, i) => ({ t: 'ins', id: `i${i}`, after: null, at: 0, item: { nm: 'Volume' } }));
    assert.equal(validateOps(inserts, { ...ok, currentLength: MAX_STAGES - 2 }).error, 'too-long');
    assert.equal(validateOps(inserts, { ...ok, currentLength: MAX_STAGES - 3 }).ok, true);
    assert.equal(validateOps([{ t: 'bypass', on: false }], ok).ok, true);
});

test('a replaced stage under the same id is deleted and inserted again', () => {
    const prev = { masterBypass: false, ids: ['a', 'b'], pipeline: [{ nm: 'Volume' }, { nm: 'Mute' }] };
    const next = { masterBypass: false, ids: ['a', 'b'], pipeline: [{ nm: 'Limiter' }, { nm: 'Mute' }] };
    const ops = diff(prev, next);
    assert.deepEqual(ops.map(op => op.t), ['del', 'ins']);
    assert.ok(deepEqual(applyOps(prev, ops).snapshot, next));
});
