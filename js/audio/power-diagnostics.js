export const POWER_DIAGNOSTICS_SCHEMA_VERSION = 1;

export const POWER_DIAGNOSTIC_COUNTER_KEYS = Object.freeze([
    'workletRenderBlocks',
    'detectorBlocks',
    'fullJsProcessBlocks',
    'fullWasmProcessBlocks',
    'telemetryReads',
    'telemetryPosts',
    'analyzerRafCallbacks',
    'pluginVisualRafCallbacks',
    'playerUiTicks',
    'playerPositionRafCallbacks',
    'inputReleaseTransactions',
    'inputTrackStops',
    'monitoringRuntimeFailures'
]);

export const POWER_DIAGNOSTICS_KEYS = Object.freeze([
    'schemaVersion',
    'counterEpoch',
    'effectiveCommitSequence',
    'workletGraphGeneration',
    'capturedAtEpochMs',
    'counters'
]);

const WORKLET_COUNTER_MAP = Object.freeze({
    renderQuanta: 'workletRenderBlocks',
    detectorQuanta: 'detectorBlocks',
    telemetryReads: 'telemetryReads',
    telemetryPosts: 'telemetryPosts',
    monitoringRuntimeFailures: 'monitoringRuntimeFailures'
});

function createCounters() {
    return Object.fromEntries(POWER_DIAGNOSTIC_COUNTER_KEYS.map(key => [key, 0]));
}

function normalizeWorkletOptions(options) {
    if (typeof options === 'string') return { runtime: options };
    return options && typeof options === 'object' ? options : {};
}

function readCounter(counters, key) {
    const value = counters?.[key];
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export class PowerDiagnostics {
    constructor(now = () => Date.now()) {
        this._now = now;
        this._counterEpoch = 1;
        this._effectiveCommitSequence = 0;
        this._workletGraphGeneration = 0;
        this._counters = createCounters();
        this._workletSources = new Map();
    }

    increment(key, delta = 1) {
        if (!POWER_DIAGNOSTIC_COUNTER_KEYS.includes(key)) return false;
        if (!Number.isSafeInteger(delta) || delta < 0) return false;
        this._counters[key] += delta;
        return true;
    }

    mergeWorkletCounters(counters, options = {}) {
        if (!counters || typeof counters !== 'object') return false;
        const normalized = normalizeWorkletOptions(options);
        const runtime = normalized.runtime === 'wasm' ? 'wasm' : 'js';
        const generation = Number.isSafeInteger(normalized.workletGraphGeneration) &&
            normalized.workletGraphGeneration >= 0
            ? normalized.workletGraphGeneration
            : this._workletGraphGeneration;
        const sourceId = normalized.sourceId == null ? 'primary' : String(normalized.sourceId);
        const sourceKey = sourceId;
        const previous = this._workletSources.get(sourceKey);
        const current = {};

        for (const sourceCounter of Object.keys(WORKLET_COUNTER_MAP)) {
            current[sourceCounter] = readCounter(counters, sourceCounter);
        }
        const hasSplitRuntimeCounters = Object.prototype.hasOwnProperty.call(
            counters,
            'fullJsProcessQuanta'
        ) || Object.prototype.hasOwnProperty.call(counters, 'fullWasmProcessQuanta');
        current.fullJsProcessQuanta = hasSplitRuntimeCounters
            ? readCounter(counters, 'fullJsProcessQuanta')
            : (runtime === 'js' ? readCounter(counters, 'fullProcessQuanta') : 0);
        current.fullWasmProcessQuanta = hasSplitRuntimeCounters
            ? readCounter(counters, 'fullWasmProcessQuanta')
            : (runtime === 'wasm' ? readCounter(counters, 'fullProcessQuanta') : 0);

        const sameGeneration = previous?.workletGraphGeneration === generation;
        for (const [sourceCounter, publicCounter] of Object.entries(WORKLET_COUNTER_MAP)) {
            const priorValue = sameGeneration ? previous.counters[sourceCounter] : 0;
            const currentValue = current[sourceCounter];
            this._counters[publicCounter] += currentValue >= priorValue
                ? currentValue - priorValue
                : currentValue;
        }
        for (const [sourceCounter, publicCounter] of [
            ['fullJsProcessQuanta', 'fullJsProcessBlocks'],
            ['fullWasmProcessQuanta', 'fullWasmProcessBlocks']
        ]) {
            const priorValue = sameGeneration ? previous.counters[sourceCounter] : 0;
            const currentValue = current[sourceCounter];
            this._counters[publicCounter] += currentValue >= priorValue
                ? currentValue - priorValue
                : currentValue;
        }

        this._workletSources.set(sourceKey, {
            workletGraphGeneration: generation,
            counters: current
        });
        if (generation > this._workletGraphGeneration) this._workletGraphGeneration = generation;
        return true;
    }

    recordEffectiveCommit(workletGraphGeneration = this._workletGraphGeneration) {
        if (!Number.isSafeInteger(workletGraphGeneration) || workletGraphGeneration < 0) {
            return false;
        }
        this._effectiveCommitSequence++;
        this._workletGraphGeneration = workletGraphGeneration;
        return true;
    }

    beginEpoch({ workletGraphGeneration = this._workletGraphGeneration } = {}) {
        if (!Number.isSafeInteger(workletGraphGeneration) || workletGraphGeneration < 0) {
            throw new RangeError('workletGraphGeneration must be a nonnegative safe integer');
        }
        this._counterEpoch++;
        this._effectiveCommitSequence = 0;
        this._workletGraphGeneration = workletGraphGeneration;
        this._counters = createCounters();
        this._workletSources.clear();
        return this._counterEpoch;
    }

    getSnapshot() {
        return Object.freeze({
            schemaVersion: POWER_DIAGNOSTICS_SCHEMA_VERSION,
            counterEpoch: this._counterEpoch,
            effectiveCommitSequence: this._effectiveCommitSequence,
            workletGraphGeneration: this._workletGraphGeneration,
            capturedAtEpochMs: this._now(),
            counters: Object.freeze({ ...this._counters })
        });
    }
}
