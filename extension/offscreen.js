import { AudioManager } from '../js/audio-manager.js';
import { PipelineWorkletSync } from '../js/ui/pipeline/pipeline-worklet-sync.js';
import { applySerializedState } from '../js/utils/serialization-utils.js';
import { CHANNEL_NAME, MODEL_COMMANDS, isInternalSender, runtimeRequest } from './protocol.js';
import { initializePluginModel, createPipelineModels, serializePipeline, validatePreset } from './model.js';
import { getDefaultIrLibraryService } from '../js/ir-library/service.js';
import { ExtensionIrLibraryHost } from './ir-library.js';
import {
    publishStateThenDspExecution,
    replayDspExecutionStates,
    routeOffscreenWorkletMessage
} from './execution-state-bridge.js';

const channel = new BroadcastChannel(CHANNEL_NAME);
const viewers = new Map();
let queue = Promise.resolve();
let manager;
let audio;
let stream;
let failurePending = false;
let telemetryEnabled = null;
let irLibraryHostPromise;
let settings = { plugins: [], presets: {}, masterBypass: false };
let state = { revision: 0, status: 'stopped', target: null, masterBypass: false,
    sampleRate: 48000, plugins: [], presets: {}, error: null, powerState: 'ACTIVE' };

function newAudioManager() {
    return new AudioManager(null, { wasmOnly: true, externalInput: true,
        automaticSuspendAllowed: false, assetBasePath: chrome.runtime.getURL(''),
        workletModuleUrl: chrome.runtime.getURL('plugins/audio-processor.js') });
}

function getIrLibraryHost() {
    irLibraryHostPromise ??= getDefaultIrLibraryService().then(service => {
        const decoder = manager.createPlugin('IR Reverb');
        decoder.audioHostActive = false;
        decoder.setWasmAssetTargetResolver(() => []);
        return new ExtensionIrLibraryHost(service, {
            decode: bytes => decoder._decodeAudioData(bytes),
            resample: (pcm, rate) => decoder._resamplePcm(pcm, rate),
            isInUse: irId => audio.pipeline.some(plugin => plugin.externalAssetInfo?.ids?.includes(irId)),
            onProgress: detail => channel.postMessage({ kind: 'irLibraryProgress', ...detail })
        });
    });
    return irLibraryHostPromise;
}

function snapshot() {
    return { ...state, masterBypass: settings.masterBypass, plugins: settings.plugins, presets: settings.presets };
}

function publish(patch = {}) {
    state = { ...state, ...patch, revision: state.revision + 1 };
    const value = snapshot();
    channel.postMessage({ kind: 'state', state: value });
    return value;
}

async function persist() {
    await runtimeRequest('saveSettings', { settings });
}

function synchronizeTelemetry() {
    const now = Date.now();
    for (const [id, lastSeen] of viewers) if (now - lastSeen > 15000) viewers.delete(id);
    const enabled = viewers.size > 0;
    if (enabled === telemetryEnabled) return;
    telemetryEnabled = enabled;
    audio?.workletNode?.port.postMessage({ type: 'dspSetTelemetryRate', hz: enabled ? 30 : 0 });
    audio?.powerPolicyController?.handlePageLifecycleEvent('visibilitychange', { hidden: !enabled });
}

async function closeAudio(nextState = 'stopped', error = null) {
    publish({ status: 'stopping' });
    const models = audio?.pipeline || [];
    for (const track of stream?.getTracks() || []) track.stop();
    stream = null;
    try { await audio?.closeCapturedStream(); }
    finally {
        audio = newAudioManager();
        audio.pipeline = models;
        audio.pipelineA = models;
        audio.pipelineProcessor.setPipeline(models);
        audio.masterBypass = settings.masterBypass;
        telemetryEnabled = null;
        publish({ status: nextState, target: null, error, powerState: 'ACTIVE' });
    }
    return snapshot();
}

function failAudio(error) {
    if (failurePending || !['starting', 'processing'].includes(state.status)) return;
    failurePending = true;
    console.error('Captured audio failed:', error);
    queue = queue.then(() => closeAudio('error', 'Audio processing stopped. The website is playing normally. Start EffeTune again to retry.'))
        .catch(console.error).finally(() => { failurePending = false; });
}

