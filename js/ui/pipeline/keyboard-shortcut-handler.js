import { readTextFromClipboard as defaultReadTextFromClipboard } from '../../utils/clipboard-utils.js';

function stopShortcutEvent(event) {
    event.preventDefault();
    event.stopPropagation();
}

function targetMatches(target, selector) {
    return !!(target && typeof target.matches === 'function' && target.matches(selector));
}

function isTextEditingTarget(target) {
    return !!(target && (target.isContentEditable || targetMatches(target, 'input, textarea')));
}

function isRangeInput(target) {
    return targetMatches(target, 'input[type="range"]');
}

export function handlePipelineKeyboardShortcut(event, {
    historyManager,
    pipelineManager,
    core,
    clipboardManager,
    readTextFromClipboard = defaultReadTextFromClipboard,
    uiManager = typeof window !== 'undefined' ? window.uiManager : null,
    documentRef = typeof document !== 'undefined' ? document : null
}) {
    const key = event.key ? event.key.toLowerCase() : '';
    const isCommandShortcut = event.ctrlKey || event.metaKey;
    const presetSelect = pipelineManager.presetManager.presetSelect;

    if (isCommandShortcut && !event.shiftKey) {
        if (!isTextEditingTarget(event.target) || isRangeInput(event.target)) {
            if (key === 'z') {
                stopShortcutEvent(event);
                historyManager.undo();
                return true;
            }
            if (key === 'y') {
                stopShortcutEvent(event);
                historyManager.redo();
                return true;
            }
        }
    }

    if (key === 's' && isCommandShortcut) {
        stopShortcutEvent(event);
        presetSelect.focus();
        presetSelect.select();

        const presetName = presetSelect.value.trim();
        if (!event.shiftKey && presetName) {
            pipelineManager.presetManager.savePreset(presetName);
        }
        return true;
    }

    if (event.key === 'Escape' && event.target === presetSelect) {
        presetSelect.value = '';
        return true;
    }

    if (isTextEditingTarget(event.target)) {
        return false;
    }

    if (key === 'a' && isCommandShortcut) {
        stopShortcutEvent(event);
        core.selectedPlugins.clear();
        pipelineManager.audioManager.pipeline.forEach(plugin => {
            core.selectedPlugins.add(plugin);
        });
        core.updateSelectionClasses();
        return true;
    }

    if (key === 'x' && isCommandShortcut) {
        stopShortcutEvent(event);
        clipboardManager.cutSelectedPlugins();
        return true;
    }

    if (key === 'c' && isCommandShortcut) {
        stopShortcutEvent(event);
        clipboardManager.copySelectedPluginsToClipboard();
        return true;
    }

    if (event.key === 'Escape') {
        if (documentRef && documentRef.activeElement === presetSelect) {
            presetSelect.value = '';
            return true;
        }

        core.selectedPlugins.clear();
        core.pipelineList.querySelectorAll('.pipeline-item').forEach(item => {
            item.classList.remove('selected');
        });
        return true;
    }

    if (key === 'v' && isCommandShortcut) {
        const electronAPI = typeof window !== 'undefined' ? window.electronAPI : null;
        if (!electronAPI || typeof electronAPI.readClipboardText !== 'function') {
            return false;
        }

        stopShortcutEvent(event);
        readTextFromClipboard()
            .then(text => {
                if (text) clipboardManager.handlePaste(text);
            })
            .catch(() => {
                if (uiManager) {
                    uiManager.setError('error.failedToReadClipboard', true);
                }
            });
        return true;
    }

    if (event.key === 'Delete') {
        stopShortcutEvent(event);
        core.deleteSelectedPlugins();
        return true;
    }

    return false;
}

export function handlePipelinePasteEvent(event, {
    clipboardManager
}) {
    if (isTextEditingTarget(event.target)) {
        return false;
    }

    const text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
    if (!text) {
        return false;
    }

    stopShortcutEvent(event);
    clipboardManager.handlePaste(text);
    return true;
}
