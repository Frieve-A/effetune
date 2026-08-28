const DATABASE_NAME = 'frequencyResponseDB';
const MEASUREMENT_STORE = 'measurements';
const IR_STORE = 'impulseResponses';
const VIRTUAL_CHANNEL_SEPARATOR = '::ch=';

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = event => reject(event.target.error);
    });
}

function isMultiChannelMeasurement(measurement) {
    return Array.isArray(measurement?.outputChannels) && measurement.outputChannels.length > 1;
}

function channelLabel(channel) {
    if (channel === 'left') return 'Ch 1';
    if (channel === 'right') return 'Ch 2';
    const index = Number(channel);
    return Number.isSafeInteger(index) && index >= 2 && index <= 7
        ? `Ch ${index + 1}`
        : String(channel);
}

function parseVirtualChannelId(id) {
    if (typeof id !== 'string') return null;
    const separatorIndex = id.lastIndexOf(VIRTUAL_CHANNEL_SEPARATOR);
    if (separatorIndex <= 0) return null;
    const channel = id.slice(separatorIndex + VIRTUAL_CHANNEL_SEPARATOR.length);
    if (!channel) return null;
    return { measurementId: id.slice(0, separatorIndex), channel };
}

function channelEntry(point, channel) {
    return Array.isArray(point?.channels)
        ? point.channels.find(entry => entry?.channel === channel) || null
        : null;
}

function virtualMeasurement(measurement, channel) {
    const summary = Array.isArray(measurement.channelResponses)
        ? measurement.channelResponses.find(entry => entry?.channel === channel)
        : null;
    const { outputChannels, channelResponses, ...flatMeasurement } = measurement;
    return {
        ...flatMeasurement,
        outputChannel: channel,
        points: (Array.isArray(measurement.points) ? measurement.points : []).map(point => {
            const entry = channelEntry(point, channel);
            return {
                pointId: point.pointId,
                name: point.name,
                timestamp: point.timestamp,
                frequencyResponse: entry?.frequencyResponse,
                maxSignalLevel: entry?.maxSignalLevel,
                ...(entry?.ir ? { ir: entry.ir } : {})
            };
        }),
        averageFrequencyResponse: summary?.averageFrequencyResponse,
        ...(summary?.maxSignalLevel !== undefined
            ? { maxSignalLevel: summary.maxSignalLevel }
            : {})
    };
}

function normalizeVirtualImpulseResponse(record, measurementId, pointId) {
    return record ? { ...record, measurementId, pointId } : null;
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
        return this.measurements.flatMap(measurement => {
            const points = Array.isArray(measurement.points) ? measurement.points : [];
            if (isMultiChannelMeasurement(measurement)) {
                return measurement.outputChannels.map(channel => {
                    const summary = Array.isArray(measurement.channelResponses)
                        ? measurement.channelResponses.find(entry => entry?.channel === channel)
                        : null;
                    return {
                        id: `${measurement.id}${VIRTUAL_CHANNEL_SEPARATOR}${channel}`,
                        name: `${measurement.name || 'Measurement'} [${channelLabel(channel)}]`,
                        timestamp: measurement.timestamp,
                        outputChannel: channel,
                        inputChannel: measurement.inputChannel,
                        sampleRate: measurement.sampleRate,
                        pointCount: points.length,
                        hasIr: points.length > 0 && points.every(point =>
                            channelEntry(point, channel)?.ir?.stored === true),
                        hasFr: Array.isArray(summary?.averageFrequencyResponse) &&
                            summary.averageFrequencyResponse.length > 0
                    };
                });
            }
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

    async _getStoredMeasurement(id) {
        const transaction = this.database.transaction([MEASUREMENT_STORE], 'readonly');
        return await requestResult(transaction.objectStore(MEASUREMENT_STORE).get(id)) || null;
    }

    async _getStoredImpulseResponses(id) {
        const transaction = this.database.transaction([IR_STORE], 'readonly');
        const store = transaction.objectStore(IR_STORE);
        if (store.indexNames.contains('measurementId')) {
            return await requestResult(store.index('measurementId').getAll(id));
        }
        const records = await requestResult(store.getAll());
        return records.filter(record => record.measurementId === id);
    }

    async getMeasurement(id) {
        if (!id) return null;
        const virtual = parseVirtualChannelId(id);
        const measurementId = virtual?.measurementId || id;
        const measurement = await this._getStoredMeasurement(measurementId);
        if (!measurement) return null;
        if (!isMultiChannelMeasurement(measurement)) return virtual ? null : measurement;
        if (!virtual || !measurement.outputChannels.includes(virtual.channel)) return null;
        return virtualMeasurement(measurement, virtual.channel);
    }

    async getImpulseResponse(id, pointId) {
        if (!this.database.objectStoreNames.contains(IR_STORE)) return null;
        const virtual = parseVirtualChannelId(id);
        if (virtual) {
            const measurement = await this._getStoredMeasurement(virtual.measurementId);
            if (!isMultiChannelMeasurement(measurement) ||
                !measurement.outputChannels.includes(virtual.channel)) return null;
            const point = (measurement.points || []).find(candidate => candidate?.pointId === pointId);
            const entry = channelEntry(point, virtual.channel);
            if (!entry?.ir?.stored || !Number.isSafeInteger(entry.irId)) return null;
            const transaction = this.database.transaction([IR_STORE], 'readonly');
            const record = await requestResult(
                transaction.objectStore(IR_STORE).get([virtual.measurementId, entry.irId])
            ) || null;
            return record?.channel === virtual.channel
                ? normalizeVirtualImpulseResponse(record, id, pointId)
                : null;
        }
        if (isMultiChannelMeasurement(await this._getStoredMeasurement(id))) return null;
        const transaction = this.database.transaction([IR_STORE], 'readonly');
        return await requestResult(transaction.objectStore(IR_STORE).get([id, pointId])) || null;
    }

    async getImpulseResponses(id) {
        if (!this.database.objectStoreNames.contains(IR_STORE)) return [];
        const virtual = parseVirtualChannelId(id);
        if (virtual) {
            const measurement = await this._getStoredMeasurement(virtual.measurementId);
            if (!isMultiChannelMeasurement(measurement) ||
                !measurement.outputChannels.includes(virtual.channel)) return [];
            const pointsByIrId = new Map();
            for (const point of measurement.points || []) {
                const entry = channelEntry(point, virtual.channel);
                if (Number.isSafeInteger(entry?.irId)) pointsByIrId.set(entry.irId, point.pointId);
            }
            const records = await this._getStoredImpulseResponses(virtual.measurementId);
            return records.flatMap(record => {
                const pointId = pointsByIrId.get(record?.pointId);
                return record?.channel === virtual.channel && pointId !== undefined
                    ? [normalizeVirtualImpulseResponse(record, id, pointId)]
                    : [];
            });
        }
        if (isMultiChannelMeasurement(await this._getStoredMeasurement(id))) return [];
        return this._getStoredImpulseResponses(id);
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
