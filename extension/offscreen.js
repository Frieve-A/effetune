import { CHANNEL_NAME, MODEL_COMMANDS, isInternalSender, runtimeRequest } from './protocol.js';
import { initializePluginModel, createPipelineModels, serializePipeline, getPresetPluginStates } from './model.js';
import { getDefaultIrLibraryService } from '../js/ir-library/service.js';
import { ExtensionIrLibraryHost } from './ir-library.js';
import { matchUrlRule, validateRules } from './url-rules.js';

const MAX_SESSIONS = 4;
const isLive = state => ['starting', 'processing'].includes(state.status);
const channel = new BroadcastChannel(CHANNEL_NAME);
const sessions = new Map();
const viewers = new Map();
let queue = Promise.resolve();
let revision = 0;
let manager;
let settings = { plugins: [], presets: {}, masterBypass: false, rules: [], sampleRate: null };
let irLibraryHostPromise;

function snapshot() {
    return { revision, ...settings, sessions: [...sessions.values()].map(({ state }) => ({ ...state })) };
}
function publish() {
    revision++;
    const state = snapshot();
    channel.postMessage({ kind: 'state', state });
    return state;
}
async function persist() { await runtimeRequest('saveSettings', { settings }); }

async function setDecodeContext(sampleRate, nextSettings = null) {
    const candidate = new AudioContext(sampleRate ? { sampleRate } : {});
    if (nextSettings) {
        try {
            await runtimeRequest('saveSettings', { settings: nextSettings });
        } catch (error) {
            try { await candidate.close(); } catch (closeError) {
                console.error('Could not close the unused audio context:', closeError);
            }
            throw error;
        }
    }
    const previous = window.audioContext;
    window.audioContext = candidate;
    await previous?.close();
}

function getIrLibraryHost() {
    irLibraryHostPromise ??= getDefaultIrLibraryService().then(service => {
        const decoder = manager.createPlugin('IR Reverb');
        decoder.audioHostActive = false;
        decoder.setWasmAssetTargetResolver(() => []);
        return new ExtensionIrLibraryHost(service, {
            decode: bytes => decoder._decodeAudioData(bytes),
            resample: (pcm, rate) => decoder._resamplePcm(pcm, rate),
            isInUse: irId => [...sessions.values()].some(session => isLive(session.state) && session.irIds.has(irId)),
            onProgress: detail => channel.postMessage({ kind: 'irLibraryProgress', ...detail })
        });
    });
    return irLibraryHostPromise;
}

function mergeSession(session, state) {
    const { irIds = [], ...patch } = state;
    session.irIds = new Set(irIds);
    Object.assign(session.state, patch);
}

function requestSession(session, command, args = {}) {
    const requestId = ++session.sequence;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            session.pending.delete(requestId);
            reject(new Error('Audio processing did not respond. Stop this session and try again.'));
        }, 60000);
        session.pending.set(requestId, { resolve, reject, timer });
        session.port.postMessage({ kind: 'request', requestId, command, args });
    });
}

