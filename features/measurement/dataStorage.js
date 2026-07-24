/**
 * Data storage utility for measurement data
 * Manages saving/loading from IndexedDB and file export/import
 */

export class MeasurementImportError extends Error {
    constructor(kind, cause = null) {
        super(kind === 'storage'
            ? 'The imported measurement could not be saved.'
            : 'The measurement file format is invalid.');
        this.name = 'MeasurementImportError';
        this.kind = kind;
        this.cause = cause;
    }
}

export class MeasurementLoadError extends Error {
    constructor(cause) {
        super('Measurements could not be loaded.');
        this.name = 'MeasurementLoadError';
        this.cause = cause;
    }
}

function isFrequencyResponse(value) {
    return Array.isArray(value) && value.every(entry =>
        Array.isArray(entry) && entry.length >= 2 &&
        Number.isFinite(entry[0]) && entry[0] > 0 && Number.isFinite(entry[1]));
}

function isIndexedDbUnavailableError(error) {
    return ['SecurityError', 'NotSupportedError', 'InvalidStateError'].includes(error?.name);
}

function metadataOnlyMeasurement(measurement) {
    const metadata = structuredClone(measurement);
    delete metadata._deletedPointIds;
    delete metadata._originalPoints;
    delete metadata._editSnapshot;
    for (const point of metadata.points || []) delete point.ir;
    return metadata;
}

function hasValidImportedScalars(data) {
    const optionalStrings = [
        'timestamp', 'audioInput', 'inputChannel', 'audioOutput', 'outputChannel'
    ];
    if (optionalStrings.some(key => data[key] !== undefined && typeof data[key] !== 'string')) {
        return false;
    }

    const optionalNumbers = [
        'requestedSampleRate', 'sampleRate', 'sweepMinFreq', 'sweepMaxFreq', 'averaging',
        'correctionLowFreq', 'correctionHighFreq', 'smoothing', 'eqBandCount', 'maxSignalLevel'
    ];
    if (optionalNumbers.some(key => data[key] !== undefined && !Number.isFinite(data[key]))) {
        return false;
    }
    if (data.sampleRate !== undefined && data.sampleRate <= 0) return false;
    if (data.sweepLength !== undefined && (
        !['number', 'string'].includes(typeof data.sweepLength) ||
        !Number.isFinite(Number(data.sweepLength)) || Number(data.sweepLength) <= 0
    )) return false;
    if (data.nextPointId !== undefined && !Number.isSafeInteger(data.nextPointId)) return false;
    if (data.averageFrequencyResponse !== undefined &&
        !isFrequencyResponse(data.averageFrequencyResponse)) return false;
    if (data.correctedResponse !== undefined && !isFrequencyResponse(data.correctedResponse)) return false;
    if (data.peqParameters !== undefined && !Array.isArray(data.peqParameters)) return false;

    return data.points.every(point => point && typeof point === 'object' &&
        (point.name === undefined || typeof point.name === 'string') &&
        (point.timestamp === undefined || typeof point.timestamp === 'string') &&
        (point.pointId === undefined || Number.isSafeInteger(point.pointId)) &&
        (point.maxSignalLevel === undefined || Number.isFinite(point.maxSignalLevel)) &&
        isFrequencyResponse(point.frequencyResponse));
}

export class DataStorage {
    constructor() {
        this.STORAGE_KEY = 'frequency_response_measurements';
        this.DO_NOT_WARN_KEY = 'do_not_warn_on_delete';
        this.USER_SETTINGS_KEY = 'user_settings';
        this.PEQ_SETTINGS_KEY = 'peq_settings';
        this.DB_NAME = 'frequencyResponseDB';
        this.DB_VERSION = 2;
        this.STORE_NAME = 'measurements';
        this.SETTINGS_STORE = 'settings';
        this.IR_STORE = 'impulseResponses';
        this.db = null;
        this.measurements = [];
        this.loaded = false;
        this.irPersistenceAvailable = true;
        this.indexedDbUnavailable = false;
        
        // Event names for data changes
        this.EVENTS = {
            MEASUREMENT_ADDED: 'measurement-added',
            MEASUREMENT_UPDATED: 'measurement-updated',
            MEASUREMENT_DELETED: 'measurement-deleted',
            MEASUREMENTS_LOADED: 'measurements-loaded'
        };
    }

