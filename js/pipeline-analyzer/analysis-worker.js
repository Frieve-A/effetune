import {
    ANALYSIS_QUANTUM_SIZE,
    ANALYSIS_TAIL_WINDOW_SAMPLES,
    alignToQuantum,
    areRouteTailsSettled,
    buildAnalysisResult,
    calculatePeriodResidualDb,
    periodicResidualNeedsWarning,
    recoverMlsImpulseResponse,
    recoverTspImpulseResponse
} from './analysis-core.js';
import {
    generateMlsSequence,
    levelDbToAmplitude,
    normalizeMeasurementSettings,
    PIPELINE_ANALYZER_MLS_LENGTHS,
    PIPELINE_ANALYZER_TSP_LENGTHS
} from './mls.js';
import { generateTspSequence } from './tsp.js';

const PREPARATION_TIMEOUT_MS = 10000;
const WORKLET_PROCESSOR_URL = new URL('../../plugins/audio-processor.js', import.meta.url).href;

let capturedProcessorClass = null;
let activePortFactory = null;

class AnalysisWorkerError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'AnalysisWorkerError';
        this.code = code;
    }
}

class AnalyzerWorkletPort {
    constructor(onPost) {
        this.onmessage = null;
        this.onPost = onPost;
    }

    postMessage(message, transfer = []) {
        this.onPost(message, transfer);
    }
}

class AnalyzerAudioWorkletProcessor {
    constructor() {
        if (typeof activePortFactory !== 'function') {
            throw new Error('Analyzer worklet port is not initialized');
        }
        this.port = activePortFactory();
    }
}

function installWorkletGlobals(sampleRate) {
    if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
        throw new TypeError('Analyzer sample rate must be a positive integer');
    }
    globalThis.sampleRate = sampleRate;
    globalThis.currentTime = 0;
    globalThis.AudioWorkletProcessor = AnalyzerAudioWorkletProcessor;
    globalThis.registerProcessor = (name, constructor) => {
        if (name === 'plugin-processor') capturedProcessorClass = constructor;
    };
}

function messageKey(pluginId, slot) {
    return `${pluginId}:${slot}`;
}

function latestMessage(messages, predicate) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (predicate(messages[index])) return messages[index];
    }
    return null;
}

export class PluginProcessorHost {
    constructor(ProcessorClass, options = {}) {
        this.messages = [];
        this.waiters = new Set();
        activePortFactory = () => new AnalyzerWorkletPort(
            (message, transfer) => this.handleProcessorMessage(message, transfer)
        );
        try {
            this.processor = new ProcessorClass({
                processorOptions: {
                    initialOutputChannelCount: options.channelCount,
                    lowLatencyMode: true
                }
            });
            this.processor.audioLevelMonitoring.SILENCE_DURATION = Number.POSITIVE_INFINITY;
            this.processor.audioLevelMonitoring.isSleepMode = false;
        } finally {
            activePortFactory = null;
        }
    }

    handleProcessorMessage(message, transfer = []) {
        this.messages.push(message);
        if (message?.type === 'dspTelemetry' && message.packet instanceof ArrayBuffer) {
            queueMicrotask(() => this.send({ type: 'dspTelemetryReturn', packet: message.packet }));
        }
        for (const waiter of [...this.waiters]) {
            if (!waiter.predicate(message)) continue;
            this.waiters.delete(waiter);
            clearTimeout(waiter.timer);
            waiter.resolve(message);
        }
        return transfer;
    }

    send(message) {
        this.processor.port.onmessage({ data: message });
    }

    waitFor(predicate, timeoutMs = PREPARATION_TIMEOUT_MS) {
        const existing = latestMessage(this.messages, predicate);
        if (existing) return Promise.resolve(existing);
        return new Promise((resolve, reject) => {
            const waiter = {
                predicate,
                resolve,
                timer: setTimeout(() => {
                    this.waiters.delete(waiter);
                    reject(new Error('Processor preparation timed out'));
                }, timeoutMs)
            };
            this.waiters.add(waiter);
        });
    }

