const DATABASE_NAME = 'frequencyResponseDB';
const MEASUREMENT_STORE = 'measurements';
const IR_STORE = 'impulseResponses';

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = event => reject(event.target.error);
    });
}

export class MeasurementStore {
    constructor(database) {
        this.database = database;
        this.measurements = [];
    }

    async refresh() {
        const transaction = this.database.transaction([MEASUREMENT_STORE], 'readonly');
        const records = await requestResult(transaction.objectStore(MEASUREMENT_STORE).getAll());
        records.sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')));
        this.measurements = records;
        return this.listMeasurements();
    }

    listMeasurements() {
        return this.measurements.map(measurement => {
            const points = Array.isArray(measurement.points) ? measurement.points : [];
            return {
                id: measurement.id,
                name: measurement.name || 'Measurement',
                timestamp: measurement.timestamp,
                outputChannel: measurement.outputChannel,
                inputChannel: measurement.inputChannel,
                sampleRate: measurement.sampleRate,
                pointCount: points.length,
                hasIr: points.length > 0 && points.every(point => point.ir?.stored),
                hasFr: Array.isArray(measurement.averageFrequencyResponse) &&
                    measurement.averageFrequencyResponse.length > 0
            };
        });
    }

    async getMeasurement(id) {
        if (!id) return null;
        const transaction = this.database.transaction([MEASUREMENT_STORE], 'readonly');
        return await requestResult(transaction.objectStore(MEASUREMENT_STORE).get(id)) || null;
    }

    async getImpulseResponse(id, pointId) {
        if (!this.database.objectStoreNames.contains(IR_STORE)) return null;
        const transaction = this.database.transaction([IR_STORE], 'readonly');
        return await requestResult(transaction.objectStore(IR_STORE).get([id, pointId])) || null;
    }

    async getImpulseResponses(id) {
        if (!this.database.objectStoreNames.contains(IR_STORE)) return [];
        const transaction = this.database.transaction([IR_STORE], 'readonly');
        const store = transaction.objectStore(IR_STORE);
        if (store.indexNames.contains('measurementId')) {
            return await requestResult(store.index('measurementId').getAll(id));
        }
        const records = await requestResult(store.getAll());
        return records.filter(record => record.measurementId === id);
    }

    close() {
        this.database.close();
    }
}

export async function openMeasurementStore(indexedDb = globalThis.indexedDB) {
    if (!indexedDb) return null;
    return await new Promise(resolve => {
        const request = indexedDb.open(DATABASE_NAME);
        let absent = false;
        request.onupgradeneeded = event => {
            if (event.oldVersion === 0) {
                absent = true;
                request.transaction.abort();
            }
        };
        request.onerror = () => resolve(null);
        request.onsuccess = async () => {
            if (absent || !request.result.objectStoreNames.contains(MEASUREMENT_STORE)) {
                request.result.close();
                resolve(null);
                return;
            }
            const store = new MeasurementStore(request.result);
            try {
                await store.refresh();
                resolve(store);
            } catch (error) {
                console.error('Measurements could not be read:', error);
                store.close();
                resolve(null);
            }
        };
    });
}
