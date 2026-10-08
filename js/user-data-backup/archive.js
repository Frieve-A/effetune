import { loadClassicScript } from '../utils/classic-script-loader.js';
import { sha256IrBytes } from '../ir-library/ir-library-id.js';
import { encodeIrAnalysisSidecar } from '../ir-library/ir-analysis-sidecar.js';
import { IR_LIBRARY_MAX_ORIGINAL_BYTES, IR_LIBRARY_MAX_ANALYSIS_BYTES, requireBoundedIrBytes } from '../ir-library/ir-library-limits.js';
import { MAX_BACKUP_BYTES, MAX_ITEMS, MAX_JSON_BYTES, KINDS, clone, jsonBytes,
    record, encodeFloat32, decodeFloat32, validateItemShape } from './portable.js';

const FORMAT = 'effetune-user-data-backup';
const decoder = new TextDecoder('utf-8', { fatal: true });
const HASH = /^[a-f0-9]{64}$/;

export async function loadZipClass() {
    return globalThis.JSZip || loadClassicScript(new URL('../vendor/jszip-3.10.2.min.js', import.meta.url).href,
        { globalName: 'JSZip' });
}

export function checkCancelled(signal) {
    if (signal?.aborted) throw new DOMException('The operation was cancelled.', 'AbortError');
}

function requirePath(path) {
    if (typeof path !== 'string' || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(path) ||
        path.split('/').some(part => part === '.' || part === '..')) {
        throw new Error('The backup contains an unsafe file path.');
    }
}

// Inspect the directory before JSZip can normalize or overwrite entry names.
export function inspectZip(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BACKUP_BYTES || bytes.byteLength < 22) {
        throw new Error('The backup is too large or is not a valid backup file.');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - 65557); end--) {
        if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
    }
    if (end < 0 || view.getUint32(end, true) !== 0x06054b50 || view.getUint16(end + 4, true) ||
        view.getUint16(end + 6, true)) throw new Error('This backup ZIP format is not supported.');
    const count = view.getUint16(end + 10, true);
    let position = view.getUint32(end + 16, true);
    if (count !== view.getUint16(end + 8, true) || count > MAX_ITEMS * 8 + 1 ||
        count === 65535 || position + view.getUint32(end + 12, true) !== end) {
        throw new Error('The backup directory is invalid or too large.');
    }
    const entries = new Map();
    const occupied = [];
    let total = 0;
    for (let index = 0; index < count; index++) {
        if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) throw new Error('The backup directory is damaged.');
        const flags = view.getUint16(position + 8, true);
        const method = view.getUint16(position + 10, true);
        const compressed = view.getUint32(position + 20, true);
        const size = view.getUint32(position + 24, true);
        const nameSize = view.getUint16(position + 28, true);
        const extraSize = view.getUint16(position + 30, true);
        const commentSize = view.getUint16(position + 32, true);
        const attributes = view.getUint32(position + 38, true);
        const local = view.getUint32(position + 42, true);
        const next = position + 46 + nameSize + extraSize + commentSize;
        if (next > end || flags & 0x2041 || ![0, 8].includes(method) || view.getUint16(position + 34, true) ||
            (attributes & 16) || ((attributes >>> 16) & 0xf000) && ((attributes >>> 16) & 0xf000) !== 0x8000) {
            throw new Error('The backup contains an unsupported file entry.');
        }
        const path = decoder.decode(bytes.subarray(position + 46, position + 46 + nameSize));
        requirePath(path);
        if (entries.has(path)) throw new Error('The backup contains duplicate file paths.');
        if (local + 30 > position || view.getUint32(local, true) !== 0x04034b50 ||
            view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) {
            throw new Error('The backup file headers do not match.');
        }
        const localNameSize = view.getUint16(local + 26, true);
        const localExtra = view.getUint16(local + 28, true);
        const dataStart = local + 30 + localNameSize + localExtra;
        if (dataStart + compressed > view.getUint32(end + 16, true) ||
            decoder.decode(bytes.subarray(local + 30, local + 30 + localNameSize)) !== path ||
            (!(flags & 8) && (view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== size))) {
            throw new Error('The backup file headers do not match.');
        }
        total += size;
        if (total > MAX_BACKUP_BYTES || size > MAX_BACKUP_BYTES) throw new Error('The expanded backup is too large. Split the selection into smaller backups.');
        entries.set(path, { size });
        occupied.push([local, dataStart + compressed]);
        position = next;
    }
    occupied.sort((a, b) => a[0] - b[0]);
    if (position !== end || occupied.some((range, index) => index && range[0] < occupied[index - 1][1])) {
        throw new Error('The backup contains overlapping file entries.');
    }
    return entries;
}

