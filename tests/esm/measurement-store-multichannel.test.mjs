import assert from 'node:assert/strict';
import test from 'node:test';

import { MeasurementStore } from '../../js/measurement-store/client.js';

function clone(value) {
    return structuredClone(value);
}

function request(result) {
    const value = clone(result);
    const pending = {};
    queueMicrotask(() => {
        pending.result = value;
        pending.onsuccess?.();
    });
    return pending;
}

class MeasurementDatabase {
    constructor(measurements, impulseResponses) {
        this.measurements = new Map(measurements.map(value => [value.id, clone(value)]));
        this.impulseResponses = new Map(impulseResponses.map(value => [
            JSON.stringify([value.measurementId, value.pointId]), clone(value)
        ]));
        this.objectStoreNames = { contains: name => ['measurements', 'impulseResponses'].includes(name) };
    }

    transaction(names) {
        const allowed = new Set(Array.isArray(names) ? names : [names]);
        return {
            objectStore: name => {
                assert.ok(allowed.has(name));
                if (name === 'measurements') {
                    return {
                        getAll: () => request([...this.measurements.values()]),
                        get: id => request(this.measurements.get(id) || null)
                    };
                }
                const records = () => [...this.impulseResponses.values()];
                return {
                    indexNames: { contains: index => index === 'measurementId' },
                    get: key => request(this.impulseResponses.get(JSON.stringify(key)) || null),
                    getAll: () => request(records()),
                    index: index => {
                        assert.equal(index, 'measurementId');
                        return { getAll: id => request(records().filter(record => record.measurementId === id)) };
                    }
                };
            }
        };
    }

    close() {}
}

function multichannelMeasurement() {
    return {
        id: 'measurement_multichannel',
        name: 'Listening seat',
        timestamp: '2026-08-25T10:00:00.000Z',
        inputChannel: 'both',
        sampleRate: 48000,
        outputChannel: 'multi',
        outputChannels: ['left', '2'],
        averageFrequencyResponse: [[100, -2]],
        channelResponses: [
            { channel: 'left', averageFrequencyResponse: [[100, -1]], maxSignalLevel: -12 },
            { channel: '2', averageFrequencyResponse: [[100, -3]], maxSignalLevel: -15 }
        ],
        points: [
            {
                pointId: 10,
                name: 'Sofa',
                timestamp: '2026-08-25T10:00:00.000Z',
                channels: [
                    {
                        channel: 'left',
                        frequencyResponse: [[100, -1]],
                        maxSignalLevel: -12,
                        irId: 11,
                        ir: { stored: true }
                    },
                    {
                        channel: '2',
                        frequencyResponse: [[100, -3]],
                        maxSignalLevel: -15,
                        irId: 12,
                        ir: { stored: true }
                    }
                ]
            },
            {
                pointId: 20,
                name: 'Desk',
                timestamp: '2026-08-25T10:01:00.000Z',
                channels: [
                    {
                        channel: 'left',
                        frequencyResponse: [[100, -2]],
                        maxSignalLevel: -13,
                        irId: 21,
                        ir: { stored: true }
                    },
                    {
                        channel: '2',
                        frequencyResponse: [[100, -4]],
                        maxSignalLevel: -16,
                        irId: 22,
                        ir: { stored: true }
                    }
                ]
            }
        ]
    };
}

function impulseResponse(measurementId, pointId, channel, value) {
    return {
        measurementId,
        pointId,
        channel,
        sampleRate: 48000,
        onsetIndex: 0,
        data: Float32Array.from([value])
    };
}

async function createStore() {
    const multi = multichannelMeasurement();
    const single = {
        id: 'measurement_single',
        name: 'Stereo baseline',
        timestamp: '2026-08-24T10:00:00.000Z',
        outputChannel: 'left',
        inputChannel: 'both',
        sampleRate: 48000,
        averageFrequencyResponse: [[100, 0]],
        points: [{ pointId: 3, ir: { stored: true } }]
    };
    const database = new MeasurementDatabase(
        [multi, single],
        [
            impulseResponse(multi.id, 11, 'left', 0.1),
            impulseResponse(multi.id, 12, '2', 0.2),
            impulseResponse(multi.id, 21, 'left', 0.3),
            impulseResponse(multi.id, 22, '2', 0.4),
            impulseResponse(single.id, 3, 'left', 0.5)
        ]
    );
    const store = new MeasurementStore(database);
    await store.refresh();
    return { store, multi, single };
}

test('MeasurementStore exposes only channel entries for a multichannel measurement', async () => {
    const { store, single } = await createStore();

    assert.deepEqual(store.listMeasurements(), [
        {
            id: 'measurement_multichannel::ch=left',
            name: 'Listening seat [Ch 1]',
            timestamp: '2026-08-25T10:00:00.000Z',
            outputChannel: 'left',
            inputChannel: 'both',
            sampleRate: 48000,
            pointCount: 2,
            hasIr: true,
            hasFr: true
        },
        {
            id: 'measurement_multichannel::ch=2',
            name: 'Listening seat [Ch 3]',
            timestamp: '2026-08-25T10:00:00.000Z',
            outputChannel: '2',
            inputChannel: 'both',
            sampleRate: 48000,
            pointCount: 2,
            hasIr: true,
            hasFr: true
        },
        {
            id: single.id,
            name: single.name,
            timestamp: single.timestamp,
            outputChannel: single.outputChannel,
            inputChannel: single.inputChannel,
            sampleRate: single.sampleRate,
            pointCount: 1,
            hasIr: true,
            hasFr: true
        }
    ]);
});

test('MeasurementStore flattens channel entries without exposing a multichannel parent', async () => {
    const { store, multi, single } = await createStore();

    assert.equal(await store.getMeasurement(multi.id), null);
    assert.equal(await store.getMeasurement(`${multi.id}::ch=right`), null);
    assert.deepEqual(await store.getMeasurement(single.id), single);

    const left = await store.getMeasurement(`${multi.id}::ch=left`);
    assert.equal(left.outputChannel, 'left');
    assert.equal(left.outputChannels, undefined);
    assert.equal(left.channelResponses, undefined);
    assert.deepEqual(left.averageFrequencyResponse, [[100, -1]]);
    assert.deepEqual(left.points.map(point => point.pointId), [10, 20]);
    assert.deepEqual(left.points.map(point => point.frequencyResponse), [
        [[100, -1]],
        [[100, -2]]
    ]);
    assert.deepEqual(left.points.map(point => point.ir), [{ stored: true }, { stored: true }]);
});

test('MeasurementStore rewrites virtual impulse records to their parent point ids', async () => {
    const { store, multi } = await createStore();
    const id = `${multi.id}::ch=2`;

    const point = await store.getImpulseResponse(id, 20);
    assert.equal(point.measurementId, id);
    assert.equal(point.pointId, 20);
    assert.equal(point.channel, '2');
    assert.equal(point.data[0], Math.fround(0.4));
    assert.equal(await store.getImpulseResponse(multi.id, 20), null);

    const records = await store.getImpulseResponses(id);
    assert.deepEqual(records.map(record => [record.measurementId, record.pointId, record.channel]), [
        [id, 10, '2'],
        [id, 20, '2']
    ]);
    assert.equal((await store.getImpulseResponses(multi.id)).length, 0);
});
