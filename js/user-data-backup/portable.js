import { convertLongToShortFormat } from '../utils/serialization-utils.js';
import { sha256IrBytes } from '../ir-library/ir-library-id.js';
import { IR_LIBRARY_MAX_ORIGINAL_BYTES } from '../ir-library/ir-library-limits.js';
import { numberedIrOriginalNames } from '../ir-library/ir-library-name.js';
import { validateLayout } from '../visualizer/visualizer-model.js';

export const KINDS = ['pipeline', 'plugin', 'visualizer', 'ir', 'measurement'];
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
export const MAX_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_ITEMS = 10000;
const encoder = new TextEncoder();
const reserved = new Set(['__proto__', 'constructor', 'prototype']);

export function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function canonical(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (record(value)) return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
        .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    throw new Error('This item contains unsupported data.');
}

export const hashJson = value => sha256IrBytes(encoder.encode(canonical(value)));
export const clone = value => structuredClone(value);
export const jsonBytes = value => encoder.encode(JSON.stringify(value));

export function splitMeasurementId(id) {
    const index = id.lastIndexOf('::ch=');
    return index < 0 ? { id, suffix: '' } : { id: id.slice(0, index), suffix: id.slice(index) };
}

function pluginParameters(item) {
    if (item.kind === 'plugin') return [{ name: item.pluginName, params: item.data }];
    if (item.kind !== 'pipeline') return [];
    const plugins = Array.isArray(item.data) ? item.data : item.data.plugins ?? item.data.pipeline;
    if (!Array.isArray(plugins)) throw new Error('This preset does not contain a saved pipeline.');
    return plugins.map(state => ({ name: state.nm ?? state.name,
        params: state.nm !== undefined ? state : state.parameters }));
}

export function references(item) {
    const refs = [];
    const add = (kind, target, property, nameTarget, nameProperty, required = true) => {
        if (!target || !Object.hasOwn(target, property)) return;
        const value = target[property];
        if (typeof value !== 'string' || !value) return;
        const { id, suffix } = kind === 'measurement' ? splitMeasurementId(value) : { id: value, suffix: '' };
        refs.push({ kind, id, suffix, required, target, property, nameTarget, nameProperty });
    };
    for (const { name, params } of pluginParameters(item)) {
        if (!record(params)) throw new Error('This preset contains invalid effect settings.');
        if (name === 'IR Reverb') add('ir', params, 'ir');
        if (name === 'Room EQ') {
            if (Array.isArray(params.ms)) {
                params.ms.forEach((_, index) => add('measurement', params.ms, index,
                    Array.isArray(params.mn) ? params.mn : null, index));
            } else add('measurement', params, 'ms', params, 'mn');
            for (let index = 0; index < 16; index++) add('measurement', params, `ms${index}`, params, `mn${index}`);
        }
        if (name === 'Crosstalk Cancellation') {
            for (const key of ['ll', 'lr', 'rl', 'rr']) add('measurement', params, key);
        }
    }
    if (item.kind === 'measurement' && item.data?.measurement) {
        const measurement = item.data.measurement;
        const calibrations = measurement.interfaceCalibrations ||
            (measurement.interfaceCalibration ? [measurement.interfaceCalibration] : []);
        for (const calibration of calibrations) {
            add('measurement', calibration, 'sourceMeasurementId', calibration, 'sourceMeasurementName', false);
        }
    }
    return refs;
}

function normalizedPlugin(state) {
    const value = state.nm !== undefined ? clone(state) : convertLongToShortFormat(state);
    delete value.id;
    delete value.type;
    value.en = value.en !== false;
    for (const key of ['ib', 'ob']) if (value[key] == null) delete value[key];
    const aliases = { Left: 'L', Right: 'R', All: 'A' };
    if (Object.hasOwn(aliases, value.ch)) value.ch = aliases[value.ch];
    if (value.ch == null || value.ch === '') delete value.ch;
    return value;
}

