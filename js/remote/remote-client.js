// Entry of remote.html: EffeTune's own pipeline editor, opened in a browser, as a
// client of another EffeTune's remote-v1 server. The page serves two jobs at
// once: it shows the host's pipeline live and it edits it, with edits of the host
// and of other clients folded in (see remote-sync-engine.mjs). It never touches
// audio, the library or the Electron integration.

import { PluginManager } from '../plugin-manager.js';
import { publishDspParamPackers } from '../audio/dsp-wasm-loader.js';
import * as generatedParams from '../audio/dsp-params.generated.js';
import { getSerializablePluginStateShort } from '../utils/serialization-utils.js';
import { PipelineManager } from '../ui/pipeline-manager.js';
import { PluginListManager } from '../ui/plugin-list-manager.js';
import { MobileNumberKeypad } from '../ui/mobile-number-keypad.js';
import { TelemetryHub } from '../audio/telemetry-hub.js';
import { installRangeFillStyling } from '../ui/range-fill.js';
import { RemoteAudioManager } from './remote-audio-manager.js';
import { RemoteSession, resolveRemoteTarget } from './remote-session.js';
import { SyncEngine } from './remote-sync-engine.mjs';
import { createRemoteUiManager, loadTranslations, RemoteMobileShell } from './remote-ui-manager.js';
import { guardPluginsForClientCsp } from './client-csp-guards.js';
import { applyOpsToPipeline, createIdRegistry, finishBatch, randomClientPrefix } from './pipeline-apply.js';

const MESSAGE_DURATION_MS = 3000;
// Events that mean a person is acting on this page (see SyncEngine.flushNow).
const GESTURE_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'input', 'change', 'wheel', 'drop'];

const $ = id => document.getElementById(id);

function showNotice(text) {
    const notice = $('remoteNotice');
    notice.textContent = text;
    notice.hidden = false;
}

function createMessageHelpers() {
    let timer = null;
    const element = $('remoteMessage');
    return {
        show(text, success = false, duration = 0) {
            clearTimeout(timer);
            element.textContent = text;
            element.classList.toggle('success', success);
            element.hidden = false;
            if (duration > 0) timer = setTimeout(() => { element.hidden = true; }, duration);
        },
        hide() {
            clearTimeout(timer);
            element.hidden = true;
        }
    };
}

export function createRemotePresetHost(session, getPipeline) {
    let presetCache = null;
    session.addEventListener('presetsChanged', () => { presetCache = null; });
    return {
        async getPresets() {
            if (!presetCache) presetCache = (await session.request({ op: 'presets' }, 'presets')).presets || {};
            return { ...presetCache };
        },
        async savePreset(name) {
            await session.sendCommand({ op: 'savePreset', name, pipeline: getPipeline() });
            presetCache = null;
        },
        async loadPreset(nameOrPreset) {
            if (typeof nameOrPreset !== 'string') throw new Error('Only stored presets can be loaded here');
            await session.sendCommand({ op: 'loadPreset', name: nameOrPreset });
        },
        async deletePreset(name) {
            await session.sendCommand({ op: 'deletePreset', name });
            presetCache = null;
        }
    };
}

// What the engine sees of the editor, and how it changes it.
function createModelAdapter({ win, registry, audioManager, setSlotLabel }) {
    return {
        slot: 'A',
        snapshot() {
            const plugins = audioManager.pipeline;
            return {
                masterBypass: !!audioManager.masterBypass,
                slot: this.slot,
                pipeline: plugins.map(plugin => JSON.parse(JSON.stringify(getSerializablePluginStateShort(plugin)))),
                ids: plugins.map(plugin => registry.idOf(plugin))
            };
        },
        apply(ops, { recycle }) {
            const previous = audioManager.suppressMutations;
            audioManager.suppressMutations = true;
            try {
                const result = applyOpsToPipeline(win, ops, { registry, recycle });
                finishBatch(win, result);
            } finally {
                audioManager.suppressMutations = previous;
            }
        },
        setSlot(slot) {
            this.slot = slot;
            setSlotLabel(slot);
        }
    };
}