    processBlock(inputChannels) {
        const channelCount = inputChannels.length;
        const outputChannels = Array.from(
            { length: channelCount },
            () => new Float32Array(ANALYSIS_QUANTUM_SIZE)
        );
        const keepAlive = this.processor.process([[...inputChannels]], [[...outputChannels]], {});
        if (keepAlive !== true) throw new Error('Shared processor stopped during analysis');
        return outputChannels;
    }

    processZeroBlock(channelCount) {
        return this.processBlock(Array.from(
            { length: channelCount },
            () => new Float32Array(ANALYSIS_QUANTUM_SIZE)
        ));
    }
}

export async function createPluginProcessorHost(sampleRate, channelCount) {
    if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 8) {
        throw new TypeError('Analyzer channel count must be between one and eight');
    }
    installWorkletGlobals(sampleRate);
    if (!capturedProcessorClass) await import(WORKLET_PROCESSOR_URL);
    if (!capturedProcessorClass) throw new Error('Shared plugin processor did not register');
    return new PluginProcessorHost(capturedProcessorClass, { channelCount });
}

function validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('Analyzer snapshot is missing');
    const { sampleRate, channelCount, inputChannel, outputChannels } = snapshot;
    if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
        throw new TypeError('Analyzer sample rate is invalid');
    }
    if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 8) {
        throw new TypeError('Analyzer channel count is invalid');
    }
    if (!Number.isInteger(inputChannel) || inputChannel < 0 || inputChannel >= channelCount) {
        throw new TypeError('Analyzer input channel is invalid');
    }
    if (!Array.isArray(outputChannels) || outputChannels.length < 1 || outputChannels.length > 4 ||
        new Set(outputChannels).size !== outputChannels.length ||
        outputChannels.some(channel => !Number.isInteger(channel) || channel < 0 || channel >= channelCount)) {
        throw new TypeError('Analyzer output channels are invalid');
    }
    if (!Array.isArray(snapshot.plugins) || !Array.isArray(snapshot.processors)) {
        throw new TypeError('Analyzer pipeline snapshot is invalid');
    }
    const normalizedMeasurement = normalizeMeasurementSettings(snapshot.measurementSettings);
    if (!snapshot.measurementSettings || Object.entries(normalizedMeasurement).some(
        ([key, value]) => snapshot.measurementSettings[key] !== value
    )) {
        throw new TypeError('Analyzer measurement settings are invalid');
    }
    const warmupSamples = snapshot.warmupSamples ?? 0;
    if (!Number.isSafeInteger(warmupSamples) || warmupSamples < 0 ||
        warmupSamples % ANALYSIS_QUANTUM_SIZE !== 0) {
        throw new TypeError('Analyzer warm-up must be a whole number of processing quanta');
    }
}