function removeSession(session) {
    session.frame.remove();
    session.port.close();
    for (const pending of session.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Session closed')); }
    sessions.delete(session.state.sessionId);
    for (const [id, viewer] of viewers) if (viewer.sessionId === session.state.sessionId) viewers.delete(id);
}

async function createSession(args) {
    const existing = [...sessions.values()].find(session => session.state.tabId === args.tabId);
    if (existing && isLive(existing.state)) return { ...snapshot(), sessionId: existing.state.sessionId };
    if ([...sessions.values()].filter(session => isLive(session.state)).length >= MAX_SESSIONS) {
        throw new Error('Up to four tabs can run at once. Stop a tab before starting another.');
    }
    if (existing) removeSession(existing);
    const sessionId = crypto.randomUUID();
    const presetName = matchUrlRule(args.url, settings.rules, settings.presets);
    const plugins = presetName ? getPresetPluginStates(settings.presets[presetName]) : settings.plugins;
    const frame = document.createElement('iframe');
    frame.dataset.sessionId = sessionId;
    frame.src = chrome.runtime.getURL('extension/session.html');
    const connection = new MessageChannel();
    const session = { frame, port: connection.port1, pending: new Map(), sequence: 0, irIds: new Set(),
        telemetry: false, frequencyPreviewOwner: null, visualizerOwner: null,
        state: { sessionId, tabId: args.tabId, title: args.title, url: args.url, status: 'starting',
            presetName, plugins, masterBypass: settings.masterBypass, sampleRate: settings.sampleRate,
            error: null, powerState: 'ACTIVE', preparationStatuses: [] } };
    sessions.set(sessionId, session);
    session.port.onmessage = ({ data }) => {
        if (data.kind === 'irLibrary') {
            getIrLibraryHost().then(host => host.request(data.args, sessionId)).then(result => {
                session.port.postMessage({ kind: 'irResponse', requestId: data.requestId, ok: true, result });
            }, reason => {
                console.error('Session impulse response request failed:', reason);
                session.port.postMessage({ kind: 'irResponse', requestId: data.requestId, ok: false });
            });
        } else if (data.kind === 'state') { mergeSession(session, data.state); publish(); }
        else if (data.kind === 'workletMessage') {
            channel.postMessage({ kind: 'workletMessage', sessionId, message: data.message });
        } else if (data.kind === 'response') {
            const pending = session.pending.get(data.requestId);
            if (!pending) return;
            clearTimeout(pending.timer); session.pending.delete(data.requestId);
            if (data.ok) { mergeSession(session, data.state); pending.resolve(session.state); }
            else pending.reject(new Error('The preset could not be applied. Check its effects, channels and impulse response files.'));
        }
    };
    session.port.start();
    publish();
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('The audio session could not be opened.')), 15000);
            frame.onload = () => { clearTimeout(timer); resolve(); };
            document.body.append(frame);
        });
        frame.contentWindow.postMessage({ kind: 'connectSession' }, window.location.origin, [connection.port2]);
        await requestSession(session, 'start', { ...args, plugins, sampleRate: settings.sampleRate, masterBypass: settings.masterBypass });
    } catch (reason) {
        console.error('Audio session startup failed:', reason);
        frame.remove();
        session.state.status = 'error';
        session.state.error = 'Tab audio could not be processed. The website is playing normally. Start EffeTune again to retry.';
    }
    return { ...publish(), sessionId };
}

function removeViewer(id) {
    viewers.delete(id);
    for (const session of sessions.values()) {
        if (session.frequencyPreviewOwner === id) {
            session.frequencyPreviewOwner = null;
            requestSession(session, 'frequencyPreview', { frequency: null }).catch(console.error);
        }
        if (session.visualizerOwner === id) {
            session.visualizerOwner = null;
            requestSession(session, 'setVisualizerSources', { sources: [] }).catch(console.error);
        }
    }
}

function synchronizeTelemetry() {
    const now = Date.now();
    for (const [id, viewer] of viewers) if (now - viewer.lastSeen > 15000) removeViewer(id);
    for (const session of sessions.values()) {
        const enabled = isLive(session.state) && [...viewers.values()].some(viewer => viewer.sessionId === session.state.sessionId);
        if (enabled === session.telemetry) continue;
        session.telemetry = enabled;
        requestSession(session, 'setTelemetry', { enabled }).catch(console.error);
    }
}