function contentValue(item) {
    if (item.kind === 'pipeline') {
        const data = Array.isArray(item.data) ? { plugins: item.data } : clone(item.data);
        const states = data.plugins ?? data.pipeline;
        delete data.pipeline;
        for (const key of ['name', 'timestamp', 'id', 'imported', 'importTimestamp', 'lastModified']) delete data[key];
        data.plugins = states.map(normalizedPlugin);
        return data;
    }
    if (item.kind === 'plugin') return { pluginName: item.pluginName, params: item.data };
    if (item.kind === 'visualizer') return clone(item.data);
    if (item.kind === 'ir') return { composition: item.data.entry.composition,
        originals: item.data.originals.map(original => ({ role: original.role, sha256: original.sha256 })) };
    const data = clone(item.data);
    for (const key of ['id', 'name', 'imported', 'importTimestamp', 'lastModified']) delete data.measurement[key];
    data.impulseResponses = data.impulseResponses.map(response => {
        const { measurementId, data: samples, ...metadata } = response;
        return { ...metadata, data: samples };
    }).sort((a, b) => a.pointId - b.pointId);
    return data;
}

export function validateItemShape(item) {
    if (!record(item) || !KINDS.includes(item.kind) || typeof item.id !== 'string' || !item.id ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 4096) {
        throw new Error('The backup contains an invalid item.');
    }
    if (item.kind === 'pipeline') pluginParameters(item);
    if (item.kind === 'visualizer' && !validateLayout(item.data)) {
        throw new Error('The backup contains an invalid visualizer preset.');
    }
    if (item.kind === 'plugin' && (!record(item.data) || typeof item.pluginName !== 'string' || !item.pluginName)) {
        throw new Error('The backup contains an invalid effect preset.');
    }
    if (item.kind === 'measurement' && (!record(item.data?.measurement) ||
        !Array.isArray(item.data.measurement.points) || !Array.isArray(item.data.impulseResponses))) {
        throw new Error('The backup contains an invalid measurement.');
    }
    if (item.kind === 'ir') {
        const roles = item.data?.entry?.composition === 'pair' ? ['L', 'R'] : ['single'];
        if (!['single', 'pair'].includes(item.data?.entry?.composition) ||
            !Array.isArray(item.data.originals) || item.data.originals.length !== roles.length ||
            item.data.originals.some((source, index) => source.role !== roles[index] || typeof source.fileName !== 'string')) {
            throw new Error('The backup contains an invalid impulse response.');
        }
    }
}

export function nameIssue(item) {
    if ((item.kind === 'pipeline' || item.kind === 'plugin' || item.kind === 'visualizer') &&
        (reserved.has(item.name.trim()) || (item.kind === 'plugin' && reserved.has(item.pluginName)))) {
        return 'invalidName';
    }
    return null;
}

export function encodeFloat32(values) {
    if (!(values instanceof Float32Array)) throw new Error('The measurement impulse response is missing.');
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => {
        if (!Number.isFinite(value)) throw new Error('The measurement impulse response contains invalid samples.');
        view.setFloat32(index * 4, value, true);
    });
    return bytes;
}

export function decodeFloat32(bytes) {
    if (bytes.byteLength % 4) throw new Error('The measurement impulse response is damaged.');
    const values = new Float32Array(bytes.byteLength / 4);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < values.length; index++) {
        values[index] = view.getFloat32(index * 4, true);
        if (!Number.isFinite(values[index])) throw new Error('The measurement impulse response contains invalid samples.');
    }
    return values;
}

const FLOAT32_ENCODING = 'float32le';

function* legacyMeasurementPayloads(data) {
    if (data.measurement.speakerModel !== undefined) {
        yield { target: data.measurement, key: 'speakerModel', model: true };
    }
    for (const target of data.impulseResponses) yield { target, key: 'data', model: false };
}