async function prepareProcessor(host, snapshot) {
    const { channelCount, sampleRate } = snapshot;
    host.send({
        type: 'updateAudioConfig',
        outputChannels: channelCount,
        sampleRate,
        lowLatencyMode: true
    });
    for (const registration of snapshot.processors) {
        if (!registration || typeof registration.pluginType !== 'string' ||
            typeof registration.processor !== 'string') {
            throw new TypeError('Analyzer processor registration is invalid');
        }
        host.send({ type: 'registerProcessor', ...registration });
    }

    const dsp = snapshot.dsp;
    if (dsp) {
        if (!(dsp.module instanceof WebAssembly.Module) && !(dsp.bytes instanceof ArrayBuffer)) {
            throw new TypeError('Analyzer DSP module is invalid');
        }
        host.send({
            type: 'dspModule',
            ...(dsp.module instanceof WebAssembly.Module
                ? { module: dsp.module }
                : { bytes: dsp.bytes }),
            simd: dsp.simd === true
        });
        await host.waitFor(message => message?.type === 'dspReady');
    }

    const enabledTypes = Array.isArray(dsp?.enabledTypes)
        ? dsp.enabledTypes
        : Array.isArray(snapshot.preferredWasmTypes) ? snapshot.preferredWasmTypes : [];
    host.send({ type: 'dspEnableTypes', types: enabledTypes });
    host.send({
        type: 'updatePlugins',
        plugins: snapshot.plugins,
        masterBypass: snapshot.masterBypass === true
    });
    const assets = Array.isArray(snapshot.assets) ? snapshot.assets : [];
    for (const asset of assets) host.send({ type: 'setPluginAsset', ...asset });

    const requiredWasmPluginIds = new Set(snapshot.requiredWasmPluginIds || []);
    const preferredWasmPluginIds = new Set(snapshot.preferredWasmPluginIds || []);
    if (requiredWasmPluginIds.size > 0 && !dsp) {
        throw new AnalysisWorkerError(
            'wasm-unavailable',
            'A required WebAssembly processor is unavailable'
        );
    }
    const requiredAssets = new Set(assets.map(asset => messageKey(asset.pluginId, asset.slot)));
    const ready = () => {
        for (const pluginId of requiredWasmPluginIds) {
            const state = latestMessage(host.messages, message =>
                message?.type === 'dspExecutionState' && message.pluginId === pluginId
            );
            if (state?.state !== 'active') return false;
        }
        for (const key of requiredAssets) {
            const state = latestMessage(host.messages, message =>
                message?.type === 'assetState' &&
                messageKey(message.pluginId, message.slot) === key
            );
            if ((state?.state & 0xff) !== 3) return false;
        }
        for (const pluginId of preferredWasmPluginIds) {
            const state = latestMessage(host.messages, message =>
                message?.type === 'dspExecutionState' && message.pluginId === pluginId
            );
            if (!state || !['active', 'bypassed'].includes(state.state)) return false;
        }
        return true;
    };
    const deadline = performance.now() + PREPARATION_TIMEOUT_MS;
    while (!ready()) {
        if (performance.now() >= deadline) {
            const execution = [...requiredWasmPluginIds].map(pluginId => {
                const state = latestMessage(host.messages, message =>
                    message?.type === 'dspExecutionState' && message.pluginId === pluginId
                );
                return `${pluginId}:${state?.state || 'missing'}:${state?.reason || ''}`;
            });
            const assetStates = [...requiredAssets].map(key => {
                const state = latestMessage(host.messages, message =>
                    message?.type === 'assetState' &&
                    messageKey(message.pluginId, message.slot) === key
                );
                return `${key}:${state?.state ?? 'missing'}`;
            });
            throw new AnalysisWorkerError(
                'preparation-timeout',
                `Processor or asset preparation timed out (${execution.join(', ')}; ` +
                `${assetStates.join(', ')}; pipeline=${host.processor.dspPipelineReady}; ` +
                `dsp=${host.processor.dspLive})`
            );
        }
        host.processZeroBlock(channelCount);
        await Promise.resolve();
        const failed = latestMessage(host.messages, message =>
            (message?.type === 'dspExecutionState' && requiredWasmPluginIds.has(message.pluginId) &&
                message.state === 'bypassed') ||
            (message?.type === 'assetLoadRejected' &&
                requiredAssets.has(messageKey(message.pluginId, message.slot)))
        );
        if (failed) {
            throw new AnalysisWorkerError(
                'required-dsp-failed',
                'A required WebAssembly processor or asset was rejected'
            );
        }
    }
    const warnings = [];
    for (const pluginId of preferredWasmPluginIds) {
        const state = latestMessage(host.messages, message =>
            message?.type === 'dspExecutionState' && message.pluginId === pluginId
        );
        if (state?.state !== 'active') {
            warnings.push({
                code: 'optional-wasm-fallback',
                details: { pluginId, reason: state?.reason || 'unavailable' }
            });
        }
    }
    return warnings;
}

async function resetProcessorState(host) {
    const requestId = 1;
    host.send({ type: 'resetProcessingState', requestId });
    const acknowledgement = await host.waitFor(message =>
        message?.type === 'processingStateReset' && message.requestId === requestId
    );
    if (acknowledgement.ok !== true) {
        throw new AnalysisWorkerError('reset-failed', 'Processor state could not be reset');
    }
}

async function queryReportedLatency(host) {
    const requestId = 2;
    host.send({ type: 'requestDspLatency', requestId });
    const response = await host.waitFor(message =>
        message?.type === 'dspLatencyResponse' && message.requestId === requestId
    );
    return Number.isSafeInteger(response.samples) && response.samples > 0 ? response.samples : 0;
}

function postProgress(post, token, phase, processedSamples = 0, totalSamples = 0) {
    post({
        type: 'progress',
        activationEpoch: token.activationEpoch,
        runGeneration: token.runGeneration,
        phase,
        processedSamples,
        totalSamples
    });
}