function presetName(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new Error('Enter a preset name.');
    const name = value.trim();
    if (['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Choose a different preset name.');
    return name;
}
function selectedSession(args) {
    if (args.sessionId == null) return null;
    const session = sessions.get(args.sessionId);
    if (!session || !isLive(session.state)) throw new Error('This tab is no longer being processed. Select another tab or start it again.');
    return session;
}
function saveEditedPipeline(session, plugins) {
    if (session?.state.presetName) settings.presets[session.state.presetName] = { plugins: plugins.map(({ id, ...plugin }) => plugin) };
    else settings.plugins = plugins;
}
async function pipelineEdit(session, preset, { unbind = false, updateSession = requestSession } = {}) {
    let plugins;
    if (session) {
        await updateSession(session, 'setPipeline', { plugins: getPresetPluginStates(preset) });
        if (unbind) session.state.presetName = null;
        plugins = session.state.plugins;
    } else {
        const models = await createPipelineModels(preset, manager, window.audioContext.sampleRate);
        plugins = serializePipeline(models);
        for (const plugin of models) plugin.cleanup?.();
    }
    saveEditedPipeline(session, plugins);
}

async function handle(command, args = {}, clientId = null, updateSession = requestSession) {
    if (command === 'getState') return snapshot();
    if (command === 'readBackupPresets') return structuredClone(settings.presets);
    if (command === 'appendBackupPreset') {
        const name = presetName(args.name);
        if (Object.hasOwn(settings.presets, name)) {
            throw new Error('Choose a different preset name.');
        }
        const states = getPresetPluginStates(args.preset);
        if (states.length > 128 || states.some(state => !state || typeof state !== 'object' || typeof state.nm !== 'string')) {
            throw new Error('This file does not contain a valid preset.');
        }
        const presets = { ...settings.presets };
        Object.defineProperty(presets, name, { value: structuredClone(args.preset), enumerable: true, writable: true, configurable: true });
        const nextSettings = { ...settings, presets };
        await runtimeRequest('saveSettings', { settings: nextSettings });
        settings = nextSettings;
        return publish();
    }
    if (command === 'start') return createSession(args);
    if (command === 'navigate' || command === 'removeTab') {
        const session = [...sessions.values()].find(item => item.state.tabId === args.tabId);
        if (!session) return snapshot();
        if (command === 'removeTab') {
            if (isLive(session.state)) await requestSession(session, 'stop');
            removeSession(session);
        } else if (isLive(session.state)) {
            session.state.url = args.url;
            if (args.title) session.state.title = args.title;
            const resolved = matchUrlRule(args.url, settings.rules, settings.presets);
            if (resolved !== session.state.presetName) {
                await requestSession(session, 'setPipeline', { plugins: resolved ? getPresetPluginStates(settings.presets[resolved]) : settings.plugins });
                session.state.presetName = resolved;
            }
        }
        return publish();
    }
    if (command === 'setRules') settings.rules = validateRules(args.rules);
    else if (command === 'setSampleRate') {
        if (![null, 44100, 48000, 96000, 192000].includes(args.sampleRate)) throw new Error('Choose a supported sample rate.');
        if (args.sampleRate === settings.sampleRate) return snapshot();
        const nextSettings = { ...settings, sampleRate: args.sampleRate };
        await setDecodeContext(args.sampleRate, nextSettings);
        settings = nextSettings;
        await Promise.all([...sessions.values()].filter(session => isLive(session.state))
            .map(session => requestSession(session, 'rebuild', { sampleRate: args.sampleRate })));
        return publish();
    } else if (command === 'deletePreset') {
        const name = presetName(args.name);
        delete settings.presets[name];
        settings.rules = settings.rules.map(rule => rule.preset === name ? { ...rule, enabled: false } : rule);
        for (const session of sessions.values()) if (isLive(session.state) && session.state.presetName === name) {
            await updateSession(session, 'setPipeline', { plugins: settings.plugins });
            session.state.presetName = null;
        }
    } else {
        if (command === 'setTelemetry') {
            const session = sessions.get(args.sessionId);
            removeViewer(clientId);
            if (args.enabled && session && isLive(session.state)) {
                viewers.set(clientId, { sessionId: session.state.sessionId, lastSeen: Date.now() });
            }
            synchronizeTelemetry();
            return snapshot();
        }
        if (command === 'setVisualizerSources') {
            const session = sessions.get(args.sessionId);
            // Sources do not change the shared state, so reply without a revisioned snapshot.
            if (!session || !isLive(session.state)) return null;
            session.visualizerOwner = clientId;
            await requestSession(session, command, { sources: args.sources });
            return null;
        }
        const session = selectedSession(args);
        if (command === 'stop' || command === 'setBypass') {
            if (!session) throw new Error('Select a running tab first.');
            if (command === 'setBypass' && typeof args.enabled !== 'boolean') throw new Error('Invalid bypass state');
            await requestSession(session, command, args);
            return publish();
        }
        if (command === 'setPipeline') await pipelineEdit(session, { plugins: args.plugins }, { updateSession });
        else if (command === 'applyPreset') {
            if (!Object.hasOwn(settings.presets, args.name)) throw new Error('The preset is no longer available.');
            await pipelineEdit(session, settings.presets[args.name], { unbind: true, updateSession });
        } else if (command === 'importPreset') {
            const name = args.name ? presetName(args.name) : null;
            await pipelineEdit(session, args.preset, { updateSession });
            if (name) settings.presets[name] = {
                plugins: (session?.state.plugins || settings.plugins).map(({ id, ...plugin }) => plugin)
            };
        } else if (command === 'savePreset') settings.presets[presetName(args.name)] = {
            plugins: (session?.state.plugins || settings.plugins).map(({ id, ...plugin }) => plugin)
        };
        else if (command === 'workletMessage') {
            if (session) {
                await updateSession(session, command, args);
                if (args.message?.type !== 'updatePlugin') return snapshot();
                saveEditedPipeline(session, session.state.plugins);
            } else {
                const message = args.message;
                if (message?.type !== 'updatePlugin') return snapshot();
                const index = settings.plugins.findIndex(plugin => plugin.id === message.plugin?.id);
                if (index < 0 || manager.pluginClasses[settings.plugins[index].nm]?.name !== message.plugin?.type) throw new Error('Effect unavailable');
                const { inputBus, outputBus, channel: channelSpec, ...parameters } = message.plugin.parameters || {};
                const plugins = settings.plugins.slice();
                plugins[index] = { ...parameters, id: message.plugin.id, nm: plugins[index].nm, en: message.plugin.enabled,
                    ib: inputBus ?? message.plugin.inputBus, ob: outputBus ?? message.plugin.outputBus,
                    ch: channelSpec ?? message.plugin.channel };
                await pipelineEdit(null, { plugins });
            }
        } else throw new Error('This action is unavailable.');
    }
    await persist();
    return publish();
}

async function editSettings(command, args, clientId) {
    const previousSettings = settings;
    const changedSessions = new Map();
    settings = structuredClone(settings);
    const updateSession = (session, operation, parameters) => {
        if (!changedSessions.has(session)) changedSessions.set(session, {
            plugins: session.state.plugins, presetName: session.state.presetName
        });
        return requestSession(session, operation, parameters);
    };
    try {
        return await handle(command, args, clientId, updateSession);
    } catch (reason) {
        settings = previousSettings;
        for (const [session, previous] of changedSessions) {
            try {
                await requestSession(session, 'setPipeline', { plugins: previous.plugins });
            } catch (rollbackError) {
                console.error('Could not restore the previous audio settings:', rollbackError);
                await requestSession(session, 'stop');
            } finally {
                session.state.presetName = previous.presetName;
            }
        }
        publish();
        throw reason;
    }
}

const ready = (async () => {
    settings = { ...settings, ...await runtimeRequest('loadSettings') };
    manager = await initializePluginModel();
    await setDecodeContext(settings.sampleRate);
    window.irLibraryService = (await getIrLibraryHost()).service;
})();
function enqueue(command, args, clientId) {
    const editsSettings = ['setRules', 'deletePreset', 'setPipeline', 'applyPreset', 'importPreset', 'savePreset'].includes(command) ||
        (command === 'workletMessage' && args?.message?.type === 'updatePlugin');
    const result = queue.then(() => ready).then(() => editsSettings
        ? editSettings(command, args, clientId) : handle(command, args, clientId));
    queue = result.catch(() => {});
    return result;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.destination !== 'offscreen' || !isInternalSender(sender, ['extension/service-worker.js']) ||
        !['getState', 'start', 'stop', 'setBypass', 'applyPreset', 'navigate', 'removeTab'].includes(message.command)) return false;
    enqueue(message.command, message.args).then(result => respond({ ok: true, result }), reason => {
        console.error('Extension action failed:', reason);
        respond({ ok: false, error: 'The action could not be completed. Check the selected tab and preset, then try again.' });
    });
    return true;
});