export function* measurementPayloads(data, format = 'raw') {
    if (format === 'legacy') {
        if (data.impulseResponses.some(response => !record(response?.data) || Object.hasOwn(response.data, 'encoding'))) {
            throw new Error('The measurement impulse response is missing.');
        }
        yield* legacyMeasurementPayloads(data);
        return;
    }
    const isSamples = format === 'archive' ? value => value?.encoding === FLOAT32_ENCODING : ArrayBuffer.isView;
    if (data.impulseResponses.some(response => !isSamples(response?.data))) {
        throw new Error('The measurement impulse response is missing.');
    }
    function* visit(target) {
        for (const [key, value] of Object.entries(target)) {
            if (value === undefined) continue;
            const model = target === data.measurement && key === 'speakerModel';
            if (model || isSamples(value)) yield { target, key, model };
            else if (value !== null && typeof value === 'object') yield* visit(value);
        }
    }
    yield* visit(data);
}

export async function packBlob(bytes, addPayload) {
    const hash = await sha256IrBytes(bytes);
    const path = `blobs/${hash}.bin`;
    await addPayload(path, bytes, hash);
    return { blob: path, size: bytes.byteLength };
}

export async function packMeasurement(data, addPayload) {
    for (const { target, key, model } of measurementPayloads(data)) {
        const bytes = model ? jsonBytes(target[key]) : encodeFloat32(target[key]);
        const reference = await packBlob(bytes, addPayload);
        if (!model) reference.encoding = FLOAT32_ENCODING;
        target[key] = reference;
    }
}

export async function prepareItems(sourceItems, { legacyMeasurementFingerprint = false } = {}) {
    const items = sourceItems.map(source => ({ ...source, data: clone(source.data),
        available: source.available !== false, embedded: source.embedded !== false, dependencies: [] }));
    const byId = new Map(items.map(item => [`${item.kind}:${item.id}`, item]));
    const fingerprints = new Map();
    for (const item of items) {
        if (item.embedded === false) continue;
        try {
            validateItemShape(item);
            item.bytes = 0;
            if (item.kind === 'ir') {
                item.bytes = 0;
                for (const original of item.data.originals) {
                    if (!(original.bytes instanceof Uint8Array) || original.bytes.byteLength > IR_LIBRARY_MAX_ORIGINAL_BYTES) {
                        throw new Error('An impulse response is missing or too large.');
                    }
                    original.sha256 = await sha256IrBytes(original.bytes);
                    item.bytes += original.bytes.byteLength;
                }
            } else if (item.kind === 'measurement' && legacyMeasurementFingerprint) {
                // v2.19.0 hashed the model and IR payloads as digests and lengths.
                for (const { target, key, model } of legacyMeasurementPayloads(item.data)) {
                    const bytes = model ? jsonBytes(target[key]) : encodeFloat32(target[key]);
                    target[key] = { sha256: await sha256IrBytes(bytes), bytes: bytes.byteLength };
                }
            } else if (item.kind === 'measurement') {
                const blobs = new Set();
                await packMeasurement(item.data, (path, bytes) => {
                    if (blobs.has(path)) return;
                    blobs.add(path);
                    item.bytes += bytes.byteLength;
                });
                item.metadataBytes = jsonBytes({ id: item.id, pluginName: item.pluginName, data: item.data }).byteLength;
                item.bytes += item.metadataBytes;
            } else item.bytes = jsonBytes(item.data).byteLength;
            item.reason = item.reason || nameIssue(item);
            if (item.reason) item.available = false;
        } catch (error) {
            console.error('Backup item preparation failed:', error);
            item.available = false;
            item.reason = 'invalidData';
        }
    }
    const fingerprint = async (item, visiting = new Set()) => {
        if (fingerprints.has(item.key)) return fingerprints.get(item.key);
        if (!item.available && !item.data) return item.fingerprint;
        if (item.embedded === false) return item.fingerprint;
        if (visiting.has(item.key)) return null;
        visiting.add(item.key);
        const normalized = { ...item, data: clone(item.data) };
        try {
            for (const reference of references(normalized)) {
                const dependency = byId.get(`${reference.kind}:${reference.id}`);
                if (dependency) {
                    if (!item.dependencies.some(value => value.key === dependency.key && value.required === reference.required)) {
                        item.dependencies.push({ key: dependency.key, required: reference.required });
                    }
                }
                const unresolvedHash = !reference.required && /^unresolved:[a-f0-9]{64}$/.test(reference.id)
                    ? reference.id.slice(11) : null;
                const hash = dependency ? await fingerprint(dependency, new Set(visiting)) : unresolvedHash;
                if (!hash || (reference.required && !dependency.available)) {
                    if (reference.required) {
                        item.available = false;
                        item.reason = 'missingData';
                    }
                    reference.target[reference.property] = 'unresolved';
                } else {
                    reference.target[reference.property] = `content:${hash}${reference.suffix}`;
                    if (reference.nameTarget) reference.nameTarget[reference.nameProperty] = '';
                }
            }
            const hash = await hashJson(contentValue(normalized));
            fingerprints.set(item.key, hash);
            return hash;
        } catch (error) {
            console.error('Backup item validation failed:', error);
            item.available = false;
            item.reason = 'invalidData';
            return null;
        }
    };
    for (const item of items) item.fingerprint = await fingerprint(item);
    // Keep raw binaries available for archive generation and storage writes.
    items.forEach((item, index) => { item.data = clone(sourceItems[index].data); });
    return items.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
}