export async function startRemoteClient(win = window) {
    const target = resolveRemoteTarget({
        location: win.location,
        storage: (() => { try { return win.localStorage; } catch (_) { return null; } })(),
        history: win.history
    });
    if (!target.ok) {
        showNotice('Open this page from the QR code in EffeTune (Settings > Remote Control).');
        return null;
    }

    const messages = createMessageHelpers();
    const showCommandError = (message, error) => {
        console.error('[remote] command failed', error);
        messages.show(message, false, MESSAGE_DURATION_MS);
    };
    const statusText = $('remoteStatus');
    const overlay = $('remoteOverlay');
    const overlayText = $('remoteOverlayText');
    const dot = $('remoteDot');
    const setConnection = (state, text) => {
        dot.dataset.state = state;
        statusText.textContent = text;
    };
    setConnection('connecting', 'Connecting…');

    // ---- the plugin model -------------------------------------------------
    // No audio runs here, and the page's CSP forbids the eval that registers a
    // plugin's JavaScript processor: behave like the extension's WASM-only build.
    win.__EFFECTUNE_WASM_ONLY__ = true;
    publishDspParamPackers(generatedParams);
    const pluginManager = new PluginManager();
    const [, localization] = await Promise.all([
        pluginManager.loadPlugins(),
        loadTranslations({ language: win.navigator.language })
    ]);
    guardPluginsForClientCsp(pluginManager);
    const createPlugin = pluginManager.createPlugin.bind(pluginManager);
    pluginManager.createPlugin = name => {
        const plugin = createPlugin(name);
        plugin.setWasmAssetTargetResolver?.(() => []);
        return plugin;
    };

    const uiManager = createRemoteUiManager({
        locale: localization.locale,
        translations: localization.translations,
        english: localization.english,
        showMessage: messages.show,
        hideMessage: messages.hide
    });
    const mobileShell = new RemoteMobileShell({
        documentRef: document,
        translate: (key, fallback) => uiManager.translations[key] || fallback
    });
    uiManager.mobileNav = mobileShell;
    const keypad = new MobileNumberKeypad({
        documentRef: document,
        isEnabled: () => uiManager.layoutMode.isMobile,
        translate: (key, fallback) => uiManager.translations[key] || fallback
    });
    win.uiManager = uiManager;
    win.pluginManager = pluginManager;
    // Impulse responses are not offered on a remote client (IR Reverb shows its
    // "IR not found" state); this is the library read view the plugin asks for.
    win.irLibraryService = {
        list: () => [], get: () => null, refresh: async () => [], readAnalysis: async () => null,
        subscribe: () => () => {}, addEventListener() {}, removeEventListener() {}
    };

    const audioManager = new RemoteAudioManager();
    uiManager.audioManager = audioManager;
    win.audioManager = audioManager;
    win.audioContext = audioManager.audioContext;
    win.workletNode = audioManager.workletNode;
    audioManager.telemetryHub = new TelemetryHub({ port: { postMessage() {} } });
    win.dspTelemetryHub = audioManager.telemetryHub;

    // ---- session, engine, presets -------------------------------------------
    const isDesktopClient = /Electron\//.test(win.navigator.userAgent || '');
    let version = '';
    try { version = (await (await fetch('package.json')).json()).version || ''; } catch (_) { /* optional */ }
    const session = new RemoteSession({
        url: target.url,
        hello: { app: 'EffeTune', version, build: isDesktopClient ? 'desktop-client' : 'browser', sync: 1 }
    });

    const presetHost = createRemotePresetHost(session, () => adapter.snapshot().pipeline);

    const pluginListManager = new PluginListManager(pluginManager);
    uiManager.pluginListManager = pluginListManager;
    const pipelineManager = new PipelineManager(
        audioManager, pluginManager, uiManager.expandedPlugins, pluginListManager,
        { presetHost, enableFileProcessing: false }
    );
    audioManager.pipelineManager = pipelineManager;
    uiManager.pipelineManager = pipelineManager;
    win.pipelineManager = pipelineManager;

    // Local history does not exist here: undo and redo are the host's.
    const history = pipelineManager.historyManager;
    history.saveState = () => {};
    history.saveStateAtomicallyIfChanged = () => false;
    history.undo = () => {
        engine.noteGesture();
        session.sendCommand({ op: 'history', dir: 'undo' }).then(
            () => messages.show('Undid last change', true, MESSAGE_DURATION_MS),
            error => showCommandError('EffeTune could not undo the last change. Try again.', error));
    };
    history.redo = () => {
        engine.noteGesture();
        session.sendCommand({ op: 'history', dir: 'redo' })
            .catch(error => showCommandError('EffeTune could not redo the last change. Try again.', error));
    };

    const toggleButton = $('pipelineToggleButton');
    const registry = createIdRegistry(randomClientPrefix(win.crypto));
    const adapter = createModelAdapter({
        win, registry, audioManager,
        setSlotLabel: slot => { if (toggleButton) toggleButton.textContent = slot; }
    });
    const engine = new SyncEngine({
        adapter,
        send: message => session.send(message),
        onError: error => showCommandError('EffeTune could not apply this change. Try again.', error)
    });
    audioManager.onLocalChange = plugin => engine.markDirty(plugin ? registry.idOf(plugin) : null);

    // ---- layout and page wiring ---------------------------------------------
    uiManager.layoutModeUnsubscribe = uiManager.layoutMode.onChange(mode => {
        mobileShell.applyMode(mode);
        const columns = pipelineManager.core.columnManager;
        columns?.updatePipelineColumns(columns.getCurrentColumns());
        pluginListManager.updatePositions();
        if (!uiManager.layoutMode.isMobile) keypad.cancel();
    });
    mobileShell.applyMode(uiManager.layoutMode.mode);
    uiManager.rangeFill = installRangeFillStyling(document);
    pluginListManager.initPluginList();
    pipelineManager.initDragAndDrop();
    uiManager.rangeFill.refresh();
    pluginListManager.collapseManager.markReady();
    audioManager.suppressMutations = false;

    for (const type of GESTURE_EVENTS) {
        document.addEventListener(type, () => engine.noteGesture(), { capture: true, passive: true });
    }
    $('undoButton')?.addEventListener('click', () => pipelineManager.undo());
    $('redoButton')?.addEventListener('click', () => pipelineManager.redo());
    toggleButton?.addEventListener('click', () => {
        engine.noteGesture();
        session.sendCommand({ op: 'slot', slot: adapter.slot === 'A' ? 'B' : 'A' })
            .catch(error => showCommandError('EffeTune could not switch pipelines. Try again.', error));
    });
    const menu = $('pipelineMenu');
    $('pipelineMenuButton')?.addEventListener('click', event => {
        event.stopPropagation();
        menu?.classList.toggle('show');
    });
    document.addEventListener('click', event => {
        if (!menu?.contains(event.target)) menu?.classList.remove('show');
    });
    const copySlot = (from, to) => () => {
        menu?.classList.remove('show');
        engine.noteGesture();
        session.sendCommand({ op: 'copySlot', from, to })
            .catch(error => showCommandError('EffeTune could not copy the pipeline. Try again.', error));
    };
    $('copyAToBButton')?.addEventListener('click', copySlot('A', 'B'));
    $('copyBToAButton')?.addEventListener('click', copySlot('B', 'A'));

    session.addEventListener('state', event => {
        const message = event.detail;
        if (typeof message.host === 'string') $('remoteHost').textContent = message.host;
        engine.onState(message);
    });
    session.addEventListener('status', event => {
        const { status } = event.detail;
        if (status === 'open') {
            engine.onConnected();
            overlay.hidden = true;
            setConnection('open', 'Connected');
            return;
        }
        engine.onDisconnected();
        overlay.hidden = false;
        // The overlay covers the editor: nothing can be edited without a host to take it.
        if (status === 'unauthorized') {
            overlayText.textContent = 'The pairing code changed. Scan the QR code in EffeTune again.';
            overlay.dataset.terminal = 'true';
            setConnection('closed', 'Pairing code changed');
        } else {
            overlayText.textContent = 'Reconnecting…';
            setConnection('connecting', status === 'connecting' ? 'Connecting…' : 'Reconnecting…');
        }
    });
    session.start();
    win.remoteClient = { session, engine, adapter, registry, pipelineManager, audioManager, pluginManager, uiManager };
    return win.remoteClient;
}

if (typeof document !== 'undefined' && document.body?.classList.contains('remote-client')) {
    startRemoteClient().catch(error => {
        console.error('[remote] client failed to start', error);
        showNotice('EffeTune could not start the remote editor. Reload the page and try again.');
    });
}