channel.onmessage = ({ data }) => {
    if (typeof data?.clientId !== 'string') return;
    if (data.kind === 'cancelIrImport' && typeof data.operationId === 'string') {
        getIrLibraryHost().then(host => host.cancel(data.clientId, data.operationId)).catch(console.error);
    }
    if (data.kind === 'heartbeat' && viewers.has(data.clientId)) viewers.get(data.clientId).lastSeen = Date.now();
    if (data.kind === 'leave') { removeViewer(data.clientId); synchronizeTelemetry(); }
    if (data.kind === 'frequencyPreview' && viewers.get(data.clientId)?.sessionId === data.sessionId) {
        const session = sessions.get(data.sessionId);
        if (session) {
            session.frequencyPreviewOwner = Number.isFinite(data.frequency) && data.frequency > 0 ? data.clientId : null;
            requestSession(session, 'frequencyPreview', { frequency: data.frequency, sound: data.sound }).catch(console.error);
        }
    }
    if (data.kind !== 'request' || !MODEL_COMMANDS.has(data.command) || !Number.isInteger(data.requestId)) return;
    const operation = data.command === 'irLibrary'
        ? ready.then(() => getIrLibraryHost()).then(host => host.request(data.args, data.clientId))
        : enqueue(data.command, data.args, data.clientId);
    operation.then(result => {
        channel.postMessage({ kind: 'response', clientId: data.clientId, requestId: data.requestId, ok: true, result });
    }, reason => {
        console.error('Editor update failed:', reason);
        channel.postMessage({ kind: 'response', clientId: data.clientId, requestId: data.requestId, ok: false,
            error: 'These settings could not be applied. Check the effects, channels and impulse response files, then try again.' });
    });
};
setInterval(synchronizeTelemetry, 5000);
