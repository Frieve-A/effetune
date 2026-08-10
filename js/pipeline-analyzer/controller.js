import { openMeasurementStore } from '../measurement-store/client.js';
import { getPipelineAnalysisRequirements } from './analysis-requirements.js';
import { adaptPipelineAnalysisResult } from './result-adapter.js';
import {
    buildPipelineAnalyzerSnapshot,
    collectPipelineAnalyzerTransferables,
    getAnalyzerAudioFormat,
    PipelineSnapshotError,
    StalePipelineAnalysisRunError
} from './pipeline-snapshot.js';
import { getPipelineAnalyzerOutputCapacity } from './slot-policy.js';
import {
    PIPELINE_ANALYZER_MLS_LENGTHS,
    PIPELINE_ANALYZER_TSP_LENGTHS
} from './mls.js';

const STORAGE_KEY = 'effetune.pipelineAnalyzer.v1';
const DISPLAY_READAPT_DELAY_MS = 150;
const GRAPH_VIEWS = new Set(['frequency', 'phase', 'groupDelay', 'impulse']);
const MAX_OUTPUTS = 4;
const MLS_SEQUENCE_LENGTHS = new Set(PIPELINE_ANALYZER_MLS_LENGTHS);
const TSP_SEQUENCE_LENGTHS = new Set(PIPELINE_ANALYZER_TSP_LENGTHS);
const PERIODIC_SEQUENCE_LENGTHS = new Set([
    ...PIPELINE_ANALYZER_MLS_LENGTHS,
    ...PIPELINE_ANALYZER_TSP_LENGTHS
]);
const DEFAULT_MEASUREMENT_SETTINGS = Object.freeze({
    signalType: 'mls',
    levelDb: -12,
    sequenceLength: 65535,
    stabilizationPeriods: 12,
    averagingPeriods: 2
});
const DEFAULT_DISPLAY_SETTINGS = Object.freeze({
    smoothingOct: 0.17,
    impulseRangeMs: 6
});

function defaultOutputs() {
    return [{
        channel: 0,
        measurementId: null,
        pointId: null
    }];
}

function normalizeId(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeOutput(value, fallbackChannel) {
    return {
        channel: Number.isInteger(value?.channel) && value.channel >= 0
            ? value.channel
            : fallbackChannel,
        measurementId: normalizeId(value?.measurementId),
        pointId: normalizeId(value?.pointId)
    };
}

function clampInteger(value, minimum, maximum, fallback) {
    if (!Number.isFinite(value)) return fallback;
    const integer = Math.round(value);
    if (integer < minimum) return minimum;
    if (integer > maximum) return maximum;
    return integer;
}

function clampNumber(value, minimum, maximum, fallback, decimals) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    const clamped = number < minimum ? minimum : number > maximum ? maximum : number;
    const scale = 10 ** decimals;
    return Math.round(clamped * scale) / scale;
}

function normalizeDisplaySettings(value) {
    return {
        smoothingOct: clampNumber(value?.smoothingOct, 0.02, 1, DEFAULT_DISPLAY_SETTINGS.smoothingOct, 2),
        impulseRangeMs: clampNumber(value?.impulseRangeMs, 1, 50, DEFAULT_DISPLAY_SETTINGS.impulseRangeMs, 1)
    };
}

function normalizeMeasurementSettings(value) {
    const signalType = ['mls', 'tsp', 'impulse'].includes(value?.signalType)
        ? value.signalType
        : 'mls';
    const allowedLengths = signalType === 'tsp'
        ? TSP_SEQUENCE_LENGTHS
        : signalType === 'mls'
            ? MLS_SEQUENCE_LENGTHS
            : PERIODIC_SEQUENCE_LENGTHS;
    return {
        signalType,
        levelDb: clampInteger(value?.levelDb, -60, 0, DEFAULT_MEASUREMENT_SETTINGS.levelDb),
        sequenceLength: allowedLengths.has(value?.sequenceLength)
            ? value.sequenceLength
            : signalType === 'tsp' ? 65536 : DEFAULT_MEASUREMENT_SETTINGS.sequenceLength,
        stabilizationPeriods: clampInteger(
            value?.stabilizationPeriods,
            1,
            32,
            DEFAULT_MEASUREMENT_SETTINGS.stabilizationPeriods
        ),
        averagingPeriods: clampInteger(
            value?.averagingPeriods,
            1,
            8,
            DEFAULT_MEASUREMENT_SETTINGS.averagingPeriods
        )
    };
}

