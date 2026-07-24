import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DataStorage,
    MeasurementImportError,
    MeasurementLoadError
} from '../../features/measurement/dataStorage.js';

function clone(value) {
    return structuredClone(value);
}

class AtomicDatabase {
    constructor() {
        this.measurements = new Map();
        this.impulseResponses = new Map();
        this.failNextTransaction = false;
        this.failNextIrTransaction = false;
        this.failNextError = null;
    }

    transaction(storeNames) {
        const names = new Set(Array.isArray(storeNames) ? storeNames : [storeNames]);
        const operations = [];
        const transaction = {
            objectStore: name => {
                if (!names.has(name)) throw new Error(`Store is outside transaction: ${name}`);
                return {
                    put: value => operations.push({ type: 'put', store: name, value: clone(value) }),
                    delete: key => operations.push({ type: 'delete', store: name, key: clone(key) })
                };
            }
        };
        queueMicrotask(() => {
            const fail = this.failNextTransaction ||
                (this.failNextIrTransaction && operations.some(operation =>
                    operation.store === 'impulseResponses'));
            this.failNextTransaction = false;
            if (this.failNextIrTransaction && operations.some(operation =>
                operation.store === 'impulseResponses')) this.failNextIrTransaction = false;
            if (fail) {
                const error = this.failNextError || new Error('Simulated IndexedDB transaction failure');
                this.failNextError = null;
                transaction.onerror?.({ target: { error } });
                transaction.onabort?.({ target: { error } });
                return;
            }
            const measurements = new Map(this.measurements);
            const impulseResponses = new Map(this.impulseResponses);
            for (const operation of operations) {
                const records = operation.store === 'measurements' ? measurements : impulseResponses;
                if (operation.type === 'put') {
                    const key = operation.store === 'measurements'
                        ? operation.value.id
                        : JSON.stringify([operation.value.measurementId, operation.value.pointId]);
                    records.set(key, clone(operation.value));
                } else {
                    const key = operation.store === 'measurements'
                        ? operation.key
                        : JSON.stringify(operation.key);
                    if (operation.store === 'impulseResponses' && operation.key?.lower) {
                        for (const recordKey of records.keys()) {
                            if (JSON.parse(recordKey)[0] === operation.key.lower[0]) {
                                records.delete(recordKey);
                            }
                        }
                    } else {
                        records.delete(key);
                    }
                }
            }
            this.measurements = measurements;
            this.impulseResponses = impulseResponses;
            transaction.oncomplete?.();
        });
        return transaction;
    }
}

function createStorage(database = new AtomicDatabase()) {
    const storage = new DataStorage();
    storage.openDatabase = async () => database;
    storage.dispatchEvent = () => {};
    storage.requestPersistentStorage = async () => {};
    storage.getStorageEstimate = async () => null;
    return { storage, database };
}

function impulseRecord(measurementId, pointId, value = 1) {
    return {
        measurementId,
        pointId,
        sampleRate: 48000,
        onsetIndex: 1,
        refScale: 1,
        data: Float32Array.from([0, value, 0])
    };
}

test('measurement parent, IR additions, and point deletions commit atomically', async () => {
    const { storage, database } = createStorage();
    database.impulseResponses.set(JSON.stringify(['measurement-1', 1]),
        impulseRecord('measurement-1', 1));
    const measurement = {
        id: 'measurement-1',
        points: [{ pointId: 2, ir: { stored: true } }],
        _deletedPointIds: [1],
        _originalPoints: [{ pointId: 1 }]
    };
    assert.equal(await storage.putMeasurement(
        measurement,
        [impulseRecord('measurement-1', 2, 0.5)]
    ), true);
    const stored = database.measurements.get('measurement-1');
    assert.equal(stored._deletedPointIds, undefined);
    assert.equal(stored._originalPoints, undefined);
    assert.equal(database.impulseResponses.has(JSON.stringify(['measurement-1', 1])), false);
    assert.equal(database.impulseResponses.get(JSON.stringify(['measurement-1', 2])).data[1], 0.5);
});