async function readBounded(zip, entries, path, maxBytes, signal) {
    checkCancelled(signal);
    const expected = entries.get(path);
    const file = zip.file(path);
    if (!expected || !file || expected.size > maxBytes) throw new Error('A backup file is missing or exceeds the size limit.');
    return new Promise((resolve, reject) => {
        const stream = file.internalStream('uint8array');
        const chunks = [];
        let length = 0;
        let stopped = false;
        const fail = error => {
            if (stopped) return;
            stopped = true;
            stream.pause();
            chunks.length = 0;
            signal?.removeEventListener('abort', abort);
            reject(error);
        };
        const abort = () => fail(new DOMException('The operation was cancelled.', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true });
        stream.on('data', chunk => {
            if (stopped) return;
            length += chunk.byteLength;
            if (length > maxBytes || length > expected.size) return fail(new Error('A backup file expands beyond its declared size.'));
            chunks.push(chunk);
        }).on('error', fail).on('end', () => {
            if (stopped) return;
            signal?.removeEventListener('abort', abort);
            if (length !== expected.size) return fail(new Error('A backup file has the wrong size.'));
            const bytes = new Uint8Array(length);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            chunks.length = 0;
            stopped = true;
            resolve(bytes);
        }).resume();
    });
}

function metadataPath(kind, key) {
    const folder = kind === 'pipeline' || kind === 'plugin' || kind === 'visualizer'
        ? `presets/${kind}` : kind === 'measurement' ? 'measurements' : 'ir';
    return `${folder}/${key}.json`;
}

export async function createArchive(items, { appVersion = '', embedIr = true, embedMeasurements = true,
    loadZip = loadZipClass, signal, onProgress } = {}) {
    const Zip = await loadZip();
    const zip = new Zip();
    const keys = new Map(items.map((item, index) => [item.key, `item${index + 1}`]));
    const payloads = [];
    const payloadNames = new Set();
    let total = 0;
    const addPayload = async (path, bytes) => {
        if (payloadNames.has(path)) return;
        total += bytes.byteLength;
        if (total > MAX_BACKUP_BYTES) throw new Error('This selection exceeds 256 MB. Select fewer items and create separate backups.');
        zip.file(path, bytes, { createFolders: false });
        payloads.push({ path, size: bytes.byteLength, sha256: await sha256IrBytes(bytes) });
        payloadNames.add(path);
    };
    const blob = async bytes => {
        const hash = await sha256IrBytes(bytes);
        const path = `blobs/${hash}.bin`;
        await addPayload(path, bytes);
        return { blob: path, size: bytes.byteLength };
    };
    const manifestItems = [];
    for (const [index, item] of items.entries()) {
        checkCancelled(signal);
        const key = keys.get(item.key);
        const embedded = item.kind === 'ir' ? embedIr : item.kind === 'measurement' ? embedMeasurements : true;
        const metadata = { id: item.id, pluginName: item.pluginName };
        if (embedded) {
            metadata.data = clone(item.data);
            if (item.kind === 'ir') {
                for (const source of metadata.data.entry.originals || []) delete source.storageName;
                if (metadata.data.entry.analysis) delete metadata.data.entry.analysis.storageName;
                for (const original of metadata.data.originals) original.bytes = await blob(original.bytes);
                if (metadata.data.analysis) {
                    for (const series of ['envelope', 'edc']) {
                        const values = metadata.data.analysis[series];
                        if (values) metadata.data.analysis[series] = await blob(encodeFloat32(values));
                    }
                }
            } else if (item.kind === 'measurement') {
                for (const response of metadata.data.impulseResponses) response.data = await blob(encodeFloat32(response.data));
            }
        }
        const path = metadataPath(item.kind, key);
        const bytes = jsonBytes(metadata);
        if (bytes.byteLength > MAX_JSON_BYTES) throw new Error('An item is too large to include in this backup.');
        await addPayload(path, bytes);
        manifestItems.push({ key, kind: item.kind, name: item.name, fingerprint: item.fingerprint, embedded,
            metadata: path, dependencies: item.dependencies.filter(dependency => keys.has(dependency.key))
                .map(dependency => ({ ...dependency, key: keys.get(dependency.key) })) });
        onProgress?.({ completed: index + 1, total: items.length, currentName: item.name });
    }
    const manifest = jsonBytes({ format: FORMAT, schemaVersion: 1, appVersion,
        createdAt: new Date().toISOString(), items: manifestItems, payloads });
    if (manifest.byteLength > MAX_JSON_BYTES || total + manifest.byteLength > MAX_BACKUP_BYTES) {
        throw new Error('This selection is too large. Create separate backups with fewer items.');
    }
    zip.file('manifest.json', manifest, { createFolders: false });
    checkCancelled(signal);
    const result = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }, () => checkCancelled(signal));
    if (result.byteLength > MAX_BACKUP_BYTES) throw new Error('This selection is too large. Create separate backups with fewer items.');
    checkCancelled(signal);
    return new Blob([result], { type: 'application/octet-stream' });
}

