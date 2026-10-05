// Pure op vocabulary for pipeline sync over remote-v1 ("sync1").
//
// A snapshot is { masterBypass, slot, pipeline: [short item], ids: [string] }.
// `ids` is parallel to `pipeline`. Ops address stages by id, never by index, so
// concurrent edits from several participants rebase deterministically:
//
//   { t: 'set',    id, p: { <shortKey>: value, ... }, d?: [ <optional shortKey>, ... ] }
//   { t: 'ins',    id, after: id | null, at: int, item: { nm, ... } }
//   { t: 'del',    id }
//   { t: 'mov',    id, after: id | null, at: int }
//   { t: 'bypass', on: boolean }
//
// Position rule (identical on every participant): `after === null` puts the
// stage at the head; otherwise, if the `after` id exists the stage goes right
// after it; otherwise it goes at min(at, length).
//
// This module has no DOM, Electron or audio dependency: the host renderer, the
// browser client and the node tests all load the same file.

export const ID_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;
export const MAX_STAGES = 256;
export const MAX_OPS = 512;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_SET_KEYS = 512;

export function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
        return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false;
        return true;
    }
    const keysA = Object.keys(a);
    if (keysA.length !== Object.keys(b).length) return false;
    for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(b, key) || !deepEqual(a[key], b[key])) return false;
    }
    return true;
}

function clone(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validId(id) {
    return typeof id === 'string' && ID_PATTERN.test(id);
}

export function resolvePosition(ids, after, at) {
    if (after === null) return 0;
    const index = ids.indexOf(after);
    if (index >= 0) return index + 1;
    return Math.max(0, Math.min(Number.isInteger(at) ? at : ids.length, ids.length));
}

// Returns { ok: true } or { ok: false, error: 'invalid-op' | 'unknown-effect' | 'too-long' }.
export function validateOps(ops, { isAvailable = () => true, currentLength = 0 } = {}) {
    if (!Array.isArray(ops)) return { ok: false, error: 'invalid-op' };
    if (ops.length > MAX_OPS) return { ok: false, error: 'too-long' };
    let length = currentLength;
    for (const op of ops) {
        if (!isPlainObject(op)) return { ok: false, error: 'invalid-op' };
        switch (op.t) {
            case 'set': {
                if (!validId(op.id) || !isPlainObject(op.p)) return { ok: false, error: 'invalid-op' };
                const keys = Object.keys(op.p);
                if (keys.length > MAX_SET_KEYS || keys.some(key => FORBIDDEN_KEYS.has(key) || key === 'nm')) {
                    return { ok: false, error: 'invalid-op' };
                }
                if (op.d !== undefined && (!Array.isArray(op.d) ||
                    op.d.length > MAX_SET_KEYS || op.d.some(key => typeof key !== 'string' ||
                        FORBIDDEN_KEYS.has(key) || key === 'nm' || key === 'en'))) {
                    return { ok: false, error: 'invalid-op' };
                }
                break;
            }
            case 'ins': {
                if (!validId(op.id) || !(op.after === null || validId(op.after)) ||
                    !Number.isInteger(op.at) || op.at < 0 || !isPlainObject(op.item) ||
                    typeof op.item.nm !== 'string') {
                    return { ok: false, error: 'invalid-op' };
                }
                if (Object.keys(op.item).some(key => FORBIDDEN_KEYS.has(key))) {
                    return { ok: false, error: 'invalid-op' };
                }
                if (!isAvailable(op.item.nm)) return { ok: false, error: 'unknown-effect' };
                length += 1;
                break;
            }
            case 'del':
                if (!validId(op.id)) return { ok: false, error: 'invalid-op' };
                length -= 1;
                break;
            case 'mov':
                if (!validId(op.id) || !(op.after === null || validId(op.after)) ||
                    !Number.isInteger(op.at) || op.at < 0) {
                    return { ok: false, error: 'invalid-op' };
                }
                break;
            case 'bypass':
                if (typeof op.on !== 'boolean') return { ok: false, error: 'invalid-op' };
                break;
            default:
                return { ok: false, error: 'invalid-op' };
        }
    }
    // Upper bound on the result: a `del` of a missing id would not shrink it.
    if (length > MAX_STAGES) return { ok: false, error: 'too-long' };
    return { ok: true };
}

// Applies ops to a snapshot without mutating it. Ops that do not apply (missing
// id, duplicate insert) are skipped; their indexes are returned in `skipped`.
export function applyOps(snapshot, ops) {
    const pipeline = snapshot.pipeline.slice();
    const ids = snapshot.ids.slice();
    let masterBypass = !!snapshot.masterBypass;
    const skipped = [];
    ops.forEach((op, opIndex) => {
        switch (op.t) {
            case 'set': {
                const index = ids.indexOf(op.id);
                if (index < 0) { skipped.push(opIndex); return; }
                const item = { ...pipeline[index] };
                for (const [key, value] of Object.entries(op.p)) item[key] = clone(value);
                for (const key of op.d || []) delete item[key];
                pipeline[index] = item;
                return;
            }
            case 'ins': {
                if (ids.includes(op.id)) { skipped.push(opIndex); return; }
                if (ids.length >= MAX_STAGES) { skipped.push(opIndex); return; }
                const position = resolvePosition(ids, op.after, op.at);
                ids.splice(position, 0, op.id);
                pipeline.splice(position, 0, clone(op.item));
                return;
            }
            case 'del': {
                const index = ids.indexOf(op.id);
                if (index < 0) { skipped.push(opIndex); return; }
                ids.splice(index, 1);
                pipeline.splice(index, 1);
                return;
            }
            case 'mov': {
                const index = ids.indexOf(op.id);
                if (index < 0 || op.after === op.id) { skipped.push(opIndex); return; }
                const [item] = pipeline.splice(index, 1);
                ids.splice(index, 1);
                const position = resolvePosition(ids, op.after, op.at);
                ids.splice(position, 0, op.id);
                pipeline.splice(position, 0, item);
                return;
            }
            case 'bypass':
                masterBypass = op.on === true;
                return;
            default:
                skipped.push(opIndex);
        }
    });
    return { snapshot: { ...snapshot, masterBypass, pipeline, ids }, skipped };
}

// Indexes (into `values`) of a longest strictly increasing subsequence.
function longestIncreasingSubsequence(values) {
    const tails = [];      // tails[k] = index in values of the smallest tail of a length k+1 run
    const previous = new Array(values.length).fill(-1);
    for (let i = 0; i < values.length; i += 1) {
        let lo = 0;
        let hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (values[tails[mid]] < values[i]) lo = mid + 1; else hi = mid;
        }
        if (lo > 0) previous[i] = tails[lo - 1];
        tails[lo] = i;
    }
    const result = new Set();
    let at = tails.length ? tails[tails.length - 1] : -1;
    while (at >= 0) { result.add(at); at = previous[at]; }
    return result;
}

