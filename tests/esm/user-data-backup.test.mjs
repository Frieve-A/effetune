import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { UserDataBackupService } from '../../js/user-data-backup/service.js';
import { prepareItems, chooseName, references, replaceReferences, encodeFloat32, decodeFloat32,
    MAX_BACKUP_BYTES, MAX_JSON_BYTES } from '../../js/user-data-backup/portable.js';
import { decodeSpeakerModel, encodeSpeakerModel, validateMeasurementBackup } from '../../features/measurement/dataStorage.js';
import { createSpeakerModel } from '../helpers/speaker-model-fixture.mjs';
import { inspectZip } from '../../js/user-data-backup/archive.js';
import { sha256IrBytes } from '../../js/ir-library/ir-library-id.js';
import { createUserDataBackupAdapter } from '../../js/user-data-backup/adapters.js';
import { PresetManager } from '../../js/ui/pipeline/preset-manager.js';
import { PluginPresetStore } from '../../js/ui/pipeline/plugin-preset-store.js';
import { IrLibraryStore } from '../../js/ir-library/ir-library-store.js';
import { IrLibraryService } from '../../js/ir-library/service.js';
import { ExtensionIrLibraryClient, ExtensionIrLibraryHost } from '../../extension/ir-library.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

const require = createRequire(import.meta.url);
const zipModule = { exports: {} };
runInThisContext(`(function(module, exports, require) {${readFileSync(new URL('../../js/vendor/jszip-3.10.2.min.js', import.meta.url), 'utf8')}\n})`)(zipModule, zipModule.exports, require);
const JSZip = zipModule.exports;
const loadZip = async () => JSZip;
const encoder = new TextEncoder();

function measurement(id = 'room', name = 'Room') {
    return { key: `measurement:${id}`, id, kind: 'measurement', name, data: {
        measurement: { id, name, timestamp: '2026-09-21T00:00:00Z', sampleRate: 48000,
            points: [{ pointId: 7, name: 'Seat', frequencyResponse: [[100, 0]], ir: { stored: true } }] },
        impulseResponses: [{ measurementId: id, pointId: 7, sampleRate: 48000, onsetIndex: 0,
            data: new Float32Array([0.2, -0.1, 0.5]) }]
    } };
}

function ir() {
    return { key: 'ir:impulse', id: 'impulse', kind: 'ir', name: 'Left.wav + Right.wav', data: {
        entry: { irId: 'impulse', composition: 'pair', originals: [
            { role: 'L', fileName: 'Left.wav' }, { role: 'R', fileName: 'Right.wav' }] },
        originals: [{ role: 'L', fileName: 'Left.wav', bytes: encoder.encode('left') },
            { role: 'R', fileName: 'Right.wav', bytes: encoder.encode('right') }],
        analysis: { onsetFrame: 1, envelope: new Float32Array([0.1, 1]), edc: new Float32Array([1, 0.1]) }
    } };
}

function pipeline(name = 'Listening') {
    return { key: `pipeline:${name}`, id: name, kind: 'pipeline', name, data: {
        plugins: [{ nm: 'IR Reverb', en: false, ir: 'impulse' },
            { nm: 'Room EQ', en: true, ms: 'room::ch=left', mn: 'Room', ms1: 'room', mn1: 'Room' },
            { nm: 'Crosstalk Cancellation', ll: 'room', lr: 'room', rl: 'room', rr: 'room' }] } };
}

function memoryAdapter(initial = []) {
    const items = structuredClone(initial);
    const writes = [];
    return { items, writes,
        async readSnapshot() { return { items: structuredClone(items), unavailable: [] }; },
        async appendItem(item, { name, data }) {
            writes.push(item.kind);
            if (this.failKind === item.kind) throw new Error('quota');
            const id = item.kind === 'measurement' ? data.measurement.id : item.kind === 'ir' ? item.id : name;
            items.push({ ...structuredClone(item), name, id, key: `${item.kind}:${id}`, data: structuredClone(data) });
            return { id, name };
        }
    };
}

const service = adapter => new UserDataBackupService({ adapter, appVersion: '2.11.0', loadZip });

async function makeBackup(items, keys, options) {
    const source = service(memoryAdapter(items));
    const list = await source.listBackup();
    return source.createBackup(list, keys || list.items.map(item => item.key), options);
}

