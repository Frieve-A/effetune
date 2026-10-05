import { getPluginExecutionCapabilities } from '../../audio/plugin-execution-capabilities.js';

const unavailableReasons = new Set(['rolloutDisabled', 'wasmUnavailable', 'runtimeFallback']);
const notices = new WeakMap();

function getNoticeEntry(plugin) {
    let entry = notices.get(plugin);
    if (!entry) {
        entry = { state: null, notice: null };
        notices.set(plugin, entry);
    }
    return entry;
}

function renderNotice(entry) {
    const { notice, state } = entry;
    if (!notice) return;
    const preferences = window.audioPreferences || window.electronIntegration?.audioPreferences || {};
    const disabled = preferences.useWasmDsp === false;
    const unavailable = state?.state === 'bypassed' && unavailableReasons.has(state.reason);
    let message = '';
    if (unavailable || (!state && disabled)) {
        const settingsDisabled = disabled && (!state || state.reason === 'rolloutDisabled');
        const key = settingsDisabled ? 'status.wasmEffectDisabled' : 'status.wasmEffectUnavailable';
        const fallback = settingsDisabled
            ? 'This effect is not running. In Audio Configuration, enable "Use WebAssembly audio processing".'
            : 'This effect is not running because WebAssembly audio processing is unavailable. Check "Use WebAssembly audio processing" in Audio Configuration. If it is enabled, reset audio or reload EffeTune.';
        const translated = window.uiManager?.t?.(key);
        message = translated && translated !== key ? translated : fallback;
    }
    notice.textContent = message;
    notice.hidden = !message;
}

export function updateWasmExecutionNotice(plugin, message) {
    if (getPluginExecutionCapabilities(plugin)?.requiresWasm !== true ||
        message?.validated !== true || message.pluginId !== plugin.id ||
        message.pluginType !== plugin.constructor.name) return;
    const entry = getNoticeEntry(plugin);
    entry.state = { state: message.state, reason: message.reason };
    renderNotice(entry);
}

export function createWasmExecutionNotice(plugin) {
    const entry = getNoticeEntry(plugin);
    const notice = document.createElement('div');
    notice.className = 'plugin-wasm-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    entry.notice = notice;
    renderNotice(entry);

    // Suppress duplicate execution warnings while preserving filter preparation
    // and compatibility messages in the plugin's existing status field.
    if (!entry.statusWrapped && typeof plugin._executionStatusText === 'function') {
        const executionStatusText = plugin._executionStatusText;
        plugin._executionStatusText = function (...args) {
            return entry.notice?.hidden === false ? '' : executionStatusText.apply(this, args);
        };
        entry.statusWrapped = true;
    }
    plugin._renderStatusMessage?.();
    return notice;
}