function outputsFromSavedState(value) {
    if (Array.isArray(value?.outputs)) return value.outputs;
    if (!Array.isArray(value?.slots)) return defaultOutputs();
    return value.slots.filter(slot => slot?.enabled === true);
}

export function normalizePipelineAnalyzerState(value) {
    const sourceOutputs = outputsFromSavedState(value);
    const graphView = value?.graphView ?? value?.view;
    return {
        open: value?.open === true,
        graphView: GRAPH_VIEWS.has(graphView) ? graphView : 'frequency',
        autoRefresh: value?.autoRefresh !== false,
        inputChannel: Number.isInteger(value?.inputChannel) && value.inputChannel >= 0
            ? value.inputChannel
            : 0,
        outputs: (sourceOutputs.length > 0 ? sourceOutputs : defaultOutputs())
            .slice(0, MAX_OUTPUTS)
            .map((output, index) => normalizeOutput(output, index)),
        measurementSettings: normalizeMeasurementSettings(
            value?.measurementSettings ?? value?.measurement
        ),
        displaySettings: normalizeDisplaySettings(value?.displaySettings)
    };
}

function reconcileStateWithFormat(state, format) {
    if (!format) return state;
    const capacity = getPipelineAnalyzerOutputCapacity(format.channelCount);
    const usedChannels = new Set();
    const outputs = [];
    for (const output of state.outputs) {
        if (outputs.length >= capacity || output.channel >= format.channelCount ||
            usedChannels.has(output.channel)) continue;
        usedChannels.add(output.channel);
        outputs.push(output);
    }
    if (outputs.length === 0) outputs.push(normalizeOutput(null, 0));
    const inputChannel = state.inputChannel < format.channelCount ? state.inputChannel : 0;
    if (inputChannel === state.inputChannel && outputs.length === state.outputs.length &&
        outputs.every((output, index) => output === state.outputs[index])) return state;
    return { ...state, inputChannel, outputs };
}

function freezeAcceptedResult(result) {
    return Object.freeze({
        ...result,
        before: result.before && typeof result.before === 'object'
            ? Object.freeze({ ...result.before })
            : result.before,
        after: result.after && typeof result.after === 'object'
            ? Object.freeze({ ...result.after })
            : result.after,
        measurement: result.measurement && typeof result.measurement === 'object'
            ? Object.freeze({ ...result.measurement })
            : result.measurement,
        measurementSettings: result.measurementSettings && typeof result.measurementSettings === 'object'
            ? Object.freeze({ ...result.measurementSettings })
            : result.measurementSettings,
        displaySettings: result.displaySettings && typeof result.displaySettings === 'object'
            ? Object.freeze({ ...result.displaySettings })
            : result.displaySettings
    });
}

function defaultWorkerFactory() {
    return new Worker(new URL('./analysis-worker.js', import.meta.url), {
        type: 'module'
    });
}

function hasParticipatingIrReference(configuration, channelCount) {
    return configuration.outputs.some(output =>
        Number.isInteger(output.channel) && output.channel >= 0 && output.channel < channelCount &&
        output.measurementId !== null && output.pointId !== null);
}