export function selectItems(catalog, keys, includeRelated = false) {
    const byKey = new Map(catalog.items.map(item => [item.key, item]));
    const selected = new Set();
    const visit = key => {
        if (selected.has(key)) return;
        const item = byKey.get(key);
        if (!item || item.available === false) return;
        selected.add(key);
        for (const dependency of item.dependencies || []) {
            if (dependency.required || includeRelated) visit(dependency.key);
        }
    };
    for (const key of keys) visit(key);
    return selected;
}

export function chooseName(item, existing, legacyFingerprints) {
    const sameNamespace = candidate => candidate.kind === item.kind &&
        (item.kind !== 'plugin' || candidate.pluginName === item.pluginName);
    const candidates = existing.filter(sameNamespace);
    const sameFingerprint = candidate => candidate.fingerprint === item.fingerprint ||
        (legacyFingerprints?.has(candidate) && legacyFingerprints.get(candidate) === item.fingerprint);
    if (item.kind === 'ir' || item.kind === 'measurement') {
        const matches = candidate => candidate.available !== false && sameFingerprint(candidate);
        const sameId = item.kind === 'measurement' && candidates.find(candidate => candidate.id === item.id);
        const identical = sameId && matches(sameId) ? sameId
            : item.kind === 'ir' || !item.embedded || sameId ? candidates.find(matches) : null;
        if (identical) return { name: identical.name, existing: identical };
    } else {
        const prefix = `${item.name} (`;
        const family = candidate => candidate.name === item.name || (candidate.name.startsWith(prefix) &&
            candidate.name.endsWith(')') && /^[2-9][0-9]*$|^1[0-9]+$/.test(candidate.name.slice(prefix.length, -1)));
        const identical = candidates.find(candidate => family(candidate) && sameFingerprint(candidate));
        if (identical) return { name: identical.name, existing: identical };
    }
    const names = new Set(candidates.map(candidate => candidate.name));
    if (!names.has(item.name)) return { name: item.name };
    const numberedName = number => item.kind === 'ir' && item.data?.originals
        ? numberedIrOriginalNames(item.data.originals, number).join(' + ')
        : `${item.name} (${number})`;
    let index = 2;
    while (names.has(numberedName(index))) index++;
    return { name: numberedName(index) };
}

export function replaceReferences(item, sourceItems, targets) {
    const result = { ...item, data: clone(item.data) };
    const byId = new Map(sourceItems.map(value => [`${value.kind}:${value.id}`, value]));
    for (const reference of references(result)) {
        const source = byId.get(`${reference.kind}:${reference.id}`);
        const target = source && targets.get(source.key);
        if (!target) {
            if (reference.required) throw new Error('Required data was not restored.');
            reference.target[reference.property] = `unresolved:${source?.fingerprint || reference.id.replace(/^unresolved:/, '')}`;
        } else {
            reference.target[reference.property] = `${target.id}${reference.suffix}`;
            if (reference.nameTarget) reference.nameTarget[reference.nameProperty] = target.name;
        }
    }
    return result.data;
}