function assertFiniteSelectedOutput(output, outputChannels, frameCount = ANALYSIS_QUANTUM_SIZE) {
    for (const channel of outputChannels) {
        const routeOutput = output[channel];
        for (let frame = 0; frame < frameCount; frame += 1) {
            if (!Number.isFinite(routeOutput[frame])) {
                throw new AnalysisWorkerError(
                    'non-finite-output',
                    'The pipeline produced invalid numeric output'
                );
            }
        }
    }
}

function fillPeriodicInput(target, excitation, processedSamples) {
    const sequenceOffset = processedSamples % excitation.length;
    const available = excitation.length - sequenceOffset;
    if (available >= target.length) {
        target.set(excitation.subarray(sequenceOffset, sequenceOffset + target.length));
        return;
    }
    target.set(excitation.subarray(sequenceOffset));
    target.set(excitation.subarray(0, target.length - available), available);
}

function warning(code, details = {}) {
    return { code, details };
}

export function recommendPeriodicSequenceLength(signalType, knownSpanSamples, currentSequenceLength) {
    if (signalType !== 'mls' && signalType !== 'tsp') {
        throw new TypeError('Periodic recommendation requires MLS or TSP');
    }
    const allowedLengths = signalType === 'tsp'
        ? PIPELINE_ANALYZER_TSP_LENGTHS
        : PIPELINE_ANALYZER_MLS_LENGTHS;
    return allowedLengths.find(length =>
        length > currentSequenceLength &&
        knownSpanSamples <= length - ANALYSIS_TAIL_WINDOW_SAMPLES
    ) || null;
}

export function recommendMlsSequenceLength(knownSpanSamples, currentSequenceLength) {
    return recommendPeriodicSequenceLength('mls', knownSpanSamples, currentSequenceLength);
}

function buildMeasurementMetadata(settings, sampleRate, diagnostics = {}) {
    const base = { ...settings };
    if (settings.signalType === 'impulse') return Object.freeze(base);
    return Object.freeze({
        ...base,
        stabilizationSeconds: settings.stabilizationPeriods * settings.sequenceLength / sampleRate,
        totalStimulusSeconds: (settings.stabilizationPeriods + settings.averagingPeriods) *
            settings.sequenceLength / sampleRate,
        ...diagnostics
    });
}

function measureImpulse(host, snapshot, settings, post, token) {
    const amplitude = levelDbToAmplitude(settings.levelDb);
    const captureLength = alignToQuantum(settings.sequenceLength);
    const captured = snapshot.outputChannels.map(() => new Float32Array(captureLength));
    let capturedLength = 0;
    postProgress(post, token, 'measuring', 0, captureLength);

    while (capturedLength < captureLength) {
        const input = Array.from(
            { length: snapshot.channelCount },
            () => new Float32Array(ANALYSIS_QUANTUM_SIZE)
        );
        if (capturedLength === 0) input.at(snapshot.inputChannel).fill(amplitude, 0, 1);
        const output = host.processBlock(input);
        assertFiniteSelectedOutput(output, snapshot.outputChannels);
        for (let route = 0; route < snapshot.outputChannels.length; route += 1) {
            const routeOutput = output[snapshot.outputChannels[route]];
            for (let frame = 0; frame < routeOutput.length; frame += 1) {
                captured[route][capturedLength + frame] = routeOutput[frame] / amplitude;
            }
        }
        capturedLength += ANALYSIS_QUANTUM_SIZE;
        if ((capturedLength / ANALYSIS_QUANTUM_SIZE) % 128 === 0 || capturedLength === captureLength) {
            postProgress(post, token, 'measuring', capturedLength, captureLength);
        }
    }
    return {
        pipelineResponses: captured,
        truncated: !areRouteTailsSettled(captured),
        measurement: buildMeasurementMetadata(settings, snapshot.sampleRate),
        warnings: []
    };
}