function sameAnalysisConfiguration(left, right) {
    if (left.inputChannel !== right.inputChannel) return false;
    if (left.outputs.length !== right.outputs.length) return false;
    if (Object.keys(DEFAULT_MEASUREMENT_SETTINGS).some(key =>
        left.measurementSettings[key] !== right.measurementSettings[key])) return false;
    return left.outputs.every((output, index) => {
        const other = right.outputs[index];
        return output.channel === other.channel &&
            output.measurementId === other.measurementId &&
            output.pointId === other.pointId;
    });
}

export class PipelineAnalyzerController {
    constructor(options = {}) {
        this.audioManager = options.audioManager;
        this.workletSync = options.workletSync;
        this.ui = options.ui || null;
        this.windowRef = options.windowRef || globalThis.window || null;
        this.consoleRef = options.consoleRef || globalThis.console;
        this.storage = options.storage === undefined ? globalThis.localStorage : options.storage;
        this.openMeasurementStore = options.openMeasurementStore || openMeasurementStore;
        this.snapshotBuilder = options.snapshotBuilder || buildPipelineAnalyzerSnapshot;
        this.resolveRequirements = options.resolveRequirements || getPipelineAnalysisRequirements;
        this.createWorker = options.createWorker || defaultWorkerFactory;
        this.debounceMs = Number.isFinite(options.debounceMs) && options.debounceMs >= 0
            ? options.debounceMs
            : 300;
        this.assetTimeoutMs = Number.isFinite(options.assetTimeoutMs) && options.assetTimeoutMs > 0
            ? options.assetTimeoutMs
            : 10000;
        this.resultAdapter = options.resultAdapter || adaptPipelineAnalysisResult;

        this.state = this._loadState();
        this.active = false;
        this.disposed = false;
        this.activationEpoch = 0;
        this.runGeneration = 0;
        this.activeWorker = null;
        this.debounceTimer = null;
        this.displayReadaptTimer = null;
        this.setDisplayReadaptTimeout = options.setDisplayReadaptTimeout ||
            ((callback, delay) => setTimeout(callback, delay));
        this.clearDisplayReadaptTimeout = options.clearDisplayReadaptTimeout ||
            (timer => clearTimeout(timer));
        this.measurementStore = null;
        this.measurementCatalog = [];
        this.storeOpeningPromise = null;
        this.lastAcceptedResult = null;
        this.lastAcceptedRawResult = null;
        this.lastAcceptedProvenance = null;
        this.lastAcceptedMetadata = null;
        this.lastAcceptedStale = false;
        this.audioDisposers = [];
        this.pluginDisposers = [];
        this.initialized = false;
        this.audioFormat = null;
        this.audioFormatPublished = false;
        this._activeDspPluginIdsKey = null;
        this._boundPageHide = () => this.deactivate();
        this._boundPageShow = () => {
            if (this.state.open) this.activate();
        };
    }

    initialize() {
        if (this.initialized || this.disposed) return;
        this.initialized = true;
        this.ui?.setConfiguration?.(this._configurationForUi());
        this.ui?.setOpen?.(this.state.open);
        this.refreshAudioFormat();
        this.windowRef?.addEventListener?.('pagehide', this._boundPageHide);
        this.windowRef?.addEventListener?.('pageshow', this._boundPageShow);
        if (this.state.open) this.activate();
    }

    setOpen(open) {
        if (this.disposed) return;
        const next = open === true;
        this.state.open = next;
        this._saveState();
        this.ui?.setOpen?.(next);
        if (next) this.activate();
        else this.deactivate();
    }