test('mixed backup restores dependencies, preserves bytes and settings, and is idempotent', async () => {
    const plugin = { key: 'plugin:Volume:Quiet', id: 'Quiet', kind: 'plugin', name: 'Quiet', pluginName: 'Volume', data: { vl: -12 } };
    const backup = await makeBackup([pipeline(), ir(), measurement(), plugin]);
    const target = memoryAdapter();
    const restore = service(target);
    const opened = await restore.openBackup(backup.blob);
    assert.deepEqual(opened.items.map(item => item.kind), ['pipeline', 'plugin', 'ir', 'measurement']);
    let plan = await restore.planRestore(opened, opened.items.map(item => item.key));
    const result = await restore.restore(plan);
    assert.equal(result.added.length, 4);
    assert.deepEqual(target.writes, ['ir', 'measurement', 'pipeline', 'plugin']);
    const restoredMeasurement = target.items.find(item => item.kind === 'measurement');
    assert.equal(restoredMeasurement.id, 'room');
    assert.equal(restoredMeasurement.data.impulseResponses[0].measurementId, 'room');
    assert.deepEqual(restoredMeasurement.data.impulseResponses[0].data, measurement().data.impulseResponses[0].data);
    const restoredPreset = target.items.find(item => item.kind === 'pipeline');
    assert.equal(restoredPreset.data.plugins[1].ms, `${restoredMeasurement.id}::ch=left`);
    assert.equal(restoredPreset.data.plugins[0].en, false);
    assert.deepEqual(target.items.find(item => item.kind === 'ir').data.analysis.envelope, ir().data.analysis.envelope);
    plan = await restore.planRestore(opened, opened.items.map(item => item.key));
    assert.equal((await restore.restore(plan)).reused.length, 4);
    assert.equal(target.items.length, 4);
    const rebackup = await restore.createBackup(await restore.listBackup(), target.items.map(item => item.key));
    assert.equal((await service(memoryAdapter()).openBackup(rebackup.blob)).items.length, 4);
});

test('embedding switches are independent from selection and reference-only data must match content', async () => {
    const backup = await makeBackup([pipeline(), ir(), measurement()], ['pipeline:Listening'], { embedIr: false, embedMeasurements: false });
    assert.equal(backup.result.referenceOnly, 2);
    const zip = await JSZip.loadAsync(new Uint8Array(await backup.blob.arrayBuffer()));
    assert.equal(Object.keys(zip.files).filter(path => path.startsWith('blobs/')).length, 0);
    const empty = service(memoryAdapter());
    const missing = await empty.openBackup(backup.blob);
    assert.ok(missing.items.every(item => !item.available));
    const target = memoryAdapter([ir(), measurement()]);
    const restorer = service(target);
    const opened = await restorer.openBackup(backup.blob);
    const plan = await restorer.planRestore(opened, [opened.items.find(item => item.kind === 'pipeline').key]);
    const result = await restorer.restore(plan);
    assert.equal(result.added.length, 1);
    assert.equal(result.reused.length, 2);
    assert.deepEqual(target.writes, ['pipeline']);
});

test('restore preserves an available measurement ID and remaps only a conflicting ID', async () => {
    const backup = await makeBackup([pipeline(), ir(), measurement()]);
    const existing = measurement('room', 'Other seat');
    existing.data.impulseResponses[0].data[0] = 0.8;
    const target = memoryAdapter([existing]);
    const restore = service(target);
    const opened = await restore.openBackup(backup.blob);
    const keys = opened.items.map(item => item.key);
    assert.equal((await restore.restore(await restore.planRestore(opened, keys))).added.length, 3);
    const restored = target.items.find(item => item.kind === 'measurement' && item.id !== 'room');
    assert.ok(restored);
    assert.equal(restored.data.impulseResponses[0].measurementId, restored.id);
    assert.equal(target.items.find(item => item.kind === 'pipeline').data.plugins[1].ms,
        `${restored.id}::ch=left`);
    assert.deepEqual(target.items[0], existing);
    assert.equal((await restore.restore(await restore.planRestore(opened, keys))).reused.length, 3);
});

test('restoring an embedded measurement reconnects an existing Room EQ preset to its original ID', async () => {
    const source = measurement();
    const sameContent = measurement('other-id');
    const [original, duplicate] = await prepareItems([source, sameContent]);
    assert.equal(original.fingerprint, duplicate.fingerprint);

    const backup = await makeBackup([source]);
    const preset = pipeline();
    const target = memoryAdapter([preset, sameContent]);
    const restore = service(target);
    const opened = await restore.openBackup(backup.blob);
    const plan = await restore.planRestore(opened, [opened.items[0].key]);
    assert.equal((await restore.restore(plan)).added.length, 1);
    const recovered = target.items.find(item => item.key === source.key);
    assert.ok(recovered);
    assert.equal(recovered.data.impulseResponses[0].measurementId, 'room');
    assert.equal(target.items[0].data.plugins[1].ms, `${recovered.id}::ch=left`);
    assert.deepEqual(target.items[1], sameContent);
});