test('IR transaction failure leaves candidate metadata and storage unchanged', async () => {
    const { storage, database } = createStorage();
    database.failNextIrTransaction = true;
    const measurement = {
        id: 'measurement-2',
        points: [{ pointId: 1, ir: { stored: true, length: 3 } }]
    };
    assert.equal(await storage.putMeasurement(
        measurement,
        [impulseRecord('measurement-2', 1)]
    ), false);
    assert.equal(storage.irPersistenceAvailable, true);
    assert.equal(measurement.points[0].ir.stored, true);
    assert.equal(database.measurements.has('measurement-2'), false);
    assert.equal(database.impulseResponses.size, 0);
});

test('quota refusal leaves parent and IR storage unchanged', async () => {
    const { storage, database } = createStorage();
    storage.getStorageEstimate = async () => ({ usage: 80, quota: 100 });
    const measurement = {
        id: 'measurement-3',
        points: [{ pointId: 1, ir: { stored: true } }]
    };
    assert.equal(await storage.putMeasurement(
        measurement,
        [impulseRecord('measurement-3', 1)]
    ), false);
    assert.equal(database.measurements.size, 0);
    assert.equal(database.impulseResponses.size, 0);
    assert.equal(measurement.points[0].ir.stored, true);
});

test('standalone point deletion restores memory when its transaction fails', async () => {
    const { storage, database } = createStorage();
    const measurement = {
        id: 'measurement-4',
        points: [{ pointId: 1 }, { pointId: 2 }]
    };
    storage.measurements = [measurement];
    database.measurements.set(measurement.id, clone(measurement));
    database.impulseResponses.set(JSON.stringify([measurement.id, 1]),
        impulseRecord(measurement.id, 1));
    database.failNextTransaction = true;
    assert.equal(await storage.deletePoint(measurement.id, 1), false);
    assert.deepEqual(measurement.points.map(point => point.pointId), [1, 2]);
    assert.deepEqual(database.measurements.get(measurement.id).points.map(point => point.pointId), [1, 2]);
    assert.equal(database.impulseResponses.has(JSON.stringify([measurement.id, 1])), true);
});

test('addMeasurement rolls its in-memory insertion back when persistence is refused', async () => {
    const { storage } = createStorage();
    storage.putMeasurement = async () => false;
    await assert.rejects(
        storage.addMeasurement({ id: 'measurement-5', name: 'Unsaved', points: [] }),
        /could not be saved/
    );
    assert.equal(storage.getMeasurementById('measurement-5'), null);
});

test('additional-point IDB failure keeps the previously committed measurement current', async () => {
    const { storage, database } = createStorage();
    const committed = {
        id: 'measurement-existing',
        name: 'Existing',
        points: [{ pointId: 0, frequencyResponse: [[100, 1]] }]
    };
    storage.measurements = [committed];
    database.measurements.set(committed.id, clone(committed));
    database.failNextIrTransaction = true;

    await assert.rejects(storage.addMeasurement({
        ...committed,
        points: [...committed.points, { pointId: 1, frequencyResponse: [[100, 3]] }]
    }, [impulseRecord(committed.id, 1)]), /could not be saved/);

    assert.strictEqual(storage.getMeasurementById(committed.id), committed);
    assert.deepEqual(storage.getMeasurementById(committed.id).points, committed.points);
    assert.deepEqual(database.measurements.get(committed.id), committed);
    assert.equal(database.impulseResponses.size, 0);
});

function exportableMeasurement() {
    return {
        id: 'measurement-source',
        name: 'Source',
        timestamp: '2026-07-21T00:00:00.000Z',
        points: [{
            pointId: 0,
            frequencyResponse: [[100, 1]],
            ir: { stored: true, length: 3, sampleRate: 48000, onsetIndex: 1 }
        }],
        nextPointId: 1,
        averageFrequencyResponse: [[100, 1]]
    };
}

test('IR-OFF export imports as metadata-only with no IR badge or binary availability', async () => {
    const { storage: source } = createStorage();
    source.measurements = [exportableMeasurement()];
    const json = await source.exportMeasurementToJSON('measurement-source', false);

    const { storage: target, database } = createStorage();
    target.generateId = () => 'measurement-imported-off';
    assert.equal(await target.importMeasurementFromJSON(json), 'measurement-imported-off');

    const imported = target.getMeasurementById('measurement-imported-off');
    assert.equal(imported.points[0].ir, undefined);
    assert.equal(imported.points.every(point => point.ir?.stored), false);
    assert.equal(database.impulseResponses.size, 0);
});