    setConfiguration(configuration, { displayCommit = true } = {}) {
        if (this.disposed) return;
        const previous = this.state;
        const next = reconcileStateWithFormat(normalizePipelineAnalyzerState({
            ...this.state,
            ...configuration,
            open: this.state.open
        }), this.audioFormat);
        this.state = next;
        this._saveState();
        this.ui?.setConfiguration?.(this._configurationForUi());
        if (!sameAnalysisConfiguration(previous, next)) {
            this._clearDisplayReadapt();
            this.invalidate('configuration');
        } else if (!previous.autoRefresh && next.autoRefresh) {
            this.invalidate('auto-enabled', { immediate: true });
        } else if (previous.displaySettings.smoothingOct !== next.displaySettings.smoothingOct ||
            previous.displaySettings.impulseRangeMs !== next.displaySettings.impulseRangeMs) {
            if (displayCommit) {
                this._clearDisplayReadapt();
                this._readaptLastAcceptedResult();
            } else {
                this._scheduleDisplayReadapt();
            }
        } else if (displayCommit && this.displayReadaptTimer !== null) {
            this._clearDisplayReadapt();
            this._readaptLastAcceptedResult();
        }
    }

    setGraphView(graphView) {
        if (!GRAPH_VIEWS.has(graphView)) return;
        this.state.graphView = graphView;
        this._saveState();
        this.ui?.setConfiguration?.(this._configurationForUi());
    }

    addOutput(output = null) {
        const capacity = this.audioFormat
            ? getPipelineAnalyzerOutputCapacity(this.audioFormat.channelCount)
            : MAX_OUTPUTS;
        if (this.state.outputs.length >= capacity) return false;
        const usedChannels = new Set(this.state.outputs.map(entry => entry.channel));
        let channel = Number.isInteger(output?.channel) ? output.channel : 0;
        const channelCount = this.audioFormat?.channelCount ?? MAX_OUTPUTS;
        while (usedChannels.has(channel) && channel < channelCount) channel += 1;
        if (channel < 0 || channel >= channelCount || usedChannels.has(channel)) return false;
        this.setConfiguration({
            outputs: [...this.state.outputs, normalizeOutput(output, channel)]
        });
        return true;
    }