export async function openArchive(file, { loadZip = loadZipClass, signal } = {}) {
    if (file?.size > MAX_BACKUP_BYTES) throw new Error('The backup exceeds the 256 MB limit. Choose a smaller backup.');
    const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
    const entries = inspectZip(bytes);
    const Zip = await loadZip();
    const zip = await Zip.loadAsync(bytes, { createFolders: false, checkCRC32: false });
    const manifest = JSON.parse(decoder.decode(await readBounded(zip, entries, 'manifest.json', MAX_JSON_BYTES, signal)));
    if (!record(manifest) || manifest.format !== FORMAT) throw new Error('Choose an EffeTune backup file.');
    if (manifest.schemaVersion !== 1) throw new Error('This backup uses a newer format. Update EffeTune and try again.');
    if (!Array.isArray(manifest.items) || manifest.items.length > MAX_ITEMS || !Array.isArray(manifest.payloads)) {
        throw new Error('The backup item list is invalid or too large.');
    }
    const payloads = new Map();
    for (const payload of manifest.payloads) {
        if (!record(payload) || typeof payload.path !== 'string' || !HASH.test(payload.sha256) ||
            !Number.isSafeInteger(payload.size) || payload.size < 0 || payloads.has(payload.path) ||
            entries.get(payload.path)?.size !== payload.size || payload.path === 'manifest.json') {
            throw new Error('The backup file list is invalid.');
        }
        requirePath(payload.path);
        payloads.set(payload.path, payload);
    }
    if (payloads.size + 1 !== entries.size) throw new Error('The backup contains unlisted files.');
    const readPayload = async (path, maxBytes = MAX_BACKUP_BYTES, selectedSignal) => {
        const payload = payloads.get(path);
        if (!payload) throw new Error('A required backup file is missing.');
        const data = await readBounded(zip, entries, path, maxBytes, selectedSignal);
        if (await sha256IrBytes(data) !== payload.sha256) throw new Error('The backup is damaged. Choose another copy of the file.');
        return data;
    };
    const keys = new Set();
    const ids = new Set();
    const usedMetadata = new Set();
    const items = [];
    for (const entry of manifest.items) {
        if (!record(entry) || typeof entry.key !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(entry.key) || keys.has(entry.key) ||
            !KINDS.includes(entry.kind) || typeof entry.name !== 'string' || !entry.name.trim() ||
            !HASH.test(entry.fingerprint) || typeof entry.embedded !== 'boolean' ||
            entry.metadata !== metadataPath(entry.kind, entry.key) || usedMetadata.has(entry.metadata) ||
            !Array.isArray(entry.dependencies) || entry.dependencies.length > MAX_ITEMS) {
            throw new Error('The backup contains an invalid item description.');
        }
        if (!entry.embedded && !['ir', 'measurement'].includes(entry.kind)) throw new Error('This preset has no saved settings.');
        const metadata = JSON.parse(decoder.decode(await readPayload(entry.metadata, MAX_JSON_BYTES, signal)));
        if (!record(metadata) || typeof metadata.id !== 'string' || !metadata.id ||
            (entry.embedded && metadata.data === undefined) || (!entry.embedded && metadata.data !== undefined)) {
            throw new Error('The backup contains invalid item information.');
        }
        const identity = `${entry.kind}:${entry.kind === 'plugin' ? `${metadata.pluginName}:` : ''}${metadata.id}`;
        if (ids.has(identity)) throw new Error('The backup repeats an item identifier.');
        ids.add(identity);
        keys.add(entry.key);
        usedMetadata.add(entry.metadata);
        const item = { ...entry, id: metadata.id, pluginName: metadata.pluginName, data: metadata.data, available: true,
            bytes: entry.embedded ? payloads.get(entry.metadata).size : 0 };
        if (entry.embedded) validateItemShape(item);
        items.push(item);
    }
    for (const item of items) {
        for (const dependency of item.dependencies) {
            if (!record(dependency) || !keys.has(dependency.key) || typeof dependency.required !== 'boolean') {
                throw new Error('The backup contains a missing item reference.');
            }
        }
    }
    const requireBlob = (reference, maxBytes) => {
        const payload = record(reference) && typeof reference.blob === 'string' &&
            /^blobs\/[a-f0-9]{64}\.bin$/.test(reference.blob) ? payloads.get(reference.blob) : null;
        if (!payload || payload.size !== reference.size || payload.size > maxBytes) {
            throw new Error('The backup contains invalid binary data.');
        }
        return payload;
    };
    const readBlob = async (reference, maxBytes, selectedSignal) => {
        requireBlob(reference, maxBytes);
        return readPayload(reference.blob, maxBytes, selectedSignal);
    };
    const binaryReferences = item => {
        if (!item.embedded) return [];
        if (item.kind === 'ir') {
            const result = item.data.originals.map(original =>
                ({ reference: original.bytes, maxBytes: IR_LIBRARY_MAX_ORIGINAL_BYTES }));
            for (const series of ['envelope', 'edc']) {
                if (item.data.analysis?.[series]) result.push({
                    reference: item.data.analysis[series], maxBytes: IR_LIBRARY_MAX_ANALYSIS_BYTES
                });
            }
            return result;
        }
        return item.kind === 'measurement' ? item.data.impulseResponses.map(response =>
            ({ reference: response.data, maxBytes: MAX_BACKUP_BYTES })) : [];
    };
    return { items, async hydrate(selected, selectedSignal) {
        let total = 0;
        for (const item of selected) {
            checkCancelled(selectedSignal);
            for (const { reference, maxBytes } of binaryReferences(item)) {
                total += requireBlob(reference, maxBytes).size;
                if (total > MAX_BACKUP_BYTES) {
                    throw new Error('The selected backup data exceeds 256 MB. Select fewer items to restore.');
                }
            }
        }
        const hydrated = [];
        for (const item of selected) {
            checkCancelled(selectedSignal);
            const result = clone(item);
            if (item.embedded && item.kind === 'ir') {
                for (const original of result.data.originals) original.bytes = await readBlob(original.bytes, IR_LIBRARY_MAX_ORIGINAL_BYTES, selectedSignal);
                if (result.data.analysis) {
                    for (const series of ['envelope', 'edc']) {
                        if (result.data.analysis[series]) result.data.analysis[series] = decodeFloat32(await readBlob(result.data.analysis[series], IR_LIBRARY_MAX_ANALYSIS_BYTES, selectedSignal));
                    }
                    requireBoundedIrBytes(encodeIrAnalysisSidecar(result.data.analysis),
                        IR_LIBRARY_MAX_ANALYSIS_BYTES, 'IR analysis');
                }
            } else if (item.embedded && item.kind === 'measurement') {
                for (const response of result.data.impulseResponses) response.data = decodeFloat32(await readBlob(response.data, MAX_BACKUP_BYTES, selectedSignal));
            }
            hydrated.push(result);
        }
        return hydrated;
    } };
}