test('selection excludes unrelated data and shared dependency appears once', async () => {
    const other = { key: 'plugin:Volume:Other', id: 'Other', kind: 'plugin', pluginName: 'Volume', name: 'Other', data: { vl: 1 } };
    const backup = await makeBackup([pipeline(), pipeline('Second'), ir(), measurement(), other], ['pipeline:Listening', 'pipeline:Second']);
    const restore = service(memoryAdapter());
    const opened = await restore.openBackup(backup.blob);
    assert.equal(opened.items.length, 4);
    const selected = opened.items.find(item => item.name === 'Listening');
    const plan = await restore.planRestore(opened, [selected.key]);
    assert.equal(plan.selectedKeys.size, 3);
    assert.equal((await restore.restore(plan)).added.length, 3);
});

test('preset collision naming preserves alternate names and reuses a later numbered match', async () => {
    const preset = name => ({ key: `pipeline:${name}`, id: name, kind: 'pipeline', name, data: { plugins: [{ nm: 'Volume', vl: -2 }] } });
    const desired = (await prepareItems([preset('Night')]))[0];
    const candidates = await prepareItems([preset('Night (4)'), preset('Other'), { ...preset('Night'), data: { plugins: [{ nm: 'Volume', vl: -1 }] } }]);
    assert.equal(chooseName(desired, candidates).name, 'Night (4)');
    assert.equal(chooseName({ ...desired, name: 'Separate' }, candidates).existing, undefined);
    const backup = await makeBackup([preset('Night')]);
    const target = memoryAdapter([preset('Other'), { ...preset('Night'), data: { plugins: [{ nm: 'Volume', vl: -1 }] } }]);
    const restore = service(target);
    const opened = await restore.openBackup(backup.blob);
    const result = await restore.restore(await restore.planRestore(opened, [opened.items[0].key]));
    assert.equal(result.renamed[0].targetName, 'Night (2)');
    assert.equal(target.items.length, 3);
});

test('short and long presets fingerprint the same saved routing and parameters', async () => {
    const items = await prepareItems([
        { key: 'a', id: 'a', name: 'a', kind: 'pipeline', data: { plugins: [{ nm: 'Volume', en: false, ch: 'Left', ib: 2, ob: 3, vl: -8, id: 4 }] } },
        { key: 'b', id: 'b', name: 'b', kind: 'pipeline', data: { pipeline: [{ name: 'Volume', enabled: false, channel: 'L', inputBus: 2, outputBus: 3, parameters: { vl: -8 } }] } }
    ]);
    assert.equal(items[0].fingerprint, items[1].fingerprint);
});

test('legacy Room EQ arrays and optional calibration references are replaced without broad string rewriting', () => {
    const item = { kind: 'plugin', pluginName: 'Room EQ', data: { ms: ['room::ch=right'], mn: ['Original'], unrelated: 'room' } };
    const source = { key: 'm', kind: 'measurement', id: 'room' };
    assert.equal(references(item).length, 1);
    const data = replaceReferences(item, [source], new Map([['m', { id: 'new', name: 'New' }]]));
    assert.equal(data.ms[0], 'new::ch=right');
    assert.equal(data.mn[0], 'New');
    assert.equal(data.unrelated, 'room');
    const calibrated = measurement();
    calibrated.data.measurement.interfaceCalibration = { sourceMeasurementId: 'gone', sourceMeasurementName: 'Old' };
    assert.equal(references(calibrated)[0].required, false);
    assert.equal(replaceReferences(calibrated, [], new Map()).measurement.interfaceCalibration.sourceMeasurementId, 'unresolved:gone');
});

test('backup detects changes after listing and never creates an inconsistent archive', async () => {
    const adapter = memoryAdapter([measurement()]);
    const backup = service(adapter);
    const list = await backup.listBackup();
    adapter.items[0].data.impulseResponses[0].data[0] = 0.9;
    await assert.rejects(backup.createBackup(list, [list.items[0].key]), /changed/);
});

test('a failed item stops new writes and leaves previously restored dependencies intact', async () => {
    const backup = await makeBackup([pipeline(), ir(), measurement()]);
    const adapter = memoryAdapter();
    adapter.failKind = 'measurement';
    const restore = service(adapter);
    const opened = await restore.openBackup(backup.blob);
    const result = await restore.restore(await restore.planRestore(opened, [opened.items[0].key]));
    assert.equal(result.added.length, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(result.unprocessed.length, 1);
    assert.deepEqual(adapter.writes, ['ir', 'measurement']);
    adapter.failKind = null;
    const retry = await restore.restore(await restore.planRestore(opened, [opened.items[0].key]));
    assert.equal(retry.reused.length, 1);
    assert.equal(adapter.items.length, 3);
});

test('cancel is honored between saved items', async () => {
    const backup = await makeBackup([pipeline(), ir(), measurement()]);
    const adapter = memoryAdapter();
    const restore = service(adapter);
    const opened = await restore.openBackup(backup.blob);
    const controller = new AbortController();
    const result = await restore.restore(await restore.planRestore(opened, [opened.items[0].key]), {
        signal: controller.signal, onProgress() { controller.abort(); }
    });
    assert.equal(result.cancelled, true);
    assert.equal(result.added.length, 1);
    assert.equal(result.unprocessed.length, 2);
});

async function modifiedBackup(blob, modify) {
    const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
    await modify(zip);
    return new Blob([await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })]);
}