test('IR-ON export imports synchronized metadata and binary availability', async () => {
    const { storage: source } = createStorage();
    source.measurements = [exportableMeasurement()];
    source.getImpulseResponses = async () => [impulseRecord('measurement-source', 0, 0.75)];
    const json = await source.exportMeasurementToJSON('measurement-source', true);

    const { storage: target, database } = createStorage();
    target.generateId = () => 'measurement-imported-on';
    assert.equal(await target.importMeasurementFromJSON(json), 'measurement-imported-on');

    const imported = target.getMeasurementById('measurement-imported-on');
    assert.equal(imported.points[0].ir.stored, true);
    assert.equal(imported.points[0].ir.length, 3);
    assert.equal(imported.points.every(point => point.ir?.stored), true);
    const binary = database.impulseResponses.get(
        JSON.stringify(['measurement-imported-on', 0])
    );
    assert.ok(binary);
    assert.equal(binary.data[1], 0.75);
});

test('invalid embedded IR is ignored and cannot retain exported availability metadata', async () => {
    const { storage, database } = createStorage();
    storage.generateId = () => 'measurement-imported-invalid-ir';
    const exported = exportableMeasurement();
    exported.impulseResponses = [{
        measurementId: exported.id,
        pointId: 0,
        sampleRate: 48000,
        onsetIndex: 1,
        data: 'not-base64!'
    }];

    assert.equal(
        await storage.importMeasurementFromJSON(JSON.stringify(exported)),
        'measurement-imported-invalid-ir'
    );
    assert.equal(storage.getMeasurementById('measurement-imported-invalid-ir').points[0].ir, undefined);
    assert.equal(database.impulseResponses.size, 0);
});

test('bad JSON and bad measurement schema return validation failure without mutation', async () => {
    const { storage } = createStorage();
    assert.equal(await storage.importMeasurementFromJSON('{bad'), null);
    assert.equal(await storage.importMeasurementFromJSON(JSON.stringify({ name: 'Missing points' })), null);
    assert.equal(await storage.importMeasurementFromJSON(JSON.stringify({
        name: 'Invalid device',
        audioInput: { html: '<img src=x onerror=alert(1)>' },
        points: [{ frequencyResponse: [[100, 0]] }]
    })), null);
    assert.equal(await storage.importMeasurementFromJSON(JSON.stringify({
        name: 'Invalid response',
        points: [{ frequencyResponse: [[100, '<script>']] }]
    })), null);
    for (const invalid of [
        { points: [{ frequencyResponse: [[0, 1]] }] },
        { points: [{ frequencyResponse: [[-100, 1]] }] },
        {
            points: [{ frequencyResponse: [[100, 1]] }],
            averageFrequencyResponse: [[0, 1]]
        },
        {
            points: [{ frequencyResponse: [[100, 1]] }],
            correctedResponse: [[-100, 1]]
        }
    ]) {
        assert.equal(await storage.importMeasurementFromJSON(JSON.stringify({
            name: 'Invalid frequency',
            ...invalid
        })), null);
    }
    assert.deepEqual(storage.measurements, []);
});

test('import accepts positive non-aligned frequency grids', async () => {
    const { storage } = createStorage();
    storage.generateId = () => 'measurement-positive-grid';
    const measurement = {
        name: 'Positive grid',
        points: [{ frequencyResponse: [[123.5, 1], [41.25, -2]] }],
        averageFrequencyResponse: [[41.25, -2], [123.5, 1]],
        correctedResponse: [[63.75, 0.5]]
    };

    assert.equal(await storage.importMeasurementFromJSON(JSON.stringify(measurement)),
        'measurement-positive-grid');
    assert.deepEqual(storage.getMeasurementById('measurement-positive-grid').points[0]
        .frequencyResponse, measurement.points[0].frequencyResponse);
});

