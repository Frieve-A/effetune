/**
 * Refit job: recomputes a speaker distortion model for a new Upper Limit from its stored records
 * (nothing is played). Refit, Check again, Save, and Rename share ownership of the result.
 */
import * as speakerDistortion from '../../../js/utils/measurement-dsp/speaker-distortion/index.js';
import dataStorage from '../dataStorage.js';

// Channel fields a refit result replaces.
const REPLACED_FIELDS = ['weights', 'on', 'reason', 'worst', 'power', 'figL', 'ref', 'report',
    'micDistortionWarning', 'ampRef', 'checkFig', 'odd', 'sweepResponse'];

const IDLE = Object.freeze({ status: 'idle', measurement: null, progress: [] });

let state = IDLE;
const listeners = new Set();
let activeOperation = null;

function setState(next) {
    state = next;
    for (const listener of listeners) listener(state);
}

export function getRefitState() {
    return state;
}

export function getSpeakerResultOperation() {
    return activeOperation;
}

export function isSpeakerResultBusy() {
    return activeOperation !== null;
}

/** Keeps the result owned until its writer and any cleanup have finished. */
export function startSpeakerResultOperation(kind, measurement, perform) {
    if (activeOperation) return null;
    const controller = new AbortController();
    const completion = Promise.resolve().then(() => perform(controller.signal)).finally(() => { activeOperation = null; });
    activeOperation = { kind, measurement, controller, completion };
    return activeOperation;
}

/** Repeated requests to save the same draft share one write. */
export function saveSpeakerResult(measurement, persist) {
    if (activeOperation?.kind === 'save' && activeOperation.measurement === measurement) {
        return activeOperation.completion;
    }
    const operation = startSpeakerResultOperation('save', measurement, persist);
    if (!operation) {
        return Promise.reject(new Error('The speaker distortion result is being updated.'));
    }
    return operation.completion;
}

/** Registers a state listener; returns the function that removes it. */
export function onRefitChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function cancelRefit() {
    if (activeOperation?.kind === 'refit') activeOperation.controller.abort();
}

/** True when `upperLimitHz` is a whole number within UPPER_LIMIT_RANGE_HZ. */
export function isValidUpperLimit(upperLimitHz, deps = speakerDistortion) {
    const [lo, hi] = deps.UPPER_LIMIT_RANGE_HZ;
    return Number.isInteger(upperLimitHz) && upperLimitHz >= lo && upperLimitHz <= hi;
}

/** Applies refit results to a model: a new model object, `lastCheck` kept. */
export function applyRefitResults(model, results, upperLimitHz, deps = speakerDistortion) {
    const next = {
        ...model,
        upperLimitHz,
        channels: model.channels.map((entry, index) => {
            const replaced = { ...entry };
            for (const field of REPLACED_FIELDS) replaced[field] = results[index][field];
            return replaced;
        })
    };
    next.recommendedLength = deps.recommendLength(next);
    const now = Date.now();
    next.revision = now > model.revision + 1 ? now : model.revision + 1;
    return next;
}

/**
 * Starts the refit of `measurement` (a saved record with `id`, or the unsaved in-memory record,
 * which is updated in place). Resolves with the final state.
 */
export async function startRefit(measurement, upperLimitHz, { store = dataStorage, deps = speakerDistortion } = {}) {
    if (state.status === 'running' || isSpeakerResultBusy() || !isValidUpperLimit(upperLimitHz, deps)) {
        return state;
    }
    const model = measurement.speakerModel;
    const progress = model.channels.map(() => ({ status: 'waiting', fraction: 0 }));
    const operation = startSpeakerResultOperation('refit', measurement, signal =>
        refitMeasurement(measurement, model, upperLimitHz, store, deps, signal));
    setState({ status: 'running', measurement, upperLimitHz, previousUpperLimitHz: model.upperLimitHz, progress });
    const status = await operation.completion;
    setState({ ...state, status, progress: status === 'done' ? progress.map(() => ({ status: 'done', fraction: 1 })) : state.progress });
    return state;
}

async function refitMeasurement(measurement, model, upperLimitHz, store, deps, signal) {
    try {
        signal.throwIfAborted();
        const results = await deps.refitSpeakerModel(model, upperLimitHz, {
            signal,
            onChannelProgress: (channelIndex, fraction) => {
                const rows = state.progress.map((row, index) => index < channelIndex
                    ? { status: 'done', fraction: 1 }
                    : index === channelIndex
                        ? { status: fraction >= 1 ? 'done' : 'percent', fraction }
                        : row);
                setState({ ...state, progress: rows });
            }
        });
        signal.throwIfAborted();
        const next = applyRefitResults(model, results, upperLimitHz, deps);
        if (measurement.id) {
            const stored = store.getMeasurementById(measurement.id);
            if (stored?.speakerModel?.revision !== model.revision) {
                console.warn('The measurement changed during the refit; the result was not written.');
                return 'failed';
            }
            if (!await store.updateMeasurement(measurement.id, { speakerModel: next })) {
                console.error('The refitted speaker model could not be written to storage.');
                return 'saveFailed';
            }
        } else {
            measurement.speakerModel = next;
        }
        return 'done';
    } catch (error) {
        if (signal.aborted) return 'cancelled';
        console.error('The speaker distortion refit failed:', error);
        return 'failed';
    }
}

/** Returns the job to idle once its end message is no longer needed. */
export function clearRefitState() {
    if (state.status !== 'running') setState(IDLE);
}