async function writeArchiveJson(zip, manifest, path, value) {
    const bytes = encoder.encode(JSON.stringify(value));
    zip.file(path, bytes, { createFolders: false });
    const payload = { path, size: bytes.byteLength, sha256: await sha256IrBytes(bytes) };
    const index = manifest.payloads.findIndex(candidate => candidate.path === path);
    if (index < 0) manifest.payloads.push(payload);
    else manifest.payloads[index] = payload;
}

test('legacy measurement backups verify their released fingerprints and restore Room EQ', async t => {
    for (const [appVersion, embedMeasurements, includeImpulse] of [
        ['2.18.1', false, true],
        ['2.19.0', true, true],
        ['2.19.0', false, true],
        ['unknown', true, false]
    ]) {
        await t.test(JSON.stringify({ appVersion, embedMeasurements, includeImpulse }), async () => {
            const saved = measurement();
            const hasSpeakerModel = appVersion !== '2.18.1';
            if (hasSpeakerModel) saved.data.measurement.speakerModel = { version: 1, coefficients: [1, 0.5] };
            if (!includeImpulse) saved.data.impulseResponses = [];
            const harmonics = embedMeasurements && includeImpulse;
            if (harmonics) {
                const response = saved.data.impulseResponses[0];
                response.harmonicAnalysis = {
                    version: 2, method: 'ess', reference: 'unit-input', calibration: 'uncorrected-system',
                    sampleRate: 48000, quality: { valid: true, reasons: [] },
                    excitation: { startFrequency: 20, endFrequency: 20000, durationSeconds: 1, levelDb: -12, sweepSamples: 48000 },
                    orders: [
                        { order: 1, data: response.data, referenceData: new Float32Array([0.25, 0, 0]), onsetIndex: 0,
                            validMinFrequency: 20, validMaxFrequency: 20000 },
                        { order: 2, data: new Float32Array([0, 1]), referenceData: new Float32Array([2, 3]),
                            harmonicReferenceData: new Float32Array([4, 5]), onsetIndex: 0,
                            validMinFrequency: 20, validMaxFrequency: 10000 }
                    ]
                };
            }
            const preset = pipeline();
            preset.data.plugins = [preset.data.plugins[1]];
            // These fingerprints come from the released prepareItems for the fixtures above.
            const [presetHash, measurementHash] = !hasSpeakerModel
                ? ['dad3fdde167f0750a1cbb65dc50770916c6f1af2e69a6dbac99a07fec2cba6e3',
                    '3d0be4ec4e5a04fb75ed5c237b36ce8ca33be5bef6e3c23da5946a81ad903ee8']
                : harmonics ? ['a7d42583f711da8800a7db7b93b36ab0e478f0f90035d9a2000e1f470bb37b2d',
                    'e74aeabd539eef1625d79f678010ead39df00583457eb08726067685827835f2']
                : includeImpulse ? ['0c12fd6d96e6bdb753da19a73b3b46b4803fd4991f8b33ae232630a3f1abae4a',
                    '025b53a1b90ca46d74a6bc646796239aae3cd7078a07c8bc67390a22514c7586']
                : ['e429ccd0ecd3c843c91dd93a803936e13af17719f596e51abee5117fa1ee5e58',
                    '08d46b789c7a3a9b4b0981ad58383d9dbdc0f7f58f0882d8f2c096d636edb8a1'];
            const zip = new JSZip();
            const manifest = { format: 'effetune-user-data-backup', schemaVersion: 1, appVersion, items: [], payloads: [] };
            const storeBlob = async bytes => {
                const sha256 = await sha256IrBytes(bytes);
                const blob = `blobs/${sha256}.bin`;
                zip.file(blob, bytes, { createFolders: false });
                manifest.payloads.push({ path: blob, size: bytes.byteLength, sha256 });
                return { blob, size: bytes.byteLength };
            };
            const data = structuredClone(saved.data);
            if (embedMeasurements) {
                if (hasSpeakerModel) {
                    data.measurement.speakerModel = await storeBlob(encoder.encode(JSON.stringify(data.measurement.speakerModel)));
                }
                for (const response of data.impulseResponses) response.data = await storeBlob(encodeFloat32(response.data));
            }
            const presetPath = 'presets/pipeline/item1.json';
            const measurementPath = 'measurements/item2.json';
            await writeArchiveJson(zip, manifest, presetPath, { id: preset.id, data: preset.data });
            await writeArchiveJson(zip, manifest, measurementPath, {
                id: saved.id, ...(embedMeasurements ? { data } : {})
            });
            manifest.items.push(
                { key: 'item1', kind: 'pipeline', name: preset.name, fingerprint: presetHash, embedded: true,
                    metadata: presetPath, dependencies: [{ key: 'item2', required: true }] },
                { key: 'item2', kind: 'measurement', name: saved.name, fingerprint: measurementHash,
                    embedded: embedMeasurements, metadata: measurementPath, dependencies: [] }
            );
            zip.file('manifest.json', encoder.encode(JSON.stringify(manifest)), { createFolders: false });
            const blob = new Blob([await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })]);
            const adapter = memoryAdapter(embedMeasurements ? [] : [saved]);
            if (harmonics) {
                adapter.validateItem = item => {
                    if (item.kind === 'measurement' && item.data) {
                        validateMeasurementBackup(item.data.measurement, item.data.impulseResponses);
                    }
                };
            }
            const restore = service(adapter);
            if (embedMeasurements && includeImpulse) {
                const tampered = await modifiedBackup(blob, zip => {
                    manifest.items[1].fingerprint = '0'.repeat(64);
                    zip.file('manifest.json', encoder.encode(JSON.stringify(manifest)), { createFolders: false });
                });
                const rejected = await restore.openBackup(tampered);
                await assert.rejects(restore.restore(await restore.planRestore(rejected, ['item1'])), /does not match/);
                assert.deepEqual(adapter.writes, []);
            }
            const opened = await restore.openBackup(blob);
            const restoreSelection = async () => restore.restore(await restore.planRestore(opened, ['item1']));
            const expectedWrites = embedMeasurements ? ['measurement', 'pipeline'] : ['pipeline'];
            assert.equal((await restoreSelection()).added.length, expectedWrites.length);
            assert.deepEqual(adapter.writes, expectedWrites);
            assert.deepEqual(adapter.items.find(item => item.kind === 'measurement').data, saved.data);
            assert.equal(adapter.items.find(item => item.kind === 'pipeline').data.plugins[0].ms, 'room::ch=left');
            assert.equal((await restoreSelection()).reused.length, 2);
        });
    }
});