test('definite IndexedDB unavailability falls back to metadata-only localStorage', async t => {
    const originalLocalStorage = globalThis.localStorage;
    const values = new Map();
    globalThis.localStorage = {
        setItem: (key, value) => values.set(key, value),
        getItem: key => values.get(key) ?? null
    };
    t.after(() => {
        globalThis.localStorage = originalLocalStorage;
    });

    const storage = new DataStorage();
    storage.indexedDbUnavailable = true;
    storage.openDatabase = async () => {
        throw new Error('IndexedDB is unavailable');
    };
    storage.dispatchEvent = () => {};
    const candidate = {
        id: 'measurement-fallback',
        name: 'Fallback',
        points: [{
            pointId: 0,
            frequencyResponse: [[100, 1]],
            ir: { stored: true, length: 3, sampleRate: 48000, onsetIndex: 1 }
        }]
    };

    assert.equal(await storage.addMeasurement(
        candidate,
        [impulseRecord(candidate.id, 0)]
    ), candidate.id);
    assert.equal(candidate.points[0].ir, undefined);
    assert.equal(storage.getMeasurementById(candidate.id).points[0].ir, undefined);
    assert.equal(storage.irPersistenceAvailable, false);
    const persisted = JSON.parse(values.get(storage.STORAGE_KEY));
    assert.equal(persisted[0].points[0].ir, undefined);
    assert.equal(JSON.stringify(persisted).includes('impulseResponses'), false);
});

test('transient IndexedDB failures do not silently fall back to localStorage', async t => {
    const originalLocalStorage = globalThis.localStorage;
    let writes = 0;
    globalThis.localStorage = { setItem: () => { writes += 1; } };
    t.after(() => {
        globalThis.localStorage = originalLocalStorage;
    });
    const { storage, database } = createStorage();
    database.failNextTransaction = true;

    await assert.rejects(
        storage.addMeasurement({ id: 'measurement-transient', name: 'Retry', points: [] }),
        /could not be saved/
    );
    assert.equal(writes, 0);
    assert.equal(storage.irPersistenceAvailable, true);
    assert.deepEqual(storage.measurements, []);
});

test('asynchronous IndexedDB open errors distinguish unavailable from transient failures', async t => {
    const originalIndexedDb = globalThis.indexedDB;
    t.after(() => {
        globalThis.indexedDB = originalIndexedDb;
    });

    for (const [name, unavailable] of [['SecurityError', true], ['UnknownError', false]]) {
        globalThis.indexedDB = {
            open: () => {
                const request = {};
                queueMicrotask(() => {
                    const error = new Error(name);
                    error.name = name;
                    request.onerror?.({ target: { error } });
                });
                return request;
            }
        };
        const storage = new DataStorage();
        await assert.rejects(storage.openDatabase(), error => error.name === name);
        assert.equal(storage.indexedDbUnavailable, unavailable);
    }
});

test('measurement deletion commits through IndexedDB and removes its IR records', async t => {
    const originalKeyRange = globalThis.IDBKeyRange;
    globalThis.IDBKeyRange = { bound: (lower, upper) => ({ lower, upper }) };
    t.after(() => {
        globalThis.IDBKeyRange = originalKeyRange;
    });
    const { storage, database } = createStorage();
    const measurement = { id: 'measurement-delete-idb', name: 'Delete', points: [] };
    storage.measurements = [measurement];
    database.measurements.set(measurement.id, clone(measurement));
    database.impulseResponses.set(JSON.stringify([measurement.id, 0]),
        impulseRecord(measurement.id, 0));

    assert.equal(await storage.deleteMeasurement(measurement.id), true);
    assert.equal(storage.getMeasurementById(measurement.id), null);
    assert.equal(database.measurements.has(measurement.id), false);
    assert.equal(database.impulseResponses.size, 0);
});

test('measurement deletion falls back to metadata-only localStorage when IndexedDB is unavailable', async t => {
    const originalLocalStorage = globalThis.localStorage;
    const values = new Map();
    globalThis.localStorage = { setItem: (key, value) => values.set(key, value) };
    t.after(() => {
        globalThis.localStorage = originalLocalStorage;
    });
    const storage = new DataStorage();
    storage.indexedDbUnavailable = true;
    storage.openDatabase = async () => { throw new Error('unavailable'); };
    storage.dispatchEvent = () => {};
    storage.measurements = [
        { id: 'measurement-delete-fallback', points: [] },
        {
            id: 'measurement-keep-fallback',
            points: [{ pointId: 0, frequencyResponse: [[100, 1]], ir: { stored: true } }]
        }
    ];

    assert.equal(await storage.deleteMeasurement('measurement-delete-fallback'), true);
    assert.deepEqual(storage.measurements.map(measurement => measurement.id),
        ['measurement-keep-fallback']);
    const persisted = JSON.parse(values.get(storage.STORAGE_KEY));
    assert.deepEqual(persisted.map(measurement => measurement.id), ['measurement-keep-fallback']);
    assert.equal(persisted[0].points[0].ir, undefined);
});