function setOp(id, prevItem, nextItem) {
    const p = {};
    let changed = false;
    for (const key of Object.keys(nextItem)) {
        if (key === 'nm') continue;
        if (!Object.prototype.hasOwnProperty.call(prevItem, key) || !deepEqual(prevItem[key], nextItem[key])) {
            p[key] = clone(nextItem[key]);
            changed = true;
        }
    }
    const d = Object.keys(prevItem).filter(key => key !== 'nm' && key !== 'en' &&
        !Object.prototype.hasOwnProperty.call(nextItem, key));
    if (!changed && d.length === 0) return null;
    return d.length ? { t: 'set', id, p, d } : { t: 'set', id, p };
}

// Ops that turn `prev` into `next`: applyOps(prev, diff(prev, next)) deep-equals next.
export function diff(prev, next) {
    const ops = [];
    const nextIndexOf = new Map(next.ids.map((id, index) => [id, index]));
    const prevIndexOf = new Map(prev.ids.map((id, index) => [id, index]));
    const survives = id => nextIndexOf.has(id) && prevIndexOf.has(id) &&
        prev.pipeline[prevIndexOf.get(id)].nm === next.pipeline[nextIndexOf.get(id)].nm;

    for (const id of prev.ids) if (!survives(id)) ops.push({ t: 'del', id });
    // A surviving id whose stage was replaced (different nm) was deleted above;
    // the walk below inserts it again.
    const survivors = prev.ids.filter(survives);
    const stay = longestIncreasingSubsequence(survivors.map(id => nextIndexOf.get(id)));
    const stayIds = new Set(survivors.filter((_, index) => stay.has(index)));
    const present = new Set(survivors);

    next.ids.forEach((id, k) => {
        const after = k === 0 ? null : next.ids[k - 1];
        if (!present.has(id)) {
            ops.push({ t: 'ins', id, after, at: k, item: clone(next.pipeline[k]) });
            present.add(id);
        } else if (!stayIds.has(id)) {
            ops.push({ t: 'mov', id, after, at: k });
        }
    });
    next.ids.forEach((id, k) => {
        if (!survives(id)) return;
        const op = setOp(id, prev.pipeline[prevIndexOf.get(id)], next.pipeline[k]);
        if (op) ops.push(op);
    });
    if (!!prev.masterBypass !== !!next.masterBypass) ops.push({ t: 'bypass', on: !!next.masterBypass });
    return ops;
}