function measurePeriodic(host, snapshot, settings, reportedLatency, post, token) {
    const amplitude = levelDbToAmplitude(settings.levelDb);
    const tsp = settings.signalType === 'tsp'
        ? generateTspSequence(settings.sequenceLength, amplitude)
        : null;
    const excitation = tsp?.sequence || generateMlsSequence(settings.sequenceLength, amplitude);
    const conditioningSamples = settings.stabilizationPeriods * settings.sequenceLength;
    const captureSamples = settings.averagingPeriods * settings.sequenceLength;
    const totalSamples = conditioningSamples + captureSamples;
    const means = snapshot.outputChannels.map(
        () => new Float64Array(settings.sequenceLength)
    );
    const deviations = snapshot.outputChannels.map(
        () => new Float64Array(settings.sequenceLength)
    );
    const input = Array.from(
        { length: snapshot.channelCount },
        () => new Float32Array(ANALYSIS_QUANTUM_SIZE)
    );
    postProgress(post, token, 'measuring', 0, totalSamples);
    for (let processed = 0; processed < totalSamples; processed += ANALYSIS_QUANTUM_SIZE) {
        const selectedInput = input.at(snapshot.inputChannel);
        fillPeriodicInput(selectedInput, excitation, processed);
        const output = host.processBlock(input);
        const validFrames = totalSamples - processed < ANALYSIS_QUANTUM_SIZE
            ? totalSamples - processed
            : ANALYSIS_QUANTUM_SIZE;
        assertFiniteSelectedOutput(output, snapshot.outputChannels, validFrames);
        for (let frame = 0; frame < validFrames; frame += 1) {
            const absolute = processed + frame;
            if (absolute < conditioningSamples) continue;
            const captured = absolute - conditioningSamples;
            const periodIndex = Math.floor(captured / settings.sequenceLength);
            const position = captured % settings.sequenceLength;
            const count = periodIndex + 1;
            for (let route = 0; route < snapshot.outputChannels.length; route += 1) {
                const sample = output[snapshot.outputChannels[route]][frame];
                const delta = sample - means[route][position];
                means[route][position] += delta / count;
                deviations[route][position] += delta * (sample - means[route][position]);
            }
        }
        const completed = processed + validFrames;
        if ((processed / ANALYSIS_QUANTUM_SIZE) % 128 === 0 || completed === totalSamples) {
            postProgress(post, token, 'measuring', completed, totalSamples);
        }
    }

    const assetSupportSamples = Number.isSafeInteger(snapshot.assetSupportSamples) &&
        snapshot.assetSupportSamples >= 1 ? snapshot.assetSupportSamples : 1;
    const knownSpanSamples = assetSupportSamples > reportedLatency + 1
        ? assetSupportSamples
        : reportedLatency + 1;
    const recommendedStabilizationPeriods = Math.max(
        1,
        Math.ceil(knownSpanSamples / settings.sequenceLength),
        Math.ceil(4 * snapshot.sampleRate / settings.sequenceLength)
    );
    const warnings = [];
    if (settings.stabilizationPeriods < recommendedStabilizationPeriods) {
        warnings.push(warning('insufficient-stabilization', {
            selectedPeriods: settings.stabilizationPeriods,
            recommendedPeriods: recommendedStabilizationPeriods
        }));
    }
    const pipelineResponses = [];
    const routeDiagnostics = [];
    const supportOverlapRoutes = [];
    const unsettledRoutes = [];
    let maximumResidualDb = null;
    for (let route = 0; route < means.length; route += 1) {
        const meanPeriod = means[route];
        const periodDeviations = deviations[route];
        const residualDb = calculatePeriodResidualDb(
            meanPeriod,
            periodDeviations,
            settings.averagingPeriods
        );
        if (residualDb !== null &&
            (maximumResidualDb === null || residualDb > maximumResidualDb)) {
            maximumResidualDb = residualDb;
        }
        if (periodicResidualNeedsWarning(residualDb)) {
            warnings.push(warning('period-residual', { route, residualDb }));
        }
        const recovered = tsp
            ? recoverTspImpulseResponse(meanPeriod, tsp.inverse, {
                signalGain: tsp.signalGain,
                knownSpanSamples
            })
            : recoverMlsImpulseResponse(meanPeriod, excitation, {
                amplitude,
                knownSpanSamples
            });
        means[route] = null;
        deviations[route] = null;
        pipelineResponses.push(recovered.impulse);
        routeDiagnostics.push({ route, residualDb, ...recovered.diagnostics });
        if (recovered.diagnostics.supportOverlapsWindow) {
            supportOverlapRoutes.push(route);
        }
        if (!recovered.diagnostics.boundarySettled) {
            unsettledRoutes.push(route);
        }
    }
    const needsLongerSequence = supportOverlapRoutes.length > 0 ||
        unsettledRoutes.length > 0 || knownSpanSamples >= settings.sequenceLength;
    const recommendedLength = needsLongerSequence
        ? recommendPeriodicSequenceLength(
            settings.signalType,
            knownSpanSamples,
            settings.sequenceLength
        )
        : null;
    for (const route of supportOverlapRoutes) {
        warnings.push(warning('sequence-too-short', {
            route,
            knownSpanSamples,
            currentSupportSamples: settings.sequenceLength,
            recommendedSequenceLength: recommendedLength
        }));
    }
    for (const route of unsettledRoutes) {
        warnings.push(warning('possible-circular-alias', {
            route,
            recommendedSequenceLength: recommendedLength
        }));
    }
    if (knownSpanSamples >= settings.sequenceLength && supportOverlapRoutes.length === 0) {
        warnings.push(warning('sequence-too-short', {
            knownSpanSamples,
            currentSupportSamples: settings.sequenceLength,
            recommendedSequenceLength: recommendedLength
        }));
    }
    return {
        pipelineResponses,
        truncated: false,
        warnings,
        measurement: buildMeasurementMetadata(settings, snapshot.sampleRate, {
            assetSupportSamples,
            knownSpanSamples,
            recommendedSequenceLength: recommendedLength,
            recommendedStabilizationPeriods,
            periodResidualDb: maximumResidualDb,
            routeDiagnostics
        })
    };
}