async function applyPipeline(preset) {
    const candidates = await createPipelineModels(preset, manager, state.sampleRate);
    const previous = audio.pipeline;
    const previousBypass = audio.masterBypass;
    const previousSettings = settings;
    const sync = new PipelineWorkletSync({ audioManager: audio });
    try {
        audio.pipeline = candidates;
        audio.pipelineA = candidates;
        audio.pipelineProcessor.setPipeline(candidates);
        for (const plugin of candidates) {
            plugin.audioHostActive = true;
            plugin._setupMessageHandler();
        }
        if (audio.workletNode) {
            const payload = candidates.map(plugin => plugin.getWorkletPluginData(plugin.extensionInitialParameters));
            audio.commitPowerTopologyMutation({ type: 'updatePlugins', plugins: payload, masterBypass: audio.masterBypass });
            audio.syncPrimaryWasmAssetMembership(candidates);
            const expected = audio._replayPipelineWasmAssets(audio.workletNode, candidates, { trackState: true });
            if (expected === null || !await audio._waitForWasmAssetsActive(audio.workletNode, expected, undefined, 15000)) {
                throw new Error('The impulse response could not be activated.');
            }
            const latency = await audio._requestWorkletLatency(audio.workletNode, 5000);
            if (!latency) throw new Error('The audio processor did not confirm the new pipeline.');
            const execution = new Map(audio.getDspExecutionStateSnapshot().states.map(item => [item.pluginId, item.state]));
            if (candidates.some(plugin => plugin.enabled && plugin.constructor.name !== 'SectionPlugin' && execution.get(plugin.id) !== 'active')) {
                throw new Error('The audio processor could not activate every effect.');
            }
        }
        settings = { ...settings, plugins: serializePipeline(candidates), masterBypass: audio.masterBypass };
        await persist();
        for (const plugin of previous) plugin.cleanup?.();
        publishStateThenDspExecution(
            () => publish(),
            audio,
            message => channel.postMessage({ kind: 'workletMessage', message })
        );
    } catch (error) {
        settings = previousSettings;
        audio.pipeline = previous;
        audio.pipelineA = previous;
        audio.masterBypass = previousBypass;
        audio.pipelineProcessor.setPipeline(previous);
        sync.updateWorkletPlugins();
        for (const plugin of candidates) plugin.cleanup?.();
        throw error;
    }
}

async function startCapture(args) {
    if (['processing', 'starting'].includes(state.status)) return snapshot();
    if (typeof args.streamId !== 'string' || !Number.isInteger(args.tabId)) throw new Error('Invalid capture request');
    publish({ status: 'starting', target: { tabId: args.tabId, title: args.title }, error: null });
    try {
        stream = await audio.ioManager._getUserMediaWithTimeout({
            audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: args.streamId } }, video: false
        }, 10000);
        for (const track of stream.getTracks()) track.addEventListener('ended', () => {
            if (!stream) return;
            queue = queue.then(() => closeAudio()).catch(failAudio);
        }, { once: true });
        state.sampleRate = await audio.initializeCapturedStream(stream);
        const node = audio.workletNode;
        const handleMessage = node.port.onmessage;
        node.port.onmessage = event => {
            const data = event.data;
            const message = routeOffscreenWorkletMessage(data, {
                hasViewers: viewers.size > 0,
                handle: () => handleMessage?.(event),
                publish: forwarded => channel.postMessage({ kind: 'workletMessage', message: forwarded }),
                getExecutionSnapshot: () => audio.getDspExecutionStateSnapshot()
            });
            if (data.type === 'dspFailed' ||
                (message?.type === 'dspExecutionState' && message.state === 'bypassed' &&
                    !['engineStopped'].includes(message.reason))) failAudio(message);
        };
        node.onprocessorerror = failAudio;
        audio.masterBypass = settings.masterBypass;
        await applyPipeline({ plugins: settings.plugins });
        audio.powerPolicyController.subscribe(power => {
            if (state.powerState !== power.effectiveState) publish({ powerState: power.effectiveState });
        });
        telemetryEnabled = null;
        synchronizeTelemetry();
        audio.ioManager.outputGainNode.gain.setValueAtTime(1, audio.audioContext.currentTime);
        return publish({ status: 'processing' });
    } catch (error) {
        console.error('Capture startup failed:', error);
        return closeAudio('error', 'Tab audio could not be processed. The website is playing normally. Start EffeTune again to retry.');
    }
}

function presetName(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new Error('Enter a preset name.');
    return value.trim();
}