async function repeatedBinaryReferenceBackup(kind) {
    const source = kind === 'ir' ? ir() : measurement();
    if (kind === 'ir') source.data.originals[0].bytes = new Uint8Array(1024 * 1024);
    else source.data.impulseResponses[0].data = new Float32Array(256 * 1024);
    const backup = await makeBackup([source]);
    return modifiedBackup(backup.blob, async zip => {
        const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
        const entry = manifest.items[0];
        const metadata = JSON.parse(await zip.file(entry.metadata).async('string'));
        const reference = kind === 'ir' ? metadata.data.originals[0].bytes : metadata.data.impulseResponses[0].data;
        const referenceCount = Math.floor(MAX_BACKUP_BYTES / reference.size) + 1;
        if (kind === 'measurement') {
            const response = metadata.data.impulseResponses[0];
            metadata.data.impulseResponses = Array.from({ length: referenceCount }, (_, pointId) =>
                ({ ...response, pointId, data: { ...reference } }));
            await writeArchiveJson(zip, manifest, entry.metadata, metadata);
        } else {
            manifest.items = [];
            manifest.payloads = manifest.payloads.filter(payload => payload.path.startsWith('blobs/'));
            for (let index = 0; index < referenceCount; index++) {
                const key = `item${index + 1}`;
                const path = `ir/${key}.json`;
                const itemMetadata = structuredClone(metadata);
                itemMetadata.id = `impulse-${index}`;
                itemMetadata.data.entry.irId = itemMetadata.id;
                await writeArchiveJson(zip, manifest, path, itemMetadata);
                manifest.items.push({ ...entry, key, name: `Impulse ${index + 1}`, metadata: path });
            }
        }
        zip.file('manifest.json', JSON.stringify(manifest), { createFolders: false });
    });
}

function blobCountingZipLoader(counter) {
    return async () => ({
        async loadAsync(...args) {
            const zip = await JSZip.loadAsync(...args);
            const file = zip.file.bind(zip);
            zip.file = path => {
                const entry = file(path);
                if (!entry || !path.startsWith('blobs/')) return entry;
                const internalStream = entry.internalStream.bind(entry);
                entry.internalStream = type => {
                    counter.reads++;
                    return internalStream(type);
                };
                return entry;
            };
            return zip;
        }
    });
}