export async function runAnalysisRequest(request, post = () => {}) {
    const snapshot = request?.snapshot;
    validateSnapshot(snapshot);
    const token = {
        activationEpoch: request.activationEpoch,
        runGeneration: request.runGeneration
    };
    postProgress(post, token, 'preparing');
    const host = await createPluginProcessorHost(snapshot.sampleRate, snapshot.channelCount);
    const preparationWarnings = await prepareProcessor(host, snapshot);
    await resetProcessorState(host);

    for (let processed = 0; processed < (snapshot.warmupSamples || 0);
        processed += ANALYSIS_QUANTUM_SIZE) {
        host.processZeroBlock(snapshot.channelCount);
    }

    const reportedLatency = await queryReportedLatency(host);
    const settings = normalizeMeasurementSettings(snapshot.measurementSettings);
    const measured = settings.signalType === 'impulse'
        ? measureImpulse(host, snapshot, settings, post, token)
        : measurePeriodic(host, snapshot, settings, reportedLatency, post, token);

    return buildAnalysisResult({
        pipelineResponses: measured.pipelineResponses,
        speakerResponses: request.speakerResponses,
        outputChannels: snapshot.outputChannels,
        sampleRate: snapshot.sampleRate,
        reportedLatency,
        truncated: measured.truncated,
        measurement: measured.measurement,
        warnings: [...preparationWarnings, ...measured.warnings]
    });
}

function collectTransferBuffers(value, buffers = new Set()) {
    if (ArrayBuffer.isView(value)) {
        buffers.add(value.buffer);
    } else if (value && typeof value === 'object') {
        for (const child of Object.values(value)) collectTransferBuffers(child, buffers);
    }
    return [...buffers];
}

export function installAnalysisWorker(scope = globalThis) {
    scope.onmessage = async event => {
        const request = event.data;
        if (request?.type !== 'analyze') return;
        const token = {
            activationEpoch: request.activationEpoch,
            runGeneration: request.runGeneration
        };
        try {
            const result = await runAnalysisRequest(request, message => scope.postMessage(message));
            scope.postMessage({ type: 'result', ...token, result }, collectTransferBuffers(result));
        } catch (error) {
            scope.postMessage({
                type: 'error',
                ...token,
                code: error?.code || (
                    error instanceof TypeError || error instanceof RangeError
                        ? 'invalid-snapshot'
                        : 'analysis-failed'
                ),
                message: error?.message || String(error)
            });
        }
    };
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
    installAnalysisWorker(globalThis);
}
