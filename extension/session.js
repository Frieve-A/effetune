import { AudioManager } from '../js/audio-manager.js';
import { PipelineWorkletSync } from '../js/ui/pipeline/pipeline-worklet-sync.js';
import { applySerializedState } from '../js/utils/serialization-utils.js';
import { initializePluginModel, createPipelineModels, activatePipelineModels, serializePipeline, validatePreset } from './model.js';
import { ExtensionIrLibraryClient } from './ir-library.js';
import { capturePreparationStatuses, observePreparationStatus } from './preparation-status-bridge.js';
import { replayDspExecutionStates, routeOffscreenWorkletMessage } from './execution-state-bridge.js';

let port;
let manager;
let audio;
let stream;
let queue = Promise.resolve();
let telemetry = false;
let failurePending = false;
let status = 'stopped';
let error = null;
let powerState = 'ACTIVE';
let irSequence = 0;
const irPending = new Map();

function newAudioManager() {
    return new AudioManager(null, { wasmOnly: true, externalInput: true,
        automaticSuspendAllowed: false, assetBasePath: chrome.runtime.getURL(''),
        workletModuleUrl: chrome.runtime.getURL('plugins/audio-processor.js') });
}

function snapshot() {
    return { status, error, powerState, sampleRate: audio?.audioContext?.sampleRate ?? null,
        masterBypass: audio?.masterBypass ?? false, plugins: serializePipeline(audio?.pipeline || []),
        preparationStatuses: capturePreparationStatuses(audio?.pipeline || [], audio?.masterBypass),
        irIds: [...new Set((audio?.pipeline || []).flatMap(plugin => plugin.externalAssetInfo?.ids || []))] };
}

function publish() { const state = snapshot(); port.postMessage({ kind: 'state', state }); return state; }
function forward(message) { port.postMessage({ kind: 'workletMessage', message }); }

function synchronizeTelemetry() {
    audio?.workletNode?.port.postMessage({ type: 'dspSetTelemetryRate', hz: telemetry ? 30 : 0 });
    audio?.powerPolicyController?.handlePageLifecycleEvent('visibilitychange', { hidden: !telemetry });
}

async function closeAudio(nextStatus = 'stopped', message = null) {
    status = 'stopping';
    publish();
    const captured = stream;
    stream = null;
    for (const track of captured?.getTracks() || []) track.stop();
    audio?.setFrequencyPreview(null);
    try { await audio?.closeCapturedStream(); }
    finally { status = nextStatus; error = message; powerState = 'ACTIVE'; publish(); }
    return snapshot();
}

function failAudio(reason) {
    if (failurePending || !['starting', 'processing'].includes(status)) return;
    failurePending = true;
    console.error('Captured audio failed:', reason);
    queue = queue.then(() => closeAudio('error', 'Audio processing stopped. The website is playing normally. Start EffeTune again to retry.'))
        .catch(console.error).finally(() => { failurePending = false; });
}

async function applyPipeline(preset) {
    audio.setFrequencyPreview(null);
    await window.irLibraryService.refresh();
    const candidates = await createPipelineModels(preset, manager, audio.audioContext?.sampleRate || 48000);
    const previous = audio.pipeline;
    try {
        audio.pipeline = candidates;
        audio.pipelineA = candidates;
        audio.pipelineProcessor.setPipeline(candidates);
        for (const plugin of candidates) { plugin.audioHostActive = true; plugin._setupMessageHandler(); }
        if (audio.workletNode) await activatePipelineModels(audio, candidates);
        for (const plugin of previous) plugin.cleanup?.();
        publish();
        replayDspExecutionStates(audio.getDspExecutionStateSnapshot(), forward);
    } catch (reason) {
        audio.pipeline = previous;
        audio.pipelineA = previous;
        audio.pipelineProcessor.setPipeline(previous);
        new PipelineWorkletSync({ audioManager: audio }).updateWorkletPlugins();
        for (const plugin of candidates) plugin.cleanup?.();
        throw reason;
    }
}

async function initializeAudio(plugins, sampleRate, masterBypass) {
    await audio.initializeCapturedStream(stream, { sampleRate });
    const node = audio.workletNode;
    const handleMessage = node.port.onmessage;
    node.port.onmessage = event => {
        const message = routeOffscreenWorkletMessage(event.data, {
            hasViewers: telemetry, handle: () => handleMessage?.(event), publish: forward,
            getExecutionSnapshot: () => audio.getDspExecutionStateSnapshot()
        });
        if (event.data.type === 'dspFailed' || (message?.type === 'dspExecutionState' &&
            message.state === 'bypassed' && message.reason !== 'engineStopped')) failAudio(message);
    };
    node.onprocessorerror = failAudio;
    audio.masterBypass = masterBypass;
    await applyPipeline({ plugins });
    audio.powerPolicyController.subscribe(power => {
        if (powerState !== power.effectiveState) { powerState = power.effectiveState; publish(); }
    });
    synchronizeTelemetry();
    audio.ioManager.outputGainNode.gain.setValueAtTime(1, audio.audioContext.currentTime);
    status = 'processing';
    return publish();
}