test('unknown versions, unsafe paths and corrupted selected payloads are rejected before writes', async () => {
    const backup = await makeBackup([ir()]);
    const adapter = memoryAdapter();
    const restore = service(adapter);
    const unknown = await modifiedBackup(backup.blob, async zip => {
        const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
        manifest.schemaVersion = 2;
        zip.file('manifest.json', JSON.stringify(manifest));
    });
    await assert.rejects(restore.openBackup(unknown), /Update/);
    const unsafe = await modifiedBackup(backup.blob, zip => zip.file('../outside', 'bad', { createFolders: false }));
    await assert.rejects(restore.openBackup(unsafe), /unsafe/);
    const corrupt = await modifiedBackup(backup.blob, zip => {
        const path = Object.keys(zip.files).find(path => path.startsWith('blobs/'));
        zip.file(path, 'xxxx', { createFolders: false });
    });
    const opened = await restore.openBackup(corrupt);
    await assert.rejects(restore.restore(await restore.planRestore(opened, [opened.items[0].key])), /damaged/);
    assert.equal(adapter.writes.length, 0);
});

test('reserved external names remain disabled while normal names can restore', async () => {
    const preset = name => ({ key: name, id: name, kind: 'pipeline', name, data: { plugins: [] } });
    const values = await prepareItems(['__proto__', 'constructor', 'prototype', 'Safe'].map(preset));
    assert.deepEqual(values.map(item => item.available), [false, false, false, true]);
    assert.equal({}.polluted, undefined);
});

test('Float32 payload is explicitly little endian and ZIP size is bounded', () => {
    const bytes = encodeFloat32(new Float32Array([1, -2]));
    assert.deepEqual(Array.from(bytes), [0, 0, 128, 63, 0, 0, 0, 192]);
    assert.deepEqual(decodeFloat32(bytes), new Float32Array([1, -2]));
    assert.throws(() => inspectZip(new Uint8Array(10)), /valid/);
    assert.equal(MAX_BACKUP_BYTES, 256 * 1024 * 1024);
});

test('selected IR and measurement references are size-checked before shared blobs are read or written', async () => {
    for (const kind of ['ir', 'measurement']) {
        const backup = await repeatedBinaryReferenceBackup(kind);
        assert.ok(backup.size < 2 * 1024 * 1024, kind);
        const reads = { reads: 0 };
        const adapter = memoryAdapter();
        const restore = new UserDataBackupService({
            adapter, appVersion: '2.11.0', loadZip: blobCountingZipLoader(reads)
        });
        const opened = await restore.openBackup(backup);
        if (kind === 'ir') {
            assert.equal((await opened.archive.hydrate([opened.items[0]])).length, 1);
            assert.ok(reads.reads > 0);
            reads.reads = 0;
        }
        const plan = await restore.planRestore(opened, opened.items.map(item => item.key));
        await assert.rejects(restore.restore(plan), /exceeds 256 MB/);
        assert.equal(reads.reads, 0, kind);
        assert.equal(adapter.writes.length, 0, kind);
    }
});

test('sidecar storage limits are checked before any selected item or original is written', async () => {
    for (const series of ['envelope', 'edc']) {
        const impulse = ir();
        impulse.data.analysis[series] = new Float32Array(262145);
        const independentPreset = { key: 'pipeline:First', id: 'First', name: 'First', kind: 'pipeline', data: { plugins: [] } };
        const backup = await makeBackup([independentPreset, impulse]);
        const files = new Map();
        const store = await new IrLibraryStore({
            read: async name => files.get(name)?.slice() || null,
            exists: async name => files.has(name), writeAtomic: async (name, bytes) => files.set(name, bytes.slice()),
            remove: async name => files.delete(name), list: async () => [...files.keys()], cleanupTemporary: async () => {}
        }).open();
        const adapter = memoryAdapter();
        const append = adapter.appendItem.bind(adapter);
        adapter.appendItem = async (item, options) => {
            if (item.kind === 'ir') await store.appendBackupItem(options.data, options.name);
            return append(item, options);
        };
        const restore = service(adapter);
        const opened = await restore.openBackup(backup.blob);
        const plan = await restore.planRestore(opened, opened.items.map(item => item.key));
        await assert.rejects(restore.restore(plan), /too large/);
        assert.equal(adapter.writes.length, 0, series);
        assert.equal(files.size, 0, series);
    }
});

test('calibration sources can be deselected without losing provenance or repeat-restore identity', async () => {
    const calibrated = measurement('calibrated', 'Calibrated');
    calibrated.data.measurement.interfaceCalibration = {
        sourceMeasurementId: 'room', sourceMeasurementName: 'Room', sourcePointId: 7,
        sourcePointName: 'Seat', sourceTimestamp: '2026-09-21T00:00:00Z', sampleRate: 48000
    };
    const backup = await makeBackup([measurement(), calibrated], ['measurement:calibrated']);
    const target = memoryAdapter();
    const restore = service(target);
    const opened = await restore.openBackup(backup.blob);
    assert.equal(opened.items.length, 1);
    const plan = await restore.planRestore(opened, [opened.items[0].key]);
    assert.equal((await restore.restore(plan)).added.length, 1);
    assert.match(target.items[0].data.measurement.interfaceCalibration.sourceMeasurementId, /^unresolved:[a-f0-9]{64}$/);
    assert.equal(target.items[0].data.measurement.interfaceCalibration.sourceMeasurementName, 'Room');
    assert.equal((await restore.restore(await restore.planRestore(opened, [opened.items[0].key]))).reused.length, 1);
});