    removeOutput(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.state.outputs.length ||
            this.state.outputs.length <= 1) return false;
        this.setConfiguration({
            outputs: this.state.outputs.filter((_, outputIndex) => outputIndex !== index)
        });
        return true;
    }

    activate() {
        if (this.disposed || this.active) return;
        this.active = true;
        const epoch = ++this.activationEpoch;
        this._activeDspPluginIdsKey = this._getActiveDspPluginIdsKey();
        this._subscribeAudioEvents();
        this._subscribeCurrentPlugins();
        this.refreshAudioFormat();
        this.ui?.setMeasurementStoreAvailable?.(false);
        this.ui?.setMeasurements?.([]);
        if (this.lastAcceptedResult) {
            this.lastAcceptedStale = true;
            this.ui?.setResult?.(this.lastAcceptedResult, { stale: true });
        }
        this.storeOpeningPromise = this._openStoreForActivation(epoch);
        this.invalidate('open', { immediate: true });
    }

    deactivate() {
        this._clearDisplayReadapt();
        if (!this.active && !this.storeOpeningPromise && !this.activeWorker) return;
        this.active = false;
        this.activationEpoch += 1;
        this.runGeneration += 1;
        this._clearDebounce();
        this._terminateActiveWorker();
        this._clearDisposers(this.pluginDisposers);
        this._clearDisposers(this.audioDisposers);
        this._activeDspPluginIdsKey = null;
        const store = this.measurementStore;
        this.measurementStore = null;
        this.storeOpeningPromise = null;
        store?.close?.();
    }

    dispose() {
        if (this.disposed) return;
        this.deactivate();
        this.disposed = true;
        this.windowRef?.removeEventListener?.('pagehide', this._boundPageHide);
        this.windowRef?.removeEventListener?.('pageshow', this._boundPageShow);
        this.ui?.dispose?.();
        this.ui = null;
    }

    invalidate(reason, options = {}) {
        if (!this.active || this.disposed) return;
        this._clearDisplayReadapt();
        const epoch = this.activationEpoch;
        const generation = ++this.runGeneration;
        this._clearDebounce();
        this._terminateActiveWorker();
        this.ui?.setMeasuring?.(true);
        if (this.lastAcceptedResult) {
            this.lastAcceptedStale = true;
            this.ui?.setResult?.(this.lastAcceptedResult, { stale: true });
        }
        const delay = options.immediate === true ? 0 : this.debounceMs;
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            void this._run({ activationEpoch: epoch, runGeneration: generation });
        }, delay);
    }

    async refreshMeasurements() {
        const epoch = this.activationEpoch;
        const store = this.measurementStore;
        if (!this.active) return false;
        if (!store) {
            this.invalidate('manual-refresh', { immediate: true });
            return true;
        }
        try {
            await store.refresh();
            if (!this._isActivationCurrent(epoch) || store !== this.measurementStore) return false;
            const catalog = await this._readMeasurementCatalog(store, epoch);
            if (!this._isActivationCurrent(epoch) || store !== this.measurementStore) return false;
            this.measurementCatalog = catalog;
            this.ui?.setMeasurements?.(catalog);
            this.invalidate('measurements-refreshed', { immediate: true });
            return true;
        } catch (error) {
            if (!this._isActivationCurrent(epoch) || store !== this.measurementStore) return false;
            this._reportRunError(new PipelineSnapshotError('measurement-refresh-failed', {
                cause: error
            }));
            return false;
        }
    }

    _loadState() {
        try {
            const saved = this.storage?.getItem?.(STORAGE_KEY);
            return normalizePipelineAnalyzerState(saved ? JSON.parse(saved) : null);
        } catch (_) {
            return normalizePipelineAnalyzerState(null);
        }
    }

    _saveState() {
        try {
            this.storage?.setItem?.(STORAGE_KEY, JSON.stringify(this.state));
        } catch (_) {
            // Analysis remains available when storage is blocked.
        }
    }

    _configurationForUi() {
        return {
            graphView: this.state.graphView,
            autoRefresh: this.state.autoRefresh,
            inputChannel: this.state.inputChannel,
            outputs: this.state.outputs.map(output => ({ ...output })),
            measurementSettings: { ...this.state.measurementSettings },
            displaySettings: { ...this.state.displaySettings }
        };
    }

    _configurationForRun() {
        const measurements = new Map(this.measurementCatalog.map(measurement => [
            measurement.id,
            measurement
        ]));
        return {
            inputChannel: this.state.inputChannel,
            outputs: this.state.outputs.map(output => {
                const measurement = measurements.get(output.measurementId);
                const point = measurement?.points?.find(entry => entry.id === output.pointId);
                return {
                    ...output,
                    measurementLabel: measurement?.name || null,
                    pointLabel: point?.label || null,
                    measurementStoreId: measurement?.storeId ?? output.measurementId,
                    pointStoreId: point?.storeId ?? output.pointId
                };
            }),
            measurementSettings: { ...this.state.measurementSettings }
        };
    }

    refreshAudioFormat() {
        const format = getAnalyzerAudioFormat(this.audioManager);
        const unchanged = this.audioFormat?.sampleRate === format?.sampleRate &&
            this.audioFormat?.channelCount === format?.channelCount;
        this.audioFormat = format;
        if (format) {
            const next = reconcileStateWithFormat(this.state, format);
            if (next !== this.state) {
                this.state = next;
                this._saveState();
                this.ui?.setConfiguration?.(this._configurationForUi());
            }
        }
        if (!unchanged || !this.audioFormatPublished) {
            this.ui?.setAudioFormat?.(format ? { ...format } : null);
            this.audioFormatPublished = true;
        }
        return format;
    }

    async _openStoreForActivation(epoch) {
        let localStore = null;
        try {
            localStore = await this.openMeasurementStore();
        } catch (error) {
            if (this._isActivationCurrent(epoch)) {
                this.consoleRef?.error?.('[Pipeline Analyzer] Measurement storage could not be opened:', error);
            }
        }
        if (!this._isActivationCurrent(epoch)) {
            localStore?.close?.();
            return null;
        }
        this.measurementStore = localStore || null;
        this.ui?.setMeasurementStoreAvailable?.(!!localStore);
        if (!localStore) {
            this.measurementCatalog = [];
            this.ui?.setMeasurements?.([]);
            this.invalidate('measurement-store-unavailable', { immediate: true });
            return null;
        }
        try {
            const catalog = await this._readMeasurementCatalog(localStore, epoch);
            if (!this._isActivationCurrent(epoch) || localStore !== this.measurementStore) return null;
            this.measurementCatalog = catalog;
            this.ui?.setMeasurements?.(catalog);
            this.invalidate('measurements-ready', { immediate: true });
            return localStore;
        } catch (error) {
            if (!this._isActivationCurrent(epoch) || localStore !== this.measurementStore) return null;
            this.consoleRef?.error?.('[Pipeline Analyzer] Measurements could not be read:', error);
            this.measurementStore = null;
            localStore.close?.();
            this.measurementCatalog = [];
            this.ui?.setMeasurementStoreAvailable?.(false);
            this.ui?.setMeasurements?.([]);
            this.invalidate('measurement-store-unavailable', { immediate: true });
            return null;
        }
    }

    async _readMeasurementCatalog(store, epoch) {
        const catalog = [];
        for (const summary of store.listMeasurements()) {
            const measurement = await store.getMeasurement(summary.id);
            if (!this._isActivationCurrent(epoch) || store !== this.measurementStore) {
                throw new StalePipelineAnalysisRunError();
            }
            const points = (Array.isArray(measurement?.points) ? measurement.points : [])
                .filter(point => point?.ir?.stored === true)
                .map((point, index) => ({
                    id: String(point.pointId ?? point.id ?? index),
                    storeId: point.pointId ?? point.id ?? index,
                    label: point.label || point.name || `Point ${index + 1}`
                }));
            catalog.push({
                ...summary,
                id: String(summary.id),
                storeId: summary.id,
                points
            });
        }
        return catalog;
    }

    _subscribeAudioEvents() {
        const listen = (name, callback) => {
            this.audioManager?.addEventListener?.(name, callback);
            this.audioDisposers.push(() => this.audioManager?.removeEventListener?.(name, callback));
        };
        listen('pipelineAnalysisInvalidated', event => {
            this.refreshAudioFormat();
            this._subscribeCurrentPlugins();
            this._handleAutomaticInvalidation(event?.reason || 'pipeline-change');
        });
        listen('pipelineChanged', () => {
            this.refreshAudioFormat();
            this._subscribeCurrentPlugins();
            this._handleAutomaticInvalidation('pipeline-selection');
        });
        listen('audioGraphRebuilt', () => {
            this.refreshAudioFormat();
            this._handleAutomaticInvalidation('audio-graph');
        });
        listen('dspExecutionState', () => {
            const nextKey = this._getActiveDspPluginIdsKey();
            if (nextKey === this._activeDspPluginIdsKey) return;
            this._activeDspPluginIdsKey = nextKey;
            this._handleAutomaticInvalidation('dsp-execution');
        });
    }

    _handleAutomaticInvalidation(reason) {
        if (this.state.autoRefresh) {
            this.invalidate(reason);
            return;
        }
        this._clearDisplayReadapt();
        this.runGeneration += 1;
        this._clearDebounce();
        this._terminateActiveWorker();
        this.lastAcceptedStale = false;
        this.ui?.setMeasuring?.(false);
    }

    _subscribeCurrentPlugins() {
        this._clearDisposers(this.pluginDisposers);
        const pipeline = typeof this.audioManager?.getCurrentPipeline === 'function'
            ? this.audioManager.getCurrentPipeline()
            : this.audioManager?.pipeline;
        for (const plugin of Array.isArray(pipeline) ? pipeline : []) {
            const subscribe = plugin?.addWasmAssetSnapshotChangeListener;
            if (typeof subscribe !== 'function') continue;
            const dispose = subscribe.call(plugin, () => this._handleAutomaticInvalidation('plugin-snapshot'));
            if (typeof dispose === 'function') this.pluginDisposers.push(dispose);
        }
    }

    _clearDisposers(disposers) {
        for (const dispose of disposers.splice(0)) {
            try {
                dispose();
            } catch (error) {
                this.consoleRef?.warn?.('[Pipeline Analyzer] Subscription cleanup failed:', error);
            }
        }
    }

    _isActivationCurrent(epoch) {
        return this.active && !this.disposed && this.activationEpoch === epoch;
    }

    _isRunCurrent(token) {
        return this._isActivationCurrent(token.activationEpoch) &&
            this.runGeneration === token.runGeneration;
    }

    _clearDebounce() {
        if (this.debounceTimer === null) return;
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
    }

    _scheduleDisplayReadapt() {
        if (!this.lastAcceptedRawResult || !this.lastAcceptedMetadata) return;
        this._clearDisplayReadapt();
        this.displayReadaptTimer = this.setDisplayReadaptTimeout(() => {
            this.displayReadaptTimer = null;
            if (!this.disposed) this._readaptLastAcceptedResult();
        }, DISPLAY_READAPT_DELAY_MS);
    }

    _clearDisplayReadapt() {
        if (this.displayReadaptTimer === null) return;
        this.clearDisplayReadaptTimeout(this.displayReadaptTimer);
        this.displayReadaptTimer = null;
    }

    _terminateActiveWorker() {
        const worker = this.activeWorker;
        if (!worker) return;
        this.activeWorker = null;
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate?.();
    }

    async _run(token) {
        if (!this._isRunCurrent(token)) return;
        const format = this.refreshAudioFormat();
        if (!format) return;
        try {
            if (hasParticipatingIrReference(this.state, format.channelCount) &&
                this.storeOpeningPromise) {
                await this.storeOpeningPromise;
                if (!this._isRunCurrent(token)) return;
            }
            const built = await this.snapshotBuilder({
                audioManager: this.audioManager,
                workletSync: this.workletSync,
                configuration: this._configurationForRun(),
                measurementStore: this.measurementStore,
                resolveRequirements: this.resolveRequirements,
                preferredWasmPluginIds: this._getPreferredWasmPluginIds(),
                assetTimeoutMs: this.assetTimeoutMs,
                isCurrent: () => this._isRunCurrent(token)
            });
            if (!this._isRunCurrent(token)) return;

            let localWorker = this.createWorker();
            if (!this._isRunCurrent(token)) {
                localWorker?.terminate?.();
                return;
            }
            this.activeWorker = localWorker;
            const worker = localWorker;
            localWorker = null;
            worker.onmessage = event => this._handleWorkerMessage(worker, token, built, event);
            worker.onerror = event => this._handleWorkerError(worker, token, event);
            if (!this._isRunCurrent(token) || this.activeWorker !== worker) {
                if (this.activeWorker === worker) this.activeWorker = null;
                worker.onmessage = null;
                worker.onerror = null;
                worker.terminate?.();
                return;
            }
            const request = {
                type: 'analyze',
                activationEpoch: token.activationEpoch,
                runGeneration: token.runGeneration,
                snapshot: built.snapshot,
                speakerResponses: built.speakerResponses
            };
            try {
                worker.postMessage(request, collectPipelineAnalyzerTransferables(request));
            } catch (error) {
                this._releaseWorker(worker);
                throw error;
            }
        } catch (error) {
            if (!this._isRunCurrent(token) || error instanceof StalePipelineAnalysisRunError ||
                error?.code === 'stale-run') return;
            this._reportRunError(error);
        }
    }

    _getPreferredWasmPluginIds() {
        const telemetry = this.audioManager?.getDspExecutionStateSnapshot?.();
        if (!Array.isArray(telemetry?.states)) return Object.freeze([]);
        return Object.freeze(telemetry.states
            .filter(entry => entry?.state === 'active' && Number.isInteger(entry.pluginId))
            .map(entry => entry.pluginId));
    }

    _getActiveDspPluginIdsKey() {
        return [...new Set(this._getPreferredWasmPluginIds())]
            .sort((left, right) => left - right)
            .join(',');
    }

    _handleWorkerMessage(worker, token, built, event) {
        if (!this._isRunCurrent(token) || this.activeWorker !== worker) return;
        const data = event?.data || {};
        if (data.activationEpoch !== undefined && data.activationEpoch !== token.activationEpoch) return;
        if (data.runGeneration !== undefined && data.runGeneration !== token.runGeneration) return;
        if (data.type === 'progress') return;
        if (data.type === 'error') {
            this._releaseWorker(worker);
            this._reportRunError(new PipelineSnapshotError(
                data.code || 'worker-failed',
                data.details && typeof data.details === 'object' ? data.details : {}
            ));
            return;
        }
        if (data.type !== 'result') return;
        this._releaseWorker(worker);
        if (!this._isRunCurrent(token)) return;
        let adapted;
        try {
            adapted = this.resultAdapter(data.result || data, {
                ...built.provenance,
                displaySettings: { ...this.state.displaySettings }
            });
        } catch (error) {
            this._reportRunError(error);
            return;
        }
        const rawResult = data.result || data;
        const metadata = Object.freeze({
            activationEpoch: token.activationEpoch,
            runGeneration: token.runGeneration,
            timestamp: Date.now()
        });
        const accepted = freezeAcceptedResult({
            ...adapted,
            ...metadata
        });
        if (!this._isRunCurrent(token)) return;
        this.lastAcceptedRawResult = rawResult;
        this.lastAcceptedProvenance = built.provenance;
        this.lastAcceptedMetadata = metadata;
        this.lastAcceptedResult = accepted;
        this.lastAcceptedStale = false;
        this.ui?.setResult?.(accepted, { stale: false });
    }

    _handleWorkerError(worker, token, event) {
        if (!this._isRunCurrent(token) || this.activeWorker !== worker) return;
        this._releaseWorker(worker);
        this._reportRunError(new PipelineSnapshotError('worker-failed', {
            cause: event?.error || event
        }));
    }

    _releaseWorker(worker) {
        if (this.activeWorker === worker) this.activeWorker = null;
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate?.();
    }

    _reportRunError(error) {
        const code = error?.code || 'analysis-failed';
        const details = error?.details && typeof error.details === 'object' ? error.details : {};
        this.consoleRef?.error?.('[Pipeline Analyzer] Analysis failed:', {
            code,
            details,
            error
        });
        this.lastAcceptedStale = false;
        this.ui?.setMeasuring?.(false);
    }

    _readaptLastAcceptedResult() {
        if (!this.lastAcceptedRawResult || !this.lastAcceptedMetadata) return;
        try {
            const adapted = this.resultAdapter(
                this.lastAcceptedRawResult,
                {
                    ...(this.lastAcceptedProvenance || {}),
                    displaySettings: { ...this.state.displaySettings }
                }
            );
            this.lastAcceptedResult = freezeAcceptedResult({
                ...adapted,
                ...this.lastAcceptedMetadata
            });
            this.ui?.setResult?.(this.lastAcceptedResult, { stale: this.lastAcceptedStale });
        } catch (error) {
            this.consoleRef?.error?.('[Pipeline Analyzer] Result presentation could not be updated:', error);
        }
    }

}

export {
    DEFAULT_MEASUREMENT_SETTINGS as PIPELINE_ANALYZER_DEFAULT_MEASUREMENT_SETTINGS,
    STORAGE_KEY as PIPELINE_ANALYZER_STORAGE_KEY
};