async function start(args) {
    status = 'starting'; error = null; publish();
    try {
        stream = await audio.ioManager._getUserMediaWithTimeout({ audio: {
            mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: args.streamId }
        }, video: false }, 10000);
        for (const track of stream.getTracks()) track.addEventListener('ended', () => {
            if (stream) failAudio(new Error('Captured stream ended'));
        }, { once: true });
        return await initializeAudio(args.plugins, args.sampleRate, args.masterBypass);
    } catch (reason) {
        console.error('Capture startup failed:', reason);
        return closeAudio('error', 'Tab audio could not be processed. The website is playing normally. Start EffeTune again to retry.');
    }
}

async function rebuild(sampleRate) {
    const plugins = serializePipeline(audio.pipeline);
    const masterBypass = audio.masterBypass;
    status = 'starting'; publish();
    try {
        audio.setFrequencyPreview(null);
        await audio.closeCapturedStream({ releaseInput: false });
        for (const plugin of audio.pipeline) plugin.cleanup?.();
        audio = newAudioManager();
        return await initializeAudio(plugins, sampleRate, masterBypass);
    } catch (reason) {
        console.error('Sample rate change failed:', reason);
        return closeAudio('error', 'This sample rate could not be used. The website is playing normally. Choose another sample rate and start EffeTune again.');
    }
}

async function handle(command, args) {
    if (command === 'start') return start(args);
    if (command === 'stop') return closeAudio();
    if (command === 'rebuild') return rebuild(args.sampleRate);
    if (command === 'setTelemetry') {
        telemetry = args.enabled;
        synchronizeTelemetry();
        if (telemetry) replayDspExecutionStates(audio.getDspExecutionStateSnapshot(), forward);
    } else if (command === 'frequencyPreview') audio.setFrequencyPreview(args.frequency);
    else if (command === 'setPipeline') await applyPipeline({ plugins: args.plugins });
    else if (command === 'setBypass') {
        audio.masterBypass = args.enabled;
        new PipelineWorkletSync({ audioManager: audio }).updateMasterBypass(args.enabled);
    } else if (command === 'workletMessage') {
        const message = args.message;
        if (message?.type === 'updatePlugin') {
            await window.irLibraryService.refresh();
            const plugin = audio.pipeline.find(item => item.id === message.plugin?.id);
            if (!plugin || plugin.constructor.name !== message.plugin?.type) throw new Error('Effect is unavailable');
            const { inputBus, outputBus, channel: channelSpec, ...parameters } = message.plugin.parameters || {};
            const next = { ...parameters, nm: plugin.name, en: message.plugin.enabled,
                ib: inputBus ?? message.plugin.inputBus, ob: outputBus ?? message.plugin.outputBus,
                ch: channelSpec ?? message.plugin.channel };
            validatePreset([next], manager, audio.audioContext.sampleRate);
            applySerializedState(plugin, next);
        } else if (['setSpectrumTap', 'setSpectrumTapRoute', 'getPerformanceMetrics', 'resetPluginState'].includes(message?.type)) {
            audio.workletNode?.port.postMessage(message);
        } else throw new Error('Unsupported worklet operation');
    } else throw new Error('Unknown session operation');
    return publish();
}

window.addEventListener('message', async event => {
    if (port || event.source !== parent || event.data?.kind !== 'connectSession' || !event.ports[0]) return;
    port = event.ports[0];
    window.irLibraryService = new ExtensionIrLibraryClient({ request(command, args) {
        const requestId = ++irSequence;
        return new Promise((resolve, reject) => {
            irPending.set(requestId, { resolve, reject });
            port.postMessage({ kind: 'irLibrary', requestId, args });
        });
    } });
    const ready = (async () => {
        manager = await initializePluginModel();
        const createPlugin = manager.createPlugin.bind(manager);
        manager.createPlugin = name => {
            const plugin = createPlugin(name);
            observePreparationStatus(plugin, () => queueMicrotask(() => {
                if (audio?.pipeline.includes(plugin)) publish();
            }));
            return plugin;
        };
        audio = newAudioManager();
        await window.irLibraryService.refresh();
    })();
    port.onmessage = ({ data }) => {
        if (data.kind === 'irResponse') {
            const pending = irPending.get(data.requestId);
            irPending.delete(data.requestId);
            if (data.ok) pending?.resolve(data.result);
            else pending?.reject(new Error('The impulse response could not be loaded.'));
            return;
        }
        if (data.kind !== 'request') return;
        const result = queue.then(() => ready).then(() => handle(data.command, data.args || {}));
        queue = result.catch(() => {});
        result.then(state => port.postMessage({ kind: 'response', requestId: data.requestId, ok: true, state }), reason => {
            console.error('Session action failed:', reason);
            port.postMessage({ kind: 'response', requestId: data.requestId, ok: false });
        });
    };
    port.start();
}, { once: false });
window.addEventListener('pagehide', () => { for (const track of stream?.getTracks() || []) track.stop(); });