async function handle(command, args = {}, clientId = null) {
    if (command === 'irLibrary') return (await getIrLibraryHost()).request(args, clientId);
    if (command === 'getState') return snapshot();
    if (command === 'start') return startCapture(args);
    if (command === 'stop') return closeAudio();
    if (command === 'setBypass') {
        if (typeof args.enabled !== 'boolean') throw new Error('Invalid bypass request');
        audio.masterBypass = args.enabled;
        new PipelineWorkletSync({ audioManager: audio }).updateMasterBypass(args.enabled);
        settings.masterBypass = args.enabled;
        await persist();
        return publish();
    }
    if (command === 'setTelemetry') {
        if (args.enabled === true) viewers.set(clientId, Date.now());
        else viewers.delete(clientId);
        synchronizeTelemetry();
        if (args.enabled === true) {
            replayDspExecutionStates(audio.getDspExecutionStateSnapshot(), message => {
                channel.postMessage({ kind: 'workletMessage', message });
            });
        }
        return snapshot();
    }
    if (command === 'setPipeline') await applyPipeline({ plugins: args.plugins });
    else if (command === 'applyPreset') {
        if (!Object.hasOwn(settings.presets, args.name)) throw new Error('The preset is no longer available.');
        await applyPipeline(settings.presets[args.name]);
    } else if (command === 'importPreset') {
        await applyPipeline(args.preset);
        if (args.name) settings.presets = { ...settings.presets, [presetName(args.name)]: { plugins: settings.plugins.map(({ id, ...plugin }) => plugin) } };
    } else if (command === 'savePreset') {
        settings.presets = { ...settings.presets, [presetName(args.name)]: { plugins: settings.plugins.map(({ id, ...plugin }) => plugin) } };
    } else if (command === 'deletePreset') {
        delete settings.presets[presetName(args.name)];
    } else if (command === 'workletMessage') {
        const message = args.message;
        if (message?.type === 'updatePlugin') {
            const plugin = audio.pipeline.find(item => item.id === message.plugin?.id);
            if (!plugin || plugin.constructor.name !== message.plugin?.type) throw new Error('Reopen the editor to update this effect.');
            const { inputBus, outputBus, channel: channelSpec, ...parameters } = message.plugin.parameters || {};
            const next = { ...parameters, nm: plugin.name, en: message.plugin.enabled,
                ib: inputBus ?? message.plugin.inputBus, ob: outputBus ?? message.plugin.outputBus,
                ch: channelSpec ?? message.plugin.channel };
            validatePreset([next], manager, state.sampleRate);
            applySerializedState(plugin, next);
            settings.plugins = serializePipeline(audio.pipeline);
        } else if (['setSpectrumTap', 'setSpectrumTapRoute', 'getPerformanceMetrics'].includes(message?.type)) {
            audio.workletNode?.port.postMessage(message);
            return snapshot();
        } else throw new Error('This audio operation is unavailable in the extension.');
    } else throw new Error('This action is unavailable.');
    await persist();
    return publish();
}

const ready = (async () => {
    const loaded = await runtimeRequest('loadSettings');
    settings = { plugins: [], presets: {}, masterBypass: false, ...loaded };
    audio = newAudioManager();
    manager = await initializePluginModel();
    try {
        const models = await createPipelineModels({ plugins: settings.plugins }, manager);
        audio.pipeline = models;
        audio.pipelineA = models;
        for (const plugin of models) plugin.audioHostActive = true;
    } catch (error) {
        console.error('Saved pipeline is unavailable:', error);
        state.error = 'The saved pipeline needs an impulse response or effect that is unavailable. Its settings have been kept.';
    }
})();

function enqueue(command, args, clientId) {
    const result = queue.then(() => ready).then(() => handle(command, args, clientId));
    queue = result.catch(() => {});
    return result;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.destination !== 'offscreen' ||
        !isInternalSender(sender, ['extension/service-worker.js']) ||
        !['getState', 'start', 'stop', 'setBypass', 'applyPreset'].includes(message.command)) return false;
    enqueue(message.command, message.args).then(result => respond({ ok: true, result }), error => {
        console.error('Extension action failed:', error);
        respond({ ok: false, error: 'The preset could not be applied. Check its effects, channels and impulse response files. Your current pipeline has been kept.' });
    });
    return true;
});

channel.onmessage = ({ data }) => {
    if (typeof data?.clientId !== 'string') return;
    if (data.kind === 'cancelIrImport' && typeof data.operationId === 'string') {
        getIrLibraryHost().then(host => host.cancel(data.clientId, data.operationId)).catch(console.error);
    }
    if (data.kind === 'heartbeat' && viewers.has(data.clientId)) viewers.set(data.clientId, Date.now());
    if (data.kind === 'leave') { viewers.delete(data.clientId); synchronizeTelemetry(); }
    if (data.kind !== 'request' || !MODEL_COMMANDS.has(data.command) || !Number.isInteger(data.requestId)) return;
    enqueue(data.command, data.args, data.clientId).then(result => {
        channel.postMessage({ kind: 'response', clientId: data.clientId, requestId: data.requestId, ok: true, result });
    }, error => {
        console.error('Editor update failed:', error);
        channel.postMessage({ kind: 'response', clientId: data.clientId, requestId: data.requestId, ok: false,
            error: data.command === 'irLibrary' ? 'The impulse response library could not complete this action. Try again.'
                : 'These settings could not be applied. Check the effects, channels and impulse response files. Your previous pipeline has been kept.' });
    });
};
setInterval(synchronizeTelemetry, 5000);
window.addEventListener('pagehide', () => { for (const track of stream?.getTracks() || []) track.stop(); });