test('multi-point multi-channel measurements travel as one complete unit', async () => {
    const item = measurement();
    item.data.measurement.outputChannels = ['left', 'right'];
    item.data.measurement.points = [3, 5].map((pointId, pointIndex) => ({ pointId,
        channels: ['left', 'right'].map((channel, channelIndex) => ({ channel,
            irId: pointIndex * 2 + channelIndex, ir: { stored: true }, frequencyResponse: [[100, channelIndex]] })) }));
    item.data.impulseResponses = [0, 1, 2, 3].map(pointId => ({ measurementId: 'room', pointId,
        channel: pointId % 2 ? 'right' : 'left', sampleRate: 96000, onsetIndex: 1,
        trimStartSamples: 19, data: new Float32Array([0, 1, pointId]) }));
    const backup = await makeBackup([item]);
    const adapter = memoryAdapter();
    const restore = service(adapter);
    const opened = await restore.openBackup(backup.blob);
    assert.equal(opened.items.length, 1);
    await restore.restore(await restore.planRestore(opened, [opened.items[0].key]));
    assert.deepEqual(adapter.items[0].data.measurement.points, item.data.measurement.points);
    assert.deepEqual(adapter.items[0].data.impulseResponses.map(({ measurementId, ...value }) => value),
        item.data.impulseResponses.map(({ measurementId, ...value }) => value));
});

test('measurement samples use binary payloads and count their stored size', async () => {
    const item = measurement();
    const response = item.data.impulseResponses[0];
    response.harmonicAnalysis = { orders: [
        { data: response.data, referenceData: new Float32Array([0.25, 0, -0]) },
        { data: new Float32Array([0, 1]), referenceData: new Float32Array([2, 3]),
            harmonicReferenceData: new Float32Array([4, 5]) }
    ] };
    item.data.measurement.extraSamples = new Float32Array([0, 0.5, 1]).subarray(1);
    const source = service(memoryAdapter([item]));
    const list = await source.listBackup();
    const { blob } = await source.createBackup(list, [item.key]);
    const entries = inspectZip(new Uint8Array(await blob.arrayBuffer()));
    const payloadBytes = [...entries].reduce((total, [path, entry]) =>
        total + (path === 'manifest.json' ? 0 : entry.size), 0);
    assert.equal(list.items[0].bytes, payloadBytes);
    assert.equal([...entries.keys()].filter(path => path.startsWith('blobs/')).length, 6);

    const adapter = memoryAdapter();
    const restore = service(adapter);
    const opened = await restore.openBackup(blob);
    assert.equal(opened.items[0].bytes, payloadBytes);
    const plan = await restore.planRestore(opened, [opened.items[0].key]);
    assert.equal((await restore.restore(plan)).added.length, 1);
    const saved = adapter.items[0].data;
    assert.deepEqual(saved.measurement.extraSamples, item.data.measurement.extraSamples);
    assert.deepEqual(saved.impulseResponses[0].data, response.data);
    assert.deepEqual(saved.impulseResponses[0].harmonicAnalysis, response.harmonicAnalysis);
});

test('oversized measurement metadata is rejected before ZIP creation', async () => {
    const item = measurement();
    item.data.measurement.notes = 'x'.repeat(MAX_JSON_BYTES);
    const source = new UserDataBackupService({
        adapter: memoryAdapter([item]), loadZip: () => assert.fail('ZIP creation began')
    });
    const list = await source.listBackup();
    await assert.rejects(source.createBackup(list, [item.key]), /item is too large/);
});

test('a speaker model larger than one item description travels as its own payload, bit-exact', async () => {
    const model = createSpeakerModel(3);
    const item = measurement();
    item.data.measurement.speakerModel = encodeSpeakerModel(model);
    assert.ok(JSON.stringify(item.data.measurement.speakerModel).length > MAX_JSON_BYTES);
    const backup = await makeBackup([item]);
    const adapter = memoryAdapter();
    const restore = service(adapter);
    const opened = await restore.openBackup(backup.blob);
    const plan = () => restore.planRestore(opened, [opened.items[0].key]);
    assert.equal((await restore.restore(await plan())).added.length, 1);
    const restored = decodeSpeakerModel(adapter.items[0].data.measurement.speakerModel);
    assert.deepEqual(restored, model);
    assert.ok(restored.channels[0].diagnosis.nx instanceof Uint16Array);
    assert.equal((await restore.restore(await plan())).reused.length, 1);
});

