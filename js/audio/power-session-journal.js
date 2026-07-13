const IDENTITY_KEY = 'effetune_power_session_identity_v1';
const JOURNAL_KEY = 'effetune_power_transition_journals';

const JOURNAL_PHASES = new Set(['prepared', 'input-stopped', 'committed']);
const MANUAL_RELEASE_CAUSES = new Set([
    'player-only-retention-expired',
    'maximum-routed-input-silence'
]);
const RECORD_KEYS = Object.freeze([
    'version',
    'sessionId',
    'clientId',
    'operationId',
    'phase',
    'releaseCause',
    'releaseEligibility',
    'suspendCause',
    'policy',
    'inputConfigured',
    'inputGeneration',
    'manualResumeRequired',
    'createdAtEpochMs'
]);

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
    if (!isObject(value)) return false;
    const keys = Object.keys(value).sort();
    const wanted = [...expected].sort();
    return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function isIdentity(value) {
    return typeof value === 'string' && value.length > 0;
}

function isOperationId(value) {
    return isIdentity(value) || (Number.isSafeInteger(value) && value >= 0);
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function makeId(prefix, cryptoRef) {
    const uuid = cryptoRef?.randomUUID?.();
    if (isIdentity(uuid)) return `${prefix}-${uuid}`;
    if (typeof cryptoRef?.getRandomValues !== 'function') {
        throw new Error('Secure random number generation is unavailable');
    }
    const random = cryptoRef.getRandomValues(new Uint32Array(4));
    return `${prefix}-${[...random].map(value => value.toString(16).padStart(8, '0')).join('-')}`;
}

function validateIdentity(value) {
    return hasExactKeys(value, ['version', 'clientId', 'sessionId']) && value.version === 1 &&
        isIdentity(value.clientId) && isIdentity(value.sessionId);
}

export function validatePowerSessionJournalRecord(value) {
    if (!hasExactKeys(value, RECORD_KEYS) || value.version !== 1 ||
        !isIdentity(value.sessionId) || !isIdentity(value.clientId) ||
        !isOperationId(value.operationId) || !JOURNAL_PHASES.has(value.phase) ||
        !MANUAL_RELEASE_CAUSES.has(value.releaseCause) || !isObject(value.releaseEligibility) ||
        value.releaseEligibility.releaseCause !== value.releaseCause ||
        !(value.suspendCause === null || typeof value.suspendCause === 'string') ||
        typeof value.policy !== 'string' || typeof value.inputConfigured !== 'boolean' ||
        !Number.isSafeInteger(value.inputGeneration) || value.inputGeneration < 0 ||
        value.manualResumeRequired !== true || !Number.isFinite(value.createdAtEpochMs) ||
        value.createdAtEpochMs < 0) {
        return false;
    }
    return true;
}

export class PowerSessionJournal {
    constructor({
        storage = globalThis.sessionStorage,
        cryptoRef = globalThis.crypto,
        now = () => Date.now()
    } = {}) {
        this.storage = storage || null;
        this.cryptoRef = cryptoRef;
        this.now = now;
        this.state = this.storage ? 'unknown' : 'unavailable';
        this.errorCode = this.storage ? null : 'session-storage-unavailable';
        this.observedAtEpochMs = null;
        this.identity = {
            version: 1,
            clientId: makeId('client', cryptoRef),
            sessionId: makeId('session', cryptoRef)
        };
        this.records = new Map();
        this.currentOperationId = null;
        this._initialize();
    }

    _mark(state, errorCode = null) {
        this.state = state;
        this.errorCode = errorCode;
        this.observedAtEpochMs = this.now();
    }

    _initialize() {
        if (!this.storage) return;
        try {
            const storedIdentity = JSON.parse(this.storage.getItem(IDENTITY_KEY) || 'null');
            if (validateIdentity(storedIdentity)) this.identity = storedIdentity;
            else this.storage.setItem(IDENTITY_KEY, JSON.stringify(this.identity));

            const envelope = JSON.parse(this.storage.getItem(JOURNAL_KEY) || 'null');
            if (isObject(envelope) && envelope.version === 1 &&
                envelope.clientId === this.identity.clientId &&
                envelope.sessionId === this.identity.sessionId && Array.isArray(envelope.records)) {
                for (const record of envelope.records) {
                    if (!validatePowerSessionJournalRecord(record) ||
                        record.clientId !== this.identity.clientId ||
                        record.sessionId !== this.identity.sessionId) continue;
                    this.records.set(String(record.operationId), clone(record));
                }
            }
            this._persist();
            this._mark('available');
        } catch {
            this._mark('error', 'session-storage-read-failed');
        }
    }

    _persist() {
        if (!this.storage) throw new Error('sessionStorage is unavailable');
        const envelope = {
            version: 1,
            clientId: this.identity.clientId,
            sessionId: this.identity.sessionId,
            records: [...this.records.values()].map(clone)
        };
        this.storage.setItem(JOURNAL_KEY, JSON.stringify(envelope));
        const readback = JSON.parse(this.storage.getItem(JOURNAL_KEY) || 'null');
        if (!isObject(readback) || readback.clientId !== envelope.clientId ||
            readback.sessionId !== envelope.sessionId || !Array.isArray(readback.records) ||
            readback.records.length !== envelope.records.length) {
            throw new Error('session journal readback mismatch');
        }
    }

    prepare({
        operationId,
        releaseCause,
        releaseEligibility,
        suspendCause = null,
        policy,
        inputConfigured,
        inputGeneration,
        createdAtEpochMs = this.now()
    }) {
        const record = {
            version: 1,
            sessionId: this.identity.sessionId,
            clientId: this.identity.clientId,
            operationId,
            phase: 'prepared',
            releaseCause,
            releaseEligibility: clone(releaseEligibility),
            suspendCause,
            policy,
            inputConfigured,
            inputGeneration,
            manualResumeRequired: true,
            createdAtEpochMs
        };
        if (!validatePowerSessionJournalRecord(record)) {
            throw new TypeError('Invalid power session journal record');
        }
        if (this.state !== 'available') return null;
        try {
            this.records.set(String(operationId), record);
            this.currentOperationId = operationId;
            this._persist();
            this._mark('available');
            return clone(record);
        } catch {
            this.records.delete(String(operationId));
            this.currentOperationId = null;
            this._mark('error', 'session-storage-write-failed');
            return null;
        }
    }

    advance(operationId, phase) {
        if (!JOURNAL_PHASES.has(phase) || phase === 'prepared') return null;
        const key = String(operationId);
        const current = this.records.get(key);
        const allowed = current?.phase === 'prepared' && phase === 'input-stopped' ||
            current?.phase === 'input-stopped' && phase === 'committed';
        if (!current || !allowed || this.state !== 'available') return null;
        const updated = { ...current, phase };
        try {
            this.records.set(key, updated);
            this.currentOperationId = operationId;
            this._persist();
            this._mark('available');
            return clone(updated);
        } catch {
            this._mark('error', 'session-storage-write-failed');
            return null;
        }
    }

    restoreManualResumeRecord() {
        let latest = null;
        for (const record of this.records.values()) {
            if (!validatePowerSessionJournalRecord(record)) continue;
            if (!latest || record.createdAtEpochMs > latest.createdAtEpochMs) latest = record;
        }
        if (latest) this.currentOperationId = latest.operationId;
        return latest ? clone(latest) : null;
    }

    clear(operationId = this.currentOperationId) {
        if (operationId === null || this.state !== 'available') return false;
        const key = String(operationId);
        if (!this.records.has(key)) return false;
        const previous = this.records.get(key);
        try {
            this.records.delete(key);
            if (this.currentOperationId === operationId) this.currentOperationId = null;
            this._persist();
            this._mark('available');
            return true;
        } catch {
            this.records.set(key, previous);
            this._mark('error', 'session-storage-write-failed');
            return false;
        }
    }

    getStatus() {
        const current = this.currentOperationId === null
            ? null
            : this.records.get(String(this.currentOperationId));
        return {
            state: this.state,
            storage: 'session',
            clientId: this.identity.clientId,
            sessionId: this.identity.sessionId,
            journalPhase: current?.phase || null,
            observedAtEpochMs: this.observedAtEpochMs,
            errorCode: this.errorCode
        };
    }
}