test('failed localStorage deletion restores in-memory state and emits no deletion event', async t => {
    const originalLocalStorage = globalThis.localStorage;
    globalThis.localStorage = { setItem: () => { throw new Error('quota'); } };
    t.after(() => {
        globalThis.localStorage = originalLocalStorage;
    });
    const storage = new DataStorage();
    storage.indexedDbUnavailable = true;
    storage.openDatabase = async () => { throw new Error('unavailable'); };
    let events = 0;
    storage.dispatchEvent = () => { events += 1; };
    const measurements = [
        { id: 'measurement-before', points: [] },
        { id: 'measurement-delete-fails', points: [] },
        { id: 'measurement-after', points: [] }
    ];
    storage.measurements = [...measurements];

    assert.equal(await storage.deleteMeasurement('measurement-delete-fails'), false);
    assert.deepEqual(storage.measurements, measurements);
    assert.equal(events, 0);
});

test('loadMeasurements distinguishes read failure from a successful empty database', async () => {
    const storage = new DataStorage();
    storage.openDatabase = async () => ({
        transaction: () => ({
            objectStore: () => ({
                index: () => ({
                    openCursor: () => {
                        const request = {};
                        queueMicrotask(() => request.onerror?.({
                            target: { error: new Error('Simulated read failure') }
                        }));
                        return request;
                    }
                })
            })
        })
    });

    await assert.rejects(
        storage.loadMeasurements(),
        error => error instanceof MeasurementLoadError && /read failure/.test(error.cause.message)
    );
});

test('startup orphan sweep runs after an empty successful load but not after a load failure', async () => {
    for (const [loadFails, expectedSweeps] of [[false, 1], [true, 0]]) {
        const storage = new DataStorage();
        let sweeps = 0;
        storage.openDatabase = async () => ({});
        storage.loadMeasurements = async () => {
            if (loadFails) throw new MeasurementLoadError(new Error('read failure'));
            storage.measurements = [];
            return [];
        };
        storage.removeOrphanImpulseResponses = async () => { sweeps += 1; };
        storage.loadFromLocalStorage = () => { storage.measurements = []; };

        await storage.initialize();
        assert.equal(sweeps, expectedSweeps);
        assert.equal(storage.loaded, true);
    }
});

test('import quota preflight failure is typed as storage failure and rolls back', async () => {
    const { storage, database } = createStorage();
    storage.generateId = () => 'measurement-import-quota';
    storage.getStorageEstimate = async () => ({ usage: 80, quota: 100 });
    const exported = exportableMeasurement();
    exported.impulseResponses = [{
        ...impulseRecord(exported.id, 0),
        data: storage.encodeFloat32Array(impulseRecord(exported.id, 0).data)
    }];

    await assert.rejects(
        storage.importMeasurementFromJSON(JSON.stringify(exported)),
        error => error instanceof MeasurementImportError && error.kind === 'storage'
    );
    assert.deepEqual(storage.measurements, []);
    assert.equal(database.measurements.size, 0);
    assert.equal(database.impulseResponses.size, 0);
});

test('import QuotaExceeded transaction failure is typed and rolls back atomically', async () => {
    const { storage, database } = createStorage();
    storage.generateId = () => 'measurement-import-idb-quota';
    const quotaError = new Error('IndexedDB quota exceeded');
    quotaError.name = 'QuotaExceededError';
    database.failNextTransaction = true;
    database.failNextError = quotaError;
    const exported = exportableMeasurement();
    exported.impulseResponses = [{
        ...impulseRecord(exported.id, 0),
        data: storage.encodeFloat32Array(impulseRecord(exported.id, 0).data)
    }];

    await assert.rejects(
        storage.importMeasurementFromJSON(JSON.stringify(exported)),
        error => error instanceof MeasurementImportError && error.kind === 'storage'
    );
    assert.deepEqual(storage.measurements, []);
    assert.equal(database.measurements.size, 0);
    assert.equal(database.impulseResponses.size, 0);
});