test('duplicate paths and expansion beyond a ZIP declaration are rejected with bounded payload reads', async () => {
    const zip = new JSZip();
    zip.file('aa.txt', 'a');
    zip.file('bb.txt', 'b');
    const duplicate = await zip.generateAsync({ type: 'uint8array' });
    const needle = encoder.encode('bb.txt');
    for (let offset = 0; offset < duplicate.length - needle.length; offset++) {
        if (needle.every((value, index) => duplicate[offset + index] === value)) duplicate.set(encoder.encode('aa.txt'), offset);
    }
    assert.throws(() => inspectZip(duplicate), /duplicate/);
    const bomb = new JSZip();
    bomb.file('manifest.json', ' '.repeat(128 * 1024));
    const bytes = await bomb.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(22, 1, true);
    const central = view.getUint32(bytes.length - 6, true);
    view.setUint32(central + 24, 1, true);
    await assert.rejects(service(memoryAdapter()).openBackup(new Blob([bytes])), /declared size/);
    await assert.rejects(service(memoryAdapter()).openBackup({ size: MAX_BACKUP_BYTES + 1 }), /256 MB/);
});

test('the shared archive travels through Web, Electron and extension storage adapters', async () => {
    let values = new Map();
    const desktopFiles = new Map();
    await withGlobals({ window: {}, document: { getElementById: () => null }, localStorage: {
        getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)
    } }, async () => {
        const buildAdapter = async extension => {
            const files = new Map();
            const store = await new IrLibraryStore({
                read: async name => files.get(name)?.slice() || null,
                exists: async name => files.has(name), writeAtomic: async (name, bytes) => files.set(name, bytes.slice()),
                remove: async name => files.delete(name), list: async () => [...files.keys()], cleanupTemporary: async () => {}
            }).open();
            const measurements = new Map();
            const storage = { readBackupSnapshot: async () => structuredClone([...measurements.values()]),
                appendBackupMeasurement: async (measurement, impulseResponses) => {
                    measurements.set(measurement.id, structuredClone({ measurement, impulseResponses }));
                    return {};
                } };
            const presets = {};
            const host = new ExtensionIrLibraryHost(new IrLibraryService(store), {});
            const client = { request: async (command, args) => {
                if (command === 'irLibrary') return host.request(structuredClone(args), 'backup');
                if (command === 'readBackupPresets') return structuredClone(presets);
                assert.equal(command, 'appendBackupPreset');
                Object.defineProperty(presets, args.name, { value: structuredClone(args.preset), enumerable: true });
            } };
            return createUserDataBackupAdapter({ presetManager: new PresetManager({ audioManager: {} }),
                pluginPresetStore: new PluginPresetStore(), measurementStorage: storage,
                irLibrary: extension ? new ExtensionIrLibraryClient(client) : new IrLibraryService(store),
                ...(extension ? { extensionClient: client } : {}) });
        };
        const sourceAdapter = await buildAdapter(false);
        const sourceIr = ir();
        const savedIr = await sourceAdapter.appendItem(sourceIr);
        const sourcePreset = pipeline();
        sourcePreset.data.plugins[0].ir = savedIr.id;
        await sourceAdapter.appendItem(measurement());
        await sourceAdapter.appendItem(sourcePreset);
        let producer = service(sourceAdapter);
        let listed = await producer.listBackup();
        assert.equal(listed.unavailable.length, 0);
        let backup = await producer.createBackup(listed, listed.items.map(item => item.key));
        for (const environment of ['electron', 'extension', 'web']) {
            values = new Map();
            window.electronIntegration = { isElectron: environment === 'electron' };
            window.electronAPI = environment === 'electron' ? {
                getPath: async () => 'userData', joinPaths: async (...parts) => parts.join('/'),
                fileExists: async path => desktopFiles.has(path),
                readFile: async path => ({ success: true, content: desktopFiles.get(path) }),
                saveFile: async (path, content) => { desktopFiles.set(path, content); return { success: true }; }
            } : undefined;
            const adapter = await buildAdapter(environment === 'extension');
            const consumer = service(adapter);
            const opened = await consumer.openBackup(backup.blob);
            const restored = await consumer.restore(await consumer.planRestore(opened, opened.items.map(item => item.key)));
            assert.equal(restored.added.length, 3, environment);
            listed = await consumer.listBackup();
            assert.equal(listed.items.length, 3, environment);
            assert.ok(listed.items.every(item => item.available), environment);
            producer = consumer;
            backup = await producer.createBackup(listed, listed.items.map(item => item.key));
        }
    });
});