    /**
     * Initialize the data storage
     */
    async initialize() {
        if (this.loaded) return;
        
        try {
            await this.openDatabase();
        } catch (error) {
            console.error('Error opening measurement database:', error);
            this.loadFromLocalStorage();
            if (this.indexedDbUnavailable) this.irPersistenceAvailable = false;
            this.loaded = true;
            return;
        }

        try {
            await this.loadMeasurements();
        } catch (error) {
            console.error('Error loading measurement database:', error);
            this.loadFromLocalStorage();
            this.loaded = true;
            return;
        }

        try {
            await this.removeOrphanImpulseResponses();
        } catch (error) {
            console.error('Error removing orphan impulse responses:', error);
        }
        this.loaded = true;
    }

    /**
     * Open and initialize the IndexedDB database
     * @returns {Promise} Promise that resolves when DB is ready
     */
    openDatabase() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                resolve(this.db);
                return;
            }

            if (!globalThis.indexedDB) {
                this.indexedDbUnavailable = true;
                reject(new Error('Your browser does not support IndexedDB'));
                return;
            }

            let request;
            try {
                request = globalThis.indexedDB.open(this.DB_NAME, this.DB_VERSION);
            } catch (error) {
                this.indexedDbUnavailable = isIndexedDbUnavailableError(error);
                reject(error);
                return;
            }

            request.onerror = (event) => {
                const error = event.target.error;
                this.indexedDbUnavailable = isIndexedDbUnavailableError(error);
                console.error('IndexedDB error:', error);
                reject(error);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create measurements store with id as key path
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
                
                // Create settings store
                if (!db.objectStoreNames.contains(this.SETTINGS_STORE)) {
                    db.createObjectStore(this.SETTINGS_STORE, { keyPath: 'key' });
                }

                if (!db.objectStoreNames.contains(this.IR_STORE)) {
                    const irStore = db.createObjectStore(this.IR_STORE, {
                        keyPath: ['measurementId', 'pointId']
                    });
                    irStore.createIndex('measurementId', 'measurementId', { unique: false });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                
                // Migrate data from localStorage if needed
                this.migrateFromLocalStorage().then(() => {
                    resolve(this.db);
                }).catch(err => {
                    console.error('Migration error:', err);
                    resolve(this.db); // Still resolve even if migration fails
                });
            };
        });
    }

    /**
     * Migrate data from localStorage to IndexedDB if needed
     */
    async migrateFromLocalStorage() {
        try {
            // Check if we already migrated
            const migrationDone = localStorage.getItem('indexeddb_migration_complete');
            if (migrationDone === 'true') {
                return;
            }

            // Check if there's data to migrate
            const storedData = localStorage.getItem(this.STORAGE_KEY);
            if (!storedData) {
                localStorage.setItem('indexeddb_migration_complete', 'true');
                return;
            }

            const measurements = JSON.parse(storedData);
            
            if (Array.isArray(measurements) && measurements.length > 0) {
                const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(this.STORE_NAME);
                
                // Add each measurement to the store
                for (const measurement of measurements) {
                    store.put(measurement);
                }
                
                // Migrate the "do not warn" setting
                const doNotWarn = localStorage.getItem(this.DO_NOT_WARN_KEY) === 'true';
                const settingsTransaction = this.db.transaction([this.SETTINGS_STORE], 'readwrite');
                const settingsStore = settingsTransaction.objectStore(this.SETTINGS_STORE);
                settingsStore.put({ key: this.DO_NOT_WARN_KEY, value: doNotWarn });
                
                return new Promise((resolve, reject) => {
                    transaction.oncomplete = () => {
                        localStorage.setItem('indexeddb_migration_complete', 'true');
                        resolve();
                    };
                    transaction.onerror = (event) => {
                        console.error('Migration failed:', event.target.error);
                        reject(event.target.error);
                    };
                });
            }
            
            localStorage.setItem('indexeddb_migration_complete', 'true');
            
        } catch (error) {
            console.error('Error during migration:', error);
            throw error;
        }
    }

    /**
     * Load measurements from IndexedDB
     */
    async loadMeasurements() {
        try {
            const db = await this.openDatabase();
            return await new Promise((resolve, reject) => {
                const transaction = db.transaction([this.STORE_NAME], 'readonly');
                const store = transaction.objectStore(this.STORE_NAME);
                const index = store.index('timestamp');
                
                // Use index to get measurements sorted by timestamp (descending)
                const request = index.openCursor(null, 'prev');
                const measurements = [];
                
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        measurements.push(cursor.value);
                        cursor.continue();
                    } else {
                        // Done iterating
                        this.measurements = measurements;
                        
                        // Notify UI that measurements are loaded
                        this.dispatchEvent(this.EVENTS.MEASUREMENTS_LOADED, { 
                            count: measurements.length 
                        });
                        
                        resolve(this.measurements);
                    }
                };
                
                request.onerror = (event) => {
                    console.error('Error loading measurements:', event.target.error);
                    reject(event.target.error);
                };
            });
        } catch (error) {
            console.error('Error loading measurements:', error);
            throw new MeasurementLoadError(error);
        }
    }

    /**
     * Fallback to load from localStorage if IndexedDB fails
     */
    loadFromLocalStorage() {
        try {
            const storedData = localStorage.getItem(this.STORAGE_KEY);
            if (storedData) {
                this.measurements = JSON.parse(storedData);
                console.log(`Loaded ${this.measurements.length} measurements from localStorage (fallback)`);
            } else {
                this.measurements = [];
            }
        } catch (error) {
            console.error('Error loading measurements from localStorage:', error);
            this.measurements = [];
        }
        return this.measurements;
    }

    /**
     * Save measurements to IndexedDB
     */
    async saveMeasurements() {
        try {
            const db = await this.openDatabase();
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(this.STORE_NAME);
                
                for (const measurement of this.measurements) store.put(measurement);
                
                transaction.oncomplete = () => {
                    resolve(true);
                };
                
                transaction.onerror = (event) => {
                    console.error('Error saving measurements:', event.target.error);
                    
                    // Fallback to localStorage
                    try {
                        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.measurements));
                        console.log('Saved measurements to localStorage (fallback)');
                        resolve(true);
                    } catch (err) {
                        console.error('Failed to save to localStorage:', err);
                        reject(err);
                    }
                };
            });
        } catch (error) {
            console.error('Error in saveMeasurements:', error);
            
            // Fallback to localStorage
            try {
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.measurements));
                console.log('Saved measurements to localStorage (fallback)');
                return true;
            } catch (err) {
                console.error('Failed to save to localStorage:', err);
                return false;
            }
        }
    }

    async putMeasurement(measurement, impulseResponses = []) {
        const records = Array.isArray(impulseResponses)
            ? impulseResponses
            : impulseResponses ? [impulseResponses] : [];
        const deletedPointIds = Array.isArray(measurement._deletedPointIds)
            ? measurement._deletedPointIds
            : [];
        const storedMeasurement = { ...measurement };
        delete storedMeasurement._deletedPointIds;
        delete storedMeasurement._originalPoints;
        delete storedMeasurement._editSnapshot;
        try {
            const db = await this.openDatabase();
            const needsIrStore = records.length > 0 || deletedPointIds.length > 0;
            if (records.length) await this.ensureImpulseResponseQuota(records);
            const stores = needsIrStore ? [this.STORE_NAME, this.IR_STORE] : [this.STORE_NAME];
            await new Promise((resolve, reject) => {
                const transaction = db.transaction(stores, 'readwrite');
                transaction.objectStore(this.STORE_NAME).put(storedMeasurement);
                if (needsIrStore) {
                    const irStore = transaction.objectStore(this.IR_STORE);
                    for (const record of records) irStore.put(record);
                    for (const pointId of deletedPointIds) irStore.delete([measurement.id, pointId]);
                }
                transaction.oncomplete = () => resolve();
                transaction.onerror = event => reject(event.target.error);
                transaction.onabort = event => reject(event.target.error || new Error('Measurement save was cancelled'));
            });
            if (records.length) await this.requestPersistentStorage();
            return true;
        } catch (error) {
            console.error('Error saving measurement record:', error);
            if (this.indexedDbUnavailable) return this.saveMetadataFallback(measurement);
            return false;
        }
    }

    saveMetadataFallback(measurement) {
        const metadataOnly = metadataOnlyMeasurement(measurement);

        const measurements = [...this.measurements];
        const existingIndex = measurements.findIndex(candidate => candidate.id === metadataOnly.id);
        if (existingIndex >= 0) measurements[existingIndex] = metadataOnly;
        else measurements.unshift(metadataOnly);

        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(measurements));
            for (const point of measurement.points || []) delete point.ir;
            for (const key of Object.keys(measurement)) delete measurement[key];
            Object.assign(measurement, metadataOnly);
            this.irPersistenceAvailable = false;
            return true;
        } catch (error) {
            console.error('Failed to save measurement metadata to localStorage:', error);
            return false;
        }
    }

    async putImpulseResponse(record) {
        if (!record?.measurementId || !Number.isSafeInteger(record.pointId) ||
            !(record.data instanceof Float32Array)) {
            throw new TypeError('Impulse response record is invalid');
        }
        const db = await this.openDatabase();
        await new Promise((resolve, reject) => {
            const transaction = db.transaction([this.IR_STORE], 'readwrite');
            transaction.objectStore(this.IR_STORE).put(record);
            transaction.oncomplete = () => resolve();
            transaction.onerror = event => reject(event.target.error);
        });
        await this.requestPersistentStorage();
        return true;
    }

    async getImpulseResponse(measurementId, pointId) {
        try {
            const db = await this.openDatabase();
            return await new Promise((resolve, reject) => {
                const request = db.transaction([this.IR_STORE], 'readonly')
                    .objectStore(this.IR_STORE).get([measurementId, pointId]);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = event => reject(event.target.error);
            });
        } catch (error) {
            console.error('Error loading impulse response:', error);
            return null;
        }
    }

    async getImpulseResponses(measurementId) {
        try {
            const db = await this.openDatabase();
            return await new Promise((resolve, reject) => {
                const store = db.transaction([this.IR_STORE], 'readonly').objectStore(this.IR_STORE);
                const request = store.index('measurementId').getAll(measurementId);
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = event => reject(event.target.error);
            });
        } catch (error) {
            console.error('Error loading impulse responses:', error);
            return [];
        }
    }

    async deletePoint(measurementId, pointId) {
        const measurement = this.getMeasurementById(measurementId);
        if (!measurement) return false;
        const points = measurement.points || [];
        const index = points.findIndex(point => point.pointId === pointId);
        if (index < 0) return false;
        measurement.points = points.filter(point => point.pointId !== pointId);
        try {
            const db = await this.openDatabase();
            await new Promise((resolve, reject) => {
                const transaction = db.transaction([this.STORE_NAME, this.IR_STORE], 'readwrite');
                transaction.objectStore(this.STORE_NAME).put(measurement);
                transaction.objectStore(this.IR_STORE).delete([measurementId, pointId]);
                transaction.oncomplete = () => resolve();
                transaction.onerror = event => reject(event.target.error);
                transaction.onabort = event => reject(
                    event.target.error || new Error('Point deletion was cancelled')
                );
            });
            return true;
        } catch (error) {
            console.error('Error deleting measurement point:', error);
            measurement.points = points;
            return false;
        }
    }

    async removeOrphanImpulseResponses() {
        if (!this.db?.objectStoreNames.contains(this.IR_STORE)) return;
        const known = new Set(this.measurements.map(measurement => measurement.id));
        await new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.IR_STORE], 'readwrite');
            const request = transaction.objectStore(this.IR_STORE).openCursor();
            request.onsuccess = event => {
                const cursor = event.target.result;
                if (!cursor) return;
                if (!known.has(cursor.value.measurementId)) cursor.delete();
                cursor.continue();
            };
            transaction.oncomplete = () => resolve();
            transaction.onerror = event => reject(event.target.error);
        });
    }

    async requestPersistentStorage() {
        if (this._persistenceRequested) return;
        this._persistenceRequested = true;
        try {
            await navigator.storage?.persist?.();
        } catch (error) {
            console.warn('Persistent measurement storage could not be requested:', error);
        }
    }

    async getStorageEstimate() {
        try {
            return await navigator.storage?.estimate?.() || null;
        } catch (error) {
            console.warn('Measurement storage usage is unavailable:', error);
            return null;
        }
    }

    async ensureImpulseResponseQuota(records) {
        const estimate = await this.getStorageEstimate();
        if (!estimate || !Number.isFinite(estimate.usage) || !Number.isFinite(estimate.quota)) return;
        const addedBytes = records.reduce((total, record) => total + (record.data?.byteLength || 0), 0);
        if (estimate.usage + addedBytes > estimate.quota * 0.8) {
            throw new Error('Measurement storage is nearly full. Delete old measurements and try again.');
        }
    }

    /**
     * Get the "do not warn on delete" setting
     */
    async getDoNotWarnSetting() {
        try {
            const db = await this.openDatabase();
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.SETTINGS_STORE], 'readonly');
                const store = transaction.objectStore(this.SETTINGS_STORE);
                const request = store.get(this.DO_NOT_WARN_KEY);
                
                request.onsuccess = (event) => {
                    const result = event.target.result;
                    if (result) {
                        resolve(result.value);
                    } else {
                        resolve(false);
                    }
                };
                
                request.onerror = (event) => {
                    console.error('Error getting setting:', event.target.error);
                    // Fallback to localStorage
                    try {
                        resolve(localStorage.getItem(this.DO_NOT_WARN_KEY) === 'true');
                    } catch (err) {
                        resolve(false);
                    }
                };
            });
        } catch (error) {
            console.error('Error in getDoNotWarnSetting:', error);
            // Fallback to localStorage
            try {
                return localStorage.getItem(this.DO_NOT_WARN_KEY) === 'true';
            } catch (err) {
                return false;
            }
        }
    }

    /**
     * Set the "do not warn on delete" setting
     * @param {boolean} value - Whether to skip delete warnings
     */
    async setDoNotWarnSetting(value) {
        try {
            const db = await this.openDatabase();
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.SETTINGS_STORE], 'readwrite');
                const store = transaction.objectStore(this.SETTINGS_STORE);
                const request = store.put({ key: this.DO_NOT_WARN_KEY, value: value });
                
                transaction.oncomplete = () => {
                    // Also save to localStorage as a fallback
                    try {
                        localStorage.setItem(this.DO_NOT_WARN_KEY, value.toString());
                    } catch (e) {
                        console.warn('Failed to save setting to localStorage:', e);
                    }
                    resolve(true);
                };
                
                transaction.onerror = (event) => {
                    console.error('Error saving setting:', event.target.error);
                    // Try localStorage as fallback
                    try {
                        localStorage.setItem(this.DO_NOT_WARN_KEY, value.toString());
                        resolve(true);
                    } catch (err) {
                        reject(err);
                    }
                };
            });
        } catch (error) {
            console.error('Error in setDoNotWarnSetting:', error);
            // Fallback to localStorage
            try {
                localStorage.setItem(this.DO_NOT_WARN_KEY, value.toString());
                return true;
            } catch (err) {
                return false;
            }
        }
    }

    /**
     * Get all measurements
     * @returns {Array} Array of measurement objects
     */
    getAllMeasurements() {
        return [...this.measurements];
    }

    /**
     * Get measurement by ID
     * @param {string} id - Measurement ID
     * @returns {Object|null} Measurement object or null if not found
     */
    getMeasurementById(id) {
        return this.measurements.find(m => m.id === id) || null;
    }

    /**
     * Get the most recent measurement
     * @returns {Object|null} Most recent measurement or null if none exist
     */
    getLatestMeasurement() {
        if (this.measurements.length === 0) {
            return null;
        }
        return this.measurements[0]; // Measurements are stored with newest first
    }

    /**
     * Add a measurement or update if it already exists with the same ID
     * @param {Object} measurement - Measurement object
     * @returns {string} ID of the new or updated measurement
     */
    async addMeasurement(measurement, impulseResponseRecords = []) {
        // Ensure measurement has an ID and timestamp
        const measurementId = measurement.id || this.generateId();
        
        const newMeasurement = {
            ...measurement,
            id: measurementId,
            timestamp: measurement.timestamp || new Date().toISOString()
        };

        // Check if measurement with this ID already exists
        const existingIndex = this.measurements.findIndex(m => m.id === measurementId);
        
        if (existingIndex !== -1) {
            // Update existing measurement
            const updatedMeasurement = {
                ...newMeasurement,
                lastModified: new Date().toISOString()
            };
            
            const saved = await this.putMeasurement(updatedMeasurement, impulseResponseRecords);
            if (!saved) {
                throw new Error('The measurement could not be saved.');
            }
            this.measurements[existingIndex] = updatedMeasurement;
            
            // Notify UI of updated measurement
            this.dispatchEvent(this.EVENTS.MEASUREMENT_UPDATED, {
                measurement: updatedMeasurement
            });
        } else {
            const saved = await this.putMeasurement(newMeasurement, impulseResponseRecords);
            if (!saved) {
                throw new Error('The measurement could not be saved.');
            }
            // Add new measurement to the beginning (newest first)
            this.measurements.unshift(newMeasurement);
            
            // Notify UI of new measurement
            this.dispatchEvent(this.EVENTS.MEASUREMENT_ADDED, {
                measurement: newMeasurement
            });
        }
        
        return measurementId;
    }

    /**
     * Update an existing measurement
     * @param {string} id - Measurement ID
     * @param {Object} updatedData - Updated measurement data
     * @returns {boolean} Success status
     */
    async updateMeasurement(id, updatedData) {
        const index = this.measurements.findIndex(m => m.id === id);
        if (index === -1) {
            return false;
        }

        // Update the measurement
        const updatedMeasurement = {
            ...this.measurements[index],
            ...updatedData,
            id: id, // Ensure ID doesn't change
            lastModified: new Date().toISOString()
        };
        const saved = await this.putMeasurement(updatedMeasurement);
        if (!saved) {
            return false;
        }
        delete updatedMeasurement._deletedPointIds;
        delete updatedMeasurement._originalPoints;
        delete updatedMeasurement._editSnapshot;
        this.measurements[index] = updatedMeasurement;
        
        // Notify UI of updated measurement
        this.dispatchEvent(this.EVENTS.MEASUREMENT_UPDATED, {
            measurement: updatedMeasurement
        });
        
        return true;
    }

    /**
     * Delete a measurement
     * @param {string} id - ID of measurement to delete
     * @returns {boolean} Success status
     */
    async deleteMeasurement(id) {
        const initialLength = this.measurements.length;
        const deletedMeasurement = this.getMeasurementById(id);
        const deletedIndex = this.measurements.findIndex(measurement => measurement.id === id);
        this.measurements = this.measurements.filter(m => m.id !== id);
        
        if (this.measurements.length < initialLength) {
            try {
                const db = await this.openDatabase();
                await new Promise((resolve, reject) => {
                    const transaction = db.transaction([this.STORE_NAME, this.IR_STORE], 'readwrite');
                    transaction.objectStore(this.STORE_NAME).delete(id);
                    const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
                    transaction.objectStore(this.IR_STORE).delete(range);
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = event => reject(event.target.error);
                });
            } catch (error) {
                console.error('Error deleting measurement:', error);
                if (this.indexedDbUnavailable) {
                    try {
                        const metadata = this.measurements.map(metadataOnlyMeasurement);
                        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(metadata));
                        this.irPersistenceAvailable = false;
                    } catch (fallbackError) {
                        console.error('Failed to delete measurement from localStorage:', fallbackError);
                        this.measurements.splice(deletedIndex, 0, deletedMeasurement);
                        return false;
                    }
                } else {
                    this.measurements.splice(deletedIndex, 0, deletedMeasurement);
                    return false;
                }
            }
            
            // Notify UI of deleted measurement
            if (deletedMeasurement) {
                this.dispatchEvent(this.EVENTS.MEASUREMENT_DELETED, {
                    id: id,
                    measurement: deletedMeasurement
                });
            }
            
            return true;
        }
        return false;
    }

    /**
     * Generate a unique ID for a measurement
     * @returns {string} A unique ID
     */
    generateId() {
        const unique = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${performance.now()}`;
        return `measurement_${unique}`;
    }

    /**
     * Export a measurement to a JSON file
     * @param {string} id - Measurement ID
     * @returns {string|null} JSON string or null if measurement not found
     */
    async exportMeasurementToJSON(id, includeImpulseResponses = false) {
        const measurement = this.getMeasurementById(id);
        if (!measurement) {
            return null;
        }
        
        const exported = structuredClone(measurement);
        if (includeImpulseResponses) {
            const records = await this.getImpulseResponses(id);
            exported.impulseResponses = records.map(record => ({
                ...record,
                data: this.encodeFloat32Array(record.data)
            }));
        }
        return JSON.stringify(exported, null, 2);
    }

    /**
     * Export PEQ parameters to CSV
     * @param {Array} peqParams - Array of PEQ parameters
     * @returns {string} CSV content
     */
    exportPEQtoCSV(peqParams) {
        if (!peqParams || !Array.isArray(peqParams) || peqParams.length === 0) {
            return 'Filter,Type,Freq,Gain,Q\n';
        }
        
        // Sort by frequency ascending
        const sortedParams = [...peqParams].sort((a, b) => a.frequency - b.frequency);
        
        let csv = 'Filter,Type,Freq,Gain,Q\n';
        
        sortedParams.forEach((param, index) => {
            csv += `${index + 1},PK,${param.frequency},${param.gain.toFixed(1)},${param.Q.toFixed(1)}\n`;
        });
        
        return csv;
    }

    /**
     * Export PEQ parameters to txt format
     * @param {Array} peqParams - Array of PEQ parameters
     * @returns {string} txt format content
     */
    exportPEQtoTXT(peqParams) {
        if (!peqParams || !Array.isArray(peqParams) || peqParams.length === 0) {
            return 'Preamp: -6.0 dB\n';
        }
        
        // Sort by frequency ascending
        const sortedParams = [...peqParams].sort((a, b) => a.frequency - b.frequency);
        
        let txt = 'Preamp: -6.0 dB\n';
        
        sortedParams.forEach((param, index) => {
            let filterType = 'PK'; // Default is peaking (PK)
            txt += `Filter ${index + 1}: ON ${filterType} Fc ${param.frequency} Hz Gain ${param.gain.toFixed(1)} dB Q ${param.Q.toFixed(2)}\n`;
        });
        
        return txt;
    }

    /**
     * Import a measurement from JSON data
     * @param {string} jsonString - JSON string of measurement data
     * @returns {string|null} ID of imported measurement or null on error
     */
    async importMeasurementFromJSON(jsonString) {
        let data;
        try {
            data = JSON.parse(jsonString);
        } catch (error) {
            console.error('Invalid measurement JSON:', error);
            return null;
        }

        if (!data || typeof data !== 'object' || typeof data.name !== 'string' ||
            !data.name.trim() || !Array.isArray(data.points) || !hasValidImportedScalars(data)) {
            console.error('Invalid measurement data format');
            return null;
        }

        // Give the imported measurement a new ID.
        data.id = this.generateId();
        data.imported = true;
        data.importTimestamp = new Date().toISOString();

        const impulseResponses = Array.isArray(data.impulseResponses) ? data.impulseResponses : [];
        delete data.impulseResponses;
        for (const point of data.points) {
            if (!Number.isSafeInteger(point.pointId)) point.pointId = data.nextPointId || 0;
            data.nextPointId = Math.max(data.nextPointId || 0, point.pointId + 1);
        }

        const pointsById = new Map(data.points.map(point => [point.pointId, point]));
        for (const point of data.points) delete point.ir;
        const decodedRecords = [];
        const decodedPointIds = new Set();
        for (const record of impulseResponses) {
            if (!record || typeof record !== 'object' || typeof record.data !== 'string' ||
                !Number.isSafeInteger(record.pointId) || decodedPointIds.has(record.pointId) ||
                !pointsById.has(record.pointId) || !Number.isFinite(record.sampleRate) ||
                record.sampleRate <= 0 || !Number.isSafeInteger(record.onsetIndex) ||
                record.onsetIndex < 0) {
                continue;
            }

            try {
                const samples = this.decodeFloat32Array(record.data);
                if (samples.length === 0 || record.onsetIndex >= samples.length) continue;
                const decodedRecord = {
                    ...record,
                    measurementId: data.id,
                    data: samples
                };
                decodedRecords.push(decodedRecord);
                decodedPointIds.add(record.pointId);
                const point = pointsById.get(record.pointId);
                point.ir = {
                    stored: true,
                    length: samples.length,
                    sampleRate: record.sampleRate,
                    onsetIndex: record.onsetIndex,
                    ...(Number.isFinite(record.peakDb) ? { peakDb: record.peakDb } : {})
                };
            } catch (error) {
                console.warn('Embedded impulse response was ignored:', error);
            }
        }

        try {
            return await this.addMeasurement(data, decodedRecords);
        } catch (error) {
            console.error('Error saving imported measurement:', error);
            throw new MeasurementImportError('storage', error);
        }
    }

    /**
     * Encode Float32Array to base64 string for storage
     * @param {Float32Array} array - Float32Array to encode
     * @returns {string} Base64 encoded string
     */
    encodeFloat32Array(array) {
        const buffer = new ArrayBuffer(array.length * 4);
        const view = new DataView(buffer);
        
        for (let i = 0; i < array.length; i++) {
            view.setFloat32(i * 4, array[i], true);
        }
        
        const uint8Array = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        
        return btoa(binary);
    }

    /**
     * Decode base64 string to Float32Array
     * @param {string} base64 - Base64 encoded string
     * @returns {Float32Array} Decoded Float32Array
     */
    decodeFloat32Array(base64) {
        const binary = atob(base64);
        if (binary.length === 0 || binary.length % Float32Array.BYTES_PER_ELEMENT !== 0) {
            throw new TypeError('Impulse response data length is invalid');
        }
        const bytes = new Uint8Array(binary.length);
        
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        
        const buffer = bytes.buffer;
        return new Float32Array(buffer);
    }

    /**
     * Dispatch a custom event to notify UI components of data changes
     * @param {string} eventName - Name of the event
     * @param {any} detail - Additional data for the event
     */
    dispatchEvent(eventName, detail = {}) {
        const event = new CustomEvent(eventName, {
            detail,
            bubbles: true,
            cancelable: true
        });
        document.dispatchEvent(event);
    }

    /**
     * Save user settings to localStorage
     * @param {Object} settings - Settings object to save
     */
    saveUserSettings(settings) {
        try {
            localStorage.setItem(this.USER_SETTINGS_KEY, JSON.stringify(settings));
            console.log('User settings saved');
            return true;
        } catch (error) {
            console.error('Error saving user settings:', error);
            return false;
        }
    }

    /**
     * Load user settings from localStorage
     * @returns {Object} Settings object or empty object if not found
     */
    loadUserSettings() {
        try {
            const settings = localStorage.getItem(this.USER_SETTINGS_KEY);
            return settings ? JSON.parse(settings) : {};
        } catch (error) {
            console.error('Error loading user settings:', error);
            return {};
        }
    }

    /**
     * Save PEQ settings to localStorage
     * @param {Object} settings - PEQ settings object to save
     */
    savePEQSettings(settings) {
        try {
            localStorage.setItem(this.PEQ_SETTINGS_KEY, JSON.stringify(settings));
            console.log('PEQ settings saved');
            return true;
        } catch (error) {
            console.error('Error saving PEQ settings:', error);
            return false;
        }
    }

    /**
     * Load PEQ settings from localStorage
     * @returns {Object} PEQ settings object or empty object if not found
     */
    loadPEQSettings() {
        try {
            const settings = localStorage.getItem(this.PEQ_SETTINGS_KEY);
            return settings ? JSON.parse(settings) : {};
        } catch (error) {
            console.error('Error loading PEQ settings:', error);
            return {};
        }
    }
}

// Export a singleton instance
const dataStorage = new DataStorage();
export default dataStorage;
